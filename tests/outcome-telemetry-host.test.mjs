import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import ts from "typescript";
import { buildAnalyticsReport } from "../src/model/analytics.ts";
import { buildOutcomeTelemetry } from "../src/model/outcome-telemetry.ts";
import { PROMPT_TECHNIQUES, promptTechniqueDefinition } from "../src/model/prompt-structures.ts";
import { DOCUMENT_ARTIFACT_KINDS, documentArtifactDefinition } from "../src/model/document-artifacts.ts";
import { attentionEvents, attentionMetrics, ATTENTION_RETENTION_DAYS } from "../src/model/attention.ts";
import { routePathname } from "../src/model/routes.ts";
import { FORMA_OUTCOME_MESSAGES } from "../src/components/design-system/locales/outcome-messages.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const syntax = (path) => ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const analyticsSyntax = syntax("../src/components/forma-analytics.ts");
const accountSyntax = syntax("../src/components/forma-account-settings.ts");
const workspaceSyntax = syntax("../src/components/forma-workspace-settings.ts");
const summarySyntax = syntax("../src/components/outcome-telemetry-summary.ts");
const classText = (source, name, probes = "") => {
  const node = source.statements.find((item) => ts.isClassDeclaration(item) && item.name?.text === name);
  assert.ok(node, "actual host class " + name);
  const body = node.getText(source).replace(/^export /u, "").replace(/extends \w+/u, "extends Base");
  return "(" + body.slice(0, -1) + probes + "})";
};
const tick = () => new Promise(setImmediate);
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const cell = (value) => ({ get: () => value, set: (next) => { value = next; } });
const now = Date.now();
const event = (id, type, payload = {}, overrides = {}) => ({
  eventId: id, streamId: "creative:actor-a", sequence: 1, occurredAt: new Date(now - 60_000).toISOString(),
  recordedAt: new Date(now - 60_000).toISOString(), actor: "worker:fixture", clientId: "fixture", correlationId: id,
  causationId: null, compensatesEventId: null, schemaVersion: 1, type, payload, ...overrides,
});
const events = () => {
  const binding = { artifact_id: "artifact-a", document_id: "doc-a", artifact_revision: 2, content_sha256: "a".repeat(64) };
  const approved = event("approved-a", "ArtifactApproved", binding);
  const exported = event("export-a", "DocumentArtifactExported", binding);
  return [approved, approved, event("approved-b", "ArtifactApproved", binding), exported, exported,
    event("resource-export", "ObjectExported", { object_id: "block-a" }),
    event("zero", "GenerationUsageRecorded", { cost_microusd: 0 }), event("known", "GenerationUsageRecorded", { cost_microusd: 17 }),
    event("unknown", "GenerationUsageRecorded", {}), event("completed", "DocumentRenderCompleted", { artifact_id: "artifact-a", artifact_kind: "short_story" })];
};
const live = () => ({
  asOf: new Date(now).toISOString(),
  finance: { scope: "actor-account", window: "all-reservation-periods", currency: "USD", source: "cost_budget_reservations",
    periods: [
      { period: "2026-07", reservationCount: 1, activeCount: 0, executingCount: 1, settledCount: 0, releasedCount: 0,
        unclassifiedCount: 0, invalidAmountCount: 0, heldMicrousd: 24_000, settledMicrousd: 0 },
      { period: "2026-08", reservationCount: 2, activeCount: 0, executingCount: 0, settledCount: 2, releasedCount: 0,
        unclassifiedCount: 0, invalidAmountCount: 0, heldMicrousd: 0, settledMicrousd: 17 },
    ], truncated: false, heldMicrousd: 24_000, settledMicrousd: 17, providerInvoiceReconciled: null },
  jobs: { scope: "actor-owned-currently-readable-jobs", window: "active-or-unexpired", source: "document_jobs",
    total: 4, queued: 0, running: 0, committing: 0, completed: 3, partial: 0, failed: 0, canceled: 1, unclassified: 0,
    completedExplicitlyUnavailable: 1, completedAvailabilityUnknown: 2, retainedCheckpointCount: 3, missingOrInvalidCheckpointCount: 1,
    usableResultCount: null, mediaAvailability: "not-checked" },
});
function report(receipts = events(), evidence = live(), rangeDays = 30) {
  return buildAnalyticsReport([{ streamId: "creative:actor-a", userId: "actor-a", userName: "Actor A",
    organizationId: "personal:actor-a", organizationName: "Personal", fictional: false, events: receipts }],
  { now, rangeDays, outcomeLiveEvidence: evidence });
}

// Actual host class bodies and rendering helpers; only transport, storage and DOM
// are mocked. This is not evidence of native-browser or hosted-scheduler behavior.
function fixture(locale = "en") {
  const calls = [], queue = [], takers = [], writes = [], clears = [], emitted = [], usedKeys = new Set();
  let snapshot = null, prefetch = null, clearGate = null;
  const session = cell({
    user: { userId: "actor-a", role: "admin" }, permissionEpoch: "epoch-a", impersonation: null,
    policy: { accepted: true, version: "policy-a", retentionDays: 30, evidenceRetentionDays: 365 },
    capabilities: ["project.read"], costBudgets: { period: "2026-08", currency: "USD",
      user: { usedMicrousd: 17, reservedMicrousd: 8000, remainingMicrousd: 991983, limitMicrousd: 1_000_000 } },
    budgets: { period: "2026-08", user: { used: 3, reserved: 4, limit: 1000 } }, organizations: [], projects: [],
  });
  const store = {
    session, events: cell(events()), shares: cell([]), projection: cell({ documents: [] }), route: cell("/settings/workspaces/org-a/overview"),
    ui: { instrumentation: false, attentionCapture: false, attentionPaused: false }, canManageProjectShares: () => false,
    captureAuthorizationScope: () => ({ key: JSON.stringify([session.get()?.user.userId, session.get()?.permissionEpoch, session.get()?.projectContext]) }),
    loadShares: async () => {}, setRoute: (route) => store.route.set(route),
  };
  const i18n = {
    locale, number: (value, options) => new Intl.NumberFormat(locale, options).format(value),
    date: (value, options) => new Intl.DateTimeFormat(locale, { timeZone: "UTC", ...options }).format(value),
    t: (key, fallback = "", values = {}) => { if (key.startsWith("outcome.")) usedKeys.add(key);
      return (FORMA_OUTCOME_MESSAGES[locale][key] ?? fallback ?? key).replace(/\{(\w+)\}/gu, (_, token) => String(values[token] ?? "")) || key; },
    system: (value) => value,
    plural: (_key, count, one, many) => (count === 1 ? one : many).replace("{count}", String(count)),
  };
  const nothing = Symbol("nothing"), icon = () => "";
  const value = (part) => part === nothing ? "" : Array.isArray(part) ? part.map(value).join("") : typeof part === "function" ? "[handler]" : String(part ?? "");
  const html = (parts, ...values) => parts.reduce((out, part, i) => out + part + (i < values.length ? value(values[i]) : ""), "");
  const document = { documentElement: { lang: locale, dataset: {} } };
  const window = { dispatchEvent: (event) => emitted.push(event), addEventListener() {}, removeEventListener() {} };
  const fetch = (url) => {
    assert.match(url, /^\/api\/analytics\?days=(7|30|90|365|all)&includeSynthetic=(true|false)$/u, "no new endpoint or provider");
    const gate = deferred(), call = { url, gate }; calls.push(call);
    if (takers.length) takers.shift()(call); else queue.push(call);
    return gate.promise;
  };
  const consumeRoutePrefetch = () => { const pending = prefetch; prefetch = null; return pending; };
  const readAnalyticsSnapshot = async () => snapshot;
  const writeAnalyticsSnapshot = async (identity, url, report) => { writes.push({ identity, url, report }); };
  const clearAnalyticsSnapshots = async (identity) => { clears.push(identity); if (clearGate) await clearGate.promise; };
  class Base {
    store = store; i18n = i18n; isConnected = true;
    connectedCallback() {} disconnectedCallback() {} requestUpdate() {}
  }
  const helperBody = summarySyntax.statements.filter((node) => !ts.isImportDeclaration(node))
    .map((node) => node.getText(summarySyntax).replace(/^export /u, "")).join("\n");
  const { outcomeMoney, outcomeTelemetryDisclosure, personalUsageReceiptDisclosure, outcomeSchedulerEvidence } =
    eval(stripTypeScriptTypes("(()=>{" + helperBody + ";return {outcomeMoney,outcomeTelemetryDisclosure,personalUsageReceiptDisclosure,outcomeSchedulerEvidence};})()"));
  const analyticsVars = analyticsSyntax.statements.filter(ts.isVariableStatement).map((node) => node.getText(analyticsSyntax)).join("\n");
  const Analytics = eval(stripTypeScriptTypes("(()=>{" + analyticsVars + ";return " + classText(analyticsSyntax, "FormaAnalytics", `
    loadForTest() { return this.#load(); }
    daysForTest(days) { this.#days = days; return this.#load(); }
    stateForTest() { return { report:this.#report, scope:this.#reportScope, fresh:this.#reportFresh, error:this.#error, refreshError:this.#refreshError }; }
  `) + ";})()"));
  const Account = eval(stripTypeScriptTypes(classText(accountSyntax, "FormaAccountSettings")));
  const sections = ["overview", "members", "projects", "usage", "activity"];
  const Workspace = eval(stripTypeScriptTypes(classText(workspaceSyntax, "FormaWorkspaceSettings", `
    assuranceForTest(report) { this.#assurance=report; return this.#assuranceControls(); }
  `)));
  const analytics = new Analytics(), account = new Account(), workspace = new Workspace();
  // Expose the exact lexical dependencies read by the evaluated source. These
  // are the same live ports/imports; evaluation and application bodies stay intact.
  const sourceDependencies = {
    buildOutcomeTelemetry, PROMPT_TECHNIQUES, promptTechniqueDefinition,
    DOCUMENT_ARTIFACT_KINDS, documentArtifactDefinition,
    attentionEvents, attentionMetrics, ATTENTION_RETENTION_DAYS, routePathname,
    icon, html, window, fetch, consumeRoutePrefetch, readAnalyticsSnapshot,
    writeAnalyticsSnapshot, clearAnalyticsSnapshots, Base, sections,
  };
  const f = {
    sourceDependencies,
    calls, writes, clears, emitted, usedKeys, store, session, i18n, analytics, account, workspace, document,
    helpers: { outcomeMoney, outcomeTelemetryDisclosure, personalUsageReceiptDisclosure, outcomeSchedulerEvidence },
    snapshot(value) { snapshot = value; }, prefetch(value) { prefetch = value; }, clearGate(value) { clearGate = value; },
    take: () => queue.length ? Promise.resolve(queue.shift()) : new Promise((resolve) => takers.push(resolve)),
    async reply(call, value, status = 200, beforeJson = async () => {}) {
      call.gate.resolve({ ok: status >= 200 && status < 300, status, headers: { get: () => null },
        json: async () => { await beforeJson(); return { report: value }; } }); await tick();
    },
    async load(value = report()) { const loading = analytics.loadForTest(), call = await f.take(); await f.reply(call, value); await loading; return call; },
  };
  return f;
}

for (const locale of ["en", "fr", "ar", "ja"]) {
  test(locale + " actual analytics renders historical receipts and original-period holds without claiming delivery or usable media", async () => {
    const f = fixture(locale), source = report(); await f.load(source);
    const markup = f.analytics.render(), outcomeMarkup = f.helpers.outcomeTelemetryDisclosure(source.outcomes, f.i18n, true);
    assert.equal(f.calls.length, 1); assert.equal(f.writes.length, 1);
    assert.ok(markup.includes(outcomeMarkup));
    for (const key of ["outcome.historyScope","outcome.notDelivery","outcome.financeScope","outcome.noInvoice","outcome.ledgerDetail","outcome.checkpointNotUsable"]) {
      assert.ok(outcomeMarkup.includes(FORMA_OUTCOME_MESSAGES[locale][key]), key);
    }
    assert.equal(source.outcomes.approvals.receiptCount, 2); assert.equal(source.outcomes.approvals.distinctExactRevisionCount, 1);
    assert.equal(source.outcomes.exports.artifactReceiptCount, 1); assert.equal(source.outcomes.exports.distinctExactRevisionCount, 1);
    assert.equal(source.outcomes.coverage.ignoredDuplicateReceipts, 2);
    assert.equal(source.outcomes.usage.recordedMicrousd, 17); assert.equal(source.outcomes.usage.unpricedReceiptCount, 1);
    assert.ok(outcomeMarkup.includes("2026-07")); assert.ok(outcomeMarkup.includes(f.helpers.outcomeMoney(24_000, f.i18n)));
    assert.ok(outcomeMarkup.includes(f.helpers.outcomeMoney(17, f.i18n)));
    assert.doesNotMatch(outcomeMarkup, /<video|<audio|<img|<button|<a |download=|ROI|time saved/iu);
    assert.match(outcomeMarkup, /<details[^>]+outcome-telemetry[^>]*>\s*<summary>/u);
    assert.match(outcomeMarkup, /role="region" tabindex="0" aria-label=/u);
    assert.match(outcomeMarkup, /<caption>/u); assert.match(outcomeMarkup, /scope="col"/u); assert.match(outcomeMarkup, /scope="row"/u);
    for (const key of f.usedKeys) assert.ok(FORMA_OUTCOME_MESSAGES[locale][key], key);
  });

  test(locale + " actual account receipts preserve explicit zero and unknown cost, exclude other principals and suppress shared finance", () => {
    const f = fixture(locale);
    const zero = event("zero", "GenerationUsageRecorded", { cost_microusd: 0 });
    f.store.events.set([zero, zero, event("unknown", "GenerationUsageRecorded", {}), event("malformed", "GenerationUsageRecorded", { cost_microusd: "0" }),
      event("other", "GenerationUsageRecorded", { cost_microusd: 999_999_000 }, { streamId: "creative:actor-b" }),
      event("synthetic", "GenerationUsageRecorded", { cost_microusd: 777_777_000, synthetic: true })]);
    const markup = f.account.render(), receipts = f.helpers.personalUsageReceiptDisclosure(f.store.events.get(), "actor-a", f.i18n);
    assert.ok(markup.includes(receipts)); assert.equal((receipts.match(/<li>/gu) ?? []).length, 3);
    assert.equal(receipts.split(f.helpers.outcomeMoney(0, f.i18n)).length - 1, 1, "only the explicit zero has a zero amount");
    assert.equal(receipts.split(FORMA_OUTCOME_MESSAGES[locale]["outcome.unknown"]).length - 1, 2);
    assert.ok(markup.includes(f.i18n.t("outcome.currentPeriodOnly", "", { period: "2026-08" })));
    assert.doesNotMatch(receipts, /999|777/u); assert.equal(f.calls.length, 0);
    for (const change of [
      { projectContext: { projectId: "project-shared", ownerUserId: "actor-b" } },
      { impersonation: { active: true } },
      { policy: { ...f.session.get().policy, accepted: false } },
    ]) {
      const original = f.session.get(); f.session.set({ ...original, ...change });
      const denied = f.account.render();
      assert.ok(denied.includes(FORMA_OUTCOME_MESSAGES[locale]["outcome.personalUnavailable"]));
      assert.ok(!denied.includes('creator-settings-budget"')); assert.ok(!denied.includes('creator-settings-charges"'));
      assert.ok(!denied.includes(f.helpers.outcomeMoney(8000, f.i18n)));
      f.session.set(original);
    }
  });

  test(locale + " actual assurance never promotes a healthy local handler into verified hosting", () => {
    const f = fixture(locale);
    const assurance = { enterpriseReady: false, enterpriseBlockers: ["retention-scheduling"], controls: [],
      scheduler: { state: "healthy", hostingScheduleVerified: false, lastScheduledAt: new Date(now).toISOString() },
      retention: { pendingCount: 0, heldCount: 0 }, reviews: { pendingCount: 0 }, packages: { activeCount: 0 } };
    const markup = f.workspace.assuranceForTest(assurance);
    for (const key of ["outcome.hostedSchedule", "outcome.scheduleUnverified", "outcome.scheduleNote", "outcome.scheduler.healthy"]) {
      assert.ok(markup.includes(FORMA_OUTCOME_MESSAGES[locale][key]), key);
    }
    assert.equal(f.calls.length, 0);
  });
}

test("outcome display distinguishes no explicit usage, verified zero, unknown holds and bounded partial data", () => {
  const f = fixture(), r = report();
  const zero = report([event("exact-zero", "GenerationUsageRecorded", { cost_microusd: 0 })]);
  const unknown = report([event("legacy", "GenerationUsageRecorded", {})]);
  assert.ok(f.helpers.outcomeTelemetryDisclosure(zero.outcomes, f.i18n, true).includes('<bdi>$0.00</bdi>'));
  assert.ok(f.helpers.outcomeTelemetryDisclosure(unknown.outcomes, f.i18n, true).includes(FORMA_OUTCOME_MESSAGES.en["outcome.noExplicitUsage"]));
  r.outcomes.live.finance.heldMicrousd = null; r.outcomes.live.finance.truncated = true;
  r.outcomes.live.finance.periods[0].heldMicrousd = null; r.outcomes.live.finance.periods[0].unclassifiedCount = 1;
  r.outcomes.live.finance.periods[0].invalidAmountCount = 1;
  const markup = f.helpers.outcomeTelemetryDisclosure(r.outcomes, f.i18n, true);
  assert.ok(markup.includes(FORMA_OUTCOME_MESSAGES.en["outcome.unknownAmount"]));
  assert.ok(markup.includes(FORMA_OUTCOME_MESSAGES.en["outcome.truncated"]));
  assert.ok(markup.includes(f.i18n.t("outcome.unresolved", "", { unknown: "1", invalid: "1" })));
  for (const value of [null, undefined, "0", -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.equal(f.helpers.outcomeMoney(value, f.i18n), "Unknown");
  assert.equal(f.helpers.outcomeMoney(1, f.i18n), "$0.000001");
  const missing = f.helpers.outcomeTelemetryDisclosure(undefined, f.i18n, false);
  assert.ok(missing.includes(FORMA_OUTCOME_MESSAGES.en["outcome.missing"])); assert.doesNotMatch(missing, /\$0|0 historical/u);
  r.outcomes.live.finance.scope = "all-projects";
  const wrongScope = f.helpers.outcomeTelemetryDisclosure(r.outcomes, f.i18n, true);
  assert.ok(wrongScope.includes(FORMA_OUTCOME_MESSAGES.en["outcome.financeUnavailable"]));
  assert.doesNotMatch(wrongScope, /2026-07/u);
});

test("cached outcome snapshots stay explicitly dated and never become fresh after a failed read", async () => {
  const f = fixture(), cached = report();
  f.snapshot({ report: cached, savedAt: now - 30000 });
  const loading = f.analytics.loadForTest(), call = await f.take(); await tick();
  assert.ok(f.analytics.render().includes(FORMA_OUTCOME_MESSAGES.en["outcome.snapshot"]));
  call.gate.reject(new Error("Fixture network failure")); await loading;
  assert.equal(f.analytics.stateForTest().fresh, false);
  assert.ok(f.analytics.render().includes(FORMA_OUTCOME_MESSAGES.en["outcome.snapshot"]));
  assert.equal(f.writes.length, 0);
  const old = report(); delete old.outcomes; f.snapshot({ report: old, savedAt: now - 30000 });
  const reloading = f.analytics.loadForTest(), failed = await f.take(); await tick();
  assert.ok(f.analytics.render().includes(FORMA_OUTCOME_MESSAGES.en["outcome.missing"]));
  failed.gate.reject(new Error("Fixture unavailable")); await reloading;
});

test("analytics clears private snapshots synchronously on denial before asynchronous cache removal", async () => {
  const f = fixture(); await f.load(); const gate = deferred(); f.clearGate(gate);
  const loading = f.analytics.loadForTest(), call = await f.take();
  await f.reply(call, report(), 403);
  assert.equal(f.analytics.stateForTest().report, null); assert.equal(f.clears.length, 1);
  assert.ok(!f.analytics.render().includes("outcome-telemetry"));
  gate.resolve(); await loading; assert.equal(f.analytics.stateForTest().report, null);
});

test("actual analytics refuses actor, epoch, policy, role, impersonation and project changes during JSON decode", async () => {
  for (const change of [
    { user: { userId: "actor-b", role: "admin" } }, { permissionEpoch: "epoch-b" },
    { policy: { accepted: false, version: "policy-a" } }, { policy: { accepted: true, version: "policy-b" } },
    { user: { userId: "actor-a", role: "viewer" } }, { impersonation: { active: true } },
    { projectContext: { projectId: "foreign-project" } },
  ]) {
    const f = fixture(); await f.load();
    const loading = f.analytics.loadForTest(), call = await f.take();
    await f.reply(call, report(), 200, () => { f.session.set({ ...f.session.get(), ...change }); });
    await loading; const markup = f.analytics.render();
    assert.equal(f.analytics.stateForTest().report, null); assert.equal(f.writes.length, 1);
    assert.ok(!markup.includes("outcome-telemetry"));
    assert.ok(!markup.includes(FORMA_OUTCOME_MESSAGES.en["outcome.finance"]));
  }
});

test("older positive or negative analytics reads cannot replace a newer exact range or principal report", async () => {
  for (const status of [200, 403]) {
    const f = fixture(), decode = deferred();
    const older = f.analytics.loadForTest(), old = await f.take();
    if (status === 200) { old.gate.resolve({ ok: true, status: 200, headers: { get: () => null },
      json: async () => { await decode.promise; return { report: report() }; } }); await tick(); }
    f.session.set({ ...f.session.get(), user: { userId: "actor-b", role: "admin" }, permissionEpoch: "epoch-b" });
    const fresh = report(); fresh.rangeDays = 7; fresh.generatedAt = new Date(now + 1).toISOString();
    const newer = f.analytics.daysForTest("7"), next = await f.take(); await f.reply(next, fresh); await newer;
    if (status === 200) decode.resolve(); else await f.reply(old, undefined, 403);
    await older;
    assert.equal(f.analytics.stateForTest().report, fresh); assert.equal(f.analytics.stateForTest().fresh, true);
    assert.equal(f.writes.length, 1); assert.equal(f.writes[0].identity.userId, "actor-b"); assert.equal(f.clears.length, 0);
  }
});

test("a changed scope cannot adopt an old cached snapshot, and discarded transport rejection is handled", async () => {
  const f = fixture(), waiting = deferred(); f.snapshot(waiting.promise);
  const loading = f.analytics.loadForTest(), call = await f.take();
  f.session.set({ ...f.session.get(), permissionEpoch: "epoch-b" });
  waiting.resolve({ report: report(), savedAt: now }); await loading;
  call.gate.reject(new Error("Discarded old read")); await tick();
  assert.equal(f.analytics.stateForTest().report, null); assert.equal(f.writes.length, 0);
});

test("all four catalogs, native disclosures, 44px controls and RTL-safe scrollable tables use existing infrastructure", () => {
  const keys = Object.keys(FORMA_OUTCOME_MESSAGES.en).sort();
  for (const locale of ["en", "fr", "ar", "ja"]) {
    assert.deepEqual(Object.keys(FORMA_OUTCOME_MESSAGES[locale]).sort(), keys);
    for (const key of keys) assert.deepEqual([...FORMA_OUTCOME_MESSAGES[locale][key].matchAll(/\{\w+\}/gu)].map((match) => match[0]).sort(),
      [...FORMA_OUTCOME_MESSAGES.en[key].matchAll(/\{\w+\}/gu)].map((match) => match[0]).sort(), locale + " " + key);
    const path = locale === "en" ? "../src/components/design-system/localization.ts" : "../src/components/design-system/locales/" + locale + ".ts";
    assert.ok(read(path).includes("...FORMA_OUTCOME_MESSAGES." + locale));
  }
  const css = read("../src/design-system.css");
  assert.match(css, /\.outcome-telemetry > summary[^}]*min-block-size:[^}]*2\.75rem/u);
  assert.match(css, /\.outcome-telemetry table[^}]*min-inline-size:[^}]*text-align: start/u);
  assert.match(css, /\.outcome-telemetry \.analytics-table-wrap:focus-visible/u);
  assert.match(css, /\.analytics-table-wrap[^}]*overflow-x: auto/u);
  const source = read("../src/components/outcome-telemetry-summary.ts");
  assert.doesNotMatch(source, /\bfetch\(|localStorage|indexedDB|setInterval|setTimeout|<button|<a /u);
});

test("a newer pending refresh is not authority to retain finance after an older same-scope denial", async () => {
  for (const status of [401, 403, 428]) {
    const f = fixture(); await f.load();
    const older = f.analytics.loadForTest(), old = await f.take(); await tick();
    const newer = f.analytics.loadForTest(), next = await f.take(); await tick();
    await f.reply(old, undefined, status); await older;
    const beforeCertification = f.analytics.stateForTest().report;
    const fresh = report(); fresh.generatedAt = new Date(now + 1).toISOString();
    await f.reply(next, fresh); await newer;
    assert.equal(beforeCertification, null, "pending intent cannot retain the earlier private report after HTTP " + status);
    assert.equal(f.analytics.stateForTest().report, fresh, "the already-started newer read may still establish current access");
    assert.equal(f.analytics.stateForTest().fresh, true);
  }
});

test("an access denial clears finance before a cached-snapshot lookup resolves", async () => {
  const f = fixture(); await f.load();
  const waiting = deferred(); f.snapshot(waiting.promise);
  const reading = f.analytics.loadForTest(), call = await f.take();
  await f.reply(call, undefined, 403);
  const afterHeaders = f.analytics.stateForTest().report;
  waiting.resolve({ report: report(), savedAt: now }); await reading;
  assert.equal(afterHeaders, null, "private finance must clear before the unrelated cache await");
  assert.equal(f.analytics.stateForTest().report, null, "the delayed cached snapshot cannot restore denied finance");
});

test("an older same-scope denial does not erase a newer completed certified analytics read", async () => {
  const f = fixture(); await f.load();
  const older = f.analytics.loadForTest(), old = await f.take(); await tick();
  const newer = f.analytics.loadForTest(), next = await f.take(), fresh = report();
  fresh.generatedAt = new Date(now + 1).toISOString();
  await f.reply(next, fresh); await newer;
  await f.reply(old, undefined, 403); await older;
  assert.equal(f.analytics.stateForTest().report, fresh); assert.equal(f.clears.length, 0);
});

test("a later denial still defeats a previously requested positive analytics read", async () => {
  const f = fixture(); await f.load();
  const positive = f.analytics.loadForTest(), older = await f.take(); await tick();
  const negative = f.analytics.loadForTest(), later = await f.take();
  await f.reply(later, undefined, 403); await negative;
  await f.reply(older, report()); await positive;
  assert.equal(f.analytics.stateForTest().report, null);
});

test("the existing authenticated route prefetch is reused without an extra analytics read", async () => {
  const f = fixture(), current = report();
  f.prefetch(Promise.resolve({ ok: true, status: 200, headers: { get: () => "prefetch" }, json: async () => ({ report: current }) }));
  await f.analytics.loadForTest();
  assert.equal(f.calls.length, 0); assert.equal(f.analytics.stateForTest().report, current);
  assert.equal(f.writes.length, 1);
});

test("non-admin, shared, impersonated or unaccepted account views do not request the admin endpoint", async () => {
  for (const change of [{ user: { userId: "actor-a", role: "creator" } }, { projectContext: { projectId: "shared" } },
    { impersonation: { active: true } }, { policy: { accepted: false, version: "policy-a" } }]) {
    const f = fixture(); f.session.set({ ...f.session.get(), ...change }); await f.analytics.loadForTest();
    assert.equal(f.calls.length, 0); assert.equal(f.analytics.stateForTest().report, null);
  }
});

test("a real seven-day analytics range keeps previous-period reservations in their separate account snapshot", async () => {
  const f = fixture(), current = report(events(), live(), 7);
  const loading = f.analytics.daysForTest("7"), call = await f.take();
  assert.match(call.url, /days=7&/u); await f.reply(call, current); await loading;
  assert.equal(current.outcomes.window.from, new Date(now - 7 * 86_400_000).toISOString());
  assert.equal(current.outcomes.live.finance.periods[0].period, "2026-07");
  const markup = f.helpers.outcomeTelemetryDisclosure(current.outcomes, f.i18n, true);
  assert.match(markup, /2026-07/u); assert.ok(markup.includes(FORMA_OUTCOME_MESSAGES.en["outcome.financeScope"]));
  assert.equal(current.outcomes.live.finance.heldMicrousd, 24_000);
  assert.equal(current.outcomes.usage.recordedMicrousd, 17);
  assert.equal(f.calls.length, 1);
});

test("explicit zero usage can coexist with an unknown cost and an unresolved held reservation", () => {
  const f = fixture(), evidence = live(); evidence.finance.heldMicrousd = null;
  evidence.finance.periods[0].heldMicrousd = null; evidence.finance.periods[0].unclassifiedCount = 1;
  const current = report([event("free-recovery", "GenerationUsageRecorded", { cost_microusd: 0 }),
    event("unpriced", "GenerationUsageRecorded", {})], evidence);
  const markup = f.helpers.outcomeTelemetryDisclosure(current.outcomes, f.i18n, true);
  assert.match(markup, /<bdi>\$0\.00<\/bdi>/u);
  assert.ok(markup.includes(f.i18n.t("outcome.usageCoverage", "", { known: "1", unknown: "1" })));
  assert.ok(markup.includes(FORMA_OUTCOME_MESSAGES.en["outcome.unknownAmount"]));
  assert.ok(markup.includes(FORMA_OUTCOME_MESSAGES.en["outcome.noInvoice"]));
  assert.equal(current.outcomes.usage.recordedMicrousd, 0);
  assert.equal(current.outcomes.live.finance.heldMicrousd, null);
});

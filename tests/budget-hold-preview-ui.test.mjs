import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as preview from "../src/model/budget-hold-preview.ts";
import { FORMA_BUDGET_HOLD_PREVIEW_MESSAGES } from "../src/components/design-system/locales/budget-hold-preview-messages.ts";

// Actual Account Settings class and handlers. The narrow Lit/store/network ports
// do not certify native browser delivery or production administrator authority.
const source = fs.readFileSync(new URL("../src/components/forma-account-settings.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const nothing = Symbol("nothing"), html = (strings, ...values) => ({ strings, values });
let active;
class ElementPort {
  constructor() { this.store = active.store; this.i18n = active.i18n; this.isConnected = true; }
  requestUpdate() { active.updates++; }
  connectedCallback() {}
  disconnectedCallback() {}
}
const listeners = new Set(), exports = {};
new Function("exports", "require", "window", "customElements", code)(exports, specifier => {
  if (specifier === "lit") return { html, nothing };
  if (specifier.endsWith("/forma-element")) return { FormaElement: ElementPort, icon: () => nothing };
  if (specifier.endsWith("/budget-hold-preview.ts")) return preview;
  if (specifier.endsWith("/attention")) return { attentionEvents: () => [], attentionMetrics: () => ({ episodes: 0 }), ATTENTION_RETENTION_DAYS: 30 };
  if (specifier.endsWith("/output-naming")) return { qualifyDisplayCollisions: () => new Map() };
  if (specifier.endsWith("/outcome-telemetry-summary")) return { outcomeMoney: String, personalUsageReceiptDisclosure: () => nothing };
  if (specifier.endsWith("/command-departure")) return { navigateInApp() { throw new Error("unexpected navigation"); } };
  if (specifier.endsWith("/modal-dialog.ts")) return { requestDialogConfirmation() { throw new Error("unexpected approval"); } };
  throw new Error(`Unexpected component dependency: ${specifier}`);
}, { addEventListener: (_name, listener) => listeners.add(listener), removeEventListener: (_name, listener) => listeners.delete(listener) }, { get: () => true });

const jobId = "abcdef01-2345-6789-abcd-0123456789ab", otherJob = "abcdef02-2345-6789-abcd-0123456789ab";
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const templates = value => value && typeof value === "object" && Array.isArray(value.values) ? [value, ...value.values.flatMap(templates)] : Array.isArray(value) ? value.flatMap(templates) : [];
const text = value => value && typeof value === "object" && Array.isArray(value.values) ? value.strings.join(" ") + value.values.map(text).join(" ") : Array.isArray(value) ? value.map(text).join(" ") : typeof value === "string" || typeof value === "number" ? String(value) : "";
const handlers = (template, event) => template.values.filter((value, index) => typeof value === "function" && template.strings[index].trimEnd().endsWith(`@${event}=`));
function receipt() {
  return { applyEnabled: false, preview: { schemaVerified: true, kind: "administrative_hold_release", providerOutcome: "unknown", previewSha256: "a".repeat(64),
    jobId, documentId: "document-1", correlationId: `${jobId}:attempt:1`, ownerId: "owner-1", streamId: "creative:owner-1", tokenReservationId: "token-1", costReservationId: "cost-1", period: "2026-09", releaseTokens: 128000, releaseMicrousd: 1000000,
    settledTokensDelta: 0, settledMicrousdDelta: 0, providerCalls: 0,
    counters: Object.fromEntries([ ["tokens", "tokens", 128000], ["dollars", "microusd", 1000000] ].map(([key, unit, held]) => [key, ["user", "workspace"].map(scope => ({ scope, scope_id: scope === "user" ? "owner-1" : "forma", period: "2026-09", [`used_${unit}`]: 1, [`reserved_${unit}`]: held, [`hard_limit_${unit}`]: held * 30, updated_at: "2026-09-12T00:00:00.000Z" }))])),
    warning: "This releases internal capacity only. Provider usage and billed amount remain unknown. A later charge requires a separate reviewed correction." } };
}
function fixture(t) {
  const subscriptions = new Set();
  const f = { updates: 0, requests: [], session: { user: { userId: "owner-1", role: "admin" }, policy: { accepted: true, version: "policy-1" }, budgets: { user: {} } }, scope: { key: "scope-1", shared: false }, route: "/settings", projectId: "source-project-1", reply: async () => Response.json(receipt()) };
  f.store = { session: { get: () => f.session }, captureAuthorizationScope: () => f.scope, route: { get: () => f.route }, projection: { get: () => ({ projectId: f.projectId }) },
    subscribe(callback) { subscriptions.add(callback); return () => subscriptions.delete(callback); }, loadShares() {}, events: { get: () => [] }, canManageProjectShares: () => false, ui: {},
    guardedFetch(url, init, _action, controls) { assert.equal(controls.current(), true); if (f.rejectBeforeInvoke) throw new Error("not invoked"); controls.onInvoke?.(); f.requests.push({ url, init }); return f.reply(); } };
  f.i18n = { locale: "en", system: value => value, number: String, plural: () => "", t: (key, fallback, values = {}) => (FORMA_BUDGET_HOLD_PREVIEW_MESSAGES.en[key] ?? fallback ?? key).replace(/\{(\w+)\}/g, (match, key) => values[key] ?? match) };
  active = f; f.host = new exports.FormaAccountSettings(); f.host.connectedCallback();
  f.section = () => templates(f.host.render()).find(value => value.strings.join("").includes('class="settings-hold-preview"'));
  f.enter = (value = jobId) => handlers(f.section(), "input")[0]({ currentTarget: { value } });
  f.inspect = () => handlers(f.section(), "click")[0]();
  f.clear = () => handlers(f.section(), "click")[1]();
  f.operator = () => templates(f.host.render()).find(value => value.strings.join("").includes('class="settings-hold-preview settings-hold-operator"'));
  f.command = value => handlers(f.operator(), "input")[0]({ currentTarget: { value } });
  f.acknowledge = (checked = true) => handlers(f.operator(), "change")[0]({ currentTarget: { checked } });
  f.decision = value => handlers(f.operator(), "input")[1]({ currentTarget: { value } });
  f.apply = () => handlers(f.operator(), "click")[0]();
  f.verify = () => handlers(f.operator(), "click")[1]();
  f.notify = () => { for (const callback of subscriptions) callback(); };
  t.after(() => { f.host.isConnected = false; f.host.disconnectedCallback(); assert.equal(subscriptions.size, 0); assert.equal(listeners.size, 0); });
  return f;
}

test("actual preview section sends one exact explicit read and exposes no apply action of its own", async t => {
  const f = fixture(t), gate = deferred();
  assert.ok(f.section()); assert.equal(f.requests.length, 0);
  f.enter("invalid"); f.inspect(); assert.match(text(f.section()), /Enter an exact job UUID/u); assert.equal(f.requests.length, 0);
  f.enter(); f.reply = () => gate.promise; f.inspect(); f.inspect();
  assert.equal(f.requests.length, 1);
  const { url, init } = f.requests[0];
  assert.equal(url, "/api/admin/budget-hold-dispositions");
  assert.deepEqual({ ...init, signal: undefined }, { method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", signal: undefined, headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "preview", jobId }) });
  const exact = JSON.stringify(receipt(), null, 2); gate.resolve(new Response(exact, { headers: { "content-type": "application/json" } })); await tick();
  assert.ok(text(f.section()).includes(exact)); assert.match(text(f.section()), /No hold was released/u);
  assert.equal(handlers(f.section(), "click").length, 2, "only inspect and clear controls");
  f.clear(); assert.doesNotMatch(text(f.section()), /token-1/u); assert.equal(init.signal.aborted, true);
  assert.equal(f.requests.length, 1);
});

function applyCommand(overrides = {}) {
  return JSON.stringify({ action: "apply", command: { dispositionId: "decision-1", jobId, previewSha256: "a".repeat(64), approvalRef: "external-approval", supportRef: "external-support",
    reason: "Administrative release of internal capacity; provider billing remains unknown.", evidenceSha256: "e".repeat(64), acknowledgement: "Release internal holds; provider billing remains unknown", ...overrides } }, null, 2);
}
function applyReceipt(extra = {}) { return { applied: true, replayed: false, dispositionId: "decision-1", recordSha256: "d".repeat(64), ...extra }; }
function verification(extra = {}) {
  const checks = Object.fromEntries(["recordDigest", "commandDigest", "identity", "unknownPreserved", "amounts", "reservationTransition", "counterDelta", "immutableSchema", "liveJobBinding", "reservationsPersisted", "providerEvidenceUnchanged", "auditEvent", "noAdditionalAttemptUsage", "currentReservedProjection", "settledCountersUnchanged"].map(key => [key, true]));
  return { dispositionId: "decision-1", recordSha256: "d".repeat(64), checkedAt: "2026-09-12T00:00:00.000Z", transactionVerified: true, verified: true, checks, providerOutcome: "unknown", providerBillingVerified: false,
    currentCounters: Object.fromEntries(Object.entries(receipt().preview.counters).map(([key, rows]) => [key, rows.map(row => ({ ...row, ledger_reserved: key === "tokens" ? row.reserved_tokens : row.reserved_microusd }))])), requiresReview: [],
    note: "The recorded adjustment is checked separately from current state. Any changed settled counter requires review, including legitimate later usage; this pass does not attribute that change or infer historical provider charges.", ...extra };
}
async function preparedOperator(t) {
  const f = fixture(t); f.enter(); const enabled = receipt(); enabled.applyEnabled = true;
  f.reply = async () => Response.json(enabled); f.inspect(); await tick(); f.command(applyCommand()); f.acknowledge(); return f;
}

test("operator command parser rejects duplicate keys, altered shapes, controls and excessive UTF-8 bytes", () => {
  const command = applyCommand(); assert.equal(preview.parsedHoldOperatorCommand(command).command.dispositionId, "decision-1");
  for (const value of [command.replace('"action": "apply"', '"action":"apply","action":"apply"'), command.replace('"action": "apply"', '"action":"apply","act\\u0069on":"apply"'), command.replace('"dispositionId":', '"dispositionId":"old","dispositionId":'),
    applyCommand({ provider: "openai" }), applyCommand({ acknowledgement: "I approve" }), applyCommand({ reason: "bad\nreason" }), applyCommand({ reason: "bad\u0085reason" }), applyCommand({ jobId: "invalid" }), applyCommand({ previewSha256: "A".repeat(64) }), applyCommand({ reason: "a".repeat(501) }), command + " ".repeat(8192)]) assert.equal(preview.parsedHoldOperatorCommand(value), null);
  const wide = applyCommand({ reason: "𐀀".repeat(250), supportRef: "𐀀".repeat(250), approvalRef: "𐀀".repeat(250) });
  assert.ok(preview.parsedHoldOperatorCommand(wide));
  assert.equal(preview.parsedHoldOperatorCommand(wide + " ".repeat(6000)), null);
});

test("operator requires matching enabled preview and fresh explicit acknowledgement, sends exact saved bytes once", async t => {
  const f = fixture(t); f.command(applyCommand()); f.acknowledge(); f.apply(); assert.equal(f.requests.length, 0);
  f.enter(); f.inspect(); await tick(); f.command(applyCommand()); f.acknowledge(); f.apply(); assert.equal(f.requests.length, 1, "disabled gate cannot dispatch");
  const enabled = receipt(); enabled.applyEnabled = true; f.reply = async () => Response.json(enabled); f.inspect(); await tick();
  for (const altered of [applyCommand({ jobId: otherJob }), applyCommand({ previewSha256: "b".repeat(64) })]) { f.command(altered); f.acknowledge(); f.apply(); assert.equal(f.requests.length, 2); }
  f.command(applyCommand()); f.apply(); assert.equal(f.requests.length, 2, "editing resets acknowledgement");
  f.acknowledge(); const gate = deferred(); f.reply = () => gate.promise; f.apply(); f.apply();
  assert.equal(f.requests.length, 3); assert.equal(f.requests[2].init.body, applyCommand());
  assert.equal(f.requests[2].init.method, "POST"); assert.equal(f.requests[2].init.credentials, "same-origin"); assert.equal(f.requests[2].init.redirect, "error");
  f.command(applyCommand({ dispositionId: "must-not-change" })); f.decision("must-not-change"); f.enter(otherJob); f.clear();
  gate.resolve(Response.json(applyReceipt())); await tick();
  assert.match(text(f.operator()), /server acknowledged/u); assert.doesNotMatch(text(f.operator()), /must-not-change/u); assert.ok(text(f.operator()).includes(applyCommand()));
  f.apply(); assert.equal(f.requests.length, 3, "acknowledged command cannot be resubmitted");
});

test("normal apply acknowledgement requires separate same-ID GET with exact record digest before next job", async t => {
  const f = await preparedOperator(t); f.reply = async () => Response.json(applyReceipt()); f.apply(); await tick();
  assert.equal(f.requests.length, 2); assert.doesNotMatch(text(f.operator()), /Finish verified decision/u);
  f.reply = async () => Response.json(verification()); f.verify(); f.verify(); await tick();
  assert.equal(f.requests.length, 3); assert.equal(f.requests[2].url, "/api/admin/budget-hold-dispositions?dispositionId=decision-1"); assert.equal(f.requests[2].init.method, "GET"); assert.equal(f.requests[2].init.body, undefined);
  assert.match(text(f.operator()), /Recorded adjustment and current-state checks passed/u);
  const finish = templates(f.operator()).find(value => value.strings.join("").trimStart().startsWith("<button") && text(value).includes("Finish verified decision"));
  handlers(finish, "click")[0](); assert.doesNotMatch(text(f.operator()), /decision-1|"recordSha256"/u);
  f.command(applyCommand({ dispositionId: "decision-2" })); f.acknowledge(); f.apply(); assert.equal(f.requests.length, 3, "next release needs a fresh preview");
});

for (const failure of ["transport", "http-error", "wrong-id", "invalid-json", "private-field"])
test(`post-invocation ${failure} locks the saved command and allows only explicit same-ID verification`, async t => {
  const f = await preparedOperator(t);
  f.reply = async () => {
    if (failure === "transport") throw new Error("PRIVATE_CONNECTION_ERROR");
    if (failure === "http-error") return Response.json({ error: "hold_accounting_write_conflict" }, { status: 409 });
    if (failure === "wrong-id") return Response.json(applyReceipt({ dispositionId: "other-decision" }));
    if (failure === "private-field") return Response.json({ ...applyReceipt(), privateSource: "PRIVATE_SOURCE" });
    return new Response("invalid", { headers: { "content-type": "application/json" } });
  };
  f.apply(); await tick(); assert.match(text(f.operator()), /Submission outcome is unconfirmed/u);
  f.apply(); f.clear(); f.enter(otherJob); f.command(applyCommand({ dispositionId: "other-decision" })); f.decision("other-decision"); f.inspect();
  assert.equal(f.requests.length, 2); assert.doesNotMatch(text(f.operator()), /PRIVATE_CONNECTION_ERROR|PRIVATE_SOURCE|other-decision/u);
  f.reply = async () => Response.json({ error: "hold_disposition_not_found" }, { status: 404 }); f.verify(); await tick();
  assert.equal(f.requests.at(-1).url, "/api/admin/budget-hold-dispositions?dispositionId=decision-1");
  assert.match(text(f.operator()), /hold_disposition_not_found/u); f.apply(); assert.equal(f.requests.length, 3, "404 is not permission to submit again");
  f.reply = async () => Response.json(verification()); f.verify(); await tick();
  assert.match(text(f.operator()), /no acknowledged apply digest/u); assert.doesNotMatch(text(f.operator()), /Finish verified decision/u);
  f.apply(); assert.equal(f.requests.length, 4);
});

test("a refusal before invocation does not claim submission and requires renewed acknowledgement", async t => {
  const f = await preparedOperator(t); f.rejectBeforeInvoke = true; f.apply(); await tick();
  assert.equal(f.requests.length, 1); assert.match(text(f.operator()), /request was not submitted/u);
  f.rejectBeforeInvoke = false; f.reply = async () => Response.json(applyReceipt()); f.apply(); assert.equal(f.requests.length, 1);
  f.acknowledge(); f.apply(); await tick(); assert.equal(f.requests.length, 2);
});

test("independent verification is usable after reload with no command, no preview and disabled adjustments", async t => {
  const f = fixture(t); f.decision("decision-1"); f.reply = async () => Response.json(verification()); f.verify(); await tick();
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].init.method, "GET");
  assert.match(text(f.operator()), /no acknowledged apply digest/u); assert.ok(text(f.operator()).includes(JSON.stringify(verification())));
  f.decision("decision-2"); assert.doesNotMatch(text(f.operator()), /"recordSha256"|200/u);
});

for (const phase of ["apply", "verify"])
for (const boundary of ["role-aba", "policy", "principal", "route", "project", "impersonation", "disconnect"])
test(`${phase} retires private command/receipts and discards a late response at ${boundary}`, async t => {
  const f = await preparedOperator(t);
  if (phase === "verify") { f.reply = async () => Response.json(applyReceipt()); f.apply(); await tick(); }
  const gate = deferred(); f.reply = () => gate.promise; if (phase === "apply") f.apply(); else f.verify();
  const signal = f.requests.at(-1).init.signal;
  if (boundary === "role-aba") { f.session.user.role = "creator"; f.notify(); f.session.user.role = "admin"; }
  if (boundary === "policy") f.session.policy.version = "policy-2";
  if (boundary === "principal") f.session.user.userId = "other-owner";
  if (boundary === "route") f.route = "/projects";
  if (boundary === "project") f.session.projectContext = {};
  if (boundary === "impersonation") f.session.impersonation = {};
  if (boundary === "disconnect") { f.host.isConnected = false; f.host.disconnectedCallback(); }
  f.notify(); assert.equal(signal.aborted, true);
  gate.resolve(Response.json(phase === "apply" ? applyReceipt() : verification())); await tick();
  assert.doesNotMatch(text(f.host.render()), /external-approval|"recordSha256"|decision-1/u);
  assert.equal(f.requests.length, phase === "apply" ? 2 : 3);
});

test("apply and verification validators reject mismatched IDs, digests, verdicts and added private fields", () => {
  assert.equal(preview.validateHoldApplyResponse(applyReceipt(), "decision-1"), true);
  for (const value of [applyReceipt({ replayed: true }), applyReceipt({ dispositionId: "other" }), applyReceipt({ recordSha256: "no-hash" }), { ...applyReceipt(), private: "PRIVATE" }]) assert.equal(preview.validateHoldApplyResponse(value, "decision-1"), false);
  assert.equal(preview.validateHoldVerificationResponse(verification(), "decision-1", "owner-1", "d".repeat(64)), true);
  assert.equal(preview.validateHoldVerificationResponse(verification(), "decision-1", "owner-1", "e".repeat(64)), false);
  for (const mutate of [value => { value.privateSource = "PRIVATE"; }, value => { value.checks.identity = false; }, value => { value.requiresReview = ["identity"]; }, value => { value.transactionVerified = false; }, value => { value.currentCounters.tokens[0].scope_id = "other"; }, value => { value.currentCounters.tokens[0].period = "2026-08"; }, value => { value.currentCounters.tokens[0].ledger_reserved++; }, value => { value.currentCounters.tokens[0].source = "PRIVATE"; }]) { const value = verification(); mutate(value); assert.equal(preview.validateHoldVerificationResponse(value, "decision-1", "owner-1"), false); }
  const negative = verification(); negative.checks.settledCountersUnchanged = false; negative.verified = false; negative.requiresReview = ["settledCountersUnchanged"];
  assert.equal(preview.validateHoldVerificationResponse(negative, "decision-1", "owner-1"), true, "failed live checks remain inspectable");
});

test("a valid but failed independent check or mismatched receipt hash never enables the next release", async t => {
  const f = await preparedOperator(t); f.reply = async () => Response.json(applyReceipt()); f.apply(); await tick();
  const negative = verification(); negative.checks.settledCountersUnchanged = false; negative.verified = false; negative.requiresReview = ["settledCountersUnchanged"];
  f.reply = async () => Response.json(negative); f.verify(); await tick(); assert.match(text(f.operator()), /requires review/u); assert.doesNotMatch(text(f.operator()), /Finish verified decision/u);
  f.reply = async () => Response.json(verification({ recordSha256: "e".repeat(64) })); f.verify(); await tick();
  assert.match(text(f.operator()), /Verification is unavailable/u); assert.doesNotMatch(text(f.operator()), /Finish verified decision/u); f.apply(); assert.equal(f.requests.length, 4);
});

test("explicit verification stays usable while an unrelated read-only preview is still loading", async t => {
  const f = fixture(t), old = deferred(); f.enter(); f.reply = () => old.promise; f.inspect();
  f.decision("decision-1"); f.reply = async () => Response.json(verification()); f.verify(); await tick();
  assert.equal(f.requests.length, 2); assert.equal(f.requests[1].init.method, "GET");
  assert.match(text(f.operator()), /no acknowledged apply digest/u);
  old.resolve(Response.json(receipt())); await tick(); assert.match(text(f.operator()), /no acknowledged apply digest/u);
});

test("a retained Next handler cannot keep verified private state after authority changes", async t => {
  const f = await preparedOperator(t); f.reply = async () => Response.json(applyReceipt()); f.apply(); await tick();
  f.reply = async () => Response.json(verification()); f.verify(); await tick();
  const next = templates(f.operator()).find(value => value.strings.join("").trimStart().startsWith("<button") && text(value).includes("Finish verified decision"));
  const click = handlers(next, "click")[0]; f.session.user.role = "creator"; click();
  f.session.user.role = "admin"; f.notify(); assert.doesNotMatch(text(f.host.render()), /decision-1|external-approval|"recordSha256"/u); assert.equal(f.requests.length, 3);
});

for (const phase of ["awaiting-response", "reading-body"])
test(`apply timeout ${phase} preserves the same saved command and never repeats it`, async t => {
  const f = await preparedOperator(t); let expire;
  t.mock.method(globalThis, "setTimeout", callback => { expire = callback; return 1; });
  t.mock.method(globalThis, "clearTimeout", () => {});
  f.reply = async () => {
    const signal = f.requests.at(-1).init.signal;
    if (phase === "awaiting-response") return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
    return new Response(new ReadableStream({ start(controller) { signal.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError"))); } }), { headers: { "content-type": "application/json" } });
  };
  f.apply(); await tick(); expire(); await tick();
  assert.match(text(f.operator()), /Submission outcome is unconfirmed/u); assert.ok(text(f.operator()).includes(applyCommand()));
  f.apply(); f.clear(); assert.equal(f.requests.length, 2);
});

test("actual settings denies non-admin, unconsented, impersonated, project and missing-authority contexts", t => {
  const f = fixture(t);
  for (const mutate of [() => { f.session.user.role = "creator"; }, () => { f.session.policy.accepted = false; }, () => { f.session.impersonation = {}; }, () => { f.session.projectContext = {}; }, () => { f.scope.shared = true; }, () => { f.scope = null; }, () => { f.session = null; }]) {
    const original = structuredClone({ session: f.session, scope: f.scope }); mutate(); assert.equal(f.section(), undefined); f.session = original.session; f.scope = original.scope;
  }
  assert.equal(f.requests.length, 0);
});

for (const boundary of ["job", "route", "role", "policy", "consent", "account", "epoch", "project", "shared", "impersonation", "auth-event", "disconnect"])
test(`actual settings retires completed and in-flight receipts at ${boundary}`, async t => {
  const f = fixture(t); f.enter(); f.inspect(); await tick(); assert.match(text(f.section()), /token-1/u);
  const old = deferred(); f.reply = () => old.promise; f.inspect(); const signal = f.requests.at(-1).init.signal;
  if (boundary === "job") f.enter(otherJob);
  if (boundary === "route") f.route = "/projects";
  if (boundary === "role") f.session.user.role = "creator";
  if (boundary === "policy") f.session.policy.version = "policy-2";
  if (boundary === "consent") f.session.policy.accepted = false;
  if (boundary === "account") f.session.user.userId = "owner-2";
  if (boundary === "epoch") f.scope = { ...f.scope, key: "scope-2" };
  if (boundary === "project") f.projectId = "source-project-2";
  if (boundary === "shared") f.session.projectContext = {};
  if (boundary === "impersonation") f.session.impersonation = {};
  if (boundary === "auth-event") for (const listener of listeners) listener();
  if (boundary === "disconnect") { f.host.isConnected = false; f.host.disconnectedCallback(); }
  f.notify(); assert.equal(signal.aborted, true); old.resolve(Response.json(receipt())); await tick();
  assert.doesNotMatch(text(f.host.render()), /token-1|"releaseTokens"/u); assert.equal(f.requests.length, 2);
});

test("exact server denial is visible, unexpected bodies and late failures never replace a newer receipt", async t => {
  const f = fixture(t); f.enter(); f.reply = async () => Response.json({ error: "hold_principal_administrator_required" }, { status: 403 }); f.inspect(); await tick();
  assert.match(text(f.section()), /hold_principal_administrator_required/u); assert.match(text(f.section()), /403/u);
  f.reply = async () => Response.json({ ...receipt(), privateSource: "PRIVATE_SOURCE" }); f.inspect(); await tick();
  assert.match(text(f.section()), /did not match/u); assert.doesNotMatch(text(f.section()), /PRIVATE_SOURCE|token-1/u);
  const old = deferred(); f.reply = () => old.promise; f.inspect(); f.enter(otherJob); f.enter(jobId);
  const current = receipt(); current.preview.previewSha256 = "b".repeat(64); current.applyEnabled = true;
  f.reply = async () => Response.json(current); f.inspect(); await tick();
  old.reject(new Error("PRIVATE_OLD_ERROR")); await tick();
  assert.match(text(f.section()), /Adjustments are enabled on the server/u); assert.ok(text(f.section()).includes("b".repeat(64))); assert.doesNotMatch(text(f.section()), /PRIVATE_OLD_ERROR/u);
});

test("a denied role or policy cannot revive a receipt when authority returns before the next render", async t => {
  const f = fixture(t); f.enter(); f.inspect(); await tick(); assert.match(text(f.section()), /token-1/u);
  f.session.user.role = "creator"; f.notify(); f.session.user.role = "admin"; f.notify();
  assert.doesNotMatch(text(f.section()), /token-1/u);
  f.enter(); const old = deferred(); f.reply = () => old.promise; f.inspect();
  f.session.policy.accepted = false; f.notify(); f.session.policy.accepted = true; f.notify();
  old.resolve(Response.json(receipt())); await tick();
  assert.doesNotMatch(text(f.section()), /token-1/u); assert.equal(f.requests.at(-1).init.signal.aborted, true);
});

test("authority lost while decoding an already-returned body discards every private response field", async t => {
  const f = fixture(t); let stream;
  f.reply = async () => new Response(new ReadableStream({ start(controller) { stream = controller; } }), { headers: { "content-type": "application/json" } });
  f.enter(); f.inspect(); await tick();
  f.session.user.userId = "owner-2"; f.notify();
  stream.enqueue(new TextEncoder().encode(JSON.stringify(receipt()))); stream.close(); await tick();
  assert.doesNotMatch(text(f.section()), /token-1|"releaseTokens"/u); assert.equal(f.requests.length, 1);
});

test("response validation binds owner, job, original period and counters and rejects added source fields", () => {
  assert.equal(preview.validateHoldPreviewResponse(receipt(), jobId, "owner-1"), true);
  for (const mutate of [value => { value.preview.jobId = otherJob; }, value => { value.preview.ownerId = "other"; }, value => { value.preview.schemaVerified = false; }, value => { value.preview.providerCalls = 1; }, value => { value.preview.counters.tokens[0].period = "2026-08"; }, value => { value.preview.counters.tokens[1].scope_id = "other"; }, value => { value.preview.counters.dollars[0].reserved_microusd = 1; }, value => { value.preview.counters.tokens[0].source = "PRIVATE"; }, value => { value.preview.warning = "PRIVATE"; }]) {
    const value = receipt(); mutate(value); assert.equal(preview.validateHoldPreviewResponse(value, jobId, "owner-1"), false);
  }
});

test("wire reader rejects HTML and cancels oversized JSON", async () => {
  await assert.rejects(preview.readHoldPreviewBody(new Response("<h1>Sign in</h1>", { headers: { "content-type": "text/html" } })));
  let canceled = false;
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(65537)); }, cancel() { canceled = true; } });
  await assert.rejects(preview.readHoldPreviewBody(new Response(body, { headers: { "content-type": "application/json" } })));
  assert.equal(canceled, true);
});

for (const cancellation of ["never settles", "rejects"]) {
  test(`oversized JSON rejects promptly when cancellation ${cancellation}`, { timeout: 1000 }, async () => {
    let canceled = false;
    const body = new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(65537)); },
      cancel() {
        canceled = true;
        return cancellation === "never settles" ? new Promise(() => {}) : Promise.reject(new Error("cancel failed"));
      },
    });
    await assert.rejects(preview.readHoldPreviewBody(new Response(body, { headers: { "content-type": "application/json" } })), /hold_preview_response_invalid/u);
    assert.equal(canceled, true);
    assert.equal(body.locked, false);
  });
}

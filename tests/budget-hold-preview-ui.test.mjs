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
    guardedFetch(url, init, _action, controls) { assert.equal(controls.current(), true); f.requests.push({ url, init }); return f.reply(); } };
  f.i18n = { locale: "en", system: value => value, number: String, plural: () => "", t: (key, fallback) => FORMA_BUDGET_HOLD_PREVIEW_MESSAGES.en[key] ?? fallback ?? key };
  active = f; f.host = new exports.FormaAccountSettings(); f.host.connectedCallback();
  f.section = () => templates(f.host.render()).find(value => value.strings.join("").includes('class="settings-hold-preview"'));
  f.enter = (value = jobId) => handlers(f.section(), "input")[0]({ currentTarget: { value } });
  f.inspect = () => handlers(f.section(), "click")[0]();
  f.clear = () => handlers(f.section(), "click")[1]();
  f.notify = () => { for (const callback of subscriptions) callback(); };
  t.after(() => { f.host.isConnected = false; f.host.disconnectedCallback(); assert.equal(subscriptions.size, 0); assert.equal(listeners.size, 0); });
  return f;
}

test("actual settings sends one exact explicit preview, exposes exact receipt and no apply action", async t => {
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

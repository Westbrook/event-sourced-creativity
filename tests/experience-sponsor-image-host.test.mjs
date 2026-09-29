import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { ExperienceHostOperation } from "../src/experiences/host-operation.ts";
import { ExperienceHostSourceLifetime } from "../src/experiences/host-source-lifetime.ts";
import { parseExperienceHostRoute } from "../src/experiences/host-route.ts";
import { experienceImageFormat } from "../src/experiences/image-ratio.ts";

// Execute the complete current component class. Only imports are supplied as
// deterministic ports, and private identifiers are mechanically renamed to
// permit state inspection. Sponsor methods and lifecycle branches are unchanged;
// the pre-existing ordinary network reader is a sentinel port below.
// These are component control tests, not browser rendering or server proof.
const source = readFileSync(process.env.FORMA_SPONSOR_HOST_CANDIDATE_SOURCE ?? new URL("../src/components/forma-experience-host.ts", import.meta.url), "utf8");
const parsed = ts.createSourceFile("host.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const declaration = parsed.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "FormaExperienceHost");
assert.ok(declaration);
const transformed = ts.transform(declaration, [context => function visit(node) {
  return ts.isPrivateIdentifier(node) ? context.factory.createIdentifier("_" + node.text.slice(1)) : ts.visitEachChild(node, visit, context);
}]);
const printed = ts.createPrinter().printNode(ts.EmitHint.Unspecified, transformed.transformed[0], parsed);
transformed.dispose();
const compiled = ts.transpileModule(printed, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace("export class FormaExperienceHost", "class FormaExperienceHost");
const draftId = "experience-draft-" + "a".repeat(64), documentId = "document-1", actor = "owner";
const route = `/document/${documentId}/image?experience=image&experience-draft=${draftId}`;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const text = value => value == null || typeof value === "function" ? "" : typeof value === "object" ? Array.isArray(value) ? value.map(text).join("") : value.parts.map((part, index) => part + text(value.values[index])).join("") : String(value);

function harness({ ordinary = false, descriptorActor = actor, gate, blockedStage, failStage } = {}) {
  const log = [], sessions = [], listeners = new Map(), windowListeners = new Map(), subscriptions = new Set(), observers = [];
  const plan = { draftId, draftHash: "original", documentId, projectId: "project-1", streamId: `creative:${actor}`, title: "Image",
    release: { output: { output: "image" } }, request: { values: { ratio: { value: { width: 1, height: 1 } } } } };
  let currentRoute = route, sourceActive = true, authorizationActive = true, sourceCurrent = true;
  const principal = { user: { userId: actor, role: "creator" }, policy: { accepted: true } };
  const projection = { documentId, projectId: plan.projectId, documents: [{ id: documentId, projectId: plan.projectId, title: "Image", removed: false }] };
  const store = { route: { get: () => currentRoute }, session: { get: () => principal }, projection: { get: () => projection },
    captureSourceOwnership: () => "source", captureAuthorizationScope: () => "authorization", sourceOwnershipActive: () => sourceActive,
    authorizationScopeActive: () => authorizationActive, documentRouteState: () => "ready", routeDataReady: () => true,
    asOf: { get: () => Infinity }, experienceDocumentSourceCurrent: (id, revision) => sourceCurrent && id === documentId && revision === "revision",
    documentGenerationRevision: () => "revision", subscribe: listener => { subscriptions.add(listener); return () => subscriptions.delete(listener); },
    attentionPublication: { hold: () => () => {} }, refreshEvents() { throw new Error("unexpected Events GET"); } };
  const window = { addEventListener: (name, listener) => windowListeners.set(name, listener), removeEventListener: name => windowListeners.delete(name) };
  const ownerDocument = { visibilityState: "visible", location: { origin: "https://forma.example" }, defaultView: window, activeElement: null,
    addEventListener: (name, listener) => listeners.set(name, listener), removeEventListener: name => listeners.delete(name) };
  const privateNode = { clears: 0, replaceChildren() { this.clears++; } };
  class Element {
    store = store; ownerDocument = ownerDocument; isConnected = true; parentElement = null; hiddenAncestor = false;
    updates = 0; i18n = { system: value => value };
    connectedCallback() {} disconnectedCallback() {} updated() {} requestUpdate() { this.updates++; }
    addEventListener() {} removeEventListener() {} closest() { return this.hiddenAncestor ? {} : null; }
    querySelectorAll(selector) { return selector === "[data-sponsor-image-private]" ? [privateNode] : []; }
  }
  class Observer { constructor(callback) { this.callback = callback; observers.push(this); } observe() {} disconnect() { this.disconnected = true; } }
  const factory = (selector, fetcher, options) => {
    assert.deepEqual(selector, { draftId }); assert.equal(typeof fetcher, "function"); assert.ok(options.signal instanceof AbortSignal);
    const controller = new AbortController();
    const runtime = { committedPlan: plan, receipt: { original: true }, state: { phase: "complete" }, dispose() { log.push("runtime-dispose"); } };
    const session = { signal: controller.signal, mode: null, runtime, pending: false, disposed: 0,
      confirmationState: { confirmation: { status: "unconfirmed" } },
      async stage(name) { log.push(name); if (name === blockedStage) await gate.promise; if (name === failStage) throw new Error("unavailable"); },
      async resolveMode() { await this.stage("mode"); return this.mode = { version: 1, mode: ordinary ? "ordinary" : "sponsor-image", actorUserId: descriptorActor, selector }; },
      async openSponsor() { await this.stage("open"); return { runtime, bootstrap: {} }; },
      async readConfirmation() { await this.stage("read"); return this.confirmationState.confirmation; },
      async confirm(action) { assert.deepEqual(action, { explicitRequirementsConfirmation: true }); await this.stage("confirm"); this.confirmationState.confirmation = { status: "confirmed" }; },
      dispose() { if (this.disposed++) return; log.push("dispose"); controller.abort(); } };
    options.signal.addEventListener("abort", () => session.dispose(), { once: true }); sessions.push(session); return session;
  };
  class OrdinaryRuntime {
    constructor() { log.push("ordinary-runtime"); this.committedPlan = plan; this.receipt = {}; this.state = { phase: "complete" }; }
    async resume() { log.push("ordinary-resume"); } dispose() { log.push("ordinary-dispose"); }
  }
  class OrdinaryClient { constructor() { log.push("ordinary-client"); this.state = { draftId, status: "absent" }; } dispose() {} }
  const ports = { FormaElement: Element, createSponsorImageHostSession: factory, ExperienceHostOperation, ExperienceHostSourceLifetime,
    parseExperienceHostRoute, experienceImageFormat, OutputDirectActivationLatch: class { clear() {} }, MutationObserver: Observer,
    registeredExperience: async () => { log.push("ordinary-release"); return plan.release; }, ExperienceIntakeRuntime: OrdinaryRuntime,
    ExperienceOutputBindingClient: OrdinaryClient, html: (parts, ...values) => ({ parts, values }), nothing: "", keyed: (_key, value) => value };
  const Host = new Function(...Object.keys(ports), compiled + ";return FormaExperienceHost;")(...Object.values(ports));
  const host = new Host();
  // The pre-existing ordinary read is a port boundary; if chosen, count it and
  // avoid making actual store/network reads in a component control test.
  host._refreshAndRead = async () => { log.push("ordinary-refresh"); }; host._scheduleResultRead = () => {};
  return { host, log, sessions, principal, projection, privateNode, listeners, windowListeners, subscriptions, observers,
    publish() { for (const listener of subscriptions) listener(); },
    drift(kind) { if (kind === "route") currentRoute += "&other=1"; if (kind === "source") sourceActive = false;
      if (kind === "authorization") authorizationActive = false; if (kind === "revision") sourceCurrent = false;
      if (kind === "actor") principal.user.userId = "different"; if (kind === "document") projection.documentId = "different";
      if (kind === "title") projection.documents[0].title = "different"; if (kind === "project") projection.projectId = "different";
      if (kind === "impersonation") principal.impersonation = {}; if (kind === "project-context") principal.projectContext = {}; }
  };
}

test("actual host mounts sponsor by passive mode, original bootstrap and confirmation only", async () => {
  const h = harness(); await h.host._load();
  assert.deepEqual(h.log, ["mode", "open", "read"]);
  assert.equal(h.host._binding, undefined); assert.equal(h.host._runtime, undefined); assert.equal(h.host._result, undefined);
  assert.equal(h.host._loading, false); assert.equal(h.host._sponsorVisible(), true);
  const view = text(h.host.render()); assert.match(view, /Sponsored Image/); assert.match(view, /sponsor-confirm/);
  assert.doesNotMatch(view, /data-experience-action="(?:run|authorize|prepare|recoverResult)"|Create image|selected-output-share/);
  h.host._retire();
});

test("ordinary Image selection disposes metadata session then retains its original runtime and binding branch", async () => {
  const h = harness({ ordinary: true }); await h.host._load();
  assert.deepEqual(h.log, ["mode", "dispose", "ordinary-release", "ordinary-runtime", "ordinary-resume", "ordinary-client", "ordinary-refresh"]);
  assert.equal(h.host._sponsor, undefined); assert.equal(h.host._sponsorAbort, undefined); assert.equal(h.host._sponsorMode, false);
  assert.ok(h.host._binding); h.host._retire();
});

for (const failure of ["actor", "mode", "open", "read"]) test(`sponsor ${failure} refusal never falls through to ordinary reads`, async () => {
  const h = harness(failure === "actor" ? { descriptorActor: "different" } : { failStage: failure }); await h.host._load();
  assert.equal(h.host._sponsor, undefined); assert.ok(h.sessions[0].signal.aborted);
  assert.ok(h.log.every(value => !value.startsWith("ordinary"))); assert.equal(h.host._status, "Document unavailable");
});

for (const kind of ["route", "source", "authorization", "revision", "actor", "document", "title", "project", "impersonation", "project-context"]) test(`actual sponsor custody withdraws ${kind} drift and private presentation`, async () => {
  const h = harness(); await h.host._load(); h.drift(kind); h.host._sponsorSync();
  assert.equal(h.host._sponsor, undefined); assert.equal(h.host._retired, true); assert.ok(h.sessions[0].signal.aborted);
  assert.ok(h.privateNode.clears); assert.doesNotMatch(text(h.host.render()), /Sponsored Image|sponsor-confirm/);
});

for (const stage of ["mode", "open", "read"]) test(`hide during ${stage} aborts captured client and refuses its late completion`, async () => {
  const gate = deferred(), h = harness({ gate, blockedStage: stage }), loading = h.host._load();
  while (!h.log.includes(stage)) await tick();
  h.host.ownerDocument.visibilityState = "hidden"; h.host._visibility(); await loading;
  assert.equal(h.host._sponsor, undefined); assert.ok(h.sessions[0].signal.aborted);
  gate.resolve(); await tick(); assert.equal(h.host._sponsor, undefined);
  assert.ok(h.log.every(value => !value.startsWith("ordinary"))); assert.equal(h.host._initialReadSuspended, true);
  h.host._retire();
});

test("confirmation requires trusted deliberate action and never retries or starts generation", async () => {
  const h = harness(); await h.host._load(); const event = { isTrusted: true, preventDefault() {} };
  await h.host._confirmSponsor(event); assert.equal(h.log.includes("confirm"), false);
  h.host._confirmed = true; await h.host._confirmSponsor({ ...event, isTrusted: false }); assert.equal(h.log.includes("confirm"), false);
  await h.host._confirmSponsor(event); assert.equal(h.log.filter(value => value === "confirm").length, 1);
  h.host._confirmed = true; await h.host._confirmSponsor(event); assert.equal(h.log.filter(value => value === "confirm").length, 1);
  assert.equal(h.host._status, "Output confirmed · Generation unavailable"); h.host._retire();
});

test("BFCache suspension disposes original session and resumes with fresh passive GETs", async () => {
  const h = harness(); await h.host._load(); h.host._pagehide({ persisted: true });
  assert.equal(h.host._retired, false); assert.ok(h.sessions[0].signal.aborted); assert.equal(h.host._sponsor, undefined);
  h.host._pageshow({ persisted: true }); await tick();
  assert.equal(h.sessions.length, 2); assert.deepEqual(h.log, ["mode", "open", "read", "dispose", "mode", "open", "read"]);
  assert.equal(h.log.includes("confirm"), false); h.host._retire();
});

test("connected observer and store listeners retire hidden or revoked sponsor state and unregister on disconnect", async () => {
  const h = harness(); h.host.connectedCallback(); await tick();
  assert.equal(h.observers.length, 1); assert.ok(h.subscriptions.size);
  h.host.hiddenAncestor = true; h.observers[0].callback(); assert.ok(h.sessions[0].signal.aborted); assert.equal(h.host._sponsor, undefined);
  h.host.hiddenAncestor = false; h.observers[0].callback(); await tick(); assert.equal(h.sessions.length, 2);
  h.windowListeners.get("forma-authorization-changed")(); assert.equal(h.host._retired, true);
  h.host.disconnectedCallback(); assert.equal(h.observers[0].disconnected, true); assert.equal(h.subscriptions.size, 0);
});

test("initially inert Image resumes when its ancestor becomes available", async () => {
  const h = harness(); h.host.hiddenAncestor = true; h.host.connectedCallback(); await tick(); assert.equal(h.sessions.length, 0);
  h.host.hiddenAncestor = false; h.observers[0].callback(); await tick();
  assert.equal(h.sessions.length, 1); h.host._retire();
});

for (const stage of ["mode", "open", "read"]) test(`actor changes during ${stage} reject the late response`, async () => {
  const gate = deferred(), h = harness({ gate, blockedStage: stage }), loading = h.host._load();
  while (!h.log.includes(stage)) await tick();
  h.drift("actor"); gate.resolve(); await loading;
  assert.equal(h.host._sponsor, undefined); assert.ok(h.sessions[0].signal.aborted);
  assert.ok(h.log.every(value => !value.startsWith("ordinary")));
});

for (const stage of ["open", "read"]) test(`original ${stage} plan Document mismatch refuses private presentation`, async () => {
  const gate = deferred(), h = harness({ gate, blockedStage: stage }), loading = h.host._load();
  while (!h.log.includes(stage)) await tick();
  h.sessions[0].runtime.committedPlan.documentId = "another-document"; gate.resolve(); await loading;
  assert.equal(h.host._sponsor, undefined); assert.ok(h.sessions[0].signal.aborted);
  assert.ok(h.log.every(value => !value.startsWith("ordinary")));
});

test("hide during explicit confirmation withdraws UI and never replays POST on reopen", async () => {
  const gate = deferred(), h = harness({ gate, blockedStage: "confirm" }); await h.host._load();
  h.host._confirmed = true;
  const confirming = h.host._confirmSponsor({ isTrusted: true, preventDefault() {} });
  while (!h.log.includes("confirm")) await tick();
  h.host.ownerDocument.visibilityState = "hidden"; h.host._visibility(); await confirming;
  assert.equal(h.host._sponsor, undefined); assert.ok(h.sessions[0].signal.aborted);
  gate.resolve(); await tick();
  h.host.ownerDocument.visibilityState = "visible"; h.host._visibility(); await tick();
  assert.equal(h.sessions.length, 2); assert.equal(h.log.filter(value => value === "confirm").length, 1);
  assert.equal(h.host._status, "Confirm output"); h.host._retire();
});

test("ordinary page departure retires sponsor permanently without a reopen", async () => {
  const h = harness(); await h.host._load(); h.host._pagehide({ persisted: false });
  assert.equal(h.host._retired, true); assert.ok(h.sessions[0].signal.aborted); assert.equal(h.host._sponsor, undefined);
  h.host._pageshow({ persisted: true }); await tick(); assert.equal(h.sessions.length, 1);
});


test("initial hidden Image preserves a passive resume across BFCache before mode discovery", async () => {
  const h = harness(); h.host.ownerDocument.visibilityState = "hidden"; await h.host._load();
  assert.equal(h.sessions.length, 0); h.host._pagehide({ persisted: true });
  assert.equal(h.host._retired, false);
  h.host.ownerDocument.visibilityState = "visible"; h.host._pageshow({ persisted: true }); await tick();
  assert.equal(h.sessions.length, 1); assert.deepEqual(h.log, ["mode", "open", "read"]); h.host._retire();
});


test("persisted pagehide blocks real update-hook reopening until pageshow", async t => {
  const h = harness(); t.after(() => h.host._retire()); await h.host._load();
  h.host._pagehide({ persisted: true });
  assert.equal(h.host.ownerDocument.visibilityState, "visible", "pagehide need not change document visibility first");
  assert.equal(h.host._sponsor, undefined); assert.ok(h.sessions[0].signal.aborted);
  h.host.willUpdate(); await tick();
  assert.equal(h.sessions.length, 1, "the actual willUpdate hook must not reopen before pageshow");
  h.host._visibility(); h.host._resumeObservation(); h.host._sponsorVisibilityChanged(); await tick();
  assert.equal(h.sessions.length, 1, "visibility, online and ancestor signals cannot clear pagehide");
  h.host._pageshow({ persisted: true }); await tick();
  assert.equal(h.sessions.length, 2); assert.deepEqual(h.log, ["mode", "open", "read", "dispose", "mode", "open", "read"]);
  assert.equal(h.log.includes("confirm"), false);
});


for (const stage of ["mode", "open", "read"]) test(`pagehide during ${stage} keeps late responses closed through actual update hooks`, async t => {
  const gate = deferred(), h = harness({ gate, blockedStage: stage }); t.after(() => h.host._retire());
  const loading = h.host._load(); while (!h.log.includes(stage)) await tick();
  h.host._pagehide({ persisted: true }); await loading;
  h.host.willUpdate(); await tick(); assert.equal(h.sessions.length, 1);
  gate.resolve(); await tick(); h.host.willUpdate(); await tick();
  assert.equal(h.sessions.length, 1); assert.equal(h.host._sponsor, undefined); assert.ok(h.sessions[0].signal.aborted);
  assert.equal(h.host._pageHidden, true); assert.equal(h.host._retired, false);
  h.host._pageshow({ persisted: true }); await tick();
  assert.equal(h.host._pageHidden, false); assert.equal(h.sessions.length, 2); assert.equal(h.host._sponsorVisible(), true);
  assert.equal(h.log.includes("confirm"), false);
});

test("initial suspended Image update hooks and direct load stay closed until pageshow", async t => {
  const h = harness(); t.after(() => h.host._retire());
  h.host.ownerDocument.visibilityState = "hidden"; await h.host._load(); h.host._pagehide({ persisted: true });
  h.host.ownerDocument.visibilityState = "visible"; h.host.willUpdate(); await h.host._load();
  h.host._visibility(); h.host._resumeObservation(); await tick();
  assert.equal(h.sessions.length, 0); assert.equal(h.host._pageHidden, true);
  h.host._pageshow({ persisted: true }); await tick(); assert.equal(h.sessions.length, 1);
});

test("pageshow while document remains hidden waits for visibility before passive reopen", async t => {
  const h = harness(); t.after(() => h.host._retire()); await h.host._load();
  h.host._pagehide({ persisted: true }); h.host.ownerDocument.visibilityState = "hidden";
  h.host._pageshow({ persisted: true }); h.host.willUpdate(); await tick();
  assert.equal(h.sessions.length, 1); assert.equal(h.host._pageHidden, false);
  h.host.ownerDocument.visibilityState = "visible"; h.host._visibility(); await tick();
  assert.equal(h.sessions.length, 2); assert.equal(h.log.includes("confirm"), false);
});

// UNIT BOUNDARY ONLY. Executes the actual AST-transpiled controller and actual
// activation latch. DOM classes, event records (including isTrusted), transient
// activation, task scheduling, snapshots, and store responses are explicitly fake.
// No real browser, native keyboard/pointer/AT event, account, API, provider, or
// billing authority is exercised. Supplied true event fields are test inputs,
// never an attempt to forge an event or bypass a guard in the application.
import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(process.env.FORMA_OUTPUT_REGRESSION_ROOT || fileURLToPath(new URL("../", import.meta.url)));
const { binding, controllerFixture, eventHandlers, handler, loadController, region, submitEvent, templates } = await import(pathToFileURL(resolve(root, "tests/output-ui-source-harness.mjs")));
const { OUTPUT_NATIVE_EXECUTION_POLICY } = await import(pathToFileURL(resolve(root, "src/model/output-execution-policy.ts")));

const limits = () => ({ maximumMicrousd: 100_000, maximumCalls: 2, usedMicrousd: 0, usedCalls: 0, exposedMicrousd: 0, pendingCalls: 0 });
function offeredPreflight(snapshot) {
  return { id: "synthetic-preflight", termsDigest: "synthetic-terms", planRevisionId: snapshot.confirmedPlan.revisionId,
    sourceDigest: snapshot.sourceRevision, requirementsDigest: snapshot.requirementRevision,
    maximumMicrousd: 100_000, maximumCalls: 2, createdAt: "2026-08-27T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z",
    operationAttempts: { [snapshot.confirmedPlan.plan.targets[0].id]: { ordinal: 0, previousSlotId: null } },
    targets: [{ targetId: snapshot.confirmedPlan.plan.targets[0].id, available: true,
      provider: "SYNTHETIC-NO-PROVIDER", model: "synthetic-model", route: "synthetic-route", ...limits(),
      reasonCode: "output_native_image_ready", transferCode: "output_transfer_document_after_authorization",
      settings: { executionPolicy: OUTPUT_NATIVE_EXECUTION_POLICY } }] };
}
function authorizedGrant(snapshot, disclosure) {
  return { id: "synthetic-grant", planRevisionId: snapshot.confirmedPlan.revisionId,
    actorUserId: snapshot.scope.actorUserId, payerUserId: snapshot.scope.actorUserId,
    status: "authorized", expiresAt: "2099-01-01T00:00:00.000Z", ...limits(), disclosure: structuredClone(disclosure),
    operations: [{ id: "synthetic-slot", jobId: "synthetic-job", targetId: snapshot.confirmedPlan.plan.targets[0].id,
      status: "authorized", ...limits() }] };
}

async function fixture({ readyGrant = false } = {}) {
  const f = await controllerFixture();
  const requests = [];
  const scheduled = [];
  const activation = { isActive: true };
  const scope = { key: "fixture-actor:project:1" };
  const effects = { syncCalls: 0, preventedSubmits: 0 };
  const initial = f.snapshots.get("doc-a");
  const preflight = offeredPreflight(initial);
  if (readyGrant) initial.grants = [authorizedGrant(initial, preflight)];
  f.store.captureAuthorizationScope = () => ({ key: scope.key, shared: false });
  f.store.authorizationScopeActive = (captured) => captured?.key === scope.key;
  f.store.syncDocumentJobs = async () => { effects.syncCalls += 1; };
  f.store.outputRequirementCommand = async (command) => {
    requests.push(structuredClone(command));
    const snapshot = structuredClone(f.snapshots.get(command.documentId));
    let result;
    if (command.action === "preflight") result = { preflight: structuredClone(preflight) };
    else if (command.action === "authorize") {
      snapshot.grants = [authorizedGrant(snapshot, preflight)];
      snapshot.revision = "2";
      f.snapshots.set(command.documentId, snapshot);
      result = { grantId: "synthetic-grant" };
    } else if (command.action === "run") result = { grantId: command.grantId };
    else throw new Error(`Unexpected synthetic command: ${command.action}`);
    return { status: "saved", body: { snapshot, command: result } };
  };
  class FakeButton {
    constructor(form) { this.form = form; this.type = "submit"; this.disabled = false; }
  }
  class Base {
    constructor() { this.store = f.store; this.isConnected = true; this.updateComplete = Promise.resolve(); this.i18n = f.controller.i18n; }
    requestUpdate() {}
    connectedCallback() { this.isConnected = true; }
    disconnectedCallback() { this.isConnected = false; }
    querySelector() { return null; }
  }
  const Controller = await loadController(Base, {
    HTMLButtonElement: FakeButton,
    navigator: { userActivation: activation },
    setTimeout: (callback, milliseconds) => { scheduled.push({ callback, milliseconds }); return scheduled.length; },
  });
  const controller = new Controller();
  controller.documentId = "doc-a"; controller.surface = "deliver";
  controller.willUpdate(new Map());

  const paidRequests = () => requests.filter((request) => request.action === "authorize" || request.action === "run");
  const controls = (action) => {
    const label = action === "authorize" ? "Authorize selected work" : "Start authorized work";
    const rendered = templates(controller.render()).find((part) => part.strings.some((text) => text.includes('data-output-paid-action="true"'))
      && part.values.some((value) => typeof value === "string" && value.includes(label)));
    assert.ok(rendered, `the actual ${action} form must be rendered`);
    const form = { syntheticForm: action };
    const button = new FakeButton(form);
    button.disabled = binding(rendered, "?disabled");
    assert.equal(button.disabled, false, `the actual ${action} control must start enabled; no test override may enable it`);
    const click = eventHandlers(rendered, "click")[0];
    // The disclosure template contains a separate nonauthorizing settings form.
    // Exercise the actual paid handler, not that form's earlier preventDefault handler.
    const submit = action === "authorize" ? handler(rendered, "submit", "#authorize") : eventHandlers(rendered, "submit")[0];
    assert.equal(typeof click, "function"); assert.equal(typeof submit, "function");
    const clickRecord = (patch = {}) => ({ type: "click", isTrusted: true, currentTarget: button, defaultPrevented: false, ...patch });
    const submitRecord = (patch = {}) => ({ ...submitEvent(), isTrusted: true, currentTarget: form, submitter: button,
      preventDefault() { effects.preventedSubmits += 1; }, ...patch });
    return { form, button, clickRecord, submitRecord,
      click: (patch) => click.call(controller, clickRecord(patch)),
      submit: (patch) => submit.call(controller, submitRecord(patch)) };
  };
  const prepareAuthorize = async () => {
    await handler(controller.render(), "submit", "#inspectRun").call(controller, submitEvent());
    const disclosure = region(controller.render(), 'class="output-provider-disclosure"');
    const acknowledge = eventHandlers(disclosure, "change")[0];
    assert.ok(acknowledge, "the actual nonauthorizing settings acknowledgement must be available");
    acknowledge.call(controller, { target: { checked: true } });
    return { controls: controls("authorize"), acknowledge: (checked) => acknowledge.call(controller, { target: { checked } }) };
  };
  return { ...f, controller, requests, paidRequests, scheduled, activation, scope, effects, controls, prepareAuthorize };
}

test("actual controller supplied click→submit records authorize once, then require a separate consumed Start activation", async () => {
  const f = await fixture();
  const authorization = (await f.prepareAuthorize()).controls;
  assert.equal(f.paidRequests().length, 0, "preflight and acknowledgement do not authorize or start");
  authorization.click();
  assert.equal(f.paidRequests().length, 0, "arming alone dispatches nothing");
  const first = authorization.submit();
  await authorization.submit();
  await first;
  assert.deepEqual(f.paidRequests().map((entry) => entry.action), ["authorize"]);
  const authorize = f.paidRequests()[0];
  assert.equal(authorize.preflightId, "synthetic-preflight");
  assert.equal(authorize.termsDigest, "synthetic-terms");
  assert.equal(authorize.maximumMicrousd, 100_000);
  assert.equal(authorize.explicitAuthorization, true);
  assert.equal(authorize.documentId, "doc-a");
  assert.equal(f.effects.syncCalls, 0, "authorization alone must not drive document jobs");

  f.controller.willUpdate(new Map());
  const start = f.controls("run");
  await start.submit();
  assert.equal(f.paidRequests().length, 1, "Start cannot borrow the consumed Authorize activation");
  start.click();
  const run = start.submit();
  await start.submit();
  await run;
  assert.deepEqual(f.paidRequests().map((entry) => entry.action), ["authorize", "run"]);
  assert.equal(f.paidRequests()[1].grantId, "synthetic-grant");
  assert.equal(f.paidRequests()[1].documentId, "doc-a");
  assert.equal(f.effects.syncCalls, 1, "only the explicit run invokes the harmless job-sync spy");
  assert.ok(f.scheduled.length >= 2);
  assert.ok(f.scheduled.every((entry) => entry.milliseconds === 0), "the actual host requests task expiry, not a microtask expiry");
});

for (const action of ["authorize", "run"]) {
  const prepared = async () => {
    const f = await fixture({ readyGrant: action === "run" });
    const controls = action === "authorize" ? (await f.prepareAuthorize()).controls : f.controls("run");
    return { f, controls };
  };
  test(`${action}: actual controller accepts a supplied click record with detail 0; this is not a native keyboard test`, async () => {
    const { f, controls } = await prepared();
    controls.click({ detail: 0 });
    await controls.submit();
    assert.equal(f.paidRequests().length, 1);
    await controls.submit();
    assert.equal(f.paidRequests().length, 1);
  });
  const negatives = [
    ["submit without paid click", () => {}],
    ["untrusted click then trusted submit", ({ controls }) => controls.click({ isTrusted: false })],
    ["keydown instead of click", ({ controls }) => controls.click({ type: "keydown" })],
    ["click prevented before the handler", ({ controls }) => controls.click({ defaultPrevented: true })],
    ["missing transient activation at click", ({ f, controls }) => { f.activation.isActive = false; controls.click(); f.activation.isActive = true; }],
    ["missing transient activation at submit", ({ f, controls }) => { controls.click(); f.activation.isActive = false; }],
    ["expiry before submit", ({ f, controls }) => { controls.click(); f.scheduled.at(-1).callback(); }],
    ["button disabled after click", ({ controls }) => { controls.click(); controls.button.disabled = true; }],
    ["button moved to another form", ({ controls }) => { controls.click(); controls.button.form = {}; }],
    ["scope changed before submit without a render", ({ f, controls }) => { controls.click(); f.scope.key = "another-authorization-scope"; }],
    ["request permission lost before submit without a render", ({ f, controls }) => { controls.click(); const next = structuredClone(f.snapshots.get("doc-a")); next.permissions.canRequest = false; f.snapshots.set("doc-a", next); }],
    ["source proof lost with unchanged digests before submit", ({ f, controls }) => { controls.click(); const next = structuredClone(f.snapshots.get("doc-a")); next.sourceVerification.status = "unavailable"; next.sourceVerification.reasonCodes = ["context_source_evidence_unavailable"]; f.snapshots.set("doc-a", next); }],
  ];
  for (const [name, act] of negatives) test(`${action}: actual controller rejects ${name}`, async () => {
    const context = await prepared();
    act(context);
    await context.controls.submit();
    assert.equal(context.f.paidRequests().length, 0);
  });
  for (const [name, patch] of [
    ["untrusted submit", { isTrusted: false }],
    ["different submitter", { submitter: {} }],
    ["different form", { currentTarget: {} }],
  ]) test(`${action}: a rejected ${name} also consumes the supplied click`, async () => {
    const { f, controls } = await prepared();
    controls.click();
    await controls.submit(patch);
    await controls.submit();
    assert.equal(f.paidRequests().length, 0);
  });
}

test("actual acknowledgement changes invalidate an already supplied authorization click", async () => {
  const f = await fixture();
  const { controls, acknowledge } = await f.prepareAuthorize();
  controls.click();
  acknowledge(false); acknowledge(true);
  await controls.submit();
  assert.equal(f.paidRequests().length, 0);
});

test("an actual Start callback cannot use an activation for a replaced grant", async () => {
  const f = await fixture({ readyGrant: true });
  const controls = f.controls("run");
  controls.click();
  const next = structuredClone(f.snapshots.get("doc-a"));
  next.grants[0].id = "another-grant";
  f.snapshots.set("doc-a", next);
  await controls.submit();
  assert.equal(f.paidRequests().length, 0);
});

for (const action of ["authorize", "run"]) for (const timing of ["before click", "between click and submit"]) {
  for (const [name, change] of [
    ["source digest", (snapshot) => { snapshot.sourceRevision = "source-2"; snapshot.confirmedPlan.sourceDigest = "source-2"; }],
    ["requirements digest", (snapshot) => { snapshot.requirementRevision = "requirements-2"; snapshot.confirmedPlan.requirementsDigest = "requirements-2"; }],
    ["plan identity", (snapshot) => { snapshot.confirmedPlan.revisionId = "plan-2"; }],
    ["target contract", (snapshot) => { snapshot.confirmedPlan.targetContractDigests[snapshot.confirmedPlan.plan.targets[0].id] = "changed-target-contract"; }],
    ["optional target commitment", (snapshot) => { snapshot.confirmedPlan.plan.targets[0].selected = false; }],
  ]) test(`${action}: changed ${name} ${timing} invalidates retained DOM callbacks without willUpdate`, async () => {
    const f = await fixture({ readyGrant: action === "run" });
    const controls = action === "authorize" ? (await f.prepareAuthorize()).controls : f.controls("run");
    if (timing === "between click and submit") controls.click();
    const current = structuredClone(f.snapshots.get("doc-a")); change(current); f.snapshots.set("doc-a", current);
    if (timing === "before click") controls.click();
    await controls.submit();
    assert.equal(f.paidRequests().length, 0);
    assert.equal(f.effects.syncCalls, 0);
  });
}

for (const timing of ["before click", "between click and submit"]) {
  test(`Start cannot adopt a newly matching replacement disclosure ${timing} under the old rendered grant ID`, async () => {
    const f = await fixture({ readyGrant: true }), controls = f.controls("run");
    if (timing === "between click and submit") controls.click();
    const current = structuredClone(f.snapshots.get("doc-a"));
    current.sourceRevision = "source-2"; current.confirmedPlan.sourceDigest = "source-2";
    current.grants[0].disclosure.sourceDigest = "source-2";
    current.grants[0].disclosure.targets[0].model = "CHANGED-SYNTHETIC-MODEL";
    f.snapshots.set("doc-a", current);
    if (timing === "before click") controls.click();
    await controls.submit();
    assert.equal(f.paidRequests().length, 0, "the old displayed terms cannot authorize the new matching terms");
    const fresh = f.controls("run"); fresh.click(); await fresh.submit();
    assert.equal(f.paidRequests().length, 1, "a newly rendered matching disclosure and a separate activation can recover the same granted operation");
  });
}

test("retained stale-source authorization stays visible as history but cannot start", async () => {
  const f = await fixture({ readyGrant: true });
  const current = structuredClone(f.snapshots.get("doc-a"));
  current.sourceRevision = "source-2"; current.confirmedPlan.sourceDigest = "source-2";
  current.grants[0].usedMicrousd = 50_000;
  f.snapshots.set("doc-a", current); f.controller.willUpdate(new Map());
  const rendered = f.controller.render();
  assert.ok(JSON.stringify(rendered).includes("output.delivery.recordedDisclosureChanged"));
  assert.ok(JSON.stringify(rendered).includes("SYNTHETIC-NO-PROVIDER"), "the recorded source-transfer disclosure remains inspectable");
  const form = templates(rendered).find((part) => part.values.some((value) => typeof value === "string" && value.includes("Start authorized work")));
  assert.equal(binding(form, "?disabled"), true);
  assert.equal(f.snapshots.get("doc-a").grants[0].usedMicrousd, 50_000);
  assert.equal(f.paidRequests().length, 0);
});

test("an unrelated owner-head update preserves an exact reviewed paid decision", async () => {
  const f = await fixture(), controls = (await f.prepareAuthorize()).controls;
  controls.click();
  const current = structuredClone(f.snapshots.get("doc-a")); current.revision = "unrelated-owner-event";
  f.snapshots.set("doc-a", current); f.controller.willUpdate(new Map());
  await controls.submit();
  assert.equal(f.paidRequests().length, 1);
  assert.equal(f.paidRequests()[0].expectedRevision, "unrelated-owner-event");
});


for (const action of ["authorize", "run"]) test(`clearing only the next-check selection retires a previously armed ${action} latch without altering saved work or grants`, async () => {
  const f = await fixture({ readyGrant: action === "run" });
  const control = action === "authorize" ? (await f.prepareAuthorize()).controls : f.controls("run");
  const current = f.snapshots.get("doc-a"), before = structuredClone(current), requestCount = f.requests.length;
  control.click();
  const clear = templates(f.controller.render()).find((part) => part.values.some((value) => typeof value === "string" && value.includes("output.delivery.clearRunSelection")));
  assert.ok(clear); assert.equal(binding(clear, "?disabled"), false);
  eventHandlers(clear, "click")[0]();
  assert.equal(f.requests.length, requestCount); assert.deepEqual(current, before);
  await control.submit();
  assert.equal(f.paidRequests().length, 0, "a displayed grant remains history, but a cleared paid latch cannot be borrowed by the old submit");
  assert.equal(f.effects.syncCalls, 0);
  assert.ok(!templates(f.controller.render()).some((part) => part.strings.some((text) => text.includes('class="output-provider-disclosure"'))));
  if (action === "authorize") {
    const row = templates(f.controller.render()).find((part) => part.strings.some((text) => text.includes('<label><input class="output-run-target" data-output-run-target=')) && part.strings.some((text) => text.includes(' type="checkbox"')) && part.strings.some((text) => text.includes('<span dir="auto">')));
    eventHandlers(row, "change")[0]({ target: { checked: true } });
    await handler(f.controller.render(), "submit", "#inspectRun").call(f.controller, submitEvent());
    const disclosure = region(f.controller.render(), 'class="output-provider-disclosure"');
    assert.equal(binding(disclosure, ".checked"), false, "a new offer requires a new acknowledgement after Clear");
    assert.equal(binding(disclosure, "?disabled"), true);
    assert.equal(f.paidRequests().length, 0);
  }
});

test("fresh and retained image terms both render the image route disclosure and generation-call labels", async () => {
  const fresh = await fixture(); await fresh.prepareAuthorize();
  const offered = region(fresh.controller.render(), 'class="output-provider-disclosure"');
  assert.ok(JSON.stringify(offered).includes("output.delivery.message.nativeImageReady"));
  assert.ok(JSON.stringify(offered).includes("generation calls"));
  const retained = await fixture({ readyGrant: true });
  const grant = region(retained.controller.render(), 'class="output-grant"');
  assert.ok(JSON.stringify(grant).includes("output.delivery.message.nativeImageReady"), "Start retains the route-specific safety disclosure, not only generic transfer terms");
  assert.ok(JSON.stringify(grant).includes("Recorded generation calls"));
});

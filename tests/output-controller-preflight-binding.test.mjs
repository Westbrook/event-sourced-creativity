// Independent review probe: actual AST-transpiled controller and actual helpers.
// DOM/event trust/store are test doubles, not browser, native input, or API authority.
import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = resolve(process.env.FORMA_OUTPUT_REGRESSION_ROOT || fileURLToPath(new URL("../", import.meta.url)));
const { binding, controllerFixture, eventHandlers, handler, loadController, region, startPreflight, submitEvent, templates } = await import(pathToFileURL(resolve(root, "tests/output-ui-source-harness.mjs")));
const { OUTPUT_NATIVE_EXECUTION_POLICY } = await import(pathToFileURL(resolve(root, "src/model/output-execution-policy.ts")));
const { outputNativeReadiness } = await import(pathToFileURL(resolve(root, "src/components/output-source-readiness.ts")));
const { compileOutputPlan, initialOutputTargetState, summarizeOutputPlan } = await import(pathToFileURL(resolve(root, "src/model/output-plan.ts")));
const { confirmOutputRequirementInterpretation } = await import(pathToFileURL(resolve(root, "src/model/output-requirements.ts")));

function offer(snapshot, alternative = false) {
  return { id: "original-preflight", planRevisionId: snapshot.confirmedPlan.revisionId, termsDigest: "original-terms",
    sourceDigest: snapshot.sourceRevision, requirementsDigest: snapshot.requirementRevision,
    maximumMicrousd: 100_000, maximumCalls: 2, createdAt: "2026-08-27T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z",
    operationAttempts: { [snapshot.confirmedPlan.plan.targets[0].id]: { ordinal: alternative ? 2 : 1, previousSlotId: alternative ? "failed-slot" : null } },
    targets: [{ targetId: snapshot.confirmedPlan.plan.targets[0].id, available: true, provider: "ORIGINAL-SYNTHETIC-OFFER", model: "fixture",
      reason: "Synthetic availability only", reasonCode: "output_native_image_ready", reasonValues: {}, transferCode: "output_transfer_document_after_authorization",
      route: "synthetic-route", transferDescription: "No real source transfer", maximumTokens: 0,
      maximumMicrousd: 100_000, maximumCalls: 2, settings: { executionPolicy: OUTPUT_NATIVE_EXECUTION_POLICY } }] };
}
async function fixture({ alternative = false } = {}) {
  const f = await controllerFixture();
  const i18n = f.controller.i18n;
  class FakeButton { constructor(form) { this.form = form; this.disabled = false; this.type = "submit"; } }
  class Base {
    constructor() { this.store = f.store; this.i18n = i18n; this.isConnected = true; this.updateComplete = Promise.resolve(); }
    requestUpdate() {} querySelector() { return null; }
    connectedCallback() { this.isConnected = true; } disconnectedCallback() { this.isConnected = false; }
  }
  const Controller = await loadController(Base, { HTMLButtonElement: FakeButton, navigator: { userActivation: { isActive: true } }, setTimeout: () => 1 });
  const controller = new Controller(); controller.documentId = "doc-a"; controller.surface = "deliver";
  f.controller = controller;
  const snapshot = f.snapshots.get("doc-a");
  const preflight = offer(snapshot, alternative);
  if (alternative) {
    const target = snapshot.confirmedPlan.plan.targets[0];
    const accounting = { maximumMicrousd: 100_000, maximumCalls: 2, usedMicrousd: 50_000, usedCalls: 1, exposedMicrousd: 0, pendingCalls: 0 };
    snapshot.grants = [{ id: "failed-grant", planRevisionId: snapshot.confirmedPlan.revisionId, actorUserId: snapshot.scope.actorUserId,
      payerUserId: snapshot.scope.actorUserId, status: "completed", expiresAt: "2099-01-01T00:00:00.000Z", disclosure: offer(snapshot), ...accounting,
      operations: [{ id: "failed-slot", targetId: target.id, jobId: "failed-job", status: "failed", ...accounting }] }];
    f.store.documentJobs.get = () => [{ jobId: "failed-job", documentId: "doc-a", kind: "generate", status: "failed" }];
  }
  controller.willUpdate(new Map());
  const start = () => {
    if (!alternative) return startPreflight(f);
    const callback = eventHandlers(controller.render(), "click").find((candidate) => candidate.toString().includes("#alternative("));
    assert.ok(callback, "the actual failed-attempt alternative action must be present");
    return callback.call(controller);
  };
  return { ...f, FakeButton, preflight, start,
    resolve: () => f.pending.resolve({ status: "saved", body: { snapshot: structuredClone(snapshot), command: { preflight } } }),
  };
}

const replacements = [
  ["unchanged current decision", () => {}, true],
  ["a different current plan with unchanged source and requirements", (s) => { s.confirmedPlan.revisionId = "new-confirmed-plan"; }, false],
  ["new source and a freshly confirmed eligible plan", (s) => { s.sourceRevision = "source-2"; s.confirmedPlan.sourceDigest = "source-2"; s.confirmedPlan.revisionId = "new-confirmed-plan"; }, false],
  ["new requirements and a freshly confirmed eligible plan", (s) => { s.requirementRevision = "requirements-2"; s.confirmedPlan.requirementsDigest = "requirements-2"; s.confirmedPlan.revisionId = "new-confirmed-plan"; }, false],
  ["source proof lost without digest changes", (s) => { s.sourceVerification.status = "unavailable"; s.sourceVerification.reasonCodes = ["context_source_evidence_unavailable"]; }, false],
];
test("blocked existing-attempt preflight preserves its reason without allocating or authorizing a new attempt", async () => {
  const f = await fixture();
  f.preflight.operationAttempts = {};
  f.preflight.maximumMicrousd = 0; f.preflight.maximumCalls = 0;
  Object.assign(f.preflight.targets[0], { available: false, reasonCode: "output_existing_operation_requires_recovery",
    reason: "This target already has an authorized operation.", provider: null, model: null, route: null,
    maximumMicrousd: 0, maximumCalls: 0, transferCode: "output_transfer_none_authorized" });
  const pending = f.start(); f.resolve(); await pending;
  const disclosure = region(f.controller.render(), 'class="output-provider-disclosure"');
  assert.ok(disclosure);
  assert.ok(!JSON.stringify(f.controller.render()).includes("output.delivery.preflightRetired"));
  assert.ok(JSON.stringify(disclosure).includes("output.delivery.message.existingOperation"));
  assert.equal(binding(disclosure, "?disabled"), true);
  eventHandlers(disclosure, "change")[0].call(f.controller, { target: { checked: true } });
  await handler(disclosure, "submit", "#authorize").call(f.controller, submitEvent());
  assert.equal(f.requests.length, 1, "showing a refusal cannot dispatch authorize or run");
});

test("available target without an attempt allocation remains rejected", async () => {
  const f = await fixture(); f.preflight.operationAttempts = {};
  const pending = f.start(); f.resolve(); await pending;
  assert.ok(!templates(f.controller.render()).some((part) => part.strings.some((text) => text.includes('class="output-provider-disclosure"'))));
  assert.ok(JSON.stringify(f.controller.render()).includes("output.delivery.preflightRetired"));
  assert.equal(f.requests.length, 1);
});

test("blocked offer still rejects a mismatched supplied attempt", async () => {
  const f = await fixture(); f.preflight.targets[0].available = false;
  Object.values(f.preflight.operationAttempts)[0].previousSlotId = "wrong-predecessor";
  const pending = f.start(); f.resolve(); await pending;
  assert.ok(!templates(f.controller.render()).some((part) => part.strings.some((text) => text.includes('class="output-provider-disclosure"'))));
  assert.ok(JSON.stringify(f.controller.render()).includes("output.delivery.preflightRetired"));
  assert.equal(f.requests.length, 1);
});

for (const alternative of [false, true]) for (const [name, mutate, mayOffer] of replacements) {
  test(`actual ${alternative ? "alternative" : "initial"} preflight reply after ${name}`, async () => {
    const f = await fixture({ alternative });
    const pending = f.start();
    await f.waitForRequest(pending);
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].action, "preflight");
    if (alternative) assert.equal(f.requests[0].alternativeOfSlotId, "failed-slot");
    const current = structuredClone(f.snapshots.get("doc-a"));
    current.revision = "2"; mutate(current);
    f.snapshots.set("doc-a", current); f.controller.willUpdate(new Map());
    f.resolve(); await pending;
    const currentOffer = templates(f.controller.render()).some((part) => part.strings.some((text) => text.includes('class="output-provider-disclosure"')));
    assert.equal(currentOffer, mayOffer, "a reply for an old source/requirement/plan cannot become the current paid offer");
    assert.equal(f.requests.length, 1, "discarding the offer must not retry, authorize, or start anything");
  });
}

for (const [name, mutate] of replacements.slice(1, 4)) {
  test(`actual Authorize decision rejects ${name} even before the observer renders`, async () => {
    const f = await fixture();
    const pending = f.start(); f.resolve(); await pending;
    let disclosure = region(f.controller.render(), 'class="output-provider-disclosure"');
    eventHandlers(disclosure, "change")[0].call(f.controller, { target: { checked: true } });
    disclosure = region(f.controller.render(), 'class="output-provider-disclosure"');
    assert.equal(binding(disclosure, "?disabled"), false, "the original valid offer must actually be enabled");
    const click = eventHandlers(disclosure, "click")[0], submit = handler(disclosure, "submit", "#authorize");
    const form = {}, button = new f.FakeButton(form);
    const current = structuredClone(f.snapshots.get("doc-a")); mutate(current);
    f.snapshots.set("doc-a", current);
    assert.equal(outputNativeReadiness(current).allowed, true, "generic readiness cannot distinguish this new valid plan from the older offer");
    // Retained DOM callbacks with no observer/render in between: dispatch must consult identity too.
    click.call(f.controller, { type: "click", isTrusted: true, currentTarget: button, defaultPrevented: false });
    await submit.call(f.controller, { ...submitEvent(), isTrusted: true, currentTarget: form, submitter: button });
    assert.equal(f.requests.filter((request) => request.action === "authorize" || request.action === "run").length, 0);
  });
}

const tagged = (part, key) => part.values.some((value) => typeof value === "string" && value.includes(`output.delivery.${key}`));
const execution = (f) => region(f.controller.render(), 'class="output-execution"');
const runRows = (f) => templates(execution(f)).filter((part) => part.strings.some((value) => value.includes('<label><input class="output-run-target" data-output-run-target=')) && part.strings.some((value) => value.includes(' type="checkbox"'))
  && part.strings.some((value) => value.includes('<span dir="auto">')));
const check = (f) => templates(execution(f)).find((part) => tagged(part, "checkRun"));
function offerForAll(snapshot, targets) {
  const base = offer(snapshot);
  return { ...base, targets: targets.map((target) => ({ ...base.targets[0], targetId: target.id })),
    maximumMicrousd: targets.length * base.maximumMicrousd, maximumCalls: targets.length * base.maximumCalls,
    operationAttempts: Object.fromEntries(targets.map((target) => [target.id, { ordinal: 0, previousSlotId: null }])) };
}
function publishTargets(f, count) {
  const current = structuredClone(f.snapshots.get("doc-a")), original = current.confirmedPlan.plan.targets[0];
  current.confirmedPlan.revisionId = `plan-${count}-synthetic-targets`;
  current.confirmedPlan.plan.targets = Array.from({ length: count }, (_, index) => ({ ...structuredClone(original), id: `target-${index}`, label: `Synthetic target ${index}` }));
  current.confirmedPlan.targetContractDigests = Object.fromEntries(current.confirmedPlan.plan.targets.map((target) => [target.id, `contract-${target.id}`]));
  current.summary.required_obligations = count; current.summary.required_groups = count;
  f.snapshots.set("doc-a", current); f.controller.willUpdate(new Map());
  return current;
}

for (const missingAvailableAttempt of [false, true]) test(`mixed blocked offer preserves only valid available-attempt proof (missing=${missingAvailableAttempt})`, async () => {
  const f = await fixture(), current = publishTargets(f, 2), preflight = offerForAll(current, current.confirmedPlan.plan.targets);
  const [available, blocked] = preflight.targets;
  blocked.available = false; blocked.reasonCode = "output_existing_operation_requires_recovery";
  blocked.transferCode = "output_transfer_none_authorized";
  blocked.provider = null; blocked.model = null; blocked.route = null;
  blocked.maximumMicrousd = 0; blocked.maximumCalls = 0;
  delete preflight.operationAttempts[blocked.targetId];
  if (missingAvailableAttempt) delete preflight.operationAttempts[available.targetId];
  preflight.maximumMicrousd = available.maximumMicrousd; preflight.maximumCalls = available.maximumCalls;
  const pending = f.start(); await f.waitForRequest(pending);
  f.pending.resolve({ status: "saved", body: { snapshot: current, command: { preflight } } }); await pending;
  const disclosure = templates(f.controller.render()).find((part) => part.strings.some((text) => text.includes('class="output-provider-disclosure"')));
  if (missingAvailableAttempt) {
    assert.equal(disclosure, undefined);
    assert.ok(JSON.stringify(f.controller.render()).includes("output.delivery.preflightRetired"));
  } else {
    assert.ok(disclosure);
    assert.ok(JSON.stringify(disclosure).includes("output.delivery.message.existingOperation"));
    const disabledValues = disclosure.values.filter((_value, index) => disclosure.strings[index].trimEnd().endsWith("?disabled="));
    assert.deepEqual(disabledValues, [true, true], "both acknowledgement and paid submission are disabled");
    eventHandlers(disclosure, "change")[0].call(f.controller, { target: { checked: true } });
    const form = {}, button = new f.FakeButton(form);
    eventHandlers(disclosure, "click")[0].call(f.controller, { type: "click", isTrusted: true, currentTarget: button, defaultPrevented: false });
    await handler(disclosure, "submit", "#authorize").call(f.controller, { ...submitEvent(), isTrusted: true, currentTarget: form, submitter: button });
  }
  assert.equal(f.requests.length, 1, "mixed refusal cannot arm or dispatch paid work");
});

test("256 selected targets can be checked without changing the complete assignment", async () => {
  const f = await fixture(), current = publishTargets(f, 256), before = structuredClone(current);
  assert.equal(runRows(f).length, 256);
  assert.equal(runRows(f).filter((row) => binding(row, ".checked")).length, 256);
  assert.equal(binding(check(f), "?disabled"), false);
  assert.ok(JSON.stringify(execution(f)).includes("at most 256 targets at a time"));
  const pending = f.start();
  await f.waitForRequest(pending);
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].targetIds.length, 256);
  assert.deepEqual(new Set(f.requests[0].targetIds), new Set(current.confirmedPlan.plan.targets.map((target) => target.id)));
  f.pending.resolve({ status: "saved", body: { snapshot: current, command: { preflight: offerForAll(current, current.confirmedPlan.plan.targets) } } });
  await pending;
  assert.ok(region(f.controller.render(), 'class="output-provider-disclosure"'));
  assert.deepEqual(f.snapshots.get("doc-a"), before);
});

test("257 selected targets remain visible and owed, require an explicit smaller selection, and refuse direct submission", async () => {
  const f = await fixture(), current = publishTargets(f, 257), before = structuredClone(current);
  assert.equal(runRows(f).length, 257); assert.equal(runRows(f).filter((row) => binding(row, ".checked")).length, 257);
  assert.equal(binding(check(f), "?disabled"), true);
  const copy = JSON.stringify(execution(f));
  assert.ok(copy.includes("257 targets are selected, exceeding the per-check limit of 256"));
  assert.ok(copy.includes("full delivery assignment remains unchanged"));
  await f.start();
  assert.equal(f.requests.length, 0, "an invoked submit handler cannot bypass the limit");
  const last = runRows(f).at(-1);
  eventHandlers(last, "change")[0]({ target: { checked: false } });
  assert.equal(runRows(f).length, 257); assert.equal(runRows(f).filter((row) => binding(row, ".checked")).length, 256);
  assert.equal(binding(check(f), "?disabled"), false);
  const pending = f.start();
  await f.waitForRequest(pending);
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].targetIds.length, 256);
  assert.ok(!f.requests[0].targetIds.includes("target-256"));
  assert.deepEqual(f.snapshots.get("doc-a"), before, "local run selection cannot withdraw any committed target");
  f.pending.resolve({ status: "saved", body: { snapshot: current, command: { preflight: offerForAll(current, current.confirmedPlan.plan.targets.slice(0, 256)) } } });
  await pending;
});

for (const canAuthor of [true, false]) test(`uncommitted optional target stays disabled and cannot be inserted by an old change callback (canAuthor=${canAuthor})`, async () => {
  const f = await fixture(), current = publishTargets(f, 1);
  current.confirmedPlan.revisionId = "optional-not-committed"; current.confirmedPlan.plan.targets[0].required = false;
  current.confirmedPlan.plan.targets[0].selected = false; current.permissions.canAuthor = canAuthor;
  f.controller.willUpdate(new Map());
  const before = structuredClone(current), row = runRows(f)[0];
  assert.equal(binding(row, ".checked"), false); assert.equal(binding(row, "?disabled"), true);
  assert.equal(binding(check(f), "?disabled"), true);
  assert.ok(JSON.stringify(execution(f)).includes(canAuthor ? "output.delivery.optionalTargetNeedsPlan" : "output.delivery.optionalTargetNeedsAuthor"));
  const navigation = templates(execution(f)).filter((part) => tagged(part, "reviewPlan") && eventHandlers(part, "click").length);
  assert.equal(navigation.length, canAuthor ? 1 : 0, "only an actual author gets the plan-edit navigation action");
  eventHandlers(row, "change")[0]({ target: { checked: true } });
  assert.equal(binding(runRows(f)[0], ".checked"), false);
  await f.start();
  assert.equal(f.requests.length, 0); assert.deepEqual(f.snapshots.get("doc-a"), before);
});

test("a committed optional target can be unchecked for a run without withdrawing its plan commitment", async () => {
  const f = await fixture(), current = publishTargets(f, 2);
  current.confirmedPlan.plan.targets[1].required = false;
  const row = runRows(f)[1];
  assert.equal(binding(row, ".checked"), true); assert.equal(binding(row, "?disabled"), false);
  eventHandlers(row, "change")[0]({ target: { checked: false } });
  assert.equal(current.confirmedPlan.plan.targets[1].selected, true);
  const pending = f.start(); await f.waitForRequest(pending); assert.deepEqual(f.requests[0].targetIds, ["target-0"]);
  f.pending.resolve({ status: "saved", body: { snapshot: current, command: { preflight: offerForAll(current, [current.confirmedPlan.plan.targets[0]]) } } });
  await pending;
  assert.equal(current.confirmedPlan.plan.targets.length, 2);
});

test("a one-target alternative offer is bound to its slot, not silently expanded to every checked target", async () => {
  const f = await fixture({ alternative: true }), current = f.snapshots.get("doc-a");
  const original = current.confirmedPlan.plan.targets[0], second = { ...structuredClone(original), id: "another-selected-target", label: "Another selected synthetic target" };
  current.confirmedPlan.plan.targets.push(second); current.confirmedPlan.targetContractDigests[second.id] = "second-contract";
  current.confirmedPlan.revisionId = "plan-with-two-selected-targets";
  current.grants[0].planRevisionId = current.confirmedPlan.revisionId;
  current.grants[0].disclosure.planRevisionId = current.confirmedPlan.revisionId;
  f.preflight.planRevisionId = current.confirmedPlan.revisionId;
  f.controller.willUpdate(new Map());
  assert.equal(runRows(f).filter((row) => binding(row, ".checked")).length, 2);
  const pending = f.start(); await f.waitForRequest(pending); assert.deepEqual(f.requests[0].targetIds, [original.id]);
  f.resolve(); await pending;
  assert.ok(region(f.controller.render(), 'class="output-provider-disclosure"'));
  assert.equal(runRows(f).filter((row) => binding(row, ".checked")).length, 2, "preparing an alternative does not rewrite the general run selection");
});

for (const [name, change] of [
  ["different target", (preflight) => { preflight.targets[0].targetId = "another-target"; }],
  ["duplicate target", (preflight) => { preflight.targets.push(structuredClone(preflight.targets[0])); }],
  ["wrong previous alternative slot", (preflight) => { Object.values(preflight.operationAttempts)[0].previousSlotId = "another-slot"; }],
]) test(`a ${name} in an otherwise same-view preflight reply cannot become the current offer`, async () => {
  const f = await fixture(), pending = f.start(); change(f.preflight); f.resolve(); await pending;
  assert.ok(!templates(f.controller.render()).some((part) => part.strings.some((text) => text.includes('class="output-provider-disclosure"'))));
  assert.ok(JSON.stringify(f.controller.render()).includes("output.delivery.preflightRetired"));
  assert.equal(f.requests.length, 1);
});


const clearControl = (f) => templates(execution(f)).find((part) => tagged(part, "clearRunSelection"));
function publishThousandTargetPlan(f) {
  const current = structuredClone(f.snapshots.get("doc-a"));
  const row = current.requirements[0], original = row.spec.deliverables[0];
  row.spec = confirmOutputRequirementInterpretation({ ...row.spec, original_text: "SYNTHETIC: one thousand required image files.",
    deliverables: [{ ...original, quantity: { kind: "exact", unit: "image", value: 1000 } }] });
  row.content = row.spec.original_text; row.preserved = structuredClone(row.spec);
  const plan = compileOutputPlan([row.spec], { document_id: current.documentId, source_revision: current.sourceRevision,
    requirement_revision: current.requirementRevision });
  assert.equal(plan.issues.length, 0); assert.equal(plan.targets.length, 1000);
  assert.ok(plan.targets.every((target) => target.selected && !target.blocking_issues.length));
  current.confirmedPlan = { ...current.confirmedPlan, revisionId: "actual-compiled-thousand-target-plan", plan, confirmationOptions: {},
    targetContractDigests: Object.fromEntries(plan.targets.map((target) => [target.id, `synthetic-contract-${target.id}`])) };
  current.targetStates = plan.targets.map((target) => initialOutputTargetState(target, "supported"));
  current.summary = summarizeOutputPlan(plan, current.targetStates, { state: "ready", source_revision: current.sourceRevision,
    requirement_revision: current.requirementRevision });
  current.requirementSummaries = { [row.blockId]: current.summary };
  f.snapshots.set("doc-a", current); f.controller.willUpdate(new Map());
  return current;
}

test("one explicit Clear narrows an actual 1000-target plan to zero locally, then checking one preserves every owed target and receipt", async () => {
  const f = await fixture({ alternative: true }), current = publishThousandTargetPlan(f), before = structuredClone(current);
  const clear = clearControl(f); assert.ok(clear);
  assert.equal(binding(clear, "?disabled"), false);
  assert.equal(runRows(f).filter((row) => binding(row, ".checked")).length, 1000);
  assert.equal(binding(check(f), "?disabled"), true);
  eventHandlers(clear, "click")[0]();
  assert.equal(runRows(f).length, 1000);
  assert.equal(runRows(f).filter((row) => binding(row, ".checked")).length, 0);
  assert.equal(binding(check(f), "?disabled"), true);
  const cleared = clearControl(f);
  assert.equal(binding(cleared, "?disabled"), false, "the same action remains enabled and mounted when empty; native focus is browser QA");
  assert.deepEqual(cleared.strings, clear.strings, "the harness copies template arrays; the same source structure owns Clear before and after the action");
  assert.ok(JSON.stringify(cleared).includes("Selection cleared for this check; the delivery plan is unchanged."));
  assert.ok(clear.strings.join("").includes('role="status"'), "the status region is adjacent and present even before clearing");
  assert.deepEqual(current, before); assert.equal(current.summary.required_targets, 1000);
  assert.equal(current.confirmedPlan.plan.targets.filter((target) => target.selected).length, 1000);
  assert.equal(current.grants.length, 1, "the prior recorded attempt remains");
  await startPreflight(f); eventHandlers(cleared, "click")[0]();
  assert.equal(f.requests.length, 0, "clearing an empty selection and empty submit dispatch no command");
  eventHandlers(runRows(f)[0], "change")[0]({ target: { checked: true } });
  assert.equal(runRows(f).filter((row) => binding(row, ".checked")).length, 1);
  assert.equal(binding(check(f), "?disabled"), false);
  assert.ok(!JSON.stringify(clearControl(f)).includes("output.delivery.runSelectionCleared"));
  const pending = startPreflight(f), first = current.confirmedPlan.plan.targets[0];
  await f.waitForRequest(pending);
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].action, "preflight");
  assert.deepEqual(f.requests[0].targetIds, [first.id]);
  f.pending.resolve({ status: "saved", body: { snapshot: current, command: { preflight: offerForAll(current, [first]) } } });
  await pending; assert.deepEqual(current, before);
  assert.equal(f.requests.filter((request) => request.action !== "preflight").length, 0);
});

for (const [name, change] of [
  ["Document", (f, current) => { f.controller.documentId = "doc-b"; }],
  ["authorization scope", (f, current) => { f.store.captureAuthorizationScope = () => ({ key: "other-actor-scope" }); }],
  ["request permission", (f, current) => { current.permissions.canRequest = false; }],
  ["current source", (f, current) => { current.sourceRevision = "new-source"; current.confirmedPlan.sourceDigest = "new-source"; }],
  ["current plan", (f, current) => { current.confirmedPlan.revisionId = "new-plan"; }],
  ["target contract", (f, current) => { current.confirmedPlan.targetContractDigests[current.confirmedPlan.plan.targets[0].id] = "new-contract"; }],
  ["source evidence", (f, current) => { current.sourceVerification.status = "unavailable"; current.sourceVerification.reasonCodes = ["context_source_evidence_unavailable"]; }],
  ["refresh state", (f, current) => { const resource = f.store.outputRequirements.resource; f.store.outputRequirements.resource = (id) => ({ ...resource(id), state: "refreshing" }); }],
  ["disconnected view", (f, current) => { f.controller.isConnected = false; }],
  ["inspection view", (f, current) => { f.controller.inspectionOnly = true; }],
]) test(`a retained Clear callback cannot change selection after ${name} changes, even before an observer`, async () => {
  const f = await fixture(), current = f.snapshots.get("doc-a"), clear = clearControl(f);
  change(f, current); eventHandlers(clear, "click")[0]();
  if (f.controller.documentId !== "doc-a") f.controller.documentId = "doc-a";
  assert.equal(runRows(f).filter((row) => binding(row, ".checked")).length, 1);
  assert.equal(f.requests.length, 0);
});

test("a retained Clear callback cannot alter a selection while its current preflight is pending", async () => {
  const f = await fixture(), clear = clearControl(f), pending = f.start();
  assert.equal(binding(clearControl(f), "?disabled"), true);
  eventHandlers(clear, "click")[0]();
  assert.equal(runRows(f).filter((row) => binding(row, ".checked")).length, 1);
  f.resolve(); await pending;
  assert.ok(region(f.controller.render(), 'class="output-provider-disclosure"'));
  assert.equal(f.requests.length, 1);
});

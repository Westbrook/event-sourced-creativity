// Actual controller and helpers, with explicit synthetic DOM/event records and store replies.
// This is not native-browser activation, account, API, provider, or billing authority proof.
import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(process.env.FORMA_OUTPUT_REGRESSION_ROOT || fileURLToPath(new URL("../", import.meta.url)));
const source = (path) => import(pathToFileURL(resolve(root, path)).href);
const [{ outputGrantHasQueuedOperations }, { OUTPUT_NATIVE_EXECUTION_POLICY }, harness] = await Promise.all([
  source("src/components/output-controller-recovery.ts"), source("src/model/output-execution-policy.ts"),
  source("tests/output-ui-source-harness.mjs"),
]);
const { binding, controllerFixture, eventHandlers, loadController, submitEvent, templates } = harness;

test("Start is offered only for existing authorized or queued operations", () => {
  for (const status of ["authorized", "queued"]) assert.equal(outputGrantHasQueuedOperations({ operations: [{ status }] }), true);
  for (const status of ["running", "uncertain", "succeeded", "completed", "failed", "cancelled", "canceled", "unavailable", "unknown", undefined]) {
    assert.equal(outputGrantHasQueuedOperations({ operations: [{ status }] }), false, String(status));
  }
  assert.equal(outputGrantHasQueuedOperations({ operations: [] }), false);
  assert.equal(outputGrantHasQueuedOperations({}), false);
  assert.equal(outputGrantHasQueuedOperations({ operations: [{ status: "uncertain" }, { status: "queued" }] }), true);
});

const accounting = () => ({ maximumMicrousd: 100_000, maximumCalls: 2, usedMicrousd: 0, usedCalls: 0, exposedMicrousd: 0, pendingCalls: 0 });
async function fixture(statuses, grantStatus = "authorized") {
  const f = await controllerFixture(), snapshot = f.snapshots.get("doc-a"), original = snapshot.confirmedPlan.plan.targets[0];
  // Multiple synthetic operation targets make the disclosure/contract checks valid;
  // the test varies only operation status, not a missing source or mismatched grant.
  const targets = Array.from({ length: Math.max(1, statuses.length) }, (_, index) => ({ ...structuredClone(original), id: `queued-guard-target-${index}` }));
  snapshot.confirmedPlan.plan.targets = targets;
  snapshot.confirmedPlan.targetContractDigests = Object.fromEntries(targets.map((target) => [target.id, `contract-${target.id}`]));
  snapshot.assets = []; snapshot.results = [];
  const disclosure = { id: "synthetic-preflight", termsDigest: "synthetic-terms", planRevisionId: snapshot.confirmedPlan.revisionId,
    sourceDigest: snapshot.sourceRevision, requirementsDigest: snapshot.requirementRevision,
    maximumMicrousd: targets.length * 100_000, maximumCalls: targets.length * 2,
    createdAt: "2026-08-27T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z",
    operationAttempts: Object.fromEntries(targets.map((target) => [target.id, { ordinal: 0, previousSlotId: null }])),
    targets: targets.map((target) => ({ targetId: target.id, available: true,
      provider: "SYNTHETIC-NO-PROVIDER", model: "synthetic-model", route: "synthetic-route", maximumTokens: 0, ...accounting(),
      reasonCode: "output_native_image_ready", transferCode: "output_transfer_document_after_authorization",
      settings: { executionPolicy: OUTPUT_NATIVE_EXECUTION_POLICY } })) };
  const grant = { id: "synthetic-queued-guard-grant", planRevisionId: snapshot.confirmedPlan.revisionId,
    actorUserId: snapshot.scope.actorUserId, payerUserId: snapshot.scope.actorUserId, status: grantStatus,
    expiresAt: "2099-01-01T00:00:00.000Z", ...accounting(), disclosure,
    operations: statuses.map((status, index) => ({ id: `synthetic-slot-${index}`, jobId: `synthetic-job-${index}`,
      targetId: targets[index].id, status, ...accounting() })) };
  snapshot.grants = [grant];
  const requests = [], effects = { syncCalls: 0 };
  f.store.outputRequirementCommand = async (command) => {
    requests.push(structuredClone(command));
    assert.equal(command.action, "run", "the supplied Start intent cannot silently authorize or prepare another operation");
    return { status: "saved", body: { snapshot: structuredClone(snapshot), command: { grantId: grant.id } } };
  };
  f.store.syncDocumentJobs = async () => { effects.syncCalls += 1; };
  class FakeButton {
    constructor(form, disabled) { this.form = form; this.type = "submit"; this.disabled = disabled; }
  }
  class Base {
    constructor() { this.store = f.store; this.isConnected = true; this.updateComplete = Promise.resolve(); this.i18n = f.controller.i18n; }
    requestUpdate() {} querySelector() { return null; }
    connectedCallback() { this.isConnected = true; } disconnectedCallback() { this.isConnected = false; }
  }
  const Controller = await loadController(Base, { HTMLButtonElement: FakeButton,
    navigator: { userActivation: { isActive: true } }, setTimeout: () => 1 });
  const controller = new Controller(); controller.documentId = snapshot.documentId; controller.surface = "deliver";
  controller.willUpdate(new Map());
  function controls() {
    const part = templates(controller.render()).find((entry) => entry.strings.some((text) => text.includes('data-output-paid-action="true"'))
      && entry.values.some((value) => typeof value === "string" && /output\.delivery\.(?:startAuthorized|recoverAuthorized)/u.test(value)));
    assert.ok(part, "the active or authorized grant retains its actual Start/recover control");
    const form = {}, button = new FakeButton(form, binding(part, "?disabled"));
    const click = eventHandlers(part, "click")[0], submit = eventHandlers(part, "submit")[0];
    assert.equal(typeof click, "function"); assert.equal(typeof submit, "function");
    return { disabled: button.disabled,
      click: () => click.call(controller, { type: "click", isTrusted: true, currentTarget: button, defaultPrevented: false }),
      submit: () => submit.call(controller, { ...submitEvent(), isTrusted: true, currentTarget: form, submitter: button }) };
  }
  return { controller, snapshot, grant, requests, effects, controls };
}

const cases = [
  ["authorized", ["authorized"], true], ["queued", ["queued"], true],
  ...["running", "uncertain", "succeeded", "completed", "failed", "cancelled", "canceled", "unavailable", "unknown", undefined]
    .map((status) => [String(status), [status], false]),
  ["empty operations", [], false],
  ["mixed uncertain and queued", ["uncertain", "queued"], true],
  ["mixed terminal operations", ["failed", "succeeded"], false],
];
for (const grantStatus of ["authorized", "active"]) for (const [name, statuses, allowed] of cases) {
  test(`${grantStatus} grant with ${name}: displayed control and current paid decision both enforce queued work`, async () => {
    const f = await fixture(statuses, grantStatus), before = structuredClone(f.snapshot), control = f.controls();
    assert.equal(control.disabled, !allowed, "render derives eligibility through the actual paid decision, irrespective of source-text placement");
    control.click(); await control.submit();
    assert.equal(f.requests.length, allowed ? 1 : 0);
    assert.equal(f.effects.syncCalls, allowed ? 1 : 0);
    if (allowed) {
      assert.equal(f.requests[0].action, "run"); assert.equal(f.requests[0].grantId, f.grant.id);
      assert.equal(f.requests[0].documentId, f.snapshot.documentId);
    }
    assert.deepEqual(f.snapshot, before, "the synthetic command reply does not revive, replace, or erase recorded attempts");
  });
}

for (const grantStatus of ["authorized", "active"]) for (const status of ["running", "uncertain", "failed", "succeeded", "cancelled"]) {
  for (const timing of ["before click", "between click and submit"]) {
    test(`${grantStatus}: current ${status} status ${timing} blocks a retained enabled Start callback without render or observer`, async () => {
      const f = await fixture(["queued"], grantStatus), old = f.controls();
      assert.equal(old.disabled, false, "the retained control must originally be eligible; the test never overrides its disabled state");
      if (timing === "between click and submit") old.click();
      f.grant.operations[0].status = status;
      const current = structuredClone(f.snapshot);
      if (timing === "before click") old.click();
      await old.submit();
      assert.equal(f.requests.length, 0, "synchronous decision checks must refuse before dispatch, without relying on a later render or server denial");
      assert.equal(f.effects.syncCalls, 0); assert.deepEqual(f.snapshot, current);
      assert.equal(f.controls().disabled, true, "the next actual render reflects the same current queued-work restriction");
    });
  }
}

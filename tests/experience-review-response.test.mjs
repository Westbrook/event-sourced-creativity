import assert from "node:assert/strict";
import test from "node:test";
import { calmFullPageNativePorts as ports } from "./helpers/calm-full-page-fixture.mjs";

// Actual client parsers imported with the existing native module port. These
// closed DTO checks do not stand in for DOM, lifecycle, browser or layout tests.
const { readExperienceReviewHead, readExperienceReviewDecision, readExperienceReviewProposalResult, readExperienceReviewHeadState,
  readExperienceReviewTransitionResult, readExperienceReviewPublicationResult, readExperienceReviewHistoricalPublication } =
  await ports.loadActual("src/apps/product/experience-review.ts");
const { experienceBindingDigest, experienceIntentDigest, experienceTransitionEventId, readExperienceOperationReceipt } =
  await ports.loadActual("src/experiences/release-contract.ts");
const { digest } = await ports.loadActual("src/experiences/compiler.ts");
const id = "experience-release:v1:10000000-0000-4000-8000-000000000001";
const sha = character => "sha256:" + character.repeat(64);
const clone = value => structuredClone(value);
const binding = {
  version: 1, operation: "publish", channel: "managed-fixture", experienceId: "model3d",
  releaseHash: sha("1"), sourceHash: sha("2"), buildHash: sha("3"), evaluationHash: sha("4"),
  expectedHead: { revision: 0, eventId: null }, rollbackPublicationEventId: null,
};
const intent = {
  version: 1, requestId: "20000000-0000-4000-8000-000000000002", title: "3D model", ownerUserId: "review-author",
  evidence: "Fixture", dependencyIds: ["delivery:dependency"], binding,
};
const decision = {
  decisionId: id, title: intent.title, audience: "product", status: "planned", ownerUserId: intent.ownerUserId,
  owner: "Author", evidence: intent.evidence, dependencyIds: [...intent.dependencyIds],
  createdAt: "2026-09-05T00:00:00.000Z", updatedAt: "2026-09-05T00:00:00.000Z",
};
async function proposed() {
  return { decision: clone(decision), binding: clone(binding), bindingHash: await experienceBindingDigest(binding),
    qualification: "fixture", generationAvailable: false };
}
async function decisionRead() {
  return { ...await proposed(), approvalEventId: null, approvalEligible: false, canPublish: false };
}
async function onFirstDigest(effect, run) {
  const target = crypto.subtle, own = Object.getOwnPropertyDescriptor(target, "digest"), original = target.digest;
  let entered = 0;
  Object.defineProperty(target, "digest", { configurable: true, value: async function (...args) {
    if (++entered === 1) effect(); return original.apply(this, args);
  } });
  try { const result = await run(); assert.ok(entered > 0); return result; }
  finally { if (own) Object.defineProperty(target, "digest", own); else delete target.digest; }
}

test("Experience review head parser keeps exact CAS identity without inventing actor approval", () => {
  const absent = { head: null, eligible: false, qualification: "fixture", generationAvailable: false };
  assert.deepEqual(readExperienceReviewHead(absent, "model3d"), { revision: 0, eventId: null });
  assert.equal(readExperienceReviewHead({ ...absent, eligible: true }, "model3d"), null);
  const present = { ...absent, eligible: true, head: { experienceId: "model3d", channel: "managed-fixture", revision: 2,
    publicationEventId: "experience-publication:fixture", decisionId: id, bindingHash: sha("5"), releaseHash: sha("1") } };
  const parsed = readExperienceReviewHead(present, "model3d");
  assert.deepEqual(parsed, { revision: 2, eventId: "experience-publication:fixture" });
  assert.ok(Object.isFrozen(parsed)); assert.equal(Object.hasOwn(parsed, "canApprove"), false);
  for (const mutate of [
    value => { value.canApprove = true; }, value => { value.generationAvailable = true; },
    value => { value.head.experienceId = "scene"; }, value => { value.head.revision = 0; },
    value => { value.head.publicationEventId = ""; }, value => { value.head.bindingHash = "invalid"; },
  ]) { const changed = clone(present); mutate(changed); assert.equal(readExperienceReviewHead(changed, "model3d"), null); }
  let calls = 0; const getter = { ...absent };
  Object.defineProperty(getter, "head", { enumerable: true, get() { calls++; return present.head; } });
  assert.equal(readExperienceReviewHead(getter, "model3d"), null); assert.equal(calls, 0);
});

test("Experience decision review parser retains only exact immutable decision and binding fields", async () => {
  const value = await decisionRead(), parsed = await readExperienceReviewDecision(value, id);
  assert.deepEqual(parsed, { decision: value.decision, binding: value.binding, bindingHash: value.bindingHash,
    approvalEventId: null, approvalEligible: false });
  assert.ok(Object.isFrozen(parsed) && Object.isFrozen(parsed.decision.dependencyIds) && Object.isFrozen(parsed.binding.expectedHead));
  assert.equal(parsed.approvalEligible, false); assert.equal(Object.hasOwn(parsed, "canApprove"), false);
  for (const mutate of [
    value => { value.decision.decisionId = id.replace(/1$/, "3"); }, value => { value.decision.status = "unknown"; },
    value => { value.decision.title = "x".repeat(161); }, value => { value.bindingHash = sha("f"); },
    value => { value.decision.dependencyIds.push(value.decision.dependencyIds[0]); },
    value => { value.approvalEligible = "true"; }, value => { value.canPublish = true; },
    value => { value.decision.canApprove = true; }, value => { value.generationAvailable = true; },
  ]) { const changed = clone(value); mutate(changed); assert.equal(await readExperienceReviewDecision(changed, id), null); }
  let calls = 0; const getter = clone(value);
  Object.defineProperty(getter.decision, "title", { enumerable: true, get() { calls++; return "Changed"; } });
  assert.equal(await readExperienceReviewDecision(getter, id), null); assert.equal(calls, 0);
  const changed = clone(value), captured = await onFirstDigest(() => {
    changed.decision.title = "Changed after capture"; changed.binding.expectedHead.revision = 9;
  }, () => readExperienceReviewDecision(changed, id));
  assert.deepEqual(captured, parsed);
});

test("Experience proposal result parser requires the exact original planned decision and all material/head bindings", async () => {
  const value = await proposed(), parsed = await readExperienceReviewProposalResult(value, intent);
  assert.deepEqual(parsed, { decision: value.decision, binding: value.binding, bindingHash: value.bindingHash });
  for (const mutate of [
    value => { value.decision.title = "Different title"; }, value => { value.decision.ownerUserId = "another-owner"; },
    value => { value.decision.evidence = "Different evidence"; }, value => { value.decision.dependencyIds = []; },
    value => { value.decision.status = "approved"; }, value => { value.decision.updatedAt = "2026-09-05T00:00:00.001Z"; },
    value => { value.binding.releaseHash = sha("a"); }, value => { value.binding.sourceHash = sha("a"); },
    value => { value.binding.buildHash = sha("a"); }, value => { value.binding.evaluationHash = sha("a"); },
    value => { value.binding.expectedHead = { revision: 1, eventId: "another-head" }; },
    value => { value.bindingHash = sha("f"); }, value => { value.qualification = "production"; },
    value => { value.generationAvailable = true; }, value => { value.canPublish = true; },
  ]) { const changed = clone(value); mutate(changed); assert.equal(await readExperienceReviewProposalResult(changed, intent), null); }
  const changed = clone(value), expected = clone(intent);
  assert.deepEqual(await onFirstDigest(() => { changed.decision.title = "Changed"; expected.title = "Changed"; },
    () => readExperienceReviewProposalResult(changed, expected)), parsed);
});

test("Experience receipt identity and proposal result semantics are separate required checks", async () => {
  const result = await proposed(); result.decision.title = "Wrong acknowledgment";
  const actorUserId = "review-author";
  const body = { receipt: { version: 1, protocol: "forma-experience-release@1", operation: "proposal",
    requestId: intent.requestId, actorUserId, intentDigest: await experienceIntentDigest("proposal", actorUserId, intent),
    eventId: "experience-proposal:fixture", sequence: 1, acknowledgmentDigest: await digest(result) }, result };
  const receipt = await readExperienceOperationReceipt(body, { operation: "proposal", actorUserId, intent });
  assert.ok(receipt, "the generic byte-bound receipt is not a decision-field validator");
  assert.equal(await readExperienceReviewProposalResult(receipt.result, intent), null);
  assert.equal(await readExperienceOperationReceipt(body, { operation: "proposal", actorUserId: "different-actor", intent }), null);
});


const publicationEvent = "30000000-0000-4000-8000-000000000003";
async function publicationResult() {
  const bindingHash = await experienceBindingDigest(binding);
  return { decisionId: id, binding: clone(binding), bindingHash,
    head: { experienceId: binding.experienceId, channel: "managed-fixture", revision: 1,
      publicationEventId: publicationEvent, decisionId: id, bindingHash, releaseHash: binding.releaseHash },
    qualification: "fixture", generationAvailable: false };
}
const publicationIntent = () => ({ version: 1, requestId: "40000000-0000-4000-8000-000000000004", decisionId: id,
  expectedDecisionUpdatedAt: "2026-09-05T00:00:00.003Z", approvalEventId: "approval:fixture", binding: clone(binding) });
async function originalPublication() {
  const result = await publicationResult(), publication = publicationIntent(), actorUserId = "release-publisher";
  return { receipt: { version: 1, protocol: "forma-experience-release@1", operation: "publication", requestId: publication.requestId,
    actorUserId, intentDigest: await experienceIntentDigest("publication", actorUserId, publication), eventId: publicationEvent,
    sequence: 5, acknowledgmentDigest: await digest(result) }, result };
}

test("Experience governance retains approval and current head eligibility without creating actor authority", async () => {
  const value = await decisionRead(); value.decision.status = "approved";
  value.approvalEventId = "approval:fixture"; value.approvalEligible = true;
  const parsed = await readExperienceReviewDecision(value, id);
  assert.equal(parsed.approvalEventId, value.approvalEventId); assert.equal(parsed.approvalEligible, true);
  assert.equal(Object.hasOwn(parsed, "canApprove"), false); assert.equal(Object.hasOwn(parsed, "canPublish"), false);
  for (const mutate of [row => { row.approvalEventId = null; }, row => { row.decision.status = "passed"; }]) {
    const invalid = clone(value); mutate(invalid); assert.equal(await readExperienceReviewDecision(invalid, id), null);
  }
  value.approvalEligible = false;
  assert.equal((await readExperienceReviewDecision(value, id)).approvalEventId, "approval:fixture", "retained approval is not erased by live ineligibility");
  const result = await publicationResult(), head = { head: result.head, eligible: false, qualification: "fixture", generationAvailable: false };
  assert.deepEqual(readExperienceReviewHeadState(head, "model3d"), { expectedHead: { revision: 1, eventId: publicationEvent }, eligible: false });
  assert.deepEqual(readExperienceReviewHeadState({ head: null, eligible: false, qualification: "fixture", generationAvailable: false }, "model3d"),
    { expectedHead: { revision: 0, eventId: null }, eligible: false });
});

test("Experience transition acknowledgment requires the original revision, lifecycle, fields and immutable binding", async () => {
  const previous = await readExperienceReviewDecision(await decisionRead(), id);
  const transition = { version: 1, requestId: "50000000-0000-4000-8000-000000000005", decisionId: id,
    expectedUpdatedAt: previous.decision.updatedAt, title: previous.decision.title, ownerUserId: previous.decision.ownerUserId,
    evidence: "Recorded review", status: "running", experienceRelease: clone(binding) };
  const value = await proposed(); value.decision.evidence = transition.evidence; value.decision.status = "running";
  value.decision.updatedAt = "2026-09-05T00:00:00.001Z";
  const eventId = experienceTransitionEventId(id, value.decision.updatedAt);
  const parsed = await readExperienceReviewTransitionResult(value, transition, previous, eventId); assert.ok(parsed);
  for (const mutate of [row => { row.decision.decisionId = id.replace(/1$/, "3"); }, row => { row.decision.status = "approved"; },
    row => { row.decision.title = "Other"; }, row => { row.decision.ownerUserId = "other"; }, row => { row.decision.evidence = "Other"; },
    row => { row.decision.createdAt = row.decision.updatedAt; }, row => { row.decision.updatedAt = previous.decision.updatedAt; },
    row => { row.decision.dependencyIds = []; }, row => { row.binding.sourceHash = sha("f"); }, row => { row.bindingHash = sha("a"); },
    row => { row.generationAvailable = true; }]) {
    const invalid = clone(value); mutate(invalid); assert.equal(await readExperienceReviewTransitionResult(invalid, transition, previous, eventId), null);
  }
  assert.equal(await readExperienceReviewTransitionResult(value, { ...transition, expectedUpdatedAt: value.decision.updatedAt }, previous, eventId), null);
  assert.equal(await readExperienceReviewTransitionResult({ ...value, decision: { ...value.decision, status: "approved" } }, { ...transition, status: "approved" }, previous, eventId), null);
  assert.equal(await readExperienceReviewTransitionResult(value, transition, {}, eventId), null);
  assert.equal(await readExperienceReviewTransitionResult(value, transition, previous, "substituted-event"), null);
  const actorUserId = "review-author", wrongEvent = { receipt: { version: 1, protocol: "forma-experience-release@1", operation: "transition",
    requestId: transition.requestId, actorUserId, intentDigest: await experienceIntentDigest("transition", actorUserId, transition),
    eventId: "substituted-event", sequence: 3, acknowledgmentDigest: await digest(value) }, result: value };
  const generic = await readExperienceOperationReceipt(wrongEvent, { operation: "transition", actorUserId, intent: transition });
  assert.ok(generic); assert.equal(await readExperienceReviewTransitionResult(generic.result, transition, previous, generic.receipt.eventId), null);
  const mutableValue = clone(value), mutableIntent = clone(transition), mutablePrevious = clone(previous);
  assert.deepEqual(await onFirstDigest(() => {
    mutableValue.decision.title = "Changed"; mutableIntent.title = "Changed"; mutablePrevious.decision.createdAt = value.decision.updatedAt;
  }, () => readExperienceReviewTransitionResult(mutableValue, mutableIntent, mutablePrevious, eventId)), parsed);
});

test("Experience publication acknowledgment requires exact original binding, event and atomic successor head", async () => {
  const value = await publicationResult(), intent = publicationIntent();
  const parsed = await readExperienceReviewPublicationResult(value, intent, publicationEvent); assert.ok(parsed);
  assert.ok(Object.isFrozen(parsed.head) && Object.isFrozen(parsed.binding));
  for (const mutate of [row => { row.decisionId = id.replace(/1$/, "3"); }, row => { row.head.revision = 2; },
    row => { row.head.publicationEventId = "another-publication"; }, row => { row.head.decisionId = id.replace(/1$/, "3"); },
    row => { row.head.releaseHash = sha("a"); }, row => { row.head.bindingHash = sha("b"); },
    row => { row.head.channel = "public"; }, row => { row.binding.buildHash = sha("f"); }, row => { row.generationAvailable = true; }]) {
    const invalid = clone(value); mutate(invalid); assert.equal(await readExperienceReviewPublicationResult(invalid, intent, publicationEvent), null);
  }
  const mutableValue = clone(value), mutableIntent = clone(intent);
  assert.deepEqual(await onFirstDigest(() => { mutableValue.head.revision = 9; mutableIntent.binding.releaseHash = sha("f"); },
    () => readExperienceReviewPublicationResult(mutableValue, mutableIntent, publicationEvent)), parsed);
  const wrong = clone(value); wrong.head.revision = 2;
  const body = await originalPublication(); body.result = wrong; body.receipt.acknowledgmentDigest = await digest(wrong);
  const generic = await readExperienceOperationReceipt(body, { operation: "publication", actorUserId: body.receipt.actorUserId, intent });
  assert.ok(generic); assert.equal(await readExperienceReviewPublicationResult(generic.result, intent, generic.receipt.eventId), null);
});

test("Experience exact historical publication reads retain result custody without inventing missing intent or current eligibility", async () => {
  const body = await originalPublication(), parsed = await readExperienceReviewHistoricalPublication(body, publicationEvent); assert.ok(parsed);
  assert.equal(parsed.eventId, publicationEvent); assert.equal(Object.hasOwn(parsed, "eligible"), false);
  assert.equal(Object.hasOwn(parsed, "intent"), false); assert.equal(Object.hasOwn(parsed, "canPublish"), false);
  for (const mutate of [row => { row.receipt.operation = "proposal"; }, row => { row.receipt.eventId = "other"; },
    row => { row.receipt.requestId = "invalid"; }, row => { row.receipt.sequence = 0; }, row => { row.receipt.actorUserId = ""; },
    row => { row.receipt.acknowledgmentDigest = sha("f"); }, row => { row.result.head.revision = 7; },
    row => { row.result.binding.releaseHash = sha("a"); }, row => { row.canPublish = true; }]) {
    const invalid = clone(body); mutate(invalid); assert.equal(await readExperienceReviewHistoricalPublication(invalid, publicationEvent), null);
  }
  const mutable = clone(body);
  assert.deepEqual(await onFirstDigest(() => { mutable.result.head.revision = 9; mutable.receipt.acknowledgmentDigest = sha("f"); },
    () => readExperienceReviewHistoricalPublication(mutable, publicationEvent)), parsed);
  let calls = 0; const getter = clone(body);
  Object.defineProperty(getter.result, "binding", { enumerable: true, get() { calls++; return binding; } });
  assert.equal(await readExperienceReviewHistoricalPublication(getter, publicationEvent), null); assert.equal(calls, 0);
});

test("Experience rollback publication requires its own exact operation, predecessor head and target binding", async () => {
  const rollback = { ...clone(binding), operation: "rollback", rollbackPublicationEventId: publicationEvent,
    expectedHead: { revision: 2, eventId: "second-publication" } };
  const rollbackEvent = "rollback-publication", rollbackHash = await experienceBindingDigest(rollback);
  const intent = { ...publicationIntent(), approvalEventId: "new-independent-approval", binding: rollback };
  const result = { ...await publicationResult(), binding: rollback, bindingHash: rollbackHash,
    head: { ...(await publicationResult()).head, revision: 3, publicationEventId: rollbackEvent, bindingHash: rollbackHash } };
  assert.ok(await readExperienceReviewPublicationResult(result, intent, rollbackEvent));
  assert.equal(await readExperienceReviewPublicationResult(result, publicationIntent(), rollbackEvent), null);
  assert.equal(await readExperienceReviewPublicationResult(result, { ...intent, binding: { ...rollback, rollbackPublicationEventId: "different-target" } }, rollbackEvent), null);
});

// Maintenance request capture uses the actual Review export. These are pure
// caller-boundary checks, not DOM, backend preview or publication qualification.
const { captureExperienceReviewMaintenanceRequest } = await ports.loadActual("src/apps/product/experience-review.ts");
function maintenanceRequestFixture() {
  const base = { releaseHash: sha("1"), sourceHash: sha("2"), buildHash: sha("3"), evaluationHash: sha("4") };
  const review = { version: 1, qualification: "fixture", generationAvailable: false, canPublish: false, base: clone(base),
    review: { baselineObservationHash: sha("5"), currentObservationHash: sha("6"), status: "compatibility-review",
      changes: { sources: ["model3d-viewer"], contracts: ["viewer"] } } };
  const patch = { schemaVersion: 1, baseReleaseHash: base.releaseHash, operations: [
    { kind: "set-layout", layout: "stacked-stage" }, { kind: "reorder-decisions", ids: ["direction", "subject"] },
  ] };
  return { base, review, patch };
}

test("Experience maintenance request captures the exact selected base, retained pair and authored layout/order patch", () => {
  for (const operations of [
    [{ kind: "set-layout", layout: "stacked-stage" }],
    [{ kind: "reorder-decisions", ids: ["direction", "subject"] }],
    [{ kind: "set-layout", layout: "stage-and-controls" }, { kind: "reorder-decisions", ids: ["subject", "direction"] }],
  ]) {
    const { base, review, patch } = maintenanceRequestFixture(); patch.operations = operations;
    assert.deepEqual(captureExperienceReviewMaintenanceRequest(base, review, patch), {
      version: 1, base, baselineObservationHash: review.review.baselineObservationHash,
      currentObservationHash: review.review.currentObservationHash, patch,
    });
  }
  const { base, review, patch } = maintenanceRequestFixture();
  review.review = { ...review.review, currentObservationHash: review.review.baselineObservationHash,
    status: "unchanged", changes: { sources: [], contracts: [] } };
  assert.deepEqual(captureExperienceReviewMaintenanceRequest(base, review, patch), {
    version: 1, base, baselineObservationHash: review.review.baselineObservationHash,
    currentObservationHash: review.review.currentObservationHash, patch,
  });
});

test("Experience maintenance request is a read-only snapshot independent of every caller-owned input", () => {
  const { base, review, patch } = maintenanceRequestFixture();
  const expected = clone({ version: 1, base, baselineObservationHash: review.review.baselineObservationHash,
    currentObservationHash: review.review.currentObservationHash, patch });
  const captured = captureExperienceReviewMaintenanceRequest(base, review, patch); assert.ok(captured);
  assert.ok(Object.isFrozen(captured) && Object.isFrozen(captured.base) && Object.isFrozen(captured.patch)
    && Object.isFrozen(captured.patch.operations) && captured.patch.operations.every(Object.isFrozen)
    && Object.isFrozen(captured.patch.operations[1].ids));
  base.sourceHash = sha("a"); review.base.buildHash = sha("b");
  review.review.baselineObservationHash = sha("c"); review.review.currentObservationHash = sha("d");
  patch.baseReleaseHash = sha("e"); patch.operations[0].layout = "stage-and-controls";
  patch.operations[1].ids.reverse(); patch.operations.push({ kind: "set-layout", layout: "stage-and-controls" });
  assert.deepEqual(captured, expected);
});

test("Experience maintenance request rejects absent pairs, stale selections, malformed patches and caller authority without invoking getters", () => {
  const valid = maintenanceRequestFixture();
  for (const review of [null, undefined, {}, { ...valid.review, review: null }, { ...valid.review, review: undefined }])
    assert.equal(captureExperienceReviewMaintenanceRequest(valid.base, review, valid.patch), null);
  for (const patch of [null, undefined, {}])
    assert.equal(captureExperienceReviewMaintenanceRequest(valid.base, valid.review, patch), null);
  for (const key of ["releaseHash", "sourceHash", "buildHash", "evaluationHash"]) {
    const { base, review, patch } = maintenanceRequestFixture(); base[key] = sha("f");
    assert.equal(captureExperienceReviewMaintenanceRequest(base, review, patch), null, key);
  }
  for (const mutate of [
    value => { value.patch.baseReleaseHash = sha("f"); },
    value => { value.patch.operations = []; },
    value => { value.patch.operations[1].ids = ["subject", "subject"]; },
    value => { value.patch.operations[0].layout = "unsupported"; },
    value => { value.patch.requestId = "caller-request"; },
    value => { value.patch.operations[0].canPublish = true; },
    value => { value.base.canPublish = true; },
    value => { value.review.canPublish = true; },
    value => { value.review.generationAvailable = true; },
    value => { value.review.preview = {}; },
    value => { value.review.review.baselineObservationHash = "invalid"; },
    value => { value.review.review.status = "proposal"; },
  ]) {
    const value = maintenanceRequestFixture(); mutate(value);
    assert.equal(captureExperienceReviewMaintenanceRequest(value.base, value.review, value.patch), null);
  }
  for (const target of ["base", "review", "patch"]) {
    const value = maintenanceRequestFixture(); let calls = 0;
    const key = { base: "releaseHash", review: "review", patch: "operations" }[target];
    Object.defineProperty(value[target], key, { enumerable: true, get() { calls++; throw new Error("getter invoked"); } });
    assert.equal(captureExperienceReviewMaintenanceRequest(value.base, value.review, value.patch), null, target);
    assert.equal(calls, 0, target);
  }
});

// Adoption operator readers use the same actual-module port and synthetic DTO
// fixtures. They prove closed client semantics, not DOM, Worker or device behavior.
const maintenanceReview = await ports.loadActual("src/experiences/maintenance-adoption-review-contract.ts");
const maintenanceProtocol = await ports.loadActual("src/experiences/maintenance-adoption-contract.ts");
const maintenanceId = "experience-maintenance:v1:10000000-0000-4000-8000-000000000001";
const maintenanceFlags = { version: 1, protocol: "forma-experience-maintenance-adoption@1", qualification: "fixture", generationAvailable: false, canPublish: false };
async function adoptionReviewFixture() {
  const base = { releaseHash: sha("1"), sourceHash: sha("2"), buildHash: sha("3"), evaluationHash: sha("4") };
  const binding = { version: 1, operation: "adopt-baseline", channel: "managed-fixture", experienceId: "model3d", material: clone(base),
    target: { observationHash: sha("5"), profileRef: "model3d.code-declarations@1", profileHash: sha("6"), inventoryHash: sha("7") },
    reviewed: { baselineObservationHash: sha("5"), currentObservationHash: sha("5") }, eligibilityHash: sha("8"),
    expectedAdoption: { revision: 0, eventId: null, baselineObservationHash: null, profileRef: null, profileHash: null } };
  const bindingHash = await maintenanceProtocol.maintenanceBindingDigest(binding), subjectHash = await maintenanceProtocol.maintenanceSubjectDigest(binding);
  const proposal = { ...clone(intent), binding: clone(binding), title: "Model baseline" };
  const decision = { ...clone(decisionTemplate), decisionId: maintenanceId, title: proposal.title };
  const head = { subjectHash, experienceId: "model3d", channel: "managed-fixture", revision: 1, adoptionEventId: publicationEvent,
    decisionId: maintenanceId, bindingHash, baselineObservationHash: binding.target.observationHash,
    profileRef: binding.target.profileRef, profileHash: binding.target.profileHash, inventoryHash: binding.target.inventoryHash };
  return { base, binding, bindingHash, subjectHash, proposal, decision, head,
    nominations: { ...maintenanceFlags, base: clone(base), experienceId: "model3d", subjectHash,
      headState: { status: "absent", head: null }, nominations: [{ binding: clone(binding), bindingHash }] },
    decisionRead: { ...maintenanceFlags, base: clone(base), experienceId: "model3d", subjectHash, decision: clone(decision),
      binding: clone(binding), bindingHash, approvalEventId: null, eligible: false, headState: { status: "absent", head: null } },
    proposalResult: { ...maintenanceFlags, decision: clone(decision), binding: clone(binding), bindingHash } };
}
// The existing release decision remains untouched; only the namespace/title vary.
const decisionTemplate = decision;
async function adoptionAcknowledgment(operation, intent, result, { actorUserId = "review-author", eventId = publicationEvent } = {}) {
  return { receipt: { version: 1, protocol: maintenanceFlags.protocol, operation, requestId: intent.requestId, actorUserId,
    intentDigest: await maintenanceProtocol.maintenanceIntentDigest(operation, actorUserId, intent), eventId, sequence: 4,
    acknowledgmentDigest: await digest(result) }, result: clone(result) };
}

test("Maintenance operator nominations require exact material, sorted binding digests and no caller authority", async () => {
  const f = await adoptionReviewFixture(), expected = { base: f.base, experienceId: "model3d" };
  assert.deepEqual(await maintenanceReview.readMaintenanceAdoptionNominations(f.nominations, expected), f.nominations);
  for (const mutate of [
    value => { value.base.sourceHash = sha("f"); }, value => { value.subjectHash = sha("f"); }, value => { value.experienceId = "audio"; },
    value => { value.nominations[0].bindingHash = sha("f"); }, value => { value.nominations[0].binding.target.observationHash = sha("f"); },
    value => { value.nominations.push(clone(value.nominations[0])); }, value => { value.nominations = Array(65).fill(value.nominations[0]); },
    value => { value.canPublish = true; }, value => { value.canApprove = true; }, value => { value.generationAvailable = true; },
    value => { value.captures = []; }, value => { value.nominations[0].approved = true; },
  ]) {
    const value = clone(f.nominations); mutate(value);
    assert.equal(await maintenanceReview.readMaintenanceAdoptionNominations(value, expected), null);
  }
  const alternate = clone(f.binding); alternate.eligibilityHash = sha("9");
  const choices = [f.nominations.nominations[0], { binding: alternate, bindingHash: await maintenanceProtocol.maintenanceBindingDigest(alternate) }]
    .sort((a, b) => a.bindingHash < b.bindingHash ? -1 : 1);
  assert.ok(await maintenanceReview.readMaintenanceAdoptionNominations({ ...f.nominations, nominations: choices }, expected));
  assert.equal(await maintenanceReview.readMaintenanceAdoptionNominations({ ...f.nominations, nominations: [...choices].reverse() }, expected), null);
  const mutable = clone(f.nominations), selection = clone(expected);
  assert.deepEqual(await onFirstDigest(() => {
    mutable.nominations[0].binding.eligibilityHash = sha("f"); selection.base.buildHash = sha("f");
  }, () => maintenanceReview.readMaintenanceAdoptionNominations(mutable, selection)), f.nominations);
  let calls = 0;
  for (const target of ["response", "selection"]) {
    const value = clone(f.nominations), selected = clone(expected);
    Object.defineProperty(target === "response" ? value : selected, target === "response" ? "nominations" : "base",
      { enumerable: true, get() { calls++; throw new Error("getter invoked"); } });
    assert.equal(await maintenanceReview.readMaintenanceAdoptionNominations(value, selected), null);
  }
  assert.equal(calls, 0);
});

test("Maintenance operator head states preserve unavailable custody and require every expected predecessor identity", async () => {
  const f = await adoptionReviewFixture(), expected = { base: f.base, experienceId: "model3d" };
  const subject = { ...expected, subjectHash: f.subjectHash };
  assert.deepEqual(await maintenanceReview.readMaintenanceAdoptionHead(f.head, expected), f.head);
  assert.equal(await maintenanceReview.readMaintenanceAdoptionHead(null, expected), null);
  assert.equal(await maintenanceReview.readMaintenanceAdoptionHead({ ...f.head, subjectHash: sha("f") }, expected), null);
  for (const status of ["absent", "corrupt", "ineligible"]) {
    const headState = { status, head: status === "ineligible" ? f.head : null }, value = { ...f.nominations, headState, nominations: [] };
    assert.deepEqual(await maintenanceReview.readMaintenanceAdoptionNominations(value, expected), value);
    assert.equal(maintenanceReview.maintenanceBindingMatchesHead(f.binding, headState, subject), status === "absent");
    if (status !== "absent") assert.equal(await maintenanceReview.readMaintenanceAdoptionNominations({ ...value, nominations: f.nominations.nominations }, expected), null);
  }
  const replacement = clone(f.binding);
  replacement.target.observationHash = sha("9"); replacement.reviewed.currentObservationHash = sha("9");
  replacement.expectedAdoption = { revision: f.head.revision, eventId: f.head.adoptionEventId,
    baselineObservationHash: f.head.baselineObservationHash, profileRef: f.head.profileRef, profileHash: f.head.profileHash };
  const value = { ...f.nominations, headState: { status: "eligible", head: clone(f.head) },
    nominations: [{ binding: replacement, bindingHash: await maintenanceProtocol.maintenanceBindingDigest(replacement) }] };
  assert.ok(await maintenanceReview.readMaintenanceAdoptionNominations(value, expected));
  for (const key of ["revision", "adoptionEventId", "baselineObservationHash", "profileRef", "profileHash", "subjectHash"]) {
    const changed = clone(value);
    changed.headState.head[key] = key === "revision" ? 2 : key === "adoptionEventId" ? "another-adoption"
      : key === "profileRef" ? "model3d.code-declarations@2" : sha("f");
    assert.equal(await maintenanceReview.readMaintenanceAdoptionNominations(changed, expected), null, key);
  }
  assert.equal(maintenanceReview.maintenanceBindingMatchesHead(replacement, value.headState, { ...subject, subjectHash: sha("f") }), false);
  const foreign = clone(replacement); foreign.material.sourceHash = sha("f");
  assert.equal(maintenanceReview.maintenanceBindingMatchesHead(foreign, value.headState, subject), false,
    "equal predecessor identities cannot move a binding between exact material subjects");
  const foreignInitial = clone(f.binding); foreignInitial.material.sourceHash = sha("f");
  assert.equal(maintenanceReview.maintenanceBindingMatchesHead(foreignInitial, { status: "absent", head: null }, subject), false);
});

test("Maintenance operator decision reader retains stale records but never invents current approval or actor capability", async () => {
  const f = await adoptionReviewFixture(), approved = clone(f.decisionRead);
  approved.decision.status = "approved"; approved.decision.updatedAt = "2026-09-05T00:00:00.003Z";
  approved.approvalEventId = maintenanceProtocol.maintenanceTransitionEventId(maintenanceId, approved.decision.updatedAt); approved.eligible = true;
  approved.headState = { status: "eligible", head: f.head };
  const parsed = await maintenanceReview.readMaintenanceAdoptionDecision(approved, maintenanceId);
  assert.deepEqual(parsed, approved);
  assert.equal(maintenanceReview.maintenanceBindingMatchesHead(parsed.binding, parsed.headState,
    { base: parsed.base, experienceId: parsed.experienceId, subjectHash: parsed.subjectHash }), false,
    "the original initial decision stays readable after a head exists, without becoming a current replacement");
  for (const value of [{ ...approved, eligible: false, approvalEventId: null },
    { ...approved, eligible: false, headState: { status: "ineligible", head: f.head } },
    { ...approved, eligible: false, headState: { status: "corrupt", head: null } }])
    assert.deepEqual(await maintenanceReview.readMaintenanceAdoptionDecision(value, maintenanceId), value);
  for (const owner of ["", "  Display label  ", "x".repeat(8192)]) {
    const value = { ...approved, decision: { ...approved.decision, owner } };
    assert.deepEqual(await maintenanceReview.readMaintenanceAdoptionDecision(value, maintenanceId), value);
  }
  for (const mutate of [
    value => { value.approvalEventId = null; }, value => { value.approvalEventId = "unrelated-approval"; },
    value => { value.decision.status = "planned"; }, value => { value.bindingHash = sha("f"); },
    value => { value.base.evaluationHash = sha("f"); }, value => { value.decision.dependencyIds.push(value.decision.dependencyIds[0]); },
    value => { value.decision.decisionId = "experience-maintenance:v2:10000000-0000-4000-8000-000000000001"; },
    value => { value.canApprove = true; }, value => { value.eligible = "true"; },
    value => { value.decision.owner = "x".repeat(8193); },
  ]) {
    const changed = clone(approved); mutate(changed);
    assert.equal(await maintenanceReview.readMaintenanceAdoptionDecision(changed, maintenanceId), null);
  }
  assert.equal(await maintenanceReview.readMaintenanceAdoptionDecision(approved, id), null, "release and maintenance decisions are separate protocols");
  const mutable = clone(approved);
  assert.deepEqual(await onFirstDigest(() => { mutable.decision.title = "Changed"; mutable.headState.head.revision = 9; },
    () => maintenanceReview.readMaintenanceAdoptionDecision(mutable, maintenanceId)), approved);
});

test("Maintenance operator proposal acknowledgment validates decision semantics after byte-bound receipt admission", async () => {
  const f = await adoptionReviewFixture(), body = await adoptionAcknowledgment("maintenance-proposal", f.proposal, f.proposalResult);
  const expected = { operation: "maintenance-proposal", actorUserId: body.receipt.actorUserId, intent: f.proposal };
  assert.deepEqual(await maintenanceReview.readMaintenanceAdoptionAcknowledgment(body, expected), body);
  for (const mutate of [value => { value.decision.title = "Other"; }, value => { value.decision.status = "approved"; },
    value => { value.decision.ownerUserId = "another-owner"; }, value => { value.decision.dependencyIds = []; },
    value => { value.decision.updatedAt = "2026-09-05T00:00:00.001Z"; }, value => { value.bindingHash = sha("f"); },
    value => { value.canPublish = true; }]) {
    const changed = clone(body); mutate(changed.result); changed.receipt.acknowledgmentDigest = await digest(changed.result);
    assert.ok(await maintenanceProtocol.readMaintenanceOperationReceipt(changed, expected));
    assert.equal(await maintenanceReview.readMaintenanceAdoptionAcknowledgment(changed, expected), null);
  }
  assert.equal(await maintenanceReview.readMaintenanceAdoptionAcknowledgment(body, { ...expected, actorUserId: "another-actor" }), null);
  assert.equal(await maintenanceReview.readMaintenanceAdoptionAcknowledgment(body, { ...expected, operation: "proposal" }), null);
});

test("Maintenance operator transition acknowledgment requires the exact prior decision, lifecycle and original transition event", async () => {
  const f = await adoptionReviewFixture(), priorDecision = clone(f.decision), transition = { version: 1,
    requestId: "50000000-0000-4000-8000-000000000005", decisionId: maintenanceId, expectedUpdatedAt: priorDecision.updatedAt,
    title: priorDecision.title, ownerUserId: priorDecision.ownerUserId, evidence: "Recorded evidence", status: "running", maintenanceAdoption: clone(f.binding) };
  const result = { ...f.proposalResult, decision: { ...clone(priorDecision), evidence: transition.evidence, status: "running", updatedAt: "2026-09-05T00:00:00.001Z" } };
  const eventId = maintenanceProtocol.maintenanceTransitionEventId(maintenanceId, result.decision.updatedAt);
  const body = await adoptionAcknowledgment("maintenance-transition", transition, result, { eventId });
  const expected = { operation: "maintenance-transition", actorUserId: body.receipt.actorUserId, intent: transition, priorDecision };
  assert.deepEqual(await maintenanceReview.readMaintenanceAdoptionAcknowledgment(body, expected), body);
  const missing = { ...expected }; delete missing.priorDecision;
  assert.equal(await maintenanceReview.readMaintenanceAdoptionAcknowledgment(body, missing), null);
  for (const mutate of [value => { value.decision.createdAt = value.decision.updatedAt; }, value => { value.decision.dependencyIds = []; },
    value => { value.decision.updatedAt = priorDecision.updatedAt; }, value => { value.decision.status = "approved"; }]) {
    const changed = clone(body); mutate(changed.result); changed.receipt.acknowledgmentDigest = await digest(changed.result);
    assert.ok(await maintenanceProtocol.readMaintenanceOperationReceipt(changed, { operation: expected.operation, actorUserId: expected.actorUserId, intent: expected.intent }));
    assert.equal(await maintenanceReview.readMaintenanceAdoptionAcknowledgment(changed, expected), null);
  }
  const changedEvent = { ...clone(body), receipt: { ...body.receipt, eventId: "substituted-event" } };
  assert.equal(await maintenanceReview.readMaintenanceAdoptionAcknowledgment(changedEvent, expected), null);
  const mutable = clone(body), mutableExpected = clone(expected);
  assert.deepEqual(await onFirstDigest(() => {
    mutable.result.decision.title = "Changed"; mutableExpected.intent.title = "Changed"; mutableExpected.priorDecision.dependencyIds = [];
  }, () => maintenanceReview.readMaintenanceAdoptionAcknowledgment(mutable, mutableExpected)), body);
  const coherent = async ({ previousStatus = "approval_required", nextStatus = "approved", evidence = "Recorded evidence", actorUserId = "independent-reviewer" } = {}) => {
    const previous = { ...clone(priorDecision), status: previousStatus };
    const authored = { ...clone(transition), status: nextStatus, evidence, ownerUserId: "replacement-owner" };
    const result = { ...clone(f.proposalResult), decision: { ...clone(previous), status: nextStatus, evidence,
      ownerUserId: authored.ownerUserId, updatedAt: "2026-09-05T00:00:00.001Z" } };
    const original = await adoptionAcknowledgment("maintenance-transition", authored, result, { actorUserId,
      eventId: maintenanceProtocol.maintenanceTransitionEventId(maintenanceId, result.decision.updatedAt) });
    return { original, expected: { operation: "maintenance-transition", actorUserId, intent: authored, priorDecision: previous } };
  };
  const independent = await coherent();
  assert.deepEqual(await maintenanceReview.readMaintenanceAdoptionAcknowledgment(independent.original, independent.expected), independent.original);
  for (const options of [{ previousStatus: "planned" }, { previousStatus: "running", nextStatus: "passed", evidence: "" },
    { actorUserId: priorDecision.ownerUserId }, { actorUserId: "replacement-owner" }]) {
    const value = await coherent(options), { priorDecision: _prior, ...receiptExpected } = value.expected;
    assert.ok(await maintenanceProtocol.readMaintenanceOperationReceipt(value.original, receiptExpected),
      "the complete altered intent and result remain a genuine byte-bound fixture receipt");
    assert.equal(await maintenanceReview.readMaintenanceAdoptionAcknowledgment(value.original, value.expected), null,
      "lifecycle, required evidence and independent approval remain separate semantic requirements");
  }
});

test("Maintenance operator adoption acknowledgment is its exact atomic successor, never a newer head", async () => {
  const f = await adoptionReviewFixture(), intent = { version: 1, requestId: "40000000-0000-4000-8000-000000000004", decisionId: maintenanceId,
    expectedDecisionUpdatedAt: "2026-09-05T00:00:00.003Z", approvalEventId: "approval:fixture", binding: clone(f.binding) };
  const result = { ...maintenanceFlags, decisionId: maintenanceId, binding: clone(f.binding), bindingHash: f.bindingHash, head: clone(f.head) };
  const body = await adoptionAcknowledgment("maintenance-adoption", intent, result), expected = { operation: "maintenance-adoption", actorUserId: body.receipt.actorUserId, intent };
  assert.deepEqual(await maintenanceReview.readMaintenanceAdoptionAcknowledgment(body, expected), body);
  for (const mutate of [value => { value.head.revision = 2; }, value => { value.head.adoptionEventId = "newer-event"; },
    value => { value.head.baselineObservationHash = sha("f"); }, value => { value.head.profileHash = sha("f"); },
    value => { value.head.inventoryHash = sha("f"); }, value => { value.head.subjectHash = sha("f"); },
    value => { value.head.decisionId = "experience-maintenance:v1:10000000-0000-4000-8000-000000000009"; }]) {
    const changed = clone(body); mutate(changed.result); changed.receipt.acknowledgmentDigest = await digest(changed.result);
    assert.ok(await maintenanceProtocol.readMaintenanceOperationReceipt(changed, expected));
    assert.equal(await maintenanceReview.readMaintenanceAdoptionAcknowledgment(changed, expected), null);
  }
  let calls = 0;
  const getter = clone(body); Object.defineProperty(getter.result, "head", { enumerable: true, get() { calls++; throw new Error("getter invoked"); } });
  assert.equal(await maintenanceReview.readMaintenanceAdoptionAcknowledgment(getter, expected), null); assert.equal(calls, 0);
  const mutable = clone(body), selected = clone(expected);
  assert.deepEqual(await onFirstDigest(() => { mutable.result.head.revision = 8; selected.intent.binding.material.sourceHash = sha("f"); },
    () => maintenanceReview.readMaintenanceAdoptionAcknowledgment(mutable, selected)), body);
});

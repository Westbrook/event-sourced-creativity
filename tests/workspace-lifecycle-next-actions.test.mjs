import assert from "node:assert/strict";
import test from "node:test";
import {
  creativeNextActions, creativeNextTargetAvailable, creativeOriginalJobContinuation,
  followCreativeNextTarget, retainCreativePreparation,
} from "../src/model/workspace-intelligence.ts";

// Pure policy fixtures only. No mounted host, server authority, bytes, provider,
// financial settlement or physical focus is certified by this file.
const formats = ["image", "short_story", "scene", "slides", "storyboard", "video", "audio"];
const scope = { projectId: "p", documentId: "d", canvasId: null, authorityKey: "actor-current", sourceGeneration: 7 };
const hash = "a".repeat(64);
const block = (id = "direction", extra = {}) => ({ id, projectId: "p", documentId: "d", canvasId: "",
  scope: "document", type: "direction", handle: "Direction " + id, position: "a", locked: false, removed: false,
  properties: { text: "A deliberate direction", weight: 1 }, sourceEvents: ["source-1"], ...extra });
const artifact = (id = "artifact", kind = "slides") => ({ id, documentId: "d", title: "Saved " + id, kind,
  sequence: 8, sourceEventId: "completed-" + id, contentRef: "content-" + id, provider: "retained-provider" });
const output = (id = "image", sequence = 7) => ({ id, documentId: "d", canvasId: null, title: id, sequence,
  quality: "high", purpose: "final", discarded: false, promptFanId: null, provider: "retained-provider", mediaUrl: "/api/media/" + id });
const job = (id = "job", extra = {}) => ({ jobId: id, documentId: "d", canvasId: null, kind: "render_document",
  sourceSurface: "document", status: "failed", requestedAt: "2026-08-27T01:00:00Z", dismissedAt: null,
  members: [], result: null, error: null, errorDetail: null, ...extra });
const task = (extra = {}) => ({ reviewId: "task", organizationId: "org", projectAccessId: "access",
  artifactId: "assigned-artifact", revision: 0, contentSha256: hash, title: "Assigned exact output",
  createdAt: "2026-08-27T00:00:00Z", ...extra });
const reference = (extra = {}) => ({ kind: "target", id: "target", authorizationScopeKey: scope.authorityKey,
  documentId: "d", projectId: "p", actorUserId: "actor", projectAccessId: null,
  revision: "r1", sourceRevision: "s1", requirementRevision: "q1", blockId: "requirement",
  planRevisionId: "plan", targetId: "target", targetContractDigest: "contract", resultId: null,
  resultRevision: null, assetId: null, assetSha256: null, grantId: null, operationId: null, jobId: null, ...extra });
const canonical = (extra = {}) => ({ reference: reference(), section: "inspect", refresh: false, urgency: "owed",
  title: "Exact owed output", labelKey: "output.delivery.actionCheck", label: "Check retained work and current requirements",
  reasonKey: "output.delivery.wholeScope", reason: "Whole confirmed scope", ...extra });
const delivery = (item, extra = {}) => ({ artifactId: item.id, sequence: item.sequence, revision: 0,
  sourceEventId: item.sourceEventId, contentRef: item.contentRef, action: "changes", intent: "review",
  proof: "recorded-exact-delivery-proof", title: item.title, reviewStatus: "changes-requested", ...extra });
const lifecycle = (extra = {}) => ({ sourceBlockIds: [], reviews: [], deliveries: [],
  output: { state: "ready", scopeKnown: true, requirementBlockIds: [], choices: [] }, ...extra });
const facts = (extra = {}) => ({ ...scope, canRead: true, canAuthor: true, canConfigure: true,
  blocks: [block()], outputs: [], artifacts: [], events: [], jobs: [], lifecycle: lifecycle(), ...extra });
const ports = calls => Object.fromEntries(["context", "configure", "output", "artifact", "job", "compare",
  "source-block", "assigned-review", "artifact-delivery", "canonical-output", "output-requirement"]
  .map(kind => [kind, target => { calls.push({ kind, target }); return true; }]));
const freeze = value => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value); Object.values(value).forEach(freeze);
  }
  return value;
};

test("shared lifecycle priority keeps one primary and two alternatives: exact source, original paid work, assigned review", () => {
  const state = facts({ jobs: [job("paid-slides", { result: { artifactKind: "slides", recoverablePresentationCandidate: true } })],
    outputs: [output()], lifecycle: lifecycle({ sourceBlockIds: ["direction"], reviews: [task()],
      output: { state: "ready", scopeKnown: true, requirementBlockIds: [], choices: [canonical()] } }) });
  const before = structuredClone(state), actions = creativeNextActions(freeze(state));
  assert.deepEqual(actions.map(row => row.target.kind), ["source-block", "job", "assigned-review"]);
  assert.equal(actions[1].id, "recover-job"); assert.equal(actions[1].target.jobId, "paid-slides");
  assert.equal(actions.length, 3); assert.deepEqual(state, before);
  const withoutSource = facts({ ...before, lifecycle: { ...before.lifecycle, sourceBlockIds: [] } });
  assert.deepEqual(creativeNextActions(withoutSource).map(row => row.target.kind), ["job", "assigned-review", "canonical-output"]);
});

for (const status of ["queued", "running", "committing"]) test("original " + status + " work precedes unrelated saved output", () => {
  const state = facts({ jobs: [job("original", { status })], outputs: [output()] });
  assert.equal(creativeNextActions(state)[0].id, "check-job");
  assert.equal(creativeNextActions(state)[0].target.jobId, "original");
});
for (const state of [
  { generationReceipt: { provider_request_status: "submission_unknown" } },
  { generationReceipt: { provider_request_status: "submitted", reservation_status: "executing" } },
  { generationReceipt: { reservation_status: "unknown" } },
]) test("explicit unresolved original evidence remains inspect-only " + JSON.stringify(state), async () => {
  const current = facts({ jobs: [job("original", { result: state })], outputs: [output()] }), action = creativeNextActions(current)[0], calls = [];
  assert.equal(action.id, "check-original-job"); assert.equal(action.target.continuation, "unknown");
  assert.equal(await followCreativeNextTarget(action.target, () => current, ports(calls)), true);
  assert.deepEqual(calls.map(row => row.kind), ["job"]); assert.equal(calls[0].target.jobId, "original");
});

for (const kind of ["slides", "video", "audio", "storyboard"]) test("nonretryable safety " + kind + " never becomes recovery", () => {
  const refused = job("refused", { result: { artifactKind: kind, recoverablePresentationCandidate: true,
    providerJobId: "accepted-original", storyboardProviderSubmission: "confirmed",
    generationReceipt: { provider_request_status: "submission_unknown", reservation_status: "executing" } },
    errorDetail: { code: "safety_rejected", category: "safety", scope: "request", action: "edit_request",
      message: "Retained refusal", retryable: false, httpStatus: 400, retryAfterMs: null, requestId: null } });
  const current = facts({ jobs: [refused], outputs: [output()] }), actions = creativeNextActions(current);
  assert.equal(creativeOriginalJobContinuation(refused), "inspect");
  assert.equal(actions[0].id, "inspect-job"); assert.equal(actions[0].target.continuation, "inspect");
  assert.ok(!actions.some(row => row.id === "recover-job"));
});

test("a failed optional sibling without recoverable or unresolved evidence does not block saved work", () => {
  const current = facts({ jobs: [job("optional-video", { result: { artifactKind: "video" },
    errorDetail: { category: "provider", code: "fal_422", retryable: false, httpStatus: 422 } })], artifacts: [artifact()] });
  assert.equal(creativeNextActions(current)[0].target.artifactId, "artifact");
  assert.equal(creativeNextActions(current).find(row => row.target.kind === "job").id, "inspect-job");
});
test("completed work and a settled canceled original are not mislabeled in progress", () => {
  assert.equal(creativeOriginalJobContinuation(job("done", { status: "completed" })), null);
  const stopped = job("paid-plan", { status: "canceled", kind: "structure_adaptive", planningExecutionId: "paid-plan",
    result: { planningStopBudget: { reservationStatus: "settled", billingStatus: "settled" } } });
  assert.equal(creativeOriginalJobContinuation(stopped), "inspect");
  assert.equal(creativeNextActions(facts({ jobs: [stopped] }))[0].id, "inspect-job");
});

test("changes and stale review precede an owed target, creation and comparison without inventing an approval", () => {
  const item = artifact(), current = facts({ artifacts: [item], outputs: [output("a"), output("b", 9)],
    lifecycle: lifecycle({ deliveries: [delivery(item)],
      output: { state: "ready", scopeKnown: true, requirementBlockIds: [], choices: [canonical()] } }) });
  const actions = creativeNextActions(current);
  assert.deepEqual(actions.map(row => row.target.kind), ["artifact-delivery", "canonical-output", "output"]);
  assert.equal(actions[0].target.intent, "review"); assert.equal(actions[0].labelKey, "artifact.delivery.action.changes");
  const stale = facts({ ...current, lifecycle: { ...current.lifecycle, deliveries: [delivery(item, { action: "sources", reviewStatus: "stale" })] } });
  assert.equal(creativeNextActions(stale)[0].labelKey, "artifact.delivery.action.sources");
});
for (const format of formats) test("existing exact " + format + " and deliberate preparation remain supported", async () => {
  const current = facts({ blocks: [block("direction", { properties: { text: "Direction", output_kind: format, weight: 1 } })],
    ...(format === "image" ? { outputs: [output()] } : { artifacts: [artifact("saved-" + format, format)] }) });
  const actions = creativeNextActions(current), calls = [];
  assert.equal(actions[0].id, "open-output");
  assert.equal(await followCreativeNextTarget(actions[0].target, () => current, ports(calls)), true);
  assert.deepEqual(calls.map(row => row.kind), [format === "image" ? "output" : "artifact"]);
  assert.equal(actions.find(row => row.id === "configure-output").target.medium, format);
});
test("comparison remains optional and last while source and selected pair identities stay exact", () => {
  const current = facts({ outputs: [output("old", 2), output("new", 4)] }), actions = creativeNextActions(current);
  assert.deepEqual(actions.map(row => row.id), ["open-output", "configure-output", "compare-images"]);
  assert.deepEqual(actions[2].target.outputIds, ["new", "old"]);
  assert.equal(creativeNextTargetAvailable(actions[2].target, { ...current, outputs: [output("new"), output("replacement")] }), false);
});

for (const state of ["loading", "refreshing", "unavailable"]) test("unknown Output " + state + " offers only an exact known requirement, not zero owed", () => {
  const requirement = block("known-output", { type: "output", properties: { label: "Known assignment" } });
  const current = facts({ blocks: [block(), requirement], lifecycle: lifecycle({ output: {
    state, scopeKnown: null, requirementBlockIds: [requirement.id], choices: [] } }) });
  const action = creativeNextActions(current)[0];
  assert.equal(action.target.kind, "output-requirement"); assert.equal(action.target.blockId, requirement.id);
  assert.equal(action.target.refresh, true); assert.equal(current.lifecycle.output.scopeKnown, null);
  assert.equal(Object.hasOwn(current.lifecycle.output, "owedCount"), false);
  assert.ok(!creativeNextActions(current).some(row => row.target.kind === "canonical-output"));
  assert.equal(creativeNextTargetAvailable(action.target, { ...current, blocks: [block()] }), false);
});
test("unknown read with no addressable Output stays unknown and never invents a default target", () => {
  const current = facts({ lifecycle: lifecycle({ output: { state: "unavailable", scopeKnown: null, requirementBlockIds: [], choices: [] } }) });
  assert.equal(current.lifecycle.output.scopeKnown, null);
  assert.deepEqual(creativeNextActions(current).map(row => row.target.kind), ["configure"]);
});
test("a job and its exact canonical operation use one recommendation slot", () => {
  const original = job("same-job", { status: "running" }), operation = canonical({
    urgency: "original", reference: reference({ kind: "operation", id: "op", operationId: "op", jobId: "same-job", grantId: "grant" }) });
  const current = facts({ jobs: [original], lifecycle: lifecycle({ output: {
    state: "ready", scopeKnown: true, requirementBlockIds: [], choices: [operation] } }) });
  assert.equal(creativeNextActions(current).filter(row => row.target.kind === "job" || row.target.kind === "canonical-output").length, 1);
});

test("new exact targets fail closed for source generation, scope and permission changes", async () => {
  const current = facts({ lifecycle: lifecycle({ sourceBlockIds: ["direction"] }) }), target = creativeNextActions(current)[0].target;
  for (const change of [{ sourceGeneration: 8 }, { authorityKey: "other" }, { documentId: "other" }, { projectId: "other" },
    { canvasId: "other" }, { canRead: false }, { blocks: [block("direction", { sourceEvents: ["source-1", "source-2"] })] }]) {
    const calls = []; assert.equal(await followCreativeNextTarget(target, () => ({ ...current, ...change }), ports(calls)), false);
    assert.deepEqual(calls, []);
  }
});
test("assigned review revalidates every exact binding and duplicate entries fail closed", async () => {
  const row = task(), current = facts({ lifecycle: lifecycle({ reviews: [row] }) }), target = creativeNextActions(current)[0].target;
  for (const change of [{ reviewId: "other" }, { organizationId: "other" }, { projectAccessId: "other" },
    { artifactId: "other" }, { revision: 1 }, { contentSha256: "b".repeat(64) }]) {
    const calls = [], changed = { ...current, lifecycle: lifecycle({ reviews: [{ ...row, ...change }] }) };
    assert.equal(await followCreativeNextTarget(target, () => changed, ports(calls)), false); assert.deepEqual(calls, []);
  }
  assert.equal(creativeNextTargetAvailable(target, { ...current, lifecycle: lifecycle({ reviews: [row, row] }) }), false);
});
test("delivery targets retain actual artifact, content reference, revision and fresh delivery proof", () => {
  const item = artifact(), row = delivery(item), current = facts({ artifacts: [item], lifecycle: lifecycle({ deliveries: [row] }) });
  const target = creativeNextActions(current)[0].target;
  assert.equal(target.kind, "artifact-delivery"); assert.equal(creativeNextTargetAvailable(target, current), true);
  for (const itemChange of [{ sourceEventId: "replacement" }, { contentRef: "replacement" }, { sequence: 9 }])
    assert.equal(creativeNextTargetAvailable(target, { ...current, artifacts: [{ ...item, ...itemChange }] }), false);
  assert.equal(creativeNextTargetAvailable(target, { ...current, lifecycle: lifecycle({ deliveries: [{ ...row, proof: "new-proof" }] }) }), false);
  assert.equal(creativeNextTargetAvailable(target, { ...current, events: [{ type: "DocumentArtifactEdited", payload: { artifact_id: item.id } }] }), false);
});
test("canonical reference, section and refresh choice must still occur in fresh authorized facts", () => {
  const row = canonical(), current = facts({ lifecycle: lifecycle({ output: { state: "ready", scopeKnown: true, requirementBlockIds: [], choices: [row] } }) });
  const target = creativeNextActions(current)[0].target;
  assert.equal(creativeNextTargetAvailable(target, current), true);
  for (const change of [{ reference: reference({ revision: "r2" }) }, { section: "native" }, { refresh: true }]) {
    const changed = { ...current, lifecycle: lifecycle({ output: { ...current.lifecycle.output, choices: [{ ...row, ...change }] } }) };
    assert.equal(creativeNextTargetAvailable(target, changed), false);
  }
  const foreign = { ...target, reference: reference({ projectId: "foreign" }) };
  assert.equal(creativeNextTargetAvailable(foreign, { ...current, lifecycle: lifecycle({ output: {
    ...current.lifecycle.output, choices: [{ ...row, reference: foreign.reference }] } }) }), false);
});
test("unwired new ports return false and never fall back to configuration or another object", async () => {
  const current = facts({ lifecycle: lifecycle({ sourceBlockIds: ["direction"] }) }), target = creativeNextActions(current)[0].target, calls = [];
  const existing = ports(calls); delete existing["source-block"];
  assert.equal(await followCreativeNextTarget(target, () => current, existing), false); assert.deepEqual(calls, []);
});
test("an editing preparation retains captured source generation while permitting its own current settings edits", () => {
  let current = facts(), guard = retainCreativePreparation(() => current);
  assert.equal(guard.beginEditing(), true);
  current = { ...current, blocks: [block("direction", { properties: { text: "Current settings edit" } })] };
  assert.equal(guard(), true);
  current = { ...current, sourceGeneration: 8 };
  assert.equal(guard(), false);
});

test("unmigrated consumers retain the exact original shared priority and target shape", () => {
  const current = facts({ lifecycle: undefined, outputs: [output("older", 2), output("newer", 4)],
    jobs: [job("running", { status: "running" }), job("failed")] });
  const actions = creativeNextActions(current);
  assert.deepEqual(actions.map(row => [row.id, row.priority]), [["open-output", 90], ["check-job", 85], ["compare-images", 75]]);
  assert.deepEqual(actions[0].target, { projectId: "p", documentId: "d", canvasId: null, authorityKey: "actor-current", kind: "output", outputId: "newer" });
  assert.equal(Object.hasOwn(actions[1].target, "continuation"), false);
});

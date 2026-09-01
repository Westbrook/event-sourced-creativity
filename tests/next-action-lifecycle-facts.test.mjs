import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { nextActionFacts } from "../src/state/next-action-context.ts";
import { creativeNextActions, creativeNextTargetAvailable } from "../src/model/workspace-intelligence.ts";
import { outputContinuationChoices } from "../src/components/output-continuation.ts";
import { captureOutputNavigation } from "../src/model/output-navigation.ts";
import * as requirements from "../src/model/output-requirements.ts";
import * as plan from "../src/model/output-plan.ts";
import * as inspection from "../src/model/output-asset-inspection.ts";
import { createOutputControllerFixture, FIXTURE_DOCUMENT_IDS } from "./output-controller-fixture-model.mjs";
import { createNextActionFactsPort, FACT_HASH } from "./helpers/next-action-facts-fixture.mjs";

const current = f => nextActionFacts(f.store, f.state.documentId, null, { lifecycle: true });
async function outputFacts(scenario = "ready") {
  const records = [], adapter = await createOutputControllerFixture({
    domain: { ...requirements, ...plan, ...inspection }, onRecord: row => records.push(row),
  });
  const documentId = FIXTURE_DOCUMENT_IDS[0], snapshot = adapter.seed(documentId, scenario);
  const f = createNextActionFactsPort({ projectId: snapshot.projectId, documentId, kind: null,
    actorUserId: snapshot.scope.actorUserId, outputRows: snapshot.requirements });
  f.state.authorityKey = adapter.scope().key;
  const permissions = ["project.read", ...(snapshot.permissions.canAuthor ? ["project.author"] : []),
    ...(snapshot.permissions.canRequest ? ["project.output.request"] : []), ...(snapshot.permissions.canReview ? ["project.review.approve"] : [])];
  f.state.session.capabilities = permissions;
  if (snapshot.scope.kind === "project") f.state.session.projectContext = {
    organizationId: snapshot.scope.organizationId, projectAccessId: snapshot.scope.projectAccessId,
    projectId: snapshot.projectId, ownerUserId: "other-owner", role: snapshot.permissions.canAuthor ? "editor" : "viewer", permissions,
  };
  f.state.read = { state: "ready", snapshot, error: null };
  f.state.jobs = adapter.jobs(documentId);
  return { ...f, adapter, records, snapshot };
}

test("facts opt-in leaves existing consumers and resource loading untouched", () => {
  const f = createNextActionFactsPort(), events = structuredClone(f.state.events);
  const base = nextActionFacts(f.store, f.state.documentId);
  assert.equal(Object.hasOwn(base, "lifecycle"), false); assert.equal(Object.hasOwn(base, "sourceGeneration"), false);
  assert.equal(f.state.sourceCaptures, 0); assert.deepEqual(f.calls, []);
  const enriched = current(f);
  assert.equal(enriched.sourceGeneration, 7); assert.equal(enriched.lifecycle.output.scopeKnown, null);
  assert.deepEqual(f.calls, [{ type: "resource", documentId: "d" }]); assert.deepEqual(f.state.events, events);
});
test("actual facts reuse current rights blockers and open their existing block rather than the composer", () => {
  const f = createNextActionFactsPort({ rightsRevoked: true }), before = structuredClone(f.state.events), value = current(f);
  assert.deepEqual(value.lifecycle.sourceBlockIds, ["direction"]);
  const action = creativeNextActions(value)[0];
  assert.equal(action.target.kind, "source-block"); assert.equal(action.target.blockId, "direction");
  assert.deepEqual(f.state.events, before); assert.equal(f.calls.length, 1);
});
test("actual source-excerpt blocker remains exact even with a valid rights receipt", () => {
  const f = createNextActionFactsPort({ kind: null });
  f.add("BlockCreated", { project_id: "p", document_id: "d", block_id: "source", type: "reference", handle: "Licensed PDF",
    properties: { weight: 1, reference_id: "reference", source_mime_type: "application/pdf", text: "", extraction_status: "unavailable" } });
  f.add("RightsAsserted", { reference_id: "reference", rights_class: "owned_or_licensed" });
  const value = current(f); assert.deepEqual(value.lifecycle.sourceBlockIds, ["source"]);
  assert.equal(creativeNextActions(value)[0].target.blockId, "source");
});
for (const withdrawn of ["source", "permission", "document", "project-context"]) test("facts withhold private candidates after " + withdrawn, () => {
  const f = createNextActionFactsPort({ shared: true, review: "requested" }); f.state.reviews = [f.reviewTask()];
  if (withdrawn === "source") f.state.sourceActive = false;
  if (withdrawn === "permission") f.state.session.projectContext.permissions = [];
  if (withdrawn === "document") f.add("DocumentRemoved", { project_id: "p", document_id: "d" });
  if (withdrawn === "project-context") f.state.session.projectContext.projectId = "other-project";
  const value = current(f);
  assert.equal(value.canRead, false); assert.deepEqual(value.blocks, []); assert.deepEqual(value.events, []);
  assert.deepEqual(value.artifacts, []); assert.equal(value.lifecycle, undefined); assert.deepEqual(creativeNextActions(value), []);
  assert.deepEqual(f.calls, []);
});

test("assigned task facts include only the current selected project/document and exact artifact revision", () => {
  const f = createNextActionFactsPort({ shared: true, review: "requested" });
  f.state.reviews = [f.reviewTask(), f.reviewTask({ id: "foreign-doc", documentId: "other-document" }),
    f.reviewTask({ id: "foreign-project", projectId: "foreign" }), f.reviewTask({ id: "foreign-access", projectAccessId: "other" }),
    f.reviewTask({ id: "finished", status: "approved" }), f.reviewTask({ id: "stale-revision", revision: 5 })];
  const value = current(f), action = creativeNextActions(value)[0];
  assert.deepEqual(value.lifecycle.reviews.map(row => row.reviewId), ["task"]);
  assert.equal(action.target.kind, "assigned-review"); assert.equal(action.target.contentSha256, FACT_HASH);
  assert.equal(action.target.projectAccessId, "access");
  f.add("DocumentArtifactEdited", { artifact_id: "artifact", document_id: "d", revision: 1, edited_by_user_id: "owner" });
  const changed = current(f); assert.deepEqual(changed.lifecycle.reviews, []);
  assert.equal(creativeNextTargetAvailable(action.target, changed), false);
});
test("stale assigned work promotes the existing changed-source review rather than a stale approval task", () => {
  const f = createNextActionFactsPort({ shared: true, review: "requested" }); f.state.reviews = [f.reviewTask()];
  f.add("BlockPropertyEdited", { project_id: "p", document_id: "d", block_id: "direction",
    property_path: "text", old_value: "A clear direction", new_value: "Changed direction" });
  const value = current(f), action = creativeNextActions(value)[0];
  assert.deepEqual(value.lifecycle.reviews, []); assert.equal(action.target.kind, "artifact-delivery");
  assert.equal(action.labelKey, "artifact.delivery.action.sources"); assert.equal(action.target.intent, "review");
});
test("personal cross-project assignments stay in Activity rather than entering current private facts", () => {
  const f = createNextActionFactsPort({ kind: null }), task = f.reviewTask({ artifactTitle: "PRIVATE OTHER WORKSPACE" });
  f.state.session.projects = [{ organizationId: task.organizationId, projectAccessId: task.projectAccessId, projectId: task.projectId }];
  f.state.reviews = [task];
  const value = current(f); assert.deepEqual(value.lifecycle.reviews, []);
  assert.equal(JSON.stringify(value).includes(task.artifactTitle), false);
  assert.deepEqual(f.calls, [{ type: "resource", documentId: "d" }]);
});

for (const scenario of ["ready", "draft", "source-stale", "source-unverified", "source-unknown", "partial",
  "target-contracts-unavailable", "review-only-eligible", "accepted-file", "filtered-target-plan"]) {
  test("current Output facts reuse exact pure continuation choices: " + scenario, async () => {
    const f = await outputFacts(scenario), before = structuredClone(f.snapshot), records = structuredClone(f.records);
    const value = current(f);
    for (const choice of value.lifecycle.output.choices) {
      assert.equal(choice.reference.projectId, value.projectId); assert.equal(choice.reference.documentId, value.documentId);
      assert.equal(choice.reference.authorizationScopeKey, value.authorityKey);
      const inputReference = choice.reference.kind === "result"
        ? captureOutputNavigation(f.snapshot, value.authorityKey, "target", choice.reference.targetId)
        : choice.reference;
      assert.ok(inputReference);
      const actual = outputContinuationChoices({ read: f.state.read, authorizationScopeKey: value.authorityKey,
        reference: inputReference, jobs: value.jobs });
      assert.ok(actual.some(row => row.section === choice.section && row.refresh === choice.refresh
        && row.label.key === choice.labelKey && row.label.fallback === choice.label
        && row.detail.key === choice.reasonKey && row.detail.fallback === choice.reason));
    }
    assert.ok(creativeNextActions(value).length <= 3);
    if (scenario === "accepted-file") {
      const next = creativeNextActions(value)[0]; assert.equal(next.target.kind, "canonical-output");
      assert.equal(next.labelKey, "output.delivery.actionDownload");
    }
    if (scenario === "filtered-target-plan") {
      const targetIds = new Set(value.lifecycle.output.choices.map(row => row.reference.targetId));
      assert.ok(f.snapshot.confirmedPlan.plan.targets.some(row => !row.selected));
      for (const target of f.snapshot.confirmedPlan.plan.targets) assert.ok(targetIds.has(target.id), "run selection never drops an owed target");
    }
    assert.deepEqual(f.snapshot, before); assert.deepEqual(f.records, records);
    assert.deepEqual(f.calls, [{ type: "resource", documentId: value.documentId }]);
  });
}
for (const state of ["loading", "refreshing", "unavailable"]) test("nonready resource " + state + " retains no actionable target or inferred zero", async () => {
  const f = await outputFacts(), snapshot = f.snapshot;
  f.state.read = { state, snapshot, error: state === "unavailable" ? "temporary" : null };
  const value = current(f);
  assert.equal(value.lifecycle.output.state, state); assert.equal(value.lifecycle.output.scopeKnown, null);
  assert.ok(value.lifecycle.output.choices.every(row => row.reference.kind === "operation" && row.refresh));
  const first = creativeNextActions(value)[0]; assert.equal(first.target.kind, "output-requirement");
  assert.equal(first.target.blockId, snapshot.requirements[0].blockId);
});
for (const changed of ["actor", "access", "document", "privateUnavailable", "accessLost"]) test("wrong or retired Output " + changed + " cannot supply cached canonical targets", async () => {
  const f = await outputFacts(), old = creativeNextActions(current(f)).find(row => row.target.kind === "canonical-output");
  assert.ok(old);
  const snapshot = structuredClone(f.snapshot);
  if (changed === "actor") snapshot.scope.actorUserId = "other";
  if (changed === "access") snapshot.scope.projectAccessId = "other";
  if (changed === "document") snapshot.documentId = "other-document";
  f.state.read = { state: "ready", snapshot, error: null,
    ...(changed === "privateUnavailable" ? { privateUnavailable: true } : {}),
    ...(changed === "accessLost" ? { accessLost: true } : {}) };
  const value = current(f); assert.equal(value.lifecycle.output.scopeKnown, null);
  assert.deepEqual(value.lifecycle.output.choices, []);
  assert.equal(creativeNextTargetAvailable(old.target, value), false);
});
test("known completed native work omitted from the recent job feed promotes its original operation", async () => {
  const f = await outputFacts("native-completed"), operation = f.snapshot.grants[0].operations[0];
  // The browser scenario retains a legacy operation spelling. Supply the
  // current Worker slot DTO only in this returned synthetic snapshot, as the
  // existing continuation fixture does; a DocumentJob still uses completed.
  assert.equal(operation.status, "completed", "The shared browser scenario remains explicitly legacy.");
  assert.equal(f.state.jobs.find(job => job.jobId === operation.jobId)?.status, "completed");
  operation.status = "succeeded";
  assert.equal(operation.status, "succeeded"); assert.equal(operation.pendingCalls, 0); assert.equal(operation.exposedMicrousd, 0);
  f.state.jobs = [];
  const before = structuredClone(f.snapshot), records = structuredClone(f.records);
  const value = current(f), first = creativeNextActions(value)[0];
  assert.equal(first.target.kind, "canonical-output"); assert.equal(first.target.reference.kind, "operation");
  assert.equal(first.target.reference.operationId, operation.id); assert.equal(first.target.reference.jobId, operation.jobId);
  assert.equal(first.target.section, "inspect"); assert.equal(first.target.refresh, false);
  assert.equal(first.labelKey, "output.delivery.actionRecover");
  assert.deepEqual(f.snapshot, before, "Facts preserve the supplied original operation and its synthetic accounting.");
  assert.deepEqual(f.records, records, "Facts do not issue any fixture command or generation.");
  assert.deepEqual(f.calls, [{ type: "resource", documentId: f.state.documentId }]);
});
test("an unavailable read with no known requirement remains unknown without a default object or extra reads", () => {
  const f = createNextActionFactsPort({ kind: null }); f.state.read = { state: "unavailable", snapshot: null, error: "temporary" };
  const value = current(f);
  assert.equal(value.lifecycle.output.scopeKnown, null); assert.deepEqual(value.lifecycle.output.requirementBlockIds, []);
  assert.deepEqual(value.lifecycle.output.choices, []);
  assert.deepEqual(f.calls, [{ type: "resource", documentId: "d" }]);
});
test("restored equal source data cannot revive a target captured before source retirement", () => {
  const f = createNextActionFactsPort({ rightsRevoked: true }), target = creativeNextActions(current(f))[0].target;
  f.state.sourceActive = false; assert.equal(creativeNextTargetAvailable(target, current(f)), false);
  f.state.generation++; f.state.sourceActive = true;
  assert.equal(creativeNextTargetAvailable(target, current(f)), false);
});
test("facts and delivery modules have no recursive adapter edge, background fetch or mutation entry", () => {
  const adapter = readFileSync(new URL("../src/state/next-action-context.ts", import.meta.url), "utf8");
  const pure = readFileSync(new URL("../src/model/artifact-delivery-facts.ts", import.meta.url), "utf8");
  assert.doesNotMatch(adapter, /artifactDeliveryFor|\.ensure\(|\.guardedFetch\(|\.append(?:Batch)?\(/u);
  assert.doesNotMatch(pure, /from ["'][^"']*(?:state\/store|next-action-context)["']|nextActionFacts\(/u);
  assert.match(adapter, /outputContinuationChoices/); assert.match(adapter, /artifactDeliveryFromFacts/);
  assert.match(adapter, /outputMissingNativeResults/);
});

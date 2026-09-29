import assert from "node:assert/strict";
import test from "node:test";
import { nextActionFacts } from "../src/state/next-action-context.ts";
import { artifactDeliveryFor } from "../src/state/artifact-delivery-context.ts";
import { artifactDeliveryFromFacts, artifactDeliveryFactsProof } from "../src/model/artifact-delivery-facts.ts";
import { createNextActionFactsPort, FACT_HASH } from "./helpers/next-action-facts-fixture.mjs";

// Differential baseline: overlay only the new pure helper, this test and its
// fixture; leave the actual old artifactDeliveryFor/nextActionFacts unchanged.
// Candidate: use the same assertions with the prepared full resolver patch.
// No copied delivery calculation, private-byte read, approval or release here.
function compare(f, contentSha256) {
  const artifact = f.artifact(); assert.ok(artifact, "the actual fold produced the fixture artifact");
  const before = structuredClone(f.state.events), facts = nextActionFacts(f.store, f.state.documentId);
  const session = f.state.session, context = session.projectContext, permissions = context?.permissions ?? session.capabilities;
  const actual = artifactDeliveryFromFacts(facts, artifact, {
    actorUserId: session.user.userId, shared: Boolean(context), managedPilot: Boolean(context?.managedPilot),
    canReview: permissions.includes("project.review.approve"),
  }, contentSha256);
  assert.deepEqual(actual, artifactDeliveryFor(f.store, artifact, contentSha256), "exact old projection parity, not only the action label");
  assert.deepEqual(f.state.events, before); assert.deepEqual(f.calls, []);
  assert.equal(f.state.sourceCaptures, 0, "delivery uses base facts and never recursively derives lifecycle work");
  const proof = JSON.parse(artifactDeliveryFactsProof(actual));
  assert.equal(proof.revision, actual.revision); assert.equal(proof.intent, actual.intent);
  assert.equal(proof.contentSha256, actual.contentSha256); assert.equal(proof.assignedReviewerId, actual.assignedReviewerId);
  assert.equal(actual.deliveryStatus, "unconfirmed");
  return actual;
}
for (const kind of ["short_story", "scene", "slides", "storyboard", "video", "audio"]) for (const shared of [false, true]) {
  test("facts-based delivery preserves actual " + kind + "/" + (shared ? "shared" : "personal") + " policy", () => {
    const f = createNextActionFactsPort({ kind, shared, actorUserId: "owner" }), value = compare(f);
    assert.equal(value.action, shared ? "assign" : "exportPersonal");
    assert.equal(value.releaseAllowed, false, "list metadata is not private-byte release authority");
  });
}
for (const [review, action] of [["requested", "review"], ["approved", "export"], ["changes", "changes"]]) {
  test("facts-based delivery preserves exact current " + review + " state", () => {
    const f = createNextActionFactsPort({ shared: true, review }), value = compare(f, FACT_HASH);
    assert.equal(value.action, action);
    assert.equal(value.approved, review === "approved");
  });
}
for (const contentSha256 of [null, "b".repeat(64)]) test("facts-based delivery keeps missing/changed bytes blocked " + contentSha256, () => {
  const f = createNextActionFactsPort({ shared: true, review: "approved" }), value = compare(f, contentSha256);
  assert.equal(value.releaseAllowed, false); assert.equal(value.approved, false);
  if (contentSha256 === null) assert.equal(value.action, "inspect");
});
for (const contentSha256 of [undefined, FACT_HASH]) test("personal required workflow review survives the extraction " + contentSha256, () => {
  const f = createNextActionFactsPort({ kind: "short_story", workflowReview: true }), value = compare(f, contentSha256);
  assert.equal(value.workflowReviewNeeded, true); assert.equal(value.action, "reviewPersonal");
});
for (const shared of [false, true]) test("legacy unverified output remains explicitly unreviewed " + shared, () => {
  const f = createNextActionFactsPort({ shared, legacy: true }), value = compare(f, FACT_HASH);
  assert.equal(value.review.status, "unverified"); assert.equal(value.approved, false);
  assert.equal(value.action, shared ? "exportDraft" : "exportPersonal");
});
test("facts-based delivery does not reinterpret denied read permission as an empty finished assignment", () => {
  const f = createNextActionFactsPort({ shared: true, review: "approved" });
  f.state.session.projectContext.permissions = [];
  const value = compare(f, FACT_HASH);
  assert.equal(value.canRead, false); assert.equal(value.action, "inspect"); assert.equal(value.releaseAllowed, false);
});
test("rights and current source changes still block the same approved artifact", () => {
  const f = createNextActionFactsPort({ shared: true, review: "approved" });
  f.add("BlockPropertyEdited", { project_id: "p", document_id: "d", block_id: "direction",
    property_path: "rights_revoked", old_value: null, new_value: true });
  const value = compare(f, FACT_HASH);
  assert.equal(value.action, "sources"); assert.deepEqual(value.rightsBlockIds, ["direction"]);
  assert.equal(value.releaseAllowed, false);
});

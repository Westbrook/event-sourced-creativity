// Exact eight regression case bodies from the root-replayed f12d proof.
import assert from "node:assert/strict";
import test from "node:test";
import { routed, canonical, replyView, view, verifyOriginalCommit, fixture, checkOriginal } from "./helpers/adaptive-proposal-receipt-truth-fixture.mjs";

for (const mode of ["personal", "shared"]) {
  test("healthy " + mode + ": real null before commit, successful read, exact fresh Check and default resume", async t => {
    const f = await fixture(t, mode);
    await f.controller.request("apply"); assert.equal(f.controller.phase, "applied", f.controller.notice);
    assert.equal(f.calls.at(-1).http, 200); assert.equal(f.calls.at(-1).status, "applied");
    const original = await checkOriginal(f), before = canonical(f.state);
    const response = await routed.phase8Request(f.state, { action: "resume" }), body = await response.json();
    assert.equal(response.status, 200); assert.equal(body.status, "applied");
    assert.equal(body.previewId, original.previewId); assert.equal(body.approvalHash, original.approvalHash);
    assert.deepEqual(canonical(f.state), before); assert.equal(f.boundary.evidence.failures, 0);
    assert.ok(f.boundary.evidence.realRows >= 3);
    console.log("P8_RECEIPT_OBSERVATION " + JSON.stringify({ case: "healthy", mode, original, read: f.boundary.evidence }));
  });
  test("desired safety " + mode + ": postcommit receipt-read failure cannot certify not-applied or clear uncertainty", async t => {
    const f = await fixture(t, mode); f.boundary.arm(f.preview);
    await f.controller.request("apply");
    const failed = f.calls.at(-1), presented = view(f.controller), committed = canonical(f.state);
    assert.equal(f.boundary.evidence.failures, 1); const original = verifyOriginalCommit(f.state, f.preview);
    assert.equal(failed.command.action, "apply"); assert.equal(failed.command.previewId, original.previewId);
    assert.deepEqual(presented.handle, { previewId: original.previewId, approvalHash: original.approvalHash });
    assert.equal(f.controller.receipt, null, "do not invent a client receipt from SQL observation");
    await checkOriginal(f); assert.deepEqual(canonical(f.state), committed);
    assert.deepEqual(f.calls.map(call => call.command.action), ["preview", "apply", "retrieve"], "no automatic retry, new preview or second Apply");
    console.log("P8_RECEIPT_OBSERVATION " + JSON.stringify({ case: "postcommit-throw", mode, failed, presented, original,
      recoveredOriginal: true, duplicateEvents: 0, duplicateReceipts: 0, read: f.boundary.evidence }));
    assert.notEqual(failed.status, "not-applied", "a verified original commit cannot become not-applied because its read failed");
    assert.equal(presented.uncertain, true, "the actual controller must retain uncertainty until the original receipt is read");
    assert.equal(presented.canEdit, false); assert.equal(presented.canPreview, false);
  });
}
for (const action of ["retrieve", "resume"]) test("desired safety: already committed " + action + " read failure is not a not-applied certificate", async t => {
  const f = await fixture(t, "personal");
  await f.controller.request("apply"); assert.equal(f.controller.phase, "applied", f.controller.notice);
  const before = canonical(f.state), original = verifyOriginalCommit(f.state, f.preview); f.boundary.arm(f.preview);
  const command = action === "resume" ? { action } : { action, previewId: original.previewId, approvalHash: original.approvalHash };
  const response = await routed.phase8Request(f.state, command), body = await response.json();
  assert.equal(f.boundary.evidence.failures, 1); assert.deepEqual(canonical(f.state), before);
  await checkOriginal(f); assert.deepEqual(canonical(f.state), before);
  console.log("P8_RECEIPT_OBSERVATION " + JSON.stringify({ case: action + "-throw", mode: "personal", reply: replyView(response.status, body), original,
    recoveredOriginal: true, read: f.boundary.evidence }));
  assert.notEqual(body.status, "not-applied", "a read exception cannot contradict the already verified original commit");
});

// Existing authority/private-CAS denial boundaries. These mutate ONLY the
// isolated fixture at the actual write boundary, never response objects or ACKs.
for (const denial of ["current-authority", "exact-approved-plan"]) test("healthy original " + denial + " still aborts all canonical authoring", async t => {
  const f = await fixture(t, "personal"), batch = f.state.env.DB.batch; let reached = 0;
  f.state.env.DB.batch = async function (statements) {
    if (!reached && statements.some(statement => /^\s*INSERT INTO authoring_commits/iu.test(statement.sql))) {
      reached++;
      if (denial === "current-authority") f.state.sqlite.prepare("UPDATE users SET updated_at=updated_at||'-withdrawn' WHERE user_id=?").run(f.state.owner);
      else f.state.sqlite.prepare("UPDATE private_content SET content=json_set(content,'$.plan.result.relationCount',1) WHERE content_id=?").run(f.preview.previewId);
    }
    return batch.call(this, statements);
  };
  try { await f.controller.request("apply"); } finally { f.state.env.DB.batch = batch; }
  assert.equal(reached, 1); assert.deepEqual(canonical(f.state), f.before);
  assert.equal(f.boundary.evidence.failures, 0); assert.equal(f.controller.receipt, null);
  assert.notEqual(f.calls.at(-1).http, 200);
  console.log("P8_RECEIPT_OBSERVATION " + JSON.stringify({ case: "denial", denial, reply: f.calls.at(-1), eventsWritten: 0, receiptsWritten: 0 }));
});

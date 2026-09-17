import assert from "node:assert/strict";
import test from "node:test";
import { recoveredOutputsMediaFixture } from "./helpers/selected-output-share-media-recovery-fixture.mjs";
import { selectedOutputShareMediaRecoveryLineage as valid } from "../worker/selected-output-share-media-recovery.ts";

const observe = f => {
  const job = f.sqlite.prepare("SELECT request_json,result_json FROM document_jobs WHERE job_id=?").get(f.jobId);
  const complete = f.sqlite.prepare("SELECT client_id,payload FROM events WHERE event_id=?").get(f.completed.eventId);
  const body = f.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(f.completed.eventId);
  return { output: f.selection.output, jobId: f.jobId, slotId: f.reference.slotId, completionId: f.completed.eventId,
    completionClient: complete.client_id, request: JSON.parse(job.request_json), result: JSON.parse(job.result_json),
    publicCompletion: JSON.parse(complete.payload), privateCompletion: JSON.parse(body.private_json) };
};

test("pure recovery parser refuses accessors and non-data values without invoking getters", async t => {
  const f = await recoveredOutputsMediaFixture(t, "model3d"), input = observe(f);
  await f.read(); assert.equal(valid(input), true, "parser fixture also passes actual native proof");
  let invoked = 0;
  const accessor = structuredClone(input);
  Object.defineProperty(accessor.result.outputModel3dRecovery, "completionEventId", { enumerable: true, get() { invoked++; return f.completed.eventId; } });
  assert.equal(valid(accessor), false); assert.equal(invoked, 0);
  const cycle = structuredClone(input); cycle.result.cycle = cycle;
  const symbol = structuredClone(input); symbol.result[Symbol("unknown")] = true;
  const hidden = structuredClone(input); Object.defineProperty(hidden.result, "hidden", { value: true, enumerable: false });
  const exotic = structuredClone(input); exotic.result.unexpected = new Date();
  const throwingProxy = new Proxy(input, { ownKeys() { throw Error("untrusted proxy"); } });
  for (const value of [cycle, symbol, hidden, exotic, throwingProxy]) assert.equal(valid(value), false);
});

test("pure parser bounds the complete observation and descends every allowed subtree", async t => {
  const f = await recoveredOutputsMediaFixture(t, "video", { evidenceMode: "retrieved" }), input = observe(f);
  await f.read(); assert.equal(valid(input), true);
  const tooMany = structuredClone(input); tooMany.result.outputVideoRecoveryEnvelopes = Array(65).fill(input.result.outputVideoRecoveryEnvelopes[0]);
  assert.equal(valid(tooMany), false);
  const sparse = structuredClone(input); delete sparse.result.outputVideoRecoveryEnvelopes[0]; assert.equal(valid(sparse), false);
  const huge = structuredClone(input); huge.result.authoredText = "x".repeat(1048577); assert.equal(valid(huge), false);
  const deep = structuredClone(input); let tail = deep.result;
  for (let i = 0; i < 66; i++) { tail.child = {}; tail = tail.child; } assert.equal(valid(deep), false);
  for (const target of ["request", "publicCompletion", "privateCompletion"]) {
    const poisoned = structuredClone(input); poisoned[target].nested = { outputVideoRecovery: input.result.outputVideoRecovery };
    assert.equal(valid(poisoned), false, `${target} receives no nested recovery exception`);
  }
  const privateFlag = structuredClone(input); privateFlag.publicCompletion.recovered = true; assert.equal(valid(privateFlag), false);
});

test("historical accepted GLB submission is not required to contain completed accounting", async t => {
  const f = await recoveredOutputsMediaFixture(t, "model3d"), input = observe(f);
  const modify = submission => {
    submission.status = "accepted";
    for (const key of ["costMicrousd", "inputTokens", "outputTokens", "totalTokens"]) delete submission[key];
  };
  modify(input.result.outputModel3dRecovery.originalSubmission);
  modify(input.result.outputModel3dRecoveryHistory.at(-1).originalSubmission);
  assert.equal(valid(input), true);
  for (const bad of [{ unitId: "other" }, { costMicrousd: -1 }, { inputTokens: 3 }, { unknown: true }]) {
    const copy = structuredClone(input);
    Object.assign(copy.result.outputModel3dRecovery.originalSubmission, bad);
    Object.assign(copy.result.outputModel3dRecoveryHistory.at(-1).originalSubmission, bad);
    assert.equal(valid(copy), false);
  }
});

test("historical lease time does not confer a current lease or sharing lifetime", async t => {
  const f = await recoveredOutputsMediaFixture(t, "model3d"), input = observe(f);
  for (const expiry of ["2000-01-01T00:00:00.000Z", "2099-01-01T00:00:00.000Z"]) {
    input.result.outputModel3dRecovery.expiresAt = expiry;
    input.result.outputModel3dRecoveryHistory.at(-1).expiresAt = expiry;
    assert.equal(valid(input), true);
  }
  input.result.outputModel3dRecovery.status = "active"; assert.equal(valid(input), false);
});

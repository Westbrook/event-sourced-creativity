import test from "node:test";
import assert from "node:assert/strict";
import { outputCompletedNativeChoices, outputOperationRecovery, outputReusableAcceptanceChoices } from "../src/components/output-controller-recovery.ts";

const target = { id: "deck", media_kind: "slides" };
const operation = { id: "slot", targetId: "deck", jobId: "job", status: "succeeded", pendingCalls: 0, exposedMicrousd: 0 };
const grant = { id: "grant", planRevisionId: "plan-2", operations: [operation] };
const snapshot = () => ({ documentId: "doc", sourceRevision: "source", confirmedPlan: { revisionId: "plan-2", sourceDigest: "source", targetContractDigests: { deck: "contract" }, plan: { targets: [target] } }, grants: [grant], assets: [], results: [] });
const job = { jobId: "job", documentId: "doc", status: "completed", kind: "render_document", result: { artifactKind: "slides" } };

test("completed current authorized job is an explicit candidate, not automatic acceptance", () => {
  assert.equal(outputCompletedNativeChoices(snapshot(), [job], target).length, 1);
  assert.equal(outputReusableAcceptanceChoices(snapshot(), target).length, 0);
});
test("failed, rejected, partial, wrong Document, foreign plan and wrong media jobs cannot be bound from the picker", () => {
  for (const status of ["failed", "partial", "canceled", "running"]) assert.equal(outputCompletedNativeChoices(snapshot(), [{ ...job, status }], target).length, 0);
  assert.equal(outputCompletedNativeChoices(snapshot(), [{ ...job, documentId: "other" }], target).length, 0);
  assert.equal(outputCompletedNativeChoices({ ...snapshot(), grants: [{ ...grant, planRevisionId: "old" }] }, [job], target).length, 0);
  assert.equal(outputCompletedNativeChoices(snapshot(), [{ ...job, kind: "generate" }], target).length, 0);
  assert.equal(outputCompletedNativeChoices(snapshot(), [{ ...job, result: null }], target).length, 0);
});
test("only existing exact historical acceptance with current source and held bytes is reusable", () => {
  const base = snapshot();
  base.assets.push({ id: "asset", available: true, sha256: "sha", inspection: { sha256: "sha", status: "inspected" } });
  base.results.push({ id: "result", targetId: "deck", planRevisionId: "plan-1", assetId: "asset", review: "approved", checksStatus: "passed", acceptanceId: "acceptance", targetContractDigest: "contract", sourceDigest: "source", sha256: "sha" });
  assert.equal(outputReusableAcceptanceChoices(base, target).length, 1);
  for (const change of [{ acceptanceId: null }, { review: "pending" }, { checksStatus: "failed" }, { targetContractDigest: "other" }, { sourceDigest: "old" }, { targetId: "other" }, { planRevisionId: "plan-2" }]) {
    assert.equal(outputReusableAcceptanceChoices({ ...base, results: [{ ...base.results[0], ...change }] }, target).length, 0);
  }
  assert.equal(outputReusableAcceptanceChoices({ ...base, sourceRevision: "changed" }, target).length, 0);
  assert.equal(outputReusableAcceptanceChoices({ ...base, assets: [{ ...base.assets[0], available: false }] }, target).length, 0);
  assert.equal(outputReusableAcceptanceChoices({ ...base, assets: [{ ...base.assets[0], sha256: "other" }] }, target).length, 0);
});
test("missing target-contract metadata cannot crash the reuse picker or manufacture an acceptance", () => {
  for (const contracts of [undefined, null, {}]) {
    const data = snapshot(); data.confirmedPlan.targetContractDigests = contracts;
    assert.deepEqual(outputReusableAcceptanceChoices(data, target), []);
  }
});
test("alternatives require terminal status and settled accounting, including zero-cost pending calls", () => {
  assert.equal(outputOperationRecovery({ ...operation, status: "failed" }, job, "doc").canPrepareAlternative, true);
  assert.equal(outputOperationRecovery({ ...operation, status: "failed", pendingCalls: 1 }, job, "doc").canPrepareAlternative, false);
  assert.equal(outputOperationRecovery({ ...operation, status: "failed", exposedMicrousd: 1 }, job, "doc").canPrepareAlternative, false);
  assert.equal(outputOperationRecovery({ ...operation, status: "failed", pendingCalls: undefined }, job, "doc").reason, "accounting_unknown");
  assert.equal(outputOperationRecovery({ ...operation, status: "running" }, job, "doc").canPrepareAlternative, false);
});
test("stop is scoped to the actual queued or running job; committing and unrelated jobs cannot be stopped", () => {
  assert.equal(outputOperationRecovery(operation, { ...job, status: "queued" }, "doc").canStop, true);
  assert.equal(outputOperationRecovery(operation, { ...job, status: "running" }, "doc").canStop, true);
  assert.equal(outputOperationRecovery(operation, { ...job, status: "committing" }, "doc").canStop, false);
  assert.equal(outputOperationRecovery(operation, { ...job, documentId: "other", status: "running" }, "doc").canStop, false);
});

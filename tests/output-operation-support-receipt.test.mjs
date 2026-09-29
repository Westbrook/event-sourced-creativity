import test from "node:test";
import assert from "node:assert/strict";
import { outputOperationSupportReceipt } from "../src/components/output-operation-support-receipt.ts";

const accounting = { usedMicrousd: 35_001, exposedMicrousd: 70_000, maximumMicrousd: 150_000, usedCalls: 1, pendingCalls: 1, maximumCalls: 2 };
const fixture = () => ({
  snapshot: { projectId: "project", documentId: "document", revision: "output:44", scope: { kind: "project", actorUserId: "private-actor-id", organizationId: "private-org-id" },
    sourceRevision: "private-source-hash", requirements: [{ content: "PRIVATE_SOURCE_TEXT" }],
    grants: [{ id: "grant", planRevisionId: "plan:2", status: "active", actorUserId: "PRIVATE_ACTOR", payerUserId: "PRIVATE_PAYER", ...accounting,
      disclosure: { targets: [{ targetId: "target", provider: "openai", model: "gpt-image-2", settings: { prompt: "PRIVATE_PROMPT" }, transferDescription: "PRIVATE_SOURCE_DESCRIPTION" }] },
      operations: [{ id: "slot", targetId: "target", targetLabel: "PRIVATE_TARGET_TITLE", jobId: "job", status: "uncertain", ...accounting }],
    }],
  },
  jobs: [{ jobId: "job", documentId: "document", status: "failed", updatedAt: "2026-08-27T12:00:00.000Z", error: "PRIVATE_FAILURE_PROMPT", errorDetail: { code: "output_execution_time_limit", requestId: "forma-request-123", message: "PRIVATE_INPUT" },
    result: { plannerResponseId: "resp_123", plannerResponseIds: ["resp_123", "resp_456"], providerJobId: "provider-123", recoveredProviderResponseId: "resp_789", providerSubmissions: { private: { clientRequestId: "PRIVATE_INTERNAL_ID", raw: "PRIVATE_PROVIDER_RESPONSE" } }, plannerInput: { apiKey: "PRIVATE_KEY" }, generationReceipt: { submitted_prompt: "PRIVATE_PROMPT" } },
  }],
});

test("support receipt preserves exact scope/operation/accounting and public request references without private input", () => {
  const { snapshot, jobs } = fixture();
  const text = outputOperationSupportReceipt(snapshot, "grant", "slot", jobs);
  const receipt = JSON.parse(text);
  assert.deepEqual(receipt.scope, { kind: "project", projectId: "project", documentId: "document" });
  assert.deepEqual([receipt.grant.id, receipt.operation.id, receipt.operation.jobId, receipt.operation.targetId], ["grant", "slot", "job", "target"]);
  assert.equal(receipt.operation.accounting.recordedSpend, 35_001);
  assert.equal(receipt.operation.accounting.unresolvedExposure, 70_000);
  assert.equal(receipt.operation.accounting.unresolvedCalls, 1);
  assert.equal(receipt.publicReceiptReferences.filter((entry) => entry.kind === "planner_response_id").length, 2);
  assert.deepEqual(receipt.publicReceiptReferences[0], { kind: "failure_support_reference", value: "forma-request-123" });
  assert.doesNotMatch(text, /PRIVATE|private-actor|private-org|sourceRevision|providerSubmissions|submitted_prompt|apiKey/u);
});

test("unknown accounting remains null and an absent public request reference is not fabricated", () => {
  const { snapshot } = fixture();
  snapshot.grants[0].operations[0].usedMicrousd = undefined;
  snapshot.grants[0].operations[0].pendingCalls = NaN;
  const receipt = JSON.parse(outputOperationSupportReceipt(snapshot, "grant", "slot", []));
  assert.equal(receipt.operation.accounting.recordedSpend, null);
  assert.equal(receipt.operation.accounting.unresolvedCalls, null);
  assert.deepEqual(receipt.publicReceiptReferences, []);
  assert.equal(receipt.publicReceiptAvailability, "no_public_reference_available_use_operation_and_job_ids");
  assert.equal(receipt.job.status, "unknown");
});

test("other Document jobs and foreign grant/slot references are never copied", () => {
  const { snapshot, jobs } = fixture();
  jobs[0].documentId = "other-document";
  assert.deepEqual(JSON.parse(outputOperationSupportReceipt(snapshot, "grant", "slot", jobs)).publicReceiptReferences, []);
  assert.equal(outputOperationSupportReceipt(snapshot, "other-grant", "slot", jobs), null);
  assert.equal(outputOperationSupportReceipt(snapshot, "grant", "other-slot", jobs), null);
});

test("nonidentifier prose, URLs and control characters are rejected instead of exported as request IDs", () => {
  const { snapshot, jobs } = fixture();
  jobs[0].errorDetail.requestId = "https://example.invalid/private?token=secret";
  jobs[0].result = { plannerResponseId: "PRIVATE SOURCE WITH SPACES", providerJobId: "req_123\ncredential", plannerResponseIds: ["resp_valid"] };
  assert.deepEqual(JSON.parse(outputOperationSupportReceipt(snapshot, "grant", "slot", jobs)).publicReceiptReferences, [{ kind: "planner_response_id", value: "resp_valid" }]);
});

test("zero spend with a pending call remains an unresolved receipt, not a zero-charge conclusion", () => {
  const { snapshot } = fixture();
  Object.assign(snapshot.grants[0].operations[0], { usedMicrousd: 0, exposedMicrousd: 0, pendingCalls: 1 });
  const receipt = JSON.parse(outputOperationSupportReceipt(snapshot, "grant", "slot", []));
  assert.equal(receipt.operation.accounting.recordedSpend, 0);
  assert.equal(receipt.operation.accounting.unresolvedCalls, 1);
  assert.match(receipt.note, /do not prove provider acceptance or zero charges/u);
});

test("parseable non-ISO timestamps are normalized without copying trailing private commentary", () => {
  const { snapshot, jobs } = fixture();
  jobs[0].updatedAt = "Thu, 27 Aug 2026 12:00:00 GMT (PRIVATE_COMMENT)";
  const text = outputOperationSupportReceipt(snapshot, "grant", "slot", jobs);
  assert.equal(JSON.parse(text).job.observedUpdatedAt, "2026-08-27T12:00:00.000Z");
  assert.doesNotMatch(text, /PRIVATE_COMMENT/u);
});

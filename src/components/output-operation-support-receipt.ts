import type { DocumentJob } from "../model/document-jobs.ts";
import type { OutputRequirementsSnapshot } from "../model/output-delivery-contract.ts";

const opaque = (value: unknown): string | null => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value) ? value : null;
const count = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const state = (value: unknown, allowed: readonly string[]) => typeof value === "string" && allowed.includes(value) ? value : "unknown";
const grantStates = ["authorized", "active", "completed", "revoked", "exceeded", "expired"];
const operationStates = ["authorized", "queued", "running", "succeeded", "completed", "failed", "cancelled", "canceled", "unavailable", "uncertain"];
const jobStates = ["queued", "running", "committing", "completed", "partial", "failed", "canceled"];

/** A user-visible technical receipt, never a provider lookup or a private input dump. */
export function outputOperationSupportReceipt(snapshot: OutputRequirementsSnapshot, grantId: string, slotId: string, jobs: readonly DocumentJob[]): string | null {
  const grant = snapshot.grants.find((candidate) => candidate.id === grantId);
  const operation = grant?.operations.find((candidate) => candidate.id === slotId);
  if (!grant || !operation || ![snapshot.projectId, snapshot.documentId, grant.id, grant.planRevisionId, operation.id, operation.targetId, operation.jobId].every(opaque)) return null;
  const job = jobs.find((candidate) => candidate.jobId === operation.jobId && candidate.documentId === snapshot.documentId);
  const result = record(job?.result);
  const references: Array<{ kind: string; value: string }> = [];
  const add = (kind: string, value: unknown) => { const id = opaque(value); if (id && !references.some((entry) => entry.kind === kind && entry.value === id)) references.push({ kind, value: id }); };
  // A support reference can be a client request ID. Do not describe it as proof of provider acceptance.
  add("failure_support_reference", job?.errorDetail?.requestId);
  add("planner_response_id", result.plannerResponseId);
  if (Array.isArray(result.plannerResponseIds)) for (const id of result.plannerResponseIds.slice(0, 8)) add("planner_response_id", id);
  // Only an already exposed receipt ID is included; raw checkpoints and private provider input are never inspected.
  add("provider_job_reference", result.providerJobId);
  add("recovered_provider_response_id", result.recoveredProviderResponseId);
  const offered = grant.disclosure?.targets.find((candidate) => candidate.targetId === operation.targetId);
  const accounting = (value: { usedMicrousd: number; exposedMicrousd: number; maximumMicrousd: number; usedCalls: number; pendingCalls: number; maximumCalls: number }) => ({
    unit: "microUSD", recordedSpend: count(value.usedMicrousd), unresolvedExposure: count(value.exposedMicrousd), authorizedMaximum: count(value.maximumMicrousd),
    recordedCalls: count(value.usedCalls), unresolvedCalls: count(value.pendingCalls), maximumCalls: count(value.maximumCalls),
  });
  return JSON.stringify({
    schema: "forma-output-operation-support-receipt/v1",
    note: "Technical identifiers and accounting only. Missing values remain unknown. Request references do not prove provider acceptance or zero charges. No source content is included.",
    observedSnapshotRevision: opaque(snapshot.revision),
    scope: { kind: snapshot.scope.kind === "project" ? "project" : "personal", projectId: snapshot.projectId, documentId: snapshot.documentId },
    planRevisionId: grant.planRevisionId,
    grant: { id: grant.id, status: state(grant.status, grantStates), accounting: accounting(grant) },
    operation: { id: operation.id, targetId: operation.targetId, jobId: operation.jobId, status: state(operation.status, operationStates), accounting: accounting(operation) },
    job: { status: state(job?.status, jobStates), failureCode: opaque(job?.errorDetail?.code), observedUpdatedAt: typeof job?.updatedAt === "string" && Number.isFinite(Date.parse(job.updatedAt)) ? new Date(Date.parse(job.updatedAt)).toISOString() : null },
    route: { provider: offered?.provider === "openai" || offered?.provider === "fal" ? offered.provider : null, model: opaque(offered?.model) },
    publicReceiptReferences: references,
    publicReceiptAvailability: references.length ? "some_public_references_available" : "no_public_reference_available_use_operation_and_job_ids",
  }, null, 2);
}

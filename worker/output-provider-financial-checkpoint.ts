import type { WorkerEnv } from "./runtime.ts";
import { outputAssertionStatements, type OutputSqlAssertion } from "./output-command-core.ts";
import type { PaidProviderSubmission } from "../src/model/provider-submission.ts";

type FinancialReceipt = Pick<PaidProviderSubmission, "clientRequestId" | "provider" | "operation" | "model" | "status" | "providerRequestId" | "costMicrousd" | "inputTokens" | "outputTokens" | "totalTokens">;
export type OutputProviderFinancialCheckpoint = {
  binding: { scopeKey: string; slotId: string; callKey: string; receipt: FinancialReceipt };
  write: D1PreparedStatement;
  /** Exact per-call financial evidence, independent of later job summaries. */
  matches: OutputSqlAssertion;
  /** Fallback is unnecessary after a successful terminal ledger commit. */
  unsettled: OutputSqlAssertion;
  fallbackMatches: OutputSqlAssertion;
};

/** Only the native provider observer constructs this source-free patch. It must
 * be committed in the same transaction as the provider-call settlement. */
export function prepareOutputProviderFinancialCheckpoint(env: WorkerEnv, input: {
  scopeKey: string; slotId: string; callKey: string;
  jobId: string; ownerId: string; streamId: string; correlationId: string;
  receipt: FinancialReceipt; patch: Record<string, unknown>;
}): OutputProviderFinancialCheckpoint {
  const { receipt } = input;
  const fields = ["clientRequestId", "provider", "operation", "model", "status", "providerRequestId", "costMicrousd", "inputTokens", "outputTokens", "totalTokens"] as const;
  const safe = Object.fromEntries(fields.filter(key => receipt[key] !== undefined).map(key => [key, receipt[key]]));
  if (!["accepted", "completed", "rejected"].includes(receipt.status)) throw new Error("invalid_provider_observation");
  for (const key of ["costMicrousd", "inputTokens", "outputTokens", "totalTokens"] as const) {
    if (receipt[key] !== undefined && (!Number.isSafeInteger(receipt[key]) || receipt[key]! < 0)) throw new Error("invalid_provider_observation");
  }
  const prior = "CASE WHEN previous.type='object' THEN previous.value ELSE '{}' END";
  const old = (field: string) => `json_extract(${prior},'$.${field}')`;
  const next = (field: string) => `json_extract(incoming.value,'$.${field}')`;
  const immutable = ["clientRequestId", "provider", "operation", "model"].map(key => `${old(key)} IS NOT ${next(key)}`);
  const usage = ["costMicrousd", "inputTokens", "outputTokens", "totalTokens"].map(key => `(${old(key)} IS NOT NULL AND ${next(key)} IS NOT NULL AND ${old(key)} IS NOT ${next(key)})`);
  const conflicts = [
    "previous.type<>'object'", ...immutable,
    `COALESCE(${old("status")},'') NOT IN('pending','accepted','completed','rejected')`,
    `(${old("providerRequestId")} IS NOT NULL AND ${next("providerRequestId")} IS NOT NULL AND ${old("providerRequestId")} IS NOT ${next("providerRequestId")})`,
    `(${old("status")} IN('completed','rejected') AND ${old("status")} IS NOT ${next("status")})`,
    `(${old("status")}='accepted' AND ${next("status")}='rejected')`,
    `(${old("status")}='completed' AND (${usage.join(" OR ")}))`,
  ].join(" OR ");
  const binding = [input.jobId, input.ownerId, input.streamId, input.correlationId];
  const entries = JSON.stringify({ [receipt.clientRequestId]: safe });
  const settlementStatus = receipt.status === "rejected" ? "rejected" : receipt.status === "completed" && receipt.costMicrousd !== undefined ? "settled" : "uncertain";
  const settlementCost = settlementStatus === "rejected" ? 0 : settlementStatus === "settled" ? receipt.costMicrousd! : null;
  const patch = JSON.stringify({ ...input.patch, providerSubmissions: { [receipt.clientRequestId]: safe } });
  const write = env.DB.prepare(`UPDATE document_jobs SET result_json=json_patch(COALESCE(result_json,'{}'),?),updated_at=?
    WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=?
      AND COALESCE(json_type(result_json,'$.providerSubmissions'),'object')='object'
      AND EXISTS(SELECT 1 FROM output_operation_slots slot JOIN output_provider_calls paid ON paid.scope_key=slot.scope_key AND paid.slot_id=slot.slot_id
        WHERE slot.job_id=document_jobs.job_id AND slot.scope_key=? AND slot.slot_id=? AND paid.call_key=?
          AND paid.client_request_id=? AND paid.provider=? AND paid.model=?
          AND (paid.provider_response_id IS NULL OR ? IS NULL OR paid.provider_response_id=?)
          AND (paid.status IN('pending','uncertain') OR (paid.status=? AND paid.used_microusd IS ?))
          AND (?<>'rejected' OR paid.status='rejected' OR paid.provider_response_id IS NULL))
      AND NOT EXISTS(SELECT 1 FROM json_each(COALESCE(json_extract(result_json,'$.providerSubmissions'),'{}')) previous,json_each(?) incoming
        WHERE previous.key=incoming.key AND (${conflicts}))`)
    .bind(patch, new Date().toISOString(), ...binding, input.scopeKey, input.slotId, input.callKey, receipt.clientRequestId, receipt.provider, receipt.model,
      receipt.providerRequestId ?? null, receipt.providerRequestId ?? null, settlementStatus, settlementCost, settlementStatus, entries);
  // Compare only supplied per-call financial fields: publication may legitimately
  // change generationReceipt/planner summaries or add validation metadata later.
  const proofFields = fields.filter(key => receipt[key] !== undefined);
  const proof = (allowUnrecordedAcceptance: boolean): OutputSqlAssertion => ({
    sql: `EXISTS(SELECT 1 FROM document_jobs job,json_each(COALESCE(json_extract(job.result_json,'$.providerSubmissions'),'{}')) saved
      WHERE job.job_id=? AND job.owner_id=? AND job.stream_id=? AND job.correlation_id=? AND saved.key=? AND saved.type='object'
        AND EXISTS(SELECT 1 FROM output_provider_calls paid WHERE paid.scope_key=? AND paid.slot_id=? AND paid.call_key=? AND paid.client_request_id=saved.key
          AND (${allowUnrecordedAcceptance ? "paid.provider_response_id IS NULL OR " : ""}paid.provider_response_id IS json_extract(saved.value,'$.providerRequestId')))
        AND ${proofFields.map(key => `json_extract(saved.value,'$.${key}') IS ?`).join(" AND ")})`,
    bindings: [...binding, receipt.clientRequestId, input.scopeKey, input.slotId, input.callKey, ...proofFields.map(key => receipt[key]!)],
  });
  const unsettled: OutputSqlAssertion = {
    sql: "EXISTS(SELECT 1 FROM output_provider_calls WHERE scope_key=? AND slot_id=? AND call_key=? AND client_request_id=? AND status IN('pending','uncertain'))",
    bindings: [input.scopeKey, input.slotId, input.callKey, receipt.clientRequestId],
  };
  return { binding: { scopeKey: input.scopeKey, slotId: input.slotId, callKey: input.callKey, receipt }, write, matches: proof(false), unsettled, fallbackMatches: proof(true) };
}

/** Retain a known financial witness only while its canonical call still needs
 * reconciliation. A lost terminal acknowledgement must not rewrite summaries. */
export async function retainUnsettledOutputProviderObservation(env: WorkerEnv, checkpoint: OutputProviderFinancialCheckpoint, assertions: OutputSqlAssertion[] = []) {
  return env.DB.batch([
    ...[...assertions, checkpoint.unsettled].flatMap(assertion => outputAssertionStatements(env, assertion)),
    checkpoint.write,
    ...[{ sql: "changes()=1" }, checkpoint.fallbackMatches].flatMap(assertion => outputAssertionStatements(env, assertion)),
  ]);
}

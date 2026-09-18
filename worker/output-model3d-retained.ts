import { canonicalJson } from "../src/experiences/compiler.ts";
import { balancedOutputRetainedConjunction } from "./output-retained-witness.ts";
import { captureExperienceModel3dEvidence, verifyExperienceModel3dRead } from "../src/experiences/model3d-native-result.ts";
import { readModel3dExecutionPayload } from "../src/model/output-model3d-offer.ts";
import { verifyModel3dPreparedReceipt } from "../src/model/model3d-mini-app-execution.ts";
import { projectNativeRetainedOutput } from "../src/model/native-retained-output.ts";
import { providerSubmissions, hasUnsettledProviderSubmission } from "../src/model/provider-submission.ts";
import type { Model3dPreparedReceipt } from "./fal-model3d-adapter.ts";
import type { DocumentJobRow } from "./document-jobs-api.ts";
import type { OutputSqlAssertion } from "./output-requirements-ledger.ts";
import type { WorkerEnv } from "./runtime.ts";

const fail = (): never => { throw new Error("output_model3d_retained_unavailable"); };
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : fail();
const same = (a: unknown, b: unknown) => { try { return canonicalJson(a) === canonicalJson(b); } catch { return false; } };
const bounded = (value: string) => { if (typeof value !== "string" || new TextEncoder().encode(value).length > 1048576) return fail(); return value; };
const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), n => n.toString(16).padStart(2, "0")).join("");

/** The existing retained handler owns authentication, selection and private
 * source custody. This adds original-job/paid-call/storage evidence only for a
 * native mini-app's unedited Model3D result; no new permission or media fetch. */
type RetainedModel3dInput = {
  ownerId: string; completionId: string; documentId: string; projectId: string; artifactId: string; contentId: string; inputId: string;
  rawContent: string; contentExpiresAt: string; completionRaw: string; signal?: AbortSignal;
};
type RecoveryLease = { token: string; expiresAt: string; assertCurrent(): Promise<void>; assertions(): OutputSqlAssertion[] };
export async function readRetainedOutputModel3d(env: WorkerEnv, input: RetainedModel3dInput) {
  return readRetainedModel3d(env, input);
}
/** Internal original-only finalization. Public retained routes never supply a
 * lease. Every check below stays shared; only terminal job/slot expectations
 * differ under a live, current-authority, exact-token failed-original lease. */
export async function readRetainedOutputModel3dRecovery(env: WorkerEnv, input: RetainedModel3dInput, lease: RecoveryLease) {
  if (!lease || !lease.token || !Number.isFinite(Date.parse(lease.expiresAt)) || Date.parse(lease.expiresAt) <= Date.now()
    || !lease.assertions().length) fail();
  await lease.assertCurrent();
  const result = await readRetainedModel3d(env, input, lease);
  await lease.assertCurrent();
  return result;
}
async function readRetainedModel3d(env: WorkerEnv, input: RetainedModel3dInput, recovery?: RecoveryLease) {
  const payload = object(JSON.parse(bounded(input.completionRaw))), settings = object(payload.settings);
  const evidence = captureExperienceModel3dEvidence(settings);
  if (!evidence || evidence.actorUserId !== input.ownerId || evidence.documentId !== input.documentId || evidence.projectId !== input.projectId
    || evidence.artifactId !== input.artifactId || payload.source_surface !== "outputs" || payload.artifact_kind !== "model3d"
    || payload.content_ref !== input.contentId || payload.input_ref !== input.inputId || payload.document_id !== input.documentId
    || payload.project_id !== input.projectId || payload.requested_by_user_id !== input.ownerId || payload.item_count !== 0
    || !Array.isArray(payload.items) || payload.items.length !== 0 || payload.provider !== "fal"
    || payload.provider_job_id !== evidence.receipt.providerRequestId || payload.model_id !== evidence.costPreview.model
    || !same(settings.model3d_files, evidence.files) || settings.production_mode !== "manual") return fail();
  const ref = evidence.execution, preview = evidence.costPreview;
  const jobSql = `job_id=? AND owner_id=? AND document_id=? AND stream_id=? AND kind='render_document'
    AND source_surface='outputs' AND ${recovery ? "status='failed'" : "status='completed' AND error_message IS NULL AND completed_at IS NOT NULL"}
    AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND length(CAST(request_json AS BLOB))<=1048576 AND length(CAST(result_json AS BLOB))<=1048576
    AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind IN('job','document') AND resource_id IN(document_jobs.job_id,document_jobs.document_id))`;
  const jobBindings = [evidence.jobId, input.ownerId, input.documentId, `creative:${input.ownerId}`];
  const job = await env.DB.prepare(`SELECT * FROM document_jobs WHERE ${jobSql}`).bind(...jobBindings).first<DocumentJobRow>();
  if (!job || typeof job.result_json !== "string") return fail();
  const request = object(JSON.parse(job.request_json)), checkpoint = object(JSON.parse(job.result_json)), offer = readModel3dExecutionPayload(request);
  if (!offer || !same(offer.contract, evidence.contract) || !same(offer.preview, preview)
    || !same(request.outputExecution, ref) || !same(checkpoint.outputExecution, ref)
    || !same(request.model3dCostConsent, { ...preview, confirmed: true, providerTransferConfirmed: true })
    || checkpoint.artifactId !== input.artifactId || checkpoint.artifactKind !== "model3d"
    || !Array.isArray(checkpoint.appendedEventIds) || !checkpoint.appendedEventIds.includes(input.completionId)
    || checkpoint.providerJobId !== evidence.receipt.providerRequestId || checkpoint.providerModel !== preview.model
    || hasUnsettledProviderSubmission(checkpoint)) return fail();
  const prepared = await verifyModel3dPreparedReceipt(offer, checkpoint.model3dInputReceipt as Model3dPreparedReceipt);
  if (prepared.requestDigest !== evidence.receipt.requestDigest) return fail();
  const calls = providerSubmissions(checkpoint), call = calls[0];
  if (calls.length !== 1 || !call || call.clientRequestId !== evidence.receipt.mediaCallId || call.provider !== "fal" || call.operation !== "model3d"
    || call.model !== preview.model || call.status !== "completed" || call.providerRequestId !== evidence.receipt.providerRequestId
    || call.costMicrousd !== preview.maximumMicrousd || call.totalTokens !== 0) return fail();
  const slotFrom = `output_operation_slots slot JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
    JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id`;
  const slotSql = `slot.scope_key=? AND slot.slot_id=? AND slot.grant_id=? AND slot.plan_revision_id=? AND slot.target_id=? AND slot.source_digest=?
    AND slot.target_contract_digest=? AND slot.job_id=? AND ${recovery ? "slot.status IN('failed','uncertain')" : "slot.status='succeeded'"}
    AND ${preview.version === "model3d-mini-app-replacement-cost-v1"
      ? `slot.attempt_ordinal=1 AND slot.previous_slot_id IS ? AND EXISTS(SELECT 1 FROM output_operation_slots parent
          JOIN output_provider_calls parent_call ON parent_call.scope_key=parent.scope_key AND parent_call.slot_id=parent.slot_id
          WHERE parent.scope_key=slot.scope_key AND parent.slot_id=slot.previous_slot_id AND parent.job_id=?
            AND parent.attempt_ordinal=0 AND parent.previous_slot_id IS NULL AND parent.target_id=slot.target_id
            AND parent.target_contract_digest=slot.target_contract_digest AND parent.source_digest=slot.source_digest
            AND parent_call.provider='fal' AND parent_call.provider_response_id=? AND parent_call.reserved_microusd=400000)
          AND EXISTS(SELECT 1 FROM event_private_payloads proof WHERE proof.private_event_id=plan.confirmed_event_id
            AND proof.owner_id=plan.owner_user_id AND proof.redacted_at IS NULL
            AND json_extract(proof.private_json,'$.output_command_envelope.experienceBinding.replacementCycle.id')=?)`
      : "slot.attempt_ordinal=0 AND slot.previous_slot_id IS NULL"}
    AND ${recovery ? "EXISTS(SELECT 1 FROM events WHERE event_id=? AND stream_id='creative:'||plan.owner_user_id AND type='DocumentRenderCompleted')" : "slot.outcome_event_id=?"} AND slot.provider='fal' AND slot.model=? AND slot.maximum_calls=1 AND slot.maximum_microusd=?
    AND plan.scope_kind='personal' AND plan.owner_user_id=? AND plan.document_id=? AND plan.project_id=?
    AND plan.source_digest=slot.source_digest AND plan.requirements_digest=? AND plan.organization_id IS NULL AND plan.project_access_id IS NULL
    AND grant_row.actor_user_id=plan.owner_user_id AND grant_row.payer_user_id=plan.owner_user_id AND grant_row.context_id IS NULL AND ${recovery ? "grant_row.status IN('authorized','active','completed')" : "grant_row.status='completed'"}`;
  const slotBindings = [ref.scopeKey, ref.slotId, ref.grantId, ref.planRevisionId, ref.targetId, ref.sourceDigest, ref.targetContractDigest, evidence.jobId,
    ...(preview.version === "model3d-mini-app-replacement-cost-v1" ? [preview.previousSlotId!, preview.previousJobId!, preview.previousProviderRequestId!, preview.replacementCycleId!] : []),
    input.completionId, preview.model, preview.maximumMicrousd, input.ownerId, input.documentId, input.projectId, preview.requirementsDigest];
  const callSql = `scope_key=? AND slot_id=? AND call_key='model3d:initial' AND stage_key='model3d:initial' AND client_request_id=? AND request_digest=?
    AND provider='fal' AND model=? AND reserved_microusd=? AND used_microusd=? AND status='settled' AND provider_response_id=? AND settled_at IS NOT NULL
    AND (SELECT COUNT(*) FROM output_provider_calls counted WHERE counted.scope_key=output_provider_calls.scope_key AND counted.slot_id=output_provider_calls.slot_id)=1`;
  const callBindings = [ref.scopeKey, ref.slotId, call.clientRequestId, prepared.requestDigest, preview.model, preview.maximumMicrousd, preview.maximumMicrousd, call.providerRequestId!];
  const invocationSql = `content_id=? AND owner_id=? AND kind='document-artifact-input' AND redacted_at IS NULL
    AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND length(CAST(content AS BLOB))<=1048576
    AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=private_content.content_id)`;
  const invocationBindings = [input.inputId, input.ownerId];
  const invocation = await env.DB.prepare(`SELECT content,expires_at FROM private_content WHERE ${invocationSql}`).bind(...invocationBindings).first<{ content: string; expires_at: string }>();
  if (!invocation) return fail();
  const deadlineMs = Math.min(Date.parse(input.contentExpiresAt), Date.parse(invocation.expires_at), Date.parse(job.expires_at));
  if (!Number.isFinite(deadlineMs) || deadlineMs <= Date.now() || input.signal?.aborted) return fail();
  const body = object(JSON.parse(bounded(input.rawContent))), selection = { documentId: input.documentId, artifactId: input.artifactId, revision: 0, contentSha256: await hash(input.rawContent) };
  const dto = projectNativeRetainedOutput({ output: "model3d", selection }, body, new Date(deadlineMs).toISOString(), undefined, { model3dReceipt: payload });
  if (!dto || dto.output !== "model3d" || body.content_markdown !== offer.description.prompt || body.presentation !== null
    || !Array.isArray(body.items) || body.items.length !== 0 || !await verifyExperienceModel3dRead(invocation.content, evidence, dto, {
      contract: evidence.contract, costPreview: preview, jobId: evidence.jobId, actorUserId: input.ownerId, documentId: input.documentId,
      projectId: input.projectId, artifactId: input.artifactId, ...ref, usedCalls: 1, usedMicrousd: preview.maximumMicrousd,
    })) return fail();
  const assertions: OutputSqlAssertion[] = [
    ...(recovery ? [...recovery.assertions(), { sql: "EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND owner_id=? AND status=\'failed\' AND json_extract(result_json,\'$.outputModel3dRecovery.token\')=? AND json_extract(result_json,\'$.outputModel3dRecovery.expiresAt\')=? AND ?>strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\'))", bindings: [evidence.jobId, input.ownerId, recovery.token, recovery.expiresAt, recovery.expiresAt], deadlineMs: Date.parse(recovery.expiresAt) }] : []),
    { sql: "EXISTS(SELECT 1 FROM events event JOIN event_private_payloads body ON body.private_event_id=event.event_id WHERE event.event_id=? AND event.stream_id=? AND event.correlation_id=? AND event.actor='worker:renderer' AND event.type='DocumentRenderCompleted' AND event.compensates_event_id IS NULL AND body.owner_id=? AND body.document_id=? AND body.project_id=? AND body.redacted_at IS NULL AND body.private_json=?)",
      bindings: [input.completionId, job.stream_id, job.correlation_id, input.ownerId, input.documentId, input.projectId, input.completionRaw] },
    { sql: `EXISTS(SELECT 1 FROM document_jobs WHERE ${jobSql} AND request_json=? AND result_json=? AND expires_at=? AND correlation_id=? AND attempt_count=?)`,
      bindings: [...jobBindings, job.request_json, job.result_json, job.expires_at, job.correlation_id, job.attempt_count] },
    { sql: `EXISTS(SELECT 1 FROM ${slotFrom} WHERE ${slotSql})`, bindings: slotBindings },
    { sql: `EXISTS(SELECT 1 FROM output_provider_calls WHERE ${callSql})`, bindings: callBindings },
    { sql: `EXISTS(SELECT 1 FROM private_content WHERE ${invocationSql} AND content=? AND expires_at=?)`, bindings: [...invocationBindings, invocation.content, invocation.expires_at] },
  ];
  for (const file of evidence.files) {
    if (!file.sha256 || !file.url.startsWith("/api/media/")) return fail();
    assertions.push({ sql: "EXISTS(SELECT 1 FROM output_native_storage_writes WHERE scope_key=? AND slot_id=? AND storage_key=? AND content_sha256=? AND status='written' AND write_acknowledged=1 AND publication_event_id=?)",
      bindings: [ref.scopeKey, ref.slotId, decodeURIComponent(file.url.slice("/api/media/".length)), file.sha256, input.completionId] });
  }
  for (const assertion of assertions) if (!await env.DB.prepare("SELECT 1 WHERE " + assertion.sql).bind(...assertion.bindings ?? []).first()) return fail();
  if (deadlineMs <= Date.now() || input.signal?.aborted) return fail();
  // Closed server-authored SQL/bindings, packed once for the caller's final
  // principal/source/event witness; never one D1 parameter per retained file.
  const json = bounded(JSON.stringify(assertions.map(a => a.bindings ?? [])));
  const sql = balancedOutputRetainedConjunction(assertions.map((a, index) => {
    const parts = a.sql.split("?"), bindings = a.bindings ?? [];
    if (parts.length !== bindings.length + 1) return fail();
    return "(" + parts.map((part, position) => part + (position < bindings.length ? `(SELECT json_extract(bindings,'$[${index}][${position}]') FROM model3d_witness)` : "")).join("") + ")";
  }));
  return { assertions, evidence, prepared, expiresAt: new Date(deadlineMs).toISOString(), witness: { json, sql } };
}

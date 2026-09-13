import { MAX_STORYBOARD_ENVELOPE_BYTES } from "./output-storyboard-envelope.ts";
import type { VideoPlannerRawEnvelope } from "./output-video-planner-envelope.ts";
import { canonicalJson, freeze, jsonIssues } from "../src/experiences/compiler.ts";
import { preparePrivateContent } from "./private-content-storage.ts";
import { captureVideoPlannerRequest } from "./output-video-planner.ts";
import { captureOutputVideoAttempt, OUTPUT_VIDEO_TRANSPORT, type OutputVideoHookLease, type OutputVideoRawEnvelope } from "./output-video-execution.ts";
import { outputAssertionStatements, OutputConflictError, type OutputScope, type OutputOperationSlot, type OutputSqlAssertion } from "./output-requirements-ledger.ts";
import type { WorkerEnv } from "./runtime.ts";
import type { DocumentJobRow } from "./document-jobs-api.ts";
import type { ProviderAttemptPreflight } from "./openai-adapter.ts";

function fail(): never { throw new OutputConflictError("output_video_checkpoint_invalid", 403); }
const sha = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), b => b.toString(16).padStart(2, "0")).join("");
function current(scope: OutputScope, slot: OutputOperationSlot, job: DocumentJobRow, lease: OutputVideoHookLease) {
  lease.assertCurrent();
  if (scope.kind !== "personal" || scope.ownerUserId !== scope.actorUserId || scope.contextId || scope.organizationId || scope.projectAccessId
    || job.owner_id !== scope.actorUserId || job.stream_id !== `creative:${scope.ownerUserId}` || job.document_id !== scope.documentId
    || job.kind !== "render_document" || job.status !== "running" || job.output_slot_id !== slot.slotId || slot.jobId !== job.job_id
    || slot.scopeKey !== scope.key || slot.attemptOrdinal !== 0 || slot.previousSlotId !== null
    || !Number.isFinite(lease.deadlineMs) || lease.deadlineMs <= Date.now()) fail();
}
function guards(scope: OutputScope, slot: OutputOperationSlot, job: DocumentJobRow, lease: OutputVideoHookLease,
  attempt: Pick<ProviderAttemptPreflight, "logicalCallKey" | "model" | "clientRequestId" | "requestDigest">, request: boolean): OutputSqlAssertion[] {
  const deadline = new Date(Math.min(lease.deadlineMs, Date.parse(job.expires_at), Date.parse(String(job.lease_expires_at)))).toISOString();
  const provider = attempt.logicalCallKey === "planning:0:initial" ? "openai" : "fal";
  return [{ sql: `?>strftime('%Y-%m-%dT%H:%M:%fZ','now')`, bindings: [deadline], deadlineMs: Date.parse(deadline) }, {
    sql: `EXISTS(SELECT 1 FROM document_jobs live JOIN output_operation_slots slot ON slot.job_id=live.job_id
      JOIN output_provider_calls paid ON paid.scope_key=slot.scope_key AND paid.slot_id=slot.slot_id
      WHERE live.job_id=? AND live.owner_id=? AND live.stream_id=? AND live.document_id=? AND live.correlation_id=?
      AND live.status='running' AND live.attempt_count=? AND live.lease_expires_at=? AND live.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND live.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND slot.scope_key=? AND slot.slot_id=? AND slot.grant_id=?
      AND slot.route_digest=? AND slot.source_digest=? AND slot.status IN('queued','running')
      AND paid.call_key=? AND paid.stage_key=? AND paid.provider=? AND paid.model=? AND paid.client_request_id=? AND paid.request_digest=?
      AND ${request ? "paid.status='pending' AND paid.provider_response_id IS NULL" : "paid.status IN('pending','uncertain','rejected','settled')"})`,
    bindings: [job.job_id, scope.actorUserId, job.stream_id, scope.documentId, job.correlation_id, job.attempt_count, job.lease_expires_at,
      scope.key, slot.slotId, slot.grantId, slot.routeDigest, slot.sourceDigest, attempt.logicalCallKey!, attempt.logicalCallKey!, provider, attempt.model, attempt.clientRequestId, attempt.requestDigest!],
  }];
}
/** Private payload inserts and checkpoint publication share one guarded batch.
 * Optional unrelated expiry cleanup is not part of this operation. */
async function persist(env: WorkerEnv, scope: OutputScope, slot: OutputOperationSlot, job: DocumentJobRow, lease: OutputVideoHookLease,
  raw: string, kind: "prompt" | "provider-response", path: string, make: (ref: string, expiresAt: string) => Record<string, unknown>, assertions: OutputSqlAssertion[]) {
  current(scope, slot, job, lease);
  const prepared = await preparePrivateContent(env, scope.actorUserId, kind, raw);
  current(scope, slot, job, lease);
  if (prepared.requiredInserts !== 1) fail();
  const expiresAt = [prepared.expiresAt, job.expires_at].sort()[0]!, record = freeze(make(prepared.contentId, expiresAt)), serialized = JSON.stringify(record);
  const outputPath = path.startsWith("$.outputVideoMediaEnvelopes[") ? "$.outputVideoMediaEnvelopes[#]" : path;
  const old = JSON.parse(job.result_json ?? "{}");
  await env.DB.batch([...assertions.flatMap(a => outputAssertionStatements(env, a)), ...prepared.statements.slice(0, prepared.requiredInserts),
    ...outputAssertionStatements(env, { sql: `EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind=? AND content=? AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))`, bindings: [prepared.contentId, scope.actorUserId, kind, raw] }),
    env.DB.prepare(`UPDATE document_jobs SET result_json=json_set(${outputPath.endsWith('[#]') ? "json_set(COALESCE(result_json,'{}'),'$.outputVideoMediaEnvelopes',json(COALESCE(json_extract(result_json,'$.outputVideoMediaEnvelopes'),'[]')))" : "COALESCE(result_json,'{}')"},?,json(?)) WHERE job_id=? AND owner_id=?`).bind(outputPath, serialized, job.job_id, scope.actorUserId),
    ...outputAssertionStatements(env, { sql: "EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND owner_id=? AND json_extract(result_json,?)=?) AND ?>strftime('%Y-%m-%dT%H:%M:%fZ','now')", bindings: [job.job_id, scope.actorUserId, path, serialized, new Date(lease.deadlineMs).toISOString()] }),
  ]);
  // A committed receipt remains durable even if a cancellation arrives while the
  // batch returns. Never turn that outcome into permission for another attempt.
  job.result_json = JSON.stringify(outputPath.endsWith('[#]') ? { ...old, outputVideoMediaEnvelopes: [...old.outputVideoMediaEnvelopes ?? [], record] } : { ...old, [path.slice(2)]: record });
  lease.assertCurrent();
  return record;
}
export async function retainOutputVideoRequestCheckpoint(env: WorkerEnv, scope: OutputScope, slot: OutputOperationSlot, job: DocumentJobRow,
  attempt: ProviderAttemptPreflight, lease: OutputVideoHookLease) {
  current(scope, slot, job, lease);
  const planner = attempt.logicalCallKey === "planning:0:initial";
  const original = planner ? attempt.videoPlanning : attempt.video;
  if (!original || jsonIssues(attempt).length) fail();
  const captured = planner ? (await captureVideoPlannerRequest(original.contract, original.requestBody, attempt.clientRequestId)).attempt
    : await captureOutputVideoAttempt(original.contract, original.requestBody, attempt.clientRequestId);
  current(scope, slot, job, lease);
  if (canonicalJson(captured) !== canonicalJson(attempt)) fail();
  const path = planner ? "$.outputVideoPlannerCheckpoint" : "$.outputVideoMediaCheckpoint";
  const assertions = [...guards(scope, slot, job, lease, attempt, true), { sql: "EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND json_type(COALESCE(result_json,'{}'),?) IS NULL)", bindings: [job.job_id, path] }];
  return persist(env, scope, slot, job, lease, original.requestBody, "prompt", path, (requestRef, expiresAt) => ({ version: "output-video-request-checkpoint-v1",
    stage: attempt.logicalCallKey, provider: planner ? "openai" : "fal", model: attempt.model, clientRequestId: attempt.clientRequestId,
    requestDigest: attempt.requestDigest, requestRef, expiresAt, contract: original.contract }), assertions);
}
export async function retainOutputVideoMediaEnvelope(env: WorkerEnv, scope: OutputScope, slot: OutputOperationSlot, job: DocumentJobRow,
  value: OutputVideoRawEnvelope, lease: OutputVideoHookLease) {
  current(scope, slot, job, lease);
  if (jsonIssues(value).length) fail();
  const envelope = freeze(structuredClone(value)), result = JSON.parse(job.result_json ?? "{}"), checkpoint = result.outputVideoMediaCheckpoint;
  const envelopes = result.outputVideoMediaEnvelopes ?? [], count = envelopes.length;
  if (!checkpoint || checkpoint.stage !== "video:initial" || checkpoint.clientRequestId !== envelope.clientRequestId || checkpoint.requestDigest !== envelope.requestDigest
    || envelope.schemaVersion !== 1 || !["submission", "status", "result"].includes(envelope.phase) || !Array.isArray(envelopes)
    || count >= OUTPUT_VIDEO_TRANSPORT.maximumStatusReads + 2 || (count === 0) !== (envelope.phase === "submission")
    || envelopes.some((row: { phase: string }) => row.phase === "result") || !Number.isSafeInteger(envelope.decodedByteLength) || envelope.decodedByteLength < 0
    || envelope.decodedByteLength > OUTPUT_VIDEO_TRANSPORT.maximumEnvelopeBytes || typeof envelope.decodedBodyBase64 !== "string"
    || envelope.decodedBodyBase64.length > Math.ceil(OUTPUT_VIDEO_TRANSPORT.maximumEnvelopeBytes / 3) * 4
    || !Number.isSafeInteger(envelope.httpStatus) || envelope.httpStatus < 200 || envelope.httpStatus > 599
    || !Array.isArray(envelope.headers) || envelope.headers.length > 5 || typeof envelope.requestUrl !== "string" || envelope.requestUrl.length > 4096) fail();
  const bytes = Uint8Array.from(atob(envelope.decodedBodyBase64), c => c.charCodeAt(0));
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
  current(scope, slot, job, lease);
  if (bytes.byteLength !== envelope.decodedByteLength || hash !== envelope.decodedBodySha256
    || btoa(atob(envelope.decodedBodyBase64)) !== envelope.decodedBodyBase64
    || envelope.headers.some(pair => !Array.isArray(pair) || pair.length !== 2 || !["content-type", "content-length", "content-encoding", "x-fal-request-id", "date"].includes(pair[0]) || typeof pair[1] !== "string")
    || envelope.headers.reduce((total, pair) => total + pair[0].length + pair[1].length, 0) > 32768) fail();
  const raw = JSON.stringify(envelope), digest = await sha(raw);
  const assertions = [...guards(scope, slot, job, lease, { logicalCallKey: "video:initial", model: checkpoint.model, clientRequestId: envelope.clientRequestId, requestDigest: envelope.requestDigest }, false),
    { sql: "EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND json_extract(result_json,'$.outputVideoMediaCheckpoint')=? AND COALESCE(json_array_length(result_json,'$.outputVideoMediaEnvelopes'),0)=?)", bindings: [job.job_id, JSON.stringify(checkpoint), count] }];
  return persist(env, scope, slot, job, lease, raw, "provider-response", `$.outputVideoMediaEnvelopes[${count}]`, (responseRef, expiresAt) => ({ version: "output-video-media-envelope-checkpoint-v1", phase: envelope.phase,
    clientRequestId: envelope.clientRequestId, requestDigest: envelope.requestDigest, providerRequestId: envelope.providerRequestId, responseRef, envelopeSha256: digest,
    decodedBodySha256: envelope.decodedBodySha256, decodedByteLength: envelope.decodedByteLength, httpStatus: envelope.httpStatus, expiresAt }), assertions);
}

export async function retainOutputVideoPlannerEnvelope(env: WorkerEnv, scope: OutputScope, slot: OutputOperationSlot, job: DocumentJobRow,
  value: VideoPlannerRawEnvelope, lease: OutputVideoHookLease) {
  current(scope, slot, job, lease);
  if (jsonIssues(value).length) fail();
  const envelope = freeze(structuredClone(value)), checkpoint = JSON.parse(job.result_json ?? "{}").outputVideoPlannerCheckpoint;
  if (!checkpoint || envelope.version !== "output-video-planner-envelope-v1" || envelope.provider !== "openai" || envelope.model !== checkpoint.model
    || envelope.clientRequestId !== checkpoint.clientRequestId || envelope.requestDigest !== checkpoint.requestDigest
    || !Number.isSafeInteger(envelope.retainedBytes) || envelope.retainedBytes < 0 || envelope.retainedBytes > MAX_STORYBOARD_ENVELOPE_BYTES
    || typeof envelope.bodyBase64 !== "string" || envelope.bodyBase64.length > Math.ceil(MAX_STORYBOARD_ENVELOPE_BYTES / 3) * 4
    || typeof envelope.complete !== "boolean" || typeof envelope.readFailed !== "boolean") fail();
  const bytes = atob(envelope.bodyBase64);
  if (bytes.length !== envelope.retainedBytes || btoa(bytes) !== envelope.bodyBase64) fail();
  const raw = JSON.stringify(envelope), envelopeSha256 = await sha(raw), path = "$.outputVideoPlannerEnvelope";
  const assertions = [...guards(scope, slot, job, lease, { logicalCallKey: "planning:0:initial", model: envelope.model, clientRequestId: envelope.clientRequestId, requestDigest: envelope.requestDigest }, false),
    { sql: "EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND json_extract(result_json,'$.outputVideoPlannerCheckpoint')=? AND json_type(result_json,'$.outputVideoPlannerEnvelope') IS NULL)", bindings: [job.job_id, JSON.stringify(checkpoint)] }];
  return persist(env, scope, slot, job, lease, raw, "provider-response", path, (responseRef, expiresAt) => ({ version: envelope.version,
    responseRef, envelopeSha256, clientRequestId: envelope.clientRequestId, requestDigest: envelope.requestDigest,
    retainedBytes: envelope.retainedBytes, complete: envelope.complete, readFailed: envelope.readFailed, httpStatus: envelope.httpStatus, expiresAt }), assertions);
}

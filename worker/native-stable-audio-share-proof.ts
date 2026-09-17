import { principalAccessFromRow } from "./access-policy.ts";
import { bytes, eventCte, nativeRetainedSourceFinalGuard, personalContentGuard, readNativeRetainedContent,
  readNativeRetainedPrincipal, readNativeRetainedSelection, record, type NativeRetainedIdentity } from "./native-retained-text-custody.ts";
import { nativeRetainedMediaReceiptReaders as readers } from "./retained-story-api.ts";
import { projectNativeRetainedOutput } from "../src/model/native-retained-output.ts";
import { ownerMediaNamespace } from "../src/model/media-ownership.ts";
import { captureExperienceAudioEvidence, verifyExperienceAudioInput } from "../src/experiences/audio-native-result.ts";
import { parseAudioMiniAppCostPreview } from "../src/model/audio-mini-app-consent.ts";
import { providerSubmissions, invalidProviderSubmissions } from "../src/model/provider-submission.ts";
import { readOutputAudioPayload, verifyOutputAudioCalls } from "./output-audio-execution.ts";
import { canonicalJson } from "../src/experiences/compiler.ts";
import { selectedShareProofQuery, selectedShareProofStatement, type SelectedShareProofQuery } from "./selected-output-share-proof.ts";
import type { WorkerEnv } from "./runtime.ts";

/** Dormant source recipe evidence, not asset bytes or permission to publish. */
export const NATIVE_STABLE_AUDIO_SOURCE_PROFILE = "forma.audio.instrumental-20.mp3@1" as const;
export const NATIVE_STABLE_AUDIO_SHARE_PROJECTION = "selected-output-share-stable-mp3-pcm16-v1" as const;
export const NATIVE_STABLE_AUDIO_PROOF_LIMITS = Object.freeze({ deadlineMs: 30_000, inputBytes: 1_048_576,
  jobJsonBytes: 131_072, witnessBytes: 1_048_576, maximumCalls: 3 });
export type NativeStableAudioSelection = Readonly<{ output: "audio"; documentId: string; artifactId: string;
  revision: number; contentSha256: string; mediaSha256: string;
  sourceProfile: typeof NATIVE_STABLE_AUDIO_SOURCE_PROFILE; projectionPolicy: typeof NATIVE_STABLE_AUDIO_SHARE_PROJECTION }>;
export type NativeStableAudioRecipeSnapshot = Readonly<{ identity: NativeRetainedIdentity; selection: NativeStableAudioSelection;
  projectId: string; contentId: string; completionId: string; jobId: string; inputId: string;
  sourceExpiresAt: string; inputExpiresAt: string; expiresAt: string; authSnapshot: string;
  media: Readonly<{ url: string; mimeType: "audio/mpeg"; sha256: string }>;
  recipe: "forma.audio.instrumental-20@1" }>;
declare const nativeStableAudio: unique symbol;
export type NativeStableAudioRecipeProof = Readonly<{ [nativeStableAudio]: true }>;
type State = { env: WorkerEnv; db: WorkerEnv["DB"]; media: WorkerEnv["MEDIA"]; cohort: WorkerEnv["FORMA_PILOT_COHORT_ID"];
  administrators: WorkerEnv["FORMA_ADMIN_EMAILS"]; signal: AbortSignal; wallDeadline: number; monotonicDeadline: number;
  expiresAt: string; snapshot?: NativeStableAudioRecipeSnapshot; queries?: readonly SelectedShareProofQuery[] };
const proofs = new WeakMap<NativeStableAudioRecipeProof, State>();
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(value);
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const timestamp = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const signalAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")!.get!;
function fail(): never { throw new Error("native_stable_audio_share_proof_unavailable"); }
function closed(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length) return fail();
  const captured: Record<string, unknown> = {};
  for (const key of keys) { const field = descriptors[key];
    if (!field?.enumerable || !Object.hasOwn(field, "value")) return fail(); captured[key] = field.value; }
  return captured;
}
function identity(value: unknown): NativeRetainedIdentity {
  const data = closed(value, ["userId", "email", "source"]);
  if (typeof data.userId !== "string" || !data.userId || bytes(data.userId) > 240 || typeof data.email !== "string" || !data.email
    || bytes(data.email) > 320 || data.email !== data.email.toLowerCase() || /[\0-\u0020\u007f]/u.test(data.userId + data.email)
    || data.source !== "openai-workspace") return fail();
  return Object.freeze(data) as NativeRetainedIdentity;
}
function selection(value: unknown): NativeStableAudioSelection {
  const data = closed(value, ["output", "documentId", "artifactId", "revision", "contentSha256", "mediaSha256", "sourceProfile", "projectionPolicy"]);
  if (data.output !== "audio" || !id(data.documentId) || !id(data.artifactId) || !integer(data.revision)
    || !digest(data.contentSha256) || !digest(data.mediaSha256) || data.sourceProfile !== NATIVE_STABLE_AUDIO_SOURCE_PROFILE
    || data.projectionPolicy !== NATIVE_STABLE_AUDIO_SHARE_PROJECTION) return fail();
  return Object.freeze(data) as NativeStableAudioSelection;
}
function current(value: State) {
  if (value.env.DB !== value.db || value.env.MEDIA !== value.media || value.env.FORMA_PILOT_COHORT_ID !== value.cohort
    || value.env.FORMA_ADMIN_EMAILS !== value.administrators || signalAborted.call(value.signal)
    || Date.now() >= value.wallDeadline || performance.now() >= value.monotonicDeadline || Date.now() >= Date.parse(value.expiresAt)) return fail();
}
async function bounded<T>(state: State, operation: () => Promise<T>): Promise<T> {
  current(state);
  let timer: ReturnType<typeof setTimeout> | undefined, abort: (() => void) | undefined;
  const stop = new Promise<never>((_, reject) => {
    abort = () => reject(new Error("native_stable_audio_share_proof_unavailable"));
    EventTarget.prototype.addEventListener.call(state.signal, "abort", abort, { once: true });
    timer = setTimeout(abort, Math.max(0, Math.min(state.wallDeadline - Date.now(), state.monotonicDeadline - performance.now(), Date.parse(state.expiresAt) - Date.now())));
    if (signalAborted.call(state.signal)) abort();
  });
  const pending = Promise.resolve().then(() => { current(state); return operation(); });
  try { const result = await Promise.race([pending, stop]); current(state); return result; }
  finally { clearTimeout(timer); if (abort) EventTarget.prototype.removeEventListener.call(state.signal, "abort", abort); void pending.catch(() => {}); }
}
const columns = {
  job: ["job_id", "owner_id", "stream_id", "document_id", "source_surface", "request_json", "result_json", "attempt_count", "correlation_id", "requested_sequence", "expires_at", "completed_at"],
  slot: ["scope_key", "slot_id", "grant_id", "plan_revision_id", "target_id", "target_contract_digest", "source_digest", "job_id", "status", "attempt_ordinal", "previous_slot_id", "outcome_event_id", "maximum_microusd", "maximum_calls", "maximum_tokens", "provider", "model"],
  grant: ["scope_key", "grant_id", "plan_revision_id", "actor_user_id", "payer_user_id", "context_id", "status", "maximum_microusd", "maximum_calls", "expires_at", "preflight_id", "authorization_event_id"],
  plan: ["scope_key", "plan_revision_id", "scope_kind", "owner_user_id", "project_id", "document_id", "organization_id", "project_access_id", "source_digest", "requirements_digest"],
  preflight: ["scope_key", "preflight_id", "plan_revision_id", "actor_user_id", "terms_digest", "event_id", "expires_at"],
  call: ["scope_key", "slot_id", "call_key", "stage_key", "client_request_id", "request_digest", "provider", "model", "reserved_microusd", "used_microusd", "status", "provider_response_id", "created_at", "settled_at"],
} as const;
const jsonArray = (alias: string, names: readonly string[]) => `json_array(${names.map(name => `${alias}.${name}`).join(",")})`;
const sourceCte = `stable_audio_source AS (
  SELECT json_object('job',${jsonArray("job", columns.job)},'slot',${jsonArray("slot", columns.slot)},
    'grant',${jsonArray("grant_row", columns.grant)},'plan',${jsonArray("plan", columns.plan)},'preflight',${jsonArray("preflight", columns.preflight)},
    'calls',json((SELECT json_group_array(json(item)) FROM (SELECT ${jsonArray("call", columns.call)} AS item
      FROM output_provider_calls call WHERE call.scope_key=slot.scope_key AND call.slot_id=slot.slot_id ORDER BY call.call_key LIMIT 4))),
    'callCount',(SELECT COUNT(*) FROM output_provider_calls call WHERE call.scope_key=slot.scope_key AND call.slot_id=slot.slot_id),
    'sequence',completion.sequence) AS witness
  FROM events completion JOIN document_jobs job ON job.stream_id=completion.stream_id AND job.correlation_id=completion.correlation_id
  JOIN output_operation_slots slot ON slot.job_id=job.job_id
  JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id
  JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
  JOIN output_preflights preflight ON preflight.scope_key=grant_row.scope_key AND preflight.preflight_id=grant_row.preflight_id
  WHERE completion.event_id=? AND completion.stream_id=? AND completion.type='DocumentRenderCompleted'
    AND completion.actor='worker:renderer' AND completion.client_id='server:document-job:render_document'
    AND job.owner_id=? AND job.document_id=? AND job.kind='render_document' AND job.status='completed' AND job.source_surface='outputs'
    AND job.error_message IS NULL AND job.completed_at IS NOT NULL AND typeof(job.attempt_count)='integer' AND job.attempt_count BETWEEN 1 AND 2
    AND job.correlation_id=(job.job_id||':attempt:'||CAST(job.attempt_count AS TEXT))
    AND typeof(job.expires_at)='text' AND length(CAST(job.expires_at AS BLOB))=24 AND job.expires_at>${nowSql}
    AND typeof(job.request_json)='text' AND length(CAST(job.request_json AS BLOB)) BETWEEN 1 AND ${NATIVE_STABLE_AUDIO_PROOF_LIMITS.jobJsonBytes}
    AND typeof(job.result_json)='text' AND length(CAST(job.result_json AS BLOB)) BETWEEN 1 AND ${NATIVE_STABLE_AUDIO_PROOF_LIMITS.jobJsonBytes}
    AND (SELECT COUNT(*) FROM output_operation_slots other WHERE other.job_id=job.job_id)=1
    AND (SELECT COUNT(*) FROM document_jobs other WHERE other.stream_id=completion.stream_id AND other.correlation_id=completion.correlation_id)=1
    AND (SELECT COUNT(*) FROM events other WHERE other.stream_id=completion.stream_id AND other.correlation_id=completion.correlation_id AND other.type='DocumentRenderCompleted')=1
    AND NOT EXISTS(SELECT 1 FROM project_resource_scopes scope WHERE scope.resource_kind='job' AND scope.resource_id=job.job_id)
), bounded_stable_audio_source AS (SELECT witness FROM stable_audio_source WHERE length(CAST(witness AS BLOB))<=${NATIVE_STABLE_AUDIO_PROOF_LIMITS.witnessBytes})`;
function row(value: unknown, names: readonly string[]): Record<string, unknown> {
  if (!Array.isArray(value) || value.length !== names.length || value.some(item => item !== null && typeof item !== "string" && typeof item !== "number")) return fail();
  return Object.fromEntries(names.map((name, index) => [name, value[index]]));
}
function object(value: unknown) { const parsed = typeof value === "string" ? JSON.parse(value) : value; return record(parsed) ?? fail(); }
function equivalent(a: unknown, b: unknown) { return canonicalJson(a) === canonicalJson(b); }
/** Only the three fixed server-authored queries below enter this packer. Raw
 * database witnesses remain their original separate string binds. Scalar
 * vectors avoid D1's 100-parameter ceiling when complete proofs are composed.
 * Quotes/comments are tokenized; no requester SQL or binding is accepted. */
function packedQuery(sql: string, bindings: readonly (string | number | null)[], rawIndices: readonly number[], name: string): SelectedShareProofQuery {
  const raw = new Set(rawIndices), scalars: (string | number | null)[] = [], retained: (string | number | null)[] = [];
  let output = "", index = 0;
  for (let at = 0; at < sql.length;) {
    const char = sql[at]!;
    if (char === "'" || char === '"' || char === "`" || char === "[") {
      const end = char === "[" ? "]" : char, start = at++;
      let closed = false;
      while (at < sql.length) { if (sql[at++] === end) { if (sql[at] === end) { at++; continue; } closed = true; break; } }
      if (!closed) return fail(); output += sql.slice(start, at); continue;
    }
    if (sql.startsWith("--", at)) { const end = sql.indexOf("\n", at + 2); output += sql.slice(at, end < 0 ? sql.length : end); at = end < 0 ? sql.length : end; continue; }
    if (sql.startsWith("/*", at)) { const end = sql.indexOf("*/", at + 2); if (end < 0) return fail(); output += sql.slice(at, end + 2); at = end + 2; continue; }
    if (char === "?") {
      if (index >= bindings.length || /[0-9]/u.test(sql[at + 1] ?? "")) return fail();
      const value = bindings[index]!;
      if (raw.has(index)) { if (typeof value !== "string") return fail(); retained.push(value); output += "?"; }
      else { if (value !== null && typeof value !== "string" && typeof value !== "number" || typeof value === "number" && !Number.isFinite(value)) return fail();
        output += `json_extract((SELECT value FROM ${name}),'$[${scalars.length}]')`; scalars.push(value); }
      index++; at++; continue;
    }
    output += char; at++;
  }
  if (index !== bindings.length || raw.size !== retained.length) return fail();
  const vector = JSON.stringify(scalars); if (bytes(vector) > 16_384) return fail();
  return selectedShareProofQuery(`WITH ${name} AS MATERIALIZED (SELECT ? AS value),${name}_proof AS MATERIALIZED (${output}) SELECT admitted FROM ${name}_proof`, [vector, ...retained]);
}
/** Normal Outputs producer copies the original normalized source and then
 * adds Document metadata/standing constraints. A recovery-specific no-snapshot
 * envelope is not silently treated as the same source witness. */
function originalInputSource(input: Record<string, unknown>, request: Record<string, unknown>, result: Record<string, unknown>,
  completion: Record<string, unknown>, documentId: string) {
  const original = record(request.snapshot), retained = record(input.document_snapshot), versions = request.sourceBlockVersions;
  if (request.documentId !== documentId || typeof request.documentRevision !== "string" || !request.documentRevision
    || typeof request.requestKey !== "string" || !request.requestKey || !original || !Array.isArray(original.facts) || !retained
    || record(retained.document)?.id !== documentId || !Array.isArray(versions)
    || versions.some(value => { const entry = record(value); return !entry || Object.keys(entry).length !== 2 || !id(entry.block_id) || !integer(entry.version); })
    || new Set(versions.map(value => (value as Record<string, unknown>).block_id)).size !== versions.length
    || !equivalent(versions, completion.source_block_versions) || !equivalent(input.output_audio_calls, providerSubmissions(result))
    || !equivalent(input.render, result.audioInputReceipt) || !equivalent(input.output_audio_request, result.outputAudioRequest)) return fail();
  for (const [key, value] of Object.entries(original)) {
    if (key !== "document" && key !== "standing_constraints" && !equivalent(retained[key], value)) return fail();
  }
  const constraints = (value: unknown) => (Array.isArray(value) ? value : []).filter((item): item is Record<string, unknown> => record(item) !== null);
  const constraintKey = (value: Record<string, unknown>) => String(value.preference_id ?? `${value.polarity}:${value.axis}:${value.value}`);
  const saved = constraints(retained.standing_constraints), byKey = new Map(saved.map(value => [constraintKey(value), value]));
  if (byKey.size !== saved.length) return fail();
  for (const value of constraints(original.standing_constraints)) if (!equivalent(byKey.get(constraintKey(value)), value)) return fail();
}

/** Identity is supplied only by the trusted hosted caller. All source, input,
 * recipe and current-selection facts are independently reread from the DB.
 * No request JSON, caller SQL, provider, R2 get, initializer or write is used. */
export async function readNativeStableAudioRecipeProof(env: WorkerEnv, actorValue: NativeRetainedIdentity,
  selectedValue: NativeStableAudioSelection, signal: AbortSignal): Promise<NativeStableAudioRecipeProof> {
  try {
    const actor = identity(actorValue), selected = selection(selectedValue);
    signalAborted.call(signal);
    const state: State = { env, db: env.DB, media: env.MEDIA, cohort: env.FORMA_PILOT_COHORT_ID, administrators: env.FORMA_ADMIN_EMAILS,
      signal, wallDeadline: Date.now() + NATIVE_STABLE_AUDIO_PROOF_LIMITS.deadlineMs,
      monotonicDeadline: performance.now() + NATIVE_STABLE_AUDIO_PROOF_LIMITS.deadlineMs, expiresAt: "9999-12-31T23:59:59.999Z" };
    const { auth, principal, observed, role } = await bounded(state, () => readNativeRetainedPrincipal(env, actor));
    if ((await bounded(state, () => principalAccessFromRow(observed, role))).identityPolicyDeniedCustody) return fail();
    const { snapshot: events, native } = await bounded(state, () => readNativeRetainedSelection(env, actor, selected, "audio", undefined, 1));
    const receipt = await bounded(state, () => readers.audio.receipt(env, native, actor.userId, selected));
    const { contentBindings, source, body } = await bounded(state, () => readNativeRetainedContent(env, actor, selected, native));
    if (!timestamp(source.expires_at)) return fail(); state.expiresAt = source.expires_at; current(state);
    const edit = await bounded(state, () => readers.audio.edit(env, native, actor.userId, selected, body, receipt));
    const dto = projectNativeRetainedOutput({ output: "audio", selection: { documentId: selected.documentId, artifactId: selected.artifactId,
      revision: selected.revision, contentSha256: selected.contentSha256 } }, body, source.expires_at, native.sceneMedium,
      { audioReceipt: receipt.payload, ...(edit?.revision ? { audioRevision: edit.revision } : {}) });
    const evidence = captureExperienceAudioEvidence(receipt.payload.settings);
    if (!dto || dto.output !== "audio" || !dto.content.media || dto.content.media.mediaType !== "audio/mpeg"
      || dto.content.media.sha256 !== selected.mediaSha256 || !evidence || evidence.mediaSha256 !== selected.mediaSha256
      || receipt.payload.source_surface !== "outputs" || receipt.payload.media_type !== "audio/mpeg"
      || receipt.payload.media_url !== dto.content.media.url || receipt.payload.provider !== "fal"
      || receipt.payload.model_id !== "fal-ai/stable-audio-3/medium/text-to-audio"
      || receipt.payload.provider_job_id !== evidence.receipt.providerRequestId) return fail();
    const prefix = `/api/media/`, url = dto.content.media.url, key = decodeURIComponent(url.slice(prefix.length));
    if (!url.startsWith(prefix) || url !== prefix + encodeURIComponent(key)
      || key !== `${ownerMediaNamespace(actor.userId)}/generated/${selected.artifactId}.mp3`) return fail();
    const sourceBindings = [native.completionId, `creative:${actor.userId}`, actor.userId, selected.documentId];
    const rows = await bounded(state, () => state.db.prepare(`WITH ${sourceCte} SELECT witness FROM bounded_stable_audio_source LIMIT 2`)
      .bind(...sourceBindings).all<{ witness: string }>());
    if (!rows.success || rows.results.length !== 1 || typeof rows.results[0]?.witness !== "string"
      || bytes(rows.results[0].witness) > NATIVE_STABLE_AUDIO_PROOF_LIMITS.witnessBytes) return fail();
    const rawWitness = rows.results[0].witness, witness = object(rawWitness), job = row(witness.job, columns.job), slot = row(witness.slot, columns.slot),
      grant = row(witness.grant, columns.grant), plan = row(witness.plan, columns.plan), preflight = row(witness.preflight, columns.preflight);
    const request = object(job.request_json), result = object(job.result_json), contract = readOutputAudioPayload(request);
    const consent = object(request.audioCostConsent), { confirmed, providerTransferConfirmed, ...quote } = consent;
    const preview = parseAudioMiniAppCostPreview(quote);
    if (!contract || !preview || confirmed !== true || providerTransferConfirmed !== true || preview.actorUserId !== actor.userId
      || preview.requestId !== job.job_id || preview.projectId !== native.projectId || preview.documentId !== selected.documentId
      || !equivalent(contract, evidence.contract) || !equivalent(request.outputExecution, evidence.execution) || !equivalent(result.outputExecution, evidence.execution)
      || preview.sourceDigest !== slot.source_digest || preview.requirementsDigest !== plan.requirements_digest
      || preview.draftId !== contract.source.draftId || result.artifactId !== selected.artifactId || result.artifactKind !== "audio"
      || !Array.isArray(result.appendedEventIds) || !result.appendedEventIds.includes(native.completionId)
      || new Set(result.appendedEventIds).size !== result.appendedEventIds.length || result.appendedEventIds.some(value => !id(value))
      || result.providerJobId !== evidence.receipt.providerRequestId || result.providerModel !== preview.audioModel
      || receipt.payload.planner_response_id !== result.plannerResponseId
      || !integer(job.requested_sequence) || !integer(witness.sequence) || witness.sequence <= job.requested_sequence
      || !timestamp(job.expires_at) || !timestamp(job.completed_at) || !id(job.job_id)) return fail();
    const reference = { scopeKey: slot.scope_key, slotId: slot.slot_id, grantId: slot.grant_id, planRevisionId: slot.plan_revision_id,
      targetId: slot.target_id, targetContractDigest: slot.target_contract_digest, sourceDigest: slot.source_digest };
    if (!equivalent(reference, evidence.execution) || slot.status !== "succeeded" || slot.attempt_ordinal !== 0 || slot.previous_slot_id !== null
      || slot.outcome_event_id !== native.completionId || slot.job_id !== job.job_id || slot.provider !== "fal" || slot.model !== preview.audioModel || plan.scope_kind !== "personal"
      || plan.owner_user_id !== actor.userId || plan.project_id !== native.projectId || plan.document_id !== selected.documentId
      || plan.organization_id !== null || plan.project_access_id !== null || plan.source_digest !== slot.source_digest
      || grant.actor_user_id !== actor.userId || grant.payer_user_id !== actor.userId || grant.context_id !== null || grant.status !== "completed"
      || grant.plan_revision_id !== slot.plan_revision_id || preflight.plan_revision_id !== slot.plan_revision_id || preflight.actor_user_id !== actor.userId
      || !timestamp(grant.expires_at) || !timestamp(preflight.expires_at)) return fail();
    if (invalidProviderSubmissions(result) || result.providerSubmissionLegacyUncertain === true) return fail();
    const calls = providerSubmissions(result), reproduced = verifyOutputAudioCalls(calls, contract);
    if (!equivalent(reproduced, evidence.receipt) || !Array.isArray(witness.calls) || witness.callCount !== calls.length
      || witness.calls.length !== calls.length || calls.length > NATIVE_STABLE_AUDIO_PROOF_LIMITS.maximumCalls) return fail();
    const ledger = witness.calls.map(value => row(value, columns.call)); let usedMicrousd = 0, usedTokens = 0;
    for (const entry of ledger) {
      const call = calls.find(value => value.clientRequestId === entry.client_request_id);
      if (!call || entry.scope_key !== slot.scope_key || entry.slot_id !== slot.slot_id || entry.call_key !== call.unitId || entry.stage_key !== call.unitId
        || entry.provider !== call.provider || entry.model !== call.model || entry.status !== "settled" || entry.provider_response_id !== call.providerRequestId
        || entry.used_microusd !== call.costMicrousd || !digest(entry.request_digest) || call.requestDigest !== undefined && entry.request_digest !== call.requestDigest
        || !integer(entry.used_microusd) || !integer(call.totalTokens)) return fail();
      usedMicrousd += entry.used_microusd; usedTokens += call.totalTokens;
    }
    if (!integer(usedMicrousd) || !integer(usedTokens) || !integer(slot.maximum_microusd) || !integer(grant.maximum_microusd)
      || usedMicrousd > slot.maximum_microusd || usedMicrousd > grant.maximum_microusd || !integer(slot.maximum_calls) || calls.length > slot.maximum_calls
      || !integer(grant.maximum_calls) || calls.length > grant.maximum_calls || !integer(slot.maximum_tokens) || usedTokens > slot.maximum_tokens) return fail();
    const inputGuard = personalContentGuard().replace("kind='document-artifact'", "kind='document-artifact-input'");
    const inputBindings = [receipt.payload.input_ref as string, actor.userId, native.projectId, selected.documentId, selected.artifactId];
    const input = await bounded(state, () => state.db.prepare(`SELECT content,expires_at FROM private_content WHERE ${inputGuard}
      AND length(CAST(content AS BLOB))<=${NATIVE_STABLE_AUDIO_PROOF_LIMITS.inputBytes}`)
      .bind(...inputBindings).first<{ content: string; expires_at: string }>());
    if (!input || typeof input.content !== "string" || bytes(input.content) > NATIVE_STABLE_AUDIO_PROOF_LIMITS.inputBytes || !timestamp(input.expires_at)) return fail();
    state.expiresAt = [source.expires_at, input.expires_at, job.expires_at].sort()[0]!; current(state);
    originalInputSource(object(input.content), request, result, receipt.payload, selected.documentId);
    if (!await bounded(state, () => verifyExperienceAudioInput(input.content, evidence, {
      documentId: selected.documentId, projectId: native.projectId, artifactId: selected.artifactId, jobId: job.job_id as string,
      plannerResponseId: result.plannerResponseId as string, source: contract.source, costPreview: preview, usedMicrousd, usedCalls: calls.length,
      grantId: evidence.execution.grantId, slotId: evidence.execution.slotId, planRevisionId: evidence.execution.planRevisionId,
      targetId: evidence.execution.targetId, targetContractDigest: evidence.execution.targetContractDigest, sourceDigest: evidence.execution.sourceDigest,
    }))) return fail();
    const receipts = [receipt, ...(edit ? [edit] : [])];
    const nativeBindings: (string | number | null)[] = [...auth.bindings, `creative:${actor.userId}`], nativeRaw: number[] = [];
    const rawBind = (value: string) => { nativeRaw.push(nativeBindings.length); nativeBindings.push(value); };
    rawBind(events); nativeBindings.push(...contentBindings); rawBind(source.content); nativeBindings.push(source.expires_at); rawBind(principal.auth_json);
    for (const value of receipts) { nativeBindings.push(...value.bindings); rawBind(value.raw); }
    const nativeQuery = packedQuery(`WITH ${auth.cte},${eventCte},expected_events AS (SELECT value FROM json_each(?))
      SELECT 1 AS admitted FROM private_content WHERE ${nativeRetainedSourceFinalGuard()}
      ${receipts.map(() => `AND EXISTS(SELECT 1 FROM event_private_payloads WHERE ${readers.audio.receiptGuard()} AND CAST(private_json AS BLOB)=CAST(? AS BLOB))`).join("\n")}`,
      nativeBindings, nativeRaw, "stable_audio_native_values");
    const inputQuery = packedQuery(`SELECT 1 AS admitted FROM private_content WHERE ${inputGuard}
      AND CAST(content AS BLOB)=CAST(? AS BLOB) AND expires_at=?`, [...inputBindings, input.content, input.expires_at], [inputBindings.length], "stable_audio_input_values");
    const recipeQuery = packedQuery(`WITH ${sourceCte} SELECT 1 AS admitted FROM bounded_stable_audio_source
      WHERE CAST(witness AS BLOB)=CAST(? AS BLOB) AND (SELECT COUNT(*) FROM stable_audio_source)=1
      AND ?>${nowSql} AND EXISTS(SELECT 1 FROM output_native_storage_writes WHERE scope_key=? AND slot_id=?
        AND storage_key=? AND content_sha256=? AND status='written' AND write_acknowledged=1 AND publication_event_id=?)`,
      [...sourceBindings, rawWitness, new Date(state.wallDeadline).toISOString(), evidence.execution.scopeKey, evidence.execution.slotId, key, selected.mediaSha256, native.completionId],
      [sourceBindings.length], "stable_audio_recipe_values");
    state.queries = Object.freeze([nativeQuery, inputQuery, recipeQuery]);
    await execute(state);
    state.snapshot = Object.freeze({ identity: actor, selection: selected, projectId: native.projectId, contentId: native.contentId,
      completionId: native.completionId, jobId: job.job_id as string, inputId: inputBindings[0]!, sourceExpiresAt: source.expires_at,
      inputExpiresAt: input.expires_at, expiresAt: state.expiresAt, authSnapshot: principal.auth_json,
      media: Object.freeze({ url, mimeType: "audio/mpeg", sha256: selected.mediaSha256 }), recipe: "forma.audio.instrumental-20@1" });
    const proof = Object.freeze({}) as NativeStableAudioRecipeProof; proofs.set(proof, state); return proof;
  } catch { return fail(); }
}
function stateOf(proof: NativeStableAudioRecipeProof, env: WorkerEnv) {
  const state = proofs.get(proof); if (!state || state.env !== env || !state.snapshot || !state.queries) return fail(); current(state); return state;
}
async function execute(state: State) {
  if (!state.queries) return fail();
  const statement = selectedShareProofStatement(state.queries, "balanced");
  const row = await bounded(state, () => state.db.prepare(`${statement.withSql} SELECT 1 AS admitted WHERE ${statement.sql}`)
    .bind(...statement.bindings).first<{ admitted: number }>());
  if (row?.admitted !== 1) return fail(); current(state);
}
export function nativeStableAudioRecipeSnapshot(proof: NativeStableAudioRecipeProof, env: WorkerEnv): NativeStableAudioRecipeSnapshot {
  return stateOf(proof, env).snapshot!;
}
/** Rejoin all returned complete queries in the caller's SAME final statement.
 * Returning these queries is not execution or a publication permission. */
export function nativeStableAudioRecipeAssertions(proof: NativeStableAudioRecipeProof, env: WorkerEnv): readonly SelectedShareProofQuery[] {
  return Object.freeze(stateOf(proof, env).queries!.map(value => selectedShareProofQuery(value.sql, value.bindings)));
}
export async function assertNativeStableAudioRecipeCurrent(proof: NativeStableAudioRecipeProof, env: WorkerEnv): Promise<void> {
  await execute(stateOf(proof, env)); stateOf(proof, env);
}

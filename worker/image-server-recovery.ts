import type { generateCreativeDirection } from "./openai-adapter.ts";
import { createHash } from "node:crypto";
import type { generateCreativeImage } from "./image-adapter.ts";
import type { DocumentJobRow } from "./document-jobs-api.ts";
import { eventWriteBindings, serializeEvent, type EventRow, type WorkerEnv } from "./runtime.ts";
import { preparePrivateContent, privateContentScopeGuard, type PilotUser } from "./pilot-policy.ts";
import { outputAssertionStatements, OutputConflictError, type OutputOperationSlot, type OutputScope, type OutputSqlAssertion } from "./output-requirements-ledger.ts";
import { hasUnresolvedProviderSubmission, invalidProviderSubmissions, providerSubmissions, type PaidProviderSubmission } from "../src/model/provider-submission.ts";
import { mediaKeyMatchesOwnerNamespace } from "../src/model/media-ownership.ts";

export type ImageRecoveryStage = {
  version: 1;
  generationId: string;
  requestedEventId: string;
  compiledEventId: string;
  budgetEventId: string;
  planningSource: "provider" | "fan-cache";
  planned: Awaited<ReturnType<typeof generateCreativeDirection>>;
  rendered?: {
    image: Omit<Awaited<ReturnType<typeof generateCreativeImage>>, "bytes">;
    media: { url: string; mimeType: string; contentHash: string };
  };
};

export type ImageRecoveryPointer = {
  version: 1;
  stage: "planned" | "rendered";
  inputDigest: string;
  contentId: string;
  contentSha256: string;
};

export type ImageRecoveryProviderCall = {
  call_key: string;
  stage_key: string;
  client_request_id: string;
  request_digest: string;
  provider: string;
  model: string;
  status: string;
  used_microusd: number | null;
  provider_response_id: string | null;
};

export type ImageFinalizationTotals = {
  usedTokens: number; usedMicrousd: number; inputTokens: number; outputTokens: number;
  plannerTokens: number; plannerInputTokens: number; plannerOutputTokens: number;
  imageTokens: number; imageInputTokens: number; imageOutputTokens: number;
  plannerMicrousd: number; imageMicrousd: number;
};
export type ImageFinalizationFinancialProof = {
  readonly needsSettlement: boolean;
  readonly totals: Readonly<ImageFinalizationTotals>;
  readonly receipt: { reservation_id: string; reserved_microusd: number; used_microusd: number; status: string };
  readonly receipts: readonly PaidProviderSubmission[];
  readonly generationReceipt: Readonly<{ provider: string; model: string; provider_request_status: "completed";
    source_transmission_status: "transmitted"; settled_cost_microusd: number; reservation_status: string; actual_provider_call_count: number }>;
  readonly assertions: readonly OutputSqlAssertion[];
  publicationStatements(events: EventRow[]): D1PreparedStatement[];
};
export type ImageFinalizationMedia = { contentHash: string; mimeType: string; provider: string | null; providerModel: string | null; providerRequestId: string | null };
export type ImageFinalizationMediaVerifier = { read(mediaUrl: unknown): Promise<ImageFinalizationMedia | null> };
const finalizationMediaVerifiers = new WeakMap<ImageFinalizationMediaVerifier, { env: WorkerEnv; ownerId: string }>();

/** A recovery verification-work ceiling, not a generation or upload entitlement. */
export function createImageFinalizationMediaVerifier(env: WorkerEnv, ownerId: string): ImageFinalizationMediaVerifier {
  let remaining = 64 * 1024 * 1024;
  const verifier: ImageFinalizationMediaVerifier = Object.freeze({ async read(mediaUrl: unknown): Promise<ImageFinalizationMedia | null> {
    if (typeof mediaUrl !== "string" || !mediaUrl.startsWith("/api/media/")) return null;
    let key: string;
    try { key = decodeURIComponent(mediaUrl.slice("/api/media/".length)); } catch { return null; }
    if (!mediaKeyMatchesOwnerNamespace(key, ownerId)) return null;
    const object = await env.MEDIA.get(key);
    if (!object) return null;
    let body: typeof object.body | null = null, reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let verified: ImageFinalizationMedia | null = null, cleanupFailed = false;
    try {
      // Capture the body first so metadata or reader construction failures can
      // still cancel it. No body is read until its declared size is admitted.
      body = object.body;
      const size = object.size, metadata = { ...object.customMetadata };
      const headers = new Headers(); object.writeHttpMetadata(headers);
      const mimeType = headers.get("content-type") ?? "image/png";
      if (metadata.ownerId !== ownerId || !mimeType.startsWith("image/") || typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0 || size > remaining) return null;
      // Reserve before the first body read, including concurrent calls on this
      // verifier. Failed reads consume their allocation; retries cannot multiply it.
      remaining -= size;
      reader = body.getReader();
      const digest = createHash("sha256");
      let bytes = 0, ended = false;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) { ended = true; break; }
        if (!(chunk.value instanceof Uint8Array) || chunk.value.byteLength === 0 || !Number.isSafeInteger(bytes + chunk.value.byteLength) || bytes + chunk.value.byteLength > size) break;
        bytes += chunk.value.byteLength;
        digest.update(chunk.value);
      }
      if (ended && bytes === size) {
        const contentHash = digest.digest("hex");
        if (metadata.sha256 === undefined || metadata.sha256 === contentHash) verified = Object.freeze({ contentHash, mimeType,
          provider: metadata.provider || null, providerModel: metadata.providerModel || metadata.model || null, providerRequestId: metadata.providerRequestId || null });
      }
    } catch { verified = null; }
    finally {
      if (!verified) { try { if (reader) await reader.cancel(); else if (body) await body.cancel(); } catch { cleanupFailed = true; } }
      if (reader) { try { reader.releaseLock(); } catch { cleanupFailed = true; } }
    }
    return cleanupFailed ? null : verified;
  } });
  finalizationMediaVerifiers.set(verifier, { env, ownerId });
  return verifier;
}

export type ImageFinalizationProof<Input extends { inputDigest: string; contextHash: string } = { inputDigest: string; contextHash: string }> = {
  readonly stage: ImageRecoveryStage & { rendered: NonNullable<ImageRecoveryStage["rendered"]> };
  readonly anchors: readonly EventRow[];
  readonly expiresAt: string;
  readonly receipts: readonly PaidProviderSubmission[];
  readonly payerUserId: string;
  readonly input: Input;
  readonly assertions: readonly OutputSqlAssertion[];
  readonly settlementAssertions: readonly OutputSqlAssertion[];
  readFinancialProof(): Promise<ImageFinalizationFinancialProof>;
};

type FinalizationSqlRow = Record<string, string | number | null>;
type FinalizationReadProofBatch = (assertions: readonly OutputSqlAssertion[], reads?: readonly D1PreparedStatement[]) => Promise<D1Result<Record<string, unknown>>[]>;
// The existing retained-proof string domain, distinct from the media work budget.
const FINALIZATION_PROOF_BYTES = 2_000_000;
const finalizationJson = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length > FINALIZATION_PROOF_BYTES) return false;
  // Count UTF-8 bytes without allocating a second proof-sized buffer.
  let bytes = 0;
  for (const point of value) {
    const code = point.codePointAt(0)!;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    if (bytes > FINALIZATION_PROOF_BYTES) return false;
  }
  return true;
};
const finalizationFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) finalizationFreeze(item);
    Object.freeze(value);
  }
  return value;
};
const finalizationAssertions = (values: readonly OutputSqlAssertion[]) => finalizationFreeze(values.map(value => ({
  sql: value.sql, ...(value.bindings ? { bindings: [...value.bindings] } : {}),
  ...(value.deadlineMs === undefined ? {} : { deadlineMs: value.deadlineMs }),
})));
const finalizationDate = (value: unknown): value is string => typeof value === "string" && Number.isSafeInteger(Date.parse(value))
  && new Date(Date.parse(value)).toISOString() === value;

/** Bounded exact-row witnesses for these original financial/operational tables only. */
function finalizationRows(table: "document_jobs" | "output_operation_slots" | "output_execution_grants" | "output_provider_calls"
  | "output_native_storage_writes" | "budget_reservations" | "cost_budget_reservations"
  | "project_budget_reservation_scopes" | "pilot_cost_reservation_scopes" | "budget_counters" | "cost_budget_counters",
where: string, bindings: Array<string | number | null>, rows: readonly FinalizationSqlRow[]): OutputSqlAssertion[] {
  if (rows.length > 8) return fail("output_image_finalization_proof_capacity");
  const exact = rows.map(row => {
    const entries = Object.entries(row);
    if (!entries.length || entries.length > 64 || entries.some(([key, value]) => !/^[a-z][a-z0-9_]*$/u.test(key)
      || value !== null && typeof value !== "string" && (typeof value !== "number" || !Number.isFinite(value)))) return fail("output_image_finalization_proof_invalid");
    return { sql: `EXISTS(SELECT 1 FROM ${table} WHERE ${entries.map(([key]) => `"${key}" IS ?`).join(" AND ")})`, bindings: entries.map(([, value]) => value) };
  });
  return [{ sql: `(SELECT COUNT(*) FROM ${table} WHERE ${where})=?`, bindings: [...bindings, rows.length] }, ...exact];
}

export type ImageRecovery = {
  read(inputDigest: string): Promise<{ stage: ImageRecoveryStage; anchors: readonly EventRow[] } | null>;
  save(inputDigest: string, stage: ImageRecoveryStage): Promise<void>;
  publicationStatements(events: EventRow[]): D1PreparedStatement[];
};

type ImageRecoveryIdentity = {
  jobId: string; actorUserId: string; scopeKey: string; slotId: string; grantId: string;
  sourceDigest: string; routeDigest: string; inputDigest: string;
};
type ImageRecoveryEnvelope = { version: 1; identity: ImageRecoveryIdentity; stage: ImageRecoveryStage };
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const sha256 = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const usage = (value: unknown): value is { inputTokens: number; outputTokens: number; totalTokens: number } => record(value)
  && count(value.inputTokens) && count(value.outputTokens) && count(value.totalTokens)
  && value.inputTokens + value.outputTokens === value.totalTokens;
const fail = (code: string): never => { throw new OutputConflictError(code, 409); };
const parse = (raw: string | null): Record<string, unknown> => {
  let value: unknown;
  try { value = JSON.parse(raw ?? "{}"); } catch { return fail("output_image_recovery_checkpoint_invalid"); }
  return record(value) ? value : fail("output_image_recovery_checkpoint_invalid");
};

/** Hash the captured JSON value, without reconstructing or removing input fields. */
export async function imageRecoveryDigest(value: unknown): Promise<string> {
  const raw = JSON.stringify(value);
  if (typeof raw !== "string") return fail("output_image_recovery_digest_invalid");
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw))), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Shape checks only. Neither this reader nor the classifier grants execution authority. */
export function readImageRecoveryPointer(value: unknown): ImageRecoveryPointer | null {
  return record(value) && value.version === 1 && (value.stage === "planned" || value.stage === "rendered")
    && sha256(value.inputDigest) && text(value.contentId) && sha256(value.contentSha256)
    && Object.keys(value).length === 5 ? value as ImageRecoveryPointer : null;
}

export function readImageRecoveryStage(value: unknown): ImageRecoveryStage | null {
  if (!record(value) || value.version !== 1 || !text(value.generationId) || !text(value.requestedEventId)
    || !text(value.compiledEventId) || !text(value.budgetEventId) || (value.planningSource !== "provider" && value.planningSource !== "fan-cache")) return null;
  const planned = value.planned;
  if (!record(planned) || !text(planned.model) || typeof planned.responseId !== "string" || !text(planned.raw)
    || !record(planned.output) || !usage(planned.usage) || typeof planned.latencyMs !== "number" || !Number.isFinite(planned.latencyMs) || planned.latencyMs < 0) return null;
  try { if (JSON.stringify(JSON.parse(planned.raw)) !== JSON.stringify(planned.output)) return null; } catch { return null; }
  if (value.rendered !== undefined) {
    const rendered = value.rendered;
    if (!record(rendered) || !record(rendered.image) || !record(rendered.media)) return null;
    const image = rendered.image, media = rendered.media;
    if (Object.hasOwn(image, "bytes") || !text(image.providerSubmissionId) || (image.provider !== "openai" && image.provider !== "fal")
      || !text(image.model) || !text(image.adapterId) || !text(image.adapterVersion) || !text(image.prompt)
      || !usage(image.usage) || !record(image.costBreakdown) || !count(image.costBreakdown.totalMicrousd)
      || !Number.isSafeInteger(image.width) || Number(image.width) <= 0 || !Number.isSafeInteger(image.height) || Number(image.height) <= 0
      || (image.mimeType !== "image/png" && image.mimeType !== "image/jpeg" && image.mimeType !== "image/webp")
      || !text(media.url) || !media.url.startsWith("/api/media/") || media.url.includes("?") || media.url.includes("#")
      || media.mimeType !== image.mimeType || !sha256(media.contentHash)) return null;
  }
  return value as ImageRecoveryStage;
}

const sameUsage = (receipt: PaidProviderSubmission, expected: { inputTokens: number; outputTokens: number; totalTokens: number }) =>
  receipt.inputTokens === expected.inputTokens && receipt.outputTokens === expected.outputTokens && receipt.totalTokens === expected.totalTokens;
const matchesCall = (call: ImageRecoveryProviderCall, receipt: PaidProviderSubmission) => call.status === "settled"
  && call.call_key === call.stage_key && call.client_request_id === receipt.clientRequestId
  && sha256(call.request_digest) && call.request_digest === receipt.requestDigest
  && (call.call_key === "planning:initial" ? receipt.operation === "planning" && receipt.provider === "openai"
    : call.call_key === "image:initial" && receipt.operation === "image")
  && call.provider === receipt.provider && call.model === receipt.model && receipt.status === "completed"
  && count(call.used_microusd) && call.used_microusd === receipt.costMicrousd
  && call.provider_response_id === (receipt.providerRequestId ?? null);

/** A complete saved stage must account for the entire exact-slot call set. */
export function classifyImageRecoveryStage(stage: ImageRecoveryStage | null, checkpoint: Record<string, unknown>, calls: readonly ImageRecoveryProviderCall[]): "empty" | "planned" | "rendered" | "blocked" {
  if (invalidProviderSubmissions(checkpoint) || hasUnresolvedProviderSubmission(checkpoint)) return "blocked";
  if (Object.hasOwn(checkpoint, "generationReceipt") && !record(checkpoint.generationReceipt)) return "blocked";
  const receipts = providerSubmissions(checkpoint);
  if (!stage) {
    if (Object.hasOwn(checkpoint, "imageRecovery")) return "blocked";
    const receipt = record(checkpoint.generationReceipt) ? checkpoint.generationReceipt : {};
    return calls.length === 0 && receipts.length === 0 && !checkpoint.plannerResponseId && !checkpoint.plannerResponseIds
      && !checkpoint.plannerUsage && !checkpoint.providerJobId && !checkpoint.artifactPlan
      && !["providerRequestId", "productionAnchor", "productionSceneReceipts", "productionFrameReceipts", "renderedItems", "partialMediaUrl", "mediaUrl"].some(key => checkpoint[key])
      && (!receipt.provider_request_status || receipt.provider_request_status === "not_submitted")
      && (!receipt.source_transmission_status || receipt.source_transmission_status === "not_transmitted")
      && (!receipt.actual_provider_call_count || receipt.actual_provider_call_count === 0) ? "empty" : "blocked";
  }
  if (!readImageRecoveryStage(stage)) return "blocked";
  const expectedCalls = (stage.planningSource === "provider" ? 1 : 0) + (stage.rendered ? 1 : 0);
  if (calls.length !== expectedCalls || receipts.length !== expectedCalls || new Set(calls.map(call => call.call_key)).size !== calls.length) return "blocked";
  for (const call of calls) {
    const receipt = receipts.find(candidate => candidate.clientRequestId === call.client_request_id);
    if (!receipt || !matchesCall(call, receipt)) return "blocked";
  }
  if (stage.planningSource === "provider") {
    const call = calls.find(candidate => candidate.call_key === "planning:initial");
    const receipt = call && receipts.find(candidate => candidate.clientRequestId === call.client_request_id);
    if (!call || !receipt || receipt.operation !== "planning" || receipt.provider !== "openai" || !text(stage.planned.responseId)
      || receipt.providerRequestId !== stage.planned.responseId
      || !sameUsage(receipt, stage.planned.usage) || checkpoint.plannerResponseId !== stage.planned.responseId
      || checkpoint.plannerModel !== call.model || JSON.stringify(checkpoint.plannerResponseIds) !== JSON.stringify([stage.planned.responseId])
      || !usage(checkpoint.plannerUsage) || !sameUsage(receipt, checkpoint.plannerUsage)) return "blocked";
  } else if (stage.planned.usage.totalTokens !== 0 || calls.some(call => call.call_key.startsWith("planning"))
    || ["plannerResponseId", "plannerResponseIds", "plannerUsage", "plannerModel"].some(key => Object.hasOwn(checkpoint, key))) return "blocked";
  if (stage.rendered) {
    const { image } = stage.rendered;
    const call = calls.find(candidate => candidate.call_key === "image:initial");
    const receipt = call && receipts.find(candidate => candidate.clientRequestId === image.providerSubmissionId);
    if (!call || !receipt || call.client_request_id !== image.providerSubmissionId || receipt.operation !== "image"
      || receipt.provider !== image.provider || receipt.model !== image.model
      || (receipt.providerRequestId ?? null) !== (image.providerRequestId ?? null)
      || receipt.costMicrousd !== image.costBreakdown.totalMicrousd || !sameUsage(receipt, image.usage)) return "blocked";
  }
  return stage.rendered ? "rendered" : "planned";
}

/** Scheduler triage only: a pointer is not proof that its private body remains usable. */
export function classifyImageRecoveryCandidate(job: Pick<DocumentJobRow, "kind" | "status" | "attempt_count" | "result_json">, calls: readonly ImageRecoveryProviderCall[]): "undispatched" | "planned" | "rendered" | "unresolved" | "observe" {
  if (job.kind !== "generate" || !["queued", "running"].includes(job.status)) return "observe";
  let checkpoint: Record<string, unknown>;
  try { checkpoint = parse(job.result_json); } catch { return "unresolved"; }
  if (hasUnresolvedProviderSubmission(checkpoint) || invalidProviderSubmissions(checkpoint)) return "unresolved";
  if (!count(job.attempt_count) || Object.hasOwn(checkpoint, "generationReceipt") && !record(checkpoint.generationReceipt)) return "unresolved";
  if (!Object.hasOwn(checkpoint, "imageRecovery")) {
    if (job.attempt_count > 0 && checkpoint.providerSubmissionProtocol !== 1) return "unresolved";
    return classifyImageRecoveryStage(null, checkpoint, calls) === "empty" ? "undispatched" : "unresolved";
  }
  const pointer = readImageRecoveryPointer(checkpoint.imageRecovery);
  if (!pointer) return "unresolved";
  const receipts = providerSubmissions(checkpoint);
  if (receipts.length !== calls.length || new Set(calls.map(call => call.call_key)).size !== calls.length
    || calls.some(call => { const receipt = receipts.find(candidate => candidate.clientRequestId === call.client_request_id); return !receipt || !matchesCall(call, receipt); })) return "unresolved";
  const planning = calls.filter(call => call.call_key === "planning:initial"), images = calls.filter(call => call.call_key === "image:initial");
  if (planning.length > 1 || images.length > 1 || planning.length + images.length !== calls.length) return "unresolved";
  return pointer.stage === "planned" ? images.length === 0 ? "planned" : "unresolved" : images.length === 1 ? "rendered" : "unresolved";
}

/** The original execution factory supplies all authority; callers supply only captured input and stage. */
export function createImageRecoveryStore(options: {
  env: WorkerEnv; user: PilotUser; job: DocumentJobRow; scope: OutputScope; slot: OutputOperationSlot;
  liveAssertions: () => OutputSqlAssertion[];
  publicationAssertions: () => OutputSqlAssertion[];
}): ImageRecovery {
  const { env, user, job, scope, slot, liveAssertions, publicationAssertions } = options;
  if (job.kind !== "generate" || job.job_id !== slot.jobId || slot.scopeKey !== scope.key || job.owner_id !== user.userId
    || scope.actorUserId !== user.userId || job.document_id !== scope.documentId || job.stream_id !== `creative:${scope.ownerUserId}`) return fail("output_image_recovery_scope_mismatch");
  // Publication retains primitive execution identity before any await. Neither
  // a returned stage nor subsequent progress can retarget this private proof.
  const publicationOwner = Object.freeze({ jobId: job.job_id, ownerId: user.userId, streamId: job.stream_id,
    correlationId: job.correlation_id, attemptCount: job.attempt_count, documentId: job.document_id,
    scopeKey: scope.key, slotId: slot.slotId });
  // Event bodies belong to the creative stream owner, including shared jobs
  // whose executing actor owns the job and its retained provider-output body.
  const anchorOwner = Object.freeze({ ownerId: scope.ownerUserId, projectId: scope.projectId,
    documentId: job.document_id, streamId: job.stream_id, jobId: job.job_id, attemptCount: job.attempt_count });
  type RenderedPublicationWitness = {
    generationId: string; compiledEventId: string; mediaUrl: string; mediaType: string; contentHash: string;
    storageKey: string; pointer: string; retainedAssertions: OutputSqlAssertion[]; calls: OutputSqlAssertion;
  };
  let renderedPublication: RenderedPublicationWitness | null = null;
  const original = parse(job.result_json);
  let previousPointer = Object.hasOwn(original, "imageRecovery") ? JSON.stringify(original.imageRecovery) : null;
  const identity = (inputDigest: string): ImageRecoveryIdentity => {
    if (!sha256(inputDigest)) return fail("output_image_recovery_input_invalid");
    return { jobId: job.job_id, actorUserId: user.userId, scopeKey: scope.key, slotId: slot.slotId, grantId: slot.grantId,
      sourceDigest: slot.sourceDigest, routeDigest: slot.routeDigest, inputDigest };
  };
  const guards = () => liveAssertions().flatMap(assertion => outputAssertionStatements(env, assertion));
  const snapshot = async () => {
    const expectedPointer = previousPointer;
    const assertions = guards();
    const results = await env.DB.batch([...assertions,
      env.DB.prepare("SELECT result_json,updated_at FROM document_jobs WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND attempt_count=? AND status IN('running','committing')")
        .bind(job.job_id, user.userId, job.stream_id, job.correlation_id, job.attempt_count),
      env.DB.prepare("SELECT call_key,stage_key,client_request_id,request_digest,provider,model,status,used_microusd,provider_response_id FROM output_provider_calls WHERE scope_key=? AND slot_id=? ORDER BY call_key")
        .bind(scope.key, slot.slotId)]);
    const current = results[assertions.length]?.results[0] as { result_json: string | null; updated_at: string } | undefined;
    if (!current) return fail("output_image_recovery_execution_changed");
    const checkpoint = parse(current.result_json);
    const pointerRaw = Object.hasOwn(checkpoint, "imageRecovery") ? JSON.stringify(checkpoint.imageRecovery) : null;
    if (pointerRaw !== expectedPointer) return fail("output_image_recovery_pointer_changed");
    return { ...current, checkpoint, expectedPointer, calls: results[assertions.length + 1]!.results as ImageRecoveryProviderCall[] };
  };
  const currentRow = (raw: string | null): OutputSqlAssertion => ({
    sql: "EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND attempt_count=? AND result_json IS ? AND status IN('running','committing'))",
    bindings: [job.job_id, user.userId, job.stream_id, job.correlation_id, job.attempt_count, raw],
  });
  const currentCalls = (calls: readonly ImageRecoveryProviderCall[]): OutputSqlAssertion => ({
    sql: `(SELECT COUNT(*) FROM output_provider_calls WHERE scope_key=? AND slot_id=?)=?${calls.map(() => " AND EXISTS(SELECT 1 FROM output_provider_calls WHERE scope_key=? AND slot_id=? AND call_key=? AND stage_key=? AND client_request_id=? AND request_digest=? AND provider=? AND model=? AND status=? AND used_microusd IS ? AND provider_response_id IS ?)").join("")}`,
    bindings: [scope.key, slot.slotId, calls.length, ...calls.flatMap(call => [scope.key, slot.slotId, call.call_key, call.stage_key, call.client_request_id, call.request_digest, call.provider, call.model, call.status, call.used_microusd, call.provider_response_id])],
  });
  const mediaAssertion = (stage: ImageRecoveryStage): OutputSqlAssertion[] => {
    if (!stage.rendered) return [];
    let storageKey: string;
    try { storageKey = decodeURIComponent(stage.rendered.media.url.slice("/api/media/".length)); } catch { return fail("output_image_recovery_media_invalid"); }
    return [{ sql: "EXISTS(SELECT 1 FROM output_native_storage_writes WHERE scope_key=? AND slot_id=? AND storage_key=? AND content_sha256=? AND status='written')",
      bindings: [scope.key, slot.slotId, storageKey, stage.rendered.media.contentHash] }];
  };
  const retained = async (inputDigest: string, current: Awaited<ReturnType<typeof snapshot>>): Promise<{ stage: ImageRecoveryStage | null; assertions: OutputSqlAssertion[] }> => {
    if (current.expectedPointer === null) return { stage: null, assertions: [] };
    const pointer = readImageRecoveryPointer(current.checkpoint.imageRecovery);
    if (!pointer || pointer.inputDigest !== inputDigest) return fail("output_image_recovery_pointer_invalid");
    const containment = privateContentScopeGuard(user.userId, user.projectExecution);
    const assertions = [...guards(), ...outputAssertionStatements(env, currentRow(current.result_json))];
    const results = await env.DB.batch([...assertions, env.DB.prepare(`SELECT content FROM private_content WHERE content_id=? AND owner_id=? AND kind='provider-output' AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${containment.sql}`)
      .bind(pointer.contentId, user.userId, ...containment.bindings)]);
    const stored = results[assertions.length]?.results[0] as { content: string } | undefined;
    if (!stored || typeof stored.content !== "string") return fail("output_image_recovery_content_unavailable");
    let envelope: unknown;
    try { envelope = JSON.parse(stored.content); } catch { return fail("output_image_recovery_content_invalid"); }
    if (JSON.stringify(envelope) !== stored.content || await imageRecoveryDigest(envelope) !== pointer.contentSha256
      || !record(envelope) || envelope.version !== 1 || JSON.stringify(envelope.identity) !== JSON.stringify(identity(inputDigest))) return fail("output_image_recovery_identity_mismatch");
    const stage = readImageRecoveryStage(envelope.stage);
    if (!stage || pointer.stage !== (stage.rendered ? "rendered" : "planned")) return fail("output_image_recovery_stage_invalid");
    return { stage, assertions: [{
      sql: `EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind='provider-output' AND content=? AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${containment.sql})`,
      bindings: [pointer.contentId, user.userId, stored.content, ...containment.bindings],
    }] };
  };
  return {
    async read(inputDigest) {
      renderedPublication = null;
      identity(inputDigest);
      const current = await snapshot(), saved = await retained(inputDigest, current), stage = saved.stage;
      if (classifyImageRecoveryStage(stage, current.checkpoint, current.calls) === "blocked") return fail("output_image_recovery_evidence_incomplete");
      // Copy all retained proof before the final read transaction and before the
      // caller receives its stage. These bindings contain only captured scalars.
      const calls = currentCalls(current.calls);
      let captured: RenderedPublicationWitness | null = null;
      if (stage?.rendered) {
        if (current.expectedPointer === null) return fail("output_image_recovery_pointer_invalid");
        let storageKey: string;
        try { storageKey = decodeURIComponent(stage.rendered.media.url.slice("/api/media/".length)); } catch { return fail("output_image_recovery_media_invalid"); }
        captured = { generationId: stage.generationId, compiledEventId: stage.compiledEventId,
          mediaUrl: stage.rendered.media.url, mediaType: stage.rendered.media.mimeType, contentHash: stage.rendered.media.contentHash,
          storageKey, pointer: current.expectedPointer,
          retainedAssertions: saved.assertions.map(assertion => ({ ...assertion, bindings: [...(assertion.bindings ?? [])] })),
          calls: { ...calls, bindings: [...(calls.bindings ?? [])] } };
      }
      // These exact retained IDs are execution evidence, not collaborative
      // source context. Capture their type-specific private scope before await.
      const anchorSpecs = stage ? [
        { eventId: stage.requestedEventId, type: "GenerationRequested", projectId: null, documentId: anchorOwner.documentId },
        { eventId: stage.compiledEventId, type: "ContextCompiled", projectId: anchorOwner.projectId, documentId: anchorOwner.documentId },
        { eventId: stage.budgetEventId, type: "BudgetReserved", projectId: null, documentId: null },
      ] : [];
      const originalCorrelations = count(anchorOwner.attemptCount)
        ? Array.from({ length: Math.min(anchorOwner.attemptCount, 2) }, (_, index) => `${anchorOwner.jobId}:attempt:${index + 1}`) : [];
      const assertions = [...guards(), ...[currentRow(current.result_json), calls, ...saved.assertions, ...(stage ? mediaAssertion(stage) : [])].flatMap(assertion => outputAssertionStatements(env, assertion))];
      const results = await env.DB.batch([...assertions, ...anchorSpecs.map(anchor => env.DB.prepare(`SELECT event.*, body.private_json FROM events event
        JOIN event_private_payloads body ON body.private_event_id=event.event_id
        WHERE event.event_id=? AND event.stream_id=? AND event.type=?
          AND event.correlation_id IN (${originalCorrelations.map(() => "?").join(",") || "NULL"})
          AND body.owner_id=? AND body.project_id IS ? AND body.document_id IS ? AND body.redacted_at IS NULL`)
        .bind(anchor.eventId, anchorOwner.streamId, anchor.type, ...originalCorrelations, anchorOwner.ownerId, anchor.projectId, anchor.documentId))]);
      const anchors = anchorSpecs.flatMap((_, index) => ((results[assertions.length + index]?.results ?? []) as Record<string, unknown>[]).map(row => {
        let event: EventRow;
        try {
          if (typeof row.private_json !== "string") throw new Error("private_body_unavailable");
          event = serializeEvent(row);
        } catch { throw new Error("image_recovery_anchor_unavailable"); }
        if (!record(event.payload) || !originalCorrelations.includes(event.correlationId)) throw new Error("image_recovery_anchor_unavailable");
        return event;
      }));
      renderedPublication = captured;
      return stage ? { stage, anchors } : null;
    },
    publicationStatements(events) {
      const retained = renderedPublication;
      const completions = events.filter(event => event.type === "GenerationCompleted");
      // Fresh generation still publishes through its original MEDIA.put guard.
      if (!retained || !completions.length) return [];
      if (completions.length !== 1) return fail("output_image_recovery_publication_invalid");
      const event = completions[0]!, payload = event.payload;
      if (event.streamId !== publicationOwner.streamId || event.correlationId !== publicationOwner.correlationId
        || event.actor !== "worker:generator" || event.clientId !== "server:document-job:generate"
        || event.causationId !== retained.compiledEventId || payload.document_id !== publicationOwner.documentId
        || payload.generation_id !== retained.generationId || payload.media_url !== retained.mediaUrl
        || payload.media_type !== retained.mediaType || payload.source_content_hash !== retained.contentHash)
        return fail("output_image_recovery_publication_invalid");
      const values = eventWriteBindings(event);
      if (values[16] === null) return fail("output_image_recovery_publication_invalid");
      // The append may lose a head race and insert no event. Check the exact
      // persisted public/private envelope, not merely a matching media URL.
      const persisted = `EXISTS(SELECT 1 FROM events stored JOIN event_private_payloads body ON body.private_event_id=stored.event_id
        WHERE stored.event_id=? AND stored.stream_id=? AND stored.sequence=? AND stored.occurred_at=? AND stored.recorded_at=?
          AND stored.actor=? AND stored.client_id=? AND stored.correlation_id=? AND stored.causation_id IS ?
          AND stored.compensates_event_id IS ? AND stored.schema_version=? AND stored.type=? AND stored.payload=?
          AND body.owner_id=? AND body.project_id IS ? AND body.document_id IS ? AND body.private_json=? AND body.redacted_at IS NULL)`;
      const absent = "NOT EXISTS(SELECT 1 FROM events WHERE event_id=?)";
      const storage = "scope_key=? AND slot_id=? AND storage_key=? AND content_sha256=? AND status='written' AND write_acknowledged=1";
      const storageBindings = [publicationOwner.scopeKey, publicationOwner.slotId, retained.storageKey, retained.contentHash];
      const proof: OutputSqlAssertion[] = [{
        sql: "EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND attempt_count=? AND kind='generate' AND status IN('running','committing') AND json_extract(result_json,'$.imageRecovery') IS ?)",
        bindings: [publicationOwner.jobId, publicationOwner.ownerId, publicationOwner.streamId, publicationOwner.correlationId, publicationOwner.attemptCount, retained.pointer],
      }, ...retained.retainedAssertions, retained.calls,
      { sql: `${absent} OR ${persisted}`, bindings: [event.eventId, ...values] },
      { sql: `${absent} OR EXISTS(SELECT 1 FROM output_native_storage_writes WHERE ${storage} AND (publication_event_id IS NULL OR publication_event_id=?))`,
        bindings: [event.eventId, ...storageBindings, event.eventId] }];
      // Late authority retains deadlines and source guards without repeating
      // the projection-head equality invalidated by this append's own INSERTs.
      return [...publicationAssertions().flatMap(assertion => outputAssertionStatements(env, assertion)),
        ...proof.flatMap(assertion => outputAssertionStatements(env, assertion)),
        env.DB.prepare(`UPDATE output_native_storage_writes SET publication_event_id=?,updated_at=? WHERE ${storage} AND publication_event_id IS NULL AND ${persisted}`)
          .bind(event.eventId, new Date().toISOString(), ...storageBindings, ...values),
        ...outputAssertionStatements(env, { sql: `${absent} OR EXISTS(SELECT 1 FROM output_native_storage_writes WHERE ${storage} AND publication_event_id=?)`,
          bindings: [event.eventId, ...storageBindings, event.eventId] })];
    },
    async save(inputDigest, value) {
      const expectedIdentity = identity(inputDigest);
      // Capture caller-owned objects before the first await; no mutable alias becomes retained proof.
      let captured: unknown;
      try { captured = JSON.parse(JSON.stringify(value)); } catch { return fail("output_image_recovery_stage_invalid"); }
      const stage = readImageRecoveryStage(captured);
      if (!stage) return fail("output_image_recovery_stage_invalid");
      const current = await snapshot(), saved = await retained(inputDigest, current), previous = saved.stage;
      if (classifyImageRecoveryStage(stage, current.checkpoint, current.calls) === "blocked") return fail("output_image_recovery_evidence_incomplete");
      if (!previous && stage.rendered) return fail("output_image_recovery_stage_order");
      if (previous) {
        const { rendered: oldRendered, ...oldPlan } = previous;
        const { rendered: nextRendered, ...nextPlan } = stage;
        if (JSON.stringify(oldPlan) !== JSON.stringify(nextPlan) || oldRendered && JSON.stringify(oldRendered) !== JSON.stringify(nextRendered)) return fail("output_image_recovery_stage_changed");
        if (Boolean(oldRendered) === Boolean(nextRendered)) {
          await env.DB.batch([...guards(), ...[currentRow(current.result_json), currentCalls(current.calls), ...saved.assertions, ...mediaAssertion(stage)].flatMap(assertion => outputAssertionStatements(env, assertion))]);
          return;
        }
      }
      const envelope: ImageRecoveryEnvelope = { version: 1, identity: expectedIdentity, stage };
      const raw = JSON.stringify(envelope), contentSha256 = await imageRecoveryDigest(envelope);
      const prepared = await preparePrivateContent(env, user.userId, "provider-output", raw, user.projectExecution);
      const pointer: ImageRecoveryPointer = { version: 1, stage: stage.rendered ? "rendered" : "planned", inputDigest, contentId: prepared.contentId, contentSha256 };
      const inserted = prepared.statements.flatMap((statement, index) => index < prepared.requiredInserts
        ? [statement, ...outputAssertionStatements(env, { sql: "changes()=1" })] : [statement]);
      const timestamp = new Date().toISOString();
      const pointerWrite = env.DB.prepare("UPDATE document_jobs SET result_json=json_patch(COALESCE(result_json,'{}'),?),updated_at=? WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND attempt_count=? AND result_json IS ? AND json_extract(result_json,'$.imageRecovery') IS ? AND status IN('running','committing')")
        .bind(JSON.stringify({ imageRecovery: pointer }), timestamp, job.job_id, user.userId, job.stream_id, job.correlation_id, job.attempt_count, current.result_json, current.expectedPointer);
      await env.DB.batch([...guards(), ...[currentRow(current.result_json), currentCalls(current.calls), ...saved.assertions, ...mediaAssertion(stage)].flatMap(assertion => outputAssertionStatements(env, assertion)),
        ...inserted, pointerWrite, ...outputAssertionStatements(env, { sql: "changes()=1" })]);
      previousPointer = JSON.stringify(pointer);
      job.result_json = JSON.stringify({ ...current.checkpoint, imageRecovery: pointer });
      job.updated_at = timestamp;
    },
  };
}

/** Existing explicit-stop policy only; the caller must separately prove authority and custody. */
export function imageRecoveryHasNoExplicitStop(
  job: Readonly<Pick<DocumentJobRow, "error_message">>, checkpoint: Readonly<Record<string, unknown>>,
): boolean {
  const failure = record(checkpoint.errorDetail) ? checkpoint.errorDetail : {};
  const canceled = ["force_failed_by_admin", "canceled_by_user", "project_access_revoked", "project_job_authorization_failed", "output_authorization_expired_or_revoked"];
  return !(failure.category === "canceled"
    || canceled.includes(String(job.error_message ?? "")) || canceled.includes(String(failure.code ?? "")));
}

/** Capture original job/stream/attempt values before awaits; retain this proof in the final write batch. */
export function imageRecoveryCancellationAssertion(
  job: Readonly<Pick<DocumentJobRow, "job_id" | "stream_id" | "attempt_count">>,
): OutputSqlAssertion {
  if (!Number.isSafeInteger(job.attempt_count) || job.attempt_count < 1 || job.attempt_count > 2) return { sql: "0", bindings: [] };
  const correlations = Array.from({ length: job.attempt_count }, (_, index) => `${job.job_id}:attempt:${index + 1}`);
  return {
    sql: `NOT EXISTS(SELECT 1 FROM events WHERE stream_id=? AND type IN('JobCanceled','JobForceFailed')
        AND (json_extract(payload,'$.job_id')=? OR correlation_id IN(${correlations.map(() => "?").join(",")})))`,
    bindings: [job.stream_id, job.job_id, ...correlations],
  };
}

/** A publication proof for the original paid result, never provider-execution authority. */
export async function readImageFinalizationProof<Input extends { inputDigest: string; contextHash: string }>(input: {
  env: WorkerEnv; user: PilotUser; job: DocumentJobRow; scope: OutputScope; slot: OutputOperationSlot;
  mediaVerifier: ImageFinalizationMediaVerifier;
  readProofBatch: FinalizationReadProofBatch;
  reconstructInput(stage: Readonly<ImageRecoveryStage>, anchors: readonly EventRow[]): Promise<Input>;
  authorityAssertions: readonly OutputSqlAssertion[];
  publicationAuthorityAssertions: readonly OutputSqlAssertion[];
}): Promise<ImageFinalizationProof<Input>> {
  const env = input.env, job = finalizationFreeze({ ...input.job }), scope = finalizationFreeze({ ...input.scope }), slot = finalizationFreeze({ ...input.slot });
  const actorUserId = input.user.userId, payerUserId = input.user.billingUserId ?? actorUserId;
  const projectExecution = input.user.projectExecution ? finalizationFreeze({ ...input.user.projectExecution }) : undefined;
  const mediaVerifier = input.mediaVerifier, reconstructInput = input.reconstructInput, readProofBatch = input.readProofBatch;
  const verifierIdentity = finalizationMediaVerifiers.get(mediaVerifier);
  const authority = finalizationAssertions(input.authorityAssertions), publicationAuthority = finalizationAssertions(input.publicationAuthorityAssertions);
  if (!authority.length || !publicationAuthority.length || verifierIdentity?.env !== env || verifierIdentity.ownerId !== scope.ownerUserId
    || typeof reconstructInput !== "function" || typeof readProofBatch !== "function"
    || !finalizationJson(job.request_json) || !finalizationJson(job.result_json)
    || job.kind !== "generate" || job.job_id !== slot.jobId || slot.scopeKey !== scope.key || job.owner_id !== actorUserId
    || scope.actorUserId !== actorUserId || job.document_id !== scope.documentId || job.stream_id !== `creative:${scope.ownerUserId}`
    || !Number.isSafeInteger(job.attempt_count) || job.attempt_count < 1 || job.attempt_count > 2
    || job.correlation_id !== `${job.job_id}:attempt:${job.attempt_count}` || !["committing", "failed"].includes(job.status)
    || !finalizationDate(job.expires_at) || Date.parse(job.expires_at) <= Date.now()
    || job.status === "committing" && (!finalizationDate(job.lease_expires_at) || Date.parse(job.lease_expires_at!) > Date.now())
    || job.status === "failed" && job.lease_expires_at !== null && (!finalizationDate(job.lease_expires_at) || Date.parse(job.lease_expires_at) > Date.now())) return fail("output_image_finalization_unavailable");
  const checkpoint = parse(job.result_json), pointer = readImageRecoveryPointer(checkpoint.imageRecovery);
  if (!pointer || pointer.stage !== "rendered" || !imageRecoveryHasNoExplicitStop(job, checkpoint)) return fail("output_image_finalization_unavailable");
  const noCancellation = imageRecoveryCancellationAssertion(job);
  const inputDigest = pointer.inputDigest;
  const correlations = Array.from({ length: job.attempt_count }, (_, index) => `${job.job_id}:attempt:${index + 1}`);
  const jobColumns = ["job_id", "owner_id", "stream_id", "document_id", "kind", "status", "source_surface", "correlation_id", "requested_sequence", "request_json", "result_json", "error_message", "attempt_count", "requested_at", "started_at", "completed_at", "lease_expires_at", "notified_at", "expires_at", "updated_at"] as const;
  const jobRow = Object.fromEntries(jobColumns.map(key => [key, job[key]])) as FinalizationSqlRow;
  const jobAssertions: OutputSqlAssertion[] = [...finalizationRows("document_jobs", "job_id=? AND owner_id=? AND stream_id=?", [job.job_id, actorUserId, job.stream_id], [jobRow]), {
    sql: `EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND length(CAST(request_json AS BLOB))<=${FINALIZATION_PROOF_BYTES} AND length(CAST(result_json AS BLOB))<=${FINALIZATION_PROOF_BYTES}
      AND (status='failed' AND (lease_expires_at IS NULL OR lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        OR status='committing' AND lease_expires_at IS NOT NULL AND lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')))
      AND ${noCancellation.sql}`,
    bindings: [job.job_id, ...(noCancellation.bindings ?? [])],
  }];
  const containment = privateContentScopeGuard(actorUserId, projectExecution);
  const initialAssertions = [...authority, ...jobAssertions];
  const initial = await readProofBatch(initialAssertions, [
    env.DB.prepare("SELECT * FROM output_operation_slots WHERE scope_key=? AND slot_id=? AND job_id=?").bind(scope.key, slot.slotId, job.job_id),
    env.DB.prepare("SELECT * FROM output_execution_grants WHERE scope_key=? AND grant_id=?").bind(scope.key, slot.grantId),
    env.DB.prepare("SELECT * FROM output_provider_calls WHERE scope_key=? AND slot_id=? ORDER BY call_key LIMIT 3").bind(scope.key, slot.slotId),
    env.DB.prepare(`SELECT content,expires_at FROM private_content WHERE content_id=? AND owner_id=? AND kind='provider-output'
      AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND length(CAST(content AS BLOB))<=${FINALIZATION_PROOF_BYTES} AND ${containment.sql}`)
      .bind(pointer.contentId, actorUserId, ...containment.bindings),
  ]);
  const [slotResult, grantResult, callResult, retainedResult] = initial.slice(-4);
  if (slotResult?.results.length !== 1 || grantResult?.results.length !== 1 || retainedResult?.results.length !== 1
    || callResult.results.length > 2) return fail("output_image_finalization_unavailable");
  const slotRow = slotResult.results[0] as FinalizationSqlRow, grantRow = grantResult.results[0] as FinalizationSqlRow;
  const calls = finalizationFreeze(callResult.results.map(row => ({ ...row })) as FinalizationSqlRow[]);
  const stored = retainedResult.results[0];
  if (slotRow.grant_id !== slot.grantId || slotRow.plan_revision_id !== slot.planRevisionId || slotRow.target_id !== slot.targetId
    || slotRow.source_digest !== slot.sourceDigest || slotRow.route_digest !== slot.routeDigest || slotRow.target_contract_digest !== slot.targetContractDigest
    || slotRow.token_reservation_id !== slot.tokenReservationId || slotRow.cost_reservation_id !== slot.costReservationId
    || slotRow.provider !== slot.provider || slotRow.model !== slot.model || slotRow.maximum_microusd !== slot.maximumMicrousd
    || slotRow.maximum_tokens !== slot.maximumTokens || slotRow.maximum_calls !== slot.maximumCalls || slotRow.status !== slot.status
    || slotRow.attempt_ordinal !== slot.attemptOrdinal || slotRow.previous_slot_id !== slot.previousSlotId
    || grantRow.actor_user_id !== actorUserId || grantRow.payer_user_id !== payerUserId || grantRow.context_id !== scope.contextId
    || grantRow.plan_revision_id !== slot.planRevisionId || !finalizationDate(grantRow.expires_at) || Date.parse(String(grantRow.expires_at)) <= Date.now()
    || (job.status === "committing" ? slotRow.status !== "running" || grantRow.status !== "active"
      : slotRow.status !== "failed" || !["active", "completed"].includes(String(grantRow.status)))) return fail("output_image_finalization_unavailable");
  if (!finalizationJson(stored.content) || !finalizationDate(stored.expires_at)) return fail("output_image_finalization_unavailable");
  const raw = stored.content, expiresAt = String(stored.expires_at);
  let envelope: unknown;
  try { envelope = JSON.parse(raw); } catch { return fail("output_image_finalization_identity_mismatch"); }
  const identity: ImageRecoveryIdentity = { jobId: job.job_id, actorUserId, scopeKey: scope.key, slotId: slot.slotId,
    grantId: slot.grantId, sourceDigest: slot.sourceDigest, routeDigest: slot.routeDigest, inputDigest };
  if (!record(envelope) || envelope.version !== 1 || JSON.stringify(envelope) !== raw || JSON.stringify(envelope.identity) !== JSON.stringify(identity)
    || await imageRecoveryDigest(envelope) !== pointer.contentSha256) return fail("output_image_finalization_identity_mismatch");
  const parsedStage = readImageRecoveryStage(envelope.stage);
  if (!parsedStage?.rendered || classifyImageRecoveryStage(parsedStage, checkpoint, calls as unknown as ImageRecoveryProviderCall[]) !== "rendered") return fail("output_image_finalization_unavailable");
  const stage = finalizationFreeze(parsedStage as ImageRecoveryStage & { rendered: NonNullable<ImageRecoveryStage["rendered"]> });
  const receipts = finalizationFreeze(providerSubmissions(checkpoint).map(receipt => ({ ...receipt })));
  const operationalAssertions: OutputSqlAssertion[] = [
    ...jobAssertions,
    ...finalizationRows("output_operation_slots", "scope_key=? AND slot_id=?", [scope.key, slot.slotId], [slotRow]),
    { sql: "(SELECT COUNT(*) FROM output_operation_slots WHERE job_id=?)=1", bindings: [job.job_id] },
    ...finalizationRows("output_execution_grants", "scope_key=? AND grant_id=?", [scope.key, slot.grantId], [grantRow]),
    { sql: "EXISTS(SELECT 1 FROM output_execution_grants WHERE scope_key=? AND grant_id=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))", bindings: [scope.key, slot.grantId] },
    ...finalizationRows("output_provider_calls", "scope_key=? AND slot_id=?", [scope.key, slot.slotId], calls),
    { sql: `EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind='provider-output' AND content=?
        AND expires_at=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND redacted_at IS NULL AND ${containment.sql})`,
      bindings: [pointer.contentId, actorUserId, raw, expiresAt, ...containment.bindings] },
  ];
  const absence: OutputSqlAssertion = {
    sql: `NOT EXISTS(SELECT 1 FROM events WHERE stream_id=? AND type IN('GenerationCompleted','GenerationUsageRecorded')
      AND (correlation_id IN(${correlations.map(() => "?").join(",")}) OR json_extract(payload,'$.generation_id')=?))
      AND NOT EXISTS(SELECT 1 FROM output_native_storage_writes WHERE scope_key=? AND slot_id=? AND publication_event_id IS NOT NULL)`,
    bindings: [job.stream_id, ...correlations, stage.generationId, scope.key, slot.slotId],
  };
  const specs = [
    { eventId: stage.requestedEventId, type: "GenerationRequested", projectId: null, documentId: scope.documentId },
    { eventId: stage.compiledEventId, type: "ContextCompiled", projectId: scope.projectId, documentId: scope.documentId },
    { eventId: stage.budgetEventId, type: "BudgetReserved", projectId: null, documentId: null },
  ];
  let storageKey: string;
  try { storageKey = decodeURIComponent(stage.rendered.media.url.slice("/api/media/".length)); } catch { return fail("output_image_finalization_media_unavailable"); }
  if (!mediaKeyMatchesOwnerNamespace(storageKey, scope.ownerUserId)) return fail("output_image_finalization_media_unavailable");
  const retainedChecks = [...authority, ...operationalAssertions, absence];
  const retained = await readProofBatch(retainedChecks, [
    ...specs.map(spec => env.DB.prepare(`SELECT event.*,body.private_json FROM events event JOIN event_private_payloads body ON body.private_event_id=event.event_id
      WHERE event.event_id=? AND event.stream_id=? AND event.type=? AND event.correlation_id IN(${correlations.map(() => "?").join(",")})
        AND body.owner_id=? AND body.project_id IS ? AND body.document_id IS ? AND body.redacted_at IS NULL
        AND length(CAST(event.payload AS BLOB))<=${FINALIZATION_PROOF_BYTES} AND length(CAST(body.private_json AS BLOB))<=${FINALIZATION_PROOF_BYTES}`)
      .bind(spec.eventId, job.stream_id, spec.type, ...correlations, scope.ownerUserId, spec.projectId, spec.documentId)),
    env.DB.prepare("SELECT * FROM output_native_storage_writes WHERE scope_key=? AND slot_id=? AND storage_key=? AND content_sha256=? AND status='written' AND write_acknowledged=1 AND publication_event_id IS NULL")
      .bind(scope.key, slot.slotId, storageKey, stage.rendered.media.contentHash),
  ]);
  const anchorResults = retained.slice(-4, -1), storageResult = retained.at(-1)!;
  if (anchorResults.some(result => result.results.length !== 1) || storageResult.results.length !== 1) return fail("output_image_finalization_anchor_unavailable");
  const anchorAssertions: OutputSqlAssertion[] = [];
  const anchors = finalizationFreeze(anchorResults.map((result, index) => {
    const row = result.results[0], spec = specs[index]!;
    if (!finalizationJson(row.private_json) || !finalizationJson(row.payload)) return fail("output_image_finalization_anchor_unavailable");
    let event: EventRow;
    try { event = serializeEvent(row); } catch { return fail("output_image_finalization_anchor_unavailable"); }
    if (!record(event.payload)) return fail("output_image_finalization_anchor_unavailable");
    anchorAssertions.push({ sql: `EXISTS(SELECT 1 FROM events event JOIN event_private_payloads body ON body.private_event_id=event.event_id
      WHERE event.event_id=? AND event.stream_id=? AND event.sequence=? AND event.occurred_at=? AND event.recorded_at=?
        AND event.actor=? AND event.client_id=? AND event.correlation_id=? AND event.causation_id IS ? AND event.compensates_event_id IS ?
        AND event.schema_version=? AND event.type=? AND event.payload=? AND body.owner_id=? AND body.project_id IS ? AND body.document_id IS ?
        AND body.private_json=? AND body.redacted_at IS NULL)`, bindings: [String(row.event_id), String(row.stream_id), Number(row.sequence), String(row.occurred_at), String(row.recorded_at),
      String(row.actor), String(row.client_id), String(row.correlation_id), row.causation_id as string | null, row.compensates_event_id as string | null, Number(row.schema_version), String(row.type), String(row.payload),
      scope.ownerUserId, spec.projectId, spec.documentId, row.private_json] });
    return event;
  }));
  const [requested, compiled, budget] = anchors;
  if (anchors.some(event => event.payload.generation_id !== stage.generationId)
    || requested.payload.document_id !== scope.documentId || compiled.payload.document_id !== scope.documentId
    || requested.actor !== (scope.kind === "project" ? `user:${actorUserId}` : "user") || compiled.causationId !== requested.eventId || budget.causationId !== requested.eventId
    || compiled.correlationId !== requested.correlationId || budget.correlationId !== requested.correlationId
    || budget.payload.reservation_id !== slot.tokenReservationId
    || budget.payload.cost_reservation_id !== slot.costReservationId) return fail("output_image_finalization_anchor_unavailable");
  const storage = finalizationFreeze({ ...storageResult.results[0] }) as FinalizationSqlRow;
  const storageAssertions = finalizationRows("output_native_storage_writes", "scope_key=? AND slot_id=? AND storage_key=?", [scope.key, slot.slotId, storageKey], [storage]);
  const stableAssertions = finalizationAssertions([...operationalAssertions, ...anchorAssertions]);
  const assertions = finalizationAssertions([...authority, ...stableAssertions, absence, ...storageAssertions]);
  let reconstructed: Input;
  try { reconstructed = JSON.parse(JSON.stringify(await reconstructInput(stage, anchors))) as Input; }
  catch { return fail("output_image_finalization_identity_mismatch"); }
  if (!record(reconstructed) || !sha256(reconstructed.inputDigest) || reconstructed.inputDigest !== inputDigest
    || !sha256(reconstructed.contextHash) || compiled.payload.context_hash !== reconstructed.contextHash) return fail("output_image_finalization_identity_mismatch");
  const media = await mediaVerifier.read(stage.rendered.media.url);
  if (!media || media.contentHash !== stage.rendered.media.contentHash || media.mimeType !== stage.rendered.media.mimeType
    || media.provider !== stage.rendered.image.provider || media.providerModel !== stage.rendered.image.model
    || media.providerRequestId !== (stage.rendered.image.providerRequestId ?? null)) return fail("output_image_finalization_media_unavailable");
  await readProofBatch(assertions);
  return finalizationFreeze({ stage, anchors, input: finalizationFreeze(reconstructed), expiresAt, receipts, payerUserId, assertions, settlementAssertions: assertions,
    readFinancialProof: () => readImageFinalizationFinancialProof({ env, job, scope, slot, payerUserId, stage, anchors, expiresAt, receipts,
      assertions, lateAssertions: finalizationAssertions([...publicationAuthority, ...stableAssertions, ...storageAssertions]), storageKey, containment, readProofBatch }),
  });
}

async function readImageFinalizationFinancialProof(input: {
  env: WorkerEnv; job: Readonly<DocumentJobRow>; scope: Readonly<OutputScope>; slot: Readonly<OutputOperationSlot>;
  payerUserId: string; stage: ImageFinalizationProof["stage"]; anchors: readonly EventRow[]; expiresAt: string;
  receipts: readonly PaidProviderSubmission[]; assertions: readonly OutputSqlAssertion[]; lateAssertions: readonly OutputSqlAssertion[];
  storageKey: string; containment: ReturnType<typeof privateContentScopeGuard>;
  readProofBatch: FinalizationReadProofBatch;
}): Promise<ImageFinalizationFinancialProof> {
  const { env, job, scope, slot, payerUserId, stage, anchors, expiresAt, receipts, assertions, lateAssertions, storageKey, containment, readProofBatch } = input;
  const checkpoint = parse(job.result_json), admittedBudget = anchors[2]!.payload;
  const totals: ImageFinalizationTotals = { usedTokens: 0, usedMicrousd: 0, inputTokens: 0, outputTokens: 0,
    plannerTokens: 0, plannerInputTokens: 0, plannerOutputTokens: 0, imageTokens: 0, imageInputTokens: 0, imageOutputTokens: 0,
    plannerMicrousd: 0, imageMicrousd: 0 };
  for (const receipt of receipts) {
    if (receipt.status !== "completed" || !["planning", "image"].includes(receipt.operation)
      || ![receipt.totalTokens, receipt.inputTokens, receipt.outputTokens, receipt.costMicrousd].every(count)
      || receipt.totalTokens !== Number(receipt.inputTokens) + Number(receipt.outputTokens)) return fail("output_image_finalization_finances_unavailable");
    totals.usedTokens += Number(receipt.totalTokens); totals.usedMicrousd += Number(receipt.costMicrousd);
    totals.inputTokens += Number(receipt.inputTokens); totals.outputTokens += Number(receipt.outputTokens);
    if (receipt.operation === "planning") {
      totals.plannerTokens += Number(receipt.totalTokens); totals.plannerInputTokens += Number(receipt.inputTokens);
      totals.plannerOutputTokens += Number(receipt.outputTokens); totals.plannerMicrousd += Number(receipt.costMicrousd);
    } else {
      totals.imageTokens += Number(receipt.totalTokens); totals.imageInputTokens += Number(receipt.inputTokens);
      totals.imageOutputTokens += Number(receipt.outputTokens); totals.imageMicrousd += Number(receipt.costMicrousd);
    }
  }
  if (!Object.values(totals).every(count) || totals.usedTokens > slot.maximumTokens || totals.usedMicrousd > slot.maximumMicrousd
    || receipts.length > slot.maximumCalls) return fail("output_image_finalization_finances_unavailable");
  const financialReads = await readProofBatch(assertions, [
    env.DB.prepare("SELECT * FROM budget_reservations WHERE reservation_id=? AND owner_id=?").bind(slot.tokenReservationId, payerUserId),
    env.DB.prepare("SELECT * FROM cost_budget_reservations WHERE reservation_id=? AND owner_id=?").bind(slot.costReservationId, payerUserId),
    env.DB.prepare("SELECT * FROM project_budget_reservation_scopes WHERE reservation_kind='tokens' AND reservation_id=?").bind(slot.tokenReservationId),
    env.DB.prepare("SELECT * FROM project_budget_reservation_scopes WHERE reservation_kind='usd' AND reservation_id=?").bind(slot.costReservationId),
    env.DB.prepare("SELECT * FROM pilot_cost_reservation_scopes WHERE reservation_id=?").bind(slot.costReservationId),
  ]);
  const [tokenResult, costResult, tokenScopeResult, costScopeResult, fixedResult] = financialReads.slice(-5);
  if (tokenResult.results.length !== 1 || costResult.results.length !== 1 || tokenScopeResult.results.length > 1
    || costScopeResult.results.length > 1 || fixedResult.results.length > 1) return fail("output_image_finalization_finances_unavailable");
  const token = finalizationFreeze({ ...tokenResult.results[0] }) as FinalizationSqlRow, cost = finalizationFreeze({ ...costResult.results[0] }) as FinalizationSqlRow;
  const tokenScopes = finalizationFreeze(tokenScopeResult.results.map(row => ({ ...row }))) as FinalizationSqlRow[], costScopes = finalizationFreeze(costScopeResult.results.map(row => ({ ...row }))) as FinalizationSqlRow[];
  const fixedScopes = finalizationFreeze(fixedResult.results.map(row => ({ ...row }))) as FinalizationSqlRow[];
  const tokenScope = tokenScopes[0], costScope = costScopes[0], fixed = fixedScopes[0];
  const active = token.status === "active" && ["active", "executing"].includes(String(cost.status));
  const settled = token.status === (totals.usedTokens > 0 ? "settled" : "released") && cost.status === (totals.usedMicrousd > 0 ? "settled" : "released");
  if (token.stream_id !== job.stream_id || cost.stream_id !== job.stream_id || token.correlation_id !== job.correlation_id || cost.correlation_id !== job.correlation_id
    || token.operation !== "image-generation" || cost.operation !== token.operation || !text(token.period) || cost.period !== token.period
    || checkpoint.reservationId !== slot.tokenReservationId || checkpoint.costReservationId !== slot.costReservationId
    || checkpoint.costReservationPeriod !== token.period || checkpoint.costReservationMicrousd !== slot.maximumMicrousd
    || admittedBudget.operation !== "image-generation" || admittedBudget.period !== token.period
    || admittedBudget.reserved_tokens !== slot.maximumTokens || admittedBudget.reserved_microusd !== slot.maximumMicrousd
    || ![token.reserved_tokens, token.used_tokens, cost.reserved_microusd, cost.used_microusd].every(count)
    || totals.usedTokens > Number(token.reserved_tokens) || totals.usedMicrousd > Number(cost.reserved_microusd)
    || token.reserved_tokens !== slot.maximumTokens || cost.reserved_microusd !== slot.maximumMicrousd
    || !active && !settled || active && (token.used_tokens !== 0 || cost.used_microusd !== 0 || token.settled_at !== null || cost.settled_at !== null)
    || settled && (token.used_tokens !== totals.usedTokens || cost.used_microusd !== totals.usedMicrousd || !finalizationDate(token.settled_at) || !finalizationDate(cost.settled_at)))
    return fail("output_image_finalization_finances_unavailable");
  if (scope.kind === "project" ? !tokenScope || !costScope || tokenScope.organization_id !== scope.organizationId
      || tokenScope.project_access_id !== scope.projectAccessId || tokenScope.actor_user_id !== payerUserId
      || tokenScope.workspace_scope_id !== scope.organizationId || cost.workspace_id !== scope.organizationId
      || ["organization_id", "project_access_id", "actor_user_id", "workspace_scope_id"].some(key => tokenScope[key] !== costScope[key])
    : tokenScopes.length !== 0 || costScopes.length !== 0 || cost.workspace_id !== "forma") return fail("output_image_finalization_finances_unavailable");
  if (fixed && (!costScope || !text(fixed.cohort_id) || fixed.organization_id !== scope.organizationId || fixed.actor_user_id !== payerUserId))
    return fail("output_image_finalization_finances_unavailable");
  const reservationAssertions = finalizationAssertions([
    ...finalizationRows("budget_reservations", "reservation_id=? AND owner_id=?", [slot.tokenReservationId, payerUserId], [token]),
    ...finalizationRows("cost_budget_reservations", "reservation_id=? AND owner_id=?", [slot.costReservationId, payerUserId], [cost]),
    ...finalizationRows("project_budget_reservation_scopes", "reservation_kind='tokens' AND reservation_id=?", [slot.tokenReservationId], tokenScopes),
    ...finalizationRows("project_budget_reservation_scopes", "reservation_kind='usd' AND reservation_id=?", [slot.costReservationId], costScopes),
    ...finalizationRows("pilot_cost_reservation_scopes", "reservation_id=?", [slot.costReservationId], fixedScopes),
    { sql: "(SELECT COUNT(*) FROM output_operation_slots WHERE token_reservation_id=? OR cost_reservation_id=?)=1", bindings: [slot.tokenReservationId, slot.costReservationId] },
  ]);
  const tokenCounterKeys = [["user", payerUserId, token.period], ["workspace", "forma", token.period],
    ...(tokenScope ? [["workspace", String(tokenScope.organization_id), token.period]] : [])];
  const costCounterKeys = [["user", payerUserId, cost.period], ["workspace", String(cost.workspace_id), cost.period],
    ...(cost.workspace_id !== "forma" ? [["workspace", "forma", cost.period]] : []),
    ...(fixed ? [["pilot_org", String(fixed.cohort_id), `pilot:${fixed.cohort_id}`], ["pilot_user", payerUserId, `pilot:${fixed.cohort_id}`]] : [])];
  const counterWhere = (keys: typeof tokenCounterKeys) => keys.map(() => "(scope=? AND scope_id=? AND period=?)").join(" OR ");
  const counterReads = await readProofBatch([...assertions, ...reservationAssertions], [
    env.DB.prepare(`SELECT * FROM budget_counters WHERE ${counterWhere(tokenCounterKeys)} ORDER BY scope,scope_id,period`).bind(...tokenCounterKeys.flat()),
    env.DB.prepare(`SELECT * FROM cost_budget_counters WHERE ${counterWhere(costCounterKeys)} ORDER BY scope,scope_id,period`).bind(...costCounterKeys.flat()),
  ]);
  const tokenCounters = finalizationFreeze(counterReads.at(-2)!.results.map(row => ({ ...row }))) as FinalizationSqlRow[], costCounters = finalizationFreeze(counterReads.at(-1)!.results.map(row => ({ ...row }))) as FinalizationSqlRow[];
  if (tokenCounters.length !== tokenCounterKeys.length || costCounters.length !== costCounterKeys.length
    || tokenCounters.some(row => !count(row.used_tokens) || !count(row.reserved_tokens)
      || active && (Number(row.reserved_tokens) < Number(token.reserved_tokens) || Number(row.used_tokens) > Number.MAX_SAFE_INTEGER - totals.usedTokens)
      || settled && Number(row.used_tokens) < totals.usedTokens)
    || costCounters.some(row => !count(row.used_microusd) || !count(row.reserved_microusd)
      || active && (Number(row.reserved_microusd) < Number(cost.reserved_microusd) || Number(row.used_microusd) > Number.MAX_SAFE_INTEGER - totals.usedMicrousd)
      || settled && Number(row.used_microusd) < totals.usedMicrousd))
    return fail("output_image_finalization_finances_unavailable");
  const financialAssertions = finalizationAssertions([...reservationAssertions,
    ...finalizationRows("budget_counters", counterWhere(tokenCounterKeys), tokenCounterKeys.flat(), tokenCounters),
    ...finalizationRows("cost_budget_counters", counterWhere(costCounterKeys), costCounterKeys.flat(), costCounters),
  ]);
  const receipt = { reservation_id: slot.costReservationId, reserved_microusd: Number(cost.reserved_microusd), used_microusd: totals.usedMicrousd, status: String(cost.status) };
  return finalizationFreeze({ needsSettlement: active, totals, receipt, receipts, assertions: financialAssertions,
    generationReceipt: { provider: stage.rendered.image.provider, model: stage.rendered.image.model, provider_request_status: "completed" as const,
      source_transmission_status: "transmitted" as const, settled_cost_microusd: totals.usedMicrousd, reservation_status: String(cost.status), actual_provider_call_count: receipts.length },
    publicationStatements(events: EventRow[]) {
      if (!events.length) return [];
      if (active || !settled) return fail("output_image_finalization_settlement_required");
      if (events.length !== 2) return fail("output_image_finalization_publication_invalid");
      const [complete, usageEvent] = events;
      if (!complete || !usageEvent || complete.type !== "GenerationCompleted" || usageEvent.type !== "GenerationUsageRecorded"
        || complete.eventId === usageEvent.eventId || !record(complete.payload) || !record(usageEvent.payload)
        || complete.streamId !== job.stream_id || usageEvent.streamId !== job.stream_id
        || complete.correlationId !== job.correlation_id || usageEvent.correlationId !== job.correlation_id
        || complete.actor !== "worker:generator" || usageEvent.actor !== "worker:policy"
        || complete.clientId !== "server:document-job:generate" || usageEvent.clientId !== complete.clientId
        || complete.causationId !== stage.compiledEventId || usageEvent.causationId !== complete.eventId
        || usageEvent.sequence !== complete.sequence + 1 || !Number.isSafeInteger(complete.sequence) || complete.sequence <= 0
        || complete.payload.generation_id !== stage.generationId || usageEvent.payload.generation_id !== stage.generationId
        || complete.payload.document_id !== scope.documentId || usageEvent.payload.document_id !== scope.documentId
        || complete.payload.media_url !== stage.rendered.media.url || complete.payload.media_type !== stage.rendered.media.mimeType
        || complete.payload.source_content_hash !== stage.rendered.media.contentHash || complete.payload.model_id !== stage.rendered.image.model
        || complete.payload.planner_model_id !== stage.planned.model || complete.payload.provider !== stage.rendered.image.provider
        || complete.payload.provider_request_id !== stage.rendered.image.providerRequestId || complete.payload.provider_submission_id !== stage.rendered.image.providerSubmissionId
        || complete.payload.planner_response_id !== stage.planned.responseId || complete.payload.context_hash !== anchors[1]!.payload.context_hash
        || usageEvent.payload.reservation_id !== slot.tokenReservationId || usageEvent.payload.cost_reservation_id !== slot.costReservationId
        || usageEvent.payload.operation !== "image-generation" || usageEvent.payload.total_tokens !== totals.usedTokens
        || usageEvent.payload.input_tokens !== totals.inputTokens || usageEvent.payload.output_tokens !== totals.outputTokens
        || usageEvent.payload.cost_microusd !== totals.usedMicrousd || usageEvent.payload.reserved_tokens !== token.reserved_tokens
        || usageEvent.payload.reserved_microusd !== cost.reserved_microusd
        || !text(complete.payload.output_ref) || !text(complete.payload.prompt_ref) || complete.payload.output_ref === complete.payload.prompt_ref
        || !finalizationDate(complete.payload.content_expires_at) || Date.parse(complete.payload.content_expires_at) > Date.parse(expiresAt))
        return fail("output_image_finalization_publication_invalid");
      const persisted = (event: EventRow): OutputSqlAssertion => {
        const values = eventWriteBindings(event);
        if (values[16] === null) return fail("output_image_finalization_publication_invalid");
        return { sql: `EXISTS(SELECT 1 FROM events stored JOIN event_private_payloads body ON body.private_event_id=stored.event_id
          WHERE stored.event_id=? AND stored.stream_id=? AND stored.sequence=? AND stored.occurred_at=? AND stored.recorded_at=?
            AND stored.actor=? AND stored.client_id=? AND stored.correlation_id=? AND stored.causation_id IS ?
            AND stored.compensates_event_id IS ? AND stored.schema_version=? AND stored.type=? AND stored.payload=?
            AND body.owner_id=? AND body.project_id IS ? AND body.document_id IS ? AND body.private_json=? AND body.redacted_at IS NULL)`, bindings: values };
      };
      const correlations = Array.from({ length: job.attempt_count }, (_, index) => `${job.job_id}:attempt:${index + 1}`);
      const publicationProof: OutputSqlAssertion[] = [...lateAssertions, ...financialAssertions, persisted(complete), persisted(usageEvent), {
        sql: `(SELECT COUNT(*) FROM events WHERE stream_id=? AND type IN('GenerationCompleted','GenerationUsageRecorded')
          AND (correlation_id IN(${correlations.map(() => "?").join(",")}) OR json_extract(payload,'$.generation_id')=?))=2
          AND NOT EXISTS(SELECT 1 FROM output_native_storage_writes WHERE scope_key=? AND slot_id=? AND publication_event_id IS NOT NULL)`,
        bindings: [job.stream_id, ...correlations, stage.generationId, scope.key, slot.slotId],
      }, ...[
        { contentId: complete.payload.output_ref, kind: "provider-output", content: stage.planned.raw, exactExpiry: complete.payload.content_expires_at },
        { contentId: complete.payload.prompt_ref, kind: "prompt", content: stage.rendered.image.prompt, exactExpiry: null },
      ].map(saved => ({ sql: `EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind=? AND content=?
          AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND expires_at<=?
          AND (? IS NULL OR expires_at=?) AND ${containment.sql})`,
        bindings: [saved.contentId, job.owner_id, saved.kind, saved.content, expiresAt, saved.exactExpiry, saved.exactExpiry, ...containment.bindings] })), {
        sql: "EXISTS(SELECT 1 FROM output_native_storage_writes WHERE scope_key=? AND slot_id=? AND storage_key=? AND content_sha256=? AND status='written' AND write_acknowledged=1 AND publication_event_id IS NULL)",
        bindings: [scope.key, slot.slotId, storageKey, stage.rendered.media.contentHash],
      }];
      // R2 was verified at read time. This batch proves its exact retained D1
      // receipt and publication envelope, not atomic custody of the R2 object.
      return [...publicationProof.flatMap(assertion => outputAssertionStatements(env, assertion)),
        env.DB.prepare("UPDATE output_native_storage_writes SET publication_event_id=?,updated_at=? WHERE scope_key=? AND slot_id=? AND storage_key=? AND content_sha256=? AND status='written' AND write_acknowledged=1 AND publication_event_id IS NULL")
          .bind(complete.eventId, complete.recordedAt, scope.key, slot.slotId, storageKey, stage.rendered.media.contentHash),
        ...outputAssertionStatements(env, { sql: "changes()=1" }),
        ...outputAssertionStatements(env, { sql: "EXISTS(SELECT 1 FROM output_native_storage_writes WHERE scope_key=? AND slot_id=? AND storage_key=? AND content_sha256=? AND status='written' AND write_acknowledged=1 AND publication_event_id=?)",
          bindings: [scope.key, slot.slotId, storageKey, stage.rendered.media.contentHash, complete.eventId] }),
      ];
    },
  });
}

/** A completed private/public publication is evidence, never permission to dispatch.
 * This reader returns only a captured job projection and commit-time assertions. */
export async function readPublishedImageAcknowledgment(options: {
  env: WorkerEnv; user: PilotUser; job: DocumentJobRow; scope: OutputScope; slot: OutputOperationSlot;
  assertions: readonly OutputSqlAssertion[];
  readProof: (assertions: readonly OutputSqlAssertion[], statements?: readonly D1PreparedStatement[]) => Promise<Array<D1Result<Record<string, unknown>>>>;
}): Promise<{ assertions: OutputSqlAssertion[]; result: Record<string, unknown>; completedAt: string }> {
  const { env, user, scope, slot } = options, job = { ...options.job };
  const unavailable = (): never => fail("output_image_acknowledgment_unavailable");
  const authority = options.assertions.map(assertion => ({ ...assertion, bindings: [...(assertion.bindings ?? [])] }));
  if (job.kind !== "generate" || job.job_id !== slot.jobId || job.output_slot_id !== slot.slotId
    || job.owner_id !== user.userId || scope.actorUserId !== user.userId || slot.scopeKey !== scope.key
    || job.stream_id !== `creative:${scope.ownerUserId}` || job.document_id !== scope.documentId
    || !["committing", "failed", "completed"].includes(job.status) || !["running", "failed", "succeeded"].includes(slot.status)
    || !count(job.attempt_count) || job.attempt_count < 1 || job.attempt_count > 2
    || job.correlation_id !== `${job.job_id}:attempt:${job.attempt_count}`
    || !Number.isFinite(Date.parse(job.expires_at)) || Date.parse(job.expires_at) <= Date.now()
    || job.status === "committing" && (!job.lease_expires_at || !Number.isFinite(Date.parse(job.lease_expires_at)) || Date.parse(job.lease_expires_at) > Date.now())) return unavailable();
  const jobKeys = ["job_id", "owner_id", "stream_id", "document_id", "kind", "status", "source_surface", "correlation_id", "requested_sequence", "request_json", "result_json", "error_message", "attempt_count", "requested_at", "started_at", "completed_at", "lease_expires_at", "notified_at", "expires_at", "updated_at"] as const;
  const currentJob: OutputSqlAssertion = { sql: `EXISTS(SELECT 1 FROM document_jobs WHERE ${jobKeys.map(key => `${key} IS ?`).join(" AND ")} AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND (status<>'committing' OR lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')))`, bindings: jobKeys.map(key => job[key]) };
  // Reuse the existing private-proof string ceiling; reject, never truncate.
  const retainedBytes = 2_000_000;
  if ((job.result_json?.length ?? 0) > retainedBytes || new TextEncoder().encode(job.result_json ?? "{}").byteLength > retainedBytes) return unavailable();
  const checkpoint = parse(job.result_json), pointer = readImageRecoveryPointer(checkpoint.imageRecovery);
  if (!pointer || pointer.stage !== "rendered" || !record(checkpoint.generationReceipt)) return unavailable();
  const containment = privateContentScopeGuard(user.userId, user.projectExecution);
  const initial = await options.readProof([...authority, currentJob], [
    env.DB.prepare(`SELECT content FROM private_content WHERE length(CAST(content AS BLOB))<=2000000 AND content_id=? AND owner_id=? AND kind='provider-output' AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${containment.sql}`).bind(pointer.contentId, user.userId, ...containment.bindings),
    env.DB.prepare("SELECT * FROM output_provider_calls WHERE scope_key=? AND slot_id=? ORDER BY call_key LIMIT 3").bind(scope.key, slot.slotId),
    env.DB.prepare("SELECT * FROM output_operation_slots WHERE scope_key=? AND slot_id=? AND job_id=?").bind(scope.key, slot.slotId, job.job_id)]);
  const raw = initial.at(-3)?.results[0]?.content, callRows = initial.at(-2)?.results as Record<string, unknown>[], slotRow = initial.at(-1)?.results[0] as Record<string, unknown> | undefined;
  if (typeof raw !== "string" || !slotRow || !Array.isArray(callRows)) return unavailable();
  let envelope: unknown; try { envelope = JSON.parse(raw); } catch { return unavailable(); }
  const identity: ImageRecoveryIdentity = { jobId: job.job_id, actorUserId: user.userId, scopeKey: scope.key, slotId: slot.slotId, grantId: slot.grantId, sourceDigest: slot.sourceDigest, routeDigest: slot.routeDigest, inputDigest: pointer.inputDigest };
  if (!record(envelope) || envelope.version !== 1 || JSON.stringify(envelope) !== raw || await imageRecoveryDigest(envelope) !== pointer.contentSha256
    || JSON.stringify(envelope.identity) !== JSON.stringify(identity)) return unavailable();
  const stage = readImageRecoveryStage(envelope.stage), calls = callRows as unknown as ImageRecoveryProviderCall[];
  if (!stage?.rendered || classifyImageRecoveryStage(stage, checkpoint, calls) !== "rendered") return unavailable();
  const { image, media } = stage.rendered;
  let storageKey: string; try { storageKey = decodeURIComponent(media.url.slice("/api/media/".length)); } catch { return unavailable(); }
  if (media.url !== `/api/media/${encodeURIComponent(storageKey)}`) return unavailable();
  const columns = {
    output_operation_slots: ["scope_key", "slot_id", "grant_id", "plan_revision_id", "target_id", "target_contract_digest", "source_digest", "provider", "model", "route_digest", "job_id", "cost_reservation_id", "token_reservation_id", "maximum_microusd", "maximum_calls", "maximum_tokens", "attempt_ordinal", "previous_slot_id", "status", "outcome_event_id", "created_at", "updated_at"],
    output_provider_calls: ["scope_key", "slot_id", "call_key", "client_request_id", "request_digest", "stage_key", "provider", "model", "reserved_microusd", "used_microusd", "status", "provider_response_id", "created_at", "settled_at"],
    output_native_storage_writes: ["scope_key", "slot_id", "storage_key", "content_sha256", "status", "write_acknowledged", "publication_event_id", "created_at", "updated_at"],
    project_budget_reservation_scopes: ["reservation_kind", "reservation_id", "organization_id", "project_access_id", "actor_user_id", "workspace_scope_id", "created_at"],
    pilot_cost_reservation_scopes: ["reservation_id", "cohort_id", "organization_id", "actor_user_id", "created_at"],
    budget_reservations: ["reservation_id", "owner_id", "stream_id", "correlation_id", "operation", "period", "reserved_tokens", "used_tokens", "status", "settlement_reason", "created_at", "settled_at", "updated_at"],
    cost_budget_reservations: ["reservation_id", "owner_id", "workspace_id", "stream_id", "correlation_id", "operation", "period", "reserved_microusd", "used_microusd", "status", "allow_user_overage", "created_at", "settled_at", "updated_at"],
  } as const;
  const pinnedRow = (table: keyof typeof columns, row: Record<string, unknown>): OutputSqlAssertion => {
    if (columns[table].some(key => !Object.hasOwn(row, key))) return unavailable();
    const bindings = columns[table].map(key => {
      const value = row[key];
      if (value === null || typeof value === "string" || typeof value === "number" && Number.isFinite(value)) return value;
      return unavailable();
    });
    return { sql: `EXISTS(SELECT 1 FROM ${table} WHERE ${columns[table].map(key => `${key} IS ?`).join(" AND ")})`, bindings };
  };
  if (slotRow.status !== slot.status || slotRow.grant_id !== slot.grantId || slotRow.plan_revision_id !== slot.planRevisionId
    || slotRow.target_id !== slot.targetId || slotRow.target_contract_digest !== slot.targetContractDigest || slotRow.source_digest !== slot.sourceDigest
    || slotRow.route_digest !== slot.routeDigest || slotRow.token_reservation_id !== slot.tokenReservationId || slotRow.cost_reservation_id !== slot.costReservationId) return unavailable();
  const retained: OutputSqlAssertion = { sql: `EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind='provider-output' AND content=? AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${containment.sql})`, bindings: [pointer.contentId, user.userId, raw, ...containment.bindings] };
  const callSet: OutputSqlAssertion = { sql: "(SELECT COUNT(*) FROM output_provider_calls WHERE scope_key=? AND slot_id=?)=?", bindings: [scope.key, slot.slotId, calls.length] };
  const proofs = [...authority, currentJob, retained, pinnedRow("output_operation_slots", slotRow), callSet, ...callRows.map(row => pinnedRow("output_provider_calls", row))];
  const eventQuery = "SELECT event.*,body.private_json,body.owner_id AS private_owner,body.project_id AS private_project,body.document_id AS private_document,body.redacted_at AS private_redacted FROM events event LEFT JOIN event_private_payloads body ON body.private_event_id=event.event_id WHERE event.stream_id=? AND (event.event_id IN(?,?,?) OR (event.type IN('GenerationCompleted','GenerationUsageRecorded','GenerationFailed') AND json_extract(event.payload,'$.generation_id')=?)) AND length(CAST(event.payload AS BLOB))<=2000000 AND length(CAST(body.private_json AS BLOB))<=2000000 ORDER BY event.sequence LIMIT 6";
  const eventBindings = [job.stream_id, stage.requestedEventId, stage.compiledEventId, stage.budgetEventId, stage.generationId];
  const paidOwner = user.billingUserId ?? user.userId;
  const rows = await options.readProof(proofs, [env.DB.prepare(eventQuery).bind(...eventBindings),
    env.DB.prepare("SELECT * FROM output_native_storage_writes WHERE scope_key=? AND slot_id=? AND storage_key=?").bind(scope.key, slot.slotId, storageKey),
    env.DB.prepare("SELECT * FROM budget_reservations WHERE reservation_id=? AND owner_id=?").bind(slot.tokenReservationId, paidOwner),
    env.DB.prepare("SELECT * FROM cost_budget_reservations WHERE reservation_id=? AND owner_id=?").bind(slot.costReservationId, paidOwner),
    env.DB.prepare("SELECT * FROM project_budget_reservation_scopes WHERE reservation_kind='tokens' AND reservation_id=?").bind(slot.tokenReservationId),
    env.DB.prepare("SELECT * FROM project_budget_reservation_scopes WHERE reservation_kind='usd' AND reservation_id=?").bind(slot.costReservationId),
    env.DB.prepare("SELECT * FROM pilot_cost_reservation_scopes WHERE reservation_id=?").bind(slot.costReservationId)]);
  const eventRows = rows.at(-7)?.results as Record<string, unknown>[], storage = rows.at(-6)?.results[0] as Record<string, unknown> | undefined;
  const token = rows.at(-5)?.results[0] as Record<string, unknown> | undefined, cost = rows.at(-4)?.results[0] as Record<string, unknown> | undefined;
  const tokenScope = rows.at(-3)?.results[0] as Record<string, unknown> | undefined, costScope = rows.at(-2)?.results[0] as Record<string, unknown> | undefined;
  const pilotScope = rows.at(-1)?.results[0] as Record<string, unknown> | undefined;
  if (!Array.isArray(eventRows) || eventRows.length !== 5 || !storage || !token || !cost) return unavailable();
  // The original billing reservation scopes remain evidence; acknowledgment never settles or reattributes them.
  if (Boolean(tokenScope) !== Boolean(costScope)
    || tokenScope && (!costScope || ["organization_id", "project_access_id", "actor_user_id", "workspace_scope_id"].some(key => tokenScope[key] !== costScope[key])
      || tokenScope.actor_user_id !== paidOwner || tokenScope.organization_id !== cost.workspace_id || tokenScope.workspace_scope_id !== cost.workspace_id)
    || !costScope && cost.workspace_id !== "forma"
    || scope.kind === "project" && (!tokenScope || tokenScope.organization_id !== scope.organizationId || tokenScope.project_access_id !== scope.projectAccessId)
    || scope.kind === "personal" && Boolean(tokenScope)
    || pilotScope && (!costScope || !text(pilotScope.cohort_id) || pilotScope.actor_user_id !== paidOwner || pilotScope.organization_id !== cost.workspace_id)) return unavailable();
  for (const [row, kind, id] of [[tokenScope, "tokens", slot.tokenReservationId], [costScope, "usd", slot.costReservationId]] as const) {
    proofs.push(row ? pinnedRow("project_budget_reservation_scopes", row) : {
      sql: "NOT EXISTS(SELECT 1 FROM project_budget_reservation_scopes WHERE reservation_kind=? AND reservation_id=?)", bindings: [kind, id],
    });
  }
  proofs.push(pilotScope ? pinnedRow("pilot_cost_reservation_scopes", pilotScope) : {
    sql: "NOT EXISTS(SELECT 1 FROM pilot_cost_reservation_scopes WHERE reservation_id=?)", bindings: [slot.costReservationId],
  });
  const events = eventRows.map(row => {
    if (typeof row.private_json !== "string" || row.private_redacted !== null) return unavailable();
    let event: EventRow; try { event = serializeEvent(row); } catch { return unavailable(); }
    const values = eventWriteBindings(event);
    if (!record(event.payload) || row.private_owner !== values[13] || row.private_project !== values[14]
      || row.private_document !== values[15] || row.private_json !== values[16] || row.payload !== values[12]) return unavailable();
    proofs.push({ sql: "EXISTS(SELECT 1 FROM events event JOIN event_private_payloads body ON body.private_event_id=event.event_id WHERE event.event_id=? AND event.stream_id=? AND event.sequence=? AND event.occurred_at=? AND event.recorded_at=? AND event.actor=? AND event.client_id=? AND event.correlation_id=? AND event.causation_id IS ? AND event.compensates_event_id IS ? AND event.schema_version=? AND event.type=? AND event.payload=? AND body.owner_id=? AND body.project_id IS ? AND body.document_id IS ? AND body.private_json=? AND body.redacted_at IS NULL)", bindings: values });
    return event;
  });
  const one = (type: string) => { const found = events.filter(event => event.type === type); return found.length === 1 ? found[0]! : unavailable(); };
  const requested = one("GenerationRequested"), compiled = one("ContextCompiled"), budgeted = one("BudgetReserved"), completed = one("GenerationCompleted"), used = one("GenerationUsageRecorded");
  const originalCorrelations = Array.from({ length: job.attempt_count }, (_, index) => `${job.job_id}:attempt:${index + 1}`);
  if (requested.eventId !== stage.requestedEventId || compiled.eventId !== stage.compiledEventId || budgeted.eventId !== stage.budgetEventId
    || !originalCorrelations.includes(requested.correlationId) || compiled.correlationId !== requested.correlationId || budgeted.correlationId !== requested.correlationId
    || compiled.causationId !== requested.eventId || budgeted.causationId !== requested.eventId
    || requested.actor !== (scope.kind === "project" ? `user:${user.userId}` : "user") || compiled.actor !== "worker:compiler" || budgeted.actor !== "worker:policy"
    || events.some(event => event.streamId !== job.stream_id || event.clientId !== "server:document-job:generate" || event.payload.generation_id !== stage.generationId)
    || [requested, compiled, completed].some(event => event.payload.document_id !== job.document_id)
    || completed.correlationId !== job.correlation_id || used.correlationId !== job.correlation_id || completed.actor !== "worker:generator" || used.actor !== "worker:policy"
    || completed.causationId !== compiled.eventId || used.causationId !== completed.eventId || used.sequence !== completed.sequence + 1) return unavailable();
  const value = completed.payload, usageValue = used.payload, expectedTokens = stage.planned.usage.totalTokens + image.usage.totalTokens;
  const expectedCost = calls.reduce((total, call) => total + Number(call.used_microusd), 0);
  // Legacy completed checkpoints may omit financial fields; original event, slot and settled-ledger witnesses remain mandatory.
  if (!count(expectedTokens) || !count(expectedCost) || value.media_url !== media.url || value.media_type !== media.mimeType || value.source_content_hash !== media.contentHash
    || value.model_id !== image.model || value.provider !== image.provider || value.planner_model_id !== stage.planned.model || value.planner_response_id !== stage.planned.responseId
    || (value.provider_request_id ?? null) !== (image.providerRequestId ?? null) || value.provider_submission_id !== image.providerSubmissionId
    || value.image_width !== image.width || value.image_height !== image.height || value.context_hash !== compiled.payload.context_hash
    || !text(value.output_ref) || !text(value.prompt_ref) || !text(compiled.payload.context_hash)
    || budgeted.payload.reservation_id !== slot.tokenReservationId || budgeted.payload.cost_reservation_id !== slot.costReservationId
    || budgeted.payload.reserved_tokens !== slot.maximumTokens || budgeted.payload.reserved_microusd !== slot.maximumMicrousd
    || usageValue.reservation_id !== slot.tokenReservationId || usageValue.cost_reservation_id !== slot.costReservationId
    || usageValue.operation !== "image-generation" || usageValue.document_id !== job.document_id
    || usageValue.input_tokens !== stage.planned.usage.inputTokens + image.usage.inputTokens || usageValue.output_tokens !== stage.planned.usage.outputTokens + image.usage.outputTokens
    || usageValue.total_tokens !== expectedTokens || usageValue.planner_tokens !== stage.planned.usage.totalTokens || usageValue.image_tokens !== image.usage.totalTokens
    || usageValue.cost_microusd !== expectedCost || usageValue.reserved_tokens !== slot.maximumTokens || usageValue.reserved_microusd !== slot.maximumMicrousd
    || (Object.hasOwn(checkpoint, "reservationId") && checkpoint.reservationId !== slot.tokenReservationId)
    || (Object.hasOwn(checkpoint, "costReservationId") && checkpoint.costReservationId !== slot.costReservationId)
    || (Object.hasOwn(checkpoint, "costReservationMicrousd") && checkpoint.costReservationMicrousd !== slot.maximumMicrousd)
    || token.stream_id !== job.stream_id || cost.stream_id !== job.stream_id || token.correlation_id !== job.correlation_id || cost.correlation_id !== job.correlation_id
    || token.operation !== "image-generation" || cost.operation !== "image-generation" || token.period !== cost.period
    || (Object.hasOwn(checkpoint, "costReservationPeriod") && token.period !== checkpoint.costReservationPeriod)
    || token.period !== budgeted.payload.period || token.reserved_tokens !== slot.maximumTokens || cost.reserved_microusd !== slot.maximumMicrousd
    || token.used_tokens !== expectedTokens || cost.used_microusd !== expectedCost
    || token.status !== (expectedTokens > 0 ? "settled" : "released") || cost.status !== (expectedCost > 0 ? "settled" : "released")
    || !text(token.settled_at) || !text(cost.settled_at) || storage.status !== "written" || storage.write_acknowledged !== 1
    || storage.content_sha256 !== media.contentHash || storage.publication_event_id !== completed.eventId
    || slotRow.outcome_event_id !== null && slotRow.outcome_event_id !== completed.eventId) return unavailable();
  proofs.push(pinnedRow("output_native_storage_writes", storage), pinnedRow("budget_reservations", token), pinnedRow("cost_budget_reservations", cost),
    { sql: "(SELECT COUNT(*) FROM events WHERE stream_id=? AND type IN('GenerationCompleted','GenerationUsageRecorded','GenerationFailed') AND json_extract(payload,'$.generation_id')=?)=2", bindings: [job.stream_id, stage.generationId] });
  for (const [id, kind, content] of [[value.output_ref, "provider-output", stage.planned.raw], [value.prompt_ref, "prompt", image.prompt]]) {
    proofs.push({ sql: `EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind=? AND content=? AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${containment.sql})`, bindings: [id, user.userId, kind, content, ...containment.bindings] });
  }
  await options.readProof(proofs);
  if (!mediaKeyMatchesOwnerNamespace(storageKey, scope.ownerUserId)) return unavailable();
  const object = await env.MEDIA.get(storageKey);
  if (!object) return unavailable();
  // This limits recovery verification work, not generated-image eligibility.
  const verificationBytes = 64 * 1024 * 1024;
  let body: typeof object.body | null = null, reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let digest = "", streamFailed = false, streamError: unknown;
  try {
    // Capture once before any metadata, size, header or reader-construction failure.
    body = object.body;
    const size = object.size;
    if (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0 || size > verificationBytes) return unavailable();
    const metadata = object.customMetadata;
    if (!metadata || metadata.ownerId !== scope.ownerUserId || metadata.generationId !== stage.generationId
      || metadata.outputNativeStorage !== "1" || metadata.outputScopeKey !== scope.key || metadata.outputSlotId !== slot.slotId
      || metadata.outputOwnerId !== scope.ownerUserId || metadata.outputDocumentId !== scope.documentId || metadata.outputSha256 !== media.contentHash
      || metadata.sha256 !== media.contentHash || metadata.provider !== image.provider || (metadata.providerModel ?? metadata.model) !== image.model
      || (metadata.providerRequestId || null) !== (image.providerRequestId ?? null)) return unavailable();
    const headers = new Headers(); object.writeHttpMetadata(headers);
    if (headers.get("content-type") !== media.mimeType) return unavailable();
    reader = body.getReader();
    const hash = createHash("sha256");
    let bytes = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      if (!(part.value instanceof Uint8Array) || part.value.byteLength === 0) return unavailable();
      const next = bytes + part.value.byteLength;
      if (!Number.isSafeInteger(next) || next > size || next > verificationBytes) return unavailable();
      bytes = next;
      hash.update(part.value);
    }
    if (bytes !== size) return unavailable();
    digest = hash.digest("hex");
    reader.releaseLock();
  } catch (error) { streamFailed = true; streamError = error; }
  if (streamFailed) {
    try { if (reader) await reader.cancel(streamError); else if (body) await body.cancel(streamError); } catch { /* Preserve the original stream, construction or custody error. */ }
    try { reader?.releaseLock(); } catch { /* Preserve the original error, including thrown undefined. */ }
    throw streamError;
  }
  if (digest !== media.contentHash) return unavailable();
  // Recheck every captured SQL witness after the asynchronous private-media read.
  await options.readProof(proofs);
  const receipt = { ...checkpoint.generationReceipt, provider: image.provider, model: image.model, artifact_kind: "image", actual_provider_call_count: calls.length,
    provider_request_status: "completed", source_transmission_status: "transmitted", reservation_status: cost.status, settled_cost_microusd: expectedCost };
  for (const key of ["failure_code", "failure_category", "failure_stage"]) delete (receipt as Record<string, unknown>)[key];
  const result = { ...checkpoint, generationReceipt: receipt, appendedEventIds: [completed.eventId, used.eventId], stage: "completed", progressMessage: "Complete" };
  delete (result as Record<string, unknown>).errorDetail;
  return { assertions: proofs, result, completedAt: completed.recordedAt };
}

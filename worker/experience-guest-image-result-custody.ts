import { canonicalJson, digest, exactKeys, freeze, record } from "../src/experiences/compiler.ts";
import { parseGuestImageResultClaimEvent } from "../src/model/guest-image-result-presentation.ts";
import { publicEventPayload } from "./event-privacy.ts";
import { EVENT_WRITE_COLUMNS, EVENT_WRITE_STAGE_TRIGGER_SQL, eventWriteBindings, uuidV7, type EventRow } from "./event-write-primitives.ts";
import { sceneSourceVersionAssertions, type SceneSourceVersion } from "./scene-source-generation.ts";
import { SCENE_SOURCE_GENERATION_TRIGGERS, SCENE_SOURCE_GENERATION_MAX } from "../db/scene-source-generations.ts";
import { guestImageResultClaimRows, readGuestImageResultClaimLineage,
  type GuestImageResultClaimLineage, type GuestImageResultCompletedCustodyReview } from "./experience-guest-image-result-claim-contract.ts";
import { GUEST_IMAGE_RESULT_COPY_COLUMNS, readGuestImageResultCopyAttemptRow,
  type GuestImageResultCopyAttemptRow } from "./experience-guest-image-result-copy-contract.ts";
import { GUEST_IMAGE_RESULT_COPY_SCHEMA } from "./experience-guest-image-result-copy-schema.ts";
import { GUEST_CONTEXT_ADOPTION_SCHEMA } from "./experience-guest-context-adoption.ts";
import { GUEST_IMAGE_CLAIM_SCHEMA } from "./experience-guest-image-claim.ts";
import { GUEST_IMAGE_STAGE_CUSTODY_SCHEMA, guestImageStageHistoryStorageValue } from "./experience-guest-image-stage-custody.ts";
import type { GuestImageCopyProof } from "./experience-guest-image-copy-contract.ts";
import type { GuestImageResultPublishedGraph } from "./experience-guest-image-result-facts.ts";
import { identityFromRequest, readExistingPrincipalRequest, requireConsent } from "./principal-request-core.ts";
import { projectIntakeAuthority } from "./intake-authority.ts";
import { nativeMemoryAnswerExclusion } from "./memory-native-boundary.ts";
import { nativeStructuredOriginSchema } from "./memory-native-origin-schema.ts";
import { nativeDocumentJobOriginSchema } from "./memory-document-job-origin-schema.ts";
import { OUTPUT_REQUIREMENTS_SCHEMA } from "./output-requirements-schema.ts";
import type { WorkerEnv } from "./runtime.ts";
import { serializeEvent } from "./event-read-primitives.ts";
import { readImageWitness, imageWitnessAcknowledged, type ImageWitnessGuard } from "./generated-image-witness.ts";
import { qualifyClaimedImageCurrent, qualifyClaimedImageLocalAdoption, claimedImageEditMediaWork, claimedImageLocalAdoptionCanonicalWork, type ClaimedImageCurrentFacts, type ClaimedImageLocalAdoptionFacts } from "./generated-image-claimed-current.ts";
import { inspectOutputAsset, outputAssetSha256, MAX_OUTPUT_ASSET_BYTES } from "../src/model/output-asset-inspection.ts";
import { measureRetainedState } from "../src/model/retained-state.ts";
import type { GuestImageResultEditSnapshot } from "../src/model/generated-image-revision.ts";
import type { GuestImageResultMetadataSnapshot } from "../src/model/generated-image-edit-current.ts";
import { mediaKeyMatchesOwnerNamespace } from "../src/model/media-ownership.ts";
import { prepareClaimedImageEditContext, qualifyClaimedImageEditRequest, buildClaimedImageEditCandidate, claimedImageEditEventCellBytes, ClaimedImageEditError,
  type ClaimedImageEditContext, type ClaimedImageEditPrepared, type ClaimedImageEditCandidate, type ClaimedImageEditOperation } from "./generated-image-claimed-edit.ts";
import { parseGuestImageResultLocalAdoptionCommand, createGuestImageResultLocalAdoptionPair, matchGuestImageResultLocalAdoptionPair, guestImageResultLocalAdoptionIdentitiesUnused,
  type GuestImageResultLocalAdoptionCommand, type GuestImageResultLocalAdoptionPair } from "./generated-image-claimed-local-adoption.ts";

import { guestImagePersonalRefusal, guestImagePersonalJson, markGuestImagePersonalResponse, type GuestImageResultDraftView, type GuestImageResultInputView } from "./generated-image-claimed-personal-wire.ts";

import { parseGuestImageResultMediaUrl } from "../src/model/generated-image-edit.ts";
import { PRINCIPAL_WITH_ACCESS_SQL } from "./access-policy.ts";
import { configuredPilotAdmissionGuard, POLICY_VERSION, type PilotUser } from "./pilot-policy.ts";

/** Cancellation only: no proof, body, owner, deadline refresh or IO escapes. */
export type GuestImageResultOperation<T> = Readonly<{ result: Promise<T>; retire(): void }>;

/** Inert negative response bound, never a capability for later IO. */
export type GuestImageResultCurrentSnapshotCompletion = Readonly<{
  snapshot: Readonly<GuestImageResultEditSnapshot>; expiresAt: string;
}>;

export type GuestImageResultNativeSelection = Readonly<{ kind: "native"; exclusion: ImageWitnessGuard;
  subjectId: string | null; statementCount: number }>;
export type GuestImageResultRefusedSelection = Readonly<{ kind: "refused"; response: Response; statementCount: number }>;
export type GuestImageResultOriginSelection = GuestImageResultNativeSelection
  | Readonly<{ kind: "claimed"; statementCount: number }> | GuestImageResultRefusedSelection;


type Value = string | number | null;
type Row = Readonly<Record<string, Value>>;
type Proof = GuestImageCopyProof;
const fail = (): never => { throw new Error("guest_image_result_custody_unavailable"); };
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
// Closed manifest bound N<=16; lineage<=256KiB, the attempt's three bounded
// JSON/identity groups<=3*64KiB, N prefix + SAVE + claim + two result + two
// ordinary stage bodies<=64KiB each, construction<=128KiB.
const wholeGraphStringBytes = 262_144 + 3 * 65_536 + (16 + 2 + 2 + 2) * 65_536 + 131_072;
const nativeEnvelopeBytes = 1_048_576;
const isCurrent = (value: unknown): boolean => record(value) && exactKeys(value, ["current"])
  && Object.getOwnPropertyDescriptor(value, "current")?.value === 1;
const custodyColumns = ["custody_id", "session_id", "destination_user_id", "lease_id", "lease_acquisition", "request_id", "manifest_digest",
  "native_snapshot_digest", "context_lineage_digest", "save_lineage_digest", "stage_lineage_digest", "claim_event_id", "claim_event_sequence",
  "original_completion_event_id", "generation_id", "output_id", "copy_attempt_id", "lineage_json", "lineage_digest", "created_at_ms", "canonical_expires_at"] as const;

/** Called only after descriptor/shape validation and detachment. Unlike JSON
 * serialization this measures own undefined fields too (native ACK error may
 * be explicitly undefined), using the original claim lane's 13-byte marker. */
function nativeEnvelopeSize(value: unknown): number {
  if (value === undefined) return 13;
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value); if (typeof encoded !== "string") return fail(); return bytes(encoded);
  }
  if (Array.isArray(value)) return 2 + Math.max(0, value.length - 1) + value.reduce((sum, item) => sum + nativeEnvelopeSize(item), 0);
  const entries = Object.entries(value);
  return 2 + Math.max(0, entries.length - 1) + entries.reduce((sum, [key, item]) => sum + bytes(JSON.stringify(key)) + 1 + nativeEnvelopeSize(item), 0);
}

/** JSON-only capture, before any await. Do not call getters, array overrides or
 * toJSON while accepting an inert proof request. No caller SQL is accepted. */
function capture(value: unknown): unknown {
  const seen = new Set<object>(); let nodes = 0, total = 0;
  const visit = (v: unknown, depth: number): void => {
    if (++nodes > 24_000 || depth > 24) return fail();
    if (v === null || typeof v === "boolean") return;
    if (typeof v === "string") { const size = bytes(v); total += size;
      if (!v.isWellFormed() || v.includes("\0") || size > 262_144 || total > wholeGraphStringBytes) fail(); return; }
    if (typeof v === "number") { if (!Number.isFinite(v) || Object.is(v, -0)) fail(); return; }
    if (!v || typeof v !== "object" || seen.has(v)
      || (Array.isArray(v) ? Object.getPrototypeOf(v) !== Array.prototype : !record(v))) return fail();
    seen.add(v);
    const descriptors = Object.getOwnPropertyDescriptors(v);
    if (Reflect.ownKeys(descriptors).some(key => typeof key !== "string")) return fail();
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (Array.isArray(v) && key === "length") continue;
      if (["__proto__", "prototype", "constructor"].includes(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")
        || Array.isArray(v) && !/^(0|[1-9]\d*)$/u.test(key)) return fail();
      visit(descriptor.value, depth + 1);
    }
    if (Array.isArray(v)) {
      if (v.length > 100 || Object.keys(v).length !== v.length) return fail();
      for (let index = 0; index < v.length; index++) if (!Object.hasOwn(v, index)) return fail();
    }
  };
  visit(value, 0); return structuredClone(value);
}
function body(value: unknown, maximum: number): string {
  if (typeof value !== "string" || !value.isWellFormed() || !bytes(value) || bytes(value) > maximum || value.includes("\0")) return fail();
  return value;
}
function payload(value: string, maximum = 65_536): Record<string, unknown> {
  body(value, maximum); let decoded: unknown;
  try { decoded = JSON.parse(value); } catch { return fail(); }
  capture(decoded); if (!record(decoded)) return fail(); return decoded;
}
function arrayBodies(value: unknown, count: number, maximum: number): string[] {
  if (!Array.isArray(value) || value.length !== count) return fail();
  return value.map(item => body(item, maximum));
}
function exact(table: string, row: Row): Proof {
  // Internal table names and closed reconstructed rows only. json_array's
  // largest tuple here has 30 arguments, below native D1's function limit.
  const columns = Object.keys(row);
  return { sql: `EXISTS(SELECT 1 FROM ${table} WHERE json_array(${columns.join(",")})=?)`,
    bindings: [JSON.stringify(columns.map(key => row[key]))] };
}
function eventEnvelope(event: EventRow, raw: string, owner: string) {
  const split = publicEventPayload(event.eventId, event.payload, true);
  if (split.privateJson !== raw) return fail();
  return { event: { event_id: event.eventId, stream_id: event.streamId, sequence: event.sequence,
    occurred_at: event.occurredAt, recorded_at: event.recordedAt, actor: event.actor, client_id: event.clientId,
    correlation_id: event.correlationId, causation_id: event.causationId, compensates_event_id: event.compensatesEventId,
    schema_version: event.schemaVersion, type: event.type, payload: JSON.stringify(split.payload) },
  envelope: { private_event_id: event.eventId, owner_id: owner, project_id: String(event.payload.project_id ?? "") || null,
    document_id: String(event.payload.document_id ?? "") || null, private_json: raw, created_at: event.recordedAt, redacted_at: null } };
}
function event(value: { id: string; sequence: number; occurred: string; recorded: string }, stream: string,
  actor: string, clientId: string, correlationId: string, type: string, raw: string): EventRow {
  return { eventId: value.id, streamId: stream, sequence: value.sequence, occurredAt: value.occurred, recordedAt: value.recorded,
    actor, clientId, correlationId, causationId: null, compensatesEventId: null, schemaVersion: 1, type, payload: payload(raw) };
}

export type GuestImageResultWholeGraphInput = Readonly<{
  lineage: unknown; publishedAttempt: unknown; prefixBodies: readonly string[]; saveBody: string; claimBody: string;
  stageBodies: readonly string[]; resultBodies: readonly string[];
}>;
type GraphInput = Omit<GuestImageResultWholeGraphInput, "stageBodies"> & { stageBodies?: readonly string[] };
type CanonicalGraph = Omit<GuestImageResultPublishedGraph, "privateContents"> & { privateContents: readonly Row[] };

async function construct(value: unknown, fiveBodies: boolean, resultRole: "both" | "planner" | "association" = "both") {
  const v = capture(value);
  const keys = ["lineage", "publishedAttempt", "prefixBodies", "saveBody", "claimBody", "resultBodies", ...(fiveBodies ? ["stageBodies"] : [])];
  if (!record(v) || !exactKeys(v, keys)) return fail();
  const lineage = await readGuestImageResultClaimLineage(v.lineage), c = lineage.copy, m = c.manifest;
  const rows = await guestImageResultClaimRows(lineage), attempt = await readGuestImageResultCopyAttemptRow(v.publishedAttempt);
  const t = lineage.canonical.recordedAt, tMs = Date.parse(t), stream = `creative:${c.destinationUserId}`;
  if (attempt.state !== "published" || attempt.published_claim_digest !== rows.custody.lineage_digest
    || attempt.descriptor_json !== canonicalJson(c) || attempt.published_at_ms !== tMs || attempt.updated_at_ms !== tMs
    || lineage.contextLineage.events.some(e => e.recorded !== t || e.occurred !== t)
    || lineage.saveLineage.target.recorded !== t || lineage.saveLineage.target.occurred !== t) return fail();
  const prefixBodies = arrayBodies(v.prefixBodies, lineage.contextLineage.events.length, 65_536);
  const saveBody = body(v.saveBody, 65_536), claimBody = body(v.claimBody, 65_536);
  if (fiveBodies && resultRole !== "both") return fail();
  const resultBodies = arrayBodies(v.resultBodies, resultRole === "association" ? 0 : resultRole === "planner" ? 1 : 2, 65_536);
  const stageBodies = fiveBodies ? arrayBodies(v.stageBodies, 3, 131_072) : [];
  const eventEnvelopes: GuestImageResultPublishedGraph["eventEnvelopes"][number][] = [];
  const eventClientReceipts: GuestImageResultPublishedGraph["eventClientReceipts"][number][] = [];
  for (const [i, target] of lineage.contextLineage.events.entries()) {
    if (await digest(prefixBodies[i]) !== target.privateDigest) return fail();
    const e = event(target, stream, "user", "server:guest-context-adoption", `guest-context-adoption:${m.sessionId}`, target.type, prefixBodies[i]);
    const pair = eventEnvelope(e, prefixBodies[i], c.destinationUserId);
    if (pair.event.payload !== target.public || pair.envelope.project_id !== target.project || pair.envelope.document_id !== target.document
      || e.payload.client_event_id !== target.key
      || i >= 3 && (e.payload.canvas_id || e.payload.scope === "canvas" || e.payload.scope === "library" || e.payload.library_block === true)) return fail();
    eventEnvelopes.push(pair);
    eventClientReceipts.push({ stream_id: stream, client_event_id: target.key, event_id: target.id, sequence: target.sequence, created_at: target.recorded });
  }
  const save = lineage.saveLineage;
  if (await digest(saveBody) !== save.target.privateDigest) return fail();
  const saveEvent = event(save.target, stream, `user:${c.destinationUserId}`, "server:output-requirements", save.target.commandKey, "BlockCreated", saveBody);
  const savePair = eventEnvelope(saveEvent, saveBody, c.destinationUserId);
  if (savePair.event.payload !== save.target.public || savePair.envelope.project_id !== m.projectId || savePair.envelope.document_id !== m.documentId
    || saveEvent.payload.block_id !== save.target.requirementId || saveEvent.payload.type !== "output"
    || !record(saveEvent.payload.output_command_envelope)
    || await digest(saveEvent.payload.output_command_envelope) !== `sha256:${save.target.requestDigest}`) return fail();
  eventEnvelopes.push(savePair);
  if (await digest(claimBody) !== lineage.canonical.privateDigest) return fail();
  const claimed = event({ id: lineage.canonical.eventId, sequence: lineage.canonical.sequence, occurred: t, recorded: t }, stream,
    `user:${c.destinationUserId}`, "server:guest-image-result-claim", `guest-image-result-claim:v1:${c.custodyId}`, "GuestImageResultClaimed", claimBody);
  if (!parseGuestImageResultClaimEvent(claimed)) return fail();
  const p = claimed.payload;
  const expected = { version: 1, project_id: m.projectId, document_id: m.documentId, custody_id: c.custodyId,
    object_id: rows.custody.output_id, generation_id: m.generationId, manifest_digest: c.manifestDigest, claimed_origin: rows.eventOrigin,
    original_created_at: lineage.originalCompletion.occurredAt, model_id: lineage.originalCompletion.model, provider: lineage.originalCompletion.provider,
    planner_model_id: "gpt-5.6-terra", quality: "high", purpose: "final", source_surface: "outputs",
    output_ref: lineage.resultCopies[0].content_id, prompt_ref: lineage.resultCopies[1].content_id, content_expires_at: lineage.canonical.expiresAt,
    media_url: `/api/media/${encodeURIComponent(c.destinationKey)}`, media_type: "image/png", source_content_hash: m.object.contentSha256,
    image_width: m.object.width, image_height: m.object.height, image_byte_length: c.source.byteLength };
  if (!exactKeys(p, [...Object.keys(expected), "title", "prompt_technique", "latency_ms", "source_block_versions", "source_rights_digest"])
    || Object.entries(expected).some(([key, val]) => !same(p[key], val))) return fail();
  // These five source presentation values were qualified by the original
  // producer and are committed by canonical.privateDigest. Never reread an old
  // payer policy to reinterpret them. Version membership is historical only.
  const blockIds = lineage.contextLineage.events.slice(3).map(e => String(payload(e.public).block_id));
  blockIds.push(save.target.requirementId);
  if (!Array.isArray(p.source_block_versions) || p.source_block_versions.length < 1 || p.source_block_versions.length > 19
    || p.source_block_versions.some(entry => !record(entry) || !exactKeys(entry, ["block_id", "version"])
      || !blockIds.includes(String(entry.block_id)) || typeof entry.version !== "number" || !Number.isSafeInteger(entry.version)
      || entry.version < 1 || entry.version > 19)
    || new Set(p.source_block_versions.map(entry => entry.block_id)).size !== p.source_block_versions.length) return fail();
  eventEnvelopes.push(eventEnvelope(claimed, claimBody, c.destinationUserId));
  const privateContents: Row[] = [];
  for (const [i, copied] of lineage.stageCopies.entries()) {
    if (!fiveBodies) continue;
    const raw = guestImageStageHistoryStorageValue(copied.role, stageBodies[i]);
    if (bytes(raw) !== copied.byte_length || await digest(raw) !== copied.original_digest) return fail();
    privateContents.push({ content_id: copied.content_id, owner_id: c.destinationUserId, kind: "guest-image-stage-history", content: raw,
      created_at: copied.created_at, expires_at: copied.expires_at, redacted_at: null });
  }
  for (const [i, copied] of lineage.resultCopies.entries()) {
    // The fixed current-snapshot role needs the planner body; association-only
    // adoption loads no result body. Both immutable copy associations, their
    // original fixed expiries and the complete lineage remain unchanged.
    if (resultRole === "association" || resultRole === "planner" && i !== 0) continue;
    const raw = resultBodies[i];
    if (bytes(raw) !== copied.byte_length || await digest(raw) !== copied.original_digest) return fail();
    privateContents.push({ content_id: copied.content_id, owner_id: c.destinationUserId, kind: "guest-image-result-history", content: raw,
      created_at: copied.created_at, expires_at: copied.expires_at, redacted_at: null });
  }
  const base = { session_id: m.sessionId, destination_user_id: c.destinationUserId, lease_id: c.leaseSnapshot.lease_id,
    request_id: c.requestId, manifest_digest: c.manifestDigest };
  const afterGraph: CanonicalGraph = { version: 1, revokedAtMs: tMs,
    contextMapping: { ...base, lineage_json: canonicalJson(lineage.contextLineage), lineage_digest: lineage.contextLineageDigest, created_at_ms: tMs },
    saveMapping: { ...base, context_lineage_digest: lineage.contextLineageDigest, lineage_json: canonicalJson(save), lineage_digest: lineage.saveLineageDigest, created_at_ms: tMs },
    stageMapping: { ...base, context_lineage_digest: lineage.contextLineageDigest, save_lineage_digest: lineage.saveLineageDigest,
      lineage_json: canonicalJson(lineage.stageLineage), lineage_digest: lineage.stageLineageDigest, created_at_ms: tMs },
    resultMapping: rows.custody, stageCopies: lineage.stageCopies, resultCopies: lineage.resultCopies,
    eventEnvelopes, eventClientReceipts, saveCommand: { scope_key: `personal:${c.destinationUserId}:${m.projectId}`, actor_user_id: c.destinationUserId,
      command_key: save.target.commandKey, request_digest: save.target.requestDigest, action: "save", event_id: save.target.id, created_at: t },
    privateContents, publishedAttempt: attempt };
  const parts: Proof[] = [exact("experience_guest_context_adoptions", afterGraph.contextMapping), exact("experience_guest_image_claims", afterGraph.saveMapping),
    exact("experience_guest_image_stage_custodies", afterGraph.stageMapping), exact("experience_guest_image_result_custodies", afterGraph.resultMapping),
    exact("experience_guest_image_result_copy_attempts", attempt), exact("output_commands", afterGraph.saveCommand)];
  for (const pair of eventEnvelopes) parts.push(exact("events", pair.event), exact("event_private_payloads", pair.envelope));
  for (const receipt of eventClientReceipts) parts.push(exact("event_client_receipts", receipt));
  for (const copied of lineage.stageCopies) parts.push(exact("experience_guest_image_stage_copies", copied));
  for (const copied of lineage.resultCopies) parts.push(exact("experience_guest_image_result_copies", copied));
  parts.push({ sql: `(SELECT COUNT(*) FROM experience_guest_image_stage_copies WHERE session_id=?)=3
    AND (SELECT COUNT(*) FROM experience_guest_image_result_copies WHERE custody_id=?)=2`, bindings: [m.sessionId, c.custodyId] });
  for (const row of privateContents) parts.push(exact("private_content", row), { sql: `?<=${nowSql} AND ?>${nowSql}`, bindings: [row.created_at, row.expires_at] });
  const currentParts = [ownership(lineage)];
  parts.push({ sql: `?<=${nowSql} AND ?>${nowSql}`, bindings: [t, lineage.canonical.expiresAt] }, ...currentParts);
  return freeze({ lineage, afterGraph, parts, currentParts, completedReview: rows.completedReview });
}

/** Pure, closed, all-five-body reconstruction for the atomic owner's existing
 * deadline. No SQL is executed and no principal authority is created. Every
 * returned body was supplied by that caller; there is no rich-body getter.
 * The owner must still join native authority, schemas, Memory and its original
 * lease/source/tombstone facts before using this proof in a transaction. */
export async function guestImageResultWholeGraphProof(input: GuestImageResultWholeGraphInput): Promise<Readonly<{
  afterGraph: GuestImageResultPublishedGraph; parts: readonly Proof[]; currentParts: readonly Proof[];
  completedReview: GuestImageResultCompletedCustodyReview;
}>> {
  const graph = await construct(input, true);
  // Do not eagerly repack the complete graph into one large binding. Every
  // individual fixed predicate fits the native request envelope; the owner
  // reserves its actual batch. Its facts proof already supplies the positive
  // rows and original expiry, so that owner only adds currentParts (length 1).
  return freeze({ afterGraph: graph.afterGraph, parts: graph.parts, currentParts: graph.currentParts, completedReview: graph.completedReview });
}

/** A fresh read produces a bounded informational receipt only. It cannot grant
 * provider, generic private-content, media, revision, Memory or public access. */
export type GuestImageResultCustodyReceipt = Readonly<{
  version: 1; sessionId: string; custodyId: string; destinationUserId: string; projectId: string; documentId: string;
  outputId: string; generationId: string; claimEventId: string; expiresAt: string; completedReview: GuestImageResultCompletedCustodyReview;
}>;

// The owner is private to this fresh request. Atomic winner recovery must use
// its existing owner and the pure helper above, never this new read deadline.
function readOwner(request: Request, env: WorkerEnv) {
  if (!(request instanceof Request)) return fail();
  const db = env.DB, url = request.url, method = request.method, signal = request.signal;
  const headers = JSON.stringify(Array.from(request.headers)), cohort = env.FORMA_PILOT_COHORT_ID, admins = env.FORMA_ADMIN_EMAILS;
  const origin = new URL(url), site = request.headers.get("sec-fetch-site"), suppliedOrigin = request.headers.get("origin");
  if (!["GET", "POST"].includes(method) || origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash
    || (method === "POST" ? suppliedOrigin !== origin.origin : suppliedOrigin !== null && suppliedOrigin !== origin.origin)
    || site !== null && site !== "same-origin" && site !== "none" || bytes(headers) > 32_768
    || /(?:^|;\s*)(?:forma_project_context|forma_impersonation)=/u.test(request.headers.get("cookie") ?? "")) return fail();
  const deadline = performance.now() + 30_000, wallDeadline = Date.now() + 30_000;
  // One principal read may use 3 native statements. The fixed remainder is:
  // sidecar/native schemas2, mapping1, authority1, attempt1, SAVE/claim2,
  // result bodies2, native Memory batch3, family reads2, registry1.
  // Hence N+18 initial statements and one 3-statement batch. The final batch
  // reserves its actual closed constructor size M=3N+30+R (0<=R<=3), at most
  // 81 SELECTs. Reserve
  // native envelopes per admitted statement (the existing claim lane bound),
  // including each batch wrapper, never one global 1MiB cap.
  let stopped = false, count = 0, initialReads = 16 + 18, finalReads = 0, selectedBytes = 0, requestBytes = 0;
  let memoryBatchUsed = false, finalBatchUsed = false;
  const maximumReads = () => initialReads + finalReads;
  const maximumResults = () => initialReads * nativeEnvelopeBytes + 512 + (finalReads ? finalReads * 16_384 + 512 : 0);
  const waiters = new Set<() => void>();
  const stop = () => { stopped = true; for (const reject of waiters) reject(); waiters.clear(); };
  const current = () => {
    if (stopped || signal.aborted || request.signal !== signal || env.DB !== db || request.url !== url || request.method !== method
      || JSON.stringify(Array.from(request.headers)) !== headers || env.FORMA_PILOT_COHORT_ID !== cohort || env.FORMA_ADMIN_EMAILS !== admins
      || performance.now() >= deadline || Date.now() >= wallDeadline) { stop(); return fail(); }
  };
  current(); signal.addEventListener("abort", stop, { once: true });
  const wait = async <T>(work: () => Promise<T>): Promise<T> => {
    current(); let rejectStop: () => void = () => undefined;
    const ended = new Promise<never>((_, reject) => { rejectStop = () => reject(new Error("guest_image_result_custody_unavailable")); waiters.add(rejectStop); });
    const timer = setTimeout(stop, Math.max(0, Math.min(deadline - performance.now(), wallDeadline - Date.now())));
    const pending = Promise.resolve().then(() => { current(); return work(); });
    try { const result = await Promise.race([pending, ended]); current(); return result; }
    catch (error) { stop(); throw error; }
    finally { clearTimeout(timer); waiters.delete(rejectStop); void pending.catch(() => undefined); }
  };
  // Only trusted native read helpers receive this private adapter. They cannot
  // install schemas or mutate through it; each underlying read is counted.
  const statements = new WeakMap<object, { native: D1PreparedStatement; sql: string; values: unknown[] }>();
  const charge = (queries: readonly { sql: string; values: unknown[] }[]) => {
    current(); count += queries.length; if (count > maximumReads()) return fail();
    for (const query of queries) {
      const bindings = bytes(JSON.stringify(query.values));
      if (bindings > nativeEnvelopeBytes) return fail(); requestBytes += bytes(query.sql) + bindings;
    }
    if (requestBytes > maximumReads() * (100_000 + nativeEnvelopeBytes)) return fail();
  };
  const observation = <T>(value: T, maximum: number): T => {
    current(); const seen = new Set<object>(); let nodes = 0, strings = 0;
    const visit = (item: unknown, depth: number): void => {
      if (++nodes > 32_768 || depth > 32) return fail();
      if (item === null || item === undefined || typeof item === "boolean") return;
      if (typeof item === "number") { if (!Number.isFinite(item)) fail(); return; }
      if (typeof item === "string") {
        const size = bytes(item); strings += size;
        if (!item.isWellFormed() || size > maximum || strings > maximum) fail(); return;
      }
      if (typeof item !== "object" || seen.has(item)
        || (Array.isArray(item) ? Object.getPrototypeOf(item) !== Array.prototype : !record(item))) return fail();
      seen.add(item);
      const descriptors = Object.getOwnPropertyDescriptors(item);
      if (Reflect.ownKeys(descriptors).some(key => typeof key !== "string")) return fail();
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (Array.isArray(item) && key === "length") continue;
        strings += bytes(key); if (strings > maximum) return fail();
        if (["__proto__", "prototype", "constructor"].includes(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")
          || Array.isArray(item) && !/^(0|[1-9]\d*)$/u.test(key)) return fail();
        visit(descriptor.value, depth + 1);
      }
      if (Array.isArray(item)) {
        if (item.length > 256 || Object.keys(item).length !== item.length) return fail();
        for (let index = 0; index < item.length; index++) if (!Object.hasOwn(item, index)) return fail();
      }
    };
    visit(value, 0); const detached = structuredClone(value);
    const measured = nativeEnvelopeSize(detached); selectedBytes += measured;
    if (measured > maximum || selectedBytes > maximumResults()) return fail();
    return detached;
  };
  const wrap = (statement: D1PreparedStatement, sql: string, values: unknown[] = []): D1PreparedStatement => {
    const query = { native: statement, sql, values };
    const wrapped = {
      bind: (...values: unknown[]) => {
        current(); if (values.length > 100 || values.some(value => value !== null && typeof value !== "number" && typeof value !== "string"
          || typeof value === "number" && !Number.isFinite(value) || typeof value === "string" && bytes(value) > 1_048_576)) return fail();
        return wrap(statement.bind(...values), sql, values);
      },
      first: (...args: unknown[]) => { if (finalReads) return fail(); charge([query]); return wait(() => Reflect.apply(statement.first, statement, args)).then(value => observation(value, nativeEnvelopeBytes)); },
      all: (...args: unknown[]) => { if (finalReads) return fail(); charge([query]); return wait(() => Reflect.apply(statement.all, statement, args)).then(value => observation(value, nativeEnvelopeBytes)); },
      raw: fail,
      run: fail,
    } as unknown as D1PreparedStatement;
    statements.set(wrapped, query); return wrapped;
  };
  const boundedDb = { prepare: (sql: string) => { current(); if (bytes(sql) > 100_000 || !readOnlySql(sql)) return fail(); return wrap(db.prepare(sql), sql); },
    batch: (queries: D1PreparedStatement[]) => {
      current(); if (!Array.isArray(queries) || queries.length !== (finalReads || 3)
        || (finalReads ? finalBatchUsed : memoryBatchUsed)) return fail();
      if (finalReads) finalBatchUsed = true; else memoryBatchUsed = true;
      const originals = queries.map(query => statements.get(query) ?? fail()); charge(originals);
      const perResult = finalReads ? 16_384 : nativeEnvelopeBytes;
      return wait(() => db.batch(originals.map(query => query.native))).then(value => {
        const result = observation(value, queries.length * perResult + 512);
        if (!Array.isArray(result) || result.length !== queries.length || result.some(item => nativeEnvelopeSize(item) > perResult)) return fail();
        return result;
      }); },
    exec: fail, dump: fail, withSession: fail,
  } as unknown as WorkerEnv["DB"];
  const readEnv = new Proxy(env, { get(target, key, receiver) { current(); return key === "DB" ? boundedDb : Reflect.get(target, key, receiver); },
    set: () => fail(), defineProperty: () => fail(), deleteProperty: () => fail() });
  const text = (value: unknown, maximum: number) => body(value, maximum);
  return { db: boundedDb, env: readEnv, origin: origin.origin, current, wait, text,
    prefix: (n: number) => { current(); if (!Number.isSafeInteger(n) || n < 3 || n > 16 || finalReads) return fail(); initialReads = n + 18;
      if (count > maximumReads() || selectedBytes > maximumResults()
        || requestBytes > maximumReads() * (100_000 + nativeEnvelopeBytes)) return fail(); },
    reserveFinal: (n: number) => { current(); if (finalReads || !memoryBatchUsed || !Number.isSafeInteger(n)
      || n < 1 || n > 3 * (initialReads - 18) + 33) return fail(); finalReads = n; },
    dispose: () => { stop(); signal.removeEventListener("abort", stop); } };
}
type ReadOwner = ReturnType<typeof readOwner>;
type ProofReadOwner = Pick<ReadOwner, "db" | "env" | "current" | "wait" | "text">;

function readOnlySql(sql: string): boolean {
  if (!/^\s*SELECT\b/iu.test(sql)) return false;
  let quote = "";
  for (let i = 0; i < sql.length; i++) {
    const character = sql[i];
    if (quote) { if (character === quote) { if (quote !== "]" && sql[i + 1] === quote) i++; else quote = ""; } }
    else if (["'", '"', "`"].includes(character)) quote = character;
    else if (character === "[") quote = "]";
    else if (character === ";" || sql.slice(i, i + 2) === "--" || sql.slice(i, i + 2) === "/*") return false;
  }
  return quote === "";
}

const normalizedDdl = (sql: string) => sql.replace(/\bIF NOT EXISTS\s+/giu, "").replace(/\s+/gu, " ").trim().replace(/;$/u, "");
async function schemas(owner: ProofReadOwner): Promise<Proof> {
  const definitions = [...GUEST_CONTEXT_ADOPTION_SCHEMA, ...GUEST_IMAGE_CLAIM_SCHEMA, ...GUEST_IMAGE_STAGE_CUSTODY_SCHEMA, ...GUEST_IMAGE_RESULT_COPY_SCHEMA];
  const expected = definitions.map(sql => {
    const match = /^CREATE (TABLE|INDEX|TRIGGER)(?: IF NOT EXISTS)? ([a-z_]+)/u.exec(sql);
    if (!match) return fail();
    const table = match[1] === "TABLE" ? match[2] : /\bON ([a-z_]+)/u.exec(sql)?.[1];
    if (!table) return fail(); return { type: match[1].toLowerCase(), name: match[2], table, sql: normalizedDdl(sql) };
  });
  const tables = expected.filter(item => item.type === "table").map(item => item.name);
  const names = expected.map(item => item.name);
  const sql = `(SELECT json_group_array(json_object('type',type,'name',name,'table',tbl_name,'sql',definition)) FROM
    (SELECT type,name,tbl_name,CASE WHEN typeof(sql)='text' AND length(CAST(sql AS BLOB))<=32768 THEN sql ELSE NULL END AS definition
      FROM sqlite_schema WHERE name IN(SELECT value FROM json_each(?)) OR tbl_name IN(SELECT value FROM json_each(?)) ORDER BY name,type LIMIT 128))`;
  const bindings = [JSON.stringify(names), JSON.stringify(tables)];
  const row = await owner.db.prepare(`SELECT ${sql} AS snapshot`).bind(...bindings).first<{ snapshot: string }>(); owner.current();
  const snapshot = owner.text(row?.snapshot, 262_144); let found: unknown;
  try { found = JSON.parse(snapshot); } catch { return fail(); }
  if (!Array.isArray(found) || found.length >= 128 || found.some(item => !record(item) || !exactKeys(item, ["type", "name", "table", "sql"]))) return fail();
  const explicit = found.filter(item => !(item.type === "index" && item.sql === null && tables.includes(item.table)
    && new RegExp(`^sqlite_autoindex_${item.table}_[1-9][0-9]*$`, "u").test(item.name)));
  if (explicit.length !== expected.length || new Set(explicit.map(item => item.name)).size !== expected.length
    || expected.some(e => !explicit.some(item => item.name === e.name && item.type === e.type && item.table === e.table
      && typeof item.sql === "string" && normalizedDdl(item.sql) === e.sql))) return fail();
  return { sql: `${sql}=?`, bindings: [...bindings, snapshot] };
}

/** Native read-table definitions from runtime.ts, plus the native command
 * definition. A table/view substitution or altered key cannot turn EXISTS
 * into an ambiguous match. Owned additive families are qualified separately
 * in full; unrelated native indexes/triggers do not become new prerequisites. */
async function nativeTables(owner: ProofReadOwner, currentSnapshot: boolean | "writer" = false): Promise<Proof> {
  const definitions = [
    "CREATE TABLE events (event_id TEXT PRIMARY KEY NOT NULL, stream_id TEXT NOT NULL, sequence INTEGER NOT NULL, occurred_at TEXT NOT NULL, recorded_at TEXT NOT NULL, actor TEXT NOT NULL, client_id TEXT NOT NULL, correlation_id TEXT NOT NULL, causation_id TEXT, compensates_event_id TEXT, schema_version INTEGER NOT NULL DEFAULT 1, type TEXT NOT NULL, payload TEXT NOT NULL)",
    "CREATE TABLE event_private_payloads (private_event_id TEXT PRIMARY KEY NOT NULL,owner_id TEXT NOT NULL,project_id TEXT,document_id TEXT,private_json TEXT NOT NULL,created_at TEXT NOT NULL,redacted_at TEXT)",
    "CREATE TABLE event_client_receipts (stream_id TEXT NOT NULL, client_event_id TEXT NOT NULL, event_id TEXT NOT NULL, sequence INTEGER NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(stream_id,client_event_id))",
    "CREATE TABLE private_content (content_id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, kind TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, redacted_at TEXT)",
    "CREATE TABLE organization_projects (project_access_id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL, organization_id TEXT NOT NULL, owner_user_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
    "CREATE TABLE project_resource_scopes (project_access_id TEXT NOT NULL,resource_kind TEXT NOT NULL,resource_id TEXT NOT NULL,organization_id TEXT NOT NULL,project_id TEXT NOT NULL,owner_user_id TEXT NOT NULL,visibility TEXT NOT NULL DEFAULT 'collaborative_output',source_event_id TEXT,actor_user_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(project_access_id,resource_kind,resource_id))",
    "CREATE TABLE project_event_scopes (event_id TEXT PRIMARY KEY NOT NULL,project_access_id TEXT NOT NULL,organization_id TEXT NOT NULL,project_id TEXT NOT NULL,owner_user_id TEXT NOT NULL,source_stream_id TEXT NOT NULL,source_sequence INTEGER NOT NULL,project_sequence INTEGER NOT NULL,actor_user_id TEXT NOT NULL,created_at TEXT NOT NULL)",
    "CREATE TABLE private_content_retention_scopes(content_id TEXT PRIMARY KEY NOT NULL,organization_id TEXT NOT NULL,project_access_id TEXT NOT NULL,project_id TEXT NOT NULL,actor_user_id TEXT NOT NULL,classification TEXT NOT NULL,policy_version INTEGER NOT NULL,assigned_expires_at TEXT NOT NULL,created_at TEXT NOT NULL)",
    ...OUTPUT_REQUIREMENTS_SCHEMA.filter(sql => /^CREATE TABLE IF NOT EXISTS output_commands\(/u.test(sql)),
    "CREATE UNIQUE INDEX idx_events_stream_sequence ON events(stream_id, sequence)",
    "CREATE TRIGGER events_block_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'events are append-only'); END",
    "CREATE TRIGGER events_block_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT, 'events are append-only'); END",
    ...(currentSnapshot ? [
      "CREATE TABLE artifact_revisions(revision_id TEXT PRIMARY KEY NOT NULL,owner_id TEXT NOT NULL,organization_id TEXT,project_access_id TEXT,project_id TEXT NOT NULL,document_id TEXT NOT NULL,artifact_id TEXT NOT NULL,revision INTEGER NOT NULL,content_json TEXT NOT NULL,content_sha256 TEXT NOT NULL,created_by_user_id TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,redacted_at TEXT)",
      "CREATE UNIQUE INDEX idx_artifact_revisions_owner_artifact_revision ON artifact_revisions(owner_id,artifact_id,revision)",
      "CREATE INDEX idx_artifact_revisions_project_artifact ON artifact_revisions(project_access_id,artifact_id,revision)",
      "CREATE INDEX idx_artifact_revisions_expiry ON artifact_revisions(expires_at) WHERE redacted_at IS NULL",
    ] : []),
    ...(currentSnapshot === "writer" ? [
      "CREATE TABLE event_write_stage (event_id TEXT PRIMARY KEY NOT NULL,stream_id TEXT NOT NULL,sequence INTEGER NOT NULL,occurred_at TEXT NOT NULL,recorded_at TEXT NOT NULL,actor TEXT NOT NULL,client_id TEXT NOT NULL,correlation_id TEXT NOT NULL,causation_id TEXT,compensates_event_id TEXT,schema_version INTEGER NOT NULL,type TEXT NOT NULL,payload TEXT NOT NULL,owner_id TEXT NOT NULL,project_id TEXT,document_id TEXT,private_json TEXT)",
      EVENT_WRITE_STAGE_TRIGGER_SQL,
    ] : []),
  ];
  // Exact retained Drizzle declarations: 0000,0002,0007,0011,0013,0015,0016.
  // Privacy migration replays existing index/trigger SQL, so valid databases
  // can contain either spelling independently. Do not normalize SQL semantics
  // or reorder constraints to accept unknown schema definitions.
  const migration: Readonly<Record<string, string>> = {
    events: "CREATE TABLE `events` (`event_id` text PRIMARY KEY NOT NULL, `stream_id` text NOT NULL, `sequence` integer NOT NULL, `occurred_at` text NOT NULL, `recorded_at` text NOT NULL, `actor` text NOT NULL, `client_id` text NOT NULL, `correlation_id` text NOT NULL, `causation_id` text, `compensates_event_id` text, `schema_version` integer DEFAULT 1 NOT NULL, `type` text NOT NULL, `payload` text NOT NULL)",
    event_private_payloads: "CREATE TABLE IF NOT EXISTS `event_private_payloads` (`private_event_id` text PRIMARY KEY NOT NULL, `owner_id` text NOT NULL, `project_id` text, `document_id` text, `private_json` text NOT NULL, `created_at` text NOT NULL, `redacted_at` text)",
    event_client_receipts: "CREATE TABLE `event_client_receipts` (`stream_id` text NOT NULL, `client_event_id` text NOT NULL, `event_id` text NOT NULL, `sequence` integer NOT NULL, `created_at` text NOT NULL, PRIMARY KEY(`stream_id`, `client_event_id`))",
    private_content: "CREATE TABLE `private_content` (`content_id` text PRIMARY KEY NOT NULL, `owner_id` text NOT NULL, `kind` text NOT NULL, `content` text NOT NULL, `created_at` text NOT NULL, `expires_at` text NOT NULL, `redacted_at` text)",
    organization_projects: "CREATE TABLE IF NOT EXISTS `organization_projects` (`project_access_id` text PRIMARY KEY NOT NULL, `project_id` text NOT NULL, `organization_id` text NOT NULL, `owner_user_id` text NOT NULL, `status` text DEFAULT 'active' NOT NULL, `created_at` text NOT NULL, `updated_at` text NOT NULL)",
    project_resource_scopes: "CREATE TABLE IF NOT EXISTS `project_resource_scopes` (`project_access_id` text NOT NULL, `resource_kind` text NOT NULL, `resource_id` text NOT NULL, `organization_id` text NOT NULL, `project_id` text NOT NULL, `owner_user_id` text NOT NULL, `visibility` text DEFAULT 'collaborative_output' NOT NULL, `source_event_id` text, `actor_user_id` text NOT NULL, `created_at` text NOT NULL, PRIMARY KEY(`project_access_id`, `resource_kind`, `resource_id`))",
    project_event_scopes: "CREATE TABLE IF NOT EXISTS `project_event_scopes` (`event_id` text PRIMARY KEY NOT NULL, `project_access_id` text NOT NULL, `organization_id` text NOT NULL, `project_id` text NOT NULL, `owner_user_id` text NOT NULL, `source_stream_id` text NOT NULL, `source_sequence` integer NOT NULL, `project_sequence` integer NOT NULL, `actor_user_id` text NOT NULL, `created_at` text NOT NULL)",
    private_content_retention_scopes: "CREATE TABLE IF NOT EXISTS `private_content_retention_scopes` (`content_id` text PRIMARY KEY NOT NULL, `organization_id` text NOT NULL, `project_access_id` text NOT NULL, `project_id` text NOT NULL, `actor_user_id` text NOT NULL, `classification` text NOT NULL, `policy_version` integer NOT NULL, `assigned_expires_at` text NOT NULL, `created_at` text NOT NULL)",
    idx_events_stream_sequence: "CREATE UNIQUE INDEX `idx_events_stream_sequence` ON `events` (`stream_id`,`sequence`)",
    events_block_update: "CREATE TRIGGER `events_block_update` BEFORE UPDATE ON `events` BEGIN SELECT RAISE(ABORT, 'events are append-only'); END",
    events_block_delete: "CREATE TRIGGER `events_block_delete` BEFORE DELETE ON `events` BEGIN SELECT RAISE(ABORT, 'events are append-only'); END",
    event_write_stage: "CREATE TABLE `event_write_stage` (`event_id` text PRIMARY KEY NOT NULL, `stream_id` text NOT NULL, `sequence` integer NOT NULL, `occurred_at` text NOT NULL, `recorded_at` text NOT NULL, `actor` text NOT NULL, `client_id` text NOT NULL, `correlation_id` text NOT NULL, `causation_id` text, `compensates_event_id` text, `schema_version` integer NOT NULL, `type` text NOT NULL, `payload` text NOT NULL, `owner_id` text NOT NULL, `project_id` text, `document_id` text, `private_json` text)",
    artifact_revisions: "CREATE TABLE IF NOT EXISTS `artifact_revisions` (`revision_id` text PRIMARY KEY NOT NULL, `owner_id` text NOT NULL, `organization_id` text, `project_access_id` text, `project_id` text NOT NULL, `document_id` text NOT NULL, `artifact_id` text NOT NULL, `revision` integer NOT NULL, `content_json` text NOT NULL, `content_sha256` text NOT NULL, `created_by_user_id` text NOT NULL, `created_at` text NOT NULL, `expires_at` text NOT NULL, `redacted_at` text)",
    idx_artifact_revisions_owner_artifact_revision: "CREATE UNIQUE INDEX IF NOT EXISTS `idx_artifact_revisions_owner_artifact_revision` ON `artifact_revisions` (`owner_id`,`artifact_id`,`revision`)",
    idx_artifact_revisions_project_artifact: "CREATE INDEX IF NOT EXISTS `idx_artifact_revisions_project_artifact` ON `artifact_revisions` (`project_access_id`,`artifact_id`,`revision`)",
    idx_artifact_revisions_expiry: "CREATE INDEX IF NOT EXISTS `idx_artifact_revisions_expiry` ON `artifact_revisions` (`expires_at`) WHERE \"artifact_revisions\".\"redacted_at\" IS NULL",
  };
  const normalize = (sql: string) => normalizedDdl(sql).replace(/^CREATE TABLE "events"/u, "CREATE TABLE events").replace(/\s*([(),])\s*/gu, "$1");
  const expected = definitions.map(sql => {
    const match = /^CREATE (TABLE|(?:UNIQUE )?INDEX|TRIGGER)(?: IF NOT EXISTS)? ([a-z_]+)/u.exec(sql);
    if (!match) return fail(); return { type: match[1].replace("UNIQUE ", "").toLowerCase(), name: match[2], sql: normalize(sql) };
  });
  if (expected.length !== (currentSnapshot === "writer" ? 18 : currentSnapshot ? 16 : 12)) return fail();
  const names = JSON.stringify(expected.map(item => item.name));
  const catalog = `(SELECT json_group_array(json_object('type',type,'name',name,'sql',definition)) FROM
    (SELECT type,name,CASE WHEN typeof(sql)='text' AND length(CAST(sql AS BLOB))<=16384 THEN sql ELSE NULL END AS definition
      FROM sqlite_schema WHERE name IN(SELECT value FROM json_each(?)) ORDER BY name LIMIT ${currentSnapshot === "writer" ? 19 : currentSnapshot ? 17 : 13}))`;
  const writeSchema = currentSnapshot === "writer" ? claimedEditWriteSchema() : null;
  const row = await owner.db.prepare(`SELECT ${catalog} AS snapshot${writeSchema ? ` WHERE ${writeSchema.sql}` : ""}`)
    .bind(names, ...writeSchema?.bindings ?? []).first<{ snapshot: string }>(); owner.current();
  const snapshot = owner.text(row?.snapshot, 65_536); let found: unknown;
  try { found = JSON.parse(snapshot); } catch { return fail(); }
  if (!Array.isArray(found) || found.length !== expected.length || expected.some(e => !found.some(item => record(item)
    && exactKeys(item, ["type", "name", "sql"]) && item.type === e.type && item.name === e.name && typeof item.sql === "string"
    && (normalize(item.sql) === e.sql || migration[e.name] !== undefined && normalize(item.sql) === normalize(migration[e.name]))))) return fail();
  return { sql: `${catalog}=? AND NOT EXISTS(SELECT 1 FROM temp.sqlite_schema)${writeSchema ? ` AND (${writeSchema.sql})` : ""}`,
    bindings: [names, snapshot, ...writeSchema?.bindings ?? []] };
}

/** Closed effects of the one staged event. Extra unrelated indexes remain
 * harmless; extra write triggers or cascade effects do not. */
function claimedEditWriteSchema(): Proof {
  const tables = ["events", "event_private_payloads", "event_write_stage", "artifact_revisions", "scene_source_generations"];
  const scene = SCENE_SOURCE_GENERATION_TRIGGERS.filter(item => /^(?:scene_source_events_|scene_source_event_private_payloads_|scene_source_generations_)/u.test(item.name));
  if (scene.length !== 9) return fail();
  const triggers = [...scene.map(item => ({ name: item.name, sql: item.sql })),
    { name: "event_write_stage_after_insert", sql: EVENT_WRITE_STAGE_TRIGGER_SQL.replace(" IF NOT EXISTS", "") }];
  // Installed workerd 1.20260515.1 declares these exact protected tables with
  // no foreign keys. SQLite's catalog drops IF NOT EXISTS and the semicolon;
  // only this exact name/DDL pair avoids an unauthorized private-table scan.
  const nativeKv = "CREATE TABLE _cf_KV (\n        key TEXT PRIMARY KEY,\n        value BLOB\n      ) WITHOUT ROWID";
  const nativeMetadata = "CREATE TABLE _cf_METADATA (\n        key INTEGER PRIMARY KEY,\n        value BLOB\n      )";
  // The existing catalog independently qualifies the two append-only trigger
  // spellings; this closure qualifies every other effect with exact source SQL.
  return { sql: `(SELECT COUNT(*) FROM main.sqlite_schema WHERE type='trigger' AND lower(tbl_name) IN(SELECT value FROM json_each(?)))=12
    AND NOT EXISTS(SELECT 1 FROM main.sqlite_schema actual WHERE actual.type='trigger'
      AND lower(actual.tbl_name) IN(SELECT value FROM json_each(?))
      AND actual.name NOT IN('events_block_update','events_block_delete')
      AND NOT EXISTS(SELECT 1 FROM json_each(?) expected WHERE actual.name=json_extract(expected.value,'$.name') AND actual.sql=json_extract(expected.value,'$.sql')))
    AND NOT EXISTS(SELECT 1 FROM json_each(?) target JOIN pragma_foreign_key_list(target.value,'main'))
    AND NOT EXISTS(SELECT 1 FROM main.sqlite_schema parent JOIN pragma_foreign_key_list(
      CASE WHEN (parent.name='_cf_KV' AND parent.sql=?) OR (parent.name='_cf_METADATA' AND parent.sql=?) THEN '' ELSE parent.name END,'main') fk
      WHERE parent.type='table' AND lower(fk."table") IN('event_write_stage','scene_source_generations'))`,
  bindings: [JSON.stringify(tables), JSON.stringify(tables), JSON.stringify(triggers), JSON.stringify(tables), nativeKv, nativeMetadata] };
}

function ownership(lineage: GuestImageResultClaimLineage): Proof {
  const m = lineage.copy.manifest, output = lineage.originalCompletion.objectId, stream = lineage.canonical.streamId;
  const blockCreates = [...lineage.contextLineage.events.slice(3).map(e => ({ id: String(payload(e.public).block_id), sequence: e.sequence })),
    { id: lineage.saveLineage.target.requirementId, sequence: lineage.saveLineage.target.sequence }];
  const blocks = blockCreates.map(block => block.id);
  const events = [...lineage.contextLineage.events.map(e => e.id), lineage.saveLineage.target.id, lineage.canonical.eventId];
  const contentIds = [...lineage.stageCopies, ...lineage.resultCopies].map(copy => copy.content_id);
  const outputHex = Array.from(new TextEncoder().encode(output), byte => byte.toString(16).padStart(2, "0")).join("");
  const resources = [...blocks, m.projectId, m.documentId, output, m.generationId, `generated-image/${outputHex}`,
    ...contentIds, lineage.copy.destinationKey, `/api/media/${encodeURIComponent(lineage.copy.destinationKey)}`];
  return { sql: `NOT EXISTS(SELECT 1 FROM organization_projects WHERE project_id=?)
    AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_id IN(SELECT value FROM json_each(?)))
    AND NOT EXISTS(SELECT 1 FROM project_event_scopes WHERE event_id IN(SELECT value FROM json_each(?)))
    AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes WHERE content_id IN(SELECT value FROM json_each(?)))
    AND COALESCE((SELECT type FROM events WHERE stream_id=? AND sequence>? AND type IN('DocumentRemoved','DocumentRestored')
      AND json_extract(payload,'$.document_id')=? ORDER BY sequence DESC LIMIT 1),'DocumentRestored')='DocumentRestored'
    AND NOT EXISTS(SELECT 1 FROM events WHERE stream_id=? AND sequence>? AND type='ObjectDiscarded' AND json_extract(payload,'$.object_id')=?)
    AND NOT EXISTS(SELECT 1 FROM json_each(?) block WHERE
      COALESCE((SELECT type FROM events WHERE stream_id=? AND sequence>json_extract(block.value,'$.sequence') AND type IN('BlockRemoved','BlockRestored')
        AND json_extract(payload,'$.block_id')=json_extract(block.value,'$.id') ORDER BY sequence DESC LIMIT 1),'BlockRestored')<>'BlockRestored'
      OR COALESCE((SELECT COALESCE(json_extract(payload,'$.scope'),'library') FROM events WHERE stream_id=? AND sequence>json_extract(block.value,'$.sequence') AND type='BlockRehomed'
        AND json_extract(payload,'$.block_id')=json_extract(block.value,'$.id') ORDER BY sequence DESC LIMIT 1),'document')<>'document'
      OR COALESCE((SELECT COALESCE(json_extract(payload,'$.document_id'),'') FROM events WHERE stream_id=? AND sequence>json_extract(block.value,'$.sequence') AND type='BlockRehomed'
        AND json_extract(payload,'$.block_id')=json_extract(block.value,'$.id') ORDER BY sequence DESC LIMIT 1),?)<>?
      OR COALESCE((SELECT json_extract(payload,'$.project_id') FROM events WHERE stream_id=? AND sequence>json_extract(block.value,'$.sequence') AND type='BlockRehomed'
        AND json_extract(payload,'$.block_id')=json_extract(block.value,'$.id') AND json_extract(payload,'$.project_id') IS NOT NULL ORDER BY sequence DESC LIMIT 1),?)<>?)
    AND NOT EXISTS(SELECT 1 FROM events WHERE stream_id=? AND event_id NOT IN(SELECT value FROM json_each(?))
      AND (type='ProjectCreated' AND json_extract(payload,'$.project_id')=?
        OR type IN('DocumentCreated','DocumentForked') AND json_extract(payload,'$.document_id')=?
        OR type='BlockCreated' AND json_extract(payload,'$.block_id') IN(SELECT value FROM json_each(?))
        OR type IN('GenerationCompleted','IdeationPreviewCompleted','GuestImageResultClaimed') AND (json_extract(payload,'$.object_id')=?
          OR ? IN(SELECT value FROM json_each(events.payload,'$.object_ids')) OR json_extract(payload,'$.generation_id')=?)
        OR type IN('DocumentRenderCompleted','DocumentArtifactEdited') AND json_extract(payload,'$.artifact_id') IN(?,?)))`,
  bindings: [m.projectId, JSON.stringify(resources), JSON.stringify(events), JSON.stringify(contentIds), stream, lineage.contextLineage.events[1].sequence, m.documentId,
    stream, lineage.canonical.sequence, output, JSON.stringify(blockCreates), stream, stream, stream, m.documentId, m.documentId, stream, m.projectId, m.projectId,
    stream, JSON.stringify(events), m.projectId, m.documentId, JSON.stringify(blocks), output, output, m.generationId, output, `generated-image/${outputHex}`] };
}

async function memory(owner: ProofReadOwner, graph: CanonicalGraph): Promise<Proof[]> {
  const exclusion = await owner.wait(() => nativeMemoryAnswerExclusion(owner.env, { answerAlias: "content" }));
  const structured = await owner.wait(() => nativeStructuredOriginSchema(owner.env));
  const documentJob = await owner.wait(() => nativeDocumentJobOriginSchema(owner.env));
  const registries = ["memory_native_answer_origins", "memory_structured_answer_origins", "memory_document_job_answer_origins"];
  const catalog = `(SELECT json_group_array(json_object('type',type,'name',name,'sql',definition)) FROM
    (SELECT type,name,CASE WHEN length(CAST(sql AS BLOB))<=16384 THEN sql ELSE NULL END AS definition FROM sqlite_schema
      WHERE type IN('table','view') AND name IN(SELECT value FROM json_each(?)) ORDER BY name LIMIT 4))`;
  const names = JSON.stringify(registries);
  const observation = await owner.db.prepare(`SELECT ${catalog} AS snapshot`).bind(names).first<{ snapshot: string }>(); owner.current();
  const snapshot = owner.text(observation?.snapshot, 65_536); let found: unknown;
  try { found = JSON.parse(snapshot); } catch { return fail(); }
  if (!Array.isArray(found) || found.length > 3 || found.some(row => !record(row) || !exactKeys(row, ["type", "name", "sql"])
    || row.type !== "table" || !registries.includes(String(row.name)) || typeof row.sql !== "string")) return fail();
  const parts: Proof[] = [{ sql: `${catalog}=?`, bindings: [names, snapshot] },
    { sql: structured.guard.condition, bindings: [...structured.guard.bindings] },
    { sql: documentJob.guard.condition, bindings: [...documentJob.guard.bindings] }];
  const events = JSON.stringify(graph.eventEnvelopes.map(pair => pair.event.event_id));
  const allIds = JSON.stringify([...graph.stageCopies, ...graph.resultCopies].map(copy => copy.content_id));
  for (const registry of found) parts.push({ sql: `NOT EXISTS(SELECT 1 FROM ${registry.name}
    WHERE user_event_id IN(SELECT value FROM json_each(?)) OR answer_event_id IN(SELECT value FROM json_each(?))
      OR user_content_id IN(SELECT value FROM json_each(?)) OR answer_content_id IN(SELECT value FROM json_each(?))
      ${registry.name === "memory_native_answer_origins" ? "" : "OR manifest_content_ref IN(SELECT value FROM json_each(?))"})`,
  bindings: [events, events, allIds, allIds, ...(registry.name === "memory_native_answer_origins" ? [] : [allIds])] });
  for (const content of graph.privateContents) parts.push({ sql: `EXISTS(SELECT 1 FROM private_content content WHERE content.content_id=? AND (${exclusion.sql}))`,
    bindings: [content.content_id, ...exclusion.bindings] });
  return parts;
}

/** Dormant, fresh canonical-result read. Historical source/private bodies,
 * live guest possession, old policy, financial holds and original lease expiry
 * are deliberately not dependencies. Stage-copy associations remain exact,
 * but expired stage text cannot shorten the two result copies' own retention. */
export async function readGuestImageResultCustody(request: Request, env: WorkerEnv,
  input: Readonly<{ sessionId: string; custodyId: string }>): Promise<GuestImageResultCustodyReceipt | null> {
  let owner: ReadOwner | undefined;
  try {
    const selector = capture(input);
    if (!record(selector) || !exactKeys(selector, ["sessionId", "custodyId"])
      || typeof selector.sessionId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(selector.sessionId)
      || typeof selector.custodyId !== "string" || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(selector.custodyId)) return fail();
    owner = readOwner(request, env); const scope = owner;
    const auth = await scope.wait(() => readExistingPrincipalRequest(request, scope.env, "creator", { account: "principal" }));
    if ("kind" in auth || auth.response || !auth.user || requireConsent(auth.user) || auth.user.fictional || auth.user.projectExecution
      || auth.user.userId.startsWith("guest:") || auth.user.streamId !== `creative:${auth.user.userId}`
      || !auth.user.access.capabilities.includes("project.author")) return fail();
    const schema = await schemas(scope), nativeSchema = await nativeTables(scope);
    const custody = await scope.db.prepare(`SELECT ${custodyColumns.join(",")} FROM experience_guest_image_result_custodies
      WHERE custody_id=? AND session_id=? AND destination_user_id=? AND length(CAST(lineage_json AS BLOB))<=262144`)
      .bind(selector.custodyId, selector.sessionId, auth.user.userId).first<Record<string, Value>>(); scope.current();
    if (!custody) return null;
    const raw = scope.text(custody.lineage_json, 262_144);
    const lineage = await scope.wait(() => readGuestImageResultClaimLineage(JSON.parse(raw)));
    scope.prefix(lineage.copy.manifest.sourceHead);
    const rows = await scope.wait(() => guestImageResultClaimRows(lineage));
    if (!same(custody, rows.custody) || lineage.copy.destinationUserId !== auth.user.userId || scope.origin !== lineage.contextLineage.origin) return fail();
    const authority = projectIntakeAuthority(scope.env, { user: auth.user, principal: auth.user, impersonation: null },
      { projectId: lineage.copy.manifest.projectId, documentId: lineage.copy.manifest.documentId });
    const admitted = await scope.db.prepare(`SELECT 1 AS current WHERE ${authority.sql}`).bind(...authority.bindings).first();
    if (!isCurrent(admitted)) return fail();
    const attempt = await scope.db.prepare(`SELECT ${GUEST_IMAGE_RESULT_COPY_COLUMNS.join(",")} FROM experience_guest_image_result_copy_attempts
      WHERE attempt_id=? AND state='published' AND length(CAST(descriptor_json AS BLOB))<=65536 AND length(CAST(lease_snapshot_json AS BLOB))<=65536
        AND length(CAST(destination_metadata_json AS BLOB))<=8192`).bind(lineage.copy.attemptId).first<GuestImageResultCopyAttemptRow>(); scope.current();
    if (!attempt) return fail();
    const privateEvent = async (id: string) => {
      const row = await scope.db.prepare(`SELECT private_json FROM event_private_payloads WHERE private_event_id=? AND owner_id=?
        AND redacted_at IS NULL AND length(CAST(private_json AS BLOB)) BETWEEN 1 AND 65536`).bind(id, auth.user!.userId).first<{ private_json: string }>();
      scope.current(); return scope.text(row?.private_json, 65_536);
    };
    const prefixBodies: string[] = [];
    for (const target of lineage.contextLineage.events) prefixBodies.push(await privateEvent(target.id));
    const saveBody = await privateEvent(lineage.saveLineage.target.id), claimBody = await privateEvent(lineage.canonical.eventId);
    const resultBodies: string[] = [];
    for (const copied of lineage.resultCopies) {
      const row = await scope.db.prepare(`SELECT content FROM private_content WHERE content_id=? AND owner_id=? AND kind='guest-image-result-history'
        AND redacted_at IS NULL AND created_at<=${nowSql} AND expires_at>${nowSql} AND length(CAST(content AS BLOB)) BETWEEN 1 AND 65536`)
        .bind(copied.content_id, auth.user.userId).first<{ content: string }>(); scope.current(); resultBodies.push(scope.text(row?.content, 65_536));
    }
    const inputGraph: GraphInput = { lineage, publishedAttempt: attempt, prefixBodies, saveBody, claimBody, resultBodies };
    const graph = await scope.wait(() => construct(inputGraph, false));
    const exclusions = await memory(scope, graph.afterGraph);
    const parts = [schema, nativeSchema, authority, ...graph.parts, ...exclusions];
    const receipt: GuestImageResultCustodyReceipt = freeze({ version: 1, sessionId: lineage.copy.manifest.sessionId, custodyId: lineage.copy.custodyId,
      destinationUserId: lineage.copy.destinationUserId, projectId: lineage.copy.manifest.projectId, documentId: lineage.copy.manifest.documentId,
      outputId: rows.custody.output_id, generationId: lineage.copy.manifest.generationId, claimEventId: lineage.canonical.eventId,
      expiresAt: lineage.canonical.expiresAt, completedReview: graph.completedReview });
    // One D1 readonly batch is one transactional snapshot. Each fixed SELECT
    // must return its own dense successful current=1 result. Avoid repacking
    // all retained bodies into an oversized single JSON/parameter envelope.
    scope.reserveFinal(parts.length);
    const current = await scope.db.batch(parts.map(proof => scope.db.prepare(`SELECT 1 AS current WHERE ${proof.sql}`).bind(...proof.bindings)));
    scope.current();
    if (!Array.isArray(current) || current.length !== parts.length || current.some(result => !record(result)
      || Object.getOwnPropertyDescriptor(result, "success")?.value !== true
      || Object.hasOwn(result, "error") && Object.getOwnPropertyDescriptor(result, "error")?.value !== undefined
      || !Array.isArray(result.results) || result.results.length !== 1 || !isCurrent(result.results[0]))) return null;
    return receipt;
  } catch { return null; }
  finally { owner?.dispose(); }
}

// The current-snapshot profile is a separate fixed operation. None of these
// private adapters or phases can be obtained from an informational receipt.
const CURRENT_SNAPSHOT_PROFILE = Object.freeze({
  deadlineMs: 30_000, initialCanonicalReads: 33, witnessStatements: 1733, statements: 2186,
  boundaryStatements: 210, witnessGuardStatements: 131, nativeEnvelopeBytes: 1_048_576,
  // 65,536 nonempty chunks plus the one terminal EOF read.
  guardEnvelopeBytes: 16_384, metadataBytes: 65_536, metadataCaptures: 2, streamReads: 65_537,
  ownedPngBytes: MAX_OUTPUT_ASSET_BYTES, inspectorScratchBytes: 2 * MAX_OUTPUT_ASSET_BYTES + 2 * 32 * 1024 * 1024,
  retainedDisclosureBytes: 16_000_000, aggregateBytes: 155_108_864,
});
const CLAIMED_EDIT_PROFILE = Object.freeze({
  ...CURRENT_SNAPSHOT_PROFILE, statements: 4795, boundaryStatements: 423,
  metadataCaptures: 18, metadataBytes: 18 * 32_768, streamReads: 15 * 65_537,
  nativeCalls: 18, ordinarySources: 11, bodyStreams: 15, wireBytes: 24_131_072,
  binaryBytes: 14 * MAX_OUTPUT_ASSET_BYTES + 24_131_072,
});
const CLAIMED_LOCAL_ADOPTION_PROFILE = Object.freeze({
  ...CURRENT_SNAPSHOT_PROFILE, statements: 2397, boundaryStatements: 421,
  // The input has at most8,192 one-byte chunks plus EOF, separately from PNG.
  streamReads: 65_537 + 8193, commandBytes: 8192, nativeCalls: 2, pairEnvelopeBytes: 32_768,
});
// Source-bounded leaf work, separate from measured owner/evidence roots.
// Alias input is a selected scalar/array inside an already admitted128KB raw
// event. The sealed String walker visits4096 values at at most25 levels. A
// property-key result remains live during its reference-value walk and trim.
const ADOPTION_ALIAS_WORK = 2 * (64 + 32 * 4096 + (64 + 16 + 24) * 4096 + 2 * 25 * 128_000)
  + 2 * (24 + 2 * 128_000) + (64 + 5 * 32) + 2 * (64 + 5 * 16);
// Pure leaf capture: N512/U32768, depth12/64 keys. Bound a detached graph,
// path Set,13 simultaneous key arrays/descriptors and their key characters.
// Rejected parsePair inputs may stringify before final byte checks: J=6U+32N+2.
const adoptionLeafCaptureWork = (64 + 16 + 24) * 512 + 2 * 32_768 + (64 + 32 * 512)
  + 13 * (64 + 64 * (16 + 24) + 246) + 2 * 32_768;
const adoptionLeafJsonUnits = 6 * 32_768 + 32 * 512 + 2;
const adoptionLeafPairWork = adoptionLeafCaptureWork + 3 * (24 + 5 * adoptionLeafJsonUnits)
  + 2 * (64 + 82 * 1024) // completed-review input/capture/validation bound
  + (2 * 13 + 24 + 9 + 27 + 2 + 5 + 18 + 5) * (64 + 16 + 24 + 2 * 64);
function adoptionPairWork(mediaUrl: string): number {
  // Matcher retains expected while parsing actual. Constructor needs one
  // constructed pair and one parsed pair; the same two-graph bound covers it.
  return 2 * (adoptionLeafPairWork + claimedImageEditMediaWork(mediaUrl));
}
const CLAIMED_PERSONAL_MEDIA_PROFILE = Object.freeze({ ...CURRENT_SNAPSHOT_PROFILE, statements: 2179, boundaryStatements: 207, responseChunkBytes: 65_536 });
const CLAIMED_PERSONAL_DRAFT_PROFILE = Object.freeze({ ...CURRENT_SNAPSHOT_PROFILE, statements: 2190, boundaryStatements: 210, selectorRows: 128, selectorBytes: 65_536 });
const CLAIMED_PERSONAL_INPUTS_PROFILE = Object.freeze({ ...CURRENT_SNAPSHOT_PROFILE, statements: 2184, boundaryStatements: 209, promptBytes: 65_536, replyBytes: 524_288 });
type CompletedImageAction = "current" | "edit" | "check" | "adopt" | "media" | "draft" | "inputs";
type CurrentPhase = "canonical" | "witness" | "qualify" | "before" | "get" | "inspect" | "head" | "final" | "returned"
  | "request" | "edit-qualify" | "edited-inspect" | "ordinary" | "edit-proof" | "put" | "destination" | "publish" | "adopt-command" | "response";
const currentTyped = Object.getPrototypeOf(Uint8Array.prototype);
const currentByteLength = Object.getOwnPropertyDescriptor(currentTyped, "byteLength")!.get!;
const currentBuffer = Object.getOwnPropertyDescriptor(currentTyped, "buffer")!.get!;
const currentSet = Uint8Array.prototype.set, currentFill = Uint8Array.prototype.fill;
const currentGetReader = ReadableStream.prototype.getReader, currentCancelBody = ReadableStream.prototype.cancel;
const currentReadChunk = ReadableStreamDefaultReader.prototype.read, currentCancelReader = ReadableStreamDefaultReader.prototype.cancel;
const currentReleaseReader = ReadableStreamDefaultReader.prototype.releaseLock;
const currentText = (value: unknown, maximum: number): value is string => typeof value === "string" && value.length <= maximum
  && value.isWellFormed() && !/[\p{Cc}]/u.test(value) && bytes(value) <= maximum;
function currentCancelObject(value: unknown): void {
  try { if (value && typeof value === "object") { const body = Reflect.get(value, "body", value);
    if (body) void Reflect.apply(currentCancelBody, body, []).catch(() => undefined); } } catch { /* A late native object grants no disclosure. */ }
}
function measureCurrentRetained(value: unknown, maximum: number = CURRENT_SNAPSHOT_PROFILE.retainedDisclosureBytes): number {
  return measureRetainedState(value, { bytes: maximum, nodes: 100_000, depth: 96 }).bytes;
}
function completedImageOwner(request: Request, env: WorkerEnv, outputId: string, action: CompletedImageAction) {
  if (!(request instanceof Request)) return fail();
  const profile = action === "edit" ? CLAIMED_EDIT_PROFILE : action === "adopt" ? CLAIMED_LOCAL_ADOPTION_PROFILE
    : action === "media" ? CLAIMED_PERSONAL_MEDIA_PROFILE : action === "draft" ? CLAIMED_PERSONAL_DRAFT_PROFILE
      : action === "inputs" ? CLAIMED_PERSONAL_INPUTS_PROFILE : CURRENT_SNAPSHOT_PROFILE;
  const db = env.DB, bucket = env.MEDIA, signal = request.signal, url = request.url, method = request.method, requestBody = request.body;
  const headers = JSON.stringify(Array.from(request.headers)), origin = new URL(url), site = request.headers.get("sec-fetch-site");
  const suppliedOrigin = request.headers.get("origin"), cohort = env.FORMA_PILOT_COHORT_ID, admins = env.FORMA_ADMIN_EMAILS;
  const checkOperation = origin.searchParams.get("operationSha256");
  const expectedPath = action === "media" ? `/api/media/${encodeURIComponent(outputId)}`
    : action === "draft" ? `/api/experiences/image/claimed-result/${outputId}`
      : action === "inputs" ? `/api/claimed-image-inputs/${outputId}` : `/api/generated-images/${outputId}`;
  if ((action === "edit" || action === "adopt" ? method !== (action === "edit" ? "PATCH" : "POST") || !requestBody || request.bodyUsed || requestBody.locked || !!origin.search
      : method !== "GET" || requestBody !== null || (action === "check"
        ? !checkOperation || !/^[a-f0-9]{64}$/u.test(checkOperation) || Array.from(origin.searchParams).length !== 1
        : !!origin.search)) || origin.protocol !== "https:" || origin.username || origin.password || origin.hash
    || origin.pathname !== expectedPath || (action === "edit" || action === "adopt" ? suppliedOrigin !== origin.origin : suppliedOrigin !== null && suppliedOrigin !== origin.origin)
    || site !== null && site !== "same-origin" && site !== "none" || bytes(headers) > 32_768
    || /(?:^|;\s*)(?:forma_project_context|forma_impersonation)=/u.test(request.headers.get("cookie") ?? "")) return fail();
  const monotonicDeadline = performance.now() + profile.deadlineMs;
  const wallDeadline = Date.now() + profile.deadlineMs;
  let stopped = false, phase: CurrentPhase = action === "adopt" ? "adopt-command" : "canonical", prefixLength = 16, canonicalReads = 0, witnessReads = 0, totalReads = 0;
  let witnessReservation = 0, memoryBatchUsed = false, beforeUsed = false, finalUsed = false, metadataCaptures = 0, metadataBytes = 0, streamReads = 0;
  let requestBytes = 0, resultBytes = 0, retainedBytes = 0, owned: Uint8Array<ArrayBuffer> | null = null, users = 0;
  let canonicalRetainedBytes = 0, witnessRetainedBytes = 0, witnessEvents = 0, witnessRevisions = 0, activeSqlBytes = 0, nativeCaptureScratch = 0;
  let requiredExpiresAt: number | null = null;
  let bodyStarted = false, readbackUsed = false, nativeCalls = 0, bodyStreams = 0, binaryBytes = 0, ordinarySources = 0;
  let writing = false, publishing = false, edited: Uint8Array<ArrayBuffer> | null = null, editedUsers = 0;
  let temporary: Uint8Array<ArrayBuffer> | null = null, temporaryUsers = 0;
  let capturedVersion: SceneSourceVersion | null = null;
  let capturedTotals: Readonly<{ count: number; head: number; raw_bytes: number }> | null = null;
  let proofIdentity: readonly Proof[] | null = null;
  const waiters = new Set<() => void>(), cancellations = new Set<() => void>();
  const retire = () => { if (owned && users === 0) { Reflect.apply(currentFill, owned, [0]); owned = null; }
    if (stopped && edited && editedUsers === 0) { Reflect.apply(currentFill, edited, [0]); edited = null; }
    if (stopped && temporary && temporaryUsers === 0) { Reflect.apply(currentFill, temporary, [0]); temporary = null; } };
  const stop = () => { if (stopped) return; stopped = true; for (const reject of waiters) reject(); waiters.clear();
    for (const cancel of cancellations) { try { cancel(); } catch { /* Best effort only. */ } } cancellations.clear(); retire(); };
  const current = () => {
    if (stopped || signal.aborted || request.signal !== signal || env.DB !== db || env.MEDIA !== bucket
      || request.url !== url || request.method !== method || request.body !== requestBody || (action === "edit" || action === "adopt") && !bodyStarted && (request.bodyUsed || requestBody!.locked) || JSON.stringify(Array.from(request.headers)) !== headers
      || env.FORMA_PILOT_COHORT_ID !== cohort || env.FORMA_ADMIN_EMAILS !== admins
      || performance.now() >= monotonicDeadline || Date.now() >= wallDeadline
      || requiredExpiresAt !== null && Date.now() >= requiredExpiresAt) { stop(); return fail(); }
  };
  // Logical own data only. Request, D1 and R2 native implementation heaps are
  // opaque; this is not a heap/RSS guarantee. No function or adapter escapes.
  const ownerData = () => ({ url, method, headers, origin: origin.href, suppliedOrigin, site, cohort, admins,
    monotonicDeadline, wallDeadline, requiredExpiresAt, phase, stopped, prefixLength, canonicalReads, witnessReads, totalReads,
    witnessReservation, memoryBatchUsed, beforeUsed, finalUsed, metadataCaptures, metadataBytes, streamReads,
    requestBytes, resultBytes, retainedBytes, users, canonicalRetainedBytes, witnessRetainedBytes, witnessEvents, witnessRevisions, activeSqlBytes, nativeCaptureScratch,
    waiterCount: waiters.size, cancellationCount: cancellations.size, ...(action === "current" ? {} : { action, bodyStarted, readbackUsed, nativeCalls, bodyStreams, binaryBytes, ordinarySources,
    writing, publishing, editedBytes: edited?.byteLength ?? 0, editedUsers, temporaryBytes: temporary?.byteLength ?? 0, temporaryUsers, capturedVersion, capturedTotals }) });
  const accounting = (roots: unknown, reserve = 0) => {
    current(); if (!Number.isSafeInteger(reserve) || reserve < 0) return fail();
    const measured = measureCurrentRetained([ownerData(), roots], profile.aggregateBytes);
    if (measured + reserve + (edited?.byteLength ?? 0) + (temporary?.byteLength ?? 0)
      + (action === "media" ? owned?.byteLength ?? 0 : 0) > profile.aggregateBytes) return fail(); return measured;
  };
  current(); signal.addEventListener("abort", stop, { once: true });
  let idleTimer = setTimeout(stop, Math.max(0, Math.min(monotonicDeadline - performance.now(), wallDeadline - Date.now())));
  const wait = async <T>(work: () => Promise<T>, late?: (value: T) => void): Promise<T> => {
    current(); let delivered = false, result: T, cleaned = false, refused = false, rejectStop: () => void = () => undefined;
    const cleanup = () => { if (delivered && !cleaned && late) { cleaned = true; late(result); } };
    const ended = new Promise<never>((_, reject) => { rejectStop = () => { refused = true; cleanup(); reject(new Error("guest_image_result_current_unavailable")); }; waiters.add(rejectStop); });
    const pending = Promise.resolve().then(() => { current(); return work(); }).then(value => { delivered = true; result = value;
      if (refused || stopped) cleanup(); return value; });
    try { const value = await Promise.race([pending, ended]); current(); return value; }
    catch (error) { refused = true; cleanup(); stop(); throw error; }
    finally { waiters.delete(rejectStop); void pending.catch(() => undefined); }
  };
  const observe = <T>(value: T, maximum: number): T => {
    current(); const seen = new Set<object>(); let nodes = 0, strings = 0;
    const visit = (item: unknown, depth: number): void => {
      if (++nodes > 32_768 || depth > 32) return fail();
      if (item === null || item === undefined || typeof item === "boolean") return;
      if (typeof item === "number") { if (!Number.isFinite(item)) fail(); return; }
      if (typeof item === "string") { const size = bytes(item); strings += size;
        if (!item.isWellFormed() || size > maximum || strings > maximum) fail(); return; }
      if (typeof item !== "object" || seen.has(item) || (Array.isArray(item) ? Object.getPrototypeOf(item) !== Array.prototype : !record(item))) return fail();
      seen.add(item); const descriptors = Object.getOwnPropertyDescriptors(item);
      if (Reflect.ownKeys(descriptors).some(key => typeof key !== "string")) return fail();
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (Array.isArray(item) && key === "length") continue;
        strings += bytes(key); if (strings > maximum || ["__proto__", "prototype", "constructor"].includes(key)
          || !descriptor.enumerable || !Object.hasOwn(descriptor, "value") || Array.isArray(item) && !/^(0|[1-9]\d*)$/u.test(key)) return fail();
        visit(descriptor.value, depth + 1);
      }
      if (Array.isArray(item) && (item.length > (action === "adopt" ? 512 : action === "edit" ? 423 : 256) || Object.keys(item).length !== item.length)) return fail();
    };
    visit(value, 0);
    const originalSize = measureCurrentRetained(value, profile.aggregateBytes);
    // Both original and detached envelopes coexist. Descriptor validation also
    // retains per visited slot: a 4-property descriptor (value + three flags),
    // a 2-slot Object.entries pair, entries/key-array slots, and seen-set slot.
    // Key characters and JSON/UTF-8 encoding scratch are bounded separately
    // by the admitted envelope size. These are finite logical reservations.
    const reflectionSlot = (64 + 4 * 16 + 2 * (5 + 8 + 10 + 12) + 3 * 16 + 8) + (64 + 2 * 16) + 2 * 16 + 32;
    const size = nativeEnvelopeSize(value);
    if (size > maximum) return fail();
    const nativeScratch = 2 * originalSize + nodes * reflectionSlot + 4 * size;
    nativeCaptureScratch = nativeScratch;
    accounting(null, retainedBytes + canonicalRetainedBytes + witnessRetainedBytes + activeSqlBytes + nativeScratch);
    const detached = structuredClone(value); resultBytes += size;
    // Cumulative envelope traffic is distinct from retained logical memory.
    if (size > maximum || resultBytes > profile.statements * nativeEnvelopeBytes + 512 * 804) return fail();
    if (phase === "canonical") {
      canonicalRetainedBytes += originalSize;
      accounting(null, canonicalRetainedBytes + activeSqlBytes + nativeScratch);
    }
    return detached;
  };
  type Statement = { native: D1PreparedStatement; sql: string; values: Array<string | number | null> };
  const statements = new WeakMap<object, Statement>();
  // Exact already-emitted statements, not interpretation of opaque guards.
  const versionSql = `SELECT instance_nonce,generation AS epoch,
      COALESCE((SELECT generation FROM scene_source_generations WHERE scope_kind='stream' AND scope_key=?),0) AS stream_generation
      FROM scene_source_epoch WHERE singleton=1 AND schema_version=1`;
  const totalsSql = `SELECT * FROM (WITH source AS (SELECT e.*,p.owner_id private_owner,p.project_id private_project,p.document_id private_document,p.private_json,p.redacted_at private_redacted
  FROM events e LEFT JOIN event_private_payloads p ON p.private_event_id=e.event_id WHERE e.stream_id=?) SELECT COUNT(*) AS count,COALESCE(MAX(sequence),0) AS head,
    COALESCE(SUM(length(CAST(payload AS BLOB))+COALESCE(length(CAST(private_json AS BLOB)),0)),0) AS raw_bytes FROM source)`;
  const captureWriterWitness = (queries: readonly Statement[], results: unknown[]) => {
    if (action === "current" || phase !== "witness") return;
    for (let i = 0; i < queries.length; i++) {
      const query = queries[i]!, result = results[i];
      if (query.sql !== versionSql && query.sql !== totalsSql) continue;
      if (!record(result) || result.success !== true || result.error !== undefined || !Array.isArray(result.results) || result.results.length !== 1
        || query.values.length !== 1 || typeof query.values[0] !== "string") return fail();
      const value = result.results[0]; if (!record(value)) return fail();
      const integer = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
      if (query.sql === versionSql) {
        if (capturedVersion || !exactKeys(value, ["instance_nonce", "epoch", "stream_generation"])
          || typeof value.instance_nonce !== "string" || !/^[a-f0-9]{32}$/u.test(value.instance_nonce)
          || !integer(value.epoch) || value.epoch < 1 || value.epoch >= SCENE_SOURCE_GENERATION_MAX
          || !integer(value.stream_generation) || value.stream_generation >= SCENE_SOURCE_GENERATION_MAX) return fail();
        capturedVersion = freeze({ streamId: query.values[0], instanceNonce: value.instance_nonce, epoch: value.epoch,
          streamGeneration: value.stream_generation, projectGeneration: 0 });
      } else {
        if (capturedTotals || !capturedVersion || capturedVersion.streamId !== query.values[0] || !exactKeys(value, ["count", "head", "raw_bytes"])
          || !integer(value.count) || !integer(value.head) || !integer(value.raw_bytes)) return fail();
        capturedTotals = freeze({ count: value.count, head: value.head, raw_bytes: value.raw_bytes });
      }
    }
  };
  const retainWitness = (queries: readonly Statement[], result: unknown[]) => {
    if (phase !== "witness") return;
    if (witnessReads === queries.length) {
      // Initial scene-source schema/version guard family; the final compact
      // group keeps its SQL/bindings and three fixed assertion records.
      witnessRetainedBytes += 2 * measureCurrentRetained(queries.map(query => ({ sql: query.sql, bindings: query.values })));
    }
    for (let index = 0; index < queries.length; index++) {
      const sql = queries[index]!.sql, envelope = result[index];
      if (!record(envelope) || !Array.isArray(envelope.results)) return fail();
      if (sql.includes("page AS MATERIALIZED")) {
        for (const cell of envelope.results) {
          if (!record(cell) || typeof cell.witness !== "string" || ++witnessEvents > 50_000) return fail();
          // generated-image-witness eventFields: 18 scalar fields, at most
          // sixteen strings and two numbers. JSON supplies all key/character
          // bytes; record/property/string headers and array slot add 784.
          witnessRetainedBytes += 2 * cell.witness.length + 784;
        }
      } else if (sql.startsWith("SELECT CASE WHEN") && sql.includes(" AS witness FROM artifact_revisions")) {
        if (envelope.results.length !== 1) return fail(); const cell = envelope.results[0];
        if (!record(cell) || typeof cell.witness !== "string" || ++witnessRevisions > 128) return fail();
        // revisionFields has fourteen scalars: at most thirteen strings and
        // one number. Parsed row + array slot adds 632. The exact witness text
        // is also in the un-compacted guard and its compact bindings (2 copies
        // under the logical string meter), hence six times its UTF-16 length.
        witnessRetainedBytes += 6 * cell.witness.length + 632 + 2 * 24;
        // Each compact group contains <=8 predicates. Three balanced joining
        // levels plus the original and final SQL coexist conservatively; each
        // predicate is this fixed SELECT expression with <=128 framing chars.
        const guardSql = sql.length + 128;
        witnessRetainedBytes += 5 * (24 + 2 * guardSql) + measureCurrentRetained(queries[index]!.values)
          + 2 * (64 + 3 * 16) + 2 * (64 + 6 * 16);
      } else if (sql.includes(" AS body_bytes FROM artifact_revisions")) {
        // The helper keeps this exact two-column roster while reading bodies.
        witnessRetainedBytes += measureCurrentRetained(envelope.results);
      }
    }
    accounting(null, canonicalRetainedBytes + witnessRetainedBytes + activeSqlBytes + nativeCaptureScratch);
  };
  const charge = (queries: readonly Statement[]) => {
    current(); totalReads += queries.length; if (totalReads > profile.statements) return fail();
    if (phase === "canonical") { canonicalReads += queries.length; if (canonicalReads > prefixLength + (action === "draft" ? 27 : action === "adopt" || action === "media" ? 16 : 17)) return fail(); }
    else if (phase === "witness") { if (queries.length !== witnessReservation) return fail(); witnessReservation = 0;
      witnessReads += queries.length; if (witnessReads > profile.witnessStatements) return fail(); }
    else if (phase !== "before" && phase !== "final" && phase !== "edit-proof" && phase !== "publish") return fail();
    const sqlRoots = queries.map(query => ({ sql: query.sql, bindings: query.values }));
    activeSqlBytes = 2 * measureCurrentRetained(sqlRoots, profile.aggregateBytes);
    for (const query of queries) { const bound = bytes(JSON.stringify(query.values)); if (bound > nativeEnvelopeBytes) return fail();
      requestBytes += bytes(query.sql) + bound; activeSqlBytes += 4 * bound; }
    accounting(null, retainedBytes + canonicalRetainedBytes + witnessRetainedBytes + activeSqlBytes);
    if (requestBytes > profile.statements * (100_000 + nativeEnvelopeBytes)) return fail();
  };
  const wrap = (statement: D1PreparedStatement, sql: string, values: Array<string | number | null> = []): D1PreparedStatement => {
    const query: Statement = { native: statement, sql, values };
    const wrapped = {
      bind: (...input: unknown[]) => {
        current(); if (input.length > 100 || input.some(value => value !== null && typeof value !== "number" && typeof value !== "string"
          || typeof value === "number" && !Number.isFinite(value) || typeof value === "string" && bytes(value) > nativeEnvelopeBytes)) return fail();
        return wrap(statement.bind(...input), sql, input as Array<string | number | null>);
      },
      first: (...args: unknown[]) => { if (phase !== "canonical") return fail(); charge([query]);
        return wait(() => Reflect.apply(statement.first, statement, args)).then(value => {
          const result = observe(value, nativeEnvelopeBytes); activeSqlBytes = 0; nativeCaptureScratch = 0; return result; }); },
      all: (...args: unknown[]) => { if (phase !== "canonical") return fail(); charge([query]);
        return wait(() => Reflect.apply(statement.all, statement, args)).then(value => {
          const result = observe(value, nativeEnvelopeBytes); activeSqlBytes = 0; nativeCaptureScratch = 0; return result; }); },
      raw: fail, run: fail,
    } as unknown as D1PreparedStatement;
    statements.set(wrapped, query); return wrapped;
  };
  const boundedDb = {
    prepare: (sql: string) => {
      current(); if (typeof sql !== "string" || bytes(sql) > 100_000) return fail();
      // Only the unchanged named witness emits this CTE family. Wrapping its
      // SELECT preserves the receipt profile's strict parser unchanged.
      const admitted = phase === "witness" && /^WITH source AS \(SELECT e\.\*,p\.owner_id private_owner,/u.test(sql)
        ? `SELECT * FROM (${sql})` : sql;
      if (bytes(admitted) > 100_000 || !readOnlySql(admitted)) return fail(); return wrap(db.prepare(admitted), admitted);
    },
    batch: (queries: D1PreparedStatement[]) => {
      current(); if (!Array.isArray(queries) || !queries.length || queries.length > profile.boundaryStatements) return fail();
      if (phase === "canonical") { if (memoryBatchUsed || queries.length !== 3) return fail(); memoryBatchUsed = true; }
      else if (phase === "witness") { if (queries.length !== witnessReservation || queries.length > profile.witnessGuardStatements) return fail(); }
      else if (phase === "before" || phase === "final" || phase === "edit-proof") { if (!proofIdentity || queries.length !== proofIdentity.length) return fail(); }
      else return fail();
      const original = queries.map(query => statements.get(query) ?? fail()); charge(original);
      const perResult = phase === "before" || phase === "final" || phase === "edit-proof" ? profile.guardEnvelopeBytes : nativeEnvelopeBytes;
      return wait(() => db.batch(original.map(query => query.native))).then(value => {
        const result = observe(value, queries.length * perResult + 512);
        if (!Array.isArray(result) || result.length !== queries.length || result.some(item => nativeEnvelopeSize(item) > perResult)) return fail();
        captureWriterWitness(original, result); retainWitness(original, result);
        activeSqlBytes = 0; nativeCaptureScratch = 0;
        return result;
      });
    }, exec: fail, dump: fail, withSession: fail,
  } as unknown as WorkerEnv["DB"];
  const readEnv = new Proxy(env, { get(target, key, receiver) { current(); return key === "DB" ? boundedDb : Reflect.get(target, key, receiver); },
    set: fail, defineProperty: fail, deleteProperty: fail });
  const prove = async (parts: readonly Proof[], boundary: "before" | "final") => {
    current(); if (boundary === "before") {
      if (phase !== "qualify" || beforeUsed || !memoryBatchUsed || parts.length < 1 || parts.length > 3 * prefixLength + 27 + 3 + 131 + 1) return fail();
      beforeUsed = true; proofIdentity = parts;
    } else { if (phase !== "head" || !beforeUsed || finalUsed || parts !== proofIdentity) return fail(); finalUsed = true; }
    phase = boundary;
    const results = await boundedDb.batch(parts.map(proof => boundedDb.prepare(`SELECT 1 AS current WHERE ${proof.sql}`).bind(...proof.bindings)));
    current(); if (!imageWitnessAcknowledged(results, parts.length)) return fail();
    phase = boundary === "before" ? action === "draft" || action === "inputs" ? "head" : "get" : "returned";
  };
  let nativeGet: unknown, nativeHead: unknown, nativePut: unknown;
  try {
    if (action !== "draft" && action !== "inputs") {
      nativeGet = Reflect.get(bucket, "get", bucket); nativeHead = Reflect.get(bucket, "head", bucket);
      if (action === "edit") nativePut = Reflect.get(bucket, "put", bucket);
      if (typeof nativeGet !== "function" || typeof nativeHead !== "function" || action === "edit" && typeof nativePut !== "function") return fail();
    }
    current();
  } catch (error) { stop(); clearTimeout(idleTimer); signal.removeEventListener("abort", stop); throw error; }
  return {
    db: boundedDb, env: readEnv, origin: origin.origin, current, wait, text: body, monotonicDeadline, wallDeadline,
    action, checkOperation,
    prefix(n: number) { current(); if (phase !== "canonical" || !Number.isSafeInteger(n) || n < 3 || n > 16) return fail(); prefixLength = n;
      if (canonicalReads > prefixLength + (action === "draft" ? 27 : action === "adopt" || action === "media" ? 16 : 17)) return fail(); },
    beginWitness(roots: unknown) { current(); if (phase !== "canonical" || !memoryBatchUsed) return fail();
      canonicalRetainedBytes = accounting(roots); phase = "witness";
      // Version assertion/COUNT guards and their <=3 compact records are a
      // fixed source family. Retain their actual SELECTs in the first batch;
      // this reservation also covers the two accumulating array headers.
      witnessRetainedBytes = 2 * 64; },
    reserveWitness(n: number) { current(); if (phase !== "witness" || witnessReservation || !Number.isSafeInteger(n) || n < 1
      || n > profile.witnessGuardStatements || witnessReads + n > profile.witnessStatements) return fail(); witnessReservation = n; },
    endWitness(actual: number) { current(); if (phase !== "witness" || witnessReservation || actual !== witnessReads) return fail(); phase = "qualify"; },
    accounting, account: accounting,
    retain(value: CurrentDisclosure) { current(); if (phase !== "qualify" || action === "current" && requiredExpiresAt !== null) return fail();
      const expiry = Date.parse(value.expiresAt);
      if (!Number.isSafeInteger(expiry) || new Date(expiry).toISOString() !== value.expiresAt || expiry <= Date.now()) return fail();
      requiredExpiresAt = Math.min(requiredExpiresAt ?? expiry, expiry);
      // Narrow this same owner's lifetime; never create a new deadline after
      // qualification. Both full SQL batches still check live DB-now clocks.
      clearTimeout(idleTimer);
      idleTimer = setTimeout(stop, Math.max(0, Math.min(monotonicDeadline - performance.now(), wallDeadline - Date.now(), requiredExpiresAt - Date.now())));
      canonicalRetainedBytes = 0; witnessRetainedBytes = 0;
      retainedBytes = measureCurrentRetained([ownerData(), value]); current(); },
    retainMedia(value: unknown) { current(); if (phase !== "inspect" && phase !== "head") return fail();
      retainedBytes = measureCurrentRetained([ownerData(), value]); },
    prove,
    get(key: string) { current(); if (phase !== "get" || !beforeUsed || owned) return fail(); phase = "inspect";
      if (action !== "current" && (++nativeCalls > (action === "adopt" ? 2 : CLAIMED_EDIT_PROFILE.nativeCalls) || ++bodyStreams > CLAIMED_EDIT_PROFILE.bodyStreams)) return fail();
      return wait(() => Promise.resolve(Reflect.apply(nativeGet as (...args: unknown[]) => unknown, bucket, [key])), currentCancelObject); },
    metadata(size: number) { current(); if (phase !== "inspect" && phase !== "head" && !(action === "edit" && ["ordinary", "put", "destination"].includes(phase)) || !Number.isSafeInteger(size) || size < 0
      || ++metadataCaptures > profile.metadataCaptures || (metadataBytes += size) > profile.metadataBytes) return fail(); },
    stream() { current(); if (phase !== "inspect" && !(action === "edit" && ["request", "ordinary", "destination"].includes(phase)) && !(action === "adopt" && phase === "adopt-command")
      || ++streamReads > profile.streamReads) return fail(); },
    own(size: number) { current(); if (phase !== "inspect" || owned || !Number.isSafeInteger(size) || size < 1 || size > MAX_OUTPUT_ASSET_BYTES
      || retainedBytes + size + profile.inspectorScratchBytes > profile.aggregateBytes) return fail();
      owned = new Uint8Array(size); return owned; },
    use<T>(value: Uint8Array<ArrayBuffer>, work: () => Promise<T>): Promise<T> {
      current(); if (phase !== "inspect" || value !== owned) return fail();
      return wait(() => { users++; let pending: Promise<T>;
        try { pending = Promise.resolve(work()); } catch (error) { users--; if (stopped) retire(); throw error; }
        return pending.finally(() => { users--; if (stopped) retire(); }); });
    },
    head(key: string) { current(); if (phase !== "inspect" || !owned || users) return fail(); phase = "head";
      if (action !== "current" && ++nativeCalls > (action === "adopt" ? 2 : CLAIMED_EDIT_PROFILE.nativeCalls)) return fail();
      return wait(() => Promise.resolve(Reflect.apply(nativeHead as (...args: unknown[]) => unknown, bucket, [key]))); },
    release() { current(); if (phase !== "head" || users) return fail(); if (action !== "media") retire(); },
    absentReturned() { current(); if (action !== "draft" || phase !== "canonical" || owned || edited || temporary) return fail(); phase = "returned"; finalUsed = true; },
    imageResponse() {
      current(); if (action !== "media" || phase !== "returned" || !finalUsed || !owned || users || edited || temporary) return fail();
      phase = "response"; const length = owned.length; let offset = 0, controller: ReadableStreamDefaultController<Uint8Array> | null = null;
      accounting(null, retainedBytes + CLAIMED_PERSONAL_MEDIA_PROFILE.responseChunkBytes);
      const cancel = () => { try { controller?.error(new Error("claimed_image_media_unavailable")); } catch { /* Already closed. */ }
        clearTimeout(idleTimer); signal.removeEventListener("abort", stop); };
      if (cancellations.size >= 4) return fail(); cancellations.add(cancel);
      const stream = new ReadableStream<Uint8Array>({
        start(value) { controller = value; },
        pull(value) {
          try {
            current(); if (phase !== "response" || !owned || users || offset >= length) return fail();
            const size = Math.min(CLAIMED_PERSONAL_MEDIA_PROFILE.responseChunkBytes, length - offset);
            accounting(null, retainedBytes + size);
            const chunk = new Uint8Array(size);
            for (let index = 0; index < size; index++) chunk[index] = owned[offset + index]!;
            current(); value.enqueue(chunk); offset += size;
            if (offset === length) { value.close(); cancellations.delete(cancel); stop(); clearTimeout(idleTimer); signal.removeEventListener("abort", stop); }
          } catch (error) { try { value.error(error); } catch { /* Already terminated. */ } stop(); }
        },
        cancel() { cancellations.delete(cancel); stop(); clearTimeout(idleTimer); signal.removeEventListener("abort", stop); },
      }, { highWaterMark: 0 });
      current();
      const response = markGuestImagePersonalResponse(new Response(stream, { status: 200, headers: {
        "content-type": "image/png", "content-length": String(length), "content-security-policy": "default-src 'none'; sandbox",
        "cache-control": "private, no-store", "x-content-type-options": "nosniff",
        vary: "Cookie, oai-authenticated-user-id, oai-authenticated-user-email",
      } }));
      current(); return response;
    },
    onCancel(cancel: () => void) { current(); if (cancellations.size >= 4) return fail(); cancellations.add(cancel); return () => cancellations.delete(cancel); },
    beginAdoptionCommand() { current(); if (action !== "adopt" || phase !== "adopt-command" || bodyStarted) return fail();
      bodyStarted = true; return requestBody ?? fail(); },
    endAdoptionCommand(command: unknown) { current(); if (action !== "adopt" || phase !== "adopt-command" || !bodyStarted) return fail();
      accounting(command, 2 * CLAIMED_LOCAL_ADOPTION_PROFILE.commandBytes); phase = "canonical"; },
    writerWitness(eventCount: number, head: number, eventBytes: number) {
      current(); if (action === "current" || phase !== "qualify" || !capturedVersion || !capturedTotals
        || capturedTotals.count !== eventCount || capturedTotals.head !== head || capturedTotals.raw_bytes !== eventBytes) return fail();
      return freeze({ version: capturedVersion, totals: capturedTotals });
    },
    beginRequest() { current(); if (action !== "edit" || phase !== "head" || owned || bodyStarted || readbackUsed) return fail();
      phase = "request"; bodyStarted = true;
      if (++bodyStreams > CLAIMED_EDIT_PROFILE.bodyStreams) return fail(); return requestBody ?? fail(); },
    multipartAccounting(roots: unknown, wireBytes: number, fileBytes = 0, chunks = 0) {
      current(); if (action !== "edit" || phase !== "request" || !Number.isSafeInteger(wireBytes) || wireBytes < 0
        || wireBytes > CLAIMED_EDIT_PROFILE.wireBytes || !Number.isSafeInteger(fileBytes) || fileBytes < 0 || fileBytes > MAX_OUTPUT_ASSET_BYTES || !Number.isSafeInteger(chunks) || chunks < 0 || chunks > 65_536) return fail();
      // One wire owner plus native Response representation; accepted File and
      // its eventual ArrayBuffer coexist only inside the retiring parser frame.
      accounting(roots, retainedBytes + 2 * wireBytes + 2 * fileBytes + 64 + chunks * (64 + 64 + 16));
    },
    binary(size: number) { current(); if (action === "current" || !Number.isSafeInteger(size) || size < 1
      || (binaryBytes += size) > CLAIMED_EDIT_PROFILE.binaryBytes) return fail(); },
    acceptEdited(value: Uint8Array<ArrayBuffer>, roots: unknown) {
      current(); if (action !== "edit" || phase !== "request" || edited || owned || temporary
        || value.length < 1 || value.length > MAX_OUTPUT_ASSET_BYTES) return fail();
      edited = value; phase = "edit-qualify"; retainedBytes = measureCurrentRetained([ownerData(), roots]);
    },
    retainEdit(roots: unknown, expiresAt?: string) {
      current(); if (action !== "edit" || !["edit-qualify", "edited-inspect", "ordinary", "put", "destination"].includes(phase)) return fail();
      if (expiresAt !== undefined) {
        const expiry = Date.parse(expiresAt);
        if (!Number.isSafeInteger(expiry) || new Date(expiry).toISOString() !== expiresAt || expiry <= Date.now()) return fail();
        requiredExpiresAt = Math.min(requiredExpiresAt ?? expiry, expiry); clearTimeout(idleTimer);
        idleTimer = setTimeout(stop, Math.max(0, Math.min(monotonicDeadline - performance.now(), wallDeadline - Date.now(), requiredExpiresAt - Date.now())));
      }
      retainedBytes = measureCurrentRetained([ownerData(), roots]); current();
    },
    async inspectEdited(expected: Readonly<{ sha256: string; width: number; height: number; byteLength: number }>) {
      current(); if (action !== "edit" || phase !== "edit-qualify" || !edited || editedUsers || owned || temporary
        || retainedBytes + edited.length + profile.inspectorScratchBytes > profile.aggregateBytes) return fail();
      phase = "edited-inspect"; const value = edited;
      if (value.length < 8 || [137, 80, 78, 71, 13, 10, 26, 10].some((n, i) => value[i] !== n)) return fail();
      const inspected = await wait(() => { editedUsers++;
        return inspectOutputAsset(value, "image.png", { snapshot: false }).finally(() => { editedUsers--; if (stopped) retire(); }); });
      current(); if (inspected.status !== "inspected" || inspected.kind !== "image" || inspected.mimeType !== "image/png" || inspected.extension !== "png"
        || inspected.byteLength !== expected.byteLength || inspected.sha256 !== expected.sha256
        || inspected.facts.width !== expected.width || inspected.facts.height !== expected.height) return fail();
      phase = "ordinary";
    },
    ordinaryGet(key: string) { current(); if (action !== "edit" || phase !== "ordinary" || temporary || !edited
      || ++ordinarySources > CLAIMED_EDIT_PROFILE.ordinarySources || ++nativeCalls > CLAIMED_EDIT_PROFILE.nativeCalls
      || ++bodyStreams > CLAIMED_EDIT_PROFILE.bodyStreams) return fail();
      return wait(() => Promise.resolve(Reflect.apply(nativeGet as (...args: unknown[]) => unknown, bucket, [key])), currentCancelObject); },
    ownTemporary(size: number) { current(); if (action !== "edit" || !["ordinary", "destination"].includes(phase) || temporary || !edited
      || !Number.isSafeInteger(size) || size < 1 || size > MAX_OUTPUT_ASSET_BYTES
      || retainedBytes + edited.length + 2 * size > profile.aggregateBytes) return fail();
      temporary = new Uint8Array(size); return temporary; },
    useTemporary<T>(value: Uint8Array<ArrayBuffer>, work: () => Promise<T>): Promise<T> {
      current(); if (action !== "edit" || phase !== "ordinary" || value !== temporary) return fail();
      return wait(() => { temporaryUsers++; let pending: Promise<T>;
        try { pending = Promise.resolve(work()); } catch (error) { temporaryUsers--; if (stopped) retire(); throw error; }
        return pending.finally(() => { temporaryUsers--; if (stopped) retire(); }); });
    },
    releaseTemporary(value: Uint8Array<ArrayBuffer>) {
      current(); if (action !== "edit" || value !== temporary || temporaryUsers) return fail(); Reflect.apply(currentFill, value, [0]); temporary = null;
    },
    async proveEdit(parts: readonly Proof[]) {
      current(); if (action !== "edit" || phase !== "ordinary" || !edited || temporary || editedUsers || parts.length < 1 || parts.length > 210) return fail();
      phase = "edit-proof"; proofIdentity = parts;
      const result = await boundedDb.batch(parts.map(proof => boundedDb.prepare(`SELECT 1 AS current WHERE ${proof.sql}`).bind(...proof.bindings)));
      current(); if (!imageWitnessAcknowledged(result, parts.length)) return fail(); phase = "ordinary";
    },
    async put(key: string, metadata: Readonly<Record<string, string>>, requiredRemainingStatements: number): Promise<unknown> {
      current(); if (action !== "edit" || phase !== "ordinary" || !edited || temporary || editedUsers || writing || publishing
        || !Number.isSafeInteger(requiredRemainingStatements) || requiredRemainingStatements < 1
        || totalReads + requiredRemainingStatements > CLAIMED_EDIT_PROFILE.statements || ++nativeCalls > CLAIMED_EDIT_PROFILE.nativeCalls) return fail();
      phase = "put"; writing = true; const value = edited;
      // This owner keeps the same immutable buffer until the REAL native call
      // settles, including when its request deadline has already rejected wait.
      return wait(() => { editedUsers++; let pending: Promise<unknown>;
        try { pending = Promise.resolve(Reflect.apply(nativePut as (...args: unknown[]) => unknown, bucket,
          [key, value.buffer, { onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType: "image/png" }, customMetadata: metadata }])); }
        catch (error) { editedUsers--; if (stopped) retire(); throw error; }
        return pending.finally(() => { editedUsers--; if (stopped) retire(); }); });
    },
    destinationGet(key: string) { current(); if (action !== "edit" || phase !== "put" || !writing || !edited || editedUsers || temporary
      || ++nativeCalls > CLAIMED_EDIT_PROFILE.nativeCalls || ++bodyStreams > CLAIMED_EDIT_PROFILE.bodyStreams) return fail();
      phase = "destination";
      return wait(() => Promise.resolve(Reflect.apply(nativeGet as (...args: unknown[]) => unknown, bucket, [key])), currentCancelObject); },
    destinationHead(key: string) { current(); if (action !== "edit" || phase !== "destination" || !edited || editedUsers || temporary
      || ++nativeCalls > CLAIMED_EDIT_PROFILE.nativeCalls) return fail();
      return wait(() => Promise.resolve(Reflect.apply(nativeHead as (...args: unknown[]) => unknown, bucket, [key]))); },
    compareDestinationChunk(value: Uint8Array<ArrayBuffer>, offset: number) {
      current(); if (action !== "edit" || phase !== "destination" || !edited || !Number.isSafeInteger(offset) || offset < 0
        || value.length < 1 || value.length > edited.length - offset) return fail();
      accounting(null, retainedBytes + value.length);
      for (let i = 0; i < value.length; i++) if (value[i] !== edited[offset + i]) return fail();
    },
    releaseEdited() { current(); if (action !== "edit" || !edited || editedUsers || temporary || !["edit-qualify", "ordinary", "destination"].includes(phase)) return fail();
      Reflect.apply(currentFill, edited, [0]); edited = null; },
    async publish(plan: ClaimedEditPublication): Promise<boolean> {
      current(); if (action !== "edit" || phase !== "destination" || !writing || publishing || edited || temporary || owned
        || plan.before.length < 1 || plan.before.length > 210 || plan.after.length < 1 || plan.after.length > 210
        || plan.rows.length < 1 || plan.rows.length > 2) return fail();
      publishing = true; phase = "publish";
      const bindings = eventWriteBindings(plan.event);
      if (typeof bindings[16] !== "string") return fail();
      const proof = (value: Proof): Statement => {
        const sql = `SELECT CASE WHEN (${value.sql}) THEN 1 ELSE json('claimed_image_edit_changed') END AS current`;
        return { native: db.prepare(sql).bind(...value.bindings), sql, values: [...value.bindings] };
      };
      const eventSql = `INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) VALUES(${bindings.map(() => "?").join(",")})`;
      const inserts: Statement[] = [{ native: db.prepare(eventSql).bind(...bindings), sql: eventSql, values: bindings }];
      for (const row of plan.rows) {
        if (!record(row) || !exactKeys(row, claimedRevisionColumns)) return fail();
        const values = claimedRevisionColumns.map(key => row[key] ?? null);
        const sql = `INSERT INTO artifact_revisions(${claimedRevisionColumns.join(",")}) VALUES(${values.map(() => "?").join(",")})`;
        inserts.push({ native: db.prepare(sql).bind(...values), sql, values });
      }
      const batch = [...plan.before.map(proof), ...inserts, ...plan.after.map(proof)];
      if (batch.length > CLAIMED_EDIT_PROFILE.boundaryStatements) return fail(); charge(batch);
      // A settled transport failure permits the one bounded authoritative
      // readback. A deadline/abort still retires the original owner immediately.
      const observed = await wait(() => Promise.resolve().then(() => db.batch(batch.map(item => item.native)))
        .then(result => ({ ok: true as const, result }), () => ({ ok: false as const })));
      current(); if (!observed.ok) { activeSqlBytes = 0; nativeCaptureScratch = 0; return false; }
      const result = observe(observed.result, batch.length * profile.guardEnvelopeBytes + 512);
      activeSqlBytes = 0; nativeCaptureScratch = 0;
      if (!Array.isArray(result) || result.length !== batch.length || result.some(item => nativeEnvelopeSize(item) > profile.guardEnvelopeBytes)
        || !imageWitnessAcknowledged(result.slice(0, plan.before.length), plan.before.length)
        || !imageWitnessAcknowledged(result.slice(plan.before.length + inserts.length), plan.after.length)) return false;
      return result.slice(plan.before.length, plan.before.length + inserts.length).every((value, index) => {
        if (!record(value) || value.success !== true || value.error !== undefined || !record(value.meta)) return false;
        const changes = value.meta.changes;
        return typeof changes === "number" && Number.isSafeInteger(changes) && (index === 0 ? changes > 0 : changes === 1);
      });
    },
    retainAdoption(roots: unknown) { current(); if (action !== "adopt" || phase !== "head" || owned || edited || temporary) return fail();
      retainedBytes = measureCurrentRetained([ownerData(), roots]); },
    async completeAdoption(plan: ClaimedLocalAdoptionPublication): Promise<GuestImageResultLocalAdoptionPair | null> {
      current(); if (action !== "adopt" || phase !== "head" || !beforeUsed || finalUsed || publishing || owned || edited || temporary
        || plan.before.length < 1 || plan.before.length > 209 || plan.after.length < 1 || plan.after.length > 209) return fail();
      phase = "publish";
      const proof = (value: Proof): Statement => {
        const sql = `SELECT CASE WHEN (${value.sql}) THEN 1 ELSE json('claimed_image_local_source_changed') END AS current`;
        return { native: db.prepare(sql).bind(...value.bindings), sql, values: [...value.bindings] };
      };
      const expected = [plan.pair.receipt, plan.pair.block];
      const inserts: Statement[] = plan.reuse ? [] : expected.map(event => {
        const values = eventWriteBindings(event); if (typeof values[16] !== "string") return fail();
        const sql = `INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) VALUES(${values.map(() => "?").join(",")})`;
        return { native: db.prepare(sql).bind(...values), sql, values };
      });
      const readSql = `SELECT e.*,p.owner_id private_owner,p.project_id private_project,p.document_id private_document,
        p.private_json,p.redacted_at private_redacted,p.created_at private_created_at
        FROM events e JOIN event_private_payloads p ON p.private_event_id=e.event_id
        WHERE e.event_id IN (?,?) ORDER BY e.sequence`;
      const readValues = expected.map(event => event.eventId);
      const batch = [...plan.before.map(proof), ...inserts, ...(plan.reuse ? [] : plan.after.map(proof)),
        { native: db.prepare(readSql).bind(...readValues), sql: readSql, values: readValues }];
      if (batch.length > CLAIMED_LOCAL_ADOPTION_PROFILE.boundaryStatements) return fail(); charge(batch);
      publishing = true;
      const observed = await wait(() => Promise.resolve().then(() => db.batch(batch.map(item => item.native)))
        .then(result => ({ ok: true as const, result }), () => ({ ok: false as const })));
      current(); if (!observed.ok) { activeSqlBytes = 0; nativeCaptureScratch = 0; return null; }
      const result = observe(observed.result, (batch.length - 1) * profile.guardEnvelopeBytes + CLAIMED_LOCAL_ADOPTION_PROFILE.pairEnvelopeBytes + 512);
      // Native original/detached ACK and the fixed SQL frame remain live
      // until pair validation returns. Keep their charged reservation.
      try {
      if (!Array.isArray(result) || result.length !== batch.length
        || result.slice(0, -1).some(item => nativeEnvelopeSize(item) > profile.guardEnvelopeBytes)
        || nativeEnvelopeSize(result.at(-1)) > CLAIMED_LOCAL_ADOPTION_PROFILE.pairEnvelopeBytes
        || !imageWitnessAcknowledged(result.slice(0, plan.before.length), plan.before.length)
        || !plan.reuse && !imageWitnessAcknowledged(result.slice(plan.before.length + 2, -1), plan.after.length)) return null;
      for (const value of result.slice(plan.before.length, plan.before.length + inserts.length)) {
        if (!record(value) || value.success !== true || value.error !== undefined || !record(value.meta)
          || typeof value.meta.changes !== "number" || !Number.isSafeInteger(value.meta.changes) || value.meta.changes < 1) return null;
      }
      const last = result.at(-1);
      if (!record(last) || last.success !== true || last.error !== undefined || !Array.isArray(last.results) || last.results.length !== 2) return null;
      const actual: EventRow[] = [];
      for (let index = 0; index < 2; index++) {
        const wanted = expected[index]!, bindings = eventWriteBindings(wanted);
        if (typeof bindings[16] !== "string") return fail();
        const joined = eventEnvelope(wanted, bindings[16], plan.ownerId), row = last.results[index];
        if (!record(row) || !same(row, { ...joined.event, private_owner: joined.envelope.owner_id, private_project: joined.envelope.project_id,
          private_document: joined.envelope.document_id, private_json: joined.envelope.private_json, private_redacted: joined.envelope.redacted_at,
          private_created_at: joined.envelope.created_at })) return null;
        actual.push(freeze(serializeEvent(row)));
      }
      accounting([plan, result, actual], retainedBytes + activeSqlBytes + nativeCaptureScratch + adoptionPairWork(String(plan.pair.receipt.payload.media_url)));
      const pair = matchGuestImageResultLocalAdoptionPair({ receipt: actual[0], block: actual[1] }, plan.pair);
      if (!pair) return null;
      accounting([plan, result, actual, pair], retainedBytes + activeSqlBytes + nativeCaptureScratch); finalUsed = true; phase = "returned"; return pair;
      } finally { activeSqlBytes = 0; nativeCaptureScratch = 0; }
    },
    adoptionAttempted() { return action === "adopt" && publishing; },
    beginReadback() { current(); if (action !== "edit" || readbackUsed || edited || temporary || owned
      || !["edit-qualify", "ordinary", "publish"].includes(phase)) return fail();
      readbackUsed = true; phase = "canonical"; prefixLength = 16; canonicalReads = 0; witnessReads = 0; witnessReservation = 0;
      memoryBatchUsed = false; beforeUsed = false; finalUsed = false; proofIdentity = null; capturedVersion = null; capturedTotals = null;
      retainedBytes = 0; canonicalRetainedBytes = 0; witnessRetainedBytes = 0; witnessEvents = 0; witnessRevisions = 0;
    },
    unchanged() { current(); if (action !== "edit" || phase !== "ordinary" || edited || temporary || writing) return fail(); phase = "returned"; finalUsed = true; },
    writerAccounting(roots: unknown) { current(); if (action === "current") return fail();
      return accounting(roots) + (edited?.byteLength ?? 0) + (temporary?.byteLength ?? 0); },
    writeAttempted() { return writing; },
    finish() { current(); if (phase !== "returned" || !finalUsed || owned || edited || temporary) return fail(); },
    dispose() { stop(); clearTimeout(idleTimer); signal.removeEventListener("abort", stop); },
  };
}
function currentSnapshotOwner(request: Request, env: WorkerEnv, outputId: string) {
  return completedImageOwner(request, env, outputId, "current");
}
function claimedEditOwner(request: Request, env: WorkerEnv, outputId: string) {
  return completedImageOwner(request, env, outputId, request.method === "PATCH" ? "edit" : "check");
}
function claimedLocalAdoptionOwner(request: Request, env: WorkerEnv, outputId: string) {
  return completedImageOwner(request, env, outputId, "adopt");
}
type CurrentSnapshotOwner = ReturnType<typeof currentSnapshotOwner>;

type DisclosureSnapshot = Readonly<GuestImageResultMetadataSnapshot & { rawJson?: string }>;
const completeCurrentSnapshot = (value: DisclosureSnapshot): value is Readonly<GuestImageResultEditSnapshot> =>
  typeof value.rawJson === "string" && typeof value.contentSha256 === "string";
type CurrentDisclosure = Readonly<{
  snapshot: DisclosureSnapshot; parts: readonly Proof[]; mediaKey: string;
  metadata: Readonly<Record<string, string>>; expiresAt: string;
  edit?: Readonly<{ context: ClaimedImageEditContext; canonicalParts: readonly Proof[]; witnessGuards: readonly Proof[];
    revisionProofs: readonly Proof[]; scopeProof: Proof; version: SceneSourceVersion;
    totals: Readonly<{ count: number; head: number; raw_bytes: number }> }>;
  adoption?: Readonly<{ pair: GuestImageResultLocalAdoptionPair; reuse: boolean; canonicalParts: readonly Proof[];
    witnessGuards: readonly Proof[]; revisionProofs: readonly Proof[]; scopeProof: Proof;
    version: SceneSourceVersion; totals: Readonly<{ count: number; head: number; raw_bytes: number }>;
    artifactKey: string; revisionCount: number; sourceId: string; blockId: string; referenceId: string; head: number;
    selectionProof: Proof; successorRawBytes: number }>;
  personal?: Readonly<{ draftId: string; title: string; canonical: ClaimedImageLocalAdoptionFacts["canonical"];
    initialMedia: ClaimedImageLocalAdoptionFacts["initialMedia"]; originalKey: string; originalMetadata: Readonly<Record<string, string>>;
    prompt: string | null }>;
}>;
const claimedRevisionColumns = ["revision_id", "owner_id", "organization_id", "project_access_id", "project_id", "document_id", "artifact_id", "revision",
  "content_json", "content_sha256", "created_by_user_id", "created_at", "expires_at", "redacted_at"] as const;
type ClaimedLocalAdoptionPublication = Readonly<{ before: readonly Proof[]; after: readonly Proof[]; pair: GuestImageResultLocalAdoptionPair; reuse: boolean; ownerId: string }>;
type ClaimedEditPublication = Readonly<{ before: readonly Proof[]; after: readonly Proof[]; event: EventRow; rows: readonly Row[] }>;
function currentArtifactKey(outputId: string): string {
  return "generated-image/" + Array.from(new TextEncoder().encode(outputId), byte => byte.toString(16).padStart(2, "0")).join("");
}
function currentScopeProof(ownerId: string, custodyId: string, facts: ClaimedImageCurrentFacts | ClaimedImageLocalAdoptionFacts): Proof {
  const snapshot = facts.snapshot, key = facts.artifactKey;
  const urls = [snapshot.media.url, ...snapshot.sources.map(source => source.mediaUrl),
    ...facts.retained.flatMap(value => value.envelope.imageRevision ? [value.envelope.imageRevision.media.url] : [])];
  const resources = [...new Set([key, snapshot.outputId, ...urls.flatMap(url => {
    if (!url.startsWith("/api/media/")) return fail(); const raw = decodeURIComponent(url.slice("/api/media/".length));
    if (`/api/media/${encodeURIComponent(raw)}` !== url) return fail(); return [raw, url];
  }), ...facts.localContext.resourceIds])];
  const eventIds = [...new Set([...facts.retained.flatMap(value => value.event ? [value.event.eventId] : []), ...facts.localContext.eventIds])];
  return { sql: `(SELECT COUNT(*) FROM experience_guest_image_result_custodies WHERE destination_user_id=? AND output_id=?)=1
    AND EXISTS(SELECT 1 FROM experience_guest_image_result_custodies WHERE destination_user_id=? AND output_id=? AND custody_id=?)
    AND NOT EXISTS(SELECT 1 FROM artifact_revisions WHERE owner_id=? AND artifact_id IN (?,?)
      AND (organization_id IS NOT NULL OR project_access_id IS NOT NULL OR project_id<>? OR document_id<>?
        OR created_by_user_id<>? OR redacted_at IS NOT NULL OR created_at>${nowSql} OR expires_at<=${nowSql}))
    AND ?>${nowSql}
    AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_id IN(SELECT value FROM json_each(?)))
    AND NOT EXISTS(SELECT 1 FROM project_event_scopes WHERE event_id IN(SELECT value FROM json_each(?)))`,
  bindings: [ownerId, snapshot.outputId, ownerId, snapshot.outputId, custodyId, ownerId, key, snapshot.outputId,
    snapshot.projectId, snapshot.documentId, ownerId, facts.retainedExpiresAt, JSON.stringify(resources), JSON.stringify(eventIds)] };
}
async function collectCurrentDisclosure(scope: CurrentSnapshotOwner, request: Request, outputId: string): Promise<CurrentDisclosure> {
  const auth = await scope.wait(() => readExistingPrincipalRequest(request, scope.env, "creator", { account: "principal" }));
  if ("kind" in auth || auth.response || !auth.user || requireConsent(auth.user) || auth.user.fictional || auth.user.projectExecution
    || auth.user.userId.startsWith("guest:") || auth.user.streamId !== `creative:${auth.user.userId}`
    || !auth.user.access.capabilities.includes("project.author")) return fail();
  const actor = auth.user, schema = await schemas(scope), nativeSchema = await nativeTables(scope, scope.action === "edit" ? "writer" : true);
  const custody = await scope.db.prepare(`SELECT ${custodyColumns.join(",")} FROM experience_guest_image_result_custodies
    WHERE destination_user_id=? AND output_id=? AND length(CAST(lineage_json AS BLOB))<=262144
      AND (SELECT COUNT(*) FROM experience_guest_image_result_custodies WHERE destination_user_id=? AND output_id=?)=1`)
    .bind(actor.userId, outputId, actor.userId, outputId).first<Record<string, Value>>(); scope.current();
  if (!custody) return fail();
  const raw = scope.text(custody.lineage_json, 262_144), lineage = await scope.wait(() => readGuestImageResultClaimLineage(JSON.parse(raw)));
  scope.prefix(lineage.copy.manifest.sourceHead);
  const rows = await scope.wait(() => guestImageResultClaimRows(lineage));
  if (!same(custody, rows.custody) || rows.custody.output_id !== outputId || lineage.copy.destinationUserId !== actor.userId
    || scope.origin !== lineage.contextLineage.origin) return fail();
  const authority = projectIntakeAuthority(scope.env, { user: actor, principal: actor, impersonation: null },
    { projectId: lineage.copy.manifest.projectId, documentId: lineage.copy.manifest.documentId });
  if (!isCurrent(await scope.db.prepare(`SELECT 1 AS current WHERE ${authority.sql}`).bind(...authority.bindings).first())) return fail();
  const attempt = await scope.db.prepare(`SELECT ${GUEST_IMAGE_RESULT_COPY_COLUMNS.join(",")} FROM experience_guest_image_result_copy_attempts
    WHERE attempt_id=? AND state='published' AND length(CAST(descriptor_json AS BLOB))<=65536 AND length(CAST(lease_snapshot_json AS BLOB))<=65536
      AND length(CAST(destination_metadata_json AS BLOB))<=8192`).bind(lineage.copy.attemptId).first<GuestImageResultCopyAttemptRow>(); scope.current();
  if (!attempt) return fail();
  const privateEvent = async (id: string) => {
    const row = await scope.db.prepare(`SELECT private_json FROM event_private_payloads WHERE private_event_id=? AND owner_id=?
      AND redacted_at IS NULL AND length(CAST(private_json AS BLOB)) BETWEEN 1 AND 65536`).bind(id, actor.userId).first<{ private_json: string }>();
    scope.current(); return scope.text(row?.private_json, 65_536);
  };
  const prefixBodies: string[] = [];
  for (const target of lineage.contextLineage.events) prefixBodies.push(await privateEvent(target.id));
  const saveBody = await privateEvent(lineage.saveLineage.target.id), claimBody = await privateEvent(lineage.canonical.eventId);
  const plannerCopy = lineage.resultCopies[0];
  const planner = await scope.db.prepare(`SELECT content FROM private_content WHERE content_id=? AND owner_id=? AND kind='guest-image-result-history'
    AND redacted_at IS NULL AND created_at<=${nowSql} AND expires_at>${nowSql} AND length(CAST(content AS BLOB)) BETWEEN 1 AND 65536`)
    .bind(plannerCopy.content_id, actor.userId).first<{ content: string }>(); scope.current();
  const rawJson = scope.text(planner?.content, 65_536);
  const graph = await scope.wait(() => construct({ lineage, publishedAttempt: attempt, prefixBodies, saveBody, claimBody, resultBodies: [rawJson] }, false, "planner"));
  const exclusions = await memory(scope, graph.afterGraph), canonicalParts = [schema, nativeSchema, authority, ...graph.parts, ...exclusions];
  // These bindings remain in this function's frame throughout qualification;
  // do not pretend a const local has retired merely because it was last read.
  const canonicalRoots = [auth, actor, schema, nativeSchema, custody, raw, lineage, rows, authority, attempt,
    prefixBodies, saveBody, claimBody, plannerCopy, planner, rawJson, graph, exclusions, canonicalParts];
  scope.beginWitness(canonicalRoots);
  const witness = await readImageWitness(scope.env, actor.streamId, actor.userId, currentArtifactKey(outputId), outputId,
    { check: scope.current, sql: scope.reserveWitness, wait: pending => scope.wait(() => pending) });
  scope.endWitness(witness.queryCount);
  const eventRows = freeze(witness.eventRows), revisionRows = freeze(witness.revisionRows);
  const events: EventRow[] = [];
  const witnessAccounting = { eventCount: witness.eventCount, head: witness.head, guards: witness.guards,
    eventBytes: witness.eventBytes, reads: witness.reads, queryCount: witness.queryCount };
  const capturedBytes = scope.accounting([canonicalRoots, witnessAccounting, eventRows, revisionRows]);
  let serializedBytes = 64;
  for (const value of eventRows) {
    if (!record(value) || value.stream_id !== actor.streamId || typeof value.event_id !== "string"
      || value.private_json !== null && (value.private_owner !== actor.userId || typeof value.private_json !== "string")) return fail();
    const event = freeze(serializeEvent({ ...value, private_json: value.private_redacted === null ? value.private_json : null }));
    serializedBytes += 16 + measureCurrentRetained(event, CURRENT_SNAPSHOT_PROFILE.aggregateBytes);
    scope.accounting(null, capturedBytes + serializedBytes); events.push(event);
  }
  freeze(events);
  const outsideRetainedBytes = scope.accounting([canonicalRoots, witnessAccounting]);
  const read = freeze({ ownerId: actor.userId, projectId: lineage.copy.manifest.projectId, documentId: lineage.copy.manifest.documentId,
    outputId, events, head: witness.head, planner: { contentRef: plannerCopy.content_id, rawJson, expiresAt: plannerCopy.expires_at, claim: graph.completedReview } });
  const facts = await scope.wait(() => qualifyClaimedImageCurrent({ read,
    eventRows, revisionRows, monotonicDeadline: scope.monotonicDeadline, wallDeadline: scope.wallDeadline, outsideRetainedBytes,
  })); scope.current();
  const claimPairs = graph.afterGraph.eventEnvelopes.filter(pair => pair.event.event_id === graph.completedReview.claimEventId);
  if (claimPairs.length !== 1) return fail();
  const provedClaim = freeze(serializeEvent({ ...claimPairs[0]!.event, private_json: claimPairs[0]!.envelope.private_json }));
  // Join every header and the complete 29-field payload to the independently
  // reconstructed graph/privateDigest; a source counter alone is not this join.
  if (!same(facts.canonical, provedClaim)) return fail();
  const metadata: Readonly<Record<string, string>> = facts.snapshot.revision === 0 ? lineage.copy.destinationMetadata
    : facts.derivativeMetadata ?? fail();
  const scopeProof = currentScopeProof(actor.userId, lineage.copy.custodyId, facts);
  let edit: CurrentDisclosure["edit"];
  if (scope.action !== "current") {
    const native = scope.writerWitness(witness.eventCount, witness.head, witness.eventBytes);
    const context = await scope.wait(() => prepareClaimedImageEditContext({ read, eventRows, facts,
      monotonicDeadline: scope.monotonicDeadline, wallDeadline: scope.wallDeadline,
      outsideRetainedBytes: scope.accounting([canonicalRoots, witnessAccounting, revisionRows, claimPairs, provedClaim, metadata, scopeProof, native]),
    }));
    let eventJsonBytes = 2;
    for (const row of eventRows) { scope.current(); eventJsonBytes += claimedImageEditEventCellBytes(row) + 1; }
    if (context.eventJsonBytes !== eventJsonBytes || context.eventCount !== witness.eventCount || context.eventBytes !== witness.eventBytes || context.revisionCount !== revisionRows.length
      || context.revisionBytes !== revisionRows.reduce((sum, row) => sum + bytes(String(row.content_json)), 0)) return fail();
    const revisionProofs = revisionRows.map(row => {
      if (!record(row) || !exactKeys(row, claimedRevisionColumns) || claimedRevisionColumns.some(key => row[key] !== null && typeof row[key] !== "string" && typeof row[key] !== "number")) return fail();
      return exact("artifact_revisions", row as Row);
    });
    edit = freeze({ context, canonicalParts, witnessGuards: witness.guards, revisionProofs, scopeProof, ...native });
  }
  const compact: CurrentDisclosure = freeze({ snapshot: edit ? edit.context.snapshot : facts.snapshot,
    parts: [...canonicalParts, ...witness.guards, scopeProof],
    mediaKey: decodeURIComponent(facts.snapshot.media.url.slice("/api/media/".length)), metadata, expiresAt: facts.retainedExpiresAt,
    ...(edit ? { edit } : {}),
  });
  // No event/revision arrays or parsed lineage are retained by the returned
  // disclosure. All exact predicates survive in their bounded bindings.
  scope.accounting([canonicalRoots, witnessAccounting, eventRows, revisionRows, events, read, facts, claimPairs, provedClaim, metadata, compact]);
  measureCurrentRetained(compact); return compact;
}

async function collectLocalAdoptionDisclosure(scope: CurrentSnapshotOwner, request: Request, outputId: string, command: GuestImageResultLocalAdoptionCommand): Promise<CurrentDisclosure> {
  const auth = await scope.wait(() => readExistingPrincipalRequest(request, scope.env, "creator", { account: "principal" }));
  if ("kind" in auth || auth.response || !auth.user || requireConsent(auth.user) || auth.user.fictional || auth.user.projectExecution
    || auth.user.userId.startsWith("guest:") || auth.user.streamId !== `creative:${auth.user.userId}`
    || !auth.user.access.capabilities.includes("project.author")) return fail();
  const actor = auth.user, schema = await schemas(scope), nativeSchema = await nativeTables(scope, "writer");
  const custody = await scope.db.prepare(`SELECT ${custodyColumns.join(",")} FROM experience_guest_image_result_custodies
    WHERE destination_user_id=? AND output_id=? AND length(CAST(lineage_json AS BLOB))<=262144
      AND (SELECT COUNT(*) FROM experience_guest_image_result_custodies WHERE destination_user_id=? AND output_id=?)=1`)
    .bind(actor.userId, outputId, actor.userId, outputId).first<Record<string, Value>>(); scope.current();
  if (!custody) return fail();
  const raw = scope.text(custody.lineage_json, 262_144), lineage = await scope.wait(() => readGuestImageResultClaimLineage(JSON.parse(raw)));
  scope.prefix(lineage.copy.manifest.sourceHead);
  const rows = await scope.wait(() => guestImageResultClaimRows(lineage));
  if (!same(custody, rows.custody) || rows.custody.output_id !== outputId || lineage.copy.destinationUserId !== actor.userId
    || scope.origin !== lineage.contextLineage.origin) return fail();
  const authority = projectIntakeAuthority(scope.env, { user: actor, principal: actor, impersonation: null },
    { projectId: lineage.copy.manifest.projectId, documentId: lineage.copy.manifest.documentId });
  if (!isCurrent(await scope.db.prepare(`SELECT 1 AS current WHERE ${authority.sql}`).bind(...authority.bindings).first())) return fail();
  const attempt = await scope.db.prepare(`SELECT ${GUEST_IMAGE_RESULT_COPY_COLUMNS.join(",")} FROM experience_guest_image_result_copy_attempts
    WHERE attempt_id=? AND state='published' AND length(CAST(descriptor_json AS BLOB))<=65536 AND length(CAST(lease_snapshot_json AS BLOB))<=65536
      AND length(CAST(destination_metadata_json AS BLOB))<=8192`).bind(lineage.copy.attemptId).first<GuestImageResultCopyAttemptRow>(); scope.current();
  if (!attempt) return fail();
  const privateEvent = async (id: string) => {
    const row = await scope.db.prepare(`SELECT private_json FROM event_private_payloads WHERE private_event_id=? AND owner_id=?
      AND redacted_at IS NULL AND length(CAST(private_json AS BLOB)) BETWEEN 1 AND 65536`).bind(id, actor.userId).first<{ private_json: string }>();
    scope.current(); return scope.text(row?.private_json, 65_536);
  };
  const prefixBodies: string[] = [];
  for (const target of lineage.contextLineage.events) prefixBodies.push(await privateEvent(target.id));
  const saveBody = await privateEvent(lineage.saveLineage.target.id), claimBody = await privateEvent(lineage.canonical.eventId);
  const plannerCopy = lineage.resultCopies[0];
  if (!/^sha256:[a-f0-9]{64}$/u.test(plannerCopy.original_digest)) return fail();
  const graph = await scope.wait(() => construct({ lineage, publishedAttempt: attempt, prefixBodies, saveBody, claimBody, resultBodies: [] }, false, "association"));
  const exclusions = await memory(scope, graph.afterGraph), canonicalParts = [schema, nativeSchema, authority, ...graph.parts, ...exclusions];
  // These bindings remain in this function's frame throughout qualification;
  // do not pretend a const local has retired merely because it was last read.
  const canonicalRoots = [auth, actor, schema, nativeSchema, custody, raw, lineage, rows, authority, attempt,
    prefixBodies, saveBody, claimBody, plannerCopy, graph, exclusions, canonicalParts, command];
  scope.beginWitness(canonicalRoots);
  const witness = await readImageWitness(scope.env, actor.streamId, actor.userId, currentArtifactKey(outputId), outputId,
    { check: scope.current, sql: scope.reserveWitness, wait: pending => scope.wait(() => pending) });
  scope.endWitness(witness.queryCount);
  const eventRows = freeze(witness.eventRows), revisionRows = freeze(witness.revisionRows);
  const events: EventRow[] = [];
  const witnessAccounting = { eventCount: witness.eventCount, head: witness.head, guards: witness.guards,
    eventBytes: witness.eventBytes, reads: witness.reads, queryCount: witness.queryCount };
  const capturedBytes = scope.accounting([canonicalRoots, witnessAccounting, eventRows, revisionRows]);
  let serializedBytes = 64;
  for (const value of eventRows) {
    if (!record(value) || value.stream_id !== actor.streamId || typeof value.event_id !== "string"
      || value.private_json !== null && (value.private_owner !== actor.userId || typeof value.private_json !== "string")) return fail();
    const event = freeze(serializeEvent({ ...value, private_json: value.private_redacted === null ? value.private_json : null }));
    serializedBytes += 16 + measureCurrentRetained(event, CURRENT_SNAPSHOT_PROFILE.aggregateBytes);
    scope.accounting(null, capturedBytes + serializedBytes); events.push(event);
  }
  freeze(events);
  const outsideRetainedBytes = scope.accounting([canonicalRoots, witnessAccounting]);
  const read = freeze({ ownerId: actor.userId, projectId: lineage.copy.manifest.projectId, documentId: lineage.copy.manifest.documentId,
    outputId, events, head: witness.head, planner: { contentRef: plannerCopy.content_id, contentDigest: plannerCopy.original_digest, expiresAt: plannerCopy.expires_at, claim: graph.completedReview } });
  const facts = await scope.wait(() => qualifyClaimedImageLocalAdoption({ read, eventRows, revisionRows,
    monotonicDeadline: scope.monotonicDeadline, wallDeadline: scope.wallDeadline, outsideRetainedBytes })); scope.current();
  const claimPairs = graph.afterGraph.eventEnvelopes.filter(pair => pair.event.event_id === graph.completedReview.claimEventId);
  if (claimPairs.length !== 1) return fail();
  const provedClaim = freeze(serializeEvent({ ...claimPairs[0]!.event, private_json: claimPairs[0]!.envelope.private_json }));
  if (!same(facts.canonical, provedClaim) || !same(command.claim, facts.snapshot.claim)
    || command.expectedRevision !== facts.snapshot.revision || command.expectedEditEventId !== facts.snapshot.editEventId
    || command.expectedMediaSha256 !== facts.snapshot.media.sha256) return fail();
  const native = scope.writerWitness(witness.eventCount, witness.head, witness.eventBytes);
  const revisionProofs = revisionRows.map(row => {
    if (!record(row) || !exactKeys(row, claimedRevisionColumns) || claimedRevisionColumns.some(key => row[key] !== null && typeof row[key] !== "string" && typeof row[key] !== "number")) return fail();
    return exact("artifact_revisions", row as Row);
  });
  let pair: GuestImageResultLocalAdoptionPair, selected = facts, successorRawBytes = witness.eventBytes;
  const reuse = facts.localPair !== null;
  if (facts.localPair) {
    const receipt = events.find(event => event.eventId === facts.localPair!.receiptEventId);
    const block = events.find(event => event.eventId === facts.localPair!.creationEventId);
    if (!receipt || !block) return fail();
    scope.accounting([canonicalRoots, witnessAccounting, eventRows, revisionRows, events, read, facts, claimPairs, provedClaim, native, revisionProofs, receipt, block],
      adoptionPairWork(facts.snapshot.media.url));
    pair = matchGuestImageResultLocalAdoptionPair({ receipt, block }, { receipt, block }) ?? fail();
  } else {
    if (witness.eventCount > 49_998 || !Number.isSafeInteger(witness.head + 2)
      || native.version.streamGeneration + 4 >= SCENE_SOURCE_GENERATION_MAX) return fail();
    const ids = freeze({ referenceId: uuidV7(), blockId: uuidV7(), receiptEventId: uuidV7(), blockEventId: uuidV7(), correlationId: uuidV7() });
    scope.accounting([canonicalRoots, witnessAccounting, eventRows, revisionRows, events, read, facts, claimPairs, provedClaim, native, revisionProofs, ids], ADOPTION_ALIAS_WORK);
    if (!guestImageResultLocalAdoptionIdentitiesUnused(events, ids)) return fail();
    scope.current();
    const occurredAt = new Date().toISOString();
    if (occurredAt < facts.canonical.recordedAt || facts.retained.some(value => typeof value.row.created_at !== "string" || occurredAt < value.row.created_at)) return fail();
    scope.accounting([canonicalRoots, witnessAccounting, eventRows, revisionRows, events, read, facts, claimPairs, provedClaim, native, revisionProofs, ids],
      adoptionPairWork(facts.snapshot.media.url) + claimedImageLocalAdoptionCanonicalWork(facts.canonical) + 24 + 2 * facts.title.length + 2 * (24 + 2 * 160));
    pair = createGuestImageResultLocalAdoptionPair({ snapshot: facts.snapshot, title: facts.title, canonical: facts.canonical,
      retainedExpiresAt: facts.retainedExpiresAt, ids, occurredAt }) ?? fail();
    if (pair.receipt.sequence !== witness.head + 1 || pair.block.sequence !== witness.head + 2) return fail();
    const addedRows = [pair.receipt, pair.block].map(event => {
      const bindings = eventWriteBindings(event);
      if (typeof bindings[12] !== "string" || typeof bindings[16] !== "string") return fail();
      const rawBytes = bytes(bindings[12]) + bytes(bindings[16]);
      if (rawBytes > 128_000) return fail(); successorRawBytes += rawBytes;
      const joined = eventEnvelope(event, bindings[16], actor.userId);
      return freeze({ ...joined.event, private_owner: joined.envelope.owner_id, private_project: joined.envelope.project_id,
        private_document: joined.envelope.document_id, private_json: joined.envelope.private_json, private_redacted: joined.envelope.redacted_at });
    });
    if (successorRawBytes > 16_000_000) return fail();
    let encoded = 2;
    for (const row of eventRows) {
      scope.current(); const cell = claimedImageEditEventCellBytes(row);
      if (cell + 2 > 512_000) return fail(); encoded += cell + 1;
    }
    for (const row of addedRows) {
      const cell = claimedImageEditEventCellBytes(row); if (cell + 2 > 512_000) return fail(); encoded += cell + 1;
    }
    if (encoded > 24_000_000) return fail();
    scope.accounting([canonicalRoots, witnessAccounting, eventRows, revisionRows, events, read, facts, claimPairs, provedClaim, native,
      revisionProofs, ids, pair, addedRows], 2 * (64 + (events.length + 2) * 16));
    const prospectiveRead = freeze({ ...read, events: [...events, pair.receipt, pair.block], head: witness.head + 2 });
    const prospectiveRows = freeze([...eventRows, ...addedRows]);
    selected = await scope.wait(() => qualifyClaimedImageLocalAdoption({ read: prospectiveRead, eventRows: prospectiveRows, revisionRows,
      monotonicDeadline: scope.monotonicDeadline, wallDeadline: scope.wallDeadline,
      outsideRetainedBytes: scope.accounting([canonicalRoots, witnessAccounting, read, facts, claimPairs, provedClaim, native, revisionProofs, ids, pair]),
    }));
    if (!selected.localPair || selected.localPair.blockId !== ids.blockId || selected.localPair.referenceId !== ids.referenceId
      || selected.localPair.receiptEventId !== ids.receiptEventId || selected.localPair.creationEventId !== ids.blockEventId
      || selected.localPair.locked || selected.localPair.sourceEvents.length !== 1 || selected.localPair.sourceEvents[0] !== ids.blockEventId
      || selected.snapshot.head !== witness.head + 2 || selected.snapshot.revision !== facts.snapshot.revision
      || selected.snapshot.editEventId !== facts.snapshot.editEventId || !same(selected.snapshot.media, facts.snapshot.media)
      || !same(selected.canonical, facts.canonical) || selected.retainedExpiresAt !== facts.retainedExpiresAt) return fail();
  }
  const local = selected.localPair ?? fail();
  const metadata: Readonly<Record<string, string>> = facts.snapshot.revision === 0 ? lineage.copy.destinationMetadata : facts.derivativeMetadata ?? fail();
  const scopeProof = currentScopeProof(actor.userId, lineage.copy.custodyId, facts);
  const resources = [local.blockId, local.referenceId], eventIds = [...new Set([pair.receipt.eventId, pair.block.eventId, ...local.sourceEvents])];
  const selectionProof: Proof = { sql: `?>${nowSql} AND ?<=${nowSql}
    AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_id IN(SELECT value FROM json_each(?)))
    AND NOT EXISTS(SELECT 1 FROM project_event_scopes WHERE event_id IN(SELECT value FROM json_each(?)))`,
    bindings: [selected.retainedExpiresAt, pair.block.recordedAt, JSON.stringify(resources), JSON.stringify(eventIds)] };
  const exclusion: Proof = { sql: `NOT EXISTS(SELECT 1 FROM events WHERE event_id IN(SELECT value FROM json_each(?)) OR correlation_id=?)
    AND NOT EXISTS(SELECT 1 FROM event_private_payloads WHERE private_event_id IN(SELECT value FROM json_each(?)))
    AND NOT EXISTS(SELECT 1 FROM event_write_stage WHERE event_id IN(SELECT value FROM json_each(?)) OR correlation_id=?)`,
    bindings: [JSON.stringify([pair.receipt.eventId, pair.block.eventId, local.blockId, local.referenceId, pair.block.correlationId]), pair.block.correlationId,
      JSON.stringify([pair.receipt.eventId, pair.block.eventId, local.blockId, local.referenceId, pair.block.correlationId]),
      JSON.stringify([pair.receipt.eventId, pair.block.eventId, local.blockId, local.referenceId, pair.block.correlationId]), pair.block.correlationId] };
  const parts = freeze([...canonicalParts, ...witness.guards, claimedEditProof([scopeProof, selectionProof, ...(reuse ? [] : [exclusion])])]);
  const adoption = freeze({ pair, reuse, canonicalParts, witnessGuards: witness.guards, revisionProofs, scopeProof, ...native,
    artifactKey: facts.artifactKey, revisionCount: revisionRows.length, sourceId: local.sourceId, blockId: local.blockId,
    referenceId: local.referenceId, head: selected.snapshot.head, selectionProof, successorRawBytes });
  const compact: CurrentDisclosure = freeze({ snapshot: facts.snapshot, parts,
    mediaKey: decodeURIComponent(facts.snapshot.media.url.slice("/api/media/".length)), metadata, expiresAt: facts.retainedExpiresAt, adoption });
  scope.accounting([canonicalRoots, witnessAccounting, eventRows, revisionRows, events, read, facts, claimPairs, provedClaim, native,
    revisionProofs, pair, selected, local, metadata, resources, eventIds, scopeProof, selectionProof, exclusion, compact]);
  measureCurrentRetained(compact); return compact;
}

type ClaimedDraftLookup = Readonly<{ ownerId: string; outputId: string; custodyId: string; draftId: string;
  familyGuard: Proof; selectorGuard: Proof }>;

async function collectPersonalDisclosure(scope: CurrentSnapshotOwner, request: Request, outputId: string, lookup?: ClaimedDraftLookup): Promise<CurrentDisclosure> {
  const auth = await scope.wait(() => readExistingPrincipalRequest(request, scope.env, "creator", { account: "principal" }));
  if ("kind" in auth || auth.response || !auth.user || requireConsent(auth.user) || auth.user.fictional || auth.user.projectExecution
    || auth.user.userId.startsWith("guest:") || auth.user.streamId !== `creative:${auth.user.userId}`
    || !auth.user.access.capabilities.includes("project.author")) return fail();
  const actor = auth.user, schema = await schemas(scope), nativeSchema = await nativeTables(scope, true);
  const custody = await scope.db.prepare(`SELECT ${custodyColumns.join(",")} FROM experience_guest_image_result_custodies
    WHERE destination_user_id=? AND output_id=? AND length(CAST(lineage_json AS BLOB))<=262144
      AND (SELECT COUNT(*) FROM experience_guest_image_result_custodies WHERE destination_user_id=? AND output_id=?)=1`)
    .bind(actor.userId, outputId, actor.userId, outputId).first<Record<string, Value>>(); scope.current();
  if (!custody) return fail();
  const raw = scope.text(custody.lineage_json, 262_144), lineage = await scope.wait(() => readGuestImageResultClaimLineage(JSON.parse(raw)));
  scope.prefix(lineage.copy.manifest.sourceHead);
  const rows = await scope.wait(() => guestImageResultClaimRows(lineage));
  if (!same(custody, rows.custody) || rows.custody.output_id !== outputId || lineage.copy.destinationUserId !== actor.userId
    || lookup && (lookup.ownerId !== actor.userId || lookup.outputId !== outputId || lookup.custodyId !== lineage.copy.custodyId || lookup.draftId !== lineage.saveLineage.draftId)
    || scope.origin !== lineage.contextLineage.origin) return fail();
  const authority = projectIntakeAuthority(scope.env, { user: actor, principal: actor, impersonation: null },
    { projectId: lineage.copy.manifest.projectId, documentId: lineage.copy.manifest.documentId });
  if (!isCurrent(await scope.db.prepare(`SELECT 1 AS current WHERE ${authority.sql}`).bind(...authority.bindings).first())) return fail();
  const attempt = await scope.db.prepare(`SELECT ${GUEST_IMAGE_RESULT_COPY_COLUMNS.join(",")} FROM experience_guest_image_result_copy_attempts
    WHERE attempt_id=? AND state='published' AND length(CAST(descriptor_json AS BLOB))<=65536 AND length(CAST(lease_snapshot_json AS BLOB))<=65536
      AND length(CAST(destination_metadata_json AS BLOB))<=8192`).bind(lineage.copy.attemptId).first<GuestImageResultCopyAttemptRow>(); scope.current();
  if (!attempt) return fail();
  const privateEvent = async (id: string) => {
    const row = await scope.db.prepare(`SELECT private_json FROM event_private_payloads WHERE private_event_id=? AND owner_id=?
      AND redacted_at IS NULL AND length(CAST(private_json AS BLOB)) BETWEEN 1 AND 65536`).bind(id, actor.userId).first<{ private_json: string }>();
    scope.current(); return scope.text(row?.private_json, 65_536);
  };
  const prefixBodies: string[] = [];
  for (const target of lineage.contextLineage.events) prefixBodies.push(await privateEvent(target.id));
  const saveBody = await privateEvent(lineage.saveLineage.target.id), claimBody = await privateEvent(lineage.canonical.eventId);
  const plannerCopy = lineage.resultCopies[0];
  if (!/^sha256:[a-f0-9]{64}$/u.test(plannerCopy.original_digest)) return fail();
  const graph = await scope.wait(() => construct({ lineage, publishedAttempt: attempt, prefixBodies, saveBody, claimBody, resultBodies: [] }, false, "association"));
  const exclusions = await memory(scope, graph.afterGraph), canonicalParts = [schema, nativeSchema, authority, ...graph.parts, ...exclusions];
  let promptRow: Row | null = null, promptText: string | null = null;
  const promptProofs: Proof[] = [], copiedPrompt = lineage.resultCopies[1];
  const promptQuery = `SELECT content_id,owner_id,kind,content,created_at,expires_at,redacted_at FROM private_content
    WHERE content_id=? AND owner_id=? AND kind='guest-image-result-history' AND created_at=? AND expires_at=?
      AND redacted_at IS NULL AND created_at<=${nowSql} AND expires_at>${nowSql}
      AND typeof(content)='text' AND length(CAST(content AS BLOB)) BETWEEN 1 AND 65536`;
  const promptBindings = [copiedPrompt.content_id, actor.userId, copiedPrompt.created_at, copiedPrompt.expires_at];
  if (scope.action === "inputs") {
    if (copiedPrompt.role !== "prompt") return fail();
    promptRow = await scope.db.prepare(promptQuery).bind(...promptBindings).first<Row>(); scope.current();
    if (promptRow) {
      promptText = scope.text(promptRow.content, 65_536);
      if (bytes(promptText) !== copiedPrompt.byte_length || await scope.wait(() => digest(promptText!)) !== copiedPrompt.original_digest) return fail();
      promptProofs.push(exact("private_content", promptRow), { sql: `?<=${nowSql} AND ?>${nowSql}`, bindings: [copiedPrompt.created_at, copiedPrompt.expires_at] });
    } else promptProofs.push({ sql: `NOT EXISTS(${promptQuery})`, bindings: promptBindings });
  }
  // These bindings remain in this function's frame throughout qualification;
  // do not pretend a const local has retired merely because it was last read.
  const canonicalRoots = [auth, actor, schema, nativeSchema, custody, raw, lineage, rows, authority, attempt,
    prefixBodies, saveBody, claimBody, plannerCopy, graph, exclusions, canonicalParts, lookup, promptRow, promptText, promptProofs, promptQuery, promptBindings];
  scope.beginWitness(canonicalRoots);
  const witness = await readImageWitness(scope.env, actor.streamId, actor.userId, currentArtifactKey(outputId), outputId,
    { check: scope.current, sql: scope.reserveWitness, wait: pending => scope.wait(() => pending) });
  scope.endWitness(witness.queryCount);
  const eventRows = freeze(witness.eventRows), revisionRows = freeze(witness.revisionRows);
  const events: EventRow[] = [];
  const witnessAccounting = { eventCount: witness.eventCount, head: witness.head, guards: witness.guards,
    eventBytes: witness.eventBytes, reads: witness.reads, queryCount: witness.queryCount };
  const capturedBytes = scope.accounting([canonicalRoots, witnessAccounting, eventRows, revisionRows]);
  let serializedBytes = 64;
  for (const value of eventRows) {
    if (!record(value) || value.stream_id !== actor.streamId || typeof value.event_id !== "string"
      || value.private_json !== null && (value.private_owner !== actor.userId || typeof value.private_json !== "string")) return fail();
    const event = freeze(serializeEvent({ ...value, private_json: value.private_redacted === null ? value.private_json : null }));
    serializedBytes += 16 + measureCurrentRetained(event, CURRENT_SNAPSHOT_PROFILE.aggregateBytes);
    scope.accounting(null, capturedBytes + serializedBytes); events.push(event);
  }
  freeze(events);
  const outsideRetainedBytes = scope.accounting([canonicalRoots, witnessAccounting]);
  const read = freeze({ ownerId: actor.userId, projectId: lineage.copy.manifest.projectId, documentId: lineage.copy.manifest.documentId,
    outputId, events, head: witness.head, planner: { contentRef: plannerCopy.content_id, contentDigest: plannerCopy.original_digest, expiresAt: plannerCopy.expires_at, claim: graph.completedReview } });
  const facts = await scope.wait(() => qualifyClaimedImageLocalAdoption({ read, eventRows, revisionRows,
    monotonicDeadline: scope.monotonicDeadline, wallDeadline: scope.wallDeadline, outsideRetainedBytes })); scope.current();
  const claimPairs = graph.afterGraph.eventEnvelopes.filter(pair => pair.event.event_id === graph.completedReview.claimEventId);
  if (claimPairs.length !== 1) return fail();
  const provedClaim = freeze(serializeEvent({ ...claimPairs[0]!.event, private_json: claimPairs[0]!.envelope.private_json }));
  if (!same(facts.canonical, provedClaim)) return fail();
  const metadata: Readonly<Record<string, string>> = facts.snapshot.revision === 0 ? lineage.copy.destinationMetadata : facts.derivativeMetadata ?? fail();
  const scopeProof = currentScopeProof(actor.userId, lineage.copy.custodyId, facts);
  const personal = freeze({ draftId: lineage.saveLineage.draftId, title: facts.title, canonical: facts.canonical,
    initialMedia: facts.initialMedia, originalKey: lineage.copy.destinationKey, originalMetadata: lineage.copy.destinationMetadata, prompt: promptText });
  const compact: CurrentDisclosure = freeze({ snapshot: facts.snapshot,
    parts: [...canonicalParts, ...witness.guards, scopeProof, ...promptProofs, ...(lookup ? [lookup.familyGuard, lookup.selectorGuard] : [])],
    mediaKey: decodeURIComponent(facts.snapshot.media.url.slice("/api/media/".length)), metadata, expiresAt: facts.retainedExpiresAt, personal });
  scope.accounting([canonicalRoots, witnessAccounting, eventRows, revisionRows, events, read, facts, claimPairs, provedClaim, metadata, scopeProof, personal, compact]);
  measureCurrentRetained(compact); return compact;
}

type CurrentObjectMetadata = Readonly<{ size: number; httpEtag: string; key: string; version: string; etag: string;
  custom: Readonly<Record<string, string>>; http: readonly (readonly [string, string])[] }>;
type ClaimedImageMediaEvidence = Readonly<{ media: GuestImageResultEditSnapshot["media"]; revision: number;
  mediaKey: string; metadata: Readonly<Record<string, string>> }>;
function captureCurrentMetadata(scope: CurrentSnapshotOwner, object: unknown, disclosure: CurrentDisclosure | ClaimedImageMediaEvidence): CurrentObjectMetadata {
  scope.current(); if (!object || typeof object !== "object") return fail();
  const size = Reflect.get(object, "size", object), httpEtag = Reflect.get(object, "httpEtag", object);
  const custom = Reflect.get(object, "customMetadata", object), write = Reflect.get(object, "writeHttpMetadata", object);
  scope.current();
  const media = "snapshot" in disclosure ? disclosure.snapshot.media : disclosure.media;
  const revision = "snapshot" in disclosure ? disclosure.snapshot.revision : disclosure.revision;
  if (size !== media.byteLength || !Number.isSafeInteger(size) || size < 1 || size > MAX_OUTPUT_ASSET_BYTES
    || !currentText(httpEtag, 1024) || !httpEtag || !record(custom) || typeof write !== "function") return fail();
  const expected = disclosure.metadata, names = Reflect.ownKeys(custom), required = revision === 0 ? 12 : 14;
  if (names.length !== required || Object.keys(expected).length !== required) return fail();
  const captured: Record<string, string> = Object.create(null); let total = bytes(httpEtag);
  for (const name of names) {
    if (typeof name !== "string" || !Object.hasOwn(expected, name)) return fail();
    const descriptor = Object.getOwnPropertyDescriptor(custom, name);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value") || !currentText(descriptor.value, 8192)
      || descriptor.value !== expected[name]) return fail();
    captured[name] = descriptor.value; total += bytes(name) + bytes(descriptor.value);
  }
  const identity = { key: "", version: "", etag: "" };
  for (const name of ["key", "version", "etag"] as const) {
    const value = Reflect.get(object, name, object); scope.current();
    if (!currentText(value, 1024) || !value || name === "key" && value !== disclosure.mediaKey) return fail();
    identity[name] = value; total += bytes(name) + bytes(value);
  }
  const headers = new Headers(); Reflect.apply(write, object, [headers]); scope.current();
  const http: (readonly [string, string])[] = [];
  for (const [name, value] of headers) {
    if (http.length >= 32 || !currentText(name, 128) || !currentText(value, 8192)) return fail();
    total += bytes(name) + bytes(value); http.push(Object.freeze([name, value] as const));
  }
  if (headers.get("content-type") !== "image/png" || total > 32_768) return fail();
  scope.metadata(total); http.sort(([a], [b]) => a.localeCompare(b));
  return freeze({ size, httpEtag, ...identity, custom: captured, http });
}
function sameCurrentMetadata(a: CurrentObjectMetadata, b: CurrentObjectMetadata): boolean {
  return a.size === b.size && a.key === b.key && a.version === b.version && a.etag === b.etag && a.httpEtag === b.httpEtag
    && canonicalJson(a.custom) === canonicalJson(b.custom) && JSON.stringify(a.http) === JSON.stringify(b.http);
}
async function inspectCurrentMedia(scope: CurrentSnapshotOwner, disclosure: CurrentDisclosure, selected?: ClaimedImageMediaEvidence): Promise<void> {
  const target = selected ?? disclosure;
  const object = await scope.get(target.mediaKey);
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null, complete = false;
  let removeCancel: (() => void) | undefined;
  try {
    const before = captureCurrentMetadata(scope, object, target), body = object && Reflect.get(object, "body", object);
    scope.current(); if (!body) return fail();
    reader = Reflect.apply(currentGetReader, body, []) as ReadableStreamDefaultReader<Uint8Array>;
    const cancel = () => { if (reader) void Reflect.apply(currentCancelReader, reader, []).catch(() => undefined); };
    removeCancel = scope.onCancel(cancel); scope.retainMedia(selected ? [disclosure, selected, before] : [disclosure, before]);
    const png = scope.own(before.size); let offset = 0, reads = 0;
    if (scope.action !== "current") scope.binary(before.size);
    for (;;) {
      if (++reads > 65_537) return fail(); scope.stream(); const result: unknown = await scope.wait(() => Reflect.apply(currentReadChunk, reader!, []));
      if (!record(result)) return fail();
      const done = Object.getOwnPropertyDescriptor(result, "done"), value = Object.getOwnPropertyDescriptor(result, "value");
      if (!done || !Object.hasOwn(done, "value") || value && !Object.hasOwn(value, "value")) return fail();
      if (done.value === true) { if (value?.value !== undefined || offset !== before.size) return fail(); complete = true; break; }
      const chunk = value?.value;
      if (done.value !== false || reads === 65_537 || !(chunk instanceof Uint8Array) || Object.getPrototypeOf(chunk) !== Uint8Array.prototype) return fail();
      const length = Reflect.apply(currentByteLength, chunk, []), backing = Reflect.apply(currentBuffer, chunk, []);
      if (!(backing instanceof ArrayBuffer) || !Number.isSafeInteger(length) || length < 1 || length > png.byteLength - offset) return fail();
      Reflect.apply(currentSet, png, [chunk, offset]); offset += length;
    }
    if (png.length < 8 || [137, 80, 78, 71, 13, 10, 26, 10].some((value, index) => png[index] !== value)) return fail();
    const inspected = await scope.use(png, () => inspectOutputAsset(png, "image.png", { snapshot: false }));
    scope.current();
    const expected = selected?.media ?? disclosure.snapshot.media;
    if (inspected.status !== "inspected" || inspected.kind !== "image" || inspected.mimeType !== "image/png" || inspected.extension !== "png"
      || inspected.byteLength !== expected.byteLength || inspected.sha256 !== expected.sha256
      || inspected.facts.width !== expected.width || inspected.facts.height !== expected.height) return fail();
    scope.retainMedia(selected ? [disclosure, selected, before, inspected] : [disclosure, before, inspected]);
    const after = captureCurrentMetadata(scope, await scope.head(target.mediaKey), target);
    if (!sameCurrentMetadata(before, after)) return fail();
    scope.retainMedia(selected ? [disclosure, selected, before, inspected, after] : [disclosure, before, inspected, after]);
    scope.release();
  } finally {
    removeCancel?.();
    const release = () => { try { if (reader) Reflect.apply(currentReleaseReader, reader, []); } catch { /* A pending native read may still own its lock. */ } };
    if (!complete) {
      if (reader) { try { void Reflect.apply(currentCancelReader, reader, []).then(release, release); } catch { release(); } }
      else currentCancelObject(object);
    }
    release();
  }
}

/** Fresh, read-only current snapshot. The scalar selector grants no authority.
 * No native/default route calls this dormant explicit entrypoint yet. */
export function beginGuestImageResultCurrentSnapshot(request: Request, env: WorkerEnv,
  input: Readonly<{ outputId: string }>): GuestImageResultOperation<GuestImageResultCurrentSnapshotCompletion | null> {
  let owner: CurrentSnapshotOwner | undefined;
  const result = (async (): Promise<GuestImageResultCurrentSnapshotCompletion | null> => {
  try {
    const selector = capture(input);
    if (!record(selector) || !exactKeys(selector, ["outputId"]) || typeof selector.outputId !== "string"
      || !/^object-[a-f0-9]{8}$/u.test(selector.outputId)) return fail();
    owner = currentSnapshotOwner(request, env, selector.outputId);
    const disclosure = await collectCurrentDisclosure(owner, request, selector.outputId);
    owner.retain(disclosure);
    await owner.prove(disclosure.parts, "before");
    await inspectCurrentMedia(owner, disclosure);
    await owner.prove(disclosure.parts, "final");
    owner.finish(); if (!completeCurrentSnapshot(disclosure.snapshot)) return fail();
    // The original API lifetime must also deny expiry during its later JSON
    // construction. Copy the already-proved minimum; do not refresh any clock.
    const completion = Object.freeze({ snapshot: disclosure.snapshot, expiresAt: disclosure.expiresAt });
    owner.current(); return completion;
  } catch { return null; }
  finally { owner?.dispose(); }
  })();
  return Object.freeze({ result, retire() { owner?.dispose(); } });
}
export async function readGuestImageResultCurrentSnapshot(request: Request, env: WorkerEnv,
  input: Readonly<{ outputId: string }>): Promise<Readonly<GuestImageResultEditSnapshot> | null> {
  const completion = await beginGuestImageResultCurrentSnapshot(request, env, input).result;
  return completion?.snapshot ?? null;
}

// Fixed writer-only body readers. Native streams are observed with captured
// methods; every body has its own 65,536-chunk bound in addition to the action
// total. No body, File or adapter is returned to an application caller.
async function readClaimedEditWire(scope: CurrentSnapshotOwner, request: Request): Promise<Uint8Array<ArrayBuffer>> {
  const body = scope.beginRequest(), length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/u.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) < 1
    || Number(length) > CLAIMED_EDIT_PROFILE.wireBytes)) return fail();
  const reader = Reflect.apply(currentGetReader, body, []) as ReadableStreamDefaultReader<Uint8Array>;
  const chunks: Uint8Array<ArrayBuffer>[] = []; let total = 0, reads = 0, complete = false;
  const cancel = () => { void Reflect.apply(currentCancelReader, reader, []).catch(() => undefined); };
  const remove = scope.onCancel(cancel);
  try {
    for (;;) {
      if (++reads > 65_537) return fail(); scope.stream();
      const result: unknown = await scope.wait(() => Reflect.apply(currentReadChunk, reader, []));
      if (!record(result)) return fail();
      const done = Object.getOwnPropertyDescriptor(result, "done"), value = Object.getOwnPropertyDescriptor(result, "value");
      if (!done || !Object.hasOwn(done, "value") || value && !Object.hasOwn(value, "value")) return fail();
      if (done.value === true) { if (value?.value !== undefined || total < 1 || length !== null && total !== Number(length)) return fail(); complete = true; break; }
      const source = value?.value;
      if (done.value !== false || reads === 65_537 || !(source instanceof Uint8Array) || Object.getPrototypeOf(source) !== Uint8Array.prototype) return fail();
      const size = Reflect.apply(currentByteLength, source, []), backing = Reflect.apply(currentBuffer, source, []);
      if (!(backing instanceof ArrayBuffer) || !Number.isSafeInteger(size) || size < 1 || total + size > CLAIMED_EDIT_PROFILE.wireBytes
        || length !== null && total + size > Number(length) || chunks.length >= 65_536) return fail();
      scope.multipartAccounting(null, total + size, 0, chunks.length + 1); scope.binary(size);
      const copy = new Uint8Array(size); Reflect.apply(currentSet, copy, [source]); chunks.push(copy); total += size;
    }
    scope.multipartAccounting(null, total, 0, chunks.length);
    const joined = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { Reflect.apply(currentSet, joined, [chunk, offset]); offset += chunk.length; }
    return joined;
  } finally {
    remove(); for (const chunk of chunks) Reflect.apply(currentFill, chunk, [0]);
    if (!complete) cancel(); try { Reflect.apply(currentReleaseReader, reader, []); } catch { /* Pending read retains its native lock. */ }
  }
}
async function readClaimedEditMultipart(scope: CurrentSnapshotOwner, request: Request): Promise<{ value: unknown; png: Uint8Array<ArrayBuffer> }> {
  const contentType = request.headers.get("content-type");
  if (!contentType?.toLowerCase().startsWith("multipart/form-data;")) return fail();
  const wire = await readClaimedEditWire(scope, request); let parsing = false, retireWire = false;
  try {
    scope.multipartAccounting(null, wire.length);
    const response = new Response(wire, { headers: { "content-type": contentType } });
    const form = await scope.wait(() => {
      parsing = true;
      return Reflect.apply(Response.prototype.formData, response, []).finally(() => { parsing = false; if (retireWire) Reflect.apply(currentFill, wire, [0]); });
    });
    let raw: string | null = null, file: File | null = null, count = 0;
    for (const [name, value] of Reflect.apply(FormData.prototype.entries, form, [])) {
      if (++count > 2) return fail();
      if (name === "request" && raw === null && typeof value === "string") raw = value;
      else if (name === "png" && file === null && value instanceof File) file = value;
      else return fail();
    }
    if (count !== 2 || raw === null || bytes(raw) > 65_536 || !file || file.type !== "image/png"
      || file.size < 1 || file.size > MAX_OUTPUT_ASSET_BYTES) return fail();
    scope.multipartAccounting({ raw, file: { name: file.name, size: file.size, type: file.type, lastModified: file.lastModified } }, wire.length, file.size);
    let value: unknown; try { value = JSON.parse(raw); } catch { return fail(); }
    scope.multipartAccounting({ raw, value }, wire.length, file.size);
    const buffer: unknown = await scope.wait(() => Reflect.apply(Blob.prototype.arrayBuffer, file!, []), late => {
      if (late instanceof ArrayBuffer) Reflect.apply(currentFill, new Uint8Array(late), [0]);
    });
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== file.size) return fail();
    return { value, png: new Uint8Array(buffer) };
  } finally {
    // formData may still consume the wire after the request owner has expired.
    // The native Response owns its bytes; the local input is retired only once
    // the actual parsing call settles. No later I/O can start on that owner.
    retireWire = true; if (!parsing) Reflect.apply(currentFill, wire, [0]);
  }
}
async function readClaimedOrdinaryBody(scope: CurrentSnapshotOwner, object: unknown, size: number): Promise<Uint8Array<ArrayBuffer>> {
  const body = object && typeof object === "object" ? Reflect.get(object, "body", object) : null;
  scope.current(); if (!body) return fail();
  const reader = Reflect.apply(currentGetReader, body, []) as ReadableStreamDefaultReader<Uint8Array>;
  const remove = scope.onCancel(() => { void Reflect.apply(currentCancelReader, reader, []).catch(() => undefined); });
  let offset = 0, reads = 0, complete = false;
  const data = scope.ownTemporary(size); scope.binary(size);
  try {
    for (;;) {
      if (++reads > 65_537) return fail(); scope.stream();
      const result: unknown = await scope.wait(() => Reflect.apply(currentReadChunk, reader, []));
      if (!record(result)) return fail();
      const done = Object.getOwnPropertyDescriptor(result, "done"), value = Object.getOwnPropertyDescriptor(result, "value");
      if (!done || !Object.hasOwn(done, "value") || value && !Object.hasOwn(value, "value")) return fail();
      if (done.value === true) { if (value?.value !== undefined || offset !== size) return fail(); complete = true; break; }
      const chunk = value?.value;
      if (done.value !== false || reads === 65_537 || !(chunk instanceof Uint8Array) || Object.getPrototypeOf(chunk) !== Uint8Array.prototype) return fail();
      const length = Reflect.apply(currentByteLength, chunk, []), backing = Reflect.apply(currentBuffer, chunk, []);
      if (!(backing instanceof ArrayBuffer) || !Number.isSafeInteger(length) || length < 1 || length > size - offset) return fail();
      Reflect.apply(currentSet, data, [chunk, offset]); offset += length;
    }
    return data;
  } finally {
    remove(); if (!complete) { try { void Reflect.apply(currentCancelReader, reader, []).catch(() => undefined); } catch { /* Best effort. */ } }
    try { Reflect.apply(currentReleaseReader, reader, []); } catch { /* Pending read retains its native lock. */ }
  }
}

function claimedEditProof(parts: readonly Proof[]): Proof {
  if (!parts.length) return fail();
  return { sql: parts.map(part => `(${part.sql})`).join(" AND "), bindings: parts.flatMap(part => [...part.bindings]) };
}
function claimedEditSelectionProof(prepared: ClaimedImageEditPrepared, candidate?: ClaimedImageEditCandidate): Proof {
  const resources = [...prepared.resourceIds, ...prepared.ordinarySources.flatMap(source => [source.mediaKey, source.mediaUrl]),
    ...(candidate ? [candidate.mediaKey, candidate.mediaUrl] : [])];
  const events = [...prepared.eventIds, ...(candidate ? [candidate.event.eventId] : [])];
  return { sql: `?>${nowSql}
    AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_id IN(SELECT value FROM json_each(?)))
    AND NOT EXISTS(SELECT 1 FROM project_event_scopes WHERE event_id IN(SELECT value FROM json_each(?)))
    ${candidate ? `AND ?<=${nowSql} AND ?>${nowSql}` : ""}`,
  bindings: [prepared.expiresAt, JSON.stringify(resources), JSON.stringify(events),
    ...(candidate ? [candidate.event.recordedAt, candidate.expiresAt] : [])] };
}
function claimedEditBefore(disclosure: CurrentDisclosure, prepared: ClaimedImageEditPrepared, candidate?: ClaimedImageEditCandidate): readonly Proof[] {
  const edit = disclosure.edit ?? fail();
  const suffix = [edit.scopeProof, claimedEditSelectionProof(prepared, candidate)];
  if (candidate) suffix.push({ sql: `NOT EXISTS(SELECT 1 FROM events WHERE event_id=?)
      AND NOT EXISTS(SELECT 1 FROM event_private_payloads WHERE private_event_id=?)
      AND NOT EXISTS(SELECT 1 FROM event_write_stage WHERE event_id=?)
      AND NOT EXISTS(SELECT 1 FROM artifact_revisions WHERE revision_id IN(SELECT value FROM json_each(?)))`,
    bindings: [candidate.event.eventId, candidate.event.eventId, candidate.event.eventId, JSON.stringify(candidate.rows.map(row => row.revision_id))] });
  return freeze([...edit.canonicalParts, ...edit.witnessGuards, claimedEditProof(suffix)]);
}
function claimedEditPublication(disclosure: CurrentDisclosure, prepared: ClaimedImageEditPrepared, candidate: ClaimedImageEditCandidate): ClaimedEditPublication {
  const edit = disclosure.edit ?? fail(), context = edit.context;
  if (edit.version.streamGeneration + 2 >= SCENE_SOURCE_GENERATION_MAX || !Number.isSafeInteger(edit.version.streamGeneration + 2)
    || context.eventCount >= 50_000 || context.revisionCount + candidate.rows.length > 128
    || candidate.rows.length !== (context.snapshot.revision === 0 ? 2 : 1)
    || candidate.event.sequence !== edit.totals.head + 1 || candidate.event.streamId !== edit.version.streamId
    || !Number.isSafeInteger(candidate.event.sequence)) return fail();
  const rows: Row[] = candidate.rows.map(row => {
    if (!record(row) || !exactKeys(row, claimedRevisionColumns)
      || claimedRevisionColumns.some(key => row[key] !== null && typeof row[key] !== "string" && typeof row[key] !== "number")
      || row.owner_id !== context.snapshot.ownerId || row.organization_id !== null || row.project_access_id !== null
      || row.project_id !== context.snapshot.projectId || row.document_id !== context.snapshot.documentId
      || row.artifact_id !== context.artifactKey || row.created_by_user_id !== context.snapshot.ownerId || row.redacted_at !== null
      || row.created_at !== candidate.event.recordedAt || row.expires_at !== candidate.expiresAt) return fail();
    return row as Row;
  });
  const bindings = eventWriteBindings(candidate.event);
  if (typeof bindings[12] !== "string" || typeof bindings[16] !== "string") return fail();
  const rawBytes = edit.totals.raw_bytes + bytes(bindings[12]) + bytes(bindings[16]);
  if (rawBytes > 16_000_000 || context.revisionBytes + rows.reduce((sum, row) => sum + bytes(String(row.content_json)), 0) > 8_000_000
    || rows.some(row => typeof row.content_json !== "string" || bytes(row.content_json) > 100_000)) return fail();
  const pair = eventEnvelope(candidate.event, bindings[16], context.snapshot.ownerId);
  const successor = sceneSourceVersionAssertions({ ...edit.version, streamGeneration: edit.version.streamGeneration + 2 })
    .map(value => ({ sql: value.sql, bindings: [...value.bindings ?? []] as Value[] }));
  const after = [...edit.canonicalParts, ...successor,
    { sql: `(SELECT COUNT(*) FROM artifact_revisions WHERE owner_id=? AND artifact_id IN (?,?))=?`,
      bindings: [context.snapshot.ownerId, context.artifactKey, context.snapshot.outputId, context.revisionCount + rows.length] },
    ...edit.revisionProofs, ...rows.map(row => exact("artifact_revisions", row)),
    claimedEditProof([edit.scopeProof, claimedEditSelectionProof(prepared, candidate), exact("events", pair.event), exact("event_private_payloads", pair.envelope),
      { sql: `(SELECT json_array(COUNT(*),COALESCE(MAX(e.sequence),0),
          COALESCE(SUM(length(CAST(e.payload AS BLOB))+COALESCE(length(CAST(p.private_json AS BLOB)),0)),0))
          FROM events e LEFT JOIN event_private_payloads p ON p.private_event_id=e.event_id WHERE e.stream_id=?)=?
        AND NOT EXISTS(SELECT 1 FROM event_write_stage WHERE event_id=?)`,
        bindings: [edit.version.streamId, JSON.stringify([edit.totals.count + 1, edit.totals.head + 1, rawBytes]), candidate.event.eventId] }]),
  ];
  const before = claimedEditBefore(disclosure, prepared, candidate);
  if (before.length > 210 || after.length > 210 || before.length + 1 + rows.length + after.length > 423) return fail();
  return freeze({ before, after, event: candidate.event, rows });
}
async function verifyClaimedOrdinarySource(scope: CurrentSnapshotOwner, disclosure: CurrentDisclosure, prepared: ClaimedImageEditPrepared,
  source: ClaimedImageEditPrepared["ordinarySources"][number], retained: unknown): Promise<void> {
  const ownerId = disclosure.snapshot.ownerId;
  if (source.mediaUrl !== `/api/media/${encodeURIComponent(source.mediaKey)}` || !mediaKeyMatchesOwnerNamespace(source.mediaKey, ownerId)
    || source.mediaKey.startsWith("guest-image-result-media-v1/")) return fail();
  const object = await scope.ordinaryGet(source.mediaKey);
  try {
    if (!object || typeof object !== "object") return fail();
    const size = Reflect.get(object, "size", object), custom = Reflect.get(object, "customMetadata", object); scope.current();
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_OUTPUT_ASSET_BYTES || !record(custom)) return fail();
    const names = Reflect.ownKeys(custom); if (names.length > 128) return fail();
    const metadata: Record<string, string> = Object.create(null); let total = 0;
    for (const name of names) {
      if (typeof name !== "string" || !currentText(name, 128)) return fail();
      const descriptor = Object.getOwnPropertyDescriptor(custom, name);
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value") || !currentText(descriptor.value, 8192)) return fail();
      metadata[name] = descriptor.value; total += bytes(name) + bytes(descriptor.value); if (total > 32_768) return fail();
    }
    if (metadata.ownerId !== ownerId || metadata.sha256 !== source.contentHash || metadata.organizationId || metadata.projectAccessId) return fail();
    scope.metadata(total); scope.retainEdit([retained, disclosure, prepared, source, metadata]);
    const data = await readClaimedOrdinaryBody(scope, object, size);
    try { if (await scope.useTemporary(data, () => outputAssetSha256(data)) !== source.contentHash) return fail(); }
    finally { scope.releaseTemporary(data); }
  } catch (error) { currentCancelObject(object); throw error; }
}
async function verifyClaimedEditDestination(scope: CurrentSnapshotOwner, disclosure: CurrentDisclosure, candidate: ClaimedImageEditCandidate,
  put: CurrentObjectMetadata, retained: unknown): Promise<void> {
  const target: ClaimedImageMediaEvidence = { media: candidate.record.media, revision: candidate.record.revision,
    mediaKey: candidate.mediaKey, metadata: candidate.metadata };
  const object = await scope.destinationGet(target.mediaKey);
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null, complete = false;
  let remove: (() => void) | undefined;
  try {
    const before = captureCurrentMetadata(scope, object, target);
    if (!sameCurrentMetadata(put, before)) return fail();
    scope.retainEdit([retained, disclosure, candidate, target, put, before]);
    const body = object && typeof object === "object" ? Reflect.get(object, "body", object) : null;
    scope.current(); if (!body) return fail();
    reader = Reflect.apply(currentGetReader, body, []) as ReadableStreamDefaultReader<Uint8Array>;
    remove = scope.onCancel(() => { if (reader) void Reflect.apply(currentCancelReader, reader, []).catch(() => undefined); });
    let offset = 0, reads = 0; scope.binary(before.size);
    for (;;) {
      if (++reads > 65_537) return fail(); scope.stream();
      const result: unknown = await scope.wait(() => Reflect.apply(currentReadChunk, reader!, []));
      if (!record(result)) return fail();
      const done = Object.getOwnPropertyDescriptor(result, "done"), value = Object.getOwnPropertyDescriptor(result, "value");
      if (!done || !Object.hasOwn(done, "value") || value && !Object.hasOwn(value, "value")) return fail();
      if (done.value === true) { if (value?.value !== undefined || offset !== before.size) return fail(); complete = true; break; }
      const chunk = value?.value;
      if (done.value !== false || reads === 65_537 || !(chunk instanceof Uint8Array) || Object.getPrototypeOf(chunk) !== Uint8Array.prototype) return fail();
      const length = Reflect.apply(currentByteLength, chunk, []), backing = Reflect.apply(currentBuffer, chunk, []);
      if (!(backing instanceof ArrayBuffer) || !Number.isSafeInteger(length) || length < 1 || length > before.size - offset) return fail();
      scope.compareDestinationChunk(chunk as Uint8Array<ArrayBuffer>, offset); offset += length;
    }
    const after = captureCurrentMetadata(scope, await scope.destinationHead(target.mediaKey), target);
    if (!sameCurrentMetadata(before, after)) return fail(); scope.retainEdit([retained, disclosure, candidate, target, put, before, after]);
  } finally {
    remove?.();
    if (!complete) {
      if (reader) { try { void Reflect.apply(currentCancelReader, reader, []).catch(() => undefined); } catch { /* Best effort. */ } }
      else currentCancelObject(object);
    }
    try { if (reader) Reflect.apply(currentReleaseReader, reader, []); } catch { /* Pending read retains its native lock. */ }
  }
}

const claimedEditReply = (value: unknown, status = 200) => Response.json(value, { status,
  headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
function claimedEditAcknowledgment(disclosure: CurrentDisclosure, operation: ClaimedImageEditOperation) {
  const record = operation.record, snapshot = disclosure.snapshot;
  return freeze({ status: "saved", code: "saved", imageRevision: record, operationSha256: record.operationSha256,
    stillCurrent: record.revision === snapshot.revision && record.editEventId === snapshot.editEventId,
    currentRevision: snapshot.revision, currentEditEventId: snapshot.editEventId, appended: [operation.event], head: snapshot.head });
}
async function checkClaimedEdit(scope: CurrentSnapshotOwner, request: Request, outputId: string, operationSha256: string): Promise<Response> {
  const disclosure = await collectCurrentDisclosure(scope, request, outputId), context = disclosure.edit?.context ?? fail();
  scope.retain(disclosure);
  // Every entry came from the current qualifier's complete request/claim
  // rehash and exact retained row/event join. This is not digest-only trust.
  const matching = context.operations.filter(operation => operation.record.operationSha256 === operationSha256);
  if (matching.length > 1) return fail();
  if (!matching.length) return claimedEditReply({ status: "unconfirmed", code: "unconfirmed" });
  const operation = matching[0]!, selected: ClaimedImageMediaEvidence = { media: operation.record.media, revision: operation.record.revision,
    mediaKey: decodeURIComponent(operation.record.media.url.slice("/api/media/".length)), metadata: operation.metadata };
  await scope.prove(disclosure.parts, "before");
  await inspectCurrentMedia(scope, disclosure, selected);
  await scope.prove(disclosure.parts, "final"); scope.finish();
  return claimedEditReply(claimedEditAcknowledgment(disclosure, operation));
}
/** This whole frame retires before the authoritative readback collection. */
async function saveClaimedEdit(scope: CurrentSnapshotOwner, request: Request, outputId: string): Promise<Response | Readonly<{ operationSha256: string }>> {
  const disclosure = await collectCurrentDisclosure(scope, request, outputId), context = disclosure.edit?.context ?? fail();
  scope.retain(disclosure); await scope.prove(disclosure.parts, "before");
  await inspectCurrentMedia(scope, disclosure);
  let input: Awaited<ReturnType<typeof readClaimedEditMultipart>> | null = await readClaimedEditMultipart(scope, request);
  const value = input.value;
  try {
    if (!record(value) || value.resultByteLength !== input.png.length) throw new ClaimedImageEditError("invalid");
    scope.acceptEdited(input.png, [disclosure, value]);
    // Transfer the only parser-frame reference before the next await. The
    // private owner alone retains bytes through native PUT settlement.
    input = null;
    const qualified = await scope.wait(() => qualifyClaimedImageEditRequest({ context, value: value,
      monotonicDeadline: scope.monotonicDeadline, wallDeadline: scope.wallDeadline,
      outsideRetainedBytes: scope.writerAccounting([disclosure, value]),
    }));
    scope.current();
    if (qualified.status === "committed") {
      scope.releaseEdited(); return freeze({ operationSha256: qualified.operationSha256 });
    }
    scope.retainEdit([disclosure, value, qualified], qualified.expiresAt);
    await scope.inspectEdited({ sha256: qualified.request.resultMediaSha256, width: qualified.request.recipe.width,
      height: qualified.request.recipe.height, byteLength: qualified.request.resultByteLength });
    for (const source of qualified.ordinarySources) await verifyClaimedOrdinarySource(scope, disclosure, qualified, source, [disclosure, value, qualified]);
    if (qualified.unchanged) {
      const parts = claimedEditBefore(disclosure, qualified);
      scope.retainEdit([disclosure, value, qualified, parts]); await scope.proveEdit(parts);
      scope.releaseEdited(); scope.unchanged(); scope.finish(); return claimedEditReply({ status: "unchanged", code: "unchanged" });
    }
    const candidate = await scope.wait(() => buildClaimedImageEditCandidate({ context, qualified,
      revisionId: uuidV7(), eventId: uuidV7(), correlationId: uuidV7(), originalRevisionId: context.snapshot.revision === 0 ? uuidV7() : null,
      recordedAt: new Date().toISOString(), monotonicDeadline: scope.monotonicDeadline, wallDeadline: scope.wallDeadline,
      outsideRetainedBytes: scope.writerAccounting([disclosure, value, qualified]),
    }));
    const publication = claimedEditPublication(disclosure, qualified, candidate);
    const retained = [disclosure, value, qualified, candidate, publication];
    scope.retainEdit(retained, candidate.expiresAt); await scope.proveEdit(publication.before);
    const remaining = publication.before.length + 1 + publication.rows.length + publication.after.length + 33 + 1733 + 2 * 210;
    const object = await scope.put(candidate.mediaKey, candidate.metadata, remaining);
    if (!object) return fail();
    const target: ClaimedImageMediaEvidence = { media: candidate.record.media, revision: candidate.record.revision,
      mediaKey: candidate.mediaKey, metadata: candidate.metadata };
    const put = captureCurrentMetadata(scope, object, target); scope.retainEdit([retained, target, put]);
    await verifyClaimedEditDestination(scope, disclosure, candidate, put, [retained, target, put]);
    scope.releaseEdited();
    // Whether its original ACK is known or uncertain, only one actual batch is
    // dispatched. The next step is a full read of retained exact intent.
    await scope.publish(publication);
    return freeze({ operationSha256: candidate.operationSha256 });
  } finally {
    // Once transferred, only the private owner can zero this buffer, and it
    // waits for actual native PUT/inspection settlement even after a timeout.
    if (input) Reflect.apply(currentFill, input.png, [0]);
  }
}

/** Explicit, dormant claimed Save/Check. No default route, editor, Store or
 * host calls it. The original Request and its private owner span the complete
 * action; informational receipts and selectors cannot construct that owner. */
export function beginGuestImageResultEdit(request: Request, env: WorkerEnv,
  input: Readonly<{ outputId: string }>): GuestImageResultOperation<Response> {
  let owner: CurrentSnapshotOwner | undefined;
  const result = (async (): Promise<Response> => {
  try {
    const selector = capture(input);
    if (!record(selector) || !exactKeys(selector, ["outputId"]) || typeof selector.outputId !== "string"
      || !/^object-[a-f0-9]{8}$/u.test(selector.outputId)) return fail();
    owner = claimedEditOwner(request, env, selector.outputId);
    if (owner.action === "check") return await checkClaimedEdit(owner, request, selector.outputId, owner.checkOperation ?? fail());
    const result = await saveClaimedEdit(owner, request, selector.outputId);
    if (result instanceof Response) return result;
    owner.beginReadback();
    return await checkClaimedEdit(owner, request, selector.outputId, result.operationSha256);
  } catch (error) {
    if (owner?.writeAttempted()) return claimedEditReply({ status: "unconfirmed", code: "unconfirmed" });
    const code = error instanceof ClaimedImageEditError ? error.code : "unavailable";
    return claimedEditReply({ status: "refused", code }, code === "invalid" ? 400 : code === "source_changed" ? 409 : 503);
  } finally { owner?.dispose(); }
  })();
  return Object.freeze({ result, retire() { owner?.dispose(); } });
}
export async function handleGuestImageResultEdit(request: Request, env: WorkerEnv,
  input: Readonly<{ outputId: string }>): Promise<Response> {
  return await beginGuestImageResultEdit(request, env, input).result;
}

/** Original POST body only. The parser frame and fixed wire buffer retire
 * before canonical collection; no alternate Request or body authority exists. */
async function readClaimedLocalAdoptionCommand(scope: CurrentSnapshotOwner, request: Request): Promise<GuestImageResultLocalAdoptionCommand> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") throw new ClaimedImageEditError("invalid");
  const body = scope.beginAdoptionCommand(), reader = Reflect.apply(currentGetReader, body, []) as ReadableStreamDefaultReader<Uint8Array>;
  scope.accounting(null, 2 * CLAIMED_LOCAL_ADOPTION_PROFILE.commandBytes);
  const wire = new Uint8Array(CLAIMED_LOCAL_ADOPTION_PROFILE.commandBytes);
  const remove = scope.onCancel(() => { void Reflect.apply(currentCancelReader, reader, []).catch(() => undefined); });
  let offset = 0, reads = 0, complete = false;
  try {
    for (;;) {
      if (++reads > 8193) throw new ClaimedImageEditError("invalid"); scope.stream();
      const result: unknown = await scope.wait(() => Reflect.apply(currentReadChunk, reader, []));
      if (!record(result)) throw new ClaimedImageEditError("invalid");
      const done = Object.getOwnPropertyDescriptor(result, "done"), value = Object.getOwnPropertyDescriptor(result, "value");
      if (!done || !Object.hasOwn(done, "value") || value && !Object.hasOwn(value, "value")) throw new ClaimedImageEditError("invalid");
      if (done.value === true) {
        if (value?.value !== undefined || offset < 1) throw new ClaimedImageEditError("invalid"); complete = true; break;
      }
      const chunk = value?.value;
      if (done.value !== false || reads === 8193 || !(chunk instanceof Uint8Array) || Object.getPrototypeOf(chunk) !== Uint8Array.prototype) throw new ClaimedImageEditError("invalid");
      const length = Reflect.apply(currentByteLength, chunk, []), backing = Reflect.apply(currentBuffer, chunk, []);
      if (!(backing instanceof ArrayBuffer) || !Number.isSafeInteger(length) || length < 1 || length > wire.length - offset) throw new ClaimedImageEditError("invalid");
      Reflect.apply(currentSet, wire, [chunk, offset]); offset += length;
    }
    scope.accounting(null, CLAIMED_LOCAL_ADOPTION_PROFILE.commandBytes + 24 + 2 * offset + 64 + 82 * offset);
    let value: unknown;
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(wire.subarray(0, offset))); }
    catch { throw new ClaimedImageEditError("invalid"); }
    scope.accounting(value, CLAIMED_LOCAL_ADOPTION_PROFILE.commandBytes + adoptionLeafPairWork);
    const command = parseGuestImageResultLocalAdoptionCommand(value);
    if (!command) throw new ClaimedImageEditError("invalid");
    scope.endAdoptionCommand(command); return command;
  } finally {
    Reflect.apply(currentFill, wire, [0]); remove();
    if (!complete) { try { void Reflect.apply(currentCancelReader, reader, []).catch(() => undefined); } catch { /* Best effort. */ } }
    try { Reflect.apply(currentReleaseReader, reader, []); } catch { /* Actual pending read keeps its native lock. */ }
  }
}
function claimedLocalAdoptionPublication(disclosure: CurrentDisclosure): ClaimedLocalAdoptionPublication {
  const adoption = disclosure.adoption ?? fail(), snapshot = disclosure.snapshot, expected = [adoption.pair.receipt, adoption.pair.block];
  if (adoption.reuse) return freeze({ before: disclosure.parts, after: disclosure.parts, pair: adoption.pair, reuse: true, ownerId: snapshot.ownerId });
  if (adoption.version.streamGeneration + 4 >= SCENE_SOURCE_GENERATION_MAX || !Number.isSafeInteger(adoption.version.streamGeneration + 4)
    || expected[0]!.sequence !== adoption.totals.head + 1 || expected[1]!.sequence !== adoption.totals.head + 2
    || expected.some(event => event.streamId !== adoption.version.streamId)) return fail();
  const successor = sceneSourceVersionAssertions({ ...adoption.version, streamGeneration: adoption.version.streamGeneration + 4 })
    .map(value => ({ sql: value.sql, bindings: [...value.bindings ?? []] as Value[] }));
  const pairProofs = expected.flatMap(event => {
    const bindings = eventWriteBindings(event); if (typeof bindings[16] !== "string") return fail();
    const pair = eventEnvelope(event, bindings[16], snapshot.ownerId);
    return [exact("events", pair.event), exact("event_private_payloads", pair.envelope)];
  });
  const after = freeze([...adoption.canonicalParts, ...successor,
    { sql: `(SELECT COUNT(*) FROM artifact_revisions WHERE owner_id=? AND artifact_id IN (?,?))=?`,
      bindings: [snapshot.ownerId, adoption.artifactKey, snapshot.outputId, adoption.revisionCount] },
    ...adoption.revisionProofs,
    claimedEditProof([adoption.scopeProof, adoption.selectionProof, ...pairProofs,
      { sql: `(SELECT json_array(COUNT(*),COALESCE(MAX(e.sequence),0),
          COALESCE(SUM(length(CAST(e.payload AS BLOB))+COALESCE(length(CAST(p.private_json AS BLOB)),0)),0))
          FROM events e LEFT JOIN event_private_payloads p ON p.private_event_id=e.event_id WHERE e.stream_id=?)=?
        AND NOT EXISTS(SELECT 1 FROM event_write_stage WHERE event_id IN (?,?))`,
        bindings: [adoption.version.streamId, JSON.stringify([adoption.totals.count + 2, adoption.totals.head + 2, adoption.successorRawBytes]),
          adoption.pair.receipt.eventId, adoption.pair.block.eventId] }]),
  ]);
  if (disclosure.parts.length > 209 || after.length > 209 || disclosure.parts.length + 2 + after.length + 1 > 421) return fail();
  return freeze({ before: disclosure.parts, after, pair: adoption.pair, reuse: false, ownerId: snapshot.ownerId });
}
async function prepareClaimedLocalAdoption(scope: CurrentSnapshotOwner, request: Request, outputId: string): Promise<CurrentDisclosure> {
  const command = await readClaimedLocalAdoptionCommand(scope, request);
  return await collectLocalAdoptionDisclosure(scope, request, outputId, command);
}
/** Dormant, fixed body-free personal local-source producer. No route, host,
 * Store, reference-right grant or provider operation is activated here. */
export function beginGuestImageResultLocalSourceAdoption(request: Request, env: WorkerEnv,
  input: Readonly<{ outputId: string }>): GuestImageResultOperation<Response> {
  let owner: CurrentSnapshotOwner | undefined;
  const result = (async (): Promise<Response> => {
  try {
    const selector = capture(input);
    if (!record(selector) || !exactKeys(selector, ["outputId"]) || typeof selector.outputId !== "string"
      || !/^object-[a-f0-9]{8}$/u.test(selector.outputId)) throw new ClaimedImageEditError("invalid");
    owner = claimedLocalAdoptionOwner(request, env, selector.outputId);
    // The command/parser frame retires before retaining media work roots.
    const disclosure = await prepareClaimedLocalAdoption(owner, request, selector.outputId);
    owner.retain(disclosure); await owner.prove(disclosure.parts, "before");
    await inspectCurrentMedia(owner, disclosure);
    const plan = claimedLocalAdoptionPublication(disclosure); owner.retainAdoption([disclosure, plan]);
    const actual = await owner.completeAdoption(plan);
    if (!actual) return claimedEditReply({ status: "unconfirmed", code: "unconfirmed" });
    owner.finish(); const adoption = disclosure.adoption ?? fail();
    return claimedEditReply({ status: adoption.reuse ? "reused" : "adopted", blockId: adoption.blockId,
      referenceId: adoption.referenceId, sourceId: adoption.sourceId, head: adoption.head,
      appended: adoption.reuse ? [] : [actual.receipt, actual.block] });
  } catch (error) {
    if (owner?.adoptionAttempted()) return claimedEditReply({ status: "unconfirmed", code: "unconfirmed" });
    const invalid = error instanceof ClaimedImageEditError && error.code === "invalid";
    return claimedEditReply({ status: "refused", code: invalid ? "invalid_request" : "unavailable" }, invalid ? 400 : 503);
  } finally { owner?.dispose(); }
  })();
  return Object.freeze({ result, retire() { owner?.dispose(); } });
}
export async function adoptGuestImageResultLocalSource(request: Request, env: WorkerEnv,
  input: Readonly<{ outputId: string }>): Promise<Response> {
  return await beginGuestImageResultLocalSourceAdoption(request, env, input).result;
}

// A separate fixed negative-only operation. It never borrows a receipt/current
// owner, reads a lineage/body, repairs schema or invokes account lifecycle.
const CLAIMED_ORIGIN_PROFILE = Object.freeze({ statements: 8, deadlineMs: 30_000, headerBytes: 32_768,
  envelopeBytes: 1_048_576, schemaBytes: 262_144, schemaRows: 64, sqlBytes: 100_000, bindings: 100 });
function claimedOriginOwner(request: Request, env: WorkerEnv) {
  if (!(request instanceof Request)) return fail();
  const db = env.DB, media = env.MEDIA, signal = request.signal, url = request.url, method = request.method, requestBody = request.body;
  const headers = JSON.stringify(Array.from(request.headers)), cohort = env.FORMA_PILOT_COHORT_ID, admins = env.FORMA_ADMIN_EMAILS;
  if (bytes(headers) > CLAIMED_ORIGIN_PROFILE.headerBytes) return fail();
  const monotonicDeadline = performance.now() + CLAIMED_ORIGIN_PROFILE.deadlineMs, wallDeadline = Date.now() + CLAIMED_ORIGIN_PROFILE.deadlineMs;
  let stopped = false, statementCount = 0, retained: unknown = null;
  const waiters = new Set<() => void>();
  const stop = () => { if (stopped) return; stopped = true; for (const reject of waiters) reject(); waiters.clear(); };
  const current = () => {
    if (stopped || signal.aborted || request.signal !== signal || env.DB !== db || env.MEDIA !== media || request.url !== url
      || request.method !== method || request.body !== requestBody || JSON.stringify(Array.from(request.headers)) !== headers
      || env.FORMA_PILOT_COHORT_ID !== cohort || env.FORMA_ADMIN_EMAILS !== admins
      || performance.now() >= monotonicDeadline || Date.now() >= wallDeadline) { stop(); return fail(); }
  };
  current(); signal.addEventListener("abort", stop, { once: true });
  const timer = setTimeout(stop, Math.max(0, Math.min(monotonicDeadline - performance.now(), wallDeadline - Date.now())));
  const wait = async <T>(work: () => Promise<T>): Promise<T> => {
    current(); let rejectStop: () => void = () => undefined;
    const ended = new Promise<never>((_, reject) => { rejectStop = () => reject(new Error("claimed_origin_unavailable")); waiters.add(rejectStop); });
    const pending = Promise.resolve().then(() => { current(); return work(); });
    try { const value = await Promise.race([pending, ended]); current(); return value; }
    catch (error) { stop(); throw error; }
    finally { waiters.delete(rejectStop); void pending.catch(() => undefined); }
  };
  const detached = (value: unknown): unknown => {
    const seen = new Set<object>(); let nodes = 0, units = 0;
    const visit = (item: unknown, depth: number): void => {
      if (++nodes > 32_768 || depth > 32) return fail();
      if (item === null || item === undefined || typeof item === "boolean") return;
      if (typeof item === "number") { if (!Number.isFinite(item)) return fail(); return; }
      if (typeof item === "string") { if (!item.isWellFormed() || (units += item.length) > CLAIMED_ORIGIN_PROFILE.envelopeBytes) return fail(); return; }
      if (typeof item !== "object" || seen.has(item) || (Array.isArray(item) ? Object.getPrototypeOf(item) !== Array.prototype : !record(item))) return fail();
      seen.add(item); const descriptors = Object.getOwnPropertyDescriptors(item);
      if (Reflect.ownKeys(descriptors).some(key => typeof key !== "string")) return fail();
      for (const [key, field] of Object.entries(descriptors)) {
        if (Array.isArray(item) && key === "length") continue;
        units += key.length;
        if (units > CLAIMED_ORIGIN_PROFILE.envelopeBytes || ["__proto__", "prototype", "constructor"].includes(key)
          || !field.enumerable || !Object.hasOwn(field, "value") || Array.isArray(item) && !/^(0|[1-9]\d*)$/u.test(key)) return fail();
        visit(field.value, depth + 1);
      }
      if (Array.isArray(item) && (item.length > 128 || Object.keys(item).length !== item.length)) return fail();
    };
    visit(value, 0); const size = nativeEnvelopeSize(value);
    if (size > CLAIMED_ORIGIN_PROFILE.envelopeBytes) return fail();
    const reflectionSlot = (64 + 4 * 16 + 2 * (5 + 8 + 10 + 12) + 3 * 16 + 8) + (64 + 2 * 16) + 2 * 16 + 32;
    const roots = measureCurrentRetained([headers, url, method, cohort, admins, retained, value], CURRENT_SNAPSHOT_PROFILE.aggregateBytes);
    if (2 * roots + nodes * reflectionSlot + 4 * size > CURRENT_SNAPSHOT_PROFILE.aggregateBytes) return fail();
    return structuredClone(value);
  };
  const prepare = (sql: string, values: Value[] = []): D1PreparedStatement => {
    current(); if (typeof sql !== "string" || bytes(sql) > CLAIMED_ORIGIN_PROFILE.sqlBytes || !readOnlySql(sql)
      || values.length > CLAIMED_ORIGIN_PROFILE.bindings || values.some(value => value !== null && typeof value !== "string" && typeof value !== "number"
        || typeof value === "number" && !Number.isFinite(value) || typeof value === "string" && bytes(value) > CLAIMED_ORIGIN_PROFILE.envelopeBytes)) return fail();
    const all = async () => {
      current();
      const statement = db.prepare(sql).bind(...values);
      const raw = await wait(() => { current(); if (statementCount >= CLAIMED_ORIGIN_PROFILE.statements) return fail();
        statementCount++; return statement.all(); });
      const result = detached(raw);
      if (!record(result) || result.success !== true || result.error !== undefined || !Array.isArray(result.results) || result.results.length > 2) return fail();
      current(); return { ...result, results: result.results };
    };
    return { bind: (...input: unknown[]) => prepare(sql, input as Value[]), all,
      first: async (...input: unknown[]) => { if (input.length) return fail(); const result = await all(); return result.results[0] ?? null; },
      raw: fail, run: fail } as unknown as D1PreparedStatement;
  };
  const boundedDb = { prepare, batch: fail, exec: fail, dump: fail, withSession: fail } as unknown as WorkerEnv["DB"];
  const readEnv = new Proxy(env, { get(target, key, receiver) { current(); return key === "DB" ? boundedDb : Reflect.get(target, key, receiver); },
    set: fail, defineProperty: fail, deleteProperty: fail });
  return { db: boundedDb, env: readEnv, current, wait, count: () => statementCount,
    account(roots: unknown, reserve = 0) { current();
      if (!Number.isSafeInteger(reserve) || reserve < 0 || measureCurrentRetained([headers, url, method, cohort, admins, retained, roots], CURRENT_SNAPSHOT_PROFILE.aggregateBytes)
        + reserve > CURRENT_SNAPSHOT_PROFILE.aggregateBytes) return fail(); },
    retain(roots: unknown) { current(); measureCurrentRetained([headers, url, method, cohort, admins, roots]); retained = roots; },
    dispose() { stop(); clearTimeout(timer); signal.removeEventListener("abort", stop); } };
}
type ClaimedOriginOwner = ReturnType<typeof claimedOriginOwner>;
async function claimedOriginFamily(scope: Pick<ClaimedOriginOwner, "db" | "current"> & { account(roots: unknown, reserve?: number): void }): Promise<Readonly<{ absent: boolean; guard: ImageWitnessGuard }>> {
  const expected = GUEST_IMAGE_RESULT_COPY_SCHEMA.map(sql => {
    const match = /^CREATE (TABLE|INDEX|TRIGGER)(?: IF NOT EXISTS)? ([a-z_]+)/u.exec(sql);
    if (!match) return fail(); const table = match[1] === "TABLE" ? match[2] : /\bON ([a-z_]+)/u.exec(sql)?.[1];
    if (!table) return fail(); return { type: match[1].toLowerCase(), name: match[2], table, sql: normalizedDdl(sql) };
  });
  const tables = expected.filter(value => value.type === "table").map(value => value.name), names = expected.map(value => value.name);
  const catalog = `(SELECT json_group_array(json_object('type',type,'name',name,'table',tbl_name,'sql',definition)) FROM
    (SELECT type,name,tbl_name,CASE WHEN typeof(sql)='text' AND length(CAST(sql AS BLOB))<=32768 THEN sql ELSE NULL END AS definition
      FROM sqlite_schema WHERE lower(name) IN(SELECT value FROM json_each(?)) OR lower(tbl_name) IN(SELECT value FROM json_each(?))
        OR lower(name) GLOB 'experience_guest_image_result_*' ORDER BY name,type LIMIT 64))`;
  const values = [JSON.stringify(names), JSON.stringify(tables)];
  const row = await scope.db.prepare(`SELECT ${catalog} AS snapshot`).bind(...values).first<{ snapshot: unknown }>(); scope.current();
  const snapshot = body(row?.snapshot, CLAIMED_ORIGIN_PROFILE.schemaBytes);
  // One bounded catalog text parse; preserve original spelling for final proof.
  scope.account([expected, tables, names, values, row, snapshot], 64 + 82 * snapshot.length);
  const found: unknown = JSON.parse(snapshot);
  if (!Array.isArray(found) || found.length >= CLAIMED_ORIGIN_PROFILE.schemaRows || found.some(value => !record(value)
    || !exactKeys(value, ["type", "name", "table", "sql"]))) return fail();
  const guard: ImageWitnessGuard = { sql: `${catalog}=? AND NOT EXISTS(SELECT 1 FROM temp.sqlite_schema)`, bindings: [...values, snapshot] };
  if (!found.length) return freeze({ absent: true, guard });
  const explicit = found.filter(value => !(value.type === "index" && value.sql === null && tables.includes(value.table)
    && new RegExp(`^sqlite_autoindex_${value.table}_[1-9][0-9]*$`, "u").test(value.name)));
  if (explicit.length !== expected.length || new Set(explicit.map(value => value.name)).size !== expected.length
    || expected.some(wanted => !explicit.some(value => value.name === wanted.name && value.type === wanted.type && value.table === wanted.table
      && typeof value.sql === "string" && normalizedDdl(value.sql) === wanted.sql))) return fail();
  return freeze({ absent: false, guard });
}
async function claimedOriginSelection(scope: ClaimedOriginOwner, request: Request, outputId: string, mediaOwnerId?: string): Promise<GuestImageResultOriginSelection> {
  const family = await claimedOriginFamily(scope); scope.retain([family, outputId, mediaOwnerId]);
  const final = async (guard: ImageWitnessGuard) => {
    const row = await scope.db.prepare(`SELECT 1 AS current WHERE ${guard.sql}`).bind(...guard.bindings).first();
    scope.current(); if (!isCurrent(row)) return fail();
  };
  if (family.absent) {
    await final(family.guard); return freeze({ kind: "native", exclusion: family.guard, subjectId: null, statementCount: scope.count() });
  }
  const identity = mediaOwnerId === undefined ? identityFromRequest(request) : null;
  const subjectId = mediaOwnerId ?? identity?.userId;
  if (typeof subjectId !== "string" || !subjectId || bytes(subjectId) > 32_768) return fail();
  const marker = await scope.db.prepare(`SELECT custody_id FROM experience_guest_image_result_custodies
    WHERE destination_user_id=? AND output_id=? LIMIT 2`).bind(subjectId, outputId).all<{ custody_id: unknown }>(); scope.current();
  if (!Array.isArray(marker.results) || marker.results.length > 1 || marker.results.some(value => !record(value)
    || !exactKeys(value, ["custody_id"]) || typeof value.custody_id !== "string" || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(value.custody_id))) return fail();
  const exclusion: ImageWitnessGuard = { sql: `(${family.guard.sql}) AND NOT EXISTS(SELECT 1 FROM experience_guest_image_result_custodies WHERE destination_user_id=? AND output_id=?)`,
    bindings: [...family.guard.bindings, subjectId, outputId] };
  scope.retain([family, outputId, mediaOwnerId, identity, subjectId, marker, exclusion]);
  if (!marker.results.length) {
    await final(exclusion); return freeze({ kind: "native", exclusion, subjectId, statementCount: scope.count() });
  }
  if (mediaOwnerId !== undefined) return freeze({ kind: "refused", response: guestImagePersonalRefusal(), statementCount: scope.count() });
  const url = new URL(request.url), origin = request.headers.get("origin"), site = request.headers.get("sec-fetch-site");
  const operation = url.searchParams.get("operationSha256");
  if (!/^object-[a-f0-9]{8}$/u.test(outputId) || url.protocol !== "https:" || url.username || url.password || url.hash
    || url.pathname !== `/api/generated-images/${outputId}` || !["GET", "PATCH", "POST"].includes(request.method)) return fail();
  if (request.method === "GET" ? request.body !== null || !!url.search && (!operation || !/^[a-f0-9]{64}$/u.test(operation) || Array.from(url.searchParams).length !== 1)
    || origin !== null && origin !== url.origin : !!url.search || !request.body || request.bodyUsed || request.body.locked || origin !== url.origin) return fail();
  if (site !== null && site !== "same-origin" && site !== "none"
    || /(?:^|;\s*)(?:forma_project_context|forma_impersonation)=/u.test(request.headers.get("cookie") ?? "")) return fail();
  const auth = await scope.wait(() => readExistingPrincipalRequest(request, scope.env, "creator", { account: "principal" }));
  if ("kind" in auth || auth.response || !auth.user || requireConsent(auth.user) || auth.user.fictional || auth.user.projectExecution
    || auth.user.userId !== subjectId || auth.user.userId.startsWith("guest:") || auth.user.streamId !== `creative:${subjectId}`
    || !auth.user.access.capabilities.includes("project.author")) return fail();
  const custodyId = marker.results[0]?.custody_id; if (typeof custodyId !== "string") return fail();
  await final({ sql: `(${family.guard.sql}) AND (SELECT COUNT(*) FROM experience_guest_image_result_custodies WHERE destination_user_id=? AND output_id=?)=1
      AND EXISTS(SELECT 1 FROM experience_guest_image_result_custodies WHERE destination_user_id=? AND output_id=? AND custody_id=?)`,
    bindings: [...family.guard.bindings, subjectId, outputId, subjectId, outputId, custodyId] });
  return freeze({ kind: "claimed", statementCount: scope.count() });
}
export function beginGuestImageResultOriginRead(request: Request, env: WorkerEnv,
  input: Readonly<{ outputId: string }>): GuestImageResultOperation<GuestImageResultOriginSelection> {
  let owner: ClaimedOriginOwner | undefined;
  const result = (async (): Promise<GuestImageResultOriginSelection> => {
    try {
      // Native grammar is intentionally not replaced by claimed object8hex.
      const selector = capture(input);
      if (!record(selector) || !exactKeys(selector, ["outputId"]) || typeof selector.outputId !== "string" || bytes(selector.outputId) > 32_768) return fail();
      const outputId = selector.outputId; owner = claimedOriginOwner(request, env);
      return await claimedOriginSelection(owner, request, outputId);
    } catch { return freeze({ kind: "refused", response: guestImagePersonalRefusal(), statementCount: owner?.count() ?? 0 }); }
    finally { owner?.dispose(); }
  })();
  return Object.freeze({ result, retire() { owner?.dispose(); } });
}
export function beginGuestImageResultNativeMediaExclusion(request: Request, env: WorkerEnv,
  input: Readonly<{ outputId: string; ownerId: string }>): GuestImageResultOperation<GuestImageResultNativeSelection | GuestImageResultRefusedSelection> {
  let owner: ClaimedOriginOwner | undefined;
  const result = (async (): Promise<GuestImageResultNativeSelection | GuestImageResultRefusedSelection> => {
    try {
      const selector = capture(input);
      if (!record(selector) || !exactKeys(selector, ["outputId", "ownerId"]) || typeof selector.outputId !== "string" || typeof selector.ownerId !== "string"
        || !selector.ownerId || bytes(selector.outputId) > 32_768 || bytes(selector.ownerId) > 32_768
        || request.method !== "GET" || !new URL(request.url).pathname.startsWith("/api/media/")) return fail();
      const outputId = selector.outputId, ownerId = selector.ownerId; owner = claimedOriginOwner(request, env);
      const selected = await claimedOriginSelection(owner, request, outputId, ownerId);
      if (selected.kind === "claimed") return fail(); return selected;
    } catch { return freeze({ kind: "refused", response: guestImagePersonalRefusal(), statementCount: owner?.count() ?? 0 }); }
    finally { owner?.dispose(); }
  })();
  return Object.freeze({ result, retire() { owner?.dispose(); } });
}


/** Exact current principal tuple for an absence disclosure. This does not
 * initialize an account, borrow a project or grant creative authority. */
function claimedDraftPrincipal(env: WorkerEnv, actor: PilotUser): Proof {
  const snapshot = actor.authorizationSnapshot, pilot = configuredPilotAdmissionGuard(env, actor);
  if (!snapshot) return fail();
  return { sql: `EXISTS(SELECT 1 FROM(${PRINCIPAL_WITH_ACCESS_SQL}) principal
    WHERE (principal.user_id,principal.email,principal.role,principal.updated_at,principal.consent_version,
      COALESCE(principal.permission_epoch,''),COALESCE(principal.grants_json,'[]'),COALESCE(principal.organizations_json,'[]'),
      COALESCE(principal.projects_json,'[]'),COALESCE(principal.identity_policies_json,'[]'),COALESCE(principal.approved_canvas_requirements,0))=(?,?,?,?,?,?,?,?,?,?,?))
    AND (${pilot.sql})`, bindings: [actor.userId, actor.userId, actor.email, actor.role, snapshot.updatedAt, POLICY_VERSION,
      snapshot.rawEpoch, snapshot.grants, snapshot.organizations, snapshot.projects, snapshot.identityPolicies, snapshot.canvasRequirements, ...pilot.bindings] };
}
/** One owner-indexed prefix, at most129 rows, before any lineage JSON work.
 * MATERIALIZED prevents repeated extraction. The lazy CASE admits at most128
 * bounded text cells before json_extract executes exactly once per cell. A
 * malformed admitted JSON cell fails the SELECT; a 129th row never means
 * absent. Each evaluation parses at most128*262144 native text bytes; the
 * initial observation and two proofs total at most384 extractions. Native
 * SQLite allocation is opaque, separately from the JS retained ledger. */
const claimedDraftSelectorSql = `(WITH prefix AS MATERIALIZED (
    SELECT output_id,custody_id,lineage_json FROM experience_guest_image_result_custodies
      WHERE destination_user_id=? ORDER BY output_id LIMIT 129),
  safe AS MATERIALIZED (SELECT COUNT(*) AS count,COALESCE(MIN(CASE WHEN typeof(output_id)='text' AND length(output_id)=15
      AND typeof(custody_id)='text' AND length(custody_id)=36 AND typeof(lineage_json)='text'
      AND length(CAST(lineage_json AS BLOB)) BETWEEN 1 AND 262144 THEN 1 ELSE 0 END),1) AS valid FROM prefix),
  extracted AS MATERIALIZED (SELECT output_id,custody_id,
    CASE WHEN safe.count<=128 AND safe.valid=1 THEN json_extract(lineage_json,'$.saveLineage.draftId') ELSE NULL END AS draft_id
      FROM prefix CROSS JOIN safe),
  bounded AS MATERIALIZED (SELECT CASE WHEN typeof(output_id)='text' AND length(output_id)=15 THEN output_id ELSE NULL END AS output_id,
    CASE WHEN typeof(custody_id)='text' AND length(custody_id)=36 THEN custody_id ELSE NULL END AS custody_id,
    CASE WHEN typeof(draft_id)='text' AND length(draft_id)=81 THEN draft_id ELSE NULL END AS draft_id FROM extracted)
  SELECT json_object('count',safe.count,'valid',safe.valid,'cells',json(COALESCE((SELECT json_group_array(json_array(output_id,custody_id,draft_id)) FROM bounded),'[]'))) FROM safe)`;
async function selectClaimedDraft(scope: CurrentSnapshotOwner, request: Request, draftId: string): Promise<ClaimedDraftLookup | null> {
  const auth = await scope.wait(() => readExistingPrincipalRequest(request, scope.env, "creator", { account: "principal" }));
  if ("kind" in auth || auth.response || !auth.user || requireConsent(auth.user) || auth.user.fictional || auth.user.projectExecution
    || auth.user.userId.startsWith("guest:") || auth.user.streamId !== `creative:${auth.user.userId}`
    || !auth.user.access.capabilities.includes("project.author")) return fail();
  const actor = auth.user, principal = claimedDraftPrincipal(scope.env, actor), family = await claimedOriginFamily(scope);
  const absent = async (selector?: Proof) => {
    const parts = [principal, family.guard, ...(selector ? [selector] : [])], proof = claimedEditProof(parts);
    scope.accounting([auth, actor, principal, family, selector, parts, proof]);
    const row = await scope.db.prepare(`SELECT 1 AS current WHERE ${proof.sql}`).bind(...proof.bindings).first();
    scope.current(); if (!isCurrent(row)) return fail(); scope.absentReturned(); return null;
  };
  if (family.absent) return await absent();
  const row = await scope.db.prepare(`SELECT ${claimedDraftSelectorSql} AS snapshot`).bind(actor.userId).first<{ snapshot: unknown }>();
  scope.current(); const raw = body(row?.snapshot, CLAIMED_PERSONAL_DRAFT_PROFILE.selectorBytes);
  scope.accounting([auth, actor, principal, family, row, raw], 64 + 82 * raw.length);
  const found: unknown = JSON.parse(raw);
  if (!record(found) || !exactKeys(found, ["count", "valid", "cells"]) || typeof found.count !== "number"
    || !Number.isSafeInteger(found.count) || found.count < 0 || found.count > 128 || found.valid !== 1
    || !Array.isArray(found.cells) || found.cells.length !== found.count) return fail();
  const outputIds = new Set<string>(), custodyIds = new Set<string>();
  let chosen: Readonly<{ outputId: string; custodyId: string }> | null = null;
  for (const cell of found.cells) {
    if (!Array.isArray(cell) || cell.length !== 3 || typeof cell[0] !== "string" || !/^object-[a-f0-9]{8}$/u.test(cell[0])
      || typeof cell[1] !== "string" || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(cell[1])
      || typeof cell[2] !== "string" || !/^experience-draft-[a-f0-9]{64}$/u.test(cell[2])
      || outputIds.has(cell[0]) || custodyIds.has(cell[1])) return fail();
    outputIds.add(cell[0]); custodyIds.add(cell[1]);
    if (cell[2] === draftId) { if (chosen) return fail(); chosen = { outputId: cell[0], custodyId: cell[1] }; }
  }
  const selectorGuard: Proof = { sql: `${claimedDraftSelectorSql}=?`, bindings: [actor.userId, raw] };
  scope.accounting([auth, actor, principal, family, row, raw, found, outputIds, custodyIds, chosen, selectorGuard]);
  if (!chosen) return await absent(selectorGuard);
  return freeze({ ownerId: actor.userId, ...chosen, draftId, familyGuard: family.guard, selectorGuard });
}

/** The pinned wire leaf performs up to three captures (outer, draft probe,
 * inputs), each bounded by256 nodes/depth8. Four admitted shaped graphs cover
 * input/captures/validated result. Its three serialization checks reserve
 * escaped JSON strings and UTF8 scratch; the final Response owns one encoded
 * representation. These are finite logical reservations, not a heap claim. */
function claimedPersonalJson(scope: CurrentSnapshotOwner, value: GuestImageResultDraftView | GuestImageResultInputView | Readonly<{ status: "absent" }>, roots: unknown): Response {
  const units = scope.action === "inputs" ? CLAIMED_PERSONAL_INPUTS_PROFILE.replyBytes : CLAIMED_PERSONAL_DRAFT_PROFILE.selectorBytes;
  const jsonUnits = 6 * units + 32 * 256 + 2;
  const graph = 256 * (64 + 16 + 24) + 2 * units;
  const reflection = 9 * (64 + 256 * (64 + 4 * 16 + 2 * (5 + 8 + 10 + 12) + 3 * 16 + 8 + 64 + 2 * 16 + 2 * 16 + 32));
  const url = "media" in value ? value.media.url : "";
  scope.accounting([roots, value], 4 * graph + reflection + 3 * (24 + 3 * jsonUnits) + jsonUnits
    + 3 * (64 + 82 * 1024) + (url ? claimedImageEditMediaWork(url) : 0));
  scope.current(); const response = guestImagePersonalJson(value); scope.current(); return response;
}

/** Only an exact original key or the currently proved derivative can disclose
 * PNG bytes. The private owner survives the Response handoff until its own
 * original deadline, abort, cancel or final emitted chunk. */
export async function readGuestImageResultMediaResponse(request: Request, env: WorkerEnv,
  input: Readonly<{ mediaKey: string }>): Promise<Response> {
  let owner: CurrentSnapshotOwner | undefined, handed = false;
  try {
    const selector = capture(input);
    if (!record(selector) || !exactKeys(selector, ["mediaKey"]) || typeof selector.mediaKey !== "string" || bytes(selector.mediaKey) > 2048) return fail();
    const mediaKey = selector.mediaKey, parsed = parseGuestImageResultMediaUrl(`/api/media/${encodeURIComponent(mediaKey)}`);
    if (!parsed) return fail(); owner = completedImageOwner(request, env, mediaKey, "media");
    const disclosure = await collectPersonalDisclosure(owner, request, parsed.outputId), personal = disclosure.personal ?? fail();
    if (parsed.ownerId !== disclosure.snapshot.ownerId || parsed.custodyId !== disclosure.snapshot.claim.custodyId) return fail();
    const selected: ClaimedImageMediaEvidence = mediaKey === personal.originalKey
      ? { media: personal.initialMedia, revision: 0, mediaKey, metadata: personal.originalMetadata }
      : mediaKey === disclosure.mediaKey ? { media: disclosure.snapshot.media, revision: disclosure.snapshot.revision, mediaKey, metadata: disclosure.metadata } : fail();
    owner.retain(disclosure); await owner.prove(disclosure.parts, "before");
    await inspectCurrentMedia(owner, disclosure, selected); await owner.prove(disclosure.parts, "final");
    const response = owner.imageResponse(); owner.current(); handed = true; return response;
  } catch { return guestImagePersonalRefusal(); }
  finally { if (!handed) owner?.dispose(); }
}

/** Metadata-only restore; the original planner/prompt/stage bodies and PNG
 * are not loaded. Absence is a fresh exact owner-prefix observation, never a
 * partial-row, overflow, malformed-schema or failed-qualification fallback. */
export async function readGuestImageResultDraftResponse(request: Request, env: WorkerEnv,
  input: Readonly<{ draftId: string }>): Promise<Response> {
  let owner: CurrentSnapshotOwner | undefined;
  try {
    const selector = capture(input);
    if (!record(selector) || !exactKeys(selector, ["draftId"]) || typeof selector.draftId !== "string"
      || !/^experience-draft-[a-f0-9]{64}$/u.test(selector.draftId)) return fail();
    owner = completedImageOwner(request, env, selector.draftId, "draft");
    const lookup = await selectClaimedDraft(owner, request, selector.draftId);
    if (!lookup) { owner.finish(); return claimedPersonalJson(owner, { status: "absent" }, null); }
    const disclosure = await collectPersonalDisclosure(owner, request, lookup.outputId, lookup), personal = disclosure.personal ?? fail();
    owner.retain(disclosure); await owner.prove(disclosure.parts, "before"); await owner.prove(disclosure.parts, "final"); owner.finish();
    const snapshot = disclosure.snapshot;
    if (typeof snapshot.media.byteLength !== "number") return fail();
    const media = { ...snapshot.media, byteLength: snapshot.media.byteLength };
    const view: GuestImageResultDraftView = { version: 1, status: "claimed-result", draftId: personal.draftId,
      ownerId: snapshot.ownerId, projectId: snapshot.projectId, documentId: snapshot.documentId, outputId: snapshot.outputId,
      generationId: snapshot.generationId, sourceEventId: snapshot.sourceEventId, claim: snapshot.claim, title: personal.title,
      revision: snapshot.revision, editEventId: snapshot.editEventId, media, head: snapshot.head, expiresAt: disclosure.expiresAt };
    return claimedPersonalJson(owner, view, [lookup, disclosure]);
  } catch { return guestImagePersonalRefusal(); }
  finally { owner?.dispose(); }
}

/** Inspect exposes only original claimed input metadata and an optional
 * separately proved prompt-copy role. It does not hydrate a generic Store. */
export async function readGuestImageResultInputsResponse(request: Request, env: WorkerEnv,
  input: Readonly<{ outputId: string }>): Promise<Response> {
  let owner: CurrentSnapshotOwner | undefined;
  try {
    const selector = capture(input);
    if (!record(selector) || !exactKeys(selector, ["outputId"]) || typeof selector.outputId !== "string" || !/^object-[a-f0-9]{8}$/u.test(selector.outputId)) return fail();
    owner = completedImageOwner(request, env, selector.outputId, "inputs");
    const disclosure = await collectPersonalDisclosure(owner, request, selector.outputId), personal = disclosure.personal ?? fail();
    owner.retain(disclosure); await owner.prove(disclosure.parts, "before"); await owner.prove(disclosure.parts, "final"); owner.finish();
    const p = personal.canonical.payload;
    const view: GuestImageResultInputView = { schema_version: 2, origin: "guest-image-result-claim", claim: disclosure.snapshot.claim,
      output: { object_id: p.object_id, generation_id: p.generation_id, document_id: p.document_id, quality: "high", purpose: "final",
        prompt_technique: p.prompt_technique, provider: "openai", model: p.model_id, planner_model: "gpt-5.6-terra", source_surface: "outputs" },
      submitted_prompt: personal.prompt, retained_input_status: personal.prompt === null ? "unavailable" : "available",
      source_block_versions: p.source_block_versions, compile_event_id: null, document_snapshot: null, context_hash: null,
      reference_inputs: [], used_reference_pixels: false };
    return claimedPersonalJson(owner, view, disclosure);
  } catch { return guestImagePersonalRefusal(); }
  finally { owner?.dispose(); }
}

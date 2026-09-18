import { canonicalJson, digest, exactKeys, freeze, record } from "../src/experiences/compiler.ts";
import { parseGuestImageResultClaimEvent } from "../src/model/guest-image-result-presentation.ts";
import { publicEventPayload } from "./event-privacy.ts";
import type { EventRow } from "./event-write-primitives.ts";
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
import { readExistingPrincipalRequest, requireConsent } from "./principal-request-core.ts";
import { projectIntakeAuthority } from "./intake-authority.ts";
import { nativeMemoryAnswerExclusion } from "./memory-native-boundary.ts";
import { nativeStructuredOriginSchema } from "./memory-native-origin-schema.ts";
import { nativeDocumentJobOriginSchema } from "./memory-document-job-origin-schema.ts";
import { OUTPUT_REQUIREMENTS_SCHEMA } from "./output-requirements-schema.ts";
import type { WorkerEnv } from "./runtime.ts";
import { serializeEvent } from "./event-read-primitives.ts";
import { readImageWitness, imageWitnessAcknowledged } from "./generated-image-witness.ts";
import { qualifyClaimedImageCurrent, type ClaimedImageCurrentFacts } from "./generated-image-claimed-current.ts";
import { inspectOutputAsset, MAX_OUTPUT_ASSET_BYTES } from "../src/model/output-asset-inspection.ts";
import { measureRetainedState } from "../src/model/retained-state.ts";
import type { GuestImageResultEditSnapshot } from "../src/model/generated-image-revision.ts";

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

async function construct(value: unknown, fiveBodies: boolean, resultRole: "both" | "planner" = "both") {
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
  const resultBodies = arrayBodies(v.resultBodies, resultRole === "planner" ? 1 : 2, 65_536);
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
    // The fixed current-snapshot role needs the planner body. Both copy rows,
    // their original fixed expiries and the whole lineage remain unchanged.
    if (resultRole === "planner" && i !== 0) continue;
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
async function nativeTables(owner: ProofReadOwner, currentSnapshot = false): Promise<Proof> {
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
  if (expected.length !== (currentSnapshot ? 16 : 12)) return fail();
  const names = JSON.stringify(expected.map(item => item.name));
  const catalog = `(SELECT json_group_array(json_object('type',type,'name',name,'sql',definition)) FROM
    (SELECT type,name,CASE WHEN typeof(sql)='text' AND length(CAST(sql AS BLOB))<=16384 THEN sql ELSE NULL END AS definition
      FROM sqlite_schema WHERE name IN(SELECT value FROM json_each(?)) ORDER BY name LIMIT ${currentSnapshot ? 17 : 13}))`;
  const row = await owner.db.prepare(`SELECT ${catalog} AS snapshot`).bind(names).first<{ snapshot: string }>(); owner.current();
  const snapshot = owner.text(row?.snapshot, 65_536); let found: unknown;
  try { found = JSON.parse(snapshot); } catch { return fail(); }
  if (!Array.isArray(found) || found.length !== expected.length || expected.some(e => !found.some(item => record(item)
    && exactKeys(item, ["type", "name", "sql"]) && item.type === e.type && item.name === e.name && typeof item.sql === "string"
    && (normalize(item.sql) === e.sql || migration[e.name] !== undefined && normalize(item.sql) === normalize(migration[e.name]))))) return fail();
  return { sql: `${catalog}=? AND NOT EXISTS(SELECT 1 FROM temp.sqlite_schema)`, bindings: [names, snapshot] };
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
type CurrentPhase = "canonical" | "witness" | "qualify" | "before" | "get" | "inspect" | "head" | "final" | "returned";
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
function currentSnapshotOwner(request: Request, env: WorkerEnv, outputId: string) {
  if (!(request instanceof Request)) return fail();
  const db = env.DB, bucket = env.MEDIA, signal = request.signal, url = request.url, method = request.method;
  const headers = JSON.stringify(Array.from(request.headers)), origin = new URL(url), site = request.headers.get("sec-fetch-site");
  const suppliedOrigin = request.headers.get("origin"), cohort = env.FORMA_PILOT_COHORT_ID, admins = env.FORMA_ADMIN_EMAILS;
  if (method !== "GET" || request.body !== null || origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash
    || origin.pathname !== `/api/generated-images/${outputId}` || suppliedOrigin !== null && suppliedOrigin !== origin.origin
    || site !== null && site !== "same-origin" && site !== "none" || bytes(headers) > 32_768
    || /(?:^|;\s*)(?:forma_project_context|forma_impersonation)=/u.test(request.headers.get("cookie") ?? "")) return fail();
  const monotonicDeadline = performance.now() + CURRENT_SNAPSHOT_PROFILE.deadlineMs;
  const wallDeadline = Date.now() + CURRENT_SNAPSHOT_PROFILE.deadlineMs;
  let stopped = false, phase: CurrentPhase = "canonical", prefixLength = 16, canonicalReads = 0, witnessReads = 0, totalReads = 0;
  let witnessReservation = 0, memoryBatchUsed = false, beforeUsed = false, finalUsed = false, metadataCaptures = 0, metadataBytes = 0, streamReads = 0;
  let requestBytes = 0, resultBytes = 0, retainedBytes = 0, owned: Uint8Array<ArrayBuffer> | null = null, users = 0;
  let canonicalRetainedBytes = 0, witnessRetainedBytes = 0, witnessEvents = 0, witnessRevisions = 0, activeSqlBytes = 0, nativeCaptureScratch = 0;
  let requiredExpiresAt: number | null = null;
  let proofIdentity: readonly Proof[] | null = null;
  const waiters = new Set<() => void>(), cancellations = new Set<() => void>();
  const retire = () => { if (owned && users === 0) { Reflect.apply(currentFill, owned, [0]); owned = null; } };
  const stop = () => { if (stopped) return; stopped = true; for (const reject of waiters) reject(); waiters.clear();
    for (const cancel of cancellations) { try { cancel(); } catch { /* Best effort only. */ } } cancellations.clear(); retire(); };
  const current = () => {
    if (stopped || signal.aborted || request.signal !== signal || env.DB !== db || env.MEDIA !== bucket
      || request.url !== url || request.method !== method || request.body !== null || JSON.stringify(Array.from(request.headers)) !== headers
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
    waiterCount: waiters.size, cancellationCount: cancellations.size });
  const accounting = (roots: unknown, reserve = 0) => {
    current(); if (!Number.isSafeInteger(reserve) || reserve < 0) return fail();
    const measured = measureCurrentRetained([ownerData(), roots], CURRENT_SNAPSHOT_PROFILE.aggregateBytes);
    if (measured + reserve > CURRENT_SNAPSHOT_PROFILE.aggregateBytes) return fail(); return measured;
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
      if (Array.isArray(item) && (item.length > 256 || Object.keys(item).length !== item.length)) return fail();
    };
    visit(value, 0);
    const originalSize = measureCurrentRetained(value, CURRENT_SNAPSHOT_PROFILE.aggregateBytes);
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
    if (size > maximum || resultBytes > CURRENT_SNAPSHOT_PROFILE.statements * nativeEnvelopeBytes + 512 * 804) return fail();
    if (phase === "canonical") {
      canonicalRetainedBytes += originalSize;
      accounting(null, canonicalRetainedBytes + activeSqlBytes + nativeScratch);
    }
    return detached;
  };
  type Statement = { native: D1PreparedStatement; sql: string; values: Array<string | number | null> };
  const statements = new WeakMap<object, Statement>();
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
    current(); totalReads += queries.length; if (totalReads > CURRENT_SNAPSHOT_PROFILE.statements) return fail();
    if (phase === "canonical") { canonicalReads += queries.length; if (canonicalReads > prefixLength + 17) return fail(); }
    else if (phase === "witness") { if (queries.length !== witnessReservation) return fail(); witnessReservation = 0;
      witnessReads += queries.length; if (witnessReads > CURRENT_SNAPSHOT_PROFILE.witnessStatements) return fail(); }
    else if (phase !== "before" && phase !== "final") return fail();
    const sqlRoots = queries.map(query => ({ sql: query.sql, bindings: query.values }));
    activeSqlBytes = 2 * measureCurrentRetained(sqlRoots, CURRENT_SNAPSHOT_PROFILE.aggregateBytes);
    for (const query of queries) { const bound = bytes(JSON.stringify(query.values)); if (bound > nativeEnvelopeBytes) return fail();
      requestBytes += bytes(query.sql) + bound; activeSqlBytes += 4 * bound; }
    accounting(null, retainedBytes + canonicalRetainedBytes + witnessRetainedBytes + activeSqlBytes);
    if (requestBytes > CURRENT_SNAPSHOT_PROFILE.statements * (100_000 + nativeEnvelopeBytes)) return fail();
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
      current(); if (!Array.isArray(queries) || !queries.length || queries.length > CURRENT_SNAPSHOT_PROFILE.boundaryStatements) return fail();
      if (phase === "canonical") { if (memoryBatchUsed || queries.length !== 3) return fail(); memoryBatchUsed = true; }
      else if (phase === "witness") { if (queries.length !== witnessReservation || queries.length > CURRENT_SNAPSHOT_PROFILE.witnessGuardStatements) return fail(); }
      else if (phase === "before" || phase === "final") { if (!proofIdentity || queries.length !== proofIdentity.length) return fail(); }
      else return fail();
      const original = queries.map(query => statements.get(query) ?? fail()); charge(original);
      const perResult = phase === "before" || phase === "final" ? CURRENT_SNAPSHOT_PROFILE.guardEnvelopeBytes : nativeEnvelopeBytes;
      return wait(() => db.batch(original.map(query => query.native))).then(value => {
        const result = observe(value, queries.length * perResult + 512);
        if (!Array.isArray(result) || result.length !== queries.length || result.some(item => nativeEnvelopeSize(item) > perResult)) return fail();
        retainWitness(original, result);
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
    phase = boundary === "before" ? "get" : "returned";
  };
  let nativeGet: unknown, nativeHead: unknown;
  try {
    nativeGet = Reflect.get(bucket, "get", bucket); nativeHead = Reflect.get(bucket, "head", bucket);
    if (typeof nativeGet !== "function" || typeof nativeHead !== "function") return fail(); current();
  } catch (error) { stop(); clearTimeout(idleTimer); signal.removeEventListener("abort", stop); throw error; }
  return {
    db: boundedDb, env: readEnv, origin: origin.origin, current, wait, text: body, monotonicDeadline, wallDeadline,
    prefix(n: number) { current(); if (phase !== "canonical" || !Number.isSafeInteger(n) || n < 3 || n > 16) return fail(); prefixLength = n;
      if (canonicalReads > prefixLength + 17) return fail(); },
    beginWitness(roots: unknown) { current(); if (phase !== "canonical" || !memoryBatchUsed) return fail();
      canonicalRetainedBytes = accounting(roots); phase = "witness";
      // Version assertion/COUNT guards and their <=3 compact records are a
      // fixed source family. Retain their actual SELECTs in the first batch;
      // this reservation also covers the two accumulating array headers.
      witnessRetainedBytes = 2 * 64; },
    reserveWitness(n: number) { current(); if (phase !== "witness" || witnessReservation || !Number.isSafeInteger(n) || n < 1
      || n > CURRENT_SNAPSHOT_PROFILE.witnessGuardStatements || witnessReads + n > CURRENT_SNAPSHOT_PROFILE.witnessStatements) return fail(); witnessReservation = n; },
    endWitness(actual: number) { current(); if (phase !== "witness" || witnessReservation || actual !== witnessReads) return fail(); phase = "qualify"; },
    accounting,
    retain(value: CurrentDisclosure) { current(); if (phase !== "qualify" || requiredExpiresAt !== null) return fail();
      const expiry = Date.parse(value.expiresAt);
      if (!Number.isSafeInteger(expiry) || new Date(expiry).toISOString() !== value.expiresAt || expiry <= Date.now()) return fail();
      requiredExpiresAt = expiry;
      // Narrow this same owner's lifetime; never create a new deadline after
      // qualification. Both full SQL batches still check live DB-now clocks.
      clearTimeout(idleTimer);
      idleTimer = setTimeout(stop, Math.max(0, Math.min(monotonicDeadline - performance.now(), wallDeadline - Date.now(), expiry - Date.now())));
      canonicalRetainedBytes = 0; witnessRetainedBytes = 0;
      retainedBytes = measureCurrentRetained([ownerData(), value]); current(); },
    retainMedia(value: unknown) { current(); if (phase !== "inspect" && phase !== "head") return fail();
      retainedBytes = measureCurrentRetained([ownerData(), value]); },
    prove,
    get(key: string) { current(); if (phase !== "get" || !beforeUsed || owned) return fail(); phase = "inspect";
      return wait(() => Promise.resolve(Reflect.apply(nativeGet as (...args: unknown[]) => unknown, bucket, [key])), currentCancelObject); },
    metadata(size: number) { current(); if (phase !== "inspect" && phase !== "head" || !Number.isSafeInteger(size) || size < 0
      || ++metadataCaptures > CURRENT_SNAPSHOT_PROFILE.metadataCaptures || (metadataBytes += size) > CURRENT_SNAPSHOT_PROFILE.metadataBytes) return fail(); },
    stream() { current(); if (phase !== "inspect" || ++streamReads > CURRENT_SNAPSHOT_PROFILE.streamReads) return fail(); },
    own(size: number) { current(); if (phase !== "inspect" || owned || !Number.isSafeInteger(size) || size < 1 || size > MAX_OUTPUT_ASSET_BYTES
      || retainedBytes + size + CURRENT_SNAPSHOT_PROFILE.inspectorScratchBytes > CURRENT_SNAPSHOT_PROFILE.aggregateBytes) return fail();
      owned = new Uint8Array(size); return owned; },
    use<T>(value: Uint8Array<ArrayBuffer>, work: () => Promise<T>): Promise<T> {
      current(); if (phase !== "inspect" || value !== owned) return fail();
      return wait(() => { users++; let pending: Promise<T>;
        try { pending = Promise.resolve(work()); } catch (error) { users--; if (stopped) retire(); throw error; }
        return pending.finally(() => { users--; if (stopped) retire(); }); });
    },
    head(key: string) { current(); if (phase !== "inspect" || !owned || users) return fail(); phase = "head";
      return wait(() => Promise.resolve(Reflect.apply(nativeHead as (...args: unknown[]) => unknown, bucket, [key]))); },
    release() { current(); if (phase !== "head" || users) return fail(); retire(); },
    onCancel(cancel: () => void) { current(); if (cancellations.size >= 4) return fail(); cancellations.add(cancel); return () => cancellations.delete(cancel); },
    finish() { current(); if (phase !== "returned" || !finalUsed || owned) return fail(); },
    dispose() { stop(); clearTimeout(idleTimer); signal.removeEventListener("abort", stop); },
  };
}
type CurrentSnapshotOwner = ReturnType<typeof currentSnapshotOwner>;

type CurrentDisclosure = Readonly<{
  snapshot: Readonly<GuestImageResultEditSnapshot>; parts: readonly Proof[]; mediaKey: string;
  metadata: Readonly<Record<string, string>>; expiresAt: string;
}>;
function currentArtifactKey(outputId: string): string {
  return "generated-image/" + Array.from(new TextEncoder().encode(outputId), byte => byte.toString(16).padStart(2, "0")).join("");
}
function currentScopeProof(ownerId: string, custodyId: string, facts: ClaimedImageCurrentFacts): Proof {
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
  const facts = await scope.wait(() => qualifyClaimedImageCurrent({
    read: { ownerId: actor.userId, projectId: lineage.copy.manifest.projectId, documentId: lineage.copy.manifest.documentId,
      outputId, events, head: witness.head, planner: { contentRef: plannerCopy.content_id, rawJson, expiresAt: plannerCopy.expires_at, claim: graph.completedReview } },
    eventRows, revisionRows, monotonicDeadline: scope.monotonicDeadline, wallDeadline: scope.wallDeadline,
    outsideRetainedBytes,
  })); scope.current();
  const claimPairs = graph.afterGraph.eventEnvelopes.filter(pair => pair.event.event_id === graph.completedReview.claimEventId);
  if (claimPairs.length !== 1) return fail();
  const provedClaim = freeze(serializeEvent({ ...claimPairs[0]!.event, private_json: claimPairs[0]!.envelope.private_json }));
  // Join every header and the complete 29-field payload to the independently
  // reconstructed graph/privateDigest; a source counter alone is not this join.
  if (!same(facts.canonical, provedClaim)) return fail();
  const metadata: Readonly<Record<string, string>> = facts.snapshot.revision === 0 ? lineage.copy.destinationMetadata
    : facts.derivativeMetadata ?? fail();
  const compact: CurrentDisclosure = freeze({ snapshot: facts.snapshot,
    parts: [...canonicalParts, ...witness.guards, currentScopeProof(actor.userId, lineage.copy.custodyId, facts)],
    mediaKey: decodeURIComponent(facts.snapshot.media.url.slice("/api/media/".length)), metadata, expiresAt: facts.retainedExpiresAt });
  // No event/revision arrays or parsed lineage are retained by the returned
  // disclosure. All exact predicates survive in their bounded bindings.
  scope.accounting([canonicalRoots, witnessAccounting, eventRows, revisionRows, events, facts, claimPairs, provedClaim, metadata, compact]);
  measureCurrentRetained(compact); return compact;
}

type CurrentObjectMetadata = Readonly<{ size: number; httpEtag: string; key: string; version: string; etag: string;
  custom: Readonly<Record<string, string>>; http: readonly (readonly [string, string])[] }>;
function captureCurrentMetadata(scope: CurrentSnapshotOwner, object: unknown, disclosure: CurrentDisclosure): CurrentObjectMetadata {
  scope.current(); if (!object || typeof object !== "object") return fail();
  const size = Reflect.get(object, "size", object), httpEtag = Reflect.get(object, "httpEtag", object);
  const custom = Reflect.get(object, "customMetadata", object), write = Reflect.get(object, "writeHttpMetadata", object);
  scope.current();
  if (size !== disclosure.snapshot.media.byteLength || !Number.isSafeInteger(size) || size < 1 || size > MAX_OUTPUT_ASSET_BYTES
    || !currentText(httpEtag, 1024) || !httpEtag || !record(custom) || typeof write !== "function") return fail();
  const expected = disclosure.metadata, names = Reflect.ownKeys(custom), required = disclosure.snapshot.revision === 0 ? 12 : 14;
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
async function inspectCurrentMedia(scope: CurrentSnapshotOwner, disclosure: CurrentDisclosure): Promise<void> {
  const object = await scope.get(disclosure.mediaKey);
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null, complete = false;
  let removeCancel: (() => void) | undefined;
  try {
    const before = captureCurrentMetadata(scope, object, disclosure), body = object && Reflect.get(object, "body", object);
    scope.current(); if (!body) return fail();
    reader = Reflect.apply(currentGetReader, body, []) as ReadableStreamDefaultReader<Uint8Array>;
    const cancel = () => { if (reader) void Reflect.apply(currentCancelReader, reader, []).catch(() => undefined); };
    removeCancel = scope.onCancel(cancel); scope.retainMedia([disclosure, before]);
    const png = scope.own(before.size); let offset = 0;
    for (;;) {
      scope.stream(); const result: unknown = await scope.wait(() => Reflect.apply(currentReadChunk, reader!, []));
      if (!record(result)) return fail();
      const done = Object.getOwnPropertyDescriptor(result, "done"), value = Object.getOwnPropertyDescriptor(result, "value");
      if (!done || !Object.hasOwn(done, "value") || value && !Object.hasOwn(value, "value")) return fail();
      if (done.value === true) { if (value?.value !== undefined || offset !== before.size) return fail(); complete = true; break; }
      const chunk = value?.value;
      if (done.value !== false || !(chunk instanceof Uint8Array) || Object.getPrototypeOf(chunk) !== Uint8Array.prototype) return fail();
      const length = Reflect.apply(currentByteLength, chunk, []), backing = Reflect.apply(currentBuffer, chunk, []);
      if (!(backing instanceof ArrayBuffer) || !Number.isSafeInteger(length) || length < 1 || length > png.byteLength - offset) return fail();
      Reflect.apply(currentSet, png, [chunk, offset]); offset += length;
    }
    if (png.length < 8 || [137, 80, 78, 71, 13, 10, 26, 10].some((value, index) => png[index] !== value)) return fail();
    const inspected = await scope.use(png, () => inspectOutputAsset(png, "image.png", { snapshot: false }));
    scope.current();
    const expected = disclosure.snapshot.media;
    if (inspected.status !== "inspected" || inspected.kind !== "image" || inspected.mimeType !== "image/png" || inspected.extension !== "png"
      || inspected.byteLength !== expected.byteLength || inspected.sha256 !== expected.sha256
      || inspected.facts.width !== expected.width || inspected.facts.height !== expected.height) return fail();
    scope.retainMedia([disclosure, before, inspected]);
    const after = captureCurrentMetadata(scope, await scope.head(disclosure.mediaKey), disclosure);
    if (!sameCurrentMetadata(before, after)) return fail();
    scope.retainMedia([disclosure, before, inspected, after]);
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
export async function readGuestImageResultCurrentSnapshot(request: Request, env: WorkerEnv,
  input: Readonly<{ outputId: string }>): Promise<Readonly<GuestImageResultEditSnapshot> | null> {
  let owner: CurrentSnapshotOwner | undefined;
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
    owner.finish(); return disclosure.snapshot;
  } catch { return null; }
  finally { owner?.dispose(); }
}

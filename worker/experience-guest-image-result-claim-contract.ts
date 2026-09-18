import { canonicalJson, digest, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import type { GuestImageCopyPrefixLineage } from "./experience-guest-image-copy-contract.ts";
import { readGuestImageClaimLineage, type GuestImageClaimLineage } from "./experience-guest-image-claim.ts";
import { readGuestImageStageClaimLineage, guestImageStageHistoryIdentity,
  type GuestImageStageClaimLineage, type GuestImageStageCopyRow } from "./experience-guest-image-stage-custody.ts";
import { validateGuestImageResultCopyDescriptor, guestImageResultMediaKey, guestImageResultOriginalOutputId,
  type GuestImageResultCopyDescriptor } from "./experience-guest-image-result-copy-contract.ts";

/** Closed historical values only. Neither parsing, hashing nor projecting these
 * values observes a database, grants custody, or authorizes a private read. */
export type GuestImageResultHistoryRole = "planner" | "prompt";
export type GuestImageResultHistoryCopy = Readonly<{
  custody_id: string; role: GuestImageResultHistoryRole; content_id: string;
  original_content_id: string; original_kind: "provider-output" | "prompt";
  original_digest: string; byte_length: number; created_at: string; expires_at: string;
}>;
export type GuestImageResultClaimEventOrigin = Readonly<{
  version: 1; kind: "guest-image-result-event-origin-v1"; custodyId: string; claimEventId: string;
  outputId: string; generationId: string; manifestDigest: string;
}>;
export type GuestImageResultCompletedCustodyReview = Readonly<{
  version: 1; kind: "guest-image-result-completed-review-v1"; custodyId: string; claimEventId: string; lineageDigest: string;
}>;
export type GuestImageResultClaimLineage = Readonly<{
  version: 1; kind: "original-image-result-custody"; copy: GuestImageResultCopyDescriptor;
  contextLineage: GuestImageCopyPrefixLineage; contextLineageDigest: string;
  saveLineage: GuestImageClaimLineage; saveLineageDigest: string;
  stageLineage: GuestImageStageClaimLineage; stageLineageDigest: string;
  stageCopies: readonly [GuestImageStageCopyRow, GuestImageStageCopyRow, GuestImageStageCopyRow];
  resultCopies: readonly [GuestImageResultHistoryCopy, GuestImageResultHistoryCopy];
  originalCompletion: Readonly<{ eventId: string; sequence: number; occurredAt: string; recordedAt: string;
    privateDigest: string; objectId: string; model: string; provider: string; adapter: string; providerRequestId: string }>;
  canonical: Readonly<{ eventId: string; streamId: string; sequence: number; occurredAt: string; recordedAt: string;
    privateDigest: string; expiresAt: string }>;
}>;
export type GuestImageResultCustodyRow = Readonly<{
  custody_id: string; session_id: string; destination_user_id: string; lease_id: string; lease_acquisition: number;
  request_id: string; manifest_digest: string; native_snapshot_digest: string; context_lineage_digest: string;
  save_lineage_digest: string; stage_lineage_digest: string; claim_event_id: string; claim_event_sequence: number;
  original_completion_event_id: string; generation_id: string; output_id: string; copy_attempt_id: string;
  lineage_json: string; lineage_digest: string; created_at_ms: number; canonical_expires_at: string;
}>;

const fail = (): never => { throw new Error("guest_image_result_claim_contract_invalid"); };
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const integer = (value: unknown, minimum = 0): value is number => typeof value === "number" && Number.isSafeInteger(value)
  && value >= minimum && value <= 8_000_000_000_000;
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
const iso = (value: unknown): value is string => typeof value === "string" && value.length === 24
  && Number.isSafeInteger(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
const same = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);

// Lease request history has its own 16,301-byte native bound. Do not apply the
// interface compiler's 8,192-character string limit to the complete lineage.
// This bounded input check never reads an accessor or accepts object aliases.
function plain(value: unknown): void {
  const seen = new Set<object>(); let count = 0;
  function visit(v: unknown, depth: number) {
    if (++count > 8192 || depth > 16) return fail();
    if (v === null || typeof v === "boolean") return;
    if (typeof v === "number") { if (!Number.isFinite(v)) fail(); return; }
    if (typeof v === "string") { if (!v.isWellFormed() || bytes(v) > 65_536 || v.includes("\0")) fail(); return; }
    if (typeof v !== "object" || (Array.isArray(v) ? Object.getPrototypeOf(v) !== Array.prototype : !record(v)) || seen.has(v)) return fail();
    seen.add(v);
    const entries = Object.getOwnPropertyDescriptors(v);
    if (Reflect.ownKeys(entries).some(key => typeof key !== "string")) return fail();
    for (const [key, descriptor] of Object.entries(entries)) {
      if (Array.isArray(v) && key === "length") continue;
      if (["__proto__", "prototype", "constructor"].includes(key) || !descriptor.enumerable || descriptor.get || descriptor.set
        || Array.isArray(v) && !/^(0|[1-9]\d*)$/u.test(key)) return fail();
      visit(descriptor.value, depth + 1);
    }
    if (Array.isArray(v) && (v.length > 100 || Object.keys(v).length !== v.length)) return fail();
  }
  visit(value, 0);
  if (bytes(canonicalJson(value)) > 262_144) fail();
}

function prefix(value: unknown, copy: GuestImageResultCopyDescriptor): GuestImageCopyPrefixLineage {
  const m = copy.manifest;
  if (!record(value) || !exactKeys(value, ["version", "sessionId", "guestSubject", "projectId", "documentId", "draftHash", "manifestDigest",
    "sourceEventIds", "sourceHead", "destinationUserId", "origin", "targetStart", "targetHead", "events", "lease"])
    || value.version !== 1 || value.sessionId !== m.sessionId || value.guestSubject !== m.guestSubject
    || value.projectId !== m.projectId || value.documentId !== m.documentId || value.draftHash !== m.draftHash
    || value.manifestDigest !== copy.manifestDigest || value.destinationUserId !== copy.destinationUserId
    || !same(value.sourceEventIds, m.sourceEventIds) || value.sourceHead !== m.sourceHead || !same(value.lease, copy.leaseSnapshot)
    || !integer(value.targetStart, 1) || value.targetHead !== value.targetStart + m.sourceHead - 1
    || !Array.isArray(value.events) || value.events.length !== m.sourceHead || typeof value.origin !== "string") return fail();
  let origin: URL; try { origin = new URL(value.origin); } catch { return fail(); }
  if (origin.protocol !== "https:" || origin.origin !== value.origin) return fail();
  const ids = new Set<string>(), blocks = new Set<string>();
  for (const [index, event] of value.events.entries()) {
    if (!record(event) || !exactKeys(event, ["id", "sequence", "occurred", "recorded", "type", "public", "privateDigest", "project", "document", "key"])
      || !uuid(event.id) || ids.has(event.id) || m.sourceEventIds.includes(event.id) || !hash(event.privateDigest)
      || event.sequence !== value.targetStart + index || !iso(event.occurred) || event.occurred !== event.recorded
      || event.type !== (["ProjectCreated", "DocumentCreated", "EmptyCanvasChosen"][index] ?? "BlockCreated")
      || event.project !== m.projectId || event.document !== (event.type === "ProjectCreated" ? null : m.documentId)
      || event.key !== `guest-context-adoption:v1:${m.sessionId}:${index}` || typeof event.public !== "string" || bytes(event.public) > 8192) return fail();
    let payload: unknown; try { payload = JSON.parse(event.public); } catch { return fail(); }
    if (!record(payload) || jsonIssues(payload).length || payload._private_ref !== event.id || payload.project_id !== m.projectId
      || payload.client_event_id !== event.key || (payload.document_id ?? null) !== (index === 0 ? null : m.documentId)) return fail();
    if (index >= 3) {
      if (!uuid(payload.block_id) || blocks.has(payload.block_id)) return fail();
      blocks.add(payload.block_id);
    }
    ids.add(event.id);
  }
  return value as unknown as GuestImageCopyPrefixLineage;
}

/** Deterministic copied identity; the digest is not a content read capability. */
export async function guestImageResultHistoryIdentity(input: {
  sessionId: string; destinationUserId: string; manifestDigest: string; role: GuestImageResultHistoryRole; originalDigest: string;
}): Promise<string> {
  plain(input);
  if (!record(input) || !exactKeys(input, ["sessionId", "destinationUserId", "manifestDigest", "role", "originalDigest"])
    || typeof input.sessionId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(input.sessionId)
    || typeof input.destinationUserId !== "string" || !input.destinationUserId || bytes(input.destinationUserId) > 200
    // eslint-disable-next-line no-control-regex -- Canonical owner identifiers must exclude ASCII controls.
    || /[\u0000-\u001f\u007f]/u.test(input.destinationUserId) || input.destinationUserId.startsWith("guest:")
    || /^forma-guest-(session|claim)-v1\./u.test(input.destinationUserId) || !hash(input.manifestDigest) || !hash(input.originalDigest)
    || !["planner", "prompt"].includes(input.role)) return fail();
  return `guest-image-result-history-${(await digest({ domain: "forma-guest-image-result-history@1", ...input })).slice(7)}`;
}

/** A canonical event commits stable source identity, never the digest of the
 * whole lineage that itself commits this event's private-envelope digest. */
export function readGuestImageResultClaimEventOrigin(value: unknown): GuestImageResultClaimEventOrigin {
  plain(value);
  if (!record(value) || !exactKeys(value, ["version", "kind", "custodyId", "claimEventId", "outputId", "generationId", "manifestDigest"])
    || value.version !== 1 || value.kind !== "guest-image-result-event-origin-v1" || !uuid(value.custodyId) || !uuid(value.claimEventId)
    || !uuid(value.generationId) || value.outputId !== guestImageResultOriginalOutputId(value.generationId) || !hash(value.manifestDigest)) return fail();
  return freeze(structuredClone(value)) as GuestImageResultClaimEventOrigin;
}

/** Inert shape for a future fresh completed-custody reader. Parsing alone does
 * not establish freshness or confer any permission. This is not event payload. */
export function readGuestImageResultCompletedCustodyReview(value: unknown): GuestImageResultCompletedCustodyReview {
  plain(value);
  if (!record(value) || !exactKeys(value, ["version", "kind", "custodyId", "claimEventId", "lineageDigest"])
    || value.version !== 1 || value.kind !== "guest-image-result-completed-review-v1" || !uuid(value.custodyId) || !uuid(value.claimEventId)
    || !hash(value.lineageDigest)) return fail();
  return freeze(structuredClone(value)) as GuestImageResultCompletedCustodyReview;
}

/** Validate a proposed complete mapping. This does not establish that any event,
 * body, copy, lease or financial row exists, is current, or was ever published. */
export async function readGuestImageResultClaimLineage(value: unknown): Promise<GuestImageResultClaimLineage> {
  plain(value);
  if (!record(value) || !exactKeys(value, ["version", "kind", "copy", "contextLineage", "contextLineageDigest", "saveLineage", "saveLineageDigest",
    "stageLineage", "stageLineageDigest", "stageCopies", "resultCopies", "originalCompletion", "canonical"])
    || value.version !== 1 || value.kind !== "original-image-result-custody") return fail();
  // Snapshot all input before the first await; callers cannot rewrite a future
  // mapping while hashing its earlier members.
  const v = structuredClone(value);
  const copy = await validateGuestImageResultCopyDescriptor(v.copy), m = copy.manifest;
  const context = prefix(v.contextLineage, copy);
  const save = readGuestImageClaimLineage(canonicalJson(v.saveLineage));
  const stage = readGuestImageStageClaimLineage(canonicalJson(v.stageLineage));
  if (!hash(v.contextLineageDigest) || v.contextLineageDigest !== await digest(context)
    || !hash(v.saveLineageDigest) || v.saveLineageDigest !== await digest(save)
    || !hash(v.stageLineageDigest) || v.stageLineageDigest !== await digest(stage)) return fail();
  for (const lineage of [save, stage]) if (lineage.sessionId !== m.sessionId || lineage.guestSubject !== m.guestSubject
    || lineage.destinationUserId !== copy.destinationUserId || lineage.projectId !== m.projectId || lineage.documentId !== m.documentId
    || lineage.manifestDigest !== copy.manifestDigest || lineage.contextLineageDigest !== v.contextLineageDigest) return fail();
  if (save.draftHash !== m.draftHash || save.source.contentDigest !== m.contentDigest || !same(save.source.eventIds, m.sourceEventIds)
    || save.source.head !== m.sourceHead || save.source.save.sequence !== m.sourceSaveHead || save.origin !== context.origin
    || save.target.contextHead !== context.targetHead || stage.saveLineageDigest !== v.saveLineageDigest
    || stage.source.state !== "quoted" || stage.source.head !== m.sourceHead || stage.source.saveHead !== m.sourceSaveHead
    || stage.source.stageHead !== m.quoteHead || stage.source.saveEventId !== save.source.save.id
    || stage.source.expiresAt !== save.source.expiresAt || m.expiresAt > stage.source.expiresAt
    || stage.source.originalPayerUserId !== m.originalPayerUserId || stage.source.quote?.preflightId !== m.nativeIdentity.preflightId
    || stage.source.quote.planRevisionId !== m.nativeIdentity.planRevisionId) return fail();

  const completion = v.originalCompletion, canonical = v.canonical;
  if (!record(completion) || !exactKeys(completion, ["eventId", "sequence", "occurredAt", "recordedAt", "privateDigest", "objectId", "model", "provider", "adapter", "providerRequestId"])
    || completion.eventId !== m.completionEventId || completion.sequence !== m.resultHead - 1
    || !iso(completion.occurredAt) || completion.occurredAt !== completion.recordedAt || completion.recordedAt > m.completedAt
    || !hash(completion.privateDigest) || completion.objectId !== guestImageResultOriginalOutputId(m.generationId)
    || ["model", "provider", "adapter", "providerRequestId"].some(key => completion[key] !== copy.source.producerMetadata[key as keyof typeof copy.source.producerMetadata])
    || !record(canonical) || !exactKeys(canonical, ["eventId", "streamId", "sequence", "occurredAt", "recordedAt", "privateDigest", "expiresAt"])
    || !uuid(canonical.eventId) || canonical.streamId !== `creative:${copy.destinationUserId}` || canonical.sequence !== save.target.sequence + 1
    || !iso(canonical.occurredAt) || canonical.occurredAt !== canonical.recordedAt || !hash(canonical.privateDigest) || !iso(canonical.expiresAt)
    || canonical.recordedAt < m.completedAt || canonical.recordedAt >= m.expiresAt
    || Date.parse(canonical.recordedAt) < copy.leaseSnapshot.created_at_ms || Date.parse(canonical.recordedAt) >= copy.leaseSnapshot.expires_at_ms) return fail();
  const eventIds = [...m.sourceEventIds, save.source.save.id, stage.source.confirmation.id, stage.source.quote.id,
    m.completionEventId, m.usageEventId, ...context.events.map(event => event.id), save.target.id, canonical.eventId];
  const canonicalRecordedAt = canonical.recordedAt;
  if (new Set(eventIds).size !== eventIds.length || context.events.some(event => event.recorded > canonicalRecordedAt)
    || save.target.recorded > canonical.recordedAt || context.events.slice(3).some(event =>
      (JSON.parse(event.public) as Record<string, unknown>).block_id === save.target.requirementId)) return fail();

  if (!Array.isArray(v.stageCopies) || v.stageCopies.length !== 3 || !Array.isArray(v.resultCopies) || v.resultCopies.length !== 2) return fail();
  const copiedIds: string[] = [];
  for (const [index, raw] of v.stageCopies.entries()) {
    const expected = stage.copies[index];
    if (!record(raw) || !exactKeys(raw, ["session_id", "role", "content_id", "original_digest", "byte_length", "created_at", "expires_at"])
      || raw.session_id !== m.sessionId || raw.role !== expected.role || raw.content_id !== expected.contentId
      || raw.original_digest !== expected.digest || raw.byte_length !== expected.bytes || !iso(raw.created_at) || !iso(raw.expires_at)
      || Date.parse(raw.created_at) < copy.leaseSnapshot.created_at_ms || raw.created_at > canonical.recordedAt || raw.expires_at <= canonical.recordedAt
      || raw.content_id !== await guestImageStageHistoryIdentity({ sessionId: m.sessionId, destinationUserId: copy.destinationUserId,
        manifestDigest: copy.manifestDigest, role: expected.role, originalDigest: expected.digest })) return fail();
    copiedIds.push(String(raw.content_id));
  }
  for (const [index, raw] of v.resultCopies.entries()) {
    const role = index === 0 ? "planner" : "prompt", source = m.privateContents[index];
    if (!record(raw) || !exactKeys(raw, ["custody_id", "role", "content_id", "original_content_id", "original_kind", "original_digest", "byte_length", "created_at", "expires_at"])
      || raw.custody_id !== copy.custodyId || raw.role !== role || raw.original_content_id !== source.contentId
      || raw.original_kind !== source.kind || raw.original_digest !== source.contentDigest || raw.byte_length !== source.bytes
      || !integer(raw.byte_length, 1) || raw.byte_length > 65_536 || !iso(raw.created_at) || !iso(raw.expires_at)
      || Date.parse(raw.created_at) < copy.leaseSnapshot.created_at_ms || raw.created_at > canonical.recordedAt || raw.expires_at <= canonical.recordedAt
      || raw.content_id !== await guestImageResultHistoryIdentity({ sessionId: m.sessionId, destinationUserId: copy.destinationUserId,
        manifestDigest: copy.manifestDigest, role, originalDigest: source.contentDigest })) return fail();
    copiedIds.push(String(raw.content_id));
  }
  if (new Set(copiedIds).size !== 5 || m.privateContents.some(source => copiedIds.includes(source.contentId))
    || canonical.expiresAt !== v.resultCopies.map(raw => String(raw.expires_at)).sort()[0]) return fail();
  return freeze(v) as unknown as GuestImageResultClaimLineage;
}

/** Row values for a future atomic writer, not SQL, an insert or a claim proof. */
export async function guestImageResultClaimRows(value: unknown): Promise<Readonly<{
  custody: GuestImageResultCustodyRow; copies: readonly [GuestImageResultHistoryCopy, GuestImageResultHistoryCopy];
  eventOrigin: GuestImageResultClaimEventOrigin; completedReview: GuestImageResultCompletedCustodyReview;
}>> {
  const lineage = await readGuestImageResultClaimLineage(value), c = lineage.copy, m = c.manifest;
  const lineageDigest = await digest(lineage);
  return freeze({ custody: {
    custody_id: c.custodyId, session_id: m.sessionId, destination_user_id: c.destinationUserId, lease_id: c.leaseSnapshot.lease_id,
    lease_acquisition: c.leaseSnapshot.acquisitions, request_id: c.requestId, manifest_digest: c.manifestDigest,
    native_snapshot_digest: m.nativeSnapshotDigest, context_lineage_digest: lineage.contextLineageDigest,
    save_lineage_digest: lineage.saveLineageDigest, stage_lineage_digest: lineage.stageLineageDigest,
    claim_event_id: lineage.canonical.eventId, claim_event_sequence: lineage.canonical.sequence,
    original_completion_event_id: m.completionEventId, generation_id: m.generationId,
    output_id: guestImageResultOriginalOutputId(m.generationId), copy_attempt_id: c.attemptId,
    lineage_json: canonicalJson(lineage), lineage_digest: lineageDigest,
    created_at_ms: Date.parse(lineage.canonical.recordedAt), canonical_expires_at: lineage.canonical.expiresAt,
  }, copies: lineage.resultCopies, eventOrigin: {
    version: 1, kind: "guest-image-result-event-origin-v1", custodyId: c.custodyId, claimEventId: lineage.canonical.eventId,
    outputId: guestImageResultOriginalOutputId(m.generationId), generationId: m.generationId, manifestDigest: c.manifestDigest,
  }, completedReview: {
    version: 1, kind: "guest-image-result-completed-review-v1", custodyId: c.custodyId, claimEventId: lineage.canonical.eventId, lineageDigest,
  } });
}

/** Structural original/revision association only; published/current-custody
 * readers must independently observe the exact canonical event and copy. */
export function guestImageResultClaimMediaAssociation(input: {
  destinationUserId: string; custodyId: string; outputId: string; revisionId?: string;
}): string {
  return guestImageResultMediaKey(input);
}

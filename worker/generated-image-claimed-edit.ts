import type { CreativeEvent, CreativeOutput } from "../src/model/events.ts";
import type { GuestImageResultEditRead } from "../src/model/generated-image-edit-current.ts";
import { parseGuestImageResultMediaUrl } from "../src/model/generated-image-edit.ts";
import { guestImageResultEditOperationSha256, parseGuestImageResultEditRequest, parseGuestImageResultRevision,
  projectGuestImageResultEdit, type GuestImageResultEditRequest, type GuestImageResultEditSnapshot,
  type GuestImageResultRevision } from "../src/model/generated-image-revision.ts";
import { creativeContextRightsValidity } from "../src/model/context-health.ts";
import { referenceCompositionMediaUrl, referenceCompositionSources, validateReferenceComposition } from "../src/model/reference-composition.ts";
import { mediaKeyMatchesOwnerNamespace, ownerMediaNamespace } from "../src/model/media-ownership.ts";
import { measureRetainedState } from "../src/model/retained-state.ts";
import { outputAssetSha256 } from "../src/model/output-asset-inspection.ts";
import { eventWriteBindings } from "./event-write-primitives.ts";
import { serializeEvent } from "./event-read-primitives.ts";
import { claimedImageEditMediaWork, claimedImageEditOperationWork, claimedImageEditRecipeWork, claimedImageEditRequestWork, claimedImageEditRevisionWork,
  claimedImageRevisionMetadata, qualifyClaimedImageEditProjection, type ClaimedImageCurrentFacts,
  type ClaimedImageOrigin, type ClaimedImageMedia, type ClaimedImageRevisionMetadata } from "./generated-image-claimed-current.ts";

/** Inert facts and candidate bytes only. None of these objects is authority.
 * The private custody owner alone owns Request, DB, MEDIA, before/after proofs,
 * buffer lifetimes, deadlines, conditional PUT, atomic append and readback. */
type Row = Readonly<Record<string, unknown>>;
export type ClaimedImageEditBudget = Readonly<{
  monotonicDeadline: number; wallDeadline: number; outsideRetainedBytes: number;
}>;
export type ClaimedImageEditOperation = Readonly<{
  record: GuestImageResultRevision; event: CreativeEvent; revisionId: string;
  revisionSha256: string; metadata: ClaimedImageRevisionMetadata;
}>;
export type ClaimedImageEditOrdinarySource = Readonly<{
  sourceId: string; blockId: string; referenceId: string; mediaUrl: string; mediaKey: string; contentHash: string;
  kind: "image" | "model-view"; requiresUnlock: boolean; ingestionEventId: string; rightsEventId: string;
  sourceEventIds: readonly string[]; eventIds: readonly string[]; resourceIds: readonly string[]; validUntil: string | null;
}>;
export type ClaimedImageEditContext = Readonly<{
  snapshot: Readonly<Omit<GuestImageResultEditSnapshot, "rawJson">>; output: Readonly<CreativeOutput>;
  origin: ClaimedImageOrigin; initialMedia: ClaimedImageMedia; canonical: ClaimedImageCurrentFacts["canonical"];
  artifactKey: string; retainedExpiresAt: string; eventCount: number; eventBytes: number; eventJsonBytes: number;
  revisionCount: number; revisionBytes: number; ordinarySources: readonly ClaimedImageEditOrdinarySource[];
  operations: readonly ClaimedImageEditOperation[];
}>;
export type ClaimedImageEditPrepared = Readonly<{
  status: "prepared"; request: GuestImageResultEditRequest; operationSha256: string;
  ordinarySources: readonly ClaimedImageEditOrdinarySource[]; eventIds: readonly string[]; resourceIds: readonly string[];
  expiresAt: string; unchanged: boolean;
}>;
export type ClaimedImageEditQualification = ClaimedImageEditPrepared | Readonly<{
  status: "committed"; operationSha256: string; operation: ClaimedImageEditOperation;
}>;
export type ClaimedImageEditRevisionRow = Readonly<{
  revision_id: string; owner_id: string; organization_id: null; project_access_id: null;
  project_id: string; document_id: string; artifact_id: string; revision: number;
  content_json: string; content_sha256: string; created_by_user_id: string;
  created_at: string; expires_at: string; redacted_at: null;
}>;
export type ClaimedImageEditCandidate = Readonly<{
  operationSha256: string; event: CreativeEvent; rows: readonly ClaimedImageEditRevisionRow[];
  record: GuestImageResultRevision; revisionId: string; revisionSha256: string;
  mediaKey: string; mediaUrl: string; metadata: ClaimedImageRevisionMetadata; expiresAt: string;
}>;
export type ClaimedImageEditAcknowledgment = Readonly<{
  status: "saved"; code: "saved"; imageRevision: GuestImageResultRevision; operationSha256: string;
  stillCurrent: boolean; currentRevision: number; currentEditEventId: string | null; appended: readonly CreativeEvent[]; head: number;
}> | Readonly<{ status: "unchanged"; code: "unchanged" }>
  | Readonly<{ status: "unconfirmed"; code: "unconfirmed" }>
  | Readonly<{ status: "refused"; code: "unavailable" | "source_changed" | "invalid" | "forbidden" }>;
export class ClaimedImageEditError extends Error {
  readonly code: "invalid" | "source_changed" | "unavailable";
  constructor(code: "invalid" | "source_changed" | "unavailable") { super("claimed_image_edit_" + code); this.code = code; }
}
function requireFact(value: unknown, code: ClaimedImageEditError["code"] = "unavailable"): asserts value {
  if (!value) throw new ClaimedImageEditError(code);
}
const AGGREGATE = 155_108_864, COMPACT = 16_000_000, REQUEST_JSON = 65_536;
const limits = Object.freeze({ bytes: AGGREGATE, nodes: Math.floor(AGGREGATE / 8), depth: 96 });
const encoder = new TextEncoder();
const arrayWork = (n: number) => 64 + 16 * n;
const stringWork = (n: number) => 24 + 2 * n;
const schemaWork = (keys: readonly string[]) => arrayWork(keys.length) + keys.reduce((sum, key) => sum + stringWork(key.length), 0);
const namespaceWork = () => 200 + arrayWork(200) + 200 * stringWork(2) + 2 * stringWork(2) + stringWork(400) + stringWork(402);
const hashWork = 32 + arrayWork(32) + 32 * stringWork(2) + stringWork(64);
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(value);
const integer = (value: unknown, min = 0): value is number => typeof value === "number" && Number.isSafeInteger(value) && !Object.is(value, -0) && value >= min;
const iso = (value: unknown): value is string => typeof value === "string" && value.length === 24
  && Number.isSafeInteger(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b)
    && a.length === b.length && a.every((value, index) => same(value, b[index]));
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  let aCount = 0, bCount = 0;
  for (const key in a) if (Object.hasOwn(a, key)) {
    aCount++; if (!Object.hasOwn(b, key) || !same((a as Row)[key], (b as Row)[key])) return false;
  }
  for (const key in b) if (Object.hasOwn(b, key)) bCount++;
  return aCount === bCount;
}
function now(budget: ClaimedImageEditBudget, expiry?: string): number {
  const current = Date.now();
  requireFact(Number.isFinite(budget.monotonicDeadline) && Number.isFinite(budget.wallDeadline)
    && performance.now() < budget.monotonicDeadline && current < budget.wallDeadline
    && (expiry === undefined || iso(expiry) && current < Date.parse(expiry)));
  return current;
}
function admit(budget: ClaimedImageEditBudget, roots: unknown, work = 0): void {
  now(budget); requireFact(integer(budget.outsideRetainedBytes) && integer(work));
  requireFact(measureRetainedState(roots, limits).bytes + budget.outsideRetainedBytes + work <= AGGREGATE);
}
function compact(value: unknown): void { requireFact(measureRetainedState(value, limits).bytes <= COMPACT); }
function frozen<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key in value) if (Object.hasOwn(value, key)) frozen((value as Record<string, unknown>)[key]);
    Object.freeze(value);
  }
  return value;
}
function utf8(value: string): number {
  let size = 0;
  for (let index = 0; index < value.length; index++) {
    const c = value.charCodeAt(index);
    if (c < 128) size++;
    else if (c < 2048) size += 2;
    else if (c >= 0xd800 && c <= 0xdbff && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) { size += 4; index++; }
    else size += 3;
  }
  return size;
}
function jsonStringBytes(value: string): number {
  let size = 2 + utf8(value);
  for (let index = 0; index < value.length; index++) {
    const c = value.charCodeAt(index);
    if (c === 34 || c === 92 || c === 8 || c === 9 || c === 10 || c === 12 || c === 13) size++;
    else if (c < 32) size += 5;
    else if (c >= 0xd800 && c <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) index++; else size += 3;
    } else if (c >= 0xdc00 && c <= 0xdfff) size += 3;
  }
  return size;
}
const eventCellFields = ["event_id", "stream_id", "sequence", "occurred_at", "recorded_at", "actor", "client_id", "correlation_id",
  "causation_id", "compensates_event_id", "schema_version", "type", "payload", "private_owner", "private_project",
  "private_document", "private_json", "private_redacted"] as const;
/** Arithmetic only for the unchanged witness's eighteen scalar json_object
 * fields. JSON control/surrogate escapes and UTF-8 are counted without making
 * another cell string. This count grants no read or write authority. */
export function claimedImageEditEventCellBytes(value: Row): number {
  let size = 2 + eventCellFields.length - 1;
  for (const key of eventCellFields) {
    const member = value[key];
    requireFact(member === null || typeof member === "string" || typeof member === "number" && Number.isSafeInteger(member));
    size += jsonStringBytes(key) + 1 + (member === null ? 4 : typeof member === "string" ? jsonStringBytes(member) : String(member).length);
  }
  return size;
}
// Inspect own descriptors before any accounting helper reads a request field.
// Input comes from the owner's <=65,536-byte JSON field, never a native object.
function inertRequest(value: unknown): void {
  const seen = new Set<object>(); let count = 0;
  const visit = (item: unknown, depth: number): void => {
    requireFact(++count <= 4096 && depth <= 24, "invalid");
    if (item === null || typeof item === "boolean" || typeof item === "string" || typeof item === "number" && Number.isFinite(item)) return;
    requireFact(item && typeof item === "object" && !seen.has(item), "invalid");
    const array = Array.isArray(item), proto = Object.getPrototypeOf(item);
    requireFact(array ? proto === Array.prototype : proto === Object.prototype || proto === null, "invalid");
    seen.add(item); const names = Reflect.ownKeys(item);
    requireFact(names.length <= 4097, "invalid");
    for (const key of names) {
      requireFact(typeof key === "string", "invalid"); const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
      requireFact(Object.hasOwn(descriptor, "value") && (descriptor.enumerable || array && key === "length"), "invalid");
      if (array && key === "length") continue;
      requireFact(!["__proto__", "prototype", "constructor"].includes(key), "invalid"); visit(descriptor.value, depth + 1);
    }
  };
  visit(value, 0);
}
// Exact JSON code-unit count for detached data; no intermediate JSON string.
function jsonUnits(value: unknown): number {
  if (value === null) return 4;
  if (typeof value === "boolean") return value ? 4 : 5;
  if (typeof value === "number" && Number.isFinite(value)) return String(value).length;
  if (typeof value === "string") {
    let size = 2;
    for (let index = 0; index < value.length; index++) {
      const c = value.charCodeAt(index);
      if (c === 34 || c === 92 || [8, 9, 10, 12, 13].includes(c)) size += 2;
      else if (c < 32) size += 6;
      else if (c >= 0xd800 && c <= 0xdbff) {
        const next = value.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) { size += 2; index++; } else size += 6;
      } else size += c >= 0xdc00 && c <= 0xdfff ? 6 : 1;
    }
    return size;
  }
  if (Array.isArray(value)) return 2 + Math.max(0, value.length - 1) + value.reduce((sum, item) => sum + jsonUnits(item), 0);
  requireFact(value && typeof value === "object");
  let size = 2, count = 0;
  for (const key in value) if (Object.hasOwn(value, key)) {
    const member = (value as Record<string, unknown>)[key];
    if (member === undefined) continue;
    size += jsonUnits(key) + 1 + (count++ ? 1 : 0) + jsonUnits(member);
  }
  return size;
}
function json(budget: ClaimedImageEditBudget, roots: unknown, value: unknown): string {
  const size = jsonUnits(value); admit(budget, [roots, value], stringWork(size)); return JSON.stringify(value);
}
async function textHash(budget: ClaimedImageEditBudget, roots: unknown, value: string): Promise<string> {
  // The encoded input plus a conservative native hashing-copy allowance.
  admit(budget, [roots, value], 2 * utf8(value) + hashWork);
  const result = await outputAssetSha256(encoder.encode(value)); now(budget); admit(budget, [roots, value, result]); return result;
}
async function operationHash(budget: ClaimedImageEditBudget, roots: unknown,
  scope: { ownerId: string; projectId: string; documentId: string; outputId: string }, request: GuestImageResultEditRequest): Promise<string> {
  const value = { domain: "guest-image-result-edit@1", ...scope, request }, size = jsonUnits(value);
  admit(budget, [roots, scope, value], claimedImageEditOperationWork(scope, request) + stringWork(size) + 6 * size + hashWork);
  const result = await guestImageResultEditOperationSha256(scope, request); now(budget); requireFact(result, "invalid"); return result;
}
function reservedMedia(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const family = "guest-image-result-media-v1", raw = value.startsWith("/api/media/") ? value.slice(11) : value;
  if (raw === family || raw.startsWith(family + "/") || raw.toLowerCase().startsWith(family + "%2f")) return true;
  try { const key = decodeURIComponent(raw); return key === family || key.startsWith(family + "/"); } catch { return false; }
}
const marked = (value: Record<string, unknown>) => Object.hasOwn(value, "claim") || value.source_type === "claimed-generated-output"
  || value.operation_scope === "local-image-composition" || reservedMedia(value.media_url) || reservedMedia(value.source_ref);

function provePrivateEvent(input: ClaimedImageEditBudget & { eventRows: readonly Row[] }, roots: unknown, event: CreativeEvent, ownerId: string): boolean {
  let native: Row | undefined;
  for (const row of input.eventRows) if (row.event_id === event.eventId) { if (native) return false; native = row; }
  if (!native || native.private_owner !== ownerId || native.private_redacted !== null || typeof native.private_json !== "string") return false;
  // Historical sourceEvents can belong to an old/null Document. Preserve their
  // exact native envelope identity; the owner separately excludes every event
  // and current source resource from organization/project-access scopes.
  admit(input, [roots, event, native], 64 + 82 * native.private_json.length + measureRetainedState(event, limits).bytes);
  let captured: CreativeEvent;
  try { captured = serializeEvent(native as Parameters<typeof serializeEvent>[0]); } catch { return false; }
  return same(captured, event) && event.streamId === "creative:" + ownerId;
}

/** Consumes one metered projection into compact facts. Raw evidence, complete
 * projection, private rows and original request envelopes do not escape. */
export async function prepareClaimedImageEditContext(input: ClaimedImageEditBudget & Readonly<{
  read: GuestImageResultEditRead; eventRows: readonly Row[]; facts: ClaimedImageCurrentFacts;
}>): Promise<ClaimedImageEditContext> {
  const { read, facts } = input, snapshot = facts.snapshot;
  now(input, facts.retainedExpiresAt); admit(input, [read, input.eventRows, facts]);
  const projection = qualifyClaimedImageEditProjection(input);
  const roots: unknown[] = [read, input.eventRows, facts, projection]; admit(input, roots);
  const outputs = projection.libraryOutputs.filter(value => value.id === snapshot.outputId);
  requireFact(outputs.length === 1); const output = outputs[0]!;
  requireFact(output.documentId === snapshot.documentId && output.generationId === snapshot.generationId
    && output.sourceEventId === snapshot.sourceEventId && output.contentRef === snapshot.contentRef
    && output.mediaUrl === snapshot.media.url && output.mediaType === snapshot.media.mediaType
    && output.width === snapshot.media.width && output.height === snapshot.media.height && !output.discarded
    && (output.imageRevision?.revision ?? 0) === snapshot.revision && (output.imageRevision?.editEventId ?? null) === snapshot.editEventId);
  let eventBytes = 0, eventJsonBytes = 2, revisionBytes = 0;
  for (const row of input.eventRows) {
    requireFact(typeof row.payload === "string" && (row.private_json === null || typeof row.private_json === "string"));
    const rawBytes = utf8(row.payload) + (row.private_json === null ? 0 : utf8(row.private_json));
    const cellBytes = claimedImageEditEventCellBytes(row) + 1;
    requireFact(rawBytes <= 128_000 && cellBytes <= 512_000);
    eventBytes += rawBytes; eventJsonBytes += cellBytes;
  }
  const operations: ClaimedImageEditOperation[] = []; roots.push(operations);
  for (const retained of facts.retained) {
    now(input, facts.retainedExpiresAt); requireFact(typeof retained.row.content_json === "string");
    revisionBytes += utf8(retained.row.content_json);
    const record = retained.envelope.imageRevision; if (!record) continue;
    requireFact(retained.event && uuid(retained.row.revision_id) && hash(retained.row.content_sha256));
    admit(input, roots, claimedImageEditRevisionWork(record));
    const metadata = claimedImageRevisionMetadata(snapshot.ownerId, retained.row.revision_id, retained.row.content_sha256, record);
    operations.push(frozen({ record, event: retained.event, revisionId: retained.row.revision_id, revisionSha256: retained.row.content_sha256, metadata }));
    admit(input, roots);
  }
  requireFact(input.eventRows.length === read.events.length && read.events.length <= 50_000 && eventBytes <= 16_000_000 && eventJsonBytes <= 24_000_000
    && facts.retained.length <= 128 && revisionBytes <= 8_000_000 && operations.length === snapshot.revision);
  const ordinarySources: ClaimedImageEditOrdinarySource[] = []; roots.push(ordinarySources);
  const selected = snapshot.sources.filter(source => !reservedMedia(source.mediaUrl));
  requireFact(snapshot.sources.length <= 128 && selected.length <= 128);
  const blocks = selected.flatMap(source => {
    const matches = projection.libraryBlocks.filter(block => block.id === source.blockId);
    if (matches.length !== 1) return []; const block = matches[0]!;
    return block.documentId === snapshot.documentId && block.projectId === snapshot.projectId && !marked(block.properties) ? [block] : [];
  });
  const evidenceBytes = measureRetainedState([read, input.eventRows, projection], limits).bytes;
  // Ordinary derivation has two latest-event maps, copied trimmed IDs and one
  // active source normalization. The measured evidence bounds raw strings;
  // all <=128 returned source records are also retained and measured below.
  const ordinaryWork = 4 * evidenceBytes + 2 * (64 + 48 * read.events.length) + 6 * arrayWork(read.events.length);
  admit(input, [roots, selected, blocks], ordinaryWork);
  const derived = referenceCompositionSources(blocks, read.events as CreativeEvent[], now(input, facts.retainedExpiresAt));
  const ingestion = new Map<string, CreativeEvent>(), rights = new Map<string, CreativeEvent>();
  for (const event of read.events) {
    now(input);
    if (event.type !== "ReferenceIngested" && event.type !== "RightsAsserted") continue;
    const id = text(event.payload.reference_id); if (!id) continue;
    rights.set(id, event); if (event.type === "ReferenceIngested") ingestion.set(id, event);
  }
  const sourceRoots = [roots, selected, blocks, derived, ingestion, rights];
  for (const source of selected) {
    const block = blocks.find(value => value.id === source.blockId); if (!block) continue;
    const ref = text(block.properties.reference_id);
    const matches = derived.filter(value => value.id === source.id), ingested = ingestion.get(ref), right = rights.get(ref);
    if (matches.length !== 1 || !same(matches[0], source) || !ingested || !right || marked(ingested.payload) || marked(right.payload)
      || !["owned", "owned_or_licensed", "account-generated"].includes(text(right.payload.rights_class))) continue;
    if (referenceCompositionMediaUrl(source.mediaUrl) !== source.mediaUrl || reservedMedia(source.mediaUrl)) continue;
    const key = decodeURIComponent(source.mediaUrl.slice(11)); if (!mediaKeyMatchesOwnerNamespace(key, snapshot.ownerId) || reservedMedia(key)) continue;
    const validity = creativeContextRightsValidity(block.properties, now(input, facts.retainedExpiresAt)); if (validity.issue !== null) continue;
    const eventIds = [...new Set([...block.sourceEvents, ingested.eventId, right.eventId])];
    let proven = true;
    for (const id of eventIds) {
      const matches = read.events.filter(event => event.eventId === id);
      if (matches.length !== 1 || !provePrivateEvent(input, [sourceRoots, eventIds], matches[0]!, snapshot.ownerId)) { proven = false; break; }
    }
    if (!proven) continue;
    const resourceIds = [...new Set([block.id, ref, source.mediaUrl, key,
      ...[block.properties.reference_id, ingested.payload.reference_id, right.payload.reference_id].filter((value): value is string => typeof value === "string")])];
    ordinarySources.push(frozen({ sourceId: source.id, blockId: block.id, referenceId: ref,
      mediaUrl: source.mediaUrl, mediaKey: key, contentHash: source.contentHash, kind: source.kind, requiresUnlock: source.requiresUnlock === true,
      ingestionEventId: ingested.eventId, rightsEventId: right.eventId, sourceEventIds: [...block.sourceEvents], eventIds, resourceIds, validUntil: validity.validUntil }));
    admit(input, sourceRoots);
  }
  // Do not retain the native snapshot's planner rawJson after preparation.
  const compactSnapshot: Omit<GuestImageResultEditSnapshot, "rawJson"> = {
    status: snapshot.status, ownerId: snapshot.ownerId, projectId: snapshot.projectId, documentId: snapshot.documentId,
    outputId: snapshot.outputId, generationId: snapshot.generationId, sourceEventId: snapshot.sourceEventId,
    contentRef: snapshot.contentRef, contentSha256: snapshot.contentSha256, revision: snapshot.revision, editEventId: snapshot.editEventId,
    media: snapshot.media, sources: snapshot.sources, sourceIds: snapshot.sourceIds, head: snapshot.head, claim: snapshot.claim,
  };
  const context = frozen({ snapshot: compactSnapshot, output, origin: facts.origin, initialMedia: facts.initialMedia, canonical: facts.canonical,
    artifactKey: facts.artifactKey, retainedExpiresAt: facts.retainedExpiresAt, eventCount: read.events.length, eventBytes, eventJsonBytes,
    revisionCount: facts.retained.length, revisionBytes, ordinarySources, operations });
  admit(input, [sourceRoots, context]); compact(context); return context;
}

/** Reparse the explicit schema2 request and operation identity. A retained
 * retransmission is found before current-source eligibility is consulted. */
export async function qualifyClaimedImageEditRequest(input: ClaimedImageEditBudget & Readonly<{
  context: ClaimedImageEditContext; value: unknown;
}>): Promise<ClaimedImageEditQualification> {
  const { context } = input, snapshot = context.snapshot; now(input, context.retainedExpiresAt);
  compact(context); inertRequest(input.value);
  const wire = json(input, [context, input.value], input.value); requireFact(utf8(wire) <= REQUEST_JSON, "invalid");
  admit(input, [context, input.value, wire], claimedImageEditRequestWork(input.value));
  const request = parseGuestImageResultEditRequest(input.value); requireFact(request, "invalid");
  const scope = { ownerId: snapshot.ownerId, projectId: snapshot.projectId, documentId: snapshot.documentId, outputId: snapshot.outputId };
  const roots = [context, input.value, wire, request, scope];
  const operationSha256 = await operationHash(input, roots, scope, request); now(input, context.retainedExpiresAt);
  const existing = context.operations.filter(value => value.record.operationSha256 === operationSha256);
  requireFact(existing.length <= 1);
  if (existing.length === 1) {
    const result = frozen({ status: "committed" as const, operationSha256, operation: existing[0]! });
    admit(input, [roots, result]); compact([context, result]); return result;
  }
  requireFact(same(request.claim, snapshot.claim) && request.expectedRevision === snapshot.revision
    && request.expectedEditEventId === snapshot.editEventId && request.expectedContentSha256 === snapshot.contentSha256
    && request.generationId === snapshot.generationId && request.sourceEventId === snapshot.sourceEventId && request.contentRef === snapshot.contentRef
    && request.sourceMediaUrl === snapshot.media.url && request.sourceMediaSha256 === snapshot.media.sha256
    && snapshot.sourceIds.includes(request.sourceId), "source_changed");
  admit(input, roots, claimedImageEditRecipeWork(request.recipe) + measureRetainedState(snapshot.sources, limits).bytes * 4);
  requireFact(validateReferenceComposition(request.recipe, snapshot.sources) === null, "source_changed");
  const ordinarySources: ClaimedImageEditOrdinarySource[] = [], eventIds = new Set<string>(), resourceIds = new Set<string>();
  let expiresAt = context.retainedExpiresAt;
  for (const source of request.recipe.sources) {
    if (source.id === request.sourceId) {
      requireFact(source.kind === "image" && source.mediaUrl === snapshot.media.url && source.contentHash === snapshot.media.sha256, "source_changed");
      continue;
    }
    requireFact(!reservedMedia(source.mediaUrl), "source_changed");
    const matches = context.ordinarySources.filter(value => value.sourceId === source.id); requireFact(matches.length === 1, "source_changed");
    const selected = matches[0]!;
    requireFact(!selected.requiresUnlock && selected.blockId === source.blockId && selected.kind === source.kind
      && selected.mediaUrl === source.mediaUrl && selected.contentHash === source.contentHash, "source_changed");
    if (selected.validUntil !== null) {
      now(input, selected.validUntil); if (selected.validUntil < expiresAt) expiresAt = selected.validUntil;
    }
    ordinarySources.push(selected); selected.eventIds.forEach(id => eventIds.add(id)); selected.resourceIds.forEach(id => resourceIds.add(id));
  }
  requireFact(ordinarySources.length <= 11, "invalid");
  const result = frozen({ status: "prepared" as const, request, operationSha256, ordinarySources,
    eventIds: [...eventIds], resourceIds: [...resourceIds], expiresAt, unchanged: request.resultMediaSha256 === snapshot.media.sha256 });
  admit(input, [roots, result]); compact([context, result]); return result;
}

// Closed projector capture accounting. Per own data property: descriptor-map
// slot/key + four-field descriptor246 + copied scalar, plus key roster. Reserve
// whole detached trees even though many are sequential and share identities.
function captureWork(value: unknown): number {
  let properties = 0, objects = 0, keys = 0, strings = 0, encoded = 0, roster = 0;
  const visit = (item: unknown): void => {
    if (typeof item === "string") { encoded = Math.max(encoded, utf8(item)); return; }
    if (!item || typeof item !== "object") return;
    objects++; const names = Reflect.ownKeys(item); roster += arrayWork(names.length);
    for (const name of names) {
      requireFact(typeof name === "string"); const descriptor = Object.getOwnPropertyDescriptor(item, name)!;
      requireFact(Object.hasOwn(descriptor, "value")); properties++; keys += name.length; roster += stringWork(name.length);
      const child: unknown = descriptor.value;
      strings += child === null || child === undefined ? 8 : typeof child === "string" ? stringWork(child.length)
        : typeof child === "number" || typeof child === "boolean" ? 16 : 0;
      encoded = Math.max(encoded, utf8(name)); if (!(Array.isArray(item) && name === "length")) visit(child);
    }
  };
  visit(value); return measureRetainedState(value, limits).bytes + 64 * objects + 16 * properties + 2 * keys
    + 246 * properties + strings + roster + 64 + 32 * objects + encoded;
}
function projectorWork(output: CreativeOutput, event: CreativeEvent, scope: unknown): number {
  // The actual projector captures scope/event, parses two five-field reviews,
  // captures the seven-field origin, checks fixed schemas, decodes both URLs
  // and spreads the output. Four review captures cover both captured and
  // returned trees plus each defineProperty descriptor. Schema arrays below
  // include both expected keys and Object.keys' corresponding roster.
  const schemas = schemaWork(["ownerId", "projectId", "claim"])
    + schemaWork(["eventId", "streamId", "sequence", "occurredAt", "recordedAt", "actor", "clientId", "correlationId",
      "causationId", "compensatesEventId", "schemaVersion", "type", "payload"])
    + schemaWork(["output_id", "object_id", "document_id", "project_id", "generation_id", "source_event_id", "content_ref", "content_sha256",
      "revision", "previous_revision", "previous_edit_event_id", "image_revision_id", "image_revision_sha256", "image_edit_operation_sha256",
      "media_url", "media_type", "source_content_hash", "image_width", "image_height", "image_byte_length", "source_surface", "edited_by_user_id", "claim"])
    + 2 * schemaWork(["version", "kind", "custodyId", "claimEventId", "lineageDigest"])
    + schemaWork(["version", "kind", "custodyId", "claimEventId", "outputId", "generationId", "manifestDigest"]);
  return captureWork(scope) + captureWork(event) + 4 * captureWork(event.payload.claim)
    + 2 * captureWork(output.claimedOrigin) + claimedImageEditMediaWork(output.mediaUrl) + claimedImageEditMediaWork(event.payload.media_url)
    + measureRetainedState(output, limits).bytes + 2 * schemas + stringWork(event.streamId.length) + stringWork(8) + stringWork(15);
}

/** Deterministic candidate construction from admitted inert facts. Random IDs
 * and time are supplied by the private owner; no storage or event append runs. */
export async function buildClaimedImageEditCandidate(input: ClaimedImageEditBudget & Readonly<{
  context: ClaimedImageEditContext; qualified: ClaimedImageEditPrepared; revisionId: string; eventId: string;
  correlationId: string; originalRevisionId: string | null; recordedAt: string;
}>): Promise<ClaimedImageEditCandidate> {
  const { context, qualified } = input, snapshot = context.snapshot, request = qualified.request;
  now(input, qualified.expiresAt); requireFact(qualified.status === "prepared" && !qualified.unchanged);
  requireFact(uuid(input.revisionId) && uuid(input.eventId) && uuid(input.correlationId) && iso(input.recordedAt)
    && Date.parse(input.recordedAt) <= now(input) && input.recordedAt >= context.canonical.recordedAt
    && context.operations.every(value => input.recordedAt >= value.event.recordedAt)
    && integer(snapshot.head + 1, 1) && context.eventCount < 50_000
    && context.revisionCount + (snapshot.revision === 0 ? 2 : 1) <= 128);
  requireFact(snapshot.revision === 0 ? uuid(input.originalRevisionId) && input.originalRevisionId !== input.revisionId : input.originalRevisionId === null);
  requireFact(!context.operations.some(value => value.revisionId === input.revisionId || value.record.editEventId === input.eventId)
    && input.eventId !== context.canonical.eventId);
  const roots: unknown[] = [context, qualified];
  const operationScope = { ownerId: snapshot.ownerId, projectId: snapshot.projectId, documentId: snapshot.documentId, outputId: snapshot.outputId };
  requireFact(await operationHash(input, roots, operationScope, request) === qualified.operationSha256);
  now(input, qualified.expiresAt);
  requireFact(same(request.claim, snapshot.claim) && request.expectedRevision === snapshot.revision
    && request.expectedEditEventId === snapshot.editEventId && request.expectedContentSha256 === snapshot.contentSha256
    && request.generationId === snapshot.generationId && request.sourceEventId === snapshot.sourceEventId && request.contentRef === snapshot.contentRef
    && request.sourceMediaUrl === snapshot.media.url && request.sourceMediaSha256 === snapshot.media.sha256
    && snapshot.sourceIds.includes(request.sourceId));
  const expiresAt = new Date(Math.min(Date.parse(qualified.expiresAt), Date.parse(context.retainedExpiresAt), Date.parse(input.recordedAt) + 365 * 86_400_000)).toISOString();
  requireFact(expiresAt > input.recordedAt); now(input, expiresAt);
  admit(input, roots, namespaceWork() + stringWork(1024) + stringWork(3072) + stringWork(3083));
  const mediaKey = `guest-image-result-media-v1/${ownerMediaNamespace(snapshot.ownerId)}/${snapshot.claim.custodyId}/${snapshot.outputId}/revisions/${input.revisionId}.png`;
  const mediaUrl = "/api/media/" + encodeURIComponent(mediaKey); roots.push(mediaKey, mediaUrl);
  admit(input, roots, claimedImageEditMediaWork(mediaUrl)); const location = parseGuestImageResultMediaUrl(mediaUrl);
  requireFact(location && location.ownerId === snapshot.ownerId && location.custodyId === snapshot.claim.custodyId
    && location.outputId === snapshot.outputId && location.revisionId === input.revisionId);
  const recipeJson = json(input, roots, request.recipe); roots.push(recipeJson);
  const recipeSha256 = await textHash(input, roots, recipeJson);
  const record: GuestImageResultRevision = { schemaVersion: 2, operation: "composition", revision: snapshot.revision + 1, editEventId: input.eventId,
    outputId: context.origin.outputId, documentId: context.origin.documentId, generationId: context.origin.generationId,
    sourceEventId: context.origin.sourceEventId, contentRef: context.origin.contentRef, contentSha256: context.origin.contentSha256,
    source: { revision: snapshot.revision, eventId: snapshot.editEventId ?? context.origin.sourceEventId,
      mediaUrl: snapshot.media.url, sha256: snapshot.media.sha256, width: snapshot.media.width, height: snapshot.media.height },
    media: { url: mediaUrl, mediaType: "image/png", sha256: request.resultMediaSha256, byteLength: request.resultByteLength,
      width: request.recipe.width, height: request.recipe.height }, sourceId: request.sourceId, recipe: request.recipe,
    recipeSha256, operationSha256: qualified.operationSha256, claim: snapshot.claim };
  roots.push(record); admit(input, roots, claimedImageEditRevisionWork(record));
  const checkedRecord = parseGuestImageResultRevision(record, snapshot.ownerId, input.revisionId); requireFact(checkedRecord && same(checkedRecord, record));
  roots.push(checkedRecord);
  const envelope = { kind: "generated-image", schemaVersion: 2, origin: context.origin, initialMedia: context.initialMedia, request, imageRevision: record };
  roots.push(envelope); const content = json(input, roots, envelope); roots.push(content);
  requireFact(utf8(content) <= 100_000); const revisionSha256 = await textHash(input, roots, content);
  const event: CreativeEvent = { eventId: input.eventId, streamId: "creative:" + snapshot.ownerId, sequence: snapshot.head + 1,
    occurredAt: input.recordedAt, recordedAt: input.recordedAt, actor: "user", clientId: "web:generated-image-editor",
    correlationId: input.correlationId, causationId: null, compensatesEventId: null, schemaVersion: 1, type: "GeneratedImageEdited",
    payload: { output_id: snapshot.outputId, object_id: snapshot.outputId, document_id: snapshot.documentId, project_id: snapshot.projectId,
      generation_id: snapshot.generationId, source_event_id: snapshot.sourceEventId, content_ref: snapshot.contentRef, content_sha256: snapshot.contentSha256,
      revision: record.revision, previous_revision: snapshot.revision, previous_edit_event_id: snapshot.editEventId,
      image_revision_id: input.revisionId, image_revision_sha256: revisionSha256, image_edit_operation_sha256: qualified.operationSha256,
      media_url: mediaUrl, media_type: "image/png", source_content_hash: record.media.sha256, image_width: record.media.width,
      image_height: record.media.height, image_byte_length: record.media.byteLength, source_surface: "generated-image-editor",
      edited_by_user_id: snapshot.ownerId, claim: snapshot.claim } };
  roots.push(event); const scope = { ownerId: snapshot.ownerId, projectId: snapshot.projectId, claim: snapshot.claim };
  admit(input, [roots, scope], projectorWork(context.output, event, scope));
  const projected = projectGuestImageResultEdit(context.output, event, scope);
  requireFact(projected && projected.mediaUrl === mediaUrl && projected.imageRevision?.revisionId === input.revisionId
    && projected.imageRevision.editEventId === input.eventId && projected.imageRevision.operationSha256 === qualified.operationSha256);
  roots.push(projected);
  const rows: ClaimedImageEditRevisionRow[] = [];
  const revisionRow = (revisionId: string, revision: number, contentJson: string, sha: string): ClaimedImageEditRevisionRow => frozen({
    revision_id: revisionId, owner_id: snapshot.ownerId, organization_id: null, project_access_id: null,
    project_id: snapshot.projectId, document_id: snapshot.documentId, artifact_id: context.artifactKey, revision,
    content_json: contentJson, content_sha256: sha, created_by_user_id: snapshot.ownerId, created_at: input.recordedAt, expires_at: expiresAt, redacted_at: null });
  roots.push(rows);
  if (snapshot.revision === 0) {
    const original = { kind: "generated-image", schemaVersion: 2, origin: context.origin, initialMedia: context.initialMedia, request: null, imageRevision: null };
    const originalJson = json(input, roots, original); requireFact(utf8(originalJson) <= 100_000);
    rows.push(revisionRow(input.originalRevisionId!, 0, originalJson, await textHash(input, [roots, original], originalJson)));
  }
  rows.push(revisionRow(input.revisionId, record.revision, content, revisionSha256));
  // eventWriteBindings invokes the unchanged real public/private split. Keep
  // its two JSON strings, entry pairs and visible record within admission.
  const eventSize = jsonUnits(event.payload);
  admit(input, roots, 4 * stringWork(eventSize) + 3 * measureRetainedState(event, limits).bytes + 2 * arrayWork(23) + 23 * arrayWork(2));
  const bindings = eventWriteBindings(event); roots.push(bindings);
  requireFact(typeof bindings[12] === "string" && typeof bindings[16] === "string");
  const eventCell: Row = { event_id: event.eventId, stream_id: event.streamId, sequence: event.sequence,
    occurred_at: event.occurredAt, recorded_at: event.recordedAt, actor: event.actor, client_id: event.clientId,
    correlation_id: event.correlationId, causation_id: event.causationId, compensates_event_id: event.compensatesEventId,
    schema_version: event.schemaVersion, type: event.type, payload: bindings[12], private_owner: snapshot.ownerId,
    private_project: snapshot.projectId, private_document: snapshot.documentId, private_json: bindings[16], private_redacted: null };
  roots.push(eventCell);
  const eventCellBytes = claimedImageEditEventCellBytes(eventCell) + 1, eventRawBytes = utf8(bindings[12]) + utf8(bindings[16]);
  requireFact(eventRawBytes <= 128_000 && eventCellBytes <= 512_000
    && context.eventBytes + eventRawBytes <= 16_000_000 && context.eventJsonBytes + eventCellBytes <= 24_000_000
    && context.revisionBytes + rows.reduce((sum, row) => sum + utf8(row.content_json), 0) <= 8_000_000);
  admit(input, roots, claimedImageEditRevisionWork(record));
  const metadata = claimedImageRevisionMetadata(snapshot.ownerId, input.revisionId, revisionSha256, record);
  const candidate = frozen({ operationSha256: qualified.operationSha256, event, rows, record,
    revisionId: input.revisionId, revisionSha256, mediaKey, mediaUrl, metadata, expiresAt });
  now(input, expiresAt); admit(input, [roots, candidate]); compact([context, qualified, candidate]); return candidate;
}

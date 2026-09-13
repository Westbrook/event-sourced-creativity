import { nativeMemoryTimestamp } from "./memory-native-deadlines.ts";
import type { NativeDocumentMemoryContext } from "./memory-live-context.ts";
import { NATIVE_MEMORY_ORIGIN_LIMITS, bytes, invalid, nativeMemoryCanonical, hash, nativeMemoryFingerprint, nativeStructuredOriginSchema } from "./memory-native-origin-schema.ts";
export { NATIVE_MEMORY_ORIGIN_LIMITS, nativeMemoryCanonical, nativeMemoryFingerprint, nativeStructuredOriginSchema };

export const NATIVE_MEMORY_ANSWER_KIND = "chat-assistant-memory";
export const NATIVE_MEMORY_ORIGIN_RECIPE = "native-answer-origin-v1";
export const NATIVE_MEMORY_ORIGIN_SCHEMA = 1;
export type NativeMemoryOriginQuery = { sql: string; bindings: (string | number | null)[] };
export type NativeMemoryOriginWithdrawalReason = "source-unavailable" | "source-changed" | "source-expired"
  | "enrollment-changed" | "access-withdrawn" | "erased" | "manual";
export type NativeMemoryOriginHeader = {
  origin_id: string; schema_version: 1; recipe_version: typeof NATIVE_MEMORY_ORIGIN_RECIPE;
  actor_user_id: string; owner_user_id: string; organization_id: string | null; project_access_id: string | null;
  project_id: string; document_id: string; scope_key: string;
  turn_id: string; user_event_id: string; user_content_id: string; user_source_sequence: number; user_sha256: string;
  answer_event_id: string; answer_content_id: string; answer_source_sequence: number;
  answer_sha256: string; answer_expires_at: string; consumed_value_sha256: string; dependency_list_sha256: string;
  enrollment_id: string; enrollment_revision: number; policy_version: string; permission_epoch: string;
  enrolled_at: string; enrollment_expires_at: string; retention_days: number; selection_cursor: number;
  source_retention_ceiling: string; dependency_count: number; created_at: string;
  status: "active" | "withdrawn"; withdrawn_at: string | null; withdrawal_reason: NativeMemoryOriginWithdrawalReason | null;
};
export type NativeMemoryOriginDependency = {
  origin_id: string; ordinal: number; event_stream_id: string; event_id: string; source_sequence: number;
  event_type: string; recorded_at: string; block_id: string | null; turn_id: string | null;
  user_content_id: string | null; assistant_content_id: string | null; projection_sha256: string;
  source_retention_ceiling: string; consumed: 0 | 1;
  segment_enrollment_id: string | null; segment_revision: number | null; segment_recipe: string | null;
  segment_first_sequence: number | null; segment_last_sequence: number | null; segment_member_count: number | null;
  segment_ordinal: number | null; segment_created_at: string | null; segment_retention_ceiling: string | null;
};
export type NativeMemoryOriginSegment = {
  enrollment_id: string; revision: number; recipe: string; first_sequence: number; last_sequence: number;
  member_count: number; ordinal: number; created_at: string; retention_ceiling: string;
};
/** Exact aliases selected by the native reader. Text exists only during capture/hash;
 * it is never a durable dependency column. */
export type NativeMemorySourceProjectionInput = {
  event_stream_id: string; event_id: string; sequence: number; type: string; recorded_at: string;
  source_actor: string; source_client_id: string; source_correlation_id: string; source_causation_id: string | null;
  source_memory_origin_version: unknown;
  block_id: string | null; turn_id: string | null; user_content_id: string | null; assistant_content_id: string | null;
  user_text: string | null; assistant_text: string | null;
};
export type NativeMemoryOriginSource = NativeMemorySourceProjectionInput & {
  valid_until: string; segment: NativeMemoryOriginSegment | null;
};
export type NativeMemoryOriginEnrollment = {
  enrollment_id: string; actor_user_id: string; owner_user_id: string; organization_id: string | null;
  project_access_id: string | null; project_id: string; document_id: string; revision: number;
  policy_version: string; permission_epoch: string; enrolled_at: string; expires_at: string;
  retention_days: number; cursor_sequence: number;
};
export type NativeMemoryOriginCapture = {
  enrollment: NativeMemoryOriginEnrollment; scopeKey: string; consumedValueSha256: string;
  sourceRetentionCeiling: string; freshUntil: string;
  dependencies: Omit<NativeMemoryOriginDependency, "origin_id">[];
};

const id = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 240;
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const reasons = new Set<NativeMemoryOriginWithdrawalReason>(["source-unavailable", "source-changed", "source-expired",
  "enrollment-changed", "access-withdrawn", "erased", "manual"]);

export async function nativeMemoryAnswerFingerprint(value: string): Promise<string> {
  if (typeof value !== "string" || !value.isWellFormed()) return invalid();
  const owned = bytes(value);
  if (!owned.length || owned.length > NATIVE_MEMORY_ORIGIN_LIMITS.answerBytes) return invalid();
  return hash(owned);
}
export function nativeMemoryExcerpt(value: string): string {
  if (typeof value !== "string" || !value.isWellFormed()) return invalid();
  let result = "", length = 0;
  for (const character of value) {
    const size = bytes(character).length;
    if (length + size > NATIVE_MEMORY_ORIGIN_LIMITS.excerptBytes) break;
    result += character; length += size;
  }
  return result;
}
/** Reconstructible projection; never include moving clock/cursor or grant data. */
export function nativeMemorySourceProjection(row: NativeMemorySourceProjectionInput) {
  if (!id(row.event_stream_id) || !id(row.event_id) || !positive(row.sequence) || !id(row.type)
    || nativeMemoryTimestamp(row.recorded_at) === null || row.block_id !== null && !id(row.block_id)
    || !id(row.source_actor) || !id(row.source_client_id) || !id(row.source_correlation_id)
    || row.source_causation_id !== null && !id(row.source_causation_id) || row.source_memory_origin_version !== null) return invalid();
  const conversation = row.type === "AssistantReasoned";
  if (conversation ? !id(row.turn_id) || !id(row.user_content_id) || !id(row.assistant_content_id)
      || typeof row.user_text !== "string" || typeof row.assistant_text !== "string"
    : [row.turn_id, row.user_content_id, row.assistant_content_id, row.user_text, row.assistant_text].some(value => value !== null)) return invalid();
  return { event_stream_id: row.event_stream_id, event_id: row.event_id, sequence: row.sequence, type: row.type,
    source_actor: row.source_actor, source_client_id: row.source_client_id,
    source_correlation_id: row.source_correlation_id, source_causation_id: row.source_causation_id,
    recorded_at: row.recorded_at, block_id: row.block_id, turn_id: row.turn_id,
    user_content_id: row.user_content_id, assistant_content_id: row.assistant_content_id,
    user_text: conversation ? nativeMemoryExcerpt(row.user_text!) : null,
    assistant_text: conversation ? nativeMemoryExcerpt(row.assistant_text!) : null };
}
export async function nativeMemoryDependencyListFingerprint(rows: readonly NativeMemoryOriginDependency[]): Promise<string> {
  return nativeMemoryFingerprint(rows);
}

/** First slice has no transitive paid lineage. Inspect all complete dependencies,
 * not only returned excerpts, and witness the exact empty result after hashing. */
export function nativeMemoryOriginPaidSourcesQuery(actorUserId: string, scopeKey: string,
  turnIds: readonly string[]): NativeMemoryOriginQuery {
  if (!id(actorUserId) || typeof scopeKey !== "string" || scopeKey.length > 1000 || !Array.isArray(turnIds)
    || turnIds.length > NATIVE_MEMORY_ORIGIN_LIMITS.dependencies || turnIds.some(value => !id(value))) return invalid();
  return { sql: "SELECT task_id,actor_user_id,scope_key,turn_id FROM assistant_specialist_tasks" +
    " WHERE actor_user_id=? AND scope_key=? AND turn_id IN(SELECT value FROM json_each(?)) ORDER BY task_id LIMIT 129",
    bindings: [actorUserId, scopeKey, JSON.stringify([...new Set(turnIds)].sort())] };
}

/** Private content IDs are global identities. Neither changing a source's role
 * nor removing a retired origin manifest removes its append-only event marker.
 * This bounded empty-set proof is separate from the native source predicate. */
export function nativeMemoryOriginAncestryQuery(sources: readonly Pick<NativeMemorySourceProjectionInput,
  "user_content_id" | "assistant_content_id">[], originTablePresent = true): NativeMemoryOriginQuery {
  if (typeof originTablePresent !== "boolean" || !Array.isArray(sources) || sources.length > NATIVE_MEMORY_ORIGIN_LIMITS.dependencies
    || sources.some(row => !row || [row.user_content_id, row.assistant_content_id]
      .some(value => value !== null && !id(value)))) return invalid();
  const refs = [...new Set(sources.flatMap(row => [row.user_content_id, row.assistant_content_id])
    .filter((value): value is string => value !== null))].sort();
  return { sql: `WITH refs(value) AS (SELECT value FROM json_each(?))
    ${originTablePresent ? `SELECT 'origin' AS kind,origin_id AS id,answer_content_id AS content_id FROM memory_native_answer_origins
      WHERE answer_content_id IN(SELECT value FROM refs) UNION ALL ` : ""}
    SELECT 'event' AS kind,event_id AS id,json_extract(payload,'$.content_ref') AS content_id FROM events
      WHERE type='AssistantReasoned' AND json_type(payload,'$.memory_origin_version') IS NOT NULL
        AND json_extract(payload,'$.content_ref') IN(SELECT value FROM refs)
    ORDER BY kind,id LIMIT 129`, bindings: [JSON.stringify(refs)] };
}

/** Wrapper-only exclusion over the native source query's fixed authored/answer
 * aliases. A caller must certify the original origin-table presence alongside
 * this SELECT; absent origin storage never disables immutable event markers. */
export function nativeMemoryOriginSourceExclusion(originTablePresent: boolean): string {
  if (typeof originTablePresent !== "boolean") return invalid();
  return `(NOT EXISTS(SELECT 1 FROM events ancestor WHERE ancestor.type='AssistantReasoned'
    AND json_type(ancestor.payload,'$.memory_origin_version') IS NOT NULL
    AND json_extract(ancestor.payload,'$.content_ref') IN(authored.content_id,answer.content_id))${originTablePresent
    ? " AND NOT EXISTS(SELECT 1 FROM memory_native_answer_origins derived WHERE derived.answer_content_id IN(authored.content_id,answer.content_id))" : ""})`;
}

export const NATIVE_MEMORY_ORIGIN_HEADER_COLUMNS = ["origin_id", "schema_version", "recipe_version", "actor_user_id", "owner_user_id",
  "organization_id", "project_access_id", "project_id", "document_id", "scope_key", "turn_id",
  "user_event_id", "user_content_id", "user_source_sequence", "user_sha256", "answer_event_id", "answer_content_id",
  "answer_source_sequence", "answer_sha256", "answer_expires_at", "consumed_value_sha256", "dependency_list_sha256", "enrollment_id", "enrollment_revision",
  "policy_version", "permission_epoch", "enrolled_at", "enrollment_expires_at", "retention_days", "selection_cursor",
  "source_retention_ceiling", "dependency_count", "created_at", "status", "withdrawn_at", "withdrawal_reason"] as const;
export const NATIVE_MEMORY_ORIGIN_DEPENDENCY_COLUMNS = ["origin_id", "ordinal", "event_stream_id", "event_id", "source_sequence", "event_type",
  "recorded_at", "block_id", "turn_id", "user_content_id", "assistant_content_id", "projection_sha256", "source_retention_ceiling", "consumed",
  "segment_enrollment_id", "segment_revision", "segment_recipe", "segment_first_sequence", "segment_last_sequence", "segment_member_count",
  "segment_ordinal", "segment_created_at", "segment_retention_ceiling"] as const;
const segmentColumns = NATIVE_MEMORY_ORIGIN_DEPENDENCY_COLUMNS.slice(14);
const sourceTypes = new Set(["DocumentOpened", "DocumentViewVisited", "ObjectViewed", "DocumentArtifactViewed", "ComparisonOpened",
  "BlockCreated", "BlockPropertyEdited", "ChipEdited", "BlockWeightSet", "BlockLocked", "BlockUnlocked", "BlockRelationAdded", "BlockRelationRemoved",
  "BlockRemoved", "BlockRestored", "ObjectSaved", "ObjectPinned", "ObjectExported", "DocumentArtifactExported", "ArtifactApproved",
  "CanvasItemPlaced", "CanvasReferenceCreated", "ContextSetFormalized", "ObjectDiscarded", "ObjectCritiqued", "ArtifactChangesRequested",
  "ArtifactReviewRequested", "GenerationRequested", "DocumentRenderRequested", "ProposalAccepted", "ProposalRejected", "ProposalDeclined",
  "BriefItemAccepted", "BriefItemIgnored", "BriefDismissed", "AssistantReasoned"]);
const exactKeys = (value: object, keys: readonly string[]) => Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");

/** Structural/complete-list validation. Callers MUST also compare the async list
 * fingerprint with header.dependency_list_sha256; count alone is not evidence. */
export function validateNativeMemoryOriginRows(headerInput: unknown, dependencyInput: unknown):
  { header: NativeMemoryOriginHeader; dependencies: NativeMemoryOriginDependency[] } | null {
  try {
    const header = structuredClone(headerInput) as NativeMemoryOriginHeader;
    const dependencies = structuredClone(dependencyInput) as NativeMemoryOriginDependency[];
    if (!header || !exactKeys(header, NATIVE_MEMORY_ORIGIN_HEADER_COLUMNS) || !Array.isArray(dependencies)
      || dependencies.length < 1 || dependencies.length > NATIVE_MEMORY_ORIGIN_LIMITS.dependencies
      || header.dependency_count !== dependencies.length || header.schema_version !== NATIVE_MEMORY_ORIGIN_SCHEMA
      || header.recipe_version !== NATIVE_MEMORY_ORIGIN_RECIPE) return null;
    if ([header.origin_id, header.actor_user_id, header.owner_user_id, header.project_id, header.document_id, header.turn_id,
      header.user_event_id, header.user_content_id, header.answer_event_id, header.answer_content_id, header.enrollment_id, header.policy_version, header.permission_epoch].some(value => !id(value))
      || (header.organization_id === null) !== (header.project_access_id === null)
      || header.organization_id !== null && (!id(header.organization_id) || !id(header.project_access_id))
      || header.organization_id === null && header.owner_user_id !== header.actor_user_id
      || header.scope_key !== JSON.stringify([header.organization_id ?? "", header.project_access_id ?? "", header.project_id, header.document_id])
      || !positive(header.enrollment_revision) || !Number.isSafeInteger(header.retention_days) || header.retention_days < 1 || header.retention_days > 365
      || !Number.isSafeInteger(header.selection_cursor) || header.selection_cursor < 1
      || !positive(header.user_source_sequence) || header.user_source_sequence <= header.selection_cursor
      || !positive(header.answer_source_sequence) || header.answer_source_sequence !== header.user_source_sequence + 1
      || header.user_event_id === header.answer_event_id || header.user_content_id === header.answer_content_id
      || ![header.user_sha256, header.answer_sha256, header.consumed_value_sha256, header.dependency_list_sha256].every(digest)) return null;
    const enrolled = nativeMemoryTimestamp(header.enrolled_at), expiry = nativeMemoryTimestamp(header.enrollment_expires_at),
      ceiling = nativeMemoryTimestamp(header.source_retention_ceiling), created = nativeMemoryTimestamp(header.created_at),
      answerExpiry = nativeMemoryTimestamp(header.answer_expires_at);
    if (enrolled === null || expiry === null || ceiling === null || created === null || answerExpiry === null
      || enrolled > created || created >= answerExpiry || answerExpiry > ceiling || ceiling > expiry) return null;
    if (header.status === "active" ? header.withdrawn_at !== null || header.withdrawal_reason !== null
      : header.status !== "withdrawn" || nativeMemoryTimestamp(header.withdrawn_at) === null
        || Date.parse(header.withdrawn_at!) < created || !reasons.has(header.withdrawal_reason!)) return null;
    const ids = new Set<string>(), turns = new Set<string>(), groups = new Map<number, NativeMemoryOriginDependency[]>();
    let lastSequence = 0, earliest = expiry, consumed = 0;
    for (const [index, row] of dependencies.entries()) {
      if (!row || !exactKeys(row, NATIVE_MEMORY_ORIGIN_DEPENDENCY_COLUMNS) || row.origin_id !== header.origin_id || row.ordinal !== index
        || row.event_stream_id !== "creative:" + header.owner_user_id || !id(row.event_id) || ids.has(row.event_id)
        || !positive(row.source_sequence) || row.source_sequence <= lastSequence || row.source_sequence > header.selection_cursor
        || row.event_id === header.answer_event_id || row.event_id === header.user_event_id || !sourceTypes.has(row.event_type) || !digest(row.projection_sha256)
        || row.block_id !== null && !id(row.block_id) || row.consumed !== 0 && row.consumed !== 1) return null;
      const recorded = nativeMemoryTimestamp(row.recorded_at), limit = nativeMemoryTimestamp(row.source_retention_ceiling);
      if (recorded === null || limit === null || recorded < enrolled || recorded > created || limit <= created || limit > expiry
        || limit > recorded + header.retention_days * 86_400_000) return null;
      ids.add(row.event_id); lastSequence = row.source_sequence; earliest = Math.min(earliest, limit); consumed += row.consumed;
      if (row.event_type === "AssistantReasoned") {
        if (!id(row.turn_id) || turns.has(row.turn_id) || row.turn_id === header.turn_id || !id(row.user_content_id) || !id(row.assistant_content_id)
          || row.user_content_id === row.assistant_content_id || [row.user_content_id, row.assistant_content_id]
            .some(value => value === header.answer_content_id || value === header.user_content_id)) return null;
        turns.add(row.turn_id);
      } else if ([row.turn_id, row.user_content_id, row.assistant_content_id].some(value => value !== null)) return null;
      if (row.segment_enrollment_id === null) {
        if (row.consumed !== 1 || segmentColumns.some(key => row[key] !== null)) return null;
      } else {
        if (row.event_type !== "AssistantReasoned" || row.segment_enrollment_id !== header.enrollment_id || row.segment_revision !== header.enrollment_revision
          || row.segment_recipe !== "live-conversation-references-v1" || !positive(row.segment_first_sequence) || !positive(row.segment_last_sequence)
          || row.segment_first_sequence > row.source_sequence || row.segment_last_sequence < row.source_sequence
          || row.segment_last_sequence > header.selection_cursor || !positive(row.segment_member_count) || row.segment_member_count > 8
          || !Number.isSafeInteger(row.segment_ordinal) || row.segment_ordinal! < 0 || row.segment_ordinal! >= row.segment_member_count
          || nativeMemoryTimestamp(row.segment_created_at) === null || Date.parse(row.segment_created_at!) < enrolled || Date.parse(row.segment_created_at!) > created
          || nativeMemoryTimestamp(row.segment_retention_ceiling) === null || Date.parse(row.segment_retention_ceiling!) < limit) return null;
        const group = groups.get(row.segment_first_sequence) ?? []; group.push(row); groups.set(row.segment_first_sequence, group);
      }
    }
    if (!consumed || consumed > 64 || earliest !== ceiling || groups.size > NATIVE_MEMORY_ORIGIN_LIMITS.segments) return null;
    let previousLast = 0;
    for (const [first, rows] of [...groups].sort(([left], [right]) => left - right)) {
      const head = rows[0];
      if (first <= previousLast || rows.length !== head.segment_member_count || rows[0].source_sequence !== first
        || rows.at(-1)!.source_sequence !== head.segment_last_sequence || !rows.some(row => row.consumed === 1)) return null;
      for (const [index, row] of rows.entries()) if (row.segment_ordinal !== index
        || segmentColumns.filter(key => key !== "segment_ordinal").some(key => row[key] !== head[key])) return null;
      previousLast = head.segment_last_sequence!;
    }
    nativeMemoryCanonical({ header, dependencies });
    return { header, dependencies };
  } catch { return null; }
}

const captures = new WeakMap<NativeDocumentMemoryContext, NativeMemoryOriginCapture>();
const enrollmentFields = ["enrollment_id", "actor_user_id", "owner_user_id", "organization_id", "project_access_id", "project_id",
  "document_id", "revision", "policy_version", "permission_epoch", "enrolled_at", "expires_at", "retention_days", "cursor_sequence"] as const;

/** @internal Only the real native reader calls this with its detached guarded
 * native rows. Never accept this input from an HTTP body or an authority port. */
export async function captureNativeMemoryOrigin(value: NativeDocumentMemoryContext, input: {
  enrollment: NativeMemoryOriginEnrollment; scopeKey: string; sources: readonly NativeMemoryOriginSource[];
}): Promise<boolean> {
  try {
    // Own every mutable input before hashing introduces the first await.
    const encoded = nativeMemoryCanonical(value);
    if (bytes(encoded).length > NATIVE_MEMORY_ORIGIN_LIMITS.consumedBytes) return false;
    const consumed = structuredClone(value), owned = structuredClone(input);
    const enrollment = Object.fromEntries(enrollmentFields.map(key => [key, owned.enrollment[key]])) as NativeMemoryOriginEnrollment;
    const fresh = nativeMemoryTimestamp(consumed.lifetime.validUntil), checked = nativeMemoryTimestamp(consumed.lifetime.checkedAt);
    const enrolled = nativeMemoryTimestamp(enrollment.enrolled_at), expires = nativeMemoryTimestamp(enrollment.expires_at);
    if (fresh === null || checked === null || enrolled === null || expires === null || fresh <= Date.now() || fresh <= checked
      || fresh - checked > 60_000 || checked < enrolled || expires <= checked || consumed.mode !== "native-document-reference-memory"
      || consumed.treatment !== "untrusted-historical-evidence" || consumed.inferredPreferences !== false
      || !positive(enrollment.revision) || enrollment.policy_version !== "personal-memory-v2" || !id(enrollment.permission_epoch)
      || !positive(enrollment.cursor_sequence) || !Number.isSafeInteger(enrollment.retention_days) || enrollment.retention_days < 1 || enrollment.retention_days > 365
      || [enrollment.enrollment_id, enrollment.actor_user_id, enrollment.owner_user_id, enrollment.project_id, enrollment.document_id].some(item => !id(item))
      || (enrollment.organization_id === null) !== (enrollment.project_access_id === null)
      || enrollment.organization_id !== null && (!id(enrollment.organization_id) || !id(enrollment.project_access_id))
      || enrollment.organization_id === null && enrollment.actor_user_id !== enrollment.owner_user_id
      || owned.scopeKey !== JSON.stringify([enrollment.organization_id ?? "", enrollment.project_access_id ?? "", enrollment.project_id, enrollment.document_id])
      || nativeMemoryCanonical(consumed.scope) !== nativeMemoryCanonical({ organizationId: enrollment.organization_id,
        projectAccessId: enrollment.project_access_id, projectId: enrollment.project_id, documentId: enrollment.document_id })
      || !Array.isArray(owned.sources) || owned.sources.length < 1 || owned.sources.length > NATIVE_MEMORY_ORIGIN_LIMITS.dependencies) return false;
    const wanted = new Map([...consumed.actions, ...consumed.conversationPairs].map(row => [row.eventId, row]));
    if (!wanted.size || wanted.size !== consumed.actions.length + consumed.conversationPairs.length || wanted.size > 64) return false;
    const sources = [...owned.sources].sort((left, right) => left.sequence - right.sequence);
    const seen = new Set<string>(), turns = new Set<string>(), groups = new Map<number, NativeMemoryOriginSource[]>();
    const projected = sources.map((row, ordinal) => {
      const projection = nativeMemorySourceProjection(row), selected = wanted.get(row.event_id), segment = row.segment;
      const recorded = nativeMemoryTimestamp(row.recorded_at), limit = nativeMemoryTimestamp(row.valid_until);
      if (row.event_stream_id !== "creative:" + enrollment.owner_user_id || seen.has(row.event_id)
        || ordinal > 0 && sources[ordinal - 1].sequence >= row.sequence || row.sequence > enrollment.cursor_sequence
        || !sourceTypes.has(row.type) || recorded === null || recorded < enrolled || recorded > checked
        || limit === null || limit <= checked || limit > expires || limit > recorded + enrollment.retention_days * 86_400_000
        || !selected && !segment) return invalid();
      seen.add(row.event_id);
      if (row.turn_id !== null) { if (turns.has(row.turn_id)) return invalid(); turns.add(row.turn_id); }
      if (selected) {
        if (selected.sequence !== row.sequence || selected.recordedAt !== row.recorded_at || selected.validUntil !== row.valid_until) return invalid();
        if (row.type === "AssistantReasoned") {
          if (!("user" in selected) || selected.turnId !== row.turn_id || selected.user !== projection.user_text || selected.assistant !== projection.assistant_text) return invalid();
        } else if (!("type" in selected) || selected.type !== row.type || selected.blockId !== row.block_id) return invalid();
      }
      let ceiling = limit;
      if (segment) {
        const segmentExpiry = nativeMemoryTimestamp(segment.retention_ceiling), segmentCreated = nativeMemoryTimestamp(segment.created_at);
        if (row.type !== "AssistantReasoned" || segment.enrollment_id !== enrollment.enrollment_id || segment.revision !== enrollment.revision
          || segment.recipe !== "live-conversation-references-v1" || !positive(segment.first_sequence) || !positive(segment.last_sequence)
          || segment.first_sequence > row.sequence || segment.last_sequence < row.sequence || segment.last_sequence > enrollment.cursor_sequence
          || !positive(segment.member_count) || segment.member_count > 8 || !Number.isSafeInteger(segment.ordinal)
          || segment.ordinal < 0 || segment.ordinal >= segment.member_count || segmentExpiry === null || segmentExpiry <= checked
          || segmentCreated === null || segmentCreated < enrolled || segmentCreated > checked) return invalid();
        const group = groups.get(segment.first_sequence) ?? []; group.push(row); groups.set(segment.first_sequence, group);
        ceiling = Math.min(ceiling, segmentExpiry);
      }
      const dependency: Omit<NativeMemoryOriginDependency, "origin_id"> = { ordinal, event_stream_id: row.event_stream_id,
        event_id: row.event_id, source_sequence: row.sequence, event_type: row.type, recorded_at: row.recorded_at, block_id: row.block_id,
        turn_id: row.turn_id, user_content_id: row.user_content_id, assistant_content_id: row.assistant_content_id, projection_sha256: "",
        source_retention_ceiling: new Date(ceiling).toISOString(), consumed: selected ? 1 : 0,
        segment_enrollment_id: segment?.enrollment_id ?? null, segment_revision: segment?.revision ?? null, segment_recipe: segment?.recipe ?? null,
        segment_first_sequence: segment?.first_sequence ?? null, segment_last_sequence: segment?.last_sequence ?? null,
        segment_member_count: segment?.member_count ?? null, segment_ordinal: segment?.ordinal ?? null,
        segment_created_at: segment?.created_at ?? null, segment_retention_ceiling: segment?.retention_ceiling ?? null };
      return { projection, dependency };
    });
    if ([...wanted.keys()].some(key => !seen.has(key)) || groups.size > NATIVE_MEMORY_ORIGIN_LIMITS.segments) return false;
    let previousLast = 0;
    for (const [first, rows] of [...groups].sort(([left], [right]) => left - right)) {
      const head = rows[0].segment!;
      if (first <= previousLast || rows.length !== head.member_count || rows[0].sequence !== first
        || rows.at(-1)!.sequence !== head.last_sequence || !rows.some(row => wanted.has(row.event_id))) return false;
      for (const [ordinal, row] of rows.entries()) if (row.segment!.ordinal !== ordinal
        || nativeMemoryCanonical({ ...row.segment, ordinal: 0 }) !== nativeMemoryCanonical({ ...head, ordinal: 0 })) return false;
      previousLast = head.last_sequence;
    }
    const valueDigest = await hash(bytes(encoded));
    const projectionDigests = await Promise.all(projected.map(row => nativeMemoryFingerprint(row.projection)));
    const dependencies = projected.map((row, index) => ({ ...row.dependency, projection_sha256: projectionDigests[index] }));
    const result: NativeMemoryOriginCapture = { enrollment, scopeKey: owned.scopeKey, consumedValueSha256: valueDigest,
      sourceRetentionCeiling: new Date(Math.min(...dependencies.map(row => Date.parse(row.source_retention_ceiling)))).toISOString(),
      freshUntil: consumed.lifetime.validUntil, dependencies };
    nativeMemoryCanonical(result);
    if (Date.now() >= fresh || nativeMemoryCanonical(value) !== encoded) return false;
    captures.set(value, structuredClone(result)); return true;
  } catch { return false; }
}

/** Exact object identity plus immutable value fingerprint; copying a public value
 * cannot manufacture a capture. The returned metadata is detached from storage. */
export async function nativeMemoryOriginCapture(value: NativeDocumentMemoryContext): Promise<NativeMemoryOriginCapture | null> {
  try {
    const recorded = captures.get(value); if (!recorded || Date.now() >= Date.parse(recorded.freshUntil)) return null;
    const text = nativeMemoryCanonical(value), owned = structuredClone(recorded);
    if (await hash(bytes(text)) !== owned.consumedValueSha256 || nativeMemoryCanonical(value) !== text
      || Date.now() >= Date.parse(owned.freshUntil)) return null;
    return owned;
  } catch { return null; }
}

export type NativeMemoryOriginAnswer = {
  originId: string; turnId: string; answerEventId: string; answerContentId: string;
  userEventId: string; userContentId: string; userSourceSequence: number; user: string;
  answerSourceSequence: number; answer: string; createdAt: string; answerExpiresAt: string;
};
export type NativeMemoryOriginPublication = {
  header: NativeMemoryOriginHeader; dependencies: NativeMemoryOriginDependency[];
  statements: NativeMemoryOriginQuery[];
};
const columnMatch = (alias: string, json: string, columns: readonly string[]) => columns
  .map(key => `${alias}.${key} IS json_extract(${json},'$.${key}')`).join(" AND ");
const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

/** Server-only write preparation, not an authorization token. The answer/event,
 * these three statements, and the native context witness precommit statements
 * MUST share one atomic DB batch. Nothing here invokes a provider or publishes.
 * The transient answer bytes are bound for equality, never stored in the origin. */
export async function prepareNativeMemoryOrigin(value: NativeDocumentMemoryContext,
  answerInput: NativeMemoryOriginAnswer): Promise<NativeMemoryOriginPublication | null> {
  try {
    const answer = structuredClone(answerInput), consumed = structuredClone(value), consumedEncoding = nativeMemoryCanonical(consumed);
    const capture = await nativeMemoryOriginCapture(value);
    if (!capture || [answer.originId, answer.turnId, answer.userEventId, answer.userContentId,
      answer.answerEventId, answer.answerContentId].some(value => !id(value))) return null;
    const created = nativeMemoryTimestamp(answer.createdAt), expiry = nativeMemoryTimestamp(answer.answerExpiresAt);
    if (created === null || expiry === null || created > Date.now() || created < Date.parse(consumed.lifetime.checkedAt)
      || created >= Date.parse(capture.freshUntil) || expiry <= created || expiry > Date.parse(capture.sourceRetentionCeiling)) return null;
    const e = capture.enrollment;
    const dependencies = capture.dependencies.map(row => ({ origin_id: answer.originId, ...row }));
    const [answerHash, userHash, dependencyHash] = await Promise.all([
      nativeMemoryAnswerFingerprint(answer.answer), nativeMemoryAnswerFingerprint(answer.user), nativeMemoryDependencyListFingerprint(dependencies),
    ]);
    const header: NativeMemoryOriginHeader = { origin_id: answer.originId, schema_version: NATIVE_MEMORY_ORIGIN_SCHEMA,
      recipe_version: NATIVE_MEMORY_ORIGIN_RECIPE, actor_user_id: e.actor_user_id, owner_user_id: e.owner_user_id,
      organization_id: e.organization_id, project_access_id: e.project_access_id, project_id: e.project_id,
      document_id: e.document_id, scope_key: capture.scopeKey, turn_id: answer.turnId,
      user_event_id: answer.userEventId, user_content_id: answer.userContentId, user_source_sequence: answer.userSourceSequence, user_sha256: userHash,
      answer_event_id: answer.answerEventId,
      answer_content_id: answer.answerContentId, answer_source_sequence: answer.answerSourceSequence,
      answer_sha256: answerHash, answer_expires_at: answer.answerExpiresAt,
      consumed_value_sha256: capture.consumedValueSha256, dependency_list_sha256: dependencyHash,
      enrollment_id: e.enrollment_id, enrollment_revision: e.revision, policy_version: e.policy_version,
      permission_epoch: e.permission_epoch, enrolled_at: e.enrolled_at, enrollment_expires_at: e.expires_at,
      retention_days: e.retention_days, selection_cursor: e.cursor_sequence, source_retention_ceiling: capture.sourceRetentionCeiling,
      dependency_count: dependencies.length, created_at: answer.createdAt, status: "active", withdrawn_at: null, withdrawal_reason: null };
    if (!validateNativeMemoryOriginRows(header, dependencies) || !await nativeMemoryOriginCapture(value)
      || nativeMemoryCanonical(value) !== consumedEncoding || Date.now() >= Date.parse(capture.freshUntil)) return null;
    const headerJson = nativeMemoryCanonical(header), dependencyJson = nativeMemoryCanonical(dependencies);
    const enrollmentJson = nativeMemoryCanonical(e);
    const insertHeader: NativeMemoryOriginQuery = {
      sql: `WITH expected(value) AS (VALUES(?)) INSERT INTO memory_native_answer_origins(${NATIVE_MEMORY_ORIGIN_HEADER_COLUMNS.join(",")})
        SELECT ${NATIVE_MEMORY_ORIGIN_HEADER_COLUMNS.map(key => `json_extract(value,'$.${key}')`).join(",")} FROM expected
        WHERE ${nowSql}<?`, bindings: [headerJson, capture.freshUntil],
    };
    const insertDependencies: NativeMemoryOriginQuery = {
      sql: `INSERT INTO memory_native_answer_dependencies(${NATIVE_MEMORY_ORIGIN_DEPENDENCY_COLUMNS.join(",")})
        SELECT ${NATIVE_MEMORY_ORIGIN_DEPENDENCY_COLUMNS.map(key => `json_extract(value,'$.${key}')`).join(",")} FROM json_each(?)`,
      bindings: [dependencyJson],
    };
    const exactEnrollment = enrollmentFields.filter(key => key !== "cursor_sequence")
      .map(key => `enrollment.${key} IS json_extract(original.value,'$.${key}')`).join(" AND ");
    const custody = header.organization_id === null
      ? "NOT EXISTS(SELECT 1 FROM project_event_scopes scope WHERE scope.event_id=event.event_id)"
      : `EXISTS(SELECT 1 FROM project_event_scopes scope WHERE scope.event_id=event.event_id
          AND (scope.source_stream_id,scope.source_sequence,scope.organization_id,scope.project_access_id,
            scope.project_id,scope.owner_user_id,scope.actor_user_id) IS
            (event.stream_id,event.sequence,origin.organization_id,origin.project_access_id,origin.project_id,origin.owner_user_id,origin.actor_user_id))`;
    const completion: NativeMemoryOriginQuery = {
      sql: `WITH expected(value) AS (VALUES(?)), saved(value) AS (VALUES(?)), original(value) AS (VALUES(?))
        SELECT CASE WHEN ${nowSql}<? AND EXISTS(SELECT 1 FROM expected,memory_native_answer_origins origin
          WHERE ${columnMatch("origin", "expected.value", NATIVE_MEMORY_ORIGIN_HEADER_COLUMNS)}
          AND origin.source_retention_ceiling>${nowSql} AND origin.answer_expires_at>${nowSql}
          AND (SELECT COUNT(*) FROM memory_native_answer_dependencies dependency WHERE dependency.origin_id=origin.origin_id)=origin.dependency_count
          AND NOT EXISTS(SELECT 1 FROM memory_native_answer_dependencies dependency,saved
            WHERE dependency.origin_id=origin.origin_id AND NOT EXISTS(SELECT 1 FROM json_each(saved.value) item
              WHERE ${columnMatch("dependency", "item.value", NATIVE_MEMORY_ORIGIN_DEPENDENCY_COLUMNS)}))
          AND EXISTS(SELECT 1 FROM memory_live_enrollments enrollment,original WHERE ${exactEnrollment}
            AND enrollment.recall_enabled=1 AND enrollment.expires_at>${nowSql}
            AND enrollment.cursor_sequence>=json_extract(original.value,'$.cursor_sequence'))
          AND NOT EXISTS(SELECT 1 FROM memory_native_answer_dependencies dependency WHERE dependency.origin_id=origin.origin_id
            AND (dependency.source_retention_ceiling<=${nowSql} OR NOT EXISTS(SELECT 1 FROM memory_live_sources remembered
              WHERE remembered.enrollment_id=origin.enrollment_id AND remembered.event_id=dependency.event_id
                AND remembered.sequence=dependency.source_sequence AND remembered.expires_at>${nowSql})
              OR EXISTS(SELECT 1 FROM memory_native_answer_origins parent
                WHERE parent.answer_content_id IN(dependency.user_content_id,dependency.assistant_content_id))
              OR EXISTS(SELECT 1 FROM events ancestor WHERE ancestor.type='AssistantReasoned'
                AND json_type(ancestor.payload,'$.memory_origin_version') IS NOT NULL
                AND json_extract(ancestor.payload,'$.content_ref') IN(dependency.user_content_id,dependency.assistant_content_id))))
          AND EXISTS(SELECT 1 FROM assistant_turns turn JOIN private_content answer ON answer.content_id=turn.assistant_content_ref
            JOIN private_content authored ON authored.content_id=turn.user_content_ref
            JOIN events event ON event.event_id=origin.answer_event_id JOIN events message ON message.event_id=origin.user_event_id
            WHERE (turn.actor_user_id,turn.scope_key,turn.turn_id,turn.organization_id,turn.project_access_id,turn.project_id,turn.document_id)
              IS (origin.actor_user_id,origin.scope_key,origin.turn_id,origin.organization_id,origin.project_access_id,origin.project_id,origin.document_id)
              AND (answer.content_id,answer.owner_id,answer.kind,answer.content,answer.expires_at,answer.redacted_at)
                IS (origin.answer_content_id,origin.actor_user_id,'chat-assistant-memory',?,?,NULL)
              AND answer.expires_at=origin.answer_expires_at AND answer.expires_at>${nowSql} AND answer.expires_at<=origin.source_retention_ceiling
              AND (authored.content_id,authored.owner_id,authored.kind,authored.content,authored.redacted_at)
                IS (origin.user_content_id,origin.actor_user_id,'chat-user',?,NULL) AND authored.expires_at>${nowSql}
              AND (event.stream_id,event.sequence,event.type,event.actor) IS
                ('creative:'||origin.owner_user_id,origin.answer_source_sequence,'AssistantReasoned','user:'||origin.actor_user_id)
              AND (message.stream_id,message.sequence,message.type,message.actor,message.client_id,message.correlation_id)
                IS (event.stream_id,origin.user_source_sequence,'ChatMessageSent',event.actor,'web:assistant',origin.actor_user_id||':'||origin.turn_id)
              AND (event.client_id,event.correlation_id,event.causation_id) IS (message.client_id,message.correlation_id,message.event_id)
              AND event.schema_version=1 AND message.schema_version=1 AND event.compensates_event_id IS NULL
              AND message.compensates_event_id IS NULL AND message.causation_id IS NULL
              AND authored.created_at=turn.created_at AND answer.created_at=turn.created_at AND turn.status='completed' AND turn.completed_at=turn.created_at
              AND json_extract(message.payload,'$.turn_id')=origin.turn_id AND json_extract(message.payload,'$.content_ref')=origin.user_content_id
              AND json_extract(message.payload,'$.project_id')=origin.project_id AND json_extract(message.payload,'$.document_id')=origin.document_id
              AND json_extract(message.payload,'$.actor_user_id')=origin.actor_user_id AND json_extract(event.payload,'$.actor_user_id')=origin.actor_user_id
              AND json_extract(event.payload,'$.operation')='creative-chat' AND json_extract(event.payload,'$.turn_id')=origin.turn_id
              AND json_type(event.payload,'$.memory_origin_version')='integer' AND json_extract(event.payload,'$.memory_origin_version')=1
              AND json_type(event.payload,'$.organization_id') IS CASE WHEN origin.organization_id IS NULL THEN 'null' ELSE 'text' END
              AND json_type(event.payload,'$.project_access_id') IS CASE WHEN origin.project_access_id IS NULL THEN 'null' ELSE 'text' END
              AND json_extract(event.payload,'$.organization_id') IS origin.organization_id
              AND json_extract(event.payload,'$.project_access_id') IS origin.project_access_id
              AND json_type(event.payload,'$.owner_user_id')='text' AND json_extract(event.payload,'$.owner_user_id')=origin.owner_user_id
              AND json_extract(event.payload,'$.content_ref')=origin.answer_content_id AND json_extract(event.payload,'$.project_id')=origin.project_id
              AND json_extract(event.payload,'$.document_id')=origin.document_id AND (${custody}) AND (${custody.replaceAll("event.", "message.")})
              AND turn.proposal_json IS NULL AND json_type(event.payload,'$.proposal_count') IS NULL
              AND NOT EXISTS(SELECT 1 FROM assistant_action_proposals proposal WHERE
                (proposal.actor_user_id,proposal.scope_key,proposal.turn_id)=(turn.actor_user_id,turn.scope_key,turn.turn_id))
              AND NOT EXISTS(SELECT 1 FROM events proposal_event WHERE proposal_event.stream_id=event.stream_id
                AND proposal_event.type='MutationProposed' AND json_extract(proposal_event.payload,'$.turn_id')=origin.turn_id)
              AND EXISTS(SELECT 1 FROM event_client_receipts receipt WHERE (receipt.stream_id,receipt.client_event_id,receipt.event_id,receipt.sequence)
                IS (event.stream_id,'assistant:'||origin.actor_user_id||':'||COALESCE(origin.project_access_id,'personal')||':'||origin.document_id||':'||origin.turn_id||':user',message.event_id,message.sequence)
                AND receipt.created_at=turn.created_at)
              AND EXISTS(SELECT 1 FROM event_client_receipts receipt WHERE (receipt.stream_id,receipt.client_event_id,receipt.event_id,receipt.sequence)
                IS (event.stream_id,'assistant:'||origin.actor_user_id||':'||COALESCE(origin.project_access_id,'personal')||':'||origin.document_id||':'||origin.turn_id||':assistant',event.event_id,event.sequence)
                AND receipt.created_at=turn.created_at)
              AND NOT EXISTS(SELECT 1 FROM assistant_specialist_tasks task WHERE
                (task.actor_user_id,task.scope_key,task.turn_id)=(turn.actor_user_id,turn.scope_key,turn.turn_id))))
          THEN 1 ELSE json('memory_native_origin_publication_failed') END AS verified`,
      bindings: [headerJson, dependencyJson, enrollmentJson, capture.freshUntil, answer.answer, answer.answerExpiresAt, answer.user],
    };
    return { header, dependencies, statements: [insertHeader, insertDependencies, completion] };
  } catch { return null; }
}

export type NativeMemoryOriginWithdrawalSelector = { originId: string } | { enrollmentId: string }
  | { enrollmentId: string; currentRevision: number }
  | { enrollmentId: string; currentRevision: number; unavailableDependencies: true }
  | { eventStreamId: string; eventId: string } | { contentId: string }
  | { actorUserId: string; personalOnly?: true } | { organizationId: string };

function nativeMemoryOriginWithdrawalSelection(selectorInput: NativeMemoryOriginWithdrawalSelector): NativeMemoryOriginQuery | null {
  try {
    const selector = structuredClone(selectorInput);
    let selection: string, bindings: (string | number | null)[];
    if (exactKeys(selector, ["originId"]) && "originId" in selector && id(selector.originId)) {
      selection = "origin.origin_id=?"; bindings = [selector.originId];
    } else if (exactKeys(selector, ["enrollmentId"]) && "enrollmentId" in selector && id(selector.enrollmentId)) {
      selection = "origin.enrollment_id=?"; bindings = [selector.enrollmentId];
    } else if ((exactKeys(selector, ["enrollmentId", "currentRevision"])
      || exactKeys(selector, ["enrollmentId", "currentRevision", "unavailableDependencies"]) && "unavailableDependencies" in selector && selector.unavailableDependencies === true)
      && "enrollmentId" in selector && "currentRevision" in selector
      && id(selector.enrollmentId) && positive(selector.currentRevision)) {
      // A stale forget/settings request must not withdraw a newer enrollment's
      // origins. This guard remains inside every statement of the atomic inverse.
      selection = "origin.enrollment_id=? AND EXISTS(SELECT 1 FROM memory_live_enrollments current" +
        " WHERE current.enrollment_id=? AND current.revision=?)";
      bindings = [selector.enrollmentId, selector.enrollmentId, selector.currentRevision];
      if ("unavailableDependencies" in selector) {
        // Run after the existing reference/segment prune in the SAME transaction.
        // This metadata-only inverse intentionally does not rehydrate/hash prose.
        // One reference may fan out to many origins; never silently truncate erase.
        selection += ` AND (origin.enrollment_revision<>? OR origin.source_retention_ceiling<=${nowSql}
          OR (SELECT COUNT(*) FROM (SELECT 1 FROM memory_native_answer_dependencies counted WHERE counted.origin_id=origin.origin_id LIMIT 129))<>origin.dependency_count
          OR EXISTS(SELECT 1 FROM memory_native_answer_dependencies dependency WHERE dependency.origin_id=origin.origin_id AND (
            dependency.source_retention_ceiling<=${nowSql}
            OR NOT EXISTS(SELECT 1 FROM memory_live_sources remembered WHERE remembered.enrollment_id=origin.enrollment_id
              AND remembered.event_id=dependency.event_id AND remembered.sequence=dependency.source_sequence AND remembered.expires_at>${nowSql})
            OR dependency.segment_enrollment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM memory_live_conversation_segments segment
              WHERE (segment.enrollment_id,segment.enrollment_revision,segment.recipe_version,segment.first_sequence,
                segment.last_sequence,segment.member_count,segment.created_at) IS
                (dependency.segment_enrollment_id,dependency.segment_revision,dependency.segment_recipe,dependency.segment_first_sequence,
                dependency.segment_last_sequence,dependency.segment_member_count,dependency.segment_created_at)
              AND segment.expires_at>${nowSql} AND CASE WHEN json_valid(segment.members_json)
                AND typeof(dependency.segment_ordinal)='integer' AND dependency.segment_ordinal BETWEEN 0 AND 7
                THEN CASE WHEN json_type(segment.members_json)='array' AND json_array_length(segment.members_json)=segment.member_count
                  AND length(segment.members_json)<=8192 THEN
                  json_extract(segment.members_json,'$['||dependency.segment_ordinal||'].eventId') IS dependency.event_id
                  AND json_extract(segment.members_json,'$['||dependency.segment_ordinal||'].sequence') IS dependency.source_sequence
                  AND json_extract(segment.members_json,'$['||dependency.segment_ordinal||'].turnId') IS dependency.turn_id
                  ELSE 0 END ELSE 0 END))))`;
        bindings.push(selector.currentRevision);
      }
    } else if (exactKeys(selector, ["actorUserId"]) && "actorUserId" in selector && id(selector.actorUserId)) {
      selection = "origin.actor_user_id=?"; bindings = [selector.actorUserId];
    } else if (exactKeys(selector, ["actorUserId", "personalOnly"]) && "actorUserId" in selector && "personalOnly" in selector
      && id(selector.actorUserId) && selector.personalOnly === true) {
      selection = "origin.actor_user_id=? AND origin.organization_id IS NULL"; bindings = [selector.actorUserId];
    } else if (exactKeys(selector, ["organizationId"]) && "organizationId" in selector && id(selector.organizationId)) {
      selection = "origin.organization_id=?"; bindings = [selector.organizationId];
    } else if (exactKeys(selector, ["eventStreamId", "eventId"]) && "eventStreamId" in selector
      && "eventId" in selector && id(selector.eventStreamId) && id(selector.eventId)) {
      selection = "(('creative:'||origin.owner_user_id)=? AND (origin.user_event_id=? OR origin.answer_event_id=?)) OR " +
        "EXISTS(SELECT 1 FROM memory_native_answer_dependencies dependency WHERE dependency.origin_id=origin.origin_id" +
        " AND dependency.event_stream_id=? AND dependency.event_id=?)";
      bindings = [selector.eventStreamId, selector.eventId, selector.eventId, selector.eventStreamId, selector.eventId];
    } else if (exactKeys(selector, ["contentId"]) && "contentId" in selector && id(selector.contentId)) {
      selection = "origin.user_content_id=? OR origin.answer_content_id=? OR " +
        "EXISTS(SELECT 1 FROM memory_native_answer_dependencies dependency WHERE dependency.origin_id=origin.origin_id" +
        " AND (dependency.user_content_id=? OR dependency.assistant_content_id=?))";
      bindings = [selector.contentId, selector.contentId, selector.contentId, selector.contentId];
    } else return null;
    return { sql: selection, bindings };
  } catch { return null; }
}

/** Legacy late-bound inverse. Its synchronous three-argument contract supports
 * reuse after reference pruning/publication trimming; never freeze those dynamic
 * selections at preparation time. Mutation-aware dependency minimization uses
 * the separately bracketed operation below; this path retains dependencies.
 * Redaction is restricted to exact marked answer refs of their original actor. */
export function nativeMemoryOriginWithdrawal(selectorInput: NativeMemoryOriginWithdrawalSelector,
  reason: NativeMemoryOriginWithdrawalReason, withdrawnAt: string): NativeMemoryOriginQuery[] | null {
  try {
    const query = nativeMemoryOriginWithdrawalSelection(selectorInput);
    if (!query || !reasons.has(reason) || nativeMemoryTimestamp(withdrawnAt) === null) return null;
    const { sql: selection, bindings } = query;
    return [{ sql: "UPDATE memory_native_answer_origins AS origin SET status='withdrawn',withdrawn_at=?,withdrawal_reason=?" +
      " WHERE origin.status='active' AND origin.created_at<=? AND (" + selection + ")", bindings: [withdrawnAt, reason, withdrawnAt, ...bindings] },
    { sql: "UPDATE private_content SET content='',redacted_at=COALESCE(redacted_at,?) WHERE kind='chat-assistant-memory'" +
      " AND EXISTS(SELECT 1 FROM memory_native_answer_origins origin WHERE origin.status='withdrawn'" +
      " AND origin.answer_content_id=private_content.content_id AND origin.actor_user_id=private_content.owner_id AND (" + selection + "))",
      bindings: [withdrawnAt, ...bindings] },
    { sql: "SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM memory_native_answer_origins origin WHERE (" + selection + ")" +
      " AND (origin.status<>'withdrawn' OR EXISTS(SELECT 1 FROM private_content answer WHERE answer.content_id=origin.answer_content_id" +
      " AND answer.owner_id=origin.actor_user_id AND answer.kind='chat-assistant-memory' AND (answer.redacted_at IS NULL OR answer.content<>''))))" +
      " THEN 1 ELSE json('memory_native_origin_withdrawal_failed') END AS verified", bindings: [...bindings] }];
  } catch { return null; }
}

/** Capture without a recall/fan-out cap, then recheck the COMPLETE selection in
 * the caller's existing transaction before any write. Capturing an empty set is
 * meaningful: a later match must abort, not be silently missed. This operation
 * adds no withdrawal authority or cause, and never deletes origin/event IDs.
 * The complete returned array must execute CONTIGUOUSLY in one atomic batch.
 * Existing callers update enrollment only AFTER the array, and existing schema
 * triggers do not update it. Under that contract a stale entry is a full no-op;
 * inserting enrollment mutations between these statements is not supported.
 *
 * unavailableDependencies is deliberately excluded: source/group mutations need
 * the separately bracketed prepareNativeMemoryOriginDependencyWithdrawal below. */
export function prepareNativeMemoryOriginWithdrawal(selectorInput: NativeMemoryOriginWithdrawalSelector,
  reason: NativeMemoryOriginWithdrawalReason, withdrawnAt: string): {
    targets: NativeMemoryOriginQuery;
    statements: (rows: readonly NativeMemoryOriginHeader[]) => NativeMemoryOriginQuery[] | null;
  } | null {
  try {
    const selector = structuredClone(selectorInput), query = nativeMemoryOriginWithdrawalSelection(selector);
    if (!query || "unavailableDependencies" in selector || !reasons.has(reason)
      || nativeMemoryTimestamp(withdrawnAt) === null) return null;
    const { sql: selection, bindings } = query;
    const columns = NATIVE_MEMORY_ORIGIN_HEADER_COLUMNS;
    const targets = { sql: `SELECT ${columns.map(column => "origin." + column).join(",")}
      FROM memory_native_answer_origins origin WHERE (${selection}) ORDER BY origin.origin_id`, bindings: [...bindings] };
    return { targets, statements(input) {
      try {
        const rows = structuredClone(input);
        if (!Array.isArray(rows)) return null;
        const ids = new Set<string>();
        for (const row of rows) {
          if (!row || !exactKeys(row, columns) || !id(row.origin_id) || ids.has(row.origin_id)
            || Object.values(row).some(value => value !== null && typeof value !== "string"
              && !(typeof value === "number" && Number.isSafeInteger(value)))
            || row.status !== "active" && row.status !== "withdrawn") return null;
          ids.add(row.origin_id);
        }
        // Only metadata is retained in the prepared bindings. No source prose,
        // provider call, persistent scratch table or connection-local state.
        const captured = JSON.stringify(rows);
        const revision = "currentRevision" in selector
          ? "EXISTS(SELECT 1 FROM memory_live_enrollments current WHERE current.enrollment_id=? AND current.revision=?)"
          : "1";
        const revisionBindings = "currentRevision" in selector ? [selector.enrollmentId, selector.currentRevision] : [];
        const expected = `expected AS (SELECT ${columns.map(column =>
          `json_extract(value,'$.${column}') AS ${column}`).join(",")} FROM json_each(?))`;
        const actual = `actual AS (SELECT origin.origin_id FROM memory_native_answer_origins origin WHERE (${selection}))`;
        const exactSelection = `NOT EXISTS(SELECT origin_id FROM actual EXCEPT SELECT origin_id FROM expected)
          AND NOT EXISTS(SELECT origin_id FROM expected EXCEPT SELECT origin_id FROM actual)`;
        const tuple = (prefix: string, names: readonly string[]) => "(" + names.map(column => prefix + "." + column).join(",") + ")";
        const immutable = columns.filter(column => !["status", "withdrawn_at", "withdrawal_reason"].includes(column));
        const identity = `${tuple("origin", immutable)} IS ${tuple("expected", immutable)}`;
        const original = `${tuple("origin", columns)} IS ${tuple("expected", columns)}`;
        const terminal = `(${identity}) AND origin.status='withdrawn'
          AND origin.withdrawn_at IS CASE WHEN expected.status='withdrawn' THEN expected.withdrawn_at ELSE ? END
          AND origin.withdrawal_reason IS CASE WHEN expected.status='withdrawn' THEN expected.withdrawal_reason ELSE ? END`;
        const redacted = `NOT EXISTS(SELECT 1 FROM private_content answer WHERE answer.content_id=origin.answer_content_id
          AND answer.owner_id=origin.actor_user_id AND answer.kind='chat-assistant-memory'
          AND (answer.redacted_at IS NULL OR answer.content<>''))`;
        const matchingHeaders = (condition: string) => `NOT EXISTS(SELECT 1 FROM expected
          LEFT JOIN memory_native_answer_origins origin ON origin.origin_id=expected.origin_id
          WHERE origin.origin_id IS NULL OR NOT (${condition}))`;
        const assertion = (condition: string, extra: (string | number | null)[] = []): NativeMemoryOriginQuery => ({
          sql: `WITH ${expected},${actual} SELECT CASE WHEN NOT (${revision}) OR (${condition})
            THEN 1 ELSE json('memory_native_origin_withdrawal_changed') END AS verified`,
          bindings: [captured, ...bindings, ...revisionBindings, ...extra],
        });
        // After deletion a dependency-based selector may no longer match the old
        // targets. Verify those captured identities directly, while rejecting ANY
        // new matching origin. Every assertion/write retains the same original
        // revision predicate so a stale transaction entry cannot erase or throw.
        return [
          assertion(`(${exactSelection}) AND (${matchingHeaders(original)})`),
          { sql: `WITH ${expected} UPDATE memory_native_answer_origins AS origin
            SET status='withdrawn',withdrawn_at=?,withdrawal_reason=? WHERE origin.status='active' AND origin.created_at<=?
            AND origin.origin_id IN(SELECT origin_id FROM expected) AND (${selection})`,
            bindings: [captured, withdrawnAt, reason, withdrawnAt, ...bindings] },
          assertion(`(${exactSelection}) AND (${matchingHeaders(terminal)})`, [withdrawnAt, reason]),
          { sql: `WITH ${expected} UPDATE private_content SET content='',redacted_at=COALESCE(redacted_at,?)
            WHERE kind='chat-assistant-memory' AND EXISTS(SELECT 1 FROM memory_native_answer_origins origin
              WHERE origin.origin_id IN(SELECT origin_id FROM expected) AND origin.status='withdrawn'
              AND origin.answer_content_id=private_content.content_id AND origin.actor_user_id=private_content.owner_id)
              AND (${revision})`,
            bindings: [captured, withdrawnAt, ...revisionBindings] },
          assertion(`(${exactSelection}) AND (${matchingHeaders(`(${terminal}) AND (${redacted})`)})`, [withdrawnAt, reason]),
          { sql: `WITH ${expected} DELETE FROM memory_native_answer_dependencies
            WHERE origin_id IN(SELECT origin_id FROM expected) AND (${revision})`,
            bindings: [captured, ...revisionBindings] },
          assertion(`NOT EXISTS(SELECT origin_id FROM actual EXCEPT SELECT origin_id FROM expected)
            AND (${matchingHeaders(`(${terminal}) AND (${redacted})`)})
            AND NOT EXISTS(SELECT 1 FROM memory_native_answer_dependencies WHERE origin_id IN(SELECT origin_id FROM expected))`,
          [withdrawnAt, reason]),
        ];
      } catch { return null; }
    } };
  } catch { return null; }
}

export type NativeMemoryOriginDependencyWithdrawalScope = { enrollmentId: string; currentRevision: number };
export type NativeMemoryOriginDependencyWithdrawalQueries = {
  beforeMutation: NativeMemoryOriginQuery[];
  afterMutation: NativeMemoryOriginQuery[];
};

/** Prepare each prune/trim transaction independently, capturing ALL scoped origin
 * headers without a fan-out cap. Execute beforeMutation, the caller's existing
 * source/group mutations, and the complete contiguous afterMutation in ONE
 * atomic batch. Enrollment changes belong after that complete sequence. The
 * existing callers/triggers do not repair sources/groups or insert dependencies
 * during the inverse; this is not a protocol for arbitrary side-effect triggers.
 *
 * Only late unavailableDependencies eligibility retires an active origin. Every
 * captured already-withdrawn origin is also minimized, even with healthy retained
 * dependencies: that is terminal-residue cleanup, not another withdrawal cause.
 * Original tombstones remain unchanged. The terminal header remembers the cleanup
 * target after dependency deletion; final absence checks use those IDs directly.
 * Positive immutable dependency_count also keeps newly withdrawn targets in the
 * unavailable set after deletion. A later expiry or contradictory header/set
 * change must roll back, never silently expand the completed withdrawal step. */
export function prepareNativeMemoryOriginDependencyWithdrawal(scopeInput: NativeMemoryOriginDependencyWithdrawalScope,
  reason: NativeMemoryOriginWithdrawalReason, withdrawnAt: string): {
    targets: NativeMemoryOriginQuery;
    statements: (rows: readonly NativeMemoryOriginHeader[]) => NativeMemoryOriginDependencyWithdrawalQueries | null;
  } | null {
  try {
    const scope = structuredClone(scopeInput);
    if (!scope || !exactKeys(scope, ["enrollmentId", "currentRevision"])) return null;
    const query = nativeMemoryOriginWithdrawalSelection(scope);
    const unavailable = nativeMemoryOriginWithdrawalSelection({ ...scope, unavailableDependencies: true });
    if (!query || !unavailable || !reasons.has(reason) || nativeMemoryTimestamp(withdrawnAt) === null) return null;
    const columns = NATIVE_MEMORY_ORIGIN_HEADER_COLUMNS;
    const targets = { sql: `SELECT ${columns.map(column => "origin." + column).join(",")}
      FROM memory_native_answer_origins origin WHERE (${query.sql}) ORDER BY origin.origin_id`, bindings: [...query.bindings] };
    return { targets, statements(input) {
      try {
        const rows = structuredClone(input);
        if (!Array.isArray(rows)) return null;
        const ids = new Set<string>();
        for (const row of rows) {
          if (!row || !exactKeys(row, columns) || !id(row.origin_id) || ids.has(row.origin_id)
            || row.enrollment_id !== scope.enrollmentId
            || Object.values(row).some(value => value !== null && typeof value !== "string"
              && !(typeof value === "number" && Number.isSafeInteger(value)))
            || row.status !== "active" && row.status !== "withdrawn"
            || !positive(row.dependency_count) || row.dependency_count > NATIVE_MEMORY_ORIGIN_LIMITS.dependencies) return null;
          ids.add(row.origin_id);
        }
        // Snapshot metadata only; no source prose, scratch table or connection
        // state. A fresh preparation is required for each separately committed batch.
        const captured = JSON.stringify(rows);
        const revision = "EXISTS(SELECT 1 FROM memory_live_enrollments current WHERE current.enrollment_id=? AND current.revision=?)";
        const revisionBindings = [scope.enrollmentId, scope.currentRevision];
        const expected = `expected AS (SELECT ${columns.map(column =>
          `json_extract(value,'$.${column}') AS ${column}`).join(",")} FROM json_each(?))`;
        const actual = `actual AS (SELECT origin.origin_id FROM memory_native_answer_origins origin WHERE (${query.sql}))`;
        const exactSelection = `NOT EXISTS(SELECT origin_id FROM actual EXCEPT SELECT origin_id FROM expected)
          AND NOT EXISTS(SELECT origin_id FROM expected EXCEPT SELECT origin_id FROM actual)`;
        const tuple = (prefix: string, names: readonly string[]) => "(" + names.map(column => prefix + "." + column).join(",") + ")";
        const immutable = columns.filter(column => !["status", "withdrawn_at", "withdrawal_reason"].includes(column));
        const original = `${tuple("origin", columns)} IS ${tuple("expected", columns)}`;
        const terminal = `${tuple("origin", immutable)} IS ${tuple("expected", immutable)}
          AND origin.status='withdrawn' AND origin.withdrawn_at IS ? AND origin.withdrawal_reason IS ?`;
        // Captured terminal headers remain exact, independently of later source
        // availability. For an originally active row, require BOTH its current
        // eligibility and the corresponding exact original/new-terminal header.
        const currentHeader = `CASE WHEN expected.status='withdrawn' THEN (${original})
          WHEN (${unavailable.sql}) THEN (${terminal}) ELSE (${original}) END`;
        const currentBindings = [...unavailable.bindings, withdrawnAt, reason];
        const redacted = `origin.status<>'withdrawn' OR NOT EXISTS(SELECT 1 FROM private_content answer
          WHERE answer.content_id=origin.answer_content_id AND answer.owner_id=origin.actor_user_id
          AND answer.kind='chat-assistant-memory' AND (answer.redacted_at IS NULL OR answer.content<>''))`;
        const matchingHeaders = (condition: string) => `NOT EXISTS(SELECT 1 FROM expected
          LEFT JOIN memory_native_answer_origins origin ON origin.origin_id=expected.origin_id
          WHERE origin.origin_id IS NULL OR NOT (${condition}))`;
        const assertion = (condition: string, extra: (string | number | null)[] = []): NativeMemoryOriginQuery => ({
          sql: `WITH ${expected},${actual} SELECT CASE WHEN NOT (${revision}) OR (${exactSelection}) AND (${condition})
            THEN 1 ELSE json('memory_native_origin_withdrawal_changed') END AS verified`,
          bindings: [captured, ...query.bindings, ...revisionBindings, ...extra],
        });
        const originalHeaders = () => assertion(matchingHeaders(original));
        const terminalIds = `SELECT origin.origin_id FROM expected
          JOIN memory_native_answer_origins origin ON origin.origin_id=expected.origin_id WHERE origin.status='withdrawn'`;
        return {
          beforeMutation: [originalHeaders()],
          afterMutation: [
            // Caller mutations may affect eligibility, but never the captured
            // enrollment-wide origin set or any captured header field.
            originalHeaders(),
            { sql: `WITH ${expected} UPDATE memory_native_answer_origins AS origin
              SET status='withdrawn',withdrawn_at=?,withdrawal_reason=? WHERE origin.status='active' AND origin.created_at<=?
              AND origin.origin_id IN(SELECT origin_id FROM expected) AND (${unavailable.sql})`,
              bindings: [captured, withdrawnAt, reason, withdrawnAt, ...unavailable.bindings] },
            assertion(matchingHeaders(currentHeader), currentBindings),
            { sql: `WITH ${expected} UPDATE private_content SET content='',redacted_at=COALESCE(redacted_at,?)
              WHERE kind='chat-assistant-memory' AND EXISTS(SELECT 1 FROM memory_native_answer_origins origin
                WHERE origin.origin_id IN(SELECT origin_id FROM expected) AND origin.status='withdrawn'
                AND origin.answer_content_id=private_content.content_id AND origin.actor_user_id=private_content.owner_id)
                AND (${revision})`,
              bindings: [captured, withdrawnAt, ...revisionBindings] },
            assertion(matchingHeaders(`(${currentHeader}) AND (${redacted})`), currentBindings),
            { sql: `WITH ${expected} DELETE FROM memory_native_answer_dependencies
              WHERE origin_id IN(${terminalIds}) AND (${revision})`, bindings: [captured, ...revisionBindings] },
            assertion(`(${matchingHeaders(`(${currentHeader}) AND (${redacted})`)})
              AND NOT EXISTS(SELECT 1 FROM memory_native_answer_dependencies WHERE origin_id IN(${terminalIds}))`, currentBindings),
          ],
        };
      } catch { return null; }
    } };
  } catch { return null; }
}

// R6 structured-origin publication and validation.

import type { WorkerEnv } from "./runtime.ts";
import type { PreparedNativeStructuredConversationContext } from "./memory-live-context.ts";
import type { LegacyConversationOriginalReceipt, LegacyConversationOriginalInterval } from "./events-api.ts";

export const NATIVE_STRUCTURED_ORIGIN_RECIPE = "native-structured-answer-origin-v1";
export const NATIVE_STRUCTURED_ORIGIN_KIND = "memory-structured-origin";
export const NATIVE_STRUCTURED_ORIGIN_HEADER_COLUMNS = ["origin_id", "schema_version", "recipe_version", "actor_user_id", "owner_user_id",
  "organization_id", "project_access_id", "project_id", "document_id", "scope_key", "turn_id", "user_event_id", "user_content_id",
  "user_source_sequence", "user_sha256", "answer_event_id", "answer_content_id", "answer_source_sequence", "answer_sha256", "answer_expires_at",
  "enrollment_id", "enrollment_revision", "permission_epoch", "policy_version", "enrolled_at", "enrollment_expires_at", "retention_days",
  "source_head", "ledger_id", "ledger_storage_revision", "ledger_body_ref", "ledger_body_sha256", "consumed_context_sha256",
  "source_list_sha256", "source_count", "ledger_history_sha256", "ledger_revision_count", "manifest_content_ref", "manifest_sha256",
  "manifest_expires_at", "source_retention_ceiling", "created_at", "status", "withdrawn_at", "withdrawal_reason"] as const;
export const NATIVE_STRUCTURED_ORIGIN_ORIGINAL_COLUMNS = ["origin_id", "ordinal", "event_stream_id", "event_id", "source_sequence",
  "event_type", "role", "turn_id", "content_id", "content_sha256", "projection_sha256", "recorded_at", "source_retention_ceiling",
  "retained_by_ledger", "presented_in_context"] as const;
export const NATIVE_STRUCTURED_ORIGIN_REVISION_COLUMNS = ["origin_id", "ordinal", "ledger_id", "storage_revision", "predecessor_revision",
  "predecessor_hash", "body_ref", "body_hash", "created_at", "expires_at"] as const;
export type NativeStructuredMemoryOriginHeader = {
  origin_id: string; schema_version: 1; recipe_version: typeof NATIVE_STRUCTURED_ORIGIN_RECIPE;
  actor_user_id: string; owner_user_id: string; organization_id: string | null; project_access_id: string | null;
  project_id: string; document_id: string; scope_key: string; turn_id: string;
  user_event_id: string; user_content_id: string; user_source_sequence: number; user_sha256: string;
  answer_event_id: string; answer_content_id: string; answer_source_sequence: number; answer_sha256: string; answer_expires_at: string;
  enrollment_id: string; enrollment_revision: number; permission_epoch: string; policy_version: string; enrolled_at: string;
  enrollment_expires_at: string; retention_days: number; source_head: number; ledger_id: string; ledger_storage_revision: number;
  ledger_body_ref: string; ledger_body_sha256: string; consumed_context_sha256: string; source_list_sha256: string; source_count: number;
  ledger_history_sha256: string; ledger_revision_count: number; manifest_content_ref: string; manifest_sha256: string;
  manifest_expires_at: string; source_retention_ceiling: string; created_at: string;
  status: "active" | "withdrawn"; withdrawn_at: string | null; withdrawal_reason: NativeMemoryOriginWithdrawalReason | null;
};
export const NATIVE_STRUCTURED_ORIGIN_TOMBSTONE_COLUMNS = ["origin_id", "schema_version", "recipe_version", "actor_user_id", "scope_key", "turn_id",
  "user_event_id", "user_content_id", "answer_event_id", "answer_content_id", "manifest_content_ref", "status", "withdrawn_at", "withdrawal_reason"] as const;
type NativeStructuredOriginRetainedColumn = typeof NATIVE_STRUCTURED_ORIGIN_TOMBSTONE_COLUMNS[number];
export type NativeStructuredOriginTombstone = Pick<NativeStructuredMemoryOriginHeader,
  Exclude<NativeStructuredOriginRetainedColumn, "status" | "withdrawn_at" | "withdrawal_reason">>
  & {status: "minimized"; withdrawn_at: string; withdrawal_reason: NativeMemoryOriginWithdrawalReason}
  & {[Column in Exclude<keyof NativeStructuredMemoryOriginHeader, NativeStructuredOriginRetainedColumn>]: null};
export type NativeStructuredMemoryOriginOriginal = {
  origin_id: string; ordinal: number; event_stream_id: string; event_id: string; source_sequence: number;
  event_type: "ChatMessageSent" | "AssistantReasoned"; role: "user" | "assistant"; turn_id: string; content_id: string;
  content_sha256: string; projection_sha256: string; recorded_at: string; source_retention_ceiling: string;
  retained_by_ledger: 0 | 1; presented_in_context: 0 | 1;
};
export type NativeStructuredMemoryOriginRevision = {
  origin_id: string; ordinal: number; ledger_id: string; storage_revision: number; predecessor_revision: number;
  predecessor_hash: string | null; body_ref: string; body_hash: string; created_at: string; expires_at: string;
};
export type NativeStructuredMemoryOriginManifest = {
  schemaVersion: 1; recipeVersion: typeof NATIVE_STRUCTURED_ORIGIN_RECIPE; contextJson: string;
  projectionOptions: {maxBytes: number; specifiedMaxBytes: boolean}; intervals: LegacyConversationOriginalInterval[];
  sourceHead: number; publicationValidUntil: string;
  originals: Pick<LegacyConversationOriginalReceipt["originals"][number], "eventId" | "sequence" | "turnId" | "role" | "contentRef" | "contentHash">[];
};
const structuredOriginFreeze = <T>(value: T): T => {
  if (value && typeof value === "object") { for (const child of Object.values(value)) structuredOriginFreeze(child); Object.freeze(value); }
  return value;
};
const structuredOriginSafeId = (value: unknown): value is string => id(value) && value.isWellFormed();
const structuredOriginTimestamp = (value: unknown): value is string => nativeMemoryTimestamp(value) !== null;

/** A permanent negative record, never a source frame, access grant or proof that
 * physical cleanup occurred. The lifecycle must separately prove zero derived
 * residue and no holds using the captured full pre-minimization scope. */
export function validateNativeStructuredOriginTombstone(rowInput: unknown): NativeStructuredOriginTombstone | null {
  try {
    const row = structuredClone(rowInput) as NativeStructuredOriginTombstone;
    if (!row || !exactKeys(row, NATIVE_STRUCTURED_ORIGIN_HEADER_COLUMNS) || row.schema_version !== 1
      || row.recipe_version !== NATIVE_STRUCTURED_ORIGIN_RECIPE || row.status !== "minimized"
      || NATIVE_STRUCTURED_ORIGIN_HEADER_COLUMNS.some(column => !NATIVE_STRUCTURED_ORIGIN_TOMBSTONE_COLUMNS.some(retained => retained === column) && row[column] !== null)
      || ![row.origin_id, row.actor_user_id, row.turn_id, row.user_event_id, row.user_content_id,
        row.answer_event_id, row.answer_content_id, row.manifest_content_ref].every(structuredOriginSafeId)
      || row.user_event_id === row.answer_event_id || new Set([row.user_content_id, row.answer_content_id, row.manifest_content_ref]).size !== 3
      || typeof row.scope_key !== "string" || !row.scope_key.isWellFormed() || bytes(row.scope_key).length > 1024
      || !structuredOriginTimestamp(row.withdrawn_at) || !reasons.has(row.withdrawal_reason)) return null;
    const scope: unknown = JSON.parse(row.scope_key);
    if (!Array.isArray(scope) || scope.length !== 4 || !scope.every(value => typeof value === "string")
      || !scope.slice(2).every(structuredOriginSafeId)
      || !(scope[0] === "" && scope[1] === "" || structuredOriginSafeId(scope[0]) && structuredOriginSafeId(scope[1]))
      || row.scope_key !== JSON.stringify(scope)) return null;
    return structuredOriginFreeze(row);
  } catch { return null; }
}

/** Structural SQL counterpart to the minimal row validator. Fixed aliases only;
 * pair it with the exact schema guard and a separate residue/hold proof. */
export function nativeStructuredOriginMinimizedCondition(alias: "origin" | "tombstone" = "origin"):
  {condition: string; bindings: (string | number | null)[]} {
  if (alias !== "origin" && alias !== "tombstone") return invalid();
  const scope = `${alias}.scope_key`;
  // TEXT length/substr can stop at NUL. Walk the original UTF-8 bytes instead,
  // counting at most 240 UTF-16 units, including NUL and supplementary scalars.
  // Accept only an exact byte-end after validated, positive-width steps.
  const safeId = (value: string) => {
    const blob = `CAST(${value} AS BLOB)`;
    const widthAt = (position: string) => {
      const lead = `hex(substr(${blob},${position},1))`;
      return `(CASE WHEN ${lead} BETWEEN '00' AND '7F' THEN 1 WHEN ${lead} BETWEEN 'C2' AND 'DF' THEN 2
        WHEN ${lead} BETWEEN 'E0' AND 'EF' THEN 3 WHEN ${lead} BETWEEN 'F0' AND 'F4' THEN 4 ELSE 0 END)`;
    };
    const scalar = `substr(${blob},position,width)`;
    const code = `(CASE WHEN ${scalar}=X'00' THEN 0 ELSE unicode(CAST(${scalar} AS TEXT)) END)`;
    return `(CASE WHEN typeof(${value})='text' AND length(${blob}) BETWEEN 1 AND 960
      THEN (WITH RECURSIVE id_positions(position,units,width) AS(SELECT 1,0,${widthAt("1")} UNION ALL
        SELECT position+width,units+CASE WHEN ${code}>65535 THEN 2 ELSE 1 END,${widthAt("position+width")}
        FROM id_positions WHERE position<=length(${blob}) AND units<240 AND width BETWEEN 1 AND 4
          AND length(${scalar})=width AND ${code} BETWEEN 0 AND 1114111 AND ${code} NOT BETWEEN 55296 AND 57343
          AND CAST(char(${code}) AS BLOB) IS ${scalar})
        SELECT EXISTS(SELECT 1 FROM id_positions WHERE position=length(${blob})+1 AND units BETWEEN 1 AND 240)) ELSE 0 END)`;
  };
  const scopeValid = `(CASE WHEN typeof(${scope})='text' AND length(CAST(${scope} AS BLOB))<=1024 AND json_valid(${scope})
    THEN CASE WHEN json_type(${scope})='array' AND json_array_length(${scope})=4
      AND json_type(${scope},'$[0]')='text' AND json_type(${scope},'$[1]')='text'
      AND json_type(${scope},'$[2]')='text' AND json_type(${scope},'$[3]')='text'
      AND ((json_extract(${scope},'$[0]')='' AND json_extract(${scope},'$[1]')='')
        OR (${safeId(`json_extract(${scope},'$[0]')`)} AND ${safeId(`json_extract(${scope},'$[1]')`)}))
      AND ${safeId(`json_extract(${scope},'$[2]')`)} AND ${safeId(`json_extract(${scope},'$[3]')`)}
      THEN ${scope} IS json_array(json_extract(${scope},'$[0]'),json_extract(${scope},'$[1]'),
        json_extract(${scope},'$[2]'),json_extract(${scope},'$[3]')) ELSE 0 END ELSE 0 END)`;
  return {condition: `(${alias}.status='minimized' AND ${alias}.schema_version=1 AND ${alias}.recipe_version='${NATIVE_STRUCTURED_ORIGIN_RECIPE}'
    AND ${NATIVE_STRUCTURED_ORIGIN_HEADER_COLUMNS.filter(column => !NATIVE_STRUCTURED_ORIGIN_TOMBSTONE_COLUMNS.some(retained => retained === column)).map(column => `${alias}.${column} IS NULL`).join(" AND ")}
    AND ${["origin_id", "actor_user_id", "turn_id", "user_event_id", "answer_event_id", "user_content_id", "answer_content_id", "manifest_content_ref"].map(column => safeId(`${alias}.${column}`)).join(" AND ")}
    AND ${alias}.user_event_id<>${alias}.answer_event_id AND ${alias}.user_content_id<>${alias}.answer_content_id
    AND ${alias}.manifest_content_ref<>${alias}.user_content_id AND ${alias}.manifest_content_ref<>${alias}.answer_content_id
    AND ${scopeValid} AND typeof(${alias}.withdrawn_at)='text' AND length(${alias}.withdrawn_at)=24
    AND strftime('%Y-%m-%dT%H:%M:%fZ',julianday(${alias}.withdrawn_at)) IS ${alias}.withdrawn_at
    AND ${alias}.withdrawal_reason IN('source-unavailable','source-changed','source-expired','enrollment-changed','access-withdrawn','erased','manual'))`, bindings: []};
}

/** Exact full original projection, not the v1 512-byte role excerpt. This is
 * immutable evidence data only; the genuine native frame supplies authority. */
export function nativeStructuredOriginalProjection(original: LegacyConversationOriginalReceipt["originals"][number]) {
  const value = structuredClone(original);
  const keys = ["eventId", "sequence", "turnId", "role", "actor", "correlationId", "causationId", "contentRef", "text", "contentHash",
    "occurredAt", "recordedAt", "expiresAt"];
  if (!value || !exactKeys(value, keys) || ![value.eventId, value.turnId, value.actor, value.correlationId, value.causationId, value.contentRef].every(structuredOriginSafeId)
    || !positive(value.sequence) || value.role !== "user" && value.role !== "assistant" || !digest(value.contentHash)
    || typeof value.text !== "string" || !value.text.trim() || !value.text.isWellFormed() || bytes(value.text).length > 16384
    || ![value.occurredAt, value.recordedAt, value.expiresAt].every(structuredOriginTimestamp)
    || value.occurredAt !== value.recordedAt || Date.parse(value.recordedAt) >= Date.parse(value.expiresAt)) return invalid();
  return value;
}

/** Strict metadata shape and complete ordered memberships. These checks do not
 * establish current native source, ledger, enrollment or publication authority. */
export function validateNativeStructuredOriginRows(headerInput: unknown, originalsInput: unknown, revisionsInput: unknown):
  {header: NativeStructuredMemoryOriginHeader; originals: NativeStructuredMemoryOriginOriginal[]; ledgerRevisions: NativeStructuredMemoryOriginRevision[]} | null {
  try {
    if (!Array.isArray(originalsInput) || originalsInput.length < 2 || originalsInput.length > 128
      || !Array.isArray(revisionsInput) || revisionsInput.length < 1 || revisionsInput.length > 64) return null;
    const header = structuredClone(headerInput) as NativeStructuredMemoryOriginHeader;
    const originals = structuredClone(originalsInput) as NativeStructuredMemoryOriginOriginal[];
    const ledgerRevisions = structuredClone(revisionsInput) as NativeStructuredMemoryOriginRevision[];
    if (!header || !exactKeys(header, NATIVE_STRUCTURED_ORIGIN_HEADER_COLUMNS) || header.schema_version !== 1
      || header.recipe_version !== NATIVE_STRUCTURED_ORIGIN_RECIPE || header.source_count !== originals.length || originals.length % 2 !== 0
      || header.ledger_revision_count !== ledgerRevisions.length || header.ledger_storage_revision !== ledgerRevisions.length
      || ![header.origin_id, header.actor_user_id, header.owner_user_id, header.project_id, header.document_id, header.turn_id,
        header.user_event_id, header.user_content_id, header.answer_event_id, header.answer_content_id, header.enrollment_id,
        header.permission_epoch, header.policy_version, header.ledger_id, header.ledger_body_ref, header.manifest_content_ref].every(structuredOriginSafeId)
      || ![header.ledger_id, header.user_sha256, header.answer_sha256, header.ledger_body_sha256, header.consumed_context_sha256,
        header.source_list_sha256, header.ledger_history_sha256, header.manifest_sha256].every(digest)
      || (header.organization_id === null) !== (header.project_access_id === null)
      || header.organization_id !== null && (!structuredOriginSafeId(header.organization_id) || !structuredOriginSafeId(header.project_access_id))
      || header.organization_id === null && header.owner_user_id !== header.actor_user_id
      || header.scope_key !== JSON.stringify([header.organization_id ?? "", header.project_access_id ?? "", header.project_id, header.document_id])
      || !positive(header.enrollment_revision) || !positive(header.source_head) || header.source_head > Number.MAX_SAFE_INTEGER - 2
      || header.user_source_sequence !== header.source_head + 1 || header.answer_source_sequence !== header.source_head + 2
      || header.user_event_id === header.answer_event_id
      || new Set([header.user_content_id, header.answer_content_id, header.manifest_content_ref, header.ledger_body_ref]).size !== 4
      || !Number.isSafeInteger(header.retention_days) || header.retention_days < 1 || header.retention_days > 365) return null;
    if (![header.enrolled_at, header.enrollment_expires_at, header.answer_expires_at, header.manifest_expires_at,
      header.source_retention_ceiling, header.created_at].every(structuredOriginTimestamp)) return null;
    const created = Date.parse(header.created_at), ceiling = Date.parse(header.source_retention_ceiling);
    if (Date.parse(header.enrolled_at) > created || ceiling > Date.parse(header.enrollment_expires_at)
      || created >= Date.parse(header.answer_expires_at) || Date.parse(header.answer_expires_at) > ceiling
      || created >= Date.parse(header.manifest_expires_at) || Date.parse(header.manifest_expires_at) > ceiling
      || (header.status === "active" ? header.withdrawn_at !== null || header.withdrawal_reason !== null
        : header.status !== "withdrawn" || !structuredOriginTimestamp(header.withdrawn_at)
          || Date.parse(header.withdrawn_at) < created || !reasons.has(header.withdrawal_reason!))) return null;
    const events = new Set<string>(), contents = new Set<string>(), roles = new Set<string>(), pairs = new Map<string, NativeStructuredMemoryOriginOriginal[]>();
    let sequence = 0;
    for (const [ordinal, row] of originals.entries()) {
      if (!row || !exactKeys(row, NATIVE_STRUCTURED_ORIGIN_ORIGINAL_COLUMNS) || row.origin_id !== header.origin_id || row.ordinal !== ordinal
        || row.event_stream_id !== "creative:" + header.owner_user_id || ![row.event_id, row.turn_id, row.content_id].every(structuredOriginSafeId)
        || events.has(row.event_id) || contents.has(row.content_id) || !positive(row.source_sequence) || row.source_sequence <= sequence
        || row.source_sequence > header.source_head || row.event_id === header.user_event_id || row.event_id === header.answer_event_id
        || [header.user_content_id, header.answer_content_id, header.manifest_content_ref].includes(row.content_id)
        || row.role !== "user" && row.role !== "assistant" || row.event_type !== (row.role === "user" ? "ChatMessageSent" : "AssistantReasoned")
        || !digest(row.content_sha256) || !digest(row.projection_sha256) || !structuredOriginTimestamp(row.recorded_at)
        || !structuredOriginTimestamp(row.source_retention_ceiling) || Date.parse(row.recorded_at) > created
        || Date.parse(row.source_retention_ceiling) < ceiling || Date.parse(row.recorded_at) >= Date.parse(row.source_retention_ceiling)
        || row.retained_by_ledger !== 0 && row.retained_by_ledger !== 1 || row.presented_in_context !== 0 && row.presented_in_context !== 1) return null;
      const roleKey = JSON.stringify([row.turn_id, row.role]); if (roles.has(roleKey)) return null;
      roles.add(roleKey); events.add(row.event_id); contents.add(row.content_id); sequence = row.source_sequence;
      const pair = pairs.get(row.turn_id) ?? []; pair.push(row); pairs.set(row.turn_id, pair);
    }
    if (!originals.some(row => row.retained_by_ledger === 1) || [...pairs.values()].some(pair => pair.length !== 2
      || pair[0].role !== "user" || pair[1].role !== "assistant")) return null;
    let predecessor: NativeStructuredMemoryOriginRevision | undefined;
    for (const [ordinal, row] of ledgerRevisions.entries()) {
      if (!row || !exactKeys(row, NATIVE_STRUCTURED_ORIGIN_REVISION_COLUMNS) || row.origin_id !== header.origin_id || row.ordinal !== ordinal
        || row.ledger_id !== header.ledger_id || row.storage_revision !== ordinal + 1 || row.predecessor_revision !== ordinal
        || row.predecessor_hash !== (predecessor?.body_hash ?? null) || !structuredOriginSafeId(row.body_ref) || contents.has(row.body_ref)
        || !digest(row.body_hash) || !structuredOriginTimestamp(row.created_at) || !structuredOriginTimestamp(row.expires_at)
        || Date.parse(row.created_at) > created || Date.parse(row.created_at) >= Date.parse(row.expires_at)
        || Date.parse(row.expires_at) < ceiling || predecessor && Date.parse(row.created_at) < Date.parse(predecessor.created_at)
        || [header.user_content_id, header.answer_content_id, header.manifest_content_ref].includes(row.body_ref)) return null;
      contents.add(row.body_ref); predecessor = row;
    }
    if (predecessor?.body_ref !== header.ledger_body_ref || predecessor.body_hash !== header.ledger_body_sha256) return null;
    nativeMemoryCanonical(header); nativeMemoryCanonical(originals); nativeMemoryCanonical(ledgerRevisions);
    return {header, originals, ledgerRevisions};
  } catch { return null; }
}

/** Closed bounded storage envelope only. The saved reader must additionally
 * reconstruct contextJson from genuine current native evidence; parsing is not
 * a context proof or certification of its semantic declarations. */
export function validateNativeStructuredOriginManifest(text: unknown): NativeStructuredMemoryOriginManifest | null {
  try {
    if (typeof text !== "string" || !text.isWellFormed() || bytes(text).length > 65536) return null;
    const value = JSON.parse(text) as NativeStructuredMemoryOriginManifest;
    if (!value || !exactKeys(value, ["schemaVersion", "recipeVersion", "contextJson", "projectionOptions", "intervals", "sourceHead", "publicationValidUntil", "originals"])
      || value.schemaVersion !== 1 || value.recipeVersion !== NATIVE_STRUCTURED_ORIGIN_RECIPE
      || typeof value.contextJson !== "string" || !value.contextJson.isWellFormed() || bytes(value.contextJson).length > 16384
      || !value.projectionOptions || !exactKeys(value.projectionOptions, ["maxBytes", "specifiedMaxBytes"])
      || !positive(value.projectionOptions.maxBytes) || value.projectionOptions.maxBytes > 16384 || typeof value.projectionOptions.specifiedMaxBytes !== "boolean"
      || !positive(value.sourceHead) || !structuredOriginTimestamp(value.publicationValidUntil)
      || !Array.isArray(value.intervals) || value.intervals.length < 1 || value.intervals.length > 32
      || !Array.isArray(value.originals) || value.originals.length < 2 || value.originals.length > 128 || value.originals.length % 2 !== 0) return null;
    if (value.intervals.some(interval => !interval || !exactKeys(interval, ["afterSequence", "throughSequence"])
      || !Number.isSafeInteger(interval.afterSequence) || interval.afterSequence < 0 || !positive(interval.throughSequence)
      || interval.throughSequence <= interval.afterSequence || interval.throughSequence > value.sourceHead)) return null;
    let sequence = 0; const events = new Set<string>(), contents = new Set<string>(), roles = new Set<string>();
    for (const row of value.originals) {
      if (!row || !exactKeys(row, ["eventId", "sequence", "turnId", "role", "contentRef", "contentHash"])
        || ![row.eventId, row.turnId, row.contentRef].every(structuredOriginSafeId) || !digest(row.contentHash)
        || !positive(row.sequence) || row.sequence <= sequence || row.sequence > value.sourceHead
        || row.role !== "user" && row.role !== "assistant" || events.has(row.eventId) || contents.has(row.contentRef)
        || roles.has(JSON.stringify([row.turnId, row.role]))
        || !value.intervals.some(interval => row.sequence > interval.afterSequence && row.sequence <= interval.throughSequence)) return null;
      sequence = row.sequence; events.add(row.eventId); contents.add(row.contentRef); roles.add(JSON.stringify([row.turnId, row.role]));
    }
    return nativeMemoryCanonical(value) === text ? value : null;
  } catch { return null; }
}



/** Accompany this predicate with the exact optional-schema guard in the same
 * ordinary cleanup operation. Marked/registered answers require dedicated
 * withdrawal and hold-aware cleanup, even after enrollment or ledger loss.
 * An exact integer-v1 marker retains the existing v1 cleanup path unless a
 * contradictory structured-origin row independently claims that content. */
export function nativeStructuredMemoryOriginAnswerExclusion(present: boolean,
  alias: "private_content" | "content" = "private_content"): NativeMemoryOriginQuery {
  if (typeof present !== "boolean" || alias !== "private_content" && alias !== "content") return invalid();
  return {sql: `NOT EXISTS(SELECT 1 FROM events marked WHERE marked.type='AssistantReasoned'
    AND json_type(marked.payload,'$.memory_origin_version') IS NOT NULL
    AND NOT (json_type(marked.payload,'$.memory_origin_version')='integer' AND json_extract(marked.payload,'$.memory_origin_version')=1)
    AND json_extract(marked.payload,'$.content_ref')=${alias}.content_id)${present
      ? ` AND NOT EXISTS(SELECT 1 FROM memory_structured_answer_origins origin WHERE origin.answer_content_id=${alias}.content_id)` : ""}`,
    bindings: []};
}

export type NativeStructuredMemoryOriginAnswer = NativeMemoryOriginAnswer & {manifestContentRef: string; manifestExpiresAt: string};
export type NativeStructuredMemoryOriginPublication = Readonly<{
  header: Readonly<NativeStructuredMemoryOriginHeader>;
  originals: readonly Readonly<NativeStructuredMemoryOriginOriginal>[];
  ledgerRevisions: readonly Readonly<NativeStructuredMemoryOriginRevision>[];
  manifest: Readonly<{contentRef: string; text: string; expiresAt: string; kind: typeof NATIVE_STRUCTURED_ORIGIN_KIND}>;
  validUntil: string; statements: readonly NativeMemoryOriginQuery[];
}>;
type StructuredOriginPublicationFrame = {env: WorkerEnv; db: WorkerEnv["DB"]; wrapper: PreparedNativeStructuredConversationContext;
  input: NativeStructuredMemoryOriginAnswer; inputKey: string; validUntil: string};
const structuredOriginPublications = new WeakMap<NativeStructuredMemoryOriginPublication, StructuredOriginPublicationFrame>();
/** Host binding only, never an alternative to strict native prewrite and genuine
 * own-send final assertions. The enclosing caller must enforce both. */
export function nativeStructuredMemoryOriginPublicationCurrent(env: WorkerEnv,
  wrapper: PreparedNativeStructuredConversationContext, publication: NativeStructuredMemoryOriginPublication): boolean {
  try {
    const frame = structuredOriginPublications.get(publication);
    return !!frame && frame.env === env && frame.db === env.DB && frame.wrapper === wrapper
      && Date.now() < Date.parse(frame.validUntil) && nativeMemoryCanonical(frame.input) === frame.inputKey;
  } catch { return false; }
}
/** Non-authoritative lifetime hint for preparing exact private body expiries.
 * The publisher independently obtains and rechecks the genuine context again. */
export async function nativeStructuredMemoryOriginCapture(env: WorkerEnv, wrapper: PreparedNativeStructuredConversationContext):
  Promise<Readonly<{sourceRetentionCeiling: string; validUntil: string; sourceHead: number}> | null> {
  try {
    const db = env.DB, context = await import("./memory-live-context.ts");
    const evidence = await context.nativeStructuredConversationContextEvidence(env, wrapper);
    if (!evidence || env.DB !== db) return null;
    return Object.freeze({sourceRetentionCeiling: evidence.sourceEvidence.sourceRetentionCeiling,
      validUntil: evidence.sourceEvidence.validUntil, sourceHead: evidence.sourceEvidence.sourceHead});
  } catch { return null; }
}

/** Dedicated v2 metadata/manifest preparation. Only an exact privately issued
 * context wrapper can reach this path; supplied evidence/options are never an
 * authority argument. Private bodies, one ordered two-event staging INSERT,
 * these origin rows, and the separate genuine own-send assertions must share
 * ONE atomic batch. Returned SQL alone grants no publication authority. */
export async function prepareNativeStructuredMemoryOrigin(env: WorkerEnv, wrapper: PreparedNativeStructuredConversationContext,
  answerInput: NativeStructuredMemoryOriginAnswer): Promise<NativeStructuredMemoryOriginPublication | null> {
  try {
    const db = env.DB, answer = structuredClone(answerInput), inputKey = nativeMemoryCanonical(answer);
    const context = await import("./memory-live-context.ts");
    if (env.DB !== db || nativeMemoryCanonical(answerInput) !== inputKey) return null;
    const evidence = await context.nativeStructuredConversationContextEvidence(env, wrapper);
    if (!evidence || env.DB !== db || nativeMemoryCanonical(answerInput) !== inputKey) return null;
    const source = evidence.source, native = evidence.sourceEvidence, e = native.enrollment;
    const fresh = () => env.DB === db && nativeMemoryCanonical(answerInput) === inputKey
      && Date.now() < Date.parse(native.validUntil);
    const recheck = async () => fresh() && await context.nativeStructuredConversationContextEvidence(env, wrapper) === evidence && fresh();
    if (!fresh() || ![answer.originId, answer.turnId, answer.userEventId, answer.userContentId, answer.answerEventId,
      answer.answerContentId, answer.manifestContentRef].every(structuredOriginSafeId)
      || new Set([answer.userContentId, answer.answerContentId, answer.manifestContentRef]).size !== 3
      || answer.userEventId === answer.answerEventId || answer.userSourceSequence !== source.sourceHead + 1
      || answer.answerSourceSequence !== source.sourceHead + 2
      || ![answer.createdAt, answer.answerExpiresAt, answer.manifestExpiresAt].every(structuredOriginTimestamp)) return null;
    const created = Date.parse(answer.createdAt), ceiling = Date.parse(native.sourceRetentionCeiling);
    if (created > Date.now() || created < Date.parse(e.enrolled_at) || created >= Date.parse(native.validUntil)
      || created >= Date.parse(answer.answerExpiresAt) || Date.parse(answer.answerExpiresAt) > ceiling
      || created >= Date.parse(answer.manifestExpiresAt) || Date.parse(answer.manifestExpiresAt) > ceiling
      || source.read.status !== "active" || source.originals.length < 2 || source.originals.length > 128
      || native.ledgerRevisions.length < 1 || native.ledgerRevisions.length > 64) return null;
    const schema = await nativeStructuredOriginSchema(env);
    if (!schema.present || !await recheck()) return null;
    const manifestValue: NativeStructuredMemoryOriginManifest = {schemaVersion: 1, recipeVersion: NATIVE_STRUCTURED_ORIGIN_RECIPE,
      contextJson: evidence.contextJson, projectionOptions: {...evidence.projectionOptions},
      intervals: native.intervals.map(interval => ({...interval})), sourceHead: source.sourceHead,
      publicationValidUntil: native.validUntil,
      originals: source.originals.map(original => ({eventId: original.eventId, sequence: original.sequence, turnId: original.turnId,
        role: original.role, contentRef: original.contentRef, contentHash: original.contentHash}))};
    const manifestText = nativeMemoryCanonical(manifestValue);
    if (!validateNativeStructuredOriginManifest(manifestText)) return null;
    const retained = new Set(source.read.ledger.originals.map(original => original.eventId));
    const presented = new Set(evidence.context.recentOriginals.map(original => original.eventId));
    const originals: NativeStructuredMemoryOriginOriginal[] = [];
    for (const [ordinal, original] of source.originals.entries()) {
      const projection = nativeStructuredOriginalProjection(original), projectionHash = await nativeMemoryFingerprint(projection);
      if (!await recheck()) return null;
      const sourceCeiling = new Date(Math.min(Date.parse(original.expiresAt), Date.parse(e.expires_at),
        Date.parse(original.recordedAt) + e.retention_days * 86400000)).toISOString();
      originals.push({origin_id: answer.originId, ordinal, event_stream_id: source.scope.streamId, event_id: original.eventId,
        source_sequence: original.sequence, event_type: original.role === "user" ? "ChatMessageSent" : "AssistantReasoned",
        role: original.role, turn_id: original.turnId, content_id: original.contentRef, content_sha256: original.contentHash,
        projection_sha256: projectionHash, recorded_at: original.recordedAt, source_retention_ceiling: sourceCeiling,
        retained_by_ledger: retained.has(original.eventId) ? 1 : 0, presented_in_context: presented.has(original.eventId) ? 1 : 0});
    }
    const ledgerRevisions: NativeStructuredMemoryOriginRevision[] = native.ledgerRevisions.map((entry, ordinal) => {
      // The store has already validated this complete native row bag; its public
      // evidence type deliberately retains unknown-valued database columns.
      const revision = entry.revision as Record<string, unknown>;
      return {origin_id: answer.originId, ordinal, ledger_id: String(revision.ledger_id), storage_revision: Number(revision.revision),
        predecessor_revision: Number(revision.predecessor_revision), predecessor_hash: revision.predecessor_hash as string | null,
        body_ref: String(revision.body_ref), body_hash: String(revision.body_hash), created_at: String(revision.created_at), expires_at: String(revision.expires_at)};
    });
    const fingerprints = await Promise.all([nativeMemoryAnswerFingerprint(answer.user), nativeMemoryAnswerFingerprint(answer.answer),
      nativeMemoryAnswerFingerprint(evidence.contextJson), nativeMemoryFingerprint(originals), nativeMemoryFingerprint(ledgerRevisions),
      nativeMemoryAnswerFingerprint(manifestText)]);
    if (!await recheck()) return null;
    const header: NativeStructuredMemoryOriginHeader = {origin_id: answer.originId, schema_version: 1, recipe_version: NATIVE_STRUCTURED_ORIGIN_RECIPE,
      actor_user_id: e.actor_user_id, owner_user_id: e.owner_user_id, organization_id: e.organization_id, project_access_id: e.project_access_id,
      project_id: e.project_id, document_id: e.document_id, scope_key: JSON.stringify([e.organization_id ?? "", e.project_access_id ?? "", e.project_id, e.document_id]),
      turn_id: answer.turnId, user_event_id: answer.userEventId, user_content_id: answer.userContentId, user_source_sequence: answer.userSourceSequence,
      user_sha256: fingerprints[0], answer_event_id: answer.answerEventId, answer_content_id: answer.answerContentId,
      answer_source_sequence: answer.answerSourceSequence, answer_sha256: fingerprints[1], answer_expires_at: answer.answerExpiresAt,
      enrollment_id: e.enrollment_id, enrollment_revision: e.revision, permission_epoch: e.permission_epoch, policy_version: e.policy_version,
      enrolled_at: e.enrolled_at, enrollment_expires_at: e.expires_at, retention_days: e.retention_days, source_head: source.sourceHead,
      ledger_id: source.read.ledgerId, ledger_storage_revision: source.read.revision, ledger_body_ref: String(native.head.current_body_ref),
      ledger_body_sha256: String(native.head.current_body_hash), consumed_context_sha256: fingerprints[2], source_list_sha256: fingerprints[3],
      source_count: originals.length, ledger_history_sha256: fingerprints[4], ledger_revision_count: ledgerRevisions.length,
      manifest_content_ref: answer.manifestContentRef, manifest_sha256: fingerprints[5], manifest_expires_at: answer.manifestExpiresAt,
      source_retention_ceiling: native.sourceRetentionCeiling, created_at: answer.createdAt, status: "active", withdrawn_at: null, withdrawal_reason: null};
    if (!validateNativeStructuredOriginRows(header, originals, ledgerRevisions)) return null;
    const headerJson = nativeMemoryCanonical(header), originalsJson = nativeMemoryCanonical(originals), revisionsJson = nativeMemoryCanonical(ledgerRevisions);
    // Both protocol tables must be known at publication; v1 remains optional but
    // its exact absence is captured and cannot survive schema arrival.
    const v1SchemaSelect = "SELECT type,name,CASE WHEN length(CAST(sql AS BLOB))<=16384 THEN sql ELSE NULL END AS sql FROM sqlite_schema WHERE name='memory_native_answer_origins' ORDER BY name LIMIT 2";
    const v1Rows = structuredClone(await db.prepare(v1SchemaSelect).all<Record<string, unknown>>());
    if (!await recheck() || v1Rows.success !== true || (v1Rows as typeof v1Rows & {error?: unknown}).error !== undefined || !Array.isArray(v1Rows.results) || v1Rows.results.length > 1
      || v1Rows.results.some(row => row.type !== "table" || typeof row.sql !== "string")) return null;
    const v1SchemaJson = JSON.stringify(v1Rows.results.map(row => ({type: row.type, name: row.name, sql: row.sql})));
    const v1Schema = `(SELECT json_group_array(json_object('type',type,'name',name,'sql',sql)) FROM(${v1SchemaSelect})) IS ?`;
    const v1Conflict = v1Rows.results.length ? `NOT EXISTS(SELECT 1 FROM memory_native_answer_origins other WHERE
      other.user_event_id IN(?,?) OR other.answer_event_id IN(?,?) OR other.user_content_id IN(?,?,?) OR other.answer_content_id IN(?,?,?))` : "1";
    const conflicts: (string | number | null)[] = v1Rows.results.length ? [answer.userEventId, answer.answerEventId, answer.userEventId, answer.answerEventId,
      answer.userContentId, answer.answerContentId, answer.manifestContentRef, answer.userContentId, answer.answerContentId, answer.manifestContentRef] : [];
    const assert = (condition: string, bindings: (string | number | null)[]): NativeMemoryOriginQuery => ({
      sql: `SELECT CASE WHEN (${schema.guard.condition}) AND (${v1Schema}) AND (${v1Conflict}) AND ${nowSql}<? AND (${condition})
        THEN 1 ELSE json('memory_structured_origin_publication_failed') END AS verified`,
      bindings: [...schema.guard.bindings, v1SchemaJson, ...conflicts, native.validUntil, ...bindings]});
    const insert = (table: string, columns: readonly string[], json: string, array: boolean): NativeMemoryOriginQuery => ({
      sql: `INSERT INTO ${table}(${columns.join(",")}) SELECT ${columns.map(column => `json_extract(value,'$.${column}')`).join(",")}
        FROM ${array ? "json_each(?)" : "(SELECT ? AS value)"}`, bindings: [json]});
    const exactRows = (table: string, columns: readonly string[], rowsJson: string) => ({
      sql: `(SELECT COUNT(*) FROM ${table} WHERE origin_id=?)=json_array_length(?)
        AND NOT EXISTS(SELECT 1 FROM json_each(?) expected WHERE NOT EXISTS(SELECT 1 FROM ${table} actual WHERE ${columnMatch("actual", "expected.value", columns)}))`,
      bindings: [answer.originId, rowsJson, rowsJson] as (string | number | null)[]});
    const originalRows = exactRows("memory_structured_answer_originals", NATIVE_STRUCTURED_ORIGIN_ORIGINAL_COLUMNS, originalsJson);
    const revisionRows = exactRows("memory_structured_answer_ledger_revisions", NATIVE_STRUCTURED_ORIGIN_REVISION_COLUMNS, revisionsJson);
    const final = assert(`EXISTS(SELECT 1 FROM (SELECT ? AS value) expected JOIN memory_structured_answer_origins origin
      ON ${columnMatch("origin", "expected.value", NATIVE_STRUCTURED_ORIGIN_HEADER_COLUMNS)})
      AND (${originalRows.sql}) AND (${revisionRows.sql})
      AND EXISTS(SELECT 1 FROM private_content body WHERE (body.content_id,body.owner_id,body.kind,body.content,body.created_at,body.redacted_at)
        IS (?,?,'chat-user',?,?,NULL) AND body.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      AND EXISTS(SELECT 1 FROM private_content body WHERE (body.content_id,body.owner_id,body.kind,body.content,body.created_at,body.expires_at,body.redacted_at)
        IS (?,?,'chat-assistant-memory',?,?,?,NULL))
      AND EXISTS(SELECT 1 FROM private_content body WHERE (body.content_id,body.owner_id,body.kind,body.content,body.created_at,body.expires_at,body.redacted_at)
        IS (?,?,'memory-structured-origin',?,?,?,NULL))
      AND EXISTS(SELECT 1 FROM events event WHERE event.event_id=? AND event.stream_id=? AND event.sequence=?
        AND event.type='AssistantReasoned' AND json_type(event.payload,'$.memory_origin_version')='integer'
        AND json_extract(event.payload,'$.memory_origin_version')=2 AND json_extract(event.payload,'$.content_ref')=?)
      AND NOT EXISTS(SELECT 1 FROM memory_structured_answer_origins other WHERE other.origin_id<>?
        AND (other.user_event_id IN(?,?) OR other.answer_event_id IN(?,?) OR other.user_content_id IN(?,?,?)
          OR other.answer_content_id IN(?,?,?) OR other.manifest_content_ref IN(?,?,?)))`,
      [headerJson, ...originalRows.bindings, ...revisionRows.bindings,
        answer.userContentId, e.actor_user_id, answer.user, answer.createdAt,
        answer.answerContentId, e.actor_user_id, answer.answer, answer.createdAt, answer.answerExpiresAt,
        answer.manifestContentRef, e.actor_user_id, manifestText, answer.createdAt, answer.manifestExpiresAt,
        answer.answerEventId, source.scope.streamId, answer.answerSourceSequence, answer.answerContentId, answer.originId,
        answer.userEventId, answer.answerEventId, answer.userEventId, answer.answerEventId,
        answer.userContentId, answer.answerContentId, answer.manifestContentRef, answer.userContentId, answer.answerContentId, answer.manifestContentRef,
        answer.userContentId, answer.answerContentId, answer.manifestContentRef]);
    const statements = [assert("NOT EXISTS(SELECT 1 FROM memory_structured_answer_origins WHERE origin_id=?)", [answer.originId]),
      insert("memory_structured_answer_origins", NATIVE_STRUCTURED_ORIGIN_HEADER_COLUMNS, headerJson, false),
      insert("memory_structured_answer_originals", NATIVE_STRUCTURED_ORIGIN_ORIGINAL_COLUMNS, originalsJson, true),
      insert("memory_structured_answer_ledger_revisions", NATIVE_STRUCTURED_ORIGIN_REVISION_COLUMNS, revisionsJson, true), final];
    const publication = structuredOriginFreeze<NativeStructuredMemoryOriginPublication>({header, originals, ledgerRevisions,
      manifest: {contentRef: answer.manifestContentRef, text: manifestText, expiresAt: answer.manifestExpiresAt, kind: NATIVE_STRUCTURED_ORIGIN_KIND},
      validUntil: native.validUntil, statements});
    if (!await recheck()) return null;
    structuredOriginPublications.set(publication, {env, db, wrapper, input: answerInput, inputKey, validUntil: native.validUntil});
    return publication;
  } catch { return null; }
}

// R6 structured-origin lifecycle (separate bounded native retirement).

type StructuredOriginLifecycleRow = Record<string, string | number | null>;
type StructuredOriginLifecycleEnv = import("./runtime.ts").WorkerEnv;
export type NativeStructuredOriginWithdrawalSelector = { originId: string } | { actorUserId: string; personalOnly?: true }
  | { organizationId: string } | { enrollmentId: string } | { enrollmentId: string; currentRevision: number }
  | { enrollmentId: string; currentRevision: number; unavailableDependencies: true }
  | { eventStreamId: string; eventId: string } | { contentId: string } | { ledgerBodyRef: string }
  | { ledgerId: string } | { ledgerId: string; currentStorageRevision: number };
const structuredOriginTable = "memory_structured_answer_origins";
const structuredOriginalTable = "memory_structured_answer_originals";
const structuredOriginRevisionTable = "memory_structured_answer_ledger_revisions";
const structuredOriginResourceColumns = ["project_access_id", "resource_kind", "resource_id", "organization_id", "project_id",
  "owner_user_id", "actor_user_id", "visibility", "source_event_id", "created_at"] as const;
const structuredOriginRetentionColumns = ["content_id", "organization_id", "project_access_id", "project_id", "actor_user_id",
  "classification", "policy_version", "assigned_expires_at", "created_at"] as const;
const structuredOriginBodyColumns = ["content_id", "owner_id", "kind", "created_at", "expires_at", "redacted_at", "empty"] as const;
function structuredOriginAssertion(condition: string, bindings: (string | number | null)[] = []): NativeMemoryOriginQuery {
  return { sql: `SELECT CASE WHEN (${condition}) THEN 1 ELSE json('memory_structured_origin_lifecycle_changed') END AS verified`, bindings };
}
function structuredOriginFreezeQueries(queries: NativeMemoryOriginQuery[]): void {
  for (const query of queries) { Object.freeze(query.bindings); Object.freeze(query); } Object.freeze(queries);
}
function structuredOriginRows(results: unknown, columns: readonly string[]): StructuredOriginLifecycleRow[] {
  const value = results as { success?: unknown; results?: unknown; error?: unknown };
  if (!structuredOriginEnvelope(value)) throw new Error("memory-structured-origin-lifecycle-unavailable");
  const rows = value.results as StructuredOriginLifecycleRow[];
  if (rows.some(row => !row || typeof row !== "object" || Array.isArray(row) || !exactKeys(row, columns) || Object.values(row).some(item => item !== null &&
    !(typeof item === "number" && Number.isSafeInteger(item)) && !(typeof item === "string" && item.length <= 1024))))
    throw new Error("memory-structured-origin-lifecycle-unavailable");
  return rows;
}
function structuredOriginExact(query: NativeMemoryOriginQuery, rows: readonly StructuredOriginLifecycleRow[], columns: readonly string[]): NativeMemoryOriginQuery {
  const names = columns.join(","), expected = columns.map(column => `json_extract(value,'$.${column}') AS ${column}`).join(",");
  return { sql: `WITH actual AS (${query.sql}),expected AS (SELECT ${expected} FROM json_each(?))
    SELECT CASE WHEN NOT EXISTS(SELECT ${names} FROM actual EXCEPT SELECT ${names} FROM expected)
      AND NOT EXISTS(SELECT ${names} FROM expected EXCEPT SELECT ${names} FROM actual)
      THEN 1 ELSE json('memory_structured_origin_lifecycle_changed') END AS verified`, bindings: [...query.bindings, JSON.stringify(rows)] };
}
function structuredOriginEnvelope(value: unknown): value is { success: true; results: unknown[]; meta?: unknown } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Object.hasOwn(row, "success") && row.success === true && row.error === undefined
    && Object.hasOwn(row, "results") && Array.isArray(row.results);
}
function structuredOriginAcknowledged(input: readonly unknown[], count: number, assertions: readonly number[], writes: readonly { index: number; changes: number }[]): boolean {
  try {
    if (!Array.isArray(input) || input.length !== count || !input.every(structuredOriginEnvelope)) return false;
    const results: readonly unknown[] = structuredClone(input);
    if (!Array.isArray(results) || results.length !== count || !results.every(structuredOriginEnvelope)) return false;
    return assertions.every(index => {
      const rows = results[index].results;
      return rows.length === 1 && !!rows[0] && typeof rows[0] === "object" && !Array.isArray(rows[0])
        && exactKeys(rows[0], ["verified"]) && (rows[0] as { verified: unknown }).verified === 1;
    }) && writes.every(write => {
      const result = results[write.index], meta = result.meta;
      return Object.hasOwn(result, "meta") && !!meta && typeof meta === "object" && !Array.isArray(meta)
        && Object.hasOwn(meta, "changes") && (meta as { changes?: unknown }).changes === write.changes;
    });
  } catch { return false; }
}
function structuredOriginSelection(selector: NativeStructuredOriginWithdrawalSelector, available: ReadonlySet<string>): { selection: NativeMemoryOriginQuery; revision: NativeMemoryOriginQuery; terminalGuard: NativeMemoryOriginQuery } | null {
  let sql: string, bindings: (string | number | null)[], revision: NativeMemoryOriginQuery = { sql: "1", bindings: [] }, terminalGuard: NativeMemoryOriginQuery = { sql: "1", bindings: [] };
  if (exactKeys(selector, ["originId"]) && "originId" in selector && id(selector.originId)) {
    sql = "origin.origin_id=?"; bindings = [selector.originId];
  } else if ((exactKeys(selector, ["actorUserId"]) || exactKeys(selector, ["actorUserId", "personalOnly"]) && "personalOnly" in selector && selector.personalOnly === true)
    && "actorUserId" in selector && id(selector.actorUserId)) {
    sql = "origin.actor_user_id=?" + ("personalOnly" in selector
      ? ` AND (origin.status='minimized' AND CASE WHEN (${structuredOriginTombstoneSql}) THEN json_extract(origin.scope_key,'$[0]')='' ELSE 0 END
        OR origin.status<>'minimized' AND origin.organization_id IS NULL)` : ""); bindings = [selector.actorUserId];
  } else if (exactKeys(selector, ["organizationId"]) && "organizationId" in selector && id(selector.organizationId)) {
    sql = `(origin.status='minimized' AND CASE WHEN (${structuredOriginTombstoneSql}) THEN json_extract(origin.scope_key,'$[0]')=? ELSE 0 END
      OR origin.status<>'minimized' AND origin.organization_id=?)`; bindings = [selector.organizationId, selector.organizationId];
  } else if ((exactKeys(selector, ["enrollmentId"]) || exactKeys(selector, ["enrollmentId", "currentRevision"])
    || exactKeys(selector, ["enrollmentId", "currentRevision", "unavailableDependencies"]) && "unavailableDependencies" in selector && selector.unavailableDependencies === true)
    && "enrollmentId" in selector && id(selector.enrollmentId)) {
    sql = "origin.enrollment_id=?"; bindings = [selector.enrollmentId];
    if ("currentRevision" in selector) {
      if (!positive(selector.currentRevision)) return null;
      revision = available.has("memory_live_enrollments")
        ? { sql: "EXISTS(SELECT 1 FROM memory_live_enrollments WHERE enrollment_id=? AND revision=?)", bindings: [selector.enrollmentId, selector.currentRevision] }
        : { sql: "0", bindings: [] };
    }
    if ("unavailableDependencies" in selector) sql += ` AND (${structuredOriginUnavailable(available)})`;
  } else if (exactKeys(selector, ["eventStreamId", "eventId"]) && "eventStreamId" in selector && "eventId" in selector && id(selector.eventStreamId) && id(selector.eventId)) {
    sql = `(('creative:'||origin.owner_user_id)=? AND (origin.user_event_id=? OR origin.answer_event_id=?)) OR EXISTS(SELECT 1 FROM ${structuredOriginalTable} dependency
      WHERE dependency.origin_id=origin.origin_id AND dependency.event_stream_id=? AND dependency.event_id=?)`;
    bindings = [selector.eventStreamId, selector.eventId, selector.eventId, selector.eventStreamId, selector.eventId];
    // Minimization intentionally discards stream ownership. A retained event ID
    // therefore denies an ambiguous request; it never becomes a cross-stream
    // positive selection. Exact origin/actor/scope/content selectors remain valid.
    terminalGuard = { sql: `NOT EXISTS(SELECT 1 FROM ${structuredOriginTable} origin WHERE origin.status='minimized'
      AND (origin.user_event_id=? OR origin.answer_event_id=?))`, bindings: [selector.eventId, selector.eventId] };
  } else if (exactKeys(selector, ["contentId"]) && "contentId" in selector && id(selector.contentId)) {
    sql = `origin.user_content_id=? OR origin.answer_content_id=? OR origin.manifest_content_ref=?
      OR EXISTS(SELECT 1 FROM ${structuredOriginalTable} dependency WHERE dependency.origin_id=origin.origin_id AND dependency.content_id=?)
      OR EXISTS(SELECT 1 FROM ${structuredOriginRevisionTable} dependency WHERE dependency.origin_id=origin.origin_id AND dependency.body_ref=?)`;
    bindings = Array(5).fill(selector.contentId);
  } else if (exactKeys(selector, ["ledgerBodyRef"]) && "ledgerBodyRef" in selector && id(selector.ledgerBodyRef)) {
    sql = `origin.ledger_body_ref=? OR EXISTS(SELECT 1 FROM ${structuredOriginRevisionTable} dependency WHERE dependency.origin_id=origin.origin_id AND dependency.body_ref=?)`;
    bindings = [selector.ledgerBodyRef, selector.ledgerBodyRef];
  } else if ((exactKeys(selector, ["ledgerId"]) || exactKeys(selector, ["ledgerId", "currentStorageRevision"])) && "ledgerId" in selector && id(selector.ledgerId)) {
    sql = "origin.ledger_id=?"; bindings = [selector.ledgerId];
    if ("currentStorageRevision" in selector) {
      if (!positive(selector.currentStorageRevision)) return null;
      sql += " AND origin.ledger_storage_revision<>?"; bindings.push(selector.currentStorageRevision);
      revision = available.has("memory_structured_conversation_heads")
        ? { sql: "EXISTS(SELECT 1 FROM memory_structured_conversation_heads WHERE ledger_id=? AND storage_revision=?)", bindings: [selector.ledgerId, selector.currentStorageRevision] }
        : { sql: "0", bindings: [] };
    }
  } else return null;
  return { selection: { sql, bindings }, revision, terminalGuard };
}
/** Availability inverse only. The complete fanout is captured without a recall cap;
 * any preparation failure rejects the whole operation. Execute the full array in
 * one atomic batch before changing enrollment/head rows. Physical cleanup remains
 * discoverable from permanent headers and is deliberately NOT certified erased. */
export async function prepareNativeStructuredOriginWithdrawal(env: StructuredOriginLifecycleEnv, selectorInput: NativeStructuredOriginWithdrawalSelector,
  reason: NativeMemoryOriginWithdrawalReason, now: string): Promise<null | {
    statements: NativeMemoryOriginQuery[]; assertionIndexes: number[]; terminalAssertions: NativeMemoryOriginQuery[];
    acknowledge(results: readonly unknown[]): boolean;
  }> {
  try {
    const db = env.DB, selector = structuredClone(selectorInput);
    if (!structuredOriginSelection(selector, new Set()) || !reasons.has(reason) || nativeMemoryTimestamp(now) === null) return null;
    const schema = await nativeStructuredOriginSchema(env);
    const schemaAssertion = structuredOriginAssertion(schema.guard.condition, schema.guard.bindings);
    if (!schema.present) {
      await structuredOriginAbsent(env);
      if (env.DB !== db || JSON.stringify(selectorInput) !== JSON.stringify(selector)) return null;
      const absent = structuredOriginAssertion(structuredOriginAbsentCondition);
      const statements = [schemaAssertion, absent], assertionIndexes = [0, 1], terminalAssertions = [schemaAssertion, absent];
      structuredOriginFreezeQueries(statements); structuredOriginFreezeQueries(terminalAssertions); Object.freeze(assertionIndexes);
      let acknowledged = false;
      return Object.freeze({ statements, assertionIndexes, terminalAssertions, acknowledge(results: readonly unknown[]) {
        if (acknowledged) return false; acknowledged = true;
        return env.DB === db && JSON.stringify(selectorInput) === JSON.stringify(selector) && structuredOriginAcknowledged(results, 2, [0, 1], []);
      } });
    }
    const authority = await structuredOriginAuthoritySchema(env), selected = structuredOriginSelection(selector, authority.available);
    if (!selected) return null;
    const terminalGuard = structuredOriginAssertion(selected.terminalGuard.sql, selected.terminalGuard.bindings);
    if (selected.terminalGuard.sql !== "1") await structuredOriginVerifyReads(db, [schemaAssertion, authority.assertion, terminalGuard, schemaAssertion]);
    const columns = NATIVE_STRUCTURED_ORIGIN_HEADER_COLUMNS;
    const query = { sql: `WITH lifecycle_clock(now) AS(SELECT ?) SELECT ${columns.map(column => "origin." + column).join(",")} FROM ${structuredOriginTable} origin WHERE (${selected.selection.sql}) ORDER BY origin.origin_id`, bindings: [now, ...selected.selection.bindings] };
    const rows = structuredOriginRows(structuredClone(await db.prepare(query.sql).bind(...query.bindings).all()), columns);
    if (env.DB !== db || JSON.stringify(selectorInput) !== JSON.stringify(selector)
      || rows.some(row => row.status === "minimized" ? !validateNativeStructuredOriginTombstone(row)
        : !id(row.origin_id) || nativeMemoryTimestamp(row.created_at) === null || String(row.created_at) > now || !["active", "withdrawn"].includes(String(row.status)))) return null;
    const terminal = rows.map(row => row.status !== "active" ? row : { ...row, status: "withdrawn", withdrawn_at: now, withdrawal_reason: reason });
    const direct = { sql: `SELECT ${columns.join(",")} FROM ${structuredOriginTable} WHERE origin_id IN(SELECT value FROM json_each(?)) ORDER BY origin_id`, bindings: [JSON.stringify(rows.map(row => row.origin_id))] };
    const terminalAssertion = structuredOriginExact(direct, terminal, columns);
    const minimizedIntact = structuredOriginAssertion(`NOT EXISTS(SELECT 1 FROM ${structuredOriginTable} origin
      WHERE origin.origin_id IN(SELECT value FROM json_each(?)) AND origin.status='minimized'
      AND ((${structuredOriginTombstoneSql}) IS NOT 1 OR NOT ${structuredOriginDerivedRowsAbsent}))`, [JSON.stringify(rows.map(row => row.origin_id))]);
    const statements = [schemaAssertion, structuredOriginAssertion(selected.revision.sql, selected.revision.bindings), structuredOriginExact(query, rows, columns), authority.assertion, minimizedIntact, terminalGuard,
      { sql: `UPDATE ${structuredOriginTable} SET status='withdrawn',withdrawn_at=?,withdrawal_reason=? WHERE status='active'
        AND origin_id IN(SELECT value FROM json_each(?))`, bindings: [now, reason, JSON.stringify(rows.map(row => row.origin_id))] },
      terminalAssertion, structuredOriginExact(query, terminal, columns), schemaAssertion, authority.assertion, minimizedIntact, terminalGuard];
    const assertionIndexes = [0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12], writes = [{ index: 6, changes: rows.filter(row => row.status === "active").length }];
    const terminalAssertions = [schemaAssertion, terminalAssertion, minimizedIntact, terminalGuard];
    structuredOriginFreezeQueries(statements); structuredOriginFreezeQueries(terminalAssertions); Object.freeze(assertionIndexes);
    let acknowledged = false;
    return Object.freeze({ statements, assertionIndexes, terminalAssertions, acknowledge(results: readonly unknown[]) {
      if (acknowledged) return false; acknowledged = true;
      return env.DB === db && JSON.stringify(selectorInput) === JSON.stringify(selector) && structuredOriginAcknowledged(results, statements.length, assertionIndexes, writes);
    } });
  } catch { return null; }
}

const structuredOriginScopeHeld = (origin: string, ref: string) => `(${origin}.organization_id IS NOT NULL AND EXISTS(SELECT 1 FROM organization_legal_holds hold
  WHERE hold.organization_id=${origin}.organization_id AND hold.status='active' AND (hold.scope_kind='organization'
    OR hold.scope_kind='project' AND hold.resource_id=${origin}.project_access_id OR hold.scope_kind='content' AND hold.resource_id=${ref})))`;
const structuredOriginBodyHeld = (origin: string, ref: string) => `(${structuredOriginScopeHeld(origin, ref)}
  OR EXISTS(SELECT 1 FROM private_content_retention_scopes governed JOIN organization_retention_policies policy ON policy.organization_id=governed.organization_id
    AND policy.legal_hold=1 WHERE governed.content_id=${ref} AND governed.classification='governed-evidence')
  OR EXISTS(SELECT 1 FROM private_content_retention_scopes governed JOIN organization_legal_holds hold ON hold.organization_id=governed.organization_id AND hold.status='active'
    WHERE governed.content_id=${ref} AND (hold.scope_kind='organization' OR hold.scope_kind='project' AND hold.resource_id=governed.project_access_id
      OR hold.scope_kind='content' AND hold.resource_id=governed.content_id)))`;
const structuredOriginBodyPending = (ref: string) => `(EXISTS(SELECT 1 FROM private_content body WHERE body.content_id=${ref} AND (body.content<>'' OR body.redacted_at IS NULL))
  OR EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='content' AND resource.resource_id=${ref})
  OR EXISTS(SELECT 1 FROM private_content_retention_scopes retention WHERE retention.content_id=${ref}))`;
const structuredOriginTime = (value: string) => `(typeof(${value})='text' AND length(${value})=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',${value}) IS ${value})`;
const structuredOriginMetadataReadable = (alias: string, columns: readonly string[]) => columns.map(column => `(typeof(${alias}.${column})<>'blob'
  AND (typeof(${alias}.${column})<>'text' OR length(CAST(${alias}.${column} AS BLOB))<=1024))`).join(" AND ");
const structuredOriginTombstoneSql = nativeStructuredOriginMinimizedCondition("origin").condition;
const structuredOriginFullHeaderReadable = `(${structuredOriginMetadataReadable("origin", NATIVE_STRUCTURED_ORIGIN_HEADER_COLUMNS)}
  AND origin.status IN('active','withdrawn')
  AND length(origin.origin_id) BETWEEN 1 AND 240 AND ${structuredOriginTime("origin.created_at")}
  AND (origin.status='active' OR ${structuredOriginTime("origin.withdrawn_at")}))`;
const structuredOriginHeaderReadable = `(${structuredOriginFullHeaderReadable} OR ${structuredOriginTombstoneSql})`;
const structuredOriginDependenciesReadable = `(NOT EXISTS(SELECT 1 FROM ${structuredOriginalTable} dependency WHERE dependency.origin_id=origin.origin_id
  AND NOT(${structuredOriginMetadataReadable("dependency", NATIVE_STRUCTURED_ORIGIN_ORIGINAL_COLUMNS)}))
  AND NOT EXISTS(SELECT 1 FROM ${structuredOriginRevisionTable} dependency WHERE dependency.origin_id=origin.origin_id
    AND NOT(${structuredOriginMetadataReadable("dependency", NATIVE_STRUCTURED_ORIGIN_REVISION_COLUMNS)})))`;
function structuredOriginBodyEligible(origin: string, ref: string, kind: string, expiry: string): string {
  return `(NOT ${structuredOriginBodyHeld(origin, ref)}
    AND NOT EXISTS(SELECT 1 FROM private_content body WHERE body.content_id=${ref} AND (body.owner_id IS NOT ${origin}.actor_user_id
      OR body.kind IS NOT '${kind}' OR body.created_at IS NOT ${origin}.created_at OR NOT ${structuredOriginTime("body.expires_at")}
      OR body.expires_at>${expiry} OR body.redacted_at IS NOT NULL AND NOT ${structuredOriginTime("body.redacted_at")}))
    AND (SELECT COUNT(*) FROM project_resource_scopes resource WHERE resource.resource_kind='content' AND resource.resource_id=${ref})<=1
    AND (SELECT COUNT(*) FROM private_content_retention_scopes retention WHERE retention.content_id=${ref})<=1
    AND (${origin}.organization_id IS NULL
      AND NOT EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='content' AND resource.resource_id=${ref})
      AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes retention WHERE retention.content_id=${ref})
      OR ${origin}.organization_id IS NOT NULL
        AND (NOT EXISTS(SELECT 1 FROM private_content body WHERE body.content_id=${ref}) OR NOT ${structuredOriginBodyPending(ref)}
          OR EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='content' AND resource.resource_id=${ref})
            AND EXISTS(SELECT 1 FROM private_content_retention_scopes retention WHERE retention.content_id=${ref}))
        AND NOT EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='content' AND resource.resource_id=${ref}
          AND NOT((resource.project_access_id,resource.organization_id,resource.project_id,resource.owner_user_id,resource.actor_user_id,resource.visibility,resource.created_at,resource.source_event_id)
            IS (${origin}.project_access_id,${origin}.organization_id,${origin}.project_id,${origin}.owner_user_id,${origin}.actor_user_id,'actor_private',${origin}.created_at,NULL)))
        AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes retention WHERE retention.content_id=${ref}
          AND (NOT((retention.organization_id,retention.project_access_id,retention.project_id,retention.actor_user_id,retention.classification,retention.created_at)
            IS (${origin}.organization_id,${origin}.project_access_id,${origin}.project_id,${origin}.actor_user_id,'transient-private',${origin}.created_at))
            OR typeof(retention.policy_version)<>'integer' OR retention.policy_version<0 OR retention.policy_version>9007199254740991
            OR NOT ${structuredOriginTime("retention.assigned_expires_at")} OR retention.assigned_expires_at>${expiry}))))`;
}
const structuredOriginAnswerEligible = structuredOriginBodyEligible("origin", "origin.answer_content_id", "chat-assistant-memory", "origin.answer_expires_at");
const structuredOriginManifestEligible = structuredOriginBodyEligible("origin", "origin.manifest_content_ref", "memory-structured-origin", "origin.manifest_expires_at");
const structuredOriginDependenciesUnheld = `(NOT ${structuredOriginBodyHeld("origin", "origin.answer_content_id")}
  AND NOT ${structuredOriginBodyHeld("origin", "origin.manifest_content_ref")}
  AND NOT EXISTS(SELECT 1 FROM ${structuredOriginalTable} dependency WHERE dependency.origin_id=origin.origin_id AND ${structuredOriginBodyHeld("origin", "dependency.content_id")})
  AND NOT EXISTS(SELECT 1 FROM ${structuredOriginRevisionTable} dependency WHERE dependency.origin_id=origin.origin_id AND ${structuredOriginBodyHeld("origin", "dependency.body_ref")}))`;
const structuredOriginBodiesCleared = `(NOT ${structuredOriginBodyPending("origin.answer_content_id")} AND NOT ${structuredOriginBodyPending("origin.manifest_content_ref")}
  AND ${structuredOriginAnswerEligible} AND ${structuredOriginManifestEligible})`;
const structuredOriginDependenciesAbsent = `(NOT EXISTS(SELECT 1 FROM ${structuredOriginalTable} dependency WHERE dependency.origin_id=origin.origin_id)
  AND NOT EXISTS(SELECT 1 FROM ${structuredOriginRevisionTable} dependency WHERE dependency.origin_id=origin.origin_id))`;
const structuredOriginDerivedRowsAbsent = `(NOT EXISTS(SELECT 1 FROM private_content body WHERE body.content_id IN(origin.answer_content_id,origin.manifest_content_ref))
  AND NOT EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='content' AND resource.resource_id IN(origin.answer_content_id,origin.manifest_content_ref))
  AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes retention WHERE retention.content_id IN(origin.answer_content_id,origin.manifest_content_ref))
  AND ${structuredOriginDependenciesAbsent})`;
/** Pair this boolean predicate with the exact optional 0033 schema bookend.
 * Even a blank resurrected derived row is unavailable; ordinary user content is
 * deliberately excluded from these terminal-body constraints. */
export function nativeStructuredOriginMinimizedIntegrity(): NativeMemoryOriginQuery {
  return { sql: `NOT EXISTS(SELECT 1 FROM ${structuredOriginTable} origin WHERE origin.status='minimized'
    AND ((${structuredOriginTombstoneSql}) IS NOT 1 OR NOT ${structuredOriginDerivedRowsAbsent}))`, bindings: [] };
}
function structuredOriginOldScopeUnheld(header: StructuredOriginLifecycleRow): NativeMemoryOriginQuery {
  // Never read these custody fields from the post-minimization header: all are
  // intentionally NULL there. These are owned bindings from the exact OLD row.
  return { sql: `WITH origin(organization_id,project_access_id) AS(SELECT ?,?)
    SELECT CASE WHEN NOT ${structuredOriginBodyHeld("origin", "?")} AND NOT ${structuredOriginBodyHeld("origin", "?")}
      THEN 1 ELSE json('memory_structured_origin_lifecycle_changed') END AS verified FROM origin`,
    bindings: [header.organization_id, header.project_access_id,
      header.answer_content_id, header.answer_content_id, header.answer_content_id,
      header.manifest_content_ref, header.manifest_content_ref, header.manifest_content_ref] };
}
async function structuredOriginAuthoritySchema(env: StructuredOriginLifecycleEnv): Promise<{ available: ReadonlySet<string>; assertion: NativeMemoryOriginQuery }> {
  const query = { sql: `SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE tbl_name IN('memory_live_enrollments',
    'memory_structured_conversation_heads','memory_structured_conversation_revisions') ORDER BY type,name LIMIT 65`, bindings: [] };
  const result = structuredClone(await env.DB.prepare(query.sql).all()) as { success?: unknown; error?: unknown; results?: unknown };
  if (!structuredOriginEnvelope(result) || result.results.length > 64)
    throw new Error("memory-structured-origin-authority-schema-unavailable");
  const rows = result.results as StructuredOriginLifecycleRow[];
  if (rows.some(row => !exactKeys(row, ["type", "name", "tbl_name", "sql"]) || Object.values(row).some(value => value !== null
    && !(typeof value === "string" && value.length <= 65536)))) throw new Error("memory-structured-origin-authority-schema-unavailable");
  const available = new Set(rows.filter(row => row.type === "table").map(row => String(row.name)));
  if (rows.some(row => !available.has(String(row.tbl_name)))) throw new Error("memory-structured-origin-authority-schema-unavailable");
  return { available, assertion: structuredOriginExact(query, rows, ["type", "name", "tbl_name", "sql"]) };
}
/** Metadata-only maintenance exclusion. No v1 reference/segment table participates.
 * Exact prose/projection hashes remain the dedicated replay reader's obligation;
 * known content/event changes use explicit dependency selectors. */
function structuredOriginUnavailable(available: ReadonlySet<string>): string {
  const clock = "(SELECT now FROM lifecycle_clock)", enrollment = available.has("memory_live_enrollments")
    ? `EXISTS(SELECT 1 FROM memory_live_enrollments enrollment WHERE enrollment.enrollment_id=origin.enrollment_id
      AND enrollment.revision=origin.enrollment_revision AND enrollment.recall_enabled=1 AND enrollment.expires_at>${clock})` : "0";
  const head = available.has("memory_structured_conversation_heads")
    ? `EXISTS(SELECT 1 FROM memory_structured_conversation_heads head WHERE head.ledger_id=origin.ledger_id AND head.state='active'
      AND head.storage_revision=origin.ledger_storage_revision AND head.current_body_ref=origin.ledger_body_ref AND head.current_body_hash=origin.ledger_body_sha256)` : "0";
  const revision = available.has("memory_structured_conversation_revisions")
    ? `EXISTS(SELECT 1 FROM memory_structured_conversation_revisions current WHERE
      (current.ledger_id,current.revision,current.predecessor_revision,current.predecessor_hash,current.body_ref,current.body_hash,current.created_at,current.expires_at)
      IS (dependency.ledger_id,dependency.storage_revision,dependency.predecessor_revision,dependency.predecessor_hash,dependency.body_ref,dependency.body_hash,dependency.created_at,dependency.expires_at))` : "0";
  return `(origin.source_retention_ceiling<=${clock} OR origin.answer_expires_at<=${clock} OR origin.manifest_expires_at<=${clock}
    OR NOT (${enrollment}) OR NOT (${head})
    OR (SELECT COUNT(*) FROM ${structuredOriginalTable} dependency WHERE dependency.origin_id=origin.origin_id)<>origin.source_count
    OR (SELECT COUNT(*) FROM ${structuredOriginRevisionTable} dependency WHERE dependency.origin_id=origin.origin_id)<>origin.ledger_revision_count
    OR EXISTS(SELECT 1 FROM ${structuredOriginalTable} dependency WHERE dependency.origin_id=origin.origin_id AND (dependency.source_retention_ceiling<=${clock}
      OR NOT EXISTS(SELECT 1 FROM events event WHERE (event.stream_id,event.event_id,event.sequence,event.type,event.recorded_at)
        IS (dependency.event_stream_id,dependency.event_id,dependency.source_sequence,dependency.event_type,dependency.recorded_at)
        AND CASE WHEN length(CAST(event.payload AS BLOB))<=65536 AND json_valid(event.payload) THEN
          (json_extract(event.payload,'$.content_ref'),json_extract(event.payload,'$.turn_id')) IS (dependency.content_id,dependency.turn_id) ELSE 0 END)
      OR NOT EXISTS(SELECT 1 FROM private_content body WHERE body.content_id=dependency.content_id AND body.owner_id=origin.actor_user_id
        AND body.kind=CASE WHEN dependency.role='user' THEN 'chat-user' ELSE 'chat-assistant' END AND body.redacted_at IS NULL
        AND body.created_at<=dependency.recorded_at AND body.expires_at>${clock})))
    OR EXISTS(SELECT 1 FROM ${structuredOriginRevisionTable} dependency WHERE dependency.origin_id=origin.origin_id
      AND (dependency.expires_at<=${clock} OR NOT (${revision}) OR NOT EXISTS(SELECT 1 FROM private_content body
        WHERE body.content_id=dependency.body_ref AND body.owner_id=origin.actor_user_id AND body.kind='memory-structured-ledger'
          AND body.created_at=dependency.created_at AND body.expires_at>${clock} AND body.redacted_at IS NULL))))`;
}
function structuredOriginCandidates(now: string, available: ReadonlySet<string>): NativeMemoryOriginQuery {
  return { sql: `WITH lifecycle_clock(now) AS(SELECT ?),pending AS(SELECT origin.origin_id,COALESCE(origin.withdrawn_at,origin.created_at) AS oldest,
    CASE WHEN origin.status='active' AND ${structuredOriginUnavailable(available)} THEN 'mark'
      WHEN origin.status='withdrawn' AND ${structuredOriginDependenciesReadable} THEN CASE
        WHEN ${structuredOriginBodyPending("origin.answer_content_id")} AND ${structuredOriginAnswerEligible} THEN 'answer'
        WHEN ${structuredOriginBodyPending("origin.manifest_content_ref")} AND ${structuredOriginManifestEligible} THEN 'manifest'
        WHEN ${structuredOriginBodiesCleared} AND ${structuredOriginDependenciesUnheld} THEN CASE
          WHEN EXISTS(SELECT 1 FROM ${structuredOriginalTable} dependency WHERE dependency.origin_id=origin.origin_id) THEN 'original'
          WHEN EXISTS(SELECT 1 FROM ${structuredOriginRevisionTable} dependency WHERE dependency.origin_id=origin.origin_id) THEN 'revision'
          WHEN EXISTS(SELECT 1 FROM private_content body WHERE body.content_id=origin.answer_content_id) THEN 'answer-delete'
          WHEN EXISTS(SELECT 1 FROM private_content body WHERE body.content_id=origin.manifest_content_ref) THEN 'manifest-delete'
          ELSE 'minimize' END END END AS operation
    FROM ${structuredOriginTable} origin WHERE ${structuredOriginFullHeaderReadable} AND ${structuredOriginDependenciesReadable} AND origin.created_at<=?)
    SELECT origin_id,operation,oldest FROM pending WHERE operation IS NOT NULL ORDER BY oldest,origin_id`, bindings: [now, now] };
}
function structuredOriginResidue(): string {
  return `(EXISTS(SELECT 1 FROM private_content body WHERE body.kind='memory-structured-origin' AND ${structuredOriginBodyPending("body.content_id")}
      AND NOT EXISTS(SELECT 1 FROM ${structuredOriginTable} origin WHERE origin.manifest_content_ref=body.content_id))
    OR EXISTS(SELECT 1 FROM (SELECT CASE WHEN length(CAST(event.payload AS BLOB))<=65536 AND json_valid(event.payload) THEN
      CASE WHEN json_extract(event.payload,'$.memory_origin_version') IS 2 AND json_type(event.payload,'$.content_ref')='text'
        AND length(json_extract(event.payload,'$.content_ref')) BETWEEN 1 AND 240 THEN json_extract(event.payload,'$.content_ref') END END AS content_ref
      FROM events event WHERE event.type='AssistantReasoned') orphan WHERE orphan.content_ref IS NOT NULL AND ${structuredOriginBodyPending("orphan.content_ref")}
        AND NOT EXISTS(SELECT 1 FROM ${structuredOriginTable} origin WHERE origin.answer_content_id=orphan.content_ref))
    OR EXISTS(SELECT 1 FROM ${structuredOriginTable} origin WHERE NOT ${structuredOriginHeaderReadable} OR NOT ${structuredOriginDependenciesReadable})
    OR NOT (${nativeStructuredOriginMinimizedIntegrity().sql})
    OR EXISTS(SELECT 1 FROM ${structuredOriginTable} origin WHERE origin.status='withdrawn' AND (
      NOT ${structuredOriginBodyHeld("origin", "origin.answer_content_id")} AND NOT ${structuredOriginAnswerEligible}
      OR NOT ${structuredOriginBodyHeld("origin", "origin.manifest_content_ref")} AND NOT ${structuredOriginManifestEligible})))`;
}
const structuredOriginAbsentCondition = `NOT EXISTS(SELECT 1 FROM private_content WHERE kind='memory-structured-origin')
  AND NOT EXISTS(SELECT 1 FROM events event WHERE event.type='AssistantReasoned' AND CASE WHEN json_valid(event.payload)
    THEN json_extract(event.payload,'$.memory_origin_version') IS 2 ELSE 0 END)`;
async function structuredOriginAbsent(env: StructuredOriginLifecycleEnv): Promise<void> {
  const rows = structuredOriginRows(structuredClone(await env.DB.prepare(`SELECT CASE WHEN ${structuredOriginAbsentCondition} THEN 0 ELSE 1 END AS stray`).all()), ["stray"]);
  if (rows.length !== 1 || rows[0].stray !== 0) throw new Error("memory-structured-origin-cleanup-unavailable");
}
async function structuredOriginVerifyReads(db: StructuredOriginLifecycleEnv["DB"], queries: readonly NativeMemoryOriginQuery[]): Promise<void> {
  const results = structuredClone(await db.batch(queries.map(query => db.prepare(query.sql).bind(...query.bindings))));
  if (!structuredOriginAcknowledged(results, queries.length, queries.map((_, index) => index), [])) throw new Error("memory-structured-origin-cleanup-unavailable");
}
/** One persisted lifecycle unit, independent of enrollment/ledger existence. A
 * held/malformed target cannot hide another eligible origin. The runtime owns
 * allowance/fairness; this operation never creates a scheduler or extends it. */
export async function prepareNativeStructuredOriginRetentionStep(env: StructuredOriginLifecycleEnv, input: { now: string }): Promise<null | {
  statements: NativeMemoryOriginQuery[]; workUnits: 1; oldest: string; selectionKey: string;
  assertionIndexes: number[]; acknowledge(results: readonly unknown[]): boolean;
}> {
  const db = env.DB, now = input.now;
  if (nativeMemoryTimestamp(now) === null) throw new Error("memory-structured-origin-cleanup-invalid");
  const schema = await nativeStructuredOriginSchema(env);
  if (!schema.present) {
    await structuredOriginVerifyReads(db, [structuredOriginAssertion(schema.guard.condition, schema.guard.bindings), structuredOriginAssertion(structuredOriginAbsentCondition)]);
    if (env.DB !== db || input.now !== now) throw new Error("memory-structured-origin-cleanup-changed"); return null;
  }
  const authority = await structuredOriginAuthoritySchema(env);
  const candidates = structuredOriginCandidates(now, authority.available), selection = { sql: candidates.sql + " LIMIT 1", bindings: candidates.bindings };
  const selected = structuredOriginRows(structuredClone(await db.prepare(selection.sql).bind(...selection.bindings).all()), ["origin_id", "operation", "oldest"]);
  if (selected.length > 1) throw new Error("memory-structured-origin-cleanup-unavailable");
  if (!selected.length) {
    const residue = structuredOriginRows(structuredClone(await db.prepare(`SELECT CASE WHEN ${structuredOriginResidue()} THEN 1 ELSE 0 END AS stray`).all()), ["stray"]);
    if (env.DB !== db || input.now !== now || residue.length !== 1 || residue[0].stray !== 0) throw new Error("memory-structured-origin-cleanup-unavailable");
    await structuredOriginVerifyReads(db, [structuredOriginAssertion(schema.guard.condition, schema.guard.bindings), authority.assertion,
      structuredOriginExact(selection, [], ["origin_id", "operation", "oldest"]), structuredOriginAssertion(`NOT ${structuredOriginResidue()}`)]);
    if (env.DB !== db || input.now !== now) throw new Error("memory-structured-origin-cleanup-changed");
    return null;
  }
  const target = selected[0], headerQuery = { sql: `SELECT ${NATIVE_STRUCTURED_ORIGIN_HEADER_COLUMNS.join(",")} FROM ${structuredOriginTable} WHERE origin_id=?`, bindings: [target.origin_id] };
  const headers = structuredOriginRows(structuredClone(await db.prepare(headerQuery.sql).bind(...headerQuery.bindings).all()), NATIVE_STRUCTURED_ORIGIN_HEADER_COLUMNS);
  if (headers.length !== 1 || !id(target.origin_id) || nativeMemoryTimestamp(target.oldest) === null) throw new Error("memory-structured-origin-cleanup-unavailable");
  const header = headers[0], statements: NativeMemoryOriginQuery[] = [], assertionIndexes: number[] = [], writes: { index: number; changes: number }[] = [];
  const prove = (query: NativeMemoryOriginQuery) => { assertionIndexes.push(statements.length); statements.push(query); };
  const write = (query: NativeMemoryOriginQuery, changes: number) => { writes.push({ index: statements.length, changes }); statements.push(query); prove(structuredOriginAssertion("changes()=?", [changes])); };
  const schemaAssertion = structuredOriginAssertion(schema.guard.condition, schema.guard.bindings);
  prove(schemaAssertion); prove(authority.assertion); prove(structuredOriginExact(selection, selected, ["origin_id", "operation", "oldest"])); prove(structuredOriginExact(headerQuery, headers, NATIVE_STRUCTURED_ORIGIN_HEADER_COLUMNS));
  const dependencyQueries = [
    { sql: `SELECT ${NATIVE_STRUCTURED_ORIGIN_ORIGINAL_COLUMNS.join(",")} FROM ${structuredOriginalTable} WHERE origin_id=? ORDER BY ordinal LIMIT 129`, bindings: [target.origin_id] },
    { sql: `SELECT ${NATIVE_STRUCTURED_ORIGIN_REVISION_COLUMNS.join(",")} FROM ${structuredOriginRevisionTable} WHERE origin_id=? ORDER BY ordinal LIMIT 65`, bindings: [target.origin_id] },
  ];
  const dependencyColumns = [NATIVE_STRUCTURED_ORIGIN_ORIGINAL_COLUMNS, NATIVE_STRUCTURED_ORIGIN_REVISION_COLUMNS];
  const dependencyResults = structuredClone(await db.batch(dependencyQueries.map(query => db.prepare(query.sql).bind(...query.bindings))));
  if (!Array.isArray(dependencyResults) || dependencyResults.length !== 2) throw new Error("memory-structured-origin-cleanup-unavailable");
  const dependencies = dependencyResults.map((result, index) => structuredOriginRows(result, dependencyColumns[index]));
  if (dependencies[0].length > 128 || dependencies[1].length > 64) throw new Error("memory-structured-origin-cleanup-unavailable");
  dependencyQueries.forEach((query, index) => prove(structuredOriginExact(query, dependencies[index], dependencyColumns[index])));
  let terminal = header;
  if (target.operation === "mark") {
    terminal = { ...header, status: "withdrawn", withdrawn_at: now, withdrawal_reason: "source-unavailable" };
    write({ sql: `UPDATE ${structuredOriginTable} SET status='withdrawn',withdrawn_at=?,withdrawal_reason='source-unavailable' WHERE origin_id=? AND status='active'`, bindings: [now, target.origin_id] }, 1);
  } else if (target.operation === "answer" || target.operation === "manifest") {
    // One body unit is at most one redaction and its two exact custody removals;
    // it never consumes another body or any dependency under that allowance.
    const ref = String(target.operation === "answer" ? header.answer_content_id : header.manifest_content_ref);
    const queries = [
      { sql: "SELECT content_id,owner_id,kind,created_at,expires_at,redacted_at,CASE WHEN content='' THEN 1 ELSE 0 END AS empty FROM private_content WHERE content_id=?", bindings: [ref] },
      { sql: `SELECT ${structuredOriginResourceColumns.join(",")} FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?`, bindings: [ref] },
      { sql: `SELECT ${structuredOriginRetentionColumns.join(",")} FROM private_content_retention_scopes WHERE content_id=?`, bindings: [ref] },
    ];
    const columns = [structuredOriginBodyColumns, structuredOriginResourceColumns, structuredOriginRetentionColumns];
    const results = structuredClone(await db.batch(queries.map(query => db.prepare(query.sql).bind(...query.bindings))));
    if (!Array.isArray(results) || results.length !== 3) throw new Error("memory-structured-origin-cleanup-unavailable");
    const rows = results.map((result, index) => structuredOriginRows(result, columns[index]));
    if (rows.some(group => group.length > 1)) throw new Error("memory-structured-origin-cleanup-unavailable");
    queries.forEach((query, index) => prove(structuredOriginExact(query, rows[index], columns[index])));
    const eligibility = target.operation === "answer" ? structuredOriginAnswerEligible : structuredOriginManifestEligible;
    prove(structuredOriginAssertion(`EXISTS(SELECT 1 FROM ${structuredOriginTable} origin WHERE origin.origin_id=? AND ${eligibility})`, [target.origin_id]));
    if (rows[0].length) write({ sql: "UPDATE private_content SET content='',redacted_at=COALESCE(redacted_at,?) WHERE content_id=?", bindings: [now, ref] }, 1);
    write({ sql: "DELETE FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?", bindings: [ref] }, rows[1].length);
    write({ sql: "DELETE FROM private_content_retention_scopes WHERE content_id=?", bindings: [ref] }, rows[2].length);
    const cleared = rows[0].map(row => ({ ...row, redacted_at: row.redacted_at ?? now, empty: 1 }));
    prove(structuredOriginExact(queries[0], cleared, structuredOriginBodyColumns));
    prove(structuredOriginExact(queries[1], [], structuredOriginResourceColumns)); prove(structuredOriginExact(queries[2], [], structuredOriginRetentionColumns));
    prove(structuredOriginAssertion(`EXISTS(SELECT 1 FROM ${structuredOriginTable} origin WHERE origin.origin_id=? AND NOT ${structuredOriginBodyHeld("origin", "?")})`, [target.origin_id, ref, ref, ref]));
  } else if (target.operation === "original" || target.operation === "revision") {
    const table = target.operation === "original" ? structuredOriginalTable : structuredOriginRevisionTable;
    const columns = target.operation === "original" ? NATIVE_STRUCTURED_ORIGIN_ORIGINAL_COLUMNS : NATIVE_STRUCTURED_ORIGIN_REVISION_COLUMNS;
    const query = { sql: `SELECT ${columns.join(",")} FROM ${table} WHERE origin_id=? ORDER BY ordinal LIMIT 1`, bindings: [target.origin_id] };
    const rows = structuredOriginRows(structuredClone(await db.prepare(query.sql).bind(...query.bindings).all()), columns);
    if (rows.length !== 1) throw new Error("memory-structured-origin-cleanup-unavailable");
    prove(structuredOriginExact(query, rows, columns));
    prove(structuredOriginAssertion(`EXISTS(SELECT 1 FROM ${structuredOriginTable} origin WHERE origin.origin_id=? AND ${structuredOriginBodiesCleared} AND ${structuredOriginDependenciesUnheld})`, [target.origin_id]));
    write({ sql: `DELETE FROM ${table} WHERE origin_id=? AND ordinal=?`, bindings: [target.origin_id, rows[0].ordinal] }, 1);
    prove(structuredOriginAssertion(`NOT EXISTS(SELECT 1 FROM ${table} WHERE origin_id=? AND ordinal=?)`, [target.origin_id, rows[0].ordinal]));
    const removedRef = String(target.operation === "original" ? rows[0].content_id : rows[0].body_ref);
    prove(structuredOriginAssertion(`EXISTS(SELECT 1 FROM ${structuredOriginTable} origin WHERE origin.origin_id=? AND NOT ${structuredOriginBodyHeld("origin", "?")})`, [target.origin_id, removedRef, removedRef, removedRef]));
    const index = target.operation === "original" ? 0 : 1;
    dependencies[index] = dependencies[index].filter(row => row.ordinal !== rows[0].ordinal);
  } else if (target.operation === "answer-delete" || target.operation === "manifest-delete") {
    const ref = target.operation === "answer-delete" ? header.answer_content_id : header.manifest_content_ref;
    const query = { sql: "SELECT content_id,owner_id,kind,created_at,expires_at,redacted_at,CASE WHEN content='' THEN 1 ELSE 0 END AS empty FROM private_content WHERE content_id=?", bindings: [ref] };
    const rows = structuredOriginRows(structuredClone(await db.prepare(query.sql).bind(...query.bindings).all()), structuredOriginBodyColumns);
    if (rows.length !== 1 || rows[0].empty !== 1 || nativeMemoryTimestamp(rows[0].redacted_at) === null)
      throw new Error("memory-structured-origin-cleanup-unavailable");
    prove(structuredOriginExact(query, rows, structuredOriginBodyColumns));
    prove(structuredOriginAssertion(`EXISTS(SELECT 1 FROM ${structuredOriginTable} origin WHERE origin.origin_id=? AND origin.status='withdrawn'
      AND ${structuredOriginBodiesCleared} AND ${structuredOriginDependenciesAbsent} AND ${structuredOriginDependenciesUnheld})`, [target.origin_id]));
    const oldScope = structuredOriginOldScopeUnheld(header); prove(oldScope);
    // A separate unit removes only one already-redacted derived row. The user's
    // authored body is never a target and no tombstone field changes here.
    write({ sql: "DELETE FROM private_content WHERE content_id=?", bindings: [ref] }, 1);
    prove(structuredOriginExact(query, [], structuredOriginBodyColumns)); prove(oldScope);
  } else if (target.operation === "minimize") {
    terminal = Object.fromEntries(NATIVE_STRUCTURED_ORIGIN_HEADER_COLUMNS.map(column => [column,
      column === "status" ? "minimized" : NATIVE_STRUCTURED_ORIGIN_TOMBSTONE_COLUMNS.some(retained => retained === column) ? header[column] : null]));
    if (!validateNativeStructuredOriginTombstone(terminal)) throw new Error("memory-structured-origin-cleanup-unavailable");
    const oldScope = structuredOriginOldScopeUnheld(header); prove(oldScope);
    prove(structuredOriginAssertion(`EXISTS(SELECT 1 FROM ${structuredOriginTable} origin WHERE origin.origin_id=? AND origin.status='withdrawn'
      AND ${structuredOriginDerivedRowsAbsent})`, [target.origin_id]));
    write({ sql: `UPDATE ${structuredOriginTable} SET status='minimized',${NATIVE_STRUCTURED_ORIGIN_HEADER_COLUMNS
      .filter(column => !NATIVE_STRUCTURED_ORIGIN_TOMBSTONE_COLUMNS.some(retained => retained === column)).map(column => column + "=NULL").join(",")}
      WHERE origin_id=? AND status='withdrawn'`, bindings: [target.origin_id] }, 1);
    // The original scope proof is replayed AFTER the scope columns are scrubbed.
    // A concurrent/triggered hold must roll back the complete minimization.
    prove(oldScope);
    prove(structuredOriginAssertion(`EXISTS(SELECT 1 FROM ${structuredOriginTable} origin WHERE origin.origin_id=?
      AND (${structuredOriginTombstoneSql}) AND ${structuredOriginDerivedRowsAbsent})`, [target.origin_id]));
  } else throw new Error("memory-structured-origin-cleanup-unavailable");
  dependencyQueries.forEach((query, index) => prove(structuredOriginExact(query, dependencies[index], dependencyColumns[index])));
  prove(structuredOriginExact(headerQuery, [terminal], NATIVE_STRUCTURED_ORIGIN_HEADER_COLUMNS)); prove(authority.assertion); prove(schemaAssertion);
  if (env.DB !== db || input.now !== now) throw new Error("memory-structured-origin-cleanup-changed");
  structuredOriginFreezeQueries(statements); Object.freeze(assertionIndexes);
  let acknowledged = false;
  return Object.freeze({ statements, workUnits: 1 as const, oldest: String(target.oldest), selectionKey: String(target.origin_id), assertionIndexes, acknowledge(results: readonly unknown[]) {
    if (acknowledged) return false; acknowledged = true;
    return env.DB === db && input.now === now && structuredOriginAcknowledged(results, statements.length, assertionIndexes, writes);
  } });
}
/** Eligible lifecycle units, not total held residue and not an erasure attestation. */
export async function nativeStructuredOriginRetentionBacklog(env: StructuredOriginLifecycleEnv, input: { now: string }): Promise<{ count: number; oldest: string | null }> {
  const db = env.DB, now = input.now;
  if (nativeMemoryTimestamp(now) === null) throw new Error("memory-structured-origin-cleanup-invalid");
  const schema = await nativeStructuredOriginSchema(env);
  if (!schema.present) {
    await structuredOriginVerifyReads(db, [structuredOriginAssertion(schema.guard.condition, schema.guard.bindings), structuredOriginAssertion(structuredOriginAbsentCondition)]);
    if (env.DB !== db || input.now !== now) throw new Error("memory-structured-origin-cleanup-changed"); return { count: 0, oldest: null };
  }
  const authority = await structuredOriginAuthoritySchema(env);
  const query = structuredOriginCandidates(now, authority.available), countQuery = { sql: `WITH pending AS (${query.sql}),work AS(
    SELECT pending.oldest,CASE WHEN pending.operation IN('mark','minimize') THEN 1
      WHEN pending.operation IN('answer-delete','manifest-delete') THEN
        (SELECT COUNT(*) FROM private_content body WHERE body.content_id IN(origin.answer_content_id,origin.manifest_content_ref)) ELSE
      CASE WHEN ${structuredOriginBodyPending("origin.answer_content_id")} AND ${structuredOriginAnswerEligible} THEN 1 ELSE 0 END
      +CASE WHEN ${structuredOriginBodyPending("origin.manifest_content_ref")} AND ${structuredOriginManifestEligible} THEN 1 ELSE 0 END
      +CASE WHEN ${structuredOriginBodiesCleared} AND ${structuredOriginDependenciesUnheld} THEN
        (SELECT COUNT(*) FROM ${structuredOriginalTable} dependency WHERE dependency.origin_id=origin.origin_id)
        +(SELECT COUNT(*) FROM ${structuredOriginRevisionTable} dependency WHERE dependency.origin_id=origin.origin_id) ELSE 0 END END AS units
    FROM pending JOIN ${structuredOriginTable} origin ON origin.origin_id=pending.origin_id)
    SELECT COALESCE(SUM(units),0) AS count,MIN(oldest) AS oldest FROM work`, bindings: query.bindings };
  const strayQuery = { sql: `SELECT CASE WHEN ${structuredOriginResidue()} THEN 1 ELSE 0 END AS stray`, bindings: [] };
  // Capture both complete predicates in one transaction without one oversized SQL statement.
  const results = structuredClone(await db.batch([countQuery, strayQuery].map(value => db.prepare(value.sql).bind(...value.bindings))));
  if (!Array.isArray(results) || results.length !== 2) throw new Error("memory-structured-origin-cleanup-unavailable");
  const rows = structuredOriginRows(results[0], ["count", "oldest"]), strayRows = structuredOriginRows(results[1], ["stray"]);
  if (env.DB !== db || input.now !== now || rows.length !== 1 || strayRows.length !== 1 || strayRows[0].stray !== 0
    || typeof rows[0].count !== "number" || rows[0].count < 0
    || rows[0].oldest !== null && nativeMemoryTimestamp(rows[0].oldest) === null) throw new Error("memory-structured-origin-cleanup-unavailable");
  await structuredOriginVerifyReads(db, [structuredOriginAssertion(schema.guard.condition, schema.guard.bindings), authority.assertion,
    structuredOriginExact(countQuery, rows, ["count", "oldest"]), structuredOriginExact(strayQuery, strayRows, ["stray"])]);
  if (env.DB !== db || input.now !== now) throw new Error("memory-structured-origin-cleanup-changed");
  return { count: rows[0].count, oldest: rows[0].oldest as string | null };
}


const jobOriginTable="memory_document_job_answer_origins",jobOriginDependencies="memory_document_job_origin_dependencies";
const jobOriginSelectorColumns=["origin_id","resource_kind","resource_id"] as const;
const jobOriginTombstoneColumns=["origin_id","schema_version","recipe_version","actor_user_id","scope_key","job_id","turn_id",
  "user_event_id","user_content_id","answer_event_id","answer_content_id","manifest_content_ref","status","withdrawn_at","withdrawal_reason"] as const;
const jobOriginAbsentCondition=`NOT EXISTS(SELECT 1 FROM private_content WHERE kind='memory-document-job-origin')
  AND NOT EXISTS(SELECT 1 FROM events event WHERE event.type='AssistantReasoned' AND CASE WHEN json_valid(event.payload)
    THEN json_extract(event.payload,'$.memory_origin_version') IS 3 ELSE 0 END)`;
const jobOriginMinimizedIntact=`NOT EXISTS(SELECT 1 FROM ${jobOriginTable} origin WHERE origin.status='minimized' AND
  (EXISTS(SELECT 1 FROM private_content body WHERE body.content_id IN(origin.answer_content_id,origin.manifest_content_ref))
  OR EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='content'
    AND resource.resource_id IN(origin.answer_content_id,origin.manifest_content_ref))
  OR EXISTS(SELECT 1 FROM private_content_retention_scopes retention WHERE retention.content_id IN(origin.answer_content_id,origin.manifest_content_ref))
  OR EXISTS(SELECT 1 FROM ${jobOriginDependencies} dependency WHERE dependency.origin_id=origin.origin_id)))`;
function jobOriginRows(result:unknown,columns:readonly string[]):StructuredOriginLifecycleRow[] {
  if(!structuredOriginEnvelope(result)||Array.from({length:result.results.length},(_,index)=>index)
    .some(index=>!Object.hasOwn(result.results,index)))throw new Error("memory-document-job-origin-withdrawal-unavailable");
  return structuredOriginRows(result,columns);
}
function jobOriginScope(row:StructuredOriginLifecycleRow):string[]|null {
  try {
    if(typeof row.scope_key!=="string")return null;
    const scope:unknown=JSON.parse(row.scope_key);
    return Array.isArray(scope)&&scope.length===4&&scope.every(value=>typeof value==="string"&&value.isWellFormed()&&value.length<=240)
      &&scope[2]&&scope[3]&&Boolean(scope[0])===Boolean(scope[1])&&JSON.stringify(scope)===row.scope_key?scope:null;
  }catch{return null;}
}
function jobOriginTombstone(row:StructuredOriginLifecycleRow,columns:readonly string[]):boolean {
  return row.status==="minimized"&&row.schema_version===1&&row.recipe_version==="native-document-job-answer-origin-v1"
    &&jobOriginScope(row)!==null&&nativeMemoryTimestamp(row.withdrawn_at)!==null&&reasons.has(row.withdrawal_reason as NativeMemoryOriginWithdrawalReason)
    &&jobOriginTombstoneColumns.filter(column=>!["schema_version","recipe_version","scope_key","status","withdrawn_at","withdrawal_reason"].includes(column))
      .every(column=>id(row[column]))
    &&new Set([row.user_event_id,row.answer_event_id,row.user_content_id,row.answer_content_id,row.manifest_content_ref]).size===5
    &&columns.every(column=>jobOriginTombstoneColumns.some(retained=>retained===column)||row[column]===null);
}
/** Comparison metadata for cleanup ownership only: never recall/read authority.
 * Exact full registry, manifest and retirement-progress facts accompany the
 * projection; a marker or copied row alone cannot suppress an orphan. */
export type NativeDocumentJobOriginCleanupCoverage=Readonly<{
  rows:readonly Readonly<StructuredOriginLifecycleRow>[];assertions:readonly NativeMemoryOriginQuery[];
}>;
const jobOriginCleanupColumns=["origin_id","actor_user_id","scope_key","status","enrollment_id","enrollment_revision",
  "stream_id","source_head","job_id","turn_id","user_event_id","answer_event_id","answer_content_id","manifest_content_ref"] as const;
function jobOriginCleanupCoverage(headers:readonly StructuredOriginLifecycleRow[],assertions:NativeMemoryOriginQuery[]):NativeDocumentJobOriginCleanupCoverage {
  const rows=headers.map(header=>Object.freeze(Object.fromEntries(jobOriginCleanupColumns.map(column=>[column,header[column]]))));
  structuredOriginFreezeQueries(assertions);return Object.freeze({rows:Object.freeze(rows),assertions});
}
async function jobOriginCompareRegistered(env:StructuredOriginLifecycleEnv,headers:StructuredOriginLifecycleRow[],
  dependenciesByOrigin:Map<string,StructuredOriginLifecycleRow[]>,progress:Awaited<ReturnType<typeof jobRetirementProgressSnapshot>>,
  now:string,current:()=>boolean) {
  const db=env.DB,{DOCUMENT_JOB_ORIGIN_HEADER_COLUMNS:columns,validateDocumentJobOriginRecord}=await import("./memory-document-job-origin-record.ts");
  if(!current())throw new Error("memory-document-job-origin-coverage-changed");
    const manifests=new Map<string,import("./memory-document-job-origin-manifest.ts").DocumentJobOriginManifest>();
    const manifestAssertions:NativeMemoryOriginQuery[]=[];
    for(const header of headers){
      const dependencies=dependenciesByOrigin.get(String(header.origin_id))!;
      // Already-negative progress preserves complete discovery after its explicit
      // cursor advances; a missing live selector/manifest without this row still denies.
      if(progress.evidenceById.has(String(header.origin_id))){
        manifestAssertions.push(...jobRetirementDerivedProof(progress.evidenceById.get(String(header.origin_id))!,progress.rowById.get(String(header.origin_id))!));
        continue;
      }
      if(header.status==="minimized"){
        if(!jobOriginTombstone(header,columns)||dependencies.length)return null;
        continue;
      }
      if(!["active","withdrawn"].includes(String(header.status))||nativeMemoryTimestamp(header.created_at)===null||String(header.created_at)>now
        ||header.status==="withdrawn"&&(nativeMemoryTimestamp(header.withdrawn_at)===null||String(header.withdrawn_at)>now
          ||String(header.withdrawn_at)<String(header.created_at)||!reasons.has(header.withdrawal_reason as NativeMemoryOriginWithdrawalReason)))return null;
      const query={sql:"SELECT content_id,owner_id,kind,CASE WHEN length(CAST(content AS BLOB))<=65536 THEN content ELSE NULL END AS content,created_at,expires_at,redacted_at FROM private_content WHERE content_id=?",bindings:[header.manifest_content_ref]};
      const result=structuredClone(await db.prepare(query.sql).bind(...query.bindings).all());if(!current())return null;
      if(!structuredOriginEnvelope(result)||result.results.length!==1||!Object.hasOwn(result.results,0))return null;
      const body=result.results[0] as StructuredOriginLifecycleRow;
      if(!body||typeof body!=="object"||Array.isArray(body)||!exactKeys(body,["content_id","owner_id","kind","content","created_at","expires_at","redacted_at"])
        ||body.content_id!==header.manifest_content_ref||body.owner_id!==header.actor_user_id||body.kind!=="memory-document-job-origin"
        ||typeof body.content!=="string"||body.content.length>65536||!body.content.isWellFormed()||new TextEncoder().encode(body.content).byteLength>65536
        ||nativeMemoryTimestamp(body.created_at)===null||String(body.created_at)>String(header.created_at)
        ||body.expires_at!==header.manifest_expires_at||body.redacted_at!==null)return null;
      // OR is active-only. This comparison-only copy restores just the immutable
      // publication shape for a separately validated withdrawn row; it is never
      // persisted, exposed as active, or used as present read authority.
      const publicationHeader=header.status==="active"?header:{...header,status:"active",withdrawn_at:null,withdrawal_reason:null};
      const record=await validateDocumentJobOriginRecord(publicationHeader,body.content,dependencies);
      if(!record||!current())return null;
      // An intact registration must still own its exact derivative, not merely
      // a manifest naming a missing, retyped, reowned or changed answer body.
      const answerQuery={sql:"SELECT content_id,owner_id,kind,CASE WHEN length(CAST(content AS BLOB))<=65536 THEN content ELSE NULL END AS content,created_at,expires_at,redacted_at FROM private_content WHERE content_id=?",bindings:[header.answer_content_id]};
      const answerResult=structuredClone(await db.prepare(answerQuery.sql).bind(...answerQuery.bindings).all());if(!current())return null;
      if(!structuredOriginEnvelope(answerResult)||answerResult.results.length!==1||!Object.hasOwn(answerResult.results,0))return null;
      const answer=answerResult.results[0] as StructuredOriginLifecycleRow;
      if(!answer||typeof answer!=="object"||Array.isArray(answer)||!exactKeys(answer,["content_id","owner_id","kind","content","created_at","expires_at","redacted_at"])
        ||answer.content_id!==header.answer_content_id||answer.owner_id!==header.actor_user_id||answer.kind!=="chat-assistant-memory"
        ||typeof answer.content!=="string"||answer.content.length>65536||!answer.content.isWellFormed()||bytes(answer.content).length>65536
        ||nativeMemoryTimestamp(answer.created_at)===null||String(answer.created_at)>String(header.created_at)
        ||answer.expires_at!==header.answer_expires_at||answer.redacted_at!==null
        ||await nativeMemoryAnswerFingerprint(answer.content)!==header.answer_sha256||!current())return null;
      manifestAssertions.push(structuredOriginExact(answerQuery,[answer],["content_id","owner_id","kind","content","created_at","expires_at","redacted_at"]));
      manifests.set(String(header.origin_id),JSON.parse(record.manifest.text) as import("./memory-document-job-origin-manifest.ts").DocumentJobOriginManifest);
      manifestAssertions.push(structuredOriginExact(query,[body],["content_id","owner_id","kind","content","created_at","expires_at","redacted_at"]));
    }
    // Registered non-minimized outputs require the actual native answer event,
    // even when a malformed/type-changed/missing event would escape a body JOIN.
    // Raw integer-v3 events also need a permanent registration independent of
    // body presence; leftover custody cannot masquerade as zero dependencies.
    const eventTuple=`event.event_id=origin.answer_event_id AND event.type='AssistantReasoned' AND event.actor='worker:memory' AND CASE WHEN json_valid(event.payload) THEN
      json_type(event.payload,'$.memory_origin_version')='integer' AND json_extract(event.payload,'$.memory_origin_version') IS 3
      AND json_extract(event.payload,'$.content_ref') IS origin.answer_content_id
      AND json_extract(event.payload,'$.job_id') IS origin.job_id AND json_extract(event.payload,'$.turn_id') IS origin.turn_id ELSE 0 END`;
    manifestAssertions.push(structuredOriginAssertion(`NOT EXISTS(SELECT 1 FROM ${jobOriginTable} origin WHERE origin.status!='minimized'
      AND NOT EXISTS(SELECT 1 FROM events event WHERE (${eventTuple}) AND event.stream_id=origin.stream_id AND event.sequence=origin.source_head+2))
      AND NOT EXISTS(SELECT 1 FROM events event WHERE event.type='AssistantReasoned' AND CASE WHEN json_valid(event.payload)
        THEN json_type(event.payload,'$.memory_origin_version')='integer' AND json_extract(event.payload,'$.memory_origin_version') IS 3 ELSE 0 END
        AND NOT EXISTS(SELECT 1 FROM ${jobOriginTable} origin WHERE (${eventTuple})
          AND (origin.status='minimized' OR event.stream_id=origin.stream_id AND event.sequence=origin.source_head+2)))`));
    // A dedicated private manifest with no exact registration is not evidence of
    // zero job dependencies. Header/body ownership must remain discoverable.
    manifestAssertions.push(structuredOriginAssertion(`NOT EXISTS(SELECT 1 FROM private_content body
      WHERE body.kind='memory-document-job-origin' AND NOT EXISTS(SELECT 1 FROM ${jobOriginTable} origin
        WHERE origin.manifest_content_ref=body.content_id AND origin.actor_user_id=body.owner_id))`));
    return {manifests,manifestAssertions};
}
/** Strict current persisted comparison snapshot for the existing privacy-status
 * owner. It issues no mutation, caller capability or permission to read prose. */
export async function readNativeDocumentJobOriginCleanupCoverage(env:StructuredOriginLifecycleEnv,now:string):Promise<NativeDocumentJobOriginCleanupCoverage|null> {
  try {
    const db=env.DB,current=()=>env.DB===db;
    if(nativeMemoryTimestamp(now)===null)return null;
    const {nativeDocumentJobOriginSchema}=await import("./memory-document-job-origin-schema.ts");if(!current())return null;
    const schema=await nativeDocumentJobOriginSchema(env);if(!current())return null;
    const schemaAssertion=structuredOriginAssertion(schema.guard.condition,[...schema.guard.bindings]);
    if(!schema.present){
      const progress=await jobRetirementProgressSnapshot(env,[],[],[]);if(!current()||progress.present)return null;
      const assertions=[schemaAssertion,structuredOriginAssertion(jobOriginAbsentCondition),...progress.assertions];
      await structuredOriginVerifyReads(db,assertions);return current()?jobOriginCleanupCoverage([],assertions):null;
    }
    const {DOCUMENT_JOB_ORIGIN_HEADER_COLUMNS:columns}=await import("./memory-document-job-origin-record.ts");if(!current())return null;
    const authority=await structuredOriginAuthoritySchema(env);if(!current())return null;
    const headerQuery={sql:`SELECT ${columns.join(",")} FROM ${jobOriginTable} ORDER BY origin_id`,bindings:[]};
    const indexQuery={sql:`SELECT ${jobOriginSelectorColumns.join(",")} FROM ${jobOriginDependencies} ORDER BY origin_id,resource_kind,resource_id`,bindings:[]};
    const headers=jobOriginRows(structuredClone(await db.prepare(headerQuery.sql).all()),columns);if(!current())return null;
    const stored=jobOriginRows(structuredClone(await db.prepare(indexQuery.sql).all()),jobOriginSelectorColumns);if(!current())return null;
    const progress=await jobRetirementProgressSnapshot(env,headers,stored,columns);
    if(!current()||progress.rows.some(row=>String(row.updated_at)>now))return null;
    const dependenciesByOrigin=new Map(headers.map(header=>[String(header.origin_id),[] as StructuredOriginLifecycleRow[]]));
    if(dependenciesByOrigin.size!==headers.length||progress.selectors.some(row=>!dependenciesByOrigin.has(String(row.origin_id))))return null;
    for(const row of progress.selectors)dependenciesByOrigin.get(String(row.origin_id))!.push(row);
    const compared=await jobOriginCompareRegistered(env,headers,dependenciesByOrigin,progress,now,current);if(!compared||!current())return null;
    const assertions=[schemaAssertion,authority.assertion,structuredOriginExact(headerQuery,headers,columns),
      structuredOriginExact(indexQuery,stored,jobOriginSelectorColumns),structuredOriginAssertion(jobOriginMinimizedIntact),
      ...progress.assertions,...compared.manifestAssertions];
    await structuredOriginVerifyReads(db,assertions);return current()?jobOriginCleanupCoverage(headers,assertions):null;
  }catch{return null;}
}
/** Negative provenance only, using the existing direct-withdrawal owner contract.
 * Complete registry/index discovery is deliberately not recall-capped. A missing
 * or corrupt manifest/index rejects preparation; it never proves no dependency.
 * No private body, selector, hold, retention or tombstone metadata is erased here. */
export async function prepareNativeDocumentJobOriginWithdrawal(env:StructuredOriginLifecycleEnv,
  selectorInput:NativeStructuredOriginWithdrawalSelector,reason:NativeMemoryOriginWithdrawalReason,now:string) {
  return prepareDocumentJobOriginWithdrawal(env,selectorInput,reason,now,false);
}
/** A confirmed erasure owner's non-destructive bookend. The existing inverse is
 * issued once, and complete genuine retirement evidence is saved before any
 * authored source can be erased. Initialization is explicit bookkeeping. */
export async function prepareNativeDocumentJobOriginErasureBarrier(env:StructuredOriginLifecycleEnv,
  selectorInput:NativeStructuredOriginWithdrawalSelector,now:string) {
  if(!selectorInput||typeof selectorInput!=="object"||Array.isArray(selectorInput)
    ||!("actorUserId" in selectorInput||"organizationId" in selectorInput))return null;
  return prepareDocumentJobOriginWithdrawal(env,selectorInput,"erased",now,true);
}
async function prepareDocumentJobOriginWithdrawal(env:StructuredOriginLifecycleEnv,
  selectorInput:NativeStructuredOriginWithdrawalSelector,reason:NativeMemoryOriginWithdrawalReason,now:string,initializeErasure:boolean):Promise<null|{
    statements:NativeMemoryOriginQuery[];assertionIndexes:number[];terminalAssertions:NativeMemoryOriginQuery[];
    pendingOrigins:number;initializedOrigins:number;bookkeepingWrites:number;initialCoverage:NativeDocumentJobOriginCleanupCoverage;terminalCoverage:NativeDocumentJobOriginCleanupCoverage;
    acknowledge(results:readonly unknown[]):boolean;
  }> {
  try {
    const db=env.DB,selected=structuredClone(selectorInput),key=JSON.stringify(selected);
    const current=()=>env.DB===db&&JSON.stringify(selectorInput)===key;
    if(!structuredOriginSelection(selected,new Set())||"unavailableDependencies" in selected
      ||!reasons.has(reason)||nativeMemoryTimestamp(now)===null)return null;
    const {nativeDocumentJobOriginSchema}=await import("./memory-document-job-origin-schema.ts");
    if(!current())return null;
    const schema=await nativeDocumentJobOriginSchema(env);if(!current())return null;
    const schemaAssertion=structuredOriginAssertion(schema.guard.condition,[...schema.guard.bindings]);
    if(!schema.present){
      const retirement=await jobRetirementProgressSnapshot(env,[],[],[]);
      if(!current()||retirement.present)return null;
      const absent=structuredOriginAssertion(jobOriginAbsentCondition),statements=[schemaAssertion,absent,...retirement.assertions],
        assertionIndexes=statements.map((_,index)=>index);
      await structuredOriginVerifyReads(db,statements);if(!current())return null;
      structuredOriginFreezeQueries(statements);Object.freeze(assertionIndexes);
      const coverage=jobOriginCleanupCoverage([],statements);let consumed=false;
      return Object.freeze({statements,assertionIndexes,terminalAssertions:statements,pendingOrigins:0,initializedOrigins:0,bookkeepingWrites:0,
        initialCoverage:coverage,terminalCoverage:coverage,acknowledge(results:readonly unknown[]){
        if(consumed)return false;consumed=true;
        if(initializeErasure){
          if(!current())return false;
          const safe=jobRetirementReceiptData(results,statements.length,[]);
          return safe!==null&&structuredOriginAcknowledged(safe,statements.length,assertionIndexes,[])&&current();
        }
        return current()&&Array.isArray(results)&&results.length===statements.length&&assertionIndexes.every(index=>Object.hasOwn(results,index))
          &&assertionIndexes.every(index=>structuredOriginEnvelope(results[index])&&Object.hasOwn((results[index] as {results:unknown[]}).results,0))
          &&structuredOriginAcknowledged(results,statements.length,assertionIndexes,[]);
      }});
    }
    const {DOCUMENT_JOB_ORIGIN_HEADER_COLUMNS:columns}=await import("./memory-document-job-origin-record.ts");
    if(!current())return null;
    const authority=await structuredOriginAuthoritySchema(env);if(!current())return null;
    let revision:NativeMemoryOriginQuery={sql:"1",bindings:[]};
    if("currentRevision" in selected)revision=authority.available.has("memory_live_enrollments")
      ?{sql:"EXISTS(SELECT 1 FROM memory_live_enrollments WHERE enrollment_id=? AND revision=?)",bindings:[selected.enrollmentId,selected.currentRevision]}
      :{sql:"0",bindings:[]};
    if("currentStorageRevision" in selected)revision=authority.available.has("memory_structured_conversation_heads")
      ?{sql:"EXISTS(SELECT 1 FROM memory_structured_conversation_heads WHERE ledger_id=? AND storage_revision=?)",bindings:[selected.ledgerId,selected.currentStorageRevision]}
      :{sql:"0",bindings:[]};
    const revisionAssertion=structuredOriginAssertion(revision.sql,revision.bindings);
    await structuredOriginVerifyReads(db,[schemaAssertion,authority.assertion,revisionAssertion]);if(!current())return null;
    const headerQuery={sql:`SELECT ${columns.join(",")} FROM ${jobOriginTable} ORDER BY origin_id`,bindings:[]};
    const indexQuery={sql:`SELECT ${jobOriginSelectorColumns.join(",")} FROM ${jobOriginDependencies} ORDER BY origin_id,resource_kind,resource_id`,bindings:[]};
    const headers=jobOriginRows(structuredClone(await db.prepare(headerQuery.sql).all()),columns);if(!current())return null;
    const storedSelectors=jobOriginRows(structuredClone(await db.prepare(indexQuery.sql).all()),jobOriginSelectorColumns);if(!current())return null;
    const progress=await jobRetirementProgressSnapshot(env,headers,storedSelectors,columns);if(!current())return null;
    const selectors=progress.selectors;
    const headerById=new Map(headers.map(row=>[String(row.origin_id),row]));
    if(headerById.size!==headers.length||selectors.some(row=>!headerById.has(String(row.origin_id))))return null;
    const dependenciesByOrigin=new Map(headers.map(row=>[String(row.origin_id),[] as StructuredOriginLifecycleRow[]]));
    const consumers=new Map<string,Set<string>>();
    const register=(kind:string,ref:unknown,originId:string)=>{
      if(typeof ref!=="string")return;
      const key=JSON.stringify([kind,ref]),ids=consumers.get(key)??new Set<string>();ids.add(originId);consumers.set(key,ids);
    };
    for(const row of selectors){dependenciesByOrigin.get(String(row.origin_id))!.push(row);register(String(row.resource_kind),row.resource_id,String(row.origin_id));}
    for(const row of headers){
      for(const ref of [row.user_event_id,row.answer_event_id])register("event",ref,String(row.origin_id));
      for(const ref of [row.input_content_ref,row.user_content_id,row.answer_content_id,row.manifest_content_ref])register("private-content",ref,String(row.origin_id));
    }
    const compared=await jobOriginCompareRegistered(env,headers,dependenciesByOrigin,progress,now,current);
    if(!compared||!current())return null;
    const {manifests,manifestAssertions}=compared;
    const has=(header:StructuredOriginLifecycleRow,kind:string,ref:string)=>dependenciesByOrigin.get(String(header.origin_id))!
      .some(row=>row.resource_kind===kind&&row.resource_id===ref);
    const references=(header:StructuredOriginLifecycleRow,kind:string,ref:string)=>kind==="event"
      ?header.user_event_id===ref||header.answer_event_id===ref||has(header,kind,ref)
      :kind==="private-content"?[header.input_content_ref,header.user_content_id,header.answer_content_id,header.manifest_content_ref].includes(ref)||has(header,kind,ref)
      :has(header,kind,ref);
    if("eventId" in selected&&headers.some(header=>header.status==="minimized"
      &&(header.user_event_id===selected.eventId||header.answer_event_id===selected.eventId)))return null;
    const matches=(header:StructuredOriginLifecycleRow)=>{
      if("originId" in selected)return header.origin_id===selected.originId;
      if("actorUserId" in selected)return header.actor_user_id===selected.actorUserId&&(!selected.personalOnly||jobOriginScope(header)?.[0]==="");
      if("organizationId" in selected)return jobOriginScope(header)?.[0]===selected.organizationId;
      if("enrollmentId" in selected)return header.enrollment_id===selected.enrollmentId||has(header,"enrollment",selected.enrollmentId);
      if("eventId" in selected)return header.stream_id===selected.eventStreamId&&references(header,"event",selected.eventId);
      if("contentId" in selected)return references(header,"private-content",selected.contentId);
      if("ledgerBodyRef" in selected)return references(header,"private-content",selected.ledgerBodyRef);
      const manifest=manifests.get(String(header.origin_id)),saved=progress.evidenceById.get(String(header.origin_id));
      const ledgerHead=saved?saved.ledgerHead:manifest?.mode==="structured"?manifest.ledgerHead:null;
      return has(header,"ledger",selected.ledgerId)&&(!("currentStorageRevision" in selected)
        ||ledgerHead!==null&&ledgerHead.revision!==selected.currentStorageRevision);
    };
    const affected=new Set(headers.filter(matches).map(header=>String(header.origin_id)));
    // Include every consumer of a selected origin's fixed output identities. The
    // original input is not an output and cannot widen this closure upstream.
    const queue=[...affected];
    for(let cursor=0;cursor<queue.length;cursor++){
      const source=headerById.get(queue[cursor])!;
      const outputs:[[string,unknown],[string,unknown],[string,unknown],[string,unknown],[string,unknown]]=[
        ["event",source.user_event_id],["event",source.answer_event_id],["private-content",source.user_content_id],
        ["private-content",source.answer_content_id],["private-content",source.manifest_content_ref]];
      for(const [kind,ref] of outputs)for(const target of consumers.get(JSON.stringify([kind,ref]))??[]){
        if(!affected.has(target)){affected.add(target);queue.push(target);}
      }
    }
    const terminal=headers.map(header=>affected.has(String(header.origin_id))&&header.status==="active"
      ?{...header,status:"withdrawn",withdrawn_at:now,withdrawal_reason:reason}:header);
    const selectedIds=JSON.stringify([...affected].sort()),changes=terminal.filter((header,index)=>header!==headers[index]).length;
    const initialHeaders=structuredOriginExact(headerQuery,headers,columns),finalHeaders=structuredOriginExact(headerQuery,terminal,columns);
    const exactIndex=structuredOriginExact(indexQuery,storedSelectors,jobOriginSelectorColumns),intact=structuredOriginAssertion(jobOriginMinimizedIntact);
    const initialized:Awaited<ReturnType<typeof jobRetirementInitialize>>[]=[];
    const support=initializeErasure?await jobRetirementSupportSchema(env):null;if(!current())return null;
    if(initializeErasure){
      for(const header of terminal){
        const originId=String(header.origin_id);
        if(!affected.has(originId)||header.status==="minimized"||progress.evidenceById.has(originId))continue;
        if(!progress.present)return null;
        const manifest=manifests.get(originId);if(!manifest)return null;
        const initial=await jobRetirementInitialize(env,header,dependenciesByOrigin.get(originId)!,manifest,now,current);
        if(!current()||!await jobRetirementEvidence(initial.row,header,columns)||!current())return null;
        initialized.push(initial);
      }
    }
    const terminalProgress=[...progress.rows,...initialized.map(initial=>initial.row)];
    const finalProgress=initializeErasure&&progress.present
      ?[progress.assertions[0],structuredOriginExact(progress.query,terminalProgress,jobRetirementColumns)]:progress.assertions;
    const before=[schemaAssertion,authority.assertion,revisionAssertion,initialHeaders,exactIndex,intact,...progress.assertions,
      ...(support?[support]:[]),...manifestAssertions,...initialized.flatMap(initial=>initial.assertions)];
    const terminalAssertions=[finalHeaders,exactIndex,intact,schemaAssertion,...finalProgress,...(support?[support]:[])];
    const statements:NativeMemoryOriginQuery[]=[...before],writes:{index:number;changes:number}[]=[];
    const write=(query:NativeMemoryOriginQuery,count:number)=>{writes.push({index:statements.length,changes:count});
      statements.push(query,structuredOriginAssertion("changes()=?",[count]));};
    write({sql:`UPDATE ${jobOriginTable} SET status='withdrawn',withdrawn_at=?,withdrawal_reason=?
      WHERE status='active' AND origin_id IN(SELECT value FROM json_each(?))`,bindings:[now,reason,selectedIds]},changes);
    for(const initial of initialized)write({sql:`INSERT INTO ${jobRetirementTable}(${jobRetirementColumns.join(",")})
      VALUES(${jobRetirementColumns.map(()=>"?").join(",")})`,bindings:jobRetirementColumns.map(column=>initial.row[column])},1);
    statements.push(...terminalAssertions,authority.assertion);
    const writeIndex=before.length,assertionIndexes=statements.map((_,index)=>index).filter(index=>!writes.some(write=>write.index===index));
    await structuredOriginVerifyReads(db,before);if(!current())return null;
    structuredOriginFreezeQueries(statements);structuredOriginFreezeQueries(terminalAssertions);Object.freeze(assertionIndexes);
    const initialCoverage=jobOriginCleanupCoverage(headers,[schemaAssertion,authority.assertion,initialHeaders,exactIndex,intact,...progress.assertions,...manifestAssertions]);
    const terminalCoverage=jobOriginCleanupCoverage(terminal,[...terminalAssertions,authority.assertion,...manifestAssertions]);
    let consumed=false;
    return Object.freeze({statements,assertionIndexes,terminalAssertions,initialCoverage,terminalCoverage,
      initializedOrigins:initialized.length,bookkeepingWrites:writes.length,
      pendingOrigins:terminal.filter(header=>affected.has(String(header.origin_id))&&header.status!=="minimized").length,
      acknowledge(results:readonly unknown[]){
        if(consumed)return false;consumed=true;
        if(initializeErasure){
          if(!current())return false;
          const safe=jobRetirementReceiptData(results,statements.length,writes);
          return safe!==null&&structuredOriginAcknowledged(safe,statements.length,assertionIndexes,writes)&&current();
        }
        return current()&&Array.isArray(results)&&results.length===statements.length
          &&Array.from({length:results.length},(_,index)=>index).every(index=>Object.hasOwn(results,index)&&structuredOriginEnvelope(results[index]))
          &&(results[writeIndex] as {results:unknown[]}).results.length===0
          &&assertionIndexes.every(index=>Object.hasOwn((results[index] as {results:unknown[]}).results,0))
          &&structuredOriginAcknowledged(results,statements.length,assertionIndexes,[{index:writeIndex,changes}]);
      }});
  }catch{return null;}
}

const jobRetirementTable="memory_document_job_origin_retirement_progress";
const jobRetirementColumns=["origin_id","schema_version","evidence_json","evidence_sha256","selector_count","selector_cursor",
  "phase","revision","answer_redacted_at","manifest_redacted_at","created_at","updated_at"] as const;
type JobRetirementEvidence={header:StructuredOriginLifecycleRow;header_sha256:string;
  selectors:{resource_kind:string;resource_id:string}[];ledgerHead:null|{ledgerId:string;revision:number;bodyRef:string;bodyHash:string};
  derived:StructuredOriginLifecycleRow[];custody:{content_id:string;resource:StructuredOriginLifecycleRow[];retention:StructuredOriginLifecycleRow[]}[]};
const jobRetirementBodyColumns=["content_id","owner_id","kind","created_at","expires_at","redacted_at"] as const;
function jobRetirementText(value:unknown):string {
  const own=(input:unknown,depth:number):unknown=>{
    if(depth>8)throw new Error("memory-document-job-retirement-invalid");
    if(input===null||typeof input==="number"&&Number.isSafeInteger(input))return input;
    if(typeof input==="string"&&input.length<=65536&&input.isWellFormed())return input;
    if(!input||typeof input!=="object")throw new Error("memory-document-job-retirement-invalid");
    if(Array.isArray(input)){
      const length=Object.getOwnPropertyDescriptor(input,"length");
      if(!length||!Number.isSafeInteger(length.value)||length.value<0||length.value>1024)throw new Error("memory-document-job-retirement-invalid");
      const descriptors=Object.getOwnPropertyDescriptors(input);
      if(Reflect.ownKeys(descriptors).length!==length.value+1)throw new Error("memory-document-job-retirement-invalid");
      return Array.from({length:length.value},(_,index)=>{
        const item=descriptors[index];if(!item||!("value" in item)||!item.enumerable)throw new Error("memory-document-job-retirement-invalid");
        return own(item.value,depth+1);
      });
    }
    if(![Object.prototype,null].includes(Object.getPrototypeOf(input)))throw new Error("memory-document-job-retirement-invalid");
    const descriptors=Object.getOwnPropertyDescriptors(input),keys=Reflect.ownKeys(descriptors);
    if(keys.length>64||keys.some(key=>typeof key!=="string"))throw new Error("memory-document-job-retirement-invalid");
    return Object.fromEntries((keys as string[]).sort().map(key=>{
      const descriptor=descriptors[key];if(!descriptor.enumerable||!("value" in descriptor))throw new Error("memory-document-job-retirement-invalid");
      return [key,own(descriptor.value,depth+1)];
    }));
  };
  const text=JSON.stringify(own(value,0));if(bytes(text).length>524288)throw new Error("memory-document-job-retirement-invalid");return text;
}
function jobRetirementRows(result:unknown):StructuredOriginLifecycleRow[] {
  if(!structuredOriginEnvelope(result)||Array.from({length:result.results.length},(_,i)=>i).some(i=>!Object.hasOwn(result.results,i)))
    throw new Error("memory-document-job-retirement-unavailable");
  return result.results.map(row=>{
    if(!row||typeof row!=="object"||Array.isArray(row)||!exactKeys(row,jobRetirementColumns)
      ||Object.entries(row).some(([key,value])=>value!==null&&!(typeof value==="number"&&Number.isSafeInteger(value))
        &&!(typeof value==="string"&&value.length<=(key==="evidence_json"?524288:1024)&&value.isWellFormed())))
      throw new Error("memory-document-job-retirement-unavailable");
    return row as StructuredOriginLifecycleRow;
  });
}
async function jobRetirementEvidence(row:StructuredOriginLifecycleRow,header:StructuredOriginLifecycleRow,columns:readonly string[]):Promise<JobRetirementEvidence|null> {
  try {
    if(row.origin_id!==header.origin_id||header.status!=="withdrawn"||row.schema_version!==1
      ||nativeMemoryTimestamp(header.withdrawn_at)===null||nativeMemoryTimestamp(header.created_at)===null
      ||String(header.withdrawn_at)<String(header.created_at)||!reasons.has(header.withdrawal_reason as NativeMemoryOriginWithdrawalReason)
      ||typeof row.evidence_json!=="string"||row.evidence_json.length>524288||bytes(row.evidence_json).length>524288
      ||!digest(row.evidence_sha256)||nativeMemoryTimestamp(row.created_at)===null||nativeMemoryTimestamp(row.updated_at)===null
      ||String(row.created_at)<String(header.withdrawn_at)||String(row.updated_at)<String(row.created_at))return null;
    const evidence=JSON.parse(row.evidence_json) as JobRetirementEvidence;
    if(!evidence||typeof evidence!=="object"||Array.isArray(evidence)||!exactKeys(evidence,["header","header_sha256","selectors","ledgerHead","derived","custody"])
      ||jobRetirementText(evidence)!==row.evidence_json||await hash(bytes(row.evidence_json))!==row.evidence_sha256
      ||!evidence.header||!exactKeys(evidence.header,columns)||columns.some(column=>evidence.header[column]!==header[column])
      ||await hash(bytes(jobRetirementText(evidence.header)))!==evidence.header_sha256||!jobOriginScope(header))return null;
    const selectors=evidence.selectors;
    if(!Array.isArray(selectors)||selectors.length<1||selectors.length>513||selectors.length!==row.selector_count
      ||selectors.length!==header.selector_count||selectors.some(item=>!item||!exactKeys(item,["resource_kind","resource_id"])
        ||!["event","private-content","ledger","enrollment"].includes(item.resource_kind)||!id(item.resource_id))
      ||new Set(selectors.map(item=>JSON.stringify([item.resource_kind,item.resource_id]))).size!==selectors.length
      ||selectors.some((item,index)=>index>0&&JSON.stringify([selectors[index-1].resource_kind,selectors[index-1].resource_id])>=JSON.stringify([item.resource_kind,item.resource_id]))
      ||await hash(bytes(JSON.stringify(selectors.map(item=>({resource_kind:item.resource_kind,resource_id:item.resource_id})))))!==header.selector_list_sha256)return null;
    if(evidence.ledgerHead!==null&&(!exactKeys(evidence.ledgerHead,["ledgerId","revision","bodyRef","bodyHash"])
      ||!id(evidence.ledgerHead.ledgerId)||!positive(evidence.ledgerHead.revision)||!id(evidence.ledgerHead.bodyRef)||!digest(evidence.ledgerHead.bodyHash)))return null;
    if((header.mode==="structured")!==(evidence.ledgerHead!==null))return null;
    if(!Array.isArray(evidence.derived)||evidence.derived.length!==2)return null;
    for(const [index,body] of evidence.derived.entries()){
      if(!body||!exactKeys(body,jobRetirementBodyColumns)||body.content_id!==(index?header.manifest_content_ref:header.answer_content_id)
        ||body.owner_id!==header.actor_user_id||body.kind!==(index?"memory-document-job-origin":"chat-assistant-memory")||body.redacted_at!==null
        ||nativeMemoryTimestamp(body.created_at)===null||String(body.created_at)>String(header.created_at)
        ||body.expires_at!==(index?header.manifest_expires_at:header.answer_expires_at))return null;
    }
    const refs=[...new Set([header.input_content_ref,header.user_content_id,header.answer_content_id,header.manifest_content_ref,
      ...selectors.filter(item=>item.resource_kind==="private-content").map(item=>item.resource_id)])].sort();
    if(!Array.isArray(evidence.custody)||evidence.custody.length!==refs.length||refs.length>517)return null;
    for(const [index,group] of evidence.custody.entries()){
      if(!group||!exactKeys(group,["content_id","resource","retention"])||group.content_id!==refs[index]
        ||!Array.isArray(group.resource)||!Array.isArray(group.retention)||group.resource.length>1||group.retention.length>1)return null;
      for(const [rows,names] of [[group.resource,structuredOriginResourceColumns],[group.retention,structuredOriginRetentionColumns]] as const){
        if(rows.some(item=>!item||!exactKeys(item,names)||Object.values(item).some(value=>value!==null
          &&!(typeof value==="number"&&Number.isSafeInteger(value))&&!(typeof value==="string"&&value.length<=1024&&value.isWellFormed()))))return null;
      }
      if(group.resource.some(item=>item.resource_id!==group.content_id||item.resource_kind!=="content"||!id(item.organization_id)||!id(item.project_access_id))
        ||group.retention.some(item=>item.content_id!==group.content_id||!id(item.organization_id)||!id(item.project_access_id)))return null;
    }
    const cursor=row.selector_cursor,count=selectors.length,revision=row.revision;
    if(!(Number.isSafeInteger(cursor)&&Number(cursor)>=0)||Number(cursor)>count||!(Number.isSafeInteger(revision)&&Number(revision)>=0)||Number(revision)>517)return null;
    const answer=row.answer_redacted_at,manifest=row.manifest_redacted_at;
    if(answer!==null&&(nativeMemoryTimestamp(answer)===null||String(answer)<String(row.created_at)||String(answer)>String(row.updated_at)))return null;
    if(manifest!==null&&(nativeMemoryTimestamp(manifest)===null||answer===null||String(manifest)<String(answer)||String(manifest)>String(row.updated_at)))return null;
    const valid=row.phase==="answer"&&revision===0&&cursor===0&&answer===null&&manifest===null
      ||row.phase==="manifest"&&revision===1&&cursor===0&&answer!==null&&manifest===null
      ||row.phase==="selectors"&&revision===2+Number(cursor)&&Number(cursor)<count&&answer!==null&&manifest!==null
      ||row.phase==="answer-delete"&&revision===2+count&&cursor===count&&answer!==null&&manifest!==null
      ||row.phase==="manifest-delete"&&revision===3+count&&cursor===count&&answer!==null&&manifest!==null
      ||row.phase==="finalize"&&revision===4+count&&cursor===count&&answer!==null&&manifest!==null;
    return valid?evidence:null;
  }catch{return null;}
}
function jobRetirementUnheld(evidence:JobRetirementEvidence):NativeMemoryOriginQuery {
  // The complete immutable scope inventory survives both manifest and selector
  // deletion. Constant-shape JSON joins avoid a 517-leaf AND/compound-SELECT chain.
  return {sql:`WITH saved AS(SELECT ? AS value),custody AS(SELECT item.value FROM saved,json_each(saved.value,'$.custody') item),
    refs AS(SELECT json_extract(value,'$.content_id') AS ref FROM custody),
    old_scopes AS(SELECT json_extract(saved.value,'$.header.organization_id') AS organization_id,
      json_extract(saved.value,'$.header.project_access_id') AS project_access_id,refs.ref FROM saved,refs
      UNION ALL SELECT json_extract(resource.value,'$.organization_id'),json_extract(resource.value,'$.project_access_id'),
        json_extract(custody.value,'$.content_id') FROM custody,json_each(custody.value,'$.resource') resource
      UNION ALL SELECT json_extract(retention.value,'$.organization_id'),json_extract(retention.value,'$.project_access_id'),
        json_extract(custody.value,'$.content_id') FROM custody,json_each(custody.value,'$.retention') retention)
    SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM old_scopes old JOIN organization_legal_holds hold ON hold.organization_id=old.organization_id
      AND hold.status='active' WHERE hold.scope_kind='organization' OR hold.scope_kind='project' AND hold.resource_id=old.project_access_id
        OR hold.scope_kind='content' AND hold.resource_id=old.ref)
      AND NOT EXISTS(SELECT 1 FROM custody,json_each(custody.value,'$.retention') old JOIN organization_retention_policies policy
        ON policy.organization_id=json_extract(old.value,'$.organization_id') AND policy.legal_hold=1
        WHERE json_extract(old.value,'$.classification')='governed-evidence')
      AND NOT EXISTS(SELECT 1 FROM refs JOIN project_resource_scopes resource ON resource.resource_kind='content' AND resource.resource_id=refs.ref
        JOIN organization_legal_holds hold ON hold.organization_id=resource.organization_id AND hold.status='active'
        WHERE hold.scope_kind='organization' OR hold.scope_kind='project' AND hold.resource_id=resource.project_access_id
          OR hold.scope_kind='content' AND hold.resource_id=resource.resource_id)
      AND NOT EXISTS(SELECT 1 FROM refs JOIN private_content_retention_scopes governed ON governed.content_id=refs.ref
        JOIN organization_retention_policies policy ON policy.organization_id=governed.organization_id AND policy.legal_hold=1
        WHERE governed.classification='governed-evidence')
      AND NOT EXISTS(SELECT 1 FROM refs JOIN private_content_retention_scopes governed ON governed.content_id=refs.ref
        JOIN organization_legal_holds hold ON hold.organization_id=governed.organization_id AND hold.status='active'
        WHERE hold.scope_kind='organization' OR hold.scope_kind='project' AND hold.resource_id=governed.project_access_id
          OR hold.scope_kind='content' AND hold.resource_id=governed.content_id)
      THEN 1 ELSE json('memory_document_job_retirement_held') END AS verified`,bindings:[jobRetirementText(evidence)]};
}
async function jobRetirementProgressSnapshot(env:StructuredOriginLifecycleEnv,headers:StructuredOriginLifecycleRow[],
  selectors:StructuredOriginLifecycleRow[],columns:readonly string[]) {
  const db=env.DB,{nativeDocumentJobOriginRetirementSchema}=await import("./memory-document-job-origin-retirement-schema.ts");
  if(env.DB!==db)throw new Error("memory-document-job-retirement-changed");
  const schema=await nativeDocumentJobOriginRetirementSchema(env);
  if(env.DB!==db)throw new Error("memory-document-job-retirement-changed");
  const assertion=structuredOriginAssertion(schema.guard.condition,schema.guard.bindings);
  const query={sql:`SELECT ${jobRetirementColumns.map(column=>column==="evidence_json"
    ?"CASE WHEN length(CAST(evidence_json AS BLOB))<=524288 THEN evidence_json ELSE NULL END AS evidence_json":column).join(",")}
    FROM ${jobRetirementTable} ORDER BY origin_id`,bindings:[]};
  const rows=schema.present?jobRetirementRows(structuredClone(await db.prepare(query.sql).all())):[];
  if(env.DB!==db)throw new Error("memory-document-job-retirement-changed");
  const evidenceById=new Map<string,JobRetirementEvidence>(),rowById=new Map<string,StructuredOriginLifecycleRow>();
  for(const row of rows){
    const header=headers.find(item=>item.origin_id===row.origin_id);
    if(!header||rowById.has(String(row.origin_id)))throw new Error("memory-document-job-retirement-unavailable");
    const evidence=await jobRetirementEvidence(row,header,columns);
    if(!evidence||env.DB!==db)throw new Error("memory-document-job-retirement-unavailable");
    const expected=evidence.selectors.slice(Number(row.selector_cursor)).map(item=>JSON.stringify([row.origin_id,item.resource_kind,item.resource_id])).sort();
    const actual=selectors.filter(item=>item.origin_id===row.origin_id).map(item=>JSON.stringify([item.origin_id,item.resource_kind,item.resource_id])).sort();
    if(JSON.stringify(actual)!==JSON.stringify(expected))throw new Error("memory-document-job-retirement-unavailable");
    rowById.set(String(row.origin_id),row);evidenceById.set(String(row.origin_id),evidence);
  }
  const complete=selectors.filter(item=>!evidenceById.has(String(item.origin_id)));
  for(const [originId,evidence] of evidenceById)complete.push(...evidence.selectors.map(item=>({origin_id:originId,...item})));
  return {present:schema.present,query,rows,rowById,evidenceById,selectors:complete,
    assertions:[assertion,...(schema.present?[structuredOriginExact(query,rows,jobRetirementColumns)]:[])]};
}
type JobRetirementInput={now:string;personalErasureActorUserId?:string};
async function jobRetirementInventory(env:StructuredOriginLifecycleEnv,input:JobRetirementInput) {
  const db=env.DB,now=input.now,erasureActor=input.personalErasureActorUserId,
    current=()=>env.DB===db&&input.now===now&&input.personalErasureActorUserId===erasureActor;
  if(nativeMemoryTimestamp(now)===null||erasureActor!==undefined&&!id(erasureActor))throw new Error("memory-document-job-retirement-invalid");
  const {nativeDocumentJobOriginSchema}=await import("./memory-document-job-origin-schema.ts");
  if(!current())throw new Error("memory-document-job-retirement-changed");
  const schema=await nativeDocumentJobOriginSchema(env);if(!current())throw new Error("memory-document-job-retirement-changed");
  const schemaAssertion=structuredOriginAssertion(schema.guard.condition,schema.guard.bindings);
  const {DOCUMENT_JOB_ORIGIN_HEADER_COLUMNS:columns,validateDocumentJobOriginRecord}=await import("./memory-document-job-origin-record.ts");
  if(!current())throw new Error("memory-document-job-retirement-changed");
  const headerQuery={sql:`SELECT ${columns.join(",")} FROM ${jobOriginTable} ORDER BY origin_id`,bindings:[]};
  const indexQuery={sql:`SELECT ${jobOriginSelectorColumns.join(",")} FROM ${jobOriginDependencies} ORDER BY origin_id,resource_kind,resource_id`,bindings:[]};
  const headers=schema.present?jobOriginRows(structuredClone(await db.prepare(headerQuery.sql).all()),columns):[];
  if(!current())throw new Error("memory-document-job-retirement-changed");
  const stored=schema.present?jobOriginRows(structuredClone(await db.prepare(indexQuery.sql).all()),jobOriginSelectorColumns):[];
  if(!current())throw new Error("memory-document-job-retirement-changed");
  const progress=await jobRetirementProgressSnapshot(env,headers,stored,columns);
  if(!current()||progress.rows.some(row=>String(row.updated_at)>now)||new Set(headers.map(row=>row.origin_id)).size!==headers.length||stored.some(row=>!headers.some(header=>header.origin_id===row.origin_id)))
    throw new Error("memory-document-job-retirement-unavailable");
  if(!schema.present&&progress.present)throw new Error("memory-document-job-retirement-orphan-schema");
  const supportSchema=schema.present?await jobRetirementSupportSchema(env):structuredOriginAssertion("1");if(!current())throw new Error("memory-document-job-retirement-changed");
  const assertions=[schemaAssertion,...progress.assertions,supportSchema,...(schema.present?[structuredOriginExact(headerQuery,headers,columns),
    structuredOriginExact(indexQuery,stored,jobOriginSelectorColumns),structuredOriginAssertion(jobOriginMinimizedIntact)]:[structuredOriginAssertion(jobOriginAbsentCondition)])];
  const publications=new Map<string,import("./memory-document-job-origin-manifest.ts").DocumentJobOriginManifest>();
  for(const header of headers){
    if(progress.evidenceById.has(String(header.origin_id)))continue;
    if(header.status==="minimized"){
      if(!jobOriginTombstone(header,columns)||stored.some(row=>row.origin_id===header.origin_id))throw new Error("memory-document-job-retirement-unavailable");continue;
    }
    if(!["active","withdrawn"].includes(String(header.status))||nativeMemoryTimestamp(header.created_at)===null||String(header.created_at)>now
      ||header.status==="withdrawn"&&(nativeMemoryTimestamp(header.withdrawn_at)===null||String(header.withdrawn_at)<String(header.created_at)
        ||String(header.withdrawn_at)>now||!reasons.has(header.withdrawal_reason as NativeMemoryOriginWithdrawalReason)))throw new Error("memory-document-job-retirement-unavailable");
    const query={sql:"SELECT content_id,owner_id,kind,CASE WHEN length(CAST(content AS BLOB))<=65536 THEN content ELSE NULL END AS content,created_at,expires_at,redacted_at FROM private_content WHERE content_id=?",bindings:[header.manifest_content_ref]};
    const result=structuredClone(await db.prepare(query.sql).bind(...query.bindings).all());if(!current())throw new Error("memory-document-job-retirement-changed");
    if(!structuredOriginEnvelope(result)||result.results.length!==1||!Object.hasOwn(result.results,0))throw new Error("memory-document-job-retirement-unavailable");
    const body=result.results[0] as StructuredOriginLifecycleRow;
    if(!body||typeof body!=="object"||Array.isArray(body)||!exactKeys(body,["content_id","owner_id","kind","content","created_at","expires_at","redacted_at"])
      ||body.content_id!==header.manifest_content_ref||body.owner_id!==header.actor_user_id||body.kind!=="memory-document-job-origin"
      ||typeof body.content!=="string"||body.content.length>65536||!body.content.isWellFormed()||bytes(body.content).length>65536
      ||nativeMemoryTimestamp(body.created_at)===null||String(body.created_at)>String(header.created_at)
      ||body.expires_at!==header.manifest_expires_at||body.redacted_at!==null)throw new Error("memory-document-job-retirement-unavailable");
    const publication=header.status==="active"?header:{...header,status:"active",withdrawn_at:null,withdrawal_reason:null};
    const record=await validateDocumentJobOriginRecord(publication,body.content,stored.filter(row=>row.origin_id===header.origin_id));
    if(!record||!current())throw new Error("memory-document-job-retirement-unavailable");
    publications.set(String(header.origin_id),JSON.parse(record.manifest.text) as import("./memory-document-job-origin-manifest.ts").DocumentJobOriginManifest);
    assertions.push(structuredOriginExact(query,[body],["content_id","owner_id","kind","content","created_at","expires_at","redacted_at"]));
  }
  if(headers.some(header=>header.status!=="minimized")&&!progress.present)throw new Error("memory-document-job-retirement-schema-required");
  // Expiry is a retention root, not a replacement for the explicit source,
  // ledger, enrollment or privacy withdrawal owners. Discover its entire fanout.
  // Explicit confirmed personal erasure roots exclude unrelated shared/personal
  // work, but retain the complete downstream closure before any destructive unit.
  const affected=new Set(headers.filter(header=>erasureActor!==undefined
    ?header.actor_user_id===erasureActor&&jobOriginScope(header)?.[0]===""
    :header.status==="withdrawn"||header.status==="active"
      &&[header.source_retention_ceiling,header.answer_expires_at,header.manifest_expires_at,header.input_expires_at,header.job_expires_at]
        .some(value=>nativeMemoryTimestamp(value)!==null&&String(value)<=now)).map(header=>String(header.origin_id)));
  const consumers=new Map<string,Set<string>>(),register=(kind:string,ref:unknown,originId:string)=>{
    if(typeof ref!=="string")return;const key=JSON.stringify([kind,ref]),ids=consumers.get(key)??new Set<string>();ids.add(originId);consumers.set(key,ids);
  };
  for(const selector of progress.selectors)register(String(selector.resource_kind),selector.resource_id,String(selector.origin_id));
  for(const header of headers){
    for(const ref of [header.user_event_id,header.answer_event_id])register("event",ref,String(header.origin_id));
    for(const ref of [header.input_content_ref,header.user_content_id,header.answer_content_id,header.manifest_content_ref])register("private-content",ref,String(header.origin_id));
  }
  const queue=[...affected];
  for(let cursor=0;cursor<queue.length;cursor++){
    const source=headers.find(header=>header.origin_id===queue[cursor])!;
    for(const [kind,ref] of [["event",source.user_event_id],["event",source.answer_event_id],["private-content",source.user_content_id],
      ["private-content",source.answer_content_id],["private-content",source.manifest_content_ref]])
      for(const target of consumers.get(JSON.stringify([kind,ref]))??[])if(!affected.has(target)){affected.add(target);queue.push(target);}
  }
  const pending=headers.filter(header=>affected.has(String(header.origin_id))&&header.status!=="minimized")
    .sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at))||String(a.origin_id).localeCompare(String(b.origin_id)));
  await structuredOriginVerifyReads(db,assertions);if(!current())throw new Error("memory-document-job-retirement-changed");
  return {db,now,current,columns,headerQuery,indexQuery,headers,stored,progress,publications,assertions,pending,supportSchema};
}
async function jobRetirementInitialize(env:StructuredOriginLifecycleEnv,header:StructuredOriginLifecycleRow,
  selectors:StructuredOriginLifecycleRow[],manifest:import("./memory-document-job-origin-manifest.ts").DocumentJobOriginManifest,
  now:string,current:()=>boolean) {
  const db=env.DB,assertions:NativeMemoryOriginQuery[]=[],derived:StructuredOriginLifecycleRow[]=[];
  for(const [index,ref] of [header.answer_content_id,header.manifest_content_ref].entries()){
    const query={sql:`SELECT ${jobRetirementBodyColumns.join(",")},CASE WHEN length(CAST(content AS BLOB))<=65536 THEN content ELSE NULL END AS content
      FROM private_content WHERE content_id=?`,bindings:[ref]};
    const result=structuredClone(await db.prepare(query.sql).bind(...query.bindings).all());if(!current())throw new Error("memory-document-job-retirement-changed");
    if(!structuredOriginEnvelope(result)||result.results.length!==1||!Object.hasOwn(result.results,0))throw new Error("memory-document-job-retirement-unavailable");
    const body=result.results[0] as StructuredOriginLifecycleRow;
    if(!body||typeof body!=="object"||Array.isArray(body)||!exactKeys(body,[...jobRetirementBodyColumns,"content"])
      ||body.content_id!==ref||body.owner_id!==header.actor_user_id||body.kind!==(index?"memory-document-job-origin":"chat-assistant-memory")
      ||body.redacted_at!==null||nativeMemoryTimestamp(body.created_at)===null||String(body.created_at)>String(header.created_at)
      ||body.expires_at!==(index?header.manifest_expires_at:header.answer_expires_at)||typeof body.content!=="string"
      ||body.content.length>65536||!body.content.isWellFormed()||bytes(body.content).length>65536
      ||await nativeMemoryAnswerFingerprint(body.content)!==(index?header.manifest_sha256:header.answer_sha256)||!current())throw new Error("memory-document-job-retirement-unavailable");
    derived.push(Object.fromEntries(jobRetirementBodyColumns.map(column=>[column,body[column]])));
    assertions.push(structuredOriginExact(query,[body],[...jobRetirementBodyColumns,"content"]));
  }
  const ordered=selectors.map(item=>({resource_kind:String(item.resource_kind),resource_id:String(item.resource_id)}))
    .sort((a,b)=>JSON.stringify([a.resource_kind,a.resource_id])<JSON.stringify([b.resource_kind,b.resource_id])?-1:1);
  const refs=[...new Set([header.input_content_ref,header.user_content_id,header.answer_content_id,header.manifest_content_ref,
    ...ordered.filter(item=>item.resource_kind==="private-content").map(item=>item.resource_id)])].sort();
  if(refs.some(ref=>!id(ref))||refs.length>517)throw new Error("memory-document-job-retirement-unavailable");
  const resourceQuery={sql:`SELECT ${structuredOriginResourceColumns.join(",")} FROM project_resource_scopes
    WHERE resource_kind='content' AND resource_id IN(SELECT value FROM json_each(?)) ORDER BY resource_id`,bindings:[JSON.stringify(refs)]};
  const retentionQuery={sql:`SELECT ${structuredOriginRetentionColumns.join(",")} FROM private_content_retention_scopes
    WHERE content_id IN(SELECT value FROM json_each(?)) ORDER BY content_id`,bindings:[JSON.stringify(refs)]};
  const resource=jobOriginRows(structuredClone(await db.prepare(resourceQuery.sql).bind(...resourceQuery.bindings).all()),structuredOriginResourceColumns);
  if(!current())throw new Error("memory-document-job-retirement-changed");
  const retention=jobOriginRows(structuredClone(await db.prepare(retentionQuery.sql).bind(...retentionQuery.bindings).all()),structuredOriginRetentionColumns);
  if(!current())throw new Error("memory-document-job-retirement-changed");
  assertions.push(structuredOriginExact(resourceQuery,resource,structuredOriginResourceColumns),structuredOriginExact(retentionQuery,retention,structuredOriginRetentionColumns));
  const custody=refs.map(ref=>({content_id:String(ref),resource:resource.filter(row=>row.resource_id===ref),retention:retention.filter(row=>row.content_id===ref)}));
  if(custody.some(group=>group.resource.length>1||group.retention.length>1
    ||header.organization_id!==null&&(group.resource.length!==1||group.retention.length!==1)))throw new Error("memory-document-job-retirement-custody-unavailable");
  for(const body of derived){
    const group=custody.find(item=>item.content_id===body.content_id)!;
    if(header.organization_id===null&&(group.resource.length||group.retention.length))throw new Error("memory-document-job-retirement-custody-unavailable");
    if(group.resource.some(row=>row.project_access_id!==header.project_access_id||row.organization_id!==header.organization_id||row.project_id!==header.project_id
      ||row.owner_user_id!==header.owner_user_id||row.actor_user_id!==header.actor_user_id||row.visibility!=="actor_private"
      ||row.source_event_id!==null||row.created_at!==body.created_at)
      ||group.retention.some(row=>row.organization_id!==header.organization_id||row.project_access_id!==header.project_access_id||row.project_id!==header.project_id
      ||row.actor_user_id!==header.actor_user_id||row.classification!=="transient-private"||!Number.isSafeInteger(row.policy_version)||Number(row.policy_version)<0
      ||row.created_at!==body.created_at||nativeMemoryTimestamp(row.assigned_expires_at)===null||String(row.assigned_expires_at)>String(body.expires_at)))
      throw new Error("memory-document-job-retirement-custody-unavailable");
  }
  const evidence:JobRetirementEvidence={header,header_sha256:await hash(bytes(jobRetirementText(header))),selectors:ordered,
    ledgerHead:manifest.mode==="structured"?{...manifest.ledgerHead}:null,derived,custody};
  const text=jobRetirementText(evidence),row:StructuredOriginLifecycleRow={origin_id:header.origin_id,schema_version:1,evidence_json:text,
    evidence_sha256:await hash(bytes(text)),selector_count:ordered.length,selector_cursor:0,phase:"answer",revision:0,
    answer_redacted_at:null,manifest_redacted_at:null,created_at:now,updated_at:now};
  if(!current())throw new Error("memory-document-job-retirement-changed");
  return {evidence,row,assertions};
}
function jobRetirementDerivedProof(evidence:JobRetirementEvidence,row:StructuredOriginLifecycleRow) {
  const refs=evidence.derived.map(body=>body.content_id),phase=String(row.phase);
  const removed=(index:number)=>phase==="finalize"||index===0&&phase==="manifest-delete";
  const cleared=(index:number)=>index===0?phase!=="answer":!["answer","manifest"].includes(phase);
  const bodyQuery={sql:`SELECT ${structuredOriginBodyColumns.slice(0,-1).join(",")},CASE WHEN content='' THEN 1 ELSE 0 END AS empty
    FROM private_content WHERE content_id IN(?,?) ORDER BY content_id`,bindings:refs};
  const resourceQuery={sql:`SELECT ${structuredOriginResourceColumns.join(",")} FROM project_resource_scopes
    WHERE resource_kind='content' AND resource_id IN(?,?) ORDER BY resource_id`,bindings:refs};
  const retentionQuery={sql:`SELECT ${structuredOriginRetentionColumns.join(",")} FROM private_content_retention_scopes
    WHERE content_id IN(?,?) ORDER BY content_id`,bindings:refs};
  const bodyRows=evidence.derived.flatMap((body,index)=>removed(index)?[]:[{...body,
    redacted_at:cleared(index)?index?row.manifest_redacted_at:row.answer_redacted_at:null,empty:cleared(index)?1:0}]);
  const resources=evidence.derived.flatMap((body,index)=>cleared(index)?[]:evidence.custody.find(group=>group.content_id===body.content_id)!.resource);
  const retention=evidence.derived.flatMap((body,index)=>cleared(index)?[]:evidence.custody.find(group=>group.content_id===body.content_id)!.retention);
  return [structuredOriginExact(bodyQuery,bodyRows,structuredOriginBodyColumns),structuredOriginExact(resourceQuery,resources,structuredOriginResourceColumns),
    structuredOriginExact(retentionQuery,retention,structuredOriginRetentionColumns)];
}
async function jobRetirementChoices(env:StructuredOriginLifecycleEnv,input:JobRetirementInput) {
  const inventory=await jobRetirementInventory(env,input),{db,pending,progress,publications,current,now}=inventory;
  const active=pending.filter(header=>header.status==="active");
  // One negative header transition per unit; complete closure is re-proved each
  // call. No destructive phase is offered until all affected consumers are negative.
  if(active.length)return {inventory,choices:active.map(header=>({header,phase:"mark",remaining:1,
    row:null as StructuredOriginLifecycleRow|null,evidence:null as JobRetirementEvidence|null,assertions:[] as NativeMemoryOriginQuery[]}))};
  const choices:{header:StructuredOriginLifecycleRow;phase:string;remaining:number;row:StructuredOriginLifecycleRow|null;
    evidence:JobRetirementEvidence|null;assertions:NativeMemoryOriginQuery[]}[]=[];
  for(const header of pending){
    const originId=String(header.origin_id),row=progress.rowById.get(originId);
    if(!row){
      const manifest=publications.get(originId);if(!manifest)throw new Error("memory-document-job-retirement-unavailable");
      const initial=await jobRetirementInitialize(env,header,progress.selectors.filter(selector=>selector.origin_id===originId),manifest,now,current);
      if(!await jobRetirementEvidence(initial.row,header,inventory.columns)||!current())throw new Error("memory-document-job-retirement-unavailable");
      // Initialization records evidence only, including while a hold blocks erasure.
      await structuredOriginVerifyReads(db,initial.assertions);if(!current())throw new Error("memory-document-job-retirement-changed");
      choices.push({header,phase:"initialize",remaining:1,row:initial.row,evidence:initial.evidence,assertions:initial.assertions});continue;
    }
    const evidence=progress.evidenceById.get(originId)!;
    const proof=jobRetirementDerivedProof(evidence,row),unheld=jobRetirementUnheld(evidence);
    await structuredOriginVerifyReads(db,proof);if(!current())throw new Error("memory-document-job-retirement-changed");
    const holdQuery={sql:unheld.sql.replace("ELSE json('memory_document_job_retirement_held')","ELSE 0"),bindings:unheld.bindings};
    const result=jobOriginRows(structuredClone(await db.prepare(holdQuery.sql).bind(...holdQuery.bindings).all()),["verified"]);
    if(!current()||result.length!==1||result[0].verified!==0&&result[0].verified!==1)throw new Error("memory-document-job-retirement-unavailable");
    // Hold status is a bounded eligibility observation, never erasure completion.
    if(result[0].verified!==1)continue;
    const remaining=row.phase==="answer"?2:row.phase==="selectors"?Number(row.selector_count)-Number(row.selector_cursor)
      :row.phase==="answer-delete"?2:1;
    choices.push({header,phase:String(row.phase),remaining,row,evidence,assertions:[...proof,unheld]});
  }
  if(!current())throw new Error("memory-document-job-retirement-changed");return {inventory,choices};
}
/** One bounded lifecycle unit. No caller invokes this from the scheduler yet.
 * Progress CAS writes are explicit bookkeeping, never counted as body/selector
 * removals; the terminal unit is exactly two fixed writes, independent of fanout. */
export async function prepareNativeDocumentJobOriginRetentionStep(env:StructuredOriginLifecycleEnv,input:JobRetirementInput):Promise<null|{
  statements:NativeMemoryOriginQuery[];assertionIndexes:number[];workUnits:1;oldest:string;selectionKey:string;
  phase:string;physicalWrites:number;bookkeepingWrites:number;acknowledge(results:readonly unknown[]):boolean;
}> {
  const {inventory,choices}=await jobRetirementChoices(env,input),{db,current,now,columns,headers,stored,progress,headerQuery,indexQuery}=inventory;
  if(!choices.length)return null;
  const choice=choices[0],originId=String(choice.header.origin_id),statements:NativeMemoryOriginQuery[]=[],assertionIndexes:number[]=[],
    writes:{index:number;changes:number}[]=[];
  const prove=(query:NativeMemoryOriginQuery)=>{assertionIndexes.push(statements.length);statements.push(query);};
  const write=(query:NativeMemoryOriginQuery,changes:number)=>{writes.push({index:statements.length,changes});statements.push(query);prove(structuredOriginAssertion("changes()=?",[changes]));};
  inventory.assertions.forEach(prove);choice.assertions.forEach(prove);
  let terminalHeaders=headers,terminalIndex=stored,terminalProgress=progress.rows,physicalWrites=0,bookkeepingWrites=0;
  if(choice.phase==="mark"){
    const reason=input.personalErasureActorUserId===undefined?"source-expired":"erased";
    const terminal={...choice.header,status:"withdrawn",withdrawn_at:now,withdrawal_reason:reason};
    write({sql:`UPDATE ${jobOriginTable} SET status='withdrawn',withdrawn_at=?,withdrawal_reason='${reason}'
      WHERE origin_id=? AND status='active'`,bindings:[now,originId]},1);
    terminalHeaders=headers.map(header=>header.origin_id===originId?terminal:header);bookkeepingWrites=1;
  }else if(choice.phase==="initialize"){
    const row=choice.row!;
    // A separate single INSERT phase; no body or selector is touched here.
    write({sql:`INSERT INTO ${jobRetirementTable}(${jobRetirementColumns.join(",")}) VALUES(${jobRetirementColumns.map(()=>"?").join(",")})`,
      bindings:jobRetirementColumns.map(column=>row[column])},1);
    terminalProgress=[...progress.rows,row];bookkeepingWrites=1;
  }else{
    const row=choice.row!,evidence=choice.evidence!;
    const next:StructuredOriginLifecycleRow={...row,revision:Number(row.revision)+1,updated_at:now};
    if(choice.phase==="answer"||choice.phase==="manifest"){
      const index=choice.phase==="answer"?0:1,body=evidence.derived[index],ref=body.content_id,
        custody=evidence.custody.find(group=>group.content_id===ref)!;
      write({sql:"UPDATE private_content SET content='',redacted_at=? WHERE content_id=? AND redacted_at IS NULL",bindings:[now,ref]},1);
      write({sql:"DELETE FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?",bindings:[ref]},custody.resource.length);
      write({sql:"DELETE FROM private_content_retention_scopes WHERE content_id=?",bindings:[ref]},custody.retention.length);
      next.phase=index?"selectors":"manifest";next[index?"manifest_redacted_at":"answer_redacted_at"]=now;physicalWrites=3;
    }else if(choice.phase==="selectors"){
      const selector=evidence.selectors[Number(row.selector_cursor)];
      if(!selector)throw new Error("memory-document-job-retirement-unavailable");
      write({sql:`DELETE FROM ${jobOriginDependencies} WHERE origin_id=? AND resource_kind=? AND resource_id=?`,
        bindings:[originId,selector.resource_kind,selector.resource_id]},1);
      terminalIndex=stored.filter(item=>!(item.origin_id===originId&&item.resource_kind===selector.resource_kind&&item.resource_id===selector.resource_id));
      next.selector_cursor=Number(row.selector_cursor)+1;next.phase=next.selector_cursor===row.selector_count?"answer-delete":"selectors";physicalWrites=1;
    }else if(choice.phase==="answer-delete"||choice.phase==="manifest-delete"){
      const index=choice.phase==="answer-delete"?0:1;
      write({sql:"DELETE FROM private_content WHERE content_id=? AND content='' AND redacted_at=?",
        bindings:[evidence.derived[index].content_id,index?row.manifest_redacted_at:row.answer_redacted_at]},1);
      next.phase=index?"finalize":"manifest-delete";physicalWrites=1;
    }else if(choice.phase==="finalize"){
      const terminal=Object.fromEntries(columns.map(column=>[column,column==="status"?"minimized":
        jobOriginTombstoneColumns.some(retained=>retained===column)?choice.header[column]:null]));
      if(!jobOriginTombstone(terminal,columns))throw new Error("memory-document-job-retirement-unavailable");
      // Both physical rows, both custody pairs and the complete live index have
      // already been proved absent. Keep all fifteen permanent negative fields.
      write({sql:`UPDATE ${jobOriginTable} SET status='minimized',${columns.filter(column=>!jobOriginTombstoneColumns.some(retained=>retained===column))
        .map(column=>column+"=NULL").join(",")} WHERE origin_id=? AND status='withdrawn'`,bindings:[originId]},1);
      write({sql:`DELETE FROM ${jobRetirementTable} WHERE origin_id=? AND revision=? AND phase='finalize' AND evidence_sha256=?`,
        bindings:[originId,row.revision,row.evidence_sha256]},1);
      terminalHeaders=headers.map(header=>header.origin_id===originId?terminal:header);terminalProgress=progress.rows.filter(item=>item.origin_id!==originId);
      bookkeepingWrites=2;
    }else throw new Error("memory-document-job-retirement-unavailable");
    if(choice.phase!=="finalize"){
      if(!await jobRetirementEvidence(next,choice.header,columns)||!current())throw new Error("memory-document-job-retirement-unavailable");
      write({sql:`UPDATE ${jobRetirementTable} SET phase=?,revision=?,selector_cursor=?,answer_redacted_at=?,manifest_redacted_at=?,updated_at=?
        WHERE origin_id=? AND revision=? AND phase=? AND selector_cursor=? AND evidence_sha256=?`,
        bindings:[next.phase,next.revision,next.selector_cursor,next.answer_redacted_at,next.manifest_redacted_at,next.updated_at,
          originId,row.revision,row.phase,row.selector_cursor,row.evidence_sha256]},1);
      terminalProgress=progress.rows.map(item=>item.origin_id===originId?next:item);bookkeepingWrites=1;
      jobRetirementDerivedProof(evidence,next).forEach(prove);
    }else{
      prove(structuredOriginAssertion(`NOT EXISTS(SELECT 1 FROM private_content WHERE content_id IN(?,?))
        AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id IN(?,?))
        AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes WHERE content_id IN(?,?))`,
        [...evidence.derived.map(body=>body.content_id),...evidence.derived.map(body=>body.content_id),...evidence.derived.map(body=>body.content_id)]));
    }
    // Captured original custody survives scrubbing; a late hold rolls back this unit.
    prove(jobRetirementUnheld(evidence));
  }
  prove(structuredOriginExact(headerQuery,terminalHeaders,columns));prove(structuredOriginExact(indexQuery,terminalIndex,jobOriginSelectorColumns));
  prove(structuredOriginExact(progress.query,terminalProgress,jobRetirementColumns));
  prove(structuredOriginAssertion(jobOriginMinimizedIntact));
  // Schema guards, not the old inventory snapshots changed by this exact unit.
  prove(inventory.assertions[0]);prove(progress.assertions[0]);prove(inventory.supportSchema);
  if(!current())throw new Error("memory-document-job-retirement-changed");
  structuredOriginFreezeQueries(statements);Object.freeze(assertionIndexes);let used=false;
  return Object.freeze({statements,assertionIndexes,workUnits:1 as const,oldest:String(choice.header.created_at),selectionKey:originId,
    phase:choice.phase,physicalWrites,bookkeepingWrites,acknowledge(results:readonly unknown[]){
      if(used)return false;used=true;
      if(!current())return false;
      const safe=jobRetirementReceiptData(results,statements.length,writes);
      return safe!==null&&structuredOriginAcknowledged(safe,statements.length,assertionIndexes,writes)&&current();
    }});
}
/** Eligible units only, not held residue or a successful-erasure attestation. */
export async function nativeDocumentJobOriginRetentionBacklog(env:StructuredOriginLifecycleEnv,input:{now:string}):Promise<{count:number;oldest:string|null}> {
  const {inventory,choices}=await jobRetirementChoices(env,input);
  await structuredOriginVerifyReads(inventory.db,[...inventory.assertions,...choices.flatMap(choice=>choice.assertions)]);
  if(!inventory.current())throw new Error("memory-document-job-retirement-changed");
  const count=choices.reduce((sum,choice)=>sum+choice.remaining,0);
  if(!Number.isSafeInteger(count))throw new Error("memory-document-job-retirement-unavailable");
  return {count,oldest:choices.length?String(choices[0].header.created_at):null};
}
async function jobRetirementSupportSchema(env:StructuredOriginLifecycleEnv):Promise<NativeMemoryOriginQuery> {
  const db=env.DB,names=["organization_legal_holds","organization_retention_policies","private_content",
    "project_resource_scopes","private_content_retention_scopes"];
  const query={sql:`SELECT type,name,tbl_name,CASE WHEN length(CAST(sql AS BLOB))<=65536 THEN sql ELSE NULL END AS sql
    FROM sqlite_schema WHERE tbl_name IN(?,?,?,?,?) ORDER BY type,name LIMIT 65`,bindings:names};
  const result=structuredClone(await db.prepare(query.sql).bind(...query.bindings).all());
  if(env.DB!==db||!structuredOriginEnvelope(result)||result.results.length>64
    ||Array.from({length:result.results.length},(_,index)=>index).some(index=>!Object.hasOwn(result.results,index)))
    throw new Error("memory-document-job-retirement-schema-unavailable");
  const rows=result.results as StructuredOriginLifecycleRow[];
  if(rows.some(row=>!row||typeof row!=="object"||Array.isArray(row)||!exactKeys(row,["type","name","tbl_name","sql"])
    ||!["table","index","trigger"].includes(String(row.type))||!names.includes(String(row.tbl_name))||!id(row.name)
    ||row.sql!==null&&(typeof row.sql!=="string"||!row.sql||row.sql.length>65536||!row.sql.isWellFormed())
    ||row.sql===null&&!(row.type==="index"&&String(row.name).startsWith("sqlite_autoindex_")))
    ||names.some(name=>rows.filter(row=>row.name===name&&row.tbl_name===name&&row.type==="table"&&typeof row.sql==="string").length!==1)
    ||rows.filter(row=>row.type==="table").length!==names.length)throw new Error("memory-document-job-retirement-schema-unavailable");
  return structuredOriginExact(query,rows,["type","name","tbl_name","sql"]);
}
function jobRetirementReceiptData(input:readonly unknown[],count:number,writes:readonly {index:number;changes:number}[]):unknown[]|null {
  try {
    if(!Array.isArray(input)||input.length!==count)return null;
    const ownValue=(value:object,key:PropertyKey)=>{
      const descriptor=Object.getOwnPropertyDescriptor(value,key);
      if(!descriptor||!("value" in descriptor))throw new Error("memory-document-job-retirement-receipt-invalid");return descriptor.value as unknown;
    };
    const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==="object"&&!Array.isArray(value)
      &&[Object.prototype,null].includes(Object.getPrototypeOf(value));
    const safe:unknown[]=[];
    for(let index=0;index<count;index++){
      const receipt=ownValue(input,index);if(!object(receipt)||ownValue(receipt,"success")!==true)return null;
      const error=Object.getOwnPropertyDescriptor(receipt,"error");if(error&&(!("value" in error)||error.value!==undefined))return null;
      const rows=ownValue(receipt,"results"),write=writes.find(item=>item.index===index);
      if(!Array.isArray(rows)||rows.length!==(write?0:1))return null;
      if(write){
        const meta=ownValue(receipt,"meta");if(!object(meta)||ownValue(meta,"changes")!==write.changes)return null;
        safe.push({success:true,results:[],meta:{changes:write.changes}});
      }else{
        const row=ownValue(rows,0);if(!object(row)||Reflect.ownKeys(row).length!==1||ownValue(row,"verified")!==1)return null;
        safe.push({success:true,results:[{verified:1}]});
      }
    }
    return safe;
  }catch{return null;}
}

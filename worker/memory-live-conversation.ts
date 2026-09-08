import type { LiveMemoryEnrollment } from "./memory-live-authority.ts";
import type { LiveSourceRow, LiveSourceSnapshot } from "./memory-live-source-lifetime.ts";

/** Membership, not prose or authority. Every read must still rejoin the native source predicate. */
export const LIVE_CONVERSATION_RECIPE = "live-conversation-references-v1";
export const LIVE_CONVERSATION_SEGMENT_SIZE = 8;
export const LIVE_CONVERSATION_READ_SEGMENTS = 8;
export const LIVE_CONVERSATION_STORED_SEGMENTS = 256;
type Query = { sql: string; bindings: (string | number | null)[] };
type SourceQuery = { joins: string; condition: string; bindings: (string | number | null)[] };

/** Called after reference insertion, in the same guarded page/cursor publication transaction. */
export function liveConversationPublication(e: LiveMemoryEnrollment, q: SourceQuery, through: number, now: string): Query {
  return { sql: `WITH eligible AS (
      SELECT event.event_id,event.sequence,turn.turn_id,remembered.expires_at
      ${q.joins} JOIN memory_live_sources remembered ON remembered.enrollment_id=?
        AND remembered.event_id=event.event_id AND remembered.sequence=event.sequence
      WHERE ${q.condition} AND event.type='AssistantReasoned'
        AND event.sequence>? AND event.sequence<=?
        AND remembered.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      ORDER BY event.sequence LIMIT 129
    ), ranked AS (SELECT *,CAST((ROW_NUMBER() OVER (ORDER BY sequence)-1)/8 AS INTEGER) AS bucket FROM eligible),
    buckets AS (SELECT bucket,MIN(sequence) AS first_sequence,MAX(sequence) AS last_sequence,
      COUNT(*) AS member_count,MIN(expires_at) AS expires_at FROM ranked GROUP BY bucket)
    INSERT INTO memory_live_conversation_segments(enrollment_id,enrollment_revision,recipe_version,
      first_sequence,last_sequence,member_count,members_json,created_at,expires_at)
    SELECT CASE WHEN (SELECT COUNT(*) FROM eligible)>128 THEN json('memory_conversation_page_overflow') ELSE ? END,
      ?,?,first_sequence,last_sequence,member_count,
      (SELECT json_group_array(json_object('eventId',event_id,'sequence',sequence,'turnId',turn_id))
        FROM (SELECT event_id,sequence,turn_id FROM ranked WHERE bucket=buckets.bucket ORDER BY sequence)),?,expires_at
    FROM buckets`,
    bindings: [...q.bindings.slice(0, 6), e.enrollment_id, ...q.bindings.slice(6), e.cursor_sequence, through,
      e.enrollment_id, e.revision, LIVE_CONVERSATION_RECIPE, now] };
}

/** Preserve a non-prose provenance bit after segment pruning; never reclassify its survivors as legacy. */
export function liveConversationMarkPublished(e: LiveMemoryEnrollment, through: number): Query {
  return { sql: `UPDATE memory_live_sources SET conversation_segmented=1 WHERE enrollment_id=? AND sequence>? AND sequence<=?
    AND EXISTS(SELECT 1 FROM memory_live_conversation_segments segment,json_each(segment.members_json) member
      WHERE segment.enrollment_id=memory_live_sources.enrollment_id AND segment.enrollment_revision=? AND segment.recipe_version=?
        AND CASE WHEN member.type='object' THEN json_extract(member.value,'$.eventId') END=memory_live_sources.event_id
        AND CASE WHEN member.type='object' THEN json_extract(member.value,'$.sequence') END=memory_live_sources.sequence)`,
    bindings: [e.enrollment_id, e.cursor_sequence, through, e.revision, LIVE_CONVERSATION_RECIPE] };
}

/** Bounded inspection of the newest eight manifests, not a claim of continuous conversation history. */
export function liveConversationSelection(e: LiveMemoryEnrollment, q: SourceQuery, lifetimeProjection: string): Query {
  return { sql: `WITH selected AS (
      SELECT * FROM memory_live_conversation_segments WHERE enrollment_id=? AND enrollment_revision=?
        AND recipe_version=? AND last_sequence<=? ORDER BY first_sequence DESC LIMIT 8
    ), members AS (
      SELECT selected.*,member.key AS ordinal,
        CASE WHEN member.type='object' THEN json_extract(member.value,'$.eventId') END AS reference_event_id,
        CASE WHEN member.type='object' THEN json_extract(member.value,'$.sequence') END AS reference_sequence,
        CASE WHEN member.type='object' THEN json_extract(member.value,'$.turnId') END AS reference_turn_id
      FROM selected LEFT JOIN json_each(CASE WHEN json_valid(members_json) THEN
        CASE WHEN json_type(members_json)='array' AND json_array_length(members_json) BETWEEN 1 AND 8
          AND length(members_json)<=8192 THEN members_json ELSE '[]' END ELSE '[]' END) member
    ), eligible AS (
      SELECT candidate.first_sequence AS segment_first,event.event_id,event.stream_id AS event_stream_id,event.sequence,event.type,event.recorded_at,
        event.actor AS source_actor,event.client_id AS source_client_id,event.correlation_id AS source_correlation_id,event.causation_id AS source_causation_id,
        CASE WHEN json_type(event.payload,'$.memory_origin_version') IS NULL THEN NULL ELSE COALESCE(json_extract(event.payload,'$.memory_origin_version'),'null') END AS source_memory_origin_version,
        json_extract(event.payload,'$.block_id') AS block_id,turn.turn_id,
        authored.content_id AS user_content_id,answer.content_id AS assistant_content_id,
        substr(authored.content,1,512) AS user_text,substr(answer.content,1,512) AS assistant_text,
        ${lifetimeProjection}
      ${q.joins} JOIN memory_live_sources remembered ON remembered.enrollment_id=?
        AND remembered.event_id=event.event_id AND remembered.sequence=event.sequence
      JOIN members candidate ON candidate.reference_event_id=event.event_id
        AND candidate.reference_sequence=event.sequence AND candidate.reference_turn_id=turn.turn_id
      WHERE ${q.condition} AND event.type='AssistantReasoned'
        AND remembered.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    ) SELECT members.enrollment_id AS segment_enrollment,members.enrollment_revision AS segment_revision,
      members.recipe_version AS segment_recipe,members.first_sequence AS segment_first,
      members.last_sequence AS segment_last,members.member_count AS segment_count,
      members.members_json AS segment_members,members.created_at AS segment_created,members.expires_at AS segment_expires,
      members.ordinal,eligible.event_id,eligible.event_stream_id,eligible.sequence,eligible.type,eligible.recorded_at,eligible.block_id,
      eligible.source_actor,eligible.source_client_id,eligible.source_correlation_id,eligible.source_causation_id,
      eligible.source_memory_origin_version,
      eligible.turn_id,eligible.user_content_id,eligible.assistant_content_id,eligible.user_text,eligible.assistant_text,eligible.lifetime_json
    FROM members LEFT JOIN eligible ON eligible.segment_first=members.first_sequence
      AND eligible.event_id=members.reference_event_id AND eligible.sequence=members.reference_sequence
      AND eligible.turn_id=members.reference_turn_id
    ORDER BY members.first_sequence,members.ordinal LIMIT 65`,
    bindings: [e.enrollment_id, e.revision, LIVE_CONVERSATION_RECIPE, e.cursor_sequence,
      ...q.bindings.slice(0, 6), e.enrollment_id, ...q.bindings.slice(6)] };
}

export type LiveConversationRow = LiveSourceRow & {
  segment_enrollment: string; segment_revision: number; segment_recipe: string; segment_first: number;
  segment_last: number; segment_count: number; segment_members: string; segment_created: string;
  segment_expires: string; ordinal: number;
};
/** Pre-migration references keep working, but may never bypass a retained segment's invalidation. */
export function liveConversationLegacySelection(e: LiveMemoryEnrollment, q: SourceQuery, lifetimeProjection: string): Query {
  return { sql: `SELECT event.event_id,event.stream_id AS event_stream_id,event.sequence,event.type,event.recorded_at,
      event.actor AS source_actor,event.client_id AS source_client_id,event.correlation_id AS source_correlation_id,event.causation_id AS source_causation_id,
      CASE WHEN json_type(event.payload,'$.memory_origin_version') IS NULL THEN NULL ELSE COALESCE(json_extract(event.payload,'$.memory_origin_version'),'null') END AS source_memory_origin_version,
      json_extract(event.payload,'$.block_id') AS block_id,turn.turn_id,
      authored.content_id AS user_content_id,answer.content_id AS assistant_content_id,
      substr(authored.content,1,512) AS user_text,substr(answer.content,1,512) AS assistant_text,${lifetimeProjection}
    ${q.joins} JOIN memory_live_sources remembered ON remembered.enrollment_id=?
      AND remembered.event_id=event.event_id AND remembered.sequence=event.sequence
    WHERE ${q.condition} AND event.type='AssistantReasoned' AND event.sequence<=? AND remembered.conversation_segmented=0
      AND remembered.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND NOT EXISTS(SELECT 1 FROM memory_live_conversation_segments segment WHERE segment.enrollment_id=?
        AND event.sequence BETWEEN segment.first_sequence AND segment.last_sequence)
    ORDER BY event.sequence DESC LIMIT 8`,
    bindings: [...q.bindings.slice(0, 6), e.enrollment_id, ...q.bindings.slice(6), e.cursor_sequence, e.enrollment_id] };
}
const timestamp = (value: unknown): number | null => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const parsed = Date.parse(value); return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : null;
};
const safeSequence = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;

/** One missing member invalidates its whole segment. No remembered or copied grant is trusted. */
export function validLiveConversationSegments(rows: LiveConversationRow[], e: LiveMemoryEnrollment, checkedAt: number) {
  if (rows.length > 64) return [];
  const groups = new Map<number, LiveConversationRow[]>();
  for (const row of rows) {
    if (!safeSequence(row.segment_first)) return [];
    const group = groups.get(row.segment_first) ?? []; group.push(row); groups.set(row.segment_first, group);
  }
  if (groups.size > LIVE_CONVERSATION_READ_SEGMENTS) return [];
  const orderedGroups = [...groups.values()].sort((a, b) => a[0].segment_first - b[0].segment_first);
  const overlapping = new Set<number>();
  for (let i = 0; i < orderedGroups.length; i++) for (let j = i + 1; j < orderedGroups.length; j++) {
    if (orderedGroups[j][0].segment_first <= orderedGroups[i][0].segment_last) {
      overlapping.add(orderedGroups[i][0].segment_first); overlapping.add(orderedGroups[j][0].segment_first);
    }
  }
  const result: { rows: LiveSourceRow[]; expiresAt: number }[] = [];
  const used = new Set<string>();
  for (const group of orderedGroups) {
    const head = group[0], expiresAt = timestamp(head.segment_expires), createdAt = timestamp(head.segment_created);
    if (overlapping.has(head.segment_first) || head.segment_enrollment !== e.enrollment_id || head.segment_revision !== e.revision
      || head.segment_recipe !== LIVE_CONVERSATION_RECIPE || !safeSequence(head.segment_last)
      || head.segment_first > head.segment_last || head.segment_last > e.cursor_sequence
      || !Number.isSafeInteger(head.segment_count) || head.segment_count < 1 || head.segment_count > 8
      || group.length !== head.segment_count || expiresAt === null || expiresAt <= checkedAt
      || createdAt === null || createdAt > checkedAt || createdAt < Date.parse(e.enrolled_at)
      || typeof head.segment_members !== "string" || head.segment_members.length > 8192) continue;
    let members: unknown;
    try { members = JSON.parse(head.segment_members); } catch { continue; }
    if (!Array.isArray(members) || members.length !== group.length) continue;
    let previous = 0;
    const ids = new Set<string>(), turns = new Set<string>();
    const valid = group.every((row, index) => {
      const member = members[index];
      if (!member || typeof member !== "object" || Array.isArray(member)
        || Object.keys(member).sort().join(",") !== "eventId,sequence,turnId"
        || typeof member.eventId !== "string" || !member.eventId || typeof member.turnId !== "string" || !member.turnId
        || !safeSequence(member.sequence) || member.sequence <= previous || ids.has(member.eventId) || used.has(member.eventId) || turns.has(member.turnId)
        || row.ordinal !== index || row.segment_enrollment !== head.segment_enrollment
        || row.segment_revision !== head.segment_revision || row.segment_recipe !== head.segment_recipe
        || row.segment_first !== head.segment_first || row.segment_last !== head.segment_last
        || row.segment_count !== head.segment_count || row.segment_members !== head.segment_members
        || row.segment_expires !== head.segment_expires || row.segment_created !== head.segment_created
        || row.event_id !== member.eventId || row.sequence !== member.sequence || row.turn_id !== member.turnId
        || row.type !== "AssistantReasoned" || typeof row.user_text !== "string" || typeof row.assistant_text !== "string") return false;
      previous = member.sequence; ids.add(member.eventId); turns.add(member.turnId); return true;
    });
    if (!valid || members[0].sequence !== head.segment_first || members.at(-1).sequence !== head.segment_last) continue;
    ids.forEach(id => used.add(id)); result.push({ rows: group, expiresAt });
  }
  return result;
}

/** Reserve the conversation slots before trimming actions, otherwise busy documents starve recall again. */
export function mergeLiveConversationRecall(actions: LiveSourceSnapshot[], conversations: LiveSourceSnapshot[]) {
  const chat = conversations.slice().sort((a, b) => a.sequence - b.sequence).slice(-8);
  const other = actions.filter(row => row.type !== "AssistantReasoned").sort((a, b) => a.sequence - b.sequence).slice(-(64 - chat.length));
  return [...other, ...chat].sort((a, b) => a.sequence - b.sequence);
}

/** Run after reference deletion, including paused-learning maintenance. Never shrink a segment's membership. */
export function liveConversationPrune(enrollmentId: string, revision: number): Query {
  return { sql: `DELETE FROM memory_live_conversation_segments WHERE enrollment_id=? AND (
      enrollment_revision<>? OR expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      OR NOT json_valid(members_json)
      OR EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(members_json) THEN members_json ELSE '[]' END) member WHERE member.type<>'object' OR NOT EXISTS(
        SELECT 1 FROM memory_live_sources remembered WHERE remembered.enrollment_id=memory_live_conversation_segments.enrollment_id
          AND remembered.event_id=CASE WHEN member.type='object' THEN json_extract(member.value,'$.eventId') END
          AND remembered.sequence=CASE WHEN member.type='object' THEN json_extract(member.value,'$.sequence') END)))`, bindings: [enrollmentId, revision] };
}
export function liveConversationTrim(enrollmentId: string): Query {
  return { sql: `DELETE FROM memory_live_conversation_segments WHERE enrollment_id=? AND rowid IN(
      SELECT rowid FROM memory_live_conversation_segments WHERE enrollment_id=? ORDER BY first_sequence DESC LIMIT -1 OFFSET 256)`,
    bindings: [enrollmentId, enrollmentId] };
}

/** Called only under the existing preserving-settings revision/custody transaction. Never extends a lease. */
export function liveConversationPreserve(e: LiveMemoryEnrollment, oldRevision: number, now: string): Query {
  return { sql: `UPDATE memory_live_conversation_segments SET enrollment_revision=?,expires_at=MIN(expires_at,?,
      COALESCE((SELECT MIN(remembered.expires_at) FROM json_each(members_json) member
        JOIN memory_live_sources remembered ON remembered.enrollment_id=memory_live_conversation_segments.enrollment_id
          AND remembered.event_id=json_extract(member.value,'$.eventId') AND remembered.sequence=json_extract(member.value,'$.sequence')),?))
    WHERE enrollment_id=? AND enrollment_revision=?`, bindings: [e.revision, e.expires_at, now, e.enrollment_id, oldRevision] };
}

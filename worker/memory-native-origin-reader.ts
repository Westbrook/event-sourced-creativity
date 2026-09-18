import type { WorkerEnv } from "./runtime.ts";
import type { LiveMemoryEnrollment } from "./memory-live-authority.ts";
import type { NativeMemoryContextObserver, NativeMemoryPreparedDocument } from "./memory-live-context.ts";
import { nativeMemoryEnrollmentQuery } from "./memory-live-context.ts";
import { nativeMemoryDescriptor as descriptor, nativeMemoryGrantDeadline, nativeMemoryPilotDeadline,
  nativeMemoryPilotQuery, nativeMemoryTimestamp as timestamp, type NativeMemoryQuery,
  type NativeMemorySqlValue as Value } from "./memory-native-deadlines.ts";
import { liveMemoryLifetimeProjection, liveMemorySourceDeadline } from "./memory-live-source-lifetime.ts";
import { NATIVE_MEMORY_ANSWER_KIND, NATIVE_MEMORY_ORIGIN_LIMITS, nativeMemoryAnswerFingerprint, nativeMemoryDependencyListFingerprint,
  nativeMemoryFingerprint, nativeMemorySourceProjection, nativeMemoryOriginPaidSourcesQuery as paidSourcesQuery,
  nativeMemoryOriginAncestryQuery, nativeMemoryOriginSourceExclusion, validateNativeMemoryOriginRows,
  type NativeMemoryOriginHeader, type NativeMemoryOriginDependency, type NativeMemorySourceProjectionInput } from "./memory-native-origin.ts";

type Row = Record<string, unknown>;
type SourceQuery = { joins: string; condition: string; bindings: Value[] };
type Guard = { sql: string; bindings: Value[] };
export type NativeMemoryOriginTarget = {
  originId: string; turnId: string; answerEventId: string; answerContentId: string; answer: string;
};
/** Metadata only. This value is not an authorization token. Its observer must
 * still be sealed and enforced in the enclosing final read or atomic write. */
export type NativeMemoryOriginRead = { originId: string; validUntil: string };
const CLOCK = "SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS checked_at";
const MAX_DEPENDENCIES = NATIVE_MEMORY_ORIGIN_LIMITS.dependencies, MAX_SEGMENTS = NATIVE_MEMORY_ORIGIN_LIMITS.segments;
const MAX_ANSWER_BYTES = NATIVE_MEMORY_ORIGIN_LIMITS.answerBytes, MAX_ROW_BYTES = 2 * 1024 * 1024;
const SCHEMA = "SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name IN" +
  "('memory_live_enrollments','memory_live_sources','memory_live_runs','memory_live_conversation_segments'," +
  "'memory_native_answer_origins','memory_native_answer_dependencies'))=6" +
  " AND EXISTS(SELECT 1 FROM pragma_table_info('memory_live_sources') WHERE name='conversation_segmented'" +
  " AND type='INTEGER' AND \"notnull\"=1) THEN 1 ELSE 0 END AS ready";
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 240;
const enabled = (env: WorkerEnv, actor: string) => env.FORMA_MEMORY_ENABLED === "true"
  && (env.FORMA_MEMORY_USER_IDS ?? "").split(",").map(value => value.trim()).filter(Boolean).includes(actor);
const scopeKey = (prepared: NativeMemoryPreparedDocument) => JSON.stringify([
  prepared.binding.scope?.organizationId ?? "", prepared.binding.scope?.projectAccessId ?? "",
  prepared.binding.projectId, prepared.binding.documentId,
]);

/** Saved native identities, never a new newest-N window or a copied SQL query.
 * The native source predicate remains authoritative, including paid provenance.
 * Exact native content identities prevent swapping an equally worded source. */
export function nativeMemoryOriginSourcesQuery(e: LiveMemoryEnrollment, q: SourceQuery,
  header: NativeMemoryOriginHeader, dependencies: readonly NativeMemoryOriginDependency[]): NativeMemoryQuery {
  if (!dependencies.length || dependencies.length > MAX_DEPENDENCIES) throw new Error("native_origin_dependency_limit");
  const saved = dependencies.map(row => ({ eventId: row.event_id, streamId: row.event_stream_id,
    sequence: row.source_sequence, type: row.event_type, turnId: row.turn_id,
    userContentId: row.user_content_id, assistantContentId: row.assistant_content_id,
    segmented: row.segment_enrollment_id === null ? 0 : 1 }));
  return descriptor("SELECT event.event_id,event.stream_id AS event_stream_id,event.sequence,event.type,event.recorded_at," +
    "event.actor AS source_actor,event.client_id AS source_client_id,event.correlation_id AS source_correlation_id,event.causation_id AS source_causation_id," +
    "CASE WHEN json_type(event.payload,'$.memory_origin_version') IS NULL THEN NULL ELSE COALESCE(json_extract(event.payload,'$.memory_origin_version'),'null') END AS source_memory_origin_version," +
    "json_extract(event.payload,'$.block_id') AS block_id,turn.turn_id," +
    "authored.content_id AS user_content_id,answer.content_id AS assistant_content_id," +
    "substr(authored.content,1,512) AS user_text,substr(answer.content,1,512) AS assistant_text," +
    liveMemoryLifetimeProjection() + " " + q.joins +
    " JOIN memory_live_sources remembered ON remembered.enrollment_id=? AND remembered.event_id=event.event_id" +
    " AND remembered.sequence=event.sequence JOIN json_each(?) saved" +
    " ON (event.event_id,event.stream_id,event.sequence,event.type)=(json_extract(saved.value,'$.eventId')," +
    "json_extract(saved.value,'$.streamId'),json_extract(saved.value,'$.sequence'),json_extract(saved.value,'$.type'))" +
    " WHERE " + q.condition + " AND event.sequence<=?" +
    " AND turn.turn_id IS json_extract(saved.value,'$.turnId')" +
    " AND authored.content_id IS json_extract(saved.value,'$.userContentId')" +
    " AND answer.content_id IS json_extract(saved.value,'$.assistantContentId')" +
    " AND remembered.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')" +
    " AND (event.type<>'AssistantReasoned' OR json_extract(saved.value,'$.segmented')=1" +
    " OR remembered.conversation_segmented=0 AND NOT EXISTS(SELECT 1 FROM memory_live_conversation_segments segment" +
    " WHERE segment.enrollment_id=remembered.enrollment_id AND event.sequence BETWEEN segment.first_sequence AND segment.last_sequence))" +
    " AND " + nativeMemoryOriginSourceExclusion(true) +
    " ORDER BY event.sequence LIMIT 129",
  [...q.bindings.slice(0, 6), e.enrollment_id, JSON.stringify(saved), ...q.bindings.slice(6), header.selection_cursor]);
}

/** All original segment members are dependencies, including unconsumed members
 * that were necessary to certify a consumed excerpt. No survivor becomes legacy. */
export function nativeMemoryOriginSegmentsQuery(dependencies: readonly NativeMemoryOriginDependency[]): NativeMemoryQuery {
  const saved = new Map<string, { enrollmentId: string; revision: number; recipe: string; firstSequence: number }>();
  for (const row of dependencies) if (row.segment_enrollment_id !== null) {
    const member = { enrollmentId: row.segment_enrollment_id, revision: row.segment_revision!,
      recipe: row.segment_recipe!, firstSequence: row.segment_first_sequence! };
    saved.set(JSON.stringify(member), member);
  }
  if (saved.size > MAX_SEGMENTS) throw new Error("native_origin_segment_limit");
  return descriptor("SELECT segment.* FROM memory_live_conversation_segments segment JOIN json_each(?) saved" +
    " ON (segment.enrollment_id,segment.enrollment_revision,segment.recipe_version,segment.first_sequence)=" +
    "(json_extract(saved.value,'$.enrollmentId'),json_extract(saved.value,'$.revision')," +
    "json_extract(saved.value,'$.recipe'),json_extract(saved.value,'$.firstSequence'))" +
    " ORDER BY segment.first_sequence LIMIT 9", [JSON.stringify([...saved.values()])]);
}

/** Depth-one origin recipe: an original conversation source may not become a
 * paid task later, even if its copied answer text remains byte-identical. This
 * is an independently replayed empty-set proof, not a change to native recall. */
export function nativeMemoryOriginPaidSourcesQuery(header: Pick<NativeMemoryOriginHeader, "actor_user_id" | "scope_key">,
  dependencies: readonly NativeMemoryOriginDependency[]): NativeMemoryQuery {
  if (dependencies.length > MAX_DEPENDENCIES) throw new Error("native_origin_dependency_limit");
  const turns = [...new Set(dependencies.filter(row => row.event_type === "AssistantReasoned").map(row => row.turn_id))];
  if (!turns.every(id)) throw new Error("native_origin_source_identity");
  const query = paidSourcesQuery(header.actor_user_id, header.scope_key, turns);
  return descriptor(query.sql, query.bindings);
}

/** Compare actual native ordered membership, not a caller-provided segment ID. */
export function nativeMemoryOriginSegmentsMatch(dependencies: readonly NativeMemoryOriginDependency[],
  segments: readonly Row[], at: number): boolean {
  if (!Number.isFinite(at) || dependencies.length > MAX_DEPENDENCIES || segments.length > MAX_SEGMENTS) return false;
  const groups = new Map<string, NativeMemoryOriginDependency[]>();
  for (const row of dependencies) if (row.segment_enrollment_id !== null) {
    const key = JSON.stringify([row.segment_enrollment_id, row.segment_revision, row.segment_recipe, row.segment_first_sequence]);
    const group = groups.get(key) ?? []; group.push(row); groups.set(key, group);
  }
  if (groups.size !== segments.length) return false;
  const seen = new Set<string>();
  for (const segment of segments) {
    const key = JSON.stringify([segment.enrollment_id, segment.enrollment_revision, segment.recipe_version, segment.first_sequence]);
    const group = groups.get(key), expires = timestamp(segment.expires_at), created = timestamp(segment.created_at);
    if (!group || seen.has(key) || expires === null || expires <= at || created === null || created > at
      || typeof segment.members_json !== "string" || segment.members_json.length > 8192) return false;
    seen.add(key); group.sort((left, right) => left.segment_ordinal! - right.segment_ordinal!);
    let members: unknown;
    try { members = JSON.parse(segment.members_json); } catch { return false; }
    if (!Array.isArray(members) || members.length < 1 || members.length > 8
      || group.length !== members.length || segment.member_count !== members.length) return false;
    for (let index = 0; index < group.length; index++) {
      const dependency = group[index], member = members[index];
      if (!member || typeof member !== "object" || Array.isArray(member)
        || Object.keys(member).sort().join(",") !== "eventId,sequence,turnId"
        || dependency.segment_ordinal !== index || dependency.segment_member_count !== group.length
        || dependency.segment_created_at !== segment.created_at || dependency.segment_last_sequence !== segment.last_sequence
        || dependency.event_type !== "AssistantReasoned" || dependency.event_id !== member.eventId
        || dependency.source_sequence !== member.sequence || dependency.turn_id !== member.turnId
        || index > 0 && group[index - 1].source_sequence >= dependency.source_sequence) return false;
    }
    if (group[0].source_sequence !== segment.first_sequence || group.at(-1)!.source_sequence !== segment.last_sequence) return false;
  }
  return true;
}

function capturedResults(results: D1Result<Row>[], expected: number): D1Result<Row>[] {
  const value = structuredClone(results);
  if (value.length !== expected || value.some(result => !result.success || !Array.isArray(result.results))
    || new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_ROW_BYTES) throw new Error("native_origin_read_limit");
  return value;
}

function enrollmentMatches(e: LiveMemoryEnrollment, header: NativeMemoryOriginHeader) {
  return e.enrollment_id === header.enrollment_id && e.revision === header.enrollment_revision
    && e.actor_user_id === header.actor_user_id && e.owner_user_id === header.owner_user_id
    && e.organization_id === header.organization_id && e.project_access_id === header.project_access_id
    && e.project_id === header.project_id && e.document_id === header.document_id
    && e.permission_epoch === header.permission_epoch && e.policy_version === header.policy_version
    && e.enrolled_at === header.enrolled_at && e.expires_at === header.enrollment_expires_at
    && e.retention_days === header.retention_days && e.recall_enabled === 1
    && Number.isSafeInteger(e.cursor_sequence) && e.cursor_sequence >= header.selection_cursor
    && (e.cutoff_sequence === null || Number.isSafeInteger(e.cutoff_sequence) && e.cutoff_sequence >= e.cursor_sequence);
}

/** The marked answer stays paired with its ORIGINAL user event and private
 * content, not whichever still-readable authored pointer a turn has today. */
export function nativeMemoryOriginPairQuery(header: NativeMemoryOriginHeader, turnGuard: Guard): NativeMemoryQuery {
  const shared = header.organization_id !== null;
  const custody = shared ? `NOT EXISTS(SELECT 1 FROM (SELECT event.event_id AS id,event.sequence AS sequence
      UNION ALL SELECT message.event_id,message.sequence) pair WHERE NOT EXISTS(SELECT 1 FROM project_event_scopes custody
      WHERE (custody.event_id,custody.source_stream_id,custody.source_sequence,custody.organization_id,custody.project_access_id,
        custody.project_id,custody.owner_user_id,custody.actor_user_id)=(pair.id,event.stream_id,pair.sequence,?,?,?,?,?)))`
    : "NOT EXISTS(SELECT 1 FROM project_event_scopes custody WHERE custody.event_id IN(event.event_id,message.event_id))";
  const receiptPrefix = "assistant:" + header.actor_user_id + ":" + (header.project_access_id ?? "personal")
    + ":" + header.document_id + ":" + header.turn_id;
  return descriptor(`SELECT answer.content AS answer_text,authored.content AS user_text,answer.expires_at AS answer_expires_at,
      authored.expires_at AS user_expires_at,event.event_id,event.stream_id,event.sequence,event.type,event.actor,
      event.client_id,event.correlation_id,event.causation_id,event.recorded_at,event.payload,secret.private_json,
      message.event_id AS user_event_id,message.sequence AS user_sequence,message.payload AS user_payload,
      message.recorded_at AS user_recorded_at,message_secret.private_json AS user_private_json,
      (SELECT assigned_expires_at FROM private_content_retention_scopes deadline WHERE
        (deadline.content_id,deadline.organization_id,deadline.project_access_id,deadline.project_id,deadline.actor_user_id)
        IS (answer.content_id,turn.organization_id,turn.project_access_id,turn.project_id,turn.actor_user_id)) AS answer_assigned_expires_at,
      (SELECT assigned_expires_at FROM private_content_retention_scopes deadline WHERE
        (deadline.content_id,deadline.organization_id,deadline.project_access_id,deadline.project_id,deadline.actor_user_id)
        IS (authored.content_id,turn.organization_id,turn.project_access_id,turn.project_id,turn.actor_user_id)) AS user_assigned_expires_at
    FROM assistant_turns turn JOIN private_content answer
      ON (answer.content_id,answer.owner_id,answer.kind,answer.redacted_at) IS (turn.assistant_content_ref,turn.actor_user_id,?,NULL)
      AND answer.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    JOIN private_content authored ON (authored.content_id,authored.owner_id,authored.kind,authored.redacted_at)
      IS (turn.user_content_ref,turn.actor_user_id,'chat-user',NULL) AND authored.content_id=?
      AND authored.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    JOIN events event ON event.event_id=? AND event.stream_id=? AND event.sequence=? AND event.type='AssistantReasoned'
      AND event.actor=? AND event.client_id='web:assistant' AND event.schema_version=1 AND event.compensates_event_id IS NULL
      AND event.correlation_id=? AND json_extract(event.payload,'$.operation')='creative-chat'
      AND json_type(event.payload,'$.memory_origin_version')='integer' AND json_extract(event.payload,'$.memory_origin_version')=1
      AND json_type(event.payload,'$.organization_id') IS CASE WHEN turn.organization_id IS NULL THEN 'null' ELSE 'text' END
      AND json_type(event.payload,'$.project_access_id') IS CASE WHEN turn.project_access_id IS NULL THEN 'null' ELSE 'text' END
      AND json_extract(event.payload,'$.organization_id') IS turn.organization_id
      AND json_extract(event.payload,'$.project_access_id') IS turn.project_access_id
      AND json_type(event.payload,'$.owner_user_id')='text'
      AND event.stream_id='creative:'||json_extract(event.payload,'$.owner_user_id')
      AND json_type(event.payload,'$.proposal_count') IS NULL
      AND json_extract(event.payload,'$.turn_id')=turn.turn_id AND json_extract(event.payload,'$.content_ref')=answer.content_id
      AND json_extract(event.payload,'$.actor_user_id')=turn.actor_user_id
      AND json_extract(event.payload,'$.project_id')=turn.project_id AND json_extract(event.payload,'$.document_id')=turn.document_id
    JOIN events message ON message.event_id=? AND message.sequence=? AND message.stream_id=event.stream_id
      AND message.type='ChatMessageSent' AND message.actor=event.actor AND message.client_id='web:assistant'
      AND message.schema_version=1 AND message.compensates_event_id IS NULL AND message.causation_id IS NULL
      AND event.causation_id=message.event_id AND event.sequence=message.sequence+1 AND message.correlation_id=event.correlation_id
      AND json_extract(message.payload,'$.turn_id')=turn.turn_id AND json_extract(message.payload,'$.content_ref')=authored.content_id
      AND json_extract(message.payload,'$.actor_user_id')=turn.actor_user_id
      AND json_extract(message.payload,'$.project_id')=turn.project_id AND json_extract(message.payload,'$.document_id')=turn.document_id
    JOIN event_client_receipts user_receipt ON (user_receipt.stream_id,user_receipt.client_event_id,user_receipt.event_id,user_receipt.sequence)
      =(message.stream_id,?,message.event_id,message.sequence)
    JOIN event_client_receipts answer_receipt ON (answer_receipt.stream_id,answer_receipt.client_event_id,answer_receipt.event_id,answer_receipt.sequence)
      =(event.stream_id,?,event.event_id,event.sequence)
    LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id
    LEFT JOIN event_private_payloads message_secret ON message_secret.private_event_id=message.event_id
    WHERE (turn.actor_user_id,turn.scope_key,turn.turn_id,turn.organization_id,turn.project_access_id,
      turn.project_id,turn.document_id,turn.assistant_content_ref) IS (?,?,?,?,?,?,?,?)
      AND turn.proposal_json IS NULL
      AND (authored.created_at,answer.created_at,user_receipt.created_at,answer_receipt.created_at,turn.completed_at)
        =(turn.created_at,turn.created_at,turn.created_at,turn.created_at,turn.created_at)
      AND (json_extract(event.payload,'$._private_ref') IS NULL OR json_extract(event.payload,'$._private_ref')=event.event_id
        AND (secret.owner_id,secret.project_id,secret.document_id,secret.redacted_at) IS (?,?,?,NULL) AND json_valid(secret.private_json))
      AND (json_extract(message.payload,'$._private_ref') IS NULL OR json_extract(message.payload,'$._private_ref')=message.event_id
        AND (message_secret.owner_id,message_secret.project_id,message_secret.document_id,message_secret.redacted_at)
          IS (?,?,?,NULL) AND json_valid(message_secret.private_json))
      AND (${custody}) AND (${turnGuard.sql})
      AND NOT EXISTS(SELECT 1 FROM assistant_specialist_tasks task WHERE
        (task.actor_user_id,task.scope_key,task.turn_id)=(turn.actor_user_id,turn.scope_key,turn.turn_id))
      AND NOT EXISTS(SELECT 1 FROM assistant_action_proposals proposal WHERE
        (proposal.actor_user_id,proposal.scope_key,proposal.turn_id)=(turn.actor_user_id,turn.scope_key,turn.turn_id))
      AND NOT EXISTS(SELECT 1 FROM events proposal WHERE proposal.stream_id=event.stream_id AND proposal.type='MutationProposed'
        AND json_extract(proposal.payload,'$.turn_id')=turn.turn_id)
      AND NOT EXISTS(SELECT 1 FROM events newer WHERE newer.stream_id=event.stream_id AND newer.type='AssistantReasoned'
        AND json_extract(newer.payload,'$.content_ref')=answer.content_id AND newer.sequence>event.sequence)
      AND NOT EXISTS(SELECT 1 FROM memory_native_answer_origins other WHERE other.origin_id<>?
        AND (other.answer_content_id=answer.content_id OR other.answer_event_id=event.event_id)) LIMIT 2`,
  [NATIVE_MEMORY_ANSWER_KIND, header.user_content_id, header.answer_event_id, "creative:" + header.owner_user_id, header.answer_source_sequence,
    "user:" + header.actor_user_id, header.actor_user_id + ":" + header.turn_id, header.user_event_id, header.user_source_sequence,
    receiptPrefix + ":user", receiptPrefix + ":assistant",
    header.actor_user_id, header.scope_key, header.turn_id, header.organization_id,
    header.project_access_id, header.project_id, header.document_id, header.answer_content_id,
    header.owner_user_id, header.project_id, header.document_id,
    header.owner_user_id, header.project_id, header.document_id,
    ...(shared ? [header.organization_id, header.project_access_id, header.project_id, header.owner_user_id, header.actor_user_id] : []),
    ...turnGuard.bindings, header.origin_id]);
}

/** Revalidate the ORIGINAL saved references for one marked answer. This does not
 * authorize standalone delivery: every captured row and guard is registered on
 * the mandatory enclosing observer, which must be enforced after the hashing
 * awaits. No source SQL or copied authorization is loaded from the manifest. */
export async function revalidateNativeAnswerOrigin(env: WorkerEnv, prepared: NativeMemoryPreparedDocument,
  target: NativeMemoryOriginTarget, observer: NativeMemoryContextObserver): Promise<NativeMemoryOriginRead | null> {
  if (!observer || typeof observer.observe !== "function" || typeof observer.require !== "function" || typeof observer.before !== "function") return null;
  let captured: NativeMemoryPreparedDocument, wanted: NativeMemoryOriginTarget;
  try { captured = structuredClone(prepared); wanted = structuredClone(target); } catch { return null; }
  const principal = captured?.principal, binding = captured?.binding, started = Date.now();
  if (!principal || !binding || !wanted || ![wanted.originId, wanted.turnId, wanted.answerEventId, wanted.answerContentId].every(id)
    || typeof wanted.answer !== "string" || !wanted.answer || !wanted.answer.isWellFormed()
    || new TextEncoder().encode(wanted.answer).byteLength > MAX_ANSWER_BYTES
    || !enabled(env, principal.userId) || principal.fictional || !principal.authorizationSnapshot
    || !id(binding.projectId) || !id(binding.documentId) || principal.userId !== binding.actorUserId
    || principal.access.permissionEpoch !== binding.permissionEpoch
    || binding.streamId !== "creative:" + (binding.scope?.ownerUserId ?? principal.userId)
    || binding.scope && (binding.scope.actorUserId !== principal.userId || binding.scope.projectId !== binding.projectId)) return null;
  const originalGrantDeadline = nativeMemoryGrantDeadline(principal, started);
  if (originalGrantDeadline === undefined) return null;
  try {
    if ((await env.DB.prepare(SCHEMA).first<{ ready: number }>())?.ready !== 1) return null;
    const [authority, source, consent] = await Promise.all([
      import("./memory-live-authority.ts"), import("./memory-live-sources.ts"), import("./consequential-consent.ts"),
    ]);
    const requestGuard = consent.executionAdmissionGuard(principal, binding, null);
    const headerQuery = descriptor(`SELECT * FROM memory_native_answer_origins WHERE origin_id=? AND actor_user_id=?
      AND owner_user_id=? AND organization_id IS ? AND project_access_id IS ? AND project_id=? AND document_id=?
      AND scope_key=? AND turn_id=? AND answer_event_id=? AND answer_content_id=? LIMIT 2`,
    [wanted.originId, principal.userId, binding.scope?.ownerUserId ?? principal.userId,
      binding.scope?.organizationId ?? null, binding.scope?.projectAccessId ?? null, binding.projectId, binding.documentId,
      scopeKey(captured), wanted.turnId, wanted.answerEventId, wanted.answerContentId]);
    const dependencyQuery = descriptor(`SELECT dependency.* FROM memory_native_answer_dependencies dependency
      JOIN memory_native_answer_origins origin ON origin.origin_id=dependency.origin_id
      WHERE dependency.origin_id=? AND origin.actor_user_id=? AND origin.scope_key=? ORDER BY dependency.ordinal LIMIT 129`,
    [wanted.originId, principal.userId, scopeKey(captured)]);
    const configured = env.FORMA_PILOT_COHORT_ID?.trim() ?? "";
    const breakglass = (env.FORMA_ADMIN_EMAILS ?? "").split(",").map(value => value.trim().toLowerCase()).includes(principal.email.toLowerCase());
    const pilotQuery = configured && !breakglass ? nativeMemoryPilotQuery(configured) : null;
    const sessionQuery = binding.contextSessionId ? descriptor(
      "SELECT context_id,principal_user_id,organization_id,project_access_id,expires_at,revoked_at FROM project_context_sessions" +
      " WHERE context_id=? AND principal_user_id=? AND organization_id=? AND project_access_id=?",
    [binding.contextSessionId, principal.userId, binding.scope?.organizationId ?? "", binding.scope?.projectAccessId ?? ""]) : null;
    const firstQueries = [headerQuery, dependencyQuery, nativeMemoryEnrollmentQuery(captured, authority.LIVE_MEMORY_POLICY),
      ...(pilotQuery ? [pilotQuery] : []), ...(sessionQuery ? [sessionQuery] : [])];
    const prepareQuery = (query: NativeMemoryQuery) => env.DB.prepare(query.sql).bind(...query.bindings);
    const prepareGuard = (guard: Guard) => env.DB.prepare("SELECT CASE WHEN (" + guard.sql + ") THEN 1 ELSE 0 END AS verified").bind(...guard.bindings);
    const firstStatements = firstQueries.map(prepareQuery);
    const first = capturedResults(await env.DB.batch<Row>([
      prepareGuard(requestGuard), ...firstStatements, prepareGuard(requestGuard), env.DB.prepare(CLOCK),
    ]), firstStatements.length + 3);
    if (first[0].results.length !== 1 || first[0].results[0].verified !== 1
      || first.at(-2)!.results.length !== 1 || first.at(-2)!.results[0].verified !== 1
      || first.at(-1)!.results.length !== 1 || first[1].results.length !== 1 || first[3].results.length !== 1) return null;
    const initialAt = timestamp(first.at(-1)!.results[0].checked_at);
    if (initialAt === null) return null;
    const checked = validateNativeMemoryOriginRows(first[1].results[0], first[2].results);
    if (!checked) return null;
    const { header, dependencies } = checked;
    const e = first[3].results[0] as unknown as LiveMemoryEnrollment;
    if (header.status !== "active" || header.withdrawn_at !== null || header.withdrawal_reason !== null
      || !enrollmentMatches(e, header) || timestamp(header.created_at)! > initialAt) return null;
    // A v1 event marker cannot certify contradictory structured provenance.
    // Total 0033 absence remains compatible, but its exact schema guard is
    // replayed so arrival during this read cannot bypass the exclusion.
    const structuredSchema = await nativeStructuredOriginSchema(env);
    const structuredConflict = structuredSchema.present ? descriptor(`SELECT origin_id FROM memory_structured_answer_origins
      WHERE user_event_id IN(?,?) OR answer_event_id IN(?,?) OR user_content_id IN(?,?) OR answer_content_id IN(?,?)
        OR manifest_content_ref IN(?,?) OR (actor_user_id,scope_key,turn_id)=(?,?,?) ORDER BY origin_id LIMIT 2`,
    [header.user_event_id, header.answer_event_id, header.user_event_id, header.answer_event_id,
      header.user_content_id, header.answer_content_id, header.user_content_id, header.answer_content_id,
      header.user_content_id, header.answer_content_id, header.actor_user_id, header.scope_key, header.turn_id]) : null;
    const structuredConflictStatement = structuredConflict ? prepareQuery(structuredConflict) : null;
    const structuredConflictResults = structuredConflictStatement
      ? capturedResults(await env.DB.batch<Row>([structuredConflictStatement]), 1) : null;
    if (structuredConflictResults && structuredConflictResults[0].results.length !== 0) return null;
    const deadlines = [started + 60_000, initialAt + 60_000];
    const before = (value: string | null | undefined) => {
      if (value === null) return;
      const parsed = timestamp(value);
      if (parsed === null || parsed <= initialAt) throw new Error("native_origin_expired");
      deadlines.push(parsed);
    };
    before(originalGrantDeadline); before(header.source_retention_ceiling); before(header.answer_expires_at); before(e.expires_at);
    if (pilotQuery) before(nativeMemoryPilotDeadline(first[4].results, configured, initialAt));
    if (sessionQuery) {
      const sessions = first[firstStatements.length].results;
      if (sessions.length !== 1 || sessions[0].revoked_at !== null) return null;
      before(typeof sessions[0].expires_at === "string" ? sessions[0].expires_at : undefined);
    }
    // Old future transitions have already been retained before this await.
    const a = await authority.liveMemoryAuthority(env, e);
    if (!a || a.scopeKey !== header.scope_key) return null;
    before(nativeMemoryGrantDeadline(a.principal, initialAt));
    const enrollmentGuard = authority.liveMemoryEnrollmentGuard(e, "recall");
    const guards: Guard[] = [requestGuard, { sql: a.guard.condition, bindings: [...a.guard.bindings] },
      { sql: enrollmentGuard.condition, bindings: [...enrollmentGuard.bindings] }];
    const turnGuard = authority.liveMemoryTurnGuard(a);
    const ancestryQuery = nativeMemoryOriginAncestryQuery(dependencies);
    const queries = [nativeMemoryOriginPairQuery(header, { sql: turnGuard.condition, bindings: [...turnGuard.bindings] }),
      nativeMemoryOriginSourcesQuery(e, source.liveMemorySourceQuery(e, a), header, dependencies),
      nativeMemoryOriginSegmentsQuery(dependencies), nativeMemoryOriginPaidSourcesQuery(header, dependencies),
      descriptor(ancestryQuery.sql, ancestryQuery.bindings)];
    const statements = queries.map(prepareQuery);
    const second = capturedResults(await env.DB.batch<Row>([
      ...guards.map(prepareGuard), ...statements, ...guards.map(prepareGuard), env.DB.prepare(CLOCK),
    ]), 12);
    if ([0, 1, 2, 8, 9, 10].some(index => second[index].results.length !== 1 || second[index].results[0].verified !== 1)
      || second[3].results.length !== 1 || second[4].results.length !== dependencies.length
      || second[6].results.length !== 0 || second[7].results.length !== 0 || second[11].results.length !== 1) return null;
    const checkedAt = timestamp(second[11].results[0].checked_at), answer = second[3].results[0];
    if (checkedAt === null || checkedAt < initialAt || answer.answer_text !== wanted.answer || typeof answer.user_text !== "string"
      || !nativeMemoryOriginSegmentsMatch(dependencies, second[5].results, checkedAt)) return null;
    before(typeof answer.answer_expires_at === "string" ? answer.answer_expires_at : undefined);
    before(typeof answer.user_expires_at === "string" ? answer.user_expires_at : undefined);
    for (const field of ["answer_assigned_expires_at", "user_assigned_expires_at"] as const) {
      if (e.organization_id !== null) before(typeof answer[field] === "string" ? answer[field] : undefined);
      else if (answer[field] !== null) return null;
    }
    const byId = new Map(dependencies.map(row => [row.event_id, row]));
    const projections: { expected: string; value: ReturnType<typeof nativeMemorySourceProjection> }[] = [];
    for (const row of second[4].results) {
      const dependency = byId.get(String(row.event_id));
      if (!dependency) return null;
      byId.delete(dependency.event_id);
      const until = liveMemorySourceDeadline(row as unknown as Parameters<typeof liveMemorySourceDeadline>[0], e, checkedAt);
      if (!until) return null;
      before(until); before(dependency.source_retention_ceiling); before(dependency.segment_retention_ceiling);
      projections.push({ expected: dependency.projection_sha256,
        value: nativeMemorySourceProjection(row as unknown as NativeMemorySourceProjectionInput) });
    }
    if (byId.size) return null;
    for (const segment of second[5].results) before(typeof segment.expires_at === "string" ? segment.expires_at : undefined);
    // All database-returned objects, target bytes and projections above belong
    // to this request before the first hashing await. Never retain mutable driver rows.
    if (await nativeMemoryAnswerFingerprint(wanted.answer) !== header.answer_sha256
      || await nativeMemoryAnswerFingerprint(answer.user_text as string) !== header.user_sha256
      || await nativeMemoryDependencyListFingerprint(dependencies) !== header.dependency_list_sha256) return null;
    for (const projection of projections) if (await nativeMemoryFingerprint(projection.value) !== projection.expected) return null;
    const until = Math.min(...deadlines);
    if (Date.now() >= until || until <= checkedAt || !enabled(env, principal.userId)) return null;
    observer.observe(firstStatements, first.slice(1, 1 + firstStatements.length), firstQueries);
    observer.observe(statements, second.slice(3, 8), queries);
    if (structuredConflict && structuredConflictStatement && structuredConflictResults)
      observer.observe([structuredConflictStatement], structuredConflictResults, [structuredConflict]);
    observer.require({ sql: structuredSchema.guard.condition, bindings: [...structuredSchema.guard.bindings] });
    guards.forEach(guard => observer.require({ sql: guard.sql, bindings: [...guard.bindings] }));
    const validUntil = new Date(until).toISOString(); observer.before(validUntil);
    return Date.now() < until ? { originId: header.origin_id, validUntil } : null;
  } catch {
    return null;
  }
}

// Structured v2 is a distinct provenance protocol. The v1 selectors and decoder
// above remain unchanged; a missing or invalid v2 manifest never falls back to
// ordinary chat or to the extractive v1 reader.
type StructuredOriginPairHeader = {
  origin_id: string; actor_user_id: string; owner_user_id: string;
  organization_id: string | null; project_access_id: string | null;
  project_id: string; document_id: string; scope_key: string; turn_id: string;
  user_event_id: string; user_content_id: string; user_source_sequence: number;
  answer_event_id: string; answer_content_id: string; answer_source_sequence: number;
  manifest_content_ref: string; answer_expires_at: string; manifest_expires_at: string; created_at: string;
};

/** Exact three-body native footprint. The manifest is neither event hydration
 * nor an authored message. Every matching row is retained by the caller's final
 * read witness; this SELECT alone is not principal or source authorization. */
export function nativeStructuredMemoryOriginPairQuery(header: StructuredOriginPairHeader, turnGuard: Guard,
  v1Present = true): NativeMemoryQuery {
  const shared = header.organization_id !== null;
  const receiptPrefix = "assistant:" + header.actor_user_id + ":" + (header.project_access_id ?? "personal")
    + ":" + header.document_id + ":" + header.turn_id;
  const pairCustody = shared ? `NOT EXISTS(SELECT 1 FROM (SELECT event.event_id AS id,event.sequence AS sequence
      UNION ALL SELECT message.event_id,message.sequence) pair WHERE NOT EXISTS(SELECT 1 FROM project_event_scopes custody
      WHERE (custody.event_id,custody.source_stream_id,custody.source_sequence,custody.organization_id,custody.project_access_id,
        custody.project_id,custody.owner_user_id,custody.actor_user_id)=(pair.id,event.stream_id,pair.sequence,?,?,?,?,?)))`
    : "NOT EXISTS(SELECT 1 FROM project_event_scopes custody WHERE custody.event_id IN(event.event_id,message.event_id))";
  const bodyCustody = shared ? `NOT EXISTS(SELECT 1 FROM
      (SELECT authored.content_id AS id UNION ALL SELECT answer.content_id UNION ALL SELECT manifest.content_id) body
      WHERE (SELECT COUNT(*) FROM project_resource_scopes resource WHERE resource.resource_kind='content' AND resource.resource_id=body.id)<>1
        OR NOT EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='content' AND resource.resource_id=body.id
          AND (resource.organization_id,resource.project_access_id,resource.project_id,resource.owner_user_id,resource.actor_user_id,
            resource.visibility,resource.source_event_id,resource.created_at) IS (?,?,?,?,?,'actor_private',NULL,turn.created_at))
        OR (SELECT COUNT(*) FROM private_content_retention_scopes retention WHERE retention.content_id=body.id)<>1
        OR NOT EXISTS(SELECT 1 FROM private_content_retention_scopes retention WHERE retention.content_id=body.id
          AND (retention.organization_id,retention.project_access_id,retention.project_id,retention.actor_user_id,
            retention.classification,retention.created_at) IS (?,?,?,?,'transient-private',turn.created_at)
          AND typeof(retention.policy_version)='integer' AND retention.policy_version BETWEEN 0 AND 9007199254740991
          AND retention.assigned_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')))`
    : `NOT EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='content'
        AND resource.resource_id IN(authored.content_id,answer.content_id,manifest.content_id))
      AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes retention
        WHERE retention.content_id IN(authored.content_id,answer.content_id,manifest.content_id))`;
  return descriptor(`SELECT answer.content AS answer_text,authored.content AS user_text,manifest.content AS manifest_text,
      authored.expires_at AS user_expires_at,answer.expires_at AS answer_expires_at,manifest.expires_at AS manifest_expires_at,
      event.event_id,event.stream_id,event.sequence,event.type,event.actor,event.client_id,event.correlation_id,event.causation_id,
      event.occurred_at,event.recorded_at,event.payload,secret.private_json,
      message.event_id AS user_event_id,message.sequence AS user_sequence,message.payload AS user_payload,
      message.occurred_at AS user_occurred_at,message.recorded_at AS user_recorded_at,message_secret.private_json AS user_private_json,
      (SELECT MIN(retention.assigned_expires_at) FROM private_content_retention_scopes retention
        WHERE retention.content_id IN(authored.content_id,answer.content_id,manifest.content_id)) AS assigned_expires_at
    FROM assistant_turns turn JOIN private_content answer
      ON (answer.content_id,answer.owner_id,answer.kind,answer.redacted_at) IS (turn.assistant_content_ref,turn.actor_user_id,'chat-assistant-memory',NULL)
      AND answer.expires_at=? AND answer.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND length(CAST(answer.content AS BLOB)) BETWEEN 1 AND 65536
    JOIN private_content authored ON (authored.content_id,authored.owner_id,authored.kind,authored.redacted_at)
      IS (turn.user_content_ref,turn.actor_user_id,'chat-user',NULL) AND authored.content_id=?
      AND authored.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND length(CAST(authored.content AS BLOB)) BETWEEN 1 AND 65536
    JOIN private_content manifest ON (manifest.content_id,manifest.owner_id,manifest.kind,manifest.redacted_at)
      IS (?,turn.actor_user_id,'memory-structured-origin',NULL) AND manifest.expires_at=?
      AND manifest.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND length(CAST(manifest.content AS BLOB)) BETWEEN 1 AND 65536
    JOIN events event ON event.event_id=? AND event.stream_id=? AND event.sequence=? AND event.type='AssistantReasoned'
      AND event.actor=? AND event.client_id='web:assistant' AND event.schema_version=1 AND event.compensates_event_id IS NULL
      AND event.correlation_id=? AND json_extract(event.payload,'$.operation')='creative-chat'
      AND length(CAST(event.payload AS BLOB))<=65536 AND json_valid(event.payload)
      AND json_type(event.payload,'$.memory_origin_version')='integer' AND json_extract(event.payload,'$.memory_origin_version')=2
      AND json_type(event.payload,'$.organization_id') IS CASE WHEN turn.organization_id IS NULL THEN 'null' ELSE 'text' END
      AND json_type(event.payload,'$.project_access_id') IS CASE WHEN turn.project_access_id IS NULL THEN 'null' ELSE 'text' END
      AND json_extract(event.payload,'$.organization_id') IS turn.organization_id
      AND json_extract(event.payload,'$.project_access_id') IS turn.project_access_id
      AND json_extract(event.payload,'$.owner_user_id')=? AND json_type(event.payload,'$.proposal_count') IS NULL
      AND json_extract(event.payload,'$.turn_id')=turn.turn_id AND json_extract(event.payload,'$.content_ref')=answer.content_id
      AND json_extract(event.payload,'$.actor_user_id')=turn.actor_user_id
      AND json_extract(event.payload,'$.project_id')=turn.project_id AND json_extract(event.payload,'$.document_id')=turn.document_id
    JOIN events message ON message.event_id=? AND message.sequence=? AND message.stream_id=event.stream_id
      AND message.type='ChatMessageSent' AND message.actor=event.actor AND message.client_id='web:assistant'
      AND message.schema_version=1 AND message.compensates_event_id IS NULL AND message.causation_id IS NULL
      AND event.causation_id=message.event_id AND event.sequence=message.sequence+1 AND message.correlation_id=event.correlation_id
      AND length(CAST(message.payload AS BLOB))<=65536 AND json_valid(message.payload)
      AND json_type(message.payload,'$.memory_origin_version') IS NULL
      AND json_extract(message.payload,'$.turn_id')=turn.turn_id AND json_extract(message.payload,'$.content_ref')=authored.content_id
      AND json_extract(message.payload,'$.actor_user_id')=turn.actor_user_id
      AND json_extract(message.payload,'$.project_id')=turn.project_id AND json_extract(message.payload,'$.document_id')=turn.document_id
    JOIN event_client_receipts user_receipt ON (user_receipt.stream_id,user_receipt.client_event_id,user_receipt.event_id,user_receipt.sequence)
      =(message.stream_id,?,message.event_id,message.sequence)
    JOIN event_client_receipts answer_receipt ON (answer_receipt.stream_id,answer_receipt.client_event_id,answer_receipt.event_id,answer_receipt.sequence)
      =(event.stream_id,?,event.event_id,event.sequence)
    LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id
    LEFT JOIN event_private_payloads message_secret ON message_secret.private_event_id=message.event_id
    WHERE (turn.actor_user_id,turn.scope_key,turn.turn_id,turn.organization_id,turn.project_access_id,
      turn.project_id,turn.document_id,turn.assistant_content_ref) IS (?,?,?,?,?,?,?,?) AND turn.proposal_json IS NULL
      AND turn.created_at=? AND turn.completed_at=turn.created_at
      AND (authored.created_at,answer.created_at,manifest.created_at,user_receipt.created_at,answer_receipt.created_at,
        message.occurred_at,message.recorded_at,event.occurred_at,event.recorded_at)
        =(turn.created_at,turn.created_at,turn.created_at,turn.created_at,turn.created_at,
          turn.created_at,turn.created_at,turn.created_at,turn.created_at)
      AND turn.created_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND (json_extract(event.payload,'$._private_ref') IS NULL AND secret.private_event_id IS NULL
        OR json_extract(event.payload,'$._private_ref')=event.event_id
          AND (secret.owner_id,secret.project_id,secret.document_id,secret.redacted_at,secret.created_at)
            IS (?,?,?,NULL,turn.created_at) AND length(CAST(secret.private_json AS BLOB))<=65536 AND json_valid(secret.private_json))
      AND (json_extract(message.payload,'$._private_ref') IS NULL AND message_secret.private_event_id IS NULL
        OR json_extract(message.payload,'$._private_ref')=message.event_id
          AND (message_secret.owner_id,message_secret.project_id,message_secret.document_id,message_secret.redacted_at,message_secret.created_at)
            IS (?,?,?,NULL,turn.created_at) AND length(CAST(message_secret.private_json AS BLOB))<=65536 AND json_valid(message_secret.private_json))
      AND (${pairCustody}) AND (${bodyCustody}) AND (${turnGuard.sql})
      AND NOT EXISTS(SELECT 1 FROM assistant_specialist_tasks task WHERE
        (task.actor_user_id,task.scope_key,task.turn_id)=(turn.actor_user_id,turn.scope_key,turn.turn_id))
      AND NOT EXISTS(SELECT 1 FROM assistant_action_proposals proposal WHERE
        (proposal.actor_user_id,proposal.scope_key,proposal.turn_id)=(turn.actor_user_id,turn.scope_key,turn.turn_id))
      AND NOT EXISTS(SELECT 1 FROM events proposal WHERE proposal.stream_id=event.stream_id AND proposal.type='MutationProposed'
        AND json_extract(proposal.payload,'$.turn_id')=turn.turn_id)
      AND NOT EXISTS(SELECT 1 FROM events alias WHERE alias.event_id NOT IN(message.event_id,event.event_id)
        AND json_extract(alias.payload,'$.content_ref') IN(authored.content_id,answer.content_id,manifest.content_id))
      AND (${v1Present ? `NOT EXISTS(SELECT 1 FROM memory_native_answer_origins other
        WHERE other.user_event_id IN(message.event_id,event.event_id) OR other.answer_event_id IN(message.event_id,event.event_id)
          OR other.user_content_id IN(authored.content_id,answer.content_id,manifest.content_id)
          OR other.answer_content_id IN(authored.content_id,answer.content_id,manifest.content_id)
          OR (other.actor_user_id,other.scope_key,other.turn_id)=(turn.actor_user_id,turn.scope_key,turn.turn_id))` : "1"})
      AND NOT EXISTS(SELECT 1 FROM memory_structured_answer_origins other WHERE other.origin_id<>?
        AND (other.user_event_id IN(message.event_id,event.event_id) OR other.answer_event_id IN(message.event_id,event.event_id)
          OR other.user_content_id IN(authored.content_id,answer.content_id,manifest.content_id)
          OR other.answer_content_id IN(authored.content_id,answer.content_id,manifest.content_id)
          OR other.manifest_content_ref IN(authored.content_id,answer.content_id,manifest.content_id)
          OR (other.actor_user_id,other.scope_key,other.turn_id)=(turn.actor_user_id,turn.scope_key,turn.turn_id))) LIMIT 2`,
  [header.answer_expires_at, header.user_content_id, header.manifest_content_ref, header.manifest_expires_at,
    header.answer_event_id, "creative:" + header.owner_user_id, header.answer_source_sequence,
    "user:" + header.actor_user_id, header.actor_user_id + ":" + header.turn_id, header.owner_user_id,
    header.user_event_id, header.user_source_sequence, receiptPrefix + ":user", receiptPrefix + ":assistant",
    header.actor_user_id, header.scope_key, header.turn_id, header.organization_id, header.project_access_id,
    header.project_id, header.document_id, header.answer_content_id, header.created_at,
    header.owner_user_id, header.project_id, header.document_id, header.owner_user_id, header.project_id, header.document_id,
    ...(shared ? [header.organization_id, header.project_access_id, header.project_id, header.owner_user_id, header.actor_user_id,
      header.organization_id, header.project_access_id, header.project_id, header.owner_user_id, header.actor_user_id,
      header.organization_id, header.project_access_id, header.project_id, header.actor_user_id] : []),
    ...turnGuard.bindings, header.origin_id]);
}

import { nativeMemoryCanonical, nativeStructuredOriginSchema, validateNativeStructuredOriginRows,
  validateNativeStructuredOriginManifest, nativeStructuredOriginalProjection,
  type NativeStructuredMemoryOriginHeader, type NativeStructuredMemoryOriginOriginal,
  type NativeStructuredMemoryOriginRevision, type NativeStructuredMemoryOriginManifest } from "./memory-native-origin.ts";
import { prepareNativeStructuredConversationContext, nativeStructuredConversationContextEvidence,
  revalidateNativeStructuredConversationProjection, nativeStructuredConversationContextPrecommitStatements,
  type PreparedNativeStructuredConversationContext } from "./memory-live-context.ts";
import { prepareNativeMemorySelection, nativeMemorySelectionStatements, replayNativeMemorySelection,
  discoverNativeStructuredConversationOriginals } from "./memory-live-store.ts";

type StructuredOriginCurrentEvidence = NonNullable<Awaited<ReturnType<typeof nativeStructuredConversationContextEvidence>>>;
type StructuredOriginSelection = NonNullable<Awaited<ReturnType<typeof prepareNativeMemorySelection>>>;
const structuredOriginSettings = (env: WorkerEnv) => JSON.stringify([
  env.FORMA_MEMORY_ENABLED, env.FORMA_MEMORY_USER_IDS, env.FORMA_PILOT_COHORT_ID, env.FORMA_ADMIN_EMAILS,
]);
function structuredOriginResults(results: D1Result<Row>[], count: number): D1Result<Row>[] {
  const owned = capturedResults(results, count);
  if (owned.some(result => result.success !== true || (result as typeof result & {error?: unknown}).error !== undefined)) throw new Error("native_structured_origin_result");
  return owned;
}
const structuredOriginalReference = (row: StructuredOriginCurrentEvidence["source"]["originals"][number]) => ({
  eventId: row.eventId, sequence: row.sequence, turnId: row.turnId, role: row.role,
  contentRef: row.contentRef, contentHash: row.contentHash,
});
function structuredOriginEnrollmentMatches(e: LiveMemoryEnrollment, h: NativeStructuredMemoryOriginHeader): boolean {
  return e.enrollment_id === h.enrollment_id && e.revision === h.enrollment_revision
    && e.actor_user_id === h.actor_user_id && e.owner_user_id === h.owner_user_id
    && e.organization_id === h.organization_id && e.project_access_id === h.project_access_id
    && e.project_id === h.project_id && e.document_id === h.document_id
    && e.permission_epoch === h.permission_epoch && e.policy_version === h.policy_version
    && e.enrolled_at === h.enrolled_at && e.expires_at === h.enrollment_expires_at
    && e.retention_days === h.retention_days && e.recall_enabled === 1;
}

/** Data comparison only: the caller must obtain evidence through the genuine
 * store/context reader and preserve its private proof separately. A matching
 * digest, copied object or persisted manifest is never current authority. */
export async function nativeStructuredMemoryOriginEvidenceMatches(header: NativeStructuredMemoryOriginHeader,
  originals: readonly NativeStructuredMemoryOriginOriginal[], revisions: readonly NativeStructuredMemoryOriginRevision[],
  manifest: NativeStructuredMemoryOriginManifest, evidence: StructuredOriginCurrentEvidence): Promise<boolean> {
  try {
    if (!Array.isArray(originals) || originals.length < 2 || originals.length > 128
      || !Array.isArray(revisions) || revisions.length < 1 || revisions.length > 64
      || !Array.isArray(evidence?.source?.originals) || evidence.source.originals.length > 128
      || !Array.isArray(evidence?.sourceEvidence?.ledgerRevisions) || evidence.sourceEvidence.ledgerRevisions.length > 64
      || typeof manifest?.contextJson !== "string" || new TextEncoder().encode(manifest.contextJson).byteLength > 16_384) return false;
    const owned = structuredClone({ header, originals, revisions, manifest,
      source: evidence.source, sourceEvidence: evidence.sourceEvidence });
    const h = owned.header, current = owned.sourceEvidence, source = owned.source;
    const head = current.head;
    if (!head || source.read.status !== "active" || source.read.ledgerId !== h.ledger_id
      || source.read.revision !== h.ledger_storage_revision || head.ledger_id !== h.ledger_id
      || head.storage_revision !== h.ledger_storage_revision || head.current_body_ref !== h.ledger_body_ref
      || head.current_body_hash !== h.ledger_body_sha256 || source.sourceHead < h.answer_source_sequence
      || nativeMemoryCanonical(current.intervals) !== nativeMemoryCanonical(owned.manifest.intervals)
      || owned.manifest.sourceHead !== h.source_head || owned.manifest.originals.length !== owned.originals.length
      || source.originals.length !== owned.originals.length || current.ledgerRevisions.length !== owned.revisions.length
      || nativeMemoryCanonical(source.originals.map(structuredOriginalReference)) !== nativeMemoryCanonical(owned.manifest.originals)
      || !structuredOriginEnrollmentMatches(current.enrollment, h)) return false;
    const retained = new Set(source.read.ledger.originals.map(row => row.eventId));
    let savedContext: unknown;
    try { savedContext = JSON.parse(owned.manifest.contextJson); } catch { return false; }
    if (!savedContext || typeof savedContext !== "object" || Array.isArray(savedContext)
      || !Array.isArray((savedContext as { recentOriginals?: unknown }).recentOriginals)) return false;
    const presented = new Set(((savedContext as { recentOriginals: { eventId: string }[] }).recentOriginals).map(row => row.eventId));
    for (let index = 0; index < owned.originals.length; index++) {
      const saved = owned.originals[index], original = source.originals[index];
      const sourceCeiling = original && new Date(Math.min(Date.parse(original.expiresAt),
        Date.parse(original.recordedAt) + current.enrollment.retention_days * 86_400_000,
        Date.parse(current.enrollment.expires_at))).toISOString();
      if (!original || saved.origin_id !== h.origin_id || saved.ordinal !== index || saved.event_id !== original.eventId
        || saved.event_stream_id !== source.scope.streamId || saved.source_sequence !== original.sequence
        || saved.event_type !== (original.role === "user" ? "ChatMessageSent" : "AssistantReasoned")
        || saved.role !== original.role || saved.turn_id !== original.turnId || saved.content_id !== original.contentRef
        || saved.content_sha256 !== original.contentHash || saved.recorded_at !== original.recordedAt
        || saved.retained_by_ledger !== (retained.has(original.eventId) ? 1 : 0)
        || saved.presented_in_context !== (presented.has(original.eventId) ? 1 : 0)
        || saved.source_retention_ceiling !== sourceCeiling
        || await nativeMemoryFingerprint(nativeStructuredOriginalProjection(original)) !== saved.projection_sha256) return false;
    }
    for (let index = 0; index < owned.revisions.length; index++) {
      const saved = owned.revisions[index], currentRevision = current.ledgerRevisions[index]?.revision as Row | undefined;
      if (!currentRevision || saved.origin_id !== h.origin_id || saved.ordinal !== index || saved.ledger_id !== h.ledger_id
        || saved.storage_revision !== currentRevision.revision || saved.predecessor_revision !== currentRevision.predecessor_revision
        || saved.predecessor_hash !== currentRevision.predecessor_hash || saved.body_ref !== currentRevision.body_ref
        || saved.body_hash !== currentRevision.body_hash || saved.created_at !== currentRevision.created_at
        || saved.expires_at !== currentRevision.expires_at) return false;
    }
    return await nativeMemoryFingerprint(owned.originals) === h.source_list_sha256
      && await nativeMemoryFingerprint(owned.revisions) === h.ledger_history_sha256;
  } catch { return false; }
}

type StructuredOriginReadFrame = {
  env: WorkerEnv; db: WorkerEnv["DB"]; selection: StructuredOriginSelection;
  context: PreparedNativeStructuredConversationContext; current: () => boolean;
  validUntil: string; result: NativeMemoryOriginRead;
};
const structuredOriginReadFrames = new WeakMap<NativeMemoryOriginRead, StructuredOriginReadFrame>();

/** Private native assertions are separate from the caller's ordinary read
 * observer. They must be acknowledged in the SAME final read batch as that
 * observer. No SQL is reconstructed from a manifest, and no descriptorless
 * observed assertion is later misrepresented as a write-capable witness. */
export function nativeStructuredMemoryOriginReadStatements(env: WorkerEnv,
  read: NativeMemoryOriginRead): D1PreparedStatement[] | null {
  try {
    const frame = structuredOriginReadFrames.get(read);
    if (!frame || frame.env !== env || frame.db !== env.DB || frame.result !== read || !frame.current()
      || Date.now() >= Date.parse(frame.validUntil)) return null;
    const selected = nativeMemorySelectionStatements(env, frame.selection);
    const contextual = nativeStructuredConversationContextPrecommitStatements(env, frame.context.proof);
    // V2-only composition: two source passes of at most 30 each, two ledger
    // assertions and one context deadline (63), selection at most 7, and this
    // reader's deadline (1). The independent observer keeps its unchanged 32
    // limit; the consumer's combined v2 final-batch ceiling is therefore 103.
    // No source/witness row, byte, SQL or binding limit is increased here.
    if (!selected || !contextual || !selected.length || !contextual.length || selected.length + contextual.length + 1 > 71) return null;
    const statements = [...selected, ...contextual, frame.db.prepare(`SELECT CASE WHEN
      strftime('%Y-%m-%dT%H:%M:%fZ','now')<? THEN 1
      ELSE json('native_structured_origin_read_expired') END AS context_source_asserted`).bind(frame.validUntil)];
    return frame.current() && env.DB === frame.db ? statements : null;
  } catch { return null; }
}

/** Synchronous input/lease check AFTER the final native batch. It is not a
 * replacement for executing and acknowledging the statements above. */
export function nativeStructuredMemoryOriginReadCurrent(env: WorkerEnv, read: NativeMemoryOriginRead): boolean {
  const frame = structuredOriginReadFrames.get(read);
  try { return Boolean(frame && frame.env === env && frame.db === env.DB && frame.result === read
    && frame.current() && Date.now() < Date.parse(frame.validUntil)
    && nativeStructuredMemoryOriginReadStatements(env, read)); } catch { return false; }
}

/** Only the actual final-batch slice can acknowledge these native assertions.
 * The enclosing observer must independently match its own slice. */
export function nativeStructuredMemoryOriginReadMatches(env: WorkerEnv, read: NativeMemoryOriginRead,
  results: readonly D1Result<Row>[]): boolean {
  try {
    const statements = nativeStructuredMemoryOriginReadStatements(env, read);
    return !!statements && Array.isArray(results) && results.length === statements.length
      && Array.from({ length: statements.length }, (_, index) => Object.getOwnPropertyDescriptor(results, String(index))?.value).every(result =>
      result?.success === true && result.error === undefined && Array.isArray(result.results) && result.results.length === 1
      && Object.keys(result.results[0]).length === 1 && Object.keys(result.results[0])[0] === "context_source_asserted"
      && result.results[0].context_source_asserted === 1) && nativeStructuredMemoryOriginReadCurrent(env, read);
  } catch { return false; }
}

import { publicEventPayload } from "./event-privacy.ts";
import { canonicalConsent } from "./consequential-consent.ts";

function structuredOriginOwnEnvelopes(header: NativeStructuredMemoryOriginHeader, pair: Row): boolean {
  try {
    const shapes = [
      [header.user_event_id, pair.user_payload, pair.user_private_json, header.user_content_id, false],
      [header.answer_event_id, pair.payload, pair.private_json, header.answer_content_id, true],
    ] as const;
    let surface: string | null = null;
    for (const [eventId, publicJson, privateJson, contentId, answer] of shapes) {
      if (typeof publicJson !== "string" || typeof privateJson !== "string"
        || new TextEncoder().encode(publicJson).byteLength > 65_536
        || new TextEncoder().encode(privateJson).byteLength > 65_536) return false;
      const payload: unknown = JSON.parse(privateJson);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
      const row = payload as Row, keys = ["project_id", "document_id", "actor_user_id", "source_surface", "turn_id", "content_ref",
        ...(answer ? ["operation", "deterministic", "memory_origin_version", "organization_id", "project_access_id", "owner_user_id"] : [])];
      if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key))
        || row.project_id !== header.project_id || row.document_id !== header.document_id
        || row.actor_user_id !== header.actor_user_id || row.turn_id !== header.turn_id || row.content_ref !== contentId
        || !id(row.source_surface) || surface !== null && row.source_surface !== surface) return false;
      surface = row.source_surface;
      if (answer && (row.operation !== "creative-chat" || row.deterministic !== true || row.memory_origin_version !== 2
        || row.organization_id !== header.organization_id || row.project_access_id !== header.project_access_id
        || row.owner_user_id !== header.owner_user_id)) return false;
      const expected = publicEventPayload(eventId, row, true);
      if (expected.privateJson !== privateJson || JSON.stringify(expected.payload) !== publicJson) return false;
    }
    return true;
  } catch { return false; }
}

/** Saved structured answers require BOTH enclosing observed row replay AND the
 * returned read's private native assertions. A fresh short read lease is capped
 * by immutable source, ledger, enrollment, answer and manifest retention; it
 * does not renew the original publication lease kept in the private manifest. */
export async function revalidateNativeStructuredAnswerOrigin(env: WorkerEnv, prepared: NativeMemoryPreparedDocument,
  target: NativeMemoryOriginTarget, observer: NativeMemoryContextObserver): Promise<NativeMemoryOriginRead | null> {
  if (!observer || typeof observer.observe !== "function" || typeof observer.require !== "function" || typeof observer.before !== "function") return null;
  try {
    const captured = structuredClone(prepared), wanted = structuredClone(target), db = env.DB;
    const preparedKey = canonicalConsent(prepared), targetKey = canonicalConsent(target), settings = structuredOriginSettings(env);
    const current = () => env.DB === db && settings === structuredOriginSettings(env)
      && canonicalConsent(prepared) === preparedKey && canonicalConsent(target) === targetKey;
    const principal = captured?.principal, binding = captured?.binding, started = Date.now();
    if (!principal || !binding || !wanted || ![wanted.originId, wanted.turnId, wanted.answerEventId, wanted.answerContentId].every(id)
      || typeof wanted.answer !== "string" || !wanted.answer || !wanted.answer.isWellFormed()
      || new TextEncoder().encode(wanted.answer).byteLength > MAX_ANSWER_BYTES
      || !enabled(env, principal.userId) || principal.fictional || !principal.authorizationSnapshot
      || !id(binding.projectId) || !id(binding.documentId) || principal.userId !== binding.actorUserId
      || principal.access.permissionEpoch !== binding.permissionEpoch
      || binding.streamId !== "creative:" + (binding.scope?.ownerUserId ?? principal.userId)
      || binding.scope && (binding.scope.actorUserId !== principal.userId || binding.scope.projectId !== binding.projectId)) return null;
    const originalGrantDeadline = nativeMemoryGrantDeadline(principal, started);
    if (originalGrantDeadline === undefined) return null;
    const schema = await nativeStructuredOriginSchema(env);
    if (!schema.present || !current()) return null;
    const [authority, consent] = await Promise.all([import("./memory-live-authority.ts"), import("./consequential-consent.ts")]);
    if (!current()) return null;
    const requestGuard = consent.executionAdmissionGuard(principal, binding, null);
    const headerQuery = descriptor(`SELECT * FROM memory_structured_answer_origins WHERE origin_id=? AND actor_user_id=?
      AND owner_user_id=? AND organization_id IS ? AND project_access_id IS ? AND project_id=? AND document_id=?
      AND scope_key=? AND turn_id=? AND answer_event_id=? AND answer_content_id=? LIMIT 2`,
    [wanted.originId, principal.userId, binding.scope?.ownerUserId ?? principal.userId,
      binding.scope?.organizationId ?? null, binding.scope?.projectAccessId ?? null, binding.projectId, binding.documentId,
      scopeKey(captured), wanted.turnId, wanted.answerEventId, wanted.answerContentId]);
    const originalQuery = descriptor(`SELECT original.* FROM memory_structured_answer_originals original
      WHERE original.origin_id=? ORDER BY original.ordinal LIMIT 129`, [wanted.originId]);
    const revisionQuery = descriptor(`SELECT revision.* FROM memory_structured_answer_ledger_revisions revision
      WHERE revision.origin_id=? ORDER BY revision.ordinal LIMIT 65`, [wanted.originId]);
    const headQuery = descriptor("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?", [binding.streamId]);
    // Cross-protocol absence is witnessed, including a later schema alteration.
    const v1SchemaQuery = descriptor("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE tbl_name='memory_native_answer_origins' ORDER BY name LIMIT 16", []);
    const firstQueries = [headerQuery, originalQuery, revisionQuery,
      nativeMemoryEnrollmentQuery(captured, authority.LIVE_MEMORY_POLICY), headQuery, v1SchemaQuery];
    const prepareQuery = (query: NativeMemoryQuery) => db.prepare(query.sql).bind(...query.bindings);
    const prepareGuard = (guard: Guard) => db.prepare("SELECT CASE WHEN (" + guard.sql + ") THEN 1 ELSE 0 END AS verified").bind(...guard.bindings);
    const firstStatements = firstQueries.map(prepareQuery);
    const first = structuredOriginResults(await db.batch<Row>([prepareGuard(requestGuard), ...firstStatements,
      prepareGuard(requestGuard), db.prepare(CLOCK)]), firstStatements.length + 3);
    if (!current() || first[0].results.length !== 1 || first[0].results[0].verified !== 1
      || first.at(-2)!.results.length !== 1 || first.at(-2)!.results[0].verified !== 1
      || first.at(-1)!.results.length !== 1 || first[1].results.length !== 1 || first[4].results.length !== 1
      || first[5].results.length !== 1 || !Number.isSafeInteger(first[5].results[0].head)
      || first[6].results.length >= 16 || first[6].results.length > 0 && !first[6].results.some(row =>
        row.type === "table" && row.name === "memory_native_answer_origins" && typeof row.sql === "string")) return null;
    const initialAt = timestamp(first.at(-1)!.results[0].checked_at);
    if (initialAt === null) return null;
    const checked = validateNativeStructuredOriginRows(first[1].results[0], first[2].results, first[3].results);
    if (!checked) return null;
    const { header, originals, ledgerRevisions } = checked;
    const e = first[4].results[0] as unknown as LiveMemoryEnrollment, sourceHead = first[5].results[0].head as number;
    if (header.status !== "active" || header.withdrawn_at !== null || header.withdrawal_reason !== null
      || !structuredOriginEnrollmentMatches(e, header) || timestamp(header.created_at)! > initialAt
      || sourceHead < header.answer_source_sequence) return null;
    const deadlines = [started + 60_000, initialAt + 60_000];
    const before = (value: string | null | undefined) => {
      if (value === null) return;
      const deadline = timestamp(value);
      if (deadline === null || deadline <= initialAt) throw new Error("native_structured_origin_expired");
      deadlines.push(deadline);
    };
    before(originalGrantDeadline); before(header.source_retention_ceiling); before(header.answer_expires_at);
    before(header.manifest_expires_at); before(e.expires_at);
    for (const original of originals) before(original.source_retention_ceiling);
    for (const revision of ledgerRevisions) before(revision.expires_at);
    const a = await authority.liveMemoryAuthority(env, e);
    if (!a || !current() || a.scopeKey !== header.scope_key) return null;
    before(nativeMemoryGrantDeadline(a.principal, initialAt));
    const recall = authority.liveMemoryEnrollmentGuard(e, "recall"), turn = authority.liveMemoryTurnGuard(a);
    const guards: Guard[] = [requestGuard, { sql: schema.guard.condition, bindings: [...schema.guard.bindings] },
      { sql: a.guard.condition, bindings: [...a.guard.bindings] }, { sql: recall.condition, bindings: [...recall.bindings] }];
    const pairQuery = nativeStructuredMemoryOriginPairQuery(header, { sql: turn.condition, bindings: [...turn.bindings] }, first[6].results.length > 0);
    const pairStatement = prepareQuery(pairQuery);
    const second = structuredOriginResults(await db.batch<Row>([...guards.map(prepareGuard), pairStatement,
      ...guards.map(prepareGuard), db.prepare(CLOCK)]), guards.length * 2 + 2);
    const guardIndexes = guards.flatMap((_, index) => [index, guards.length + 1 + index]);
    if (!current() || guardIndexes.some(index => second[index].results.length !== 1 || second[index].results[0].verified !== 1)
      || second[guards.length].results.length !== 1 || second.at(-1)!.results.length !== 1) return null;
    const pair = second[guards.length].results[0], checkedAt = timestamp(second.at(-1)!.results[0].checked_at);
    if (checkedAt === null || checkedAt < initialAt || pair.answer_text !== wanted.answer
      || typeof pair.user_text !== "string" || typeof pair.manifest_text !== "string"
      || !structuredOriginOwnEnvelopes(header, pair)) return null;
    before(typeof pair.user_expires_at === "string" ? pair.user_expires_at : undefined);
    if (header.organization_id !== null) before(typeof pair.assigned_expires_at === "string" ? pair.assigned_expires_at : undefined);
    else if (pair.assigned_expires_at !== null) return null;
    const manifest = validateNativeStructuredOriginManifest(pair.manifest_text);
    if (!manifest || manifest.sourceHead !== header.source_head
      || Date.parse(manifest.publicationValidUntil) <= Date.parse(header.created_at)
      || Date.parse(manifest.publicationValidUntil) > Date.parse(header.source_retention_ceiling)
      || JSON.parse(manifest.contextJson)?.lifetime?.validUntil !== manifest.publicationValidUntil
      || JSON.parse(manifest.contextJson)?.coverage?.sourceHead !== manifest.sourceHead
      || await nativeMemoryAnswerFingerprint(pair.manifest_text) !== header.manifest_sha256
      || await nativeMemoryAnswerFingerprint(manifest.contextJson) !== header.consumed_context_sha256
      || await nativeMemoryAnswerFingerprint(wanted.answer) !== header.answer_sha256
      || await nativeMemoryAnswerFingerprint(pair.user_text) !== header.user_sha256 || !current()) return null;
    const selection = await prepareNativeMemorySelection(env, captured);
    if (!selection || selection.mode !== "structured" || selection.ledgerId !== header.ledger_id
      || !structuredOriginEnrollmentMatches(selection.enrollment, header) || !current()) return null;
    const sourcePrepared = { ...captured, sourceHead };
    // Saved intervals are bounded selection data, never authority. Discovery
    // captures them through native S3 and proves every retained ledger source.
    const discovered = await discoverNativeStructuredConversationOriginals(env, sourcePrepared, selection, manifest.intervals);
    if (!discovered || !current() || nativeMemoryCanonical(discovered.intervals) !== nativeMemoryCanonical(manifest.intervals)) return null;
    const context = await prepareNativeStructuredConversationContext(env, discovered.enrollment, sourcePrepared,
      discovered.captures, manifest.projectionOptions.specifiedMaxBytes ? { maxBytes: manifest.projectionOptions.maxBytes } : {});
    if (!context || !current()) return null;
    const evidence = await nativeStructuredConversationContextEvidence(env, context);
    if (!evidence || !current() || nativeMemoryCanonical(evidence.projectionOptions) !== nativeMemoryCanonical(manifest.projectionOptions)
      || !await nativeStructuredMemoryOriginEvidenceMatches(header, originals, ledgerRevisions, manifest, evidence)
      || !current() || !await revalidateNativeStructuredConversationProjection(env, context, manifest.contextJson, manifest.projectionOptions)
      || !current() || !await replayNativeMemorySelection(env, selection) || !current()) return null;
    before(context.context.lifetime.validUntil); before(context.context.lifetime.ledgerExpiresAt);
    before(evidence.sourceEvidence.sourceRetentionCeiling);
    const until = Math.min(...deadlines), validUntil = new Date(until).toISOString();
    if (until <= checkedAt || Date.now() >= until || !current()) return null;
    const result = Object.freeze({ originId: header.origin_id, validUntil });
    structuredOriginReadFrames.set(result, { env, db, selection, context, current, validUntil, result });
    if (!nativeStructuredMemoryOriginReadStatements(env, result)) { structuredOriginReadFrames.delete(result); return null; }
    observer.observe(firstStatements, first.slice(1, 1 + firstStatements.length), firstQueries);
    observer.observe([pairStatement], [second[guards.length]], [pairQuery]);
    guards.forEach(guard => observer.require({ sql: guard.sql, bindings: [...guard.bindings] }));
    observer.before(validUntil);
    return nativeStructuredMemoryOriginReadCurrent(env, result) ? result : null;
  } catch { return null; }
}

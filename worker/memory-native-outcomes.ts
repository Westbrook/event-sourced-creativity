import type { LiveMemoryEnrollment } from "./memory-live-authority.ts";
import { nativeMemoryDescriptor as descriptor, nativeMemoryTimestamp as timestamp,
  type NativeMemoryQuery, type NativeMemorySqlValue } from "./memory-native-deadlines.ts";
import { parseMemoryAssistedOutcomes, MEMORY_ASSISTED_OUTCOMES_MAX_BYTES } from "../src/model/memory-assisted-outcomes.ts";

/** A reference-only bridge for terminal, free-assistant decisions. It does not
 * authorize a read, infer preferences, measure exposure, or create outcomes.
 * The enclosing native reader must supply its actual eligible selection, replay
 * every observed descriptor, and enforce the returned absolute deadline. */
export const NATIVE_MEMORY_OUTCOMES_VERSION = "native-assisted-outcomes-v1";
export const NATIVE_MEMORY_OUTCOME_LIMITS = { sources: 64, rows: 64, sourceVersions: 16, bytes: MEMORY_ASSISTED_OUTCOMES_MAX_BYTES } as const;
export type NativeMemoryOutcomeSource = { eventId: string; sequence: number; type: string; blockId: string | null; recordedAt: string; validUntil: string };
type SourceQuery = { joins: string; condition: string; bindings: NativeMemorySqlValue[] };
type Row = Record<string, unknown>;
type Enrollment = Pick<LiveMemoryEnrollment, "enrollment_id" | "actor_user_id" | "owner_user_id" | "organization_id"
  | "project_access_id" | "project_id" | "document_id" | "permission_epoch" | "revision" | "enrolled_at"
  | "expires_at" | "retention_days" | "cursor_sequence">;
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 240
  && value.trim() === value && value.isWellFormed();
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 1;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const object = (value: unknown): value is Row => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const exact = (value: Row, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const parse = (value: unknown): Row | null => {
  if (typeof value !== "string" || value.length > 16_384) return null;
  try { const parsed: unknown = JSON.parse(value); return object(parsed) ? parsed : null; } catch { return null; }
};
const scopeKey = (e: Enrollment) => JSON.stringify([e.organization_id ?? "", e.project_access_id ?? "", e.project_id, e.document_id]);
const clock = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const bound = (field: string) => `json_extract(binding.value,'$.${field}')`;
const enrollmentValid = (e: Enrollment) => e && [e.enrollment_id, e.actor_user_id, e.owner_user_id, e.project_id,
  e.document_id, e.permission_epoch].every(id) && integer(e.revision) && Number.isSafeInteger(e.cursor_sequence) && e.cursor_sequence >= 0
  && integer(e.retention_days) && e.retention_days <= 365 && timestamp(e.enrolled_at) !== null && timestamp(e.expires_at) !== null
  && (e.organization_id === null && e.project_access_id === null && e.actor_user_id === e.owner_user_id
    || id(e.organization_id) && id(e.project_access_id));

function selection(e: Enrollment, refs: readonly NativeMemoryOutcomeSource[]) {
  if (!enrollmentValid(e) || !Array.isArray(refs) || refs.length > NATIVE_MEMORY_OUTCOME_LIMITS.sources
    || Array.from({ length: refs.length }, (_, index) => index).some(index => !Object.hasOwn(refs, index))) throw new Error("native_outcome_selection_invalid");
  const ids = new Set<string>(), positions = new Set<number>();
  return refs.map(ref => {
    if (!ref || !id(ref.eventId) || !id(ref.type) || !integer(ref.sequence) || ref.sequence > e.cursor_sequence
      || timestamp(ref.validUntil) === null || timestamp(ref.recordedAt) === null || ref.blockId !== null && !id(ref.blockId)
      || ids.has(ref.eventId) || positions.has(ref.sequence)) throw new Error("native_outcome_selection_invalid");
    ids.add(ref.eventId); positions.add(ref.sequence);
    return { eventId: ref.eventId, sequence: ref.sequence, type: ref.type, blockId: ref.blockId, recordedAt: ref.recordedAt, validUntil: ref.validUntil };
  });
}

export function nativeMemoryOutcomesSchemaQuery(): NativeMemoryQuery {
  return descriptor("SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name IN(" +
    "'events','event_private_payloads','event_client_receipts','private_content','private_content_retention_scopes'," +
    "'project_resource_scopes','project_event_scopes','assistant_action_proposals','assistant_action_commits'," +
    "'assistant_specialist_tasks','memory_live_sources'))=11 THEN 1 ELSE 0 END AS ready", []);
}

// Explicit native custody only; no implicit project/document reconstruction or
// new scope version. An ambiguous, removed, rehomed or inaccessible block omits
// the outcome rather than disclosing its ID through source-version metadata.
function blockEventCustody(event: string) {
  return `(${bound("organization_id")} IS NULL AND ${event}.actor IN('user','user:'||${bound("actor_user_id")})
      AND NOT EXISTS(SELECT 1 FROM project_event_scopes custody WHERE custody.event_id=${event}.event_id)
    OR ${bound("organization_id")} IS NOT NULL
      AND (SELECT COUNT(*) FROM project_event_scopes custody WHERE custody.event_id=${event}.event_id)=1
      AND EXISTS(SELECT 1 FROM project_event_scopes custody WHERE custody.event_id=${event}.event_id
        AND (custody.organization_id,custody.project_access_id,custody.project_id,custody.owner_user_id,custody.source_stream_id,custody.source_sequence)
          IS (${bound("organization_id")},${bound("project_access_id")},${bound("project_id")},${bound("owner_user_id")},${event}.stream_id,${event}.sequence)
        AND length(custody.actor_user_id)>0 AND (${event}.actor='user:'||custody.actor_user_id
          OR ${event}.actor='user' AND custody.actor_user_id=${bound("owner_user_id")})))`;
}
// Native project migration attributes the historical literal "user" to the
// owner. That alias is valid for current resource anchors, not live activity.
const blockActor = (event: string) => `(CASE WHEN ${bound("organization_id")} IS NULL THEN ${bound("actor_user_id")}
  WHEN ${event}.actor='user' THEN ${bound("owner_user_id")} ELSE substr(${event}.actor,6) END)`;
function currentBlock(blockId: string) {
  return `EXISTS(SELECT 1 FROM events anchor LEFT JOIN event_private_payloads anchor_secret ON anchor_secret.private_event_id=anchor.event_id
    WHERE anchor.stream_id='creative:'||${bound("owner_user_id")} AND anchor.type IN('BlockCreated','BlockRehomed')
      AND json_extract(anchor.payload,'$.block_id')=${blockId}
      AND anchor.sequence=(SELECT MAX(latest.sequence) FROM events latest WHERE latest.stream_id=anchor.stream_id
        AND latest.type IN('BlockCreated','BlockRehomed') AND json_extract(latest.payload,'$.block_id')=${blockId})
      AND json_extract(anchor.payload,'$.project_id')=${bound("project_id")}
      AND json_extract(anchor.payload,'$.document_id')=${bound("document_id")}
      AND COALESCE(json_extract(anchor.payload,'$.scope'),CASE WHEN anchor.type='BlockRehomed' THEN 'library' ELSE 'document' END)='document'
      AND json_extract(anchor.payload,'$.canvas_id') IS NULL AND COALESCE(json_extract(anchor.payload,'$.library_block'),0)=0
      AND ${envelope("anchor", "anchor_secret", blockActor("anchor"))} AND ${blockEventCustody("anchor")}
      AND (SELECT MAX(origin.sequence) FROM events origin WHERE origin.stream_id=anchor.stream_id AND origin.type='BlockCreated'
        AND json_extract(origin.payload,'$.block_id')=${blockId})<=CASE WHEN proposal.action_kind='context.create'
          AND json_extract(mutation.payload,'$.block_id')=${blockId} THEN mutation.sequence ELSE proposal.expected_head END
      AND EXISTS(SELECT 1 FROM events boundary LEFT JOIN event_private_payloads boundary_secret ON boundary_secret.private_event_id=boundary.event_id
        WHERE boundary.stream_id=anchor.stream_id AND boundary.type IN('BlockCreated','BlockRestored')
          AND json_extract(boundary.payload,'$.block_id')=${blockId}
          AND boundary.sequence=(SELECT MAX(latest.sequence) FROM events latest WHERE latest.stream_id=anchor.stream_id
            AND latest.type IN('BlockCreated','BlockRemoved','BlockRestored') AND json_extract(latest.payload,'$.block_id')=${blockId})
          AND ${envelope("boundary", "boundary_secret", blockActor("boundary"))} AND ${blockEventCustody("boundary")})
      AND (${bound("organization_id")} IS NULL AND NOT EXISTS(SELECT 1 FROM project_event_scopes foreign_scope WHERE foreign_scope.event_id=anchor.event_id)
        AND NOT EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='block' AND resource.resource_id=${blockId})
        OR ${bound("organization_id")} IS NOT NULL AND (SELECT COUNT(*) FROM project_resource_scopes resource
          WHERE resource.resource_kind='block' AND resource.resource_id=${blockId})=1
          AND EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='block' AND resource.resource_id=${blockId}
            AND (resource.organization_id,resource.project_access_id,resource.project_id,resource.owner_user_id)
              IS (${bound("organization_id")},${bound("project_access_id")},${bound("project_id")},${bound("owner_user_id")})
            AND (resource.visibility='collaborative_output' OR resource.visibility='actor_private' AND resource.actor_user_id=${bound("actor_user_id")}))))`;
}

function envelope(event: string, secret: string, actor = bound("actor_user_id")) {
  const raw = `(CASE WHEN json_valid(${secret}.private_json) THEN ${secret}.private_json ELSE '{}' END)`;
  return `((json_type(${event}.payload,'$.actor_user_id') IS NULL OR json_type(${event}.payload,'$.actor_user_id')='text' AND json_extract(${event}.payload,'$.actor_user_id')=${actor})
    AND (json_extract(${event}.payload,'$._private_ref') IS NULL OR json_extract(${event}.payload,'$._private_ref')=${event}.event_id
    AND (${secret}.owner_id,${secret}.project_id,${secret}.document_id,${secret}.redacted_at)
      IS (${bound("owner_user_id")},${bound("project_id")},${bound("document_id")},NULL) AND json_valid(${secret}.private_json)
    AND (json_type(${raw},'$.actor_user_id') IS NULL OR json_type(${raw},'$.actor_user_id')='text' AND json_extract(${raw},'$.actor_user_id')=${actor})))`;
}

/** Preserve the native q and its first-six JOIN binding convention. Its selected
 * sources are re-read, including both halves of an accepted mutation. Missing
 * rows never authorize reconstruction from a claimed proposal ID. */
export function nativeMemoryOutcomesQuery(e: Enrollment, q: SourceQuery, refs: readonly NativeMemoryOutcomeSource[]): NativeMemoryQuery {
  const selected = selection(e, refs);
  const payload = "(CASE WHEN json_valid(action.content) THEN action.content ELSE '{}' END)";
  const versions = "(CASE WHEN length(CAST(proposal.source_versions_json AS BLOB))<=8192 AND json_valid(proposal.source_versions_json) THEN proposal.source_versions_json ELSE 'null' END)";
  const targetIds = `SELECT CASE WHEN version.type='object' THEN json_extract(version.value,'$.blockId') ELSE NULL END AS block_id FROM json_each(${versions}) version
    UNION SELECT json_extract(${payload},'$.targetBlockId') UNION SELECT json_extract(${payload},'$.fromBlockId')
    UNION SELECT json_extract(${payload},'$.toBlockId') UNION SELECT json_extract(mutation.payload,'$.block_id')
    UNION SELECT json_extract(mutation.payload,'$.from_block_id') UNION SELECT json_extract(mutation.payload,'$.to_block_id')`;
  const receipt = (alias: string, key: string) => `((SELECT COUNT(*) FROM (SELECT 1 FROM event_client_receipts receipt
    WHERE receipt.stream_id=${alias}.stream_id AND receipt.client_event_id=${key} LIMIT 2))=1
    AND EXISTS(SELECT 1 FROM event_client_receipts receipt WHERE receipt.stream_id=${alias}.stream_id
      AND receipt.client_event_id=${key} AND receipt.event_id=${alias}.event_id AND receipt.sequence=${alias}.sequence))`;
  const sql = `WITH eligible AS (
    SELECT event.*,secret.private_json,remembered.expires_at AS remembered_expires_at
    ${q.joins} JOIN memory_live_sources remembered ON remembered.enrollment_id=?
      AND remembered.event_id=event.event_id AND remembered.sequence=event.sequence
    JOIN json_each(?) selected ON event.event_id=json_extract(selected.value,'$.eventId')
      AND event.sequence=json_extract(selected.value,'$.sequence') AND event.type=json_extract(selected.value,'$.type')
    WHERE ${q.condition} AND event.sequence<=? AND remembered.expires_at>${clock}
      AND event.recorded_at=json_extract(selected.value,'$.recordedAt')
      AND json_extract(event.payload,'$.block_id') IS json_extract(selected.value,'$.blockId')
  ) SELECT
    json_object('eventId',decision.event_id,'sequence',decision.sequence,'type',decision.type,'recordedAt',decision.recorded_at,
      'rememberedUntil',decision.remembered_expires_at) AS decision_json,
    json_object('proposalId',proposal.proposal_id,'turnId',proposal.turn_id,'kind',proposal.action_kind,'status',proposal.status,
      'createdAt',proposal.created_at,'resolvedAt',proposal.resolved_at,'actionDeadline',proposal.expires_at,
      'expectedHead',proposal.expected_head) AS proposal_json,
    json_object('eventId',issued.event_id,'sequence',issued.sequence,'recordedAt',issued.recorded_at) AS issued_json,
    CASE WHEN mutation.event_id IS NULL THEN NULL ELSE json_object('eventId',mutation.event_id,'sequence',mutation.sequence,
      'type',mutation.type,'recordedAt',mutation.recorded_at,'rememberedUntil',mutation.remembered_expires_at,
      'blockId',json_extract(mutation.payload,'$.block_id'),'fromBlockId',json_extract(mutation.payload,'$.from_block_id'),
      'toBlockId',json_extract(mutation.payload,'$.to_block_id'),'relationId',json_extract(mutation.payload,'$.relation_id')) END AS mutation_json,
    json_object('kind',json_extract(${payload},'$.kind'),'targetBlockId',json_extract(${payload},'$.targetBlockId'),
      'fromBlockId',json_extract(${payload},'$.fromBlockId'),'toBlockId',json_extract(${payload},'$.toBlockId')) AS action_json,
    CASE WHEN length(CAST(proposal.source_versions_json AS BLOB))<=8192 THEN proposal.source_versions_json ELSE NULL END AS source_versions_json,
    action.expires_at AS private_expires_at,retention.assigned_expires_at AS assigned_expires_at,
    NOT EXISTS(SELECT 1 FROM (${targetIds}) target WHERE target.block_id IS NOT NULL AND NOT (${currentBlock("target.block_id")})) AS targets_current
  FROM eligible decision JOIN (SELECT ? AS value) binding
  JOIN assistant_action_proposals proposal ON proposal.proposal_id=json_extract(decision.payload,'$.proposal_id')
    AND (proposal.actor_user_id,proposal.scope_key,proposal.organization_id,proposal.project_access_id,proposal.project_id,
      proposal.document_id,proposal.permission_epoch) IS (${bound("actor_user_id")},${bound("scope_key")},${bound("organization_id")},
      ${bound("project_access_id")},${bound("project_id")},${bound("document_id")},${bound("permission_epoch")})
    AND proposal.turn_id=json_extract(decision.payload,'$.turn_id')
    AND proposal.status=CASE decision.type WHEN 'ProposalAccepted' THEN 'accepted' WHEN 'ProposalRejected' THEN 'rejected' END
  JOIN assistant_action_commits committed ON committed.commit_id=proposal.proposal_id||':'||proposal.status AND committed.verified=1
  JOIN private_content action ON action.content_id=proposal.action_content_ref AND action.owner_id=proposal.actor_user_id
    AND action.kind='assistant-action' AND action.redacted_at IS NULL AND action.expires_at>${clock} AND json_valid(action.content)
  LEFT JOIN private_content_retention_scopes retention ON retention.content_id=action.content_id
  JOIN events issued ON issued.stream_id=decision.stream_id AND issued.type='MutationProposed'
    AND issued.actor='model:forma-assistant' AND issued.client_id='server:assistant'
    AND issued.correlation_id=proposal.actor_user_id||':'||proposal.turn_id
    AND json_extract(issued.payload,'$.proposal_id')=proposal.proposal_id AND json_extract(issued.payload,'$.turn_id')=proposal.turn_id
    AND json_extract(issued.payload,'$.content_ref')=proposal.action_content_ref AND json_extract(issued.payload,'$.action_kind')=proposal.action_kind
    AND json_extract(issued.payload,'$.actor_user_id')=proposal.actor_user_id
    AND json_extract(issued.payload,'$.project_id')=proposal.project_id AND json_extract(issued.payload,'$.document_id')=proposal.document_id
  LEFT JOIN event_private_payloads issued_secret ON issued_secret.private_event_id=issued.event_id
  LEFT JOIN event_private_payloads decision_secret ON decision_secret.private_event_id=decision.event_id
  LEFT JOIN eligible mutation ON proposal.status='accepted' AND mutation.stream_id=decision.stream_id
    AND mutation.correlation_id=decision.correlation_id AND mutation.sequence=decision.sequence+1
  LEFT JOIN event_private_payloads mutation_secret ON mutation_secret.private_event_id=mutation.event_id
  WHERE decision.type IN('ProposalAccepted','ProposalRejected') AND decision.actor='user:'||proposal.actor_user_id
    AND decision.client_id='web:assistant' AND decision.correlation_id='assistant-'||proposal.status||':'||proposal.actor_user_id||':'||proposal.proposal_id
    AND json_extract(decision.payload,'$.actor_user_id')=proposal.actor_user_id
    AND decision.compensates_event_id IS NULL AND issued.compensates_event_id IS NULL
    AND ${envelope("decision", "decision_secret")} AND ${envelope("issued", "issued_secret")}
    AND ${receipt("issued", "'assistant:'||proposal.actor_user_id||':'||COALESCE(proposal.project_access_id,'personal')||':'||proposal.document_id||':'||proposal.turn_id||':proposal:'||proposal.proposal_id")}
    AND NOT EXISTS(SELECT 1 FROM assistant_specialist_tasks task WHERE (task.actor_user_id,task.scope_key,task.turn_id)
      IS (proposal.actor_user_id,proposal.scope_key,proposal.turn_id))
    AND NOT EXISTS(SELECT 1 FROM project_event_scopes conflicting WHERE conflicting.event_id=issued.event_id
      AND (conflicting.organization_id,conflicting.project_access_id,conflicting.project_id,conflicting.owner_user_id,conflicting.actor_user_id,
        conflicting.source_stream_id,conflicting.source_sequence) IS NOT (${bound("organization_id")},${bound("project_access_id")},
        proposal.project_id,${bound("owner_user_id")},proposal.actor_user_id,issued.stream_id,issued.sequence))
    AND (proposal.organization_id IS NULL AND retention.content_id IS NULL AND NOT EXISTS(SELECT 1 FROM project_resource_scopes resource
      WHERE resource.resource_kind='content' AND resource.resource_id=action.content_id)
      OR proposal.organization_id IS NOT NULL AND (retention.organization_id,retention.project_access_id,retention.project_id,retention.actor_user_id)
        IS (proposal.organization_id,proposal.project_access_id,proposal.project_id,proposal.actor_user_id)
      AND (SELECT COUNT(*) FROM private_content_retention_scopes other WHERE other.content_id=action.content_id)=1
      AND (SELECT COUNT(*) FROM project_resource_scopes resource WHERE resource.resource_kind='content' AND resource.resource_id=action.content_id)=1
      AND retention.assigned_expires_at>${clock} AND EXISTS(SELECT 1 FROM project_resource_scopes resource
        WHERE resource.resource_kind='content' AND resource.resource_id=action.content_id
          AND (resource.organization_id,resource.project_access_id,resource.project_id,resource.owner_user_id,resource.actor_user_id,resource.visibility)
            IS (proposal.organization_id,proposal.project_access_id,proposal.project_id,${bound("owner_user_id")},proposal.actor_user_id,'actor_private')))
    AND (SELECT COUNT(*) FROM (SELECT 1 FROM events sibling WHERE sibling.stream_id=decision.stream_id
      AND sibling.correlation_id=decision.correlation_id LIMIT 3))=CASE proposal.status WHEN 'accepted' THEN 2 ELSE 1 END
    AND (proposal.status='rejected' AND ${receipt("decision", "decision.correlation_id||':0'")}
      OR proposal.status='accepted' AND mutation.event_id IS NOT NULL AND mutation.actor=decision.actor
        AND mutation.client_id=decision.client_id AND mutation.compensates_event_id IS NULL
        AND json_extract(mutation.payload,'$.source_chat_turn_id')=proposal.turn_id AND ${envelope("mutation", "mutation_secret")}
        AND (proposal.organization_id IS NULL AND mutation.causation_id=decision.event_id
          AND ${receipt("decision", "decision.correlation_id||':0'")} AND ${receipt("mutation", "decision.correlation_id||':1'")}
          OR proposal.organization_id IS NOT NULL AND mutation.causation_id IS NULL))
  ORDER BY decision.sequence,decision.event_id,issued.event_id LIMIT 65`;
  return descriptor(sql, [...q.bindings.slice(0, 6), e.enrollment_id, JSON.stringify(selected), ...q.bindings.slice(6), e.cursor_sequence,
    JSON.stringify({ actor_user_id: e.actor_user_id, owner_user_id: e.owner_user_id, organization_id: e.organization_id,
      project_access_id: e.project_access_id, project_id: e.project_id, document_id: e.document_id,
      permission_epoch: e.permission_epoch, scope_key: scopeKey(e) })]);
}

/** Pure projection only after the enclosing native q/authority checks. Historical
 * proposal expiry is NOT a recall lease; the decision must have occurred before
 * that admission deadline. No latest-read timestamp renews source retention. */
function projectOutcomes(rows: readonly Row[], e: Enrollment, refs: readonly NativeMemoryOutcomeSource[],
  checkedAt: string, outerValidUntil: string) {
  let selected: NativeMemoryOutcomeSource[];
  try { selected = selection(e, refs); } catch { return null; }
  const checked = timestamp(checkedAt), outer = timestamp(outerValidUntil);
  if (checked === null || outer === null || outer <= checked || outer - checked > 60_000 || !Array.isArray(rows)
    || rows.length > 64 || bytes(rows) > 65_536 || timestamp(e.enrolled_at)! > checked || timestamp(e.expires_at)! <= checked
    || Array.from({ length: rows.length }, (_, index) => index).some(index => !Object.hasOwn(rows, index) || !object(rows[index])
      || !exact(rows[index], ["decision_json", "proposal_json", "issued_json", "mutation_json", "action_json", "source_versions_json", "private_expires_at", "assigned_expires_at", "targets_current"]))
    || selected.some(ref => timestamp(ref.validUntil)! <= checked || timestamp(ref.recordedAt)! > checked)) return null;
  const byId = new Map(selected.map(ref => [ref.eventId, ref]));
  const seen = new Set<string>(), seenEvents = new Set<string>();
  const outcomes = [];
  const minimum = (values: unknown[]) => {
    const parsed = values.map(timestamp); return parsed.some(value => value === null) ? null : Math.min(...parsed as number[]);
  };
  for (const row of rows) {
    const decision = parse(row.decision_json), proposal = parse(row.proposal_json), issued = parse(row.issued_json), action = parse(row.action_json);
    if (!decision || !proposal || !issued || !action || row.targets_current !== 1) continue;
    if (!exact(decision, ["eventId", "sequence", "type", "recordedAt", "rememberedUntil"])
      || !exact(proposal, ["proposalId", "turnId", "kind", "status", "createdAt", "resolvedAt", "actionDeadline", "expectedHead"])
      || !exact(issued, ["eventId", "sequence", "recordedAt"]) || !exact(action, ["kind", "targetBlockId", "fromBlockId", "toBlockId"])) return null;
    if (!id(proposal.proposalId) || !id(proposal.turnId) || !id(issued.eventId) || !integer(issued.sequence)
      || !integer(decision.sequence) || !id(decision.eventId) || action.kind !== proposal.kind
      || !["context.create", "context.edit", "context.remove", "context.relation.add", "context.relation.remove"].includes(String(proposal.kind))) continue;
    const source = byId.get(decision.eventId), status = proposal.status;
    if (!source || source.sequence !== decision.sequence || source.type !== decision.type || source.recordedAt !== decision.recordedAt
      || decision.type !== (status === "accepted" ? "ProposalAccepted" : status === "rejected" ? "ProposalRejected" : "")) return null;
    if (seen.has(proposal.proposalId) || seenEvents.has(decision.eventId) || seenEvents.has(issued.eventId)) return null;
    seen.add(proposal.proposalId); seenEvents.add(decision.eventId); seenEvents.add(issued.eventId);
    const created = timestamp(proposal.createdAt), resolved = timestamp(proposal.resolvedAt), admitted = timestamp(proposal.actionDeadline);
    const occurred = timestamp(decision.recordedAt), offered = timestamp(issued.recordedAt);
    if (created === null || resolved === null || admitted === null || occurred === null || offered === null
      || created < timestamp(e.enrolled_at)! || offered < created || occurred < offered || resolved < created || resolved > occurred
      || occurred >= admitted || occurred > checked || offered > checked || issued.sequence >= decision.sequence
      || !Number.isSafeInteger(proposal.expectedHead) || Number(proposal.expectedHead) < 0 || Number(proposal.expectedHead) >= issued.sequence) continue;
    let versions: unknown;
    try { versions = typeof row.source_versions_json === "string" ? JSON.parse(row.source_versions_json) : null; } catch { continue; }
    if (!Array.isArray(versions) || versions.length > 16 || versions.some(value => !object(value)
      || !exact(value, ["blockId", "version"]) || !id(value.blockId) || !integer(value.version))
      || new Set(versions.map(value => value.blockId)).size !== versions.length) continue;
    const versionIds = new Set(versions.map(value => value.blockId));
    if (proposal.kind === "context.create" ? [action.targetBlockId, action.fromBlockId, action.toBlockId].some(value => value !== null)
      : proposal.kind === "context.edit" || proposal.kind === "context.remove"
        ? !id(action.targetBlockId) || !versionIds.has(action.targetBlockId) || action.fromBlockId !== null || action.toBlockId !== null
        : action.targetBlockId !== null || !id(action.fromBlockId) || !id(action.toBlockId) || action.fromBlockId === action.toBlockId
          || !versionIds.has(action.fromBlockId) || !versionIds.has(action.toBlockId)) continue;
    const deadlines: unknown[] = [outerValidUntil, e.expires_at, source.validUntil, decision.rememberedUntil, row.private_expires_at,
      new Date(occurred + e.retention_days * 86_400_000).toISOString(), new Date(offered + e.retention_days * 86_400_000).toISOString()];
    if (e.organization_id !== null) deadlines.push(row.assigned_expires_at); else if (row.assigned_expires_at !== null) continue;
    let mutation = null;
    if (status === "accepted") {
      const value = parse(row.mutation_json);
      if (!value || !exact(value, ["eventId", "sequence", "type", "recordedAt", "rememberedUntil", "blockId", "fromBlockId", "toBlockId", "relationId"])
        || !id(value.eventId) || seenEvents.has(value.eventId) || value.sequence !== decision.sequence + 1) return null;
      const ref = byId.get(value.eventId), at = timestamp(value.recordedAt);
      const kind = proposal.kind;
      const expected = kind === "context.create" ? "BlockCreated" : kind === "context.edit" ? "BlockPropertyEdited" : kind === "context.remove" ? "BlockRemoved"
        : kind === "context.relation.add" ? "BlockRelationAdded" : "BlockRelationRemoved";
      if (!ref || ref.sequence !== value.sequence || ref.type !== value.type || ref.recordedAt !== value.recordedAt
        || ref.blockId !== value.blockId || value.type !== expected || at === null || at < occurred || at > checked) continue;
      if (kind === "context.create" || kind === "context.edit" || kind === "context.remove") {
        if (!id(value.blockId) || value.fromBlockId !== null || value.toBlockId !== null || value.relationId !== null
          || kind !== "context.create" && value.blockId !== action.targetBlockId) continue;
      } else if (value.blockId !== null || value.fromBlockId !== action.fromBlockId || value.toBlockId !== action.toBlockId || !id(value.relationId)) continue;
      deadlines.push(ref.validUntil, value.rememberedUntil, new Date(at + e.retention_days * 86_400_000).toISOString());
      seenEvents.add(value.eventId);
      mutation = { sourceIndex: selected.indexOf(ref), type: expected,
        blockIds: value.blockId === null ? [value.fromBlockId as string, value.toBlockId as string] : [value.blockId as string],
        relationId: value.relationId as string | null };
    } else if (row.mutation_json !== null) return null;
    const until = minimum(deadlines);
    if (until === null || until <= checked) continue;
    outcomes.push({ proposalId: proposal.proposalId, turnId: proposal.turnId, status: status as "accepted" | "rejected",
      actionKind: proposal.kind as string, origin: "assistant-assisted" as const, independentEvidence: false as const,
      decision: { sourceIndex: selected.indexOf(source) }, mutation,
      recordedAt: decision.recordedAt as string, validUntil: new Date(until).toISOString() });
  }
  outcomes.sort((a, b) => selected[a.decision.sourceIndex].sequence - selected[b.decision.sourceIndex].sequence || a.proposalId.localeCompare(b.proposalId));
  const validUntil = new Date(Math.min(outer, timestamp(e.expires_at)!, ...outcomes.map(item => timestamp(item.validUntil)!))).toISOString();
  const result = { version: NATIVE_MEMORY_OUTCOMES_VERSION, treatment: "descriptive-assisted-decisions" as const,
    exposure: "not-measured" as const, inferredPreferences: false as const,
    coverage: { selectedSourceCount: selected.length, selectedDecisionCount: selected.filter(ref => ["ProposalAccepted", "ProposalRejected"].includes(ref.type)).length,
      certifiedOutcomeCount: outcomes.length, completeHistory: false as const, bounded: true as const, freeAssistantOnly: true as const },
    outcomes: outcomes.map(({ validUntil: _deadline, ...item }) => item) };
  const value = parseMemoryAssistedOutcomes(result, selected, { checkedAt, validUntil });
  return value ? { value, validUntil } : null;
}

export type NativeMemoryOutcomes = NonNullable<ReturnType<typeof nativeMemoryOutcomesValue>>;

/** Null means unavailable/invalid, never a claim of complete zero activity. */
export function nativeMemoryOutcomesValue(rows: readonly Row[], e: Enrollment, refs: readonly NativeMemoryOutcomeSource[],
  checkedAt: string, outerValidUntil: string) {
  try { return projectOutcomes(rows, e, refs, checkedAt, outerValidUntil); } catch { return null; }
}

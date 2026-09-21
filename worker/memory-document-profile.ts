import { DOCUMENT_PROFILE_POLICY, NATIVE_DOCUMENT_PALETTE_CHOICE_RECIPE, documentPaletteClaimKey,
  parseMemoryDocumentProfile, type MemoryDocumentProfile } from "../src/model/memory-document-profile.ts";
import type { NativeMemoryPreparedDocument, NativeMemoryContextObserver } from "./memory-live-context.ts";
import { nativeMemoryDescriptor as descriptor, nativeMemoryTimestamp as timestamp, nativeMemoryGrantDeadline,
  nativeMemoryPilotQuery, nativeMemoryPilotDeadline, type NativeMemoryQuery, type NativeMemorySqlValue } from "./memory-native-deadlines.ts";
import type { LiveMemoryEnrollment } from "./memory-live-authority.ts";
import type { WorkerEnv } from "./runtime.ts";
import { observeNativeMemoryDocumentScope } from "./memory-native-scope.ts";

/** Separately consented, on-demand inspection. This recipe never learns from
 * output properties, natural language, default block intent, or chat history.
 * Source event identities are not represented as invented block revisions. */
export const DOCUMENT_PROFILE_LIMITS = { blocks: 16, sources: 128, selected: 64, payloadBytes: 8192, lifetimeMs: 60_000 } as const;
export type DocumentProfileGrant = {
  grant_id: string; actor_user_id: string; owner_user_id: string; organization_id: string | null; project_access_id: string | null;
  project_id: string; document_id: string; permission_epoch: string; policy_version: string; recipe_version: string; revision: number;
  enrollment_id: string; enrollment_revision: number; infer_enabled: number; inspect_enabled: number; background_enabled: number;
  source_after_sequence: number; consented_at: string; expires_at: string; retention_days: number; revoked_at: string | null;
};
type ProfileEnv = WorkerEnv & { FORMA_MEMORY_PROFILE_ENABLED?: string; FORMA_MEMORY_PROFILE_USER_IDS?: string };
type Row = Record<string, unknown>;
type SourceQuery = { joins: string; condition: string; bindings: NativeMemorySqlValue[] };
type Selected = { eventId: string; blockId: string; sequence: number; recordedAt: string; validUntil: string };
const CLOCK = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 240
  && value.trim() === value && value.isWellFormed();
const integer = (value: unknown, minimum = 1): value is number => Number.isSafeInteger(value) && Number(value) >= minimum;
const object = (value: unknown): value is Row => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const enabled = (env: ProfileEnv, actor: string) => env.FORMA_MEMORY_PROFILE_ENABLED === "true"
  && (env.FORMA_MEMORY_PROFILE_USER_IDS ?? "").split(",").map(value => value.trim()).filter(Boolean).includes(actor)
  && env.FORMA_MEMORY_ENABLED === "true"
  && (env.FORMA_MEMORY_USER_IDS ?? "").split(",").map(value => value.trim()).filter(Boolean).includes(actor);
const grantColumns = ["grant_id", "actor_user_id", "owner_user_id", "organization_id", "project_access_id", "project_id", "document_id",
  "permission_epoch", "policy_version", "recipe_version", "revision", "enrollment_id", "enrollment_revision", "infer_enabled",
  "inspect_enabled", "background_enabled", "source_after_sequence", "consented_at", "expires_at", "retention_days", "revoked_at"] as const;

export function nativeDocumentProfileGrantQuery(prepared: NativeMemoryPreparedDocument, grantId: string): NativeMemoryQuery {
  const { principal, binding } = prepared, scope = binding.scope;
  if (!id(grantId)) throw new Error("document_profile_grant_invalid");
  return descriptor("SELECT " + grantColumns.join(",") + " FROM memory_document_profile_grants WHERE grant_id=? AND actor_user_id=?"
    + " AND owner_user_id=? AND organization_id IS ? AND project_access_id IS ? AND project_id=? AND document_id=? LIMIT 2",
  [grantId, principal.userId, scope?.ownerUserId ?? principal.userId, scope?.organizationId ?? null, scope?.projectAccessId ?? null,
    binding.projectId, binding.documentId]);
}

/** No permissive policy migration: the parent and new purpose must both be current. */
export function documentProfileGrantValid(g: DocumentProfileGrant, e: LiveMemoryEnrollment, now: number): boolean {
  return Boolean(g && e && Number.isFinite(now) && grantColumns.every(key => Object.hasOwn(g, key))
    && [g.grant_id, g.actor_user_id, g.owner_user_id, g.project_id, g.document_id, g.permission_epoch, g.enrollment_id].every(id)
    && (g.organization_id === null && g.project_access_id === null && g.owner_user_id === g.actor_user_id
      || id(g.organization_id) && id(g.project_access_id))
    && g.policy_version === DOCUMENT_PROFILE_POLICY && g.recipe_version === NATIVE_DOCUMENT_PALETTE_CHOICE_RECIPE
    && integer(g.revision) && integer(g.enrollment_revision) && g.infer_enabled === 1 && g.inspect_enabled === 1
    && g.background_enabled === 0 && g.revoked_at === null && integer(g.source_after_sequence, 0)
    && integer(g.retention_days) && g.retention_days <= 365 && g.retention_days <= e.retention_days
    && timestamp(g.consented_at) !== null && Date.parse(g.consented_at) <= now
    && timestamp(g.expires_at) !== null && Date.parse(g.expires_at) > now && g.expires_at <= e.expires_at
    && g.consented_at >= e.enrolled_at && e.policy_version === "personal-memory-v2" && e.learn_enabled === 1 && e.recall_enabled === 1
    && integer(e.revision) && integer(e.retention_days) && e.retention_days <= 365 && integer(e.cursor_sequence, 0)
    && (e.cutoff_sequence === null || integer(e.cutoff_sequence, e.cursor_sequence))
    && timestamp(e.enrolled_at) !== null && timestamp(e.expires_at) !== null
    && g.enrollment_id === e.enrollment_id && g.enrollment_revision === e.revision
    && ["actor_user_id", "owner_user_id", "organization_id", "project_access_id", "project_id", "document_id", "permission_epoch"]
      .every(key => g[key as keyof DocumentProfileGrant] === e[key as keyof LiveMemoryEnrollment]));
}

/** Ignore only certified inactive/expired history, not malformed rows which
 * happen to sort before the clock. Replaying this exact selection observes a
 * newly applicable suppression, withdrawal, or deadline transition. */
export function nativeDocumentProfileSuppressionsQuery(g: DocumentProfileGrant): NativeMemoryQuery {
  if (!g || !id(g.grant_id) || !integer(g.revision) || timestamp(g.consented_at) === null
    || timestamp(g.expires_at) === null || g.consented_at >= g.expires_at) throw new Error("document_profile_suppression_invalid");
  const canonical = (column: string) => `typeof(${column})='text' AND length(CAST(${column} AS BLOB))=24
    AND strftime('%Y-%m-%dT%H:%M:%fZ',${column},'+0 days')=${column}`;
  return descriptor(`SELECT claim_key,revision,state,created_at,expires_at FROM memory_document_profile_suppressions
    WHERE grant_id=? AND grant_revision=? AND NOT COALESCE(
      typeof(claim_key)='text' AND length(claim_key)=64 AND length(CAST(claim_key AS BLOB))=64
      AND claim_key NOT GLOB '*[^0-9a-f]*' AND typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991
      AND typeof(state)='text' AND state IN('active','revoked') AND (${canonical("created_at")}) AND (${canonical("expires_at")})
      AND created_at>=? AND created_at<=${CLOCK} AND expires_at>created_at AND expires_at<=?
      AND (state='revoked' OR expires_at<=${CLOCK}),0)
    ORDER BY claim_key,revision LIMIT 129`, [g.grant_id, g.revision, g.consented_at, g.expires_at]);
}

/** The descriptor above returns live active rows or invalid data to reject.
 * Expiry between the DB read and this check fails closed, never renews a lease. */
export function nativeDocumentProfileSuppressionsValue(rows: readonly Row[], g: DocumentProfileGrant, at: number)
  : { suppressed: Set<string>; validUntil: string | null } | null {
  if (!Number.isFinite(at) || !g || timestamp(g.consented_at) === null || timestamp(g.expires_at) === null
    || !dense(rows, 128)) return null;
  const suppressed = new Set<string>(), expiries: number[] = [];
  for (const row of rows) {
    if (!object(row) || Object.keys(row).length !== 5
      || typeof row.claim_key !== "string" || !/^[a-f0-9]{64}$/u.test(row.claim_key) || suppressed.has(row.claim_key)
      || !integer(row.revision) || row.state !== "active" || timestamp(row.created_at) === null || timestamp(row.expires_at) === null
      || String(row.created_at) < g.consented_at || Date.parse(String(row.created_at)) > at
      || String(row.expires_at) <= String(row.created_at) || String(row.expires_at) > g.expires_at
      || Date.parse(String(row.expires_at)) <= at) return null;
    suppressed.add(row.claim_key); expiries.push(Date.parse(String(row.expires_at)));
  }
  return { suppressed, validUntil: expiries.length ? new Date(Math.min(...expiries)).toISOString() : null };
}

/** Existing live references remain the only positive action inventory. Compiler,
 * account preferences, taste retractions, and generated outputs are not added. */
export function nativeDocumentProfileSourcesQuery(e: LiveMemoryEnrollment, q: SourceQuery, g: DocumentProfileGrant): NativeMemoryQuery {
  return descriptor("SELECT event.event_id,event.sequence,event.recorded_at,json_extract(event.payload,'$.block_id') AS block_id,"
    + " remembered.expires_at " + q.joins + " JOIN memory_live_sources remembered ON remembered.enrollment_id=?"
    + " AND remembered.event_id=event.event_id AND remembered.sequence=event.sequence WHERE " + q.condition
    + " AND event.type IN('BlockCreated','BlockPropertyEdited','ChipEdited') AND event.sequence>? AND event.sequence<=?"
    + " AND event.recorded_at>=? AND julianday(event.recorded_at)>julianday('now')-?"
    + " AND remembered.expires_at>" + CLOCK + " ORDER BY event.sequence DESC LIMIT 64",
  [...q.bindings.slice(0, 6), e.enrollment_id, ...q.bindings.slice(6), g.source_after_sequence, e.cursor_sequence, g.consented_at, g.retention_days]);
}

/** Complete bounded history, including non-selected/foreign-actor invalidators.
 * SQL never substitutes a previous readable row when current history is erased. */
export function nativeDocumentProfileHistoryQuery(e: LiveMemoryEnrollment, blockIds: readonly string[], head: number): NativeMemoryQuery {
  if (!blockIds.length || blockIds.length > DOCUMENT_PROFILE_LIMITS.blocks || blockIds.some(value => !id(value))
    || new Set(blockIds).size !== blockIds.length || !integer(head, 0)) throw new Error("document_profile_selection_invalid");
  const scope = JSON.stringify({ actor: e.actor_user_id, owner: e.owner_user_id, org: e.organization_id,
    access: e.project_access_id, project: e.project_id, document: e.document_id });
  const b = (field: string) => "json_extract(binding.value,'$." + field + "')";
  const bounded = (column: string) => `CASE WHEN json_valid(${column}) AND length(CAST(${column} AS BLOB))<=8192 THEN ${column} ELSE '{}' END`;
  const publicJson = bounded("event.payload"), privateJson = bounded("secret.private_json");
  const unique = (column: string, checked: string) => `CASE WHEN json_valid(${column}) AND length(CAST(${column} AS BLOB))<=8192 THEN
    NOT EXISTS(SELECT 1 FROM json_tree(${checked}) member WHERE typeof(member.key)='text'
      GROUP BY member.parent,member.key HAVING COUNT(*)>1) ELSE 0 END`;
  const block = `json_extract(${publicJson},'$.block_id')`;
  return descriptor(`SELECT event.event_id,event.stream_id,event.sequence,event.schema_version,event.type,event.actor,event.client_id,event.recorded_at,
    event.correlation_id,event.causation_id,event.compensates_event_id,
    CASE WHEN length(CAST(event.payload AS BLOB))<=8192 THEN event.payload ELSE NULL END AS payload,
    ${unique("event.payload", publicJson)} AS public_json_unique,${unique("secret.private_json", privateJson)} AS private_json_unique,
    secret.owner_id AS private_owner,secret.project_id AS private_project,secret.document_id AS private_document,
    CASE WHEN length(CAST(secret.private_json AS BLOB))<=8192 THEN secret.private_json ELSE NULL END AS private_json,secret.redacted_at,
    CASE WHEN ${b("org")} IS NULL THEN NOT EXISTS(SELECT 1 FROM project_event_scopes custody WHERE custody.event_id=event.event_id)
      ELSE (SELECT COUNT(*) FROM project_event_scopes custody WHERE custody.event_id=event.event_id)=1
        AND EXISTS(SELECT 1 FROM project_event_scopes custody WHERE custody.event_id=event.event_id
          AND (custody.organization_id,custody.project_access_id,custody.project_id,custody.owner_user_id,
            custody.source_stream_id,custody.source_sequence) IS (${b("org")},${b("access")},${b("project")},${b("owner")},event.stream_id,event.sequence)
          AND (event.actor='user:'||custody.actor_user_id OR event.actor='user' AND custody.actor_user_id=${b("owner")})) END AS event_custody,
    CASE WHEN ${b("org")} IS NULL THEN NOT EXISTS(SELECT 1 FROM project_resource_scopes resource
      WHERE resource.resource_kind='block' AND resource.resource_id=${block})
      ELSE (SELECT COUNT(*) FROM project_resource_scopes resource WHERE resource.resource_kind='block'
        AND resource.resource_id=${block})=1
        AND EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='block'
          AND resource.resource_id=${block}
          AND (resource.organization_id,resource.project_access_id,resource.project_id,resource.owner_user_id)
            IS (${b("org")},${b("access")},${b("project")},${b("owner")})
          AND (resource.visibility='collaborative_output' OR resource.visibility='actor_private' AND resource.actor_user_id=${b("actor")})) END AS resource_custody
    FROM events event JOIN (SELECT ? AS value) binding
    LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id
      AND (secret.owner_id,secret.project_id,secret.document_id) IS (${b('owner')},${b('project')},${b('document')})
    WHERE event.stream_id=? AND event.sequence<=? AND (NOT json_valid(event.payload) OR length(CAST(event.payload AS BLOB))>8192
      OR EXISTS(SELECT 1 FROM json_tree(${publicJson}) member WHERE member.key='block_id'
        AND member.value IN(SELECT value FROM json_each(?)))
      OR EXISTS(SELECT 1 FROM json_tree(${privateJson}) member WHERE member.key='block_id'
        AND member.value IN(SELECT value FROM json_each(?))))
    ORDER BY event.sequence,event.event_id LIMIT 129`, [scope, "creative:" + e.owner_user_id, head, JSON.stringify(blockIds), JSON.stringify(blockIds)]);
}

const copyKeys = ["copied_from_block_id", "forked_from_block_id", "source_block_id", "source_output_id", "source_generation_id",
  "source_artifact_id", "source_document_id", "source_reference_id", "source_reference_block_id", "organization_context_package_id"];
const assistedKeys = ["source_chat_turn_id", "proposal_id", "source_claim_ref", "execution_id"];
type Field = { value: unknown; row: Row };
type Block = { id: string; type: unknown; colors?: Field; intent?: Field; active: boolean; valid: boolean; weight: unknown;
  enabled: unknown; born: boolean; lineage: "unknown" | "assisted" | "copy" };
const absentFlag = (value: unknown) => value === undefined || value === null || value === false || value === 0;
const dense = (value: unknown, limit: number): value is unknown[] => Array.isArray(value) && value.length <= limit
  && Object.keys(value).length === value.length && Array.from({ length: value.length }, (_, i) => Object.hasOwn(value, i)).every(Boolean);
function metadataValid(row: Row, e: LiveMemoryEnrollment): boolean {
  if (!id(row.event_id) || !integer(row.sequence) || row.stream_id !== "creative:" + e.owner_user_id
    || row.schema_version !== 1 || !id(row.type) || !id(row.actor) || !id(row.client_id) || timestamp(row.recorded_at) === null
    || row.event_custody !== 1 || row.resource_custody !== 1 || row.public_json_unique !== 1
    || typeof row.payload !== "string" || bytes(row.payload) > DOCUMENT_PROFILE_LIMITS.payloadBytes
    || row.compensates_event_id !== null && !id(row.compensates_event_id)
    || row.causation_id !== null && !id(row.causation_id) || !id(row.correlation_id)) return false;
  const actor = row.actor === "user" ? e.owner_user_id : row.actor.startsWith("user:") ? row.actor.slice(5) : null;
  return id(actor) && (e.organization_id !== null || actor === e.actor_user_id);
}
/** Historical identifier-only locks have no authored value body. This narrow
 * exception never rescues an erased envelope or a value/scope/unknown mutator. */
function harmlessPublicPayload(row: Row, e: LiveMemoryEnrollment, value: unknown): Row | null {
  if (!["BlockLocked", "BlockUnlocked"].includes(String(row.type)) || !metadataValid(row, e) || !object(value)
    || row.compensates_event_id !== null || row.private_json !== null || row.private_owner !== null
    || row.private_project !== null || row.private_document !== null || row.redacted_at !== null
    || !id(value.block_id) || Object.keys(value).some(key => !["block_id", "project_id", "document_id", "organization_id",
      "project_access_id", "actor_user_id", "owner_user_id", "source_surface"].includes(key))) return null;
  const actor = row.actor === "user" ? e.owner_user_id : String(row.actor).slice(5);
  const fields = { project_id: e.project_id, document_id: e.document_id, organization_id: e.organization_id,
    project_access_id: e.project_access_id, actor_user_id: actor, owner_user_id: e.owner_user_id };
  if (Object.entries(fields).some(([key, expected]) => Object.hasOwn(value, key) && value[key] !== expected)
    || Object.hasOwn(value, "source_surface") && !id(value.source_surface)) return null;
  return value;
}
function payload(row: Row, e: LiveMemoryEnrollment): Row | null {
  if (!metadataValid(row, e) || row.private_json_unique !== 1 || row.redacted_at !== null
    || row.private_owner !== e.owner_user_id || typeof row.private_json !== "string"
    || bytes(row.private_json) > DOCUMENT_PROFILE_LIMITS.payloadBytes) return null;
  let visible: unknown, privateValue: unknown;
  try { visible = JSON.parse(String(row.payload)); privateValue = JSON.parse(row.private_json); } catch { return null; }
  if (!object(visible) || !object(privateValue) || visible._private_ref !== row.event_id
    || !id(visible.block_id) || visible.block_id !== privateValue.block_id) return null;
  for (const key of ["project_id", "document_id", "actor_user_id", "organization_id", "project_access_id", "owner_user_id", "scope", "canvas_id", "type", "property_path", "property"])
    if (Object.hasOwn(visible, key) && visible[key] !== privateValue[key]) return null;
  const actorValue = String(row.actor), actor = actorValue === "user" ? e.owner_user_id : actorValue.startsWith("user:") ? actorValue.slice(5) : null;
  if (!actor || (e.organization_id === null && actor !== e.actor_user_id)
    || Object.hasOwn(privateValue, "actor_user_id") && privateValue.actor_user_id !== actor
    || Object.hasOwn(privateValue, "owner_user_id") && privateValue.owner_user_id !== e.owner_user_id
    || Object.hasOwn(privateValue, "organization_id") && privateValue.organization_id !== e.organization_id
    || Object.hasOwn(privateValue, "project_access_id") && privateValue.project_access_id !== e.project_access_id
    || Object.hasOwn(privateValue, "project_id") && privateValue.project_id !== e.project_id
    || Object.hasOwn(privateValue, "document_id") && privateValue.document_id !== e.document_id
    || row.private_project !== (privateValue.project_id ?? null) || row.private_document !== (privateValue.document_id ?? null)) return null;
  if ([privateValue, visible, object(privateValue.properties) ? privateValue.properties : {}].some(value =>
    !absentFlag(value.simulation) || !absentFlag(value.synthetic) || !absentFlag(value.fictional)
    || value.replay_session_id != null || value.source_replay_id != null || value.source_replay_event_id != null
    || value.fictional_user_id != null || value.mock_data_source != null
    || value.report_space === "scout" || value.origin != null && (!object(value.origin) || !absentFlag(value.origin.synthetic)
      || !absentFlag(value.origin.simulation) || value.origin.replay_session_id != null || value.origin.fictional_user_id != null))) return null;
  return privateValue;
}

/** Pure projection after the native queries; this is not an authorization port. */
export async function nativeDocumentPaletteProfileValue(rows: readonly Row[], selected: readonly Selected[], e: LiveMemoryEnrollment,
  g: DocumentProfileGrant, blockIds: readonly string[], suppressed: ReadonlySet<string>, checkedAt: string, validUntil: string) {
  const checked = timestamp(checkedAt), until = timestamp(validUntil);
  if (checked === null || until === null || until <= checked || until - checked > 60_000 || !documentProfileGrantValid(g, e, checked)
    || !dense(rows, DOCUMENT_PROFILE_LIMITS.sources) || !dense(selected, DOCUMENT_PROFILE_LIMITS.selected)
    || !dense(blockIds, DOCUMENT_PROFILE_LIMITS.blocks) || blockIds.some(value => !id(value)) || new Set(blockIds).size !== blockIds.length
    || !(suppressed instanceof Set) || suppressed.size > 128 || [...suppressed].some(value => !/^[a-f0-9]{64}$/u.test(value))) return null;
  if (selected.some(source => !object(source) || !id(source.eventId) || !id(source.blockId) || !integer(source.sequence)
    || timestamp(source.recordedAt) === null || timestamp(source.validUntil) === null)
    || new Set(selected.map(source => source.eventId)).size !== selected.length
    || new Set(selected.map(source => source.sequence)).size !== selected.length) return null;
  const selections = new Map(selected.map(source => [source.eventId, source]));
  const blocks = new Map<string, Block>(blockIds.map(blockId => [blockId, { id: blockId, type: null, active: false, valid: true, born: false, weight: 1, enabled: true, lineage: "unknown" }]));
  const seen = new Set<string>(), positions = new Set<number>();
  let previousSequence = 0;
  for (const row of rows) {
    if (!object(row) || !integer(row.sequence) || row.sequence <= previousSequence) return null;
    previousSequence = row.sequence;
    let publicValue: unknown; try { publicValue = typeof row.payload === "string" ? JSON.parse(row.payload) : null; } catch { return null; }
    const block = object(publicValue) && typeof publicValue.block_id === "string" ? blocks.get(publicValue.block_id) : undefined;
    if (!block || !id(row.event_id) || !integer(row.sequence) || seen.has(row.event_id) || positions.has(row.sequence)) return null;
    seen.add(row.event_id); positions.add(row.sequence);
    const value = harmlessPublicPayload(row, e, publicValue) ?? payload(row, e);
    if (!value || Date.parse(String(row.recorded_at)) > checked) { block.valid = false; continue; }
    const properties = object(value.properties) ? value.properties : {};
    const editPath = row.type === "BlockPropertyEdited" ? value.property_path : row.type === "ChipEdited" ? value.property : null;
    if ([value, properties].some(item => copyKeys.some(key => item[key] != null))
      || typeof editPath === "string" && copyKeys.includes(editPath) && value.new_value != null) block.lineage = "copy";
    else if (block.lineage !== "copy" && (value.memory_authored_version===1 || [value, properties].some(item => assistedKeys.some(key => item[key] != null))
      || typeof editPath === "string" && assistedKeys.includes(editPath) && value.new_value != null
      || /assistant|quick-edit|adaptive|context-proposal/u.test(String(value.source_surface ?? "") + " " + String(row.client_id)))) block.lineage = "assisted";
    if (row.compensates_event_id !== null) {
      // Undo semantics are not independent authored support. Without a complete
      // native compensation graph, this recipe cannot recover the old choice.
      block.valid = false; block.colors = undefined; block.intent = undefined; continue;
    }
    if (row.type === "BlockCreated") {
      if (block.born || value.project_id !== e.project_id || value.document_id !== e.document_id
        || value.scope !== undefined && value.scope !== "document" || value.canvas_id != null || value.library_block === true) block.valid = false;
      block.born = true; block.active = true; block.type = value.type; block.weight = properties.weight ?? 1;
      block.enabled = properties.active ?? true;
      block.colors = Object.hasOwn(properties, "colors") ? { value: properties.colors, row } : undefined;
      block.intent = Object.hasOwn(properties, "intent") ? { value: properties.intent, row } : undefined;
      if (block.enabled !== true) { block.colors = undefined; block.intent = undefined; }
    } else if (!block.born) block.valid = false;
    else if (row.type === "BlockRehomed") { block.valid = false; block.colors = undefined; block.intent = undefined; }
    else if (row.type === "BlockRemoved" || row.type === "BlockRestored") {
      block.active = row.type === "BlockRestored"; block.colors = undefined; block.intent = undefined;
    } else if (row.type === "BlockWeightSet") block.weight = value.weight;
    else if (row.type === "BlockPropertyEdited" || row.type === "ChipEdited") {
      const path = row.type === "BlockPropertyEdited" ? value.property_path : value.property;
      if (path === "type" && row.type === "BlockPropertyEdited") {
        if (block.type !== value.new_value) { block.colors = undefined; block.intent = undefined; } block.type = value.new_value;
      }
      if (path === "colors") block.colors = { value: value.new_value, row };
      if (path === "intent") block.intent = { value: value.new_value, row };
      if (path === "weight") block.weight = value.new_value;
      if (path === "active") {
        block.enabled = value.new_value;
        if (value.new_value !== true) { block.colors = undefined; block.intent = undefined; }
      }
    } else if (row.type === "ExtractionCompleted" || row.type === "ExtractionSuperseded") { block.colors = undefined; block.intent = undefined; }
    else if (!["BlockRenamed", "BlockLocked", "BlockUnlocked", "ExtractionRequested", "ExtractionFailed"].includes(String(row.type))) {
      // A future event contract cannot silently preserve an old authored choice.
      block.valid = false;
    }
  }
  const groups = new Map<string, MemoryDocumentProfile["choices"][number]>();
  const identity = { actorUserId: e.actor_user_id, ownerUserId: e.owner_user_id, organizationId: e.organization_id,
    projectAccessId: e.project_access_id, projectId: e.project_id, documentId: e.document_id };
  let deadline = until;
  for (const block of blocks.values()) {
    if (!block.valid || !block.born || !block.active || block.enabled !== true || block.type !== "palette" || !block.colors || !block.intent
      || typeof block.weight !== "number" || !Number.isFinite(block.weight) || block.weight <= 0 || block.weight > 1
      || !["prefer", "avoid", "prohibit"].includes(String(block.intent.value))) continue;
    const raw = block.colors.value;
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 16
      || Array.from({ length: raw.length }, (_, index) => index).some(index => !Object.hasOwn(raw, index)
        || typeof raw[index] !== "string" || !/^#[a-fA-F0-9]{6}$/u.test(raw[index]))) continue;
    const evidenceRows = [...new Map([block.colors.row, block.intent.row].map(row => [String(row.event_id), row])).values()]
      .sort((a, b) => Number(a.sequence) - Number(b.sequence));
    if (evidenceRows.some(row => !selections.has(String(row.event_id)) || row.actor !== "user:" + e.actor_user_id
      && !(row.actor === "user" && e.organization_id === null && e.owner_user_id === e.actor_user_id))) continue;
    const sourceDeadlines: number[] = [];
    if (evidenceRows.some(row => {
      const source = selections.get(String(row.event_id))!;
      const at = timestamp(source.recordedAt), end = timestamp(source.validUntil);
      if (at === null || end === null || source.blockId !== block.id || source.sequence !== row.sequence
        || source.recordedAt !== row.recorded_at || source.sequence <= g.source_after_sequence || source.sequence > e.cursor_sequence
        || at < Date.parse(g.consented_at) || end <= checked) return true;
      sourceDeadlines.push(end, at + g.retention_days * 86_400_000); return false;
    }) || Math.min(...sourceDeadlines) <= checked) continue;
    const colors = raw.map(color => color.toLowerCase()), claimKey = await documentPaletteClaimKey(identity, colors);
    if (suppressed.has(claimKey)) continue;
    const evidence = { blockId: block.id, intent: block.intent.value as "prefer" | "avoid" | "prohibit", lineage: block.lineage,
      independentEvidence: false as const, sources: evidenceRows.map(row => ({ eventId: String(row.event_id), sequence: Number(row.sequence),
        type: row.type as "BlockCreated" | "BlockPropertyEdited" | "ChipEdited", recordedAt: String(row.recorded_at) })) };
    const group = groups.get(claimKey) ?? { claimKey, colors, status: "supported" as const, supports: [], counterevidence: [] };
    (evidence.intent === "prefer" ? group.supports : group.counterevidence).push(evidence);
    group.status = group.supports.length && group.counterevidence.length ? "conflicted" : group.supports.length ? "supported" : "opposed";
    groups.set(claimKey, group); deadline = Math.min(deadline, ...sourceDeadlines);
  }
  const value = { version: NATIVE_DOCUMENT_PALETTE_CHOICE_RECIPE, treatment: "document-authored-palette-choices", inferredPreferences: false,
    independentEvidence: false, scope: { organizationId: e.organization_id, projectAccessId: e.project_access_id, projectId: e.project_id, documentId: e.document_id },
    grant: { id: g.grant_id, revision: g.revision }, lifetime: { checkedAt, validUntil: new Date(deadline).toISOString() },
    coverage: { bounded: true, completeHistory: false, blockLimit: 16, sourceLimit: 128, selectedBlockCount: blocks.size, eligibleChoiceCount: groups.size },
    choices: [...groups.values()].sort((a, b) => a.claimKey.localeCompare(b.claimKey)) };
  return parseMemoryDocumentProfile(value, checked);
}

/** Actual DB reader, not a pluggable synthetic source adapter. The enclosing
 * route must seal the returned value and enforce this witness before delivery. */
export async function readNativeDocumentPaletteProfile(env: ProfileEnv, input: NativeMemoryPreparedDocument, grantId: string,
  observer: NativeMemoryContextObserver): Promise<MemoryDocumentProfile | null> {
  if (!observer || typeof observer.observe !== "function" || typeof observer.require !== "function" || typeof observer.before !== "function") return null;
  let prepared: NativeMemoryPreparedDocument; try { prepared = structuredClone(input); } catch { return null; }
  if (!prepared?.principal || !prepared.binding) return null;
  const db = env.DB, original = JSON.stringify(input), { principal, binding } = prepared, started = Date.now();
  const current = () => env.DB === db && JSON.stringify(input) === original;
  if (!principal || !binding || !id(principal.userId) || !principal.access || typeof principal.email !== "string"
    || principal.fictional || !principal.authorizationSnapshot || !enabled(env, principal.userId)
    || principal.userId !== binding.actorUserId || principal.access.permissionEpoch !== binding.permissionEpoch
    || !id(binding.projectId) || !id(binding.documentId) || binding.streamId !== "creative:" + (binding.scope?.ownerUserId ?? principal.userId)
    || binding.scope && (binding.scope.actorUserId !== principal.userId || binding.scope.projectId !== binding.projectId)) return null;
  const deadline = nativeMemoryGrantDeadline(principal, started); if (deadline === undefined) return null;
  try {
    const queries: NativeMemoryQuery[] = [], observed: D1Result<Row>[] = [], statements: D1PreparedStatement[] = [];
    const run = async (query: NativeMemoryQuery) => {
      if (!current()) throw new Error("document_profile_read_unavailable");
      const statement = db.prepare(query.sql).bind(...query.bindings), result = structuredClone(await statement.all<Row>());
      if (!current() || !result.success) throw new Error("document_profile_read_unavailable");
      queries.push(query); observed.push(result); statements.push(statement); return result.results;
    };
    const schema = await run(descriptor("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type='table' AND name IN"
      + "('memory_document_profile_grants','memory_document_profile_suppressions','memory_live_enrollments','memory_live_sources',"
      + "'events','event_private_payloads','project_event_scopes','project_resource_scopes')", []));
    if (schema.length !== 1 || schema[0].count !== 8) return null;
    const grantRows = await run(nativeDocumentProfileGrantQuery(prepared, grantId)); if (grantRows.length !== 1) return null;
    const g = grantRows[0] as unknown as DocumentProfileGrant;
    const parent = await run(descriptor("SELECT * FROM memory_live_enrollments WHERE enrollment_id=? AND actor_user_id=? AND revision=? LIMIT 2",
      [g.enrollment_id, principal.userId, g.enrollment_revision]));
    if (parent.length !== 1) return null;
    const e = parent[0] as unknown as LiveMemoryEnrollment;
    if (!documentProfileGrantValid(g, e, started) || g.permission_epoch !== principal.access.permissionEpoch) return null;
    const [authority, source, consent] = await Promise.all([import("./memory-live-authority.ts"), import("./memory-live-sources.ts"), import("./consequential-consent.ts")]);
    if (!current()) return null;
    const a = await authority.liveMemoryAuthority(env, e); if (!a || !current()) return null;
    const deadlines = [started + 60_000, Date.parse(g.expires_at), Date.parse(e.expires_at)];
    const before = (value: string | null | undefined) => {
      if (value === null) return;
      const at = timestamp(value); if (at === null || at <= started) throw new Error("document_profile_expired"); deadlines.push(at);
    };
    before(deadline); before(nativeMemoryGrantDeadline(a.principal, started));
    const configured = env.FORMA_PILOT_COHORT_ID?.trim() ?? "";
    if (configured && !(env.FORMA_ADMIN_EMAILS ?? "").split(",").map(value => value.trim().toLowerCase()).includes(principal.email.toLowerCase()))
      before(nativeMemoryPilotDeadline(await run(nativeMemoryPilotQuery(configured)), configured, started));
    if (binding.contextSessionId) {
      const sessions = await run(descriptor("SELECT expires_at,revoked_at FROM project_context_sessions WHERE context_id=? AND principal_user_id=?"
        + " AND organization_id=? AND project_access_id=? LIMIT 2", [binding.contextSessionId, principal.userId,
        binding.scope?.organizationId ?? "", binding.scope?.projectAccessId ?? ""]));
      if (sessions.length !== 1 || sessions[0].revoked_at !== null) return null; before(sessions[0].expires_at as string);
    }
    const requestGuard = consent.executionAdmissionGuard(principal, binding, null), parentGuard = authority.liveMemoryEnrollmentGuard(e, "recall");
    const guards = [{ sql: a.guard.condition, bindings: [...a.guard.bindings] }, requestGuard,
      { sql: parentGuard.condition, bindings: [...parentGuard.bindings] }];
    const verify = async () => {
      if (!current()) return false;
      const result = await db.batch<Row>(guards.map(guard => db.prepare("SELECT CASE WHEN (" + guard.sql + ") THEN 1 ELSE 0 END AS verified").bind(...guard.bindings)));
      return current() && result.length === guards.length && result.every(row => row.success && row.results.length === 1 && row.results[0].verified === 1);
    };
    if (!await verify()) return null;
    if (!await observeNativeMemoryDocumentScope(env, prepared, e, observer) || !current()) return null;
    const headRows = await run(descriptor("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?", [binding.streamId]));
    if (headRows.length !== 1 || !integer(headRows[0].head, 0) || headRows[0].head < g.source_after_sequence || headRows[0].head < e.cursor_sequence) return null;
    const sourceRows = await run(nativeDocumentProfileSourcesQuery(e, source.liveMemorySourceQuery(e, a), g));
    const selected: Selected[] = [];
    const selectedIds = new Set<string>(); let previous = Number.POSITIVE_INFINITY;
    if (sourceRows.length > DOCUMENT_PROFILE_LIMITS.selected) return null;
    for (const row of sourceRows) {
      if (!id(row.event_id) || selectedIds.has(row.event_id) || !id(row.block_id) || !integer(row.sequence) || row.sequence >= previous
        || row.sequence <= g.source_after_sequence || row.sequence > e.cursor_sequence
        || timestamp(row.recorded_at) === null || timestamp(row.expires_at) === null
        || String(row.recorded_at) < g.consented_at || Date.parse(String(row.recorded_at)) > Date.now()) return null;
      selectedIds.add(row.event_id); previous = row.sequence;
      const until = Math.min(Date.parse(String(row.expires_at)), Date.parse(String(row.recorded_at)) + g.retention_days * 86_400_000, ...deadlines);
      if (until <= Date.now()) return null;
      deadlines.push(until);
      selected.push({ eventId: row.event_id, blockId: row.block_id, sequence: row.sequence, recordedAt: String(row.recorded_at), validUntil: new Date(until).toISOString() });
    }
    const blockIds = [...new Set(selected.map(row => row.blockId))].slice(0, DOCUMENT_PROFILE_LIMITS.blocks);
    const history = blockIds.length ? await run(nativeDocumentProfileHistoryQuery(e, blockIds, Number(headRows[0].head))) : [];
    if (history.length > DOCUMENT_PROFILE_LIMITS.sources) return null;
    const suppressionRows = await run(nativeDocumentProfileSuppressionsQuery(g));
    const suppressions = nativeDocumentProfileSuppressionsValue(suppressionRows, g, Date.now());
    if (!suppressions) return null;
    if (suppressions.validUntil) deadlines.push(Date.parse(suppressions.validUntil));
    if (!await verify()) return null;
    const checkedAt = new Date().toISOString(), value = await nativeDocumentPaletteProfileValue(history, selected, e, g, blockIds,
      suppressions.suppressed, checkedAt, new Date(Math.min(...deadlines)).toISOString());
    if (!value || !current() || !enabled(env, principal.userId) || Date.now() >= Date.parse(value.lifetime.validUntil)) return null;
    observer.observe(statements, observed, queries); guards.forEach(guard => observer.require(guard)); observer.before(value.lifetime.validUntil);
    return value;
  } catch { return null; }
}

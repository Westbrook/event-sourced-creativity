import { SAFE_SQL_EVENT_FIELDS, SAFE_SQL_IDENTIFIER_FIELDS } from "./event-privacy.ts";
import { EVENT_WRITE_STAGE_TRIGGER_SQL, PROJECT_NOTIFICATION_TRIGGER_SQL, ensureSchema, type WorkerEnv } from "./runtime.ts";
import { sceneSourceRebuildStatements } from "./scene-source-generation.ts";

const identifierSuffixes = ["_count", "_tokens", "_microusd", "_ms", "_seconds", "_version", "_index", "_sequence", "_head", "_kind", "_type", "_status", "_mode", "_surface", "_scope", "_expires_at", "_created_at", "_updated_at", "_recorded_at", "_occurred_at", "_completed_at", "_fired_at", "_content_ref", "_input_ref", "_prompt_ref", "_note_ref", "_direction_ref", "_response_ref", "_statement_ref", "_condition_ref", "_object_ref", "_target_ref"];
const sqlString = (value: string) => `'${value.replaceAll("'", "''")}'`;
const quotedKnownIdentifiers=[...SAFE_SQL_IDENTIFIER_FIELDS,"object_ids","block_ids","model_ids"].map(sqlString).join(",");
export const unsafePublicIdentifierPredicate=(payload="payload")=>`EXISTS(SELECT 1 FROM json_each(${payload}) candidate
  WHERE(candidate.key GLOB '*_id' OR candidate.key GLOB '*_ids') AND candidate.key NOT IN(${quotedKnownIdentifiers}))`;
// Classifying legacy rows by event name silently misses renamed, newly added,
// and previously uncatalogued customer-authored fields. Every pre-envelope row
// must therefore move behind the same erasable boundary as new writes.
const legacyEventPredicate = `json_valid(payload) AND(json_type(payload,'$._private_ref') IS NULL
  OR json_type(payload,'$._private_ref')<>'text' OR json_extract(payload,'$._private_ref')<>event_id
  OR NOT EXISTS(SELECT 1 FROM event_private_payloads envelope WHERE envelope.private_event_id=event_id)
  OR ${unsafePublicIdentifierPredicate()})`;
const safeScalar = `entry.key IN(${[...SAFE_SQL_EVENT_FIELDS,...SAFE_SQL_IDENTIFIER_FIELDS].map(sqlString).join(",")}) OR ${identifierSuffixes.map((suffix) => `entry.key GLOB ${sqlString(`*${suffix}`)}`).join(" OR ")}`;
const safeIdentifier=(value:string)=>`length(${value})<=240 AND ${value} NOT GLOB '*[^A-Za-z0-9_:./@%+-]*'`;
const publicScalarSql = `COALESCE((SELECT json_group_object(entry.key,CASE entry.type WHEN 'true' THEN json('true') WHEN 'false' THEN json('false') ELSE entry.value END)
  FROM json_each(events.payload) entry
  WHERE (${safeScalar}) AND entry.type IN('null','true','false','integer','real','text')
    AND(entry.type<>'text' OR ${safeIdentifier("entry.value")})),json('{}'))`;
const safeArray = (key: string) => `(SELECT json_group_array(value) FROM json_each(events.payload,${sqlString(`$.${key}`)}) WHERE type='text' AND ${safeIdentifier("value")})`;
const publicPayloadSql = `json_patch(${publicScalarSql},json_object('_private_ref',events.event_id,
  'object_ids',CASE WHEN json_type(events.payload,'$.object_ids')='array' THEN json(${safeArray("object_ids")}) END,
  'visible_refs',CASE WHEN json_type(events.payload,'$.visible_refs')='array' THEN json(${safeArray("visible_refs")}) END,
  'block_ids',CASE WHEN json_type(events.payload,'$.block_ids')='array' THEN json(${safeArray("block_ids")}) END,
  'model_ids',CASE WHEN json_type(events.payload,'$.model_ids')='array' THEN json(${safeArray("model_ids")}) END,
  'changed_fields',CASE WHEN json_type(events.payload,'$.changed_fields')='array' THEN json(${safeArray("changed_fields")}) END,
  'source_block_versions',CASE WHEN json_type(events.payload,'$.source_block_versions')='array' THEN json((SELECT json_group_array(json_object('block_id',json_extract(version.value,'$.block_id'),'version',json_extract(version.value,'$.version'))) FROM json_each(events.payload,'$.source_block_versions') version WHERE json_type(version.value,'$.block_id')='text' AND json_type(version.value,'$.version') IN('integer','real') AND ${safeIdentifier("json_extract(version.value,'$.block_id')")})) END,
  'origin',CASE WHEN json_type(events.payload,'$.origin.synthetic') IN('true','false')
    THEN json(json_object('synthetic',json(CASE WHEN json_type(events.payload,'$.origin.synthetic')='true' THEN 'true' ELSE 'false' END))) END))`;

const EVENTS_REBUILD_SQL = `CREATE TABLE events_privacy_rebuild (
  event_id TEXT PRIMARY KEY NOT NULL,stream_id TEXT NOT NULL,sequence INTEGER NOT NULL,
  occurred_at TEXT NOT NULL,recorded_at TEXT NOT NULL,actor TEXT NOT NULL,client_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,causation_id TEXT,compensates_event_id TEXT,
  schema_version INTEGER NOT NULL DEFAULT 1,type TEXT NOT NULL,payload TEXT NOT NULL
)`;

/** Rewrite historical immutable rows in one transaction while preserving rowids, ids, cursors, and folds. */
export async function migrateLegacyEventPayloads(env:WorkerEnv,scope?:{organizationId:string;ownerUserId:string}):Promise<{migratedEvents:number;eventCount:number}>{
  await ensureSchema(env);
  const organization=scope?sqlString(scope.organizationId):"";
  const targeted=scope?`${legacyEventPredicate} AND(
    EXISTS(SELECT 1 FROM project_event_scopes governed WHERE governed.event_id=events.event_id AND governed.organization_id=${organization})
    OR EXISTS(SELECT 1 FROM organization_projects governed WHERE governed.organization_id=${organization}
      AND events.stream_id='creative:'||governed.owner_user_id
      AND json_extract(events.payload,'$.project_id')=governed.project_id))`:legacyEventPredicate;
  const [totals, indexes, triggers, staging] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare(`SELECT COUNT(*) AS count,COALESCE(MAX(rowid),0) AS last_rowid,SUM(CASE WHEN ${targeted} THEN 1 ELSE 0 END) AS legacy FROM events`),
    env.DB.prepare("SELECT sql FROM sqlite_schema WHERE type='index' AND tbl_name='events' AND sql IS NOT NULL ORDER BY name"),
    env.DB.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND tbl_name='events' AND sql IS NOT NULL ORDER BY name"),
    env.DB.prepare("SELECT COUNT(*) AS count FROM event_write_stage"),
  ]);
  const count = Number(totals?.results[0]?.count ?? 0);
  const lastRowId = Number(totals?.results[0]?.last_rowid ?? 0);
  const legacy = Number(totals?.results[0]?.legacy ?? 0);
  if (!legacy) return { migratedEvents: 0, eventCount: count };
  if (Number(staging?.results[0]?.count ?? 0) !== 0) throw new Error("event_privacy_migration_busy");
  const indexStatements = (indexes?.results ?? []).map((row) => String(row.sql ?? "")).filter(Boolean);
  const triggerStatements = (triggers?.results ?? []).map((row) => String(row.sql ?? "")).filter(Boolean);
  // A table rebuild bypasses row mutation triggers. Invalidate every original
  // source certificate in this same transaction before replacing the table.
  const sourceVersionGuards = await sceneSourceRebuildStatements(env);
  const statements = [
    ...sourceVersionGuards.before,
    // Malformed JSON intentionally aborts and rolls back if another writer changed the immutable snapshot.
    env.DB.prepare(`SELECT CASE WHEN COUNT(*)=? AND COALESCE(MAX(rowid),0)=?${scope?` AND EXISTS(SELECT 1 FROM organizations governed
      JOIN organization_memberships owner ON owner.organization_id=governed.organization_id AND owner.user_id=governed.owner_user_id
        AND owner.role='owner' AND owner.status='active' AND owner.accepted_at IS NOT NULL AND owner.revoked_at IS NULL
      WHERE governed.organization_id=${organization} AND governed.owner_user_id=${sqlString(scope.ownerUserId)} AND governed.status='active')`:""}
      THEN 1 ELSE json('event privacy migration snapshot changed') END AS snapshot FROM events`).bind(count,lastRowId),
    env.DB.prepare(EVENTS_REBUILD_SQL),
    env.DB.prepare(`INSERT INTO event_private_payloads(private_event_id,owner_id,project_id,document_id,private_json,created_at,redacted_at)
      SELECT event_id,CASE WHEN stream_id LIKE 'creative:%' THEN substr(stream_id,10) ELSE stream_id END,
        CAST(json_extract(payload,'$.project_id') AS TEXT),CAST(json_extract(payload,'$.document_id') AS TEXT),payload,recorded_at,NULL
      FROM events WHERE ${targeted}
        AND NOT EXISTS(SELECT 1 FROM event_private_payloads secret WHERE secret.private_event_id=events.event_id)`),
    env.DB.prepare(`INSERT INTO events_privacy_rebuild(rowid,event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,schema_version,type,payload)
      SELECT rowid,event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,schema_version,type,
        CASE WHEN ${targeted} THEN ${publicPayloadSql} ELSE payload END FROM events ORDER BY rowid`),
    env.DB.prepare("DROP TRIGGER IF EXISTS event_write_stage_after_insert"),
    env.DB.prepare("DROP TRIGGER IF EXISTS project_notification_after_event"),
    env.DB.prepare("DROP TABLE events"),
    env.DB.prepare("ALTER TABLE events_privacy_rebuild RENAME TO events"),
    ...indexStatements.map((sql) => env.DB.prepare(sql)),
    ...triggerStatements.map((sql) => env.DB.prepare(sql)),
    ...sourceVersionGuards.after,
    env.DB.prepare(EVENT_WRITE_STAGE_TRIGGER_SQL),
    env.DB.prepare(PROJECT_NOTIFICATION_TRIGGER_SQL),
    env.DB.prepare(`DELETE FROM external_content WHERE content_id LIKE 'analytics-source:v1:%'${scope?` AND EXISTS(
      SELECT 1 FROM organization_projects governed WHERE governed.organization_id=${organization}
        AND governed.owner_user_id=external_content.owner_id)`:""}`),
  ];
  await env.DB.batch(statements);
  const verified = await env.DB.prepare("SELECT COUNT(*) AS count,COALESCE(MAX(rowid),0) AS last_rowid FROM events").first<{ count: number; last_rowid: number }>();
  if (Number(verified?.count ?? 0) !== count || Number(verified?.last_rowid ?? 0) !== lastRowId) throw new Error("event_privacy_migration_verification_failed");
  return { migratedEvents: legacy, eventCount: count };
}

import { memoryDigest } from "../src/model/scoped-memory.ts";
import { memoryCanonical, type MemorySqlGuard } from "./memory-sql.ts";
import type { LiveMemoryEnrollment } from "./memory-live-authority.ts";
import type { WorkerEnv } from "./runtime.ts";
import type { NativeMemoryOriginWithdrawalSelector } from "./memory-native-origin.ts";

/** One coalesced, disposable processing hint per enrollment. No source bodies,
 * event/content IDs, provider grant, delivery guarantee or reusable authority. */
export const memoryCheckpointSchemaProfile = {
  source: "0041_memory_live_change_checkpoints",
  names: ["idx_memory_live_checkpoint_expiry", "memory_live_change_checkpoints", "memory_live_checkpoint_enrollment_changed", "memory_live_checkpoint_source_changed", "memory_live_checkpoint_source_deleted"],
  tables: ["memory_live_change_checkpoints"], count: 5, digest: "sha256:b07fcf27422a8fcc10805eed9896fac3985a550528625613125dca6080633ee2",
} as const;
export const MEMORY_CHECKPOINT_COLUMNS = ["enrollment_id", "enrollment_revision", "generation", "after_sequence", "through_sequence", "observed_references", "created_at", "updated_at", "expires_at"] as const;
const family = "name LIKE 'memory_live_checkpoint_%' OR name='memory_live_change_checkpoints' OR name LIKE 'idx_memory_live_checkpoint_%' OR tbl_name='memory_live_change_checkpoints' OR instr(lower(COALESCE(sql,'')),'memory_live_change_checkpoints')>0";
const snapshot = `(SELECT json_group_array(json_object('name',name,'sql',sql,'table',tbl_name,'type',type)) FROM (SELECT name,sql,tbl_name,type FROM sqlite_schema WHERE ${family} ORDER BY name,type))`;
const normalized = (sql:string) => sql.trim().replace(/;$/u, "").replace(/\bIF\s+NOT\s+EXISTS\s+/giu, "");
const fail = ():never => { throw new Error("memory-checkpoint-schema-unavailable"); };
type Schema = { present:boolean; guard:MemorySqlGuard };
const verified=(result:D1Result)=>Array.isArray(result?.results)&&result.results.length===1
  &&!!result.results[0]&&Object.keys(result.results[0]).join(",")==="verified"&&(result.results[0] as {verified:unknown}).verified===1;

/** Assert absence too: installing/removing a schema during a legacy publication
 * must not silently skip the transaction's new processing checkpoint. */
export async function liveMemoryCheckpointSchema(env:WorkerEnv):Promise<Schema> {
  const db=env.DB;
  const result=await db.prepare(`SELECT name,sql,tbl_name AS 'table',type FROM sqlite_schema WHERE ${family} ORDER BY name,type LIMIT 8`).all<Record<string,unknown>>();
  if(env.DB!==db||!result||result.success!==true||"error" in result&&result.error!==undefined||!Array.isArray(result.results)||result.results.length>6)fail();
  const rows=result.results;
  for(const row of rows)if(!row||typeof row!=="object"||Array.isArray(row)||Object.keys(row).sort().join(",")!=="name,sql,table,type"
    ||typeof row.name!=="string"||typeof row.table!=="string"||typeof row.type!=="string"||row.sql!==null&&typeof row.sql!=="string")fail();
  const explicit=rows.filter(row=>row.sql!==null);
  if(rows.length&&(!rows.every(row=>row.sql!==null||row.name==="sqlite_autoindex_memory_live_change_checkpoints_1"&&row.type==="index"&&row.table==="memory_live_change_checkpoints")
    ||explicit.length!==5||"sha256:"+await memoryDigest(memoryCanonical(explicit.map(row=>({...row,sql:normalized(row.sql as string)}))))!==memoryCheckpointSchemaProfile.digest))fail();
  if(env.DB!==db)fail();
  const raw=JSON.stringify(rows.map(row=>({name:row.name,sql:row.sql,table:row.table,type:row.type})));
  return {present:rows.length>0,guard:{condition:`${snapshot}=? AND NOT EXISTS(SELECT 1 FROM sqlite_temp_schema WHERE ${family})`,bindings:[raw]}};
}

/** Called after reference INSERT, in the SAME guarded batch as the source cursor.
 * Counts describe observed publications, never current eligibility/comprehension.
 * Any future consumer must reread native custody, lifetime and source exclusions. */
export async function prepareLiveMemoryCheckpoint(env:WorkerEnv,e:LiveMemoryEnrollment,through:number,now:string) {
  const db=env.DB,schema=await liveMemoryCheckpointSchema(env);
  if(env.DB!==db||!Number.isSafeInteger(through)||through<e.cursor_sequence)throw new Error("memory-checkpoint-input-invalid");
  if(!schema.present||through===e.cursor_sequence)return {guard:schema.guard,writes:[] as D1PreparedStatement[]};
  const writes=[db.prepare("DELETE FROM memory_live_change_checkpoints WHERE enrollment_id=? AND expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(e.enrollment_id),
    db.prepare(`INSERT INTO memory_live_change_checkpoints(enrollment_id,enrollment_revision,generation,after_sequence,through_sequence,observed_references,created_at,updated_at,expires_at)
      SELECT ?,?,lower(hex(randomblob(16))),?,?,COUNT(*),?,?,MIN(?,MIN(expires_at)) FROM memory_live_sources
      WHERE enrollment_id=? AND sequence>? AND sequence<=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') HAVING COUNT(*)>0
      ON CONFLICT(enrollment_id) DO UPDATE SET generation=excluded.generation,through_sequence=excluded.through_sequence,
        observed_references=MIN(9007199254740991,memory_live_change_checkpoints.observed_references+excluded.observed_references),
        updated_at=excluded.updated_at,expires_at=MIN(memory_live_change_checkpoints.expires_at,excluded.expires_at)
      WHERE memory_live_change_checkpoints.enrollment_revision=excluded.enrollment_revision
        AND excluded.after_sequence>=memory_live_change_checkpoints.through_sequence
        AND excluded.through_sequence>memory_live_change_checkpoints.through_sequence`)
      .bind(e.enrollment_id,e.revision,e.cursor_sequence,through,now,now,e.expires_at,e.enrollment_id,e.cursor_sequence,through)];
  writes.push(db.prepare(`SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM memory_live_sources WHERE enrollment_id=? AND sequence>? AND sequence<=?
      AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR EXISTS(SELECT 1 FROM memory_live_change_checkpoints
      WHERE enrollment_id=? AND enrollment_revision=? AND after_sequence<=? AND through_sequence=?
      AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) THEN 1 ELSE json('memory_checkpoint_publication_changed') END AS verified`)
    .bind(e.enrollment_id,e.cursor_sequence,through,e.enrollment_id,e.revision,e.cursor_sequence,through));
  return {guard:schema.guard,writes};
}

/** Explicit native privacy inverse; schema bookends prevent missing triggers
 * from turning a successful Forget into retained processing metadata. */
export async function prepareLiveMemoryCheckpointWithdrawal(env:WorkerEnv,selector:NativeMemoryOriginWithdrawalSelector) {
  const db=env.DB,original=memoryCanonical(selector),selected=structuredClone(selector),schema=await liveMemoryCheckpointSchema(env);
  const assertion=(guard:MemorySqlGuard)=>db.prepare(`SELECT CASE WHEN (${guard.condition}) THEN 1 ELSE json('memory_checkpoint_withdrawal_changed') END AS verified`).bind(...guard.bindings);
  let clause="0",bindings:(string|number|null)[]=[];
  if(schema.present){
    if("enrollmentId" in selected){
      clause="enrollment_id=?";bindings=[selected.enrollmentId];
      if("currentRevision" in selected){clause+=" AND EXISTS(SELECT 1 FROM memory_live_enrollments current WHERE current.enrollment_id=? AND current.revision=?)";
        bindings.push(selected.enrollmentId,selected.currentRevision);}
    }
    else if("actorUserId" in selected){clause=`enrollment_id IN(SELECT enrollment_id FROM memory_live_enrollments WHERE actor_user_id=?${selected.personalOnly?" AND organization_id IS NULL":""})`;bindings=[selected.actorUserId];}
    else if("organizationId" in selected){clause="enrollment_id IN(SELECT enrollment_id FROM memory_live_enrollments WHERE organization_id=?)";bindings=[selected.organizationId];}
    else if("eventId" in selected){clause=`enrollment_id IN(SELECT source.enrollment_id FROM memory_live_sources source JOIN memory_live_enrollments e USING(enrollment_id)
      WHERE source.event_id=? AND 'creative:'||e.owner_user_id=?)`;bindings=[selected.eventId,selected.eventStreamId];}
    else if("contentId" in selected){clause=`enrollment_id IN(SELECT e.enrollment_id FROM memory_live_enrollments e JOIN assistant_turns turn
      ON (turn.actor_user_id,turn.organization_id,turn.project_access_id,turn.project_id,turn.document_id)
        IS (e.actor_user_id,e.organization_id,e.project_access_id,e.project_id,e.document_id)
      WHERE turn.user_content_ref=? OR turn.assistant_content_ref=?)`;
      bindings=[selected.contentId,selected.contentId];}
    else {
      const names=["memory_native_answer_origins","memory_structured_answer_origins","memory_document_job_answer_origins"];
      const query="SELECT name,type,sql FROM sqlite_schema WHERE name IN(?,?,?) ORDER BY name";
      const result=await db.prepare(query).bind(...names).all<{name:string;type:string;sql:string}>();
      if(env.DB!==db||!result||result.success!==true||"error" in result&&result.error!==undefined||!Array.isArray(result.results)||result.results.length>3
        ||result.results.some(row=>!row||Object.keys(row).sort().join(",")!=="name,sql,type"||!names.includes(row.name)||row.type!=="table"||typeof row.sql!=="string"))fail();
      const rows=result.results;
      schema.guard={condition:`(${schema.guard.condition}) AND (SELECT json_group_array(json_object('name',name,'type',type,'sql',sql)) FROM (${query}))=?`,
        bindings:[...schema.guard.bindings,...names,JSON.stringify(rows.map(row=>({name:row.name,type:row.type,sql:row.sql})))]};
      if(rows.length){clause=`enrollment_id IN(${rows.map(row=>`SELECT enrollment_id FROM ${row.name} WHERE origin_id=?`).join(" UNION ")})`;bindings=rows.map(()=>selected.originId);}
    }
  }
  const terminal={condition:schema.present?`(${schema.guard.condition}) AND NOT EXISTS(SELECT 1 FROM memory_live_change_checkpoints WHERE ${clause})`:schema.guard.condition,
    bindings:[...schema.guard.bindings,...bindings]};
  if(env.DB!==db||memoryCanonical(selector)!==original)throw new Error("memory-checkpoint-withdrawal-changed");
  const statements=[assertion(schema.guard),...(schema.present?[db.prepare(`DELETE FROM memory_live_change_checkpoints WHERE ${clause}`).bind(...bindings)]:[]),assertion(terminal)];
  return {statements,assertionIndexes:[0,statements.length-1],terminal:assertion(terminal),acknowledge(results:readonly D1Result[]){
    return env.DB===db&&memoryCanonical(selector)===original&&results.length===statements.length&&results.every(result=>result?.success===true
      &&!("error" in result&&result.error!==undefined)&&Array.isArray(result.results))&&verified(results[0]!)&&verified(results.at(-1)!);
  }};
}

/** Physical expiry is independent of learning and scheduling admission. Native
 * enrollment/source triggers invalidate hints on erasure or source mutation. */
export async function sweepExpiredMemoryCheckpoints(env:WorkerEnv,limit=128) {
  if(!Number.isSafeInteger(limit)||limit<1||limit>128)throw new Error("memory-checkpoint-limit-invalid");
  const db=env.DB,schema=await liveMemoryCheckpointSchema(env);
  const assertion=()=>db.prepare(`SELECT CASE WHEN (${schema.guard.condition}) THEN 1 ELSE json('memory_checkpoint_schema_changed') END AS verified`).bind(...schema.guard.bindings);
  const statements=[assertion(),...(schema.present?[db.prepare(`DELETE FROM memory_live_change_checkpoints WHERE enrollment_id IN(
    SELECT enrollment_id FROM memory_live_change_checkpoints WHERE expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') ORDER BY expires_at,enrollment_id LIMIT ?)` ).bind(limit)]:[]),assertion()];
  if(env.DB!==db)fail();
  const results=await db.batch(statements);
  if(env.DB!==db||!Array.isArray(results)||results.length!==statements.length||!results.every(row=>row?.success===true&&(!("error" in row)||row.error===undefined)&&Array.isArray(row.results))
    ||!verified(results[0]!)||!verified(results.at(-1)!)
    ||schema.present&&(typeof results[1]?.meta?.changes!=="number"||!Number.isSafeInteger(results[1].meta.changes)||results[1].meta.changes<0||results[1].meta.changes>limit))throw new Error("memory-checkpoint-cleanup-unconfirmed");
  return {status:schema.present?"completed":"not-installed",erased:schema.present?results[1]!.meta.changes:0};
}

/** Authenticated caller supplies freshly resolved native guards. No metadata
 * from another actor, stale enrollment, or expired checkpoint is returned. */
export async function readLiveMemoryCheckpointHealth(env:WorkerEnv,e:LiveMemoryEnrollment,guards:MemorySqlGuard[]) {
  const db=env.DB,schema=await liveMemoryCheckpointSchema(env),columns=["enrollment_id","actor_user_id","owner_user_id","organization_id","project_access_id","project_id","document_id","permission_epoch","policy_version","revision","learn_enabled","recall_enabled","background_enabled","retention_days","time_zone","enrolled_at","expires_at","cursor_sequence","cutoff_sequence","last_local_day","last_admitted_at","next_due_at","lease_token","lease_expires_at","attempts","failure_code"] as const;
  const snapshotGuard:MemorySqlGuard={condition:`EXISTS(SELECT 1 FROM memory_live_enrollments WHERE ${columns.map(key=>`${key} IS ?`).join(" AND ")})`,bindings:columns.map(key=>e[key])};
  const allGuards=[...guards,snapshotGuard,schema.guard];
  const assertions=()=>allGuards.map(guard=>db.prepare(`SELECT CASE WHEN (${guard.condition}) THEN 1 ELSE json('memory_checkpoint_authority_changed') END AS verified`).bind(...guard.bindings));
  const select=schema.present?db.prepare(`SELECT ${MEMORY_CHECKPOINT_COLUMNS.join(",")} FROM memory_live_change_checkpoints
    WHERE enrollment_id=? AND enrollment_revision=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')`).bind(e.enrollment_id,e.revision):db.prepare("SELECT 1 WHERE 0");
  const statements=[...assertions(),select,...assertions()];
  if(env.DB!==db||!guards.length)throw new Error("memory-checkpoint-health-unavailable");
  const results=structuredClone(await db.batch(statements));
  if(env.DB!==db||!Array.isArray(results)||results.length!==statements.length||!results.every(r=>r.success===true&&(!("error" in r)||r.error===undefined)&&Array.isArray(r.results))
    ||results.some((r,index)=>index!==allGuards.length&&!verified(r)))throw new Error("memory-checkpoint-health-unavailable");
  const rows=results[allGuards.length]!.results as Record<string,unknown>[];
  if(rows.length>1)throw new Error("memory-checkpoint-health-unavailable");
  const row=rows[0],iso=(value:unknown):value is string=>typeof value==="string"&&value.length===24&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
  if(row&&(Object.keys(row).sort().join(",")!==[...MEMORY_CHECKPOINT_COLUMNS].sort().join(",")||row.enrollment_id!==e.enrollment_id||row.enrollment_revision!==e.revision
    ||typeof row.generation!=="string"||!/^[0-9a-f]{32}$/u.test(row.generation)
    ||![row.after_sequence,row.through_sequence,row.observed_references].every(Number.isSafeInteger)
    ||Number(row.after_sequence)<0||Number(row.through_sequence)<=Number(row.after_sequence)||Number(row.through_sequence)>e.cursor_sequence||Number(row.observed_references)<1
    ||!iso(row.created_at)||!iso(row.updated_at)||!iso(row.expires_at)||row.created_at>row.updated_at||row.updated_at>=row.expires_at||Date.parse(row.expires_at)<=Date.now()))throw new Error("memory-checkpoint-health-unavailable");
  return {state:!schema.present?"not-installed":row?"reference-checkpoint":"no-checkpoint",semanticProcessing:"not-implemented",
    delivery:"disposable-checkpoint-not-a-derivation-queue",observedReferences:row?Number(row.observed_references):0,
    countMeaning:"references-observed-at-publication-not-current-evidence",pendingSince:row?.created_at??null,lastPublishedAt:row?.updated_at??null,expiresAt:row?.expires_at??null};
}

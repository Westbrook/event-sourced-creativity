import { memoryScopeProfileSchemaDigest } from './memory-scope-profile-schema.ts';
import { memoryCanonical,type MemorySqlGuard } from './memory-sql.ts';
import { memoryDigest } from '../src/model/scoped-memory.ts';
import { derivationAssertion,derivationResults,derivationVerified,memoryDerivationSchema,memoryDerivationEnabled } from './memory-derivation-store.ts';
import { derivationExact } from './memory-derivation-policy.ts';
import { liveMemoryPrincipal,liveMemoryAuthorityFromPrincipal,liveMemoryEnrollmentGuard,type LiveMemoryEnrollment } from './memory-live-authority.ts';
import { DERIVATION_PARENT_COLUMNS } from './memory-derivation-admission.ts';
import { prepareNativeScopeProfile,nativeScopeProfileInputs,nativeScopeProfileStatements,nativeScopeProfilePublication,type NativeScopeProfile } from './memory-scope-profile.ts';
import type { WorkerEnv } from './runtime.ts';

const family="name LIKE 'memory_scope_profile_%' OR name LIKE 'idx_memory_scope_profile_%' OR tbl_name IN('memory_scope_profile_snapshots','memory_scope_profile_checkpoints') OR instr(lower(COALESCE(sql,'')),'memory_scope_profile_snapshots')>0 OR instr(lower(COALESCE(sql,'')),'memory_scope_profile_checkpoints')>0";
const schemaSql=`SELECT name,sql,tbl_name AS 'table',type FROM sqlite_schema WHERE ${family} ORDER BY name,type`;
export async function memoryScopeProfileSchema(env:WorkerEnv):Promise<MemorySqlGuard|null>{
 const db=env.DB,rows=structuredClone(await db.prepare(schemaSql+' LIMIT 17').all<Record<string,unknown>>());
 if(env.DB!==db||!derivationResults([rows],1)||rows.results.length>16)throw Error('scope_profile_schema');if(!rows.results.length)return null;
 if(await memoryDigest(memoryCanonical(rows.results))!==memoryScopeProfileSchemaDigest||env.DB!==db)throw Error('scope_profile_schema');
 return {condition:`(SELECT json_group_array(json_object('name',name,'sql',sql,'table',"table",'type',type)) FROM (${schemaSql}))=? AND NOT EXISTS(SELECT 1 FROM sqlite_temp_schema)`,bindings:[JSON.stringify(rows.results)]};
}
const receipt=(condition:string,bindings:Array<string|number|null>):MemorySqlGuard=>({condition,bindings});
const checkpoint=(env:WorkerEnv,actor:string,target:string,revision:number,at:string,status:string)=>env.DB.prepare(`INSERT INTO memory_scope_profile_checkpoints(target_enrollment_id,actor_user_id,target_revision,checked_at,status) VALUES(?,?,?,?,?)
 ON CONFLICT(target_enrollment_id) DO UPDATE SET target_revision=excluded.target_revision,checked_at=excluded.checked_at,status=excluded.status
 WHERE memory_scope_profile_checkpoints.actor_user_id=excluded.actor_user_id AND memory_scope_profile_checkpoints.checked_at<=excluded.checked_at`).bind(target,actor,revision,at,status);
/** Native proof and receipt are atomic. A repeated publication never renews
 * the original retention or counts old model text as fresh support. */
export async function publishNativeScopeProfile(env:WorkerEnv,profile:NativeScopeProfile){
 const db=env.DB,schema=await memoryScopeProfileSchema(env);if(!schema)return {status:'unavailable' as const};
 const data=await nativeScopeProfilePublication(env,profile),now=new Date().toISOString(),proof=[derivationAssertion(env,schema),...nativeScopeProfileStatements(env,profile)];
 const before=await db.prepare('SELECT profile_id FROM memory_scope_profile_snapshots WHERE profile_id=? AND actor_user_id=?').bind(data.profileId,data.actorUserId).first();nativeScopeProfileInputs(env,profile);
 const status=before?'unchanged':'stored';
 const verified=receipt(`EXISTS(SELECT 1 FROM memory_scope_profile_snapshots WHERE profile_id=? AND actor_user_id=? AND target_enrollment_id=? AND target_revision=? AND manifest_json=? AND expires_at=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,[data.profileId,data.actorUserId,data.targetEnrollmentId,data.targetRevision,data.manifest,data.expiresAt]);
 const check=receipt('EXISTS(SELECT 1 FROM memory_scope_profile_checkpoints WHERE target_enrollment_id=? AND actor_user_id=? AND target_revision=? AND checked_at=? AND status=?)',[data.targetEnrollmentId,data.actorUserId,data.targetRevision,now,status]);
 const rows=await db.batch([...proof,db.prepare(`INSERT INTO memory_scope_profile_snapshots(profile_id,actor_user_id,target_enrollment_id,target_revision,manifest_json,created_at,expires_at)
 SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM memory_scope_profile_snapshots WHERE profile_id=?)`).bind(data.profileId,data.actorUserId,data.targetEnrollmentId,data.targetRevision,data.manifest,now,data.expiresAt,data.profileId),
 derivationAssertion(env,verified),checkpoint(env,data.actorUserId,data.targetEnrollmentId,data.targetRevision,now,status),derivationAssertion(env,check)]);
 nativeScopeProfileInputs(env,profile);
 if(env.DB!==db||!derivationResults(rows,proof.length+4)||!rows.slice(0,proof.length).every(derivationVerified)||!derivationVerified(rows[proof.length+1]!)||!derivationVerified(rows[proof.length+3]!)||rows[proof.length]!.results.length||rows[proof.length+2]!.results.length)throw Error('scope_profile_publication_unconfirmed');
 return {status:status as 'stored'|'unchanged',profileId:data.profileId};
}
/** Reader checks a newly prepared native projection; it never reads a stored
 * profile body or falls back to an earlier publication. */
export async function readNativeScopeProfilePublication(env:WorkerEnv,profile:NativeScopeProfile){
 const db=env.DB,schema=await memoryScopeProfileSchema(env);if(!schema)return null;const data=await nativeScopeProfilePublication(env,profile);
 const proof=[derivationAssertion(env,schema),...nativeScopeProfileStatements(env,profile)],rows=await db.batch([...proof,db.prepare(`SELECT created_at FROM memory_scope_profile_snapshots
 WHERE profile_id=? AND actor_user_id=? AND target_enrollment_id=? AND target_revision=? AND manifest_json=? AND expires_at=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') LIMIT 2`).bind(data.profileId,data.actorUserId,data.targetEnrollmentId,data.targetRevision,data.manifest,data.expiresAt)]);
 nativeScopeProfileInputs(env,profile);if(env.DB!==db||!derivationResults(rows,proof.length+1)||!rows.slice(0,proof.length).every(derivationVerified)||rows.at(-1)!.results.length>1||rows.at(-1)!.results.some(r=>!derivationExact(r,['created_at'])))throw Error('scope_profile_publication_unavailable');
 return rows.at(-1)!.results[0]?{profileId:data.profileId,publishedAt:String(rows.at(-1)!.results[0]!.created_at)}:null;
}
const enabled=(env:WorkerEnv)=>env.FORMA_MEMORY_SCHEDULING_ENABLED==='true'&&env.FORMA_MEMORY_DERIVATION_PROCESSING_ENABLED==='true';
/** One bounded target per invocation. New completed source profiles/control
 * changes trigger follow-up; daily revalidation is maintenance, not new model
 * inference. Checkpoints rotate unavailable scopes so they cannot starve peers. */
export async function runScopeProfileScheduled(env:WorkerEnv){
 if(!enabled(env))return {status:'disabled',processed:0};const db=env.DB,schema=await memoryScopeProfileSchema(env);if(!schema)return {status:'unavailable',processed:0};
 const derived=await memoryDerivationSchema(env);if(!derived.completionPresent||!derived.resultsPresent)return {status:'unavailable',processed:0};
 const actors=[...new Set((env.FORMA_MEMORY_DERIVATION_USER_IDS??'').split(',').map(v=>v.trim()).filter(v=>memoryDerivationEnabled(env,v)))];if(!actors.length)return {status:'disabled',processed:0};
 const selected=await db.batch([derivationAssertion(env,schema),derivationAssertion(env,derived.guard),db.prepare(`SELECT e.* FROM memory_live_enrollments e LEFT JOIN memory_scope_profile_checkpoints c ON c.target_enrollment_id=e.enrollment_id AND c.actor_user_id=e.actor_user_id
  WHERE e.actor_user_id IN(SELECT value FROM json_each(?)) AND e.learn_enabled=1 AND e.recall_enabled=1 AND e.background_enabled=1 AND e.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
   AND EXISTS(SELECT 1 FROM memory_derivation_grants g JOIN memory_derivation_jobs j ON j.consent_id=g.consent_id JOIN memory_derivation_completions done ON done.job_id=j.job_id AND done.outcome='stored'
    WHERE g.enrollment_id=e.enrollment_id AND g.actor_user_id=e.actor_user_id AND g.purpose='profile' AND g.enrollment_revision=e.revision AND g.revoked_at IS NULL AND g.background_enabled=1 AND g.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
   AND (c.target_enrollment_id IS NULL OR c.target_revision<>e.revision OR c.checked_at<strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')
    OR c.checked_at<(SELECT MAX(done.completed_at) FROM memory_derivation_completions done JOIN memory_derivation_jobs j ON j.job_id=done.job_id JOIN memory_derivation_grants g ON g.consent_id=j.consent_id WHERE g.actor_user_id=e.actor_user_id AND g.organization_id IS e.organization_id AND g.purpose='profile' AND done.outcome='stored')
    OR c.checked_at<(SELECT MAX(b.consented_at) FROM memory_recall_boundaries b JOIN memory_live_enrollments source ON source.enrollment_id=b.enrollment_id WHERE source.actor_user_id=e.actor_user_id AND source.organization_id IS e.organization_id))
  ORDER BY COALESCE(c.checked_at,''),e.enrollment_id LIMIT 1`).bind(JSON.stringify(actors))]);
 if(env.DB!==db||!enabled(env)||!derivationResults(selected,3)||!selected.slice(0,2).every(derivationVerified)||selected[2]!.results.length>1)throw Error('scope_profile_schedule_inventory');
 const row=selected[2]!.results[0];if(!row)return {status:'idle',processed:0};if(!derivationExact(row,DERIVATION_PARENT_COLUMNS))throw Error('scope_profile_schedule_inventory');const target=row as unknown as LiveMemoryEnrollment;
 const actor=await liveMemoryPrincipal(env,target.actor_user_id),authority=liveMemoryAuthorityFromPrincipal(env,target,actor);
 try{if(!actor||!authority||!enabled(env))throw Error('scope_profile_authority');const profile=await prepareNativeScopeProfile(env,actor,target,[authority.guard]);if(!enabled(env))throw Error('scope_profile_disabled');const result=await publishNativeScopeProfile(env,profile);return {...result,processed:1};}
 catch{
  if(env.DB!==db||!enabled(env))return {status:'unavailable',processed:0};const at=new Date().toISOString();
  const checks=await db.batch([derivationAssertion(env,schema),derivationAssertion(env,derived.guard),derivationAssertion(env,liveMemoryEnrollmentGuard(target,'recall')),checkpoint(env,target.actor_user_id,target.enrollment_id,target.revision,at,'unavailable'),derivationAssertion(env,receipt('EXISTS(SELECT 1 FROM memory_scope_profile_checkpoints WHERE target_enrollment_id=? AND actor_user_id=? AND checked_at=? AND status=?)',[target.enrollment_id,target.actor_user_id,at,'unavailable']))]);
  if(!derivationResults(checks,5)||![0,1,2,4].every(i=>derivationVerified(checks[i]!)))throw Error('scope_profile_checkpoint_unconfirmed');return {status:'unavailable',processed:0};
 }
}
/** Derived metadata only, never authored work, finances or retained originals.
 * Source-free cleanup remains enabled when inference and scheduling are off. */
export async function sweepScopeProfiles(env:WorkerEnv){
 const db=env.DB,schema=await memoryScopeProfileSchema(env);if(!schema)return 0;const derived=await memoryDerivationSchema(env);if(!derived.resultsPresent)throw Error('scope_profile_source_schema');
 const rows=await db.batch([derivationAssertion(env,schema),derivationAssertion(env,derived.guard),db.prepare(`DELETE FROM memory_scope_profile_snapshots WHERE profile_id IN(SELECT p.profile_id FROM memory_scope_profile_snapshots p
 WHERE p.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NOT EXISTS(SELECT 1 FROM memory_live_enrollments e WHERE e.enrollment_id=p.target_enrollment_id AND e.actor_user_id=p.actor_user_id AND e.revision=p.target_revision AND e.learn_enabled=1 AND e.recall_enabled=1)
 OR EXISTS(SELECT 1 FROM json_each(p.manifest_json,'$.sources') source WHERE NOT EXISTS(SELECT 1 FROM memory_derivation_results r JOIN memory_derivation_jobs j ON j.job_id=r.job_id JOIN memory_derivation_grants g ON g.consent_id=j.consent_id WHERE r.job_id=json_extract(source.value,'$.jobId') AND r.output_sha256=json_extract(source.value,'$.outputSha256') AND r.state='active' AND r.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND g.actor_user_id=p.actor_user_id AND g.revoked_at IS NULL AND g.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')))
 ORDER BY p.created_at,p.profile_id LIMIT 16)`),env.DB.prepare('SELECT changes() AS erased'),db.prepare(`DELETE FROM memory_scope_profile_checkpoints WHERE target_enrollment_id IN(SELECT c.target_enrollment_id FROM memory_scope_profile_checkpoints c WHERE NOT EXISTS(SELECT 1 FROM memory_live_enrollments e WHERE e.enrollment_id=c.target_enrollment_id AND e.actor_user_id=c.actor_user_id AND e.learn_enabled=1 AND e.recall_enabled=1 AND e.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) ORDER BY c.checked_at,c.target_enrollment_id LIMIT 16)`)]);
 if(env.DB!==db||!derivationResults(rows,5)||!rows.slice(0,2).every(derivationVerified)||rows[3]!.results.length!==1||!Number.isSafeInteger(rows[3]!.results[0]!.erased)||Number(rows[3]!.results[0]!.erased)<0||Number(rows[3]!.results[0]!.erased)>16)throw Error('scope_profile_cleanup_unconfirmed');return Number(rows[3]!.results[0]!.erased);
}

/** Personal-only reference erasure is part of the caller's existing atomic
 * privacy barrier. Shared organization metadata is not personal custody. */
export async function prepareScopeProfilePersonalErasure(env:WorkerEnv,actorUserId:string){
 const db=env.DB,schema=await memoryScopeProfileSchema(env);
 if(!schema){const statements=[derivationAssertion(env,{condition:`NOT EXISTS(SELECT 1 FROM sqlite_schema WHERE ${family})`,bindings:[]})];return {statements,acknowledge:(rows:unknown)=>env.DB===db&&derivationResults(rows,1)&&rows.every(derivationVerified)};}
 const where="actor_user_id=? AND json_extract(manifest_json,'$.target.ownerUserId')=? AND json_type(manifest_json,'$.target.organizationId')='null' AND json_type(manifest_json,'$.target.projectAccessId')='null'";
 const censusSql='SELECT target_enrollment_id,actor_user_id,target_revision,checked_at,status FROM memory_scope_profile_checkpoints WHERE actor_user_id=? ORDER BY target_enrollment_id';
 const columns=['target_enrollment_id','actor_user_id','target_revision','checked_at','status'];
 const census=await db.prepare(`SELECT c.target_enrollment_id,c.actor_user_id,c.target_revision,c.checked_at,c.status,CASE WHEN e.owner_user_id=? AND e.organization_id IS NULL AND e.project_access_id IS NULL THEN 1 ELSE 0 END AS personal FROM memory_scope_profile_checkpoints c LEFT JOIN memory_live_enrollments e ON e.enrollment_id=c.target_enrollment_id AND e.actor_user_id=c.actor_user_id WHERE c.actor_user_id=? ORDER BY c.target_enrollment_id`).bind(actorUserId,actorUserId).all<Record<string,unknown>>();
 if(env.DB!==db||!derivationResults([census],1)||census.results.some(r=>!derivationExact(r,[...columns,'personal'])||![0,1].includes(Number(r.personal))))throw Error('scope_profile_erasure_inventory');
 const censusGuard:MemorySqlGuard={condition:`(SELECT json_group_array(json_array(target_enrollment_id,actor_user_id,target_revision,checked_at,status)) FROM (${censusSql}))=?`,bindings:[actorUserId,JSON.stringify(census.results.map(r=>columns.map(k=>r[k])))]};
 const ids=JSON.stringify(census.results.filter(r=>r.personal===1).map(r=>r.target_enrollment_id));
 const checkpointWhere='actor_user_id=? AND target_enrollment_id IN(SELECT value FROM json_each(?))';
 const statements=[derivationAssertion(env,schema),derivationAssertion(env,censusGuard),db.prepare('DELETE FROM memory_scope_profile_snapshots WHERE '+where).bind(actorUserId,actorUserId),db.prepare('DELETE FROM memory_scope_profile_checkpoints WHERE '+checkpointWhere).bind(actorUserId,ids),derivationAssertion(env,{condition:`NOT EXISTS(SELECT 1 FROM memory_scope_profile_snapshots WHERE ${where}) AND NOT EXISTS(SELECT 1 FROM memory_scope_profile_checkpoints WHERE ${checkpointWhere})`,bindings:[actorUserId,actorUserId,actorUserId,ids]})];
 return {statements,acknowledge:(rows:unknown)=>env.DB===db&&derivationResults(rows,5)&&[0,1,4].every(i=>derivationVerified(rows[i]!))};
}

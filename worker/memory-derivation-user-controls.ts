import type { WorkerEnv } from './runtime.ts';
import { memoryCanonical, type MemorySqlGuard } from './memory-sql.ts';
import { memoryDigest } from '../src/model/scoped-memory.ts';
import { derivationExact,derivationHash,derivationId,derivationInteger } from './memory-derivation-policy.ts';
import { derivationAssertion,derivationChanged,derivationResults,derivationVerified,memoryDerivationSchema } from './memory-derivation-store.ts';
import { nativeDerivationResultControlTarget,nativeDerivationResultStatements,type NativeDerivationResultRead } from './memory-derivation-results.ts';
import { DERIVATION_USER_CONTROL_COLUMNS as columns, derivationControlRelation } from './memory-derivation-user-control-schema.ts';

type Row=Record<string,string|number|null>;
type Storage='original'|'observation';
const table=(kind:Storage)=>kind==='original'?'memory_derivation_user_controls':'memory_derivation_observation_controls';
const field=(key:string,kind:Storage)=>key==='source_content_ref'&&kind==='observation'?'source_event_ref':key;
const fields=(kind:Storage)=>columns.map(key=>field(key,kind));
const projection=(kind:Storage)=>columns.map(key=>field(key,kind)===key?key:field(key,kind)+' AS '+key).join(',');
export type MemoryUserControlAction='suppressed'|'corrected'|'released';
const clock="strftime('%Y-%m-%dT%H:%M:%fZ','now')";
function textFor(action:MemoryUserControlAction,text:unknown):string|null{
  if(action!=='corrected'){if(!['suppressed','released'].includes(action)||text!==null)throw Error('memory-user-control-invalid');return null;}
  if(typeof text!=='string'||!text.isWellFormed()||!text.trim()||Array.from(text).length>1000||new TextEncoder().encode(text).byteLength>4096)throw Error('memory-user-control-invalid');
  return text;
}
const snapshot=(env:WorkerEnv,id:string,row:Row|undefined,kind:Storage='original')=>derivationAssertion(env,{
  condition:`(SELECT json_group_array(json_array(${fields(kind).join(',')})) FROM ${table(kind)} WHERE control_id=?)=?`,
  bindings:[id,JSON.stringify(row?[columns.map(key=>row[key])]:[])],
});
const view=(row:Row)=>({controlId:row.control_id,claimKey:row.claim_key,lineageId:row.lineage_id,revision:row.revision,action:row.action,
  correctionText:row.correction_text,expiresAt:row.expires_at,semanticAuthority:'explicit-user-control' as const});
async function owned(env:WorkerEnv,actor:string,id:string,kind:Storage='original'){
  const result=structuredClone(await env.DB.prepare(`SELECT ${projection(kind)} FROM ${table(kind)} WHERE control_id=? AND actor_user_id=? LIMIT 2`).bind(id,actor).all<Row>());
  if(!derivationResults([result],1)||result.results.length>1||result.results.some(row=>!derivationExact(row,columns)))throw Error('memory-user-control-unavailable');
  return result.results[0];
}

/** Before any edit, pin the entire affected result/dependency count. The first
 * control mutation erases these bodies; subsequent mutations affect no results.
 * Both direct SQLite and total D1 receipts must match exactly. */
async function retirement(env:WorkerEnv,enrollment:string,purpose:string,actor:string,indexPresent:boolean){
  const selected=`SELECT j.job_id FROM memory_derivation_jobs j JOIN memory_derivation_grants g ON g.consent_id=j.consent_id
    WHERE g.enrollment_id=? AND g.purpose=? AND g.actor_user_id=?`;
  const query=`SELECT (SELECT COUNT(*) FROM memory_derivation_results WHERE state IN('staging','active') AND job_id IN(${selected})) AS bodies,
    ((SELECT COUNT(*) FROM memory_derivation_result_dependencies WHERE job_id IN(SELECT job_id FROM memory_derivation_results
      WHERE state IN('staging','active') AND job_id IN(${selected})))${indexPresent ? `+(SELECT COUNT(*) FROM memory_derivation_index_intents WHERE operation='upsert' AND job_id IN(SELECT job_id FROM memory_derivation_results WHERE state IN('staging','active') AND job_id IN(${selected})))` : ''}) AS dependencies`;
  const bindings=[enrollment,purpose,actor,enrollment,purpose,actor,...(indexPresent?[enrollment,purpose,actor]:[])],rows=structuredClone(await env.DB.prepare(query).bind(...bindings).all<Record<string,unknown>>());
  if(!derivationResults([rows],1)||rows.results.length!==1||!derivationExact(rows.results[0],['bodies','dependencies'])
    ||!derivationInteger(rows.results[0].bodies,0,1024)||!derivationInteger(rows.results[0].dependencies,0,1024*2049))throw Error('memory-user-control-unavailable');
  const row=rows.results[0];return {changes:Number(row.bodies)+Number(row.dependencies),guard:derivationAssertion(env,{
    condition:`(SELECT bodies FROM (${query}))=? AND (SELECT dependencies FROM (${query}))=?`,
    bindings:[...bindings,Number(row.bodies),...bindings,Number(row.dependencies)]})};
}

/** Derive all identities/deadlines from a fresh native result proof. Expected
 * revisions prevent a stale inspector from overwriting a newer human decision.
 * The provider never receives this function or any write capability. */
export async function controlNativeDerivationResult(env:WorkerEnv,read:NativeDerivationResultRead,claimKey:string,
  action:Exclude<MemoryUserControlAction,'released'>,correctionText:unknown,expectedRevisions:Readonly<Record<string,number>>,authorizationGuard?:MemorySqlGuard){
  const correction=textFor(action,correctionText),db=env.DB,schema=await memoryDerivationSchema(env);
  if(!schema.userControlsPresent||!['suppressed','corrected'].includes(action)||env.DB!==db)throw Error('memory-user-control-unavailable');
  const target=nativeDerivationResultControlTarget(env,read,claimKey);
  if(!derivationExact(expectedRevisions,target.lineages.map(lineage=>lineage.lineageId))
    ||Object.values(expectedRevisions).some(value=>!derivationInteger(value,0,Number.MAX_SAFE_INTEGER-1)))throw Error('memory-user-control-revision-required');
  const now=new Date().toISOString(),next:Row[]=[],previous:(Row|undefined)[]=[],kinds:Storage[]=[];
  for(const lineage of target.lineages){
    const kind=lineage.kind;if(kind==='observation'&&!schema.observationControlsPresent)throw Error('memory-user-control-unavailable');
    const id=await memoryDigest(memoryCanonical([kind==='observation'?'native-observation-user-control-v1':'native-user-control-v1',target.enrollmentId,target.purpose,lineage.lineageId]));
    const prior=await owned(env,target.actorUserId,id,kind);kinds.push(kind);
    if((prior?.revision??0)!==expectedRevisions[lineage.lineageId])throw Error('memory-user-control-revision-changed');
    const row:Row={control_id:id,enrollment_id:target.enrollmentId,actor_user_id:target.actorUserId,purpose:target.purpose,scope_key:target.scopeKey,
      lineage_id:lineage.lineageId,claim_key:target.claimKey,source_content_ref:lineage.sourceContentRef,revision:Number(prior?.revision??0)+1,
      action,correction_text:correction,created_at:prior?.created_at??now,updated_at:now,expires_at:[lineage.expiresAt,String(prior?.expires_at??lineage.expiresAt)].sort()[0]!};
    if(prior&&(prior.scope_key!==row.scope_key||prior.source_content_ref!==row.source_content_ref))throw Error('memory-user-control-target-changed');
    previous.push(prior);next.push(row);
  }
  const retiring=await retirement(env,target.enrollmentId,target.purpose,target.actorUserId,schema.indexPresent);
  const statements=[...nativeDerivationResultStatements(env,read),derivationAssertion(env,schema.guard),retiring.guard,
    ...next.map((row,i)=>snapshot(env,String(row.control_id),previous[i],kinds[i])),
    ...(schema.observationControlsPresent?[derivationAssertion(env,{condition:`(SELECT COUNT(*) FROM ${derivationControlRelation(true)} WHERE enrollment_id=?)+?<=1024`,bindings:[target.enrollmentId,next.filter(row=>row.revision===1).length]})]:[]),...(authorizationGuard?[derivationAssertion(env,authorizationGuard)]:[])];
  const writes:number[]=[];
  for(const [index,row] of next.entries()){
    const kind=kinds[index]!;writes.push(statements.length);
    if(Number(row.revision)===1)statements.push(db.prepare(`INSERT INTO ${table(kind)}(${fields(kind).join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).bind(...columns.map(key=>row[key]!)));
    else statements.push(db.prepare(`UPDATE ${table(kind)} SET claim_key=?,revision=?,action=?,correction_text=?,updated_at=?,expires_at=? WHERE control_id=? AND revision=?`)
      .bind(row.claim_key!,row.revision!,row.action!,row.correction_text!,row.updated_at!,row.expires_at!,row.control_id!,Number(row.revision)-1));
    statements.push(derivationAssertion(env,{condition:'changes()=1',bindings:[]}),snapshot(env,String(row.control_id),row,kind));
  }
  if(env.DB!==db)throw Error('memory-user-control-unavailable');
  const results=structuredClone(await db.batch<Record<string,unknown>>(statements));
  if(env.DB!==db||!derivationResults(results,statements.length)||!results.every((row,index)=>{
    const i=writes.indexOf(index);return i>=0?derivationChanged(row,1,i===0?retiring.changes:0):derivationVerified(row)||row.results.length===1&&row.results[0]?.context_source_asserted===1;
  }))throw Error('memory-user-control-commit-unconfirmed');
  return next.map(view);
}

/** Authenticated owner revision, independent of model output or source read
 * permission. The user knows and authors this private control; no original text
 * or stored correction is returned until a separate current-scope read succeeds. */
export async function reviseNativeDerivationUserControl(env:WorkerEnv,actorUserId:string,controlId:string,revision:number,
  action:MemoryUserControlAction,correctionText:unknown,authorizationGuard?:MemorySqlGuard){
  const correction=textFor(action,correctionText);
  if(!derivationId(actorUserId)||!derivationHash(controlId)||!derivationInteger(revision,1,Number.MAX_SAFE_INTEGER-1))throw Error('memory-user-control-invalid');
  const db=env.DB,schema=await memoryDerivationSchema(env);if(!schema.userControlsPresent)throw Error('memory-user-control-unavailable');
  let kind:Storage='original',prior=await owned(env,actorUserId,controlId);
  if(schema.observationControlsPresent){const observation=await owned(env,actorUserId,controlId,'observation');
    if(prior&&observation)throw Error('memory-user-control-unavailable');if(observation){prior=observation;kind='observation';}}
  if(!prior||prior.revision!==revision||String(prior.expires_at)<=new Date().toISOString())throw Error('memory-user-control-revision-changed');
  const next={...prior,revision:revision+1,action,correction_text:correction,updated_at:new Date().toISOString()},retiring=await retirement(env,String(prior.enrollment_id),String(prior.purpose),actorUserId,schema.indexPresent);
  const statements=[derivationAssertion(env,schema.guard),snapshot(env,controlId,prior,kind),retiring.guard,
    db.prepare(`UPDATE ${table(kind)} SET revision=?,action=?,correction_text=?,updated_at=? WHERE control_id=? AND actor_user_id=? AND revision=?`)
      .bind(revision+1,action,correction,next.updated_at,controlId,actorUserId,revision),
    derivationAssertion(env,{condition:'changes()=1',bindings:[]}),snapshot(env,controlId,next,kind),
    ...(authorizationGuard?[derivationAssertion(env,authorizationGuard)]:[])];
  if(env.DB!==db)throw Error('memory-user-control-unavailable');
  const result=structuredClone(await db.batch<Record<string,unknown>>(statements));
  if(env.DB!==db||!derivationResults(result,statements.length)||authorizationGuard&&!derivationVerified(result[6]!)||![0,1,2,4,5].every(i=>derivationVerified(result[i]!))||!derivationChanged(result[3]!,1,retiring.changes))throw Error('memory-user-control-commit-unconfirmed');
  return {controlId,revision:revision+1,action,expiresAt:prior.expires_at};
}

export async function sweepNativeDerivationUserControls(env:WorkerEnv){
  const db=env.DB,schema=await memoryDerivationSchema(env);if(!schema.userControlsPresent)return 0;
  if(schema.observationControlsPresent)return sweepBothControlStores(env,schema);
  // Source/result expiry runs first. Refuse cleanup that would cascade into an
  // unexpectedly active result; never acknowledge a guessed D1 change count.
  const selected=`SELECT control_id FROM memory_derivation_user_controls c WHERE expires_at<=${clock}
    AND NOT EXISTS(SELECT 1 FROM memory_derivation_results r JOIN memory_derivation_jobs j ON j.job_id=r.job_id
      JOIN memory_derivation_grants g ON g.consent_id=j.consent_id WHERE g.enrollment_id=c.enrollment_id AND g.purpose=c.purpose AND r.state IN('staging','active'))
    ORDER BY expires_at,control_id LIMIT 128`;
  const statements=[derivationAssertion(env,schema.guard),db.prepare(`DELETE FROM memory_derivation_user_controls WHERE control_id IN(${selected})`),db.prepare('SELECT changes() AS direct_changes')];
  const result=structuredClone(await db.batch<Record<string,unknown>>(statements)),n=result[2]?.results[0]?.direct_changes;
  if(env.DB!==db||!derivationResults(result,3)||!derivationVerified(result[0]!)||result[2]?.results.length!==1||!derivationInteger(n,0,128)||!derivationChanged(result[1]!,n))throw Error('memory-user-control-cleanup-unconfirmed');
  return n;
}

async function sweepBothControlStores(env:WorkerEnv,schema:Awaited<ReturnType<typeof memoryDerivationSchema>>){
  const db=env.DB,selected=`SELECT control_id FROM ${derivationControlRelation(true)} c WHERE expires_at<=${clock}
    AND NOT EXISTS(SELECT 1 FROM memory_derivation_results r JOIN memory_derivation_jobs j ON j.job_id=r.job_id
      JOIN memory_derivation_grants g ON g.consent_id=j.consent_id WHERE g.enrollment_id=c.enrollment_id AND g.purpose=c.purpose AND r.state IN('staging','active'))
    ORDER BY expires_at,control_id LIMIT 128`;
  const observed=structuredClone(await db.prepare(selected).all<Row>());
  if(env.DB!==db||!derivationResults([observed],1)||observed.results.length>128||observed.results.some(row=>!derivationExact(row,['control_id'])||!derivationHash(row.control_id))
    ||new Set(observed.results.map(row=>row.control_id)).size!==observed.results.length)throw Error('memory-user-control-cleanup-unconfirmed');
  const ids=JSON.stringify(observed.results.map(row=>row.control_id)),statements=[derivationAssertion(env,schema.guard),derivationAssertion(env,{
    condition:`(SELECT json_group_array(control_id) FROM (${selected}))=?`,bindings:[ids]})];
  for(const kind of ['original','observation'] as const)statements.push(db.prepare(`DELETE FROM ${table(kind)} WHERE control_id IN(SELECT value FROM json_each(?))`).bind(ids),db.prepare('SELECT changes() AS direct_changes'));
  const result=structuredClone(await db.batch<Record<string,unknown>>(statements));
  if(env.DB!==db||!derivationResults(result,6)||![0,1].every(i=>derivationVerified(result[i]!)))throw Error('memory-user-control-cleanup-unconfirmed');
  let total=0;for(const i of [2,4]){const row=result[i+1]!,n=row.results[0]?.direct_changes;
    if(row.results.length!==1||!derivationExact(row.results[0],['direct_changes'])||!derivationInteger(n,0,128)||!derivationChanged(result[i]!,n))throw Error('memory-user-control-cleanup-unconfirmed');total+=n;}
  if(total!==observed.results.length)throw Error('memory-user-control-cleanup-unconfirmed');return total;
}

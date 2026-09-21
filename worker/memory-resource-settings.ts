import { nextResourceMemoryNight } from './memory-resource-schedule.ts';
import { memoryResourceSelector } from '../src/model/memory-resource-scope.ts';
import { memoryCustodyMatches,parseMemoryCustody } from '../src/model/memory-custody.ts';
import { memoryDigest } from '../src/model/scoped-memory.ts';
import { memoryCanonical,type MemorySqlGuard } from './memory-sql.ts';
import { readNativeControlBody } from './native-control-body.ts';
import { requireUser } from './pilot-policy.ts';
import { derivationAssertion,derivationResults,derivationVerified } from './memory-derivation-store.ts';
import { prepareNativeMemoryResourceAuthority,nativeMemoryResourceScopeInputs,nativeMemoryResourceScopeGuards } from './memory-resource-authority.ts';
import { derivationExact } from './memory-derivation-policy.ts';
import { memoryResourceSchemaDigest } from './memory-resource-schema.ts';
import type { WorkerEnv } from './runtime.ts';

export const MEMORY_RESOURCE_POLICY='personal-resource-memory-v1';
const headers={'cache-control':'private, no-store',vary:'Cookie, oai-authenticated-user-id, oai-authenticated-user-email'};
const reply=(body:Record<string,unknown>,status=200)=>Response.json({version:'memory-resource-settings-v1',...body},{status,headers});
export const resourceEnrollmentColumns=['enrollment_id','actor_user_id','owner_user_id','organization_id','project_access_id','project_id','resource_kind','resource_id','resource_key','permission_epoch','policy_version','revision','learn_enabled','recall_enabled','background_enabled','retention_days','time_zone','enrolled_at','expires_at','source_after_sequence','cursor_sequence','next_due_at','last_local_day'] as const;
export type MemoryResourceEnrollment={enrollment_id:string;actor_user_id:string;owner_user_id:string;organization_id:string|null;project_access_id:string|null;project_id:string;resource_kind:'library'|'canvas';resource_id:string;resource_key:string;permission_epoch:string;policy_version:string;revision:number;learn_enabled:number;recall_enabled:number;background_enabled:number;retention_days:number;time_zone:string;enrolled_at:string;expires_at:string;source_after_sequence:number;cursor_sequence:number;next_due_at:string;last_local_day:string|null};
export const memoryResourceSchemaFamily="name LIKE 'memory_resource_%' OR name LIKE 'idx_memory_resource_%' OR tbl_name LIKE 'memory_resource_%' OR instr(lower(COALESCE(sql,'')),'memory_resource_enrollments')>0 OR instr(lower(COALESCE(sql,'')),'memory_resource_history')>0 OR instr(lower(COALESCE(sql,'')),'memory_resource_retired_sources')>0";
const family=memoryResourceSchemaFamily;
const schemaSql=`SELECT name,sql,tbl_name AS 'table',type FROM sqlite_schema WHERE ${family} ORDER BY name,type`;
/** Exact source-qualified optional schema. A request never installs it. */
export async function memoryResourceSchema(env:WorkerEnv){
 const db=env.DB,result=structuredClone(await db.prepare(schemaSql+' LIMIT 17').all<Record<string,unknown>>());
 if(env.DB!==db||!derivationResults([result],1)||result.results.length!==16||result.results.some(row=>!derivationExact(row,['name','sql','table','type'])))throw Error('memory_resource_schema');
 if(await memoryDigest(memoryCanonical(result.results))!==memoryResourceSchemaDigest)throw Error('memory_resource_schema');
 return {condition:`(SELECT json_group_array(json_object('name',name,'sql',sql,'table',tbl_name,'type',type)) FROM (SELECT * FROM sqlite_schema WHERE ${family} ORDER BY name,type))=?
   AND EXISTS(SELECT 1 FROM pragma_foreign_keys WHERE foreign_keys=1) AND EXISTS(SELECT 1 FROM pragma_ignore_check_constraints WHERE ignore_check_constraints=0)
   AND NOT EXISTS(SELECT 1 FROM sqlite_temp_schema)`,bindings:[JSON.stringify(result.results)]} satisfies MemorySqlGuard;
}
const enrollmentView=(e:MemoryResourceEnrollment)=>({id:e.enrollment_id,revision:e.revision,kind:e.resource_kind,projectId:e.project_id,resourceId:e.resource_id,
 learn:e.learn_enabled===1,recall:e.recall_enabled===1,background:e.background_enabled===1,retentionDays:e.retention_days,timeZone:e.time_zone,
 enrolledAt:e.enrolled_at,expiresAt:e.expires_at,throughSequence:e.cursor_sequence,nextDueAt:e.next_due_at,policyVersion:e.policy_version});
export function memoryResourceEnrollmentGuard(e:MemoryResourceEnrollment):MemorySqlGuard{return {condition:`EXISTS(SELECT 1 FROM memory_resource_enrollments WHERE enrollment_id=? AND json_array(${resourceEnrollmentColumns.join(',')})=?)`,bindings:[e.enrollment_id,JSON.stringify(resourceEnrollmentColumns.map(key=>e[key]))]};}
const canonicalTime=(value:unknown):value is string=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;

/** Native independent consent. Resource access and policy are rechecked in the
 * same transaction as CAS. A linked/selected document's grant is never copied.
 * Withdrawal needs only ownership of this actor-private control record. */
export async function handleMemoryResourceSettings(request:Request,env:WorkerEnv){
 const db=env.DB,url=new URL(request.url);
 if(!['GET','PUT','DELETE'].includes(request.method))return reply({error:'method_not_allowed'},405);
 if(request.headers.get('sec-fetch-site')==='cross-site'||request.method!=='GET'&&request.headers.get('origin')!==url.origin)return reply({error:'same_origin_required'},403);
 try{
  const auth=await requireUser(request,env,'viewer',{account:'principal'});if(auth.response||!auth.user||auth.user.fictional||auth.user.projectExecution
   ||request.headers.get('cookie')?.split(';').some(c=>c.trim().startsWith('forma_impersonation=')))return reply({error:'principal_account_required'},403);
  const actor=auth.user,schema=await memoryResourceSchema(env),guards:MemorySqlGuard[]=[schema];
  if(request.method==='DELETE'){
   const parsed=await readNativeControlBody(request);if(parsed.status!=='parsed')return reply({error:'resource_control_invalid'},parsed.status==='too-large'?413:400);
   const b=parsed.value;if(!derivationExact(b,['id','revision','confirmation'])||typeof b.id!=='string'||b.id.length!==36||!Number.isSafeInteger(b.revision)||Number(b.revision)<1||b.confirmation!=='FORGET_RESOURCE_MEMORY')return reply({error:'resource_revision_required'},400);
   const before=await db.prepare('SELECT * FROM memory_resource_enrollments WHERE enrollment_id=? AND actor_user_id=?').bind(b.id,actor.userId).all<MemoryResourceEnrollment>();
   if(!derivationResults([before],1)||before.results.length!==1||!derivationExact(before.results[0],resourceEnrollmentColumns)||before.results[0]!.revision!==b.revision)return reply({error:'resource_revision_changed'},409);
   const row=before.results[0]!,snapshot=actor.authorizationSnapshot;if(!snapshot)throw Error('resource_principal');
   guards.push(memoryResourceEnrollmentGuard(row),{condition:"EXISTS(SELECT 1 FROM users WHERE user_id=? AND role=? AND COALESCE(updated_at,'')=?)",bindings:[actor.userId,actor.role,snapshot.updatedAt]});
   const proof=guards.map(g=>derivationAssertion(env,g)),result=await db.batch([...proof,db.prepare('DELETE FROM memory_resource_enrollments WHERE enrollment_id=? AND actor_user_id=? AND revision=?').bind(row.enrollment_id,actor.userId,row.revision),derivationAssertion(env,{condition:'changes()=1',bindings:[]})]);
   if(env.DB!==db||!derivationResults(result,proof.length+2)||!result.slice(0,proof.length).every(derivationVerified)||!derivationVerified(result.at(-1)!))throw Error('resource_forget');
   return reply({forgotten:true,authoredResourcesPreserved:true});
  }
  let body:Record<string,unknown>|null=null;
  if(request.method==='PUT'){const parsed=await readNativeControlBody(request);if(parsed.status!=='parsed')return reply({error:'resource_control_invalid'},parsed.status==='too-large'?413:400);body=parsed.value;}
  if([...url.searchParams.keys()].some(key=>!['kind','projectId','resourceId'].includes(key)||url.searchParams.getAll(key).length!==1))return reply({error:'resource_scope_required'},400);
  const selector=memoryResourceSelector(Object.fromEntries(url.searchParams));if(!selector)return reply({error:'resource_scope_required'},400);
  const handle=await prepareNativeMemoryResourceAuthority(request,env,selector),scope=nativeMemoryResourceScopeInputs(env,handle),identity=scope.identity;
  if(identity.actorUserId!==actor.userId||scope.permissionEpoch!==actor.access.permissionEpoch||env.DB!==db)throw Error('resource_principal');guards.push(...nativeMemoryResourceScopeGuards(env,handle));
  const found=await db.prepare('SELECT * FROM memory_resource_enrollments WHERE actor_user_id=? AND resource_key=? LIMIT 2').bind(actor.userId,identity.resourceKey).all<MemoryResourceEnrollment>();
  if(env.DB!==db||!derivationResults([found],1)||found.results.length>1||found.results.some(row=>!derivationExact(row,resourceEnrollmentColumns)))throw Error('resource_inventory');
  const old=found.results[0];guards.push(old?memoryResourceEnrollmentGuard(old):{condition:'NOT EXISTS(SELECT 1 FROM memory_resource_enrollments WHERE actor_user_id=? AND resource_key=?)',bindings:[actor.userId,identity.resourceKey]});
  if(request.method==='GET'){
   const proof=guards.map(g=>derivationAssertion(env,g)),checked=await db.batch(proof);if(env.DB!==db||!derivationResults(checked,proof.length)||!checked.every(derivationVerified))throw Error('resource_changed');
   return reply({scope:nativeMemoryResourceScopeInputs(env,handle).identity,validUntil:scope.validUntil,policyVersion:MEMORY_RESOURCE_POLICY,enrollment:old?enrollmentView(old):null});
  }
  if(!body||!derivationExact(body,['revision','learn','recall','background','retentionDays','timeZone','expiresAt','expectedCustody','policyVersion','confirmation'])
   ||body.revision!==(old?.revision??0)||!['learn','recall','background'].every(k=>typeof body[k]==='boolean')||body.background&&!body.learn
   ||!Number.isSafeInteger(body.retentionDays)||Number(body.retentionDays)<1||Number(body.retentionDays)>30||typeof body.timeZone!=='string'
   ||!canonicalTime(body.expiresAt)||Date.parse(body.expiresAt)<=Date.now()||Date.parse(body.expiresAt)>Date.now()+Number(body.retentionDays)*86400000
   ||body.policyVersion!==MEMORY_RESOURCE_POLICY||body.confirmation!=='ENABLE_RESOURCE_MEMORY')return reply({error:'resource_consent_required'},400);
  try{new Intl.DateTimeFormat('en-US',{timeZone:body.timeZone});}catch{return reply({error:'resource_timezone_required'},400);}
  const custody=parseMemoryCustody(body.expectedCustody);if(!custody||!memoryCustodyMatches(custody,identity.organizationId?{organizationId:identity.organizationId,projectAccessId:identity.projectAccessId!,ownerUserId:identity.ownerUserId}:null))return reply({error:'resource_custody_changed'},409);
  const now=new Date().toISOString(),row:MemoryResourceEnrollment={enrollment_id:old?.enrollment_id??crypto.randomUUID(),actor_user_id:actor.userId,owner_user_id:identity.ownerUserId,organization_id:identity.organizationId,project_access_id:identity.projectAccessId,
   project_id:selector.projectId,resource_kind:selector.kind,resource_id:selector.resourceId,resource_key:identity.resourceKey,permission_epoch:actor.access.permissionEpoch,policy_version:MEMORY_RESOURCE_POLICY,revision:(old?.revision??0)+1,
   learn_enabled:Number(body.learn),recall_enabled:Number(body.recall),background_enabled:Number(body.background),retention_days:Number(body.retentionDays),time_zone:body.timeZone,enrolled_at:now,expires_at:body.expiresAt,
   source_after_sequence:scope.sourceHead,cursor_sequence:scope.sourceHead,next_due_at:nextResourceMemoryNight(now,body.timeZone),last_local_day:null};
  const proof=guards.map(g=>derivationAssertion(env,g)),write=db.prepare(`INSERT INTO memory_resource_enrollments(${resourceEnrollmentColumns.join(',')}) VALUES(${resourceEnrollmentColumns.map(()=>'?').join(',')})
    ON CONFLICT(enrollment_id) DO UPDATE SET ${resourceEnrollmentColumns.slice(1).map(k=>k+'=excluded.'+k).join(',')}`).bind(...resourceEnrollmentColumns.map(k=>row[k]));
  nativeMemoryResourceScopeInputs(env,handle);
  const checked=await db.batch([...proof,write,derivationAssertion(env,{condition:'changes()=1',bindings:[]})]);
  if(env.DB!==db||!derivationResults(checked,proof.length+2)||!checked.slice(0,proof.length).every(derivationVerified)||!derivationVerified(checked.at(-1)!))throw Error('resource_commit');
  nativeMemoryResourceScopeInputs(env,handle);return reply({saved:true,refreshRequired:true});
 }catch{return reply({error:request.method==='GET'?'resource_settings_unavailable':'resource_commit_unconfirmed',noAutomaticRetry:true},503);}
}

/** Actor-private personal resource consent retires in the existing personal
 * erasure transaction. Authored files and organization-owned data are untouched.
 * A missing optional migration gets a witnessed absence, never an implicit DDL. */
export async function prepareResourceMemoryPersonalErasure(env:WorkerEnv,actorUserId:string){
 const db=env.DB,inventory=structuredClone(await db.prepare(schemaSql+' LIMIT 17').all<Record<string,unknown>>());
 if(env.DB!==db||!derivationResults([inventory],1))throw Error('resource_erasure_schema');
 if(!inventory.results.length){
  const statements=[derivationAssertion(env,{condition:`NOT EXISTS(SELECT 1 FROM sqlite_schema WHERE ${family})`,bindings:[]})];
  return {installed:false,statements,acknowledge:(rows:unknown)=>env.DB===db&&derivationResults(rows,1)&&rows.every(derivationVerified)?{count:0}:null};
 }
 const schema=await memoryResourceSchema(env),where='actor_user_id=? AND owner_user_id=? AND organization_id IS NULL AND project_access_id IS NULL',values=[actorUserId,actorUserId];
 const measured=structuredClone(await db.prepare('SELECT COUNT(*) AS count FROM memory_resource_enrollments WHERE '+where).bind(...values).all<Record<string,unknown>>());
 if(env.DB!==db||!derivationResults([measured],1)||measured.results.length!==1||!derivationExact(measured.results[0],['count'])||!Number.isSafeInteger(measured.results[0]!.count)||Number(measured.results[0]!.count)<0)throw Error('resource_erasure_inventory');
 const count=Number(measured.results[0]!.count),statements=[derivationAssertion(env,schema),derivationAssertion(env,{condition:'(SELECT COUNT(*) FROM memory_resource_enrollments WHERE '+where+')=?',bindings:[...values,count]}),
  db.prepare('DELETE FROM memory_resource_enrollments WHERE '+where).bind(...values),derivationAssertion(env,{condition:'changes()=? AND NOT EXISTS(SELECT 1 FROM memory_resource_enrollments WHERE '+where+')',bindings:[count,...values]})];
 return {installed:true,statements,acknowledge:(rows:unknown)=>env.DB===db&&derivationResults(rows,4)&&[0,1,3].every(i=>derivationVerified(rows[i]!))?{count}:null};
}

/** Actor-owned control metadata remains manageable after source access or
 * rollout is withdrawn. This inventory never reads authored resource bodies. */
export async function handleMemoryResourceEnrollments(request:Request,env:WorkerEnv){
 const db=env.DB,url=new URL(request.url),after=url.searchParams.get('after')??'';
 if(request.method!=='GET')return reply({error:'method_not_allowed'},405);
 if(request.headers.get('sec-fetch-site')==='cross-site'||[...url.searchParams.keys()].some(k=>k!=='after'||url.searchParams.getAll(k).length!==1)||after&&!/^[a-f0-9-]{36}$/.test(after))return reply({error:'resource_inventory_request'},400);
 try{
  const auth=await requireUser(request,env,'viewer',{account:'principal'}),actor=auth.user;
  if(auth.response||!actor||actor.fictional||actor.projectExecution||!actor.authorizationSnapshot||request.headers.get('cookie')?.split(';').some(c=>c.trim().startsWith('forma_impersonation=')))return reply({error:'principal_account_required'},403);
  const schema=await memoryResourceSchema(env),validUntil=new Date(Date.now()+30000).toISOString(),principal:MemorySqlGuard={condition:"EXISTS(SELECT 1 FROM users WHERE user_id=? AND role=? AND COALESCE(updated_at,'')=?) AND ?>strftime('%Y-%m-%dT%H:%M:%fZ','now')",bindings:[actor.userId,actor.role,actor.authorizationSnapshot.updatedAt,validUntil]};
  const checked=await db.batch([... [schema,principal].map(g=>derivationAssertion(env,g)),db.prepare('SELECT * FROM memory_resource_enrollments WHERE actor_user_id=? AND enrollment_id>? ORDER BY enrollment_id LIMIT 33').bind(actor.userId,after)]);
  if(env.DB!==db||!derivationResults(checked,3)||!checked.slice(0,2).every(derivationVerified)||checked[2]!.results.length>33||checked[2]!.results.some(r=>!derivationExact(r,resourceEnrollmentColumns)))throw Error('resource_inventory');
  const rows=checked[2]!.results as MemoryResourceEnrollment[];return reply({controlMetadataOnly:true,validUntil,enrollments:rows.slice(0,32).map(e=>({...enrollmentView(e),ownerUserId:e.owner_user_id,organizationId:e.organization_id,projectAccessId:e.project_access_id})),nextAfter:rows.length>32?rows[31]!.enrollment_id:null});
 }catch{return reply({error:'resource_inventory_unavailable'},503);}
}

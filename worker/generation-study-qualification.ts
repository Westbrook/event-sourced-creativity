import release from './generation-study-qualification-release.json';
import type {WorkerEnv} from './runtime.ts';
import {requireExistingHoldAdministrator,pilotExecutionAllowance} from './pilot-policy.ts';
import {consentHash} from './consequential-consent.ts';
import {identityFromRequest} from './principal-request-core.ts';
import {SITES_STUDY_CONFIGURATION} from './generation-study-configuration.ts';
// @ts-expect-error Existing exact optional schema contract.
import {schemaRows as studySchema} from '../evals/generation-reliability/native-host/supplied-schema-contract.mjs';
import {AUTHORING_STUDY_SCHEMA} from './authoring-study-schema.ts';
// @ts-expect-error Existing read-only hold guard construction, never its write consumers.
import {externalGuard} from '../evals/generation-reliability/preparation/external-guard.mjs';

export const QUALIFICATION_PATH='/api/internal/generation-study/qualification';
export const QUALIFICATION_TARGET='appgprj_6a7a020e334881919ed8aea0363cb98f';
export const QUALIFICATION_ORIGIN='https://forma-creative-studio.reve-ai-0869.chatgpt.site';
export const QUALIFICATION_EXPIRY='2026-10-01T00:00:00Z';
export const QUALIFICATION_OWNER_EMAIL='westbrook.johnson@reve.art';
export const QUALIFICATION_LIMITS={statements:32,rowsPerQuery:1024,queryBytes:100000,resultBytes:1048576,outputBytes:524288,reads:1000000,deadlineMs:20000};
export const QUALIFICATION_QUERIES={
 catalog:"SELECT type,name,tbl_name,sql FROM main.sqlite_schema WHERE sql IS NOT NULL ORDER BY name COLLATE BINARY LIMIT 1025",
 settings:'SELECT foreign_keys,ignore_check_constraints,legacy_alter_table FROM pragma_foreign_keys,pragma_ignore_check_constraints,pragma_legacy_alter_table',
 migrationColumns:"SELECT name,type,pk FROM pragma_table_xinfo('__appgarden_migrations') ORDER BY cid LIMIT 17",
 migrations:'SELECT name FROM __appgarden_migrations ORDER BY id LIMIT 257',
 token:"SELECT status FROM budget_reservations WHERE owner_id=? AND status IN('authorizing','active') ORDER BY reservation_id LIMIT 101",
 cost:"SELECT status FROM cost_budget_reservations WHERE owner_id=? AND status NOT IN('settled','released') ORDER BY reservation_id LIMIT 101",
 study:"SELECT status,artifact_ref IS NOT NULL AS retained_artifact,provider_request_id IS NOT NULL AS provider_receipt FROM generation_study_operations WHERE owner_id=? ORDER BY operation_id LIMIT 101",
 lifecycle:'SELECT 1 AS held FROM generation_study_lifecycle_holds WHERE owner_id=? LIMIT 1',
 preparationLifecycle:'SELECT 1 AS held FROM generation_preparation_lifecycle_holds WHERE owner_id=? LIMIT 1',
 counters:"SELECT scope,used_tokens,reserved_tokens,hard_limit_tokens FROM budget_counters WHERE period=strftime('%Y-%m','now') AND (scope='workspace' OR (scope='user' AND scope_id=?)) ORDER BY scope,scope_id LIMIT 101",
 costCounters:"SELECT scope,used_microusd,reserved_microusd,hard_limit_microusd FROM cost_budget_counters WHERE period=strftime('%Y-%m','now') AND (scope='workspace' OR (scope='user' AND scope_id=?)) ORDER BY scope,scope_id LIMIT 101",
} as const;
const byteLength=(v:unknown)=>new TextEncoder().encode(JSON.stringify(v)).byteLength;
function fail():never{throw Error('qualification_unavailable');}
const headers={'cache-control':'private, no-store',vary:'Cookie, oai-authenticated-user-id, oai-authenticated-user-email'};
export const qualificationResponse=(v:unknown,status=200)=>Response.json(v,{status,headers});
/** Capability-limited adapter. Only compiled SELECT statements reach D1; no exec,
 * batch or run capability is provided to inherited authentication code. */
export function qualificationReadDb(original:D1Database){
 const metrics={statements:0,reads:0,writes:0,resultBytes:0,databaseBytes:0};const deadline=Date.now()+QUALIFICATION_LIMITS.deadlineMs;
 const check=()=>{if(Date.now()>=deadline)fail();};
 const prepare=(sql:string,values:unknown[]=[]):D1PreparedStatement=>{
  if(!/^\s*SELECT\b/i.test(sql)||sql.includes(';')||new TextEncoder().encode(sql).length>QUALIFICATION_LIMITS.queryBytes||values.length>100)fail();
  const all=async()=>{
   check();if(++metrics.statements>QUALIFICATION_LIMITS.statements)fail();
   const result=await original.prepare(sql).bind(...values).all();check();
   if(!result.success||!Array.isArray(result.results)||result.results.length>QUALIFICATION_LIMITS.rowsPerQuery)fail();
   const m=result.meta;if(!m||typeof m.rows_read!=='number'||!Number.isSafeInteger(m.rows_read)||m.rows_read<0||typeof m.rows_written!=='number'||m.rows_written!==0||typeof m.size_after!=='number'||!Number.isSafeInteger(m.size_after))fail();
   metrics.reads+=m.rows_read;metrics.writes+=m.rows_written;metrics.databaseBytes=Math.max(metrics.databaseBytes,m.size_after);metrics.resultBytes+=byteLength(result.results);
   if(metrics.reads>QUALIFICATION_LIMITS.reads||metrics.resultBytes>QUALIFICATION_LIMITS.resultBytes)fail();
   return result;
  };
  return {bind:(...v:unknown[])=>prepare(sql,v),all,first:async(column?:string)=>{const r=(await all()).results[0] as Record<string,unknown>|undefined;return column?r?.[column]??null:r??null;},run:async()=>fail(),raw:async()=>fail()} as unknown as D1PreparedStatement;
 };
 return {db:{prepare,exec:async()=>fail(),batch:async()=>fail(),dump:async()=>fail()} as unknown as D1Database,metrics,check};
}
/** Inherited principal/consent/policy and personal-only guards. No principal bootstrap.
 * Only DB and non-secret pilot admission configuration are passed to the guard. */
export async function qualificationPrincipal(request:Request,env:WorkerEnv,db:D1Database){
 const u=new URL(request.url),id=identityFromRequest(request);
 if(u.origin!==QUALIFICATION_ORIGIN||u.protocol!=='https:'||u.search||u.hash||request.headers.get('sec-fetch-site')==='cross-site'||(request.headers.has('origin')&&request.headers.get('origin')!==u.origin)||!id||id.source!=='openai-workspace'||id.email!==QUALIFICATION_OWNER_EMAIL)fail();
 const safe={DB:db,FORMA_PILOT_COHORT_ID:env.FORMA_PILOT_COHORT_ID,FORMA_ADMIN_EMAILS:env.FORMA_ADMIN_EMAILS} as WorkerEnv;
 const a=await requireExistingHoldAdministrator(request,safe);
 if(!a.user||a.response||a.user.fictional||a.user.projectExecution||a.user.billingUserId&&a.user.billingUserId!==a.user.userId)fail();
 const allowance=await pilotExecutionAllowance(safe,a.user.userId);if(!allowance.allowed||allowance.pilot!==null)fail();
 return a.user;
}
const safeName=async(value:unknown)=>typeof value==='string'&&/^[A-Za-z_][A-Za-z0-9_]{0,159}$/.test(value)?value:'sha256:'+await consentHash(value);
export async function handleStudyQualification(request:Request,env:WorkerEnv):Promise<Response>{
 if(request.method!=='GET'||request.body!==null)return qualificationResponse({status:'denied',reason:'fixed_read_required'},405);
 if(Date.now()>=Date.parse(QUALIFICATION_EXPIRY))return qualificationResponse({status:'expired',purchasesEnabled:false},410);
 try{
  const original=env.DB,read=qualificationReadDb(original),db=read.db,actor=await qualificationPrincipal(request,env,db);
  const rows=(await db.prepare(QUALIFICATION_QUERIES.catalog).all()).results as {type:string;name:string;tbl_name:string;sql:string}[];
  if(rows.length>1024||rows.some(r=>!['table','index','view','trigger'].includes(r.type)||typeof r.sql!=='string'||typeof r.name!=='string'))fail();
  const names=new Set(rows.map(r=>r.name));
  const catalog=await Promise.all(rows.map(async r=>({type:r.type,name:await safeName(r.name),table:await safeName(r.tbl_name),sqlSha256:await consentHash(r.sql)})));
  const exact=(prefix:string,expected:unknown)=>JSON.stringify(rows.filter(r=>r.name.startsWith(prefix)))===JSON.stringify(expected);
  const studyExact=exact('generation_study_',studySchema),approvalExact=exact('authoring_study_',AUTHORING_STUDY_SCHEMA);
  const settings=await db.prepare(QUALIFICATION_QUERIES.settings).first();
  let migrations:unknown={status:'unavailable',reason:'runner_not_identified'};
  if(names.has('__appgarden_migrations')){
   const cols=(await db.prepare(QUALIFICATION_QUERIES.migrationColumns).all()).results as {name:string;type:string;pk:number}[];
   if(cols.length<=16&&cols.some(c=>c.name==='name'&&c.type.toUpperCase()==='TEXT')&&cols.some(c=>c.name==='id'&&c.pk===1)){
    const applied=(await db.prepare(QUALIFICATION_QUERIES.migrations).all()).results as {name:string}[];if(applied.length>256)fail();
    migrations={status:'observed-names-only',names:await Promise.all(applied.map(x=>safeName(x.name))),count:applied.length,runnerExecutionCertified:false};
   }
  }
  const groups:Record<string,unknown>={};
  const inventory=async(key:keyof typeof QUALIFICATION_QUERIES,required:string[])=>{
   if(required.some(n=>!names.has(n))){groups[key]={status:'unavailable',reason:'schema_missing'};return;}
   const result=(await db.prepare(QUALIFICATION_QUERIES[key]).bind(actor.userId).all()).results;
   if(result.length>100)fail();
   // No reservation IDs, raw reasons, policy JSON, names, source or secret values.
   groups[key]={status:'observed',count:result.length,fingerprint:await consentHash(result),...(key==='token'||key==='cost'?{outstanding:result.length>0}:{})};
  };
  await inventory('token',['budget_reservations']);await inventory('cost',['cost_budget_reservations']);
  await inventory('counters',['budget_counters']);await inventory('costCounters',['cost_budget_counters']);
  if(studyExact){await inventory('study',['generation_study_operations']);await inventory('lifecycle',['generation_study_lifecycle_holds']);}
  else groups.study={status:'unavailable',reason:'study_schema_not_exact'};
  if(names.has('generation_preparation_lifecycle_holds'))await inventory('preparationLifecycle',['generation_preparation_lifecycle_holds']);
  else groups.preparationLifecycle={status:'not-installed',notAClearance:true};
  if(studyExact&&['cost_budget_reservations','budget_reservations','output_provider_calls','output_execution_grants','output_operation_slots','document_jobs','consequential_execution_steps','consequential_executions'].every(n=>names.has(n))){
   const g=await externalGuard(db,actor.userId);const r=await db.prepare('SELECT CASE WHEN ('+g.sql+') THEN 1 ELSE 0 END AS clear').bind(...g.bindings).first<{clear:number}>();
   groups.originalExternalHolds={status:'observed',clear:r?.clear===1,meaning:'existing P2 external guard at observation time only'};
  }else groups.originalExternalHolds={status:'unavailable',reason:'dependencies_not_installed'};
  const after=await qualificationPrincipal(request,env,db);
  const principal=async(a:typeof actor)=>consentHash({id:a.userId,consent:a.consentVersion,snapshot:a.authorizationSnapshot,access:a.access});
  const fingerprint=await principal(actor);if(env.DB!==original||fingerprint!==await principal(after))fail();read.check();
  const result={contract:'forma-p5-qualification-v1',release:release.id,target:QUALIFICATION_TARGET,expiry:QUALIFICATION_EXPIRY,capturedAt:new Date().toISOString(),status:'observed-not-purchase-qualified',principal:{identitySha256:await consentHash(actor.userId),fingerprint,role:'admin',currentConsent:true,personalScope:true,noPilot:true,notBootstrap:true},schema:{catalog,completeWithinBound:true,studyExact,approvalExact,settings,migrations},holds:groups,purchases:{compiledEntries:SITES_STUDY_CONFIGURATION.entries.length,approvalFlagOn:env.FORMA_GENERATION_STUDY_APPROVAL_ENABLED==='1',executionFlagOn:env.FORMA_GENERATION_STUDY_ENABLED==='1',qualified:false},media:{status:'not-probed'},finance:{status:'not-authenticated-by-this-read',secretValuesRead:false},metrics:read.metrics,limits:QUALIFICATION_LIMITS};
  if(byteLength(result)>QUALIFICATION_LIMITS.outputBytes)fail();return qualificationResponse(result);
 }catch{return qualificationResponse({status:'denied',reason:'qualification_unavailable',purchasesEnabled:false},409);}
}

import {schemaRows as pairSchemaRows} from './pair-schema-contract.mjs';
import { requireExistingHoldAdministrator, privateContentScopeGuard, configuredPilotAdmissionGuard, pilotExecutionAllowance } from '../../../worker/pilot-policy.ts';
import { nativeMemoryAnswerExclusion } from '../../../worker/memory-native-boundary.ts';
import { PRINCIPAL_WITH_ACCESS_SQL } from '../../../worker/access-policy.ts';
import { digest } from './transport.mjs';
import { schemaRows as suppliedSchemaRows } from './supplied-schema-contract.mjs';
import { schemaRows } from './schema-contract.mjs';
const deny=code=>{throw Error(code);};
export const joinGuards=(...guards)=>({sql:guards.map(g=>`(${g.sql})`).join(' AND '),bindings:guards.flatMap(g=>g.bindings??[])});
export const assertion=(db,guard)=>db.prepare(`INSERT INTO generation_study_assertions(passed) SELECT CASE WHEN (${guard.sql}) THEN 1 ELSE 0 END`).bind(...guard.bindings);
export async function checkedBatch(env,guards,statements){
  const db=env.DB;
  const result=await db.batch([...guards.map(g=>assertion(db,g)),...statements,db.prepare('DELETE FROM generation_study_assertions')]);
  if(env.DB!==db||!Array.isArray(result)||result.length!==guards.length+statements.length+1||result.some(r=>r?.success!==true))deny('study_transaction_unacknowledged');
  return result.slice(guards.length,-1);
}
/** Exact optional schema; presence alone, another DB and request-provided authority never qualify. */
export async function schemaGuard(env,{supplied=false,pair=false}={}){
  const expected=pair?pairSchemaRows:supplied?suppliedSchemaRows:schemaRows;
  const query="SELECT type,name,tbl_name,sql FROM main.sqlite_schema WHERE name GLOB 'generation_study_*' ORDER BY name";
  const rows=await env.DB.prepare(query).all();
  if(rows.success!==true||JSON.stringify(rows.results)!==JSON.stringify(expected))deny('study_schema_unavailable');
  return {sql:`(SELECT json_group_array(json_object('type',type,'name',name,'tbl_name',tbl_name,'sql',sql)) FROM (${query}))=?`,bindings:[JSON.stringify(expected)]};
}
export async function authenticateStudy(request,env,{recovery=false,supplied=false,pair=false}={}){
  if(!recovery&&env.FORMA_GENERATION_STUDY_ENABLED!=='1')deny('study_disabled');
  const url=new URL(request.url);
  if(url.protocol!=='https:'||url.origin!==env.FORMA_GENERATION_STUDY_ORIGIN||url.search||url.hash||request.method!=='POST'||request.headers.get('origin')!==url.origin||request.headers.get('sec-fetch-site')==='cross-site')deny('study_host_boundary');
  const db=env.DB,{user}=await requireExistingHoldAdministrator(request,env);
  if(!user||user.fictional||user.projectExecution||user.billingUserId&&user.billingUserId!==user.userId)deny('study_owner_denied');
  const allowance=await pilotExecutionAllowance(env,user.userId);
  if(!allowance.allowed||allowance.pilot!==null)deny('study_scope_not_qualified');
  const row=await db.prepare(PRINCIPAL_WITH_ACCESS_SQL).bind(user.userId).first();
  if(!row||row.role!=='admin'||row.consent_version!==user.consentVersion||String(row.updated_at??'')!==user.authorizationSnapshot.updatedAt||String(row.permission_epoch??'')!==user.authorizationSnapshot.rawEpoch)deny('study_principal_changed');
  const fields=['user_id','email','role','consent_version','updated_at','permission_epoch','grants_json','organizations_json','projects_json','identity_policies_json','approved_canvas_requirements'];
  const current={sql:`EXISTS(SELECT 1 FROM (${PRINCIPAL_WITH_ACCESS_SQL}) WHERE ${fields.map(f=>`${f} IS ?`).join(' AND ')})`,bindings:[user.userId,...fields.map(f=>row[f]??null)]};
  const noPilot={sql:"NOT EXISTS(SELECT 1 FROM pilot_participants p JOIN pilot_cohorts c ON c.cohort_id=p.cohort_id WHERE p.user_id=? AND p.status='active' AND p.revoked_at IS NULL AND c.status IN('active','paused','closed'))",bindings:[user.userId]};
  const schema=await schemaGuard(env,{supplied,pair});
  if(env.DB!==db)deny('study_database_changed');
  return {user,db,guard:joinGuards(current,configuredPilotAdmissionGuard(env,user),noPilot,schema)};
}
/** Exact personal source/evidence only. Organization/project/Memory custody is never widened by this study. */
export async function retainedStudyInputs(request,env,grantId,expectedPlanId,{recovery=false}={}){
  const a=await authenticateStudy(request,env,{recovery}),{db,user}=a;
  const grant=await db.prepare("SELECT * FROM generation_study_grants WHERE grant_id=? AND owner_id=? AND plan_id=? AND status='authorized' AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(grantId,user.userId,expectedPlanId).first();
  if(!grant)deny('study_grant_unavailable');
  const g={sql:"EXISTS(SELECT 1 FROM generation_study_grants WHERE grant_id=? AND owner_id=? AND plan_id=? AND authority_version=? AND status='authorized' AND expires_at=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))",bindings:[grantId,user.userId,expectedPlanId,grant.authority_version,grant.expires_at]};
  const scope=privateContentScopeGuard(user.userId);
  const memory=await nativeMemoryAnswerExclusion(env,{answerAlias:'private_content'});
  const rows=(await checkedBatch(env,[a.guard,g],[db.prepare(`SELECT content_id,kind,content,expires_at FROM private_content WHERE owner_id=? AND content_id IN(?,?)
    AND kind IN('document-artifact-input','provider-response') AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    AND length(CAST(content AS BLOB))<=1048576 AND ${scope.sql} AND ${memory.sql}
    AND NOT EXISTS(SELECT 1 FROM project_resource_scopes r WHERE r.resource_kind='content' AND r.resource_id=private_content.content_id)`)
    .bind(user.userId,grant.source_ref,grant.direction_ref,...scope.bindings,...memory.bindings)]))[0].results;
  const source=rows.find(r=>r.content_id===grant.source_ref&&r.kind==='document-artifact-input'),direction=rows.find(r=>r.content_id===grant.direction_ref&&r.kind==='provider-response');
  if(!source||!direction||digest(source.content)!==grant.source_hash||digest(direction.content)!==grant.direction_hash)deny('study_retained_input_unavailable');
  const expiresAt=[grant.expires_at,source.expires_at,direction.expires_at,new Date(Date.now()+30*86400000).toISOString()].sort()[0];
  const inputs=rows.map(r=>({sql:`EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind=? AND content=? AND expires_at=? AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${memory.sql})`,bindings:[r.content_id,user.userId,r.kind,r.content,r.expires_at,...memory.bindings]}));
  return {...a,grant,source,direction,expiresAt,guards:[a.guard,g,...inputs,{sql:`NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id IN(?,?))`,bindings:[source.content_id,direction.content_id]}]};
}

import { PRINCIPAL_WITH_ACCESS_SQL, principalAccessFromRow } from "./access-policy.ts";
import { configuredPilotAdmissionGuard, hasCapability, POLICY_VERSION, type PilotUser } from "./pilot-policy.ts";
import { executionAdmissionGuard, type ConsequentialBinding } from "./consequential-consent.ts";
import { paidReplyContentGuard, assistantTurnContentCustody, type SpecialistActor } from "./assistant-specialist-consent.ts";
import { assistantSurfaceForRoute } from "../src/model/assistant-route-policy.ts";
import type { WorkerEnv } from "./runtime.ts";
import type { MemorySqlGuard } from "./memory-sql.ts";
import { AssistantContextReadWitness, type AssistantContextReadDescriptor } from "./assistant-context-source.ts";
import { capabilityScopeFor, isFormaCapability } from "../src/platform/capabilities.ts";

export const LIVE_MEMORY_POLICY = "personal-memory-v2";
export const LIVE_MEMORY_REVIEW_TIMING = "daily-with-daytime-catch-up";
export const LIVE_MEMORY_REVIEW_CONTRACT = {
  timing:LIVE_MEMORY_REVIEW_TIMING,preferredLocalWindow:{startHour:1,endHour:5},
  freshDaytimeCatchUpAllowed:true,savedPagesMayContinueOutsideWindow:true,strictlyOvernight:false,deliverySlaVerified:false,
} as const;
export type LiveMemoryEnrollment = {
  enrollment_id:string; actor_user_id:string; owner_user_id:string; organization_id:string|null; project_access_id:string|null;
  project_id:string; document_id:string; permission_epoch:string; policy_version:string; revision:number;
  learn_enabled:number; recall_enabled:number; background_enabled:number; retention_days:number; time_zone:string;
  enrolled_at:string; expires_at:string; cursor_sequence:number; cutoff_sequence:number|null;
  last_local_day:string|null; last_admitted_at:string|null; next_due_at:string;
  lease_token:string|null; lease_expires_at:string|null; attempts:number; failure_code:string|null;
};
export type LiveMemoryAuthority = { principal:PilotUser; binding:ConsequentialBinding; guard:MemorySqlGuard; actor:SpecialistActor; scopeKey:string };

/** A database identity is not a browser sign-in. Restrictive identity policies fail closed. */
export async function liveMemoryPrincipal(env:WorkerEnv,id:string):Promise<PilotUser|null> {
  const row=await env.DB.prepare(PRINCIPAL_WITH_ACCESS_SQL).bind(id).first<Record<string,unknown>>();
  return decodeLiveMemoryPrincipal(id,row);
}

/** Decode a native metadata observation, not a sign-in or access grant. Every
 * resulting authority includes the exact principal predicates and must be
 * checked in the consuming native transaction before source hydration. */
export async function decodeLiveMemoryPrincipal(id:string,row:Record<string,unknown>|null):Promise<PilotUser|null> {
  if(!row || row.user_id!==id || !["admin","creator","viewer"].includes(String(row.role)) || row.consent_version!==POLICY_VERSION)return null;
  const access=await principalAccessFromRow(row,String(row.role));
  if(access.identityPolicyDeniedCustody)return null;
  return {userId:id,email:String(row.email),displayName:String(row.display_name),role:row.role as PilotUser["role"],
    consentVersion:String(row.consent_version),consentedAt:String(row.consented_at),streamId:`creative:${id}`,access,
    authorizationSnapshot:{updatedAt:String(row.updated_at??""),rawEpoch:String(row.permission_epoch??""),grants:String(row.grants_json??"[]"),
      organizations:String(row.organizations_json??"[]"),projects:String(row.projects_json??"[]"),identityPolicies:String(row.identity_policies_json??"[]"),canvasRequirements:Number(row.approved_canvas_requirements??0)}};
}

export async function liveMemoryAuthority(env:WorkerEnv,e:LiveMemoryEnrollment):Promise<LiveMemoryAuthority|null> {
  const principal=await liveMemoryPrincipal(env,e.actor_user_id);
  return liveMemoryAuthorityFromPrincipal(env,e,principal);
}

export function liveMemoryAuthorityFromPrincipal(env:WorkerEnv,e:LiveMemoryEnrollment,principal:PilotUser|null):LiveMemoryAuthority|null {
  if(!principal || principal.access.permissionEpoch!==e.permission_epoch || e.policy_version!==LIVE_MEMORY_POLICY)return null;
  const scope=e.organization_id&&e.project_access_id?{organizationId:e.organization_id,projectAccessId:e.project_access_id,
    projectId:e.project_id,ownerUserId:e.owner_user_id,actorUserId:e.actor_user_id}:null;
  if(Boolean(e.organization_id)!==Boolean(e.project_access_id) || !scope && e.owner_user_id!==e.actor_user_id
    || !(scope?hasCapability(principal,"project.read",scope):principal.access.capabilities.includes("project.read")))return null;
  const binding:ConsequentialBinding={version:LIVE_MEMORY_POLICY,intentHash:"",operation:"personal-memory",actorUserId:e.actor_user_id,
    permissionEpoch:e.permission_epoch,streamId:`creative:${e.owner_user_id}`,projectId:e.project_id,documentId:e.document_id,
    canvasId:null,blockId:"",sourceHash:"",period:"",scope,contextSessionId:null,pilotCohortId:null,steps:[],publicQuery:"",request:{}};
  const native=executionAdmissionGuard(principal,binding,null),pilot=configuredPilotAdmissionGuard(env,principal);
  // Containment and live document state are checked without hydrating a document or private prose.
  const document=`EXISTS(SELECT 1 FROM events created LEFT JOIN event_private_payloads created_scope
    ON created_scope.private_event_id=created.event_id AND created_scope.owner_id=substr(created.stream_id,10)
    WHERE created.stream_id=? AND created.type IN('DocumentCreated','DocumentForked')
    AND created.sequence=(SELECT MAX(origin.sequence) FROM events origin WHERE origin.stream_id=created.stream_id
      AND origin.type IN('DocumentCreated','DocumentForked') AND json_extract(origin.payload,'$.document_id')=json_extract(created.payload,'$.document_id'))
    AND json_extract(created.payload,'$.document_id')=? AND COALESCE(json_extract(created.payload,'$.project_id'),created_scope.project_id,
      (SELECT json_extract(previous.payload,'$.project_id') FROM events previous WHERE previous.stream_id=created.stream_id
        AND previous.sequence<=created.sequence AND previous.type IN('ProjectCreated','ProjectOpened') ORDER BY previous.sequence DESC LIMIT 1))=?)
    AND COALESCE((SELECT boundary.type FROM events boundary WHERE boundary.stream_id=?
      AND json_extract(boundary.payload,'$.document_id')=? AND boundary.type IN('DocumentCreated','DocumentForked','DocumentRemoved','DocumentRestored')
      ORDER BY boundary.sequence DESC LIMIT 1),'DocumentRestored')!='DocumentRemoved'`;
  const resource=scope?`EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='document'
    AND (resource.resource_id,resource.project_access_id,resource.organization_id,resource.project_id,resource.owner_user_id)=(?,?,?,?,?)
    AND (resource.visibility='collaborative_output' OR resource.visibility='actor_private' AND resource.actor_user_id=?))`:"1";
  const guard:MemorySqlGuard={condition:`(${native.sql}) AND (${pilot.sql}) AND (${document}) AND (${resource})`,bindings:[...native.bindings,...pilot.bindings,
    binding.streamId,e.document_id,e.project_id,binding.streamId,e.document_id,...(scope?[e.document_id,e.project_access_id,e.organization_id,e.project_id,e.owner_user_id,e.actor_user_id]:[])]};
  const actor:SpecialistActor={principal,project:scope?{...scope,contextId:"",permissions:[],principalUserId:e.actor_user_id,expiresAt:e.expires_at,role:"viewer"}:null,
    surface:assistantSurfaceForRoute(`/document/${encodeURIComponent(e.document_id)}`),projectId:e.project_id,canPropose:false};
  return {principal,binding,guard,actor,scopeKey:JSON.stringify([e.organization_id??"",e.project_access_id??"",e.project_id,e.document_id])};
}

/** Shared native proof: neither half of a paid conversation survives withdrawal of its receipt or consent. */
export function liveMemoryTurnGuard(a:LiveMemoryAuthority):MemorySqlGuard {
  // The exact native admission guard is checked before AND after this source query in the same batch.
  // Repeating it inside the content subquery exceeds D1's expression-depth limit of 100.
  const paid=paidReplyContentGuard(a.binding,a.scopeKey,"turn.turn_id"),authored=assistantTurnContentCustody(a.actor,"authored"),answer=assistantTurnContentCustody(a.actor,"answer");
  return {condition:`turn.status='completed' AND (${authored.sql}) AND (${answer.sql}) AND (${paid.sql})
    AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes deadline WHERE deadline.content_id IN(authored.content_id,answer.content_id)
      AND deadline.assigned_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    AND NOT EXISTS(SELECT 1 FROM assistant_specialist_tasks signed JOIN consequential_executions execution ON execution.execution_id=signed.task_id
      JOIN private_content_retention_scopes deadline ON deadline.content_id IN(execution.consent_ref,execution.result_ref)
      WHERE signed.actor_user_id=turn.actor_user_id AND signed.scope_key=turn.scope_key AND signed.turn_id=turn.turn_id
        AND deadline.assigned_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,bindings:[...authored.bindings,...answer.bindings,...paid.bindings]};
}

export function liveMemoryEnrollmentGuard(e:LiveMemoryEnrollment,purpose?:"learn"|"recall"):MemorySqlGuard {
  return {condition:`EXISTS(SELECT 1 FROM memory_live_enrollments enrollment WHERE enrollment.enrollment_id=? AND enrollment.revision=?
    AND enrollment.permission_epoch=? AND enrollment.policy_version=? AND enrollment.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    ${purpose?`AND enrollment.${purpose}_enabled=1`:""})`,bindings:[e.enrollment_id,e.revision,e.permission_epoch,LIVE_MEMORY_POLICY]};
}


// Maintenance evidence is deliberately separate from the existing nullable read
// API. Certified retirement uses the split proof below. An unavailable
// read, unknown schema/policy or expired enrollment is NOT a denial certificate.
const MAINTENANCE_ATTEMPT_MS=30_000;
const MAINTENANCE_ENROLLMENT_COLUMNS=[
  "enrollment_id","actor_user_id","owner_user_id","organization_id","project_access_id","project_id","document_id",
  "permission_epoch","policy_version","revision","learn_enabled","recall_enabled","background_enabled","retention_days",
  "time_zone","enrolled_at","expires_at","cursor_sequence","cutoff_sequence","last_local_day","last_admitted_at",
  "next_due_at","lease_token","lease_expires_at","attempts","failure_code",
] as const;
const MAINTENANCE_PRINCIPAL_COLUMNS=["user_id","email","display_name","role","consent_version","consented_at","created_at",
  "updated_at","permission_epoch","grants_json","organizations_json","projects_json","identity_policies_json","approved_canvas_requirements"] as const;
const MAINTENANCE_ENROLLMENT_SQL="SELECT * FROM memory_live_enrollments WHERE enrollment_id=?";
// The mandatory count row distinguishes a successfully witnessed absence from
// an empty/partial result envelope. Keep the ORIGINAL native projection: it does
// hydrate project names, which remain private to this short-lived attempt.
const MAINTENANCE_PRINCIPAL_SQL=`WITH memory_maintenance_principal AS (${PRINCIPAL_WITH_ACCESS_SQL})
  SELECT (SELECT COUNT(*) FROM memory_maintenance_principal) AS memory_principal_count,principal.*
  FROM (SELECT 1) marker LEFT JOIN memory_maintenance_principal principal ON 1=1`;

declare const maintenanceDenialBrand:unique symbol;
export type LiveMemoryDenialCertificate=Readonly<{[maintenanceDenialBrand]:true}>;
export type LiveMemoryMaintenanceResult={status:"current"}|{status:"unavailable"}|{status:"denied";certificate:LiveMemoryDenialCertificate};
type MaintenanceDenialState={enrollment:string;witness:AssistantContextReadWitness<null>;
  nativeWitness:AssistantContextReadWitness<null>;deadline:number;used:boolean};
// Weak object provenance only: no certificate, enrollment or native facts are
// cached here. A structural lookalike must not mint proof for a store caller.
const maintenanceAttempts=new WeakMap<object,WorkerEnv>();

const maintenanceText=(value:unknown):value is string=>typeof value==="string"&&value.length>0;
const maintenanceNullableText=(value:unknown)=>value===null||maintenanceText(value);
const maintenanceInteger=(value:unknown):value is number=>typeof value==="number"&&Number.isSafeInteger(value)&&value>=0;
const maintenanceInstant=(value:unknown):value is string=>typeof value==="string"&&Number.isFinite(Date.parse(value))
  &&new Date(value).toISOString()===value;
function maintenanceRow(value:unknown):value is Record<string,unknown> {
  return Boolean(value&&typeof value==="object"&&!Array.isArray(value)
    &&Object.values(value).every(item=>item===null||typeof item==="string"||typeof item==="number"&&Number.isSafeInteger(item))
    &&new TextEncoder().encode(JSON.stringify(value)).byteLength<=2*1024*1024);
}
function maintenanceKeys(row:Record<string,unknown>,keys:readonly string[]){
  return Object.keys(row).length===keys.length&&keys.every(key=>Object.prototype.hasOwnProperty.call(row,key));
}
function maintenanceEnrollment(value:unknown):value is LiveMemoryEnrollment {
  if(!maintenanceRow(value)||!maintenanceKeys(value,MAINTENANCE_ENROLLMENT_COLUMNS))return false;
  if(!["enrollment_id","actor_user_id","owner_user_id","project_id","document_id","permission_epoch","policy_version","time_zone"]
    .every(key=>maintenanceText(value[key])))return false;
  if(!/^[a-f0-9]{64}$/u.test(String(value.permission_epoch)))return false;
  if(!["organization_id","project_access_id","lease_token","failure_code"].every(key=>maintenanceNullableText(value[key])))return false;
  if(Boolean(value.organization_id)!==Boolean(value.project_access_id)||!value.organization_id&&value.owner_user_id!==value.actor_user_id)return false;
  if(!["revision","retention_days","cursor_sequence","attempts"].every(key=>maintenanceInteger(value[key]))
    ||Number(value.revision)<1||Number(value.retention_days)<1||Number(value.retention_days)>365)return false;
  if(!["learn_enabled","recall_enabled","background_enabled"].every(key=>value[key]===0||value[key]===1)
    ||value.cutoff_sequence!==null&&!maintenanceInteger(value.cutoff_sequence))return false;
  if(!["enrolled_at","expires_at","next_due_at"].every(key=>maintenanceInstant(value[key]))
    ||!["last_admitted_at","lease_expires_at"].every(key=>value[key]===null||maintenanceInstant(value[key])))return false;
  if((value.lease_token===null)!==(value.lease_expires_at===null)||Date.parse(String(value.expires_at))<=Date.parse(String(value.enrolled_at)))return false;
  if(value.last_local_day!==null&&(typeof value.last_local_day!=="string"||!/^\d{4}-\d{2}-\d{2}$/u.test(value.last_local_day)
    ||!maintenanceInstant(value.last_local_day+"T00:00:00.000Z")))return false;
  try{new Intl.DateTimeFormat("en-US",{timeZone:String(value.time_zone)});}catch{return false;}
  return value.policy_version===LIVE_MEMORY_POLICY;
}
function maintenanceEnrollmentKey(e:LiveMemoryEnrollment){return JSON.stringify(MAINTENANCE_ENROLLMENT_COLUMNS.map(key=>e[key]));}
function maintenanceRetirement(e:LiveMemoryEnrollment):Readonly<LiveMemoryEnrollment>{
  const settled=e.learn_enabled===0&&e.recall_enabled===0&&e.background_enabled===0
    &&e.lease_token===null&&e.lease_expires_at===null&&e.cutoff_sequence===null
    &&e.failure_code==="access-changed"&&e.next_due_at==="9999-12-31T00:00:00.000Z";
  const revision=settled?e.revision:e.revision+1;
  if(!Number.isSafeInteger(revision))throw new Error("memory_maintenance_unavailable");
  return Object.freeze({...e,revision,learn_enabled:0,recall_enabled:0,background_enabled:0,
    lease_token:null,lease_expires_at:null,cutoff_sequence:null,failure_code:"access-changed",
    next_due_at:"9999-12-31T00:00:00.000Z"});
}
function maintenanceList(value:unknown,valid:(row:Record<string,unknown>)=>boolean){
  if(typeof value!=="string")return false;
  const rows:unknown=JSON.parse(value);
  return Array.isArray(rows)&&rows.length<=8192&&rows.every(row=>maintenanceRow(row)&&valid(row));
}
function maintenancePrincipalRow(row:Record<string,unknown>,id:string){
  if(!MAINTENANCE_PRINCIPAL_COLUMNS.every(key=>Object.prototype.hasOwnProperty.call(row,key)))return false;
  if(row.memory_principal_count===0)return Object.entries(row).every(([key,value])=>key==="memory_principal_count"||value===null);
  if(row.memory_principal_count!==1||row.user_id!==id||!["admin","creator","viewer"].includes(String(row.role))
    ||!["email","permission_epoch"].every(key=>maintenanceText(row[key]))||typeof row.display_name!=="string"
    ||!maintenanceNullableText(row.consent_version)||!(row.consented_at===null||maintenanceInstant(row.consented_at))
    ||!["created_at","updated_at"].every(key=>maintenanceInstant(row[key]))
    ||!maintenanceInteger(row.approved_canvas_requirements)||row.approved_canvas_requirements>3)return false;
  return maintenanceList(row.grants_json,grant=>maintenanceKeys(grant,["capability","scope","organizationId","projectAccessId","expiresAt"])
      &&isFormaCapability(grant.capability)&&capabilityScopeFor(grant.capability)===grant.scope
      &&maintenanceNullableText(grant.organizationId)&&maintenanceNullableText(grant.projectAccessId)
      &&(grant.expiresAt===null||maintenanceInstant(grant.expiresAt))
      &&(grant.scope==="workspace"?Boolean(grant.organizationId)&&grant.projectAccessId===null
        :grant.scope==="project"?Boolean(grant.organizationId&&grant.projectAccessId):grant.organizationId===null&&grant.projectAccessId===null))
    &&maintenanceList(row.organizations_json,organization=>maintenanceKeys(organization,["organizationId","name","role"])
      &&maintenanceText(organization.organizationId)&&typeof organization.name==="string"
      &&["owner","administrator","member"].includes(String(organization.role)))
    &&maintenanceList(row.projects_json,project=>maintenanceKeys(project,["projectAccessId","projectId","projectName","organizationId","role"])
      &&["projectAccessId","projectId","organizationId"].every(key=>maintenanceText(project[key]))&&typeof project.projectName==="string"
      &&["owner","editor","viewer"].includes(String(project.role)))
    &&maintenanceList(row.identity_policies_json,policy=>maintenanceKeys(policy,["organizationId","authenticationSource","allowedDomainsJson",
      "requireMfa","version","bindingStatus","bindingSource","bindingSubject","ownsData"])
      &&maintenanceText(policy.organizationId)&&["any","openai-workspace","cloudflare-access","local-development"].includes(String(policy.authenticationSource))
      &&(policy.requireMfa===0||policy.requireMfa===1)&&maintenanceInteger(policy.version)&&policy.version>0&&(policy.ownsData===0||policy.ownsData===1)
      &&(policy.bindingStatus===null||["active","revoked"].includes(String(policy.bindingStatus)))
      &&(policy.bindingSource===null||["openai-workspace","cloudflare-access","local-development"].includes(String(policy.bindingSource)))
      &&maintenanceNullableText(policy.bindingSubject)
      &&(policy.bindingStatus===null?policy.bindingSource===null&&policy.bindingSubject===null:Boolean(policy.bindingSource&&policy.bindingSubject))
      &&typeof policy.allowedDomainsJson==="string"&&(()=>{const domains:unknown=JSON.parse(policy.allowedDomainsJson);
        return Array.isArray(domains)&&domains.every(domain=>maintenanceText(domain));})());
}
function maintenanceResultRows(result:unknown):Record<string,unknown>[] {
  if(!result||typeof result!=="object"||Array.isArray(result))throw new Error("memory_maintenance_unavailable");
  const envelope=result as Record<string,unknown>;
  if(envelope.success!==true||envelope.error!==undefined||!Array.isArray(envelope.results)
    ||envelope.results.length>8192||!envelope.results.every(maintenanceRow))throw new Error("memory_maintenance_unavailable");
  return envelope.results;
}
function maintenanceConfiguration(env:WorkerEnv){
  return JSON.stringify([env.FORMA_PILOT_COHORT_ID?.trim()??"",
    [...new Set((env.FORMA_ADMIN_EMAILS??"").split(",").map(email=>email.trim().toLowerCase()).filter(Boolean))].sort()]);
}

/** Create inside ONE server request/maintenance attempt; never cache on a Worker
 * env or reuse across jobs. One resolution and one assertion assembly only.
 * The fixed 30-second bound starts here, not after asynchronous reads; slow or
 * failed attempts must start over. Flags/allowlists/scheduling are not authority.
 * No authority/prose is returned in status/certificate. Assertion bindings are
 * server-only snapshots and must not be logged. The legacy API prepares original
 * READ assertions. Retirement callers use the split API in ONE atomic batch:
 * beforeMutation, complete cleanup and the fixed transition, afterRetirement.
 * The original enrollment witness is never replayed after own retirement.
 * Immutable Worker configuration during synchronous batch assembly/dispatch is
 * required; SQL can certify native facts and time, not mutable JavaScript env.
 */
export function createLiveMemoryMaintenanceAttempt(env:WorkerEnv){
  const db=env.DB,started=Date.now();let lastNow=started,resolved=false;
  let configuration:string|null=null;try{configuration=maintenanceConfiguration(env);}catch{/* unavailable */}
  const certificates=new WeakMap<LiveMemoryDenialCertificate,MaintenanceDenialState>();
  const fresh=(deadline=started+MAINTENANCE_ATTEMPT_MS)=>{
    const now=Date.now();
    if(!Number.isSafeInteger(started)||!Number.isSafeInteger(now)||now<lastNow||now>=deadline
      ||env.DB!==db||configuration===null||maintenanceConfiguration(env)!==configuration)return false;
    lastNow=now;return true;
  };
  const attempt=Object.freeze({
    async resolve(input:LiveMemoryEnrollment):Promise<LiveMemoryMaintenanceResult>{
      if(resolved)return{status:"unavailable"};resolved=true;
      try{
        if(!fresh()||!maintenanceEnrollment(input))return{status:"unavailable"};
        const e={...input},key=maintenanceEnrollmentKey(e),deadline=Math.min(started+MAINTENANCE_ATTEMPT_MS,Date.parse(e.expires_at));
        if(!fresh(deadline))return{status:"unavailable"};
        const witness=new AssistantContextReadWitness<null>(env),nativeWitness=new AssistantContextReadWitness<null>(env);
        const read=async(descriptor:AssistantContextReadDescriptor,native=false)=>{
          const statement=db.prepare(descriptor.sql).bind(...descriptor.bindings),result=await statement.all<Record<string,unknown>>();
          const rows=maintenanceResultRows(result);
          witness.observe([statement],[result],[descriptor]);
          if(native)nativeWitness.observe([statement],[result],[descriptor]);
          return rows;
        };
        const enrollments=await read({sql:MAINTENANCE_ENROLLMENT_SQL,bindings:[e.enrollment_id]});
        if(enrollments.length!==1||!maintenanceEnrollment(enrollments[0])||maintenanceEnrollmentKey(enrollments[0])!==key)return{status:"unavailable"};
        const principals=await read({sql:MAINTENANCE_PRINCIPAL_SQL,bindings:[e.actor_user_id]},true);
        if(principals.length!==1||!maintenancePrincipalRow(principals[0]!,e.actor_user_id))return{status:"unavailable"};
        const row=principals[0]!,principal=row.memory_principal_count===0?null:await decodeLiveMemoryPrincipal(e.actor_user_id,row);
        // Only validated, successfully captured inputs reach native policy. Null
        // here is either explicit count-zero absence or native consent/custody
        // denial, never a transport/parser fallback. Scope shape was validated.
        const authority=liveMemoryAuthorityFromPrincipal(env,e,principal);
        let current=false;
        if(authority){
          const rows=await read({sql:`SELECT CASE WHEN (${authority.guard.condition}) THEN 1 ELSE 0 END AS memory_authority_current`,bindings:authority.guard.bindings},true);
          if(rows.length!==1||!maintenanceKeys(rows[0]!,["memory_authority_current"])
            ||rows[0]!.memory_authority_current!==0&&rows[0]!.memory_authority_current!==1)return{status:"unavailable"};
          current=rows[0]!.memory_authority_current===1;
        }
        witness.before(new Date(deadline).toISOString());witness.seal(null);
        // Observe the SAME successful native reads, independently of enrollment.
        // Do not recapture denial later, strip opaque statements, or invent rows.
        nativeWitness.before(new Date(deadline).toISOString());nativeWitness.seal(null);
        // An old positive snapshot may make its native guard false. Re-read ALL
        // independent snapshots before issuing even a negative result, then
        // retain the same multiset proof for transaction-time restoration races.
        const statements=witness.statements();
        if(!statements.length||!fresh(deadline))return{status:"unavailable"};
        const replay=await db.batch<Record<string,unknown>>(statements);
        if(!Array.isArray(replay)||replay.length!==statements.length)return{status:"unavailable"};
        for(const result of replay)maintenanceResultRows(result);
        if(!witness.matches(replay)||!fresh(deadline)||!maintenanceEnrollment(input)||maintenanceEnrollmentKey(input)!==key)return{status:"unavailable"};
        // Force exact descriptor/scalar/size validation BEFORE granting evidence.
        witness.precommitStatements();
        if(current)return{status:"current"};
        const certificate=Object.freeze(Object.defineProperty(Object.create(null),"toJSON",{value:()=>{throw new Error("memory_certificate_not_serializable");}})) as LiveMemoryDenialCertificate;
        nativeWitness.precommitStatements();
        certificates.set(certificate,{enrollment:key,witness,nativeWitness,deadline,used:false});
        return{status:"denied",certificate};
      }catch{return{status:"unavailable"};}
    },
    denialPrecommitStatements(input:LiveMemoryEnrollment,certificate:LiveMemoryDenialCertificate):D1PreparedStatement[]{
      try{
        const state=certificates.get(certificate);
        if(!state||state.used||!fresh(state.deadline)||!maintenanceEnrollment(input)||maintenanceEnrollmentKey(input)!==state.enrollment)
          throw new Error("memory_maintenance_unavailable");
        const statements=state.witness.precommitStatements();state.used=true;return statements;
      }catch{throw new Error("memory_maintenance_unavailable");}
    },
    denialRetirementStatements(input:LiveMemoryEnrollment,certificate:LiveMemoryDenialCertificate){
      try{
        const state=certificates.get(certificate);
        if(!state||state.used||!fresh(state.deadline)||!maintenanceEnrollment(input)||maintenanceEnrollmentKey(input)!==state.enrollment)
          throw new Error("memory_maintenance_unavailable");
        const terminal=maintenanceRetirement(input),beforeMutation=state.witness.precommitStatements();
        // Fixed all-field terminal equality, not a caller-supplied exemption or a
        // fabricated observation. The original key is bound before all writes.
        const exact=MAINTENANCE_ENROLLMENT_COLUMNS.map(column=>`retired.${column} IS ?`).join(" AND ");
        const terminalStatement=db.prepare(`SELECT CASE WHEN
          (SELECT COUNT(*) FROM memory_live_enrollments WHERE enrollment_id=?)=1
          AND EXISTS(SELECT 1 FROM memory_live_enrollments retired WHERE ${exact})
          THEN 1 ELSE json_extract('memory_retirement_changed','$') END AS memory_retirement_asserted`)
          .bind(terminal.enrollment_id,...MAINTENANCE_ENROLLMENT_COLUMNS.map(column=>terminal[column]));
        const afterRetirement=[terminalStatement,...state.nativeWitness.precommitStatements()];
        if(!fresh(state.deadline)||!maintenanceEnrollment(input)||maintenanceEnrollmentKey(input)!==state.enrollment)
          throw new Error("memory_maintenance_unavailable");
        state.used=true;
        return Object.freeze({beforeMutation,afterRetirement,terminal});
      }catch{throw new Error("memory_maintenance_unavailable");}
    },
  });
  maintenanceAttempts.set(attempt,env);
  return attempt;
}

export type LiveMemoryMaintenanceAttempt=ReturnType<typeof createLiveMemoryMaintenanceAttempt>;

export function liveMemoryMaintenanceAttemptFor(env:WorkerEnv,attempt:LiveMemoryMaintenanceAttempt):boolean{
  return Boolean(attempt&&typeof attempt==="object"&&maintenanceAttempts.get(attempt)===env);
}

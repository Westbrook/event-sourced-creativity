import { memoryResourceIdentity,memoryResourceSelector,type MemoryResourceSelector,type MemoryResourceIdentity } from '../src/model/memory-resource-scope.ts';
import { requireUser,hasCapability,configuredPilotAdmissionGuard,requireConsent,type PilotUser,type ProjectExecutionScope } from './pilot-policy.ts';
import { readProjectRequestContext } from './project-request-context.ts';
import { executionAdmissionGuard,type ConsequentialBinding } from './consequential-consent.ts';
import { nativeMemoryGrantDeadline } from './memory-native-deadlines.ts';
import { AssistantContextReadWitness } from './assistant-context-source.ts';
import { derivationResults,derivationAssertion,derivationVerified } from './memory-derivation-store.ts';
import type { WorkerEnv } from './runtime.ts';
import type { MemorySqlGuard } from './memory-sql.ts';
import { liveMemoryPrincipal } from './memory-live-authority.ts';
import type { MemoryResourceEnrollment } from './memory-resource-settings.ts';
import { liveMemoryEnabled } from './memory-live-store.ts';

const version='memory-resource-scope-v1';
const headers={'cache-control':'private, no-store',vary:'Cookie, oai-authenticated-user-id, oai-authenticated-user-email'};
const reply=(body:Record<string,unknown>,status=200)=>Response.json({version,...body},{status,headers});
declare const resourceScopeBrand:unique symbol;
export type NativeMemoryResourceAuthority=Readonly<{[resourceScopeBrand]:true}>;
type Capture={env:WorkerEnv;db:WorkerEnv['DB'];actor:PilotUser;identity:MemoryResourceIdentity;validUntil:string;head:number;guards:MemorySqlGuard[];started:number;monotonic:number;config:string};
const captures=new WeakMap<NativeMemoryResourceAuthority,Capture>();
const configuration=(env:WorkerEnv)=>JSON.stringify([env.FORMA_MEMORY_SCHEDULING_ENABLED,env.FORMA_MEMORY_ENABLED,env.FORMA_MEMORY_USER_IDS,env.FORMA_PILOT_COHORT_ID,env.FORMA_ADMIN_EMAILS]);
function current(env:WorkerEnv,handle:NativeMemoryResourceAuthority){
 const c=captures.get(handle),wall=Date.now(),monotonic=performance.now();if(!c||c.env!==env||env.DB!==c.db||!Number.isFinite(wall)||!Number.isFinite(monotonic)||wall<c.started||wall>=Date.parse(c.validUntil)
  ||monotonic<c.monotonic||monotonic-c.monotonic>=30000||configuration(env)!==c.config)throw Error('resource_scope_expired');return c;
}
export function nativeMemoryResourceScopeInputs(env:WorkerEnv,handle:NativeMemoryResourceAuthority){const c=current(env,handle);return {identity:structuredClone(c.identity),validUntil:c.validUntil,sourceHead:c.head,permissionEpoch:c.actor.access.permissionEpoch};}
export function nativeMemoryResourceScopeGuards(env:WorkerEnv,handle:NativeMemoryResourceAuthority){return structuredClone(current(env,handle).guards);}

/** Fresh project/session admission and native declarations only. No document
 * lookup, selected-document fallback, linked-resource traversal or prose read.
 * Consumers must replay every returned guard atomically before reading/writing
 * resource memory. This handle is not enrollment or provider consent. */
export async function prepareNativeMemoryResourceAuthority(request:Request,env:WorkerEnv,selector:MemoryResourceSelector):Promise<NativeMemoryResourceAuthority>{
 const selection=memoryResourceSelector(selector);if(!selection)throw Error('resource_scope_required');
 const auth=await requireUser(request,env,'viewer',{account:'principal'}),actor=auth.user;
 if(auth.response||!actor||actor.fictional||actor.projectExecution||requireConsent(actor)||!liveMemoryEnabled(env,actor.userId)
  ||request.headers.get('cookie')?.split(';').some(c=>c.trim().startsWith('forma_impersonation=')))throw Error('resource_principal');
 const selected=await readProjectRequestContext(request,env,actor);if(selected.response||selected.context&&selected.context.projectId!==selection.projectId)throw Error('resource_project');
 return captureResourceAuthority(env,selection,actor,selected.context);
}
/** Native authenticated callers (including retained execution) obtain a fresh
 * principal without forging browser headers or borrowing a background grant.
 * The supplied identity is not sufficient: native principal/custody predicates
 * remain mandatory in the consuming transaction. No document authority flows. */
export async function prepareNativeMemoryResourceAuthorityForPrincipal(env:WorkerEnv,principal:PilotUser,selector:MemoryResourceSelector,scope:ProjectExecutionScope|null=null){
 const selection=memoryResourceSelector(selector),actor=await liveMemoryPrincipal(env,principal.userId);
 if(!selection||!actor||principal.fictional||principal.projectExecution||requireConsent(principal)||requireConsent(actor)
  ||actor.access.permissionEpoch!==principal.access.permissionEpoch||!liveMemoryEnabled(env,actor.userId)
  ||scope&&(scope.actorUserId!==actor.userId||scope.projectId!==selection.projectId))throw Error('resource_principal');
 return captureResourceAuthority(env,selection,actor,scope?{...scope,contextId:null,expiresAt:new Date(Date.now()+30000).toISOString()}:null);
}
/** Background consent is checked from the stored actor/epoch, never forged
 * browser headers or inherited document authority. Current native access is
 * replayed by the same transaction guards as an interactive request. */
export async function prepareScheduledResourceAuthority(env:WorkerEnv,e:MemoryResourceEnrollment){
 if(env.FORMA_MEMORY_SCHEDULING_ENABLED!=="true"||e.policy_version!=="personal-resource-memory-v1"||e.learn_enabled!==1||e.background_enabled!==1||Date.parse(e.expires_at)<=Date.now())throw Error('resource_background_consent');
 const actor=await liveMemoryPrincipal(env,e.actor_user_id);if(!actor||actor.access.permissionEpoch!==e.permission_epoch||!liveMemoryEnabled(env,actor.userId))throw Error('resource_background_access');
 if(!e.organization_id&&(e.project_access_id!==null||e.owner_user_id!==e.actor_user_id)||e.organization_id&&!e.project_access_id)throw Error('resource_background_custody');
 return captureResourceAuthority(env,{kind:e.resource_kind,projectId:e.project_id,resourceId:e.resource_id},actor,e.organization_id?{
  organizationId:e.organization_id,projectAccessId:e.project_access_id!,projectId:e.project_id,ownerUserId:e.owner_user_id,contextId:null,expiresAt:e.expires_at}:null);
}
async function captureResourceAuthority(env:WorkerEnv,selection:MemoryResourceSelector,actor:PilotUser,context:{organizationId:string;projectAccessId:string;projectId:string;ownerUserId:string;contextId:string|null;expiresAt:string}|null){
 const started=Date.now(),monotonic=performance.now(),db=env.DB,config=configuration(env);
 const scope=context?{organizationId:context.organizationId,projectAccessId:context.projectAccessId,projectId:context.projectId,ownerUserId:context.ownerUserId,actorUserId:actor.userId}:null;
 if(!(scope?hasCapability(actor,'project.read',scope):actor.access.capabilities.includes('project.read'))
  ||selection.kind==='canvas'&&!(scope?hasCapability(actor,'project.canvas.use',scope):actor.access.canvasAccess))throw Error('resource_access');
 const identity=memoryResourceIdentity(selection,{actorUserId:actor.userId,ownerUserId:scope?.ownerUserId??actor.userId,organizationId:scope?.organizationId??null,projectAccessId:scope?.projectAccessId??null});if(!identity)throw Error('resource_identity');
 const grant=nativeMemoryGrantDeadline(actor,started);if(grant===undefined)throw Error('resource_grant');
 const validUntil=new Date(Math.min(started+30000,...(grant?[Date.parse(grant)]:[]),...(context?[Date.parse(context.expiresAt)]:[]))).toISOString();
 // Empty documentId means no document selection in this shared native guard.
 // The typed resource identity above, and the independent predicates below,
 // own the resource. It is never passed to document Memory or saved as a document.
 const binding:ConsequentialBinding={version,intentHash:'',operation:'personal-resource-memory',actorUserId:actor.userId,permissionEpoch:actor.access.permissionEpoch,
  streamId:'creative:'+identity.ownerUserId,projectId:selection.projectId,documentId:'',canvasId:selection.kind==='canvas'?selection.resourceId:null,blockId:'',sourceHash:'',period:'',scope,contextSessionId:context?.contextId??null,pilotCohortId:null,steps:[],publicQuery:'',request:{}};
 const native=executionAdmissionGuard(actor,binding,null),pilot=configuredPilotAdmissionGuard(env,actor),guards:MemorySqlGuard[]=[{condition:native.sql,bindings:native.bindings},{condition:pilot.sql,bindings:pilot.bindings},
  {condition:"?>strftime('%Y-%m-%dT%H:%M:%fZ','now')",bindings:[validUntil]}];
 const query={sql:`SELECT
  (SELECT json_group_array(json_array(organization_id,project_access_id,status)) FROM (SELECT * FROM organization_projects WHERE owner_user_id=? AND project_id=? ORDER BY project_access_id LIMIT 3)) AS project_custody,
  (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?) AS head,
  (SELECT json_group_array(json_array(event_id,sequence,schema_version,recorded_at,actor,client_id,json_extract(payload,'$.project_id')))
    FROM(SELECT * FROM events WHERE stream_id=? AND type='ProjectCreated' AND json_extract(payload,'$.project_id')=? ORDER BY sequence LIMIT 3)) AS projects,
  (SELECT json_group_array(json_array(event_id,sequence,schema_version,recorded_at,actor,client_id,json_extract(payload,'$.project_id'),json_extract(payload,'$.canvas_id')))
    FROM(SELECT * FROM events WHERE stream_id=? AND type='CanvasCreated' AND json_extract(payload,'$.canvas_id')=? ORDER BY sequence LIMIT 3)) AS canvases,
  (SELECT json_array(event_id,sequence,type,json_extract(payload,'$.project_id')) FROM events WHERE stream_id=?
    AND json_extract(payload,'$.canvas_id')=? AND type IN('CanvasCreated','CanvasRemoved','CanvasRestored') ORDER BY sequence DESC LIMIT 1) AS lifecycle,
  (SELECT json_group_array(json_array(organization_id,project_access_id,project_id,owner_user_id,visibility,actor_user_id))
    FROM(SELECT * FROM project_resource_scopes WHERE owner_user_id=? AND resource_kind='canvas' AND resource_id=? ORDER BY organization_id,project_access_id LIMIT 3)) AS custody`,
  bindings:[identity.ownerUserId,selection.projectId,binding.streamId,binding.streamId,selection.projectId,binding.streamId,selection.kind==='canvas'?selection.resourceId:'',binding.streamId,selection.kind==='canvas'?selection.resourceId:'',identity.ownerUserId,selection.kind==='canvas'?selection.resourceId:'']};
 const read=db.prepare(query.sql).bind(...query.bindings),frames=structuredClone(await db.batch<Record<string,unknown>>([...guards.map(g=>derivationAssertion(env,g)),read]));
 if(env.DB!==db||configuration(env)!==config||!derivationResults(frames,guards.length+1)||!frames.slice(0,guards.length).every(derivationVerified))throw Error('resource_authority');
 const result=frames.at(-1)!;if(result.results.length!==1||Object.keys(result.results[0]!).sort().join(',')!=='canvases,custody,head,lifecycle,project_custody,projects')throw Error('resource_metadata');
 const row=result.results[0]!,projectCustody=JSON.parse(String(row.project_custody)),projects=JSON.parse(String(row.projects)),canvases=JSON.parse(String(row.canvases)),custody=JSON.parse(String(row.custody)),lifecycle=row.lifecycle===null?null:JSON.parse(String(row.lifecycle));
 const declaration=(value:unknown,canvas=false)=>Array.isArray(value)&&value.length===(canvas?8:7)&&typeof value[0]==='string'&&!value[0].startsWith('optimistic:')
  &&Number.isSafeInteger(value[1])&&value[1]>0&&value[2]===1&&typeof value[3]==='string'&&Number.isFinite(Date.parse(value[3]))&&Date.parse(value[3])<=Date.now()
  &&typeof value[4]==='string'&&(value[4].startsWith('user:')||!scope&&value[4]==='user')&&typeof value[5]==='string'&&!value[5].includes('optimistic')&&value[6]===selection.projectId&&(!canvas||value[7]===selection.resourceId);
 if(!Number.isSafeInteger(row.head)||Number(row.head)<1||!Array.isArray(projects)||projects.length!==1||!declaration(projects[0]))throw Error('resource_project_identity');
 if(!Array.isArray(projectCustody)||(!scope?projectCustody.length!==0:JSON.stringify(projectCustody)!==JSON.stringify([[scope.organizationId,scope.projectAccessId,'active']])))throw Error('resource_project_custody');
 if(selection.kind==='canvas'){
  if(!Array.isArray(canvases)||canvases.length!==1||!declaration(canvases[0],true)||!Array.isArray(lifecycle)||lifecycle.length!==4
   ||!['CanvasCreated','CanvasRestored'].includes(lifecycle[2])||lifecycle[3]!==selection.projectId||Number(lifecycle[1])<canvases[0][1]
   ||!Array.isArray(custody)||(!scope?custody.length!==0:custody.length!==1||JSON.stringify(custody[0].slice(0,4))!==JSON.stringify([scope.organizationId,scope.projectAccessId,selection.projectId,identity.ownerUserId])
    ||!(custody[0][4]==='collaborative_output'||custody[0][4]==='actor_private'&&custody[0][5]===actor.userId)))throw Error('resource_canvas_identity');
 }
 const witness=new AssistantContextReadWitness<null>(env);witness.observe([read],[result],[query]);witness.before(validUntil);witness.seal(null);
 guards.push(...witness.precommitGuards().map(g=>({condition:g.sql,bindings:g.bindings})));
 const handle=Object.freeze({}) as NativeMemoryResourceAuthority;captures.set(handle,{env,db,actor,identity,validUntil,head:Number(row.head),guards,started,monotonic,config});current(env,handle);return handle;
}

/** Discover the exact independent scope before offering enrollment. No side
 * effects, memory prose or settings inherited from the current document. */
export async function handleMemoryResourceScope(request:Request,env:WorkerEnv){
 if(request.method!=='GET')return reply({error:'method_not_allowed'},405);
 const url=new URL(request.url);if(request.headers.get('sec-fetch-site')==='cross-site')return reply({error:'same_origin_required'},403);
 if([...url.searchParams.keys()].some(key=>!['kind','projectId','resourceId'].includes(key)||url.searchParams.getAll(key).length!==1))return reply({error:'resource_scope_required'},400);
 const selector=memoryResourceSelector(Object.fromEntries(url.searchParams));if(!selector)return reply({error:'resource_scope_required'},400);
 try{
  const handle=await prepareNativeMemoryResourceAuthority(request,env,selector),proof=nativeMemoryResourceScopeGuards(env,handle).map(g=>derivationAssertion(env,g)),db=env.DB,checked=await db.batch(proof);
  if(env.DB!==db||!derivationResults(checked,proof.length)||!checked.every(derivationVerified))throw Error('resource_changed');
  const value=nativeMemoryResourceScopeInputs(env,handle),response=reply({scope:value.identity,validUntil:value.validUntil,enrollmentRequired:true,documentEnrollmentInherited:false,linkedResourceAccessInherited:false});
  nativeMemoryResourceScopeInputs(env,handle);return response;
 }catch{return reply({error:'resource_scope_unavailable'},403);}
}

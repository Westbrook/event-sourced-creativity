import type { WorkerEnv } from './runtime.ts';
import { requireUser, hasCapability, type PilotUser } from './pilot-policy.ts';
import { liveMemoryEnabled } from './memory-live-store.ts';
import { liveMemoryEnrollmentGuard, type LiveMemoryEnrollment } from './memory-live-authority.ts';
import { bodyOf, readScope } from './memory-derivation-api.ts';
import { derivationAssertion, derivationResults, derivationVerified, memoryDerivationSchema, memoryDerivationEnabled, memoryDerivationBinding } from './memory-derivation-store.ts';
import { derivationExact, derivationHash, derivationId } from './memory-derivation-policy.ts';
import { readNativeDerivationResult, prepareNativeDerivationResult, nativeDerivationResultBinding, nativeDerivationResultInputs, nativeDerivationResultGuards, nativeDerivationResultStatements } from './memory-derivation-results.ts';
import { readNativeProjectContainment } from './project-containment-api.ts';
import { packRecallGuards, readNativeRecallBoundarySnapshot } from './memory-recall-boundary-api.ts';
import { memoryRecallBoundary, memoryRecallRelation } from '../src/model/memory-recall-boundary.ts';
import { nativeMemoryGrantDeadline, nativeMemoryPilotDeadline, nativeMemoryPilotQuery } from './memory-native-deadlines.ts';
import { memoryCanonical, type MemorySqlGuard } from './memory-sql.ts';

type Row = Record<string, unknown>;
const version = 'memory-assistant-context-v1';
const columns = ['target_enrollment_id','actor_user_id','target_revision','job_id','output_sha256','source_enrollment_id','source_revision',
  'boundary_revision','hierarchy_revision','revision','state','created_at','expires_at'] as const;
const headers = { 'cache-control': 'private, no-store', vary: 'Cookie, oai-authenticated-user-id, oai-authenticated-user-email' };
const answer = (body: Row, status=200) => Response.json({version,...body},{status,headers});
/** Opaque, request-local native source evidence. JSON display references cannot
 * reconstruct this handle. It is NOT execution consent, a provider reservation,
 * a generated-answer origin, or permission to mutate an authored field. */
declare const savedContextRead: unique symbol;
export type NativeSavedAssistantContext = Readonly<{ readonly [savedContextRead]: true }>;
type SavedContextSelection = {
 actorUserId:string; targetEnrollmentId:string; targetRevision:number; projectId:string; documentId:string;
 contextRevision:string; jobId:string; outputSha256:string; sourceEnrollmentId:string; sourceRevision:number;
 boundaryRevision:string|null; hierarchyRevision:string|null; expiresAt:string; validUntil:string;
 relation:{zoom:string;distance:number;weight:number};
};
type SavedContextCapture = { env:WorkerEnv; current:()=>boolean; selection:SavedContextSelection;
 source:NonNullable<Awaited<ReturnType<typeof readNativeDerivationResult>>>; consumersPresent:boolean; guards:MemorySqlGuard[] };
const savedContextCaptures=new WeakMap<NativeSavedAssistantContext,SavedContextCapture>();
const savedContextResponses=new WeakMap<Response,NativeSavedAssistantContext>();
function contextCapture(env:WorkerEnv,handle:NativeSavedAssistantContext){
 const captured=savedContextCaptures.get(handle);
 if(!captured||captured.env!==env||!captured.current())throw Error('assistant_context_source_expired');
 // The original native source lease is not renewed by reading this adapter.
 nativeDerivationResultInputs(env,captured.source);return captured;
}
/** Native source preparation, deliberately independent from public JSON. Only
 * an authenticated GET of an accepted, freshly checked reference can create a
 * handle. Dismissed/unavailable/metadata-only views never create one. */
export async function prepareNativeSavedAssistantContext(request:Request,env:WorkerEnv):Promise<NativeSavedAssistantContext|null>{
 const url=new URL(request.url);
 if(request.method!=='GET'||url.pathname!=='/api/memory/assistant-context'||url.searchParams.has('controls'))return null;
 const response=await handleMemoryAssistantContext(request,env),handle=savedContextResponses.get(response);
 if(!handle)return null;
 try{contextCapture(env,handle);return handle;}catch{return null;}
}
/** Owned copies only. Selection metadata is kept separate from untrusted model
 * interpretation; callers must not treat relevance weights as confidence. */
export function nativeSavedAssistantContextInputs(env:WorkerEnv,handle:NativeSavedAssistantContext){
 const captured=contextCapture(env,handle);
 return {selection:structuredClone(captured.selection),consumersPresent:captured.consumersPresent,presentation:nativeDerivationResultInputs(env,captured.source)};
}
/** Replay source, target, hierarchy, boundary, consent and saved-reference DB
 * checks inside the consumer's atomic publication transaction. Environment and
 * lease checks run before constructing and acknowledging that proof. Returning
 * data above alone does not certify a subsequent write. */
export function nativeSavedAssistantContextGuards(env:WorkerEnv,handle:NativeSavedAssistantContext){
 const captured=contextCapture(env,handle);
 return [...nativeDerivationResultGuards(env,captured.source),...structuredClone(captured.guards)];
}
export function nativeSavedAssistantContextStatements(env:WorkerEnv,handle:NativeSavedAssistantContext){
 const captured=contextCapture(env,handle);
 return [...nativeDerivationResultStatements(env,captured.source),...packRecallGuards(captured.guards).map(g=>derivationAssertion(env,g))];
}
export function nativeSavedAssistantContextMatches(env:WorkerEnv,handle:NativeSavedAssistantContext,results:unknown){
 try{const count=nativeSavedAssistantContextStatements(env,handle).length;
  return derivationResults(results,count)&&proofMatches(results);
 }catch{return false;}
}

const identity = (e: LiveMemoryEnrollment) => ({actorId:e.actor_user_id,ownerId:e.owner_user_id,organizationId:e.organization_id,projectId:e.project_id,documentId:e.document_id});
function snapshot(sql:string, bindings:readonly (string|number|null)[], rows:Row[], keys:readonly string[]):MemorySqlGuard {
  return {condition:`(SELECT json_group_array(json_array(${keys.map(k=>'"'+k+'"').join(',')})) FROM (${sql}))=?`,
    bindings:[...bindings,JSON.stringify(rows.map(row=>keys.map(k=>row[k])))]};
}
async function read(env:WorkerEnv,sql:string,bindings:readonly (string|number|null)[]=[]){
  const db=env.DB,result=structuredClone(await db.prepare(sql).bind(...bindings).all<Row>());
  if(env.DB!==db||!derivationResults([result],1))throw Error('context_read');return result.results;
}
/** Durable semantic context is an actor-private reference, never a copied chat
 * answer, original human evidence, prompt authorization or permission grant.
 * Both scopes and the exact source result are replayed before each display.
 * Accept/dismiss/undo use CAS; no model, enrollment, allowance or event writes. */
export async function handleMemoryAssistantContext(request:Request,env:WorkerEnv):Promise<Response>{
 const auth=await requireUser(request,env,'viewer',{account:'principal'});
 if(auth.response||!auth.user)return answer({error:'authentication_required'},auth.response?.status??401);
 return readAssistantContext(request,env,auth.user);
}
/** Internal consumer entry point. Identity is an already authenticated native
 * principal; no forged authentication headers or response DTO are accepted.
 * Custody is resolved independently, without borrowing a browser session.
 * This is staging evidence: native assertions must run atomically with every
 * consuming disclosure, dispatch or write. It does not issue a read receipt. */
export async function prepareNativeSavedAssistantContextForPrincipal(env:WorkerEnv,actor:PilotUser,projectId:string,documentId:string){
 const selector=new Request('https://native.invalid/api/memory/assistant-context?'+new URLSearchParams({projectId,documentId}));
 const response=await readAssistantContext(selector,env,actor,true),handle=savedContextResponses.get(response);
 if(!handle)return null;
 try{contextCapture(env,handle);return handle;}catch{return null;}
}
async function readAssistantContext(request:Request,env:WorkerEnv,actor:PilotUser,native=false):Promise<Response>{
  const db=env.DB,started=Date.now(),monotonic=performance.now();
  const config=()=>memoryCanonical([env.FORMA_MEMORY_ENABLED,env.FORMA_MEMORY_USER_IDS,env.FORMA_MEMORY_DERIVATION_ENABLED,
    env.FORMA_MEMORY_DERIVATION_USER_IDS,env.FORMA_PILOT_COHORT_ID,env.FORMA_ADMIN_EMAILS,memoryDerivationBinding(env)]),configured=config();
  let deadline=started+30000;
  const current=()=>env.DB===db&&config()===configured&&Date.now()>=started&&Date.now()<deadline
    &&performance.now()>=monotonic&&performance.now()-monotonic<30000;
  try{
    const url=new URL(request.url);
    if(actor.fictional||actor.projectExecution||request.headers.get('cookie')?.split(';').some(c=>c.trim().startsWith('forma_impersonation=')))return answer({error:'principal_account_required'},403);
    if(!['GET','PUT','DELETE'].includes(request.method))return answer({error:'method_not_allowed'},405);
    if(request.headers.get('sec-fetch-site')==='cross-site'||request.method!=='GET'&&request.headers.get('origin')!==url.origin)return answer({error:'same_origin_required'},403);
    const projectId=url.searchParams.get('projectId'),documentId=url.searchParams.get('documentId');
    if(!derivationId(projectId)||!derivationId(documentId)||[...url.searchParams.keys()].some(k=>!['projectId','documentId','controls'].includes(k)||url.searchParams.getAll(k).length!==1))return answer({error:'context_scope_required'},400);
    const controls=url.searchParams.get('controls');if(controls!==null&&(controls!=='1'||request.method!=='GET'))return answer({error:'context_request_invalid'},400);
    const schema=await memoryDerivationSchema(env);if(!schema.contextsPresent||!schema.resultsPresent)throw Error('context_schema');
    const guards:MemorySqlGuard[]=[schema.guard,{condition:"?>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND EXISTS(SELECT 1 FROM pragma_foreign_keys WHERE foreign_keys=1) AND EXISTS(SELECT 1 FROM pragma_ignore_check_constraints WHERE ignore_check_constraints=0)",bindings:[new Date(deadline).toISOString()]}];
    const query=`SELECT ${columns.map(c=>'c.'+c).join(',')} FROM memory_derivation_contexts c JOIN memory_live_enrollments e ON e.enrollment_id=c.target_enrollment_id
      WHERE c.actor_user_id=? AND e.actor_user_id=? AND e.project_id=? AND e.document_id=? LIMIT 2`;
    const bindings=[actor.userId,actor.userId,projectId,documentId],found=await read(env,query,bindings),old=found[0];
    if(found.length>1||old&&!derivationExact(old,columns))throw Error('context_inventory');
    guards.push(snapshot(query,bindings,found,columns));
    // Source-free control metadata remains available after permission or qualification loss.
    if(controls==='1'){
      const principal=actor.authorizationSnapshot;if(!principal)throw Error('context_principal');
      guards.push({condition:"EXISTS(SELECT 1 FROM users WHERE user_id=? AND role=? AND COALESCE(updated_at,'')=?)",bindings:[actor.userId,actor.role,principal.updatedAt]});
      const pq='SELECT enrollment_id,revision FROM memory_live_enrollments WHERE actor_user_id=? AND project_id=? AND document_id=? LIMIT 2',pb=[actor.userId,projectId,documentId],parents=await read(env,pq,pb);
      if(parents.length!==1)throw Error('context_parent');guards.push(snapshot(pq,pb,parents,['enrollment_id','revision']));
      const proof=packRecallGuards(guards).map(g=>derivationAssertion(env,g)),result=await db.batch(proof);
      if(!current()||!derivationResults(result,proof.length)||!result.every(derivationVerified))throw Error('context_changed');
      return answer({targetEnrollmentId:parents[0].enrollment_id,targetRevision:parents[0].revision,validUntil:new Date(deadline).toISOString(),
        context:old?{revision:old.revision,state:old.state==='dismissed'?'dismissed':'unavailable',jobId:old.job_id}:null,presentation:null});
    }
    // Actor-private dismissal must work even after the source or target access ends.
    if(request.method==='DELETE'){
      const body=await bodyOf(request);
      if(!body||!derivationExact(body,['revision','confirmation'])||body.confirmation!=='DISMISS_ASSISTANT_CONTEXT'||!old||body.revision!==old.revision)return answer({error:'context_revision_changed'},409);
      const principal=actor.authorizationSnapshot;if(!principal)return answer({error:'principal_account_required'},403);
      guards.push({condition:"EXISTS(SELECT 1 FROM users WHERE user_id=? AND role=? AND COALESCE(updated_at,'')=?)",bindings:[actor.userId,actor.role,principal.updatedAt]});
      const revision=crypto.randomUUID(),checks=packRecallGuards(guards).map(g=>derivationAssertion(env,g));
      const result=await db.batch([...checks,db.prepare("UPDATE memory_derivation_contexts SET state='dismissed',revision=? WHERE target_enrollment_id=? AND revision=?")
        .bind(revision,String(old.target_enrollment_id),String(old.revision)),derivationAssertion(env,{condition:'changes()=1',bindings:[]})]);
      if(!current()||!derivationResults(result,checks.length+2)||!result.slice(0,checks.length).every(derivationVerified)||!derivationVerified(result.at(-1)!))throw Error('context_commit');
      return answer({saved:true,refreshRequired:true});
    }
    if(!liveMemoryEnabled(env,actor.userId)||!memoryDerivationEnabled(env,actor.userId))return answer({error:'memory_disabled'},403);
    const selected=await readScope(native?null:request,env,actor,projectId,documentId);if(selected instanceof Response)return selected;
    const target=selected.parent;
    if(target.recall_enabled!==1)throw Error('context_consent');
    guards.push(...selected.guards,liveMemoryEnrollmentGuard(target,'recall'));
    const grantDeadline=nativeMemoryGrantDeadline(actor,started);if(grantDeadline===undefined)throw Error('context_grant');
    deadline=Math.min(deadline,Date.parse(target.expires_at),...(grantDeadline?[Date.parse(grantDeadline)]:[]),...(selected.accessDeadline?[Date.parse(selected.accessDeadline)]:[]));
    const pilot=env.FORMA_PILOT_COHORT_ID?.trim()??'',breakglass=(env.FORMA_ADMIN_EMAILS??'').split(',').map(s=>s.trim().toLowerCase()).includes(actor.email.toLowerCase());
    if(pilot&&!breakglass){const q=nativeMemoryPilotQuery(pilot),rows=await read(env,q.sql,q.bindings),until=nativeMemoryPilotDeadline(rows,pilot,started);
      if(until===undefined)throw Error('context_pilot');if(until)deadline=Math.min(deadline,Date.parse(until));
      guards.push(snapshot(q.sql,q.bindings,rows,['cohort_id','organization_id','status','starts_at','ends_at']));}
    guards.push({condition:"?>strftime('%Y-%m-%dT%H:%M:%fZ','now')",bindings:[new Date(deadline).toISOString()]});
    const body=request.method==='PUT'?await bodyOf(request):null;
    if(request.method==='PUT'&&(!body||!derivationExact(body,['jobId','revision','targetEnrollmentId','targetRevision','confirmation'])||!derivationHash(body.jobId)
      ||body.confirmation!=='ACCEPT_ASSISTANT_CONTEXT'||body.revision!==(old?.revision??null)||body.targetEnrollmentId!==target.enrollment_id||body.targetRevision!==target.revision))return answer({error:'context_revision_changed'},409);
    const jobId=body?.jobId??old?.job_id;
    const metadata=()=>({targetEnrollmentId:target.enrollment_id,targetRevision:target.revision,validUntil:new Date(deadline).toISOString()});
    if(request.method==='GET'&&(!old||old.state==='dismissed')){
      const proof=packRecallGuards(guards).map(g=>derivationAssertion(env,g)),result=await db.batch(proof);
      if(!current()||!derivationResults(result,proof.length)||!result.every(derivationVerified))throw Error('context_changed');
      return answer({...metadata(),context:old?{revision:old.revision,state:'dismissed',jobId:old.job_id}:null,presentation:null});
    }
    if(!derivationHash(jobId))throw Error('context_job');
    const handle=await (native?prepareNativeDerivationResult:readNativeDerivationResult)(env,actor.userId,jobId);if(!handle)throw Error('context_source');
    const bound=nativeDerivationResultBinding(env,handle),source=bound.enrollment,presentation=nativeDerivationResultInputs(env,handle);
    if(!source||source.actor_user_id!==target.actor_user_id||source.owner_user_id!==target.owner_user_id||source.organization_id!==target.organization_id)throw Error('context_partition');
    let boundaryRevision:string|null=null,hierarchyRevision:string|null=null;
    let relation:{zoom:string;distance:number;weight:number}={zoom:'document',distance:0,weight:1};
    if(source.enrollment_id!==target.enrollment_id){
      const recalled=await readNativeRecallBoundarySnapshot(env,source.enrollment_id),boundary=recalled.boundary;
      if(!boundary||boundary.enrollment_revision!==source.revision||!memoryRecallBoundary(boundary.boundary))throw Error('context_boundary');
      guards.push(...recalled.guards);
      const tree=await readNativeProjectContainment(env,target.owner_user_id,true);
      const readable=new Set([...tree.forest.values()].filter(node=>{const access=tree.access.get(node.id)!;return access.active&&(node.organizationId===null?target.owner_user_id===actor.userId:hasCapability(actor,'project.read',{organizationId:node.organizationId,projectAccessId:access.accessId}));}).map(node=>node.id));
      const related=memoryRecallRelation(identity(source),identity(target),boundary.boundary,tree.forest,readable);if(!related)throw Error('context_ancestry');
      guards.push(...tree.guards.map(g=>({condition:g.sql,bindings:g.bindings})));
      relation=related;boundaryRevision=String(boundary.revision);hierarchyRevision=tree.revision;
    }
    deadline=Math.min(deadline,Date.parse(presentation.candidate.validUntil));
    const expiresAt=[target.expires_at,presentation.expiresAt].sort()[0]!;
    if(!current())throw Error('context_expired');
    if(request.method==='GET'&&(old!.target_enrollment_id!==target.enrollment_id||old!.target_revision!==target.revision||old!.source_enrollment_id!==source.enrollment_id
      ||old!.source_revision!==source.revision||old!.output_sha256!==bound.outputSha256||old!.boundary_revision!==boundaryRevision||old!.hierarchy_revision!==hierarchyRevision
      ||old!.expires_at!==expiresAt))throw Error('context_retired');
    const proof=[...nativeDerivationResultStatements(env,handle),...packRecallGuards(guards).map(g=>derivationAssertion(env,g))];
    if(request.method==='PUT'){
      const revision=crypto.randomUUID(),createdAt=new Date().toISOString();
      const values=[target.enrollment_id,actor.userId,target.revision,jobId,bound.outputSha256,source.enrollment_id,source.revision,boundaryRevision,hierarchyRevision,revision,'accepted',createdAt,expiresAt];
      const result=await db.batch([...proof,db.prepare(`INSERT INTO memory_derivation_contexts(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})
        ON CONFLICT(target_enrollment_id) DO UPDATE SET ${columns.slice(1).map(c=>c+'=excluded.'+c).join(',')}`).bind(...values),derivationAssertion(env,{condition:'changes()=1',bindings:[]})]);
      if(!current()||!derivationResults(result,proof.length+2)||!proofMatches(result.slice(0,proof.length))||!derivationVerified(result.at(-1)!))throw Error('context_commit');
      return answer({saved:true,refreshRequired:true});
    }
    const nativeHandle=Object.freeze({}) as NativeSavedAssistantContext;
    savedContextCaptures.set(nativeHandle,{env,current,source:handle,consumersPresent:schema.consumersPresent&&schema.consumerSourcesPresent,guards:structuredClone(guards),selection:{
      actorUserId:actor.userId,targetEnrollmentId:target.enrollment_id,targetRevision:target.revision,projectId,documentId,
      contextRevision:String(old!.revision),jobId,outputSha256:bound.outputSha256,sourceEnrollmentId:source.enrollment_id,
      sourceRevision:source.revision,boundaryRevision,hierarchyRevision,expiresAt,validUntil:new Date(deadline).toISOString(),relation:structuredClone(relation),
    }});
    if(!native){
      const result=await db.batch(nativeSavedAssistantContextStatements(env,nativeHandle));
      if(!nativeSavedAssistantContextMatches(env,nativeHandle,result))throw Error('context_changed');
    }
    const final=nativeSavedAssistantContextInputs(env,nativeHandle);
    const response=answer({...metadata(),context:{revision:old!.revision,state:'accepted',jobId,source:{enrollmentId:source.enrollment_id,projectId:source.project_id,documentId:source.document_id,...relation},purpose:bound.purpose,expiresAt},
      presentation:final.presentation,independentEvidence:false,completeHistory:false});
    savedContextResponses.set(response,nativeHandle);return response;
  }catch{return answer({error:request.method==='GET'?'assistant_context_unavailable':'assistant_context_commit_unconfirmed',noAutomaticRetry:true},503);}
}
function proofMatches(results:D1Result<Row>[]){return results.every(r=>derivationVerified(r)||r.results.length===1&&derivationExact(r.results[0],['context_source_asserted'])&&r.results[0]!.context_source_asserted===1);}

/** Bounded source-free retirement, including target-only expiry and already
 * withdrawn results. No provider, content hydration or renewal. */
export async function sweepAssistantMemoryContexts(env:WorkerEnv){
 const db=env.DB,schema=await memoryDerivationSchema(env);if(!schema.contextsPresent)return 0;
 const selected=`SELECT c.target_enrollment_id FROM memory_derivation_contexts c JOIN memory_live_enrollments e ON e.enrollment_id=c.target_enrollment_id
  LEFT JOIN memory_derivation_results r ON r.job_id=c.job_id
  WHERE c.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR e.revision<>c.target_revision OR e.recall_enabled<>1 OR e.learn_enabled<>1 OR r.state IS NOT 'active'
  ORDER BY c.expires_at,c.target_enrollment_id LIMIT 16`;
 const counted=`SELECT COUNT(*) AS count FROM (${selected})`,rows=await read(env,counted),count=rows[0]?.count;
 if(rows.length!==1||!Number.isSafeInteger(count)||Number(count)<0||Number(count)>16)throw Error('context_retirement_unavailable');
 const result=await db.batch([derivationAssertion(env,schema.guard),derivationAssertion(env,{condition:`(${counted})=?`,bindings:[Number(count)]}),
  db.prepare(`DELETE FROM memory_derivation_contexts WHERE target_enrollment_id IN(${selected})`),derivationAssertion(env,{condition:'changes()=?',bindings:[Number(count)]})]);
 if(env.DB!==db||!derivationResults(result,4)||![0,1,3].every(i=>derivationVerified(result[i]!)))throw Error('context_retirement_unconfirmed');
 return Number(count);
}

import { derivationControlRelation } from './memory-derivation-user-control-schema.ts';
import { scopedMemoryProfileFacets,type MemoryProfileFacet } from '../src/state/memory-profile-facets.ts';
import type { DerivationResultItem } from '../src/state/memory-derivation-client.ts';
import { createMemoryElapsed } from '../src/model/memory-lifetime.ts';
import { memoryRecallBoundary } from '../src/model/memory-recall-boundary.ts';
import { memoryCanonical,type MemorySqlGuard } from './memory-sql.ts';
import { derivationResults,derivationVerified,derivationAssertion,memoryDerivationSchema,memoryDerivationEnabled,memoryDerivationBinding } from './memory-derivation-store.ts';
import { derivationExact,derivationHash } from './memory-derivation-policy.ts';
import { readNativeRecallBoundarySnapshot,readNativeRecallRelation,recallSourceIdentity,packRecallGuards } from './memory-recall-boundary-api.ts';
import { prepareNativeDerivationResult,nativeDerivationResultBinding,nativeDerivationResultInputs,nativeDerivationResultGuards,type NativeDerivationResultRead } from './memory-derivation-results.ts';
import { currentProfileHeadGuard } from './memory-profile-catalog.ts';
import { readScope } from './memory-derivation-api.ts';
import { liveMemoryAuthorityFromPrincipal,liveMemoryEnrollmentGuard,type LiveMemoryEnrollment } from './memory-live-authority.ts';
import { requireUser,type PilotUser } from './pilot-policy.ts';
import { createMemoryReadBatch } from './memory-read-batch.ts';
import type { WorkerEnv } from './runtime.ts';

const VERSION='memory-scope-profile-v1';
const sourceColumns=['enrollment_id','job_id','owner_user_id','project_id'] as const;
type Source={env:WorkerEnv;read:NativeDerivationResultRead;enrollment:LiveMemoryEnrollment;relation:{zoom:'document'|'project'|'project-tree'|'partition'|'organization';distance:number;weight:number}};
declare const profileBrand:unique symbol;
export type NativeScopeProfile=Readonly<{[profileBrand]:true}>;
type Capture={env:WorkerEnv;db:WorkerEnv['DB'];sources:Source[];guards:MemorySqlGuard[];current:()=>boolean;value:{version:typeof VERSION;targetEnrollmentId:string;targetRevision:number;validUntil:string;facets:MemoryProfileFacet[];sourceJobs:string[];complete:false;independentEvidence:false;automaticProjection:true}};
const captures=new WeakMap<NativeScopeProfile,Capture>();
function captured(env:WorkerEnv,handle:NativeScopeProfile){const c=captures.get(handle);if(!c||c.env!==env||c.db!==env.DB||!c.current())throw Error('scope_profile_expired');for(const source of c.sources)nativeDerivationResultInputs(source.env,source.read);return c;}
export function nativeScopeProfileInputs(env:WorkerEnv,handle:NativeScopeProfile){return structuredClone(captured(env,handle).value);}
export function nativeScopeProfileGuards(env:WorkerEnv,handle:NativeScopeProfile){const c=captured(env,handle);return [...c.sources.flatMap(s=>nativeDerivationResultGuards(s.env,s.read)),...structuredClone(c.guards)];}
export function nativeScopeProfileStatements(env:WorkerEnv,handle:NativeScopeProfile){return packRecallGuards(nativeScopeProfileGuards(env,handle)).map(g=>derivationAssertion(env,g));}

/** Automatically refreshed projection of separately qualified nightly profiles.
 * No model call, authored policy, implicit enrollment or summary-as-evidence.
 * Only exact repeated interpretations can be promoted here; paraphrase relations
 * continue through the separately approved semantic review. The native handles
 * and final atomic replay, not this DTO, authorize disclosure/publication. */
export async function prepareNativeScopeProfile(env:WorkerEnv,actor:PilotUser,target:LiveMemoryEnrollment,targetGuards:readonly MemorySqlGuard[]):Promise<NativeScopeProfile>{
 const db=env.DB,clock=createMemoryElapsed({wall:Date.now(),monotonic:performance.now()});
 const configuration=()=>memoryCanonical([env.FORMA_MEMORY_ENABLED,env.FORMA_MEMORY_USER_IDS,env.FORMA_MEMORY_DERIVATION_ENABLED,env.FORMA_MEMORY_DERIVATION_USER_IDS,memoryDerivationBinding(env)]),config=configuration();
 const current=()=>env.DB===db&&configuration()===config&&clock.elapsed({wall:Date.now(),monotonic:performance.now()})<30000;
 if(actor.userId!==target.actor_user_id||!memoryDerivationEnabled(env,actor.userId)||target.recall_enabled!==1||target.learn_enabled!==1)throw Error('scope_profile_consent');
 const schema=await memoryDerivationSchema(env);if(!schema.completionPresent||!schema.userControlsPresent)throw Error('scope_profile_schema');
 const boundary=await readNativeRecallBoundarySnapshot(env,target.enrollment_id),range=boundary.boundary?.boundary??'document';
 if(!memoryRecallBoundary(range)||boundary.boundary&&boundary.boundary.enrollment_revision!==target.revision)throw Error('scope_profile_boundary');
 const authority=liveMemoryAuthorityFromPrincipal(env,target,actor);if(!authority)throw Error('scope_profile_authority');
 const guards:MemorySqlGuard[]=[schema.guard,...targetGuards,...boundary.guards,authority.guard,liveMemoryEnrollmentGuard(target,'recall')];
 // Current stored heads only. A retired or physically absent head is never
 // replaced by an older surviving interpretation. Discovery is metadata only.
 const query=`SELECT e.enrollment_id,j.job_id,e.owner_user_id,e.project_id FROM memory_live_enrollments e JOIN memory_derivation_grants g ON g.enrollment_id=e.enrollment_id AND g.actor_user_id=e.actor_user_id
  JOIN memory_derivation_jobs j ON j.consent_id=g.consent_id JOIN memory_derivation_completions done ON done.job_id=j.job_id AND done.outcome='stored'
  WHERE e.actor_user_id=? AND e.organization_id IS ? AND (e.owner_user_id=? OR ?='organization')
   AND e.learn_enabled=1 AND e.recall_enabled=1 AND e.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
   AND g.purpose='profile' AND g.revoked_at IS NULL AND g.enrollment_revision=e.revision AND g.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
   AND NOT EXISTS(SELECT 1 FROM memory_derivation_jobs newer JOIN memory_derivation_grants ng ON ng.consent_id=newer.consent_id
    JOIN memory_derivation_completions completed ON completed.job_id=newer.job_id AND completed.outcome='stored'
    WHERE ng.enrollment_id=e.enrollment_id AND ng.actor_user_id=e.actor_user_id AND ng.purpose='profile' AND ng.revoked_at IS NULL AND ng.enrollment_revision=e.revision
     AND (newer.through_sequence>j.through_sequence OR newer.through_sequence=j.through_sequence AND newer.job_id<j.job_id))
  ORDER BY CASE WHEN e.enrollment_id=? THEN 0 WHEN e.owner_user_id=? AND e.project_id=? THEN 1 ELSE 2 END,e.enrollment_id LIMIT 3`;
 const bindings=[actor.userId,target.organization_id,target.owner_user_id,range,target.enrollment_id,target.owner_user_id,target.project_id],found=structuredClone(await db.prepare(query).bind(...bindings).all<{enrollment_id:string;job_id:string;owner_user_id:string;project_id:string}>());
 if(!current()||!derivationResults([found],1)||found.results.length>3||found.results.some(r=>!derivationExact(r,sourceColumns)||!derivationHash(r.job_id))||new Set(found.results.map(r=>r.enrollment_id)).size!==found.results.length)throw Error('scope_profile_inventory');
 guards.push({condition:`(SELECT json_group_array(json_array(enrollment_id,job_id,owner_user_id,project_id)) FROM (${query}))=?`,bindings:[...bindings,JSON.stringify(found.results.map(r=>sourceColumns.map(k=>r[k])))]});
 const targetJob=found.results.find(r=>r.enrollment_id===target.enrollment_id);if(!targetJob)throw Error('scope_profile_unavailable');
 const selected:Array<{jobId:string;enrollment:LiveMemoryEnrollment;relation:Source['relation']}>=[{jobId:targetJob.job_id,enrollment:target,relation:{zoom:'document',distance:0,weight:1}}];
 const trees=new Map();
 // Bound fan-out before loading source bodies. This is an explicitly partial
 // projection, not an account-wide census or a completeness claim.
 const peers=found.results.filter(r=>r.enrollment_id!==target.enrollment_id).sort((a,b)=>Number(b.owner_user_id===target.owner_user_id&&b.project_id===target.project_id)-Number(a.owner_user_id===target.owner_user_id&&a.project_id===target.project_id)||a.enrollment_id.localeCompare(b.enrollment_id)).slice(0,2);
 if(range!=='document')for(const row of peers){
  if(row.enrollment_id===target.enrollment_id)continue;
  const raw=structuredClone(await db.prepare('SELECT * FROM memory_live_enrollments WHERE enrollment_id=? AND actor_user_id=?').bind(row.enrollment_id,actor.userId).first<LiveMemoryEnrollment>());
  if(!raw)throw Error('scope_profile_changed');
  const a=liveMemoryAuthorityFromPrincipal(env,raw,actor);if(!a)continue;
  const sourceRange=await readNativeRecallBoundarySnapshot(env,raw.enrollment_id),sourceBoundary=sourceRange.boundary?.boundary??'document';
  guards.push(...sourceRange.guards);
  if(!memoryRecallBoundary(sourceBoundary)||sourceRange.boundary&&sourceRange.boundary.enrollment_revision!==raw.revision)throw Error('scope_profile_boundary');
  if(sourceBoundary==='document')continue;
  const local=await readNativeRecallRelation(env,actor,raw,target,range,trees),peer=await readNativeRecallRelation(env,actor,raw,target,sourceBoundary,trees);guards.push(...local.guards,...peer.guards);
  if(!local.relation||!peer.relation||local.relation.zoom!==peer.relation.zoom||local.relation.weight!==peer.relation.weight)continue;
  selected.push({jobId:row.job_id,enrollment:raw,relation:local.relation});guards.push(a.guard,liveMemoryEnrollmentGuard(raw,'recall'));
 }
 selected.splice(1,selected.length-1,...selected.slice(1).sort((a,b)=>b.relation.weight-a.relation.weight||a.enrollment.enrollment_id.localeCompare(b.enrollment.enrollment_id)).slice(0,2));
 const noCorrections:MemorySqlGuard={condition:`NOT EXISTS(SELECT 1 FROM ${derivationControlRelation(schema.observationControlsPresent)} WHERE actor_user_id=? AND enrollment_id IN(SELECT value FROM json_each(?)) AND purpose='profile' AND action<>'released' AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,bindings:[actor.userId,JSON.stringify(selected.map(s=>s.enrollment.enrollment_id))]};
 guards.push(noCorrections);
 const correctionCheck=await db.batch([derivationAssertion(env,noCorrections)]);if(!current()||!derivationResults(correctionCheck,1)||!correctionCheck.every(derivationVerified))throw Error('scope_profile_corrected');
 const batch=createMemoryReadBatch(env,current,Math.max(1,30000-clock.elapsed({wall:Date.now(),monotonic:performance.now()})));
 let sources:Source[];
 try{
  const results=await Promise.allSettled(selected.map(s=>batch.run(async local=>{const read=await prepareNativeDerivationResult(local,actor.userId,s.jobId);if(!read)throw Error('scope_profile_source');const actual=nativeDerivationResultBinding(local,read);if(actual.purpose!=='profile'||actual.enrollment.enrollment_id!==s.enrollment.enrollment_id||actual.enrollment.revision!==s.enrollment.revision)throw Error('scope_profile_source');return {env:local,read,enrollment:actual.enrollment,relation:s.relation};})));
  const failed=results.find(r=>r.status==='rejected');if(failed?.status==='rejected')throw failed.reason;sources=results.map(r=>(r as PromiseFulfilledResult<Source>).value);
 }finally{batch.close();}
 for(const s of sources){const v=nativeDerivationResultInputs(s.env,s.read);guards.push(currentProfileHeadGuard(actor.userId,s.enrollment.enrollment_id,v.jobId));}
 const sections=sources.map((s,i)=>{const {candidate,jobId}=nativeDerivationResultInputs(s.env,s.read);
  const original=['memory-derivation-candidates-v1','memory-profile-consolidation-v1'].includes(candidate.version);
  const items:DerivationResultItem[]=candidate.items.map(item=>({...item,...(original&&!item.counterevidence.length&&!('reconciles'in item&&item.reconciles.length)?{originalSupportIds:item.sourceBindings.map(b=>b.sourceId)}:{})}));
  return {purpose:'profile',items,corrections:[],jobId,...(i?{source:{...recallSourceIdentity(s.enrollment,s.relation.zoom,s.enrollment.owner_user_id!==target.owner_user_id),...s.relation}}:{})};
 });
 const custody=target.organization_id?{kind:'organization' as const,organizationId:target.organization_id,projectAccessId:target.project_access_id!,ownerUserId:target.owner_user_id}:{kind:'personal' as const};
 const facets=scopedMemoryProfileFacets({projectId:target.project_id,documentId:target.document_id,custody},sections,{enrollmentId:target.enrollment_id,enrollmentRevision:target.revision,boundary:range,revision:boundary.boundary?.revision as string|null??null,organizationAvailable:boundary.organizationRangesPresent,validUntil:target.expires_at});
 const validUntil=new Date(Math.min(Date.parse(target.expires_at),Date.now()+Math.max(0,30000-clock.elapsed({wall:Date.now(),monotonic:performance.now()})),...sources.map(s=>Date.parse(nativeDerivationResultInputs(s.env,s.read).candidate.validUntil)))).toISOString();
 const handle=Object.freeze({}) as NativeScopeProfile;captures.set(handle,{env,db,sources,guards,current:()=>current()&&Date.now()<Date.parse(validUntil),value:{version:VERSION,targetEnrollmentId:target.enrollment_id,targetRevision:target.revision,validUntil,facets,sourceJobs:sources.map(s=>nativeDerivationResultInputs(s.env,s.read).jobId),complete:false,independentEvidence:false,automaticProjection:true}});captured(env,handle);return handle;
}

export async function handleMemoryScopeProfile(request:Request,env:WorkerEnv){
 const reply=(value:Record<string,unknown>,status=200)=>Response.json({version:VERSION,...value},{status,headers:{'cache-control':'private, no-store',vary:'Cookie, oai-authenticated-user-id, oai-authenticated-user-email'}});
 try{
  const url=new URL(request.url);if(request.method!=='GET')return reply({error:'method_not_allowed'},405);if(request.headers.get('sec-fetch-site')==='cross-site')return reply({error:'same_origin_required'},403);
  if([...url.searchParams.keys()].some(k=>!['projectId','documentId'].includes(k)||url.searchParams.getAll(k).length!==1))throw Error('scope');
  const auth=await requireUser(request,env,'viewer',{account:'principal'}),actor=auth.user;if(auth.response||!actor||actor.fictional||actor.projectExecution||request.headers.get('cookie')?.split(';').some(c=>c.trim().startsWith('forma_impersonation=')))return reply({error:'principal_account_required'},403);
  const selected=await readScope(request,env,actor,url.searchParams.get('projectId')??'',url.searchParams.get('documentId')??'');if(selected instanceof Response)return selected;
  const profile=await prepareNativeScopeProfile(env,actor,selected.parent,selected.guards),{readNativeScopeProfilePublication}=await import('./memory-scope-profile-store.ts'),publication=await readNativeScopeProfilePublication(env,profile),statements=nativeScopeProfileStatements(env,profile),frames=await env.DB.batch(statements);
  if(!derivationResults(frames,statements.length)||!frames.every(derivationVerified))throw Error('scope_profile_changed');
  const value={...nativeScopeProfileInputs(env,profile),publication};if(new TextEncoder().encode(JSON.stringify(value)).byteLength>524288)throw Error('scope_profile_capacity');
  const response=reply(value);nativeScopeProfileInputs(env,profile);return response;
 }catch{return reply({error:'scope_profile_unavailable'},503);}
}

/** Reference-only durable publication. It carries no private prose, inferred
 * instructions or access decision. Reconstructing it always requires fresh
 * native source handles; neither the manifest nor its hash grants recall. */
export async function nativeScopeProfilePublication(env:WorkerEnv,handle:NativeScopeProfile){
 const {memoryDigest}=await import('../src/model/scoped-memory.ts'),c=captured(env,handle),target=c.sources[0]!.enrollment;
 const sources=c.sources.map(s=>{const binding=nativeDerivationResultBinding(s.env,s.read),input=nativeDerivationResultInputs(s.env,s.read);return {jobId:input.jobId,outputSha256:binding.outputSha256,enrollmentId:s.enrollment.enrollment_id,enrollmentRevision:s.enrollment.revision,relation:s.relation};});
 const facets=await Promise.all(c.value.facets.map(async f=>({scope:f.scope,category:f.category,textSha256:await memoryDigest(f.text),originalCount:f.originalCount,documentCount:f.documentCount,projectCount:f.projectCount,support:f.support.map(({quotes:_quotes,...identity})=>identity)})));
 const manifest=memoryCanonical({version:VERSION,target:{actorUserId:target.actor_user_id,ownerUserId:target.owner_user_id,organizationId:target.organization_id,projectAccessId:target.project_access_id,projectId:target.project_id,documentId:target.document_id,enrollmentId:target.enrollment_id,revision:target.revision},sources,facets,independentEvidence:false});
 if(new TextEncoder().encode(manifest).byteLength>65536)throw Error('scope_profile_manifest_capacity');
 const profileId=await memoryDigest(manifest),expiresAt=new Date(Math.min(Date.parse(target.expires_at),...c.sources.map(s=>Date.parse(nativeDerivationResultInputs(s.env,s.read).expiresAt)))).toISOString();captured(env,handle);
 return {profileId,actorUserId:target.actor_user_id,targetEnrollmentId:target.enrollment_id,targetRevision:target.revision,manifest,expiresAt};
}

import { nativeMemoryDocumentIdentity } from './memory-native-scope.ts';
import type { WorkerEnv } from './runtime.ts';
import { requireUser } from './pilot-policy.ts';
import { createMemoryElapsed } from '../src/model/memory-lifetime.ts';
import { memoryCanonical,type MemorySqlGuard } from './memory-sql.ts';
import { memoryDigest } from '../src/model/scoped-memory.ts';
import { derivationExact,derivationId,derivationHash } from './memory-derivation-policy.ts';
import { memoryDerivationSchema,memoryDerivationEnabled,memoryDerivationBinding,derivationAssertion,derivationResults,derivationVerified } from './memory-derivation-store.ts';

const version='memory-profile-catalog-v1';
const columns=['enrollment_id','enrollment_revision','owner_user_id','organization_id','project_access_id','project_id','document_id','job_id','through_sequence','state','published_at','expires_at'] as const;
const reply=(value:Record<string,unknown>,status=200)=>Response.json({version,...value},{status,headers:{'cache-control':'private, no-store',vary:'Cookie, oai-authenticated-user-id, oai-authenticated-user-email'}});
/** Final current-head predicate, paired with the actual native result/source
 * proof. Completed newer work blocks an older result even after body deletion. */
export function currentProfileHeadGuard(actorUserId:string,enrollmentId:string,jobId:string):MemorySqlGuard{
 return {condition:`EXISTS(SELECT 1 FROM memory_derivation_jobs j JOIN memory_derivation_grants g ON g.consent_id=j.consent_id
  JOIN memory_live_enrollments e ON e.enrollment_id=g.enrollment_id
  JOIN memory_derivation_completions own ON own.job_id=j.job_id AND own.outcome='stored'
  WHERE j.job_id=? AND g.actor_user_id=? AND e.actor_user_id=g.actor_user_id AND e.enrollment_id=? AND g.purpose='profile'
   AND g.revoked_at IS NULL AND g.enrollment_revision=e.revision AND g.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
   AND NOT EXISTS(SELECT 1 FROM memory_derivation_jobs newer JOIN memory_derivation_grants ng ON ng.consent_id=newer.consent_id
    JOIN memory_derivation_completions done ON done.job_id=newer.job_id AND done.outcome='stored'
    WHERE ng.enrollment_id=e.enrollment_id AND ng.actor_user_id=g.actor_user_id AND ng.purpose='profile' AND ng.revoked_at IS NULL AND ng.enrollment_revision=e.revision
     AND (newer.through_sequence>j.through_sequence OR newer.through_sequence=j.through_sequence AND newer.job_id<j.job_id)))`,bindings:[jobId,actorUserId,enrollmentId]};
}
/** One actor-private inventory over separately governed nightly projections.
 * The current head includes withdrawn/expired results, so inspecting the profile
 * cannot silently resurrect an older interpretation. No prose, inference,
 * cross-scope promotion, provider work or source-read capability is returned. */
export async function handleMemoryProfileCatalog(request:Request,env:WorkerEnv){
 const db=env.DB,url=new URL(request.url),clock=createMemoryElapsed({wall:Date.now(),monotonic:performance.now()});
 const configuration=()=>memoryCanonical([env.FORMA_MEMORY_ENABLED,env.FORMA_MEMORY_USER_IDS,env.FORMA_MEMORY_DERIVATION_ENABLED,env.FORMA_MEMORY_DERIVATION_USER_IDS,memoryDerivationBinding(env)]),configured=configuration();
 const current=()=>env.DB===db&&configuration()===configured&&clock.elapsed({wall:Date.now(),monotonic:performance.now()})<30000;
 try{
  if(request.method!=='GET')return reply({error:'method_not_allowed'},405);
  if(request.headers.get('sec-fetch-site')==='cross-site')return reply({error:'same_origin_required'},403);
  const after=url.searchParams.get('after')??'';
  if(after&&!derivationId(after)||[...url.searchParams.keys()].some(k=>k!=='after'||url.searchParams.getAll(k).length!==1))return reply({error:'profile_cursor_invalid'},400);
  const auth=await requireUser(request,env,'viewer',{account:'principal'}),actor=auth.user;
  if(auth.response||!actor||actor.fictional||actor.projectExecution||!actor.authorizationSnapshot||request.headers.get('cookie')?.split(';').some(c=>c.trim().startsWith('forma_impersonation=')))return reply({error:'principal_account_required'},403);
  if(!memoryDerivationEnabled(env,actor.userId))return reply({error:'memory_disabled'},403);
  const schema=await memoryDerivationSchema(env);if(!schema.resultsPresent||!schema.userControlsPresent||!schema.completionPresent)throw Error('schema');
  const query=`SELECT e.enrollment_id,e.revision AS enrollment_revision,e.owner_user_id,e.organization_id,e.project_access_id,e.project_id,e.document_id,
    j.job_id,j.through_sequence,r.state,r.published_at,r.expires_at
   FROM memory_live_enrollments e JOIN memory_derivation_grants g ON g.enrollment_id=e.enrollment_id AND g.actor_user_id=e.actor_user_id
    JOIN memory_derivation_jobs j ON j.consent_id=g.consent_id JOIN memory_derivation_results r ON r.job_id=j.job_id
   WHERE e.actor_user_id=? AND e.enrollment_id>? AND g.purpose='profile' AND g.revoked_at IS NULL
    AND g.enrollment_revision=e.revision AND g.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    AND NOT EXISTS(SELECT 1 FROM memory_derivation_jobs newer JOIN memory_derivation_grants ng ON ng.consent_id=newer.consent_id
      JOIN memory_derivation_completions done ON done.job_id=newer.job_id AND done.outcome='stored'
      WHERE ng.enrollment_id=e.enrollment_id AND ng.actor_user_id=e.actor_user_id AND ng.purpose='profile' AND ng.revoked_at IS NULL
       AND ng.enrollment_revision=e.revision AND (newer.through_sequence>j.through_sequence OR newer.through_sequence=j.through_sequence AND newer.job_id<j.job_id))
    AND EXISTS(SELECT 1 FROM memory_derivation_completions done WHERE done.job_id=j.job_id AND done.outcome='stored')
   ORDER BY e.enrollment_id LIMIT 17`;
  const rows=structuredClone(await db.prepare(query).bind(actor.userId,after).all<Record<string,unknown>>());
  if(!current()||!derivationResults([rows],1)||rows.results.length>17||rows.results.some(row=>!derivationExact(row,columns)||!derivationId(row.enrollment_id)||!derivationHash(row.job_id))||new Set(rows.results.map(row=>row.enrollment_id)).size!==rows.results.length)throw Error('inventory');
  const guards:MemorySqlGuard[]=[schema.guard,{condition:"EXISTS(SELECT 1 FROM users WHERE user_id=? AND role=? AND COALESCE(updated_at,'')=?)",bindings:[actor.userId,actor.role,actor.authorizationSnapshot.updatedAt]},
   {condition:`(SELECT json_group_array(json_array(${columns.join(',')})) FROM (${query}))=?`,bindings:[actor.userId,after,JSON.stringify(rows.results.map(row=>columns.map(k=>row[k])))]}];
  const page=rows.results.slice(0,16),revision=await memoryDigest(memoryCanonical(page));
  const entries=page.map(row=>{const identity=nativeMemoryDocumentIdentity({actor_user_id:actor.userId,owner_user_id:String(row.owner_user_id),organization_id:row.organization_id as string|null,project_access_id:row.project_access_id as string|null,project_id:String(row.project_id),document_id:String(row.document_id)});if(!identity)throw Error('identity');return {...row,scope_key:memoryCanonical([identity.partitionKey,identity.documentKey])};});
  const checked=await db.batch(guards.map(g=>derivationAssertion(env,g)));if(!current()||!derivationResults(checked,guards.length)||!checked.every(derivationVerified))throw Error('changed');
  const response=reply({controlMetadataOnly:true,sourceContentRead:false,automaticallyDerived:true,completeProfile:false,pageRevision:revision,
   validUntil:new Date(Date.now()+Math.max(0,30000-clock.elapsed({wall:Date.now(),monotonic:performance.now()}))).toISOString(),entries,nextAfter:rows.results.length>16?page.at(-1)!.enrollment_id:null});
  if(!current())throw Error('expired');return response;
 }catch{return reply({error:'profile_catalog_unavailable'},503);}
}

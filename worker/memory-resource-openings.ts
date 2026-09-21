import { memoryResourceSelector } from '../src/model/memory-resource-scope.ts';
import { prepareNativeMemoryResourceAuthority,nativeMemoryResourceScopeInputs,nativeMemoryResourceScopeGuards } from './memory-resource-authority.ts';
import { memoryResourceSchema,memoryResourceEnrollmentGuard,resourceEnrollmentColumns,type MemoryResourceEnrollment } from './memory-resource-settings.ts';
import { derivationAssertion,derivationResults,derivationVerified } from './memory-derivation-store.ts';
import { derivationExact } from './memory-derivation-policy.ts';
import { readNativeControlBody } from './native-control-body.ts';
import type { WorkerEnv } from './runtime.ts';

const reply=(body:Record<string,unknown>,status=200)=>Response.json({version:'memory-resource-opening-v1',...body},{status,
 headers:{'cache-control':'private, no-store',vary:'Cookie, oai-authenticated-user-id, oai-authenticated-user-email'}});
/** The actual resource surface reports one opening after it is rendered. The
 * native receipt identifies that resource only: no text, linked-document read,
 * observed-content revision, dwell-time or independent preference is asserted.
 * Consent is checked at collection, not deferred until a later nightly job. */
export async function handleMemoryResourceOpening(request:Request,env:WorkerEnv){
 const url=new URL(request.url),db=env.DB;
 if(request.method!=='POST')return reply({error:'method_not_allowed'},405);
 if(request.headers.get('sec-fetch-site')==='cross-site'||request.headers.get('origin')!==url.origin)return reply({error:'same_origin_required'},403);
 if([...url.searchParams.keys()].some(k=>!['kind','projectId','resourceId'].includes(k)||url.searchParams.getAll(k).length!==1))return reply({error:'resource_scope_required'},400);
 const selector=memoryResourceSelector(Object.fromEntries(url.searchParams));if(!selector)return reply({error:'resource_scope_required'},400);
 const parsed=await readNativeControlBody(request);
 if(parsed.status!=='parsed'||!derivationExact(parsed.value,['openingId'])||typeof parsed.value.openingId!=='string'
  ||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(parsed.value.openingId))return reply({error:'resource_opening_invalid'},400);
 try{
  const handle=await prepareNativeMemoryResourceAuthority(request,env,selector),s=nativeMemoryResourceScopeInputs(env,handle),schema=await memoryResourceSchema(env);
  if(!schema.openings)return reply({recorded:false,noAutomaticRetry:true});
  const found=await db.prepare('SELECT * FROM memory_resource_enrollments WHERE actor_user_id=? AND resource_key=? LIMIT 2')
   .bind(s.identity.actorUserId,s.identity.resourceKey).all<MemoryResourceEnrollment>();
  if(env.DB!==db||!derivationResults([found],1)||found.results.length>1||found.results.some(r=>!derivationExact(r,resourceEnrollmentColumns)))throw Error('resource_opening_consent');
  const e=found.results[0];
  // No enrollment, renewal, historical backfill or silent consent upgrade.
  if(!e||e.learn_enabled!==1||e.permission_epoch!==s.permissionEpoch||Date.parse(e.expires_at)<=Date.now())return reply({recorded:false,noAutomaticRetry:true});
  const now=new Date().toISOString(),expiry=new Date(Math.min(Date.parse(e.expires_at),Date.parse(now)+e.retention_days*86400000)).toISOString();
  const guards=[schema,...nativeMemoryResourceScopeGuards(env,handle),memoryResourceEnrollmentGuard(e),
   {condition:"EXISTS(SELECT 1 FROM memory_resource_enrollments WHERE enrollment_id=? AND learn_enabled=1 AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))",bindings:[e.enrollment_id]}];
  const proof=guards.map(g=>derivationAssertion(env,g));
  const write=db.prepare(`INSERT INTO memory_resource_openings(enrollment_id,opening_id,enrollment_revision,source_head,recorded_at,expires_at)
   SELECT ?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM memory_resource_openings WHERE enrollment_id=? AND opening_id=?)
   AND (SELECT COUNT(*) FROM memory_resource_openings WHERE enrollment_id=? AND recorded_at>=?)<128`)
   .bind(e.enrollment_id,parsed.value.openingId,e.revision,s.sourceHead,now,expiry,e.enrollment_id,parsed.value.openingId,e.enrollment_id,now.slice(0,10)+'T00:00:00.000Z');
  nativeMemoryResourceScopeInputs(env,handle);
  const frames=await db.batch([...proof,write,db.prepare('SELECT changes() AS recorded'),
   db.prepare(`DELETE FROM memory_resource_openings WHERE enrollment_id=? AND (expires_at<=? OR opening_id NOT IN
    (SELECT opening_id FROM memory_resource_openings WHERE enrollment_id=? ORDER BY recorded_at DESC,opening_id DESC LIMIT 2048))`).bind(e.enrollment_id,now,e.enrollment_id)]);
  if(env.DB!==db||!derivationResults(frames,proof.length+3)||!frames.slice(0,proof.length).every(derivationVerified))throw Error('resource_opening_unconfirmed');
  const acknowledged=frames[proof.length+1]!.results;
  if(acknowledged.length!==1||!derivationExact(acknowledged[0],['recorded'])||![0,1].includes(acknowledged[0]!.recorded as number))throw Error('resource_opening_unconfirmed');
  nativeMemoryResourceScopeInputs(env,handle);
  return reply({recorded:acknowledged[0]!.recorded===1,noAutomaticRetry:true});
 }catch{return reply({error:'resource_opening_unavailable',noAutomaticRetry:true},503);}
}

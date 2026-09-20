import type { WorkerEnv } from './runtime.ts';
import { memoryCanonical } from './memory-sql.ts';
import { derivationAssertion, derivationAssertedChange, derivationChanged, derivationResults, derivationVerified, memoryDerivationSchema } from './memory-derivation-store.ts';
import { derivationExact, derivationHash, derivationId, derivationInteger, MEMORY_DERIVATION_PURPOSES } from './memory-derivation-policy.ts';

type Selector = {kind:'boundary';actorUserId:string;projectId:string;documentId:string}
 | {kind:'purpose';actorUserId:string;enrollmentId:string;purpose:string}
 | {kind:'hierarchy';ownerUserId:string} | {kind:'result';actorUserId:string;jobId:string};
/** Source-free retirement of existing private references, never a source read or
 * permission grant. The owning operation supplies its native authority checks
 * and publishes these statements in that SAME atomic transaction. No copied
 * candidate text, new enrollment, remote deletion claim, or paid work. */
export async function prepareMemoryContextRetirement(env:WorkerEnv,input:Selector,
 qualified?:Awaited<ReturnType<typeof memoryDerivationSchema>>){
 const selector=structuredClone(input),identity=memoryCanonical(selector),db=env.DB,schema=qualified??await memoryDerivationSchema(env);
 let condition:string,bindings:(string|number|null)[];
 if(selector.kind==='boundary'){
  if(!derivationExact(selector,['kind','actorUserId','projectId','documentId'])||![selector.actorUserId,selector.projectId,selector.documentId].every(derivationId))throw Error('context_retirement_selector');
  condition='target_enrollment_id<>source_enrollment_id AND actor_user_id=? AND source_enrollment_id IN(SELECT enrollment_id FROM memory_live_enrollments WHERE actor_user_id=? AND project_id=? AND document_id=?)';
  bindings=[selector.actorUserId,selector.actorUserId,selector.projectId,selector.documentId];
 }else if(selector.kind==='purpose'){
  if(!derivationExact(selector,['kind','actorUserId','enrollmentId','purpose'])||![selector.actorUserId,selector.enrollmentId].every(derivationId)
    ||!MEMORY_DERIVATION_PURPOSES.some(p=>p===selector.purpose))throw Error('context_retirement_selector');
  condition='actor_user_id=? AND source_enrollment_id=? AND job_id IN(SELECT j.job_id FROM memory_derivation_jobs j JOIN memory_derivation_grants g ON g.consent_id=j.consent_id WHERE g.actor_user_id=? AND g.enrollment_id=? AND g.purpose=?)';
  bindings=[selector.actorUserId,selector.enrollmentId,selector.actorUserId,selector.enrollmentId,selector.purpose];
 }else if(selector.kind==='hierarchy'){
  if(!derivationExact(selector,['kind','ownerUserId'])||!derivationId(selector.ownerUserId))throw Error('context_retirement_selector');
  // The saved hierarchy revision covers this owner's complete native forest,
  // not only the edited node. Invalidate all cross-scope uses of that revision.
  condition='target_enrollment_id<>source_enrollment_id AND source_enrollment_id IN(SELECT enrollment_id FROM memory_live_enrollments WHERE owner_user_id=?)';bindings=[selector.ownerUserId];
 }else if(selector.kind==='result'){
  if(!derivationExact(selector,['kind','actorUserId','jobId'])||!derivationId(selector.actorUserId)||!derivationHash(selector.jobId))throw Error('context_retirement_selector');
  condition='actor_user_id=? AND job_id=?';bindings=[selector.actorUserId,selector.jobId];
 }else throw Error('context_retirement_selector');
 const assertions=[derivationAssertion(env,schema.guard)];let count=0;
 if(schema.contextsPresent){
  const query=`SELECT COUNT(*) AS count FROM memory_derivation_contexts WHERE ${condition}`,found=structuredClone(await db.prepare(query).bind(...bindings).all<Record<string,unknown>>());
  if(env.DB!==db||!derivationResults([found],1)||found.results.length!==1||!derivationExact(found.results[0],['count'])||!derivationInteger(found.results[0].count))throw Error('context_retirement_inventory');
  count=found.results[0].count;assertions.push(derivationAssertion(env,{condition:`(${query})=?`,bindings:[...bindings,count]}));
 }
 const statements=schema.contextsPresent?[
  db.prepare(`DELETE FROM memory_derivation_contexts WHERE ${condition}`).bind(...bindings),
  derivationAssertion(env,{condition:'changes()=?',bindings:[count]}),
  derivationAssertion(env,{condition:`NOT EXISTS(SELECT 1 FROM memory_derivation_contexts WHERE ${condition})`,bindings}),
 ]:[];
 let used=false;
 return {assertions,statements,count,acknowledge(before:unknown,after:unknown){
  if(used)return false;used=true;
  return env.DB===db&&memoryCanonical(input)===identity&&derivationResults(before,assertions.length)&&before.every(derivationVerified)
    &&derivationResults(after,statements.length)&&(!schema.contextsPresent||(schema.consumersPresent?derivationAssertedChange(after[0]!,after[1]!,count):derivationChanged(after[0]!,count))&&after.slice(1).every(derivationVerified));
 }};
}

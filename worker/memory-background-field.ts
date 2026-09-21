import type { WorkerEnv } from './runtime.ts';
import type { MemoryFieldTarget } from '../src/model/memory-field-completion.ts';
import { memoryFieldTextHash } from '../src/model/memory-field-request.ts';
import { parseMemoryBackgroundField } from '../src/model/memory-background-field.ts';
import { derivationExact,derivationHash } from './memory-derivation-policy.ts';
import { derivationResults,memoryDerivationSchema } from './memory-derivation-store.ts';
import { prepareNativeDerivationResult,nativeDerivationResultBinding,nativeDerivationResultInputs,nativeDerivationResultStatements,nativeDerivationResultGuards } from './memory-derivation-results.ts';

/** Bounded discovery carries no private prose. Each selected result is then
 * independently prepared with current native grants, exact sources and inverse
 * dependencies. Its statements MUST join the consumer's disclosure/write batch. */
export async function prepareBackgroundMemoryField(env:WorkerEnv,actorUserId:string,ownerUserId:string,
 target:MemoryFieldTarget,selection?:{jobId:string;claimKey:string}){
 const db=env.DB,schema=await memoryDerivationSchema(env);
 if(!schema.resultsPresent||!schema.userControlsPresent||!schema.lifecyclePresent)return null;
 let ids:string[];
 if(selection){if(!derivationHash(selection.jobId))return null;ids=[selection.jobId];}
 else{
  const result=structuredClone(await db.prepare(`SELECT r.job_id FROM memory_derivation_results r
   JOIN memory_derivation_jobs j ON j.job_id=r.job_id JOIN memory_derivation_grants g ON g.consent_id=j.consent_id
   WHERE g.actor_user_id=? AND g.owner_user_id=? AND g.project_id=? AND g.document_id=? AND g.purpose='suggestion'
    AND g.revoked_at IS NULL AND g.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND r.state='active'
    AND r.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') ORDER BY j.through_sequence DESC,r.job_id LIMIT 8`)
   .bind(actorUserId,ownerUserId,target.projectId,target.documentId).all<{job_id:string}>());
  if(env.DB!==db||!derivationResults([result],1)||result.results.length>8||result.results.some(row=>!derivationExact(row,['job_id'])||!derivationHash(row.job_id)))throw Error('memory_field_inventory');
  ids=result.results.map(row=>row.job_id);
 }
 const textHash=await memoryFieldTextHash(target.text);
 for(const jobId of ids){
  const read=await prepareNativeDerivationResult(env,actorUserId,jobId);if(!read)continue;
  const input=nativeDerivationResultInputs(env,read),binding=nativeDerivationResultBinding(env,read),parent=binding.enrollment;
  if(binding.purpose!=='suggestion'||input.candidate.version!=='memory-field-suggestions-v1'
   ||parent.actor_user_id!==actorUserId||parent.owner_user_id!==ownerUserId||parent.project_id!==target.projectId||parent.document_id!==target.documentId)continue;
  const item=input.candidate.items.find(item=>(!selection||item.claimKey===selection.claimKey)&&item.locale===target.locale
   &&item.fieldTarget.blockId===target.blockId&&item.fieldTarget.revision===target.revision&&item.fieldTarget.textHash===textHash);
  if(!item)continue;
  const value=parseMemoryBackgroundField({version:'memory-background-field-v1',jobId,claimKey:item.claimKey,outputHash:binding.outputSha256,
   projectId:target.projectId,documentId:target.documentId,blockId:target.blockId,revision:target.revision,sequence:item.fieldTarget.sequence,textHash,
   beforeExcerpt:target.text,suggestedText:item.replacement,locale:target.locale,validUntil:input.candidate.validUntil,independentEvidence:false},target);
  if(!value||env.DB!==db)throw Error('memory_field_stale');
  return {value,guards:()=>nativeDerivationResultGuards(env,read),statements:()=>nativeDerivationResultStatements(env,read),current:()=>{nativeDerivationResultInputs(env,read);if(env.DB!==db)throw Error('memory_field_database');}};
 }
 return null;
}

import type { WorkerEnv } from './runtime.ts';
import { derivationAssertion,derivationChanged,derivationResults,derivationVerified,memoryDerivationSchema } from './memory-derivation-store.ts';
import { derivationExact,derivationHash,derivationInteger } from './memory-derivation-policy.ts';
import { nativeDerivationSourceInputs,nativeDerivationSourceStatements,type NativeDerivationSourceCapture } from './memory-derivation-sources.ts';
import { nativeDerivationResultInputs,nativeDerivationResultStatements,type NativeDerivationResultRead } from './memory-derivation-results.ts';
const clock="strftime('%Y-%m-%dT%H:%M:%fZ','now')";
type Row=Record<string,unknown>;

/** Compose after the result insertion in the SAME transaction. A completion
 * watermark covers eligible queue work, not removed sources or semantic truth.
 * It cannot pass a still-pending earlier job. Privacy cascades keep no contents. */
export async function prepareNativeDerivationCompletion(env:WorkerEnv,jobId:string,outcome:'stored'|'no-eligible-originals'){
  const db=env.DB,schema=await memoryDerivationSchema(env);if(!schema.completionPresent)return null;
  if(!derivationHash(jobId))throw Error('memory-completion-unavailable');
  const producer=schema.producersPresent?'EXISTS(SELECT 1 FROM memory_derivation_producer_jobs p WHERE p.job_id=j.job_id)':'0';
  const query=`SELECT j.consent_id,g.source_after_sequence,${producer} AS chat_studio,(SELECT outcome FROM memory_derivation_completions WHERE job_id=j.job_id) AS outcome,
    ${schema.producersPresent?`CASE WHEN ${producer} THEN (SELECT json_array(completed_through_sequence,generation,updated_at) FROM memory_derivation_producer_cursors WHERE consent_id=j.consent_id) ELSE `:''}(SELECT json_array(through_sequence,generation,updated_at) FROM memory_derivation_completion_cursors WHERE consent_id=j.consent_id)${schema.producersPresent?' END':''} AS cursor
    FROM memory_derivation_jobs j JOIN memory_derivation_grants g ON g.consent_id=j.consent_id WHERE j.job_id=? LIMIT 2`;
  const observed=structuredClone(await db.prepare(query).bind(jobId).all<Row>());
  if(env.DB!==db||!derivationResults([observed],1)||observed.results.length!==1||!derivationExact(observed.results[0],['consent_id','source_after_sequence','chat_studio','outcome','cursor']))throw Error('memory-completion-unavailable');
  const row=observed.results[0]!;if(row.chat_studio!==0&&row.chat_studio!==1)throw Error('memory-completion-unavailable');
  const chat=row.chat_studio===1,consent=String(row.consent_id),prior=row.cursor===null?null:JSON.parse(String(row.cursor));
  if(row.outcome!==null&&row.outcome!==outcome||!derivationInteger(row.source_after_sequence)||prior&&(!Array.isArray(prior)||prior.length!==3||!derivationInteger(prior[0])||!derivationInteger(prior[1],0,Number.MAX_SAFE_INTEGER-1)))throw Error('memory-completion-changed');
  const statements=[derivationAssertion(env,schema.guard),derivationAssertion(env,{condition:`(SELECT json_array(consent_id,source_after_sequence,chat_studio,outcome,cursor) FROM (${query}))=?`,bindings:[jobId,JSON.stringify([row.consent_id,row.source_after_sequence,row.chat_studio,row.outcome,row.cursor])]})];
  const writes:number[]=[];
  if(row.outcome===null){writes.push(statements.length);statements.push(db.prepare(`INSERT INTO memory_derivation_completions(job_id,outcome,completed_at) VALUES(?,?,${clock})`).bind(jobId,outcome),derivationAssertion(env,{condition:'changes()=1',bindings:[]}));}
  if(chat&&!prior)throw Error('memory-producer-cursor-missing');
  if(!prior){writes.push(statements.length);statements.push(db.prepare(`INSERT INTO memory_derivation_completion_cursors(consent_id,through_sequence,generation,updated_at) VALUES(?,?,0,${clock})`).bind(consent,Number(row.source_after_sequence)),derivationAssertion(env,{condition:'changes()=1',bindings:[]}));}
  // A gap blocks advancement, not storage of a later completed window. Once
  // the earlier window finishes, this catches up through all already done work.
  const channel=schema.producersPresent?` AND ${chat?'':'NOT '}EXISTS(SELECT 1 FROM memory_derivation_producer_jobs p WHERE p.job_id=j.job_id)`:'';
  const table=chat?'memory_derivation_producer_cursors':'memory_derivation_completion_cursors',column=chat?'completed_through_sequence':'through_sequence';
  const through=`COALESCE((SELECT MIN(j.after_sequence) FROM memory_derivation_jobs j WHERE j.consent_id=?${channel} AND NOT EXISTS(SELECT 1 FROM memory_derivation_completions done WHERE done.job_id=j.job_id)),(SELECT registered_through_sequence FROM ${chat?'memory_derivation_producer_cursors':'memory_derivation_cursors'} WHERE consent_id=?))`;
  const cursorWrite=statements.length;
  statements.push(db.prepare(`UPDATE ${table} SET ${column}=${through},generation=generation+1,updated_at=MAX(updated_at,${clock}) WHERE consent_id=? AND ${column}<${through}`).bind(consent,consent,consent,consent,consent),db.prepare('SELECT changes() AS cursor_changes'));
  statements.push(derivationAssertion(env,{condition:'EXISTS(SELECT 1 FROM memory_derivation_completions WHERE job_id=? AND outcome=?)',bindings:[jobId,outcome]}));
  return {statements,acknowledge(result:unknown){return env.DB===db&&derivationResults(result,statements.length)&&result.every((value,index)=>{
    if(writes.includes(index))return derivationChanged(value,1);
    if(index===cursorWrite){const n=result[cursorWrite+1]?.results[0]?.cursor_changes;return derivationInteger(n,0,1)&&derivationChanged(value,n);}
    if(index===cursorWrite+1)return value.results.length===1&&derivationExact(value.results[0],['cursor_changes'])&&derivationInteger(value.results[0].cursor_changes,0,1);
    return derivationVerified(value);
  });}};
}
export async function completeEmptyNativeDerivation(env:WorkerEnv,capture:NativeDerivationSourceCapture){
  const input=nativeDerivationSourceInputs(env,capture);if(input.originals.length||input.behavioralSources?.length)return false;
  const prepared=await prepareNativeDerivationCompletion(env,input.jobId,'no-eligible-originals');if(!prepared)return false;
  const proof=nativeDerivationSourceStatements(env,capture),result=await env.DB.batch([...proof,...prepared.statements]);
  return derivationResults(result,proof.length+prepared.statements.length)&&result.slice(0,proof.length).every(row=>derivationVerified(row)||row.results[0]?.context_source_asserted===1)&&prepared.acknowledge(result.slice(proof.length));
}
/** Recover a committed result with a lost worker acknowledgement. This reads
 * current source authority and never resends the provider request. */
export async function completeRetainedNativeDerivation(env:WorkerEnv,read:NativeDerivationResultRead){
  const input=nativeDerivationResultInputs(env,read),prepared=await prepareNativeDerivationCompletion(env,input.jobId,'stored');if(!prepared)return false;
  const proof=nativeDerivationResultStatements(env,read),result=await env.DB.batch([...proof,...prepared.statements]);
  return derivationResults(result,proof.length+prepared.statements.length)&&result.slice(0,proof.length).every(row=>derivationVerified(row)||row.results[0]?.context_source_asserted===1)&&prepared.acknowledge(result.slice(proof.length));
}

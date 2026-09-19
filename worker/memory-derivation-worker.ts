import { splitNativeDerivationJob } from './memory-derivation-split.ts';
import { DERIVATION_JOB_COLUMNS } from './memory-derivation-job-schema.ts';
import type { WorkerEnv } from './runtime.ts';
import { derivationExact,derivationHash,derivationInteger } from './memory-derivation-policy.ts';
import { memoryDerivationEnabled,memoryDerivationSchema,derivationAssertion,derivationResults,derivationVerified,derivationChanged } from './memory-derivation-store.ts';
import { claimNativeDerivationJob,nativeDerivationLeaseInputs } from './memory-derivation-admission.ts';
import { captureNativeDerivationSources,nativeDerivationSourceInputs } from './memory-derivation-sources.ts';
import { executeNativeDerivationProvider } from './memory-derivation-provider.ts';
import { publishNativeDerivationResult,readNativeDerivationResult } from './memory-derivation-results.ts';
import { completeEmptyNativeDerivation,completeRetainedNativeDerivation } from './memory-derivation-completion.ts';

const admitted=(env:WorkerEnv)=>env.FORMA_MEMORY_SCHEDULING_ENABLED==='true'&&env.FORMA_MEMORY_DERIVATION_PROCESSING_ENABLED==='true';
export type NativeDerivationWorkStatus='disabled'|'idle'|'split'|'stored'|'no-eligible-originals'|'capacity'|'unavailable'|'uncertain'|'charged-invalid';
/** One provider operation per native invocation. Browser DTOs cannot enqueue,
 * choose an actor/model, bypass purpose qualification or issue spending rights.
 * Unknown submissions remain held; this never retries a provider request. */
export async function runNativeDerivationScheduled(env:WorkerEnv):Promise<{status:NativeDerivationWorkStatus;processed:number}>{
  if(!admitted(env))return {status:'disabled',processed:0};
  const db=env.DB,schema=await memoryDerivationSchema(env);if(!schema.completionPresent)return {status:'unavailable',processed:0};
  const actors=[...new Set((env.FORMA_MEMORY_DERIVATION_USER_IDS??'').split(',').map(value=>value.trim()).filter(actor=>memoryDerivationEnabled(env,actor)))];
  if(!actors.length)return {status:'disabled',processed:0};
  // First recover a committed old result whose completion ACK was lost. This
  // does not hold up a fresh job when the retained source is now inaccessible.
  const recovered=await db.batch([derivationAssertion(env,schema.guard),db.prepare(`SELECT j.job_id,g.actor_user_id FROM memory_derivation_results r
    JOIN memory_derivation_jobs j ON j.job_id=r.job_id JOIN memory_derivation_grants g ON g.consent_id=j.consent_id
    WHERE r.state='active' AND r.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND g.actor_user_id IN(SELECT value FROM json_each(?)) AND NOT EXISTS(SELECT 1 FROM memory_derivation_completions done WHERE done.job_id=j.job_id)
    ORDER BY r.published_at,j.job_id LIMIT 1`).bind(JSON.stringify(actors))]);
  if(env.DB!==db||!admitted(env)||!derivationResults(recovered,2)||!derivationVerified(recovered[0]!))return {status:'unavailable',processed:0};
  const existing=recovered[1]!.results[0];
  if(existing){
    if(!derivationExact(existing,['job_id','actor_user_id'])||!derivationHash(existing.job_id))return {status:'unavailable',processed:0};
    const read=await readNativeDerivationResult(env,String(existing.actor_user_id),existing.job_id);
    if(read&&admitted(env)&&await completeRetainedNativeDerivation(env,read))return {status:'stored',processed:1};
  }
  const selected=await db.batch([derivationAssertion(env,schema.guard),db.prepare(`SELECT ${DERIVATION_JOB_COLUMNS.map(key=>'j.'+key).join(',')} FROM memory_derivation_jobs j
    JOIN memory_derivation_grants g ON g.consent_id=j.consent_id WHERE j.state='waiting' AND j.not_before<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND j.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND g.revoked_at IS NULL AND g.background_enabled=1
      AND g.actor_user_id IN(SELECT value FROM json_each(?)) AND NOT EXISTS(SELECT 1 FROM memory_derivation_completions done WHERE done.job_id=j.job_id)
    ORDER BY j.not_before,j.created_at,j.source_count,j.job_id LIMIT 4`).bind(JSON.stringify(actors))]);
  if(env.DB!==db||!admitted(env)||!derivationResults(selected,2)||!derivationVerified(selected[0]!))return {status:'unavailable',processed:0};
  const candidates=selected[1]!.results;if(!candidates.length)return {status:'idle',processed:0};
  if(candidates.length>4||candidates.some(row=>!derivationExact(row,DERIVATION_JOB_COLUMNS)||!derivationHash(row.job_id)))return {status:'unavailable',processed:0};
  let last:NativeDerivationWorkStatus='unavailable';
  for(const row of candidates){
  if(env.DB!==db||!admitted(env))return {status:'unavailable',processed:0};
  let lease;try{lease=await claimNativeDerivationJob(env,String(row.job_id));}catch{lease=null;}
  if(!admitted(env))return {status:'unavailable',processed:0};
  if(!lease){
    // Metadata-only backoff keeps an inaccessible head from starving every
    // later job. Exact waiting-row CAS cannot reset an uncertain committed
    // lease, release a financial hold or issue execution authority.
    const writes=[derivationAssertion(env,schema.guard),db.prepare(`UPDATE memory_derivation_jobs
      SET not_before=MAX(not_before,MIN(expires_at,strftime('%Y-%m-%dT%H:%M:%fZ','now','+60 seconds'))),failure_code='native-proof-unavailable'
      WHERE ${DERIVATION_JOB_COLUMNS.map(key=>key+' IS ?').join(' AND ')} AND state='waiting'
        AND not_before<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
        AND NOT EXISTS(SELECT 1 FROM memory_derivation_completions done WHERE done.job_id=memory_derivation_jobs.job_id)
        AND NOT EXISTS(SELECT 1 FROM memory_derivation_job_finance link WHERE link.job_id=memory_derivation_jobs.job_id)`)
      .bind(...DERIVATION_JOB_COLUMNS.map(key=>row[key] as string|number|null)),db.prepare('SELECT changes() AS changed')];
    const result=await db.batch<Record<string,unknown>>(writes),n=result[2]?.results[0]?.changed;
    if(env.DB!==db||!admitted(env)||!derivationResults(result,3)||!derivationVerified(result[0]!)||result[2]!.results.length!==1
      ||!derivationExact(result[2]!.results[0],['changed'])||!derivationInteger(n,0,1)||!derivationChanged(result[1]!,n))return {status:'uncertain',processed:0};
    continue;
  }
  const input=nativeDerivationLeaseInputs(env,lease);if(!memoryDerivationEnabled(env,input.grant.actor_user_id))return {status:'unavailable',processed:0};
  const captured=await captureNativeDerivationSources(env,lease,{crossProducerHistory:true});if(captured.status!=='captured'){
    if(captured.status==='capacity'){
      const split=await splitNativeDerivationJob(env,lease);
      if(split!=='unchanged')return {status:split,processed:0};
    }
    last=captured.status;continue;
  }
  if(!admitted(env))return {status:'unavailable',processed:0};
  const source=nativeDerivationSourceInputs(env,captured.capture);
  if(!source.originals.length&&!source.behavioralSources?.length)return await completeEmptyNativeDerivation(env,captured.capture)
    ?{status:'no-eligible-originals',processed:1}:{status:'uncertain',processed:0};
  const response=await executeNativeDerivationProvider(env,lease,captured.capture);
  // Capacity is established before any reservation/dispatch. Continue the
  // bounded scan so an irreducible legacy window cannot starve smaller work.
  if(response.status==='capacity'){
    const split=await splitNativeDerivationJob(env,lease);
    if(split!=='unchanged')return {status:split,processed:0};
    last='capacity';continue;
  }
  if(response.status!=='candidate')return {status:response.status,processed:0};
  const stored=await publishNativeDerivationResult(env,response.receipt);
  return stored.status==='stored'?{status:'stored',processed:1}:{status:'uncertain',processed:0};
  }
  return {status:last,processed:0};
}

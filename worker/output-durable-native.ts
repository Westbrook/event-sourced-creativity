import { outputAssertionStatements, OutputConflictError } from "./output-command-core.ts";
import { documentJobPrincipal, runDocumentJob, type DocumentJobRow } from "./document-jobs-api.ts";
import { loadOutputJobBinding, prepareOutputJobOutcomeStatements, reconcileKnownOutputProviderReceipts } from "./output-execution-control.ts";
import { requireOutputDurableBinding, outputDurableFence, type OutputDurableMedia } from "./output-durable-control.ts";
import { createOutputDurableRuntime, type OutputDurableOutcome, type OutputDurableRow, type OutputDurablePorts } from "./output-durable-runtime.ts";
import { recoverOutputFalImage } from "./output-fal-recovery.ts";
import { recoverOutputVideo } from "./output-video-recovery.ts";
import { recoverOutputAudio } from "./output-audio-recovery.ts";
import { recoverOutputModel3d } from "./output-model3d-recovery.ts";
import type { WorkerEnv } from "./runtime.ts";

/** Executes an original once. Every later delivery classifies retained evidence;
 * it never requeues an interrupted native attempt or buys a replacement. */
export async function executeDurableNativeOutput(env: WorkerEnv, row: Readonly<OutputDurableRow>): Promise<OutputDurableOutcome> {
  await requireOutputDurableBinding(env, row.job_id);
  if(row.phase==="cancel_requested")return{phase:"uncertain",code:"output_durable_cancellation_unavailable"};
  const read = () => env.DB.prepare("SELECT job.*,slot.slot_id AS output_slot_id FROM document_jobs job JOIN output_operation_slots slot ON slot.job_id=job.job_id AND slot.scope_key=? AND slot.slot_id=? WHERE job.job_id=?").bind(row.scope_key,row.slot_id,row.job_id).first<DocumentJobRow>();
  let job = await read();
  if (!job) return { phase: "uncertain", code: "output_durable_job_missing" };
  const user = await documentJobPrincipal(env, job);
  if (!user || user.fictional || user.projectExecution || user.userId !== row.actor_user_id || (user.billingUserId ?? user.userId) !== user.userId)
    return { phase: "uncertain", code: "output_durable_authority_unavailable" };
  const binding = await loadOutputJobBinding(env, user, job);
  if (!binding || binding.sponsored || binding.scope.kind !== "personal" || binding.slot.attemptOrdinal !== 0 || binding.slot.previousSlotId)
    return { phase: "uncertain", code: "output_durable_original_required" };
  const readCalls = () => env.DB.prepare("SELECT call_key,provider,status,provider_response_id FROM output_provider_calls WHERE scope_key=? AND slot_id=?")
    .bind(row.scope_key, row.slot_id).all<{ call_key:string;provider:string;status: string; provider_response_id: string | null }>();
  let calls=await readCalls(),started=false;
  if (job.status === "queued" && job.attempt_count === 0 && calls.results.length === 0) {
    await env.DB.prepare("UPDATE output_durable_jobs SET phase='generating',revision=revision+1,updated_at=? WHERE job_id=?")
      .bind(new Date().toISOString(),row.job_id).run();
    await runDocumentJob(env, user, job.job_id, job);started=true;
    job = await read();calls=await readCalls();
  }
  if(!job)return{phase:"uncertain",code:"output_durable_job_missing"};
  if(job.status==="queued"&&job.attempt_count===0&&calls.results.length===0)return{phase:"queued"};
  // A published completion with unfinished job bookkeeping is not permission
  // to publish the same output again. Dedicated custody reconciliation is needed.
  const noCompletion={sql:"NOT EXISTS(SELECT 1 FROM events WHERE stream_id=? AND correlation_id=? AND type IN('GenerationCompleted','DocumentRenderCompleted'))",bindings:[job.stream_id,job.correlation_id]};
  if(job.status!=="completed" && !await env.DB.prepare("SELECT 1 WHERE "+noCompletion.sql).bind(...noCompletion.bindings).first())
    return{phase:"uncertain",code:"output_durable_completion_reconciliation_required"};
  if(["running","committing"].includes(job.status)){
    if(job.lease_expires_at && Date.parse(job.lease_expires_at)>Date.now())return{phase:"generating"};
    // Close only an expired native attempt; preserve all paid checkpoints and
    // reservations. No generic runner/retry or source reconstruction is used.
    if(!job.lease_expires_at)return{phase:"uncertain",code:"output_durable_native_lease_unknown"};
    const now=new Date().toISOString(),checkpoint={...JSON.parse(job.result_json??"{}"),stage:"failed",
      errorDetail:{code:"execution_interrupted",category:"server",scope:"unknown",action:"contact_support",retryable:false}};
    const resultJson=JSON.stringify(checkpoint);
    await env.DB.batch([env.DB.prepare(`UPDATE document_jobs SET status='failed',error_message='execution_interrupted',
      completed_at=?,lease_expires_at=NULL,result_json=?,updated_at=? WHERE job_id=? AND correlation_id=?
      AND status IN('running','committing') AND lease_expires_at<=? AND result_json IS ? AND request_json=? AND attempt_count=?`).bind(now,resultJson,now,job.job_id,job.correlation_id,now,job.result_json,job.request_json,job.attempt_count),
      ...outputAssertionStatements(env,{sql:'changes()=1'}),...outputAssertionStatements(env,noCompletion),
      ...prepareOutputJobOutcomeStatements(env,job,{completedAt:now,resultJson})]);
    job=await read();
  }
  if(job?.status==="failed"){
    const request=JSON.parse(job.request_json),result=JSON.parse(job.result_json??"{}"),kind=job.kind==="generate"?"image":request.artifactKind;
    const media=calls.results.find(call=>call.call_key===`${kind}:initial`&&call.provider==="fal"
      &&["uncertain","settled"].includes(call.status)&&call.provider_response_id&&!/^(pending|unknown|submitted)$/iu.test(call.provider_response_id));
    const recover=kind==="image"&&result.outputFalCheckpoint?recoverOutputFalImage:kind==="video"?recoverOutputVideo:
      kind==="audio"?recoverOutputAudio:kind==="model3d"?recoverOutputModel3d:undefined;
    if(media&&recover){
      if(started)return{phase:"awaiting_provider"};
      let stage="binding";
      try{
        const recovered=await recover(env,user,job,{assertions:[outputDurableFence(env,row.job_id)!],onStage:value=>{stage=value;}});
        if(recovered.status!=="completed")return{phase:"awaiting_provider"};
        job=await read();
      }catch(error){
        // Lease loss remains a failed delivery. An intact lease with an
        // unprovable original is terminal uncertainty, never another POST.
        await requireOutputDurableBinding(env,row.job_id);
        if(!(error instanceof OutputConflictError)&&row.read_failures<20
          &&["provider_read","provider_status","provider_result","provider_media","video_provider","audio_provider","model3d_provider_read"].includes(stage))
          return{phase:"awaiting_provider",retryAfterMs:30000,code:"output_durable_provider_read_retry"};
        return{phase:"uncertain",code:"output_durable_recovery_unavailable"};
      }
    }
  }
  await reconcileKnownOutputProviderReceipts(env,user,{jobId:row.job_id,assertions:[outputDurableFence(env,row.job_id)!]});
  const state = await env.DB.prepare(`SELECT slot.status,
    EXISTS(SELECT 1 FROM output_provider_calls call WHERE call.scope_key=slot.scope_key AND call.slot_id=slot.slot_id AND (call.status IN('pending','uncertain') OR call.used_microusd IS NULL)) AS unresolved,
    cost.status AS cost_status,token.status AS token_status,token.used_tokens AS used_tokens
    FROM output_operation_slots slot JOIN cost_budget_reservations cost ON cost.reservation_id=slot.cost_reservation_id
    JOIN budget_reservations token ON token.reservation_id=slot.token_reservation_id WHERE slot.scope_key=? AND slot.slot_id=?`)
    .bind(row.scope_key, row.slot_id).first<{ status: string; unresolved: number; cost_status: string; token_status: string;used_tokens:number }>();
  if (job?.status === "completed" && state?.status === "succeeded" && !state.unresolved && state.cost_status === "settled" && (state.token_status === "settled" || state.token_status === "released" && state.used_tokens === 0))
    return { phase: "ready" };
  if (job?.status === "failed" && state?.status === "failed" && !state.unresolved && !["active", "executing"].includes(state.cost_status) && ["settled","released"].includes(state.token_status))
    return { phase: "failed" };
  // Includes an interrupted planner, unknown POST acknowledgement, incomplete
  // storage/publication, and native recovery that cannot reconstruct authority.
  return { phase: "uncertain", code: "output_durable_reconciliation_required" };
}

/** No registered HTTP route constructs this factory. A future host must supply
 * an independently durable delivery + periodic sweep and explicitly install
 * the candidate schema before enrolling new Run commands. */
export function createNativeOutputDurableRuntime(env: WorkerEnv, wake: OutputDurablePorts["wake"], options?: { leaseMs?: number; retryMs?: number; enrollMedia?:readonly OutputDurableMedia[] }) {
  return createOutputDurableRuntime(env, { wake, execute: executeDurableNativeOutput }, options);
}

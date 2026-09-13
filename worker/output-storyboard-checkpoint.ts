import { preparePrivateContent } from "./private-content-storage.ts";
import { outputAssertionStatements, OutputConflictError, type OutputSqlAssertion, type OutputScope, type OutputOperationSlot } from "./output-requirements-ledger.ts";
import { captureOutputStoryboardPlan, type CapturedStoryboardPlan } from "./output-storyboard-plan.ts";
import { storyboardFrameRequest } from "./output-storyboard-fal.ts";
import type { OutputFalCapturedRequest } from "./output-fal-image-contract.ts";
import type { WorkerEnv } from "./runtime.ts";
import type { PilotUser } from "./pilot-policy.ts";
import type { DocumentJobRow } from "./document-jobs-api.ts";

/** Prior images must be retained by this exact operation before the next frame
 * can consume its claim. A pending/unknown call cannot count as a saved image. */
export function storyboardFrameSequenceAssertion(scope: OutputScope, slot: OutputOperationSlot, job: DocumentJobRow, frameIndex: number, planBinding: string): OutputSqlAssertion {
  if (!Number.isSafeInteger(frameIndex) || frameIndex < 0 || frameIndex >= 4 || !/^[a-f0-9]{64}$/u.test(planBinding)) throw new Error("output_storyboard_frame_sequence_invalid");
  return { sql: `EXISTS(SELECT 1 FROM document_jobs current WHERE current.job_id=? AND current.owner_id=? AND current.stream_id=?
    AND EXISTS(SELECT 1 FROM output_operation_slots relation WHERE relation.job_id=current.job_id AND relation.scope_key=? AND relation.slot_id=?)
    AND current.status='running' AND current.attempt_count=?
    AND COALESCE(json_array_length(current.result_json,'$.renderedItems'),0)=?
    AND (SELECT COUNT(*) FROM json_each(COALESCE(json_extract(current.result_json,'$.renderedItems'),'[]')) frame
      JOIN output_provider_calls paid ON paid.scope_key=? AND paid.slot_id=? AND paid.call_key='image:frame:'||(CAST(frame.key AS INTEGER)+1)
        AND paid.stage_key=paid.call_key AND paid.provider='fal' AND paid.status='settled' AND paid.used_microusd IS NOT NULL
        AND paid.client_request_id=json_extract(frame.value,'$.provider_submission_id')
        AND paid.provider_response_id=json_extract(frame.value,'$.provider_request_id')
        AND paid.model=json_extract(frame.value,'$.provider_model')
      WHERE json_extract(frame.value,'$.media_url') LIKE '/api/media/%'
        AND json_extract(current.result_json,'$.outputStoryboardCheckpoints.f'||(CAST(frame.key AS INTEGER)+1)||'.frameIndex')=CAST(frame.key AS INTEGER)
        AND json_extract(current.result_json,'$.outputStoryboardCheckpoints.f'||(CAST(frame.key AS INTEGER)+1)||'.stage')=paid.stage_key
        AND json_extract(current.result_json,'$.outputStoryboardCheckpoints.f'||(CAST(frame.key AS INTEGER)+1)||'.clientRequestId')=paid.client_request_id
        AND json_extract(current.result_json,'$.outputStoryboardCheckpoints.f'||(CAST(frame.key AS INTEGER)+1)||'.requestDigest')=paid.request_digest
        AND json_extract(current.result_json,'$.outputStoryboardCheckpoints.f'||(CAST(frame.key AS INTEGER)+1)||'.provider')=paid.provider
        AND json_extract(current.result_json,'$.outputStoryboardCheckpoints.f'||(CAST(frame.key AS INTEGER)+1)||'.model')=paid.model
        AND json_extract(current.result_json,'$.outputStoryboardCheckpoints.f'||(CAST(frame.key AS INTEGER)+1)||'.storyboardBindingSha256')=?)=?)`,
  bindings: [job.job_id,scope.actorUserId,job.stream_id,scope.key,slot.slotId,job.attempt_count,frameIndex,scope.key,slot.slotId,planBinding,frameIndex] };
}

/** Same guarded private environment as the native Image checkpoint. Exact claim,
 * owner, original job/slot/route, current lease and planner bytes join atomically
 * with both private bodies and the reference-only frame checkpoint. */
export async function retainStoryboardFrameCheckpoint(env: WorkerEnv, user: PilotUser, job: DocumentJobRow, scope: OutputScope,
  slot: OutputOperationSlot, request: OutputFalCapturedRequest, plan: CapturedStoryboardPlan, frameIndex: number): Promise<void> {
  const { captured, attempt } = await storyboardFrameRequest(plan, frameIndex, request);
  if (scope.kind !== "personal" || user.projectExecution || scope.ownerUserId !== user.userId || scope.actorUserId !== user.userId
    || job.owner_id !== user.userId || slot.jobId !== job.job_id || job.kind !== "render_document"
    || job.document_id !== scope.documentId || job.output_slot_id !== slot.slotId) throw new OutputConflictError("output_storyboard_checkpoint_scope_mismatch",403);
  const previous: Record<string,unknown> = JSON.parse(job.result_json ?? "{}");
  const originalPlan = await captureOutputStoryboardPlan(previous.artifactPlan, plan.contract, previous.plannerResponseId);
  if (originalPlan.bindingSha256 !== plan.bindingSha256) throw new OutputConflictError("output_storyboard_checkpoint_plan_changed",409);
  const originalPlanRaw = JSON.stringify(previous.artifactPlan), key = `f${frameIndex+1}`, path = `$.outputStoryboardCheckpoints.${key}`;
  const requestContent = await preparePrivateContent(env,user.userId,"prompt",captured.body);
  const planContent = await preparePrivateContent(env,user.userId,"provider-output",plan.raw);
  const now = new Date().toISOString();
  const checkpoint = { version:"output-storyboard-frame-checkpoint-v1",frameIndex,stage:attempt.logicalCallKey,
    clientRequestId:attempt.clientRequestId,requestDigest:attempt.requestDigest,adaptedRequestDigest:captured.attempt.requestDigest,
    provider:"fal",model:captured.contract.model,requestRef:requestContent.contentId,planRef:planContent.contentId,
    planSha256:plan.planSha256,storyboardBindingSha256:plan.bindingSha256,plannerResponseId:plan.plannerResponseId,
    expiresAt:[requestContent.expiresAt,planContent.expiresAt,job.expires_at].sort()[0] };
  const serialized = JSON.stringify(checkpoint);
  const call:OutputSqlAssertion = { sql:`EXISTS(SELECT 1 FROM output_provider_calls call JOIN output_operation_slots slot ON slot.scope_key=call.scope_key AND slot.slot_id=call.slot_id
    WHERE call.scope_key=? AND call.slot_id=? AND call.call_key=? AND call.stage_key=? AND call.provider='fal' AND call.model=?
      AND call.client_request_id=? AND call.request_digest=? AND call.status='pending' AND call.provider_response_id IS NULL
      AND slot.job_id=? AND slot.route_digest=? AND slot.grant_id=? AND slot.source_digest=? AND slot.status IN('queued','running'))`,
  bindings:[scope.key,slot.slotId,attempt.logicalCallKey!,attempt.logicalCallKey!,captured.contract.model,attempt.clientRequestId,attempt.requestDigest!,job.job_id,slot.routeDigest,slot.grantId,slot.sourceDigest] };
  const current:OutputSqlAssertion = { sql:`EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND owner_id=? AND stream_id=? AND document_id=? AND correlation_id=?
    AND EXISTS(SELECT 1 FROM output_operation_slots relation WHERE relation.job_id=document_jobs.job_id AND relation.scope_key=? AND relation.slot_id=?)
    AND attempt_count=? AND status='running' AND lease_expires_at>MAX(?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    AND expires_at>MAX(?,strftime('%Y-%m-%dT%H:%M:%fZ','now')) AND json_type(COALESCE(result_json,'{}'),?) IS NULL
    AND json_extract(result_json,'$.artifactPlan')=? AND json_extract(result_json,'$.plannerResponseId')=?)`,
  bindings:[job.job_id,user.userId,job.stream_id,scope.documentId,job.correlation_id,scope.key,slot.slotId,job.attempt_count,now,now,path,originalPlanRaw,plan.plannerResponseId] };
  const retained=(content:{contentId:string;expiresAt:string},kind:string,body:string):OutputSqlAssertion=>({sql:`EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind=? AND content=? AND redacted_at IS NULL AND expires_at=? AND expires_at>MAX(?,strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,bindings:[content.contentId,user.userId,kind,body,content.expiresAt,now]});
  await env.DB.batch([
    ...[call,current,storyboardFrameSequenceAssertion(scope,slot,job,frameIndex,plan.bindingSha256)].flatMap(assertion=>outputAssertionStatements(env,assertion)),
    ...requestContent.statements,...planContent.statements,
    ...outputAssertionStatements(env,retained(requestContent,"prompt",captured.body)),...outputAssertionStatements(env,retained(planContent,"provider-output",plan.raw)),
    env.DB.prepare("UPDATE document_jobs SET result_json=json_set(COALESCE(result_json,'{}'),?,json(?)),updated_at=? WHERE job_id=? AND owner_id=?").bind(path,serialized,now,job.job_id,user.userId),
    ...outputAssertionStatements(env,{sql:"EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND owner_id=? AND json_extract(result_json,?)=?)",bindings:[job.job_id,user.userId,path,serialized]}),
  ]);
  job.result_json=JSON.stringify({...previous,outputStoryboardCheckpoints:{...(previous.outputStoryboardCheckpoints as Record<string,unknown>??{}),[key]:checkpoint}});
}

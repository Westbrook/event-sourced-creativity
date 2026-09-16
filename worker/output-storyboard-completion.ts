import { recordStoryboardReadFailure, type StoryboardReadStage } from "./storyboard-read-diagnostic.ts";
import { canonicalJson } from "../src/experiences/compiler.ts";
import { invalidProviderSubmissions, providerSubmissions } from "../src/model/provider-submission.ts";
import { captureStoryboardPlannerRequest, captureStoryboardPlannerResponse, readStoryboardPlannerExecution } from "./output-storyboard-request.ts";
import { storyboardEnvelopeText, type StoryboardRawEnvelope } from "./output-storyboard-envelope.ts";
import { restoreOutputFalImageRequest } from "./output-fal-image-contract.ts";
import { storyboardFrameRequest } from "./output-storyboard-fal.ts";
import { readOutputStoryboardFrameMedia, type StoryboardFrameMedia } from "./output-storyboard-media.ts";
import { readOpenAITextUsage, priceCurrentOpenAITextUsage } from "./openai-text-cost.ts";
import type { WorkerEnv } from "./runtime.ts";
import type { DocumentJobRow } from "./document-jobs-api.ts";
import type { OutputScope, OutputOperationSlot, OutputSqlAssertion } from "./output-requirements-ledger.ts";

const fail=():never=>{throw new Error("output_storyboard_completion_invalid");};
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:fail();
const same=(a:unknown,b:unknown)=>canonicalJson(a)===canonicalJson(b);
const text=(value:unknown):string=>typeof value==="string"&&value.length>0?value:fail();

/** Re-read original private evidence and all five settled claims. The returned
 * assertions must join the caller's live source/owner/lease proof at publication.
 * This neither approves the visual result nor allocates generation authority. */
type StoryboardEvidenceInputs=[env:WorkerEnv,scope:OutputScope,slot:OutputOperationSlot,job:DocumentJobRow,
 settings:Record<string,unknown>,artifactId:string,artifact:unknown,renderedItems:unknown,lifetime?:{signal?:AbortSignal;deadlineMs?:number}];
export async function verifyOutputStoryboardCompletion(...args:StoryboardEvidenceInputs){return storyboardEvidence(false,...args);}
/** Read-only revalidation of an already completed original. This cannot satisfy
 * publication's running-job/lease guard and never reinstates spend permission. */
export async function readOutputStoryboardCompletion(...args:StoryboardEvidenceInputs){return storyboardEvidence(true,...args);}
async function storyboardEvidence(retainedRead:boolean,env:WorkerEnv,scope:OutputScope,slot:OutputOperationSlot,job:DocumentJobRow,
 settings:Record<string,unknown>,artifactId:string,artifact:unknown,renderedItems:unknown,lifetime:{signal?:AbortSignal;deadlineMs?:number}={}){
 let diagnosticStage:StoryboardReadStage="completion_identity";
 try{
 const execution=readStoryboardPlannerExecution(settings.outputStoryboardPlanner);
 if(!execution||!same(execution.contract,settings.outputStoryboard)||scope.kind!=="personal"||scope.actorUserId!==scope.ownerUserId
  ||job.owner_id!==scope.actorUserId||job.stream_id!==`creative:${scope.actorUserId}`||job.document_id!==scope.documentId
  ||job.kind!=="render_document"||job.output_slot_id!==slot.slotId||slot.jobId!==job.job_id)return fail();
 const assertions:OutputSqlAssertion[]=[];
 const current:OutputSqlAssertion={sql:`EXISTS(SELECT 1 FROM document_jobs job JOIN output_operation_slots slot ON slot.job_id=job.job_id
  WHERE job.job_id=? AND job.owner_id=? AND job.stream_id=? AND job.document_id=? AND job.correlation_id=? AND job.attempt_count=?
   AND ${retainedRead?"job.status='completed'":"job.status IN('running','committing') AND job.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')"} AND job.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
   AND slot.scope_key=? AND slot.slot_id=? AND slot.job_id=job.job_id AND slot.grant_id=? AND slot.route_digest=? AND slot.source_digest=? AND ${retainedRead?"slot.status='succeeded'":"slot.status IN('queued','running')"})`,
  bindings:[job.job_id,scope.actorUserId,job.stream_id,scope.documentId,job.correlation_id,job.attempt_count,scope.key,slot.slotId,slot.grantId,slot.routeDigest,slot.sourceDigest]};
 if(!await env.DB.prepare(`SELECT 1 AS current WHERE ${current.sql}`).bind(...current.bindings!).first())return fail();
 assertions.push(current);
 diagnosticStage="completion_checkpoint";
 const row=await env.DB.prepare("SELECT result_json FROM document_jobs WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=?").bind(job.job_id,scope.actorUserId,job.stream_id,job.correlation_id).first<{result_json:string}>();
 if(!row)return fail();const checkpoint=object(JSON.parse(row.result_json)),planner=object(checkpoint.outputStoryboardPlannerCheckpoint),rawCheckpoint=object(checkpoint.outputStoryboardRawEnvelope),frames=object(checkpoint.outputStoryboardCheckpoints);
 if(checkpoint.artifactId!==artifactId||!same(checkpoint.artifactPlan,artifact)||!same(checkpoint.renderedItems,renderedItems)
  ||!Array.isArray(renderedItems)||renderedItems.length!==4||Object.keys(frames).sort().join(',')!=="f1,f2,f3,f4")return fail();
 if(checkpoint.providerSubmissionProtocol!==1||Object.hasOwn(checkpoint,"providerSubmissionLegacyUncertain")&&checkpoint.providerSubmissionLegacyUncertain!==false||invalidProviderSubmissions(checkpoint))return fail();
 for(const key of ["artifactId","artifactPlan","renderedItems","outputStoryboardPlannerCheckpoint","outputStoryboardRawEnvelope","outputStoryboardCheckpoints","providerSubmissions","providerSubmissionProtocol","plannerResponseId"]){
  assertions.push({sql:"EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND owner_id=? AND json_extract(result_json,?)=json_extract(?, '$') AND json_type(result_json,?)=json_type(?,'$'))",bindings:[job.job_id,scope.actorUserId,'$.'+key,JSON.stringify(checkpoint[key]),'$.'+key,JSON.stringify(checkpoint[key])]});
 }
 assertions.push({sql:"EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND owner_id=? AND json_extract(result_json,'$.providerSubmissionLegacyUncertain') IS json_extract(?,'$.providerSubmissionLegacyUncertain'))",bindings:[job.job_id,scope.actorUserId,row.result_json]});
 async function retained(ref:unknown,kind:string){
  const id=text(ref),predicate="content_id=? AND owner_id=? AND kind=? AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND length(CAST(content AS BLOB))<=1048576 AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=private_content.content_id)";
  const body=await env.DB.prepare(`SELECT content,expires_at FROM private_content WHERE ${predicate}`).bind(id,scope.actorUserId,kind).first<{content:string;expires_at:string}>();
  if(!body)return fail();assertions.push({sql:`EXISTS(SELECT 1 FROM private_content WHERE ${predicate} AND content=? AND expires_at=?)`,bindings:[id,scope.actorUserId,kind,body.content,body.expires_at],deadlineMs:Date.parse(body.expires_at)});return body.content;
 }
 diagnosticStage="completion_planner_request";
 const prepared=await captureStoryboardPlannerRequest(execution.contract,await retained(planner.requestRef,"prompt"),text(planner.clientRequestId));
 if(prepared.requestDigest!==execution.requestDigest||prepared.maximumInputTokens!==execution.maximumInputTokens
  ||planner.version!=="output-storyboard-planner-checkpoint-v1"||planner.stage!=="planning:0:initial"||planner.provider!=="openai"||planner.model!==prepared.attempt.model
  ||planner.requestDigest!==prepared.requestDigest||!same(planner.contract,execution.contract))return fail();
 diagnosticStage="completion_planner_envelope";
 const envelope=object(JSON.parse(await retained(rawCheckpoint.responseRef,"provider-response"))) as unknown as StoryboardRawEnvelope;
 if(envelope.version!=="output-storyboard-raw-envelope-v1"||envelope.clientRequestId!==planner.clientRequestId||envelope.requestDigest!==planner.requestDigest
  ||envelope.provider!=="openai"||envelope.model!==planner.model||envelope.httpStatus!==200||envelope.complete!==true||envelope.readFailed!==false
  ||typeof envelope.bodyBase64!=="string"||!Number.isSafeInteger(envelope.retainedBytes)||envelope.retainedBytes<0)return fail();
 for(const key of ["version","clientRequestId","requestDigest","provider","model","retainedBytes","complete","readFailed","httpStatus"] as const)if(rawCheckpoint[key]!==envelope[key])return fail();
 const response=object(JSON.parse(storyboardEnvelopeText(envelope)));
 const output=Array.isArray(response.output)?response.output:[];
 const originalText=response.output_text||output.flatMap(value=>Array.isArray(object(value).content)?object(value).content as unknown[]:[]).map(object).find(part=>part.type==="output_text")?.text;
 diagnosticStage="completion_planner_plan";
 const captured=await captureStoryboardPlannerResponse(response,text(originalText),execution.contract,prepared.requestBody);
 if(captured.plannerResponseId!==checkpoint.plannerResponseId||!same(captured.plan,artifact))return fail();
 diagnosticStage="completion_ledger";
 const paid=(await env.DB.prepare("SELECT call_key,stage_key,provider,model,client_request_id,request_digest,status,used_microusd,provider_response_id FROM output_provider_calls WHERE scope_key=? AND slot_id=? ORDER BY call_key").bind(scope.key,slot.slotId).all<Record<string,unknown>>()).results;
 if(paid.length!==5||new Set(paid.map(call=>call.client_request_id)).size!==5||new Set(paid.map(call=>call.provider_response_id)).size!==5
  ||paid.some(call=>call.status!=="settled"||!Number.isSafeInteger(call.used_microusd)||Number(call.used_microusd)<0))return fail();
 const receipts=providerSubmissions(checkpoint);if(receipts.length!==5)return fail();
 function claim(stage:string,clientId:unknown,requestDigest:unknown,provider:string,model:string,responseId:unknown){
  const matches=paid.filter(call=>call.call_key===stage),call=matches[0],matchingReceipts=receipts.filter(value=>value.clientRequestId===clientId),receipt=matchingReceipts[0];
  if(matches.length!==1||!call||call.stage_key!==stage||call.client_request_id!==clientId||call.request_digest!==requestDigest||call.provider!==provider||call.model!==model||call.provider_response_id!==responseId
   ||matchingReceipts.length!==1||!receipt||receipt.status!=="completed"||receipt.operation!==(provider==="openai"?"planning":"image")||receipt.provider!==provider||receipt.model!==model||receipt.providerRequestId!==responseId||receipt.costMicrousd!==call.used_microusd)return fail();
  assertions.push({sql:"EXISTS(SELECT 1 FROM output_provider_calls WHERE scope_key=? AND slot_id=? AND call_key=? AND stage_key=? AND provider=? AND model=? AND client_request_id=? AND request_digest=? AND provider_response_id=? AND status='settled' AND used_microusd=?)",bindings:[scope.key,slot.slotId,stage,stage,provider,model,text(clientId),text(requestDigest),text(responseId),Number(call.used_microusd)]});return call;
 }
 diagnosticStage="completion_planner_claim";
 const plannerCall=claim("planning:0:initial",planner.clientRequestId,planner.requestDigest,"openai",prepared.attempt.model,response.id);
 const usage=readOpenAITextUsage(response.usage,{cachePolicy:"disabled-explicit"}),cost=priceCurrentOpenAITextUsage(prepared.attempt.model,usage,typeof response.service_tier==="string"?response.service_tier:"default");
 const plannerReceipt=receipts.find(value=>value.clientRequestId===planner.clientRequestId)!;
 if(plannerCall.used_microusd!==cost.totalMicrousd||plannerReceipt.inputTokens!==usage.inputTokens||plannerReceipt.outputTokens!==usage.outputTokens||plannerReceipt.totalTokens!==usage.totalTokens)return fail();
 const media=[];
 for(let index=0;index<4;index++){
  diagnosticStage="completion_frame";
  const saved=object(frames['f'+(index+1)]),frame=object(renderedItems[index]);
  if(saved.version!=="output-storyboard-frame-checkpoint-v1"||saved.frameIndex!==index||saved.stage!==`image:frame:${index+1}`||saved.provider!=="fal"
   ||saved.planSha256!==captured.planSha256||saved.storyboardBindingSha256!==captured.bindingSha256||saved.plannerResponseId!==captured.plannerResponseId
   ||await retained(saved.planRef,"provider-output")!==captured.raw)return fail();
  const request=await restoreOutputFalImageRequest(settings.outputFalImage,await retained(saved.requestRef,"prompt"),text(saved.clientRequestId),text(saved.adaptedRequestDigest));
  const mapped=await storyboardFrameRequest(captured,index,request);
  if(saved.requestDigest!==mapped.attempt.requestDigest||saved.model!==request.contract.model||frame.provider_submission_id!==saved.clientRequestId)return fail();
  const frameCall=claim(text(saved.stage),saved.clientRequestId,saved.requestDigest,"fal",request.contract.model,frame.provider_request_id);
  if(frame.cost_microusd!==frameCall.used_microusd)return fail();
  const retainedLifetime=retainedRead?{...lifetime,deadlineMs:Math.min(lifetime.deadlineMs??Infinity,Date.parse(job.expires_at),...assertions.flatMap(a=>a.deadlineMs===undefined?[]:[a.deadlineMs]))}:lifetime;
  diagnosticStage="completion_media";
  media.push(await readOutputStoryboardFrameMedia(env,scope.actorUserId,artifactId,index,frame as unknown as StoryboardFrameMedia,captured.bindingSha256,retainedLifetime));
 }
 assertions.push({sql:"(SELECT COUNT(*) FROM output_provider_calls WHERE scope_key=? AND slot_id=?)=5",bindings:[scope.key,slot.slotId]});
 return {assertions,receipt:{version:"output-storyboard-completion-v1",contract:execution.contract,jobId:job.job_id,slotId:slot.slotId,artifactId,
  actorUserId:scope.actorUserId,documentId:scope.documentId,streamId:job.stream_id,correlationId:job.correlation_id,attempt:job.attempt_count,
  grantId:slot.grantId,targetId:slot.targetId,planRevisionId:slot.planRevisionId,targetContractDigest:slot.targetContractDigest,
  sourceDigest:slot.sourceDigest,plannerRequestDigest:prepared.requestDigest,plannerResponseId:captured.plannerResponseId,planSha256:captured.planSha256,storyboardBindingSha256:captured.bindingSha256,
  frameCount:4,frames:media,providerCallCount:5,visualReview:"required"}};
 }catch(error){if(retainedRead)recordStoryboardReadFailure(error,diagnosticStage);throw error;}
}

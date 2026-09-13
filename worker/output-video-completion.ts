import { canonicalJson } from "../src/experiences/compiler.ts";
import { parseDocumentArtifactContent } from "../src/model/document-artifacts.ts";
import { providerSubmissions, invalidProviderSubmissions } from "../src/model/provider-submission.ts";
import { readVideoPlannerExecution, captureVideoPlannerRequest } from "./output-video-planner.ts";
import { videoPlannerEnvelopeText, type VideoPlannerRawEnvelope } from "./output-video-planner-envelope.ts";
import { captureOutputVideoAttempt, OUTPUT_VIDEO_TRANSPORT, outputVideoMediaPrice } from "./output-video-execution.ts";
import { readOpenAITextUsage, priceCurrentOpenAITextUsage } from "./openai-text-cost.ts";
import { readOutputVideoMedia, type OutputVideoMediaResult } from "./output-video-media.ts";
import type { WorkerEnv } from "./runtime.ts";
import type { DocumentJobRow } from "./document-jobs-api.ts";
import type { OutputScope, OutputOperationSlot, OutputSqlAssertion } from "./output-requirements-ledger.ts";
function fail(): never { throw new Error("output_video_completion_invalid"); }
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:fail();
const text=(v:unknown):string=>typeof v==="string"&&v.length>0?v:fail();
const same=(a:unknown,b:unknown)=>a!==undefined&&b!==undefined&&canonicalJson(a)===canonicalJson(b);
const sha=async(raw:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(raw))),b=>b.toString(16).padStart(2,"0")).join("");
type EvidenceArgs=[env:WorkerEnv,scope:OutputScope,slot:OutputOperationSlot,job:DocumentJobRow,settings:Record<string,unknown>,artifactId:string,artifact:unknown,lifetime:{signal?:AbortSignal;deadlineMs:number}];
export const verifyOutputVideoCompletion=(...args:EvidenceArgs)=>videoEvidence(false,...args);
export const readOutputVideoCompletion=(...args:EvidenceArgs)=>videoEvidence(true,...args);
export const verifyOutputVideoRecoveryCompletion=(recovery:{token:string;expiresAt:string},...args:EvidenceArgs)=>videoEvidence(recovery,...args);
async function videoEvidence(mode:boolean|{token:string;expiresAt:string},env:WorkerEnv,scope:OutputScope,slot:OutputOperationSlot,job:DocumentJobRow,settings:Record<string,unknown>,artifactId:string,artifact:unknown,lifetime:{signal?:AbortSignal;deadlineMs:number}){
 const retainedRead=mode===true,recovery=typeof mode==="object"?mode:null;
 const execution=readVideoPlannerExecution(settings.outputVideoPlanner);
 if(!execution||!same(execution.contract,settings.outputVideo)||scope.kind!=="personal"||scope.actorUserId!==scope.ownerUserId||scope.contextId||scope.organizationId||scope.projectAccessId
  ||job.owner_id!==scope.actorUserId||job.document_id!==scope.documentId||job.stream_id!==`creative:${scope.ownerUserId}`||job.kind!=="render_document"
  ||job.output_slot_id!==slot.slotId||slot.jobId!==job.job_id||slot.attemptOrdinal!==0||slot.previousSlotId!==null)fail();
 const assertions:OutputSqlAssertion[]=[];
 const current:OutputSqlAssertion={sql:`EXISTS(SELECT 1 FROM document_jobs job JOIN output_operation_slots slot ON slot.job_id=job.job_id WHERE job.job_id=? AND job.owner_id=?
  AND job.stream_id=? AND job.document_id=? AND job.correlation_id=? AND job.attempt_count=? AND job.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
  AND ${retainedRead?"job.status='completed' AND slot.status='succeeded'":recovery?"job.status='failed' AND (job.lease_expires_at IS NULL OR job.lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')) AND slot.status IN('uncertain','failed')":"job.status IN('running','committing') AND job.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND slot.status IN('queued','running')"}
  AND slot.scope_key=? AND slot.slot_id=? AND slot.grant_id=? AND slot.route_digest=? AND slot.source_digest=?)`,bindings:[job.job_id,scope.actorUserId,job.stream_id,scope.documentId,job.correlation_id,job.attempt_count,scope.key,slot.slotId,slot.grantId,slot.routeDigest,slot.sourceDigest]};
 if(recovery){
  if(typeof recovery.token!=="string"||!/^[a-f0-9-]{36}$/u.test(recovery.token)||!Number.isFinite(Date.parse(recovery.expiresAt))||Date.parse(recovery.expiresAt)<=Date.now())fail();
  const lease={sql:"EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND owner_id=? AND status='failed' AND json_extract(result_json,'$.outputVideoRecovery.token')=? AND json_extract(result_json,'$.outputVideoRecovery.expiresAt')=? AND ?>strftime('%Y-%m-%dT%H:%M:%fZ','now'))",bindings:[job.job_id,scope.actorUserId,recovery.token,recovery.expiresAt,recovery.expiresAt],deadlineMs:Date.parse(recovery.expiresAt)};
  if(!await env.DB.prepare("SELECT 1 WHERE "+lease.sql).bind(...lease.bindings).first())fail();assertions.push(lease);
 }
 if(!await env.DB.prepare(`SELECT 1 AS current WHERE ${current.sql}`).bind(...current.bindings!).first())fail();assertions.push(current);
 const row=await env.DB.prepare("SELECT result_json FROM document_jobs WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=?").bind(job.job_id,scope.actorUserId,job.stream_id,job.correlation_id).first<{result_json:string}>();
 if(!row||new TextEncoder().encode(row.result_json).length>1048576)fail();
 const cp=object(JSON.parse(row.result_json)),planner=object(cp.outputVideoPlannerCheckpoint),plannerEnvelope=object(cp.outputVideoPlannerEnvelope),mediaRequest=object(cp.outputVideoMediaCheckpoint),mediaResult=object(cp.outputVideoMediaResult);
 if(cp.artifactId!==artifactId||!same(cp.artifactPlan,artifact)||cp.providerSubmissionProtocol!==1||invalidProviderSubmissions(cp)
  ||cp.providerSubmissionLegacyUncertain!==undefined&&cp.providerSubmissionLegacyUncertain!==false||!Array.isArray(cp.outputVideoMediaEnvelopes))fail();
 for(const key of [...(recovery||retainedRead&&Object.hasOwn(cp,"outputVideoRecovery")?["outputVideoRecovery",...(Object.hasOwn(cp,"outputVideoRecoveryEnvelopes")?["outputVideoRecoveryEnvelopes"]:[])]:[]),"artifactId","artifactPlan","outputVideoPlannerCheckpoint","outputVideoPlannerEnvelope","outputVideoMediaCheckpoint","outputVideoMediaResult","outputVideoMediaEnvelopes","providerSubmissionProtocol","providerSubmissions","plannerResponseId"]){
  assertions.push({sql:"EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND owner_id=? AND json_extract(result_json,?)=json_extract(?,'$') AND json_type(result_json,?)=json_type(?,'$'))",bindings:[job.job_id,scope.actorUserId,'$.'+key,JSON.stringify(cp[key]),'$.'+key,JSON.stringify(cp[key])]});
 }
 async function retained(ref:unknown,kind:string){
  const id=text(ref),predicate="content_id=? AND owner_id=? AND kind=? AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND length(CAST(content AS BLOB))<=1048576 AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=private_content.content_id)";
  const body=await env.DB.prepare(`SELECT content,expires_at FROM private_content WHERE ${predicate}`).bind(id,scope.actorUserId,kind).first<{content:string;expires_at:string}>();
  if(!body)fail();assertions.push({sql:`EXISTS(SELECT 1 FROM private_content WHERE ${predicate} AND content=? AND expires_at=?)`,bindings:[id,scope.actorUserId,kind,body.content,body.expires_at],deadlineMs:Date.parse(body.expires_at)});return body.content;
 }
 const prepared=await captureVideoPlannerRequest(execution.contract,await retained(planner.requestRef,"prompt"),text(planner.clientRequestId));
 if(planner.version!=="output-video-request-checkpoint-v1"||planner.stage!=="planning:0:initial"||planner.provider!=="openai"||planner.model!==prepared.attempt.model||!same(planner.contract,execution.contract)
  ||planner.requestDigest!==prepared.requestDigest||execution.requestDigest!==prepared.requestDigest||execution.maximumInputTokens!==prepared.maximumInputTokens)fail();
 const originalEnvelope=await retained(plannerEnvelope.responseRef,"provider-response");
 if(await sha(originalEnvelope)!==plannerEnvelope.envelopeSha256)fail();
 const raw=object(JSON.parse(originalEnvelope));
 if(raw.version!=="output-video-planner-envelope-v1"||raw.provider!=="openai"||raw.model!==planner.model||raw.clientRequestId!==planner.clientRequestId||raw.requestDigest!==planner.requestDigest||raw.httpStatus!==200||raw.complete!==true||raw.readFailed!==false)fail();
 const response=object(JSON.parse(videoPlannerEnvelopeText(raw as unknown as VideoPlannerRawEnvelope))),outputs=response.output;
 if(response.status!=="completed"||response.model!==planner.model||response.incomplete_details||!Array.isArray(outputs))fail();
 const entries=outputs.map(object);
 if(entries.some(item=>{
  if(item.type!=="reasoning")return item.type!=="message";
  return Object.keys(item).some(key=>!["id","type","status","summary"].includes(key))||typeof item.id!=="string"||!Array.isArray(item.summary)||item.summary.some(part=>{const value=object(part);return value.type!=="summary_text"||typeof value.text!=="string";});
 }))fail();
 const messages=entries.filter(value=>value.type==='message');
 if(messages.length!==1||messages[0]!.role!=="assistant"||messages[0]!.status!=="completed"||!Array.isArray(messages[0]!.content)||messages[0]!.content.length!==1)fail();
 const content=object(messages[0]!.content[0]);if(content.type!=="output_text"||response.output_text!==undefined&&response.output_text!==content.text)fail();
 const plan=parseDocumentArtifactContent(text(content.text));
 if(!plan||plan.items.length!==1||plan.presentation||plan.audio_revision||plan.video_revision||plan.model3d_revision||!same(plan,artifact)||response.id!==cp.plannerResponseId)fail();
 const media=await captureOutputVideoAttempt(execution.contract,await retained(mediaRequest.requestRef,"prompt"),text(mediaRequest.clientRequestId));
 if(mediaRequest.version!=="output-video-request-checkpoint-v1"||mediaRequest.stage!=="video:initial"||mediaRequest.provider!=="fal"||mediaRequest.model!==media.model||mediaRequest.requestDigest!==media.requestDigest||!same(mediaRequest.contract,execution.contract)
  ||mediaResult.artifactId!==artifactId||mediaResult.clientRequestId!==media.clientRequestId||mediaResult.requestDigest!==media.requestDigest||mediaResult.model!==media.model)fail();
 let envelopes=cp.outputVideoMediaEnvelopes.map(object);
 if(recovery||retainedRead&&Object.hasOwn(cp,"outputVideoRecovery")){
  const saved=object(cp.outputVideoRecovery),history=cp.outputVideoRecoveryEnvelopes;
  if(saved.version!=="output-video-recovery-v1"||saved.clientRequestId!==media.clientRequestId||saved.requestDigest!==media.requestDigest||saved.providerRequestId!==mediaResult.providerRequestId
   ||recovery&&saved.token!==recovery.token||retainedRead&&saved.status!=="completed"||!["original","retrieved"].includes(String(saved.evidenceMode))||!envelopes.length)fail();
  if(saved.evidenceMode==="retrieved"){
   if(!Array.isArray(history)||history.length>64)fail();
   const decisive=history.map(object).filter(value=>value.token===(saved.evidenceToken??saved.token));
   if(decisive.length!==2||decisive[0]!.phase!=="status"||decisive[1]!.phase!=="result")fail();
   envelopes=[envelopes[0]!,...decisive];
  }
 }
 if(envelopes.length<3||envelopes.length>OUTPUT_VIDEO_TRANSPORT.maximumStatusReads+2||envelopes[0]!.phase!=="submission"||envelopes.at(-1)!.phase!=="result"||envelopes.slice(1,-1).some(value=>value.phase!=="status"))fail();
 const providerId=text(mediaResult.providerRequestId);if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/u.test(providerId)||["pending","submitted","unknown"].includes(providerId.toLowerCase()))fail();const base=`https://queue.fal.run/bytedance/seedance-2.0/requests/${providerId}`;
 // The decisive original submit/completed-status/result are sufficient for the
 // completion proof; intermediate polls remain private audit history, not inputs.
 for(const index of [0,envelopes.length-2,envelopes.length-1]){
  const saved=envelopes[index]!,body=await retained(saved.responseRef,"provider-response");if(await sha(body)!==saved.envelopeSha256)fail();
  const envelope=object(JSON.parse(body));
  if(envelope.clientRequestId!==media.clientRequestId||envelope.requestDigest!==media.requestDigest||envelope.phase!==saved.phase||envelope.httpStatus!==200
   ||envelope.schemaVersion!==1||!Number.isSafeInteger(envelope.decodedByteLength)||Number(envelope.decodedByteLength)>OUTPUT_VIDEO_TRANSPORT.maximumEnvelopeBytes||!Array.isArray(envelope.headers))fail();
  const binary=atob(text(envelope.decodedBodyBase64)),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),b=>b.toString(16).padStart(2,"0")).join("");
  if(bytes.length!==envelope.decodedByteLength||digest!==envelope.decodedBodySha256||saved.decodedBodySha256!==digest
   ||envelope.headers.some(value=>!Array.isArray(value)||value.length!==2||value[0]==="x-fal-request-id"&&value[1]!==providerId))fail();
  const parsed=object(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)));
  if(parsed.request_id!==undefined&&parsed.request_id!==providerId)fail();
  if(index===0){if(envelope.requestUrl!==`https://queue.fal.run/${media.model}`||envelope.providerRequestId!==null||parsed.request_id!==providerId)fail();}
  else if(index===envelopes.length-2){if(envelope.requestUrl!==base+"/status"||envelope.providerRequestId!==providerId||parsed.status!=="COMPLETED")fail();}
  else{const data=parsed.data===undefined?{}:object(parsed.data);if(envelope.requestUrl!==base||envelope.providerRequestId!==providerId||data.request_id!==undefined&&data.request_id!==providerId||parsed.video!==undefined&&data.video!==undefined)fail();
   const video=object(parsed.video??data.video),url=new URL(text(video.url));
   if(video.request_id!==undefined&&video.request_id!==providerId||url.protocol!=="https:"||url.username||url.password||url.port||url.hash||url.hostname!=="fal.media"&&!url.hostname.endsWith(".fal.media")||video.content_type!==undefined&&video.content_type!=="video/mp4"||video.file_size!==undefined&&video.file_size!==mediaResult.byteLength)fail();}
 }
 const calls=(await env.DB.prepare("SELECT call_key,stage_key,provider,model,client_request_id,request_digest,status,used_microusd,provider_response_id FROM output_provider_calls WHERE scope_key=? AND slot_id=? ORDER BY call_key").bind(scope.key,slot.slotId).all<Record<string,unknown>>()).results;
 const receipts=providerSubmissions(cp);if(calls.length!==2||receipts.length!==2||new Set(calls.map(c=>c.client_request_id)).size!==2)fail();
 const usage=readOpenAITextUsage(response.usage,{cachePolicy:"disabled-explicit"}),planningCost=priceCurrentOpenAITextUsage(prepared.attempt.model,usage,typeof response.service_tier==="string"?response.service_tier:"default").totalMicrousd;
 for(const [index,attempt] of [prepared.attempt,media].entries()){
  const call=calls.find(call=>call.call_key===attempt.logicalCallKey),receipt=receipts.find(r=>r.clientRequestId===attempt.clientRequestId),provider=index===0?"openai":"fal",responseId=index===0?response.id:providerId,cost=index===0?planningCost:outputVideoMediaPrice().maximumMicrousd;
  if(!call||!receipt||call.stage_key!==attempt.logicalCallKey||call.provider!==provider||call.model!==attempt.model||call.client_request_id!==attempt.clientRequestId||call.request_digest!==attempt.requestDigest||call.provider_response_id!==responseId||call.status!=="settled"||call.used_microusd!==cost
   ||receipt.status!=="completed"||receipt.operation!==(index===0?"planning":"video")||receipt.provider!==provider||receipt.model!==attempt.model||receipt.providerRequestId!==responseId||receipt.costMicrousd!==cost||receipt.totalTokens!==(index===0?usage.totalTokens:0)||index===0&&(receipt.inputTokens!==usage.inputTokens||receipt.outputTokens!==usage.outputTokens))fail();
  assertions.push({sql:"EXISTS(SELECT 1 FROM output_provider_calls WHERE scope_key=? AND slot_id=? AND call_key=? AND stage_key=? AND provider=? AND model=? AND client_request_id=? AND request_digest=? AND provider_response_id=? AND status='settled' AND used_microusd=?)",bindings:[scope.key,slot.slotId,attempt.logicalCallKey!,attempt.logicalCallKey!,provider,attempt.model,attempt.clientRequestId,attempt.requestDigest!,text(responseId),cost]});
 }
 assertions.push({sql:"(SELECT COUNT(*) FROM output_provider_calls WHERE scope_key=? AND slot_id=?)=2",bindings:[scope.key,slot.slotId]});
 assertions.push({sql:"EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND owner_id=? AND COALESCE(json_type(result_json,'$.providerSubmissionLegacyUncertain'),'missing')=? AND COALESCE(json_extract(result_json,'$.providerSubmissionLegacyUncertain'),0)=0)",bindings:[job.job_id,scope.actorUserId,Object.hasOwn(cp,"providerSubmissionLegacyUncertain")?"false":"missing"]});
 const deadlineMs=Math.min(lifetime.deadlineMs,Date.parse(job.expires_at),...assertions.flatMap(a=>a.deadlineMs===undefined?[]:[a.deadlineMs]));
 const inspected=await readOutputVideoMedia(env,scope.actorUserId,execution.contract,mediaResult as OutputVideoMediaResult,{...lifetime,deadlineMs});
 return{assertions,inspection:inspected.inspection,bytes:inspected.bytes,receipt:{version:"output-video-completion-v1",contract:execution.contract,jobId:job.job_id,slotId:slot.slotId,artifactId,actorUserId:scope.actorUserId,documentId:scope.documentId,streamId:job.stream_id,correlationId:job.correlation_id,attempt:job.attempt_count,
  grantId:slot.grantId,targetId:slot.targetId,planRevisionId:slot.planRevisionId,targetContractDigest:slot.targetContractDigest,sourceDigest:slot.sourceDigest,
  plannerRequestDigest:prepared.requestDigest,plannerResponseId:response.id,planSha256:await sha(JSON.stringify(plan)),providerCallCount:2,media:inspected.media,visualReview:"required"}};
}

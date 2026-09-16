import { ownerMediaNamespace } from "../src/model/media-ownership.ts";
import { captureBoundedVideoEnvelope } from "./output-video-envelope-bound.ts";
import { canonicalJson, jsonIssues } from "../src/experiences/compiler.ts";
import { parseVideoOutputContract } from "../src/model/output-video-contract.ts";
import { captureOutputVideoAttempt, OUTPUT_VIDEO_TRANSPORT, type OutputVideoRawEnvelope, type OutputVideoHookLease } from "./output-video-execution.ts";
import { preparePrivateContent } from "./private-content-storage.ts";
import { outputAssertionStatements, OutputConflictError, type OutputScope, type OutputOperationSlot, type OutputSqlAssertion } from "./output-requirements-ledger.ts";
import type { DocumentJobRow } from "./document-jobs-api.ts";
import type { WorkerEnv } from "./runtime.ts";

const object=(v:unknown):Record<string,unknown>=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:{};
const sha=async(v:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v))),b=>b.toString(16).padStart(2,"0")).join("");
function reject():never{throw new OutputConflictError("output_video_recovery_unavailable",409);}

/** Read/publication custody for one failed original. Never changes job status,
 * extends the original expiry, claims a provider call, or issues a request. The
 * caller supplies current authorized source/rights assertions, not an old offer. */
export async function claimOutputVideoRecoveryLease(env:WorkerEnv,scope:OutputScope,slot:OutputOperationSlot,job:DocumentJobRow,
 options:{assertions:OutputSqlAssertion[];signal?:AbortSignal}){
 const request=object(JSON.parse(job.request_json)),cp=object(JSON.parse(job.result_json??"{}")),checkpoint=object(cp.outputVideoMediaCheckpoint),planner=object(cp.outputVideoPlannerCheckpoint);
 const contract=parseVideoOutputContract(request.outputVideo),execution=object(cp.outputExecution);
 const reference={scopeKey:scope.key,grantId:slot.grantId,slotId:slot.slotId,planRevisionId:slot.planRevisionId,targetId:slot.targetId,targetContractDigest:slot.targetContractDigest,sourceDigest:slot.sourceDigest};
 if(!contract||request.artifactKind!=="video"||request.productionMode!=="manual"||request.itemCount!==1
  ||scope.kind!=="personal"||scope.actorUserId!==scope.ownerUserId||scope.contextId||scope.organizationId||scope.projectAccessId||!options.assertions.length
  ||job.kind!=="render_document"||job.source_surface!=="outputs"||job.status!=="failed"||job.owner_id!==scope.actorUserId||job.stream_id!==`creative:${scope.ownerUserId}`||job.document_id!==scope.documentId
  ||slot.jobId!==job.job_id||slot.scopeKey!==scope.key||slot.slotId!==job.output_slot_id||slot.attemptOrdinal!==0||slot.previousSlotId!==null
  ||execution.scopeKey!==scope.key||execution.slotId!==slot.slotId||execution.grantId!==slot.grantId
  // Admission stores its reference in the checkpoint. A request-side legacy
  // duplicate may agree but cannot supply, replace or override that authority.
  ||canonicalJson(execution)!==canonicalJson(reference)
  ||Object.hasOwn(request,"outputExecution")&&canonicalJson(request.outputExecution)!==canonicalJson(reference)
  ||checkpoint.version!=="output-video-request-checkpoint-v1"||checkpoint.stage!=="video:initial"||checkpoint.provider!=="fal"
  ||planner.stage!=="planning:0:initial"||planner.provider!=="openai"||typeof planner.clientRequestId!=="string"||typeof planner.requestDigest!=="string"
  ||typeof cp.artifactId!=="string"||!cp.artifactId||typeof cp.plannerResponseId!=="string"||!cp.plannerResponseId
  ||typeof checkpoint.requestRef!=="string"||typeof checkpoint.clientRequestId!=="string"||typeof checkpoint.requestDigest!=="string"
  ||canonicalJson(checkpoint.contract)!==canonicalJson(contract)||Object.hasOwn(cp,"outputVideoStop")||options.signal?.aborted)reject();
 const deadlineMs=Math.min(Date.now()+120_000,Date.parse(job.expires_at),...options.assertions.flatMap(a=>a.deadlineMs===undefined?[]:[a.deadlineMs]));
 if(!Number.isFinite(deadlineMs)||deadlineMs<=Date.now())reject();
 const token=crypto.randomUUID(),expiresAt=new Date(deadlineMs).toISOString();
 // Exact immutable checkpoints, original plan and call identities remain fixed.
 // The recovery lease/history are separate fields; no original history rewrite.
 const originalKeys=["artifactId","artifactPlan","plannerResponseId","outputExecution","outputVideoPlannerCheckpoint","outputVideoPlannerEnvelope","outputVideoMediaCheckpoint","outputVideoMediaEnvelopes"];
 if(originalKeys.some(key=>cp[key]===undefined)||jsonIssues(cp).length)reject();
 const originals=originalKeys.map(key=>({sql:"EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND json_extract(result_json,?) IS json_extract(?,'$') AND json_type(result_json,?)=json_type(?,'$'))",bindings:[job.job_id,"$."+key,JSON.stringify(cp[key]),"$."+key,JSON.stringify(cp[key])]}));
 const identity:OutputSqlAssertion={sql:`EXISTS(SELECT 1 FROM document_jobs job
  JOIN output_operation_slots slot ON slot.job_id=job.job_id
  JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
  JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id
  WHERE job.job_id=? AND job.owner_id=? AND job.stream_id=? AND job.document_id=? AND job.correlation_id=? AND job.kind='render_document'
   AND job.status='failed' AND job.source_surface='outputs' AND job.request_json=? AND job.attempt_count=? AND job.expires_at=? AND job.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
   AND (job.lease_expires_at IS NULL OR job.lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')) AND json_type(job.result_json,'$.outputVideoStop') IS NULL
   AND slot.scope_key=? AND slot.slot_id=? AND slot.grant_id=? AND slot.plan_revision_id=? AND slot.target_id=? AND slot.target_contract_digest=? AND slot.source_digest=? AND slot.route_digest=?
   AND slot.attempt_ordinal=0 AND slot.previous_slot_id IS NULL AND slot.status IN('uncertain','failed')
   AND plan.scope_kind='personal' AND plan.owner_user_id=job.owner_id AND plan.document_id=job.document_id AND plan.organization_id IS NULL AND plan.project_access_id IS NULL
   AND grant_row.actor_user_id=job.owner_id AND grant_row.context_id IS NULL AND grant_row.status IN('authorized','active','completed')
   AND (SELECT COUNT(*) FROM output_operation_slots siblings WHERE siblings.scope_key=slot.scope_key AND siblings.grant_id=slot.grant_id)=1
   AND NOT EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind IN('job','document') AND resource.resource_id IN(job.job_id,job.document_id))
   AND NOT EXISTS(SELECT 1 FROM document_jobs other WHERE other.stream_id=job.stream_id AND other.document_id=job.document_id AND other.job_id<>job.job_id AND other.status IN('running','committing') AND other.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
  bindings:[job.job_id,scope.actorUserId,job.stream_id,job.document_id,job.correlation_id,job.request_json,job.attempt_count,job.expires_at,scope.key,slot.slotId,slot.grantId,slot.planRevisionId,slot.targetId,slot.targetContractDigest,slot.sourceDigest,slot.routeDigest]};
 const assertions:OutputSqlAssertion[]=[...options.assertions,...originals,identity,{sql:"?>strftime('%Y-%m-%dT%H:%M:%fZ','now')",bindings:[expiresAt],deadlineMs}];
 const query=async<T extends Record<string,unknown>>(statement:D1PreparedStatement,extra:OutputSqlAssertion[]=[])=>{
  options.signal?.throwIfAborted();const result=await env.DB.batch<T>([...[...assertions,...extra].flatMap(a=>outputAssertionStatements(env,a)),statement]);options.signal?.throwIfAborted();return result.at(-1)!.results;
 };
 const rows=await query<{content:string;expires_at:string}>(env.DB.prepare(`SELECT content,expires_at FROM private_content WHERE content_id=? AND owner_id=? AND kind='prompt' AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
  AND length(CAST(content AS BLOB))<=1048576 AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=private_content.content_id)`).bind(checkpoint.requestRef,scope.actorUserId));
 if(rows.length!==1)reject();const raw=rows[0]!;
 const attempt=await captureOutputVideoAttempt(contract,raw.content,checkpoint.clientRequestId);
 if(attempt.requestDigest!==checkpoint.requestDigest||attempt.model!==checkpoint.model)reject();
 const calls=await query(env.DB.prepare("SELECT * FROM output_provider_calls WHERE scope_key=? AND slot_id=?").bind(scope.key,slot.slotId));
 const media=calls.find(c=>c.call_key==="video:initial"),planned=calls.find(c=>c.call_key==="planning:0:initial");
 if(calls.length!==2||!media||!planned||media.stage_key!=="video:initial"||media.provider!=="fal"||media.model!==attempt.model||media.client_request_id!==attempt.clientRequestId||media.request_digest!==attempt.requestDigest
  ||!["uncertain","settled"].includes(String(media.status))||typeof media.provider_response_id!=="string"||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/u.test(media.provider_response_id)
  ||["pending","unknown","submitted"].includes(media.provider_response_id.toLowerCase())||planned.stage_key!=="planning:0:initial"||planned.provider!=="openai"||planned.status!=="settled"
  ||planned.client_request_id!==planner.clientRequestId||planned.request_digest!==planner.requestDigest||planned.model!==planner.model||planned.provider_response_id!==cp.plannerResponseId)reject();
 const providerRequestId=media.provider_response_id;
 assertions.push({sql:"EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind='prompt' AND content=? AND expires_at=? AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=private_content.content_id))",bindings:[checkpoint.requestRef,scope.actorUserId,raw.content,raw.expires_at]},
  {sql:`EXISTS(SELECT 1 FROM output_provider_calls WHERE scope_key=? AND slot_id=? AND call_key='video:initial' AND stage_key='video:initial' AND provider='fal' AND model=? AND client_request_id=? AND request_digest=? AND provider_response_id=? AND status IN('uncertain','settled'))
   AND (SELECT COUNT(*) FROM output_provider_calls WHERE scope_key=? AND slot_id=?)=2`,bindings:[scope.key,slot.slotId,attempt.model,attempt.clientRequestId,attempt.requestDigest!,providerRequestId,scope.key,slot.slotId]});
 assertions.push({sql:"EXISTS(SELECT 1 FROM output_provider_calls WHERE scope_key=? AND slot_id=? AND call_key='planning:0:initial' AND stage_key='planning:0:initial' AND provider='openai' AND model=? AND client_request_id=? AND request_digest=? AND provider_response_id=? AND status='settled' AND used_microusd IS ?)",bindings:[scope.key,slot.slotId,String(planned.model),String(planned.client_request_id),String(planned.request_digest),String(planned.provider_response_id),typeof planned.used_microusd==="number"?planned.used_microusd:null]});
 const priorRecovery=object(cp.outputVideoRecovery),priorToken=priorRecovery.evidenceToken??priorRecovery.token;
 const priorHistory=Array.isArray(cp.outputVideoRecoveryEnvelopes)?cp.outputVideoRecoveryEnvelopes.map(object).filter(value=>value.token===priorToken):[];
 const priorEvidence=priorRecovery.evidenceMode==="retrieved"&&typeof priorToken==="string"&&priorHistory.length===2&&priorHistory[0]!.phase==="status"&&priorHistory[1]!.phase==="result";
 const lease={version:"output-video-recovery-v1",token,expiresAt,evidenceMode:priorEvidence?"retrieved":"original",...(priorEvidence?{evidenceToken:priorToken}:{}),storageKey:`${ownerMediaNamespace(scope.ownerUserId)}/generated/${cp.artifactId}.mp4`,providerRequestId,clientRequestId:attempt.clientRequestId,requestDigest:attempt.requestDigest,priorStatus:job.status,priorErrorCode:job.error_message,priorCompletedAt:job.completed_at};
 await env.DB.batch([...assertions.flatMap(a=>outputAssertionStatements(env,a)),env.DB.prepare(`UPDATE document_jobs SET result_json=json_set(result_json,'$.outputVideoRecovery',json(?)) WHERE job_id=? AND owner_id=? AND result_json IS ?
  AND (json_type(result_json,'$.outputVideoRecovery') IS NULL OR json_extract(result_json,'$.outputVideoRecovery.status')='completed' OR json_extract(result_json,'$.outputVideoRecovery.expiresAt')<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))`).bind(JSON.stringify(lease),job.job_id,scope.actorUserId,job.result_json),...outputAssertionStatements(env,{sql:"changes()=1"})]);
 const leaseAssertion:OutputSqlAssertion={sql:"EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND owner_id=? AND status='failed' AND json_extract(result_json,'$.outputVideoRecovery.token')=? AND json_extract(result_json,'$.outputVideoRecovery.expiresAt')=? AND ?>strftime('%Y-%m-%dT%H:%M:%fZ','now'))",bindings:[job.job_id,scope.actorUserId,token,expiresAt,expiresAt],deadlineMs};
 const live=()=>[...assertions,leaseAssertion];
 const assertCurrent=async()=>{options.signal?.throwIfAborted();await env.DB.batch(live().flatMap(a=>outputAssertionStatements(env,a)));options.signal?.throwIfAborted();};
 let retainedCount=0;
 return Object.freeze({token,expiresAt,deadlineMs,lease,attempt,providerRequestId,requestBody:raw.content,contract,assertions:live,assertCurrent,
  async retainEnvelope(incoming:OutputVideoRawEnvelope,hook:OutputVideoHookLease){
   hook.assertCurrent();await assertCurrent();
   const value=captureBoundedVideoEnvelope(incoming,"decodedBodyBase64",OUTPUT_VIDEO_TRANSPORT.maximumEnvelopeBytes,reject);
   if(value.schemaVersion!==1||!["status","result"].includes(value.phase)||retainedCount>=2
    ||value.clientRequestId!==attempt.clientRequestId||value.requestDigest!==attempt.requestDigest||value.providerRequestId!==providerRequestId
    ||value.requestUrl!==`https://queue.fal.run/bytedance/seedance-2.0/requests/${providerRequestId}`+(value.phase==="status"?"/status":"")
    ||!Number.isSafeInteger(value.decodedByteLength)||value.decodedByteLength<0||value.decodedByteLength>OUTPUT_VIDEO_TRANSPORT.maximumEnvelopeBytes
    ||typeof value.decodedBodyBase64!=="string"||value.decodedBodyBase64.length>Math.ceil(OUTPUT_VIDEO_TRANSPORT.maximumEnvelopeBytes/3)*4
    ||!Number.isSafeInteger(value.httpStatus)||value.httpStatus<200||value.httpStatus>599
    ||!Array.isArray(value.headers)||value.headers.length>5||value.headers.some(p=>!Array.isArray(p)||p.length!==2||!["content-type","content-length","content-encoding","x-fal-request-id","date"].includes(p[0])||typeof p[1]!=="string")
    ||value.headers.reduce((n,p)=>n+p[0].length+p[1].length,0)>32768)reject();
   const body=atob(value.decodedBodyBase64),bytes=Uint8Array.from(body,c=>c.charCodeAt(0));
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),b=>b.toString(16).padStart(2,"0")).join("");
   if(btoa(body)!==value.decodedBodyBase64||bytes.length!==value.decodedByteLength||hash!==value.decodedBodySha256)reject();
   const text=JSON.stringify(value),prepared=await preparePrivateContent(env,scope.actorUserId,"provider-response",text);hook.assertCurrent();await assertCurrent();
   if(prepared.requiredInserts!==1)reject();
   const saved={version:"output-video-recovery-envelope-v1",token,phase:value.phase,responseRef:prepared.contentId,envelopeSha256:await sha(text),decodedBodySha256:hash,expiresAt:[prepared.expiresAt,job.expires_at].sort()[0]};
   const bounds:OutputSqlAssertion={sql:`EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND COALESCE(json_array_length(result_json,'$.outputVideoRecoveryEnvelopes'),0)<64
    AND (SELECT COUNT(*) FROM json_each(COALESCE(json_extract(result_json,'$.outputVideoRecoveryEnvelopes'),'[]')) WHERE json_extract(value,'$.token')=?)=?)`,bindings:[job.job_id,token,retainedCount]};
   hook.assertCurrent();
   await env.DB.batch([...live(),bounds,{sql:"?>strftime('%Y-%m-%dT%H:%M:%fZ','now')",bindings:[new Date(Math.min(deadlineMs,hook.deadlineMs)).toISOString()]}].flatMap(a=>outputAssertionStatements(env,a)).concat(prepared.statements.slice(0,1),[
    env.DB.prepare("UPDATE document_jobs SET result_json=json_insert(json_set(result_json,'$.outputVideoRecovery.evidenceMode','retrieved','$.outputVideoRecovery.evidenceToken',?,'$.outputVideoRecoveryEnvelopes',json(COALESCE(json_extract(result_json,'$.outputVideoRecoveryEnvelopes'),'[]'))),'$.outputVideoRecoveryEnvelopes[#]',json(?)) WHERE job_id=? AND owner_id=?").bind(token,JSON.stringify(saved),job.job_id,scope.actorUserId),
   ]));retainedCount++;hook.assertCurrent();return saved;
  },
  async release(){await env.DB.prepare("UPDATE document_jobs SET result_json=json_set(result_json,'$.outputVideoRecovery.expiresAt',?) WHERE job_id=? AND owner_id=? AND status='failed' AND json_extract(result_json,'$.outputVideoRecovery.token')=?").bind(new Date().toISOString(),job.job_id,scope.actorUserId,token).run();},
 });
}

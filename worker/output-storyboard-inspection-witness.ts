import { captureStoryboardPlannerRequest, readStoryboardPlannerExecution } from "./output-storyboard-request.ts";
import type { WorkerEnv } from "./runtime.ts";
import type { DocumentJobRow } from "./document-jobs-api.ts";
const record=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
/** Diagnostic-only original request; no lease, financial mutation or dispatch. */
export async function readStoryboardInspectionWitness(env:WorkerEnv,row:DocumentJobRow,call:{clientRequestId:string;providerRequestId?:string;requestDigest?:string;model:string}){
  try{
    const result=record(JSON.parse(row.result_json??"{}")),request=record(JSON.parse(row.request_json));
    const cp=record(result.outputStoryboardPlannerCheckpoint),execution=readStoryboardPlannerExecution(request.outputStoryboardPlanner);
    if(!execution||!same(execution.contract,request.outputStoryboard)
      ||cp.version!=="output-storyboard-planner-checkpoint-v1"||cp.stage!=="planning:0:initial"||cp.provider!=="openai"
      ||cp.model!==call.model||cp.clientRequestId!==call.clientRequestId||cp.requestDigest!==call.requestDigest
      ||cp.requestDigest!==execution.requestDigest||!same(cp.contract,execution.contract)
      ||typeof cp.requestRef!=="string"||typeof cp.expiresAt!=="string"||!(Date.parse(cp.expiresAt)>Date.now()))return null;
    const sql=`content_id=? AND owner_id=? AND kind='prompt' AND redacted_at IS NULL
      AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND length(CAST(content AS BLOB))<=262144
      AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=private_content.content_id)`;
    const bindings=[cp.requestRef,row.owner_id];
    // GET may run on a cold worker whose readJob omitted its optional derived
    // slot column. Read the durable relation; never initialize schema or infer
    // a native slot from a client-provided identifier.
    const bodies=await env.DB.prepare(`SELECT content,expires_at,slot.scope_key,slot.slot_id FROM private_content
      JOIN output_operation_slots slot ON slot.job_id=? WHERE ${sql} LIMIT 2`).bind(row.job_id,...bindings).all<{content:string;expires_at:string;scope_key:string;slot_id:string}>();
    const body=bodies.results[0];
    if(bodies.results.length!==1||!body||row.output_slot_id&&row.output_slot_id!==body.slot_id)return null;
    const captured=await captureStoryboardPlannerRequest(execution.contract,body.content,call.clientRequestId);
    if(captured.requestDigest!==execution.requestDigest||captured.maximumInputTokens!==execution.maximumInputTokens
      ||!(Math.min(Date.parse(body.expires_at),Date.parse(cp.expiresAt))>Date.now()))return null;
    return{requestBody:body.content,deadlineMs:Math.min(Date.parse(body.expires_at),Date.parse(cp.expiresAt)),
      sql:`EXISTS(SELECT 1 FROM private_content WHERE ${sql} AND content=? AND expires_at=?) AND ?>strftime('%Y-%m-%dT%H:%M:%fZ','now')
        AND EXISTS(SELECT 1 FROM output_operation_slots WHERE scope_key=? AND slot_id=? AND job_id=?)`,
      bindings:[...bindings,body.content,body.expires_at,cp.expiresAt,body.scope_key,body.slot_id,row.job_id]};
  }catch{return null;}
}

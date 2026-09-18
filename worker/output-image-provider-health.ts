import { configuredImageHealthIdentity, prepareProviderSuccess } from "./generation-readiness.ts";
import { outputAssertionStatements } from "./output-command-core.ts";
import type { EventRow, WorkerEnv } from "./runtime.ts";
import type { PaidProviderSubmission } from "../src/model/provider-submission.ts";

type Claim={callKey:string;provider:string;model:string;operation:string;pending:boolean;dispatched:boolean;settled?:boolean;requestDigest:string};
type Input={
 job:{kind:string;job_id:string;stream_id:string;correlation_id:string;document_id:string|null;source_surface:string};
 slot:{scopeKey:string;slotId:string};
 events:EventRow[];
 routes:ReadonlyArray<{stage:string;provider:string;model:string}>;
 claimedCalls:ReadonlyMap<string,Claim>;
 observedReceipts:ReadonlyMap<string,PaidProviderSubmission>;
};
/** Only a newly dispatched, settled image call may clear the configured image health scope.
 * Inherited receipts and document completions never prove a new image-provider success. */
export function prepareOutputImageProviderHealth(env:WorkerEnv,input:Input):D1PreparedStatement[]{
 const {job,slot,events,routes,claimedCalls,observedReceipts}=input;
 if(job.kind!=="generate"||job.source_surface!=="outputs")return [];
 const completed=events.filter(event=>event.type==="GenerationCompleted");if(completed.length!==1)return [];
 const event=completed[0]!,payload=event.payload;
 if(event.actor!=="worker:generator"||event.streamId!==job.stream_id||event.correlationId!==job.correlation_id
  ||payload.document_id!==job.document_id||payload.source_surface!=="outputs"||payload.simulation!==false
  ||typeof payload.media_type!=="string"||!payload.media_type.startsWith("image/")
  ||typeof payload.source_content_hash!=="string"||!/^[a-f0-9]{64}$/u.test(payload.source_content_hash))return [];
 const clientId=payload.provider_submission_id,requestId=payload.provider_request_id;
 if(typeof clientId!=="string"||!clientId||typeof requestId!=="string"||!requestId.trim())return [];
 const call=claimedCalls.get(clientId),receipt=observedReceipts.get(clientId),selected=configuredImageHealthIdentity(env);
 const route=routes.find(route=>route.stage==="image:initial");
 if(!call||!receipt||!route||call.callKey!=="image:initial"||call.operation!=="image"||!call.pending||!call.dispatched||call.settled!==true
  ||!call.requestDigest||call.provider!==selected.provider||call.model!==selected.model
  ||route.provider!==call.provider||route.model!==call.model
  ||receipt.clientRequestId!==clientId||receipt.operation!=="image"||receipt.status!=="completed"
  ||receipt.provider!==call.provider||receipt.model!==call.model||receipt.providerRequestId!==requestId
  ||payload.provider!==call.provider||payload.model_id!==call.model
  ||!Number.isSafeInteger(receipt.costMicrousd)||Number(receipt.costMicrousd)<0)return [];
 return [...outputAssertionStatements(env,{sql:`EXISTS(SELECT 1 FROM output_provider_calls
  WHERE scope_key=? AND slot_id=? AND call_key='image:initial' AND client_request_id=? AND request_digest=?
   AND provider=? AND model=? AND status='settled' AND provider_response_id=? AND used_microusd=?)`,
  bindings:[slot.scopeKey,slot.slotId,clientId,call.requestDigest,call.provider,call.model,requestId,Number(receipt.costMicrousd)]}),
  prepareProviderSuccess(env,requestId).statement];
}

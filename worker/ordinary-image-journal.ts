import type { CreativeImageFinal } from './openai-adapter.ts';
import type { DocumentJobRow } from './document-jobs-api.ts';
import { mergeProviderSubmissions, providerSubmissions, type PaidProviderSubmission } from '../src/model/provider-submission.ts';
import { storeGeneratedImage, readGeneratedImageReference } from './media-api.ts';
import { loadPrivateContent, loadPrivateProviderResponse, storePrivateContent, privateContentScopeGuard, settleLegacyPresentationReservations, POLICY_VERSION, type PilotUser, type BudgetReservationGuard } from './pilot-policy.ts';
import { evidenceSha256 } from './generation-evidence.ts';
import { outputAssertionStatements, type OutputSqlAssertion } from './output-requirements-ledger.ts';
import { makeEvent, eventWriteBindings, EVENT_WRITE_COLUMNS, type WorkerEnv } from './runtime.ts';

export type OrdinaryImageJournalInput = {
  generationId:string; image:CreativeImageFinal; receipt:PaidProviderSubmission; usageEnvelope:Record<string,unknown>;
  plannedRaw:string; completion:Record<string,unknown>; usage:Record<string,unknown>;
};
export type SavedOrdinaryImage = {
  media:Awaited<ReturnType<typeof storeGeneratedImage>>;
  planned:{contentId:string;expiresAt:string}; prompt:{contentId:string;expiresAt:string};
};
const checkpoint=(row:DocumentJobRow)=>JSON.parse(row.result_json??'{}') as Record<string,unknown>;
const shaBytes=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes).buffer)),n=>n.toString(16).padStart(2,'0')).join('');

function jobProof(row:DocumentJobRow):BudgetReservationGuard {
  return {sql:`EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND owner_id=? AND stream_id=? AND document_id=?
    AND kind='generate' AND NOT EXISTS(SELECT 1 FROM output_operation_slots slot WHERE slot.job_id=document_jobs.job_id) AND correlation_id=? AND status=? AND result_json IS ? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
  bindings:[row.job_id,row.owner_id,row.stream_id,row.document_id,row.correlation_id,row.status,row.result_json]};
}

function contentAuthority(user:PilotUser,row:DocumentJobRow):OutputSqlAssertion[] {
  return [{sql:"EXISTS(SELECT 1 FROM users WHERE user_id=? AND consent_version=? AND (?=1 OR role IN('admin','creator')))",bindings:[user.userId,POLICY_VERSION,Number(Boolean(user.projectExecution))]},
    {sql:`EXISTS(SELECT 1 FROM events created WHERE created.stream_id=? AND created.type='DocumentCreated' AND json_extract(created.payload,'$.document_id')=?
      AND NOT EXISTS(SELECT 1 FROM events removed WHERE removed.stream_id=created.stream_id AND removed.type IN('DocumentRemoved','ProjectRemoved')
        AND (removed.type='DocumentRemoved' AND json_extract(removed.payload,'$.document_id')=json_extract(created.payload,'$.document_id')
          OR removed.type='ProjectRemoved' AND json_extract(removed.payload,'$.project_id')=json_extract(created.payload,'$.project_id'))))`,bindings:[row.stream_id,row.document_id]}];
}
function combined(assertions:OutputSqlAssertion[]):BudgetReservationGuard {
  return {sql:assertions.map(value=>`(${value.sql})`).join(' AND '),bindings:assertions.flatMap(value=>[...(value.bindings??[])])};
}

/** This is an ordinary-job custody path, never native Output or provider retry authority. */
export async function retainOrdinaryImage(env:WorkerEnv,user:PilotUser,row:DocumentJobRow,input:OrdinaryImageJournalInput,authority:OutputSqlAssertion[]):Promise<SavedOrdinaryImage> {
  if(row.kind!=='generate'||row.output_slot_id||row.status!=='running'||row.owner_id!==user.userId||row.stream_id!==user.streamId)throw new Error('image_journal_attempt_mismatch');
  const previous=checkpoint(row),call=providerSubmissions(previous).find(call=>call.clientRequestId===input.receipt.clientRequestId);
  if(!call||call.operation!=='image'||call.provider!=='openai'||call.model!==input.image.model||input.receipt.status!=='completed'
    ||input.completion.generation_id!==input.generationId||input.completion.document_id!==row.document_id)throw new Error('image_journal_call_mismatch');
  const assertions=[...authority,...contentAuthority(user,row),jobProof(row)],proof=combined(assertions);
  await env.DB.batch(assertions.flatMap(value=>outputAssertionStatements(env,value)));
  const scope=user.projectExecution,storageOwner=scope?.ownerUserId??user.userId;
  const media=await storeGeneratedImage(env,storageOwner,input.generationId,input.image.bytes,input.image.model,input.image.mimeType,
    {provider:'openai',adapter:'openai-image-v5',providerRequestId:input.image.providerRequestId??'',clientRequestId:call.clientRequestId,imageFinal:'1'});
  const planned=await storePrivateContent(env,user.userId,'provider-output',input.plannedRaw,scope,proof);
  const prompt=await storePrivateContent(env,user.userId,'prompt',input.image.prompt,scope,proof);
  const manifest={version:1,jobId:row.job_id,ownerId:row.owner_id,streamId:row.stream_id,documentId:row.document_id,correlationId:row.correlation_id,
    generationId:input.generationId,receipt:input.receipt,usageEnvelope:input.usageEnvelope,media,planned,prompt,
    completion:{...input.completion,output_ref:planned.contentId,prompt_ref:prompt.contentId,content_expires_at:planned.expiresAt,media_url:media.url,media_type:media.mimeType,source_content_hash:media.contentHash},
    usage:input.usage};
  const raw=JSON.stringify(manifest),sha256=await evidenceSha256(raw);
  const receipts=mergeProviderSubmissions(previous.providerSubmissions,{[call.clientRequestId]:input.receipt});
  let next:Record<string,unknown>={};
  await storePrivateContent(env,user.userId,'provider-response',raw,scope,proof,stored=>{
    next={...previous,providerSubmissions:receipts,imageResponseJournal:{version:1,contentRef:stored.contentId,sha256,expiresAt:stored.expiresAt,generationId:input.generationId,clientRequestId:call.clientRequestId},
      imageResultState:'retained',stage:'storage',progressMessage:'Your image was generated. Finishing saving the original result.'};
    return [env.DB.prepare(`UPDATE document_jobs SET result_json=?,updated_at=? WHERE job_id=? AND owner_id=? AND correlation_id=? AND status='running' AND result_json IS ?`)
      .bind(JSON.stringify(next),new Date().toISOString(),row.job_id,row.owner_id,row.correlation_id,row.result_json)];
  },undefined,()=>assertions.map(value=>env.DB.prepare(`SELECT CASE WHEN (${value.sql}) THEN 1 ELSE json('image_journal_authority_changed') END AS verified`).bind(...(value.bindings??[]))));
  row.result_json=JSON.stringify(next);
  return {media,planned,prompt};
}

/** Restore a certified original artifact. This module contains no provider transport. */
export async function recoverOrdinaryImage(env:WorkerEnv,user:PilotUser,row:DocumentJobRow,authority:OutputSqlAssertion[]):Promise<DocumentJobRow> {
  if(row.kind!=='generate'||row.output_slot_id||row.owner_id!==user.userId||row.stream_id!==user.streamId||!['failed','completed'].includes(row.status))throw new Error('image_recovery_attempt_mismatch');
  const original=checkpoint(row),ref=original.imageResponseJournal as Record<string,unknown>|undefined;
  if(ref?.version!==1||typeof ref.contentRef!=='string'||typeof ref.sha256!=='string')throw new Error('image_recovery_original_unavailable');
  const raw=(await loadPrivateProviderResponse(env,user.userId,ref.contentRef,user.projectExecution))?.content;
  if(!raw||await evidenceSha256(raw)!==ref.sha256)throw new Error('image_recovery_journal_unavailable');
  const saved=JSON.parse(raw) as SavedOrdinaryImage & {version:number;jobId:string;ownerId:string;streamId:string;documentId:string;correlationId:string;generationId:string;receipt:PaidProviderSubmission;completion:Record<string,unknown>;usage:Record<string,unknown>};
  if(saved.version!==1||saved.jobId!==row.job_id||saved.ownerId!==row.owner_id||saved.streamId!==row.stream_id||saved.documentId!==row.document_id||saved.correlationId!==row.correlation_id
    ||saved.generationId!==ref.generationId||saved.receipt.clientRequestId!==ref.clientRequestId||saved.receipt.operation!=='image'||saved.receipt.provider!=='openai'||saved.receipt.status!=='completed')throw new Error('image_recovery_identity_mismatch');
  const current=providerSubmissions(original).find(call=>call.clientRequestId===saved.receipt.clientRequestId);
  if(!current)throw new Error('image_recovery_call_missing');
  const receipts=mergeProviderSubmissions(original.providerSubmissions,{[saved.receipt.clientRequestId]:saved.receipt});
  const media=await readGeneratedImageReference(env,user.projectExecution?.ownerUserId??user.userId,saved.media.url);
  if(!media||await shaBytes(media.bytes)!==saved.media.contentHash||saved.completion.source_content_hash!==saved.media.contentHash)throw new Error('image_recovery_media_unavailable');
  const privateBodies=await loadPrivateContent(env,user.userId,'all',user.projectExecution,[saved.planned.contentId,saved.prompt.contentId]);
  if(!privateBodies[saved.planned.contentId]||!privateBodies[saved.prompt.contentId])throw new Error('image_recovery_private_content_unavailable');
  const privateScope=privateContentScopeGuard(user.userId,user.projectExecution);
  const custody:OutputSqlAssertion={sql:`EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind='provider-response' AND content=?
    AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND (${privateScope.sql}))`,bindings:[ref.contentRef,user.userId,raw,...privateScope.bindings]};
  const bodies:OutputSqlAssertion={sql:`(SELECT COUNT(*) FROM private_content WHERE content_id IN(?,?) AND owner_id=? AND redacted_at IS NULL
    AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND (${privateScope.sql}))=2`,bindings:[saved.planned.contentId,saved.prompt.contentId,user.userId,...privateScope.bindings]};
  const assertions=[...authority,...contentAuthority(user,row),custody,bodies];
  // The journal is private certified evidence. Merge its exact receipt before
  // settlement; both transitions are replayable without a new provider call.
  if(JSON.stringify(receipts)!==JSON.stringify(original.providerSubmissions)) {
    const updated={...original,providerSubmissions:receipts};
    await env.DB.batch([...assertions.flatMap(a=>outputAssertionStatements(env,a)),...outputAssertionStatements(env,jobProof(row)),
      env.DB.prepare('UPDATE document_jobs SET result_json=? WHERE job_id=? AND owner_id=? AND result_json IS ?').bind(JSON.stringify(updated),row.job_id,user.userId,row.result_json),
      ...outputAssertionStatements(env,{sql:'changes()=1'})]);
    row={...row,result_json:JSON.stringify(updated)};
  }
  const settled=await settleLegacyPresentationReservations(env,user,row,{originalImage:true,reason:'ordinary_image_original_recovery',assertions});
  if(settled.status!=='known')throw new Error('image_recovery_'+settled.reason);
  const complete=await env.DB.prepare("SELECT event_id FROM events WHERE stream_id=? AND correlation_id=? AND type='GenerationCompleted' AND json_extract(payload,'$.generation_id')=?")
    .bind(row.stream_id,row.correlation_id,saved.generationId).first<{event_id:string}>();
  if(complete&&row.status==='completed')return row;
  const now=new Date().toISOString(),result={...checkpoint(row),errorDetail:null,imageResultState:'published',stage:'completed',progressMessage:'Your original image was restored. No new generation was requested.',
    recovery:{mode:'original-image',new_generation_requests:0,recoveredAt:now},generationReceipt:{...(checkpoint(row).generationReceipt as Record<string,unknown>??{}),provider_request_status:'completed',settled_cost_microusd:settled.usedMicrousd,reservation_status:settled.receipt?.status}};
  const writes:D1PreparedStatement[]=[];
  if(!complete){
    const event=makeEvent(row.stream_id,0,'worker:generator','server:image-recovery',row.correlation_id,'GenerationCompleted',{...saved.completion,recovered_original:true});
    event.eventId=`image-recovered-${row.job_id}`;
    const values=eventWriteBindings(event);
    writes.push(env.DB.prepare(`INSERT INTO event_write_stage (${EVENT_WRITE_COLUMNS}) SELECT ?,?,COALESCE((SELECT MAX(sequence) FROM events WHERE stream_id=?),0)+1,${Array(14).fill('?').join(',')}`)
      .bind(...values.slice(0,2),row.stream_id,...values.slice(3)));
  }
  await env.DB.batch([...assertions.flatMap(a=>outputAssertionStatements(env,a)),...outputAssertionStatements(env,jobProof(row)),...writes,
    env.DB.prepare(`UPDATE document_jobs SET status='completed',result_json=?,error_message=NULL,completed_at=?,updated_at=?,lease_expires_at=NULL,notified_at=NULL
      WHERE job_id=? AND owner_id=? AND correlation_id=? AND status=? AND result_json IS ?`)
      .bind(JSON.stringify(result),now,now,row.job_id,user.userId,row.correlation_id,row.status,row.result_json),...outputAssertionStatements(env,{sql:'changes()=1'})]);
  return {...row,status:'completed',result_json:JSON.stringify(result),error_message:null,completed_at:now,updated_at:now,lease_expires_at:null,notified_at:null};
}

/** Creation uses retained actor-private previews and one canonical event/sidecar/receipt transaction. */
import type { CreationDraft, CreationPlan, CreationReceipt, CompiledCreation } from '../src/model/creation.ts';
import { consentHash, executionAdmissionGuard, executionContentCustodyGuard, type ConsequentialBinding } from './consequential-consent.ts';
import { creationWriteAssertion } from './creation-store.ts';
import { preparePrivateContent } from './private-content-storage.ts';
import type { BudgetReservationGuard, PilotUser } from './pilot-policy.ts';
import { appendProjectEvents, type ProjectRequestContext } from './project-access.ts';
import { prepareAuthoringEventBatch } from './authoring-event-batches.ts';
import { makeEvent, type EventRow, type WorkerEnv } from './runtime.ts';

export type RetainedCreationPreview = {draft:CreationDraft; plan:CreationPlan; compiled:CompiledCreation; binding:ConsequentialBinding; sourceHash:string};
export type CreationOperation = {operation_id:string;draft_id:string;actor_user_id:string;scope_key:string;draft_revision:number;kind:'interpretation'|'commit';state:'prepared'|'executing'|'review'|'applied'|'failed';request_hash:string;content_id:string|null;approval_hash:string|null;receipt_json:string|null;error_code:string|null;expires_at:string;updated_at:string};
export function validCreationOperationId(id:unknown):id is string{return typeof id==='string'&&/^[a-zA-Z0-9_-]{12,120}$/u.test(id);}
export async function readCreationOperation(env:WorkerEnv,user:PilotUser,id:string,draftId:string,scopeKey:string,guard:BudgetReservationGuard){
 return env.DB.prepare(`SELECT * FROM creation_operations WHERE operation_id=? AND actor_user_id=? AND draft_id=? AND scope_key=? AND (${guard.sql})`).bind(id,user.userId,draftId,scopeKey,...guard.bindings).first<CreationOperation>();
}
export async function readCreationOperationPayload<T>(env:WorkerEnv,user:PilotUser,operation:CreationOperation,guard:BudgetReservationGuard,binding:Pick<ConsequentialBinding,'scope'|'actorUserId'>):Promise<T|null>{
 if(!operation.content_id||binding.actorUserId!==user.userId||operation.actor_user_id!==user.userId)return null;
 const custody=executionContentCustodyGuard(binding);
 const row=await env.DB.prepare(`SELECT content FROM private_content WHERE content_id=? AND owner_id=? AND kind='creation-draft' AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND (${guard.sql}) AND (${custody.sql})`).bind(operation.content_id,user.userId,...guard.bindings,...custody.bindings).first<{content:string}>();
 return row?JSON.parse(row.content) as T:null;
}
export async function storeCreationPreview(env:WorkerEnv,user:PilotUser,id:string,scopeKey:string,value:RetainedCreationPreview,guard:BudgetReservationGuard,publicationGuard:BudgetReservationGuard){
 if(!validCreationOperationId(id))throw new Error('creation_operation_id_invalid');
 const requestHash=await consentHash({draft:value.draft.id,revision:value.draft.revision,plan:value.plan,review:value.draft.review}),approvalHash=value.compiled.approvalHash;
 const previous=await readCreationOperation(env,user,id,value.draft.id,scopeKey,guard);
 if(previous){if(previous.request_hash!==requestHash)throw new Error('creation_operation_conflict');return previous;}
 const prepared=await preparePrivateContent(env,user.userId,'creation-draft',JSON.stringify(value),value.binding.scope??undefined,undefined,guard,{contentId:'creation-draft-'+crypto.randomUUID()},value.draft.expiresAt);
 const now=new Date().toISOString(),custody=executionContentCustodyGuard(value.binding);
 const publication=env.DB.prepare(`INSERT INTO creation_operations(operation_id,draft_id,actor_user_id,scope_key,draft_revision,kind,state,request_hash,content_id,approval_hash,expires_at,created_at,updated_at,verified)
  SELECT ?,?,?,?,?, 'commit','review',?,?,?,?,?,?,CASE WHEN EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind='creation-draft' AND redacted_at IS NULL AND (${custody.sql})) AND (${guard.sql}) THEN 1 ELSE 0 END`)
 .bind(id,value.draft.id,user.userId,scopeKey,value.draft.revision,requestHash,prepared.contentId,approvalHash,prepared.expiresAt,now,now,prepared.contentId,user.userId,...custody.bindings,...guard.bindings);
 const proof=creationWriteAssertion(env,publicationGuard);
 try{await env.DB.batch([proof.assert,...prepared.statements,publication,proof.cleanup]);}catch(error){const raced=await readCreationOperation(env,user,id,value.draft.id,scopeKey,guard);if(raced&&raced.request_hash===requestHash)return raced;throw error;}
 return (await readCreationOperation(env,user,id,value.draft.id,scopeKey,guard))!;
}

/** No out-of-transaction lease is needed: a unique retained operation and final CHECK receipt
 * make simultaneous saves converge, and a failed transaction leaves the preview reviewable. */
export async function commitCreationPreview(env:WorkerEnv,user:PilotUser,operation:CreationOperation,value:RetainedCreationPreview,current:ConsequentialBinding,shared:ProjectRequestContext|null,head:number,sourceGuard:BudgetReservationGuard):Promise<CreationReceipt>{
 const compiled=value.compiled,events=compiled.events,guard=executionAdmissionGuard(user,current,null);
 if(operation.state==='applied'&&operation.receipt_json)return JSON.parse(operation.receipt_json) as CreationReceipt;
 if(operation.kind!=='commit'||operation.state!=='review'||operation.approval_hash!==compiled.approvalHash||value.binding.actorUserId!==user.userId||value.binding.permissionEpoch!==current.permissionEpoch||value.sourceHash!==current.sourceHash||operation.expires_at<=new Date().toISOString())throw new Error('creation_preview_stale');
 if(!events.length)throw new Error('creation_no_change');
 if(events.length>512)throw new Error('creation_event_limit');
 const receipt:CreationReceipt={schemaVersion:1,operationId:operation.operation_id,previewId:operation.operation_id,approvalHash:compiled.approvalHash,idMap:compiled.idMap,created:value.plan.nodes.filter(n=>n.disposition==='retained').map(n=>({id:compiled.idMap[n.id]!,kind:n.kind})),uses:compiled.changedUses,status:'committed',projectId:compiled.projectId,primaryDocumentId:compiled.primaryDocumentId};
 const retainedCustody=executionContentCustodyGuard(current,'saved');
 const retainedJson=JSON.stringify(value),correlation='creation:'+user.userId+':'+operation.operation_id;
 const operationGuard:BudgetReservationGuard={sql:`EXISTS(SELECT 1 FROM creation_operations operation JOIN private_content saved ON saved.content_id=operation.content_id
  JOIN creation_drafts draft ON draft.draft_id=operation.draft_id AND draft.actor_user_id=operation.actor_user_id
  WHERE operation.operation_id=? AND operation.actor_user_id=? AND operation.state='review' AND operation.approval_hash=? AND operation.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
  AND draft.revision=operation.draft_revision AND draft.state='active' AND saved.owner_id=? AND saved.kind='creation-draft' AND saved.content=? AND saved.redacted_at IS NULL AND saved.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND (${retainedCustody.sql}))`,bindings:[operation.operation_id,user.userId,compiled.approvalHash,user.userId,retainedJson,...retainedCustody.bindings]};
 const admission={sql:`(${guard.sql}) AND (${operationGuard.sql}) AND (${sourceGuard.sql})`,bindings:[...guard.bindings,...operationGuard.bindings,...sourceGuard.bindings]};
 const finalize=(allocated:readonly EventRow[],proof:BudgetReservationGuard)=>[
  env.DB.prepare(`UPDATE creation_operations SET state='applied',receipt_json=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),verified=CASE WHEN (${guard.sql}) AND (${operationGuard.sql}) AND (${proof.sql}) AND (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=? AND (SELECT COUNT(*) FROM events WHERE stream_id=? AND correlation_id=? AND actor=?)=? THEN 1 ELSE 0 END WHERE operation_id=? AND actor_user_id=?`)
   .bind(JSON.stringify(receipt),...guard.bindings,...operationGuard.bindings,...proof.bindings,current.streamId,head+events.length,current.streamId,correlation,'user:'+user.userId,events.length,operation.operation_id,user.userId),
  env.DB.prepare(`UPDATE creation_drafts SET state='applied',operation_id=?,receipt_id=? WHERE draft_id=? AND actor_user_id=? AND EXISTS(SELECT 1 FROM creation_operations WHERE operation_id=? AND state='applied')`).bind(operation.operation_id,operation.operation_id,value.draft.id,user.userId,operation.operation_id),
 ];
 try{
  if(shared){const response=await appendProjectEvents(env,shared,user,{action:'batch',events,clientId:'web:creation',correlationId:correlation},undefined,{preserveGovernance:true,authoringOperation:'creation-plan',expectedOwnerHead:head,guardSql:admission.sql,guardBindings:admission.bindings,buildStatements:(_last,proof,allocated)=>{if(!proof||!allocated?.length)throw new Error('creation_write_proof_required');return finalize(allocated,proof);}});if(!response.ok)throw new Error(String((await response.json() as {error?:string}).error??'creation_commit_failed'));}
  else{const allocated=events.map((event,index)=>makeEvent(current.streamId,head+index+1,'user:'+user.userId,'web:creation',correlation,event.type,event.payload));const batch=prepareAuthoringEventBatch(env,allocated,head,admission);await env.DB.batch([...batch.statements,...finalize(allocated,batch.proof)]);}
 }catch(error){const won=await readCreationOperation(env,user,operation.operation_id,operation.draft_id,operation.scope_key,guard);if(won?.state==='applied'&&won.receipt_json)return JSON.parse(won.receipt_json) as CreationReceipt;throw error;}
 const terminal=await readCreationOperation(env,user,operation.operation_id,operation.draft_id,operation.scope_key,guard);if(terminal?.state!=='applied'||!terminal.receipt_json)throw new Error('creation_receipt_pending');return JSON.parse(terminal.receipt_json) as CreationReceipt;
}

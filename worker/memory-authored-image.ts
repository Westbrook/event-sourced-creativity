import {consentHash} from './consequential-consent.ts';
import {DURABLE_WORK_RETENTION_END,type BudgetReservationGuard} from './pilot-policy.ts';
import {makeEvent,eventWriteBindings,EVENT_WRITE_COLUMNS,uuidV7,type WorkerEnv} from './runtime.ts';
import {authoringEventProof} from './authoring-event-proof.ts';
import {appendProjectEvents} from './project-access.ts';
import {assistantReadAuthorityGuard,type SpecialistActor} from './assistant-specialist-consent.ts';
import {ownerMediaNamespace} from '../src/model/media-ownership.ts';
import {storeGeneratedImage} from './media-api.ts';
import {inspectOutputAsset} from '../src/model/output-asset-inspection.ts';
import {derivationResults,derivationVerified} from './memory-derivation-store.ts';

export type MemoryImagePublication={executionId:string;approvalHash:string;projectId:string;documentId:string;canvasId:string|null;sourceHead:number;preconditions:D1PreparedStatement[];
 image:{encoded:string;sha256:string;mimeType:'image/jpeg';width:number;height:number};model:string};
const KIND='authored-memory-image',VERSION='memory-authored-image-v1';
const assert=(env:WorkerEnv,guard:BudgetReservationGuard)=>env.DB.prepare(`SELECT CASE WHEN (${guard.sql}) THEN 1 ELSE json('memory_image_authoring_unconfirmed') END AS verified`).bind(...guard.bindings);
export const memoryImageAdoptionHash=(executionId:string,sha256:string,projectId:string,documentId:string,shared:boolean)=>consentHash({version:VERSION,executionId,sha256,projectId,documentId,shared,independentEvidence:false,preservedOnMemoryWithdrawal:true});

/** Only explicitly accepted authored pixels enter ordinary media storage. The
 * acceptance and durable byte copy are one native transaction; a failed/lost R2
 * acknowledgement is recoverable from that copy without reading private Memory. */
export async function publishMemoryAuthoredImage(env:WorkerEnv,actor:SpecialistActor,input:MemoryImagePublication){
 if(!actor.canPropose||input.preconditions.length<1||input.preconditions.length>128)throw Error('memory_image_authoring_denied');
 const owner=actor.project?.ownerUserId??actor.principal.userId,stream='creative:'+owner,objectId='memory-image-'+input.executionId,
 key=`${ownerMediaNamespace(owner)}/generated/${objectId}.jpg`,mediaUrl='/api/media/'+encodeURIComponent(key),receipt='memory-image-adopt:'+input.executionId;
 if(input.approvalHash!==await memoryImageAdoptionHash(input.executionId,input.image.sha256,input.projectId,input.documentId,!!actor.project))throw Error('memory_image_approval_required');
 const bytes=Uint8Array.from(atob(input.image.encoded),c=>c.charCodeAt(0)),inspection=await inspectOutputAsset(bytes,'accepted.jpg');
 if(bytes.length>700000||inspection.status!=='inspected'||inspection.sha256!==input.image.sha256||inspection.mimeType!=='image/jpeg'||inspection.facts.width!==1024||inspection.facts.height!==1024)throw Error('memory_image_invalid');
 const contentId=uuidV7(),now=new Date().toISOString(),content=JSON.stringify({version:VERSION,executionId:input.executionId,approvalHash:input.approvalHash,actorUserId:actor.principal.userId,shared:!!actor.project,objectId,key,projectId:input.projectId,documentId:input.documentId,model:input.model,image:input.image,projected:false});
 const payload={project_id:input.projectId,document_id:input.documentId,...(input.canvasId?{canvas_id:input.canvasId}:{}),generation_id:objectId,object_ids:[objectId],model_id:input.model,provider:'openai',media_url:mediaUrl,media_type:'image/jpeg',image_width:1024,image_height:1024,
 output_ref:contentId,quality:'high',purpose:'ideate',source_surface:'assistant',memory_authored_version:1,memory_image_acceptance_version:1,content_sha256:input.image.sha256,source_content_hash:input.image.sha256,approval_id:input.approvalHash,independent_evidence:false,request_id:input.executionId};
 const guard={sql:'NOT EXISTS(SELECT 1 FROM event_client_receipts WHERE stream_id=? AND client_event_id=?)',bindings:[stream,receipt]};
 const sidecars=(eventId:string,sequence:number)=>{
  const statements=[env.DB.prepare(`INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES(?,?,?,?,?,?,NULL)`).bind(contentId,owner,KIND,content,now,DURABLE_WORK_RETENTION_END),
   env.DB.prepare(`INSERT INTO event_client_receipts(stream_id,client_event_id,event_id,sequence,created_at) VALUES(?,?,?,?,?)`).bind(stream,receipt,eventId,sequence,now)];
  if(actor.project){const p=actor.project;for(const [kind,id] of [['content',contentId],['output',objectId],['media',key]])statements.push(env.DB.prepare(`INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at) VALUES(?,?,?,?,?,?,'collaborative_output',?,?,?)`).bind(p.projectAccessId,kind,id,p.organizationId,p.projectId,owner,eventId,actor.principal.userId,now));
   statements.push(env.DB.prepare(`INSERT INTO private_content_retention_scopes(content_id,organization_id,project_access_id,project_id,actor_user_id,classification,policy_version,assigned_expires_at,created_at) VALUES(?,?,?,?,?,'durable-work',COALESCE((SELECT version FROM organization_retention_policies WHERE organization_id=?),0),?,?)`).bind(contentId,p.organizationId,p.projectAccessId,p.projectId,actor.principal.userId,p.organizationId,DURABLE_WORK_RETENTION_END,now));}
  statements.push(env.DB.prepare("INSERT INTO memory_authored_image_receipts(content_id,event_id,owner_id,media_key,state,created_at,retired_at) VALUES(?,?,?,?,'active',?,NULL)").bind(contentId,eventId,owner,key,now));
  statements.push(assert(env,{sql:`EXISTS(SELECT 1 FROM event_client_receipts r JOIN events e ON e.event_id=r.event_id JOIN private_content c ON c.content_id=? WHERE r.stream_id=? AND r.client_event_id=? AND r.event_id=? AND e.type='GenerationCompleted' AND json_extract(e.payload,'$.memory_image_acceptance_version')=1 AND c.content=? AND c.redacted_at IS NULL)`,bindings:[contentId,stream,receipt,eventId,content]}));return statements;
 };
 let eventId:string;
 if(actor.project){const response=await appendProjectEvents(env,actor.project,actor.principal,{action:'batch',events:[{type:'GenerationCompleted',payload}],clientId:'web:assistant-memory-image',correlationId:input.executionId},undefined,{
  preserveGovernance:true,authoringOperation:'memory-image-adopt',expectedOwnerHead:input.sourceHead,guardSql:guard.sql,guardBindings:guard.bindings,preconditions:input.preconditions,
  buildStatements:(id,proof,events)=>{if(!proof||events?.length!==1)throw Error('memory_image_authoring_unconfirmed');return [assert(env,proof),...sidecars(id,events[0]!.sequence)];}});
  if(!response.ok)return response;const v=await response.json() as {appended?:{eventId:string}[]};if(v.appended?.length!==1)throw Error('memory_image_authoring_unconfirmed');eventId=v.appended[0]!.eventId;
 }else{const event=makeEvent(stream,input.sourceHead+1,'user','web:assistant-memory-image',input.executionId,'GenerationCompleted',payload);eventId=event.eventId;const authority=assistantReadAuthorityGuard(actor);
  const statements=[...input.preconditions,env.DB.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) SELECT ${EVENT_WRITE_COLUMNS.split(',').map(()=>'?').join(',')} WHERE (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=? AND (${authority.sql}) AND (${guard.sql})`).bind(...eventWriteBindings(event),stream,input.sourceHead,...authority.bindings,...guard.bindings),assert(env,authoringEventProof([event])),...sidecars(eventId,event.sequence)];
  const rows=await env.DB.batch(statements);if(!derivationResults(rows,statements.length)||!rows.slice(0,input.preconditions.length).every(derivationVerified)||!derivationVerified(rows.at(-1)!))throw Error('memory_image_authoring_unconfirmed');}
 let projected=false;try{projected=await projectMemoryAuthoredImage(env,contentId);}catch{/* Authored acceptance is durable. Never repurchase. */}
 return Response.json({version:VERSION,status:'applied',executionId:input.executionId,eventId,objectId,mediaUrl,projected,independentEvidence:false,preservedOnMemoryWithdrawal:true},{headers:{'cache-control':'private, no-store'}});
}

/** Byte copy, not a new authoring decision. Never hydrates an unaccepted source. */
export async function projectMemoryAuthoredImage(env:WorkerEnv,contentId:string){
 const row=await env.DB.prepare(`SELECT c.owner_id,c.content FROM private_content c JOIN memory_authored_image_receipts accepted ON accepted.content_id=c.content_id AND accepted.owner_id=c.owner_id AND accepted.state='active' JOIN events e ON e.event_id=accepted.event_id AND e.stream_id='creative:'||c.owner_id AND e.type='GenerationCompleted'
 JOIN event_client_receipts r ON r.event_id=e.event_id AND r.stream_id=e.stream_id AND r.client_event_id='memory-image-adopt:'||json_extract(e.payload,'$.request_id')
 JOIN event_private_payloads secret ON secret.private_event_id=e.event_id AND secret.owner_id=c.owner_id AND secret.redacted_at IS NULL AND json_extract(secret.private_json,'$.output_ref')=c.content_id
 WHERE c.content_id=? AND c.kind=? AND c.redacted_at IS NULL AND c.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND length(CAST(c.content AS BLOB))<=1000000
 AND json_extract(e.payload,'$.memory_image_acceptance_version')=1 AND json_extract(e.payload,'$.memory_authored_version')=1
 AND json_extract(c.content,'$.image.sha256')=json_extract(e.payload,'$.content_sha256') AND json_extract(c.content,'$.approvalHash')=json_extract(e.payload,'$.approval_id')
 AND json_extract(c.content,'$.projectId')=json_extract(e.payload,'$.project_id') AND json_extract(c.content,'$.documentId')=json_extract(e.payload,'$.document_id')
 AND json_extract(c.content,'$.executionId')=json_extract(e.payload,'$.request_id') AND json_extract(secret.private_json,'$.media_url')='/api/media/'||replace(replace(json_extract(c.content,'$.key'),'%','%25'),'/','%2F') LIMIT 2`).bind(contentId,KIND).all<{owner_id:string;content:string}>();
 if(!row.success||row.results.length!==1)return false;const retained=row.results[0]!,v=JSON.parse(retained.content);
 if(v.version!==VERSION||v.key!==`${ownerMediaNamespace(retained.owner_id)}/generated/${v.objectId}.jpg`||v.objectId!=='memory-image-'+v.executionId||v.approvalHash!==await memoryImageAdoptionHash(v.executionId,v.image.sha256,v.projectId,v.documentId,v.shared===true))return false;
 const bytes=Uint8Array.from(atob(v.image.encoded),c=>c.charCodeAt(0)),inspected=await inspectOutputAsset(bytes,'accepted.jpg');if(bytes.length>700000||inspected.status!=='inspected'||inspected.sha256!==v.image.sha256||inspected.mimeType!=='image/jpeg'||inspected.facts.width!==1024||inspected.facts.height!==1024)return false;
 const stored=await storeGeneratedImage(env,retained.owner_id,v.objectId,bytes,v.model,'image/jpeg',{memoryAuthoredVersion:'1',authoredContentId:contentId,independentEvidence:'false'});if(stored.key!==v.key||stored.contentHash!==v.image.sha256)return false;
 const changed=await env.DB.prepare(`UPDATE private_content SET content=json_set(content,'$.projected',json('true')) WHERE content_id=? AND content=? AND redacted_at IS NULL`).bind(contentId,retained.content).run();if(!changed.success||Number(changed.meta.changes)!==1){
  // A concurrent projector may already have installed these same accepted bytes.
  const same=await env.DB.prepare("SELECT 1 AS valid FROM private_content c JOIN memory_authored_image_receipts r ON r.content_id=c.content_id AND r.state='active' WHERE c.content_id=? AND c.redacted_at IS NULL AND json_remove(c.content,'$.projected')=json_remove(?,'$.projected') AND json_extract(c.content,'$.projected')=1").bind(contentId,retained.content).first();
  if(same)return true;await env.MEDIA.delete(v.key);return false;}return true;
}
export async function reconcileMemoryAuthoredImages(env:WorkerEnv){
 const rows=await env.DB.prepare(`SELECT c.content_id FROM private_content c JOIN memory_authored_image_receipts accepted ON accepted.content_id=c.content_id AND accepted.owner_id=c.owner_id AND accepted.state='active' WHERE c.kind=? AND c.redacted_at IS NULL AND json_valid(c.content) AND json_extract(c.content,'$.version')=? AND json_extract(c.content,'$.projected')=0 ORDER BY c.created_at,c.content_id LIMIT 4`).bind(KIND,VERSION).all<{content_id:string}>();
 if(!rows.success||rows.results.length>4)throw Error('memory_image_projection_unavailable');let count=0;for(const row of rows.results)try{if(await projectMemoryAuthoredImage(env,row.content_id))count++;}catch{/* Exact same accepted bytes can be retried, never generation. */}return count;
}

/** Recovery returns only the existing authored receipt. It neither accesses nor
 * renews the original private preview and cannot create another acceptance. */
export async function recoverMemoryImageAdoption(env:WorkerEnv,actor:SpecialistActor,executionId:string,approvalHash:string):Promise<Response|null>{
 const owner=actor.project?.ownerUserId??actor.principal.userId,guard=assistantReadAuthorityGuard(actor),scope=actor.project;
 const query=env.DB.prepare(`SELECT c.content_id,e.event_id,json_extract(c.content,'$.objectId') AS object_id,json_extract(secret.private_json,'$.media_url') AS media_url
 FROM event_client_receipts r JOIN events e ON e.event_id=r.event_id AND e.stream_id=r.stream_id
 JOIN event_private_payloads secret ON secret.private_event_id=e.event_id AND secret.owner_id=? AND secret.redacted_at IS NULL
 JOIN private_content c ON c.content_id=json_extract(secret.private_json,'$.output_ref') AND c.owner_id=secret.owner_id AND c.kind=? AND c.redacted_at IS NULL
 WHERE EXISTS(SELECT 1 FROM memory_authored_image_receipts accepted WHERE accepted.content_id=c.content_id AND accepted.event_id=e.event_id AND accepted.owner_id=c.owner_id AND accepted.state='active') AND r.stream_id=? AND r.client_event_id=? AND e.type='GenerationCompleted' AND json_extract(e.payload,'$.memory_image_acceptance_version')=1
 AND json_extract(e.payload,'$.approval_id')=? AND json_extract(e.payload,'$.project_id')=?
 AND json_extract(c.content,'$.actorUserId')=? AND json_extract(c.content,'$.approvalHash')=?
 AND (${scope?`EXISTS(SELECT 1 FROM project_event_scopes s WHERE s.event_id=e.event_id AND s.organization_id=? AND s.project_access_id=? AND s.owner_user_id=?)`:`NOT EXISTS(SELECT 1 FROM project_event_scopes s WHERE s.event_id=e.event_id)`}) AND (${guard.sql}) LIMIT 2`)
 .bind(owner,KIND,'creative:'+owner,'memory-image-adopt:'+executionId,approvalHash,actor.projectId,actor.principal.userId,approvalHash,...(scope?[scope.organizationId,scope.projectAccessId,owner]:[]),...guard.bindings);
 const rows=await query.all<{content_id:string;event_id:string;object_id:string;media_url:string}>();if(!rows.success||rows.results.length>1)throw Error('memory_image_receipt_unavailable');const row=rows.results[0];if(!row)return null;
 let projected=false;try{projected=await projectMemoryAuthoredImage(env,row.content_id);}catch{/* Accepted work remains recoverable. */}
 if(!await env.DB.prepare('SELECT 1 AS current WHERE '+guard.sql).bind(...guard.bindings).first())throw Error('memory_image_authority_changed');
 return Response.json({version:VERSION,status:'applied',executionId,eventId:row.event_id,objectId:row.object_id,mediaUrl:row.media_url,projected,independentEvidence:false,preservedOnMemoryWithdrawal:true},{headers:{'cache-control':'private, no-store'}});
}

export {memoryAuthoredImageMediaAllowed} from './memory-authored-image-custody.ts';

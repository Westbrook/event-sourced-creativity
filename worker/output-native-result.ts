import { foldEvents } from "../src/model/events.ts";
import { parseDocumentArtifactContent, documentArtifactValidationIssues } from "../src/model/document-artifacts.ts";
import { createPowerPointDocument } from "../src/model/office-documents.ts";
import { buildPresentationSourceContract } from "../src/model/presentation-source.ts";
import { readSlideCountPolicy } from "../src/model/presentation-count-policy.ts";
import { readProjectSourceEvents } from "./project-access.ts";
import { readEvents } from "./runtime.ts";
import { readGeneratedImageReference, readOwnedModel3dReference } from "./media-api.ts";
import { outputAssetSha256 } from "../src/model/output-asset-inspection.ts";
import type { OutputBridgeTargetInput } from "./output-requirements-api.ts";
import { OutputConflictError, type OutputSqlAssertion } from "./output-requirements-ledger.ts";

/** Reuse only completed native output, never private rejected provider candidates.
 * This creates an unapproved candidate for the Output target; no historical
 * selection, pin, or whole-Document review becomes a new target approval. */
export async function resolveOutputNativeResult(input:OutputBridgeTargetInput&{nativeJobId:string}):Promise<{bytes:Uint8Array;name:string;origin:Record<string,unknown>;assertions:OutputSqlAssertion[]}>{
 const {env,scope,target}=input;
 if(Object.hasOwn(target,"video_contract"))throw new OutputConflictError("native_video_contract_result_unavailable",422);
 if(Object.hasOwn(target,"audio_contract"))throw new OutputConflictError("native_audio_contract_result_unavailable",422);
 if(Object.hasOwn(target,"scene_contract"))throw new OutputConflictError("native_scene_result_unavailable",422);
 if(Object.hasOwn(target,"narrative_contract"))throw new OutputConflictError("native_narrative_result_unavailable",422);
 const job=await env.DB.prepare(`SELECT job.job_id,job.owner_id,job.stream_id,job.document_id,job.kind,job.status,job.correlation_id,slot.slot_id,slot.target_id,slot.target_contract_digest,slot.source_digest
   FROM document_jobs job JOIN output_operation_slots slot ON slot.job_id=job.job_id
   JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id
   WHERE job.job_id=? AND slot.scope_key=? AND job.document_id=? AND job.stream_id=? AND grant_row.actor_user_id=job.owner_id`)
   .bind(input.nativeJobId,scope.key,scope.documentId,`creative:${scope.ownerUserId}`).first<Record<string,unknown>>();
 if(!job||job.status!=="completed"||job.target_id!==target.id||job.source_digest!==input.sourceDigest||job.target_contract_digest!==input.confirmedPlan.targetContractDigests[target.id])throw new OutputConflictError("native_output_not_current_or_complete");
 const events=scope.kind==="project"?await readProjectSourceEvents(env,{organizationId:scope.organizationId!,projectAccessId:scope.projectAccessId!,projectId:scope.projectId,ownerUserId:scope.ownerUserId}):await readEvents(env,`creative:${scope.ownerUserId}`);
 const completed=events.find(event=>event.correlationId===job.correlation_id&&event.payload.document_id===scope.documentId&&event.type===(target.media_kind==="image"?"GenerationCompleted":"DocumentRenderCompleted"));
 if(!completed)throw new OutputConflictError("native_output_completion_evidence_missing");
 const assertions:OutputSqlAssertion[]=[{sql:"EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND status='completed' AND correlation_id=? AND stream_id=?)",bindings:[input.nativeJobId,String(job.correlation_id),String(job.stream_id)]},
  {sql:"EXISTS(SELECT 1 FROM event_private_payloads WHERE private_event_id=? AND redacted_at IS NULL)",bindings:[completed.eventId]}];
 if(target.media_kind==="image"){
  const image=await readGeneratedImageReference(env,scope.ownerUserId,completed.payload.media_url);
  if(!image)throw new OutputConflictError("native_output_bytes_unavailable",410);
  return {bytes:image.bytes,name:`image-${String(completed.payload.generation_id)}.${image.mimeType==="image/jpeg"?"jpg":image.mimeType==="image/webp"?"webp":"png"}`,
   origin:{kind:"forma_native",createdByUserId:String(job.owner_id),editedByUserIds:[],jobId:input.nativeJobId,slotId:job.slot_id,completionEventId:completed.eventId,resultId:String(completed.payload.generation_id),sourceDigest:input.sourceDigest,targetContractDigest:job.target_contract_digest},assertions};
 }
 if(!["slides","model3d"].includes(target.media_kind)||completed.payload.artifact_kind!==target.media_kind)throw new OutputConflictError("native_output_medium_unsupported",422);
 const artifactId=String(completed.payload.artifact_id??"");
 const projection=foldEvents(events,Number.POSITIVE_INFINITY,scope.documentId,scope.projectId);
 const artifact=projection.artifacts.find(artifact=>artifact.id===artifactId&&artifact.documentId===scope.documentId&&artifact.kind===target.media_kind);
 if(!artifact?.contentRef)throw new OutputConflictError("native_output_content_unavailable",410);
 const scopePredicate=scope.kind==="project"?` AND EXISTS(SELECT 1 FROM project_resource_scopes artifact_scope JOIN project_resource_scopes content_scope
   ON content_scope.project_access_id=artifact_scope.project_access_id AND content_scope.organization_id=artifact_scope.organization_id AND content_scope.project_id=artifact_scope.project_id AND content_scope.owner_user_id=artifact_scope.owner_user_id
   WHERE artifact_scope.resource_kind='artifact' AND artifact_scope.resource_id=? AND artifact_scope.project_access_id=? AND artifact_scope.organization_id=? AND artifact_scope.project_id=? AND artifact_scope.owner_user_id=?
     AND content_scope.resource_kind='content' AND content_scope.resource_id=private_content.content_id AND content_scope.visibility='collaborative_output')`:
   " AND NOT EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='content' AND resource.resource_id=private_content.content_id)";
 const scopeBindings=scope.kind==="project"?[artifactId,scope.projectAccessId!,scope.organizationId!,scope.projectId,scope.ownerUserId]:[];
 const retainedContentPredicate=`content_id=? AND owner_id=? AND kind='document-artifact' AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')${scopePredicate}`;
 const content=await env.DB.prepare(`SELECT content FROM private_content WHERE ${retainedContentPredicate}`)
  .bind(artifact.contentRef,scope.ownerUserId,...scopeBindings).first<{content:string}>();
 if(!content)throw new OutputConflictError("native_output_content_unavailable",410);
 const parsed=parseDocumentArtifactContent(content.content);
 if(!parsed)throw new OutputConflictError("native_output_content_invalid");
 let bytes:Uint8Array,name:string;
 let model3dFiles:unknown;
 if(target.media_kind==="model3d"){
  if(!artifact.mediaUrl||artifact.mediaUrl!==completed.payload.media_url)throw new OutputConflictError("native_output_content_invalid");
  const model=await readOwnedModel3dReference(env,scope.ownerUserId,artifact.mediaUrl,{...(scope.kind==="project"?{projectAccessId:scope.projectAccessId!}:{})});
  if(!model)throw new OutputConflictError("native_output_bytes_unavailable",410);
  const sha256=await outputAssetSha256(model.bytes);
  if(model.metadata.sha256!==sha256)throw new OutputConflictError("native_output_content_invalid");
  model3dFiles=completed.payload.settings&&typeof completed.payload.settings==="object"?(completed.payload.settings as Record<string,unknown>).model3d_files:undefined;
  const primary=Array.isArray(model3dFiles)?model3dFiles.find((file)=>file&&typeof file==="object"&&(file as Record<string,unknown>).url===artifact.mediaUrl):null;
  if(!primary||primary.sha256!==sha256||primary.format!=="glb"||primary.role!=="mesh")throw new OutputConflictError("native_output_content_invalid");
  bytes=model.bytes;name=`model-${artifactId}.glb`;
 }else{
  if(!parsed.presentation)throw new OutputConflictError("native_output_content_invalid");
  const policy=readSlideCountPolicy(target.count_policy);
  const contract=buildPresentationSourceContract(input.context.snapshot,{itemCount:parsed.items.length,slideCountPolicy:policy,...(policy.kind==="exact"?{requestedSlideCount:policy.value}:{})});
  const issues=documentArtifactValidationIssues("slides",parsed,{itemCount:parsed.items.length,slideCountPolicy:policy,sourceContract:contract,requireSourceGrounding:true,requireAllProtectedContent:true});
  if(issues.length||contract.sourceIssues?.length)throw new OutputConflictError("native_output_needs_source_revalidation");
  bytes=createPowerPointDocument(parsed.items,parsed.presentation,{title:parsed.title,includePresenterNotes:false});name=`presentation-${artifactId}.pptx`;
 }
 // Reused by the storage claim, publication check and atomic result commit.
 // Every boundary checks live retention and the same exact source custody.
 assertions.push({sql:`EXISTS(SELECT 1 FROM private_content WHERE ${retainedContentPredicate} AND content=?)`,bindings:[artifact.contentRef,scope.ownerUserId,...scopeBindings,content.content]});
 const revisionEvents=events.filter(event=>event.type==="DocumentArtifactEdited"&&event.payload.artifact_id===artifactId);
 const editedByUserIds:string[]=[];
 for(const event of revisionEvents){
  if(scope.kind==="personal"){editedByUserIds.push(scope.actorUserId);continue;}
  const author=await env.DB.prepare("SELECT actor_user_id FROM project_event_scopes WHERE event_id=? AND project_access_id=? AND organization_id=? AND owner_user_id=?")
   .bind(event.eventId,scope.projectAccessId!,scope.organizationId!,scope.ownerUserId).first<{actor_user_id:string}>();
  if(!author?.actor_user_id)throw new OutputConflictError("native_output_contributor_evidence_missing");
  editedByUserIds.push(author.actor_user_id);
 }

 return {bytes,name,origin:{kind:"forma_native",createdByUserId:String(job.owner_id),editedByUserIds:[...new Set(editedByUserIds)],jobId:input.nativeJobId,slotId:job.slot_id,completionEventId:completed.eventId,resultId:artifactId,artifactRevision:revisionEvents.length,artifactRevisionEventId:revisionEvents.at(-1)?.eventId??completed.eventId,sourceDigest:input.sourceDigest,targetContractDigest:job.target_contract_digest,...(model3dFiles?{model3dFiles}:{})},assertions};
}

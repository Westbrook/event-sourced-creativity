import { parseModel3dMediaRevision, parseModel3dCurrentProjection, type Model3dCurrentProjection } from "../src/model/model3d-media-revision.ts";
import { validWorkspaceQuickEditEvents } from "../src/model/workspace-local-proposal.ts";
import { foldEvents, type CreativeEvent, type CreativeProjection } from "../src/model/events.ts";
import { foldCanvasEvents } from "../src/canvas/model.ts";
import { FORMA_CAPABILITIES, type FormaCapability } from "../src/platform/capabilities.ts";
import { DURABLE_WORK_RETENTION_END, POLICY_VERSION, hasCapability, type BudgetReservationGuard, type PilotUser } from "./pilot-policy.ts";
import { appendEvents, EVENT_WRITE_COLUMNS, eventWriteBindings, makeEvent, readEvents, readEventsByClientEventIds, serializeEvent, streamHead, uuidV7, type EventRow, type WorkerEnv } from "./runtime.ts";
import { validateCanvasEvent } from "./realtime/canvas-admission.ts";
import { ARTIFACT_REVIEW_EVENT_TYPES, artifactExactBatchGuard, artifactSourceEvidenceGuard, artifactReviewCompletionGuard, validateArtifactReview, type ExactArtifactContentBinding } from "./artifact-review.ts";
import { artifactApprovalMatches, artifactCurrentRightsBlockers } from "../src/model/artifact-delivery.ts";
import { managedPilotSourceClassificationValid, verifySourceDocumentEvidence } from "./media-api.ts";
import { effectivePilotParticipantSql, effectivePilotReviewerSql } from "./access-policy.ts";
import { artifactReviewState, artifactSourceVersions } from "../src/model/context-health.ts";
import { productionWorkflowIssues, type ProductionWorkflow } from "../src/model/production-workflow.ts";
import { ACTION_PARTICIPANT_RELATION, ACTION_REFERENCE_ROLES, isContextCompositionRelation, normalizeActionBlockReferences, validateContextCompositionGraph } from "../src/model/combined-context.ts";
import { ASSISTANT_STATE_EVENT_SQL } from "../src/model/assistant-event-views.ts";
import { governedPackageSourceRightsValidity, sourceRightsDispatchGuard } from "./context-package-rights.ts";
import { CANVAS_ARRANGEMENT_MAX_EVENTS, validateAtomicCanvasArrangementEvents } from "./canvas-arrangement-contract.ts";
import { combineAuthoringGuards, prepareAuthoringEventBatch, prepareAuthoringMediaBatch, prepareAuthoringSidecarBatch } from "./authoring-event-batches.ts";

import { OUTPUT_REQUIREMENT_EVENT_TYPES, isOutputRequirementEvent } from "../src/model/output-requirement-events.ts";
import { outputAuthoringBlocksFromEvents, outputRequirementHeadGuard, prepareOutputRequirementClientEvents } from "./output-requirement-event-guards.ts";
import { validateModel3dAssetEvents } from "./model3d-event-guards.ts";
import { assistantOwnSendGuard, assistantOwnSendProjectIndexGuard, assistantStructuredOwnSendGuard, assistantStructuredOwnSendProjectIndexGuard, type AssistantContextReadObserver, type AssistantContextReadDescriptor, type AssistantOwnSendFootprint, type AssistantStructuredOwnSendFootprint } from "./assistant-context-source.ts";

const CONTEXT_COOKIE="forma_project_context";
const PROJECT_EVENT_TYPES=new Set([
  ...OUTPUT_REQUIREMENT_EVENT_TYPES,
  "ProjectCreated","ProjectRenamed","ProjectStateChanged","DocumentCreated","DocumentForked","DocumentRenamed","DocumentRemoved","DocumentRestored","DocumentProductionWorkflowConfigured","EmptyCanvasChosen",
  "BlockCreated","BlockRenamed","BlockPropertyEdited","BlockWeightSet","BlockLocked","BlockUnlocked","BlockRemoved","BlockRestored","BlockRehomed",
  "BlockRelationAdded","BlockRelationRemoved","ReferenceIngested","RightsAsserted","RegionPromoted","ExtractionRequested","ExtractionCompleted","ExtractionFailed","ExtractionSuperseded","ChipEdited",
  "CollectionCreated","CollectionRenamed","CollectionRemoved","CollectionRestored","CollectionItemAdded","CollectionItemRemoved","CollectionItemMoved",
  "ContextCompiled","GenerationCompleted","IdeationPreviewCompleted","IdeationPromoted","DocumentRenderCompleted","DocumentArtifactEdited","DocumentArtifactExported","ArtifactReviewRequested","ArtifactApproved","ArtifactChangesRequested","ChatMessageSent","AssistantReasoned",
  "ObjectSaved","ObjectDiscarded","ObjectPinned","ObjectUnpinned","ObjectExported","OutputRenamed","PromptFanOutputPromoted","AddedToLibrary","RemovedFromLibrary",
  "CanvasCreated","CanvasItemPlaced","CanvasReferenceCreated","CanvasTextApplied","CanvasArrangementCreated","CanvasArrangementRemoved","CanvasArrangementRestored",
  "CanvasRegisterSet","CanvasLockAcquired","CanvasLockReleased","StrokeAdded","StrokeErased","ContextSetFormalized","CanvasItemRemoved","CanvasItemRestored","CanvasRenamed","CanvasRemoved","CanvasRestored",
]);
const PROJECT_MUTATION_TYPES=new Set([
  "DocumentCreated","DocumentRenamed","DocumentRemoved","DocumentRestored","DocumentProductionWorkflowConfigured","BlockCreated","BlockRenamed","BlockPropertyEdited","BlockWeightSet",
  "BlockLocked","BlockUnlocked","BlockRemoved","BlockRestored","BlockRelationAdded","BlockRelationRemoved","CollectionCreated","CollectionRenamed",
  "CollectionRemoved","CollectionRestored","CollectionItemAdded","CollectionItemRemoved","CollectionItemMoved","ObjectSaved","ObjectPinned","ObjectUnpinned",
  "ObjectDiscarded","ObjectExported","OutputRenamed","DocumentArtifactEdited","DocumentArtifactExported","ArtifactReviewRequested","ArtifactApproved","ArtifactChangesRequested","AddedToLibrary","RemovedFromLibrary","ChipEdited","ReferenceIngested","RightsAsserted",
]);
const PROJECT_CANVAS_MUTATION_TYPES=new Set([
  "CanvasCreated","CanvasRenamed","CanvasRemoved","CanvasRestored","CanvasItemPlaced","CanvasReferenceCreated","CanvasItemRemoved","CanvasItemRestored",
  "CanvasArrangementCreated","CanvasArrangementRemoved","CanvasArrangementRestored","CanvasRegisterSet","CanvasTextApplied",
  "CanvasLockAcquired","CanvasLockReleased","StrokeAdded","StrokeErased","ContextSetFormalized",
]);
const artifactRevisionHoldSql=(alias:string)=>`EXISTS(SELECT 1 FROM organization_retention_policies policy
    WHERE policy.organization_id=${alias}.organization_id AND policy.legal_hold=1)
  OR EXISTS(SELECT 1 FROM organization_legal_holds hold WHERE hold.organization_id=${alias}.organization_id AND hold.status='active'
    AND(hold.scope_kind='organization' OR hold.scope_kind='project' AND hold.resource_id=${alias}.project_access_id
      OR hold.scope_kind='artifact' AND hold.resource_id=${alias}.artifact_id))`;
const artifactContentHoldSql=(content:string,artifact:string)=>`EXISTS(SELECT 1 FROM organization_legal_holds hold
    WHERE hold.organization_id=${artifact}.organization_id AND hold.status='active'
      AND(hold.scope_kind='organization' OR hold.scope_kind='project' AND hold.resource_id=${artifact}.project_access_id
        OR hold.scope_kind='artifact' AND hold.resource_id=${artifact}.resource_id OR hold.scope_kind='content' AND hold.resource_id=${content}.content_id))
  OR EXISTS(SELECT 1 FROM organization_retention_policies policy JOIN private_content_retention_scopes retention
      ON retention.organization_id=policy.organization_id AND retention.content_id=${content}.content_id
        AND retention.project_access_id=${artifact}.project_access_id AND retention.classification='governed-evidence'
    WHERE policy.organization_id=${artifact}.organization_id AND policy.legal_hold=1)`;

export type ProjectRequestContext={
  contextId:string;organizationId:string;projectAccessId:string;projectId:string;ownerUserId:string;
  principalUserId:string;role:string;permissions:FormaCapability[];expiresAt:string;
};

/** Resolve billing only from an exact, active owner/document/tenant relationship. */
export async function ownerDocumentBudgetScopes(env:WorkerEnv,userId:string,documentId:string,verifiedProjectId=""){
  if(!userId||!documentId)return[];
  const rows=await env.DB.prepare(`SELECT project.organization_id,project.project_access_id
    FROM organization_projects project
    JOIN project_migration_states migration ON migration.project_access_id=project.project_access_id AND migration.organization_id=project.organization_id AND migration.owner_user_id=project.owner_user_id AND migration.status='active'
    JOIN organizations organization ON organization.organization_id=project.organization_id AND organization.status='active'
    JOIN organization_memberships membership ON membership.organization_id=project.organization_id AND membership.user_id=?
      AND membership.status='active' AND membership.accepted_at IS NOT NULL AND membership.revoked_at IS NULL
    JOIN budget_scope_policies policy ON policy.scope='workspace' AND policy.scope_id=project.organization_id AND policy.organization_id=project.organization_id
    WHERE project.owner_user_id=? AND project.status='active' AND
      ((?<>'' AND project.project_id=?) OR (?='' AND EXISTS(
        SELECT 1 FROM project_resource_scopes resource WHERE resource.project_access_id=project.project_access_id
          AND resource.organization_id=project.organization_id AND resource.project_id=project.project_id
          AND resource.owner_user_id=project.owner_user_id AND resource.resource_kind='document' AND resource.resource_id=?
      )))
    LIMIT 2`).bind(userId,userId,verifiedProjectId,verifiedProjectId,verifiedProjectId,documentId).all<{organization_id:string;project_access_id:string}>();
  return rows.results.map((row)=>({organizationId:String(row.organization_id),projectAccessId:String(row.project_access_id),actorUserId:userId}));
}

/** An absent context cookie is not permission to bill tenant work to a personal account. */
export async function resolveOwnerExecutionScope(env:WorkerEnv,user:PilotUser,documentId:string,projectId:string,authority:"execute"|"author"|"read"="execute"){
  const custody=await env.DB.prepare(`SELECT project_access_id,organization_id,owner_user_id FROM organization_projects
    WHERE project_id=? AND (owner_user_id=? OR EXISTS(SELECT 1 FROM project_resource_scopes resource
      WHERE resource.project_access_id=organization_projects.project_access_id AND resource.resource_kind='document'
        AND resource.resource_id=? AND resource.owner_user_id=?)) LIMIT 2`)
    .bind(projectId,user.userId,documentId,user.userId).all<{project_access_id:string;organization_id:string;owner_user_id:string}>();
  const resources=await env.DB.prepare("SELECT DISTINCT project_access_id,organization_id,project_id FROM project_resource_scopes WHERE owner_user_id=? AND resource_kind='document' AND resource_id=? LIMIT 2")
    .bind(user.userId,documentId).all<{project_access_id:string;organization_id:string;project_id:string}>();
  const eventCustody=await env.DB.prepare("SELECT DISTINCT project_access_id,organization_id FROM project_event_scopes WHERE owner_user_id=? AND project_id=? LIMIT 2")
    .bind(user.userId,projectId).all<{project_access_id:string;organization_id:string}>();
  if(!custody.results.length)return{scope:undefined,denied:Boolean(resources.results.length||eventCustody.results.length)};
  if(resources.results.some((row)=>row.project_id!==projectId||row.project_access_id!==custody.results[0].project_access_id||row.organization_id!==custody.results[0].organization_id)
    ||eventCustody.results.some((row)=>row.project_access_id!==custody.results[0].project_access_id||row.organization_id!==custody.results[0].organization_id))return{scope:undefined,denied:true};
  const active=authority==="execute"?await ownerDocumentBudgetScopes(env,user.userId,documentId,projectId):(await env.DB.prepare(`SELECT project.organization_id,project.project_access_id
    FROM organization_projects project JOIN organizations organization ON organization.organization_id=project.organization_id AND organization.status='active'
    JOIN project_migration_states migration ON migration.project_access_id=project.project_access_id AND migration.organization_id=project.organization_id AND migration.owner_user_id=project.owner_user_id AND migration.status='active'
    JOIN organization_memberships member ON member.organization_id=project.organization_id AND member.user_id=project.owner_user_id AND member.status='active' AND member.revoked_at IS NULL AND member.accepted_at IS NOT NULL
    WHERE project.project_id=? AND project.owner_user_id=? AND project.status='active' LIMIT 2`).bind(projectId,user.userId).all<{organization_id:string;project_access_id:string}>()).results.map((row)=>({organizationId:row.organization_id,projectAccessId:row.project_access_id,actorUserId:user.userId}));
  if(custody.results.length!==1||active.length!==1||active[0].projectAccessId!==custody.results[0].project_access_id
    ||!hasCapability(user,authority==="read"?"project.read":"project.author",active[0])||authority==="execute"&&!hasCapability(user,"project.output.request",active[0]))return{scope:undefined,denied:true as const};
  return{scope:{...active[0],projectId,ownerUserId:user.userId},denied:false as const};
}

const readCookie=(request:Request,name:string)=>{
  const value=request.headers.get("cookie")?.split(";").map((part)=>part.trim()).find((part)=>part.startsWith(`${name}=`))?.slice(name.length+1)??"";
  try{return decodeURIComponent(value);}catch{return"";}
};

/** Presence only, using the resolver's exact first-cookie/decode semantics; not authority. */
export const hasProjectContextCookie=(request:Request)=>Boolean(readCookie(request,CONTEXT_COOKIE));

export const projectContextCookie=(request:Request,value:string,maxAge:number)=>`${CONTEXT_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(request.url).protocol==="https:"?"; Secure":""}`;

export function rejectProjectContext(request:Request,error="project_access_revoked"){
  return Response.json({error},{status:403,headers:{"set-cookie":projectContextCookie(request,"",0),"cache-control":"private, no-store"}});
}

/** Resolve the opaque selection against live membership and migration state on every request. */
export async function readProjectRequestContext(request:Request,env:WorkerEnv,principal:PilotUser):Promise<{context:ProjectRequestContext|null;response:Response|null}>{
  const contextId=readCookie(request,CONTEXT_COOKIE);
  if(!contextId)return{context:null,response:null};
  if(principal.fictional||readCookie(request,"forma_impersonation"))return{context:null,response:Response.json({error:"project_context_impersonation_unavailable"},{status:409,headers:{"set-cookie":projectContextCookie(request,"",0)}})};
  const now=new Date().toISOString();
  const row=await env.DB.prepare(`SELECT context.context_id,context.organization_id,context.project_access_id,context.expires_at,
      project.project_id,project.owner_user_id,CASE WHEN project.owner_user_id=? THEN 'owner' ELSE project_member.role END AS role
    FROM project_context_sessions context
    JOIN organization_projects project ON project.project_access_id=context.project_access_id AND project.organization_id=context.organization_id AND project.status='active'
    JOIN project_migration_states migration ON migration.project_access_id=project.project_access_id AND migration.organization_id=project.organization_id AND migration.status='active'
    JOIN organizations organization ON organization.organization_id=project.organization_id AND organization.status='active'
    JOIN organization_memberships member ON member.organization_id=project.organization_id AND member.user_id=? AND member.status='active' AND member.accepted_at IS NOT NULL AND member.revoked_at IS NULL
    JOIN organization_memberships owner_member ON owner_member.organization_id=project.organization_id AND owner_member.user_id=project.owner_user_id
      AND owner_member.status='active' AND owner_member.accepted_at IS NOT NULL AND owner_member.revoked_at IS NULL
    LEFT JOIN project_memberships project_member ON project_member.project_access_id=project.project_access_id AND project_member.organization_id=project.organization_id AND project_member.project_id=project.project_id AND project_member.user_id=? AND project_member.status='active' AND project_member.revoked_at IS NULL
    WHERE context.context_id=? AND context.principal_user_id=? AND context.revoked_at IS NULL AND context.expires_at>?
      AND (project.owner_user_id=? OR project_member.membership_id IS NOT NULL)
      AND NOT EXISTS(SELECT 1 FROM pilot_cohorts cohort WHERE cohort.organization_id=project.organization_id AND cohort.status IN ('active','paused','closed')
        AND (cohort.status!='closed' OR NOT EXISTS(SELECT 1 FROM pilot_cohorts successor WHERE successor.organization_id=cohort.organization_id AND successor.status IN ('active','paused')))
        AND NOT EXISTS(SELECT 1 FROM pilot_participants participant WHERE participant.cohort_id=cohort.cohort_id AND participant.organization_id=project.organization_id
          AND participant.user_id=? AND participant.status='active' AND participant.revoked_at IS NULL))`)
    .bind(principal.userId,principal.userId,principal.userId,contextId,principal.userId,now,principal.userId,principal.userId).first<Record<string,unknown>>();
  if(!row)return{context:null,response:rejectProjectContext(request)};
  const scope={organizationId:String(row.organization_id),projectAccessId:String(row.project_access_id)};
  if(!hasCapability(principal,"project.read",scope))return{context:null,response:rejectProjectContext(request)};
  const permissions=FORMA_CAPABILITIES.filter((capability)=>capability.startsWith("project.")&&hasCapability(principal,capability,scope));
  const effectiveRole=principal.access.projects.find((project)=>project.organizationId===scope.organizationId&&project.projectAccessId===scope.projectAccessId)?.role??String(row.role);
  return{response:null,context:{contextId,organizationId:scope.organizationId,projectAccessId:scope.projectAccessId,projectId:String(row.project_id),ownerUserId:String(row.owner_user_id),principalUserId:principal.userId,role:effectiveRole,permissions,expiresAt:String(row.expires_at)}};
}

type ProjectIndex={
  projectId:string;documentIds:Set<string>;blockIds:Set<string>;relationIds:Set<string>;collectionIds:Set<string>;
  outputIds:Set<string>;artifactIds:Set<string>;generationIds:Set<string>;referenceIds:Set<string>;canvasIds:Set<string>;
  canvasItemIds:Set<string>;arrangementIds:Set<string>;contextSetIds:Set<string>;
  canvasItemBoards:Map<string,string>;arrangementBoards:Map<string,string>;contextSetBoards:Map<string,string>;
};

function scopedEvent(event:CreativeEvent,index:ProjectIndex){
  if(!PROJECT_EVENT_TYPES.has(event.type))return false;
  if(event.type==="AssistantReasoned"&&event.payload.operation!=="creative-chat")return false;
  const payload=event.payload;
  if(event.type.startsWith("Project"))return String(payload.project_id??"")===index.projectId;
  const explicit=String(payload.project_id??"");
  if(explicit&&explicit!==index.projectId)return false;
  if(isOutputRequirementEvent(event.type))return explicit===index.projectId&&index.documentIds.has(String(payload.document_id??""));
  if(event.type==="OutputRenamed"){
    const documentId=String(payload.document_id??""),id=String(payload.output_id??"");
    if(explicit!==index.projectId||!documentId||!index.documentIds.has(documentId)||!id)return false;
    return payload.output_kind==="image"
      ?String(payload.object_id??"")===id&&!payload.artifact_id&&index.outputIds.has(id)
      :payload.output_kind==="artifact"&&String(payload.artifact_id??"")===id&&!payload.object_id&&index.artifactIds.has(id);
  }
  const canvas=String(payload.canvas_id??payload.source_canvas_id??"");
  if(PROJECT_CANVAS_MUTATION_TYPES.has(event.type)){
    if(!canvas||!index.canvasIds.has(canvas))return false;
    const item=String(payload.item_id??payload.reference_item_id??"");
    if(item&&(!index.canvasItemIds.has(item)||index.canvasItemBoards.get(item)!==canvas))return false;
    const arrangement=String(payload.arrangement_id??"");
    if(arrangement&&(!index.arrangementIds.has(arrangement)||index.arrangementBoards.get(arrangement)!==canvas))return false;
    const contextSet=String(payload.context_set_id??"");
    if(contextSet&&(!index.contextSetIds.has(contextSet)||index.contextSetBoards.get(contextSet)!==canvas))return false;
    return true;
  }
  const documentId=String(payload.document_id??"");
  if(documentId)return index.documentIds.has(documentId);
  const blockId=String(payload.block_id??"");
  if(blockId)return index.blockIds.has(blockId);
  const from=String(payload.from_block_id??""),to=String(payload.to_block_id??"");
  if(from||to)return Boolean(from&&to&&index.blockIds.has(from)&&index.blockIds.has(to));
  const relation=String(payload.relation_id??"");
  if(relation)return index.relationIds.has(relation);
  const collection=String(payload.collection_id??payload.to_collection_id??payload.from_collection_id??"");
  if(collection)return index.collectionIds.has(collection);
  const object=String(payload.object_id??payload.item_id??"");
  if(object)return index.outputIds.has(object)||index.artifactIds.has(object)||index.blockIds.has(object)||index.documentIds.has(object);
  const artifact=String(payload.artifact_id??"");
  if(artifact)return index.artifactIds.has(artifact);
  const generation=String(payload.generation_id??"");
  if(generation)return index.generationIds.has(generation);
  const reference=String(payload.reference_id??"");
  if(reference)return index.referenceIds.has(reference);
  if(canvas)return index.canvasIds.has(canvas);
  const ids=Array.isArray(payload.object_ids)?payload.object_ids.map(String):[];
  if(ids.length)return ids.every((id)=>index.outputIds.has(id));
  return Boolean(explicit&&explicit===index.projectId);
}

const mediaKey=(value:unknown)=>{
  const prefix="/api/media/";
  if(typeof value!=="string"||!value.startsWith(prefix))return"";
  try{return decodeURIComponent(value.slice(prefix.length));}catch{return"";}
};

/** A generated model can contain a primary mesh, other export formats, textures and previews. */
const artifactMediaKeys=(artifact:CreativeProjection["libraryArtifacts"][number])=>{
  const modelFiles=artifact.kind==="model3d"&&Array.isArray(artifact.settings.model3d_files)?artifact.settings.model3d_files:[];
  return [artifact.mediaUrl,...artifact.items.map((item)=>item.mediaUrl),...modelFiles.flatMap((file)=>
    file&&typeof file==="object"&&!Array.isArray(file)?[(file as Record<string,unknown>).url]:[])]
    .map(mediaKey).filter(Boolean);
};

export type ProjectPublicationResource={kind:string;id:string;visibility:"collaborative_output"|"actor_private"|"internal";sourceEventId:string|null;actorUserId:string};

/** One resource mapping serves full synchronization and trusted native publication. */
export function projectPublicationResources(outputs:CreativeProjection["libraryOutputs"],artifacts:CreativeProjection["libraryArtifacts"],sourceActor:(sourceEventId:string|null)=>string){
  const resources:ProjectPublicationResource[]=[];
  const add=(kind:string,id:string,sourceEventId:string|null,visibility:ProjectPublicationResource["visibility"]="collaborative_output")=>{
    if(id)resources.push({kind,id,visibility,sourceEventId,actorUserId:sourceActor(sourceEventId)});
  };
  for(const output of outputs)add("output",output.id,output.sourceEventId);
  for(const artifact of artifacts)add("artifact",artifact.id,artifact.sourceEventId);
  for(const output of outputs)if(output.mediaUrl)add("media",mediaKey(output.mediaUrl),output.sourceEventId);
  for(const artifact of artifacts){
    if(artifact.contentRef)add("content",artifact.contentRef,artifact.sourceEventId);
    if(artifact.inputRef)add("content",artifact.inputRef,artifact.sourceEventId,"actor_private");
    for(const key of new Set(artifactMediaKeys(artifact)))add("media",key,artifact.sourceEventId);
  }
  return resources;
}

export function prepareProjectResourceScopeStatement(env:WorkerEnv,scope:ProjectSourceScope,resource:ProjectPublicationResource,createdAt:string,requireSourceEvent=false){
  return env.DB.prepare(`INSERT OR IGNORE INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at)
    ${requireSourceEvent?"SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM events WHERE event_id=?)":"VALUES(?,?,?,?,?,?,?,?,?,?)"}`)
    .bind(scope.projectAccessId,resource.kind,resource.id,scope.organizationId,scope.projectId,scope.ownerUserId,resource.visibility,resource.sourceEventId,resource.actorUserId,createdAt,...(requireSourceEvent?[resource.sourceEventId]:[]));
}

/** Reuse the ordinary event allowlist and document membership predicate. */
export function projectDocumentPublicationEvents(events:CreativeEvent[],projectId:string,documentId:string|null){
  const empty=new Set<string>();
  const index:ProjectIndex={projectId,documentIds:new Set(documentId?[documentId]:[]),blockIds:empty,relationIds:empty,collectionIds:empty,outputIds:empty,artifactIds:empty,
    generationIds:empty,referenceIds:empty,canvasIds:empty,canvasItemIds:empty,arrangementIds:empty,contextSetIds:empty,
    canvasItemBoards:new Map(),arrangementBoards:new Map(),contextSetBoards:new Map()};
  return events.filter((event)=>(documentId?event.payload.document_id===documentId:!event.payload.document_id)&&scopedEvent(event,index));
}

/** Rebuild an exact manifest from one immutable owner history; ambiguous/private rows never enter it. */
export async function synchronizeProjectScope(env:WorkerEnv,input:{organizationId:string;projectAccessId:string;projectId:string;ownerUserId:string}){
  const ownerStream=`creative:${input.ownerUserId}`;
  const ledgerDb=env.DB;
  const {structuredConversationLedgerSchema}=await import("./memory-live-store.ts");
  const ledgerSchema=await structuredConversationLedgerSchema(env);
  const {nativeStructuredOriginSchema,nativeStructuredOriginMinimizedIntegrity}=await import("./memory-native-origin.ts");
  const originSchema=await nativeStructuredOriginSchema(env);
  const minimizedIntegrity=originSchema.present?nativeStructuredOriginMinimizedIntegrity():{sql:"1",bindings:[]};
  const ledgerSchemaAssertion=()=>ledgerDb.prepare(`SELECT CASE WHEN (${ledgerSchema.guard.condition}) AND (${originSchema.guard.condition}) AND (${minimizedIntegrity.sql}) THEN 1
    ELSE json('memory_structured_schema_changed') END AS verified`).bind(...ledgerSchema.guard.bindings,...originSchema.guard.bindings,...minimizedIntegrity.bindings);
  const sameLedgerDatabase=()=>{if(env.DB!==ledgerDb)throw new Error("memory_structured_database_changed");};
  // An incomplete acknowledgement is unconfirmed, not evidence that earlier chunks rolled back.
  const confirmLedgerBatch=(results:Awaited<ReturnType<WorkerEnv["DB"]["batch"]>>,count:number)=>{
    if(!Array.isArray(results)||results.length!==count||Array.from(results).some(result=>!result||typeof result!=="object"||Array.isArray(result)
      ||!Object.hasOwn(result,"success")||result.success!==true||(result as typeof result & {error?: unknown}).error!==undefined
      ||!Object.hasOwn(result,"results")||!Array.isArray(result.results)))throw new Error("project_scope_sync_unconfirmed");
    for(const index of [0,count-1]){
      const rows=results[index]!.results;
      if(rows.length!==1||!rows[0]||typeof rows[0]!=="object"||Array.isArray(rows[0])
        ||Object.keys(rows[0]).length!==1||Object.keys(rows[0])[0]!=="verified"
        ||(rows[0] as Record<string,unknown>).verified!==1)throw new Error("project_scope_sync_unconfirmed");
    }
    for(let index=1;index<count-1;index++){
      const result=results[index]!,meta=result.meta,changes=meta?.changes;
      if(!Object.hasOwn(result,"meta")||!meta||typeof meta!=="object"||Array.isArray(meta)||!Object.hasOwn(meta,"changes")
        ||!Number.isSafeInteger(changes)||Number(changes)<0)throw new Error("project_scope_sync_unconfirmed");
    }
  };
  sameLedgerDatabase();
  // Canonical minimized headers grant no custody, and their removed scope fields
  // are never interpreted as personal scope. Reject recreated answer/manifest
  // bodies or sidecars even when the ordinary project fast path would return.
  // The user's original authored content is deliberately outside this proof.
  const originIntegrity=await ledgerSchemaAssertion().all();
  sameLedgerDatabase();
  confirmLedgerBatch([originIntegrity],1);
  // The fast-path decision and its exact custody counts share one SQLite snapshot.
  const state=await env.DB.prepare(`SELECT CASE WHEN (${ledgerSchema.guard.condition}) AND (${originSchema.guard.condition}) AND (${minimizedIntegrity.sql}) THEN 1
      ELSE json('memory_structured_schema_changed') END AS origin_integrity,migration.status,migration.last_owner_sequence,
    (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?) AS owner_head,
    (SELECT COALESCE(MAX(project_sequence),0) FROM project_event_scopes WHERE project_access_id=? AND organization_id=? AND project_id=? AND owner_user_id=?) AS event_count,
    (SELECT COUNT(*) FROM project_resource_scopes WHERE project_access_id=? AND organization_id=? AND project_id=? AND owner_user_id=? AND resource_kind='document') AS document_count,
    EXISTS(SELECT 1 FROM project_resource_scopes WHERE project_access_id=? AND organization_id=? AND project_id=? AND owner_user_id=? AND resource_kind='manifest_version' AND resource_id='canvas-v1') AS manifest_current
    FROM project_migration_states migration WHERE migration.project_access_id=? AND migration.organization_id=? AND migration.owner_user_id=?`)
    .bind(...ledgerSchema.guard.bindings,...originSchema.guard.bindings,...minimizedIntegrity.bindings,ownerStream,input.projectAccessId,input.organizationId,input.projectId,input.ownerUserId,
      input.projectAccessId,input.organizationId,input.projectId,input.ownerUserId,input.projectAccessId,input.organizationId,input.projectId,input.ownerUserId,
      input.projectAccessId,input.organizationId,input.ownerUserId)
    .first<{origin_integrity:number;status:string;last_owner_sequence:number;owner_head:number;event_count:number;document_count:number;manifest_current:number}>();
  sameLedgerDatabase();
  if(state&&state.origin_integrity!==1)throw new Error("project_scope_sync_unconfirmed");
  if(state?.status==="active"&&Number(state.last_owner_sequence)===Number(state.owner_head)&&Number(state.manifest_current)===1)
    return{eventCount:Number(state.event_count),documentCount:Number(state.document_count)};
  const events=await readEvents(env,ownerStream);
  const projection=foldEvents(events,Number.POSITIVE_INFINITY,"",input.projectId);
  if(!projection.projects.some((project)=>project.id===input.projectId))throw new Error("owned_project_required");
  const documentIds=new Set(projection.documents.map((document)=>document.id));
  // The legacy account-wide projection deliberately retains orphaned historical
  // outputs. A collaborator must never inherit those ambiguous owner assets.
  const projectOutputs=projection.libraryOutputs.filter((output)=>documentIds.has(output.documentId));
  const projectArtifacts=projection.libraryArtifacts.filter((artifact)=>documentIds.has(artifact.documentId));
  const blockIds=new Set(projection.libraryBlocks.map((block)=>block.id));
  const relationIds=new Set(projection.libraryBlockRelations.map((relation)=>relation.id));
  const collectionIds=new Set(projection.collections.map((collection)=>collection.id));
  const outputIds=new Set(projectOutputs.map((output)=>output.id));
  const artifactIds=new Set(projectArtifacts.map((artifact)=>artifact.id));
  const generationIds=new Set(projectOutputs.map((output)=>output.generationId).filter(Boolean));
  const referenceIds=new Set(projection.libraryBlocks.flatMap((block)=>[block.properties.reference_id,block.properties.model_reference_id]).map((value)=>String(value??"")).filter(Boolean));
  const referenceMedia=projection.libraryBlocks.flatMap((block)=>[block.properties.media_url,block.properties.model_url]
    .map((url)=>({key:mediaKey(url),sourceEventId:block.sourceEvents.at(-1)??null}))).filter((item)=>item.key);
  // Preserve custody, not read authority: historical/retiring revision bodies may still await held-data cleanup.
  // Matching stored hashes are not proof of the body bytes; the ledger reader independently verifies them.
  const structuredLedgerCustody=ledgerSchema.present?`EXISTS(SELECT 1 FROM memory_structured_conversation_heads ledger_head
    JOIN memory_structured_conversation_revisions ledger_revision ON ledger_revision.ledger_id=ledger_head.ledger_id
    JOIN private_content ledger_body ON ledger_body.content_id=ledger_revision.body_ref
    JOIN private_content_retention_scopes ledger_retention ON ledger_retention.content_id=ledger_body.content_id
    WHERE resource.resource_kind='content' AND resource.visibility='actor_private'
      AND (ledger_head.actor_user_id,ledger_head.owner_user_id,ledger_head.organization_id,ledger_head.project_access_id,ledger_head.project_id)
        IS (resource.actor_user_id,resource.owner_user_id,resource.organization_id,resource.project_access_id,resource.project_id)
      AND ledger_head.actor_user_id=ledger_head.owner_user_id AND ledger_head.state IN('active','retiring')
      AND ledger_revision.revision>0 AND ledger_revision.revision<=ledger_head.storage_revision
      AND ledger_revision.schema_version=1 AND ledger_revision.recipe_version='native-declared-ledger-v1'
      AND ledger_body.content_id=resource.resource_id AND ledger_body.kind='memory-structured-ledger'
      AND ledger_body.owner_id=ledger_head.actor_user_id AND ledger_body.created_at=ledger_revision.created_at
      AND (typeof(ledger_body.expires_at)='text' AND length(ledger_body.expires_at)=24
        AND strftime('%Y-%m-%dT%H:%M:%fZ',ledger_body.expires_at)=ledger_body.expires_at)
      AND (typeof(ledger_revision.expires_at)='text' AND length(ledger_revision.expires_at)=24
        AND strftime('%Y-%m-%dT%H:%M:%fZ',ledger_revision.expires_at)=ledger_revision.expires_at)
      AND ledger_body.expires_at<=ledger_revision.expires_at
      AND (ledger_retention.organization_id,ledger_retention.project_access_id,ledger_retention.project_id,ledger_retention.actor_user_id)
        IS (resource.organization_id,resource.project_access_id,resource.project_id,resource.actor_user_id)
      AND ledger_retention.classification='transient-private' AND typeof(ledger_retention.policy_version)='integer'
      AND ledger_retention.policy_version BETWEEN 0 AND 9007199254740991 AND ledger_retention.created_at=ledger_body.created_at
      AND (typeof(ledger_retention.assigned_expires_at)='text' AND length(ledger_retention.assigned_expires_at)=24
        AND strftime('%Y-%m-%dT%H:%M:%fZ',ledger_retention.assigned_expires_at)=ledger_retention.assigned_expires_at)
      AND ledger_retention.assigned_expires_at<=ledger_revision.expires_at)`:'0';
  // Durable origin headers retain custody independently of removed ledger/enrollment
  // rows. This does not restore answer visibility or validate manifest prose.
  const structuredOriginCustody=originSchema.present?`EXISTS(SELECT 1 FROM memory_structured_answer_origins origin
    JOIN private_content origin_body ON origin_body.content_id IN(origin.answer_content_id,origin.manifest_content_ref)
    JOIN private_content_retention_scopes origin_retention ON origin_retention.content_id=origin_body.content_id
    WHERE resource.resource_kind='content' AND resource.visibility='actor_private'
      AND (origin.actor_user_id,origin.owner_user_id,origin.organization_id,origin.project_access_id,origin.project_id)
        IS (resource.actor_user_id,resource.owner_user_id,resource.organization_id,resource.project_access_id,resource.project_id)
      AND origin.schema_version=1 AND origin.recipe_version='native-structured-answer-origin-v1' AND origin.status IN('active','withdrawn')
      AND origin_body.content_id=resource.resource_id AND origin_body.owner_id=origin.actor_user_id
      AND origin_body.kind=CASE WHEN origin_body.content_id=origin.manifest_content_ref THEN 'memory-structured-origin' ELSE 'chat-assistant-memory' END
      AND origin_body.created_at=origin.created_at AND resource.created_at=origin.created_at AND resource.source_event_id IS NULL
      AND typeof(origin.created_at)='text' AND length(origin.created_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',origin.created_at)=origin.created_at
      AND typeof(origin_body.expires_at)='text' AND length(origin_body.expires_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',origin_body.expires_at)=origin_body.expires_at
      AND typeof(origin.source_retention_ceiling)='text' AND length(origin.source_retention_ceiling)=24
        AND strftime('%Y-%m-%dT%H:%M:%fZ',origin.source_retention_ceiling)=origin.source_retention_ceiling
      AND typeof(origin.answer_expires_at)='text' AND length(origin.answer_expires_at)=24
        AND strftime('%Y-%m-%dT%H:%M:%fZ',origin.answer_expires_at)=origin.answer_expires_at
      AND typeof(origin.manifest_expires_at)='text' AND length(origin.manifest_expires_at)=24
        AND strftime('%Y-%m-%dT%H:%M:%fZ',origin.manifest_expires_at)=origin.manifest_expires_at
      AND origin_body.expires_at<=origin.source_retention_ceiling
      AND origin_body.expires_at<=CASE WHEN origin_body.content_id=origin.manifest_content_ref THEN origin.manifest_expires_at ELSE origin.answer_expires_at END
      AND (origin_retention.organization_id,origin_retention.project_access_id,origin_retention.project_id,origin_retention.actor_user_id)
        IS (resource.organization_id,resource.project_access_id,resource.project_id,resource.actor_user_id)
      AND origin_retention.classification='transient-private' AND typeof(origin_retention.policy_version)='integer'
      AND origin_retention.policy_version BETWEEN 0 AND 9007199254740991 AND origin_retention.created_at=origin_body.created_at
      AND typeof(origin_retention.assigned_expires_at)='text' AND length(origin_retention.assigned_expires_at)=24
        AND strftime('%Y-%m-%dT%H:%M:%fZ',origin_retention.assigned_expires_at)=origin_retention.assigned_expires_at
      AND origin_retention.assigned_expires_at<=origin.source_retention_ceiling
      AND origin_retention.assigned_expires_at<=CASE WHEN origin_body.content_id=origin.manifest_content_ref THEN origin.manifest_expires_at ELSE origin.answer_expires_at END)`:'0';
  const previousResources=await env.DB.prepare(`SELECT resource.resource_kind,resource.resource_id,resource.source_event_id,resource.actor_user_id,
    ${structuredLedgerCustody} AS private_structured_ledger,
    ${structuredOriginCustody} AS private_structured_origin,
    CASE WHEN retained.content_id IS NULL THEN 0 ELSE 1 END AS private_provider_response
    FROM project_resource_scopes resource LEFT JOIN private_content retained ON resource.resource_kind='content'
      AND retained.content_id=resource.resource_id AND retained.owner_id=resource.actor_user_id
      AND(retained.kind IN('provider-response','assistant-action')
        OR retained.kind IN('chat-user','chat-assistant','chat-assistant-memory') AND resource.visibility='actor_private' AND retained.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
          AND EXISTS(SELECT 1 FROM private_content_retention_scopes conversation
            JOIN organization_projects current_project ON current_project.project_access_id=conversation.project_access_id
              AND current_project.organization_id=conversation.organization_id AND current_project.project_id=conversation.project_id
              AND current_project.owner_user_id=resource.owner_user_id AND current_project.status='active'
            JOIN organizations current_organization ON current_organization.organization_id=current_project.organization_id AND current_organization.status='active'
            JOIN organization_memberships current_actor ON current_actor.organization_id=current_project.organization_id AND current_actor.user_id=resource.actor_user_id
              AND current_actor.status='active' AND current_actor.accepted_at IS NOT NULL AND current_actor.revoked_at IS NULL
            WHERE conversation.content_id=retained.content_id AND conversation.organization_id=resource.organization_id
              AND conversation.project_access_id=resource.project_access_id AND conversation.project_id=resource.project_id
              AND conversation.actor_user_id=resource.actor_user_id AND conversation.classification='transient-private')
        OR retained.kind IN('execution-consent','context-proposal','authoring-preview') AND resource.visibility='actor_private'
          AND EXISTS(SELECT 1 FROM private_content_retention_scopes governed WHERE governed.content_id=retained.content_id
            AND governed.organization_id=resource.organization_id AND governed.project_access_id=resource.project_access_id
            AND governed.project_id=resource.project_id AND governed.actor_user_id=resource.actor_user_id
            AND governed.classification='governed-evidence')
        OR retained.kind IN('document-artifact-input','activity-issue-note') AND json_valid(retained.content)=1
        AND EXISTS(SELECT 1 FROM project_resource_scopes anchored JOIN document_jobs job ON job.job_id=anchored.resource_id
          WHERE anchored.resource_kind='job' AND anchored.project_access_id=resource.project_access_id
            AND anchored.organization_id=resource.organization_id AND anchored.project_id=resource.project_id
            AND anchored.owner_user_id=resource.owner_user_id AND anchored.actor_user_id=resource.actor_user_id
            AND job.owner_id=resource.actor_user_id AND job.job_id=json_extract(retained.content,'$.job_id')
            AND job.document_id=json_extract(retained.content,'$.document_id')
            AND(retained.kind!='activity-issue-note' OR json_extract(retained.content,'$.actor_user_id')=resource.actor_user_id
              AND EXISTS(SELECT 1 FROM events issue_note WHERE issue_note.stream_id=job.stream_id
                AND issue_note.actor='user:'||resource.actor_user_id AND issue_note.type='ActivityIssueNoted'
                AND json_extract(issue_note.payload,'$.note_ref')=retained.content_id
                AND json_extract(issue_note.payload,'$.job_id')=job.job_id
                AND json_extract(issue_note.payload,'$.document_id')=job.document_id))))
      AND retained.redacted_at IS NULL AND retained.expires_at>?
    WHERE resource.project_access_id=? AND resource.organization_id=?`)
    .bind(new Date().toISOString(),input.projectAccessId,input.organizationId).all<{resource_kind:string;resource_id:string;source_event_id:string|null;actor_user_id:string;private_structured_ledger:number;private_structured_origin:number;private_provider_response:number}>();
  const actorJobs=previousResources.results.filter((resource)=>resource.resource_kind==="job");
  const actorByJobCorrelation=new Map<string,string>();
  if(actorJobs.length){
    const actorsByJobId=new Map(actorJobs.map((resource)=>[resource.resource_id,resource.actor_user_id]));
    for(let offset=0;offset<actorJobs.length;offset+=90){
      const batch=actorJobs.slice(offset,offset+90);
      const jobs=await env.DB.prepare(`SELECT job_id,owner_id,correlation_id FROM document_jobs WHERE stream_id=? AND job_id IN(${batch.map(()=>"?").join(",")})`)
        .bind(ownerStream,...batch.map((resource)=>resource.resource_id)).all<{job_id:string;owner_id:string;correlation_id:string}>();
      for(const job of jobs.results)if(actorsByJobId.get(job.job_id)===job.owner_id)actorByJobCorrelation.set(job.correlation_id,job.owner_id);
    }
  }
  const conversationContent=events.filter((event)=>
    (event.type==="ChatMessageSent"||event.type==="AssistantReasoned"&&event.payload.operation==="creative-chat")
    &&documentIds.has(String(event.payload.document_id??""))&&event.payload.content_ref)
    .map((event)=>({id:String(event.payload.content_ref),sourceEventId:event.eventId,actor:event.actor.startsWith("user:")?event.actor.slice(5):actorByJobCorrelation.get(event.correlationId)??input.ownerUserId}));
  const projectCanvas=foldCanvasEvents(events,input.projectId);
  // Partition once so each board folds only its own events. Folding the entire
  // owner stream for every board made shared synchronization quadratic.
  const canvasEventsById=new Map<string,CreativeEvent[]>();
  const eventsById=new Map<string,CreativeEvent>();
  for(const event of events){
    eventsById.set(event.eventId,event);
    const board=String(event.payload.canvas_id??"");
    if(!board)continue;
    const boardEvents=canvasEventsById.get(board)??[];
    boardEvents.push(event);
    canvasEventsById.set(board,boardEvents);
  }
  const canvasBoards=projectCanvas.canvases.map((canvas)=>foldCanvasEvents(canvasEventsById.get(canvas.id)??[],input.projectId,canvas.id));
  const canvasIds=new Set(projectCanvas.canvases.map((canvas)=>canvas.id));
  const allItems=new Map(canvasBoards.flatMap((board)=>board.items.map((item)=>[item.id,item] as const)));
  const allContextSets=new Map(canvasBoards.flatMap((board)=>board.contextSets.map((contextSet)=>[contextSet.id,contextSet] as const)));
  const validSource=(kind:string,id:string,board:string)=>kind==="document"?documentIds.has(id):["block","reference","sketch"].includes(kind)?blockIds.has(id):kind==="output"?outputIds.has(id):kind==="artifact"?artifactIds.has(id):kind==="context"&&allContextSets.get(id)?.canvasId===board;
  const contextSets=canvasBoards.flatMap((board)=>board.contextSets.filter((contextSet)=>contextSet.itemIds.every((id)=>{
    const item=allItems.get(id);
    return Boolean(item&&item.canvasId===contextSet.canvasId&&validSource(item.sourceKind,item.sourceId,contextSet.canvasId));
  })));
  const contextSetIds=new Set(contextSets.map((contextSet)=>contextSet.id));
  const validItems=canvasBoards.flatMap((board)=>board.items.filter((item)=>item.sourceKind==="context"?contextSetIds.has(item.sourceId)&&allContextSets.get(item.sourceId)?.canvasId===item.canvasId:validSource(item.sourceKind,item.sourceId,item.canvasId)));
  const canvasItemIds=new Set(validItems.map((item)=>item.id));
  const activeItemBoards=new Map(validItems.map((item)=>[item.id,item.canvasId]));
  const validArrangements=canvasBoards.flatMap((board)=>board.arrangements.filter((arrangement)=>
    [...arrangement.itemIds,...arrangement.frames.map((frame)=>frame.itemId),...arrangement.previousFrames.map((frame)=>frame.itemId)]
      .every((id)=>activeItemBoards.get(id)===arrangement.canvasId)));
  const arrangementIds=new Set(validArrangements.map((arrangement)=>arrangement.id));
  const canvasItemBoards=new Map(activeItemBoards);
  const arrangementBoards=new Map(validArrangements.map((arrangement)=>[arrangement.id,arrangement.canvasId] as const));
  const contextSetBoards=new Map(contextSets.map((contextSet)=>[contextSet.id,contextSet.canvasId] as const));
  const historicalBoards=new Set([...canvasIds,...previousResources.results.filter((resource)=>resource.resource_kind==="canvas").map((resource)=>resource.resource_id)]);
  // Historical, authenticated placement metadata is needed to scope removal
  // events after their currently readable resource has disappeared.
  for(const resource of previousResources.results){
    const source=resource.source_event_id?eventsById.get(resource.source_event_id):undefined;
    if(!source)continue;
    const board=String(source.payload.canvas_id??"");
    if(!historicalBoards.has(board))continue;
    if(resource.resource_kind==="canvas_item"&&["CanvasItemPlaced","CanvasReferenceCreated"].includes(source.type)&&String(source.payload.item_id??source.payload.reference_item_id??"")===resource.resource_id)canvasItemBoards.set(resource.resource_id,board);
    if(resource.resource_kind==="canvas_arrangement"&&source.type==="CanvasArrangementCreated"&&String(source.payload.arrangement_id??"")===resource.resource_id)arrangementBoards.set(resource.resource_id,board);
    if(resource.resource_kind==="canvas_context"&&source.type==="ContextSetFormalized"&&String(source.payload.context_set_id??"")===resource.resource_id)contextSetBoards.set(resource.resource_id,board);
  }
  const historicalIds=(kind:string,current:Set<string>)=>new Set([...current,...previousResources.results.filter((resource)=>resource.resource_kind===kind).map((resource)=>resource.resource_id)]);
  // Previously visible identifiers must still attribute removal events, while
  // their current media/content permissions are revoked immediately below.
  const index={projectId:input.projectId,documentIds:historicalIds("document",documentIds),blockIds:historicalIds("block",blockIds),relationIds:historicalIds("relation",relationIds),collectionIds:historicalIds("collection",collectionIds),outputIds:historicalIds("output",outputIds),artifactIds:historicalIds("artifact",artifactIds),generationIds,referenceIds:historicalIds("reference",referenceIds),canvasIds:historicalIds("canvas",canvasIds),canvasItemIds:historicalIds("canvas_item",canvasItemIds),arrangementIds:historicalIds("canvas_arrangement",arrangementIds),contextSetIds:historicalIds("canvas_context",contextSetIds),canvasItemBoards,arrangementBoards,contextSetBoards};
  const existing=await env.DB.prepare("SELECT event_id,project_sequence FROM project_event_scopes WHERE project_access_id=? ORDER BY project_sequence").bind(input.projectAccessId).all<{event_id:string;project_sequence:number}>();
  const known=new Set(existing.results.map((row)=>row.event_id));
  let sequence=Number(existing.results.at(-1)?.project_sequence??0);
  const now=new Date().toISOString();
  const statements:D1PreparedStatement[]=[];
  const retainedResourceKeys=new Set(previousResources.results.map((resource)=>`${resource.resource_kind}\u0000${resource.resource_id}`));
  const activeResources=new Map<string,Set<string>>([
    ["project",new Set([input.projectId])],["document",documentIds],["block",blockIds],["relation",relationIds],
    ["collection",collectionIds],["output",outputIds],["artifact",artifactIds],["reference",referenceIds],["canvas",canvasIds],
    ["canvas_item",canvasItemIds],["canvas_arrangement",arrangementIds],["canvas_context",contextSetIds],["manifest_version",new Set(["canvas-v1"])],
    ["content",new Set([...projectOutputs.flatMap((output)=>[output.contentRef,output.promptRef]).filter((value):value is string=>Boolean(value)),...projectArtifacts.flatMap((artifact)=>[artifact.contentRef,artifact.inputRef]).filter((value):value is string=>Boolean(value)),...conversationContent.map((item)=>item.id),...previousResources.results.filter((resource)=>resource.resource_kind==="content"&&(resource.actor_user_id!==input.ownerUserId||resource.private_provider_response===1||resource.private_structured_ledger===1||resource.private_structured_origin===1)).map((resource)=>resource.resource_id)])],
    ["media",new Set([...projectOutputs.map((output)=>mediaKey(output.mediaUrl)),...projectArtifacts.flatMap(artifactMediaKeys),...referenceMedia.map((item)=>item.key)].filter(Boolean))],
  ]);
  for(const resource of previousResources.results){
    if(resource.resource_kind==="job"||resource.resource_kind==="share")continue;
    if(activeResources.get(resource.resource_kind)?.has(resource.resource_id))continue;
    // A freshly uploaded owner/editor reference may not yet have been attached to its first block.
    if(resource.resource_kind==="media"&&!resource.source_event_id){
      const pending=await env.DB.prepare("SELECT 1 AS present FROM project_resource_scopes WHERE project_access_id=? AND resource_kind='media' AND resource_id=? AND created_at>?")
        .bind(input.projectAccessId,resource.resource_id,new Date(Date.now()-15*60_000).toISOString()).first();
      if(pending)continue;
    }
    retainedResourceKeys.delete(`${resource.resource_kind}\u0000${resource.resource_id}`);
    statements.push(env.DB.prepare("DELETE FROM project_resource_scopes WHERE project_access_id=? AND organization_id=? AND resource_kind=? AND resource_id=?")
      .bind(input.projectAccessId,input.organizationId,resource.resource_kind,resource.resource_id));
  }
  const insertResource=(kind:string,id:string,visibility:ProjectPublicationResource["visibility"]="collaborative_output",sourceEventId:string|null=null,actorUserId=input.ownerUserId)=>{
    const key=`${kind}\u0000${id}`;
    if(!id||retainedResourceKeys.has(key))return; // The shared publication helper's INSERT OR IGNORE would be a no-op.
    retainedResourceKeys.add(key);
    // Old conversation/output references cannot recreate a minimized answer's
    // permission row. The live before/after integrity proof also rejects any
    // concurrent or trigger-created residue; original user content is unchanged.
    statements.push(originSchema.present&&kind==="content"?env.DB.prepare(`INSERT OR IGNORE INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at)
      SELECT ?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM memory_structured_answer_origins origin
        WHERE origin.status='minimized' AND (origin.answer_content_id=? OR origin.manifest_content_ref=?))`)
      .bind(input.projectAccessId,kind,id,input.organizationId,input.projectId,input.ownerUserId,visibility,sourceEventId,actorUserId,now,id,id)
      :prepareProjectResourceScopeStatement(env,input,{kind,id,visibility,sourceEventId,actorUserId},now));
  };
  insertResource("project",input.projectId);
  for(const id of documentIds)insertResource("document",id);
  for(const id of blockIds)insertResource("block",id);
  for(const id of relationIds)insertResource("relation",id);
  for(const id of collectionIds)insertResource("collection",id);
  const sourceActor=(sourceEventId:string|null)=>{const event=sourceEventId?eventsById.get(sourceEventId):undefined;return event?.actor.startsWith("user:")?event.actor.slice(5):event?actorByJobCorrelation.get(event.correlationId)??input.ownerUserId:input.ownerUserId;};
  const publicationResources=projectPublicationResources(projectOutputs,projectArtifacts,sourceActor);
  for(const resource of publicationResources.filter((resource)=>resource.kind==="output"||resource.kind==="artifact"))
    insertResource(resource.kind,resource.id,resource.visibility,resource.sourceEventId,resource.actorUserId);
  for(const id of referenceIds)insertResource("reference",id);
  for(const canvas of projectCanvas.canvases)insertResource("canvas",canvas.id,"collaborative_output",canvas.sourceEvents[0]??null);
  for(const item of validItems)insertResource("canvas_item",item.id,"collaborative_output",item.sourceEvents[0]??null);
  for(const arrangement of validArrangements)insertResource("canvas_arrangement",arrangement.id,"collaborative_output",arrangement.sourceEvents[0]??null);
  for(const contextSet of contextSets)insertResource("canvas_context",contextSet.id,"collaborative_output",contextSet.sourceEventId);
  insertResource("manifest_version","canvas-v1","internal");
  for(const item of referenceMedia)insertResource("media",item.key,"collaborative_output",item.sourceEventId);
  for(const resource of publicationResources.filter((resource)=>resource.kind!=="output"&&resource.kind!=="artifact"))
    insertResource(resource.kind,resource.id,resource.visibility,resource.sourceEventId,resource.actorUserId);
  for(const item of conversationContent)insertResource("content",item.id,"actor_private",item.sourceEventId,item.actor);
  for(const event of events){
    if(known.has(event.eventId)||!scopedEvent(event,index))continue;
    sequence+=1;
    const attributedActor=event.actor.startsWith("user:")?event.actor.slice(5):actorByJobCorrelation.get(event.correlationId)??input.ownerUserId;
    statements.push(env.DB.prepare("INSERT OR IGNORE INTO project_event_scopes(event_id,project_access_id,organization_id,project_id,owner_user_id,source_stream_id,source_sequence,project_sequence,actor_user_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .bind(event.eventId,input.projectAccessId,input.organizationId,input.projectId,input.ownerUserId,ownerStream,event.sequence,sequence,attributedActor,now));
  }
  for(let offset=0;offset<statements.length;offset+=75){
    sameLedgerDatabase();
    const chunk=statements.slice(offset,offset+75);
    const results=await ledgerDb.batch([ledgerSchemaAssertion(),...chunk,ledgerSchemaAssertion()]);
    sameLedgerDatabase();
    confirmLedgerBatch(results,chunk.length+2);
  }
  const ownerHead=events.at(-1)?.sequence??0;
  const activation=env.DB.prepare(`INSERT INTO project_migration_states(project_access_id,organization_id,owner_user_id,status,last_owner_sequence,updated_at)
    SELECT ?,?,?,'active',?,? WHERE EXISTS(SELECT 1 FROM organization_projects project
      JOIN organizations organization ON organization.organization_id=project.organization_id AND organization.status='active'
      JOIN organization_memberships owner ON owner.organization_id=project.organization_id AND owner.user_id=project.owner_user_id
        AND owner.status='active' AND owner.accepted_at IS NOT NULL AND owner.revoked_at IS NULL
      WHERE project.project_access_id=? AND project.organization_id=? AND project.owner_user_id=?
        AND project.status IN('indexing','active') AND ${effectivePilotParticipantSql("organization.organization_id","owner.user_id")})
    ON CONFLICT(project_access_id) DO UPDATE SET status='active',last_owner_sequence=excluded.last_owner_sequence,updated_at=excluded.updated_at
      WHERE project_migration_states.organization_id=excluded.organization_id
        AND project_migration_states.owner_user_id=excluded.owner_user_id`)
    .bind(input.projectAccessId,input.organizationId,input.ownerUserId,ownerHead,now,input.projectAccessId,input.organizationId,input.ownerUserId);
  sameLedgerDatabase();
  const activationResults=await ledgerDb.batch([ledgerSchemaAssertion(),activation,ledgerSchemaAssertion()]);
  sameLedgerDatabase();
  confirmLedgerBatch(activationResults,3);
  const activated=activationResults[1];
  if(Number(activated?.meta.changes??0)!==1)throw new Error("project_owner_authorization_changed");
  return{eventCount:sequence,documentCount:documentIds.size};
}

function redactProjectPayload(payload:Record<string,unknown>,contentIds:Set<string>,activeResources:Map<string,Set<string>>):Record<string,unknown>{
  const documentId=String(payload.document_id??"");
  const blockId=String(payload.block_id??"");
  const artifactId=String(payload.artifact_id??"");
  const canvasId=String(payload.canvas_id??"");
  const canvasItemId=String(payload.item_id??payload.reference_item_id??"");
  const arrangementId=String(payload.arrangement_id??"");
  const contextSetId=String(payload.context_set_id??"");
  const objectId=String(payload.object_id??(!canvasId?payload.item_id:"")??"");
  const removedDocument=Boolean(documentId&&!activeResources.get("document")?.has(documentId));
  const removedBlock=Boolean(blockId&&!activeResources.get("block")?.has(blockId));
  const removedArtifact=Boolean(artifactId&&!activeResources.get("artifact")?.has(artifactId));
  const removedObject=Boolean(objectId&&!activeResources.get("output")?.has(objectId)&&!activeResources.get("artifact")?.has(objectId)&&!activeResources.get("block")?.has(objectId));
  const removedCanvas=Boolean(canvasId&&!activeResources.get("canvas")?.has(canvasId));
  const removedCanvasItem=Boolean(canvasId&&canvasItemId&&!activeResources.get("canvas_item")?.has(canvasItemId));
  const removedArrangement=Boolean(canvasId&&arrangementId&&!activeResources.get("canvas_arrangement")?.has(arrangementId));
  const removedContextSet=Boolean(canvasId&&contextSetId&&!activeResources.get("canvas_context")?.has(contextSetId));
  if(removedDocument||removedBlock||removedArtifact||removedObject||removedCanvas||removedCanvasItem||removedArrangement||removedContextSet){
    return Object.fromEntries(Object.entries({project_id:payload.project_id,document_id:documentId||undefined,block_id:blockId||undefined,artifact_id:artifactId||undefined,object_id:objectId||undefined,canvas_id:canvasId||undefined,item_id:payload.item_id?canvasItemId:undefined,reference_item_id:payload.reference_item_id?canvasItemId:undefined,arrangement_id:arrangementId||undefined,context_set_id:contextSetId||undefined,removed:true}).filter(([,value])=>value!==undefined));
  }
  const redact=(value:unknown):unknown=>{
    if(Array.isArray(value))return value.map(redact);
    if(!value||typeof value!=="object")return value;
    const safe:Record<string,unknown>={};
    for(const [key,item] of Object.entries(value as Record<string,unknown>)){
      if(key==="model3d_current_projection"||/prompt|input_ref|planner_input|chat|attention|taste|authorization|credential|standing_constraints|preference_id|source_event_refs|evidence_refs|provider_(?:status|response|cancel)_url|provider_request|provider_response|(?:video|audio)_input_receipt|artifact_plan/i.test(key))continue;
      if(key==="content_ref"&&!contentIds.has(String(item)))continue;
      if(typeof item==="string"&&mediaKey(item)&&!activeResources.get("media")?.has(mediaKey(item)))continue;
      safe[key]=redact(item);
    }
    return safe;
  };
  return redact(payload) as Record<string,unknown>;
}

type ProjectPresentationResources=Map<string,Set<string>>&{retiredCanvasItems:Set<string>};

/** A read-only current-file witness from one already-authorized page snapshot.
 * No historical URL is restored and metadata-only readers never hydrate bodies. */
async function projectModel3dCurrentProjections(rows:Record<string,unknown>[],context:ProjectRequestContext,
  active:ProjectPresentationResources,resources:Record<string,unknown>[],contents:Record<string,unknown>[]){
  const result=new Map<string,Model3dCurrentProjection>();
  const resource=(kind:string,id:string,artifactId:string,documentId:string,contentRef:string)=>{
    const matches=resources.filter(row=>row.resource_kind===kind&&row.resource_id===id&&row.visibility==="collaborative_output"
      &&row.publication_project_id===context.projectId&&typeof row.publication_source_event_id==="string"&&row.publication_source_event_id
      &&row.publication_event_id===row.publication_source_event_id&&row.publication_artifact_id===artifactId
      &&row.publication_document_id===documentId&&row.publication_content_ref===contentRef&&row.publication_source_project_id===context.projectId);
    return matches.length===1?matches[0]:null;
  };
  for(const row of rows){
    const event=serializeEvent(row),p=event.payload;
    if(event.type!=="DocumentArtifactEdited"||row.model3d_current_edit_id!==event.eventId)continue;
    let operational:Record<string,unknown>;
    try{const value:unknown=typeof row.payload==="string"?JSON.parse(row.payload):row.payload;
      if(!value||typeof value!=="object"||Array.isArray(value))continue;operational=value as Record<string,unknown>;}catch{continue;}
    if(["artifact_id","artifact_kind","document_id","project_id","content_ref","revision","content_sha256"].some(key=>operational[key]!==p[key]))continue;
    const artifactId=String(p.artifact_id??"");
    if(event.streamId!==`creative:${context.ownerUserId}`||p.artifact_kind!=="model3d"||p.project_id!==context.projectId
      ||typeof p.document_id!=="string"||!active.get("document")?.has(p.document_id)
      ||typeof p.content_ref!=="string"||!active.get("artifact")?.has(artifactId)||!active.get("content")?.has(p.content_ref)
      ||!Number.isSafeInteger(p.revision)||Number(p.revision)<1||typeof p.content_sha256!=="string"||!(/^[a-f0-9]{64}$/u).test(p.content_sha256)
      ||Object.hasOwn(p,"audio_revision")||Object.hasOwn(p,"video_revision"))continue;
    const revision=parseModel3dMediaRevision(p.model3d_revision);if(!revision||revision.source.revision>=Number(p.revision))continue;
    const key=mediaKey(revision.media.url);if(!key||!active.get("media")?.has(key))continue;
    const artifactScope=resource("artifact",artifactId,artifactId,p.document_id,p.content_ref),contentScope=resource("content",p.content_ref,artifactId,p.document_id,p.content_ref),mediaScope=resource("media",key,artifactId,p.document_id,p.content_ref);
    if(!artifactScope||!contentScope||!mediaScope||artifactScope.publication_source_event_id!==contentScope.publication_source_event_id
      ||artifactScope.publication_source_event_id!==mediaScope.publication_source_event_id)continue;
    const bodies=contents.filter(value=>value.content_id===p.content_ref);
    if(bodies.length!==1)continue;
    // Metadata-only pages already select the immutable private event receipt.
    // Scope association qualifies display; it grants no review/write authority.
    // Content pages additionally bind the exact current authored bytes.
    if(typeof bodies[0]!.content==="string"){
      if(bodies[0]!.publication_project_id!==context.projectId||bodies[0]!.publication_source_event_id!==artifactScope.publication_source_event_id)continue;
      const raw=bodies[0]!.content as string;let body:Record<string,unknown>;
      try{const parsed:unknown=JSON.parse(raw);if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))continue;body=parsed as Record<string,unknown>;}catch{continue;}
      if(!Array.isArray(body.items)||body.items.length!==0||body.presentation!==null||Object.hasOwn(body,"audio_revision")||Object.hasOwn(body,"video_revision"))continue;
      const authored=parseModel3dMediaRevision(body.model3d_revision);
      if(!authored||JSON.stringify(authored)!==JSON.stringify(revision))continue;
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(raw))),byte=>byte.toString(16).padStart(2,"0")).join("");
      if(digest!==p.content_sha256)continue;
    }
    const projection=parseModel3dCurrentProjection({schemaVersion:1,revision:p.revision,contentSha256:p.content_sha256,media:revision.media});
    if(projection)result.set(event.eventId,projection);
  }
  return result;
}

function presentProjectEvent(row:Record<string,unknown>,context:ProjectRequestContext,activeResources:ProjectPresentationResources,contentIds=new Set<string>(),model3dCurrent?:Model3dCurrentProjection){
  const event=serializeEvent(row);
  const privateConversation=event.type==="ChatMessageSent"||event.type==="AssistantReasoned"&&event.payload.operation==="creative-chat";
  const payload=event.payload,operation=payload.operation&&typeof payload.operation==="object"?payload.operation as Record<string,unknown>:{};
  const object=operation.object&&typeof operation.object==="object"?operation.object as Record<string,unknown>:{};
  const sketch=operation.sketch&&typeof operation.sketch==="object"?operation.sketch as Record<string,unknown>:{};
  const itemIds=[payload.item_id,payload.reference_item_id,object.item_id,sketch.item_id].filter(value=>value!==null&&value!==undefined).map(String);
  const missingCanvasSource=PROJECT_CANVAS_MUTATION_TYPES.has(event.type)&&(
    Boolean(payload.canvas_id&&!activeResources.get("canvas")?.has(String(payload.canvas_id)))
    ||itemIds.some(id=>!activeResources.get("canvas_item")?.has(id))
    ||Boolean(object.block_id&&(!activeResources.get("block")?.has(String(object.block_id))||activeResources.retiredCanvasItems.has(String(object.block_id))))
    ||Boolean(payload.arrangement_id&&!activeResources.get("canvas_arrangement")?.has(String(payload.arrangement_id)))
    ||Boolean(payload.context_set_id&&!activeResources.get("canvas_context")?.has(String(payload.context_set_id))));
  // A removed:true placement still creates a visible item in the Canvas fold.
  // Withhold the event type as well as its copied private presentation instead.
  // Real removal events keep their redacted IDs so incremental clients can
  // still remove previously rendered objects; they never recreate an item.
  if(missingCanvasSource&&!["CanvasRemoved","CanvasItemRemoved","CanvasArrangementRemoved"].includes(event.type)
    ||PROJECT_CANVAS_MUTATION_TYPES.has(event.type)&&!context.permissions.includes("project.canvas.use")||privateConversation&&String(row.actor_user_id)!==context.principalUserId)
    return{...event,streamId:`project:${context.projectAccessId}`,sequence:Number(row.project_sequence),actor:`user:${String(row.actor_user_id)}`,type:"ProjectResourceRestricted",payload:{project_id:context.projectId,restricted:true}};
  const visibleContent=privateConversation?new Set([...contentIds,String(event.payload.content_ref??"")]):contentIds;
  const presentedPayload=missingCanvasSource?{project_id:context.projectId,
    ...(payload.canvas_id?{canvas_id:String(payload.canvas_id)}:{}),
    ...(payload.item_id?{item_id:String(payload.item_id)}:{}),
    ...(payload.arrangement_id?{arrangement_id:String(payload.arrangement_id)}:{}),removed:true}
    :redactProjectPayload(event.payload,visibleContent,activeResources);
  if(model3dCurrent)presentedPayload.model3d_current_projection=model3dCurrent;
  return{...event,streamId:`project:${context.projectAccessId}`,sequence:Number(row.project_sequence),actor:event.actor.startsWith("user")?`user:${String(row.actor_user_id)}`:event.actor,payload:presentedPayload};
}

/** Same-snapshot structural witnesses for shared Canvas presentation. Observed
 * reads retain raw provenance only for server-local final-response validation;
 * resourceIndex and event serialization never expose it. */
function prepareProjectPresentationResources(env:WorkerEnv,context:ProjectRequestContext,observed=false,descriptors?:AssistantContextReadDescriptor[],model3dPublication=false){
  const body="COALESCE(secret.private_json,source.payload)";
  const provenance=observed?`,json_array(resource.project_access_id,resource.resource_kind,resource.resource_id,resource.organization_id,resource.project_id,
    resource.owner_user_id,resource.visibility,resource.source_event_id,resource.actor_user_id,resource.created_at) AS source_resource_record,
    CASE WHEN source.event_id IS NULL THEN NULL ELSE json_array(source.event_id,source.stream_id,source.sequence,source.occurred_at,source.recorded_at,
      source.actor,source.client_id,source.correlation_id,source.causation_id,source.compensates_event_id,source.schema_version,source.type,source.payload) END AS source_event_record,
    CASE WHEN custody.event_id IS NULL THEN NULL ELSE json_array(custody.event_id,custody.project_access_id,custody.organization_id,custody.project_id,
      custody.owner_user_id,custody.source_stream_id,custody.source_sequence,custody.project_sequence,custody.actor_user_id,custody.created_at) END AS source_custody_record,
    CASE WHEN secret.private_event_id IS NULL THEN NULL ELSE json_array(secret.private_event_id,secret.owner_id,secret.project_id,secret.document_id,
      secret.private_json,secret.created_at,secret.redacted_at) END AS source_private_record`:"";
  const sql=`SELECT resource.resource_kind,resource.resource_id,resource.visibility,${model3dPublication?`
    resource.source_event_id AS publication_source_event_id,resource.project_id AS publication_project_id,
    publication.event_id AS publication_event_id,json_extract(publication.payload,'$.artifact_id') AS publication_artifact_id,
    json_extract(publication.payload,'$.document_id') AS publication_document_id,json_extract(publication.payload,'$.content_ref') AS publication_content_ref,
    json_extract(publication.payload,'$.project_id') AS publication_source_project_id,`:""}
    CASE WHEN custody.event_id IS NOT NULL AND(source.payload IS NOT NULL)
      AND(json_extract(source.payload,'$._private_ref') IS NULL OR secret.private_event_id IS NOT NULL) THEN source.type ELSE NULL END AS source_type,
    json_extract(${body},'$.canvas_id') AS source_canvas_id,
    json_extract(${body},'$.item_id') AS source_item_id,json_extract(${body},'$.reference_item_id') AS source_reference_item_id,
    json_extract(${body},'$.arrangement_id') AS source_arrangement_id,json_extract(${body},'$.context_set_id') AS source_context_set_id,
    json_extract(${body},'$.source_kind') AS source_kind,json_extract(${body},'$.source_id') AS source_id,
    json_extract(${body},'$.block_id') AS source_block_id,json_extract(${body},'$.document_id') AS source_document_id,
    json_extract(${body},'$.object_id') AS source_object_id,json_extract(${body},'$.item_ids') AS source_item_ids,
    (SELECT json_group_array(CASE WHEN frame.type='object' THEN json_extract(frame.value,'$.item_id') ELSE NULL END)
      FROM json_each(CASE WHEN source.type='CanvasArrangementCreated' THEN ${body} ELSE '{}' END,'$.frames') frame) AS source_frame_ids,
    (SELECT json_group_array(CASE WHEN frame.type='object' THEN json_extract(frame.value,'$.item_id') ELSE NULL END)
      FROM json_each(CASE WHEN source.type='CanvasArrangementCreated' THEN ${body} ELSE '{}' END,'$.previous_frames') frame) AS source_previous_frame_ids${provenance}
    FROM project_resource_scopes resource${model3dPublication?`
    LEFT JOIN events publication ON publication.event_id=resource.source_event_id AND publication.stream_id='creative:'||resource.owner_user_id
      AND publication.type='DocumentRenderCompleted' AND json_extract(publication.payload,'$.artifact_kind')='model3d'
      AND resource.resource_kind IN('artifact','content','media')`:""}
    LEFT JOIN events source ON source.event_id=resource.source_event_id AND source.stream_id='creative:'||resource.owner_user_id
      AND resource.resource_kind IN('canvas','canvas_item','canvas_context','canvas_arrangement')
    LEFT JOIN project_event_scopes custody ON custody.event_id=source.event_id
      AND(custody.project_access_id,custody.organization_id,custody.project_id,custody.owner_user_id,custody.source_stream_id,custody.source_sequence)
        =(resource.project_access_id,resource.organization_id,resource.project_id,resource.owner_user_id,source.stream_id,source.sequence)
    LEFT JOIN event_private_payloads secret ON secret.private_event_id=source.event_id AND secret.owner_id=resource.owner_user_id AND secret.redacted_at IS NULL
    WHERE resource.project_access_id=? AND resource.organization_id=? AND resource.project_id=? AND resource.owner_user_id=?`;
  const bindings=[context.projectAccessId,context.organizationId,context.projectId,context.ownerUserId];
  descriptors?.push({sql,bindings,role:"resources"});
  return env.DB.prepare(sql).bind(...bindings);
}

function resourceIndex(rows:Record<string,unknown>[]){
  const activeResources:ProjectPresentationResources=Object.assign(new Map<string,Set<string>>(),{retiredCanvasItems:new Set<string>()});
  for(const row of rows){const kind=String(row.resource_kind),ids=activeResources.get(kind)??new Set<string>();ids.add(String(row.resource_id));activeResources.set(kind,ids);}
  const key=(kind:string,id:string)=>JSON.stringify([kind,id]);
  const collaborative=new Map(rows.filter(row=>row.visibility==="collaborative_output").map(row=>[key(String(row.resource_kind),String(row.resource_id)),row]));
  const dependents=new Map<string,string[]>(),invalid=new Set<string>(),queue:string[]=[];
  const reject=(id:string)=>{if(!invalid.has(id)){invalid.add(id);queue.push(id);}};
  const members=(raw:unknown):string[]=>{
    if(raw===null||raw===undefined)return[];
    const value=typeof raw==="string"?JSON.parse(raw):raw;
    if(!Array.isArray(value)||value.some(id=>typeof id!=="string"||!id))throw new Error("invalid_canvas_source_members");
    return value;
  };
  for(const row of rows){
    const kind=String(row.resource_kind),id=String(row.resource_id),own=key(kind,id),board=String(row.source_canvas_id??"");
    if(!["canvas","canvas_item","canvas_context","canvas_arrangement"].includes(kind))continue;
    const needs:Array<[string,string]>=[];
    if(!collaborative.has(own)||!board){reject(own);continue;}
    if(kind==="canvas"){
      if(row.source_type!=="CanvasCreated"||board!==id)reject(own);
    }else{
      needs.push(["canvas",board]);
      if(kind==="canvas_item"){
        if(!["CanvasItemPlaced","CanvasReferenceCreated"].includes(String(row.source_type))||String(row.source_item_id??row.source_reference_item_id??"")!==id){reject(own);continue;}
        const raw=String(row.source_kind??(row.source_type==="CanvasReferenceCreated"?"reference":"block"));
        const sourceKind=["document","output","artifact","context","reference","sketch","block"].includes(raw)?raw:"block";
        const sourceId=String(row.source_id??row.source_block_id??row.source_document_id??row.source_object_id??id);
        const targetKind=sourceKind==="context"?"canvas_context":["reference","sketch"].includes(sourceKind)?"block":sourceKind;
        if(!sourceId||targetKind==="canvas_context"&&String(collaborative.get(key(targetKind,sourceId))?.source_canvas_id??"")!==board)reject(own);
        needs.push([targetKind,sourceId]);
      }else{
        if(row.source_type!==(kind==="canvas_context"?"ContextSetFormalized":"CanvasArrangementCreated")
          ||String(kind==="canvas_context"?row.source_context_set_id:row.source_arrangement_id)!==id){reject(own);continue;}
        try{
          const ids=kind==="canvas_context"?members(row.source_item_ids):[...members(row.source_item_ids),...members(row.source_frame_ids),...members(row.source_previous_frame_ids)];
          for(const member of new Set(ids)){
            if(String(collaborative.get(key("canvas_item",member))?.source_canvas_id??"")!==board)reject(own);
            needs.push(["canvas_item",member]);
          }
        }catch{reject(own);}
      }
    }
    for(const [targetKind,targetId] of needs){
      const target=key(targetKind,targetId);
      if(!collaborative.has(target))reject(own);
      const parents=dependents.get(target)??[];parents.push(own);dependents.set(target,parents);
    }
  }
  // Propagate withdrawal through context cards and saved arrangements without
  // rescanning history or granting authority from an incomplete item page.
  for(let index=0;index<queue.length;index++){
    const current=queue[index]!,[kind,id]=JSON.parse(current) as [string,string];
    activeResources.get(kind)?.delete(id);
    if(kind==="canvas_item")activeResources.retiredCanvasItems.add(id);
    for(const parent of dependents.get(current)??[])reject(parent);
  }
  return activeResources;
}

// Server-only provenance for exact replay of the original context source SELECTs.
// The ordinary event serializer ignores these additional columns.
const assistantContextEventProvenance=`,json_array(scope.event_id,scope.project_access_id,scope.organization_id,scope.project_id,scope.owner_user_id,
  scope.source_stream_id,scope.source_sequence,scope.project_sequence,scope.actor_user_id,scope.created_at) AS source_scope_record,
  CASE WHEN secret.private_event_id IS NULL THEN NULL ELSE json_array(secret.private_event_id,secret.owner_id,secret.project_id,secret.document_id,
    secret.created_at,secret.redacted_at) END AS source_private_record`;

/** Shared reads use dense project cursors and an explicit output-only private-content allowlist. */
export async function readProjectEventPage(env:WorkerEnv,context:ProjectRequestContext,after:number,limit:number,includeContent:boolean,sourceObserver?:AssistantContextReadObserver){
  await synchronizeProjectScope(env,context);
  const size=Math.max(1,Math.min(5000,Math.floor(limit)||5000));
  const eventSql=`SELECT event.*,secret.private_json,scope.project_sequence,scope.actor_user_id${!sourceObserver?`,
      CASE WHEN event.type='DocumentArtifactEdited' AND json_extract(event.payload,'$.artifact_kind')='model3d' THEN(
        SELECT current_event.event_id FROM project_event_scopes current_scope JOIN events current_event ON current_event.event_id=current_scope.event_id
        WHERE current_scope.project_access_id=scope.project_access_id AND current_scope.organization_id=scope.organization_id
          AND current_scope.owner_user_id=scope.owner_user_id AND current_scope.project_id=scope.project_id
          AND current_scope.source_stream_id=event.stream_id AND current_event.stream_id=event.stream_id
          AND current_event.type='DocumentArtifactEdited'
          AND json_extract(current_event.payload,'$.artifact_id')=json_extract(event.payload,'$.artifact_id')
        ORDER BY current_scope.project_sequence DESC LIMIT 1) ELSE NULL END AS model3d_current_edit_id`:""}${sourceObserver?assistantContextEventProvenance:""} FROM project_event_scopes scope JOIN events event ON event.event_id=scope.event_id
      LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id AND secret.redacted_at IS NULL
      WHERE scope.project_access_id=? AND scope.organization_id=? AND scope.owner_user_id=? AND scope.project_sequence>? ORDER BY scope.project_sequence LIMIT ?`;
  const eventBindings=[context.projectAccessId,context.organizationId,context.ownerUserId,Math.max(0,Math.floor(after)||0),size];
  const headSql="SELECT COALESCE(MAX(project_sequence),0) AS head FROM project_event_scopes WHERE project_access_id=? AND organization_id=?",headBindings=[context.projectAccessId,context.organizationId];
  const descriptors:AssistantContextReadDescriptor[]=[{sql:eventSql,bindings:eventBindings,role:"ascending-events"},
    {sql:headSql,bindings:headBindings,role:"project-head",projectAccessId:context.projectAccessId,organizationId:context.organizationId}];
  const statements=[
    env.DB.prepare(eventSql).bind(...eventBindings),env.DB.prepare(headSql).bind(...headBindings),
    prepareProjectPresentationResources(env,context,Boolean(sourceObserver),descriptors,!sourceObserver),
  ];
  // Metadata pages retain only references eligible for this exact reader. Body
  // hydration is separate; content=0 must neither select bytes nor erase live IDs.
  // Ordinary Assistant metadata compilation does not consume chat bodies: its
  // recentTurns are replaced by independently certified history. Authorized
  // conversation event pointers are preserved in presentProjectEvent itself.
  // Keep the page certificate on document-artifact eligibility; otherwise an
  // unrelated retired answer could invalidate a fresh document-derived reply.
  const assistantMetadataOnly=Boolean(sourceObserver)&&!includeContent;
  const contentProvenance=sourceObserver?`,json_array(content.content_id,content.owner_id,content.kind,content.created_at,content.expires_at,content.redacted_at) AS source_content_record,
    json_array(scope.project_access_id,scope.resource_kind,scope.resource_id,scope.organization_id,scope.project_id,scope.owner_user_id,
      scope.visibility,scope.source_event_id,scope.actor_user_id,scope.created_at) AS source_resource_record,
    CASE WHEN scope.visibility='actor_private' THEN(SELECT json_array(retention.content_id,retention.organization_id,retention.project_access_id,retention.project_id,
      retention.actor_user_id,retention.classification,retention.policy_version,retention.assigned_expires_at,retention.created_at)
      FROM private_content_retention_scopes retention WHERE retention.content_id=content.content_id
        AND retention.organization_id=scope.organization_id AND retention.project_access_id=scope.project_access_id
        AND retention.project_id=scope.project_id AND retention.actor_user_id=scope.actor_user_id) ELSE NULL END AS source_retention_record`:"";
  const { nativeMemoryAnswerExclusion } = await import("./memory-native-boundary.ts");
  const ordinaryContent=await nativeMemoryAnswerExclusion(env,{answerAlias:"content"});
  const contentSql=`SELECT content.content_id${includeContent?",content.content":""}${includeContent&&!sourceObserver?",scope.source_event_id AS publication_source_event_id,scope.project_id AS publication_project_id":""}${contentProvenance} FROM project_resource_scopes scope INDEXED BY sqlite_autoindex_project_resource_scopes_1
    CROSS JOIN private_content content ON content.content_id=scope.resource_id
    WHERE scope.project_access_id=? AND scope.organization_id=? AND scope.owner_user_id=? AND scope.resource_kind='content'
      AND ((scope.visibility='collaborative_output' AND content.owner_id=scope.owner_user_id AND content.kind='document-artifact')
        OR(${assistantMetadataOnly?"0 AND ":""}scope.visibility='actor_private' AND scope.actor_user_id=? AND content.owner_id=? AND content.kind IN('chat-user','chat-assistant')
          AND EXISTS(SELECT 1 FROM private_content_retention_scopes retention WHERE retention.content_id=content.content_id
            AND retention.organization_id=scope.organization_id AND retention.project_access_id=scope.project_access_id
            AND retention.project_id=scope.project_id AND retention.actor_user_id=scope.actor_user_id)))
      AND content.redacted_at IS NULL AND content.expires_at>${sourceObserver?"strftime('%Y-%m-%dT%H:%M:%fZ','now')":"?"} AND ${ordinaryContent.sql}`;
  const contentBindings=[context.projectAccessId,context.organizationId,context.ownerUserId,context.principalUserId,context.principalUserId,...(sourceObserver?[]:[new Date().toISOString()]),...ordinaryContent.bindings];
  statements.push(env.DB.prepare(contentSql).bind(...contentBindings));descriptors.push({sql:contentSql,bindings:contentBindings,role:"content-allowlist"});
  const reads=await env.DB.batch<Record<string,unknown>>(statements);
  sourceObserver?.(statements,reads,descriptors);
  const [rows,headRow,resourceRows,contentRow]=reads;
  const content=includeContent?Object.fromEntries((contentRow?.results??[]).map((row)=>[String(row.content_id),String(row.content)])):{};
  const allowedContent=new Set((contentRow?.results??[]).map((row)=>String(row.content_id)));
  const activeResources=resourceIndex(resourceRows?.results??[]);
  const head=Number(headRow?.results[0]?.head??0);
  const model3dCurrent=!sourceObserver?await projectModel3dCurrentProjections(rows?.results??[],context,activeResources,resourceRows?.results??[],contentRow?.results??[]):new Map<string,Model3dCurrentProjection>();
  const events=(rows?.results??[]).map((row)=>presentProjectEvent(row,context,activeResources,allowedContent,model3dCurrent.get(String(row.event_id))));
  const nextAfter=Number(events.at(-1)?.sequence??after);
  return{events,head,nextAfter,hasMore:nextAfter<head,...(includeContent?{content}:{}),permissionSchemaVersion:1};
}

/** Reconstruct semantic resource state without replaying unrelated activity or bypassing actor redaction. */
export async function readProjectAssistantEventView(env:WorkerEnv,context:ProjectRequestContext,selection:{documentId?:string|null;canvasId?:string|null;sourceObserver?:AssistantContextReadObserver}={}){
  const sourceObserver=selection.sourceObserver;
  const documentId=selection.documentId??"",canvasId=selection.canvasId??"";
  await synchronizeProjectScope(env,context);
  const scope="scope.project_access_id=? AND scope.organization_id=? AND scope.owner_user_id=?";
  const joins="FROM project_event_scopes scope JOIN events event ON event.event_id=scope.event_id LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id AND secret.redacted_at IS NULL";
  const eventDocument="COALESCE(json_extract(event.payload,'$.document_id'),(SELECT json_extract(previous.payload,'$.document_id') FROM events previous WHERE previous.stream_id=event.stream_id AND previous.sequence<=event.sequence AND previous.type IN('DocumentCreated','DocumentOpened') ORDER BY previous.sequence DESC LIMIT 1))";
  const bootstrapSql=`SELECT event.*,secret.private_json,scope.project_sequence,scope.actor_user_id${sourceObserver?assistantContextEventProvenance:""} ${joins}
    WHERE ${scope} AND(event.type='ProjectCreated'
      OR event.type IN('DocumentCreated','DocumentForked','DocumentRenamed','DocumentRemoved','DocumentRestored') AND(?='' OR json_extract(event.payload,'$.document_id')=?)
      OR event.type IN('CanvasCreated','CanvasRenamed','CanvasRemoved','CanvasRestored') AND(?='' OR json_extract(event.payload,'$.canvas_id')=?))
    ORDER BY scope.project_sequence DESC LIMIT 96`;
  const bootstrapBindings=[context.projectAccessId,context.organizationId,context.ownerUserId,documentId,documentId,canvasId,canvasId];
  const semanticSql=`SELECT event.*,secret.private_json,scope.project_sequence,scope.actor_user_id${sourceObserver?assistantContextEventProvenance:""} ${joins}
    WHERE ${scope} AND event.type IN(${ASSISTANT_STATE_EVENT_SQL})
      AND((?='' AND ?='') OR ${eventDocument}=? OR json_extract(event.payload,'$.canvas_id')=?
        OR json_extract(event.payload,'$.source_canvas_id')=? OR event.type IN('ProjectCreated','ProjectOpened','ProjectRenamed'))
    ORDER BY scope.project_sequence DESC LIMIT 384`;
  const semanticBindings=[context.projectAccessId,context.organizationId,context.ownerUserId,documentId,canvasId,documentId,canvasId,canvasId];
  const boundariesSql=`SELECT event.*,secret.private_json,scope.project_sequence,scope.actor_user_id${sourceObserver?assistantContextEventProvenance:""} ${joins}
    WHERE ${scope} AND event.type='BlockCreated' AND(?='' OR ${eventDocument}=?)
      AND(json_extract(event.payload,'$.type')='exclusion' OR json_extract(secret.private_json,'$.properties.intent')='prohibit'
        OR json_extract(secret.private_json,'$.properties.locked')=1) ORDER BY scope.project_sequence DESC LIMIT 32`;
  const boundariesBindings=[context.projectAccessId,context.organizationId,context.ownerUserId,documentId,documentId];
  const descriptors:AssistantContextReadDescriptor[]=[{sql:bootstrapSql,bindings:bootstrapBindings},{sql:semanticSql,bindings:semanticBindings},{sql:boundariesSql,bindings:boundariesBindings}];
  const resource=prepareProjectPresentationResources(env,context,Boolean(sourceObserver),descriptors);
  const statements=[env.DB.prepare(bootstrapSql).bind(...bootstrapBindings),env.DB.prepare(semanticSql).bind(...semanticBindings),env.DB.prepare(boundariesSql).bind(...boundariesBindings),resource];
  const reads=await env.DB.batch<Record<string,unknown>>(statements);
  sourceObserver?.(statements,reads,descriptors);
  const [basics,state,limits,resources]=reads;
  const activeResources=resourceIndex(resources.results??[]);
  const unique=new Map<string,Record<string,unknown>>();
  for(const row of [...(basics.results??[]),...(state.results??[]),...(limits.results??[])])unique.set(String(row.event_id),row);
  return [...unique.values()].sort((left,right)=>Number(left.project_sequence)-Number(right.project_sequence))
    .map((row)=>presentProjectEvent(row,context,activeResources))
    .filter((event)=>event.type!=="ProjectResourceRestricted");
}

export type ProjectSourceScope={organizationId:string;projectAccessId:string;projectId:string;ownerUserId:string};

function projectSourceProjectionAssertion(scope:ProjectSourceScope,head:{sql:string;bindings:Readonly<BudgetReservationGuard["bindings"]>}|null){
  return {sql:`EXISTS(SELECT 1 FROM project_migration_states migration
    JOIN organization_projects project ON project.project_access_id=migration.project_access_id AND project.organization_id=migration.organization_id
      AND project.owner_user_id=migration.owner_user_id AND project.status='active'
    JOIN organizations organization ON organization.organization_id=project.organization_id AND organization.status='active'
    WHERE migration.project_access_id=? AND migration.organization_id=? AND migration.owner_user_id=? AND project.project_id=?
      AND migration.status='active'${head?` AND ${head.sql}`:""}
      AND EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.project_access_id=migration.project_access_id
        AND resource.organization_id=migration.organization_id AND resource.project_id=project.project_id AND resource.owner_user_id=migration.owner_user_id
        AND resource.resource_kind='manifest_version' AND resource.resource_id='canvas-v1'))`,
    bindings:[scope.projectAccessId,scope.organizationId,scope.ownerUserId,scope.projectId,...(head?.bindings??[])]};
}

/** A read may require a current projection, but cannot reactivate or repair one. */
export function projectSourceProjectionCurrentAssertion(scope:ProjectSourceScope,own?:AssistantOwnSendFootprint){
  if(own&&(!own.scope||own.streamId!=="creative:"+scope.ownerUserId||own.scope.organizationId!==scope.organizationId
    ||own.scope.projectAccessId!==scope.projectAccessId||own.scope.projectId!==scope.projectId||own.scope.ownerUserId!==scope.ownerUserId))throw new Error("context_own_send_scope");
  const suffix=own?assistantOwnSendGuard(own):null;
  const index=own?assistantOwnSendProjectIndexGuard(own,true):null,partialIndex=own?assistantOwnSendProjectIndexGuard(own):null;
  const head=own?`(migration.last_owner_sequence=? OR migration.last_owner_sequence=? AND (${index!.sql}))`:"migration.last_owner_sequence=(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)";
  const current=projectSourceProjectionAssertion(scope,{sql:head,bindings:own?[own.sourceHead,own.sourceHead+own.eventWrites.length,...index!.bindings]:[`creative:${scope.ownerUserId}`]});
  return suffix?{sql:`(${current.sql}) AND ((${suffix.sql}) AND (${partialIndex!.sql}))`,bindings:[...current.bindings,...suffix.bindings,...partialIndex!.bindings]}:current;
}

/** Final-only structured publication proof: never substitutes for the original prewrite source guard. */
export function projectStructuredSourceProjectionCurrentAssertion(scope:ProjectSourceScope,own:AssistantStructuredOwnSendFootprint){
  if(!own.scope||own.streamId!=="creative:"+scope.ownerUserId||own.scope.organizationId!==scope.organizationId
    ||own.scope.projectAccessId!==scope.projectAccessId||own.scope.projectId!==scope.projectId||own.scope.ownerUserId!==scope.ownerUserId
    ||own.projectId!==scope.projectId)throw new Error("context_structured_own_send_scope");
  const suffix=assistantStructuredOwnSendGuard(own),index=assistantStructuredOwnSendProjectIndexGuard(own,true);
  const current=projectSourceProjectionAssertion(scope,{sql:"migration.last_owner_sequence=?",bindings:[own.sourceHead+2]});
  return{sql:`(${current.sql}) AND (${suffix.sql}) AND (${index.sql})`,bindings:[...current.bindings,...suffix.bindings,...index.bindings]};
}

/** Same custody proof after guarded event INSERTs, before projection advancement. */
export function projectSourceProjectionPublicationAssertion(scope:ProjectSourceScope){
  return projectSourceProjectionAssertion(scope,null);
}

/** Shared source SELECT for ordinary refresh and guarded read-only Output execution. */
export function prepareProjectSourceEventsStatement(env:WorkerEnv,scope:ProjectSourceScope){
  return env.DB.prepare(`SELECT event.*,secret.private_json FROM project_event_scopes scope JOIN events event ON event.event_id=scope.event_id
    LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id AND secret.redacted_at IS NULL
    WHERE scope.project_access_id=? AND scope.organization_id=? AND scope.project_id=? AND scope.owner_user_id=?
    ORDER BY scope.project_sequence`).bind(scope.projectAccessId,scope.organizationId,scope.projectId,scope.ownerUserId);
}

/** Internal generation receives exact project history, never an owner's account-wide stream. */
export async function readProjectSourceEvents(env:WorkerEnv,scope:ProjectSourceScope,options:{synchronize?:boolean}={}){
  const readonlyHead=options.synchronize===false?await env.DB.prepare("SELECT migration.last_owner_sequence AS indexed_head,(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?) AS source_head FROM project_migration_states migration WHERE migration.project_access_id=? AND migration.organization_id=? AND migration.owner_user_id=? AND migration.status='active'")
    .bind("creative:"+scope.ownerUserId,scope.projectAccessId,scope.organizationId,scope.ownerUserId).first<{indexed_head:number;source_head:number}>():null;
  if(options.synchronize!==false)await synchronizeProjectScope(env,scope);
  else if(!readonlyHead||Number(readonlyHead.indexed_head)!==Number(readonlyHead.source_head))throw new Error("project_source_index_stale");
  const rows=await prepareProjectSourceEventsStatement(env,scope).all<Record<string,unknown>>();
  if(options.synchronize===false&&!await env.DB.prepare("SELECT 1 FROM project_migration_states migration WHERE (migration.project_access_id,migration.organization_id,migration.owner_user_id,migration.status,migration.last_owner_sequence)=(?,?,?,'active',?) AND (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?")
    .bind(scope.projectAccessId,scope.organizationId,scope.ownerUserId,Number(readonlyHead!.source_head),"creative:"+scope.ownerUserId,Number(readonlyHead!.source_head)).first())throw new Error("project_source_index_stale");
  return rows.results.map((row)=>serializeEvent(row));
}

type PendingProjectResources=Map<string,Set<string>>;

const blockScopeKey=(payload:Record<string,unknown>)=>{
  const document=String(payload.document_id??""),canvas=String(payload.canvas_id??""),scope=canvas||payload.scope==="canvas"?"canvas":payload.scope==="library"||payload.library_block===true?"library":"document";
  return`${scope}:${scope==="document"?document:scope==="canvas"?canvas:""}`;
};

async function blockResourceMetadata(env:WorkerEnv,context:ProjectRequestContext,id:string,pending:PendingProjectResources){
  const key=`block_scope:${id}`,known=pending.get(key);
  if(known){const values=[...known];return{scope:values.find((value)=>!value.startsWith("type:"))??"",type:(values.find((value)=>value.startsWith("type:"))??"").slice(5)};}
  const columns=`event.payload,COALESCE(json_extract(event.payload,'$.document_id'),(SELECT json_extract(previous.payload,'$.document_id') FROM events previous
    WHERE previous.stream_id=event.stream_id AND previous.sequence<=event.sequence AND previous.type IN('DocumentCreated','DocumentOpened','DocumentForked') ORDER BY previous.sequence DESC LIMIT 1)) AS implied_document_id`;
  let row=await env.DB.prepare(`SELECT ${columns} FROM project_resource_scopes resource JOIN events event ON event.event_id=resource.source_event_id
    WHERE resource.project_access_id=? AND resource.organization_id=? AND resource.owner_user_id=? AND resource.resource_kind='block' AND resource.resource_id=?`)
    .bind(context.projectAccessId,context.organizationId,context.ownerUserId,id).first<{payload:string;implied_document_id:string|null}>();
  if(!row)row=await env.DB.prepare(`SELECT ${columns} FROM project_resource_scopes resource JOIN events event INDEXED BY idx_events_stream_type
      ON event.stream_id=? AND event.type='BlockCreated' AND json_extract(event.payload,'$.block_id')=resource.resource_id
      WHERE resource.project_access_id=? AND resource.organization_id=? AND resource.owner_user_id=? AND resource.resource_kind='block' AND resource.resource_id=? AND resource.source_event_id IS NULL LIMIT 1`)
    .bind(`creative:${context.ownerUserId}`,context.projectAccessId,context.organizationId,context.ownerUserId,id).first<{payload:string;implied_document_id:string|null}>();
  if(!row)return null;
  try{const payload=JSON.parse(row.payload) as Record<string,unknown>;if(!payload.document_id&&row.implied_document_id)payload.document_id=row.implied_document_id;const metadata={scope:blockScopeKey(payload),type:String(payload.type??"")};pending.set(key,new Set([metadata.scope,`type:${metadata.type}`]));return metadata;}catch{return null;}
}

async function resourceExists(env:WorkerEnv,context:ProjectRequestContext,kind:string,id:string,pending?:PendingProjectResources){
  if(!id)return false;
  if(pending?.get(`removed:${kind}`)?.has(id))return false;
  if(pending?.get(kind)?.has(id))return true;
  if(pending?.get(`existing:${kind}`)?.has(id))return true;
  if(pending?.get(`missing:${kind}`)?.has(id))return false;
  const present=Boolean(await env.DB.prepare("SELECT 1 AS present FROM project_resource_scopes WHERE project_access_id=? AND organization_id=? AND owner_user_id=? AND resource_kind=? AND resource_id=?")
    .bind(context.projectAccessId,context.organizationId,context.ownerUserId,kind,id).first());
  if(pending){const key=`${present?"existing":"missing"}:${kind}`,values=pending.get(key)??new Set<string>();values.add(id);pending.set(key,values);}
  return present;
}

async function resourceBelongsToCanvas(env:WorkerEnv,context:ProjectRequestContext,kind:"canvas_item"|"canvas_arrangement"|"canvas_context",id:string,canvas:string,pending:PendingProjectResources){
  const key=`parent:${kind}:${id}`,known=pending.get(key);
  if(known)return known.has(canvas);
  const present=Boolean(await env.DB.prepare(`SELECT 1 AS present FROM project_resource_scopes resource JOIN events event ON event.event_id=resource.source_event_id
    WHERE resource.project_access_id=? AND resource.organization_id=? AND resource.owner_user_id=? AND resource.resource_kind=? AND resource.resource_id=?
      AND json_extract(event.payload,'$.canvas_id')=?`)
    .bind(context.projectAccessId,context.organizationId,context.ownerUserId,kind,id,canvas).first());
  pending.set(key,present?new Set([canvas]):new Set());
  return present;
}

async function readProjectReceiptEvents(env:WorkerEnv,context:ProjectRequestContext,eventIds:string[],actorUserId:string){
  const unique=[...new Set(eventIds)];
  if(!unique.length)return new Map<string,ReturnType<typeof presentProjectEvent>>();
  const statements:D1PreparedStatement[]=[prepareProjectPresentationResources(env,context)];
  for(let offset=0;offset<unique.length;offset+=70){
    const chunk=unique.slice(offset,offset+70);
    statements.push(env.DB.prepare(`SELECT event.*,secret.private_json,scope.project_sequence,scope.actor_user_id FROM project_event_scopes scope JOIN events event ON event.event_id=scope.event_id
      LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id AND secret.redacted_at IS NULL
      WHERE scope.project_access_id=? AND scope.organization_id=? AND scope.owner_user_id=? AND scope.actor_user_id=? AND scope.event_id IN(${chunk.map(()=>"?").join(",")})`)
      .bind(context.projectAccessId,context.organizationId,context.ownerUserId,actorUserId,...chunk));
  }
  const [resources,...groups]=await env.DB.batch<Record<string,unknown>>(statements);
  const activeResources=resourceIndex(resources?.results??[]);
  return new Map(groups.flatMap((group)=>group.results.map((row)=>{
    const original=serializeEvent(row),event=presentProjectEvent(row,context,activeResources);
    // Only the authenticated actor's exact idempotency response may retain its
    // device receipt after the corresponding visible resource was removed.
    if(original.payload.client_event_id)event.payload={...event.payload,client_event_id:String(original.payload.client_event_id)};
    return[event.eventId,event] as const;
  })));
}

async function historicalCanvasCreation(env:WorkerEnv,context:ProjectRequestContext,kind:"canvas"|"canvas_item"|"canvas_arrangement",id:string,canvas:string){
  const types=kind==="canvas"?["CanvasCreated"]:kind==="canvas_item"?["CanvasItemPlaced","CanvasReferenceCreated"]:["CanvasArrangementCreated"];
  const resourceProperty=kind==="canvas"?"canvas_id":kind==="canvas_item"?"item_id":"arrangement_id";
  const source=await env.DB.prepare(`SELECT COALESCE(secret.private_json,event.payload) AS payload FROM project_event_scopes scope JOIN events event ON event.event_id=scope.event_id
    LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id AND secret.redacted_at IS NULL
    WHERE scope.project_access_id=? AND scope.organization_id=? AND scope.owner_user_id=? AND event.type IN(${types.map(()=>"?").join(",")})
      AND json_extract(event.payload,'$.canvas_id')=? AND (json_extract(event.payload,?)=? OR (?='canvas_item' AND json_extract(event.payload,'$.reference_item_id')=?)) LIMIT 1`)
    .bind(context.projectAccessId,context.organizationId,context.ownerUserId,...types,canvas,`$.${resourceProperty}`,id,kind,id).first<{payload:string}>();
  if(!source)return null;
  try{const value=JSON.parse(source.payload) as unknown;return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:null;}catch{return null;}
}

async function ownerResourceExists(env:WorkerEnv,context:ProjectRequestContext,kind:"document"|"block"|"collection"|"relation"|"reference"|"canvas"|"canvas_item"|"canvas_arrangement"|"canvas_context",id:string,pending?:PendingProjectResources){
  const known=pending?.get(`owner-history:${kind}`);
  if(known)return known.has(id);
  const types=kind==="document"?["DocumentCreated","DocumentForked"]:kind==="block"?["BlockCreated"]:kind==="collection"?["CollectionCreated"]:kind==="reference"?["ReferenceIngested"]:kind==="canvas"?["CanvasCreated"]:kind==="canvas_item"?["CanvasItemPlaced","CanvasReferenceCreated"]:kind==="canvas_arrangement"?["CanvasArrangementCreated"]:kind==="canvas_context"?["ContextSetFormalized"]:["BlockRelationAdded"];
  const property=kind==="relation"?"relation_id":kind==="canvas_item"?"item_id":kind==="canvas_arrangement"?"arrangement_id":kind==="canvas_context"?"context_set_id":`${kind}_id`;
  return Boolean(await env.DB.prepare(`SELECT 1 AS present FROM events WHERE stream_id=? AND type IN(${types.map(()=>"?").join(",")})
    AND(json_extract(payload,?)=? OR(?='canvas_item' AND json_extract(payload,'$.reference_item_id')=?)) LIMIT 1`)
    .bind(`creative:${context.ownerUserId}`,...types,`$.${property}`,id,kind,id).first());
}

/** Reject account-global navigation, provider work, foreign documents, and fabricated membership. */
async function validateProjectMutation(env:WorkerEnv,context:ProjectRequestContext,event:{type?:string;payload?:Record<string,unknown>;compensatesEventId?:string|null},pending:PendingProjectResources,principal:PilotUser,canvasAction=false){
  const type=String(event.type??""),payload=event.payload??{};
  const exists=(kind:string,id:string)=>resourceExists(env,context,kind,id,pending);
  const canvasMutation=PROJECT_CANVAS_MUTATION_TYPES.has(type);
  if(!PROJECT_MUTATION_TYPES.has(type)&&!canvasMutation&&!(type==="EmptyCanvasChosen"&&canvasAction))return"project_operation_unavailable";
  if(canvasMutation){const invalid=validateCanvasEvent(event);if(invalid)return invalid;}
  const project=String(payload.project_id??"");
  if(project&&project!==context.projectId)return"foreign_project_resource";
  const canvas=String(payload.canvas_id??payload.source_canvas_id??"");
  const requiresCanvas=canvasMutation||canvasAction;
  if(requiresCanvas&&!canvas)return"canvas_id_required";
  if(requiresCanvas&&type!=="CanvasCreated"&&!await exists("canvas",canvas)&&!(type==="CanvasRestored"&&await historicalCanvasCreation(env,context,"canvas",canvas,canvas)))return"foreign_canvas_resource";
  if(type==="CanvasCreated"&&(pending.get("canvas")?.has(canvas)||await ownerResourceExists(env,context,"canvas",canvas,pending)))return"resource_identifier_already_exists";
  const itemId=String(payload.item_id??payload.reference_item_id??"");
  const createsCanvasItem=type==="CanvasItemPlaced"||type==="CanvasReferenceCreated";
  const restoredItem=type==="CanvasItemRestored"&&itemId?await historicalCanvasCreation(env,context,"canvas_item",itemId,canvas):null;
  if(canvasMutation&&itemId&&!createsCanvasItem&&!restoredItem&&!await exists("canvas_item",itemId))return"foreign_canvas_item_resource";
  if(createsCanvasItem){
    if(await exists("canvas_item",itemId)||await ownerResourceExists(env,context,"canvas_item",itemId,pending))return"resource_identifier_already_exists";
    const sourceKind=String(payload.source_kind??(type==="CanvasReferenceCreated"?"reference":""));
    const sourceId=String(payload.source_id??payload.block_id??payload.document_id??payload.object_id??"");
    const kind=sourceKind==="document"?"document":sourceKind==="output"?"output":sourceKind==="artifact"?"artifact":sourceKind==="context"?"canvas_context":["block","reference","sketch"].includes(sourceKind)?"block":"";
    if(!kind||!sourceId||!await exists(kind,sourceId))return"foreign_canvas_source_resource";
    if(kind==="canvas_context"&&!await resourceBelongsToCanvas(env,context,"canvas_context",sourceId,canvas,pending))return"foreign_canvas_source_resource";
  }
  if(restoredItem){
    const sourceKind=String(restoredItem.source_kind??(restoredItem.reference_item_id?"reference":""));
    const sourceId=String(restoredItem.source_id??restoredItem.block_id??restoredItem.document_id??restoredItem.object_id??"");
    const kind=sourceKind==="document"?"document":sourceKind==="output"?"output":sourceKind==="artifact"?"artifact":sourceKind==="context"?"canvas_context":["block","reference","sketch"].includes(sourceKind)?"block":"";
    if(!kind||!sourceId||!await exists(kind,sourceId)||(kind==="canvas_context"&&!await resourceBelongsToCanvas(env,context,"canvas_context",sourceId,canvas,pending)))return"foreign_canvas_source_resource";
  }
  if(itemId&&canvas&&!createsCanvasItem&&!restoredItem&&!await resourceBelongsToCanvas(env,context,"canvas_item",itemId,canvas,pending))return"foreign_canvas_item_resource";
  const arrangement=String(payload.arrangement_id??"");
  const restoredArrangement=type==="CanvasArrangementRestored"&&arrangement?await historicalCanvasCreation(env,context,"canvas_arrangement",arrangement,canvas):null;
  if(["CanvasArrangementRemoved","CanvasArrangementRestored"].includes(type)&&!restoredArrangement&&(!await exists("canvas_arrangement",arrangement)||!await resourceBelongsToCanvas(env,context,"canvas_arrangement",arrangement,canvas,pending)))return"foreign_canvas_arrangement";
  if(type==="CanvasArrangementCreated"&&(await exists("canvas_arrangement",arrangement)||await ownerResourceExists(env,context,"canvas_arrangement",arrangement,pending)))return"resource_identifier_already_exists";
  if(restoredArrangement){
    const restoredFrames=[...(Array.isArray(restoredArrangement.frames)?restoredArrangement.frames:[]),...(Array.isArray(restoredArrangement.previous_frames)?restoredArrangement.previous_frames:[])];
    const restoredIds=[...(Array.isArray(restoredArrangement.item_ids)?restoredArrangement.item_ids:[]).map(String),...restoredFrames.map((frame)=>frame&&typeof frame==="object"?String((frame as Record<string,unknown>).item_id??""):"")];
    for(const id of restoredIds)if(!id||!await exists("canvas_item",id)||!await resourceBelongsToCanvas(env,context,"canvas_item",id,canvas,pending))return"foreign_canvas_item_resource";
  }
  const contextSet=String(payload.context_set_id??"");
  if(type==="ContextSetFormalized"&&(await exists("canvas_context",contextSet)||await ownerResourceExists(env,context,"canvas_context",contextSet,pending)))return"resource_identifier_already_exists";
  const operation=payload.operation&&typeof payload.operation==="object"?payload.operation as Record<string,unknown>:{};
  const operationObject=operation.object&&typeof operation.object==="object"?operation.object as Record<string,unknown>:{};
  const sketch=operation.sketch&&typeof operation.sketch==="object"?operation.sketch as Record<string,unknown>:{};
  for(const nestedId of [operationObject.item_id,sketch.item_id].filter(Boolean))if(String(nestedId)!==itemId||!await exists("canvas_item",String(nestedId)))return"foreign_canvas_item_resource";
  if(operationObject.block_id&&!await exists("block",String(operationObject.block_id)))return"foreign_block_resource";
  const itemIds=(Array.isArray(payload.item_ids)?payload.item_ids:[]).map(String);
  const sourceItemIds=(Array.isArray(payload.source_canvas_item_ids)?payload.source_canvas_item_ids:[]).map(String);
  const frames=[...(Array.isArray(payload.frames)?payload.frames:[]),...(Array.isArray(payload.previous_frames)?payload.previous_frames:[])];
  for(const id of [...itemIds,...sourceItemIds,...frames.map((frame)=>frame&&typeof frame==="object"?String((frame as Record<string,unknown>).item_id??""):"")])if(!id||!await exists("canvas_item",id)||canvas&&!await resourceBelongsToCanvas(env,context,"canvas_item",id,canvas,pending))return"foreign_canvas_item_resource";
  if(["CanvasLockAcquired","CanvasLockReleased"].includes(type)&&!String(payload.holder_id??"").startsWith(`${principal.userId}:`))return"foreign_canvas_lock_holder";
  const clock=operation.hlc&&typeof operation.hlc==="object"?operation.hlc as Record<string,unknown>:null;
  if(clock&&!String(clock.site??"").startsWith(`${principal.userId}:`)&&!(event.compensatesEventId&&/^(?:undo|redo):/.test(String(clock.site??""))))return"foreign_canvas_clock";
  if(event.compensatesEventId){
    const target=await env.DB.prepare("SELECT 1 AS present FROM project_event_scopes WHERE event_id=? AND project_access_id=? AND organization_id=? AND actor_user_id=?")
      .bind(event.compensatesEventId,context.projectAccessId,context.organizationId,principal.userId).first();
    if(!target)return"foreign_canvas_history";
  }
  const document=String(payload.document_id??"");
  if(type.startsWith("Document")&&!document)return"document_id_required";
  if(document&&type!=="DocumentCreated"&&!await exists("document",document))return"foreign_document_resource";
  if(type==="OutputRenamed"){
    const kind=payload.output_kind,id=String(payload.output_id??"");
    const title=typeof payload.new_title==="string"?payload.new_title.normalize("NFC").trim():"";
    if(project!==context.projectId||!document)return"output_scope_required";
    if(kind!=="image"&&kind!=="artifact")return"invalid_output_kind";
    if(!id||String(kind==="image"?payload.object_id??"":payload.artifact_id??"")!==id
      ||Boolean(kind==="image"?payload.artifact_id:payload.object_id))return"output_identity_mismatch";
    if(!title||Array.from(title).length>120||/\p{Cc}/u.test(title))return"invalid_output_title";
    if(!await exists(kind==="image"?"output":"artifact",id))return"foreign_output_resource";
    payload.new_title=title;
  }
  if(type==="DocumentProductionWorkflowConfigured"){
    const workflow=payload.workflow as ProductionWorkflow|undefined;
    if(!workflow||typeof workflow!=="object"||Array.isArray(workflow)||productionWorkflowIssues(workflow).length||workflow.id!==payload.workflow_id||workflow.documentId!==document||workflow.projectId!==context.projectId||workflow.target!==payload.target_kind||workflow.approvalRequired!==true)return"production_workflow_invalid";
    for(const stage of workflow.stages){if(!stage.source)continue;if(!await exists(stage.source.outputKind==="image"?"output":"artifact",stage.source.outputId))return"foreign_workflow_source";if(stage.source.documentId!==document)return"foreign_document_resource";if(stage.source.outputKind==="artifact"&&(!stage.approvalRequired||!stage.source.approvalRequired))return"production_workflow_approval_required";}
  }
  const block=String(payload.block_id??"");
  if((type.startsWith("Block")&&!type.startsWith("BlockRelation")||type==="ChipEdited")&&!block)return"block_id_required";
  if(block&&type!=="BlockCreated"&&!await exists("block",block))return"foreign_block_resource";
  const from=String(payload.from_block_id??""),to=String(payload.to_block_id??"");
  if((from&&!await exists("block",from))||(to&&!await exists("block",to)))return"foreign_block_resource";
  const collection=String(payload.collection_id??payload.to_collection_id??payload.from_collection_id??"");
  if(type.startsWith("Collection")&&!collection)return"collection_id_required";
  if(collection&&type!=="CollectionCreated"&&!await exists("collection",collection))return"foreign_collection_resource";
  const parent=String(payload.parent_collection_id??"");
  if(parent&&!await exists("collection",parent))return"foreign_collection_resource";
  if(type==="CollectionItemMoved"){
    for(const candidate of [payload.from_collection_id,payload.to_collection_id])if(candidate&&!await exists("collection",String(candidate)))return"foreign_collection_resource";
  }
  const relation=String(payload.relation_id??"");
  if(type.startsWith("BlockRelation")&&!relation)return"relation_id_required";
  if(type==="BlockRelationRemoved"&&!await exists("relation",relation))return"foreign_relation_resource";
  if(type==="DocumentCreated"&&(pending.get("document")?.has(document)||await ownerResourceExists(env,context,"document",document,pending)))return"resource_identifier_already_exists";
  if(type==="BlockCreated"){
    if(!block)return"block_id_required";
    if(document&&!await exists("document",document))return"foreign_document_resource";
    if(!document&&payload.scope!=="library"&&!(payload.scope==="canvas"&&canvas&&await exists("canvas",canvas)))return"document_and_block_required";
    if(pending.get("block")?.has(block)||await ownerResourceExists(env,context,"block",block,pending))return"resource_identifier_already_exists";
  }
  if(type==="CollectionCreated"&&(pending.get("collection")?.has(collection)||await ownerResourceExists(env,context,"collection",collection,pending)))return"resource_identifier_already_exists";
  if(type==="BlockRelationAdded"&&(pending.get("relation")?.has(relation)||await ownerResourceExists(env,context,"relation",relation,pending)))return"resource_identifier_already_exists";
  const reference=String(payload.reference_id??"");
  if(["ReferenceIngested","RightsAsserted"].includes(type)&&!reference)return"reference_id_required";
  if(type==="ReferenceIngested"){
    if(pending.get("reference")?.has(reference)||await ownerResourceExists(env,context,"reference",reference,pending))return"resource_identifier_already_exists";
    const key=mediaKey(payload.source_ref);
    if(!key||!await exists("media",key))return"foreign_media_resource";
    const claimedHash=String(payload.content_hash??"");
    const object=typeof env.MEDIA.head==="function"?await env.MEDIA.head(key):await env.MEDIA.get(key);
    if(!object||object.customMetadata?.ownerId!==context.ownerUserId)return"foreign_media_resource";
    const storedHash=String(object.customMetadata?.sha256??"");
    if(storedHash?claimedHash!==storedHash:claimedHash!==key)return"foreign_media_resource";
    const cohort=await env.DB.prepare("SELECT cohort_id FROM pilot_cohorts WHERE organization_id=? AND status IN ('active','paused','closed') ORDER BY CASE WHEN status='closed' THEN 1 ELSE 0 END,created_at DESC LIMIT 1")
      .bind(context.organizationId).first<{cohort_id:string}>();
    if(cohort&&!await managedPilotSourceClassificationValid(env,context.ownerUserId,cohort.cohort_id,[{type:"reference",properties:{media_url:String(payload.source_ref??""),source_content_hash:claimedHash}}],context.projectAccessId))return"pilot_non_sensitive_source_confirmation_required";
  }else if(type==="RightsAsserted"&&!await exists("reference",reference))return"foreign_reference_resource";
  const object=String(payload.object_id??payload.item_id??"");
  if(["ObjectSaved","ObjectPinned","ObjectUnpinned","ObjectDiscarded","ObjectExported","AddedToLibrary","RemovedFromLibrary"].includes(type)){
    if(!object)return"object_id_required";
    if(!await exists("output",object)&&!await exists("artifact",object)&&!await exists("block",object)&&!(type==="ObjectExported"&&await exists("document",object)))return"foreign_output_resource";
  }
  if(type==="DocumentArtifactExported"||type==="DocumentArtifactEdited"||["ArtifactReviewRequested","ArtifactApproved","ArtifactChangesRequested"].includes(type)){
    const artifact=String(payload.artifact_id??"");
    if(!artifact||!await exists("artifact",artifact))return"foreign_artifact_resource";
  }
  const properties=payload.properties&&typeof payload.properties==="object"?payload.properties as Record<string,unknown>:{};
  const editedProperty=type==="BlockPropertyEdited"?String(payload.property_path??""):type==="ChipEdited"?String(payload.property??""):"";
  const editedValue=type==="BlockPropertyEdited"||type==="ChipEdited"?payload.new_value:undefined;
  if(editedProperty==="type"&&String(editedValue)==="reference")return"reference_type_transition_forbidden";
  const guardedProperties={...properties,...(editedProperty?{[editedProperty]:editedValue}:{})};
  if(Object.hasOwn(guardedProperties,"block_references")){
    const submitted=guardedProperties.block_references,normalized=normalizeActionBlockReferences(submitted);
    const owner=type==="BlockCreated"?{scope:blockScopeKey(payload),type:String(payload.type??"")}:await blockResourceMetadata(env,context,block,pending);
    if(!Array.isArray(submitted)||normalized.length!==submitted.length||owner?.type!=="action")return"invalid_action_block_references";
    for(const reference of normalized){
      if(!await exists("block",reference.block_id))return"foreign_block_resource";
      if((await blockResourceMetadata(env,context,reference.block_id,pending))?.scope!==owner.scope)return"cross_scene_action_reference";
    }
  }
  if(type==="BlockRelationAdded"&&String(payload.kind??"")===ACTION_PARTICIPANT_RELATION){
    if(!ACTION_REFERENCE_ROLES.includes(properties.participant_role as typeof ACTION_REFERENCE_ROLES[number]))return"invalid_action_participant_role";
    const action=await blockResourceMetadata(env,context,from,pending),participant=await blockResourceMetadata(env,context,to,pending);
    if(action?.type!=="action")return"invalid_action_participant_owner";
    if(!action||!participant||action.scope!==participant.scope)return"cross_scene_action_reference";
  }
  for(const property of ["reference_id","model_reference_id"] as const)
    if(guardedProperties[property]&&!await exists("reference",String(guardedProperties[property])))return"foreign_reference_resource";
  for(const property of ["media_url","model_url"] as const)
    if(guardedProperties[property]){const key=mediaKey(guardedProperties[property]);if(!key||!await exists("media",key))return"foreign_media_resource";}
  if(type==="BlockCreated"&&String(payload.type??"")==="reference"&&properties.media_url){
    if(!await verifySourceDocumentEvidence(env,context.ownerUserId,properties.media_url,properties))return"source_evidence_not_verified";
    if(properties.source_evidence_hash){const sources=pending.get("verified_source")??new Set<string>();sources.add(block);pending.set("verified_source",sources);}
  }
  if(["BlockPropertyEdited","ChipEdited"].includes(type)&&["text","source_citations","source_segment_count","source_excerpt_truncated","source_kind","source_content_hash","source_evidence_hash","source_mime_type","media_url","extraction_status"].includes(editedProperty)){
    if(pending.get("verified_source")?.has(block))return"verified_source_evidence_immutable";
    const creation=await env.DB.prepare(`SELECT COALESCE(secret.private_json,event.payload) AS payload FROM project_resource_scopes resource
      JOIN events event ON event.event_id=resource.source_event_id
      LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id AND secret.owner_id=? AND secret.redacted_at IS NULL
      WHERE resource.project_access_id=? AND resource.organization_id=? AND resource.owner_user_id=? AND resource.resource_kind='block' AND resource.resource_id=?`)
      .bind(context.ownerUserId,context.projectAccessId,context.organizationId,context.ownerUserId,block).first<{payload:string}>();
    if(creation)try{const authored=JSON.parse(creation.payload) as {properties?:{source_evidence_hash?:unknown}};if(authored.properties?.source_evidence_hash)return"verified_source_evidence_immutable";}catch{return"source_evidence_not_verified";}
  }
  for(const [key,kind] of [["source_document_id","document"],["from_document_id","document"],["to_document_id","document"],["source_block_id","block"],["copied_from_block_id","block"],["forked_from_block_id","block"],["source_output_id","output"],["source_artifact_id","artifact"]] as const){
    const value=String(payload[key]??guardedProperties[key]??"");
    if(value&&!await exists(kind,value))return`foreign_${kind}_resource`;
  }
  const item=payload.item_ref&&typeof payload.item_ref==="object"?payload.item_ref as Record<string,unknown>:{};
  const itemReferences=[["document_id","document"],["block_id","block"],["collection_id","collection"],["object_id","output"],["artifact_id","artifact"]] as const;
  if(type.startsWith("CollectionItem")&&itemReferences.filter(([key])=>Boolean(item[key])).length!==1)return"single_collection_item_required";
  for(const [key,kind] of itemReferences){
    const value=String(item[key]??"");if(value&&!await exists(kind,value))return`foreign_${kind}_resource`;
  }
  if(payload.history_owner_id&&(!canvasAction||String(payload.history_owner_id)!==principal.userId)||payload.actor_user_id||payload.organization_id||payload.project_access_id||payload.owner_id)return"forged_project_authority";
  const createdKind=type==="DocumentCreated"?"document":type==="BlockCreated"?"block":type==="CollectionCreated"?"collection":type==="BlockRelationAdded"?"relation":type==="ReferenceIngested"?"reference":type==="CanvasCreated"?"canvas":createsCanvasItem?"canvas_item":type==="CanvasArrangementCreated"?"canvas_arrangement":type==="ContextSetFormalized"?"canvas_context":"";
  const createdId=createdKind==="document"?document:createdKind==="block"?block:createdKind==="collection"?collection:createdKind==="reference"?reference:createdKind==="canvas"?canvas:createdKind==="canvas_item"?itemId:createdKind==="canvas_arrangement"?arrangement:createdKind==="canvas_context"?contextSet:relation;
  if(createdKind&&createdId){
    const values=pending.get(createdKind)??new Set<string>();values.add(createdId);pending.set(createdKind,values);
    if(createdKind==="block")pending.set(`block_scope:${createdId}`,new Set([blockScopeKey(payload),`type:${String(payload.type??"")}`]));
    if(["canvas_item","canvas_arrangement","canvas_context"].includes(createdKind))pending.set(`parent:${createdKind}:${createdId}`,new Set([canvas]));
  }
  const lifecycle=type==="CanvasRemoved"||type==="CanvasRestored"?["canvas",canvas]:type==="CanvasItemRemoved"||type==="CanvasItemRestored"?["canvas_item",itemId]:type==="CanvasArrangementRemoved"||type==="CanvasArrangementRestored"?["canvas_arrangement",arrangement]:null;
  if(lifecycle){
    const[kind,id]=lifecycle,removedKey=`removed:${kind}`,removed=pending.get(removedKey)??new Set<string>();
    if(type.endsWith("Removed")){removed.add(id);pending.get(kind)?.delete(id);}
    else{removed.delete(id);const restored=pending.get(kind)??new Set<string>();restored.add(id);pending.set(kind,restored);if(kind!=="canvas")pending.set(`parent:${kind}:${id}`,new Set([canvas]));}
    pending.set(removedKey,removed);
  }
  return null;
}

/** Append the owner event and project sidecar together after checking active ACL within the transaction. */
export type ArtifactRevisionSnapshot={revisionId:string;revision:number;contentJson:string;contentSha256:string;createdByUserId:string;createdAt:string;expiresAt:string};

async function currentProjectArtifactBinding(env:WorkerEnv,context:ProjectRequestContext,contentRef:string){
  const retained=await env.DB.prepare(`SELECT content.content FROM private_content content JOIN project_resource_scopes resource
    ON resource.resource_kind='content' AND resource.resource_id=content.content_id AND resource.project_access_id=? AND resource.organization_id=?
      AND resource.project_id=? AND resource.owner_user_id=? AND resource.visibility='collaborative_output'
    WHERE content.content_id=? AND content.owner_id=? AND content.kind='document-artifact' AND content.redacted_at IS NULL AND content.expires_at>?`)
    .bind(context.projectAccessId,context.organizationId,context.projectId,context.ownerUserId,contentRef,context.ownerUserId,new Date().toISOString()).first<{content:string}>();
  if(!retained)return null;
  const contentSha256=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(retained.content))),(byte)=>byte.toString(16).padStart(2,"0")).join("");
  return{contentId:contentRef,content:retained.content,contentSha256};
}

async function currentArtifactRightsBinding(env:WorkerEnv,context:ProjectRequestContext,document:ReturnType<typeof foldEvents>,events:CreativeEvent[],artifactIds:readonly string[]){
  const validity=await governedPackageSourceRightsValidity(env,context.organizationId,document.blocks,(scope)=>synchronizeProjectScope(env,scope));
  if(!validity.current||artifactCurrentRightsBlockers(document.blocks,events).length)return null;
  const native=await artifactSourceEvidenceGuard(env,context,document.documentId,events,artifactIds);
  if(!native)return null;
  const snapshots:unknown[]=JSON.parse(String(native.guard.bindings[0])) as unknown[],deadlines=[validity.validUntil,native.validUntil];
  const upstream=new Map<string,{scope:{projectAccessId:string;organizationId:string;projectId:string;ownerUserId:string};documentId:string}>();
  for(const dependency of validity.dispatchDependencies??[])if(dependency.kind==="package"){
    const snapshot=JSON.parse(dependency.contentJson) as {sourceProjectAccessId:string;sourceDocumentId:string};
    const origin=validity.dispatchDependencies?.find(item=>item.kind==="source"&&item.projectAccessId===snapshot.sourceProjectAccessId);
    if(origin?.kind==="source")upstream.set(origin.projectAccessId+":"+snapshot.sourceDocumentId,{scope:origin,documentId:snapshot.sourceDocumentId});
  }
  for(const origin of upstream.values()){
    const source=await env.DB.prepare(`SELECT event.*,secret.private_json FROM project_event_scopes custody JOIN events event ON event.event_id=custody.event_id
      LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id AND secret.redacted_at IS NULL
      WHERE custody.project_access_id=? AND custody.organization_id=? AND custody.project_id=? AND custody.owner_user_id=?
        AND event.type IN(${ASSISTANT_STATE_EVENT_SQL}) ORDER BY custody.project_sequence`)
      .bind(origin.scope.projectAccessId,origin.scope.organizationId,origin.scope.projectId,origin.scope.ownerUserId).all<Record<string,unknown>>();
    let sourceEvents:CreativeEvent[];try{sourceEvents=source.results.map(serializeEvent);}catch{return null;}
    const retained=await artifactSourceEvidenceGuard(env,origin.scope,origin.documentId,sourceEvents);
    if(!retained)return null;snapshots.push(...JSON.parse(String(retained.guard.bindings[0])) as unknown[]);deadlines.push(retained.validUntil);
  }
  const packed=JSON.stringify(snapshots);if(new TextEncoder().encode(packed).byteLength>1_000_000)return null;
  const rights=sourceRightsDispatchGuard(validity);
  const rightsGuard={sql:`(${rights.sql}) AND (${native.guard.sql})`,bindings:[...rights.bindings,packed]};
  if(!await env.DB.prepare("SELECT 1 AS artifact_rights_retained WHERE "+rightsGuard.sql).bind(...rightsGuard.bindings).first())return null;
  return{rightsGuard,rightsValidUntil:deadlines.filter((value):value is string=>value!==null).sort()[0]??null};
}

export async function appendProjectEvents(env:WorkerEnv,context:ProjectRequestContext,principal:PilotUser,body:{action?:string;event?:{type?:string;payload?:Record<string,unknown>;compensatesEventId?:string|null};events?:Array<{type?:string;payload?:Record<string,unknown>;compensatesEventId?:string|null}>;clientId?:string;correlationId?:string;expectedSequence?:number},atomicEdit?:{artifactId:string;contentId:string;oldContent:string;newContent:string;expectedRevision:number;documentId:string;revisions:ArtifactRevisionSnapshot[];restoreSource?:{revision:number;contentSha256:string;contentJson:string}},atomicSidecars?:{
  statements?:D1PreparedStatement[];
  buildStatements?:(lastEventId:string,writeProof?:BudgetReservationGuard,allocatedEvents?:readonly EventRow[])=>D1PreparedStatement[];
  guardSql?:string;
  guardBindings?:Array<string|number|null>;
  expectedOwnerHead?:number;
  preserveGovernance?:true;
  authoringOperation?:"context-proposal"|"document-duplicate"|"canvas-arrangement"|"adaptive-proposal"|"workspace-quick-edit";
  assistantAcceptance?:{proposalId:string;turnId:string;actorUserId:string;scopeKey:string;organizationId:string;projectAccessId:string;projectId:string;documentId:string};
}){
  const action=String(body.action??"append");
  if(!["append","batch","canvas_sync"].includes(action))return Response.json({error:"project_operation_unavailable"},{status:403});
  const original=Array.isArray(body.events)?body.events:body.event?[body.event]:[];
  if(atomicSidecars?.authoringOperation&&(!atomicSidecars.preserveGovernance||!atomicSidecars.guardSql||!atomicSidecars.buildStatements||!Number.isSafeInteger(atomicSidecars.expectedOwnerHead)
    ||(atomicSidecars.authoringOperation==="canvas-arrangement"
      ? action!=="batch"||validateAtomicCanvasArrangementEvents(original,principal.userId)!==null
      : (atomicSidecars.authoringOperation==="workspace-quick-edit"?!validWorkspaceQuickEditEvents(original):original.some((event)=>!(atomicSidecars.authoringOperation==="adaptive-proposal"?["BlockCreated","BlockPropertyEdited","CanvasItemPlaced"]:["DocumentCreated","BlockCreated","BlockPropertyEdited","BlockLocked","BlockRelationAdded","CollectionItemAdded"]).includes(String(event.type)))))))return Response.json({error:"invalid_authoring_operation"},{status:403});
  const assistantAcceptance=atomicSidecars?.assistantAcceptance;
  if(assistantAcceptance){
    const accepted=original[0],mutation=original[1],payload=accepted?.payload??{};
    if(!atomicSidecars?.preserveGovernance||!atomicSidecars.guardSql||!atomicSidecars.buildStatements||!Number.isSafeInteger(atomicSidecars.expectedOwnerHead)||action!=="batch"||original.length!==2
      ||accepted?.type!=="ProposalAccepted"||!["BlockCreated","BlockPropertyEdited","BlockRemoved","BlockRelationAdded","BlockRelationRemoved"].includes(String(mutation?.type??""))
      ||assistantAcceptance.actorUserId!==principal.userId||assistantAcceptance.organizationId!==context.organizationId
      ||assistantAcceptance.projectAccessId!==context.projectAccessId||assistantAcceptance.projectId!==context.projectId
      ||String(payload.proposal_id??"")!==assistantAcceptance.proposalId||String(payload.turn_id??"")!==assistantAcceptance.turnId
      ||String(payload.actor_user_id??"")!==principal.userId||String(payload.project_id??"")!==context.projectId
      ||String(payload.document_id??"")!==assistantAcceptance.documentId
      ||String(mutation?.payload?.project_id??"")!==context.projectId||String(mutation?.payload?.document_id??"")!==assistantAcceptance.documentId)
      return Response.json({error:"invalid_assistant_approval"},{status:403});
  }
  const bulkAuthoring=Boolean(atomicSidecars?.authoringOperation&&atomicSidecars.authoringOperation!=="context-proposal"&&action==="batch"&&!atomicEdit&&!atomicSidecars.statements?.length);
  const privilegedPackageSidecars=Boolean(atomicSidecars&&!atomicSidecars.preserveGovernance);
  if(!privilegedPackageSidecars&&original.some((event)=>{
    if(event.type==="BlockCreated"){
      const properties=event.payload?.properties;
      return Boolean(properties&&typeof properties==="object"&&Object.keys(properties as Record<string,unknown>).some((key)=>key.startsWith("organization_context_package_")||key==="organization_context_source_block_id"));
    }
    if(event.type==="BlockPropertyEdited"||event.type==="ChipEdited"){
      const key=String(event.type==="BlockPropertyEdited"?event.payload?.property_path:event.payload?.property);
      return key.startsWith("organization_context_package_")||key==="organization_context_source_block_id";
    }
    return false;
  }))return Response.json({error:"organization_context_provenance_reserved"},{status:403});
  if(!privilegedPackageSidecars){
    const governedBlockIds=new Set<string>();
    for(const event of original){
      const type=String(event.type??"");
      if(!/^(?:Block|Chip)/.test(type))continue;
      for(const id of [event.payload?.block_id,event.payload?.from_block_id,event.payload?.to_block_id])if(id)governedBlockIds.add(String(id));
      if(type==="BlockRelationRemoved"){
        const relation=await env.DB.prepare(`SELECT COALESCE(secret.private_json,event.payload) AS payload
          FROM project_resource_scopes resource JOIN events event ON event.event_id=resource.source_event_id
          LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id AND secret.owner_id=? AND secret.redacted_at IS NULL
          WHERE resource.project_access_id=? AND resource.organization_id=? AND resource.resource_kind='relation' AND resource.resource_id=?`)
          .bind(context.ownerUserId,context.projectAccessId,context.organizationId,String(event.payload?.relation_id??"")).first<{payload:string}>();
        if(relation)try{const value=JSON.parse(relation.payload) as Record<string,unknown>;for(const id of [value.from_block_id,value.to_block_id])if(id)governedBlockIds.add(String(id));}catch{return Response.json({error:"organization_context_package_decision_immutable"},{status:403});}
      }
    }
    if(governedBlockIds.size){
      const ids=[...governedBlockIds];
      for(let offset=0;offset<ids.length;offset+=96){
      const page=ids.slice(offset,offset+96),placeholders=page.map(()=>"?").join(",");
      const governed=await env.DB.prepare(`SELECT member.target_block_id FROM project_context_package_members member
        JOIN project_context_package_bindings binding ON binding.binding_id=member.binding_id
          AND binding.organization_id=member.organization_id AND binding.status='active'
        WHERE binding.project_access_id=? AND binding.organization_id=? AND member.target_block_id IN(${placeholders}) LIMIT 1`)
        .bind(context.projectAccessId,context.organizationId,...page).first();
      if(governed)return Response.json({error:"organization_context_package_decision_immutable",message:"Published organization decisions and their relationships can change only by explicitly accepting an approved package version."},{status:403});
      }
    }
  }
  if(original.some((event)=>event.type==="DocumentArtifactEdited")&&(!atomicEdit||original.length!==1||String(original[0]?.payload?.artifact_id??"")!==atomicEdit.artifactId))return Response.json({error:"artifact_edit_endpoint_required"},{status:403});
  if(atomicEdit&&(original.length!==1||original[0]?.type!=="DocumentArtifactEdited"))return Response.json({error:"invalid_atomic_artifact_edit"},{status:403});
  if(original.some((event)=>ARTIFACT_REVIEW_EVENT_TYPES.has(String(event.type??"")))&&original.some((event)=>!ARTIFACT_REVIEW_EVENT_TYPES.has(String(event.type??""))))return Response.json({error:"review_context_changed",message:"Approve the output separately after its latest context changes have been reviewed."},{status:409});
  const exportOnly=original.length>0&&action!=="canvas_sync"&&original.every((event)=>["ObjectExported","DocumentArtifactExported"].includes(String(event.type??"")));
  if(original.some((event)=>["ObjectExported","DocumentArtifactExported"].includes(String(event.type??"")))&&!exportOnly)return Response.json({error:"mixed_export_batch_forbidden",message:"Export approval must be verified separately from any project changes."},{status:400});
  const ownerStream=`creative:${context.ownerUserId}`;
  let releaseValidationHead:number|null=null;
  const exactArtifactBindings=new Map<string,ExactArtifactContentBinding>();
  const exportArtifactIds=new Map<(typeof original)[number],string[]>();
  const rightsBindings=new Map<string,ReturnType<typeof currentArtifactRightsBinding>>();
  const currentRights=(document:ReturnType<typeof foldEvents>,events:CreativeEvent[])=>{
    const key=document.documentId;let pending=rightsBindings.get(key);
    if(!pending){
      const identifiers=new Set(original.map(input=>String(input.payload?.artifact_id??input.payload?.object_id??"")));
      const artifactIds=document.libraryArtifacts.filter(artifact=>artifact.documentId===key&&(identifiers.has(artifact.id)||identifiers.has(key))).map(artifact=>artifact.id);
      pending=currentArtifactRightsBinding(env,context,document,events,artifactIds);rightsBindings.set(key,pending);
    }
    return pending;
  };
  if((exportOnly||original.some(event=>ARTIFACT_REVIEW_EVENT_TYPES.has(String(event.type??""))))&&original.length>50)
    return Response.json({error:"invalid_project_event_batch",maximum:50},{status:400});
  const reviewOnly=original.length>0&&action!=="canvas_sync"&&original.every((event)=>["ArtifactApproved","ArtifactChangesRequested"].includes(String(event.type??"")))
    &&hasCapability(principal,"project.review.approve",{organizationId:context.organizationId,projectAccessId:context.projectAccessId});
  if(!hasCapability(principal,"project.author",{organizationId:context.organizationId,projectAccessId:context.projectAccessId})
    &&!reviewOnly&&!(exportOnly&&hasCapability(principal,"project.read",{organizationId:context.organizationId,projectAccessId:context.projectAccessId})))return Response.json({error:"project_read_only"},{status:403});
  if(exportOnly){
    releaseValidationHead=await streamHead(env,ownerStream);
    const source=await readProjectSourceEvents(env,context);
    const managedPilot=await env.DB.prepare("SELECT 1 AS present FROM pilot_cohorts WHERE organization_id=? AND status IN ('active','paused','closed') LIMIT 1").bind(context.organizationId).first();
    const all=foldEvents(source,Number.POSITIVE_INFINITY,undefined,context.projectId);
    for(const request of original){
      const identifier=String(request.payload?.artifact_id??request.payload?.object_id??"");
      const target=all.libraryArtifacts.find((artifact)=>artifact.id===identifier);
      if(request.type==="DocumentArtifactExported"&&(!target||target.documentId!==String(request.payload?.document_id??"")))
        return Response.json({error:"artifact_document_mismatch"},{status:403});
      const relevant=target?[target]:all.documents.some((document)=>document.id===identifier)?all.libraryArtifacts.filter((artifact)=>artifact.documentId===identifier):[];
      exportArtifactIds.set(request,relevant.map(artifact=>artifact.id));
      if(request.payload?.presenter_notes_included===true){
        const completed=target?source.find((event)=>event.eventId===target.sourceEventId&&event.type==="DocumentRenderCompleted"):undefined;
        if(request.type!=="DocumentArtifactExported"||!target||target.kind!=="slides"
          ||String(completed?.payload.requested_by_user_id??"")!==principal.userId)
          return Response.json({error:"presenter_export_creator_required",message:"Private presenter notes and source excerpts can be released only by the presentation's authorized generating creator."},{status:403});
      }
      for(const artifact of relevant){
        const verifiableSources=Boolean(artifactSourceVersions(artifact.id,source));
        if(!verifiableSources&&managedPilot)return Response.json({error:"artifact_source_revision_unavailable",message:"Controlled-pilot outputs require verified source revisions and independent approval before release."},{status:409});
        const document=foldEvents(source,Number.POSITIVE_INFINITY,artifact.documentId,context.projectId);
        const rightsBinding=await currentRights(document,source);
        if(!rightsBinding)return Response.json({error:"context_source_rights_expired",message:"The original rights for an adopted organizational source are no longer valid."},{status:409});
        if(verifiableSources&&artifactReviewState(artifact,document.blocks,source).status!=="approved")return Response.json({error:"artifact_approval_required",message:"This output cannot leave its shared project until a separate reviewer approves its current source and output revision."},{status:409});
        if(request.type==="DocumentArtifactExported")request.payload={...request.payload,export_class:verifiableSources?"independently-approved":"unreviewed-draft"};
        const exactArtifactExport=request.type==="DocumentArtifactExported";
        const currentRevision=source.filter((event)=>event.type==="DocumentArtifactEdited"&&String(event.payload.artifact_id??"")===artifact.id).length;
        if(exactArtifactExport||request.payload?.artifact_revision!==undefined){
          if(!Number.isSafeInteger(request.payload?.artifact_revision)||Number(request.payload?.artifact_revision)!==currentRevision)return Response.json({error:"stale_release_context",message:"The finished output changed before it could be released. Reopen its latest approved revision."},{status:409});
        }
        const actual=await currentProjectArtifactBinding(env,context,artifact.contentRef??"");
        if(!actual)return Response.json({error:"stale_release_context",message:"The approved output is no longer retained in this project."},{status:409});
        if(exactArtifactExport||request.payload?.content_sha256!==undefined){
          const expected=String(request.payload?.content_sha256??"");
          if(!expected||expected!==actual.contentSha256)return Response.json({error:"stale_release_context",message:"The approved output no longer matches the exact document prepared for download."},{status:409});
        }
        if(verifiableSources&&!artifactApprovalMatches(artifact,source,currentRevision,actual.contentSha256))return Response.json({error:"artifact_approval_required",message:"An independent reviewer must approve these exact output bytes before release."},{status:409});
        exactArtifactBindings.set(artifact.id,{contentId:actual.contentId,content:actual.content,revision:currentRevision,...rightsBinding});
      }
    }
  }
  const canvasAction=action==="canvas_sync"||original.some((event)=>PROJECT_CANVAS_MUTATION_TYPES.has(String(event.type??""))||Boolean(event.payload?.canvas_id));
  if(canvasAction&&!hasCapability(principal,"project.canvas.use",{organizationId:context.organizationId,projectAccessId:context.projectAccessId}))return Response.json({error:"project_canvas_access_required"},{status:403});
  const maximumEvents=atomicSidecars?.authoringOperation==="canvas-arrangement"?CANVAS_ARRANGEMENT_MAX_EVENTS:atomicSidecars?.authoringOperation==="workspace-quick-edit"?2:atomicSidecars?.authoringOperation?512:action==="canvas_sync"?120:privilegedPackageSidecars?384:50;
  if(!original.length||original.length>maximumEvents)return Response.json({error:"invalid_project_event_batch",maximum:maximumEvents},{status:400});
  if(action==="canvas_sync"&&original.some((event)=>!String(event.payload?.client_event_id??"")))return Response.json({error:"client_event_id_required"},{status:400});
  if(original.some((event)=>event.type==="ArtifactApproved")&&original.some((event)=>/^(?:Block|Chip|DocumentArtifactEdited)/.test(String(event.type??""))))return Response.json({error:"review_context_changed",message:"Approve the output separately after its latest context changes have been reviewed."},{status:409});
  for(const decision of original.filter((event)=>event.type==="ArtifactApproved"||event.type==="ArtifactChangesRequested")){
    const assigned=await env.DB.prepare(`SELECT 1 AS present FROM project_review_tasks pending
      WHERE pending.project_access_id=? AND pending.organization_id=? AND pending.artifact_id=?
        AND pending.assigned_user_id=? AND pending.status='pending'
        AND pending.request_event_id=(SELECT requested_scope.event_id FROM project_event_scopes requested_scope
          JOIN events requested ON requested.event_id=requested_scope.event_id
          WHERE requested_scope.project_access_id=? AND requested_scope.organization_id=? AND requested.type='ArtifactReviewRequested'
            AND json_extract(requested.payload,'$.artifact_id')=? ORDER BY requested_scope.project_sequence DESC LIMIT 1)`)
      .bind(context.projectAccessId,context.organizationId,String(decision.payload?.artifact_id??""),principal.userId,
        context.projectAccessId,context.organizationId,String(decision.payload?.artifact_id??"")).first();
    if(!assigned)return Response.json({error:"assigned_artifact_reviewer_required"},{status:403});
  }
  await synchronizeProjectScope(env,context);
  const receiptKeys=action==="canvas_sync"?await Promise.all(original.map(async(event)=>{
    const raw=String(event.payload?.client_event_id??"");
    const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(["forma-project-canvas-v1",context.organizationId,context.projectAccessId,principal.userId,raw])));
    return Array.from(new Uint8Array(digest),(part)=>part.toString(16).padStart(2,"0")).join("");
  })):[];
  if(receiptKeys.length!==new Set(receiptKeys).size)return Response.json({error:"duplicate_client_event_id"},{status:400});
  const existing=receiptKeys.length?await readEventsByClientEventIds(env,ownerStream,receiptKeys):new Map<string,EventRow>();
  if([...existing.values()].some((previous)=>previous.actor!==`user:${principal.userId}`))return Response.json({error:"canvas_receipt_scope_mismatch"},{status:409});
  const existingEvents=await readProjectReceiptEvents(env,context,[...existing.values()].map((event)=>event.eventId),principal.userId);
  if(existingEvents.size!==existing.size)return Response.json({error:"canvas_receipt_scope_mismatch"},{status:409});
  let validatedOutputOwnerHead:number|null=null;
  const incoming=original.filter((_,index)=>!existing.has(receiptKeys[index]??""));
  if(!incoming.length&&existing.size){
    const current=await env.DB.prepare("SELECT COALESCE(MAX(project_sequence),0) AS head FROM project_event_scopes WHERE project_access_id=? AND organization_id=? AND owner_user_id=?")
      .bind(context.projectAccessId,context.organizationId,context.ownerUserId).first<{head:number}>();
    return Response.json({appended:original.map((_,index)=>existingEvents.get(existing.get(receiptKeys[index])!.eventId)!),rejected:[],head:Number(current?.head??0),idempotent:true});
  }
  if(incoming.some((event)=>/^(?:Block|Chip|Output)/u.test(String(event.type??""))||event.type==="ExtractionRequested")){
    const manifest=await env.DB.prepare("SELECT last_owner_sequence FROM project_migration_states WHERE project_access_id=? AND organization_id=? AND owner_user_id=? AND status='active'")
      .bind(context.projectAccessId,context.organizationId,context.ownerUserId).first<{last_owner_sequence:number}>();
    if(!manifest||!Number.isSafeInteger(Number(manifest.last_owner_sequence)))return Response.json({error:"output_requirement_context_unavailable"},{status:409});
    validatedOutputOwnerHead=Number(manifest.last_owner_sequence);
    const guarded=prepareOutputRequirementClientEvents(incoming,outputAuthoringBlocksFromEvents(await readProjectSourceEvents(env,context)));
    if(!guarded.ok)return Response.json(guarded,{status:guarded.status});
    // Preserve incoming identities: canvas receipts and response rows use the original event objects as keys.
    guarded.events.forEach((event,index)=>{incoming[index]!.payload=event.payload;});
  }
  if(incoming.some((event)=>["BlockPropertyEdited","BlockRenamed","BlockWeightSet"].includes(String(event.type??"")))){
    const snapshot=foldEvents(await readProjectSourceEvents(env,context),Number.POSITIVE_INFINITY,"",context.projectId);
    const blocks=new Map(snapshot.libraryBlocks.map((block)=>[block.id,{...block,properties:{...block.properties}}]));
    const sameValue=(actual:unknown,expected:unknown)=>JSON.stringify(actual??null)===JSON.stringify(expected??null);
    for(const event of incoming){
      const payload=event.payload??{},id=String(payload.block_id??"");
      if(event.type==="BlockCreated"){
        blocks.set(id,{id,projectId:context.projectId,documentId:String(payload.document_id??""),canvasId:String(payload.canvas_id??""),
          scope:payload.scope==="library"?"library":payload.scope==="canvas"?"canvas":"document",type:String(payload.type??"text"),
          handle:String(payload.handle??id),position:String(payload.position??"a0"),removed:false,locked:false,
          properties:typeof payload.properties==="object"&&payload.properties&&!Array.isArray(payload.properties)?{...payload.properties}: {},sourceEvents:[]});
        continue;
      }
      const block=blocks.get(id);
      if(!block)continue;
      let property="",expected:unknown,actual:unknown,next:unknown,guarded=false;
      if(event.type==="BlockPropertyEdited"){
        property=String(payload.property_path??"");expected=payload.old_value;next=payload.new_value;
        actual=property==="type"?block.type:property==="position"?block.position:block.properties[property];
        guarded=Object.prototype.hasOwnProperty.call(payload,"old_value")
          &&(property==="type"||property==="position"||Object.prototype.hasOwnProperty.call(block.properties,property));
      }else if(event.type==="BlockRenamed"){
        property="handle";actual=block.handle;expected=payload.old_handle;next=payload.new_handle;
        guarded=Object.prototype.hasOwnProperty.call(payload,"old_handle");
      }else if(event.type==="BlockWeightSet"){
        property="weight";actual=block.properties.weight;expected=payload.previous_weight;next=payload.weight;
        guarded=Object.prototype.hasOwnProperty.call(payload,"previous_weight")&&Object.prototype.hasOwnProperty.call(block.properties,"weight");
      }else continue;
      if(guarded&&!sameValue(actual,expected))return Response.json({error:"context_value_conflict",blockId:id,property,
        message:"Another collaborator changed this exact decision. Your change was not saved; review the latest value and try again."},{status:409});
      if(property==="handle")block.handle=String(next??block.handle);
      else if(property==="type")block.type=String(next??block.type);
      else if(property==="position")block.position=String(next??block.position);
      else if(property)block.properties[property]=event.type==="BlockWeightSet"?Number(next??.5):next;
    }
  }
  if(incoming.some((event)=>event.type==="OutputRenamed")){
    const snapshot=foldEvents(await readProjectSourceEvents(env,context),Number.POSITIVE_INFINITY,"",context.projectId);
    for(const event of incoming.filter((candidate)=>candidate.type==="OutputRenamed")){
      const payload=event.payload??{},id=String(payload.output_id??"");
      const target=payload.output_kind==="image"
        ?snapshot.libraryOutputs.find((candidate)=>candidate.id===id)
        :payload.output_kind==="artifact"?snapshot.libraryArtifacts.find((candidate)=>candidate.id===id):undefined;
      if(!target||target.documentId!==String(payload.document_id??"")||String(payload.project_id??"")!==context.projectId
        ||payload.output_kind==="artifact"&&payload.artifact_kind!==undefined&&"kind" in target&&target.kind!==payload.artifact_kind)
        return Response.json({error:"foreign_output_resource"},{status:403});
      if(target.title&&Object.hasOwn(payload,"old_title")&&String(payload.old_title??"")!==target.title)
        return Response.json({error:"output_title_conflict",message:"Another collaborator renamed this result. Review its latest name and try again."},{status:409});
      if(typeof payload.new_title==="string")target.title=payload.new_title.normalize("NFC").trim();
    }
  }
  if(incoming.some((event)=>event.type==="BlockCreated"
    ?event.payload?.type==="model3d"||Object.keys(event.payload?.properties&&typeof event.payload.properties==="object"?event.payload.properties:{}).some((key)=>key.startsWith("model_"))
    :["BlockPropertyEdited","ChipEdited"].includes(String(event.type))&&["type","model_url","model_mime_type","model_content_hash","model_reference_id","model_view","media_url","media_type","source_mime_type","source_content_hash","reference_id","pixel_reference_mode"].includes(String(event.type==="ChipEdited"?event.payload?.property:event.payload?.property_path)))){
    const issue=await validateModel3dAssetEvents({env,ownerId:context.ownerUserId,sourceEvents:await readProjectSourceEvents(env,context),events:incoming,projectAccessId:context.projectAccessId});
    if(issue)return Response.json(issue,{status:issue.status});
  }
  const pending:PendingProjectResources=new Map();
  const currentResources=await env.DB.prepare(`SELECT resource.resource_kind,resource.resource_id,json_extract(event.payload,'$.canvas_id') AS canvas_id
    FROM project_resource_scopes resource LEFT JOIN events event ON event.event_id=resource.source_event_id
    WHERE resource.project_access_id=? AND resource.organization_id=? AND resource.owner_user_id=?`)
    .bind(context.projectAccessId,context.organizationId,context.ownerUserId).all<{resource_kind:string;resource_id:string;canvas_id:string|null}>();
  for(const resource of currentResources.results){
    const kind=String(resource.resource_kind),id=String(resource.resource_id),key=`existing:${kind}`,values=pending.get(key)??new Set<string>();
    values.add(id);pending.set(key,values);
    if(resource.canvas_id&&["canvas_item","canvas_arrangement","canvas_context"].includes(kind))pending.set(`parent:${kind}:${id}`,new Set([String(resource.canvas_id)]));
  }
  if(bulkAuthoring){
    const resourceKinds:Record<string,string>={DocumentCreated:"document",DocumentForked:"document",BlockCreated:"block",CollectionCreated:"collection",BlockRelationAdded:"relation",ReferenceIngested:"reference",CanvasCreated:"canvas",CanvasItemPlaced:"canvas_item",CanvasReferenceCreated:"canvas_item",CanvasArrangementCreated:"canvas_arrangement",ContextSetFormalized:"canvas_context"};
    for(const kind of new Set(Object.values(resourceKinds)))pending.set(`owner-history:${kind}`,new Set());
    const historical=await env.DB.prepare(`SELECT type,payload FROM events WHERE stream_id=? AND type IN(${Object.keys(resourceKinds).map((type)=>"'"+type+"'").join(",")})`)
      .bind(ownerStream).all<{type:string;payload:string}>();
    for(const row of historical.results){
      const kind=resourceKinds[row.type],payload=JSON.parse(row.payload) as Record<string,unknown>;
      const property=kind==="relation"?"relation_id":kind==="canvas_item"?"item_id":kind==="canvas_arrangement"?"arrangement_id":kind==="canvas_context"?"context_set_id":`${kind}_id`;
      for(const value of [payload[property],...(kind==="canvas_item"?[payload.reference_item_id]:[])])if(value)pending.get(`owner-history:${kind}`)!.add(String(value));
    }
  }
  const needsReviewValidation=incoming.some((event)=>ARTIFACT_REVIEW_EVENT_TYPES.has(String(event.type??"")));
  const validatedOwnerHead=needsReviewValidation?await streamHead(env,ownerStream):null;
  const reviewEvents=needsReviewValidation?await readProjectSourceEvents(env,context):null;
  if(incoming.some((event)=>event.type==="BlockRelationRemoved"||event.type==="BlockRelationAdded"&&isContextCompositionRelation(event.payload?.kind))){
    const graphEvents=reviewEvents??await readProjectSourceEvents(env,context);
    const graph=foldEvents(graphEvents,Number.POSITIVE_INFINITY,"",context.projectId);
    const issue=validateContextCompositionGraph({blocks:graph.libraryBlocks,relations:graph.libraryBlockRelations,events:incoming,ignoreLocks:privilegedPackageSidecars});
    if(issue)return Response.json({error:issue.code,message:issue.message,index:issue.index},{status:409});
  }
  if(incoming.some((event)=>event.type==="ArtifactApproved")&&incoming.some((event)=>/^(?:Block|Chip|DocumentArtifactEdited)/.test(String(event.type??"")))){
    return Response.json({error:"review_context_changed",message:"Approve the output separately after its latest context changes have been reviewed."},{status:409});
  }
  for(const [index,event] of incoming.entries()){
    if((assistantAcceptance||atomicSidecars?.authoringOperation==="workspace-quick-edit")&&index===0&&event.type==="ProposalAccepted")continue;
    const reason=await validateProjectMutation(env,context,event,pending,principal,canvasAction);if(reason)return Response.json({error:reason},{status:403});
    if(reviewEvents&&ARTIFACT_REVIEW_EVENT_TYPES.has(String(event.type??""))){
      const type=String(event.type),artifactId=String(event.payload?.artifact_id??"");
      const completed=[...reviewEvents].reverse().find((candidate)=>candidate.type==="DocumentRenderCompleted"&&String(candidate.payload.artifact_id??"")===artifactId);
      const exactReview=["ArtifactReviewRequested","ArtifactApproved","ArtifactChangesRequested"].includes(type);
      const expectedArtifactRevision=exactReview?reviewEvents.filter((candidate)=>candidate.type==="DocumentArtifactEdited"&&String(candidate.payload.artifact_id??"")===artifactId).length:undefined;
      const exactBinding=exactReview?await currentProjectArtifactBinding(env,context,String(completed?.payload.content_ref??"")):null;
      const expectedContentSha256=exactBinding?.contentSha256;
      const validation=validateArtifactReview({type,payload:event.payload??{},events:reviewEvents,actorUserId:principal.userId,projectId:context.projectId,canApprove:hasCapability(principal,"project.review.approve",{organizationId:context.organizationId,projectAccessId:context.projectAccessId}),independentReviewer:true,...(exactReview?{expectedArtifactRevision,expectedContentSha256}:{})});
      if(!validation.ok)return Response.json({error:validation.code,message:validation.message},{status:validation.status});
      if(exactBinding&&expectedArtifactRevision!==undefined){
        const document=foldEvents(reviewEvents,Number.POSITIVE_INFINITY,String(completed?.payload.document_id??""),context.projectId);
        const rightsBinding=await currentRights(document,reviewEvents);
        if(!rightsBinding)return Response.json({error:"context_source_rights_expired"},{status:409});
        exactArtifactBindings.set(artifactId,{contentId:exactBinding.contentId,content:exactBinding.content,revision:expectedArtifactRevision,...rightsBinding});
      }
      if(type==="ArtifactReviewRequested"&&!String(event.payload?.assigned_reviewer_user_id??"")){
        const controlled=await env.DB.prepare("SELECT 1 AS present FROM pilot_cohorts WHERE organization_id=? AND status IN('active','paused') LIMIT 1")
          .bind(context.organizationId).first();
        if(controlled)return Response.json({error:"assigned_artifact_reviewer_required"},{status:409});
      }
      if(type==="ArtifactReviewRequested"&&event.payload?.assigned_reviewer_user_id!==undefined){
        const assigned=String(event.payload.assigned_reviewer_user_id??"");
        if(!assigned||assigned===principal.userId)return Response.json({error:"independent_assigned_reviewer_required"},{status:403});
        const eligible=await env.DB.prepare(`SELECT member.user_id FROM organization_memberships member
          JOIN organization_projects project ON project.project_access_id=? AND project.organization_id=member.organization_id AND project.status='active'
          LEFT JOIN project_memberships project_member ON project_member.project_access_id=project.project_access_id
            AND project_member.organization_id=project.organization_id AND project_member.user_id=member.user_id
            AND project_member.status='active' AND project_member.revoked_at IS NULL
          WHERE member.organization_id=? AND member.user_id=? AND member.status='active' AND member.accepted_at IS NOT NULL AND member.revoked_at IS NULL
            AND (project.owner_user_id=member.user_id OR project_member.membership_id IS NOT NULL)
            AND (project.owner_user_id=member.user_id OR EXISTS(SELECT 1 FROM capability_grants grant_row
              WHERE grant_row.user_id=member.user_id AND grant_row.capability='project.review.approve' AND grant_row.scope_type='project'
                AND grant_row.organization_id=member.organization_id AND grant_row.project_access_id=project.project_access_id
                AND grant_row.status='active' AND grant_row.revoked_at IS NULL AND (grant_row.expires_at IS NULL OR grant_row.expires_at>?)))
            AND ${effectivePilotParticipantSql("member.organization_id","member.user_id")}`)
          .bind(context.projectAccessId,context.organizationId,assigned,new Date().toISOString()).first();
        if(!eligible)return Response.json({error:"eligible_assigned_reviewer_required"},{status:403});
        const creator=String(completed?.payload.requested_by_user_id??"");
        const contributed=reviewEvents.some((candidate)=>candidate.type==="DocumentArtifactEdited"&&String(candidate.payload.artifact_id??"")===artifactId&&String(candidate.actor??"")===`user:${assigned}`);
        if(creator===assigned||contributed)return Response.json({error:"independent_assigned_reviewer_required"},{status:403});
      }
      if(type==="ArtifactApproved"||type==="ArtifactChangesRequested"){
        const latestRequest=[...reviewEvents].reverse().find((candidate)=>candidate.type==="ArtifactReviewRequested"&&String(candidate.payload.artifact_id??"")===artifactId);
        const designated=latestRequest?await env.DB.prepare(`SELECT assigned_user_id FROM project_review_tasks
          WHERE project_access_id=? AND organization_id=? AND artifact_id=? AND request_event_id=?
            AND assigned_user_id=? AND artifact_revision=? AND content_sha256=? AND status='pending'`)
          .bind(context.projectAccessId,context.organizationId,artifactId,latestRequest.eventId,principal.userId,expectedArtifactRevision!,expectedContentSha256!).first():null;
        if(!designated)
          return Response.json({error:"assigned_artifact_reviewer_required"},{status:403});
      }
      event.payload=validation.payload;
    }
  }
  const ownerHead=await streamHead(env,ownerStream);
  if(atomicSidecars?.authoringOperation&&ownerHead!==atomicSidecars.expectedOwnerHead)return Response.json({error:"authoring_source_stale"},{status:409});
  if(validatedOutputOwnerHead!==null&&ownerHead!==validatedOutputOwnerHead)return Response.json({error:"output_requirement_context_changed"},{status:409});
  if(assistantAcceptance&&ownerHead!==atomicSidecars?.expectedOwnerHead)return Response.json({error:"assistant_proposal_stale"},{status:409});
  if(validatedOwnerHead!==null&&ownerHead!==validatedOwnerHead)return Response.json({error:"stale_review_context",message:"The project changed while this review was being checked. Refresh and review the latest version."},{status:409});
  if(releaseValidationHead!==null&&ownerHead!==releaseValidationHead)return Response.json({error:"stale_release_context",message:"The project changed while export approval was being checked. Refresh the approved output before releasing it."},{status:409});
  const current=await env.DB.prepare("SELECT COALESCE(MAX(project_sequence),0) AS head FROM project_event_scopes WHERE project_access_id=?").bind(context.projectAccessId).first<{head:number}>();
  let projectHead=Number(current?.head??0);
  if(action!=="canvas_sync"&&Number.isSafeInteger(body.expectedSequence)&&Number(body.expectedSequence)!==projectHead)return Response.json({error:"stale_sequence",expected:body.expectedSequence,head:projectHead},{status:409});
  const now=new Date().toISOString(),appended:EventRow[]=[],statements:D1PreparedStatement[]=[];
  let bulkAdmission:BudgetReservationGuard|null=null,bulkAdmissionKey="";
  const bulkProjectRows:Array<Array<string|number|null>>=[],bulkResourceRows:Array<Array<string|number|null>>=[];
  const bulkMediaRows:Array<[string,string,string,string]>=[];
  if(validatedOutputOwnerHead!==null)statements.push(outputRequirementHeadGuard(env,ownerStream,validatedOutputOwnerHead));
  for(const [offset,input] of incoming.entries()){
    const payload:Record<string,unknown>={...(input.payload??{}),project_id:context.projectId,...(canvasAction?{history_owner_id:principal.userId}:{})};
    const event=makeEvent(ownerStream,ownerHead+offset+1,`user:${principal.userId}`,String(body.clientId??`project:${principal.userId}`),String(body.correlationId??uuidV7()),String(input.type),payload,{compensatesEventId:input.compensatesEventId??null});
    const guard=`EXISTS (SELECT 1 FROM organization_projects project JOIN organizations organization ON organization.organization_id=project.organization_id AND organization.status='active'
      JOIN project_migration_states migration ON migration.project_access_id=project.project_access_id AND migration.organization_id=project.organization_id AND migration.status='active'
      JOIN users actor_identity ON actor_identity.user_id=? AND actor_identity.consent_version=?
      JOIN organization_memberships member ON member.organization_id=project.organization_id AND member.user_id=? AND member.status='active' AND member.accepted_at IS NOT NULL AND member.revoked_at IS NULL
      JOIN organization_memberships owner_member ON owner_member.organization_id=project.organization_id AND owner_member.user_id=project.owner_user_id AND owner_member.status='active' AND owner_member.accepted_at IS NOT NULL AND owner_member.revoked_at IS NULL
      LEFT JOIN project_memberships project_member ON project_member.project_access_id=project.project_access_id AND project_member.organization_id=project.organization_id AND project_member.project_id=project.project_id AND project_member.user_id=? AND project_member.status='active' AND project_member.revoked_at IS NULL
      WHERE project.project_access_id=? AND project.organization_id=? AND project.status='active' AND (project.owner_user_id=? OR project_member.role IN ('editor','owner') OR(?=1 AND project_member.role='viewer'))
        AND ${effectivePilotParticipantSql("project.organization_id","member.user_id")}
        AND (${exportOnly||reviewOnly?1:0}=1 OR NOT ${effectivePilotReviewerSql("project.organization_id","member.user_id")})
        AND (${event.type==="ArtifactReviewRequested"&&!String(payload.assigned_reviewer_user_id??"")?1:0}=0
          OR NOT EXISTS(SELECT 1 FROM pilot_cohorts controlled WHERE controlled.organization_id=project.organization_id AND controlled.status IN('active','paused')))
        AND (?='' OR EXISTS(SELECT 1 FROM project_context_sessions selected WHERE selected.context_id=? AND selected.principal_user_id=?
          AND selected.project_access_id=project.project_access_id AND selected.organization_id=project.organization_id AND selected.revoked_at IS NULL AND selected.expires_at>? AND selected.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')))
        AND (?=0 OR project.owner_user_id=? OR EXISTS(SELECT 1 FROM capability_grants canvas_grant WHERE canvas_grant.user_id=?
          AND canvas_grant.capability='project.canvas.use' AND canvas_grant.scope_type='project' AND canvas_grant.organization_id=project.organization_id
          AND canvas_grant.project_access_id=project.project_access_id AND canvas_grant.status='active' AND canvas_grant.revoked_at IS NULL
          AND (canvas_grant.expires_at IS NULL OR canvas_grant.expires_at>?)))
        AND (?=0 OR project.owner_user_id=? OR EXISTS(SELECT 1 FROM capability_grants review_grant WHERE review_grant.user_id=?
          AND review_grant.capability='project.review.approve' AND review_grant.scope_type='project' AND review_grant.organization_id=project.organization_id
          AND review_grant.project_access_id=project.project_access_id AND review_grant.status='active' AND review_grant.revoked_at IS NULL
          AND (review_grant.expires_at IS NULL OR review_grant.expires_at>? AND review_grant.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')))))`;
    const contentGuard=atomicEdit?` AND EXISTS(SELECT 1 FROM private_content content
      JOIN project_resource_scopes artifact ON artifact.project_access_id=? AND artifact.organization_id=? AND artifact.project_id=? AND artifact.owner_user_id=? AND artifact.resource_kind='artifact' AND artifact.resource_id=?
      JOIN project_resource_scopes retained ON retained.project_access_id=artifact.project_access_id AND retained.organization_id=artifact.organization_id AND retained.project_id=artifact.project_id AND retained.owner_user_id=artifact.owner_user_id AND retained.resource_kind='content' AND retained.resource_id=content.content_id AND retained.visibility='collaborative_output'
      WHERE content.content_id=? AND content.owner_id=? AND content.kind='document-artifact' AND content.redacted_at IS NULL
        AND(content.expires_at>? OR ${artifactContentHoldSql("content","artifact")}) AND content.content=?)
      AND (SELECT COUNT(*) FROM events revision WHERE revision.stream_id=? AND revision.type='DocumentArtifactEdited' AND json_extract(revision.payload,'$.artifact_id')=?)=?`:"";
    const exactContentProof=exportOnly
      ?artifactExactBatchGuard(context,new Map((exportArtifactIds.get(input)??[]).map(id=>[id,exactArtifactBindings.get(id)!])))
      :artifactExactBatchGuard(context,new Map(exactArtifactBindings.has(String(payload.artifact_id??""))?[[String(payload.artifact_id??""),exactArtifactBindings.get(String(payload.artifact_id??""))!]]:[]));
    if(!exactContentProof)return Response.json({error:"artifact_review_evidence_too_large"},{status:409});
    const restoreGuard=atomicEdit?.restoreSource?` AND EXISTS(SELECT 1 FROM artifact_revisions retained WHERE retained.owner_id=? AND retained.organization_id=? AND retained.project_access_id=?
      AND retained.project_id=? AND retained.artifact_id=? AND retained.revision=? AND retained.redacted_at IS NULL
      AND(retained.expires_at>? OR ${artifactRevisionHoldSql("retained")})
      AND retained.content_sha256=? AND retained.content_json=?)`:"";
    const assigned=event.type==="ArtifactReviewRequested"?String(payload.assigned_reviewer_user_id??""):"";
    const assignmentGuard=assigned?` AND EXISTS(SELECT 1 FROM organization_projects assigned_project
      JOIN organization_memberships assigned_member ON assigned_member.organization_id=assigned_project.organization_id
        AND assigned_member.user_id=? AND assigned_member.status='active' AND assigned_member.accepted_at IS NOT NULL AND assigned_member.revoked_at IS NULL
      LEFT JOIN project_memberships assigned_project_member ON assigned_project_member.project_access_id=assigned_project.project_access_id
        AND assigned_project_member.organization_id=assigned_project.organization_id AND assigned_project_member.user_id=assigned_member.user_id
        AND assigned_project_member.status='active' AND assigned_project_member.revoked_at IS NULL
      WHERE assigned_project.project_access_id=? AND assigned_project.organization_id=? AND assigned_project.status='active'
        AND assigned_member.user_id<>? AND (assigned_project.owner_user_id=assigned_member.user_id OR assigned_project_member.membership_id IS NOT NULL)
        AND (assigned_project.owner_user_id=assigned_member.user_id OR EXISTS(SELECT 1 FROM capability_grants assigned_grant
          WHERE assigned_grant.user_id=assigned_member.user_id AND assigned_grant.capability='project.review.approve'
            AND assigned_grant.scope_type='project' AND assigned_grant.organization_id=assigned_project.organization_id
            AND assigned_grant.project_access_id=assigned_project.project_access_id AND assigned_grant.status='active'
            AND assigned_grant.revoked_at IS NULL AND (assigned_grant.expires_at IS NULL OR assigned_grant.expires_at>? AND assigned_grant.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))))
        AND ${effectivePilotParticipantSql("assigned_member.organization_id","assigned_member.user_id")})`:"";
    const decision=["ArtifactApproved","ArtifactChangesRequested"].includes(event.type);
    const decisionGuard=decision?` AND EXISTS(SELECT 1 FROM project_review_tasks exact_task
      WHERE exact_task.project_access_id=? AND exact_task.organization_id=? AND exact_task.artifact_id=?
        AND exact_task.assigned_user_id=? AND exact_task.artifact_revision=? AND exact_task.content_sha256=? AND exact_task.status='pending'
        AND exact_task.request_event_id=(SELECT requested_scope.event_id FROM project_event_scopes requested_scope
          JOIN events requested_event ON requested_event.event_id=requested_scope.event_id
          WHERE requested_scope.project_access_id=? AND requested_scope.organization_id=? AND requested_event.type='ArtifactReviewRequested'
            AND json_extract(requested_event.payload,'$.artifact_id')=? ORDER BY requested_scope.project_sequence DESC LIMIT 1))`:"";
    const sidecarGuard=atomicSidecars?.guardSql?` AND (${atomicSidecars.guardSql})`:"";
    const writeBindings:Array<string|number|null>=[
        principal.userId,POLICY_VERSION,principal.userId,principal.userId,context.projectAccessId,context.organizationId,principal.userId,Number(exportOnly||reviewOnly),
        context.contextId,context.contextId,principal.userId,now,canvasAction?1:0,principal.userId,principal.userId,now,reviewOnly||["ArtifactApproved","ArtifactChangesRequested"].includes(event.type)?1:0,principal.userId,principal.userId,now,
        ...(atomicEdit?[context.projectAccessId,context.organizationId,context.projectId,context.ownerUserId,atomicEdit.artifactId,atomicEdit.contentId,context.ownerUserId,now,atomicEdit.oldContent,ownerStream,atomicEdit.artifactId,atomicEdit.expectedRevision]:[]),
        ...exactContentProof.bindings,
        ...(atomicEdit?.restoreSource?[context.ownerUserId,context.organizationId,context.projectAccessId,context.projectId,atomicEdit.artifactId,atomicEdit.restoreSource.revision,now,atomicEdit.restoreSource.contentSha256,atomicEdit.restoreSource.contentJson]:[]),
        ...(assigned?[assigned,context.projectAccessId,context.organizationId,principal.userId,now]:[]),
        ...(decision?[context.projectAccessId,context.organizationId,String(payload.artifact_id??""),principal.userId,Number(payload.artifact_revision??-1),String(payload.content_sha256??""),context.projectAccessId,context.organizationId,String(payload.artifact_id??"")]:[]),
        ...(atomicSidecars?.guardBindings??[])
    ];
    if(bulkAuthoring){
      const sql=`${guard}${contentGuard}${exactContentProof.sql}${restoreGuard}${assignmentGuard}${decisionGuard}${sidecarGuard}`,key=JSON.stringify([sql,writeBindings]);
      if(bulkAdmission&&bulkAdmissionKey!==key)throw new Error("invalid_authoring_operation");
      bulkAdmission={sql,bindings:writeBindings};bulkAdmissionKey=key;
    }else{
      statements.push(env.DB.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS})
        SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=? AND ${guard}${contentGuard}${exactContentProof.sql}${restoreGuard}${assignmentGuard}${decisionGuard}${sidecarGuard}`)
        .bind(...eventWriteBindings(event),ownerStream,event.sequence-1,...writeBindings));
    }
    projectHead+=1;
    const projectRow=[event.eventId,context.projectAccessId,context.organizationId,context.projectId,context.ownerUserId,ownerStream,event.sequence,projectHead,principal.userId,now];
    if(bulkAuthoring)bulkProjectRows.push(projectRow);
    else statements.push(env.DB.prepare("INSERT INTO project_event_scopes(event_id,project_access_id,organization_id,project_id,owner_user_id,source_stream_id,source_sequence,project_sequence,actor_user_id,created_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM events WHERE event_id=?)")
      .bind(...projectRow,event.eventId));
    if(atomicEdit)for(const revision of atomicEdit.revisions)statements.push(env.DB.prepare(`INSERT INTO artifact_revisions(revision_id,owner_id,organization_id,project_access_id,project_id,document_id,artifact_id,revision,content_json,content_sha256,created_by_user_id,created_at,expires_at,redacted_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,NULL WHERE EXISTS(SELECT 1 FROM events WHERE event_id=?)`)
      .bind(revision.revisionId,context.ownerUserId,context.organizationId,context.projectAccessId,context.projectId,atomicEdit.documentId,atomicEdit.artifactId,revision.revision,revision.contentJson,revision.contentSha256,revision.createdByUserId,revision.createdAt,revision.expiresAt,event.eventId));
    if(atomicEdit)statements.push(env.DB.prepare(`UPDATE private_content
      SET content=?,expires_at=CASE WHEN expires_at<=? THEN ? ELSE expires_at END
      WHERE content_id=? AND owner_id=? AND kind='document-artifact' AND redacted_at IS NULL AND content=?
        AND EXISTS(SELECT 1 FROM events WHERE event_id=?)`)
      .bind(atomicEdit.newContent,now,DURABLE_WORK_RETENTION_END,atomicEdit.contentId,context.ownerUserId,atomicEdit.oldContent,event.eventId));
    const resourceKind=event.type==="DocumentCreated"?"document":event.type==="BlockCreated"?"block":event.type==="CollectionCreated"?"collection":event.type==="BlockRelationAdded"?"relation":event.type==="ReferenceIngested"?"reference":event.type==="CanvasCreated"?"canvas":["CanvasItemPlaced","CanvasReferenceCreated"].includes(event.type)?"canvas_item":event.type==="CanvasArrangementCreated"?"canvas_arrangement":event.type==="ContextSetFormalized"?"canvas_context":"";
    const resourceProperty=resourceKind==="document"?"document_id":resourceKind==="block"?"block_id":resourceKind==="relation"?"relation_id":resourceKind==="reference"?"reference_id":resourceKind==="canvas"?"canvas_id":resourceKind==="canvas_item"?(payload.item_id?"item_id":"reference_item_id"):resourceKind==="canvas_arrangement"?"arrangement_id":resourceKind==="canvas_context"?"context_set_id":"collection_id";
    const resourceId=String(payload[resourceProperty]??"");
    if(resourceKind&&resourceId){
      const resourceRow=[context.projectAccessId,resourceKind,resourceId,context.organizationId,context.projectId,context.ownerUserId,"collaborative_output",event.eventId,principal.userId,now];
      if(bulkAuthoring)bulkResourceRows.push(resourceRow);
      else statements.push(env.DB.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM events WHERE event_id=?)")
        .bind(...resourceRow,event.eventId));
    }
    if(event.type==="BlockCreated"){
      const properties=payload.properties&&typeof payload.properties==="object"?payload.properties as Record<string,unknown>:{};
      for(const key of new Set([mediaKey(properties.media_url),mediaKey(properties.model_url)].filter(Boolean))){
        if(bulkAuthoring)bulkMediaRows.push([event.eventId,context.projectAccessId,context.organizationId,key]);
        else statements.push(env.DB.prepare("UPDATE project_resource_scopes SET source_event_id=? WHERE project_access_id=? AND organization_id=? AND resource_kind='media' AND resource_id=? AND EXISTS(SELECT 1 FROM events WHERE event_id=?)")
          .bind(event.eventId,context.projectAccessId,context.organizationId,key,event.eventId));
      }
    }
    if(action==="canvas_sync"){
      const originalIndex=original.indexOf(input);
      statements.push(env.DB.prepare("INSERT INTO event_client_receipts(stream_id,client_event_id,event_id,sequence,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM project_event_scopes WHERE event_id=? AND project_access_id=? AND organization_id=? AND actor_user_id=?)")
        .bind(ownerStream,receiptKeys[originalIndex],event.eventId,event.sequence,now,event.eventId,context.projectAccessId,context.organizationId,principal.userId));
    }
    appended.push(event);
  }
  const invalidatesResources=incoming.some(({type,payload})=>/Removed$|Restored$|Discarded$|Rehomed$/.test(String(type??""))
    ||(type==="BlockPropertyEdited"||type==="ChipEdited")&&["media_url","model_url","reference_id","model_reference_id","source_document_id","source_block_id","source_output_id"].includes(String(type==="BlockPropertyEdited"?payload?.property_path:payload?.property)));
  let writeProof:BudgetReservationGuard|undefined;
  if(bulkAuthoring){
    if(!bulkAdmission)throw new Error("invalid_authoring_operation");
    const authored=prepareAuthoringEventBatch(env,appended,ownerHead,bulkAdmission);
    const scoped=prepareAuthoringSidecarBatch(env,"project_event_scopes",bulkProjectRows);
    const resources=prepareAuthoringSidecarBatch(env,"project_resource_scopes",bulkResourceRows);
    const media=prepareAuthoringMediaBatch(env,bulkMediaRows);
    statements.push(...authored.statements,...scoped.statements,...resources.statements,...media.statements);
    writeProof=combineAuthoringGuards(authored.proof,scoped.proof,resources.proof,media.proof);
  }
  if(atomicSidecars?.statements?.length)statements.push(...atomicSidecars.statements);
  if(atomicSidecars?.buildStatements&&appended.length)statements.push(...atomicSidecars.buildStatements(appended.at(-1)!.eventId,writeProof,appended));
  if(needsReviewValidation||exportOnly){
    const completion=artifactReviewCompletionGuard(context,appended);
    // last_owner_sequence is already NOT NULL: a suppressed row aborts all event, task, notification, and index writes.
    statements.push(env.DB.prepare(`UPDATE project_migration_states SET last_owner_sequence=CASE WHEN ${completion.sql} THEN ? ELSE NULL END,updated_at=?
      WHERE project_access_id=? AND organization_id=? AND owner_user_id=? AND status='active'`)
      .bind(...completion.bindings,ownerHead+incoming.length,now,context.projectAccessId,context.organizationId,context.ownerUserId));
  }else{
    statements.push(env.DB.prepare("UPDATE project_migration_states SET last_owner_sequence=?,updated_at=? WHERE project_access_id=? AND organization_id=? AND owner_user_id=? AND status='active' AND (?='' OR EXISTS(SELECT 1 FROM events WHERE event_id=?))")
      .bind(invalidatesResources?ownerHead:ownerHead+incoming.length,now,context.projectAccessId,context.organizationId,context.ownerUserId,atomicEdit||atomicSidecars?appended.at(-1)?.eventId??"":"",atomicEdit||atomicSidecars?appended.at(-1)?.eventId??"":""));
  }
  try{
    const results=await env.DB.batch(statements);
    if(!bulkAuthoring&&results.slice(validatedOutputOwnerHead===null?0:1).some((result)=>Number(result.meta.changes??0)!==1))return Response.json({error:"project_access_revoked"},{status:403});
  }catch{return Response.json({error:"stale_sequence",head:projectHead-incoming.length},{status:409});}
  const first=projectHead-appended.length+1;
  const newEvents=new Map(incoming.map((input,index)=>[input,{...appended[index]!,streamId:`project:${context.projectAccessId}`,sequence:first+index}] as const));
  return Response.json({appended:original.map((input,index)=>{
    const previous=existing.get(receiptKeys[index]??"");
    return previous?existingEvents.get(previous.eventId)!:newEvents.get(input)!;
  }),rejected:[],head:projectHead,...(existing.size?{idempotent:true}:{})});
}

export async function recordOrganizationAudit(env:WorkerEnv,organizationId:string,actor:PilotUser,action:string,resourceKind:string,resourceId:string,detail:Record<string,string|number|boolean>={}){
  const now=new Date().toISOString();
  await env.DB.prepare("INSERT INTO organization_audit_events(audit_id,organization_id,actor_user_id,action,resource_kind,resource_id,detail_json,occurred_at) VALUES(?,?,?,?,?,?,?,?)")
    .bind(uuidV7(),organizationId,actor.userId,action,resourceKind,resourceId,JSON.stringify(detail),now).run();
  await appendEvents(env,[makeEvent(actor.streamId,0,`user:${actor.userId}`,"server:workspace",uuidV7(),action,{organization_id:organizationId,resource_kind:resourceKind,resource_id:resourceId})]);
}

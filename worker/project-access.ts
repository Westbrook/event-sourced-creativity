import { foldEvents, type CreativeEvent } from "../src/model/events.ts";
import { foldCanvasEvents } from "../src/canvas/model.ts";
import { FORMA_CAPABILITIES, type FormaCapability } from "../src/platform/capabilities.ts";
import { DURABLE_WORK_RETENTION_END, POLICY_VERSION, hasCapability, type PilotUser } from "./pilot-policy.ts";
import { appendEvents, EVENT_WRITE_COLUMNS, eventWriteBindings, makeEvent, readEvents, readEventsByClientEventIds, serializeEvent, streamHead, uuidV7, type EventRow, type WorkerEnv } from "./runtime.ts";
import { validateCanvasEvent } from "./realtime/canvas-admission.ts";
import { ARTIFACT_REVIEW_EVENT_TYPES, validateArtifactReview } from "./artifact-review.ts";
import { managedPilotSourceClassificationValid, verifySourceDocumentEvidence } from "./media-api.ts";
import { effectivePilotParticipantSql, effectivePilotReviewerSql } from "./access-policy.ts";
import { artifactReviewState, artifactSourceVersions } from "../src/model/context-health.ts";
import { productionWorkflowIssues, type ProductionWorkflow } from "../src/model/production-workflow.ts";
import { isContextCompositionRelation, validateContextCompositionGraph } from "../src/model/combined-context.ts";

const CONTEXT_COOKIE="forma_project_context";
const PROJECT_EVENT_TYPES=new Set([
  "ProjectCreated","ProjectRenamed","ProjectStateChanged","DocumentCreated","DocumentForked","DocumentRenamed","DocumentRemoved","DocumentRestored","DocumentProductionWorkflowConfigured","EmptyCanvasChosen",
  "BlockCreated","BlockRenamed","BlockPropertyEdited","BlockWeightSet","BlockLocked","BlockUnlocked","BlockRemoved","BlockRestored","BlockRehomed",
  "BlockRelationAdded","BlockRelationRemoved","ReferenceIngested","RightsAsserted","RegionPromoted","ExtractionRequested","ExtractionCompleted","ExtractionFailed","ExtractionSuperseded","ChipEdited",
  "CollectionCreated","CollectionRenamed","CollectionRemoved","CollectionRestored","CollectionItemAdded","CollectionItemRemoved","CollectionItemMoved",
  "ContextCompiled","GenerationCompleted","IdeationPreviewCompleted","IdeationPromoted","DocumentRenderCompleted","DocumentArtifactEdited","DocumentArtifactExported","ArtifactReviewRequested","ArtifactApproved","ArtifactChangesRequested","ChatMessageSent","AssistantReasoned",
  "ObjectSaved","ObjectDiscarded","ObjectPinned","ObjectUnpinned","ObjectExported","PromptFanOutputPromoted","AddedToLibrary","RemovedFromLibrary",
  "CanvasCreated","CanvasItemPlaced","CanvasReferenceCreated","CanvasTextApplied","CanvasArrangementCreated","CanvasArrangementRemoved","CanvasArrangementRestored",
  "CanvasRegisterSet","CanvasLockAcquired","CanvasLockReleased","StrokeAdded","StrokeErased","ContextSetFormalized","CanvasItemRemoved","CanvasItemRestored","CanvasRenamed","CanvasRemoved","CanvasRestored",
]);
const PROJECT_MUTATION_TYPES=new Set([
  "DocumentCreated","DocumentRenamed","DocumentRemoved","DocumentRestored","DocumentProductionWorkflowConfigured","BlockCreated","BlockRenamed","BlockPropertyEdited","BlockWeightSet",
  "BlockLocked","BlockUnlocked","BlockRemoved","BlockRestored","BlockRelationAdded","BlockRelationRemoved","CollectionCreated","CollectionRenamed",
  "CollectionRemoved","CollectionRestored","CollectionItemAdded","CollectionItemRemoved","CollectionItemMoved","ObjectSaved","ObjectPinned","ObjectUnpinned",
  "ObjectDiscarded","ObjectExported","DocumentArtifactEdited","DocumentArtifactExported","ArtifactReviewRequested","ArtifactApproved","ArtifactChangesRequested","AddedToLibrary","RemovedFromLibrary","ChipEdited","ReferenceIngested","RightsAsserted",
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
    JOIN project_migration_states migration ON migration.project_access_id=project.project_access_id AND migration.organization_id=project.organization_id AND migration.status='active'
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

const readCookie=(request:Request,name:string)=>{
  const value=request.headers.get("cookie")?.split(";").map((part)=>part.trim()).find((part)=>part.startsWith(`${name}=`))?.slice(name.length+1)??"";
  try{return decodeURIComponent(value);}catch{return"";}
};

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

/** Rebuild an exact manifest from one immutable owner history; ambiguous/private rows never enter it. */
export async function synchronizeProjectScope(env:WorkerEnv,input:{organizationId:string;projectAccessId:string;projectId:string;ownerUserId:string}){
  const ownerStream=`creative:${input.ownerUserId}`;
  const state=await env.DB.prepare("SELECT status,last_owner_sequence FROM project_migration_states WHERE project_access_id=? AND organization_id=? AND owner_user_id=?")
    .bind(input.projectAccessId,input.organizationId,input.ownerUserId).first<{status:string;last_owner_sequence:number}>();
  const head=await streamHead(env,ownerStream);
  if(state?.status==="active"&&Number(state.last_owner_sequence)===head){
    const counts=await env.DB.batch<Record<string,unknown>>([
      env.DB.prepare("SELECT COALESCE(MAX(project_sequence),0) AS count FROM project_event_scopes WHERE project_access_id=?").bind(input.projectAccessId),
      env.DB.prepare("SELECT COUNT(*) AS count FROM project_resource_scopes WHERE project_access_id=? AND resource_kind='document'").bind(input.projectAccessId),
      env.DB.prepare("SELECT COUNT(*) AS count FROM project_resource_scopes WHERE project_access_id=? AND organization_id=? AND resource_kind='manifest_version' AND resource_id='canvas-v1'").bind(input.projectAccessId,input.organizationId),
    ]);
    if(Number(counts[2]?.results[0]?.count??0)>0)return{eventCount:Number(counts[0]?.results[0]?.count??0),documentCount:Number(counts[1]?.results[0]?.count??0)};
  }
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
  const referenceIds=new Set(projection.libraryBlocks.map((block)=>String(block.properties.reference_id??"")).filter(Boolean));
  const referenceMedia=projection.libraryBlocks.map((block)=>({key:mediaKey(block.properties.media_url),sourceEventId:block.sourceEvents.at(-1)??null})).filter((item)=>item.key);
  const previousResources=await env.DB.prepare(`SELECT resource.resource_kind,resource.resource_id,resource.source_event_id,resource.actor_user_id,
    CASE WHEN retained.content_id IS NULL THEN 0 ELSE 1 END AS private_provider_response
    FROM project_resource_scopes resource LEFT JOIN private_content retained ON resource.resource_kind='content'
      AND retained.content_id=resource.resource_id AND retained.owner_id=resource.actor_user_id
      AND(retained.kind='provider-response' OR retained.kind IN('document-artifact-input','activity-issue-note') AND json_valid(retained.content)=1
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
    .bind(new Date().toISOString(),input.projectAccessId,input.organizationId).all<{resource_kind:string;resource_id:string;source_event_id:string|null;actor_user_id:string;private_provider_response:number}>();
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
  const activeResources=new Map<string,Set<string>>([
    ["project",new Set([input.projectId])],["document",documentIds],["block",blockIds],["relation",relationIds],
    ["collection",collectionIds],["output",outputIds],["artifact",artifactIds],["reference",referenceIds],["canvas",canvasIds],
    ["canvas_item",canvasItemIds],["canvas_arrangement",arrangementIds],["canvas_context",contextSetIds],["manifest_version",new Set(["canvas-v1"])],
    ["content",new Set([...projectArtifacts.flatMap((artifact)=>[artifact.contentRef,artifact.inputRef]).filter((value):value is string=>Boolean(value)),...conversationContent.map((item)=>item.id),...previousResources.results.filter((resource)=>resource.resource_kind==="content"&&(resource.actor_user_id!==input.ownerUserId||resource.private_provider_response===1)).map((resource)=>resource.resource_id)])],
    ["media",new Set([...projectOutputs.map((output)=>mediaKey(output.mediaUrl)),...projectArtifacts.flatMap((artifact)=>[mediaKey(artifact.mediaUrl),...artifact.items.map((item)=>mediaKey(item.mediaUrl))]),...referenceMedia.map((item)=>item.key)].filter(Boolean))],
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
    statements.push(env.DB.prepare("DELETE FROM project_resource_scopes WHERE project_access_id=? AND organization_id=? AND resource_kind=? AND resource_id=?")
      .bind(input.projectAccessId,input.organizationId,resource.resource_kind,resource.resource_id));
  }
  const insertResource=(kind:string,id:string,visibility="collaborative_output",sourceEventId:string|null=null,actorUserId=input.ownerUserId)=>{
    if(!id)return;
    statements.push(env.DB.prepare("INSERT OR IGNORE INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .bind(input.projectAccessId,kind,id,input.organizationId,input.projectId,input.ownerUserId,visibility,sourceEventId,actorUserId,now));
  };
  insertResource("project",input.projectId);
  for(const id of documentIds)insertResource("document",id);
  for(const id of blockIds)insertResource("block",id);
  for(const id of relationIds)insertResource("relation",id);
  for(const id of collectionIds)insertResource("collection",id);
  const sourceActor=(sourceEventId:string|null)=>{const event=sourceEventId?eventsById.get(sourceEventId):undefined;return event?.actor.startsWith("user:")?event.actor.slice(5):event?actorByJobCorrelation.get(event.correlationId)??input.ownerUserId:input.ownerUserId;};
  for(const output of projectOutputs)insertResource("output",output.id,"collaborative_output",output.sourceEventId,sourceActor(output.sourceEventId));
  for(const artifact of projectArtifacts)insertResource("artifact",artifact.id,"collaborative_output",artifact.sourceEventId,sourceActor(artifact.sourceEventId));
  for(const id of referenceIds)insertResource("reference",id);
  for(const canvas of projectCanvas.canvases)insertResource("canvas",canvas.id,"collaborative_output",canvas.sourceEvents[0]??null);
  for(const item of validItems)insertResource("canvas_item",item.id,"collaborative_output",item.sourceEvents[0]??null);
  for(const arrangement of validArrangements)insertResource("canvas_arrangement",arrangement.id,"collaborative_output",arrangement.sourceEvents[0]??null);
  for(const contextSet of contextSets)insertResource("canvas_context",contextSet.id,"collaborative_output",contextSet.sourceEventId);
  insertResource("manifest_version","canvas-v1","internal");
  for(const item of referenceMedia)insertResource("media",item.key,"collaborative_output",item.sourceEventId);
  for(const output of projectOutputs){if(output.mediaUrl)insertResource("media",mediaKey(output.mediaUrl),"collaborative_output",output.sourceEventId,sourceActor(output.sourceEventId));}
  for(const artifact of projectArtifacts){
    const actor=sourceActor(artifact.sourceEventId);
    if(artifact.contentRef)insertResource("content",artifact.contentRef,"collaborative_output",artifact.sourceEventId,actor);
    if(artifact.inputRef)insertResource("content",artifact.inputRef,"actor_private",artifact.sourceEventId,actor);
    if(artifact.mediaUrl)insertResource("media",mediaKey(artifact.mediaUrl),"collaborative_output",artifact.sourceEventId,actor);
    for(const item of artifact.items)if(item.mediaUrl)insertResource("media",mediaKey(item.mediaUrl),"collaborative_output",artifact.sourceEventId,actor);
  }
  for(const item of conversationContent)insertResource("content",item.id,"actor_private",item.sourceEventId,item.actor);
  for(const event of events){
    if(known.has(event.eventId)||!scopedEvent(event,index))continue;
    sequence+=1;
    const attributedActor=event.actor.startsWith("user:")?event.actor.slice(5):actorByJobCorrelation.get(event.correlationId)??input.ownerUserId;
    statements.push(env.DB.prepare("INSERT OR IGNORE INTO project_event_scopes(event_id,project_access_id,organization_id,project_id,owner_user_id,source_stream_id,source_sequence,project_sequence,actor_user_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .bind(event.eventId,input.projectAccessId,input.organizationId,input.projectId,input.ownerUserId,ownerStream,event.sequence,sequence,attributedActor,now));
  }
  for(let offset=0;offset<statements.length;offset+=75)await env.DB.batch(statements.slice(offset,offset+75));
  const ownerHead=events.at(-1)?.sequence??0;
  const activated=await env.DB.prepare(`INSERT INTO project_migration_states(project_access_id,organization_id,owner_user_id,status,last_owner_sequence,updated_at)
    SELECT ?,?,?,'active',?,? WHERE EXISTS(SELECT 1 FROM organization_projects project
      JOIN organizations organization ON organization.organization_id=project.organization_id AND organization.status='active'
      JOIN organization_memberships owner ON owner.organization_id=project.organization_id AND owner.user_id=project.owner_user_id
        AND owner.status='active' AND owner.accepted_at IS NOT NULL AND owner.revoked_at IS NULL
      WHERE project.project_access_id=? AND project.organization_id=? AND project.owner_user_id=?
        AND project.status IN('indexing','active') AND ${effectivePilotParticipantSql("organization.organization_id","owner.user_id")})
    ON CONFLICT(project_access_id) DO UPDATE SET status='active',last_owner_sequence=excluded.last_owner_sequence,updated_at=excluded.updated_at
      WHERE project_migration_states.organization_id=excluded.organization_id
        AND project_migration_states.owner_user_id=excluded.owner_user_id`)
    .bind(input.projectAccessId,input.organizationId,input.ownerUserId,ownerHead,now,input.projectAccessId,input.organizationId,input.ownerUserId).run();
  if(Number(activated.meta.changes??0)!==1)throw new Error("project_owner_authorization_changed");
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
      if(/prompt|input_ref|planner_input|chat|attention|taste|authorization|credential|standing_constraints|preference_id|source_event_refs|evidence_refs|provider_(?:status|response|cancel)_url|provider_request|provider_response|(?:video|audio)_input_receipt|artifact_plan/i.test(key))continue;
      if(key==="content_ref"&&!contentIds.has(String(item)))continue;
      if((key==="media_url"||key==="source_ref")&&typeof item==="string"&&mediaKey(item)&&!activeResources.get("media")?.has(mediaKey(item)))continue;
      safe[key]=redact(item);
    }
    return safe;
  };
  return redact(payload) as Record<string,unknown>;
}

function presentProjectEvent(row:Record<string,unknown>,context:ProjectRequestContext,activeResources:Map<string,Set<string>>,contentIds=new Set<string>()){
  const event=serializeEvent(row);
  const privateConversation=event.type==="ChatMessageSent"||event.type==="AssistantReasoned"&&event.payload.operation==="creative-chat";
  if(PROJECT_CANVAS_MUTATION_TYPES.has(event.type)&&!context.permissions.includes("project.canvas.use")||privateConversation&&String(row.actor_user_id)!==context.principalUserId)
    return{...event,streamId:`project:${context.projectAccessId}`,sequence:Number(row.project_sequence),actor:`user:${String(row.actor_user_id)}`,type:"ProjectResourceRestricted",payload:{project_id:context.projectId,restricted:true}};
  return{...event,streamId:`project:${context.projectAccessId}`,sequence:Number(row.project_sequence),actor:event.actor.startsWith("user")?`user:${String(row.actor_user_id)}`:event.actor,payload:redactProjectPayload(event.payload,contentIds,activeResources)};
}

function resourceIndex(rows:Record<string,unknown>[]){
  const activeResources=new Map<string,Set<string>>();
  for(const row of rows){const kind=String(row.resource_kind),ids=activeResources.get(kind)??new Set<string>();ids.add(String(row.resource_id));activeResources.set(kind,ids);}
  return activeResources;
}

/** Shared reads use dense project cursors and an explicit output-only private-content allowlist. */
export async function readProjectEventPage(env:WorkerEnv,context:ProjectRequestContext,after:number,limit:number,includeContent:boolean){
  await synchronizeProjectScope(env,context);
  const size=Math.max(1,Math.min(5000,Math.floor(limit)||5000));
  const statements=[
    env.DB.prepare(`SELECT event.*,secret.private_json,scope.project_sequence,scope.actor_user_id FROM project_event_scopes scope JOIN events event ON event.event_id=scope.event_id
      LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id AND secret.redacted_at IS NULL
      WHERE scope.project_access_id=? AND scope.organization_id=? AND scope.owner_user_id=? AND scope.project_sequence>? ORDER BY scope.project_sequence LIMIT ?`)
      .bind(context.projectAccessId,context.organizationId,context.ownerUserId,Math.max(0,Math.floor(after)||0),size),
    env.DB.prepare("SELECT COALESCE(MAX(project_sequence),0) AS head FROM project_event_scopes WHERE project_access_id=? AND organization_id=?").bind(context.projectAccessId,context.organizationId),
    env.DB.prepare("SELECT resource_kind,resource_id FROM project_resource_scopes WHERE project_access_id=? AND organization_id=? AND owner_user_id=?")
      .bind(context.projectAccessId,context.organizationId,context.ownerUserId),
  ];
  if(includeContent)statements.push(env.DB.prepare(`SELECT content.content_id,content.content FROM project_resource_scopes scope INDEXED BY sqlite_autoindex_project_resource_scopes_1
    CROSS JOIN private_content content ON content.content_id=scope.resource_id
    WHERE scope.project_access_id=? AND scope.organization_id=? AND scope.owner_user_id=? AND scope.resource_kind='content'
      AND ((scope.visibility='collaborative_output' AND content.owner_id=scope.owner_user_id AND content.kind='document-artifact')
        OR(scope.visibility='actor_private' AND scope.actor_user_id=? AND content.owner_id=? AND content.kind IN('chat-user','chat-assistant')))
      AND content.redacted_at IS NULL AND content.expires_at>?`)
    .bind(context.projectAccessId,context.organizationId,context.ownerUserId,context.principalUserId,context.principalUserId,new Date().toISOString()));
  const [rows,headRow,resourceRows,contentRow]=await env.DB.batch<Record<string,unknown>>(statements);
  const content=Object.fromEntries((contentRow?.results??[]).map((row)=>[String(row.content_id),String(row.content)]));
  const allowedContent=new Set(Object.keys(content));
  const activeResources=resourceIndex(resourceRows?.results??[]);
  const events=(rows?.results??[]).map((row)=>presentProjectEvent(row,context,activeResources,allowedContent));
  const head=Number(headRow?.results[0]?.head??0),nextAfter=Number(events.at(-1)?.sequence??after);
  return{events,head,nextAfter,hasMore:nextAfter<head,...(includeContent?{content}:{}),permissionSchemaVersion:1};
}

/** Internal generation receives exact project history, never an owner's account-wide stream. */
export async function readProjectSourceEvents(env:WorkerEnv,scope:{organizationId:string;projectAccessId:string;projectId:string;ownerUserId:string}){
  await synchronizeProjectScope(env,scope);
  const rows=await env.DB.prepare(`SELECT event.*,secret.private_json FROM project_event_scopes scope JOIN events event ON event.event_id=scope.event_id
    LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id AND secret.redacted_at IS NULL
    WHERE scope.project_access_id=? AND scope.organization_id=? AND scope.project_id=? AND scope.owner_user_id=?
    ORDER BY scope.project_sequence`).bind(scope.projectAccessId,scope.organizationId,scope.projectId,scope.ownerUserId).all<Record<string,unknown>>();
  return rows.results.map((row)=>serializeEvent(row));
}

type PendingProjectResources=Map<string,Set<string>>;

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
  const statements:D1PreparedStatement[]=[env.DB.prepare("SELECT resource_kind,resource_id FROM project_resource_scopes WHERE project_access_id=? AND organization_id=? AND owner_user_id=?")
    .bind(context.projectAccessId,context.organizationId,context.ownerUserId)];
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

async function ownerResourceExists(env:WorkerEnv,context:ProjectRequestContext,kind:"document"|"block"|"collection"|"relation"|"reference"|"canvas"|"canvas_item"|"canvas_arrangement"|"canvas_context",id:string){
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
  if(type==="CanvasCreated"&&(pending.get("canvas")?.has(canvas)||await ownerResourceExists(env,context,"canvas",canvas)))return"resource_identifier_already_exists";
  const itemId=String(payload.item_id??payload.reference_item_id??"");
  const createsCanvasItem=type==="CanvasItemPlaced"||type==="CanvasReferenceCreated";
  const restoredItem=type==="CanvasItemRestored"&&itemId?await historicalCanvasCreation(env,context,"canvas_item",itemId,canvas):null;
  if(canvasMutation&&itemId&&!createsCanvasItem&&!restoredItem&&!await exists("canvas_item",itemId))return"foreign_canvas_item_resource";
  if(createsCanvasItem){
    if(await exists("canvas_item",itemId)||await ownerResourceExists(env,context,"canvas_item",itemId))return"resource_identifier_already_exists";
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
  if(type==="CanvasArrangementCreated"&&(await exists("canvas_arrangement",arrangement)||await ownerResourceExists(env,context,"canvas_arrangement",arrangement)))return"resource_identifier_already_exists";
  if(restoredArrangement){
    const restoredFrames=[...(Array.isArray(restoredArrangement.frames)?restoredArrangement.frames:[]),...(Array.isArray(restoredArrangement.previous_frames)?restoredArrangement.previous_frames:[])];
    const restoredIds=[...(Array.isArray(restoredArrangement.item_ids)?restoredArrangement.item_ids:[]).map(String),...restoredFrames.map((frame)=>frame&&typeof frame==="object"?String((frame as Record<string,unknown>).item_id??""):"")];
    for(const id of restoredIds)if(!id||!await exists("canvas_item",id)||!await resourceBelongsToCanvas(env,context,"canvas_item",id,canvas,pending))return"foreign_canvas_item_resource";
  }
  const contextSet=String(payload.context_set_id??"");
  if(type==="ContextSetFormalized"&&(await exists("canvas_context",contextSet)||await ownerResourceExists(env,context,"canvas_context",contextSet)))return"resource_identifier_already_exists";
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
  if(type==="DocumentCreated"&&(pending.get("document")?.has(document)||await ownerResourceExists(env,context,"document",document)))return"resource_identifier_already_exists";
  if(type==="BlockCreated"){
    if(!block)return"block_id_required";
    if(document&&!await exists("document",document))return"foreign_document_resource";
    if(!document&&payload.scope!=="library"&&!(payload.scope==="canvas"&&canvas&&await exists("canvas",canvas)))return"document_and_block_required";
    if(pending.get("block")?.has(block)||await ownerResourceExists(env,context,"block",block))return"resource_identifier_already_exists";
  }
  if(type==="CollectionCreated"&&(pending.get("collection")?.has(collection)||await ownerResourceExists(env,context,"collection",collection)))return"resource_identifier_already_exists";
  if(type==="BlockRelationAdded"&&(pending.get("relation")?.has(relation)||await ownerResourceExists(env,context,"relation",relation)))return"resource_identifier_already_exists";
  const reference=String(payload.reference_id??"");
  if(["ReferenceIngested","RightsAsserted"].includes(type)&&!reference)return"reference_id_required";
  if(type==="ReferenceIngested"){
    if(pending.get("reference")?.has(reference)||await ownerResourceExists(env,context,"reference",reference))return"resource_identifier_already_exists";
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
  if(guardedProperties.reference_id&&!await exists("reference",String(guardedProperties.reference_id)))return"foreign_reference_resource";
  if(guardedProperties.media_url){const key=mediaKey(guardedProperties.media_url);if(!key||!await exists("media",key))return"foreign_media_resource";}
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

async function currentProjectArtifactDigest(env:WorkerEnv,context:ProjectRequestContext,contentRef:string){
  const retained=await env.DB.prepare(`SELECT content.content FROM private_content content JOIN project_resource_scopes resource
    ON resource.resource_kind='content' AND resource.resource_id=content.content_id AND resource.project_access_id=? AND resource.organization_id=?
      AND resource.project_id=? AND resource.owner_user_id=? AND resource.visibility='collaborative_output'
    WHERE content.content_id=? AND content.owner_id=? AND content.kind='document-artifact' AND content.redacted_at IS NULL AND content.expires_at>?`)
    .bind(context.projectAccessId,context.organizationId,context.projectId,context.ownerUserId,contentRef,context.ownerUserId,new Date().toISOString()).first<{content:string}>();
  return retained?Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(retained.content))),(byte)=>byte.toString(16).padStart(2,"0")).join(""):"";
}

export async function appendProjectEvents(env:WorkerEnv,context:ProjectRequestContext,principal:PilotUser,body:{action?:string;event?:{type?:string;payload?:Record<string,unknown>;compensatesEventId?:string|null};events?:Array<{type?:string;payload?:Record<string,unknown>;compensatesEventId?:string|null}>;clientId?:string;correlationId?:string;expectedSequence?:number},atomicEdit?:{artifactId:string;contentId:string;oldContent:string;newContent:string;expectedRevision:number;documentId:string;revisions:ArtifactRevisionSnapshot[];restoreSource?:{revision:number;contentSha256:string;contentJson:string}},atomicSidecars?:{statements?:D1PreparedStatement[];buildStatements?:(eventId:string)=>D1PreparedStatement[];guardSql?:string;guardBindings?:Array<string|number|null>}){
  const action=String(body.action??"append");
  if(!["append","batch","canvas_sync"].includes(action))return Response.json({error:"project_operation_unavailable"},{status:403});
  const original=Array.isArray(body.events)?body.events:body.event?[body.event]:[];
  if(!atomicSidecars&&original.some((event)=>{
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
  if(!atomicSidecars){
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
      const placeholders=[...governedBlockIds].map(()=>"?").join(",");
      const governed=await env.DB.prepare(`SELECT member.target_block_id FROM project_context_package_members member
        JOIN project_context_package_bindings binding ON binding.binding_id=member.binding_id
          AND binding.organization_id=member.organization_id AND binding.status='active'
        WHERE binding.project_access_id=? AND binding.organization_id=? AND member.target_block_id IN(${placeholders}) LIMIT 1`)
        .bind(context.projectAccessId,context.organizationId,...governedBlockIds).first();
      if(governed)return Response.json({error:"organization_context_package_decision_immutable",message:"Published organization decisions and their relationships can change only by explicitly accepting an approved package version."},{status:403});
    }
  }
  if(original.some((event)=>event.type==="DocumentArtifactEdited")&&(!atomicEdit||original.length!==1||String(original[0]?.payload?.artifact_id??"")!==atomicEdit.artifactId))return Response.json({error:"artifact_edit_endpoint_required"},{status:403});
  if(atomicEdit&&(original.length!==1||original[0]?.type!=="DocumentArtifactEdited"))return Response.json({error:"invalid_atomic_artifact_edit"},{status:403});
  if(original.some((event)=>ARTIFACT_REVIEW_EVENT_TYPES.has(String(event.type??"")))&&original.some((event)=>!ARTIFACT_REVIEW_EVENT_TYPES.has(String(event.type??""))))return Response.json({error:"review_context_changed",message:"Approve the output separately after its latest context changes have been reviewed."},{status:409});
  const exportOnly=original.length>0&&action!=="canvas_sync"&&original.every((event)=>["ObjectExported","DocumentArtifactExported"].includes(String(event.type??"")));
  if(original.some((event)=>["ObjectExported","DocumentArtifactExported"].includes(String(event.type??"")))&&!exportOnly)return Response.json({error:"mixed_export_batch_forbidden",message:"Export approval must be verified separately from any project changes."},{status:400});
  const ownerStream=`creative:${context.ownerUserId}`;
  let releaseValidationHead:number|null=null;
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
      const relevant=target?[target]:all.documents.some((document)=>document.id===identifier)?all.libraryArtifacts.filter((artifact)=>artifact.documentId===identifier):[];
      for(const artifact of relevant){
        if(!artifactSourceVersions(artifact.id,source)){
          if(managedPilot)return Response.json({error:"artifact_source_revision_unavailable",message:"Controlled-pilot outputs require verified source revisions and independent approval before release."},{status:409});
          continue; // Unmanaged legacy organizations retain their existing compatibility contract.
        }
        const document=foldEvents(source,Number.POSITIVE_INFINITY,artifact.documentId,context.projectId);
        if(artifactReviewState(artifact,document.blocks,source).status!=="approved")return Response.json({error:"artifact_approval_required",message:"This output cannot leave its shared project until a separate reviewer approves its current source and output revision."},{status:409});
        const exactArtifactExport=request.type==="DocumentArtifactExported";
        if(exactArtifactExport||request.payload?.artifact_revision!==undefined){
          const currentRevision=source.filter((event)=>event.type==="DocumentArtifactEdited"&&String(event.payload.artifact_id??"")===artifact.id).length;
          if(!Number.isSafeInteger(request.payload?.artifact_revision)||Number(request.payload?.artifact_revision)!==currentRevision)return Response.json({error:"stale_release_context",message:"The finished output changed before it could be released. Reopen its latest approved revision."},{status:409});
        }
        if(exactArtifactExport||request.payload?.content_sha256!==undefined){
          const expected=String(request.payload?.content_sha256??"");
          const actual=await currentProjectArtifactDigest(env,context,artifact.contentRef??"");
          if(!expected||expected!==actual)return Response.json({error:"stale_release_context",message:"The approved output no longer matches the exact document prepared for download."},{status:409});
        }
      }
    }
  }
  const canvasAction=action==="canvas_sync"||original.some((event)=>PROJECT_CANVAS_MUTATION_TYPES.has(String(event.type??""))||Boolean(event.payload?.canvas_id));
  if(canvasAction&&!hasCapability(principal,"project.canvas.use",{organizationId:context.organizationId,projectAccessId:context.projectAccessId}))return Response.json({error:"project_canvas_access_required"},{status:403});
  if(!original.length||original.length>(action==="canvas_sync"?120:50))return Response.json({error:"invalid_project_event_batch"},{status:400});
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
  const incoming=original.filter((_,index)=>!existing.has(receiptKeys[index]??""));
  if(!incoming.length&&existing.size){
    const current=await env.DB.prepare("SELECT COALESCE(MAX(project_sequence),0) AS head FROM project_event_scopes WHERE project_access_id=? AND organization_id=? AND owner_user_id=?")
      .bind(context.projectAccessId,context.organizationId,context.ownerUserId).first<{head:number}>();
    return Response.json({appended:original.map((_,index)=>existingEvents.get(existing.get(receiptKeys[index])!.eventId)!),rejected:[],head:Number(current?.head??0),idempotent:true});
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
  const needsReviewValidation=incoming.some((event)=>ARTIFACT_REVIEW_EVENT_TYPES.has(String(event.type??"")));
  const validatedOwnerHead=needsReviewValidation?await streamHead(env,ownerStream):null;
  const reviewEvents=needsReviewValidation?await readProjectSourceEvents(env,context):null;
  if(incoming.some((event)=>event.type==="BlockRelationRemoved"||event.type==="BlockRelationAdded"&&isContextCompositionRelation(event.payload?.kind))){
    const graphEvents=reviewEvents??await readProjectSourceEvents(env,context);
    const graph=foldEvents(graphEvents,Number.POSITIVE_INFINITY,"",context.projectId);
    const issue=validateContextCompositionGraph({blocks:graph.libraryBlocks,relations:graph.libraryBlockRelations,events:incoming,ignoreLocks:Boolean(atomicSidecars)});
    if(issue)return Response.json({error:issue.code,message:issue.message,index:issue.index},{status:409});
  }
  if(incoming.some((event)=>event.type==="ArtifactApproved")&&incoming.some((event)=>/^(?:Block|Chip|DocumentArtifactEdited)/.test(String(event.type??"")))){
    return Response.json({error:"review_context_changed",message:"Approve the output separately after its latest context changes have been reviewed."},{status:409});
  }
  for(const event of incoming){
    const reason=await validateProjectMutation(env,context,event,pending,principal,canvasAction);if(reason)return Response.json({error:reason},{status:403});
    if(reviewEvents&&ARTIFACT_REVIEW_EVENT_TYPES.has(String(event.type??""))){
      const type=String(event.type),artifactId=String(event.payload?.artifact_id??"");
      const completed=[...reviewEvents].reverse().find((candidate)=>candidate.type==="DocumentRenderCompleted"&&String(candidate.payload.artifact_id??"")===artifactId);
      const exactReview=["ArtifactReviewRequested","ArtifactApproved","ArtifactChangesRequested"].includes(type);
      const expectedArtifactRevision=exactReview?reviewEvents.filter((candidate)=>candidate.type==="DocumentArtifactEdited"&&String(candidate.payload.artifact_id??"")===artifactId).length:undefined;
      const expectedContentSha256=exactReview?await currentProjectArtifactDigest(env,context,String(completed?.payload.content_ref??"")):undefined;
      const validation=validateArtifactReview({type,payload:event.payload??{},events:reviewEvents,actorUserId:principal.userId,projectId:context.projectId,canApprove:hasCapability(principal,"project.review.approve",{organizationId:context.organizationId,projectAccessId:context.projectAccessId}),independentReviewer:true,...(exactReview?{expectedArtifactRevision,expectedContentSha256}:{})});
      if(!validation.ok)return Response.json({error:validation.code,message:validation.message},{status:validation.status});
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
  if(validatedOwnerHead!==null&&ownerHead!==validatedOwnerHead)return Response.json({error:"stale_review_context",message:"The project changed while this review was being checked. Refresh and review the latest version."},{status:409});
  if(releaseValidationHead!==null&&ownerHead!==releaseValidationHead)return Response.json({error:"stale_release_context",message:"The project changed while export approval was being checked. Refresh the approved output before releasing it."},{status:409});
  const current=await env.DB.prepare("SELECT COALESCE(MAX(project_sequence),0) AS head FROM project_event_scopes WHERE project_access_id=?").bind(context.projectAccessId).first<{head:number}>();
  let projectHead=Number(current?.head??0);
  if(action!=="canvas_sync"&&Number.isSafeInteger(body.expectedSequence)&&Number(body.expectedSequence)!==projectHead)return Response.json({error:"stale_sequence",expected:body.expectedSequence,head:projectHead},{status:409});
  const now=new Date().toISOString(),appended:EventRow[]=[],statements:D1PreparedStatement[]=[];
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
          AND selected.project_access_id=project.project_access_id AND selected.organization_id=project.organization_id AND selected.revoked_at IS NULL AND selected.expires_at>?))
        AND (?=0 OR project.owner_user_id=? OR EXISTS(SELECT 1 FROM capability_grants canvas_grant WHERE canvas_grant.user_id=?
          AND canvas_grant.capability='project.canvas.use' AND canvas_grant.scope_type='project' AND canvas_grant.organization_id=project.organization_id
          AND canvas_grant.project_access_id=project.project_access_id AND canvas_grant.status='active' AND canvas_grant.revoked_at IS NULL
          AND (canvas_grant.expires_at IS NULL OR canvas_grant.expires_at>?)))
        AND (?=0 OR project.owner_user_id=? OR EXISTS(SELECT 1 FROM capability_grants review_grant WHERE review_grant.user_id=?
          AND review_grant.capability='project.review.approve' AND review_grant.scope_type='project' AND review_grant.organization_id=project.organization_id
          AND review_grant.project_access_id=project.project_access_id AND review_grant.status='active' AND review_grant.revoked_at IS NULL
          AND (review_grant.expires_at IS NULL OR review_grant.expires_at>?))))`;
    const contentGuard=atomicEdit?` AND EXISTS(SELECT 1 FROM private_content content
      JOIN project_resource_scopes artifact ON artifact.project_access_id=? AND artifact.organization_id=? AND artifact.project_id=? AND artifact.owner_user_id=? AND artifact.resource_kind='artifact' AND artifact.resource_id=?
      JOIN project_resource_scopes retained ON retained.project_access_id=artifact.project_access_id AND retained.organization_id=artifact.organization_id AND retained.project_id=artifact.project_id AND retained.owner_user_id=artifact.owner_user_id AND retained.resource_kind='content' AND retained.resource_id=content.content_id AND retained.visibility='collaborative_output'
      WHERE content.content_id=? AND content.owner_id=? AND content.kind='document-artifact' AND content.redacted_at IS NULL
        AND(content.expires_at>? OR ${artifactContentHoldSql("content","artifact")}) AND content.content=?)
      AND (SELECT COUNT(*) FROM events revision WHERE revision.stream_id=? AND revision.type='DocumentArtifactEdited' AND json_extract(revision.payload,'$.artifact_id')=?)=?`:"";
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
            AND assigned_grant.revoked_at IS NULL AND (assigned_grant.expires_at IS NULL OR assigned_grant.expires_at>?)))
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
    statements.push(env.DB.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS})
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=? AND ${guard}${contentGuard}${restoreGuard}${assignmentGuard}${decisionGuard}${sidecarGuard}`)
      .bind(...eventWriteBindings(event),ownerStream,event.sequence-1,
        principal.userId,POLICY_VERSION,principal.userId,principal.userId,context.projectAccessId,context.organizationId,principal.userId,Number(exportOnly||reviewOnly),
        context.contextId,context.contextId,principal.userId,now,canvasAction?1:0,principal.userId,principal.userId,now,reviewOnly||event.type==="ArtifactApproved"?1:0,principal.userId,principal.userId,now,
        ...(atomicEdit?[context.projectAccessId,context.organizationId,context.projectId,context.ownerUserId,atomicEdit.artifactId,atomicEdit.contentId,context.ownerUserId,now,atomicEdit.oldContent,ownerStream,atomicEdit.artifactId,atomicEdit.expectedRevision]:[]),
        ...(atomicEdit?.restoreSource?[context.ownerUserId,context.organizationId,context.projectAccessId,context.projectId,atomicEdit.artifactId,atomicEdit.restoreSource.revision,now,atomicEdit.restoreSource.contentSha256,atomicEdit.restoreSource.contentJson]:[]),
        ...(assigned?[assigned,context.projectAccessId,context.organizationId,principal.userId,now]:[]),
        ...(decision?[context.projectAccessId,context.organizationId,String(payload.artifact_id??""),principal.userId,Number(payload.artifact_revision??-1),String(payload.content_sha256??""),context.projectAccessId,context.organizationId,String(payload.artifact_id??"")]:[]),
        ...(atomicSidecars?.guardBindings??[])));
    projectHead+=1;
    statements.push(env.DB.prepare("INSERT INTO project_event_scopes(event_id,project_access_id,organization_id,project_id,owner_user_id,source_stream_id,source_sequence,project_sequence,actor_user_id,created_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM events WHERE event_id=?)")
      .bind(event.eventId,context.projectAccessId,context.organizationId,context.projectId,context.ownerUserId,ownerStream,event.sequence,projectHead,principal.userId,now,event.eventId));
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
    if(resourceKind&&resourceId)statements.push(env.DB.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at) SELECT ?,?,?,?,?,?,'collaborative_output',?,?,? WHERE EXISTS(SELECT 1 FROM events WHERE event_id=?)")
      .bind(context.projectAccessId,resourceKind,resourceId,context.organizationId,context.projectId,context.ownerUserId,event.eventId,principal.userId,now,event.eventId));
    if(event.type==="BlockCreated"){
      const properties=payload.properties&&typeof payload.properties==="object"?payload.properties as Record<string,unknown>:{};
      const key=mediaKey(properties.media_url);
      if(key)statements.push(env.DB.prepare("UPDATE project_resource_scopes SET source_event_id=? WHERE project_access_id=? AND organization_id=? AND resource_kind='media' AND resource_id=? AND EXISTS(SELECT 1 FROM events WHERE event_id=?)")
        .bind(event.eventId,context.projectAccessId,context.organizationId,key,event.eventId));
    }
    if(action==="canvas_sync"){
      const originalIndex=original.indexOf(input);
      statements.push(env.DB.prepare("INSERT INTO event_client_receipts(stream_id,client_event_id,event_id,sequence,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM project_event_scopes WHERE event_id=? AND project_access_id=? AND organization_id=? AND actor_user_id=?)")
        .bind(ownerStream,receiptKeys[originalIndex],event.eventId,event.sequence,now,event.eventId,context.projectAccessId,context.organizationId,principal.userId));
    }
    appended.push(event);
  }
  const invalidatesResources=incoming.some(({type,payload})=>/Removed$|Restored$|Discarded$|Rehomed$/.test(String(type??""))
    ||(type==="BlockPropertyEdited"||type==="ChipEdited")&&["media_url","reference_id","source_document_id","source_block_id","source_output_id"].includes(String(type==="BlockPropertyEdited"?payload?.property_path:payload?.property)));
  if(atomicSidecars?.statements?.length)statements.push(...atomicSidecars.statements);
  if(atomicSidecars?.buildStatements&&appended.length)statements.push(...atomicSidecars.buildStatements(appended.at(-1)!.eventId));
  statements.push(env.DB.prepare("UPDATE project_migration_states SET last_owner_sequence=?,updated_at=? WHERE project_access_id=? AND organization_id=? AND owner_user_id=? AND status='active' AND (?='' OR EXISTS(SELECT 1 FROM events WHERE event_id=?))")
    .bind(invalidatesResources?ownerHead:ownerHead+incoming.length,now,context.projectAccessId,context.organizationId,context.ownerUserId,atomicEdit||atomicSidecars?appended.at(-1)?.eventId??"":"",atomicEdit||atomicSidecars?appended.at(-1)?.eventId??"":""));
  try{
    const results=await env.DB.batch(statements);
    if(results.some((result)=>Number(result.meta.changes??0)!==1))return Response.json({error:"project_access_revoked"},{status:403});
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

import { handleEvents } from "./events-api";
import { POLICY_VERSION, adoptLegacyCostReservation, costBudgetReservation, hasCapability, loadPrivateContent, pilotExecutionAllowance, readAccountBudgets, readCostBudgets, reconcileFailedBudgetReservations, releaseBudgetReservationsForCorrelation, releaseCostReservationsForCorrelation, requireConsent, requireUser, settleInterruptedDocumentJobReservations, storePrivateContent, type PilotUser, type ProjectExecutionScope } from "./pilot-policy";
import { ownerDocumentBudgetScopes, readProjectRequestContext, readProjectSourceEvents, synchronizeProjectScope } from "./project-access";
import { appendAuditEvent, ensureSchema, readCorrelatedEvents, readWorkspaceEvents, streamHead, uuidV7, type WorkerEnv, type WorkerExecutionContext } from "./runtime";
import { foldEvents } from "../src/model/events";
import {
  DOCUMENT_JOB_HEARTBEAT_MS,
  DOCUMENT_JOB_LEASE_MS,
  DOCUMENT_JOB_STALE_AFTER_MS,
  documentGenerationRequestKey,
  documentGenerationRevision,
  documentJobIsStale,
  documentJobCanRecoverProviderRender,
  documentJobTerminal,
  documentJobMaxAttempts,
  type DocumentJobError,
  type DocumentJobKind,
  type DocumentJobStatus,
} from "../src/model/document-jobs";
import { normalizePromptTechnique, PROMPT_TECHNIQUES, type PromptTechnique } from "../src/model/prompt-structures";
import { applicationFailureDetail, classifyProviderFailure, publicFailureDetail, type ProviderFailureDetail } from "./provider-errors";
import { documentJobCompletionBindings } from "./document-job-sql";
import { preflightGeneration } from "./generation-readiness";
import { DEFAULT_REFERENCE_VIDEO_MODEL, normalizeVideoDurationSeconds, VIDEO_ADAPTER_CONTRACT } from "../src/model/video-adapter";
import { clearPresentationServerOwnedCheckpointFields, estimatePlannerOperationMicrousd, generationBudgetGate, presentationServerOwnedCheckpointField, presentationTokenReservation } from "../src/model/generation-budget";
import { buildManagedProductionPlan, MAX_MANAGED_PRESENTATION_SLIDES, type ManagedProductionPlan } from "../src/model/managed-production";
import { buildPresentationSourceContract, inferPresentationSourceOutline } from "../src/model/presentation-source";
import { interruptedDocumentJobUsage, recordedDocumentPlannerUsage } from "./document-job-reservations";
import { PRINCIPAL_WITH_ACCESS_SQL, principalAccessFromRow } from "./access-policy";
import { authoritativeCreativeContext, ContextIntegrityError } from "./context-authority";
import { managedPilotSourceClassificationValid } from "./media-api";

type DocumentJobRow = {
  job_id: string; owner_id: string; stream_id: string; document_id: string; kind: DocumentJobKind; status: DocumentJobStatus;
  source_surface: string; correlation_id: string; requested_sequence: number; request_json: string; result_json: string | null;
  error_message: string | null; attempt_count: number; requested_at: string; started_at: string | null; completed_at: string | null;
  lease_expires_at: string | null; notified_at: string | null; expires_at: string; updated_at: string;
};

const KINDS = new Set<DocumentJobKind>(["preview", "generate", "prompt_fan", "chat", "structure_adaptive", "extract_reference", "render_document"]);
const MAX_PAYLOAD_BYTES = 750_000;
const TOKEN_RESERVATION_HANDOFF_SQL = "UPDATE budget_reservations SET correlation_id=?,updated_at=? WHERE reservation_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND operation=? AND status='active' AND EXISTS (SELECT 1 FROM cost_budget_reservations paired WHERE paired.reservation_id=? AND paired.owner_id=budget_reservations.owner_id AND paired.stream_id=budget_reservations.stream_id AND paired.correlation_id=budget_reservations.correlation_id AND paired.operation=budget_reservations.operation AND paired.period=budget_reservations.period AND paired.status IN ('active','executing')) AND EXISTS (SELECT 1 FROM document_jobs job WHERE job.job_id=? AND job.owner_id=? AND job.stream_id=budget_reservations.stream_id AND job.correlation_id=? AND job.attempt_count=? AND job.status='running')";
const COST_RESERVATION_HANDOFF_SQL = "UPDATE cost_budget_reservations SET correlation_id=?,status='active',updated_at=? WHERE reservation_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND operation=? AND status IN ('active','executing') AND EXISTS (SELECT 1 FROM budget_reservations paired WHERE paired.reservation_id=? AND paired.owner_id=cost_budget_reservations.owner_id AND paired.stream_id=cost_budget_reservations.stream_id AND paired.correlation_id=? AND paired.operation=cost_budget_reservations.operation AND paired.period=cost_budget_reservations.period AND paired.status='active') AND EXISTS (SELECT 1 FROM document_jobs job WHERE job.job_id=? AND job.owner_id=? AND job.stream_id=cost_budget_reservations.stream_id AND job.correlation_id=? AND job.attempt_count=? AND job.status='running')";

const activeProjectExecutionSql=`EXISTS(SELECT 1 FROM organization_projects project
  JOIN organizations organization ON organization.organization_id=project.organization_id AND organization.status='active'
  JOIN project_migration_states migration ON migration.project_access_id=project.project_access_id AND migration.organization_id=project.organization_id AND migration.status='active'
  JOIN users actor ON actor.user_id=? AND actor.consent_version=?
  JOIN organization_memberships member ON member.organization_id=project.organization_id AND member.user_id=actor.user_id
    AND member.status='active' AND member.accepted_at IS NOT NULL AND member.revoked_at IS NULL
  JOIN organization_memberships owner_member ON owner_member.organization_id=project.organization_id AND owner_member.user_id=project.owner_user_id
    AND owner_member.status='active' AND owner_member.accepted_at IS NOT NULL AND owner_member.revoked_at IS NULL
  LEFT JOIN project_memberships project_member ON project_member.project_access_id=project.project_access_id AND project_member.organization_id=project.organization_id
    AND project_member.project_id=project.project_id AND project_member.user_id=actor.user_id AND project_member.status='active' AND project_member.revoked_at IS NULL
  JOIN project_resource_scopes document ON document.project_access_id=project.project_access_id AND document.organization_id=project.organization_id
    AND document.project_id=project.project_id AND document.owner_user_id=project.owner_user_id AND document.resource_kind='document' AND document.resource_id=?
  WHERE project.project_access_id=? AND project.organization_id=? AND project.project_id=? AND project.owner_user_id=? AND project.status='active'
    AND(project.owner_user_id=actor.user_id OR project_member.role IN('owner','editor')))`;

function projectExecutionBindings(scope:ProjectExecutionScope,documentId:string){
  return[scope.actorUserId,POLICY_VERSION,documentId,scope.projectAccessId,scope.organizationId,scope.projectId,scope.ownerUserId] as const;
}

const DOCUMENT_JOB_COLUMNS="job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,error_message,attempt_count,requested_at,started_at,completed_at,lease_expires_at,notified_at,expires_at,updated_at";
function documentJobInsert(env:WorkerEnv,user:PilotUser,documentId:string,values:string,bindings:Array<string|number|null>,idempotency?:{kind:DocumentJobKind;key:string}){
  const scope=user.projectExecution;
  const conditions=[...(scope?[activeProjectExecutionSql]:[]),...(idempotency?[`NOT EXISTS(SELECT 1 FROM document_jobs existing WHERE existing.owner_id=? AND existing.stream_id=? AND existing.document_id=? AND existing.kind=? AND existing.status IN('queued','running','committing') AND COALESCE(json_extract(existing.request_json,'$.idempotencyKey'),'')=?)`]:[])];
  return env.DB.prepare(`INSERT INTO document_jobs (${DOCUMENT_JOB_COLUMNS}) ${conditions.length?`SELECT ${values} WHERE ${conditions.join(" AND ")}`:`VALUES (${values})`}`)
    .bind(...bindings,...(scope?projectExecutionBindings(scope,documentId):[]),...(idempotency?[user.userId,user.streamId,documentId,idempotency.kind,idempotency.key]:[]));
}

async function activeProjectExecution(env:WorkerEnv,user:PilotUser,documentId:string,jobId="",requireAnchor=true){
  const scope=user.projectExecution;if(!scope)return true;
  if(scope.actorUserId!==user.userId||user.streamId!==`creative:${scope.ownerUserId}`)return false;
  const jobSql=jobId?` AND EXISTS(SELECT 1 FROM project_resource_scopes resource JOIN document_jobs job ON job.job_id=resource.resource_id
    WHERE resource.project_access_id=? AND resource.organization_id=? AND resource.project_id=? AND resource.owner_user_id=?
      AND resource.resource_kind='job' AND resource.resource_id=? AND resource.actor_user_id=?
      AND job.owner_id=? AND job.stream_id=? AND job.document_id=?${requireAnchor?` AND EXISTS(SELECT 1 FROM events anchor WHERE anchor.event_id=resource.source_event_id AND anchor.stream_id=job.stream_id AND anchor.actor='user:'||resource.actor_user_id AND anchor.type='ProjectDocumentJobQueued' AND json_extract(anchor.payload,'$.job_id')=job.job_id AND json_extract(anchor.payload,'$.organization_id')=resource.organization_id AND json_extract(anchor.payload,'$.project_access_id')=resource.project_access_id AND json_extract(anchor.payload,'$.actor_user_id')=resource.actor_user_id)`:""})`:"";
  const bindings=jobId?[...projectExecutionBindings(scope,documentId),scope.projectAccessId,scope.organizationId,scope.projectId,scope.ownerUserId,jobId,scope.actorUserId,user.userId,user.streamId,documentId]:[...projectExecutionBindings(scope,documentId)];
  return Boolean(await env.DB.prepare(`SELECT 1 AS present WHERE ${activeProjectExecutionSql}${jobSql}`).bind(...bindings).first());
}

function projectJobResource(env:WorkerEnv,user:PilotUser,jobId:string,documentId:string,createdAt:string){
  const scope=user.projectExecution;if(!scope)return null;
  return env.DB.prepare(`INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at)
    SELECT ?,'job',?,?,?,?,'actor_private',NULL,?,? WHERE EXISTS(SELECT 1 FROM document_jobs job
      WHERE job.job_id=? AND job.owner_id=? AND job.stream_id=? AND job.document_id=?) AND ${activeProjectExecutionSql}`)
    .bind(scope.projectAccessId,jobId,scope.organizationId,scope.projectId,scope.ownerUserId,scope.actorUserId,createdAt,jobId,user.userId,user.streamId,documentId,...projectExecutionBindings(scope,documentId));
}

async function anchorProjectJobs(env:WorkerEnv,user:PilotUser,jobs:Array<{jobId:string;kind:DocumentJobKind;documentId:string}>){
  const scope=user.projectExecution;if(!scope)return;
  try{
    for(const job of jobs){
      if(!await activeProjectExecution(env,user,job.documentId,job.jobId,false))throw new Error("project_access_revoked");
      const event=await appendAuditEvent(env,user.streamId,`user:${user.userId}`,"ProjectDocumentJobQueued",{job_id:job.jobId,document_id:job.documentId,kind:job.kind,organization_id:scope.organizationId,project_access_id:scope.projectAccessId,project_id:scope.projectId,history_owner_user_id:scope.ownerUserId,actor_user_id:scope.actorUserId},job.jobId);
      const anchored=await env.DB.prepare(`UPDATE project_resource_scopes SET source_event_id=? WHERE resource_kind='job' AND resource_id=? AND project_access_id=? AND organization_id=? AND project_id=? AND owner_user_id=? AND actor_user_id=? AND source_event_id IS NULL AND ${activeProjectExecutionSql}`)
        .bind(event.eventId,job.jobId,scope.projectAccessId,scope.organizationId,scope.projectId,scope.ownerUserId,scope.actorUserId,...projectExecutionBindings(scope,job.documentId)).run();
      if(Number(anchored.meta.changes??0)!==1)throw new Error("project_access_revoked");
    }
  }catch(error){
    for(const job of jobs){
      const row=await readJob(env,user.userId,job.jobId);if(!row||row.status!=="queued"&&row.status!=="running")continue;
      const now=new Date().toISOString();
      const changed=await env.DB.prepare("UPDATE document_jobs SET status='canceled',error_message='project_job_authorization_failed',completed_at=?,lease_expires_at=NULL,notified_at=?,updated_at=? WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND status IN('queued','running')")
        .bind(now,now,now,row.job_id,row.owner_id,row.stream_id,row.correlation_id).run();
      if(Number(changed.meta.changes??0)===1)await releaseInterruptedAttempt(env,user,row,"project_job_authorization_failed");
    }
    throw error;
  }
}

function safeScopedJob(row:DocumentJobRow,recoveryBlocker:DocumentJobRow|null=null){
  const job=serializeJob(row,recoveryBlocker,false);
  const sensitive=new Set(["plannerInput","providerInput","provider_input","videoInputReceipt","artifactPlan","productionPlan","productionSceneReceipts","productionFrameReceipts","productionAnchor","providerStatusUrl","providerResponseUrl","providerCancelUrl","moderationPromptRef","intentRef","providerJobId","generationReceipt","generation_receipt","input_ref","inputRef","input_expires_at","source_snapshot_sha256","snapshot","document_snapshot","sourceAliasMap","sourceAliases","source_alias_map","source_aliases","settings","audience","tone"]);
  const redact=(value:unknown):unknown=>Array.isArray(value)?value.map(redact):value&&typeof value==="object"?Object.fromEntries(Object.entries(value).filter(([key])=>!sensitive.has(key)).map(([key,item])=>[key,redact(item)])):value;
  return{...job,result:job.result?redact(job.result):null,members:job.members.map((member)=>redact(member)),moderationPromptRef:null};
}

function parseResult(row: Pick<DocumentJobRow, "result_json">) {
  try { return row.result_json ? JSON.parse(row.result_json) as Record<string, unknown> : {}; } catch { return {}; }
}

function parseRequest(row: Pick<DocumentJobRow, "request_json">) {
  try { return row.request_json ? JSON.parse(row.request_json) as Record<string, unknown> : {}; } catch { return {}; }
}

function generationRevisionFromRequest(request: Record<string, unknown>, documentId: string) {
  return String(request.documentRevision || documentGenerationRevision({ snapshot: request.snapshot ?? {}, sourceBlockVersions: request.sourceBlockVersions ?? [], documentId }));
}

function generationRequestIdentity(kind: DocumentJobKind, request: Record<string, unknown>, documentId: string) {
  const documentRevision = generationRevisionFromRequest(request, documentId);
  const sourcePreviewId = typeof request.sourcePreviewId === "string" && request.sourcePreviewId ? request.sourcePreviewId : null;
  const promptTechnique = normalizePromptTechnique(request.promptTechnique); const promptFanId = typeof request.promptFanId === "string" && request.promptFanId ? request.promptFanId : null;
  const requestKey = kind === "preview" || kind === "generate" ? String(request.requestKey || documentGenerationRequestKey(kind, documentRevision, sourcePreviewId, promptTechnique, promptFanId)) : kind === "prompt_fan" || kind === "render_document" ? String(request.requestKey ?? "") : "";
  return { documentRevision, requestKey, sourcePreviewId, promptTechnique, promptFanId };
}

const LOCAL_PERSISTENCE_FAILURE=/\b(?:D1_ERROR|SQLITE_(?:CONSTRAINT|ERROR|BUSY|LOCKED|IOERR|CORRUPT|FULL)|SQLITE_CONSTRAINT_[A-Z_]+|UNIQUE constraint failed|FOREIGN KEY constraint failed|NOT NULL constraint failed|CHECK constraint failed|database is locked|Wrong number of parameter bindings|events\.event_id|event[_ -]store(?:\s+|[_ -])(?:write|persistence|collision|failure))/i;
const SOURCE_FIDELITY_FAILURE=/\b(?:SOURCE_FIDELITY_VALIDATION_FAILED|source[_ -]fidelity[_ -]validation[_ -]failed|protected[_ -](?:quote|fact|claim|source)|(?:required|protected).{0,40}(?:quote|quotation|numerical fact|source attribution).{0,40}(?:missing|truncated|invalid|unresolved))/i;

function classifyDocumentJobFailure(input:unknown,existing:ProviderFailureDetail|null=null,status:number|null=null):ProviderFailureDetail{
  const raw=input instanceof Error?input.message:typeof input==="string"?input:"";
  const evidence=[raw,existing?.code??"",existing?.message??""].filter(Boolean).join(" ");
  if(LOCAL_PERSISTENCE_FAILURE.test(evidence))return{
    code:"local_persistence_failed",category:"server",scope:"unknown",action:"contact_support",
    message:`Forma could not save this generation because a local event or database write failed. No provider outage was reported.${raw?` Technical detail: ${raw}`:""}`,
    retryable:false,retryAfterMs:null,requestId:null,httpStatus:null,
  };
  if(SOURCE_FIDELITY_FAILURE.test(evidence))return{
    code:"source_fidelity_validation_failed",category:"provider",scope:"request",action:"edit_request",
    message:`The generated presentation failed source-fidelity validation. Protected facts, quotations, slide coverage, or authorized source attribution must be corrected before another paid generation.${raw?` Technical detail: ${raw}`:""}`,
    retryable:false,retryAfterMs:null,requestId:existing?.requestId??null,httpStatus:null,
  };
  return existing??classifyProviderFailure(input,status!==null?new Response(null,{status}):undefined);
}

function renderRequestIdempotencyKey(request:Record<string,unknown>,documentId:string){
  const settings={
    documentId,documentRevision:generationRevisionFromRequest(request,documentId),artifactKind:String(request.artifactKind??""),
    productionMode:request.productionMode==="managed"?"managed":"manual",itemCount:request.itemCount??null,
    requestedSlideCount:request.requestedSlideCount??null,audience:String(request.audience??"").trim(),tone:String(request.tone??"").trim(),locale:String(request.locale??"en"),
    presentationStyle:request.presentationStyle??null,presentationFidelity:request.presentationFidelity??null,
    videoSeconds:request.videoSeconds??null,videoSize:request.videoSize??null,videoAudioMode:request.videoAudioMode??null,
  };
  return `${String(request.requestKey??"").trim()||`render:${settings.artifactKind}:${settings.documentRevision}`}:${documentGenerationRevision(settings)}`;
}

async function sourceSnapshotSha256(snapshot:Record<string,unknown>){
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(snapshot)));
  return Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,"0")).join("");
}

type GenerationReceipt=Record<string,unknown>&{
  provider:string;model:string;reservation_microusd:number;settled_cost_microusd:number;
  reservation_status:string;source_transmission_status:string;provider_request_status:string;
};

async function acceptedGenerationReceipt(env:WorkerEnv,user:PilotUser,payload:Record<string,unknown>,documentId:string,jobId:string,estimatedCostMicrousd:number,production:ManagedProductionPlan|null,contentScope:ProjectExecutionScope|undefined):Promise<GenerationReceipt>{
  const snapshot=payload.snapshot&&typeof payload.snapshot==="object"&&!Array.isArray(payload.snapshot)?payload.snapshot as Record<string,unknown>:{};
  const artifactKind=String(payload.artifactKind??"");
  const isSlides=artifactKind==="slides";
  const sourceOutline=isSlides?inferPresentationSourceOutline(snapshot):null;
  const rawRequestedCount=payload.requestedSlideCount??payload.itemCount;
  const requestedSlideCount=isSlides&&Number.isSafeInteger(Number(rawRequestedCount))&&Number(rawRequestedCount)>0?Number(rawRequestedCount):null;
  const authoredSlideCount=isSlides?production?.authoredSlideCount??sourceOutline?.authoredSlideCount??null:null;
  const predictedSlideCount=isSlides?production?.predictedSlideCount??requestedSlideCount??7:null;
  const batchCount=production?.providerBatchCount??1;
  const plannedProviderCallCount=production?.providerCallCount??1;
  const maxRepairCallCount=production?.maxRepairCallCount??1;
  const maximumProviderCallCount=production?.maximumProviderCallCount??2;
  const capturedAt=new Date().toISOString();
  const provider="openai";
  const model=String(env.OPENAI_MODEL??"gpt-5.6-terra");
  const sourceHash=await sourceSnapshotSha256(snapshot);
  const requestSettings={
    item_count:predictedSlideCount??(payload.itemCount===undefined?null:Number(payload.itemCount)),
    requested_slide_count:requestedSlideCount,authored_slide_count:authoredSlideCount,predicted_slide_count:predictedSlideCount,
    audience:String(payload.audience??"").trim()||"general",tone:String(payload.tone??"").trim()||"document-derived",
    production_mode:payload.productionMode==="managed"?"managed":"manual",
    presentation_style:typeof payload.presentationStyle==="string"?payload.presentationStyle:null,
    presentation_fidelity:typeof payload.presentationFidelity==="string"?payload.presentationFidelity:null,
    batch_count:batchCount,planned_provider_call_count:plannedProviderCallCount,max_repair_call_count:maxRepairCallCount,maximum_provider_call_count:maximumProviderCallCount,
    reservation_microusd:estimatedCostMicrousd,
  };
  const privateReceipt={
    schema_version:1,job_id:jobId,artifact_kind:artifactKind,document_id:documentId,captured_at:capturedAt,
    request:requestSettings,document_snapshot:snapshot,
    source_block_versions:Array.isArray(payload.sourceBlockVersions)?payload.sourceBlockVersions:[],
    planner:{provider,model,request_status:"not_submitted"},
    source:{scope:"authorized_document_context",status:"not_transmitted",snapshot_sha256:sourceHash},
    accounting:{reservation_microusd:estimatedCostMicrousd,settled_cost_microusd:0,reservation_is_provider_hard_cap:false,reservation_is_application_hard_cap:isSlides,...(isSlides?{maximum_authorized_cost_microusd:estimatedCostMicrousd}:{})},
  };
  const stored=await storePrivateContent(env,user.userId,"document-artifact-input",JSON.stringify(privateReceipt),contentScope);
  return{
    schema_version:1,captured_at:capturedAt,artifact_kind:artifactKind,production_mode:requestSettings.production_mode,
    provider,model,requested_slide_count:requestedSlideCount,authored_slide_count:authoredSlideCount,predicted_slide_count:predictedSlideCount,
    slide_count_mismatch:isSlides&&authoredSlideCount!==null&&requestedSlideCount!==null&&authoredSlideCount!==requestedSlideCount,
    batch_count:batchCount,minimum_provider_call_count:plannedProviderCallCount,planned_provider_call_count:plannedProviderCallCount,actual_provider_call_count:null,max_repair_call_count:maxRepairCallCount,maximum_provider_call_count:maximumProviderCallCount,
    reservation_microusd:estimatedCostMicrousd,settled_cost_microusd:0,reservation_status:"estimated",
    reservation_is_provider_hard_cap:false,reservation_is_application_hard_cap:isSlides,...(isSlides?{maximum_authorized_cost_microusd:estimatedCostMicrousd}:{}),repair_calls_may_incur_additional_usage:maxRepairCallCount>0,
    source_transmission_scope:"authorized_document_context",source_transmission_status:"not_transmitted",provider_request_status:"not_submitted",
    source_fact_count:Array.isArray(snapshot.facts)?snapshot.facts.length:0,source_snapshot_sha256:sourceHash,
    input_ref:stored.contentId,input_expires_at:stored.expiresAt,settings:requestSettings,
  };
}

function parentJobIdFromRequest(request: Record<string, unknown>) {
  return typeof request.parentJobId === "string" && request.parentJobId ? request.parentJobId : null;
}

function fanKindFromRequest(request: Record<string, unknown>): "preview" | "generate" | null {
  return request.fanKind === "preview" || request.fanKind === "generate" ? request.fanKind : null;
}

function errorDetailFromResult(result: Record<string, unknown>): DocumentJobError | null {
  const value = result.errorDetail;
  if (!value || typeof value !== "object") return null;
  const detail = value as Record<string, unknown>;
  const parsed={
    code: String(detail.code ?? "operation_failed"), category: String(detail.category ?? "unknown") as DocumentJobError["category"],
    scope: String(detail.scope ?? "unknown") as DocumentJobError["scope"], action: String(detail.action ?? "none") as DocumentJobError["action"],
    message: String(detail.message ?? "The operation failed."), retryable: Boolean(detail.retryable), retryAfterMs: detail.retryAfterMs === null || detail.retryAfterMs === undefined || !Number.isFinite(Number(detail.retryAfterMs)) ? null : Number(detail.retryAfterMs),
    requestId: detail.requestId ? String(detail.requestId) : null, httpStatus: detail.httpStatus === null || detail.httpStatus === undefined || !Number.isFinite(Number(detail.httpStatus)) ? null : Number(detail.httpStatus),
    riskCategories: Array.isArray(detail.riskCategories) ? detail.riskCategories.map(String) : [], contributingBlockIds: Array.isArray(detail.contributingBlockIds) ? detail.contributingBlockIds.map(String) : [], contributingReferenceIds: Array.isArray(detail.contributingReferenceIds) ? detail.contributingReferenceIds.map(String) : [], probe: detail.probe ? String(detail.probe) : null,
  };
  return publicFailureDetail(classifyDocumentJobFailure(parsed.message,{...parsed,probe:parsed.probe??undefined}));
}

function failureProgressMessage(detail: ProviderFailureDetail | DocumentJobError | null) {
  if (!detail) return "The operation failed.";
  if(detail.code==="local_persistence_failed")return "Forma could not save the generation because a local database or event-store write failed. This is not a provider interruption.";
  if(detail.code==="source_fidelity_validation_failed")return "The generated presentation did not preserve its required source facts, quotations, or authorized slide evidence.";
  if (detail.category === "safety") return detail.riskCategories?.includes("audio-copyright") || /\baudio\b.*\bcopyright\b/i.test(detail.message)
    ? "The provider rejected generated audio. Start a silent video instead of recovering the rejected render."
    : "Safety checks stopped this generation. Change the request or reference before retrying.";
  if (detail.action === "review_budget") return detail.scope === "workspace" ? "The workspace generation budget is exhausted." : "Your generation budget is exhausted.";
  if (detail.category === "quota") return `The OpenAI ${detail.scope === "project" || detail.scope === "organization" ? detail.scope : "account"} limit prevents generation.`;
  if (detail.category === "authentication") return "The configured OpenAI credential was rejected.";
  if (detail.category === "access") return "The configured credential cannot access this OpenAI project or model.";
  if (detail.category === "rate_limit") return "OpenAI remained rate limited after automatic backoff.";
  if (detail.category === "network" || detail.category === "server") return "The provider connection ended before an image was returned.";
  return detail.message || "The operation failed.";
}

async function finishDocumentJob(env: WorkerEnv, row: DocumentJobRow, status: "completed" | "failed", result: Record<string, unknown>, errorMessage: string | null, completedAt = new Date().toISOString(), guardActive = true) {
  const parentId = parentJobIdFromRequest(parseRequest(row));
  const bindings = documentJobCompletionBindings({ status, result, errorMessage, completedAt, parentId, jobId: row.job_id, ownerId: row.owner_id, correlationId: row.correlation_id });
  const statement = guardActive
    ? "UPDATE document_jobs SET status=?,result_json=?,error_message=?,completed_at=?,lease_expires_at=NULL,notified_at=CASE WHEN ? IS NULL THEN notified_at ELSE ? END,updated_at=? WHERE job_id=? AND owner_id=? AND correlation_id=? AND status IN ('running','committing')"
    : "UPDATE document_jobs SET status=?,result_json=?,error_message=?,completed_at=?,lease_expires_at=NULL,notified_at=CASE WHEN ? IS NULL THEN notified_at ELSE ? END,updated_at=? WHERE job_id=? AND owner_id=? AND correlation_id=?";
  return env.DB.prepare(statement).bind(...bindings).run();
}

function queueRecoveryPresentation(row: DocumentJobRow, recoveryBlocker: DocumentJobRow | null) {
  if (!recoveryBlocker) return null;
  if (row.job_id === recoveryBlocker.job_id) return {
    stage: "recovering",
    progressMessage: "The server is recovering this interrupted operation before continuing the queue.",
  };
  if (row.status === "queued") return {
    stage: "queue-recovery",
    progressMessage: "An earlier operation lost contact. The server is recovering it before this render starts.",
  };
  return null;
}

function serializeJob(row: DocumentJobRow, recoveryBlocker: DocumentJobRow | null = null, detail = true) {
  const parsed = parseResult(row); const result = row.result_json ? parsed : null; const request = parseRequest(row); const identity = generationRequestIdentity(row.kind, request, row.document_id);
  const members = Array.isArray(parsed.members) ? parsed.members : [];
  const recovery = queueRecoveryPresentation(row, recoveryBlocker);
  const errorDetail=errorDetailFromResult(parsed);
  const visibleResult = row.kind === "render_document" && request.artifactKind
    ? { ...(result ?? {}), artifactKind: String(parsed.artifactKind ?? request.artifactKind) }
    : result;
  const summarizedResult = detail || !visibleResult ? visibleResult
    : Object.fromEntries(Object.entries(visibleResult).filter(([key]) => !["plannerInput", "videoInputReceipt", "artifactPlan"].includes(key)));
  return {
    jobId: row.job_id, documentId: row.document_id, kind: row.kind, status: row.status, sourceSurface: row.source_surface,
    requestedSequence: Number(row.requested_sequence), documentRevision: identity.documentRevision, requestKey: identity.requestKey, sourcePreviewId: identity.sourcePreviewId, productionMode:request.productionMode==="managed"?"managed" as const:"manual" as const, promptTechnique: identity.promptTechnique, promptFanId: identity.promptFanId,
    parentJobId: parentJobIdFromRequest(request), fanKind: fanKindFromRequest(request), members, result: summarizedResult, error: row.error_message, errorDetail, moderationPromptRef: parsed.moderationPromptRef ? String(parsed.moderationPromptRef) : null, dismissedAt: parsed.dismissedAt ? String(parsed.dismissedAt) : null, attemptCount: Number(row.attempt_count),
    requestedAt: row.requested_at, startedAt: row.started_at, completedAt: row.completed_at, notifiedAt: row.notified_at,
    leaseExpiresAt: row.lease_expires_at, updatedAt: row.updated_at,
    stage: recovery?.stage ?? String(parsed.stage ?? row.status), progressMessage: recovery?.progressMessage ?? (errorDetail?.code==="local_persistence_failed"||errorDetail?.code==="source_fidelity_validation_failed"?failureProgressMessage(errorDetail):String(parsed.progressMessage ?? "")),
  };
}

async function reconcilePromptFanParent(env: WorkerEnv, ownerId: string, parentId: string) {
  const parent = await readJob(env, ownerId, parentId); if (!parent || parent.kind !== "prompt_fan") return parent;
  if (parent.status === "canceled" || errorDetailFromResult(parseResult(parent))?.code === "force_failed_by_admin") return parent;
  const request = parseRequest(parent); const childIds = Array.isArray(request.childJobIds) ? request.childJobIds.map(String).filter(Boolean).slice(0, 4) : [];
  const childRows=childIds.length?(await env.DB.prepare(`SELECT * FROM document_jobs WHERE owner_id=? AND job_id IN (${childIds.map(()=>"?").join(",")})`).bind(ownerId,...childIds).all<DocumentJobRow>()).results:[];
  const childrenById=new Map(childRows.map((row)=>[row.job_id,row]));
  const children=childIds.map((jobId)=>childrenById.get(jobId)).filter((row):row is DocumentJobRow=>Boolean(row));
  const members = children.map((child) => {
    const childRequest = parseRequest(child); const childResult = parseResult(child);
    return { jobId: child.job_id, promptTechnique: normalizePromptTechnique(childRequest.promptTechnique), status: child.status, error: errorDetailFromResult(childResult), moderationPromptRef: childResult.moderationPromptRef ? String(childResult.moderationPromptRef) : null, attemptCount: Number(child.attempt_count), updatedAt: child.updated_at };
  });
  const terminal = children.filter((child) => documentJobTerminal(child)); const succeeded = terminal.filter((child) => child.status === "completed").length; const canceled = terminal.filter((child) => child.status === "canceled").length; const failed = terminal.length - succeeded - canceled;
  const status: DocumentJobStatus = terminal.length === childIds.length && childIds.length > 0 ? canceled === childIds.length ? "canceled" : failed + canceled === 0 ? "completed" : succeeded > 0 ? "partial" : "failed" : children.some((child) => child.status === "running" || child.status === "committing") || terminal.length > 0 ? "running" : "queued";
  const now = new Date().toISOString(); const completedAt = documentJobTerminal({ status }) ? parent.completed_at ?? now : null;
  const progressMessage = status === "completed" ? "All four prompt approaches finished." : status === "canceled" ? "The fan generation was stopped." : status === "partial" ? `${succeeded} of 4 images finished; ${failed + canceled} did not finish.` : status === "failed" ? "All four prompt approaches failed or were stopped." : `${terminal.length} of 4 prompt approaches finished.`;
  const result = { ...parseResult(parent), stage: status, progressMessage, members, completedCount: succeeded, failedCount: failed, canceledCount: canceled, totalCount: childIds.length };
  const resultJson = JSON.stringify(result); const errorMessage = status === "partial" ? "prompt_fan_partial_failure" : status === "failed" ? "prompt_fan_failed" : null;
  if (parent.status === status && parent.result_json === resultJson && parent.error_message === errorMessage && parent.completed_at === completedAt) return parent;
  await env.DB.prepare("UPDATE document_jobs SET status=?,result_json=?,error_message=?,completed_at=?,updated_at=? WHERE job_id=? AND owner_id=?").bind(status, resultJson, errorMessage, completedAt, now, parentId, ownerId).run();
  return readJob(env, ownerId, parentId);
}

async function reconcileParentForChild(env: WorkerEnv, row: DocumentJobRow) {
  const parentId = parentJobIdFromRequest(parseRequest(row));
  if (parentId) await reconcilePromptFanParent(env, row.owner_id, parentId);
}

async function readJob(env: WorkerEnv, ownerId: string, jobId: string) {
  return env.DB.prepare("SELECT * FROM document_jobs WHERE job_id=? AND owner_id=?").bind(jobId, ownerId).first<DocumentJobRow>();
}

async function refreshGenerationReceipt(env:WorkerEnv,user:PilotUser,row:DocumentJobRow,body:Record<string,unknown>={},failure:ProviderFailureDetail|null=null){
  if(row.kind!=="render_document")return row;
  const latest=await readJob(env,user.userId,row.job_id);if(!latest)return row;
  const checkpoint=parseResult(latest);
  const previous=checkpoint.generationReceipt&&typeof checkpoint.generationReceipt==="object"&&!Array.isArray(checkpoint.generationReceipt)?checkpoint.generationReceipt as GenerationReceipt:null;
  if(!previous)return latest;
  const appended=Array.isArray(body.appended)?body.appended.filter((event):event is Record<string,unknown>=>Boolean(event&&typeof event==="object"&&!Array.isArray(event))):[];
  const correlated=appended.length?appended:await readCorrelatedEvents(env,user.streamId,[latest.correlation_id]);
  const payloads=correlated.map((event)=>({type:String(event.type??""),payload:event.payload&&typeof event.payload==="object"&&!Array.isArray(event.payload)?event.payload as Record<string,unknown>:{}}));
  const completed=payloads.find((event)=>event.type==="DocumentRenderCompleted")?.payload;
  const budget=payloads.find((event)=>event.type==="BudgetReserved")?.payload;
  const usage=payloads.filter((event)=>event.type==="GenerationUsageRecorded").map((event)=>event.payload);
  const reservationId=String(checkpoint.costReservationId??budget?.cost_reservation_id??usage[0]?.cost_reservation_id??"");
  const reservation=reservationId?await costBudgetReservation(env,user.billingUserId??user.userId,reservationId):null;
  const plannerResponses=Array.isArray(checkpoint.plannerResponseIds)?checkpoint.plannerResponseIds.filter(Boolean):[];
  const plannerUsage=checkpoint.plannerUsage&&typeof checkpoint.plannerUsage==="object"?checkpoint.plannerUsage as Record<string,unknown>:{};
  const plannerInput=checkpoint.plannerInput&&typeof checkpoint.plannerInput==="object"?checkpoint.plannerInput as Record<string,unknown>:{};
  const plannerValidation=plannerInput.validation&&typeof plannerInput.validation==="object"?plannerInput.validation as Record<string,unknown>:{};
  const recordedPlannerCalls=Math.max(plannerResponses.length,Math.max(0,Number(plannerInput.provider_request_count??plannerValidation.provider_call_count??0)));
  const confirmedProviderRequest=Boolean(completed||checkpoint.plannerResponseId||plannerResponses.length||Number(plannerUsage.totalTokens??0)>0||checkpoint.providerJobId||usage.some((event)=>Boolean(event.planner_response_id)||Number(event.total_tokens??0)>0)||failure?.requestId);
  const uncertainProviderRequest=!confirmedProviderRequest&&Boolean(failure&&(failure.category==="network"||failure.category==="rate_limit"||failure.category==="server"&&failure.scope==="provider"));
  const provider=String(completed?.provider??body.provider??checkpoint.provider??previous.provider??"openai");
  const model=String(completed?.model_id??checkpoint.providerModel??checkpoint.plannerModel??previous.model??env.OPENAI_MODEL??"gpt-5.6-terra");
  const settledFromEvents=usage.reduce((total,event)=>total+Math.max(0,Number(event.cost_microusd??0)),0);
  const receipt={
    ...previous,provider,model,
    ...(previous.artifact_kind==="slides"&&completed&&Number.isSafeInteger(Number(completed.item_count))?{actual_slide_count:Number(completed.item_count)}:{}),
    actual_provider_call_count:recordedPlannerCalls||previous.actual_provider_call_count||null,
    reservation_microusd:Number(reservation?.reserved_microusd??checkpoint.costReservationMicrousd??budget?.reserved_microusd??previous.reservation_microusd),
    settled_cost_microusd:reservation?Number(reservation.used_microusd??0):settledFromEvents,
    reservation_status:reservation?String(reservation.status):latest.status==="failed"&&settledFromEvents===0?"released":String(previous.reservation_status??"unknown"),
    source_transmission_status:confirmedProviderRequest?"transmitted":uncertainProviderRequest?"unknown":"not_transmitted",
    provider_request_status:completed?"completed":confirmedProviderRequest?"submitted":uncertainProviderRequest?"submission_unknown":"not_submitted",
    ...(failure?{failure_code:failure.code,failure_category:failure.category,failure_stage:failure.code==="local_persistence_failed"?"local_persistence":failure.code==="source_fidelity_validation_failed"?"source_fidelity_validation":failure.scope==="provider"||failure.category==="network"||failure.category==="rate_limit"?"provider":"application"}:{}),
  };
  const updatedAt=new Date().toISOString();
  const result={...checkpoint,generationReceipt:receipt};
  const updated=await env.DB.prepare("UPDATE document_jobs SET result_json=?,updated_at=? WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND status=?")
    .bind(JSON.stringify(result),updatedAt,latest.job_id,user.userId,user.streamId,latest.correlation_id,latest.status).run();
  return Number(updated.meta.changes??0)===1?{...latest,result_json:JSON.stringify(result),updated_at:updatedAt}:await readJob(env,user.userId,row.job_id)??latest;
}

function rowIsStale(row: DocumentJobRow, now = Date.now()) {
  return documentJobIsStale({ status: row.status, leaseExpiresAt: row.lease_expires_at, updatedAt: row.updated_at }, now);
}

async function updateJobProgress(env: WorkerEnv, row: DocumentJobRow, stage: string, progressMessage: string, patch:Record<string,unknown>={}) {
  const updatedAt = new Date().toISOString(); const result = { ...parseResult(row), stage, progressMessage, ...patch };
  const updated=await env.DB.prepare("UPDATE document_jobs SET result_json=?,updated_at=? WHERE job_id=? AND owner_id=? AND status='running' AND correlation_id=?").bind(JSON.stringify(result), updatedAt, row.job_id, row.owner_id, row.correlation_id).run();
  if(Number(updated.meta.changes??0)!==1)throw new Error("document_job_canceled");
  row.result_json = JSON.stringify(result); row.updated_at = updatedAt;
}

async function renewJobLease(env: WorkerEnv, row: DocumentJobRow) {
  const now = new Date(); const leaseExpiresAt = new Date(now.getTime() + DOCUMENT_JOB_LEASE_MS).toISOString();
  const result = await env.DB.prepare("UPDATE document_jobs SET lease_expires_at=?,updated_at=? WHERE job_id=? AND owner_id=? AND status IN ('running','committing') AND correlation_id=?").bind(leaseExpiresAt, now.toISOString(), row.job_id, row.owner_id, row.correlation_id).run();
  if (Number(result.meta.changes ?? 0) !== 1) throw new Error("document_job_lease_lost");
  row.lease_expires_at = leaseExpiresAt; row.updated_at = now.toISOString();
}

async function beginJobCommit(env: WorkerEnv, row: DocumentJobRow) {
  const now = new Date().toISOString();
  const result = await env.DB.prepare("UPDATE document_jobs SET status='committing',updated_at=? WHERE job_id=? AND owner_id=? AND correlation_id=? AND status='running'").bind(now, row.job_id, row.owner_id, row.correlation_id).run();
  if (Number(result.meta.changes ?? 0) !== 1) throw new Error("document_job_canceled");
  row.status = "committing"; row.updated_at = now;
}

async function runWithHeartbeat<T>(env: WorkerEnv, row: DocumentJobRow,user:PilotUser, operation: (control: { signal: AbortSignal; beginCommit: () => Promise<void>; progress: (stage:string,message:string,patch?:Record<string,unknown>) => Promise<void> }) => Promise<T>) {
  let settled = false; let value: T | undefined; let failure: unknown;
  const controller = new AbortController(); let commitStarted = false;
  const verify=async()=>{if(!await activeProjectExecution(env,user,row.document_id,row.job_id))throw new Error("document_job_canceled");};
  await verify();
  const execution = operation({ signal: controller.signal, beginCommit: async () => { if (commitStarted) return;await verify();await updateJobProgress(env,row,"saving","Saving the provider result and its durable receipt.");await beginJobCommit(env, row); commitStarted = true; }, progress: async(stage,message,patch)=>{if(!commitStarted){await verify();await updateJobProgress(env,row,stage,message,patch);}} }).then((result) => { value = result; settled = true; }, (error) => { failure = error; settled = true; });
  while (!settled) {
    await Promise.race([execution, new Promise<void>((resolve) => setTimeout(resolve, DOCUMENT_JOB_HEARTBEAT_MS))]);
    if (!settled) try {await verify();await renewJobLease(env, row); } catch (error) { controller.abort("document_job_canceled"); failure = error; await execution; }
  }
  if (failure !== undefined) throw failure;
  return value as T;
}

async function restoreLegacyCostReservation(env: WorkerEnv, user: PilotUser, row: DocumentJobRow, events: Awaited<ReturnType<typeof readCorrelatedEvents>>) {
  const checkpoint = parseResult(row);
  const existingId = String(checkpoint.costReservationId ?? "");
  const ownerId = user.billingUserId ?? user.userId;
  if (existingId && await costBudgetReservation(env, ownerId, existingId)) return existingId;
  const evidence = [...events].reverse().find((event) => event.type === "BudgetReserved" && Number(event.payload.reserved_microusd ?? 0) > 0);
  if (!evidence) return "";
  const reservationId = String(evidence.payload.cost_reservation_id ?? checkpoint.costReservationId ?? `legacy-cost:${String(evidence.payload.reservation_id ?? evidence.eventId)}`);
  await adoptLegacyCostReservation(env, ownerId, {
    reservationId,
    amountMicrousd: Number(evidence.payload.reserved_microusd),
    period: String(evidence.payload.period ?? checkpoint.costReservationPeriod ?? evidence.occurredAt.slice(0, 7)),
    streamId: user.streamId,
    correlationId: row.correlation_id,
    operation: String(evidence.payload.operation ?? `document-render:${parseRequest(row).artifactKind ?? "unknown"}`),
  });
  return reservationId;
}

async function releaseInterruptedAttempt(env: WorkerEnv, user: PilotUser, row: DocumentJobRow, reason: string) {
  const checkpoint=parseResult(row);
  const activeSceneReceipts=Object.values(checkpoint.productionSceneReceipts&&typeof checkpoint.productionSceneReceipts==="object"?checkpoint.productionSceneReceipts as Record<string,Record<string,unknown>>:{});
  const activeFrameReceipts=Object.values(checkpoint.productionFrameReceipts&&typeof checkpoint.productionFrameReceipts==="object"?checkpoint.productionFrameReceipts as Record<string,Record<string,unknown>>:{});
  const plannerUsage=checkpoint.plannerUsage&&typeof checkpoint.plannerUsage==="object"?checkpoint.plannerUsage as Record<string,unknown>:{};
  const hasPaidProvider=Boolean(checkpoint.providerJobId||checkpoint.productionAnchor||Number(plannerUsage.totalTokens??0)>0)||activeSceneReceipts.some((receipt)=>receipt.status==="submitted"||receipt.status==="completed")||activeFrameReceipts.length>0;
  const events=await readCorrelatedEvents(env,user.streamId,[row.correlation_id]);
  const restoredCostReservationId=await restoreLegacyCostReservation(env,user,row,events);
  let released:Array<{id:string;tokens:number;operation:string}>=[];
  let receiptAwareSettlement=false;
  if(hasPaidProvider&&(checkpoint.reservationId||restoredCostReservationId)){
    const settlement=await settleInterruptedDocumentJobReservations(env,user,row,{costReservationId:restoredCostReservationId||undefined,reason});
    receiptAwareSettlement=settlement.settled;
    if(settlement.settled&&checkpoint.reservationId)released=[{id:String(checkpoint.reservationId),tokens:settlement.releasedTokens,operation:`document-render:${String(parseRequest(row).artifactKind??"unknown")}`}];
  }else{
    released=await releaseBudgetReservationsForCorrelation(env,user,row.correlation_id,reason);
    const settled=events.some((event)=>event.type==="GenerationUsageRecorded");
    if(!hasPaidProvider&&!settled)await releaseCostReservationsForCorrelation(env,user.billingUserId??user.userId,row.correlation_id,user.streamId);
  }
  try {
    await appendAuditEvent(env, user.streamId, "worker:scheduler", "JobAttemptInterrupted", { job_id: row.job_id, document_id: row.document_id, kind: row.kind, attempt: row.attempt_count, reason, released_reservation_count: released.length }, row.correlation_id);
    if(!receiptAwareSettlement)for(const reservation of released)await appendAuditEvent(env,user.streamId,"worker:policy","BudgetReleased",{reservation_id:reservation.id,reserved_tokens:reservation.tokens,reason,operation:reservation.operation,job_id:row.job_id,attempt:row.attempt_count},row.correlation_id);
  } catch (error) { console.error("document_job_interruption_audit_failed", row.job_id, error instanceof Error ? error.message : "unknown"); }
}

async function failStaleJob(env: WorkerEnv, user: PilotUser, row: DocumentJobRow) {
  const now = new Date().toISOString();
  const errorDetail = { code: "execution_interrupted", category: "server", message: "The server lost contact with this operation before it finished.", retryable: false, requestId: null, httpStatus: null };
  const parentId = parentJobIdFromRequest(parseRequest(row));
  const result = await env.DB.prepare("UPDATE document_jobs SET status='failed',error_message='execution_interrupted',completed_at=?,lease_expires_at=NULL,result_json=?,notified_at=CASE WHEN ? IS NULL THEN notified_at ELSE ? END,updated_at=? WHERE job_id=? AND owner_id=? AND status IN ('running','committing') AND correlation_id=?").bind(now, JSON.stringify({ ...parseResult(row), errorDetail, stage: "failed", progressMessage: errorDetail.message }), parentId, now, now, row.job_id, user.userId, row.correlation_id).run();
  if (Number(result.meta.changes ?? 0) === 1) { await releaseInterruptedAttempt(env, user, row, "execution_interrupted"); await reconcileParentForChild(env, row); }
}

function operationFinished(events: Awaited<ReturnType<typeof readWorkspaceEvents>>, row: DocumentJobRow) {
  const correlated = events.filter((event) => event.correlationId === row.correlation_id);
  const terminal = correlated.find((event) => {
    if (row.kind === "preview") return event.type === "IdeationPreviewCompleted" || event.type === "GenerationFailed";
    if (row.kind === "generate") return event.type === "GenerationCompleted" || event.type === "GenerationFailed";
    if (row.kind === "chat") return event.type === "GenerationUsageRecorded" && event.payload.operation === "creative-chat" || event.type === "BudgetReleased" && event.payload.operation === "creative-chat";
    if (row.kind === "structure_adaptive") return event.type === "GenerationUsageRecorded" && event.payload.operation === "adaptive-structure" || event.type === "BudgetReleased" && event.payload.operation === "adaptive-structure";
    if (row.kind === "render_document") return event.type === "DocumentRenderCompleted" || event.type === "DocumentRenderFailed";
    return event.type === "ExtractionCompleted" || event.type === "ExtractionFailed";
  });
  const failed = terminal?.type === "GenerationFailed" || terminal?.type === "ExtractionFailed" || terminal?.type === "DocumentRenderFailed" || terminal?.type === "BudgetReleased";
  return terminal ? { failed, correlated } : null;
}

function correlatedFailureDetail(events: Awaited<ReturnType<typeof readWorkspaceEvents>>) {
  const failureEvent = [...events].reverse().find((event) => event.type === "GenerationFailed" || event.type === "ExtractionFailed" || event.type === "DocumentRenderFailed");
  if (!failureEvent) return null;
  const payload = failureEvent.payload;
  const detail={
    code: String(payload.error_code ?? payload.error_class ?? "operation_failed"), category: String(payload.error_category ?? "unknown") as DocumentJobError["category"],
    scope: String(payload.error_scope ?? "unknown") as DocumentJobError["scope"], action: String(payload.error_action ?? "none") as DocumentJobError["action"],
    message: String(payload.error_message ?? "The operation failed."), retryable: Boolean(payload.retryable),
    retryAfterMs: payload.retry_after_ms === null || payload.retry_after_ms === undefined || !Number.isFinite(Number(payload.retry_after_ms)) ? null : Number(payload.retry_after_ms),
    requestId: payload.provider_request_id ? String(payload.provider_request_id) : null,
    httpStatus: payload.http_status === null || payload.http_status === undefined || !Number.isFinite(Number(payload.http_status)) ? null : Number(payload.http_status),
    riskCategories: Array.isArray(payload.risk_categories) ? payload.risk_categories.map(String) : [], contributingBlockIds: Array.isArray(payload.contributing_block_ids) ? payload.contributing_block_ids.map(String) : [], contributingReferenceIds: Array.isArray(payload.contributing_reference_ids) ? payload.contributing_reference_ids.map(String) : [], probe: payload.preflight_probe ? String(payload.preflight_probe) : null,
  } satisfies DocumentJobError;
  return publicFailureDetail(classifyDocumentJobFailure(detail.message,{...detail,probe:detail.probe??undefined}));
}

function correlatedModerationPromptRef(events: Awaited<ReturnType<typeof readWorkspaceEvents>>) {
  const failureEvent=[...events].reverse().find((event)=>(event.type==="GenerationFailed"||event.type==="DocumentRenderFailed")&&event.payload.prompt_ref);
  return failureEvent?.payload.prompt_ref?String(failureEvent.payload.prompt_ref):null;
}

async function repairMisreportedTerminalJob(env: WorkerEnv, row: DocumentJobRow, events: Awaited<ReturnType<typeof readWorkspaceEvents>>) {
  if (row.status !== "failed" || !/Wrong number of parameter bindings/i.test(row.error_message ?? "")) return false;
  const finished = operationFinished(events, row); if (!finished) return false;
  const detail = finished.failed ? correlatedFailureDetail(finished.correlated) : null;
  const status = finished.failed ? "failed" : "completed";
  const moderationPromptRef=finished.failed?correlatedModerationPromptRef(finished.correlated):null;
  const result = { ...parseResult(row), ...(detail ? { errorDetail: detail } : {}), ...(moderationPromptRef?{moderationPromptRef}:{}), stage: status, progressMessage: finished.failed ? failureProgressMessage(detail) : "The operation finished." };
  await finishDocumentJob(env, row, status, result, detail?.message ?? (finished.failed ? "operation_failed" : null), row.completed_at ?? new Date().toISOString(), false);
  return true;
}

function safeResult(body: Record<string, unknown>, correlatedEventIds: string[] = []) {
  const appended = Array.isArray(body.appended) ? body.appended as Array<Record<string, unknown>> : [];
  const adaptiveReasoning = appended.find((event) => event.type === "AssistantReasoned" && (event.payload as Record<string, unknown> | undefined)?.operation === "adaptive-structure");
  const adaptivePayload = adaptiveReasoning?.payload as Record<string, unknown> | undefined;
  const result = {
    head: Number(body.head ?? 0),
    appendedEventIds: appended.map((event) => String(event.eventId ?? "")).filter(Boolean).concat(correlatedEventIds),
    previewed: Boolean(body.previewed), previewQueued: Boolean(body.previewQueued), previewSuppressed: Boolean(body.previewSuppressed), followupJobId: body.followupJobId ? String(body.followupJobId) : undefined, moderationPromptRef: body.moderationPromptRef ? String(body.moderationPromptRef) : undefined, promoted: Boolean(body.promoted), quality: body.quality ? String(body.quality) : undefined,
    artifactId: body.artifactId ? String(body.artifactId) : undefined, artifactKind: body.artifactKind ? String(body.artifactKind) : undefined,
    providerJobId: body.providerJobId ? String(body.providerJobId) : undefined, provider: body.provider ? String(body.provider) : undefined,
    intentRef: adaptivePayload?.intent_ref ? String(adaptivePayload.intent_ref) : undefined,
    structure: body.structure && typeof body.structure === "object" ? body.structure : undefined,
  };
  return Object.fromEntries(Object.entries(result).filter(([,value])=>value!==undefined));
}

async function queueFollowupPreview(env:WorkerEnv,user:PilotUser,parent:DocumentJobRow,spec:Record<string,unknown>){
  if(spec.kind!=="preview"||String(spec.documentId??"")!==parent.document_id)return null;const payload=spec.payload&&typeof spec.payload==="object"?{...(spec.payload as Record<string,unknown>)}:{};if(!payload.directionRef||JSON.stringify(payload).length>MAX_PAYLOAD_BYTES)return null;
  if(!await activeProjectExecution(env,user,parent.document_id,parent.job_id))return null;
  const organizationRetention=user.projectExecution?await env.DB.prepare("SELECT transient_days FROM organization_retention_policies WHERE organization_id=?").bind(user.projectExecution.organizationId).first<{transient_days:number}>():null;
  const requestedAt=new Date();const now=requestedAt.toISOString();const configuredRetention=Number(organizationRetention?.transient_days??env.FORMA_RETENTION_DAYS??30);const retentionDays=Number.isFinite(configuredRetention)&&configuredRetention>0?configuredRetention:30;const expiresAt=new Date(requestedAt.getTime()+retentionDays*86_400_000).toISOString();const jobId=uuidV7();const sourceSurface=String(spec.sourceSurface??"chat").slice(0,80)||"chat";const requestedSequence=await streamHead(env,user.streamId);
  payload.documentRevision=`chat-${parent.job_id}`;payload.promptTechnique=normalizePromptTechnique(payload.promptTechnique);payload.requestKey=documentGenerationRequestKey("preview",String(payload.documentRevision),null,String(payload.promptTechnique));
  const statements=[env.DB.prepare("UPDATE document_jobs SET status='failed',error_message='superseded_by_newer_chat_preview',completed_at=?,notified_at=?,updated_at=? WHERE owner_id=? AND stream_id=? AND document_id=? AND kind='preview' AND source_surface='chat' AND status='queued'").bind(now,now,now,user.userId,user.streamId,parent.document_id),
    documentJobInsert(env,user,parent.document_id,"?,?,?,?,?,'queued',?,?,?,?,NULL,NULL,0,?,NULL,NULL,NULL,NULL,?,?",[jobId,user.userId,user.streamId,parent.document_id,"preview",sourceSurface,jobId,requestedSequence,JSON.stringify(payload),now,expiresAt,now])];
  const resource=projectJobResource(env,user,jobId,parent.document_id,now);if(resource)statements.push(resource);
  const results=await env.DB.batch(statements);
  if(Number(results[1]?.meta.changes??0)!==1||resource&&Number(results[2]?.meta.changes??0)!==1)return null;
  if(resource)await anchorProjectJobs(env,user,[{jobId,kind:"preview",documentId:parent.document_id}]);
  return readJob(env,user.userId,jobId);
}

export async function runDocumentJob(env: WorkerEnv, user: PilotUser, jobId: string) {
  await ensureSchema(env);
  let row = await readJob(env, user.userId, jobId); if (!row) return row;
  if(!await activeProjectExecution(env,user,row.document_id,jobId)){
    if(user.projectExecution)await cancelProjectActorJobs(env,user,{organizationId:user.projectExecution.organizationId,projectAccessId:user.projectExecution.projectAccessId,actorUserId:user.userId});
    return null;
  }
  if (row.kind === "prompt_fan") return reconcilePromptFanParent(env, user.userId, row.job_id);
  if (documentJobTerminal({ status: row.status })) return row;

  const existingEvents = await readCorrelatedEvents(env, user.streamId, [row.correlation_id]);
  const finished = operationFinished(existingEvents, row);
  if (finished) {
    const now = new Date().toISOString(); const status: DocumentJobStatus = finished.failed ? "failed" : "completed";let followup:DocumentJobRow|null=null;
    if(!finished.failed&&row.kind==="chat"){const reasoned=finished.correlated.find((event)=>event.type==="AssistantReasoned"&&event.payload.preview_queued&&event.payload.preview_direction_ref);if(reasoned)followup=await queueFollowupPreview(env,user,row,{kind:"preview",documentId:row.document_id,sourceSurface:"chat",payload:{directionRef:reasoned.payload.preview_direction_ref,directionModel:reasoned.payload.model_id,sourceChatTurnId:reasoned.payload.turn_id,locale:parseRequest(row).locale??"en"}});}
    const failureDetail = finished.failed ? correlatedFailureDetail(finished.correlated) : null;const moderationPromptRef=finished.failed?correlatedModerationPromptRef(finished.correlated):null;
    const checkpoint=parseResult(row);
    const result = { ...(finished.failed ? checkpoint : {}), ...(checkpoint.generationReceipt?{generationReceipt:checkpoint.generationReceipt}:{}), ...safeResult({ head: await streamHead(env,user.streamId),previewQueued:Boolean(followup),followupJobId:followup?.job_id,moderationPromptRef }, finished.correlated.map((event) => event.eventId)), ...(failureDetail ? { errorDetail: failureDetail } : {}), stage: status, progressMessage: finished.failed ? failureProgressMessage(failureDetail) : "The operation finished." };
    await finishDocumentJob(env, row, status, result, failureDetail?.message ?? (finished.failed ? "operation_failed" : null), now, false);
    await refreshGenerationReceipt(env,user,row,{appended:finished.correlated},failureDetail?{...failureDetail,probe:failureDetail.probe??undefined}:null);
    await reconcileParentForChild(env, row);
    return readJob(env, user.userId, jobId);
  }

  if(row.status==="committing"){
    if(rowIsStale(row))await failStaleJob(env,user,row);
    return readJob(env,user.userId,jobId);
  }

  const blocker = await env.DB.prepare("SELECT job_id FROM document_jobs WHERE stream_id=? AND kind!='prompt_fan' AND status IN ('queued','running','committing') AND (requested_at<? OR (requested_at=? AND job_id<?)) ORDER BY requested_at ASC,job_id ASC LIMIT 1").bind(user.streamId, row.requested_at, row.requested_at, row.job_id).first<{ job_id: string }>();
  if (blocker) return row;
  if (row.status === "running" && !rowIsStale(row)) return row;
  if (row.status === "running" && row.attempt_count >= documentJobMaxAttempts(row.kind)) { await failStaleJob(env, user, row); return readJob(env, user.userId, jobId); }

  const previousAttempt = row.attempt_count; const previousRow = { ...row }; const previousCheckpoint = parseResult(previousRow); const attempt = previousAttempt + 1;
  const previousSceneReceipts = Object.values(previousCheckpoint.productionSceneReceipts && typeof previousCheckpoint.productionSceneReceipts === "object" ? previousCheckpoint.productionSceneReceipts as Record<string, Record<string, unknown>> : {});
  const previousFrameReceipts = Object.values(previousCheckpoint.productionFrameReceipts && typeof previousCheckpoint.productionFrameReceipts === "object" ? previousCheckpoint.productionFrameReceipts as Record<string, Record<string, unknown>> : {});
  const hasPaidProviderCheckpoint = Boolean(previousCheckpoint.providerJobId||previousCheckpoint.productionAnchor)
    || previousSceneReceipts.some((receipt) => Boolean(receipt.providerJobId) && (receipt.status === "submitted" || receipt.status === "completed"))
    || previousFrameReceipts.length > 0;
  const handoffPaidProviderReservations = previousAttempt > 0 && row.kind === "render_document" && hasPaidProviderCheckpoint
    && Boolean(previousCheckpoint.reservationId && previousCheckpoint.costReservationId);
  const now = new Date(); const nowIso = now.toISOString(); const staleBefore = new Date(now.getTime() - DOCUMENT_JOB_STALE_AFTER_MS).toISOString(); const leaseExpiresAt = new Date(now.getTime() + DOCUMENT_JOB_LEASE_MS).toISOString();
  const attemptCorrelationId = `${jobId}:attempt:${attempt}`; const initialResult = { ...previousCheckpoint, stage: "preparing", progressMessage: attempt > 1 ? "Recovering the interrupted operation." : "Preparing the document context." };
  const claimSql="UPDATE document_jobs SET status='running',attempt_count=attempt_count+1,correlation_id=?,started_at=COALESCE(started_at,?),lease_expires_at=?,result_json=?,updated_at=? WHERE job_id=? AND owner_id=? AND stream_id=? AND (status='queued' OR (status='running' AND (lease_expires_at<? OR updated_at<?))) AND NOT EXISTS(SELECT 1 FROM document_jobs active WHERE active.stream_id=document_jobs.stream_id AND active.job_id<>document_jobs.job_id AND active.kind!='prompt_fan' AND active.status IN('running','committing'))";
  const claimBindings=[attemptCorrelationId,nowIso,leaseExpiresAt,JSON.stringify(initialResult),nowIso,jobId,user.userId,user.streamId,nowIso,staleBefore] as const;
  let claimed;
  if (handoffPaidProviderReservations) {
    const billingOwnerId = user.billingUserId ?? user.userId;
    const tokenReservationId=String(previousCheckpoint.reservationId);
    const costReservationId=String(previousCheckpoint.costReservationId);
    const operation=`document-render:${String(parseRequest(previousRow).artifactKind??"unknown")}`;
    const claimAttempt=env.DB.prepare(`${claimSql} AND EXISTS (SELECT 1 FROM budget_reservations token JOIN cost_budget_reservations cost ON cost.owner_id=token.owner_id AND cost.stream_id=token.stream_id AND cost.correlation_id=token.correlation_id AND cost.operation=token.operation AND cost.period=token.period WHERE token.reservation_id=? AND cost.reservation_id=? AND token.owner_id=? AND token.stream_id=? AND token.correlation_id=? AND token.operation=? AND token.status='active' AND cost.status IN ('active','executing'))`)
      .bind(...claimBindings,tokenReservationId,costReservationId,billingOwnerId,user.streamId,previousRow.correlation_id,operation);
    const tokenReservationHandoff=env.DB.prepare(TOKEN_RESERVATION_HANDOFF_SQL).bind(attemptCorrelationId,nowIso,tokenReservationId,billingOwnerId,user.streamId,previousRow.correlation_id,operation,costReservationId,jobId,user.userId,attemptCorrelationId,attempt);
    const costReservationHandoff=env.DB.prepare(COST_RESERVATION_HANDOFF_SQL).bind(attemptCorrelationId,nowIso,costReservationId,billingOwnerId,user.streamId,previousRow.correlation_id,operation,tokenReservationId,attemptCorrelationId,jobId,user.userId,attemptCorrelationId,attempt);
    const claims = await env.DB.batch([claimAttempt, tokenReservationHandoff, costReservationHandoff]);
    claimed = claims[0];
    if(Number(claimed.meta.changes??0)!==1||claims.slice(1).some((claim)=>Number(claim.meta.changes??0)!==1)){
      const retained=await readJob(env,user.userId,jobId);
      if(retained&&retained.correlation_id===previousRow.correlation_id&&rowIsStale(retained))await failStaleJob(env,user,retained);
      return readJob(env,user.userId,jobId);
    }
  } else {
    claimed=await env.DB.prepare(claimSql).bind(...claimBindings).run();
  }
  if (Number(claimed.meta.changes ?? 0) !== 1) return readJob(env, user.userId, jobId);
  if (previousAttempt > 0 && !handoffPaidProviderReservations) await releaseInterruptedAttempt(env, user, previousRow, "execution_interrupted_retrying");
  row = await readJob(env, user.userId, jobId); if (!row) return null;
  if(previousAttempt>0&&!handoffPaidProviderReservations&&!hasPaidProviderCheckpoint){
    const checkpoint=parseResult(row);
    for(const key of ["reservationId","costReservationId","costReservationMicrousd","costReservationPeriod"] as const)delete checkpoint[key];
    const updatedAt=new Date().toISOString();
    const cleared=await env.DB.prepare("UPDATE document_jobs SET result_json=?,updated_at=? WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND status='running'")
      .bind(JSON.stringify(checkpoint),updatedAt,row.job_id,user.userId,user.streamId,row.correlation_id).run();
    if(Number(cleared.meta.changes??0)!==1)return readJob(env,user.userId,jobId);
    row.result_json=JSON.stringify(checkpoint);row.updated_at=updatedAt;
  }

  try {
    const payload = JSON.parse(row.request_json) as Record<string, unknown>;
    if(row.kind==="render_document"&&payload.artifactKind==="slides")clearPresentationServerOwnedCheckpointFields(payload);
    const inputRef = String(payload.jobInputRef ?? "");
    if (inputRef) {
      const privateContent = await loadPrivateContent(env, user.userId, row.kind === "chat" ? "chat" : "all", user.projectExecution); const input = privateContent[inputRef];
      if (typeof input !== "string") throw new Error("job_input_expired");
      if (row.kind === "chat") payload.message = input;
      if (row.kind === "structure_adaptive") payload.prompt = input;
    }
    delete payload.expectedSequence; delete payload.jobInputRef;
    if(row.kind==="render_document"){
      const checkpoint=parseResult(row);for(const key of ["artifactId","providerJobId","providerModel","providerStatusUrl","providerResponseUrl","providerCancelUrl","artifactPlan","plannerModel","plannerResponseId","plannerResponseIds","plannerLatencyMs","plannerUsage","plannerInput","renderedItems","videoInputReceipt","productionPlan","productionSceneReceipts","productionFrameReceipts","productionPrepaidSceneIds","productionPrepaidAnchor","prepaidProviderCostMicrousd","productionAnchor","costReservationMicrousd","costReservationId","costReservationPeriod"] as const)if(checkpoint[key]!==undefined)payload[key]=checkpoint[key];if((checkpoint.providerJobId||checkpoint.productionSceneReceipts||checkpoint.productionFrameReceipts||checkpoint.productionAnchor)&&checkpoint.reservationId)payload.reservationId=checkpoint.reservationId;
    }
    payload.action = row.kind; payload.documentId = row.document_id; payload.sourceSurface = row.source_surface;
    payload.correlationId = row.correlation_id; payload.clientId = `server:document-job:${row.kind}`;
    await updateJobProgress(env, row, "compiling", row.kind === "preview" || row.kind === "generate" ? "Compiling the checked document state for generation." : row.kind==="render_document"?"Compiling the document into the requested artifact.":"Processing the requested document change.");
    const response = await runWithHeartbeat(env, row,user, (control) => handleEvents(new Request("http://document-job.local/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: control.signal }), env, false, user, control));
    const body = await response.json() as Record<string, unknown>;let followup:DocumentJobRow|null=null;if(response.ok&&body.followupJob&&typeof body.followupJob==="object")followup=await queueFollowupPreview(env,user,row,body.followupJob as Record<string,unknown>);const completedAt = new Date().toISOString();
    const suppliedFailure=!response.ok?(body.errorDetail&&typeof body.errorDetail==="object"?body.errorDetail as ProviderFailureDetail:applicationFailureDetail(String(body.error??"document_job_failed"),body.scope,response.status)):null;
    const detail=!response.ok?classifyDocumentJobFailure(String(body.error??suppliedFailure?.message??"document_job_failed"),suppliedFailure,response.status):null;
    const latestCheckpoint=parseResult(await readJob(env,user.userId,row.job_id)??row);
    const durableCheckpoint = {...(response.ok?{}:parseResult(row)),...(response.ok?{}:latestCheckpoint)};
    const liveCheckpoint=latestCheckpoint;
    const rawReceipt=liveCheckpoint.generationReceipt;
    const livePlannerInput=liveCheckpoint.plannerInput&&typeof liveCheckpoint.plannerInput==="object"?liveCheckpoint.plannerInput as Record<string,unknown>:{};
    const livePlannerValidation=livePlannerInput.validation&&typeof livePlannerInput.validation==="object"?livePlannerInput.validation as Record<string,unknown>:{};
    const observedPlannerCalls=Math.max(Array.isArray(liveCheckpoint.plannerResponseIds)?new Set(liveCheckpoint.plannerResponseIds.map(String).filter(Boolean)).size:0,Math.max(0,Number(livePlannerInput.provider_request_count??livePlannerValidation.provider_call_count??0)));
    const acceptedReceipt=rawReceipt&&typeof rawReceipt==="object"?{...rawReceipt as Record<string,unknown>,...(observedPlannerCalls?{actual_provider_call_count:observedPlannerCalls}:{})}:null;
    const terminalResult = { ...durableCheckpoint, ...(acceptedReceipt?{generationReceipt:acceptedReceipt}:{}), ...safeResult({...body,followupJobId:followup?.job_id}), ...(detail ? { errorDetail: publicFailureDetail(detail) } : {}), stage: response.ok ? "completed" : "failed", progressMessage: response.ok ? "The operation finished." : failureProgressMessage(detail) };
    await finishDocumentJob(env, row, response.ok ? "completed" : "failed", terminalResult, response.ok ? null : detail?.message ?? String(body.error ?? "document_job_failed"), completedAt);
    if(!response.ok&&row.kind==="render_document"){
      const failed=await readJob(env,user.userId,row.job_id);
      if(failed?.status==="failed"){
        if(detail?.code==="local_persistence_failed")await releaseInterruptedAttempt(env,user,failed,"document_render_local_persistence_failure");
        else await settleInterruptedDocumentJobReservations(env,user,failed,{reason:"document_render_terminal_failure"});
      }
    }else if(!response.ok&&user.projectExecution&&row.kind!=="extract_reference"){
      const failed=await readJob(env,user.userId,row.job_id);
      if(failed?.status==="failed")await releaseInterruptedAttempt(env,user,failed,"project_document_job_terminal_failure");
    }
    await refreshGenerationReceipt(env,user,row,body,detail);
  } catch (error) {
    const completedAt = new Date().toISOString(); const detail = classifyDocumentJobFailure(error);
    const durableCheckpoint = parseResult(await readJob(env, user.userId, row.job_id) ?? row);
    await finishDocumentJob(env, row, "failed", { ...durableCheckpoint, errorDetail: publicFailureDetail(detail), stage: "failed", progressMessage: failureProgressMessage(detail) }, detail.message, completedAt);
    if(row.kind==="render_document"){
      const failed=await readJob(env,user.userId,row.job_id);
      if(failed?.status==="failed"){
        if(detail.code==="local_persistence_failed")await releaseInterruptedAttempt(env,user,failed,"document_render_local_persistence_failure");
        else await settleInterruptedDocumentJobReservations(env,user,failed,{reason:"document_render_execution_interrupted"});
      }
    }else if(user.projectExecution&&row.kind!=="extract_reference"){
      const failed=await readJob(env,user.userId,row.job_id);
      if(failed?.status==="failed")await releaseInterruptedAttempt(env,user,failed,"project_document_job_execution_interrupted");
    }
    await refreshGenerationReceipt(env,user,row,{},detail);
  }
  const finishedRow = await readJob(env, user.userId, jobId);
  if(finishedRow){
    await reconcileParentForChild(env,finishedRow);
    if(user.projectExecution)await synchronizeProjectScope(env,user.projectExecution);
  }
  return finishedRow;
}

async function documentJobPrincipal(env:WorkerEnv,row:DocumentJobRow,current:PilotUser):Promise<PilotUser|null>{
  const project=await env.DB.prepare("SELECT organization_id,project_access_id,project_id,owner_user_id,actor_user_id,EXISTS(SELECT 1 FROM events anchor WHERE anchor.event_id=resource.source_event_id AND anchor.stream_id='creative:'||resource.owner_user_id AND anchor.actor='user:'||resource.actor_user_id AND anchor.type='ProjectDocumentJobQueued' AND json_extract(anchor.payload,'$.job_id')=resource.resource_id AND json_extract(anchor.payload,'$.organization_id')=resource.organization_id AND json_extract(anchor.payload,'$.project_access_id')=resource.project_access_id) AS anchor_valid FROM project_resource_scopes resource WHERE resource_kind='job' AND resource_id=? AND actor_user_id=? AND owner_user_id=?")
    .bind(row.job_id,row.owner_id,row.stream_id.slice("creative:".length)).first<{organization_id:string;project_access_id:string;project_id:string;owner_user_id:string;actor_user_id:string;anchor_valid:number}>();
  if(project&&!project.anchor_valid)return null;
  if(project&&current.userId===row.owner_id&&current.projectExecution?.projectAccessId===project.project_access_id&&current.projectExecution.organizationId===project.organization_id)return current;
  if(!project&&current.userId===row.owner_id&&!current.projectExecution&&current.streamId===row.stream_id)return current;
  if(!project&&row.owner_id!==row.stream_id.slice("creative:".length))return null;
  const principal=await env.DB.prepare(PRINCIPAL_WITH_ACCESS_SQL).bind(row.owner_id).first<Record<string,unknown>>();
  if(!principal||principal.consent_version!==POLICY_VERSION)return null;
  const role=String(principal.role??"");if(!["admin","creator","agent","viewer"].includes(role))return null;
  if(!project&&role!=="admin"&&role!=="creator")return null;
  const actor:PilotUser={userId:String(principal.user_id),email:String(principal.email??""),displayName:String(principal.display_name??""),role:role as PilotUser["role"],consentVersion:String(principal.consent_version),consentedAt:principal.consented_at?String(principal.consented_at):null,streamId:row.stream_id,access:await principalAccessFromRow(principal,role),billingUserId:row.owner_id,...(project?{projectExecution:{organizationId:project.organization_id,projectAccessId:project.project_access_id,projectId:project.project_id,ownerUserId:project.owner_user_id,actorUserId:project.actor_user_id}}:{})};
  if(project&&(!hasCapability(actor,"project.output.request",{organizationId:project.organization_id,projectAccessId:project.project_access_id})||!await activeProjectExecution(env,actor,row.document_id,row.job_id)))return null;
  return actor;
}

async function driveDocumentQueue(env: WorkerEnv, user: PilotUser) {
  for (let count = 0; count < 50; count += 1) {
    const running = await env.DB.prepare("SELECT * FROM document_jobs WHERE stream_id=? AND kind!='prompt_fan' AND status IN ('running','committing') ORDER BY requested_at ASC,job_id ASC LIMIT 1").bind(user.streamId).first<DocumentJobRow>();
    if (running) {
      if (!rowIsStale(running)) return;
      const owner=await documentJobPrincipal(env,running,user);
      if(!owner){
        const scope=await env.DB.prepare("SELECT organization_id,project_access_id FROM project_resource_scopes WHERE resource_kind='job' AND resource_id=? AND actor_user_id=?").bind(running.job_id,running.owner_id).first<{organization_id:string;project_access_id:string}>();
        if(scope){await cancelProjectActorJobs(env,user,{organizationId:scope.organization_id,projectAccessId:scope.project_access_id,actorUserId:running.owner_id});continue;}
        return;
      }
      const recovered = await runDocumentJob(env, owner, running.job_id);
      if (!recovered || recovered.status === "queued" || recovered.status === "running" || recovered.status === "committing") return;
      continue;
    }
    const next = await env.DB.prepare("SELECT * FROM document_jobs WHERE stream_id=? AND kind!='prompt_fan' AND status='queued' ORDER BY requested_at ASC,job_id ASC LIMIT 1").bind(user.streamId).first<DocumentJobRow>();
    if (!next) return;
    const owner=await documentJobPrincipal(env,next,user);
    if(!owner){
      const scope=await env.DB.prepare("SELECT organization_id,project_access_id,source_event_id FROM project_resource_scopes WHERE resource_kind='job' AND resource_id=? AND actor_user_id=?").bind(next.job_id,next.owner_id).first<{organization_id:string;project_access_id:string;source_event_id:string|null}>();
      if(scope&&!scope.source_event_id)return;
      if(scope){await cancelProjectActorJobs(env,user,{organizationId:scope.organization_id,projectAccessId:scope.project_access_id,actorUserId:next.owner_id});continue;}
      return;
    }
    const job = await runDocumentJob(env, owner, next.job_id);
    if (!job || job.status === "queued" || job.status === "running") return;
  }
}

async function stopGenerationJob(env: WorkerEnv, user: PilotUser, target: DocumentJobRow, force: boolean) {
  if (target.kind !== "preview" && target.kind !== "generate" && target.kind !== "prompt_fan" && target.kind !== "render_document") return { error: "generation_job_required", status: 409 } as const;
  if (target.status === "committing") return { error: "job_finalizing", status: 409 } as const;
  if (documentJobTerminal(target)) return { job: target } as const;
  const request = parseRequest(target); const childIds = target.kind === "prompt_fan" && Array.isArray(request.childJobIds) ? request.childJobIds.map(String).filter(Boolean) : [];
  const children = (await Promise.all(childIds.map((id) => readJob(env, user.userId, id)))).filter((row): row is DocumentJobRow => Boolean(row));
  if (children.some((row) => row.status === "committing")) return { error: "job_finalizing", status: 409 } as const;
  const targets = target.kind === "prompt_fan" ? [...children, target] : [target]; const stopped: DocumentJobRow[] = [];
  for (const row of targets) {
    if (row.status !== "queued" && row.status !== "running") continue;
    const completedAt = new Date().toISOString();
    const errorDetail: DocumentJobError = { code: force ? "force_failed_by_admin" : "canceled_by_user", category: "canceled", scope: "request", action: "none", message: force ? "An administrator force-failed this generation." : "The user stopped this generation.", retryable: true, retryAfterMs: null, requestId: null, httpStatus: null };
    const result = { errorDetail, stage: force ? "failed" : "canceled", progressMessage: errorDetail.message };
    const updated = await env.DB.prepare("UPDATE document_jobs SET status=?,result_json=json_patch(COALESCE(result_json,'{}'),?),error_message=?,completed_at=?,lease_expires_at=NULL,notified_at=?,updated_at=? WHERE job_id=? AND owner_id=? AND correlation_id=? AND status IN ('queued','running')")
      .bind(force ? "failed" : "canceled", JSON.stringify(result), errorDetail.code, completedAt, force ? null : completedAt, completedAt, row.job_id, user.userId, row.correlation_id).run();
    if (Number(updated.meta.changes ?? 0) !== 1) continue;
    stopped.push(row);
    const reason=force?"generation_force_failed":"generation_canceled";
    const terminal=await readJob(env,user.userId,row.job_id);
    const checkpoint=parseResult(terminal??row);
    const sceneReceipts=Object.values(checkpoint.productionSceneReceipts&&typeof checkpoint.productionSceneReceipts==="object"?checkpoint.productionSceneReceipts as Record<string,Record<string,unknown>>:{});
    const frameReceipts=Object.values(checkpoint.productionFrameReceipts&&typeof checkpoint.productionFrameReceipts==="object"?checkpoint.productionFrameReceipts as Record<string,Record<string,unknown>>:{});
    const plannerUsage=checkpoint.plannerUsage&&typeof checkpoint.plannerUsage==="object"?checkpoint.plannerUsage as Record<string,unknown>:{};
    const hasIncurredWork=Boolean(checkpoint.providerJobId||checkpoint.productionAnchor||sceneReceipts.length||frameReceipts.length||Number(plannerUsage.totalTokens??0)>0);
    let released:Array<{id:string;tokens:number;operation:string}>=[];
    let receiptAwareSettlement=false;
    const correlated=await readCorrelatedEvents(env,user.streamId,[row.correlation_id]);
    const costReservationId=await restoreLegacyCostReservation(env,user,terminal??row,correlated);
    if(hasIncurredWork&&(checkpoint.reservationId||costReservationId)){
      if(terminal){
        const settlement=await settleInterruptedDocumentJobReservations(env,user,terminal,{costReservationId:costReservationId||undefined,reason});
        receiptAwareSettlement=settlement.settled;
        if(settlement.settled&&checkpoint.reservationId)released=[{id:String(checkpoint.reservationId),tokens:settlement.releasedTokens,operation:`document-render:${String(parseRequest(row).artifactKind??"unknown")}`}];
      }
    }else{
      released=await releaseBudgetReservationsForCorrelation(env,user,row.correlation_id,reason);
      if(!checkpoint.providerJobId&&!correlated.some((event)=>event.type==="GenerationUsageRecorded"))await releaseCostReservationsForCorrelation(env,user.billingUserId??user.userId,row.correlation_id,user.streamId);
    }
    const auditType = force ? "JobForceFailed" : "JobCanceled";
    try {
      await appendAuditEvent(env, user.streamId, "worker:scheduler", auditType, { job_id: row.job_id, document_id: row.document_id, kind: row.kind, previous_status: row.status, requested_by: user.userId, requested_by_role: user.role, released_reservation_count: released.length }, row.correlation_id);
      if(!receiptAwareSettlement)for(const reservation of released)await appendAuditEvent(env,user.streamId,"worker:policy","BudgetReleased",{reservation_id:reservation.id,reserved_tokens:reservation.tokens,reason,operation:reservation.operation,job_id:row.job_id,attempt:row.attempt_count},row.correlation_id);
    } catch (error) { console.error("document_job_stop_audit_failed", row.job_id, error instanceof Error ? error.message : "unknown"); }
  }
  return { job: await readJob(env, user.userId, target.job_id), stoppedCount: stopped.length } as const;
}

/** Revoke actor-owned project jobs without granting their private inputs to the operator. */
export async function cancelProjectActorJobs(env:WorkerEnv,operator:PilotUser,scope:{organizationId:string;projectAccessId?:string;actorUserId?:string;ownerUserId?:string}){
  const clauses=["resource.resource_kind='job'","resource.organization_id=?","job.status IN('queued','running')"];
  const bindings:string[]=[scope.organizationId];
  if(scope.projectAccessId){clauses.push("resource.project_access_id=?");bindings.push(scope.projectAccessId);}
  if(scope.actorUserId){clauses.push("resource.actor_user_id=?");bindings.push(scope.actorUserId);}
  if(scope.ownerUserId){clauses.push("resource.owner_user_id=?");bindings.push(scope.ownerUserId);}
  const jobs=await env.DB.prepare(`SELECT job.*,resource.project_access_id,resource.organization_id,resource.project_id,resource.owner_user_id FROM project_resource_scopes resource JOIN document_jobs job ON job.job_id=resource.resource_id AND job.owner_id=resource.actor_user_id AND job.stream_id='creative:'||resource.owner_user_id WHERE ${clauses.join(" AND ")} ORDER BY job.requested_at,job.job_id LIMIT 500`)
    .bind(...bindings).all<DocumentJobRow&{project_access_id:string;organization_id:string;project_id:string;owner_user_id:string}>();
  for(const row of jobs.results){
    const now=new Date().toISOString();
    const message="The project permission required for this operation was revoked.";
    const result={errorDetail:{code:"project_access_revoked",category:"canceled",scope:"request",action:"none",message,retryable:false,retryAfterMs:null,requestId:null,httpStatus:null},stage:"canceled",progressMessage:message};
    const changed=await env.DB.prepare("UPDATE document_jobs SET status='canceled',result_json=json_patch(COALESCE(result_json,'{}'),?),error_message='project_access_revoked',completed_at=?,lease_expires_at=NULL,notified_at=?,updated_at=? WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND status IN('queued','running')")
      .bind(JSON.stringify(result),now,now,now,row.job_id,row.owner_id,row.stream_id,row.correlation_id).run();
    if(Number(changed.meta.changes??0)!==1)continue;
    const actor:PilotUser={...operator,userId:row.owner_id,billingUserId:row.owner_id,streamId:row.stream_id,projectExecution:{organizationId:row.organization_id,projectAccessId:row.project_access_id,projectId:row.project_id,ownerUserId:row.owner_user_id,actorUserId:row.owner_id}};
    await releaseInterruptedAttempt(env,actor,row,"project_access_revoked");
    await reconcileParentForChild(env,row);
  }
}

export async function handleDocumentJobs(request: Request, env: WorkerEnv, path = "", context?: WorkerExecutionContext) {
  await ensureSchema(env);
  const scoped=/(?:^|;\s*)forma_project_context=/.test(request.headers.get("cookie")??"");
  const auth=await requireUser(request,env,scoped?"viewer":request.method==="GET"?"viewer":"creator",scoped?{account:"principal"}:{});
  if(auth.response||!auth.user)return auth.response!;
  const principal=auth.user,selected=scoped?await readProjectRequestContext(request,env,principal):{context:null,response:null};
  if(selected.response)return selected.response;
  const project=selected.context;
  if(project&&!hasCapability(principal,"project.output.request",{organizationId:project.organizationId,projectAccessId:project.projectAccessId}))return Response.json({error:"project_read_only"},{status:403});
  const user:PilotUser=project?{...principal,streamId:`creative:${project.ownerUserId}`,projectExecution:{organizationId:project.organizationId,projectAccessId:project.projectAccessId,projectId:project.projectId,ownerUserId:project.ownerUserId,actorUserId:principal.userId}}:principal;
  if(!project&&path){
    const targetId=decodeURIComponent(path.replace(/\/(?:cancel|force-fail|ack|dismiss|retry|run)$/,""));
    const personal=await env.DB.prepare(`SELECT 1 AS present FROM document_jobs job WHERE job.job_id=? AND job.owner_id=? AND job.stream_id=?
      AND NOT EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='job' AND resource.resource_id=job.job_id)`)
      .bind(targetId,user.userId,user.streamId).first();
    if(!personal)return Response.json({error:"job_not_found"},{status:404,headers:{"cache-control":"private, no-store"}});
  }
  if(project&&request.method!=="GET"){const consent=requireConsent(principal);if(consent)return consent;}
  const privateReceiptPath=project&&request.method==="GET"?path.match(/^([^/]+)\/private-receipt$/):null;
  if(project&&privateReceiptPath){
    const jobId=decodeURIComponent(privateReceiptPath[1]!);
    const row=await readJob(env,principal.userId,jobId);
    const now=new Date().toISOString();
    const notFound=()=>Response.json({error:"job_not_found"},{status:404,headers:{"cache-control":"private, no-store"}});
    if(!row||row.kind!=="render_document"||row.owner_id!==principal.userId||row.stream_id!==user.streamId||(!["queued","running","committing"].includes(row.status)&&row.expires_at<=now))return notFound();
    const receipt=parseResult(row).generationReceipt;
    if(!receipt||typeof receipt!=="object"||Array.isArray(receipt))return notFound();
    const reference=(receipt as Record<string,unknown>).input_ref;
    if(typeof reference!=="string"||!reference.trim())return notFound();
    const retained=await env.DB.prepare(`SELECT content.content_id,content.content FROM private_content content
      JOIN project_resource_scopes receipt ON receipt.resource_kind='content' AND receipt.resource_id=content.content_id
        AND receipt.visibility='actor_private' AND receipt.project_access_id=? AND receipt.organization_id=? AND receipt.project_id=?
        AND receipt.owner_user_id=? AND receipt.actor_user_id=?
      JOIN private_content_retention_scopes retention ON retention.content_id=content.content_id
        AND retention.organization_id=receipt.organization_id AND retention.project_access_id=receipt.project_access_id
        AND retention.project_id=receipt.project_id AND retention.actor_user_id=receipt.actor_user_id AND retention.classification='governed-evidence'
      JOIN project_resource_scopes resource ON resource.resource_kind='job' AND resource.resource_id=?
        AND resource.project_access_id=receipt.project_access_id AND resource.organization_id=receipt.organization_id
        AND resource.project_id=receipt.project_id AND resource.owner_user_id=receipt.owner_user_id AND resource.actor_user_id=receipt.actor_user_id
      JOIN events anchor ON anchor.event_id=resource.source_event_id AND anchor.stream_id=? AND anchor.actor='user:'||resource.actor_user_id
        AND anchor.type='ProjectDocumentJobQueued' AND json_extract(anchor.payload,'$.job_id')=resource.resource_id
        AND json_extract(anchor.payload,'$.organization_id')=resource.organization_id
        AND json_extract(anchor.payload,'$.project_access_id')=resource.project_access_id
        AND json_extract(anchor.payload,'$.actor_user_id')=resource.actor_user_id
      JOIN project_context_sessions selection ON selection.context_id=? AND selection.principal_user_id=?
        AND selection.organization_id=receipt.organization_id AND selection.project_access_id=receipt.project_access_id
        AND selection.revoked_at IS NULL AND selection.expires_at>?
      WHERE content.content_id=? AND content.owner_id=? AND content.kind='document-artifact-input'
        AND content.redacted_at IS NULL AND content.expires_at>? AND json_valid(content.content)=1
        AND json_extract(content.content,'$.job_id')=? AND json_extract(content.content,'$.document_id')=?
        AND ${activeProjectExecutionSql}`)
      .bind(project.projectAccessId,project.organizationId,project.projectId,project.ownerUserId,principal.userId,
        jobId,user.streamId,project.contextId,principal.userId,now,reference,principal.userId,now,jobId,row.document_id,
        ...projectExecutionBindings(user.projectExecution!,row.document_id)).first<{content_id:string;content:string}>();
    if(!retained||retained.content_id!==reference)return notFound();
    const safe=safeScopedJob(row);
    return Response.json({job:{...safe,result:{...(safe.result??{}),generationReceipt:receipt}},content:{[reference]:retained.content}},{headers:{"cache-control":"private, no-store"}});
  }
  if(project&&request.method==="GET"){
    const now=new Date().toISOString(),query=new URL(request.url).searchParams,activeOnly=query.get("scope")==="active",document=query.get("document")?.trim().slice(0,160)??"";
    const requestedId=path?decodeURIComponent(path):"";
    const rows=await env.DB.prepare(`SELECT job.job_id,job.owner_id,job.stream_id,job.document_id,job.kind,job.status,job.source_surface,job.correlation_id,job.requested_sequence,
      json_object('documentRevision',json_extract(job.request_json,'$.documentRevision'),'requestKey',json_extract(job.request_json,'$.requestKey'),
        'sourcePreviewId',json_extract(job.request_json,'$.sourcePreviewId'),'promptTechnique',json_extract(job.request_json,'$.promptTechnique'),
        'promptFanId',json_extract(job.request_json,'$.promptFanId'),'parentJobId',json_extract(job.request_json,'$.parentJobId'),
        'fanKind',json_extract(job.request_json,'$.fanKind'),'artifactKind',json_extract(job.request_json,'$.artifactKind'),'productionMode',json_extract(job.request_json,'$.productionMode')) AS request_json,
      json_remove(job.result_json,'$.plannerInput','$.videoInputReceipt','$.artifactPlan','$.productionPlan','$.productionSceneReceipts','$.productionFrameReceipts','$.productionAnchor','$.providerStatusUrl','$.providerResponseUrl','$.providerCancelUrl','$.moderationPromptRef','$.intentRef','$.providerJobId','$.generationReceipt','$.generation_receipt','$.input_ref','$.inputRef','$.source_snapshot_sha256') AS result_json,
      job.error_message,job.attempt_count,job.requested_at,job.started_at,job.completed_at,job.lease_expires_at,job.notified_at,job.expires_at,job.updated_at
      FROM document_jobs job JOIN project_resource_scopes resource ON resource.resource_kind='job'
      AND resource.resource_id=job.job_id AND resource.actor_user_id=job.owner_id AND resource.owner_user_id=?
      JOIN project_resource_scopes document_scope ON document_scope.project_access_id=resource.project_access_id AND document_scope.organization_id=resource.organization_id
        AND document_scope.project_id=resource.project_id AND document_scope.owner_user_id=resource.owner_user_id
        AND document_scope.resource_kind='document' AND document_scope.resource_id=job.document_id
      WHERE job.owner_id=? AND job.stream_id=? AND resource.project_access_id=? AND resource.organization_id=? AND resource.project_id=?
        AND (?='' OR job.job_id=?) AND (?=0 OR job.status IN('queued','running','committing') OR job.notified_at IS NULL)
        AND (?='' OR job.status IN('queued','running','committing') OR job.notified_at IS NULL OR job.document_id=?)
        AND (job.status IN('queued','running','committing') OR job.expires_at>?)
      ORDER BY CASE WHEN job.status IN('queued','running','committing') THEN 0 ELSE 1 END,job.requested_at DESC LIMIT 120`)
      .bind(project.ownerUserId,principal.userId,user.streamId,project.projectAccessId,project.organizationId,project.projectId,requestedId,requestedId,Number(activeOnly),document,document,now).all<DocumentJobRow>();
    if(path&&!rows.results.length)return Response.json({error:"job_not_found"},{status:404});
    return Response.json(path?{job:safeScopedJob(rows.results[0]!)}:{jobs:rows.results.map((row)=>safeScopedJob(row))},{headers:{"cache-control":"private, no-store"}});
  }
  if(project&&path){
    const targetId=decodeURIComponent(path.replace(/\/(?:cancel|force-fail|ack|dismiss|retry|run)$/,""));
    const target=await readJob(env,user.userId,targetId);
    if(!target||!await activeProjectExecution(env,user,target.document_id,targetId))return Response.json({error:"job_not_found"},{status:404});
  }
  type DocumentJobAdmission={kind?:string;documentId?:string;sourceSurface?:string;payload?:Record<string,unknown>};let submittedInput:DocumentJobAdmission|null=null;
  if(request.method==="POST"&&!path){const consent=requireConsent(user);if(consent)return consent;submittedInput=await request.json() as DocumentJobAdmission;const payload=submittedInput.payload;if(submittedInput.kind==="render_document"&&(payload?.artifactKind==="storyboard"||payload?.artifactKind==="video")&&payload.paidMediaConfirmed!==true)return Response.json({error:"paid_media_confirmation_required",message:"Confirm paid media generation before starting this render."},{status:428});}
  if(request.method==="POST"&&path.endsWith("/retry")){const target=await readJob(env,user.userId,decodeURIComponent(path.slice(0,-6).replace(/\/$/,"")));if(target?.kind==="render_document"){const payload=parseRequest(target);if((payload.artifactKind==="storyboard"||payload.artifactKind==="video")&&payload.paidMediaConfirmed!==true)return Response.json({error:"paid_media_confirmation_required",message:"Confirm paid media generation before recovering this render."},{status:428});}}
  const now = new Date().toISOString();
  // Neither passive polling nor an unauthorized paid request may reconcile or
  // rewrite account history. Maintenance starts only after financial admission.
  if(request.method!=="GET"&&path.endsWith("/retry")&&!project){
    await reconcileFailedBudgetReservations(env,user);
    await env.DB.prepare(`UPDATE document_jobs SET request_json='{}',result_json=NULL,updated_at=? WHERE owner_id=? AND stream_id=? AND expires_at<=? AND (request_json!='{}' OR result_json IS NOT NULL)
      AND NOT EXISTS(SELECT 1 FROM project_resource_scopes resource JOIN organization_retention_policies policy ON policy.organization_id=resource.organization_id AND policy.legal_hold=1
        WHERE (resource.resource_kind='job' AND resource.resource_id=document_jobs.job_id)
          OR (resource.resource_kind='document' AND resource.resource_id=document_jobs.document_id AND resource.owner_user_id=document_jobs.owner_id))`).bind(now,user.userId,user.streamId,now).run();
  }

  if ((path.endsWith("/cancel") || path.endsWith("/force-fail")) && request.method === "POST") {
    const force = path.endsWith("/force-fail");
    if (force && user.role !== "admin") return Response.json({ error: "admin_required" }, { status: 403 });
    const suffixLength = force ? 11 : 7; const jobId = decodeURIComponent(path.slice(0, -suffixLength).replace(/\/$/, ""));
    const target = await readJob(env, user.userId, jobId); if (!target) return Response.json({ error: "job_not_found" }, { status: 404 });
    const stopped = await stopGenerationJob(env, user, target, force);
    if ("error" in stopped) return Response.json({ error: stopped.error }, { status: stopped.status });
    if (!stopped.job) return Response.json({ error: "job_not_found" }, { status: 404 });
    context?.waitUntil(driveDocumentQueue(env, user));
    return Response.json({ job:project?safeScopedJob(stopped.job):serializeJob(stopped.job), stoppedCount: stopped.stoppedCount ?? 0 });
  }

  if (path.endsWith("/ack") && request.method === "POST") {
    const jobId = decodeURIComponent(path.slice(0, -4).replace(/\/$/, ""));
    const target = await readJob(env, user.userId, jobId); if (!target) return Response.json({ error: "job_not_found" }, { status: 404 });
    const request = parseRequest(target); const childIds = target.kind === "prompt_fan" && Array.isArray(request.childJobIds) ? request.childJobIds.map(String).filter(Boolean) : [];
    const statements = [jobId, ...childIds].map((id) => env.DB.prepare("UPDATE document_jobs SET notified_at=COALESCE(notified_at,?),updated_at=? WHERE job_id=? AND owner_id=?").bind(now, now, id, user.userId));
    const results = await env.DB.batch(statements); const result = results[0];
    return Number(result.meta.changes ?? 0) === 1 ? Response.json({ ok: true }) : Response.json({ error: "job_not_found" }, { status: 404 });
  }

  if (path.endsWith("/dismiss") && request.method === "POST") {
    const jobId = decodeURIComponent(path.slice(0, -8).replace(/\/$/, ""));
    const target = await readJob(env, user.userId, jobId);
    if (!target) return Response.json({ error: "job_not_found" }, { status: 404 });
    if (target.status !== "failed" && target.status !== "partial") return Response.json({ error: "terminal_failure_required" }, { status: 409 });
    const previousResult = parseResult(target);
    const result = { ...previousResult, dismissedAt: previousResult.dismissedAt ?? now };
    await env.DB.prepare("UPDATE document_jobs SET result_json=?,updated_at=? WHERE job_id=? AND owner_id=?").bind(JSON.stringify(result), now, jobId, user.userId).run();
    const updated = await readJob(env, user.userId, jobId);
    return Response.json({ job:project?safeScopedJob(updated!):serializeJob(updated!) });
  }

  if (path.endsWith("/retry") && request.method === "POST") {
    const jobId = decodeURIComponent(path.slice(0, -6).replace(/\/$/, "")); const target = await readJob(env, user.userId, jobId);
    if (!target) return Response.json({ error: "job_not_found" }, { status: 404 });
    const previous=parseResult(target);
    const billingOwnerId=user.billingUserId??user.userId;
    const previousCostReservationId=String(previous.costReservationId??"");
    const previousCostReservation=previousCostReservationId?await costBudgetReservation(env,billingOwnerId,previousCostReservationId):null;
    const previousAttemptCorrelation=target.attempt_count>1?`${jobId}:attempt:${target.attempt_count-1}`:"";
    const correlations=[...new Set([target.correlation_id,previousCostReservation?.correlation_id??"",previousAttemptCorrelation].filter(Boolean))];
    const retainedEvents=await readCorrelatedEvents(env,user.streamId,correlations);
    const currentEvents=retainedEvents.filter((event)=>event.correlationId === target.correlation_id);
    const correlated=[...currentEvents,...retainedEvents.filter((event)=>event.correlationId!==target.correlation_id)];
    const failure=errorDetailFromResult(previous)??correlatedFailureDetail(correlated);
    const failedEvent = [...correlated].reverse().find((event) => event.type === "DocumentRenderFailed" && event.payload.provider_job_id);
    const requestedEvent = correlated.find((event) => event.type === "DocumentRenderRequested");
    const providerJobId = String(previous.providerJobId ?? failedEvent?.payload.provider_job_id ?? "");
    const artifactId = String(previous.artifactId ?? failedEvent?.payload.artifact_id ?? requestedEvent?.payload.artifact_id ?? "");
    const requestPayload = parseRequest(target); const artifactKind = String(requestPayload.artifactKind ?? failedEvent?.payload.artifact_kind ?? "");
    if((artifactKind==="storyboard"||artifactKind==="video")&&requestPayload.paidMediaConfirmed!==true)return Response.json({error:"paid_media_confirmation_required",message:"Confirm paid media generation before recovering this render."},{status:428});
    const sceneReceipts=previous.productionSceneReceipts&&typeof previous.productionSceneReceipts==="object"?Object.values(previous.productionSceneReceipts as Record<string,Record<string,unknown>>):[];
    const prepaidSceneIds=sceneReceipts.filter((scene)=>Boolean(scene.providerJobId)&&(scene.status==="submitted"||scene.status==="completed")).map((scene)=>String(scene.sceneId)).filter(Boolean);
    const managedRecovery=prepaidSceneIds.length>0;
    if(!documentJobCanRecoverProviderRender({...serializeJob(target),result:{...previous,providerJobId,artifactKind,recoverableProductionProviderRequest:managedRecovery},errorDetail:failure}))return Response.json({error:"provider_job_not_retryable",message:"This provider request reached a terminal failure and cannot be resumed. Review the saved inputs and start a changed render.",...(failure?{errorDetail:publicFailureDetail({...failure,probe:failure.probe??undefined})}:{})},{status:409});
    if (target.kind !== "render_document" || target.status !== "failed" || (!providerJobId&&!managedRecovery) || !artifactId) return Response.json({ error: "resumable_provider_job_required" }, { status: 409 });
    const accountingCheckpoint=!managedRecovery&&providerJobId?{...previous,providerJobId}:previous;
    const documentedUsage=interruptedDocumentJobUsage(accountingCheckpoint,requestPayload,{plannerAlreadyRecorded:true});
    const documentedProviderCost=documentedUsage.sceneCostMicrousd+documentedUsage.anchorCostMicrousd+documentedUsage.singleVideoCostMicrousd;
    const fullPlannerCost=interruptedDocumentJobUsage(accountingCheckpoint,requestPayload).plannerCostMicrousd;
    const plannerResponseId=String(accountingCheckpoint.plannerResponseId??"");
    const plannerReceiptRows=plannerResponseId?await env.DB.prepare("SELECT payload FROM events WHERE stream_id=? AND type='GenerationUsageRecorded' AND json_extract(payload,'$.planner_response_id')=? AND COALESCE(json_extract(payload,'$.cost_reservation_id'),'')<>'' AND json_extract(payload,'$.cost_reservation_id')<>?")
      .bind(user.streamId,plannerResponseId,previousCostReservationId).all<{payload:string}>():{results:[]};
    const verifiedPlannerReceipts=[] as Array<{payload:Record<string,unknown>}>;
    for(const receipt of plannerReceiptRows.results){
      let payload:Record<string,unknown>;
      try{payload=JSON.parse(receipt.payload) as Record<string,unknown>;}catch{continue;}
      const reservation=await costBudgetReservation(env,billingOwnerId,String(payload.cost_reservation_id??""));
      if(reservation&&reservation.status==="settled"&&reservation.stream_id===user.streamId&&reservation.operation===`document-render:${artifactKind}`
        &&(reservation.correlation_id===jobId||reservation.correlation_id===target.correlation_id||reservation.correlation_id.startsWith(`${jobId}:attempt:`)))verifiedPlannerReceipts.push({payload});
    }
    const outsidePlannerCost=Math.min(fullPlannerCost,recordedDocumentPlannerUsage(verifiedPlannerReceipts,plannerResponseId,fullPlannerCost).recordedCostMicrousd);
    const requiredProviderCoverage=documentedProviderCost+Math.max(0,fullPlannerCost-outsidePlannerCost);
    const ownedPreviousCostReservation=previousCostReservation
      &&previousCostReservation.stream_id===user.streamId
      &&previousCostReservation.operation===`document-render:${artifactKind}`
      &&(previousCostReservation.correlation_id===target.correlation_id||previousCostReservation.correlation_id.startsWith(`${jobId}:attempt:`))
      &&(!previous.costReservationPeriod||previousCostReservation.period===String(previous.costReservationPeriod))
      ?previousCostReservation:null;
    let newlyPrepaidProviderCost=0;
    let paidProviderWorkSettled=false;
    let accountedReservationCost=0;
    if(ownedPreviousCostReservation&&(ownedPreviousCostReservation.status==="active"||ownedPreviousCostReservation.status==="executing")){
      const settlement=await settleInterruptedDocumentJobReservations(env,user,{...target,result_json:JSON.stringify(accountingCheckpoint)},{costReservationId:previousCostReservationId,reason:"document_render_manual_recovery"});
      accountedReservationCost=settlement.settled?settlement.usedMicrousd:0;
      paidProviderWorkSettled=settlement.settled&&documentedProviderCost>0&&settlement.usedMicrousd>=requiredProviderCoverage;
    }else if(ownedPreviousCostReservation?.status==="settled"){
      accountedReservationCost=Number(ownedPreviousCostReservation.used_microusd??0);
      paidProviderWorkSettled=documentedProviderCost>0&&accountedReservationCost>=requiredProviderCoverage;
    }
    const accountedProviderCost=Math.max(0,accountedReservationCost-Math.max(0,fullPlannerCost-outsidePlannerCost));
    if(accountedProviderCost>0&&accountedProviderCost<documentedProviderCost)return Response.json({
      error:"provider_charge_settlement_incomplete",
      message:"This provider request was only partially settled. Recovering it would charge the same provider work twice.",
      accountedProviderCostMicrousd:accountedProviderCost,
      documentedProviderCostMicrousd:documentedProviderCost,
    },{status:409});
    if(paidProviderWorkSettled&&!managedRecovery)newlyPrepaidProviderCost=documentedUsage.singleVideoCostMicrousd;
    const retainedPrepaidSceneIds=Array.isArray(previous.productionPrepaidSceneIds)?previous.productionPrepaidSceneIds.map(String):[];
    const confirmedPrepaidSceneIds=[...new Set([...retainedPrepaidSceneIds,...(paidProviderWorkSettled?prepaidSceneIds:[])])];
    const providerModel = String(previous.providerModel ?? (artifactKind === "video" ? env.FAL_REFERENCE_VIDEO_MODEL ?? DEFAULT_REFERENCE_VIDEO_MODEL : ""));
    const result:Record<string,unknown> = { ...previous, artifactId, ...(managedRecovery?{...(confirmedPrepaidSceneIds.length?{productionPrepaidSceneIds:confirmedPrepaidSceneIds}:{}),...(paidProviderWorkSettled&&previous.productionAnchor?{productionPrepaidAnchor:true}:{}),recoverableProductionProviderRequest:true}:{providerJobId,providerModel}),...(newlyPrepaidProviderCost?{prepaidProviderCostMicrousd:Number(previous.prepaidProviderCostMicrousd??0)+newlyPrepaidProviderCost}:{}), stage: "queued", progressMessage: managedRecovery?"Recovering saved production scenes without submitting already-paid Fal requests again.":"Recovering the saved Fal render without submitting a second paid video." };delete result.errorDetail;delete result.dismissedAt;delete result.reservationId;delete result.costReservationMicrousd;delete result.costReservationId;delete result.costReservationPeriod;
    const updated = await env.DB.prepare("UPDATE document_jobs SET status='queued',correlation_id=?,result_json=?,error_message=NULL,completed_at=NULL,lease_expires_at=NULL,notified_at=NULL,updated_at=? WHERE job_id=? AND owner_id=? AND status='failed'").bind(jobId, JSON.stringify(result), now, jobId, user.userId).run();
    if (Number(updated.meta.changes ?? 0) !== 1) return Response.json({ error: "job_retry_conflict" }, { status: 409 });
    const queued=await readJob(env,user.userId,jobId);context?.waitUntil(driveDocumentQueue(env,user));return Response.json({job:project?safeScopedJob(queued!):serializeJob(queued!),reusedProviderRequest:true},{status:202});
  }

  if (path.endsWith("/run") && request.method === "POST") {
    const consent = requireConsent(user); if (consent) return consent;
    const jobId = decodeURIComponent(path.slice(0, -4).replace(/\/$/, "")); const existing = await readJob(env, user.userId, jobId);
    if (!existing) return Response.json({ error: "job_not_found" }, { status: 404 });
    if (existing.kind === "prompt_fan") {
      const job = await reconcilePromptFanParent(env, user.userId, jobId); if (!job) return Response.json({ error: "job_not_found" }, { status: 404 });
      context?.waitUntil(driveDocumentQueue(env, user));
      return Response.json({ job:project?safeScopedJob(job):serializeJob(job) }, { status: documentJobTerminal({ status: job.status }) ? 200 : 202 });
    }
    if (context) {
      context.waitUntil(driveDocumentQueue(env, user));
      return Response.json({ job:project?safeScopedJob(existing):serializeJob(existing), accepted: true }, { status: 202 });
    }
    const job = await runDocumentJob(env, user, jobId); if (!job) return Response.json({ error: "job_not_found" }, { status: 404 });
    return Response.json({ job:project?safeScopedJob(job):serializeJob(job) }, { status: documentJobTerminal({ status: job.status }) ? 200 : 202 });
  }

  if (request.method === "GET") {
    const requestedJob = path ? await readJob(env, user.userId, decodeURIComponent(path)) : null;
    if(path&&requestedJob&&documentJobTerminal(requestedJob)&&Date.parse(requestedJob.expires_at)<=Date.now())return Response.json({error:"job_not_found"},{status:404});
    const query = new URL(request.url).searchParams;
    const activeOnly = query.get("scope") === "active";
    const documentScope = query.get("document")?.trim().slice(0, 160) ?? "";
    // Failure checkpoints remain durable, but large provider/planner inputs
    // belong to the explicitly requested detail view, not every idle poll.
    const readVisibleJobs = () => env.DB.prepare(`SELECT job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,
      CASE WHEN json_extract(request_json,'$.documentRevision') IS NULL THEN request_json ELSE json_object(
        'documentRevision',json_extract(request_json,'$.documentRevision'),'requestKey',json_extract(request_json,'$.requestKey'),
        'sourcePreviewId',json_extract(request_json,'$.sourcePreviewId'),'promptTechnique',json_extract(request_json,'$.promptTechnique'),
        'promptFanId',json_extract(request_json,'$.promptFanId'),'parentJobId',json_extract(request_json,'$.parentJobId'),
        'fanKind',json_extract(request_json,'$.fanKind'),'artifactKind',json_extract(request_json,'$.artifactKind'),'productionMode',json_extract(request_json,'$.productionMode')
      ) END AS request_json,
      json_remove(result_json,'$.plannerInput','$.videoInputReceipt','$.artifactPlan','$.productionPlan','$.productionSceneReceipts','$.productionAnchor') AS result_json,
      error_message,attempt_count,requested_at,started_at,completed_at,lease_expires_at,notified_at,expires_at,updated_at
      FROM document_jobs WHERE owner_id=? AND stream_id=? AND NOT EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='job' AND resource.resource_id=document_jobs.job_id) AND (status IN ('queued','running','committing') OR (notified_at IS NULL AND expires_at>?) OR (kind IN ('preview','generate','prompt_fan','render_document') AND status IN ('failed','partial') AND expires_at>?))
      AND (?=0 OR status IN ('queued','running','committing') OR notified_at IS NULL)
      AND (?='' OR status IN ('queued','running','committing') OR notified_at IS NULL OR document_id=?)
      ORDER BY CASE WHEN status IN ('queued','running','committing') THEN 0 ELSE 1 END,requested_at DESC LIMIT 120`).bind(user.userId,user.streamId,now,now,Number(activeOnly),documentScope,documentScope).all<DocumentJobRow>();
    let rows = path ? requestedJob ? [requestedJob] : [] : (await readVisibleJobs()).results;
    let reconciled = false;
    const repairCandidates = rows.filter((row) => row.status === "failed" && /Wrong number of parameter bindings/i.test(row.error_message ?? ""));
    if (repairCandidates.length) {
      const events = await readCorrelatedEvents(env,user.streamId,repairCandidates.map((row)=>row.correlation_id));
      for (const row of repairCandidates) {
        if(!operationFinished(events,row))continue;
        const retained = path ? row : await readJob(env, user.userId, row.job_id);
        if (retained && await repairMisreportedTerminalJob(env, retained, events)) reconciled = true;
      }
    }
    const parents = rows.filter((row) => row.kind === "prompt_fan" && ["queued","running","committing"].includes(row.status));
    for(const parent of parents){const updated=await reconcilePromptFanParent(env,user.userId,parent.job_id);if(!updated||updated.status!==parent.status||updated.result_json!==parent.result_json||updated.error_message!==parent.error_message||updated.completed_at!==parent.completed_at)reconciled=true;}
    for (const row of rows) if (rowIsStale(row) && row.attempt_count >= documentJobMaxAttempts(row.kind)) {
      // A compact list row must never replace the retained recovery checkpoint.
      const retained = path ? row : await readJob(env, user.userId, row.job_id);
      if (retained && rowIsStale(retained) && retained.attempt_count >= documentJobMaxAttempts(retained.kind)) {
        await failStaleJob(env, user, retained);
        reconciled = true;
      }
    }
    if (reconciled) {
      const refreshed = path ? await readJob(env, user.userId, decodeURIComponent(path)) : null;
      rows = path ? refreshed ? [refreshed] : [] : (await readVisibleJobs()).results;
    }
    const visibleBlocker = [...rows].filter((row)=>row.kind!=="prompt_fan"&&["running","committing"].includes(row.status)).sort((left,right)=>left.requested_at.localeCompare(right.requested_at)||left.job_id.localeCompare(right.job_id))[0]??null;
    const activeBlocker = path
      ? await env.DB.prepare("SELECT * FROM document_jobs WHERE owner_id=? AND stream_id=? AND kind!='prompt_fan' AND status IN ('running','committing') ORDER BY requested_at ASC,job_id ASC LIMIT 1").bind(user.userId, user.streamId).first<DocumentJobRow>()
      : visibleBlocker;
    const recoveryBlocker = activeBlocker && rowIsStale(activeBlocker) ? activeBlocker : null;
    if (recoveryBlocker) context?.waitUntil(driveDocumentQueue(env, user));
    if (path && !rows.length) return Response.json({ error: "job_not_found" }, { status: 404 });
    return Response.json(path ? { job: serializeJob(rows[0], recoveryBlocker) } : { jobs: rows.map((row) => serializeJob(row, recoveryBlocker, false)) });
  }

  if (path || request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const consent = requireConsent(user); if (consent) return consent;
  const input = submittedInput??await request.json() as DocumentJobAdmission;
  if (!KINDS.has(input.kind as DocumentJobKind)) return Response.json({ error: "unsupported_document_job" }, { status: 400 });
  const kind = input.kind as DocumentJobKind; const payload = input.payload && typeof input.payload === "object" ? { ...input.payload } : {};
  if(kind==="render_document"&&(payload.artifactKind==="storyboard"||payload.artifactKind==="video")&&payload.paidMediaConfirmed!==true)return Response.json({error:"paid_media_confirmation_required",message:"Confirm paid media generation before starting this render."},{status:428});
  if (kind !== "extract_reference" && !env.OPENAI_API_KEY) return Response.json({ error: "provider_not_configured" }, { status: 503 });
  if (JSON.stringify(payload).length > MAX_PAYLOAD_BYTES) return Response.json({ error: "document_job_payload_too_large" }, { status: 413 });
  if(kind==="render_document"&&payload.artifactKind==="slides"){
    if(presentationServerOwnedCheckpointField(payload))return Response.json({error:"presentation_recovery_state_server_owned",message:"Presentation recovery, provider receipts, and budget reservations can only come from an existing server-owned job checkpoint."},{status:400});
    const maximum=payload.productionMode==="managed"?MAX_MANAGED_PRESENTATION_SLIDES:12;
    const supplied=[payload.itemCount,payload.requestedSlideCount].filter((value)=>value!==undefined);
    if(supplied.some((value)=>typeof value!=="number"||!Number.isSafeInteger(value)||value<1||value>maximum))return Response.json({error:"presentation_slide_count_invalid",message:`${payload.productionMode==="managed"?"Managed":"Manual"} presentations support between 1 and ${maximum} slides.`,supported:{minimum:1,maximum}},{status:400});
    if(supplied.length===2&&supplied[0]!==supplied[1])return Response.json({error:"presentation_slide_count_conflict",message:"The requested slide count must match the presentation item count."},{status:409});
    if(payload.itemCount===undefined&&payload.requestedSlideCount!==undefined)payload.itemCount=payload.requestedSlideCount;
  }
  if(project&&(!input.documentId||!await activeProjectExecution(env,user,String(input.documentId))))return Response.json({error:"document_not_found"},{status:404});
  const events=project?await readProjectSourceEvents(env,project):await readWorkspaceEvents(env,user.streamId);
  const projection=foldEvents(events,Number.POSITIVE_INFINITY,input.documentId,project?.projectId??"");
  const documentId = String(input.documentId ?? projection.documentId); const documentRecord = projection.documents.find((document) => document.id === documentId);
  if (!documentRecord) return Response.json({ error: "document_not_found" }, { status: 404 });
  if(project&&documentRecord.projectId!==project.projectId)return Response.json({error:"document_not_found"},{status:404});
  if(kind==="preview"||kind==="generate"||kind==="prompt_fan"||kind==="render_document"){
    try{
      const trusted=authoritativeCreativeContext(events,{
        documentId,
        projectId:project?.projectId??documentRecord.projectId,
        canvasId:typeof payload.canvasId==="string"?payload.canvasId:undefined,
        contextSetId:typeof payload.contextSetId==="string"?payload.contextSetId:undefined,
        snapshot:payload.snapshot&&typeof payload.snapshot==="object"&&!Array.isArray(payload.snapshot)?payload.snapshot as Record<string,unknown>:undefined,
        sourceBlockVersions:Array.isArray(payload.sourceBlockVersions)?payload.sourceBlockVersions as Array<Record<string,unknown>>:undefined,
      });
      payload.snapshot=trusted.snapshot;
      payload.sourceBlockVersions=trusted.sourceBlockVersions;
      payload.documentRevision=trusted.documentRevision;
      if(kind==="render_document"&&payload.artifactKind==="slides"){
        const outline=inferPresentationSourceOutline(trusted.snapshot);
        if(payload.productionMode==="managed"&&Number(outline.authoredSlideCount??0)>MAX_MANAGED_PRESENTATION_SLIDES)return Response.json({error:"presentation_slide_count_invalid",message:`The authored outline contains more than the ${MAX_MANAGED_PRESENTATION_SLIDES}-slide managed presentation limit.`,supported:{minimum:1,maximum:MAX_MANAGED_PRESENTATION_SLIDES}},{status:400});
        payload.authoredSlideCount=outline.authoredSlideCount;
      }
    }catch(error){
      if(error instanceof ContextIntegrityError)return Response.json({error:error.code,message:error.message},{status:error.code==="document_not_found"?404:409});
      throw error;
    }
  }
  if(project&&kind==="extract_reference"){
    const blockId=String(payload.blockId??""),referenceId=String(payload.referenceId??"");
    const governed=await env.DB.prepare(`SELECT 1 AS protected FROM project_context_package_members member
      JOIN project_context_package_bindings binding ON binding.binding_id=member.binding_id
        AND binding.organization_id=member.organization_id AND binding.status='active'
      WHERE binding.project_access_id=? AND binding.organization_id=? AND member.target_block_id=? LIMIT 1`)
      .bind(project.projectAccessId,project.organizationId,blockId).first();
    if(governed)return Response.json({error:"organization_context_package_decision_immutable"},{status:403});
    const block=projection.libraryBlocks.find((candidate)=>candidate.id===blockId&&candidate.documentId===documentId&&candidate.type==="reference"&&String(candidate.properties.reference_id??"")===referenceId);
    const resources=block?await env.DB.prepare("SELECT COUNT(*) AS count FROM project_resource_scopes WHERE project_access_id=? AND organization_id=? AND owner_user_id=? AND ((resource_kind='document' AND resource_id=?) OR (resource_kind='block' AND resource_id=?) OR (resource_kind='reference' AND resource_id=?))")
      .bind(project.projectAccessId,project.organizationId,project.ownerUserId,documentId,blockId,referenceId).first<{count:number}>():null;
    if(Number(resources?.count??0)!==3)return Response.json({error:"project_reference_not_authorized"},{status:403});
  }
  let projectRetentionDays:number|null=null;
  let projectContentScope=user.projectExecution;
  let productionPlan:ManagedProductionPlan|null=null;
  let estimatedGenerationCostMicrousd=0;
  if(kind==="preview"||kind==="generate"||kind==="prompt_fan"||kind==="render_document"||kind==="chat"||kind==="structure_adaptive"){
    const billingUserId=user.billingUserId??user.userId;
    const scopes=user.projectExecution?[{organizationId:user.projectExecution.organizationId,projectAccessId:user.projectExecution.projectAccessId,actorUserId:user.projectExecution.actorUserId}]:!user.fictional&&billingUserId===user.userId?await ownerDocumentBudgetScopes(env,user.userId,documentId,documentRecord.projectId):[];
    if(scopes.length>1)return Response.json({error:"ambiguous_project_budget_scope"},{status:409});
    if(scopes[0]){
      projectRetentionDays=(await env.DB.prepare("SELECT transient_days FROM organization_retention_policies WHERE organization_id=?").bind(scopes[0].organizationId).first<{transient_days:number}>())?.transient_days??null;
      projectContentScope??={organizationId:scopes[0].organizationId,projectAccessId:scopes[0].projectAccessId,projectId:documentRecord.projectId,ownerUserId:user.userId,actorUserId:user.userId};
    }
    const pilotAllowance=await pilotExecutionAllowance(env,billingUserId,scopes[0]);
    if(!pilotAllowance.allowed)return Response.json({error:"active_pilot_participation_required"},{status:403});
    const trustedSnapshot=payload.snapshot&&typeof payload.snapshot==="object"&&!Array.isArray(payload.snapshot)?payload.snapshot as Record<string,unknown>:null;
    const trustedFacts=Array.isArray(trustedSnapshot?.facts)?trustedSnapshot.facts.filter((fact):fact is Record<string,unknown>=>Boolean(fact&&typeof fact==="object"&&!Array.isArray(fact))).map((fact)=>({type:String(fact.type??""),properties:fact.properties&&typeof fact.properties==="object"&&!Array.isArray(fact.properties)?fact.properties as Record<string,unknown>:{}})):null;
    const providerBlocks=kind==="structure_adaptive"&&payload.projectScope===true?projection.libraryBlocks:["preview","generate","prompt_fan","render_document"].includes(kind)&&trustedFacts?trustedFacts:projection.blocks;
    if(pilotAllowance.pilot&&!await managedPilotSourceClassificationValid(env,project?.ownerUserId??user.userId,pilotAllowance.pilot.cohort_id,providerBlocks,projectContentScope?.projectAccessId)){
      return Response.json({error:"pilot_non_sensitive_source_confirmation_required",message:"Every existing source in a controlled pilot must be re-uploaded with an explicit non-sensitive, licensed-material confirmation."},{status:428});
    }
    const account=scopes[0]?await readAccountBudgets(env,billingUserId,scopes[0].organizationId):null;
    const artifactKind=String(payload.artifactKind??"");const production=kind==="render_document"&&payload.productionMode==="managed"&&["short_story","scene","slides","storyboard","video"].includes(artifactKind)?buildManagedProductionPlan(artifactKind as "short_story"|"scene"|"slides"|"storyboard"|"video",payload.snapshot&&typeof payload.snapshot==="object"?payload.snapshot as Record<string,unknown>:{},artifactKind==="video"?{}:{requestedItemCount:Number(payload.itemCount??0),...(artifactKind==="slides"&&payload.requestedSlideCount!==undefined?{requestedSlideCount:Number(payload.requestedSlideCount)}:{})}):null;
    const estimatedCostMicrousd=production?production.estimatedTotalCostMicrousd+(artifactKind==="storyboard"?production.scenes.length*1_000_000:0):kind==="chat"||kind==="structure_adaptive"?estimatePlannerOperationMicrousd(env.OPENAI_MODEL??"gpt-5.6-terra",kind):kind==="prompt_fan"?4_000_000:kind==="render_document"&&artifactKind==="video"?normalizeVideoDurationSeconds(payload.videoSeconds)*VIDEO_ADAPTER_CONTRACT.publishedCostPerSecondMicrousd[VIDEO_ADAPTER_CONTRACT.defaultResolution]+1_000_000:kind==="render_document"&&artifactKind==="storyboard"?Math.max(1,Math.floor(Number(payload.itemCount??6)))*1_000_000+1_000_000:1_000_000;
    productionPlan=production;estimatedGenerationCostMicrousd=estimatedCostMicrousd;
    if(pilotAllowance.pilot){
      const fixed=await env.DB.prepare(`SELECT scope,used_microusd,reserved_microusd,hard_limit_microusd FROM cost_budget_counters
        WHERE period=? AND ((scope='pilot_org' AND scope_id=?) OR (scope='pilot_user' AND scope_id=?))`)
        .bind(`pilot:${pilotAllowance.pilot.cohort_id}`,pilotAllowance.pilot.cohort_id,billingUserId)
        .all<{scope:string;used_microusd:number;reserved_microusd:number;hard_limit_microusd:number}>();
      if(fixed.results.length!==2)return Response.json({error:"active_pilot_participation_required"},{status:403});
      const exhausted=fixed.results.find((counter)=>Number(counter.used_microusd)+Number(counter.reserved_microusd)+estimatedCostMicrousd>Number(counter.hard_limit_microusd));
      if(exhausted)return Response.json({error:"pilot_budget_hard_cap_reached",scope:exhausted.scope==="pilot_user"?"user":"workspace"},{status:429});
    }
    const gate=generationBudgetGate(account?.costBudgets??await readCostBudgets(env,billingUserId),{projectedMicrousd:estimatedCostMicrousd,suppressedUntilCritical:payload.budgetWarningSuppressed===true,noticeAcknowledged:payload.budgetAcknowledged===true});
    if(gate.level==="blocked")return Response.json({error:"budget_hard_cap_reached",message:`This generation exceeds the remaining ${gate.scope==="workspace"?"organization":"personal"} monthly budget.`,scope:gate.scope,gate},{status:429});
    if(account){
      const sceneCount=production?.scenes.length??Math.max(1,Math.floor(Number(payload.itemCount??6)));
      const estimatedTokens=kind==="chat"||kind==="structure_adaptive"?12_000:kind==="preview"?24_000:kind==="prompt_fan"?(fanKindFromRequest(payload)==="preview"?96_000:128_000):kind==="render_document"&&artifactKind==="slides"?presentationTokenReservation(production?.maximumProviderCallCount):production?Math.max(32_000*Math.ceil(sceneCount/8),artifactKind==="storyboard"?sceneCount*24_000:artifactKind==="video"?56_000:32_000):kind==="render_document"&&artifactKind==="storyboard"?Math.max(56_000,sceneCount*24_000):32_000;
      const tokenScope=account.budgets.user.used+account.budgets.user.reserved+estimatedTokens>account.budgets.user.limit?"user":account.budgets.workspace.used+account.budgets.workspace.reserved+estimatedTokens>account.budgets.workspace.limit?"workspace":null;
      if(tokenScope)return Response.json({error:"budget_hard_cap_reached",message:`This generation exceeds the remaining ${tokenScope==="workspace"?"organization":"personal"} monthly token budget.`,scope:tokenScope},{status:429});
    }
    if(gate.requiresAcknowledgement&&payload.budgetAcknowledged!==true)return Response.json({error:"generation_budget_acknowledgement_required",message:`Review your ${Math.round(gate.projectedUtilization*100)}% monthly budget usage before starting this generation.`,gate},{status:428});
    if(kind==="render_document"&&artifactKind==="slides"){
      const authorizedSources=new Set(buildPresentationSourceContract(payload.snapshot as Record<string,unknown>).sources.filter((source)=>source.sourceKind==="block").map((source)=>source.sourceId));
      if(!authorizedSources.size)return Response.json({error:"presentation_authorized_source_required",message:"Add at least one active, authorized source decision before generating a presentation. Exclusions and disabled decisions cannot become slide content."},{status:422});
      if(production&&production.scenes.some((scene)=>!scene.sourceBlockIds.some((sourceId)=>authorizedSources.has(sourceId))))return Response.json({error:"presentation_authorized_source_required",message:"Every planned slide requires an active, authorized positive source before any budget is reserved or a model is contacted."},{status:422});
    }
  }
  if(!project){
    await reconcileFailedBudgetReservations(env,user);
    await env.DB.prepare(`UPDATE document_jobs SET request_json='{}',result_json=NULL,updated_at=? WHERE owner_id=? AND stream_id=? AND expires_at<=? AND (request_json!='{}' OR result_json IS NOT NULL)
      AND NOT EXISTS(SELECT 1 FROM project_resource_scopes resource JOIN organization_retention_policies policy ON policy.organization_id=resource.organization_id AND policy.legal_hold=1
        WHERE (resource.resource_kind='job' AND resource.resource_id=document_jobs.job_id)
          OR (resource.resource_kind='document' AND resource.resource_id=document_jobs.document_id AND resource.owner_user_id=document_jobs.owner_id))`).bind(now,user.userId,user.streamId,now).run();
  }

  if(kind==="preview"||kind==="generate"||kind==="prompt_fan"){
    const readinessKind=kind==="prompt_fan"?`${fanKindFromRequest(payload)??"generate"}_fan` as const:kind;const readiness=await preflightGeneration(env,user,{kind:readinessKind,documentId,documentRevision:String(payload.documentRevision??""),requestKey:String(payload.requestKey??""),sourcePreviewId:typeof payload.sourcePreviewId==="string"?payload.sourcePreviewId:null,promptTechnique:normalizePromptTechnique(payload.promptTechnique),productionMode:payload.productionMode==="managed"?"managed":"manual",snapshot:payload.snapshot&&typeof payload.snapshot==="object"?payload.snapshot as Record<string,unknown>:undefined,force:true,sourceSurface:String(input.sourceSurface??"generation-controls")},{appendEvents:true,allowCache:false,sourceEvents:events});
    if(readiness.status==="blocked"){await appendAuditEvent(env,user.streamId,"worker:policy","GenerationBlockedBeforeProvider",{preflight_id:readiness.preflightId,document_id:documentId,document_revision:readiness.documentRevision,request_key:readiness.requestKey,kind:readiness.kind,status:readiness.status,blocking_probes:readiness.probes.filter((probe)=>probe.status==="fail").map((probe)=>probe.id),estimated_cost_avoided_microusd:readiness.estimatedCostMicrousd},uuidV7());return Response.json({error:"generation_preflight_blocked",message:readiness.summary,readiness},{status:409});}
    if(readiness.status==="review"&&payload.preflightAcknowledged!==true)return Response.json({error:"generation_preflight_review_required",message:readiness.summary,readiness},{status:428});
    if(readiness.status==="review")await appendAuditEvent(env,user.streamId,"worker:policy","GenerationRiskAcknowledged",{preflight_id:readiness.preflightId,document_id:documentId,document_revision:readiness.documentRevision,request_key:readiness.requestKey,kind:readiness.kind,warning_probes:readiness.probes.filter((probe)=>probe.status==="warning"||probe.status==="unknown").map((probe)=>probe.id),source_surface:String(input.sourceSurface??"generation-controls")});
    payload.preflightId=readiness.preflightId;payload.preflightVersion=readiness.version;payload.preflightAcknowledged=readiness.status==="review";
  }

  if (kind === "prompt_fan") {
    const fanKind = fanKindFromRequest(payload); if (!fanKind) return Response.json({ error: "prompt_fan_kind_required" }, { status: 400 });
    const promptFanId = typeof payload.promptFanId === "string" && payload.promptFanId ? payload.promptFanId : uuidV7();
    const documentRevision = generationRevisionFromRequest(payload, documentId); const sourcePreviewId = typeof payload.sourcePreviewId === "string" && payload.sourcePreviewId ? payload.sourcePreviewId : null;
    const parentRequestKey = String(payload.requestKey || `prompt-fan:${fanKind}:${documentRevision}:${sourcePreviewId || "document"}`);
    const activeParents=(await env.DB.prepare(`SELECT job.* FROM document_jobs job${project?" JOIN project_resource_scopes resource ON resource.resource_kind='job' AND resource.resource_id=job.job_id AND resource.project_access_id=? AND resource.organization_id=? AND resource.actor_user_id=job.owner_id":""}
      WHERE job.owner_id=? AND job.stream_id=? AND job.document_id=? AND job.kind='prompt_fan' AND job.status IN('queued','running','committing') ORDER BY job.requested_at DESC LIMIT 20`)
      .bind(...(project?[project.projectAccessId,project.organizationId]:[]),user.userId,user.streamId,documentId).all<DocumentJobRow>()).results;
    const duplicate = activeParents.find((candidate) => String(parseRequest(candidate).requestKey ?? "") === parentRequestKey);
    if(duplicate){const retained=await reconcilePromptFanParent(env,user.userId,duplicate.job_id)??duplicate;return Response.json({job:project?safeScopedJob(retained):serializeJob(retained),reused:true},{status:202});}
    const requestedAt = new Date(); const requestedAtIso = requestedAt.toISOString(); const configuredRetention = Number(projectRetentionDays ?? env.FORMA_RETENTION_DAYS ?? 30); const retentionDays = Number.isFinite(configuredRetention) && configuredRetention > 0 ? configuredRetention : 30; const expiresAt = new Date(requestedAt.getTime() + retentionDays * 86_400_000).toISOString();
    const sourceSurface = String(input.sourceSurface ?? payload.sourceSurface ?? "studio").slice(0, 80) || "studio"; const requestedSequence = await streamHead(env, user.streamId); const parentId = uuidV7(); const childIds = PROMPT_TECHNIQUES.map(() => uuidV7());
    const productionMode=payload.productionMode==="managed"?"managed":"manual";
    const shared = { ...payload, productionMode, fanKind: undefined, requestKey: undefined, promptTechnique: undefined, promptFanId, documentRevision, sourcePreviewId };
    const parentRequest = { fanKind, promptFanId, documentRevision, sourcePreviewId, productionMode, requestKey: parentRequestKey, childJobIds: childIds };
    const insert = (jobId: string, jobKind: DocumentJobKind, requestJson: Record<string, unknown>, resultJson: Record<string, unknown> | null = null) => documentJobInsert(env,user,documentId,"?,?,?,?,?,'queued',?,?,?,?,?,NULL,0,?,NULL,NULL,NULL,NULL,?,?",[jobId,user.userId,user.streamId,documentId,jobKind,sourceSurface,jobId,requestedSequence,JSON.stringify(requestJson),resultJson?JSON.stringify(resultJson):null,requestedAtIso,expiresAt,requestedAtIso]);
    const members = PROMPT_TECHNIQUES.map((technique, index) => ({ jobId: childIds[index], promptTechnique: technique, status: "queued", error: null, attemptCount: 0, updatedAt: requestedAtIso }));
    const inserts=[{jobId:parentId,statement:insert(parentId,"prompt_fan",parentRequest,{stage:"queued",progressMessage:"Four prompt approaches are queued as one generation.",members,completedCount:0,failedCount:0,totalCount:4})},
      ...PROMPT_TECHNIQUES.map((technique:PromptTechnique,index:number)=>({jobId:childIds[index]!,statement:insert(childIds[index]!,fanKind,{...shared,parentJobId:parentId,promptTechnique:technique,requestKey:documentGenerationRequestKey(fanKind,documentRevision,sourcePreviewId,technique,promptFanId)})}))];
    const statements=inserts.flatMap((entry)=>{const resource=projectJobResource(env,user,entry.jobId,documentId,requestedAtIso);return resource?[entry.statement,resource]:[entry.statement];});
    const results=await env.DB.batch(statements);if(project&&results.some((result)=>Number(result.meta.changes??0)!==1))return Response.json({error:"project_access_revoked"},{status:403});
    if(project)await anchorProjectJobs(env,user,[{jobId:parentId,kind:"prompt_fan",documentId},...childIds.map((jobId)=>({jobId,kind:fanKind,documentId}))]);
    const parent=await readJob(env,user.userId,parentId);context?.waitUntil(driveDocumentQueue(env,user));
    return Response.json({job:project?safeScopedJob(parent!):serializeJob(parent!),accepted:true},{status:202});
  }

  let active:DocumentJobRow|null=null;
  if(kind!=="extract_reference"){
    const candidates=(await env.DB.prepare(`SELECT job.* FROM document_jobs job${project?" JOIN project_resource_scopes resource ON resource.resource_kind='job' AND resource.resource_id=job.job_id AND resource.project_access_id=? AND resource.organization_id=? AND resource.actor_user_id=job.owner_id":""}
      WHERE job.owner_id=? AND job.stream_id=? AND job.document_id=? AND job.kind=? AND job.status IN('queued','running','committing') ORDER BY job.requested_at DESC LIMIT 50`)
      .bind(...(project?[project.projectAccessId,project.organizationId]:[]),user.userId,user.streamId,documentId,kind).all<DocumentJobRow>()).results;
    if(kind==="preview"||kind==="generate"){
      const identity=generationRequestIdentity(kind,payload,documentId);payload.documentRevision=identity.documentRevision;payload.requestKey=identity.requestKey;
      active=candidates.find((candidate)=>generationRequestIdentity(kind,parseRequest(candidate),documentId).requestKey===identity.requestKey)??null;
    }else if(kind==="render_document"){
      const providedRequestKey=String(payload.requestKey??"").trim();
      payload.requestKey=providedRequestKey||`render:${String(payload.artifactKind??"unknown")}:${payload.productionMode==="managed"?"managed":"manual"}:${generationRevisionFromRequest(payload,documentId)}`;
      const idempotencyKey=renderRequestIdempotencyKey(payload,documentId);payload.idempotencyKey=idempotencyKey;
      active=candidates.find((candidate)=>renderRequestIdempotencyKey(parseRequest(candidate),documentId)===idempotencyKey)??null;
    }
    else active=candidates[0]??null;
  }
  if(active)return Response.json({job:project?safeScopedJob(active):serializeJob(active),reused:true},{status:202});

  if (kind === "chat" || kind === "structure_adaptive") {
    const field = kind === "chat" ? "message" : "prompt"; const text = String(payload[field] ?? "").trim();
    if (!text) return Response.json({ error: kind === "chat" ? "chat_message_required" : "adaptive_intent_required" }, { status: 400 });
    if (text.length > (kind === "chat" ? 4000 : 2000)) return Response.json({ error: kind === "chat" ? "chat_message_too_long" : "adaptive_intent_too_long" }, { status: 400 });
    const stored = await storePrivateContent(env, user.userId, kind === "chat" ? "chat-user" : "adaptive-intent", text, projectContentScope); payload[field] = undefined; payload.jobInputRef = stored.contentId;
  }

  const jobId = uuidV7(); const requestedAt = new Date(); const configuredRetention = Number(projectRetentionDays ?? env.FORMA_RETENTION_DAYS ?? 30); const retentionDays = Number.isFinite(configuredRetention) && configuredRetention > 0 ? configuredRetention : 30; const expiresAt = new Date(requestedAt.getTime() + retentionDays * 86_400_000).toISOString();
  const sourceSurface = String(input.sourceSurface ?? payload.sourceSurface ?? "studio").slice(0, 80) || "studio"; const requestedSequence = await streamHead(env, user.streamId);
  const createdAt=requestedAt.toISOString();
  const receipt=kind==="render_document"?await acceptedGenerationReceipt(env,user,payload,documentId,jobId,estimatedGenerationCostMicrousd,productionPlan,projectContentScope):null;
  const initialResult=receipt?{artifactKind:String(payload.artifactKind??""),generationReceipt:receipt,stage:"queued",progressMessage:"The accepted generation and its private source receipt are safely recorded."}:null;
  const inserted=documentJobInsert(env,user,documentId,"?,?,?,?,?,'queued',?,?,?,?,?,NULL,0,?,NULL,NULL,NULL,NULL,?,?",[jobId,user.userId,user.streamId,documentId,kind,sourceSurface,jobId,requestedSequence,JSON.stringify(payload),initialResult?JSON.stringify(initialResult):null,createdAt,expiresAt,createdAt],kind==="render_document"?{kind,key:String(payload.idempotencyKey??"")}:undefined);
  const resource=projectJobResource(env,user,jobId,documentId,createdAt);
  let created=false;
  if(resource){const results=await env.DB.batch([inserted,resource]);created=results.every((result)=>Number(result.meta.changes??0)===1);if(!created&&Number(results[0]?.meta.changes??0)!==0)return Response.json({error:"project_access_revoked"},{status:403});}
  else created=Number((await inserted.run()).meta.changes??0)===1;
  if(!created){
    if(kind==="render_document"){
      const duplicate=await env.DB.prepare(`SELECT * FROM document_jobs WHERE owner_id=? AND stream_id=? AND document_id=? AND kind='render_document' AND status IN('queued','running','committing') AND json_extract(request_json,'$.idempotencyKey')=? ORDER BY requested_at DESC LIMIT 1`)
        .bind(user.userId,user.streamId,documentId,String(payload.idempotencyKey??"")).first<DocumentJobRow>();
      if(duplicate&&(!project||await activeProjectExecution(env,user,duplicate.document_id,duplicate.job_id)))return Response.json({job:project?safeScopedJob(duplicate):serializeJob(duplicate),reused:true},{status:202});
    }
    return Response.json({error:project?"project_access_revoked":"document_job_admission_conflict"},{status:project?403:409});
  }
  if(resource)await anchorProjectJobs(env,user,[{jobId,kind,documentId}]);
  const job = await readJob(env, user.userId, jobId);
  context?.waitUntil(driveDocumentQueue(env, user));
  return Response.json({job:project?safeScopedJob(job!):serializeJob(job!),accepted:true},{status:202});
}

/** Semantic reports are diagnostic. Only exact retained receipts establish canonical effects. */
import { ACTION_RETENTION_MS, type ActionObservation, type ActionObservationInput, type ActionScope, type WorkflowTarget } from '../src/still/action-outcomes.ts';
import { documentGenerationRevision } from '../src/model/document-jobs.ts';
import { creationReviewHashes } from '../src/model/creation-validation.ts';
import type { CreationDraft, CreationReceipt } from '../src/model/creation.ts';
import type { CreativeProjection } from '../src/model/events.ts';
import type { PilotUser } from './pilot-policy.ts';
import type { ProjectRequestContext } from './project-request-context.ts';
import { resolveOwnerExecutionScope } from './project-access.ts';
import type { WorkerEnv } from './runtime.ts';

export type ActionEvidenceAccess={user:PilotUser;shared?:ProjectRequestContext;projection:CreativeProjection};
export type SemanticVerification={error?:string;expiresAt?:string;evidence?:ActionObservation['evidence'];interpretation:NonNullable<ActionObservation['interpretation']>;horizonEndsAt?:string;late?:boolean;reviewedDraftRevision?:number;seriesGuard?:{sql:string;bindings:unknown[]}};
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const sameTarget=(a:WorkflowTarget,b:WorkflowTarget)=>a.kind===b.kind&&a.id===b.id&&a.revision===b.revision;
const minimum=(...dates:Array<string|undefined>)=>dates.filter((date):date is string=>!!date).sort()[0];
const emptyEvidence=():NonNullable<ActionObservation['evidence']>=>({eventIds:[],eventTypes:[],correlationIds:[],authority:'server-verified-references'});
type Draft={draft_id:string;scope_key:string;destination_json:string;revision:number;state:string;expires_at:string};
async function authorizedDraft(env:WorkerEnv,access:ActionEvidenceAccess,scope:ActionScope,id:string,now:string):Promise<Draft|undefined>{
  const draft=await env.DB.prepare('SELECT draft_id,scope_key,destination_json,revision,state,expires_at FROM creation_drafts WHERE draft_id=? AND actor_user_id=? AND expires_at>?').bind(id,access.user.userId,now).first<Draft>();
  if(!draft)return;
  const destination=object(JSON.parse(draft.destination_json));
  if(scope.projectId&&destination.projectId!==scope.projectId||scope.documentId&&destination.documentId!==scope.documentId)return;
  if(destination.projectId&&!access.projection.projects.some(project=>project.id===destination.projectId))return;
  if(destination.documentId&&!access.projection.documents.some(document=>!document.removed&&document.id===destination.documentId&&document.projectId===destination.projectId))return;
  let custody=access.shared?'project:'+access.shared.organizationId+':'+access.shared.projectAccessId:'personal:'+access.user.userId;
  if(!access.shared&&draft.scope_key!==custody){
    if(typeof destination.projectId!=='string')return;
    const resolved=await resolveOwnerExecutionScope(env,access.user,String(destination.documentId??''),destination.projectId,'read');
    if(resolved.denied||!resolved.scope)return;
    custody='project:'+resolved.scope.organizationId+':'+resolved.scope.projectAccessId;
  }
  return draft.scope_key===custody?draft:undefined;
}
type Operation={operation_id:string;draft_id:string;draft_revision:number;state:string;kind:string;approval_hash:string|null;receipt_json:string|null;expires_at:string;created_at:string};
async function operationEvidence(env:WorkerEnv,access:ActionEvidenceAccess,scope:ActionScope,id:string,draftId:string,now:string){
  const draft=await authorizedDraft(env,access,scope,draftId,now);if(!draft)return;
  const operation=await env.DB.prepare('SELECT operation_id,draft_id,draft_revision,state,kind,approval_hash,receipt_json,expires_at,created_at FROM creation_operations WHERE operation_id=? AND draft_id=? AND actor_user_id=? AND scope_key=? AND expires_at>?').bind(id,draftId,access.user.userId,draft.scope_key,now).first<Operation>();
  if(!operation)return;
  let receipt:CreationReceipt|undefined;
  if(operation.state==='applied'){
    if(operation.kind!=='commit'||!operation.receipt_json)return;
    receipt=JSON.parse(operation.receipt_json) as CreationReceipt;
    if(receipt.operationId!==id||receipt.previewId!==id||receipt.approvalHash!==operation.approval_hash||receipt.status!=='committed')return;
    if(receipt.projectId&&!access.projection.projects.some(project=>project.id===receipt!.projectId))return;
    if(receipt.primaryDocumentId&&!access.projection.documents.some(document=>document.id===receipt!.primaryDocumentId&&!document.removed))return;
  }
  const evidence={...emptyEvidence(),operationId:id,operationStatus:operation.state,...(operation.approval_hash?{approvalHash:operation.approval_hash}:{})};
  return {operation,receipt,evidence,expiresAt:minimum(draft.expires_at,operation.expires_at)!};
}
/** A quality assessment can name a historical saved draft revision/hash, never another actor's draft. */
async function verifyAssessmentTarget(env:WorkerEnv,access:ActionEvidenceAccess,scope:ActionScope,target:WorkflowTarget,instanceId:string|undefined,now:string,reviewedRevision?:number){
  if(!instanceId||!target.kind.startsWith('creation-')||reviewedRevision===undefined)return;
  const draft=await authorizedDraft(env,access,scope,instanceId,now);if(!draft)return;
  const rows=await env.DB.prepare(`SELECT version.revision,content.content,content.expires_at FROM creation_draft_content_versions version JOIN private_content content ON content.content_id=version.content_id AND content.owner_id=version.actor_user_id AND content.kind='creation-draft' WHERE version.draft_id=? AND version.actor_user_id=? AND content.redacted_at IS NULL AND content.expires_at>? AND version.revision=? LIMIT 1`).bind(instanceId,access.user.userId,now,reviewedRevision).all<{revision:number;content:string;expires_at:string}>();
  for(const row of rows.results){
    if(reviewedRevision!==undefined&&row.revision!==reviewedRevision)continue;
    const saved=JSON.parse(row.content) as CreationDraft;
    if(target.kind==='creation-draft'&&target.id===instanceId&&target.revision===String(row.revision))return minimum(draft.expires_at,row.expires_at);
    if(!saved.plan)continue;
    const hashes=await creationReviewHashes(saved.plan);
    if(target.kind==='creation-draft'&&target.id===instanceId&&target.revision===hashes.approvalHash||target.kind==='creation-node'&&hashes.nodeHashes[target.id]===target.revision||target.kind==='creation-use'&&hashes.useHashes[target.id]===target.revision)return minimum(draft.expires_at,row.expires_at);
  }
}
export async function verifySemanticObservation(env:WorkerEnv,access:ActionEvidenceAccess,scope:ActionScope,input:ActionObservationInput,parent:ActionObservation|undefined,key:string,epoch:string,now:string):Promise<SemanticVerification>{
  const result:SemanticVerification={interpretation:input.kind==='assessment'||input.outcome?.type==='user-acceptance'?'explicit-user-report':'diagnostic-client-report'};
  const semantic=input.workflow??input.outcome??input.assessment;if(!semantic)return result;
  const withdrawal=(input.outcome?.status==='revoked'||input.assessment?.acceptance==='revoked')&&(input.outcome?.revision??input.assessment?.revision??1)>1;
  const instanceId=input.workflow?.instanceId??input.outcome?.workflowInstanceId??input.assessment?.workflowInstanceId;
  const parentSemantic=parent?.workflow??parent?.outcome??parent?.assessment;
  const parentInstance=parent?.workflow?.instanceId??parent?.outcome?.workflowInstanceId??parent?.assessment?.workflowInstanceId;
  if(parentInstance&&instanceId!==parentInstance)return {...result,error:'workflow_parent_mismatch'};
  if(parentSemantic?.operationId&&semantic.operationId&&parentSemantic.operationId!==semantic.operationId)return {...result,error:'operation_parent_mismatch'};
  if(input.workflow&&parent?.workflow&&Date.parse(input.workflow.occurredAt)<Date.parse(parent.workflow.occurredAt))return {...result,error:'workflow_causal_time_conflict'};
  if(semantic.operationId&&!withdrawal){
    if(!instanceId)return {...result,error:'operation_workflow_required'};
    const verified=await operationEvidence(env,access,scope,semantic.operationId,instanceId,now);if(!verified)return {...result,error:'operation_evidence_unavailable'};
    result.evidence=verified.evidence;result.expiresAt=verified.expiresAt;
    if(input.workflow?.transition==='finalize'&&input.workflow.status==='confirmed'){
      if(verified.operation.state!=='applied')return {...result,error:'operation_not_committed'};
      if(input.workflow.draftRevision!==verified.operation.draft_revision||semantic.target.kind!=='creation-draft'||semantic.target.id!==instanceId||semantic.target.revision!==String(verified.operation.draft_revision))return {...result,error:'operation_target_mismatch'};
    }
    if(input.outcome?.type==='acknowledged-commit'&&input.outcome.status==='observed'){
      if(!verified.receipt||semantic.target.kind!=='creation-draft'||semantic.target.id!==instanceId||![String(verified.operation.draft_revision),verified.operation.approval_hash].includes(semantic.target.revision))return {...result,error:'operation_target_mismatch'};
      result.interpretation='verified-operation';
    }
    if(input.eventIds?.some(id=>!id))return {...result,error:'operation_event_mismatch'};
    if(input.eventIds?.length){
      for(const id of input.eventIds){const event=await env.DB.prepare('SELECT correlation_id FROM events WHERE event_id=?').bind(id).first<{correlation_id:string}>();if(event?.correlation_id!=='creation:'+access.user.userId+':'+semantic.operationId)return {...result,error:'operation_event_mismatch'};}
    }
  } else if(input.workflow?.transition==='finalize'&&input.workflow.status==='confirmed')return {...result,error:'operation_receipt_required'};
  const series=input.outcome??input.assessment;
  if(!series)return result;
  if(parent?.outcome&&!sameTarget(parent.outcome.target,series.target)||parent?.assessment&&!sameTarget(parent.assessment.target,series.target))return {...result,error:'outcome_parent_target_mismatch'};
  if(!parent&&!series.supersedesId)return {...result,error:'outcome_parent_required'};
  if(input.outcome?.type==='user-acceptance'&&!parent?.outcome&&!parent?.assessment)return {...result,error:'acceptance_outcome_required'};
  const horizonEnd=Date.parse(series.horizonStartedAt)+series.horizonMs;
  result.horizonEndsAt=new Date(horizonEnd).toISOString();result.late=Date.parse(series.occurredAt)>horizonEnd;
  result.expiresAt=minimum(result.expiresAt,new Date(Date.parse(series.horizonStartedAt)+ACTION_RETENTION_MS).toISOString());
  const seriesId=input.outcome?.outcomeId??input.assessment!.assessmentId,field=input.outcome?'outcome':'assessment',idField=input.outcome?'outcomeId':'assessmentId';
  const rows=await env.DB.prepare(`SELECT body FROM still_action_observations WHERE owner_id=? AND scope_key=? AND consent_epoch=? AND kind=? AND json_extract(body,'$.${field}.${idField}')=? AND expires_at>? ORDER BY CAST(json_extract(body,'$.${field}.revision') AS INTEGER) DESC LIMIT 1`).bind(access.user.userId,key,epoch,input.kind,seriesId,now).all<{body:string}>();
  const previous=rows.results[0]?JSON.parse(rows.results[0].body) as ActionObservation:undefined,prior=previous?.outcome??previous?.assessment;
  if(series.revision===1?!!previous:!previous||!prior||series.supersedesId!==previous.id||series.revision!==prior.revision+1)return {...result,error:'observation_revision_conflict'};
  if(previous&&prior){
    if(previous.jobId&&input.jobId!==previous.jobId||previous.eventIds?.length&&JSON.stringify(previous.eventIds)!==JSON.stringify(input.eventIds))return {...result,error:'outcome_reference_changed'};
    if(!sameTarget(prior.target,series.target)||prior.horizonStartedAt!==series.horizonStartedAt||prior.horizonMs!==series.horizonMs||prior.operationId!==series.operationId||prior.workflowInstanceId!==series.workflowInstanceId||previous.outcome?.type!==input.outcome?.type||previous.assessment?.goalId!==input.assessment?.goalId||previous.decisionId!==input.decisionId||previous.actionId!==input.actionId||previous.source!==input.source)return {...result,error:'observation_correction_mismatch'};
    if(Date.parse(series.occurredAt)<Date.parse(prior.occurredAt))return {...result,error:'observation_causal_time_conflict'};
    result.expiresAt=minimum(result.expiresAt,previous.expiresAt);
    if(withdrawal){result.evidence=previous.evidence;result.reviewedDraftRevision=previous.reviewedDraftRevision;}
  }
  result.seriesGuard={sql:`NOT EXISTS(SELECT 1 FROM still_action_observations WHERE owner_id=? AND scope_key=? AND consent_epoch=? AND kind=? AND json_extract(body,'$.${field}.${idField}')=? AND CAST(json_extract(body,'$.${field}.revision') AS INTEGER)>=?)`,bindings:[access.user.userId,key,epoch,input.kind,seriesId,series.revision]};
  if(input.assessment&&!withdrawal){
    if(series.revision===1&&(parent?.workflow?.transition!=='final-review'||parent.workflow.status!=='confirmed'||parent.workflow.instanceId!==instanceId))return {...result,error:'assessment_review_required'};
    const goal=await env.DB.prepare(`SELECT goal.created_at,goal.expires_at,content.content,content.expires_at AS content_expires_at FROM still_action_goals goal JOIN private_content content ON content.content_id=goal.content_id AND content.owner_id=goal.owner_id AND content.kind='still-goal' WHERE goal.goal_id=? AND goal.owner_id=? AND goal.scope_key=? AND goal.expires_at>? AND content.expires_at>? AND content.redacted_at IS NULL`).bind(input.assessment.goalId,access.user.userId,key,now,now).first<{created_at:string;expires_at:string;content_expires_at:string;content:string}>();
    if(!goal)return {...result,error:'assessment_goal_unavailable'};
    if(goal.created_at>series.horizonStartedAt||goal.created_at>series.occurredAt||parent?.workflow&&goal.created_at>parent.workflow.occurredAt)return {...result,error:'assessment_goal_postdates_review'};
    const criteria=object(JSON.parse(goal.content)).criteria;
    if(!Array.isArray(criteria)||input.assessment.criteria.some(criterion=>criterion.index>=criteria.length))return {...result,error:'assessment_criteria_unavailable'};
    result.reviewedDraftRevision=input.assessment.revision===1?parent?.workflow?.draftRevision:previous?.reviewedDraftRevision;
    const targetExpiry=await verifyAssessmentTarget(env,access,scope,series.target,instanceId,now,result.reviewedDraftRevision);
    if(!targetExpiry)return {...result,error:'assessment_revision_unavailable'};
    result.expiresAt=minimum(result.expiresAt,goal.expires_at,goal.content_expires_at,targetExpiry);
  }
  return result;
}

/** The referenced job/export must match the exact revision, not merely exist in the actor's history. */
export async function verifyOutcomeTarget(env:WorkerEnv,input:ActionObservationInput,parent:ActionObservation|undefined,evidence:ActionObservation['evidence'],now:string):Promise<{error?:string;expiresAt?:string}> {
  const outcome=input.outcome;if(!outcome)return {};
  if(outcome.status==='revoked'&&outcome.revision>1)return {};
  if(parent?.evidence?.jobId&&input.jobId&&parent.evidence.jobId!==input.jobId)return {error:'outcome_reference_changed'};
  if(parent?.evidence?.eventIds.length&&input.eventIds?.some(id=>!parent.evidence!.eventIds.includes(id)))return {error:'outcome_reference_changed'};
  if(input.jobId){
    if(!['acknowledged-commit','completed-job'].includes(outcome.type))return {error:'outcome_reference_kind_mismatch'};
    const job=await env.DB.prepare('SELECT document_id,request_json,status,expires_at FROM document_jobs WHERE job_id=? AND expires_at>?').bind(input.jobId,now).first<{document_id:string;request_json:string;status:string;expires_at:string}>();
    if(!job)return {error:'outcome_job_unavailable'};
    const request=object(JSON.parse(job.request_json));
    const revision=String(request.documentRevision||documentGenerationRevision({snapshot:request.snapshot??{},sourceBlockVersions:request.sourceBlockVersions??[],documentId:job.document_id}));
    if(outcome.target.kind!=='document'||outcome.target.id!==job.document_id||outcome.target.revision!==revision)return {error:'outcome_revision_mismatch'};
    if(outcome.type==='completed-job'&&outcome.status==='observed'&&job.status!=='completed')return {error:'job_not_completed'};
    return {expiresAt:job.expires_at};
  }
  if(outcome.type==='completed-job'&&outcome.status==='observed')return {error:'job_receipt_required'};
  if(outcome.type==='acknowledged-commit'&&outcome.status==='observed'&&!evidence?.operationId&&!evidence?.eventIds.length)return {error:'commit_receipt_required'};
  if(outcome.type==='file-retrieved'||outcome.type==='acknowledged-commit'&&!evidence?.operationId){
    let matched=false;
    for(const id of evidence?.eventIds??[]){
      const event=await env.DB.prepare('SELECT type,payload FROM events WHERE event_id=?').bind(id).first<{type:string;payload:string}>();if(!event)continue;
      const payload=object(JSON.parse(event.payload));
      if(event.type==='DocumentArtifactExported'&&outcome.target.kind==='artifact'&&payload.artifact_id===outcome.target.id&&String(payload.artifact_revision)===outcome.target.revision||event.type==='ObjectExported'&&outcome.target.kind==='output'&&payload.object_id===outcome.target.id&&outcome.target.revision===id)matched=true;
    }
    if(!matched)return {error:outcome.type==='file-retrieved'?'file_export_receipt_required':'outcome_revision_mismatch'};
  }
  return {};
}

/** Stored canonical references never authorize their targets. Recheck current custody on every read/replay. */
export async function mayReadSemanticObservation(env:WorkerEnv,user:PilotUser,scope:ActionScope,shared:ProjectRequestContext|undefined,observation:ActionObservation,projection?:CreativeProjection,cache=new Map<string,Promise<boolean>>):Promise<boolean>{
  if(!['workflow','outcome','assessment'].includes(observation.kind)||!observation.evidence&&!observation.assessment)return true;
  const readable=(projectId:string,documentId='')=>{
    const key=projectId+'/'+documentId;
    let permission=cache.get(key);
    if(!permission){permission=(async()=>{
      if(!projectId||scope.projectId&&scope.projectId!==projectId||scope.documentId&&documentId&&scope.documentId!==documentId)return false;
      if(projection&&(!projection.projects.some(project=>project.id===projectId)||documentId&&!projection.documents.some(document=>document.id===documentId&&document.projectId===projectId&&!document.removed)))return false;
      if(shared)return shared.projectId===projectId;
      const resolved=await resolveOwnerExecutionScope(env,user,documentId,projectId,'read');return !resolved.denied;
    })();cache.set(key,permission);}return permission;
  };
  const projectForDocument=async(documentId:string)=>{
    const known=projection?.documents.find(document=>document.id===documentId&&!document.removed)?.projectId??(scope.documentId===documentId?scope.projectId:undefined);
    if(known)return known;
    const row=await env.DB.prepare("SELECT json_extract(payload,'$.project_id') AS project_id FROM events WHERE stream_id=? AND type='DocumentCreated' AND json_extract(payload,'$.document_id')=? ORDER BY recorded_at DESC LIMIT 1").bind(user.streamId,documentId).first<{project_id:string}>();return row?.project_id;
  };
  try{
    if(observation.assessment){
      const instanceId=observation.assessment.workflowInstanceId;if(!instanceId)return false;
      const draft=await env.DB.prepare('SELECT destination_json,operation_id,state FROM creation_drafts WHERE draft_id=? AND actor_user_id=? AND expires_at>?').bind(instanceId,user.userId,new Date().toISOString()).first<{destination_json:string;operation_id:string|null;state:string}>();
      if(!draft)return false;
      if(draft.operation_id){
        const operation=await env.DB.prepare('SELECT receipt_json FROM creation_operations WHERE operation_id=? AND draft_id=? AND actor_user_id=? AND expires_at>?').bind(draft.operation_id,instanceId,user.userId,new Date().toISOString()).first<{receipt_json:string|null}>();
        if(!operation?.receipt_json)return false;
        const receipt=object(JSON.parse(operation.receipt_json));
        if(typeof receipt.projectId!=='string'||!await readable(receipt.projectId,String(receipt.primaryDocumentId??'')))return false;
      }else{
        if(draft.state==='applied')return false;
        const destination=object(JSON.parse(draft.destination_json));
        if(typeof destination.projectId==='string'&&!await readable(destination.projectId,String(destination.documentId??'')))return false;
      }
    }
    const evidence=observation.evidence??emptyEvidence();
    if(evidence.operationId){
      const row=await env.DB.prepare('SELECT receipt_json FROM creation_operations WHERE operation_id=? AND actor_user_id=? AND expires_at>?').bind(evidence.operationId,user.userId,new Date().toISOString()).first<{receipt_json:string|null}>();
      // Uncommitted retained operations have no new target; their original scope is freshly authorized.
      if(!row)return false;
      if(row.receipt_json){const receipt=object(JSON.parse(row.receipt_json));if(typeof receipt.projectId!=='string'||!await readable(receipt.projectId,String(receipt.primaryDocumentId??'')))return false;}
    }
    if(evidence.jobId){
      const row=await env.DB.prepare('SELECT document_id FROM document_jobs WHERE job_id=? AND owner_id=? AND expires_at>?').bind(evidence.jobId,user.userId,new Date().toISOString()).first<{document_id:string}>();if(!row)return false;
      const project=await projectForDocument(row.document_id);if(!project||!await readable(project,row.document_id))return false;
    }
    for(const id of evidence.eventIds){
      const row=await env.DB.prepare('SELECT payload FROM events WHERE event_id=?').bind(id).first<{payload:string}>();if(!row)return false;
      const payload=object(JSON.parse(row.payload)),document=String(payload.document_id??payload.source_document_id??'');
      const project=typeof payload.project_id==='string'?payload.project_id:document?await projectForDocument(document):scope.projectId;
      if(!project||!await readable(project,document))return false;
    }
    return true;
  }catch{return false;} // Missing authority is unknown evidence, never implicit access.
}

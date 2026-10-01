/** Explicit semantic feedback, separate from creative history and passive attention. */
export const ACTION_CONTEXT_VERSION = 'still-action-context-v1';
export const ACTION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export type ActionScope = { projectId?: string; documentId?: string; blockId?: string };
export type StillGoal = { id: string; scope: ActionScope; text: string; criteria: string[]; status: 'active' | 'completed' | 'abandoned'; createdAt: string; expiresAt: string };
export const ACTION_FEEDBACK = ['not-useful-now','already-done','different-goal','keep-available','helpful','unhelpful'] as const;
export const WORKFLOW_OBSERVATION_VERSION = 'still-workflow-v1';
export const OUTCOME_OBSERVATION_VERSION = 'still-outcome-v1';
export const QUALITY_ASSESSMENT_VERSION = 'still-quality-assessment-v1';
export type WorkflowTarget = { kind:'creation-draft'|'creation-node'|'creation-use'|'document'|'generation'|'artifact'|'output'; id:string; revision:string };
export type WorkflowObservation = {
  version:typeof WORKFLOW_OBSERVATION_VERSION; instanceId:string;
  stage:'draft'|'ideas'|'documents'|'project'|'final-review'|'finalized';
  transition:'entered'|'resumed'|'interpreted'|'presented'|'approved'|'approval-invalidated'|'final-review'|'backtracked'|'help-opened'|'draft-preserved'|'draft-discarded'|'finalize'|'internal-failure'|'reconciled';
  status:'attempted'|'confirmed'|'blocked'|'failed'|'reconciled';
  blocker?:'unseen'|'incomplete'|'unapproved'|'stale-revision'|'permission'|'source-unavailable'|'operation-uncertain'|'internal'|'none';
  target:WorkflowTarget; draftRevision:number; operationId?:string; occurredAt:string;
};
export type OutcomeObservation = {
  version:typeof OUTCOME_OBSERVATION_VERSION; outcomeId:string; revision:number; supersedesId?:string;
  type:'acknowledged-commit'|'completed-job'|'file-retrieved'|'user-acceptance';
  status:'observed'|'pending'|'censored'|'unknown'|'revoked';
  target:WorkflowTarget; workflowInstanceId?:string; operationId?:string;
  occurredAt:string; horizonStartedAt:string; horizonMs:number;
};
export type QualityAssessment = {
  version:typeof QUALITY_ASSESSMENT_VERSION; assessmentId:string; revision:number; supersedesId?:string;
  target:WorkflowTarget; goalId:string; criteria:Array<{index:number;result:'met'|'not-met'|'unknown'}>;
  acceptance:'accepted'|'needs-work'|'unknown'|'revoked'; workflowInstanceId?:string; operationId?:string;
  occurredAt:string; horizonStartedAt:string; horizonMs:number;
};
export type ActionObservationInput = {
  id: string; scope: ActionScope; kind: 'exposure' | 'selection' | 'invocation' | 'cancellation' | 'failure' | 'feedback' | 'commit' | 'workflow' | 'outcome' | 'assessment';
  workflow?:WorkflowObservation; outcome?:OutcomeObservation; assessment?:QualityAssessment;
  decisionId?: string; actionId?: string; surface: string; source: 'toolbar' | 'more' | 'palette' | 'direct';
  parentId?: string; eventIds?: string[]; jobId?: string; feedback?: typeof ACTION_FEEDBACK[number];
  feedbackScope?: 'decision' | 'document' | 'project'; feedbackExpiresAt?: string; displayedActionIds?: string[]; primaryActionId?: string; interactiveLatencyMs?: number;
};
export type ActionObservation = ActionObservationInput & { recordedAt: string; expiresAt: string; evidence?: { eventIds: string[]; eventTypes: string[]; correlationIds: string[]; jobId?: string; jobStatus?: string; operationId?:string; operationStatus?:string; approvalHash?:string; authority: 'server-verified-references' }; interpretation?:'diagnostic-client-report'|'verified-operation'|'explicit-user-report'; horizonEndsAt?:string; late?:boolean; reviewedDraftRevision?:number };
export type StillActionContext = { version: typeof ACTION_CONTEXT_VERSION; enabled: boolean; expiresAt?: string; directDecisionId?: string; directContextExpiresAt?: string; goal?: StillGoal; observations: ActionObservation[]; coverage: { status?: 'complete'|'unavailable'; limit: number; returned: number; hasMore: boolean; withheld?:number; feedback?: {limit:number;returned:number;hasMore:boolean}; interpretation: string } };
const identifier = /^[A-Za-z0-9_:./@%+-]{1,180}$/;
export const validActionIdentifier = (value: unknown): value is string => typeof value === 'string' && identifier.test(value);
export function cleanActionScope(value: unknown): ActionScope | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const input = value as Record<string, unknown>, scope: ActionScope = {};
  for (const key of ['projectId','documentId','blockId'] as const) {
    if (input[key] === undefined || input[key] === '') continue;
    if (!validActionIdentifier(input[key])) return;
    scope[key] = input[key];
  }
  if (scope.blockId && !scope.documentId || scope.documentId && !scope.projectId) return;
  return scope;
}
export function cleanActionObservation(value: unknown, knownActions: readonly string[], now = Date.now()): ActionObservationInput | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const input = value as Record<string, unknown>, scope = cleanActionScope(input.scope);
  if (!scope || !validActionIdentifier(input.id) || !['exposure','selection','invocation','cancellation','failure','feedback','commit','workflow','outcome','assessment'].includes(String(input.kind)) || !['toolbar','more','palette','direct'].includes(String(input.source)) || !validActionIdentifier(input.surface)) return;
  const kind = input.kind as ActionObservationInput['kind'];
  if (kind === 'exposure' && input.actionId !== undefined) return;
  if (kind !== 'exposure' && (typeof input.actionId !== 'string' || !knownActions.includes(input.actionId))) return;
  if (kind === 'exposure' && (!validActionIdentifier(input.decisionId) || !Array.isArray(input.displayedActionIds) || !input.displayedActionIds.length || input.displayedActionIds.length > 80 || input.displayedActionIds.some(id => typeof id !== 'string' || !knownActions.includes(id)))) return;
  for (const key of ['decisionId','parentId','jobId'] as const) if (input[key] !== undefined && !validActionIdentifier(input[key])) return;
  if (input.eventIds !== undefined && (!Array.isArray(input.eventIds) || input.eventIds.length > 24 || input.eventIds.some(id => !validActionIdentifier(id)))) return;
  if (kind === 'commit' && !input.jobId && (!Array.isArray(input.eventIds) || !input.eventIds.length)) return;
  if (!['commit','outcome'].includes(kind) && (input.jobId || input.eventIds)) return;
  if (kind !== 'feedback' && (input.feedback !== undefined || input.feedbackScope !== undefined || input.feedbackExpiresAt !== undefined)) return;
  if (kind !== 'exposure' && (input.displayedActionIds !== undefined || input.primaryActionId !== undefined || input.interactiveLatencyMs !== undefined)) return;
  if (input.interactiveLatencyMs !== undefined && (!Number.isSafeInteger(input.interactiveLatencyMs) || Number(input.interactiveLatencyMs)<0 || Number(input.interactiveLatencyMs)>300_000)) return;
  if (input.primaryActionId !== undefined && (typeof input.primaryActionId !== 'string' || !Array.isArray(input.displayedActionIds) || !input.displayedActionIds.includes(input.primaryActionId))) return;
  if (kind === 'feedback' && !(ACTION_FEEDBACK as readonly unknown[]).includes(input.feedback)) return;
  if (input.feedbackScope !== undefined && !['decision','document','project'].includes(String(input.feedbackScope))) return;
  if (input.feedbackScope === 'decision' && !input.decisionId || input.feedbackScope === 'document' && !scope.documentId || input.feedbackScope === 'project' && !scope.projectId) return;
  if (input.feedbackExpiresAt !== undefined && (typeof input.feedbackExpiresAt !== 'string' || !Number.isFinite(Date.parse(input.feedbackExpiresAt)) || Date.parse(input.feedbackExpiresAt) <= now || Date.parse(input.feedbackExpiresAt) > now + ACTION_RETENTION_MS)) return;
  for (const key of ['workflow','outcome','assessment'] as const) if (key !== kind && input[key] !== undefined) return;
  const semantic = kind === 'workflow' ? cleanWorkflow(input.workflow, now) : kind === 'outcome' ? cleanOutcome(input.outcome, now) : kind === 'assessment' ? cleanAssessment(input.assessment, now) : undefined;
  if (['workflow','outcome','assessment'].includes(kind) && !semantic) return;
  const result: ActionObservationInput = { id: input.id, scope, kind, surface: input.surface, source: input.source as ActionObservationInput['source'] };
  for (const key of ['decisionId','actionId','parentId','jobId','feedback','feedbackScope','feedbackExpiresAt','primaryActionId','interactiveLatencyMs'] as const) if (input[key] !== undefined) Object.assign(result, { [key]: input[key] });
  if (semantic) Object.assign(result, {[kind]:semantic});
  if (result.feedbackExpiresAt) result.feedbackExpiresAt = new Date(result.feedbackExpiresAt).toISOString();
  if (Array.isArray(input.eventIds)) result.eventIds = [...new Set(input.eventIds as string[])];
  if (kind === 'exposure') result.displayedActionIds = [...new Set(input.displayedActionIds as string[])];
  return result;
}

const asObject=(value:unknown):Record<string,unknown>|undefined=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
const oneOf=(value:unknown,values:readonly string[])=>typeof value==='string'&&values.includes(value);
const positiveRevision=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>0;
const timestamp=(value:unknown,now:number)=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&Date.parse(value)<=now+60_000&&Date.parse(value)>=now-ACTION_RETENTION_MS;
function cleanTarget(value:unknown):WorkflowTarget|undefined {
  const target=asObject(value);if(!target||!oneOf(target.kind,['creation-draft','creation-node','creation-use','document','generation','artifact','output'])||!validActionIdentifier(target.id)||!validActionIdentifier(target.revision))return;
  return {kind:target.kind as WorkflowTarget['kind'],id:target.id,revision:target.revision};
}
function cleanWorkflow(value:unknown,now:number):WorkflowObservation|undefined {
  const input=asObject(value),target=cleanTarget(input?.target);
  if(!input||input.version!==WORKFLOW_OBSERVATION_VERSION||!validActionIdentifier(input.instanceId)||!target||!target.kind.startsWith('creation-')||!positiveRevision(input.draftRevision)||!timestamp(input.occurredAt,now))return;
  if(!oneOf(input.stage,['draft','ideas','documents','project','final-review','finalized'])||!oneOf(input.transition,['entered','resumed','interpreted','presented','approved','approval-invalidated','final-review','backtracked','help-opened','draft-preserved','draft-discarded','finalize','internal-failure','reconciled'])||!oneOf(input.status,['attempted','confirmed','blocked','failed','reconciled']))return;
  if(input.blocker!==undefined&&!oneOf(input.blocker,['unseen','incomplete','unapproved','stale-revision','permission','source-unavailable','operation-uncertain','internal','none'])||input.operationId!==undefined&&!validActionIdentifier(input.operationId))return;
  if(input.status==='blocked'&&(!input.blocker||input.blocker==='none'))return;
  if(target.kind==='creation-draft'&&(target.id!==input.instanceId||target.revision!==String(input.draftRevision)))return;
  return {version:WORKFLOW_OBSERVATION_VERSION,instanceId:input.instanceId,stage:input.stage as WorkflowObservation['stage'],transition:input.transition as WorkflowObservation['transition'],status:input.status as WorkflowObservation['status'],target,draftRevision:Number(input.draftRevision),occurredAt:new Date(String(input.occurredAt)).toISOString(),...(input.blocker?{blocker:input.blocker as WorkflowObservation['blocker']}:{}),...(typeof input.operationId==='string'?{operationId:input.operationId}:{})};
}
function cleanSeries(input:Record<string,unknown>,now:number) {
  const target=cleanTarget(input.target);
  if(!target||!positiveRevision(input.revision)||!timestamp(input.occurredAt,now)||!timestamp(input.horizonStartedAt,now)||Date.parse(String(input.occurredAt))<Date.parse(String(input.horizonStartedAt))||!Number.isSafeInteger(input.horizonMs)||Number(input.horizonMs)<1||Number(input.horizonMs)>ACTION_RETENTION_MS)return;
  for(const key of ['supersedesId','operationId','workflowInstanceId'] as const)if(input[key]!==undefined&&!validActionIdentifier(input[key]))return;
  if((input.revision===1)!==(input.supersedesId===undefined))return;
  return {target,revision:Number(input.revision),occurredAt:new Date(String(input.occurredAt)).toISOString(),horizonStartedAt:new Date(String(input.horizonStartedAt)).toISOString(),horizonMs:Number(input.horizonMs),...(typeof input.supersedesId==='string'?{supersedesId:input.supersedesId}:{}),...(typeof input.operationId==='string'?{operationId:input.operationId}:{}),...(typeof input.workflowInstanceId==='string'?{workflowInstanceId:input.workflowInstanceId}:{})};
}
function cleanOutcome(value:unknown,now:number):OutcomeObservation|undefined {
  const input=asObject(value);if(!input||input.version!==OUTCOME_OBSERVATION_VERSION||!validActionIdentifier(input.outcomeId)||!oneOf(input.type,['acknowledged-commit','completed-job','file-retrieved','user-acceptance'])||!oneOf(input.status,['observed','pending','censored','unknown','revoked']))return;
  const series=cleanSeries(input,now);if(!series)return;
  if(input.status==='censored'&&Date.parse(series.occurredAt)<Date.parse(series.horizonStartedAt)+series.horizonMs)return;
  return {...series,version:OUTCOME_OBSERVATION_VERSION,outcomeId:input.outcomeId,type:input.type as OutcomeObservation['type'],status:input.status as OutcomeObservation['status']};
}
function cleanAssessment(value:unknown,now:number):QualityAssessment|undefined {
  const input=asObject(value);if(!input||input.version!==QUALITY_ASSESSMENT_VERSION||!validActionIdentifier(input.assessmentId)||!validActionIdentifier(input.goalId)||!oneOf(input.acceptance,['accepted','needs-work','unknown','revoked'])||!Array.isArray(input.criteria)||input.criteria.length>5)return;
  const series=cleanSeries(input,now);if(!series)return;
  const criteria:QualityAssessment['criteria']=[];
  for(const value of input.criteria){const criterion=asObject(value);if(!criterion||!Number.isSafeInteger(criterion.index)||Number(criterion.index)<0||Number(criterion.index)>4||!oneOf(criterion.result,['met','not-met','unknown'])||criteria.some(row=>row.index===criterion.index))return;criteria.push({index:Number(criterion.index),result:criterion.result as QualityAssessment['criteria'][number]['result']});}
  if(input.acceptance==='revoked'&&criteria.length)return;
  return {...series,version:QUALITY_ASSESSMENT_VERSION,assessmentId:input.assessmentId,goalId:input.goalId,acceptance:input.acceptance as QualityAssessment['acceptance'],criteria};
}

/** Explicit semantic feedback, separate from creative history and passive attention. */
export const ACTION_CONTEXT_VERSION = 'still-action-context-v1';
export const ACTION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export type ActionScope = { projectId?: string; documentId?: string; blockId?: string };
export type StillGoal = { id: string; scope: ActionScope; text: string; criteria: string[]; status: 'active' | 'completed' | 'abandoned'; createdAt: string; expiresAt: string };
export const ACTION_FEEDBACK = ['not-useful-now','already-done','different-goal','keep-available','helpful','unhelpful'] as const;
export type ActionObservationInput = {
  id: string; scope: ActionScope; kind: 'exposure' | 'selection' | 'invocation' | 'cancellation' | 'failure' | 'feedback' | 'commit';
  decisionId?: string; actionId?: string; surface: string; source: 'toolbar' | 'more' | 'palette' | 'direct';
  parentId?: string; eventIds?: string[]; jobId?: string; feedback?: typeof ACTION_FEEDBACK[number];
  feedbackScope?: 'decision' | 'document' | 'project'; feedbackExpiresAt?: string; displayedActionIds?: string[]; primaryActionId?: string; interactiveLatencyMs?: number;
};
export type ActionObservation = ActionObservationInput & { recordedAt: string; expiresAt: string; evidence?: { eventIds: string[]; eventTypes: string[]; correlationIds: string[]; jobId?: string; jobStatus?: string; authority: 'server-verified-references' } };
export type StillActionContext = { version: typeof ACTION_CONTEXT_VERSION; enabled: boolean; expiresAt?: string; directDecisionId?: string; directContextExpiresAt?: string; goal?: StillGoal; observations: ActionObservation[]; coverage: { status?: 'complete'|'unavailable'; limit: number; returned: number; hasMore: boolean; feedback?: {limit:number;returned:number;hasMore:boolean}; interpretation: string } };
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
  if (!scope || !validActionIdentifier(input.id) || !['exposure','selection','invocation','cancellation','failure','feedback','commit'].includes(String(input.kind)) || !['toolbar','more','palette','direct'].includes(String(input.source)) || !validActionIdentifier(input.surface)) return;
  const kind = input.kind as ActionObservationInput['kind'];
  if (kind === 'exposure' && input.actionId !== undefined) return;
  if (kind !== 'exposure' && (typeof input.actionId !== 'string' || !knownActions.includes(input.actionId))) return;
  if (kind === 'exposure' && (!validActionIdentifier(input.decisionId) || !Array.isArray(input.displayedActionIds) || !input.displayedActionIds.length || input.displayedActionIds.length > 80 || input.displayedActionIds.some(id => typeof id !== 'string' || !knownActions.includes(id)))) return;
  for (const key of ['decisionId','parentId','jobId'] as const) if (input[key] !== undefined && !validActionIdentifier(input[key])) return;
  if (input.eventIds !== undefined && (!Array.isArray(input.eventIds) || input.eventIds.length > 24 || input.eventIds.some(id => !validActionIdentifier(id)))) return;
  if (kind === 'commit' && !input.jobId && (!Array.isArray(input.eventIds) || !input.eventIds.length)) return;
  if (kind !== 'commit' && (input.jobId || input.eventIds)) return;
  if (kind !== 'feedback' && (input.feedback !== undefined || input.feedbackScope !== undefined || input.feedbackExpiresAt !== undefined)) return;
  if (kind !== 'exposure' && (input.displayedActionIds !== undefined || input.primaryActionId !== undefined || input.interactiveLatencyMs !== undefined)) return;
  if (input.interactiveLatencyMs !== undefined && (!Number.isSafeInteger(input.interactiveLatencyMs) || Number(input.interactiveLatencyMs)<0 || Number(input.interactiveLatencyMs)>300_000)) return;
  if (input.primaryActionId !== undefined && (typeof input.primaryActionId !== 'string' || !Array.isArray(input.displayedActionIds) || !input.displayedActionIds.includes(input.primaryActionId))) return;
  if (kind === 'feedback' && !(ACTION_FEEDBACK as readonly unknown[]).includes(input.feedback)) return;
  if (input.feedbackScope !== undefined && !['decision','document','project'].includes(String(input.feedbackScope))) return;
  if (input.feedbackScope === 'decision' && !input.decisionId || input.feedbackScope === 'document' && !scope.documentId || input.feedbackScope === 'project' && !scope.projectId) return;
  if (input.feedbackExpiresAt !== undefined && (typeof input.feedbackExpiresAt !== 'string' || !Number.isFinite(Date.parse(input.feedbackExpiresAt)) || Date.parse(input.feedbackExpiresAt) <= now || Date.parse(input.feedbackExpiresAt) > now + ACTION_RETENTION_MS)) return;
  const result: ActionObservationInput = { id: input.id, scope, kind, surface: input.surface, source: input.source as ActionObservationInput['source'] };
  for (const key of ['decisionId','actionId','parentId','jobId','feedback','feedbackScope','feedbackExpiresAt','primaryActionId','interactiveLatencyMs'] as const) if (input[key] !== undefined) Object.assign(result, { [key]: input[key] });
  if (result.feedbackExpiresAt) result.feedbackExpiresAt = new Date(result.feedbackExpiresAt).toISOString();
  if (Array.isArray(input.eventIds)) result.eventIds = [...new Set(input.eventIds as string[])];
  if (kind === 'exposure') result.displayedActionIds = [...new Set(input.displayedActionIds as string[])];
  return result;
}

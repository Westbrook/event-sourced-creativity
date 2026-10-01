import type { ActionObservation, QualityAssessment, StillGoal } from './action-outcomes.ts';

/** Only explicit, retained review evidence can seed a later assessment. */
export function qualityReviewCandidate(rows: readonly ActionObservation[], goal: StillGoal | undefined, now = Date.now()) {
  if (!goal || Date.parse(goal.expiresAt) <= now || !goal.criteria.length) return;
  const retained = rows.filter(row => Date.parse(row.expiresAt) > now && row.actionId);
  const corrected = new Set(retained.flatMap(row => row.assessment?.supersedesId ? [row.assessment.supersedesId] : []));
  const candidates = retained.filter(row => row.assessment?.goalId === goal.id && !corrected.has(row.id)
    || row.workflow?.transition === 'final-review' && row.workflow.status === 'confirmed' && row.workflow.occurredAt >= goal.createdAt);
  const reviewedAt = (row:ActionObservation) => row.assessment?.horizonStartedAt ?? row.workflow!.occurredAt;
  return candidates.sort((a,b) => reviewedAt(b).localeCompare(reviewedAt(a)) || (b.assessment?.revision??0)-(a.assessment?.revision??0) || b.recordedAt.localeCompare(a.recordedAt))[0];
}

export function qualityReviewAssessment(row: ActionObservation, goal: StillGoal, acceptance: QualityAssessment['acceptance'], criteria: QualityAssessment['criteria'], now = Date.now()): QualityAssessment {
  const previous = row.assessment;
  if (!row.actionId || Date.parse(row.expiresAt) <= now || Date.parse(goal.expiresAt) <= now || previous && previous.goalId !== goal.id || !previous && (!row.workflow || row.workflow.transition !== 'final-review' || row.workflow.status !== 'confirmed')) throw new Error('This review is no longer available.');
  const horizonStartedAt = previous?.horizonStartedAt ?? row.workflow!.occurredAt;
  const horizonMs = previous?.horizonMs ?? Math.min(7 * 86400000, Date.parse(row.expiresAt) - Date.parse(horizonStartedAt), Date.parse(goal.expiresAt) - Date.parse(horizonStartedAt));
  if (horizonMs < 1) throw new Error('This review is no longer retained.');
  return {
    version:'still-quality-assessment-v1', assessmentId:previous?.assessmentId ?? crypto.randomUUID(), revision:(previous?.revision ?? 0)+1,
    ...(previous ? {supersedesId:row.id} : {}), target:previous?.target ?? row.workflow!.target,
    goalId:goal.id, criteria:acceptance === 'revoked' ? [] : criteria, acceptance,
    ...((previous?.workflowInstanceId ?? row.workflow?.instanceId) ? {workflowInstanceId:previous?.workflowInstanceId ?? row.workflow?.instanceId} : {}),
    ...(previous?.operationId ? {operationId:previous.operationId} : {}),
    occurredAt:new Date(now).toISOString(), horizonStartedAt, horizonMs,
  };
}

import { claimedSceneBudgetGuard, type ClaimedSceneBudget } from "./pilot-policy.ts";
import { requireSceneCostDeadline, type PreparedSceneCost } from "./scene-cost-consent.ts";
import type { WorkerEnv } from "./runtime.ts";
import { ProviderRequestError } from "./provider-errors.ts";

/** Nominal server-only origin. An incoming JSON code/marker cannot create this error. */
export class ScenePaidPolicyStopError extends ProviderRequestError {
  readonly code="scene_paid_authority_changed";
  readonly status=403;
  constructor(){
    super({code:"scene_paid_authority_changed",category:"access",scope:"project",action:"check_project",
      message:"Scene generation stopped before the next provider call because current project access, pilot eligibility, or budget policy could not be verified. Review the original receipt and current eligibility before preparing another request.",
      retryable:false,retryAfterMs:null,requestId:null,httpStatus:403});
    this.name="ScenePaidPolicyStopError";
  }
}
export function requireScenePaidDeadline(value:string|null){
  if(value!==null&&!(Date.parse(value)>Date.now()))throw new ScenePaidPolicyStopError();
}


/**
 * Only new provider dispatch uses this proof. Free reads and the cached-plan branch do
 * not call it; their pre-existing authorization and recovery policies remain unchanged.
 */
export async function scenePaidDispatchDeadline(env: WorkerEnv, prepared: PreparedSceneCost, claim: ClaimedSceneBudget): Promise<{validUntil:string;pilotValidUntil:string|null}> {
  const scope=prepared.scope;
  if (claim.actorUserId!==prepared.binding.actorUserId || claim.streamId!==prepared.binding.streamId
    || claim.period!==prepared.binding.period || Boolean(scope)!==Boolean(claim.projectScope)
    || scope && (!claim.projectScope || scope.organizationId!==claim.projectScope.organizationId
      || scope.projectAccessId!==claim.projectScope.projectAccessId || scope.projectId!==claim.projectScope.projectId
      || scope.ownerUserId!==claim.projectScope.ownerUserId || scope.actorUserId!==claim.projectScope.actorUserId)) {
    throw new ScenePaidPolicyStopError();
  }
  const paid=claimedSceneBudgetGuard(env,claim);
  // One final SQL snapshot recertifies BOTH source/custody and the originally billed hold.
  // The returned cohort end belongs to that same snapshot, not a subsequent lookup.
  const current=await env.DB.prepare(`SELECT 1 AS current,
    (SELECT ends_at FROM pilot_cohorts WHERE cohort_id=? AND organization_id=?) AS pilot_ends_at
    WHERE (${prepared.guard.sql}) AND (${paid.sql})`)
    .bind(claim.pilotCohortId??"",claim.projectScope?.organizationId??"",...prepared.guard.bindings,...paid.bindings)
    .first<{current:number;pilot_ends_at:string|null}>();
  if(!current || claim.pilotCohortId && (!current.pilot_ends_at || !Number.isFinite(Date.parse(current.pilot_ends_at)))) {
    throw new ScenePaidPolicyStopError();
  }
  const validUntil=current.pilot_ends_at && Date.parse(current.pilot_ends_at)<Date.parse(prepared.validUntil)
    ? current.pilot_ends_at : prepared.validUntil;
  requireScenePaidDeadline(current.pilot_ends_at);
  requireSceneCostDeadline({validUntil});
  return {validUntil,pilotValidUntil:current.pilot_ends_at};
}

import { claimedSceneBudgetGuard, type ClaimedSceneBudget } from "./pilot-policy.ts";
import { requireSceneCostDeadline, type PreparedSceneCost } from "./scene-cost-consent.ts";
import type { WorkerEnv } from "./runtime.ts";
import { ProviderRequestError } from "./provider-errors.ts";
import { outputProofReadStatements } from "./output-disclosure-proof.ts";

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
  // One final batch snapshot recertifies every original source/custody proof
  // AND the originally billed hold. No giant conjunction or later pilot read.
  const sourceStatements=outputProofReadStatements(env,prepared.assertions);
  const checked=await env.DB.batch<Record<string,unknown>>([...sourceStatements,
    env.DB.prepare(`SELECT 1 AS current,
      (SELECT ends_at FROM pilot_cohorts WHERE cohort_id=? AND organization_id=?) AS pilot_ends_at
      WHERE (${paid.sql})`)
      .bind(claim.pilotCohortId??"",claim.projectScope?.organizationId??"",...paid.bindings),
  ]);
  if(!Array.isArray(checked)||checked.length!==sourceStatements.length+1)throw new ScenePaidPolicyStopError();
  // Array.from inspects every expected index; a sparse returned slot is missing
  // evidence, not a predicate that Array.prototype.some may silently skip.
  const sourceChecks=Array.from({length:sourceStatements.length},(_,index)=>checked[index]);
  const paidResult=checked[sourceStatements.length];
  const row=paidResult?.results?.[0];
  if(checked.length!==sourceStatements.length+1 || sourceChecks.some(result=>!result||result.success!==true
    || !Array.isArray(result.results) || result.results.length!==1 || result.results[0]?.current!==1)
    || !paidResult || paidResult.success!==true || !Array.isArray(paidResult.results) || paidResult.results.length!==1
    || row?.current!==1 || row?.pilot_ends_at!==null && typeof row?.pilot_ends_at!=="string") {
    throw new ScenePaidPolicyStopError();
  }
  const current=row as {current:number;pilot_ends_at:string|null};
  if(claim.pilotCohortId && (!current.pilot_ends_at || !Number.isFinite(Date.parse(current.pilot_ends_at)))
    || prepared.assertions.some(assertion=>assertion.deadlineMs!==undefined && !(assertion.deadlineMs>Date.now()))) {
    throw new ScenePaidPolicyStopError();
  }
  const validUntil=current.pilot_ends_at && Date.parse(current.pilot_ends_at)<Date.parse(prepared.validUntil)
    ? current.pilot_ends_at : prepared.validUntil;
  requireScenePaidDeadline(current.pilot_ends_at);
  requireSceneCostDeadline({validUntil});
  return {validUntil,pilotValidUntil:current.pilot_ends_at};
}

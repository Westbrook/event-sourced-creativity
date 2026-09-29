import { canonical, hash, seal, verifySeal } from '../core.mjs';
import { operationKey } from '../execution-plan.mjs';
export const FINANCIAL_POLICY_VERSION='generation-financial-policy-v1';
const deny=()=>{throw Error('study_financial_policy_invalid');};
const text=v=>typeof v==='string'&&v.trim().length>0;
const amount=v=>Number.isSafeInteger(v)&&v>=0;
export const sealFinancialPolicy=value=>seal('financial-policy',value);
/** Integrity is not authority. Only the separately stored server grant can authorize this descriptor. */
export function validateFinancialPolicy(p,scope,{now=Date.now()}={}) {
  verifySeal('financial-policy',p);
  if(p.version!==FINANCIAL_POLICY_VERSION||canonical(p.scope)!==canonical(scope)||!['image','preparation'].includes(scope.kind)
    ||!['operationId','planId','sourceHash','directionHash','requestHash','runtimeHash','inventoryHash','payerId','accountId','region'].every(k=>text(scope[k]))
    ||!amount(p.reservationMicrousd)||p.reservationMicrousd===0||!amount(p.lifecycleReserveMicrousd)
    ||!amount(p.reservationMicrousd+p.lifecycleReserveMicrousd)||p.inFlightLimit!==1
    ||p.stopBehavior!=='stop-before-next-stage-no-retry'||p.overrunPolicy!=='retain-and-hold'
    ||p.nextPurchase!=='after-settlement-and-funded-lifecycle'||!Number.isFinite(Date.parse(p.expiresAt))||Date.parse(p.expiresAt)<=now)deny();
  const e=p.estimate,l=p.lifecycle;
  if(!e||!amount(e.microusd)||e.microusd>p.reservationMicrousd||!text(e.costBasis)||!text(e.evidenceRef)||!Array.isArray(e.assumptions)||!e.assumptions.length||!e.assumptions.every(text)
    ||!Number.isFinite(Date.parse(e.reviewExpiresAt))||Date.parse(e.reviewExpiresAt)<=now||Date.parse(p.expiresAt)>Date.parse(e.reviewExpiresAt)
    ||!l||!text(l.scope)||!text(l.liabilityOwner)||!text(l.evidenceRef)||!amount(l.maximumMicrousd)||l.maximumMicrousd>p.lifecycleReserveMicrousd
    ||!Number.isFinite(Date.parse(l.through))||Date.parse(l.through)<Date.parse(p.expiresAt))deny();
  if(p.mode==='bounded-proof'){
    if(!p.bound||!amount(p.bound.maximumCostMicrousd)||p.bound.maximumCostMicrousd===0||p.bound.maximumCostMicrousd>p.reservationMicrousd+p.lifecycleReserveMicrousd
      ||!text(p.bound.evidenceRef)||!text(p.bound.scope)||p.residualDecision!==null)deny();
  }else if(p.mode==='accepted-estimate'){
    if(p.bound!==null||p.maximumLossMicrousd!==null||p.providerEnforcedChargeCap!==false||p.residualDecision?.accepted!==true
      ||!text(p.residualDecision.decisionRef)||!text(p.residualDecision.liabilityOwner)||p.residualDecision.unknownMaximumAccepted!==true)deny();
  }else deny();
  return p;
}
export function imageFinancialScope(plan,trial,ownerId,account) {
  const c=plan.manifest.cells.find(c=>c.id===trial.cellId);
  return {operationId:operationKey(ownerId,plan,trial),planId:plan.id,kind:'image',sourceHash:plan.candidate.retainedInputs.sourceSha256,directionHash:plan.candidate.retainedInputs.directionSha256,
    requestHash:hash(plan.requests[trial.cellId]),promptHash:c.promptHash,runtimeHash:hash(plan.runtimeIdentity),inventoryHash:hash(plan.inventory),payerId:ownerId,accountId:account?.accountId,region:account?.region};
}
export async function resolveFinancialPolicy(env,{policy,scope,grantId,ownerId}) {
  validateFinancialPolicy(policy,scope);
  if(scope.payerId!==ownerId)deny();
  const json=canonical(policy);
  const guard={sql:"EXISTS(SELECT 1 FROM generation_study_financial_grants WHERE grant_id=? AND operation_id=? AND owner_id=? AND policy_id=? AND policy_json=? AND status='authorized' AND expires_at=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))",bindings:[grantId,scope.operationId,ownerId,policy.id,json,policy.expiresAt]};
  if(!await env.DB.prepare(`SELECT 1 AS valid WHERE ${guard.sql}`).bind(...guard.bindings).first())throw Error('study_financial_grant_unavailable');
  return {policy,guard,reservationMicrousd:policy.reservationMicrousd,lifecycleReserveMicrousd:policy.lifecycleReserveMicrousd};
}

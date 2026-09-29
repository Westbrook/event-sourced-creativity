import {canonical,hash,seal,verifySeal} from '../core.mjs';
import {operationKey} from '../execution-plan.mjs';
export const PAIR_PLAN_VERSION='generation-supplied-study-v3';
export const PAIR_POLICY_VERSION='generation-financial-policy-v2';
export const PAIR_AUTHORITY_VERSION='authoring-study-v2';
export const PAIR_ADVANCEMENT='after-original-result-and-accepted-pair-exposure';
export const pendingPair=plan=>plan?.version===PAIR_PLAN_VERSION;
const amount=x=>Number.isSafeInteger(x)&&x>0;
const deny=()=>{throw Error('study_pair_policy_invalid');};
/** Descriptor only. The authoring receipt and exact financial grants supply authority. */
export function pairExposure(proposal,account){
 const plan=proposal.plan;
 return seal('study-pair-exposure',{version:1,mode:PAIR_ADVANCEMENT,planId:plan.id,ownerId:proposal.ownerId,grantId:proposal.grantId,proposalId:proposal.proposalId,accountId:account.accountId,region:account.region,
  expiresAt:plan.packet.input.expiresAt,totalMicrousd:proposal.allowanceMicrousd,totalTokens:proposal.tokenAllowance*2,
  arms:plan.manifest.trials.map(t=>{const a=proposal.arms.find(a=>a.arm===t.id);const id=operationKey(proposal.ownerId,plan,t);return{arm:t.id,operationId:id,tokenReservationId:'h3-token-'+hash(id),costReservationId:'h3-cost-'+hash(id),lifecycleReservationId:'f3-lifecycle-'+hash(id),cost:a.reservationMicrousd,lifecycle:a.lifecycleReserveMicrousd,tokens:proposal.tokenAllowance};})});
}
export function validatePairExposure(pair,scope,policy){
 verifySeal('study-pair-exposure',pair);
 if(pair.version!==1||pair.mode!==PAIR_ADVANCEMENT||pair.planId!==scope.planId||pair.ownerId!==scope.payerId||pair.accountId!==scope.accountId||pair.region!==scope.region||pair.expiresAt!==policy.expiresAt||!pair.proposalId||!pair.grantId||!amount(pair.totalMicrousd)||!amount(pair.totalTokens)||pair.arms?.length!==2)deny();
 if(canonical(pair.arms.map(a=>a.arm))!==canonical(['baseline','treatment'])||new Set(pair.arms.map(a=>a.operationId)).size!==2||pair.arms.some(a=>!a.operationId||a.tokenReservationId!=='h3-token-'+hash(a.operationId)||a.costReservationId!=='h3-cost-'+hash(a.operationId)||a.lifecycleReservationId!=='f3-lifecycle-'+hash(a.operationId)||![a.cost,a.lifecycle,a.tokens].every(amount)))deny();
 const arm=pair.arms.find(a=>a.operationId===scope.operationId);
 if(!arm||arm.cost!==policy.reservationMicrousd||arm.lifecycle!==policy.lifecycleReserveMicrousd||pair.arms.reduce((n,a)=>n+a.cost+a.lifecycle,0)>pair.totalMicrousd||pair.arms.reduce((n,a)=>n+a.tokens,0)>pair.totalTokens)deny();
 if(!Number.isSafeInteger(pair.arms.reduce((n,a)=>n+a.cost+a.lifecycle,0))||!Number.isSafeInteger(pair.arms.reduce((n,a)=>n+a.tokens,0)))deny();
 if(policy.pairAcceptance?.decision!=='ALLOW_EXACT_TREATMENT_WITH_BASELINE_UNSETTLED'||policy.pairAcceptance?.pairId!==pair.id||typeof policy.pairAcceptance?.evidenceRef!=='string'||!policy.pairAcceptance.evidenceRef)deny();
 return pair;
}

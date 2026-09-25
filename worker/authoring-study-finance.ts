import {consentHash} from './consequential-consent.ts';
import type {StudyApprovalProposal,StudyArmApproval,StudyEvidence} from './authoring-study-types.ts';
import {opaque,studyAmount,studyDate,studyFail} from './authoring-study-proof.ts';
// @ts-expect-error Existing optional F3 module is JavaScript; validated at its own boundary.
import {imageFinancialScope,sealFinancialPolicy,validateFinancialPolicy,FINANCIAL_POLICY_VERSION} from '../evals/generation-reliability/native-host/financial-policy.mjs';
export type StudyFinancialPolicy={id:string;scope:{operationId:string;accountId:string;region:string;[key:string]:unknown};mode:string;expiresAt:string;reservationMicrousd:number;lifecycleReserveMicrousd:number;[key:string]:unknown};
export function studyApprovalInventory(proposal:StudyApprovalProposal){
 return {version:1,providerPosts:0,privateReviewRecords:1,privateEvidenceRecords:proposal.arms.reduce((n,a)=>n+(a.mode==='bounded-proof'?7:6),0),privateCopyRecords:2,durableConfigurationRecords:1,durableEvidenceReferenceRecords:proposal.arms.reduce((n,a)=>n+(a.mode==='bounded-proof'?7:6),0),durableReceiptRecords:1,studyGrantRecords:1,suppliedReviewRecords:1,financialGrantRecords:2,materialCommitInserts:7,privateEvidenceMaximumBytesPerRecord:262144,privateCopiesMaximumBytesPerRecord:1048576,expiry:proposal.plan.packet.input.expiresAt,lifecycleScope:'study-and-financial-retention'};
}
export async function studyEvidenceScope(proposal:StudyApprovalProposal,arm:StudyArmApproval){
 return consentHash({proposalId:proposal.proposalId,owner:proposal.ownerId,planId:proposal.plan.id,runtime:proposal.runtimeIdentity,arm:arm.arm,mode:arm.mode,reservationMicrousd:arm.reservationMicrousd,lifecycleReserveMicrousd:arm.lifecycleReserveMicrousd,inventory:proposal.plan.inventory,approvalInventory:studyApprovalInventory(proposal)});
}
export async function compileStudyFinancialPolicy(proposal:StudyApprovalProposal,arm:StudyArmApproval,values:unknown[]):Promise<StudyFinancialPolicy>{
 const scopeHash=await studyEvidenceScope(proposal,arm),expiry=proposal.plan.packet.input.expiresAt;
 if(!['accepted-estimate','bounded-proof'].includes(arm.mode)||!studyAmount(arm.reservationMicrousd)||!arm.reservationMicrousd||!studyAmount(arm.lifecycleReserveMicrousd)||!arm.lifecycleReserveMicrousd)studyFail('financial_mode_or_amount');
 const expected=['account','rate','liability','settlement','lifecycle','deletion',...(arm.mode==='bounded-proof'?['bound']:[])];
 if(values.length!==expected.length||arm.evidence.length!==expected.length||new Set(arm.evidence.map(e=>e.id)).size!==expected.length)studyFail('evidence_inventory');
 const records=values as StudyEvidence[];
 for(const [i,v] of records.entries())if(!v||v.version!==1||v.kind!==arm.evidence[i].kind||!expected.includes(v.kind)||v.scopeHash!==scopeHash||v.classification!==proposal.classification||typeof v.terms!=='string'||!v.terms.trim()||v.terms.length>32000)studyFail('evidence_terms_or_scope');
 const one=<K extends StudyEvidence['kind']>(kind:K)=>{const found=records.filter(v=>v.kind===kind);if(found.length!==1)studyFail('evidence_inventory');return found[0] as Extract<StudyEvidence,{kind:K}>;};
 const account=one('account'),rate=one('rate'),liability=one('liability'),settlement=one('settlement'),life=one('lifecycle'),deletion=one('deletion');
 if(!opaque(account.accountId)||!['us','eu','global'].includes(account.region)||!opaque(account.credentialBinding)||account.projectHeader!==null&&!opaque(account.projectHeader)
 ||rate.costBasis!=='reviewed-exact-inventory'||!studyAmount(rate.estimateMicrousd)||!studyDate(rate.reviewExpiresAt)||rate.reviewExpiresAt<expiry
 ||liability.liabilityOwner!==proposal.ownerId||liability.mode!==arm.mode||!opaque(settlement.verifierId)||settlement.method!=='original-request-final-incurred'||!studyDate(settlement.evidenceRetentionThrough)
 ||life.liabilityOwner!==proposal.ownerId||life.scope!=='study-and-financial-retention'||!opaque(life.fundingRef)||!studyAmount(life.maximumMicrousd)||!life.maximumMicrousd||life.maximumMicrousd>arm.lifecycleReserveMicrousd||!studyDate(life.fundedThrough)||life.fundedThrough<expiry||settlement.evidenceRetentionThrough>life.fundedThrough||settlement.evidenceRetentionThrough<expiry
 ||!opaque(deletion.operatorId)||deletion.method!=='verified-original-object-and-private-evidence'||!studyDate(deletion.through)||deletion.through<life.fundedThrough)studyFail('financial_evidence_invalid');
 const ref=(kind:StudyEvidence['kind'])=>arm.evidence.find(e=>e.kind===kind)!.id;
 let bound=null;
 if(arm.mode==='bounded-proof'){
  const b=one('bound');
  if(b.method!=='substantiated-exact-inventory'||!opaque(b.proofRef)||!studyAmount(b.maximumCostMicrousd)||b.maximumCostMicrousd<rate.estimateMicrousd+life.maximumMicrousd)studyFail('bound_evidence_invalid');
  bound={maximumCostMicrousd:b.maximumCostMicrousd,evidenceRef:ref('bound'),scope:'exact-study-inventory-including-financial-retention'};
 }
 // No private terms or caller-supplied descriptions enter immortal financial JSON.
 const policy=sealFinancialPolicy({version:FINANCIAL_POLICY_VERSION,scope:imageFinancialScope(proposal.plan,proposal.plan.manifest.trials.find(t=>t.id===arm.arm),proposal.ownerId,account),
  mode:arm.mode,reservationMicrousd:arm.reservationMicrousd,lifecycleReserveMicrousd:arm.lifecycleReserveMicrousd,
  estimate:{microusd:rate.estimateMicrousd,costBasis:'reviewed-exact-inventory',evidenceRef:ref('rate'),reviewExpiresAt:rate.reviewExpiresAt,assumptions:['two-supplied-copies','three-provider-stages-per-arm','nine-evidence-records-per-arm','original-only-recovery','funded-financial-retention-and-verified-deletion','one-private-authoring-review','six-typed-evidence-records-per-arm-plus-bound-if-applicable','one-configuration-and-one-receipt-plus-opaque-evidence-references']},bound,
  residualDecision:arm.mode==='accepted-estimate'?{accepted:true,unknownMaximumAccepted:true,decisionRef:ref('liability'),liabilityOwner:proposal.ownerId}:null,
  maximumLossMicrousd:null,providerEnforcedChargeCap:false,expiresAt:expiry,inFlightLimit:1,stopBehavior:'stop-before-next-stage-no-retry',overrunPolicy:'retain-and-hold',nextPurchase:'after-settlement-and-funded-lifecycle',
  lifecycle:{scope:'exact-study-inventory-including-financial-retention',liabilityOwner:proposal.ownerId,evidenceRef:ref('lifecycle'),through:life.fundedThrough,maximumMicrousd:life.maximumMicrousd}}) as StudyFinancialPolicy;
 validateFinancialPolicy(policy,policy.scope);return policy;
}

import type {WorkerEnv} from './runtime.ts';
export const STUDY_APPROVAL_OPERATION='generation-supplied-study-approval' as const;
export const STUDY_APPROVAL_VERSION='authoring-study-v1';
export type StudySqlGuard={sql:string;bindings:unknown[]};
export type StudyApprovalEnv=WorkerEnv & {FORMA_GENERATION_STUDY_APPROVAL_ENABLED?:string;FORMA_GENERATION_STUDY_ENABLED?:string;FORMA_GENERATION_STUDY_ORIGIN?:string};
export type StudyPlan={id:string;version:string;user:string;packet:{id:string;input:{expiresAt:string};suppliedSnapshot:unknown;direction:{value:unknown};protocol:unknown;[key:string]:unknown};candidate:{id:string;suppliedInputs:{reviewId:string;authorityVersion:string;sourceRef:string;directionRef:string;sourceSha256:string;directionSha256:string;expiresAt:string;declaredAuthor:string;approvedUse:string}};runtimeIdentity:Record<string,unknown>;manifest:{trials:{id:string;cellId:string;repeat:number}[];cells:unknown[]};inventory:unknown;requests:unknown};
export type StudyEvidenceKind='account'|'rate'|'liability'|'settlement'|'lifecycle'|'deletion'|'bound';
export type StudyEvidenceReference={id:string;kind:StudyEvidenceKind;authorityId:string;contentRef:string;contentHash:string};
export type StudyEvidenceBase={version:1;classification:'synthetic'|'actual';kind:StudyEvidenceKind;scopeHash:string;terms:string};
export type StudyEvidence=StudyEvidenceBase & (
 {kind:'account';accountId:string;region:'us'|'eu'|'global';credentialBinding:string;projectHeader:string|null}|
 {kind:'rate';costBasis:'reviewed-exact-inventory';estimateMicrousd:number;reviewExpiresAt:string}|
 {kind:'liability';liabilityOwner:string;mode:'accepted-estimate'|'bounded-proof'}|
 {kind:'settlement';verifierId:string;method:'original-request-final-incurred';evidenceRetentionThrough:string}|
 {kind:'lifecycle';liabilityOwner:string;maximumMicrousd:number;fundedThrough:string;scope:'study-and-financial-retention';fundingRef:string}|
 {kind:'deletion';operatorId:string;method:'verified-original-object-and-private-evidence';through:string}|
 {kind:'bound';maximumCostMicrousd:number;method:'substantiated-exact-inventory';proofRef:string}
);
export type StudyArmApproval={arm:'baseline'|'treatment';mode:'accepted-estimate'|'bounded-proof';reservationMicrousd:number;lifecycleReserveMicrousd:number;evidence:StudyEvidenceReference[]};
export type StudyApprovalProposal={operation:typeof STUDY_APPROVAL_OPERATION;version:1;proposalId:string;ownerId:string;intentId:string;grantId:string;plan:StudyPlan;runtimeIdentity:Record<string,unknown>;allowanceMicrousd:number;tokenAllowance:number;classification:'synthetic'|'actual';arms:StudyArmApproval[]};
export type StudyApprovalCommand={action:'preview';proposalId:string}|{action:'status';proposalId:string}|{action:'commit';proposalId:string;previewId:string;displayHash:string;intentId:string;decision:'APPROVE_STUDY_ACCEPT_UNKNOWN_EXPOSURE'|'APPROVE_STUDY_BOUNDED_PROOF'};
export type StudyApprovalConfiguration={proposals:readonly StudyApprovalProposal[]};

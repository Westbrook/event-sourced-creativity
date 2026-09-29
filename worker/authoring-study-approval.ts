import {canonicalConsent,consentHash} from './consequential-consent.ts';
import type {PilotUser} from './pilot-policy.ts';
import {STUDY_APPROVAL_OPERATION,STUDY_APPROVAL_VERSION,type StudyApprovalEnv,type StudyApprovalProposal,type StudyApprovalConfiguration,type StudyApprovalCommand,type StudySqlGuard} from './authoring-study-types.ts';
import {studyFail,opaque,studyAmount,studyDate,studySchemaGuard,studyConfigurationGuard,readStudyEvidence,studyPrivateGuard,authoringStudyExecutionGuards} from './authoring-study-proof.ts';
import {compileStudyFinancialPolicy,studyApprovalInventory,type StudyFinancialPolicy} from './authoring-study-finance.ts';
// @ts-expect-error Existing optional study modules are JS, with their runtime validators retained.
import {authenticateStudy,checkedBatch,assertion} from '../evals/generation-reliability/native-host/authority.mjs';
// @ts-expect-error Existing P2 plan validates its sealed complete wire and protocol.
import {validateSuppliedPlan} from '../evals/generation-reliability/p2/contract.mjs';
// @ts-expect-error Existing canonical study hashing, not a new identity algorithm.
import {hash,canonical,freeze} from '../evals/generation-reliability/core.mjs';
// @ts-expect-error Existing original-purchase operation identity.
import {operationKey,safetyIdentifier} from '../evals/generation-reliability/execution-plan.mjs';
// @ts-expect-error Existing supplied intake now exposes statement-only copy preparation.
import {reviewBinding,principalFingerprint,prepareSuppliedStudyCopies,suppliedStudyInputs} from '../evals/generation-reliability/native-host/supplied-authority.mjs';
// @ts-expect-error Existing immutable F3 grant resolution is unchanged.
import {resolveFinancialPolicy} from '../evals/generation-reliability/native-host/financial-policy.mjs';

const response=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'private, no-store'}});
const exact=(body:Record<string,unknown>,keys:string[])=>canonicalConsent(Object.keys(body).sort())===canonicalConsent(keys.sort());
const decision=(p:StudyApprovalProposal)=>p.version===2?'APPROVE_EXACT_PAIR_WITH_PENDING_BASELINE':p.arms.some(a=>a.mode==='accepted-estimate')?'APPROVE_STUDY_ACCEPT_UNKNOWN_EXPOSURE':'APPROVE_STUDY_BOUNDED_PROOF';
const financialGuard=(p:StudyApprovalProposal,f:StudyFinancialPolicy):StudySqlGuard=>({sql:"EXISTS(SELECT 1 FROM generation_study_financial_grants WHERE grant_id=? AND operation_id=? AND owner_id=? AND policy_id=? AND policy_json=? AND expires_at=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND status='authorized')",bindings:[p.grantId,f.scope.operationId,p.ownerId,f.id,canonical(f),f.expiresAt]});

/** Single finite authoring operation. No route registration, schema installer, evidence issuer or provider dispatch.
 * Configuration and verified evidence are supplied by their server owners, never the HTTP body.
 * Synthetic classification is displayed and can establish ONLY local fixture behavior. */
export function createAuthoringStudyApproval(configuration:StudyApprovalConfiguration){
 const selected=freeze(structuredClone(configuration)) as StudyApprovalConfiguration;
 return async function handle(request:Request,env:StudyApprovalEnv):Promise<Response>{
  if(env.FORMA_GENERATION_STUDY_APPROVAL_ENABLED!=='1')return response({status:'disabled',newPurchases:0});
  const db=env.DB;
  const current=()=>{if(env.DB!==db)studyFail('database_changed');if(env.FORMA_GENERATION_STUDY_APPROVAL_ENABLED!=='1')studyFail('disabled');};
  try{
   if(request.method!=='POST'||request.headers.get('content-type')?.split(';')[0]!=='application/json')studyFail('command_required');
   // Bounded streaming parser; reject before retaining an oversized body.
   const reader=request.body?.getReader();if(!reader)studyFail('command_required');
   let size=0;const chunks:Uint8Array[]=[];
   try{for(;;){const r=await reader!.read();current();if(r.done)break;size+=r.value.byteLength;if(size>2048){void reader!.cancel().catch(()=>{});studyFail('command_too_large');}chunks.push(r.value);}}finally{reader!.releaseLock();}
   const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
   const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as Record<string,unknown>;
   if(!body||Array.isArray(body)||!['preview','commit','status'].includes(String(body.action))||!opaque(body.proposalId)||!exact(body,body.action==='commit'?['action','proposalId','previewId','displayHash','intentId','decision']:['action','proposalId']))studyFail('command_invalid');
   const command=body as StudyApprovalCommand;
   const matches=selected.proposals.filter(p=>p.proposalId===command.proposalId);if(matches.length!==1)studyFail('proposal_unavailable');
   const p=matches[0],plan=p.plan,b=plan.candidate.suppliedInputs,expiry=plan.packet.input.expiresAt;
   const a=await authenticateStudy(request,env,{recovery:true,supplied:true,pair:p.version===2}) as {user:PilotUser;guard:StudySqlGuard};current();
   if(p.operation!==STUDY_APPROVAL_OPERATION||![1,2].includes(p.version)||p.ownerId!==a.user.userId||plan.user!==safetyIdentifier(p.ownerId)||b.authorityVersion!==(p.version===2?'authoring-study-v2':STUDY_APPROVAL_VERSION)||plan.version!==(p.version===2?'generation-supplied-study-v3':'generation-supplied-study-v2')||!['actual','synthetic'].includes(p.classification)||![p.proposalId,p.intentId,p.grantId,b.reviewId,b.sourceRef,b.directionRef].every(opaque)||!studyDate(expiry)||expiry<=new Date(Date.now()).toISOString()||canonical(p.runtimeIdentity)!==canonical(plan.runtimeIdentity)||!studyAmount(p.allowanceMicrousd)||!p.allowanceMicrousd||!studyAmount(p.tokenAllowance)||!p.tokenAllowance||canonical(p.arms.map(x=>x.arm))!==canonical(['baseline','treatment']))studyFail('proposal_scope');
   validateSuppliedPlan(plan);
   const schema=await studySchemaGuard(env,p.version),configurationHash=await consentHash(p),principal=await principalFingerprint(db,p.ownerId);current();
   const configGuard=studyConfigurationGuard(p.proposalId,p.ownerId,configurationHash,expiry);
   if(!await db.prepare('SELECT 1 AS valid WHERE '+configGuard.sql).bind(...configGuard.bindings).first())studyFail('configuration_unavailable');
   const guards:StudySqlGuard[]=[a.guard,schema,configGuard],policies:StudyFinancialPolicy[]=[],evidence:unknown[]=[],issues:string[]=[];
   for(const arm of p.arms){
    try{
     const records=await readStudyEvidence(env,p.ownerId,p.proposalId,arm.evidence,expiry);current();
     evidence.push({arm:arm.arm,records:records.contents});guards.push(...records.guards);
     policies.push(await compileStudyFinancialPolicy(p,arm,records.contents));
    }catch(error){current();const message=error instanceof Error?error.message:'';if(!/^authoring_study_|^study_financial_/.test(message))throw error;issues.push(arm.arm+': '+message);}
   }
   if(policies.length===2&&(policies[0].scope.accountId!==policies[1].scope.accountId||policies[0].scope.region!==policies[1].scope.region||policies.reduce((n,f)=>n+f.reservationMicrousd+f.lifecycleReserveMicrousd,0)>p.allowanceMicrousd))studyFail('financial_pair');
   const refs=p.arms.flatMap(arm=>arm.evidence),operationIds=plan.manifest.trials.map(t=>operationKey(p.ownerId,plan,t)) as string[];
   if(new Set(refs.map(e=>e.id)).size!==refs.length)studyFail('evidence_reuse');
   const display={operation:p.operation,version:p.version,classification:p.classification,proposalId:p.proposalId,intentId:p.intentId,ownerId:p.ownerId,principalHash:principal,
    sourceBytes:JSON.stringify(plan.packet.suppliedSnapshot),directionBytes:JSON.stringify(plan.packet.direction.value),declaredAuthor:b.declaredAuthor,protocol:plan.packet.protocol,
    plan,configurationHash,operationIds,approvalInventory:studyApprovalInventory(p),evidence,financialPolicies:policies,
    financialMeaning:p.version===2?'Exact-pair advancement before baseline settlement only under displayed independently accepted combined exposure, original result and human resume. Baseline liability/holds remain; genuine settlement and funded lifecycle still required.':'Proposed terms only until explicit authenticated commit. Reservation is not a provider cap. Accepted estimate means unknown maximum exposure; provider settlement and funded lifecycle still required.',
    approvalMeaning:'Approval creates no purchase. Execution is separately gated. Expected benign fidelity failure requires human review; safety/custody/authorization/invalid moderation/uncertain accounting stop. No retries or replacements.',
    expectedDecision:decision(p),expiresAt:expiry,committable:issues.length===0,issues};
   const content=canonicalConsent(display),displayHash=await consentHash(display),previewId=await consentHash({operation:p.operation,proposal:p.proposalId,configurationHash,principal}),scope=await studyPrivateGuard(env,p.ownerId);current();
   const previewGuard:StudySqlGuard={sql:`EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind='authoring-study-preview' AND content=? AND expires_at=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND redacted_at IS NULL AND ${scope.sql})`,bindings:[previewId,p.ownerId,content,expiry,...scope.bindings]};
   const receipt={operation:p.operation,version:p.version,classification:p.classification,previewId,proposalId:p.proposalId,intentId:p.intentId,displayHash,configurationHash,principalHash:principal,planId:plan.id,grantId:p.grantId,reviewId:b.reviewId,operationIds,financialPolicyIds:policies.map(f=>f.id),expiresAt:expiry,newPurchases:0};
   const receiptJson=canonicalConsent(receipt),refsJson=canonicalConsent(refs);
   const readOriginal=async()=>{
    current();const row=await db.prepare('SELECT receipt_json FROM authoring_study_commits WHERE proposal_id=? AND owner_id=?').bind(p.proposalId,p.ownerId).first<{receipt_json:string}>();
    if(!row)return null;
    if(row.receipt_json!==receiptJson)studyFail('commit_conflict');
    const approved=await suppliedStudyInputs(request,env,p.grantId,plan,{recovery:true});current();
    const finalGuards=[...guards,...approved.guards];
    for(const policy of policies)finalGuards.push((await resolveFinancialPolicy(env,{policy,scope:policy.scope,grantId:p.grantId,ownerId:p.ownerId})).guard);
    await checkedBatch(env,finalGuards,[]);current();return receipt;
   };
   if(command.action==='status'){
    if(issues.length)return response({status:'unavailable',issues,committable:false,newPurchases:0});
    const original=await readOriginal();current();return response({status:original?'committed':'not-committed',receipt:original,newPurchases:0});
   }
   if(command.action==='preview'){
    if(issues.length)return response({status:'review',display,displayHash,previewId:null,committable:false,newPurchases:0});
    await checkedBatch(env,guards,[db.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES(?,?,'authoring-study-preview',?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),?,NULL) ON CONFLICT(content_id) DO NOTHING").bind(previewId,p.ownerId,content,expiry),assertion(db,previewGuard)]);current();
    return response({status:'review',display,displayHash,previewId,committable:true,newPurchases:0});
   }
   if(issues.length)studyFail('evidence_required');
   if(command.previewId!==previewId||command.displayHash!==displayHash||command.intentId!==p.intentId||command.decision!==decision(p))studyFail('explicit_decision_mismatch');
   const prior=await readOriginal();if(prior)return response({status:'committed',reused:true,receipt:prior,newPurchases:0});
   const copies=await prepareSuppliedStudyCopies(env,{plan,owner:p.ownerId,source:display.sourceBytes,direction:display.directionBytes});current();
   const receiptColumns=['preview_id','proposal_id','owner_id','intent_id','operation','version','display_hash','configuration_hash','principal_hash','plan_id','grant_id','review_id','baseline_operation','treatment_operation','evidence_json','receipt_json','expires_at','verified'];
   const binding=reviewBinding(plan);
   const receiptGuard:StudySqlGuard={sql:'EXISTS(SELECT 1 FROM authoring_study_commits WHERE preview_id=? AND receipt_json=? AND evidence_json=? AND verified=1)',bindings:[previewId,receiptJson,refsJson]};
   const reviewGuard:StudySqlGuard={sql:"EXISTS(SELECT 1 FROM generation_study_supplied_reviews WHERE review_id=? AND grant_id=? AND owner_id=? AND principal_hash=? AND binding_json=? AND status='authorized' AND expires_at=? AND hard_stop IS NULL)",bindings:[b.reviewId,p.grantId,p.ownerId,principal,binding,expiry]};
   const grantGuard:StudySqlGuard={sql:"EXISTS(SELECT 1 FROM generation_study_grants WHERE grant_id=? AND owner_id=? AND plan_id=? AND runtime_hash=? AND source_ref=? AND direction_ref=? AND source_hash=? AND direction_hash=? AND authority_version=? AND allowance_microusd=? AND token_allowance=? AND expires_at=? AND status='authorized' AND stopped=0)",bindings:[p.grantId,p.ownerId,plan.id,hash(p.runtimeIdentity),b.sourceRef,b.directionRef,b.sourceSha256,b.directionSha256,b.authorityVersion,p.allowanceMicrousd,p.tokenAllowance,expiry]};
   const statements=[
    db.prepare('INSERT INTO generation_study_grants VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,0)').bind(p.grantId,p.ownerId,plan.id,hash(p.runtimeIdentity),b.sourceRef,b.directionRef,b.sourceSha256,b.directionSha256,b.authorityVersion,p.allowanceMicrousd,p.tokenAllowance,expiry,'authorized'),
    db.prepare('INSERT INTO generation_study_supplied_reviews VALUES(?,?,?,?,?,?,?,NULL)').bind(b.reviewId,p.grantId,p.ownerId,principal,binding,expiry,'authorized'),
    ...policies.map(f=>db.prepare('INSERT INTO generation_study_financial_grants VALUES(?,?,?,?,?,?,?)').bind(p.grantId,f.scope.operationId,p.ownerId,f.id,canonical(f),expiry,'authorized')),
    ...copies,
    db.prepare(`INSERT INTO authoring_study_commits(${receiptColumns.join(',')},created_at) VALUES(${receiptColumns.map(()=>'?').join(',')},strftime('%Y-%m-%dT%H:%M:%fZ','now'))`).bind(previewId,p.proposalId,p.ownerId,p.intentId,p.operation,p.version,displayHash,configurationHash,principal,plan.id,p.grantId,b.reviewId,...operationIds,refsJson,receiptJson,expiry,1),
    ...[...guards,previewGuard,grantGuard,reviewGuard,...policies.map(f=>financialGuard(p,f)),receiptGuard].map(g=>assertion(db,g)),
   ];
   try{await checkedBatch(env,[...guards,previewGuard],statements);current();}
   catch(error){current();const original=await readOriginal();if(original)return response({status:'committed',reused:true,receipt:original,newPurchases:0});throw error;}
   const committed=await readOriginal();if(!committed)studyFail('receipt_unavailable');
   // Verifies the same producer guard reused later by every P2 I/O boundary.
   await authoringStudyExecutionGuards(env,{owner:p.ownerId,grantId:p.grantId,planId:plan.id,reviewId:b.reviewId,principal,version:p.version});current();
   return response({status:'committed',reused:false,receipt:committed,newPurchases:0});
  }catch(error){
   const message=error instanceof Error?error.message:'';
   return response({status:'denied',error:/^(authoring_study_|study_)/.test(message)?message:'authoring_study_not_committed',newPurchases:0},409);
  }
 };
}

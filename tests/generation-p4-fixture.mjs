import {pairExposure} from '../evals/generation-reliability/native-host/pair-policy.mjs';
import {readFileSync} from 'node:fs';
import {fixture as p2Fixture,packet,runtime} from './generation-p2-fixture.mjs';
import {hash,canonical} from '../evals/generation-reliability/core.mjs';
import {makeSuppliedPlan,PROTOCOL} from '../evals/generation-reliability/p2/contract.mjs';
import {safetyIdentifier} from '../evals/generation-reliability/execution-plan.mjs';
import {createNativeStudyHost} from '../evals/generation-reliability/native-host/host.mjs';
import {HOST_LIMITS} from '../evals/generation-reliability/native-host/transport.mjs';
const {createAuthoringStudyApproval}=await import('../worker/authoring-commits.ts');
const {studyEvidenceScope}=await import('../worker/authoring-study-finance.ts');
const {consentHash}=await import('../worker/consequential-consent.ts');
export {createAuthoringStudyApproval,consentHash};
export async function fixture(t,options={}){
 const f=await p2Fixture(t,{noAuthority:true,noIntake:true,...options});
 if(!options.pairSchema)f.sqlite.exec(readFileSync(new URL('../db/authoring-study-approval.pending.sql',import.meta.url),'utf8'));
 const h=s=>hash('P4-SYNTHETIC-'+s),expiry=packet.input.expiresAt,through='2026-10-02T00:00:00.000Z',now='2026-09-24T12:00:00.000Z';
 const binding={reviewId:h('review'),authorityVersion:options.pairSchema?'authoring-study-v2':'authoring-study-v1',sourceRef:h('source'),directionRef:h('direction'),declaredAuthor:'agent-proposed-study-draft',approvedUse:PROTOCOL,expiresAt:expiry};
 const plan=makeSuppliedPlan({packet,user:safetyIdentifier('mock-owner'),runtimeIdentity:runtime,binding,...(options.pairSchema?{version:'generation-supplied-study-v3'}:{})});
 const proposal={operation:'generation-supplied-study-approval',version:options.pairSchema?2:1,proposalId:h('proposal'),ownerId:'mock-owner',intentId:h('intent'),grantId:h('grant'),plan,runtimeIdentity:runtime,allowanceMicrousd:3000000,tokenAllowance:20000,classification:options.classification??'synthetic',arms:['baseline','treatment'].map(arm=>({arm,mode:options.mode??'accepted-estimate',reservationMicrousd:1000000,lifecycleReserveMicrousd:1000,evidence:[]}))};
 const records=[];
 for(const arm of proposal.arms){
  const scopeHash=await studyEvidenceScope(proposal,arm);
  const specifics={account:{accountId:h('account'),region:'us',credentialBinding:h('credential-binding'),projectHeader:null},rate:{costBasis:'reviewed-exact-inventory',estimateMicrousd:1000,reviewExpiresAt:expiry},liability:{liabilityOwner:'mock-owner',mode:arm.mode,...(options.pairSchema?{pairExposureId:pairExposure(proposal,{accountId:h('account'),region:'us'}).id,pairDecision:'ALLOW_EXACT_TREATMENT_WITH_BASELINE_UNSETTLED'}:{})},settlement:{verifierId:h('settlement-verifier'),method:'original-request-final-incurred',evidenceRetentionThrough:through},lifecycle:{liabilityOwner:'mock-owner',maximumMicrousd:1000,fundedThrough:through,scope:'study-and-financial-retention',fundingRef:h('funding')},deletion:{operatorId:h('deletion-operator'),method:'verified-original-object-and-private-evidence',through},...(arm.mode==='bounded-proof'?{bound:{maximumCostMicrousd:2000,method:'substantiated-exact-inventory',proofRef:h('bound-proof')}}:{})};
  for(const [kind,attributes] of Object.entries(specifics)){
   const body={version:1,classification:proposal.classification,kind,scopeHash,terms:'SYNTHETIC PRIVATE TERMS: SOURCE-CANARY-DO-NOT-RETAIN. No real funding, authority, deletion or risk acceptance. '+kind,...attributes};
   const ref={id:h(arm.arm+kind),kind,authorityId:h('trusted-fixture-'+kind),contentRef:h('content-'+arm.arm+kind),contentHash:await consentHash(body)};
   arm.evidence.push(ref);records.push({arm:arm.arm,ref,body});
  }
 }
 if(options.configure)await options.configure(proposal,records);
 f.sqlite.prepare('INSERT INTO authoring_study_configurations VALUES(?,?,?,?,?)').run(proposal.proposalId,proposal.ownerId,await consentHash(proposal),expiry,'active');
 for(const {arm,ref,body} of records){
  if(options.missing===arm+':'+ref.kind)continue;
  f.sqlite.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at) VALUES(?,?,'study-financial-evidence',?,?,?)").run(ref.contentRef,proposal.ownerId,canonical(body),now,expiry);
  f.sqlite.prepare('INSERT INTO authoring_study_evidence VALUES(?,?,?,?,?,?,?,?,?)').run(ref.id,proposal.proposalId,proposal.ownerId,ref.kind,ref.contentRef,ref.contentHash,ref.authorityId,expiry,'verified');
 }
 f.env.FORMA_GENERATION_STUDY_APPROVAL_ENABLED='1';f.env.FORMA_GENERATION_STUDY_ENABLED='0';
 const handler=createAuthoringStudyApproval({proposals:[proposal]});
 const request=(command,headers={})=>new Request(f.env.FORMA_GENERATION_STUDY_ORIGIN+'/authoring/study-approval',{method:'POST',headers:{...Object.fromEntries(f.request().headers),'content-type':'application/json',...headers},body:JSON.stringify(command)});
 const call=async(command,headers={})=>(await handler(request(command,headers),f.env)).json();
 const preview=()=>call({action:'preview',proposalId:proposal.proposalId});
 const command=r=>({action:'commit',proposalId:proposal.proposalId,previewId:r.previewId,displayHash:r.displayHash,intentId:proposal.intentId,decision:r.display.expectedDecision});
 const approve=async()=>{const r=await preview();return call(command(r));};
 const policies=()=>f.sqlite.prepare('SELECT policy_json FROM generation_study_financial_grants ORDER BY operation_id').all().map(r=>JSON.parse(r.policy_json));
 const fresh=()=>createNativeStudyHost(f.env,{plan,runtimeIdentity:runtime,financialPolicies:policies(),financialAccount:{accountId:h('account'),region:'us'}});
 const args=(arm='baseline')=>({grantId:proposal.grantId,trialId:arm});
 const observe=(patch={})=>fresh().observe(f.request(),{...args(),safety:'clear',fidelity:'expected-failure',finding:'baseline tether',evidenceRef:'SYNTHETIC-human-observation-only',resume:true,...patch});
 const settle=async(arm='baseline')=>{
  const o=f.op(arm),p=policies().find(p=>p.scope.operationId===o.operation_id);
  f.sqlite.prepare('INSERT INTO generation_study_charges VALUES(?,?,?,?,?,?,?,?,?,?)').run(o.operation_id,o.provider_request_id,o.receipt_hash,650,30,'SYNTHETIC-verifier','SYNTHETIC-receipt',now,hash({planId:plan.id,inventory:plan.inventory,limits:HOST_LIMITS}),null);
  const c=f.sqlite.prepare('SELECT * FROM generation_study_charges WHERE operation_id=?').get(o.operation_id);
  const r={evidence_id:arm+'-1',operation_id:o.operation_id,sequence:1,previous_id:null,original_charge_hash:hash(c),policy_id:p.id,evidence_kind:'verified-incurred-charge',authority_version:'SYNTHETIC-verifier',evidence_ref:'SYNTHETIC-billing',recorded_at:now,provider_settled:1,incurred_microusd:650,incurred_tokens:30,remaining_uncertainty_microusd:0,lifecycle_microusd:800,lifecycle_scope:p.lifecycle.scope,liability_owner:'mock-owner',lifecycle_through:p.lifecycle.through,lifecycle_evidence_ref:'SYNTHETIC-lifecycle',lifecycle_closed:0,lifecycle_incurred_microusd:null};
  f.sqlite.prepare(`INSERT INTO generation_study_reconciliations (${Object.keys(r).join(',')}) VALUES(${Object.keys(r).map(()=>'?').join(',')})`).run(...Object.values(r));
  return fresh().reconcile(f.request(),args(arm));
 };
 const counts=()=>Object.fromEntries(['authoring_study_commits','generation_study_grants','generation_study_supplied_reviews','generation_study_financial_grants','generation_study_operations'].map(table=>[table,f.sqlite.prepare('SELECT count(*) AS n FROM '+table).get().n]).concat([['copies',f.sqlite.prepare('SELECT count(*) AS n FROM private_content WHERE content_id IN(?,?)').get(binding.sourceRef,binding.directionRef).n]]));
 return{...f,plan,proposal,records,handler,approvalRequest:request,call,preview,command,approve,policies,fresh,args,observe,settle,counts};
}

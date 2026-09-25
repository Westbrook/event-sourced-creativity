import assert from 'node:assert/strict';
import test from 'node:test';
import {fixture} from './generation-p2-fixture.mjs';
import {retainSuppliedStudyInputs} from '../evals/generation-reliability/native-host/supplied-authority.mjs';
import {resolveFinancialPolicy,validateFinancialPolicy} from '../evals/generation-reliability/native-host/financial-policy.mjs';
import {compileSponsorApprovalProposal,approveSponsorCampaign} from '../worker/experience-sponsor-approval.ts';

const emptyIntake=f=>{
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM private_content').get().n,0);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM generation_study_operations').get().n,0);
 assert.equal(f.calls.length,0);
};

test('P3 authenticated personal administrator cannot produce missing study authority through intake',async t=>{
 const f=await fixture(t,{noAuthority:true,noIntake:true});
 await assert.rejects(f.intake(),/study_supplied_grant/);
 await assert.rejects(f.host.execute(f.request(),{...f.args(),approved:true,financialApproved:true}),/study_supplied_grant/);
 for(const table of ['generation_study_grants','generation_study_supplied_reviews','generation_study_financial_grants'])
  assert.equal(f.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0);
 emptyIntake(f);
});

test('P3 exact self-sealed F3 policies pass shape validation but cannot authorize either operation',async t=>{
 const f=await fixture(t,{noFinancial:true,noIntake:true});
 for(const policy of f.policies){
  assert.equal(validateFinancialPolicy(policy,policy.scope),policy);
  await assert.rejects(resolveFinancialPolicy(f.env,{policy,scope:policy.scope,grantId:f.grantId,ownerId:'mock-owner'}),/study_financial_grant_unavailable/);
 }
 await assert.rejects(f.intake(),/study_financial_grant_unavailable/);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM generation_study_financial_grants').get().n,0);
 emptyIntake(f);
});

test('P3 existing sponsor approval producer rejects F3 policy rather than silently translating it',async t=>{
 const f=await fixture(t,{noFinancial:true,noIntake:true});
 const proposal={policy:f.policies[0],eligibleActorUserIds:['mock-owner'],issuerUserIds:['mock-owner']};
 await assert.rejects(compileSponsorApprovalProposal(proposal),/sponsor_approval_terms_invalid/);
 const original=f.request();
 const request=new Request(original.url,{method:'POST',headers:{...Object.fromEntries(original.headers),'content-type':'application/json'},
  body:JSON.stringify({action:'approve-sponsor-campaign',approvalId:'OFFLINE-p3',proposal,confirmation:'APPROVE_SPONSOR_CAMPAIGN',reviewedTermsDigest:f.policies[0].id})});
 await assert.rejects(approveSponsorCampaign(request,f.env),/sponsor_approval_terms_invalid/);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM generation_study_financial_grants').get().n,0);
 emptyIntake(f);
});

test('P3 one exact financial approval cannot authorize the other image operation',async t=>{
 const f=await fixture(t,{noFinancial:true,noIntake:true}),p=f.policies[0];
 // Explicit synthetic human decision; never a production approval.
 const {canonical}=await import('../evals/generation-reliability/core.mjs');
 f.sqlite.prepare('INSERT INTO generation_study_financial_grants VALUES(?,?,?,?,?,?,?)').run(f.grantId,p.scope.operationId,'mock-owner',p.id,canonical(p),p.expiresAt,'authorized');
 await assert.rejects(f.intake(),/study_financial_grant_unavailable/);
 emptyIntake(f);
});

test('P3 forged HTTP decision flags cannot fill the missing financial producer',async t=>{
 const f=await fixture(t,{noFinancial:true,noIntake:true}),request=f.request();
 request.headers.set('x-financial-approved','true');request.headers.set('x-lifecycle-funded','true');
 await assert.rejects(retainSuppliedStudyInputs(request,f.env,{grantId:f.grantId,plan:f.plan,
  source:JSON.stringify(f.plan.packet.suppliedSnapshot),direction:JSON.stringify(f.plan.packet.direction.value),
  financialPolicies:f.policies,financialAccount:f.account,approved:true,financialApproved:true,lifecycleFunded:true}),/study_financial_grant_unavailable/);
 emptyIntake(f);
});

test('P3 partial private intake failure rolls back both supplied copies',async t=>{
 const f=await fixture(t,{noIntake:true}),batch=f.DB.batch;
 // Fail after the real intake inserts but inside its real transactional batch.
 f.DB.batch=statements=>batch([...statements,f.DB.prepare('INSERT INTO generation_study_assertions(passed) VALUES(0)')]);
 await assert.rejects(f.intake(),/CHECK constraint failed/);
 emptyIntake(f);
});

test('P3 concurrent exact intake produces at most the two original copies and no purchase',async t=>{
 const f=await fixture(t,{noIntake:true});
 const results=await Promise.allSettled([f.intake(),f.intake()]);
 assert.ok(results.some(r=>r.status==='fulfilled'));
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM private_content').get().n,2);
 assert.equal(f.calls.length,0);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM generation_study_operations').get().n,0);
});

test('P3 disabled host and intake touch neither database nor provider',async t=>{
 const f=await fixture(t,{noAuthority:true,noIntake:true});
 delete f.env.FORMA_GENERATION_STUDY_ENABLED;
 f.env.DB=new Proxy({}, {get(){throw Error('P3 unexpected DB access');}});
 assert.equal((await f.fresh().execute(f.request(),f.args())).action,'disabled');
 await assert.rejects(f.intake(),/study_disabled/);
 assert.equal(f.calls.length,0);
});

test('P3 one failed deletion attempt proves neither physical closure nor released financial retention',async t=>{
 const f=await fixture(t);await f.host.execute(f.request(),f.args());await f.settle();
 const id=f.op().operation_id;let deletions=0;
 f.env.MEDIA.delete=async()=>{deletions++;throw Error('OFFLINE deletion unavailable');};
 Date.now=()=>Date.parse('2026-10-02T00:00:00.000Z');
 f.sqlite.function('strftime',{varargs:true},()=> '2026-10-02T00:00:00.000Z');
 await assert.rejects(f.fresh().cleanup(f.request(),{operationId:id}),/deletion unavailable/);
 await assert.rejects(f.fresh().cleanup(f.request(),{operationId:id}));
 assert.equal(deletions,1);assert.equal(f.op().cleanup_attempts,1);
 assert.equal(f.sqlite.prepare('SELECT lifecycle_closed FROM generation_study_reconciliations').get().lifecycle_closed,0);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM cost_budget_reservations WHERE operation='study-lifecycle-provision' AND status='active'").get().n,1);
 assert.ok(f.sqlite.prepare('SELECT COUNT(*) n FROM private_content').get().n>0);
 assert.equal(f.calls.length,3);
});

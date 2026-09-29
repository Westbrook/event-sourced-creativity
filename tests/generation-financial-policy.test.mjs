import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture } from './generation-study-fixture.mjs';
import { seal,hash,canonical,makeCell,makeManifest } from '../evals/generation-reliability/core.mjs';
import { makeExecutionPlan } from '../evals/generation-reliability/execution-plan.mjs';
import { appendVerifiedReconciliation } from '../evals/generation-reliability/native-host/financial-reconciliation.mjs';
import { resealPlan,MOCK_RUNTIME } from '../evals/generation-reliability/bridge-fixtures/mock-host.mjs';
import { FINANCIAL_POLICY_VERSION,sealFinancialPolicy,validateFinancialPolicy,imageFinancialScope } from '../evals/generation-reliability/native-host/financial-policy.mjs';
const { createNativeStudyHost } = await import('../evals/generation-reliability/native-host/host.mjs');
const { reserveCostBudget,releaseCostBudget } = await import('../worker/pilot-policy.ts');
const account={accountId:'offline-account',region:'offline-region'};
function policy(plan,expiry,mode='accepted-estimate',trial=plan.manifest.trials[0]){
 return sealFinancialPolicy({version:FINANCIAL_POLICY_VERSION,scope:imageFinancialScope(plan,trial,'mock-owner',account),mode,
 reservationMicrousd:1000000,lifecycleReserveMicrousd:1000,
 estimate:{microusd:1000,assumptions:['OFFLINE arbitrary fixture units; no current pricing claim'],costBasis:'OFFLINE fixture basis',evidenceRef:'offline-estimate',reviewExpiresAt:expiry},
 bound:mode==='bounded-proof'?{maximumCostMicrousd:1001000,evidenceRef:'offline-evidenced-bound',scope:'all exact stages and lifecycle'}:null,
 residualDecision:mode==='accepted-estimate'?{accepted:true,unknownMaximumAccepted:true,decisionRef:'OFFLINE-MOCK-NOT-USER-ACCEPTANCE',liabilityOwner:'mock-owner'}:null,
 maximumLossMicrousd:null,providerEnforcedChargeCap:false,expiresAt:expiry,inFlightLimit:1,stopBehavior:'stop-before-next-stage-no-retry',overrunPolicy:'retain-and-hold',nextPurchase:'after-settlement-and-funded-lifecycle',
 lifecycle:{scope:'all retained artifact, private evidence, finance records, deletion and reconciliation',liabilityOwner:'mock-owner',evidenceRef:'offline-lifecycle-basis',through:new Date(Date.parse(expiry)+86400000).toISOString(),maximumMicrousd:1000}});
}
const reseal=(p,patch)=>{const {id,...rest}=p;return sealFinancialPolicy({...rest,...patch});};
async function f3(t,{mode='accepted-estimate',patch,fetch,planTransform=p=>p}={}){
 const f=await fixture(t,{fetch,plan:p=>planTransform(resealPlan(p,{financial:seal('f2-financial',{version:'OFFLINE-unavailable-original',available:false,maximumCostMicrousd:null})})),policies:(p,e)=>{const q=policy(p,e,mode);return [patch?patch(q):q];}});
 f.policy=f.financialPolicies[0];
 f.grant=(overrides={})=>{const values={grant:f.args.grantId,op:f.policy.scope.operationId,owner:'mock-owner',id:f.policy.id,json:canonical(f.policy),expiry:f.policy.expiresAt,status:'authorized',...overrides};f.sqlite.prepare('INSERT INTO generation_study_financial_grants VALUES(?,?,?,?,?,?,?)').run(...Object.values(values));};
 f.receipt=()=>f.sqlite.prepare('SELECT * FROM generation_study_charges').get();
 f.event=(patch={},insert=true)=>{
  const prior=f.sqlite.prepare('SELECT * FROM generation_study_reconciliations ORDER BY sequence DESC LIMIT 1').get();
  const r={evidence_id:'offline-event-'+((prior?.sequence??0)+1),operation_id:f.op().operation_id,sequence:(prior?.sequence??0)+1,previous_id:prior?.evidence_id??null,
   original_charge_hash:hash(f.receipt()),policy_id:f.policy.id,evidence_kind:'verified-incurred-charge',authority_version:'OFFLINE-verifier',evidence_ref:'OFFLINE-billing-statement',recorded_at:new Date().toISOString(),provider_settled:1,incurred_microusd:f.receipt().measured_microusd,incurred_tokens:f.receipt().measured_tokens,remaining_uncertainty_microusd:0,
   lifecycle_microusd:800,lifecycle_scope:f.policy.lifecycle.scope,liability_owner:f.policy.lifecycle.liabilityOwner,lifecycle_through:f.policy.lifecycle.through,lifecycle_evidence_ref:'OFFLINE-storage-quantity-and-term-evidence',lifecycle_closed:0,lifecycle_incurred_microusd:null,...patch};
  if(insert)f.sqlite.prepare(`INSERT INTO generation_study_reconciliations (${Object.keys(r).join(',')}) VALUES(${Object.keys(r).map(()=>'?').join(',')})`).run(...Object.values(r));return r;
 };
 f.reconcile=()=>f.host.reconcile(f.request(),f.args);
 f.outside=()=>reserveCostBudget(f.env,'mock-owner',1000,{maximumMicrousd:1000,allowUserOverage:false,reservationId:'outside-next',operation:'ordinary-image'});
 return f;
}
for(const mode of ['accepted-estimate','bounded-proof'])test(mode+': exact server grant admits mock host without changing F2; funded lifecycle permits completion',async t=>{
 const f=await f3(t,{mode});f.grant();await f.run();assert.equal(f.calls.length,2);assert.equal(f.plan.financial.available,false);assert.equal(f.plan.financial.maximumCostMicrousd,null);
 f.charge({residual:null});const original=f.receipt();assert.equal((await f.reconcile()).action,'hold');f.event();const r=await f.reconcile();assert.equal(r.action,'completed');assert.equal(r.financial.providerSettled,true);assert.equal(r.financial.lifecycleFunded,true);assert.equal(r.financial.originalResidualMicrousd,null);
 assert.deepEqual(f.receipt(),original);const life=f.sqlite.prepare('SELECT * FROM cost_budget_reservations WHERE reservation_id=?').get(f.op().lifecycle_reservation_id);assert.equal(life.status,'active');assert.equal(life.reserved_microusd,1000);
 assert.equal((await f.outside()).ok,true);assert.equal(f.calls.length,2);
});
for(const invalid of ['absent','forged-request','expired','wrong-payer','wrong-operation','wrong-account','wrong-policy'])test('financial grant denies '+invalid,async t=>{
 const f=await f3(t);
 if(invalid==='wrong-payer'){f.sqlite.exec("INSERT INTO users(user_id,email,display_name,created_at,updated_at) VALUES('different-payer','different@example.test','Other','now','now')");f.grant({owner:'different-payer'});}
 else if(invalid==='expired')f.grant({expiry:'2000-01-01T00:00:00.000Z'});
 else if(invalid==='wrong-operation')f.grant({op:'different-op'});
 else if(invalid==='wrong-policy')f.grant({id:'forged-policy'});
 else if(invalid==='wrong-account')f.grant({json:canonical(reseal(f.policy,{scope:{...f.policy.scope,accountId:'wrong-account'}}))});
 const req=f.request();if(invalid==='forged-request')req.headers.set('authorized','true');
 await assert.rejects(f.host.execute(req,{...f.args,authorized:true,financialPolicy:f.policy}),/financial_grant/);assert.equal(f.calls.length,0);
});
for(const field of ['sourceHash','requestHash','runtimeHash','inventoryHash','payerId','region'])test('policy binds '+field,async t=>{
 const f=await f3(t,{patch:p=>reseal(p,{scope:{...p.scope,[field]:'changed'}})});f.grant();await assert.rejects(f.run(),/policy_invalid/);assert.equal(f.calls.length,0);
});
for(const change of [{bound:{maximumCostMicrousd:1000,evidenceRef:'not a cap'}},{maximumLossMicrousd:1000},{providerEnforcedChargeCap:true},{residualDecision:null},{expiresAt:'2000-01-01T00:00:00Z'},{inFlightLimit:2}])test('accepted estimate rejects cap/authority mutation '+Object.keys(change)[0],async t=>{
 const f=await f3(t,{patch:p=>reseal(p,change)});f.grant();await assert.rejects(f.run(),/policy_invalid/);assert.equal(f.calls.length,0);
});
test('receipt and reconciliation remain immutable; estimate is never incurred evidence; chains reject forks',async t=>{
 const f=await f3(t);f.grant();await f.run();f.charge({residual:800});f.event({provider_settled:0,remaining_uncertainty_microusd:null});
 for(const table of ['generation_study_charges','generation_study_reconciliations']){
  assert.throws(()=>f.sqlite.exec(`DELETE FROM ${table}`),/immutable/);assert.throws(()=>f.sqlite.exec(`UPDATE ${table} SET evidence_ref='rewrite'`),/immutable/);
 }
 assert.throws(()=>f.event({evidence_kind:'usage-estimate'}),/CHECK/);assert.throws(()=>f.event({previous_id:null}),/chain/);
 assert.equal((await f.reconcile()).action,'hold');assert.equal(f.sqlite.prepare('SELECT status FROM cost_budget_reservations WHERE reservation_id=?').get(f.op().cost_reservation_id).status,'active');
 f.event({incurred_microusd:950});assert.equal((await f.reconcile()).action,'completed');assert.equal(f.receipt().measured_microusd,650);assert.equal(f.receipt().residual_exposure_microusd,800);assert.equal(f.op().measured_microusd,950);
});
test('timeout and missing charge cannot be cleared by lifecycle policy or a second grant',async t=>{
 const f=await f3(t,{fetch:async url=>{if(url.endsWith('/moderations'))return Response.json({results:[{flagged:false,categories:{}}]});throw Error('timeout');}});f.grant();await f.run();assert.equal((await f.reconcile()).reason,'original_verified_charge_required');await assert.rejects(f.outside(),/outstanding/);await f.run();assert.equal(f.calls.length,2);
});
test('unclamped incurred overrun remains visible and holds future purchase',async t=>{
 const f=await f3(t);f.grant();await f.run();f.charge({residual:null});f.event({incurred_microusd:1200000});const r=await f.reconcile();assert.equal(r.action,'hold');assert.equal(r.measuredMicrousd,1200000);assert.equal(f.op().measured_microusd,1200000);await assert.rejects(f.outside(),/outstanding/);
});
test('restart after token settlement resumes original dollar settlement once',async t=>{
 const f=await f3(t);f.grant();await f.run();f.charge({residual:null});f.event();const batch=f.DB.batch;let fail=true;
 f.DB.batch=async statements=>{if(fail&&statements.some(s=>s.sql.startsWith('UPDATE cost_budget_counters'))){fail=false;throw Error('offline crash after tokens');}return batch(statements);};
 await assert.rejects(f.reconcile(),/offline crash/);assert.equal(f.op().status,'hold');assert.equal(f.sqlite.prepare('SELECT status FROM budget_reservations').get().status,'settled');
 const fresh=createNativeStudyHost(f.env,{plan:f.plan,runtimeIdentity:MOCK_RUNTIME,financialPolicies:[f.policy],financialAccount:account});assert.equal((await fresh.reconcile(f.request(),f.args)).action,'completed');
 const counters=f.sqlite.prepare('SELECT scope,scope_id,period,used_microusd,reserved_microusd FROM cost_budget_counters').all();await fresh.reconcile(f.request(),f.args);assert.deepEqual(f.sqlite.prepare('SELECT scope,scope_id,period,used_microusd,reserved_microusd FROM cost_budget_counters').all(),counters);assert.equal(f.calls.length,2);
});
test('funded lifecycle cannot be released early; verified closure settles actual expense once',async t=>{
 const f=await f3(t);f.grant();await f.run();f.charge({residual:800});f.event();await f.reconcile();
 await assert.rejects(releaseCostBudget(f.env,'mock-owner',f.op().lifecycle_reservation_id),/verified_lifecycle/);
 f.event({lifecycle_closed:1,lifecycle_microusd:0,lifecycle_incurred_microusd:300});assert.equal((await f.reconcile()).action,'completed');
 assert.equal(f.sqlite.prepare('SELECT used_microusd FROM cost_budget_reservations WHERE reservation_id=?').get(f.op().lifecycle_reservation_id).used_microusd,300);assert.equal(f.receipt().residual_exposure_microusd,800);
 await f.reconcile();assert.equal(f.sqlite.prepare("SELECT used_microusd FROM cost_budget_counters WHERE scope='user'").get().used_microusd,950);
});
test('new unknown assessment or expired lifecycle blocks payer despite prior operational completion',async t=>{
 const f=await f3(t);f.grant();await f.run();f.charge({residual:null});f.event();await f.reconcile();f.event({remaining_uncertainty_microusd:null});await assert.rejects(f.outside(),/lifecycle_exposure/);assert.equal((await f.reconcile()).action,'hold');
});
test('pure generic preparation policy requires separate exact operation and inventory',async t=>{
 const f=await f3(t);const p=reseal(f.policy,{scope:{...f.policy.scope,kind:'preparation',operationId:'separate-preparation',requestHash:hash('planner'),inventoryHash:hash({planner:1,image:0})}});
 assert.equal(validateFinancialPolicy(p,p.scope).scope.kind,'preparation');assert.throws(()=>validateFinancialPolicy(p,f.policy.scope),/invalid/);
});

test('server append is idempotent after lost acknowledgement; conflicting retry and binding rejected',async t=>{
 const f=await f3(t);f.grant();await f.run();f.charge({residual:null});const record=f.event({},false);
 const prepare=f.DB.prepare;let fail=true;f.DB.prepare=sql=>{const statement=prepare(sql);if(sql.startsWith('INSERT INTO generation_study_reconciliations')){const bind=statement.bind.bind(statement);statement.bind=(...args)=>{const bound=bind(...args),run=bound.run.bind(bound);bound.run=async()=>{const r=await run();if(fail){fail=false;throw Error('lost ack');}return r;};return bound;};}return statement;};
 assert.equal((await appendVerifiedReconciliation(f.env,record)).reused,true);assert.equal((await appendVerifiedReconciliation(f.env,record)).reused,true);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM generation_study_reconciliations').get().n,1);
 await assert.rejects(appendVerifiedReconciliation(f.env,{...record,evidence_ref:'changed'}),/id_conflict/);
 await assert.rejects(appendVerifiedReconciliation(f.env,f.event({original_charge_hash:'forged'},false)),/record_invalid/);
 assert.equal((await f.reconcile()).action,'completed');
});

test('second arm needs its own exact authority and settled first purchase with funded obligations',async t=>{
 const f=await f3(t,{planTransform:p=>{
  const first=p.manifest.cells[0],c=p.manifest.cases[0],second=makeCell(c,{...first.config,prompt:first.config.prompt+' Botanical plate.'},first,['prompt']);
  const manifest=makeManifest({experiment:'OFFLINE-two-arms',cases:[c],cells:[first,second],allowedFactors:['prompt'],interpretation:'OFFLINE financial flow only',callsPerTrial:p.manifest.trials[0].plannedCalls});
  return makeExecutionPlan({...p,manifest,candidate:{...p.candidate,captures:manifest.cells.map(cell=>({cellId:cell.id,sourceHash:cell.sourceHash,directionHash:cell.plannerHash,promptHash:cell.promptHash}))}});
 }});f.grant();await f.run();const second=f.plan.manifest.trials[1],p2=policy(f.plan,f.expiry,'accepted-estimate',second);
 const host=createNativeStudyHost(f.env,{plan:f.plan,runtimeIdentity:MOCK_RUNTIME,financialPolicies:[f.policy,p2],financialAccount:account}),args={...f.args,trialId:second.id};
 await assert.rejects(host.execute(f.request(),args),/financial_grant/);
 f.grant({op:p2.scope.operationId,id:p2.id,json:canonical(p2)});
 await assert.rejects(host.execute(f.request(),args));assert.equal(f.calls.length,2);
 f.charge({residual:null});f.event({provider_settled:0,remaining_uncertainty_microusd:null});await f.reconcile();await assert.rejects(host.execute(f.request(),args));assert.equal(f.calls.length,2);
 f.event();assert.equal((await f.reconcile()).action,'completed');const r=await host.execute(f.request(),args);assert.equal(r.newPurchases,1);assert.equal(f.calls.length,4);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM generation_study_operations').get().n,2);
 assert.equal(f.receipt().residual_exposure_microusd,null);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM cost_budget_reservations WHERE operation='study-lifecycle-provision' AND status='active'").get().n,2);
});

test('financial revocation at reservation commit rolls back both monetary reserves and buys nothing',async t=>{
 const f=await f3(t);f.grant();const batch=f.DB.batch;f.DB.batch=async statements=>{if(statements.some(s=>s.sql.includes('INSERT INTO generation_study_operations')))f.sqlite.exec("UPDATE generation_study_financial_grants SET status='revoked'");return batch(statements);};
 await assert.rejects(f.run());assert.equal(f.op(),undefined);assert.equal(f.calls.length,0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM cost_budget_reservations').get().n,0);
});

test('expired provision blocks ordinary new reservation without any reconcile call',async t=>{
 const f=await f3(t);f.grant();await f.run();f.charge({residual:null});f.event();await f.reconcile();
 const future=Date.parse(f.policy.lifecycle.through)+1000;
 f.sqlite.function('strftime',{varargs:true},format=>format==='%Y-%m'?new Date(future).toISOString().slice(0,7):new Date(future).toISOString());
 await assert.rejects(f.outside(),/lifecycle_exposure/);
});

test('lifecycle actual overrun is recorded unclamped and blocks next purchase',async t=>{
 const f=await f3(t);f.grant();await f.run();f.charge({residual:800});f.event();await f.reconcile();f.event({lifecycle_closed:1,lifecycle_microusd:0,lifecycle_incurred_microusd:1200});
 assert.equal((await f.reconcile()).action,'hold');assert.equal(f.sqlite.prepare('SELECT used_microusd FROM cost_budget_reservations WHERE reservation_id=?').get(f.op().lifecycle_reservation_id).used_microusd,1200);
 await assert.rejects(f.outside(),/exposure/);
});

test('a partial incurred overrun cannot disappear in later evidence',async t=>{
 const f=await f3(t);f.grant();await f.run();f.charge({residual:null});f.event({provider_settled:0,incurred_microusd:1200000,remaining_uncertainty_microusd:null});
 assert.throws(()=>f.event({incurred_microusd:650}),/settled_amount_immutable/);assert.equal((await f.reconcile()).action,'hold');await assert.rejects(f.outside(),/exposure/);
});

test('wrong receipt, wrong lifecycle owner and unfunded provision cannot complete',async t=>{
 const f=await f3(t);f.grant();await f.run();f.charge({residual:null});f.event({original_charge_hash:'forged'});assert.equal((await f.reconcile()).action,'hold');
 f.event({liability_owner:'someone-else'});assert.equal((await f.reconcile()).action,'hold');
 f.event({lifecycle_microusd:1001});assert.equal((await f.reconcile()).action,'hold');await assert.rejects(f.outside(),/exposure/);
});

test('revocation after moderation stops image dispatch and retains original reservation',async t=>{
 const f=await f3(t);f.grant();const batch=f.DB.batch;f.DB.batch=async statements=>{const r=await batch(statements);if(statements.some(s=>s.sql.includes('INSERT INTO generation_study_evidence')&&s.bindings[1]==='moderation-response'))f.sqlite.exec("UPDATE generation_study_financial_grants SET status='revoked'");return r;};
 assert.equal((await f.run()).action,'hold');assert.equal(f.calls.length,1);assert.equal(f.op().status,'hold');
});

test('reconciliation cannot switch away from the original canonical DB',async t=>{
 const f=await f3(t);f.grant();await f.run();f.charge({residual:null});f.event();f.env.DB={...f.DB};await assert.rejects(f.reconcile(),/database_changed/);assert.equal(f.op().measured_microusd,null);
});

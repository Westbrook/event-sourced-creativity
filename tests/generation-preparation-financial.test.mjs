import assert from 'node:assert/strict';
import test from 'node:test';
import {fixture as preparationFixture} from './generation-preparation-fixture.mjs';
import {fixture as imageFixture} from './generation-study-fixture.mjs';
import {canonical,hash} from '../evals/generation-reliability/core.mjs';
const {createPreparationHost}=await import('../evals/generation-reliability/preparation/native-host.mjs');
import {createPreparationFinancialWriter} from '../evals/generation-reliability/preparation/financial-adapter.mjs';
const {capturePreparation,financialScope}=await import('../evals/generation-reliability/preparation/contract.mjs');
import {sealFinancialPolicy} from '../evals/generation-reliability/native-host/financial-policy.mjs';
const {reserveCostBudget,reserveBudget,releaseCostBudget,settleCostBudget}=await import('../worker/pilot-policy.ts');

// Every record and verifier in this file is SYNTHETIC; no live bill or user policy decision.
const mockVerifier=async({record,binding})=>({verified:true,classification:'verified-incurred-charge',recordHash:hash(record),binding});
async function fixture(t,options={}){
 const f=await preparationFixture(t,options),writer=createPreparationFinancialWriter(f.env,{plan:f.plan,verifyEvidence:mockVerifier});
 const receipt=()=>f.sqlite.prepare('SELECT * FROM generation_preparation_charges').get();
 const chargeRecord=(patch={})=>({operation_id:f.op().operation_id,provider_request_id:f.op().provider_request_id,receipt_hash:f.op().receipt_hash,measured_microusd:650,measured_tokens:300,authority_version:'SYNTHETIC-verifier-v1',evidence_ref:'private:synthetic-bill',recorded_at:new Date().toISOString(),scope_hash:f.op().scope_hash,residual_exposure_microusd:null,...patch});
 const charge=patch=>writer.appendCharge(chargeRecord(patch));
 const eventRecord=(patch={})=>{const last=f.sqlite.prepare('SELECT * FROM generation_preparation_reconciliations ORDER BY sequence DESC LIMIT 1').get();return {evidence_id:'synthetic-'+((last?.sequence??0)+1),operation_id:f.op().operation_id,sequence:(last?.sequence??0)+1,previous_id:last?.evidence_id??null,original_charge_hash:hash(receipt()),policy_id:f.policy.id,evidence_kind:'verified-incurred-charge',authority_version:'SYNTHETIC-verifier-v1',evidence_ref:'private:synthetic-bill',recorded_at:new Date().toISOString(),provider_settled:1,incurred_microusd:650,incurred_tokens:300,remaining_uncertainty_microusd:0,lifecycle_microusd:10000,lifecycle_scope:f.policy.lifecycle.scope,liability_owner:f.policy.lifecycle.liabilityOwner,lifecycle_through:f.policy.lifecycle.through,lifecycle_evidence_ref:'private:synthetic-retention',lifecycle_closed:0,lifecycle_incurred_microusd:null,...patch};};
 const event=patch=>writer.appendReconciliation(eventRecord(patch));
 const reconcile=()=>f.host.reconcile(f.request(),f.args);
 const outside=(patch={})=>reserveCostBudget(f.env,'mock-owner',1,{reservationId:'ordinary',maximumMicrousd:1,allowUserOverage:false,...patch});
 const dollar=id=>f.sqlite.prepare('SELECT * FROM cost_budget_reservations WHERE reservation_id=?').get(id);
 const counters=()=>f.sqlite.prepare('SELECT scope,scope_id,period,used_microusd,reserved_microusd FROM cost_budget_counters ORDER BY scope,scope_id,period').all();
 return {...f,writer,receipt,charge,chargeRecord,event,eventRecord,reconcile,outside,dollar,counters};
}
function next(f,locale='fr'){
 const plan=capturePreparation({source:f.source,config:f.config,payerId:'mock-owner',runtimeHash:f.plan.runtimeHash,locale,outputTargetInstructions:'Synthetic distinct target '+locale});
 const policy=sealFinancialPolicy({...Object.fromEntries(Object.entries(f.policy).filter(([k])=>k!=='id')),scope:financialScope(plan)}),grantId='next-'+locale;
 const install=()=>f.sqlite.prepare('INSERT INTO generation_preparation_grants VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,0)').run(grantId,'mock-owner',plan.id,f.source.ref,plan.source.sha256,canonical(plan.source),canonical(plan.config),plan.runtimeHash,canonical(policy),40000,'OFFLINE-ONLY',f.expiry,'authorized');
 return {install,run:()=>createPreparationHost(f.env,{plan}).execute(f.request(),{grantId})};
}
for(const residual of [null,800])test('atomic distinct reserves and immutable residual '+residual,async t=>{
 const f=await fixture(t);await f.run();const op=f.op();assert.equal(f.dollar(op.cost_reservation_id).reserved_microusd,100000);assert.equal(f.dollar(op.lifecycle_reservation_id).reserved_microusd,10000);assert.equal(f.counters()[0].reserved_microusd,110000);
 await f.charge({residual_exposure_microusd:residual});const original=f.receipt();await f.event();const r=await f.reconcile();assert.equal(r.action,'completed');assert.equal(r.humanReviewed,false);assert.equal(r.contentOutcome,'usable');assert.ok(r.retainedDirectionSha256);assert.equal(r.financialSettled,true);assert.equal(f.dollar(op.lifecycle_reservation_id).status,'active');assert.deepEqual(f.receipt(),original);
 assert.equal(f.counters()[0].reserved_microusd,10000);assert.equal(f.counters()[0].used_microusd,650);const before=f.counters();await f.reconcile();assert.deepEqual(f.counters(),before);assert.equal((await f.run()).reason,'original_purchase_only');assert.equal((await f.outside()).ok,true);
});
test('NEXT DISTINCT needs its own grant and retains funded native reserve',async t=>{
 const f=await fixture(t);await f.run();await f.charge();await f.event();await f.reconcile();const second=next(f);await assert.rejects(second.run(),/grant_unavailable/);assert.equal(f.calls.length,1);second.install();await second.run();assert.equal(f.calls.length,2);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM generation_preparation_operations').get().n,2);assert.equal(f.counters()[0].reserved_microusd,120000);const third=next(f,'es');third.install();await assert.rejects(third.run());assert.equal(f.calls.length,2);
});
for(const patch of [{provider_settled:0},{remaining_uncertainty_microusd:null},{remaining_uncertainty_microusd:100}])test('usable content and provision never release partial or unknown original '+JSON.stringify(patch),async t=>{
 const f=await fixture(t);await f.run();await f.charge();await f.event(patch);assert.equal((await f.reconcile()).action,'hold');assert.equal(f.dollar(f.op().cost_reservation_id).status,'active');await assert.rejects(f.outside(),/exposure/);await assert.rejects(settleCostBudget(f.env,'mock-owner',f.op().cost_reservation_id,650),/original_charge_required/);assert.equal(f.calls.length,1);
});
test('final billing with unavailable content settles finances but retains purchase hold',async t=>{
 const f=await fixture(t);await f.run();await f.charge();await f.event();f.sqlite.prepare("DELETE FROM private_content WHERE content_id IN(SELECT content_ref FROM generation_preparation_evidence WHERE slot='response')").run();const r=await f.reconcile();assert.equal(r.financialSettled,true);assert.equal(r.contentOutcome,'unavailable');assert.equal(r.nextPurchaseEligible,false);assert.equal(r.action,'hold');assert.equal(f.dollar(f.op().cost_reservation_id).status,'settled');await assert.rejects(f.outside(),/exposure/);assert.equal((await f.run()).reason,'original_purchase_only');
});
for(const change of ['source','response'])test('private access loss on '+change+' does not erase charge or approve content',async t=>{
 const f=await fixture(t);await f.run();await f.charge();await f.event();f.sqlite.prepare(change==='source'?"UPDATE private_content SET redacted_at='now' WHERE content_id='source'":"UPDATE private_content SET redacted_at='now' WHERE content_id IN(SELECT content_ref FROM generation_preparation_evidence WHERE slot='response')").run();const r=await f.reconcile();assert.equal(r.financialSettled,true);assert.equal(r.nextPurchaseEligible,false);assert.equal(f.calls.length,1);
});
test('partial cumulative assessments progress without rewriting the first bill',async t=>{
 const f=await fixture(t);await f.run();await f.charge({measured_microusd:100,measured_tokens:50,residual_exposure_microusd:800});await f.event({provider_settled:0,incurred_microusd:100,incurred_tokens:50,remaining_uncertainty_microusd:null});await f.reconcile();await f.event({incurred_microusd:950});assert.equal((await f.reconcile()).action,'completed');assert.equal(f.op().measured_microusd,950);assert.equal(f.receipt().measured_microusd,100);assert.equal(f.receipt().residual_exposure_microusd,800);
});
for(const patch of [{incurred_microusd:1200000},{incurred_tokens:50000}])test('unclamped overrun remains held '+JSON.stringify(patch),async t=>{
 const f=await fixture(t);await f.run();await f.charge();await f.event(patch);assert.equal((await f.reconcile()).action,'hold');assert.equal(f.op().measured_microusd,patch.incurred_microusd??650);assert.equal(f.op().measured_tokens,patch.incurred_tokens??300);await assert.rejects(f.outside(),/exposure/);
});
test('verified lifecycle closure alone releases its reserve idempotently; cleanup does not',async t=>{
 const f=await fixture(t);await f.run();await f.charge();await f.event();await f.reconcile();await assert.rejects(releaseCostBudget(f.env,'mock-owner',f.op().lifecycle_reservation_id),/verified_lifecycle/);await f.event({lifecycle_closed:1,lifecycle_microusd:0,lifecycle_incurred_microusd:300});assert.equal((await f.reconcile()).action,'completed');assert.equal(f.dollar(f.op().lifecycle_reservation_id).used_microusd,300);const before=f.counters();await f.reconcile();assert.deepEqual(f.counters(),before);assert.equal(before[0].used_microusd,950);assert.equal(before[0].reserved_microusd,0);
});
for(const patch of [{remaining_uncertainty_microusd:null},{lifecycle_microusd:10001},{lifecycle_closed:1,lifecycle_microusd:0,lifecycle_incurred_microusd:11000}])test('ongoing lifecycle uncertainty or overrun blocks new purchases '+JSON.stringify(patch),async t=>{
 const f=await fixture(t);await f.run();await f.charge();await f.event();await f.reconcile();await f.event(patch);await assert.rejects(f.outside(),/lifecycle_exposure/);const r=await f.reconcile();assert.equal(r.action,'hold');if(patch.lifecycle_closed)assert.equal(f.dollar(f.op().lifecycle_reservation_id).used_microusd,11000);
});
test('expired lifecycle denies both native reservation types without automatic release',async t=>{
 const f=await fixture(t,{policy:p=>sealFinancialPolicy({...Object.fromEntries(Object.entries(p).filter(([k])=>k!=='id')),lifecycle:{...p.lifecycle,through:'2099-01-01T00:00:00.000Z'}})});await f.run();await f.charge();await f.event();await f.reconcile();
 // Real SQLite wall-clock expiry tested by a fixture-only clock function, no production schema mutation.
 f.sqlite.function('strftime',{varargs:true},(...args)=>args.at(-1)==='now'?'2100-01-01T00:00:00.000Z':args.at(-1));
 await assert.rejects(f.outside(),/lifecycle_exposure/);await assert.rejects(reserveBudget(f.env,'mock-owner',1,{reservationId:'ordinary-token'}),/lifecycle_exposure/);assert.equal(f.dollar(f.op().lifecycle_reservation_id).status,'active');
});
test('restart after native token settlement and lost dollar acknowledgement is idempotent',async t=>{
 const f=await fixture(t);await f.run();await f.charge();await f.event();const batch=f.DB.batch;let crash=true;
 f.DB.batch=async stmts=>{if(crash&&stmts.some(s=>s.sql.startsWith('UPDATE cost_budget_counters'))){crash=false;throw Error('crash');}return batch(stmts);};await assert.rejects(f.reconcile(),/crash/);assert.equal(f.sqlite.prepare('SELECT status FROM budget_reservations').get().status,'settled');
 let lost=true;f.DB.batch=async stmts=>{const r=await batch(stmts);if(lost&&stmts.some(s=>s.sql.startsWith('UPDATE cost_budget_counters'))){lost=false;throw Error('lost ack');}return r;};await assert.rejects(f.reconcile(),/lost ack/);const before=f.counters();assert.equal((await createPreparationHost(f.env,{plan:f.plan}).reconcile(f.request(),f.args)).action,'completed');assert.deepEqual(f.counters(),before);assert.equal(f.calls.length,1);
});
test('immutable receipts, append chains, conflicts and lost acknowledgement',async t=>{
 const f=await fixture(t);await f.run();const record=f.chargeRecord();await f.writer.appendCharge(record);assert.equal((await f.writer.appendCharge(record)).reused,true);await assert.rejects(f.writer.appendCharge({...record,measured_microusd:651}),/conflict/);
 const event=f.eventRecord();const prepare=f.DB.prepare;let fail=true;f.DB.prepare=sql=>{const stmt=prepare(sql);if(sql.startsWith('INSERT INTO generation_preparation_reconciliations')){const bind=stmt.bind.bind(stmt);stmt.bind=(...args)=>{const b=bind(...args),run=b.run.bind(b);b.run=async()=>{const r=await run();if(fail){fail=false;throw Error('lost ack');}return r;};return b;};}return stmt;};assert.equal((await f.writer.appendReconciliation(event)).reused,true);await assert.rejects(f.writer.appendReconciliation({...event,incurred_microusd:651}),/id_conflict/);await assert.rejects(f.event({previous_id:null}),/chain/);await assert.rejects(f.event({incurred_microusd:651}),/settled_amount_immutable/);
 for(const table of ['charges','reconciliations']){assert.throws(()=>f.sqlite.exec(`DELETE FROM generation_preparation_${table}`),/immutable/);assert.throws(()=>f.sqlite.exec(`UPDATE generation_preparation_${table} SET evidence_ref='changed'`),/immutable/);}
});
test('no verifier, estimates, request evidence and unverified bindings never become charges',async t=>{
 const f=await fixture(t);await f.run();assert.throws(()=>createPreparationFinancialWriter(f.env,{plan:f.plan}),/verifier_unavailable/);
 const denied=createPreparationFinancialWriter(f.env,{plan:f.plan,verifyEvidence:async()=>({verified:false})});await assert.rejects(denied.appendCharge(f.chargeRecord()),/unverified/);
 const wrong=createPreparationFinancialWriter(f.env,{plan:f.plan,verifyEvidence:async input=>({...await mockVerifier(input),binding:{...input.binding,accountId:'other'}})});await assert.rejects(wrong.appendCharge(f.chargeRecord()),/unverified/);
 assert.equal((await f.host.reconcile(f.request(),{...f.args,verified:true,charge:f.chargeRecord()})).reason,'original_verified_charge_required');await f.charge();await assert.rejects(f.event({evidence_kind:'usage-estimate'}),/invalid/);assert.equal(f.calls.length,1);
});
test('unresolved preparation blocks real image host and ordinary token/dollar reservations',async t=>{
 const image=await imageFixture(t),f=await fixture(t,{base:image});await f.run();await assert.rejects(image.run());assert.equal(image.calls.length,0);await assert.rejects(f.outside(),/outstanding/);await assert.rejects(reserveBudget(f.env,'mock-owner',1,{reservationId:'ordinary-token'}),/outstanding/);
});
test('unresolved image blocks preparation; final image permits separately granted preparation',async t=>{
 const image=await imageFixture(t),f=await fixture(t,{base:image});await image.run();await assert.rejects(f.run());assert.equal(f.calls.length,0);image.charge();assert.equal((await image.host.reconcile(image.request(),image.args)).action,'completed');await f.run();assert.equal(f.calls.length,1);assert.equal(image.calls.length,2);
});
test('funded preparation permits NEXT DISTINCT image while retaining original native allocation',async t=>{
 const image=await imageFixture(t),f=await fixture(t,{base:image});await f.run();await f.charge();await f.event();await f.reconcile();await image.run();assert.equal(image.calls.length,2);assert.equal(f.dollar(f.op().lifecycle_reservation_id).status,'active');assert.equal(f.calls.length,1);
});
test('simultaneous cross-host admission permits only one original operation',async t=>{
 const image=await imageFixture(t),f=await fixture(t,{base:image});await Promise.allSettled([f.run(),image.run()]);assert.equal(f.sqlite.prepare('SELECT (SELECT COUNT(*) FROM generation_preparation_operations)+(SELECT COUNT(*) FROM generation_study_operations) n').get().n,1);assert.ok(f.calls.length===1&&image.calls.length===0||f.calls.length===0&&image.calls.length===2);
});
test('native dollar limit denies combined reserve atomically, with no allowance overage',async t=>{
 const f=await fixture(t);const period=new Date().toISOString().slice(0,7);f.sqlite.prepare("INSERT INTO cost_budget_counters(scope,scope_id,period,used_microusd,reserved_microusd,hard_limit_microusd,updated_at) VALUES('user','mock-owner',?,99895000,0,100000000,'now')").run(period);await f.run().catch(()=>{});assert.equal(f.calls.length,0);assert.equal(f.op(),undefined);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM cost_budget_reservations').get().n,0);
});
test('direct status rewrite cannot qualify an unsettled original',async t=>{const f=await fixture(t);await f.run();assert.throws(()=>f.sqlite.exec("UPDATE generation_preparation_operations SET status='completed'"),/completion_unqualified/);});
test('accepted-estimate admission still holds unknown original charges',async t=>{
 const f=await fixture(t,{policy:p=>sealFinancialPolicy({...Object.fromEntries(Object.entries(p).filter(([k])=>k!=='id')),mode:'accepted-estimate',bound:null,maximumLossMicrousd:null,providerEnforcedChargeCap:false,residualDecision:{accepted:true,unknownMaximumAccepted:true,decisionRef:'SYNTHETIC-NOT-USER-ACCEPTANCE',liabilityOwner:'mock-owner'}})});await f.run();await f.charge();await f.event({remaining_uncertainty_microusd:null});assert.equal((await f.reconcile()).action,'hold');assert.equal(f.dollar(f.op().cost_reservation_id).status,'active');await assert.rejects(f.outside());
});
test('closed lifecycle cannot change or reduce a finalized original bill',async t=>{const f=await fixture(t);await f.run();await f.charge();await f.event({lifecycle_closed:1,lifecycle_microusd:0,lifecycle_incurred_microusd:300});await f.reconcile();await assert.rejects(f.event({lifecycle_closed:0}),/immutable/);await assert.rejects(f.event({lifecycle_closed:1,lifecycle_microusd:0,lifecycle_incurred_microusd:299}),/immutable/);});
test('conflicting simultaneous chain append has one winner and preserves the original',async t=>{const f=await fixture(t);await f.run();await f.charge();const first=f.eventRecord({provider_settled:0,remaining_uncertainty_microusd:null}),second={...first,evidence_id:'competing'};const result=await Promise.allSettled([f.writer.appendReconciliation(first),f.writer.appendReconciliation(second)]);assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM generation_preparation_reconciliations').get().n,1);assert.equal((await f.reconcile()).action,'hold');});
test('reservation identity cannot be rebound or deleted to escape exposure',async t=>{
 const f=await fixture(t);await f.run();for(const table of ['budget_reservations','cost_budget_reservations']){assert.throws(()=>f.sqlite.exec(`UPDATE ${table} SET reservation_id='replacement'`),/original_|closure/);assert.throws(()=>f.sqlite.exec(`DELETE FROM ${table}`),/immutable/);}assert.equal(f.calls.length,1);
});
test('funded provision remains counted in its original period after ordinary next-period admission',async t=>{
 const f=await fixture(t);await f.run();await f.charge();await f.event();await f.reconcile();const before=f.counters(),period=f.dollar(f.op().lifecycle_reservation_id).period;assert.equal((await f.outside({period:'2099-12'})).ok,true);assert.deepEqual(f.counters().filter(r=>r.period===period),before);assert.equal(before[0].reserved_microusd,10000);
});
test('lost original charge acknowledgement retries the same receipt only',async t=>{
 const f=await fixture(t);await f.run();const record=f.chargeRecord(),prepare=f.DB.prepare;let lost=true;f.DB.prepare=sql=>{const s=prepare(sql);if(sql.startsWith('INSERT INTO generation_preparation_charges')){const bind=s.bind.bind(s);s.bind=(...args)=>{const b=bind(...args),run=b.run.bind(b);b.run=async()=>{const r=await run();if(lost){lost=false;throw Error('lost ack');}return r;};return b;};}return s;};assert.equal((await f.writer.appendCharge(record)).reused,true);assert.equal(canonical(f.receipt()),canonical(record));assert.equal((await f.run()).reason,'original_purchase_only');assert.equal(f.calls.length,1);
});
test('disabled reconciliation does no DB or authority work',async()=>{assert.deepEqual(await createPreparationHost({DB:{prepare(){throw Error('read');}}},{plan:null}).reconcile(null),{action:'disabled',newPurchases:0});});
test('funded IMAGE lifecycle permits distinct preparation without releasing image allocation',async t=>{
 const {imageFinancialScope}=await import('../evals/generation-reliability/native-host/financial-policy.mjs');
 const image=await imageFixture(t,{policies:(plan,expiry)=>[sealFinancialPolicy({version:'generation-financial-policy-v1',scope:imageFinancialScope(plan,plan.manifest.trials[0],'mock-owner',{accountId:'offline-account',region:'offline-region'}),mode:'bounded-proof',reservationMicrousd:1000000,lifecycleReserveMicrousd:1000,estimate:{microusd:1000,assumptions:['SYNTHETIC ONLY'],costBasis:'synthetic',evidenceRef:'synthetic',reviewExpiresAt:expiry},bound:{maximumCostMicrousd:1001000,evidenceRef:'synthetic',scope:'fixture-only'},residualDecision:null,expiresAt:expiry,inFlightLimit:1,stopBehavior:'stop-before-next-stage-no-retry',overrunPolicy:'retain-and-hold',nextPurchase:'after-settlement-and-funded-lifecycle',lifecycle:{scope:'synthetic image retention',liabilityOwner:'mock-owner',evidenceRef:'synthetic',through:expiry,maximumMicrousd:1000}})]});
 const policy=image.financialPolicies[0],f=await fixture(t,{base:image});image.sqlite.prepare('INSERT INTO generation_study_financial_grants VALUES(?,?,?,?,?,?,?)').run(image.args.grantId,policy.scope.operationId,'mock-owner',policy.id,canonical(policy),image.expiry,'authorized');await image.run();image.charge({residual:null});const charge=image.sqlite.prepare('SELECT * FROM generation_study_charges').get();
 const record={evidence_id:'synthetic-image-event',operation_id:image.op().operation_id,sequence:1,previous_id:null,original_charge_hash:hash(charge),policy_id:policy.id,evidence_kind:'verified-incurred-charge',authority_version:'SYNTHETIC-ONLY',evidence_ref:'synthetic',recorded_at:new Date().toISOString(),provider_settled:1,incurred_microusd:650,incurred_tokens:30,remaining_uncertainty_microusd:0,lifecycle_microusd:1000,lifecycle_scope:policy.lifecycle.scope,liability_owner:policy.lifecycle.liabilityOwner,lifecycle_through:policy.lifecycle.through,lifecycle_evidence_ref:'synthetic',lifecycle_closed:0,lifecycle_incurred_microusd:null};
 const {appendVerifiedReconciliation}=await import('../evals/generation-reliability/native-host/financial-reconciliation.mjs');await appendVerifiedReconciliation(image.env,record);assert.equal((await image.host.reconcile(image.request(),image.args)).action,'completed');await f.run();assert.equal(f.calls.length,1);assert.equal(image.calls.length,2);assert.equal(f.dollar(image.op().lifecycle_reservation_id).status,'active');assert.equal(f.counters()[0].reserved_microusd,111000);
});
test('new exposure on a completed lifecycle can be recorded while a later original remains held',async t=>{
 const f=await fixture(t);await f.run();await f.charge();await f.event();await f.reconcile();const second=next(f);second.install();await second.run();await f.event({lifecycle_closed:1,lifecycle_microusd:0,lifecycle_incurred_microusd:11000});assert.equal((await f.reconcile()).action,'hold');assert.equal(f.dollar(f.op().lifecycle_reservation_id).used_microusd,11000);assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM generation_preparation_operations WHERE status='hold'").get().n,2);await assert.rejects(f.outside());assert.equal(f.calls.length,2);
});
test('observed custody corruption cannot be erased by financial reconciliation',async t=>{
 const f=await fixture(t);await f.run();f.sqlite.exec("UPDATE private_content SET content='corrupt' WHERE content_id IN(SELECT content_ref FROM generation_preparation_evidence WHERE slot='response')");assert.equal((await f.host.recover(f.request(),f.args)).reason,'original_evidence_unavailable');await f.charge();await f.event();assert.equal((await f.reconcile()).nextPurchaseEligible,false);assert.equal(f.op().custody_failed,1);assert.throws(()=>f.sqlite.exec('UPDATE generation_preparation_operations SET custody_failed=0'),/immutable/);assert.equal(f.calls.length,1);
});

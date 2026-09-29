// R35 evidence only. Existing unmodified production contracts; disposable fictional DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from '../../../../tests/generation-p2-fixture.mjs';
import {pairGuard} from '../../../../evals/generation-reliability/native-host/supplied-authority.mjs';
import {externalGuard} from '../../../../evals/generation-reliability/preparation/external-guard.mjs';
import {sealFinancialPolicy,validateFinancialPolicy} from '../../../../evals/generation-reliability/native-host/financial-policy.mjs';
import {financialCompletion} from '../../../../evals/generation-reliability/native-host/financial-reconciliation.mjs';
import {PROTOCOL} from '../../../../evals/generation-reliability/p2/contract.mjs';
const now='2026-09-24T12:00:00.000Z';
function operation(f,arm){const trial=f.plan.manifest.trials.find(t=>t.id===arm),id=f.operationKey('mock-owner',f.plan,trial),p=f.policies.find(p=>p.scope.operationId===id);f.sqlite.prepare("INSERT INTO generation_study_operations(operation_id,owner_id,grant_id,plan_id,trial_id,request_hash,token_reservation_id,cost_reservation_id,status,created_at,expires_at,financial_policy_id,lifecycle_reservation_id,artifact_hash,receipt_hash,private_writes,provider_request_id,reason) VALUES(?,'mock-owner',?,?,?,?,?,?,'hold',?,?,?,?, 'OFFLINE-artifact','OFFLINE-receipt',9,'OFFLINE-original-response','original_charge_unreconciled')").run(id,f.grantId,f.plan.id,arm,'OFFLINE-request',arm+'-token',arm+'-cost',now,p.expiresAt,p.id,arm+'-life');return id;}
function token(f,id,correlation){f.sqlite.prepare("INSERT INTO budget_reservations(reservation_id,owner_id,stream_id,correlation_id,operation,period,reserved_tokens,status,created_at,updated_at) VALUES(?,'mock-owner','OFFLINE-stream',?,'generation-study','2026-09',20000,'active',?,?)").run(id,correlation,now,now);}
function cost(f,id,correlation){f.sqlite.prepare("INSERT INTO cost_budget_reservations(reservation_id,owner_id,stream_id,correlation_id,operation,period,reserved_microusd,status,created_at,updated_at) VALUES(?,'mock-owner','OFFLINE-stream',?,'generation-study','2026-09',1000,'active',?,?)").run(id,correlation,now,now);}
test('CURRENT: independent gates deny unsettled baseline; no provider transport',async t=>{
 const f=await fixture(t);const id=operation(f,'baseline');token(f,'baseline-token',id);cost(f,'baseline-cost',id);cost(f,'baseline-life',id);
 const principal=f.sqlite.prepare('SELECT principal_hash FROM generation_study_supplied_reviews').get().principal_hash;
 f.sqlite.prepare('INSERT INTO generation_study_supplied_observations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'OFFLINE-review','mock-owner',principal,'OFFLINE-artifact','OFFLINE-receipt',PROTOCOL,'clear','expected-failure','baseline tether','OFFLINE-human-simulation',1,now);
 const g=pairGuard(f.plan,'mock-owner',f.grantId,f.plan.manifest.trials[1]);
 await t.test('human resume alone cannot satisfy legacy completed predicate',()=>assert.equal(f.sqlite.prepare('SELECT 1 WHERE '+g.sql).get(...g.bindings),undefined));
 await t.test('owner unique index independently denies treatment operation',()=>assert.throws(()=>operation(f,'treatment'),/UNIQUE constraint failed: generation_study_operations.owner_id/));
 await t.test('external token trigger independently denies new token reservation',()=>assert.throws(()=>token(f,'treatment-token','OFFLINE-treatment'),/generation_study_outstanding_exposure/));
 await t.test('external cost trigger independently denies new cost reservation',()=>assert.throws(()=>cost(f,'treatment-cost','OFFLINE-treatment'),/generation_study_outstanding_exposure/));
 await t.test('external guard denies active baseline reservations',async()=>{const x=await externalGuard(f.DB,'mock-owner');assert.equal(f.sqlite.prepare('SELECT 1 WHERE '+x.sql).get(...x.bindings),undefined);});
 await t.test('current sealed policy rejects proposed nextPurchase discriminator',()=>{const {id:ignored,...p}=f.policies[0];const proposed=sealFinancialPolicy({...p,nextPurchase:'after-original-result-and-accepted-pair-exposure'});assert.throws(()=>validateFinancialPolicy(proposed,proposed.scope),/study_financial_policy_invalid/);});
 await t.test('no reconciliation cannot imply settled provider or eligible next purchase',async()=>{const out=await financialCompletion(f.DB,f.op(),{residual_exposure_microusd:null},f.policies[0]);assert.equal(out.providerSettled,false);assert.equal(out.nextPurchaseEligible,false);});
 f.charge();f.event('baseline',{provider_settled:0,remaining_uncertainty_microusd:null});
 await t.test('honest pending reconciliation remains a lifecycle hold',()=>assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM generation_study_lifecycle_holds').get().n,1));
 await t.test('pending charge cannot release original token or cost holds',()=>{assert.throws(()=>f.sqlite.exec("UPDATE budget_reservations SET status='released' WHERE reservation_id='baseline-token'"),/generation_study_original_usage_required/);assert.throws(()=>f.sqlite.exec("UPDATE cost_budget_reservations SET status='released' WHERE reservation_id='baseline-cost'"),/generation_study_original_charge_required/);});
 await t.test('reconcile uncertainty latches terminal pair stop in current host',async()=>{await f.host.reconcile(f.request(),f.args());assert.ok(f.sqlite.prepare('SELECT hard_stop FROM generation_study_supplied_reviews').get().hard_stop);});
 assert.equal(f.calls.length,0);assert.equal(f.op().status,'hold');assert.equal(f.sqlite.prepare("SELECT status FROM cost_budget_reservations WHERE reservation_id='baseline-cost'").get().status,'active');
});

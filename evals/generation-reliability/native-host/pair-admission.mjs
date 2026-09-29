import {canonical,hash} from '../core.mjs';
import {operationKey} from '../execution-plan.mjs';
import {PAIR_POLICY_VERSION,validatePairExposure} from './pair-policy.mjs';
import {resolveFinancialPolicy,imageFinancialScope} from './financial-policy.mjs';
import {financialCompletion} from './financial-reconciliation.mjs';
import {checkedBatch} from './authority.mjs';
import {HOST_LIMITS} from './transport.mjs';
const fail=()=>{throw Error('study_pair_advancement_denied');};
export async function pairAdmission(env,a,plan,trial,policies,account){
 const db=env.DB,ids=plan.manifest.trials.map(t=>operationKey(a.user.userId,plan,t));
 const pairPolicies=[];
 for(const t of plan.manifest.trials){const p=policies.find(p=>p.scope.operationId===operationKey(a.user.userId,plan,t));if(!p||p.version!==PAIR_POLICY_VERSION)fail();validatePairExposure(p.pair,p.scope,p);a.guards.push((await resolveFinancialPolicy(env,{policy:p,scope:imageFinancialScope(plan,t,a.user.userId,account),grantId:a.grant.grant_id,ownerId:a.user.userId})).guard);pairPolicies.push(p);}
 const pair=pairPolicies[0].pair;
 if(canonical(pair)!==canonical(pairPolicies[1].pair)||pair.totalMicrousd!==a.grant.allowance_microusd||pair.arms.some(p=>p.tokens!==a.grant.token_allowance))fail();
 if(trial.id!=='treatment')return null;
 const base=await db.prepare('SELECT * FROM generation_study_operations WHERE operation_id=?').bind(ids[0]).first();
 if(!base)fail();if(base.status==='completed')return null;
 const sql='EXISTS(SELECT 1 FROM generation_study_pair_eligible WHERE pair_id=? AND owner_id=? AND baseline_id=? AND treatment_id=?)',bindings=[pair.id,a.user.userId,...ids];
 if(!await db.prepare('SELECT 1 WHERE '+sql).bind(...bindings).first())fail();a.guards.push({sql,bindings});
 if(base.pair_artifact_verified_hash!==base.artifact_hash)fail();
 // Reserve each metadata observation durably, including refused/lost acknowledgements.
 await checkedBatch(env,[...a.guards,{sql:'EXISTS(SELECT 1 FROM generation_study_operations WHERE operation_id=? AND pair_head_reads<4)',bindings:[base.operation_id]}],[db.prepare('UPDATE generation_study_operations SET pair_head_reads=pair_head_reads+1 WHERE operation_id=?').bind(base.operation_id)]);
 const object=await env.MEDIA.head(base.artifact_ref);
 if(env.DB!==db||!object||object.size>HOST_LIMITS.artifactBytes||object.customMetadata?.owner!==a.user.userId||object.customMetadata?.operation!==base.operation_id||object.customMetadata?.sha256!==base.artifact_hash)fail();
 const charge=await db.prepare('SELECT * FROM generation_study_charges WHERE operation_id=?').bind(base.operation_id).first();
 if(charge){
  if(charge.provider_request_id!==base.provider_request_id||charge.receipt_hash!==base.receipt_hash||charge.scope_hash!==hash({planId:plan.id,inventory:plan.inventory,limits:HOST_LIMITS})||charge.measured_microusd>pair.arms[0].cost||charge.measured_tokens>pair.arms[0].tokens)fail();
  const complete=await financialCompletion(db,base,charge,pairPolicies[0]);
  if(!['verified_reconciliation_required','original_purchase_uncertain'].includes(complete.reason)||complete.providerSettled)fail();
  a.guards.push({sql:'EXISTS(SELECT 1 FROM generation_study_charges WHERE operation_id=? AND provider_request_id=? AND receipt_hash=? AND measured_microusd=? AND measured_tokens=?)',bindings:[base.operation_id,charge.provider_request_id,charge.receipt_hash,charge.measured_microusd,charge.measured_tokens]});
 }
 const latest=await db.prepare('SELECT evidence_id FROM generation_study_reconciliations WHERE operation_id=? ORDER BY sequence DESC LIMIT 1').bind(base.operation_id).first();
 a.guards.push({sql:'(SELECT evidence_id FROM generation_study_reconciliations WHERE operation_id=? ORDER BY sequence DESC LIMIT 1) IS ?',bindings:[base.operation_id,latest?.evidence_id??null]});
 return {base,pair,ids,policies:pairPolicies};
}
export async function transferStatements(db,a,plan,pending,period){
 if(!pending)return[];
 const e=(await db.prepare('SELECT slot,sha256 FROM generation_study_evidence WHERE operation_id=? ORDER BY slot').bind(pending.base.operation_id).all()).results;
 const columns=['pair_id','owner_id','grant_id','plan_id','review_id','preview_id','baseline_id','treatment_id','baseline_token_id','baseline_cost_id','baseline_lifecycle_id','treatment_token_id','treatment_cost_id','treatment_lifecycle_id','baseline_policy','treatment_policy','pair_json','provider_request_id','artifact_hash','receipt_hash','evidence_set_hash','stream_id','period','baseline_cost','baseline_lifecycle','baseline_tokens','treatment_cost','treatment_lifecycle','treatment_tokens','expires_at'];
 const row=await db.prepare('SELECT * FROM generation_study_pair_eligible WHERE pair_id=?').bind(pending.pair.id).first();if(!row)fail();
 const values=columns.map(k=>k==='evidence_set_hash'?hash(e):k==='stream_id'?a.user.streamId:k==='period'?period:row[k]);
 return [db.prepare(`INSERT INTO generation_study_pair_transfers(${columns.join(',')},created_at) VALUES(${columns.map(()=>'?').join(',')},strftime('%Y-%m-%dT%H:%M:%fZ','now'))`).bind(...values),db.prepare('UPDATE generation_study_operations SET pair_yield_to=? WHERE operation_id=? AND pair_yield_to IS NULL').bind(pending.ids[1],pending.ids[0])];
}
/** Final predicates after native counter initialization/reservations, in that same batch.
 * Current used amounts plus all outstanding cross-period liabilities; never free baseline reserves. */
export function pairHeadroomGuards(owner,grantId,period,allowance){
 return [{sql:`COALESCE((SELECT SUM(CASE WHEN o.status='completed' THEN COALESCE(o.measured_microusd,json_extract(f.policy_json,'$.reservationMicrousd')) ELSE json_extract(f.policy_json,'$.reservationMicrousd') END+json_extract(f.policy_json,'$.lifecycleReserveMicrousd')) FROM generation_study_operations o JOIN generation_study_financial_grants f ON f.grant_id=o.grant_id AND f.operation_id=o.operation_id WHERE o.grant_id=?),0)<=?`,bindings:[grantId,allowance]},
 ...['user','workspace'].flatMap(scope=>[
 {sql:`EXISTS(SELECT 1 FROM budget_counters c WHERE c.scope=? AND c.scope_id=? AND c.period=? AND c.used_tokens+MAX(c.reserved_tokens,COALESCE((SELECT SUM(reserved_tokens) FROM budget_reservations r WHERE ${scope==='user'?'r.owner_id=? AND ':''}r.status IN('authorizing','active')),0))<=c.hard_limit_tokens)`,bindings:[scope,scope==='user'?owner:'forma',period,...(scope==='user'?[owner]:[])]},
 {sql:`EXISTS(SELECT 1 FROM cost_budget_counters c WHERE c.scope=? AND c.scope_id=? AND c.period=? AND c.used_microusd+MAX(c.reserved_microusd,COALESCE((SELECT SUM(reserved_microusd) FROM cost_budget_reservations r WHERE ${scope==='user'?'r.owner_id=? AND ':"r.workspace_id='forma' AND "}r.status NOT IN('settled','released')),0))<=c.hard_limit_microusd)`,bindings:[scope,scope==='user'?owner:'forma',period,...(scope==='user'?[owner]:[])]}
 ])];
}

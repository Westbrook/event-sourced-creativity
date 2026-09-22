import { hash, canonical } from '../core.mjs';
const integer=n=>Number.isSafeInteger(n)&&n>=0;
const text=v=>typeof v==='string'&&v.trim().length>0;
// Only these two disabled, schema-qualified hosts share F3 semantics. No caller-supplied table name.
const tablePrefix=kind=>{if(!['study','preparation'].includes(kind))throw Error('financial_schema_invalid');return `generation_${kind}`;};
/** Reads server-entered verified billing assessments only. No request body is financial evidence. */
export async function financialCompletion(db,op,charge,policy,kind='study') {
  const table=tablePrefix(kind);
  const r=await db.prepare(`SELECT * FROM ${table}_reconciliations WHERE operation_id=? ORDER BY sequence DESC LIMIT 1`).bind(op.operation_id).first();
  const result={providerSettled:false,lifecycleFunded:false,nextPurchaseEligible:false,evidenceId:r?.evidence_id??null,originalResidualMicrousd:charge.residual_exposure_microusd,remainingUncertaintyMicrousd:r?.remaining_uncertainty_microusd??null};
  if(!r)return {...result,reason:'verified_reconciliation_required'};
  if(r.original_charge_hash!==hash(charge)||r.policy_id!==policy.id||r.evidence_kind!=='verified-incurred-charge'
    ||!text(r.authority_version)||!text(r.evidence_ref)||!Number.isFinite(Date.parse(r.recorded_at))||Date.parse(r.recorded_at)>Date.now()
    ||r.lifecycle_scope!==policy.lifecycle.scope||r.liability_owner!==policy.lifecycle.liabilityOwner
    ||r.lifecycle_through!==policy.lifecycle.through||!text(r.lifecycle_evidence_ref))return {...result,reason:'reconciliation_binding_conflict'};
  result.providerSettled=r.provider_settled===1;
  result.incurredMicrousd=r.incurred_microusd;result.incurredTokens=r.incurred_tokens;
  if(!integer(r.incurred_microusd)||!integer(r.incurred_tokens)||r.incurred_microusd<charge.measured_microusd||r.incurred_tokens<charge.measured_tokens)return {...result,providerSettled:false,reason:'incurred_charge_conflict'};
  if(!result.providerSettled||r.remaining_uncertainty_microusd!==0)return {...result,reason:'original_purchase_uncertain'};
  const reserve=op.lifecycle_reservation_id?await db.prepare('SELECT * FROM cost_budget_reservations WHERE reservation_id=? AND owner_id=?').bind(op.lifecycle_reservation_id,op.owner_id).first():null;
  if(r.lifecycle_closed===1){
    if(r.lifecycle_microusd!==0||!integer(r.lifecycle_incurred_microusd))return {...result,reason:'lifecycle_closure_invalid'};
    // Actual incurred lifecycle cost is never clamped. An overrun remains a hold after recording it.
    result.lifecycleFunded=reserve?['settled','released'].includes(reserve.status)&&reserve.used_microusd===r.lifecycle_incurred_microusd&&reserve.used_microusd<=reserve.reserved_microusd:r.lifecycle_incurred_microusd===0;
  }else{
    result.lifecycleFunded=integer(r.lifecycle_microusd)&&r.lifecycle_microusd<=policy.lifecycle.maximumMicrousd&&Date.now()<Date.parse(r.lifecycle_through)
      &&Boolean(reserve&&reserve.status==='active'&&reserve.reserved_microusd>=r.lifecycle_microusd&&reserve.reserved_microusd===policy.lifecycleReserveMicrousd);
  }
  return {...result,nextPurchaseEligible:result.lifecycleFunded,reason:result.lifecycleFunded?null:'lifecycle_unfunded_or_expired',lifecycle:r};
}

/** Server-internal append seam. Caller is the billing verifier, never an HTTP/UI body.
 * The verifier's identity, private evidence reference and incurred classification must already be established.
 * A lost commit acknowledgement is retried with the same complete record and evidence_id.
 */
export async function appendVerifiedReconciliation(env,record,kind='study') {
  const table=tablePrefix(kind);
  const columns=['evidence_id','operation_id','sequence','previous_id','original_charge_hash','policy_id','evidence_kind','authority_version','evidence_ref','recorded_at','provider_settled','incurred_microusd','incurred_tokens','remaining_uncertainty_microusd','lifecycle_microusd','lifecycle_scope','liability_owner','lifecycle_through','lifecycle_evidence_ref','lifecycle_closed','lifecycle_incurred_microusd'];
  const deny=()=>{throw Error('study_reconciliation_record_invalid');};
  if(canonical(Object.keys(record).sort())!==canonical([...columns].sort())||record.evidence_kind!=='verified-incurred-charge'
    ||!['evidence_id','operation_id','policy_id','authority_version','evidence_ref','lifecycle_evidence_ref','lifecycle_scope','liability_owner'].every(k=>text(record[k]))
    ||!['sequence','incurred_microusd','incurred_tokens','lifecycle_microusd'].every(k=>integer(record[k]))
    ||record.sequence===0||![0,1].includes(record.provider_settled)||![0,1].includes(record.lifecycle_closed)
    ||record.remaining_uncertainty_microusd!==null&&!integer(record.remaining_uncertainty_microusd)
    ||record.lifecycle_incurred_microusd!==null&&!integer(record.lifecycle_incurred_microusd)
    ||!Number.isFinite(Date.parse(record.recorded_at))||!Number.isFinite(Date.parse(record.lifecycle_through)))deny();
  const db=env.DB;
  const same=async()=>{
    const prior=await db.prepare(`SELECT * FROM ${table}_reconciliations WHERE evidence_id=?`).bind(record.evidence_id).first();
    if(prior&&canonical(prior)!==canonical(record))throw Error('study_reconciliation_id_conflict');
    return prior;
  };
  if(await same())return {evidenceId:record.evidence_id,reused:true};
  const charge=await db.prepare(`SELECT * FROM ${table}_charges WHERE operation_id=?`).bind(record.operation_id).first();
  const op=await db.prepare(`SELECT * FROM ${table}_operations WHERE operation_id=?`).bind(record.operation_id).first();
  if(!charge||!op||hash(charge)!==record.original_charge_hash||op.financial_policy_id!==record.policy_id)deny();
  try{
    const result=await db.prepare(`INSERT INTO ${table}_reconciliations (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`).bind(...columns.map(k=>record[k])).run();
    if(env.DB!==db||result.success!==true||result.meta?.changes!==1)throw Error('study_reconciliation_unacknowledged');
  }catch(error){if(env.DB===db&&await same())return {evidenceId:record.evidence_id,reused:true};throw error;}
  return {evidenceId:record.evidence_id,reused:false};
}

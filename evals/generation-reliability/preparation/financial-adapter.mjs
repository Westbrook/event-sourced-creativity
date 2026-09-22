import { canonical, hash } from '../core.mjs';
import { appendVerifiedReconciliation, financialCompletion } from '../native-host/financial-reconciliation.mjs';
import { financialScope } from './contract.mjs';

export const preparationFinancialCompletion=(db,op,charge,policy)=>financialCompletion(db,op,charge,policy,'preparation');
const columns=['operation_id','provider_request_id','receipt_hash','measured_microusd','measured_tokens','authority_version','evidence_ref','recorded_at','scope_hash','residual_exposure_microusd'];
const integer=n=>Number.isSafeInteger(n)&&n>=0;

/** Restricted server construction seam; deliberately no default live verifier or HTTP ingestion.
 * verifyEvidence must authenticate a private evidence producer and independently establish ALL
 * supplied claims, including original request/account/project/region and finality. A seal, usage
 * arithmetic or aggregate account cost cannot satisfy it. Tests inject a SYNTHETIC verifier.
 * Only trusted server code receives this writer and DB write access; possession is not invoice proof.
 */
export function createPreparationFinancialWriter(env,{plan,verifyEvidence}){
  if(typeof verifyEvidence!=='function')throw Error('preparation_billing_verifier_unavailable');
  const db=env.DB,original=structuredClone(plan);
  async function verify(kind,record){
    if(env.DB!==db)throw Error('preparation_database_changed');
    const op=await db.prepare('SELECT * FROM generation_preparation_operations WHERE operation_id=?').bind(record.operation_id).first();
    if(!op||op.plan_id!==original.id||op.owner_id!==original.payerId||op.scope_hash!==hash(financialScope(original))||!op.provider_request_id||!op.receipt_hash)throw Error('preparation_original_binding_required');
    const binding={operationId:op.operation_id,planId:op.plan_id,requestHash:op.request_hash,providerRequestId:op.provider_request_id,receiptHash:op.receipt_hash,scopeHash:op.scope_hash,accountId:original.config.accountId,projectHeader:original.config.projectHeader,region:original.config.region,credentialBinding:original.config.credentialBinding};
    const result=await verifyEvidence(Object.freeze({kind,record:structuredClone(record),binding:structuredClone(binding)}));
    if(env.DB!==db||result?.verified!==true||canonical(result.binding)!==canonical(binding)||result.recordHash!==hash(record)||result.classification!=='verified-incurred-charge')throw Error('preparation_billing_evidence_unverified');
    return op;
  }
  async function appendCharge(input){
    const record=structuredClone(input),op=await verify('original-charge',record);
    if(canonical(Object.keys(record).sort())!==canonical([...columns].sort())||!integer(record.measured_microusd)||!integer(record.measured_tokens)||record.residual_exposure_microusd!==null&&!integer(record.residual_exposure_microusd)||!record.authority_version||!record.evidence_ref||!Number.isFinite(Date.parse(record.recorded_at))||Date.parse(record.recorded_at)>Date.now()||record.provider_request_id!==op.provider_request_id||record.receipt_hash!==op.receipt_hash||record.scope_hash!==op.scope_hash)throw Error('preparation_charge_invalid');
    const same=async()=>{const prior=await db.prepare('SELECT * FROM generation_preparation_charges WHERE operation_id=?').bind(record.operation_id).first();if(prior&&canonical(prior)!==canonical(record))throw Error('preparation_charge_conflict');return prior;};
    if(await same())return {reused:true};
    try{const r=await db.prepare(`INSERT INTO generation_preparation_charges (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`).bind(...columns.map(k=>record[k])).run();if(env.DB!==db||r.success!==true||r.meta?.changes!==1)throw Error('preparation_charge_unacknowledged');}
    catch(e){if(env.DB===db&&await same())return {reused:true};throw e;}
    return {reused:false};
  }
  async function appendReconciliation(input){const record=structuredClone(input);await verify('reconciliation',record);return appendVerifiedReconciliation(env,record,'preparation');}
  return Object.freeze({appendCharge,appendReconciliation});
}

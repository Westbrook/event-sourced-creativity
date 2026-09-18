import type { WorkerEnv } from "./runtime.ts";
import { memoryCanonical, type MemorySqlGuard } from "./memory-sql.ts";
import { memoryDigest } from "../src/model/scoped-memory.ts";
import { memoryDerivationMaximumMicroUsd, derivationHash, derivationId, derivationExact, derivationInteger } from "./memory-derivation-policy.ts";
import { DERIVATION_FINANCE_TABLE_COLUMNS } from "./memory-derivation-finance-schema.ts";
import { derivationAssertion, derivationResults, derivationVerified, derivationChanged, memoryDerivationSchema, synchronizeDerivationMonthCap } from "./memory-derivation-store.ts";
import { nativeDerivationLeaseInputs, type NativeDerivationLease } from "./memory-derivation-admission.ts";
import { nativeDerivationSourceForEvidence, nativeDerivationSourceStatements, replayNativeDerivationSources, type NativeDerivationSourceCapture } from "./memory-derivation-sources.ts";
import { prepareBudgetReservation, prepareCostBudgetReservation, claimCostBudgetReservationWithoutRelease, claimedProviderBudgetGuard } from "./pilot-policy.ts";

type Row = Record<string, string | number | null>;
export type NativeDerivationFinancialRecord = {
  finance_id:string; payer_id:string; period:string; token_id:string; cost_id:string;
  operation:"memory-derivation:rolling-summary"|"memory-derivation:profile"|"memory-derivation:suggestion";
  provider:"openai"; model:string; terms_sha256:string; request_sha256:string;
  input_price:number; cached_input_price:number; output_price:number; maximum_input:number; maximum_output:number;
  maximum_tokens:number; maximum_microusd:number; authorized_cap_microusd:number;
  workspace_id:string; project_access_id:string|null; pilot_cohort_id:string|null;
  created_at:string; dispatch_token:string|null; dispatched_at:string|null; admission_closed_at:string|null;
};
declare const financialBrand:unique symbol;
export type NativeDerivationFinance=Readonly<{[financialBrand]:true}>;
declare const dispatchBrand:unique symbol;
export type NativeDerivationDispatch=Readonly<{[dispatchBrand]:true}>;
type Held={env:WorkerEnv;db:WorkerEnv["DB"];lease:NativeDerivationLease;capture:NativeDerivationSourceCapture;record:NativeDerivationFinancialRecord;attempted:boolean;transportAttempted?:boolean};
const held=new WeakMap<NativeDerivationFinance,Held>();
const dispatched=new WeakMap<NativeDerivationDispatch,Held>();
const columns=DERIVATION_FINANCE_TABLE_COLUMNS.memory_derivation_finance;
const clock=()=>new Date().toISOString();
const fail=():never=>{throw Error("memory-finance-unavailable");};
const exact=(row:NativeDerivationFinancialRecord):MemorySqlGuard=>({condition:`EXISTS(SELECT 1 FROM memory_derivation_finance WHERE ${columns.map(column=>column+" IS ?").join(" AND ")})`,bindings:columns.map(column=>row[column])});
function sourceCurrent(env:WorkerEnv,state:Held){
  if(state.env!==env||state.db!==env.DB)fail();
  const input=nativeDerivationLeaseInputs(env,state.lease),source=nativeDerivationSourceForEvidence(env,state.capture,state.lease);
  if(input.job.job_id!==source.jobId||input.grant.purpose!==source.purpose)fail();
  return input;
}
function validBudgetReceipts(rows:D1Result<Record<string,unknown>>[],reservationIndex:number,userBeforeIndex?:number){
  return rows.every((row,index)=>{
    if(index===userBeforeIndex)return row.results.length===1&&derivationExact(row.results[0],['used_microusd','reserved_microusd','hard_limit_microusd'])
      &&Object.values(row.results[0]).every(value=>derivationInteger(value));
    return derivationChanged(row,1)||(index<reservationIndex&&derivationChanged(row,0));
  });
}
function validSourceReceipt(row:D1Result<Record<string,unknown>>){
  return row.results.length===1&&(derivationVerified(row)||derivationExact(row.results[0],["context_source_asserted"])&&row.results[0].context_source_asserted===1);
}

/** Reserve only for process-local native lease + full-source proofs. The exact
 * request hash comes from the server processor, never request JSON. A lost ACK
 * retains the original deterministic identity; it does not authorize replay. */
export async function reserveNativeDerivationFinance(env:WorkerEnv,lease:NativeDerivationLease,capture:NativeDerivationSourceCapture,requestHash:string):Promise<NativeDerivationFinance|null>{
  if(!derivationHash(requestHash))return null;
  const input=nativeDerivationLeaseInputs(env,lease),source=nativeDerivationSourceForEvidence(env,capture,lease),db=env.DB;
  if(input.job.job_id!==source.jobId||input.grant.purpose!==source.purpose)return null;
  const terms=input.qualification.terms,maximum=memoryDerivationMaximumMicroUsd(terms),schema=await memoryDerivationSchema(env);
  if(!maximum||!schema.financePresent||env.DB!==db)return null;
  const period=clock().slice(0,7),cap=await synchronizeDerivationMonthCap(env,input.grant.payer_user_id,period);
  if(cap===null||maximum>cap)return null;
  const id=await memoryDigest(memoryCanonical(["native-memory-finance-v1",input.job.job_id,input.job.lease_token]));
  const now=clock(),scope=input.authority.binding.scope??undefined,common={streamId:"memory-derivation:"+id,correlationId:id,
    operation:`memory-derivation:${input.grant.purpose}` as NativeDerivationFinancialRecord["operation"],period,createdAt:now,batchCounterInitialization:true,projectScope:scope};
  const tokens=await prepareBudgetReservation(env,input.grant.payer_user_id,terms.maximumInputTokens+terms.maximumOutputTokens,{...common,reservationId:id+":tokens"});
  const cost=await prepareCostBudgetReservation(env,input.grant.payer_user_id,maximum,{...common,reservationId:id+":usd",maximumMicrousd:maximum,allowUserOverage:false});
  if(!tokens.ok||!cost.ok||env.DB!==db)return null;
  const record:NativeDerivationFinancialRecord={finance_id:id,payer_id:input.grant.payer_user_id,period,token_id:tokens.reservationId,cost_id:cost.reservationId,
    operation:common.operation,provider:"openai",model:terms.model,terms_sha256:input.grant.terms_sha256,request_sha256:requestHash,
    input_price:terms.pricing.inputMicroUsdPerMillion,cached_input_price:terms.pricing.cachedInputMicroUsdPerMillion,output_price:terms.pricing.outputMicroUsdPerMillion,
    maximum_input:terms.maximumInputTokens,maximum_output:terms.maximumOutputTokens,maximum_tokens:terms.maximumInputTokens+terms.maximumOutputTokens,
    maximum_microusd:maximum,authorized_cap_microusd:terms.monthlyCapMicroUsd,workspace_id:scope?.organizationId??"forma",project_access_id:scope?.projectAccessId??null,
    pilot_cohort_id:cost.pilot?.cohort_id??null,created_at:now,dispatch_token:null,dispatched_at:null,admission_closed_at:null};
  const state:Held={env,db,lease,capture,record,attempted:false};sourceCurrent(env,state);
  const proof=nativeDerivationSourceStatements(env,capture),assert=(guard:MemorySqlGuard)=>derivationAssertion(env,guard);
  const statements=[...proof,assert(schema.guard),db.prepare(`INSERT INTO memory_derivation_finance(${columns.join(",")}) VALUES(${columns.map(()=>"?").join(",")})`).bind(...columns.map(column=>record[column])),
    assert({condition:"changes()=1",bindings:[]}),...tokens.statements,...cost.statements,
    assert({condition:`EXISTS(SELECT 1 FROM budget_reservations WHERE reservation_id=? AND owner_id=? AND status='active' AND reserved_tokens=?)
      AND EXISTS(SELECT 1 FROM cost_budget_reservations WHERE reservation_id=? AND owner_id=? AND status='active' AND reserved_microusd=?)`,
      bindings:[record.token_id,record.payer_id,record.maximum_tokens,record.cost_id,record.payer_id,record.maximum_microusd]}),
    db.prepare("INSERT INTO memory_derivation_job_finance(job_id,finance_id) VALUES(?,?)").bind(input.job.job_id,id),
    assert({condition:"changes()=1",bindings:[]}),assert(exact(record))];
  const result=structuredClone(await db.batch<Record<string,unknown>>(statements));
  sourceCurrent(env,state);
  if(!derivationResults(result,statements.length)||!result.slice(0,proof.length).every(validSourceReceipt)
    ||![proof.length,proof.length+2,statements.length-4,statements.length-2,statements.length-1].every(index=>derivationVerified(result[index]!))
    ||!validBudgetReceipts(result.slice(proof.length+3,proof.length+3+tokens.statements.length),tokens.reservationStatementIndex)
    ||!validBudgetReceipts(result.slice(proof.length+3+tokens.statements.length,proof.length+3+tokens.statements.length+cost.statements.length),cost.reservationStatementIndex,cost.userBeforeStatementIndex)
    ||!derivationChanged(result[proof.length+1]!,1)||!derivationChanged(result[statements.length-3]!,1))throw Error("memory-finance-reservation-unconfirmed");
  const handle=Object.freeze({}) as NativeDerivationFinance;held.set(handle,state);return handle;
}

/** Commit exactly one dispatch claim before any transport call. Failure or a
 * lost acknowledgement cannot release or reuse the original paired holds. */
export async function claimNativeDerivationDispatch(env:WorkerEnv,handle:NativeDerivationFinance):Promise<NativeDerivationDispatch|null>{
  const state=held.get(handle);if(!state||state.attempted)return null;
  const input=sourceCurrent(env,state);state.attempted=true;
  if(!await claimCostBudgetReservationWithoutRelease(env,state.record.payer_id,state.record.cost_id))return null;
  sourceCurrent(env,state);
  const proof=nativeDerivationSourceStatements(env,state.capture),f=state.record;
  const budget=claimedProviderBudgetGuard(env,{actorUserId:f.payer_id,streamId:"memory-derivation:"+f.finance_id,correlationId:f.finance_id,period:f.period,
    tokenReservationId:f.token_id,costReservationId:f.cost_id,reservedTokens:f.maximum_tokens,reservedMicrousd:f.maximum_microusd,
    projectScope:input.authority.binding.scope??null,pilotCohortId:f.pilot_cohort_id},f.operation);
  const next={...f,dispatch_token:crypto.randomUUID(),dispatched_at:clock()};
  const statements=[...proof,derivationAssertion(env,exact(f)),derivationAssertion(env,{condition:budget.sql,bindings:budget.bindings??[]}),
    state.db.prepare("UPDATE memory_derivation_finance SET dispatch_token=?,dispatched_at=? WHERE finance_id=? AND dispatch_token IS NULL AND admission_closed_at IS NULL")
      .bind(next.dispatch_token,next.dispatched_at,f.finance_id),derivationAssertion(env,{condition:"changes()=1",bindings:[]}),derivationAssertion(env,exact(next))];
  const receipt=structuredClone(await state.db.batch<Record<string,unknown>>(statements));
  sourceCurrent(env,state);
  if(!derivationResults(receipt,statements.length)||!receipt.slice(0,proof.length).every(validSourceReceipt)
    ||![proof.length,proof.length+1,proof.length+3,proof.length+4].every(index=>derivationVerified(receipt[index]!))
    ||!derivationChanged(receipt[proof.length+2]!,1))throw Error("memory-finance-dispatch-unconfirmed");
  state.record=next;const dispatch=Object.freeze({}) as NativeDerivationDispatch;dispatched.set(dispatch,state);return dispatch;
}
export function nativeDerivationDispatchData(env:WorkerEnv,dispatch:NativeDerivationDispatch){
  const state=dispatched.get(dispatch);if(!state||state.env!==env||state.db!==env.DB)return fail();
  // Financial identity stays usable after source withdrawal; this accessor must
  // never be used as fresh source authority or permission for another POST.
  return structuredClone(state.record);
}
export async function nativeDerivationDispatchSource(env:WorkerEnv,dispatch:NativeDerivationDispatch){
  const state=dispatched.get(dispatch);if(!state)return fail();sourceCurrent(env,state);if(!await replayNativeDerivationSources(env,state.capture))return fail();sourceCurrent(env,state);return state.capture;
}

/** Minimized ledger read for recovery; deliberately independent of user/source
 * access so late verified usage remains payable after privacy erasure. */
export async function readNativeDerivationFinance(env:WorkerEnv,financeId:string){
  if(!derivationId(financeId))return null;
  const db=env.DB,schema=await memoryDerivationSchema(env);if(!schema.financePresent||env.DB!==db)return null;
  const result=structuredClone(await db.prepare(`SELECT ${columns.join(",")} FROM memory_derivation_finance WHERE finance_id=? LIMIT 2`).bind(financeId).all<Row>());
  if(env.DB!==db||!derivationResults([result],1)||result.results.length>1||result.results.some(row=>!derivationExact(row,columns)))fail();
  return (result.results[0] as NativeDerivationFinancialRecord|undefined)??null;
}

/** Original-ledger settlement only, never a provider retry. An immutable usage
 * receipt or permanently proven no-dispatch disposition is mandatory. */
export async function reconcileNativeDerivationFinance(env:WorkerEnv,financeId:string){
  const db=env.DB,f=await readNativeDerivationFinance(env,financeId);if(!f||env.DB!==db)return false;
  const proof=await db.prepare(`SELECT usage.used_tokens,usage.used_microusd,unused.finance_id AS unused
    FROM memory_derivation_finance f LEFT JOIN memory_derivation_usage usage ON usage.finance_id=f.finance_id
    LEFT JOIN memory_derivation_no_dispatch unused ON unused.finance_id=f.finance_id WHERE f.finance_id=?`).bind(financeId).first<Row>();
  if(!proof||proof.unused===null&&(proof.used_tokens===null||proof.used_microusd===null))return false;
  const units=[{table:"budget_reservations",counters:"budget_counters",unit:"tokens",id:f.token_id,maximum:f.maximum_tokens,used:proof.unused?0:proof.used_tokens},
    {table:"cost_budget_reservations",counters:"cost_budget_counters",unit:"microusd",id:f.cost_id,maximum:f.maximum_microusd,used:proof.unused?0:proof.used_microusd}];
  const schema=await memoryDerivationSchema(env);if(!schema.financePresent||env.DB!==db)return false;
  const statements:D1PreparedStatement[]=[derivationAssertion(env,schema.guard),derivationAssertion(env,exact(f)),derivationAssertion(env,{condition:`EXISTS(SELECT 1 FROM memory_derivation_usage WHERE finance_id=? AND used_tokens=? AND used_microusd=?)
    OR EXISTS(SELECT 1 FROM memory_derivation_no_dispatch WHERE finance_id=? AND ?=0 AND ?=0)`,bindings:[financeId,units[0]!.used,units[1]!.used,financeId,units[0]!.used,units[1]!.used]})];
  for(const u of units){
    if(!derivationInteger(u.used,0,2_000_000_000))return false;
    const row=await db.prepare(`SELECT status,used_${u.unit} AS used FROM ${u.table} WHERE reservation_id=? AND owner_id=?`).bind(u.id,f.payer_id).first<Row>();
    if(!row){if(proof.unused){statements.push(derivationAssertion(env,{condition:`NOT EXISTS(SELECT 1 FROM ${u.table} WHERE reservation_id=?)`,bindings:[u.id]}));continue;}return false;}
    const terminal={condition:`EXISTS(SELECT 1 FROM ${u.table} WHERE reservation_id=? AND owner_id=? AND status=? AND used_${u.unit}=? AND settled_at IS NOT NULL)`,bindings:[u.id,f.payer_id,u.used>0?"settled":"released",u.used]};
    if(!["active","executing"].includes(String(row.status))){if(row.used!==u.used||row.status!==(u.used>0?"settled":"released"))return false;statements.push(derivationAssertion(env,terminal));continue;}
    const active=`EXISTS(SELECT 1 FROM ${u.table} WHERE reservation_id=? AND owner_id=? AND status=? AND used_${u.unit}=0)`;
    const activeBindings=[u.id,f.payer_id,row.status];
    statements.push(derivationAssertion(env,{condition:active,bindings:activeBindings}));
    if(f.workspace_id!=="forma")statements.push(derivationAssertion(env,{condition:`EXISTS(SELECT 1 FROM project_budget_reservation_scopes WHERE reservation_kind=? AND reservation_id=? AND organization_id=? AND workspace_scope_id=? AND project_access_id=? AND actor_user_id=?)`,bindings:[u.unit==="tokens"?"tokens":"usd",u.id,f.workspace_id,f.workspace_id,f.project_access_id,f.payer_id]}));
    const scopes:[string,string,string][]=[["user",f.payer_id,f.period],["workspace","forma",f.period]];
    if(f.workspace_id!=="forma")scopes.push(["workspace",f.workspace_id,f.period]);
    if(u.unit==="microusd"&&f.pilot_cohort_id){
      statements.push(derivationAssertion(env,{condition:"EXISTS(SELECT 1 FROM pilot_cost_reservation_scopes WHERE reservation_id=? AND cohort_id=? AND organization_id=? AND actor_user_id=?)",bindings:[u.id,f.pilot_cohort_id,f.workspace_id,f.payer_id]}));
      scopes.push(["pilot_org",f.pilot_cohort_id,"pilot:"+f.pilot_cohort_id],["pilot_user",f.payer_id,"pilot:"+f.pilot_cohort_id]);
    }
    for(const [scope,id,period] of scopes){
      statements.push(db.prepare(`UPDATE ${u.counters} SET reserved_${u.unit}=reserved_${u.unit}-?,used_${u.unit}=used_${u.unit}+?,updated_at=?
        WHERE scope=? AND scope_id=? AND period=? AND typeof(reserved_${u.unit})='integer' AND reserved_${u.unit}>=?
        AND typeof(used_${u.unit})='integer' AND used_${u.unit}>=0 AND used_${u.unit}+?<=9007199254740991 AND ${active}`)
        .bind(u.maximum,u.used,clock(),scope,id,period,u.maximum,u.used,...activeBindings),derivationAssertion(env,{condition:"changes()=1",bindings:[]}));
    }
    statements.push(db.prepare(`UPDATE ${u.table} SET used_${u.unit}=?,status=?,settled_at=?,updated_at=?${u.unit==="tokens"?",settlement_reason='memory_verified_usage'":""}
      WHERE reservation_id=? AND owner_id=? AND status=? AND used_${u.unit}=0`).bind(u.used,u.used>0?"settled":"released",clock(),clock(),u.id,f.payer_id,row.status),derivationAssertion(env,{condition:"changes()=1",bindings:[]}),derivationAssertion(env,terminal));
  }
  if(env.DB!==db)return false;
  const results=structuredClone(await db.batch<Record<string,unknown>>(statements));
  if(env.DB!==db||!derivationResults(results,statements.length)||results.some(row=>row.results.length?!derivationVerified(row):!derivationChanged(row,1)))throw Error("memory-finance-settlement-unconfirmed");
  return true;
}

/** Financial recovery may fence an expired claim, never revive its job. A
 * committed dispatch token is permanently ambiguous until usage is verified. */
export async function recoverNativeDerivationNoDispatch(env:WorkerEnv,financeId:string){
  const db=env.DB,f=await readNativeDerivationFinance(env,financeId);
  if(!f||f.dispatch_token!==null||f.dispatched_at!==null||env.DB!==db)return false;
  const existing=await db.prepare('SELECT finance_id FROM memory_derivation_no_dispatch WHERE finance_id=?').bind(financeId).first<Row>();
  if(existing)return reconcileNativeDerivationFinance(env,financeId);
  const schema=await memoryDerivationSchema(env);if(!schema.financePresent||env.DB!==db)return false;
  const recoverable:MemorySqlGuard={condition:`NOT EXISTS(SELECT 1 FROM memory_derivation_job_finance link
    JOIN memory_derivation_jobs job ON job.job_id=link.job_id WHERE link.finance_id=?
    AND job.state='leased' AND job.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND job.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,bindings:[financeId]};
  if(!f.admission_closed_at&&!await db.prepare('SELECT 1 AS allowed WHERE '+recoverable.condition).bind(...recoverable.bindings).first())return false;
  const now=clock(),closed={...f,admission_closed_at:f.admission_closed_at??now};
  const evidence=await memoryDigest(memoryCanonical(['native-memory-no-dispatch-v1',financeId,f.token_id,f.cost_id,closed.admission_closed_at]));
  const statements=[derivationAssertion(env,schema.guard),derivationAssertion(env,exact(f))];
  if(!f.admission_closed_at)statements.push(derivationAssertion(env,recoverable),
    db.prepare('UPDATE memory_derivation_finance SET admission_closed_at=? WHERE finance_id=? AND dispatch_token IS NULL AND admission_closed_at IS NULL').bind(now,financeId),
    derivationAssertion(env,{condition:'changes()=1',bindings:[]}));
  statements.push(derivationAssertion(env,exact(closed)),db.prepare(`INSERT INTO memory_derivation_no_dispatch(finance_id,evidence_sha256,token_was_present,cost_was_present,recorded_at)
    SELECT ?,?,EXISTS(SELECT 1 FROM budget_reservations WHERE reservation_id=?),EXISTS(SELECT 1 FROM cost_budget_reservations WHERE reservation_id=?),?`).bind(financeId,evidence,f.token_id,f.cost_id,now),
    derivationAssertion(env,{condition:'changes()=1',bindings:[]}));
  if(env.DB!==db)return false;
  const results=structuredClone(await db.batch<Record<string,unknown>>(statements));
  if(env.DB!==db||!derivationResults(results,statements.length)||results.some(row=>row.results.length?!derivationVerified(row):!derivationChanged(row,1)))throw Error('memory-finance-recovery-unconfirmed');
  return reconcileNativeDerivationFinance(env,financeId);
}

/** Server transport receipt only. This is not a request-body API: callers must
 * own the opaque dispatch issued before their single provider request. It
 * records actual usage, including zero and overrun, at the ORIGINAL prices. */
export async function recordNativeDerivationUsage(env:WorkerEnv,dispatch:NativeDerivationDispatch,usage:{providerRequestId:string;inputTokens:number;cachedInputTokens:number;outputTokens:number}){
  if(!derivationExact(usage,['providerRequestId','inputTokens','cachedInputTokens','outputTokens'])||!derivationId(usage.providerRequestId)
    ||!derivationInteger(usage.inputTokens,0,1_000_000)||!derivationInteger(usage.cachedInputTokens,0,usage.inputTokens)||!derivationInteger(usage.outputTokens,0,1_000_000))return false;
  const original=nativeDerivationDispatchData(env,dispatch),db=env.DB,f=await readNativeDerivationFinance(env,original.finance_id);
  if(!f||env.DB!==db||f.dispatch_token!==original.dispatch_token||f.request_sha256!==original.request_sha256)return false;
  const numerator=BigInt(usage.inputTokens-usage.cachedInputTokens)*BigInt(f.input_price)+BigInt(usage.cachedInputTokens)*BigInt(f.cached_input_price)+BigInt(usage.outputTokens)*BigInt(f.output_price);
  const microusd=Number((numerator+999999n)/1000000n);
  if(!derivationInteger(microusd,0,2_000_000_000))return false;
  const receipt=await memoryDigest(memoryCanonical(['native-memory-provider-usage-v1',f.finance_id,f.dispatch_token,f.request_sha256,usage]));
  const expected={finance_id:f.finance_id,provider_request_id:usage.providerRequestId,receipt_sha256:receipt,input_tokens:usage.inputTokens,cached_input_tokens:usage.cachedInputTokens,
    output_tokens:usage.outputTokens,used_tokens:usage.inputTokens+usage.outputTokens,used_microusd:microusd};
  const keys=Object.keys(expected) as (keyof typeof expected)[],values=keys.map(key=>expected[key]);
  const previous=await db.prepare('SELECT '+keys.join(',')+' FROM memory_derivation_usage WHERE finance_id=?').bind(f.finance_id).first<Row>();
  if(previous&&keys.some(key=>previous[key]!==expected[key]))return false;
  const schema=await memoryDerivationSchema(env);if(!schema.financePresent||env.DB!==db)return false;
  const statements=[derivationAssertion(env,schema.guard),derivationAssertion(env,exact(f))];
  if(!previous)statements.push(db.prepare(`INSERT INTO memory_derivation_usage(${keys.join(',')},recorded_at) VALUES(${values.map(()=>'?').join(',')},?)`).bind(...values,clock()),derivationAssertion(env,{condition:'changes()=1',bindings:[]}));
  statements.push(derivationAssertion(env,{condition:`EXISTS(SELECT 1 FROM memory_derivation_usage WHERE ${keys.map(key=>key+' IS ?').join(' AND ')})`,bindings:values}));
  const results=structuredClone(await db.batch<Record<string,unknown>>(statements));
  if(env.DB!==db||!derivationResults(results,statements.length)||results.some(row=>row.results.length?!derivationVerified(row):!derivationChanged(row,1)))throw Error('memory-finance-usage-unconfirmed');
  return true;
}

/** Last replay immediately before the one transport call. The process-local
 * handle cannot be copied, retried, reconstructed from a row, or used twice. */
export async function consumeNativeDerivationDispatch(env:WorkerEnv,dispatch:NativeDerivationDispatch,requestHash:string){
  const state=dispatched.get(dispatch);
  if(!state||state.transportAttempted||state.record.request_sha256!==requestHash)return false;
  state.transportAttempted=true;
  try{
    const input=sourceCurrent(env,state),f=state.record,proof=nativeDerivationSourceStatements(env,state.capture);
    const budget=claimedProviderBudgetGuard(env,{actorUserId:f.payer_id,streamId:'memory-derivation:'+f.finance_id,correlationId:f.finance_id,period:f.period,
      tokenReservationId:f.token_id,costReservationId:f.cost_id,reservedTokens:f.maximum_tokens,reservedMicrousd:f.maximum_microusd,
      projectScope:input.authority.binding.scope??null,pilotCohortId:f.pilot_cohort_id},f.operation);
    const statements=[...proof,derivationAssertion(env,exact(f)),derivationAssertion(env,{condition:budget.sql,bindings:budget.bindings??[]}),
      derivationAssertion(env,{condition:`EXISTS(SELECT 1 FROM memory_derivation_month_caps cap WHERE cap.payer_id=? AND cap.period=?
        AND cap.cap_microusd>=COALESCE((SELECT SUM(CASE WHEN unused.finance_id IS NOT NULL THEN 0 WHEN usage.finance_id IS NOT NULL THEN usage.used_microusd ELSE f.maximum_microusd END)
        FROM memory_derivation_finance f LEFT JOIN memory_derivation_usage usage ON usage.finance_id=f.finance_id
        LEFT JOIN memory_derivation_no_dispatch unused ON unused.finance_id=f.finance_id WHERE f.payer_id=cap.payer_id AND f.period=cap.period),0))`,bindings:[f.payer_id,f.period]})];
    const receipt=structuredClone(await state.db.batch<Record<string,unknown>>(statements));sourceCurrent(env,state);
    return derivationResults(receipt,statements.length)&&receipt.slice(0,proof.length).every(validSourceReceipt)&&receipt.slice(proof.length).every(derivationVerified);
  }catch{return false;}
}

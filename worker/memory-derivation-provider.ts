import { parseMemoryFieldResult,type ParsedMemoryFieldDerivation } from './memory-field-result.ts';
import { parseMemoryProfileResult,type ParsedMemoryProfileDerivation } from './memory-profile-result.ts';
import { parseMemoryBehavioralResult, type ParsedMemoryBehavioralDerivation } from './memory-behavioral-result.ts';
import { nativeDerivationRequestBody, nativeDerivationRequestFits } from './memory-derivation-request.ts';
import type { WorkerEnv } from './runtime.ts';
import { memoryDigest } from '../src/model/scoped-memory.ts';
import { derivationId, derivationInteger } from './memory-derivation-policy.ts';
import { nativeDerivationLeaseInputs, type NativeDerivationLease } from './memory-derivation-admission.ts';
import { nativeDerivationSourceInputs, nativeDerivationSourceForEvidence, type NativeDerivationSourceCapture } from './memory-derivation-sources.ts';
import { reserveNativeDerivationFinance, claimNativeDerivationDispatch, consumeNativeDerivationDispatch, nativeDerivationDispatchData,
  recordNativeDerivationUsage, reconcileNativeDerivationFinance, nativeDerivationDispatchSource } from './memory-derivation-finance.ts';
import { memoryDerivationJsonUniqueKeys, parseMemoryDerivationResult, type ParsedMemoryDerivation } from './memory-derivation-result.ts';
import { captureNativeDerivationManifest, nativeDerivationManifestForCapture, nativeDerivationManifestInputs,
  nativeDerivationManifestStatements, type NativeDerivationManifest } from './memory-derivation-manifest.ts';
import { derivationAssertion } from './memory-derivation-store.ts';

const encoder=new TextEncoder();
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
/** Native handles only; no browser model, prompt, endpoint or reservation DTO. */
function request(env:WorkerEnv,lease:NativeDerivationLease,capture:NativeDerivationSourceCapture){
  const input=nativeDerivationLeaseInputs(env,lease),source=nativeDerivationSourceForEvidence(env,capture,lease),terms=input.qualification.terms;
  if(source.jobId!==input.job.job_id||source.purpose!==terms.purpose||!source.originals.length&&!source.behavioralSources?.length||terms.recipeVersion==='memory-field-suggestions-v1'&&!source.fieldTargets?.length)return null;
  const body=nativeDerivationRequestBody(terms,source.originals,source.behavioralSources??source.observations,source.fieldTargets);
  if(!nativeDerivationRequestFits(terms,body))return null;
  return {body,model:terms.model,source,recipeVersion:terms.recipeVersion};
}
async function readEnvelope(response:Response,signal:AbortSignal){
  if(!response.ok||!response.body)throw Error('memory-provider-unconfirmed');
  const length=response.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>1048576))throw Error('memory-provider-unconfirmed');
  const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let bytes=0,text='';
  const aborted=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',aborted,{once:true});
  try{
    if(signal.aborted)throw Error('memory-provider-unconfirmed');
    for(;;){const chunk=await reader.read();if(signal.aborted)throw Error('memory-provider-unconfirmed');if(chunk.done)break;
      bytes+=chunk.value.byteLength;if(bytes>1048576)throw Error('memory-provider-unconfirmed');text+=decoder.decode(chunk.value,{stream:true});}
    text+=decoder.decode();const value:unknown=JSON.parse(text);
    if(!memoryDerivationJsonUniqueKeys(text)||!object(value))throw Error('memory-provider-unconfirmed');return value;
  }finally{signal.removeEventListener('abort',aborted);void reader.cancel().catch(()=>{});reader.releaseLock();}
}
function verifiedUsage(value:Record<string,unknown>,model:string){
  const usage=value.usage;
  if(value.object!=='response'||value.model!==model||value.service_tier!=='default'||!derivationId(value.id)||!object(usage)
    ||!derivationInteger(usage.input_tokens,0,1000000)||!derivationInteger(usage.output_tokens,0,1000000)
    ||usage.total_tokens!==usage.input_tokens+usage.output_tokens||!object(usage.input_tokens_details)
    ||!derivationInteger(usage.input_tokens_details.cached_tokens,0,usage.input_tokens))return null;
  return {providerRequestId:value.id,inputTokens:usage.input_tokens,cachedInputTokens:usage.input_tokens_details.cached_tokens,outputTokens:usage.output_tokens};
}
function output(value:Record<string,unknown>){
  if(value.status!=='completed'||value.error!==null||value.incomplete_details!==null||!Array.isArray(value.output)||value.output.length>16)return null;
  const messages=value.output.filter(item=>object(item)&&item.type==='message');
  if(messages.length!==1||value.output.some(item=>!object(item)||!['message','reasoning'].includes(String(item.type))))return null;
  const message=messages[0];if(!object(message)||message.role!=='assistant'||message.status!=='completed'||!Array.isArray(message.content)||message.content.length!==1)return null;
  const content=message.content[0];return object(content)&&content.type==='output_text'&&typeof content.text==='string'&&encoder.encode(content.text).byteLength<=65536?content.text:null;
}
declare const candidateReceiptBrand: unique symbol;
export type NativeDerivationCandidateReceipt = Readonly<{ [candidateReceiptBrand]: true }>;
type Candidate = ParsedMemoryDerivation | ParsedMemoryBehavioralDerivation | ParsedMemoryProfileDerivation | ParsedMemoryFieldDerivation;
type CandidateReceipt = { env: WorkerEnv; db: WorkerEnv['DB']; capture: NativeDerivationSourceCapture; manifest: NativeDerivationManifest;
  financeId: string; raw: string; outputSha256: string; candidate: Candidate };
const candidates = new WeakMap<NativeDerivationCandidateReceipt, CandidateReceipt>();
export type NativeDerivationProviderResult={status:'unavailable'|'capacity'|'uncertain'|'charged-invalid';financeId?:string}|{
  status:'candidate';financeId:string;candidate:Candidate;receipt:NativeDerivationCandidateReceipt};

function candidateReceipt(env: WorkerEnv, receipt: NativeDerivationCandidateReceipt) {
  const state = candidates.get(receipt);
  if (!state || state.env !== env || state.db !== env.DB) throw Error('memory-candidate-unavailable');
  nativeDerivationManifestForCapture(env, state.manifest, state.capture);
  if (state.candidate.validUntil <= new Date().toISOString()) throw Error('memory-candidate-expired');
  return state;
}

/** Publication preparation, NOT a persisted result. The opaque provider receipt
 * prevents parser output, read proofs or copied browser data from standing in
 * for a source-bound, accounted-for response. The access TTL remains short;
 * expiresAt is the independent original retention ceiling for future storage. */
export function nativeDerivationCandidateInputs(env: WorkerEnv, receipt: NativeDerivationCandidateReceipt) {
  const state = candidateReceipt(env, receipt), manifest = nativeDerivationManifestInputs(env, state.manifest);
  return { financeId: state.financeId, raw: state.raw, outputSha256: state.outputSha256,
    candidate: structuredClone(state.candidate), manifest: manifest.serialized, manifestSha256: manifest.sha256,
    expiresAt: manifest.manifest.expiresAt };
}

/** Include in the SAME atomic batch as any eventual result write. A separate
 * successful read is not publication permission. No retry or spending grant. */
export function nativeDerivationCandidateStatements(env: WorkerEnv, receipt: NativeDerivationCandidateReceipt) {
  const state = candidateReceipt(env, receipt), manifest = nativeDerivationManifestInputs(env, state.manifest).manifest;
  return [...nativeDerivationManifestStatements(env, state.manifest), derivationAssertion(env, {
    condition: `EXISTS(SELECT 1 FROM memory_derivation_job_finance link
      JOIN memory_derivation_finance f ON f.finance_id=link.finance_id
      JOIN memory_derivation_usage u ON u.finance_id=f.finance_id
      JOIN budget_reservations tokens ON tokens.reservation_id=f.token_id
      JOIN cost_budget_reservations cost ON cost.reservation_id=f.cost_id
      WHERE link.job_id=? AND f.finance_id=? AND f.admission_closed_at IS NULL AND f.dispatch_token IS NOT NULL
        AND f.operation=? AND f.terms_sha256=? AND f.payer_id=?
        AND tokens.owner_id=f.payer_id AND cost.owner_id=f.payer_id
        AND tokens.status=CASE WHEN u.used_tokens>0 THEN 'settled' ELSE 'released' END
        AND cost.status=CASE WHEN u.used_microusd>0 THEN 'settled' ELSE 'released' END
        AND tokens.settled_at IS NOT NULL AND cost.settled_at IS NOT NULL
        AND tokens.used_tokens=u.used_tokens AND cost.used_microusd=u.used_microusd)`,
    bindings: [manifest.jobId, state.financeId, 'memory-derivation:' + manifest.purpose, manifest.binding.termsSha256, manifest.binding.actorUserId],
  })];
}

/** A single bounded Responses POST, never a retry or enrollment route. Storing
 * model output remains a separate atomic source/dependency publication step.
 * store:false disables response storage, not all provider retention. */
export async function executeNativeDerivationProvider(env:WorkerEnv,lease:NativeDerivationLease,capture:NativeDerivationSourceCapture):Promise<NativeDerivationProviderResult>{
  let financeId:string|undefined;
  try{
    if(typeof env.OPENAI_API_KEY!=='string'||!env.OPENAI_API_KEY.trim())return {status:'unavailable'};
    const prepared=request(env,lease,capture);if(!prepared)return {status:'capacity'};
    const manifest=await captureNativeDerivationManifest(env,capture);if(!manifest)return {status:'unavailable'};
    const hash=await memoryDigest(prepared.body),hold=await reserveNativeDerivationFinance(env,lease,capture,hash);if(!hold)return {status:'unavailable'};
    const dispatch=await claimNativeDerivationDispatch(env,hold);if(!dispatch)return {status:'uncertain'};
    financeId=nativeDerivationDispatchData(env,dispatch).finance_id;
    if(!await consumeNativeDerivationDispatch(env,dispatch,hash))return {status:'uncertain',financeId};
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    let envelope:Record<string,unknown>;
    try{
      const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('memory-provider-unconfirmed'));},30000);});
      envelope=await Promise.race([fetch('https://api.openai.com/v1/responses',{method:'POST',redirect:'error',signal:controller.signal,
        headers:{authorization:'Bearer '+env.OPENAI_API_KEY,'content-type':'application/json'},body:prepared.body}).then(response=>readEnvelope(response,controller.signal)),timeout]);
    }finally{if(timer!==undefined)clearTimeout(timer);controller.abort();}
    const usage=verifiedUsage(envelope,prepared.model);if(!usage)return {status:'uncertain',financeId};
    if(!await recordNativeDerivationUsage(env,dispatch,usage)||!await reconcileNativeDerivationFinance(env,financeId))return {status:'uncertain',financeId};
    const raw=output(envelope);if(raw===null)return {status:'charged-invalid',financeId};
    const f=nativeDerivationDispatchData(env,dispatch);
    if(usage.inputTokens>f.maximum_input||usage.outputTokens>f.maximum_output)return {status:'charged-invalid',financeId};
    // Recheck consent and complete originals after the response. Accounting
    // above intentionally succeeds even when this source check now fails.
    let fresh:NativeDerivationSourceCapture;try{fresh=await nativeDerivationDispatchSource(env,dispatch);}catch{return {status:'charged-invalid',financeId};}
    const source=nativeDerivationSourceInputs(env,fresh);
    const context={purpose:source.purpose,scopeKey:source.scopeKey,manifestId:source.jobId,manifestRevision:1,
      checkedAt:source.checkedAt,validUntil:source.validUntil,sources:source.originals,priorItems:[],suppressedLineages:[]};
    const candidate=prepared.recipeVersion==='memory-field-suggestions-v1'?await parseMemoryFieldResult(raw,context,source.fieldTargets??[]):prepared.recipeVersion==='memory-profile-consolidation-v1'?await parseMemoryProfileResult(raw,context):source.behavioralSources?await parseMemoryBehavioralResult(raw,{...context,observations:source.behavioralSources}):await parseMemoryDerivationResult(raw,context);
    if (!candidate) return {status:'charged-invalid',financeId};
    nativeDerivationManifestForCapture(env, manifest, fresh);
    const outputSha256 = await memoryDigest(raw);
    nativeDerivationManifestForCapture(env, manifest, fresh);
    const receipt = Object.freeze({}) as NativeDerivationCandidateReceipt;
    candidates.set(receipt, { env, db: env.DB, capture: fresh, manifest, financeId, raw, outputSha256, candidate });
    return {status:'candidate',financeId,candidate,receipt};
  }catch{return {status:'uncertain',...(financeId?{financeId}:{})};}
}

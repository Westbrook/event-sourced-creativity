import { buildCreativeDirectionRequest } from '../../../worker/openai-adapter.ts';
import { OPENAI_IMAGE_DIRECTION_SCHEMA } from '../../../worker/openai-image-route-contract.ts';
import { memoryDerivationJsonUniqueKeys } from '../../../worker/memory-derivation-result.ts';
import { hash, seal, verifySeal, canonical, freeze } from '../core.mjs';

export const LIMITS=freeze({sourceBytes:1048576,requestBytes:32000,responseBytes:1048576,privateBytes:3145728,privateWrites:3,retentionDays:30,deadlineMs:120000,outputTokens:1200,originalReads:2});
export const INVENTORY=freeze({plannerPosts:1,moderation:0,image:0,checker:0,evaluator:0,retry:0,repair:0,providerRetrieval:0,sourceWrites:1,requestWrites:1,responseWrites:1,artifactWrites:0,originalReads:2,cleanupAttempts:1,finance:'durable intent, headers, raw receipt hash and allowlisted usage; append-only reconciliation; retained financial identity is separately inventoried',humanReview:'source fidelity required; time unpriced'});
export const fail=code=>{throw Error(code);};
export const integer=n=>Number.isSafeInteger(n)&&n>=0;
export const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$/.test(value);
export function parseExact(text,limit){
  if(typeof text!=='string'||!text.isWellFormed()||Buffer.byteLength(text)>limit||!memoryDerivationJsonUniqueKeys(text))fail('preparation_invalid_bytes');
  return JSON.parse(text);
}
/** Inputs here must come from trusted private custody; a seal is integrity, never authorization. */
export function capturePreparation({source,config,payerId,runtimeHash,locale='en',outputTargetInstructions=null}){
  const snapshot=parseExact(source.bytes,LIMITS.sourceBytes);
  if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot))fail('preparation_source_shape');
  for(const k of ['ref','version','producer','authorityVersion','documentId','producerEvidenceRef'])if(!identifier(source[k]))fail('preparation_source_provenance');
  if(source.complete!==true||source.scope!=='personal-administrator'||!Number.isFinite(Date.parse(source.expiresAt))||!Number.isFinite(Date.parse(source.frozenAt))||Date.parse(source.frozenAt)>=Date.parse(source.expiresAt))fail('preparation_source_scope');
  for(const k of ['model','accountId','region','resolutionVersion','resolutionEvidenceRef','credentialBinding'])if(!identifier(config[k]))fail('preparation_config_unresolved');
  if(config.endpoint!=='https://api.openai.com/v1/responses'||config.serviceTier!=='standard'||config.projectHeader!==null&&!identifier(config.projectHeader)||!['configured OPENAI_MODEL','application-default'].includes(config.modelBasis)||!Number.isFinite(Date.parse(config.expiresAt)))fail('preparation_config_unsupported');
  // A selected alias is retained as an alias; no made-up snapshot or account override.
  if(!identifier(payerId)||!/^[a-f0-9]{64}$/.test(runtimeHash))fail('preparation_identity_missing');
  const body=buildCreativeDirectionRequest(snapshot,config.model,`forma_${hash(payerId).slice(0,32)}`,locale,outputTargetInstructions??undefined).requestBody;
  if(Buffer.byteLength(body)>LIMITS.requestBytes)fail('preparation_request_bound');
  const {bytes,...provenance}=source;
  return seal('preparation',{version:'h4-preparation-v1',payerId,runtimeHash,source:{...provenance,sha256:hash(bytes),byteLength:Buffer.byteLength(bytes)},config:structuredClone(config),locale,outputTargetInstructions,request:{endpoint:config.endpoint,method:'POST',body,sha256:hash(body),byteLength:Buffer.byteLength(body)},limits:LIMITS,inventory:INVENTORY});
}
export function validatePreparation(plan,sourceBytes,now=Date.now()){
  verifySeal('preparation',plan);
  const rebuilt=capturePreparation({source:{...plan.source,bytes:sourceBytes},config:plan.config,payerId:plan.payerId,runtimeHash:plan.runtimeHash,locale:plan.locale,outputTargetInstructions:plan.outputTargetInstructions});
  if(canonical(rebuilt)!==canonical(plan))fail('preparation_source_request_mismatch');
  if([plan.source.expiresAt,plan.config.expiresAt].some(x=>Date.parse(x)<=now))fail('preparation_expired');
  return plan;
}
export const operationId=plan=>`h4-${hash({payer:plan.payerId,source:plan.source,request:plan.request.sha256,config:plan.config,runtime:plan.runtimeHash})}`;
export const financialScope=plan=>({operationId:operationId(plan),planId:plan.id,kind:'preparation',sourceHash:plan.source.sha256,directionHash:hash('preparation:no-direction-produced'),requestHash:plan.request.sha256,runtimeHash:plan.runtimeHash,inventoryHash:hash({inventory:plan.inventory,limits:plan.limits}),payerId:plan.payerId,accountId:plan.config.accountId,region:plan.config.region});
export function validateDirection(raw){
  const v=parseExact(raw,LIMITS.responseBytes),schema=OPENAI_IMAGE_DIRECTION_SCHEMA;
  if(!v||Array.isArray(v)||Object.keys(v).sort().join(',')!==[...schema.required].sort().join(','))fail('preparation_direction_shape');
  for(const [key,rule] of Object.entries(schema.properties)){
    if(rule.type==='string'){if(typeof v[key]!=='string'||!v[key].trim())fail('preparation_direction_shape');}
    else if(!Array.isArray(v[key])||v[key].length<rule.minItems||v[key].length>rule.maxItems||v[key].some(x=>typeof x!=='string'||!x.trim()))fail('preparation_direction_shape');
  }
  return v;
}
export function usageReceipt(body){
  const u=body?.usage;if(!u||![u.input_tokens,u.output_tokens,u.total_tokens].every(integer)||u.input_tokens+u.output_tokens!==u.total_tokens)return null;
  return {input_tokens:u.input_tokens,output_tokens:u.output_tokens,total_tokens:u.total_tokens};
}
export function inspectResponse(body,plan,httpStatus){
  if(httpStatus<200||httpStatus>=300||body?.error)return {outcome:'unknown'};
  if(body.status!=='completed'||body.incomplete_details)return {outcome:'incomplete'};
  if(!identifier(body.id)||!identifier(body.model))return {outcome:'invalid'};
  // Returned model evidence is preserved; alias-to-snapshot equivalence is not invented.
  if(body.model!==plan.config.model)return {outcome:'model_unqualified'};
  if(!Array.isArray(body.output)||!body.output.length)return {outcome:'invalid'};
  const parts=[];
  for(const item of body.output){
    if(item.type==='reasoning'){if(item.content?.length)return {outcome:'invalid'};continue;}
    if(item.type!=='message'||item.role!=='assistant'||item.status!=='completed'||!Array.isArray(item.content))return {outcome:'invalid'};
    for(const c of item.content){if(c.type==='refusal')return {outcome:'refused'};if(c.type!=='output_text'||typeof c.text!=='string')return {outcome:'invalid'};parts.push(c.text);}
  }
  if(parts.length!==1||body.output_text!==undefined&&body.output_text!==parts[0])return {outcome:'invalid'};
  try{validateDirection(parts[0]);}catch{return {outcome:'invalid'};}
  const usage=usageReceipt(body);
  if(!usage||usage.output_tokens>LIMITS.outputTokens)return {outcome:'usage_missing_or_exceeded'};
  return {outcome:'usable',directionSha256:hash(parts[0])};
}
/** Conditional arithmetic only after exact configuration and rate evidence are resolved. No token counting API. */
export function conditionalEstimate(plan,rates,now=Date.now()){
  if(!plan)return {available:false,actualRequestEstimateMicrousd:null,maximumExposureMicrousd:null,reason:'exact_source_request_configuration_unavailable'};
  verifySeal('preparation',plan);
  if([plan.source.expiresAt,plan.config.expiresAt].some(x=>!Number.isFinite(Date.parse(x))||Date.parse(x)<=now))fail('preparation_expired');
  if(!rates||rates.model!==plan.config.model||rates.accountId!==plan.config.accountId||rates.region!==plan.config.region||rates.serviceTier!=='standard'||Date.parse(rates.expiresAt)<=now||!Number.isFinite(Date.parse(rates.expiresAt))||![rates.input,rates.output,rates.cacheWrite,rates.regionalMultiplier].every(n=>Number.isFinite(n)&&n>0)||!rates.evidenceRef)fail('preparation_rates_unqualified');
  const inputUnits=plan.request.byteLength+4096;
  // Cover a possible cache-write rate, without pretending measured tokenization or a provider cap.
  return {available:true,requestBytes:plan.request.byteLength,inputUnitsAssumption:inputUnits,outputTokenAllowance:LIMITS.outputTokens,actualRequestEstimateMicrousd:Math.ceil((Math.max(rates.input,rates.cacheWrite)*inputUnits+rates.output*LIMITS.outputTokens)*rates.regionalMultiplier),maximumExposureMicrousd:null,measuredChargeMicrousd:null,infrastructureEstimateMicrousd:null,assumptions:['UTF-8 byte proxy plus 4096 framing; unqualified consumption bound','All input at greater of uncached/cache-write rates; no cache savings','Infrastructure, retention, reconciliation and human review remain separately unpriced']};
}

import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {createMemoryDerivationClient,MemoryDerivationClientError,MEMORY_DERIVATION_CONTROL as version,MEMORY_DERIVATION_POLICY as policyVersion} from '../src/state/memory-derivation-client.ts';
import {DERIVATION_EVIDENCE,derivationCanonical} from '../src/model/memory-derivation-policy.ts';
const hash=value=>createHash('sha256').update(value).digest('hex'),capScope='payer-utc-calendar-month-all-memory-purposes';
function fixture(){
  const expiresAt=new Date(Date.now()+60000).toISOString(),scope={projectId:'project',documentId:'document',custody:{kind:'personal'}};
  const expected={projectId:scope.projectId,documentId:scope.documentId,expectedCustody:scope.custody,enrollmentId:'parent',enrollmentRevision:2};
  const terms={version:'memory-derivation-terms-v1',purpose:'rolling-summary',recipeVersion:'memory-derivation-candidates-v1',provider:'openai',model:'isolated-test-model',pricing:{inputMicroUsdPerMillion:1000000,cachedInputMicroUsdPerMillion:0,outputMicroUsdPerMillion:2000000},maximumInputTokens:1000,maximumOutputTokens:100,monthlyCapMicroUsd:100000,payer:'self-ai-allowance',providerStore:false,providerRetentionDisclosure:'Isolated synthetic qualification only; no real provider retention claim.',retentionPolicyId:'test-retention',evidence:Object.fromEntries(DERIVATION_EVIDENCE.map(key=>[key,hash('synthetic:'+key)]))};
  const offer={qualificationId:'qualified',termsSha256:hash(derivationCanonical(terms)),expiresAt,terms};
  const grant={scope,grantId:'a'.repeat(64),revision:1,consentId:crypto.randomUUID(),purpose:terms.purpose,enrollmentId:'parent',enrollmentRevision:2,qualificationId:offer.qualificationId,termsSha256:offer.termsSha256,monthlyCapMicroUsd:terms.monthlyCapMicroUsd,sourceAfterSequence:9,background:false,retentionDays:1,consentedAt:new Date(Date.now()-1000).toISOString(),expiresAt,revokedAt:null};
  const settings={version,enabled:true,available:true,reason:null,policyVersion,scope,enrollmentId:'parent',enrollmentRevision:2,grants:[grant],qualifications:[offer],capScope,sourceWindow:'future-originals',processingImplemented:false};
  const input={version,policyVersion,purpose:terms.purpose,qualificationId:offer.qualificationId,termsSha256:offer.termsSha256,...expected,revision:0,expectedConsentId:null,monthlyCapMicroUsd:terms.monthlyCapMicroUsd,background:false,retentionDays:1,expiresAt,sourceWindow:'future-originals',chargeMyAiAllowance:true,confirmation:'ENABLE_DERIVED_MEMORY'};
  return {expected,settings,grant,offer,input};
}
test('purpose client is explicit, same-origin, immutable and data-only',async()=>{
  const f=fixture(),calls=[],client=createMemoryDerivationClient(async(url,init)=>{calls.push({url,init});return Response.json(f.settings);});
  assert.equal(calls.length,0);const result=await client.settings(f.expected);assert.equal(calls.length,1);assert.equal(result.processingImplemented,false);
  assert.ok(Object.isFrozen(result.qualifications[0].terms.pricing));assert.equal(calls[0].init.credentials,'same-origin');assert.equal(calls[0].init.cache,'no-store');assert.equal(calls[0].init.redirect,'error');
});
for(const fault of ['scope','custody','parent','extra','hash','terms-extra','offer-expired','duplicate-offer','duplicate-grant','duplicate-active','wrong-cap-scope','old-consent-id'])test('purpose client rejects '+fault,async()=>{
  const f=fixture();if(fault==='scope')f.settings.scope.documentId='other';if(fault==='custody')f.settings.scope.custody={kind:'organization',organizationId:'org',ownerUserId:'owner',projectAccessId:'access'};
  if(fault==='parent')f.settings.enrollmentRevision++;if(fault==='extra')f.settings.rawText='untrusted';if(fault==='hash')f.offer.termsSha256='b'.repeat(64);if(fault==='terms-extra')f.offer.terms.hidden=true;
  if(fault==='offer-expired')f.offer.expiresAt=new Date(Date.now()-1).toISOString();if(fault==='duplicate-offer')f.settings.qualifications.push(f.offer);if(fault==='duplicate-grant')f.settings.grants.push(f.grant);
  if(fault==='duplicate-active')f.settings.grants.push({...f.grant,revision:2,consentId:crypto.randomUUID()});if(fault==='wrong-cap-scope')f.settings.capScope='per-grant';if(fault==='old-consent-id')f.grant.consentId='bad';
  await assert.rejects(createMemoryDerivationClient(async()=>Response.json(f.settings)).settings(f.expected),error=>error instanceof MemoryDerivationClientError&&!error.mutationUnknown);
});
test('purpose client checks exact acknowledged consent and revoke identity without requiring active terms',async()=>{
  const f=fixture(),calls=[],responses=[{version,grant:f.grant,capScope,processingImplemented:false},{version,revoked:true,grantId:f.grant.grantId,revision:1,consentId:f.grant.consentId,reEnrollmentRequired:true}];
  const client=createMemoryDerivationClient(async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});return Response.json(responses.shift());});
  const saved=await client.enable(f.input);assert.equal(saved.consentId,f.grant.consentId);await client.revoke({...saved,expiresAt:new Date(Date.now()-100).toISOString()});
  assert.deepEqual(calls[0].body,f.input);assert.deepEqual(calls[1].body,{version,revision:1,consentId:f.grant.consentId,confirmation:'REVOKE_DERIVED_MEMORY'});
});
for(const fault of ['lost','500','malformed','wrong-consent','wrong-purpose','wrong-cap','wrong-expiry'])test('purpose client treats dispatched '+fault+' as unknown, not success',async()=>{
  const f=fixture(),result={version,grant:{...f.grant},capScope,processingImplemented:false};
  if(fault==='wrong-consent'){f.input.revision=1;f.input.expectedConsentId=f.grant.consentId;result.grant.revision=2;}
  if(fault==='wrong-purpose')result.grant.purpose='profile';if(fault==='wrong-cap')result.grant.monthlyCapMicroUsd++;if(fault==='wrong-expiry')result.grant.expiresAt=new Date(Date.now()+50000).toISOString();
  const client=createMemoryDerivationClient(async()=>{if(fault==='lost')throw new Error('private error');return fault==='500'?Response.json({error:'private'}, {status:500}):fault==='malformed'?Response.json({}):Response.json(result);});
  await assert.rejects(client.enable(f.input),error=>error instanceof MemoryDerivationClientError&&error.mutationUnknown&&!error.message.includes('private'));
});
test('purpose client snapshots before await and rejects stale settings',async()=>{
  const f=fixture(),resolvers=[],client=createMemoryDerivationClient(()=>new Promise(resolve=>resolvers.push(resolve)));
  const old=client.settings(f.expected),latest=client.settings(f.expected);f.expected.documentId='mutated';
  resolvers[1](Response.json(f.settings));await latest;resolvers[0](Response.json(f.settings));await assert.rejects(old,MemoryDerivationClientError);
});
test('purpose client pre-abort never dispatches; in-flight mutation abort is unknown',async()=>{
  const f=fixture(),controller=new AbortController();let calls=0;controller.abort();const client=createMemoryDerivationClient(()=>{calls++;return new Promise(()=>{});});
  await assert.rejects(client.enable(f.input,controller.signal),error=>!error.mutationUnknown);assert.equal(calls,0);
  const active=new AbortController(),pending=client.enable(f.input,active.signal);active.abort();await assert.rejects(pending,error=>error.mutationUnknown);assert.equal(calls,1);
});
for(const fault of ['wrong-type','overflow','invalid-utf8'])test('purpose client cancels '+fault+' response without waiting for cancellation',async()=>{
  const f=fixture();let cancelled=0;const body=new ReadableStream({start(controller){controller.enqueue(fault==='invalid-utf8'?new Uint8Array([0xc0,0xaf]):new TextEncoder().encode('x'.repeat(fault==='overflow'?524289:1)));},cancel(){cancelled++;return new Promise(()=>{});}});
  const client=createMemoryDerivationClient(async()=>new Response(body,{headers:{'content-type':fault==='wrong-type'?'text/plain':'application/json'}}));
  await assert.rejects(client.settings(f.expected),MemoryDerivationClientError);assert.equal(cancelled,1);
});
test('purpose client rejects accessors without reading them and closed-schema response has no implicit offers',async()=>{
  const f=fixture();let called=0;const value={...f.expected};Object.defineProperty(value,'documentId',{enumerable:true,get(){called++;return 'document';}});
  const client=createMemoryDerivationClient(async()=>Response.json({version,enabled:false,available:false,reason:'schema-unavailable',grants:[],qualifications:[]}));
  await assert.rejects(client.settings(value));assert.equal(called,0);assert.deepEqual(await client.settings(f.expected),{enabled:false,available:false,processingImplemented:false,grants:[],qualifications:[]});
});
for(const action of ['expiry','abort'])test('purpose client '+action+' during qualification hashing cannot return current terms',async()=>{
  const f=fixture(),original=crypto.subtle.digest,controller=new AbortController();let start,finish;
  const began=new Promise(resolve=>{start=resolve;}),blocked=new Promise(resolve=>{finish=resolve;});
  crypto.subtle.digest=async(...args)=>{start();await blocked;return original.apply(crypto.subtle,args);};
  try{
    if(action==='expiry')f.offer.expiresAt=new Date(Date.now()+50).toISOString();
    const pending=createMemoryDerivationClient(async()=>Response.json(f.settings)).settings(f.expected,controller.signal);await began;
    if(action==='abort'){controller.abort();await assert.rejects(pending,MemoryDerivationClientError);finish();}
    else{await new Promise(resolve=>setTimeout(resolve,70));finish();await assert.rejects(pending,MemoryDerivationClientError);}
  }finally{finish();crypto.subtle.digest=original;}
});
test('purpose client late response after ignored abort is cancelled and stale mutation success is unknown',async()=>{
  const f=fixture(),controller=new AbortController();let resolve,cancelled=0;
  const client=createMemoryDerivationClient(()=>new Promise(done=>{resolve=done;}));const pending=client.enable(f.input,controller.signal);controller.abort();
  await assert.rejects(pending,error=>error.mutationUnknown);resolve(new Response(new ReadableStream({cancel(){cancelled++;}}),{headers:{'content-type':'application/json'}}));
  await new Promise(done=>setImmediate(done));assert.equal(cancelled,1);
  const waits=[],overlapping=createMemoryDerivationClient(()=>new Promise(done=>waits.push(done))),old=overlapping.enable(f.input),newer=overlapping.settings(f.expected);
  waits[1](Response.json(f.settings));await newer;waits[0](Response.json({version,grant:f.grant,capScope,processingImplemented:false}));await assert.rejects(old,error=>error.mutationUnknown);
});
for(const fault of ['none','negative','remaining','expired','extra','retention'])test('purpose client financial view validates '+fault,async()=>{
  const f=fixture(),at=new Date().toISOString();f.settings.financial={period:at.slice(0,7),checkedAt:at,capMicroUsd:10000,usedMicroUsd:500,reservedMicroUsd:1200,remainingMicroUsd:8300,retention:'independent-of-memory-erasure'};
  if(fault==='negative')f.settings.financial.reservedMicroUsd=-1;
  if(fault==='remaining')f.settings.financial.remainingMicroUsd++;
  if(fault==='expired')f.settings.financial.checkedAt=new Date(Date.now()-61000).toISOString();
  if(fault==='extra')f.settings.financial.payer='other';if(fault==='retention')f.settings.financial.retention='deleted-with-memory';
  const result=createMemoryDerivationClient(async()=>Response.json(f.settings)).settings(f.expected);
  if(fault==='none'){assert.deepEqual((await result).financial,f.settings.financial);assert.ok(Object.isFrozen((await result).financial));}
  else await assert.rejects(result,MemoryDerivationClientError);
});

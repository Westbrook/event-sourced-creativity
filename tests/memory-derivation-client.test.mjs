import {memoryPrivacyMutationActive} from '../src/state/memory-privacy-mutation.ts';
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
  const active=new AbortController(),pending=client.enable(f.input,active.signal);assert.equal(memoryPrivacyMutationActive(),true);active.abort();await assert.rejects(pending,error=>error.mutationUnknown);assert.equal(calls,1);assert.equal(memoryPrivacyMutationActive(),false);
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

for(const fault of ['none','missing-producer','swapped-producers','false-aggregate','future-completion','unknown-producer','extra'])test('purpose client verifies independent producer progress '+fault,async()=>{
  const f=fixture(),progress={purpose:'rolling-summary',pending:1,completed:2,retained:2,uncertain:0,registeredThrough:12,completedThrough:9,
    producers:[{producer:'creator',registeredThrough:40,completedThrough:30},{producer:'chat-studio',registeredThrough:12,completedThrough:9}]};
  if(fault==='missing-producer')progress.producers.pop();if(fault==='swapped-producers')progress.producers.reverse();
  if(fault==='false-aggregate')progress.completedThrough=30;if(fault==='future-completion')progress.producers[1].completedThrough=13;
  if(fault==='unknown-producer')progress.producers[1].producer='untrusted';if(fault==='extra')progress.producers[0].text='not metadata';
  const body={version,scope:f.settings.scope,enrollmentId:f.expected.enrollmentId,enrollmentRevision:f.expected.enrollmentRevision,results:[],next:null,checkedAt:new Date().toISOString(),progress:[progress]};
  const client=createMemoryDerivationClient(async()=>Response.json(body));
  if(fault==='none'){const page=await client.results(f.expected);assert.equal(page.progress[0].completedThrough,9);assert.ok(Object.isFrozen(page.progress[0].producers[0]));}
  else await assert.rejects(client.results(f.expected),error=>error instanceof MemoryDerivationClientError&&!error.mutationUnknown);
});

// Automatic document presentation uses the real strict clients over finite HTTP
// responses. This does not replace native source/consent qualification.
const {readDocumentMemoryBrief}=await import('../src/state/document-memory-brief.ts');
const {MEMORY_POLICY,MEMORY_TIMING,MEMORY_WRITE_CONTRACT}=await import('../src/state/live-memory-client.ts');
function briefFixture(){
  const f=fixture(),now=new Date().toISOString(),validUntil=new Date(Date.now()+45000).toISOString();
  f.expected.enrollmentId=f.settings.enrollmentId=f.grant.enrollmentId=hash('parent');
  const selection={projectId:'project',documentId:'document',custody:{kind:'personal'}};
  const enrollment={id:hash('parent'),projectId:'project',documentId:'document',organizationId:null,revision:2,learn:true,recall:true,background:false,
    retentionDays:1,timeZone:'UTC',expiresAt:f.grant.expiresAt,policyVersion:MEMORY_POLICY,lastAdmittedAt:null,throughSequence:20,cutoffSequence:null,
    backlog:false,nextDueAt:now,attempts:0,status:'ready'};
  const base={enabled:true,policyVersion:MEMORY_POLICY,writeContractVersion:MEMORY_WRITE_CONTRACT,enrollments:[enrollment],nextAfter:null,
    reviewContract:{timing:MEMORY_TIMING,preferredLocalWindow:{startHour:1,endHour:5},freshDaytimeCatchUpAllowed:true,savedPagesMayContinueOutsideWindow:true,strictlyOvernight:false,deliverySlaVerified:false}};
  const lineage=hash('original-lineage'),jobId=hash('brief-job'),entry={jobId,purpose:'rolling-summary',scopeKey:'native-scope',expiresAt:f.grant.expiresAt};
  const item={operation:'assert',target:null,category:'goal',text:'Tentative goal',supports:[{sourceIndex:0,start:0,end:8,text:'Original'}],counterevidence:[],
    claimKey:'derived:'+hash('claim'),lineageIds:[lineage],sourceBindings:[{sourceId:'original',revision:1,contentHash:hash('Original')}],validUntil,citationStatus:'support-cited'};
  const result={version,jobId,expiresAt:entry.expiresAt,candidate:{version:'memory-derivation-candidates-v1',purpose:entry.purpose,scopeKey:entry.scopeKey,
    manifestId:jobId,manifestRevision:1,validUntil,semanticAuthority:'model-derived-unverified',semanticCompleteness:false,independentEvidence:false,items:[item]},controlRevisions:{[lineage]:0},
    history:{windowCount:3,originalPairs:3,boundary:'bounded',afterSequence:5,throughSequence:20}};
  const listing={version,scope:f.grant.scope,enrollmentId:hash('parent'),enrollmentRevision:2,results:[entry],next:null,checkedAt:now,progress:[],purpose:'rolling-summary',latest:true};
  const controls={version,available:true,controls:[],next:null,scope:f.grant.scope,enrollmentId:hash('parent'),enrollmentRevision:2,validUntil};
  const calls=[],controller=new AbortController();let active=true;
  const transport=async(input,init)=>{const url=new URL(String(input),'https://fixture.invalid');calls.push({url,init});
    assert.equal(init.method,'GET');assert.equal(init.cache,'no-store');assert.equal(init.credentials,'same-origin');
    const payload=url.pathname==='/api/memory/settings'?base:url.pathname.endsWith('/derivation/settings')?f.settings
      :url.pathname.endsWith('/recall-scopes')?{version:'memory-scope-recall-v1',sources:[],validUntil:new Date(Date.now()+25000).toISOString(),complete:true}:url.pathname.endsWith('/results')?listing:url.pathname.endsWith('/result')?result:url.pathname.endsWith('/controls')?controls:null;
    assert.ok(payload,url.pathname);return Response.json(payload);};
  return {...f,selection,base,enrollment,lineage,entry,item,result,listing,controls,calls,controller,transport,
    current:()=>active,deactivate:()=>{active=false;}};
}
test('automatic document brief uses current native reads without mutations and preserves evidence/history',async()=>{
  const f=briefFixture(),lease=await readDocumentMemoryBrief(f.selection,f.transport,f.current,f.controller.signal);
  assert.equal(f.calls.length,6);const value=lease.current();assert.equal(value.completeHistory,false);assert.equal(value.independentEvidence,false);
  assert.equal(value.sections[0].items[0].supports[0].text,'Original');assert.equal(value.sections[0].history.windowCount,3);
  value.sections[0].items[0].text='tampered';assert.equal(lease.current().sections[0].items[0].text,'Tentative goal');
  lease.retire();assert.equal(lease.current(),null);
});
for(const fault of ['disabled','no-enrollment','learn-off','recall-off','purpose-disabled','no-purpose','grant-revoked'])test('automatic brief does not read private bodies: '+fault,async()=>{
  const f=briefFixture();if(fault==='disabled')f.base.enabled=false;if(fault==='no-enrollment')f.base.enrollments=[];
  if(fault==='learn-off')f.enrollment.learn=false;if(fault==='recall-off')f.enrollment.recall=false;
  if(fault==='purpose-disabled'){f.settings.available=false;f.settings.qualifications=[];}if(fault==='no-purpose')f.settings.grants=[];if(fault==='grant-revoked')f.grant.revokedAt=new Date().toISOString();
  assert.equal(await readDocumentMemoryBrief(f.selection,f.transport,f.current,f.controller.signal),null);
  assert.ok(f.calls.every(call=>call.url.pathname.endsWith('/settings')||call.url.pathname==='/api/memory/recall-scopes'));
});
for(const action of ['corrected','suppressed','released'])test('automatic brief respects explicit '+action+' lineage controls',async()=>{
  const f=briefFixture();f.controls.controls=[{controlId:hash('control'),claimKey:f.item.claimKey,lineageId:f.lineage,revision:1,action,
    correctionText:action==='corrected'?'My explicit correction':null,expiresAt:f.grant.expiresAt,purpose:'rolling-summary',textAvailable:true}];
  const lease=await readDocumentMemoryBrief(f.selection,f.transport,f.current,f.controller.signal),section=lease.current().sections[0];
  assert.equal(section.items.length,action==='released'?1:0);assert.equal(section.corrections.length,action==='corrected'?1:0);lease.retire();
});
for(const fault of ['controls-incomplete','result-expiry','wrong-manifest','long-lease','no-quotes','quote-length','duplicate-quote','status-conflict','bad-source','duplicate-lineage','parent-revision','foreign-scope'])test('automatic brief rejects '+fault,async()=>{
  const f=briefFixture();
  if(fault==='controls-incomplete')f.controls.next=hash('more');if(fault==='result-expiry')f.result.candidate.validUntil=new Date(Date.now()-1).toISOString();
  if(fault==='wrong-manifest')f.result.candidate.manifestId=hash('foreign');if(fault==='long-lease')f.result.candidate.validUntil=new Date(Date.now()+120000).toISOString();
  if(fault==='no-quotes')f.item.supports=[];if(fault==='quote-length')f.item.supports[0].end=9;
  if(fault==='duplicate-quote')f.item.supports.push({...f.item.supports[0]});if(fault==='status-conflict')f.item.citationStatus='conflicting-citations';
  if(fault==='bad-source')f.item.sourceBindings[0].contentHash='bad';if(fault==='duplicate-lineage')f.item.lineageIds.push(f.lineage);
  if(fault==='parent-revision')f.listing.enrollmentRevision++;if(fault==='foreign-scope')f.result.candidate.scopeKey='foreign';
  await assert.rejects(readDocumentMemoryBrief(f.selection,f.transport,f.current,f.controller.signal));
});
for(const boundary of ['abort','owner','clock-backward','expiry'])test('automatic brief clears at '+boundary,async t=>{
  const f=briefFixture(),lease=await readDocumentMemoryBrief(f.selection,f.transport,f.current,f.controller.signal);
  if(boundary==='abort')f.controller.abort();if(boundary==='owner')f.deactivate();
  if(boundary==='clock-backward'){const now=Date.now();t.mock.method(Date,'now',()=>now-1000);}
  if(boundary==='expiry'){const now=Date.now();t.mock.method(Date,'now',()=>now+60001);}
  assert.equal(lease.current(),null);assert.equal(lease.current(),null);
});
test('automatic brief checks current owner before dispatch and after asynchronous native reads',async()=>{
  const f=briefFixture();f.deactivate();await assert.rejects(readDocumentMemoryBrief(f.selection,f.transport,f.current,f.controller.signal));assert.equal(f.calls.length,0);
  const g=briefFixture();await assert.rejects(readDocumentMemoryBrief(g.selection,async(...args)=>{const result=await g.transport(...args);g.deactivate();return result;},g.current,g.controller.signal));assert.equal(g.calls.length,1);
});
test('automatic brief does not fall back to an older result after newest-source withdrawal',async()=>{
  const f=briefFixture();f.listing.results.push({...f.entry,jobId:hash('older')});
  await assert.rejects(readDocumentMemoryBrief(f.selection,async(input,init)=>String(input).includes('/result?')?Response.json({error:'withdrawn'},{status:404}):f.transport(input,init),f.current,f.controller.signal));
  assert.equal(f.calls.filter(call=>call.url.pathname.endsWith('/results')).length,1);
});
test('automatic brief keeps three purpose facets separate and counterevidence visible',async()=>{
  const f=briefFixture();f.settings.grants=['rolling-summary','profile','suggestion'].map(purpose=>({...f.grant,purpose,grantId:hash(purpose),consentId:crypto.randomUUID()}));
  let currentPurpose;
  const transport=async(input,init)=>{const url=new URL(String(input),'https://fixture.invalid');
    assert.equal(new Headers(init.headers).get('x-forma-memory-consumer'),'document-brief-v1');
    if(url.pathname.endsWith('/results')){currentPurpose=url.searchParams.get('purpose');const listing={...f.listing,purpose:currentPurpose,results:[{...f.entry,purpose:currentPurpose,jobId:hash(currentPurpose)}]};if(!url.searchParams.has('latest'))delete listing.latest;return Response.json(listing);}
    if(url.pathname.endsWith('/result'))return Response.json({...f.result,jobId:hash(currentPurpose),candidate:{...f.result.candidate,purpose:currentPurpose,manifestId:hash(currentPurpose),items:[{...f.item,
      counterevidence:[{sourceIndex:1,start:0,end:7,text:'Opposed'}],citationStatus:'conflicting-citations'}]}});
    return f.transport(input,init);};
  const lease=await readDocumentMemoryBrief(f.selection,transport,f.current,f.controller.signal);
  assert.deepEqual(lease.current().sections.map(section=>section.purpose),['rolling-summary','profile','suggestion']);
  assert.ok(lease.current().sections.every(section=>section.items[0].citationStatus==='conflicting-citations'));lease.retire();
});
test('automatic brief does not fetch private correction text when scope read is unavailable',async()=>{
  const f=briefFixture();f.controls.controls=[{controlId:hash('control'),claimKey:f.item.claimKey,lineageId:f.lineage,revision:1,action:'corrected',
    correctionText:null,expiresAt:f.grant.expiresAt,purpose:'rolling-summary',textAvailable:false}];
  const lease=await readDocumentMemoryBrief(f.selection,f.transport,f.current,f.controller.signal);
  assert.equal(lease.current().sections[0].items.length,0);assert.equal(lease.current().sections[0].corrections.length,0);lease.retire();
});

function behavioralViewFixture(){
  const f=briefFixture();f.result.candidate.version='memory-derivation-candidates-v2';Object.assign(f.item,{category:'proposal',supports:[],counterevidence:[],observationSupports:[0],observationCounterevidence:[],
    observationCitations:[{observationIndex:0,action:'inspect',recordedAt:new Date(Date.now()-1000).toISOString(),role:'support'}]});return f;
}
test('behavioral client keeps native action evidence separate and retires it with the brief lease',async()=>{
  const f=behavioralViewFixture(),lease=await readDocumentMemoryBrief(f.selection,f.transport,f.current,f.controller.signal);assert.ok(lease);
  const item=lease.current().sections[0].items[0];assert.deepEqual(item.supports,[]);assert.equal(item.observationCitations[0].action,'inspect');
  item.observationCitations[0].action='invented';assert.equal(lease.current().sections[0].items[0].observationCitations[0].action,'inspect');lease.retire();assert.equal(lease.current(),null);
});
for(const fault of ['v1-with-actions','missing-actions','missing-citations','duplicate-index','invented-action','future-time','wrong-role','wrong-index','invented-preference','no-support','mismatched-conflict','unknown-field'])test('behavioral client rejects '+fault,async()=>{
  const f=behavioralViewFixture();
  if(fault==='v1-with-actions')f.result.candidate.version='memory-derivation-candidates-v1';if(fault==='missing-actions')delete f.item.observationSupports;
  if(fault==='missing-citations')f.item.observationCitations=[];if(fault==='duplicate-index')f.item.observationCounterevidence=[0];
  if(fault==='invented-action')f.item.observationCitations[0].action='attention';if(fault==='future-time')f.item.observationCitations[0].recordedAt=new Date(Date.now()+60000).toISOString();
  if(fault==='wrong-role')f.item.observationCitations[0].role='counterevidence';if(fault==='wrong-index')f.item.observationCitations[0].observationIndex=2;
  if(fault==='invented-preference')f.item.category='preference-hypothesis';if(fault==='no-support'){f.item.observationSupports=[];f.item.observationCitations=[];}
  if(fault==='mismatched-conflict')f.item.citationStatus='conflicting-citations';if(fault==='unknown-field')f.item.observationCitations[0].quote='Invented human words';
  await assert.rejects(()=>createMemoryDerivationClient(async()=>Response.json(f.result)).inspectResult(f.entry));
});
test('behavioral consent offer requires an exact recipe hash and distinguishes its source window',async()=>{
  const f=fixture();f.offer.terms.recipeVersion='memory-derivation-candidates-v2';f.offer.termsSha256=hash(derivationCanonical(f.offer.terms));f.settings.sourceWindow='qualified-recipe';
  const result=await createMemoryDerivationClient(async()=>Response.json(f.settings)).settings(f.expected);assert.equal(result.qualifications[0].terms.recipeVersion,'memory-derivation-candidates-v2');
  f.settings.sourceWindow='future-originals';await assert.rejects(()=>createMemoryDerivationClient(async()=>Response.json(f.settings)).settings(f.expected));
});

for(const behavioral of [false,true])test('result export fresh read preserves separate evidence '+behavioral,async()=>{
  const f=behavioral?behavioralViewFixture():briefFixture(),calls=[];
  const client=createMemoryDerivationClient(async(url,init)=>{calls.push({url,init});return Response.json(f.result);});
  const snapshot=await client.exportResult(f.entry),body=JSON.parse(snapshot.json);
  assert.equal(calls.length,1);assert.equal(calls[0].init.method,'GET');assert.equal(calls[0].init.cache,'no-store');
  assert.equal(body.format,'forma-memory-result-export-v1');assert.equal(body.result.items[0].text,f.item.text);
  assert.deepEqual(body.result.items[0].originalQuotes.supports,f.item.supports);
  assert.deepEqual(body.result.items[0].observedActions,behavioral?f.item.observationCitations:[]);
  assert.equal(snapshot.validUntil,f.result.candidate.validUntil);assert.ok(Object.isFrozen(snapshot));
  assert.equal(body.includes.controlHistory,false);assert.equal(body.includes.allMemory,false);
});
test('result export refuses arbitrary display objects, pre-abort and malformed response',async()=>{
  const f=briefFixture();let calls=0;const client=createMemoryDerivationClient(async()=>{calls++;return Response.json({...f.result,privatePayload:'must not export'});});
  await assert.rejects(client.exportResult({...f.entry,items:[]}));assert.equal(calls,0);
  const controller=new AbortController();controller.abort();await assert.rejects(client.exportResult(f.entry,controller.signal));assert.equal(calls,0);
  await assert.rejects(client.exportResult(f.entry));assert.equal(calls,1);
});

function relatedBriefFixture(){
 const f=briefFixture(),until=new Date(Date.now()+20000).toISOString(),source={enrollmentId:hash('related'),projectId:'other-project',documentId:'other-document',zoom:'project-tree',distance:2,weight:.5/3};
 const {version:_version,controlRevisions:_controls,...presentation}=structuredClone(f.result);
 presentation.candidate.scopeKey='other-native-scope';presentation.candidate.items[0].text='Other document tentative context';
 const catalog={version:'memory-scope-recall-v1',sources:[source],validUntil:until,complete:true};
 const recalled={version:'memory-scope-recall-v1',source,presentation,validUntil:until,independentEvidence:false,completeHistory:false,presentationOnly:true};
 const recalls=[];const transport=async(input,init)=>{const url=new URL(String(input),'https://fixture.invalid');
  if(url.pathname==='/api/memory/recall-scopes'){recalls.push({url,init});return Response.json(url.searchParams.has('source')?recalled:catalog);}
  return f.transport(input,init);
 };
 return {...f,source,catalog,recalled,transport,recalls};
}
test('automatic brief appends nearest consented scope separately and never receives control authority',async()=>{
 const f=relatedBriefFixture(),lease=await readDocumentMemoryBrief(f.selection,f.transport,f.current,f.controller.signal),view=lease.current();
 assert.equal(view.sections.length,2);assert.equal(view.sections[0].items[0].text,'Tentative goal');assert.equal(view.sections[1].items[0].text,'Other document tentative context');
 assert.deepEqual(view.sections[1].source,f.source);assert.deepEqual(view.sections[1].corrections,[]);assert.ok(!Object.hasOwn(view.sections[1],'controlRevisions'));
 assert.ok(view.validUntil<=f.recalled.validUntil);assert.equal(f.recalls.length,4);assert.ok(f.recalls.every(c=>c.init.method==='GET'));
 assert.equal(f.recalls[1].url.searchParams.get('source'),f.source.enrollmentId);lease.retire();assert.equal(lease.current(),null);
});
for(const fault of ['schema','unavailable-source','incomplete-catalog','bad-rank'])test('automatic brief retains local notes without an older-source fallback on '+fault,async()=>{
 const f=relatedBriefFixture();f.catalog.sources.push({...f.source,enrollmentId:hash('other-older'),projectId:'far-project',documentId:'far-document',zoom:'project-tree',distance:3,weight:.125});
 if(fault==='incomplete-catalog')f.catalog.complete=false;if(fault==='bad-rank')f.catalog.sources.reverse();
 const transport=async(input,init)=>{const url=new URL(String(input),'https://fixture.invalid');
  if(url.pathname==='/api/memory/recall-scopes'&&(fault==='schema'||fault==='unavailable-source'&&url.searchParams.has('source')))return Response.json({error:'unavailable'},{status:503});
  return f.transport(input,init);
 };
 const lease=await readDocumentMemoryBrief(f.selection,transport,f.current,f.controller.signal);assert.equal(lease.current().sections.length,1);assert.equal(lease.current().sections[0].items[0].text,'Tentative goal');
 assert.ok(f.recalls.every(c=>!c.url.searchParams.has('source')||c.url.searchParams.get('source')===f.source.enrollmentId));
});
test('automatic cross-scope reply arriving after target ownership changes is discarded',async()=>{
 const f=relatedBriefFixture(),transport=async(input,init)=>{const result=await f.transport(input,init);
  if(new URL(String(input),'https://fixture.invalid').searchParams.has('source'))f.deactivate();return result;};
 await assert.rejects(readDocumentMemoryBrief(f.selection,transport,f.current,f.controller.signal));
});

test('nearest-source brief needs recall enrollment but no target processing grant',async()=>{
 const f=relatedBriefFixture();f.settings.grants=[];
 const lease=await readDocumentMemoryBrief(f.selection,f.transport,f.current,f.controller.signal);
 assert.equal(lease.current().sections.length,1);assert.deepEqual(lease.current().sections[0].source,f.source);
 assert.ok(f.calls.every(call=>call.url.pathname.endsWith('/settings')));assert.equal(f.recalls.length,4);lease.retire();
});

test('latest-only inventory must be explicitly acknowledged and cannot contain history',async()=>{
 for(const fault of ['unacknowledged','multiple','cursor']){
  const f=briefFixture();if(fault==='unacknowledged')delete f.listing.latest;
  if(fault==='multiple')f.listing.results.push({...f.entry,jobId:hash('older')});if(fault==='cursor')f.listing.next=f.entry.jobId;
  await assert.rejects(readDocumentMemoryBrief(f.selection,f.transport,f.current,f.controller.signal));
 }
});

const {reconcileMemoryProfile}=await import('../src/state/memory-profile-reconciliation.ts');
function profileView(job,text='One tentative interpretation',lineage='lineage'){
 return {jobId:job,purpose:'profile',scopeKey:'exact-private-scope',expiresAt:new Date(Date.now()+60000).toISOString(),validUntil:new Date(Date.now()+30000).toISOString(),controlRevisions:{},items:[{
  claimKey:'claim',category:'workflow-hypothesis',text,lineageIds:[lineage],citationStatus:'support-cited',supports:[{sourceIndex:0,start:0,end:8,text:'Original'}],counterevidence:[]} ]};
}
test('retained profile collapses exact repeats without laundering them into independent evidence',()=>{
 const input=[profileView('new'),profileView('old')],result=reconcileMemoryProfile(input);
 assert.equal(result.items.length,1);assert.equal(result.items[0].profileOrigin.jobId,'new');assert.equal(result.items[0].profileOrigin.repeatedIn,2);
 assert.equal(result.items[0].profileOrigin.state,'latest');assert.equal(result.complete,false);assert.equal(result.results,2);
 result.items[0].supports[0].text='changed';assert.equal(input[0].items[0].supports[0].text,'Original');
});
test('retained profile keeps changed interpretations and earlier-only facets historical, with overlapping support disclosed',()=>{
 const result=reconcileMemoryProfile([profileView('new','New interpretation'),profileView('old','Prior interpretation'),profileView('oldest','Earlier-only facet','other')]);
 assert.deepEqual(result.items.map(row=>row.profileOrigin.state),['latest','historical','historical']);
 assert.deepEqual(result.items.map(row=>row.profileOrigin.sharedEvidence),[true,true,false]);assert.equal(result.items[1].text,'Prior interpretation');
});
for(const invalid of [[],[profileView('duplicate'),profileView('duplicate')],Array.from({length:17},(_,i)=>profileView(String(i))),[profileView('a'),{...profileView('b'),scopeKey:'foreign'}],[{...profileView('a'),purpose:'suggestion'}]])
 test('retained profile rejects an incoherent or oversized collection '+JSON.stringify(invalid.map(row=>row.jobId)),()=>assert.throws(()=>reconcileMemoryProfile(invalid)));
function profileBriefFixture(){
 const f=briefFixture();f.grant.purpose='profile';f.entry.purpose='profile';f.listing.purpose='profile';f.result.candidate.purpose='profile';f.item.category='preference-hypothesis';
 const oldJob=hash('old-profile'),oldEntry={...f.entry,jobId:oldJob},oldResult={...structuredClone(f.result),jobId:oldJob};
 oldResult.candidate.manifestId=oldJob;oldResult.candidate.items[0].text='An earlier interpretation';
 const history={...f.listing,results:[f.entry,oldEntry]};delete history.latest;
 const transport=async(input,init)=>{const url=new URL(String(input),'https://fixture.invalid');
  if(url.pathname.endsWith('/results')&&!url.searchParams.has('latest'))return Response.json(history);
  if(url.pathname.endsWith('/result')&&url.searchParams.get('jobId')===oldJob)return Response.json(oldResult);
  return f.transport(input,init);};
 return {...f,oldEntry,oldResult,history,transport};
}
test('automatic profile reconciles freshly read historical facets and binds each to its actual result',async()=>{
 const f=profileBriefFixture(),lease=await readDocumentMemoryBrief(f.selection,f.transport,f.current,f.controller.signal),section=lease.current().sections[0];
 assert.equal(section.jobId,null);assert.equal(section.retainedProfile.results,2);
 assert.deepEqual(section.items.map(row=>row.profileOrigin.jobId),[f.entry.jobId,f.oldEntry.jobId]);
 assert.equal(section.items[1].profileOrigin.state,'historical');assert.ok(section.items.every(row=>row.profileOrigin.sharedEvidence));lease.retire();
});
for(const fault of ['newest-changed','older-withdrawn','older-expired','late-ownership','suppressed'])test('automatic profile respects '+fault,async()=>{
 const f=profileBriefFixture();if(fault==='newest-changed')f.history.results.reverse();
 if(fault==='older-expired')f.oldResult.candidate.validUntil=new Date(Date.now()-1000).toISOString();
 if(fault==='suppressed')f.controls.controls=[{controlId:hash('control'),claimKey:f.item.claimKey,lineageId:f.lineage,revision:1,action:'suppressed',correctionText:null,expiresAt:f.grant.expiresAt,purpose:'profile',textAvailable:true}];
 const transport=async(input,init)=>{const url=new URL(String(input),'https://fixture.invalid');
  if(url.pathname.endsWith('/result')&&url.searchParams.get('jobId')===f.oldEntry.jobId){if(fault==='older-withdrawn')return Response.json({error:'withdrawn'},{status:404});if(fault==='late-ownership')f.deactivate();}
  return f.transport(input,init);};
 const promise=readDocumentMemoryBrief(f.selection,transport,f.current,f.controller.signal);
 if(fault==='suppressed'){const lease=await promise;assert.equal(lease.current().sections[0].items.length,0);lease.retire();}else await assert.rejects(promise);
});

function resourceFixture(){
  const f=briefFixture();f.selection.view='editor';f.selection.blockId='block';
  f.result.candidate.version='memory-derivation-candidates-v2';
  f.item.category='proposal';f.item.observationSupports=[0];f.item.observationCounterevidence=[];
  f.item.observationCitations=[{observationIndex:0,action:'inspect',recordedAt:new Date(Date.now()-1000).toISOString(),role:'support'}];
  f.result.resourceEvidence={version:'memory-evidence-resources-v1',complete:false,claims:[{claimKey:f.item.claimKey,citations:[
    {source:'original',index:0,resource:{zoom:'document',scopeKey:f.entry.scopeKey}},
    {source:'observation',index:0,resource:{zoom:'block',blockId:'block',revision:9,scopeKey:'native-block-scope'}}]}]};
  return f;
}
test('resource evidence is explicitly negotiated, source-index bound, read-only and deeply immutable',async()=>{
  const f=resourceFixture(),client=createMemoryDerivationClient(f.transport),view=await client.inspectResultResources(f.entry);
  assert.equal(f.calls[0].url.searchParams.get('resources'),'1');assert.deepEqual(view.items[0].resourceCitations,f.result.resourceEvidence.claims[0].citations);
  assert.ok(Object.isFrozen(view.items[0].resourceCitations[1].resource));assert.equal(view.items[0].observationCitations[0].action,'inspect');
  await assert.rejects(createMemoryDerivationClient(f.transport).inspectResult(f.entry),MemoryDerivationClientError,'Legacy parser must not silently accept a changed protocol');
  delete f.result.resourceEvidence;await assert.rejects(createMemoryDerivationClient(f.transport).inspectResultResources(f.entry),MemoryDerivationClientError);
});
for(const fault of ['version','complete','extra','missing-claim','foreign-claim','missing-citation','reordered','invented-index','original-block','foreign-document','unknown-page','invalid-revision','extra-resource','duplicate-citation'])test('resource evidence rejects '+fault,async()=>{
  const f=resourceFixture(),e=f.result.resourceEvidence,c=e.claims[0],row=c.citations[1];
  if(fault==='version')e.version='later';if(fault==='complete')e.complete=true;if(fault==='extra')e.authority=true;
  if(fault==='missing-claim')e.claims=[];if(fault==='foreign-claim')c.claimKey='different';if(fault==='missing-citation')c.citations.pop();
  if(fault==='reordered')c.citations.reverse();if(fault==='invented-index')row.index=127;if(fault==='original-block')c.citations[0].resource=row.resource;
  if(fault==='foreign-document')row.resource={zoom:'document',scopeKey:'another-document'};
  if(fault==='unknown-page')row.resource={zoom:'page',scopeKey:'page',view:'library'};if(fault==='invalid-revision')row.resource.revision=0;
  if(fault==='extra-resource')row.resource.draft='not allowed';if(fault==='duplicate-citation')c.citations.push(row);
  await assert.rejects(createMemoryDerivationClient(f.transport).inspectResultResources(f.entry),MemoryDerivationClientError);
});
test('current block then page evidence orders a brief without dropping counterevidence or claiming broader applicability',async()=>{
  const f=resourceFixture(),base=f.result.resourceEvidence.claims[0];
  f.result.candidate.items=['document','page','block'].map((zoom,index)=>({...structuredClone(f.item),claimKey:'claim-'+index,text:'Note '+zoom}));
  f.result.resourceEvidence.claims=f.result.candidate.items.map((item,index)=>({claimKey:item.claimKey,citations:[base.citations[0],{source:'observation',index:0,resource:index===0?{zoom:'document',scopeKey:f.entry.scopeKey}:index===1?{zoom:'page',scopeKey:'page-editor',view:'editor'}:base.citations[1].resource}]}));
  const lease=await readDocumentMemoryBrief(f.selection,f.transport,f.current,f.controller.signal);assert.ok(lease);
  assert.deepEqual(lease.current().sections[0].items.map(row=>row.text),['Note block','Note page','Note document']);
  assert.ok(lease.current().sections[0].items.every(row=>row.supports[0].text==='Original'&&row.observationCitations[0].role==='support'));
  f.controller.abort();assert.equal(lease.current(),null);
});

for(const failNear of [false,true])test('automatic brief retains distinct project/tree/partition facets without same-band fallbacks '+failNear,async()=>{
 const f=relatedBriefFixture(),project={enrollmentId:hash('project-near'),projectId:'project',documentId:'project-note',zoom:'project',distance:0,weight:.7},
  farther={...f.source,enrollmentId:hash('tree-farther'),documentId:'tree-farther',distance:3,weight:.125},
  world={enrollmentId:hash('world-note'),projectId:'separate-project',documentId:'world-document',zoom:'partition',distance:0,weight:.01};
 f.catalog.sources=[project,f.source,farther,world];const calls=[];
 const transport=async(input,init)=>{const url=new URL(String(input),'https://fixture.invalid'),id=url.searchParams.get('source');
  if(url.pathname==='/api/memory/recall-scopes'&&id){
   calls.push(id);assert.notEqual(id,farther.enrollmentId);assert.equal(init.method,'GET');
   if(failNear&&id===project.enrollmentId)return Response.json({error:'withdrawn'},{status:404});
   const selected=f.catalog.sources.find(row=>row.enrollmentId===id),body=structuredClone(f.recalled);body.source=selected;
   body.presentation.candidate.purpose=url.searchParams.get('purpose');
   if(body.presentation.candidate.purpose==='profile')body.presentation.candidate.items[0].category='preference-hypothesis';
   body.presentation.candidate.items[0].text='Private '+selected.zoom+' '+body.presentation.candidate.purpose;
   return Response.json(body);
  }return f.transport(input,init);
 };
 const lease=await readDocumentMemoryBrief(f.selection,transport,f.current,f.controller.signal);assert.ok(lease);
 const view=lease.current();assert.equal(calls.length,9);assert.equal(view.sections[0].source,undefined);
 assert.deepEqual(view.sections.slice(1).map(row=>row.source.zoom),[...(failNear?[]:Array(3).fill('project')),...Array(3).fill('project-tree'),...Array(3).fill('partition')]);
 assert.ok(view.sections.slice(1).every(row=>row.jobId&&row.corrections.length===0));assert.ok(view.validUntil<=f.catalog.validUntil);
 lease.retire();assert.equal(lease.current(),null);
});

const {MEMORY_DERIVATION_HEALTH,parseMemoryDerivationHealth}=await import('../src/model/memory-derivation-health.ts');
function healthFixture(){
 const at=new Date(Date.now()-1000).toISOString();
 return {version:MEMORY_DERIVATION_HEALTH,ready:1,deferred:2,leased:3,recovery:0,expired:4,oldestPendingAt:at,lastCompletedAt:at,lastRetainedAt:at,
  completionLatencySeconds:{samples:2,total:9,maximum:7}};
}
for(const fault of ['none','unsolicited','missing-version','wrong-version','missing-health','extra','negative','overflow','wrong-total','future','missing-time','noncanonical-time','latency-samples','latency-total','latency-maximum','latency-extra'])test('purpose client processing diagnostics '+fault,async()=>{
 const f=fixture(),checkedAt=new Date().toISOString(),health=healthFixture(),p={purpose:'rolling-summary',pending:10,completed:2,retained:1,uncertain:1,registeredThrough:20,completedThrough:10,health};
 const body={version,scope:f.settings.scope,enrollmentId:f.expected.enrollmentId,enrollmentRevision:f.expected.enrollmentRevision,results:[],next:null,checkedAt,progress:[p],diagnostics:MEMORY_DERIVATION_HEALTH};
 if(fault==='missing-version')delete body.diagnostics;if(fault==='wrong-version')body.diagnostics='future-health';if(fault==='missing-health')delete p.health;
 if(fault==='extra')health.text='private content';if(fault==='negative')health.ready=-1;if(fault==='overflow')health.ready=Number.MAX_SAFE_INTEGER+1;
 if(fault==='wrong-total')health.ready++;if(fault==='future')health.lastCompletedAt=new Date(Date.now()+10000).toISOString();
 if(fault==='missing-time')health.oldestPendingAt=null;if(fault==='noncanonical-time')health.lastRetainedAt='2026-02-30T00:00:00.000Z';
 if(fault==='latency-samples')health.completionLatencySeconds.samples=3;if(fault==='latency-total')health.completionLatencySeconds.total=3;
 if(fault==='latency-maximum')health.completionLatencySeconds.maximum=4;if(fault==='latency-extra')health.completionLatencySeconds.provider='secret';
 let path;const client=createMemoryDerivationClient(async url=>{path=url;return Response.json(body);});
 const result=client.results(f.expected,null,undefined,null,false,fault!=='unsolicited');
 if(fault==='none'){const page=await result;assert.deepEqual(page.progress[0].health,health);assert.ok(Object.isFrozen(page.progress[0].health.completionLatencySeconds));assert.ok(path.endsWith('&diagnostics=1'));}
 else await assert.rejects(result,error=>error instanceof MemoryDerivationClientError&&!error.mutationUnknown);
});
test('processing diagnostics reject getters and distinguish empty from unknown',()=>{
 const at=new Date().toISOString(),counts={pending:10,completed:2,retained:1};let invoked=false;const health=healthFixture();
 Object.defineProperty(health,'ready',{enumerable:true,get(){invoked=true;return 1;}});assert.throws(()=>parseMemoryDerivationHealth(health,counts,at));assert.equal(invoked,false);
 const empty={version:MEMORY_DERIVATION_HEALTH,ready:0,deferred:0,leased:0,recovery:0,expired:0,oldestPendingAt:null,lastCompletedAt:null,lastRetainedAt:null,completionLatencySeconds:{samples:0,total:0,maximum:0}};
 assert.deepEqual(parseMemoryDerivationHealth(empty,{pending:0,completed:0,retained:0},at),empty);
 for(const key of ['oldestPendingAt','lastCompletedAt','lastRetainedAt'])assert.throws(()=>parseMemoryDerivationHealth({...empty,[key]:at},{pending:0,completed:0,retained:0},at));
 assert.throws(()=>parseMemoryDerivationHealth(undefined,{pending:0,completed:0,retained:0},at));
});


test('retained profile identifies revised claims without guessing contradictions or merging evidence',()=>{
 const latest=profileView('latest','Current interpretation','support-new');
 const older=profileView('older','Earlier interpretation','support-old');
 const unrelated=profileView('unrelated','Current interpretation','support-third');unrelated.items[0].claimKey='another-claim';
 older.items[0].citationStatus='conflicting-citations';older.items[0].counterevidence=[{sourceIndex:1,start:0,end:5,text:'Other'}];
 const result=reconcileMemoryProfile([latest,older,unrelated]);
 assert.deepEqual(result.items.map(item=>item.profileOrigin.interpretation),['current','revised','earlier-only']);
 assert.deepEqual(result.items.map(item=>item.profileOrigin.newerInterpretationJobId),[null,'latest',null]);
 assert.deepEqual(result.items.map(item=>item.profileOrigin.counterevidence),[false,true,false]);
 assert.equal(result.items[1].supports[0].text,'Original');assert.equal(result.items[1].counterevidence[0].text,'Other');
 assert.ok(result.items.every(item=>item.profileOrigin.sharedEvidence===false));
});
test('retained profile accepts sixteen distinct source-backed windows, not a four-result history',()=>{
 const result=reconcileMemoryProfile(Array.from({length:16},(_,i)=>profileView(String(i),'Interpretation '+i,'lineage-'+i)));
 assert.equal(result.results,16);assert.equal(result.items.length,16);assert.equal(result.complete,false);
 assert.ok(result.items.slice(1).every(item=>item.profileOrigin.newerInterpretationJobId==='0'));
});
function extendedProfileFixture(){
 const f=profileBriefFixture(),entries=[f.entry,...Array.from({length:39},(_,i)=>({...f.entry,jobId:hash('profile-history-'+i)}))];
 const pages=[];let reads=0;
 const transport=async(input,init)=>{
  const url=new URL(String(input),'https://fixture.invalid');
  if(url.pathname.endsWith('/results')&&!url.searchParams.has('latest')){
   const after=url.searchParams.get('after'),offset=after?entries.findIndex(entry=>entry.jobId===after)+1:0;
   pages.push(after);const results=entries.slice(offset,offset+8);
   return Response.json({...f.history,results,next:offset+8<entries.length?results.at(-1).jobId:null});
  }
  if(url.pathname.endsWith('/result')){
   const jobId=url.searchParams.get('jobId'),index=entries.findIndex(entry=>entry.jobId===jobId);
   if(index>=0){reads++;const body=structuredClone(f.result);body.jobId=jobId;body.candidate.manifestId=jobId;body.candidate.items[0].text='Interpretation '+index;return Response.json(body);}
  }
  return f.transport(input,init);
 };
 return {...f,entries,pages,transport,reads:()=>reads};
}
test('automatic profile reads two native pages with a hard sixteen-result bound',async()=>{
 const f=extendedProfileFixture(),lease=await readDocumentMemoryBrief(f.selection,f.transport,f.current,f.controller.signal);
 const section=lease.current().sections[0];assert.equal(section.retainedProfile.results,16);
 assert.deepEqual(f.pages,[null,f.entries[7].jobId]);assert.equal(f.reads(),16);
 assert.equal(section.items.length,16);assert.ok(section.items.every(item=>f.entries.slice(0,16).some(entry=>entry.jobId===item.profileOrigin.jobId)));
 lease.retire();assert.equal(lease.current(),null);
});
for(const fault of ['repeated-page','withdrawn-second-page','expired-second-page','cancelled-second-page','changed-scope-second-page'])test('longer profile scan fails closed on '+fault,async()=>{
 const f=extendedProfileFixture();
 const transport=async(input,init)=>{
  const url=new URL(String(input),'https://fixture.invalid');
  if(url.pathname.endsWith('/results')&&url.searchParams.has('after')){
   if(fault==='repeated-page')return Response.json({...f.history,results:f.entries.slice(0,8),next:f.entries[7].jobId});
   if(fault==='withdrawn-second-page')return Response.json({error:'withdrawn'},{status:404});
   if(fault==='cancelled-second-page')f.controller.abort();
   if(fault==='changed-scope-second-page')f.deactivate();
  }
  const response=await f.transport(input,init);
  if(fault==='expired-second-page'&&url.pathname.endsWith('/result')&&url.searchParams.get('jobId')===f.entries[8].jobId){
   const body=await response.json();body.candidate.validUntil=new Date(Date.now()-1).toISOString();return Response.json(body);
  }
  return response;
 };
 await assert.rejects(readDocumentMemoryBrief(f.selection,transport,f.current,f.controller.signal));
});


test('explicit older profile pages preserve the latest result and visit retained results without gaps',async()=>{
 const f=extendedProfileFixture();let next=null,seen=[];
 for(let page=0;page<3;page++){
  const lease=await readDocumentMemoryBrief({...f.selection,profileAfter:next},f.transport,f.current,f.controller.signal);
  const section=lease.current().sections[0];
  assert.equal(section.items[0].profileOrigin.jobId,f.entries[0].jobId);
  assert.equal(section.retainedProfile.historicalPage,page>0);
  assert.ok(section.retainedProfile.results<=16);
  seen.push(...section.items.slice(page===0?0:1).map(item=>item.profileOrigin.jobId));
  next=section.retainedProfile.nextAfter;lease.retire();
 }
 assert.equal(next,null);assert.deepEqual(seen,f.entries.map(entry=>entry.jobId));
 assert.equal(new Set(seen).size,40);assert.equal(f.reads(),42,'The latest source is independently re-read for every page');
});
test('older review never resurrects history after the newest native result is withdrawn',async()=>{
 const f=extendedProfileFixture();f.listing.results=[];
 const lease=await readDocumentMemoryBrief({...f.selection,profileAfter:f.entries[15].jobId},f.transport,f.current,f.controller.signal);
 assert.equal(lease.current().sections[0].items.length,0);assert.equal(f.reads(),0);assert.equal(f.pages.length,0);lease.retire();
});

function consolidatedProfileViewFixture(){
 const f=briefFixture();f.entry.purpose='profile';f.result.candidate.purpose='profile';f.result.candidate.version='memory-profile-consolidation-v1';f.item.category='workflow-hypothesis';
 f.item.reconciles=[{relationship:'revises',claimKey:'derived:'+hash('older-claim'),category:'workflow-hypothesis',supports:[{sourceIndex:1,start:0,end:5,text:'Prior'}]}];
 return f;
}
test('profile client retains bounded quoted relationship hypotheses without erasing earlier visible claims',async()=>{
 const f=consolidatedProfileViewFixture(),client=createMemoryDerivationClient(async()=>Response.json(f.result));
 const view=await client.inspectResult(f.entry);assert.equal(view.items[0].reconciles[0].relationship,'revises');assert.ok(Object.isFrozen(view.items[0].reconciles));
 const older=profileView('older');older.scopeKey=view.scopeKey;older.items[0].claimKey=f.item.reconciles[0].claimKey;
 const merged=reconcileMemoryProfile([view,older]);assert.equal(merged.items.length,2);assert.equal(merged.items[1].text,older.items[0].text);
 assert.deepEqual(merged.items[1].profileOrigin.proposedRelations,[{relationship:'revises',jobId:f.entry.jobId}]);assert.equal(merged.items[1].profileOrigin.interpretation,'earlier-only');
});
for(const fault of ['missing','self-link','duplicate','operation','scope-purpose','extra','bad-quote','too-many'])test('profile client denies malformed relation '+fault,async()=>{
 const f=consolidatedProfileViewFixture();
 if(fault==='missing')delete f.item.reconciles;
 if(fault==='self-link')f.item.reconciles[0].claimKey=f.item.claimKey;
 if(fault==='duplicate')f.item.reconciles.push(structuredClone(f.item.reconciles[0]));
 if(fault==='operation')f.item.reconciles[0].relationship='delete';
 if(fault==='scope-purpose'){f.entry.purpose='suggestion';f.result.candidate.purpose='suggestion';}
 if(fault==='extra')f.item.reconciles[0].approved=true;
 if(fault==='bad-quote')f.item.reconciles[0].supports[0].text='mismatch';
 if(fault==='too-many')f.item.reconciles=Array.from({length:5},()=>f.item.reconciles[0]);
 await assert.rejects(createMemoryDerivationClient(async()=>Response.json(f.result)).inspectResult(f.entry));
});

function fieldViewFixture(){const f=briefFixture();f.entry.purpose=f.result.candidate.purpose='suggestion';f.result.candidate.version='memory-field-suggestions-v1';
 Object.assign(f.item,{category:'proposal',fieldTarget:{blockId:'block',field:'text',revision:2,sequence:17,textHash:hash('Original')},replacement:'Suggested saved field.',locale:'en'});return f;}
test('background field client preserves exact review metadata and export without applying it',async()=>{
 const f=fieldViewFixture(),client=createMemoryDerivationClient(async()=>Response.json(f.result));
 const view=await client.inspectResult(f.entry);assert.deepEqual(view.items[0].fieldTarget,f.item.fieldTarget);assert.equal(view.items[0].replacement,f.item.replacement);assert.ok(Object.isFrozen(view.items[0].fieldTarget));
 const exported=JSON.parse((await client.exportResult(f.entry)).json);assert.equal(exported.result.items[0].fieldProposal.applied,false);assert.equal(exported.result.items[0].fieldProposal.replacement,f.item.replacement);
});
for(const fault of ['wrong-purpose','extra-authority','invalid-hash','duplicate-field','oversize','wrong-locale'])test('background field client rejects '+fault,async()=>{
 const f=fieldViewFixture();if(fault==='wrong-purpose')f.entry.purpose=f.result.candidate.purpose='profile';if(fault==='extra-authority')f.item.fieldTarget.apply=true;
 if(fault==='invalid-hash')f.item.fieldTarget.textHash='invalid';if(fault==='oversize')f.item.replacement='🪴'.repeat(601);if(fault==='wrong-locale')f.item.locale='other';
 if(fault==='duplicate-field')f.result.candidate.items.push({...structuredClone(f.item),claimKey:'derived:'+hash('duplicate-field')});
 await assert.rejects(()=>createMemoryDerivationClient(async()=>Response.json(f.result)).inspectResult(f.entry));
});


for(const stalled of ['headers','body'])test('automatic brief bounds stalled '+stalled+' and cancels late private bytes',async t=>{
 const f=briefFixture();let release,observedSignal,canceled=0;
 t.mock.timers.enable({apis:['setTimeout']});
 const response=new Response(new ReadableStream({pull(){return new Promise(()=>{});},cancel(){canceled++;return new Promise(()=>{});}}),{headers:{'content-type':'application/json'}});
 const transport=(_input,init)=>{observedSignal=init.signal;return stalled==='headers'?new Promise(resolve=>{release=resolve;}):Promise.resolve(response);};
 const pending=readDocumentMemoryBrief(f.selection,transport,f.current,f.controller.signal);
 const rejected=assert.rejects(pending,/memory-brief-stale/);
 for(let i=0;i<8;i++)await Promise.resolve();
 t.mock.timers.tick(60000);await rejected;assert.equal(observedSignal.aborted,true);
 release?.(response);for(let i=0;i<8;i++)await Promise.resolve();assert.ok(canceled>=1);assert.equal(response.body.locked,false);
});
test('automatic brief keeps caller withdrawal connected after read completion',async()=>{
 const f=briefFixture(),lease=await readDocumentMemoryBrief(f.selection,f.transport,f.current,f.controller.signal);assert.ok(lease.current());
 const signal=f.calls[0].init.signal;assert.notEqual(signal,f.controller.signal);assert.equal(signal.aborted,false);
 f.controller.abort();assert.equal(signal.aborted,true);assert.equal(lease.current(),null);lease.retire();
});
test('automatic profile overlaps at most four independent reads and preserves native order',async()=>{
 const f=extendedProfileFixture();let active=0,maximum=0;
 const transport=async(input,init)=>{
  const url=new URL(String(input),'https://fixture.invalid');
  if(!url.pathname.endsWith('/result'))return f.transport(input,init);
  active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setTimeout(resolve,1));
  try{return await f.transport(input,init);}finally{active--;}
 };
 const lease=await readDocumentMemoryBrief(f.selection,transport,f.current,f.controller.signal),section=lease.current().sections[0];
 assert.equal(maximum,4);assert.equal(active,0);assert.deepEqual(section.items.map(item=>item.profileOrigin.jobId),f.entries.slice(0,16).map(entry=>entry.jobId));lease.retire();
});
test('automatic profile does not advance beyond a rejected concurrent group',async()=>{
 const f=extendedProfileFixture(),reads=[];
 const transport=async(input,init)=>{
  const url=new URL(String(input),'https://fixture.invalid');
  if(url.pathname.endsWith('/result')){const id=url.searchParams.get('jobId');reads.push(id);if(id===f.entries[2].jobId)return Response.json({error:'withdrawn'},{status:404});}
  return f.transport(input,init);
 };
 await assert.rejects(readDocumentMemoryBrief(f.selection,transport,f.current,f.controller.signal));
 assert.deepEqual(reads,f.entries.slice(0,5).map(entry=>entry.jobId));assert.deepEqual(f.pages,[null]);
});

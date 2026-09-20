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
  const listing={version,scope:f.grant.scope,enrollmentId:hash('parent'),enrollmentRevision:2,results:[entry],next:null,checkedAt:now,progress:[],purpose:'rolling-summary'};
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
  assert.ok(f.calls.every(call=>call.url.pathname.endsWith('/settings')));
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
    if(url.pathname.endsWith('/results')){currentPurpose=url.searchParams.get('purpose');return Response.json({...f.listing,purpose:currentPurpose,results:[{...f.entry,purpose:currentPurpose,jobId:hash(currentPurpose)}]});}
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
 assert.ok(view.validUntil<=f.recalled.validUntil);assert.equal(f.recalls.length,2);assert.ok(f.recalls.every(c=>c.init.method==='GET'));
 assert.equal(f.recalls[1].url.searchParams.get('source'),f.source.enrollmentId);lease.retire();assert.equal(lease.current(),null);
});
for(const fault of ['schema','unavailable-source','incomplete-catalog','bad-rank'])test('automatic brief retains local notes without an older-source fallback on '+fault,async()=>{
 const f=relatedBriefFixture();f.catalog.sources.push({...f.source,enrollmentId:hash('other-older'),projectId:'far-project',documentId:'far-document',zoom:'partition',distance:0,weight:.01});
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

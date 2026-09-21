import {beginMemoryPrivacyMutation,memoryPrivacyMutationActive} from '../src/state/memory-privacy-mutation.ts';
import {createMemoryPrivateRequest} from '../src/state/memory-private-request.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import {createAssistantMemoryContextClient} from '../src/state/memory-assistant-context-client.ts';
const scope={projectId:'project',documentId:'document',custody:{private:'never on wire'}},signal=()=>new AbortController().signal;
const base=()=>({version:'memory-assistant-context-v1',targetEnrollmentId:'target',targetRevision:1,validUntil:new Date(Date.now()+20000).toISOString(),context:null,presentation:null});
const jobId='a'.repeat(64),revision='12345678-1234-1234-1234-123456789abc';
test('assistant context client sends only explicit scope and versioned acceptance',async()=>{
 const calls=[],client=createAssistantMemoryContextClient(async(input,init)=>{calls.push({input,init});return Response.json(init.method==='GET'?base():{version:'memory-assistant-context-v1',saved:true,refreshRequired:true});});
 const view=await client.read(scope,signal(),true);await client.accept(scope,view,jobId,signal());assert.equal(calls.length,2);
 assert.equal(calls[0].input,'/api/memory/assistant-context?projectId=project&documentId=document&controls=1');
 assert.deepEqual(JSON.parse(calls[1].init.body),{jobId,revision:null,targetEnrollmentId:'target',targetRevision:1,confirmation:'ACCEPT_ASSISTANT_CONTEXT'});
 assert.equal(calls[1].init.credentials,'same-origin');assert.equal(calls[1].init.redirect,'error');
});
for(const fault of ['extra','expired','future','target','state','presentation','wrong-version','oversize'])test('assistant context client rejects '+fault,async()=>{
 let calls=0;const client=createAssistantMemoryContextClient(async()=>{calls++;const value=base();
  if(fault==='extra')value.extra=true;if(fault==='expired')value.validUntil=new Date(Date.now()-1).toISOString();if(fault==='future')value.validUntil=new Date(Date.now()+31000).toISOString();
  if(fault==='target')value.targetRevision=0;if(fault==='state')value.context={revision,jobId,state:'active'};if(fault==='presentation')value.presentation={text:'leaked'};
  if(fault==='wrong-version')value.version='old';return fault==='oversize'?new Response(' '.repeat(524289),{headers:{'content-type':'application/json'}}):Response.json(value);});
 await assert.rejects(client.read(scope,signal()));assert.equal(calls,1);
});
test('unavailable references are controls metadata only, never a valid content response',async()=>{
 const client=createAssistantMemoryContextClient(async()=>Response.json({...base(),context:{revision,jobId,state:'unavailable'}}));
 assert.equal((await client.read(scope,signal(),true)).context.state,'unavailable');await assert.rejects(client.read(scope,signal()));
});
test('pre-aborted acceptance never dispatches and lost acknowledgement never retries',async()=>{
 let calls=0;const client=createAssistantMemoryContextClient(async()=>{calls++;throw Error('lost');}),controller=new AbortController();controller.abort();
 await assert.rejects(client.accept(scope,base(),jobId,controller.signal));assert.equal(calls,0);
 await assert.rejects(client.accept(scope,base(),jobId,signal()));assert.equal(calls,1);
});

test('privacy barrier is identifier-free, overlap-safe and release is idempotent',t=>{
 const window=new EventTarget(),events=[];const previous=Object.getOwnPropertyDescriptor(globalThis,'window');Object.defineProperty(globalThis,'window',{configurable:true,value:window});t.after(()=>{if(previous)Object.defineProperty(globalThis,'window',previous);else delete globalThis.window;});
 window.addEventListener('forma-memory-privacy-mutation',event=>events.push({active:memoryPrivacyMutationActive(),detail:event.detail}));
 const first=beginMemoryPrivacyMutation(),second=beginMemoryPrivacyMutation();t.after(()=>{first();second();});
 assert.equal(memoryPrivacyMutationActive(),true);first();first();assert.equal(memoryPrivacyMutationActive(),true);
 second();second();assert.equal(memoryPrivacyMutationActive(),false);
 assert.deepEqual(events,[{active:true,detail:undefined},{active:true,detail:undefined},{active:false,detail:undefined}]);
});
for(const mode of ['success','error','abort'])test('boundary transport holds privacy barrier through '+mode,async()=>{
 let resolve,calls=0;const controller=new AbortController();
 const request=createMemoryPrivateRequest(()=>{calls++;assert.equal(memoryPrivacyMutationActive(),true);return new Promise(done=>{resolve=done;});},'test');
 const pending=request(scope,'recall-boundary',controller.signal,'DELETE');assert.equal(memoryPrivacyMutationActive(),true);
 if(mode==='abort')controller.abort();else resolve(Response.json({version:'test'},{status:mode==='error'?503:200}));
 if(mode==='success')await pending;else await assert.rejects(pending);
 assert.equal(memoryPrivacyMutationActive(),false);assert.equal(calls,1);
 if(mode==='abort')resolve(Response.json({version:'test'}));
});
test('read and explicit context-selection requests do not invalidate their sending consumer',async()=>{
 const request=createMemoryPrivateRequest(async()=>{assert.equal(memoryPrivacyMutationActive(),false);return Response.json({version:'test'});},'test');
 await request(scope,'recall-boundary',signal());await request(scope,'assistant-context',signal(),'PUT');
});

const {createMemoryPrivacyPeers}=await import('../src/state/memory-privacy-mutation.ts');
function peerFixture(){
 let now=100,id=0;const timers=new Map(),notices=[];
 const peer=createMemoryPrivacyPeers({notify:()=>notices.push(peer.active()),now:()=>now,schedule:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},cancel:id=>timers.delete(id)});
 return {peer,timers,notices,at:value=>{now=value;},expire:()=>{const entry=timers.entries().next().value;timers.delete(entry[0]);entry[1].fn();}};
}
const notice=(operation=revision,phase='begin')=>({version:1,operation,phase});
test('cross-tab privacy messages overlap, cannot renew on replay, and crash leases clear without retaining identifiers',()=>{
 const f=peerFixture(),second='22345678-1234-1234-1234-123456789abc';
 f.peer.receive(notice());f.at(1100);f.peer.receive(notice());assert.equal(f.timers.values().next().value.ms,120000,'duplicate did not reschedule');
 f.peer.receive(notice(second));f.peer.receive(notice(revision,'end'));assert.equal(f.peer.active(),true);
 f.at(121100);f.expire();assert.equal(f.peer.active(),false);assert.equal(f.timers.size,0);
 assert.deepEqual(f.notices,[true,true,true,false]);f.peer.dispose();
});
test('cross-tab privacy state is bounded and overflow cannot be cleared by an unrelated acknowledgement',()=>{
 const f=peerFixture();for(let i=0;i<80;i++)f.peer.receive(notice(i.toString(16).padStart(8,'0')+'-1234-1234-1234-123456789abc'));
 assert.equal(f.timers.size,1);for(let i=0;i<80;i++)f.peer.receive(notice(i.toString(16).padStart(8,'0')+'-1234-1234-1234-123456789abc','end'));
 assert.equal(f.peer.active(),true);f.at(120100);f.expire();assert.equal(f.peer.active(),false);f.peer.dispose();
});
test('cross-tab messages reject private payloads, unsupported fields, getters and malformed tokens',()=>{
 const f=peerFixture();let invoked=0;
 const accessor={operation:revision,phase:'begin'};Object.defineProperty(accessor,'version',{enumerable:true,get(){invoked++;return 1;}});
 for(const value of [null,[],{...notice(),text:'private'},notice('actor-id'),{...notice(),version:2},notice(revision,'unknown'),accessor])f.peer.receive(value);
 assert.equal(f.peer.active(),false);assert.equal(f.timers.size,0);assert.equal(invoked,0);assert.deepEqual(f.notices,[]);f.peer.dispose();
});
test('cross-tab lease cleanup survives clock rollback and never retains a hanging timer',()=>{
 const f=peerFixture();f.peer.receive(notice());f.at(1);f.expire();assert.equal(f.peer.active(),false);assert.equal(f.timers.size,0);assert.deepEqual(f.notices,[true,false]);f.peer.dispose();
});

function aggregate(){
 const validUntil=new Date(Date.now()+20000).toISOString(),expiresAt=new Date(Date.now()+86400000).toISOString(),profileJob='b'.repeat(64);
 const presentation=(id,purpose)=>({jobId:id,expiresAt,candidate:{version:'memory-derivation-candidates-v1',purpose,scopeKey:'synthetic-scope',manifestId:id,manifestRevision:1,validUntil,semanticAuthority:'model-derived-unverified',semanticCompleteness:false,independentEvidence:false,items:[{operation:'assert',target:null,category:purpose==='profile'?'preference-hypothesis':'goal',text:'Unverified private note',supports:[{sourceIndex:0,start:0,end:8,text:'Original'}],counterevidence:[],claimKey:'d'.repeat(64),lineageIds:['e'.repeat(64)],sourceBindings:[{sourceId:'original',revision:1,contentHash:'f'.repeat(64)}],validUntil,citationStatus:'support-cited'}]}});
 return {...base(),validUntil,independentEvidence:false,completeHistory:false,context:{revision,state:'accepted',jobId,purpose:'rolling-summary',expiresAt,profileJobIds:[profileJob],source:{enrollmentId:'target',projectId:'project',documentId:'document',zoom:'document',distance:0,weight:1}},presentation:presentation(jobId,'rolling-summary'),profiles:[{source:{enrollmentId:'other',projectId:'project',documentId:'another',zoom:'project',distance:0,weight:.7},presentation:presentation(profileJob,'profile')}]};
}
test('aggregate context client validates all profiles and explicit replacement set',async()=>{
 const value=aggregate(),calls=[],client=createAssistantMemoryContextClient(async(input,init)=>{calls.push({input,init});return Response.json(init.method==='GET'?value:{version:'memory-assistant-context-v1',saved:true,refreshRequired:true});});
 const view=await client.read(scope,signal());assert.equal(view.profiles.length,1);assert.equal(view.profiles[0].source.weight,.7);
 await client.accept(scope,view,jobId,signal(),view.context.profileJobIds);assert.deepEqual(JSON.parse(calls[1].init.body).profileJobIds,['b'.repeat(64)]);
 await client.accept(scope,view,jobId,signal(),[]);assert.equal(Object.hasOwn(JSON.parse(calls[2].init.body),'profileJobIds'),false);
});
for(const fault of ['missing','extra','duplicate','too-many','primary','unknown-job','non-profile','weight','target-alias','same-source','expired','early-expiry','extra-key','no-metadata'])test('aggregate context client rejects '+fault,async()=>{
 const value=aggregate(),p=value.profiles[0];
 if(fault==='missing')delete value.profiles;if(fault==='extra')value.profiles.push(structuredClone(p));if(fault==='duplicate')value.context.profileJobIds.push(value.context.profileJobIds[0]);
 if(fault==='too-many')value.context.profileJobIds.push('c'.repeat(64),'d'.repeat(64));if(fault==='primary')value.context.profileJobIds[0]=jobId;if(fault==='unknown-job')p.presentation.jobId='f'.repeat(64);
 if(fault==='non-profile')p.presentation.candidate.purpose='rolling-summary';if(fault==='weight')p.source.weight=1;
 if(fault==='target-alias')p.source.zoom='document';if(fault==='same-source')p.source.enrollmentId='target';
 if(fault==='expired')p.presentation.candidate.validUntil=new Date(Date.now()-1).toISOString();if(fault==='early-expiry')p.presentation.expiresAt=new Date(Date.now()+1000).toISOString();
 if(fault==='extra-key')p.authority='approved';if(fault==='no-metadata')delete value.context.profileJobIds;
 await assert.rejects(createAssistantMemoryContextClient(async()=>Response.json(value)).read(scope,signal()));
});
test('aggregate context invalid selection never dispatches and uncertain selection does not retry',async()=>{
 let calls=0;const client=createAssistantMemoryContextClient(async()=>{calls++;throw Error('uncertain');}),view=aggregate();
 for(const jobs of [[jobId],['bad'],['b'.repeat(64),'b'.repeat(64)],['b'.repeat(64),'c'.repeat(64),'d'.repeat(64)]])await assert.rejects(client.accept(scope,view,jobId,signal(),jobs));
 assert.equal(calls,0);await assert.rejects(client.accept(scope,view,jobId,signal(),['b'.repeat(64)]));assert.equal(calls,1);
});

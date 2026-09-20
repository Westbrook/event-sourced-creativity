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

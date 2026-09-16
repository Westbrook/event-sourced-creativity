import {createStoryboardJobTable,insertStoryboardJob} from './output-storyboard-job-schema.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {registerHooks} from 'node:module';
const C=process.env.FORMA_SOURCE_ROOT;if(!C)throw Error('FORMA_SOURCE_ROOT required');
const {registerOutputSourceImports,outputTestDatabase}=await import(C+'/tests/output-execution-test-helpers.mjs');registerOutputSourceImports();
registerHooks({resolve(specifier,context,next){if(!specifier.startsWith('.')&&!specifier.startsWith('/')&&!specifier.includes(':'))return next(specifier,{...context,parentURL:new URL('file://'+C+'/worker/openai-adapter.ts').href});return next(specifier,context);}});
const {createStoryboardOutputContract}=await import('../src/model/output-storyboard-contract.ts');
const {prepareStoryboardPlannerRequest,generateDocumentArtifact}=await import('../worker/openai-adapter.ts');
const {captureStoryboardPlannerResponse,readStoryboardPlannerAttempt}=await import('../worker/output-storyboard-request.ts');
const {retainStoryboardPlannerRequestCheckpoint,retainStoryboardRawEnvelopeCheckpoint}=await import('../worker/output-storyboard-planner-checkpoint.ts');
const {captureStoryboardRawEnvelope,MAX_STORYBOARD_ENVELOPE_BYTES,MAX_STORYBOARD_ENVELOPE_READS,MAX_STORYBOARD_ENVELOPE_EMPTY_READS}=await import('../worker/output-storyboard-envelope.ts');
const contract=()=>createStoryboardOutputContract({draftId:'experience-draft-'+'a'.repeat(64),draftHash:'sha256:'+'b'.repeat(64),releaseHash:'sha256:'+'c'.repeat(64),requestHash:'sha256:'+'d'.repeat(64),sourceBindingHash:'sha256:'+'e'.repeat(64)});
const input=()=>({documentTitle:'The keeper',snapshot:{document:{id:'doc',title:'The keeper'},facts:[{type:'subject',active:true,instruction:'A keeper brings a lantern home through the harbor.'},{type:'style',active:true,instruction:'Keep the same lantern and person; preserve the journey order.'}]},options:{itemCount:4,productionMode:'manual'}});
const raw=()=>JSON.stringify({title:'The keeper',summary:'A return home',content_markdown:'The keeper returns with the lantern.',presentation:null,items:Array.from({length:4},(_,i)=>({title:'Moment '+i,body:'Original moment '+i,notes:'Keep lantern continuity.',image_prompt:'Original direction '+i,slide:null,context_group_ids:[]}))});
const envelope=(text=raw())=>({id:'response-original',model:'gpt-5.6-terra',status:'completed',output_text:text,usage:{input_tokens:100,output_tokens:200,total_tokens:300},service_tier:'default'});
const originalFetch=globalThis.fetch;let fetches=[];globalThis.fetch=()=>{throw Error('unconfigured test transport');};test.after(()=>{globalThis.fetch=originalFetch;});
test('actual Storyboard adapter merges accepted unknown evidence into the original parsed receipt without replacing immutable provider fields',async()=>{
 const {mergeProviderSubmissions,hasUnsettledProviderSubmission}=await import(C+'/src/model/provider-submission.ts');
 for(const wire of [JSON.stringify(envelope()),'{']){
  const source=input(),prepared=await prepareStoryboardPlannerRequest({},'owner',source,contract()),observed=[],rawEnvelopes=[];
  let receipts={},posted=0,attempt;
  const merge=receipt=>{observed.push(structuredClone(receipt));receipts=mergeProviderSubmissions(receipts,{[receipt.clientRequestId]:receipt});};
  globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(options.body,prepared.requestBody);posted++;return new Response(wire);};
  const pending=generateDocumentArtifact({OPENAI_API_KEY:'unusable-test-presence-marker'},'owner','storyboard',{...source,options:{...source.options,
   outputStoryboard:{contract:contract(),requestDigest:prepared.requestDigest,maximumInputTokens:prepared.maximumInputTokens},
   onBeforeProviderAttempt:value=>{attempt=value;},onBeforeProviderDispatch(){},onProviderSubmission:merge,
   onStoryboardEnvelope:async raw=>{rawEnvelopes.push(raw);assert.equal(Object.values(receipts)[0].status,'accepted');assert(hasUnsettledProviderSubmission({providerSubmissions:receipts}));},
   onProviderResponse:receipt=>{merge(receipt.call);}
  }});
  if(wire==='{')await assert.rejects(pending);else await pending;
  assert.equal(posted,1);assert.equal(rawEnvelopes.length,1);assert.equal(atob(rawEnvelopes[0].bodyBase64),wire);
  const accepted=observed.find(receipt=>receipt.status==='accepted');assert(accepted);
  for(const key of ['completionStatus','costMicrousd','providerRequestId','totalTokens'])assert(!Object.hasOwn(accepted,key),key);
  const final=Object.values(receipts)[0];assert.equal(final.clientRequestId,attempt.clientRequestId);assert.equal(final.requestDigest,prepared.requestDigest);
  if(wire==='{'){assert.equal(final.status,'accepted');assert(hasUnsettledProviderSubmission({providerSubmissions:receipts}));assert(!Object.hasOwn(final,'costMicrousd'));assert(!Object.hasOwn(final,'completionStatus'));}
  else{
   assert.equal(final.status,'completed');assert.equal(final.completionStatus,'completed');assert.equal(final.providerRequestId,'response-original');assert(final.costMicrousd>0);assert.equal(final.totalTokens,300);
   assert(!hasUnsettledProviderSubmission({providerSubmissions:receipts}));
   for(const change of [{completionStatus:'incomplete'},{requestDigest:'f'.repeat(64)},{providerRequestId:'foreign'},{costMicrousd:final.costMicrousd+1},{status:'rejected'}]){
    assert.throws(()=>mergeProviderSubmissions(receipts,{[final.clientRequestId]:{...final,...change}}));assert.equal(receipts[final.clientRequestId],final);
   }
  }
 }
});
async function runFixture(response,changes={},wire){
 const source=input(),prepared=await prepareStoryboardPlannerRequest({},'owner',source,contract()),submissions=[],responses=[],attempts=[],rawEnvelopes=[];fetches=[];
 globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/responses');fetches.push(options.body);return wire instanceof Response?wire:new Response(wire??'\n '+JSON.stringify(response)+'\n',{headers:{'content-type':'application/json'}});};
 const promise=generateDocumentArtifact({OPENAI_API_KEY:'unusable-test-presence-marker'},'owner','storyboard',{...source,options:{...source.options,outputStoryboard:{contract:contract(),requestDigest:prepared.requestDigest,maximumInputTokens:prepared.maximumInputTokens},onBeforeProviderAttempt:a=>attempts.push(a),onBeforeProviderDispatch:()=>{},onProviderSubmission:r=>submissions.push(r),onStoryboardEnvelope:async r=>{if(r.httpStatus>=200&&r.httpStatus<300)assert(submissions.some(x=>x.status==='accepted'&&!Object.hasOwn(x,'costMicrousd')));rawEnvelopes.push(r);},onProviderResponse:r=>{responses.push(r);},...changes}});
 return {promise,prepared,submissions,responses,attempts,rawEnvelopes};
}
test('offline preparation uses actual adapter and retains authored context with exact four schema, no transport or receipt',async()=>{
 globalThis.fetch=()=>{throw Error('offline preparation reached transport');};
 const source=input(),p=await prepareStoryboardPlannerRequest({},'owner',source,contract()),body=JSON.parse(p.requestBody),context=JSON.parse(body.input);
 assert.equal(body.text.format.schema.properties.items.minItems,4);assert.equal(body.text.format.schema.properties.items.maxItems,4);assert.equal(body.max_output_tokens,4000);
 assert.equal(body.model,'gpt-5.6-terra');assert.equal(body.store,false);assert.deepEqual(context.storyboard_contract,contract());
 assert(p.requestBody.includes('A keeper brings a lantern home'));assert(p.requestBody.includes('Keep the same lantern'));
 const changed=input();changed.snapshot.facts[0].instruction+=' Changed';assert.notEqual((await prepareStoryboardPlannerRequest({},'owner',changed,contract())).requestDigest,p.requestDigest);
 await assert.rejects(prepareStoryboardPlannerRequest({},'owner',{...source,options:{...source.options,onProviderSubmission(){throw Error('callback');}}},contract()));
});
test('actual native adapter sends prepared bytes once and retains original envelope before exact four-frame return; fixture only',async()=>{
 const f=await runFixture(envelope()),result=await f.promise;
 assert.equal(fetches.length,1);assert.equal(fetches[0],f.prepared.requestBody);assert.equal(f.attempts[0].logicalCallKey,'planning:0:initial');
 assert.equal(f.attempts[0].storyboardPlanning.requestBody,fetches[0]);assert.equal(f.responses.length,1);assert.deepEqual(JSON.parse(f.responses[0].storyboardEnvelope),envelope());
 assert.equal(f.responses[0].storyboardEnvelope,'\n '+JSON.stringify(envelope())+'\n');
 assert.deepEqual(result.output,JSON.parse(raw()));assert.equal(result.raw,raw());
});
test('actual outgoing strict schema and incoming raw Storyboard agree on omitted slide-only fields',async()=>{
 const candidate=JSON.parse(raw());delete candidate.presentation;for(const item of candidate.items)delete item.slide;
 const wire=JSON.stringify(candidate),f=await runFixture(envelope(wire)),result=await f.promise;
 const schema=JSON.parse(f.prepared.requestBody).text.format.schema;
 assert.equal(schema.additionalProperties,false);assert.equal(schema.properties.items.items.additionalProperties,false);
 assert.equal(Object.hasOwn(schema.properties,'presentation'),false);
 assert.equal(Object.hasOwn(schema.properties.items.items.properties,'slide'),false);
 assert.deepEqual(Object.keys(candidate).sort(),schema.required.toSorted());
 for(const item of candidate.items)assert.deepEqual(Object.keys(item).sort(),schema.properties.items.items.required.toSorted());
 assert.equal(fetches.length,1);assert.equal(result.raw,wire);assert.deepEqual(result.output,JSON.parse(raw()));
 assert.equal(f.responses.length,1);assert.deepEqual(JSON.parse(f.responses[0].storyboardEnvelope),envelope(wire));
});
test('actual grouped planner request accepts only its original aliases without stripping or changing text',async()=>{
 const source=input();source.snapshot.facts[0].block_id='keeper';source.snapshot.facts[1].block_id='style';
 source.snapshot.relationships=[{from_block_id:'keeper',to_block_id:'style',kind:'context_contains'}];
 const prepared=await prepareStoryboardPlannerRequest({},'owner',source,contract());
 const groups=JSON.parse(JSON.parse(prepared.requestBody).input).combined_context_plan;
 assert.equal(groups.length,1);assert.equal(groups[0].context_key,'context_group_1');
 const candidate=JSON.parse(raw());for(const item of candidate.items)item.context_group_ids=['context_group_1'];
 let posted=0;globalThis.fetch=async(url,options)=>{assert.equal(options.body,prepared.requestBody);posted++;return new Response(JSON.stringify(envelope(JSON.stringify(candidate))));};
 const result=await generateDocumentArtifact({OPENAI_API_KEY:'unusable-test-presence-marker'},'owner','storyboard',{...source,options:{...source.options,
  outputStoryboard:{contract:contract(),requestDigest:prepared.requestDigest,maximumInputTokens:prepared.maximumInputTokens},onBeforeProviderAttempt(){},onBeforeProviderDispatch(){},onProviderResponse(){},onProviderSubmission(){},onStoryboardEnvelope(){}}});
 assert.equal(posted,1);assert.deepEqual(result.output,candidate);assert.equal(result.storyboardRequestBody,prepared.requestBody);
 const {captureOutputStoryboardPlan}=await import('../worker/output-storyboard-plan.ts');
 const {bindStoryboardFrameAttempt,readStoryboardFrameAttempt}=await import('../worker/output-storyboard-fal.ts');
 const {createOutputFalImageContract,captureOutputFalImageRequest}=await import('../worker/output-fal-image-contract.ts');
 const captured=await captureOutputStoryboardPlan(result.output,contract(),result.responseId,result.storyboardRequestBody);
 const fal=createOutputFalImageContract('ideogram/v4','1536x1024');
 const request=await captureOutputFalImageRequest(fal,fal.model,{prompt:'Original direction',expansion_model:fal.expansionModel,image_size:{width:fal.width,height:fal.height},rendering_speed:fal.renderingSpeed,acceleration:fal.acceleration,num_images:1,sync_mode:false,enable_safety_checker:true,output_format:fal.outputFormat},fal,'frame-original');
 const mapped=await bindStoryboardFrameAttempt(captured,0,request.attempt),execution={contract:contract(),requestDigest:prepared.requestDigest,maximumInputTokens:prepared.maximumInputTokens};
 assert.equal((await readStoryboardFrameAttempt(mapped,contract(),execution)).plan.bindingSha256,captured.bindingSha256);
 await assert.rejects(readStoryboardFrameAttempt(mapped,contract()));
 await assert.rejects(readStoryboardFrameAttempt(mapped,contract(),{...execution,requestDigest:'f'.repeat(64)}));
 const changed=structuredClone(mapped);changed.storyboard.plannerRequestBody+=' ';await assert.rejects(readStoryboardFrameAttempt(changed,contract(),execution));
 assert.equal(posted,1,'reconstruction never calls either provider');
});
test('malformed raw first response cannot be normalized, padded or repaired through a second request',async()=>{
 for(const mutate of [p=>p.items.pop(),p=>delete p.items[0].image_prompt,p=>p.items[0].image_prompt='',p=>p.items[0].extra='forbidden',p=>p.presentation={},p=>p.items.reverse().push(p.items[0])]){
  const p=JSON.parse(raw());mutate(p);const f=await runFixture(envelope(JSON.stringify(p)));await assert.rejects(f.promise);assert.equal(fetches.length,1);assert.equal(f.responses.length,1);
 }
});
test('completed envelope identity, refusal, usage and exact candidate binding are mandatory',async()=>{
 for(const change of [{status:'incomplete'},{model:'foreign'},{usage:{input_tokens:100,output_tokens:200,total_tokens:400}},{output:[{type:'message',content:[{type:'refusal',refusal:'denied'}]}]}]){
  const f=await runFixture({...envelope(),...change});await assert.rejects(f.promise);assert.equal(fetches.length,1);
 }
 await assert.rejects(captureStoryboardPlannerResponse(envelope(),raw().replace('The keeper','Changed'),contract()));
});
test('runtime changed preparation digest and final guard denial never invoke fixture transport',async()=>{
 const f=await runFixture(envelope(),{outputStoryboard:{contract:contract(),requestDigest:'f'.repeat(64),maximumInputTokens:10000}});await assert.rejects(f.promise);assert.equal(fetches.length,0);
 const g=await runFixture(envelope(),{onBeforeProviderDispatch(){throw Error('expired');}});await assert.rejects(g.promise,/expired/);assert.equal(fetches.length,0);assert.equal(g.submissions.filter(x=>x.status==='rejected').length,0);
});
test('exact planner attempt and actual private checkpoint transaction bind current claim, job, lease and source',async()=>{
 const captured=await prepareStoryboardPlannerRequest({},'owner',input(),contract()),expected={contract:contract(),requestDigest:captured.requestDigest,maximumInputTokens:captured.maximumInputTokens};
 assert.equal((await readStoryboardPlannerAttempt(captured.attempt,expected)).requestBody,captured.requestBody);
 for(const alter of [a=>a.maximumInputTokens++,a=>a.logicalCallKey='planning:0:repair',a=>a.storyboardPlanning.requestBody=a.storyboardPlanning.requestBody.replace('The keeper','Changed'),a=>a.storyboardPlanning.contract.source.requestHash='sha256:'+'f'.repeat(64)]){
  const attempt=structuredClone(captured.attempt);alter(attempt);await assert.rejects(readStoryboardPlannerAttempt(attempt,expected));
 }
 for(const tamper of [null,"UPDATE output_operation_slots SET job_id='foreign'","UPDATE output_operation_slots SET scope_key='foreign'","UPDATE output_operation_slots SET slot_id='foreign'","UPDATE document_jobs SET owner_id='foreign'","UPDATE document_jobs SET document_id='foreign'","UPDATE document_jobs SET stream_id='foreign'","UPDATE output_provider_calls SET request_digest='foreign'","UPDATE output_provider_calls SET client_request_id='foreign'","UPDATE output_operation_slots SET source_digest='foreign'","UPDATE output_operation_slots SET route_digest='foreign'","UPDATE output_operation_slots SET grant_id='foreign'","UPDATE document_jobs SET attempt_count=2","UPDATE document_jobs SET correlation_id='foreign'","UPDATE document_jobs SET lease_expires_at='2000-01-01T00:00:00.000Z'"]){
  const f=outputTestDatabase();try{
   f.sqlite.exec(`CREATE TABLE output_atomic_assertions(token TEXT PRIMARY KEY,passed INTEGER CHECK(passed=1));
    CREATE TABLE private_content(content_id TEXT PRIMARY KEY,owner_id TEXT,kind TEXT,content TEXT NOT NULL,created_at TEXT,expires_at TEXT,redacted_at TEXT);
    CREATE TABLE project_resource_scopes(resource_kind TEXT,resource_id TEXT);CREATE TABLE events(event_id TEXT,stream_id TEXT,type TEXT,payload TEXT);
    CREATE TABLE output_operation_slots(scope_key TEXT,slot_id TEXT,job_id TEXT,route_digest TEXT,grant_id TEXT,source_digest TEXT,status TEXT);
    CREATE TABLE output_provider_calls(scope_key TEXT,slot_id TEXT,call_key TEXT,stage_key TEXT,provider TEXT,model TEXT,client_request_id TEXT,request_digest TEXT,status TEXT,provider_response_id TEXT);`);createStoryboardJobTable(f.sqlite);
   const future=new Date(Date.now()+60000).toISOString(),scope={kind:'personal',key:'scope',actorUserId:'owner',ownerUserId:'owner',documentId:'doc'},slot={jobId:'job',slotId:'slot',sourceDigest:'source',grantId:'grant',routeDigest:'route'},job={job_id:'job',owner_id:'owner',stream_id:'stream',document_id:'doc',correlation_id:'corr',output_slot_id:'slot',kind:'render_document',attempt_count:1,expires_at:future,result_json:'{}'};
   insertStoryboardJob(f.sqlite,{...job,lease_expires_at:future});
   f.sqlite.prepare('INSERT INTO output_operation_slots VALUES(?,?,?,?,?,?,?)').run('scope','slot','job','route','grant','source','running');
   f.sqlite.prepare('INSERT INTO output_provider_calls VALUES(?,?,?,?,?,?,?,?,?,?)').run('scope','slot','planning:0:initial','planning:0:initial','openai',captured.attempt.model,captured.attempt.clientRequestId,captured.requestDigest,'pending',null);
   if(tamper)f.sqlite.exec(tamper);
   const retained=retainStoryboardPlannerRequestCheckpoint(f.env,scope,slot,job,captured);
   if(tamper){await assert.rejects(retained,/CHECK constraint/);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM private_content').get().n,0);}
   else{await retained;assert.equal(f.sqlite.prepare('SELECT content FROM private_content').get().content,captured.requestBody);const cp=JSON.parse(f.sqlite.prepare('SELECT result_json FROM document_jobs').get().result_json).outputStoryboardPlannerCheckpoint;assert.equal(cp.requestDigest,captured.requestDigest);assert.equal(cp.clientRequestId,captured.attempt.clientRequestId);await assert.rejects(retainStoryboardPlannerRequestCheckpoint(f.env,scope,slot,job,captured),/CHECK constraint/);
    const rawEnvelope=await captureStoryboardRawEnvelope(new Response('{'),{clientRequestId:captured.attempt.clientRequestId,requestDigest:captured.requestDigest,model:captured.attempt.model});
    for(const sql of ["UPDATE output_operation_slots SET job_id='foreign'","UPDATE output_operation_slots SET scope_key='foreign'","UPDATE output_operation_slots SET slot_id='foreign'"]){
     f.sqlite.exec(sql);await assert.rejects(retainStoryboardRawEnvelopeCheckpoint(f.env,scope,slot,job,rawEnvelope),/CHECK constraint/);
     assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM private_content').get().n,1);assert.equal(f.sqlite.prepare('SELECT status FROM output_provider_calls').get().status,'pending');
     f.sqlite.exec("UPDATE output_operation_slots SET job_id='job',scope_key='scope',slot_id='slot'");
    }
    await assert.rejects(retainStoryboardRawEnvelopeCheckpoint(f.env,scope,slot,job,{...rawEnvelope,clientRequestId:'foreign'}),/CHECK constraint/);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM private_content').get().n,1);
    await retainStoryboardRawEnvelopeCheckpoint(f.env,scope,slot,job,rawEnvelope);
    const rawBody=JSON.parse(f.sqlite.prepare("SELECT content FROM private_content WHERE kind='provider-response'").get().content);assert.equal(atob(rawBody.bodyBase64),'{');assert.equal(rawBody.complete,true);
    assert.equal(f.sqlite.prepare('SELECT status FROM output_provider_calls').get().status,'pending');
    await assert.rejects(retainStoryboardRawEnvelopeCheckpoint(f.env,scope,slot,job,rawEnvelope),/CHECK constraint/);
   }
  }finally{f.sqlite.close();}
 }
});
test('actual native adapter preserves invalid JSON, null, non-object, malformed output and UTF-8 bytes before parsing',async()=>{
 const values=['{','null','[]','0',JSON.stringify({...envelope(),output_text:undefined,output:{malformed:true}}),Uint8Array.of(255,254)];
 for(const wire of values){
  const f=await runFixture(null,{},wire);await assert.rejects(f.promise);assert.equal(fetches.length,1);assert.equal(f.rawEnvelopes.length,1);
  const captured=f.rawEnvelopes[0],expected=typeof wire==='string'?new TextEncoder().encode(wire):wire;
  assert.deepEqual(Uint8Array.from(atob(captured.bodyBase64),c=>c.charCodeAt(0)),expected);assert.equal(captured.complete,true);
  assert(f.submissions.some(x=>x.status==='accepted'&&!Object.hasOwn(x,'costMicrousd')&&!Object.hasOwn(x,'totalTokens')));
  assert.equal(f.submissions.filter(x=>x.status==='rejected'||x.costMicrousd===0).length,0);
 }
});
test('actual native adapter bounds oversized and failed streams, retains explicit prefixes, cancels and never retries',async()=>{
 let pulls=0,cancelled=false;
 const oversized=new Response(new ReadableStream({pull(controller){pulls++;controller.enqueue(new Uint8Array(32768).fill(97));},cancel(){cancelled=true;}}));
 const f=await runFixture(null,{},oversized);await assert.rejects(f.promise,/envelope_incomplete/);assert.equal(fetches.length,1);
 assert.equal(f.rawEnvelopes.length,1);assert.equal(f.rawEnvelopes[0].retainedBytes,MAX_STORYBOARD_ENVELOPE_BYTES);assert.equal(f.rawEnvelopes[0].complete,false);assert(cancelled);assert(pulls<=18);
 assert.equal(f.submissions.filter(x=>x.status==='rejected'||x.costMicrousd===0).length,0);
 let count=0;const failed=new Response(new ReadableStream({pull(controller){if(count++===0)controller.enqueue(new TextEncoder().encode('partial'));else controller.error(Error('transport read failed'));}}));
 const g=await runFixture(null,{},failed);await assert.rejects(g.promise,/envelope_incomplete/);assert.equal(fetches.length,1);assert.equal(g.rawEnvelopes[0].readFailed,true);assert.equal(g.rawEnvelopes[0].complete,false);assert.equal(atob(g.rawEnvelopes[0].bodyBase64),'partial');
 assert.equal(g.submissions.filter(x=>x.status==='rejected'||x.costMicrousd===0).length,0);
});
test('actual adapter retains capped bytes and releases the lock despite never-settling or rejected cancellation', {timeout:3000},async()=>{
 for(const cancellation of [()=>new Promise(()=>{}),()=>Promise.reject(Error('cancel failed'))]){
  let cancelled=0;
  const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(MAX_STORYBOARD_ENVELOPE_BYTES+1).fill(97));},cancel(){cancelled++;return cancellation();}});
  const f=await runFixture(null,{},new Response(stream));await assert.rejects(f.promise,/envelope_incomplete/);
  assert.equal(fetches.length,1);assert.equal(cancelled,1);assert.equal(stream.locked,false);
  assert.equal(f.rawEnvelopes.length,1);assert.equal(f.rawEnvelopes[0].complete,false);
  assert.equal(atob(f.rawEnvelopes[0].bodyBase64),'a'.repeat(MAX_STORYBOARD_ENVELOPE_BYTES));
  assert.equal(f.submissions.filter(x=>x.status==='rejected'||x.costMicrousd===0).length,0);
 }
});
test('actual adapter bounds a stalled read via caller abort and endless empty or tiny chunks via finite work', {timeout:3000},async()=>{
 for(const mode of ['stalled','empty','tiny']){
  const abort=new AbortController();let pulls=0,cancelled=0;
  const stream=new ReadableStream({pull(c){pulls++;if(pulls===1){c.enqueue(new TextEncoder().encode('prefix'));return;}
   if(mode==='stalled'){setImmediate(()=>abort.abort());return new Promise(()=>{});}
   c.enqueue(mode==='empty'?new Uint8Array(0):Uint8Array.of(97));
  },cancel(){cancelled++;return new Promise(()=>{});}});
  const f=await runFixture(null,{signal:abort.signal},new Response(stream));await assert.rejects(f.promise,/envelope_incomplete/);
  assert.equal(fetches.length,1);assert.equal(cancelled,1);assert.equal(stream.locked,false);
  assert.equal(f.rawEnvelopes.length,1);assert.equal(f.rawEnvelopes[0].complete,false);assert.equal(f.rawEnvelopes[0].readFailed,true);
  assert.equal(atob(f.rawEnvelopes[0].bodyBase64),mode==='tiny'?'prefix'+'a'.repeat(MAX_STORYBOARD_ENVELOPE_READS-1):'prefix');
  assert(pulls<=(mode==='empty'?MAX_STORYBOARD_ENVELOPE_EMPTY_READS+2:MAX_STORYBOARD_ENVELOPE_READS+1));
  assert.equal(f.submissions.filter(x=>x.status==='rejected'||x.costMicrousd===0).length,0);
 }
});
test('actual adapter sends non-OK malformed and oversized responses directly to bounded custody without helper cloning or retry', {timeout:3000},async()=>{
 for(const oversized of [false,true]){
  const bytes=new TextEncoder().encode(oversized?'x'.repeat(MAX_STORYBOARD_ENVELOPE_BYTES+1):'{');
  const response=new Response(new ReadableStream({start(c){c.enqueue(bytes);c.close();}}),{status:500});
  let clones=0;response.clone=()=>{clones++;throw Error('caller-bounded response must never be cloned');};
  const f=await runFixture(null,{},response);await assert.rejects(f.promise);
  assert.equal(fetches.length,1);assert.equal(clones,0);assert.equal(f.rawEnvelopes.length,1);assert.equal(f.rawEnvelopes[0].httpStatus,500);
  assert.equal(atob(f.rawEnvelopes[0].bodyBase64),oversized?'x'.repeat(MAX_STORYBOARD_ENVELOPE_BYTES):'{');
  assert.equal(f.rawEnvelopes[0].complete,!oversized);assert.equal(response.body.locked,false);
  assert.equal(f.submissions.filter(x=>x.status==='rejected'||x.costMicrousd===0).length,0);
 }
});

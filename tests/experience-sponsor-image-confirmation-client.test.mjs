import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {registerOutputSourceImports} from './output-execution-test-helpers.mjs';
registerOutputSourceImports();

const [{createSponsorImageConfirmationClient},{registeredExperience,initialValues,buildExperiencePlan,experienceDocumentRoute,experienceResourceId},
  {digest},{experienceOutputBinding,experienceOutputCommandKey},{createExperienceOutputRecipe}]=await Promise.all([
  import('../src/experiences/sponsor-image-confirmation-client.ts'),import('../src/experiences/intake.ts'),
  import('../src/experiences/compiler.ts'),import('../worker/experience-output-binding.ts'),import('../worker/experience-output-recipe.ts'),
]);
const originalFetch=globalThis.fetch;let forbiddenFetches=0;
globalThis.fetch=()=>{forbiddenFetches++;throw Error('Confirmation client tests permit injected simulation only');};
after(()=>{globalThis.fetch=originalFetch;assert.equal(forbiddenFetches,0);});
const uuid=index=>`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`;
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const signal=()=>new AbortController().signal;
function lateBody(value){
  const cancelled=deferred();let cancellations=0,sent=false;
  const response=new Response(new ReadableStream({pull(controller){
    if(!sent){sent=true;controller.enqueue(new TextEncoder().encode(JSON.stringify(value)));}else controller.close();
  },cancel(){cancellations++;cancelled.resolve();}},{highWaterMark:0}));
  return {response,cancelled:cancelled.promise,count:()=>cancellations};
}

/** Pure client fixtures use the actual native plan, binding, key and recipe
 * constructors. Receipt/confirmation events are simulated unit data, not proof
 * of server custody, sponsor authorization or executed native confirmation. */
async function input(){
  const actorUserId='fixture-confirmation-actor',campaignId='fixture-confirmation-campaign',release=await registeredExperience('image');
  const values=structuredClone(initialValues(release));values.subject={value:'A cedar writing desk',provenance:'authored'};
  values.ratio={value:{width:1,height:1},provenance:'authored'};
  const request={intentId:uuid(1),experienceId:'image',releaseHash:release.releaseHash,values};
  const native=await buildExperiencePlan(actorUserId,request,release),{draftHash:_nativeHash,...base}=native;
  const marker={version:1,receiptId:`sponsor-intake-${(await digest({campaignId,actor:actorUserId,intent:request.intentId})).slice(7)}`};
  const marked={...base,sponsor_intake:marker},plan={...marked,draftHash:await digest(marked)};
  const receipt={status:'complete',generation:'unavailable',projectId:plan.projectId,documentId:plan.documentId,
    draftId:plan.draftId,draftHash:plan.draftHash,documentRoute:experienceDocumentRoute(plan),head:plan.events.length,rejected:[],
    appended:plan.events.map((event,index)=>({...structuredClone(event),eventId:uuid(index+10),sequence:index+1,
      actor:'user',streamId:plan.streamId,clientId:'web:experience-intake',correlationId:`experience-intake:${plan.projectId}`,
      schemaVersion:1,compensatesEventId:null}))};
  const binding=await experienceOutputBinding(plan),recipe=createExperienceOutputRecipe({output:'image',
    requirementId:await experienceResourceId(plan.draftId,'native-output-requirement'),
    deliverableId:await experienceResourceId(plan.draftId,'native-output-deliverable'),
    variantId:await experienceResourceId(plan.draftId,'native-output-variant'),aspectRatio:{width:1,height:1}});
  const unconfirmed={version:1,kind:'sponsor-image-confirmation',status:'unconfirmed',generation:'unavailable',actorUserId,campaignId,binding,replayed:true};
  const confirmed={...unconfirmed,status:'confirmed',replayed:true,planRevisionId:uuid(100),targetId:recipe.targetId,
    receipts:{save:{key:await experienceOutputCommandKey(binding,'save'),eventId:uuid(101),requestDigest:'1'.repeat(64)},
      confirm:{key:await experienceOutputCommandKey(binding,'confirm'),eventId:uuid(102),requestDigest:'2'.repeat(64)}}};
  return {config:{version:1,campaignId,actorUserId,plan,receipt},unconfirmed,confirmed};
}

async function client(t,f,send){
  const controller=await createSponsorImageConfirmationClient(f.config,send);
  t.after(()=>controller.dispose());return controller;
}
function unavailable(controller){
  assert.equal(controller.pending,false);assert.equal(controller.state.phase,'unavailable');
  assert.equal(controller.state.confirmation,null);assert.equal(typeof controller.state.error,'string');assert.ok(controller.state.error.length);
}

test('simulated valid native-shaped unconfirmed and confirmed responses are accepted only through deliberate injected calls',async t=>{
  const f=await input(),calls=[],responses=[f.unconfirmed,{...f.confirmed,replayed:false}];
  const controller=await client(t,f,async function(path,init){
    assert.equal(this,undefined);calls.push({path,init});return Response.json(responses[calls.length-1]);
  });
  assert.ok(Object.isFrozen(controller));assert.equal(controller.state.phase,'idle');assert.equal(controller.pending,false);
  assert.equal(controller.state.confirmation,null);assert.equal(controller.state.error,null);assert.equal(calls.length,0);
  assert.deepEqual(await controller.read({signal:signal()}),f.unconfirmed);assert.equal(controller.state.phase,'ready');assert.deepEqual(controller.state.confirmation,f.unconfirmed);
  assert.deepEqual(await controller.confirm({explicitRequirementsConfirmation:true},{signal:signal()}),responses[1]);
  assert.equal(controller.state.phase,'ready');assert.equal(controller.pending,false);assert.deepEqual(controller.state.confirmation,responses[1]);
  assert.equal(calls.length,2);assert.ok(Object.isFrozen(controller.state));assert.ok(Object.isFrozen(controller.state.confirmation.binding));
  for(const {path,init} of calls){
    assert.equal(path,`/api/experiences/sponsor/image/drafts/${f.config.plan.draftId}/output-confirmation`);
    assert.equal(init.credentials,'same-origin');assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');assert.ok(init.signal instanceof AbortSignal);
    assert.equal(path.includes('/output/prepare'),false);assert.equal(path.includes('/run'),false);
  }
  assert.equal(calls[0].init.method,'GET');assert.equal(calls[0].init.body,undefined);assert.equal(calls[1].init.method,'POST');
  assert.deepEqual(JSON.parse(calls[1].init.body),{draftHash:f.config.plan.draftHash,explicitRequirementsConfirmation:true});
});

test('invalid captured plan, marker, actor, campaign or native receipt identity refuses construction before any fetch',async()=>{
  const f=await input();let calls=0,getterCalls=0;
  const changes=[c=>c.version=2,c=>c.payerUserId='untrusted-payer',c=>c.actorUserId='other-actor',c=>c.campaignId='other-campaign',
    c=>delete c.plan.sponsor_intake,c=>c.plan.sponsor_intake.receiptId='sponsor-intake-'+ '0'.repeat(64),
    c=>c.plan.draftHash='sha256:'+'0'.repeat(64),c=>c.receipt.documentId=uuid(200),c=>c.receipt.status='pending',
    c=>c.receipt.appended[0].actor='worker',c=>c.receipt.appended[0].payload={forged:true},
    c=>c.receipt.appended[1].eventId=c.receipt.appended[0].eventId,c=>delete c.receipt];
  for(const change of changes){const config=structuredClone(f.config);change(config);await assert.rejects(createSponsorImageConfirmationClient(config,async()=>{calls++;return Response.json(f.confirmed);}));}
  const accessor=structuredClone(f.config),symbol=structuredClone(f.config);
  Object.defineProperty(accessor,'campaignId',{enumerable:true,get(){getterCalls++;return f.config.campaignId;}});
  symbol[Symbol('extra configuration')]=true;
  for(const config of [accessor,symbol])await assert.rejects(createSponsorImageConfirmationClient(config,async()=>{calls++;return Response.json(f.confirmed);}));
  for(const send of [undefined,null,{}])await assert.rejects(createSponsorImageConfirmationClient(f.config,send));
  assert.equal(calls,0);assert.equal(getterCalls,0);
});

test('explicit confirmation must be the exact deliberate command and never starts a read or request on rejection',async t=>{
  const f=await input();let calls=0,getterCalls=0;const controller=await client(t,f,async()=>{calls++;return Response.json(f.confirmed);});
  const accessor={},symbol={explicitRequirementsConfirmation:true};
  Object.defineProperty(accessor,'explicitRequirementsConfirmation',{enumerable:true,get(){getterCalls++;return true;}});
  symbol[Symbol('extra action')]=true;
  for(const command of [undefined,null,{},false,{explicitRequirementsConfirmation:false},{explicitRequirementsConfirmation:true,run:true},accessor,symbol]){
    await assert.rejects(controller.confirm(command,{signal:signal()}));assert.equal(calls,0);assert.equal(controller.pending,false);
  }
  assert.equal(controller.state.confirmation,null);assert.equal(getterCalls,0);
});

test('confirmed response validation rejects changed binding, stage keys, receipt identity, shape and paid-output fields',async t=>{
  const f=await input();
  const mutations={
    actor:value=>value.actorUserId='other-actor',campaign:value=>value.campaignId='other-campaign',generation:value=>value.generation='available',
    extra:value=>value.jobId=uuid(200),version:value=>value.version=2,replay:value=>value.replayed='true',
    get_not_replayed:value=>value.replayed=false,
    binding_hash:value=>value.binding.draftHash='sha256:'+'0'.repeat(64),binding_request:value=>value.binding.requestHash='sha256:'+'0'.repeat(64),
    binding_source:value=>value.binding.sourceBindingHash='sha256:'+'0'.repeat(64),binding_document:value=>value.binding.documentId=uuid(200),
    binding_stream:value=>value.binding.streamId='creative:other',binding_extra:value=>value.binding.preparationCycle=null,
    stage_key:value=>value.receipts.confirm.key=value.receipts.save.key,
    receipt_event:value=>value.receipts.confirm.eventId='not-a-uuid',receipt_duplicate:value=>value.receipts.confirm.eventId=value.receipts.save.eventId,
    prefixed_digest:value=>value.receipts.save.requestDigest='sha256:'+value.receipts.save.requestDigest,
    uppercase_digest:value=>value.receipts.save.requestDigest='A'.repeat(64),receipt_extra:value=>value.receipts.save.scope='untrusted',
    target:value=>value.targetId=value.targetId.replace(':target:1',':target:2'),plan_revision:value=>value.planRevisionId='not-a-uuid',
    missing_receipts:value=>delete value.receipts,unconfirmed_extra:value=>value.status='unconfirmed',
  };
  for(const [name,mutate] of Object.entries(mutations)){
    const value=structuredClone(f.confirmed);mutate(value);let calls=0;
    const controller=await client(t,f,async()=>{calls++;return Response.json(value);});
    await assert.rejects(controller.read({signal:signal()}),undefined,name);unavailable(controller);assert.equal(calls,1,name);
  }
});

test('a busy controller rejects a second operation without replacing or cancelling the first',async t=>{
  const f=await input(),gate=deferred(),entered=deferred();let calls=0,activeSignal;
  const controller=await client(t,f,async(_path,init)=>{calls++;activeSignal=init.signal;entered.resolve();return gate.promise;});
  const pending=controller.read({signal:signal()});await entered.promise;
  assert.equal(controller.pending,true);assert.equal(controller.state.phase,'reading');
  await assert.rejects(controller.confirm({explicitRequirementsConfirmation:true},{signal:signal()}));
  await assert.rejects(controller.read({signal:signal()}));assert.equal(calls,1);assert.equal(controller.state.phase,'reading');assert.equal(activeSignal.aborted,false);
  gate.resolve(Response.json(f.unconfirmed));await pending;assert.equal(controller.state.phase,'ready');assert.deepEqual(controller.state.confirmation,f.unconfirmed);
});

test('a refused request clears prior confirmation and performs no automatic retry or ordinary fallback',async t=>{
  const f=await input();let calls=0;
  const controller=await client(t,f,async()=>{calls++;return calls===1?Response.json(f.confirmed):Response.json({error:'synthetic_refusal'},{status:403});});
  await controller.read({signal:signal()});assert.equal(controller.state.confirmation.status,'confirmed');
  await assert.rejects(controller.read({signal:signal()}));unavailable(controller);assert.equal(calls,2);
  await Promise.resolve();await Promise.resolve();assert.equal(calls,2);
});

test('cancellation rejects even an uncooperative fetcher and cancels a late response body',{timeout:2000},async t=>{
  const f=await input(),gate=deferred(),entered=deferred(),abort=new AbortController();let calls=0,activeSignal;
  const controller=await client(t,f,async(_path,init)=>{calls++;activeSignal=init.signal;entered.resolve();return gate.promise;});
  const pending=controller.read({signal:abort.signal}),rejected=assert.rejects(pending);await entered.promise;abort.abort();await rejected;
  unavailable(controller);assert.equal(activeSignal.aborted,true);assert.equal(calls,1);
  const late=lateBody(f.confirmed);gate.resolve(late.response);await late.cancelled;
  assert.equal(late.count(),1);unavailable(controller);
});

test('a pre-aborted signal performs no fetch, and disposal aborts pending work and blocks late mutation',{timeout:2000},async t=>{
  const f=await input(),gate=deferred(),entered=deferred();let calls=0,activeSignal;
  const controller=await client(t,f,async(_path,init)=>{calls++;activeSignal=init.signal;entered.resolve();return gate.promise;});
  const aborted=new AbortController();aborted.abort();await assert.rejects(controller.read({signal:aborted.signal}));assert.equal(calls,0);
  const pending=controller.confirm({explicitRequirementsConfirmation:true},{signal:signal()}),rejected=assert.rejects(pending);await entered.promise;
  assert.equal(controller.state.phase,'confirming');controller.dispose();await rejected;
  assert.equal(activeSignal.aborted,true);assert.equal(controller.pending,false);assert.equal(controller.state.phase,'disposed');
  assert.equal(controller.state.confirmation,null);assert.equal(controller.state.error,null);
  const late=lateBody(f.confirmed);gate.resolve(late.response);await late.cancelled;assert.equal(late.count(),1);
  await assert.rejects(controller.read({signal:signal()}));await assert.rejects(controller.confirm({explicitRequirementsConfirmation:true},{signal:signal()}));
  assert.equal(calls,1);assert.equal(controller.state.phase,'disposed');assert.equal(controller.state.confirmation,null);
});

test('captured context remains bound to its original actor, campaign, native plan and receipt after caller mutation',async t=>{
  const f=await input(),original=structuredClone(f.config),calls=[];
  const constructing=createSponsorImageConfirmationClient(f.config,async(path,init)=>{calls.push({path,init});return Response.json(f.confirmed);});
  // Mutate before awaiting the factory's first digest/compile continuation.
  f.config.campaignId='caller-changed';f.config.actorUserId='caller-changed';f.config.plan.draftHash='sha256:'+'0'.repeat(64);f.config.receipt.documentId=uuid(200);
  const controller=await constructing;t.after(()=>controller.dispose());assert.equal(calls.length,0);
  await controller.confirm({explicitRequirementsConfirmation:true},{signal:signal()});assert.equal(controller.state.phase,'ready');
  assert.deepEqual(controller.state.confirmation,f.confirmed);assert.ok(calls[0].path.includes(original.plan.draftId));
  assert.equal(JSON.parse(calls[0].init.body).draftHash,original.plan.draftHash);
});

test('stream validation refuses oversized advertised or actual bytes, excessive chunks and malformed UTF-8 without retries',async t=>{
  const f=await input();
  for(const scenario of ['advertised bytes','actual bytes','chunks','UTF-8']){
    let calls=0,cancelled=0,pulls=0;
    const stream=new ReadableStream({
      pull(controller){
        pulls++;
        if(scenario==='actual bytes'){if(pulls===1)controller.enqueue(new Uint8Array(524_289));}
        else if(scenario==='chunks')controller.enqueue(new Uint8Array([32]));
        else if(scenario==='UTF-8'){controller.enqueue(new Uint8Array([255]));controller.close();}
      },cancel(){cancelled++;},
    });
    const controller=await client(t,f,async()=>{calls++;return new Response(stream,{headers:scenario==='advertised bytes'?{'content-length':'524289'}:{}});});
    await assert.rejects(controller.read({signal:signal()}));unavailable(controller);assert.equal(calls,1,scenario);
    if(scenario!=='UTF-8')assert.equal(cancelled,1,scenario);
    if(scenario==='chunks')assert.ok(pulls<=1026,'chunk limit must stop an unending stream');
  }
});

test('valid simulated responses at the byte and chunk ceilings remain readable',async t=>{
  const f=await input(),encoded=new TextEncoder().encode(JSON.stringify(f.unconfirmed));
  const exact=new Uint8Array(524_288).fill(32);exact.set(encoded);
  const large=await client(t,f,async()=>new Response(exact,{headers:{'content-length':'524288'}}));
  assert.deepEqual(await large.read({signal:signal()}),f.unconfirmed);
  let chunks=0;
  const chunked=await client(t,f,async()=>new Response(new ReadableStream({pull(controller){
    if(chunks===1024){controller.close();return;}
    controller.enqueue(chunks++===0?encoded:new Uint8Array([32]));
  }})));
  assert.deepEqual(await chunked.read({signal:signal()}),f.unconfirmed);assert.equal(chunks,1024);
});

test('the fixed deadline rejects a stalled fetch without a real wait or automatic retry',{timeout:2000},async t=>{
  const f=await input(),entered=deferred(),gate=deferred();let calls=0,activeSignal;
  const controller=await client(t,f,async(_path,init)=>{calls++;activeSignal=init.signal;entered.resolve();return gate.promise;});
  t.mock.timers.enable({apis:['setTimeout']});
  try{
    const pending=controller.read({signal:signal()}),rejected=assert.rejects(pending,/sponsor_image_confirmation_deadline/u);
    await entered.promise;t.mock.timers.tick(30_000);await rejected;
    unavailable(controller);assert.equal(activeSignal.aborted,true);assert.equal(calls,1);
    const late=lateBody(f.confirmed);gate.resolve(late.response);await late.cancelled;assert.equal(late.count(),1);unavailable(controller);
  }finally{t.mock.timers.reset();}
});

test('the same fixed deadline cancels a stalled response stream after headers arrive',async t=>{
  const f=await input(),entered=deferred();let cancelled=0,calls=0;
  const controller=await client(t,f,async()=>{
    calls++;
    return new Response(new ReadableStream({pull(){entered.resolve();},cancel(){cancelled++;}},{highWaterMark:0}));
  });
  t.mock.timers.enable({apis:['setTimeout']});
  try{
    const pending=controller.read({signal:signal()}),rejected=assert.rejects(pending,/sponsor_image_confirmation_deadline/u);
    await entered.promise;t.mock.timers.tick(30_000);await rejected;
    unavailable(controller);assert.equal(cancelled,1);assert.equal(calls,1);
  }finally{t.mock.timers.reset();}
});

test('a previously accepted original refuses later changed receipt identities or an unconfirmed downgrade',async t=>{
  const f=await input();
  for(const mutate of [value=>value.planRevisionId=uuid(300),value=>value.receipts.save.eventId=uuid(301),
    value=>value.receipts.confirm.requestDigest='3'.repeat(64),()=>structuredClone(f.unconfirmed)]){
    const changed=structuredClone(f.confirmed),replacement=mutate(changed),value=replacement&&typeof replacement==='object'?replacement:changed;
    let calls=0;const controller=await client(t,f,async()=>Response.json(++calls===1?f.confirmed:value));
    assert.deepEqual(await controller.read({signal:signal()}),f.confirmed);
    await assert.rejects(controller.read({signal:signal()}),/sponsor_image_confirmation_response_invalid/u);unavailable(controller);assert.equal(calls,2);
  }
  const controller=await client(t,f,async()=>Response.json(f.unconfirmed));
  await assert.rejects(controller.confirm({explicitRequirementsConfirmation:true},{signal:signal()}),/sponsor_image_confirmation_response_invalid/u);
  unavailable(controller);
});

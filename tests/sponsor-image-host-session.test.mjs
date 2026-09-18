import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {registerOutputSourceImports} from './output-execution-test-helpers.mjs';
registerOutputSourceImports();

const [{createSponsorImageHostSession},{registeredExperience,initialValues,buildExperiencePlan,experienceDocumentRoute,experienceResourceId},
  {digest},{experienceOutputBinding,experienceOutputCommandKey},{createExperienceOutputRecipe}]=await Promise.all([
  import('../src/experiences/sponsor-image-host-session.ts'),import('../src/experiences/intake.ts'),import('../src/experiences/compiler.ts'),
  import('../worker/experience-output-binding.ts'),import('../worker/experience-output-recipe.ts'),
]);
const originalFetch=globalThis.fetch;let forbiddenFetches=0;
globalThis.fetch=()=>{forbiddenFetches++;throw Error('Host session qualification permits injected simulation only');};
after(()=>{globalThis.fetch=originalFetch;assert.equal(forbiddenFetches,0);});
const uuid=index=>`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`;
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const root='/api/experiences/sponsor/image',modeRoot='/api/experiences/image/entry-mode';
const selectorQuery=selector=>Object.hasOwn(selector,'kind')?'':Object.hasOwn(selector,'draftId')?`?draftId=${selector.draftId}`:`?intentId=${selector.intentId}`;
const descriptor=(selector,mode='sponsor-image',actorUserId='fixture-host-actor')=>({version:1,mode,...(mode==='sponsor-image'?{actorUserId}:{}),selector:structuredClone(selector)});
function session(t,selector,send,abort=new AbortController()){
  const value=createSponsorImageHostSession(selector,send,{signal:abort.signal});t.after(()=>value.dispose());return {value,abort};
}
function lateBody(value){
  const stopped=deferred();let cancellations=0,sent=false;
  return {response:new Response(new ReadableStream({pull(controller){
    if(!sent){sent=true;controller.enqueue(new TextEncoder().encode(JSON.stringify(value)));}else controller.close();
  },cancel(){cancellations++;stopped.resolve();}},{highWaterMark:0})),cancelled:stopped.promise,count:()=>cancellations};
}

/** These simulated wire responses exercise the real client transport/runtime.
 * Pure native constructors supply exact plan and output identities. Receipt
 * UUIDs are synthetic; this is not server, provider or custody acceptance. */
async function wireFixture({retained=false,byIntent=false}={}){
  const f={actorUserId:'fixture-host-actor',campaignId:'fixture-host-campaign',release:await registeredExperience('image'),calls:[],confirmed:false};
  f.save=async request=>{
    const native=await buildExperiencePlan(f.actorUserId,request,f.release),{draftHash:_hash,...base}=native;
    const receiptId=`sponsor-intake-${(await digest({campaignId:f.campaignId,actor:f.actorUserId,intent:request.intentId})).slice(7)}`;
    const marked={...base,sponsor_intake:{version:1,receiptId}};f.plan={...marked,draftHash:await digest(marked)};
    f.receipt={status:'complete',generation:'unavailable',projectId:f.plan.projectId,documentId:f.plan.documentId,
      draftId:f.plan.draftId,draftHash:f.plan.draftHash,documentRoute:experienceDocumentRoute(f.plan),head:f.plan.events.length,rejected:[],
      appended:f.plan.events.map((event,index)=>({...structuredClone(event),eventId:uuid(index+10),sequence:index+1,actor:'user',streamId:f.plan.streamId,
        clientId:'web:experience-intake',correlationId:`experience-intake:${f.plan.projectId}`,schemaVersion:1,compensatesEventId:null}))};
  };
  f.confirmation=async()=>{
    const binding=await experienceOutputBinding(f.plan),base={version:1,kind:'sponsor-image-confirmation',status:f.confirmed?'confirmed':'unconfirmed',
      generation:'unavailable',actorUserId:f.actorUserId,campaignId:f.campaignId,binding,replayed:true};
    if(!f.confirmed)return base;
    const recipe=createExperienceOutputRecipe({output:'image',requirementId:await experienceResourceId(f.plan.draftId,'native-output-requirement'),
      deliverableId:await experienceResourceId(f.plan.draftId,'native-output-deliverable'),variantId:await experienceResourceId(f.plan.draftId,'native-output-variant'),aspectRatio:{width:1,height:1}});
    return {...base,planRevisionId:uuid(100),targetId:recipe.targetId,receipts:{
      save:{key:await experienceOutputCommandKey(binding,'save'),eventId:uuid(101),requestDigest:'1'.repeat(64)},
      confirm:{key:await experienceOutputCommandKey(binding,'confirm'),eventId:uuid(102),requestDigest:'2'.repeat(64)}}};
  };
  if(retained){
    const values=structuredClone(initialValues(f.release));values.subject={value:'A linen lamp shade',provenance:'authored'};values.ratio={value:{width:1,height:1},provenance:'authored'};
    await f.save({intentId:uuid(1),experienceId:'image',releaseHash:f.release.releaseHash,values});
  }
  f.selector=retained?byIntent?{intentId:f.plan.request.intentId}:{draftId:f.plan.draftId}:{kind:'fresh'};
  f.mode=descriptor(f.selector,'sponsor-image',f.actorUserId);
  f.bootstrap={version:1,kind:'sponsor-image-intake',mode:retained?'retained':'fresh',actorUserId:f.actorUserId,campaignId:f.campaignId,
    release:f.release,generation:'unavailable',...(retained?{draftId:f.plan.draftId,draftHash:f.plan.draftHash}:{})};
  f.send=async function(path,init){
    assert.equal(this,undefined);f.calls.push({path,init});
    assert.equal(init.credentials,'same-origin');assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');assert.ok(init.signal instanceof AbortSignal);
    if(path===modeRoot+selectorQuery(f.selector)){assert.equal(init.method,'GET');return Response.json(f.mode);}
    if(path===root+'/bootstrap'+selectorQuery(f.selector)){assert.equal(init.method,'GET');return Response.json(f.bootstrap);}
    if(path===root+'/drafts'&&init.method==='POST'){
      const command=JSON.parse(init.body);assert.equal(command.action,'prepare-sponsored-image-draft');assert.equal(command.campaignId,f.campaignId);
      await f.save(command.request);return Response.json({status:'prepared',plan:f.plan});
    }
    if(f.plan&&path===`${root}/drafts/${f.plan.draftId}/commit`&&init.method==='POST'){
      assert.deepEqual(JSON.parse(init.body),{action:'commit-sponsored-image-draft',campaignId:f.campaignId,draftId:f.plan.draftId,draftHash:f.plan.draftHash});
      return Response.json(f.receipt);
    }
    if(f.plan&&init.method==='GET'&&(path===`${root}/drafts/${f.plan.draftId}`||path===`${root}/drafts?intentId=${f.plan.request.intentId}`))
      return Response.json({status:'prepared',plan:f.plan});
    if(f.plan&&path===`${root}/drafts/${f.plan.draftId}/receipt`&&init.method==='GET')return Response.json(f.receipt);
    if(f.plan&&path===`${root}/drafts/${f.plan.draftId}/output-confirmation`){
      assert.ok(['GET','POST'].includes(init.method));
      if(init.method==='POST'){assert.deepEqual(JSON.parse(init.body),{draftHash:f.plan.draftHash,explicitRequirementsConfirmation:true});f.confirmed=true;}
      return Response.json(await f.confirmation());
    }
    assert.fail(`Unapproved simulated host request: ${path}`);
  };
  return f;
}
const author=runtime=>{assert.equal(runtime.change('subject','A linen lamp shade'),true);assert.equal(runtime.change('ratio',{width:1,height:1}),true);};

test('fresh, draft and intent mode lookups use exact closed descriptors and cache only the same session result',async t=>{
  for(const selector of [{kind:'fresh'},{draftId:'experience-draft-'+'a'.repeat(64)},{intentId:uuid(1)}]){
    const calls=[],expected=descriptor(selector),{value}=session(t,selector,async(path,init)=>{calls.push({path,init});return Response.json(expected);});
    assert.equal(calls.length,0);assert.equal(value.mode,null);assert.equal(value.runtime,undefined);assert.equal(value.bootstrap,undefined);assert.equal(value.confirmationState,null);
    const result=await value.resolveMode();assert.deepEqual(result,expected);assert.strictEqual(value.mode,result);assert.ok(Object.isFrozen(result.selector));
    assert.strictEqual(await value.resolveMode(),result);assert.equal(calls.length,1);assert.equal(calls[0].path,modeRoot+selectorQuery(selector));
    assert.equal(calls[0].init.method,'GET');assert.equal(calls[0].init.body,undefined);assert.equal(calls[0].init.credentials,'same-origin');assert.equal(calls[0].init.redirect,'error');
    assert.equal(value.signal.aborted,false);assert.equal(value.pending,false);
  }
});

test('factory refuses open selectors, accessors, symbols and missing explicit transport without any I/O',()=>{
  let calls=0,getters=0;const send=async()=>{calls++;return Response.json({});},signal=new AbortController().signal;
  const accessor={};Object.defineProperty(accessor,'kind',{enumerable:true,get(){getters++;return 'fresh';}});
  const symbol={kind:'fresh',[Symbol('extra')]:true};
  for(const selector of [undefined,null,{},'fresh',{kind:'fresh',campaignId:'caller'},
    {draftId:'experience-draft-'+'a'.repeat(64),intentId:uuid(1)},{intentId:'invalid'},accessor,symbol])
    assert.throws(()=>createSponsorImageHostSession(selector,send,{signal}));
  for(const fetcher of [undefined,null,{}])assert.throws(()=>createSponsorImageHostSession({kind:'fresh'},fetcher,{signal}));
  for(const options of [undefined,{}, {signal,extra:true}])assert.throws(()=>createSponsorImageHostSession({kind:'fresh'},send,options));
  assert.equal(calls,0);assert.equal(getters,0);
});

test('changed mode identities, selectors and extra campaign selection are refused without bootstrap or fallback',async t=>{
  const selector={kind:'fresh'},base=descriptor(selector);
  const changes=[v=>v.version=2,v=>v.mode='guest',v=>v.campaignId='injected-campaign',v=>v.actorUserId='',v=>delete v.actorUserId,
    v=>v.selector={intentId:uuid(1)},v=>v.selector.extra=true,v=>{v.mode='ordinary';},v=>v.selector=null];
  for(const change of changes){
    const response=structuredClone(base);change(response);let calls=0;
    const {value}=session(t,selector,async()=>{calls++;return Response.json(response);});
    await assert.rejects(value.resolveMode());assert.equal(value.mode,null);assert.equal(value.runtime,undefined);
    await assert.rejects(value.openSponsor());assert.equal(calls,1);assert.equal(value.pending,false);
  }
});

test('ordinary mode remains ordinary and cannot open sponsor runtime or implicitly confirm',async t=>{
  let calls=0;const selector={kind:'fresh'},{value}=session(t,selector,async()=>{calls++;return Response.json(descriptor(selector,'ordinary'));});
  await assert.rejects(value.openSponsor());assert.equal(calls,0);
  assert.equal((await value.resolveMode()).mode,'ordinary');await assert.rejects(value.openSponsor());await assert.rejects(value.readConfirmation());
  await assert.rejects(value.confirm({explicitRequirementsConfirmation:true}));assert.equal(calls,1);assert.equal(value.runtime,undefined);
});

test('mode response rejects non-success, redirect, wrong URL, oversized bytes, excessive chunks and malformed encoding',async t=>{
  const selector={kind:'fresh'};
  for(const kind of ['status','redirect','URL','advertised','bytes','chunks','encoding']){
    let calls=0,cancelled=0,pulls=0;
    const stream=new ReadableStream({pull(controller){pulls++;
      if(kind==='bytes'){if(pulls===1)controller.enqueue(new Uint8Array(1025));}
      else if(kind==='chunks')controller.enqueue(new Uint8Array([32]));
      else if(kind==='encoding'){controller.enqueue(new Uint8Array([255]));controller.close();}
    },cancel(){cancelled++;}},{highWaterMark:0});
    let response;
    if(['advertised','bytes','chunks','encoding'].includes(kind))response=new Response(stream,{headers:kind==='advertised'?{'content-length':'1025'}:{}});
    else{
      response=Response.json(descriptor(selector),{status:kind==='status'?403:200});
      if(kind==='redirect')Object.defineProperty(response,'redirected',{value:true});
      if(kind==='URL')Object.defineProperty(response,'url',{value:'https://untrusted.invalid/api/experiences/image/entry-mode'});
    }
    const {value}=session(t,selector,async()=>{calls++;return response;});
    await assert.rejects(value.resolveMode(),kind==='status'?/sponsor_image_host_unavailable/u:/sponsor_image_host_response_invalid/u);
    assert.equal(calls,1,kind);assert.equal(value.mode,null,kind);assert.equal(value.pending,false,kind);await assert.rejects(value.openSponsor());assert.equal(calls,1);
    if(['advertised','bytes','chunks'].includes(kind))assert.equal(cancelled,1,kind);
    if(kind==='chunks')assert.ok(pulls<=65);
  }
});

test('the mode parser accepts exact byte and chunk ceilings and captures its selector before caller mutation',async t=>{
  const selector={kind:'fresh'},expected=descriptor(selector),encoded=new TextEncoder().encode(JSON.stringify(expected));
  const bytes=new Uint8Array(1024).fill(32);bytes.set(encoded);
  const first=session(t,selector,async()=>new Response(bytes,{headers:{'content-length':'1024'}})).value;
  selector.kind='caller-mutated';assert.deepEqual(await first.resolveMode(),expected);
  let chunks=0;const second=session(t,{kind:'fresh'},async()=>new Response(new ReadableStream({pull(controller){
    if(chunks===64){controller.close();return;}controller.enqueue(chunks++===0?encoded:new Uint8Array([32]));
  }}))).value;
  assert.deepEqual(await second.resolveMode(),expected);assert.equal(chunks,64);
});

test('five-second mode deadline stops a stalled response stream without real waiting',async t=>{
  const entered=deferred();let cancelled=0,calls=0;
  const {value}=session(t,{kind:'fresh'},async()=>{calls++;return new Response(new ReadableStream({pull(){entered.resolve();},cancel(){cancelled++;}},{highWaterMark:0}));});
  t.mock.timers.enable({apis:['setTimeout']});
  try{const pending=value.resolveMode(),rejected=assert.rejects(pending,/sponsor_image_host_deadline/u);await entered.promise;t.mock.timers.tick(5000);await rejected;
    assert.equal(value.mode,null);assert.equal(value.pending,false);assert.equal(calls,1);assert.equal(cancelled,1);
  }finally{t.mock.timers.reset();}
});

test('external abort cancels unresolved mode lookup and disposes a late response body',{timeout:2000},async t=>{
  const preAborted=new AbortController();preAborted.abort();let earlyCalls=0;
  const early=session(t,{kind:'fresh'},async()=>{earlyCalls++;return Response.json(descriptor({kind:'fresh'}));},preAborted).value;
  assert.equal(early.signal.aborted,true);await assert.rejects(early.resolveMode());assert.equal(earlyCalls,0);
  const gate=deferred(),entered=deferred();let calls=0,activeSignal;
  const {value,abort}=session(t,{kind:'fresh'},async(_path,init)=>{calls++;activeSignal=init.signal;entered.resolve();return gate.promise;});
  const pending=value.resolveMode(),rejected=assert.rejects(pending);await entered.promise;abort.abort();await rejected;
  assert.equal(value.signal.aborted,true);assert.equal(activeSignal.aborted,true);assert.equal(value.mode,null);
  const late=lateBody(descriptor({kind:'fresh'}));gate.resolve(late.response);await late.cancelled;assert.equal(late.count(),1);
  await assert.rejects(value.openSponsor());await assert.rejects(value.resolveMode());assert.equal(calls,1);
});

test('fresh sponsor session composes actual intake runtime and separate explicit confirmation without auto-I/O',async t=>{
  const f=await wireFixture(),{value}=session(t,f.selector,f.send);
  await value.resolveMode();const opened=await value.openSponsor();assert.strictEqual(opened.runtime,value.runtime);assert.strictEqual(opened.bootstrap,value.bootstrap);
  assert.deepEqual(opened.bootstrap,f.bootstrap);assert.strictEqual(await value.openSponsor(),opened);assert.equal(f.calls.length,2);
  assert.equal(value.signal.aborted,false);assert.equal(value.confirmationState,null);
  await assert.rejects(value.readConfirmation());await assert.rejects(value.confirm({explicitRequirementsConfirmation:true}));assert.equal(f.calls.length,2);
  author(opened.runtime);await opened.runtime.prepare();assert.equal(opened.runtime.state.phase,'review');assert.equal(f.calls.length,3);
  await opened.runtime.submit();assert.equal(opened.runtime.state.phase,'complete');assert.equal(f.calls.length,4);
  assert.deepEqual(opened.runtime.committedPlan,f.plan);assert.deepEqual(opened.runtime.receipt,f.receipt);assert.equal(value.confirmationState,null);
  const read=await value.readConfirmation();assert.equal(read.status,'unconfirmed');assert.equal(value.confirmationState.phase,'ready');assert.equal(f.calls.length,5);
  await assert.rejects(value.confirm({explicitRequirementsConfirmation:false}));assert.equal(f.calls.length,5);
  const confirmed=await value.confirm({explicitRequirementsConfirmation:true});assert.equal(confirmed.status,'confirmed');assert.equal(f.calls.length,6);
  assert.equal(value.confirmationState.confirmation.planRevisionId,uuid(100));assert.strictEqual(value.runtime,opened.runtime);assert.deepEqual(opened.runtime.receipt,f.receipt);
  assert.ok(f.calls.every(call=>call.path===modeRoot||call.path.startsWith(root+'/')));
  assert.ok(f.calls.every(call=>!call.path.endsWith('/run')&&!call.path.endsWith('/prepare')&&!call.path.endsWith('/authorize')));
});

test('retained draft and intent selectors reopen through accepted runtime reads without automatic confirmation',async t=>{
  for(const byIntent of [false,true]){
    const f=await wireFixture({retained:true,byIntent}),{value}=session(t,f.selector,f.send);
    await value.resolveMode();const {runtime}=await value.openSponsor();assert.equal(runtime.state.phase,'complete');assert.equal(f.calls.length,4);
    assert.deepEqual(runtime.committedPlan,f.plan);assert.deepEqual(runtime.receipt,f.receipt);assert.equal(value.confirmationState,null);
    assert.ok(f.calls.every(call=>call.init.method==='GET'));assert.ok(f.calls.every(call=>!call.path.endsWith('/output-confirmation')));
  }
});

test('session lifetime survives bootstrap and later aborts runtime work before accepting late prepared context',{timeout:2000},async t=>{
  const f=await wireFixture(),gate=deferred(),entered=deferred();let activeSignal;
  const {value,abort}=session(t,f.selector,async(path,init)=>{
    const response=await f.send.call(undefined,path,init);
    if(path===root+'/drafts'){activeSignal=init.signal;entered.resolve();return gate.promise;}
    return response;
  });
  await value.resolveMode();const {runtime}=await value.openSponsor();assert.equal(value.signal.aborted,false);author(runtime);
  const preparing=runtime.prepare();await entered.promise;assert.equal(activeSignal.aborted,false);abort.abort();await preparing;
  assert.equal(value.signal.aborted,true);assert.equal(activeSignal.aborted,true);assert.equal(value.runtime,undefined);assert.equal(value.bootstrap,undefined);
  const late=lateBody({status:'prepared',plan:f.plan});gate.resolve(late.response);await late.cancelled;assert.equal(late.count(),1);assert.equal(runtime.preparedPlan,undefined);
  const calls=f.calls.length;await runtime.submit();await runtime.prepare();await assert.rejects(value.openSponsor());assert.equal(f.calls.length,calls);
});

test('disposal during bootstrap cancels a late body and never installs its runtime',{timeout:2000},async t=>{
  const f=await wireFixture(),gate=deferred(),entered=deferred();let activeSignal;
  const {value}=session(t,f.selector,async(path,init)=>{
    if(path.startsWith(root+'/bootstrap')){activeSignal=init.signal;entered.resolve();return gate.promise;}return f.send.call(undefined,path,init);
  });
  await value.resolveMode();const pending=value.openSponsor(),rejected=assert.rejects(pending);await entered.promise;value.dispose();await rejected;
  const late=lateBody(f.bootstrap);gate.resolve(late.response);await late.cancelled;
  assert.equal(activeSignal.aborted,true);assert.equal(late.count(),1);assert.equal(value.runtime,undefined);assert.equal(value.bootstrap,undefined);assert.equal(value.confirmationState,null);
});

test('bootstrap actor mismatch refuses sponsor opening without installing an ordinary fallback runtime',async t=>{
  const f=await wireFixture(),{value}=session(t,f.selector,async(path,init)=>{
    const response=await f.send.call(undefined,path,init);return path.startsWith(root+'/bootstrap')?Response.json({...f.bootstrap,actorUserId:'other-actor'}):response;
  });
  await value.resolveMode();await assert.rejects(value.openSponsor());assert.equal(value.runtime,undefined);assert.equal(value.bootstrap,undefined);assert.equal(f.calls.length,2);
});

test('the session applies its bounded response reader to runtime preparation after bootstrap',async t=>{
  const f=await wireFixture();let cancelled=0;
  const {value}=session(t,f.selector,async(path,init)=>{
    const response=await f.send.call(undefined,path,init);
    return path===root+'/drafts'?new Response(new ReadableStream({cancel(){cancelled++;}},{highWaterMark:0}),{headers:{'content-length':'524289'}}):response;
  });
  await value.resolveMode();const {runtime}=await value.openSponsor();author(runtime);await runtime.prepare();
  assert.equal(runtime.state.phase,'uncertain');assert.equal(runtime.preparedPlan,undefined);assert.equal(cancelled,1);assert.equal(f.calls.length,3);
  assert.ok(runtime.state.issues.some(issue=>issue.code==='sponsor_image_host_response_invalid'));
  assert.equal(value.confirmationState,null);assert.equal(value.signal.aborted,false);
});

test('concurrent mode and bootstrap calls refuse overlap while preserving the first and later exact cache',async t=>{
  const f=await wireFixture(),modeGate=deferred(),modeEntered=deferred(),openGate=deferred(),openEntered=deferred();
  const {value}=session(t,f.selector,async(path,init)=>{
    const response=await f.send.call(undefined,path,init);
    if(path===modeRoot){modeEntered.resolve();await modeGate.promise;}
    if(path===root+'/bootstrap'){openEntered.resolve();await openGate.promise;}
    return response;
  });
  const first=value.resolveMode();await modeEntered.promise;assert.equal(value.pending,true);await assert.rejects(value.resolveMode());modeGate.resolve();const mode=await first;
  assert.strictEqual(await value.resolveMode(),mode);const opening=value.openSponsor();await openEntered.promise;await assert.rejects(value.openSponsor());
  assert.equal(value.signal.aborted,false);openGate.resolve();const opened=await opening;assert.strictEqual(await value.openSponsor(),opened);assert.equal(f.calls.length,2);
});

test('session disposal aborts explicit confirmation and rejects a late DTO without retaining its client state',{timeout:2000},async t=>{
  const f=await wireFixture({retained:true}),gate=deferred(),entered=deferred();let activeSignal;
  const {value}=session(t,f.selector,async(path,init)=>{
    const response=await f.send.call(undefined,path,init);
    if(path.endsWith('/output-confirmation')){activeSignal=init.signal;entered.resolve();return gate.promise;}
    return response;
  });
  await value.resolveMode();await value.openSponsor();const pending=value.confirm({explicitRequirementsConfirmation:true}),rejected=assert.rejects(pending);await entered.promise;
  assert.equal(value.pending,true);assert.equal(value.confirmationState.phase,'confirming');value.dispose();await rejected;
  assert.equal(activeSignal.aborted,true);assert.equal(value.confirmationState,null);assert.equal(value.runtime,undefined);assert.equal(value.pending,false);
  const late=lateBody(await f.confirmation());gate.resolve(late.response);await late.cancelled;assert.equal(late.count(),1);
  assert.equal(value.confirmationState,null);const calls=f.calls.length;await assert.rejects(value.confirm({explicitRequirementsConfirmation:true}));assert.equal(f.calls.length,calls);
});

test('runtime body reads remain bounded by the host thirty-second deadline after bootstrap',async t=>{
  const f=await wireFixture(),entered=deferred();let cancelled=0,activeSignal;
  const {value}=session(t,f.selector,async(path,init)=>{
    const response=await f.send.call(undefined,path,init);
    if(path!==root+'/drafts')return response;
    activeSignal=init.signal;
    return new Response(new ReadableStream({pull(){entered.resolve();},cancel(){cancelled++;}},{highWaterMark:0}));
  });
  await value.resolveMode();const {runtime}=await value.openSponsor();author(runtime);
  t.mock.timers.enable({apis:['setTimeout']});
  try{
    const preparing=runtime.prepare();await entered.promise;t.mock.timers.tick(30_000);await preparing;
    assert.equal(runtime.state.phase,'uncertain');assert.equal(runtime.preparedPlan,undefined);assert.equal(cancelled,1);assert.equal(activeSignal.aborted,true);
    assert.equal(value.signal.aborted,false);assert.equal(f.calls.length,3);assert.equal(value.confirmationState,null);
    assert.ok(runtime.state.issues.some(issue=>issue.code==='sponsor_image_host_deadline'));
  }finally{t.mock.timers.reset();}
});

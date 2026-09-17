import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {registerHooks} from 'node:module';
import {routeFixture} from './sponsor-intake-route-fixture.mjs';

// Only this new client module's registration lookup may see a valid newer
// release in the historical-recovery test. Native server and runtime stay real.
const transportUrl=new URL('../src/experiences/sponsor-image-transport.ts',import.meta.url).href;
const intakeUrl=new URL('../src/experiences/intake.ts',import.meta.url).href;
const registrationKey=Symbol.for('forma.sponsor-image-transport.registration');
const registration={release:undefined,calls:0};globalThis[registrationKey]=registration;
const registrationHook=registerHooks({resolve(specifier,context,next){
  if(context.parentURL===transportUrl&&specifier==='./intake.ts')return {url:'forma-sponsor-image-transport:registration',shortCircuit:true};
  return next(specifier,context);
},load(url,context,next){
  if(url!=='forma-sponsor-image-transport:registration')return next(url,context);
  return {format:'module',shortCircuit:true,source:`export * from ${JSON.stringify(intakeUrl)};
    import {registeredExperience as actual} from ${JSON.stringify(intakeUrl)};
    export async function registeredExperience(id){const state=globalThis[Symbol.for('forma.sponsor-image-transport.registration')];state.calls++;return state.release??await actual(id);}`};
}});
const [{createSponsorImageTransport},{createSponsorImageIntakeRoute},{registeredExperience},{compileExperience},{contextCatalog}]=await Promise.all([
  import('../src/experiences/sponsor-image-transport.ts'),import('../worker/experience-sponsor-intake-route.ts'),
  import('../src/experiences/intake.ts'),import('../src/experiences/compiler.ts'),import('../src/experiences/catalog.ts'),
]);
const originalFetch=globalThis.fetch;let networkAttempts=0;
globalThis.fetch=()=>{networkAttempts++;throw Error('No network: injected actual local route only');};
after(()=>{globalThis.fetch=originalFetch;registrationHook.deregister();delete globalThis[registrationKey];assert.equal(networkAttempts,0);});
const base='/api/experiences/sponsor/image';
const config=actor=>({version:1,enabled:true,audience:'canonical-principal',output:'image',...(actor?{expectedActorUserId:actor}:{})});
const signal=()=>new AbortController().signal;
const count=(f,table)=>f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const creative=f=>Object.fromEntries(['private_content','experience_sponsor_intakes','experience_sponsor_resource_receipts','events','event_private_payloads','event_client_receipts']
  .map(table=>[table,f.sqlite.prepare(`SELECT * FROM ${table}`).all()]));
const code=runtime=>runtime.state.issues.map(issue=>issue.code).join(' ');
const author=runtime=>{assert.equal(runtime.change('subject','A copper lamp on a quiet library table'),true);assert.equal(runtime.change('ratio',{width:1,height:1}),true);};
function wireFor(f,{afterResponse,route=createSponsorImageIntakeRoute({...config(),freshCampaignId:f.campaignId})}={}){
  const calls=[],responses=[];
  async function fetcher(path,init){
    assert.equal(this,undefined);assert.ok(init.signal instanceof AbortSignal);assert.equal(init.credentials,'same-origin');
    assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');assert.ok(path.startsWith(base+'/'));assert.ok(['GET','POST'].includes(init.method));
    const body=init.body===undefined?undefined:JSON.parse(init.body);
    if(body)assert.equal(init.headers['content-type'],'application/json');else assert.equal(init.headers,undefined);
    const call={path,init,body};calls.push(call);
    const request=f.httpRequest(init.method,path,body,{signal:init.signal});
    const response=await route(request,f.env);assert.ok(response instanceof Response);
    const entry={call,response,body:await response.clone().json(),consumed:0};responses.push(entry);
    const actualJson=response.json.bind(response);response.json=function(){assert.equal(this,response,'Native Response must be passed through unchanged');entry.consumed++;return actualJson();};
    return afterResponse?afterResponse(entry):response;
  }
  return {fetcher,calls,responses};
}
async function open(t,f,wire=wireFor(f),selector,configuration=config(f.actor)){
  const client=createSponsorImageTransport(configuration,wire.fetcher);assert.ok(client);
  const result=await client.bootstrap(selector,{signal:signal()});t.after(()=>result.runtime.dispose());return {...result,wire,client};
}
async function completed(t,f,wire){const result=await open(t,f,wire);author(result.runtime);await result.runtime.prepare();assert.equal(result.runtime.state.phase,'review',code(result.runtime));await result.runtime.submit();assert.equal(result.runtime.state.phase,'complete',code(result.runtime));return result;}
const bootstrapBody=async()=>({version:1,kind:'sponsor-image-intake',mode:'fresh',actorUserId:'fixture-actor',campaignId:'fixture-campaign',release:await registeredExperience('image'),generation:'unavailable'});

test('inactive configuration never inspects a fetcher and enabled config is closed without global fallback',()=>{
  const noTouch=new Proxy(()=>{}, {get(){throw Error('inactive inspected fetcher');},apply(){throw Error('inactive fetched');}});
  assert.equal(createSponsorImageTransport(undefined,noTouch),null);assert.equal(createSponsorImageTransport({version:1,enabled:false},noTouch),null);
  let getters=0;const accessor=config();Object.defineProperty(accessor,'output',{enumerable:true,get(){getters++;return 'image';}});
  assert.throws(()=>createSponsorImageTransport(config()),/sponsor_image_transport_invalid/u);
  for(const value of [null,{},{...config(),payerUserId:'payer'},{...config(),campaignId:'caller'}, {...config(),output:'video'},
    {...config(),audience:'guest'}, {...config(),expectedActorUserId:''},{...config(),expectedActorUserId:' spaced '},
    {...config(),expectedActorUserId:'actor\u0000'}, {...config(),enabled:false},{version:1,enabled:false,extra:true},accessor]){
    assert.throws(()=>createSponsorImageTransport(value,noTouch),/sponsor_image_transport_invalid/u);
  }
  assert.equal(getters,0);assert.equal(networkAttempts,0);
});

test('actual bootstrap to native review, commit and retained reopen preserves plan, receipt, signal and single Document',async t=>{
  const f=await routeFixture(t),wire=wireFor(f),controller=new AbortController();
  const client=createSponsorImageTransport(config(f.actor),wire.fetcher),session=await client.bootstrap(undefined,{signal:controller.signal});t.after(()=>session.runtime.dispose());
  assert.equal(wire.calls[0].init.signal,controller.signal);assert.equal(session.bootstrap.mode,'fresh');assert.equal(session.bootstrap.generation,'unavailable');
  assert.equal(count(f,'events'),0);assert.equal(count(f,'private_content'),0);author(session.runtime);
  const preparing=session.runtime.prepare();await session.runtime.prepare();await preparing;assert.equal(session.runtime.state.phase,'review',code(session.runtime));
  const plan=session.runtime.preparedPlan;assert.deepEqual(plan,wire.responses[1].body.plan);assert.ok(plan.sponsor_intake);assert.equal(count(f,'events'),0);
  const committing=session.runtime.submit();await session.runtime.submit();await committing;assert.equal(session.runtime.state.phase,'complete',code(session.runtime));
  assert.deepEqual(session.runtime.receipt,wire.responses[2].body);assert.deepEqual(session.runtime.committedPlan,plan);
  assert.deepEqual(session.runtime.receipt.appended.map(({type,payload})=>({type,payload})),plan.events);
  const before=creative(f),reopened=await open(t,f,wire,{draftId:plan.draftId});assert.equal(reopened.bootstrap.mode,'retained');
  assert.equal(reopened.runtime.state.phase,'complete',code(reopened.runtime));assert.deepEqual(reopened.runtime.committedPlan,plan);
  assert.deepEqual(reopened.runtime.receipt,wire.responses.at(-1).body);assert.deepEqual(creative(f),before);
  assert.equal(count(f,'private_content'),1);assert.equal(count(f,'experience_sponsor_intakes'),1);assert.equal(count(f,'experience_sponsor_resource_receipts'),1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='DocumentCreated'").get().n,1);
  assert.deepEqual(wire.calls.map(c=>[c.init.method,c.path]),[['GET',base+'/bootstrap'],['POST',base+'/drafts'],['POST',`${base}/drafts/${plan.draftId}/commit`],
    ['GET',`${base}/bootstrap?draftId=${plan.draftId}`],['GET',`${base}/drafts/${plan.draftId}`],['GET',`${base}/drafts/${plan.draftId}/receipt`]]);
  assert.ok(wire.responses.filter(r=>!r.call.path.includes('/bootstrap')).every(r=>r.consumed===1));
  const operationSignal=wire.calls[1].init.signal;assert.equal(operationSignal,wire.calls[2].init.signal);assert.equal(operationSignal.aborted,false);
  session.runtime.dispose();assert.equal(operationSignal.aborted,true);f.assertNoPaidWork();
});

test('all five commands recover lost write acknowledgments with charged original GET aliases and no duplicate writes',async t=>{
  const f=await routeFixture(t);let lostPrepare=false,lostCommit=false;
  const wire=wireFor(f,{afterResponse(entry){if(entry.call.body?.action==='prepare-sponsored-image-draft'&&!lostPrepare){lostPrepare=true;throw Error('lost_prepare_ack');}
    if(entry.call.body?.action==='commit-sponsored-image-draft'&&!lostCommit){lostCommit=true;throw Error('lost_commit_ack');}return entry.response;}});
  const {runtime}=await open(t,f,wire);author(runtime);await runtime.prepare();assert.equal(runtime.state.phase,'uncertain');
  const plan=wire.responses.at(-1).body.plan;await runtime.recover();assert.deepEqual(runtime.preparedPlan,plan);assert.equal(count(f,'events'),0);
  await runtime.submit();assert.equal(runtime.state.phase,'uncertain');await runtime.recover();assert.equal(runtime.state.phase,'complete',code(runtime));
  const before=creative(f),reopened=await open(t,f,wire,{intentId:plan.request.intentId});assert.equal(reopened.runtime.state.phase,'complete');assert.deepEqual(creative(f),before);
  assert.ok(wire.calls.some(c=>c.path===`${base}/drafts?intentId=${plan.request.intentId}`));
  assert.equal(wire.calls.filter(c=>c.body?.action==='prepare-sponsored-image-draft').length,1);assert.equal(wire.calls.filter(c=>c.body?.action==='commit-sponsored-image-draft').length,1);
  assert.equal(count(f,'experience_sponsor_intake_read_attempts'),wire.calls.length);f.assertNoPaidWork();
});

test('retained original remains readable after generation revocation and changed fresh server campaign',async t=>{
  const f=await routeFixture(t),original=await completed(t,f),plan=original.runtime.committedPlan;
  f.sqlite.prepare('UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms WHERE campaign_id=?').run(f.campaignId);
  const before=creative(f),route=createSponsorImageIntakeRoute({...config(),freshCampaignId:null}),wire=wireFor(f,{route});
  const recovered=await open(t,f,wire,{draftId:plan.draftId});assert.equal(recovered.runtime.state.phase,'complete');assert.deepEqual(recovered.runtime.committedPlan,plan);
  assert.equal(recovered.bootstrap.campaignId,f.campaignId);assert.deepEqual(creative(f),before);assert.ok(wire.calls.every(c=>c.init.method==='GET'));f.assertNoPaidWork();
});

test('fresh server release must equal registration while historical retained release recovers with current admission and no retry',async t=>{
  const f=await routeFixture(t),first=await open(t,f);author(first.runtime);await first.runtime.prepare();const plan=first.runtime.preparedPlan;
  const definition=structuredClone(plan.release.definition);definition.revision++;const compiled=await compileExperience(definition,contextCatalog);assert.equal(compiled.ok,true);
  registration.release=compiled.release;t.after(()=>{registration.release=undefined;});
  const wire=wireFor(f);await assert.rejects(()=>createSponsorImageTransport(config(f.actor),wire.fetcher).bootstrap(undefined,{signal:signal()}),/sponsor_image_transport_invalid/u);
  const retained=await open(t,f,wire,{draftId:plan.draftId});assert.equal(retained.runtime.admissionRelease.releaseHash,compiled.release.releaseHash);
  assert.deepEqual(retained.runtime.release,plan.release);assert.deepEqual(retained.runtime.preparedPlan,plan);assert.equal(retained.runtime.canRetry,false);
  const calls=wire.calls.length,before=creative(f);await retained.runtime.submit();assert.equal(wire.calls.length,calls);assert.match(code(retained.runtime),/experience_release_changed/u);assert.deepEqual(creative(f),before);
  await first.runtime.submit();assert.equal(first.runtime.state.phase,'complete');await retained.runtime.recover();assert.equal(retained.runtime.state.phase,'complete');
  assert.equal(retained.runtime.canRetry,false);assert.deepEqual(retained.runtime.receipt.appended,first.runtime.receipt.appended);f.assertNoPaidWork();
});

test('configuration and selector are captured before awaiting transport, and expected actor never waives native validation',async t=>{
  const f=await routeFixture(t),first=await completed(t,f),plan=first.runtime.committedPlan,wire=wireFor(f);
  let release,entered;const gate=new Promise(resolve=>{release=resolve;}),seen=new Promise(resolve=>{entered=resolve;});
  const configuration=config(f.actor),selected={draftId:plan.draftId},controller=new AbortController(),opts={signal:controller.signal};
  const client=createSponsorImageTransport(configuration,async(path,init)=>{if(path.includes('/bootstrap')){entered();await gate;}return (0,wire.fetcher)(path,init);});
  const pending=client.bootstrap(selected,opts);await seen;configuration.expectedActorUserId='changed';configuration.enabled=false;selected.draftId=`experience-draft-${'a'.repeat(64)}`;opts.signal=signal();release();
  const result=await pending;t.after(()=>result.runtime.dispose());assert.equal(wire.calls[0].init.signal,controller.signal);assert.equal(result.bootstrap.actorUserId,f.actor);assert.equal(result.runtime.draftId,plan.draftId);
  const mismatch=createSponsorImageTransport(config('wrong-actor'),wire.fetcher),before=wire.calls.length;
  await assert.rejects(()=>mismatch.bootstrap({draftId:plan.draftId},{signal:signal()}),/sponsor_image_transport_invalid/u);assert.equal(wire.calls.length,before+1);
  f.assertNoPaidWork();
});

test('malformed selector, missing signal and accessor options fail before fetch',async()=>{
  let calls=0;const client=createSponsorImageTransport(config(),async()=>{calls++;throw Error('must not fetch');});const id=`experience-draft-${'a'.repeat(64)}`;
  for(const selected of [null,{}, {draftId:'bad'},{intentId:'bad'},{draftId:id,intentId:crypto.randomUUID()},{draftId:id,campaignId:'caller'}])await assert.rejects(()=>client.bootstrap(selected,{signal:signal()}));
  let getters=0;const options={get signal(){getters++;return signal();}};
  for(const value of [undefined,{}, {signal:null},{signal:signal(),payer:'x'},options])await assert.rejects(()=>client.bootstrap(undefined,value));
  assert.equal(getters,0);assert.equal(calls,0);
});

test('closed bootstrap refuses extra authority, malformed identity, non-Image, altered release and mode confusion',async()=>{
  const original=await bootstrapBody();const mutations=[v=>{v.payerUserId='payer';},v=>{v.generation='available';},v=>{v.actorUserId='';},v=>{v.actorUserId=' actor';},
    v=>{v.campaignId='../caller?';},v=>{v.kind='other';},v=>{v.version=2;},v=>{v.mode='retained';},v=>{v.release.definition.id='video';},
    v=>{v.release.releaseHash='sha256:'+'0'.repeat(64);},v=>{v.release.copy.extra='forged';},v=>{v.release.output.output='video';}];
  for(const mutate of mutations){const body=structuredClone(original);mutate(body);let calls=0;
    const client=createSponsorImageTransport(config(),async()=>{calls++;return Response.json(body);});await assert.rejects(()=>client.bootstrap(undefined,{signal:signal()}));assert.equal(calls,1);}
});

test('retained bootstrap hash and selector must match the independently validated actual native marked plan',async t=>{
  const f=await routeFixture(t),original=await completed(t,f),plan=original.runtime.committedPlan;
  for(const mutate of [v=>{v.draftHash='sha256:'+'0'.repeat(64);},v=>{v.draftId=`experience-draft-${'a'.repeat(64)}`;}]){
    const wire=wireFor(f,{afterResponse(entry){if(entry.call.path.includes('/bootstrap')){const body=structuredClone(entry.body);mutate(body);return Response.json(body);}return entry.response;}});
    await assert.rejects(()=>createSponsorImageTransport(config(f.actor),wire.fetcher).bootstrap({draftId:plan.draftId},{signal:signal()}));
    assert.ok(wire.calls.every(c=>c.init.method==='GET'));
  }
  const forged=wireFor(f,{afterResponse(entry){if(entry.call.path===`${base}/drafts/${plan.draftId}`){const body=structuredClone(entry.body);delete body.plan.sponsor_intake;return Response.json(body);}return entry.response;}});
  await assert.rejects(()=>createSponsorImageTransport(config(f.actor),forged.fetcher).bootstrap({draftId:plan.draftId},{signal:signal()}));f.assertNoPaidWork();
});

test('redirects and exposed cross-origin or wrong-path responses fail without accepting bootstrap',async()=>{
  const originalLocation=Object.getOwnPropertyDescriptor(globalThis,'location');Object.defineProperty(globalThis,'location',{configurable:true,value:{origin:'https://forma.example'}});
  try{const body=await bootstrapBody();
    for(const fields of [{redirected:true},{url:'https://other.example'+base+'/bootstrap'},{url:'https://forma.example'+base+'/drafts'},
      {url:'https://forma.example'+base+'/bootstrap?campaignId=caller'},{url:'https://forma.example'+base+'/bootstrap#x'}]){
      const response=Response.json(body);for(const [key,value]of Object.entries(fields))Object.defineProperty(response,key,{value});
      await assert.rejects(()=>createSponsorImageTransport(config(),async()=>response).bootstrap(undefined,{signal:signal()}));
    }
    const response=Response.json(body);Object.defineProperty(response,'url',{value:'https://forma.example'+base+'/bootstrap'});
    const accepted=await createSponsorImageTransport(config(),async()=>response).bootstrap(undefined,{signal:signal()});accepted.runtime.dispose();
  }finally{if(originalLocation)Object.defineProperty(globalThis,'location',originalLocation);else delete globalThis.location;}
});

test('bootstrap byte and ready-chunk limits cancel oversized or endless responses',async()=>{
  for(const mode of ['declared','actual','empty']){let pulls=0,cancelled=0;
    const response=new Response(new ReadableStream({pull(controller){pulls++;controller.enqueue(mode==='empty'?new Uint8Array():new Uint8Array(524_289));},cancel(){cancelled++;}}),
      mode==='declared'?{headers:{'content-length':'524289'}}:undefined);
    await assert.rejects(()=>createSponsorImageTransport(config(),async()=>response).bootstrap(undefined,{signal:signal()}));
    assert.ok(pulls<=1026);assert.equal(cancelled,1,mode);
  }
});

test('original caller abort bounds stalled bootstrap body and cancels without awaiting a stalled cancel',async()=>{
  const controller=new AbortController();let pulls=0,cancels=0;
  const response=new Response(new ReadableStream({pull(){pulls++;},cancel(){cancels++;return new Promise(()=>{});}}));
  const pending=createSponsorImageTransport(config(),async(_path,init)=>{assert.equal(init.signal,controller.signal);return response;}).bootstrap(undefined,{signal:controller.signal});
  await new Promise(resolve=>setImmediate(resolve));controller.abort();await assert.rejects(pending,/sponsor_image_transport_cancelled/u);assert.ok(pulls>0);assert.equal(cancels,1);
});

test('finite bootstrap elapsed limit rejects stalled fetch and cancels a late response',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let resolve,cancelled=0;
  const pending=createSponsorImageTransport(config(),()=>new Promise(done=>{resolve=done;})).bootstrap(undefined,{signal:signal()});
  t.mock.timers.tick(30_000);await assert.rejects(pending,/sponsor_image_transport_timeout/u);
  resolve(new Response(new ReadableStream({cancel(){cancelled++;}})));await new Promise(done=>setImmediate(done));assert.equal(cancelled,1);
});

test('abort during retained auto-resume disposes runtime and preserves original operation signal',async t=>{
  const f=await routeFixture(t),original=await completed(t,f),plan=original.runtime.committedPlan,wire=wireFor(f),controller=new AbortController();
  let operationSignal,entered,late,cancelled=0,parsed=0;const gate=new Promise(resolve=>{entered=resolve;});
  const client=createSponsorImageTransport(config(f.actor),async(path,init)=>{if(path===`${base}/drafts/${plan.draftId}`){operationSignal=init.signal;entered();return new Promise(resolve=>{late=resolve;});}return (0,wire.fetcher)(path,init);});
  const pending=client.bootstrap({draftId:plan.draftId},{signal:controller.signal});await gate;assert.equal(operationSignal.aborted,false);controller.abort();
  await assert.rejects(pending,/sponsor_image_transport_cancelled/u);assert.equal(operationSignal.aborted,true);
  const response=new Response(new ReadableStream({cancel(){cancelled++;}}));response.json=()=>{parsed++;throw Error('late response parsed');};late(response);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(cancelled,1);assert.equal(parsed,0);f.assertNoPaidWork();
});


test('non-success bootstrap response cancels its stream without consuming private error data',async()=>{
  let cancelled=0,parsed=0;const response=new Response(new ReadableStream({cancel(){cancelled++;}}),{status:403});
  response.json=()=>{parsed++;throw Error('private error parser');};
  await assert.rejects(()=>createSponsorImageTransport(config(),async()=>response).bootstrap(undefined,{signal:signal()}),/sponsor_image_bootstrap_unavailable/u);
  assert.equal(cancelled,1);assert.equal(parsed,0);
});

test('monotonic elapsed deadline is checked even when ready microtasks delay the timer',async t=>{
  let now=0,cancelled=0;t.mock.method(performance,'now',()=>now);
  const response=new Response(new ReadableStream({pull(controller){now=30_001;controller.enqueue(new Uint8Array());},cancel(){cancelled++;}}));
  await assert.rejects(()=>createSponsorImageTransport(config(),async()=>response).bootstrap(undefined,{signal:signal()}),/sponsor_image_transport_timeout/u);
  assert.equal(cancelled,1);
});


test('synchronous fetch cancellation observes a concurrent rejected transport promise',async()=>{
  const controller=new AbortController();
  await assert.rejects(()=>createSponsorImageTransport(config(),()=>{controller.abort();return Promise.reject(Error('late transport failure'));})
    .bootstrap(undefined,{signal:controller.signal}),/sponsor_image_transport_cancelled/u);
  await new Promise(resolve=>setImmediate(resolve));
});

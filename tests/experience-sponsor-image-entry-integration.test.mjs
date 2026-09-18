import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {confirmationFixture,commitFromEmpty,count,attempts,nativeState,base} from './sponsor-image-confirmation-fixture.mjs';

const [{createSponsorImageConfirmationClient},{createSponsorImageEntryRoute},{default:worker}]=await Promise.all([
  import('../src/experiences/sponsor-image-confirmation-client.ts'),
  import('../worker/experience-sponsor-image-entry.ts'),
  import('../worker/index.ts'),
]);
const originalFetch=globalThis.fetch;let outbound=0;
globalThis.fetch=()=>{outbound++;throw Error('Image entry integration prohibits every network/provider request');};
after(()=>{globalThis.fetch=originalFetch;assert.equal(outbound,0);});
const config=campaignId=>({version:2,enabled:true,audience:'canonical-principal',output:'image',freshCampaignId:campaignId,generation:'disabled'});
const signal=()=>new AbortController().signal;
const confirmationAttempts=f=>attempts(f).filter(row=>row.operation==='image-output-confirmation');

/** Only HTTP plumbing is test-owned. Every returned receipt and confirmation
 * comes from the actual native storage/command functions and selected router. */
async function verifyClientLifecycle(t,f){
  const {plan,receipt}=await commitFromEmpty(t,f),path=`${base}/drafts/${plan.draftId}/output-confirmation`,calls=[];
  const fetcher=async(selected,init)=>{
    assert.equal(selected,path);assert.equal(init.credentials,'same-origin');assert.equal(init.cache,'no-store');
    assert.equal(init.redirect,'error');assert.ok(init.signal instanceof AbortSignal);
    const request=new Request(new URL(selected,'http://localhost'),{...init,headers:{...f.actorHeaders,...init.headers}});
    const response=await f.route(request,f.env);assert.ok(response instanceof Response);
    calls.push({method:init.method,body:init.body,status:response.status});return response;
  };
  const input={version:1,campaignId:f.campaignId,actorUserId:f.actor,plan,receipt};
  const before=nativeState(f),client=await createSponsorImageConfirmationClient(input,fetcher);t.after(()=>client.dispose());
  assert.equal(client.state.phase,'idle');assert.equal(client.pending,false);assert.equal(calls.length,0);
  assert.equal(confirmationAttempts(f).length,0);assert.deepEqual(nativeState(f),before);
  const pending=await client.read({signal:signal()});
  assert.equal(pending.status,'unconfirmed');assert.equal(pending.generation,'unavailable');assert.equal(pending.replayed,true);
  assert.equal(client.state.phase,'ready');assert.deepEqual(client.state.confirmation,pending);assert.equal(client.pending,false);
  assert.deepEqual(nativeState(f),before);assert.equal(count(f,'output_commands'),0);assert.equal(confirmationAttempts(f).length,1);
  const confirmed=await client.confirm({explicitRequirementsConfirmation:true},{signal:signal()});
  assert.equal(confirmed.status,'confirmed');assert.equal(confirmed.generation,'unavailable');assert.equal(confirmed.replayed,false);
  assert.equal(confirmed.binding.documentId,plan.documentId);assert.equal(confirmed.actorUserId,f.actor);assert.equal(confirmed.campaignId,f.campaignId);
  assert.equal(client.state.phase,'ready');assert.deepEqual(client.state.confirmation,confirmed);assert.equal(client.pending,false);
  assert.equal(count(f,'output_commands'),2);assert.equal(count(f,'output_plan_revisions'),1);assert.equal(count(f,'output_plan_targets'),1);
  const commands=f.sqlite.prepare('SELECT action,event_id FROM output_commands ORDER BY action').all();
  assert.deepEqual(commands.map(row=>row.action),['confirm','save']);
  for(const command of commands){
    const event=f.sqlite.prepare('SELECT type FROM events WHERE event_id=?').get(command.event_id);
    assert.equal(event.type,command.action==='save'?'BlockCreated':'OutputPlanConfirmed');
    assert.equal(confirmed.receipts[command.action].eventId,command.event_id);
  }
  const afterConfirmation=nativeState(f);client.dispose();assert.equal(client.state.phase,'disposed');assert.equal(client.state.confirmation,null);
  const reopened=await createSponsorImageConfirmationClient(input,fetcher);t.after(()=>reopened.dispose());
  assert.equal(reopened.state.phase,'idle');assert.equal(calls.length,2);assert.deepEqual(nativeState(f),afterConfirmation);
  const original=await reopened.read({signal:signal()});assert.deepEqual(original,{...confirmed,replayed:true});
  assert.equal(reopened.state.phase,'ready');assert.deepEqual(reopened.state.confirmation,original);assert.equal(reopened.pending,false);
  assert.deepEqual(nativeState(f),afterConfirmation);assert.equal(confirmationAttempts(f).length,3);
  assert.deepEqual(calls.map(call=>call.method),['GET','POST','GET']);assert.ok(calls.every(call=>call.status===200));
  assert.equal(calls[0].body,undefined);assert.equal(calls[2].body,undefined);
  assert.deepEqual(JSON.parse(calls[1].body),{draftHash:plan.draftHash,explicitRequirementsConfirmation:true});
  f.assertNoPaidWork();return {plan,confirmed,calls};
}

test('actual client lifecycle uses fresh reviewed intake then deliberate routed native confirmation and passive same-original reopen',async t=>{
  const f=await confirmationFixture(t);f.route=createSponsorImageEntryRoute(config(f.campaignId));
  const result=await verifyClientLifecycle(t,f);assert.equal(result.calls.length,3);assert.equal(outbound,0);
});

test('actual Worker fetch composes the same enabled V2 controller path without scheduling detached retention or paid work',async t=>{
  const f=await confirmationFixture(t);f.env.FORMA_SPONSOR_IMAGE_ENTRY=config(f.campaignId);let detached=0;
  assert.equal(count(f,'retention_sweep_runs'),0);
  const context={waitUntil(){detached++;throw Error('Sponsor entry must not schedule an unrelated retention sweep');}};
  const responses=[];
  f.route=async(request,env)=>{
    const response=await worker.fetch(request,env,context);responses.push(response);
    assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
    assert.equal(response.headers.get('referrer-policy'),'no-referrer');assert.match(response.headers.get('server-timing'),/^app;dur=/);
    return response;
  };
  await verifyClientLifecycle(t,f);
  assert.equal(detached,0);assert.equal(responses.length,6);assert.ok(responses.every(response=>response.status===200));
  assert.equal(count(f,'retention_sweep_runs'),0);assert.equal(outbound,0);f.assertNoPaidWork();
});

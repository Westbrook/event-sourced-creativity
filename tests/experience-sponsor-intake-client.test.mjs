import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {fixture,requestFor} from './sponsor-initial-intake-fixture.mjs';
const [{createSponsorImageIntakeRuntime},{ExperienceIntakeRuntime},{registeredExperience},{digest,compileExperience},
  {prepareSponsorImageDraft,commitSponsorImageDraft},{contextCatalog}]=await Promise.all([
  import('../src/experiences/sponsor-intake-client.ts'),import('../src/experiences/intake-runtime.ts'),
  import('../src/experiences/intake.ts'),import('../src/experiences/compiler.ts'),import('../worker/experience-sponsor-intake.ts'),import('../src/experiences/catalog.ts'),
]);
const originalFetch=globalThis.fetch;let fetchAttempts=0;
globalThis.fetch=()=>{fetchAttempts++;throw Error('Sponsor client must use its explicit local transport');};
after(()=>{globalThis.fetch=originalFetch;assert.equal(fetchAttempts,0);});
const count=(f,table)=>f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const rows=f=>Object.fromEntries(['private_content','experience_sponsor_resource_receipts','experience_sponsor_intakes',
  'events','event_private_payloads','event_client_receipts','output_execution_grants','document_jobs','budget_reservations','cost_budget_reservations']
  .map(table=>[table,f.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
const options=f=>({version:1,campaignId:f.campaignId,actorUserId:f.actor});
const author=runtime=>{assert.equal(runtime.change('subject','An original copper lamp in a reading room'),true);assert.equal(runtime.change('ratio',{width:1,height:1}),true);};
const noPaid=f=>{for(const table of ['output_execution_grants','document_jobs','budget_reservations','cost_budget_reservations','output_provider_calls'])assert.equal(count(f,table),0,table);assert.equal(f.media.size,0);};
const revoke=f=>f.sqlite.prepare('UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms WHERE campaign_id=?').run(f.campaignId);
const code=runtime=>runtime.state.issues.map(issue=>issue.code).join(' ');
const keys=(value,expected)=>assert.deepEqual(Object.keys(value).sort(),[...expected].sort());

/** A test-only explicitly supplied transport. Writes invoke the actual dormant
 * server composition; reads invoke exact registered native GETs. No route is
 * installed, no provider executes, and no implicit fetch can succeed. */
function transportFor(f,{afterResponse}={}){
  const calls=[],responses=[];
  async function transport(command,{signal}){
    assert.equal(this,undefined,'transport receives no runtime or adapter as its receiver');assert.ok(signal instanceof AbortSignal);
    calls.push({command:structuredClone(command),signal});let response;
    try{
      if(command.action==='prepare-sponsored-image-draft'){
        keys(command,['action','campaignId','request']);response=Response.json(await prepareSponsorImageDraft(requestFor(f,command),f.env));
      }else if(command.action==='commit-sponsored-image-draft'){
        keys(command,['action','campaignId','draftId','draftHash']);response=Response.json(await commitSponsorImageDraft(requestFor(f,command),f.env));
      }else if(command.action==='read-experience-draft'){
        if(Object.hasOwn(command,'draftId')){keys(command,['action','draftId']);response=await f.nativeCall(`drafts/${command.draftId}`);}
        else{keys(command,['action','intentId']);response=await f.nativeCall(`drafts?intentId=${command.intentId}`);}
      }else if(command.action==='read-experience-intake-receipt'){
        keys(command,['action','draftId']);response=await f.nativeCall(`drafts/${command.draftId}/receipt`);
      }else throw Error(`unapproved_client_command:${command.action}`);
    }catch(error){response=Response.json({error:error.code??error.message},{status:403});}
    responses.push({command:structuredClone(command),status:response.status,body:await response.clone().json()});
    return afterResponse?await afterResponse(command,response):response;
  }
  return {transport,calls,responses};
}
async function client(t,f,wire=transportFor(f),configuration=options(f)){
  const release=await registeredExperience('image'),runtime=createSponsorImageIntakeRuntime(release,configuration,wire.transport);
  t.after(()=>runtime.dispose());return {runtime,wire,release};
}
async function complete(t,f){const result=await client(t,f);author(result.runtime);await result.runtime.prepare();assert.equal(result.runtime.state.phase,'review',code(result.runtime));await result.runtime.submit();assert.equal(result.runtime.state.phase,'complete',code(result.runtime));return result;}

test('explicit sponsor client prepares, reviews and commits the exact marked native plan and raw receipt once',async t=>{
  const f=await fixture(t),{runtime,wire}=await client(t,f);assert.equal(count(f,'events'),0);assert.equal(count(f,'private_content'),0);
  author(runtime);await runtime.prepare();assert.equal(runtime.state.phase,'review',code(runtime));assert.ok(runtime.preparedPlan.sponsor_intake);
  assert.deepEqual(runtime.preparedPlan,wire.responses[0].body.plan);assert.equal(runtime.receipt,undefined);assert.equal(count(f,'events'),0);
  const before=rows(f);await runtime.prepare();assert.deepEqual(rows(f),before);assert.equal(wire.calls.length,1);
  const submission=runtime.submit();await runtime.submit();await submission;
  assert.equal(runtime.state.phase,'complete',code(runtime));assert.deepEqual(runtime.receipt,wire.responses[1].body);
  assert.deepEqual(runtime.committedPlan,wire.responses[0].body.plan);assert.equal(runtime.documentRoute,runtime.receipt.documentRoute);
  assert.deepEqual(runtime.receipt.appended.map(event=>({type:event.type,payload:event.payload})),runtime.committedPlan.events);
  assert.equal(count(f,'private_content'),1);assert.equal(count(f,'experience_sponsor_intakes'),1);assert.equal(count(f,'experience_sponsor_resource_receipts'),1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='DocumentCreated'").get().n,1);
  assert.deepEqual(wire.calls.map(call=>call.command.action),['prepare-sponsored-image-draft','commit-sponsored-image-draft']);
  const done=rows(f);await runtime.submit();await runtime.recover();assert.deepEqual(rows(f),done);assert.equal(wire.calls.length,2);noPaid(f);
});

test('ordinary runtime still refuses a genuine server-marked plan without the internal sponsor factory',async t=>{
  const f=await fixture(t),prepared=await prepareSponsorImageDraft(f.prepareRequest(),f.env),release=await registeredExperience('image');let reads=0;
  const runtime=new ExperienceIntakeRuntime(release,async path=>{reads++;return f.nativeCall(path);});t.after(()=>runtime.dispose());
  await runtime.resume(prepared.plan.draftId);assert.equal(runtime.state.phase,'uncertain');assert.match(code(runtime),/experience_result_mismatch/u);
  assert.equal(runtime.preparedPlan,undefined);assert.equal(runtime.receipt,undefined);assert.equal(runtime.documentRoute,undefined);assert.equal(reads,1);noPaid(f);
});

test('lost preparation acknowledgment recovers the original by native GET and requires an explicit later commit',async t=>{
  const f=await fixture(t);let lost=false;
  const wire=transportFor(f,{afterResponse(command,response){if(!lost&&command.action==='prepare-sponsored-image-draft'){lost=true;throw Error('lost_prepare_ack');}return response;}});
  const {runtime}=await client(t,f,wire);author(runtime);await runtime.prepare();assert.equal(runtime.state.phase,'uncertain');assert.match(code(runtime),/lost_prepare_ack/u);
  const intentId=runtime.intentId,original=wire.responses[0].body.plan,before=rows(f);await runtime.recover();
  assert.equal(runtime.state.phase,'uncertain');assert.deepEqual(runtime.preparedPlan,original);assert.equal(runtime.intentId,intentId);assert.deepEqual(rows(f),before);
  assert.deepEqual(wire.calls.map(call=>call.command.action),['prepare-sponsored-image-draft','read-experience-draft','read-experience-intake-receipt']);
  assert.deepEqual(wire.calls[1].command,{action:'read-experience-draft',intentId});assert.equal(count(f,'events'),0);
  await runtime.submit();assert.equal(runtime.state.phase,'complete',code(runtime));assert.equal(count(f,'experience_sponsor_resource_receipts'),1);noPaid(f);
});

test('lost commit acknowledgment recovers one raw native receipt without repeating the write',async t=>{
  const f=await fixture(t);let lost=false;
  const wire=transportFor(f,{afterResponse(command,response){if(!lost&&command.action==='commit-sponsored-image-draft'){lost=true;throw Error('lost_commit_ack');}return response;}});
  const {runtime}=await client(t,f,wire);author(runtime);await runtime.prepare();await runtime.submit();assert.equal(runtime.state.phase,'uncertain');
  const committed=wire.responses.at(-1).body,before=rows(f);await runtime.recover();assert.equal(runtime.state.phase,'complete',code(runtime));assert.deepEqual(rows(f),before);
  assert.equal(runtime.receipt.documentId,committed.documentId);assert.deepEqual(runtime.receipt.appended,committed.appended);assert.deepEqual(runtime.receipt,wire.responses.at(-1).body);
  assert.equal(wire.calls.filter(call=>call.command.action==='commit-sponsored-image-draft').length,1);
  assert.equal(wire.calls.filter(call=>call.command.action==='read-experience-intake-receipt').length,1);noPaid(f);
});

for(const byIntent of [false,true])test(`fresh client resumes completed original by ${byIntent?'intent':'draft'} with two native reads after revocation`,async t=>{
  const f=await fixture(t),original=await complete(t,f),plan=original.runtime.committedPlan;revoke(f);
  f.sqlite.prepare('UPDATE experience_sponsor_campaigns SET enabled=0 WHERE campaign_id=?').run(f.campaignId);
  f.sqlite.prepare('UPDATE experience_sponsor_resource_policies SET enabled=0 WHERE campaign_id=?').run(f.campaignId);
  const before=rows(f),{runtime,wire}=await client(t,f);await runtime.resume(byIntent?plan.request.intentId:plan.draftId,byIntent);
  assert.equal(runtime.state.phase,'complete',code(runtime));assert.deepEqual(runtime.committedPlan,plan);
  assert.deepEqual(runtime.receipt.appended,original.runtime.receipt.appended);assert.deepEqual(rows(f),before);
  assert.deepEqual(wire.calls.map(call=>call.command),[{action:'read-experience-draft',...(byIntent?{intentId:plan.request.intentId}:{draftId:plan.draftId})},
    {action:'read-experience-intake-receipt',draftId:plan.draftId}]);noPaid(f);
});

test('revoked approval refuses a new commit without resetting its retained draft or resource usage',async t=>{
  const f=await fixture(t),{runtime,wire}=await client(t,f);author(runtime);await runtime.prepare();assert.equal(runtime.state.phase,'review');revoke(f);
  const before=rows(f);await runtime.submit();assert.equal(runtime.state.phase,'uncertain');assert.equal(runtime.receipt,undefined);assert.equal(runtime.documentRoute,undefined);
  assert.deepEqual(rows(f),before);assert.equal(count(f,'events'),0);assert.equal(count(f,'experience_sponsor_resource_receipts'),1);
  assert.equal(wire.calls.filter(call=>call.command.action==='commit-sponsored-image-draft').length,1);noPaid(f);
});

test('newer client admission release refuses new work on a retained old plan but still recovers its exact completed receipt',async t=>{
  const f=await fixture(t),first=await client(t,f);author(first.runtime);await first.runtime.prepare();assert.equal(first.runtime.state.phase,'review');
  const plan=first.runtime.preparedPlan,definition=structuredClone(first.release.definition);definition.revision++;
  const compiled=await compileExperience(definition,contextCatalog);assert.equal(compiled.ok,true);assert.notEqual(compiled.release.releaseHash,plan.release.releaseHash);
  const wire=transportFor(f),runtime=createSponsorImageIntakeRuntime(compiled.release,options(f),wire.transport);t.after(()=>runtime.dispose());
  await runtime.resume(plan.draftId);assert.deepEqual(runtime.preparedPlan,plan);assert.equal(runtime.canRetry,false);assert.equal(runtime.state.phase,'uncertain');
  const before=rows(f);await runtime.submit();assert.equal(runtime.state.phase,'uncertain');assert.match(code(runtime),/experience_release_changed/u);
  assert.deepEqual(rows(f),before);assert.equal(wire.calls.length,2);assert.ok(wire.calls.every(call=>call.command.action.startsWith('read-')));
  // The original author completes that same native plan through the still
  // registered server contract. The newer client may only recover this receipt.
  const original=await commitSponsorImageDraft(f.commitRequest(plan),f.env),completed=rows(f);await runtime.recover();
  assert.equal(runtime.state.phase,'complete',code(runtime));assert.equal(runtime.canRetry,false);assert.deepEqual(runtime.committedPlan,plan);
  assert.deepEqual(runtime.receipt.appended,original.appended);assert.deepEqual(rows(f),completed);assert.equal(wire.calls.length,3);
  assert.equal(count(f,'experience_sponsor_resource_receipts'),1);noPaid(f);
});

for(const boundary of ['campaign','actor'])test(`expected ${boundary} identity refuses another genuine marked plan returned by native read`,async t=>{
  const f=await fixture(t),original=await prepareSponsorImageDraft(f.prepareRequest(),f.env),configuration={...options(f),[boundary==='campaign'?'campaignId':'actorUserId']:`different-${boundary}`};
  const before=rows(f),{runtime,wire}=await client(t,f,transportFor(f),configuration);await runtime.resume(original.plan.draftId);
  assert.equal(runtime.state.phase,'uncertain');assert.equal(runtime.preparedPlan,undefined);assert.equal(runtime.receipt,undefined);assert.equal(runtime.documentRoute,undefined);
  assert.equal(wire.calls.length,1);assert.deepEqual(rows(f),before);noPaid(f);
});

test('marked-plan validation refuses missing or forged markers, hash changes, native identity changes and event changes',async t=>{
  const f=await fixture(t),original=await prepareSponsorImageDraft(f.prepareRequest(),f.env),before=rows(f);
  const mutations={
    missing_marker:plan=>{delete plan.sponsor_intake;},
    marker_version:plan=>{plan.sponsor_intake.version=2;},
    marker_receipt:plan=>{plan.sponsor_intake.receiptId=`sponsor-intake-${'0'.repeat(64)}`;},
    marker_extra:plan=>{plan.sponsor_intake.payerUserId=f.payer;},
    native_project:plan=>{plan.projectId=crypto.randomUUID();for(const event of plan.events)if(Object.hasOwn(event.payload,'project_id'))event.payload.project_id=plan.projectId;},
    native_document:plan=>{plan.documentId=crypto.randomUUID();for(const event of plan.events)if(Object.hasOwn(event.payload,'document_id'))event.payload.document_id=plan.documentId;},
    native_event:plan=>{plan.events[1].payload.title='Changed native event';},
    reference:plan=>{plan.request.reference={sourceBlockId:'not-text-only'};},
    plan_reference_null:plan=>{plan.reference=null;},
    request_reference_null:plan=>{plan.request.reference=null;},
  };
  for(const [name,mutation]of Object.entries(mutations)){
    const changed=structuredClone(original.plan);mutation(changed);const {draftHash:ignored,...base}=changed;void ignored;changed.draftHash=await digest(base);
    const wire=transportFor(f,{afterResponse(command,response){return command.action==='read-experience-draft'?Response.json({status:'prepared',plan:changed,expiresAt:original.expiresAt}):response;}});
    const {runtime}=await client(t,f,wire);await runtime.resume(original.plan.draftId);assert.equal(runtime.state.phase,'uncertain',name);
    assert.equal(runtime.preparedPlan,undefined,name);assert.equal(runtime.receipt,undefined,name);assert.equal(wire.calls.length,1,name);
  }
  const changed={...structuredClone(original.plan),draftHash:`sha256:${'0'.repeat(64)}`};
  const {runtime}=await client(t,f,transportFor(f,{afterResponse(command,response){return command.action==='read-experience-draft'?Response.json({plan:changed}):response;}}));
  await runtime.resume(original.plan.draftId);assert.equal(runtime.preparedPlan,undefined);assert.deepEqual(rows(f),before);noPaid(f);
});

test('raw native receipt validation still refuses changed identity, event provenance and event contents',async t=>{
  const f=await fixture(t),original=await complete(t,f),plan=original.runtime.committedPlan,before=rows(f);
  const mutations={document:receipt=>{receipt.documentId='other-document';},event_actor:receipt=>{receipt.appended[0].actor='worker';},
    event_payload:receipt=>{receipt.appended[1].payload.title='Changed retained title';},duplicate_event:receipt=>{receipt.appended[1].eventId=receipt.appended[0].eventId;},
    event_hash:receipt=>{receipt.draftHash=`sha256:${'0'.repeat(64)}`;}};
  for(const [name,mutate]of Object.entries(mutations)){
    const wire=transportFor(f,{async afterResponse(command,response){if(command.action!=='read-experience-intake-receipt')return response;const body=await response.json();mutate(body);return Response.json(body);}});
    const {runtime}=await client(t,f,wire);await runtime.resume(plan.draftId);assert.equal(runtime.state.phase,'uncertain',name);
    assert.equal(runtime.receipt,undefined,name);assert.equal(runtime.documentRoute,undefined,name);assert.equal(wire.calls.length,2,name);
  }
  assert.deepEqual(rows(f),before);noPaid(f);
});

test('sponsor factory requires explicit transport, closed actor/campaign binding and Image release without fetch fallback',async t=>{
  const f=await fixture(t),release=await registeredExperience('image'),before=rows(f);
  for(const transport of [undefined,null,{}])assert.throws(()=>createSponsorImageIntakeRuntime(release,options(f),transport));
  assert.throws(()=>new ExperienceIntakeRuntime(release,undefined,options(f)),'direct sponsor binding also requires an explicit fetcher');
  for(const configuration of [{...options(f),version:2},{...options(f),actorUserId:''},{...options(f),campaignId:''},{...options(f),payerUserId:f.payer}])
    assert.throws(()=>createSponsorImageIntakeRuntime(release,configuration,transportFor(f).transport));
  const slides=await registeredExperience('slides');assert.throws(()=>createSponsorImageIntakeRuntime(slides,options(f),transportFor(f).transport));
  const {runtime,wire}=await client(t,f);assert.equal(runtime.changeReference({sourceBlockId:'unapproved-reference'},true),false);
  assert.equal(wire.calls.length,0);assert.deepEqual(rows(f),before);noPaid(f);
});

test('duplicate in-flight preparation makes one transport call and disposal aborts delivery without accepting late results',async t=>{
  const f=await fixture(t);let releaseResponse,arrived;
  const ready=new Promise(resolve=>{arrived=resolve;});
  const wire=transportFor(f,{afterResponse(command,response){if(command.action==='prepare-sponsored-image-draft'){arrived();return new Promise(resolve=>{releaseResponse=()=>resolve(response);});}return response;}});
  const {runtime}=await client(t,f,wire);let notifications=0;runtime.subscribe(()=>{notifications++;});author(runtime);
  const pending=runtime.prepare();await ready;await runtime.prepare();assert.equal(wire.calls.length,1);assert.equal(count(f,'private_content'),1);
  const before=rows(f);runtime.dispose();const notificationsBefore=notifications;assert.equal(wire.calls[0].signal.aborted,true);
  releaseResponse();await pending;assert.equal(runtime.preparedPlan,undefined);assert.equal(runtime.receipt,undefined);assert.equal(runtime.documentRoute,undefined);
  await runtime.submit();await runtime.recover();await runtime.prepare();assert.equal(wire.calls.length,1);assert.equal(notifications,notificationsBefore);assert.deepEqual(rows(f),before);noPaid(f);
});

test('factory captures actor and campaign before caller binding changes during the first transport await',async t=>{
  const f=await fixture(t),binding=options(f);let releaseResponse,arrived;
  const ready=new Promise(resolve=>{arrived=resolve;});
  const wire=transportFor(f,{afterResponse(command,response){if(command.action==='prepare-sponsored-image-draft'){arrived();return new Promise(resolve=>{releaseResponse=()=>resolve(response);});}return response;}});
  const {runtime}=await client(t,f,wire,binding);author(runtime);const pending=runtime.prepare();await ready;
  binding.campaignId='caller-mutated-campaign';binding.actorUserId='caller-mutated-actor';binding.version=2;
  releaseResponse();await pending;assert.equal(runtime.state.phase,'review',code(runtime));assert.equal(runtime.preparedPlan.streamId,f.stream);
  await runtime.submit();assert.equal(runtime.state.phase,'complete',code(runtime));assert.equal(runtime.receipt.streamId??runtime.committedPlan.streamId,f.stream);
  assert.ok(wire.calls.every(call=>call.command.campaignId===f.campaignId));assert.equal(count(f,'experience_sponsor_resource_receipts'),1);noPaid(f);
});

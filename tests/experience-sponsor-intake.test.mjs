import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {fixture,nativeRequest,requestFor,installImageTransport} from './sponsor-initial-intake-fixture.mjs';
const [{prepareSponsorImageDraft,commitSponsorImageDraft},{digest,canonicalJson},
  {handleOutputRequirements,loadOutputTrustedContext},{outputDocumentExecutionBridge},{createExperienceOutputRecipe},
  {streamHead,appendAuditEvent},{driveSponsoredImage},{sponsorImageTextSource}]=await Promise.all([
  import('../worker/experience-sponsor-intake.ts'),import('../src/experiences/compiler.ts'),
  import('../worker/output-requirements-api.ts'),import('../worker/output-document-execution.ts'),
  import('../worker/experience-output-recipe.ts'),import('../worker/runtime.ts'),import('../worker/experience-sponsor-driver.ts'),import('../worker/experience-sponsor-image-format.ts'),
]);
const originalFetch=globalThis.fetch;let networkAttempts=0;
globalThis.fetch=()=>{networkAttempts++;throw Error('Sponsored initial intake qualification prohibits network');};
after(()=>{globalThis.fetch=originalFetch;assert.equal(networkAttempts,0);});
const context={waitUntil(){throw Error('Sponsored intake must not detach work');}};
const count=(f,table)=>f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const sponsorTables=f=>f.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'experience_sponsor_%' ORDER BY name").all().map(row=>row.name);
const state=f=>Object.fromEntries([...sponsorTables(f),'private_content','events','event_private_payloads','event_client_receipts',
  'output_commands','output_execution_grants','document_jobs','budget_reservations','cost_budget_reservations','budget_counters','cost_budget_counters']
  .map(table=>[table,f.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
const unpaid=f=>{
  for(const table of ['output_execution_grants','document_jobs','budget_reservations','cost_budget_reservations','output_provider_calls'])assert.equal(count(f,table),0,table);
  assert.equal(f.media.size,0);
};
const draftRows=f=>f.sqlite.prepare("SELECT * FROM private_content WHERE kind='experience-draft' ORDER BY content_id").all();
const revokeApproval=f=>f.sqlite.prepare('UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms WHERE campaign_id=?').run(f.campaignId);
const prepared=f=>prepareSponsorImageDraft(f.prepareRequest(),f.env);
const committed=(f,plan)=>commitSponsorImageDraft(f.commitRequest(plan),f.env);

async function confirmNative(f,plan){
  let sequence=0;
  const send=async body=>{
    const command={documentId:plan.documentId,expectedRevision:`output:${await streamHead(f.env,f.stream)}`,clientMutationId:`intake-native-${++sequence}`,...body};
    const response=await handleOutputRequirements(requestFor(f,command,{path:'/api/output-requirements'}),f.env,'/api/output-requirements',context,outputDocumentExecutionBridge);
    const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;
  };
  const recipe=createExperienceOutputRecipe({output:'image',requirementId:'sponsored-intake-output',deliverableId:'sponsored-intake-image',
    variantId:'sponsored-intake-square',aspectRatio:plan.request.values.ratio.value});
  await send({action:'save',blockId:recipe.spec.id,spec:recipe.spec});
  const result=await send({action:'confirm'});assert.equal(result.snapshot.confirmedPlan.plan.targets.length,1);
  const trusted=await loadOutputTrustedContext(f.commitRequest(plan),f.env,plan.documentId,'request');assert.ok(!(trusted instanceof Response));
  assert.ok(trusted.context.snapshot.facts.some(fact=>fact.type==='subject'&&fact.properties.text===plan.request.values.subject.value));
  return {...result,sourceFacts:structuredClone(trusted.context.snapshot.facts)};
}

test('initial sponsored Image storage starts with no Document, meters exact private bytes and commits native context once',async t=>{
  const f=await fixture(t);assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='DocumentCreated'").get().n,0);
  const first=await prepared(f);assert.equal(first.status,'prepared');assert.equal(first.replayed,false);
  assert.equal(draftRows(f).length,1);assert.equal(count(f,'events'),0);assert.equal(first.plan.streamId,f.stream);
  assert.ok(first.plan.sponsor_intake);const {draftHash,...base}=first.plan;assert.equal(await digest(base),draftHash);
  const receipt=f.sqlite.prepare("SELECT * FROM experience_sponsor_resource_receipts WHERE operation='image-text-draft-storage'").get();assert.ok(receipt);
  assert.equal(receipt.actor_user_id,f.actor);assert.equal(receipt.campaign_id,f.campaignId);
  assert.equal(receipt.text_bytes,new TextEncoder().encode(canonicalJson(first.plan)).byteLength);
  const linkage=f.sqlite.prepare('SELECT * FROM experience_sponsor_intakes').get();assert.equal(linkage.content_digest,await digest(canonicalJson(first.plan)));
  assert.equal(receipt.payload_digest,linkage.content_digest);assert.equal(linkage.draft_hash,first.plan.draftHash);
  assert.equal(JSON.stringify(linkage).includes(first.plan.request.values.subject.value),false,'operational linkage retains no authored creative text');
  const before=state(f),replay=await prepared(f);assert.equal(replay.replayed,true);assert.deepEqual(replay.plan,first.plan);assert.deepEqual(state(f),before);
  const result=await committed(f,first.plan);assert.equal(result.status,'complete');assert.equal(result.documentId,first.plan.documentId);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='DocumentCreated'").get().n,1);
  assert.equal(count(f,'event_client_receipts'),first.plan.events.length);
  const committedState=state(f),again=await committed(f,first.plan);assert.equal(again.status,'complete');assert.equal(again.replayed,true);assert.deepEqual(state(f),committedState);
  await confirmNative(f,first.plan);unpaid(f);
});

test('public draft read retains sponsored custody but public commit cannot bypass the typed sponsor boundary',async t=>{
  const other='fixture-intake-other-reader',f=await fixture(t,{extraActorUserIds:[other]}),first=await prepared(f),before=state(f);
  const read=await f.nativeCall(`drafts/${first.plan.draftId}`);assert.equal(read.status,200);assert.deepEqual((await read.json()).plan,first.plan);
  const denied=await f.nativeCall(`drafts/${first.plan.draftId}/commit`,'POST',{draftHash:first.plan.draftHash});assert.equal(denied.status,403);
  const otherRead=await f.nativeCall(`drafts/${first.plan.draftId}`,'GET',undefined,f.headersFor(other));assert.equal(otherRead.status,404);
  await assert.rejects(commitSponsorImageDraft(requestFor(f,{action:'commit-sponsored-image-draft',campaignId:f.campaignId,
    draftId:first.plan.draftId,draftHash:first.plan.draftHash},{actorUserId:other}),f.env));
  assert.deepEqual(state(f),before);assert.equal(count(f,'events'),0);unpaid(f);
});

test('an existing resource v1 payer approval does not authorize new initial draft storage',async t=>{
  const f=await fixture(t,{approved:false});f.proposal.policy.resources.version=1;delete f.proposal.policy.resources.allowedOperations;await f.approve();
  const before=state(f);await assert.rejects(prepared(f),/sponsor_initial_intake_not_approved/u);assert.deepEqual(state(f),before);
  assert.equal(draftRows(f).length,0);assert.equal(count(f,'events'),0);unpaid(f);
});

test('one continuous original Image starts at empty custody and reaches sponsor-settled native output through saved context',async t=>{
  const transport=installImageTransport(t),f=await fixture(t);assert.equal(count(f,'events'),0);assert.equal(draftRows(f).length,0);
  const first=await prepared(f);await committed(f,first.plan);const confirmed=await confirmNative(f,first.plan);
  const command={action:'run-sponsored-image',campaignId:f.campaignId,documentId:first.plan.documentId,
    planRevisionId:confirmed.command.planRevisionId,targetId:confirmed.snapshot.confirmedPlan.plan.targets[0].id,intentKey:'intake-original-image'};
  const result=await driveSponsoredImage(requestFor(f,command),f.env,context);assert.equal(result.status,'completed');
  assert.deepEqual(transport.counts(),{plannerCalls:1,imageCalls:1,safetyCalls:1});
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='DocumentCreated'").get().n,1);
  assert.equal(count(f,'document_jobs'),1);assert.equal(count(f,'experience_sponsor_grants'),1);assert.equal(count(f,'experience_sponsor_consumptions'),1);
  assert.equal(count(f,'experience_sponsor_intakes'),1);assert.equal(count(f,'experience_sponsor_active_jobs'),0);
  assert.deepEqual(f.sqlite.prepare('SELECT operation FROM experience_sponsor_resource_receipts ORDER BY rowid').all().map(row=>row.operation),
    ['image-text-draft-storage','text-intake','preflight','issuance']);
  const job=f.sqlite.prepare('SELECT * FROM document_jobs').get();assert.equal(job.owner_id,f.actor);assert.equal(job.document_id,first.plan.documentId);assert.equal(job.status,'completed');
  for(const table of ['budget_reservations','cost_budget_reservations']){
    const rows=f.sqlite.prepare(`SELECT owner_id,status FROM ${table}`).all();assert.deepEqual(rows.map(row=>({...row})),[{owner_id:f.payer,status:'settled'}]);
  }
  const cost=f.sqlite.prepare('SELECT used_microusd FROM cost_budget_reservations').get().used_microusd;
  assert.equal(cost,f.sqlite.prepare('SELECT SUM(used_microusd) AS n FROM output_provider_calls').get().n);assert.ok(f.media.size>0);
  assert.ok([...f.media.values()].every(item=>item.metadata.ownerId===f.actor));
  const before=state(f),replay=await driveSponsoredImage(requestFor(f,command),f.env,context);
  assert.equal(replay.jobId,result.jobId);assert.equal(replay.replayed,true);assert.deepEqual(state(f),before);
  assert.deepEqual(transport.counts(),{plannerCalls:1,imageCalls:1,safetyCalls:1});
});

test('canonical Image format facts accept exact registered values and refuse release, binding, handle or provider overrides',async t=>{
  const f=await fixture(t),first=await prepared(f);await committed(f,first.plan);const confirmed=await confirmNative(f,first.plan),facts=confirmed.sourceFacts,before=state(f);
  assert.equal(facts.filter(fact=>fact.type==='format').length,2);assert.equal(await sponsorImageTextSource(facts),true);
  const mutations={
    release:fact=>{fact.properties.experience_release=`sha256:${'0'.repeat(64)}`;},
    binding:fact=>{fact.properties.experience_binding='other';},
    handle:fact=>{fact.handle='format/unrelated';},
    provider:fact=>{fact.properties.provider='fal';},
    model:fact=>{fact.properties.model='other-image-model';},
    size:fact=>{fact.properties.size='2048x2048';},
    image_format:fact=>{fact.properties.image_format.dimensions.width=2048;},
  };
  for(const [name,mutate]of Object.entries(mutations)){
    const changed=structuredClone(facts);mutate(changed.find(fact=>fact.handle==='format/experience-ratio'));
    assert.equal(await sponsorImageTextSource(changed),false,name);
  }
  assert.deepEqual(state(f),before);unpaid(f);
});

test('actual authored ratio outside the approved square template stops before issuance and provider work',async t=>{
  const f=await fixture(t);f.nativeRequest=await nativeRequest({ratio:{width:16,height:9}});
  const first=await prepared(f);await committed(f,first.plan);const confirmed=await confirmNative(f,first.plan);
  const command={action:'run-sponsored-image',campaignId:f.campaignId,documentId:first.plan.documentId,
    planRevisionId:confirmed.command.planRevisionId,targetId:confirmed.snapshot.confirmedPlan.plan.targets[0].id,intentKey:'unapproved-landscape'};
  await assert.rejects(driveSponsoredImage(requestFor(f,command),f.env,context),/sponsor_campaign_template_mismatch/u);
  assert.equal(count(f,'experience_sponsor_grants'),0);assert.equal(count(f,'experience_sponsor_consumptions'),0);unpaid(f);
});

test('an actual reference context fact remains unsupported before sponsor driver resource or provider work',async t=>{
  const f=await fixture(t),first=await prepared(f);await committed(f,first.plan);
  await appendAuditEvent(f.env,f.stream,'user','ReferenceIngested',{project_id:first.plan.projectId,document_id:first.plan.documentId,
    reference_id:'fixture-owned-reference',source_type:'text',source_ref:'fixture://synthetic-owned-context',content_hash:'fixture-owned-text',rights_class:'owned'});
  await appendAuditEvent(f.env,f.stream,'user','BlockCreated',{project_id:first.plan.projectId,document_id:first.plan.documentId,
    block_id:'unsupported-intake-reference',type:'reference',handle:'reference/fixture',position:'z0080',
    properties:{reference_id:'fixture-owned-reference',text:'An owned reference is outside this text-only campaign'}});
  const confirmed=await confirmNative(f,first.plan),before=state(f);
  assert.ok(confirmed.sourceFacts.some(fact=>fact.type==='reference'));
  const command={action:'run-sponsored-image',campaignId:f.campaignId,documentId:first.plan.documentId,
    planRevisionId:confirmed.command.planRevisionId,targetId:confirmed.snapshot.confirmedPlan.plan.targets[0].id,intentKey:'unsupported-reference'};
  await assert.rejects(driveSponsoredImage(requestFor(f,command),f.env,context),/sponsor_driver_text_source_required/u);
  assert.deepEqual(state(f),before);assert.equal(count(f,'experience_sponsor_grants'),0);unpaid(f);
});

test('ordinary native draft remains ordinary and cannot be backfilled as sponsored under its original intent',async t=>{
  const f=await fixture(t),ordinary=await f.nativeCall('drafts','POST',f.nativeRequest);assert.equal(ordinary.status,200);
  const plan=(await ordinary.json()).plan;assert.equal(Object.hasOwn(plan,'sponsor_intake'),false);
  const before=state(f);await assert.rejects(prepared(f));assert.deepEqual(state(f),before);assert.equal(count(f,'experience_sponsor_resource_receipts'),0);
  const result=await f.nativeCall(`drafts/${plan.draftId}/commit`,'POST',{draftHash:plan.draftHash});assert.equal(result.status,200);assert.equal((await result.json()).status,'complete');unpaid(f);
});

test('same actor intent cannot change authored text or switch to a second approved campaign',async t=>{
  const f=await fixture(t),first=await prepared(f);
  const secondProposal=structuredClone(f.proposal);secondProposal.policy.campaignId='second-intake-campaign';
  await f.approve({proposal:secondProposal,approvalId:'approval-second-intake-campaign'});
  const before=state(f),changed=structuredClone(f.nativeRequest);changed.values.subject.value='A changed source under the same intent';
  await assert.rejects(prepareSponsorImageDraft(f.prepareRequest(changed),f.env));assert.deepEqual(state(f),before);
  await assert.rejects(prepareSponsorImageDraft(f.prepareRequest(f.nativeRequest,secondProposal.policy.campaignId),f.env));assert.deepEqual(state(f),before);
  assert.equal(draftRows(f)[0].content,canonicalJson(first.plan));assert.equal(count(f,'experience_sponsor_resource_receipts'),1);unpaid(f);
});

for(const phase of ['prepare','commit'])test(`lost ${phase} transaction acknowledgment recovers one exact original without extra resource debit`,async t=>{
  const f=await fixture(t),first=phase==='commit'?await prepared(f):null,batch=f.DB.batch.bind(f.DB);let lost=false;
  f.DB.batch=async statements=>{
    const result=await batch(statements),matched=statements.some(statement=>phase==='prepare'?/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+private_content\b/iu.test(statement.sql):statement.sql.includes('INSERT INTO event_client_receipts'));
    if(!lost&&matched){lost=true;throw Error(`lost ${phase} acknowledgment`);}return result;
  };
  const action=()=>phase==='prepare'?prepared(f):committed(f,first.plan);
  let original;try{original=await action();}catch(error){assert.match(error.message,/lost|unconfirmed|unavailable/u);}
  assert.equal(lost,true);const before=state(f),replay=await action();assert.deepEqual(state(f),before);
  assert.equal(replay.status,phase==='prepare'?'prepared':'complete');assert.equal(replay.replayed,true);
  if(original)assert.equal(replay.draftHash??replay.plan.draftHash,original.draftHash??original.plan.draftHash);
  assert.equal(draftRows(f).length,1);assert.equal(count(f,'experience_sponsor_resource_receipts'),1);unpaid(f);
});

for(const phase of ['prepare','commit'])for(const fault of ['actor consent','payer approval'])
test(`${phase} commit-edge ${fault} revocation leaves no partial native mutation`,async t=>{
  const f=await fixture(t),first=phase==='commit'?await prepared(f):null,batch=f.DB.batch.bind(f.DB);let fired=false,atBoundary;
  f.DB.batch=async statements=>{
    const matched=statements.some(statement=>phase==='prepare'?/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+private_content\b/iu.test(statement.sql):statement.sql.includes('INSERT INTO event_client_receipts'));
    if(!fired&&matched){
      if(fault==='actor consent')f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(f.actor);else revokeApproval(f);
      fired=true;atBoundary=state(f);
    }
    return batch(statements);
  };
  await assert.rejects(phase==='prepare'?prepared(f):committed(f,first.plan));assert.equal(fired,true);assert.deepEqual(state(f),atBoundary);
  assert.equal(count(f,'events'),0);assert.equal(draftRows(f).length,phase==='prepare'?0:1);assert.equal(count(f,'experience_sponsor_resource_receipts'),phase==='prepare'?0:1);unpaid(f);
});

for(const table of ['private_content','experience_sponsor_resource_receipts','experience_sponsor_intakes'])
test(`missing ${table} insert aborts the complete initial storage and resource transaction`,async t=>{
  const f=await fixture(t),before=state(f);
  f.sqlite.exec(`CREATE TRIGGER refuse_intake_insert BEFORE INSERT ON ${table} BEGIN SELECT RAISE(IGNORE); END`);
  await assert.rejects(prepared(f));assert.deepEqual(state(f),before);assert.equal(draftRows(f).length,0);assert.equal(count(f,'events'),0);unpaid(f);
});

test('resource policy JSON change at native commit cannot borrow its original digest to bypass reviewed terms',async t=>{
  const f=await fixture(t),first=await prepared(f),batch=f.DB.batch.bind(f.DB);let fired=false,atBoundary;
  f.DB.batch=async statements=>{
    if(!fired&&statements.some(statement=>statement.sql.includes('INSERT INTO event_client_receipts'))){
      f.sqlite.prepare("UPDATE experience_sponsor_resource_policies SET limits_json=json_set(limits_json,'$.maximumOperationTextBytes',65535) WHERE campaign_id=?").run(f.campaignId);
      fired=true;atBoundary=state(f);
    }
    return batch(statements);
  };
  await assert.rejects(committed(f,first.plan));assert.equal(fired,true);assert.deepEqual(state(f),atBoundary);assert.equal(count(f,'events'),0);unpaid(f);
});

test('completed original intake recovery retains actor custody after sponsor revocation and never creates another Document',async t=>{
  const f=await fixture(t),first=await prepared(f),original=await committed(f,first.plan);revokeApproval(f);
  f.sqlite.prepare('UPDATE experience_sponsor_campaigns SET enabled=0 WHERE campaign_id=?').run(f.campaignId);
  f.sqlite.prepare('UPDATE experience_sponsor_resource_policies SET enabled=0 WHERE campaign_id=?').run(f.campaignId);
  const before=state(f),recovered=await committed(f,first.plan);assert.equal(recovered.status,'complete');assert.equal(recovered.replayed,true);
  assert.equal(recovered.documentId,original.documentId);assert.deepEqual(recovered.appended,original.appended);assert.deepEqual(state(f),before);
  const receipt=await f.nativeCall(`drafts/${first.plan.draftId}/receipt`);assert.equal(receipt.status,200);assert.equal((await receipt.json()).status,'complete');
  f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(f.actor);await assert.rejects(committed(f,first.plan));unpaid(f);
});

test('expired retained draft refuses initial native commit despite a current campaign',async t=>{
  const f=await fixture(t),first=await prepared(f);
  f.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id=?").run(first.plan.draftId);
  const before=state(f);await assert.rejects(committed(f,first.plan));assert.deepEqual(state(f),before);assert.equal(count(f,'events'),0);unpaid(f);
});

test('database-clock resource expiry blocks a new context commit while the native draft remains retained',async t=>{
  const f=await fixture(t,{approved:false}),now=f.sqlite.prepare("SELECT CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AS now").get().now;
  f.proposal.policy.resources.expiresAtMs=now+1500;await f.approve();const first=await prepared(f);
  assert.ok(Date.parse(first.expiresAt)>f.policy.resources.expiresAtMs);
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,f.policy.resources.expiresAtMs-Date.now())+25));
  const before=state(f);await assert.rejects(committed(f,first.plan));assert.deepEqual(state(f),before);assert.equal(count(f,'events'),0);unpaid(f);
});

test('reviewed campaign and actor resource caps aggregate different initial draft intents',async t=>{
  const secondActor='sponsor-intake-second-actor',thirdActor='sponsor-intake-third-actor',f=await fixture(t,{approved:false,extraActorUserIds:[secondActor,thirdActor]});
  Object.assign(f.proposal.policy.resources.campaign,{maximumOperations:2,maximumOperationsPerWindow:2});
  Object.assign(f.proposal.policy.resources.actor,{maximumOperations:1,maximumOperationsPerWindow:1});await f.approve();
  await prepared(f);const first=state(f),next=await nativeRequest({subject:'A second original within the same actor'});
  await assert.rejects(prepareSponsorImageDraft(f.prepareRequest(next),f.env));assert.deepEqual(state(f),first);
  const second=await prepareSponsorImageDraft(requestFor(f,{action:'prepare-sponsored-image-draft',campaignId:f.campaignId,request:next},{actorUserId:secondActor}),f.env);
  assert.equal(second.status,'prepared');assert.equal(draftRows(f).length,2);
  const grouped=f.sqlite.prepare('SELECT campaign_id,actor_user_id,COUNT(*) AS n FROM experience_sponsor_resource_receipts GROUP BY campaign_id,actor_user_id').all();
  assert.equal(grouped.length,2);assert.ok(grouped.every(row=>row.campaign_id===f.campaignId&&row.n===1));
  const before=state(f),third=await nativeRequest({subject:'A third original after campaign exhaustion'});
  await assert.rejects(prepareSponsorImageDraft(requestFor(f,{action:'prepare-sponsored-image-draft',campaignId:f.campaignId,request:third},{actorUserId:thirdActor}),f.env));
  assert.deepEqual(state(f),before);assert.equal(count(f,'events'),0);unpaid(f);
});

test('native 50 drafts per day guard includes sponsored storage and permits only exact replay at capacity',async t=>{
  const f=await fixture(t);
  for(let index=0;index<49;index++){
    const response=await f.nativeCall('drafts','POST',await nativeRequest({subject:`Ordinary retained initial draft ${index}`}));
    assert.equal(response.status,200,await response.clone().text());
  }
  const first=await prepared(f);assert.equal(draftRows(f).length,50);const before=state(f);
  const replay=await prepared(f);assert.equal(replay.plan.draftHash,first.plan.draftHash);assert.deepEqual(state(f),before);
  await assert.rejects(prepareSponsorImageDraft(f.prepareRequest(await nativeRequest({subject:'Draft after native daily capacity'})),f.env));
  assert.deepEqual(state(f),before);assert.equal(count(f,'experience_sponsor_resource_receipts'),1);assert.equal(count(f,'events'),0);unpaid(f);
});

test('closed initial POST rejects price, payer, creative events and ordinary GET authority before storage',async t=>{
  const f=await fixture(t),before=state(f),body={action:'prepare-sponsored-image-draft',campaignId:f.campaignId,request:f.nativeRequest};
  for(const extra of [{payerUserId:f.payer},{maximumMicrousd:1},{events:[]},{sponsor_intake:{}},{nowMs:Date.now()}])
    await assert.rejects(prepareSponsorImageDraft(requestFor(f,{...body,...extra}),f.env));
  for(const headers of [{origin:'https://other.invalid'},{'sec-fetch-site':'cross-site'}])
    await assert.rejects(prepareSponsorImageDraft(requestFor(f,body,{headers}),f.env),/sponsor_intake_same_origin_required/u);
  const request=f.prepareRequest();await assert.rejects(prepareSponsorImageDraft(new Request(request.url,{headers:request.headers}),f.env));
  assert.deepEqual(state(f),before);unpaid(f);
});

test('initial streaming body stops at 32 KiB even with false length and an unfinished tail',async t=>{
  const f=await fixture(t),before=state(f);let pulls=0;
  const body=new ReadableStream({pull(controller){pulls++;if(pulls===1)controller.enqueue(new Uint8Array(32769).fill(32));else return new Promise(()=>{});}});
  const initial=f.prepareRequest(),headers=new Headers(initial.headers);headers.set('content-length','1');
  const request=new Request(initial.url,{method:'POST',headers,body,duplex:'half'});t.after(()=>{void request.body.cancel().catch(()=>{});});
  let timer;const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('oversized initial body waited for its unfinished tail')),500);});
  try{await assert.rejects(Promise.race([prepareSponsorImageDraft(request,f.env),timeout]),/sponsor_.*(?:large|limit|invalid)/u);}finally{clearTimeout(timer);}
  assert.ok(pulls<=2);assert.deepEqual(state(f),before);unpaid(f);
});

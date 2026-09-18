import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';

// Opt in only after independent source review. A skipped test does not import
// production modules, build the fixture, load Miniflare or start a database.
const enabled=process.env.FORMA_RUN_SCENE_DRIVER_D1==='1';
const nativeBase='1167bc48edd1b9a40a618d851d2a70344c7087be';
const metadataSqlSha='87984dc31fc80df29511e79e97c2d1f59ce7e1c5324781951a3cb486f96d1a41';
const fontPath='/fonts/dm-mono/DMMono-Regular-55b4c98f.ttf';
const nativePins=Object.freeze({
  'worker/experience-sponsor-scene-run-evidence.ts':'c96d93c6a6e62265d3a50eb23cee21a4bca5754b0147bd5acf0ef53f6df145fb',
  'worker/experience-sponsor-scene-paid-claim.ts':'49c787c51a0591283472af5bf5da409e241853639a1eec41d3efbb958a890b99',
  'worker/output-scene-sponsored-handoff.ts':'253a9b1f9b2854fa5031a0637801f3d69059783de3d5b24fcb90dfb46e574426',
  'worker/scene-job-source-witness.ts':'a354d7af1157cafa458265bf4f4cee58470cc7a5b17a6ee463d14715f746a826',
  'worker/scene-source-generation.ts':'483e6bbba43d9df372490ce0baf1c4dc2d22aa282581a9ba46c4bf29c7e938c5',
  'worker/output-requirements-api.ts':'a6eaa709f5f7845133bbf60b113b9b1b0ffc96a5f2ec582ee38f7b557a3f33d9',
  'worker/document-jobs-api.ts':'3cddf7edf31cb9bc8d0b7e1ff059a6aa41e12bd05d7fccfb9f40e052aecc8bfe',
  'worker/experience-sponsor-approval.ts':'ccdab7f97a7797e974b0bf77062f30d5647b1c3951864506c8264b3ed21dd74f',
  'worker/experience-sponsor-admission.ts':'9ec6499a55da883702f272868133986447c48e39d63d177e287e8b22655382aa',
  'worker/experience-sponsor-execution.ts':'b4220c015d3005e560e5555032a3b81ff382e0ba395914d6b0e9af1c8c0f825f',
  'worker/experience-sponsor-resources.ts':'7e6faadac2f9c0c591e11d181ae8bc8c228a74932d9bbd4ce7f2043d4784cde3',
  'tests/helpers/d1-expression-depth.mjs':'50782c3f194e9f51370380b388de8cea1280ca7e8c330c83d0b721c1eff154f0',
  'tests/helpers/model3d-workerd-snapshot.mjs':'ebd914e8ea0e48d3f285514bf94817e4a2fb43f2b1abc223fed624cb08a36eda',
  'tests/sponsor-scene-native-fixture.mjs':'07db4cb5093d1e9050215d362dd6fe0ea790415c429cb24b157b907ba892ffa0',
});
const sourceFiles=[...Object.keys(nativePins),'worker/experience-sponsor-scene-issuer.ts',
  'worker/experience-sponsor-scene-driver.ts','tests/sponsor-scene-driver-fixture.mjs',
  'tests/experience-sponsor-scene-driver-d1.test.mjs'];
const sha=value=>createHash('sha256').update(value).digest('hex');
const sourcePins=async()=>Object.fromEntries(await Promise.all(sourceFiles.map(async path=>
  [path,sha(await readFile(new URL(`../${path}`,import.meta.url)))])));
const all=async(db,sql,...bindings)=>(await db.prepare(sql).bind(...bindings).all()).results;
const count=async(db,table)=>(await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n;
const initiallyEmpty=['output_preflights','output_execution_grants','output_operation_slots','output_operation_routes',
  'document_jobs','budget_reservations','cost_budget_reservations','output_provider_calls','experience_sponsor_grants',
  'experience_sponsor_issuances','experience_sponsor_driver_intents','experience_sponsor_driver_stages',
  'experience_sponsor_resource_receipts','experience_sponsor_consumptions','experience_sponsor_active_jobs',
  'experience_sponsor_assertions','output_atomic_assertions'];
const notIssued=['experience_sponsor_grants','experience_sponsor_issuances','output_execution_grants',
  'output_operation_slots','output_operation_routes','document_jobs','budget_reservations','cost_budget_reservations',
  'output_provider_calls','experience_sponsor_consumptions','experience_sponsor_active_jobs'];

function tracedDatabase(db,trace){
  const originals=new WeakMap();
  const capture=(sql,bindings)=>{
    assert.ok(bindings.length<=100,`D1 parameter limit exceeded: ${bindings.length}`);
    assert.ok(Buffer.byteLength(sql)<=100_000,`D1 SQL byte limit exceeded: ${Buffer.byteLength(sql)}`);
    return {sql,bindings:[...bindings]};
  };
  const wrap=(sql,bindings=[])=>{
    const original=db.prepare(sql).bind(...bindings),statement={bind:(...values)=>wrap(sql,values)};
    for(const method of ['first','all','run'])statement[method]=async(...args)=>{
      const entry={kind:method,...capture(sql,bindings)};trace.push(entry);
      try{return await original[method](...args);}catch(error){entry.failure=String(error);throw error;}
    };
    originals.set(statement,{original,sql,bindings});return statement;
  };
  const wrapped={prepare:sql=>wrap(sql),rewriteBatch:null,afterBatch:null,batch:async statements=>{
    const values=statements.map(statement=>{const value=originals.get(statement);assert.ok(value);return value;});
    const entry={kind:'batch',statements:values.map(({sql,bindings})=>capture(sql,bindings))};trace.push(entry);
    let submitted=values.map(value=>value.original);
    if(wrapped.rewriteBatch){
      const rewritten=await wrapped.rewriteBatch(entry.statements);
      if(rewritten){
        entry.originalStatements=entry.statements;entry.statements=rewritten.map(({sql,bindings})=>capture(sql,bindings));
        // Use the current prepare wrapper so even test-injected UPDATEs pass
        // the strict compiler; execute their original statements on actual D1.
        submitted=entry.statements.map(({sql,bindings})=>{
          const statement=wrapped.prepare(sql).bind(...bindings),value=originals.get(statement);assert.ok(value);return value.original;
        });
      }
    }
    let result;
    try{result=await db.batch(submitted);entry.committed=true;}
    catch(error){entry.failure=String(error);throw error;}
    try{if(wrapped.afterBatch)await wrapped.afterBatch(entry);}
    catch(error){entry.acknowledgmentFailure=String(error);throw error;}
    return result;
  }};
  return wrapped;
}

test('gated two-call Scene controller settles one original on local workerd D1, with replay, atomic refusal and source-change controls',
  {skip:!enabled,timeout:240_000},async t=>{
  // These are the accepted native bytes, not reconstructed or patched native
  // helpers. Check them before importing any fixture or production module.
  const beforeSources=await sourcePins();
  for(const [path,expected] of Object.entries(nativePins))assert.equal(beforeSources[path],expected,`${path} differs from native base ${nativeBase}`);
  // Fixture evaluation installs the existing native source-import hooks before
  // the controller can load; those imports are dependent, not parallel work.
  const {fixture,transport,strictSceneSql,actor,payer,stream,handleEvents,post}=await import('./sponsor-scene-driver-fixture.mjs');
  const [{prepareSponsoredSceneDriver,driveSponsoredScene},
    {inheritRuntimeSchemaReadiness,streamHead},
    {exportSynthetic,install,rowsSnapshot}]=await Promise.all([
    import('../worker/experience-sponsor-scene-driver.ts'),
    import('../worker/runtime.ts'),import('./helpers/model3d-workerd-snapshot.mjs'),
  ]);
  const {Miniflare,Log,LogLevel}=createRequire(import.meta.resolve('wrangler'))('miniflare');
  const originalFetch=globalThis.fetch,calls=transport(t),syntheticFetch=globalThis.fetch,wire=[];
  let outbound=0,detached=0;
  t.mock.method(globalThis,'fetch',(...args)=>{
    const input=args[0],options=args[1],url=new URL(input instanceof Request?input.url:String(input));
    if(['localhost','127.0.0.1','[::1]'].includes(url.hostname))return originalFetch(input,{...options,redirect:'error'});
    if(url.href==='https://api.openai.com/v1/responses'){
      assert.equal(options?.method,'POST');assert.equal(typeof options.body,'string');
      wire.push({body:options.body,clientRequestId:new Headers(options.headers).get('X-Client-Request-Id')});
      return syntheticFetch(...args);
    }
    outbound++;throw Error('network_forbidden');
  });
  const foreground={waitUntil(){detached++;throw Error('No detached Scene D1 work');}};
  const media=[],assets=[],traces={DB:[],DENIAL_DB:[],SOURCE_DB:[]},states=[],witnesses=[];
  const evidencePath=`/private/tmp/forma-sponsor-scene-driver-d1-evidence-${Date.now()}.json`;
  let mf;
  try{
    for(const [binding,campaignId,intakeIntentId] of [
      ['DB','fixture-scene-driver-d1-positive','00000000-0000-4000-8000-000000000091'],
      ['DENIAL_DB','fixture-scene-driver-d1-denial','00000000-0000-4000-8000-000000000092'],
      ['SOURCE_DB','fixture-scene-driver-d1-source','00000000-0000-4000-8000-000000000093'],
    ]){
      const f=await fixture(t,{campaignId,intakeIntentId,strict:false});
      for(const method of ['get','head','put','delete','list'])f.env.MEDIA[method]=()=>{media.push({binding,method});throw Error('media_forbidden');};
      const localAsset=f.env.ASSETS.fetch.bind(f.env.ASSETS);
      f.env.ASSETS.fetch=request=>{
        const path=new URL(request.url).pathname;assert.equal(path,fontPath);assets.push({binding,path});return localAsset(request);
      };
      states.push({binding,f,exported:exportSynthetic(f.sqlite),trace:traces[binding]});
    }
    assert.equal(calls.length,0);assert.equal(wire.length,0);assert.deepEqual(assets,[]);
    mf=new Miniflare({modules:true,compatibilityDate:'2026-05-22',host:'127.0.0.1',port:0,
      log:new Log(LogLevel.NONE),d1Databases:['DB','DENIAL_DB','SOURCE_DB'],
      script:'export default {fetch(){return new Response("synthetic Scene issuer/driver local D1 qualification only")}}',
      outboundService(){outbound++;throw Error('network_forbidden');}});
    for(const state of states){
      state.db=await mf.getD1Database(state.binding);await install(state.db,state.exported);
      state.guarded=tracedDatabase(state.db,state.trace);
      inheritRuntimeSchemaReadiness(state.f.env.DB,state.guarded);state.f.env.DB=state.guarded;
      state.limits=strictSceneSql(state.f);
      assert.equal(await count(state.db,'experience_sponsor_approvals'),1);
      for(const table of initiallyEmpty)assert.equal(await count(state.db,table),0,`${state.binding} must start without ${table}`);
    }
    const actorCounters=async db=>Object.fromEntries(await Promise.all(['budget_counters','cost_budget_counters'].map(async name=>
      [name,await all(db,`SELECT * FROM ${name} WHERE scope='user' AND scope_id=? ORDER BY rowid`,actor)])));
    const noIssuance=async db=>{for(const table of notIssued)assert.equal(await count(db,table),0,table);};
    const resources=async state=>all(state.db,'SELECT * FROM experience_sponsor_resource_receipts ORDER BY rowid');
    const preparedState=async(state,prepared)=>{
      assert.equal(await count(state.db,'experience_sponsor_driver_intents'),1);
      assert.equal(await count(state.db,'output_preflights'),1);
      assert.deepEqual((await all(state.db,'SELECT stage FROM experience_sponsor_driver_stages ORDER BY rowid')).map(row=>row.stage),['preflight']);
      const charged=await resources(state);assert.deepEqual(charged.map(row=>row.operation),['text-intake','preflight']);
      for(const row of charged){assert.equal(row.text_bytes,state.f.N);assert.equal(row.intent_key,state.f.command.intentKey);}
      assert.equal(charged.reduce((sum,row)=>sum+row.text_bytes,0),2*state.f.N);
      await noIssuance(state.db);
      const retained=await all(state.db,'SELECT body.private_json FROM output_preflights quote JOIN event_private_payloads body ON body.private_event_id=quote.event_id ORDER BY quote.rowid');
      assert.equal(retained.length,1);const quote=JSON.parse(retained[0].private_json).preflight;
      assert.deepEqual(prepared.preflight,{id:quote.id,termsDigest:quote.termsDigest,maximumMicrousd:quote.maximumMicrousd,expiresAt:quote.expiresAt});
      assert.deepEqual(prepared.sceneCostPreview,quote.targets[0].settings.payload.outputScene.costPreview);
      assert.equal(prepared.policyDigest,state.f.approval.policyDigest);assert.equal(prepared.payerUserId,payer);
      assert.equal(prepared.sceneCostPreview.actorUserId,actor);assert.equal(prepared.sceneCostPreview.documentId,state.f.documentId);
      assert.equal(prepared.sceneCostPreview.version,'scene-mini-app-cost-v1');assert.equal(Object.hasOwn(prepared.sceneCostPreview,'confirmed'),false);
      assert.ok(Buffer.byteLength(JSON.stringify(prepared))<=65536);
    };

    const positive=states[0],{f,db,guarded,exported}=positive,beforeActor=await actorCounters(db);
    const prepared=await prepareSponsoredSceneDriver(f.request(),f.env,foreground);
    await preparedState(positive,prepared);assert.equal(calls.length,0);
    const beforePrepareReplay=await rowsSnapshot(db,exported.tables);
    assert.deepEqual(await prepareSponsoredSceneDriver(f.request(),f.env,foreground),prepared);
    assert.deepEqual(await rowsSnapshot(db,exported.tables),beforePrepareReplay);assert.equal(calls.length,0);
    guarded.afterBatch=async entry=>{
      if(!entry.statements.some(({sql})=>sql.startsWith('UPDATE document_jobs SET scene_source_protocol=1,scene_source_version_json=json_set(')))return;
      const rows=await all(db,'SELECT scene_source_version_json FROM document_jobs WHERE scene_source_version_json IS NOT NULL');
      assert.equal(rows.length,1);witnesses.push(JSON.parse(rows[0].scene_source_version_json));
    };
    // The test actor explicitly confirms exactly the reviewed first response.
    // This helper does not run inside the production prepare call.
    const runBody=await f.runRequest(prepared).json();
    const result=await driveSponsoredScene(f.runRequest(prepared),f.env,foreground);
    assert.deepEqual(Object.keys(result).sort(),['jobId','replayed','status']);
    assert.equal(result.status,'completed');assert.equal(result.replayed,false);
    assert.equal(calls.length,1);assert.equal(wire.length,1);
    for(const table of ['experience_sponsor_driver_intents','output_preflights','experience_sponsor_grants','experience_sponsor_issuances',
      'output_execution_grants','output_operation_slots','document_jobs','experience_sponsor_consumptions','budget_reservations','cost_budget_reservations'])
      assert.equal(await count(db,table),1,table);
    const stages=await all(db,'SELECT stage,command_json FROM experience_sponsor_driver_stages ORDER BY rowid');
    assert.deepEqual(stages.map(row=>row.stage),['preflight','authorize','run']);
    const authorization=JSON.parse(stages[1].command_json),nativeRun=JSON.parse(stages[2].command_json);
    assert.deepEqual(authorization.sceneCostConsent,runBody.sceneCostConsent);assert.equal(authorization.explicitAuthorization,true);
    const charged=await resources(positive);assert.deepEqual(charged.map(row=>row.operation),['text-intake','preflight','issuance']);
    for(const row of charged){assert.equal(row.text_bytes,f.N);assert.equal(row.actor_user_id,actor);assert.equal(row.campaign_id,f.campaignId);}
    assert.equal(charged.reduce((sum,row)=>sum+row.text_bytes,0),3*f.N);
    assert.equal(charged[0].intent_key,f.command.intentKey);assert.equal(charged[1].intent_key,f.command.intentKey);
    assert.equal(charged[2].intent_key,authorization.clientMutationId);
    const intent=await db.prepare('SELECT * FROM experience_sponsor_driver_intents').first();
    assert.deepEqual(JSON.parse(intent.command_json),f.command);assert.equal(intent.source_text_bytes,f.N);
    const issued=await db.prepare('SELECT * FROM experience_sponsor_issuances').first(),envelope=JSON.parse(issued.envelope_json);
    assert.deepEqual(JSON.parse(issued.driver_command_json),runBody);assert.equal(envelope.version,6);
    assert.equal(envelope.family,'canonical-scene-screenplay@1');assert.equal(issued.intent_key,authorization.clientMutationId);
    const grant=await db.prepare('SELECT * FROM output_execution_grants').first(),slot=await db.prepare('SELECT * FROM output_operation_slots').first();
    assert.equal(grant.actor_user_id,actor);assert.equal(grant.payer_user_id,payer);assert.notEqual(actor,payer);assert.equal(grant.maximum_calls,1);
    assert.equal(slot.maximum_calls,1);assert.equal(slot.maximum_tokens,128000);assert.equal(slot.attempt_ordinal,0);
    assert.equal(slot.previous_slot_id,null);assert.equal(slot.status,'succeeded');assert.equal(nativeRun.grantId,grant.grant_id);
    assert.deepEqual(await all(db,'SELECT stage_key,provider,model,maximum_calls FROM output_operation_routes'),
      [{stage_key:'planning:0:initial',provider:'openai',model:'gpt-5.6-terra',maximum_calls:1}]);
    const job=await db.prepare('SELECT * FROM document_jobs').first();
    assert.equal(job.job_id,result.jobId);assert.equal(job.kind,'render_document');assert.equal(job.source_surface,'outputs');
    assert.equal(job.owner_id,actor);assert.equal(job.document_id,f.documentId);assert.equal(job.stream_id,stream);assert.equal(job.status,'completed');
    assert.equal(job.scene_source_protocol,1);assert.ok(job.scene_source_version_json);
    const admissionWitness=witnesses.find(value=>value.phase==='admission'),runWitness=witnesses.find(value=>value.phase==='run');
    assert.ok(admissionWitness);assert.ok(runWitness);assert.deepEqual(runWitness.predecessor,admissionWitness.successor);
    assert.equal(runWitness.jobId,job.job_id);assert.equal(runWitness.slotId,slot.slot_id);assert.equal(runWitness.grantId,grant.grant_id);
    assert.ok(runWitness.successor.streamGeneration>runWitness.predecessor.streamGeneration);
    const providerCalls=await all(db,'SELECT * FROM output_provider_calls');assert.equal(providerCalls.length,1);
    assert.equal(providerCalls[0].stage_key,'planning:0:initial');assert.equal(providerCalls[0].status,'settled');
    assert.equal(providerCalls[0].model,'gpt-5.6-terra');assert.equal(providerCalls[0].client_request_id,wire[0].clientRequestId);
    assert.equal(providerCalls[0].client_request_id,calls[0].clientRequestId);assert.equal(providerCalls[0].request_digest,sha(wire[0].body));
    const tokens=await db.prepare('SELECT * FROM budget_reservations').first(),cost=await db.prepare('SELECT * FROM cost_budget_reservations').first();
    for(const reservation of [tokens,cost]){
      assert.equal(reservation.owner_id,payer);assert.equal(reservation.stream_id,stream);assert.equal(reservation.status,'settled');
      assert.equal(reservation.operation,'document-render:scene');
    }
    assert.equal(tokens.reserved_tokens,128000);assert.equal(tokens.used_tokens,150);assert.ok(cost.used_microusd>0);
    assert.equal(cost.used_microusd,providerCalls[0].used_microusd);assert.equal(cost.allow_user_overage,0);
    assert.equal((await db.prepare("SELECT used_tokens FROM budget_counters WHERE scope='user' AND scope_id=?").bind(payer).first()).used_tokens,150);
    assert.equal((await db.prepare("SELECT used_microusd FROM cost_budget_counters WHERE scope='user' AND scope_id=?").bind(payer).first()).used_microusd,cost.used_microusd);
    for(const [scope,id] of [['user',payer],['workspace','forma']]){
      assert.deepEqual(await all(db,'SELECT reserved_tokens FROM budget_counters WHERE scope=? AND scope_id=?',scope,id),[{reserved_tokens:0}]);
      assert.deepEqual(await all(db,'SELECT reserved_microusd FROM cost_budget_counters WHERE scope=? AND scope_id=?',scope,id),[{reserved_microusd:0}]);
    }
    assert.deepEqual(await actorCounters(db),beforeActor);assert.equal(await count(db,'experience_sponsor_active_jobs'),0);
    const completions=await all(db,"SELECT stream_id,payload FROM events WHERE type='DocumentRenderCompleted'");
    assert.equal(completions.length,1);assert.equal(completions[0].stream_id,stream);
    const completion=JSON.parse(completions[0].payload);assert.equal(completion.artifact_kind,'scene');assert.equal(completion.document_id,f.documentId);
    const retained=await db.prepare("SELECT owner_id,kind,content,redacted_at FROM private_content WHERE content_id=?").bind(completion.content_ref).first();
    const retainedInput=await db.prepare("SELECT owner_id,kind,content,redacted_at FROM private_content WHERE content_id=?").bind(completion.input_ref).first();
    assert.equal(retained.owner_id,actor);assert.equal(retained.kind,'document-artifact');assert.equal(retained.redacted_at,null);
    const artifact=JSON.parse(retained.content);
    assert.deepEqual(Object.keys(artifact).sort(),['content_markdown','items','presentation','scene_screenplay','summary','title']);
    assert.equal(artifact.title,'The door');assert.equal(artifact.summary,'Two intentions meet.');assert.equal(artifact.presentation,null);
    assert.deepEqual(artifact.items,[{title:artifact.title,body:artifact.content_markdown,notes:'',image_prompt:'',context_group_ids:[],slide:null}]);
    assert.deepEqual(artifact.scene_screenplay,{schemaVersion:1,format:'forma-screenplay@1',heading:{setting:'INT.',location:'location',time:'NIGHT'},blocks:[
      {kind:'action',text:'A hand rests against the door.'},{kind:'dialogue',speaker:'A',parenthetical:null,text:'Stay.'},
      {kind:'dialogue',speaker:'B',parenthetical:null,text:'I have to go.'}]});
    assert.equal((await all(db,"SELECT content_id FROM private_content WHERE kind='document-artifact'")).length,1);
    assert.equal(retainedInput.owner_id,actor);assert.equal(retainedInput.kind,'document-artifact-input');assert.equal(retainedInput.redacted_at,null);
    assert.equal(JSON.parse(retainedInput.content).document_id,f.documentId);
    const beforeReplay=await rowsSnapshot(db,exported.tables),witnessCount=witnesses.length;
    assert.deepEqual(await driveSponsoredScene(f.runRequest(prepared),f.env,foreground),{...result,replayed:true});
    assert.deepEqual(await rowsSnapshot(db,exported.tables),beforeReplay);assert.equal(calls.length,1);assert.equal(witnesses.length,witnessCount);

    const denial=states[1],deniedPrepared=await prepareSponsoredSceneDriver(denial.f.request(),denial.f.env,foreground);
    await preparedState(denial,deniedPrepared);
    let withdrawn=false,beforeIssuance,issuanceBatch;
    denial.guarded.rewriteBatch=async statements=>{
      if(!statements.some(entry=>entry.sql.startsWith('INSERT INTO experience_sponsor_issuances(')))return null;
      assert.equal(withdrawn,false,'Only one original issuance may be attempted');
      const indexed=statements.map((entry,index)=>({entry,index}));
      const grants=indexed.filter(({entry})=>entry.sql.startsWith('INSERT INTO experience_sponsor_grants('));
      const issuances=indexed.filter(({entry})=>entry.sql.startsWith('INSERT INTO experience_sponsor_issuances('));
      const authorities=indexed.filter(({entry})=>entry.sql.startsWith('INSERT INTO experience_sponsor_assertions(')
        &&entry.sql.includes('JOIN experience_sponsor_resource_policies resources')&&String(entry.bindings[0]).startsWith('resource:'));
      assert.equal(grants.length,1);assert.equal(issuances.length,1);assert.equal(authorities.length,1);
      const grantIndex=grants[0].index,guardIndex=authorities[0].index;
      assert.equal(guardIndex,grantIndex+1);assert.ok(issuances[0].index>guardIndex);
      const policy=await denial.db.prepare('SELECT enabled FROM experience_sponsor_resource_policies WHERE campaign_id=?').bind(denial.f.campaignId).first();
      assert.equal(policy.enabled,1);beforeIssuance=await rowsSnapshot(denial.db,denial.exported.tables);
      withdrawn=true;issuanceBatch=statements;
      // The original authority CHECK alone sees the withdrawal. Restoration is
      // queued immediately afterward; a later proof cannot substitute for it.
      return [...statements.slice(0,grantIndex+1),
        {sql:'UPDATE experience_sponsor_resource_policies SET enabled=0 WHERE campaign_id=?',bindings:[denial.f.campaignId]},
        statements[guardIndex],
        {sql:'UPDATE experience_sponsor_resource_policies SET enabled=? WHERE campaign_id=?',bindings:[policy.enabled,denial.f.campaignId]},
        ...statements.slice(guardIndex+1)];
    };
    await assert.rejects(driveSponsoredScene(denial.f.runRequest(deniedPrepared),denial.f.env,foreground),/CHECK constraint failed/u);
    assert.equal(withdrawn,true);
    const refused=denial.trace.filter(entry=>entry.originalStatements===issuanceBatch);
    assert.equal(refused.length,1);assert.ok(refused[0].failure?.includes('CHECK constraint failed'));assert.notEqual(refused[0].committed,true);
    assert.deepEqual(await rowsSnapshot(denial.db,denial.exported.tables),beforeIssuance);
    assert.equal((await denial.db.prepare('SELECT enabled FROM experience_sponsor_resource_policies WHERE campaign_id=?').bind(denial.f.campaignId).first()).enabled,1);
    await noIssuance(denial.db);assert.equal(await count(denial.db,'output_preflights'),1);
    assert.deepEqual((await resources(denial)).map(row=>row.operation),['text-intake','preflight']);
    assert.deepEqual((await all(denial.db,'SELECT stage FROM experience_sponsor_driver_stages ORDER BY rowid')).map(row=>row.stage),['preflight','authorize']);

    const source=states[2];let lost=false,committedQuote;
    source.guarded.afterBatch=async entry=>{
      if(lost||!entry.statements.some(({sql})=>sql.startsWith('INSERT INTO output_preflights')))return;
      lost=true;committedQuote=await source.db.prepare('SELECT * FROM output_preflights').first();assert.ok(committedQuote);
      throw Error('Synthetic Scene D1 preflight acknowledgment loss');
    };
    let firstPrepared;
    try{firstPrepared=await prepareSponsoredSceneDriver(source.f.request(),source.f.env,foreground);}
    catch(error){assert.match(String(error),/Synthetic Scene D1 preflight acknowledgment loss/u);}
    assert.equal(lost,true);
    const lostBatches=source.trace.filter(entry=>entry.acknowledgmentFailure?.includes('Synthetic Scene D1 preflight acknowledgment loss'));
    assert.equal(lostBatches.length,1);assert.equal(lostBatches[0].committed,true);
    const sourcePrepared=await prepareSponsoredSceneDriver(source.f.request(),source.f.env,foreground);
    if(firstPrepared)assert.deepEqual(sourcePrepared,firstPrepared);
    await preparedState(source,sourcePrepared);
    assert.deepEqual(await source.db.prepare('SELECT * FROM output_preflights').first(),committedQuote);
    const beforeSourceReplay=await rowsSnapshot(source.db,source.exported.tables);
    assert.deepEqual(await prepareSponsoredSceneDriver(source.f.request(),source.f.env,foreground),sourcePrepared);
    assert.deepEqual(await rowsSnapshot(source.db,source.exported.tables),beforeSourceReplay);
    const authored=source.f.plan.events.find(event=>event.type==='BlockCreated'&&event.payload.block_id===source.f.sourceBlockId);
    assert.equal(typeof authored?.payload.properties?.text,'string','The genuine Scene fixture must retain an authored text block');
    const beforeGeneration=await all(source.db,'SELECT * FROM scene_source_generations ORDER BY rowid');
    const edit={type:'BlockPropertyEdited',payload:{document_id:source.f.documentId,
      project_id:authored.payload.project_id,block_id:authored.payload.block_id,property_path:'text',
      old_value:authored.payload.properties.text,new_value:`${authored.payload.properties.text}\nAn authored Scene source revision.`}};
    const edited=await handleEvents(new Request('http://localhost/api/events',post({action:'append',documentId:source.f.documentId,
      expectedSequence:await streamHead(source.f.env,stream),event:edit},source.f.actorHeaders)),source.f.env);
    const editReceipt=await edited.json();assert.equal(edited.status,200,JSON.stringify(editReceipt));assert.deepEqual(editReceipt.rejected,[]);
    assert.equal(editReceipt.appended.length,1);assert.equal(editReceipt.appended[0].type,edit.type);
    assert.equal(editReceipt.appended[0].payload.block_id,edit.payload.block_id);
    assert.notDeepEqual(await all(source.db,'SELECT * FROM scene_source_generations ORDER BY rowid'),beforeGeneration);
    const afterSourceChange=await rowsSnapshot(source.db,source.exported.tables);
    await assert.rejects(driveSponsoredScene(source.f.runRequest(sourcePrepared),source.f.env,foreground),
      /sponsor_driver_(?:source_changed|intent_changed|source_unsupported|target_unsupported)|output_.*(?:source|plan)|scene_.*(?:source|binding)/u);
    assert.deepEqual(await rowsSnapshot(source.db,source.exported.tables),afterSourceChange);
    await noIssuance(source.db);assert.equal(await count(source.db,'output_preflights'),1);
    const sourceCharges=await resources(source);assert.deepEqual(sourceCharges.map(row=>row.operation),['text-intake','preflight']);
    assert.equal(sourceCharges.reduce((sum,row)=>sum+row.text_bytes,0),2*source.f.N);

    assert.equal(calls.length,1);assert.equal(wire.length,1);assert.equal(outbound,0);assert.equal(detached,0);assert.deepEqual(media,[]);
    assert.ok(assets.every(asset=>asset.path===fontPath));
    for(const state of states){
      state.limits.assertVerified();
      assert.ok(state.limits.records.every(record=>record.queryLimits.functionArguments===32));
      assert.ok(state.limits.nativeRecords.every(record=>sha(record.sql)===metadataSqlSha&&record.queryLimits.functionArguments===56));
      for(const table of ['experience_sponsor_assertions','output_atomic_assertions'])assert.equal(await count(state.db,table),0);
    }
    const afterSources=await sourcePins();assert.deepEqual(afterSources,beforeSources);
    const flattened=Object.values(traces).flat().flatMap(entry=>entry.statements??[entry]);
    const evidence={engine:'pinned Miniflare/workerd D1',applicationExecution:'Node-hosted native production modules against local workerd D1',
      localOnly:true,success:true,nativeBase,nativePins,sourcePinsBefore:beforeSources,sourcePinsAfter:afterSources,
      startingBoundary:'Genuine registered Scene authored intake, native save/confirm and synthetic-payer V6 approval; no preflight, resource, issuance or job',
      actualD1Stages:['prepare intent','resource-owned preflight','explicit actor Scene confirmation','issuance','native admission','Run','foreground settlement','original replay'],
      bindings:states.map(state=>state.binding),schemaObjects:states.map(state=>({binding:state.binding,count:state.exported.schema.length})),
      statementCount:flattened.length,strictCompilerStatements:states.reduce((sum,state)=>sum+state.limits.records.length,0),
      expressionDepthLimit:100,functionArgumentLimitForEveryOtherStatement:32,exactNativeMetadataException:{sha256:metadataSqlSha,functionArguments:56,
        calls:states.reduce((sum,state)=>sum+state.limits.exceptions,0)},parameterLimit:100,sqlByteLimit:100000,
      maximumBindings:Math.max(...flattened.map(entry=>entry.bindings.length)),maximumSqlBytes:Math.max(...flattened.map(entry=>Buffer.byteLength(entry.sql))),
      seededIssuances:0,syntheticResponses:calls.length,actualExternalNetworkRequests:outbound,mediaRequests:media.length,fontAssets:assets,detachedWork:detached,
      semanticOperations:3,semanticTextBytes:3*f.N,actorOwnedRetainedScene:true,payerOnlySettlement:true,exactCapturedWireMatchesDurableLedger:true,
      originalAdmissionRunWitnessLineage:true,prepareReplayUnchanged:true,terminalReplayUnchanged:true,lateIssuanceResourceWithdrawalAtomicRollback:true,
      isolatedOriginalResourceAuthorityCheck:true,resourcePolicyDisableRolledBack:true,lostNativePreflightAcknowledgmentOriginalReceipt:true,
      changedAuthoredSourceRefusedBeforeIssuance:true};
    await writeFile(evidencePath,JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});t.diagnostic(JSON.stringify(evidence));t.diagnostic(`Evidence: ${evidencePath}`);
  }catch(error){
    const failurePath=`/private/tmp/forma-sponsor-scene-driver-d1-failed-trace-${Date.now()}.json`;
    await writeFile(failurePath,JSON.stringify({error:String(error),stack:error?.stack,nativeBase,sourcePinsBefore:beforeSources,traces,witnesses},null,2)+'\n',{flag:'wx'});
    t.diagnostic(`Preserved first failure trace: ${failurePath}`);throw error;
  }finally{
    for(const state of states)state.limits?.restore();
    if(mf)await mf.dispose();
  }
});

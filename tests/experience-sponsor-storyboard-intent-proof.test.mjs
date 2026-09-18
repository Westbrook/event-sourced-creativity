import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {createRequire} from 'node:module';
import {storyboardIntentFixture,authorizeNative,exerciseStoryboardPartialAccounting,addSyntheticExtractedReference,stateSnapshot,forbidWrites,assertNoAdmission,closeFixtureImports,observed,actor,bindingNative,handleExperienceOutput,outputDocumentExecutionBridge} from './sponsor-storyboard-intent-native-fixture.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';
import {exportSynthetic,install,rowsSnapshot} from './helpers/model3d-workerd-snapshot.mjs';
const [{createSponsorStoryboardIntentProof:createProof,readSponsorStoryboardIntentProof:readProof},{outputDigest,outputProofReadStatements},{STORYBOARD_SPONSOR_TRANSFER}]=await Promise.all([
  import('../worker/experience-sponsor-storyboard-intent-proof.ts'),import('../worker/output-disclosure-proof.ts'),import('../worker/experience-sponsor-storyboard-contract.ts'),
]);
after(closeFixtureImports);
const reject=promise=>assert.rejects(promise);

test('actual deliberate POST produces SELECT-only opaque intent matching the complete native authorization envelope',async t=>{
  const f=await storyboardIntentFixture(t),request=f.request(),before=stateSnapshot(f),limits=enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}}),reads=forbidWrites(f);
  let proof,review;try{proof=await createProof(request,f.env);review=await readProof(proof,request,f.env);assert.deepEqual(stateSnapshot(f),before);reads.assert();assertNoAdmission(f);limits.assertVerified();}
  finally{reads.restore();limits.restore();}
  assert.equal(review.version,1);assert.equal(review.kind,'storyboard-actor-intent');assert.equal(review.actorUserId,actor);assert.equal(review.documentId,f.plan.documentId);assert.equal(review.projectId,f.plan.projectId);
  assert.deepEqual(review.command,f.envelope);assert.equal(review.commandDigest,`sha256:${await outputDigest(f.envelope)}`);assert.deepEqual(review.command.experienceBinding,f.binding);
  assert.equal(review.originalRequestId,f.prepared.preflight.targets[0].settings.original.requestId);assert.ok(review.deadlineMs<=Date.parse(f.prepared.preflight.expiresAt));assert.ok(review.deadlineMs>Date.now());
  assert.equal(Object.isFrozen(review.command.experienceBinding),true);assert.equal(review.description.recipe.maximumTokens,224000);assert.deepEqual(review.transfer,STORYBOARD_SPONSOR_TRANSFER);
  const control=await authorizeNative(f);assert.equal(control.retained.request_digest,review.commandDigest.slice(7));assert.equal(control.slot.job_id,review.originalRequestId);
  await reject(readProof(proof,request,f.env));await reject(createProof(f.request(),f.env));
  const counts=stateSnapshot(f).rows.map(([table,rows])=>[table,rows.length]);
  const replay=await handleExperienceOutput(f.request(),f.env,{waitUntil(){throw Error('No execution');}},outputDocumentExecutionBridge);assert.equal(replay.status,200,await replay.clone().text());
  assert.deepEqual(stateSnapshot(f).rows.map(([table,rows])=>[table,rows.length]),counts);
  t.diagnostic(JSON.stringify({strictSqlShapes:limits.records.length,maximumBindings:Math.max(...limits.boundCounts),observed,control:{jobs:1,slots:1,reservationPairs:1,stages:5,tokens:224000},costs:'synthetic app-recorded allowances, not invoices'}));
});

test('wrong method, origin, route, body, action or quote cannot manufacture actor intent',async t=>{
  const f=await storyboardIntentFixture(t),before=stateSnapshot(f),reads=forbidWrites(f);
  const bodies=[{...f.body,explicitAuthorization:false},{draftHash:f.body.draftHash,termsDigest:f.body.termsDigest,maximumMicrousd:f.body.maximumMicrousd},{...f.body,maximumMicrousd:f.body.maximumMicrousd+1},{...f.body,termsDigest:'sha256:'+'f'.repeat(64)},{...f.body,draftHash:'sha256:'+'f'.repeat(64)},{...f.body,experienceBinding:f.binding},{...f.body,payerUserId:'different'},{...f.body,frameRequestDigests:['f'.repeat(64)]},{...f.body,performedModerationIds:['invented']},{...f.body,reference:'/api/media/synthetic'},{...f.body,repair:true},{...f.body,maximumCalls:9}];
  try{for(const body of bodies)await reject(createProof(f.request(body),f.env));
    for(const request of [new Request(f.request().url),f.request(f.body,{headers:{'content-type':'application/json',origin:'https://foreign.invalid'}}),new Request('http://localhost/api/output-requirements',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(f.body)}),f.request(f.body,{body:'{'}),f.request(f.body,{body:' '.repeat(70000)}),f.request(f.body,{headers:{'content-type':'text/plain'}})])await reject(createProof(request,f.env));
    assert.deepEqual(stateSnapshot(f),before);reads.assert();assertNoAdmission(f);
  }finally{reads.restore();}
});

test('personal-only composition matches actual native context, preflight and retained rights assertions',async t=>{
  const f=await storyboardIntentFixture(t),request=f.request(),[{readExistingPrincipalRequest},{continueOutputTrustedContext},{preflightOutputStoryboardTarget,outputStoryboardPreflightProof},{sponsorCurrentSourceAssertions}]=await Promise.all([
    import('../worker/principal-request-core.ts'),import('../worker/output-trusted-context.ts'),import('../worker/output-storyboard-preflight.ts'),import('../worker/experience-sponsor-image-evidence.ts')]);
  const auth=await readExistingPrincipalRequest(request,f.env,'creator',{account:'principal'}),native=await continueOutputTrustedContext(request,f.env,f.plan.documentId,'request',auth);assert.ok(!(native instanceof Response));
  const plan=JSON.parse(f.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=(SELECT event_id FROM output_commands WHERE action='confirm')").get().private_json).confirmed_plan;
  const offered=await preflightOutputStoryboardTarget({request,env:f.env,scope:native.scope,principal:native.principal,confirmedPlan:plan,target:plan.plan.targets[0],context:native.context,ownerHead:native.ownerHead,sourceEvents:native.events,sourceAssertions:native.sourceAssertions,sourceDigest:native.sourceDigest,requirementsDigest:native.requirementsDigest});
  assert.deepEqual(offered,f.prepared.preflight.targets[0]);const proof=outputStoryboardPreflightProof(offered);assert.ok(proof?.sourceAssertions.length);
  const nativeGuards=[...sponsorCurrentSourceAssertions(native),...proof.sourceAssertions],expected=outputProofReadStatements(f.env,nativeGuards).map(value=>JSON.stringify([value.sql,value.bindings]));
  const batch=f.DB.batch.bind(f.DB);let complete=[];f.DB.batch=async statements=>{if(statements.some(value=>value.sql.includes('NOT EXISTS(SELECT 1 FROM output_operation_slots WHERE job_id=?)')))complete=statements.map(value=>JSON.stringify([value.sql,value.bindings]));return batch(statements);};
  const before=stateSnapshot(f),reads=forbidWrites(f);try{const seal=await createProof(request,f.env),review=await readProof(seal,request,f.env);
    assert.equal(review.actorUserId,native.scope.actorUserId);assert.equal(review.description.ownerUserId,native.scope.ownerUserId);assert.equal(review.projectId,native.scope.projectId);assert.equal(review.documentId,native.scope.documentId);
    assert.equal(review.command.expectedRevision,`output:${native.ownerHead}`);assert.equal(review.description.sourceDigest,`sha256:${native.sourceDigest}`);assert.equal(offered.settings.original.requirementsDigest,native.requirementsDigest);
    assert.equal(review.description.recipe.routeDigest,`sha256:${await outputDigest(offered)}`);assert.equal(review.description.recipe.settingsDigest,`sha256:${await outputDigest(offered.settings)}`);
    assert.ok(complete.length>=expected.length);for(const assertion of expected)assert.ok(complete.includes(assertion),'Each exact native custody and rights assertion is retained in the complete final proof');
    assert.deepEqual(stateSnapshot(f),before);reads.assert();assertNoAdmission(f);
  }finally{reads.restore();}
});

test('serialized proof, Request substitution and database substitution never confer authority',async t=>{
  const f=await storyboardIntentFixture(t),request=f.request(),proof=await createProof(request,f.env),before=stateSnapshot(f),reads=forbidWrites(f);
  try{for(const copy of [{},structuredClone(proof),JSON.parse(JSON.stringify(proof))])await reject(readProof(copy,request,f.env));
    await reject(readProof(proof,f.request(),f.env));await reject(readProof(proof,request,{...f.env}));
    const db=f.env.DB;try{f.env.DB={...db};await reject(readProof(proof,request,f.env));}finally{f.env.DB=db;}
    assert.deepEqual(stateSnapshot(f),before);reads.assert();assertNoAdmission(f);
  }finally{reads.restore();}
});

test('retained intake, complete command bodies, indexes and current consent are required on proof reuse',async t=>{
  for(const mutation of ['intake','confirmation','index','consent','source']){const f=await storyboardIntentFixture(t),request=f.request(),proof=await createProof(request,f.env);
    if(mutation==='intake')assert.equal(f.sqlite.prepare('UPDATE private_content SET redacted_at=? WHERE content_id=?').run(new Date().toISOString(),f.plan.draftId).changes,1);
    if(mutation==='confirmation')assert.equal(f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=(SELECT event_id FROM output_commands WHERE action='confirm')").run(new Date().toISOString()).changes,1);
    if(mutation==='index')assert.equal(f.sqlite.prepare("DELETE FROM output_commands WHERE action='preflight'").run().changes,1);
    if(mutation==='consent')assert.equal(f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(actor).changes,1);
    if(mutation==='source')assert.ok(f.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_set(private_json,'$.properties.text','changed source') WHERE document_id=? AND private_event_id IN(SELECT event_id FROM events WHERE type='BlockCreated')").run(f.plan.documentId).changes>0);
    const before=stateSnapshot(f),reads=forbidWrites(f);try{await reject(readProof(proof,request,f.env));assert.deepEqual(stateSnapshot(f),before);reads.assert();assertNoAdmission(f);}finally{reads.restore();}
  }
});

test('selected native preflight and latest plan indexes must remain exact during proof reuse',async t=>{
  for(const mutation of ['delete-preflight','repoint-preflight','newer-plan']){const f=await storyboardIntentFixture(t),request=f.request(),proof=await createProof(request,f.env);
    if(mutation==='delete-preflight')assert.equal(f.sqlite.prepare('DELETE FROM output_preflights WHERE preflight_id=?').run(f.prepared.preflight.id).changes,1);
    if(mutation==='repoint-preflight')assert.equal(f.sqlite.prepare("UPDATE output_preflights SET terms_digest='different' WHERE preflight_id=?").run(f.prepared.preflight.id).changes,1);
    if(mutation==='newer-plan'){
      const row=f.sqlite.prepare('SELECT * FROM output_plan_revisions').get(),copy={...row,plan_revision_id:'synthetic-newer-plan',revision:row.revision+1};
      const keys=Object.keys(copy);f.sqlite.prepare(`INSERT INTO output_plan_revisions(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...Object.values(copy));
    }
    const before=stateSnapshot(f),reads=forbidWrites(f);try{await assert.rejects(readProof(proof,request,f.env),undefined,mutation);assert.deepEqual(stateSnapshot(f),before);reads.assert();assertNoAdmission(f);}finally{reads.restore();}
  }
});

test('decoded nonempty impersonation or project-selection cookies cannot issue fresh personal intent',async t=>{
  const f=await storyboardIntentFixture(t),before=stateSnapshot(f),reads=forbidWrites(f);
  try{for(const cookie of ['forma_impersonation=nonexistent','forma_impersonation=%6eonexistent','forma_project_context=nonexistent','forma_project_context=%6eonexistent']){
    const request=f.request();request.headers.set('cookie',cookie);await assert.rejects(createProof(request,f.env),undefined,cookie);
  }assert.deepEqual(stateSnapshot(f),before);reads.assert();assertNoAdmission(f);}finally{reads.restore();}
});

test('native preflight envelope cannot point to a different plan while the quote remains original',async t=>{
  const f=await storyboardIntentFixture(t),row=f.sqlite.prepare("SELECT command.event_id,body.private_json FROM output_commands command JOIN event_private_payloads body ON body.private_event_id=command.event_id WHERE command.action='preflight'").get(),body=JSON.parse(row.private_json);
  body.output_command_envelope.planRevisionId='different-plan';const requestDigest=await outputDigest(body.output_command_envelope);
  assert.equal(f.sqlite.prepare('UPDATE output_commands SET request_digest=? WHERE event_id=?').run(requestDigest,row.event_id).changes,1);
  assert.equal(f.sqlite.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run(JSON.stringify(body),row.event_id).changes,1);
  const before=stateSnapshot(f),reads=forbidWrites(f);try{await reject(createProof(f.request(),f.env));assert.deepEqual(stateSnapshot(f),before);reads.assert();assertNoAdmission(f);}finally{reads.restore();}
});

test('post-seal native email and display-name mutations are bound even without an updated-at bump',async t=>{
  for(const field of ['email','display_name']){const f=await storyboardIntentFixture(t),request=f.request(),proof=await createProof(request,f.env),stamp=f.sqlite.prepare('SELECT updated_at FROM users WHERE user_id=?').get(actor).updated_at;
    assert.equal(f.sqlite.prepare(`UPDATE users SET ${field}=? WHERE user_id=?`).run(field==='email'?'changed@synthetic.invalid':'Changed synthetic name',actor).changes,1);
    assert.equal(f.sqlite.prepare('SELECT updated_at FROM users WHERE user_id=?').get(actor).updated_at,stamp);
    const before=stateSnapshot(f),reads=forbidWrites(f);try{await assert.rejects(readProof(proof,request,f.env),undefined,field);assert.deepEqual(stateSnapshot(f),before);reads.assert();assertNoAdmission(f);}finally{reads.restore();}
  }
});

test('personal project becoming organization-governed invalidates an existing intent',async t=>{
  const f=await storyboardIntentFixture(t),request=f.request(),proof=await createProof(request,f.env),now=new Date().toISOString();
  f.sqlite.prepare("INSERT INTO organization_projects(project_access_id,project_id,organization_id,owner_user_id,status,created_at,updated_at) VALUES(?,?,?,?,'active',?,?)").run('synthetic-governed-project',f.plan.projectId,'synthetic-organization',actor,now,now);
  const before=stateSnapshot(f),reads=forbidWrites(f);try{await reject(readProof(proof,request,f.env));await reject(createProof(f.request(),f.env));assert.deepEqual(stateSnapshot(f),before);reads.assert();assertNoAdmission(f);}finally{reads.restore();}
});

test('same deterministic authorization key cannot turn changed terms into a second purchase',async t=>{
  const f=await storyboardIntentFixture(t),request=f.request(),proof=await createProof(request,f.env),review=await readProof(proof,request,f.env);
  const altered=await bindingNative.experienceOutputEnvelope(f.binding,'authorize',Number(f.envelope.expectedRevision.slice(7)),{explicitAuthorization:true,termsDigest:'changed',maximumMicrousd:f.body.maximumMicrousd+1,preflightId:f.prepared.preflight.id});
  assert.equal(altered.clientMutationId,review.command.clientMutationId);assert.notEqual(await outputDigest(altered),review.commandDigest.slice(7));
  await authorizeNative(f);const before=stateSnapshot(f);
  const response=await handleExperienceOutput(f.request({...f.body,maximumMicrousd:f.body.maximumMicrousd+1}),f.env,{waitUntil(){throw Error('No execution');}},outputDocumentExecutionBridge);
  assert.notEqual(response.status,200);assert.deepEqual(stateSnapshot(f),before);await reject(createProof(f.request({...f.body,maximumMicrousd:f.body.maximumMicrousd+1}),f.env));
});

test('planned four-check disclosure never claims performed moderation or future frame request identities',async t=>{
  const f=await storyboardIntentFixture(t),request=f.request(),proof=await createProof(request,f.env),review=await readProof(proof,request,f.env);
  assert.equal(review.transfer.moderation.maximumCalls,4);assert.equal(review.transfer.moderation.model,'omni-moderation-latest');assert.equal(review.transfer.frames.maximumReferences,0);
  assert.equal(review.description.recipe.calls.planning+review.description.recipe.calls.render,5);assert.equal(review.transfer.repairCalls,0);assert.equal(review.transfer.automaticRetries,0);
  assert.equal(JSON.stringify(review).includes('performedModeration'),false);assert.equal(JSON.stringify(review).includes('frameRequestDigests'),false);assert.equal(JSON.stringify(review).includes('payerUserId'),false);assertNoAdmission(f);
  const control=await authorizeNative(f),partial=await exerciseStoryboardPartialAccounting(f,control,'rejected');
  assert.ok(partial);const receipts=JSON.stringify(f.sqlite.prepare('SELECT result_json FROM document_jobs').all());assert.equal(receipts.includes('moderationRequestId'),false);assert.equal(receipts.includes('performedModeration'),false);
  assert.equal(f.sqlite.prepare('SELECT status FROM document_jobs').get().status,'canceled','Partial paid metadata is not full output fulfillment');
});

test('actual native frame binding hook does not turn separate synthetic safety details into a retained check receipt',async t=>{
  const f=await storyboardIntentFixture(t),[{captureOutputStoryboardPlan},{storyboardFrameHooks},{createOutputFalImageContract,captureOutputFalImageRequest}]=await Promise.all([
    import('../worker/output-storyboard-plan.ts'),import('../worker/output-storyboard-fal.ts'),import('../worker/output-fal-image-contract.ts')]);
  const plan=await captureOutputStoryboardPlan({title:'Synthetic lantern sequence',summary:'Four original moments',content_markdown:'Find, lift, carry, place.',presentation:null,
    items:Array.from({length:4},(_,i)=>({title:`Moment ${i+1}`,body:`Lantern moment ${i+1}`,notes:'Keep lantern continuity.',image_prompt:`Original synthetic direction ${i+1}`,slide:null}))},f.prepared.preflight.targets[0].settings.payload.outputStoryboard,'synthetic-planner-receipt');
  const native=createOutputFalImageContract('ideogram/v4','1536x1024'),request=await captureOutputFalImageRequest(native,native.model,{prompt:'Original synthetic adapted direction',expansion_model:native.expansionModel,image_size:{width:native.width,height:native.height},rendering_speed:native.renderingSpeed,acceleration:native.acceleration,num_images:1,sync_mode:false,enable_safety_checker:true,output_format:native.outputFormat},native,'synthetic-frame-request');
  let mapped,checkpoint;const hooks=storyboardFrameHooks(plan,0,{beforeAttempt:async value=>{mapped=value;},checkpoint:async(...args)=>{checkpoint=args;}});
  await hooks.onBeforeProviderAttempt(request.attempt);await hooks.onOutputFalRequest(request,{safety:{requestId:'synthetic-safety-sentinel'}});
  assert.equal(mapped.logicalCallKey,'image:frame:1');assert.equal(checkpoint.length,3);assert.equal(checkpoint[0].body,request.body);assert.equal(checkpoint[1],plan);assert.equal(checkpoint[2],0);
  assert.equal(JSON.stringify({mapped,checkpoint}).includes('synthetic-safety-sentinel'),false);assertNoAdmission(f);
});

test('uncertain later frame holds the original reserve pair and prevents duplicate or subsequent purchases',async t=>{
  const f=await storyboardIntentFixture(t),control=await authorizeNative(f);await exerciseStoryboardPartialAccounting(f,control,'uncertain');
});

test('expired and canceled requests cannot produce or reuse an actor-intent proof',async t=>{
  const f=await storyboardIntentFixture(t),controller=new AbortController(),request=f.request(f.body,{signal:controller.signal}),proof=await createProof(request,f.env),review=await readProof(proof,request,f.env),before=stateSnapshot(f),reads=forbidWrites(f);
  try{controller.abort();await reject(readProof(proof,request,f.env));await reject(createProof(f.request(f.body,{signal:controller.signal}),f.env));
    const live=f.request(),clock=Date.now;try{Date.now=()=>review.deadlineMs;await reject(createProof(live,f.env));}finally{Date.now=clock;}
    assert.deepEqual(stateSnapshot(f),before);reads.assert();assertNoAdmission(f);
  }finally{reads.restore();}
});

test('abort after the final intent read batch prevents factory sealing and review return',async t=>{
  for(const stage of ['factory','review']){const f=await storyboardIntentFixture(t),controller=new AbortController(),request=f.request(f.body,{signal:controller.signal});
    const proof=stage==='review'?await createProof(request,f.env):null,batch=f.DB.batch.bind(f.DB),before=stateSnapshot(f),reads=forbidWrites(f);let reached=false;
    f.DB.batch=async statements=>{const result=await batch(statements);if(statements.some(value=>value.sql.includes('NOT EXISTS(SELECT 1 FROM output_operation_slots WHERE job_id=?)'))){reached=true;controller.abort();}return result;};
    try{await reject(stage==='factory'?createProof(request,f.env):readProof(proof,request,f.env));assert.equal(reached,true);assert.deepEqual(stateSnapshot(f),before);reads.assert();assertNoAdmission(f);}finally{reads.restore();}
  }
});

for(const timing of ['before-factory','between-head-and-event-read','after-captured-events'])test(`extracted reference is refused before media access: ${timing}`,async t=>{
  const f=await storyboardIntentFixture(t),prepare=f.DB.prepare.bind(f.DB),priorMedia=observed.media;let injected=false,afterMutation;
  if(timing==='before-factory'){await addSyntheticExtractedReference(f);injected=true;afterMutation=stateSnapshot(f);}
  else{const wrap=statement=>{const bind=statement.bind.bind(statement),first=statement.first.bind(statement),all=statement.all.bind(statement);statement.bind=(...values)=>wrap(bind(...values));statement.first=async()=>{const result=await first();
    if(!injected&&timing==='between-head-and-event-read'&&statement.sql==='SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?'){injected=true;await addSyntheticExtractedReference(f);afterMutation=stateSnapshot(f);}return result;};
    statement.all=async()=>{const result=await all();if(!injected&&timing==='after-captured-events'&&statement.sql.startsWith('SELECT * FROM events LEFT JOIN event_private_payloads')){injected=true;await addSyntheticExtractedReference(f);afterMutation=stateSnapshot(f);}return result;};return statement;};f.DB.prepare=sql=>wrap(prepare(sql));}
  try{await reject(createProof(f.request(),f.env));assert.equal(injected,true);const attemptedMedia=observed.media-priorMedia;t.diagnostic(JSON.stringify({timing,attemptedMedia,sourceInjectionOnly:true}));
    assert.equal(attemptedMedia,0,'A text-only actor-intent reader must refuse before MEDIA.head/get');assert.deepEqual(stateSnapshot(f),afterMutation);assertNoAdmission(f);
  }finally{f.DB.prepare=prepare;observed.media=priorMedia;}
});

test('late native private source changes and sparse final acknowledgement cannot return intent',async t=>{
  for(const fault of ['private-source','sparse','inherited','accessor']){const f=await storyboardIntentFixture(t),request=f.request(),batch=f.DB.batch.bind(f.DB);let injected=false,afterMutation,accessorReads=0;
    f.DB.batch=async statements=>{const result=await batch(statements);if(!injected&&(fault==='private-source'?statements.every(value=>/^\s*SELECT\b/u.test(value.sql)):statements.some(value=>value.sql.includes('NOT EXISTS(SELECT 1 FROM output_operation_slots WHERE job_id=?)')))){injected=true;
      if(fault==='private-source'){assert.equal(f.sqlite.prepare('UPDATE private_content SET redacted_at=? WHERE content_id=?').run(new Date().toISOString(),f.plan.draftId).changes,1);afterMutation=stateSnapshot(f);}
      if(fault==='sparse')delete result[0];if(fault==='inherited')result[0]=Object.create(result[0]);if(fault==='accessor')Object.defineProperty(result[0].results[0],'current',{get(){accessorReads++;return 1;},enumerable:true});
    }return result;};
    const before=stateSnapshot(f),reads=forbidWrites(f);try{await reject(createProof(request,f.env));assert.equal(injected,true);assert.equal(accessorReads,0);assert.deepEqual(stateSnapshot(f),afterMutation??before);reads.assert();assertNoAdmission(f);}finally{reads.restore();}
  }
});

async function finite(work,ms,label){let timer;try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('storyboard_intent_d1_timeout:'+label)),ms);})]);}finally{clearTimeout(timer);}}
test('complete new proof producer and reader execute against actual local workerd D1 without writes',async t=>{
  const f=await storyboardIntentFixture(t),exported=exportSynthetic(f.sqlite),require=createRequire(import.meta.url),wrangler=createRequire(require.resolve('wrangler')),{Miniflare,Log,LogLevel}=wrangler('miniflare');
  const mf=new Miniflare({modules:true,compatibilityDate:'2026-05-22',host:'127.0.0.1',port:0,log:new Log(LogLevel.NONE),d1Databases:['DB'],script:'export default {fetch(){return new Response("synthetic Storyboard intent qualification")}}',outboundService(){observed.network++;throw Error('Network forbidden');}});
  try{const db=await finite(mf.getD1Database('DB'),10000,'db');await finite(install(db,exported),35000,'install');const before=await rowsSnapshot(db,exported.tables);let statements=0,maximumBindings=0,maximumSqlBytes=0,writes=0;
    const wrap=(sql,bindings=[])=>{assert.match(sql,/^\s*SELECT\b/iu);assert.ok(bindings.length<=100);assert.ok(Buffer.byteLength(sql)<100000);const native=db.prepare(sql).bind(...bindings),count=()=>{statements++;maximumBindings=Math.max(maximumBindings,bindings.length);maximumSqlBytes=Math.max(maximumSqlBytes,Buffer.byteLength(sql));};
      return {sql,bindings,bind(...values){return wrap(sql,values);},async first(){count();return native.first();},async all(){count();return native.all();},async run(){writes++;throw Error('No intent writes');}};};
    f.env.DB={prepare(sql){if(!/^\s*SELECT\b/iu.test(sql)){writes++;throw Error('Non-read intent SQL');}return wrap(sql);},async batch(values){for(const value of values){statements++;maximumBindings=Math.max(maximumBindings,value.bindings.length);maximumSqlBytes=Math.max(maximumSqlBytes,Buffer.byteLength(value.sql));}return db.batch(values.map(value=>db.prepare(value.sql).bind(...value.bindings)));}};
    const request=f.request(),proof=await finite(createProof(request,f.env),35000,'proof'),review=await finite(readProof(proof,request,f.env),35000,'read');assert.deepEqual(review.command,f.envelope);assert.deepEqual(await rowsSnapshot(db,exported.tables),before);assert.equal(writes,0);
    await db.prepare('UPDATE private_content SET redacted_at=? WHERE content_id=?').bind(new Date().toISOString(),f.plan.draftId).run();const changed=await rowsSnapshot(db,exported.tables);
    await reject(readProof(proof,request,f.env));assert.deepEqual(await rowsSnapshot(db,exported.tables),changed);assert.equal(writes,0);
    t.diagnostic(JSON.stringify({actualLocalWorkerdD1:true,statements,maximumBindings,maximumSqlBytes,writes,observed}));
  }finally{await finite(mf.dispose(),10000,'dispose');}
});

import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {createRequire} from 'node:module';
import {outputTestDatabase,registerOutputSourceImports} from './output-execution-test-helpers.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';
import {exportSynthetic,install,rowsSnapshot} from './helpers/model3d-workerd-snapshot.mjs';

const imports=registerOutputSourceImports();
const [{handleSession,POLICY_VERSION},{handleEvents},{appendAuditEvent},{loadOutputTrustedContext,outputDigest,rememberOutputPrivateBody},
  {handleExperienceOutput},{outputDocumentExecutionBridge},{handleExperienceIntake},{registeredExperience},{OUTPUT_NATIVE_EXECUTION_POLICY},{STORYBOARD_OUTPUT_POLICY},
  {OPENAI_TEXT_PRICING_VERSION,estimateOpenAITextCallMaximumMicrousd},{createOutputFalImageContract},
  {prepareStoryboardPlannerRequest},{storyboardPlanningSnapshot},
  {describeSponsorStoryboardAdmission,readSponsorStoryboardTemplateEvidence},contract]=await Promise.all([
  import('../worker/pilot-policy.ts'),import('../worker/events-api.ts'),import('../worker/runtime.ts'),import('../worker/output-requirements-api.ts'),
  import('../worker/experience-output-api.ts'),import('../worker/output-document-execution.ts'),import('../worker/experience-intake-api.ts'),import('../src/experiences/intake.ts'),
  import('../src/model/output-execution-policy.ts'),import('../src/model/output-storyboard-contract.ts'),
  import('../worker/openai-text-cost.ts'),import('../worker/output-fal-image-contract.ts'),
  import('../worker/openai-adapter.ts'),import('../worker/output-storyboard-preflight.ts'),
  import('../worker/experience-sponsor-storyboard-evidence.ts'),import('../worker/experience-sponsor-storyboard-contract.ts'),
]);
const fetchDescriptor=Object.getOwnPropertyDescriptor(globalThis,'fetch');let egress=0,mediaAccess=0,assetsAccess=0,detached=0;
globalThis.fetch=()=>{egress++;throw Error('No network in dormant Storyboard evidence qualification');};
after(()=>{Object.defineProperty(globalThis,'fetch',fetchDescriptor);imports.deregister();assert.equal(egress,0);assert.equal(mediaAccess,0);assert.equal(assetsAccess,0);assert.equal(detached,0);});
const actor='dev-local-creative',stream=`creative:${actor}`,path='/api/output-requirements';
const executionContext={waitUntil(){detached++;throw Error('No detached work');}};
const post=body=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const rows=f=>f.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>[name,f.sqlite.prepare(`SELECT * FROM "${name.replaceAll('"','""')}" ORDER BY rowid`).all()]);
const snapshot=f=>({rows:rows(f),changes:f.sqlite.prepare('SELECT total_changes() AS n').get().n,schema:f.sqlite.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all()});
function noWrites(f){const prepare=f.env.DB.prepare.bind(f.env.DB);let attempted=0;
  f.env.DB.prepare=sql=>{if(!/^\s*SELECT\b/iu.test(sql)){attempted++;throw Error('Evidence attempted non-read SQL');}return prepare(sql);};
  return ()=>assert.equal(attempted,0,'No SQL write attempt, including a no-op, is allowed during evidence reads');
}
async function fixture(t){
  const f=outputTestDatabase();t.after(()=>f.sqlite.close());Object.assign(f.env,{OPENAI_API_KEY:'synthetic-presence-no-egress',OPENAI_MODEL:'gpt-5.6-terra',FAL_KEY:'synthetic-presence-no-egress',FORMA_IMAGE_PROVIDER:'fal'});
  for(const operation of ['get','head','put','delete','list'])f.env.MEDIA[operation]=()=>{mediaAccess++;throw Error('No media access');};
  f.env.ASSETS.fetch=()=>{assetsAccess++;throw Error('No asset fetch');};
  assert.equal((await handleSession(new Request('http://localhost/api/session'),f.env)).status,200);
  f.sqlite.prepare('UPDATE users SET consent_version=?').run(POLICY_VERSION);
  assert.equal((await handleEvents(new Request('http://localhost/api/events'),f.env)).status,200);
  const release=await registeredExperience('storyboard');assert.ok(release);
  const intent={experienceId:'storyboard',intentId:'00000000-0000-4000-8000-000000000095',releaseHash:release.releaseHash,values:{
    story:{value:'A lantern is found, lifted, carried home, and placed in the window. 灯笼 — فانوس',provenance:'authored'},
    composition:{value:'Four frames; blue dusk, consistent warm lantern and screen direction.',provenance:'authored'},
  }};
  let response=await handleExperienceIntake(new Request('http://localhost/api/experiences/drafts',post(intent)),f.env);
  assert.equal(response.status,200,await response.clone().text());const plan=(await response.json()).plan;
  response=await handleExperienceIntake(new Request(`http://localhost/api/experiences/drafts/${plan.draftId}/commit`,post({draftHash:plan.draftHash})),f.env);
  assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).status,'complete');
  response=await handleExperienceOutput(new Request(`http://localhost/api/experiences/drafts/${plan.draftId}/output/prepare`,post({draftHash:plan.draftHash,explicitRequirementsConfirmation:true})),f.env,executionContext,outputDocumentExecutionBridge);
  assert.equal(response.status,200,await response.clone().text());const prepared=await response.json();
  assert.equal(prepared.permitted.authorize,true,JSON.stringify(prepared));assert.equal(prepared.permitted.run,false);
  const terms=prepared.preflight,documentId=plan.documentId;
  const request=new Request(`http://localhost${path}`,post({documentId})),trusted=await loadOutputTrustedContext(request,f.env,documentId,'request');assert.ok(!(trusted instanceof Response));
  const command={documentId,action:'authorize',expectedRevision:`output:${trusted.ownerHead}`,clientMutationId:'storyboard-authorize',preflightId:terms.id,termsDigest:terms.termsDigest,maximumMicrousd:terms.maximumMicrousd,explicitAuthorization:true};
  return {...f,plan,documentId,terms,command,request,trusted};
}
function template(recipe){const frameContract=createOutputFalImageContract('ideogram/v4','1536x1024');assert.ok(frameContract);
  const calls=[{stage:'planning:0:initial',provider:'openai',model:'gpt-5.6-terra',maximumInputTokens:124000,maximumOutputTokens:4000,maximumMicrousd:estimateOpenAITextCallMaximumMicrousd('gpt-5.6-terra',124000,4000)},
    ...Array.from({length:4},(_,index)=>({stage:`image:frame:${index+1}`,provider:'fal',model:frameContract.model,maximumInputTokens:0,maximumOutputTokens:0,maximumMicrousd:frameContract.maximumMicrousd}))];
  return {version:1,family:'canonical-four-frame-storyboard@1',appId:'storyboard',recipeVersion:recipe.recipeVersion,releaseDigest:recipe.releaseDigest,outputKind:'storyboard',inputMode:'authorized-document-text',outputCount:1,frameCount:4,durationMs:0,width:1536,height:1024,route:'document-storyboard-four-frames-manual-v1',maximumCalls:5,maximumTokens:224000,maximumMicrousd:calls.reduce((sum,call)=>sum+call.maximumMicrousd,0),calls,storyboardPolicy:STORYBOARD_OUTPUT_POLICY,frameContract,pricingVersion:OPENAI_TEXT_PRICING_VERSION,transfer:contract.STORYBOARD_SPONSOR_TRANSFER,executionPolicy:OUTPUT_NATIVE_EXECUTION_POLICY};
}
async function actualEvidence(f){const described=await describeSponsorStoryboardAdmission(f.trusted,f.command);return {described,actual:await readSponsorStoryboardTemplateEvidence(f.trusted,f.command,described.recipe)};}
async function alterQuote(f,change){const row=f.sqlite.prepare('SELECT event_id FROM output_preflights WHERE preflight_id=?').get(f.command.preflightId);const body=JSON.parse(f.sqlite.prepare('SELECT private_json FROM event_private_payloads WHERE private_event_id=?').get(row.event_id).private_json);change(body.preflight);const {termsDigest:ignored,...rest}=body.preflight;void ignored;body.preflight.termsDigest=await outputDigest(rest);f.command.termsDigest=body.preflight.termsDigest;f.sqlite.prepare('UPDATE output_preflights SET terms_digest=?,expires_at=? WHERE event_id=?').run(body.preflight.termsDigest,body.preflight.expiresAt,row.event_id);f.sqlite.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run(JSON.stringify(body),row.event_id);}
async function redigest(actual){actual.recipe.routeDigest=`sha256:${await outputDigest(actual.offered)}`;actual.recipe.settingsDigest=`sha256:${await outputDigest(actual.offered.settings)}`;}
function assertUnpaid(f){for(const name of ['document_jobs','output_execution_grants','output_operation_slots','output_provider_calls','budget_reservations','cost_budget_reservations'])assert.equal(f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get().n,0,name);assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'experience_sponsor_%'").get().n,0);}

test('registered Storyboard intake and actual native planner yield read-only four-frame evidence under strict SQL limits',async t=>{
  const f=await fixture(t),before=snapshot(f),limits=enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}});t.after(()=>limits.restore());const assertReadOnly=noWrites(f);
  const {described,actual}=await actualEvidence(f),reviewed=contract.readSponsorStoryboardCampaignTemplate(template(described.recipe));
  assert.equal(await contract.matchSponsorStoryboardTemplate(reviewed,actual),true);assert.deepEqual(described.recipe.calls,{parsing:0,planning:1,render:4,repair:0});
  assert.equal(described.recipe.outputCount,1);assert.equal(described.recipe.maximumTokens,224000);assert.deepEqual([described.recipe.width,described.recipe.height],[1536,1024]);
  assert.deepEqual(actual.offered.settings.calls.map(call=>call.stage),['planning:0:initial','image:frame:1','image:frame:2','image:frame:3','image:frame:4']);
  assert.equal(actual.offered.settings.payload.itemCount,4);assert.equal(actual.offered.settings.payload.outputFalImage.outputFormat,'png');
  const nativeSnapshot=storyboardPlanningSnapshot(f.trusted.context.snapshot,f.trusted.context.projection,f.trusted.events);
  const options={productionMode:'manual',itemCount:4,outputTargetInstructions:actual.offered.settings.payload.outputTargetInstructions};
  const prepared=await prepareStoryboardPlannerRequest(f.env,actor,{documentTitle:f.trusted.context.projection.documentTitle,snapshot:nativeSnapshot,options},actual.offered.settings.payload.outputStoryboard),wire=JSON.parse(prepared.requestBody);
  assert.equal(wire.text.format.strict,true);assert.deepEqual([wire.text.format.schema.properties.items.minItems,wire.text.format.schema.properties.items.maxItems],[4,4]);
  assert.ok(prepared.requestBody.includes('灯笼 — فانوس'));assert.equal(wire.store,false);assert.equal(wire.service_tier,'default');assert.equal(wire.prompt_cache_options.mode,'explicit');
  assert.equal(actual.planning.requestDigest,`sha256:${prepared.requestDigest}`);assert.equal(actual.planning.schemaDigest,`sha256:${await outputDigest(wire.text.format.schema)}`);assert.equal(actual.planning.contractDigest,`sha256:${await outputDigest(actual.offered.settings.payload.outputStoryboard)}`);
  assert.equal(actual.planning.maximumInputTokens,new TextEncoder().encode(prepared.requestBody).byteLength+4096);assert.equal(actual.planning.maximumOutputTokens,4000);
  assert.deepEqual(Object.keys(actual.planning).sort(),['requestDigest','schemaDigest','contractDigest','maximumInputTokens','maximumOutputTokens','model','store','serviceTier','cacheMode','reasoningEffort'].sort());
  assert.deepEqual(actual.transfer,contract.STORYBOARD_SPONSOR_TRANSFER);assert.equal(described.actorUserId,actor);assert.equal(described.ownerUserId,actor);assert.deepEqual(described.orderedAssetDigests,[]);
  assert.ok(Object.isFrozen(actual.planning));assert.ok(Object.isFrozen(actual.offered.settings.payload));assert.ok(Object.isFrozen(actual.transfer));
  assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);limits.assertVerified();t.diagnostic(JSON.stringify({strictLocalSqlStatements:limits.records.length,maximumBindings:Math.max(...limits.boundCounts),limits:{expressionDepth:100,functionArguments:32,parameters:100,sqlBytes:100000},egress,mediaAccess,assetsAccess,detached}));
});

test('closed template and matcher reject altered costs, frames, source transfer, planner and unsafe JSON grammar',async t=>{
  const f=await fixture(t),{described,actual}=await actualEvidence(f),base=template(described.recipe);
  for(const mutate of [x=>x.version=9,x=>x.family='guest-storyboard@1',x=>x.outputCount=4,x=>x.frameCount=3,x=>x.maximumCalls=6,x=>x.maximumTokens=128000,x=>x.width=1024,x=>x.calls.reverse(),x=>x.calls[0].maximumInputTokens++,x=>x.calls[0].maximumOutputTokens++,x=>x.calls[1].maximumMicrousd++,x=>x.frameContract.outputFormat='jpeg',x=>x.storyboardPolicy.maximumPlanningCalls=2,x=>x.transfer={},x=>x.extra=true]){
    const changed=structuredClone(base);mutate(changed);assert.throws(()=>contract.readSponsorStoryboardCampaignTemplate(changed),/sponsor_storyboard_contract_invalid/);
  }
  let accessed=0;const unsafe={...base};Object.defineProperty(unsafe,'family',{enumerable:true,get(){accessed++;return base.family;}});assert.throws(()=>contract.readSponsorStoryboardCampaignTemplate(unsafe));assert.equal(accessed,0);
  assert.equal(contract.recipeMatchesSponsorStoryboardTemplate(base,{...described.recipe,calls:{parsing:0,planning:1,render:4,repair:1}}),false);
  for(const mutate of [x=>x.offered.settings.payload.itemCount=3,x=>x.offered.settings.payload.references=[],x=>x.offered.settings.calls[4].stage='image:frame:3',x=>x.offered.settings.calls[0].maximumInputTokens++,x=>x.offered.settings.calls[0].maximumOutputTokens++,x=>x.planning.maximumInputTokens=128000,x=>x.planning.schemaDigest='invalid',x=>x.planning.requestBody='unauthorized raw body',x=>x.transfer={}]){
    const changed=structuredClone(actual);mutate(changed);await redigest(changed);assert.equal(await contract.matchSponsorStoryboardTemplate(base,changed),false);
  }
  const mutableActual=structuredClone(actual),mutableTemplate=structuredClone(base),pending=contract.matchSponsorStoryboardTemplate(mutableTemplate,mutableActual);
  mutableTemplate.maximumTokens=1;mutableActual.offered.settings.payload.itemCount=9;assert.equal(await pending,true);assert.equal(await contract.matchSponsorStoryboardTemplate(mutableTemplate,mutableActual),false);
  await assert.rejects(readSponsorStoryboardTemplateEvidence(f.trusted,f.command,{...described.recipe,maximumTokens:128000}),/sponsor_native_envelope_mismatch/);assertUnpaid(f);
});

test('native reader rejects re-digested route, budget, frame-contract and planner quote tampering without writes',async t=>{
  for(const mutate of [q=>q.targets[0].settings.calls[4].stage='image:frame:3',q=>q.targets[0].settings.calls[0].model='gpt-5.6-sol',q=>q.targets[0].settings.calls[0].maximumInputTokens++,q=>q.targets[0].settings.calls[0].maximumOutputTokens++,q=>q.targets[0].settings.calls[1].maximumMicrousd++,q=>q.targets[0].settings.payload.itemCount=3,q=>q.targets[0].settings.payload.outputFalImage.outputFormat='jpeg',q=>q.targets[0].settings.payload.outputStoryboardPlanner.requestDigest='f'.repeat(64),q=>q.targets[0].maximumTokens=128000]){
    const f=await fixture(t);await alterQuote(f,mutate);const before=snapshot(f),assertReadOnly=noWrites(f);await assert.rejects(describeSponsorStoryboardAdmission(f.trusted,f.command));assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
  }
});

test('wire privilege, nonpersonal identity, retries, stale consent, source changes and quote expiry cannot qualify',async t=>{
  const f=await fixture(t),before=snapshot(f),assertReadOnly=noWrites(f);
  for(const command of [{...f.command,sponsor_entitlement:{}},{...f.command,maximumMicrousd:f.command.maximumMicrousd+1},{...f.command,expectedRevision:'output:0'},{...f.command,explicitAuthorization:false}])await assert.rejects(describeSponsorStoryboardAdmission(f.trusted,command));
  for(const trusted of [{...f.trusted,scope:{...f.trusted.scope,kind:'project'}},{...f.trusted,principal:{...f.trusted.principal,fictional:true}},{...f.trusted,projectContext:{}},{...f.trusted,sourcePrivateCaptured:false}])await assert.rejects(describeSponsorStoryboardAdmission(trusted,f.command));
  assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
  for(const mutation of ['retry','consent','head','expiry','retention','receipt']){const altered=await fixture(t);
    if(mutation==='retry')await alterQuote(altered,q=>q.operationAttempts[q.targets[0].targetId]={ordinal:1,previousSlotId:'previous'});
    if(mutation==='consent')altered.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(actor);
    if(mutation==='head')await appendAuditEvent(altered.env,stream,'user','BlockCreated',{document_id:altered.documentId,project_id:altered.trusted.scope.projectId,block_id:'later',type:'message',handle:'later',position:'z',properties:{text:'The result changed.',weight:1}});
    if(mutation==='expiry')await alterQuote(altered,q=>q.expiresAt=new Date(Date.now()-1).toISOString());
    if(mutation==='retention')altered.sqlite.prepare('UPDATE private_content SET redacted_at=? WHERE content_id=?').run(new Date().toISOString(),altered.plan.draftId);
    if(mutation==='receipt')assert.equal(altered.sqlite.prepare('DELETE FROM event_client_receipts WHERE event_id=(SELECT receipt.event_id FROM event_client_receipts receipt JOIN event_private_payloads body ON body.private_event_id=receipt.event_id WHERE body.document_id=? LIMIT 1)').run(altered.documentId).changes,1);
    const captured=snapshot(altered),assertAlteredReadOnly=noWrites(altered);await assert.rejects(describeSponsorStoryboardAdmission(altered.trusted,altered.command),undefined,mutation);assert.deepEqual(snapshot(altered),captured);assertAlteredReadOnly();assertUnpaid(altered);
  }
});

test('text-only lane refuses unknown, reference and media-bearing source facts without media access',async t=>{
  const f=await fixture(t),before=snapshot(f),assertReadOnly=noWrites(f);
  for(const facts of [[],[{type:'unknown',properties:{text:'Unknown source'}}],[{type:'reference',properties:{text:'Reference source',reference_id:'owned'}}],[{type:'message',properties:{text:'Visual source',image_url:'/api/media/synthetic'}}]]){
    const trusted={...f.trusted,context:{...f.trusted.context,snapshot:{...f.trusted.context.snapshot,facts}}};await assert.rejects(describeSponsorStoryboardAdmission(trusted,f.command),/sponsor_storyboard_text_source_required/);
  }
  assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
});

test('final reads refuse late private-body, principal, request, database and provider configuration changes',async t=>{
  for(const mutation of ['quote','source-redaction','principal','request','database','planning-model','image-provider','scope']){const f=await fixture(t),batch=f.DB.batch.bind(f.DB);let reached=false,afterMutation;
    f.DB.batch=async statements=>{if(!reached){reached=true;
      if(mutation==='quote')f.sqlite.prepare("UPDATE event_private_payloads SET private_json='{}' WHERE private_event_id=(SELECT event_id FROM output_preflights WHERE preflight_id=?)").run(f.command.preflightId);
      if(mutation==='source-redaction')assert.ok(f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at=? WHERE document_id=? AND private_event_id IN(SELECT event_id FROM events WHERE type='BlockCreated')").run(new Date().toISOString(),f.documentId).changes>0);
      if(mutation==='principal')f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(actor);
      if(mutation==='request')f.trusted.request=new Request(f.request);
      if(mutation==='database')f.env.DB={...f.DB};
      if(mutation==='planning-model')f.env.OPENAI_MODEL='gpt-5.6-sol';
      if(mutation==='image-provider')f.env.FORMA_IMAGE_PROVIDER='openai';
      if(mutation==='scope')f.trusted.principal.billingUserId='another-payer';afterMutation=snapshot(f);
    }return batch(statements);};
    const assertReadOnly=noWrites(f);await assert.rejects(describeSponsorStoryboardAdmission(f.trusted,f.command));assert.equal(reached,true);assert.deepEqual(snapshot(f),afterMutation);assertReadOnly();assertUnpaid(f);
  }
});

test('native evidence captures the caller recipe before the first awaited read',async t=>{
  const f=await fixture(t),{actual}=await actualEvidence(f),originalRecipe=structuredClone(actual.recipe),callerRecipe=structuredClone(actual.recipe),before=snapshot(f),assertReadOnly=noWrites(f);
  const pending=readSponsorStoryboardTemplateEvidence(f.trusted,f.command,callerRecipe);callerRecipe.maximumTokens=1;callerRecipe.calls.render=3;
  const captured=await pending;assert.deepEqual(captured.recipe,originalRecipe);assert.deepEqual(captured,actual);await assert.rejects(readSponsorStoryboardTemplateEvidence(f.trusted,f.command,callerRecipe),/sponsor_native_envelope_mismatch/);
  assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
});

test('additional retained private-body witnesses survive the original scope identity and deny late changes',async t=>{
  const f=await fixture(t),eventId='storyboard-additional-retained-witness',raw=JSON.stringify({private_witness:'first'}),changed=JSON.stringify({private_witness:'other'});
  f.sqlite.prepare('INSERT INTO event_private_payloads(private_event_id,owner_id,project_id,document_id,private_json,created_at) VALUES(?,?,?,?,?,?)').run(eventId,actor,f.trusted.scope.projectId,f.documentId,raw,new Date().toISOString());
  assert.equal(JSON.stringify(f.trusted.sourceAssertions).includes(eventId),false);assert.deepEqual(rememberOutputPrivateBody(f.trusted.scope,eventId,raw),{private_witness:'first'});
  const before=snapshot(f),assertReadOnly=noWrites(f);await describeSponsorStoryboardAdmission(f.trusted,f.command);assert.deepEqual(snapshot(f),before);
  const batch=f.DB.batch.bind(f.DB);let reached=false,afterMutation;f.DB.batch=async statements=>{if(!reached){reached=true;assert.equal(f.sqlite.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run(changed,eventId).changes,1);afterMutation=snapshot(f);}return batch(statements);};
  await assert.rejects(describeSponsorStoryboardAdmission(f.trusted,f.command));assert.equal(reached,true);assert.deepEqual(snapshot(f),afterMutation);assertReadOnly();assertUnpaid(f);
});

test('transient source mutation across an awaited digest cannot substitute different planner evidence',async t=>{
  const f=await fixture(t),{actual}=await actualEvidence(f),before=snapshot(f),assertReadOnly=noWrites(f),originalContext=structuredClone(f.trusted.context);
  const fact=f.trusted.context.snapshot.facts.find(value=>value.type==='message'),originalText=fact.properties.text;
  const changedText=(originalText[0]==='X'?'Y':'X')+originalText.slice(1);assert.equal(changedText.length,originalText.length);assert.notEqual(changedText,originalText);
  const subtle=crypto.subtle,originalDigest=subtle.digest;let armed=false,restored=false;
  subtle.digest=async function(algorithm,data){const bytes=ArrayBuffer.isView(data)?new Uint8Array(data.buffer,data.byteOffset,data.byteLength):new Uint8Array(data);const text=new TextDecoder().decode(bytes);
    if(!armed&&text.includes('"operationAttempts"')&&text.includes(f.command.preflightId)){armed=true;fact.properties.text=changedText;}
    if(armed&&!restored&&text.includes('"max_output_tokens":4000')&&text.includes('"name":"document_storyboard"')){restored=true;fact.properties.text=originalText;}
    return originalDigest.call(this,algorithm,data);
  };
  let result,error;try{result=await readSponsorStoryboardTemplateEvidence(f.trusted,f.command,actual.recipe);}catch(caught){error=caught;}finally{subtle.digest=originalDigest;fact.properties.text=originalText;}
  assert.equal(armed,true,'The mutation overlaps the actual native quote digest await');
  if(error)assert.match(error.message,/sponsor_|output_storyboard/u);else{assert.equal(restored,true,'Successful evidence restores the source only when actual prepared bytes are hashed');assert.deepEqual(result,actual,'Returned evidence describes only the original captured source');}
  assert.deepEqual(f.trusted.context,originalContext);assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
});

test('original preparation lifetime must remain live after atomic native source verification',async t=>{
  const f=await fixture(t),deadline=Date.parse(f.terms.targets[0].settings.original.expiresAt),batch=f.DB.batch.bind(f.DB),clock=Date.now;let reached=false;
  f.DB.batch=async statements=>{const result=await batch(statements);reached=true;Date.now=()=>deadline;return result;};
  const before=snapshot(f),assertReadOnly=noWrites(f);
  try{await assert.rejects(describeSponsorStoryboardAdmission(f.trusted,f.command));}finally{Date.now=clock;}
  assert.equal(reached,true);assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
});

test('missing, sparse, failed and false native proof batches cannot be accepted',async t=>{
  for(const fault of ['missing','sparse','failed','false']){const f=await fixture(t),batch=f.DB.batch.bind(f.DB),before=snapshot(f),assertReadOnly=noWrites(f);let injected=false;
    f.DB.batch=async statements=>{const result=await batch(statements);if(injected)return result;injected=true;
      if(fault==='missing')return result.slice(0,-1);if(fault==='sparse')delete result[0];if(fault==='failed')result[0].success=false;if(fault==='false')result[0].results=[{current:0}];return result;
    };
    await assert.rejects(describeSponsorStoryboardAdmission(f.trusted,f.command));assert.equal(injected,true);assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
  }
});

test('sparse final leaf proof batches cannot be accepted',async t=>{
  const f=await fixture(t),batch=f.DB.batch.bind(f.DB),before=snapshot(f),assertReadOnly=noWrites(f);let injected=false;
  f.DB.batch=async statements=>{const result=await batch(statements);if(statements.some(value=>value.sql.includes('preflight.terms_digest'))){assert.equal(injected,false);injected=true;delete result[0];}return result;};
  await assert.rejects(describeSponsorStoryboardAdmission(f.trusted,f.command));assert.equal(injected,true);assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
});

test('request cancellation prevents initial, later private and final evidence reads',async t=>{
  for(const phase of ['already-aborted','first-principal','private-quote','final-proof']){const f=await fixture(t),controller=new AbortController();
    f.trusted.request=new Request(f.request,{signal:controller.signal});const before=snapshot(f),prepare=f.DB.prepare.bind(f.DB),batch=f.DB.batch.bind(f.DB);
    let reads=0,readsAfterAbort=0,injected=false;
    const wrap=statement=>{const bind=statement.bind.bind(statement);statement.bind=(...values)=>wrap(bind(...values));
      for(const name of ['first','all']){const method=statement[name].bind(statement);statement[name]=async(...args)=>{reads++;if(controller.signal.aborted)readsAfterAbort++;const result=await method(...args);
        if(!injected&&(phase==='first-principal'||phase==='private-quote'&&statement.sql.includes('FROM output_preflights'))){injected=true;controller.abort();}return result;
      };}return statement;
    };
    f.DB.prepare=sql=>wrap(prepare(sql));f.DB.batch=async statements=>{reads+=statements.length;if(controller.signal.aborted)readsAfterAbort+=statements.length;const result=await batch(statements);
      if(phase==='final-proof'&&statements.some(value=>value.sql.includes('preflight.terms_digest'))){assert.equal(injected,false);injected=true;controller.abort();}return result;
    };
    if(phase==='already-aborted'){injected=true;controller.abort();}const assertReadOnly=noWrites(f);
    await assert.rejects(describeSponsorStoryboardAdmission(f.trusted,f.command),/sponsor_authority_changed/);assert.equal(injected,true);assert.equal(readsAfterAbort,0);
    if(phase==='already-aborted')assert.equal(reads,0);if(phase==='first-principal')assert.equal(reads,1);assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
  }
});

test('cancellation between the internal return and public continuation prevents either public evidence result',async t=>{
  for(const output of ['description','template']){const f=await fixture(t),{actual}=await actualEvidence(f),controller=new AbortController();
    f.trusted.request=new Request(f.request,{signal:controller.signal});const before=snapshot(f),assertReadOnly=noWrites(f),freeze=Object.freeze;let boundary=false;
    Object.freeze=function(value){const result=freeze(value);
      if(!boundary&&value&&typeof value==='object'&&Object.hasOwn(value,'description')&&Object.hasOwn(value,'offered')
        &&Object.hasOwn(value,'planning')&&Object.hasOwn(value,'transfer')&&!Object.hasOwn(value,'recipe')){
        // Recognize only the private native-return aggregate. The closure is
        // present in the repaired implementation; the retained R1 source had
        // these same four data fields and lacked the public continuation check.
        if(Object.hasOwn(value,'assertCurrent'))assert.equal(typeof value.assertCurrent,'function');
        boundary=true;queueMicrotask(()=>controller.abort());
      }
      return result;
    };
    try{await assert.rejects(output==='description'?describeSponsorStoryboardAdmission(f.trusted,f.command):readSponsorStoryboardTemplateEvidence(f.trusted,f.command,actual.recipe),/sponsor_authority_changed/);}
    finally{Object.freeze=freeze;}
    assert.equal(boundary,true,'Cancellation occurs at the actual private-return microtask boundary');assert.equal(controller.signal.aborted,true);
    assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
  }
});

async function finite(work,ms,label){let timer;try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('storyboard_d1_timeout:'+label)),ms);})]);}finally{clearTimeout(timer);}}
test('actual native evidence reads a synthetic local workerd D1 database and rejects current private-source loss',async t=>{
  const f=await fixture(t),exported=exportSynthetic(f.sqlite),require=createRequire(import.meta.url),wrangler=createRequire(require.resolve('wrangler')),{Miniflare,Log,LogLevel}=wrangler('miniflare');
  const mf=new Miniflare({modules:true,compatibilityDate:'2026-05-22',host:'127.0.0.1',port:0,log:new Log(LogLevel.NONE),d1Databases:['DB'],script:'export default {fetch(){return new Response("synthetic Storyboard evidence qualification")}}',outboundService(){egress++;throw Error('Network forbidden');}});
  try{
    const db=await finite(mf.getD1Database('DB'),10000,'db');await finite(install(db,exported),35000,'install');const before=await rowsSnapshot(db,exported.tables);
    let statements=0,maximumBindings=0,maximumSqlBytes=0,writeAttempts=0;
    const wrap=(sql,bindings=[])=>{assert.match(sql,/^\s*SELECT\b/iu);assert.ok(bindings.length<=100);assert.ok(Buffer.byteLength(sql)<100000);const native=db.prepare(sql).bind(...bindings);
      const count=()=>{statements++;maximumBindings=Math.max(maximumBindings,bindings.length);maximumSqlBytes=Math.max(maximumSqlBytes,Buffer.byteLength(sql));};
      return {sql,bindings,bind(...values){return wrap(sql,values);},async first(){count();return native.first();},async all(){count();return native.all();},async run(){writeAttempts++;throw Error('Evidence attempted run');}};
    };
    f.env.DB={prepare(sql){if(!/^\s*SELECT\b/iu.test(sql)){writeAttempts++;throw Error('Evidence attempted non-read SQL');}return wrap(sql);},async batch(values){statements+=values.length;for(const value of values){maximumBindings=Math.max(maximumBindings,value.bindings.length);maximumSqlBytes=Math.max(maximumSqlBytes,Buffer.byteLength(value.sql));}return db.batch(values.map(value=>db.prepare(value.sql).bind(...value.bindings)));}};
    const {described,actual}=await finite(actualEvidence(f),35000,'native-evidence');assert.equal(await contract.matchSponsorStoryboardTemplate(template(described.recipe),actual),true);
    assert.deepEqual(await rowsSnapshot(db,exported.tables),before);assert.equal(writeAttempts,0);assert.ok(statements>0);
    await db.prepare('UPDATE private_content SET redacted_at=? WHERE content_id=?').bind(new Date().toISOString(),f.plan.draftId).run();
    const mutated=await rowsSnapshot(db,exported.tables);await assert.rejects(finite(describeSponsorStoryboardAdmission(f.trusted,f.command),20000,'source-denial'));
    assert.deepEqual(await rowsSnapshot(db,exported.tables),mutated);assert.equal(writeAttempts,0);assertUnpaid(f);
    t.diagnostic(JSON.stringify({actualLocalWorkerdD1:true,statements,maximumBindings,maximumSqlBytes,writeAttempts,egress,mediaAccess,assetsAccess,detached}));
  }finally{await finite(mf.dispose(),10000,'dispose');}
});

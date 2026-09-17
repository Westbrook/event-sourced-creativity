import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {readFileSync} from 'node:fs';
import {outputTestDatabase,registerOutputSourceImports} from './output-server-test-helpers.mjs';
import {readLocalMigrations} from '../scripts/lib/local-migrations.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';
const imports=registerOutputSourceImports();
const [{ensureSchema},{POLICY_VERSION},{handleExperienceIntake},{handleExperienceOutput},{registeredExperience,initialValues},
  {outputDocumentExecutionBridge},{loadOutputTrustedContext,outputExperienceCommands,outputDigest},{captureSceneSourceVersion},
  {preflightOutputSceneTarget,outputScenePreflightProof},{outputActiveSourceDeadlineAssertions},evidence,contract,
  {SCENE_OUTPUT_POLICY},{OUTPUT_NATIVE_EXECUTION_POLICY},{OPENAI_TEXT_PRICING_VERSION},{canonicalJson,digest},{captureOutputSceneRequest}]=await Promise.all([
  import('../worker/runtime.ts'),import('../worker/policy-version.ts'),import('../worker/experience-intake-api.ts'),import('../worker/experience-output-api.ts'),
  import('../src/experiences/intake.ts'),import('../worker/output-document-execution.ts'),import('../worker/output-requirements-api.ts'),
  import('../worker/scene-source-generation.ts'),import('../worker/output-scene-preflight.ts'),import('../worker/output-disclosure-proof.ts'),
  import('../worker/experience-sponsor-scene-evidence.ts'),import('../worker/experience-sponsor-scene-contract.ts'),
  import('../src/model/output-scene-contract.ts'),import('../src/model/output-execution-policy.ts'),import('../worker/openai-text-cost.ts'),
  import('../src/experiences/compiler.ts'),import('../worker/output-scene-request.ts'),
]);
const fetchDescriptor=Object.getOwnPropertyDescriptor(globalThis,'fetch');let egress=0,mediaAccess=0,assetsAccess=0;
globalThis.fetch=()=>{egress++;throw Error('No network in dormant Scene evidence');};
after(()=>{Object.defineProperty(globalThis,'fetch',fetchDescriptor);imports.deregister();assert.equal(egress,0);assert.equal(mediaAccess,0);assert.equal(assetsAccess,0);});
const actor='dev-local-creative',stream=`creative:${actor}`,path='/api/output-requirements';
const post=(url,body)=>new Request('http://localhost'+url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const snapshot=f=>({rows:f.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>[name,f.sqlite.prepare(`SELECT * FROM "${name.replaceAll('"','""')}" ORDER BY rowid`).all()]),
 changes:f.sqlite.prepare('SELECT total_changes() AS n').get().n,schema:f.sqlite.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all()});
async function fixture(t){
 const f=outputTestDatabase();t.after(()=>f.sqlite.close());
 for(const operation of ['get','head','put','delete','list'])f.env.MEDIA[operation]=()=>{mediaAccess++;throw Error('No media access');};
 f.env.ASSETS.fetch=()=>{assetsAccess++;throw Error('No asset fetch');};
 await ensureSchema(f.env);
 for(const migration of readLocalMigrations(new URL('../drizzle/',import.meta.url)).filter(value=>value.tag==='0038_scene_source_generations'))
  for(const sql of migration.sql.split('--> statement-breakpoint'))if(sql.trim())f.sqlite.exec(sql);
 const now=new Date().toISOString();
 f.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,'creator',?,?,?,?)")
  .run(actor,'qualification@invalid','Synthetic Scene qualification',POLICY_VERSION,now,now,now);
 Object.assign(f.env,{OPENAI_API_KEY:'synthetic-presence-no-egress',OPENAI_MODEL:'gpt-5.6-terra'});
 const release=await registeredExperience('scene'),intent={intentId:'00000000-0000-4000-8000-000000000093',experienceId:'scene',releaseHash:release.releaseHash,
  values:{...initialValues(release),...Object.fromEntries(Object.entries({characterA:'Alex',goalA:'Repair a bicycle',characterB:'Alex',goalB:'Keep a gift secret',location:'A bicycle workshop',secret:'The new wheel is a gift'}).map(([key,value])=>[key,{value,provenance:'authored'}]))}};
 let response=await handleExperienceIntake(post('/api/experiences/drafts',intent),f.env);assert.equal(response.status,200,await response.clone().text());
 const {plan}=await response.json();
 response=await handleExperienceIntake(post(`/api/experiences/drafts/${plan.draftId}/commit`,{draftHash:plan.draftHash}),f.env);assert.equal(response.status,200,await response.clone().text());
 const firstObjects=[];
 const bridge={...outputDocumentExecutionBridge,async preflight(input){const result=await outputDocumentExecutionBridge.preflight(input);firstObjects.push(result);return result;}};
 response=await handleExperienceOutput(post(`/api/experiences/drafts/${plan.draftId}/output/prepare`,{draftHash:plan.draftHash,explicitRequirementsConfirmation:true}),f.env,{waitUntil(){throw Error('No background execution');}},bridge);
 assert.equal(response.status,200,await response.clone().text());const ready=await response.json();assert.equal(ready.permitted.authorize,true);
 const row=f.sqlite.prepare('SELECT document_id FROM output_plan_revisions').get();assert.equal(typeof row.document_id,'string');
 const command={documentId:row.document_id,action:'authorize',expectedRevision:ready.outputRevision??`output:${f.sqlite.prepare('SELECT MAX(sequence) AS n FROM events WHERE stream_id=?').get(stream).n}`,
  clientMutationId:'scene-sponsor-qualification',preflightId:ready.preflight.id,termsDigest:ready.preflight.termsDigest,maximumMicrousd:ready.preflight.maximumMicrousd,
  explicitAuthorization:true,sceneCostConsent:{...ready.sceneCostPreview,confirmed:true}}; // Explicit synthetic actor action; collector does not create it.
 const request=post(path,command),trusted=await loadOutputTrustedContext(request,f.env,row.document_id,'request');assert.ok(!(trusted instanceof Response));
 command.expectedRevision=`output:${trusted.ownerHead}`;
 const confirmed=await outputExperienceCommands.readConfirmedPlan(trusted,ready.preflight.planRevisionId);
 // Separate native producer setup AFTER persisted preflight bookkeeping. This
 // is a new genuine current proof, never a relabeled or refreshed old object.
 const version=await captureSceneSourceVersion(f.env,{streamId:stream});
 const nativeInput={request,env:f.env,scope:trusted.scope,principal:trusted.principal,confirmedPlan:confirmed,target:confirmed.plan.targets[0],context:trusted.context,
  ownerHead:trusted.ownerHead,sourceEvents:trusted.events,sourceAssertions:[...trusted.sourceAssertions,...outputActiveSourceDeadlineAssertions(trusted.context)],
  sourceDigest:trusted.sourceDigest,requirementsDigest:trusted.requirementsDigest,sceneSourceVersion:version};
 const native=await preflightOutputSceneTarget(nativeInput);assert.equal(native.available,true,JSON.stringify(native));
 assert.equal(canonicalJson(native),canonicalJson(ready.preflight.targets[0]),'current genuine offer exactly preserves retained original quote');
 assert.deepEqual(outputScenePreflightProof(native).prepared.sourceVersion,version);
 return {...f,documentId:row.document_id,ready,command,request,trusted,native,version,nativeInput,oldNative:firstObjects[0]};
}
function template(recipe){return {version:1,family:'canonical-scene-screenplay@1',appId:'scene',recipeVersion:recipe.recipeVersion,releaseDigest:recipe.releaseDigest,
 outputKind:'scene',inputMode:'authorized-document-text',outputCount:1,durationMs:0,width:0,height:0,route:'document-scene-screenplay-manual-v1',maximumCalls:1,maximumTokens:128000,
 maximumInputTokens:125000,maximumOutputTokens:3000,maximumMicrousd:1000000,call:{stage:'planning:0:initial',provider:'openai',model:'gpt-5.6-terra'},scenePolicy:SCENE_OUTPUT_POLICY,
 pricingVersion:OPENAI_TEXT_PRICING_VERSION,cachePolicy:'disabled-explicit',reasoningEffort:'low',executionPolicy:OUTPUT_NATIVE_EXECUTION_POLICY};}
async function alterQuote(f,change){const row=f.sqlite.prepare('SELECT event_id FROM output_preflights WHERE preflight_id=?').get(f.command.preflightId);
 const body=JSON.parse(f.sqlite.prepare('SELECT private_json FROM event_private_payloads WHERE private_event_id=?').get(row.event_id).private_json);change(body.preflight);
 const {termsDigest:ignored,...rest}=body.preflight;void ignored;body.preflight.termsDigest=await outputDigest(rest);f.command.termsDigest=body.preflight.termsDigest;
 f.sqlite.prepare('UPDATE output_preflights SET terms_digest=?,expires_at=? WHERE event_id=?').run(body.preflight.termsDigest,body.preflight.expiresAt,row.event_id);
 f.sqlite.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run(JSON.stringify(body),row.event_id);}
const describe=f=>evidence.describeSponsorSceneAdmission(f.trusted,f.command,f.native);

test('actual version-bearing native Scene proof yields inert one-call evidence with no writes under bounded SQL',async t=>{
 const f=await fixture(t),before=snapshot(f),limits=enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}});t.after(()=>limits.restore());
 const description=await describe(f),actual=await evidence.readSponsorSceneTemplateEvidence(f.trusted,f.command,description.recipe,f.native);
 assert.equal(await contract.matchSponsorSceneTemplate(template(description.recipe),actual),true);
 assert.deepEqual(description.recipe.calls,{parsing:0,planning:1,render:0,repair:0});assert.deepEqual(description.orderedAssetDigests,[]);
 assert.equal(description.actorUserId,actor);assert.equal(description.ownerUserId,actor);assert.equal(description.recipe.maximumMicrousd,1000000);
 assert.ok(Object.isFrozen(actual.offered.settings.payload));assert.ok(Object.isFrozen(description.recipe.calls));assert.deepEqual(snapshot(f),before);limits.assertVerified();
 for(const table of ['document_jobs','output_execution_grants','output_operation_slots','budget_reservations','cost_budget_reservations','output_provider_calls'])assert.equal(f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,0,table);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'experience_sponsor_%'").get().n,0);
 t.diagnostic(JSON.stringify({strictLocalSqlStatements:limits.records.length,maximumBindings:Math.max(...limits.boundCounts),egress,mediaAccess,assetsAccess}));
});

test('closed Scene template and bounded snapshots reject version collision, hidden fields and accessors',async t=>{
 const f=await fixture(t),description=await describe(f),base=template(description.recipe);
 for(const change of [{version:6},{family:'canonical-short-story@1'},{appId:'guest-scene'},{maximumCalls:2},{maximumTokens:127999},{maximumInputTokens:125001},
  {maximumOutputTokens:6000},{maximumMicrousd:1000001},{outputKind:'image'},{inputMode:'reference-image'},{durationMs:1000},{width:1024},
  {call:{...base.call,stage:'render:0:initial'}},{scenePolicy:{...base.scenePolicy,characterCount:3}},{extra:true}])assert.throws(()=>contract.readSponsorSceneCampaignTemplate({...base,...change}));
 let accessed=0;const getter={...base};Object.defineProperty(getter,'family',{enumerable:true,get(){accessed++;return base.family;}});
 assert.throws(()=>contract.readSponsorSceneCampaignTemplate(getter));assert.equal(accessed,0);
 const hidden={...base};Object.defineProperty(hidden,'hidden',{value:true});const symbol={...base,[Symbol('hidden')]:true};
 const cycle={};cycle.self=cycle;let deep={};for(let n=0;n<25;n++)deep={child:deep};
 for(const value of [hidden,symbol,cycle,deep,Array(2),Object.assign([1],{extra:2}),new Date(),{a:Infinity},{a:'x'.repeat(524289)},Array(8193).fill(null),Object.create({inherited:true})])assert.throws(()=>contract.captureSponsorSceneJson(value));
 const sparse=Array(2);sparse[1]='value';let lengthReads=0;const proxy=new Proxy(sparse,{get(target,key,receiver){if(key==='length')return ++lengthReads<=2?1:2;return Reflect.get(target,key,receiver);}});
 assert.throws(()=>contract.captureSponsorSceneJson(proxy));assert.equal(lengthReads,0);
 assert.equal(contract.recipeMatchesSponsorSceneTemplate(base,{...description.recipe,calls:{parsing:0,planning:1,render:1,repair:0}}),false);
 assert.equal(contract.recipeMatchesSponsorSceneTemplate(base,{...description.recipe,maximumMicrousd:999999}),false);
});

test('whole native wire/settings and ordered Scene intent are matched even after attacker rehashes the proposal',async t=>{
 const f=await fixture(t),description=await describe(f),actual=await evidence.readSponsorSceneTemplateEvidence(f.trusted,f.command,description.recipe,f.native),base=template(description.recipe);
 const mutableActual=structuredClone(actual),mutableTemplate=structuredClone(base),pending=contract.matchSponsorSceneTemplate(mutableTemplate,mutableActual);
 mutableTemplate.family='guest-scene@1';mutableActual.offered.settings.payload.artifactKind='slides';assert.equal(await pending,true);
 assert.equal(await contract.matchSponsorSceneTemplate(mutableTemplate,mutableActual),false);
 for(const wrong of [{releaseDigest:'sha256:'+'a'.repeat(64)},{recipeVersion:'scene@999'}])assert.equal(await contract.matchSponsorSceneTemplate({...base,...wrong},{...actual,recipe:{...actual.recipe,...wrong}}),false);
 for(const mutate of [x=>x.offered.settings.calls.push({...x.offered.settings.calls[0]}),x=>x.offered.settings.calls[0].stage='render:0:initial',
  x=>x.offered.settings.calls[0].maximumInputTokens++,x=>x.offered.reason='Changed disclosure',x=>x.offered.settings.payload.references=[],
  x=>x.offered.settings.payload.sceneMedium='audio',x=>x.offered.settings.payload.productionMode='managed',x=>x.offered.maximumCalls=2,
  x=>x.offered.settings.payload.outputScene.contract.cachePolicy='automatic',x=>x.offered.settings.payload.outputScene.contract.maximumOutputTokens=3001,
  x=>x.offered.settings.payload.outputScene.sceneContract.fontSha256='a'.repeat(64),x=>x.offered.settings.payload.outputScene.intake.values.goalA.value='Swap the intent',
  x=>x.offered.settings.payload.outputScene.costPreview.maximumProviderCallCount=2]){
   const changed=structuredClone(actual);mutate(changed);changed.recipe.routeDigest=await digest(changed.offered);changed.recipe.settingsDigest=await digest(changed.offered.settings);
   assert.equal(await contract.matchSponsorSceneTemplate(base,changed),false);
 }
 const nativeContract=f.native.settings.payload.outputScene.contract,intake=f.native.settings.payload.outputScene.intake;
 const expected={model:nativeContract.model,instructions:nativeContract.instructions,input:nativeContract.input,text:{verbosity:'medium',format:{type:'json_schema',name:'document_scene',strict:true,schema:nativeContract.responseSchema}},
  reasoning:{effort:'low'},max_output_tokens:3000,store:false,safety_identifier:'forma_'+'a'.repeat(32),service_tier:'default',prompt_cache_options:{mode:'explicit'}};
 const original={contract:nativeContract,intake,body:JSON.stringify(expected),clientRequestId:'forma-scene-00000000-0000-4000-8000-000000000091',safetyIdentifier:expected.safety_identifier};
 const captured=await captureOutputSceneRequest(original);assert.equal(captured.attempt.logicalCallKey,'planning:0:initial');assert.ok(captured.attempt.maximumInputTokens<=nativeContract.maximumInputTokens);
 for(const change of [{store:true},{model:'other'},{prompt_cache_options:{mode:'automatic'}},{tools:[{type:'web_search'}]},{max_output_tokens:3001}])await assert.rejects(captureOutputSceneRequest({...original,body:JSON.stringify({...expected,...change})}));
 await assert.rejects(evidence.readSponsorSceneTemplateEvidence(f.trusted,f.command,{...description.recipe,maximumTokens:127999},f.native),/sponsor_native_envelope_mismatch/);
});

test('serialized, copied, missing-version and pre-write genuine proof never become current proof',async t=>{
 const f=await fixture(t),before=snapshot(f);
 for(const native of [structuredClone(f.native),JSON.parse(JSON.stringify(f.native)),{...f.native},null,f.oldNative])await assert.rejects(evidence.describeSponsorSceneAdmission(f.trusted,f.command,native));
 assert.deepEqual(snapshot(f),before);
 const noVersion=await preflightOutputSceneTarget({...f.nativeInput,sceneSourceVersion:undefined,sceneUseVersionedHistory:false});assert.equal(noVersion.available,true);
 assert.equal(outputScenePreflightProof(noVersion).prepared.sourceVersion,undefined);
 const afterProducer=snapshot(f);await assert.rejects(evidence.describeSponsorSceneAdmission(f.trusted,f.command,noVersion),/sponsor_scene_original_proof_required/);assert.deepEqual(snapshot(f),afterProducer);
});

test('exact deliberate actor approval is required; the collector never supplies missing confirmation',async t=>{
 const f=await fixture(t),original=structuredClone(f.command),before=snapshot(f);
 for(const approval of [undefined,{...original.sceneCostConsent,confirmed:false},{...original.sceneCostConsent,actorUserId:'payer-not-actor'},
  {...original.sceneCostConsent,maximumMicrousd:1000001},{...original.sceneCostConsent,maximumProviderCallCount:2},{...original.sceneCostConsent,extra:true},
  {...original.sceneCostConsent,bindingHash:'a'.repeat(64)},{...original.sceneCostConsent,expiresAt:new Date(Date.now()+86400000).toISOString()}]){
   const command={...original,sceneCostConsent:approval};await assert.rejects(evidence.describeSponsorSceneAdmission(f.trusted,command,f.native));
   assert.deepEqual(snapshot(f),before);
 }
 for(const change of [{sponsor_entitlement:{}},{expectedRevision:'output:0'},{maximumMicrousd:1000001},{explicitAuthorization:false},{documentId:'different'}])await assert.rejects(evidence.describeSponsorSceneAdmission(f.trusted,{...original,...change},f.native));
 assert.deepEqual(f.command,original);assert.deepEqual(snapshot(f),before);
});

test('nonpersonal scope and changed original native quote are refused without financial writes',async t=>{
 const f=await fixture(t),before=snapshot(f);
 for(const trusted of [{...f.trusted,scope:{...f.trusted.scope,kind:'project'}},{...f.trusted,principal:{...f.trusted.principal,fictional:true}},
  {...f.trusted,projectContext:{}},{...f.trusted,sourcePrivateCaptured:false},{...f.trusted,principal:{...f.trusted.principal,billingUserId:'payer'}}])await assert.rejects(evidence.describeSponsorSceneAdmission(trusted,f.command,f.native));
 assert.deepEqual(snapshot(f),before);
 await alterQuote(f,q=>{q.targets[0].settings.calls[0].maximumInputTokens++;});const after=snapshot(f);
 await assert.rejects(describe(f),/sponsor_scene_original_proof_mismatch/);assert.deepEqual(snapshot(f),after);
});

for(const mutation of ['retry','consent','source-private-aba','epoch','nonce','generation','source-retention','expiry'])test(`original native authority rejects ${mutation}`,async t=>{
 const f=await fixture(t);
 if(mutation==='retry')await alterQuote(f,q=>{q.operationAttempts[q.targets[0].targetId]={ordinal:1,previousSlotId:'previous'};});
 if(mutation==='consent')f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(actor);
 if(mutation==='source-private-aba')f.sqlite.prepare('UPDATE event_private_payloads SET private_json=private_json WHERE private_event_id=(SELECT event_id FROM events LIMIT 1)').run();
 if(mutation==='epoch')f.sqlite.prepare('UPDATE scene_source_epoch SET generation=generation+1 WHERE singleton=1').run();
 if(mutation==='nonce'){const guard=f.sqlite.prepare("SELECT sql FROM sqlite_schema WHERE name='scene_source_epoch_update_guard'").get().sql;f.sqlite.exec('DROP TRIGGER scene_source_epoch_update_guard');f.sqlite.prepare('UPDATE scene_source_epoch SET instance_nonce=? WHERE singleton=1').run('f'.repeat(32));f.sqlite.exec(guard);}
 if(mutation==='generation')f.sqlite.prepare("UPDATE scene_source_generations SET generation=generation+1 WHERE scope_kind='stream' AND scope_key=?").run(stream);
 if(mutation==='source-retention')f.sqlite.prepare('UPDATE private_content SET expires_at=? WHERE content_id LIKE ?').run(new Date(Date.now()-1).toISOString(),'experience-draft-%');
 if(mutation==='expiry')await alterQuote(f,q=>{q.expiresAt=new Date(Date.now()-1).toISOString();});
 const before=snapshot(f);await assert.rejects(describe(f));assert.deepEqual(snapshot(f),before);
});

for(const mutation of ['quote','plan','principal','request','database','environment','configuration','key','scope','principal-object','principal-stream','request-headers','email','display_name','consented_at'])test(`final original batch rejects late ${mutation} substitution`,async t=>{
 const f=await fixture(t),batch=f.DB.batch.bind(f.DB);let reached=false;
 f.DB.batch=async statements=>{reached=true;
  if(mutation==='quote')f.sqlite.prepare("UPDATE event_private_payloads SET private_json='{}' WHERE private_event_id=(SELECT event_id FROM output_preflights WHERE preflight_id=?)").run(f.command.preflightId);
  if(mutation==='plan')f.sqlite.prepare("UPDATE event_private_payloads SET private_json='{}' WHERE private_event_id=(SELECT confirmed_event_id FROM output_plan_revisions)").run();
  if(mutation==='principal')f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(actor);
  if(mutation==='request')f.trusted.request=new Request(f.request);
  if(mutation==='database')f.env.DB={...f.DB};
  if(mutation==='environment')f.trusted.env={...f.env};
  if(mutation==='configuration')f.env.OPENAI_MODEL='different';
  if(mutation==='key')f.env.OPENAI_API_KEY='another-synthetic-presence';
  if(mutation==='scope')f.trusted.principal.billingUserId='another-payer';
  if(mutation==='principal-object')f.trusted.principal={...f.trusted.principal};
  if(mutation==='principal-stream')f.trusted.principal.streamId='creative:other';
  if(mutation==='request-headers')f.request.headers.set('oai-authenticated-user-id','other');
  if(['email','display_name','consented_at'].includes(mutation))f.sqlite.prepare(`UPDATE users SET ${mutation}=? WHERE user_id=?`).run('changed-field',actor);
  return batch(statements);
 };
 await assert.rejects(describe(f));assert.equal(reached,true);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM document_jobs').get().n,0);
});

for(const fault of ['missing','sparse','false','failed','expired','row-proxy','batch-proxy'])test(`final read refuses ${fault} response without recapture`,async t=>{
 const f=await fixture(t),before=snapshot(f),batch=f.DB.batch.bind(f.DB),clock=Date.now;let reached=false;
 f.DB.batch=async statements=>{const results=await batch(statements);reached=true;
  if(fault==='missing')return results.slice(0,-1);if(fault==='sparse')delete results[0];if(fault==='false')results[0].results=[{current:0}];if(fault==='failed')results[0].success=false;
  if(fault==='row-proxy')results[0].results=new Proxy([{current:1},{current:0}],{get(target,key,receiver){return key==='length'?1:Reflect.get(target,key,receiver);}});
  if(fault==='batch-proxy'){const expected=results.length;results.push({success:false,results:[{current:0}]});return new Proxy(results,{get(target,key,receiver){return key==='length'?expected:Reflect.get(target,key,receiver);}});}
  if(fault==='expired')Date.now=()=>Date.parse(f.ready.sceneCostPreview.expiresAt);return results;
 };
 try{await assert.rejects(describe(f));}finally{Date.now=clock;}
 assert.equal(reached,true);assert.deepEqual(snapshot(f),before);
});

test('collector has no nonce activation, preparation, provider, authority or mutation imports',()=>{
 const source=readFileSync(new URL('../worker/experience-sponsor-scene-evidence.ts',import.meta.url),'utf8');
 for(const forbidden of [/\bcaptureSceneSourceVersion\b/u,/\bpreflightOutputSceneTarget\b/u,/\bensureSchema\b/u,/\bfetch\s*\(/u,/\bconfirmed\s*:\s*true/u,/\.run\s*\(/u,/\bINSERT\b/u,/\bUPDATE\b/u,/\bDELETE\b/u,/\brequireSponsorAdmission\b/u])assert.equal(forbidden.test(source),false,String(forbidden));
});


test('current provider configuration and local evidence limits are independently required',async t=>{
 const f=await fixture(t),before=snapshot(f),key=f.env.OPENAI_API_KEY,model=f.env.OPENAI_MODEL;
 for(const config of [{OPENAI_API_KEY:undefined},{OPENAI_MODEL:'other'}]){Object.assign(f.env,config);await assert.rejects(describe(f),/sponsor_scene_provider_unavailable/);Object.assign(f.env,{OPENAI_API_KEY:key,OPENAI_MODEL:model});}
 const trusted={...f.trusted,sourceAssertions:[...f.trusted.sourceAssertions,...Array.from({length:128},()=>({sql:'1',bindings:[]}))]};
 await assert.rejects(evidence.describeSponsorSceneAdmission(trusted,f.command,f.native),/sponsor_scene_evidence_limit/);assert.deepEqual(snapshot(f),before);
});

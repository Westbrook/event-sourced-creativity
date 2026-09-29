import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {createHash} from 'node:crypto';
import {outputTestDatabase,registerOutputSourceImports} from './output-execution-test-helpers.mjs';
const imports=registerOutputSourceImports();
const [{handleSession,POLICY_VERSION},{handleEvents},{streamHead},
  {handleOutputRequirements,loadOutputTrustedContext},{outputDocumentExecutionBridge},{createExperienceOutputRecipe},
  {handleExperienceIntake},{registeredExperience},{describeSponsorSlidesAdmission,readSponsorSlidesTemplateEvidence}]=await Promise.all([
  import('../worker/pilot-policy.ts'),import('../worker/events-api.ts'),import('../worker/runtime.ts'),
  import('../worker/output-requirements-api.ts'),import('../worker/output-document-execution.ts'),import('../worker/experience-output-recipe.ts'),
  import('../worker/experience-intake-api.ts'),import('../src/experiences/intake.ts'),import('../worker/experience-sponsor-slides-evidence.ts'),
]);
const originalFetch=globalThis.fetch,io={network:0,media:0,assets:0,detached:0};
globalThis.fetch=()=>{io.network++;throw Error('Slides inert evidence guards prohibit all network');};
after(()=>{globalThis.fetch=originalFetch;imports.deregister();assert.deepEqual(io,{network:0,media:0,assets:0,detached:0});});
const context={waitUntil(){io.detached++;throw Error('No detached work');}},path='/api/output-requirements',stream='creative:dev-local-creative';
const post=body=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const hash=value=>createHash('sha256').update(value).digest('hex');
const snapshot=f=>({schema:f.sqlite.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all(),
  changes:f.sqlite.prepare('SELECT total_changes() AS n').get().n,
  rows:f.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>[name,f.sqlite.prepare(`SELECT * FROM "${name.replaceAll('"','""')}" ORDER BY rowid`).all()])});
async function fixture(t){
  const f=outputTestDatabase();t.after(()=>f.sqlite.close());Object.assign(f.env,{OPENAI_API_KEY:'synthetic-presence-no-egress',OPENAI_MODEL:'gpt-5.6-terra'});
  for(const method of ['get','head','put','delete','list'])f.env.MEDIA[method]=()=>{io.media++;throw Error('No media access');};
  f.env.ASSETS.fetch=()=>{io.assets++;throw Error('No assets access');};
  assert.equal((await handleSession(new Request('http://localhost/api/session'),f.env)).status,200);
  f.sqlite.prepare('UPDATE users SET consent_version=?').run(POLICY_VERSION);
  assert.equal((await handleEvents(new Request('http://localhost/api/events'),f.env)).status,200);
  const release=await registeredExperience('slides');assert.ok(release);
  const intent={experienceId:'slides',intentId:'00000000-0000-4000-8000-000000000094',releaseHash:release.releaseHash,values:{
    claim:{value:'The local export is ready for review.',provenance:'authored'},
    evidence:{value:[{id:'e1',text:'The exported file opens.'},{id:'e2',text:'Its saved dimensions match the request.'},{id:'e3',text:'The source remains unchanged.'}],provenance:'authored'},
  }};
  let response=await handleExperienceIntake(new Request('http://localhost/api/experiences/drafts',post(intent)),f.env);
  assert.equal(response.status,200,await response.clone().text());const plan=(await response.json()).plan;
  response=await handleExperienceIntake(new Request(`http://localhost/api/experiences/drafts/${plan.draftId}/commit`,post({draftHash:plan.draftHash})),f.env);
  assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).status,'complete');
  const documentId=plan.documentId;let sequence=0;
  const send=async body=>{const response=await handleOutputRequirements(new Request(`http://localhost${path}`,post({documentId,
    expectedRevision:`output:${await streamHead(f.env,stream)}`,clientMutationId:`guard-setup-${++sequence}`,...body})),f.env,path,context,outputDocumentExecutionBridge);
    const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;};
  const recipe=createExperienceOutputRecipe({output:'slides',requirementId:'slides-requirement',deliverableId:'slides-deliverable'});
  await send({action:'save',blockId:recipe.spec.id,spec:recipe.spec});const confirmed=await send({action:'confirm'});
  const preflight=await send({action:'preflight',planRevisionId:confirmed.command.planRevisionId,targetIds:confirmed.snapshot.confirmedPlan.plan.targets.map(target=>target.id)});
  const terms=preflight.command.preflight;assert.ok(terms.targets.every(target=>target.available),JSON.stringify(terms));
  const command={documentId,action:'authorize',expectedRevision:preflight.snapshot.revision,clientMutationId:'slides-guard-authorize',
    preflightId:terms.id,termsDigest:terms.termsDigest,maximumMicrousd:terms.maximumMicrousd,explicitAuthorization:true};
  const controller=new AbortController(),request=new Request(`http://localhost${path}`,{...post(command),signal:controller.signal});
  const trusted=await loadOutputTrustedContext(request,f.env,documentId,'request');assert.ok(!(trusted instanceof Response));
  Object.assign(f,{documentId,terms,command,controller,request,trusted});
  const prepare=f.DB.prepare.bind(f.DB);let writeAttempts=0;
  f.DB.prepare=sql=>{if(!/^\s*SELECT\b/iu.test(sql)){writeAttempts++;throw Error('Evidence attempted non-read SQL');}return prepare(sql);};
  t.after(()=>assert.equal(writeAttempts,0));return f;
}
function assertUnpaid(f){
  for(const table of ['document_jobs','output_execution_grants','output_operation_slots','output_provider_calls','budget_reservations','cost_budget_reservations'])
    assert.equal(f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,0,table);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'experience_sponsor_%'").get().n,0);
}
function captureFinalBatch(f,afterRead){
  const original=f.DB.batch.bind(f.DB),trace=[];
  f.DB.batch=async statements=>{
    assert.ok(statements.length>0);assert.ok(statements.every(statement=>statement.sql.startsWith('SELECT CASE WHEN (')&&statement.sql.endsWith('END AS current')),'Hook must be the real final proof-only batch');
    const results=await original(statements);
    assert.equal(results.length,statements.length);
    for(let i=0;i<results.length;i++){assert.ok(Object.hasOwn(results,i));assert.equal(results[i].success,true);assert.equal(results[i].results[0].current,1,'All real native authority assertions must pass before the fault');}
    trace.push({count:statements.length,assertions:statements.map((statement,index)=>({index,sqlSha256:hash(statement.sql),sqlBytes:Buffer.byteLength(statement.sql),bindings:statement.bindings.length,
      kind:statement.sql.includes('terms_digest=? AND expires_at=? AND private_json=?')?'retained-native-quote':statement.sql.includes('json_array(captured.user_id')?'principal-snapshot':'original-source-proof'}))});
    return afterRead?afterRead(results):results;
  };
  return trace;
}
async function preparedRead(f,api){
  if(api==='description')return ()=>describeSponsorSlidesAdmission(f.trusted,f.command);
  const original=await describeSponsorSlidesAdmission(f.trusted,f.command);
  return ()=>readSponsorSlidesTemplateEvidence(f.trusted,f.command,original.recipe);
}
test('Slides final native proof control returns unchanged public shapes from actual registered intake without writes',async t=>{
  const f=await fixture(t),before=snapshot(f),trace=captureFinalBatch(f);
  const description=await describeSponsorSlidesAdmission(f.trusted,f.command),evidence=await readSponsorSlidesTemplateEvidence(f.trusted,f.command,description.recipe);
  assert.deepEqual(Object.keys(description).sort(),['actorKind','actorUserId','sessionDigest','ownerUserId','projectId','documentId','sourceRevision','sourceDigest','orderedAssetDigests','rightsDigest','compiledInputDigest','transferEnvelopeDigest','recipe','preflightExpiresAtMs'].sort());
  assert.deepEqual(Object.keys(evidence).sort(),['recipe','offered','composition'].sort());assert.deepEqual(evidence.recipe,description.recipe);
  assert.equal(evidence.recipe.outputKind,'slides');assert.equal(evidence.recipe.outputCount,1);assert.equal(evidence.offered.settings.payload.requestedSlideCount,5);
  assert.equal(trace.length,2);assert.deepEqual(snapshot(f),before);assertUnpaid(f);
  t.diagnostic(JSON.stringify({api:'both-control',trace,io}));
});
for(const api of ['description','template'])for(const fault of ['abort','sparse'])test(`Slides ${api} final native proof ${fault} must refuse inert evidence`,async t=>{
  const f=await fixture(t),read=await preparedRead(f,api),before=snapshot(f);let faultReached=0;
  const trace=captureFinalBatch(f,results=>{
    faultReached++;
    if(fault==='abort'){f.controller.abort();assert.equal(f.request.signal.aborted,true);return results;}
    const expected=results.length;delete results[0];assert.equal(results.length,expected);assert.equal(Object.hasOwn(results,0),false);return results;
  });
  let value,error;try{value=await read();}catch(failure){error=failure;}
  assert.equal(faultReached,1);assert.equal(trace.length,1);assert.deepEqual(snapshot(f),before);assertUnpaid(f);
  t.diagnostic(JSON.stringify({api,fault,realFinalBatchReached:true,realAcknowledgementsInitiallyDenseAndPassing:true,trace,aborted:f.request.signal.aborted,returnedInertEvidence:value!==undefined,unchangedRowsSchemaTotalChanges:true,io}));
  assert.ok(error,`${fault} after the real native final proof batch must not return ${api} evidence`);
});

for(const api of ['description','template'])test(`Slides ${api} already-aborted request refuses before its first owned database read`,async t=>{
  const f=await fixture(t),read=await preparedRead(f,api),before=snapshot(f),prepare=f.DB.prepare.bind(f.DB),batch=f.DB.batch.bind(f.DB);
  let preparations=0,batches=0;f.DB.prepare=sql=>{preparations++;return prepare(sql);};f.DB.batch=statements=>{batches++;return batch(statements);};
  f.controller.abort();let error;try{await read();}catch(failure){error=failure;}
  assert.ok(error,'An already-aborted request must refuse');assert.equal(preparations,0);assert.equal(batches,0);assert.deepEqual(snapshot(f),before);assertUnpaid(f);
});

for(const api of ['description','template'])for(const fault of ['missing-slot','undefined-slot','failed-success','missing-success','string-current','extra-row','inherited-slot','results-getter','current-getter'])
test(`Slides ${api} malformed final acknowledgement ${fault} refuses without invoking accessors`,async t=>{
  const f=await fixture(t),read=await preparedRead(f,api),before=snapshot(f);let reached=0,getters=0;
  const trace=captureFinalBatch(f,results=>{
    reached++;
    if(fault==='missing-slot')return results.slice(0,-1);
    if(fault==='undefined-slot')results[0]=undefined;
    if(fault==='failed-success')results[0].success=false;
    if(fault==='missing-success')delete results[0].success;
    if(fault==='string-current')results[0].results[0].current='1';
    if(fault==='extra-row')results[0].results.push({current:1});
    if(fault==='inherited-slot'){const original=results[0];delete results[0];Object.setPrototypeOf(results,Object.assign(Object.create(Array.prototype),{0:original}));assert.equal(Object.hasOwn(results,0),false);}
    if(fault==='results-getter'){const original=results[0].results;Object.defineProperty(results[0],'results',{get(){getters++;return original;}});}
    if(fault==='current-getter')Object.defineProperty(results[0].results[0],'current',{get(){getters++;return 1;}});
    return results;
  });
  let error;try{await read();}catch(failure){error=failure;}
  assert.equal(reached,1);assert.equal(trace.length,1);assert.deepEqual(snapshot(f),before);assertUnpaid(f);
  assert.ok(error,`${fault} final acknowledgment must refuse`);assert.equal(getters,0,'The evidence collector must inspect own data descriptors without running supplied accessors');
});

import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {outputTestDatabase,registerOutputSourceImports} from './output-execution-test-helpers.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';
const imports=registerOutputSourceImports();
const [{handleSession,POLICY_VERSION},{handleEvents},{appendAuditEvent,streamHead},{handleOutputRequirements,loadOutputTrustedContext,outputDigest},
  {outputDocumentExecutionBridge},{createExperienceOutputRecipe},{SHORT_STORY_NARRATIVE_CONTRACT},{OUTPUT_NATIVE_EXECUTION_POLICY},
  {OPENAI_TEXT_PRICING_VERSION,estimateOpenAITextCallMaximumMicrousd},{describeSponsorStoryAdmission,readSponsorStoryTemplateEvidence},contract]=await Promise.all([
  import('../worker/pilot-policy.ts'),import('../worker/events-api.ts'),import('../worker/runtime.ts'),import('../worker/output-requirements-api.ts'),
  import('../worker/output-document-execution.ts'),import('../worker/experience-output-recipe.ts'),import('../src/model/output-narrative-contract.ts'),
  import('../src/model/output-execution-policy.ts'),import('../worker/openai-text-cost.ts'),import('../worker/experience-sponsor-story-evidence.ts'),import('../worker/experience-sponsor-story-contract.ts'),
]);
const fetchDescriptor=Object.getOwnPropertyDescriptor(globalThis,"fetch");let egress=0,mediaAccess=0,assetsAccess=0;
globalThis.fetch=()=>{egress++;throw Error('No network in dormant story evidence qualification');};
after(()=>{Object.defineProperty(globalThis,"fetch",fetchDescriptor);imports.deregister();assert.equal(egress,0);assert.equal(mediaAccess,0);assert.equal(assetsAccess,0);});
const actor='dev-local-creative',stream=`creative:${actor}`,path='/api/output-requirements';
const executionContext={waitUntil(){throw Error('No detached work');}};
const post=body=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const rows=f=>f.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>[name,f.sqlite.prepare(`SELECT * FROM "${name.replaceAll('"','""')}" ORDER BY rowid`).all()]);
const snapshot=f=>({rows:rows(f),changes:f.sqlite.prepare('SELECT total_changes() AS n').get().n,
  schema:f.sqlite.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all()});
async function fixture(t,{sourceDeadline}={}){
  const f=outputTestDatabase();t.after(()=>f.sqlite.close());Object.assign(f.env,{OPENAI_API_KEY:'synthetic-presence-no-egress',OPENAI_MODEL:'gpt-5.6-terra'});
  for(const operation of ['get','head','put','delete','list'])f.env.MEDIA[operation]=()=>{mediaAccess++;throw Error('No media access');};
  f.env.ASSETS.fetch=()=>{assetsAccess++;throw Error('No asset fetch');};
  assert.equal((await handleSession(new Request('http://localhost/api/session'),f.env)).status,200);
  f.sqlite.prepare('UPDATE users SET consent_version=?').run(POLICY_VERSION);
  assert.equal((await handleEvents(new Request('http://localhost/api/events'),f.env)).status,200);
  const documentId='sponsor-native-story';
  await appendAuditEvent(f.env,stream,'user','DocumentCreated',{document_id:documentId,project_id:'project-atmosphere',title:'Synthetic story fixture'});
  await appendAuditEvent(f.env,stream,'user','BlockCreated',{document_id:documentId,project_id:'project-atmosphere',block_id:'story-source',type:'subject',handle:'story-source',position:'0',properties:{text:'Mira chooses to return a lost clock despite missing the last train.',weight:1,...(sourceDeadline?{rights_expires_at:new Date(sourceDeadline).toISOString()}: {})}});
  let sequence=0;
  const send=async body=>{const response=await handleOutputRequirements(new Request(`http://localhost${path}`,post({documentId,expectedRevision:`output:${await streamHead(f.env,stream)}`,clientMutationId:`setup-${++sequence}`,...body})),f.env,path,executionContext,outputDocumentExecutionBridge);const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;};
  const recipe=createExperienceOutputRecipe({output:'short_story',requirementId:'story-requirement',deliverableId:'story-deliverable',contract:SHORT_STORY_NARRATIVE_CONTRACT});
  await send({action:'save',blockId:recipe.spec.id,spec:recipe.spec});
  const confirmed=await send({action:'confirm'});
  const preflight=await send({action:'preflight',planRevisionId:confirmed.command.planRevisionId,targetIds:confirmed.snapshot.confirmedPlan.plan.targets.map(target=>target.id)});
  const terms=preflight.command.preflight;assert.ok(terms.targets.every(target=>target.available),JSON.stringify(terms));
  const command={documentId,action:'authorize',expectedRevision:preflight.snapshot.revision,clientMutationId:'story-authorize',preflightId:terms.id,termsDigest:terms.termsDigest,maximumMicrousd:terms.maximumMicrousd,explicitAuthorization:true};
  const request=new Request(`http://localhost${path}`,post(command)),trusted=await loadOutputTrustedContext(request,f.env,documentId,'request');assert.ok(!(trusted instanceof Response));
  return {...f,documentId,terms,command,request,trusted};
}
function template(recipe){return {version:1,family:'canonical-short-story@1',appId:'short-story',recipeVersion:recipe.recipeVersion,releaseDigest:recipe.releaseDigest,
  outputKind:'short_story',inputMode:'authorized-document-text',outputCount:1,durationMs:0,width:0,height:0,route:'document-short-story-manual-v1',maximumCalls:1,maximumTokens:128000,
  maximumInputTokens:122000,maximumOutputTokens:6000,maximumMicrousd:Math.max(1_000_000,estimateOpenAITextCallMaximumMicrousd('gpt-5.6-terra',122000,6000)),
  call:{stage:'planning:0:initial',provider:'openai',model:'gpt-5.6-terra'},narrativeContract:SHORT_STORY_NARRATIVE_CONTRACT,pricingVersion:OPENAI_TEXT_PRICING_VERSION,
  cachePolicy:'disabled-explicit',reasoningEffort:'low',executionPolicy:OUTPUT_NATIVE_EXECUTION_POLICY};}
async function alterQuote(f,change){const row=f.sqlite.prepare('SELECT event_id FROM output_preflights WHERE preflight_id=?').get(f.command.preflightId);const body=JSON.parse(f.sqlite.prepare('SELECT private_json FROM event_private_payloads WHERE private_event_id=?').get(row.event_id).private_json);change(body.preflight);const {termsDigest:ignored,...rest}=body.preflight;void ignored;body.preflight.termsDigest=await outputDigest(rest);f.command.termsDigest=body.preflight.termsDigest;f.sqlite.prepare('UPDATE output_preflights SET terms_digest=?,expires_at=? WHERE event_id=?').run(body.preflight.termsDigest,body.preflight.expiresAt,row.event_id);f.sqlite.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run(JSON.stringify(body),row.event_id);}

test('actual ordinary story plan/preflight becomes read-only finite one-call evidence under strict local SQL limits',async t=>{
  const f=await fixture(t),before=snapshot(f),limits=enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}});t.after(()=>limits.restore());
  const described=await describeSponsorStoryAdmission(f.trusted,f.command),actual=await readSponsorStoryTemplateEvidence(f.trusted,f.command,described.recipe);
  const reviewed=contract.readSponsorStoryCampaignTemplate(template(described.recipe));
  assert.equal(await contract.matchSponsorStoryTemplate(reviewed,actual),true);assert.deepEqual(described.recipe.calls,{parsing:0,planning:1,render:0,repair:0});
  assert.equal(actual.offered.settings.kind,'render_document');assert.equal(actual.offered.settings.payload.artifactKind,'short_story');assert.equal(actual.offered.settings.calls[0].stage,'planning:0:initial');
  assert.equal(described.actorUserId,actor);assert.equal(described.ownerUserId,actor);assert.deepEqual(described.orderedAssetDigests,[]);
  assert.ok(Object.isFrozen(described.recipe.calls));assert.ok(Object.isFrozen(actual.offered.settings.payload));assert.deepEqual(snapshot(f),before);limits.assertVerified();
  t.diagnostic(JSON.stringify({strictLocalSqlStatements:limits.records.length,maximumBindings:Math.max(...limits.boundCounts),limits:{expressionDepth:100,functionArguments:32,parameters:100,sqlBytes:100000},egress,mediaAccess,assetsAccess}));
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM document_jobs').get().n,0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'experience_sponsor_%'").get().n,0);
});

test('closed template rejects guest collision, media expansion, render fiction and unsafe object grammar',async t=>{
  const f=await fixture(t),native=await describeSponsorStoryAdmission(f.trusted,f.command),base=template(native.recipe);
  for(const change of [{version:3},{family:'guest-story@1'},{maximumCalls:2},{maximumInputTokens:122001},{maximumOutputTokens:6001},{maximumMicrousd:base.maximumMicrousd+1},{outputKind:'image'},{call:{...base.call,stage:'render:0:initial'}},{extra:true}])assert.throws(()=>contract.readSponsorStoryCampaignTemplate({...base,...change}),/sponsor_story_contract_invalid/);
  let accessed=0;const unsafe={...base};Object.defineProperty(unsafe,'family',{enumerable:true,get(){accessed++;return base.family;}});assert.throws(()=>contract.readSponsorStoryCampaignTemplate(unsafe));assert.equal(accessed,0);
  assert.equal(contract.recipeMatchesSponsorStoryTemplate(base,{...native.recipe,calls:{parsing:0,planning:1,render:1,repair:0}}),false);
  const actual=await readSponsorStoryTemplateEvidence(f.trusted,f.command,native.recipe);
  const mutableActual=structuredClone(actual),mutableTemplate=structuredClone(base);
  const pending=contract.matchSponsorStoryTemplate(mutableTemplate,mutableActual);
  mutableTemplate.family='guest-story@1';mutableTemplate.maximumInputTokens=0;
  mutableActual.offered.settings.payload.artifactKind='slides';mutableActual.offered.settings.calls[0].stage='render:0:initial';
  assert.equal(await pending,true,'matching uses the original captured values, never later mutable input');
  assert.equal(await contract.matchSponsorStoryTemplate(mutableTemplate,mutableActual),false);
  for(const mutate of [x=>x.offered.settings.payload.outputNarrative.maximumOutputTokens++,x=>x.offered.settings.calls[0].stage='render:0:initial',x=>x.offered.settings.payload.references=[],x=>x.offered.settings.payload.artifactKind='slides']){const changed=structuredClone(actual);mutate(changed);assert.equal(await contract.matchSponsorStoryTemplate(base,changed),false);}
  await assert.rejects(readSponsorStoryTemplateEvidence(f.trusted,f.command,{...native.recipe,maximumTokens:127999}),/sponsor_native_envelope_mismatch/);
});

test('native reader refuses wire privilege, nonpersonal identity and source-dependent quote tampering without writes',async t=>{
  const f=await fixture(t);
  for(const command of [{...f.command,sponsor_entitlement:{}},{...f.command,maximumMicrousd:f.command.maximumMicrousd+1},{...f.command,expectedRevision:'output:0'},{...f.command,explicitAuthorization:false}]){const before=snapshot(f);await assert.rejects(describeSponsorStoryAdmission(f.trusted,command));assert.deepEqual(snapshot(f),before);}
  for(const trusted of [{...f.trusted,scope:{...f.trusted.scope,kind:'project'}},{...f.trusted,principal:{...f.trusted.principal,fictional:true}},{...f.trusted,projectContext:{}},{...f.trusted,sourcePrivateCaptured:false}])await assert.rejects(describeSponsorStoryAdmission(trusted,f.command));
  await alterQuote(f,q=>{q.targets[0].settings.payload.outputNarrative.maximumInputTokens++;q.targets[0].settings.calls[0].maximumInputTokens++;});
  const before=snapshot(f);await assert.rejects(describeSponsorStoryAdmission(f.trusted,f.command),/sponsor_recipe_unsupported/);assert.deepEqual(snapshot(f),before);
});

test('original-attempt, current consent, source head and quote expiry are required',async t=>{
  for(const mutation of ['retry','consent','head','expiry']){const f=await fixture(t);
    if(mutation==='retry')await alterQuote(f,q=>{q.operationAttempts[q.targets[0].targetId]={ordinal:1,previousSlotId:'previous'};});
    if(mutation==='consent')f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(actor);
    if(mutation==='head')await appendAuditEvent(f.env,stream,'user','BlockCreated',{document_id:f.documentId,project_id:'project-atmosphere',block_id:'later',type:'direction',handle:'later',position:'1',properties:{text:'Changed ending',weight:1}});
    if(mutation==='expiry')await alterQuote(f,q=>{q.expiresAt=new Date(Date.now()-1).toISOString();});
    const before=snapshot(f);await assert.rejects(describeSponsorStoryAdmission(f.trusted,f.command));assert.deepEqual(snapshot(f),before);
  }
});

test('final atomic read detects late private-body/principal mutation and refuses Request/DB substitution',async t=>{
  for(const mutation of ['quote','principal','request','database','configuration','scope']){const f=await fixture(t),batch=f.DB.batch.bind(f.DB);let reached=false;
    f.DB.batch=async statements=>{reached=true;
      if(mutation==='quote')f.sqlite.prepare("UPDATE event_private_payloads SET private_json='{}' WHERE private_event_id=(SELECT event_id FROM output_preflights WHERE preflight_id=?)").run(f.command.preflightId);
      if(mutation==='principal')f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(actor);
      if(mutation==='request')f.trusted.request=new Request(f.request);
      if(mutation==='database')f.env.DB={...f.DB};
      if(mutation==='configuration')f.env.OPENAI_MODEL='different';
      if(mutation==='scope')f.trusted.principal.billingUserId='another-payer';
      return batch(statements);
    };
    await assert.rejects(describeSponsorStoryAdmission(f.trusted,f.command));assert.equal(reached,true);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM document_jobs').get().n,0);
  }
});


test('source rights must still be live after the final read completes',async t=>{
  const deadline=Date.now()+60_000,f=await fixture(t,{sourceDeadline:deadline}),batch=f.DB.batch.bind(f.DB),clock=Date.now;
  let reached=false;
  f.DB.batch=async statements=>{const result=await batch(statements);reached=true;Date.now=()=>deadline;return result;};
  const before=snapshot(f);
  try{await assert.rejects(describeSponsorStoryAdmission(f.trusted,f.command),/sponsor_authority_changed/);}finally{Date.now=clock;}
  assert.equal(reached,true);assert.deepEqual(snapshot(f),before);
});

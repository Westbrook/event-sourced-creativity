import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {outputTestDatabase,registerOutputSourceImports} from './output-execution-test-helpers.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';
const imports=registerOutputSourceImports();
const [{handleSession,POLICY_VERSION},{handleEvents},{appendAuditEvent,streamHead},{handleOutputRequirements,loadOutputTrustedContext,outputDigest,rememberOutputPrivateBody},
  {outputDocumentExecutionBridge},{createExperienceOutputRecipe},{handleExperienceIntake},{registeredExperience},{OUTPUT_NATIVE_EXECUTION_POLICY},
  {estimateOpenAITextCallMaximumMicrousd},{PRESENTATION_ADAPTER_VERSION,preparePresentationComparisonRequest,buildDocumentPresentationSourceContract},
  {readFrozenPresentationModelRoutes},{describeSponsorSlidesAdmission,readSponsorSlidesTemplateEvidence},contract]=await Promise.all([
  import('../worker/pilot-policy.ts'),import('../worker/events-api.ts'),import('../worker/runtime.ts'),import('../worker/output-requirements-api.ts'),
  import('../worker/output-document-execution.ts'),import('../worker/experience-output-recipe.ts'),import('../worker/experience-intake-api.ts'),import('../src/experiences/intake.ts'),
  import('../src/model/output-execution-policy.ts'),import('../worker/openai-text-cost.ts'),import('../worker/openai-adapter.ts'),import('../worker/presentation-model-routing.ts'),
  import('../worker/experience-sponsor-slides-evidence.ts'),import('../worker/experience-sponsor-slides-contract.ts'),
]);
const fetchDescriptor=Object.getOwnPropertyDescriptor(globalThis,'fetch');let egress=0,mediaAccess=0,assetsAccess=0,detached=0;
globalThis.fetch=()=>{egress++;throw Error('No network in dormant Slides evidence qualification');};
after(()=>{Object.defineProperty(globalThis,'fetch',fetchDescriptor);imports.deregister();assert.equal(egress,0);assert.equal(mediaAccess,0);assert.equal(assetsAccess,0);assert.equal(detached,0);});
const actor='dev-local-creative',stream=`creative:${actor}`,path='/api/output-requirements';
const executionContext={waitUntil(){detached++;throw Error('No detached work');}};
const post=body=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const rows=f=>f.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>[name,f.sqlite.prepare(`SELECT * FROM "${name.replaceAll('"','""')}" ORDER BY rowid`).all()]);
const snapshot=f=>({rows:rows(f),changes:f.sqlite.prepare('SELECT total_changes() AS n').get().n,schema:f.sqlite.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all()});
const exactFive={kind:'exact',unit:'slide',value:5};
function noWrites(f){const prepare=f.DB.prepare.bind(f.DB);let attempted=0;
  f.DB.prepare=sql=>{if(!/^\s*SELECT\b/iu.test(sql)){attempted++;throw Error('Evidence attempted non-read SQL');}return prepare(sql);};
  return ()=>assert.equal(attempted,0,'No SQL write attempt, including a no-op, is allowed during evidence reads');
}
async function fixture(t,{configuration={},sourceText,sourceDeadline,extraBlock,intake=true}={}){
  const f=outputTestDatabase();t.after(()=>f.sqlite.close());Object.assign(f.env,{OPENAI_API_KEY:'synthetic-presence-no-egress',OPENAI_MODEL:'gpt-5.6-terra'},configuration);
  for(const operation of ['get','head','put','delete','list'])f.env.MEDIA[operation]=()=>{mediaAccess++;throw Error('No media access');};
  f.env.ASSETS.fetch=()=>{assetsAccess++;throw Error('No asset fetch');};
  assert.equal((await handleSession(new Request('http://localhost/api/session'),f.env)).status,200);
  f.sqlite.prepare('UPDATE users SET consent_version=?').run(POLICY_VERSION);
  assert.equal((await handleEvents(new Request('http://localhost/api/events'),f.env)).status,200);
  let documentId='sponsor-native-slides',projectId='project-atmosphere';
  if(intake){
    const release=await registeredExperience('slides');assert.ok(release);
    const intent={experienceId:'slides',intentId:'00000000-0000-4000-8000-000000000094',releaseHash:release.releaseHash,values:{
      claim:{value:'The local export is ready for review.',provenance:'authored'},
      evidence:{value:[{id:'e1',text:'The exported file opens.'},{id:'e2',text:'Its saved dimensions match the request.'},{id:'e3',text:'The source remains unchanged.'}],provenance:'authored'},
    }};
    let response=await handleExperienceIntake(new Request('http://localhost/api/experiences/drafts',post(intent)),f.env);
    assert.equal(response.status,200,await response.clone().text());const plan=(await response.json()).plan;
    response=await handleExperienceIntake(new Request(`http://localhost/api/experiences/drafts/${plan.draftId}/commit`,post({draftHash:plan.draftHash})),f.env);
    assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).status,'complete');documentId=plan.documentId;projectId=plan.projectId;
  }else{
    await appendAuditEvent(f.env,stream,'user','DocumentCreated',{document_id:documentId,project_id:projectId,title:'Synthetic Slides fixture'});
    await appendAuditEvent(f.env,stream,'user','BlockCreated',{document_id:documentId,project_id:projectId,block_id:'slides-source',type:'subject',handle:'slides-source',position:'0',properties:{text:sourceText??'The copper lamp is on the wooden desk.',weight:1,...(sourceDeadline?{rights_expires_at:new Date(sourceDeadline).toISOString()}: {})}});
  }
  if(extraBlock){
    if(extraBlock.type==='reference')await appendAuditEvent(f.env,stream,'user','RightsAsserted',{reference_id:extraBlock.properties.reference_id,rights_class:'owned'});
    await appendAuditEvent(f.env,stream,'user','BlockCreated',{document_id:documentId,project_id:projectId,block_id:'extra-source',handle:'extra-source',position:'1',...extraBlock});
  }
  let sequence=0;
  const send=async body=>{const response=await handleOutputRequirements(new Request(`http://localhost${path}`,post({documentId,expectedRevision:`output:${await streamHead(f.env,stream)}`,clientMutationId:`setup-${++sequence}`,...body})),f.env,path,executionContext,outputDocumentExecutionBridge);const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;};
  const recipe=createExperienceOutputRecipe({output:'slides',requirementId:'slides-requirement',deliverableId:'slides-deliverable'});
  await send({action:'save',blockId:recipe.spec.id,spec:recipe.spec});const confirmed=await send({action:'confirm'});
  const preflight=await send({action:'preflight',planRevisionId:confirmed.command.planRevisionId,targetIds:confirmed.snapshot.confirmedPlan.plan.targets.map(target=>target.id)});
  const terms=preflight.command.preflight;assert.ok(terms.targets.every(target=>target.available),JSON.stringify(terms));
  const command={documentId,action:'authorize',expectedRevision:preflight.snapshot.revision,clientMutationId:'slides-authorize',preflightId:terms.id,termsDigest:terms.termsDigest,maximumMicrousd:terms.maximumMicrousd,explicitAuthorization:true};
  const request=new Request(`http://localhost${path}`,post(command)),trusted=await loadOutputTrustedContext(request,f.env,documentId,'request');assert.ok(!(trusted instanceof Response));
  return {...f,documentId,terms,command,request,trusted};
}
function template(recipe,offered){const calls=offered.settings.calls.map((call,index)=>({stage:call.stage,provider:'openai',model:call.model,optional:index===1,presentationRoute:structuredClone(call.presentationRoute),maximumInputTokens:121500,maximumOutputTokens:6500,maximumMicrousd:Math.max(500000,estimateOpenAITextCallMaximumMicrousd(call.model,121500,6500))}));
  return {version:1,family:'canonical-five-slide-deck@1',appId:'slides',recipeVersion:recipe.recipeVersion,releaseDigest:recipe.releaseDigest,outputKind:'slides',inputMode:'authorized-document-text',outputCount:1,durationMs:0,width:0,height:0,slideCountPolicy:exactFive,route:'document-slides-manual-v1',maximumCalls:2,maximumTokens:128000,maximumMicrousd:calls.reduce((sum,call)=>sum+call.maximumMicrousd,0),calls,adapterVersion:PRESENTATION_ADAPTER_VERSION,sourceContractVersion:2,executionPolicy:OUTPUT_NATIVE_EXECUTION_POLICY};
}
async function actualEvidence(f){const described=await describeSponsorSlidesAdmission(f.trusted,f.command);return {described,actual:await readSponsorSlidesTemplateEvidence(f.trusted,f.command,described.recipe)};}
async function alterQuote(f,change){const row=f.sqlite.prepare('SELECT event_id FROM output_preflights WHERE preflight_id=?').get(f.command.preflightId);const original=f.sqlite.prepare('SELECT private_json FROM event_private_payloads WHERE private_event_id=?').get(row.event_id).private_json;const body=JSON.parse(original);change(body.preflight);const {termsDigest:ignored,...rest}=body.preflight;void ignored;body.preflight.termsDigest=await outputDigest(rest);f.command.termsDigest=body.preflight.termsDigest;f.sqlite.prepare('UPDATE output_preflights SET terms_digest=?,expires_at=? WHERE event_id=?').run(body.preflight.termsDigest,body.preflight.expiresAt,row.event_id);f.sqlite.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run(JSON.stringify(body),row.event_id);return {eventId:row.event_id,original};}
async function redigest(actual){actual.recipe.routeDigest=`sha256:${await outputDigest(actual.offered)}`;actual.recipe.settingsDigest=`sha256:${await outputDigest(actual.offered.settings)}`;}
function assertUnpaid(f){for(const name of ['document_jobs','output_execution_grants','output_operation_slots','output_provider_calls','budget_reservations','cost_budget_reservations'])assert.equal(f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get().n,0,name);assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'experience_sponsor_%'").get().n,0);}

test('registered Slides intake and actual native composition produce read-only exact-five evidence under strict SQL limits',async t=>{
  const f=await fixture(t),before=snapshot(f),limits=enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}});t.after(()=>limits.restore());const assertReadOnly=noWrites(f);
  const {described,actual}=await actualEvidence(f),reviewed=contract.readSponsorSlidesCampaignTemplate(template(described.recipe,actual.offered));
  assert.equal(await contract.matchSponsorSlidesTemplate(reviewed,actual),true);assert.deepEqual(described.recipe.calls,{parsing:0,planning:1,render:0,repair:1});
  assert.equal(described.recipe.outputCount,1);assert.deepEqual(actual.offered.settings.payload.slideCountPolicy,exactFive);assert.equal(actual.offered.settings.payload.requestedSlideCount,5);
  assert.deepEqual(actual.offered.settings.calls.map(call=>call.stage),['planning:0:initial','planning:0:repair']);assert.deepEqual(reviewed.calls.map(call=>call.optional),[false,true]);
  const facts=f.trusted.context.snapshot.facts;assert.equal(facts.filter(fact=>fact.type==='message').length,2);assert.ok(facts.some(fact=>fact.type==='format'&&fact.properties.text.includes('5 slides')));
  const routes=readFrozenPresentationModelRoutes({composition:actual.offered.settings.calls[0].presentationRoute,repair:actual.offered.settings.calls[1].presentationRoute});
  const options={productionMode:'manual',itemCount:5,requestedSlideCount:5,slideCountPolicy:exactFive,outputTargetInstructions:actual.offered.settings.payload.outputTargetInstructions,presentationModelRoutes:routes};
  const prepared=await preparePresentationComparisonRequest(f.env,actor,{documentTitle:f.trusted.context.projection.documentTitle,snapshot:f.trusted.context.snapshot,options});const wire=JSON.parse(prepared.requestBody);
  assert.equal(wire.text.format.strict,true);assert.equal(wire.text.format.name,'document_slides');assert.deepEqual([wire.text.format.schema.properties.items.minItems,wire.text.format.schema.properties.items.maxItems],[5,5]);
  assert.equal(actual.composition.requestDigest,`sha256:${prepared.requestDigest}`);assert.equal(actual.composition.schemaDigest,`sha256:${await outputDigest(wire.text.format.schema)}`);assert.equal(actual.composition.sourceContractDigest,`sha256:${await outputDigest(buildDocumentPresentationSourceContract(f.trusted.context.snapshot,options))}`);
  assert.deepEqual(Object.keys(actual.composition).sort(),['phase','requestDigest','schemaDigest','sourceContractDigest','sourceContractVersion','maximumInputTokens','maximumOutputTokens','route'].sort());
  assert.equal(actual.composition.maximumInputTokens,new TextEncoder().encode(prepared.requestBody).byteLength+4096);assert.equal(actual.composition.maximumOutputTokens,6500);
  assert.equal(described.actorUserId,actor);assert.equal(described.ownerUserId,actor);assert.deepEqual(described.orderedAssetDigests,[]);assert.ok(Object.isFrozen(actual.composition.route));assert.ok(Object.isFrozen(actual.offered.settings.payload));
  assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);limits.assertVerified();t.diagnostic(JSON.stringify({strictLocalSqlStatements:limits.records.length,maximumBindings:Math.max(...limits.boundCounts),limits:{expressionDepth:100,functionArguments:32,parameters:100,sqlBytes:100000},egress,mediaAccess,assetsAccess,detached}));
});

test('mixed composition and repair routes retain independent ceilings within one shared token allowance',async t=>{
  const f=await fixture(t,{configuration:{OPENAI_SLIDES_COMPOSITION_MODEL:'gpt-5.6-sol',OPENAI_SLIDES_COMPOSITION_REASONING_EFFORT:'medium',OPENAI_SLIDES_REPAIR_MODEL:'gpt-5.6-terra',OPENAI_SLIDES_REPAIR_REASONING_EFFORT:'high'}}),before=snapshot(f),assertReadOnly=noWrites(f);
  const {described,actual}=await actualEvidence(f),base=template(described.recipe,actual.offered);assert.equal(await contract.matchSponsorSlidesTemplate(base,actual),true);
  assert.deepEqual(actual.offered.settings.calls.map(call=>[call.model,call.presentationRoute.reasoningEffort]),[['gpt-5.6-sol','medium'],['gpt-5.6-terra','high']]);assert.equal(actual.recipe.model,'gpt-5.6-sol');
  const inputCap=new TextEncoder().encode(JSON.stringify(f.trusted.context.snapshot)).byteLength*4+25000;
  for(const call of actual.offered.settings.calls){assert.equal(call.maximumInputTokens,inputCap);assert.equal(call.maximumOutputTokens,6500);assert.equal(call.maximumMicrousd,Math.max(500000,estimateOpenAITextCallMaximumMicrousd(call.model,inputCap,6500)));assert.equal(call.presentationRoute.modelSource,'workflow');assert.equal(call.presentationRoute.effortSource,'workflow');}
  assert.equal(actual.recipe.maximumMicrousd,actual.offered.settings.calls.reduce((sum,call)=>sum+call.maximumMicrousd,0));assert.equal(actual.recipe.maximumTokens,128000);assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
});

test('source-derived per-call ceilings may overlap shared headroom but cannot exceed one singly fitting request',async t=>{
  const f=await fixture(t,{intake:false,sourceText:'The desk remains beside the window. '.repeat(330)}),before=snapshot(f),assertReadOnly=noWrites(f),{described,actual}=await actualEvidence(f);
  const calls=actual.offered.settings.calls;assert.ok(calls.every(call=>call.maximumInputTokens+call.maximumOutputTokens<=128000));assert.ok(calls.reduce((sum,call)=>sum+call.maximumInputTokens+call.maximumOutputTokens,0)>128000);
  assert.equal(await contract.matchSponsorSlidesTemplate(template(described.recipe,actual.offered),actual),true);assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
  const tooLarge=await fixture(t,{intake:false,sourceText:'The desk remains beside the window. '.repeat(760)}),largeBefore=snapshot(tooLarge),assertLargeReadOnly=noWrites(tooLarge);
  assert.ok(tooLarge.terms.targets[0].settings.calls[0].maximumInputTokens>121500);await assert.rejects(describeSponsorSlidesAdmission(tooLarge.trusted,tooLarge.command),/sponsor_recipe_unsupported/);assert.deepEqual(snapshot(tooLarge),largeBefore);assertLargeReadOnly();assertUnpaid(tooLarge);
});

test('closed Slides template and matcher reject changed counts, optional stages, route budgets and unsafe object grammar',async t=>{
  const f=await fixture(t),{described,actual}=await actualEvidence(f),base=template(described.recipe,actual.offered);
  const mutations=[x=>x.version=5,x=>x.family='guest-slides@1',x=>x.outputCount=5,x=>x.slideCountPolicy.value=6,x=>x.maximumCalls=3,x=>x.maximumTokens=256000,x=>x.calls[0].optional=true,x=>x.calls[1].optional=false,x=>x.calls.reverse(),x=>x.calls[1].maximumInputTokens++,x=>x.calls[1].maximumOutputTokens++,x=>x.calls[1].maximumMicrousd++,x=>x.calls[1].presentationRoute.serviceTier='priority',x=>x.sourceContractVersion=1,x=>x.adapterVersion='old',x=>x.extra=true];
  for(const mutate of mutations){const changed=structuredClone(base);mutate(changed);assert.throws(()=>contract.readSponsorSlidesCampaignTemplate(changed),/sponsor_slides_contract_invalid/);}
  let accessed=0;const unsafe={...base};Object.defineProperty(unsafe,'family',{enumerable:true,get(){accessed++;return base.family;}});assert.throws(()=>contract.readSponsorSlidesCampaignTemplate(unsafe));assert.equal(accessed,0);
  assert.equal(contract.recipeMatchesSponsorSlidesTemplate(base,{...described.recipe,calls:{parsing:0,planning:1,render:1,repair:1}}),false);
  for(const mutate of [x=>x.offered.settings.payload.requestedSlideCount=6,x=>x.offered.settings.payload.slideCountPolicy={kind:'flexible',unit:'slide',min:4,max:5},x=>x.offered.settings.payload.references=[],x=>x.offered.settings.calls[1].stage='planning:1:initial',x=>x.offered.settings.calls[1].maximumInputTokens++,x=>x.offered.settings.calls[1].maximumOutputTokens++,x=>x.offered.settings.calls[1].presentationRoute.reasoningEffort='max',x=>x.composition.phase='validation-repair',x=>x.composition.maximumInputTokens=128000,x=>x.composition.schemaDigest='invalid',x=>x.composition.requestBody='unauthorized raw body']){const changed=structuredClone(actual);mutate(changed);await redigest(changed);assert.equal(await contract.matchSponsorSlidesTemplate(base,changed),false);}
  const capturedActual=structuredClone(actual),capturedTemplate=structuredClone(base),pending=contract.matchSponsorSlidesTemplate(capturedTemplate,capturedActual);capturedTemplate.calls[1].maximumInputTokens=0;capturedActual.offered.settings.payload.itemCount=6;assert.equal(await pending,true);assert.equal(await contract.matchSponsorSlidesTemplate(capturedTemplate,capturedActual),false);
  await assert.rejects(readSponsorSlidesTemplateEvidence(f.trusted,f.command,{...described.recipe,maximumTokens:127999}),/sponsor_native_envelope_mismatch/);assertUnpaid(f);
});

test('native reader refuses re-digested repair route and count quote tampering without writing',async t=>{
  const mutations=[q=>q.targets[0].settings.calls[1].stage='planning:1:repair',q=>q.targets[0].settings.calls[1].model='gpt-5.6-sol',q=>q.targets[0].settings.calls[1].presentationRoute.reasoningEffort='max',q=>q.targets[0].settings.calls[1].maximumInputTokens++,q=>q.targets[0].settings.calls[1].maximumOutputTokens++,q=>q.targets[0].settings.calls[1].maximumMicrousd++,q=>q.targets[0].settings.payload.slideCountPolicy.value=6];
  for(const mutate of mutations){const f=await fixture(t);await alterQuote(f,mutate);const before=snapshot(f),assertReadOnly=noWrites(f);await assert.rejects(describeSponsorSlidesAdmission(f.trusted,f.command),/sponsor_recipe_unsupported/);assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);}
});

test('text-only lane refuses native reference and media-bearing source facts without loading media',async t=>{
  for(const extraBlock of [{type:'reference',properties:{text:'Describe the copper lamp.',weight:1,reference_id:'synthetic-owned-reference',rights_class:'owned',pixel_reference_mode:'context_only'}},{type:'message',properties:{text:'Use the referenced visual.',weight:1,rights_class:'owned',image_url:'/api/media/synthetic'}}]){
    const f=await fixture(t,{extraBlock}),before=snapshot(f),assertReadOnly=noWrites(f);assert.ok(f.terms.targets[0].available);await assert.rejects(describeSponsorSlidesAdmission(f.trusted,f.command),/sponsor_slides_text_source_required/);assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
  }
  const f=await fixture(t),before=snapshot(f),assertReadOnly=noWrites(f);
  for(const context of [{...f.trusted.context,snapshot:{...f.trusted.context.snapshot,facts:[]}},{...f.trusted.context,snapshot:{...f.trusted.context.snapshot,facts:[{type:'unknown',properties:{text:'Unregistered source'}}]}}])await assert.rejects(describeSponsorSlidesAdmission({...f.trusted,context},f.command),/sponsor_slides_text_source_required/);
  assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
});

test('wire privilege, nonpersonal identity, retry, consent, head and expiry changes cannot qualify',async t=>{
  const f=await fixture(t),before=snapshot(f),assertReadOnly=noWrites(f);
  for(const command of [{...f.command,sponsor_entitlement:{}},{...f.command,maximumMicrousd:f.command.maximumMicrousd+1},{...f.command,expectedRevision:'output:0'},{...f.command,explicitAuthorization:false}])await assert.rejects(describeSponsorSlidesAdmission(f.trusted,command));
  for(const trusted of [{...f.trusted,scope:{...f.trusted.scope,kind:'project'}},{...f.trusted,principal:{...f.trusted.principal,fictional:true}},{...f.trusted,projectContext:{}},{...f.trusted,sourcePrivateCaptured:false}])await assert.rejects(describeSponsorSlidesAdmission(trusted,f.command));
  assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
  for(const mutation of ['retry','consent','head','expiry']){const altered=await fixture(t);if(mutation==='retry')await alterQuote(altered,q=>q.operationAttempts[q.targets[0].targetId]={ordinal:1,previousSlotId:'previous'});if(mutation==='consent')altered.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(actor);if(mutation==='head')await appendAuditEvent(altered.env,stream,'user','BlockCreated',{document_id:altered.documentId,project_id:altered.trusted.scope.projectId,block_id:'later',type:'message',handle:'later',position:'z',properties:{text:'The result changed.',weight:1}});if(mutation==='expiry')await alterQuote(altered,q=>q.expiresAt=new Date(Date.now()-1).toISOString());const captured=snapshot(altered),assertAlteredReadOnly=noWrites(altered);await assert.rejects(describeSponsorSlidesAdmission(altered.trusted,altered.command));assert.deepEqual(snapshot(altered),captured);assertAlteredReadOnly();assertUnpaid(altered);}
});

test('final read refuses late private-body, principal, request, database and independent route changes',async t=>{
  for(const mutation of ['quote','source-redaction','principal','request','database','composition','repair','scope']){const f=await fixture(t),batch=f.DB.batch.bind(f.DB);let reached=false,afterMutation;
    f.DB.batch=async statements=>{reached=true;if(mutation==='quote')f.sqlite.prepare("UPDATE event_private_payloads SET private_json='{}' WHERE private_event_id=(SELECT event_id FROM output_preflights WHERE preflight_id=?)").run(f.command.preflightId);if(mutation==='source-redaction')assert.ok(f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at=? WHERE document_id=? AND private_event_id IN(SELECT event_id FROM events WHERE type='BlockCreated')").run(new Date().toISOString(),f.documentId).changes>0);if(mutation==='principal')f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(actor);if(mutation==='request')f.trusted.request=new Request(f.request);if(mutation==='database')f.env.DB={...f.DB};if(mutation==='composition')f.env.OPENAI_SLIDES_COMPOSITION_REASONING_EFFORT='medium';if(mutation==='repair')f.env.OPENAI_SLIDES_REPAIR_MODEL='gpt-5.6-sol';if(mutation==='scope')f.trusted.principal.billingUserId='another-payer';afterMutation=snapshot(f);return batch(statements);};
    const assertReadOnly=noWrites(f);await assert.rejects(describeSponsorSlidesAdmission(f.trusted,f.command));assert.equal(reached,true);assert.deepEqual(snapshot(f),afterMutation);assertReadOnly();assertUnpaid(f);
  }
});

test('native evidence captures the caller recipe before its first awaited read',async t=>{
  const f=await fixture(t),{actual}=await actualEvidence(f),originalRecipe=structuredClone(actual.recipe),callerRecipe=structuredClone(actual.recipe),before=snapshot(f),assertReadOnly=noWrites(f);
  const pending=readSponsorSlidesTemplateEvidence(f.trusted,f.command,callerRecipe);callerRecipe.maximumTokens=1;callerRecipe.calls.repair=0;
  const captured=await pending;assert.deepEqual(captured.recipe,originalRecipe);assert.deepEqual(captured,actual);await assert.rejects(readSponsorSlidesTemplateEvidence(f.trusted,f.command,callerRecipe),/sponsor_native_envelope_mismatch/);
  assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
});

test('the original scope retains private-body witnesses that are absent from source assertions',async t=>{
  const f=await fixture(t),eventId='slides-additional-retained-witness',raw=JSON.stringify({private_witness:'first'}),changed=JSON.stringify({private_witness:'other'});
  f.sqlite.prepare('INSERT INTO event_private_payloads(private_event_id,owner_id,project_id,document_id,private_json,created_at) VALUES(?,?,?,?,?,?)').run(eventId,actor,f.trusted.scope.projectId,f.documentId,raw,new Date().toISOString());
  assert.equal(JSON.stringify(f.trusted.sourceAssertions).includes(eventId),false);assert.deepEqual(rememberOutputPrivateBody(f.trusted.scope,eventId,raw),{private_witness:'first'});
  const before=snapshot(f),assertReadOnly=noWrites(f);await describeSponsorSlidesAdmission(f.trusted,f.command);assert.deepEqual(snapshot(f),before);
  const batch=f.DB.batch.bind(f.DB);let reached=false,afterMutation;f.DB.batch=async statements=>{reached=true;assert.equal(f.sqlite.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run(changed,eventId).changes,1);afterMutation=snapshot(f);return batch(statements);};
  await assert.rejects(describeSponsorSlidesAdmission(f.trusted,f.command));assert.equal(reached,true);assert.deepEqual(snapshot(f),afterMutation);assertReadOnly();assertUnpaid(f);
});

test('transient same-length source mutation across preparation cannot substitute different composition evidence',async t=>{
  const f=await fixture(t),{actual}=await actualEvidence(f),before=snapshot(f),assertReadOnly=noWrites(f),originalContext=structuredClone(f.trusted.context);
  const fact=f.trusted.context.snapshot.facts.find(value=>value.type==='message'),originalText=fact.properties.text;
  const changedText=(originalText[0]==='X'?'Y':'X')+originalText.slice(1);assert.equal(changedText.length,originalText.length);assert.notEqual(changedText,originalText);
  const subtle=crypto.subtle,originalDigest=subtle.digest;let armed=false,restored=false;
  subtle.digest=async function(algorithm,data){const bytes=ArrayBuffer.isView(data)?new Uint8Array(data.buffer,data.byteOffset,data.byteLength):new Uint8Array(data);const text=new TextDecoder().decode(bytes);
    if(!armed&&text.includes('"operationAttempts"')&&text.includes(f.command.preflightId)){armed=true;fact.properties.text=changedText;}
    if(armed&&!restored&&text.includes('"name":"document_slides"')&&text.includes('"max_output_tokens":6500')){restored=true;fact.properties.text=originalText;}
    return originalDigest.call(this,algorithm,data);
  };
  let result,error;try{result=await readSponsorSlidesTemplateEvidence(f.trusted,f.command,actual.recipe);}catch(caught){error=caught;}finally{subtle.digest=originalDigest;fact.properties.text=originalText;}
  assert.equal(armed,true,'The mutation must overlap the native quote digest await');assert.equal(restored,true,'The source is restored only when real prepared request bytes are hashed');
  if(error)assert.match(error.message,/sponsor_/u);else assert.deepEqual(result,actual,'Returned evidence must describe only the original captured source');
  assert.deepEqual(f.trusted.context,originalContext);assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
});

test('source rights must remain live after the final atomic read',async t=>{
  const deadline=Date.now()+60000,f=await fixture(t,{intake:false,sourceDeadline:deadline}),batch=f.DB.batch.bind(f.DB),clock=Date.now;let reached=false;
  f.DB.batch=async statements=>{const result=await batch(statements);reached=true;Date.now=()=>deadline;return result;};const before=snapshot(f),assertReadOnly=noWrites(f);
  try{await assert.rejects(describeSponsorSlidesAdmission(f.trusted,f.command),/sponsor_authority_changed/);}finally{Date.now=clock;}
  assert.equal(reached,true);assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
});

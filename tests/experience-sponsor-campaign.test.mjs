import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {registerOutputSourceImports} from './output-execution-test-helpers.mjs';
registerOutputSourceImports();
const [{readSponsorCampaignTemplate,recipeMatchesSponsorTemplate,matchSponsorImageTemplate},
  {preflightOutputImageSlidesTarget},{registeredExperience},{digest},
  {selectImageAdapter}, route, {generateCreativeDirection}, {generateCreativeImage}] = await Promise.all([
  import('../worker/experience-sponsor-campaign.ts'), import('../worker/output-image-slides-preflight.ts'),
  import('../src/experiences/intake.ts'), import('../src/experiences/compiler.ts'), import('../worker/image-adapter-selection.ts'),
  import('../worker/openai-image-route-contract.ts'), import('../worker/openai-adapter.ts'), import('../worker/image-adapter.ts'),
]);

// Production preflight and registered release, local synthetic Context/target.
// No identity, issuer, provider call, database, or actual campaign is created.
const originalFetch=globalThis.fetch;
let networkCalls=0;
globalThis.fetch=()=>{networkCalls++;throw Error('Campaign contract tests prohibit network');};
after(()=>{globalThis.fetch=originalFetch;assert.equal(networkCalls,0);});
const env={OPENAI_API_KEY:'no-network-fixture',OPENAI_MODEL:'gpt-5.6-terra',OPENAI_IMAGE_MODEL:'gpt-image-2'};
const release=await registeredExperience('image');assert.ok(release);
const schemaDigest=await digest(route.OPENAI_IMAGE_DIRECTION_SCHEMA);
function transport() {
  const image=selectImageAdapter(env,{quality:'high',size:'1024x1024',references:[]});
  const p=route.OPENAI_IMAGE_DIRECTION_CONTRACT,i=route.OPENAI_IMAGE_GENERATION_CONTRACT,m=route.OPENAI_IMAGE_MODERATION_CONTRACT;
  return {planning:{api:p.api,maximumOutputTokens:p.maximumOutputTokens,reasoningEffort:p.reasoning.effort,verbosity:p.text.verbosity,
      format:{type:p.text.format.type,name:p.text.format.name,strict:p.text.format.strict,schemaDigest},store:p.store},
    image:{api:i.api,adapterId:image.adapterId,adapterVersion:image.adapterVersion,quality:i.defaults.quality,outputFormat:i.defaults.outputFormat,partialImages:i.defaults.partialImages,outputCount:i.outputCount},
    safety:{api:m.api,provider:'openai',model:m.model,maximumCalls:m.maximumCalls,input:m.input}};
}
async function native(source='Pear orchard at dusk',intent='image-a') {
  const offered=await preflightOutputImageSlidesTarget({env,target:{id:intent,selected:true,blocking_issues:[],media_kind:'image',source_scope:{kind:'document'},aspect_ratio:{width:1,height:1},instruction_text:`Show ${source}`,label:`View ${intent}`,coverage:{kind:'document_outline'}},context:{snapshot:{facts:[{type:'subject',properties:{text:source}}]}}});
  assert.equal(offered.available,true);
  const recipe={appId:'image',recipeVersion:`image@${release.definition.revision}`,releaseDigest:release.releaseHash,outputKind:'image',provider:offered.provider,model:offered.model,
    routeDigest:await digest(offered),settingsDigest:await digest(offered.settings),outputCount:1,durationMs:0,width:1024,height:1024,calls:{parsing:0,planning:1,render:1,repair:0},maximumTokens:offered.maximumTokens,maximumMicrousd:offered.maximumMicrousd};
  return {recipe,offered,transport:transport()};
}
function campaign(actual) {
  const {recipe,offered,transport}=actual,s=offered.settings,p=s.payload;
  return {version:2,appId:'image',recipeVersion:recipe.recipeVersion,releaseDigest:recipe.releaseDigest,outputKind:'image',inputMode:'text-only',outputCount:1,durationMs:0,width:1024,height:1024,
    route:offered.route,maximumCalls:offered.maximumCalls,maximumTokens:offered.maximumTokens,maximumMicrousd:offered.maximumMicrousd,calls:structuredClone(s.calls),
    settings:{kind:s.kind,productionMode:p.productionMode,budgetAcknowledged:p.budgetAcknowledged,preflightAcknowledged:p.preflightAcknowledged,imageRender:structuredClone(s.imageRender),imageBudget:structuredClone(s.imageBudget),executionPolicy:structuredClone(s.executionPolicy)},transport:structuredClone(transport)};
}
const actual=await native(),template=campaign(actual);

test('a stable frozen template matches separate native source and intent quotes while their exact digests differ',async()=>{
  const second=await native('A ceramic bowl beside a studio window','image-b');
  assert.notEqual(second.recipe.routeDigest,actual.recipe.routeDigest);
  assert.notEqual(second.recipe.settingsDigest,actual.recipe.settingsDigest);
  const accepted=readSponsorCampaignTemplate(template);
  assert.equal(matchSponsorImageTemplate(accepted,actual),true);
  assert.equal(matchSponsorImageTemplate(accepted,second),true);
  assert.equal(recipeMatchesSponsorTemplate(accepted,second.recipe),true);
  assert.ok(Object.isFrozen(accepted));assert.ok(Object.isFrozen(accepted.calls));assert.ok(Object.isFrozen(accepted.transport.planning.format));
  const callerCopy=structuredClone(template),captured=readSponsorCampaignTemplate(callerCopy);
  callerCopy.calls[0].maximumMicrousd++;
  assert.equal(captured.calls[0].maximumMicrousd,template.calls[0].maximumMicrousd);
});

const actualChanges={
  'planning model':a=>{a.offered.settings.calls[0].model='gpt-5.6-sol';},
  'planning stage':a=>{a.offered.settings.calls[0].stage='planning:repair';},
  'image model':a=>{a.offered.settings.calls[1].model='gpt-image-1';},
  'image stage':a=>{a.offered.settings.calls[1].stage='image:repair';},
  'stage order':a=>{a.offered.settings.calls.reverse();},
  'extra call':a=>{a.offered.settings.calls.push({...a.offered.settings.calls[1]});},
  'planning cap':a=>{a.offered.settings.calls[0].maximumMicrousd++;},
  'image cap':a=>{a.offered.settings.calls[1].maximumMicrousd++;},
  'total cap':a=>{a.offered.maximumMicrousd++;},
  'token cap':a=>{a.offered.maximumTokens++;},
  'recipe cap':a=>{a.recipe.maximumMicrousd++;},
  'recipe release':a=>{a.recipe.releaseDigest=`sha256:${'e'.repeat(64)}`;},
  'recipe revision':a=>{a.recipe.recipeVersion='image@999';},
  'planner API':a=>{a.transport.planning.api='https://api.openai.com/v1/chat/completions';},
  'planner output cap':a=>{a.transport.planning.maximumOutputTokens=2400;},
  'planner reasoning':a=>{a.transport.planning.reasoningEffort='high';},
  'planner response format':a=>{a.transport.planning.format.name='free_form';},
  'planner response schema':a=>{a.transport.planning.format.schemaDigest=`sha256:${'b'.repeat(64)}`;},
  'missing planner response schema':a=>{delete a.transport.planning.format.schemaDigest;},
  'image API':a=>{a.transport.image.api='https://api.openai.com/v1/images/edits';},
  'image adapter':a=>{a.transport.image.adapterVersion='v6';},
  'image output format':a=>{a.transport.image.outputFormat='jpeg';},
  'image quality':a=>{a.transport.image.quality='low';},
  'image count':a=>{a.transport.image.outputCount=2;},
  'image partials':a=>{a.transport.image.partialImages=1;},
  'safety API':a=>{a.transport.safety.api='https://example.invalid/moderation';},
  'safety model':a=>{a.transport.safety.model='another-model';},
  'safety count':a=>{a.transport.safety.maximumCalls=2;},
  'Fal provider':a=>{a.offered.provider='fal';},
  'different output':a=>{a.recipe.outputKind='model3d';},
  'native route':a=>{a.offered.route='document-image-fal-manual-v1';},
  'format dimensions':a=>{a.offered.settings.imageRender.format.dimensions.width=1536;},
  'format ratio':a=>{a.offered.settings.payload.outputImageFormat.aspect_ratio.width=2;},
  'duration':a=>{a.recipe.durationMs=1000;},
  'render count':a=>{a.recipe.outputCount=2;},
  'reference pixels':a=>{a.offered.settings.payload.references=[];},
  'preview input':a=>{a.offered.settings.payload.sourcePreviewId='preview';},
  'unrecognized setting':a=>{a.offered.settings.allowFallback=true;},
  'unrecognized payload':a=>{a.offered.settings.payload.outputFalImage={};},
  'unrecognized call allowance':a=>{a.offered.settings.calls[0].maximumCalls=8;},
  'unrecognized offered allowance':a=>{a.offered.maximumRepairs=2;},
  'weaker execution deadline':a=>{a.offered.settings.executionPolicy.maximumMilliseconds=900000;},
  'missing actual transport':a=>{delete a.transport;},
  'missing actual safety':a=>{delete a.transport.safety;},
  'missing actual settings':a=>{delete a.offered.settings;},
  'missing actual generation stage':a=>{a.offered.settings.calls.pop();},
};
for(const [name,mutate] of Object.entries(actualChanges))test(`actual ${name} cannot inherit campaign permission`,()=>{
  const changed=structuredClone(actual);mutate(changed);
  assert.equal(matchSponsorImageTemplate(template,changed),false);
});

const policyChanges={
  'unknown root field':p=>{p.allowAnyModel=true;},
  'unknown nested field':p=>{p.transport.image.allowFallback=true;},
  'unknown source kind':p=>{p.inputMode='reference-image';},
  'unknown output':p=>{p.outputKind='model3d';},
  'wildcard model':p=>{p.calls[0].model='*';},
  'Fal stage':p=>{p.calls[1].provider='fal';},
  'changed image model':p=>{p.calls[1].model='gpt-image-1';},
  'arbitrary image cap':p=>{p.calls[1].maximumMicrousd++;p.maximumMicrousd++;},
  'missing call cap':p=>{delete p.calls[0].maximumMicrousd;},
  'mismatched total cap':p=>{p.maximumMicrousd++;},
  'zero planning cap':p=>{p.maximumMicrousd-=p.calls[0].maximumMicrousd;p.calls[0].maximumMicrousd=0;},
  'extra repair stage':p=>{p.calls.push({...p.calls[1],stage:'image:repair'});},
  'extra output':p=>{p.outputCount=2;},
  'unqualified API':p=>{p.transport.planning.api='https://example.invalid';},
  'unbound response schema':p=>{delete p.transport.planning.format.schemaDigest;},
  'invalid response schema':p=>{p.transport.planning.format.schemaDigest='latest';},
  'invented adapter':p=>{p.transport.image.adapterVersion='v99';},
  'invented planner adapter':p=>{p.transport.planning.adapterVersion='v1';},
  'changed budget':p=>{p.settings.imageBudget.maximumInputTokens++;},
  'changed release shape':p=>{p.releaseDigest='latest';},
  'absent release':p=>{delete p.releaseDigest;},
  'absent setting':p=>{delete p.settings.preflightAcknowledged;},
  'caller supplied quote digest':p=>{p.routeDigest=actual.recipe.routeDigest;},
  'caller supplied source':p=>{p.sourceText='Any source';},
};
for(const [name,mutate] of Object.entries(policyChanges))test(`closed campaign rejects ${name}`,()=>{
  const changed=structuredClone(template);mutate(changed);
  assert.throws(()=>readSponsorCampaignTemplate(changed),{code:'sponsor_campaign_template_invalid'});
  assert.equal(recipeMatchesSponsorTemplate(changed,actual.recipe),false);
});

test('malformed JSON and absent values are refused without invoking getters or supplying defaults',()=>{
  const getter=structuredClone(template);let invoked=0;
  Object.defineProperty(getter,'version',{enumerable:true,get(){invoked++;throw Error('must not invoke');}});
  for(const value of [undefined,null,[],{},NaN,getter])assert.throws(()=>readSponsorCampaignTemplate(value),{code:'sponsor_campaign_template_invalid'});
  assert.equal(invoked,0);
  for(const value of [undefined,null,[],{}])assert.equal(recipeMatchesSponsorTemplate(template,value),false);
  for(const key of Object.keys(actual.recipe)){const incomplete=structuredClone(actual.recipe);delete incomplete[key];assert.equal(recipeMatchesSponsorTemplate(template,incomplete),false,key);}
  assert.equal(matchSponsorImageTemplate(template,null),false);
});


test('shared campaign transport evidence is the actual native planner, safety, and image request profile',async t=>{
  const calls=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    const endpoint=String(url);assert.ok([route.OPENAI_IMAGE_DIRECTION_CONTRACT.api,route.OPENAI_IMAGE_MODERATION_CONTRACT.api,route.OPENAI_IMAGE_GENERATION_CONTRACT.api].includes(endpoint));
    assert.equal(options.method,'POST');const body=JSON.parse(options.body);calls.push({endpoint,body});
    if(endpoint===route.OPENAI_IMAGE_DIRECTION_CONTRACT.api)return Response.json({id:'fixture-direction',model:env.OPENAI_MODEL,output_text:JSON.stringify({title:'Orchard',rationale:'Shelter',scene:'Trees by a stone wall',palette:['green','grey','red'],next_moves:['Review','Keep']}),usage:{input_tokens:120,output_tokens:80,total_tokens:200}});
    if(endpoint===route.OPENAI_IMAGE_MODERATION_CONTRACT.api)return Response.json({id:'fixture-safety',model:route.OPENAI_IMAGE_MODERATION_CONTRACT.model,results:[{flagged:false,categories:{}}]});
    return Response.json({data:[{b64_json:btoa('fixture-image')}],usage:{input_tokens:120,output_tokens:80,total_tokens:200,input_tokens_details:{text_tokens:120,image_tokens:0}}});
  });
  const snapshot={facts:[{type:'subject',properties:{text:'A pear orchard'}}]};
  const direction=await generateCreativeDirection(env,'fixture-user',snapshot);
  const image=await generateCreativeImage(env,'fixture-user',snapshot,direction.output,{quality:'high',size:actual.offered.settings.imageRender.size});
  assert.deepEqual(calls.map(call=>call.endpoint),[template.transport.planning.api,template.transport.safety.api,template.transport.image.api]);
  const p=calls[0].body,m=calls[1].body,i=calls[2].body;
  assert.equal(p.model,template.calls[0].model);assert.equal(p.max_output_tokens,template.transport.planning.maximumOutputTokens);
  assert.equal(p.reasoning.effort,template.transport.planning.reasoningEffort);assert.equal(p.text.verbosity,template.transport.planning.verbosity);
  assert.deepEqual({type:p.text.format.type,name:p.text.format.name,strict:p.text.format.strict,schemaDigest:await digest(p.text.format.schema)},template.transport.planning.format);
  assert.equal(p.store,template.transport.planning.store);assert.equal(m.model,template.transport.safety.model);assert.equal(m.input.length,1);assert.equal(m.input[0].type,template.transport.safety.input);
  assert.equal(i.model,template.calls[1].model);assert.equal(i.size,template.settings.imageRender.size);assert.equal(i.quality,template.transport.image.quality);
  assert.equal(i.n,template.transport.image.outputCount);assert.equal(i.output_format,template.transport.image.outputFormat);assert.equal(Object.hasOwn(i,'partial_images'),false);
  assert.equal(image.adapterId,template.transport.image.adapterId);assert.equal(image.adapterVersion,template.transport.image.adapterVersion);
  assert.ok(Object.isFrozen(route.OPENAI_IMAGE_DIRECTION_SCHEMA.properties.palette));assert.ok(Object.isFrozen(route.OPENAI_IMAGE_DIRECTION_CONTRACT.text.format));
});

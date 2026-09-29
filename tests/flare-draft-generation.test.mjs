import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCreativeImage, selectImageAdapter } from '../worker/image-adapter.ts';
import { buildCreativeImagePrompt } from '../worker/openai-adapter.ts';
import { DRAFT_IMAGE_MODEL, draftImageEnvironment } from '../worker/image-generation-policy.ts';
import { configuredImageHealthIdentity, preflightGeneration } from '../worker/generation-readiness.ts';
import { hasQualifiedReplayImageEstimate, hasKnownImageModelPricing, priceImageUsageBreakdownMicrousd } from '../worker/replay-cost.ts';
import { requireUser } from '../worker/pilot-policy.ts';
import { createSceneCostFixture } from './helpers/scene-cost-fixture.mjs';

const env={OPENAI_API_KEY:'test-only',FAL_KEY:'test-only',FORMA_IMAGE_PROVIDER:'fal-ideogram',OPENAI_IMAGE_MODEL:'gpt-image-2.5-sunburst'};
const snapshot={facts:[{block_id:'subject',role:'subject',intent:'include',properties:{text:'An adult astronomer',spatial_scope:{kind:'region',region:'left'}}},{block_id:'avoid',role:'direction',intent:'prohibit',properties:{text:'Visible logos'}}]};
const direction={title:'Copper study',scene:'Material and casting study with quiet evening light.'};
const reference=(n)=>({bytes:new TextEncoder().encode(`pixels-${n}`),mimeType:n%2?'image/jpeg':'image/png',label:`Reference ${n}`,referenceId:`ref-${n}`,blockId:`block-${n}`,source:n===0?'ideation-preview':'uploaded-reference',mode:'preserve_composition'});
const pass=()=>Response.json({id:'modr_test',results:[{flagged:false,categories:{}}]});

test('every new Draft chooses Flare regardless of configured provider, final model, references or format',()=>{
 for(const provider of ['openai','fal','fal-ideogram','ideogram','ideogram-4'])for(const refs of [[],[reference(0)],[reference(0),reference(1)]])for(const format of ['png','jpeg','webp']){
  const selected=selectImageAdapter({...env,FORMA_IMAGE_PROVIDER:provider},{quality:'low',references:refs,outputFormat:format});
  assert.equal(selected.model,DRAFT_IMAGE_MODEL);assert.equal(selected.provider,'openai');assert.ok(selected.capabilities.includes('multiple-image-input'));assert.ok(selected.capabilities.includes('streaming-previews'));
 }
 assert.equal(selectImageAdapter(env,{quality:'high'}).model,'ideogram/v4');
 assert.equal(selectImageAdapter({...env,FORMA_IMAGE_PROVIDER:'openai'},{quality:'high'}).model,'gpt-image-2.5-sunburst');
 assert.deepEqual(configuredImageHealthIdentity(draftImageEnvironment(env)),{provider:'openai',model:DRAFT_IMAGE_MODEL});
 assert.equal(env.FORMA_IMAGE_PROVIDER,'fal-ideogram');
 assert.equal(hasKnownImageModelPricing(DRAFT_IMAGE_MODEL),true);
 assert.equal(hasQualifiedReplayImageEstimate({OPENAI_IMAGE_MODEL:"gpt-image-2"}),false,"Legacy final pricing cannot qualify Flare Draft estimates");
});

for(const promptTechnique of ['prose','bullets','json','xml'])for(const count of [0,1,3])test(`Flare ${promptTechnique} sends the shared prompt and ${count} references with accurate receipts`,async()=>{
 const saved=globalThis.fetch,calls=[],receipts=[];const references=Array.from({length:count},(_,n)=>reference(n));
 globalThis.fetch=async(url,init)=>{calls.push({url:String(url),init});if(String(url).endsWith('/moderations'))return pass();return Response.json({data:[{b64_json:btoa('image')}],usage:{input_tokens:120,input_tokens_details:{text_tokens:20,image_tokens:100},output_tokens:200,total_tokens:320}},{headers:{'x-request-id':'req_flare'}});};
 try{
  const result=await generateCreativeImage(env,'user',snapshot,direction,{quality:'low',size:'816x816',outputFormat:'webp',outputCompression:70,promptTechnique,references,onProviderSubmission:r=>receipts.push(r)});
  const paid=calls.filter(c=>!c.url.endsWith('/moderations'));assert.equal(paid.length,1);assert.equal(paid[0].url,`https://api.openai.com/v1/images/${count?'edits':'generations'}`);
  const body=paid[0].init.body,get=key=>count?body.get(key):JSON.parse(body)[key];
  assert.equal(get('model'),DRAFT_IMAGE_MODEL);assert.equal(get('quality'),'low');assert.equal(get('output_format'),'webp');assert.equal(Number(get('output_compression')),70);
  assert.equal(get('prompt'),buildCreativeImagePrompt(snapshot,direction,references,promptTechnique,{quality:'low',size:'816x816'}));
  assert.equal(calls.filter(c=>c.url.endsWith('/moderations')).length,1+count);
  if(count)for(const [index,blob]of body.getAll('image[]').entries())assert.equal(await blob.text(),`pixels-${index}`);
  assert.equal(result.model,DRAFT_IMAGE_MODEL);assert.equal(result.provider,'openai');assert.equal(result.referenceCount,count);
  assert.equal(receipts[0].status,'pending');assert.equal(receipts.at(-1).status,'completed');assert.ok(receipts.every(r=>r.model===DRAFT_IMAGE_MODEL&&r.provider==='openai'));
  assert.deepEqual(result.costBreakdown,priceImageUsageBreakdownMicrousd(DRAFT_IMAGE_MODEL,result.usage,count>0));assert.equal(result.costBreakdown.totalMicrousd,6900);
 }finally{globalThis.fetch=saved;}
});

test('Draft admission checks Flare health even when Fal is unavailable or blocked',async()=>{
 const f=await createSceneCostFixture();
 try{
  f.env.FORMA_IMAGE_PROVIDER='fal-ideogram';delete f.env.FAL_KEY;
  const {user}=await requireUser(new Request("http://localhost/api/session"),f.env);
  assert.ok(user);
  for(const kind of ['preview','preview_fan']){
   const result=await preflightGeneration(f.env,user,{kind,documentId:f.documentId},{allowCache:false,allowProviderCalls:false,appendEvents:false,persist:false});
   const provider=result.probes.find(p=>p.id==='provider-health');assert.equal(provider.status,'pass');assert.equal(provider.label,'OpenAI availability');
  }
 }finally{f.close();}
});

test('Forma Draft admission and execution use Flare without Fal credentials',async()=>{
 const f=await createSceneCostFixture(),saved=globalThis.fetch,calls=[];
 f.env.FORMA_IMAGE_PROVIDER='fal-ideogram';delete f.env.FAL_KEY;
 globalThis.fetch=async(url,init)=>{
  if(String(url).endsWith('/moderations'))return pass();
  if(String(url).endsWith('/responses'))return Response.json({id:'direction',model:'gpt-5.6-terra',output_text:JSON.stringify({title:'Harbor',rationale:'Quiet setting',scene:'The keeper watches the harbor',palette:['blue','white'],next_moves:['Review']}),usage:{input_tokens:100,output_tokens:100,total_tokens:200}});
  calls.push({url:String(url),body:JSON.parse(init.body)});
  return Response.json({error:{message:'Definitive test rejection',type:'invalid_request_error'}},{status:400});
 };
 try{
  const response=await f.request('/api/document-jobs',f.json({kind:'preview',documentId:f.documentId,sourceSurface:'document',payload:{requestKey:'forma-flare-draft',paidMediaConfirmed:true,budgetAcknowledged:true,preflightAcknowledged:true,productionMode:'manual'}}));
  assert.equal(response.status,202,await response.clone().text());const {job}=await response.json();await f.drainBackground();await f.run(job.jobId);
  assert.equal(calls.length,1);assert.equal(calls[0].body.model,DRAFT_IMAGE_MODEL);assert.equal(calls[0].body.stream,true);assert.equal(calls[0].body.partial_images,1);
  const health=f.sqlite.prepare('SELECT scope_key FROM provider_health').all();assert.ok(health.every(r=>!r.scope_key.startsWith('fal:')));
 }finally{await f.drainBackground();globalThis.fetch=saved;f.close();}
});

test('storyboard image drafts finish through Flare and settle their own receipts',async()=>{
 const f=await createSceneCostFixture(),saved=globalThis.fetch,paid=[];
 f.env.FORMA_IMAGE_PROVIDER='fal-ideogram';delete f.env.FAL_KEY;
 const plan={title:'Harbor',summary:'One quiet view of the harbor.',content_markdown:'The keeper watches the harbor.',presentation:null,items:[{title:'Quiet watch',body:'The keeper watches the harbor as the tide rises.',notes:'Wide establishing shot with evening light.',image_prompt:'A wide editorial photograph of an adult keeper watching a harbor.',context_group_ids:[],slide:null}]};
 globalThis.fetch=async(url,init)=>{
  if(String(url).endsWith('/moderations'))return pass();
  if(String(url).endsWith('/responses'))return Response.json({id:'storyboard-plan',model:'gpt-5.6-terra',output_text:JSON.stringify(plan),usage:{input_tokens:100,output_tokens:100,total_tokens:200}});
  paid.push({url:String(url),body:JSON.parse(init.body)});return Response.json({data:[{b64_json:btoa('test-image')}],usage:{input_tokens:100,output_tokens:200,total_tokens:300}},{headers:{'x-request-id':'flare-frame'}});
 };
 try{
  const response=await f.request('/api/document-jobs',f.json({kind:'render_document',documentId:f.documentId,sourceSurface:'document',payload:{artifactKind:'storyboard',productionMode:'manual',itemCount:1,paidMediaConfirmed:true,requestKey:'flare-storyboard'}}));
  assert.equal(response.status,202,await response.clone().text());const {job}=await response.json();await f.drainBackground();await f.run(job.jobId);
  const row=f.sqlite.prepare('SELECT status,result_json FROM document_jobs WHERE job_id=?').get(job.jobId);assert.equal(row.status,'completed',row.result_json);
  assert.equal(paid.length,1);assert.equal(paid[0].body.model,DRAFT_IMAGE_MODEL);
  const event=f.sqlite.prepare("SELECT payload FROM events WHERE type='DocumentRenderCompleted' ORDER BY sequence DESC LIMIT 1").get();assert.equal(JSON.parse(event.payload).model_id,DRAFT_IMAGE_MODEL);
  const costs=f.sqlite.prepare("SELECT status,used_microusd FROM cost_budget_reservations WHERE operation='document-render:storyboard'").all();assert.equal(costs.length,1);assert.equal(costs[0].status,'settled');assert.equal(costs[0].used_microusd,7900);
 }finally{await f.drainBackground();globalThis.fetch=saved;f.close();}
});

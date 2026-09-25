import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildCreativeDirectionRequest,generateCreativeDirection,generateCreativeImage} from '../worker/openai-adapter.ts';
import {buildBoundedPromptRepresentation} from '../src/model/prompt-structures.ts';
import {snapshot,direction} from '../next-tasks/i/fixture.mjs';
import {PROFILE,applyProfile,promptSections} from '../next-tasks/i/profile.mjs';
const compile=()=>buildBoundedPromptRepresentation('prose',snapshot,direction);
const env={OPENAI_API_KEY:'synthetic-not-a-live-key',OPENAI_IMAGE_MODEL:'gpt-image-2.5-sunburst'};
const pass=()=>Response.json({id:'mock-moderation',model:'mock',results:[{flagged:false,categories:{}}]});
async function mockTransport(fn,run){const original=globalThis.fetch;globalThis.fetch=fn;try{return await run();}finally{globalThis.fetch=original;}}
const imageResponse=()=>new Response('data: '+JSON.stringify({type:'image_generation.completed',b64_json:'AQ==',size:'1536x1024',output_format:'png',usage:{input_tokens:1,output_tokens:1,total_tokens:2,input_tokens_details:{text_tokens:1,image_tokens:0}}})+'\n\n',{headers:{'content-type':'text/event-stream','x-request-id':'mock-image'}});

test('real serializer preserves positive, negative, subject, group, quoted and inferred facts',()=>{
 const before=JSON.stringify(snapshot);
 const request=buildCreativeDirectionRequest(snapshot,'fixture-model','fixture-identifier','fr');
 const input=JSON.parse(JSON.parse(request.requestBody).input);
 const compiled=compile();assert.equal(compiled.compacted,false);assert.equal(compiled.fits,true);
 const {context}=promptSections(compiled.prompt);
 for(let i=0;i<snapshot.facts.length;i++){
  const f=snapshot.facts[i];
  for(const target of [input.facts[i],context.facts[i]]){
   assert.equal(target.properties.text,f.properties.text);
   assert.equal(target.intent,f.intent);assert.equal(target.effect,f.effect);assert.equal(target.authority,f.authority);
  }
 }
 assert.equal(input.facts[2].properties.spatial_scope.subject_decision,'decision_1');
 assert.equal(context.facts[2].properties.spatial_scope.subject_decision,'decision_1');
 assert.equal(context.facts[3].properties.spatial_scope.region,'right');
 assert.equal(input.combined_context_plan.length,1);assert.equal(input.combined_context_plan[0].target,'bookstall');
 assert.match(compiled.prompt,/Bookstall only/);assert.match(compiled.prompt,/bookstall/);
 assert.deepEqual(context.standing_constraints,snapshot.standing_constraints);assert.deepEqual(context.pins,['decision_2']);
 assert.equal(JSON.stringify(snapshot),before);
});

test('synthetic contradictory planner output remains verbatim, without false semantic rejection guarantee',async()=>{
 const calls=[];
 const result=await mockTransport(async(url,init)=>{
  assert.equal(String(url),'https://api.openai.com/v1/responses');calls.push(JSON.parse(init.body));
  return Response.json({id:'mock-planner',model:'fixture-model',status:'completed',output_text:JSON.stringify(direction),usage:{input_tokens:1,output_tokens:1,total_tokens:2}});
 },()=>generateCreativeDirection({...env,OPENAI_MODEL:'fixture-model'},'synthetic-user',snapshot));
 assert.equal(calls.length,1);assert.deepEqual(result.output,direction);
 assert.deepEqual(promptSections(compile().prompt).direction,direction);
 // This is structural evidence of pass-through, NOT evidence the real planner would return this.
});

test('disabled profile is identity; opt-in changes one exact compiler span and no source/direction/typography bytes',()=>{
 const base=compile().prompt;assert.equal(PROFILE.enabled,false);assert.equal(applyProfile(base),base);
 const treatment=applyProfile(base,{enabled:true});
 assert.equal(treatment.slice(PROFILE.treatment.length),base.slice(PROFILE.baseline.length));
 assert.deepEqual(promptSections(treatment).direction,direction);
 assert.deepEqual(promptSections(treatment).context,promptSections(base).context);
 assert.throws(()=>applyProfile('drift\n'+base,{enabled:true}),/baseline_mismatch/);
 assert.throws(()=>applyProfile(treatment,{enabled:true}),/baseline_mismatch/);
 // All named objects, including legitimately requested leash and quoted label, remain.
 for(const f of snapshot.facts)assert.ok(treatment.includes(JSON.stringify(f.properties.text).slice(1,-1)));
});

test('actual image adapter sends only the prompt treatment and moderates each exact arm; mock transport only',async()=>{
 const baseline=compile().prompt, treatment=applyProfile(baseline,{enabled:true});
 const captures=[];
 for(const prompt of [baseline,treatment]){
  const calls=[],evidence=[];
  await mockTransport(async(url,init)=>{
   assert.ok(['/v1/moderations','/v1/images/generations'].some(p=>String(url)==='https://api.openai.com'+p),'no planner or unexpected transport');
   calls.push({url:String(url),body:JSON.parse(init.body)});
   return String(url).endsWith('/moderations')?pass():imageResponse();
  },()=>generateCreativeImage(env,'synthetic-user',snapshot,direction,{preparedPrompt:prompt,partialImages:1,size:'1536x1024',quality:'high',outputFormat:'png',onEvidence:e=>evidence.push(e)}));
  assert.equal(calls.length,2);assert.equal(calls[0].body.input[0].text,prompt);assert.equal(calls[1].body.prompt,prompt);
  const compiled=evidence.find(e=>e.outcome.pipelineStage==='compiler');assert.equal(JSON.parse(compiled.requestBody).prompt,prompt);
  captures.push(calls);
 }
 const [a,b]=captures.map(c=>c[1].body);
 assert.deepEqual({...a,prompt:null},{...b,prompt:null});
 assert.deepEqual(Object.keys(a).filter(k=>a[k]!==b[k]),['prompt']);
 for(const key of ['moderation','background','output_compression','input_fidelity','seed','response_format'])assert.equal(Object.hasOwn(b,key),false);
 const [am,bm]=captures.map(c=>c[0].body);assert.deepEqual({...am,input:null},{...bm,input:null});
 // Persist ONLY the explicitly synthetic actual transport request bodies.
 fs.writeFileSync(new URL('../next-tasks/i/synthetic-request-capture.json',import.meta.url),JSON.stringify({provenance:'agent-written synthetic draft; intercepted requests, not historical response or live result',captures},null,2)+'\n');
});

test('treatment still stops on exact moderation flag before any image request',async()=>{
 let calls=0;
 await mockTransport(async(url)=>{calls++;assert.equal(String(url),'https://api.openai.com/v1/moderations');return Response.json({id:'mock-stop',results:[{flagged:true,categories:{violence:true}}]});},async()=>{
  await assert.rejects(()=>generateCreativeImage(env,'synthetic-user',snapshot,direction,{preparedPrompt:applyProfile(compile().prompt,{enabled:true}),partialImages:1}),e=>e.detail.code==='safety_preflight_flagged');
 });
 assert.equal(calls,1);
});

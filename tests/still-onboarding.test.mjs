import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneCostFixture } from './helpers/scene-cost-fixture.mjs';
import { OnboardingController } from '../src/still/onboarding-client.ts';
import { onboardingInput } from '../src/still/onboarding.ts';
const input={enabled:true,actions:['new-project','projects'],view:'projects',locale:'en'};
const valid=(model,tips={'new-project':'Start a project for related ideas.','projects':'Browse your projects.'})=>Response.json({id:'test-onboarding',model,status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(tips)}]}],usage:{input_tokens:120,output_tokens:50,total_tokens:170}});
const pause=()=>new Promise(r=>setTimeout(r,5));

test('generated onboarding uses standard credentials, bounded Luna request, budgets and exact cache reuse',async()=>{
 const f=await createSceneCostFixture(),saved=globalThis.fetch;let calls=0;
 try{
  f.env.OPENAI_API_KEY='fixture-standard-key';f.env.OPENAI_PROJECT='fixture-project';
  globalThis.fetch=async(url,init)=>{calls++;assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(init.headers.authorization,'Bearer fixture-standard-key');assert.equal(init.headers['OpenAI-Project'],'fixture-project');const b=JSON.parse(init.body);assert.equal(b.model,'gpt-5.6-luna');assert.equal(b.reasoning.effort,'low');assert.equal(b.store,false);assert.equal(b.max_output_tokens,1024);assert.equal(b.tools,undefined);assert.ok(!init.body.includes('scene-reuse'));assert.deepEqual(Object.keys(JSON.parse(b.input)),['page','language','actions']);return valid(b.model);};
  const call=()=>f.request('/api/still/onboarding',f.json({...input,arbitraryCreativeText:'must never enter provider request'}));
  const first=await call();assert.equal(first.status,200,await first.clone().text());const body=await first.json();assert.equal(body.source,'model');assert.equal(body.cache.status,'miss');
  const again=await(await call()).json();assert.equal(again.cache.status,'hit');assert.equal(calls,1);assert.deepEqual(again.tips,body.tips);
  const tokens=f.sqlite.prepare("SELECT status,used_tokens FROM budget_reservations WHERE operation='still-onboarding'").get();assert.equal(tokens.used_tokens,170);assert.notEqual(tokens.status,'active');
  const dollars=f.sqlite.prepare("SELECT status,used_microusd FROM cost_budget_reservations WHERE operation='still-onboarding'").get();assert.equal(dollars.used_microusd,84);assert.notEqual(dollars.status,'active');
 }finally{globalThis.fetch=saved;await f.drainBackground();f.close();}
});

test('opt-in, validated action catalog, and current consent are required before dispatch',async()=>{
 const f=await createSceneCostFixture(),saved=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('unexpected');};
 try{
  for(const body of [{...input,enabled:false},{...input,actions:['invented']},{...input,actions:Array(8).fill('projects')},{...input,view:'send all text'},{...input,locale:'<script>'}])assert.equal((await f.request('/api/still/onboarding',f.json(body))).status,400);
  f.sqlite.prepare('UPDATE users SET consent_version=NULL').run();assert.equal((await f.request('/api/still/onboarding',f.json(input))).status,428);assert.equal(calls,0);
 }finally{globalThis.fetch=saved;await f.drainBackground();f.close();}
});

test('onboarding cache never bypasses revoked shared project access',async()=>{
 const f=await createSceneCostFixture(1,'visual',{shared:true}),saved=globalThis.fetch;let calls=0;globalThis.fetch=async(_url,init)=>{calls++;return valid(JSON.parse(init.body).model);};
 try{
  assert.equal((await(await f.request('/api/still/onboarding',f.json(input))).json()).source,'model');
  f.sqlite.prepare("UPDATE project_context_sessions SET revoked_at='2026-09-18T00:00:00.000Z' WHERE context_id=?").run(f.sharing.contextId);
  assert.equal((await f.request('/api/still/onboarding',f.json(input))).status,403);assert.equal(calls,1);
 }finally{globalThis.fetch=saved;await f.drainBackground();f.close();}
});

test('provider rejection releases reservations; malformed successful text settles real usage but stays local',async()=>{
 for(const malformed of [false,true]){
  const f=await createSceneCostFixture(),saved=globalThis.fetch;let calls=0;globalThis.fetch=async(_url,init)=>{calls++;return malformed?valid(JSON.parse(init.body).model,{projects:'<script>bad</script>','new-project':'Start.'}):Response.json({error:'unavailable'},{status:429});};
  try{
   const body=await(await f.request('/api/still/onboarding',f.json(input))).json();assert.equal(body.source,'local');assert.deepEqual(body.tips,{});assert.equal(body.cache.stored,false);assert.equal(calls,1);
   const row=f.sqlite.prepare("SELECT status,used_tokens FROM budget_reservations WHERE operation='still-onboarding'").get();assert.equal(row.used_tokens,malformed?170:0);assert.notEqual(row.status,'active');
  }finally{globalThis.fetch=saved;await f.drainBackground();f.close();}
 }
});

test('unknown provider completion is not repeated or recorded as free',async()=>{
 const f=await createSceneCostFixture(),saved=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('connection lost');};
 try{
  const result=await(await f.request('/api/still/onboarding',f.json(input))).json();assert.equal(result.reason,'unconfirmed');assert.equal(result.source,'local');assert.equal(calls,1);
  assert.equal(f.sqlite.prepare("SELECT status FROM budget_reservations WHERE operation='still-onboarding'").get().status,'active');
  assert.equal(f.sqlite.prepare("SELECT status FROM cost_budget_reservations WHERE operation='still-onboarding'").get().status,'active');
 }finally{globalThis.fetch=saved;await f.drainBackground();f.close();}
});

test('client stays local when off, fences late responses, reuses success and does not loop on failures',async()=>{
 let calls=0,release;const c=new OnboardingController(()=>{calls++;return new Promise(r=>release=r);},()=>{},0);
 c.update('one',null);await pause();assert.equal(calls,0);
 c.update('one',input);await pause();assert.equal(c.status.source,'pending');
 c.update('two',null);release({source:'model',tips:{projects:'Wrong page'}});await pause();assert.equal(c.help('two','projects'),undefined);
 c.update('two',input);await pause();release({source:'model',tips:{projects:'Browse.'}});await pause();assert.equal(c.help('two','projects'),'Browse.');
 c.update('two',null);c.update('two',input);await pause();assert.equal(calls,2);assert.equal(c.status.cache.layer,'browser');
 c.update('two',{...input,view:'document'});await pause();release({source:'local',tips:{},reason:'unavailable'});await pause();const count=calls;
 c.update('two',{...input,view:'document'});await pause();assert.equal(calls,count);assert.equal(c.status.source,'local');
 c.dispose();
});

test('input accepts only bounded catalog descriptors, retaining no free-form client state',()=>{
 assert.deepEqual(onboardingInput({...input,state:{secret:'private'}}),{actions:['new-project','projects'],view:'projects',locale:'en'});
});


test('existing dollar budget denial prevents onboarding provider spend',async()=>{
 const f=await createSceneCostFixture(),saved=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('must not dispatch');};
 try{
  await f.request('/api/session');f.sqlite.prepare("UPDATE cost_budget_counters SET used_microusd=hard_limit_microusd WHERE scope='user'").run();
  const result=await(await f.request('/api/still/onboarding',f.json(input))).json();assert.equal(result.source,'local');assert.equal(result.reason,'budget');assert.equal(calls,0);
 }finally{globalThis.fetch=saved;await f.drainBackground();f.close();}
});

test('identical in-flight onboarding batches share one provider request',async()=>{
 const f=await createSceneCostFixture(),saved=globalThis.fetch;let calls=0,release;globalThis.fetch=async(_url,init)=>{calls++;return new Promise(r=>release=()=>r(valid(JSON.parse(init.body).model)));};
 try{
  const first=f.request('/api/still/onboarding',f.json(input));while(!release)await pause();
  const second=f.request('/api/still/onboarding',f.json(input));await pause();release();
  const values=await Promise.all([first,second].map(async p=>(await p).json()));assert.equal(calls,1);assert.deepEqual(values.map(v=>v.cache.status).sort(),['miss','shared']);
 }finally{globalThis.fetch=saved;await f.drainBackground();f.close();}
});

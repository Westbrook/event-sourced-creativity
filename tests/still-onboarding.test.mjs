import test from 'node:test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import { createSceneCostFixture } from './helpers/scene-cost-fixture.mjs';
import {DecisionMemo} from '../src/still/decision-cache.ts';
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

test('emoji-bearing onboarding stays local without caching or retrying the provider',async()=>{
 for(const symbol of ['\u{1f4a1}','\u{1f1fa}\u{1f1f8}','1\ufe0f\u20e3','\u{1f3fd}','\u2197']){
  const f=await createSceneCostFixture(),saved=globalThis.fetch;let calls=0;
  globalThis.fetch=async(_url,init)=>{calls++;const body=JSON.parse(init.body);assert.match(body.instructions,/No emoji or decorative symbols/);return valid(body.model,{'new-project':`Start a project ${symbol}`,projects:'Browse your projects.'});};
  try{
   const body=await(await f.request('/api/still/onboarding',f.json(input))).json();
   assert.equal(body.source,'local');assert.equal(body.reason,'invalid_response');assert.deepEqual(body.tips,{});assert.equal(body.cache.stored,false);assert.equal(calls,1);
   assert.equal(f.sqlite.prepare("SELECT used_tokens FROM budget_reservations WHERE operation='still-onboarding'").get().used_tokens,170);
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

test('identical in-flight onboarding batches share one provider request',{timeout:5000},async()=>{
 const f=await createSceneCostFixture(),saved=globalThis.fetch;let calls=0,release;globalThis.fetch=async(_url,init)=>{calls++;return new Promise(r=>release=()=>r(valid(JSON.parse(init.body).model)));};
 const originalRun=DecisionMemo.prototype.run;let entered=0,joinedResolve;const joined=new Promise(resolve=>joinedResolve=resolve);
 DecisionMemo.prototype.run=function(...args){const result=originalRun.apply(this,args);if(++entered===2)joinedResolve();return result;};
 try{
  const first=f.request('/api/still/onboarding',f.json(input));while(!release)await pause();
  const second=f.request('/api/still/onboarding',f.json(input));await joined;release();
  const values=await Promise.all([first,second].map(async p=>(await p).json()));assert.equal(calls,1);assert.deepEqual(values.map(v=>v.cache.status).sort(),['miss','shared']);
 }finally{DecisionMemo.prototype.run=originalRun;release?.();globalThis.fetch=saved;await f.drainBackground();f.close();}
});

test('context keeps useful observations and strips free-form state and telemetry',()=>{
 const result=onboardingInput({...input,context:{surface:'more',historyComplete:false,basis:{'new-project':'next-best',projects:'alternative',invented:'next-best'},available:{projects:2000,documents:-1,results:Infinity,ideas:2,secret:'text'},selectedIdea:{kind:'subject',active:true,locked:false,text:'private'},recentActions:['invented','new-project','completed:new-project','ui:more'],hoverMs:900,secret:'private'}});
 assert.deepEqual(result.context,{surface:'more',historyComplete:false,basis:{'new-project':'next-best',projects:'alternative'},available:{projects:1000,ideas:2},selectedIdea:{kind:'subject',active:true,locked:false},recentActions:['new-project','completed:new-project','ui:more']});
 assert.deepEqual(onboardingInput({...input,context:{selectedIdea:{kind:'invented'},recentActions:Array(100).fill('new-project')}}).context,{selectedIdea:{},recentActions:Array(4).fill('new-project')});
});

test('provider gets grounded why-now instructions and sanitized context; telemetry cannot invalidate its cache',async()=>{
 const f=await createSceneCostFixture(),saved=globalThis.fetch;let calls=0;
 const context={surface:'main',historyComplete:false,basis:{'new-project':'page-default',projects:'local'},available:{projects:3},recentActions:['completed:new-project']};
 try{
  globalThis.fetch=async(_url,init)=>{
   calls++;const b=JSON.parse(init.body),sent=JSON.parse(b.input);
   assert.match(b.instructions,/why it is useful here, now/);assert.match(b.instructions,/selections, not successful outcomes/);assert.match(b.instructions,/do not invent a personal motive/);
   assert.deepEqual(sent.context,context);assert.ok(!init.body.includes('private creative text'));return valid(b.model);
  };
  const first=await(await f.request('/api/still/onboarding',f.json({...input,context:{...context,text:'private creative text',hoverMs:100}}))).json();
  assert.equal(first.source,'model');
  const second=await(await f.request('/api/still/onboarding',f.json({...input,context:{...context,text:'different private creative text',hoverMs:2000}}))).json();
  assert.equal(second.cache.status,'hit');assert.equal(calls,1);
  const changed=await(await f.request('/api/still/onboarding',f.json({...input,context:{...context,available:{projects:4}}}))).json();
  assert.notEqual(changed.cache.status,'hit');assert.equal(changed.source,'local'); // Existing provider cooldown still applies.
 }finally{globalThis.fetch=saved;await f.drainBackground();f.close();}
});

test('same-account route revisits restore help synchronously; different contexts and accounts cannot reuse it',async()=>{
 let calls=0;
 const c=new OnboardingController(async()=>{calls++;return{source:'model',tips:{projects:'Browse your three projects.'}};},()=>{},0);
 const original={...input,context:{available:{projects:3}}};
 c.update('route-one',original,'account-one');await pause();await pause();assert.equal(calls,1);
 c.update('route-two',null,'account-one');
 c.update('route-one',original,'account-one');
 assert.equal(c.help('route-one','projects'),'Browse your three projects.');assert.equal(c.status.cache.status,'hit');assert.equal(c.status.elapsedMs,0);assert.equal(calls,1);
 c.update('route-one',{...original,context:{available:{projects:4}}},'account-one');assert.equal(c.help('route-one','projects'),undefined);await pause();await pause();assert.equal(calls,2);
 c.update('route-one',original,'account-two');assert.equal(c.help('route-one','projects'),undefined);await pause();await pause();assert.equal(calls,3);
 c.dispose();
});

test('context changes fence late model wording and unchanged context does not resubmit',async()=>{
 const pending=[];const c=new OnboardingController(value=>new Promise(resolve=>pending.push({value,resolve})),()=>{},0);
 c.update('route',{...input,context:{available:{projects:1}}});await pause();
 c.update('route',{...input,context:{available:{projects:2}}});await pause();
 pending[0].resolve({source:'model',tips:{projects:'Old context'}});await pause();assert.equal(c.help('route','projects'),undefined);
 pending[1].resolve({source:'model',tips:{projects:'Current context'}});await pause();assert.equal(c.help('route','projects'),'Current context');
 c.update('route',{...input,context:{available:{projects:2},hoverMs:50000}});await pause();assert.equal(pending.length,2);
 c.dispose();
});

test('onboarding state measures browser delivery, records captured tips and distinguishes cache reuse',async t=>{
 let now=100,release; t.mock.method(performance,'now',()=>now);
 const c=new OnboardingController(()=>new Promise(resolve=>release=resolve),()=>{},0);
 c.update('route',input,'account');await pause();assert.equal(c.status.source,'pending');
 now=2060;release({source:'model',tips:{projects:'Browse.', 'new-project':'Start.'},requestElapsedMs:500});await pause();
 assert.equal(c.status.requestElapsedMs,1960);assert.equal(c.status.elapsedMs,500);assert.equal(c.status.tipCount,2);
 c.update('elsewhere',null,'account');assert.deepEqual(c.status,{source:'local'});
 c.update('route',input,'account');assert.equal(c.status.requestElapsedMs,0);assert.equal(c.status.cache.layer,'browser');assert.equal(c.status.tipCount,2);
 c.dispose();
});

test('onboarding diagnostic states keep fallback and pending distinct from captured model copy',async()=>{
 const {onboardingState}=await import('../src/still/onboarding-state.ts');
 assert.deepEqual(onboardingState(undefined,false),{state:'Not Requested',note:'Off',timing:undefined});
 assert.equal(onboardingState({source:'local'},true).state,'Not Requested');
 assert.equal(onboardingState({source:'pending',requestElapsedMs:100},true).timing,undefined);
 assert.equal(onboardingState({source:'pending'},true).state,'Pending');
 const received=onboardingState({source:'model',requestElapsedMs:1960,elapsedMs:500,tipCount:3},true);
 assert.equal(received.state,'Received');assert.equal(received.timing.label,'1.96 s total');assert.equal(received.note,'3 tooltips received');
 assert.match(received.timing.description,/Browser delivery: 1.96 s/);assert.match(received.timing.description,/Server processing: 500 ms/);
 for(const layer of ['browser','server']){
  const cached=onboardingState({source:'model',requestElapsedMs:0,tipCount:2,cache:{layer,status:'hit',originalLatencyMs:900}},true);
  assert.equal(cached.state,'Received');assert.equal(cached.timing.label,`0 ms ${layer} cache`);assert.match(cached.timing.description,/Original computation: 900 ms/);
 }
 const failed=onboardingState({source:'local',reason:'unavailable',requestElapsedMs:8000},true);
 assert.equal(failed.state,'Fallback');assert.equal(failed.note,'Local wording · Request unavailable');assert.equal(failed.timing.label,'8.00 s total');
 assert.equal(onboardingState({source:'model',tipCount:3,requestElapsedMs:900},false).timing,undefined);
});

test('durable onboarding survives a fresh worker cache and unrelated profile changes, but expires and respects context',async()=>{
 const f=await createSceneCostFixture(),saved=globalThis.fetch;let calls=0;
 globalThis.fetch=async(_url,init)=>{calls++;return valid(JSON.parse(init.body).model);};
 f.sqlite.exec(readFileSync(new URL('../drizzle/0041_still_decision_cache.sql',import.meta.url),'utf8'));
 const cold=()=>{f.env.DB={...f.env.DB};};
 const call=async(value=input)=>{const response=await f.request('/api/still/onboarding',f.json(value));assert.match(response.headers.get('server-timing'),/authorization;dur=/);return response.json();};
 try{
  const first=await call();assert.equal(first.timing.cacheSource,'none');assert.ok(first.timing.serverMs>=first.timing.providerMs);
  const row=f.sqlite.prepare("SELECT cache_key,body FROM still_decision_cache WHERE cache_key LIKE 'onboarding:%'").get();assert.ok(row);assert.ok(!row.body.includes('fixture-standard-key'));
  f.sqlite.prepare("UPDATE users SET display_name='Changed profile name'").run();cold();
  const hit=await call();assert.equal(hit.cache.status,'hit');assert.equal(hit.timing.cacheSource,'durable');assert.equal(hit.timing.providerMs,0);assert.equal(hit.timing.reservationMs,0);assert.equal(calls,1);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM budget_reservations WHERE operation='still-onboarding'").get().n,1);
  cold();const changed=await call({...input,context:{available:{projects:4}}});assert.equal(changed.timing.cacheSource,'none');assert.equal(calls,2);
  f.sqlite.prepare("UPDATE still_decision_cache SET expires_at=0 WHERE cache_key LIKE 'onboarding:%'").run();cold();
  assert.equal((await call()).timing.cacheSource,'none');assert.equal(calls,3);
 }finally{globalThis.fetch=saved;await f.drainBackground();f.close();}
});

test('durable onboarding cannot cross owners, permissions, or corrupt stored content',async()=>{
 const f=await createSceneCostFixture(),saved=globalThis.fetch;let calls=0;
 globalThis.fetch=async(_url,init)=>{calls++;return valid(JSON.parse(init.body).model);};
 try{
  f.sqlite.exec(readFileSync(new URL('../drizzle/0041_still_decision_cache.sql',import.meta.url),'utf8'));
  const call=async()=>{f.env.DB={...f.env.DB};return (await f.request('/api/still/onboarding',f.json(input))).json();};
  await call();
  f.sqlite.prepare("UPDATE still_decision_cache SET owner_id='someone-else' WHERE cache_key LIKE 'onboarding:%'").run();assert.equal((await call()).cache.status,'miss');
  f.sqlite.prepare("UPDATE still_decision_cache SET body='invalid' WHERE cache_key LIKE 'onboarding:%'").run();assert.equal((await call()).cache.status,'miss');
  f.sqlite.prepare("UPDATE users SET role='viewer'").run();assert.equal((await call()).cache.status,'miss');
  f.sqlite.prepare("UPDATE users SET consent_version=NULL").run();assert.equal((await f.request('/api/still/onboarding',f.json(input))).status,428);assert.equal(calls,4);
 }finally{globalThis.fetch=saved;await f.drainBackground();f.close();}
});

test('denied token allowance releases concurrent dollar reservation and never calls provider',async()=>{
 const f=await createSceneCostFixture(),saved=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;throw new Error('no spend');};
 try{
  await f.request('/api/session');f.sqlite.prepare("UPDATE budget_counters SET used_tokens=hard_limit_tokens WHERE scope='user'").run();
  const value=await(await f.request('/api/still/onboarding',f.json(input))).json();assert.equal(value.reason,'budget');assert.equal(calls,0);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM cost_budget_reservations WHERE operation='still-onboarding' AND status='active'").get().n,0);
 }finally{globalThis.fetch=saved;await f.drainBackground();f.close();}
});

test('token and dollar reservation batches overlap before provider submission',{timeout:5000},async()=>{
 const f=await createSceneCostFixture(),saved=globalThis.fetch;let release,calls=0;
 const entered=new Set(),gate=new Promise(resolve=>release=resolve);
 f.controls.beforeBatch=async statements=>{
  const kind=statements.some(s=>/INSERT.*INTO budget_reservations\b/.test(s.sql))?'tokens':statements.some(s=>/INSERT.*INTO cost_budget_reservations\b/.test(s.sql))?'dollars':null;
  if(!kind)return;entered.add(kind);if(entered.size===2)release();await gate;
 };
 globalThis.fetch=async(_url,init)=>{calls++;assert.equal(entered.size,2);return valid(JSON.parse(init.body).model);};
 try{
  const result=await(await f.request('/api/still/onboarding',f.json(input))).json();assert.equal(result.source,'model');assert.equal(calls,1);
 }finally{release();f.controls.beforeBatch=null;globalThis.fetch=saved;await f.drainBackground();f.close();}
});

test('a failed dollar reservation releases the independently acquired token hold',async()=>{
 const f=await createSceneCostFixture(),saved=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;throw new Error('no spend');};
 f.controls.beforeBatch=statements=>{if(statements.some(s=>/INSERT.*INTO cost_budget_reservations\b/.test(s.sql)))throw new Error('database unavailable');};
 try{
  const value=await(await f.request('/api/still/onboarding',f.json(input))).json();assert.equal(value.reason,'budget');assert.equal(calls,0);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM budget_reservations WHERE operation='still-onboarding' AND status='active'").get().n,0);
 }finally{f.controls.beforeBatch=null;globalThis.fetch=saved;await f.drainBackground();f.close();}
});

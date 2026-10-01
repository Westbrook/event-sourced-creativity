import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSceneCostFixture} from './helpers/scene-cost-fixture.mjs';

test('remembered goal decisions stay out of durable cache and clearing during assessment rejects the stale result',async()=>{
 const f=await createSceneCostFixture(1,'visual'),fetch=globalThis.fetch;
 for(const migration of ['0038_scene_source_generations.sql','0041_still_decision_cache.sql','0074_still_action_outcomes.sql'])f.sqlite.exec(readFileSync(new URL('../drizzle/'+migration,import.meta.url),'utf8'));
 f.env.JEV_API_KEY='fixture-only';const scope={projectId:f.projectId,documentId:f.documentId};
 const changeGoal=(method,body={scope})=>f.request('/api/still/goal',{...f.json(body),method});
 const decide=()=>f.request('/api/still/decision',f.json({...scope,view:'choose-format',recentActions:[],developer:true,cacheBypass:true}));
 let state,clearDuringCall=false;
 globalThis.fetch=async(_url,init)=>{
  state=JSON.parse(init.body).state;
  if(clearDuringCall)assert.equal((await changeGoal('DELETE')).status,200);
  return Response.json({model:'fixture-resolved',usage:{input_tokens:10,output_tokens:5},answers:{fit_image:{type:'score',score:3,confidence:.9}}});
 };
 try{
  const save=await changeGoal('PUT',{scope,text:'Make the fictional keeper motive legible',criteria:['Clear motive'],remember:true});assert.equal(save.status,200,await save.clone().text());
  const response=await decide(),first=await response.json();assert.equal(response.status,200);assert.equal(first.source,'jev');assert.equal(first.retainedActionContext,true);
  assert.equal(state.actionContext.goal.text,'Make the fictional keeper motive legible');assert.equal(first.provider.resolvedModels[0],'fixture-resolved');assert.equal(first.provider.usage.input_tokens,10);
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM still_decision_cache WHERE cache_key NOT LIKE 'idea:%'").get().n,0,'Remembered private state is never copied into a durable decision cache');
  clearDuringCall=true;const changed=await(await decide()).json();assert.equal(changed.source,'fallback');assert.equal(changed.reason,'state_changed');assert.equal(changed.diagnostics,undefined);assert.deepEqual(changed.actions,[]);
  assert.ok(!JSON.stringify(changed).includes('keeper motive'));
 }finally{globalThis.fetch=fetch;await f.drainBackground();f.close();}
});

test('durable decision entries omit exact provider exchanges',async()=>{
 const f=await createSceneCostFixture(1,'visual'),fetch=globalThis.fetch;
 for(const migration of ['0038_scene_source_generations.sql','0041_still_decision_cache.sql'])f.sqlite.exec(readFileSync(new URL('../drizzle/'+migration,import.meta.url),'utf8'));f.env.JEV_API_KEY='fixture-only';
 globalThis.fetch=async()=>Response.json({model:'fixture-resolved',answers:{fit_image:{type:'score',score:3,confidence:.9}}});
 try{
  const result=await(await f.request('/api/still/decision',f.json({projectId:f.projectId,documentId:f.documentId,view:'choose-format',recentActions:[],developer:true}))).json();
  assert.ok(result.diagnostics.exchange,'The current diagnostic session remains inspectable');
  const saved=f.sqlite.prepare("SELECT body FROM still_decision_cache WHERE cache_key NOT LIKE 'idea:%'").all();
  assert.equal(saved.length,1,'The fixture certifies and writes a durable decision');
  for(const row of saved){const diagnostics=JSON.parse(row.body).response.diagnostics;assert.equal(diagnostics.exchange,undefined);assert.ok(diagnostics.passes.every(pass=>pass.exchange===undefined));}
 }finally{globalThis.fetch=fetch;await f.drainBackground();f.close();}
});

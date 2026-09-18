import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneCostFixture } from './helpers/scene-cost-fixture.mjs';
import { hasQualifiedReplayImageEstimate } from '../worker/replay-cost.ts';

const root='/api/replay-sessions';
const confirmation={directUserApproval:true,confirmationVersion:'live-replay-cost-v7',initiator:'direct-user'};
const approvalBody=cost=>({...confirmation,phrase:"I know what I'm doing",costAcknowledged:true,approvedMaximumMicrousd:cost.estimate.authorizationMicrousd,eventCount:1000,providerCoverage:'automatic',allowUserBudgetOverride:true});
const tables=['replay_approvals','replay_cost_authorizations','replay_approval_profiles','replay_development_profiles','replay_experience_profiles','replay_sessions','replay_session_operations','cost_budget_counters','cost_budget_reservations','budget_reservations'];
const snapshot=f=>Object.fromEntries(tables.map(table=>[table,f.sqlite.prepare(`SELECT * FROM ${table}`).all()]));
const setModel=(f,model)=>{if(model===undefined)delete f.env.OPENAI_IMAGE_MODEL;else f.env.OPENAI_IMAGE_MODEL=model;};

for(const model of [undefined,'gpt-image-2.5-sunburst','unqualified-future-model']){
 test(`unqualified Replay model ${model??'default'} refuses preflight, approval and creation without writes or fetch`,async t=>{
  const f=await createSceneCostFixture(1);t.after(()=>f.close());
  const calls=[];t.mock.method(globalThis,'fetch',async(...args)=>{calls.push(args);return Response.json({error:{message:'Unexpected provider request'}},{status:400});});
  setModel(f,model);assert.equal(hasQualifiedReplayImageEstimate(f.env),false);
  const before=snapshot(f);f.controls.writes.length=0;
  const estimate=await f.request(root+'/estimate',f.json({eventCount:1000}));assert.equal(estimate.status,200);
  const {cost}=await estimate.json();assert.equal(cost.qualifiedImageEstimate,false);assert.equal(cost.reasonCode,'replay_image_estimate_unqualified');assert.equal(cost.canRun,false);assert.equal(cost.canRunWithUserOverride,false);
  const approval=await f.request(root+'/approval',f.json(approvalBody(cost)));assert.equal(approval.status,409);assert.equal((await approval.json()).error,'replay_image_estimate_unqualified');
  const creation=await f.request(root,f.json({...confirmation,approvalId:'not-created'}));assert.equal(creation.status,409);assert.equal((await creation.json()).error,'replay_image_estimate_unqualified');
  await f.drainBackground();assert.deepEqual(snapshot(f),before);assert.deepEqual(f.controls.writes,[]);assert.deepEqual(calls,[]);
 });
}

test('retained Image 2 approval survives default migration refusal and still works with explicit Image 2',async t=>{
 const f=await createSceneCostFixture(1);t.after(()=>f.close());
 const calls=[];t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push({url:String(url),body:JSON.parse(init.body)});return Response.json({error:{message:'Synthetic definitive planner rejection',type:'invalid_request_error'}},{status:400});});
 setModel(f,'gpt-image-2');assert.equal(hasQualifiedReplayImageEstimate(f.env),true);
 const estimate=await f.request(root+'/estimate',f.json({eventCount:1000}));const {cost}=await estimate.json();assert.equal(cost.qualifiedImageEstimate,true);assert.equal(cost.reasonCode,null);assert.equal(cost.canRun,true);
 const offered=await f.request(root+'/approval',f.json(approvalBody(cost)));assert.equal(offered.status,200,await offered.clone().text());const {approvalId}=await offered.json();
 const before=snapshot(f);
 for(const model of [undefined,'gpt-image-2.5-sunburst']){
  setModel(f,model);f.controls.writes.length=0;
  const response=await f.request(root,f.json({...confirmation,approvalId}));assert.equal(response.status,409);assert.equal((await response.json()).error,'replay_image_estimate_unqualified');
  await f.drainBackground();assert.deepEqual(snapshot(f),before);assert.deepEqual(f.controls.writes,[]);assert.deepEqual(calls,[]);
  assert.equal(f.sqlite.prepare('SELECT consumed_at FROM replay_approvals WHERE approval_id=?').get(approvalId).consumed_at,null);
 }
 setModel(f,'gpt-image-2');
 const started=await f.request(root,f.json({...confirmation,approvalId}));await f.drainBackground();
 assert.equal(started.status,400,await started.clone().text());
 assert.equal((await started.json()).error,'invalid_request_error');
 assert.ok(f.sqlite.prepare('SELECT consumed_at FROM replay_approvals WHERE approval_id=?').get(approvalId).consumed_at);
 assert.equal(f.sqlite.prepare('SELECT status FROM replay_sessions').get().status,'failed');
 assert.equal(calls.length,1);assert.equal(calls[0].url,'https://api.openai.com/v1/responses');
 assert.match(f.sqlite.prepare('SELECT error_message FROM replay_sessions').get().error_message,/Synthetic definitive planner rejection/);
});

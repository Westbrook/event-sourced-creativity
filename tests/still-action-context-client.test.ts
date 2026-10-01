import test from 'node:test';
import assert from 'node:assert/strict';
import { StillActionContext, type ActionContext } from '../src/still/action-context-client.ts';
import type { ActionObservationInput, ActionScope, StillGoal } from '../src/still/action-outcomes.ts';

const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
const scope:ActionScope={projectId:'project-one',documentId:'document-one'};
const expiresAt=()=>new Date(Date.now()+86400000).toISOString();
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
function setup(enabled=true){
  const calls:{path:string;body?:unknown;method?:string}[]=[];
  const controller=new StillActionContext(async <T>(path:string,body?:unknown,method?:string)=>{calls.push({path,body,method});return {enabled,expiresAt:expiresAt(),directDecisionId:'direct-context',directContextExpiresAt:expiresAt()} as T;});
  controller.enter('actor-one',scope);
  const observations=()=>calls.filter(call=>call.path==='/api/still/action-observations').map(call=>call.body as ActionObservationInput);
  return {controller,calls,observations};
}

test('observations are opt-in and never derive attention or a goal',async()=>{
  const {controller,calls}=setup(false);await tick();
  controller.exposure('decision-one',['edit-block'],'main','toolbar');
  controller.select('edit-block','decision-one','document','toolbar');
  controller.commit({eventIds:['event-one']});controller.cancel();await controller.flush();
  assert.equal(calls.length,1);assert.equal(controller.value.goal,undefined);
});

test('interactive exposure, selection, invocation and verified commit form a causal chain',async()=>{
  const {controller,observations}=setup();await tick();
  controller.exposure('decision-one',['edit-block','create'],'main','toolbar','edit-block');
  controller.exposure('decision-one',['edit-block','create'],'main','toolbar','edit-block');
  controller.select('edit-block','decision-one','document','toolbar');
  controller.commit({eventIds:['event-one','event-two']});controller.cancel();await controller.flush();
  const rows=observations();assert.deepEqual(rows.map(row=>row.kind),['exposure','selection','invocation','commit']);
  assert.equal(rows[1]!.parentId,rows[0]!.id);assert.equal(rows[2]!.parentId,rows[1]!.id);assert.equal(rows[3]!.parentId,rows[2]!.id);
  assert.deepEqual(rows[3]!.eventIds,['event-one','event-two']);assert.ok(rows.every(row=>!('committed' in row)));
  assert.equal(rows[0]!.primaryActionId,'edit-block');
});

test('a received but unexposed recommendation cannot claim a suggested selection',async()=>{
  const {controller,observations}=setup();await tick();
  controller.select('edit-block','received-only','document','toolbar');controller.cancel();await controller.flush();
  const rows=observations();assert.deepEqual(rows.map(row=>row.kind),['selection','invocation','cancellation']);
  assert.ok(rows.every(row=>row.source==='direct'&&row.decisionId==='direct-context'));
  assert.equal(rows[2]!.parentId,rows[1]!.id);
});

test('opening an action or failing does not fabricate a committed outcome',async()=>{
  const {controller,observations}=setup();await tick();
  controller.select('create',undefined,'document','direct');controller.commit({});controller.failed();controller.cancel();await controller.flush();
  assert.deepEqual(observations().map(row=>row.kind),['selection','invocation','failure','cancellation']);
});

test('queued exact receipts retain the original document after same-actor navigation',async()=>{
  const {controller,observations}=setup();await tick();
  controller.select('add-context',undefined,'document','direct');controller.commit({eventIds:['event-one']});
  controller.enter('actor-one',{projectId:'project-two',documentId:'document-two'});await controller.flush();
  assert.equal(observations().length,3);assert.ok(observations().every(row=>JSON.stringify(row.scope)===JSON.stringify(scope)));
});

test('an actor switch retires queued observations and ignores stale context reads',async()=>{
  const oldRead=deferred<ActionContext>(),calls:unknown[]=[];
  const controller=new StillActionContext(async <T>(path:string,body?:unknown)=>{if(body){calls.push(body);return {} as T;}return (path.includes('document-one')?await oldRead.promise:{enabled:false}) as T;});
  controller.enter('actor-one',scope);controller.enter('actor-two',{projectId:'project-two'});
  oldRead.resolve({enabled:true,expiresAt:expiresAt()});await tick();
  assert.equal(controller.value.enabled,false);controller.select('create',undefined,'document','direct');await controller.flush();assert.deepEqual(calls,[]);
});

test('erase and disable never mutate a different scope after an in-flight observation',async()=>{
  for(const action of ['erase','disable'] as const){
    const gate=deferred<unknown>(),calls:{path:string;method?:string}[]=[];
    const controller=new StillActionContext(async <T>(path:string,_body?:unknown,method?:string)=>{calls.push({path,method});if(path==='/api/still/action-observations')return await gate.promise as T;return {enabled:true,expiresAt:expiresAt(),directDecisionId:'direct-context',directContextExpiresAt:expiresAt()} as T;});
    controller.enter('actor-one',scope);await tick();controller.select('create',undefined,'document','direct');await tick();
    const mutation=action==='erase'?controller.erase():controller.setEnabled(false);
    controller.enter('actor-one',{projectId:'project-two'});gate.resolve({});
    await assert.rejects(mutation,/Workspace changed/);
    assert.equal(calls.filter(call=>call.method==='DELETE'||call.method==='PUT').length,0);
  }
});

test('expired opt-in cannot record observations',async()=>{
  const {controller,observations}=setup();await tick();controller.value.expiresAt=new Date(Date.now()-1).toISOString();
  controller.select('create',undefined,'document','direct');await controller.flush();assert.deepEqual(observations(),[]);
});

test('explicit scoped goals are retained separately from observations and clearable',async()=>{
  const goal:StillGoal={id:'goal-one',scope,text:'Improve clarity',criteria:['Preserve the facts'],status:'active',createdAt:new Date().toISOString(),expiresAt:expiresAt()};
  const calls:{path:string;body?:unknown;method?:string}[]=[];
  const controller=new StillActionContext(async <T>(path:string,body?:unknown,method?:string)=>{calls.push({path,body,method});return (path==='/api/still/goal'?{goal}:{enabled:false}) as T;});
  controller.enter('actor-one',scope);await tick();await controller.saveGoal(goal.text,goal.criteria);
  assert.deepEqual(controller.value.goal,goal);assert.equal(controller.value.enabled,false);
  await controller.finishGoal('completed');assert.equal(controller.value.goal,undefined);
  assert.deepEqual(calls[1]!.body,{scope,text:goal.text,criteria:goal.criteria,remember:true});
  assert.deepEqual(calls[2]!.body,{scope,id:'goal-one',status:'completed'});
});

test('explicit feedback retains its scope and deadline without declaring quality automatically',async()=>{
  const {controller,observations}=setup();await tick();const until=expiresAt();
  await controller.feedback('create','decision-one','different-goal','document','toolbar',until);
  const row=observations()[0]!;assert.equal(row.kind,'feedback');assert.equal(row.feedbackScope,'document');assert.equal(row.feedbackExpiresAt,until);
  assert.equal(row.feedback,'different-goal');assert.equal(row.eventIds,undefined);assert.equal(row.jobId,undefined);
});

test('direct attribution renews an expired server window without postponing or inventing the action',async()=>{
  const {controller,calls,observations}=setup();await tick();
  controller.value.directContextExpiresAt=new Date(Date.now()-1).toISOString();
  controller.select('create',undefined,'document','direct');await tick();await controller.flush();
  assert.deepEqual(observations(),[]);assert.equal(calls.filter(call=>call.path.startsWith('/api/still/action-context?')).length,2);
  controller.select('create',undefined,'document','direct');await controller.flush();
  assert.deepEqual(observations().map(row=>row.kind),['selection','invocation']);
  assert.ok(observations().every(row=>row.decisionId==='direct-context'));
});

test('quality feedback links the exact last acknowledged commit rather than the current selection',async()=>{
  const until=expiresAt();
  const {controller,observations}=setup();await tick();
  controller.value.observations=[{id:'commit-one',scope,kind:'commit',actionId:'edit-block',decisionId:'decision-original',surface:'document',source:'toolbar',parentId:'invocation-one',recordedAt:new Date().toISOString(),expiresAt:until,eventIds:['event-original']}];
  const receipt=controller.latestCommit!;assert.equal(receipt.id,'commit-one');
  await controller.feedback(receipt.actionId!,receipt.decisionId,'helpful',receipt.surface,receipt.source,until,receipt.id);
  const feedback=observations()[0]!;assert.equal(feedback.parentId,'commit-one');assert.equal(feedback.decisionId,'decision-original');assert.equal(feedback.actionId,'edit-block');
});

test('interactive latency belongs to the first exposed final delivery, including a fresh browser-cache delivery',async()=>{
  const {controller,observations}=setup();await tick();
  controller.exposure('decision-one',['edit-block'],'main','toolbar','edit-block',{deliveryKey:'toolbar:request-one',interactiveLatencyMs:170.4});
  controller.exposure('decision-one',['edit-block'],'main','toolbar','edit-block',{deliveryKey:'toolbar:request-one',interactiveLatencyMs:190});
  controller.exposure('decision-one',['create'],'more','more',undefined,{deliveryKey:'toolbar:request-one',interactiveLatencyMs:450});
  // A browser cache delivery reuses decision evidence but has its own current request clock.
  controller.exposure('decision-one',['edit-block'],'main','toolbar','edit-block',{deliveryKey:'toolbar:cache-delivery',interactiveLatencyMs:12});
  controller.exposure('decision-palette',['rename'],'palette','palette',undefined,{deliveryKey:'palette:request-one',interactiveLatencyMs:48});
  controller.exposure('decision-late',['rename'],'main','toolbar',undefined,{deliveryKey:'toolbar:late',interactiveLatencyMs:300001});
  await controller.flush();
  const rows=observations();assert.equal(rows.length,5);
  assert.deepEqual(rows.map(row=>row.interactiveLatencyMs),[170,undefined,12,48,undefined]);
  assert.ok(rows.every(row=>!('deliveryKey' in row)));
});

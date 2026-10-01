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

test('account opt-out prevents observations and never derives attention or a goal',async()=>{
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

test('an expired recording window cannot record observations before refresh',async()=>{
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

test('workflow observations preserve invocation, version and attempt linkage without passive inference',async()=>{
  const {controller,observations}=setup();await tick();
  controller.select('add-context',undefined,'document','direct');
  const workflow={version:'still-workflow-v1' as const,instanceId:'draft-one',stage:'ideas' as const,transition:'approved' as const,status:'attempted' as const,target:{kind:'creation-node' as const,id:'node-one',revision:'hash-one'},draftRevision:3,occurredAt:new Date().toISOString()};
  const attempt=controller.workflow('add-context',workflow);
  controller.workflow('add-context',{...workflow,status:'confirmed'},attempt);
  workflow.target.revision='later-hash';await controller.flush();
  const rows=observations(),attemptRow=rows.find(row=>row.id===attempt)!;
  assert.equal(attemptRow.parentId,rows.find(row=>row.kind==='invocation')!.id);
  assert.equal(attemptRow.workflow!.target.revision,'hash-one');
  assert.equal(rows.at(-1)!.parentId,attempt);assert.equal(rows.at(-1)!.workflow!.status,'confirmed');
  assert.ok(rows.every(row=>!row.assessment&&!row.outcome));
});

test('lost observation response retries the identical id before delivering its dependent transition',async()=>{
  const calls:ActionObservationInput[]=[];const retained=new Map<string,ActionObservationInput>();let fail=true;
  const controller=new StillActionContext(async <T>(path:string,body?:unknown)=>{
    if(path==='/api/still/action-observations'){const row=body as ActionObservationInput;calls.push(structuredClone(row));if(!retained.has(row.id))retained.set(row.id,structuredClone(row));if(fail){fail=false;throw new Error('Lost response after server saved');}return {observation:{...retained.get(row.id)!,recordedAt:new Date().toISOString(),expiresAt:expiresAt()}} as T;}
    return {enabled:true,expiresAt:expiresAt(),directDecisionId:'direct-context',directContextExpiresAt:expiresAt()} as T;
  });
  controller.enter('actor-one',scope);await tick();
  const workflow={version:'still-workflow-v1' as const,instanceId:'draft-one',stage:'final-review' as const,transition:'final-review' as const,status:'confirmed' as const,target:{kind:'creation-draft' as const,id:'draft-one',revision:'3'},draftRevision:3,occurredAt:new Date().toISOString()};
  const first=controller.workflow('add-context',workflow);controller.workflow('add-context',{...workflow,transition:'presented'});await controller.flush();
  assert.equal(calls.length,3);assert.equal(retained.size,2);assert.deepEqual(calls[0],calls[1]);assert.equal(calls[2]!.parentId,first);
});

test('late initial context reads cannot resurrect disabled or erased history',async()=>{
  for(const mutation of ['disable','erase'] as const){
    const initial=deferred<ActionContext>();
    const controller=new StillActionContext(async <T>(_path:string,_body?:unknown,method?:string)=>method?{enabled:false} as T:await initial.promise as T);
    controller.enter('actor-one',scope);
    if(mutation==='disable')await controller.setEnabled(false);else await controller.erase();
    initial.resolve({enabled:true,expiresAt:expiresAt(),directDecisionId:'old-context',directContextExpiresAt:expiresAt()});await tick();
    assert.equal(controller.value.enabled,false);assert.equal(controller.value.directDecisionId,undefined);
  }
});

test('explicit assessments remain unknown by default and corrected evidence appends to its exact parent',async()=>{
  const calls:ActionObservationInput[]=[];
  const controller=new StillActionContext(async <T>(path:string,body?:unknown)=>{
    if(path==='/api/still/action-observations'){const row=body as ActionObservationInput;calls.push(row);return {observation:{...row,recordedAt:new Date().toISOString(),expiresAt:expiresAt()}} as T;}
    return {enabled:true,expiresAt:expiresAt(),directDecisionId:'direct-context',directContextExpiresAt:expiresAt()} as T;
  });
  controller.enter('actor-one',scope);await tick();const now=new Date().toISOString();
  const parent=controller.workflow('add-context',{version:'still-workflow-v1',instanceId:'draft-one',stage:'final-review',transition:'final-review',status:'confirmed',target:{kind:'creation-draft',id:'draft-one',revision:'3'},draftRevision:3,occurredAt:now});
  const assessment={version:'still-quality-assessment-v1' as const,assessmentId:'assessment-one',revision:1,target:{kind:'creation-draft' as const,id:'draft-one',revision:'review-hash'},goalId:'goal-one',criteria:[{index:0,result:'unknown' as const}],acceptance:'unknown' as const,workflowInstanceId:'draft-one',occurredAt:now,horizonStartedAt:now,horizonMs:7*86400000};
  const saved=await controller.assess('add-context',assessment);
  const corrected=await controller.assess('add-context',{...assessment,revision:2,supersedesId:saved.id,criteria:[{index:0,result:'met'}],acceptance:'accepted'});
  assert.equal(saved.parentId,parent);assert.equal(corrected.parentId,saved.id);assert.equal(saved.assessment!.acceptance,'unknown');assert.equal(corrected.assessment!.acceptance,'accepted');
  assert.equal(calls.filter(row=>row.kind==='assessment').length,2);assert.equal(calls.some(row=>row.kind==='commit'||row.kind==='outcome'),false);
});

test('a permanently lost transition is disclosed and a later workflow resumes with a fresh direct anchor',async()=>{
  const calls:ActionObservationInput[]=[];let unavailable=true;
  const controller=new StillActionContext(async <T>(path:string,body?:unknown)=>{
    if(path==='/api/still/action-observations'){
      const row=body as ActionObservationInput;calls.push(row);
      if(unavailable)throw new Error('Offline');
      return {observation:{...row,recordedAt:new Date().toISOString(),expiresAt:expiresAt()}} as T;
    }
    return {enabled:true,expiresAt:expiresAt(),directDecisionId:'direct-context',directContextExpiresAt:expiresAt()} as T;
  });
  controller.enter('actor-one',scope);await tick();
  const workflow={version:'still-workflow-v1' as const,instanceId:'draft-one',stage:'ideas' as const,transition:'presented' as const,status:'confirmed' as const,target:{kind:'creation-draft' as const,id:'draft-one',revision:'3'},draftRevision:3,occurredAt:new Date().toISOString()};
  controller.workflow('add-context',workflow);controller.workflow('add-context',{...workflow,transition:'approved'});await controller.flush();
  assert.match(controller.error,/could not be saved/);assert.equal(calls.length,4);
  unavailable=false;const resumed=controller.workflow('add-context',{...workflow,transition:'resumed'});await controller.flush();
  assert.equal(calls.at(-1)!.id,resumed);assert.equal(calls.at(-1)!.parentId,undefined);assert.equal(calls.at(-1)!.source,'direct');assert.equal(controller.value.observations?.at(-1)?.workflow?.transition,'resumed');
});

test('workflow outcomes cannot borrow an unrelated latest commit attribution',async()=>{
  const calls:ActionObservationInput[]=[];
  const controller=new StillActionContext(async <T>(path:string,body?:unknown)=>{
    if(path==='/api/still/action-observations'){const row=body as ActionObservationInput;calls.push(row);return {observation:{...row,recordedAt:new Date().toISOString(),expiresAt:expiresAt()}} as T;}
    return {enabled:true,expiresAt:expiresAt(),directDecisionId:'direct-context',directContextExpiresAt:expiresAt()} as T;
  });
  controller.enter('actor-one',scope);await tick();
  controller.select('edit-block',undefined,'document','direct');controller.commit({eventIds:['unrelated-edit']});await controller.flush();controller.finish();
  const unrelated=controller.latestCommit!,now=new Date().toISOString();
  const finalize=controller.workflow('add-context',{version:'still-workflow-v1',instanceId:'draft-one',stage:'finalized',transition:'finalize',status:'confirmed',target:{kind:'creation-draft',id:'draft-one',revision:'7'},draftRevision:7,operationId:'operation-one',occurredAt:now});
  const outcome=controller.outcome({version:'still-outcome-v1',outcomeId:'creation:operation-one:acknowledged-commit',revision:1,type:'acknowledged-commit',status:'observed',target:{kind:'creation-draft',id:'draft-one',revision:'approval-hash'},workflowInstanceId:'draft-one',operationId:'operation-one',occurredAt:now,horizonStartedAt:now,horizonMs:7*86400000});
  await controller.flush();const row=calls.find(item=>item.id===outcome)!;
  assert.equal(row.actionId,'add-context');assert.equal(row.parentId,finalize);assert.notEqual(row.parentId,unrelated.id);assert.equal(row.eventIds,undefined);assert.equal(row.jobId,undefined);
  assert.equal(controller.outcome({...row.outcome!,workflowInstanceId:'missing-workflow'}),undefined,'An unknown workflow cannot fall back to an unrelated commit');
});


test('default recording waits for an available server context and never overrides a denied enable response',async()=>{
 const initial=deferred<ActionContext>(),calls:unknown[]=[];
 const controller=new StillActionContext(async <T>(_path:string,body?:unknown,method?:string)=>{if(body)calls.push(body);return (method?{enabled:false,coverage:{status:'unavailable'}}:await initial.promise) as T;});
 controller.enter('actor-one',scope);controller.select('create',undefined,'document','direct');await controller.flush();assert.deepEqual(calls,[]);
 initial.resolve({enabled:true,expiresAt:expiresAt(),directDecisionId:'direct-context',directContextExpiresAt:expiresAt()});await tick();assert.equal(controller.value.enabled,true);
 await assert.rejects(controller.setEnabled(true),/may have been saved/);assert.equal(controller.value.enabled,false);assert.match(controller.error,/unavailable/);
 controller.select('create',undefined,'document','direct');await controller.flush();assert.equal(calls.length,1);
});

test('scope erase accepts fresh server history context without changing the account preference',async()=>{
 const calls:ActionObservationInput[]=[];
 const controller=new StillActionContext(async <T>(path:string,body?:unknown,method?:string)=>{
  if(path==='/api/still/action-observations'){calls.push(body as ActionObservationInput);return {} as T;}
  return {enabled:true,expiresAt:expiresAt(),directDecisionId:method==='DELETE'?'after-erasure':'before-erasure',directContextExpiresAt:expiresAt(),observations:[]} as T;
 });
 controller.enter('actor-one',scope);await tick();controller.select('create',undefined,'document','direct');await controller.flush();
 await controller.erase();assert.equal(controller.value.enabled,true);assert.equal(controller.value.directDecisionId,'after-erasure');
 controller.select('create',undefined,'document','direct');await controller.flush();assert.ok(calls.slice(2).every(row=>row.decisionId==='after-erasure'));
});

test('in-flight observations cannot repopulate history after disabling begins',async()=>{
 const write=deferred<{observation:ActionObservationInput&{recordedAt:string;expiresAt:string}}>(),disable=deferred<ActionContext>();let first:ActionObservationInput|undefined;
 const controller=new StillActionContext(async <T>(path:string,body?:unknown,method?:string)=>{
  if(path==='/api/still/action-observations'){first=body as ActionObservationInput;return await write.promise as T;}
  return (method?await disable.promise:{enabled:true,expiresAt:expiresAt(),directDecisionId:'direct-context',directContextExpiresAt:expiresAt(),observations:[]}) as T;
 });
 controller.enter('actor-one',scope);await tick();controller.select('create',undefined,'document','direct');await tick();
 const disabling=controller.setEnabled(false);write.resolve({observation:{...first!,recordedAt:new Date().toISOString(),expiresAt:expiresAt()}});await tick();
 assert.equal(controller.value.enabled,false);assert.deepEqual(controller.value.observations,[]);
 disable.resolve({enabled:false,observations:[]});await disabling;assert.deepEqual(controller.value.observations,[]);
});

test('an expired recording lease refreshes without carrying old workflow parents into the new lease',async()=>{
 const calls:ActionObservationInput[]=[];let reads=0;
 const controller=new StillActionContext(async <T>(path:string,body?:unknown)=>{
  if(path==='/api/still/action-observations'){calls.push(body as ActionObservationInput);return {} as T;}
  return {enabled:true,expiresAt:expiresAt(),directDecisionId:'context-'+(++reads),directContextExpiresAt:expiresAt()} as T;
 });
 controller.enter('actor-one',scope);await tick();
 const workflow={version:'still-workflow-v1' as const,instanceId:'draft-one',stage:'ideas' as const,transition:'presented' as const,status:'confirmed' as const,target:{kind:'creation-draft' as const,id:'draft-one',revision:'3'},draftRevision:3,occurredAt:new Date().toISOString()};
 controller.workflow('add-context',workflow);await controller.flush();controller.value.expiresAt=new Date(Date.now()-1).toISOString();
 assert.equal(controller.workflow('add-context',{...workflow,transition:'resumed'}),undefined);await tick();
 controller.workflow('add-context',{...workflow,transition:'resumed'});await controller.flush();
 assert.equal(calls.length,2);assert.equal(calls[1]!.decisionId,'context-2');assert.equal(calls[1]!.parentId,undefined);
});


test('opening User settings preserves active creative attribution, including expired settings receipt renewal',async()=>{
 for(const expired of [false,true]){
  const {controller,observations}=setup();await tick();
  controller.select('compose',undefined,'document','direct');await controller.flush();
  if(expired)controller.value.directContextExpiresAt=new Date(Date.now()-1).toISOString();
  controller.select('user-settings',undefined,'palette','direct',{preserveInvocation:true});await tick();
  controller.commit({eventIds:['creative-operation']});await controller.flush();
  const rows=observations(),creative=rows.find(row=>row.kind==='invocation'&&row.actionId==='compose')!,commit=rows.find(row=>row.kind==='commit')!;
  assert.equal(commit.actionId,'compose');assert.equal(commit.parentId,creative.id);assert.equal(commit.decisionId,creative.decisionId);
  assert.equal(rows.filter(row=>row.actionId==='user-settings').length,expired?0:2);
 }
});


test('unavailable explicit settings and erase responses reject after retiring attribution',async()=>{
 for(const mutation of ['enable','disable','erase'] as const)for(const rejected of [false,true]){
  const calls:ActionObservationInput[]=[];
  const controller=new StillActionContext(async <T>(path:string,body?:unknown,method?:string)=>{
   if(path==='/api/still/action-observations'){calls.push(body as ActionObservationInput);return {} as T;}
   if(method&&rejected)throw new Error('Lost mutation response');
   return (method?{enabled:false,coverage:{status:'unavailable'}}:{enabled:true,expiresAt:expiresAt(),directDecisionId:'direct-context',directContextExpiresAt:expiresAt()}) as T;
  });
  controller.enter('actor-one',scope);await tick();controller.select('compose',undefined,'document','direct');await controller.flush();
  await assert.rejects(mutation==='erase'?controller.erase():controller.setEnabled(mutation==='enable'),/could not be confirmed/);
  assert.equal(controller.value.coverage?.status,'unavailable');assert.equal(controller.value.enabled,false);
  controller.commit({eventIds:['must-not-record']});await controller.flush();assert.equal(calls.length,2);assert.equal(controller.value.directDecisionId,undefined);
 }
});

test('failed initial and renewed context requests disclose unknown history preference',async()=>{
 for(const stage of ['initial','renewal']){
  let reads=0;const calls:unknown[]=[];
  const controller=new StillActionContext(async <T>(path:string,body?:unknown)=>{
   if(body){calls.push(body);return {} as T;}
   if(stage==='initial'||++reads>1)throw new Error('Server unavailable');
   return {enabled:true,expiresAt:expiresAt(),directDecisionId:'direct-context',directContextExpiresAt:expiresAt()} as T;
  });
  controller.enter('actor-one',scope);await tick();
  if(stage==='renewal'){controller.value.directContextExpiresAt=new Date(Date.now()-1).toISOString();controller.select('user-settings',undefined,'palette','direct',{preserveInvocation:true});await tick();}
  assert.equal(controller.loaded,true);assert.equal(controller.value.coverage?.status,'unavailable');assert.equal(controller.value.enabled,false);assert.match(controller.error,/unavailable/);
  controller.select('compose',undefined,'document','direct');await controller.flush();assert.deepEqual(calls,[]);
 }
});

test('acknowledged goal edits retire stale context successes and failures without retiring creative attribution',async()=>{
 for(const mutation of ['clear','save'] as const)for(const fail of [false,true]){
  let reads=0,resolve!:(value:ActionContext)=>void,reject!:(error:Error)=>void;
  const held=new Promise<ActionContext>((done,failed)=>{resolve=done;reject=failed;}),calls:ActionObservationInput[]=[];
  const goal:StillGoal={id:'old-goal',scope,text:'Old goal',criteria:['Clear motive'],status:'active',createdAt:new Date().toISOString(),expiresAt:expiresAt()};
  const context:ActionContext={enabled:true,goal,expiresAt:expiresAt(),directDecisionId:'original-context',directContextExpiresAt:expiresAt()};
  const replacement={...goal,id:'new-goal',text:'New goal'};
  const controller=new StillActionContext(async <T>(path:string,body?:unknown,method?:string)=>{
   if(path==='/api/still/action-observations'){calls.push(body as ActionObservationInput);return {} as T;}
   if(path==='/api/still/goal')return (method==='PUT'?{goal:replacement}:{}) as T;
   return (++reads===1?context:await held) as T;
  });
  controller.enter('actor-one',scope);await tick();controller.select('compose',undefined,'document','direct');await controller.flush();
  controller.value.directContextExpiresAt=new Date(Date.now()-1).toISOString();controller.select('user-settings',undefined,'palette','direct',{preserveInvocation:true});
  if(mutation==='clear')await controller.finishGoal('clear');else await controller.saveGoal(replacement.text,replacement.criteria);
  if(fail)reject(new Error('Late unavailable response'));else resolve({...context,goal});await tick();
  assert.equal(controller.value.goal?.id,mutation==='clear'?undefined:'new-goal');assert.equal(controller.value.enabled,true);assert.equal(controller.value.coverage?.status,undefined);assert.equal(controller.error,'');
  controller.commit({eventIds:['creative-operation']});await controller.flush();
  const invocation=calls.find(row=>row.kind==='invocation'&&row.actionId==='compose')!,commit=calls.find(row=>row.kind==='commit')!;
  assert.equal(commit.actionId,'compose');assert.equal(commit.parentId,invocation.id);assert.equal(commit.decisionId,invocation.decisionId);
 }
});


test('same-scope history refresh recovers an unavailable preference with a read and no setting mutation',async()=>{
 const calls:{path:string;method?:string}[]=[];let reads=0;
 const controller=new StillActionContext(async <T>(path:string,_body?:unknown,method?:string)=>{
  calls.push({path,method});if(++reads===1)throw new Error('Temporarily unavailable');
  return {enabled:true,expiresAt:expiresAt(),directDecisionId:'recovered-context',directContextExpiresAt:expiresAt(),coverage:{status:'complete'}} as T;
 });
 controller.enter('actor-one',scope);await tick();assert.equal(controller.value.coverage?.status,'unavailable');
 controller.enter('actor-one',scope);assert.equal(calls.length,1,'Ordinary render re-entry does not retry');
 await controller.refresh();assert.equal(controller.value.enabled,true);assert.equal(controller.value.coverage?.status,'complete');assert.equal(controller.error,'');assert.equal(controller.value.directDecisionId,'recovered-context');
 assert.equal(calls.length,2);assert.ok(calls.every(call=>call.method===undefined&&call.path.startsWith('/api/still/action-context?')));
});

test('refresh after an unavailable renewal preserves the original invocation and queued observations',async()=>{
 const write=deferred<unknown>(),calls:ActionObservationInput[]=[];let reads=0;
 const controller=new StillActionContext(async <T>(path:string,body?:unknown)=>{
  if(path==='/api/still/action-observations'){calls.push(body as ActionObservationInput);if(calls.length===1)return await write.promise as T;return {} as T;}
  if(++reads===2)throw new Error('Temporary unavailable renewal');
  return {enabled:true,expiresAt:expiresAt(),directDecisionId:'context-'+reads,directContextExpiresAt:expiresAt()} as T;
 });
 controller.enter('actor-one',scope);await tick();controller.select('compose',undefined,'document','direct');await tick();
 controller.value.directContextExpiresAt=new Date(Date.now()-1).toISOString();controller.select('user-settings',undefined,'palette','direct',{preserveInvocation:true});await tick();assert.equal(controller.value.coverage?.status,'unavailable');
 await controller.refresh();assert.equal(controller.value.enabled,true);write.resolve({});await controller.flush();
 controller.commit({eventIds:['creative-operation']});await controller.flush();
 assert.deepEqual(calls.map(row=>row.kind),['selection','invocation','commit']);assert.ok(calls.every(row=>row.actionId==='compose'&&row.decisionId==='context-1'));assert.equal(calls[2]!.parentId,calls[1]!.id);
});

test('same-scope refresh ignores stale successes and failures after scope navigation or a newer refresh',async()=>{
 for(const navigation of [false,true])for(const failure of [false,true]){
  let reads=0,resolve!:(value:ActionContext)=>void,reject!:(error:Error)=>void;
  const held=new Promise<ActionContext>((done,failed)=>{resolve=done;reject=failed;});
  const controller=new StillActionContext(async <T>()=>{
   if(++reads===1)throw new Error('Initial unavailable');if(reads===2)return await held as T;
   return {enabled:true,expiresAt:expiresAt(),directDecisionId:'current-context',directContextExpiresAt:expiresAt(),coverage:{status:'complete'}} as T;
  });
  controller.enter('actor-one',scope);await tick();const prior=controller.refresh();
  if(navigation){controller.enter('actor-one',{projectId:'other-project'});await tick();}else await controller.refresh();
  if(failure)reject(new Error('Stale failure'));else resolve({enabled:false,coverage:{status:'unavailable'}});await prior;
  assert.equal(controller.value.enabled,true);assert.equal(controller.value.directDecisionId,'current-context');assert.equal(controller.error,'');assert.equal(controller.value.coverage?.status,'complete');
 }
});

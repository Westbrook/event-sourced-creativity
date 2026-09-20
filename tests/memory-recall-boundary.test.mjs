import assert from 'node:assert/strict';
import test from 'node:test';
import {projectContainmentForest} from '../src/model/project-containment.ts';
import {memoryRecallRelation} from '../src/model/memory-recall-boundary.ts';
import {createRecallBoundaryClient} from '../src/state/memory-recall-boundary-client.ts';
const nodes=[['root',null],['left','root'],['right','root'],['remote',null]].map(([id,parentId])=>({id,parentId,organizationId:null}));
const forest=projectContainmentForest(nodes),readable=new Set(nodes.map(n=>n.id));
const scope=(projectId='left',documentId='a')=>({actorId:'actor',ownerId:'actor',organizationId:null,projectId,documentId});
for(const boundary of ['document','project','project-tree','partition'])test('recall rank respects '+boundary+' source consent',()=>{
 assert.deepEqual(memoryRecallRelation(scope(),scope(),boundary,forest,readable),{zoom:'document',distance:0,weight:1});
 assert.equal(memoryRecallRelation(scope(),scope('left','b'),boundary,forest,readable)?.zoom??null,boundary==='document'?null:'project');
 assert.equal(memoryRecallRelation(scope(),scope('right'),boundary,forest,readable)?.zoom??null,['project-tree','partition'].includes(boundary)?'project-tree':null);
 assert.equal(memoryRecallRelation(scope(),scope('remote'),boundary,forest,readable)?.zoom??null,boundary==='partition'?'partition':null);
});
for(const field of ['actorId','ownerId','organizationId'])test('no cross '+field+' recall even with partition consent',()=>{
 assert.equal(memoryRecallRelation(scope(),{...scope(),[field]:'foreign'},'partition',forest,readable),null);
});
test('unreadable intermediate scope never becomes a shared ancestor',()=>{
 assert.equal(memoryRecallRelation(scope(),scope('right'),'project-tree',forest,new Set(['left','right'])),null);
 assert.equal(memoryRecallRelation(scope(),scope('right'),'partition',forest,new Set(['left','right'])).zoom,'partition');
 assert.equal(memoryRecallRelation(scope(),scope('right'),'partition',forest,new Set(['left','root'])),null);
 const local=memoryRecallRelation(scope(),scope(),'partition',forest,readable),project=memoryRecallRelation(scope(),scope('left','b'),'partition',forest,readable),tree=memoryRecallRelation(scope(),scope('right'),'partition',forest,readable),world=memoryRecallRelation(scope(),scope('remote'),'partition',forest,readable);
 assert.ok(local.weight>project.weight&&project.weight>tree.weight&&tree.weight>world.weight);
});
const selected={projectId:'left',documentId:'a'},signal=()=>new AbortController().signal;
const response=()=>({version:'memory-scope-recall-v1',enrollmentId:'enrollment',enrollmentRevision:1,boundary:'document',revision:null,validUntil:new Date(Date.now()+20000).toISOString()});
test('client mounts without a read and changes consent only with an exact explicit request',async()=>{
 const calls=[];const client=createRecallBoundaryClient(async(url,init)=>{calls.push({url,init});return Response.json(init.method==='GET'?response():{version:'memory-scope-recall-v1',saved:true,refreshRequired:true});});
 assert.equal(calls.length,0);const view=await client.boundary(selected,signal());await client.save(selected,view,'project',signal());
 assert.equal(calls.length,2);assert.equal(calls[1].init.credentials,'same-origin');assert.equal(calls[1].init.redirect,'error');
 assert.equal(JSON.parse(calls[1].init.body).confirmation,'CHANGE_RECALL_BOUNDARY');assert.equal(JSON.parse(calls[1].init.body).revision,null);
});
for(const fault of ['unknown','expired','unbounded','malformed','disabled','oversize'])test('client rejects '+fault+' boundary response without retry',async()=>{
 let calls=0;const client=createRecallBoundaryClient(async()=>{calls++;const value=response();
  if(fault==='unknown')value.extra=true;if(fault==='expired')value.validUntil=new Date(Date.now()-1).toISOString();
  if(fault==='unbounded')value.validUntil=new Date(Date.now()+60000).toISOString();if(fault==='malformed')value.boundary='everyone';
  return fault==='oversize'?new Response(' '.repeat(524289),{headers:{'content-type':'application/json'}}):Response.json(value,{status:fault==='disabled'?403:200});
 });await assert.rejects(client.boundary(selected,signal()));assert.equal(calls,1);
});
test('a network failure on save is not retried or acknowledged',async()=>{
 let calls=0;const client=createRecallBoundaryClient(async()=>{calls++;throw Error('lost ack');});
 await assert.rejects(client.save(selected,response(),'partition',signal()));assert.equal(calls,1);
});
test('source catalog rejects duplicates and invented ranking weights',async()=>{
 const item={enrollmentId:'one',projectId:'right',documentId:'b',zoom:'project-tree',distance:2,weight:.5/3};
 for(const sources of [[item,item],[{...item,weight:1}]]){
  const client=createRecallBoundaryClient(async()=>Response.json({version:'memory-scope-recall-v1',sources,validUntil:new Date(Date.now()+20000).toISOString(),complete:true}));
  await assert.rejects(client.sources(selected,signal()));
 }
});

test('even the farthest allowed project-tree path outweighs unrelated partition recall',()=>{
 const nodes=[{id:'root',parentId:null,organizationId:null},{id:'remote',parentId:null,organizationId:null}];
 for(const branch of ['left','right'])for(let i=1;i<=15;i++)nodes.push({id:branch+i,parentId:i===1?'root':branch+(i-1),organizationId:null});
 const graph=projectContainmentForest(nodes),visible=new Set(nodes.map(n=>n.id));assert.ok(graph);
 const tree=memoryRecallRelation(scope('left15'),scope('right15'),'partition',graph,visible),global=memoryRecallRelation(scope('remote'),scope('right15'),'partition',graph,visible);
 assert.equal(tree.distance,30);assert.ok(tree.weight>global.weight);
});

test('native document IDs retain the existing 240-character Memory contract',()=>{
 assert.ok(memoryRecallRelation(scope('left','d'.repeat(240)),scope('left','other'),'project',forest,readable));
 assert.equal(memoryRecallRelation(scope('left','d'.repeat(241)),scope('left','other'),'project',forest,readable),null);
});

test('recall client sends only canonical scope fields, never caller custody or UI data',async()=>{
 const client=createRecallBoundaryClient(async(url)=>{assert.deepEqual([...new URL(url,'https://fixture.invalid').searchParams],Object.entries(selected));return Response.json({version:'memory-scope-recall-v1',sources:[],validUntil:new Date(Date.now()+20000).toISOString(),complete:true});});
 await client.sources({...selected,custody:{kind:'personal'},privateDraft:'must-not-be-sent'},signal());
});

test('already cancelled recall operation does not dispatch a consent write',async()=>{
 let calls=0;const controller=new AbortController();controller.abort();const client=createRecallBoundaryClient(async()=>{calls++;return Response.json({});});
 await assert.rejects(client.reset(selected,controller.signal));assert.equal(calls,0);
});

for(const stage of ['transport','body'])test('recall client cancellation interrupts stalled '+stage,async()=>{
 const controller=new AbortController();let cancelled=false,transportSignal;
 const client=createRecallBoundaryClient(async(_url,init)=>{transportSignal=init.signal;
  if(stage==='transport')return new Promise(()=>{});
  return new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-type':'application/json'}});
 });
 const read=client.boundary(selected,controller.signal);await new Promise(resolve=>setTimeout(resolve,0));controller.abort();
 await assert.rejects(read);assert.equal(transportSignal.aborted,true);if(stage==='body')assert.equal(cancelled,true);
});

for(const stage of ['transport','body'])test('recall client ends a stalled '+stage+' at the bounded timeout',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let cancelled=false,finish;
 const client=createRecallBoundaryClient(async()=>stage==='transport'?new Promise(resolve=>{finish=resolve;}):new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-type':'application/json'}}));
 const pending=client.boundary(selected,signal()),rejected=assert.rejects(pending);
 await Promise.resolve();await Promise.resolve();await Promise.resolve();t.mock.timers.tick(30000);await rejected;
 if(stage==='body')assert.equal(cancelled,true);
 else{finish(new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-type':'application/json'}}));await Promise.resolve();await Promise.resolve();await Promise.resolve();assert.equal(cancelled,true);}
});

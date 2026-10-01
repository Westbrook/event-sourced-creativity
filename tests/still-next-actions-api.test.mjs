import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneCostFixture } from './helpers/scene-cost-fixture.mjs';
import { StillClient } from '../src/still/client.ts';
import { operationJournal } from '../src/still/operation-journal.ts';
import { useInPlan } from '../src/still/use-in.ts';

const score=(value=3,confidence=.9)=>({type:'score',score:value,confidence,probabilities:{0:0,1:0,2:3-value,3:value-2}});
test('batched assessment and optional evidence have paired, sanitized traces; enrichment failure keeps the first menu',async()=>{
  const f=await createSceneCostFixture(1,'visual'),fetch=globalThis.fetch,now=Date.now;let clock=now()+500000,failSecond=false,bodies=[];
  f.env.JEV_API_KEY='fixture-secret-key';Date.now=()=>clock;
  globalThis.fetch=async(_url,init)=>{
    const body=JSON.parse(init.body);bodies.push(body);
    if(body.questions.target_0){
      assert.doesNotMatch(JSON.stringify(body),/DO_NOT_FORWARD/);if(failSecond)throw new Error('offline');
      return Response.json({model:'simulated-enrichment',answers:Object.fromEntries(Object.entries(body.questions).map(([id,q])=>[id,q.type==='score'?score():{type:'noul',noul:id.startsWith('conflict_')?0:.5}]))});
    }
    return Response.json({model:'simulated-assessment',answers:Object.fromEntries(Object.entries(body.questions).map(([id,q])=>[id,q.type==='score'?{...score(id==='use_use-in'?3:2.2),secret:'DO_NOT_FORWARD'}:q.type==='noul'?{type:'noul',noul:.5,legend:'DO_NOT_FORWARD'}:{type:'choice',choice:'organize',confidence:.8,secret:'DO_NOT_FORWARD'}]))});
  };
  const request=async(developer=true)=>{clock+=2000;bodies=[];const r=await f.request('/api/still/decision',f.json({projectId:f.projectId,documentId:f.documentId,blockId:'scene-reuse-direction',view:'document',developer,cacheBypass:true}));assert.equal(r.status,200,await r.clone().text());return r.json();};
  try{
    const counts=f.counts(),good=await request();assert.equal(bodies.length,3);assert.equal(good.diagnostics.passes.length,3);
    assert.equal(bodies[0].state.compositions.length,4);assert.ok(good.targets['use-in']);
    assert.deepEqual(good.rankedActions.map(a=>a.id),good.diagnostics.actions.filter(a=>a.rank).sort((a,b)=>a.rank-b.rank).map(a=>a.action.id));
    assert.ok(good.rankedActions.length>good.actions.length);
    for(const a of good.rankedActions)assert.ok(good.presentation[a.id].usefulProbability>=0&&good.presentation[a.id].usefulProbability<=1);
    for(let i=0;i<3;i++)assert.deepEqual(good.diagnostics.passes[i].exchange.request,bodies[i]);
    assert.equal(good.diagnostics.passes[1].model,'simulated-enrichment');assert.ok(good.diagnostics.passes[1].questions.some(q=>q.id==='target_0'));
    assert.ok(!good.diagnostics.questions.some(q=>q.id==='target_0'));assert.doesNotMatch(JSON.stringify(good),/fixture-secret-key|DO_NOT_FORWARD/);
    const ordinary=await request(false);assert.equal(ordinary.diagnostics,undefined);assert.deepEqual(ordinary.actions,good.actions);assert.deepEqual(ordinary.rankedActions,good.rankedActions);
    failSecond=true;const failed=await request();assert.equal(bodies.length,3);assert.deepEqual(failed.actions,good.actions);assert.equal(failed.targets,undefined);
    assert.equal(failed.cache.stored,false);assert.equal(failed.diagnostics.passes[1].status,'failed');assert.equal(failed.diagnostics.passes[1].model,undefined);assert.ok(failed.diagnostics.passes[1].exchange);assert.equal(failed.diagnostics.passes[1].exchange.responseStatus,undefined);
    assert.deepEqual(f.counts(),counts);
  }finally{globalThis.fetch=fetch;Date.now=now;await f.drainBackground();f.close();}
});
test('finder accepts only an eligible confident choice and never mutates or starts a second pass',async()=>{
  const f=await createSceneCostFixture(1,'visual'),fetch=globalThis.fetch,now=Date.now;let clock=now()+600000,calls=0,choice='use-in',confidence=.9,includeDistribution=true;
  f.env.JEV_API_KEY='fixture-secret-key';Date.now=()=>clock;
  globalThis.fetch=async(_url,init)=>{calls++;const body=JSON.parse(init.body);assert.equal(body.state.current.view,'find-action');assert.ok(!body.state.connectionCandidates.length);return Response.json({answers:{action:{type:'choice',choice,confidence,...(includeDistribution?{probabilities:Object.fromEntries(Object.keys(body.questions.action.criteria).map(id=>[id,id===choice?1:0]))}:{})}}});};
  const request=async()=>{clock+=2000;const r=await f.request('/api/still/decision',f.json({projectId:f.projectId,documentId:f.documentId,view:'find-action',intent:'use this in a character',developer:true}));assert.equal(r.status,200);return r.json();};
  try{const counts=f.counts();assert.equal((await request()).resolvedAction,'use-in');choice='delete-everything';assert.equal((await request()).resolvedAction,undefined);choice='use-in';confidence=.1;assert.equal((await request()).resolvedAction,undefined);confidence=.9;includeDistribution=false;assert.equal((await request()).resolvedAction,undefined,'Finder abstains without a complete choice distribution');assert.equal(calls,4);assert.deepEqual(f.counts(),counts);}
  finally{globalThis.fetch=fetch;Date.now=now;await f.drainBackground();f.close();}
});
for(const shared of [false,true])test(`use-in persists canonical copies and recovers a lost receipt once (${shared?'shared':'personal'})`,async()=>{
  const f=await createSceneCostFixture(1,'visual',{shared}),fetch=globalThis.fetch;let posts=0,drop=false;
  globalThis.fetch=async(url,init)=>{assert.ok(String(url).startsWith('/'),'No provider calls');if(url==='/api/events'&&init?.method==='POST'){posts++;const response=await f.request(url,init);if(drop){drop=false;assert.equal(response.status,200,await response.clone().text());throw new Error('lost committed receipt');}return response;}return f.request(String(url),init);};
  try{
    const c=new StillClient();await c.load();c.position={...c.position,projectId:f.projectId,documentId:f.documentId,blockId:'scene-reuse-direction',view:'document'};
    const sourcePosition={...c.position},destination=await c.createDocument('Character destination','A keeper with a cap.');
    c.position={...c.position,...destination,blockId:''};const character=c.blockEvent('Mara works at the harbor.','Mara','subject');await c.append([character]);c.position=sourcePosition;
    const plan=useInPlan(c.events,c.position,'scene-reuse-direction',`block:${character.payload.block_id}`),counts=f.counts();drop=true;
    await assert.rejects(c.append(plan.events),/lost committed receipt/);const after=posts;await c.append(plan.events);assert.equal(posts,after);assert.equal(c.hasUnconfirmedWrite,false);
    assert.equal(c.events.filter(e=>e.type==='BlockCreated'&&e.payload.block_id===plan.rootId).length,1);
    const edge=c.events.find(e=>e.type==='BlockRelationAdded'&&e.payload.to_block_id===plan.rootId);assert.equal(edge.payload.from_block_id,character.payload.block_id);assert.equal(edge.payload.document_id,destination.documentId);
    assert.equal(c.projection.blocks.find(b=>b.id==='scene-reuse-direction').properties.text,'The keeper checks the harbor.');assert.deepEqual(f.counts(),counts);
  }finally{globalThis.fetch=fetch;operationJournal.clearWrite(`${f.owner}:${f.sharing?.projectAccessId??'personal'}`);await f.drainBackground();f.close();}
});

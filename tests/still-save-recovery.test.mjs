import test from 'node:test';
import assert from 'node:assert/strict';
import {createSceneCostFixture} from './helpers/scene-cost-fixture.mjs';
import {StillClient} from '../src/still/client.ts';
import {operationJournal} from '../src/still/operation-journal.ts';

for(const shared of [false,true])test(`pending save recovery after reload (${shared?'shared':'personal'}) never resubmits`,async t=>{
 const f=await createSceneCostFixture(1,'visual',{shared}),original=globalThis.fetch;
 const scope=`${f.owner}:${f.sharing?.projectAccessId??'personal'}`;
 let posts=0,fail=true;
 globalThis.fetch=async(url,init)=>{
  assert.ok(String(url).startsWith('/'),'No external requests');
  if(url==='/api/events'&&init?.method==='POST'){
   posts++;
   if(fail)return Response.json({error:'D1_ERROR: triggers nested too deep: SQLITE_ERROR'},{status:500});
  }
  return f.request(String(url),init);
 };
 t.after(async()=>{globalThis.fetch=original;operationJournal.clearWrite(scope);await f.drainBackground();f.close();});
 const c=new StillClient();await c.load();if(shared)c.position.projectId=f.projectId;
 const create=client=>shared?client.createDocument('Saved document',''):client.createProject('Saved project');
 await assert.rejects(create(c),/triggers nested too deep/);assert.equal(posts,1);
 // A real reload has the journal but none of the form's creative text/creation IDs.
 const reopened=new StillClient();await reopened.load();if(shared)reopened.position.projectId=f.projectId;
 assert.equal(reopened.hasUnconfirmedWrite,true);
 const checked=await reopened.checkPendingSave();assert.equal(checked.confirmed,false);assert.equal(posts,1);
 await assert.rejects(reopened.startNewSave('stale-check'),/pending save changed/);assert.equal(reopened.hasUnconfirmedWrite,true);
 fail=false;const result=await reopened.startNewSave(checked.correlationId);
 assert.equal(result.confirmed,false);assert.equal(reopened.hasUnconfirmedWrite,false);assert.equal(posts,1,'Unlock is read-only');
 await create(reopened);assert.equal(posts,2,'Only explicit new save writes');
 assert.equal(reopened.hasUnconfirmedWrite,false);
 const reloaded=new StillClient();await reloaded.load();assert.equal(reloaded.hasUnconfirmedWrite,false);
});

test('a late committed receipt is recognized before explicit unlock; failed checks preserve the journal',async t=>{
 const f=await createSceneCostFixture(1),original=globalThis.fetch,scope=`${f.owner}:personal`;
 let posts=0,retained,offline=false;
 globalThis.fetch=async(url,init)=>{
  if(offline)throw Error('offline');
  if(url==='/api/events'&&init?.method==='POST'){posts++;retained=init;throw Error('receipt lost');}
  return f.request(String(url),init);
 };
 t.after(async()=>{globalThis.fetch=original;operationJournal.clearWrite(scope);await f.drainBackground();f.close();});
 const c=new StillClient();await c.load();await assert.rejects(c.createProject('Late project'),/receipt lost/);
 const checked=await c.checkPendingSave();assert.equal(checked.confirmed,false);
 offline=true;await assert.rejects(c.startNewSave(checked.correlationId),/offline/);assert.equal(c.hasUnconfirmedWrite,true);
 offline=false;const committed=await f.request('/api/events',retained);assert.equal(committed.status,200,await committed.clone().text());
 const result=await c.startNewSave(checked.correlationId);assert.equal(result.confirmed,true);assert.equal(posts,1);assert.equal(c.hasUnconfirmedWrite,false);
 assert.equal(c.events.filter(e=>e.type==='ProjectCreated'&&e.payload.name==='Late project').length,1);
});

test('a workspace change during an explicit unlock retains the original recovery marker',async t=>{
 const f=await createSceneCostFixture(1),original=globalThis.fetch,scope=`${f.owner}:personal`;
 let changed=false;
 globalThis.fetch=async(url,init)=>{
  if(url==='/api/events'&&init?.method==='POST')throw Error('unknown save');
  const response=await f.request(String(url),init);
  if(changed&&String(url).startsWith('/api/session')){const session=await response.json();session.user.userId='different-user';return Response.json(session);}
  return response;
 };
 t.after(async()=>{globalThis.fetch=original;operationJournal.clearWrite(scope);await f.drainBackground();f.close();});
 const c=new StillClient();await c.load();await assert.rejects(c.createProject('Original scope'),/unknown save/);
 const checked=await c.checkPendingSave();changed=true;
 await assert.rejects(c.startNewSave(checked.correlationId),/workspace changed/);
 assert.equal(operationJournal.write(scope).correlationId,checked.correlationId);
});

test('checking a confirmed creation retires its IDs before a later explicit creation',async t=>{
 const f=await createSceneCostFixture(1),original=globalThis.fetch,scope=`${f.owner}:personal`;
 let loseReceipt=true,posts=0;
 globalThis.fetch=async(url,init)=>{
  const response=await f.request(String(url),init);
  if(url==='/api/events'&&init?.method==='POST'){posts++;if(loseReceipt){loseReceipt=false;throw Error('lost receipt');}}
  return response;
 };
 t.after(async()=>{globalThis.fetch=original;operationJournal.clearWrite(scope);await f.drainBackground();f.close();});
 const c=new StillClient();await c.load();await assert.rejects(c.createProject('Same name'),/lost receipt/);
 assert.equal((await c.checkPendingSave()).confirmed,true);assert.equal(posts,1);
 const first=c.events.find(e=>e.type==='ProjectCreated'&&e.payload.name==='Same name').payload.project_id;
 const next=await c.createProject('Same name');assert.notEqual(next.projectId,first);assert.equal(posts,2);
});

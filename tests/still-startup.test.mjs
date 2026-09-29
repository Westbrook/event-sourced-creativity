import test from 'node:test';
import assert from 'node:assert/strict';
import { api, StillClient } from '../src/still/client.ts';
import { createSceneCostFixture } from './helpers/scene-cost-fixture.mjs';

test('startup skips thousands of telemetry records without losing creative context or retained bodies', async () => {
  const f = await createSceneCostFixture(1, 'visual'), saved = globalThis.fetch, reads = [];
  try {
    const head=f.sqlite.prepare('SELECT MAX(sequence) AS head FROM events WHERE stream_id=?').get(f.streamId).head;
    const insert=f.sqlite.prepare("INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,schema_version,type,payload) VALUES(?,?,?,'2026-09-17','2026-09-17','user','test','startup',1,'ApplicationViewVisited','{}')");
    f.sqlite.exec('BEGIN');
    for(let i=1;i<=7000;i++)insert.run('startup-telemetry-'+i,f.streamId,head+i);
    f.sqlite.exec('COMMIT');
    globalThis.fetch=async(url,init)=>{ assert.ok(String(url).startsWith('/'),'No provider calls');reads.push(String(url));return f.request(url,init); };
    const c=new StillClient();await c.load();
    assert.equal(c.head,head+7000);
    assert.ok(!c.events.some(e=>e.type==='ApplicationViewVisited'));
    assert.ok(c.projection.libraryBlocks.some(b=>b.id==='scene-reuse-direction'));
    assert.equal(c.content[f.contentRef],f.content);
    assert.equal(reads.filter(url=>url.includes('profile=workspace')).length,1);
    assert.equal(reads.filter(url=>url.includes('content=1')).length,1);
    assert.equal(reads.length,3,'One session, one compact history, one retained-content read');
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='ApplicationViewVisited'").get().n,7000,'History is retained for server-side Jev decisions');
  } finally {globalThis.fetch=saved;await f.drainBackground();f.close();}
});

test('a stalled read times out, aborts, and can be retried without accepting a late response', async t => {
  const saved=globalThis.fetch; t.mock.timers.enable({apis:['setTimeout']});
  let signal,release;
  globalThis.fetch=async(_,init)=>{signal=init.signal;return new Promise(resolve=>{release=resolve;});};
  try {
    const first=api('/api/session');const rejected=assert.rejects(first,/server took too long/);
    t.mock.timers.tick(30_000);await rejected;assert.equal(signal.aborted,true);
    release(Response.json({old:true}));
    globalThis.fetch=async()=>Response.json({current:true});
    assert.deepEqual(await api('/api/session'),{current:true});
  } finally {globalThis.fetch=saved;t.mock.timers.reset();}
});

test('a stalled response body is also bounded; mutation requests keep their recovery contract', async t => {
  const saved=globalThis.fetch;t.mock.timers.enable({apis:['setTimeout']});let signal;
  try {
    globalThis.fetch=async(_,init)=>{signal=init.signal;return {ok:true,json:()=>new Promise(()=>{})};};
    const read=api('/api/events');const rejected=assert.rejects(read,/server took too long/);
    t.mock.timers.tick(30_000);await rejected;assert.equal(signal.aborted,true);
    let release;
    globalThis.fetch=async(_,init)=>{assert.equal(init.signal,undefined);return new Promise(resolve=>{release=resolve;});};
    const write=api('/api/events',{action:'append'});t.mock.timers.tick(60_000);
    release(Response.json({saved:true}));assert.deepEqual(await write,{saved:true});
  } finally {globalThis.fetch=saved;t.mock.timers.reset();}
});

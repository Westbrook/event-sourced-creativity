import assert from 'node:assert/strict';
import test from 'node:test';
import {videoRetainedFixture as fixture} from './output-video-retained-fixture.mjs';
const originalFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('network forbidden');};test.after(()=>{globalThis.fetch=originalFetch;});
test('retained native Video joins terminal original job, private MP4 and expired spend grant with SELECT-only access',async()=>{
 const f=await fixture();try{const before=f.sqlite.prepare('SELECT total_changes() n').get().n,result=await f.read();
  assert(f.sqlite.prepare('WITH video_witness AS (SELECT ? AS bindings) SELECT 1 WHERE '+result.witness.sql).get(result.witness.json));
  assert.equal(f.sqlite.prepare('SELECT total_changes() n').get().n,before);assert.equal(f.sqlite.prepare('SELECT status FROM output_execution_grants').get().status,'completed');
  assert.equal(result.expiresAt,f.job.expires_at);
 }finally{f.sqlite.close();}
});
test('retained Video refuses edited, unpublished, foreign, erased and expired original evidence',async()=>{
 for(const mutate of [
  f=>f.sqlite.exec("UPDATE output_operation_slots SET attempt_ordinal=1"),
  f=>f.sqlite.exec("UPDATE output_operation_slots SET previous_slot_id='other'"),
  f=>f.sqlite.exec("UPDATE output_operation_slots SET outcome_event_id='other'"),
  f=>f.sqlite.exec("UPDATE output_execution_grants SET status='revoked'"),
  f=>f.sqlite.exec("UPDATE document_jobs SET expires_at='2000-01-01T00:00:00.000Z'"),
  f=>f.sqlite.exec("UPDATE output_native_storage_writes SET publication_event_id=NULL"),
  f=>f.sqlite.exec("UPDATE private_content SET redacted_at='now' WHERE content_id='input'"),
  f=>f.sqlite.exec("INSERT INTO project_resource_scopes VALUES('document','doc')"),
  f=>{f.input.rawContent=JSON.stringify({...f.artifact,title:'edited'});},
  f=>{f.payload.media_url='/api/media/foreign';f.input.completionRaw=JSON.stringify(f.payload);},
  f=>{f.media.clear();}
 ]){const f=await fixture();try{mutate(f);await assert.rejects(f.read(),undefined,String(mutate));}finally{f.sqlite.close();}}
});
test('final packed witness detects original evidence changes after private Video reads',async()=>{
 const f=await fixture();try{const result=await f.read();f.sqlite.exec("UPDATE private_content SET redacted_at='now' WHERE content_id='input'");assert.equal(f.sqlite.prepare('WITH video_witness AS (SELECT ? AS bindings) SELECT 1 WHERE '+result.witness.sql).get(result.witness.json),undefined);}finally{f.sqlite.close();}
});

test('actual final-return guard rejects a held Video witness after its earlier private expiry or abort',async()=>{
 const {readFileSync}=await import('node:fs');
 const text=readFileSync(new URL('../worker/retained-story-api.ts',import.meta.url),'utf8');
 const start=text.indexOf('    if (final?.admitted !== 1',text.indexOf('export async function handleNativeRetainedOutputRead'));
 const end=text.indexOf('\n  } catch (failure)',start);assert(start>0&&end>start);
 // Execute the actual post-SELECT return block. Initial custody and witness SQL
 // below are real; this focused test is not a complete HTTP-handler exercise.
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const finish=new AsyncFunction('held','Date','source','job','storyboardRead','model3dRead','videoRead','videoEdit','model3dEdit','completionInput','request','serialized','headers','unavailable','const final=await held;\n'+text.slice(start,end));
 for(const mode of ['current','private-expiry','abort']){
  const f=await fixture();try{
   const now=Date.now(),earlier=new Date(now+1000).toISOString();
   f.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE kind='provider-response'").run(earlier);
   const read=await f.read();assert.equal(read.expiresAt,earlier);
   const row=f.sqlite.prepare('WITH video_witness AS (SELECT ? AS bindings) SELECT 1 AS admitted WHERE '+read.witness.sql).get(read.witness.json);assert.equal(row.admitted,1);
   let release,time=now;const held=new Promise(resolve=>{release=()=>resolve(row);}),controller=new AbortController();
   class Clock extends Date{static now(){return time;}}
   const pending=finish(held,Clock,{expires_at:f.job.expires_at},{expiresAt:f.job.expires_at},null,null,read,null,null,null,{signal:controller.signal},'{"output":"video"}',{},()=>Error('retained unavailable'));
   if(mode==='private-expiry')time=now+1001;if(mode==='abort')controller.abort();release();
   if(mode==='current')assert.equal((await pending).status,200);else await assert.rejects(pending,/retained unavailable/);
  }finally{f.sqlite.close();}
 }
});

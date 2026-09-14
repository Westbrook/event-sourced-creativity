import assert from 'node:assert/strict';
import test from 'node:test';
import {appendEvents,StaleSequenceError} from '../worker/event-append.ts';
import {makeEvent} from '../worker/event-write-primitives.ts';

const event=()=>makeEvent('creative:ack',1,'user:ack','fixture','ack','DocumentOpened',{document_id:'doc',project_id:'project'});
function harness(rewrite) {
  let writes=0,commits=0;
  const prepare=()=>({bind(){return this;},async first(){return{head:1};}});
  const env={DB:{prepare,async batch(statements){writes++;return rewrite(statements.map(()=>({success:true,meta:{changes:1},results:[]})));}}};
  return {env,options:{initialHead:0,retries:4,prepareSidecars:()=>[prepare()],onSidecarsCommitted:()=>commits++},counts:()=>({writes,commits})};
}
for(const [name,rewrite] of Object.entries({
  absent:()=>undefined,empty:()=>[],truncated:r=>r.slice(0,1),extra:r=>[...r,r[0]],
  sparse:r=>{delete r[0];return r;},failedEvent:r=>{r[0].success=false;return r;},failedSidecar:r=>{r[1].success=false;return r;},
  missingSuccess:r=>{delete r[1].success;return r;},missingChanges:r=>{delete r[0].meta.changes;return r;},
  missingMeta:r=>{delete r[0].meta;return r;},stringChanges:r=>{r[0].meta.changes='1';return r;},negative:r=>{r[0].meta.changes=-1;return r;},nan:r=>{r[0].meta.changes=NaN;return r;},
})) test(`actual event append rejects ${name} receipt without successor callback or retry`,async()=>{
  const h=harness(rewrite);await assert.rejects(appendEvents(h.env,[event()],h.options),/event_append_acknowledgment_invalid/);
  assert.deepEqual(h.counts(),{writes:1,commits:0});
});
test('complete successful receipt preserves exact sidecar result and advances once',async()=>{
  let expected,actual;const h=harness(r=>{expected=r[1];return r;}),events=[event()];
  const options={...h.options,onSidecarsCommitted:results=>{actual=results;h.options.onSidecarsCommitted(results);}};
  assert.equal(await appendEvents(h.env,events,options),events);assert.deepEqual(h.counts(),{writes:1,commits:1});
  assert.equal(actual.length,1);assert.equal(actual[0],expected);
});
test('acknowledged zero-row head race cannot advance successor',async()=>{
  const h=harness(r=>{r[0].meta.changes=0;return r;});
  await assert.rejects(appendEvents(h.env,[event()],{...h.options,expectedHead:0}),StaleSequenceError);
  assert.deepEqual(h.counts(),{writes:1,commits:0});
});

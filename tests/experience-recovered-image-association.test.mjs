import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { recoveredFalImageEventIds } from '../worker/output-fal-recovery-policy.ts';

// Isolated metadata compatibility only; not provider, custody, or live evidence.
const checkpoint={version:'output-fal-checkpoint-v1',clientRequestId:'original-client',requestDigest:'a'.repeat(64),stage:'image:initial',provider:'fal',model:'ideogram/v4',requestRef:'private-request',requestSha256:'b'.repeat(64),planningRef:'private-plan',planningSha256:'c'.repeat(64),expiresAt:'2026-09-15T00:00:00.000Z'};
const row={kind:'generate',status:'completed',source_surface:'outputs',output_slot_id:'original-slot'};
function result(){return {appendedEventIds:['prior-failure'],outputFalCheckpoint:checkpoint,outputFalRecovery:{version:'output-fal-recovery-v1',status:'completed',clientRequestId:'original-client',completionEventId:'original-completion'},generationReceipt:{provider_request_status:'completed'}};}
test('legacy completed recovery projects its exact marker without mutating history',()=>{
  const value=result(),before=JSON.stringify(value);
  assert.deepEqual(recoveredFalImageEventIds(row,value),['prior-failure','original-completion']);
  assert.equal(JSON.stringify(value),before);
  assert.deepEqual(recoveredFalImageEventIds(row,{...value,appendedEventIds:undefined}),['original-completion']);
  value.appendedEventIds.push('original-completion');
  assert.deepEqual(recoveredFalImageEventIds(row,value),value.appendedEventIds);
});
test('compatibility refuses unrelated jobs, incomplete markers and malformed association evidence',()=>{
  for(const changed of [{...row,kind:'render_document'},{...row,status:'failed'},{...row,source_surface:'document'},{...row,output_slot_id:null}])
    assert.equal(recoveredFalImageEventIds(changed,result()),null);
  for(const patch of [{version:'unknown'},{status:'running'},{clientRequestId:'other-client'},{completionEventId:'bad/id'},{completionEventId:null}]){
    const value=result();Object.assign(value.outputFalRecovery,patch);assert.equal(recoveredFalImageEventIds(row,value),null);
  }
  for(const patch of [{appendedEventIds:null},{appendedEventIds:['bad/id']},{appendedEventIds:[4]},{outputFalCheckpoint:null},{generationReceipt:{provider_request_status:'submitted'}}])
    assert.equal(recoveredFalImageEventIds(row,{...result(),...patch}),null);
});
test('production recovery publication SQL preserves prior event IDs and binds both newly appended events',async()=>{
  const source=await readFile(new URL('../worker/output-fal-recovery.ts',import.meta.url),'utf8');
  const start=source.indexOf("UPDATE document_jobs SET status='completed',error_message=NULL,completed_at=?"),end=source.indexOf('`)',start);
  assert.ok(start>=0&&end>start);const sql=source.slice(start,end);
  assert.match(source.slice(end,end+600),/complete\.eventId,usageEvent\.eventId,new Date/u);
  const db=new DatabaseSync(':memory:');
  try{
    db.exec('CREATE TABLE document_jobs(job_id TEXT,owner_id TEXT,status TEXT,error_message TEXT,completed_at TEXT,lease_expires_at TEXT,result_json TEXT,updated_at TEXT)');
    db.prepare('INSERT INTO document_jobs VALUES(?,?,?,?,?,?,?,?)').run('job','owner','failed','original failure',null,null,JSON.stringify(result()),'old');
    const patch={stage:'completed',errorDetail:null,outputFalRecovery:result().outputFalRecovery,generationReceipt:result().generationReceipt};
    assert.equal(db.prepare(sql).run('now',JSON.stringify(patch),'original-completion','original-usage','now','job','owner').changes,1);
    const saved=db.prepare('SELECT * FROM document_jobs').get(),body=JSON.parse(saved.result_json);
    assert.equal(saved.status,'completed');assert.equal(saved.error_message,null);
    assert.deepEqual(body.appendedEventIds,['prior-failure','original-completion','original-usage']);
    assert.deepEqual(body.outputFalCheckpoint,checkpoint);
  }finally{db.close();}
});
test('serialization integrates projection while native candidate keeps exact appended-event guard',async()=>{
  const source=await readFile(new URL('../worker/document-jobs-api.ts',import.meta.url),'utf8');
  assert.match(source,/const recoveredEventIds=recoveredFalImageEventIds\(row,parsed\);\s*if\(sanitizedResult&&recoveredEventIds\)sanitizedResult.appendedEventIds=recoveredEventIds;/u);
  const consumer=await readFile(new URL('../src/experiences/native-result-association.ts',import.meta.url),'utf8');
  assert.ok(consumer.includes('!appended.includes(event.eventId)'));
  assert.ok(consumer.includes('completions.length !== 1'));
});

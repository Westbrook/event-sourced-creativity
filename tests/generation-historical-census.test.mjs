import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {makeEvent,eventWriteBindings,EVENT_WRITE_COLUMNS} from '../worker/event-write-primitives.ts';
import {historicalCensusQuery,summarizeHistoricalCensus,HISTORICAL_CENSUS_LIMIT,HISTORICAL_CENSUS_CHUNK} from '../worker/generation-historical-census.ts';
const event=makeEvent('creative:owner',1,'user:owner','fixture','fixture','ProjectCreated',{project_id:'project',name:'Private sentinel'});
const stage=Object.fromEntries(EVENT_WRITE_COLUMNS.split(',').map((k,i)=>[k,eventWriteBindings(event)[i]]));
const row=()=>({...stage,private_event_id:event.eventId,redacted_at:null});
function metadata(t,change){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec('CREATE TABLE events(event_id TEXT,stream_id TEXT,sequence INTEGER);CREATE TABLE event_private_payloads(private_event_id TEXT,owner_id TEXT,private_json TEXT,redacted_at TEXT);CREATE TABLE project_event_scopes(event_id TEXT);');
 db.prepare('INSERT INTO events VALUES(?,?,?)').run(event.eventId,event.streamId,event.sequence);
 db.prepare('INSERT INTO event_private_payloads VALUES(?,?,?,NULL)').run(event.eventId,'owner',stage.private_json);
 change?.(db);const q=historicalCensusQuery([row()],'owner','creative:owner',2);
 const r=db.prepare(q.sql).get(...q.bindings);return JSON.parse(r.states)[0];
}
for(const [expected,change] of [
 ['custody_ok',()=>{}],
 ['private_absent',db=>db.exec('DELETE FROM event_private_payloads')],
 ['private_redacted',db=>db.exec("UPDATE event_private_payloads SET redacted_at='retired',owner_id='foreign',private_json='{'")],
 ['private_owner_missing',db=>db.exec("UPDATE event_private_payloads SET owner_id='',private_json='{'")],
 ['private_owner_invalid',db=>db.exec("UPDATE event_private_payloads SET owner_id='bad owner',private_json='{'")],
 ['private_owner_mismatch',db=>db.exec("UPDATE event_private_payloads SET owner_id='foreign',private_json='{'")],
 ['nonpersonal_event',db=>db.prepare('INSERT INTO project_event_scopes VALUES(?)').run(event.eventId)],
 ['private_json_unavailable',db=>db.exec('UPDATE event_private_payloads SET private_json=NULL')],
 ['private_json_malformed',db=>db.exec("UPDATE event_private_payloads SET private_json='{'")],
 ['event_boundary_mismatch',db=>db.exec('UPDATE events SET sequence=2')],
])test('real-writer scalar census first failure '+expected,t=>{
 const state=metadata(t,change);assert.equal(state,expected);
 const report=summarizeHistoricalCensus([row()],[event],[state],'owner',2);
 assert.equal(report.complete,true);assert.equal(report.examined,1);
 if(expected==='custody_ok')assert.equal(report.identityChecksPassed,1);
 else assert.deepEqual(report.firstFailureCounts,{[expected]:1});
 assert.ok(!JSON.stringify(report).includes('Private sentinel'));assert.ok(!JSON.stringify(report).includes(event.eventId));
});
for(const [expected,change] of [
 ['event_type_unsupported',r=>r.type='ProjectUnknown'],
 ['loaded_custody_mismatch',r=>r.private_event_id='other'],
 ['envelope_not_objects',r=>r.private_json='[]'],
 ['loaded_envelope_malformed',r=>r.payload='{'],
 ['public_private_ref_mismatch',r=>r.payload='{}'],
 ['operational_identity_inconsistent',r=>r.private_json=JSON.stringify({project_id:'different'})],
 ['creation_identity_missing',r=>{r.type='DocumentCreated';}],
 ['history_binding_mismatch',r=>{r.sequence=0;}],
])test('census body classification '+expected,()=>{
 const r=row();change(r);const report=summarizeHistoricalCensus([r],[event],['custody_ok'],'owner',2);
 assert.deepEqual(report.firstFailureCounts,{[expected]:1});
 assert.equal(report.identityChecksPassed,0);
});
test('custody refusal never touches private body and later checks are not evaluated',()=>{
 const r=row();Object.defineProperty(r,'private_json',{get:()=>assert.fail('private body inspected after custody failure')});
 const c=summarizeHistoricalCensus([r],[event],['private_redacted'],'owner',2);
 assert.deepEqual(c.checks.private_owner_valid,{evaluated:0,failed:0,notEvaluated:1});
 assert.deepEqual(c.checks.envelope_objects,{evaluated:0,failed:0,notEvaluated:1});
});
test('summary bounds, suffix exclusion, empty census and incomplete observations',()=>{
 const rows=Array.from({length:HISTORICAL_CENSUS_LIMIT+1},(_,i)=>({...row(),sequence:i+1}));
 rows.push({...row(),sequence:HISTORICAL_CENSUS_LIMIT+2});
 const c=summarizeHistoricalCensus(rows,[],Array(HISTORICAL_CENSUS_LIMIT).fill('private_absent'),'owner',HISTORICAL_CENSUS_LIMIT+2);
 assert.equal(c.total,HISTORICAL_CENSUS_LIMIT+1);assert.equal(c.examined,HISTORICAL_CENSUS_LIMIT);assert.equal(c.truncated,true);assert.equal(c.complete,false);assert.equal(c.unexamined,1);
 assert.deepEqual(c.checks.private_presence,{evaluated:HISTORICAL_CENSUS_LIMIT,failed:HISTORICAL_CENSUS_LIMIT,notEvaluated:1});assert.equal(c.checks.envelope_objects.notEvaluated,c.total);
 assert.throws(()=>summarizeHistoricalCensus([row()],[],[],'owner',2),/observation_incomplete/);
 assert.throws(()=>summarizeHistoricalCensus([row()],[],['unknown'],'owner',2),/observation_invalid/);
 assert.equal(summarizeHistoricalCensus([],[],[],'owner',2).complete,true);
 assert.throws(()=>historicalCensusQuery(Array(HISTORICAL_CENSUS_CHUNK+1).fill(row()),'owner','creative:owner',2),/selector_invalid/);
 assert.throws(()=>historicalCensusQuery([{...row(),stream_id:'creative:foreign'}],'owner','creative:owner',2),/selector_invalid/);
});

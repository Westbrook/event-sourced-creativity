import assert from 'node:assert/strict';
import test from 'node:test';
import {createSceneCostFixture} from './helpers/scene-cost-fixture.mjs';
import {prepareSceneCostConsent} from '../worker/scene-cost-consent.ts';
import {captureSceneSourceVersion,sceneSourceVersionAssertions} from '../worker/scene-source-generation.ts';
import {requireUser} from '../worker/pilot-policy.ts';
import {outputScopeAuthority} from '../worker/output-command-core.ts';
import {readLocalMigrations} from '../scripts/lib/local-migrations.mjs';
import {makeEvent,eventWriteBindings,EVENT_WRITE_COLUMNS} from '../worker/event-write-primitives.ts';
const principal=async f=>{const auth=await requireUser(new Request('http://localhost/api/session'),f.env,'creator');assert.ok(auth.user);return auth.user;};
async function original(f){
  // Actual fixture schema predates deployment migrations; reconcile only the
  // generation tables/triggers into this disposable database.
  const migrations=readLocalMigrations(new URL('../drizzle/',import.meta.url)).filter(x=>x.tag==='0038_scene_source_generations');
  assert.equal(migrations.length,1);for(const sql of migrations[0].sql.split('--> statement-breakpoint'))if(sql.trim())f.sqlite.exec(sql);
  const version=await captureSceneSourceVersion(f.env,{streamId:f.streamId});
  const scope={kind:'personal',key:'personal:'+f.owner+':'+f.projectId,ownerUserId:f.owner,actorUserId:f.owner,projectId:f.projectId,documentId:f.documentId,organizationId:null,projectAccessId:null,contextId:null};
  return{version,projectId:f.projectId,assertions:[outputScopeAuthority(scope,'read')]};
}
test('actual Scene cost preparation preserves full workflow reuse and preview through versioned reduction',async()=>{
  const f=await createSceneCostFixture();try{
    const user=await principal(f),versionedSource=await original(f),before=f.counts();
    const legacy=await prepareSceneCostConsent(f.env,user,f.documentId,f.payload,null);
    const next=await prepareSceneCostConsent(f.env,user,f.documentId,f.payload,null,{versionedSource});
    assert.deepEqual(next.preview,legacy.preview);assert.deepEqual(next.binding,legacy.binding);
    assert.deepEqual(next.authoredSnapshot,legacy.authoredSnapshot);assert.deepEqual(next.effectiveSnapshot,legacy.effectiveSnapshot);assert.deepEqual(next.production,legacy.production);
    assert.deepEqual(next.sourceVersion,versionedSource.version);assert.ok(Object.isFrozen(next.sourceVersion));assert.deepEqual(f.counts(),before);
    for(const a of sceneSourceVersionAssertions(next.sourceVersion))assert.equal(f.sqlite.prepare(`SELECT (${a.sql}) AS current`).get(...a.bindings).current,1);
  }finally{f.close();}
});
test('actual versioned Scene preparation rejects changes during workflow content resolution',async()=>{
  const f=await createSceneCostFixture();try{
    const user=await principal(f),versionedSource=await original(f);let changed=false;
    f.controls.afterRead=async(statement)=>{if(!changed&&statement.sql.includes("kind='document-artifact'")&&statement.sql.includes('SELECT')){
      changed=true;f.sqlite.prepare("UPDATE event_private_payloads SET private_json=private_json WHERE private_event_id=(SELECT event_id FROM events WHERE stream_id=? LIMIT 1)").run(f.streamId);
    }};
    await assert.rejects(prepareSceneCostConsent(f.env,user,f.documentId,f.payload,null,{versionedSource}),e=>e.code==='output_source_changed_during_read');assert.equal(changed,true);
    assert.equal(f.counts().document_jobs,0);
  }finally{f.close();}
});
test('actual Scene cost preparation checks the original earlier deadline after final response transit',async()=>{
  const f=await createSceneCostFixture(),now=Date.now;try{
    const user=await principal(f),versionedSource=await original(f),deadline=now()+60000;let delayed=false;
    versionedSource.assertions.push({sql:"? > strftime('%Y-%m-%dT%H:%M:%fZ','now')",bindings:[new Date(deadline).toISOString()],deadlineMs:deadline});
    f.controls.afterBatch=async statements=>{if(statements.length>2&&statements.every(s=>s.sql.startsWith('SELECT CASE WHEN'))){delayed=true;Date.now=()=>deadline+1;}};
    await assert.rejects(prepareSceneCostConsent(f.env,user,f.documentId,f.payload,null,{versionedSource}),e=>e.code==='scene_cost_authority_changed');
    assert.equal(delayed,true);assert.equal(f.counts().document_jobs,0);
  }finally{Date.now=now;f.close();}
});
test('actual Scene preparation reads over16MiB of history and reuses the same retained story without a job',async()=>{
  const f=await createSceneCostFixture();try{
    const user=await principal(f),baseline=await prepareSceneCostConsent(f.env,user,f.documentId,f.payload,null);
    const statement=f.sqlite.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) VALUES(${Array(17).fill('?').join(',')})`);
    const head=f.sqlite.prepare('SELECT MAX(sequence) AS n FROM events WHERE stream_id=?').get(f.streamId).n;
    f.sqlite.exec('BEGIN');try{for(let index=1;index<=5000;index++)statement.run(...eventWriteBindings(makeEvent(f.streamId,head+index,'user:'+f.owner,'fixture','large-history','DocumentOpened',{
      document_id:f.documentId,project_id:f.projectId,fixture_padding:'x'.repeat(3500)})));f.sqlite.exec('COMMIT');}catch(e){f.sqlite.exec('ROLLBACK');throw e;}
    const versionedSource=await original(f),next=await prepareSceneCostConsent(f.env,user,f.documentId,f.payload,null,{versionedSource});
    assert.deepEqual(next.preview,baseline.preview);assert.deepEqual(next.effectiveSnapshot,baseline.effectiveSnapshot);
    assert.equal(next.preview.reusedSourceCount,1);assert.equal(f.counts().document_jobs,0);
    await assert.rejects(prepareSceneCostConsent(f.env,user,f.documentId,f.payload,null),e=>e.code==='output_source_proof_too_large');
  }finally{f.close();}
});

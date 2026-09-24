import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {createSceneCostFixture} from './helpers/scene-cost-fixture.mjs';
import {creationSchemaManifest, authoredSnapshot, schemaSnapshot, sha256, rehearseCandidateStatements} from '../scripts/still-qualification-schema.mjs';
import {releaseMigrationPolicy} from '../build/release-migrations.ts';
import {CREATION_SEARCH_SCHEMA} from '../worker/creation-search-index.ts';
import {CREATION_INDEX_SCHEMA} from '../worker/creation-index-schema.ts';

const manifest = await creationSchemaManifest();
const artifact = {kind:'local-synthetic-SQLite-rehearsal', startedAt:new Date().toISOString(), nodeVersion:process.version, hosted:false, productionSchemaEquivalent:false, manifestSha256:manifest.manifestSha256, command:'STILL_SCHEMA_REHEARSAL_OUTPUT=<receipt.json> node --import tsx --test tests/creation-hosted-schema.test.mjs', cases:[]};
test.after(() => {artifact.endedAt=new Date().toISOString(); if (process.env.STILL_SCHEMA_REHEARSAL_OUTPUT) writeFileSync(process.env.STILL_SCHEMA_REHEARSAL_OUTPUT, JSON.stringify(artifact, null, 2)+'\n');});

test('generated search and semantic candidates equal their current runtime schemas', () => {
  for(const [path,schema] of [['0075_still_creation_search.sql',CREATION_SEARCH_SCHEMA],['still_semantic_index.sql',CREATION_INDEX_SCHEMA]]){
    const sql=readFileSync(new URL('../drizzle/candidates/'+path,import.meta.url),'utf8');
    assert.equal(sha256(sql.replace(/^--[^\n]*\n/gm,'').trim()),sha256(schema.map(s=>s+';').join('\n').trim()),path);
  }
});

test('hashed additive manifest repeats exactly and preserves authored rows, constraints and ordinary routes', async t => {
  const f = await createSceneCostFixture(3, 'visual', {shared:true}); t.after(() => f.close());
  const before = authoredSnapshot(f.sqlite), baseline = schemaSnapshot(f.sqlite);
  const first = rehearseCandidateStatements(f.sqlite, manifest), installed = schemaSnapshot(f.sqlite);
  const second = rehearseCandidateStatements(f.sqlite, manifest);
  assert.equal(first.schemaSha256, second.schemaSha256);
  assert.deepEqual(authoredSnapshot(f.sqlite), before);
  assert.deepEqual(schemaSnapshot(f.sqlite), installed);
  assert.throws(() => f.sqlite.exec("INSERT INTO creation_index_enrollments VALUES('synthetic',1,'p',9999999999,0)"), /CHECK/);
  assert.throws(() => f.sqlite.exec('INSERT INTO creation_index_fences VALUES(NULL)'), /NOT NULL/);
  assert.throws(() => f.sqlite.exec("INSERT INTO creation_drafts VALUES('d','a','s','{}',0,'active',NULL,'z',NULL,NULL,'z','z',1)"), /CHECK/);
  assert.equal((await f.request('/api/session?profile=still')).status, 200);
  assert.equal((await f.request('/api/events?after=0&limit=20&content=0')).status, 200);
  assert.equal((await f.request('/api/still/creation/drafts')).status, 404);
  assert.deepEqual(authoredSnapshot(f.sqlite), before);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM creation_index_enrollments').get().n, 0);
  for(const table of ['creation_qualification_runs','creation_qualification_limits','creation_qualification_attempts']) assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);
  assert.ok(installed.some(row => row.name === 'creation_index_partition_changed'));
  f.sqlite.exec("INSERT INTO creation_search_partitions(partition_key,custody,project_id,owner_id,updated_at) VALUES('qualification-trigger','qualification-custody','qualification-project','qualification-owner','2026-09-24')");
  f.sqlite.exec("INSERT INTO creation_index_enrollments VALUES('qualification-custody',1,'epoch-1',9999999999,1000)");
  assert.equal(f.sqlite.prepare("SELECT index_version FROM creation_search_partitions WHERE partition_key='qualification-trigger'").get().index_version,1);
  assert.ok(f.sqlite.prepare("SELECT 1 FROM creation_index_work WHERE partition_key='qualification-trigger'").get());
  assert.ok(f.sqlite.prepare("SELECT 1 FROM creation_index_discovery WHERE scope_key='*'").get());
  f.sqlite.exec("UPDATE creation_index_enrollments SET enabled=0 WHERE custody='qualification-custody'");
  assert.equal(f.sqlite.prepare("SELECT index_version FROM creation_search_partitions WHERE partition_key='qualification-trigger'").get().index_version,2);
  assert.deepEqual(authoredSnapshot(f.sqlite), before);
  artifact.cases.push({name:'install-and-repeat',...first,baselineSchemaSha256:sha256(JSON.stringify(baseline)),before,after:authoredSnapshot(f.sqlite),schemaObjectsAdded:installed.filter(row=>!baseline.some(old=>old.name===row.name)).map(({type,name})=>({type,name})),constraints:'pass',ordinaryRoutes:'pass'});
});

const statements = manifest.candidates.flatMap(c => c.statements);
const boundaries = [...new Set([1, manifest.candidates[0].statements.length, statements.findIndex(s=>/DROP TRIGGER/.test(s.sql))+1, manifest.candidates.slice(0,2).reduce((n,c)=>n+c.statements.length,0)+4, manifest.candidates.slice(0,3).reduce((n,c)=>n+c.statements.length,0)-1, statements.length-1])];
for (const failAfter of boundaries) test(`failure after ${failAfter} committed statements resumes exact schema and preserves authored data`, async t => {
  const f = await createSceneCostFixture(2, 'visual', {shared:true}); t.after(() => f.close());
  const before = authoredSnapshot(f.sqlite);
  assert.throws(() => rehearseCandidateStatements(f.sqlite, manifest, {failAfter}), error => error.message === 'qualification_simulated_partial_failure' && error.applied === failAfter);
  assert.deepEqual(authoredSnapshot(f.sqlite), before);
  if(failAfter===statements.length-1){
    assert.ok(f.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='creation_qualification_attempts'").get());
    assert.equal(f.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='creation_qualification_consume'").get(),undefined);
  }
  const partialSchemaSha256 = sha256(JSON.stringify(schemaSnapshot(f.sqlite)));
  const recovered = rehearseCandidateStatements(f.sqlite, manifest), stable = schemaSnapshot(f.sqlite);
  assert.deepEqual(authoredSnapshot(f.sqlite), before);
  assert.equal(rehearseCandidateStatements(f.sqlite, manifest).schemaSha256, recovered.schemaSha256);
  assert.deepEqual(schemaSnapshot(f.sqlite), stable);
  assert.equal((await f.request('/api/session?profile=still')).status,200);
  assert.ok(f.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='creation_qualification_consume'").get());
  artifact.cases.push({name:'partial-recovery',failAfter,partialSchemaSha256,...recovered,before,after:authoredSnapshot(f.sqlite)});
});

test('statement tampering fails before writes and held production archive policy remains exactly 41 migrations', async t => {
  const f = await createSceneCostFixture(1); t.after(() => f.close());
  const bad = structuredClone(manifest), before = schemaSnapshot(f.sqlite);
  bad.candidates[0].statements[0].sql += '\n-- altered';
  assert.throws(() => rehearseCandidateStatements(f.sqlite,bad), /hash_mismatch/);
  assert.deepEqual(schemaSnapshot(f.sqlite), before);
  const policy = await releaseMigrationPolicy(new URL('../',import.meta.url).pathname);
  assert.equal(policy.files.length,41);
  assert.ok(policy.files.every(file=>!manifest.candidates.some(c=>c.path.endsWith('/'+file.path))));
  const journal=JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json',import.meta.url)));
  assert.equal(journal.entries.at(-1).tag,'0073_memory_authored_images');
  assert.equal(manifest.deploymentSequenceNumbers,null);
  assert.equal(manifest.authorization,'none');
});

test('every partial-application recovery converges to the clean installation schema', () => {
  assert.equal(artifact.cases.length,boundaries.length+1);
  assert.equal(new Set(artifact.cases.map(result=>result.schemaSha256)).size,1);
});

test('repeat installation upgrades the existing invalidation trigger without extending pending erasure', async t => {
  const f = await createSceneCostFixture(1); t.after(() => f.close());
  rehearseCandidateStatements(f.sqlite,manifest);
  const repaired = f.sqlite.prepare("SELECT sql FROM sqlite_master WHERE name='creation_index_partition_changed'").get().sql;
  const old = repaired.replace('MIN(COALESCE(erase_due,unixepoch()+300),unixepoch()+300)','unixepoch()+900');
  assert.notEqual(old,repaired);
  f.sqlite.exec('DROP TRIGGER creation_index_partition_changed');
  f.sqlite.exec(old);
  rehearseCandidateStatements(f.sqlite,manifest);
  assert.equal(f.sqlite.prepare("SELECT sql FROM sqlite_master WHERE name='creation_index_partition_changed'").get().sql,repaired);
  f.sqlite.exec("INSERT INTO creation_search_partitions(partition_key,custody,project_id,owner_id,updated_at) VALUES('deadline','synthetic','p','u','2026-09-24')");
  f.sqlite.exec("INSERT INTO creation_index_objects(object_key,partition_key,generation,source_id,revision,representation,checksum,byte_count,passages_json,state,lease_token,write_until,expires,erase_due) VALUES('synthetic-object','deadline',0,'s','r','synthetic','checksum',0,'[]','retired','lease',0,unixepoch()+1000,unixepoch()+30)");
  const deadline=f.sqlite.prepare("SELECT erase_due FROM creation_index_objects WHERE object_key='synthetic-object'").get().erase_due;
  for(let i=0;i<3;i++)f.sqlite.exec("UPDATE creation_search_partitions SET index_version=index_version+1 WHERE partition_key='deadline'");
  assert.equal(f.sqlite.prepare("SELECT erase_due FROM creation_index_objects WHERE object_key='synthetic-object'").get().erase_due,deadline);
  f.sqlite.exec("INSERT INTO creation_index_snapshot_heads VALUES('deadline',3,1,1)");
  f.sqlite.exec("INSERT INTO creation_index_objects(object_key,partition_key,generation,source_id,revision,representation,checksum,byte_count,passages_json,state,lease_token,write_until,expires) VALUES('suspended-object','deadline',3,'s2','r','synthetic','checksum',0,'[]','active','lease',0,unixepoch()+1000)");
  f.sqlite.exec("UPDATE creation_search_partitions SET index_version=index_version+1 WHERE partition_key='deadline'");
  const suspended=f.sqlite.prepare("SELECT state,erase_due,unixepoch() now FROM creation_index_objects WHERE object_key='suspended-object'").get();
  assert.equal(suspended.state,'suspended');assert.ok(suspended.erase_due<=suspended.now+300);
  f.sqlite.exec("DELETE FROM creation_index_snapshot_heads WHERE partition_key='deadline'");
  f.sqlite.exec("UPDATE creation_search_partitions SET index_version=index_version+1 WHERE partition_key='deadline'");
  const retired=f.sqlite.prepare("SELECT state,erase_due FROM creation_index_objects WHERE object_key='suspended-object'").get();
  assert.equal(retired.state,'retired');assert.equal(retired.erase_due,suspended.erase_due);
  artifact.triggerUpgrade={existingTriggerReplaced:true,repeatedInvalidationCount:3,originalErasureDeadline:deadline,observedErasureDeadline:deadline,snapshotObjectState:suspended.state,snapshotDeadlineSeconds:300,afterSnapshotPurgeState:retired.state,deadlinePreserved:true};
});

test('repeat installation replaces pre-snapshot authority triggers and revocation purges retained snapshots', async t => {
  const f=await createSceneCostFixture(1);t.after(()=>f.close());
  rehearseCandidateStatements(f.sqlite,manifest);
  const names=['creation_index_enrollment_inserted','creation_index_enrollment_changed','creation_index_enrollment_deleted','creation_index_policy_organization_retention_policies_update','creation_index_owner_changed','creation_index_owner_deleted'];
  const expected=names.map(name=>({name,sql:f.sqlite.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(name).sql}));
  for(const {name,sql} of expected){
    const old=sql.replace(/DELETE FROM creation_index_snapshot(?:s|_heads)[^;]*;\s*/g,'');
    assert.notEqual(old,sql);f.sqlite.exec('DROP TRIGGER '+name);f.sqlite.exec(old);
  }
  rehearseCandidateStatements(f.sqlite,manifest);
  for(const {name,sql} of expected) assert.equal(f.sqlite.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(name).sql,sql,name);
  f.sqlite.exec("INSERT INTO creation_search_partitions(partition_key,custody,project_id,owner_id,updated_at) VALUES('snapshot-revocation','snapshot-custody','p','u','2026-09-24')");
  f.sqlite.exec("INSERT INTO creation_index_enrollments VALUES('snapshot-custody',1,'p',9999999999,1000)");
  f.sqlite.exec("INSERT INTO creation_index_snapshot_heads VALUES('snapshot-revocation',0,1,1)");
  f.sqlite.exec("INSERT INTO creation_index_snapshots VALUES('snapshot-revocation','b','idea','synthetic-pointer')");
  f.sqlite.exec("UPDATE creation_index_enrollments SET enabled=0 WHERE custody='snapshot-custody'");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM creation_index_snapshot_heads WHERE partition_key='snapshot-revocation'").get().n,0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM creation_index_snapshots WHERE partition_key='snapshot-revocation'").get().n,0);
  artifact.authorityTriggerUpgrade={replaced:names,revokedSnapshotHeads:0,revokedSnapshotPointers:0};
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {creationIndexFixture} from './helpers/creation-index-fixture.mjs';
import {appendAuditEvent} from '../worker/runtime.ts';
import {runCreationMaintenance} from '../worker/creation-index-maintenance.ts';

const claims=f=>{const values=[];f.controls.afterRead=(statement,value)=>{if(statement.sql.startsWith('UPDATE creation_index_work SET state=')&&statement.sql.includes('RETURNING *')&&value)values.push(value);};return values;};
const canonicalProject=async(f,id,n)=>{await appendAuditEvent(f.env,f.streamId,'user','ProjectCreated',{project_id:id,name:'Queue '+id});for(let i=0;i<n;i++)await appendAuditEvent(f.env,f.streamId,'user','BlockCreated',{project_id:id,block_id:id+'-source-'+i,scope:'library',type:'text',properties:{text:'Faithfully supplied queue source '+i}});};

test('publication keeps its remaining work quanta after two paid embedding attempts',async t=>{
 const f=await creationIndexFixture(t);await canonicalProject(f,f.projectId,65);
 // Pause at the real durable embedding boundary, after actual canonical projection
 // and materialization. No completed manifests or vectors are seeded.
 f.controls.afterBatch=statements=>{if(statements.some(s=>s.sql.includes("'embedding'")))f.sqlite.exec("UPDATE creation_index_work SET due=unixepoch()+86400 WHERE kind='embedding'");};
 for(let n=0;n<20&&!f.sqlite.prepare("SELECT 1 FROM creation_index_work WHERE kind='embedding'").get();n++)await f.tick();
 assert.ok(f.sqlite.prepare("SELECT 1 FROM creation_index_work WHERE kind='embedding'").get());assert.equal(f.calls.length,0);f.controls.afterBatch=null;
 f.sqlite.exec("UPDATE creation_index_work SET due=unixepoch()+86400 WHERE kind IN('discovery','renewal','compaction'); UPDATE creation_index_work SET due=0,touched=-100 WHERE kind='embedding'");
 // Arrange two older embedding quanta ahead of freshly queued publications. This
 // is a legitimate touched-order state encountered during concurrent backfills.
 f.controls.afterBatch=statements=>{if(statements.some(s=>s.sql.includes("'publication'")))f.sqlite.exec("UPDATE creation_index_work SET touched=unixepoch()+1 WHERE kind='publication'");};
 const log=claims(f),receipt=await runCreationMaintenance(f.env,'test-provider-budget-continuation');
 assert.equal(receipt.providerAttempts,2);assert.equal(f.calls.length,2);const work=log.filter(v=>!['deletion','reconciliation','manifest-reconciliation'].includes(v.kind));assert.equal(work.length,4);assert.deepEqual(work.map(v=>v.kind),['embedding','embedding','publication','publication']);
 assert.ok(f.sqlite.prepare('SELECT COUNT(*) n FROM creation_index_sources WHERE published=1').get().n>0);assert.ok(f.sqlite.prepare("SELECT 1 FROM creation_index_objects WHERE state='active'").get());assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM creation_index_attempts").get().n,2);
});

test('renewal and compaction receive a bounded share while another canonical partition keeps producing foreground work',async t=>{
 const f=await creationIndexFixture(t);await canonicalProject(f,f.projectId,4);const busy='busy-foreground';await canonicalProject(f,busy,4);await f.ready();
 const stable=f.sqlite.prepare('SELECT partition_key,index_version FROM creation_search_partitions WHERE project_id=?').get(f.projectId);
 const maintenanceKey='renewal:'+stable.partition_key;let stableRenewals=0;
 for(let n=0;n<4;n++){
  await appendAuditEvent(f.env,f.streamId,'user','BlockCreated',{project_id:busy,block_id:'new-foreground-'+n,scope:'library',type:'text',properties:{text:'Fresh supplied input '+n}});
  // Advance the recurring maintenance eligibility without sleeping. Keep its
  // touched value newer than foreground work to reproduce the old starvation.
  f.sqlite.prepare("UPDATE creation_index_work SET state='ready',due=0,touched=unixepoch() WHERE job_key=?").run(maintenanceKey);
  f.sqlite.exec("UPDATE creation_index_work SET touched=0 WHERE kind IN('discovery','projection','materialize','embedding','publication') AND state='ready'");
  const log=claims(f),receipt=await f.tick(),work=log.filter(v=>!['deletion','reconciliation','manifest-reconciliation'].includes(v.kind));
  stableRenewals+=work.filter(v=>v.job_key===maintenanceKey).length;assert.ok(work.length<=4);assert.ok(['renewal','compaction'].includes(work[0]?.kind),'one maintenance quantum runs before new foreground work');assert.ok(work.some(v=>['discovery','projection','materialize','embedding','publication'].includes(v.kind)),'foreground still advances');assert.ok(receipt.providerAttempts<=2);
 }
 assert.ok(stableRenewals>0,'a real stable-partition renewal runs under sustained foreground arrivals');
 assert.equal(f.sqlite.prepare('SELECT index_version FROM creation_search_partitions WHERE partition_key=?').get(stable.partition_key).index_version,stable.index_version,'healthy renewal does not rebuild unchanged unexpired sources');
});

test('aged renewal survives continuous new compaction arrivals and maintenance turns continue afterward',async t=>{
 const f=await creationIndexFixture(t);await canonicalProject(f,f.projectId,4);await f.ready();const stable=f.sqlite.prepare('SELECT partition_key,index_version FROM creation_search_partitions WHERE project_id=?').get(f.projectId),renewal='renewal:'+stable.partition_key;
 f.sqlite.prepare("UPDATE creation_index_work SET state='ready',due=unixepoch()-601,created=unixepoch()-1200,touched=unixepoch()-900 WHERE job_key=?").run(renewal);
 const seen=[];
 for(let n=0;n<4;n++){
  // New ready jobs have touched=0, but are not 1970-aged. This queue injection
  // represents new partitions finishing backfill; compaction runs on real shards.
  const key='compaction-arrival-'+n;f.sqlite.prepare("INSERT INTO creation_index_work(job_key,kind,partition_key,generation,priority) VALUES(?,'compaction',?,?,7)").run(key,stable.partition_key,stable.index_version);
  const log=claims(f);await f.tick();seen.push(...log.filter(v=>['renewal','compaction'].includes(v.kind)).map(v=>v.job_key));
  if(n===0)assert.equal(seen[0],renewal,'renewal aged over ten minutes outranks fresh touched=0 arrivals');
 }
 assert.ok(seen.includes('compaction-arrival-0'));assert.ok(seen.includes('compaction-arrival-3'),'background compaction keeps progressing after aged renewal');assert.equal(f.sqlite.prepare('SELECT state FROM creation_index_work WHERE job_key=?').get(renewal).state,'ready');assert.ok(f.sqlite.prepare('SELECT due-unixepoch() delay FROM creation_index_work WHERE job_key=?').get(renewal).delay>500);
});

test('aging respects actual ready time and renews round-robin position on each lease claim',async t=>{
 const {claimIndexJob}=await import('../worker/creation-index-schema.ts'),f=await creationIndexFixture(t);f.sqlite.exec('DELETE FROM creation_index_work');
 const add=(key,kind,created,touched,due)=>f.sqlite.prepare('INSERT INTO creation_index_work(job_key,kind,partition_key,created,touched,due) VALUES(?,?,\'\',unixepoch()+?,unixepoch()+?,unixepoch()+?)').run(key,kind,created,touched,due);
 add('old-renewal','renewal',-2000,-1500,-1000);add('old-compaction','compaction',-3000,-2500,-800);add('fresh-compaction','compaction',0,-2000000000,-2000000000);add('retry-just-ready','publication',-5000,-5000,-10);
 const first=await claimIndexJob(f.env.DB);assert.equal(first.job_key,'old-renewal');f.sqlite.prepare("UPDATE creation_index_work SET state='ready',lease_token=NULL,lease_until=0 WHERE job_key=?").run(first.job_key);
 const second=await claimIndexJob(f.env.DB);assert.equal(second.job_key,'old-compaction','continuation touched is refreshed so another aged job gets a turn');
 const third=await claimIndexJob(f.env.DB);assert.equal(third.job_key,'fresh-compaction','unaged jobs preserve existing touched ordering');
 assert.notEqual(second.job_key,'retry-just-ready','backoff time does not count as eligible queue age');
});

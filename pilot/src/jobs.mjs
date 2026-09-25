import {randomUUID} from 'node:crypto';
import {transaction,poolFromEnvironment,assertSchema} from './database.mjs';
import {GcsObjects} from './objects.mjs';
/** DB time and generation fences survive independent workers, duplicate wakes and restarts. */
export async function claim(pool,owner,{limit=10,leaseSeconds=30,cleanupOnly=true}={}){
 if(!Number.isInteger(limit)||limit<1||limit>100||leaseSeconds<1||leaseSeconds>120)throw Error('invalid_worker_bound');
 return transaction(pool,async db=>{const {rows}=await db.query(`WITH due AS(SELECT j.job_id FROM pilot.jobs j WHERE (j.state='due' OR j.state='leased' AND j.lease_until<clock_timestamp()) AND j.due_at<=clock_timestamp() AND ($3::boolean=false OR j.kind='cleanup') ORDER BY j.due_at FOR UPDATE SKIP LOCKED LIMIT $1) UPDATE pilot.jobs j SET state='leased',lease_owner=$2,lease_until=clock_timestamp()+make_interval(secs=>$4),fence=fence+1,attempts=attempts+1 FROM due WHERE j.job_id=due.job_id RETURNING j.*`,[limit,owner,cleanupOnly,leaseSeconds]);return rows;});
}
export async function finishMechanics(pool,job){return transaction(pool,async db=>{
 const {rows:[j]}=await db.query(`SELECT * FROM pilot.jobs WHERE job_id=$1 AND state='leased' AND fence=$2 AND lease_owner=$3 AND lease_until>clock_timestamp() FOR UPDATE`,[job.job_id,job.fence,job.lease_owner]);if(!j)return false;
 if(j.kind==='index'){const {rows:[source]}=await db.query('SELECT * FROM pilot.sources WHERE source_id=$1 FOR SHARE',[j.source_id]);if(!source||source.withdrawn_at||String(source.generation)!==String(j.source_generation))return false;const {rowCount}=await db.query("SELECT 1 FROM pilot.provider_attempts WHERE job_id=$1 AND state IN('dispatched','uncertain')",[j.job_id]);if(rowCount)throw Error('original_attempt_reconciliation_required');}
 await db.query('INSERT INTO pilot.job_effects(operation_id,job_id,fence) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[j.operation_id,j.job_id,j.fence]);await db.query("UPDATE pilot.jobs SET state='done' WHERE job_id=$1",[j.job_id]);return true;
});}
export async function eraseSource(pool,objects,job){
 // Never report physical erasure until all object generations are absent.
 const {rows:pending}=await pool.query("SELECT * FROM pilot.objects WHERE source_id=$1 ORDER BY erased_at NULLS FIRST,object_id LIMIT 10",[job.source_id]);
 for(const o of pending){for(const v of await objects.versions(o.object_key))await objects.remove(v.key,v.generation);if((await objects.versions(o.object_key)).length)throw Error('physical_erasure_unconfirmed');}
 return transaction(pool,async db=>{
  const {rows:[j]}=await db.query(`SELECT * FROM pilot.jobs WHERE job_id=$1 AND state='leased' AND fence=$2 AND lease_owner=$3 AND lease_until>clock_timestamp() FOR UPDATE`,[job.job_id,job.fence,job.lease_owner]);if(!j)return false;
  const {rows:[s]}=await db.query('SELECT * FROM pilot.sources WHERE source_id=$1 AND withdrawn_at IS NOT NULL FOR UPDATE',[job.source_id]);if(!s)return false;
  // Pending uploads can finish later: keep their tombstones and recheck on every cleanup wake.
  for(const o of pending)await db.query("UPDATE pilot.objects SET state='erased',erased_at=clock_timestamp() WHERE object_id=$1",[o.object_id]);
  await db.query(`DELETE FROM pilot.events WHERE workspace_id=$1 AND $2 IN(payload->>'project_id',payload->>'document_id',payload->>'block_id',payload->>'from_block_id',payload->>'to_block_id')`,[s.workspace_id,s.source_id]);
  await db.query("UPDATE pilot.drafts SET payload='{}',state='discarded' WHERE workspace_id=$1 AND state='active' AND jsonb_path_exists(payload,'$.** ? (@ == $source)',jsonb_build_object('source',$2::text))",[s.workspace_id,s.source_id]);
  await db.query("UPDATE pilot.jobs SET state='due',due_at=clock_timestamp()+interval '1 minute',lease_until=NULL WHERE job_id=$1",[j.job_id]);
  return true;
 });
}
export async function runBounded(pool,objects,{limit=10,commit='local-uncommitted'}={}){
 const wake=randomUUID();await pool.query('INSERT INTO pilot.wakes(wake_id,source_commit) VALUES($1,$2)',[wake,commit]);let completed=0;
 try{const jobs=await claim(pool,wake,{limit,cleanupOnly:true});for(const job of jobs)if(await eraseSource(pool,objects,job))completed++;await pool.query('UPDATE pilot.wakes SET finished_at=clock_timestamp(),claimed=$2,completed=$3 WHERE wake_id=$1',[wake,jobs.length,completed]);return {wake,claimed:jobs.length,completed,inference:false};}catch(e){await pool.query("UPDATE pilot.wakes SET finished_at=clock_timestamp(),error_code='cleanup_failed' WHERE wake_id=$1",[wake]);throw e;}
}
if(process.argv[1]===new URL(import.meta.url).pathname){
 if(process.argv[2]!=='cleanup')throw Error('Only bounded cleanup is enabled; provider dispatch is unavailable');
 const pool=poolFromEnvironment();try{await assertSchema(pool);console.log(JSON.stringify(await runBounded(pool,new GcsObjects(process.env.PILOT_BUCKET),{commit:process.env.SOURCE_COMMIT,limit:Number(process.env.PILOT_JOB_LIMIT??10)})));}finally{await pool.end();}
}

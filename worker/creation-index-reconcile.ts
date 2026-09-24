import type {WorkerEnv} from './runtime.ts';
import {CREATION_VECTOR_PREFIX} from './creation-vectors.ts';
import {leaseGuard,leaseBindings,type IndexLease} from './creation-index-schema.ts';
/** A paged private-prefix census catches crash orphans AND writes arriving after an erasure
 * receipt. Receipts do not assert a remote heap wipe or model-provider deletion. */
export async function reconcileIndexObjects(env:WorkerEnv,l:IndexLease){
 const page=await env.MEDIA.list({prefix:CREATION_VECTOR_PREFIX,limit:32,...(l.cursor?{cursor:l.cursor}:{})});
 for(const object of page.objects){const known=await env.DB.prepare("SELECT state,write_until FROM creation_index_objects WHERE object_key=?").bind(object.key).first<{state:string;write_until:number}>();
  if(!known||known.state==='erased'||known.state==='retired'){await env.MEDIA.delete(object.key);if(await env.MEDIA.head(object.key))throw new Error('creation_orphan_erasure_unverified');}
 }
 await env.DB.prepare(`UPDATE creation_index_work SET cursor=?,state='ready',due=unixepoch()+?,lease_token=NULL,lease_until=0,error_class=NULL,attempts=0 WHERE job_key=? AND ${leaseGuard}`).bind(page.truncated?page.cursor:'',page.truncated?0:600,l.job_key,...leaseBindings(l)).run();
}
export async function creationMaintenanceStatus(env:WorkerEnv){
 const queue=await env.DB.prepare("SELECT COUNT(*) AS due,MAX(unixepoch()-created) AS oldest_seconds,SUM(CASE WHEN state='held' THEN 1 ELSE 0 END) AS held FROM creation_index_work WHERE state IN('ready','running','held') AND due<=unixepoch()").first();
 const erasure=await env.DB.prepare("SELECT COUNT(*) AS pending,MAX(MAX(0,unixepoch()-erase_due)) AS overdue_seconds FROM creation_index_objects WHERE state='retired'").first();
 const last=await env.DB.prepare('SELECT * FROM creation_index_runs ORDER BY started DESC LIMIT 1').first();return {queue,erasure,last};
}
/** Operator-only library entry, intentionally not a public route. Resuming a held projection
 * restarts the generation so an expired partial checkpoint cannot silently lose entities. */
export async function resumeCreationIndexPartition(env:WorkerEnv,key:string){
 await env.DB.prepare('UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1 WHERE partition_key=?').bind(key).run();
}
/** D1-led half of reconciliation: R2 list alone cannot reveal a missing published object. */
export async function reconcileIndexManifests(env:WorkerEnv,l:IndexLease){
 const page=await env.DB.prepare("SELECT object_key,partition_key,generation,byte_count,checksum FROM creation_index_objects WHERE object_key>? AND state='active' ORDER BY object_key LIMIT 32").bind(l.cursor).all<{object_key:string;partition_key:string;generation:number;byte_count:number;checksum:string}>();
 for(const o of page.results){const head=await env.MEDIA.head(o.object_key);if(!head||head.size!==o.byte_count||head.customMetadata?.checksum!==o.checksum)await env.DB.batch([env.DB.prepare("UPDATE creation_index_objects SET state='retired',erase_due=unixepoch() WHERE object_key=?").bind(o.object_key),env.DB.prepare('UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1 WHERE partition_key=? AND index_version=?').bind(o.partition_key,o.generation)]);}
 await env.DB.prepare(`UPDATE creation_index_work SET cursor=?,state='ready',due=unixepoch()+?,lease_token=NULL,lease_until=0,error_class=NULL,attempts=0 WHERE job_key=? AND ${leaseGuard}`).bind(page.results.length===32?page.results.at(-1)!.object_key:'',page.results.length===32?0:600,l.job_key,...leaseBindings(l)).run();
}

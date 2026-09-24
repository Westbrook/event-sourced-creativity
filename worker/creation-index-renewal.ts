import type {WorkerEnv} from './runtime.ts';
import type {IndexLease} from './creation-index-schema.ts';
import {leaseGuard,leaseBindings} from './creation-index-schema.ts';
import {indexAuthority,indexAuthorityFence} from './creation-index-authority.ts';
import {privateIndexBodyGuard} from './creation-index-private.ts';
import {nativePrivateContentCleanupEnvironment} from './memory-native-boundary.ts';
import {preparePrivateContent} from './private-content-storage.ts';
import {decisionHash} from './still-decision-store.ts';
import {CreationProviderError} from './creation-provider-http.ts';
import {readCreationShard} from './creation-index-search.ts';
import {CREATION_REPRESENTATION as R} from './creation-vectors.ts';
import type {HydratedCreationCandidate} from './creation-search.ts';

/** Existing 10% renewal lead; never extends a source's old assigned lifetime. */
const due=(alias:string)=>`unixepoch(${alias}.expires_at)-unixepoch()<=MIN(86400,MAX(60,(unixepoch(${alias}.expires_at)-unixepoch(${alias}.created_at))/10))`;
export const CREATION_RENEWAL_BUDGET=Object.freeze({sources:32,bodyBytes:1_000_000,shards:4,shardBytes:1_048_576});
type SourceRow={source_id:string;kind:string;revision:string;content_hash:string;content_id:string;content:string;snapshot_id:string|null;snapshot_content:string|null;total_bytes:number};
const entityId=(kind:string,id:string)=>(kind==='idea'?'blocks':kind==='document'?'documents':'projects')+':'+id;

/** A current, unexpired materialization is certified by synchronous canonical mutation
 * invalidation. Reauthorize that certificate and its original hash before assigning NEW
 * private bodies/sidecars. Never extend an old body, revive expiry, change a generation,
 * replay an entire Project, or spend a provider call for unchanged content. */
async function renewCurrentCreationIndex(env:WorkerEnv,l:IndexLease,signal:AbortSignal){
 const {partition:p,guard:authorityGuard}=await indexAuthority(env,l.partition_key);
 if(Number(p.indexVersion)!==l.generation||p.invalidated||!p.backfillComplete)throw new CreationProviderError('index_renewal_source_changed',0,true);
 const bodyGuard=privateIndexBodyGuard(p),snapshotGuard=privateIndexBodyGuard(p,'sc');
 const clear=()=>env.DB.prepare('DELETE FROM creation_index_fences');
 const fence=()=>env.DB.prepare(`INSERT INTO creation_index_fences(id) VALUES(CASE WHEN ${leaseGuard} AND EXISTS(SELECT 1 FROM creation_search_partitions WHERE partition_key=? AND index_version=? AND content_version=? AND invalidated=0 AND backfill_complete=1) THEN 1 ELSE NULL END)`).bind(...leaseBindings(l),l.partition_key,l.generation,p.contentVersion);
 // Legacy schema has no snapshots. Once a snapshot head exists it must certify this
 // exact generation, and every current source requires its original canonical body.
 const snapshotSchema=await env.DB.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE type='table' AND name IN('creation_index_snapshots','creation_index_snapshot_heads')").first<{n:number}>();
 if(snapshotSchema?.n===1)throw new CreationProviderError('index_renewal_snapshot_schema',0,true);
 const head=snapshotSchema?.n===2?await env.DB.prepare('SELECT generation FROM creation_index_snapshot_heads WHERE partition_key=?').bind(l.partition_key).first<{generation:number}>():null;
 if(head&&head.generation!==l.generation)throw new CreationProviderError('index_renewal_snapshot_stale',0,true);
 const withSnapshots=!!head;
 const joins=withSnapshots?`LEFT JOIN creation_index_snapshots snapshot ON snapshot.partition_key=r.partition_key AND snapshot.entity_id=(CASE r.kind WHEN 'idea' THEN 'blocks:' WHEN 'document' THEN 'documents:' ELSE 'projects:' END)||r.source_id LEFT JOIN private_content sc ON sc.content_id=snapshot.content_id`:'';
 const invalid=await env.DB.prepare(`SELECT 1 FROM creation_search_records r LEFT JOIN private_content c ON c.content_id=r.content_id ${joins} WHERE r.partition_key=? AND r.source_version=? AND r.tombstone=0 AND (COALESCE((${bodyGuard.sql}),0)=0 ${withSnapshots?`OR COALESCE((${snapshotGuard.sql}),0)=0`:''}) LIMIT 1`).bind(l.partition_key,p.contentVersion,...bodyGuard.bindings,...(withSnapshots?snapshotGuard.bindings:[])).first();
 if(invalid)throw new CreationProviderError('index_renewal_private_source_expired',0,true);
 const brokenManifest=await env.DB.prepare(`SELECT 1 FROM creation_index_sources s JOIN creation_search_records r ON r.partition_key=s.partition_key AND r.source_id=s.source_id AND r.revision=s.revision AND r.tombstone=0 AND r.source_version=? WHERE s.partition_key=? AND s.generation=? AND s.representation=? AND s.published=1 AND (s.expires<=unixepoch() OR s.expected<>s.completed OR s.expected<>(SELECT COUNT(*) FROM creation_index_members m JOIN creation_index_objects o ON o.object_key=m.object_key AND o.partition_key=s.partition_key AND o.generation=s.generation AND o.representation=s.representation AND o.state='active' AND o.expires>unixepoch() WHERE m.source_id=s.source_id AND m.revision=s.revision)) LIMIT 1`).bind(p.contentVersion,l.partition_key,l.generation,R.id).first();
 if(brokenManifest)throw new CreationProviderError('index_renewal_vector_invalid',0,true);
 const rows=await env.DB.prepare(`WITH candidates AS MATERIALIZED(SELECT r.source_id,r.kind,r.revision,r.content_hash,r.content_id,c.content,${withSnapshots?'sc.content_id AS snapshot_id,sc.content AS snapshot_content':'NULL AS snapshot_id,NULL AS snapshot_content'} FROM creation_search_records r JOIN private_content c ON c.content_id=r.content_id ${joins} WHERE r.partition_key=? AND r.source_version=? AND r.tombstone=0 AND ${bodyGuard.sql} ${withSnapshots?`AND ${snapshotGuard.sql}`:''} AND (${due('c')}${withSnapshots?` OR ${due('sc')}`:''}) ORDER BY c.expires_at,r.source_id LIMIT ${CREATION_RENEWAL_BUDGET.sources}), sized AS(SELECT *,SUM(length(CAST(content AS BLOB))+COALESCE(length(CAST(snapshot_content AS BLOB)),0)) OVER(ORDER BY source_id) AS total_bytes FROM candidates) SELECT source_id,kind,revision,content_hash,content_id,CASE WHEN total_bytes<=${CREATION_RENEWAL_BUDGET.bodyBytes} THEN content END AS content,snapshot_id,CASE WHEN total_bytes<=${CREATION_RENEWAL_BUDGET.bodyBytes} THEN snapshot_content END AS snapshot_content,total_bytes FROM sized WHERE total_bytes<=${CREATION_RENEWAL_BUDGET.bodyBytes} OR source_id=(SELECT MIN(source_id) FROM candidates) ORDER BY source_id`).bind(l.partition_key,p.contentVersion,...bodyGuard.bindings,...(withSnapshots?snapshotGuard.bindings:[])).all<SourceRow>();
 if(rows.results.some(row=>row.total_bytes>CREATION_RENEWAL_BUDGET.bodyBytes))throw new CreationProviderError('index_renewal_body_capacity',0,true);
 const replacements:Array<{id:string;old:string;fresh:string;revision:string;hash:string;snapshot:string|null;freshSnapshot:string|null;entity:string}>=[];
 if(rows.results.length){
  const writeEnv=nativePrivateContentCleanupEnvironment(env),scope=p.projectAccessId?{organizationId:p.organizationId!,projectAccessId:p.projectAccessId,projectId:p.projectId,ownerUserId:p.ownerId,actorUserId:p.ownerId}:undefined;
  const inserts:D1PreparedStatement[]=[];
  for(const row of rows.results){
   signal.throwIfAborted();const source=JSON.parse(row.content) as HydratedCreationCandidate;
   if(source.id!==row.source_id||source.kind!==row.kind||source.revision!==row.revision||source.contentHash!==row.content_hash||source.custody!==p.custody||source.projectId!==p.projectId||typeof source.title!=='string'||typeof source.text!=='string'||!Array.isArray(source.locations)||await decisionHash({title:source.title,text:source.text,locations:source.locations,type:source.type??null})!==row.content_hash)throw new CreationProviderError('index_renewal_source_identity',0,true);
   const stored=await preparePrivateContent(writeEnv,p.ownerId,'creation-search-source',row.content,scope,undefined,{sql:leaseGuard,bindings:leaseBindings(l)});inserts.push(...stored.statements);
   let freshSnapshot:string|null=null;
   if(row.snapshot_id&&row.snapshot_content){const canonical=JSON.parse(row.snapshot_content) as {id:string;projectId?:string;removed?:boolean};if(canonical.id!==row.source_id||canonical.removed||row.kind!=='project'&&canonical.projectId!==p.projectId)throw new CreationProviderError('index_renewal_snapshot_identity',0,true);
    const snapshot=await preparePrivateContent(writeEnv,p.ownerId,'creation-search-source',row.snapshot_content,scope,undefined,{sql:leaseGuard,bindings:leaseBindings(l)});inserts.push(...snapshot.statements);freshSnapshot=snapshot.contentId;
   }
   replacements.push({id:row.source_id,old:row.content_id,fresh:stored.contentId,revision:row.revision,hash:row.content_hash,snapshot:row.snapshot_id,freshSnapshot,entity:entityId(row.kind,row.source_id)});
  }
  const tuples=JSON.stringify(replacements),freshIds=JSON.stringify(replacements.flatMap(row=>[row.fresh,...(row.freshSnapshot?[row.freshSnapshot]:[])]));
  const statements=[indexAuthorityFence(env,authorityGuard),fence(),
   env.DB.prepare(`INSERT INTO creation_index_fences(id) VALUES(CASE WHEN (SELECT COUNT(*) FROM creation_search_records r JOIN json_each(?) wanted ON r.source_id=json_extract(wanted.value,'$.id') AND r.revision=json_extract(wanted.value,'$.revision') AND r.content_hash=json_extract(wanted.value,'$.hash') AND r.content_id=json_extract(wanted.value,'$.old') JOIN private_content c ON c.content_id=r.content_id WHERE r.partition_key=? AND r.source_version=? AND r.tombstone=0 AND ${bodyGuard.sql})=? THEN 1 ELSE NULL END)`).bind(tuples,l.partition_key,p.contentVersion,...bodyGuard.bindings,replacements.length),
   ...(withSnapshots?[env.DB.prepare(`INSERT INTO creation_index_fences(id) VALUES(CASE WHEN EXISTS(SELECT 1 FROM creation_index_snapshot_heads WHERE partition_key=? AND generation=?) AND (SELECT COUNT(*) FROM creation_index_snapshots snapshot JOIN json_each(?) wanted ON snapshot.entity_id=json_extract(wanted.value,'$.entity') AND snapshot.content_id=json_extract(wanted.value,'$.snapshot') JOIN private_content c ON c.content_id=snapshot.content_id WHERE snapshot.partition_key=? AND ${bodyGuard.sql})=? THEN 1 ELSE NULL END)`).bind(l.partition_key,l.generation,tuples,l.partition_key,...bodyGuard.bindings,replacements.length)]:[]),
   ...inserts,
   env.DB.prepare(`INSERT INTO creation_index_fences(id) VALUES(CASE WHEN (SELECT COUNT(*) FROM private_content c WHERE c.content_id IN(SELECT value FROM json_each(?)) AND ${bodyGuard.sql})=? THEN 1 ELSE NULL END)`).bind(freshIds,...bodyGuard.bindings,replacements.length*(withSnapshots?2:1)),
   env.DB.prepare(`UPDATE creation_search_records SET content_id=(SELECT json_extract(value,'$.fresh') FROM json_each(?) WHERE json_extract(value,'$.id')=source_id) WHERE partition_key=? AND source_id IN(SELECT json_extract(value,'$.id') FROM json_each(?))`).bind(tuples,l.partition_key,tuples),
   env.DB.prepare(`UPDATE creation_index_sources SET expires=(SELECT unixepoch(c.expires_at) FROM creation_search_records r JOIN private_content c ON c.content_id=r.content_id WHERE r.partition_key=creation_index_sources.partition_key AND r.source_id=creation_index_sources.source_id AND r.revision=creation_index_sources.revision) WHERE partition_key=? AND generation=? AND representation=? AND source_id IN(SELECT json_extract(value,'$.id') FROM json_each(?))`).bind(l.partition_key,l.generation,R.id,tuples),
   ...(withSnapshots?[env.DB.prepare(`UPDATE creation_index_snapshots SET content_id=(SELECT json_extract(value,'$.freshSnapshot') FROM json_each(?) WHERE json_extract(value,'$.entity')=entity_id) WHERE partition_key=? AND entity_id IN(SELECT json_extract(value,'$.entity') FROM json_each(?))`).bind(tuples,l.partition_key,tuples)]:[]),clear()];
  await env.DB.batch(statements);
 }
 // A shared shard may extend only after EVERY member has a current new private
 // lifetime. Partial body renewal leaves the still-valid old object untouched.
 const memberEligibility=`SELECT COUNT(*) AS n,MIN(MIN(s.expires,unixepoch(c.expires_at))) AS expires FROM creation_index_members m JOIN creation_search_records r ON r.partition_key=o.partition_key AND r.source_id=m.source_id AND r.revision=m.revision AND r.tombstone=0 AND r.source_version=? JOIN creation_index_sources s ON s.partition_key=r.partition_key AND s.source_id=r.source_id AND s.revision=r.revision AND s.generation=o.generation AND s.representation=o.representation AND s.published=1 AND s.completed=s.expected AND s.expected>0 AND s.expires>unixepoch() JOIN private_content c ON c.content_id=r.content_id WHERE m.object_key=o.object_key AND ${bodyGuard.sql}`;
 const eligible=`SELECT o.object_key,o.checksum,o.byte_count,o.expires,(SELECT expires FROM(${memberEligibility})) AS fresh_expiry FROM creation_index_objects o WHERE o.partition_key=? AND o.generation=? AND o.representation=? AND o.state='active' AND o.expires>unixepoch() AND (SELECT n FROM(${memberEligibility}))*2048=o.byte_count`;
 const eligibleBindings=[p.contentVersion,...bodyGuard.bindings,l.partition_key,l.generation,R.id,p.contentVersion,...bodyGuard.bindings];
 const objects=await env.DB.prepare(`SELECT * FROM(${eligible}) WHERE fresh_expiry>expires ORDER BY expires,object_key LIMIT ${CREATION_RENEWAL_BUDGET.shards}`).bind(...eligibleBindings).all<{object_key:string;checksum:string;byte_count:number;expires:number;fresh_expiry:number}>();
 let shardBytes=0,renewedObjects=0;
 for(const object of objects.results){
  if(object.byte_count<=0||object.byte_count>CREATION_RENEWAL_BUDGET.shardBytes||object.byte_count%2048)throw new CreationProviderError('index_renewal_vector_invalid',0,true);
  if(shardBytes+object.byte_count>CREATION_RENEWAL_BUDGET.shardBytes)break;shardBytes+=object.byte_count;
  const reservation=await readCreationShard(env,object.object_key,object.byte_count,object.checksum,signal);try{await reservation.work;}catch(error){if(error instanceof Error&&/^creation_shard_(missing|length|checksum|manifest)$/.test(error.message))throw new CreationProviderError('index_renewal_vector_invalid',0,true);throw error;}finally{void reservation.settled.then(reservation.release,reservation.release);}
  await env.DB.batch([indexAuthorityFence(env,authorityGuard),fence(),env.DB.prepare(`INSERT INTO creation_index_fences(id) VALUES(CASE WHEN EXISTS(SELECT 1 FROM(${eligible}) WHERE object_key=? AND checksum=? AND byte_count=? AND expires=? AND fresh_expiry>=?) THEN 1 ELSE NULL END)`).bind(...eligibleBindings,object.object_key,object.checksum,object.byte_count,object.expires,object.fresh_expiry),env.DB.prepare("UPDATE creation_index_objects SET expires=? WHERE object_key=? AND expires=? AND state='active'").bind(object.fresh_expiry,object.object_key,object.expires),clear()]);renewedObjects++;
 }
 await env.DB.batch([indexAuthorityFence(env,authorityGuard),fence(),env.DB.prepare(`UPDATE creation_index_work SET cursor='',state='ready',due=unixepoch()+?,lease_token=NULL,lease_until=0,error_class=NULL,attempts=0 WHERE job_key=? AND ${leaseGuard}`).bind(rows.results.length||renewedObjects?0:600,l.job_key,...leaseBindings(l)),clear()]);
 return {bodies:replacements.length,snapshots:withSnapshots?replacements.length:0,objects:renewedObjects,shardBytes};
}


/** Missed wakes or corrupt derived state require a fresh canonical reconstruction,
 * never extension of an expired derivative. Reauthenticate before this fallback;
 * concurrent edits, lease loss or revocation cannot be converted into write authority. */
export async function renewCreationIndex(env:WorkerEnv,l:IndexLease,signal=AbortSignal.timeout(18000)){
 try{return await renewCurrentCreationIndex(env,l,signal);}
 catch(error){
  const recoverable=error instanceof SyntaxError||error instanceof Error&&['index_renewal_private_source_expired','index_renewal_snapshot_stale','index_renewal_snapshot_identity','index_renewal_source_identity','index_renewal_vector_invalid'].includes(error.message);
  if(!recoverable)throw error;signal.throwIfAborted();
  const {partition:p,guard}=await indexAuthority(env,l.partition_key);
  if(Number(p.indexVersion)!==l.generation||p.invalidated)throw error;
  const statements:D1PreparedStatement[]=[indexAuthorityFence(env,guard),env.DB.prepare(`INSERT INTO creation_index_fences(id) VALUES(CASE WHEN ${leaseGuard} AND EXISTS(SELECT 1 FROM creation_search_partitions WHERE partition_key=? AND index_version=? AND content_version=? AND invalidated=0) THEN 1 ELSE NULL END)`).bind(...leaseBindings(l),l.partition_key,l.generation,p.contentVersion)];
  const snapshots=await env.DB.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name IN('creation_index_snapshots','creation_index_snapshot_heads')").all<{name:string}>();
  for(const row of snapshots.results)statements.push(env.DB.prepare(`DELETE FROM ${row.name} WHERE partition_key=?`).bind(l.partition_key));
  statements.push(env.DB.prepare(`UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1 WHERE partition_key=? AND index_version=? AND ${leaseGuard}`).bind(l.partition_key,l.generation,...leaseBindings(l)),env.DB.prepare('DELETE FROM creation_index_fences'));
  await env.DB.batch(statements);
  return {bodies:0,snapshots:0,objects:0,shardBytes:0,rebuild:true,reason:error instanceof SyntaxError?'index_renewal_source_identity':error.message};
 }
}

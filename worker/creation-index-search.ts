import type {WorkerEnv} from './runtime.ts';
import type {CreationLearnedSearch,CreationSearchHit} from './creation-search.ts';
import {searchPartitionKey} from './creation-search-index.ts';
import {CREATION_REPRESENTATION as R,MAX_SHARD_BYTES,vectorChecksum,cosineAt,embedCreationTexts,isCreationIndexKey} from './creation-vectors.ts';
import {withinSignal} from './creation-provider-http.ts';
import {creationProviderPermitted} from './creation-search-providers.ts';
let inFlightBytes=0,inFlightReads=0;
const slots=new Set<()=>void>();
async function acquire(size:number,signal:AbortSignal){while(inFlightReads>=4||inFlightBytes+size>4*MAX_SHARD_BYTES){let wake:()=>void=()=>{};try{await withinSignal(new Promise<void>(resolve=>{wake=resolve;slots.add(wake);}),signal);}finally{slots.delete(wake);}}signal.throwIfAborted();inFlightBytes+=size;inFlightReads++;}
export function creationVectorReadBudget(){return {bytes:inFlightBytes,reads:inFlightReads,maxBytes:4*MAX_SHARD_BYTES,maxReads:4};}
export async function readCreationShard(env:WorkerEnv,key:string,size:number,checksum:string,signal:AbortSignal){
 if(!isCreationIndexKey(key)||!Number.isSafeInteger(size)||size<=0||size>MAX_SHARD_BYTES)throw new Error('creation_shard_manifest');
 await acquire(size,signal);
 // Retain the reservation until the underlying read actually settles, even after deadline.
 const work=(async()=>{const object=await env.MEDIA.get(key);if(!object||object.size!==size){void object?.body.cancel();throw new Error('creation_shard_missing');}const reader=object.body.getReader(),bytes=new Uint8Array(size);let offset=0;try{for(;;){const {done,value}=await withinSignal(reader.read(),signal);if(done)break;if(offset+value.length>size)throw new Error('creation_shard_length');bytes.set(value,offset);offset+=value.length;}if(offset!==size||await vectorChecksum(bytes)!==checksum)throw new Error('creation_shard_checksum');return bytes;}finally{void reader.cancel().catch(()=>{});}})();
 return {work:withinSignal(work,signal),release:()=>{inFlightBytes-=size;inFlightReads--;for(const wake of slots)wake();},settled:work};
}
type Shard={object_key:string;checksum:string;byte_count:number};
/** Construct once per user search. Only query embeddings are reused within its exact custody
 * boundary. Shard buffers live for one scan and are never an isolate cache. */
export function sameWorkerCreationSearch(env:WorkerEnv):CreationLearnedSearch|undefined{
 if(env.STILL_CREATION_INDEX_ENABLED!=='true'||!env.OPENAI_API_KEY)return;
 const queries=new Map<string,Promise<Float32Array>>();
 return {modelVersion:R.id,async query(p,query,limit,signal){
  if(!creationProviderPermitted(env,p))throw new Error('creation_provider_policy_denied');
  if(!await env.DB.prepare('SELECT 1 FROM creation_index_enrollments WHERE custody=? AND enabled=1 AND expires>unixepoch()').bind(p.custody).first())throw new Error('creation_provider_policy_denied');
  const boundary=JSON.stringify([p.custody,p.providerPolicy,R.id,query]);let embedding=queries.get(boundary);if(!embedding){embedding=embedCreationTexts(env,[query],signal).then(v=>v.vectors[0]);queries.set(boundary,embedding);}const vector=await embedding;signal.throwIfAborted();
  const top=new Map<string,CreationSearchHit>();let cursor='',scanned=0,bytesRead=0;
  for(;;){const page=await withinSignal(env.DB.prepare(`SELECT o.object_key,o.checksum,o.byte_count FROM creation_index_objects o JOIN creation_search_partitions p ON p.partition_key=o.partition_key WHERE o.partition_key=? AND o.object_key>? AND o.representation=? AND o.state='active' AND o.expires>unixepoch() AND p.invalidated=0 AND p.index_version=o.generation AND CAST(p.index_version AS TEXT)=? AND p.content_version=? AND EXISTS(SELECT 1 FROM creation_index_enrollments e WHERE e.custody=p.custody AND e.enabled=1 AND e.expires>unixepoch()) ORDER BY o.object_key LIMIT 32`).bind(searchPartitionKey(p),cursor,R.id,p.indexVersion,p.contentVersion).all<Shard>(),signal);
   if(!page.results.length)break;
   // Sequential per partition; aggregate limit protects up to 64 concurrently considered partitions.
   for(const row of page.results){signal.throwIfAborted();const reservation=await readCreationShard(env,row.object_key,row.byte_count,row.checksum,signal);try{const bytes=await reservation.work;const members=await withinSignal(env.DB.prepare(`SELECT m.*,r.kind,r.content_hash FROM creation_index_members m JOIN creation_search_records r ON r.partition_key=? AND r.source_id=m.source_id AND r.revision=m.revision AND r.tombstone=0 JOIN creation_index_sources s ON s.partition_key=r.partition_key AND s.source_id=r.source_id AND s.revision=r.revision AND s.representation=? AND s.generation=? AND s.published=1 AND s.expected=s.completed AND s.expires>unixepoch() JOIN private_content c ON c.content_id=r.content_id AND c.redacted_at IS NULL AND c.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE m.object_key=? ORDER BY m.vector_offset`).bind(searchPartitionKey(p),R.id,Number(p.indexVersion),row.object_key).all<{source_id:string;revision:string;kind:CreationSearchHit['kind'];content_hash:string;vector_offset:number;start_offset:number;end_offset:number}>(),signal);
     if(members.results.length*2048!==bytes.length)throw new Error('creation_shard_members_changed');
     for(const member of members.results){const score=cosineAt(bytes,member.vector_offset,vector),old=top.get(member.source_id);if(!old||score>(old.relevance??-2))top.set(member.source_id,{id:member.source_id,projectId:p.projectId,custody:p.custody,kind:member.kind,revision:member.revision,contentHash:member.content_hash,rank:0,relevance:score,passage:{start:member.start_offset,end:member.end_offset}});if(top.size>Math.min(20,limit)){const worst=[...top.values()].sort((a,b)=>(a.relevance??0)-(b.relevance??0)||b.id.localeCompare(a.id))[0];top.delete(worst.id);}}scanned+=members.results.length;bytesRead+=bytes.length;}catch(error){
     // A corrupt/missing current object becomes durable repair work, not an endless partial scan.
     if(error instanceof Error&&/^(creation_shard_(missing|length|checksum|members_changed)|shard_(length|nonfinite|norm))$/.test(error.message)&&!signal.aborted)await env.DB.prepare("UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1 WHERE partition_key=? AND CAST(index_version AS TEXT)=? AND content_version=? AND EXISTS(SELECT 1 FROM creation_index_objects WHERE object_key=? AND state='active')").bind(searchPartitionKey(p),p.indexVersion,p.contentVersion,row.object_key).run();
     throw error;
    }finally{void reservation.settled.then(reservation.release,reservation.release);}cursor=row.object_key;}
   if(page.results.length<32)break;
  }
  // No stale source may survive the object I/O window, even before hydration.
  const current=await withinSignal(env.DB.prepare('SELECT 1 FROM creation_search_partitions WHERE partition_key=? AND CAST(index_version AS TEXT)=? AND content_version=? AND invalidated=0 AND EXISTS(SELECT 1 FROM creation_index_enrollments e WHERE e.custody=creation_search_partitions.custody AND e.enabled=1 AND e.expires>unixepoch())').bind(searchPartitionKey(p),p.indexVersion,p.contentVersion).first(),signal);if(!current||!creationProviderPermitted(env,p))throw new Error('creation_search_witness_changed');
  console.info(JSON.stringify({event:'creation-vector-scan',vectors:scanned,bytes:bytesRead,representation:R.id}));return [...top.values()].sort((a,b)=>(b.relevance??0)-(a.relevance??0)||a.id.localeCompare(b.id)).map((h,rank)=>({...h,rank}));
 }};
}

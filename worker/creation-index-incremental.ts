import type {WorkerEnv} from './runtime.ts';
import type {IndexLease} from './creation-index-schema.ts';
import {leaseGuard,leaseBindings} from './creation-index-schema.ts';
import {indexAuthorityFence,type indexAuthority} from './creation-index-authority.ts';
import {privateIndexBodyGuard} from './creation-index-private.ts';
import {decisionHash} from './still-decision-store.ts';

type Authority=Awaited<ReturnType<typeof indexAuthority>>;
export type CreationIncrementalMarker={ideaIds:string[];materializeIds:string[];baseGeneration:number;baseVersion:string;baseHead:number;baseOwnerHead:number};
export type CreationProjectionCursor={after:number;head:number;routingAfter?:number;routeComplete?:boolean;ownerHead?:number;withdrawalAfter?:number;withdrawalComplete?:boolean;phase?:string;incremental?:CreationIncrementalMarker};
const authoring="(substr(e.type,1,5)='Block' OR substr(e.type,1,8)='Document' OR substr(e.type,1,7)='Project') AND e.type NOT IN('ProjectOpened','DocumentOpened')";
/** Only a complete, currently authorized source snapshot certifies an append-only
 * text delta. Unsafe old-history/policy mutations delete the anchor in SQL. */
export async function prepareIncrementalProjection(env:WorkerEnv,l:IndexLease,a:Authority,head:number,ownerHead:number):Promise<CreationProjectionCursor|null>{
 const p=a.partition,guard=privateIndexBodyGuard(p);
 const base=await env.DB.prepare('SELECT generation,head,owner_head FROM creation_index_snapshot_heads WHERE partition_key=?').bind(l.partition_key).first<{generation:number;head:number;owner_head:number}>();
 if(!base||base.generation>=l.generation||base.head>=head||base.owner_head>=ownerHead)return null;
 // Metadata only: values themselves remain in the normal bounded replay transport.
 // Even an unrelated structural owner event forces the established full replay.
 const boundedField=(name:string)=>`CASE WHEN length(CAST(json_extract(COALESCE(secret.private_json,e.payload),'$.${name}') AS BLOB))<=4096 THEN json_extract(COALESCE(secret.private_json,e.payload),'$.${name}') END`;
 const delta=await env.DB.prepare(`SELECT e.event_id,e.type,e.sequence,json_type(COALESCE(secret.private_json,e.payload),'$.block_id') AS id_type,${boundedField('block_id')} AS id,${boundedField('project_id')} AS project_id,${boundedField('property_path')} AS path,json_type(COALESCE(secret.private_json,e.payload),'$.new_value') AS value_type,CASE WHEN ? IS NULL THEN 1 ELSE EXISTS(SELECT 1 FROM project_event_scopes s WHERE s.event_id=e.event_id AND s.project_access_id=? AND s.owner_user_id=?) END AS scoped FROM events e LEFT JOIN event_private_payloads secret ON secret.private_event_id=e.event_id AND secret.redacted_at IS NULL WHERE e.stream_id=? AND e.sequence>? AND e.sequence<=? AND ${authoring} ORDER BY e.sequence LIMIT 33`).bind(p.projectAccessId??null,p.projectAccessId??null,p.ownerId,a.owner.streamId,base.owner_head,ownerHead).all<{event_id:string;type:string;sequence:number;id_type:string;id:string;project_id:string;path:string;value_type:string;scoped:number}>();
 if(!delta.results.length||delta.results.length>32||delta.results.some(row=>row.type!=='BlockPropertyEdited'||row.id_type!=='text'||!row.id||typeof row.project_id!=='string'||!row.project_id||row.path!=='text'||row.value_type!=='text'))return null;
 const relevant=delta.results.filter(row=>row.project_id===p.projectId),foreignIds=[...new Set(delta.results.filter(row=>row.project_id!==p.projectId).map(row=>row.id))];
 if(!relevant.length||relevant.some(row=>!row.scoped))return null;
 // Explicit foreign text cannot alter membership, but Project claims are not
 // identity authority: any overlap with this Project's known sources is unsafe.
 if(foreignIds.length&&await env.DB.prepare(`SELECT 1 WHERE EXISTS(SELECT 1 FROM creation_index_snapshots WHERE partition_key=? AND entity_id IN(SELECT 'blocks:'||value FROM json_each(?))) OR EXISTS(SELECT 1 FROM creation_search_records WHERE partition_key=? AND source_id IN(SELECT value FROM json_each(?)))`).bind(l.partition_key,JSON.stringify(foreignIds),l.partition_key,JSON.stringify(foreignIds)).first())return null;
 const ids=[...new Set(relevant.map(row=>row.id))],baseVersion=await decisionHash({partition:l.partition_key,indexVersion:base.generation});
 if(baseVersion!==p.contentVersion)return null;
 const snapshots=await env.DB.prepare(`WITH snapshot_metadata AS MATERIALIZED(SELECT s.entity_id,json_object('id',json_extract(c.content,'$.id'),'projectId',json_extract(c.content,'$.projectId'),'removed',json_extract(c.content,'$.removed'),'documentUses',json_extract(c.content,'$.documentUses')) AS content FROM creation_index_snapshots s JOIN private_content c ON c.content_id=s.content_id WHERE s.partition_key=? AND s.kind='blocks' AND s.entity_id IN(SELECT 'blocks:'||value FROM json_each(?)) AND ${guard.sql}) SELECT entity_id,content FROM snapshot_metadata WHERE length(CAST(content AS BLOB))<=30000`).bind(l.partition_key,JSON.stringify(ids),...guard.bindings).all<{entity_id:string;content:string}>();
 if(snapshots.results.length!==ids.length)return null;
 const materializeIds=new Set(['projects:'+p.projectId,...ids.map(id=>'blocks:'+id)]);
 for(const row of snapshots.results){const block=JSON.parse(row.content);if(block.removed||block.projectId!==p.projectId||typeof block.id!=='string'||row.entity_id!=='blocks:'+block.id)return null;for(const use of block.documentUses??[])materializeIds.add('documents:'+use.documentId);}
 const valid=`EXISTS(SELECT 1 FROM creation_index_snapshot_heads WHERE partition_key=? AND generation=? AND head=? AND owner_head=?) AND EXISTS(SELECT 1 FROM creation_index_snapshots WHERE partition_key=?) AND NOT EXISTS(SELECT 1 FROM creation_index_snapshots s LEFT JOIN private_content c ON c.content_id=s.content_id WHERE s.partition_key=? AND COALESCE((${guard.sql}),0)=0) AND NOT EXISTS(SELECT 1 FROM creation_search_records r LEFT JOIN private_content c ON c.content_id=r.content_id WHERE r.partition_key=? AND r.tombstone=0 AND (r.source_version<>? OR COALESCE((${guard.sql}),0)=0)) AND NOT EXISTS(SELECT 1 FROM creation_search_records r WHERE r.partition_key=? AND r.tombstone=0 AND NOT EXISTS(SELECT 1 FROM creation_index_snapshots s WHERE s.partition_key=r.partition_key AND s.entity_id=(CASE r.kind WHEN 'idea' THEN 'blocks:' WHEN 'document' THEN 'documents:' ELSE 'projects:' END)||r.source_id)) AND (SELECT COUNT(*) FROM creation_search_records WHERE partition_key=? AND kind='idea' AND tombstone=0 AND source_id IN(SELECT value FROM json_each(?)))=?`;
 const bindings=[l.partition_key,base.generation,base.head,base.owner_head,l.partition_key,l.partition_key,...guard.bindings,l.partition_key,baseVersion,...guard.bindings,l.partition_key,l.partition_key,JSON.stringify(ids),ids.length];
 if(!await env.DB.prepare('SELECT 1 WHERE '+valid).bind(...bindings).first())return null;
 // Keep the lease: normal replay commits this cursor and its changed entities in
 // this same quantum. A crash retries from the unchanged completed snapshot.
 await env.DB.batch([indexAuthorityFence(env,a.guard),env.DB.prepare(`INSERT INTO creation_index_fences(id) VALUES(CASE WHEN ${leaseGuard} AND EXISTS(SELECT 1 FROM creation_search_partitions WHERE partition_key=? AND index_version=?) AND ${valid} THEN 1 ELSE NULL END)`).bind(...leaseBindings(l),l.partition_key,l.generation,...bindings),env.DB.prepare('INSERT OR REPLACE INTO creation_index_projection(partition_key,generation,entity_id,kind,content_id) SELECT partition_key,?,entity_id,kind,content_id FROM creation_index_snapshots WHERE partition_key=?').bind(l.generation,l.partition_key),env.DB.prepare('DELETE FROM creation_index_fences')]);
 return {after:base.head,head,ownerHead,routeComplete:true,routingAfter:head,withdrawalComplete:true,withdrawalAfter:ownerHead,incremental:{ideaIds:ids,materializeIds:[...materializeIds],baseGeneration:base.generation,baseVersion,baseHead:base.head,baseOwnerHead:base.owner_head}};
}
export async function incrementalMaterialization(env:WorkerEnv,l:IndexLease):Promise<CreationIncrementalMarker|undefined>{
 const row=await env.DB.prepare("SELECT cursor FROM creation_index_work WHERE job_key=? AND generation=? AND state='done'").bind('projection:'+l.partition_key,l.generation).first<{cursor:string}>();
 return row?.cursor?(JSON.parse(row.cursor) as CreationProjectionCursor).incremental:undefined;
}
/** Called before terminal scratch deletion, in the same fenced batch. Only current
 * eligible entities survive; removed/hidden bodies have no retained snapshot. */
export function captureCreationSnapshots(env:WorkerEnv,l:IndexLease,projectId:string,version:string,head:number,ownerHead:number){
 return [env.DB.prepare('DELETE FROM creation_index_snapshots WHERE partition_key=?').bind(l.partition_key),env.DB.prepare(`INSERT INTO creation_index_snapshots(partition_key,entity_id,kind,content_id) SELECT e.partition_key,e.entity_id,e.kind,e.content_id FROM creation_index_projection e JOIN private_content c ON c.content_id=e.content_id JOIN creation_search_records r ON r.partition_key=e.partition_key AND r.source_id=json_extract(c.content,'$.id') AND r.tombstone=0 AND r.source_version=? WHERE e.partition_key=? AND e.generation=? AND e.kind IN('projects','documents','blocks') AND CASE WHEN e.kind='projects' THEN json_extract(c.content,'$.id') ELSE json_extract(c.content,'$.projectId') END=? AND COALESCE(json_extract(c.content,'$.removed'),0)=0`).bind(version,l.partition_key,l.generation,projectId),env.DB.prepare('INSERT OR REPLACE INTO creation_index_snapshot_heads(partition_key,generation,head,owner_head) VALUES(?,?,?,?)').bind(l.partition_key,l.generation,head,ownerHead)];
}

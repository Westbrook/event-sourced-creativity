import type {WorkerEnv} from './runtime.ts';
import type {IndexLease} from './creation-index-schema.ts';
import {CreationProviderError} from './creation-provider-http.ts';

/** Generation-bound routing metadata only. No authored prose, credentials or decisions. */
export const CREATION_INDEX_ROUTING_SCHEMA=[
 `CREATE TABLE IF NOT EXISTS creation_index_block_routes(partition_key TEXT NOT NULL,generation INTEGER NOT NULL,block_id TEXT NOT NULL,project_id TEXT NOT NULL,safe_foreign INTEGER NOT NULL,created INTEGER NOT NULL,removed INTEGER NOT NULL DEFAULT 0,current_owner_removed INTEGER NOT NULL DEFAULT 0,current_owner_project_id TEXT,PRIMARY KEY(partition_key,generation,block_id))`,
] as const;
export const CREATION_ROUTING_PAGE_SIZE=256;
export type CreationRoutingMetadata={type:string;blockId:unknown;blockIdType:unknown;projectId:unknown;publicBlockId:unknown;publicProjectId:unknown;fromBlockId:unknown;fromBlockIdType:unknown;toBlockId:unknown;toBlockIdType:unknown};
type Route={blockId:string;projectId:string;safeForeign:number;created:number;removed:number};
const text=(value:unknown):value is string=>typeof value==='string'&&value.length>0;
const canonicalId=(value:unknown,kind:unknown)=>kind===null?'undefined':kind==='true'?'true':kind==='false'?'false':String(value);
/** Conservative monotone safety: uncertain scope, moves and relation participation
 * retain full history. Only explicitly foreign, immutable identities can be skipped. */
export function creationRoutingUpdates(events:CreationRoutingMetadata[],projectId:string):Route[]{
 const rows:Route[]=[];
 for(const event of events){
  if(event.type==='BlockRelationAdded'||event.type==='BlockRelationRemoved'){
   for(const [value,kind] of [[event.fromBlockId,event.fromBlockIdType],[event.toBlockId,event.toBlockIdType],[event.blockId,event.blockIdType]])if(value!==null&&value!==undefined&&canonicalId(value,kind))rows.push({blockId:canonicalId(value,kind),projectId:'',safeForeign:0,created:0,removed:-1});
   continue;
  }
  const blockId=canonicalId(event.blockId,event.blockIdType);
  if(!blockId)continue;
  const coherent=(event.publicBlockId==null||event.publicBlockId===event.blockId)&&(event.publicProjectId==null||event.publicProjectId===event.projectId);
  const safe=coherent&&text(event.blockId)&&text(event.projectId)&&event.projectId!==projectId&&event.type!=='BlockRehomed';
  rows.push({blockId,projectId:text(event.projectId)?event.projectId:'',safeForeign:safe?1:0,created:event.type==='BlockCreated'?1:0,removed:event.type==='BlockRemoved'?1:event.type==='BlockCreated'||event.type==='BlockRestored'?0:-1});
 }
 return rows;
}
/** Used only after the entire frozen head has been routed. Caller binds partition/gen.
 * This is a keyed lookup, never a correlated scan through authoring history. */
export const creationProjectionRoutingPredicate=`(substr(e.type,1,5)<>'Block' OR e.type IN('BlockRelationAdded','BlockRelationRemoved') OR COALESCE(json_type(COALESCE(secret.private_json,e.payload),'$.block_id'),'missing')<>'text' OR NOT EXISTS(SELECT 1 FROM creation_index_block_routes route WHERE route.partition_key=? AND route.generation=? AND route.block_id=json_extract(COALESCE(secret.private_json,e.payload),'$.block_id') AND route.created=1 AND route.safe_foreign=1))`;

/** Prepare one bounded metadata page. The caller MUST commit returned statements with
 * its current authority/generation/lease fences and routing cursor in one D1 batch.
 * A partially scanned routing table is never permission to filter replay. */
export async function prepareCreationProjectionRouting(env:WorkerEnv,l:Pick<IndexLease,'partition_key'|'generation'>,input:{head:number;after:number;projectId:string;streamId:string;projectAccessId?:string;ownerId:string}){
 const shared=!!input.projectAccessId,sequence=shared?'scope.project_sequence':'e.sequence',join=shared?'JOIN project_event_scopes scope ON scope.event_id=e.event_id':'';
 const page=await env.DB.prepare(`WITH page AS MATERIALIZED(SELECT e.type,e.payload,${sequence} AS source_sequence,COALESCE(secret.private_json,e.payload) AS body FROM events e ${join} LEFT JOIN event_private_payloads secret ON secret.private_event_id=e.event_id AND secret.redacted_at IS NULL WHERE ${shared?'scope.project_access_id=? AND scope.owner_user_id=?':'e.stream_id=?'} AND substr(e.type,1,5)='Block' AND ${sequence}>? AND ${sequence}<=? ORDER BY ${sequence} LIMIT ${CREATION_ROUTING_PAGE_SIZE}), metadata AS MATERIALIZED(SELECT source_sequence,json_object('type',type,'blockId',json_extract(body,'$.block_id'),'blockIdType',json_type(body,'$.block_id'),'projectId',json_extract(body,'$.project_id'),'publicBlockId',json_extract(payload,'$.block_id'),'publicProjectId',json_extract(payload,'$.project_id'),'fromBlockId',json_extract(body,'$.from_block_id'),'fromBlockIdType',json_type(body,'$.from_block_id'),'toBlockId',json_extract(body,'$.to_block_id'),'toBlockIdType',json_type(body,'$.to_block_id')) AS metadata FROM page), sized AS(SELECT *,SUM(length(CAST(metadata AS BLOB))+64) OVER(ORDER BY source_sequence) AS total_bytes FROM metadata) SELECT source_sequence,CASE WHEN length(CAST(metadata AS BLOB))<=1000000 THEN metadata END AS metadata,(SELECT COUNT(*) FROM page) AS page_count,(SELECT MAX(source_sequence) FROM page) AS page_last FROM sized WHERE total_bytes<=1000000 OR source_sequence=(SELECT MIN(source_sequence) FROM page) ORDER BY source_sequence`).bind(...(shared?[input.projectAccessId!,input.ownerId]:[input.streamId]),input.after,input.head).all<{source_sequence:number;metadata:string|null;page_count:number;page_last:number}>();
 if(page.results.some(row=>row.metadata===null))throw new CreationProviderError('index_routing_capacity',0,true);
 const updates=creationRoutingUpdates(page.results.map(row=>JSON.parse(row.metadata!)),input.projectId);
 const last=page.results.at(-1),done=!last||last.source_sequence>=input.head||last.page_count<CREATION_ROUTING_PAGE_SIZE&&last.source_sequence===last.page_last;
 const statements=updates.length?[env.DB.prepare(`INSERT INTO creation_index_block_routes(partition_key,generation,block_id,project_id,safe_foreign,created,removed) SELECT ?,?,json_extract(value,'$.blockId'),json_extract(value,'$.projectId'),json_extract(value,'$.safeForeign'),json_extract(value,'$.created'),json_extract(value,'$.removed') FROM json_each(?) WHERE 1 ORDER BY CAST(key AS INTEGER) ON CONFLICT(partition_key,generation,block_id) DO UPDATE SET safe_foreign=MIN(creation_index_block_routes.safe_foreign,excluded.safe_foreign,CASE WHEN creation_index_block_routes.project_id=excluded.project_id THEN 1 ELSE 0 END),created=MAX(creation_index_block_routes.created,excluded.created),removed=CASE WHEN excluded.removed>=0 THEN excluded.removed ELSE creation_index_block_routes.removed END`).bind(l.partition_key,l.generation,JSON.stringify(updates))]:[];
 return {after:done?input.head:Number(last!.source_sequence),done,statements,rows:page.results.length};
}

/** Denial-only overlay for a shared scoped history which can omit an owner's later
 * withdrawal. Read lifecycle metadata, never prose, and update ONLY already-scoped
 * routing identities. A cleared owner marker never clears scoped removal or grants
 * a resource, Project, body or provider permission. Caller fences cursor + writes. */
export async function prepareCreationWithdrawalOverlay(env:WorkerEnv,l:Pick<IndexLease,'partition_key'|'generation'>,input:{head:number;after:number;streamId:string;projectAccessId?:string;projectId?:string}){
 const page=await env.DB.prepare(`WITH page AS MATERIALIZED(SELECT e.sequence,e.type,EXISTS(SELECT 1 FROM project_event_scopes scope WHERE scope.event_id=e.event_id AND scope.project_access_id=? AND scope.owner_user_id=substr(e.stream_id,10)) AS scoped,COALESCE(secret.private_json,e.payload) AS body FROM events e LEFT JOIN event_private_payloads secret ON secret.private_event_id=e.event_id AND secret.redacted_at IS NULL WHERE e.stream_id=? AND e.sequence>? AND e.sequence<=? AND e.type IN('BlockCreated','BlockRemoved','BlockRestored','BlockRehomed') ORDER BY e.sequence LIMIT ${CREATION_ROUTING_PAGE_SIZE}), metadata AS MATERIALIZED(SELECT sequence,json_object('type',type,'blockId',json_extract(body,'$.block_id'),'blockIdType',json_type(body,'$.block_id'),'projectId',json_extract(body,'$.project_id'),'projectIdType',json_type(body,'$.project_id'),'scoped',scoped) AS metadata FROM page), sized AS(SELECT *,SUM(length(CAST(metadata AS BLOB))+64) OVER(ORDER BY sequence) AS total_bytes FROM metadata) SELECT sequence,CASE WHEN length(CAST(metadata AS BLOB))<=1000000 THEN metadata END AS metadata,(SELECT COUNT(*) FROM page) AS page_count,(SELECT MAX(sequence) FROM page) AS page_last FROM sized WHERE total_bytes<=1000000 OR sequence=(SELECT MIN(sequence) FROM page) ORDER BY sequence`).bind(input.projectAccessId??null,input.streamId,input.after,input.head).all<{sequence:number;metadata:string|null;page_count:number;page_last:number}>();
 if(page.results.some(row=>row.metadata===null))throw new CreationProviderError('index_withdrawal_routing_capacity',0,true);
 const updates=page.results.map(row=>{const m=JSON.parse(row.metadata!) as Pick<CreationRoutingMetadata,'type'|'blockId'|'blockIdType'|'projectId'>&{projectIdType:unknown;scoped:number};return {id:canonicalId(m.blockId,m.blockIdType),removed:m.type==='BlockRemoved'?1:m.type==='BlockRehomed'?-1:0,project:m.type==='BlockCreated'?(m.projectId==null?(m.scoped?input.projectId??'':''):canonicalId(m.projectId,m.projectIdType)):m.type==='BlockRehomed'&&m.projectId!=null?canonicalId(m.projectId,m.projectIdType):null,sequence:row.sequence};});
 const last=page.results.at(-1),done=!last||last.sequence>=input.head||last.page_count<CREATION_ROUTING_PAGE_SIZE&&last.sequence===last.page_last;
 const statements=updates.length?[env.DB.prepare(`WITH updates AS MATERIALIZED(SELECT json_extract(value,'$.id') AS id,json_extract(value,'$.removed') AS removed,json_extract(value,'$.project') AS project,json_extract(value,'$.sequence') AS sequence FROM json_each(?)) UPDATE creation_index_block_routes SET current_owner_removed=COALESCE((SELECT removed FROM updates WHERE updates.id=creation_index_block_routes.block_id AND removed>=0 ORDER BY sequence DESC LIMIT 1),current_owner_removed),current_owner_project_id=COALESCE((SELECT project FROM updates WHERE updates.id=creation_index_block_routes.block_id AND project IS NOT NULL ORDER BY sequence DESC LIMIT 1),current_owner_project_id) WHERE partition_key=? AND generation=? AND EXISTS(SELECT 1 FROM updates WHERE updates.id=creation_index_block_routes.block_id)`).bind(JSON.stringify(updates),l.partition_key,l.generation)]:[];
 return {after:done?input.head:Number(last!.sequence),done,statements,rows:page.results.length};
}

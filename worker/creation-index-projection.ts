import {privateIndexBodyGuard} from './creation-index-private.ts';
import type {WorkerEnv} from './runtime.ts';
import {createCreativeEventFold,type CreationAuthoringCheckpoint,type CreativeEvent} from '../src/model/events.ts';
import {serializeEvent} from './event-read-primitives.ts';
import {preparePrivateContent} from './private-content-storage.ts';
import {decisionHash} from './still-decision-store.ts';
import {D1CreationSearchIndex} from './creation-search-index.ts';
import {indexAuthority,indexAuthorityFence} from './creation-index-authority.ts';
import {assertIndexLease,leaseGuard,leaseBindings,checkpointIndexJob,type IndexLease} from './creation-index-schema.ts';
import {CreationProviderError} from './creation-provider-http.ts';
import type {HydratedCreationCandidate} from './creation-search.ts';
const authoringTypes=['ProjectCreated','ProjectOpened','ProjectRenamed','ProjectStateChanged','DocumentCreated','DocumentRenamed','DocumentForked','DocumentOpened','DocumentRemoved','DocumentRestored','BlockCreated','BlockDocumentAttached','BlockDocumentDetached','BlockRehomed','BlockRenamed','BlockPropertyEdited','BlockWeightSet','BlockLocked','BlockUnlocked','BlockRemoved','BlockRestored','BlockRelationAdded','BlockRelationRemoved'];
const empty=():CreationAuthoringCheckpoint=>({projects:[],documents:[],blocks:[],relations:[],projectId:'',documentId:''});
const budget=16_000_000;
export async function projectionPage(env:WorkerEnv,l:IndexLease){
 const {partition:p,owner,guard:authorityGuard}=await indexAuthority(env,l.partition_key);if(Number(p.indexVersion)!==l.generation)throw new Error('creation_lease_lost');
 const bodyGuard=privateIndexBodyGuard(p);
 const cursor=l.cursor?JSON.parse(l.cursor) as {after:number;head:number}:null;
 const head=cursor?.head??Number((await env.DB.prepare(p.projectAccessId?'SELECT COALESCE(MAX(project_sequence),0) AS n FROM project_event_scopes WHERE project_access_id=?':'SELECT COALESCE(MAX(sequence),0) AS n FROM events WHERE stream_id=?').bind(p.projectAccessId??owner.streamId).first<{n:number}>())?.n??0);
 // SQL transport bound applies BEFORE bytes enter the isolate. Source generation guards
 // certify mutations/private withdrawal throughout all pages, not just the terminal read.
 const join=p.projectAccessId?'JOIN project_event_scopes scope ON scope.event_id=e.event_id':'';
 const sequence=p.projectAccessId?'scope.project_sequence':'e.sequence';
 const rows=await env.DB.prepare(`WITH page AS MATERIALIZED(SELECT e.*,${sequence} AS source_sequence,COALESCE(secret.private_json,e.payload) AS body FROM events e ${join} LEFT JOIN event_private_payloads secret ON secret.private_event_id=e.event_id AND secret.redacted_at IS NULL WHERE ${p.projectAccessId?'scope.project_access_id=? AND scope.owner_user_id=?':'e.stream_id=?'} AND ${sequence}>? AND ${sequence}<=? ORDER BY ${sequence} LIMIT 32), sized AS(SELECT *,SUM(length(CAST(body AS BLOB))+512) OVER(ORDER BY source_sequence) AS total_bytes FROM page) SELECT *,CASE WHEN length(CAST(body AS BLOB))<=1000000 THEN body END AS private_json FROM sized WHERE total_bytes<=1000000 OR source_sequence=(SELECT MIN(source_sequence) FROM page) ORDER BY source_sequence`).bind(...(p.projectAccessId?[p.projectAccessId,p.ownerId]:[owner.streamId]),cursor?.after??0,head).all<Record<string,unknown>>();
 if(rows.results.some(r=>r.private_json===null))throw new CreationProviderError('index_event_capacity',0,true);
 const seed=empty(),old=new Map<string,string>();let after='',bytes=0;
 for(;;){const saved=await env.DB.prepare(`SELECT e.entity_id,e.kind,c.content FROM creation_index_projection e JOIN private_content c ON c.content_id=e.content_id AND c.redacted_at IS NULL AND c.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE e.partition_key=? AND e.generation=? AND e.entity_id>? AND ${bodyGuard.sql} ORDER BY e.entity_id LIMIT 32`).bind(l.partition_key,l.generation,after,...bodyGuard.bindings).all<{entity_id:string;kind:string;content:string}>();if(!saved.results.length)break;for(const row of saved.results){bytes+=new TextEncoder().encode(row.content).length;if(bytes>budget)throw new CreationProviderError('index_projection_capacity',0,true);old.set(row.entity_id,row.content);const value=JSON.parse(row.content);if(row.kind==='selection'){seed.projectId=value.projectId;seed.documentId=value.documentId;}else (seed[row.kind as 'projects'|'documents'|'blocks'|'relations'] as unknown[]).push(value);after=row.entity_id;}if(saved.results.length<32)break;}
 const expectedCheckpoint=await env.DB.prepare('SELECT COUNT(*) AS n FROM creation_index_projection WHERE partition_key=? AND generation=?').bind(l.partition_key,l.generation).first<{n:number}>();
 if(expectedCheckpoint?.n!==old.size)throw new CreationProviderError('index_checkpoint_expired',0,true);
 if(cursor?.after&&old.size===0)throw new CreationProviderError('index_checkpoint_expired',0,true);
 const fold=createCreativeEventFold(Infinity,'',p.projectId,undefined,seed);
 for(const row of rows.results){if(authoringTypes.includes(String(row.type)))fold.accept({...serializeEvent(row),sequence:Number(row.source_sequence)} as CreativeEvent);}
 const checkpoint=fold.authoringCheckpoint();
 const scope=p.projectAccessId?{organizationId:p.organizationId!,projectAccessId:p.projectAccessId,projectId:p.projectId,ownerUserId:p.ownerId,actorUserId:p.ownerId}:undefined;
 const changed:Array<{id:string;kind:string;content:string}>=[];
 for(const kind of ['projects','documents','blocks','relations'] as const)for(const value of checkpoint[kind]){const id=kind+':'+value.id,content=JSON.stringify(value);if(old.get(id)!==content)changed.push({id,kind,content});}
 changed.push({id:'$selection',kind:'selection',content:JSON.stringify({projectId:checkpoint.projectId,documentId:checkpoint.documentId})});
 const statements:D1PreparedStatement[]=[indexAuthorityFence(env,authorityGuard),env.DB.prepare(`INSERT INTO creation_index_fences(id) VALUES(CASE WHEN NOT EXISTS(SELECT 1 FROM creation_index_projection e LEFT JOIN private_content c ON c.content_id=e.content_id WHERE e.partition_key=? AND e.generation=? AND COALESCE((${bodyGuard.sql}),0)=0) THEN 1 ELSE NULL END)`).bind(l.partition_key,l.generation,...bodyGuard.bindings)];
 for(const item of changed){if(new TextEncoder().encode(item.content).length>1_000_000)throw new CreationProviderError('index_entity_capacity',0,true);const stored=await preparePrivateContent(env,p.ownerId,'creation-search-source',item.content,scope,undefined,{sql:leaseGuard,bindings:leaseBindings(l)});statements.push(...stored.statements,env.DB.prepare(`INSERT OR REPLACE INTO creation_index_projection(partition_key,generation,entity_id,kind,content_id) SELECT ?,?,?,?,? WHERE ${leaseGuard}`).bind(l.partition_key,l.generation,item.id,item.kind,stored.contentId,...leaseBindings(l)));}
 const last=Number(rows.results.at(-1)?.source_sequence??head),done=last>=head;
 if(done)statements.push(env.DB.prepare(`INSERT OR REPLACE INTO creation_index_work(job_key,kind,partition_key,generation,priority) SELECT ?,'materialize',?,?,5 WHERE ${leaseGuard}`).bind('materialize:'+l.partition_key,l.partition_key,l.generation,...leaseBindings(l)));
 statements.push(checkpointIndexJob(env.DB,l,JSON.stringify({after:last,head}),done),env.DB.prepare('DELETE FROM creation_index_fences'));await assertIndexLease(env.DB,l);await env.DB.batch(statements);
}
/** Deterministic container representations retain complete eligible descendant prose.
 * The cursor/budget bounds reads; an over-capacity container is held, never truncated. */
async function containerText(env:WorkerEnv,l:IndexLease,p:Awaited<ReturnType<typeof indexAuthority>>['partition'],kind:string,id:string,title:string){
 const guard=privateIndexBodyGuard(p),parts=[title],dependencies:Array<{id:string;events:unknown}>=[];
 let after='',bytes=new TextEncoder().encode(title).length;
 for(;;){const page=await env.DB.prepare(`SELECT e.entity_id,c.content FROM creation_index_projection e JOIN private_content c ON c.content_id=e.content_id WHERE e.partition_key=? AND e.generation=? AND e.kind='blocks' AND e.entity_id>? AND ${guard.sql} AND json_extract(c.content,'$.projectId')=? AND COALESCE(json_extract(c.content,'$.removed'),0)=0 AND ((?='project' AND (COALESCE(json_extract(c.content,'$.projectOwned'),0)=1 OR json_extract(c.content,'$.scope')<>'document')) OR EXISTS(SELECT 1 FROM json_each(c.content,'$.documentUses') u JOIN creation_index_projection d ON d.partition_key=e.partition_key AND d.generation=e.generation AND d.entity_id='documents:'||json_extract(u.value,'$.documentId') JOIN private_content dc ON dc.content_id=d.content_id AND dc.redacted_at IS NULL AND dc.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE COALESCE(json_extract(dc.content,'$.removed'),0)=0 AND (?='project' OR json_extract(u.value,'$.documentId')=?))) ORDER BY e.entity_id LIMIT 32`).bind(l.partition_key,l.generation,after,...guard.bindings,p.projectId,kind,kind,id).all<{entity_id:string;content:string}>();
  for(const row of page.results){after=row.entity_id;const block=JSON.parse(row.content);if(block.removed||block.projectId!==p.projectId)continue;
   if(p.projectAccessId&&!await env.DB.prepare("SELECT 1 FROM project_resource_scopes WHERE project_access_id=? AND resource_kind='block' AND resource_id=? AND visibility='collaborative_output'").bind(p.projectAccessId,block.id).first())continue;
   const text=[block.properties.label??block.handle??'',block.type??'',block.properties.text??block.properties.description??''].filter(Boolean).join('\n');
   bytes+=new TextEncoder().encode(text).length+2;if(bytes>1_000_000)throw new CreationProviderError('index_container_capacity',0,true);
   parts.push(text);dependencies.push({id:block.id,events:block.sourceEvents??block.lastSequence});
  }if(page.results.length<32)break;
 }
 return {text:parts.join('\n\n'),dependencies};
}
export async function materializePage(env:WorkerEnv,l:IndexLease){
 const {partition:p,guard:authorityGuard}=await indexAuthority(env,l.partition_key);if(Number(p.indexVersion)!==l.generation)throw new Error('creation_lease_lost');
 const bodyGuard=privateIndexBodyGuard(p);
 const valid=await env.DB.prepare(`SELECT 1 FROM creation_index_projection e LEFT JOIN private_content c ON c.content_id=e.content_id WHERE e.partition_key=? AND e.generation=? AND COALESCE((${bodyGuard.sql}),0)=0 LIMIT 1`).bind(l.partition_key,l.generation,...bodyGuard.bindings).first();if(valid)throw new CreationProviderError('index_checkpoint_expired',0,true);
 const page=await env.DB.prepare(`SELECT e.entity_id,e.kind,c.content FROM creation_index_projection e JOIN private_content c ON c.content_id=e.content_id AND c.redacted_at IS NULL AND c.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE e.partition_key=? AND e.generation=? AND e.entity_id>? AND e.kind IN('projects','documents','blocks') AND ${bodyGuard.sql} ORDER BY e.entity_id LIMIT 16`).bind(l.partition_key,l.generation,l.cursor,...bodyGuard.bindings).all<{entity_id:string;kind:string;content:string}>();
 const version=await decisionHash({partition:l.partition_key,indexVersion:l.generation}),index=new D1CreationSearchIndex(env.DB),statements:D1PreparedStatement[]=[indexAuthorityFence(env,authorityGuard),env.DB.prepare(`INSERT INTO creation_index_fences(id) VALUES(CASE WHEN NOT EXISTS(SELECT 1 FROM creation_index_projection e LEFT JOIN private_content c ON c.content_id=e.content_id WHERE e.partition_key=? AND e.generation=? AND COALESCE((${bodyGuard.sql}),0)=0) THEN 1 ELSE NULL END)`).bind(l.partition_key,l.generation,...bodyGuard.bindings)];
 const scope=p.projectAccessId?{organizationId:p.organizationId!,projectAccessId:p.projectAccessId,projectId:p.projectId,ownerUserId:p.ownerId,actorUserId:p.ownerId}:undefined;
 for(const item of page.results){const v=JSON.parse(item.content);if((item.kind==='projects'?v.id:v.projectId)!==p.projectId||v.removed)continue;
  const kind=item.kind==='blocks'?'idea':item.kind==='documents'?'document':'project';
  if(p.projectAccessId&&kind!=='project'&&!await env.DB.prepare("SELECT 1 FROM project_resource_scopes WHERE project_access_id=? AND resource_kind=? AND resource_id=? AND visibility='collaborative_output'").bind(p.projectAccessId,kind==='idea'?'block':'document',v.id).first())continue;
  const locations:HydratedCreationCandidate['locations']=[];
  if(kind==='idea'){for(const use of v.documentUses??[]){const d=await env.DB.prepare(`SELECT c.content FROM creation_index_projection e JOIN private_content c ON c.content_id=e.content_id AND c.redacted_at IS NULL WHERE e.partition_key=? AND e.generation=? AND e.entity_id=? AND ${bodyGuard.sql}`).bind(l.partition_key,l.generation,'documents:'+use.documentId,...bodyGuard.bindings).first<{content:string}>();if(d){const doc=JSON.parse(d.content);if(!doc.removed)locations.push({documentId:doc.id,title:doc.title});}}if(!v.projectOwned&&v.scope==='document'&&!locations.length)continue;}
  else locations.push(kind==='document'?{documentId:v.id,title:v.title}:{title:v.name});
  const title=String(kind==='idea'?v.properties.label??v.handle??'':v.title??v.name??'');
  const representation=kind==='idea'?{text:String(v.properties.text??v.properties.description??title),dependencies:[]}:await containerText(env,l,p,kind,v.id,title);
  const {text,dependencies}=representation;
  const hash=await decisionHash({title,text,locations,type:v.type??null}),revision=await decisionHash({events:v.sourceEvents??v.lastSequence,dependencies,hash});
  const source:HydratedCreationCandidate={id:v.id,kind,projectId:p.projectId,custody:p.custody,title,text,...(kind==='idea'?{type:v.type}:{}),locations,contentHash:hash,revision};
  const stored=await preparePrivateContent(env,p.ownerId,'creation-search-source',JSON.stringify(source),scope,undefined,{sql:leaseGuard,bindings:leaseBindings(l)});
  // Atomic batch guard aborts the entire batch if publication lost its lease.
  statements.push(...stored.statements,...await index.recordStatements({...p,contentVersion:version},source,stored.contentId));
 }
 const done=page.results.length<16;
 if(done){statements.push(env.DB.prepare('UPDATE creation_search_records SET tombstone=1 WHERE partition_key=? AND source_version<>?').bind(l.partition_key,version),env.DB.prepare(`UPDATE creation_search_partitions SET content_version=?,expected=(SELECT COUNT(*) FROM creation_search_records WHERE partition_key=? AND tombstone=0 AND source_version=?),backfill_complete=1,invalidated=0 WHERE partition_key=? AND index_version=? AND ${leaseGuard}`).bind(version,l.partition_key,version,l.partition_key,l.generation,...leaseBindings(l)),env.DB.prepare(`INSERT OR REPLACE INTO creation_index_work(job_key,kind,partition_key,generation,priority) SELECT ?,'embedding',?,?,6 WHERE ${leaseGuard}`).bind('embedding:'+l.partition_key,l.partition_key,l.generation,...leaseBindings(l)));}
 statements.unshift(env.DB.prepare(`INSERT INTO creation_index_fences(id) VALUES(CASE WHEN ${leaseGuard} AND EXISTS(SELECT 1 FROM creation_search_partitions WHERE partition_key=? AND index_version=?) THEN 1 ELSE NULL END)`).bind(...leaseBindings(l),l.partition_key,l.generation));
 statements.push(checkpointIndexJob(env.DB,l,page.results.at(-1)?.entity_id??l.cursor,done),env.DB.prepare('DELETE FROM creation_index_fences'));await env.DB.batch(statements);
}

import {carryIncrementalVectors} from './creation-index-incremental-vectors.ts';
import {prepareIncrementalProjection,incrementalMaterialization,captureCreationSnapshots,type CreationProjectionCursor} from './creation-index-incremental.ts';
import {BLOCK_TYPES} from '../src/model/block-types.ts';
import {prepareProjectionDeltaStage} from './creation-index-projection-stage.ts';
import {prepareCreationProjectionRouting,prepareCreationWithdrawalOverlay,creationProjectionRoutingPredicate} from './creation-index-routing.ts';
import {genericIdeaReferences} from '../src/model/project-ideas.ts';
import {normalizeActionBlockReferences,normalizeCombinedContextMembership} from '../src/model/combined-context.ts';
import {richDocumentFromRuns} from '../src/still/vendor/elements/rich-document.js';
import type {CreativeBlock} from '../src/model/events.ts';
import {privateIndexBodyGuard} from './creation-index-private.ts';
import type {WorkerEnv} from './runtime.ts';
import {createCreativeEventFold,type CreationAuthoringCheckpoint,type CreativeEvent} from '../src/model/events.ts';
import {serializeEvent} from './event-read-primitives.ts';
import {nativePrivateContentCleanupEnvironment} from './memory-native-boundary.ts';
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
/** Renewal lead is capped by actual assigned lifetime; a fresh one-day body is
 * not perpetually due. The predicate never extends an existing expiry. */
export const CREATION_BODY_RENEWAL_DUE_SQL="unixepoch(c.expires_at)-unixepoch()<=MIN(86400,MAX(60,(unixepoch(c.expires_at)-unixepoch(c.created_at))/10))";
/** Only structural replay metadata survives current withdrawal. In particular,
 * dependency identities retain earlier attachment effects without any title,
 * handle, rich-text prose or arbitrary property value in a private body. */
function withdrawnSkeleton(block:CreativeBlock):CreativeBlock {
 const props=block.properties,properties:Record<string,unknown>={};
 if(Object.hasOwn(props,'rich_text_body'))properties.rich_text_body={schemaVersion:1,document:richDocumentFromRuns(genericIdeaReferences(props).map((ref,index)=>({kind:'token' as const,id:String(index),type:'still-idea-reference',text:'_',label:'_',data:{schemaVersion:1,kind:'idea-reference',projectId:ref.projectId,blockId:ref.blockId}})))};
 if(Object.hasOwn(props,'block_references'))properties.block_references=normalizeActionBlockReferences(props.block_references).map(ref=>({block_id:ref.block_id,handle:'_',role:ref.role}));
 if(typeof props.context_set_root_id==='string')properties.context_set_root_id=props.context_set_root_id;
 const membership=(value:unknown)=>{const normalized=normalizeCombinedContextMembership(value);return normalized?{context_set_id:normalized.contextSetId}:null;};
 if(Array.isArray(props.combined_context_memberships))properties.combined_context_memberships=props.combined_context_memberships.map(membership).filter(Boolean);
 if(props.combined_context)properties.combined_context=membership(props.combined_context)??{};
 if(typeof props.context_set_id==='string')properties.context_set_id=props.context_set_id;
 if(props.copied_as_context_set===true)properties.copied_as_context_set=true;
 if(props.reference_set_kind==='storyboard')properties.reference_set_kind='storyboard';
 return {id:block.id,projectId:block.projectId,documentId:block.documentId,canvasId:block.canvasId,scope:block.scope,type:BLOCK_TYPES.some(definition=>definition.type===block.type)?block.type:'text',handle:'',position:block.position,removed:block.removed,locked:block.locked,properties,sourceEvents:[...block.sourceEvents],...(block.originDocumentId!==undefined?{originDocumentId:block.originDocumentId}:{}),...(block.projectOwned!==undefined?{projectOwned:block.projectOwned}:{}),...(block.documentUses?{documentUses:block.documentUses.map(use=>({documentId:use.documentId,position:use.position,sourceEvents:[...use.sourceEvents],...(use.weight!==undefined?{weight:use.weight}:{}),...(use.inherited!==undefined?{inherited:use.inherited}:{})}))}:{})};
}
export async function projectionPage(env:WorkerEnv,l:IndexLease){
 const writeEnv=nativePrivateContentCleanupEnvironment(env);
 const authority=await indexAuthority(env,l.partition_key),{partition:p,owner,guard:authorityGuard}=authority;if(Number(p.indexVersion)!==l.generation)throw new Error('creation_lease_lost');
 const bodyGuard=privateIndexBodyGuard(p);
 let cursor=l.cursor?JSON.parse(l.cursor) as CreationProjectionCursor:null;
 const head=cursor?.head??Number((await env.DB.prepare(p.projectAccessId?'SELECT COALESCE(MAX(project_sequence),0) AS n FROM project_event_scopes WHERE project_access_id=?':'SELECT COALESCE(MAX(sequence),0) AS n FROM events WHERE stream_id=?').bind(p.projectAccessId??owner.streamId).first<{n:number}>())?.n??0);
 const ownerHead=p.projectAccessId?(cursor?.ownerHead??Number((await env.DB.prepare('SELECT COALESCE(MAX(sequence),0) AS n FROM events WHERE stream_id=?').bind(owner.streamId).first<{n:number}>())?.n??0)):head;
 if(!cursor){
  cursor=await prepareIncrementalProjection(env,l,authority,head,ownerHead);
  if(!cursor)await env.DB.batch([indexAuthorityFence(env,authorityGuard),env.DB.prepare(`UPDATE creation_index_objects SET state='retired',erase_due=COALESCE(erase_due,unixepoch()+300) WHERE partition_key=? AND state='suspended' AND ${leaseGuard} AND EXISTS(SELECT 1 FROM creation_search_partitions WHERE partition_key=? AND index_version=?)`).bind(l.partition_key,...leaseBindings(l),l.partition_key,l.generation),env.DB.prepare('DELETE FROM creation_index_fences')]);
 }
 // Complete a durable metadata-only routing pass before skipping any history.
 if(!cursor?.routeComplete){
  const route=await prepareCreationProjectionRouting(env,l,{head,after:cursor?.routingAfter??0,projectId:p.projectId,streamId:owner.streamId,projectAccessId:p.projectAccessId,ownerId:p.ownerId});
  await env.DB.batch([indexAuthorityFence(env,authorityGuard),env.DB.prepare(`INSERT INTO creation_index_fences(id) VALUES(CASE WHEN ${leaseGuard} AND EXISTS(SELECT 1 FROM creation_search_partitions WHERE partition_key=? AND index_version=?) THEN 1 ELSE NULL END)`).bind(...leaseBindings(l),l.partition_key,l.generation),...route.statements,checkpointIndexJob(env.DB,l,JSON.stringify({...cursor,after:cursor?.after??0,head,ownerHead,routingAfter:route.after,routeComplete:route.done})),env.DB.prepare('DELETE FROM creation_index_fences')]);return;
 }
 // SQL transport bound applies BEFORE bytes enter the isolate. Source generation guards
 // certify mutations/private withdrawal throughout all pages, not just the terminal read.
 const join=p.projectAccessId?'JOIN project_event_scopes scope ON scope.event_id=e.event_id':'';
 // A shared scope can omit a later owner removal or move. Owner metadata can
 // only deny retention; it never grants shared visibility or returns owner prose.
 if(p.projectAccessId&&!cursor?.withdrawalComplete){
  const overlay=await prepareCreationWithdrawalOverlay(env,l,{head:ownerHead,after:cursor?.withdrawalAfter??0,streamId:owner.streamId,projectAccessId:p.projectAccessId,projectId:p.projectId});
  await env.DB.batch([indexAuthorityFence(env,authorityGuard),env.DB.prepare(`INSERT INTO creation_index_fences(id) VALUES(CASE WHEN ${leaseGuard} AND EXISTS(SELECT 1 FROM creation_search_partitions WHERE partition_key=? AND index_version=?) THEN 1 ELSE NULL END)`).bind(...leaseBindings(l),l.partition_key,l.generation),...overlay.statements,checkpointIndexJob(env.DB,l,JSON.stringify({...cursor,after:cursor?.after??0,head,ownerHead,withdrawalAfter:overlay.after,withdrawalComplete:overlay.done})),env.DB.prepare('DELETE FROM creation_index_fences')]);return;
 }
 const sequence=p.projectAccessId?'scope.project_sequence':'e.sequence';
 const rows=await env.DB.prepare(`WITH page AS MATERIALIZED(SELECT e.*,${sequence} AS source_sequence,COALESCE(secret.private_json,e.payload) AS body FROM events e ${join} LEFT JOIN event_private_payloads secret ON secret.private_event_id=e.event_id AND secret.redacted_at IS NULL WHERE ${p.projectAccessId?'scope.project_access_id=? AND scope.owner_user_id=?':'e.stream_id=?'} AND e.type IN(SELECT value FROM json_each(?)) AND ${creationProjectionRoutingPredicate} AND ${sequence}>? AND ${sequence}<=? ORDER BY ${sequence} LIMIT 32), sized AS(SELECT *,SUM(length(CAST(body AS BLOB))+512) OVER(ORDER BY source_sequence) AS total_bytes FROM page) SELECT *,CASE WHEN length(CAST(body AS BLOB))<=1000000 THEN body END AS private_json,(SELECT COUNT(*) FROM page) AS page_count,(SELECT MAX(source_sequence) FROM page) AS page_last FROM sized WHERE total_bytes<=1000000 OR source_sequence=(SELECT MIN(source_sequence) FROM page) ORDER BY source_sequence`).bind(...(p.projectAccessId?[p.projectAccessId,p.ownerId]:[owner.streamId]),JSON.stringify(authoringTypes),l.partition_key,l.generation,cursor?.after??0,head).all<Record<string,unknown>>();
 if(rows.results.some(r=>r.private_json===null))throw new CreationProviderError('index_event_capacity',0,true);
 // Ordinary authoring changes only need their addressed Blocks. Operations that
 // traverse relations/Document descendants retain the complete bounded checkpoint.
 // Project/Document/selection state stays present for legacy implicit scope.
 const events=rows.results.map(row=>({...serializeEvent(row),sequence:Number(row.source_sequence)}) as CreativeEvent);
 const needsAllBlocks=events.some(event=>['DocumentRemoved','BlockDocumentAttached','BlockRelationAdded','BlockRelationRemoved'].includes(event.type));
 const addressedBlocks=JSON.stringify([...new Set(events.map(event=>event.payload.block_id).filter(value=>typeof value==='string').map(value=>'blocks:'+value))]);
 const seedFilter=needsAllBlocks?'1':"(e.kind IN('projects','documents','selection') OR e.entity_id IN(SELECT value FROM json_each(?)))";
 const seedBindings=needsAllBlocks?[]:[addressedBlocks];
 const seed=empty(),old=new Map<string,string>();let after='',bytes=0,checkpointReads=0;
 for(;;){
  if(++checkpointReads>256)throw new CreationProviderError('index_projection_capacity',0,true);
  const saved=await env.DB.prepare(`WITH checkpoint AS(SELECT e.entity_id,e.kind,c.content FROM creation_index_projection e JOIN private_content c ON c.content_id=e.content_id WHERE e.partition_key=? AND e.generation=? AND e.kind NOT LIKE 'stage:%' AND ${bodyGuard.sql} UNION ALL SELECT entity_id,'blocks' AS kind,metadata AS content FROM creation_index_replay_skeletons WHERE partition_key=? AND generation=? AND substr(entity_id,1,7)<>'$stage:') SELECT e.* FROM checkpoint e WHERE e.entity_id>? AND ${seedFilter} ORDER BY e.entity_id LIMIT 32`).bind(l.partition_key,l.generation,...bodyGuard.bindings,l.partition_key,l.generation,after,...seedBindings).all<{entity_id:string;kind:string;content:string}>();
  if(!saved.results.length)break;
  for(const row of saved.results){bytes+=new TextEncoder().encode(row.content).length;if(bytes>budget)throw new CreationProviderError('index_projection_capacity',0,true);old.set(row.entity_id,row.content);const value=JSON.parse(row.content);if(row.kind==='selection'){seed.projectId=value.projectId;seed.documentId=value.documentId;}else(seed[row.kind as 'projects'|'documents'|'blocks'|'relations'] as unknown[]).push(value);after=row.entity_id;}
  if(saved.results.length<32)break;
 }
 const expectedCheckpoint=await env.DB.prepare(`WITH checkpoint AS(SELECT entity_id,kind FROM creation_index_projection WHERE partition_key=? AND generation=? AND kind NOT LIKE 'stage:%' UNION ALL SELECT entity_id,'blocks' AS kind FROM creation_index_replay_skeletons WHERE partition_key=? AND generation=? AND substr(entity_id,1,7)<>'$stage:') SELECT COUNT(*) AS n FROM checkpoint e WHERE ${seedFilter}`).bind(l.partition_key,l.generation,l.partition_key,l.generation,...seedBindings).first<{n:number}>();
 if(expectedCheckpoint?.n!==old.size)throw new CreationProviderError('index_checkpoint_expired',0,true);
 if(cursor?.after&&old.size===0)throw new CreationProviderError('index_checkpoint_expired',0,true);
 const fold=createCreativeEventFold(Infinity,'',p.projectId,undefined,seed);
 for(const event of events)fold.accept(event);
 const checkpoint=fold.authoringCheckpoint();
 const scope=p.projectAccessId?{organizationId:p.organizationId!,projectAccessId:p.projectAccessId,projectId:p.projectId,ownerUserId:p.ownerId,actorUserId:p.ownerId}:undefined;
 const withdrawn=new Set((await env.DB.prepare('SELECT block_id FROM creation_index_block_routes WHERE partition_key=? AND generation=? AND (removed=1 OR current_owner_removed=1 OR current_owner_project_id IS NOT NULL AND current_owner_project_id<>?) AND block_id IN(SELECT value FROM json_each(?))').bind(l.partition_key,l.generation,p.projectId,JSON.stringify(checkpoint.blocks.map(block=>block.id))).all<{block_id:string}>()).results.map(row=>row.block_id));
 const changed:Array<{id:string;kind:string;content:string;storage?:'skeleton'}>=[];
 for(const kind of ['projects','documents','blocks','relations'] as const)for(const value of checkpoint[kind]){const skeleton=kind==='blocks'&&withdrawn.has(value.id),id=kind+':'+value.id,content=JSON.stringify(skeleton?withdrawnSkeleton(value as CreativeBlock):value);if(old.get(id)!==content)changed.push({id,kind,content,...(skeleton?{storage:'skeleton' as const}:{})});}
 changed.push({id:'$selection',kind:'selection',content:JSON.stringify({projectId:checkpoint.projectId,documentId:checkpoint.documentId})});
 // A short SQL page proves there are no further eligible events only when its
 // final row survived the byte transport bound. Returned row count alone cannot
 // distinguish terminal history from a partial 1 MB transport page.
 const finalRow=rows.results.at(-1),last=Number(finalRow?.source_sequence??head),done=last>=head||!!finalRow&&Number(finalRow.page_count)<32&&last===Number(finalRow.page_last);
 const staged=await prepareProjectionDeltaStage(env,l,{partition:p,authorityGuard,changed,checkpointReads,last,head,cursor:{...cursor,after:cursor?.after??0,head,routeComplete:true,routingAfter:head}});
 if(staged){
  if(done&&staged.complete)staged.statements.push(env.DB.prepare(`INSERT OR REPLACE INTO creation_index_work(job_key,kind,partition_key,generation,priority) SELECT ?,'materialize',?,?,5 WHERE ${leaseGuard}`).bind('materialize:'+l.partition_key,l.partition_key,l.generation,...leaseBindings(l)));
  staged.statements.push(checkpointIndexJob(env.DB,l,staged.cursor,done&&staged.complete),env.DB.prepare('DELETE FROM creation_index_fences'));await env.DB.batch(staged.statements);return;
 }
 const statements:D1PreparedStatement[]=[indexAuthorityFence(env,authorityGuard),env.DB.prepare(`INSERT INTO creation_index_fences(id) VALUES(CASE WHEN NOT EXISTS(SELECT 1 FROM creation_index_projection e LEFT JOIN private_content c ON c.content_id=e.content_id WHERE e.partition_key=? AND e.generation=? AND COALESCE((${bodyGuard.sql}),0)=0) THEN 1 ELSE NULL END)`).bind(l.partition_key,l.generation,...bodyGuard.bindings)];
 for(const item of changed){if(new TextEncoder().encode(item.content).length>1_000_000)throw new CreationProviderError('index_entity_capacity',0,true);if(item.storage==='skeleton'){statements.push(env.DB.prepare('INSERT OR REPLACE INTO creation_index_replay_skeletons(partition_key,generation,entity_id,metadata) VALUES(?,?,?,?)').bind(l.partition_key,l.generation,item.id,item.content),env.DB.prepare('DELETE FROM creation_index_projection WHERE partition_key=? AND generation=? AND entity_id=?').bind(l.partition_key,l.generation,item.id));continue;}if(new TextEncoder().encode(item.content).length>1_000_000)throw new CreationProviderError('index_entity_capacity',0,true);const stored=await preparePrivateContent(writeEnv,p.ownerId,'creation-search-source',item.content,scope,undefined,{sql:leaseGuard,bindings:leaseBindings(l)});statements.push(...stored.statements,env.DB.prepare(`INSERT OR REPLACE INTO creation_index_projection(partition_key,generation,entity_id,kind,content_id) SELECT ?,?,?,?,? WHERE ${leaseGuard}`).bind(l.partition_key,l.generation,item.id,item.kind,stored.contentId,...leaseBindings(l)));}
 if(done)statements.push(env.DB.prepare(`INSERT OR REPLACE INTO creation_index_work(job_key,kind,partition_key,generation,priority) SELECT ?,'materialize',?,?,5 WHERE ${leaseGuard}`).bind('materialize:'+l.partition_key,l.partition_key,l.generation,...leaseBindings(l)));
 statements.push(checkpointIndexJob(env.DB,l,JSON.stringify({...cursor,after:last,head,ownerHead,routeComplete:true,routingAfter:head}),done),env.DB.prepare('DELETE FROM creation_index_fences'));await assertIndexLease(env.DB,l);await env.DB.batch(statements);
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
 const writeEnv=nativePrivateContentCleanupEnvironment(env);
 const {partition:p,guard:authorityGuard}=await indexAuthority(env,l.partition_key);if(Number(p.indexVersion)!==l.generation)throw new Error('creation_lease_lost');
 const bodyGuard=privateIndexBodyGuard(p);
 const valid=await env.DB.prepare(`SELECT 1 FROM creation_index_projection e LEFT JOIN private_content c ON c.content_id=e.content_id WHERE e.partition_key=? AND e.generation=? AND COALESCE((${bodyGuard.sql}),0)=0 LIMIT 1`).bind(l.partition_key,l.generation,...bodyGuard.bindings).first();if(valid)throw new CreationProviderError('index_checkpoint_expired',0,true);
 const incremental=await incrementalMaterialization(env,l);
 const page=await env.DB.prepare(`SELECT e.entity_id,e.kind,c.content FROM creation_index_projection e JOIN private_content c ON c.content_id=e.content_id AND c.redacted_at IS NULL AND c.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE e.partition_key=? AND e.generation=? AND e.entity_id>? AND e.kind IN('projects','documents','blocks') AND (? IS NULL OR e.entity_id IN(SELECT value FROM json_each(?))) AND CASE WHEN e.kind='projects' THEN json_extract(c.content,'$.id') ELSE json_extract(c.content,'$.projectId') END=? AND ${bodyGuard.sql} ORDER BY e.entity_id LIMIT 16`).bind(l.partition_key,l.generation,l.cursor,incremental?JSON.stringify(incremental.materializeIds):null,incremental?JSON.stringify(incremental.materializeIds):null,p.projectId,...bodyGuard.bindings).all<{entity_id:string;kind:string;content:string}>();
 const version=await decisionHash({partition:l.partition_key,indexVersion:l.generation}),index=new D1CreationSearchIndex(env.DB),statements:D1PreparedStatement[]=[indexAuthorityFence(env,authorityGuard),env.DB.prepare(`INSERT INTO creation_index_fences(id) VALUES(CASE WHEN NOT EXISTS(SELECT 1 FROM creation_index_projection e LEFT JOIN private_content c ON c.content_id=e.content_id WHERE e.partition_key=? AND e.generation=? AND COALESCE((${bodyGuard.sql}),0)=0) THEN 1 ELSE NULL END)`).bind(l.partition_key,l.generation,...bodyGuard.bindings)];
 if(incremental){
  statements.push(env.DB.prepare(`INSERT INTO creation_index_fences(id) VALUES(CASE WHEN EXISTS(SELECT 1 FROM creation_index_snapshot_heads WHERE partition_key=? AND generation=? AND head=? AND owner_head=?) THEN 1 ELSE NULL END)`).bind(l.partition_key,incremental.baseGeneration,incremental.baseHead,incremental.baseOwnerHead));
  // Unchanged records retain their exact body and original retention deadline.
  statements.push(env.DB.prepare(`INSERT INTO creation_index_fences(id) VALUES(CASE WHEN NOT EXISTS(SELECT 1 FROM creation_search_records r LEFT JOIN private_content c ON c.content_id=r.content_id WHERE r.partition_key=? AND r.tombstone=0 AND COALESCE((${bodyGuard.sql}),0)=0) THEN 1 ELSE NULL END)`).bind(l.partition_key,...bodyGuard.bindings),env.DB.prepare('UPDATE creation_search_records SET source_version=? WHERE partition_key=? AND tombstone=0 AND source_version=?').bind(version,l.partition_key,incremental.baseVersion));
 }
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
  // Reuse an unchanged body only while its original private retention sidecars
  // remain valid. Renewal deliberately takes the fresh-content path.
  const reusable=await env.DB.prepare(`SELECT r.content_id FROM creation_search_records r JOIN private_content c ON c.content_id=r.content_id WHERE r.partition_key=? AND r.source_id=? AND r.revision=? AND r.content_hash=? AND ${bodyGuard.sql} AND NOT (${CREATION_BODY_RENEWAL_DUE_SQL})`).bind(l.partition_key,source.id,revision,hash,...bodyGuard.bindings).first<{content_id:string}>();
  if(reusable){
   statements.push(env.DB.prepare(`INSERT INTO creation_index_fences(id) VALUES(CASE WHEN EXISTS(SELECT 1 FROM private_content c WHERE c.content_id=? AND ${bodyGuard.sql} AND NOT (${CREATION_BODY_RENEWAL_DUE_SQL})) THEN 1 ELSE NULL END)`).bind(reusable.content_id,...bodyGuard.bindings),env.DB.prepare('UPDATE creation_search_records SET source_version=?,tombstone=0 WHERE partition_key=? AND source_id=? AND revision=? AND content_hash=? AND content_id=?').bind(version,l.partition_key,source.id,revision,hash,reusable.content_id));
   continue;
  }
  const stored=await preparePrivateContent(writeEnv,p.ownerId,'creation-search-source',JSON.stringify(source),scope,undefined,{sql:leaseGuard,bindings:leaseBindings(l)});
  // Atomic batch guard aborts the entire batch if publication lost its lease.
  statements.push(...stored.statements,...await index.recordStatements({...p,contentVersion:version},source,stored.contentId));
 }
 const done=page.results.length<16;
 if(done){
  const projection=await env.DB.prepare("SELECT cursor FROM creation_index_work WHERE job_key=? AND generation=? AND state='done'").bind('projection:'+l.partition_key,l.generation).first<{cursor:string}>();
  const completed=projection?.cursor?JSON.parse(projection.cursor) as CreationProjectionCursor:null;
  if(!completed)throw new CreationProviderError('index_checkpoint_missing',0,true);
  if(incremental)statements.push(...carryIncrementalVectors(env,l,p,version));
  statements.push(...captureCreationSnapshots(env,l,p.projectId,version,completed.head,completed.ownerHead??completed.head));
  if(incremental)for(const id of incremental.ideaIds)statements.push(env.DB.prepare(`INSERT OR REPLACE INTO creation_index_work(job_key,kind,partition_key,generation,cursor,priority) SELECT ?,'embedding',?,?,?,1 WHERE ${leaseGuard}`).bind('embedding-target:'+l.partition_key+':'+id,l.partition_key,l.generation,id,...leaseBindings(l)));
  // Checkpoints are private replay scratch, not a retained copy of withdrawn prose.
  // All source/container reads for this generation have finished. Future edits,
  // restores and renewal start a fresh generation from canonical authoring history.
  statements.push(env.DB.prepare('DELETE FROM creation_index_block_routes WHERE partition_key=? AND generation=?').bind(l.partition_key,l.generation),env.DB.prepare('DELETE FROM creation_index_replay_skeletons WHERE partition_key=? AND generation=?').bind(l.partition_key,l.generation),env.DB.prepare('DELETE FROM creation_index_projection WHERE partition_key=? AND generation=?').bind(l.partition_key,l.generation),env.DB.prepare('UPDATE creation_search_records SET tombstone=1 WHERE partition_key=? AND source_version<>?').bind(l.partition_key,version),env.DB.prepare(`UPDATE creation_search_partitions SET content_version=?,expected=(SELECT COUNT(*) FROM creation_search_records WHERE partition_key=? AND tombstone=0 AND source_version=?),backfill_complete=1,invalidated=0 WHERE partition_key=? AND index_version=? AND ${leaseGuard}`).bind(version,l.partition_key,version,l.partition_key,l.generation,...leaseBindings(l)),env.DB.prepare(`INSERT OR REPLACE INTO creation_index_work(job_key,kind,partition_key,generation,priority) SELECT ?,'embedding',?,?,6 WHERE ${leaseGuard}`).bind('embedding:'+l.partition_key,l.partition_key,l.generation,...leaseBindings(l)));}
 statements.unshift(env.DB.prepare(`INSERT INTO creation_index_fences(id) VALUES(CASE WHEN ${leaseGuard} AND EXISTS(SELECT 1 FROM creation_search_partitions WHERE partition_key=? AND index_version=?) THEN 1 ELSE NULL END)`).bind(...leaseBindings(l),l.partition_key,l.generation));
 statements.push(checkpointIndexJob(env.DB,l,page.results.at(-1)?.entity_id??l.cursor,done),env.DB.prepare('DELETE FROM creation_index_fences'));await env.DB.batch(statements);
}

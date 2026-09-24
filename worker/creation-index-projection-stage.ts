import type {WorkerEnv} from './runtime.ts';
import type {Partition} from './creation-search-api.ts';
import type {IndexLease} from './creation-index-schema.ts';
import {leaseGuard,leaseBindings} from './creation-index-schema.ts';
import {indexAuthorityFence} from './creation-index-authority.ts';
import {privateIndexBodyGuard} from './creation-index-private.ts';
import {nativePrivateContentCleanupEnvironment} from './memory-native-boundary.ts';
import {preparePrivateContent} from './private-content-storage.ts';
import {decisionHash} from './still-decision-store.ts';
import {CreationProviderError} from './creation-provider-http.ts';

export type ProjectionDeltaItem={id:string;kind:string;content:string;storage?:'skeleton'};
type StageCursor={hash:string;count:number;offset:number;last:number};
/** Stage an already sanitized canonical delta without changing the fold seed. Every
 * continuation recomputes the same frozen page against that unchanged seed. Promotion
 * moves existing pointers in one transaction, so no later fold/materialization can
 * observe half of a Document/relationship fanout. No extra copy of prose is stored. */
export async function prepareProjectionDeltaStage(env:WorkerEnv,l:IndexLease,input:{
 partition:Partition;authorityGuard:{sql:string;bindings:Array<string|number>};
 changed:ProjectionDeltaItem[];checkpointReads:number;last:number;head:number;
 cursor:Record<string,unknown>;
}):Promise<null|{statements:D1PreparedStatement[];cursor:string;complete:boolean}>{
 const {partition:p,changed,last,head}=input;
 const stage=input.cursor.stage as StageCursor|undefined;
 const perEntity=p.projectAccessId?6:3;
 if(!stage&&changed.length*perEntity+input.checkpointReads<=384)return null;
 const fail=(code:string):never=>{throw new CreationProviderError(code,0,true);};
 let bytes=0;const ids=new Set<string>();
 for(const item of changed){const size=new TextEncoder().encode(item.content).length;bytes+=size;
  if(size>1_000_000||bytes>16_000_000)fail('index_projection_stage_capacity');
  if(ids.has(item.id)||item.id.startsWith('$stage:')||!['projects','documents','blocks','relations','selection'].includes(item.kind))fail('index_projection_stage_invalid');ids.add(item.id);
 }
 const hash=await decisionHash({generation:l.generation,after:input.cursor.after??0,head,last,changed});
 if(stage&&(!Number.isSafeInteger(stage.offset)||stage.offset<0||stage.offset>=changed.length||stage.hash!==hash||stage.count!==changed.length||stage.last!==last))fail('index_projection_stage_changed');
 const offset=stage?.offset??0;
 const limit=Math.min(128,Math.floor((384-input.checkpointReads)/perEntity));if(limit<1)fail('index_projection_stage_capacity');
 const next=Math.min(changed.length,offset+limit),complete=next===changed.length;
 const bodyGuard=privateIndexBodyGuard(p);
 const stageCount=`(SELECT COUNT(*) FROM creation_index_projection WHERE partition_key=? AND generation=? AND kind LIKE 'stage:%')+(SELECT COUNT(*) FROM creation_index_replay_skeletons WHERE partition_key=? AND generation=? AND entity_id LIKE '$stage:%')`;
 const countBindings=[l.partition_key,l.generation,l.partition_key,l.generation];
 const statements:D1PreparedStatement[]=[indexAuthorityFence(env,input.authorityGuard),
  env.DB.prepare(`INSERT INTO creation_index_fences(id) VALUES(CASE WHEN ${leaseGuard} AND EXISTS(SELECT 1 FROM creation_search_partitions WHERE partition_key=? AND index_version=?) AND ${stageCount}=? THEN 1 ELSE NULL END)`).bind(...leaseBindings(l),l.partition_key,l.generation,...countBindings,offset),
  env.DB.prepare(`INSERT INTO creation_index_fences(id) VALUES(CASE WHEN NOT EXISTS(SELECT 1 FROM creation_index_projection e LEFT JOIN private_content c ON c.content_id=e.content_id WHERE e.partition_key=? AND e.generation=? AND COALESCE((${bodyGuard.sql}),0)=0) THEN 1 ELSE NULL END)`).bind(l.partition_key,l.generation,...bodyGuard.bindings)];
 const writeEnv=nativePrivateContentCleanupEnvironment(env);
 const scope=p.projectAccessId?{organizationId:p.organizationId!,projectAccessId:p.projectAccessId,projectId:p.projectId,ownerUserId:p.ownerId,actorUserId:p.ownerId}:undefined;
 for(const item of changed.slice(offset,next)){
  if(item.storage==='skeleton')statements.push(env.DB.prepare('INSERT OR REPLACE INTO creation_index_replay_skeletons(partition_key,generation,entity_id,metadata) VALUES(?,?,?,?)').bind(l.partition_key,l.generation,'$stage:'+item.id,item.content));
  else{const stored=await preparePrivateContent(writeEnv,p.ownerId,'creation-search-source',item.content,scope,undefined,{sql:leaseGuard,bindings:leaseBindings(l)});
   statements.push(...stored.statements,env.DB.prepare('INSERT OR REPLACE INTO creation_index_projection(partition_key,generation,entity_id,kind,content_id) VALUES(?,?,?,?,?)').bind(l.partition_key,l.generation,'$stage:'+item.id,'stage:'+item.kind,stored.contentId));
  }
 }
 if(complete){
  // Count/eligibility fence also covers this batch's conditional private inserts.
  statements.push(env.DB.prepare(`INSERT INTO creation_index_fences(id) VALUES(CASE WHEN ${stageCount}=? AND NOT EXISTS(SELECT 1 FROM creation_index_projection e LEFT JOIN private_content c ON c.content_id=e.content_id WHERE e.partition_key=? AND e.generation=? AND e.kind LIKE 'stage:%' AND COALESCE((${bodyGuard.sql}),0)=0) THEN 1 ELSE NULL END)`).bind(...countBindings,changed.length,l.partition_key,l.generation,...bodyGuard.bindings),
   env.DB.prepare("DELETE FROM creation_index_replay_skeletons WHERE partition_key=? AND generation=? AND entity_id IN(SELECT substr(entity_id,8) FROM creation_index_projection WHERE partition_key=? AND generation=? AND kind LIKE 'stage:%')").bind(...countBindings),
   env.DB.prepare("DELETE FROM creation_index_projection WHERE partition_key=? AND generation=? AND entity_id IN(SELECT substr(entity_id,8) FROM creation_index_replay_skeletons WHERE partition_key=? AND generation=? AND entity_id LIKE '$stage:%')").bind(...countBindings),
   env.DB.prepare("INSERT OR REPLACE INTO creation_index_projection(partition_key,generation,entity_id,kind,content_id) SELECT partition_key,generation,substr(entity_id,8),substr(kind,7),content_id FROM creation_index_projection WHERE partition_key=? AND generation=? AND kind LIKE 'stage:%'").bind(l.partition_key,l.generation),
   env.DB.prepare("INSERT OR REPLACE INTO creation_index_replay_skeletons(partition_key,generation,entity_id,metadata) SELECT partition_key,generation,substr(entity_id,8),metadata FROM creation_index_replay_skeletons WHERE partition_key=? AND generation=? AND entity_id LIKE '$stage:%'").bind(l.partition_key,l.generation),
   env.DB.prepare("DELETE FROM creation_index_projection WHERE partition_key=? AND generation=? AND kind LIKE 'stage:%'").bind(l.partition_key,l.generation),
   env.DB.prepare("DELETE FROM creation_index_replay_skeletons WHERE partition_key=? AND generation=? AND entity_id LIKE '$stage:%'").bind(l.partition_key,l.generation));
 }
 const {stage:_previous,...baseCursor}=input.cursor;
 return {statements,cursor:JSON.stringify(complete?{...baseCursor,after:last,head}:{...baseCursor,head,stage:{hash,count:changed.length,offset:next,last}}),complete};
}

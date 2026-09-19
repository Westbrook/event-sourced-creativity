import { memoryDigest } from '../src/model/scoped-memory.ts';
import { memoryCanonical } from './memory-sql.ts';
import { nativeMemoryDocumentIdentity } from './memory-native-scope.ts';
import { decodeNativeMemoryResourceEvent, observeNativeMemoryBlockBindings, type NativeMemoryBlockBinding } from './memory-native-blocks.ts';
import { derivationId, derivationInteger } from './memory-derivation-policy.ts';
import type { LiveMemoryEnrollment } from './memory-live-authority.ts';
import type { NativeMemoryContextObserver } from './memory-live-context.ts';
import type { WorkerEnv } from './runtime.ts';

type Observation={eventId:string;sequence:number;eventType:string;relationId:string|null};
type Row=Record<string,unknown>;
export type NativeMemoryRelationBindings={version:1;entries:{eventId:string;relationId:string;scopeKey:string;revision:number;
  state:'linked'|'unlinked';kind:string;stateSha256:string;from:NativeMemoryBlockBinding;to:NativeMemoryBlockBinding;eventIds:string[]}[];unresolved:number};
/** Exact native document-local relationships, never cross-scope permission.
 * The enclosing capture supplies the issued native actor/grant/schema proof,
 * including the relation lifecycle migration, and atomically replays this witness.
 */
async function captureRelations(env:WorkerEnv,e:LiveMemoryEnrollment,observations:readonly Observation[],
  observer:NativeMemoryContextObserver,resolveEndpoints=(observations:Parameters<typeof observeNativeMemoryBlockBindings>[2])=>observeNativeMemoryBlockBindings(env,e,observations,observer)):Promise<NativeMemoryRelationBindings>{
  const selected=observations.filter(row=>['BlockRelationAdded','BlockRelationRemoved'].includes(row.eventType));
  const empty=():NativeMemoryRelationBindings=>({version:1,entries:[],unresolved:selected.length});
  if(!selected.length)return empty();
  const ids=[...new Set(selected.map(row=>row.relationId).filter(derivationId))];if(!ids.length||ids.length>16)return empty();
  const parent=nativeMemoryDocumentIdentity(e);if(!parent)throw Error('memory-relation-scope');
  const db=env.DB,stream='creative:'+e.owner_user_id,through=Math.max(...selected.map(row=>row.sequence));
  const where="event.stream_id=? AND event.sequence<=? AND event.type IN('BlockRelationAdded','BlockRelationRemoved') AND json_extract(event.payload,'$.relation_id') IN(SELECT value FROM json_each(?))",
    bindings=[stream,through,JSON.stringify(ids)];
  const size={sql:`SELECT COUNT(*) AS count,COALESCE(SUM(length(CAST(event.payload AS BLOB))+length(CAST(COALESCE(secret.private_json,'') AS BLOB))),0) AS bytes
    FROM events event LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id WHERE ${where}`,bindings};
  const measure=db.prepare(size.sql).bind(...size.bindings),measured=structuredClone(await measure.all<Row>());
  if(env.DB!==db||!measured.success||!Array.isArray(measured.results)||measured.results.length!==1||!derivationInteger(measured.results[0]!.count)||!derivationInteger(measured.results[0]!.bytes))throw Error('memory-relation-size');
  observer.observe([measure],[measured],[size]);
  if(Number(measured.results[0]!.count)>64||Number(measured.results[0]!.bytes)>65536)return empty();
  const query={sql:`SELECT event.*,secret.owner_id,secret.project_id,secret.document_id,secret.private_json,secret.redacted_at,
    (SELECT json_group_array(json_object('organization',s.organization_id,'access',s.project_access_id,'project',s.project_id,
      'owner',s.owner_user_id,'stream',s.source_stream_id,'sequence',s.source_sequence)) FROM project_event_scopes s WHERE s.event_id=event.event_id) AS custody,
    (SELECT COUNT(*) FROM events compensation WHERE compensation.stream_id=event.stream_id AND compensation.compensates_event_id=event.event_id) AS compensated
    FROM events event LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id WHERE ${where}
      AND (?,?)=(SELECT count,bytes FROM (${size.sql})) ORDER BY event.sequence,event.event_id LIMIT 65`,
    bindings:[...bindings,Number(measured.results[0]!.count),Number(measured.results[0]!.bytes),...bindings]};
  const custody={sql:`SELECT wanted.value AS relation_id,
    (SELECT event.event_id FROM events event WHERE event.stream_id=? AND event.type IN('BlockRelationAdded','BlockRelationRemoved')
      AND json_extract(event.payload,'$.relation_id')=wanted.value ORDER BY event.sequence DESC LIMIT 1) AS latest,
    (SELECT json_group_array(json_object('organization',s.organization_id,'access',s.project_access_id,'project',s.project_id,
      'owner',s.owner_user_id,'visibility',s.visibility,'actor',s.actor_user_id)) FROM project_resource_scopes s
      WHERE s.owner_user_id=? AND s.resource_kind='relation' AND s.resource_id=wanted.value) AS custody
    FROM json_each(?) wanted ORDER BY wanted.value`,bindings:[stream,e.owner_user_id,JSON.stringify(ids)]};
  const queries=[query,custody],statements=queries.map(q=>db.prepare(q.sql).bind(...q.bindings)),results=structuredClone(await db.batch<Row>(statements));
  if(env.DB!==db||results.length!==2||results.some(result=>!result.success||'error' in result&&result.error!==undefined||!Array.isArray(result.results)))throw Error('memory-relation-read');
  observer.observe(statements,results,queries);
  const entries:NativeMemoryRelationBindings['entries']=[];
  const candidates=[];
  for(const observation of selected){
    try{
      if(!derivationId(observation.relationId))continue;
      const resource=results[1]!.results.find(row=>row.relation_id===observation.relationId);if(!resource||resource.latest!==observation.eventId)continue;
      const scopes=JSON.parse(String(resource.custody));
      if(!Array.isArray(scopes)||(e.organization_id===null?scopes.length!==0:scopes.length!==1||scopes[0].organization!==e.organization_id
        ||scopes[0].access!==e.project_access_id||scopes[0].project!==e.project_id||scopes[0].owner!==e.owner_user_id
        ||!(scopes[0].visibility==='collaborative_output'||scopes[0].visibility==='actor_private'&&scopes[0].actor===e.actor_user_id)))continue;
      const events=results[0]!.results.filter(row=>JSON.parse(String(row.payload)).relation_id===observation.relationId&&Number(row.sequence)<=observation.sequence)
        .map(row=>decodeNativeMemoryResourceEvent(row,e,'relation',observation.relationId!));
      const source=events[0],current=events.at(-1);if(!source||source.type!=='BlockRelationAdded'||events.filter(row=>row.type==='BlockRelationAdded').length!==1
        ||current?.eventId!==observation.eventId||current.sequence!==observation.sequence||current.type!==observation.eventType)continue;
      const p=source.payload;
      if(p.project_id!==e.project_id||p.document_id!==e.document_id||!derivationId(p.from_block_id)||!derivationId(p.to_block_id)
        ||p.from_block_id===p.to_block_id||!derivationId(p.kind)||p.kind.length>64)continue;
      candidates.push({observation,events,fromId:p.from_block_id,toId:p.to_block_id,kind:p.kind});
    }catch{/* Keep the original document action, never invent an edge. */}
  }
  const endpoints=await resolveEndpoints(candidates.flatMap(({observation,fromId,toId})=>[fromId,toId].map(blockPointer=>({
    eventId:observation.eventId,sequence:observation.sequence,eventType:observation.eventType,blockPointer,reference:true as const}))));
  for(const {observation,events,fromId,toId,kind}of candidates){
    const from=endpoints.entries.find(row=>row.eventId===observation.eventId&&row.blockId===fromId),to=endpoints.entries.find(row=>row.eventId===observation.eventId&&row.blockId===toId);
    if(!from||!to)continue;
    const relationId=observation.relationId!,resourceKey=JSON.stringify(['memory-resource-v1',e.owner_user_id,e.organization_id,e.project_access_id,'relation',e.project_id,e.document_id,relationId]);
    entries.push({eventId:observation.eventId,relationId,scopeKey:memoryCanonical([parent.partitionKey,resourceKey]),revision:observation.sequence,
      state:observation.eventType==='BlockRelationRemoved'?'unlinked':'linked',kind,stateSha256:await memoryDigest(memoryCanonical({version:'native-relation-v1',events,from,to})),
      from,to,eventIds:[...new Set([...events.map(event=>event.eventId),...from.eventIds,...to.eventIds])]});
  }
  return {version:1,entries,unresolved:selected.length-entries.length};
}

export async function observeNativeMemoryRelationBindings(env:WorkerEnv,e:LiveMemoryEnrollment,observations:readonly Observation[],observer:NativeMemoryContextObserver){
  return captureRelations(env,e,observations,observer);
}

/** One bounded native block read covers both direct observations and independently
 * witnessed relation endpoints. The resolver is private to this capture; no
 * cached block identity or caller-supplied binding becomes authority. */
export async function observeNativeMemoryResourceBindings(env:WorkerEnv,e:LiveMemoryEnrollment,
  observations:Parameters<typeof observeNativeMemoryBlockBindings>[2],relations:readonly Observation[],observer:NativeMemoryContextObserver,
  options:{blocks:boolean;relations:boolean}){
  let allBlocks:Awaited<ReturnType<typeof observeNativeMemoryBlockBindings>>|undefined;
  const direct=options.blocks?observations:[];
  const relationBindings=options.relations?await captureRelations(env,e,relations,observer,async endpoints=>{
    const union=[...direct,...endpoints];
    if(new Set(union.filter(row=>row.blockPointer!==null).map(row=>row.blockPointer)).size>32){
      // Do not lower either existing coverage bound to make a request cheaper.
      allBlocks=options.blocks?await observeNativeMemoryBlockBindings(env,e,direct,observer):undefined;
      return observeNativeMemoryBlockBindings(env,e,endpoints,observer);
    }
    let overCapacity=false;
    allBlocks=await observeNativeMemoryBlockBindings(env,e,union,observer,()=>{overCapacity=true;});
    if(overCapacity){
      allBlocks=options.blocks?await observeNativeMemoryBlockBindings(env,e,direct,observer):undefined;
      return observeNativeMemoryBlockBindings(env,e,endpoints,observer);
    }
    return allBlocks;
  }):undefined;
  if(options.blocks&&!allBlocks)allBlocks=await observeNativeMemoryBlockBindings(env,e,direct,observer);
  const directIds=new Set(direct.map(row=>row.eventId));
  const entries=allBlocks?.entries.filter(row=>directIds.has(row.eventId))??[];
  // Preserve the helper's exact direct-observation denominator, including null
  // pointers and non-block event types that are not candidates in the first place.
  const selected=direct.filter(row=>row.blockPointer!==null&&['BlockCreated','BlockPropertyEdited','ChipEdited','BlockWeightSet','BlockLocked','BlockUnlocked','BlockRemoved','BlockRestored'].includes(row.eventType));
  return {blockBindings:options.blocks?{version:1 as const,entries,unresolved:selected.length-entries.length}:undefined,relationBindings};
}

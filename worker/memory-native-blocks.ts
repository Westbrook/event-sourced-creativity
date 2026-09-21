import { memoryDigest } from '../src/model/scoped-memory.ts';
import { serializeEvent, type WorkerEnv } from './runtime.ts';
import { memoryCanonical } from './memory-sql.ts';
import { nativeMemoryDocumentIdentity } from './memory-native-scope.ts';
import type { LiveMemoryEnrollment } from './memory-live-authority.ts';
import type { NativeMemoryContextObserver } from './memory-live-context.ts';
import { derivationId, derivationInteger, derivationTime } from './memory-derivation-policy.ts';

export type NativeMemoryResourceScope = Pick<LiveMemoryEnrollment,'actor_user_id'|'owner_user_id'|'organization_id'|'project_access_id'|'project_id'|'document_id'>;
type Row = Record<string, unknown>;
type Observation = { eventId:string; sequence:number; blockPointer:string|null; eventType:string; reference?:true };
export type NativeMemoryBlockBinding = { eventId:string; blockId:string; scopeKey:string; revision:number; stateSha256:string; eventIds:string[] };
export type NativeMemoryBlockBindings = { version:1|2; entries:NativeMemoryBlockBinding[]; unresolved:number };
const actions=new Set(['BlockCreated','BlockRenamed','BlockPropertyEdited','ChipEdited','BlockWeightSet','BlockLocked','BlockUnlocked','BlockRemoved','BlockRestored']);
const types=['BlockCreated','BlockRehomed','BlockRenamed','BlockPropertyEdited','ChipEdited','BlockWeightSet','BlockLocked','BlockUnlocked',
  'BlockRemoved','BlockRestored','ExtractionRequested','ExtractionCompleted','ExtractionFailed','ImageFocalPointCalculated'];
const sqlTypes=types.map(type=>"'"+type+"'").join(',');
const columns=['event_id','stream_id','sequence','occurred_at','recorded_at','actor','client_id','correlation_id','causation_id','compensates_event_id','schema_version','type','payload'];
export const nativeMemoryBlockObservationEligible=(row:Observation)=>row.blockPointer!==null
  &&(actions.has(row.eventType)||row.reference===true&&['BlockRelationAdded','BlockRelationRemoved','BlockInspected'].includes(row.eventType));
const clean=(p:Record<string,unknown>)=>!p.simulation&&!p.synthetic&&!(p.origin&&typeof p.origin==='object'&&'synthetic' in p.origin&&p.origin.synthetic)
  &&p.mock_data_source==null&&p.replay_session_id==null&&p.fictional_user_id==null;

/** Shared strict native envelope decoding. Identity data alone is not authority;
 * callers must retain the exact DB read in the enclosing authenticated witness. */
type FieldUndoEdge = Readonly<{ compensated:number; target:string|null }>;
export function decodeNativeMemoryResourceEvent(row:Row,e:NativeMemoryResourceScope,resourceKind:'block'|'relation'|'document'|'collection',resourceId:string,fieldUndo?:FieldUndoEdge){
  if(row.schema_version!==1||!derivationId(row.event_id)||!derivationInteger(row.sequence,1)||!derivationTime(row.recorded_at)||String(row.recorded_at)>new Date().toISOString()
    ||String(row.event_id).startsWith('optimistic:')||String(row.client_id).includes('optimistic')
    ||fieldUndo&&resourceKind!=='block'||row.compensated!==(fieldUndo?.compensated??0)||row.compensates_event_id!==(fieldUndo?.target??null))throw Error('source');
  const publicPayload=JSON.parse(String(row.payload)),event=serializeEvent(row),p=event.payload;
  if(!clean(publicPayload)||!clean(p)||p._private_ref!==undefined||p[resourceKind+'_id']!==resourceId
    ||[resourceKind+'_id','project_id','document_id','canvas_id','scope',...(resourceKind==='relation'?['from_block_id','to_block_id','kind']:[])].some(key=>publicPayload[key]!==undefined&&publicPayload[key]!==p[key])
    ||p.project_id!==undefined&&p.project_id!==e.project_id||p.document_id!==undefined&&p.document_id!==e.document_id
    ||row.redacted_at!==null||publicPayload._private_ref===undefined&&row.private_json!==null||publicPayload._private_ref!==undefined&&(publicPayload._private_ref!==row.event_id
      ||typeof row.private_json!=='string'||row.owner_id!==e.owner_user_id||row.project_id!==e.project_id||row.document_id!==(resourceKind==='collection'?null:e.document_id)))throw Error('private');
  const scopes=JSON.parse(String(row.custody));
  if(!Array.isArray(scopes)||(e.organization_id===null?scopes.length!==0:scopes.length!==1||scopes[0].organization!==e.organization_id
    ||scopes[0].access!==e.project_access_id||scopes[0].project!==e.project_id||scopes[0].owner!==e.owner_user_id
    ||scopes[0].stream!=='creative:'+e.owner_user_id||scopes[0].sequence!==row.sequence))throw Error('custody');
  return event;
}

/** A closed native undo pair is part of the new field version, never proof that
 * the old version remains current or that a reversal is independent preference.
 * All rows are subsequently decoded with their original custody/private-body
 * checks and retained in the enclosing exact SQL witness. A compensator outside
 * this historical window, multiple reversals, chains or unrelated actions fail.
 * This intentionally supports the Store's field/lifecycle inverses only. */
function nativeFieldUndoEdges(rows:readonly Row[]):Map<string,FieldUndoEdge>{
  const events=rows.map(row=>serializeEvent(row)),byId=new Map(events.map(event=>[event.eventId,event])),edges=new Map<string,FieldUndoEdge>();
  if(byId.size!==rows.length)throw Error('memory-block-undo-identity');
  // A created block has no prior field value. Its Undo/Redo is an exact
  // same-author Created -> Removed -> Restored lifecycle, not a second creation.
  // Accept only that closed linear chain; branches, foreign targets and mixed
  // field compensation still use the strict pair rules below.
  const creationEdges=new Set<string>();
  for(const root of events.filter(event=>event.type==='BlockCreated'&&!event.compensatesEventId)){
    let current=root;
    for(;;){
      const children=events.filter(event=>event.compensatesEventId===current.eventId);
      if(!children.length)break;
      if(children.length!==1)throw Error('memory-block-undo-branch');
      const next=children[0]!;
      if(next.type!==(current.type==='BlockRemoved'?'BlockRestored':'BlockRemoved')||next.actor!==root.actor
        ||next.sequence<=current.sequence||next.payload.block_id!==root.payload.block_id)throw Error('memory-block-undo-creation');
      edges.set(current.eventId,{compensated:1,target:current.compensatesEventId});
      edges.set(next.eventId,{compensated:0,target:current.eventId});creationEdges.add(next.eventId);current=next;
    }
  }
  const opposites:Record<string,string>={BlockLocked:'BlockUnlocked',BlockUnlocked:'BlockLocked',BlockRemoved:'BlockRestored',BlockRestored:'BlockRemoved'};
  for(const event of events){
    if(!event.compensatesEventId||creationEdges.has(event.eventId))continue;
    const original=byId.get(event.compensatesEventId),p=event.payload,q=original?.payload;
    if(!original||!q||original.compensatesEventId||original.sequence>=event.sequence||original.actor!==event.actor
      ||p.block_id!==q.block_id||edges.has(original.eventId)||edges.has(event.eventId))throw Error('memory-block-undo-edge');
    const swapped=(old:string,next:string)=>Object.hasOwn(p,old)&&Object.hasOwn(p,next)&&Object.hasOwn(q,old)&&Object.hasOwn(q,next)
      &&memoryCanonical(p[old])===memoryCanonical(q[next])&&memoryCanonical(p[next])===memoryCanonical(q[old]);
    let inverse=opposites[original.type]===event.type;
    if(original.type===event.type){
      if(event.type==='BlockRenamed')inverse=swapped('old_handle','new_handle');
      if(event.type==='BlockWeightSet')inverse=swapped('previous_weight','weight');
      if(event.type==='BlockPropertyEdited'||event.type==='ChipEdited'){
        const field=event.type==='ChipEdited'?'property':'property_path';
        inverse=typeof p[field]==='string'&&Boolean(p[field])&&p[field]===q[field]&&swapped('old_value','new_value');
      }
    }
    if(!inverse)throw Error('memory-block-undo-inverse');
    edges.set(original.eventId,{compensated:1,target:null});edges.set(event.eventId,{compensated:0,target:original.eventId});
  }
  return edges;
}

/** Decode a complete, already bounded native field-history read. This is data
 * validation only; an authoring caller must still prove current access and replay
 * the exact rows in its own transaction. */
export function decodeNativeMemoryBlockHistory(rows:readonly Row[],scope:NativeMemoryResourceScope,blockId:string){
  const undo=nativeFieldUndoEdges(rows);
  return rows.map(row=>decodeNativeMemoryResourceEvent(row,scope,'block',blockId,undo.get(String(row.event_id))));
}

/** Supplement the already-authorized document observation, never widen it.
 * A raw pointer, absent/ambiguous source, library/canvas placement or oversized
 * history remains explicitly unresolved. No block text becomes a quotation.
 * The caller must seal/replay this observer with its native grant/access proof.
 * Reference requests are internal endpoint/version reads; their caller must
 * separately certify a genuine relationship or inspection before treating it as
 * an observation. A version read alone does not authorize publication.
 * Versions describe retained native block fields, NOT relations or dereferenced attachments.
 */
export async function observeNativeMemoryBlockBindings(env:WorkerEnv,e:NativeMemoryResourceScope,
  observations:readonly Observation[],observer:NativeMemoryContextObserver,onCapacity?:()=>void,onVersion?:(binding:NativeMemoryBlockBinding,events:ReturnType<typeof decodeNativeMemoryBlockHistory>)=>void):Promise<NativeMemoryBlockBindings>{
  const selected=observations.filter(nativeMemoryBlockObservationEligible);
  const empty=()=>({version:1 as const,entries:[],unresolved:selected.length});
  if(!selected.length)return empty();
  const parent=nativeMemoryDocumentIdentity(e);if(!parent)throw Error('memory-block-scope');
  const ids=[...new Set(selected.map(row=>row.blockPointer!))];
  if(ids.length>32){onCapacity?.();return empty();}
  const db=env.DB,through=Math.max(...selected.map(row=>row.sequence)),stream='creative:'+e.owner_user_id;
  // Source selection is bounded to the observed window. Later property edits
  // do not rewrite a historical version; current placement is proved separately.
  const query={sql:`SELECT ${columns.map(column=>'event.'+column).join(',')},
    secret.owner_id,secret.project_id,secret.document_id,secret.private_json,secret.redacted_at,
    (SELECT json_group_array(json_object('organization',s.organization_id,'access',s.project_access_id,'project',s.project_id,
      'owner',s.owner_user_id,'stream',s.source_stream_id,'sequence',s.source_sequence)) FROM project_event_scopes s WHERE s.event_id=event.event_id) AS custody,
    (SELECT COUNT(*) FROM events compensation WHERE compensation.stream_id=event.stream_id AND compensation.compensates_event_id=event.event_id) AS compensated
    FROM events event LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id
      AND secret.owner_id=? AND secret.project_id=? AND secret.document_id=?
    WHERE event.stream_id=? AND event.sequence<=? AND event.type IN(${sqlTypes})
      AND json_extract(event.payload,'$.block_id') IN(SELECT value FROM json_each(?))
    ORDER BY event.sequence,event.event_id LIMIT 257`,bindings:[e.owner_user_id,e.project_id,e.document_id,stream,through,JSON.stringify(ids)]};
  const placement={sql:`SELECT wanted.value AS block_id,
    (SELECT json_array(event.event_id,event.sequence,event.type,event.payload) FROM events event WHERE event.stream_id=?
      AND json_extract(event.payload,'$.block_id')=wanted.value AND event.type IN('BlockCreated','BlockRehomed','BlockRemoved','BlockRestored')
      ORDER BY event.sequence DESC LIMIT 1) AS latest,
    (SELECT json_group_array(json_object('organization',s.organization_id,'access',s.project_access_id,'project',s.project_id,
      'owner',s.owner_user_id,'visibility',s.visibility,'actor',s.actor_user_id)) FROM project_resource_scopes s
      WHERE s.owner_user_id=? AND s.resource_kind='block' AND s.resource_id=wanted.value) AS custody
    FROM json_each(?) wanted ORDER BY wanted.value`,bindings:[stream,e.owner_user_id,JSON.stringify(ids)]};
  const size={sql:`SELECT COUNT(*) AS count,COALESCE(SUM(length(CAST(event.payload AS BLOB))+length(CAST(COALESCE(secret.private_json,'') AS BLOB))),0) AS bytes
    FROM events event LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id
      AND secret.owner_id=? AND secret.project_id=? AND secret.document_id=?
    WHERE event.stream_id=? AND event.sequence<=? AND event.type IN(${sqlTypes})
      AND json_extract(event.payload,'$.block_id') IN(SELECT value FROM json_each(?))`,bindings:query.bindings};
  const sizeStatement=db.prepare(size.sql).bind(...size.bindings),measured=structuredClone(await sizeStatement.all<Row>());
  if(env.DB!==db||!measured.success||!Array.isArray(measured.results)||measured.results.length!==1
    ||!derivationInteger(measured.results[0]!.count)||!derivationInteger(measured.results[0]!.bytes))throw Error('memory-block-size');
  observer.observe([sizeStatement],[measured],[size]);
  if(Number(measured.results[0]!.count)>256||Number(measured.results[0]!.bytes)>196608){onCapacity?.();return empty();}
  // Repeat the measured aggregate in the full-row statement itself. A source
  // growing between calls is not hydrated before the final replay rejects it.
  const boundedQuery={sql:query.sql.replace('ORDER BY event.sequence,event.event_id LIMIT 257',
    `AND (?,?)=(SELECT count,bytes FROM (${size.sql})) ORDER BY event.sequence,event.event_id LIMIT 257`),
    bindings:[...query.bindings,Number(measured.results[0]!.count),Number(measured.results[0]!.bytes),...size.bindings]};
  const queries=[boundedQuery,placement],statements=queries.map(q=>db.prepare(q.sql).bind(...q.bindings));
  const results=structuredClone(await db.batch<Row>(statements));
  if(env.DB!==db||results.length!==2||results.some(result=>result.success!==true||'error' in result&&result.error!==undefined||!Array.isArray(result.results)))throw Error('memory-block-read');
  // Even an unresolved outcome pins absence/overload, so a replay cannot silently
  // change which source interpretation was supplied to the derivation.
  observer.observe(statements,results,queries);
  const rows=results[0]!.results,placements=results[1]!.results;
  if(rows.length>256||new TextEncoder().encode(JSON.stringify(rows)).byteLength>262144){onCapacity?.();return empty();}
  const entries:NativeMemoryBlockBinding[]=[];
  for(const observation of selected){
    try{
      if(observation.reference&&!['BlockRelationAdded','BlockRelationRemoved','BlockInspected'].includes(observation.eventType))continue;
      const blockId=observation.blockPointer!,source=rows.filter(row=>JSON.parse(String(row.payload)).block_id===blockId&&Number(row.sequence)<=observation.sequence);
      const current=placements.find(row=>row.block_id===blockId);if(!source.length||!current)continue;
      const custody=JSON.parse(String(current.custody));
      if(!Array.isArray(custody)||(e.organization_id===null?custody.length!==0:custody.length!==1
        ||custody[0].organization!==e.organization_id||custody[0].access!==e.project_access_id||custody[0].project!==e.project_id
        ||custody[0].owner!==e.owner_user_id||!(custody[0].visibility==='collaborative_output'||custody[0].visibility==='actor_private'&&custody[0].actor===e.actor_user_id)))continue;
      const events=decodeNativeMemoryBlockHistory(source,e,blockId);
      const declarations=events.filter(event=>event.type==='BlockCreated');
      // No implicit projection defaults or duplicate IDs can manufacture custody.
      if(declarations.length!==1||declarations[0]!.payload.project_id!==e.project_id||declarations[0]!.payload.document_id!==e.document_id
        ||declarations[0]!.payload.scope!==undefined&&declarations[0]!.payload.scope!=='document'
        ||declarations[0]!.payload.canvas_id||declarations[0]!.payload.library_block===true
        ||!observation.reference&&!events.some(event=>event.eventId===observation.eventId&&event.sequence===observation.sequence&&event.type===observation.eventType))continue;
      if(events[0]!.type!=='BlockCreated')continue;
      let removed=false,documentPlaced=true;
      for(const event of events){
        if(event.type==='BlockRehomed')documentPlaced=event.payload.scope==='document'&&event.payload.document_id===e.document_id;
        if(event.type==='BlockRemoved')removed=true;
        if(event.type==='BlockRestored')removed=false;
      }
      const lifecycle=events.filter(event=>['BlockCreated','BlockRehomed','BlockRemoved','BlockRestored'].includes(event.type)).at(-1)!;
      const latest=JSON.parse(String(current.latest));
      if(removed||!documentPlaced
        ||!Array.isArray(latest)||latest[0]!==lifecycle.eventId||latest[1]!==lifecycle.sequence||latest[2]!==lifecycle.type)continue;
      const resourceKey=JSON.stringify(['memory-resource-v1',e.owner_user_id,e.organization_id,e.project_access_id,'block',e.project_id,e.document_id,blockId]);
      entries.push({eventId:observation.eventId,blockId,scopeKey:memoryCanonical([parent.partitionKey,resourceKey]),
        revision:events.at(-1)!.sequence,stateSha256:await memoryDigest(memoryCanonical({version:'native-block-fields-v1',events})),eventIds:events.map(event=>event.eventId)});
      onVersion?.(entries.at(-1)!,events);
    }catch{/* Preserve the document action, not an unproved block interpretation. */}
  }
  return {version:1,entries,unresolved:selected.length-entries.length};
}

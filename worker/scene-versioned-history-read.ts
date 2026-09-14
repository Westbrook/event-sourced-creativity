import type {CreativeEvent} from '../src/model/events.ts';
import type {WorkerEnv} from './runtime.ts';
import {serializeEvent} from './event-read-primitives.ts';
import {OutputConflictError,type OutputSqlAssertion,type OutputSqlValue} from './output-command-core.ts';
import {sceneHistorySourceRelation,sceneHistoryMetadataSelect,sceneHistoryMetadataFields,type SceneHistoryScope} from './scene-history-proof.ts';
import {sceneSourceVersionAssertions,type SceneSourceVersion} from './scene-source-generation.ts';

/** Qualification limits, not an activated production path. No history truncation:
 * limits throw before finish(). Current-state memory needs a bounded consumer. */
export const SCENE_VERSIONED_READ_LIMITS=Object.freeze({rows:40_000,pageRows:256,pageBytes:512*1024,eventBytes:128*1024,
  rawBytes:64*1024*1024,batches:400});
const encoder=new TextEncoder(),bytes=(value:string)=>encoder.encode(value).length;
const metadataFields=[...sceneHistoryMetadataFields,'metadata_valid'];
const metadataJson=`json_object(${metadataFields.map(field=>`'${field}',${field}`).join(',')})`;
const hydratedFields={event_id:'event_id',stream_id:'event_stream',sequence:'sequence',occurred_at:'occurred_at',recorded_at:'recorded_at',
  actor:'actor',client_id:'client_id',correlation_id:'correlation_id',causation_id:'causation_id',compensates_event_id:'compensates_event_id',schema_version:'schema_version',type:'event_type',order_sequence:'order_sequence'};
type Consumer<T>={accept(event:CreativeEvent):boolean;finish():T;checkpoint?():unknown};
const integer=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const identifier=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&new TextEncoder().encode(value).length<=160;
const changed=():never=>{throw new OutputConflictError('output_source_changed_during_read',409);};
const capacity=():never=>{throw new OutputConflictError('output_source_proof_too_large',413);};

/** Pure reduction of complete, original-version source pages. The caller must
 * supply existing live authority/rights guards and retain returned assertions at
 * every consequential boundary. This helper does not grant authority or admit a
 * generation. A rejected read never finalizes its private accumulator. */
export async function reduceSceneVersionedHistory<T>(env:Pick<WorkerEnv,'DB'>,input:{scope:SceneHistoryScope;
  version:SceneSourceVersion;readAssertions:readonly OutputSqlAssertion[];createConsumer():Consumer<T>}){
  const scope:SceneHistoryScope=Object.freeze({...input.scope,...(input.scope.project?{project:Object.freeze({...input.scope.project})}:{})});
  if(!identifier(scope.streamId)||!integer(scope.expectedOwnerHead)||!Number.isFinite(scope.deadlineMs)
    ||scope.project&&(!Object.values(scope.project).every(identifier)||scope.streamId!=='creative:'+scope.project.ownerUserId)
    ||input.version.streamId!==scope.streamId||input.version.projectAccessId!==scope.project?.projectAccessId
    ||!input.readAssertions.length)changed();
  const callerDeadlines=input.readAssertions.flatMap(value=>value.deadlineMs===undefined?[]:[value.deadlineMs]);
  if(callerDeadlines.some(value=>!Number.isFinite(value)))changed();
  const deadlineMs=Math.min(scope.deadlineMs!,...callerDeadlines);
  const deadline=()=>{if(Date.now()>=deadlineMs)changed();};
  const assertions:readonly OutputSqlAssertion[]=Object.freeze([
    ...sceneSourceVersionAssertions(input.version),...input.readAssertions,
    {sql:'(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?',bindings:[scope.streamId,scope.expectedOwnerHead]},
    {sql:"(CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER))<?",bindings:[deadlineMs],deadlineMs},
  ].map(value=>Object.freeze({...value,bindings:Object.freeze([...(value.bindings??[])])}) as unknown as OutputSqlAssertion));
  // One bounded guard statement avoids multiplying each page by the number of
  // predicates. The original predicates and bindings are never recaptured.
  const guardSql='SELECT CASE WHEN '+assertions.map(value=>'('+value.sql+')').join(' AND ')+' THEN 1 ELSE 0 END AS current';
  const guardBindings=assertions.flatMap(value=>value.bindings??[]);
  if(new TextEncoder().encode(guardSql).length>99_000||guardBindings.length>99
    ||guardBindings.some(value=>typeof value==='string'&&new TextEncoder().encode(value).length>128*1024))capacity();
  let batches=0;
  const read=async(sql:string,bindings:OutputSqlValue[])=>{
    deadline();if(++batches>SCENE_VERSIONED_READ_LIMITS.batches)capacity();
    const result=await env.DB.batch<Record<string,unknown>>([env.DB.prepare(sql).bind(...bindings),env.DB.prepare(guardSql).bind(...guardBindings)]);
    deadline();if(!Array.isArray(result)||result.length!==2||result[0]?.success!==true||!Array.isArray(result[0].results)
      ||result[1]?.success!==true||!Array.isArray(result[1].results)||result[1].results.length!==1||result[1].results[0]?.current!==1)changed();
    return result[0].results;
  };
  const relation=sceneHistorySourceRelation(scope),cte=`WITH source AS NOT MATERIALIZED (${relation.sql})`;
  const totals=await read(`${cte} SELECT COUNT(*) AS count,COALESCE(MAX(order_sequence),0) AS head FROM source`,relation.bindings);
  if(totals.length!==1||!integer(totals[0]?.count)||!integer(totals[0]?.head))changed();
  const count=totals[0]!.count as number,head=totals[0]!.head as number;
  if(count>SCENE_VERSIONED_READ_LIMITS.rows)capacity();
  const consumer=input.createConsumer();let cursor=0,consumed=0,rawBytes=0,maximumHydratedPageBytes=0,maximumMetadataPageBytes=0;
  while(true){
    const metadata=await read(`${cte}, metadata AS NOT MATERIALIZED (${sceneHistoryMetadataSelect}), page AS MATERIALIZED
      (SELECT * FROM metadata WHERE order_sequence>? ORDER BY order_sequence LIMIT ${SCENE_VERSIONED_READ_LIMITS.pageRows}),
      budgeted AS (SELECT *,SUM(length(CAST(${metadataJson} AS BLOB))+1) OVER (ORDER BY order_sequence) AS running_bytes FROM page)
      SELECT ${metadataFields.join(',')} FROM budgeted WHERE running_bytes<=${SCENE_VERSIONED_READ_LIMITS.pageBytes-2} ORDER BY order_sequence`,[...relation.bindings,cursor]);
    if(metadata.length>SCENE_VERSIONED_READ_LIMITS.pageRows)changed();
    const metadataBytes=bytes(JSON.stringify(metadata));if(metadataBytes>SCENE_VERSIONED_READ_LIMITS.pageBytes)capacity();
    maximumMetadataPageBytes=Math.max(maximumMetadataPageBytes,metadataBytes);
    if(!metadata.length){if(consumed!==count||cursor!==head)changed();break;}
    const selected:Record<string,unknown>[]=[];let pageBytes=0,previous=cursor;
    for(const row of metadata){
      if(row.metadata_valid!==1||row.event_present!==1||row.event_stream!==scope.streamId||!identifier(row.event_id)
        ||!integer(row.sequence)||row.sequence<1||!integer(row.order_sequence)||row.order_sequence<=previous
        ||!integer(row.schema_version)||row.schema_version<1||!integer(row.public_bytes)||!integer(row.private_bytes)
        ||row.public_type!=='text'||!['null','text','blob'].includes(String(row.private_type))
        ||row.member_source_sequence!==null&&!integer(row.member_source_sequence)
        ||scope.project&&(row.member_source_stream!==scope.streamId||row.member_source_sequence!==row.sequence))changed();
      previous=Number(row.order_sequence);
      // Include actual bounded metadata as well as both returned bodies. This
      // counts UTF-8 content, not a claim about transport escaping or JS heap.
      const size=Number(row.public_bytes)+(row.redacted_at===null?Number(row.private_bytes):0)+new TextEncoder().encode(JSON.stringify(row)).length;
      if(size>SCENE_VERSIONED_READ_LIMITS.eventBytes)capacity();
      if(selected.length&&pageBytes+size>SCENE_VERSIONED_READ_LIMITS.pageBytes)break;
      pageBytes+=size;selected.push(row);
    }
    if(!selected.length)changed();
    const expected=selected.map(row=>[row.event_id,row.order_sequence]);
    const rows=await read(`${cte} SELECT source.event_id,source.event_stream AS stream_id,source.sequence,source.occurred_at,source.recorded_at,
      source.actor,source.client_id,source.correlation_id,source.causation_id,source.compensates_event_id,source.schema_version,source.event_type AS type,
      source.public_body AS payload,CASE WHEN source.redacted_at IS NULL THEN source.private_body ELSE NULL END AS private_json,source.order_sequence
      FROM json_each(?) expected CROSS JOIN source WHERE source.event_id=json_extract(expected.value,'$[0]')
        AND source.order_sequence=json_extract(expected.value,'$[1]') ORDER BY CAST(expected.key AS INTEGER)`,[...relation.bindings,JSON.stringify(expected)]);
    if(rows.length!==selected.length)changed();
    let hydratedPageBytes=0;
    for(let index=0;index<rows.length;index++){
      const row=rows[index]!,metadata=selected[index]!;
      if(Object.entries(hydratedFields).some(([field,expected])=>row[field]!==metadata[expected])
        ||typeof row.payload!=='string'||row.private_json!==null&&typeof row.private_json!=='string')changed();
      if(bytes(String(row.payload))!==metadata.public_bytes
        ||(metadata.redacted_at===null&&metadata.private_type==='text'
          ?typeof row.private_json!=='string'||bytes(row.private_json)!==metadata.private_bytes:row.private_json!==null))changed();
      const size=bytes(JSON.stringify(Object.fromEntries(Object.keys(hydratedFields).map(field=>[field,row[field]]))))
        +bytes(String(row.payload))+(typeof row.private_json==='string'?bytes(row.private_json):0);
      hydratedPageBytes+=size;if(size>SCENE_VERSIONED_READ_LIMITS.eventBytes||hydratedPageBytes>SCENE_VERSIONED_READ_LIMITS.pageBytes)capacity();
      rawBytes+=Number(metadata.public_bytes)+Number(metadata.private_bytes);if(rawBytes>SCENE_VERSIONED_READ_LIMITS.rawBytes)capacity();
      if(!consumer.accept(serializeEvent(row)))changed();
      cursor=Number(metadata.order_sequence);consumed++;if(consumed>count)changed();
    }
    maximumHydratedPageBytes=Math.max(maximumHydratedPageBytes,hydratedPageBytes);
    consumer.checkpoint?.();deadline();
  }
  deadline();consumer.checkpoint?.();const value=consumer.finish();deadline();
  return {value,assertions,rows:consumed,rawBytes,batches,maximumHydratedPageBytes,maximumMetadataPageBytes};
}

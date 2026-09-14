import {sceneSourceSchemaAssertion,sceneSourceVersionAssertions,type SceneSourceVersion} from './scene-source-generation.ts';
import type {WorkerEnv} from './runtime.ts';

type Row=Record<string,unknown>;
export type ImageWitnessGuard={sql:string;bindings:Array<string|number|null>};
type Lifetime={check():void;sql(count:number):void;wait<T>(promise:Promise<T>):Promise<T>};
const encoder=new TextEncoder(),bytes=(value:string)=>encoder.encode(value).length;
export const IMAGE_WITNESS_LIMITS=Object.freeze({events:50_000,eventBytes:16_000_000,eventJsonBytes:24_000_000,
  revisions:128,revisionBytes:8_000_000,revisionBodyBytes:100_000,pageRows:256,pageBytes:512_000,rowBodyBytes:128_000,reads:800});
const eventFields=['event_id','stream_id','sequence','occurred_at','recorded_at','actor','client_id','correlation_id','causation_id',
  'compensates_event_id','schema_version','type','payload','private_owner','private_project','private_document','private_json','private_redacted'];
const eventText=eventFields.filter(field=>!['sequence','schema_version','payload','private_json'].includes(field));
const revisionFields=['revision_id','owner_id','organization_id','project_access_id','project_id','document_id','artifact_id','revision',
  'content_json','content_sha256','created_by_user_id','created_at','expires_at','redacted_at'];
const revisionText=revisionFields.filter(field=>!['revision','content_json'].includes(field));
const json=(fields:string[])=>`json_object(${fields.map(field=>`'${field}',${field}`).join(',')})`;
const validText=(fields:string[])=>fields.map(field=>`(${field} IS NULL OR (typeof(${field})='text' AND length(CAST(${field} AS BLOB))<=512))`).join(' AND ');
const relation=`SELECT e.*,p.owner_id private_owner,p.project_id private_project,p.document_id private_document,p.private_json,p.redacted_at private_redacted
  FROM events e LEFT JOIN event_private_payloads p ON p.private_event_id=e.event_id WHERE e.stream_id=?`;
const eventCell=`CASE WHEN ${validText(eventText)} AND typeof(payload)='text' AND (private_json IS NULL OR typeof(private_json)='text')
  AND length(CAST(payload AS BLOB))+COALESCE(length(CAST(private_json AS BLOB)),0)<=${IMAGE_WITNESS_LIMITS.rowBodyBytes}
  THEN ${json(eventFields)} ELSE NULL END`;
const revisionCell=`CASE WHEN ${validText(revisionText)} AND typeof(content_json)='text' AND length(CAST(content_json AS BLOB))<=${IMAGE_WITNESS_LIMITS.revisionBodyBytes}
  THEN ${json(revisionFields)} ELSE NULL END`;
const integer=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
function fail(kind:'capacity'|`capacity_${'reads'|'event_count'|'event_bytes'|'event_page'|'event_row'|'event_json'|'revision_count'|'revision_row'|'revision_bytes'}`|'changed'|'version'|'schema'|'epoch_absent'|'unavailable'):never {throw new Error('image_witness_'+kind);}
const own=(value:object,key:PropertyKey)=>Object.getOwnPropertyDescriptor(value,key)?.value;
const dense=(value:unknown):value is unknown[]=>Array.isArray(value)&&Array.from({length:value.length},(_,i)=>i).every(i=>{
  const descriptor=Object.getOwnPropertyDescriptor(value,i);return !!descriptor&&Object.hasOwn(descriptor,'value');
});
const noError=(value:object)=>{const descriptor=Object.getOwnPropertyDescriptor(value,'error');return !descriptor||Object.hasOwn(descriptor,'value')&&descriptor.value===undefined;};
const checked=(result:unknown):result is {success:true;results:Row[]}=>!!result&&typeof result==='object'
  &&own(result,'success')===true&&noError(result)&&dense(own(result,'results'));
/** Small balanced groups reduce D1 query count without oversized bindings or
 * deep left-associated expressions. No predicates are dropped or recaptured. */
function compact(guards:ImageWitnessGuard[]):ImageWitnessGuard[]{
  const result:ImageWitnessGuard[]=[];let group:ImageWitnessGuard[]=[],size=0,bindings=0;
  const balanced=(parts:string[]):string=>parts.length===1?`(${parts[0]})`:`(${balanced(parts.slice(0,Math.floor(parts.length/2)))} AND ${balanced(parts.slice(Math.floor(parts.length/2)))})`;
  const flush=()=>{if(group.length)result.push({sql:balanced(group.map(g=>g.sql)),bindings:group.flatMap(g=>g.bindings)});group=[];size=0;bindings=0;};
  for(const guard of guards){const next=guard.bindings.reduce<number>((n,v)=>n+(typeof v==='string'?bytes(v):8),0);
    if(group.length&&(group.length>=8||bindings+guard.bindings.length>80||size+next>800_000))flush();
    group.push(guard);size+=next;bindings+=guard.bindings.length;
  }flush();return result;
}
export function imageWitnessStatement(env:Pick<WorkerEnv,'DB'>,guard:ImageWitnessGuard,abort=false){
  return env.DB.prepare(`SELECT CASE WHEN (${guard.sql}) THEN 1 ELSE ${abort?"json('image_witness_changed')":'0'} END AS current`).bind(...guard.bindings);
}
export function imageWitnessAcknowledged(results:unknown,length:number):boolean{
  return dense(results)&&results.length===length&&results.every(result=>
    checked(result)&&result.results.length===1&&!!result.results[0]&&typeof result.results[0]==='object'&&own(result.results[0],'current')===1);
}
/** Validate the ORIGINAL batch before any copying/index access can turn an
 * inherited or accessor slot into apparently valid own evidence. */
export function imageWitnessPublished(results:unknown,prefix:number,writes:number):boolean{
  if(!integer(prefix)||!integer(writes)||writes<1||!dense(results)||results.length!==prefix+writes)return false;
  for(let index=0;index<results.length;index++){
    const result=own(results,index);if(!result||typeof result!=='object')return false;
    if(index<prefix){if(!imageWitnessAcknowledged([result],1))return false;continue;}
    const meta=own(result,'meta');
    if(own(result,'success')!==true||!noError(result)||!meta||typeof meta!=='object'||!integer(own(meta,'changes'))||Number(own(meta,'changes'))<1)return false;
  }
  return true;
}

/** Complete owner history, with bounded cells/pages and the original immutable
 * source-generation proof retained for all later reads and conditional writes.
 * GET never activates a nonce, resets a counter or silently truncates history. */
export async function readImageWitness(env:Pick<WorkerEnv,'DB'>,streamId:string,ownerId:string,key:string,outputId:string,life:Lifetime){
  life.check();
  let queryCount=0;
  const batch=(statements:D1PreparedStatement[])=>{life.sql(statements.length);queryCount+=statements.length;return life.wait(env.DB.batch<Row>(statements));};
  const schema=sceneSourceSchemaAssertion();
  const captured=await batch([
    imageWitnessStatement(env,{sql:schema.sql,bindings:[...schema.bindings??[]] as ImageWitnessGuard['bindings']}),
    env.DB.prepare(`SELECT instance_nonce,generation AS epoch,
      COALESCE((SELECT generation FROM scene_source_generations WHERE scope_kind='stream' AND scope_key=?),0) AS stream_generation
      FROM scene_source_epoch WHERE singleton=1 AND schema_version=1`).bind(streamId),
  ]);
  if(!dense(captured)||captured.length!==2)fail('version');
  if(!imageWitnessAcknowledged(captured.slice(0,1),1)){
    const result=captured[0];
    if(checked(result)&&result.results.length===1&&result.results[0]&&typeof result.results[0]==='object'&&own(result.results[0],'current')===0)fail('schema');
    fail('version');
  }
  if(!checked(captured[1]))fail('version');
  if(captured[1].results.length===0)fail('epoch_absent');
  if(captured[1].results.length!==1)fail('version');
  const token=captured[1].results[0]!;
  if(typeof token.instance_nonce!=='string'||!/^[a-f0-9]{32}$/u.test(token.instance_nonce)||!integer(token.epoch)||!integer(token.stream_generation))fail('version');
  const version:SceneSourceVersion={streamId,instanceNonce:token.instance_nonce,epoch:token.epoch,streamGeneration:token.stream_generation,projectGeneration:0};
  const guards:ImageWitnessGuard[]=sceneSourceVersionAssertions(version).map(value=>({sql:value.sql,bindings:[...value.bindings??[]] as ImageWitnessGuard['bindings']}));
  const pageGuards=compact(guards);
  let reads=0;
  const read=async(sql:string,bindings:ImageWitnessGuard['bindings'])=>{
    life.check();if(++reads>IMAGE_WITNESS_LIMITS.reads)fail('capacity_reads');
    const results=await batch([env.DB.prepare(sql).bind(...bindings),...pageGuards.map(guard=>imageWitnessStatement(env,guard))]);
    if(!dense(results)||results.length!==1+pageGuards.length||!checked(results[0])||!imageWitnessAcknowledged(results.slice(1),pageGuards.length))fail('changed');
    return results[0].results;
  };
  const totals=await read(`WITH source AS (${relation}) SELECT COUNT(*) AS count,COALESCE(MAX(sequence),0) AS head,
    COALESCE(SUM(length(CAST(payload AS BLOB))+COALESCE(length(CAST(private_json AS BLOB)),0)),0) AS raw_bytes FROM source`,[streamId]);
  const total=totals[0];
  if(totals.length!==1||!total||!integer(total.count)||!integer(total.head)||!integer(total.raw_bytes))fail('unavailable');
  if(total.count===0||total.count>IMAGE_WITNESS_LIMITS.events)fail('capacity_event_count');
  if(total.raw_bytes>IMAGE_WITNESS_LIMITS.eventBytes)fail('capacity_event_bytes');
  const eventRows:Row[]=[];let cursor=0,jsonBytes=2;
  while(eventRows.length<total.count){
    const page=await read(`WITH source AS (${relation}), page AS MATERIALIZED
      (SELECT sequence,${eventCell} AS witness FROM source WHERE sequence>? ORDER BY sequence LIMIT ${IMAGE_WITNESS_LIMITS.pageRows}),
      budgeted AS (SELECT *,SUM(COALESCE(length(CAST(witness AS BLOB)),1)+1) OVER (ORDER BY sequence) AS used FROM page)
      SELECT sequence,witness FROM budgeted WHERE used<=${IMAGE_WITNESS_LIMITS.pageBytes} ORDER BY sequence`,[streamId,cursor]);
    if(!page.length)fail('capacity_event_page');
    let pageBytes=0;
    for(const item of page){
      if(!integer(item.sequence)||item.sequence<=cursor||typeof item.witness!=='string')fail('capacity_event_row');
      const size=bytes(item.witness)+1;pageBytes+=size;jsonBytes+=size;
      if(pageBytes>IMAGE_WITNESS_LIMITS.pageBytes)fail('capacity_event_page');
      if(jsonBytes>IMAGE_WITNESS_LIMITS.eventJsonBytes)fail('capacity_event_json');
      const row:Row=JSON.parse(item.witness);if(row.sequence!==item.sequence||row.stream_id!==streamId)fail('changed');
      eventRows.push(row);cursor=item.sequence;
    }
    if(eventRows.length>total.count)fail('changed');
  }
  if(cursor!==total.head)fail('changed');
  // Source counters do not cover revisions. Preserve complete membership plus
  // one bounded exact row witness per revision, including mutable retention.
  const revisions=await read(`SELECT CASE WHEN typeof(revision_id)='text' AND length(CAST(revision_id AS BLOB))<=512 THEN revision_id ELSE NULL END AS revision_id,length(CAST(content_json AS BLOB)) AS body_bytes FROM artifact_revisions
    WHERE owner_id=? AND artifact_id IN (?,?) ORDER BY artifact_id,revision LIMIT ${IMAGE_WITNESS_LIMITS.revisions+1}`,[ownerId,key,outputId]);
  if(revisions.length>IMAGE_WITNESS_LIMITS.revisions)fail('capacity_revision_count');
  let revisionBytes=0;
  const revisionRows:Row[]=[];
  guards.push({sql:'(SELECT COUNT(*) FROM artifact_revisions WHERE owner_id=? AND artifact_id IN (?,?))=?',bindings:[ownerId,key,outputId,revisions.length]});
  for(const meta of revisions){
    if(typeof meta.revision_id!=='string'||!integer(meta.body_bytes)||meta.body_bytes>IMAGE_WITNESS_LIMITS.revisionBodyBytes)fail('capacity_revision_row');
    revisionBytes+=meta.body_bytes;if(revisionBytes>IMAGE_WITNESS_LIMITS.revisionBytes)fail('capacity_revision_bytes');
    const row=await read(`SELECT ${revisionCell} AS witness FROM artifact_revisions WHERE owner_id=? AND artifact_id IN (?,?) AND revision_id=?`,[ownerId,key,outputId,meta.revision_id]);
    if(row.length!==1||typeof row[0]?.witness!=='string'||bytes(row[0].witness)>700_000)fail('changed');
    const value:Row=JSON.parse(row[0].witness);if(typeof value.content_json!=='string'||bytes(value.content_json)!==meta.body_bytes)fail('changed');
    revisionRows.push(value);
    guards.push({sql:`EXISTS(SELECT 1 FROM artifact_revisions WHERE owner_id=? AND artifact_id IN (?,?) AND revision_id=? AND ${revisionCell}=?)`,bindings:[ownerId,key,outputId,meta.revision_id,row[0].witness]});
  }
  const proofs=compact(guards);
  const verified=await batch(proofs.map(guard=>imageWitnessStatement(env,guard)));
  if(!imageWitnessAcknowledged(verified,proofs.length))fail('changed');
  return {eventRows,revisionRows,guards:proofs,eventBytes:total.raw_bytes,reads,queryCount};
}

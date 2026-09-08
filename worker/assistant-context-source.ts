import type { AssistantContext } from "../src/model/conversation-context.ts";
import type { BudgetReservationGuard } from "./pilot-policy.ts";
import type { WorkerEnv } from "./runtime.ts";

export type AssistantSourceSqlValue=string|number|null;
export type AssistantContextReadDescriptor={sql:string;bindings:readonly AssistantSourceSqlValue[];
  role?:"exact"|"owner-head"|"ascending-events"|"project-head"|"resources"|"content-allowlist";
  streamId?:string;projectAccessId?:string;organizationId?:string};
export type AssistantContextReadObserver=(statements:readonly D1PreparedStatement[],results:readonly D1Result<Record<string,unknown>>[],descriptors?:readonly AssistantContextReadDescriptor[])=>void;

/** Exact server-allocated INSERT values. Tuple ordering follows the existing
 * table INSERTs; eventWrites is the complete 17-value eventWriteBindings result.
 * Never supplied by the browser, persisted as lineage, or copied to a response. */
export type AssistantOwnSendFootprint={streamId:string;sourceHead:number;actorUserId:string;turnId:string;
  memoryAnswer?:{version:1};
  scope:null|{organizationId:string;projectAccessId:string;projectId:string;ownerUserId:string};
  eventWrites:readonly (readonly AssistantSourceSqlValue[])[];contents:readonly (readonly AssistantSourceSqlValue[])[];
  receipts:readonly (readonly AssistantSourceSqlValue[])[];resources:readonly (readonly AssistantSourceSqlValue[])[];retentions:readonly (readonly AssistantSourceSqlValue[])[]};

/** Structured answers have a third private manifest, not a third event. The
 * explicit tuple also binds personal document custody absent from scope. */
export type AssistantStructuredOwnSendFootprint=Omit<AssistantOwnSendFootprint,"memoryAnswer"> & {
  memoryAnswer:{version:2};projectId:string;documentId:string;manifestContentId:string};
export type AssistantStructuredOwnHead={streamId:string;sourceHead:number};

const MAX_STATEMENTS=32,MAX_ROWS=8192,MAX_BYTES=2*1024*1024,MAX_OWN_EVENTS=66;
const witnesses=new WeakMap<AssistantContext,AssistantContextReadWitness>();
type CapturedRead={statement:D1PreparedStatement;rows:string[];columns:string[];values:unknown[][];descriptor?:AssistantContextReadDescriptor;
  ownGuard?:(own:AssistantOwnSendFootprint)=>BudgetReservationGuard;
  structuredOwnGuard?:(own:AssistantStructuredOwnSendFootprint)=>BudgetReservationGuard;
  structuredOwnerHead?:AssistantStructuredOwnHead};

function canonical(value:unknown,depth=0):unknown{
  if(depth>32)throw new Error("context_source_shape");
  if(value===null||typeof value==="string"||typeof value==="boolean"||typeof value==="number"&&Number.isFinite(value))return value;
  if(Array.isArray(value))return value.map(item=>canonical(item,depth+1));
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0)
    .map(([key,item])=>[key,canonical(item,depth+1)]));
  throw new Error("context_source_shape");
}

const byteLength=(value:string)=>new TextEncoder().encode(value).byteLength;
const scalar=(value:unknown):value is AssistantSourceSqlValue=>value===null||typeof value==="string"||typeof value==="number"&&Number.isFinite(value);
const identifier=(value:unknown):value is string=>typeof value==="string"&&value.length>0&&value.length<=240;
function descriptorCopy(descriptor:AssistantContextReadDescriptor){
  if(!/^\s*(?:SELECT|WITH)\b/iu.test(descriptor.sql)||descriptor.sql.length>90_000||descriptor.bindings.length>99
    ||descriptor.bindings.some(value=>!scalar(value)))throw new Error("context_source_descriptor");
  return{...descriptor,bindings:[...descriptor.bindings]};
}

/** No own-row exemption exists until this validates the exact writer footprint. */
function ownSendCopy(input:AssistantOwnSendFootprint):AssistantOwnSendFootprint{
  const encoded=JSON.stringify(canonical(input));if(byteLength(encoded)>MAX_BYTES)throw new Error("context_source_limit");
  const own=JSON.parse(encoded) as AssistantOwnSendFootprint;
  if(!identifier(own.streamId)||!own.streamId.startsWith("creative:")||!identifier(own.actorUserId)||!identifier(own.turnId)
    ||!Number.isSafeInteger(own.sourceHead)||own.sourceHead<0||!Array.isArray(own.eventWrites)
    ||own.eventWrites.length<2||own.eventWrites.length>MAX_OWN_EVENTS)throw new Error("context_own_send_shape");
  const tables:Array<[readonly (readonly AssistantSourceSqlValue[])[],number]>=[
    [own.eventWrites,17],[own.contents,7],[own.receipts,5],[own.resources,10],[own.retentions,9]];
  for(const[rows,width]of tables)if(!Array.isArray(rows)||rows.length>MAX_OWN_EVENTS||rows.some(row=>!Array.isArray(row)||row.length!==width||row.some(value=>!scalar(value))))throw new Error("context_own_send_shape");
  const count=own.eventWrites.length,scope=own.scope;
  const memory=own.memoryAnswer!==undefined;
  if(memory&&(!own.memoryAnswer||Object.keys(own.memoryAnswer).length!==1||own.memoryAnswer.version!==1||count!==2))throw new Error("context_own_memory_shape");
  if(scope&&(!identifier(scope.organizationId)||!identifier(scope.projectAccessId)||!identifier(scope.projectId)||!identifier(scope.ownerUserId)))throw new Error("context_own_send_scope");
  if(own.streamId!=="creative:"+(scope?.ownerUserId??own.actorUserId)||own.contents.length!==count||own.receipts.length!==count
    ||own.resources.length!==(scope?count:0)||own.retentions.length!==(scope?count:0))throw new Error("context_own_send_shape");
  if(new Set(own.eventWrites.map(row=>row[0])).size!==count||new Set(own.contents.map(row=>row[0])).size!==count
    ||new Set(own.receipts.map(row=>row[1])).size!==count)throw new Error("context_own_send_duplicate");
  for(const[index,event]of own.eventWrites.entries()){
    const content=own.contents[index]!,receipt=own.receipts[index]!,kind=index===0?"chat-user":index===1?(memory?"chat-assistant-memory":"chat-assistant"):"assistant-action";
    if(!identifier(event[0])||!identifier(content[0])||event[1]!==own.streamId||event[2]!==own.sourceHead+index+1
      ||event[5]!==(index<2?"user:"+own.actorUserId:"model:forma-assistant")||event[6]!==(index<2?"web:assistant":"server:assistant")
      ||event[7]!==own.actorUserId+":"+own.turnId||event[8]!==(index===0?null:own.eventWrites[index===1?0:1]![0])
      ||event[9]!==null||event[10]!==1||event[11]!==(index===0?"ChatMessageSent":index===1?"AssistantReasoned":"MutationProposed")
      ||event[13]!==(scope?.ownerUserId??own.actorUserId)||content[1]!==own.actorUserId||content[2]!==kind||content[6]!==null
      ||typeof content[3]!=="string"||!Number.isFinite(Date.parse(String(content[4])))||!Number.isFinite(Date.parse(String(content[5])))
      ||receipt[0]!==own.streamId||receipt[2]!==event[0]||receipt[3]!==event[2]||!identifier(receipt[1]))throw new Error("context_own_send_binding");
    const payload={...JSON.parse(String(event[12])),...(event[16]===null?{}:JSON.parse(String(event[16])))} as Record<string,unknown>;
    if(payload.content_ref!==content[0]||payload.turn_id!==own.turnId||payload.actor_user_id!==own.actorUserId
      ||index===1&&payload.operation!=="creative-chat"||scope&&(event[14]!==scope.projectId||payload.project_id!==scope.projectId))throw new Error("context_own_send_payload");
    if(index===1&&(memory?(payload.memory_origin_version!==1||Object.hasOwn(payload,"proposal_count")):Object.hasOwn(payload,"memory_origin_version")))throw new Error("context_own_memory_payload");
    if(index===1&&memory&&(payload.organization_id!==(scope?.organizationId??null)||payload.project_access_id!==(scope?.projectAccessId??null)
      ||payload.owner_user_id!==(scope?.ownerUserId??own.actorUserId)))throw new Error("context_own_memory_scope");
    if(scope){
      const resource=own.resources[index]!,retention=own.retentions[index]!;
      if(JSON.stringify(resource)!==JSON.stringify([scope.projectAccessId,"content",content[0],scope.organizationId,scope.projectId,scope.ownerUserId,"actor_private",null,own.actorUserId,content[4]])
        ||retention[0]!==content[0]||retention[1]!==scope.organizationId||retention[2]!==scope.projectAccessId||retention[3]!==scope.projectId
        ||retention[4]!==own.actorUserId||retention[5]!=="transient-private"||!Number.isSafeInteger(retention[6])
        ||retention[7]!==content[5]||retention[8]!==content[4])throw new Error("context_own_send_custody");
    }
  }
  return own;
}

/** Kept separate from the original/v1 validator: no legacy exemption can
 * manufacture the manifest body or accept a hidden/overridden public marker. */
const structuredIso=(value:unknown):value is string=>typeof value==="string"&&Number.isFinite(Date.parse(value))
  &&new Date(value).toISOString()===value;
function structuredOwnSendCopy(input:AssistantStructuredOwnSendFootprint):AssistantStructuredOwnSendFootprint{
  // Snapshot own DATA descriptors before touching values. Do not invoke input
  // accessors, iterators or toJSON, and never serialize the caller object.
  const dataRecord=(value:unknown,keys:readonly string[]):Record<string,unknown>=>{
    if(!value||typeof value!=="object"||Array.isArray(value)
      ||Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)throw new Error("context_own_structured_shape");
    const descriptors=Object.getOwnPropertyDescriptors(value);
    if(Reflect.ownKeys(descriptors).length!==keys.length
      ||keys.some(key=>!Object.hasOwn(descriptors,key)||!Object.hasOwn(descriptors[key]!,"value")))throw new Error("context_own_structured_shape");
    return Object.fromEntries(keys.map(key=>[key,descriptors[key]!.value]));
  };
  const arrayData=(value:unknown,length:number):Record<string,PropertyDescriptor>=>{
    if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype
      ||Object.getOwnPropertyDescriptor(value,"length")?.value!==length)throw new Error("context_own_structured_shape");
    const descriptors=Object.getOwnPropertyDescriptors(value);
    if(Reflect.ownKeys(descriptors).length!==length+1)throw new Error("context_own_structured_shape");
    for(let index=0;index<length;index++)if(!Object.hasOwn(descriptors,String(index))
      ||!Object.hasOwn(descriptors[String(index)]!,"value"))throw new Error("context_own_structured_shape");
    return descriptors;
  };
  const fields=["streamId","sourceHead","actorUserId","turnId","memoryAnswer","scope","eventWrites","contents","receipts","resources","retentions",
    "projectId","documentId","manifestContentId"];
  const raw=dataRecord(input,fields),marker=dataRecord(raw.memoryAnswer,["version"]);
  const scopeRaw=raw.scope===null?null:dataRecord(raw.scope,["organizationId","projectAccessId","projectId","ownerUserId"]);
  if([raw.streamId,raw.actorUserId,raw.turnId,raw.projectId,raw.documentId,raw.manifestContentId].some(value=>!identifier(value))
    ||!Number.isSafeInteger(raw.sourceHead)||Number(raw.sourceHead)<0||!Number.isSafeInteger(Number(raw.sourceHead)+2)||marker.version!==2
    ||scopeRaw&&Object.values(scopeRaw).some(value=>!identifier(value)))throw new Error("context_own_structured_shape");
  let inputBytes=0;
  const rowsCopy=(value:unknown,count:number,width:number):AssistantSourceSqlValue[][]=>{
    const rows=arrayData(value,count),copied:AssistantSourceSqlValue[][]=[];
    for(let index=0;index<count;index++){
      const row=arrayData(rows[String(index)]!.value,width),values:AssistantSourceSqlValue[]=[];
      for(let column=0;column<width;column++){
        const value:unknown=row[String(column)]!.value;
        if(!scalar(value))throw new Error("context_own_structured_shape");
        if(typeof value==="string"){
          if(value.length>MAX_BYTES)throw new Error("context_source_limit");
          inputBytes+=byteLength(value);if(inputBytes>MAX_BYTES)throw new Error("context_source_limit");
        }
        values.push(value);
      }
      copied.push(values);
    }
    return copied;
  };
  const copied:AssistantStructuredOwnSendFootprint={
    streamId:raw.streamId as string,sourceHead:raw.sourceHead as number,actorUserId:raw.actorUserId as string,turnId:raw.turnId as string,
    projectId:raw.projectId as string,documentId:raw.documentId as string,manifestContentId:raw.manifestContentId as string,memoryAnswer:{version:2},
    scope:scopeRaw?{organizationId:scopeRaw.organizationId as string,projectAccessId:scopeRaw.projectAccessId as string,
      projectId:scopeRaw.projectId as string,ownerUserId:scopeRaw.ownerUserId as string}:null,
    eventWrites:rowsCopy(raw.eventWrites,2,17),contents:rowsCopy(raw.contents,3,7),receipts:rowsCopy(raw.receipts,2,5),
    resources:rowsCopy(raw.resources,scopeRaw?3:0,10),retentions:rowsCopy(raw.retentions,scopeRaw?3:0,9)};
  const encoded=JSON.stringify(canonical(copied));if(byteLength(encoded)>MAX_BYTES)throw new Error("context_source_limit");
  const own=JSON.parse(encoded) as AssistantStructuredOwnSendFootprint,scope=own.scope;
  if(!identifier(own.streamId)||!own.streamId.startsWith("creative:")||!identifier(own.actorUserId)||!identifier(own.turnId)
    ||!identifier(own.projectId)||!identifier(own.documentId)||!identifier(own.manifestContentId)
    ||!Number.isSafeInteger(own.sourceHead)||own.sourceHead<0||!Number.isSafeInteger(own.sourceHead+2)
    ||!own.memoryAnswer||Object.keys(own.memoryAnswer).length!==1||own.memoryAnswer.version!==2
    ||!Array.isArray(own.eventWrites)||own.eventWrites.length!==2)throw new Error("context_own_structured_shape");
  if(scope!==null&&(!scope||typeof scope!=="object"||Array.isArray(scope)||Object.keys(scope).length!==4
    ||!identifier(scope.organizationId)||!identifier(scope.projectAccessId)||!identifier(scope.projectId)
    ||!identifier(scope.ownerUserId)||scope.projectId!==own.projectId))throw new Error("context_own_structured_scope");
  if(own.streamId!=="creative:"+(scope?.ownerUserId??own.actorUserId))throw new Error("context_own_structured_scope");
  const tables:Array<[readonly (readonly AssistantSourceSqlValue[])[],number,number]>=[
    [own.eventWrites,17,2],[own.contents,7,3],[own.receipts,5,2],[own.resources,10,scope?3:0],[own.retentions,9,scope?3:0]];
  for(const[rows,width,count]of tables)if(!Array.isArray(rows)||rows.length!==count
    ||rows.some(row=>!Array.isArray(row)||row.length!==width||row.some(value=>!scalar(value))))throw new Error("context_own_structured_shape");
  if(new Set(own.eventWrites.map(row=>row[0])).size!==2||new Set(own.contents.map(row=>row[0])).size!==3
    ||new Set(own.receipts.map(row=>row[1])).size!==2||own.contents[2]![0]!==own.manifestContentId)throw new Error("context_own_structured_duplicate");
  const payloadKeys=new Set(["actor_user_id","turn_id","project_id","document_id","content_ref","source_surface","operation","deterministic",
    "memory_origin_version","organization_id","project_access_id","owner_user_id","_private_ref"]);
  for(const[index,content]of own.contents.entries()){
    if(!identifier(content[0])||content[1]!==own.actorUserId
      ||content[2]!==["chat-user","chat-assistant-memory","memory-structured-origin"][index]
      ||typeof content[3]!=="string"||!content[3]||index===2&&byteLength(content[3])>65536||content[6]!==null
      ||!structuredIso(content[4])||!structuredIso(content[5])||Date.parse(content[5])<=Date.parse(content[4])
      ||content[4]!==own.eventWrites[index===0?0:1]![4])throw new Error("context_own_structured_content");
    if(scope){
      const resource=own.resources[index]!,retention=own.retentions[index]!;
      if(JSON.stringify(resource)!==JSON.stringify([scope.projectAccessId,"content",content[0],scope.organizationId,scope.projectId,scope.ownerUserId,"actor_private",null,own.actorUserId,content[4]])
        ||retention[0]!==content[0]||retention[1]!==scope.organizationId||retention[2]!==scope.projectAccessId||retention[3]!==scope.projectId
        ||retention[4]!==own.actorUserId||retention[5]!=="transient-private"||!Number.isSafeInteger(retention[6])||Number(retention[6])<0
        ||retention[7]!==content[5]||retention[8]!==content[4])throw new Error("context_own_structured_custody");
    }
  }
  for(const[index,event]of own.eventWrites.entries()){
    const content=own.contents[index]!,receipt=own.receipts[index]!;
    if(!identifier(event[0])||event[1]!==own.streamId||event[2]!==own.sourceHead+index+1
      ||!structuredIso(event[3])||!structuredIso(event[4])
      ||event[5]!=="user:"+own.actorUserId||event[6]!=="web:assistant"||event[7]!==own.actorUserId+":"+own.turnId
      ||event[8]!==(index===0?null:own.eventWrites[0]![0])||event[9]!==null||event[10]!==1
      ||event[11]!==(index===0?"ChatMessageSent":"AssistantReasoned")||event[13]!==(scope?.ownerUserId??own.actorUserId)
      ||event[14]!==own.projectId||event[15]!==own.documentId
      ||receipt[0]!==own.streamId||!identifier(receipt[1])||receipt[2]!==event[0]||receipt[3]!==event[2]||receipt[4]!==event[4])
      throw new Error("context_own_structured_binding");
    const publicPayload:unknown=JSON.parse(String(event[12])),privatePayload:unknown=event[16]===null?{}:JSON.parse(String(event[16]));
    if(!publicPayload||typeof publicPayload!=="object"||Array.isArray(publicPayload)
      ||!privatePayload||typeof privatePayload!=="object"||Array.isArray(privatePayload))throw new Error("context_own_structured_payload");
    const visible=publicPayload as Record<string,unknown>,secret=privatePayload as Record<string,unknown>,payload={...visible,...secret};
    if(Object.keys(visible).some(key=>!payloadKeys.has(key))||Object.keys(secret).some(key=>!payloadKeys.has(key))
      ||Object.values(visible).some(value=>!scalar(value)&&typeof value!=="boolean")
      ||Object.values(secret).some(value=>!scalar(value)&&typeof value!=="boolean")
      ||Object.keys(secret).some(key=>Object.hasOwn(visible,key)&&secret[key]!==visible[key])
      ||event[16]!==null&&Object.keys(visible).some(key=>key!=="_private_ref"&&!Object.hasOwn(secret,key))
      ||index===0&&Object.hasOwn(payload,"memory_origin_version")
      ||index===1&&visible.memory_origin_version!==2||Object.hasOwn(payload,"proposal_count")
      ||payload.actor_user_id!==own.actorUserId||payload.turn_id!==own.turnId||payload.content_ref!==content[0]
      ||payload.project_id!==own.projectId||payload.document_id!==own.documentId
      ||event[16]!==null&&visible._private_ref!==event[0]||event[16]===null&&Object.hasOwn(visible,"_private_ref")
      ||index===1&&(payload.operation!=="creative-chat"||payload.organization_id!==(scope?.organizationId??null)
        ||payload.project_access_id!==(scope?.projectAccessId??null)||payload.owner_user_id!==(scope?.ownerUserId??own.actorUserId)))
      throw new Error("context_own_structured_payload");
  }
  return own;
}

/** Bounded validated copy only, never a native source/origin authority grant. */
export function copyAssistantStructuredOwnSendFootprint(input:AssistantStructuredOwnSendFootprint):AssistantStructuredOwnSendFootprint{
  return structuredOwnSendCopy(input);
}

const eventColumns="event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,schema_version,type,payload".split(",");
const contentColumns="content_id,owner_id,kind,content,created_at,expires_at,redacted_at".split(",");
const receiptColumns="stream_id,client_event_id,event_id,sequence,created_at".split(",");
const resourceColumns="project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at".split(",");
const retentionColumns="content_id,organization_id,project_access_id,project_id,actor_user_id,classification,policy_version,assigned_expires_at,created_at".split(",");
const exactTuple=(alias:string,columns:readonly string[])=>{
  const leaves=columns.map((column,index)=>`${alias}.${column} IS json_extract(expected.value,'$[${index}]')`);
  // The five fixed nonempty column lists retain their exact leaf and binding order.
  const balanced=(start:number,end:number):string=>{
    if(end-start===1)return leaves[start]!;
    const middle=Math.floor((start+end)/2);
    return `(${balanced(start,middle)} AND ${balanced(middle,end)})`;
  };
  return balanced(0,leaves.length);
};

/** Exact bytes, receipts and current custody in one bounded proof parameter. */
export function assistantOwnSendGuard(input:AssistantOwnSendFootprint):BudgetReservationGuard{
  const own=ownSendCopy(input),value=JSON.stringify(own);
  const table=(path:string,name:string,columns:string[],extra="")=>`NOT EXISTS(SELECT 1 FROM json_each(own.value,'$.${path}') expected WHERE NOT EXISTS(SELECT 1 FROM ${name} actual WHERE ${exactTuple("actual",columns)}${extra}))`;
  const eventProof=table("eventWrites","events",eventColumns,` AND (
    json_extract(expected.value,'$[16]') IS NULL AND NOT EXISTS(SELECT 1 FROM event_private_payloads secret WHERE secret.private_event_id=actual.event_id)
    OR json_extract(expected.value,'$[16]') IS NOT NULL AND EXISTS(SELECT 1 FROM event_private_payloads secret WHERE secret.private_event_id=actual.event_id
      AND(secret.owner_id,secret.project_id,secret.document_id,secret.private_json,secret.created_at,secret.redacted_at)
        IS(json_extract(expected.value,'$[13]'),json_extract(expected.value,'$[14]'),json_extract(expected.value,'$[15]'),json_extract(expected.value,'$[16]'),actual.recorded_at,NULL)))`);
  const ids="SELECT json_extract(value,'$[0]') FROM json_each(own.value,'$.contents')";
  return{sql:`EXISTS(SELECT 1 FROM(SELECT ? AS value) own WHERE
    ((((SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=json_extract(own.value,'$.streamId'))=json_extract(own.value,'$.sourceHead')+json_array_length(own.value,'$.eventWrites')
    AND ${eventProof})
    AND (${table("contents","private_content",contentColumns," AND actual.redacted_at IS NULL AND actual.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')")}
    AND ${table("receipts","event_client_receipts",receiptColumns)}))
    AND ((${table("resources","project_resource_scopes",resourceColumns)}
    AND ${table("retentions","private_content_retention_scopes",retentionColumns)})
    AND((SELECT COUNT(*) FROM project_resource_scopes WHERE resource_kind='content' AND resource_id IN(${ids}))=json_array_length(own.value,'$.resources')
    AND(SELECT COUNT(*) FROM private_content_retention_scopes WHERE content_id IN(${ids}))=json_array_length(own.value,'$.retentions')))))`,bindings:[value]};
}

/** V2 final assertion: both events and all three private bodies must exist.
 * A staged prefix cannot satisfy this proof. Native origin/manifest semantics
 * remain independently certified by the issuer, not by this row footprint. */
export function assistantStructuredOwnSendGuard(input:AssistantStructuredOwnSendFootprint):BudgetReservationGuard{
  const own=structuredOwnSendCopy(input),value=JSON.stringify(own);
  const table=(path:string,name:string,columns:string[],extra="")=>`NOT EXISTS(SELECT 1 FROM json_each(own.value,'$.${path}') expected WHERE NOT EXISTS(SELECT 1 FROM ${name} actual WHERE ${exactTuple("actual",columns)}${extra}))`;
  const eventProof=table("eventWrites","events",eventColumns,` AND (
    json_extract(expected.value,'$[16]') IS NULL AND NOT EXISTS(SELECT 1 FROM event_private_payloads secret WHERE secret.private_event_id=actual.event_id)
    OR json_extract(expected.value,'$[16]') IS NOT NULL AND EXISTS(SELECT 1 FROM event_private_payloads secret WHERE secret.private_event_id=actual.event_id
      AND(secret.owner_id,secret.project_id,secret.document_id,secret.private_json,secret.created_at,secret.redacted_at)
        IS(json_extract(expected.value,'$[13]'),json_extract(expected.value,'$[14]'),json_extract(expected.value,'$[15]'),json_extract(expected.value,'$[16]'),actual.recorded_at,NULL)))`);
  const ids="SELECT json_extract(value,'$[0]') FROM json_each(own.value,'$.contents')";
  return{sql:`EXISTS(SELECT 1 FROM(SELECT ? AS value) own WHERE
    ((((SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=json_extract(own.value,'$.streamId'))=json_extract(own.value,'$.sourceHead')+json_array_length(own.value,'$.eventWrites')
    AND ${eventProof})
    AND (${table("contents","private_content",contentColumns," AND actual.redacted_at IS NULL AND actual.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')")}
    AND ${table("receipts","event_client_receipts",receiptColumns)}))
    AND ((${table("resources","project_resource_scopes",resourceColumns)}
    AND ${table("retentions","private_content_retention_scopes",retentionColumns)})
    AND((SELECT COUNT(*) FROM project_resource_scopes WHERE resource_kind='content' AND resource_id IN(${ids}))=json_array_length(own.value,'$.resources')
    AND(SELECT COUNT(*) FROM private_content_retention_scopes WHERE content_id IN(${ids}))=json_array_length(own.value,'$.retentions')))))`,bindings:[value]};
}

/** Synchronization indexes the two native conversation events, not
 * MutationProposed (absent from PROJECT_EVENT_TYPES). Dense project positions
 * follow the unchanged non-own head. No timestamp/revision is invented. */
export function assistantOwnSendProjectIndexGuard(input:AssistantOwnSendFootprint,requireComplete=false):BudgetReservationGuard{
  const own=ownSendCopy(input);if(!own.scope)throw new Error("context_own_send_scope");
  const ownIds="SELECT json_extract(value,'$[0]') FROM json_each(own.value,'$.eventWrites')";
  const exact=`(custody.project_access_id,custody.organization_id,custody.project_id,custody.owner_user_id,custody.source_stream_id,custody.source_sequence,custody.actor_user_id)
    IS(json_extract(own.value,'$.scope.projectAccessId'),json_extract(own.value,'$.scope.organizationId'),json_extract(own.value,'$.scope.projectId'),json_extract(own.value,'$.scope.ownerUserId'),
      json_extract(own.value,'$.streamId'),json_extract(expected.value,'$[2]'),json_extract(own.value,'$.actorUserId'))
    AND custody.project_sequence=(SELECT COALESCE(MAX(project_sequence),0) FROM project_event_scopes prior
      WHERE prior.project_access_id=json_extract(own.value,'$.scope.projectAccessId') AND prior.organization_id=json_extract(own.value,'$.scope.organizationId')
        AND prior.event_id NOT IN(${ownIds}))+CAST(expected.key AS INTEGER)+1`;
  return{sql:`EXISTS(SELECT 1 FROM(SELECT ? AS value) own WHERE NOT EXISTS(SELECT 1 FROM json_each(own.value,'$.eventWrites') expected
    WHERE CAST(expected.key AS INTEGER)>=2 AND EXISTS(SELECT 1 FROM project_event_scopes unexpected WHERE unexpected.event_id=json_extract(expected.value,'$[0]'))
      OR CAST(expected.key AS INTEGER)<2 AND ${requireComplete?"":"EXISTS(SELECT 1 FROM project_event_scopes present WHERE present.event_id=json_extract(expected.value,'$[0]')) AND "}
        NOT EXISTS(SELECT 1 FROM project_event_scopes custody WHERE custody.event_id=json_extract(expected.value,'$[0]') AND ${exact})))`,bindings:[JSON.stringify(own)]};
}

/** Explicit v2 project suffix guard. Final use must require both indexes. */
export function assistantStructuredOwnSendProjectIndexGuard(input:AssistantStructuredOwnSendFootprint,requireComplete=true):BudgetReservationGuard{
  const own=structuredOwnSendCopy(input);if(!own.scope)throw new Error("context_own_send_scope");
  const ownIds="SELECT json_extract(value,'$[0]') FROM json_each(own.value,'$.eventWrites')";
  const exact=`(custody.project_access_id,custody.organization_id,custody.project_id,custody.owner_user_id,custody.source_stream_id,custody.source_sequence,custody.actor_user_id)
    IS(json_extract(own.value,'$.scope.projectAccessId'),json_extract(own.value,'$.scope.organizationId'),json_extract(own.value,'$.scope.projectId'),json_extract(own.value,'$.scope.ownerUserId'),
      json_extract(own.value,'$.streamId'),json_extract(expected.value,'$[2]'),json_extract(own.value,'$.actorUserId'))
    AND custody.project_sequence=(SELECT COALESCE(MAX(project_sequence),0) FROM project_event_scopes prior
      WHERE prior.project_access_id=json_extract(own.value,'$.scope.projectAccessId') AND prior.organization_id=json_extract(own.value,'$.scope.organizationId')
        AND prior.event_id NOT IN(${ownIds}))+CAST(expected.key AS INTEGER)+1`;
  return{sql:`EXISTS(SELECT 1 FROM(SELECT ? AS value) own WHERE NOT EXISTS(SELECT 1 FROM json_each(own.value,'$.eventWrites') expected
    WHERE CAST(expected.key AS INTEGER)>=2 AND EXISTS(SELECT 1 FROM project_event_scopes unexpected WHERE unexpected.event_id=json_extract(expected.value,'$[0]'))
      OR CAST(expected.key AS INTEGER)<2 AND ${requireComplete?"":"EXISTS(SELECT 1 FROM project_event_scopes present WHERE present.event_id=json_extract(expected.value,'$[0]')) AND "}
        NOT EXISTS(SELECT 1 FROM project_event_scopes custody WHERE custody.event_id=json_extract(expected.value,'$[0]') AND ${exact})))`,bindings:[JSON.stringify(own)]};
}

/** For source/store guards whose captured SELECT did not expose an owner-head
 * descriptor. The caller records the original head explicitly, never by SQL
 * parsing. This guard is a full suffix proof, not only MAX(sequence)+2. */
export function assistantStructuredOwnSendOwnerHeadGuard(input:AssistantStructuredOwnSendFootprint,streamId:string,sourceHead:number):BudgetReservationGuard{
  const own=structuredOwnSendCopy(input);
  if(own.streamId!==streamId||own.sourceHead!==sourceHead)throw new Error("context_own_structured_head");
  return assistantStructuredOwnSendGuard(own);
}

export function assistantStructuredOwnSendProjectHeadGuard(input:AssistantStructuredOwnSendFootprint,projectAccessId:string,organizationId:string,sourceHead:number):BudgetReservationGuard{
  const own=structuredOwnSendCopy(input);
  if(!own.scope||own.scope.projectAccessId!==projectAccessId||own.scope.organizationId!==organizationId
    ||!Number.isSafeInteger(sourceHead)||sourceHead<0||!Number.isSafeInteger(sourceHead+2))throw new Error("context_own_structured_head");
  const suffix=assistantStructuredOwnSendProjectIndexGuard(own,true);
  return{sql:`(${suffix.sql}) AND (SELECT COALESCE(MAX(project_sequence),0) FROM project_event_scopes WHERE project_access_id=? AND organization_id=?)=?`,
    bindings:[...suffix.bindings,projectAccessId,organizationId,sourceHead+2]};
}

/** A request-local read certificate, never persisted or copied into a response.
 * Replay the original SELECTs, not a helper that might synchronize or mutate.
 * Compare complete row multisets: DB row/property ordering is not authority. */
export class AssistantContextReadWitness<Value=AssistantContext>{
  #reads:CapturedRead[]=[];
  #rows=0;
  #bytes=0;
  #valid=true;
  #sealed=false;
  #validUntil:number|null=null;
  #capturedReads=0;
  #context:string|null=null;
  #env:WorkerEnv;
  #originalDb:WorkerEnv["DB"];
  #own:AssistantOwnSendFootprint|null=null;
  #structuredOwn:AssistantStructuredOwnSendFootprint|null=null;
  constructor(env:WorkerEnv){this.#env=env;this.#originalDb=env.DB;}

  invalidate(){this.#valid=false;this.#reads=[];}

  readonly observe:AssistantContextReadObserver=(statements,results,descriptors)=>{
    if(!this.#valid)return;
    if(this.#sealed||statements.length!==results.length||descriptors&&descriptors.length!==statements.length||this.#reads.length+statements.length>MAX_STATEMENTS){this.invalidate();return;}
    try{
      for(const [index,statement]of statements.entries()){
        const result=results[index];
        if(!result||result.success===false||!Array.isArray(result.results))throw new Error("context_source_result");
        this.#rows+=result.results.length;if(this.#rows>MAX_ROWS)throw new Error("context_source_limit");
        const columns=Object.keys(result.results[0]??{}).sort(),values:unknown[][]=[];
        const rows=result.results.map(row=>{
          if(JSON.stringify(Object.keys(row).sort())!==JSON.stringify(columns))throw new Error("context_source_columns");
          const serialized=JSON.stringify(canonical(row));
          this.#bytes+=new TextEncoder().encode(serialized).byteLength;
          if(this.#bytes>MAX_BYTES)throw new Error("context_source_limit");
          values.push(columns.map(column=>row[column]));return serialized;
        }).sort();
        this.#reads.push({statement,rows,columns,values,...(descriptors?{descriptor:descriptorCopy(descriptors[index]!)}:{})});
        this.#capturedReads++;
      }
    }catch{this.invalidate();}
  };

  require(guard:BudgetReservationGuard,ownGuard?:(own:AssistantOwnSendFootprint)=>BudgetReservationGuard,
    structuredOwnGuard?:(own:AssistantStructuredOwnSendFootprint)=>BudgetReservationGuard){
    if(!this.#valid)return;
    if(this.#sealed||this.#reads.length>=MAX_STATEMENTS||structuredOwnGuard&&this.#env.DB!==this.#originalDb){this.invalidate();return;}
    try{
      const descriptor=descriptorCopy({sql:"SELECT CASE WHEN ("+guard.sql+") THEN 1 ELSE 0 END AS context_source_current",bindings:guard.bindings});
      const statement=this.#env.DB.prepare(descriptor.sql).bind(...descriptor.bindings);
      this.#reads.push({statement,rows:[JSON.stringify({context_source_current:1})],columns:["context_source_current"],values:[[1]],descriptor,ownGuard,structuredOwnGuard});
    }catch{this.invalidate();}
  }

  /** Explicit native guard callback plus an optional source-declared head.
   * Only an original guard that asserts that head should supply this metadata.
   * No extra read or authority is invented; strict prewrite SQL stays exact. */
  requireStructuredOwnGuard(guard:BudgetReservationGuard,callback:(own:AssistantStructuredOwnSendFootprint)=>BudgetReservationGuard,
    ownerHead?:AssistantStructuredOwnHead){
    if(ownerHead&&(!identifier(ownerHead.streamId)||!Number.isSafeInteger(ownerHead.sourceHead)||ownerHead.sourceHead<0)){
      this.invalidate();return;
    }
    const count=this.#reads.length;this.require(guard,undefined,callback);
    if(ownerHead&&this.#valid&&this.#reads.length===count+1)this.#reads[count]!.structuredOwnerHead={...ownerHead};
  }

  before(deadline:string|null){
    if(this.#sealed){this.invalidate();return;}
    if(deadline===null)return;
    const value=Date.parse(deadline);
    if(!Number.isFinite(value)){this.invalidate();return;}
    this.#validUntil=this.#validUntil===null?value:Math.min(this.#validUntil,value);
  }

  seal(context:Value){
    if(this.#sealed)return;
    try{this.#context=JSON.stringify(canonical(context));}catch{this.invalidate();}
    if(this.#capturedReads===0)this.invalidate();
    if(this.#validUntil!==null)this.require({sql:"?>strftime('%Y-%m-%dT%H:%M:%fZ','now')",bindings:[new Date(this.#validUntil).toISOString()]});
    this.#sealed=true;
  }

  statements(){return this.#valid&&this.#sealed?this.#reads.map(read=>read.statement):[];}
  context():Value|null{return this.#context===null?null:JSON.parse(this.#context) as Value;}

  ownerHead(streamId:string):number|null{
    if(!this.#valid)return null;
    const heads=this.#reads.filter(read=>read.descriptor?.role==="owner-head"&&read.descriptor.streamId===streamId)
      .map(read=>read.rows.length===1?JSON.parse(read.rows[0]!).head:NaN);
    return heads.length>0&&heads.every(head=>Number.isSafeInteger(head)&&head>=0&&head===heads[0])?heads[0]:null;
  }

  projectHead(projectAccessId:string,organizationId:string):number|null{
    if(!this.#valid)return null;
    const heads=this.#reads.filter(read=>read.descriptor?.role==="project-head"
      &&read.descriptor.projectAccessId===projectAccessId&&read.descriptor.organizationId===organizationId)
      .map(read=>read.rows.length===1?JSON.parse(read.rows[0]!).head:NaN);
    return heads.length>0&&heads.every(head=>Number.isSafeInteger(head)&&head>=0&&head===heads[0])?heads[0]:null;
  }

  /** Run before every own INSERT in the SAME atomic batch. The deliberate
   * malformed-JSON SELECT aborts the entire transaction on a stale source.
   * No opaque prepared-statement inspection and no persistent proof table. */
  precommitStatements():D1PreparedStatement[]{
    if(!this.#valid||!this.#sealed||this.#own||this.#structuredOwn||this.#reads.length===0||this.#validUntil!==null&&Date.now()>=this.#validUntil)
      throw new Error("assistant_context_source_unavailable");
    return this.#reads.map(read=>{
      const descriptor=read.descriptor;
      if(!descriptor||read.values.some(row=>row.some(value=>!scalar(value)||typeof value==="number"&&!Number.isSafeInteger(value))))throw new Error("assistant_context_source_unavailable");
      const values=JSON.stringify(read.values),column=(name:string)=>{
        const field='captured."'+name.replaceAll('"','""')+'"';
        // A SELECT json_array(...) column reaches D1 as text. Strip SQLite's
        // transient JSON subtype so nested provenance arrays stay exact strings.
        return `CASE WHEN typeof(${field})='text' THEN ${field}||'' ELSE ${field} END`;
      };
      const actual=read.columns.length?`SELECT json_array(${read.columns.map(column).join(",")}) AS value,COUNT(*) AS n FROM captured GROUP BY 1`
        :"SELECT '[]' AS value,COUNT(*) AS n FROM captured GROUP BY 1";
      const sql=`WITH captured AS (${descriptor.sql}), actual AS (${actual}),
        expected AS (SELECT json(value) AS value,COUNT(*) AS n FROM json_each(?) GROUP BY 1)
        SELECT CASE WHEN NOT EXISTS(SELECT value,n FROM actual EXCEPT SELECT value,n FROM expected)
          AND NOT EXISTS(SELECT value,n FROM expected EXCEPT SELECT value,n FROM actual)
          THEN 1 ELSE json_extract('assistant_context_source_changed','$') END AS context_source_asserted`;
      return this.#env.DB.prepare(sql).bind(...descriptor.bindings,values);
    });
  }

  /** A distinct sealed copy. Original GET/precommit certificates never acquire
   * an own-write exemption, even if callers later mutate the input footprint. */
  bindOwnSend(input:AssistantOwnSendFootprint):AssistantContextReadWitness<Value>{
    const bound=new AssistantContextReadWitness<Value>(this.#env);bound.#context=this.#context;bound.#sealed=true;
    try{
      if(!this.#valid||!this.#sealed||this.#own||this.#structuredOwn||this.#reads.length>=MAX_STATEMENTS)throw new Error("context_own_send_witness");
      const own=ownSendCopy(input);
      if(this.ownerHead(own.streamId)!==own.sourceHead||this.#bytes+byteLength(JSON.stringify(own))>MAX_BYTES)throw new Error("context_own_send_head");
      const eventIds=JSON.stringify(own.eventWrites.map(event=>event[0]));bound.#own=own;bound.#validUntil=this.#validUntil;
      bound.#rows=this.#rows;bound.#bytes=this.#bytes;bound.#capturedReads=this.#capturedReads;
      bound.#reads=this.#reads.map(read=>{
        const descriptor=read.descriptor;if(!descriptor)throw new Error("context_source_descriptor");
        let statement=read.statement;
        if(read.ownGuard){
          const guard=read.ownGuard(JSON.parse(JSON.stringify(own)) as AssistantOwnSendFootprint);
          statement=this.#env.DB.prepare("SELECT CASE WHEN ("+guard.sql+") THEN 1 ELSE 0 END AS context_source_current").bind(...guard.bindings);
        }else if(descriptor.role==="owner-head"){
          if(descriptor.streamId!==own.streamId)throw new Error("context_own_send_head");
          statement=this.#env.DB.prepare("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=? AND event_id NOT IN(SELECT value FROM json_each(?))").bind(own.streamId,eventIds);
        }else if(descriptor.role==="project-head"){
          if(!own.scope||descriptor.projectAccessId!==own.scope.projectAccessId||descriptor.organizationId!==own.scope.organizationId)throw new Error("context_own_send_scope");
          statement=this.#env.DB.prepare("SELECT COALESCE(MAX(project_sequence),0) AS head FROM project_event_scopes WHERE project_access_id=? AND organization_id=? AND event_id NOT IN(SELECT value FROM json_each(?))").bind(own.scope.projectAccessId,own.scope.organizationId,eventIds);
        }
        return{...read,statement};
      });
      const guard=assistantOwnSendGuard(own);
      bound.#reads.push({statement:this.#env.DB.prepare("SELECT CASE WHEN ("+guard.sql+") THEN 1 ELSE 0 END AS context_source_current").bind(...guard.bindings),
        rows:[JSON.stringify({context_source_current:1})],columns:["context_source_current"],values:[[1]]});
    }catch{bound.invalidate();}
    return bound;
  }

  /** Separate successor: only explicitly registered structured callbacks may
   * relax head-sensitive reads. Original and v1 witnesses remain strict.
   * Complete shared indexing is part of final acceptance, never a prefix. */
  bindStructuredOwnSend(input:AssistantStructuredOwnSendFootprint):AssistantContextReadWitness<Value>{
    const bound=new AssistantContextReadWitness<Value>(this.#env);bound.#context=this.#context;bound.#sealed=true;
    try{
      const own=structuredOwnSendCopy(input),extra=own.scope?2:1;
      if(!this.#valid||!this.#sealed||this.#own||this.#structuredOwn||this.#env.DB!==this.#originalDb||this.#reads.length+extra>MAX_STATEMENTS)throw new Error("context_own_structured_witness");
      const descriptorHeads=this.#reads.filter(read=>read.descriptor?.role==="owner-head").map(read=>({
        streamId:read.descriptor!.streamId,sourceHead:read.rows.length===1?JSON.parse(read.rows[0]!).head:NaN}));
      const heads=[...descriptorHeads,...this.#reads.flatMap(read=>read.structuredOwnerHead?[read.structuredOwnerHead]:[])];
      if(heads.length===0||heads.some(head=>head.streamId!==own.streamId||head.sourceHead!==own.sourceHead)
        ||this.#bytes+byteLength(JSON.stringify(own))>MAX_BYTES)throw new Error("context_own_structured_head");
      const eventIds=JSON.stringify(own.eventWrites.map(event=>event[0]));bound.#structuredOwn=own;bound.#validUntil=this.#validUntil;
      bound.#rows=this.#rows;bound.#bytes=this.#bytes;bound.#capturedReads=this.#capturedReads;
      bound.#reads=this.#reads.map(read=>{
        const descriptor=read.descriptor;if(!descriptor)throw new Error("context_source_descriptor");
        let statement=read.statement,nextDescriptor=descriptor;
        if(read.structuredOwnGuard){
          const guard=read.structuredOwnGuard(JSON.parse(JSON.stringify(own)) as AssistantStructuredOwnSendFootprint);
          const checked=descriptorCopy({sql:"SELECT CASE WHEN ("+guard.sql+") THEN 1 ELSE 0 END AS context_source_current",bindings:guard.bindings});
          nextDescriptor=checked;statement=this.#originalDb.prepare(checked.sql).bind(...checked.bindings);
        }else if(read.ownGuard)throw new Error("context_own_structured_callback");
        else if(descriptor.role==="owner-head"){
          if(descriptor.streamId!==own.streamId)throw new Error("context_own_structured_head");
          nextDescriptor={...descriptor,sql:"SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=? AND event_id NOT IN(SELECT value FROM json_each(?))",bindings:[own.streamId,eventIds]};
          statement=this.#originalDb.prepare(nextDescriptor.sql).bind(...nextDescriptor.bindings);
        }else if(descriptor.role==="project-head"){
          if(!own.scope||descriptor.projectAccessId!==own.scope.projectAccessId||descriptor.organizationId!==own.scope.organizationId)throw new Error("context_own_structured_scope");
          nextDescriptor={...descriptor,sql:"SELECT COALESCE(MAX(project_sequence),0) AS head FROM project_event_scopes WHERE project_access_id=? AND organization_id=? AND event_id NOT IN(SELECT value FROM json_each(?))",bindings:[own.scope.projectAccessId,own.scope.organizationId,eventIds]};
          statement=this.#originalDb.prepare(nextDescriptor.sql).bind(...nextDescriptor.bindings);
        }else if(descriptor.role==="ascending-events"||descriptor.role==="resources"||descriptor.role==="content-allowlist"){
          // Wrap the original declared fixed-prefix SELECT; do not inspect or
          // rewrite its predicates. The final exact-row proof uses this same
          // bounded own-row exclusion rather than a JavaScript-only filter.
          const contentIds=JSON.stringify(own.contents.map(content=>content[0]));
          const predicate=descriptor.role==="ascending-events"?"NOT EXISTS(SELECT 1 FROM json_each(?) own_id WHERE own_id.value IS structured_source.event_id)"
            :descriptor.role==="resources"?"NOT(structured_source.resource_kind IS 'content' AND EXISTS(SELECT 1 FROM json_each(?) own_id WHERE own_id.value IS structured_source.resource_id))"
            :"NOT EXISTS(SELECT 1 FROM json_each(?) own_id WHERE own_id.value IS structured_source.content_id)";
          nextDescriptor=descriptorCopy({...descriptor,sql:"SELECT * FROM ("+descriptor.sql+") structured_source WHERE "+predicate,
            bindings:[...descriptor.bindings,descriptor.role==="ascending-events"?eventIds:contentIds]});
          statement=this.#originalDb.prepare(nextDescriptor.sql).bind(...nextDescriptor.bindings);
        }
        return{...read,statement,descriptor:nextDescriptor};
      });
      const guards=[assistantStructuredOwnSendGuard(own),...(own.scope?[assistantStructuredOwnSendProjectIndexGuard(own,true)]:[])];
      for(const guard of guards){
        const descriptor={sql:"SELECT CASE WHEN ("+guard.sql+") THEN 1 ELSE 0 END AS context_source_current",bindings:guard.bindings};
        bound.#reads.push({statement:this.#originalDb.prepare(descriptor.sql).bind(...descriptor.bindings),
          rows:[JSON.stringify({context_source_current:1})],columns:["context_source_current"],values:[[1]],descriptor});
      }
      if(this.#env.DB!==this.#originalDb)throw new Error("context_own_structured_database");
    }catch{bound.invalidate();}
    return bound;
  }

  /** SAME-batch final assertions for the complete structured successor.
   * Each transformed descriptor is retained at binding; false aborts native
   * SQLite, rather than being a SELECT result that can accompany committed data. */
  structuredOwnPrecommitStatements():D1PreparedStatement[]{
    if(!this.#valid||!this.#sealed||this.#own||!this.#structuredOwn||this.#env.DB!==this.#originalDb||this.#reads.length===0||this.#validUntil!==null&&Date.now()>=this.#validUntil)
      throw new Error("assistant_context_source_unavailable");
    const statements=this.#reads.map(read=>{
      const descriptor=read.descriptor;
      if(!descriptor||read.values.some(row=>row.some(value=>!scalar(value)||typeof value==="number"&&!Number.isSafeInteger(value))))throw new Error("assistant_context_source_unavailable");
      const values=JSON.stringify(read.values),column=(name:string)=>{
        const field='captured."'+name.replaceAll('"','""')+'"';
        // A SELECT json_array(...) column reaches D1 as text. Strip SQLite's
        // transient JSON subtype so nested provenance arrays stay exact strings.
        return `CASE WHEN typeof(${field})='text' THEN ${field}||'' ELSE ${field} END`;
      };
      const actual=read.columns.length?`SELECT json_array(${read.columns.map(column).join(",")}) AS value,COUNT(*) AS n FROM captured GROUP BY 1`
        :"SELECT '[]' AS value,COUNT(*) AS n FROM captured GROUP BY 1";
      const sql=`WITH captured AS (${descriptor.sql}), actual AS (${actual}),
        expected AS (SELECT json(value) AS value,COUNT(*) AS n FROM json_each(?) GROUP BY 1)
        SELECT CASE WHEN NOT EXISTS(SELECT value,n FROM actual EXCEPT SELECT value,n FROM expected)
          AND NOT EXISTS(SELECT value,n FROM expected EXCEPT SELECT value,n FROM actual)
          THEN 1 ELSE json_extract('assistant_context_source_changed','$') END AS context_source_asserted`;
      return this.#originalDb.prepare(sql).bind(...descriptor.bindings,values);
    });
    if(this.#env.DB!==this.#originalDb)throw new Error("assistant_context_source_unavailable");
    return statements;
  }

  matches(results:readonly D1Result<Record<string,unknown>>[]){
    if(!this.#valid||!this.#sealed||this.#structuredOwn&&this.#env.DB!==this.#originalDb||results.length!==this.#reads.length||this.#validUntil!==null&&Date.now()>=this.#validUntil)return false;
    let size=0,rows=0;const own=this.#structuredOwn??this.#own,eventIds=new Set(own?.eventWrites.map(event=>event[0])??[]),contentIds=new Set(own?.contents.map(content=>content[0])??[]);
    try{const matched=results.every((result,index)=>{
      if(result.success===false||this.#structuredOwn&&(result.success!==true||(result as typeof result & {error?:unknown}).error!==undefined)||!Array.isArray(result.results))return false;
      const read=this.#reads[index]!,role=read.descriptor?.role;
      // These event readers are ascending fixed-prefix windows: an appended
      // suffix cannot displace original rows. Never reuse for DESC/offset reads.
      const values=result.results.filter(row=>!(own&&(role==="ascending-events"&&eventIds.has(row.event_id as string)
        ||role==="resources"&&row.resource_kind==="content"&&contentIds.has(row.resource_id as string)
        ||role==="content-allowlist"&&contentIds.has(row.content_id as string))));
      rows+=result.results.length;if(rows>MAX_ROWS+MAX_OWN_EVENTS*4)throw new Error("context_source_limit");
      for(const row of result.results){size+=byteLength(JSON.stringify(canonical(row)));if(size>MAX_BYTES)throw new Error("context_source_limit");}
      return values.length===read.rows.length&&values.map(row=>JSON.stringify(canonical(row))).sort().every((row,rowIndex)=>row===read.rows[rowIndex]);
    });
      return matched&&(!this.#structuredOwn||this.#env.DB===this.#originalDb)&&(this.#validUntil===null||Date.now()<this.#validUntil);}
    catch{return false;}
  }
}

export function rememberAssistantContextRead(context:AssistantContext,witness:AssistantContextReadWitness){witness.seal(context);witnesses.set(context,witness);}
export function assistantContextReadWitness(context:AssistantContext){return witnesses.get(context);}

/** Keep independently certified conversation history, not stale page facts or
 * an apparently complete zero-count page. Consumers must show unavailable. */
export function unavailableAssistantPageContext(context:AssistantContext,recentTurns:AssistantContext["recentTurns"]):AssistantContext{
  return{surface:context.surface,scope:{...context.scope,documentId:null},documentTitle:null,selectedItems:[],recentTurns,
    recentActions:[],decisionAtoms:[],relationships:[],unfinishedIntents:[],availableOutputs:[],
    availableOutputKinds:context.availableOutputKinds,capabilities:context.capabilities,playbook:context.playbook,
    totals:{decisions:0,outputs:0,outputsByKind:{}},evidence:{head:0,eventIds:[]},truncated:true};
}

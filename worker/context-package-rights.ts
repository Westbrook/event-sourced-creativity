import { ASSISTANT_STATE_EVENT_TYPES } from "../src/model/assistant-event-views.ts";
import { isOutputRequirementEvent } from "../src/model/output-requirement-events.ts";
import { creativeContextRightsValidity } from "../src/model/context-health.ts";
import { foldEvents, type CreativeBlock, type CreativeEvent } from "../src/model/events.ts";
import { serializeEvent, type WorkerEnv } from "./runtime.ts";
import type { BudgetReservationGuard } from "./pilot-policy.ts";
import { assistantOwnSendGuard, assistantStructuredOwnSendGuard, type AssistantOwnSendFootprint, type AssistantStructuredOwnSendFootprint } from "./assistant-context-source.ts";

// Output ledgers do not feed the native block/document/rights fold used below.
const sourceRightsEventSql = ASSISTANT_STATE_EVENT_TYPES.filter((type) => !isOutputRequirementEvent(type)).map((type) => "'" + type + "'").join(",");

type GovernedSnapshot={
  schema:number;
  organizationId:string;
  sourceProjectAccessId:string;
  sourceDocumentId:string;
  blocks:Array<{sourceBlockId:string;type:string;properties:Record<string,unknown>;rightsExpiresAt?:string|null;source?:unknown}>;
};
// Server-only evidence: never copy these source heads or immutable bytes into a consent/provider payload.
type SourceRightsEvent={eventId:string;sequence:number;type:string;payload:string;privateJson:string|null;privateOwner:string|null};
type SourceRightsDependency=
  |{kind:"source";organizationId:string;projectAccessId:string;projectId:string;ownerUserId:string;sourceHead:number;indexedHead:number;events:SourceRightsEvent[];resources:Array<{kind:string;id:string}>}
  |{kind:"package";organizationId:string;packageId:string;versionId:string;contentSha256:string;contentJson:string};
type SourceRightsValidity={current:boolean;validUntil:string|null;dispatchDependencies?:SourceRightsDependency[]};
type SourceRightsIndexRefresher=(scope:{organizationId:string;projectAccessId:string;projectId:string;ownerUserId:string})=>Promise<unknown>;

/** Server-only suffix allocated by the existing atomic authoring writer, never browser-supplied event IDs. */
export type SourceRightsAuthoringSuffix={streamId:string;actorUserId:string;correlationId:string;eventIds:readonly string[]};

/** Share only byte-identical source snapshots. Distinct observations remain separate obligations.
 * Resource requirements are cumulative; every immutable package keeps its own byte proof. */
function distinctSourceRightsDependencies(dependencies:readonly SourceRightsDependency[]):SourceRightsDependency[]{
  type Source=Extract<SourceRightsDependency,{kind:"source"}>;
  const retained:SourceRightsDependency[]=[],sources=new Map<string,Array<{events:string;source:Source;resources:Set<string>}>>();
  for(const dependency of dependencies){
    if(dependency.kind!=="source"||!Array.isArray(dependency.events)||!Array.isArray(dependency.resources)){retained.push(dependency);continue;}
    const identity=JSON.stringify([dependency.organizationId,dependency.projectAccessId,dependency.projectId,dependency.ownerUserId,dependency.sourceHead,dependency.indexedHead]);
    const events=JSON.stringify(dependency.events),variants=sources.get(identity)??[],matching=variants.find(item=>item.events===events);
    if(matching){
      for(const resource of dependency.resources){
        const key=JSON.stringify([resource.kind,resource.id]);if(matching.resources.has(key))continue;
        matching.resources.add(key);matching.source.resources.push({...resource});
      }
    }else{
      const resources=new Map(dependency.resources.map(resource=>[JSON.stringify([resource.kind,resource.id]),{...resource}]));
      const source={...dependency,events:dependency.events,resources:[...resources.values()]};
      variants.push({events,source,resources:new Set(resources.keys())});sources.set(identity,variants);retained.push(source);
    }
  }
  return retained;
}

/** Bind the rights read to purchase or human authorship with one bounded proof parameter. */
export function sourceRightsDispatchGuard(validity:Pick<SourceRightsValidity,"dispatchDependencies">,ownAuthoring?:SourceRightsAuthoringSuffix):BudgetReservationGuard{
  return sourceRightsDispatchGuardInternal(validity,ownAuthoring);
}

/** Ordinary free sends have a different exact writer contract from approved
 * authoring. Keep that exception separate; paid/default guards are unchanged. */
export function sourceRightsDispatchGuardForAssistant(validity:Pick<SourceRightsValidity,"dispatchDependencies">,own:AssistantOwnSendFootprint):BudgetReservationGuard{
  const suffix=assistantOwnSendGuard(own);
  const guard=sourceRightsDispatchGuardInternal(validity,undefined,{streamId:own.streamId,sourceHead:own.sourceHead,
    endHead:own.sourceHead+own.eventWrites.length,eventIds:own.eventWrites.map(event=>String(event[0]))});
  return{sql:`(${guard.sql}) AND (${suffix.sql})`,bindings:[...guard.bindings,...suffix.bindings]};
}

/** Structured free sends retain every original rights dependency, but prove
 * their own distinct v2 writer footprint instead of inheriting the v1 exception. */
export function sourceRightsDispatchGuardForStructuredAssistant(validity:Pick<SourceRightsValidity,"dispatchDependencies">,own:AssistantStructuredOwnSendFootprint):BudgetReservationGuard{
  const suffix=assistantStructuredOwnSendGuard(own);
  const guard=sourceRightsDispatchGuardInternal(validity,undefined,{streamId:own.streamId,sourceHead:own.sourceHead,
    endHead:own.sourceHead+own.eventWrites.length,eventIds:own.eventWrites.map(event=>String(event[0]))});
  return{sql:`(${guard.sql}) AND (${suffix.sql})`,bindings:[...guard.bindings,...suffix.bindings]};
}

function sourceRightsDispatchGuardInternal(validity:Pick<SourceRightsValidity,"dispatchDependencies">,ownAuthoring?:SourceRightsAuthoringSuffix,
  ownAssistant?:{streamId:string;sourceHead:number;endHead:number;eventIds:string[]}):BudgetReservationGuard{
  if(!validity.dispatchDependencies?.length)return{sql:"1",bindings:[]};
  if(ownAuthoring&&(!ownAuthoring.streamId.startsWith("creative:")||!ownAuthoring.actorUserId||!ownAuthoring.correlationId
    ||!ownAuthoring.eventIds.length||ownAuthoring.eventIds.length>512||new Set(ownAuthoring.eventIds).size!==ownAuthoring.eventIds.length
    ||ownAuthoring.eventIds.some(id=>typeof id!=="string"||!id||id.length>120)))throw new Error("authoring_source_suffix_invalid");
  const input=JSON.stringify({dependencies:distinctSourceRightsDependencies(validity.dispatchDependencies),...(ownAuthoring?{ownAuthoring}:{}),...(ownAssistant?{ownAssistant}:{})});
  if(new TextEncoder().encode(input).byteLength>1_800_000)throw new Error("context_source_rights_too_large");
  const ownSuffix=ownAuthoring?` AND NOT(event.sequence>json_extract(dependency.value,'$.sourceHead')
    AND(event.stream_id,event.actor,event.client_id,event.correlation_id)
      =(json_extract(source_rights.value,'$.ownAuthoring.streamId'),'user:'||json_extract(source_rights.value,'$.ownAuthoring.actorUserId'),'web:context-approval',json_extract(source_rights.value,'$.ownAuthoring.correlationId'))
    AND event.event_id IN(SELECT value FROM json_each(source_rights.value,'$.ownAuthoring.eventIds')))`:ownAssistant?` AND NOT(
      event.stream_id=json_extract(source_rights.value,'$.ownAssistant.streamId')
      AND json_extract(dependency.value,'$.sourceHead')=json_extract(source_rights.value,'$.ownAssistant.sourceHead')
      AND event.sequence>json_extract(dependency.value,'$.sourceHead')
      AND event.event_id IN(SELECT value FROM json_each(source_rights.value,'$.ownAssistant.eventIds')))`:"";
  const indexed=ownAssistant?`(migration.last_owner_sequence=json_extract(dependency.value,'$.sourceHead')
    OR 'creative:'||project.owner_user_id=json_extract(source_rights.value,'$.ownAssistant.streamId')
      AND json_extract(dependency.value,'$.sourceHead')=json_extract(source_rights.value,'$.ownAssistant.sourceHead')
      AND migration.last_owner_sequence=json_extract(source_rights.value,'$.ownAssistant.endHead'))`
    :"migration.last_owner_sequence=json_extract(dependency.value,'$.sourceHead')";
  return{sql:`NOT EXISTS(SELECT 1 FROM(SELECT ? AS value) source_rights,json_each(source_rights.value,'$.dependencies') dependency WHERE CASE json_extract(dependency.value,'$.kind')
    WHEN 'source' THEN NOT EXISTS(SELECT 1 FROM organization_projects project
      JOIN organizations organization ON organization.organization_id=project.organization_id AND organization.status='active'
      JOIN project_migration_states migration ON(migration.project_access_id,migration.organization_id,migration.owner_user_id,migration.status)
        =(project.project_access_id,project.organization_id,project.owner_user_id,'active')
      JOIN organization_memberships owner ON(owner.organization_id,owner.user_id,owner.status)=(project.organization_id,project.owner_user_id,'active')
        AND owner.accepted_at IS NOT NULL AND owner.revoked_at IS NULL
      WHERE(project.project_access_id,project.organization_id,project.project_id,project.owner_user_id,project.status)
        =(json_extract(dependency.value,'$.projectAccessId'),json_extract(dependency.value,'$.organizationId'),json_extract(dependency.value,'$.projectId'),json_extract(dependency.value,'$.ownerUserId'),'active')
        AND json_extract(dependency.value,'$.indexedHead')=json_extract(dependency.value,'$.sourceHead')
        AND ${indexed}
        AND (SELECT COALESCE(MAX(event.sequence),0) FROM events event WHERE event.stream_id='creative:'||project.owner_user_id${ownSuffix})=json_extract(dependency.value,'$.sourceHead')
        AND NOT EXISTS(SELECT 1 FROM json_each(dependency.value,'$.events') expected WHERE NOT EXISTS(SELECT 1 FROM events event
          LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id
          JOIN project_event_scopes custody ON custody.event_id=event.event_id
          WHERE(event.event_id,event.stream_id,event.sequence,event.type,event.payload)
            =(json_extract(expected.value,'$.eventId'),'creative:'||project.owner_user_id,json_extract(expected.value,'$.sequence'),json_extract(expected.value,'$.type'),json_extract(expected.value,'$.payload'))
            AND(secret.private_json,secret.owner_id) IS(json_extract(expected.value,'$.privateJson'),json_extract(expected.value,'$.privateOwner'))
            AND secret.redacted_at IS NULL
            AND(custody.project_access_id,custody.organization_id,custody.project_id,custody.owner_user_id)
              =(project.project_access_id,project.organization_id,project.project_id,project.owner_user_id)))
        AND NOT EXISTS(SELECT 1 FROM json_each(dependency.value,'$.resources') required WHERE NOT EXISTS(SELECT 1 FROM project_resource_scopes resource
          WHERE(resource.resource_kind,resource.resource_id,resource.project_access_id,resource.organization_id,resource.project_id,resource.owner_user_id,resource.visibility)
            =(json_extract(required.value,'$.kind'),json_extract(required.value,'$.id'),project.project_access_id,project.organization_id,project.project_id,project.owner_user_id,'collaborative_output'))))
    WHEN 'package' THEN NOT EXISTS(SELECT 1 FROM organization_context_package_versions version
      JOIN organization_context_packages package ON(package.package_id,package.organization_id,package.status)=(version.package_id,version.organization_id,'active')
      JOIN organization_context_package_contents content ON(content.version_id,content.organization_id)=(version.version_id,version.organization_id) AND content.redacted_at IS NULL
      WHERE(version.organization_id,version.package_id,version.version_id,version.status,version.content_sha256,content.content_json)
        =(json_extract(dependency.value,'$.organizationId'),json_extract(dependency.value,'$.packageId'),json_extract(dependency.value,'$.versionId'),'published',json_extract(dependency.value,'$.contentSha256'),json_extract(dependency.value,'$.contentJson'))
        AND version.redacted_at IS NULL)
    ELSE 1 END)`,bindings:[input]};
}
const earlierRightsDeadline=(left:string|null,right:string|null)=>left===null?right:right===null?left:Date.parse(left)<=Date.parse(right)?left:right;

/** The same licensed-source predicate is used by prechecks and transactional Output assertions. */
export function licensedPackageSourceBlocks<T extends {type:string;properties:Record<string,unknown>;rightsExpiresAt?:string|null;source?:unknown}>(blocks:readonly T[]):T[]{
  return blocks.filter((block)=>Boolean(block.source)||block.type==="reference"||Boolean(block.rightsExpiresAt)
    ||["reference_id","source_expires_at","license_expires_at","rights_expires_at","rights_revoked","source_rights_revoked","rights_class","rights_status","source_evidence_hash"]
      .some((field)=>block.properties[field]!==undefined&&block.properties[field]!==null&&block.properties[field]!==""));
}

/** Organizational custody never turns a subsequently revoked source license into a new license. */
export async function packageSourceRightsValidity(env:WorkerEnv,organizationId:string,snapshot:GovernedSnapshot,refreshSourceIndex?:SourceRightsIndexRefresher):Promise<SourceRightsValidity>{
  let validUntil:string|null=null;
  for(const member of snapshot.blocks){
    const properties=creativeContextRightsValidity(member.properties),snapshotDeadline=creativeContextRightsValidity({rights_expires_at:member.rightsExpiresAt});
    if(properties.issue||snapshotDeadline.issue)return{current:false,validUntil:null};
    validUntil=earlierRightsDeadline(validUntil,earlierRightsDeadline(properties.validUntil,snapshotDeadline.validUntil));
  }
  const licensed=licensedPackageSourceBlocks(snapshot.blocks);
  if(!licensed.length)return{current:true,validUntil};
  // Capture before the event read; refresh a stale derived index only for callers that request it.
  const readOrigin=()=>env.DB.prepare(`SELECT project.project_id,project.owner_user_id,migration.last_owner_sequence AS indexed_head,
    (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id='creative:'||project.owner_user_id) AS source_head FROM organization_projects project
    JOIN organizations organization ON organization.organization_id=project.organization_id AND organization.status='active'
    JOIN project_migration_states migration ON migration.project_access_id=project.project_access_id
      AND migration.organization_id=project.organization_id AND migration.status='active'
    JOIN organization_memberships owner ON owner.organization_id=project.organization_id AND owner.user_id=project.owner_user_id
      AND owner.status='active' AND owner.accepted_at IS NOT NULL AND owner.revoked_at IS NULL
    WHERE project.project_access_id=? AND project.organization_id=? AND project.status='active'`)
    .bind(snapshot.sourceProjectAccessId,organizationId).first<{project_id:string;owner_user_id:string;source_head:number;indexed_head:number}>();
  let origin=await readOrigin();if(!origin)return{current:false,validUntil:null};
  if(refreshSourceIndex&&Number(origin.indexed_head)!==Number(origin.source_head)){
    await refreshSourceIndex({organizationId,projectAccessId:snapshot.sourceProjectAccessId,projectId:origin.project_id,ownerUserId:origin.owner_user_id});
    origin=await readOrigin();if(!origin)return{current:false,validUntil:null};
  }
  const rows=await env.DB.prepare(`SELECT event.*,secret.private_json,secret.owner_id AS private_owner,secret.redacted_at AS private_redacted_at FROM project_event_scopes scope
    JOIN events event ON event.event_id=scope.event_id
    LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id
    WHERE scope.project_access_id=? AND scope.organization_id=? AND scope.project_id=? AND scope.owner_user_id=? AND event.type IN(${sourceRightsEventSql})
    ORDER BY scope.project_sequence`)
    .bind(snapshot.sourceProjectAccessId,organizationId,origin.project_id,origin.owner_user_id).all<Record<string,unknown>>();
  // An erased payload must never become an empty/public fallback that appears to retain its old license.
  const retainedEvents:SourceRightsEvent[]=[];
  for(const row of rows.results){
    if(row.private_redacted_at!==null||row.private_json!==null&&row.private_owner!==origin.owner_user_id)return{current:false,validUntil:null};
    let payload:unknown;try{payload=JSON.parse(String(row.private_json??row.payload));}catch{return{current:false,validUntil:null};}
    if(!payload||typeof payload!=="object"||Array.isArray(payload)||"_private_ref"in payload)return{current:false,validUntil:null};
    retainedEvents.push({eventId:String(row.event_id),sequence:Number(row.sequence),type:String(row.type),payload:String(row.payload),
      privateJson:row.private_json===null?null:String(row.private_json),privateOwner:row.private_owner===null?null:String(row.private_owner)});
  }
  if(new TextEncoder().encode(JSON.stringify(retainedEvents)).byteLength>1_000_000)return{current:false,validUntil:null};
  const events=rows.results.map((row)=>serializeEvent(row)) as CreativeEvent[];
  const projection=foldEvents(events,Number.POSITIVE_INFINITY,snapshot.sourceDocumentId,origin.project_id);
  if(!projection.documents.some(document=>document.id===snapshot.sourceDocumentId&&document.projectId===origin.project_id&&!document.removed))return{current:false,validUntil:null};
  const resources=new Map<string,{kind:string;id:string}>(),add=(kind:string,id:string)=>resources.set(kind+":"+id,{kind,id});add("document",snapshot.sourceDocumentId);
  for(const member of licensed){
    const original=projection.blocks.find((block)=>block.id===member.sourceBlockId&&block.documentId===snapshot.sourceDocumentId&&!block.removed);
    if(!original)return{current:false,validUntil:null};add("block",original.id);
    const current=creativeContextRightsValidity(original.properties);
    if(current.issue)return{current:false,validUntil:null};
    validUntil=earlierRightsDeadline(validUntil,current.validUntil);
    if(member.source||member.type==="reference"){
      const referenceId=String(original.properties.reference_id??"");
      const rights=[...events].reverse().find((event)=>["RightsAsserted","ReferenceIngested"].includes(event.type)
        &&String(event.payload.reference_id??"")===referenceId);
      if(!referenceId||!rights||!["owned","owned_or_licensed"].includes(String(rights.payload.rights_class??"")))return{current:false,validUntil:null};add("reference",referenceId);
    }
  }
  return{current:true,validUntil,dispatchDependencies:[{kind:"source",organizationId,projectAccessId:snapshot.sourceProjectAccessId,projectId:origin.project_id,ownerUserId:origin.owner_user_id,sourceHead:Number(origin.source_head),indexedHead:Number(origin.indexed_head),events:retainedEvents,resources:[...resources.values()]}]};
}

export async function packageSourceRightsCurrent(env:WorkerEnv,organizationId:string,snapshot:GovernedSnapshot){
  return(await packageSourceRightsValidity(env,organizationId,snapshot)).current;
}

/** Recheck every bound immutable version and retain the earliest snapshot or live-source deadline. */
export async function governedPackageSourceRightsValidity(env:WorkerEnv,organizationId:string,blocks:readonly Pick<CreativeBlock,"properties">[],refreshSourceIndex?:SourceRightsIndexRefresher):Promise<SourceRightsValidity>{
  let validUntil:string|null=null;const dispatchDependencies:SourceRightsDependency[]=[];
  const packages=new Map<string,{packageId:string;versionId:string}>();
  for(const block of blocks){
    const packageId=String(block.properties.organization_context_package_id??"");
    const versionId=String(block.properties.organization_context_package_version_id??"");
    if(packageId||versionId){if(!packageId||!versionId)return{current:false,validUntil:null};packages.set(`${packageId}:${versionId}`,{packageId,versionId});}
  }
  for(const member of packages.values()){
    const row=await env.DB.prepare(`SELECT version.content_sha256,content.content_json FROM organization_context_package_versions version
      JOIN organization_context_packages package ON package.package_id=version.package_id AND package.organization_id=version.organization_id AND package.status='active'
      JOIN organization_context_package_contents content ON content.version_id=version.version_id
        AND content.organization_id=version.organization_id AND content.redacted_at IS NULL
      WHERE version.organization_id=? AND version.package_id=? AND version.version_id=? AND version.status='published' AND version.redacted_at IS NULL`)
      .bind(organizationId,member.packageId,member.versionId).first<{content_sha256:string;content_json:string}>();
    if(!row)return{current:false,validUntil:null};
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(row.content_json))),
      (byte)=>byte.toString(16).padStart(2,"0")).join("");
    if(digest!==row.content_sha256)return{current:false,validUntil:null};
    let snapshot:GovernedSnapshot;
    try{snapshot=JSON.parse(row.content_json) as GovernedSnapshot;}catch{return{current:false,validUntil:null};}
    if(snapshot.schema!==1||snapshot.organizationId!==organizationId||!Array.isArray(snapshot.blocks))return{current:false,validUntil:null};
    const source=await packageSourceRightsValidity(env,organizationId,snapshot,refreshSourceIndex);
    if(!source.current)return{current:false,validUntil:null};
    validUntil=earlierRightsDeadline(validUntil,source.validUntil);
    dispatchDependencies.push({kind:"package",organizationId,packageId:member.packageId,versionId:member.versionId,contentSha256:row.content_sha256,contentJson:row.content_json},...source.dispatchDependencies??[]);
  }
  return{current:true,validUntil,...(dispatchDependencies.length?{dispatchDependencies}:{})};
}

export async function governedPackageSourceRightsCurrent(env:WorkerEnv,organizationId:string,blocks:readonly Pick<CreativeBlock,"properties">[]){
  return(await governedPackageSourceRightsValidity(env,organizationId,blocks)).current;
}

import { creativeContextRightsValidity } from "../src/model/context-health.ts";
import { foldEvents, type CreativeBlock, type CreativeEvent } from "../src/model/events.ts";
import { serializeEvent, type WorkerEnv } from "./runtime.ts";
import type { BudgetReservationGuard } from "./pilot-policy.ts";

type GovernedSnapshot={
  schema:number;
  organizationId:string;
  sourceProjectAccessId:string;
  sourceDocumentId:string;
  blocks:Array<{sourceBlockId:string;type:string;properties:Record<string,unknown>;rightsExpiresAt?:string|null;source?:unknown}>;
};
// Server-only evidence: never copy these source heads or immutable bytes into a consent/provider payload.
type SourceRightsDependency=
  |{kind:"source";organizationId:string;projectAccessId:string;projectId:string;ownerUserId:string;sourceHead:number;indexedHead:number}
  |{kind:"package";organizationId:string;packageId:string;versionId:string;contentSha256:string;contentJson:string};
type SourceRightsValidity={current:boolean;validUntil:string|null;dispatchDependencies?:SourceRightsDependency[]};
type SourceRightsIndexRefresher=(scope:{organizationId:string;projectAccessId:string;projectId:string;ownerUserId:string})=>Promise<unknown>;

/** Bind the rights read to the purchase mutation, with one parameter regardless of package count. */
export function sourceRightsDispatchGuard(validity:Pick<SourceRightsValidity,"dispatchDependencies">):BudgetReservationGuard{
  if(!validity.dispatchDependencies?.length)return{sql:"1",bindings:[]};
  return{sql:`NOT EXISTS(SELECT 1 FROM json_each(?) dependency WHERE CASE json_extract(dependency.value,'$.kind')
    WHEN 'source' THEN NOT EXISTS(SELECT 1 FROM organization_projects project
      JOIN organizations organization ON organization.organization_id=project.organization_id AND organization.status='active'
      JOIN project_migration_states migration ON migration.project_access_id=project.project_access_id
        AND migration.organization_id=project.organization_id AND migration.owner_user_id=project.owner_user_id AND migration.status='active'
      JOIN organization_memberships owner ON owner.organization_id=project.organization_id AND owner.user_id=project.owner_user_id
        AND owner.status='active' AND owner.accepted_at IS NOT NULL AND owner.revoked_at IS NULL
      WHERE project.project_access_id=json_extract(dependency.value,'$.projectAccessId')
        AND project.organization_id=json_extract(dependency.value,'$.organizationId') AND project.project_id=json_extract(dependency.value,'$.projectId')
        AND project.owner_user_id=json_extract(dependency.value,'$.ownerUserId') AND project.status='active'
        AND json_extract(dependency.value,'$.indexedHead')=json_extract(dependency.value,'$.sourceHead')
        AND migration.last_owner_sequence=json_extract(dependency.value,'$.sourceHead')
        AND (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id='creative:'||project.owner_user_id)=json_extract(dependency.value,'$.sourceHead'))
    WHEN 'package' THEN NOT EXISTS(SELECT 1 FROM organization_context_package_versions version
      JOIN organization_context_packages package ON package.package_id=version.package_id AND package.organization_id=version.organization_id AND package.status='active'
      JOIN organization_context_package_contents content ON content.version_id=version.version_id AND content.organization_id=version.organization_id AND content.redacted_at IS NULL
      WHERE version.organization_id=json_extract(dependency.value,'$.organizationId') AND version.package_id=json_extract(dependency.value,'$.packageId')
        AND version.version_id=json_extract(dependency.value,'$.versionId') AND version.status='published' AND version.redacted_at IS NULL
        AND version.content_sha256=json_extract(dependency.value,'$.contentSha256') AND content.content_json=json_extract(dependency.value,'$.contentJson'))
    ELSE 1 END)`,bindings:[JSON.stringify(validity.dispatchDependencies)]};
}
const earlierRightsDeadline=(left:string|null,right:string|null)=>left===null?right:right===null?left:Date.parse(left)<=Date.parse(right)?left:right;

/** Organizational custody never turns a subsequently revoked source license into a new license. */
export async function packageSourceRightsValidity(env:WorkerEnv,organizationId:string,snapshot:GovernedSnapshot,refreshSourceIndex?:SourceRightsIndexRefresher):Promise<SourceRightsValidity>{
  let validUntil:string|null=null;
  for(const member of snapshot.blocks){
    const properties=creativeContextRightsValidity(member.properties),snapshotDeadline=creativeContextRightsValidity({rights_expires_at:member.rightsExpiresAt});
    if(properties.issue||snapshotDeadline.issue)return{current:false,validUntil:null};
    validUntil=earlierRightsDeadline(validUntil,earlierRightsDeadline(properties.validUntil,snapshotDeadline.validUntil));
  }
  const licensed=snapshot.blocks.filter((block)=>Boolean(block.source)||block.type==="reference"||Boolean(block.rightsExpiresAt)
    ||["reference_id","source_expires_at","license_expires_at","rights_expires_at","rights_revoked","source_rights_revoked","rights_class","rights_status","source_evidence_hash"]
      .some((field)=>block.properties[field]!==undefined&&block.properties[field]!==null&&block.properties[field]!==""));
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
  const rows=await env.DB.prepare(`SELECT event.*,secret.private_json FROM project_event_scopes scope
    JOIN events event ON event.event_id=scope.event_id
    LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id AND secret.redacted_at IS NULL
    WHERE scope.project_access_id=? AND scope.organization_id=? AND scope.project_id=? AND scope.owner_user_id=?
    ORDER BY scope.project_sequence`)
    .bind(snapshot.sourceProjectAccessId,organizationId,origin.project_id,origin.owner_user_id).all<Record<string,unknown>>();
  const events=rows.results.map((row)=>serializeEvent(row)) as CreativeEvent[];
  const projection=foldEvents(events,Number.POSITIVE_INFINITY,snapshot.sourceDocumentId,origin.project_id);
  for(const member of licensed){
    const original=projection.blocks.find((block)=>block.id===member.sourceBlockId&&block.documentId===snapshot.sourceDocumentId&&!block.removed);
    if(!original)return{current:false,validUntil:null};
    const current=creativeContextRightsValidity(original.properties);
    if(current.issue)return{current:false,validUntil:null};
    validUntil=earlierRightsDeadline(validUntil,current.validUntil);
    if(member.source||member.type==="reference"){
      const referenceId=String(original.properties.reference_id??"");
      const rights=[...events].reverse().find((event)=>["RightsAsserted","ReferenceIngested"].includes(event.type)
        &&String(event.payload.reference_id??"")===referenceId);
      if(!referenceId||!rights||!["owned","owned_or_licensed"].includes(String(rights.payload.rights_class??"")))return{current:false,validUntil:null};
    }
  }
  return{current:true,validUntil,dispatchDependencies:[{kind:"source",organizationId,projectAccessId:snapshot.sourceProjectAccessId,projectId:origin.project_id,ownerUserId:origin.owner_user_id,sourceHead:Number(origin.source_head),indexedHead:Number(origin.indexed_head)}]};
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

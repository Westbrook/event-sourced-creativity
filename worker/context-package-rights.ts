import { creativeContextRightsIssue } from "../src/model/context-health.ts";
import { foldEvents, type CreativeBlock, type CreativeEvent } from "../src/model/events.ts";
import { serializeEvent, type WorkerEnv } from "./runtime.ts";

type GovernedSnapshot={
  schema:number;
  organizationId:string;
  sourceProjectAccessId:string;
  sourceDocumentId:string;
  blocks:Array<{sourceBlockId:string;type:string;properties:Record<string,unknown>;rightsExpiresAt?:string|null;source?:unknown}>;
};

/** The same licensed-source predicate is used by prechecks and transactional Output assertions. */
export function licensedPackageSourceBlocks<T extends {type:string;properties:Record<string,unknown>;rightsExpiresAt?:string|null;source?:unknown}>(blocks:readonly T[]):T[]{
  return blocks.filter((block)=>Boolean(block.source)||block.type==="reference"||Boolean(block.rightsExpiresAt)
    ||["reference_id","source_expires_at","license_expires_at","rights_expires_at","rights_revoked","source_rights_revoked","rights_class","rights_status","source_evidence_hash"]
      .some((field)=>block.properties[field]!==undefined&&block.properties[field]!==null&&block.properties[field]!==""));
}

/** Organizational custody never turns a subsequently revoked source license into a new license. */
export async function packageSourceRightsCurrent(env:WorkerEnv,organizationId:string,snapshot:GovernedSnapshot){
  const licensed=licensedPackageSourceBlocks(snapshot.blocks);
  if(!licensed.length)return true;
  const origin=await env.DB.prepare(`SELECT project.project_id,project.owner_user_id FROM organization_projects project
    JOIN organizations organization ON organization.organization_id=project.organization_id AND organization.status='active'
    JOIN project_migration_states migration ON migration.project_access_id=project.project_access_id
      AND migration.organization_id=project.organization_id AND migration.status='active'
    JOIN organization_memberships owner ON owner.organization_id=project.organization_id AND owner.user_id=project.owner_user_id
      AND owner.status='active' AND owner.accepted_at IS NOT NULL AND owner.revoked_at IS NULL
    WHERE project.project_access_id=? AND project.organization_id=? AND project.status='active'`)
    .bind(snapshot.sourceProjectAccessId,organizationId).first<{project_id:string;owner_user_id:string}>();
  if(!origin)return false;
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
    if(!original||creativeContextRightsIssue(original.properties))return false;
    if(member.source||member.type==="reference"){
      const referenceId=String(original.properties.reference_id??"");
      const rights=[...events].reverse().find((event)=>["RightsAsserted","ReferenceIngested"].includes(event.type)
        &&String(event.payload.reference_id??"")===referenceId);
      if(!referenceId||!rights||!["owned","owned_or_licensed"].includes(String(rights.payload.rights_class??"")))return false;
    }
  }
  return true;
}

/** Recheck every bound immutable version against its exact, current organization-owned source. */
export async function governedPackageSourceRightsCurrent(env:WorkerEnv,organizationId:string,blocks:readonly Pick<CreativeBlock,"properties">[]){
  const packages=new Map<string,{packageId:string;versionId:string}>();
  for(const block of blocks){
    const packageId=String(block.properties.organization_context_package_id??"");
    const versionId=String(block.properties.organization_context_package_version_id??"");
    if(packageId||versionId){if(!packageId||!versionId)return false;packages.set(`${packageId}:${versionId}`,{packageId,versionId});}
  }
  for(const member of packages.values()){
    const row=await env.DB.prepare(`SELECT version.content_sha256,content.content_json FROM organization_context_package_versions version
      JOIN organization_context_packages package ON package.package_id=version.package_id AND package.organization_id=version.organization_id AND package.status='active'
      JOIN organization_context_package_contents content ON content.version_id=version.version_id
        AND content.organization_id=version.organization_id AND content.redacted_at IS NULL
      WHERE version.organization_id=? AND version.package_id=? AND version.version_id=? AND version.status='published' AND version.redacted_at IS NULL`)
      .bind(organizationId,member.packageId,member.versionId).first<{content_sha256:string;content_json:string}>();
    if(!row)return false;
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(row.content_json))),
      (byte)=>byte.toString(16).padStart(2,"0")).join("");
    if(digest!==row.content_sha256)return false;
    let snapshot:GovernedSnapshot;
    try{snapshot=JSON.parse(row.content_json) as GovernedSnapshot;}catch{return false;}
    if(snapshot.schema!==1||snapshot.organizationId!==organizationId||!Array.isArray(snapshot.blocks)
      ||snapshot.blocks.some((block)=>block.rightsExpiresAt&&Date.parse(block.rightsExpiresAt)<=Date.now()
        ||Boolean(creativeContextRightsIssue(block.properties)))
      ||!await packageSourceRightsCurrent(env,organizationId,snapshot))return false;
  }
  return true;
}

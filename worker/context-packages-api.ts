import { foldEvents, type CreativeBlock, type CreativeBlockRelation } from "../src/model/events.ts";
import { FORMA_CAPABILITIES } from "../src/platform/capabilities.ts";
import { hasCapability, POLICY_VERSION, type PilotUser } from "./pilot-policy.ts";
import { appendProjectEvents, readProjectSourceEvents, recordOrganizationAudit, type ProjectRequestContext } from "./project-access.ts";
import { uuidV7, type WorkerEnv } from "./runtime.ts";
import { effectivePilotParticipantSql, effectivePilotReviewerSql } from "./access-policy.ts";
import { ownerMediaNamespace } from "../src/model/media-ownership.ts";
import { verifySourceDocumentEvidence } from "./media-api.ts";
import { isContextCompositionRelation } from "../src/model/combined-context.ts";

const MAX_PACKAGE_BLOCKS = 128;
const MAX_PACKAGE_EVENTS = 384;
const MAX_PACKAGE_BYTES = 250_000;
const MAX_PACKAGE_SOURCE_BYTES=12*1024*1024;
const PACKAGE_PROVENANCE_FIELDS = new Set([
  "organization_context_package_id",
  "organization_context_package_version_id",
  "organization_context_package_binding_id",
  "organization_context_source_block_id",
]);
const NONPORTABLE_FIELDS = new Set([
  "copied_from_block_id",
  "source_block_id",
  "source_document_id",
  "source_output_id",
  "source_artifact_id",
  "forked_from_block_id",
  "from_document_id",
  "to_document_id",
  "context_set_id",
  "context_set_root_id",
  "combined_context_memberships",
  "source_canvas_item_ids",
  "source_artifact_content_ref",
  "source_artifact_input_ref",
  "media_url",
  "reference_id",
  "source_ref",
]);

type PackageSource={objectKey:string;contentSha256:string;mimeType:string;originalName:string;sourceEvidenceSha256:string|null;sourceClassification:string|null};

type PackageBlock = {
  sourceBlockId: string;
  type: string;
  handle: string;
  position: string;
  locked: boolean;
  properties: Record<string, unknown>;
  sourceVersion: number;
  contentSha256: string;
  rightsExpiresAt: string | null;
  source?:PackageSource;
};

type PackageSnapshot = {
  schema: 1;
  organizationId: string;
  sourceProjectAccessId: string;
  sourceDocumentId: string;
  sourceHead: number;
  blocks: PackageBlock[];
  relations: Array<{ fromSourceBlockId: string; toSourceBlockId: string; kind: string; properties: Record<string, unknown> }>;
};

const sha256 = async (value: string) => Array.from(
  new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
  (byte) => byte.toString(16).padStart(2, "0"),
).join("");

const denied = () => Response.json({ error: "access_denied" }, { status: 403 });
const safeName = (value: unknown, maximum: number) => typeof value === "string" ? value.trim().slice(0, maximum) : "";
const mediaKey=(url:unknown)=>{
  if(typeof url!=="string"||!url.startsWith("/api/media/"))return"";
  try{return decodeURIComponent(url.slice("/api/media/".length));}catch{return"";}
};
const bytesDigest=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes as Uint8Array<ArrayBuffer>)),(byte)=>byte.toString(16).padStart(2,"0")).join("");

function portableProperties(properties: Record<string, unknown>) {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(properties).sort()) {
    if (NONPORTABLE_FIELDS.has(key) || PACKAGE_PROVENANCE_FIELDS.has(key)) continue;
    result[key] = properties[key];
  }
  return result;
}

async function blockDigest(block: { type: string; handle?: string; position?: string; locked?: boolean; properties: Record<string, unknown> }) {
  return sha256(JSON.stringify({ type: block.type, handle: block.handle??"", position: block.position??"", locked: Boolean(block.locked), properties: portableProperties(block.properties) }));
}

function unsafeNestedCustody(value: unknown, depth=0):boolean{
  if(depth>12)return true;
  if(typeof value==="string")return value.startsWith("/api/media/")||value.startsWith("private://");
  if(Array.isArray(value))return value.some((item)=>unsafeNestedCustody(item,depth+1));
  if(!value||typeof value!=="object")return false;
  return Object.entries(value as Record<string,unknown>).some(([key,item])=>
    (key==="media_url"||key==="source_ref"||key.endsWith("_content_ref")||key.endsWith("_input_ref"))&&Boolean(item)
    ||unsafeNestedCustody(item,depth+1));
}

async function resolveProject(env: WorkerEnv, actor: PilotUser, organizationId: string, projectAccessId: string, author: boolean): Promise<ProjectRequestContext | null> {
  const scope = { organizationId, projectAccessId };
  if (!projectAccessId || !hasCapability(actor, "project.read", scope) || author && (!hasCapability(actor, "project.author", scope) || !hasCapability(actor, "project.library.manage", scope))) return null;
  const granted = actor.access.projects.find((project) => project.organizationId === organizationId && project.projectAccessId === projectAccessId);
  if (!granted) return null;
  const project = await env.DB.prepare(`SELECT project.project_id,project.owner_user_id
    FROM organization_projects project JOIN project_migration_states migration
      ON migration.project_access_id=project.project_access_id AND migration.organization_id=project.organization_id AND migration.status='active'
    WHERE project.project_access_id=? AND project.organization_id=? AND project.status='active'`)
    .bind(projectAccessId, organizationId).first<{ project_id: string; owner_user_id: string }>();
  if (!project) return null;
  return {
    contextId: "",
    organizationId,
    projectAccessId,
    projectId: project.project_id,
    ownerUserId: project.owner_user_id,
    principalUserId: actor.userId,
    role: granted.role,
    permissions: FORMA_CAPABILITIES.filter((capability) => capability.startsWith("project.") && hasCapability(actor, capability, scope)),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

async function authoritativeSnapshot(env: WorkerEnv, actor: PilotUser, organizationId: string, body: Record<string, unknown>): Promise<{ snapshot: PackageSnapshot; serialized: string; digest: string } | Response> {
  const projectAccessId = safeName(body.sourceProjectAccessId, 100);
  const documentId = safeName(body.documentId, 100);
  const source = await resolveProject(env, actor, organizationId, projectAccessId, true);
  if (!source || !documentId) return denied();
  const readHead=async()=>Number((await env.DB.prepare("SELECT COALESCE(MAX(project_sequence),0) AS head FROM project_event_scopes WHERE project_access_id=? AND organization_id=?")
    .bind(projectAccessId,organizationId).first<{head:number}>())?.head??0);
  const capturedSourceHead=await readHead();
  if(body.expectedSourceHead!==undefined&&Number(body.expectedSourceHead)!==capturedSourceHead)
    return Response.json({error:"stale_context_package_source",head:capturedSourceHead},{status:409});
  const events = await readProjectSourceEvents(env, source);
  const projection = foldEvents(events, Number.POSITIVE_INFINITY, documentId, source.projectId);
  if (!projection.documents.some((document) => document.id === documentId && !document.removed)) return denied();
  const selectedRoots=Array.isArray(body.blockIds)?body.blockIds.map((id)=>String(id)):projection.blocks.map((block)=>block.id);
  const requested=[...selectedRoots];const expanded=new Set(requested);
  for(let index=0;index<requested.length;index+=1)for(const relation of projection.blockRelations)if(isContextCompositionRelation(relation.kind)&&relation.fromBlockId===requested[index]&&!expanded.has(relation.toBlockId)){expanded.add(relation.toBlockId);requested.push(relation.toBlockId);}
  if (!requested.length || requested.length > MAX_PACKAGE_BLOCKS || requested.length !== new Set(requested).size) {
    return Response.json({ error: "valid_context_package_block_selection_required", maximum: MAX_PACKAGE_BLOCKS }, { status: 400 });
  }
  const selected = requested.map((id) => projection.blocks.find((block) => block.id === id && !block.removed && block.documentId === documentId));
  if (selected.some((block) => !block)) return denied();
  const now = Date.now();
  const blocks: PackageBlock[] = [];
  const preparedSources:Array<{block:PackageBlock;bytes:Uint8Array;metadata:Record<string,string>}>=[];
  for (const block of selected as CreativeBlock[]) {
    const sourceKey=mediaKey(block.properties.media_url);
    if((block.type==="reference"||block.properties.media_url||block.properties.reference_id||block.properties.source_ref)&&block.type!=="reference"){
      return Response.json({error:"organization_source_media_custody_unavailable",message:"Only verified reference blocks can transfer original source files into organization custody."},{status:409});
    }
    if(unsafeNestedCustody(portableProperties(block.properties)))return Response.json({error:"organization_source_media_custody_unavailable",message:"Nested files and private source handles cannot cross project boundaries."},{status:409});
    const expiration = String(block.properties.license_expires_at ?? block.properties.rights_expires_at ?? "").trim();
    if (expiration && (!Number.isFinite(Date.parse(expiration)) || Date.parse(expiration) <= now)) {
      return Response.json({ error: "context_package_source_rights_expired" }, { status: 409 });
    }
    const properties = portableProperties(block.properties);
    const packaged:PackageBlock={
      sourceBlockId: block.id,
      type: block.type,
      handle: block.handle,
      position: block.position,
      locked: block.locked,
      properties,
      sourceVersion: block.sourceEvents.length,
      contentSha256: await blockDigest({ type: block.type, handle:block.handle, position:block.position, locked:block.locked, properties }),
      rightsExpiresAt: expiration || null,
    };
    if(block.type==="reference"){
      const referenceId=String(block.properties.reference_id??"");
      if(body.sourceRightsConfirmed!==true)return Response.json({error:"context_package_source_rights_confirmation_required"},{status:428});
      if(!sourceKey||!referenceId)return Response.json({error:"organization_source_media_custody_unavailable"},{status:409});
      const rights=events.some((event)=>String(event.payload.reference_id??"")===referenceId
        &&(event.type==="RightsAsserted"&&["owned","owned_or_licensed"].includes(String(event.payload.rights_class??""))
          ||event.type==="ReferenceIngested"&&["owned","owned_or_licensed"].includes(String(event.payload.rights_class??""))));
      if(!rights)return Response.json({error:"context_package_source_rights_unverified"},{status:409});
      const scoped=await env.DB.prepare(`SELECT resource_id FROM project_resource_scopes
        WHERE project_access_id=? AND organization_id=? AND owner_user_id=? AND resource_kind='media' AND resource_id=?`)
        .bind(source.projectAccessId,organizationId,source.ownerUserId,sourceKey).first();
      if(!scoped||typeof env.MEDIA.get!=="function"||typeof env.MEDIA.put!=="function")return Response.json({error:"organization_source_media_custody_unavailable"},{status:409});
      const original=await env.MEDIA.get(sourceKey);
      if(!original||original.customMetadata?.ownerId!==source.ownerUserId||original.customMetadata.rights!=="asserted"
        ||!await verifySourceDocumentEvidence(env,source.ownerUserId,block.properties.media_url,block.properties)){
        return Response.json({error:"organization_source_evidence_integrity_failed"},{status:409});
      }
      const bytes=new Uint8Array(await new Response(original.body).arrayBuffer());
      if(!bytes.length||bytes.byteLength>MAX_PACKAGE_SOURCE_BYTES)return Response.json({error:"organization_context_source_too_large",maximumBytes:MAX_PACKAGE_SOURCE_BYTES},{status:413});
      const digest=await bytesDigest(bytes);
      if(original.customMetadata.sha256!==digest)return Response.json({error:"organization_source_evidence_integrity_failed"},{status:409});
      const headers=new Headers();original.writeHttpMetadata(headers);
      const mimeType=String(original.customMetadata.mimeType??headers.get("content-type")??"application/octet-stream");
      const sourceClassification=String(original.customMetadata.sourceClassification??(body.sourceNonSensitiveConfirmed===true?"non-sensitive-licensed":""));
      const objectKey=`organization-context/${organizationId}/${uuidV7()}`;
      packaged.source={objectKey,contentSha256:digest,mimeType,originalName:String(original.customMetadata.originalName??block.handle).slice(0,180),sourceEvidenceSha256:original.customMetadata.sourceEvidenceSha256??null,sourceClassification:sourceClassification||null};
      preparedSources.push({block:packaged,bytes,metadata:{organizationId,sha256:digest,mimeType,rights:"asserted",originalName:packaged.source.originalName,...(packaged.source.sourceEvidenceSha256?{sourceEvidenceSha256:packaged.source.sourceEvidenceSha256}:{}),...(sourceClassification?{sourceClassification}:{})}});
    }
    blocks.push(packaged);
  }
  const selectedIds = new Set(requested);
  const relations = projection.blockRelations.filter((relation: CreativeBlockRelation) => !relation.removed && selectedIds.has(relation.fromBlockId) && selectedIds.has(relation.toBlockId))
    .map((relation) => ({ fromSourceBlockId: relation.fromBlockId, toSourceBlockId: relation.toBlockId, kind: relation.kind, properties: portableProperties(relation.properties) }));
  const adoptionEventCount=blocks.reduce((count,block)=>count+1+(block.source?2:0)+(block.locked?1:0),relations.length);
  if(adoptionEventCount>MAX_PACKAGE_EVENTS)return Response.json({error:"context_package_event_limit_exceeded",maximumEvents:MAX_PACKAGE_EVENTS,requiredEvents:adoptionEventCount},{status:400});
  const sourceHead=await readHead();
  if(sourceHead!==capturedSourceHead)return Response.json({error:"stale_context_package_source",head:sourceHead},{status:409});
  const snapshot: PackageSnapshot = { schema: 1, organizationId, sourceProjectAccessId: projectAccessId, sourceDocumentId: documentId, sourceHead, blocks, relations };
  const serialized = JSON.stringify(snapshot);
  if (new TextEncoder().encode(serialized).byteLength > MAX_PACKAGE_BYTES) return Response.json({ error: "context_package_too_large" }, { status: 413 });
  const stored:string[]=[];
  try{
    for(const source of preparedSources){
      await env.MEDIA.put(source.block.source!.objectKey,source.bytes.buffer as ArrayBuffer,{httpMetadata:{contentType:source.block.source!.mimeType},customMetadata:source.metadata});
      stored.push(source.block.source!.objectKey);
    }
  }catch{
    if(typeof env.MEDIA.delete==="function")await Promise.all(stored.map((key)=>env.MEDIA.delete(key).catch(()=>undefined)));
    return Response.json({error:"organization_source_media_custody_unavailable"},{status:409});
  }
  return { snapshot, serialized, digest: await sha256(serialized) };
}

async function loadPublishedVersion(env:WorkerEnv,organizationId:string,packageId:string,requestedVersion:string,allowExpiredHistory=false){
  const row = await env.DB.prepare(`SELECT version.version_id,version.version,version.content_sha256,version.status,version.created_by_user_id,version.approved_by_user_id,version.published_at,version.created_at,content.content_json
    FROM organization_context_package_versions version JOIN organization_context_packages package
      ON package.package_id=version.package_id AND package.organization_id=version.organization_id AND package.status='active'
    JOIN organization_context_package_contents content ON content.version_id=version.version_id AND content.organization_id=version.organization_id AND content.redacted_at IS NULL
    WHERE version.organization_id=? AND version.package_id=? AND version.status='published' AND version.redacted_at IS NULL
      AND (?='' OR version.version_id=? OR CAST(version.version AS TEXT)=?)
    ORDER BY version.version DESC LIMIT 1`).bind(organizationId, packageId, requestedVersion, requestedVersion, requestedVersion).first<Record<string, unknown>>();
  if (!row) return null;
  const serialized = String(row.content_json);
  if (await sha256(serialized) !== String(row.content_sha256)) return null;
  let snapshot: PackageSnapshot;
  try { snapshot = JSON.parse(serialized) as PackageSnapshot; } catch { return null; }
  if (snapshot.schema !== 1 || snapshot.organizationId !== organizationId || !Array.isArray(snapshot.blocks)) return null;
  if(!allowExpiredHistory&&snapshot.blocks.some((block)=>block.rightsExpiresAt&&Date.parse(block.rightsExpiresAt)<=Date.now()))return null;
  return { row, snapshot };
}

async function createVersion(env: WorkerEnv, actor: PilotUser, organizationId: string, packageId: string, body: Record<string, unknown>, createPackage?: { name: string; description: string }) {
  if(!createPackage){
    const previous=await loadPublishedVersion(env,organizationId,packageId,"",true);
    if(!previous)return Response.json({error:"published_context_package_unavailable"},{status:404});
    if(previous.snapshot.sourceProjectAccessId!==safeName(body.sourceProjectAccessId,100)||previous.snapshot.sourceDocumentId!==safeName(body.documentId,100))
      return Response.json({error:"context_package_original_source_required",message:"Publish updates from the same source project and document as the approved package."},{status:409});
  }
  const source = await authoritativeSnapshot(env, actor, organizationId, body);
  if (source instanceof Response) return source;
  const previous = await env.DB.prepare("SELECT COALESCE(MAX(version),0) AS latest FROM organization_context_package_versions WHERE package_id=? AND organization_id=?")
    .bind(packageId, organizationId).first<{ latest: number }>();
  const version = Number(previous?.latest ?? 0) + 1;
  const versionId = uuidV7();
  const now = new Date().toISOString();
  const guarded = `EXISTS(SELECT 1 FROM organizations organization
    JOIN users actor_identity ON actor_identity.user_id=? AND actor_identity.consent_version=?
    JOIN organization_memberships member ON member.organization_id=organization.organization_id
    JOIN organization_projects source_project ON source_project.project_access_id=? AND source_project.organization_id=organization.organization_id AND source_project.status='active'
    JOIN project_migration_states source_migration ON source_migration.project_access_id=source_project.project_access_id AND source_migration.organization_id=organization.organization_id AND source_migration.status='active'
    JOIN organization_memberships source_owner ON source_owner.organization_id=organization.organization_id AND source_owner.user_id=source_project.owner_user_id
      AND source_owner.status='active' AND source_owner.accepted_at IS NOT NULL AND source_owner.revoked_at IS NULL
    LEFT JOIN project_memberships source_member ON source_member.project_access_id=source_project.project_access_id AND source_member.organization_id=organization.organization_id
      AND source_member.user_id=member.user_id AND source_member.status='active' AND source_member.revoked_at IS NULL
    WHERE organization.organization_id=? AND organization.status='active' AND member.user_id=? AND member.status='active' AND member.accepted_at IS NOT NULL
      AND member.revoked_at IS NULL AND member.role IN('owner','administrator')
      AND(source_project.owner_user_id=member.user_id OR source_member.role='editor')
      AND ${effectivePilotParticipantSql("organization.organization_id","member.user_id")}
      AND NOT ${effectivePilotReviewerSql("organization.organization_id","member.user_id")})
    AND (SELECT COALESCE(MAX(project_sequence),0) FROM project_event_scopes WHERE project_access_id=? AND organization_id=?)=?`;
  const guardValues = [actor.userId,POLICY_VERSION,source.snapshot.sourceProjectAccessId,organizationId,actor.userId,source.snapshot.sourceProjectAccessId,organizationId,source.snapshot.sourceHead] as const;
  const statements: D1PreparedStatement[] = [];
  if (createPackage) statements.push(env.DB.prepare(`INSERT INTO organization_context_packages(package_id,organization_id,name,description,status,created_by_user_id,created_at,updated_at)
    SELECT ?,?,?,?,'active',?,?,? WHERE ${guarded}`).bind(packageId, organizationId, createPackage.name, createPackage.description, actor.userId, now, now, ...guardValues));
  statements.push(env.DB.prepare(`INSERT INTO organization_context_package_versions(version_id,package_id,organization_id,version,content_sha256,source_project_access_id,source_document_id,status,created_by_user_id,approved_by_user_id,published_at,created_at,redacted_at)
    SELECT ?,?,?,?,?,?,?,'draft',?,NULL,NULL,?,NULL WHERE EXISTS(SELECT 1 FROM organization_context_packages WHERE package_id=? AND organization_id=? AND status='active') AND ${guarded}`)
    .bind(versionId, packageId, organizationId, version, source.digest, source.snapshot.sourceProjectAccessId, source.snapshot.sourceDocumentId, actor.userId, now, packageId, organizationId, ...guardValues));
  statements.push(env.DB.prepare(`INSERT INTO organization_context_package_contents(version_id,organization_id,content_json,created_at,redacted_at)
    SELECT ?,?,?,?,NULL WHERE EXISTS(SELECT 1 FROM organization_context_package_versions WHERE version_id=? AND organization_id=?)`)
    .bind(versionId, organizationId, source.serialized, now, versionId, organizationId));
  for (const [position, block] of source.snapshot.blocks.entries()) statements.push(env.DB.prepare(`INSERT INTO organization_context_package_sources(version_id,organization_id,source_project_access_id,source_block_id,source_kind,content_sha256,rights_expires_at,position)
    SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM organization_context_package_versions WHERE version_id=? AND organization_id=?)`)
    .bind(versionId, organizationId, source.snapshot.sourceProjectAccessId, block.sourceBlockId, block.type, block.contentSha256, block.rightsExpiresAt, position, versionId, organizationId));
  try {
    const results = await env.DB.batch(statements);
    if(results.some((result)=>Number(result.meta.changes??0)!==1)){
      if(typeof env.MEDIA.delete==="function")await Promise.all(source.snapshot.blocks.flatMap((block)=>block.source?[env.MEDIA.delete(block.source.objectKey).catch(()=>undefined)]:[]));
      return Response.json({error:"stale_context_package_source"},{status:409});
    }
  }catch{
    if(typeof env.MEDIA.delete==="function")await Promise.all(source.snapshot.blocks.flatMap((block)=>block.source?[env.MEDIA.delete(block.source.objectKey).catch(()=>undefined)]:[]));
    return Response.json({error:"context_package_version_conflict"},{status:409});
  }
  if (createPackage) await recordOrganizationAudit(env, organizationId, actor, "OrganizationContextPackageCreated", "context-package", packageId, { blockCount: source.snapshot.blocks.length });
  await recordOrganizationAudit(env, organizationId, actor, "OrganizationContextPackageVersionDrafted", "context-package-version", versionId, { version, blockCount: source.snapshot.blocks.length });
  return Response.json({ packageId, versionId, version, status: "draft", contentSha256: source.digest, blockCount: source.snapshot.blocks.length }, { status: 201 });
}

type CopiedPackageSource={key:string;referenceId:string};

async function cleanupPackageSources(env:WorkerEnv,project:ProjectRequestContext,organizationId:string,sources:CopiedPackageSource[]){
  for(const source of sources){
    const removed=await env.DB.prepare(`DELETE FROM project_resource_scopes
      WHERE project_access_id=? AND organization_id=? AND owner_user_id=? AND resource_kind='media'
        AND resource_id=? AND source_event_id IS NULL`)
      .bind(project.projectAccessId,organizationId,project.ownerUserId,source.key).run().catch(()=>null);
    if(Number(removed?.meta.changes??0)===1&&typeof env.MEDIA.delete==="function")await env.MEDIA.delete(source.key).catch(()=>undefined);
  }
}

async function materializePackageSource(env:WorkerEnv,actor:PilotUser,organizationId:string,project:ProjectRequestContext,documentId:string,block:PackageBlock,cohort:{cohort_id:string}|null,sources:CopiedPackageSource[],now:string):Promise<{properties:Record<string,unknown>;events:Array<{type:string;payload:Record<string,unknown>}>}|Response>{
  if(!block.source)return{properties:{},events:[]};
  if(cohort&&block.source.sourceClassification!=="non-sensitive-licensed")return Response.json({error:"pilot_non_sensitive_source_confirmation_required"},{status:409});
  if(typeof env.MEDIA.get!=="function"||typeof env.MEDIA.put!=="function")return Response.json({error:"organization_source_media_custody_unavailable"},{status:409});
  const stored=await env.MEDIA.get(block.source.objectKey);
  if(!stored||stored.customMetadata?.organizationId!==organizationId||stored.customMetadata.sha256!==block.source.contentSha256)
    return Response.json({error:"organization_source_evidence_integrity_failed"},{status:409});
  const bytes=new Uint8Array(await new Response(stored.body).arrayBuffer());
  if(await bytesDigest(bytes)!==block.source.contentSha256)return Response.json({error:"organization_source_evidence_integrity_failed"},{status:409});
  const extension=block.source.originalName.replace(/[^a-zA-Z0-9._-]/g,"-").slice(0,120)||"source";
  const key=`${ownerMediaNamespace(project.ownerUserId)}/organization-context/${uuidV7()}-${extension}`;
  const referenceId=uuidV7();
  try{
    await env.MEDIA.put(key,bytes.buffer as ArrayBuffer,{httpMetadata:{contentType:block.source.mimeType},customMetadata:{
      ownerId:project.ownerUserId,uploadedBy:actor.userId,organizationId,projectAccessId:project.projectAccessId,
      originalName:block.source.originalName,mimeType:block.source.mimeType,rights:"asserted",sha256:block.source.contentSha256,
      ...(block.source.sourceEvidenceSha256?{sourceEvidenceSha256:block.source.sourceEvidenceSha256}:{}),
      ...(block.source.sourceClassification?{sourceClassification:block.source.sourceClassification}:{}),
      ...(cohort?{pilotCohortId:cohort.cohort_id}:{}),
    }});
    const resource=await env.DB.prepare(`INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at)
      SELECT ?,'media',?,?,?,?,'collaborative_output',NULL,?,? WHERE EXISTS(
        SELECT 1 FROM organization_projects current_project JOIN organizations organization ON organization.organization_id=current_project.organization_id AND organization.status='active'
          JOIN users actor_identity ON actor_identity.user_id=? AND actor_identity.consent_version=?
          JOIN organization_memberships actor_member ON actor_member.organization_id=current_project.organization_id AND actor_member.user_id=?
            AND actor_member.status='active' AND actor_member.accepted_at IS NOT NULL AND actor_member.revoked_at IS NULL
          JOIN organization_memberships owner_member ON owner_member.organization_id=current_project.organization_id AND owner_member.user_id=current_project.owner_user_id
            AND owner_member.status='active' AND owner_member.accepted_at IS NOT NULL AND owner_member.revoked_at IS NULL
          LEFT JOIN project_memberships editor ON editor.project_access_id=current_project.project_access_id
            AND editor.organization_id=current_project.organization_id AND editor.user_id=actor_member.user_id
            AND editor.role='editor' AND editor.status='active' AND editor.revoked_at IS NULL
        WHERE current_project.project_access_id=? AND current_project.organization_id=? AND current_project.owner_user_id=?
          AND current_project.status='active' AND(current_project.owner_user_id=actor_member.user_id OR editor.membership_id IS NOT NULL)
          AND ${effectivePilotParticipantSql("current_project.organization_id","actor_member.user_id")}
          AND NOT ${effectivePilotReviewerSql("current_project.organization_id","actor_member.user_id")} )`)
      .bind(project.projectAccessId,key,organizationId,project.projectId,project.ownerUserId,actor.userId,now,
        actor.userId,POLICY_VERSION,actor.userId,project.projectAccessId,organizationId,project.ownerUserId).run();
    if(Number(resource.meta.changes??0)!==1){if(typeof env.MEDIA.delete==="function")await env.MEDIA.delete(key).catch(()=>undefined);return denied();}
  }catch{if(typeof env.MEDIA.delete==="function")await env.MEDIA.delete(key).catch(()=>undefined);return Response.json({error:"organization_source_media_custody_unavailable"},{status:409});}
  sources.push({key,referenceId});
  const sourceUrl=`/api/media/${encodeURIComponent(key)}`;
  return{properties:{media_url:sourceUrl,reference_id:referenceId},events:[
    {type:"ReferenceIngested",payload:{project_id:project.projectId,document_id:documentId,reference_id:referenceId,source_type:"organization-context",source_ref:sourceUrl,content_hash:block.source.contentSha256,rights_class:"asserted"}},
    {type:"RightsAsserted",payload:{project_id:project.projectId,document_id:documentId,reference_id:referenceId,rights_class:"owned_or_licensed",assertion_method:"organization-context-confirmed"}},
  ]};
}

async function adoptVersion(env: WorkerEnv, actor: PilotUser, organizationId: string, packageId: string, body: Record<string, unknown>) {
  const project = await resolveProject(env, actor, organizationId, safeName(body.projectAccessId, 100), true);
  if (!project) return denied();
  const documentId = safeName(body.documentId, 100);
  const mode = String(body.updateMode ?? "pinned");
  if (!documentId || !["pinned", "follow-approved"].includes(mode)) return Response.json({ error: "valid_context_package_binding_required" }, { status: 400 });
  const targetEvents = await readProjectSourceEvents(env, project);
  const projection = foldEvents(targetEvents, Number.POSITIVE_INFINITY, documentId, project.projectId);
  if (!projection.documents.some((document) => document.id === documentId && !document.removed)) return denied();
  const version = await loadPublishedVersion(env, organizationId, packageId, safeName(body.versionId, 100));
  if (!version) return Response.json({ error: "published_context_package_unavailable" }, { status: 404 });
  const bindingId = uuidV7();
  const now = new Date().toISOString();
  const localIds = new Map(version.snapshot.blocks.map((block) => [block.sourceBlockId, uuidV7()]));
  const copiedSources:CopiedPackageSource[]=[];
  const cleanupSources=()=>cleanupPackageSources(env,project,organizationId,copiedSources);
  const cohort=version.snapshot.blocks.some((block)=>block.source)
    ?await env.DB.prepare(`SELECT cohort_id FROM pilot_cohorts WHERE organization_id=? AND status IN('active','paused','closed')
      ORDER BY CASE WHEN status='closed' THEN 1 ELSE 0 END,created_at DESC LIMIT 1`).bind(organizationId).first<{cohort_id:string}>()
    :null;
  const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
  for (const block of version.snapshot.blocks) {
    const materialized=await materializePackageSource(env,actor,organizationId,project,documentId,block,cohort,copiedSources,now);
    if(materialized instanceof Response){await cleanupSources();return materialized;}
    events.push(...materialized.events);
    events.push({
      type: "BlockCreated",
      payload: {
        project_id: project.projectId,
        document_id: documentId,
        block_id: localIds.get(block.sourceBlockId),
        type: block.type,
        handle: block.handle,
        position: block.position,
        scope: "document",
        properties: {
          ...block.properties,
          ...materialized.properties,
          organization_context_package_id: packageId,
          organization_context_package_version_id: String(version.row.version_id),
          organization_context_package_binding_id: bindingId,
          organization_context_source_block_id: block.sourceBlockId,
        },
      },
    });
    if (block.locked) events.push({ type: "BlockLocked", payload: { project_id: project.projectId, document_id: documentId, block_id: localIds.get(block.sourceBlockId) } });
  }
  for (const relation of version.snapshot.relations) events.push({ type: "BlockRelationAdded", payload: { project_id: project.projectId, document_id: documentId, relation_id: uuidV7(), from_block_id: localIds.get(relation.fromSourceBlockId), to_block_id: localIds.get(relation.toSourceBlockId), kind: relation.kind, properties: relation.properties } });
  if(events.length>MAX_PACKAGE_EVENTS){await cleanupSources();return Response.json({error:"context_package_event_limit_exceeded",maximumEvents:MAX_PACKAGE_EVENTS,requiredEvents:events.length},{status:400});}
  const result = await appendProjectEvents(env, project, actor, { action: "batch", events, ...(Number.isSafeInteger(body.expectedProjectHead) ? { expectedSequence: Number(body.expectedProjectHead) } : {}) }, undefined, {
    buildStatements:(eventId)=>[
      env.DB.prepare(`INSERT INTO project_context_package_bindings(binding_id,organization_id,project_access_id,project_id,document_id,package_id,version_id,update_mode,status,pending_version_id,created_by_user_id,created_at,updated_at)
        SELECT ?,?,?,?,?,?,?,?,'active',NULL,?,?,? WHERE EXISTS(SELECT 1 FROM events WHERE event_id=?)`)
        .bind(bindingId,organizationId,project.projectAccessId,project.projectId,documentId,packageId,String(version.row.version_id),mode,actor.userId,now,now,eventId),
      ...version.snapshot.blocks.map((block)=>env.DB.prepare(`INSERT INTO project_context_package_members(binding_id,organization_id,source_block_id,target_block_id,content_sha256)
        SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM events WHERE event_id=?)
          AND EXISTS(SELECT 1 FROM project_context_package_bindings WHERE binding_id=? AND organization_id=? AND status='active')`)
        .bind(bindingId,organizationId,block.sourceBlockId,localIds.get(block.sourceBlockId)!,block.contentSha256,eventId,bindingId,organizationId)),
    ],
    guardSql: `EXISTS(SELECT 1 FROM organization_context_package_versions version JOIN organization_context_package_contents content
      ON content.version_id=version.version_id AND content.organization_id=version.organization_id AND content.redacted_at IS NULL
      JOIN organization_context_packages package ON package.package_id=version.package_id AND package.organization_id=version.organization_id AND package.status='active'
      WHERE version.version_id=? AND version.organization_id=? AND version.package_id=? AND version.status='published' AND version.redacted_at IS NULL AND version.content_sha256=?)`,
    guardBindings: [String(version.row.version_id), organizationId, packageId, String(version.row.content_sha256)],
  });
  if(!result.ok){await cleanupSources();return result;}
  await recordOrganizationAudit(env, organizationId, actor, "OrganizationContextPackageAdopted", "context-package-binding", bindingId, { version: Number(version.row.version), blockCount: version.snapshot.blocks.length });
  return Response.json({ ...(await result.json() as Record<string, unknown>), bindingId, packageId, versionId: String(version.row.version_id), version: Number(version.row.version), updateMode: mode }, { status: 201 });
}

async function updateBinding(env: WorkerEnv, actor: PilotUser, organizationId: string, packageId: string, bindingId: string, body: Record<string, unknown>) {
  const binding = await env.DB.prepare("SELECT * FROM project_context_package_bindings WHERE binding_id=? AND package_id=? AND organization_id=? AND status='active'")
    .bind(bindingId, packageId, organizationId).first<Record<string, unknown>>();
  if (!binding) return Response.json({ error: "context_package_binding_unavailable" }, { status: 404 });
  const project = await resolveProject(env, actor, organizationId, String(binding.project_access_id), true);
  if (!project) return denied();
  const action = String(body.action ?? "accept");
  const now = new Date().toISOString();
  if (action === "policy") {
    const mode = String(body.updateMode ?? "");
    if (!["pinned", "follow-approved"].includes(mode)) return Response.json({ error: "valid_context_package_update_policy_required" }, { status: 400 });
    const updated=await env.DB.prepare(`UPDATE project_context_package_bindings
      SET update_mode=?,pending_version_id=CASE WHEN ?='pinned' THEN NULL ELSE(
        SELECT next.version_id FROM organization_context_package_versions next
        JOIN organization_context_package_versions applied ON applied.version_id=project_context_package_bindings.version_id
          AND applied.organization_id=project_context_package_bindings.organization_id
        WHERE next.organization_id=project_context_package_bindings.organization_id
          AND next.package_id=project_context_package_bindings.package_id
          AND next.status='published' AND next.redacted_at IS NULL AND next.version>applied.version
        ORDER BY next.version DESC LIMIT 1) END,updated_at=?
      WHERE binding_id=? AND organization_id=? AND package_id=? AND project_access_id=? AND status='active'
        AND EXISTS(SELECT 1 FROM organizations organization
          JOIN organization_projects current_project ON current_project.organization_id=organization.organization_id
          JOIN project_migration_states migration ON migration.project_access_id=current_project.project_access_id
            AND migration.organization_id=organization.organization_id AND migration.status='active'
          JOIN users identity ON identity.user_id=? AND identity.consent_version=?
          JOIN organization_memberships member ON member.organization_id=organization.organization_id AND member.user_id=identity.user_id
            AND member.status='active' AND member.accepted_at IS NOT NULL AND member.revoked_at IS NULL
          JOIN organization_memberships owner ON owner.organization_id=organization.organization_id AND owner.user_id=current_project.owner_user_id
            AND owner.status='active' AND owner.accepted_at IS NOT NULL AND owner.revoked_at IS NULL
          LEFT JOIN project_memberships editor ON editor.project_access_id=current_project.project_access_id
            AND editor.organization_id=organization.organization_id AND editor.user_id=member.user_id
            AND editor.role='editor' AND editor.status='active' AND editor.revoked_at IS NULL
          WHERE organization.organization_id=project_context_package_bindings.organization_id AND organization.status='active'
            AND current_project.project_access_id=project_context_package_bindings.project_access_id AND current_project.status='active'
            AND(current_project.owner_user_id=member.user_id OR editor.membership_id IS NOT NULL)
            AND ${effectivePilotParticipantSql("organization.organization_id","member.user_id")}
            AND NOT ${effectivePilotReviewerSql("organization.organization_id","member.user_id")})`)
      .bind(mode,mode,now,bindingId,organizationId,packageId,project.projectAccessId,actor.userId,POLICY_VERSION).run();
    if(Number(updated.meta.changes??0)!==1)return denied();
    await recordOrganizationAudit(env, organizationId, actor, "OrganizationContextPackageBindingPolicyUpdated", "context-package-binding", bindingId, { updateMode: mode });
    return Response.json({ bindingId, updateMode: mode });
  }
  if (action !== "accept") return Response.json({ error: "valid_context_package_binding_action_required" }, { status: 400 });
  const requestedVersion = safeName(body.versionId, 100);
  if (!requestedVersion) return Response.json({ error: "explicit_context_package_version_required" }, { status: 400 });
  const next = await loadPublishedVersion(env, organizationId, packageId, requestedVersion);
  if (!next || String(next.row.version_id) === String(binding.version_id)) return Response.json({ error: "newer_published_context_package_required" }, { status: 409 });
  const old=await loadPublishedVersion(env,organizationId,packageId,String(binding.version_id),true);
  if (!old || Number(next.row.version) <= Number(old.row.version)) return Response.json({ error: "newer_published_context_package_required" }, { status: 409 });
  const mapping = await env.DB.prepare("SELECT source_block_id,target_block_id,content_sha256 FROM project_context_package_members WHERE binding_id=? AND organization_id=?")
    .bind(bindingId, organizationId).all<{ source_block_id: string; target_block_id: string; content_sha256: string }>();
  const localEvents = await readProjectSourceEvents(env, project);
  const projection = foldEvents(localEvents, Number.POSITIVE_INFINITY, String(binding.document_id), project.projectId);
  const current = new Map(mapping.results.map((row) => [row.source_block_id, row]));
  const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const sidecars:Array<(eventId:string)=>D1PreparedStatement>=[];
  const targetIds=new Map(mapping.results.map((row)=>[row.source_block_id,row.target_block_id]));
  const oldBlocks=new Map(old.snapshot.blocks.map((block)=>[block.sourceBlockId,block]));
  const replacedSources=new Set<string>();
  const copiedSources:CopiedPackageSource[]=[];
  const cleanupSources=()=>cleanupPackageSources(env,project,organizationId,copiedSources);
  const cohort=next.snapshot.blocks.some((block)=>block.source)
    ?await env.DB.prepare(`SELECT cohort_id FROM pilot_cohorts WHERE organization_id=? AND status IN('active','paused','closed')
      ORDER BY CASE WHEN status='closed' THEN 1 ELSE 0 END,created_at DESC LIMIT 1`).bind(organizationId).first<{cohort_id:string}>()
    :null;
  const contextPayload=(blockId:string)=>({project_id:project.projectId,document_id:String(binding.document_id),block_id:blockId});
  for (const nextBlock of next.snapshot.blocks) {
    const existing = current.get(nextBlock.sourceBlockId);
    const prior=oldBlocks.get(nextBlock.sourceBlockId);
    const sourceChanged=Boolean(prior?.source||nextBlock.source)
      &&(prior?.source?.contentSha256!==nextBlock.source?.contentSha256
        ||prior?.source?.sourceEvidenceSha256!==nextBlock.source?.sourceEvidenceSha256
        ||prior?.contentSha256!==nextBlock.contentSha256);
    if (!existing||sourceChanged) {
      if(existing){
        const local=projection.blocks.find((block)=>block.id===existing.target_block_id&&!block.removed);
        if(!local||await blockDigest(local)!==existing.content_sha256){await cleanupSources();return Response.json({error:"context_package_local_override_conflict",blockId:existing.target_block_id},{status:409});}
        if(local.locked)events.push({type:"BlockUnlocked",payload:contextPayload(local.id)});
      }
      const targetId = uuidV7();
      targetIds.set(nextBlock.sourceBlockId,targetId);
      const materialized=await materializePackageSource(env,actor,organizationId,project,String(binding.document_id),nextBlock,cohort,copiedSources,now);
      if(materialized instanceof Response){await cleanupSources();return materialized;}
      events.push(...materialized.events);
      events.push({ type: "BlockCreated", payload: { project_id: project.projectId, document_id: String(binding.document_id), block_id: targetId, type: nextBlock.type, handle: nextBlock.handle, position: nextBlock.position, scope: "document", properties: { ...nextBlock.properties,...materialized.properties, organization_context_package_id: packageId, organization_context_package_version_id: String(next.row.version_id), organization_context_package_binding_id: bindingId, organization_context_source_block_id: nextBlock.sourceBlockId } } });
      if(nextBlock.locked)events.push({type:"BlockLocked",payload:contextPayload(targetId)});
      if(existing){
        replacedSources.add(nextBlock.sourceBlockId);
        events.push({type:"BlockRemoved",payload:contextPayload(existing.target_block_id)});
        sidecars.push((eventId)=>env.DB.prepare(`UPDATE project_context_package_members SET target_block_id=?,content_sha256=?
          WHERE binding_id=? AND organization_id=? AND source_block_id=? AND target_block_id=? AND content_sha256=?
            AND EXISTS(SELECT 1 FROM events WHERE event_id=?)`)
          .bind(targetId,nextBlock.contentSha256,bindingId,organizationId,nextBlock.sourceBlockId,existing.target_block_id,existing.content_sha256,eventId));
      }else sidecars.push((eventId)=>env.DB.prepare(`INSERT INTO project_context_package_members(binding_id,organization_id,source_block_id,target_block_id,content_sha256)
        SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM events WHERE event_id=?)`)
        .bind(bindingId,organizationId,nextBlock.sourceBlockId,targetId,nextBlock.contentSha256,eventId));
      continue;
    }
    if (nextBlock.contentSha256 === existing.content_sha256) continue;
    const local = projection.blocks.find((block) => block.id === existing.target_block_id && !block.removed);
    if (!local || await blockDigest(local) !== existing.content_sha256){await cleanupSources();return Response.json({ error: "context_package_local_override_conflict", blockId: existing.target_block_id }, { status: 409 });}
    if(local.locked)events.push({type:"BlockUnlocked",payload:contextPayload(local.id)});
    if(local.type!==nextBlock.type)events.push({type:"BlockPropertyEdited",payload:{...contextPayload(local.id),property_path:"type",old_value:local.type,new_value:nextBlock.type}});
    if(local.handle!==nextBlock.handle)events.push({type:"BlockRenamed",payload:{...contextPayload(local.id),old_handle:local.handle,new_handle:nextBlock.handle}});
    if(local.position!==nextBlock.position)events.push({type:"BlockPropertyEdited",payload:{...contextPayload(local.id),property_path:"position",old_value:local.position,new_value:nextBlock.position}});
    const before = portableProperties(local.properties);
    const after = portableProperties(nextBlock.properties);
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
      events.push({ type: "BlockPropertyEdited", payload: { project_id: project.projectId, document_id: String(binding.document_id), block_id: local.id, property_path: key, old_value: before[key] ?? null, new_value: after[key] ?? null } });
    }
    events.push({ type: "BlockPropertyEdited", payload: { project_id: project.projectId, document_id: String(binding.document_id), block_id: local.id, property_path: "organization_context_package_version_id", old_value: String(binding.version_id), new_value: String(next.row.version_id) } });
    if(nextBlock.locked)events.push({type:"BlockLocked",payload:contextPayload(local.id)});
    sidecars.push((eventId)=>env.DB.prepare(`UPDATE project_context_package_members SET content_sha256=?
      WHERE binding_id=? AND organization_id=? AND source_block_id=? AND content_sha256=?
        AND EXISTS(SELECT 1 FROM events WHERE event_id=?)`)
      .bind(nextBlock.contentSha256,bindingId,organizationId,nextBlock.sourceBlockId,existing.content_sha256,eventId));
  }
  const relationIdentity=(relation:{fromSourceBlockId:string;toSourceBlockId:string;kind:string;properties:Record<string,unknown>})=>
    JSON.stringify([relation.fromSourceBlockId,relation.toSourceBlockId,relation.kind,relation.properties]);
  const oldRelations=new Map(old.snapshot.relations.map((relation)=>[relationIdentity(relation),relation]));
  const nextRelations=new Map(next.snapshot.relations.map((relation)=>[relationIdentity(relation),relation]));
  for(const [identity,relation] of oldRelations){
    if(nextRelations.has(identity)&&!replacedSources.has(relation.fromSourceBlockId)&&!replacedSources.has(relation.toSourceBlockId))continue;
    const previous=projection.blockRelations.find((candidate)=>!candidate.removed
      &&candidate.fromBlockId===current.get(relation.fromSourceBlockId)?.target_block_id
      &&candidate.toBlockId===current.get(relation.toSourceBlockId)?.target_block_id
      &&candidate.kind===relation.kind
      &&JSON.stringify(portableProperties(candidate.properties))===JSON.stringify(relation.properties));
    if(!previous){await cleanupSources();return Response.json({error:"context_package_local_relation_conflict"},{status:409});}
    events.push({type:"BlockRelationRemoved",payload:{project_id:project.projectId,document_id:String(binding.document_id),relation_id:previous.id}});
  }
  const nextIds = new Set(next.snapshot.blocks.map((block) => block.sourceBlockId));
  for (const existing of mapping.results) {
    if (nextIds.has(existing.source_block_id)) continue;
    const local = projection.blocks.find((block) => block.id === existing.target_block_id && !block.removed);
    if (!local || await blockDigest(local) !== existing.content_sha256){await cleanupSources();return Response.json({ error: "context_package_local_override_conflict", blockId: existing.target_block_id }, { status: 409 });}
    if(local.locked)events.push({type:"BlockUnlocked",payload:contextPayload(local.id)});
    events.push({ type: "BlockRemoved", payload: { project_id: project.projectId, document_id: String(binding.document_id), block_id: existing.target_block_id } });
    sidecars.push((eventId)=>env.DB.prepare(`DELETE FROM project_context_package_members
      WHERE binding_id=? AND organization_id=? AND source_block_id=? AND content_sha256=?
        AND EXISTS(SELECT 1 FROM events WHERE event_id=?)`)
      .bind(bindingId,organizationId,existing.source_block_id,existing.content_sha256,eventId));
  }
  for(const [identity,relation] of nextRelations){
    if(oldRelations.has(identity)&&!replacedSources.has(relation.fromSourceBlockId)&&!replacedSources.has(relation.toSourceBlockId))continue;
    const from=targetIds.get(relation.fromSourceBlockId),to=targetIds.get(relation.toSourceBlockId);
    if(!from||!to){await cleanupSources();return Response.json({error:"context_package_relation_source_unavailable"},{status:409});}
    events.push({type:"BlockRelationAdded",payload:{project_id:project.projectId,document_id:String(binding.document_id),relation_id:uuidV7(),from_block_id:from,to_block_id:to,kind:relation.kind,properties:relation.properties}});
  }
  if(events.length>MAX_PACKAGE_EVENTS){await cleanupSources();return Response.json({error:"context_package_event_limit_exceeded",maximumEvents:MAX_PACKAGE_EVENTS,requiredEvents:events.length},{status:400});}
  const bindingUpdate=(eventId="")=>env.DB.prepare(`UPDATE project_context_package_bindings SET version_id=?,pending_version_id=NULL,updated_at=?
    WHERE binding_id=? AND organization_id=? AND version_id=? AND status='active'
      AND(?='' OR EXISTS(SELECT 1 FROM events WHERE event_id=?))
      AND EXISTS(SELECT 1 FROM organizations organization
        JOIN organization_projects current_project ON current_project.organization_id=organization.organization_id
          AND current_project.project_access_id=project_context_package_bindings.project_access_id AND current_project.status='active'
        JOIN project_migration_states migration ON migration.project_access_id=current_project.project_access_id
          AND migration.organization_id=organization.organization_id AND migration.status='active'
        JOIN users identity ON identity.user_id=? AND identity.consent_version=?
        JOIN organization_memberships authorized ON authorized.organization_id=organization.organization_id AND authorized.user_id=identity.user_id
          AND authorized.status='active' AND authorized.accepted_at IS NOT NULL AND authorized.revoked_at IS NULL
        JOIN organization_memberships owner ON owner.organization_id=organization.organization_id AND owner.user_id=current_project.owner_user_id
          AND owner.status='active' AND owner.accepted_at IS NOT NULL AND owner.revoked_at IS NULL
        LEFT JOIN project_memberships editor ON editor.project_access_id=current_project.project_access_id
          AND editor.organization_id=organization.organization_id AND editor.user_id=authorized.user_id
          AND editor.role='editor' AND editor.status='active' AND editor.revoked_at IS NULL
        WHERE organization.organization_id=project_context_package_bindings.organization_id AND organization.status='active'
          AND(current_project.owner_user_id=authorized.user_id OR editor.membership_id IS NOT NULL)
          AND ${effectivePilotParticipantSql("organization.organization_id","authorized.user_id")}
          AND NOT ${effectivePilotReviewerSql("organization.organization_id","authorized.user_id")})`)
    .bind(String(next.row.version_id),now,bindingId,organizationId,String(binding.version_id),eventId,eventId,actor.userId,POLICY_VERSION);
  if (events.length) {
    sidecars.push((eventId)=>bindingUpdate(eventId));
    const result = await appendProjectEvents(env, project, actor, { action: "batch", events, ...(Number.isSafeInteger(body.expectedProjectHead) ? { expectedSequence: Number(body.expectedProjectHead) } : {}) }, undefined, {
      buildStatements:(eventId)=>sidecars.map((statement)=>statement(eventId)),
      guardSql: `EXISTS(SELECT 1 FROM organization_context_package_versions WHERE version_id=? AND organization_id=? AND package_id=? AND status='published' AND redacted_at IS NULL)
        AND EXISTS(SELECT 1 FROM project_context_package_bindings WHERE binding_id=? AND organization_id=? AND package_id=? AND version_id=? AND status='active')`,
      guardBindings: [String(next.row.version_id),organizationId,packageId,bindingId,organizationId,packageId,String(binding.version_id)],
    });
    if(!result.ok){await cleanupSources();return result;}
  } else {
    const updated = await bindingUpdate().run();
    if (Number(updated.meta.changes ?? 0) !== 1) return Response.json({ error: "context_package_binding_conflict" }, { status: 409 });
  }
  await recordOrganizationAudit(env, organizationId, actor, "OrganizationContextPackageVersionAccepted", "context-package-binding", bindingId, { previousVersion: Number(old.row.version), version: Number(next.row.version), changedBlockCount: sidecars.length });
  return Response.json({ bindingId, versionId: String(next.row.version_id), version: Number(next.row.version), changedEventCount: events.length });
}

/** Canonical organizational decisions are derived, versioned, and adopted only in exact entitled projects. */
export async function handleContextPackages(request: Request, env: WorkerEnv, actor: PilotUser, organizationId: string, path: string[]) {
  const administrativeCapability = hasCapability(actor, "workspace.policy.manage", { organizationId }) || hasCapability(actor, "workspace.project.manage", { organizationId });
  const canManage = Boolean(administrativeCapability&&await env.DB.prepare(`SELECT 1 AS authorized FROM organization_memberships authorized
    WHERE authorized.organization_id=? AND authorized.user_id=? AND authorized.role IN('owner','administrator')
      AND authorized.status='active' AND authorized.accepted_at IS NOT NULL AND authorized.revoked_at IS NULL
      AND ${effectivePilotParticipantSql("authorized.organization_id","authorized.user_id")}
      AND NOT ${effectivePilotReviewerSql("authorized.organization_id","authorized.user_id")}`).bind(organizationId,actor.userId).first());
  if (path.length === 1 && request.method === "GET") {
    const rows = await env.DB.prepare(`SELECT package.package_id,package.name,package.description,package.status,package.created_at,package.updated_at,
      version.version_id,version.version,version.content_sha256,version.published_at,version.approved_by_user_id,
      (SELECT COUNT(*) FROM organization_context_package_sources source WHERE source.version_id=version.version_id AND source.organization_id=package.organization_id) AS block_count,
      (SELECT COUNT(*) FROM project_context_package_bindings binding WHERE binding.package_id=package.package_id AND binding.organization_id=package.organization_id AND binding.status='active') AS binding_count
      FROM organization_context_packages package LEFT JOIN organization_context_package_versions version
        ON version.version_id=(SELECT latest.version_id FROM organization_context_package_versions latest WHERE latest.package_id=package.package_id AND latest.organization_id=package.organization_id
          AND latest.status='published' AND latest.redacted_at IS NULL ORDER BY latest.version DESC LIMIT 1)
      WHERE package.organization_id=? AND package.status='active' AND (?=1 OR version.version_id IS NOT NULL)
      ORDER BY package.updated_at DESC LIMIT 100`).bind(organizationId, Number(canManage)).all<Record<string, unknown>>();
    return Response.json({ packages: rows.results.map((row) => ({ id: String(row.package_id), name: String(row.name), description: String(row.description), status: String(row.status), versionId: row.version_id ? String(row.version_id) : null, version: row.version === null ? null : Number(row.version), contentSha256: row.content_sha256 ? String(row.content_sha256) : null, publishedAt: row.published_at ? String(row.published_at) : null, publishedByUserId: row.approved_by_user_id ? String(row.approved_by_user_id) : null, blockCount: Number(row.block_count ?? 0), bindingCount: Number(row.binding_count ?? 0), createdAt: String(row.created_at), updatedAt: String(row.updated_at) })) });
  }
  if (path.length === 1 && request.method === "POST") {
    if (!canManage) return denied();
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const name = safeName(body.name, 120);
    if (!name) return Response.json({ error: "context_package_name_required" }, { status: 400 });
    return createVersion(env, actor, organizationId, uuidV7(), body, { name, description: safeName(body.description, 500) });
  }
  const packageId = path[1] ?? "";
  if (!packageId) return new Response("Not found", { status: 404 });
  if (path.length === 2 && request.method === "GET") {
    const packageRow = await env.DB.prepare("SELECT package_id,name,description,status,created_by_user_id,created_at,updated_at FROM organization_context_packages WHERE package_id=? AND organization_id=? AND status='active'")
      .bind(packageId, organizationId).first<Record<string, unknown>>();
    if (!packageRow) return new Response("Not found", { status: 404 });
    const versions = await env.DB.prepare(`SELECT version_id,version,status,content_sha256,source_project_access_id,source_document_id,created_by_user_id,approved_by_user_id,published_at,created_at
      FROM organization_context_package_versions WHERE package_id=? AND organization_id=? AND redacted_at IS NULL AND (?=1 OR status='published') ORDER BY version DESC LIMIT 50`)
      .bind(packageId, organizationId, Number(canManage)).all<Record<string, unknown>>();
    if (!canManage && !versions.results.length) return new Response("Not found", { status: 404 });
    return Response.json({ package: packageRow, versions: versions.results });
  }
  if (path.length === 3 && path[2] === "versions" && request.method === "POST") {
    if (!canManage) return denied();
    const active = await env.DB.prepare("SELECT package_id FROM organization_context_packages WHERE package_id=? AND organization_id=? AND status='active'").bind(packageId, organizationId).first();
    if (!active) return new Response("Not found", { status: 404 });
    return createVersion(env, actor, organizationId, packageId, await request.json().catch(() => ({})) as Record<string, unknown>);
  }
  if (path.length === 4 && path[2] === "versions" && request.method === "GET") {
    const loaded=await loadPublishedVersion(env,organizationId,packageId,path[3]??"",true);
    if (!loaded) return new Response("Not found", { status: 404 });
    return Response.json({ versionId: String(loaded.row.version_id), version: Number(loaded.row.version), contentSha256: String(loaded.row.content_sha256), publishedAt: String(loaded.row.published_at), snapshot: loaded.snapshot });
  }
  if (path.length === 5 && path[2] === "versions" && path[4] === "publish" && request.method === "POST") {
    if (!canManage) return denied();
    const versionId = path[3] ?? "";
    const row = await env.DB.prepare(`SELECT version.version,version.content_sha256,content.content_json FROM organization_context_package_versions version
      JOIN organization_context_package_contents content ON content.version_id=version.version_id AND content.organization_id=version.organization_id AND content.redacted_at IS NULL
      WHERE version.version_id=? AND version.package_id=? AND version.organization_id=? AND version.status='draft'`).bind(versionId, packageId, organizationId).first<{ version: number; content_sha256: string; content_json: string }>();
    if (!row || await sha256(row.content_json) !== row.content_sha256) return Response.json({ error: "context_package_draft_unavailable" }, { status: 409 });
    const expired = await env.DB.prepare("SELECT 1 AS present FROM organization_context_package_sources WHERE version_id=? AND organization_id=? AND rights_expires_at IS NOT NULL AND rights_expires_at<=? LIMIT 1")
      .bind(versionId, organizationId, new Date().toISOString()).first();
    if (expired) return Response.json({ error: "context_package_source_rights_expired" }, { status: 409 });
    const now = new Date().toISOString();
    const published = await env.DB.batch([
      env.DB.prepare(`UPDATE organization_context_package_versions SET status='published',approved_by_user_id=?,published_at=?
        WHERE version_id=? AND package_id=? AND organization_id=? AND status='draft' AND content_sha256=?
          AND EXISTS(SELECT 1 FROM organization_memberships authorized JOIN users identity ON identity.user_id=authorized.user_id
            WHERE authorized.organization_id=organization_context_package_versions.organization_id AND authorized.user_id=?
              AND authorized.role IN('owner','administrator') AND authorized.status='active' AND authorized.accepted_at IS NOT NULL
              AND authorized.revoked_at IS NULL AND identity.consent_version=?
              AND ${effectivePilotParticipantSql("authorized.organization_id","authorized.user_id")}
              AND NOT ${effectivePilotReviewerSql("authorized.organization_id","authorized.user_id")})`)
        .bind(actor.userId,now,versionId,packageId,organizationId,row.content_sha256,actor.userId,POLICY_VERSION),
      env.DB.prepare(`UPDATE organization_context_packages SET updated_at=? WHERE package_id=? AND organization_id=? AND status='active'
        AND EXISTS(SELECT 1 FROM organization_context_package_versions WHERE version_id=? AND package_id=? AND organization_id=?
          AND status='published' AND published_at=? AND approved_by_user_id=?)`)
        .bind(now,packageId,organizationId,versionId,packageId,organizationId,now,actor.userId),
      env.DB.prepare(`UPDATE project_context_package_bindings SET pending_version_id=?,updated_at=?
        WHERE organization_id=? AND package_id=? AND status='active' AND update_mode='follow-approved' AND version_id<>?
          AND EXISTS(SELECT 1 FROM organization_context_package_versions WHERE version_id=? AND organization_id=?
            AND status='published' AND published_at=? AND approved_by_user_id=?)`)
        .bind(versionId,now,organizationId,packageId,versionId,versionId,organizationId,now,actor.userId),
      env.DB.prepare(`INSERT OR IGNORE INTO project_notifications(notification_id,project_access_id,organization_id,project_id,recipient_user_id,event_id,kind,artifact_id,document_id,message,created_at,expires_at,read_at)
        SELECT lower(hex(randomblob(16))),binding.project_access_id,binding.organization_id,binding.project_id,member.user_id,
          'context-package:'||?||':'||binding.binding_id,'context_update_available',NULL,binding.document_id,
          'A published organization context update is available for your document.',?,strftime('%Y-%m-%dT%H:%M:%fZ',?,'+30 days'),NULL
        FROM project_context_package_bindings binding
          JOIN organization_projects project ON project.project_access_id=binding.project_access_id AND project.organization_id=binding.organization_id AND project.status='active'
          JOIN organization_memberships member ON member.organization_id=binding.organization_id AND member.status='active'
            AND member.accepted_at IS NOT NULL AND member.revoked_at IS NULL
          LEFT JOIN project_memberships editor ON editor.project_access_id=binding.project_access_id AND editor.organization_id=binding.organization_id
            AND editor.user_id=member.user_id AND editor.role='editor' AND editor.status='active' AND editor.revoked_at IS NULL
        WHERE binding.organization_id=? AND binding.package_id=? AND binding.pending_version_id=? AND binding.status='active'
          AND(project.owner_user_id=member.user_id OR editor.membership_id IS NOT NULL)
          AND ${effectivePilotParticipantSql("binding.organization_id","member.user_id")}`)
        .bind(versionId,now,now,organizationId,packageId,versionId),
    ]);
    if(published.slice(0,2).some((result)=>Number(result.meta.changes??0)!==1))return Response.json({error:"context_package_version_conflict"},{status:409});
    await recordOrganizationAudit(env, organizationId, actor, "OrganizationContextPackageVersionPublished", "context-package-version", versionId, { version: Number(row.version) });
    return Response.json({ packageId, versionId, version: Number(row.version), status: "published", contentSha256: row.content_sha256 });
  }
  if (path.length === 3 && path[2] === "adopt" && request.method === "POST") return adoptVersion(env, actor, organizationId, packageId, await request.json().catch(() => ({})) as Record<string, unknown>);
  if (path.length === 3 && path[2] === "bindings" && request.method === "GET") {
    const rows = await env.DB.prepare("SELECT * FROM project_context_package_bindings WHERE package_id=? AND organization_id=? AND status='active' ORDER BY updated_at DESC LIMIT 100")
      .bind(packageId, organizationId).all<Record<string, unknown>>();
    return Response.json({ bindings: rows.results.filter((row) => hasCapability(actor, "project.read", { organizationId, projectAccessId: String(row.project_access_id) })) });
  }
  if (path.length === 4 && path[2] === "bindings" && request.method === "PATCH") return updateBinding(env, actor, organizationId, packageId, path[3] ?? "", await request.json().catch(() => ({})) as Record<string, unknown>);
  return new Response("Not found", { status: 404 });
}

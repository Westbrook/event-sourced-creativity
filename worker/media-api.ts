import { hasCapability, requireConsent, requireUser } from "./pilot-policy.ts";
import { readProjectRequestContext, synchronizeProjectScope } from "./project-access.ts";
import { mediaKeyMatchesOwnerNamespace, ownerMediaNamespace } from "../src/model/media-ownership.ts";
import { extractSourceDocument, sourceDocumentEvidence, sourceDocumentEvidenceDigest, sourceDocumentEvidenceFromProperties } from "../src/model/source-documents.ts";
import { effectivePilotParticipantSql, effectivePilotReviewerSql } from "./access-policy.ts";
import { audioFileExtension, audioMimeType, MAX_AUDIO_UPLOAD_BYTES } from "../src/model/audio.ts";
import { verifiedAudioTiming } from "../src/model/audio-container.ts";
import type { WorkerEnv } from "./runtime.ts";

const SAFE_UPLOADED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"]);
const SAFE_UPLOADED_DOCUMENT_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

export function applySafeMediaResponseHeaders(headers: Headers) {
  headers.set("content-security-policy", "default-src 'none'; sandbox");
  headers.set("x-content-type-options", "nosniff");
  headers.set("cache-control", "private, no-store");
}

export async function storeGeneratedMedia(env:WorkerEnv,ownerId:string,artifactId:string,bytes:Uint8Array,model:string,mimeType:string,metadata:Record<string,string>={}) {
  const extension=audioFileExtension(mimeType)??(mimeType==="video/mp4"?"mp4":mimeType==="image/jpeg"?"jpg":mimeType==="image/webp"?"webp":mimeType==="application/pdf"?"pdf":"png");
  const key=`${ownerMediaNamespace(ownerId)}/generated/${artifactId}.${extension}`;
  const digest=await crypto.subtle.digest("SHA-256",new Uint8Array(bytes).buffer);
  const contentHash=Array.from(new Uint8Array(digest),(value)=>value.toString(16).padStart(2,"0")).join("");
  const timing=audioMimeType(mimeType)?verifiedAudioTiming(bytes,mimeType):null;
  await env.MEDIA.put(key,new Uint8Array(bytes).buffer,{httpMetadata:{contentType:mimeType},customMetadata:{ownerId,artifactId,model,source:"provider-generated-media",...(audioMimeType(mimeType)?{sha256:contentHash}:{}),...(timing?{durationSeconds:String(timing.durationSeconds),sampleRate:String(timing.sampleRate)}:{}),...metadata}});
  return{key,url:`/api/media/${encodeURIComponent(key)}`,mimeType,contentHash,durationSeconds:timing?.durationSeconds??null};
}

export async function storeGeneratedImage(env:WorkerEnv,ownerId:string,generationId:string,bytes:Uint8Array,model:string,mimeType="image/png",metadata:Record<string,string>={}) {
  return storeGeneratedMedia(env,ownerId,generationId,bytes,model,mimeType,{generationId,source:"provider-image-api",...metadata});
}

export async function readGeneratedImageReference(env:WorkerEnv,ownerId:string,mediaUrl:unknown) {
  const value=String(mediaUrl??"");const prefix="/api/media/";if(!value.startsWith(prefix))return null;
  let key="";try{key=decodeURIComponent(value.slice(prefix.length));}catch{return null;}
  if(!mediaKeyMatchesOwnerNamespace(key,ownerId))return null;
  const object=await env.MEDIA.get(key);if(!object||object.customMetadata?.ownerId!==ownerId)return null;
  const headers=new Headers();object.writeHttpMetadata(headers);const mimeType=headers.get("content-type")??"image/png";if(!mimeType.startsWith("image/"))return null;
  const metadata=object.customMetadata??{};const providerMediaUrl=String(metadata.providerMediaUrl??"").trim();
  return{bytes:new Uint8Array(await new Response(object.body).arrayBuffer()),mimeType,provider:String(metadata.provider??"")||null,providerModel:String(metadata.providerModel??metadata.model??"")||null,providerRequestId:String(metadata.providerRequestId??"")||null,providerMediaUrl:providerMediaUrl||null};
}

/** Retrieve only private, owner-scoped recordings; never trust browser-supplied URLs or metadata. */
export async function readOwnedAudioReference(env: WorkerEnv, ownerId: string, mediaUrl: unknown, options: { metadataOnly?: boolean } = {}) {
  const value = String(mediaUrl ?? "");
  const prefix = "/api/media/";
  if (!value.startsWith(prefix)) return null;
  let key = "";
  try { key = decodeURIComponent(value.slice(prefix.length)); } catch { return null; }
  if (!mediaKeyMatchesOwnerNamespace(key, ownerId)) return null;
  const object = options.metadataOnly && typeof env.MEDIA.head === "function" ? await env.MEDIA.head(key) : await env.MEDIA.get(key);
  if (!object || object.customMetadata?.ownerId !== ownerId) return null;
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  const mimeType = audioMimeType(headers.get("content-type"));
  if (!mimeType) return null;
  const bytes = options.metadataOnly ? new Uint8Array(0) : new Uint8Array(await new Response((object as R2ObjectBody).body).arrayBuffer());
  if (!options.metadataOnly && (!bytes.byteLength || bytes.byteLength > MAX_AUDIO_UPLOAD_BYTES)) return null;
  return { key, bytes, mimeType, metadata: object.customMetadata ?? {}, durationSeconds: Number(object.customMetadata?.durationSeconds ?? 0) || null, size: typeof object.size === "number" ? object.size : bytes.byteLength };
}

/** Validate server-extracted source facts against immutable R2-owned evidence metadata. */
export async function verifySourceDocumentEvidence(env: WorkerEnv, ownerId: string, mediaUrl: unknown, properties: Record<string, unknown>): Promise<boolean> {
  const prefix = "/api/media/";
  if (typeof mediaUrl !== "string" || !mediaUrl.startsWith(prefix)) return false;
  let key = "";
  try { key = decodeURIComponent(mediaUrl.slice(prefix.length)); } catch { return false; }
  if (!mediaKeyMatchesOwnerNamespace(key, ownerId)) return false;
  const object = typeof env.MEDIA.head === "function" ? await env.MEDIA.head(key) : await env.MEDIA.get(key);
  const metadata = object?.customMetadata;
  if (!metadata || metadata.ownerId !== ownerId) return false;
  if (!metadata.sourceEvidenceSha256) {
    const claimedMime = String(properties.source_mime_type ?? "");
    const actualMime = String(metadata.mimeType ?? "");
    if (actualMime && claimedMime && actualMime !== claimedMime) return false;
    if (actualMime && !actualMime.startsWith("image/") || claimedMime && !claimedMime.startsWith("image/")) return false;
    if (properties.source_evidence_hash || properties.source_content_hash || properties.source_kind || properties.source_citations !== undefined
      || properties.source_segment_count !== undefined || properties.source_excerpt_truncated !== undefined || properties.extraction_status === "ready") return false;
    // Compatibility is intentionally limited to existing private image
    // references that make no claims about extracted document evidence.
    return true;
  }
  if (String(properties.source_evidence_hash ?? "") !== metadata.sourceEvidenceSha256) return false;
  if (String(properties.source_mime_type ?? "") !== metadata.mimeType || String(properties.source_content_hash ?? "") !== metadata.sha256) return false;
  const supplied = sourceDocumentEvidenceFromProperties(properties, metadata.sha256 ?? "", metadata.mimeType ?? "");
  return await sourceDocumentEvidenceDigest(supplied) === metadata.sourceEvidenceSha256;
}

/** Controlled sources stay usable across closed, same-organization cohorts without losing exact project custody. */
export async function managedPilotSourceClassificationValid(env:WorkerEnv,ownerId:string,cohortId:string,blocks:Array<{type:string;properties:Record<string,unknown>}>,projectAccessId=""):Promise<boolean>{
  const references=blocks.filter((block)=>(block.type==="reference"||block.type==="audio")&&String(block.properties.media_url??"").trim());
  for(const {properties} of references){
    const reference=String(properties.media_url??"").trim();
    if(!reference.startsWith("/api/media/"))return false;
    let key="";try{key=decodeURIComponent(reference.slice("/api/media/".length));}catch{return false;}
    if(!mediaKeyMatchesOwnerNamespace(key,ownerId))return false;
    const object=typeof env.MEDIA.head==="function"?await env.MEDIA.head(key):typeof env.MEDIA.get==="function"?await env.MEDIA.get(key):null;
    const metadata=object?.customMetadata;
    if(!metadata||metadata.ownerId!==ownerId)return false;
    if(metadata.source==="provider-generated-media"||metadata.source==="provider-image-api")continue;
    if(metadata.sourceClassification!=="non-sensitive-licensed")return false;
    const claimedHash=String(properties.source_content_hash??"");
    if(claimedHash&&claimedHash!==String(metadata.sha256??""))return false;
    if(projectAccessId&&metadata.projectAccessId&&metadata.projectAccessId!==projectAccessId)return false;
    if(metadata.pilotCohortId===cohortId)continue;
    if(!projectAccessId||metadata.projectAccessId!==projectAccessId||!metadata.pilotCohortId)return false;
    const predecessor=await env.DB.prepare(`SELECT 1 AS valid FROM pilot_cohorts current_cohort
      JOIN pilot_cohorts predecessor ON predecessor.organization_id=current_cohort.organization_id AND predecessor.status='closed'
      JOIN project_resource_scopes resource ON resource.organization_id=current_cohort.organization_id
        AND resource.project_access_id=? AND resource.project_id=(SELECT project_id FROM organization_projects WHERE project_access_id=resource.project_access_id)
        AND resource.owner_user_id=? AND resource.resource_kind='media' AND resource.resource_id=?
      WHERE current_cohort.cohort_id=? AND current_cohort.status IN ('active','paused')
        AND predecessor.cohort_id=? AND predecessor.cohort_id!=current_cohort.cohort_id
        AND predecessor.created_at<=current_cohort.created_at`)
      .bind(projectAccessId,ownerId,key,cohortId,String(metadata.pilotCohortId)).first();
    if(!predecessor)return false;
  }
  return true;
}

export async function uploadMedia(request: Request, env: WorkerEnv) {
  const scoped=/(?:^|;\s*)forma_project_context=/.test(request.headers.get("cookie")??"");
  const auth=await requireUser(request,env,scoped?"viewer":"creator",scoped?{account:"principal"}:{});if(auth.response||!auth.user)return auth.response!;const consent=requireConsent(auth.user);if(consent)return consent;
  const selected=scoped?await readProjectRequestContext(request,env,auth.user):{context:null,response:null};
  if(selected.response)return selected.response;
  if(selected.context&&!hasCapability(auth.user,"project.author",{organizationId:selected.context.organizationId,projectAccessId:selected.context.projectAccessId}))return new Response("Forbidden",{status:403});
  const form=await request.formData();const file=form.get("file");
  if(!(file instanceof File))return Response.json({error:"A supported image, audio recording, or document is required"},{status:400});
  if(form.get("rightsConfirmed")!=="true")return Response.json({error:"external_asset_rights_confirmation_required"},{status:428});
  const managedPilot=selected.context
    ?await env.DB.prepare("SELECT cohort_id,source_classification FROM pilot_cohorts WHERE organization_id=? AND status IN ('active','paused','closed') ORDER BY CASE WHEN status='closed' THEN 1 ELSE 0 END,created_at DESC LIMIT 1")
      .bind(selected.context.organizationId).first<{cohort_id:string;source_classification:string}>()
    :await env.DB.prepare(`SELECT cohort.cohort_id,cohort.source_classification FROM pilot_cohorts cohort
      JOIN pilot_participants participant ON participant.cohort_id=cohort.cohort_id AND participant.organization_id=cohort.organization_id
      WHERE participant.user_id=? AND participant.status='active' AND participant.revoked_at IS NULL AND cohort.status IN ('active','paused','closed')
        AND (cohort.status!='closed' OR NOT EXISTS(SELECT 1 FROM pilot_cohorts successor WHERE successor.organization_id=cohort.organization_id AND successor.status IN ('active','paused')))
      ORDER BY CASE WHEN cohort.status='closed' THEN 1 ELSE 0 END,cohort.created_at DESC LIMIT 1`)
      .bind(auth.user.userId).first<{cohort_id:string;source_classification:string}>();
  if(managedPilot&&form.get("nonSensitiveConfirmed")!=="true")return Response.json({error:"pilot_non_sensitive_source_confirmation_required"},{status:428});
  const mimeType=file.type.toLowerCase();
  const isAudio=Boolean(audioMimeType(mimeType));
  if((!SAFE_UPLOADED_IMAGE_TYPES.has(mimeType)&&!SAFE_UPLOADED_DOCUMENT_TYPES.has(mimeType)&&!isAudio)||file.size>(isAudio?MAX_AUDIO_UPLOAD_BYTES:12*1024*1024))return Response.json({error:isAudio?"Choose an MP3, WAV, M4A, AAC, OGG, FLAC, or WebM audio recording smaller than 25 MB.":"Choose a supported image, audio recording, PDF, text, Markdown, CSV, JSON, Word, presentation, or spreadsheet smaller than 12 MB."},{status:400});
  const owner=selected.context?.ownerUserId??auth.user.userId;
  const key=`${ownerMediaNamespace(owner)}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,"-")}`;
  const bytes=await file.arrayBuffer();
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  const contentHash=[...new Uint8Array(digest)].map((byte)=>byte.toString(16).padStart(2,"0")).join("");
  const extraction=SAFE_UPLOADED_DOCUMENT_TYPES.has(mimeType)?await extractSourceDocument(file):null;
  const evidence=extraction?sourceDocumentEvidence(extraction,contentHash,mimeType):null;
  const sourceEvidenceHash=evidence?await sourceDocumentEvidenceDigest(evidence):null;
  const timing=isAudio?verifiedAudioTiming(new Uint8Array(bytes),mimeType):null;
  await env.MEDIA.put(key,bytes,{httpMetadata:{contentType:mimeType},customMetadata:{originalName:file.name,ownerId:owner,uploadedBy:auth.user.userId,rights:"asserted",sha256:contentHash,mimeType,...(timing?{durationSeconds:String(timing.durationSeconds),sampleRate:String(timing.sampleRate)}:{}),...(sourceEvidenceHash?{sourceEvidenceSha256:sourceEvidenceHash}:{}),...(selected.context?{projectAccessId:selected.context.projectAccessId}:{}),...(managedPilot?{sourceClassification:managedPilot.source_classification,pilotCohortId:managedPilot.cohort_id}:{})}});
  if(selected.context){
    try{
      const inserted=await env.DB.prepare(`INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at)
        SELECT ?,'media',?,?,?,?, 'collaborative_output',NULL,?,? WHERE EXISTS(
          SELECT 1 FROM organization_projects project JOIN organizations organization ON organization.organization_id=project.organization_id AND organization.status='active'
          JOIN organization_memberships member ON member.organization_id=project.organization_id AND member.user_id=? AND member.status='active' AND member.accepted_at IS NOT NULL AND member.revoked_at IS NULL
          JOIN organization_memberships owner_member ON owner_member.organization_id=project.organization_id AND owner_member.user_id=project.owner_user_id AND owner_member.status='active' AND owner_member.accepted_at IS NOT NULL AND owner_member.revoked_at IS NULL
          LEFT JOIN project_memberships project_member ON project_member.project_access_id=project.project_access_id AND project_member.organization_id=project.organization_id AND project_member.project_id=project.project_id AND project_member.user_id=? AND project_member.status='active' AND project_member.revoked_at IS NULL
          WHERE project.project_access_id=? AND project.organization_id=? AND project.status='active' AND (project.owner_user_id=? OR project_member.role='editor')
            AND ${effectivePilotParticipantSql("project.organization_id","member.user_id")}
            AND NOT ${effectivePilotReviewerSql("project.organization_id","member.user_id")}
            AND EXISTS(SELECT 1 FROM project_context_sessions selected WHERE selected.context_id=? AND selected.principal_user_id=member.user_id
              AND selected.project_access_id=project.project_access_id AND selected.organization_id=project.organization_id
              AND selected.revoked_at IS NULL AND selected.expires_at>?))`)
        .bind(selected.context.projectAccessId,key,selected.context.organizationId,selected.context.projectId,owner,auth.user.userId,new Date().toISOString(),auth.user.userId,auth.user.userId,selected.context.projectAccessId,selected.context.organizationId,auth.user.userId,selected.context.contextId,new Date().toISOString()).run();
      if(Number(inserted.meta.changes??0)!==1)throw new Error("project_access_revoked");
    }catch{await env.MEDIA.delete(key).catch(()=>undefined);return new Response("Forbidden",{status:403});}
  }
  return Response.json({key,url:`/api/media/${encodeURIComponent(key)}`,name:file.name,mimeType,contentHash,kind:isAudio?"audio":SAFE_UPLOADED_IMAGE_TYPES.has(mimeType)?"image":"document",rights:"asserted",size:file.size,...(timing?{durationSeconds:timing.durationSeconds}:{}),...(extraction&&sourceEvidenceHash?{extraction,sourceEvidenceHash}:{}),...(managedPilot?{sourceClassification:managedPilot.source_classification}:{})});
}
export async function getMedia(request:Request,key:string,env:WorkerEnv){
  const scoped=/(?:^|;\s*)forma_project_context=/.test(request.headers.get("cookie")??"");
  const auth=await requireUser(request,env,"viewer",scoped?{account:"principal"}:{});if(auth.response||!auth.user)return auth.response!;
  const selected=scoped?await readProjectRequestContext(request,env,auth.user):{context:null,response:null};
  if(selected.response)return selected.response;
  if(selected.context)await synchronizeProjectScope(env,selected.context);
  const resource=selected.context
    ?await env.DB.prepare("SELECT project_access_id,organization_id,owner_user_id FROM project_resource_scopes WHERE project_access_id=? AND organization_id=? AND owner_user_id=? AND resource_kind='media' AND resource_id=?")
      .bind(selected.context.projectAccessId,selected.context.organizationId,selected.context.ownerUserId,key).first<{project_access_id:string;organization_id:string;owner_user_id:string}>()
    :await env.DB.prepare("SELECT project_access_id,organization_id,owner_user_id FROM project_resource_scopes WHERE resource_kind='media' AND resource_id=? LIMIT 1")
      .bind(key).first<{project_access_id:string;organization_id:string;owner_user_id:string}>();
  if(resource){
    if(!hasCapability(auth.user,"project.read",{organizationId:resource.organization_id,projectAccessId:resource.project_access_id}))return new Response("Forbidden",{status:403});
    if(selected.context&&(selected.context.organizationId!==resource.organization_id||selected.context.projectAccessId!==resource.project_access_id))return new Response("Forbidden",{status:403});
  }else if(selected.context)return new Response("Forbidden",{status:403});
  const owner=resource?.owner_user_id??auth.user.userId;
  if(!mediaKeyMatchesOwnerNamespace(key,owner))return new Response("Forbidden",{status:403});
  const object=await env.MEDIA.get(key);if(!object)return new Response("Not found",{status:404});
  if(object.customMetadata?.ownerId!==owner)return new Response("Forbidden",{status:403});
  const headers=new Headers();object.writeHttpMetadata(headers);headers.set("etag",object.httpEtag);applySafeMediaResponseHeaders(headers);
  const mimeType=String(headers.get("content-type")??"").toLowerCase();
  if(!mimeType.startsWith("image/")&&!mimeType.startsWith("video/")&&!mimeType.startsWith("audio/")){
    const filename=String(object.customMetadata?.originalName??"reference-document").replace(/[\r\n"\\]/g,"_");
    const fallback=filename.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^\x20-\x7e]/g,"_")||"reference-document";
    const encoded=encodeURIComponent(filename).replace(/[!'()*]/g,(character)=>`%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    headers.set("content-disposition",`attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`);
  }
  if(mimeType.startsWith("audio/")||mimeType.startsWith("video/")){
    const totalBytes=typeof object.size==="number"&&Number.isSafeInteger(object.size)&&object.size>=0?object.size:null;
    if(totalBytes!==null){
      headers.set("accept-ranges","bytes");
      const requestedRange=request.headers.get("range");
      if(requestedRange){
        const match=requestedRange.match(/^bytes=(\d*)-(\d*)$/i);
        let offset=0,length=0;
        if(match&&(match[1]||match[2])){
          if(match[1]){offset=Number(match[1]);const end=match[2]?Math.min(totalBytes-1,Number(match[2])):totalBytes-1;length=end-offset+1;}
          else{length=Math.min(totalBytes,Number(match[2]));offset=totalBytes-length;}
        }
        if(!match||!Number.isSafeInteger(offset)||!Number.isSafeInteger(length)||offset<0||length<=0||offset>=totalBytes){headers.set("content-range",`bytes */${totalBytes}`);return new Response(null,{status:416,headers});}
        const partial=await env.MEDIA.get(key,{range:{offset,length}});
        if(!partial||partial.customMetadata?.ownerId!==owner)return new Response("Not found",{status:404});
        headers.set("content-range",`bytes ${offset}-${offset+length-1}/${totalBytes}`);
        headers.set("content-length",String(length));
        return new Response(partial.body,{status:206,headers});
      }
    }
  }
  return new Response(object.body,{headers});
}

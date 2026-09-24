import {isCreationIndexKey} from './creation-vectors.ts';
import {projectMemoryAuthoredImage} from './memory-authored-image.ts';
import {memoryAuthoredImageMediaAllowed} from './memory-authored-image-custody.ts';
import { hasCapability, requireConsent, requireUser } from "./pilot-policy.ts";
import { hasProjectContextCookie, readProjectRequestContext, synchronizeProjectScope } from "./project-access.ts";
import { mediaKeyMatchesOwnerNamespace, ownerMediaNamespace } from "../src/model/media-ownership.ts";
import { canonicalSourceDocumentMime, extractSourceDocument, sourceDocumentEvidence, sourceDocumentEvidenceDigest } from "../src/model/source-documents.ts";
import { effectivePilotParticipantSql, effectivePilotReviewerSql } from "./access-policy.ts";
import { audioFileExtension, audioMimeType, MAX_AUDIO_UPLOAD_BYTES } from "../src/model/audio.ts";
import { verifiedAudioTiming } from "../src/model/audio-container.ts";
import { MAX_MODEL3D_UPLOAD_BYTES, MODEL3D_MIME_TYPE, model3dMimeType, validateModel3dAsset, validateModel3dContainer } from "../src/model/model3d-assets.ts";
import { normalizeModel3dView } from "../src/model/model3d-view.ts";
import { normalizeReferenceComposition } from "../src/model/reference-composition.ts";
import type { WorkerEnv } from "./runtime.ts";
import { SAFE_UPLOADED_IMAGE_TYPES, sha256Hex, ownedCompositionSourcesValid } from "./source-reference-evidence.ts";
import { beginSponsorNativeImageRead } from "./experience-sponsor-native-image-read.ts";
import { readSponsorGeneratedImageMedia } from "./generated-image-api.ts";
import { SponsorReadLimitError } from "./experience-sponsor-read-attempts.ts";
import { VIDEO_COVER_QUERY } from "../src/model/video-cover.ts";
import { handleVideoCover } from "./video-cover.ts";
export { verifyReferenceCompositionAssets, verifySourceDocumentEvidence } from "./source-reference-evidence.ts";

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
  let modelAsset:ReturnType<typeof validateModel3dContainer>|null=null,previewSupported:boolean|undefined;
  if(mimeType===MODEL3D_MIME_TYPE){
    try{modelAsset=validateModel3dAsset(bytes,mimeType);previewSupported=true;}
    catch{modelAsset=validateModel3dContainer(bytes);previewSupported=false;}
  }
  const extension=audioFileExtension(mimeType)??(mimeType===MODEL3D_MIME_TYPE?"glb":mimeType==="model/vnd.usdz+zip"?"usdz":mimeType==="model/obj"?"obj":mimeType==="model/stl"?"stl":mimeType==="application/octet-stream"&&metadata.modelFormat==="fbx"?"fbx":mimeType==="application/zip"?"zip":mimeType==="video/mp4"?"mp4":mimeType==="image/jpeg"?"jpg":mimeType==="image/webp"?"webp":mimeType==="application/pdf"?"pdf":"png");
  const key=`${ownerMediaNamespace(ownerId)}/generated/${artifactId}.${extension}`;
  const digest=await crypto.subtle.digest("SHA-256",bytes as Uint8Array<ArrayBuffer>);
  const contentHash=Array.from(new Uint8Array(digest),(value)=>value.toString(16).padStart(2,"0")).join("");
  const timing=audioMimeType(mimeType)?verifiedAudioTiming(bytes,mimeType):null;
  const retainedBytes=bytes.buffer instanceof ArrayBuffer&&bytes.byteOffset===0&&bytes.byteLength===bytes.buffer.byteLength?bytes.buffer:bytes.slice().buffer as ArrayBuffer;
  await env.MEDIA.put(key,retainedBytes,{httpMetadata:{contentType:mimeType},customMetadata:{ownerId,artifactId,model,source:"provider-generated-media",sha256:contentHash,mimeType,...(timing?{durationSeconds:String(timing.durationSeconds),sampleRate:String(timing.sampleRate)}:{}),...metadata,...(modelAsset?{modelFormat:modelAsset.format,sha256:contentHash,mimeType:MODEL3D_MIME_TYPE,modelPreviewSafe:String(previewSupported)}:{})}});
  return{key,url:`/api/media/${encodeURIComponent(key)}`,mimeType,contentHash,durationSeconds:timing?.durationSeconds??null,...(previewSupported===undefined?{}:{previewSupported})};
}

export async function storeGeneratedImage(env:WorkerEnv,ownerId:string,generationId:string,bytes:Uint8Array,model:string,mimeType="image/png",metadata:Record<string,string>={}) {
  return storeGeneratedMedia(env,ownerId,generationId,bytes,model,mimeType,{generationId,source:"provider-image-api",...metadata});
}

export async function readGeneratedImageReference(env:WorkerEnv,ownerId:string,mediaUrl:unknown) {
  const value=String(mediaUrl??"");const prefix="/api/media/";if(!value.startsWith(prefix))return null;
  let key="";try{key=decodeURIComponent(value.slice(prefix.length));}catch{return null;}
  if(!mediaKeyMatchesOwnerNamespace(key,ownerId)||!await memoryAuthoredImageMediaAllowed(env,ownerId,key))return null;
  const object=await env.MEDIA.get(key);if(!object||object.customMetadata?.ownerId!==ownerId)return null;
  const headers=new Headers();object.writeHttpMetadata(headers);const mimeType=headers.get("content-type")??"image/png";if(!mimeType.startsWith("image/"))return null;
  const metadata=object.customMetadata??{};const providerMediaUrl=String(metadata.providerMediaUrl??"").trim();
  const bytes=new Uint8Array(await new Response(object.body).arrayBuffer());if(!await memoryAuthoredImageMediaAllowed(env,ownerId,key)){bytes.fill(0);return null;}
  return{bytes,mimeType,provider:String(metadata.provider??"")||null,providerModel:String(metadata.providerModel??metadata.model??"")||null,providerRequestId:String(metadata.providerRequestId??"")||null,providerMediaUrl:providerMediaUrl||null};
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

/** Read private GLB assets whose format and owner were verified at ingestion. */
export async function readOwnedModel3dReference(env: WorkerEnv, ownerId: string, mediaUrl: unknown, options: { metadataOnly?: boolean; projectAccessId?: string } = {}) {
  const value = String(mediaUrl ?? ""), prefix = "/api/media/";
  if (!value.startsWith(prefix)) return null;
  let key = "";
  try { key = decodeURIComponent(value.slice(prefix.length)); } catch { return null; }
  if (!mediaKeyMatchesOwnerNamespace(key, ownerId)) return null;
  const object = options.metadataOnly && typeof env.MEDIA.head === "function" ? await env.MEDIA.head(key) : await env.MEDIA.get(key);
  const metadata = object?.customMetadata;
  if (!object || !metadata || metadata.ownerId !== ownerId || metadata.modelFormat !== "glb" || metadata.modelPreviewSafe === "false" || !/^[a-f0-9]{64}$/.test(metadata.sha256 ?? "")) return null;
  const headers = new Headers(); object.writeHttpMetadata(headers);
  if (headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== MODEL3D_MIME_TYPE || metadata.mimeType !== MODEL3D_MIME_TYPE) return null;
  if (metadata.rights !== "asserted" && metadata.source !== "provider-generated-media") return null;
  if (typeof object.size === "number" && (!object.size || object.size > MAX_MODEL3D_UPLOAD_BYTES)) return null;
  if (options.projectAccessId) {
    if (metadata.projectAccessId && metadata.projectAccessId !== options.projectAccessId) return null;
    const scoped = await env.DB.prepare("SELECT 1 AS valid FROM project_resource_scopes WHERE project_access_id=? AND resource_kind='media' AND resource_id=? AND owner_user_id=?")
      .bind(options.projectAccessId, key, ownerId).first();
    if (!scoped) return null;
  }
  const bytes = options.metadataOnly ? new Uint8Array(0) : new Uint8Array(await new Response((object as R2ObjectBody).body).arrayBuffer());
  if (!options.metadataOnly) { try { validateModel3dAsset(bytes); } catch { return null; } }
  return { key, bytes, mimeType: MODEL3D_MIME_TYPE, metadata, size: typeof object.size === "number" ? object.size : bytes.byteLength };
}

/** The saved PNG is a separately ingested asset bound to this model hash and camera. */
export async function verifyModel3dBlockAssets(env: WorkerEnv, ownerId: string, properties: Record<string, unknown>, projectAccessId = ""): Promise<boolean> {
  const original = await readOwnedModel3dReference(env, ownerId, properties.model_url, { metadataOnly: true, projectAccessId });
  if (!original || properties.model_mime_type !== MODEL3D_MIME_TYPE || properties.model_content_hash !== original.metadata.sha256) return false;
  const mediaUrl = String(properties.media_url ?? "");
  if (!mediaUrl) return !properties.model_view && !properties.source_content_hash && !properties.media_type && !properties.reference_id;
  if (!mediaUrl.startsWith("/api/media/") || properties.media_type !== "image/png") return false;
  let key = ""; try { key = decodeURIComponent(mediaUrl.slice("/api/media/".length)); } catch { return false; }
  if (!mediaKeyMatchesOwnerNamespace(key, ownerId)) return false;
  const object = typeof env.MEDIA.head === "function" ? await env.MEDIA.head(key) : await env.MEDIA.get(key);
  const metadata = object?.customMetadata, view = normalizeModel3dView(properties.model_view);
  if (!object || !metadata || !view || metadata.ownerId !== ownerId || metadata.mimeType !== "image/png" || metadata.rights !== "asserted"
    || metadata.modelSourceKey !== original.key || metadata.modelSourceSha256 !== original.metadata.sha256
    || metadata.sha256 !== properties.source_content_hash || metadata.modelView !== JSON.stringify(view)) return false;
  const headers = new Headers(); object.writeHttpMetadata(headers);
  if (headers.get("content-type") !== "image/png") return false;
  if (projectAccessId) {
    if (metadata.projectAccessId && metadata.projectAccessId !== projectAccessId) return false;
    const scoped = await env.DB.prepare("SELECT 1 AS valid FROM project_resource_scopes WHERE project_access_id=? AND resource_kind='media' AND resource_id=? AND owner_user_id=?")
      .bind(projectAccessId, key, ownerId).first();
    if (!scoped) return false;
  }
  return true;
}




/** Read only generated, owner-bound MP4 video artifacts for separately approved audio synchronization. */
export async function readOwnedGeneratedVideoReference(env: WorkerEnv, ownerId: string, artifactId: string, mediaUrl: unknown) {
  const value = String(mediaUrl ?? "");
  const prefix = "/api/media/";
  if (!value.startsWith(prefix)) return null;
  let key = "";
  try { key = decodeURIComponent(value.slice(prefix.length)); } catch { return null; }
  if (!mediaKeyMatchesOwnerNamespace(key, ownerId)) return null;
  const object = await env.MEDIA.get(key);
  const metadata = object?.customMetadata;
  if (!object || !metadata || metadata.ownerId !== ownerId || metadata.artifactId !== artifactId || metadata.source !== "provider-generated-media") return null;
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  const mimeType = String(headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (mimeType !== "video/mp4" || typeof object.size === "number" && object.size > MAX_AUDIO_UPLOAD_BYTES) return null;
  const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > MAX_AUDIO_UPLOAD_BYTES) return null;
  return { key, bytes, mimeType, metadata, size: bytes.byteLength };
}


/** Controlled sources stay usable across closed, same-organization cohorts without losing exact project custody. */
export async function managedPilotSourceClassificationValid(env:WorkerEnv,ownerId:string,cohortId:string,blocks:Array<{type:string;properties:Record<string,unknown>}>,projectAccessId=""):Promise<boolean>{
  const references=blocks.flatMap((block)=>block.type==="model3d"?[
    {properties:{...block.properties,media_url:block.properties.model_url,source_content_hash:block.properties.model_content_hash}},
    ...(block.properties.media_url?[block]:[]),
  ]:(block.type==="reference"||block.type==="audio")&&String(block.properties.media_url??"").trim()?[block]:[]);
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
  const scoped=hasProjectContextCookie(request);
  const auth=await requireUser(request,env,scoped?"viewer":"creator",scoped?{account:"principal"}:{});if(auth.response||!auth.user)return auth.response!;const consent=requireConsent(auth.user);if(consent)return consent;
  const selected=scoped?await readProjectRequestContext(request,env,auth.user):{context:null,response:null};
  if(selected.response)return selected.response;
  if(selected.context&&!hasCapability(auth.user,"project.author",{organizationId:selected.context.organizationId,projectAccessId:selected.context.projectAccessId}))return new Response("Forbidden",{status:403});
  const form=await request.formData();const file=form.get("file");
  if(!(file instanceof File))return Response.json({error:"A supported image, MP4 video, audio recording, document, or GLB model is required"},{status:400});
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
  const modelMime=model3dMimeType(file);
  const mimeType=modelMime??canonicalSourceDocumentMime(file);
  const isAudio=Boolean(audioMimeType(mimeType));
  const isVideo=mimeType==="video/mp4";
  if((!SAFE_UPLOADED_IMAGE_TYPES.has(mimeType)&&!SAFE_UPLOADED_DOCUMENT_TYPES.has(mimeType)&&!isAudio&&!isVideo&&!modelMime)||file.size>(modelMime?MAX_MODEL3D_UPLOAD_BYTES:isAudio||isVideo?MAX_AUDIO_UPLOAD_BYTES:12*1024*1024))return Response.json({error:modelMime?"Choose a GLB model smaller than 64 MB.":isAudio?"Choose an MP3, WAV, M4A, AAC, OGG, FLAC, or WebM audio recording smaller than 25 MB.":"Choose an image or document under 12 MB, MP4 video or audio under 25 MB, or GLB model under 64 MB."},{status:400});
  const owner=selected.context?.ownerUserId??auth.user.userId;
  const key=`${ownerMediaNamespace(owner)}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,"-")}`;
  const bytes=await file.arrayBuffer();
  if(isVideo&&(bytes.byteLength<12||new TextDecoder().decode(new Uint8Array(bytes,4,4))!=="ftyp"))return Response.json({error:"Choose an MP4 video with a valid file container."},{status:400});
  if(modelMime){try{validateModel3dAsset(bytes,modelMime);}catch(error){return Response.json({error:error instanceof Error?error.message:"This file is not a valid GLB 2.0 model. Export it again as a self-contained GLB."},{status:400});}}
  const modelSourceFields=[form.get("modelUrl"),form.get("modelContentHash"),form.get("modelView")];
  let modelViewMetadata:Record<string,string>={};
  if(modelSourceFields.some((value)=>value!==null)){
    if(modelSourceFields.some((value)=>typeof value!=="string")||mimeType!=="image/png")return Response.json({error:"A model view must be a PNG captured from an owned GLB model."},{status:400});
    const viewSource=String(modelSourceFields[2]);let parsedView:unknown;
    if(viewSource.length>2_048)return Response.json({error:"Choose and save a valid model view."},{status:400});
    try{parsedView=JSON.parse(viewSource);}catch{return Response.json({error:"Choose and save a valid model view."},{status:400});}
    const view=normalizeModel3dView(parsedView),original=await readOwnedModel3dReference(env,owner,modelSourceFields[0],{metadataOnly:true,projectAccessId:selected.context?.projectAccessId});
    if(!view||!original||original.metadata.sha256!==modelSourceFields[1])return Response.json({error:"The original model is unavailable or changed. Reopen it and save a new view."},{status:400});
    const imageBytes=new Uint8Array(bytes),pngSignature=[137,80,78,71,13,10,26,10];
    if(imageBytes.byteLength<33||!pngSignature.every((byte,index)=>imageBytes[index]===byte)||new TextDecoder().decode(imageBytes.subarray(12,16))!=="IHDR")return Response.json({error:"The saved view must be a valid PNG image."},{status:400});
    const png=new DataView(bytes),width=png.getUint32(16),height=png.getUint32(20);
    if(width<64||height<64||width>2_048||height>2_048)return Response.json({error:"The saved view must be a PNG between 64 and 2,048 pixels per side."},{status:400});
    modelViewMetadata={modelSourceKey:original.key,modelSourceSha256:original.metadata.sha256!,modelView:JSON.stringify(view)};
  }
  const compositionSource=form.get("referenceComposition");let compositionMetadata:Record<string,string>={};
  if(compositionSource!==null){
    if(typeof compositionSource!=="string"||compositionSource.length>32_768||mimeType!=="image/png"||modelSourceFields.some((value)=>value!==null))return Response.json({error:"Save the composition as a PNG with its source recipe."},{status:400});
    let parsedRecipe:unknown;try{parsedRecipe=JSON.parse(compositionSource);}catch{return Response.json({error:"The composition recipe is invalid. Reopen the scene and save it again."},{status:400});}
    const recipe=normalizeReferenceComposition(parsedRecipe);
    if(!recipe||!await ownedCompositionSourcesValid(env,owner,recipe,selected.context?.projectAccessId??""))return Response.json({error:"A composition source changed or is no longer available. Reopen the scene and choose its sources again."},{status:400});
    const imageBytes=new Uint8Array(bytes),signature=[137,80,78,71,13,10,26,10];
    if(imageBytes.byteLength<33||!signature.every((value,index)=>imageBytes[index]===value)||new TextDecoder().decode(imageBytes.subarray(12,16))!=="IHDR"||new DataView(bytes).getUint32(16)!==recipe.width||new DataView(bytes).getUint32(20)!==recipe.height)return Response.json({error:"The saved PNG does not match the composition's dimensions. Save the scene again."},{status:400});
    compositionMetadata={referenceCompositionVersion:"1",referenceCompositionSha256:await sha256Hex(new TextEncoder().encode(JSON.stringify(recipe)))};
  }
  if((!file.type||file.type.toLowerCase()==="application/octet-stream")&&(
    mimeType==="application/pdf"&&!new TextDecoder().decode(new Uint8Array(bytes).subarray(0,5)).startsWith("%PDF-")
    ||mimeType.includes("officedocument")&&!(new Uint8Array(bytes)[0]===0x50&&new Uint8Array(bytes)[1]===0x4b)
  ))return Response.json({error:"The selected source does not match its advertised document format."},{status:400});
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  const contentHash=[...new Uint8Array(digest)].map((byte)=>byte.toString(16).padStart(2,"0")).join("");
  const extraction=isVideo?{status:"unavailable" as const,text:"",segments:[],sourceKind:"unsupported" as const,truncated:false,message:"Video retained as a reference. No frames or transcript extracted."}:SAFE_UPLOADED_DOCUMENT_TYPES.has(mimeType)?await extractSourceDocument(file):null;
  const evidence=extraction?sourceDocumentEvidence(extraction,contentHash,mimeType):null;
  const sourceEvidenceHash=evidence?await sourceDocumentEvidenceDigest(evidence):null;
  const timing=isAudio?verifiedAudioTiming(new Uint8Array(bytes),mimeType):null;
  await env.MEDIA.put(key,bytes,{httpMetadata:{contentType:mimeType},customMetadata:{originalName:file.name,ownerId:owner,uploadedBy:auth.user.userId,rights:"asserted",sha256:contentHash,mimeType,...(modelMime?{modelFormat:"glb"}:{}),...modelViewMetadata,...compositionMetadata,...(timing?{durationSeconds:String(timing.durationSeconds),sampleRate:String(timing.sampleRate)}:{}),...(sourceEvidenceHash?{sourceEvidenceSha256:sourceEvidenceHash}:{}),...(selected.context?{projectAccessId:selected.context.projectAccessId}:{}),...(managedPilot?{sourceClassification:managedPilot.source_classification,pilotCohortId:managedPilot.cohort_id}:{})}});
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
  return Response.json({key,url:`/api/media/${encodeURIComponent(key)}`,name:file.name,mimeType,contentHash,kind:modelMime?"model3d":isVideo?"video":isAudio?"audio":SAFE_UPLOADED_IMAGE_TYPES.has(mimeType)?"image":"document",rights:"asserted",size:file.size,...(timing?{durationSeconds:timing.durationSeconds}:{}),...(extraction&&sourceEvidenceHash?{extraction,sourceEvidenceHash}:{}),...(managedPilot?{sourceClassification:managedPilot.source_classification}:{})});
}
export async function getMedia(request:Request,key:string,env:WorkerEnv){
  if(isCreationIndexKey(key))return new Response('Not found',{status:404});
  const cover=new URL(request.url).searchParams.get(VIDEO_COVER_QUERY)==="webp";
  const scoped=hasProjectContextCookie(request);
  const auth=await requireUser(request,env,cover&&request.method==="POST"&&!scoped?"creator":"viewer",scoped?{account:"principal"}:{});if(auth.response||!auth.user)return auth.response!;
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
  if(!mediaKeyMatchesOwnerNamespace(key,owner)||!await memoryAuthoredImageMediaAllowed(env,owner,key))return new Response("Forbidden",{status:403});
  if(cover){
    const writable=resource?hasCapability(auth.user,"project.author",{organizationId:resource.organization_id,projectAccessId:resource.project_access_id}):(auth.user.role==="creator"||auth.user.role==="admin");
    if(request.method==="POST"){const consent=requireConsent(auth.user);if(consent)return consent;if(!writable)return new Response("Forbidden",{status:403});}
    const source=await env.MEDIA.head(key);
    if(!source||source.customMetadata?.ownerId!==owner)return new Response("Not found",{status:404});
    return handleVideoCover(request,env,key,source,owner,writable);
  }
  {
    try{
      const sponsored=await beginSponsorNativeImageRead(request,env,auth.user,{mediaKey:key,ownerUserId:owner});
      if(sponsored){
        const response=await readSponsorGeneratedImageMedia(request,env,auth.user,key,sponsored);
        applySafeMediaResponseHeaders(response.headers);return response;
      }
    }catch(error){
      const headers=new Headers();applySafeMediaResponseHeaders(headers);
      if(error instanceof SponsorReadLimitError){headers.set('retry-after',String(Math.max(1,Math.ceil(error.retryAfterMs/1000))));return new Response('Read limit reached',{status:429,headers});}
      return new Response('Unavailable',{status:409,headers});
    }
  }
  let object=await env.MEDIA.get(key);
  if(!object&&key.startsWith(ownerMediaNamespace(owner)+'/generated/memory-image-')){
    const retained=await env.DB.prepare("SELECT content_id FROM private_content WHERE owner_id=? AND kind='authored-memory-image' AND redacted_at IS NULL AND json_extract(content,'$.key')=? LIMIT 2").bind(owner,key).all<{content_id:string}>();
    if(retained.success&&retained.results.length===1)try{if(await projectMemoryAuthoredImage(env,retained.results[0]!.content_id))object=await env.MEDIA.get(key);}catch{/* Existing accepted copy remains recoverable, without a new purchase. */}
  }
  if(!object||!await memoryAuthoredImageMediaAllowed(env,owner,key))return new Response("Not found",{status:404});
  if(object.customMetadata?.ownerId!==owner)return new Response("Forbidden",{status:403});
  // Derivatives must always pass through the original video's access and existence checks.
  if(object.customMetadata?.source==="video-cover"){void object.body.cancel().catch(()=>undefined);return new Response("Forbidden",{status:403});}
  const headers=new Headers();object.writeHttpMetadata(headers);headers.set("etag",object.httpEtag);applySafeMediaResponseHeaders(headers);
  const mimeType=String(headers.get("content-type")??"").toLowerCase();
  if(!mimeType.startsWith("image/")&&!mimeType.startsWith("video/")&&!mimeType.startsWith("audio/")){
    const filename=String(object.customMetadata?.originalName??object.customMetadata?.fileName??key.split("/").at(-1)??"reference-document").replace(/[\r\n"\\]/g,"_");
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

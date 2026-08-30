import { foldEvents } from "../src/model/events";
import { parseDocumentArtifactContent } from "../src/model/document-artifacts";
import { presentationAudienceArtifact } from "../src/model/presentation-delivery";
import { documentShareScope, sanitizeSharedValue, shareAllowsCurrentAudio, shareAllowsMedia, shareVisibleBlocks, type DocumentShareScope } from "../src/model/share-scope";
import { requireConsent, requireUser } from "./pilot-policy";
import { applySafeMediaResponseHeaders } from "./media-api";
import { appendAuditEvent, ensureSchema, readWorkspaceEvents, streamHead, uuidV7, type WorkerEnv } from "./runtime";
import { hasProjectContextCookie, readProjectRequestContext, readProjectSourceEvents, recordOrganizationAudit } from "./project-access";
import { artifactReviewState, artifactSourceVersions } from "../src/model/context-health.ts";
import { governedPackageSourceRightsCurrent } from "./context-package-rights.ts";

const token = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};
const hashToken = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
const serializeShare = (row: Record<string, unknown>) => ({ shareId: String(row.share_id), resourceKind: String(row.resource_kind ?? ""), resourceId: String(row.resource_id ?? ""), projectId: String(row.project_id ?? ""), expiresAt: String(row.expires_at), revokedAt: row.revoked_at ? String(row.revoked_at) : null, createdAt: String(row.created_at), active: !row.revoked_at && String(row.expires_at) > new Date().toISOString() });
const activeShare=async(env:WorkerEnv,rawToken:string)=>env.DB.prepare(`SELECT shares.*,scope.resource_kind,scope.resource_id,scope.project_id,scope.media_keys_json,
  EXISTS(SELECT 1 FROM project_resource_scopes project_share WHERE project_share.resource_kind='share' AND project_share.resource_id=shares.share_id AND project_share.owner_user_id=shares.owner_id) AS governed_project,
  (SELECT project_share.organization_id FROM project_resource_scopes project_share WHERE project_share.resource_kind='share' AND project_share.resource_id=shares.share_id AND project_share.owner_user_id=shares.owner_id LIMIT 1) AS governed_organization_id,
  EXISTS(SELECT 1 FROM project_resource_scopes project_share JOIN pilot_cohorts cohort ON cohort.organization_id=project_share.organization_id
    WHERE project_share.resource_kind='share' AND project_share.resource_id=shares.share_id AND project_share.owner_user_id=shares.owner_id
      AND cohort.status IN ('active','paused','closed')) AS managed_pilot
  FROM shares JOIN share_scopes scope ON scope.share_id=shares.share_id AND scope.owner_id=shares.owner_id
  WHERE shares.token_hash=? AND shares.revoked_at IS NULL AND shares.expires_at>?
    AND((NOT EXISTS(SELECT 1 FROM project_resource_scopes tagged WHERE tagged.resource_kind='share' AND tagged.resource_id=shares.share_id)
        AND NOT EXISTS(SELECT 1 FROM organization_projects registered WHERE registered.owner_user_id=shares.owner_id AND registered.project_id=scope.project_id))
      OR EXISTS(SELECT 1 FROM project_resource_scopes tagged
        JOIN organization_projects project ON project.project_access_id=tagged.project_access_id AND project.organization_id=tagged.organization_id
          AND project.project_id=tagged.project_id AND project.owner_user_id=tagged.owner_user_id AND project.status='active'
        JOIN organizations organization ON organization.organization_id=project.organization_id AND organization.status='active'
        LEFT JOIN organization_security_policies security ON security.organization_id=project.organization_id
        JOIN organization_memberships member ON member.organization_id=project.organization_id AND member.user_id=project.owner_user_id
          AND member.status='active' AND member.accepted_at IS NOT NULL AND member.revoked_at IS NULL
        JOIN project_resource_scopes document ON document.project_access_id=tagged.project_access_id AND document.organization_id=tagged.organization_id
          AND document.project_id=tagged.project_id AND document.owner_user_id=tagged.owner_user_id AND document.resource_kind='document' AND document.resource_id=scope.resource_id
        WHERE tagged.resource_kind='share' AND tagged.resource_id=shares.share_id AND tagged.owner_user_id=shares.owner_id AND tagged.project_id=scope.project_id
          AND(security.organization_id IS NULL OR(security.authentication_source='any' AND security.require_mfa=0
            AND json_valid(security.allowed_domains_json) AND json_array_length(security.allowed_domains_json)=0))))`)
  .bind(await hashToken(rawToken),new Date().toISOString()).first<Record<string,unknown>>();
const rowScope=(row:Record<string,unknown>):DocumentShareScope|null=>{try{const keys=JSON.parse(String(row.media_keys_json??"[]")) as unknown;if(row.resource_kind!=="document"||!Array.isArray(keys)||keys.some((key)=>typeof key!=="string"))return null;return{resourceKind:"document",resourceId:String(row.resource_id??""),projectId:String(row.project_id??""),ownerId:String(row.owner_id??""),mediaKeys:keys as string[]};}catch{return null;}};

const publicReferenceProperties=new Set(["label","media_url","media_type","source_mime_type","source_kind","source_type","mime_type","mimeType","width","height","image_width","image_height","focal_point","attribution","credit","copyright","license_attribution"]);
const privateEvidenceProperty=/^(?:(?:source|private|raw|extracted)_)?(?:citations?|excerpts?|evidence|source_text|extracted_text|raw_text)$/i;

function audienceContextProperties(type:string,properties:Record<string,unknown>):Record<string,unknown>{
  const publicProperties=type==="reference"?Object.fromEntries(Object.entries(properties).filter(([key])=>publicReferenceProperties.has(key))):properties;
  const redact=(value:unknown):unknown=>Array.isArray(value)?value.map(redact):value&&typeof value==="object"?Object.fromEntries(Object.entries(value).filter(([key])=>!privateEvidenceProperty.test(key)).map(([key,item])=>[key,redact(item)])):value;
  return redact(publicProperties) as Record<string,unknown>;
}

function audienceContextRevision(artifactId:string,documentId:string,events:Parameters<typeof artifactSourceVersions>[1],groups:Map<string,string>){
  const completed=[...events].reverse().find((event)=>event.type==="DocumentRenderCompleted"&&String(event.payload.artifact_id??"")===artifactId&&String(event.payload.document_id??"")===documentId);
  const revision=typeof completed?.payload.context_revision==="string"?completed.payload.context_revision.trim():"";
  const fingerprint=typeof completed?.payload.context_fingerprint==="string"?completed.payload.context_fingerprint.trim():"";
  const versions=artifactSourceVersions(artifactId,events)?.map((version)=>({id:String(version.block_id??""),version:Number(version.version??-1)})).filter((version)=>version.id&&Number.isSafeInteger(version.version)&&version.version>=0).sort((left,right)=>left.id.localeCompare(right.id))??[];
  const key=revision||fingerprint||versions.length?JSON.stringify({documentId,revision,fingerprint,versions}):`artifact:${artifactId}`;
  const existing=groups.get(key);if(existing)return existing;
  const opaque=`revision-${groups.size+1}`;groups.set(key,opaque);return opaque;
}

export async function handleShares(request: Request, env: WorkerEnv, shareId = "") {
  const scoped=hasProjectContextCookie(request);
  const auth=await requireUser(request,env,scoped?"viewer":request.method==="GET"?"viewer":"creator",scoped?{account:"principal"}:{});
  if(auth.response||!auth.user)return auth.response!;
  const user=auth.user,selected=scoped?await readProjectRequestContext(request,env,user):{context:null,response:null};
  if(selected.response)return selected.response;
  const project=selected.context;
  if(project&&(project.ownerUserId!==user.userId||project.role!=="owner"))return Response.json({error:"project_share_owner_required"},{status:403,headers:{"cache-control":"private, no-store"}});
  const ownerStream=project?`creative:${project.ownerUserId}`:user.streamId;
  if (request.method === "GET") {
    const rows=await env.DB.prepare(`SELECT shares.*,scope.resource_kind,scope.resource_id,scope.project_id FROM shares JOIN share_scopes scope ON scope.share_id=shares.share_id AND scope.owner_id=shares.owner_id
      WHERE shares.owner_id=?${project?" AND scope.project_id=? AND EXISTS(SELECT 1 FROM project_resource_scopes document WHERE document.project_access_id=? AND document.organization_id=? AND document.owner_user_id=? AND document.resource_kind='document' AND document.resource_id=scope.resource_id)":""} ORDER BY shares.created_at DESC LIMIT 50`)
      .bind(user.userId,...(project?[project.projectId,project.projectAccessId,project.organizationId,project.ownerUserId]:[])).all<Record<string,unknown>>();
    return Response.json({shares:rows.results.map(serializeShare)},{headers:{"cache-control":"private, no-store"}});
  }
  const consent = requireConsent(user); if (consent) return consent;
  if (request.method === "POST") {
    const body = await request.json() as { expiresHours?: number; resourceKind?: string; documentId?: string; projectId?: string }; const expiresHours = Math.max(1, Math.min(168, Math.floor(Number(body.expiresHours ?? 24))));
    if(body.resourceKind!=="document"||!body.documentId?.trim()||!body.projectId?.trim())return Response.json({error:"share_resource_scope_required"},{status:400});
    if(project&&body.projectId!==project.projectId)return Response.json({error:"share_document_not_found"},{status:404});
    if(project){
      const restricted=await env.DB.prepare(`SELECT 1 AS present FROM organization_security_policies security
        WHERE security.organization_id=? AND(security.authentication_source!='any' OR security.require_mfa!=0
          OR NOT json_valid(security.allowed_domains_json)
          OR json_valid(security.allowed_domains_json) AND json_array_length(security.allowed_domains_json)>0)`)
        .bind(project.organizationId).first();
      if(restricted)return Response.json({error:"organization_identity_policy_disallows_public_sharing"},{status:403});
    }
    if(!project&&await env.DB.prepare("SELECT 1 AS present FROM organization_projects WHERE owner_user_id=? AND project_id=? LIMIT 1").bind(user.userId,body.projectId).first())return Response.json({error:"project_share_context_required"},{status:403,headers:{"cache-control":"private, no-store"}});
    const releaseHead=project?await streamHead(env,ownerStream):null;
    const source=project?await readProjectSourceEvents(env,project):await readWorkspaceEvents(env,ownerStream);
    const projection=foldEvents(source,Number.POSITIVE_INFINITY,body.documentId,body.projectId);const scope=documentShareScope(projection,user.userId,body.documentId,body.projectId);if(!scope)return Response.json({error:"share_document_not_found"},{status:404});
    if(project){
      if(!await governedPackageSourceRightsCurrent(env,project.organizationId,projection.blocks))return Response.json({error:"context_source_rights_expired"},{status:409});
      const managedPilot=await env.DB.prepare("SELECT 1 AS present FROM pilot_cohorts WHERE organization_id=? AND status IN ('active','paused','closed') LIMIT 1").bind(project.organizationId).first();
      if(projection.artifacts.some((artifact)=>!artifactSourceVersions(artifact.id,source)?Boolean(managedPilot):artifactReviewState(artifact,projection.blocks,source).status!=="approved")){
        return Response.json({error:"artifact_approval_required",message:"Independently approve every current governed output with verified source revisions before creating an external review link."},{status:409});
      }
    }
    const verifiedMedia=await Promise.all(scope.mediaKeys.map(async(key)=>({key,object:await env.MEDIA.get(key)})));
    scope.mediaKeys=verifiedMedia.filter(({object})=>object?.customMetadata?.ownerId===user.userId).map(({key})=>key);
    const shareToken = token(); const id = uuidV7(); const createdAt = new Date(); const expiresAt = new Date(createdAt.getTime() + expiresHours * 3_600_000);
    const hashed=await hashToken(shareToken),timestamp=createdAt.toISOString();
    const statements=project?[
      env.DB.prepare(`INSERT INTO shares(share_id,token_hash,owner_id,stream_id,expires_at,revoked_at,created_at)
        SELECT ?,?,?,?,?,NULL,? WHERE EXISTS(SELECT 1 FROM organization_projects project
          JOIN organizations organization ON organization.organization_id=project.organization_id AND organization.status='active'
          JOIN organization_memberships member ON member.organization_id=project.organization_id AND member.user_id=project.owner_user_id AND member.status='active' AND member.accepted_at IS NOT NULL AND member.revoked_at IS NULL
          JOIN project_resource_scopes document ON document.project_access_id=project.project_access_id AND document.organization_id=project.organization_id AND document.owner_user_id=project.owner_user_id AND document.resource_kind='document' AND document.resource_id=?
          WHERE project.project_access_id=? AND project.organization_id=? AND project.project_id=? AND project.owner_user_id=? AND project.status='active'
            AND NOT EXISTS(SELECT 1 FROM organization_security_policies security WHERE security.organization_id=project.organization_id
              AND(security.authentication_source!='any' OR security.require_mfa!=0 OR NOT json_valid(security.allowed_domains_json)
                OR json_valid(security.allowed_domains_json) AND json_array_length(security.allowed_domains_json)>0))
            AND (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?)`)
        .bind(id,hashed,user.userId,ownerStream,expiresAt.toISOString(),timestamp,scope.resourceId,project.projectAccessId,project.organizationId,project.projectId,user.userId,ownerStream,releaseHead),
      env.DB.prepare("INSERT INTO share_scopes(share_id,owner_id,resource_kind,resource_id,project_id,media_keys_json,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM shares WHERE share_id=? AND owner_id=?)")
        .bind(id,user.userId,scope.resourceKind,scope.resourceId,scope.projectId,JSON.stringify(scope.mediaKeys),timestamp,id,user.userId),
      env.DB.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at) SELECT ?,'share',?,?,?,?,'collaborative_output',NULL,?,? WHERE EXISTS(SELECT 1 FROM shares WHERE share_id=? AND owner_id=?)")
        .bind(project.projectAccessId,id,project.organizationId,project.projectId,user.userId,user.userId,timestamp,id,user.userId),
    ]:[env.DB.prepare("INSERT INTO shares(share_id,token_hash,owner_id,stream_id,expires_at,revoked_at,created_at) SELECT ?,?,?,?,?,NULL,? WHERE NOT EXISTS(SELECT 1 FROM organization_projects WHERE owner_user_id=? AND project_id=?)").bind(id,hashed,user.userId,ownerStream,expiresAt.toISOString(),timestamp,user.userId,scope.projectId),env.DB.prepare("INSERT INTO share_scopes(share_id,owner_id,resource_kind,resource_id,project_id,media_keys_json,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM shares WHERE share_id=? AND owner_id=?)").bind(id,user.userId,scope.resourceKind,scope.resourceId,scope.projectId,JSON.stringify(scope.mediaKeys),timestamp,id,user.userId)];
    const inserted=await env.DB.batch(statements);if(inserted.some((result)=>Number(result.meta.changes??0)!==1))return Response.json({error:"project_share_access_revoked"},{status:403});
    await appendAuditEvent(env,ownerStream,project?`user:${user.userId}`:"user","ShareLinkCreated",{share_id:id,resource_kind:scope.resourceKind,document_id:scope.resourceId,project_id:scope.projectId,media_count:scope.mediaKeys.length,expires_at:expiresAt.toISOString(),access:"read-only"});
    if(project)await recordOrganizationAudit(env,project.organizationId,user,"project.share.created","share",id,{projectId:project.projectId,documentId:scope.resourceId});
    return Response.json({ share: { shareId: id, token: shareToken, resourceKind: scope.resourceKind, resourceId: scope.resourceId, projectId: scope.projectId, expiresAt: expiresAt.toISOString(), active: true } });
  }
  if (request.method === "DELETE" && shareId) {
    const now=new Date().toISOString();const result=await env.DB.prepare(`UPDATE shares SET revoked_at=? WHERE share_id=? AND owner_id=? AND revoked_at IS NULL${project?" AND EXISTS(SELECT 1 FROM share_scopes scope WHERE scope.share_id=shares.share_id AND scope.owner_id=shares.owner_id AND scope.project_id=?)":""}`)
      .bind(now,shareId,user.userId,...(project?[project.projectId]:[])).run();
    if (Number(result.meta.changes ?? 0) !== 1) return Response.json({ error: "share_not_found_or_revoked" }, { status: 404 });
    await appendAuditEvent(env,ownerStream,project?`user:${user.userId}`:"user","ShareLinkRevoked",{share_id:shareId,revoked_at:now});
    if(project)await recordOrganizationAudit(env,project.organizationId,user,"project.share.revoked","share",shareId,{projectId:project.projectId});
    return Response.json({ok:true});
  }
  return new Response("Method not allowed", { status: 405 });
}

export async function handleSharedView(request: Request, env: WorkerEnv, rawToken: string) {
  await ensureSchema(env); if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
  const row = await activeShare(env,rawToken);
  if (!row) return Response.json({ error: "share_expired_or_revoked" }, { status: 404 });
  const scope=rowScope(row);if(!scope)return Response.json({error:"share_expired_or_revoked"},{status:404});
  const events = await readWorkspaceEvents(env, String(row.stream_id)); const projection = foldEvents(events,Number.POSITIVE_INFINITY,scope.resourceId,scope.projectId);const currentScope=documentShareScope(projection,scope.ownerId,scope.resourceId,scope.projectId);if(!currentScope)return Response.json({error:"shared_document_unavailable"},{status:404});const effectiveScope={...scope,mediaKeys:scope.mediaKeys.filter((key)=>currentScope.mediaKeys.includes(key))};
  if(Number(row.governed_project??0)&&!await governedPackageSourceRightsCurrent(env,String(row.governed_organization_id??""),projection.blocks))return Response.json({error:"shared_output_approval_expired"},{status:404});
  if(Number(row.governed_project??0)&&projection.artifacts.some((artifact)=>!artifactSourceVersions(artifact.id,events)?Boolean(Number(row.managed_pilot??0)):artifactReviewState(artifact,projection.blocks,events).status!=="approved"))return Response.json({error:"shared_output_approval_expired"},{status:404});
  const contentIds=[...new Set(projection.artifacts.map((artifact)=>artifact.contentRef).filter((value):value is string=>Boolean(value)))];const contentStatements=[];const now=new Date().toISOString();for(let index=0;index<contentIds.length;index+=98){const ids=contentIds.slice(index,index+98);contentStatements.push(env.DB.prepare(`SELECT content_id,content FROM private_content WHERE owner_id=? AND kind='document-artifact' AND redacted_at IS NULL AND expires_at>? AND content_id IN (${ids.map(()=>"?").join(",")})`).bind(scope.ownerId,now,...ids));}const retainedContent=new Map(contentStatements.length?(await env.DB.batch<{content_id:string;content:string}>(contentStatements)).flatMap((result)=>result.results).map((result)=>[result.content_id,parseDocumentArtifactContent(result.content)]):[]);
  const blocks=shareVisibleBlocks(projection).map(({id,type,handle,properties})=>{const audio=type==="audio"||[properties.source_mime_type,properties.media_type].some((value)=>String(value??"").toLowerCase().startsWith("audio/"));const visible=audio&&properties.inform_generation!==true?Object.fromEntries(Object.entries(properties).filter(([key])=>["label","media_url","media_type","source_mime_type","duration_seconds","audio_role","include_in_output"].includes(key))):audienceContextProperties(type,properties);return{id,type,handle,properties:sanitizeSharedValue(visible,effectiveScope,rawToken)};});
  const outputs=projection.outputs.map(({ id, sequence, mediaUrl, mediaType, width, height, focalPoint, purpose, promptFanId, promptTechnique })=>({id,sequence,mediaUrl:sanitizeSharedValue(mediaUrl,effectiveScope,rawToken,true),mediaType,width,height,focalPoint,purpose,promptFanId,promptTechnique}));
  const contextRevisions=new Map<string,string>();
  const artifacts=projection.artifacts.map(({id,kind,title,summary,itemCount,items,mediaUrl,mediaType,sequence,presentation,contentRef,settings})=>{
    const content=contentRef?retainedContent.get(contentRef):null;
    const authored=items.map((item,index)=>{const draft=content?.items[index];return{title:draft?.title??item.title,body:draft?.body??item.body,notes:draft?.notes??item.notes,mediaUrl:sanitizeSharedValue(item.mediaUrl,effectiveScope,rawToken,true),mediaType:item.mediaType,durationSeconds:item.durationSeconds??null,width:item.width,height:item.height,focalPoint:item.focalPoint,slide:draft?.slide??item.slide};});
    const delivered=kind==="slides"?presentationAudienceArtifact({items:authored}).items.map((item)=>({...Object.fromEntries(Object.entries(item).filter(([key])=>key!=="notes")),slide:sanitizeSharedValue(item.slide,effectiveScope,rawToken)})):authored.map((item)=>({...item,slide:sanitizeSharedValue(item.slide,effectiveScope,rawToken)}));
    const soundtracks=Array.isArray(settings.soundtrack_assets)?settings.soundtrack_assets.flatMap((entry)=>{if(!entry||typeof entry!=="object")return[];const asset=entry as Record<string,unknown>;if(asset.provider_audio_transmitted===true||asset.inclusion==="provider-soundtrack-reference")return[];const source=projection.blocks.find((block)=>block.id===String(asset.block_id??"")&&block.properties.include_in_output===true);if(!source)return[];const sharedUrl=sanitizeSharedValue(asset.media_url,effectiveScope,rawToken,true);return typeof sharedUrl==="string"?[{label:String(asset.label??""),media_url:sharedUrl,media_type:String(asset.media_type??""),duration_seconds:typeof asset.duration_seconds==="number"?asset.duration_seconds:null,inclusion:"separate-playback-companion",...(source.properties.inform_generation===true&&typeof asset.transcript==="string"?{transcript:asset.transcript}:{}),cues:source.properties.inform_generation===true?sanitizeSharedValue(Array.isArray(asset.cues)?asset.cues:[],effectiveScope,rawToken):[]}]:[];}):[];
    const includedTranscripts=Array.isArray(settings.soundtrack_assets)&&typeof sanitizeSharedValue(mediaUrl,effectiveScope,rawToken,true)==="string"?settings.soundtrack_assets.flatMap((entry)=>{if(!entry||typeof entry!=="object")return[];const asset=entry as Record<string,unknown>;if(asset.provider_audio_transmitted!==true||typeof asset.transcript!=="string"||!asset.transcript.trim())return[];const source=projection.blocks.find((block)=>block.id===String(asset.block_id??"")&&block.properties.include_in_output===true&&block.properties.inform_generation===true);return source?[{label:String(asset.label??""),transcript:asset.transcript,provider_audio_transmitted:true}]:[];}):[];
    const audioSettings={...(kind==="audio"&&typeof settings.lyrics==="string"?{lyrics:settings.lyrics}:{}),...(kind==="audio"&&Array.isArray(settings.audio_cues)?{audio_cues:sanitizeSharedValue(settings.audio_cues,effectiveScope,rawToken)}:{}),...(settings.audio_synthid_watermarked===true?{audio_synthid_watermarked:true}:{}),...(soundtracks.length?{soundtrack_assets:soundtracks}:{}),...(includedTranscripts.length?{soundtrack_transcripts:includedTranscripts}:{})};
    return{id,kind,title,summary,itemCount,items:delivered,mediaUrl:sanitizeSharedValue(mediaUrl,effectiveScope,rawToken,true),mediaType,sequence,presentation:sanitizeSharedValue(content?.presentation??presentation,effectiveScope,rawToken),contentMarkdown:kind==="slides"?null:content?.content_markdown??null,contentAvailable:Boolean(content),contextRevision:audienceContextRevision(id,scope.resourceId,events,contextRevisions),...(Object.keys(audioSettings).length?{settings:audioSettings}:{})};
  });
  return Response.json({share:{expiresAt:String(row.expires_at)},projection:{projectName:projection.projectName,documentTitle:projection.documentTitle,blocks,outputs,artifacts}},{headers:{"cache-control":"private, no-store"}});
}

export async function handleSharedMedia(request:Request,env:WorkerEnv,rawToken:string,key:string){
  await ensureSchema(env);if(request.method!=="GET")return new Response("Method not allowed",{status:405});const row=await activeShare(env,rawToken);if(!row)return new Response("Not found",{status:404});
  const scope=rowScope(row);if(!scope||!shareAllowsMedia(scope,key))return new Response("Forbidden",{status:403});
  if(Number(row.governed_project??0)){const events=await readWorkspaceEvents(env,String(row.stream_id));const projection=foldEvents(events,Number.POSITIVE_INFINITY,scope.resourceId,scope.projectId);if(!await governedPackageSourceRightsCurrent(env,String(row.governed_organization_id??""),projection.blocks)||projection.artifacts.some((artifact)=>!artifactSourceVersions(artifact.id,events)?Boolean(Number(row.managed_pilot??0)):artifactReviewState(artifact,projection.blocks,events).status!=="approved"))return new Response("Not found",{status:404});}
  const object=await env.MEDIA.get(key);if(!object)return new Response("Not found",{status:404});if(object.customMetadata?.ownerId!==scope.ownerId)return new Response("Forbidden",{status:403});const headers=new Headers();object.writeHttpMetadata(headers);headers.set("etag",object.httpEtag);applySafeMediaResponseHeaders(headers);
  const mimeType=String(headers.get("content-type")??"").toLowerCase();
  if(mimeType.startsWith("audio/")||mimeType.startsWith("video/")){const events=await readWorkspaceEvents(env,String(row.stream_id));const projection=foldEvents(events,Number.POSITIVE_INFINITY,scope.resourceId,scope.projectId);const current=documentShareScope(projection,scope.ownerId,scope.resourceId,scope.projectId);if(!current||!shareAllowsMedia(current,key)||mimeType.startsWith("audio/")&&!shareAllowsCurrentAudio(projection,scope.ownerId,key))return new Response("Forbidden",{status:403});}
  if((mimeType.startsWith("audio/")||mimeType.startsWith("video/"))&&typeof object.size==="number"&&Number.isSafeInteger(object.size)&&object.size>=0){headers.set("accept-ranges","bytes");const range=request.headers.get("range");if(range){const match=range.match(/^bytes=(\d*)-(\d*)$/i);let offset=0,length=0;if(match&&(match[1]||match[2])){if(match[1]){offset=Number(match[1]);const end=match[2]?Math.min(object.size-1,Number(match[2])):object.size-1;length=end-offset+1;}else{length=Math.min(object.size,Number(match[2]));offset=object.size-length;}}if(!match||!Number.isSafeInteger(offset)||!Number.isSafeInteger(length)||offset<0||length<=0||offset>=object.size){headers.set("content-range",`bytes */${object.size}`);return new Response(null,{status:416,headers});}const partial=await env.MEDIA.get(key,{range:{offset,length}});if(!partial||partial.customMetadata?.ownerId!==scope.ownerId)return new Response("Not found",{status:404});headers.set("content-range",`bytes ${offset}-${offset+length-1}/${object.size}`);headers.set("content-length",String(length));return new Response(partial.body,{status:206,headers});}}
  return new Response(object.body,{headers});
}

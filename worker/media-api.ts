import { hasCapability, requireConsent, requireUser } from "./pilot-policy.ts";
import { readProjectRequestContext, synchronizeProjectScope } from "./project-access.ts";
import type { WorkerEnv } from "./runtime.ts";

const ownerPrefix = (ownerId:string) => ownerId.replace(/[^a-zA-Z0-9._-]/g,"-");
const SAFE_UPLOADED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"]);

export function applySafeMediaResponseHeaders(headers: Headers) {
  headers.set("content-security-policy", "default-src 'none'; sandbox");
  headers.set("x-content-type-options", "nosniff");
  headers.set("cache-control", "private, no-store");
}

export async function storeGeneratedMedia(env:WorkerEnv,ownerId:string,artifactId:string,bytes:Uint8Array,model:string,mimeType:string,metadata:Record<string,string>={}) {
  const extension=mimeType==="video/mp4"?"mp4":mimeType==="image/jpeg"?"jpg":mimeType==="image/webp"?"webp":mimeType==="application/pdf"?"pdf":"png";
  const key=`${ownerPrefix(ownerId)}/generated/${artifactId}.${extension}`;
  await env.MEDIA.put(key,bytes.buffer as ArrayBuffer,{httpMetadata:{contentType:mimeType},customMetadata:{ownerId,artifactId,model,source:"provider-generated-media",...metadata}});
  return{key,url:`/api/media/${encodeURIComponent(key)}`,mimeType};
}

export async function storeGeneratedImage(env:WorkerEnv,ownerId:string,generationId:string,bytes:Uint8Array,model:string,mimeType="image/png",metadata:Record<string,string>={}) {
  return storeGeneratedMedia(env,ownerId,generationId,bytes,model,mimeType,{generationId,source:"provider-image-api",...metadata});
}

export async function readGeneratedImageReference(env:WorkerEnv,ownerId:string,mediaUrl:unknown) {
  const value=String(mediaUrl??"");const prefix="/api/media/";if(!value.startsWith(prefix))return null;
  let key="";try{key=decodeURIComponent(value.slice(prefix.length));}catch{return null;}
  if(!key.startsWith(`${ownerPrefix(ownerId)}/`))return null;
  const object=await env.MEDIA.get(key);if(!object||object.customMetadata?.ownerId!==ownerId)return null;
  const headers=new Headers();object.writeHttpMetadata(headers);const mimeType=headers.get("content-type")??"image/png";if(!mimeType.startsWith("image/"))return null;
  const metadata=object.customMetadata??{};const providerMediaUrl=String(metadata.providerMediaUrl??"").trim();
  return{bytes:new Uint8Array(await new Response(object.body).arrayBuffer()),mimeType,provider:String(metadata.provider??"")||null,providerModel:String(metadata.providerModel??metadata.model??"")||null,providerRequestId:String(metadata.providerRequestId??"")||null,providerMediaUrl:providerMediaUrl||null};
}

export async function uploadMedia(request: Request, env: WorkerEnv) {
  const scoped=/(?:^|;\s*)forma_project_context=/.test(request.headers.get("cookie")??"");
  const auth=await requireUser(request,env,scoped?"viewer":"creator",scoped?{account:"principal"}:{});if(auth.response||!auth.user)return auth.response!;const consent=requireConsent(auth.user);if(consent)return consent;
  const selected=scoped?await readProjectRequestContext(request,env,auth.user):{context:null,response:null};
  if(selected.response)return selected.response;
  if(selected.context&&!hasCapability(auth.user,"project.author",{organizationId:selected.context.organizationId,projectAccessId:selected.context.projectAccessId}))return new Response("Forbidden",{status:403});
  const form=await request.formData();const file=form.get("file");
  if(!(file instanceof File))return Response.json({error:"An image file is required"},{status:400});
  if(form.get("rightsConfirmed")!=="true")return Response.json({error:"external_asset_rights_confirmation_required"},{status:428});
  if(!SAFE_UPLOADED_IMAGE_TYPES.has(file.type.toLowerCase())||file.size>12*1024*1024)return Response.json({error:"Choose a PNG, JPEG, WebP, GIF, or AVIF image smaller than 12 MB"},{status:400});
  const owner=selected.context?.ownerUserId??auth.user.userId;
  const key=`${ownerPrefix(owner)}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,"-")}`;
  await env.MEDIA.put(key,file.stream(),{httpMetadata:{contentType:file.type},customMetadata:{originalName:file.name,ownerId:owner,uploadedBy:auth.user.userId,rights:"asserted"}});
  if(selected.context){
    try{
      const inserted=await env.DB.prepare(`INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at)
        SELECT ?,'media',?,?,?,?, 'collaborative_output',NULL,?,? WHERE EXISTS(
          SELECT 1 FROM organization_projects project JOIN organizations organization ON organization.organization_id=project.organization_id AND organization.status='active'
          JOIN organization_memberships member ON member.organization_id=project.organization_id AND member.user_id=? AND member.status='active' AND member.accepted_at IS NOT NULL AND member.revoked_at IS NULL
          JOIN organization_memberships owner_member ON owner_member.organization_id=project.organization_id AND owner_member.user_id=project.owner_user_id AND owner_member.status='active' AND owner_member.accepted_at IS NOT NULL AND owner_member.revoked_at IS NULL
          LEFT JOIN project_memberships project_member ON project_member.project_access_id=project.project_access_id AND project_member.organization_id=project.organization_id AND project_member.project_id=project.project_id AND project_member.user_id=? AND project_member.status='active' AND project_member.revoked_at IS NULL
          WHERE project.project_access_id=? AND project.organization_id=? AND project.status='active' AND (project.owner_user_id=? OR project_member.role='editor'))`)
        .bind(selected.context.projectAccessId,key,selected.context.organizationId,selected.context.projectId,owner,auth.user.userId,new Date().toISOString(),auth.user.userId,auth.user.userId,selected.context.projectAccessId,selected.context.organizationId,auth.user.userId).run();
      if(Number(inserted.meta.changes??0)!==1)throw new Error("project_access_revoked");
    }catch{await env.MEDIA.delete(key).catch(()=>undefined);return new Response("Forbidden",{status:403});}
  }
  return Response.json({key,url:`/api/media/${encodeURIComponent(key)}`,name:file.name,rights:"asserted"});
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
  if(!key.startsWith(`${ownerPrefix(owner)}/`))return new Response("Forbidden",{status:403});
  const object=await env.MEDIA.get(key);if(!object)return new Response("Not found",{status:404});
  if(object.customMetadata?.ownerId!==owner)return new Response("Forbidden",{status:403});
  const headers=new Headers();object.writeHttpMetadata(headers);headers.set("etag",object.httpEtag);applySafeMediaResponseHeaders(headers);return new Response(object.body,{headers});
}

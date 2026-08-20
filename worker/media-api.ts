import { requireConsent, requireUser } from "./pilot-policy";
import type { WorkerEnv } from "./runtime";

const ownerPrefix = (ownerId:string) => ownerId.replace(/[^a-zA-Z0-9._-]/g,"-");

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
  const object=await env.MEDIA.get(key);if(!object)return null;
  const headers=new Headers();object.writeHttpMetadata(headers);const mimeType=headers.get("content-type")??"image/png";if(!mimeType.startsWith("image/"))return null;
  return{bytes:new Uint8Array(await new Response(object.body).arrayBuffer()),mimeType};
}

export async function uploadMedia(request: Request, env: WorkerEnv) {
  const auth=await requireUser(request,env,"creator");if(auth.response||!auth.user)return auth.response!;const consent=requireConsent(auth.user);if(consent)return consent;
  const form=await request.formData();const file=form.get("file");
  if(!(file instanceof File))return Response.json({error:"An image file is required"},{status:400});
  if(form.get("rightsConfirmed")!=="true")return Response.json({error:"external_asset_rights_confirmation_required"},{status:428});
  if(!file.type.startsWith("image/")||file.size>12*1024*1024)return Response.json({error:"Choose an image smaller than 12 MB"},{status:400});
  const key=`${ownerPrefix(auth.user.userId)}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,"-")}`;await env.MEDIA.put(key,file.stream(),{httpMetadata:{contentType:file.type},customMetadata:{originalName:file.name,ownerId:auth.user.userId,rights:"asserted"}});return Response.json({key,url:`/api/media/${encodeURIComponent(key)}`,name:file.name,rights:"asserted"});
}
export async function getMedia(request:Request,key:string,env:WorkerEnv){const auth=await requireUser(request,env);if(auth.response||!auth.user)return auth.response!;const prefix=`${ownerPrefix(auth.user.userId)}/`;if(!key.startsWith(prefix)&&auth.user.role!=="admin")return new Response("Forbidden",{status:403});const object=await env.MEDIA.get(key);if(!object)return new Response("Not found",{status:404});const headers=new Headers();object.writeHttpMetadata(headers);headers.set("etag",object.httpEtag);headers.set("cache-control","private, max-age=86400");return new Response(object.body,{headers});}

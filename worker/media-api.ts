import { requireConsent, requireUser } from "./pilot-policy";
import type { WorkerEnv } from "./runtime";

export async function uploadMedia(request: Request, env: WorkerEnv) {
  const auth=await requireUser(request,env,"creator");if(auth.response||!auth.user)return auth.response!;const consent=requireConsent(auth.user);if(consent)return consent;
  const form=await request.formData();const file=form.get("file");
  if(!(file instanceof File))return Response.json({error:"An image file is required"},{status:400});
  if(form.get("rightsConfirmed")!=="true")return Response.json({error:"external_asset_rights_confirmation_required"},{status:428});
  if(!file.type.startsWith("image/")||file.size>12*1024*1024)return Response.json({error:"Choose an image smaller than 12 MB"},{status:400});
  const key=`${auth.user.userId.replace(/[^a-zA-Z0-9._-]/g,"-")}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,"-")}`;await env.MEDIA.put(key,file.stream(),{httpMetadata:{contentType:file.type},customMetadata:{originalName:file.name,ownerId:auth.user.userId,rights:"asserted"}});return Response.json({key,url:`/api/media/${encodeURIComponent(key)}`,name:file.name,rights:"asserted"});
}
export async function getMedia(request:Request,key:string,env:WorkerEnv){const auth=await requireUser(request,env);if(auth.response||!auth.user)return auth.response!;const ownerPrefix=`${auth.user.userId.replace(/[^a-zA-Z0-9._-]/g,"-")}/`;if(!key.startsWith(ownerPrefix)&&auth.user.role!=="admin")return new Response("Forbidden",{status:403});const object=await env.MEDIA.get(key);if(!object)return new Response("Not found",{status:404});const headers=new Headers();object.writeHttpMetadata(headers);headers.set("etag",object.httpEtag);headers.set("cache-control","private, max-age=86400");return new Response(object.body,{headers});}

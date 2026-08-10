import type { WorkerEnv } from "./events-api";

export async function uploadMedia(request: Request, env: WorkerEnv) {
  const form=await request.formData();const file=form.get("file");
  if(!(file instanceof File))return Response.json({error:"An image file is required"},{status:400});
  if(!file.type.startsWith("image/")||file.size>12*1024*1024)return Response.json({error:"Choose an image smaller than 12 MB"},{status:400});
  const key=`${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,"-")}`;await env.MEDIA.put(key,file.stream(),{httpMetadata:{contentType:file.type},customMetadata:{originalName:file.name}});return Response.json({key,url:`/api/media/${encodeURIComponent(key)}`,name:file.name});
}
export async function getMedia(key:string,env:WorkerEnv){const object=await env.MEDIA.get(key);if(!object)return new Response("Not found",{status:404});const headers=new Headers();object.writeHttpMetadata(headers);headers.set("etag",object.httpEtag);headers.set("cache-control","private, max-age=86400");return new Response(object.body,{headers});}

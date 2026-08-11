import { handleEvents, type WorkerEnv } from "./events-api";
import { getMedia, uploadMedia } from "./media-api";
import { handleAdminUsers, handleSession } from "./pilot-policy";
import { handleShares, handleSharedView } from "./shares-api";
import { documentEntryPath } from "../src/model/routes";

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url=new URL(request.url);
    if(url.pathname==="/api/session")return handleSession(request,env);
    if(url.pathname==="/api/admin/users")return handleAdminUsers(request,env);
    if(url.pathname==="/api/events")return handleEvents(request,env);
    if(url.pathname==="/api/events/hot")return handleEvents(request,env,true);
    if(url.pathname==="/api/shares")return handleShares(request,env);
    if(url.pathname.startsWith("/api/shares/")&&request.method==="DELETE")return handleShares(request,env,decodeURIComponent(url.pathname.slice("/api/shares/".length)));
    if(url.pathname.startsWith("/api/shared/")&&request.method==="GET")return handleSharedView(request,env,decodeURIComponent(url.pathname.slice("/api/shared/".length)));
    if(url.pathname==="/api/media"&&request.method==="POST")return uploadMedia(request,env);
    if(url.pathname.startsWith("/api/media/")&&request.method==="GET")return getMedia(request,decodeURIComponent(url.pathname.slice("/api/media/".length)),env);
    if(url.pathname.startsWith("/api/"))return Response.json({error:"not_found"},{status:404});
    const asset=await env.ASSETS.fetch(request);if(asset.status!==404)return asset;
    if((request.method==="GET"||request.method==="HEAD")&&!url.pathname.startsWith("/assets/")){
      const entryPath=url.pathname.startsWith("/share/")?"/share/index.html":documentEntryPath(url.pathname);
      const entryUrl=new URL(entryPath,url);return env.ASSETS.fetch(new Request(entryUrl,request));
    }
    return asset;
  },
};

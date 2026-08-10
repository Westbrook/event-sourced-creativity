import { handleEvents, type WorkerEnv } from "./events-api";
import { getMedia, uploadMedia } from "./media-api";

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url=new URL(request.url);
    if(url.pathname==="/api/events")return handleEvents(request,env);
    if(url.pathname==="/api/events/hot")return handleEvents(request,env,true);
    if(url.pathname==="/api/media"&&request.method==="POST")return uploadMedia(request,env);
    if(url.pathname.startsWith("/api/media/")&&request.method==="GET")return getMedia(decodeURIComponent(url.pathname.slice("/api/media/".length)),env);
    if(url.pathname.startsWith("/api/"))return Response.json({error:"not_found"},{status:404});
    return env.ASSETS.fetch(request);
  },
};

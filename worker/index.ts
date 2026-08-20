import { handleEvents, type WorkerEnv } from "./events-api";
import { getMedia, uploadMedia } from "./media-api";
import { handleAdminUsers, handleImpersonation, handleSession } from "./pilot-policy";
import { handleShares, handleSharedMedia, handleSharedView } from "./shares-api";
import { resolveServerRoute } from "../src/platform/applications";
import { handleReplayApproval, handleReplayEstimate, handleReplaySessions } from "./replay-sessions-api";
import { handleDocumentJobs } from "./document-jobs-api";
import type { WorkerExecutionContext } from "./runtime";
import { handleAnalytics } from "./analytics-api";
import { handleGenerationReadiness } from "./generation-readiness";
import { handleCanvasGovernance } from "./canvas-governance-api";
import { handleImageAdapters } from "./image-adapters-api";

export default {
  async fetch(request: Request, env: WorkerEnv, context: WorkerExecutionContext): Promise<Response> {
    const url=new URL(request.url);
    if(url.pathname==="/api/session")return handleSession(request,env);
    if(url.pathname==="/api/impersonation")return handleImpersonation(request,env);
    if(url.pathname==="/api/admin/users")return handleAdminUsers(request,env);
    if(url.pathname==="/api/analytics")return handleAnalytics(request,env);
    if(url.pathname==="/api/generation-readiness")return handleGenerationReadiness(request,env);
    if(url.pathname==="/api/canvas-governance")return handleCanvasGovernance(request,env);
    if(url.pathname==="/api/image-adapters")return handleImageAdapters(request,env);
    if(url.pathname.startsWith("/api/generation-readiness/"))return handleGenerationReadiness(request,env,url.pathname.slice("/api/generation-readiness/".length));
    if(url.pathname==="/api/replay-sessions/approval")return handleReplayApproval(request,env);
    if(url.pathname==="/api/replay-sessions/estimate")return handleReplayEstimate(request,env);
    if(url.pathname==="/api/replay-sessions")return handleReplaySessions(request,env);
    if(url.pathname.startsWith("/api/replay-sessions/"))return handleReplaySessions(request,env,decodeURIComponent(url.pathname.slice("/api/replay-sessions/".length)));
    if(url.pathname==="/api/document-jobs")return handleDocumentJobs(request,env,"",context);
    if(url.pathname.startsWith("/api/document-jobs/"))return handleDocumentJobs(request,env,url.pathname.slice("/api/document-jobs/".length),context);
    if(url.pathname==="/api/events")return handleEvents(request,env);
    if(url.pathname==="/api/events/hot")return handleEvents(request,env,true);
    if(url.pathname==="/api/shares")return handleShares(request,env);
    if(url.pathname.startsWith("/api/shares/")&&request.method==="DELETE")return handleShares(request,env,decodeURIComponent(url.pathname.slice("/api/shares/".length)));
    if(url.pathname.startsWith("/api/shared/")&&request.method==="GET"){const rest=url.pathname.slice("/api/shared/".length);const marker=rest.indexOf("/media/");if(marker>=0)return handleSharedMedia(request,env,decodeURIComponent(rest.slice(0,marker)),decodeURIComponent(rest.slice(marker+"/media/".length)));return handleSharedView(request,env,decodeURIComponent(rest));}
    if(url.pathname==="/api/media"&&request.method==="POST")return uploadMedia(request,env);
    if(url.pathname.startsWith("/api/media/")&&request.method==="GET")return getMedia(request,decodeURIComponent(url.pathname.slice("/api/media/".length)),env);
    if(url.pathname.startsWith("/api/"))return Response.json({error:"not_found"},{status:404});
    if(request.method==="GET"||request.method==="HEAD"){
      const route=resolveServerRoute(url.pathname);
      if(route){
        const entryUrl=new URL(route.entryPath,url);
        const response=await env.ASSETS.fetch(new Request(entryUrl,request));
        const headers=new Headers(response.headers);
        headers.set("x-forma-route-family",route.canonicalFamily);
        headers.set("x-forma-application",route.application);
        return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
      }
    }
    // Vite's development runtime has extensionless module endpoints. They are
    // assets, not navigations, and must reach the asset binding or the HTML
    // shell will never hydrate after a deep-link refresh.
    const developmentAssetRequest=/^\/(?:@vite\/|@id\/|@fs\/|__vite_ping$|__open-in-editor)/.test(url.pathname);
    const assetRequest=developmentAssetRequest||/^\/(?:assets\/|og\.png$|favicon\.|robots\.txt$)|\.[a-z0-9]{2,8}$/i.test(url.pathname);
    if(assetRequest)return env.ASSETS.fetch(request);
    if(request.method!=="GET"&&request.method!=="HEAD")return new Response("Method not allowed",{status:405});
    return new Response("Page not found",{status:404,headers:{"content-type":"text/plain; charset=utf-8"}});
  },
};

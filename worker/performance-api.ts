import { hasCapability, requireConsent, requireUser } from "./pilot-policy.ts";
import { uuidV7, type WorkerEnv } from "./runtime.ts";
import type { FormaCapability } from "../src/platform/capabilities.ts";

type PerformanceRoute={audience:"creative"|"canvas"|"product"|"operations"|"engineering";surfaces:readonly string[];capabilities?:readonly FormaCapability[]};

const routes:Record<string,PerformanceRoute>={
  "projects":{audience:"creative",surfaces:["projects"]},
  "creative-workspace":{audience:"creative",surfaces:["creative-workspace"]},
  "document":{audience:"creative",surfaces:["document-workspace","document-document","document-board","document-guided","document-layers","document-adaptive","document-editor","document-chat"]},
  "project-contents":{audience:"creative",surfaces:["studio-project"]},
  "studio":{audience:"creative",surfaces:["studio-board","studio-guided","studio-layers","studio-adaptive","studio-editor","studio-chat"]},
  "library":{audience:"creative",surfaces:["library"]},
  "sessions":{audience:"creative",surfaces:["sessions"]},
  "scout":{audience:"creative",surfaces:["scout"]},
  "memory":{audience:"creative",surfaces:["memory"]},
  "canvas-home":{audience:"canvas",surfaces:["canvas-home"]},
  "canvas-projects":{audience:"canvas",surfaces:["canvas-projects"]},
  "canvas-library":{audience:"canvas",surfaces:["canvas-library"]},
  "canvas-workspace":{audience:"canvas",surfaces:["canvas-workspace"]},
  "canvas-proposals":{audience:"canvas",surfaces:["canvas-proposals"]},
  "product":{audience:"product",surfaces:["product-insights","product-delivery"],capabilities:["product.analytics.read","product.delivery.read","product.delivery.manage","product.release.read"]},
  "operations":{audience:"operations",surfaces:["operations","operations-system","operations-canvas-governance"],capabilities:["platform.policy.manage","platform.incident.manage","platform.provider.configure","platform.release.approve"]},
  "engineering":{audience:"engineering",surfaces:["engineering-health","engineering-events","engineering-sync","engineering-jobs"],capabilities:["engineering.diagnostics.read","engineering.events.read","engineering.sync.read"]},
};

const finiteInteger=(value:unknown,max:number)=>typeof value==="number"&&Number.isInteger(value)&&value>=0&&value<=max;
let lastRetentionSweep=0;

/** Persist coarse route health only; this table has no user, account, tenant, or URL columns. */
export async function handlePerformanceSample(request:Request,env:WorkerEnv){
  if(request.method!=="POST")return new Response("Method not allowed",{status:405});
  const declared=Number(request.headers.get("content-length")??0);
  if(!Number.isFinite(declared)||declared>2048)return Response.json({error:"invalid_performance_sample"},{status:413});
  const authorization=await requireUser(request,env,"viewer",{account:"principal"});
  if(authorization.response||!authorization.user)return authorization.response!;
  const consent=requireConsent(authorization.user);if(consent)return consent;
  let body:Record<string,unknown>;
  try{const serialized=await request.text();if(new TextEncoder().encode(serialized).length>2048)return Response.json({error:"invalid_performance_sample"},{status:413});const value:unknown=JSON.parse(serialized);if(!value||typeof value!=="object"||Array.isArray(value))throw new Error();body=value as Record<string,unknown>;}catch{return Response.json({error:"invalid_performance_sample"},{status:400});}
  const keys=new Set(["audience","routeFamily","routeSurface","cacheClass","routeLatencyMs","lcpMs","inpMs","clsMicrounits"]);
  if(Object.keys(body).some((key)=>!keys.has(key)))return Response.json({error:"invalid_performance_sample"},{status:400});
  const family=String(body.routeFamily??""),surface=String(body.routeSurface??""),route=routes[family];
  if(!route||!route.surfaces.includes(surface)||body.audience!==undefined&&body.audience!==route.audience)return Response.json({error:"performance_route_unavailable"},{status:403});
  if(route.audience==="canvas"&&!authorization.user.access.canvasAccess)return Response.json({error:"performance_route_unavailable"},{status:403});
  if(route.capabilities&&!route.capabilities.some((capability)=>hasCapability(authorization.user!,capability)))return Response.json({error:"performance_route_unavailable"},{status:403});
  if(surface==="product-insights"&&!hasCapability(authorization.user,"product.analytics.read"))return Response.json({error:"performance_route_unavailable"},{status:403});
  if(surface==="product-delivery"&&!["product.delivery.read","product.delivery.manage","product.release.read"].some((capability)=>hasCapability(authorization.user!,capability as FormaCapability)))return Response.json({error:"performance_route_unavailable"},{status:403});
  const specialized=surface==="engineering-events"?"engineering.events.read":surface==="engineering-sync"?"engineering.sync.read":surface.startsWith("engineering-")?"engineering.diagnostics.read":null;
  if(specialized&&!hasCapability(authorization.user,specialized))return Response.json({error:"performance_route_unavailable"},{status:403});
  if(!["miss","indexeddb","memory"].includes(String(body.cacheClass??""))||!finiteInteger(body.routeLatencyMs,120_000)
    ||body.lcpMs!==null&&body.lcpMs!==undefined&&!finiteInteger(body.lcpMs,120_000)
    ||body.inpMs!==null&&body.inpMs!==undefined&&!finiteInteger(body.inpMs,60_000)
    ||body.clsMicrounits!==null&&body.clsMicrounits!==undefined&&!finiteInteger(body.clsMicrounits,1_000_000))return Response.json({error:"invalid_performance_sample"},{status:400});
  const now=Date.now();
  if(now-lastRetentionSweep>60*60_000){lastRetentionSweep=now;await env.DB.prepare("DELETE FROM route_performance_samples WHERE recorded_at<?").bind(new Date(now-30*86_400_000).toISOString()).run();}
  const current=new Date(now).toISOString(),recent=new Date(now-60_000).toISOString(),latency=Number(body.routeLatencyMs),lcp=body.lcpMs??null,inp=body.inpMs??null,cls=body.clsMicrounits??null;
  const result=await env.DB.prepare(`INSERT INTO route_performance_samples(sample_id,audience,route_family,route_surface,cache_class,route_latency_ms,lcp_ms,inp_ms,cls_microunits,recorded_at)
    SELECT ?,?,?,?,?,?,?,?,?,? WHERE
      (SELECT COUNT(*) FROM route_performance_samples WHERE audience=? AND route_family=? AND recorded_at>?)<120
      AND NOT EXISTS(SELECT 1 FROM route_performance_samples WHERE audience=? AND route_family=? AND route_surface=? AND cache_class=?
        AND route_latency_ms=? AND lcp_ms IS ? AND inp_ms IS ? AND cls_microunits IS ? AND recorded_at>?)`)
    .bind(uuidV7(),route.audience,family,surface,String(body.cacheClass),latency,lcp,inp,cls,current,route.audience,family,recent,route.audience,family,surface,String(body.cacheClass),latency,lcp,inp,cls,recent).run();
  return Response.json({recorded:Number(result.meta.changes??0)===1},{status:202,headers:{"cache-control":"private, no-store"}});
}

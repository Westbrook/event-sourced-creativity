import { buildAnalyticsReport, type AnalyticsStream } from "../src/model/analytics.ts";
import { LIVE_REPLAY_PRICING_VERSION } from "./replay-cost.ts";
import { requireUser } from "./pilot-policy.ts";
import { ensureSchema, PHANTOM_ATTENTION_EVENT_SQL, serializeEvent, type WorkerEnv } from "./runtime.ts";

const MAX_ANALYTICS_EVENTS=250_000;
const allowedRanges=new Set([7,30,90,365]);

export async function handleAnalytics(request:Request,env:WorkerEnv){
  await ensureSchema(env);const auth=await requireUser(request,env,"admin",{account:"principal"});if(auth.response||!auth.user)return auth.response!;if(request.method!=="GET")return new Response("Method not allowed",{status:405});
  const url=new URL(request.url);const requestedDays=Number(url.searchParams.get("days")??30);const rangeDays=url.searchParams.get("days")==="all"?null:allowedRanges.has(requestedDays)?requestedDays:30;const includeSynthetic=url.searchParams.get("includeSynthetic")==="true";
  const eventQuery=includeSynthetic
    ? `SELECT * FROM events WHERE NOT (${PHANTOM_ATTENTION_EVENT_SQL}) ORDER BY stream_id,sequence LIMIT ?`
    : `SELECT * FROM events WHERE stream_id NOT IN (SELECT fictional_stream_id FROM replay_personas WHERE status='ready') AND NOT (${PHANTOM_ATTENTION_EVENT_SQL}) ORDER BY stream_id,sequence LIMIT ?`;
  const [userRows,personaRows,eventRows]=await env.DB.batch<Record<string,unknown>>([
    env.DB.prepare("SELECT user_id,email,display_name FROM users ORDER BY created_at"),
    env.DB.prepare("SELECT fictional_user_id,fictional_stream_id,display_name FROM replay_personas WHERE status='ready' ORDER BY created_at"),
    env.DB.prepare(eventQuery).bind(MAX_ANALYTICS_EVENTS+1),
  ]);
  const users=new Map(userRows.results.map((row)=>[String(row.user_id),{name:String(row.display_name),email:String(row.email)}]));const personas=new Map(personaRows.results.map((row)=>[String(row.fictional_stream_id),{id:String(row.fictional_user_id),name:String(row.display_name)}]));const grouped=new Map<string,ReturnType<typeof serializeEvent>[]>();
  for(const row of eventRows.results.slice(0,MAX_ANALYTICS_EVENTS)){const event=serializeEvent(row);const bucket=grouped.get(event.streamId);if(bucket)bucket.push(event);else grouped.set(event.streamId,[event]);}
  const streams:AnalyticsStream[]=[...grouped.entries()].map(([streamId,events])=>{const persona=personas.get(streamId);const inferredId=streamId.startsWith("creative:")?streamId.slice("creative:".length):streamId;const user=users.get(inferredId);return{streamId,userId:persona?.id??inferredId,userName:persona?.name??user?.name??"Unknown creator",userEmail:user?.email,organizationId:"forma",organizationName:"Forma workspace",fictional:Boolean(persona),events};});
  const report=buildAnalyticsReport(streams,{rangeDays,includeSynthetic,truncated:eventRows.results.length>MAX_ANALYTICS_EVENTS,pricingVersion:LIVE_REPLAY_PRICING_VERSION});return Response.json({report},{headers:{"cache-control":"private, no-store"}});
}

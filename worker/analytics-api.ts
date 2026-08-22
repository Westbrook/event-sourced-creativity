import { buildAnalyticsReport, type AnalyticsStream } from "../src/model/analytics.ts";
import { LIVE_REPLAY_PRICING_VERSION } from "./replay-cost.ts";
import { requireUser } from "./pilot-policy.ts";
import { ensureSchema, PHANTOM_ATTENTION_EVENT_SQL, serializeEvent, type WorkerEnv } from "./runtime.ts";

const MAX_ANALYTICS_EVENTS=250_000;
const MAX_CACHED_ANALYTICS_EVENTS=10_000;
const MAX_CACHED_ANALYTICS_ACCOUNTS=2;
const MAX_CACHED_ANALYTICS_AGE_MS=120_000;
const allowedRanges=new Set([7,30,90,365]);
const analyticsPayload="CASE WHEN type='ContextCompiled' THEN json_remove(payload,'$.compiled_snapshot') WHEN type='CanvasRegisterSet' THEN json_remove(payload,'$.operation','$.selected_item_ids','$.previous_frame','$.next_frame','$.normalization_delta') WHEN type='DocumentRenderCompleted' THEN json_remove(payload,'$.reference_inputs') WHEN type='BriefComposed' THEN json_remove(payload,'$.items') ELSE payload END";
const analyticsColumns=`event_id e,stream_id s,sequence q,occurred_at o,actor a,type t,${analyticsPayload} p`;
type CachedAnalyticsEvents={head:number;personas:string;streams:Map<string,ReturnType<typeof serializeEvent>[]>;count:number;usedAt:number};
const cachedAnalyticsEvents=new WeakMap<D1Database,Map<string,CachedAnalyticsEvents>>();

function analyticsAccounts(database:D1Database){let accounts=cachedAnalyticsEvents.get(database);if(!accounts){accounts=new Map();cachedAnalyticsEvents.set(database,accounts);}return accounts;}
function analyticsEvent(row:Record<string,unknown>):ReturnType<typeof serializeEvent>{return{eventId:String(row.e),streamId:String(row.s),sequence:Number(row.q),occurredAt:String(row.o),recordedAt:String(row.o),actor:String(row.a),clientId:"",correlationId:"",causationId:null,compensatesEventId:null,schemaVersion:1,type:String(row.t),payload:JSON.parse(String(row.p)) as Record<string,unknown>};}

export async function handleAnalytics(request:Request,env:WorkerEnv){
  await ensureSchema(env);const auth=await requireUser(request,env,"admin",{account:"principal"});if(auth.response||!auth.user)return auth.response!;if(request.method!=="GET")return new Response("Method not allowed",{status:405});
  const url=new URL(request.url);const requestedDays=Number(url.searchParams.get("days")??30);const rangeDays=url.searchParams.get("days")==="all"?null:allowedRanges.has(requestedDays)?requestedDays:30;const includeSynthetic=url.searchParams.get("includeSynthetic")==="true";
  const accounts=analyticsAccounts(env.DB);const key=`${auth.user.userId}:${includeSynthetic?"synthetic":"real"}:${LIVE_REPLAY_PRICING_VERSION}`;const now=Date.now();
  for(const [account,entry] of accounts)if(now-entry.usedAt>MAX_CACHED_ANALYTICS_AGE_MS)accounts.delete(account);
  let previous=accounts.get(key);const fullEventQuery=includeSynthetic
    ? `SELECT ${analyticsColumns} FROM events WHERE NOT (${PHANTOM_ATTENTION_EVENT_SQL}) ORDER BY stream_id,sequence LIMIT ?`
    : `SELECT ${analyticsColumns} FROM events WHERE stream_id NOT IN (SELECT fictional_stream_id FROM replay_personas WHERE status='ready') AND NOT (${PHANTOM_ATTENTION_EVENT_SQL}) ORDER BY stream_id,sequence LIMIT ?`;
  const deltaEventQuery=includeSynthetic
    ? `SELECT ${analyticsColumns} FROM events WHERE rowid>? AND NOT (${PHANTOM_ATTENTION_EVENT_SQL}) ORDER BY rowid LIMIT ?`
    : `SELECT ${analyticsColumns} FROM events WHERE rowid>? AND stream_id NOT IN (SELECT fictional_stream_id FROM replay_personas WHERE status='ready') AND NOT (${PHANTOM_ATTENTION_EVENT_SQL}) ORDER BY rowid LIMIT ?`;
  const usersQuery="SELECT user_id,email,display_name,(SELECT COALESCE(MAX(rowid),0) FROM events) AS analytics_head FROM users ORDER BY created_at";
  const personasQuery="SELECT fictional_user_id,fictional_stream_id,display_name FROM replay_personas WHERE status='ready' ORDER BY created_at";
  const dashboardBatch=(cached?:CachedAnalyticsEvents)=>env.DB.batch<Record<string,unknown>>([
    env.DB.prepare(usersQuery),env.DB.prepare(personasQuery),
    cached?env.DB.prepare(deltaEventQuery).bind(cached.head,MAX_ANALYTICS_EVENTS+1):env.DB.prepare(fullEventQuery).bind(MAX_ANALYTICS_EVENTS+1),
  ]);
  const databaseStarted=performance.now();let [userRows,personaRows,eventRows]=await dashboardBatch(previous);
  let head=Number(userRows.results[0]?.analytics_head??0);let personaStreams=JSON.stringify(personaRows.results.map((row)=>String(row.fictional_stream_id)).sort());
  if(previous&&(head<previous.head||!includeSynthetic&&personaStreams!==previous.personas||previous.count+eventRows.results.length>MAX_ANALYTICS_EVENTS)){
    previous=undefined;[userRows,personaRows,eventRows]=await dashboardBatch();head=Number(userRows.results[0]?.analytics_head??0);personaStreams=JSON.stringify(personaRows.results.map((row)=>String(row.fictional_stream_id)).sort());
  }
  const databaseMs=Math.max(0,performance.now()-databaseStarted);
  const users=new Map(userRows.results.map((row)=>[String(row.user_id),{name:String(row.display_name),email:String(row.email)}]));const personas=new Map(personaRows.results.map((row)=>[String(row.fictional_stream_id),{id:String(row.fictional_user_id),name:String(row.display_name)}]));
  const grouped=new Map<string,ReturnType<typeof serializeEvent>[]>(previous?[...previous.streams.entries()].map(([stream,events])=>[stream,[...events]]):[]);
  for(const row of eventRows.results.slice(0,MAX_ANALYTICS_EVENTS)){const event=analyticsEvent(row);const bucket=grouped.get(event.streamId);if(bucket){if(event.sequence>(bucket.at(-1)?.sequence??0))bucket.push(event);}else grouped.set(event.streamId,[event]);}
  const count=[...grouped.values()].reduce((total,events)=>total+events.length,0);
  if(count<=MAX_CACHED_ANALYTICS_EVENTS&&eventRows.results.length<=MAX_ANALYTICS_EVENTS){
    const entry={head,personas:personaStreams,streams:grouped,count,usedAt:now};const latest=accounts.get(key);
    if(!latest||latest===previous||latest.head<=head)accounts.set(key,entry);
    while(accounts.size>MAX_CACHED_ANALYTICS_ACCOUNTS){const oldest=[...accounts.entries()].sort((left,right)=>left[1].usedAt-right[1].usedAt)[0];if(oldest)accounts.delete(oldest[0]);}
  }else accounts.delete(key);
  const streams:AnalyticsStream[]=[...grouped.entries()].sort(([left],[right])=>left<right?-1:left>right?1:0).map(([streamId,events])=>{const persona=personas.get(streamId);const inferredId=streamId.startsWith("creative:")?streamId.slice("creative:".length):streamId;const user=users.get(inferredId);return{streamId,userId:persona?.id??inferredId,userName:persona?.name??user?.name??"Unknown creator",userEmail:user?.email,organizationId:"forma",organizationName:"Forma workspace",fictional:Boolean(persona),events};});
  const foldStarted=performance.now();const report=buildAnalyticsReport(streams,{rangeDays,includeSynthetic,truncated:eventRows.results.length>MAX_ANALYTICS_EVENTS,pricingVersion:LIVE_REPLAY_PRICING_VERSION});const foldMs=Math.max(0,performance.now()-foldStarted);
  return Response.json({report},{headers:{"cache-control":"private, no-store","x-forma-analytics-cache":previous?"delta":"miss","x-forma-analytics-source-rows":String(eventRows.results.length),"server-timing":`analytics-db;dur=${databaseMs.toFixed(1)}, analytics-fold;dur=${foldMs.toFixed(1)}`}});
}

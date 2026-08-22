import { buildAnalyticsReport, type AnalyticsStream } from "../src/model/analytics.ts";
import { LIVE_REPLAY_PRICING_VERSION } from "./replay-cost.ts";
import { requireUser } from "./pilot-policy.ts";
import { ensureSchema, PHANTOM_ATTENTION_EVENT_SQL, serializeEvent, type WorkerEnv, type WorkerExecutionContext } from "./runtime.ts";

const MAX_ANALYTICS_EVENTS=250_000;
const MAX_CACHED_ANALYTICS_EVENTS=10_000;
const MAX_CACHED_ANALYTICS_ACCOUNTS=2;
const MAX_CACHED_ANALYTICS_AGE_MS=120_000;
const MAX_DURABLE_ANALYTICS_BYTES=1_500_000;
const DURABLE_ANALYTICS_REFRESH_EVENTS=256;
const allowedRanges=new Set([7,30,90,365]);
const analyticsPayload="CASE WHEN type='ContextCompiled' THEN json_remove(payload,'$.compiled_snapshot') WHEN type='CanvasRegisterSet' THEN json_remove(payload,'$.operation','$.selected_item_ids','$.previous_frame','$.next_frame','$.normalization_delta') WHEN type='DocumentRenderCompleted' THEN json_remove(payload,'$.reference_inputs') WHEN type='BriefComposed' THEN json_remove(payload,'$.items') ELSE payload END";
const analyticsColumns=`event_id e,stream_id s,sequence q,occurred_at o,actor a,type t,${analyticsPayload} p`;
type CachedAnalyticsEvents={head:number;personas:string;streams:Map<string,ReturnType<typeof serializeEvent>[]>;count:number;usedAt:number;durableHead:number};
type DurableAnalyticsSource={schema:1;owner:string;synthetic:boolean;pricing:string;head:number;personas:string;count:number;payload:string};
const cachedAnalyticsEvents=new WeakMap<D1Database,Map<string,CachedAnalyticsEvents>>();

function analyticsAccounts(database:D1Database){let accounts=cachedAnalyticsEvents.get(database);if(!accounts){accounts=new Map();cachedAnalyticsEvents.set(database,accounts);}return accounts;}
function analyticsEvent(row:Record<string,unknown>):ReturnType<typeof serializeEvent>{return{eventId:String(row.e),streamId:String(row.s),sequence:Number(row.q),occurredAt:String(row.o),recordedAt:String(row.o),actor:String(row.a),clientId:"",correlationId:"",causationId:null,compensatesEventId:null,schemaVersion:1,type:String(row.t),payload:(typeof row.p==="string"?JSON.parse(row.p):row.p) as Record<string,unknown>};}

async function restoreAnalyticsSource(value:unknown,now:number,ownerId:string,includeSynthetic:boolean):Promise<CachedAnalyticsEvents|null>{
  if(typeof value!=="string")return null;
  try{
    const source=JSON.parse(value) as Partial<DurableAnalyticsSource>;
    if(source.schema!==1||source.owner!==ownerId||source.synthetic!==includeSynthetic||source.pricing!==LIVE_REPLAY_PRICING_VERSION||!Number.isSafeInteger(source.head)||Number(source.head)<0||typeof source.personas!=="string"||!Number.isSafeInteger(source.count)||Number(source.count)<0||Number(source.count)>MAX_CACHED_ANALYTICS_EVENTS||typeof source.payload!=="string"||source.payload.length>MAX_DURABLE_ANALYTICS_BYTES)return null;
    const binary=atob(source.payload),bytes=new Uint8Array(binary.length);for(let index=0;index<binary.length;index+=1)bytes[index]=binary.charCodeAt(index);
    const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    const rows=JSON.parse(await new Response(stream).text()) as unknown;
    if(!Array.isArray(rows)||rows.length!==source.count)return null;
    const streams=new Map<string,ReturnType<typeof serializeEvent>[]>();
    for(const row of rows){
      if(!Array.isArray(row)||row.length!==7||typeof row[0]!=="string"||typeof row[1]!=="string"||!Number.isSafeInteger(row[2])||typeof row[3]!=="string"||typeof row[4]!=="string"||typeof row[5]!=="string"||typeof row[6]!=="object"||row[6]===null||Array.isArray(row[6]))return null;
      const event=analyticsEvent({e:row[0],s:row[1],q:row[2],o:row[3],a:row[4],t:row[5],p:row[6]});
      const bucket=streams.get(event.streamId);if(bucket){if(event.sequence<=(bucket.at(-1)?.sequence??0))return null;bucket.push(event);}else streams.set(event.streamId,[event]);
    }
    return{head:Number(source.head),personas:source.personas,streams,count:rows.length,usedAt:now,durableHead:Number(source.head)};
  }catch{return null;}
}

async function persistAnalyticsSource(database:D1Database,contentId:string,ownerId:string,includeSynthetic:boolean,entry:CachedAnalyticsEvents):Promise<boolean>{
  const rows=[...entry.streams.values()].flatMap((events)=>events.map((event)=>[event.eventId,event.streamId,event.sequence,event.occurredAt,event.actor,event.type,event.payload]));
  const stream=new Blob([JSON.stringify(rows)]).stream().pipeThrough(new CompressionStream("gzip"));
  const bytes=new Uint8Array(await new Response(stream).arrayBuffer());
  let binary="";for(let index=0;index<bytes.length;index+=16_384)binary+=String.fromCharCode(...bytes.subarray(index,index+16_384));
  const payload=btoa(binary);if(payload.length>MAX_DURABLE_ANALYTICS_BYTES)return false;
  const content=JSON.stringify({schema:1,owner:ownerId,synthetic:includeSynthetic,pricing:LIVE_REPLAY_PRICING_VERSION,head:entry.head,personas:entry.personas,count:entry.count,payload} satisfies DurableAnalyticsSource);
  await database.prepare("INSERT INTO external_content(content_id,owner_id,content,created_at) VALUES (?,?,?,?) ON CONFLICT(content_id) DO UPDATE SET content=excluded.content,created_at=excluded.created_at WHERE external_content.owner_id=excluded.owner_id AND CASE WHEN json_valid(external_content.content) THEN COALESCE(CAST(json_extract(external_content.content,'$.head') AS INTEGER),-1)<=CAST(json_extract(excluded.content,'$.head') AS INTEGER) ELSE 1 END").bind(contentId,ownerId,content,new Date().toISOString()).run();
  return true;
}

export async function handleAnalytics(request:Request,env:WorkerEnv,context?:WorkerExecutionContext){
  await ensureSchema(env);const auth=await requireUser(request,env,"admin",{account:"principal"});if(auth.response||!auth.user)return auth.response!;if(request.method!=="GET")return new Response("Method not allowed",{status:405});
  const url=new URL(request.url);const requestedDays=Number(url.searchParams.get("days")??30);const rangeDays=url.searchParams.get("days")==="all"?null:allowedRanges.has(requestedDays)?requestedDays:30;const includeSynthetic=url.searchParams.get("includeSynthetic")==="true";
  const accounts=analyticsAccounts(env.DB);const key=`${auth.user.userId}:${includeSynthetic?"synthetic":"real"}:${LIVE_REPLAY_PRICING_VERSION}`;const now=Date.now();
  for(const [account,entry] of accounts)if(now-entry.usedAt>MAX_CACHED_ANALYTICS_AGE_MS)accounts.delete(account);
  let previous=accounts.get(key);const contentId=`analytics-source:v1:${key}`;const localHit=Boolean(previous);let durableHit=false;
  const fullEventQuery=includeSynthetic
    ? `SELECT ${analyticsColumns} FROM events WHERE NOT (${PHANTOM_ATTENTION_EVENT_SQL}) ORDER BY stream_id,sequence LIMIT ?`
    : `SELECT ${analyticsColumns} FROM events WHERE stream_id NOT IN (SELECT fictional_stream_id FROM replay_personas WHERE status='ready') AND NOT (${PHANTOM_ATTENTION_EVENT_SQL}) ORDER BY stream_id,sequence LIMIT ?`;
  const deltaEventQuery=includeSynthetic
    ? `SELECT ${analyticsColumns} FROM events WHERE rowid>? AND NOT (${PHANTOM_ATTENTION_EVENT_SQL}) ORDER BY rowid LIMIT ?`
    : `SELECT ${analyticsColumns} FROM events WHERE rowid>? AND stream_id NOT IN (SELECT fictional_stream_id FROM replay_personas WHERE status='ready') AND NOT (${PHANTOM_ATTENTION_EVENT_SQL}) ORDER BY rowid LIMIT ?`;
  const usersQuery="SELECT user_id,email,display_name,(SELECT COALESCE(MAX(rowid),0) FROM events) AS analytics_head FROM users ORDER BY created_at";
  const personasQuery="SELECT fictional_user_id,fictional_stream_id,display_name FROM replay_personas WHERE status='ready' ORDER BY created_at";
  const eventFilter=`${includeSynthetic?"":`stream_id NOT IN (SELECT fictional_stream_id FROM replay_personas WHERE status='ready') AND `}NOT (${PHANTOM_ATTENTION_EVENT_SQL})`;
  const adaptiveEventQuery=`WITH snapshot(head) AS MATERIALIZED (SELECT CAST(json_extract(content,'$.head') AS INTEGER) FROM external_content WHERE content_id=? AND owner_id=? AND CASE WHEN json_valid(content) THEN json_extract(content,'$.schema')=1 AND json_type(content,'$.head')='integer' ELSE 0 END) SELECT * FROM (SELECT ${analyticsColumns} FROM events WHERE rowid>(SELECT head FROM snapshot) AND ${eventFilter} ORDER BY rowid LIMIT ?) UNION ALL SELECT * FROM (SELECT ${analyticsColumns} FROM events WHERE NOT EXISTS(SELECT 1 FROM snapshot) AND ${eventFilter} ORDER BY stream_id,sequence LIMIT ?)`;
  const snapshotQuery="SELECT content FROM external_content WHERE content_id=? AND owner_id=?";
  const dashboardBatch=(cached?:CachedAnalyticsEvents,full=false)=>env.DB.batch<Record<string,unknown>>([
    env.DB.prepare(usersQuery),env.DB.prepare(personasQuery),
    cached?env.DB.prepare(deltaEventQuery).bind(cached.head,MAX_ANALYTICS_EVENTS+1):full?env.DB.prepare(fullEventQuery).bind(MAX_ANALYTICS_EVENTS+1):env.DB.prepare(adaptiveEventQuery).bind(contentId,auth.user!.userId,MAX_ANALYTICS_EVENTS+1,MAX_ANALYTICS_EVENTS+1),
    ...(!cached&&!full?[env.DB.prepare(snapshotQuery).bind(contentId,auth.user!.userId)]:[]),
  ]);
  const databaseStarted=performance.now();const initialRows=await dashboardBatch(previous);let [userRows,personaRows,eventRows]=initialRows;const snapshotRows=initialRows[3];
  if(!previous&&snapshotRows?.results.length){previous=await restoreAnalyticsSource(snapshotRows.results[0]?.content,now,auth.user.userId,includeSynthetic)??undefined;durableHit=Boolean(previous);if(!previous)[userRows,personaRows,eventRows]=await dashboardBatch(undefined,true);}
  let head=Number(userRows.results[0]?.analytics_head??0);let personaStreams=JSON.stringify(personaRows.results.map((row)=>String(row.fictional_stream_id)).sort());
  if(previous&&(head<previous.head||!includeSynthetic&&personaStreams!==previous.personas||previous.count+eventRows.results.length>MAX_ANALYTICS_EVENTS)){
    previous=undefined;durableHit=false;[userRows,personaRows,eventRows]=await dashboardBatch(undefined,true);head=Number(userRows.results[0]?.analytics_head??0);personaStreams=JSON.stringify(personaRows.results.map((row)=>String(row.fictional_stream_id)).sort());
  }
  const databaseMs=Math.max(0,performance.now()-databaseStarted);
  const users=new Map(userRows.results.map((row)=>[String(row.user_id),{name:String(row.display_name),email:String(row.email)}]));const personas=new Map(personaRows.results.map((row)=>[String(row.fictional_stream_id),{id:String(row.fictional_user_id),name:String(row.display_name)}]));
  const grouped=new Map<string,ReturnType<typeof serializeEvent>[]>(previous?[...previous.streams.entries()].map(([stream,events])=>[stream,[...events]]):[]);
  for(const row of eventRows.results.slice(0,MAX_ANALYTICS_EVENTS)){const event=analyticsEvent(row);const bucket=grouped.get(event.streamId);if(bucket){if(event.sequence>(bucket.at(-1)?.sequence??0))bucket.push(event);}else grouped.set(event.streamId,[event]);}
  const count=[...grouped.values()].reduce((total,events)=>total+events.length,0);
  if(count<=MAX_CACHED_ANALYTICS_EVENTS&&eventRows.results.length<=MAX_ANALYTICS_EVENTS){
    const entry={head,personas:personaStreams,streams:grouped,count,usedAt:now,durableHead:previous?.durableHead??0};const latest=accounts.get(key);
    if(!latest||latest===previous||latest.head<=head)accounts.set(key,entry);
    while(accounts.size>MAX_CACHED_ANALYTICS_ACCOUNTS){const oldest=[...accounts.entries()].sort((left,right)=>left[1].usedAt-right[1].usedAt)[0];if(oldest)accounts.delete(oldest[0]);}
    if(context&&(!entry.durableHead||head-entry.durableHead>=DURABLE_ANALYTICS_REFRESH_EVENTS)){entry.durableHead=head;context.waitUntil(persistAnalyticsSource(env.DB,contentId,auth.user.userId,includeSynthetic,entry).then((saved)=>{if(!saved)entry.durableHead=0;}).catch(()=>{entry.durableHead=0;}));}
  }else accounts.delete(key);
  const streams:AnalyticsStream[]=[...grouped.entries()].sort(([left],[right])=>left<right?-1:left>right?1:0).map(([streamId,events])=>{const persona=personas.get(streamId);const inferredId=streamId.startsWith("creative:")?streamId.slice("creative:".length):streamId;const user=users.get(inferredId);return{streamId,userId:persona?.id??inferredId,userName:persona?.name??user?.name??"Unknown creator",userEmail:user?.email,organizationId:"forma",organizationName:"Forma workspace",fictional:Boolean(persona),events};});
  const foldStarted=performance.now();const report=buildAnalyticsReport(streams,{rangeDays,includeSynthetic,truncated:eventRows.results.length>MAX_ANALYTICS_EVENTS,pricingVersion:LIVE_REPLAY_PRICING_VERSION});const foldMs=Math.max(0,performance.now()-foldStarted);
  return Response.json({report},{headers:{"cache-control":"private, no-store","x-forma-analytics-cache":durableHit?"durable":localHit&&previous?"delta":"miss","x-forma-analytics-source-rows":String(eventRows.results.length),"server-timing":`analytics-db;dur=${databaseMs.toFixed(1)}, analytics-fold;dur=${foldMs.toFixed(1)}`}});
}

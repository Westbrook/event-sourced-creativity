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
type DurableAnalyticsSource={schema:2;owner:string;epoch:string;synthetic:boolean;pricing:string;head:number;personas:string;count:number;payload:string};
const cachedAnalyticsEvents=new WeakMap<D1Database,Map<string,CachedAnalyticsEvents>>();

const SAFE_ANALYTICS_FIELDS=new Set([
  "project_id","document_id","block_id","generation_id","object_id","artifact_id","job_id","preflight_id","prompt_fan_id","session_id","canvas_id","episode_id",
  "draft_object_id","source_object_id","source_output_id","promoted_from_object_id","organization_action_id","presentation_action_id","history_action_id","interaction_id",
  "quality","prompt_technique","technique","artifact_kind","type","status","source_surface","surface","view","created_from","source_type","scope","resize_mode","interaction",
  "adapter_id","adapter_version","adapter_reconciliation_status","adapter_issue_kind","adapter_issue_count","adapter_failed_stage_count","adapter_final_issue_count","adapter_repair_status",
  "development_stage_kind","used_uploaded_reference_pixels","used_locked_study_pixels","study","simulation","synthetic","mock_data_source",
  "latency_ms","input_tokens","output_tokens","total_tokens","cost_microusd","reference_input_count","estimated_cost_avoided_microusd","estimated_cost_microusd",
  "active_ms","idle_ms","friction_score","outcome_weight","weight","active","terminal_type","property_path","expires_at","capture_version",
]);
const SAFE_PROPERTY_FIELDS=new Set(["authority","confidence","weight","active"]);

function analyticsFailureCategory(payload:Record<string,unknown>){
  const value=[payload.error_category,payload.error_code,payload.error_class,payload.error_message,payload.reason].map((item)=>String(item??"")).join(" ").toLowerCase();
  if(/credit|quota|budget|billing|hard.cap/.test(value))return"quota";
  if(/safety|moderation|policy|content.filter/.test(value))return"safety";
  if(/rate.?limit|too many requests|429/.test(value))return"rateLimit";
  if(/provider|upstream|connection|timeout|unavailable/.test(value))return"provider";
  if(/compile|validation|invalid|application|workflow/.test(value))return"application";
  return"unknown";
}

/** Analytics stores only schema-derived operational facts, never customer prose or media. */
export function projectAnalyticsPayload(type:string,input:Record<string,unknown>){
  const projected:Record<string,unknown>={};
  for(const [key,value] of Object.entries(input)){
    if(!SAFE_ANALYTICS_FIELDS.has(key)||value!==null&&!["string","number","boolean"].includes(typeof value))continue;
    projected[key]=typeof value==="string"?value.slice(0,160):value;
  }
  if(Array.isArray(input.object_ids))projected.object_ids=input.object_ids.filter((value)=>typeof value==="string").map((value)=>String(value).slice(0,160));
  if(Array.isArray(input.source_block_versions))projected.source_block_versions=input.source_block_versions.map((value)=>value&&typeof value==="object"?{block_id:String((value as Record<string,unknown>).block_id??"").slice(0,160),version:Number((value as Record<string,unknown>).version??0)}:null).filter(Boolean);
  if(Array.isArray(input.probe_results))projected.probe_results=input.probe_results.map((value)=>value&&typeof value==="object"?{id:String((value as Record<string,unknown>).id??"").slice(0,80),status:String((value as Record<string,unknown>).status??"").slice(0,24)}:null).filter(Boolean);
  if(input.cost_breakdown_microusd&&typeof input.cost_breakdown_microusd==="object")projected.cost_breakdown_microusd=Object.fromEntries(Object.entries(input.cost_breakdown_microusd as Record<string,unknown>).filter(([key,value])=>/^[a-z_]+_microusd$/.test(key)&&typeof value==="number"&&Number.isFinite(value)));
  if(input.origin&&typeof input.origin==="object")projected.origin={synthetic:(input.origin as Record<string,unknown>).synthetic===true};
  if(type==="ProjectCreated"||type==="ProjectRenamed"){
    const label=`Project ${String(input.project_id??"").slice(-8)||"workspace"}`;
    if(type==="ProjectCreated")projected.name=label;else projected.new_name=label;
  }
  if(type==="DocumentCreated"||type==="DocumentForked"||type==="DocumentRenamed"){
    const label=`Document ${String(input.document_id??"").slice(-8)||"workspace"}`;
    if(type==="DocumentRenamed")projected.new_title=label;else projected.title=label;
  }
  if(type==="BlockCreated"){
    projected.handle=`${String(input.type??"decision").slice(0,40)} · ${String(input.block_id??"").slice(-8)||"decision"}`;
    const properties=input.properties&&typeof input.properties==="object"&&!Array.isArray(input.properties)?input.properties as Record<string,unknown>:{};
    projected.properties=Object.fromEntries(Object.entries(properties).map(([key,value])=>[key.slice(0,80),SAFE_PROPERTY_FIELDS.has(key)&&["string","number","boolean"].includes(typeof value)?value:value===null||value===""?value:Array.isArray(value)?value.length?[true]:[]:typeof value==="number"||typeof value==="boolean"?value:"Content withheld"]));
  }
  if(type==="BlockRenamed")projected.new_handle=`decision · ${String(input.block_id??"").slice(-8)||"updated"}`;
  if(type==="BlockPropertyEdited")projected.new_value=SAFE_PROPERTY_FIELDS.has(String(input.property_path??""))&&["string","number","boolean"].includes(typeof input.new_value)?input.new_value:input.new_value===null||input.new_value===""?input.new_value:"Content withheld";
  if(type==="GenerationFailed"||type==="DocumentRenderFailed")projected.error_category=analyticsFailureCategory(input);
  if(type==="JobAttemptInterrupted")projected.reason=/retrying/i.test(String(input.reason??""))?"retrying":"interrupted";
  if(type==="AttentionEpisodeObserved")projected.context=/^[a-z][a-z0-9-]{0,39}$/.test(String(input.context??""))?input.context:"unspecified";
  return projected;
}

function analyticsAccounts(database:D1Database){let accounts=cachedAnalyticsEvents.get(database);if(!accounts){accounts=new Map();cachedAnalyticsEvents.set(database,accounts);}return accounts;}
function analyticsEvent(row:Record<string,unknown>):ReturnType<typeof serializeEvent>{const type=String(row.t);const raw=(typeof row.p==="string"?JSON.parse(row.p):row.p) as Record<string,unknown>;return{eventId:String(row.e),streamId:String(row.s),sequence:Number(row.q),occurredAt:String(row.o),recordedAt:String(row.o),actor:String(row.a),clientId:"",correlationId:"",causationId:null,compensatesEventId:null,schemaVersion:1,type,payload:projectAnalyticsPayload(type,raw)};}

async function restoreAnalyticsSource(value:unknown,now:number,ownerId:string,epoch:string,includeSynthetic:boolean):Promise<CachedAnalyticsEvents|null>{
  if(typeof value!=="string")return null;
  try{
    const source=JSON.parse(value) as Partial<DurableAnalyticsSource>;
    if(source.schema!==2||source.owner!==ownerId||source.epoch!==epoch||source.synthetic!==includeSynthetic||source.pricing!==LIVE_REPLAY_PRICING_VERSION||!Number.isSafeInteger(source.head)||Number(source.head)<0||typeof source.personas!=="string"||!Number.isSafeInteger(source.count)||Number(source.count)<0||Number(source.count)>MAX_CACHED_ANALYTICS_EVENTS||typeof source.payload!=="string"||source.payload.length>MAX_DURABLE_ANALYTICS_BYTES)return null;
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

async function persistAnalyticsSource(database:D1Database,contentId:string,ownerId:string,epoch:string,includeSynthetic:boolean,entry:CachedAnalyticsEvents):Promise<boolean>{
  const rows=[...entry.streams.values()].flatMap((events)=>events.map((event)=>[event.eventId,event.streamId,event.sequence,event.occurredAt,event.actor,event.type,event.payload]));
  const stream=new Blob([JSON.stringify(rows)]).stream().pipeThrough(new CompressionStream("gzip"));
  const bytes=new Uint8Array(await new Response(stream).arrayBuffer());
  let binary="";for(let index=0;index<bytes.length;index+=16_384)binary+=String.fromCharCode(...bytes.subarray(index,index+16_384));
  const payload=btoa(binary);if(payload.length>MAX_DURABLE_ANALYTICS_BYTES)return false;
  const content=JSON.stringify({schema:2,owner:ownerId,epoch,synthetic:includeSynthetic,pricing:LIVE_REPLAY_PRICING_VERSION,head:entry.head,personas:entry.personas,count:entry.count,payload} satisfies DurableAnalyticsSource);
  await database.prepare("INSERT INTO external_content(content_id,owner_id,content,created_at) VALUES (?,?,?,?) ON CONFLICT(content_id) DO UPDATE SET content=excluded.content,created_at=excluded.created_at WHERE external_content.owner_id=excluded.owner_id AND CASE WHEN json_valid(external_content.content) THEN COALESCE(CAST(json_extract(external_content.content,'$.head') AS INTEGER),-1)<=CAST(json_extract(excluded.content,'$.head') AS INTEGER) ELSE 1 END").bind(contentId,ownerId,content,new Date().toISOString()).run();
  return true;
}

export async function handleAnalytics(request:Request,env:WorkerEnv,context?:WorkerExecutionContext){
  await ensureSchema(env);const auth=await requireUser(request,env,"admin",{account:"principal"});if(auth.response||!auth.user)return auth.response!;if(request.method!=="GET")return new Response("Method not allowed",{status:405});
  const url=new URL(request.url);const requestedDays=Number(url.searchParams.get("days")??30);const rangeDays=url.searchParams.get("days")==="all"?null:allowedRanges.has(requestedDays)?requestedDays:30;const includeSynthetic=url.searchParams.get("includeSynthetic")==="true";
  const accounts=analyticsAccounts(env.DB);const epoch=String(auth.user.access.permissionEpoch??"legacy");const projectIds=JSON.stringify(auth.user.access.projects.map((project)=>project.projectAccessId));const key=`${auth.user.userId}:${epoch}:${includeSynthetic?"synthetic":"real"}:${LIVE_REPLAY_PRICING_VERSION}`;const now=Date.now();
  for(const [account,entry] of accounts)if(now-entry.usedAt>MAX_CACHED_ANALYTICS_AGE_MS)accounts.delete(account);
  let previous=accounts.get(key);const contentId=`analytics-source:v1:${key}`;const localHit=Boolean(previous);let durableHit=false;
  const authorizedEvent="(events.stream_id=? OR EXISTS(SELECT 1 FROM replay_personas owned_persona WHERE owned_persona.owner_id=? AND owned_persona.fictional_stream_id=events.stream_id AND owned_persona.status='ready') OR EXISTS(SELECT 1 FROM project_event_scopes allowed_project WHERE allowed_project.event_id=events.event_id AND allowed_project.project_access_id IN(SELECT value FROM json_each(?))))";
  const scopeBindings=[auth.user.streamId,auth.user.userId,projectIds] as const;
  const syntheticFilter=includeSynthetic?"":`stream_id NOT IN (SELECT fictional_stream_id FROM replay_personas WHERE status='ready') AND `;
  const fullEventQuery=`SELECT ${analyticsColumns} FROM events WHERE ${syntheticFilter}NOT (${PHANTOM_ATTENTION_EVENT_SQL}) AND ${authorizedEvent} ORDER BY stream_id,sequence LIMIT ?`;
  const deltaEventQuery=`SELECT ${analyticsColumns} FROM events WHERE rowid>? AND ${syntheticFilter}NOT (${PHANTOM_ATTENTION_EVENT_SQL}) AND ${authorizedEvent} ORDER BY rowid LIMIT ?`;
  const usersQuery="SELECT user_id,display_name,(SELECT COALESCE(MAX(rowid),0) FROM events) AS analytics_head,COALESCE((SELECT json_group_array(json_object('projectId',allowed.project_id,'organizationId',allowed.organization_id)) FROM organization_projects allowed WHERE allowed.owner_user_id=users.user_id AND allowed.project_access_id IN(SELECT value FROM json_each(?))),'[]') AS analytics_projects FROM users WHERE user_id=? OR EXISTS(SELECT 1 FROM replay_personas owned_persona WHERE owned_persona.owner_id=? AND owned_persona.fictional_user_id=users.user_id AND owned_persona.status='ready') OR EXISTS(SELECT 1 FROM organization_projects allowed_project WHERE allowed_project.owner_user_id=users.user_id AND allowed_project.project_access_id IN(SELECT value FROM json_each(?))) ORDER BY created_at";
  const personasQuery="SELECT fictional_user_id,fictional_stream_id,display_name FROM replay_personas WHERE owner_id=? AND status='ready' ORDER BY created_at";
  const eventFilter=`${syntheticFilter}NOT (${PHANTOM_ATTENTION_EVENT_SQL}) AND ${authorizedEvent}`;
  const adaptiveEventQuery=`WITH snapshot(head) AS MATERIALIZED (SELECT CAST(json_extract(content,'$.head') AS INTEGER) FROM external_content WHERE content_id=? AND owner_id=? AND CASE WHEN json_valid(content) THEN json_extract(content,'$.schema')=2 AND json_extract(content,'$.epoch')=? AND json_type(content,'$.head')='integer' ELSE 0 END) SELECT * FROM (SELECT ${analyticsColumns} FROM events WHERE rowid>(SELECT head FROM snapshot) AND ${eventFilter} ORDER BY rowid LIMIT ?) UNION ALL SELECT * FROM (SELECT ${analyticsColumns} FROM events WHERE NOT EXISTS(SELECT 1 FROM snapshot) AND ${eventFilter} ORDER BY stream_id,sequence LIMIT ?)`;
  const snapshotQuery="SELECT content FROM external_content WHERE content_id=? AND owner_id=?";
  const dashboardBatch=(cached?:CachedAnalyticsEvents,full=false)=>env.DB.batch<Record<string,unknown>>([
    env.DB.prepare(usersQuery).bind(projectIds,auth.user!.userId,auth.user!.userId,projectIds),env.DB.prepare(personasQuery).bind(auth.user!.userId),
    cached?env.DB.prepare(deltaEventQuery).bind(cached.head,...scopeBindings,MAX_ANALYTICS_EVENTS+1):full?env.DB.prepare(fullEventQuery).bind(...scopeBindings,MAX_ANALYTICS_EVENTS+1):env.DB.prepare(adaptiveEventQuery).bind(contentId,auth.user!.userId,epoch,...scopeBindings,MAX_ANALYTICS_EVENTS+1,...scopeBindings,MAX_ANALYTICS_EVENTS+1),
    ...(!cached&&!full?[env.DB.prepare(snapshotQuery).bind(contentId,auth.user!.userId)]:[]),
  ]);
  const databaseStarted=performance.now();const initialRows=await dashboardBatch(previous);let [userRows,personaRows,eventRows]=initialRows;const snapshotRows=initialRows[3];
  if(!previous&&snapshotRows?.results.length){previous=await restoreAnalyticsSource(snapshotRows.results[0]?.content,now,auth.user.userId,epoch,includeSynthetic)??undefined;durableHit=Boolean(previous);if(!previous)[userRows,personaRows,eventRows]=await dashboardBatch(undefined,true);}
  let head=Number(userRows.results[0]?.analytics_head??0);let personaStreams=JSON.stringify(personaRows.results.map((row)=>String(row.fictional_stream_id)).sort());
  if(previous&&(head<previous.head||!includeSynthetic&&personaStreams!==previous.personas||previous.count+eventRows.results.length>MAX_ANALYTICS_EVENTS)){
    previous=undefined;durableHit=false;[userRows,personaRows,eventRows]=await dashboardBatch(undefined,true);head=Number(userRows.results[0]?.analytics_head??0);personaStreams=JSON.stringify(personaRows.results.map((row)=>String(row.fictional_stream_id)).sort());
  }
  const databaseMs=Math.max(0,performance.now()-databaseStarted);
  const users=new Map(userRows.results.map((row)=>{let projects:Array<{projectId:string;organizationId:string}>=[];try{const value=JSON.parse(String(row.analytics_projects??"[]"));if(Array.isArray(value))projects=value as Array<{projectId:string;organizationId:string}>;}catch{/* Invalid metadata can never grant scope. */}return[String(row.user_id),{name:String(row.display_name),projects}] as const;}));const personas=new Map(personaRows.results.map((row)=>[String(row.fictional_stream_id),{id:String(row.fictional_user_id),name:String(row.display_name)}]));
  const grouped=new Map<string,ReturnType<typeof serializeEvent>[]>(previous?[...previous.streams.entries()].map(([stream,events])=>[stream,[...events]]):[]);
  for(const row of eventRows.results.slice(0,MAX_ANALYTICS_EVENTS)){const event=analyticsEvent(row);const bucket=grouped.get(event.streamId);if(bucket){if(event.sequence>(bucket.at(-1)?.sequence??0))bucket.push(event);}else grouped.set(event.streamId,[event]);}
  const count=[...grouped.values()].reduce((total,events)=>total+events.length,0);
  if(count<=MAX_CACHED_ANALYTICS_EVENTS&&eventRows.results.length<=MAX_ANALYTICS_EVENTS){
    const entry={head,personas:personaStreams,streams:grouped,count,usedAt:now,durableHead:previous?.durableHead??0};const latest=accounts.get(key);
    if(!latest||latest===previous||latest.head<=head)accounts.set(key,entry);
    while(accounts.size>MAX_CACHED_ANALYTICS_ACCOUNTS){const oldest=[...accounts.entries()].sort((left,right)=>left[1].usedAt-right[1].usedAt)[0];if(oldest)accounts.delete(oldest[0]);}
    if(context&&(!entry.durableHead||head-entry.durableHead>=DURABLE_ANALYTICS_REFRESH_EVENTS)){entry.durableHead=head;context.waitUntil(persistAnalyticsSource(env.DB,contentId,auth.user.userId,epoch,includeSynthetic,entry).then((saved)=>{if(!saved)entry.durableHead=0;}).catch(()=>{entry.durableHead=0;}));}
  }else accounts.delete(key);
  const streams:AnalyticsStream[]=[...grouped.entries()].sort(([left],[right])=>left<right?-1:left>right?1:0).map(([streamId,events])=>{const persona=personas.get(streamId);const inferredId=streamId.startsWith("creative:")?streamId.slice("creative:".length):streamId;const user=users.get(inferredId);const entitled=user?.projects.find((project)=>events.some((event)=>String(event.payload.project_id??"")===project.projectId));const organization=entitled?auth.user!.access.organizations.find((candidate)=>candidate.organizationId===entitled.organizationId):undefined;return{streamId,userId:persona?.id??inferredId,userName:persona?.name??user?.name??"Authorized creator",organizationId:organization?.organizationId??`personal:${auth.user!.userId}`,organizationName:organization?.name??"Personal workspace",fictional:Boolean(persona),events};});
  const foldStarted=performance.now();const report=buildAnalyticsReport(streams,{rangeDays,includeSynthetic,truncated:eventRows.results.length>MAX_ANALYTICS_EVENTS,pricingVersion:LIVE_REPLAY_PRICING_VERSION});const foldMs=Math.max(0,performance.now()-foldStarted);
  return Response.json({report},{headers:{"cache-control":"private, no-store","x-forma-analytics-cache":durableHit?"durable":localHit&&previous?"delta":"miss","x-forma-analytics-source-rows":String(eventRows.results.length),"server-timing":`analytics-db;dur=${databaseMs.toFixed(1)}, analytics-fold;dur=${foldMs.toFixed(1)}`}});
}

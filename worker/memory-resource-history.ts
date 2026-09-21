import { nextResourceMemoryNight } from './memory-resource-schedule.ts';
import { memoryCanonical } from './memory-sql.ts';
import { snapshotMemoryDerivationInput } from './memory-derivation-result.ts';
import { memoryResourceSelector } from '../src/model/memory-resource-scope.ts';
import { prepareNativeMemoryResourceAuthority,prepareScheduledResourceAuthority,nativeMemoryResourceScopeInputs,nativeMemoryResourceScopeGuards,type NativeMemoryResourceAuthority } from './memory-resource-authority.ts';
import { memoryResourceSchemaFamily,memoryResourceSchema,memoryResourceEnrollmentGuard,resourceEnrollmentColumns,type MemoryResourceEnrollment } from './memory-resource-settings.ts';
import { derivationAssertion,derivationResults,derivationVerified } from './memory-derivation-store.ts';
import { derivationExact } from './memory-derivation-policy.ts';
import { AssistantContextReadWitness } from './assistant-context-source.ts';
import { readNativeControlBody } from './native-control-body.ts';
import type { WorkerEnv } from './runtime.ts';
import type { MemorySqlGuard } from './memory-sql.ts';

const actions={BlockCreated:'edit',BlockRenamed:'edit',BlockPropertyEdited:'edit',BlockWeightSet:'edit',BlockLocked:'edit',BlockUnlocked:'edit',BlockRemoved:'remove',BlockRestored:'restore',CanvasItemPlaced:'reuse',CanvasReferenceCreated:'reuse',CanvasTextApplied:'edit',CanvasRegisterSet:'edit',CanvasItemRemoved:'remove',CanvasItemRestored:'restore'} as const;
const TYPES=Object.keys(actions).map(type=>"'"+type+"'").join(',');
type Source={event_id:string;sequence:number;type:keyof typeof actions;recorded_at:string};
const sourceColumns=['event_id','sequence','type','recorded_at'];
const reply=(body:Record<string,unknown>,status=200)=>Response.json({version:'memory-resource-history-v1',...body},{status,headers:{'cache-control':'private, no-store',vary:'Cookie, oai-authenticated-user-id, oai-authenticated-user-email'}});
declare const resourceRecallBrand:unique symbol;
export type NativeResourceMemoryRecall=Readonly<{[resourceRecallBrand]:true}>;
export type ResourceMemorySnapshot={version:1;resourceKey:string;enrollmentId:string;revision:number;asOf:string;expiresAt:string;throughSequence:number;sourceHead:number;sourceLimitReached:boolean;openingLimitReached:boolean;openingsAvailable:boolean;sources:Source[];openings:Array<{opening_id:string;source_head:number;recorded_at:string;expires_at:string}>};
type ResourceRecallCapture={snapshot:ResourceMemorySnapshot;env:WorkerEnv;db:WorkerEnv['DB'];authority:NativeMemoryResourceAuthority;guards:MemorySqlGuard[];value:Awaited<ReturnType<typeof captureResourceRecall>>['value']};
const recalls=new WeakMap<NativeResourceMemoryRecall,ResourceRecallCapture>();
function currentRecall(env:WorkerEnv,handle:NativeResourceMemoryRecall){
 const c=recalls.get(handle);if(!c||c.env!==env||c.db!==env.DB)throw Error('resource_recall_expired');
 nativeMemoryResourceScopeInputs(env,c.authority);
 if(Date.now()>=Date.parse(c.value.validUntil))throw Error('resource_recall_expired');return c;
}
/** Private native evidence, not model-use consent. The JSON presentation cannot
 * mint this handle or substitute for exact current source/consent predicates.
 * Every downstream disclosure/write must replay these predicates atomically. */
export async function prepareNativeResourceMemoryRecall(env:WorkerEnv,authority:NativeMemoryResourceAuthority):Promise<NativeResourceMemoryRecall>{
 const db=env.DB,e=await enrollment(env,authority),captured=await captureResourceRecall(env,e,authority);
 if(env.DB!==db)throw Error('resource_recall_changed');
 const handle=Object.freeze({}) as NativeResourceMemoryRecall;
 recalls.set(handle,{env,db,authority,guards:structuredClone(captured.guards),value:structuredClone(captured.value),snapshot:structuredClone(captured.snapshot)});currentRecall(env,handle);return handle;
}
/** Stored identity/data, not authority. A downstream consumer must retain this
 * exact snapshot with its native precommit proof and independently obtain model
 * consent. A new read never substitutes today's activity for approved inputs. */
export function nativeResourceMemoryRecallSnapshot(env:WorkerEnv,handle:NativeResourceMemoryRecall){return structuredClone(currentRecall(env,handle).snapshot);}
export async function prepareNativeResourceMemorySnapshot(env:WorkerEnv,authority:NativeMemoryResourceAuthority,input:unknown):Promise<NativeResourceMemoryRecall>{
 const db=env.DB,e=await enrollment(env,authority),snapshot=snapshotMemoryDerivationInput(input,256) as ResourceMemorySnapshot;
 if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot))throw Error('resource_snapshot_invalid');
 const captured=await captureResourceRecall(env,e,authority,snapshot);
 if(env.DB!==db)throw Error('resource_recall_changed');const handle=Object.freeze({}) as NativeResourceMemoryRecall;
 recalls.set(handle,{env,db,authority,guards:structuredClone(captured.guards),value:structuredClone(captured.value),snapshot:structuredClone(captured.snapshot)});currentRecall(env,handle);return handle;
}
export function nativeResourceMemoryRecallInputs(env:WorkerEnv,handle:NativeResourceMemoryRecall){return structuredClone(currentRecall(env,handle).value);}
export function nativeResourceMemoryRecallGuards(env:WorkerEnv,handle:NativeResourceMemoryRecall){return structuredClone(currentRecall(env,handle).guards);}
export function nativeResourceMemoryRecallStatements(env:WorkerEnv,handle:NativeResourceMemoryRecall){return nativeResourceMemoryRecallGuards(env,handle).map(g=>derivationAssertion(env,g));}
export async function replayNativeResourceMemoryRecall(env:WorkerEnv,handle:NativeResourceMemoryRecall){
 try{const c=currentRecall(env,handle),proof=nativeResourceMemoryRecallStatements(env,handle),frames=await c.db.batch(proof);currentRecall(env,handle);
  if(derivationResults(frames,proof.length)&&frames.every(derivationVerified))return true;
 }catch{/* A denied or uncertain native replay cannot be retried as authority. */}
 recalls.delete(handle);return false;
}
/** No private prose or linked-document hydration. These are actor actions, not
 * independent evidence of preferences. Historical AND current block placement
 * must match; seeing a Canvas link never authorizes its destination. */
function sourceQuery(e:MemoryResourceEnrollment){
 const placement=(at:string)=>`EXISTS(SELECT 1 FROM events place WHERE place.stream_id=event.stream_id AND place.sequence=(SELECT MAX(p.sequence) FROM events p
  WHERE p.stream_id=event.stream_id AND p.sequence<=${at} AND p.type IN('BlockCreated','BlockRehomed') AND json_extract(p.payload,'$.block_id')=json_extract(event.payload,'$.block_id'))
  AND json_extract(place.payload,'$.project_id')=? AND json_extract(place.payload,'$.scope')=?
  AND ${e.resource_kind==='canvas'?"json_extract(place.payload,'$.canvas_id')=?":"COALESCE(json_extract(place.payload,'$.document_id'),'')='' AND COALESCE(json_extract(place.payload,'$.canvas_id'),'')=''"})`;
 const placeBindings=[e.project_id,e.resource_kind,...(e.resource_kind==='canvas'?[e.resource_id]:[])];
 const resource=e.organization_id?`EXISTS(SELECT 1 FROM project_resource_scopes r WHERE r.owner_user_id=? AND r.organization_id=? AND r.project_access_id=? AND r.project_id=?
  AND r.resource_kind='block' AND r.resource_id=json_extract(event.payload,'$.block_id') AND (r.visibility='collaborative_output' OR r.visibility='actor_private' AND r.actor_user_id=?))`:'1';
 const scope=e.resource_kind==='canvas'?`((event.type LIKE 'Canvas%' AND json_extract(event.payload,'$.canvas_id')=?) OR (event.type LIKE 'Block%' AND ${placement('event.sequence')} AND ${placement('9223372036854775807')} AND (${resource})))`
 :`event.type LIKE 'Block%' AND ${placement('event.sequence')} AND ${placement('9223372036854775807')} AND (${resource})`;
 const custody=e.organization_id?`EXISTS(SELECT 1 FROM project_event_scopes custody WHERE custody.event_id=event.event_id AND custody.source_stream_id=event.stream_id AND custody.source_sequence=event.sequence
  AND (custody.organization_id,custody.project_access_id,custody.project_id,custody.owner_user_id,custody.actor_user_id)=(?,?,?,?,?))`:`NOT EXISTS(SELECT 1 FROM project_event_scopes custody WHERE custody.event_id=event.event_id)`;
 const condition=`event.stream_id=? AND (event.actor=?${e.organization_id?'':" OR event.actor='user'"}) AND event.schema_version=1 AND event.type IN(${TYPES})
  AND event.event_id NOT LIKE 'optimistic:%' AND event.client_id NOT LIKE '%optimistic%' AND event.compensates_event_id IS NULL
  AND event.recorded_at>=? AND event.recorded_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND julianday(event.recorded_at)>julianday('now')-?
  AND (json_extract(event.payload,'$.project_id')=? OR event.type LIKE 'Block%' AND json_extract(event.payload,'$.project_id') IS NULL) AND json_extract(event.payload,'$._private_ref')=event.event_id
  AND secret.owner_id=? AND (secret.project_id=? OR event.type LIKE 'Block%' AND secret.project_id IS NULL) AND (event.type NOT LIKE 'Block%' OR secret.document_id IS NULL) AND secret.redacted_at IS NULL AND json_valid(secret.private_json)
  AND COALESCE(json_extract(event.payload,'$.actor_user_id'),?)=? AND COALESCE(json_extract(secret.private_json,'$.actor_user_id'),?)=?
  AND COALESCE(json_extract(event.payload,'$.simulation'),0)=0 AND COALESCE(json_extract(event.payload,'$.synthetic'),0)=0 AND COALESCE(json_extract(event.payload,'$.origin.synthetic'),0)=0
  AND COALESCE(json_extract(secret.private_json,'$.simulation'),0)=0 AND COALESCE(json_extract(secret.private_json,'$.synthetic'),0)=0 AND COALESCE(json_extract(secret.private_json,'$.origin.synthetic'),0)=0
  AND json_extract(event.payload,'$.mock_data_source') IS NULL AND json_extract(event.payload,'$.fictional_user_id') IS NULL AND json_extract(event.payload,'$.replay_session_id') IS NULL
  AND NOT EXISTS(SELECT 1 FROM memory_resource_retired_sources retired WHERE retired.enrollment_id=? AND retired.event_id=event.event_id)
  AND (${scope}) AND (${custody})`;
 return {from:'FROM events event JOIN event_private_payloads secret ON secret.private_event_id=event.event_id',condition,bindings:[`creative:${e.owner_user_id}`,`user:${e.actor_user_id}`,e.enrolled_at,e.retention_days,e.project_id,e.owner_user_id,e.project_id,e.actor_user_id,e.actor_user_id,e.actor_user_id,e.actor_user_id,e.enrollment_id,
  ...(e.resource_kind==='canvas'?[e.resource_id]:[]),...placeBindings,...placeBindings,...(e.organization_id?[e.owner_user_id,e.organization_id,e.project_access_id,e.project_id,e.actor_user_id,e.organization_id,e.project_access_id,e.project_id,e.owner_user_id,e.actor_user_id]:[])]};
}
function purpose(e:MemoryResourceEnrollment,p:'learn'|'recall'):MemorySqlGuard{return {condition:`EXISTS(SELECT 1 FROM memory_resource_enrollments WHERE enrollment_id=? AND ${p}_enabled=1 AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,bindings:[e.enrollment_id]};}
async function enrollment(env:WorkerEnv,handle:NativeMemoryResourceAuthority){
 const db=env.DB,s=nativeMemoryResourceScopeInputs(env,handle),found=await db.prepare('SELECT * FROM memory_resource_enrollments WHERE actor_user_id=? AND resource_key=? LIMIT 2').bind(s.identity.actorUserId,s.identity.resourceKey).all<MemoryResourceEnrollment>();
 if(env.DB!==db||!derivationResults([found],1)||found.results.length!==1||!derivationExact(found.results[0],resourceEnrollmentColumns)||found.results[0]!.permission_epoch!==s.permissionEpoch)throw Error('resource_consent_required');return found.results[0]!;
}
/** Each page commits its sources and cursor together. No paid dispatch, lease
 * recovery, retry purchase or historical backfill. An uncertain ack may have
 * committed; a later fresh capture resumes from the actual durable cursor. */
export async function processResourceMemory(env:WorkerEnv,e:MemoryResourceEnrollment,handle:NativeMemoryResourceAuthority){
 const db=env.DB,s=nativeMemoryResourceScopeInputs(env,handle);if(s.identity.resourceKey!==e.resource_key||s.identity.actorUserId!==e.actor_user_id||s.permissionEpoch!==e.permission_epoch)throw Error('resource_capture_scope');
 const schema=await memoryResourceSchema(env),guards=[schema,...nativeMemoryResourceScopeGuards(env,handle),memoryResourceEnrollmentGuard(e),purpose(e,'learn')];
 const q=sourceQuery(e),descriptor={sql:`SELECT event.event_id,event.sequence,event.type,event.recorded_at ${q.from} WHERE ${q.condition} AND event.sequence>? AND event.sequence<=? ORDER BY event.sequence LIMIT 65`,bindings:[...q.bindings,e.cursor_sequence,s.sourceHead]};
 const read=db.prepare(descriptor.sql).bind(...descriptor.bindings),frames=structuredClone(await db.batch<Record<string,unknown>>([...guards.map(g=>derivationAssertion(env,g)),read]));
 if(env.DB!==db||!derivationResults(frames,guards.length+1)||!frames.slice(0,guards.length).every(derivationVerified))throw Error('resource_capture_read');
 const result=frames.at(-1)!,rows=result.results as unknown as Source[];if(rows.length>65||rows.some((r,i)=>!derivationExact(r,sourceColumns)||!Object.hasOwn(actions,r.type)||!Number.isSafeInteger(r.sequence)||r.sequence<=(i?rows[i-1]!.sequence:e.cursor_sequence)||r.sequence>s.sourceHead||!Number.isFinite(Date.parse(r.recorded_at))))throw Error('resource_capture_rows');
 const witness=new AssistantContextReadWitness<null>(env);witness.observe([read],[result],[descriptor]);witness.before(s.validUntil);witness.seal(null);
 const page=rows.slice(0,64),through=rows.length>64?page.at(-1)!.sequence:s.sourceHead,now=new Date().toISOString();
 const next=rows.length>64?new Date(Date.now()+60000).toISOString():nextResourceMemoryNight(now,e.time_zone),day=new Intl.DateTimeFormat('en-CA',{timeZone:e.time_zone,year:'numeric',month:'2-digit',day:'2-digit'}).format();
 const statements=[...guards,...witness.precommitGuards().map(g=>({condition:g.sql,bindings:g.bindings}))].map(g=>derivationAssertion(env,g)),proofCount=statements.length;
 // One bounded JSON insert respects SQLite/D1 bind and statement limits.
 statements.push(db.prepare(`INSERT INTO memory_resource_history(enrollment_id,event_id,sequence,event_type,action,recorded_at,expires_at)
  SELECT ?,json_extract(value,'$.event_id'),json_extract(value,'$.sequence'),json_extract(value,'$.type'),json_extract(value,'$.action'),json_extract(value,'$.recorded_at'),json_extract(value,'$.expires_at') FROM json_each(?)`).bind(e.enrollment_id,JSON.stringify(page.map(r=>({...r,action:actions[r.type],expires_at:new Date(Math.min(Date.parse(e.expires_at),Date.parse(r.recorded_at)+e.retention_days*86400000)).toISOString()})))));
 statements.push(derivationAssertion(env,{condition:'changes()=?',bindings:[page.length]}));
 statements.push(db.prepare('UPDATE memory_resource_enrollments SET cursor_sequence=?,next_due_at=?,last_local_day=? WHERE enrollment_id=? AND revision=? AND cursor_sequence=?').bind(through,next,day,e.enrollment_id,e.revision,e.cursor_sequence));
 statements.push(derivationAssertion(env,{condition:'changes()=1',bindings:[]}));
 statements.push(db.prepare(`DELETE FROM memory_resource_history WHERE enrollment_id=? AND (expires_at<=? OR event_id NOT IN(SELECT event_id FROM memory_resource_history WHERE enrollment_id=? ORDER BY sequence DESC LIMIT 2048))`).bind(e.enrollment_id,now,e.enrollment_id));
 statements.push(db.prepare('DELETE FROM memory_resource_retired_sources WHERE enrollment_id=? AND event_id IN(SELECT event_id FROM events WHERE stream_id=? AND sequence<=?)').bind(e.enrollment_id,'creative:'+e.owner_user_id,through));
 nativeMemoryResourceScopeInputs(env,handle);const checked=await db.batch(statements);
 if(env.DB!==db||!derivationResults(checked,statements.length)||!checked.slice(0,proofCount).every(derivationVerified)||!derivationVerified(checked[proofCount+1]!)||!derivationVerified(checked[proofCount+3]!))throw Error('resource_capture_unconfirmed');
 nativeMemoryResourceScopeInputs(env,handle);return {captured:page.length,throughSequence:through,more:rows.length>64};
}
async function captureResourceRecall(env:WorkerEnv,e:MemoryResourceEnrollment,handle:NativeMemoryResourceAuthority,snapshot?:ResourceMemorySnapshot){
 const db=env.DB,s=nativeMemoryResourceScopeInputs(env,handle),schema=await memoryResourceSchema(env),guards=[schema,...nativeMemoryResourceScopeGuards(env,handle),memoryResourceEnrollmentGuard(e),purpose(e,'recall')],q=sourceQuery(e);
 if(snapshot){
  const time=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
  if(!derivationExact(snapshot,['version','resourceKey','enrollmentId','revision','asOf','expiresAt','throughSequence','sourceHead','sourceLimitReached','openingLimitReached','openingsAvailable','sources','openings'])
   ||snapshot.version!==1||snapshot.resourceKey!==s.identity.resourceKey||snapshot.enrollmentId!==e.enrollment_id||snapshot.revision!==e.revision
   ||!time(snapshot.asOf)||Date.parse(snapshot.asOf)>Date.now()||snapshot.asOf<e.enrolled_at||!time(snapshot.expiresAt)||Date.parse(snapshot.expiresAt)<=Date.now()||snapshot.expiresAt>e.expires_at
   ||!Number.isSafeInteger(snapshot.throughSequence)||snapshot.throughSequence<e.source_after_sequence||snapshot.throughSequence>e.cursor_sequence
   ||!Number.isSafeInteger(snapshot.sourceHead)||snapshot.sourceHead<snapshot.throughSequence||snapshot.sourceHead>s.sourceHead
   ||typeof snapshot.sourceLimitReached!=='boolean'||typeof snapshot.openingLimitReached!=='boolean'||snapshot.openingsAvailable!==schema.openings
   ||!Array.isArray(snapshot.sources)||snapshot.sources.length>256||!Array.isArray(snapshot.openings)||snapshot.openings.length>256
   ||new TextEncoder().encode(JSON.stringify(snapshot)).byteLength>196608)throw Error('resource_snapshot_invalid');
  for(const row of snapshot.sources)if(!derivationExact(row,sourceColumns)||typeof row.event_id!=='string'||row.event_id.length<1||row.event_id.length>240||!Number.isSafeInteger(row.sequence)||row.sequence<=e.source_after_sequence||row.sequence>snapshot.throughSequence
   ||!Object.hasOwn(actions,row.type)||!time(row.recorded_at)||row.recorded_at>snapshot.asOf||row.recorded_at<e.enrolled_at)throw Error('resource_snapshot_invalid');
  for(const row of snapshot.openings)if(!derivationExact(row,['opening_id','source_head','recorded_at','expires_at'])||typeof row.opening_id!=='string'||!/^[a-f0-9-]{36}$/u.test(row.opening_id)
   ||!Number.isSafeInteger(row.source_head)||row.source_head<e.source_after_sequence||row.source_head>snapshot.sourceHead||!time(row.recorded_at)||row.recorded_at>snapshot.asOf||row.recorded_at<e.enrolled_at
   ||!time(row.expires_at)||row.expires_at<snapshot.expiresAt)throw Error('resource_snapshot_invalid');
  if(new Set(snapshot.sources.map(row=>row.event_id)).size!==snapshot.sources.length||new Set(snapshot.openings.map(row=>row.opening_id)).size!==snapshot.openings.length)throw Error('resource_snapshot_invalid');
 }
 const descriptor={sql:`SELECT event.event_id,event.sequence,event.type,event.recorded_at ${q.from} JOIN memory_resource_history history ON history.event_id=event.event_id AND history.enrollment_id=?
  WHERE ${q.condition} AND history.sequence=event.sequence AND history.event_type=event.type AND history.recorded_at=event.recorded_at AND history.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') ${snapshot?'AND event.event_id IN(SELECT value FROM json_each(?))':''} ORDER BY event.sequence DESC LIMIT 257`,bindings:[e.enrollment_id,...q.bindings,...(snapshot?[JSON.stringify(snapshot.sources.map(row=>row.event_id))]:[])]};
 const openingDescriptor={sql:`SELECT opening_id,source_head,recorded_at,expires_at FROM memory_resource_openings WHERE enrollment_id=? AND enrollment_revision=? AND recorded_at>=? AND recorded_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND source_head>=? AND source_head<=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') ${snapshot?'AND opening_id IN(SELECT value FROM json_each(?))':''} ORDER BY recorded_at DESC,opening_id DESC LIMIT 257`,bindings:[e.enrollment_id,e.revision,e.enrolled_at,e.source_after_sequence,s.sourceHead,...(snapshot?[JSON.stringify(snapshot.openings.map(row=>row.opening_id))]:[])]};
 const openingRead=schema.openings?db.prepare(openingDescriptor.sql).bind(...openingDescriptor.bindings):null;
 const read=db.prepare(descriptor.sql).bind(...descriptor.bindings),frames=structuredClone(await db.batch<Record<string,unknown>>([...guards.map(g=>derivationAssertion(env,g)),read,...(openingRead?[openingRead]:[])]));
 if(env.DB!==db||!derivationResults(frames,guards.length+1+(openingRead?1:0))||!frames.slice(0,guards.length).every(derivationVerified))throw Error('resource_recall_read');
 const result=frames[guards.length]!,rows=result.results as unknown as Source[];if(rows.length>257||rows.some(r=>!derivationExact(r,sourceColumns)||!Object.hasOwn(actions,r.type)))throw Error('resource_recall_rows');
 const openingResult=openingRead?frames[guards.length+1]!:null,openingRows=openingResult?.results??[];
 if(openingRows.length>257||openingRows.some(r=>!derivationExact(r,['opening_id','source_head','recorded_at','expires_at'])||typeof r.opening_id!=='string'||r.opening_id.length!==36||!Number.isSafeInteger(r.source_head)||typeof r.recorded_at!=='string'||!Number.isFinite(Date.parse(r.recorded_at))||typeof r.expires_at!=='string'||!Number.isFinite(Date.parse(r.expires_at))))throw Error('resource_opening_rows');
 const openings=openingRows.slice(0,256) as ResourceMemorySnapshot['openings'];
 if(snapshot&&(memoryCanonical(rows)!==memoryCanonical(snapshot.sources)||memoryCanonical(openings)!==memoryCanonical(snapshot.openings)))throw Error('resource_snapshot_source_changed');
 const witness=new AssistantContextReadWitness<null>(env);witness.observe([read],[result],[descriptor]);
 if(openingRead&&openingResult)witness.observe([openingRead],[openingResult],[openingDescriptor]);
 witness.before(s.validUntil);witness.seal(null);
 const sourceGuards=[...guards,...witness.precommitGuards().map(g=>({condition:g.sql,bindings:g.bindings}))];
 const proof=sourceGuards.map(g=>derivationAssertion(env,g));
 const checked=await db.batch(proof);if(env.DB!==db||!derivationResults(checked,proof.length)||!checked.every(derivationVerified))throw Error('resource_recall_changed');nativeMemoryResourceScopeInputs(env,handle);
 const sources=rows.slice(0,256),at=snapshot?Date.parse(snapshot.asOf):Date.now();
 const retentionUntil=new Date(Math.min(Date.parse(e.expires_at),...sources.map(r=>Date.parse(r.recorded_at)+e.retention_days*86400000),...openings.map(r=>Date.parse(r.expires_at)))).toISOString();
 if(snapshot&&snapshot.expiresAt>retentionUntil)throw Error('resource_snapshot_retention_changed');
 const frozen:ResourceMemorySnapshot=snapshot??{version:1,resourceKey:s.identity.resourceKey,enrollmentId:e.enrollment_id,revision:e.revision,asOf:new Date(at).toISOString(),expiresAt:retentionUntil,
  throughSequence:e.cursor_sequence,sourceHead:s.sourceHead,sourceLimitReached:rows.length>256,openingLimitReached:openingRows.length>256,openingsAvailable:schema.openings,sources:structuredClone(sources),openings:structuredClone(openings)};
 const transitions=[...sources,...openings].flatMap(r=>[7,30].map(days=>Date.parse(String(r.recorded_at))+days*86400000)).filter(time=>time>at);
 const validUntil=new Date(Math.min(Date.parse(s.validUntil),Date.parse(e.expires_at),...sources.map(r=>Date.parse(r.recorded_at)+e.retention_days*86400000),...openings.map(r=>Date.parse(String(r.expires_at))),...(snapshot?[Date.parse(snapshot.expiresAt)]:transitions))).toISOString();
 const value={scope:s.identity,validUntil,...(snapshot?{asOf:snapshot.asOf}:{}),method:'action-counts-not-semantic',independentPreferenceEvidence:false,linkedContentRead:false,
  coverage:{since:e.enrolled_at,throughSequence:frozen.throughSequence,currentHead:frozen.sourceHead,completeFromStart:false,sourceLimit:256,sourceLimitReached:frozen.sourceLimitReached},
  openings:{method:'resource-surface-open-not-content-consumption',limit:256,limitReached:frozen.openingLimitReached,available:frozen.openingsAvailable},
  windows:[7,30].map(days=>({days,resourceOpenings:openings.filter(r=>Date.parse(String(r.recorded_at))>at-days*86400000).length,counts:sources.filter(r=>Date.parse(r.recorded_at)>at-days*86400000).reduce<Record<string,number>>((out,r)=>{const action=actions[r.type];out[action]=(out[action]??0)+1;return out;},{})})),sources:sources.map(r=>({eventId:r.event_id,type:r.type,recordedAt:r.recorded_at}))};
 return {value,snapshot:frozen,guards:[...sourceGuards,{condition:"?>strftime('%Y-%m-%dT%H:%M:%fZ','now')",bindings:[validUntil]}]};
}
export async function handleMemoryResourceHistory(request:Request,env:WorkerEnv){
 const url=new URL(request.url);if(!['GET','POST'].includes(request.method))return reply({error:'method_not_allowed'},405);
 if(request.headers.get('sec-fetch-site')==='cross-site'||request.method==='POST'&&request.headers.get('origin')!==url.origin)return reply({error:'same_origin_required'},403);
 if([...url.searchParams.keys()].some(k=>!['kind','projectId','resourceId'].includes(k)||url.searchParams.getAll(k).length!==1))return reply({error:'resource_scope_required'},400);
 const selector=memoryResourceSelector(Object.fromEntries(url.searchParams));if(!selector)return reply({error:'resource_scope_required'},400);
 try{
  if(request.method==='POST'){const parsed=await readNativeControlBody(request);if(parsed.status!=='parsed'||!derivationExact(parsed.value,['confirmation'])||parsed.value.confirmation!=='REVIEW_RESOURCE_ACTIVITY')return reply({error:'resource_review_required'},400);}
  const handle=await prepareNativeMemoryResourceAuthority(request,env,selector);
  if(request.method==='POST')return reply(await processResourceMemory(env,await enrollment(env,handle),handle));
  const recalled=await prepareNativeResourceMemoryRecall(env,handle),response=reply(nativeResourceMemoryRecallInputs(env,recalled));
  // Serialization can consume the remaining lease. Do not deliver expired
  // private counts, even when the final database read itself was still current.
  nativeResourceMemoryRecallInputs(env,recalled);return response;
 }catch{return reply({error:'resource_history_unavailable',noAutomaticRetry:true},503);}
}
export async function runResourceMemoryScheduled(env:WorkerEnv){
 if(env.FORMA_MEMORY_SCHEDULING_ENABLED!=='true')return {status:'scheduling-disabled'};
 const db=env.DB,present=await db.prepare(`SELECT name FROM sqlite_schema WHERE ${memoryResourceSchemaFamily} LIMIT 1`).all();if(env.DB!==db||!derivationResults([present],1))throw Error('resource_schema_inventory');if(!present.results.length)return {status:'schema-unavailable'};
 const schema=await memoryResourceSchema(env),frames=await db.batch([derivationAssertion(env,schema),db.prepare("SELECT * FROM memory_resource_enrollments WHERE background_enabled=1 AND learn_enabled=1 AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND next_due_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') ORDER BY next_due_at,enrollment_id LIMIT 1")]);
 if(env.DB!==db||!derivationResults(frames,2)||!derivationVerified(frames[0]!)||frames[1]!.results.length>1)throw Error('resource_schedule_inventory');
 const e=frames[1]!.results[0] as MemoryResourceEnrollment|undefined;if(!e)return {status:'idle'};if(!derivationExact(e,resourceEnrollmentColumns))throw Error('resource_schedule_row');
 try{const handle=await prepareScheduledResourceAuthority(env,e);return {status:'completed',...await processResourceMemory(env,e,handle)};}
 catch(error){
  // Source-free backoff cannot change consent or cursor. A stale denied scope
  // must not permanently starve other enrollments; uncertain committed pages
  // fail this exact old-row guard and are left untouched.
  try{const old=memoryResourceEnrollmentGuard(e);await db.batch([derivationAssertion(env,schema),derivationAssertion(env,old),db.prepare('UPDATE memory_resource_enrollments SET next_due_at=? WHERE enrollment_id=?').bind(new Date(Date.now()+3600000).toISOString(),e.enrollment_id)]);}catch{/* Preserve the original failure, never retry capture here. */}
  throw error;
 }
}
/** Privacy expiry is independent of rollout/scheduling flags, source-free and
 * bounded. Missing optional schema is handled by the maintenance caller. */
export async function sweepResourceMemory(env:WorkerEnv){
 const db=env.DB,present=await db.prepare(`SELECT name FROM sqlite_schema WHERE ${memoryResourceSchemaFamily} LIMIT 1`).all();if(!derivationResults([present],1))throw Error('resource_schema_inventory');if(!present.results.length)return;
 const schema=await memoryResourceSchema(env),checked=await db.batch([derivationAssertion(env,schema),db.prepare("DELETE FROM memory_resource_enrollments WHERE enrollment_id IN(SELECT enrollment_id FROM memory_resource_enrollments WHERE expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') LIMIT 64)"),db.prepare("DELETE FROM memory_resource_history WHERE rowid IN(SELECT rowid FROM memory_resource_history WHERE expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') LIMIT 256)"),...(schema.openings?[db.prepare("DELETE FROM memory_resource_openings WHERE rowid IN(SELECT rowid FROM memory_resource_openings WHERE expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') LIMIT 256)")]:[])]);
 if(env.DB!==db||!derivationResults(checked,schema.openings?4:3)||!derivationVerified(checked[0]!))throw Error('resource_expiry_unconfirmed');
}

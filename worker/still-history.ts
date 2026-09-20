import {appendOnlyHistory,historyCounts,historyStoreKey,loadHistorySnapshot,saveHistorySnapshot,discardHistorySnapshot,type PreparedHistory} from './still-history-store.ts';
import { createHistoryCollector, installHistorySummary, historySummary } from '../src/still/history.ts';
import { readProjectEventPage } from './project-access.ts';
import type { ProjectRequestContext } from './project-request-context.ts';
import type { CreativeEvent, CreativeProjection } from '../src/model/events.ts';
import { foldEvents } from '../src/model/events.ts';
import { readStillHistoryPage, readStillFocusedHistory, STILL_REPLAY_TYPES } from './still-history-read.ts';
import { streamHead } from './event-stream-read.ts';
import type { PilotUser } from './pilot-policy.ts';
import type { WorkerEnv } from './runtime.ts';
import { captureSceneSourceVersion, sceneSourceSchemaAssertion } from './scene-source-generation.ts';

// These are expendable read accelerators, never creative storage or authority.
// Shared snapshots recheck canonical resource/retention allowlists and rebuild
// on any head change; certified personal revisions validate exact reuse.
type Snapshot={events:CreativeEvent[];head:number;expires:number;projections:Map<string,CreativeProjection>;prepared?:PreparedHistory};
const stores=new WeakMap<object,Map<string,Snapshot>>();
const maxBytes=16_000_000,ttl=300_000;
const weights=new WeakMap<Snapshot,number>();
export type HistoryReceipt={source:'snapshot'|'persistent-snapshot'|'incremental'|'fresh'|'shared'|'shared-snapshot';eventsRead:number;head:number;elapsedMs:number;readPages?:number;readMs?:number;cacheReadMs?:number;cacheWriteMs?:number;focusedReadMs?:number;focusedEventsRead?:number;persisted?:boolean};
// Older schemas use a bounded exact hash, never an all-history payload array.
async function witness(env:WorkerEnv,user:PilotUser,head:number){
 let after=0,digest='';
 for(;;){
  const page=await env.DB.prepare(`SELECT event.event_id,event.sequence,event.type,
    CASE WHEN length(CAST(event.payload AS BLOB))<=1048576 THEN event.payload END AS payload,
    secret.private_event_id,secret.redacted_at,
    CASE WHEN length(CAST(secret.private_json AS BLOB))<=1048576 THEN secret.private_json END AS private_json,
    (length(CAST(event.payload AS BLOB))>1048576 OR COALESCE(length(CAST(secret.private_json AS BLOB)),0)>1048576) AS oversized
   FROM events event LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id
   WHERE event.stream_id=? AND event.sequence>? AND event.sequence<=? ORDER BY event.sequence LIMIT 8`).bind(user.streamId,after,head).all<Record<string,unknown>>();
  if(!page.results.length)break;
  if(page.results.some(r=>r.oversized))throw new Error('history_event_too_large');
  digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(digest+JSON.stringify(page.results)))),b=>b.toString(16).padStart(2,'0')).join('');
  after=Number(page.results.at(-1)!.sequence);if(page.results.length<8)break;
 }
 return digest;
}
const witnesses=new WeakMap<Snapshot,string>();
/** Existing transactional triggers cover appends, private-body edits/withdrawals
 * and rebuild epochs. No authored rows or cached authority are introduced. */
export async function sourceVersion(env:WorkerEnv,user:PilotUser,activate=true):Promise<string|null>{
  try{
    const guard=sceneSourceSchemaAssertion();
    const row=await env.DB.prepare(`SELECT (${guard.sql}) AS valid,
      (SELECT instance_nonce FROM scene_source_epoch WHERE singleton=1) AS nonce,
      (SELECT generation FROM scene_source_epoch WHERE singleton=1) AS epoch,
      COALESCE((SELECT generation FROM scene_source_generations WHERE scope_kind='stream' AND scope_key=?),0) AS generation,
      (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?) AS head`)
      .bind(...guard.bindings??[],user.streamId,user.streamId).first<{valid:number;nonce:string|null;epoch:number;generation:number;head:number}>();
    if(row?.valid!==1)return null;
    if(!row.nonce&&activate){await captureSceneSourceVersion(env,{streamId:user.streamId});return sourceVersion(env,user,false);}
    if(!row.nonce||![row.epoch,row.generation,row.head].every(n=>Number.isSafeInteger(n)&&n>=0&&n<Number.MAX_SAFE_INTEGER))return null;
    return JSON.stringify([row.nonce,row.epoch,row.generation,row.head]);
  }catch{return null;} // Older/missing schema uses the original full witness.
}
export async function readStillHistory(request:Request,env:WorkerEnv,user:PilotUser,scope:string,shared:ProjectRequestContext|undefined,position:{documentId?:string;blockId?:string;outputId?:string}={}){
  if(shared)scope+=JSON.stringify([position.documentId,position.blockId,position.outputId]);
  const started=Date.now();let store=stores.get(env.DB);if(!store){store=new Map();stores.set(env.DB,store);}
  const old=store.get(scope);
  if(shared){
    const probe=await readProjectEventPage(env,shared,old?.head??0,5000,false,undefined,undefined,undefined,true);
    if(old&&old.expires>Date.now()&&probe.head===old.head&&probe.snapshotWitness===witnesses.get(old))return result(old,{source:'shared-snapshot',eventsRead:0,head:old.head,elapsedMs:Date.now()-started});
    let page=old?await readProjectEventPage(env,shared,0,5000,false,undefined,undefined,undefined,true):probe;
    const proof=page.snapshotWitness,target=page.head,events:CreativeEvent[]=[];
    for(;;){events.push(...page.events.filter(e=>e.sequence<=target));if(!page.hasMore||page.nextAfter>=target)break;if(events.length>150_000)throw new Error('History too large.');page=await readProjectEventPage(env,shared,page.nextAfter,5000,false,undefined,undefined,undefined,true);if(page.snapshotWitness!==proof)throw new Error('History changed. Try again.');}
    const snapshot:Snapshot={events,head:target,expires:Date.now()+ttl,projections:new Map()};
    witnesses.set(snapshot,proof!);remember(store,scope,snapshot);
    return result(snapshot,{source:'shared',eventsRead:events.length,head:target,elapsedMs:Date.now()-started});
  }
  const version=await sourceVersion(env,user),key=await historyStoreKey(user.userId,user.streamId,scope);
  const cacheStarted=Date.now();
  let prepared=version?(old&&old.expires>Date.now()?old.prepared:undefined)??await loadHistorySnapshot(env,key,user.userId):undefined;
  const cacheReadMs=Date.now()-cacheStarted;
  let source:HistoryReceipt['source']=prepared===old?.prepared?'snapshot':'persistent-snapshot';
  let counts:Awaited<ReturnType<typeof historyCounts>>=null;
  if(prepared&&prepared.version!==version){
    counts=await historyCounts(env,user.streamId,prepared.head);
    if(version&&appendOnlyHistory(prepared,version,counts))source='incremental';
    else{prepared=undefined;store.delete(scope);await discardHistorySnapshot(env,key,user.userId);}
  }
  const target=version?Number(JSON.parse(version)[3]):await streamHead(env,user.streamId);
  const before=version??await witness(env,user,target);
  let eventsRead=0,readPages=0,readMs=0,cacheWriteMs=0,persisted=source==='persistent-snapshot';
  let snapshot:Snapshot;
  if(prepared&&prepared.version===version){
    snapshot=old?.prepared===prepared?old:{events:prepared.events,head:target,expires:Date.now()+ttl,projections:new Map(),prepared};
  }else{
    source=prepared?'incremental':'fresh';
    const events:CreativeEvent[]=prepared?[...prepared.events]:[],collector=createHistoryCollector(version?{}:position,prepared?.checkpoint),replayTypes=new Set<string>(STILL_REPLAY_TYPES);
    let after=prepared?.head??0,bytes=events.reduce((n,e)=>n+JSON.stringify(e).length*2+256,0);
    for(;;){
      const at=Date.now(),page=await readStillHistoryPage(env,user.streamId,after,target);readMs+=Date.now()-at;readPages++;
      if(!page.length)break;
      for(const event of page){
        eventsRead++;
        if(!replayTypes.has(event.type))event.payload=Object.fromEntries(Object.entries(event.payload).filter(([,v])=>v!==null));
        collector.accept(event);
        if(replayTypes.has(event.type)){
          bytes+=JSON.stringify(event).length*2+256;
          if(bytes>16_000_000)throw new Error('history_capacity');
          events.push(event);
        }
        if(eventsRead+(prepared?.checkpoint.accessibleEvents??0)>150_000)throw new Error('history_capacity');
      }
      after=page.at(-1)!.sequence;if(after>=target)break;
    }
    counts??=await historyCounts(env,user.streamId,prepared?.head??0);
    const afterProof=version?await sourceVersion(env,user,false):await witness(env,user,target);
    if(afterProof!==before){store.delete(scope);await discardHistorySnapshot(env,key,user.userId);throw new Error('History changed. Try again.');}
    prepared=version&&counts?{version,head:target,privateCount:counts.privateBodies,events,checkpoint:collector.checkpoint()}:undefined;
    snapshot={events,head:target,expires:Date.now()+ttl,projections:new Map(),prepared};
    weights.set(snapshot,bytes+500_000);
    // The legacy uncertified path remains usable but cannot persist or increment.
    if(!prepared)installHistorySummary(events,collector.finish());
    if(prepared){const at=Date.now();persisted=await saveHistorySnapshot(env,key,user.userId,prepared);cacheWriteMs=Date.now()-at;}
  }
  const focusedStarted=Date.now(),focused=version?await readStillFocusedHistory(env,user.streamId,target,position):[],focusedReadMs=Date.now()-focusedStarted;
  if(version&&await sourceVersion(env,user,false)!==version){store.delete(scope);await discardHistorySnapshot(env,key,user.userId);throw new Error('History changed. Try again.');}
  remember(store,scope,snapshot);
  // Each request owns its evidence array: concurrent selections must not replace
  // one another's summary in the WeakMap used by the decision builder.
  const events=[...snapshot.events];
  const summary=snapshot.prepared?createHistoryCollector({},snapshot.prepared.checkpoint).finish():historySummary(snapshot.events)!;
  summary.useful=[...new Map([...summary.useful,...focused.filter(e=>!e.type.startsWith('Attention')||e.sequence>summary.forgotten)].map(e=>[e.sequence,e])).values()].sort((a,b)=>a.sequence-b.sequence);
  installHistorySummary(events,summary);
  return {...result(snapshot,{source,eventsRead,head:target,elapsedMs:Date.now()-started,readPages,readMs,cacheReadMs,cacheWriteMs,focusedReadMs,focusedEventsRead:focused.length,persisted}),events};
}
function remember(store:Map<string,Snapshot>,scope:string,snapshot:Snapshot){
 store.delete(scope);
 const bytes=weights.get(snapshot)??snapshot.events.reduce((n,event)=>n+JSON.stringify(event).length*2+256,0);weights.set(snapshot,bytes);
 if(bytes<=maxBytes)store.set(scope,snapshot);
 const total=()=>[...store.values()].reduce((n,s)=>n+(weights.get(s)??0),0);
 while(store.size>8||total()>maxBytes)store.delete(store.keys().next().value!);
}
function result(snapshot:Snapshot,receipt:HistoryReceipt){
  return {events:snapshot.events,head:snapshot.head,receipt,
    projection(documentId:string,projectId:string){const key=JSON.stringify([documentId,projectId]);let p=snapshot.projections.get(key);if(!p){p=foldEvents(snapshot.events,Infinity,documentId,projectId);snapshot.projections.set(key,p);while(snapshot.projections.size>2)snapshot.projections.delete(snapshot.projections.keys().next().value!);}return p;}};
}

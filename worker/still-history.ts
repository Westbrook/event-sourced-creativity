import { preparedHistory } from '../src/still/history.ts';
import { readProjectEventPage } from './project-access.ts';
import type { ProjectRequestContext } from './project-request-context.ts';
import type { CreativeEvent, CreativeProjection } from '../src/model/events.ts';
import { foldEvents } from '../src/model/events.ts';
import { handleEvents } from './events-api.ts';
import type { PilotUser } from './pilot-policy.ts';
import type { WorkerEnv } from './runtime.ts';

// These are expendable read accelerators, never creative storage or authority.
// Shared snapshots recheck canonical resource/retention allowlists and rebuild
// on any head change; personal append-only streams can consume an incremental tail.
type Snapshot={events:CreativeEvent[];head:number;expires:number;projections:Map<string,CreativeProjection>};
const stores=new WeakMap<object,Map<string,Snapshot>>();
const maxBytes=6_000_000,ttl=300_000;
const weights=new WeakMap<Snapshot,number>();
export type HistoryReceipt={source:'snapshot'|'incremental'|'fresh'|'shared'|'shared-snapshot';eventsRead:number;head:number;elapsedMs:number};
async function witness(env:WorkerEnv,user:PilotUser,head:number){
  // Events are append-only. Private payloads may be withdrawn without an append:
  // compare their exact identities/redaction markers, not merely the event head.
  const rows=await env.DB.prepare(`SELECT event.event_id,event.sequence,secret.private_event_id,secret.redacted_at
    FROM events event LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id
    WHERE event.stream_id=? AND event.sequence<=? ORDER BY event.sequence`).bind(user.streamId,head).all();
  return rows.results as Array<{event_id:string;sequence:number;private_event_id:string|null;redacted_at:string|null}>;
}
const witnesses=new WeakMap<Snapshot,string>();
export async function readStillHistory(request:Request,env:WorkerEnv,user:PilotUser,scope:string,shared:ProjectRequestContext|undefined){
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
  const before=await witness(env,user,Number.MAX_SAFE_INTEGER);
  const valid=old&&old.expires>Date.now()&&JSON.stringify(before.filter(r=>r.sequence<=old.head))===witnesses.get(old);
  let events=valid?old.events.slice():[],after=valid?old.head:0,target:number|undefined=before.at(-1)?.sequence??0,eventsRead=0;
  for(;;){
    const response=await handleEvents(new Request(new URL(`/api/events?after=${after}&limit=5000&content=0`,request.url),{headers:request.headers}),env,false,user);
    if(!response.ok)throw response;
    const page=await response.json() as {events:CreativeEvent[];head:number;hasMore:boolean;nextAfter:number};target??=page.head;
    if(target<after)throw new Error('History changed. Try again.');
    const tail=page.events.filter(e=>e.sequence<=target!);events.push(...tail);eventsRead+=tail.length;
    if(!page.hasMore||page.nextAfter>=target)break;
    if(page.nextAfter<=after||events.length>150_000)throw new Error('History could not be verified.');after=page.nextAfter;
  }
  if(!shared&&JSON.stringify(await witness(env,user,target!))!==JSON.stringify(before)){store.delete(scope);throw new Error('History changed. Try again.');}
  const snapshot:Snapshot=valid&&eventsRead===0?old:{events,head:target!,expires:Date.now()+ttl,projections:new Map()};
  preparedHistory(snapshot.events,valid?old.events:undefined);
  // Verify the cached prefix against its withdrawal witness on every reuse.
  if(!shared){
    const proof=JSON.stringify(before);
    if(valid&&eventsRead===0&&proof!==witnesses.get(old)){store.delete(scope);throw new Error('History changed. Try again.');}
    witnesses.set(snapshot,proof);remember(store,scope,snapshot);
  }
  return result(snapshot,{source:valid?eventsRead?'incremental':'snapshot':'fresh',eventsRead,head:snapshot.head,elapsedMs:Date.now()-started});
}
function remember(store:Map<string,Snapshot>,scope:string,snapshot:Snapshot){
 store.delete(scope);
 const bytes=weights.get(snapshot)??new TextEncoder().encode(JSON.stringify(snapshot.events)+(witnesses.get(snapshot)??'')).length;weights.set(snapshot,bytes);
 if(bytes<=maxBytes)store.set(scope,snapshot);
 const total=()=>[...store.values()].reduce((n,s)=>n+(weights.get(s)??0),0);
 while(store.size>8||total()>maxBytes)store.delete(store.keys().next().value!);
}
function result(snapshot:Snapshot,receipt:HistoryReceipt){
  return {events:snapshot.events,head:snapshot.head,receipt,
    projection(documentId:string,projectId:string){const key=JSON.stringify([documentId,projectId]);let p=snapshot.projections.get(key);if(!p){p=foldEvents(snapshot.events,Infinity,documentId,projectId);snapshot.projections.set(key,p);while(snapshot.projections.size>2)snapshot.projections.delete(snapshot.projections.keys().next().value!);}return p;}};
}

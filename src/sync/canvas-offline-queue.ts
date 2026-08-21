import type { EventInput } from "../model/events";

export type QueuedCanvasBatch = {
  id: string;
  events: EventInput[];
  createdAt: string;
  actionSequence: number;
  bytes: number;
};

type LegacyQueuedCanvasEvent = { id: string; event: EventInput; createdAt: string; bytes: number };

const DATABASE="canvas-offline-queue-v1";
const STORE="events";
let nextActionSequence=Date.now()*1_000;

const actionSequence=()=>{nextActionSequence=Math.max(nextActionSequence+1,Date.now()*1_000);return nextActionSequence;};
const openDatabase=()=>new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open(DATABASE,2);request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE,{keyPath:"id"});};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
const transact=async<T>(mode:IDBTransactionMode,run:(store:IDBObjectStore,resolve:(value:T)=>void,reject:(reason?:unknown)=>void)=>void)=>{const database=await openDatabase();return new Promise<T>((resolve,reject)=>{const transaction=database.transaction(STORE,mode);run(transaction.objectStore(STORE),resolve,reject);transaction.oncomplete=()=>database.close();transaction.onerror=()=>reject(transaction.error);});};
const normalizeBatch=(value:QueuedCanvasBatch|LegacyQueuedCanvasEvent,index=0):QueuedCanvasBatch=>{
  if("events" in value)return{...value,events:value.events.map((event)=>({...event,payload:{...event.payload}}))};
  const createdAt=value.createdAt||new Date().toISOString();
  return{id:`legacy:${value.id}`,events:[value.event],createdAt,actionSequence:(Date.parse(createdAt)||0)*1_000+index,bytes:value.bytes||new Blob([JSON.stringify(value.event)]).size};
};

/** A device-local write-ahead log. One user action is one ordered record. */
export class CanvasOfflineQueue {
  async enqueueBatch(events:EventInput[]){
    const sequence=actionSequence(),id=String(events[0]?.payload.history_action_id??crypto.randomUUID());
    const prepared=events.map((event,index)=>({...event,payload:{...event.payload,client_event_id:String(event.payload.client_event_id??crypto.randomUUID()),client_action_sequence:sequence,client_batch_index:index}}));
    const value:QueuedCanvasBatch={id,events:prepared,createdAt:new Date().toISOString(),actionSequence:sequence,bytes:new Blob([JSON.stringify(prepared)]).size};
    await transact<void>("readwrite",(store,resolve,reject)=>{const request=store.put(value);request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error);});return value;
  }
  async enqueue(event:EventInput){return this.enqueueBatch([event]);}
  async listBatches(){return transact<QueuedCanvasBatch[]>("readonly",(store,resolve,reject)=>{const request=store.getAll();request.onsuccess=()=>resolve((request.result as Array<QueuedCanvasBatch|LegacyQueuedCanvasEvent>).map(normalizeBatch).sort((a,b)=>a.actionSequence-b.actionSequence||a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id)));request.onerror=()=>reject(request.error);});}
  async list(){return this.listBatches();}
  async removeBatch(id:string){return transact<void>("readwrite",(store,resolve,reject)=>{const request=store.delete(id.replace(/^legacy:/,""));request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error);});}
  async remove(id:string){return this.removeBatch(id);}
  async summary(){const batches=await this.listBatches();const count=batches.reduce((total,batch)=>total+batch.events.length,0),bytes=batches.reduce((total,batch)=>total+batch.bytes,0);return{count,batches:batches.length,bytes,warning:count>=8_000||bytes>=40*1024*1024,full:count>=10_000||bytes>=50*1024*1024};}
}

export const canvasOfflineQueue=new CanvasOfflineQueue();

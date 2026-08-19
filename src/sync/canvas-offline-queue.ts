import type { EventInput } from "../model/events";

export type QueuedCanvasEvent = { id: string; event: EventInput; createdAt: string; bytes: number };
const DATABASE="canvas-offline-queue-v1";const STORE="events";

const openDatabase=()=>new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open(DATABASE,1);request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE,{keyPath:"id"});};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
const transact=async<T>(mode:IDBTransactionMode,run:(store:IDBObjectStore,resolve:(value:T)=>void,reject:(reason?:unknown)=>void)=>void)=>{const database=await openDatabase();return new Promise<T>((resolve,reject)=>{const transaction=database.transaction(STORE,mode);run(transaction.objectStore(STORE),resolve,reject);transaction.oncomplete=()=>database.close();transaction.onerror=()=>reject(transaction.error);});};

export class CanvasOfflineQueue {
  async enqueue(event:EventInput){const id=String(event.payload.client_event_id??crypto.randomUUID());const value={id,event:{...event,payload:{...event.payload,client_event_id:id}},createdAt:new Date().toISOString(),bytes:new Blob([JSON.stringify(event)]).size};await transact<void>("readwrite",(store,resolve,reject)=>{const request=store.put(value);request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error);});return value;}
  async list(){return transact<QueuedCanvasEvent[]>("readonly",(store,resolve,reject)=>{const request=store.getAll();request.onsuccess=()=>resolve((request.result as QueuedCanvasEvent[]).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)));request.onerror=()=>reject(request.error);});}
  async remove(id:string){return transact<void>("readwrite",(store,resolve,reject)=>{const request=store.delete(id);request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error);});}
  async summary(){const events=await this.list();return{count:events.length,bytes:events.reduce((total,event)=>total+event.bytes,0),warning:events.length>=8_000||events.reduce((total,event)=>total+event.bytes,0)>=40*1024*1024,full:events.length>=10_000||events.reduce((total,event)=>total+event.bytes,0)>=50*1024*1024};}
}

export const canvasOfflineQueue=new CanvasOfflineQueue();

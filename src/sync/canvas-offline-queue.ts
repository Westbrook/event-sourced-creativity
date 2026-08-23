import type { EventInput } from "../model/events";

export type QueuedCanvasBatch = {
  id: string;
  ownerId: string;
  projectId: string;
  historyOwnerId?:string;
  organizationId?:string;
  projectAccessId?:string;
  permissionEpoch?:string;
  events: EventInput[];
  createdAt: string;
  actionSequence: number;
  bytes: number;
};

export type CanvasQueueScope = { ownerId:string;projectId:string;historyOwnerId?:string;organizationId?:string;projectAccessId?:string;permissionEpoch?:string };
type LegacyQueuedCanvasBatch = Omit<QueuedCanvasBatch, "ownerId" | "projectId">;
type LegacyQueuedCanvasEvent = { id: string; event: EventInput; createdAt: string; bytes: number };
type StoredCanvasBatch = QueuedCanvasBatch | LegacyQueuedCanvasBatch | LegacyQueuedCanvasEvent;

const DATABASE="canvas-offline-queue-v1";
const STORE="events";
let nextActionSequence=Date.now()*1_000;

const actionSequence=()=>{nextActionSequence=Math.max(nextActionSequence+1,Date.now()*1_000);return nextActionSequence;};
const openDatabase=()=>new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open(DATABASE,2);request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE,{keyPath:"id"});};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
const transact=async<T>(mode:IDBTransactionMode,run:(store:IDBObjectStore,resolve:(value:T)=>void,reject:(reason?:unknown)=>void)=>void)=>{const database=await openDatabase();return new Promise<T>((resolve,reject)=>{const transaction=database.transaction(STORE,mode);run(transaction.objectStore(STORE),resolve,reject);transaction.oncomplete=()=>database.close();transaction.onerror=()=>reject(transaction.error);});};
const validScope=(scope:CanvasQueueScope)=>Boolean(scope.ownerId.trim()&&scope.projectId.trim()&&(!scope.projectAccessId||(scope.organizationId?.trim()&&scope.historyOwnerId?.trim()&&scope.permissionEpoch?.trim())));

/** Legacy batches are readable only when every retained event independently proves the active owner and project. */
export function canvasBatchBelongsToScope(value:StoredCanvasBatch,scope:CanvasQueueScope){
  if(!validScope(scope))return false;
  if("ownerId" in value||"projectId" in value)return"ownerId" in value&&"projectId" in value&&"events" in value&&value.ownerId===scope.ownerId&&value.projectId===scope.projectId
    &&(!scope.projectAccessId||"projectAccessId" in value&&value.projectAccessId===scope.projectAccessId&&"organizationId" in value&&value.organizationId===scope.organizationId
      &&"historyOwnerId" in value&&value.historyOwnerId===scope.historyOwnerId&&"permissionEpoch" in value&&value.permissionEpoch===scope.permissionEpoch)
    &&(!("projectAccessId" in value&&value.projectAccessId)||value.projectAccessId===scope.projectAccessId)
    &&value.events.length>0&&value.events.every((event)=>String(event.payload.history_owner_id??"")===scope.ownerId&&String(event.payload.project_id??"")===scope.projectId);
  if(scope.projectAccessId)return false;
  const events="events" in value?value.events:[value.event];
  return events.length>0&&events.every((event)=>String(event.payload.history_owner_id??"")===scope.ownerId&&String(event.payload.project_id??"")===scope.projectId);
}

const normalizeBatch=(value:StoredCanvasBatch,scope:CanvasQueueScope,index=0):QueuedCanvasBatch=>{
  if("events" in value)return{...value,...scope,events:value.events.map((event)=>({...event,payload:{...event.payload}}))};
  const createdAt=value.createdAt||new Date().toISOString();
  return{id:`legacy:${value.id}`,ownerId:scope.ownerId,projectId:scope.projectId,events:[value.event],createdAt,actionSequence:(Date.parse(createdAt)||0)*1_000+index,bytes:value.bytes||new Blob([JSON.stringify(value.event)]).size};
};

/** A device-local write-ahead log. Every operation is bound to one effective account and project. */
export class CanvasOfflineQueue {
  async enqueueBatch(events:EventInput[],scope:CanvasQueueScope){
    if(!validScope(scope))throw new Error("An authenticated account and owned project are required before saving board changes.");
    if(!events.length||events.some((event)=>String(event.payload.history_owner_id??"")!==scope.ownerId||String(event.payload.project_id??"")!==scope.projectId))throw new Error("Board changes do not belong to the active account and project.");
    const sequence=actionSequence(),rawId=String(events[0]?.payload.history_action_id??crypto.randomUUID());
    const id=scope.projectAccessId?`${scope.organizationId}:${scope.projectAccessId}:${scope.ownerId}:${scope.permissionEpoch}:${rawId}`:rawId;
    const prepared=events.map((event,index)=>({...event,payload:{...event.payload,client_event_id:String(event.payload.client_event_id??crypto.randomUUID()),client_action_sequence:sequence,client_batch_index:index}}));
    const value:QueuedCanvasBatch={id,...scope,events:prepared,createdAt:new Date().toISOString(),actionSequence:sequence,bytes:new Blob([JSON.stringify(prepared)]).size};
    await transact<void>("readwrite",(store,resolve,reject)=>{const request=store.put(value);request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error);});return value;
  }
  async enqueue(event:EventInput,scope:CanvasQueueScope){return this.enqueueBatch([event],scope);}
  async listBatches(scope:CanvasQueueScope){if(!validScope(scope))return[];return transact<QueuedCanvasBatch[]>("readonly",(store,resolve,reject)=>{const request=store.getAll();request.onsuccess=()=>resolve((request.result as StoredCanvasBatch[]).filter((value)=>canvasBatchBelongsToScope(value,scope)).map((value,index)=>normalizeBatch(value,scope,index)).sort((a,b)=>a.actionSequence-b.actionSequence||a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id)));request.onerror=()=>reject(request.error);});}
  async list(scope:CanvasQueueScope){return this.listBatches(scope);}
  async removeBatch(id:string,scope:CanvasQueueScope){if(!validScope(scope))return;return transact<void>("readwrite",(store,resolve,reject)=>{const key=id.replace(/^legacy:/,"");const lookup=store.get(key);lookup.onsuccess=()=>{const value=lookup.result as StoredCanvasBatch|undefined;if(!value||!canvasBatchBelongsToScope(value,scope)){resolve();return;}const request=store.delete(key);request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error);};lookup.onerror=()=>reject(lookup.error);});}
  async remove(id:string,scope:CanvasQueueScope){return this.removeBatch(id,scope);}
  async summary(scope:CanvasQueueScope){const batches=await this.listBatches(scope);const count=batches.reduce((total,batch)=>total+batch.events.length,0),bytes=batches.reduce((total,batch)=>total+batch.bytes,0);return{count,batches:batches.length,bytes,warning:count>=8_000||bytes>=40*1024*1024,full:count>=10_000||bytes>=50*1024*1024};}
}

export const canvasOfflineQueue=new CanvasOfflineQueue();

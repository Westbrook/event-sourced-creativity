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
export const CANVAS_OFFLINE_MAX_AGE_MS=14*24*60*60*1_000;
export const CANVAS_OFFLINE_MAX_OPERATIONS=10_000;
export const CANVAS_OFFLINE_MAX_BYTES=50*1024*1024;
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

const batchExpired=(value:StoredCanvasBatch,now=Date.now())=>{
  const createdAt=Date.parse(value.createdAt);
  return !Number.isFinite(createdAt)||now-createdAt>=CANVAS_OFFLINE_MAX_AGE_MS;
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
    await transact<void>("readwrite",(store,resolve,reject)=>{
      const existing=store.getAll();
      existing.onsuccess=()=>{
        const scoped=(existing.result as StoredCanvasBatch[]).filter((item)=>canvasBatchBelongsToScope(item,scope));
        const current=scoped.filter((item)=>!batchExpired(item));
        const count=current.reduce((total,item)=>total+("events" in item?item.events.length:1),0);
        const bytes=current.reduce((total,item)=>total+Number(item.bytes??0),0);
        if(count+prepared.length>CANVAS_OFFLINE_MAX_OPERATIONS){reject(new Error("The device queue is limited to 10,000 pending board changes. Reconnect before adding more."));return;}
        if(bytes+value.bytes>CANVAS_OFFLINE_MAX_BYTES){reject(new Error("The device queue is limited to 50 MB of pending board changes. Reconnect before adding more."));return;}
        for(const expired of scoped.filter((item)=>batchExpired(item))){const removal=store.delete(expired.id);removal.onerror=()=>reject(removal.error);}
        const request=store.put(value);request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error);
      };
      existing.onerror=()=>reject(existing.error);
    });return value;
  }
  async enqueue(event:EventInput,scope:CanvasQueueScope){return this.enqueueBatch([event],scope);}
  async listBatches(scope:CanvasQueueScope){if(!validScope(scope))return[];return transact<QueuedCanvasBatch[]>("readwrite",(store,resolve,reject)=>{const request=store.getAll();request.onsuccess=()=>{const scoped=(request.result as StoredCanvasBatch[]).filter((value)=>canvasBatchBelongsToScope(value,scope));for(const expired of scoped.filter((value)=>batchExpired(value))){const removal=store.delete(expired.id);removal.onerror=()=>reject(removal.error);}resolve(scoped.filter((value)=>!batchExpired(value)).map((value,index)=>normalizeBatch(value,scope,index)).sort((a,b)=>a.actionSequence-b.actionSequence||a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id)));};request.onerror=()=>reject(request.error);});}
  async list(scope:CanvasQueueScope){return this.listBatches(scope);}
  async removeBatch(id:string,scope:CanvasQueueScope){if(!validScope(scope))return;return transact<void>("readwrite",(store,resolve,reject)=>{const key=id.replace(/^legacy:/,"");const lookup=store.get(key);lookup.onsuccess=()=>{const value=lookup.result as StoredCanvasBatch|undefined;if(!value||!canvasBatchBelongsToScope(value,scope)){resolve();return;}const request=store.delete(key);request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error);};lookup.onerror=()=>reject(lookup.error);});}
  async remove(id:string,scope:CanvasQueueScope){return this.removeBatch(id,scope);}
  /** Personal erasure cannot remove another principal's or an organization's device-local work. */
  async clearPersonalOwner(ownerId:string){if(!ownerId.trim())return 0;return transact<number>("readwrite",(store,resolve,reject)=>{const lookup=store.getAll();lookup.onsuccess=()=>{let removed=0;for(const value of lookup.result as StoredCanvasBatch[]){const owned="ownerId" in value?value.ownerId===ownerId&&!value.projectAccessId:(("events" in value?value.events:[value.event]).every((event)=>String(event.payload.history_owner_id??"")===ownerId));if(!owned)continue;const deletion=store.delete(value.id);deletion.onerror=()=>reject(deletion.error);removed+=1;}resolve(removed);};lookup.onerror=()=>reject(lookup.error);});}
  async summary(scope:CanvasQueueScope){const batches=await this.listBatches(scope);const count=batches.reduce((total,batch)=>total+batch.events.length,0),bytes=batches.reduce((total,batch)=>total+batch.bytes,0);return{count,batches:batches.length,bytes,warning:count>=CANVAS_OFFLINE_MAX_OPERATIONS*.8||bytes>=CANVAS_OFFLINE_MAX_BYTES*.8,full:count>=CANVAS_OFFLINE_MAX_OPERATIONS||bytes>=CANVAS_OFFLINE_MAX_BYTES};}
}

export const canvasOfflineQueue=new CanvasOfflineQueue();

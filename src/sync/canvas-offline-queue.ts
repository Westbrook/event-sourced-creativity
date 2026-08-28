import type { CreativeEvent, EventInput } from "../model/events";
import type { EventWriteAcknowledgment, EventWriteOwner } from "../state/store";

type RetiredCanvasIdentity = { clientEventId:string|null;type:string };
type CanvasSourceRetirement = {
  reason:"source-retired";
  batchId:string;
  requested:RetiredCanvasIdentity[];
  acknowledgments:EventWriteAcknowledgment[];
};
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
  sourceRetired?:CanvasSourceRetirement;
};

export type CanvasQueueScope = { ownerId:string;projectId:string;historyOwnerId?:string;organizationId?:string;projectAccessId?:string;permissionEpoch?:string };
type LegacyQueuedCanvasBatch = Omit<QueuedCanvasBatch, "ownerId" | "projectId">;
type LegacyQueuedCanvasEvent = { id: string; event: EventInput; createdAt: string; bytes: number };
type StoredCanvasBatch = QueuedCanvasBatch | LegacyQueuedCanvasBatch | LegacyQueuedCanvasEvent;
type QueueCurrent = { current?:()=>boolean };
type RetirementReceipt = { batches:readonly QueuedCanvasBatch[];owner:EventWriteOwner;acknowledgment:EventWriteAcknowledgment };
type QueueDeletion = { transaction:IDBTransaction; terminal:Promise<unknown>; retired:boolean; erasure:number; values:QueuedCanvasBatch[] };
type SourceFence = { revision:number;pending:number;failed:boolean;all:boolean;ids:Set<string>;retirement?:Promise<void>; retained:Map<string,QueuedCanvasBatch> };

const DATABASE="canvas-offline-queue-v1";
const STORE="events";
export const CANVAS_OFFLINE_MAX_AGE_MS=14*24*60*60*1_000;
export const CANVAS_OFFLINE_MAX_OPERATIONS=10_000;
export const CANVAS_OFFLINE_MAX_BYTES=50*1024*1024;
let nextActionSequence=Date.now()*1_000;

const actionSequence=()=>{nextActionSequence=Math.max(nextActionSequence+1,Date.now()*1_000);return nextActionSequence;};
const current=(options:QueueCurrent)=>{try{return options.current?.()!==false;}catch{return false;}};
const jsonBytes=(value:unknown)=>new Blob([JSON.stringify(value)]).size;
const metadataBytes=(value:QueuedCanvasBatch)=>{const counted={...value,bytes:0};let size=jsonBytes(counted);while(size!==counted.bytes){counted.bytes=size;size=jsonBytes(counted);}return size;};
const scopeKey=(scope:CanvasQueueScope)=>JSON.stringify([scope.ownerId,scope.projectId,scope.organizationId??null,scope.projectAccessId??null,scope.historyOwnerId??null,scope.permissionEpoch??null]);
const openDatabase=()=>new Promise<IDBDatabase>((resolve,reject)=>{
  const request=indexedDB.open(DATABASE,2);let failed=false;
  request.onupgradeneeded=()=>{if(failed){request.transaction?.abort();return;}if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE,{keyPath:"id"});};
  request.onsuccess=()=>{if(failed)request.result.close();else resolve(request.result);};
  request.onerror=()=>{failed=true;reject(request.error);};
  request.onblocked=()=>{failed=true;reject(new Error("canvas_queue_storage_unavailable"));};
});
const transact=async<T>(mode:IDBTransactionMode,run:(store:IDBObjectStore,resolve:(value:T)=>void,reject:(reason?:unknown)=>void,transaction:IDBTransaction)=>void)=>{
  const database=await openDatabase();
  return new Promise<T>((resolve,reject)=>{
    const transaction=database.transaction(STORE,mode);let ready=false,value:T,failed=false;
    const fail=(reason?:unknown,terminal=false)=>{if(failed)return;failed=true;if(!terminal)try{transaction.abort();}catch{/* The transaction may already have aborted. */}database.close();reject(reason??transaction.error??new Error("canvas_queue_storage_unavailable"));};
    transaction.oncomplete=()=>{database.close();if(!failed){if(ready)resolve(value);else fail(new Error("canvas_queue_storage_unavailable"));}};
    transaction.onerror=()=>fail(transaction.error);transaction.onabort=()=>fail(transaction.error,true);
    try{run(transaction.objectStore(STORE),(result)=>{value=result;ready=true;},fail,transaction);}catch(error){fail(error);}
  });
};
const validScope=(scope:CanvasQueueScope)=>Boolean(scope.ownerId.trim()&&scope.projectId.trim()&&(!scope.projectAccessId||(scope.organizationId?.trim()&&scope.historyOwnerId?.trim()&&scope.permissionEpoch?.trim())));
const exactScope=(value:StoredCanvasBatch,scope:CanvasQueueScope)=>"ownerId" in value&&"projectId" in value&&value.ownerId===scope.ownerId&&value.projectId===scope.projectId
  &&(!scope.projectAccessId||"projectAccessId" in value&&value.projectAccessId===scope.projectAccessId&&"organizationId" in value&&value.organizationId===scope.organizationId
    &&"historyOwnerId" in value&&value.historyOwnerId===scope.historyOwnerId&&"permissionEpoch" in value&&value.permissionEpoch===scope.permissionEpoch)
  &&(!("projectAccessId" in value&&value.projectAccessId)||value.projectAccessId===scope.projectAccessId);
const exactKeys=(value:object,keys:string[])=>Object.keys(value).length===keys.length&&Object.keys(value).every((key)=>keys.includes(key));
const identity=(value:unknown):value is RetiredCanvasIdentity=>Boolean(value&&typeof value==="object"&&exactKeys(value,["clientEventId","type"])
  &&typeof (value as RetiredCanvasIdentity).type==="string"&&(value as RetiredCanvasIdentity).type.length
  &&((value as RetiredCanvasIdentity).clientEventId===null||typeof (value as RetiredCanvasIdentity).clientEventId==="string"&&(value as RetiredCanvasIdentity).clientEventId!.length));
const acknowledgment=(value:unknown,owner:EventWriteOwner,requested:readonly RetiredCanvasIdentity[]):EventWriteAcknowledgment|null=>{
  if(!value||typeof value!=="object"||!exactKeys(value,["observationId","owner","action","requestedClientEventIds","committed","rejectedIndices","outcome","observedHead","privateUnavailable"]))return null;
  const item=value as EventWriteAcknowledgment,ids=requested.flatMap((entry)=>entry.clientEventId?[entry.clientEventId]:[]);
  if(!item.owner||!exactKeys(item.owner,["authorizationKey","actorUserId","projectId","sourceGeneration"])||item.owner.authorizationKey!==owner.authorizationKey||item.owner.actorUserId!==owner.actorUserId||item.owner.projectId!==owner.projectId||item.owner.sourceGeneration!==owner.sourceGeneration
    ||typeof owner.authorizationKey!=="string"||!owner.authorizationKey||typeof owner.actorUserId!=="string"||!owner.actorUserId||typeof owner.projectId!=="string"||!owner.projectId||!Number.isSafeInteger(owner.sourceGeneration)||owner.sourceGeneration<0
    ||typeof item.observationId!=="string"||!item.observationId||item.action!=="canvas_sync"||item.privateUnavailable!==true
    ||!Array.isArray(item.requestedClientEventIds)||item.requestedClientEventIds.length!==ids.length||ids.some((id,index)=>item.requestedClientEventIds[index]!==id)||new Set(ids).size!==ids.length
    ||!["not-attempted","observed","unconfirmed"].includes(item.outcome)||!(item.observedHead===null||Number.isSafeInteger(item.observedHead)&&item.observedHead>=0)
    ||!Array.isArray(item.committed)||!Array.isArray(item.rejectedIndices))return null;
  const committedIds=new Set<string>(),eventIds=new Set<string>();
  for(const event of item.committed){
    if(!event||typeof event!=="object"||!exactKeys(event,["eventId","type","sequence","clientEventId"])||typeof event.eventId!=="string"||!event.eventId
      ||!Number.isSafeInteger(event.sequence)||event.sequence<0||typeof event.clientEventId!=="string"||!ids.includes(event.clientEventId)
      ||requested.find((entry)=>entry.clientEventId===event.clientEventId)?.type!==event.type||committedIds.has(event.clientEventId)||eventIds.has(event.eventId))return null;
    committedIds.add(event.clientEventId);eventIds.add(event.eventId);
  }
  if(new Set(item.rejectedIndices).size!==item.rejectedIndices.length||item.rejectedIndices.some((index)=>!Number.isSafeInteger(index)||index<0||index>=requested.length||committedIds.has(requested[index]?.clientEventId??"")))return null;
  if(item.outcome==="not-attempted"&&(item.committed.length||item.rejectedIndices.length||item.observedHead!==null))return null;
  return structuredClone(item);
};
const retiredRecord=(value:StoredCanvasBatch):value is QueuedCanvasBatch&{sourceRetired:CanvasSourceRetirement}=>{
  if(!("events" in value)||value.events.length!==0||!("sourceRetired" in value)||!value.sourceRetired)return false;
  const retired=value.sourceRetired;
  if(Object.keys(value).some((key)=>!["id","ownerId","projectId","historyOwnerId","organizationId","projectAccessId","permissionEpoch","events","createdAt","actionSequence","bytes","sourceRetired"].includes(key))
    ||!["ownerId","projectId","id","createdAt"].every((key)=>typeof (value as Record<string,unknown>)[key]==="string")||!Number.isSafeInteger(value.actionSequence)
    ||retired.batchId!==value.id&&retired.batchId!=="legacy:"+value.id)return false;
  if(!exactKeys(retired,["reason","batchId","requested","acknowledgments"])||retired.reason!=="source-retired"||typeof retired.batchId!=="string"||!retired.batchId
    ||!Array.isArray(retired.requested)||!retired.requested.length||retired.requested.length>CANVAS_OFFLINE_MAX_OPERATIONS||!retired.requested.every(identity)
    ||!Array.isArray(retired.acknowledgments)||retired.acknowledgments.length>retired.requested.length+1)return false;
  return retired.acknowledgments.every((item)=>Boolean(item?.owner&&acknowledgment(item,item.owner,retired.requested)));
};

/** Legacy batches are readable only when every retained event independently proves the active owner and project. */
export function canvasBatchBelongsToScope(value:StoredCanvasBatch,scope:CanvasQueueScope){
  if(!validScope(scope))return false;
  if("sourceRetired" in value)return exactScope(value,scope)&&retiredRecord(value)
    &&value.sourceRetired.acknowledgments.every((item)=>item.owner.actorUserId===scope.ownerId&&item.owner.projectId===scope.projectId);
  if("ownerId" in value||"projectId" in value)return exactScope(value,scope)&&"events" in value
    &&value.events.length>0&&value.events.every((event)=>String(event.payload.history_owner_id??"")===scope.ownerId&&String(event.payload.project_id??"")===scope.projectId);
  if(scope.projectAccessId)return false;
  const events="events" in value?value.events:[value.event];
  return events.length>0&&events.every((event)=>String(event.payload.history_owner_id??"")===scope.ownerId&&String(event.payload.project_id??"")===scope.projectId);
}

const normalizeBatch=(value:StoredCanvasBatch,scope:CanvasQueueScope,index=0):QueuedCanvasBatch=>{
  if(retiredRecord(value))return{id:value.sourceRetired.batchId,...scope,createdAt:value.createdAt,actionSequence:value.actionSequence,events:[],sourceRetired:structuredClone(value.sourceRetired),bytes:metadataBytes(value)};
  if("events" in value)return{...value,...scope,events:value.events.map((event)=>({...event,payload:{...event.payload}}))};
  const createdAt=value.createdAt||new Date().toISOString();
  return{id:"legacy:"+value.id,ownerId:scope.ownerId,projectId:scope.projectId,events:[value.event],createdAt,actionSequence:(Date.parse(createdAt)||0)*1_000+index,bytes:value.bytes||jsonBytes(value.event)};
};
const withdrawnBatch=(value:StoredCanvasBatch,scope:CanvasQueueScope,index=0):QueuedCanvasBatch=>{
  const batch=normalizeBatch(value,scope,index);
  if(batch.sourceRetired)return batch;
  const sourceRetired:CanvasSourceRetirement={reason:"source-retired",batchId:batch.id,requested:batch.events.map((event)=>({clientEventId:typeof event.payload.client_event_id==="string"&&event.payload.client_event_id?event.payload.client_event_id:null,type:event.type})),acknowledgments:[]};
  // Deliberately do not spread the old record or any event/payload into the paused branch.
  const paused:QueuedCanvasBatch={id:batch.id,...scope,events:[],createdAt:batch.createdAt,actionSequence:batch.actionSequence,bytes:0,sourceRetired};
  paused.bytes=metadataBytes(paused);return paused;
};
const publicId=(value:StoredCanvasBatch)=>retiredRecord(value)?value.sourceRetired.batchId:"events" in value?value.id:"legacy:"+value.id;
const batchCount=(value:StoredCanvasBatch)=>retiredRecord(value)?value.sourceRetired.requested.length:"events" in value?value.events.length:1;
const batchBytes=(value:StoredCanvasBatch)=>retiredRecord(value)?metadataBytes(value):Number(value.bytes??0);
const batchExpired=(value:StoredCanvasBatch,now=Date.now())=>{
  if(retiredRecord(value))return false;
  const createdAt=Date.parse(value.createdAt);
  return !Number.isFinite(createdAt)||now-createdAt>=CANVAS_OFFLINE_MAX_AGE_MS;
};

/** A device-local write-ahead log. Every operation is bound to one effective account and project. */
export class CanvasOfflineQueue {
  #sourceFences=new Map<string,SourceFence>();
  #deletions=new Map<string,Set<QueueDeletion>>();
  async #deleteProtected<T>(scope:CanvasQueueScope,run:(store:IDBObjectStore,resolve:(value:T)=>void,reject:(reason?:unknown)=>void,protect:(values:StoredCanvasBatch[])=>boolean)=>void){
    const key=scopeKey(scope);let record:QueueDeletion|undefined;
    const operation:Promise<T>=transact<T>("readwrite",(store,resolve,reject,transaction)=>{
      run(store,resolve,reject,(values)=>{
        const paused=values.filter((value)=>canvasBatchBelongsToScope(value,scope)).map((value,index)=>{
          const batch=withdrawnBatch(value,scope,index);batch.id=value.id;batch.bytes=metadataBytes(batch);return batch;
        });
        if(!paused.length)return true;
        const retained=new Map((record?.values??[]).map((value)=>[value.id,value]));for(const value of paused)retained.set(value.id,value);
        const originals=[...retained.values()];
        if(originals.reduce((sum,value)=>sum+batchCount(value),0)>CANVAS_OFFLINE_MAX_OPERATIONS||originals.reduce((sum,value)=>sum+batchBytes(value),0)>CANVAS_OFFLINE_MAX_BYTES){reject(new Error("canvas_queue_storage_unavailable"));return false;}
        if(record){record.values=originals;return true;}
        record={transaction,terminal:operation,retired:false,erasure:this.#erasure(scope),values:originals};
        const active=this.#deletions.get(key)??new Set<QueueDeletion>();active.add(record);this.#deletions.set(key,active);return true;
      });
    });
    try{return{value:await operation,retired:Boolean(record?.retired),completed:true};}
    catch(error){if(record?.retired)return{value:undefined,retired:true,completed:false};throw error;}
    finally{if(record){const active=this.#deletions.get(key);active?.delete(record);if(!active?.size)this.#deletions.delete(key);}}
  }
  #erasureVersions=new Map<string,number>();
  #erasure(scope:CanvasQueueScope){return scope.projectAccessId?0:this.#erasureVersions.get(scope.ownerId)??0;}
  #fence(scope:CanvasQueueScope){return this.#sourceFences.get(scopeKey(scope));}
  #mask(value:StoredCanvasBatch,scope:CanvasQueueScope,index=0,stale=false){
    const fence=this.#fence(scope);
    return stale||fence?.all||fence?.ids.has(publicId(value))?withdrawnBatch(value,scope,index):normalizeBatch(value,scope,index);
  }
  async enqueueBatch(events:EventInput[],scope:CanvasQueueScope,options:QueueCurrent={}){
    if(!validScope(scope))throw new Error("An authenticated account and owned project are required before saving board changes.");
    if(!events.length||events.some((event)=>String(event.payload.history_owner_id??"")!==scope.ownerId||String(event.payload.project_id??"")!==scope.projectId))throw new Error("Board changes do not belong to the active account and project.");
    if(!current(options)||this.#fence(scope)?.pending||this.#fence(scope)?.failed)throw new Error("canvas_source_retired");
    const revision=this.#fence(scope)?.revision??0,erasure=this.#erasure(scope);
    const sequence=actionSequence(),rawId=String(events[0]?.payload.history_action_id??crypto.randomUUID());
    const id=scope.projectAccessId?[scope.organizationId,scope.projectAccessId,scope.ownerId,scope.permissionEpoch,rawId].join(":"):rawId;
    if(this.#fence(scope)?.ids.has(id))throw new Error("canvas_source_retired");
    const prepared=events.map((event,index)=>({...event,payload:{...event.payload,client_event_id:String(event.payload.client_event_id??crypto.randomUUID()),client_action_sequence:sequence,client_batch_index:index}}));
    let value:QueuedCanvasBatch={id,...scope,events:prepared,createdAt:new Date().toISOString(),actionSequence:sequence,bytes:jsonBytes(prepared)};
    const persist=()=>this.#deleteProtected<void>(scope,(store,resolve,reject,protect)=>{
      const existing=store.getAll();
      existing.onsuccess=()=>{
        if((this.#erasure(scope))!==erasure){reject(new Error("canvas_source_retired"));return;}
        const scoped=(existing.result as StoredCanvasBatch[]).filter((item)=>canvasBatchBelongsToScope(item,scope));
        if(scoped.some((item)=>item.id===id&&retiredRecord(item))){reject(new Error("canvas_source_retired"));return;}
        if(!current(options)||(this.#fence(scope)?.revision??0)!==revision)value=withdrawnBatch(value,scope);
        const retained=scoped.filter((item)=>!batchExpired(item));
        const count=retained.reduce((total,item)=>total+batchCount(item),0),bytes=retained.reduce((total,item)=>total+batchBytes(item),0);
        if(count+prepared.length>CANVAS_OFFLINE_MAX_OPERATIONS){reject(new Error("The device queue is limited to 10,000 pending board changes. Reconnect before adding more."));return;}
        if(bytes+value.bytes>CANVAS_OFFLINE_MAX_BYTES){reject(new Error("The device queue is limited to 50 MB of pending board changes. Reconnect before adding more."));return;}
        const expired=scoped.filter((item)=>batchExpired(item));if(!protect(expired))return;
        for(const item of expired){const removal=store.delete(item.id);removal.onerror=()=>reject(removal.error);}
        const request=store.put(value);request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error);
      };
      existing.onerror=()=>reject(existing.error);
    });
    const persisted=await persist();
    if(!persisted.completed){
      if((this.#erasure(scope))!==erasure)throw new Error("canvas_source_retired");
      value=withdrawnBatch(value,scope);const restored=await persist();if(!restored.completed)throw new Error("canvas_queue_storage_unavailable");
    }
    if((this.#erasure(scope))!==erasure)throw new Error("canvas_source_retired");
    if(!value.sourceRetired&&(!current(options)||(this.#fence(scope)?.revision??0)!==revision)){
      await this.retireSource(scope,{batchIds:[id]});value=withdrawnBatch(value,scope);
    }
    return value;
  }
  async enqueue(event:EventInput,scope:CanvasQueueScope){return this.enqueueBatch([event],scope);}
  async listBatches(scope:CanvasQueueScope,options:QueueCurrent={}){
    if(!validScope(scope))return[];
    const revision=this.#fence(scope)?.revision??0;
    const erasure=this.#erasure(scope);let observed:StoredCanvasBatch[]=[];
    const reading=await this.#deleteProtected<StoredCanvasBatch[]>(scope,(store,resolve,reject,protect)=>{
      const request=store.getAll();request.onsuccess=()=>{
        const scoped=(request.result as StoredCanvasBatch[]).filter((value)=>canvasBatchBelongsToScope(value,scope));
        observed=scoped;const expired=scoped.filter((value)=>batchExpired(value)&&!this.#fence(scope)?.all&&!this.#fence(scope)?.ids.has(publicId(value)));if(!protect(expired))return;
        for(const value of expired){const removal=store.delete(value.id);removal.onerror=()=>reject(removal.error);}
        resolve(scoped.filter((value)=>!batchExpired(value)||this.#fence(scope)?.all||this.#fence(scope)?.ids.has(publicId(value))));
      };request.onerror=()=>reject(request.error);
    });
    if((this.#erasure(scope))!==erasure)return[];
    const combined=new Map((reading.retired?observed:reading.value??[]).map((value)=>[value.id,value]));
    for(const [id,value]of this.#fence(scope)?.retained??[])combined.set(id,value);
    const values=[...combined.values()];
    const stale=reading.retired||!current(options)||(this.#fence(scope)?.revision??0)!==revision;
    return values.map((value,index)=>this.#mask(value,scope,index,stale)).sort((a,b)=>a.actionSequence-b.actionSequence||a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
  }
  async list(scope:CanvasQueueScope){return this.listBatches(scope);}
  async retireSource(scope:CanvasQueueScope,options:{batchIds?:readonly string[];receipt?:RetirementReceipt}={}){
    if(!validScope(scope))return;
    const key=scopeKey(scope),fence:SourceFence=this.#fence(scope)??{revision:0,pending:0,failed:false,all:false,ids:new Set<string>(),retained:new Map<string,QueuedCanvasBatch>()};
    if(!options.batchIds&&fence.retirement)return fence.retirement;
    if(!options.batchIds){fence.revision+=1;fence.all=true;}fence.pending+=1;
    const selected=options.batchIds?new Set(options.batchIds):null;
    for(const id of selected??[])fence.ids.add(id);
    this.#sourceFences.set(key,fence);
    const erasure=this.#erasure(scope),recovery=new Map(fence.retained),persisted=new Map<string,QueuedCanvasBatch>();
    const deletions=[...(this.#deletions.get(key)??[])].filter((record)=>record.erasure===erasure&&record.values.some((value)=>!selected||selected.has(publicId(value))));
    for(const record of deletions){
      record.retired=true;
      for(const value of record.values)if(!selected||selected.has(publicId(value))){recovery.set(value.id,value);fence.retained.set(value.id,value);fence.ids.add(publicId(value));}
      try{record.transaction.abort();}catch{/* Commit may already have begun. Await its terminal result; never claim rollback. */}
    }
    const persisting=(async()=>{
      if(deletions.length)await Promise.all(deletions.map((record)=>record.terminal.catch(()=>undefined)));
      if(this.#erasure(scope)!==erasure){if(this.#fence(scope)===fence)fence.failed=true;return;}
      await transact<void>("readwrite",(store,resolve,reject)=>{
        const lookup=store.getAll();lookup.onerror=()=>reject(lookup.error);lookup.onsuccess=()=>{
          if((this.#erasure(scope))!==erasure){resolve();return;}
          const all=lookup.result as StoredCanvasBatch[],values=all.filter((value)=>canvasBatchBelongsToScope(value,scope));
          // A delete already committing cannot be rolled back. Restore only the exact original
          // content-free record when its storage key is absent; never overwrite a newer record.
          for(const [id,value]of recovery)if(!all.some((item)=>item.id===id))values.push(value);
          const receipt=options.receipt,requested=receipt?.batches.flatMap((batch)=>batch.sourceRetired?.requested??batch.events.map((event)=>({clientEventId:typeof event.payload.client_event_id==="string"&&event.payload.client_event_id?event.payload.client_event_id:null,type:event.type})))??[];
          const verified=receipt&&receipt.owner.actorUserId===scope.ownerId&&receipt.owner.projectId===scope.projectId?acknowledgment(receipt.acknowledgment,receipt.owner,requested):null;
          for(let index=0;index<values.length;index+=1){
            const original=values[index]!;if(selected&&!selected.has(publicId(original)))continue;
            const prior=recovery.get(original.id);
            if(prior&&all.includes(original)){
              const actual=withdrawnBatch(original,scope,index);
              if(actual.createdAt!==prior.createdAt||actual.actionSequence!==prior.actionSequence||JSON.stringify(actual.sourceRetired?.requested)!==JSON.stringify(prior.sourceRetired?.requested))continue;
            }
            if((this.#erasure(scope))!==erasure){resolve();return;}
            const batch=withdrawnBatch(original,scope,index);fence.ids.add(publicId(original));
            if(verified&&receipt?.batches.some((input)=>input.id===batch.id)){
              const retired=batch.sourceRetired!,ownIds=retired.requested.map((item)=>item.clientEventId).filter((id):id is string=>id!==null);
              // Preserve the actual observation, projected only onto this original batch's exact input order.
              const ownReceipt:EventWriteAcknowledgment={...verified,requestedClientEventIds:ownIds,committed:verified.committed.filter((item)=>ownIds.includes(item.clientEventId??"")),rejectedIndices:retired.requested.flatMap((item,index)=>verified.rejectedIndices.some((rejected)=>requested[rejected]?.clientEventId===item.clientEventId&&item.clientEventId!==null)?[index]:[])};
              if(acknowledgment(ownReceipt,receipt.owner,retired.requested)&&!retired.acknowledgments.some((item)=>item.observationId===ownReceipt.observationId)){
                const priorCommitted=new Set(retired.acknowledgments.flatMap((item)=>item.committed.map((entry)=>entry.clientEventId))),priorRejected=new Set(retired.acknowledgments.flatMap((item)=>item.rejectedIndices));
                if(!retired.acknowledgments.length||ownReceipt.committed.some((item)=>!priorCommitted.has(item.clientEventId))||ownReceipt.rejectedIndices.some((index)=>!priorRejected.has(index))){
                  if(retired.acknowledgments.length>=retired.requested.length+1){reject(new Error("canvas_queue_storage_unavailable"));return;}
                  retired.acknowledgments.push(ownReceipt);
                }
              }
            }
            batch.id=original.id;batch.bytes=metadataBytes(batch);
            if(batch.bytes>CANVAS_OFFLINE_MAX_BYTES){reject(new Error("canvas_queue_storage_unavailable"));return;}
            const write=store.put(batch);write.onerror=()=>reject(write.error);
            if(prior)persisted.set(original.id,prior);
          }
          resolve();
        };
      });
    })();
    const retirement=(async()=>{
      try{
        await persisting;
        if(this.#erasure(scope)===erasure&&this.#fence(scope)===fence){
          for(const [id,value]of persisted)if(fence.retained.get(id)===value)fence.retained.delete(id);
          if([...recovery].some(([id,value])=>(!selected||selected.has(publicId(value)))&&fence.retained.get(id)===value))throw new Error("canvas_queue_storage_unavailable");
        }
        fence.pending-=1;if(!options.batchIds&&this.#erasure(scope)===erasure&&this.#fence(scope)===fence){fence.failed=false;fence.all=false;}
      }catch(error){fence.pending-=1;fence.failed=true;throw error;}
      finally{if(!options.batchIds)fence.retirement=undefined;}
    })();
    if(!options.batchIds)fence.retirement=retirement;
    return retirement;
  }
  async reconcileRetired(scope:CanvasQueueScope,events:readonly CreativeEvent[],options:{current:()=>boolean}){
    if(typeof options?.current!=="function"||!validScope(scope)||!current(options)||this.#fence(scope)?.pending||this.#fence(scope)?.failed)return;
    await this.#deleteProtected<void>(scope,(store,resolve,reject,protect)=>{
      const lookup=store.getAll();lookup.onerror=()=>reject(lookup.error);lookup.onsuccess=()=>{
        if(!current(options)){resolve();return;}
        for(const value of lookup.result as StoredCanvasBatch[]){
          if(!canvasBatchBelongsToScope(value,scope)||!retiredRecord(value))continue;
          const ids=value.sourceRetired.requested.map((item)=>item.clientEventId);
          if(ids.some((id)=>id===null)||new Set(ids).size!==ids.length)continue;
          const complete=value.sourceRetired.requested.every((item)=>{
            const matches=events.filter((event)=>event.payload.client_event_id===item.clientEventId);
            return matches.length===1&&matches[0]!.type===item.type&&(matches[0]!.actor==="user"||matches[0]!.actor==="user:"+scope.ownerId)
              &&matches[0]!.payload.project_id===scope.projectId&&matches[0]!.payload.history_owner_id===scope.ownerId
              &&typeof matches[0]!.eventId==="string"&&Boolean(matches[0]!.eventId)&&Number.isSafeInteger(matches[0]!.sequence)&&matches[0]!.sequence>=0;
          });
          if(complete){if(!protect([value]))return;const deletion=store.delete(value.id);deletion.onerror=()=>reject(deletion.error);}
        }
        resolve();
      };
    });
  }
  async removeBatch(id:string,scope:CanvasQueueScope){
    if(!validScope(scope))return;
    return this.#deleteProtected<void>(scope,(store,resolve,reject,protect)=>{
      const lookup=store.getAll();lookup.onsuccess=()=>{
        const value=(lookup.result as StoredCanvasBatch[]).find((item)=>publicId(item)===id&&canvasBatchBelongsToScope(item,scope));
        if(!value||retiredRecord(value)||this.#fence(scope)?.all||this.#fence(scope)?.ids.has(id)){resolve();return;}
        if(!protect([value]))return;const request=store.delete(value.id);request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error);
      };lookup.onerror=()=>reject(lookup.error);
    });
  }
  async remove(id:string,scope:CanvasQueueScope){return this.removeBatch(id,scope);}
  /** Personal erasure cannot remove another principal's or an organization's device-local work. */
  async clearPersonalOwner(ownerId:string){
    if(!ownerId.trim())return 0;this.#erasureVersions.set(ownerId,(this.#erasureVersions.get(ownerId)??0)+1);
    const removed=await transact<number>("readwrite",(store,resolve,reject)=>{const lookup=store.getAll();lookup.onsuccess=()=>{let removed=0;for(const value of lookup.result as StoredCanvasBatch[]){const owned="ownerId" in value?value.ownerId===ownerId&&!value.projectAccessId:(("events" in value?value.events:[value.event]).every((event)=>String(event.payload.history_owner_id??"")===ownerId));if(!owned)continue;const deletion=store.delete(value.id);deletion.onerror=()=>reject(deletion.error);removed+=1;}resolve(removed);};lookup.onerror=()=>reject(lookup.error);});
    for(const [key] of this.#sourceFences){const scope=JSON.parse(key) as unknown[];if(scope[0]===ownerId&&!scope[3])this.#sourceFences.delete(key);}return removed;
  }
  async summary(scope:CanvasQueueScope){
    const batches=await this.listBatches(scope),count=batches.reduce((total,batch)=>total+batchCount(batch),0),bytes=batches.reduce((total,batch)=>total+batchBytes(batch),0);
    const paused=batches.reduce((total,batch)=>total+(batch.sourceRetired?batch.sourceRetired.requested.length:0),0);
    return{count,batches:batches.length,bytes,paused,sourcePausePending:Boolean(this.#fence(scope)?.pending),sourcePauseFailed:Boolean(this.#fence(scope)?.failed),warning:count>=CANVAS_OFFLINE_MAX_OPERATIONS*.8||bytes>=CANVAS_OFFLINE_MAX_BYTES*.8,full:count>=CANVAS_OFFLINE_MAX_OPERATIONS||bytes>=CANVAS_OFFLINE_MAX_BYTES};
  }
}

export const canvasOfflineQueue=new CanvasOfflineQueue();

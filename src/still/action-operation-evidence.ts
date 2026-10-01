import type { DocumentJob } from '../model/document-jobs.ts';
import type { CreativeEvent } from '../model/events.ts';
import { ACTION_RETENTION_MS, OUTCOME_OBSERVATION_VERSION, type ActionObservation, type ActionObservationInput, type OutcomeObservation, type WorkflowTarget } from './action-outcomes.ts';

/** Observation window, not a promise to retain evidence or poll for this long. */
export const ACTION_OPERATION_HORIZON_MS = 24 * 60 * 60 * 1000;
type EvidenceContext = {
  loaded:boolean;
  value:{enabled:boolean;expiresAt?:string;observations?:ActionObservation[]};
  observation(id:string):ActionObservationInput|undefined;
  outcome(value:OutcomeObservation,refs:{parentId:string;eventIds?:string[];jobId?:string}):string|undefined;
};
type OperationSnapshot = { jobs:readonly DocumentJob[]; events:readonly CreativeEvent[]; jobsLoaded:boolean; jobsError:string };
type Series = { id:string; parentId:string; eventIds?:string[]; jobId?:string; value:OutcomeObservation; observationId?:string; confirmed?:boolean; attemptedStatus?:OutcomeObservation['status']; desired?:{status:OutcomeObservation['status'];occurredAt:string} };
export type FileRetrievalTicket = { scopeKey:string; seriesId:string; target:WorkflowTarget };
const sameTarget=(a:WorkflowTarget,b:WorkflowTarget)=>a.kind===b.kind&&a.id===b.id&&a.revision===b.revision;

/** Uses only receipts and reads already authorized by Still. No polling or persisted client journal. */
export class ActionOperationEvidence {
  private scopeKey='';
  private series=new Map<string,Series>();
  private receipts=new Set<string>();
  constructor(private context:EvidenceContext,private now:()=>number=Date.now){}
  private enter(scopeKey:string){
    if(scopeKey!==this.scopeKey||!this.available()){
      this.scopeKey=scopeKey;this.series.clear();this.receipts.clear();
    }
    return !!scopeKey&&this.available();
  }
  private available(){return this.context.loaded&&this.context.value.enabled&&(!this.context.value.expiresAt||Date.parse(this.context.value.expiresAt)>this.now());}
  private remember(series:Series){
    if(this.series.size>=80&&!this.series.has(series.id))this.series.delete(this.series.keys().next().value!);
    this.series.set(series.id,series);
    if(this.receipts.size>=160)this.receipts.delete(this.receipts.values().next().value!);
    this.receipts.add(this.receiptKey(series.value.type,series.jobId,series.eventIds?.[0]));
  }
  private receiptKey(type:OutcomeObservation['type'],jobId?:string,eventId?:string){return `${jobId?`job:${jobId}`:`export:${eventId}`}/${type}`;}
  private emit(series:Series,status:OutcomeObservation['status'],occurredAt=new Date(this.now()).toISOString()){
    if(!this.available()||series.attemptedStatus===status||series.observationId&&series.value.status===status)return;
    const previous=series.observationId;
    // The bounded read may hide an existing series. A rejected revision-one collision
    // is not a new predecessor, and a queued row is not confirmation of its acceptance.
    if(previous&&!series.confirmed&&!this.context.value.observations?.some(row=>row.id===previous))return;
    // A retained correction can continue the same verified causal chain after the commit
    // falls outside the bounded context window. Never substitute an unrelated latest commit.
    const parentId=this.context.observation(series.parentId)?series.parentId:previous&&this.context.observation(previous)?previous:undefined;
    if(!parentId)return;
    series.attemptedStatus=status;
    const value:OutcomeObservation={...series.value,status,occurredAt,revision:previous?series.value.revision+1:1,...(previous?{supersedesId:previous}:{})};
    // Diagnostics cannot fail the creative operation. Failed deliveries are not retried on render.
    try{
      const id=this.context.outcome(value,{parentId,...(series.jobId?{jobId:series.jobId}:{}),...(series.eventIds?{eventIds:series.eventIds}:{})});
      if(id){series.value=value;series.observationId=id;series.confirmed=false;if(series.desired?.status===status)series.desired=undefined;}
    }catch{/* Saving work and receiving a file remain independent of optional history. */}
  }
  private create(parent:ActionObservationInput,type:OutcomeObservation['type'],target:WorkflowTarget,refs:{jobId?:string;eventIds?:string[]},startedAt:number){
    // Stable across reloads, omitted context rows, duplicate receipts and changed causal parents.
    // The server additionally scopes the series by owner, scope and consent epoch.
    const id=`operation:${refs.jobId?`job:${refs.jobId}`:`export:${refs.eventIds![0]}`}:${type}`;
    const series:Series={id,parentId:parent.id,...refs,value:{version:OUTCOME_OBSERVATION_VERSION,outcomeId:id,revision:1,type,status:'pending',target,occurredAt:new Date(this.now()).toISOString(),horizonStartedAt:new Date(startedAt).toISOString(),horizonMs:parent.outcome?.horizonMs??ACTION_OPERATION_HORIZON_MS}};
    this.remember(series);return series;
  }
  /** Called after the client has verified its acknowledged canonical receipt. */
  committed(scopeKey:string,parentIds:readonly string[],snapshot:OperationSnapshot):FileRetrievalTicket[]{
    if(!this.enter(scopeKey))return [];
    const tickets:FileRetrievalTicket[]=[];
    for(const parentId of parentIds){
      const parent=this.context.observation(parentId);
      if(!parent||parent.kind!=='commit'&&!(parent.outcome?.type==='acknowledged-commit'&&parent.outcome.status==='observed'))continue;
      const recordedAt=parent.outcome?Date.parse(parent.outcome.horizonStartedAt):'recordedAt' in parent?Date.parse(String(parent.recordedAt)):this.now();
      const startedAt=Number.isFinite(recordedAt)?recordedAt:this.now();
      if(startedAt<=this.now()-ACTION_RETENTION_MS)continue;
      if(parent.jobId){
        const job=snapshot.jobs.find(candidate=>candidate.jobId===parent.jobId&&(!parent.scope.documentId||candidate.documentId===parent.scope.documentId));
        const target:WorkflowTarget|undefined=parent.outcome?.target.kind==='document'?parent.outcome.target:job?.documentRevision?{kind:'document',id:job.documentId,revision:job.documentRevision}:undefined;
        if(!target)continue;
        if(!this.receipts.has(this.receiptKey('acknowledged-commit',parent.jobId))&&!this.receipts.has(this.receiptKey('completed-job',parent.jobId)))this.emit(this.create(parent,'acknowledged-commit',target,{jobId:parent.jobId},startedAt),'observed');
        if(!this.receipts.has(this.receiptKey('completed-job',parent.jobId))){
          const completion=this.create(parent,'completed-job',target,{jobId:parent.jobId},startedAt);
          this.emit(completion,this.jobStatus(completion,job?.documentId===target.id&&job.documentRevision===target.revision?job:undefined,snapshot));
        }
      }
      for(const eventId of parent.eventIds??[]){
        const event=snapshot.events.find(candidate=>candidate.eventId===eventId);
        const payload=event?.payload;
        let target:WorkflowTarget|undefined=parent.outcome&&['artifact','output'].includes(parent.outcome.target.kind)&&parent.eventIds?.length===1?parent.outcome.target:undefined;
        if(event?.type==='DocumentArtifactExported'&&payload&&typeof payload.artifact_id==='string'&&Number.isSafeInteger(payload.artifact_revision)&&Number(payload.artifact_revision)>=0)target={kind:'artifact',id:payload.artifact_id,revision:String(payload.artifact_revision)};
        // ObjectExported has no image-content revision. The target identifies this export receipt.
        if(event?.type==='ObjectExported'&&payload&&typeof payload.object_id==='string')target={kind:'output',id:payload.object_id,revision:event.eventId};
        if(!target)continue;
        if(!this.receipts.has(this.receiptKey('acknowledged-commit',undefined,eventId))&&!this.receipts.has(this.receiptKey('file-retrieved',undefined,eventId)))this.emit(this.create(parent,'acknowledged-commit',target,{eventIds:[eventId]},startedAt),'observed');
        if(!this.receipts.has(this.receiptKey('file-retrieved',undefined,eventId))){
          const file=this.create(parent,'file-retrieved',target,{eventIds:[eventId]},startedAt);
          this.emit(file,'pending');tickets.push({scopeKey,seriesId:file.id,target});
        }
      }
    }
    return tickets;
  }
  private jobStatus(series:Series,job:DocumentJob|undefined,snapshot:OperationSnapshot):OutcomeObservation['status']{
    if(job?.status==='completed')return 'observed';
    if(this.now()>=Date.parse(series.value.horizonStartedAt)+series.value.horizonMs)return 'censored';
    if(job)return ['queued','running','committing'].includes(job.status)?'pending':'unknown';
    return snapshot.jobsLoaded&&!snapshot.jobsError?'unknown':series.value.status;
  }
  /** Re-entry restores bounded evidence; missing jobs do not prove cancellation or failure. */
  reconcile(scopeKey:string,snapshot:OperationSnapshot){
    if(!this.enter(scopeKey))return;
    for(const row of this.context.value.observations??[]){
      const value=row.outcome;if(row.kind!=='outcome'||!value||!row.parentId||Date.parse(row.expiresAt)<=this.now())continue;
      if(!['acknowledged-commit','completed-job','file-retrieved'].includes(value.type))continue;
      const current=this.series.get(value.outcomeId);
      if(!current||current.value.revision<value.revision||current.value.revision===value.revision&&current.observationId!==row.id&&!current.confirmed)this.remember({id:value.outcomeId,parentId:row.parentId,...(row.jobId?{jobId:row.jobId}:{}),...(row.eventIds?{eventIds:row.eventIds}:{}),value,observationId:row.id,confirmed:true,...(current?.desired?{desired:current.desired}:{})});
      else if(current.observationId===row.id)current.confirmed=true;
    }
    this.committed(scopeKey,(this.context.value.observations??[]).filter(row=>(row.kind==='commit'||row.outcome?.type==='acknowledged-commit'&&row.outcome.status==='observed')&&Date.parse(row.expiresAt)>this.now()).map(row=>row.id),snapshot);
    for(const series of this.series.values()){
      if(['observed','revoked'].includes(series.value.status))continue;
      if(series.value.type==='completed-job'){
        const job=snapshot.jobs.find(candidate=>candidate.jobId===series.jobId&&candidate.documentId===series.value.target.id&&candidate.documentRevision===series.value.target.revision);
        this.emit(series,this.jobStatus(series,job,snapshot));
      }else if(series.value.type==='file-retrieved'){
        if(series.desired)this.emit(series,series.desired.status,series.desired.occurredAt);
        else if(this.now()>=Date.parse(series.value.horizonStartedAt)+series.value.horizonMs)this.emit(series,'censored');
      }
    }
  }
  /** Call only after obtaining a Blob and successfully handing it to the browser download API. */
  fileHandedOff(ticket:FileRetrievalTicket|undefined){this.fileStatus(ticket,'observed');}
  fileUnavailable(ticket:FileRetrievalTicket|undefined){this.fileStatus(ticket,'unknown');}
  private fileStatus(ticket:FileRetrievalTicket|undefined,status:'observed'|'unknown'){
    if(!ticket||ticket.scopeKey!==this.scopeKey||!this.available())return;
    const series=this.series.get(ticket.seriesId);
    if(series&&series.value.type==='file-retrieved'&&sameTarget(series.value.target,ticket.target)){series.desired={status,occurredAt:new Date(this.now()).toISOString()};this.emit(series,status,series.desired.occurredAt);}
  }
}

import type { ActionObservation, ActionObservationInput, ActionScope, StillGoal, WorkflowObservation, QualityAssessment, OutcomeObservation } from './action-outcomes.ts';

type Transport = <T>(path:string,body?:unknown,method?:string)=>Promise<T>;
export type ActionContext = {enabled:boolean;expiresAt?:string;goal?:StillGoal;directDecisionId?:string;directContextExpiresAt?:string;observations?:ActionObservation[];coverage?:{status?:'complete'|'unavailable'}};
type Invocation = {id:string;actionId:string;decisionId?:string;source:ActionObservationInput['source'];surface:string;scope:ActionScope;committed:boolean};
type ExposureTiming = {deliveryKey:string;interactiveLatencyMs:number};

/** Actor-private observations controlled by the account history preference. This never reads DOM attention or stores content. */
export class StillActionContext {
  value:ActionContext={enabled:false};
  loaded=false;
  error='';
  private identity='';
  private actorIdentity='';
  private observationEpoch=0;
  private scope:ActionScope={};
  private epoch=0;
  private readGeneration=0;
  private pending:Promise<unknown>=Promise.resolve();
  private exposed=new Map<string,string>();
  private exposureParents=new Map<string,{id:string;actions:string[]}>();
  private timedDeliveries=new Set<string>();
  private active?:Invocation;
  private renewing=false;
  private queued=new Map<string,ActionObservationInput>();
  private workflows=new Map<string,{actionId:string;decisionId:string;source:ActionObservationInput['source'];surface:string;scope:ActionScope;parentId?:string}>();
  get latestCommit(){return this.value.observations?.findLast(row=>row.kind==='commit'&&Date.parse(row.expiresAt)>Date.now());}
  constructor(private transport:Transport,private changed:()=>void=()=>{}){}
  enter(identity:string,scope:ActionScope){
    const key=JSON.stringify([identity,scope]);if(key===this.identity)return;
    if(identity!==this.actorIdentity){this.actorIdentity=identity;++this.observationEpoch;}
    this.identity=key;this.scope={...scope};++this.epoch;this.value={enabled:false};this.loaded=false;this.error='';this.active=undefined;this.workflows.clear();this.queued.clear();this.exposed.clear();this.exposureParents.clear();this.timedDeliveries.clear();
    if(identity)void this.refresh();
  }
  /** Retry an unavailable context without changing account preference or active creative attribution. */
  async refresh(){
    if(!this.actorIdentity)return;
    const epoch=this.epoch,observationEpoch=this.observationEpoch,readGeneration=++this.readGeneration;
    const current=()=>epoch===this.epoch&&observationEpoch===this.observationEpoch&&readGeneration===this.readGeneration;
    const query=new URLSearchParams(Object.entries(this.scope).filter((entry):entry is [string,string]=>typeof entry[1]==='string'&&!!entry[1]));
    try {
      const value=await this.transport<ActionContext>('/api/still/action-context?'+query);
      if(current()){this.acceptContext(value);this.loaded=true;this.changed();}
    } catch {if(current()){this.acceptContext({enabled:false,coverage:{status:'unavailable'}});this.loaded=true;this.changed();}}
  }
  async setEnabled(enabled:boolean){
    const epoch=this.epoch,observationEpoch=++this.observationEpoch,scope={...this.scope};
    this.value={...this.value,enabled:false};this.changed();await this.pending;
    if(epoch!==this.epoch)throw new Error('Workspace changed. Reopen User settings.');
    if(observationEpoch!==this.observationEpoch)throw new Error('Settings changed. Reopen User settings.');
    const value=await this.transport<ActionContext>('/api/still/action-context',{scope,enabled},'PUT').catch(()=>({enabled:false,coverage:{status:'unavailable'}} as ActionContext));
    if(epoch!==this.epoch)throw new Error('Workspace changed. Reopen User settings.');
    if(observationEpoch!==this.observationEpoch)throw new Error('Settings changed. Reopen User settings.');
    this.acceptContext(value);this.loaded=true;this.exposed.clear();this.exposureParents.clear();this.timedDeliveries.clear();this.active=undefined;this.workflows.clear();this.queued.clear();this.changed();
    if(value.coverage?.status==='unavailable')throw new Error('The change may have been saved, but the current settings could not be confirmed. Reopen User settings.');
  }
  async erase(){
    const epoch=this.epoch,observationEpoch=++this.observationEpoch,scope={...this.scope};
    this.value={...this.value,enabled:false};this.changed();await this.pending;
    if(epoch!==this.epoch)throw new Error('Workspace changed. Reopen User settings.');
    if(observationEpoch!==this.observationEpoch)throw new Error('Settings changed. Reopen User settings.');
    const value=await this.transport<ActionContext>('/api/still/action-context',{scope},'DELETE').catch(()=>({enabled:false,coverage:{status:'unavailable'}} as ActionContext));
    if(epoch!==this.epoch)throw new Error('Workspace changed. Reopen User settings.');
    if(observationEpoch!==this.observationEpoch)throw new Error('Settings changed. Reopen User settings.');
    this.acceptContext(value);this.loaded=true;this.exposed.clear();this.exposureParents.clear();this.timedDeliveries.clear();this.active=undefined;this.workflows.clear();this.queued.clear();this.changed();
    if(value.coverage?.status==='unavailable')throw new Error('The change may have been saved, but the current settings could not be confirmed. Reopen User settings.');
  }
  async saveGoal(text:string,criteria:string[]){
    const epoch=this.epoch;
    const value=await this.transport<{goal:StillGoal}>('/api/still/goal',{scope:this.scope,text,criteria,remember:true},'PUT');
    if(epoch!==this.epoch)throw new Error('Workspace changed. Reopen suggestion settings.');
    ++this.readGeneration;this.value={...this.value,goal:value.goal};this.changed();
  }
  async finishGoal(status:'completed'|'abandoned'|'clear'){
    const goal=this.value.goal;if(!goal)return;
    const epoch=this.epoch;
    await this.transport('/api/still/goal',{scope:this.scope,id:goal.id,...(status==='clear'?{}:{status})},status==='clear'?'DELETE':'POST');
    if(epoch!==this.epoch)throw new Error('Workspace changed. Reopen suggestion settings.');
    ++this.readGeneration;this.value={...this.value,goal:undefined};this.changed();
  }
  /** Called only once controls are interactive, never on receipt or inert probes. */
  exposure(decisionId:string|undefined,displayedActionIds:string[],surface:string,source:ActionObservationInput['source'],primaryActionId?:string,timing?:ExposureTiming){
    if(!this.value.enabled||!decisionId||!displayedActionIds.length)return;
    const primary=primaryActionId&&displayedActionIds.includes(primaryActionId)?primaryActionId:undefined;
    const deliveryKey=timing?`${decisionId}/${timing.deliveryKey}`:undefined;
    const key=JSON.stringify([decisionId,displayedActionIds,surface,source,primary,deliveryKey]);
    if(this.exposed.has(key))return;
    const interactiveLatencyMs=deliveryKey&&!this.timedDeliveries.has(deliveryKey)&&timing&&Number.isFinite(timing.interactiveLatencyMs)&&timing.interactiveLatencyMs>=0&&timing.interactiveLatencyMs<=300000?Math.round(timing.interactiveLatencyMs):undefined;
    const id=this.observe({kind:'exposure',decisionId,displayedActionIds,surface,source,...(primary?{primaryActionId:primary}:{}),...(interactiveLatencyMs!==undefined?{interactiveLatencyMs}:{})});
    if(id){this.exposed.set(key,id);this.exposureParents.set(`${decisionId}/${source}`,{id,actions:displayedActionIds});if(deliveryKey)this.timedDeliveries.add(deliveryKey);}
  }
  select(actionId:string,decisionId:string|undefined,surface:string,source:ActionObservationInput['source'],options:{preserveInvocation?:boolean}={}){
    if(!this.value.enabled)return;
    const exposure=decisionId?this.exposureParents.get(`${decisionId}/${source}`):undefined;
    if(!exposure?.actions.includes(actionId)){
      source='direct';decisionId=this.value.directDecisionId;
      if(!decisionId||!this.value.directContextExpiresAt||Date.parse(this.value.directContextExpiresAt)<=Date.now()){if(!options.preserveInvocation)this.active=undefined;this.renewDirectContext();return;}
    }
    const parentId=this.observe({kind:'selection',actionId,decisionId,surface,source,...(exposure?.actions.includes(actionId)?{parentId:exposure.id}:{})});
    const id=this.observe({kind:'invocation',actionId,decisionId,surface,source,parentId});
    if(id&&!options.preserveInvocation)this.active={id,actionId,decisionId,surface,source,scope:{...this.scope},committed:false};
  }
  commit(receipt:{eventIds?:string[];jobId?:string}):string[]{
    const active=this.active;
    if(!active||!receipt.eventIds?.length&&!receipt.jobId)return [];
    const ids:string[]=[];
    const events=[...new Set(receipt.eventIds??[])];
    if(receipt.jobId){const id=this.observe({...active,kind:'commit',parentId:active.id,jobId:receipt.jobId});if(id)ids.push(id);}
    for(let index=0;index<events.length;index+=24){const id=this.observe({...active,kind:'commit',parentId:active.id,eventIds:events.slice(index,index+24)});if(id)ids.push(id);}
    active.committed=true;return ids;
  }
  cancel(){
    if(this.active&&!this.active.committed)this.observe({...this.active,kind:'cancellation',parentId:this.active.id});
    this.active=undefined;
  }
  finish(){this.active=undefined;}
  failed(){
    if(this.active)this.observe({...this.active,kind:'failure',parentId:this.active.id});
  }
  async feedback(actionId:string,decisionId:string|undefined,feedback:NonNullable<ActionObservationInput['feedback']>,surface:string,source:ActionObservationInput['source'],expiresAt:string,parentId?:string){
    const epoch=this.epoch;this.error='';
    if(!this.value.enabled)throw new Error('Enable suggestion history before saving feedback.');
    if(!decisionId){decisionId=this.value.directDecisionId;source='direct';}
    if(!decisionId){this.renewDirectContext();throw new Error('Action history is refreshing. Try saving feedback again.');}
    const id=this.observe({kind:'feedback',actionId,decisionId,feedback,surface,source,parentId,...(this.scope.documentId?{feedbackScope:'document' as const}:this.scope.projectId?{feedbackScope:'project' as const}:decisionId?{feedbackScope:'decision' as const}:{}),feedbackExpiresAt:expiresAt});
    if(!id)throw new Error('Suggestion history is refreshing. Try saving feedback again.');
    await this.pending;
    if(epoch!==this.epoch)throw new Error('Workspace changed. Reopen suggestion settings.');
    if(this.error)throw new Error(this.error);
  }
  /** A workflow retains its entry attribution; each transition carries its own target revision. */
  workflow(actionId:string,workflow:WorkflowObservation,parentId?:string){
    if(!this.value.enabled)return;
    let link=this.workflows.get(workflow.instanceId);
    if(!link){
      const active=this.active?.actionId===actionId?this.active:undefined;
      const decisionId=active?.decisionId??this.value.directDecisionId;
      if(!decisionId||!active&&(!this.value.directContextExpiresAt||Date.parse(this.value.directContextExpiresAt)<=Date.now())){this.renewDirectContext();return;}
      link={actionId,decisionId,source:active?.source??'direct',surface:'creation',scope:{...(active?.scope??this.scope)},parentId:active?.id};
      if(this.workflows.size>=10)this.workflows.delete(this.workflows.keys().next().value!);
      this.workflows.set(workflow.instanceId,link);
    }
    const id=this.observe({...link,kind:'workflow',workflow,parentId:parentId??link.parentId});
    if(id)link.parentId=id;
    return id;
  }
  observation(id:string){return this.value.observations?.find(row=>row.id===id)??this.queued.get(id);}
  outcome(outcome:OutcomeObservation,refs:{parentId?:string;eventIds?:string[];jobId?:string}={}){
    const parent=refs.parentId?this.observation(refs.parentId):outcome.workflowInstanceId?undefined:this.latestCommit;
    const link=outcome.workflowInstanceId?this.workflows.get(outcome.workflowInstanceId):undefined;
    if(!parent&&!link)return;
    const actionId=parent?.actionId??link?.actionId;if(!actionId)return;
    return this.observe({kind:'outcome',outcome,actionId,decisionId:parent?.decisionId??link?.decisionId,source:parent?.source??link!.source,surface:parent?.surface??link!.surface,scope:parent?.scope??link!.scope,parentId:parent?.id??link?.parentId,...(refs.eventIds?{eventIds:refs.eventIds}:{}),...(refs.jobId?{jobId:refs.jobId}:{})});
  }
  /** Explicit assessment only. No approval, download or navigation calls this implicitly. */
  async assess(actionId:string,assessment:QualityAssessment,parentId?:string){
    if(!this.value.enabled)throw new Error('Enable suggestion history before saving an assessment.');
    const link=assessment.workflowInstanceId?this.workflows.get(assessment.workflowInstanceId):undefined;
    const previous=assessment.supersedesId?this.value.observations?.find(row=>row.id===assessment.supersedesId&&row.kind==='assessment'):parentId?this.observation(parentId):undefined;
    if(!link&&!previous)throw new Error('Reopen the current review before saving an assessment.');
    const epoch=this.epoch;
    const id=this.observe({actionId,kind:'assessment',assessment,decisionId:previous?.decisionId??link?.decisionId,source:previous?.source??link!.source,surface:previous?.surface??link!.surface,scope:previous?.scope??link!.scope,parentId:previous?.id??link?.parentId});
    if(!id)throw new Error('Suggestion history is refreshing. Try saving the assessment again.');
    await this.pending;
    if(epoch!==this.epoch)throw new Error('Workspace changed. Reopen the current review.');
    const saved=this.value.observations?.find(row=>row.id===id);
    if(!saved)throw new Error(this.error||'The assessment could not be confirmed.');
    return saved;
  }
  private observe(input:Omit<ActionObservationInput,'id'|'scope'> & {scope?:ActionScope}):string|undefined{
    if(!this.loaded||!this.value.enabled)return;
    if(this.value.expiresAt&&Date.parse(this.value.expiresAt)<=Date.now()){++this.observationEpoch;this.value={...this.value,enabled:false};this.active=undefined;this.workflows.clear();this.queued.clear();this.exposed.clear();this.exposureParents.clear();this.timedDeliveries.clear();this.renewDirectContext();return;}
    const epoch=this.observationEpoch,contextEpoch=this.epoch,id=crypto.randomUUID();
    // Shape explicitly: internal invocation bookkeeping is never API evidence.
    const row:ActionObservationInput={id,scope:{...(input.scope??this.scope)},kind:input.kind,surface:input.surface,source:input.source,
      ...(input.decisionId?{decisionId:input.decisionId}:{}),...(input.actionId?{actionId:input.actionId}:{}),...(input.parentId?{parentId:input.parentId}:{}),
      ...(input.eventIds?{eventIds:input.eventIds}:{}),...(input.jobId?{jobId:input.jobId}:{}),...(input.feedback?{feedback:input.feedback}:{}),
      ...(input.displayedActionIds?{displayedActionIds:input.displayedActionIds}:{}),
      ...(input.primaryActionId?{primaryActionId:input.primaryActionId}:{}),
      ...(input.interactiveLatencyMs!==undefined?{interactiveLatencyMs:input.interactiveLatencyMs}:{}),
      ...(input.workflow?{workflow:structuredClone(input.workflow)}:{}),...(input.assessment?{assessment:structuredClone(input.assessment)}:{}),...(input.outcome?{outcome:structuredClone(input.outcome)}:{}),
      ...(input.feedbackScope?{feedbackScope:input.feedbackScope}:{}),...(input.feedbackExpiresAt?{feedbackExpiresAt:input.feedbackExpiresAt}:{}),
    };
    if(this.queued.size>=80)this.queued.delete(this.queued.keys().next().value!);
    this.queued.set(id,row);
    this.pending=this.pending.then(async()=>{
      if(epoch!==this.observationEpoch)return;
      let result:{observation?:ActionObservation};
      try{result=await this.transport('/api/still/action-observations',row);}catch(error){const status=(error as {status?:number})?.status;if(epoch!==this.observationEpoch||status!==undefined&&status!==408&&status!==429&&status<500)throw error;result=await this.transport('/api/still/action-observations',row);}
      if(epoch===this.observationEpoch&&contextEpoch===this.epoch&&result.observation){this.value={...this.value,observations:[...(this.value.observations??[]),result.observation].slice(-40)};this.changed();}
    }).catch(()=>{if(epoch===this.observationEpoch){for(const [key,link] of this.workflows)if(link.parentId===id)this.workflows.delete(key);this.error='Some suggestion history could not be saved.';this.changed();}});
    return id;
  }
  /** Awaitable for focused deterministic tests and explicit data deletion. */
  flush(){return this.pending;}
  private acceptContext(value:ActionContext){
    if(value.coverage?.status==='unavailable'){this.value={enabled:false,coverage:value.coverage};this.error='Suggestion history is unavailable.';}
    else {this.value=value;this.error='';}
  }
  private renewDirectContext(){
    if(this.renewing)return;
    this.renewing=true;void this.refresh().finally(()=>{this.renewing=false;});
  }
}

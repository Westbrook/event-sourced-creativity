import type { ActionObservation, ActionObservationInput, ActionScope, StillGoal } from './action-outcomes.ts';

type Transport = <T>(path:string,body?:unknown,method?:string)=>Promise<T>;
export type ActionContext = {enabled:boolean;expiresAt?:string;goal?:StillGoal;directDecisionId?:string;directContextExpiresAt?:string;observations?:ActionObservation[]};
type Invocation = {id:string;actionId:string;decisionId?:string;source:ActionObservationInput['source'];surface:string;scope:ActionScope;committed:boolean};
type ExposureTiming = {deliveryKey:string;interactiveLatencyMs:number};

/** Actor-private, opt-in observations. This never reads DOM attention or stores content. */
export class StillActionContext {
  value:ActionContext={enabled:false};
  loaded=false;
  error='';
  private identity='';
  private actorIdentity='';
  private observationEpoch=0;
  private scope:ActionScope={};
  private epoch=0;
  private pending:Promise<unknown>=Promise.resolve();
  private exposed=new Map<string,string>();
  private exposureParents=new Map<string,{id:string;actions:string[]}>();
  private timedDeliveries=new Set<string>();
  private active?:Invocation;
  private renewing=false;
  get latestCommit(){return this.value.observations?.findLast(row=>row.kind==='commit'&&Date.parse(row.expiresAt)>Date.now());}
  constructor(private transport:Transport,private changed:()=>void=()=>{}){}
  enter(identity:string,scope:ActionScope){
    const key=JSON.stringify([identity,scope]);if(key===this.identity)return;
    if(identity!==this.actorIdentity){this.actorIdentity=identity;++this.observationEpoch;}
    this.identity=key;this.scope={...scope};++this.epoch;this.value={enabled:false};this.loaded=false;this.error='';this.active=undefined;this.exposed.clear();this.exposureParents.clear();this.timedDeliveries.clear();
    if(!identity)return;
    const epoch=this.epoch;
    const query=new URLSearchParams(Object.entries(scope).filter((entry):entry is [string,string]=>typeof entry[1]==='string'&&!!entry[1]));
    void this.transport<ActionContext>('/api/still/action-context?'+query).then(value=>{if(epoch===this.epoch){this.value=value;this.loaded=true;this.changed();}}).catch(()=>{if(epoch===this.epoch){this.loaded=true;this.error='Suggestion history is unavailable.';this.changed();}});
  }
  async setEnabled(enabled:boolean){
    const epoch=this.epoch,scope={...this.scope};
    if(!enabled){this.value={...this.value,enabled:false};++this.observationEpoch;await this.pending;}
    if(epoch!==this.epoch)throw new Error('Workspace changed. Reopen suggestion settings.');
    const value=await this.transport<ActionContext>('/api/still/action-context',{scope,enabled},'PUT');
    if(epoch!==this.epoch)throw new Error('Workspace changed. Reopen suggestion settings.');
    this.value={...value,enabled};this.error='';this.exposed.clear();this.exposureParents.clear();this.timedDeliveries.clear();this.active=undefined;this.changed();
  }
  async erase(){
    const epoch=this.epoch,scope={...this.scope};
    this.value={...this.value,enabled:false};++this.observationEpoch;await this.pending;
    if(epoch!==this.epoch)throw new Error('Workspace changed. Reopen suggestion settings.');
    await this.transport('/api/still/action-context',{scope},'DELETE');
    if(epoch!==this.epoch)throw new Error('Workspace changed. Reopen suggestion settings.');
    this.value={enabled:false};this.exposed.clear();this.exposureParents.clear();this.timedDeliveries.clear();this.active=undefined;this.error='';this.changed();
  }
  async saveGoal(text:string,criteria:string[]){
    const epoch=this.epoch;
    const value=await this.transport<{goal:StillGoal}>('/api/still/goal',{scope:this.scope,text,criteria,remember:true},'PUT');
    if(epoch!==this.epoch)throw new Error('Workspace changed. Reopen suggestion settings.');
    this.value={...this.value,goal:value.goal};this.changed();
  }
  async finishGoal(status:'completed'|'abandoned'|'clear'){
    const goal=this.value.goal;if(!goal)return;
    const epoch=this.epoch;
    await this.transport('/api/still/goal',{scope:this.scope,id:goal.id,...(status==='clear'?{}:{status})},status==='clear'?'DELETE':'POST');
    if(epoch!==this.epoch)throw new Error('Workspace changed. Reopen suggestion settings.');
    this.value={...this.value,goal:undefined};this.changed();
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
  select(actionId:string,decisionId:string|undefined,surface:string,source:ActionObservationInput['source']){
    if(!this.value.enabled)return;
    const exposure=decisionId?this.exposureParents.get(`${decisionId}/${source}`):undefined;
    if(!exposure?.actions.includes(actionId)){
      source='direct';decisionId=this.value.directDecisionId;
      if(!decisionId||!this.value.directContextExpiresAt||Date.parse(this.value.directContextExpiresAt)<=Date.now()){this.active=undefined;this.renewDirectContext();return;}
    }
    const parentId=this.observe({kind:'selection',actionId,decisionId,surface,source,...(exposure?.actions.includes(actionId)?{parentId:exposure.id}:{})});
    const id=this.observe({kind:'invocation',actionId,decisionId,surface,source,parentId});
    if(id)this.active={id,actionId,decisionId,surface,source,scope:{...this.scope},committed:false};
  }
  commit(receipt:{eventIds?:string[];jobId?:string}){
    const active=this.active;
    if(!active||!receipt.eventIds?.length&&!receipt.jobId)return;
    const events=[...new Set(receipt.eventIds??[])];
    if(receipt.jobId)this.observe({...active,kind:'commit',parentId:active.id,jobId:receipt.jobId});
    for(let index=0;index<events.length;index+=24)this.observe({...active,kind:'commit',parentId:active.id,eventIds:events.slice(index,index+24)});
    active.committed=true;
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
    if(!id)throw new Error('Suggestion history expired. Enable it again to save feedback.');
    await this.pending;
    if(epoch!==this.epoch)throw new Error('Workspace changed. Reopen suggestion settings.');
    if(this.error)throw new Error(this.error);
  }
  private observe(input:Omit<ActionObservationInput,'id'|'scope'> & {scope?:ActionScope}):string|undefined{
    if(!this.loaded||!this.value.enabled||this.value.expiresAt&&Date.parse(this.value.expiresAt)<=Date.now())return;
    const epoch=this.observationEpoch,contextEpoch=this.epoch,id=crypto.randomUUID();
    // Shape explicitly: internal invocation bookkeeping is never API evidence.
    const row:ActionObservationInput={id,scope:{...(input.scope??this.scope)},kind:input.kind,surface:input.surface,source:input.source,
      ...(input.decisionId?{decisionId:input.decisionId}:{}),...(input.actionId?{actionId:input.actionId}:{}),...(input.parentId?{parentId:input.parentId}:{}),
      ...(input.eventIds?{eventIds:input.eventIds}:{}),...(input.jobId?{jobId:input.jobId}:{}),...(input.feedback?{feedback:input.feedback}:{}),
      ...(input.displayedActionIds?{displayedActionIds:input.displayedActionIds}:{}),
      ...(input.primaryActionId?{primaryActionId:input.primaryActionId}:{}),
      ...(input.interactiveLatencyMs!==undefined?{interactiveLatencyMs:input.interactiveLatencyMs}:{}),
      ...(input.feedbackScope?{feedbackScope:input.feedbackScope}:{}),...(input.feedbackExpiresAt?{feedbackExpiresAt:input.feedbackExpiresAt}:{}),
    };
    this.pending=this.pending.then(async()=>{
      if(epoch!==this.observationEpoch)return;
      const result=await this.transport<{observation?:ActionObservation}>('/api/still/action-observations',row);
      if(contextEpoch===this.epoch&&result.observation){this.value={...this.value,observations:[...(this.value.observations??[]),result.observation].slice(-40)};this.changed();}
    }).catch(()=>{if(epoch===this.observationEpoch){this.error='Some suggestion history could not be saved.';this.changed();}});
    return id;
  }
  /** Awaitable for focused deterministic tests and explicit data deletion. */
  flush(){return this.pending;}
  private renewDirectContext(){
    if(this.renewing)return;
    this.renewing=true;const epoch=this.epoch;
    const query=new URLSearchParams(Object.entries(this.scope).filter((entry):entry is [string,string]=>typeof entry[1]==='string'&&!!entry[1]));
    void this.transport<ActionContext>('/api/still/action-context?'+query).then(value=>{if(epoch===this.epoch){this.value=value;this.changed();}}).catch(()=>{if(epoch===this.epoch){this.error='Action attribution is unavailable; your work is unaffected.';this.changed();}}).finally(()=>{this.renewing=false;});
  }
}

import { DecisionMemo, stableDecisionKey } from './decision-cache.ts';
import { onboardingInput, ONBOARDING_VERSION, type OnboardingInput, type OnboardingResult } from './onboarding.ts';
export type OnboardingStatus={source:'local'|'pending'|'model';reason?:string;model?:string;elapsedMs?:number;cache?:OnboardingResult['cache']};
/** One batch per settled toolbar, opt-in only; route/scope changes fence late responses. */
export class OnboardingController{
 private memo=new DecisionMemo<OnboardingResult>({accept:r=>r.source==='model',maxEntries:24,maxBytes:64000,ttl:r=>r.cache?.remainingMs??300000});
 private key='';private scope='';private ticket=0;private timer:ReturnType<typeof setTimeout>|undefined;
 private tips:Record<string,string>={};
 status:OnboardingStatus={source:'local'};
 constructor(private request:(input:OnboardingInput&{enabled:true})=>Promise<OnboardingResult>,private changed:()=>void,private delay=350){}
 update(scope:string,raw:unknown){
  if(scope!==this.scope){this.memo.clear();this.scope=scope;this.key='';this.cancel();}
  const input=onboardingInput(raw),key=input?stableDecisionKey({version:ONBOARDING_VERSION,scope,input}):'';
  if(key===this.key)return;
  this.key=key;this.cancel();this.changed();if(!input)return;
  const ticket=this.ticket;
  this.timer=setTimeout(()=>{this.status={source:'pending'};this.changed();void this.memo.run(key,()=>this.request({...input,enabled:true})).then(({value,cache})=>{
   if(ticket!==this.ticket)return;
   this.tips=value.tips;this.status={source:value.source,reason:value.reason,model:value.model,elapsedMs:value.requestElapsedMs??value.elapsedMs,cache:cache.status==='hit'||cache.status==='shared'?{...cache,layer:'browser'}:value.cache};this.changed();
  }).catch(()=>{if(ticket===this.ticket){this.status={source:'local',reason:'unavailable'};this.changed();}});},this.delay);
 }
 help(scope:string,id:string){return scope===this.scope?this.tips[id]:undefined;}
 private cancel(){clearTimeout(this.timer);++this.ticket;this.tips={};this.status={source:'local'};}
 dispose(){this.cancel();this.key='';this.scope='';this.memo.clear();}
}

import { ACTIONS } from '../src/still/decisions.ts';
import { actionHelp, ONBOARDING_MODEL, ONBOARDING_VERSION, onboardingInput, type OnboardingTiming, type OnboardingResult } from '../src/still/onboarding.ts';
import { DecisionMemo, stableDecisionKey } from '../src/still/decision-cache.ts';
import { assistantModelCostMicrousd } from '../src/model/assistant-model-policy.ts';
import { requireConsent, requireUser, reserveBudget, reserveCostBudget, releaseBudget, releaseCostBudget, settleBudget, settleCostBudget } from './pilot-policy.ts';
import {readProjectRequestContext} from './project-request-context.ts';
import {readOnboardingCache,writeOnboardingCache,validOnboardingTips} from './still-onboarding-store.ts';
import type { WorkerEnv, WorkerExecutionContext } from './runtime.ts';

const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'private, no-store',vary:'Cookie, oai-authenticated-user-id'}});
const caches=new WeakMap<object,DecisionMemo<OnboardingResult>>();
const calls=new WeakMap<object,Map<string,number>>();
const outputLimit=1024;
/** UI wording only: no creative bodies, event reads, tools, or generation authority. */
export async function handleStillOnboarding(request:Request,env:WorkerEnv,_context:WorkerExecutionContext){
 const started=Date.now();
 const timing:OnboardingTiming={authorizationMs:0,preparationMs:0,cacheReadMs:0,reservationMs:0,providerMs:0,settlementMs:0,cacheWriteMs:0,serverMs:0,cacheSource:'none'};
 const finishBoth=async(operations:Promise<unknown>[])=>{const results=await Promise.allSettled(operations);const failed=results.find(result=>result.status==='rejected');if(failed?.status==='rejected')throw failed.reason;};
 const measure=async<T>(field:keyof Pick<OnboardingTiming,'cacheReadMs'|'reservationMs'|'providerMs'|'settlementMs'|'cacheWriteMs'>,operation:()=>Promise<T>)=>{const at=Date.now();try{return await operation();}finally{timing[field]+=Date.now()-at;}};
 if(request.method!=='POST')return reply({error:'method_not_allowed'},405);
 const auth=await requireUser(request,env);if(auth.response||!auth.user)return auth.response!;
 const consent=requireConsent(auth.user);if(consent)return consent;
 // Impersonated test personas must never spend the principal's money implicitly.
 if(auth.impersonation)return reply({source:'local',reason:'impersonation',tips:{}});
 // Only the selected project resolver is needed here; building a complete session
 // adds unrelated metadata and volatile fields to the cache identity.
 const selected=await readProjectRequestContext(request,env,auth.user);
 if(selected.response)return selected.response;
 timing.authorizationMs=Date.now()-started;
 const prepared=Date.now();
 const raw=await request.text();if(raw.length>2000)return reply({error:'request_too_large'},413);
 let input;try{input=onboardingInput(JSON.parse(raw));}catch{return reply({error:'invalid_json'},400);}
 if(!input)return reply({error:'invalid_onboarding'},400);
 if(!env.OPENAI_API_KEY)return reply({source:'local',reason:'not_configured',tips:{}});
 const model=ONBOARDING_MODEL,user=auth.user;
 const descriptors=input.actions.map(id=>{const a=ACTIONS.find(a=>a.id===id)!;return{id,label:a.label,behavior:actionHelp(id,a.label)};});
 const payload={model,store:false,reasoning:{effort:'low'},max_output_tokens:outputLimit,
  instructions:[
   'Write onboarding tooltips for Still, a minimal creative application. Blend what each action does with why it is useful here, now, in one natural sentence of at most 22 words and 180 characters.',
   'Use the supplied behavior as the authority for effects, and the optional context as bounded observations for relevance. Teach a reusable concept while grounding it in the current page, selected idea, available content, or recent actions. Prefer one relevant observation over a list. If evidence is sparse, use a factual page-specific benefit; do not invent a personal motive.',
   'Context basis describes how the control was offered: next-best is an accepted model choice; model-ranked is ranked by the model; page-default/local are deterministic; alternative is the More toolbar. Do not claim a model chose a local control, expose scores, mention algorithms, or describe any option as the only right next step.',
   'Recent actions are selections, not successful outcomes, except completed: markers. More/palette means alternatives were opened, not frustration or rejection. Available counts cover loaded content; when historyComplete is false, zero does not prove no content exists. Listing entries already let the user open existing projects/documents; toolbar creation actions offer a separate direction, not a required next step.',
   'Conditional writing examples, not facts about this user: New document within a project: "Start a separate idea in this project while keeping your existing documents together." Split context with a selected idea: "Break this idea into smaller parts so you can change or reuse each detail independently." Results after a completed generation: "Review what you made to decide what to keep or change next."',
   'Do not invent effects, completed work, content details, problems, promises, automatic approvals, prices, or permissions. Do not claim generation is free or bypasses review. No emoji or decorative symbols; use plain text. No links, Markdown, headings, persuasion, or repetitive "Still offered this because" phrasing. Return exactly the supplied action IDs. These are explanations, not new recommendations or permissions.',
  ].join('\n'),
  input:JSON.stringify({page:input.view,language:input.locale,actions:descriptors,...(input.context?{context:input.context}:{})}),
  text:{verbosity:'low',format:{type:'json_schema',name:'still_onboarding',strict:true,schema:{type:'object',additionalProperties:false,required:input.actions,properties:Object.fromEntries(input.actions.map(id=>[id,{type:'string',minLength:1,maxLength:180}]))}}},
 };
 const body=JSON.stringify(payload),inputLimit=new TextEncoder().encode(body).length+512;
 const keyBytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stableDecisionKey({version:ONBOARDING_VERSION,user:user.userId,stream:user.streamId,role:user.role,capabilities:[...user.access.capabilities].sort(),consent:user.consentVersion,
  projectScope:selected.context?{organizationId:selected.context.organizationId,projectAccessId:selected.context.projectAccessId,projectId:selected.context.projectId,owner:selected.context.ownerUserId,role:selected.context.role,permissions:selected.context.permissions}:null,
  body,provider:env.OPENAI_API_KEY,project:env.OPENAI_PROJECT??null})));
 const key=Array.from(new Uint8Array(keyBytes),x=>x.toString(16).padStart(2,'0')).join('');
 let cache=caches.get(env.DB);if(!cache){cache=new DecisionMemo<OnboardingResult>({accept:r=>r.source==='model',ttl:r=>r.cache?.remainingMs??300000,latency:r=>r.elapsedMs,maxEntries:64,maxBytes:128000});caches.set(env.DB,cache);}
 timing.preparationMs=Date.now()-prepared;
 let durableHit:Awaited<ReturnType<typeof readOnboardingCache>>;
 const result=await cache.run(key,async()=>{
  durableHit=await measure('cacheReadMs',()=>readOnboardingCache(env,key,user.userId,input.actions));
  if(durableHit)return {...durableHit.value,cache:{layer:'server' as const,status:'hit' as const,ageMs:Date.now()-durableHit.createdAt,remainingMs:Math.max(0,durableHit.expiresAt-Date.now()),originalLatencyMs:durableHit.value.elapsedMs??0,stored:true}};
  const fallback=(reason:string):OnboardingResult=>({source:'local',reason,tips:{},model,elapsedMs:Date.now()-started});
  let recent=calls.get(env.DB);if(!recent){recent=new Map();calls.set(env.DB,recent);}
  const now=Date.now();if((recent.get(user.userId)??0)>now-3000)return fallback('cooldown');
  recent.set(user.userId,now);for(const [id,at]of recent)if(at<now-60000)recent.delete(id);while(recent.size>500)recent.delete(recent.keys().next().value!);
  const correlationId=crypto.randomUUID(),budgetContext={streamId:user.streamId,correlationId,operation:'still-onboarding'};
  const maximum=assistantModelCostMicrousd(model,inputLimit,outputLimit);
  // Separate ledgers can reserve concurrently. Neither failure may dispatch work;
  // release the successful sibling if the other reservation was denied or failed.
  const [tokenAttempt,costAttempt]=await measure('reservationMs',()=>Promise.allSettled([
   reserveBudget(env,user.userId,inputLimit+outputLimit,budgetContext),
   reserveCostBudget(env,user.userId,maximum,{...budgetContext,maximumMicrousd:maximum,allowUserOverage:false}),
  ]));
  const tokens=tokenAttempt.status==='fulfilled'?tokenAttempt.value:null;
  const cost=costAttempt.status==='fulfilled'?costAttempt.value:null;
  if(!tokens?.ok||!cost?.ok){
   await measure('settlementMs',()=>finishBoth([
    tokens?.ok?releaseBudget(env,user.userId,tokens.reservationId):Promise.resolve(),
    cost?.ok?releaseCostBudget(env,user.userId,cost.reservationId):Promise.resolve(),
   ]));
   return fallback('budget');
  }
  // One provider submission. Ambiguous completion retains its small budget holds;
  // no automatic retries and no fabricated zero-cost or usage receipt.
  let provider:Response;
  try{provider=await measure('providerMs',()=>fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:`Bearer ${env.OPENAI_API_KEY}`,'content-type':'application/json',...(env.OPENAI_PROJECT?{'OpenAI-Project':env.OPENAI_PROJECT}:{})},body,signal:AbortSignal.timeout(4000)}));}
  catch{return fallback('unconfirmed');}
  if(!provider.ok){
   if(provider.status>=400&&provider.status<500){await measure('settlementMs',()=>finishBoth([releaseBudget(env,user.userId,tokens.reservationId),releaseCostBudget(env,user.userId,cost.reservationId)]));return fallback('unavailable');}
   return fallback('unconfirmed');
  }
  try{
   const data=await measure('providerMs',()=>provider.json()) as {status?:string;model?:string;output_text?:string;output?:{content?:{type?:string;text?:string}[]}[];usage?:{input_tokens?:number;output_tokens?:number;total_tokens?:number}};
   const i=data.usage?.input_tokens,o=data.usage?.output_tokens,total=data.usage?.total_tokens;
   if(!Number.isSafeInteger(i)||!Number.isSafeInteger(o)||i!<0||o!<0||i!>inputLimit||o!>outputLimit||total!==i!+o!)return fallback('usage_unconfirmed');
   await measure('settlementMs',()=>finishBoth([settleBudget(env,user.userId,tokens.reservationId,total!),settleCostBudget(env,user.userId,cost.reservationId,assistantModelCostMicrousd(model,i!,o!))]));
   if(data.status&&data.status!=='completed')return fallback('incomplete');
   const text=data.output_text??data.output?.flatMap(x=>x.content??[]).filter(x=>x.type==='output_text').map(x=>x.text??'').join('')??'';
   const tips=JSON.parse(text) as Record<string,unknown>;
   if(!validOnboardingTips(tips,input.actions))return fallback('invalid_response');
   const value:OnboardingResult={source:'model',tips:Object.fromEntries(input.actions.map(id=>[id,tips[id].trim()])),model,elapsedMs:Date.now()-started};
   await measure('cacheWriteMs',()=>writeOnboardingCache(env,key,user.userId,value));
   return value;
  }catch{return fallback('unavailable');}
 });
 const cacheInfo=durableHit?{status:'hit' as const,ageMs:Math.max(0,Date.now()-durableHit.createdAt),remainingMs:Math.max(0,durableHit.expiresAt-Date.now()),originalLatencyMs:durableHit.value.elapsedMs??0,stored:true}:result.cache;
 timing.cacheSource=durableHit?'durable':result.cache.status==='hit'?'memory':result.cache.status==='shared'?'shared':'none';
 timing.serverMs=Date.now()-started;
 const response=reply({...result.value,cache:{...cacheInfo,layer:'server'},timing,requestElapsedMs:timing.serverMs});
 response.headers.set('Server-Timing',Object.entries(timing).filter(([key,value])=>key.endsWith('Ms')&&typeof value==='number').map(([key,value])=>`${key.slice(0,-2)};dur=${value}`).join(', '));
 return response;
}

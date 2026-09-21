import { ACTIONS } from '../src/still/decisions.ts';
import { actionHelp, ONBOARDING_MODEL, ONBOARDING_VERSION, onboardingInput, type OnboardingResult } from '../src/still/onboarding.ts';
import { DecisionMemo, stableDecisionKey } from '../src/still/decision-cache.ts';
import { assistantModelCostMicrousd } from '../src/model/assistant-model-policy.ts';
import { handleSession, requireConsent, requireUser, reserveBudget, reserveCostBudget, releaseBudget, releaseCostBudget, settleBudget, settleCostBudget } from './pilot-policy.ts';
import type { WorkerEnv, WorkerExecutionContext } from './runtime.ts';

const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'private, no-store',vary:'Cookie, oai-authenticated-user-id'}});
const caches=new WeakMap<object,DecisionMemo<OnboardingResult>>();
const calls=new WeakMap<object,Map<string,number>>();
const outputLimit=1024;
/** UI wording only: no creative bodies, event reads, tools, or generation authority. */
export async function handleStillOnboarding(request:Request,env:WorkerEnv,context:WorkerExecutionContext){
 if(request.method!=='POST')return reply({error:'method_not_allowed'},405);
 const auth=await requireUser(request,env);if(auth.response||!auth.user)return auth.response!;
 const consent=requireConsent(auth.user);if(consent)return consent;
 // Impersonated test personas must never spend the principal's money implicitly.
 if(auth.impersonation)return reply({source:'local',reason:'impersonation',tips:{}});
 const sessionResponse=await handleSession(new Request(new URL('/api/session?profile=still',request.url),{headers:request.headers}),env,context,auth);
 if(!sessionResponse.ok)return sessionResponse;
 const session=await sessionResponse.json();
 const raw=await request.text();if(raw.length>2000)return reply({error:'request_too_large'},413);
 let input;try{input=onboardingInput(JSON.parse(raw));}catch{return reply({error:'invalid_json'},400);}
 if(!input)return reply({error:'invalid_onboarding'},400);
 if(!env.OPENAI_API_KEY)return reply({source:'local',reason:'not_configured',tips:{}});
 const model=ONBOARDING_MODEL,started=Date.now(),user=auth.user;
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
 const keyBytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stableDecisionKey({version:ONBOARDING_VERSION,user:user.userId,session,body,provider:env.OPENAI_API_KEY,project:env.OPENAI_PROJECT??null})));
 const key=Array.from(new Uint8Array(keyBytes),x=>x.toString(16).padStart(2,'0')).join('');
 let cache=caches.get(env.DB);if(!cache){cache=new DecisionMemo<OnboardingResult>({accept:r=>r.source==='model',maxEntries:64,maxBytes:128000});caches.set(env.DB,cache);}
 const result=await cache.run(key,async()=>{
  const fallback=(reason:string):OnboardingResult=>({source:'local',reason,tips:{},model,elapsedMs:Date.now()-started});
  let recent=calls.get(env.DB);if(!recent){recent=new Map();calls.set(env.DB,recent);}
  const now=Date.now();if((recent.get(user.userId)??0)>now-3000)return fallback('cooldown');
  recent.set(user.userId,now);for(const [id,at]of recent)if(at<now-60000)recent.delete(id);while(recent.size>500)recent.delete(recent.keys().next().value!);
  const correlationId=crypto.randomUUID(),budgetContext={streamId:user.streamId,correlationId,operation:'still-onboarding'};
  const tokens=await reserveBudget(env,user.userId,inputLimit+outputLimit,budgetContext);if(!tokens.ok)return fallback('budget');
  const maximum=assistantModelCostMicrousd(model,inputLimit,outputLimit);
  let cost:Awaited<ReturnType<typeof reserveCostBudget>>;
  try{cost=await reserveCostBudget(env,user.userId,maximum,{...budgetContext,maximumMicrousd:maximum,allowUserOverage:false});}
  catch{await releaseBudget(env,user.userId,tokens.reservationId);return fallback('budget');}
  if(!cost.ok){await releaseBudget(env,user.userId,tokens.reservationId);return fallback('budget');}
  // One provider submission. Ambiguous completion retains its small budget holds;
  // no automatic retries and no fabricated zero-cost or usage receipt.
  let provider:Response;
  try{provider=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:`Bearer ${env.OPENAI_API_KEY}`,'content-type':'application/json',...(env.OPENAI_PROJECT?{'OpenAI-Project':env.OPENAI_PROJECT}:{})},body,signal:AbortSignal.timeout(4000)});}
  catch{return fallback('unconfirmed');}
  if(!provider.ok){
   if(provider.status>=400&&provider.status<500){await releaseBudget(env,user.userId,tokens.reservationId);await releaseCostBudget(env,user.userId,cost.reservationId);return fallback('unavailable');}
   return fallback('unconfirmed');
  }
  try{
   const data=await provider.json() as {status?:string;model?:string;output_text?:string;output?:{content?:{type?:string;text?:string}[]}[];usage?:{input_tokens?:number;output_tokens?:number;total_tokens?:number}};
   const i=data.usage?.input_tokens,o=data.usage?.output_tokens,total=data.usage?.total_tokens;
   if(!Number.isSafeInteger(i)||!Number.isSafeInteger(o)||i!<0||o!<0||i!>inputLimit||o!>outputLimit||total!==i!+o!)return fallback('usage_unconfirmed');
   await settleBudget(env,user.userId,tokens.reservationId,total!);
   await settleCostBudget(env,user.userId,cost.reservationId,assistantModelCostMicrousd(model,i!,o!));
   if(data.status&&data.status!=='completed')return fallback('incomplete');
   const text=data.output_text??data.output?.flatMap(x=>x.content??[]).filter(x=>x.type==='output_text').map(x=>x.text??'').join('')??'';
   const tips=JSON.parse(text) as Record<string,unknown>;
   if(!tips||typeof tips!=='object'||Array.isArray(tips)||Object.keys(tips).length!==input.actions.length||input.actions.some(id=>typeof tips[id]!=='string'||!(tips[id] as string).trim()||(tips[id] as string).length>180||/[<>\n\r\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Presentation}\u20e3\ufe0f]|https?:\/\//iu.test(tips[id] as string)))return fallback('invalid_response');
   return {source:'model',tips:Object.fromEntries(input.actions.map(id=>[id,(tips[id] as string).trim()])),model,elapsedMs:Date.now()-started};
  }catch{return fallback('unavailable');}
 });
 return reply({...result.value,cache:{...result.cache,layer:'server'},requestElapsedMs:Date.now()-started});
}

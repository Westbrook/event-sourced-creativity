import { handleSession, requireConsent, requireUser } from './pilot-policy.ts';
import type { WorkerEnv, WorkerExecutionContext } from './runtime.ts';
import { validateExperiment } from '../src/still/decision-lab.ts';
import { inspectAnswer, type DecisionPass } from '../src/still/diagnostics.ts';
import type { Answer } from '../src/still/decisions.ts';
const recent=new Map<string,number>();
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'private, no-store'}});
/** Explicit developer experiment. No event reads/writes, jobs, generation or tool execution. */
export async function handleStillExperiment(request:Request,env:WorkerEnv,context:WorkerExecutionContext){
  if(request.method!=='POST')return reply({error:'method_not_allowed'},405);
  const auth=await requireUser(request,env);if(auth.response||!auth.user)return auth.response!;
  const consent=requireConsent(auth.user);if(consent)return consent;
  const session=await handleSession(new Request(new URL('/api/session',request.url),{headers:request.headers}),env,context);if(!session.ok)return session;
  const raw=await request.text();if(new TextEncoder().encode(raw).byteLength>60000)return reply({error:'experiment_too_large'},413);
  let input;try{input=validateExperiment(JSON.parse(raw));}catch{return reply({error:'invalid_json'},400);}if(!input)return reply({error:'invalid_experiment'},400);
  if(!env.JEV_API_KEY)return reply({error:'jev_not_configured'},503);
  const now=Date.now(),key=auth.user.userId;if((recent.get(key)??0)>now-3000)return reply({error:'experiment_cooldown'},429);recent.set(key,now);if(recent.size>500)for(const [id,at]of recent)if(at<now-60000)recent.delete(id);
  const body=JSON.stringify({model:'jev-latest',...input});if(new TextEncoder().encode(body).byteLength>60000)return reply({error:'experiment_too_large'},413);
  const pass:DecisionPass={id:'experiment',label:'Isolated experiment',status:'failed',elapsedMs:0,compositionIds:[],evidenceIds:[],exchange:{requestId:crypto.randomUUID(),requestedAt:new Date().toISOString(),request:JSON.parse(body)},questions:[]};let answers:Record<string,Answer>={};
  try{const response=await fetch('https://api.typesafe.ai/v1/systemone',{method:'POST',headers:{authorization:`Bearer ${env.JEV_API_KEY}`,'content-type':'application/json'},body,signal:AbortSignal.timeout(10000)});pass.exchange!.responseStatus=response.status;if(response.ok){const result=await response.json() as {model?:unknown;answers?:Record<string,Answer>};pass.model=typeof result.model==='string'?result.model.slice(0,100):undefined;if(result.answers&&typeof result.answers==='object'&&!Array.isArray(result.answers)){answers=result.answers;pass.status='answered';}else pass.reason='invalid_response';}else pass.reason=response.status===429?'busy':'unavailable';}catch{pass.reason='unavailable';}
  pass.elapsedMs=Date.now()-now;pass.questions=Object.entries(input.questions).map(([id,question])=>({id,question,asked:true,...inspectAnswer(question,answers[id])}));
  return reply({isolated:true,pass});
}

import type {WorkerEnv} from './runtime.ts';
import {ONBOARDING_VERSION,type OnboardingResult} from '../src/still/onboarding.ts';

// Exact bounded wording context, never an authority or source of creative data.
export const ONBOARDING_TTL_MS=30*60_000;
export function validOnboardingTips(tips:unknown,actions:string[]):tips is Record<string,string>{
 if(!tips||typeof tips!=='object'||Array.isArray(tips))return false;
 const values=tips as Record<string,unknown>;
 return Object.keys(values).length===actions.length&&actions.every(id=>typeof values[id]==='string'&&!!values[id].trim()&&values[id].length<=180&&!/[<>\n\r\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Presentation}\u20e3\ufe0f]|https?:\/\//iu.test(values[id]));
}
/** Call only after live principal, consent and selected project checks. */
export async function readOnboardingCache(env:WorkerEnv,key:string,owner:string,actions:string[]){
 try{
  const row=await env.DB.prepare('SELECT body,created_at,expires_at FROM still_decision_cache WHERE cache_key=? AND owner_id=? AND expires_at>? AND length(CAST(body AS BLOB))<=8192').bind(`onboarding:${key}`,owner,Date.now()).first<{body:string;created_at:number;expires_at:number}>();
  if(!row)return;
  const value=JSON.parse(row.body);
  if(value.version!==ONBOARDING_VERSION||value.result?.source!=='model'||!validOnboardingTips(value.result.tips,actions))return;
  return {value:value.result as OnboardingResult,createdAt:row.created_at,expiresAt:row.expires_at};
 }catch{return;}
}
export async function writeOnboardingCache(env:WorkerEnv,key:string,owner:string,result:OnboardingResult){
 const now=Date.now(),body=JSON.stringify({version:ONBOARDING_VERSION,result});
 if(new TextEncoder().encode(body).length>8192)return;
 try{await env.DB.batch([
  env.DB.prepare('INSERT OR REPLACE INTO still_decision_cache(cache_key,owner_id,created_at,expires_at,body) VALUES(?,?,?,?,?)').bind(`onboarding:${key}`,owner,now,now+ONBOARDING_TTL_MS,body),
  env.DB.prepare("DELETE FROM still_decision_cache WHERE owner_id=? AND cache_key LIKE 'onboarding:%' AND (expires_at<=? OR cache_key NOT IN (SELECT cache_key FROM still_decision_cache WHERE owner_id=? AND cache_key LIKE 'onboarding:%' ORDER BY created_at DESC LIMIT 64))").bind(owner,now,owner),
 ]);}catch{/* An optional cache must not prevent delivery. */}
}

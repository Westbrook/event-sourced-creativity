import type {WorkerEnv} from './runtime.ts';
import {stableDecisionKey,DECISION_TTL_MS} from '../src/still/decision-cache.ts';
import type {DecisionResponse} from '../src/still/diagnostics.ts';
export const decisionHash=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stableDecisionKey(value)))),b=>b.toString(16).padStart(2,'0')).join('');
type Stored={response:DecisionResponse;contentRef?:string;contentHash:string};
/** Operational cache only: callers must freshly authorize and certify the source revision. */
export async function readStoredDecision(env:WorkerEnv,key:string,owner:string){
 try{
  const row=await env.DB.prepare('SELECT body,created_at,expires_at FROM still_decision_cache WHERE cache_key=? AND owner_id=? AND expires_at>? AND length(CAST(body AS BLOB))<=524288').bind(key,owner,Date.now()).first<{body:string;created_at:number;expires_at:number}>();
  if(!row)return;
  const value=JSON.parse(row.body) as Stored;
  if(value.response?.source!=='jev'||value.response.reason||typeof value.contentHash!=='string')return;
  return {...value,createdAt:row.created_at,expiresAt:row.expires_at};
 }catch{return;} // Missing migration/storage cannot make recommendations unavailable.
}
export async function writeStoredDecision(env:WorkerEnv,key:string,owner:string,value:Stored){
 const body=JSON.stringify(value);if(new TextEncoder().encode(body).length>524288)return;
 const now=Date.now();
 try{await env.DB.batch([
  env.DB.prepare('DELETE FROM still_decision_cache WHERE expires_at<=?').bind(now),
  env.DB.prepare('INSERT OR REPLACE INTO still_decision_cache(cache_key,owner_id,created_at,expires_at,body) VALUES(?,?,?,?,?)').bind(key,owner,now,now+DECISION_TTL_MS,body),
  env.DB.prepare("DELETE FROM still_decision_cache WHERE owner_id=? AND cache_key NOT LIKE 'idea:%' AND cache_key NOT IN(SELECT cache_key FROM still_decision_cache WHERE owner_id=? AND cache_key NOT LIKE 'idea:%' ORDER BY created_at DESC LIMIT 12)").bind(owner,owner),
 ]);}catch{/* Cache writes are expendable. */}
}

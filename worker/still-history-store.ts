import type {CreativeEvent} from '../src/model/events.ts';
import type {HistoryCheckpoint} from '../src/still/history.ts';
import type {WorkerEnv} from './runtime.ts';
import {decisionHash} from './still-decision-store.ts';

export type PreparedHistory={version:string;head:number;privateCount:number;events:CreativeEvent[];checkpoint:HistoryCheckpoint};
const ttl=24*60*60_000,maxPlain=16_000_000,maxEncoded=1_500_000;
export const historyStoreKey=(owner:string,stream:string,scope:string)=>decisionHash({schema:2,owner,stream,scope});
async function boundedBytes(stream:ReadableStream<Uint8Array>,limit:number){
 const reader=stream.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw Error('history_cache_capacity');}chunks.push(value);}}
 finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}return bytes;
}
/** A private, expendable accelerator. Every caller certifies current source and scope. */
export async function loadHistorySnapshot(env:WorkerEnv,key:string,owner:string):Promise<PreparedHistory|undefined>{
 try{
  const row=await env.DB.prepare('SELECT body FROM still_history_cache WHERE cache_key=? AND owner_id=? AND expires_at>? AND length(body)<=?').bind(key,owner,Date.now(),maxEncoded).first<{body:string}>();
  if(!row)return;
  const bytes=Uint8Array.from(atob(row.body),c=>c.charCodeAt(0));
  const plain=await boundedBytes(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),maxPlain);
  const value=JSON.parse(new TextDecoder().decode(plain)) as PreparedHistory;
  if(typeof value.version!=='string'||!Number.isSafeInteger(value.head)||!Number.isSafeInteger(value.privateCount)||value.privateCount<0||!Array.isArray(value.events)||!value.checkpoint||!Number.isSafeInteger(value.checkpoint.accessibleEvents))return;
  const c=value.checkpoint;
  if(![c.accessibleEvents,c.creativeEvents,c.forgotten].every(n=>Number.isSafeInteger(n)&&n>=0)||!c.counts||typeof c.counts!=='object'||Array.isArray(c.counts)||!Object.values(c.counts).every(n=>Number.isSafeInteger(n)&&n>=0))return;
  if(![c.recent,c.focused,c.creative,c.milestones,c.attention,c.focusedAttention,value.events].every(list=>Array.isArray(list)&&list.every(e=>e&&Number.isSafeInteger(e.sequence)&&typeof e.type==='string'&&e.payload&&typeof e.payload==='object')))return;
  if(!Array.isArray(c.attentionSequences)||!c.attentionSequences.every(n=>Number.isSafeInteger(n)&&n>=0))return;
  return value;
 }catch{return;}
}
export async function saveHistorySnapshot(env:WorkerEnv,key:string,owner:string,value:PreparedHistory){
 try{
  const plain=JSON.stringify(value);if(new TextEncoder().encode(plain).length>maxPlain)return false;
  const zipped=await boundedBytes(new Blob([plain]).stream().pipeThrough(new CompressionStream('gzip')),maxEncoded*.75);
  let binary='';for(let at=0;at<zipped.length;at+=8192)binary+=String.fromCharCode(...zipped.subarray(at,at+8192));
  const body=btoa(binary),now=Date.now();
  await env.DB.batch([
   env.DB.prepare('DELETE FROM still_history_cache WHERE expires_at<=?').bind(now),
   env.DB.prepare('INSERT OR REPLACE INTO still_history_cache(cache_key,owner_id,created_at,expires_at,body) VALUES(?,?,?,?,?)').bind(key,owner,now,now+ttl,body),
   env.DB.prepare('DELETE FROM still_history_cache WHERE owner_id=? AND cache_key NOT IN(SELECT cache_key FROM still_history_cache WHERE owner_id=? ORDER BY created_at DESC LIMIT 4)').bind(owner,owner),
  ]);return true;
 }catch{return false;}
}
export async function discardHistorySnapshot(env:WorkerEnv,key:string,owner:string){try{await env.DB.prepare('DELETE FROM still_history_cache WHERE cache_key=? AND owner_id=?').bind(key,owner).run();}catch{/* Optional cache. */}}

export type HistoryCounts={events:number;privateBodies:number;tailEvents:number;tailPrivateBodies:number};
export async function historyCounts(env:WorkerEnv,stream:string,after:number){
 return env.DB.prepare(`SELECT COUNT(*) AS events,COUNT(secret.private_event_id) AS privateBodies,
 COALESCE(SUM(event.sequence>?),0) AS tailEvents,COALESCE(SUM(event.sequence>? AND secret.private_event_id IS NOT NULL),0) AS tailPrivateBodies
 FROM events event LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id WHERE event.stream_id=?`).bind(after,after,stream).first<HistoryCounts>();
}
/** Existing certified triggers count every source mutation. A tail is safe only
 * when every generation increment is explained by a new event/private row AND
 * old row counts are unchanged. Count checks reject REPLACE/move conflicts even
 * when SQLite does not invoke delete triggers. Epoch changes force rebuilding. */
export function appendOnlyHistory(old:PreparedHistory,current:string,counts:HistoryCounts|null){
 try{
  const a=JSON.parse(old.version),b=JSON.parse(current);
  return !!counts&&a[0]===b[0]&&a[1]===b[1]&&b[3]>a[3]&&old.head===a[3]
   &&Object.values(counts).every(n=>Number.isSafeInteger(n)&&n>=0)
   &&counts.events===old.checkpoint.accessibleEvents+counts.tailEvents
   &&counts.privateBodies===old.privateCount+counts.tailPrivateBodies
   &&counts.tailEvents>0&&b[2]-a[2]===counts.tailEvents+counts.tailPrivateBodies;
 }catch{return false;}
}

import type { WorkerEnv } from './runtime.ts';
import { derivationResults } from './memory-derivation-store.ts';

type Row=Record<string,unknown>;
type Pending={statements:D1PreparedStatement[];resolve:(rows:D1Result<Row>[])=>void;reject:(error:unknown)=>void};
const MAX_BATCH=256;
/** Trusted native staging SQL only. This is not a public query interface. Never
 * coalesce writes or turn a multi-statement read snapshot into separate reads. */
function readOnly(sql:string){
 const tokens=sql.match(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|[a-z_][a-z0-9_]*|;/giu)??[];
 const words=tokens.filter(t=>!["'",'"','`','[','--','/*'].some(prefix=>t.startsWith(prefix))).map(t=>t.toUpperCase());
 return ['SELECT','WITH'].includes(words[0]??'')&&!words.some((word,i)=>
  ['INSERT','UPDATE','DELETE','REPLACE','CREATE','DROP','ALTER','ATTACH','DETACH','VACUUM','REINDEX','ANALYZE','PRAGMA','BEGIN','COMMIT','ROLLBACK'].includes(word)
   ||word===';'&&i!==words.length-1);
}
/** Request-local read multiplexing, NOT a result, access or schema cache.
 * Every original query still runs, and its native proof still replays at use.
 * A fresh live environment view preserves DB/config identity checks. Partial,
 * failed, late or replaced acknowledgements never produce successful reads. */
export function createMemoryReadBatch(env:WorkerEnv,current:()=>boolean){
 const db=env.DB,statements=new WeakMap<D1PreparedStatement,D1PreparedStatement>();
 let queue:Pending[]=[],scheduled:ReturnType<typeof setTimeout>|undefined,closed=false;
 const fail=()=>Error('memory_read_batch_unavailable');
 const live=()=>{try{return env.DB===db&&current();}catch{return false;}};
 const reject=(pending:Pending[],error:unknown)=>{for(const item of pending)item.reject(error);};
 async function flush(){
  scheduled=undefined;const waiting=queue;queue=[];
  if(closed||!live()){reject(waiting,fail());return;}
  // Preserve each caller's entire atomic read batch, even at the chunk boundary.
  while(waiting.length){
   const chunk:Pending[]=[];let size=0;
   while(waiting.length&&size+waiting[0]!.statements.length<=MAX_BATCH){const next=waiting.shift()!;chunk.push(next);size+=next.statements.length;}
   try{
    if(closed||!live())throw fail();
    const raw=structuredClone(await db.batch<Row>(chunk.flatMap(item=>item.statements)));
    if(closed||!live()||!derivationResults(raw,size))throw fail();
    let offset=0;for(const item of chunk){item.resolve(structuredClone(raw.slice(offset,offset+item.statements.length)));offset+=item.statements.length;}
   }catch(error){reject(chunk,error);reject(waiting,error);return;}
  }
 }
 function enqueue(inputs:D1PreparedStatement[]):Promise<D1Result<Row>[]>{
  if(closed||!live()||inputs.length<1||inputs.length>MAX_BATCH)return Promise.reject(fail());
  if(queue.reduce((n,item)=>n+item.statements.length,0)+inputs.length>MAX_BATCH*3)return Promise.reject(fail());
  return new Promise((resolve,reject)=>{
   queue.push({statements:inputs,resolve,reject});
   // One event-loop turn lets independent source stages meet without delaying
   // them beyond the original lease or adding a timer that renews that lease.
   scheduled??=setTimeout(()=>{void flush();},0);
  });
 }
 function wrap(raw:D1PreparedStatement,sql:string):D1PreparedStatement{
  const proxy=new Proxy(raw,{get(target,key){
   if(key==='bind')return(...bindings:unknown[])=>{if(bindings.length>100)throw fail();return wrap(target.bind(...bindings),sql);};
   if(key==='all')return async()=>{const rows=await enqueue([target]);return rows[0]!;};
   if(key==='first')return async(column?:string)=>{
    if(column!==undefined&&typeof column!=='string')throw fail();
    const row=(await enqueue([target]))[0]!.results[0];
    if(!row)return null;if(column===undefined)return row;
    if(!Object.hasOwn(row,column))throw fail();return row[column];
   };
   if(key==='run'||key==='raw')return()=>Promise.reject(fail());
   if(key==='sql')return sql;
   return Reflect.get(target,key,target);
  }});statements.set(proxy,raw);return proxy;
 }
 const view={
  prepare(sql:string){if(!live()||!readOnly(sql))throw fail();return wrap(db.prepare(sql),sql);},
  batch(inputs:D1PreparedStatement[]){
   if(!Array.isArray(inputs)||inputs.some(input=>!statements.has(input)))return Promise.reject(fail());
   return enqueue(inputs.map(input=>statements.get(input)!));
  },
 } as D1Database;
 const sourceEnv=new Proxy(env,{get(target,key){
  if(key==='DB'){if(target.DB!==db)throw fail();return view;}return Reflect.get(target,key,target);
 },set(){throw fail();}});
 return {env:sourceEnv,unwrap:(statement:D1PreparedStatement)=>statements.get(statement)??statement,
  close(){closed=true;clearTimeout(scheduled);scheduled=undefined;const pending=queue;queue=[];reject(pending,fail());}};
}

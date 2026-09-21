import type { WorkerEnv } from './runtime.ts';
import { derivationResults } from './memory-derivation-store.ts';

type Row=Record<string,unknown>;
type Branch={waiting:number;reject:(error:unknown)=>void};
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
export function createMemoryReadBatch(env:WorkerEnv,current:()=>boolean,maximumWaitMs=30000){
 if(!Number.isFinite(maximumWaitMs)||maximumWaitMs<=0||maximumWaitMs>30000)throw Error('memory_read_batch_unavailable');
 const db=env.DB,statements=new WeakMap<D1PreparedStatement,D1PreparedStatement>();
 const active=new Set<Pending>(),branches=new Set<Branch>();
 let branchCount=0,flushing=false;
 let queue:Pending[]=[],scheduled:ReturnType<typeof setTimeout>|undefined,closed=false;
 const fail=()=>Error('memory_read_batch_unavailable');
 const live=()=>{try{return env.DB===db&&current();}catch{return false;}};
 const reject=(pending:Pending[],error:unknown)=>{for(const item of pending)item.reject(error);};
 const ready=()=>[...branches].every(branch=>branch.waiting>0);
 function schedule(){if(!closed&&!flushing&&queue.length&&ready())scheduled??=setTimeout(()=>{void flush();},0);}
 function close(){
  closed=true;clearTimeout(scheduled);clearTimeout(deadline);scheduled=undefined;
  const pending=[...queue,...active];queue=[];active.clear();reject(pending,fail());for(const branch of branches)branch.reject(fail());
 }
 // D1 reads cannot be cancelled, but callers must not await a hung binding
 // beyond the original request lease. Reject in-flight consumers immediately;
 // an eventual acknowledgement is discarded and cannot trigger another read.
 const deadline=setTimeout(close,maximumWaitMs);
 async function flush(){
  scheduled=undefined;
  if(closed||!live()){close();return;}
  if(flushing||!ready())return;
  flushing=true;const waiting=queue;queue=[];
  try{
  // Preserve each caller's entire atomic read batch, even at the chunk boundary.
  while(waiting.length){
   const chunk:Pending[]=[];let size=0;
   while(waiting.length&&size+waiting[0]!.statements.length<=MAX_BATCH){const next=waiting.shift()!;chunk.push(next);size+=next.statements.length;}
   try{
    if(closed||!live())throw fail();
    const raw=structuredClone(await db.batch<Row>(chunk.flatMap(item=>item.statements)));
    if(closed||!live()||!derivationResults(raw,size))throw fail();
    let offset=0;for(const item of chunk){item.resolve(structuredClone(raw.slice(offset,offset+item.statements.length)));offset+=item.statements.length;}
   }catch{close();return;}
   finally{for(const item of chunk)active.delete(item);}
  }
  }finally{flushing=false;schedule();}
 }
 function enqueue(inputs:D1PreparedStatement[],branch?:Branch):Promise<D1Result<Row>[]>{
  if(closed||!live()||inputs.length<1||inputs.length>MAX_BATCH)return Promise.reject(fail());
  if([...active].reduce((n,item)=>n+item.statements.length,0)+inputs.length>MAX_BATCH*3)return Promise.reject(fail());
  return new Promise((resolve,reject)=>{
   let settled=false;if(branch)branch.waiting++;
   const finish=()=>{if(settled)return false;settled=true;if(branch)branch.waiting--;return true;};
   const pending={statements:inputs,resolve:(rows:D1Result<Row>[])=>{if(finish())resolve(rows);},reject:(error:unknown)=>{if(finish())reject(error);}};
   queue.push(pending);active.add(pending);
   // One event-loop turn lets independent source stages meet without delaying
   // them beyond the original lease or adding a timer that renews that lease.
   schedule();
  });
 }
 function wrap(raw:D1PreparedStatement,sql:string,branch?:Branch):D1PreparedStatement{
  const proxy=new Proxy(raw,{get(target,key){
   if(key==='bind')return(...bindings:unknown[])=>{if(bindings.length>100)throw fail();return wrap(target.bind(...bindings),sql,branch);};
   if(key==='all')return async()=>{const rows=await enqueue([target],branch);return rows[0]!;};
   if(key==='first')return async(column?:string)=>{
    if(column!==undefined&&typeof column!=='string')throw fail();
    const row=(await enqueue([target],branch))[0]!.results[0];
    if(!row)return null;if(column===undefined)return row;
    if(!Object.hasOwn(row,column))throw fail();return row[column];
   };
   if(key==='run'||key==='raw')return()=>Promise.reject(fail());
   if(key==='sql')return sql;
   return Reflect.get(target,key,target);
  }});statements.set(proxy,raw);return proxy;
 }
 function environment(branch?:Branch){
 const view={
  prepare(sql:string){if(!live()||!readOnly(sql))throw fail();return wrap(db.prepare(sql),sql,branch);},
  batch(inputs:D1PreparedStatement[]){
   if(!Array.isArray(inputs)||inputs.some(input=>!statements.has(input)))return Promise.reject(fail());
   return enqueue(inputs.map(input=>statements.get(input)!),branch);
  },
 } as D1Database;
 return new Proxy(env,{get(target,key){
  if(key==='DB'){if(target.DB!==db)throw fail();return view;}return Reflect.get(target,key,target);
 },set(){throw fail();}});
 }
 const sourceEnv=environment();
 async function run<T>(work:(source:WorkerEnv)=>Promise<T>):Promise<T>{
  if(closed||!live()||++branchCount>3)throw fail();
  let rejectWork:(error:unknown)=>void=()=>{};
  const interrupted=new Promise<never>((_resolve,reject)=>{rejectWork=reject;});
  const branch:Branch={waiting:0,reject:rejectWork};branches.add(branch);
  try{return await Promise.race([Promise.resolve().then(()=>work(environment(branch))),interrupted]);}
  catch(error){close();throw error;}
  finally{branches.delete(branch);schedule();}
 }
 return {env:sourceEnv,run,unwrap:(statement:D1PreparedStatement)=>statements.get(statement)??statement,
  close};
}

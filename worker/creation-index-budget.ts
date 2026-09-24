import type {WorkerEnv} from './runtime.ts';
import {CreationProviderError,withinSignal} from './creation-provider-http.ts';
/** Bound local DB dispatch, including resumable projection reads. The original DB is used
 * for cleanup/receipt finalization; its narrow authority does not depend on inference. */
export function boundedIndexEnvironment(env:WorkerEnv,signal:AbortSignal,maxOperations=512){
 let operations=0;
 const reserve=(n=1)=>{signal.throwIfAborted();if(operations+n>maxOperations)throw new CreationProviderError('tick_database_budget');operations+=n;};
 const originals=new WeakMap<object,D1PreparedStatement>();
 const wrap=(statement:D1PreparedStatement):D1PreparedStatement=>{const proxy=new Proxy(statement,{get(target,key){if(key==='bind')return(...values:unknown[])=>wrap(target.bind(...values));if(['all','first','run','raw'].includes(String(key)))return(...args:unknown[])=>{reserve();return withinSignal((target[key as 'all'] as (...args:unknown[])=>Promise<unknown>).apply(target,args),signal);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});originals.set(proxy,statement);return proxy;};
 const db=new Proxy(env.DB,{get(target,key){if(key==='prepare')return(sql:string)=>wrap(target.prepare(sql));if(key==='batch')return(statements:D1PreparedStatement[])=>{reserve(statements.length);return withinSignal(target.batch(statements.map(s=>originals.get(s)??s)),signal);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 return {env:{...env,DB:db},operations:()=>operations};
}

import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {install} from './model3d-workerd-snapshot.mjs';
const require=createRequire(import.meta.url),wrangler=createRequire(require.resolve('wrangler'));
async function finite(work,ms,label){let timer;try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('synthetic_retained_timeout:'+label)),ms);})]);}finally{clearTimeout(timer);}}
/** Synthetic exact final SELECT only; no provider, public network or live DB. */
export async function readRetainedWitnessInWorkerd(snapshot,statement){
 const {Miniflare,Log,LogLevel}=wrangler('miniflare');
 const mf=new Miniflare({modules:true,compatibilityDate:'2026-05-22',host:'127.0.0.1',port:0,log:new Log(LogLevel.NONE),d1Databases:['DB'],
  script:'export default {fetch(){return new Response("synthetic retained qualification")}}',outboundService(){throw Error('network_forbidden');}});
 try{
  assert.match(statement.sql,/^WITH /);assert(statement.bindings.length<=100);assert(!statement.bindings.includes(undefined));
  assert(Buffer.byteLength(statement.sql)<100000);
  const db=await finite(mf.getD1Database('DB'),10000,'db');
  await finite(install(db,snapshot),35000,'install');
  return await finite(db.prepare(statement.sql).bind(...statement.bindings).first(),10000,'final-read');
 }finally{await finite(mf.dispose(),10000,'dispose');}
}

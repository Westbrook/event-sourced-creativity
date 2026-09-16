import { executeOutputAudioRecovery } from './worker/output-audio-recovery.ts';
import { reconcileOutputNativeStorage } from './worker/output-private-execution.ts';
import { ensureSchema } from './worker/runtime.ts';
import { ensureOutputRequirementsSchema } from './worker/output-requirements-ledger.ts';
const environments = new Map();
function environment(bindings) {
 if(environments.has(bindings.DB))return environments.get(bindings.DB);
 const native=new WeakMap(),descriptions=new WeakMap(),metrics={queries:0,batches:0,puts:0,deletes:0,grace:0,failures:[]};
 const stmt=(inner,sql,values=[])=>{const wrapped=new Proxy(inner,{get(target,key){
  if(key==='bind')return(...values)=>{if(values.length>100||values.includes(undefined))throw Error('binding_limit');return stmt(target.bind(...values),sql,values);};
  if(['run','all','first','raw'].includes(String(key)))return async(...args)=>{metrics.queries++;try{return await target[key](...args);}catch(e){metrics.failures.push({sql,error:String(e)});throw e;}};
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }});native.set(wrapped,inner);descriptions.set(wrapped,{sql,values});return wrapped;};
 const DB=new Proxy(bindings.DB,{get(target,key){
  if(key==='prepare')return sql=>stmt(target.prepare(sql),sql);
  if(key==='batch')return async inputs=>{metrics.batches++;metrics.queries+=inputs.length;try{return await target.batch(inputs.map(i=>native.get(i)??i));}catch(e){const compile=[];for(const i of inputs){const d=descriptions.get(i);if(!d)continue;try{await target.prepare('EXPLAIN QUERY PLAN '+d.sql).bind(...d.values).all();}catch(e){compile.push({sql:d.sql,error:String(e)});}}metrics.failures.push({error:String(e),compile});throw e;}};
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }});
 let env;
 const MEDIA=new Proxy(bindings.Media,{get(target,key){
  if(key==='put')return async(name,bytes,options)=>{metrics.puts++;const value=await target.put(name,bytes,options);
   if(bindings.SKIP_GRACE)return value;
   const cleanup=await reconcileOutputNativeStorage(env,{ownerUserId:'owner',personalOnly:true});
   if(cleanup.reconciled!==0||cleanup.pending!==0||!await target.head(name))throw Error('live_recovery_storage_grace_failed');
   metrics.grace++;return value;};
  if(key==='delete')return async names=>{metrics.deletes++;return target.delete(names);};
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }});
 env={...bindings,DB,MEDIA,FAL_KEY:'synthetic-unit-test-key-not-a-credential',ASSETS:{fetch(){throw Error('assets_forbidden');}}};
 const result={env,metrics};environments.set(bindings.DB,result);return result;
}
export default {async fetch(request,bindings){
 const action=new URL(request.url).pathname.slice(1),f=JSON.parse(bindings.FIXTURE),{env,metrics}=environment(bindings);
 try{
  if(request.method!=='GET')throw Error('local_method_forbidden');
  if(action==='warm'){await ensureSchema(env);await ensureOutputRequirementsSchema(env);return Response.json({ok:true,metrics});}
  if(action==='cleanup'){const value=await reconcileOutputNativeStorage(env,{ownerUserId:'owner',personalOnly:true});return Response.json({ok:true,value,metrics});}
  if(action!=='recover')throw Error('local_action_forbidden');
  const job=await env.DB.prepare('SELECT * FROM document_jobs WHERE job_id=?').bind(f.jobId).first();job.output_slot_id=f.binding.slot.slotId;
  const value=await executeOutputAudioRecovery(env,f.user,job,f.binding,{assertions:f.assertions,signal:request.signal});
  return Response.json({ok:true,value,metrics});
 }catch(e){return Response.json({ok:false,error:String(e),code:e?.code,metrics},{status:409});}
}};

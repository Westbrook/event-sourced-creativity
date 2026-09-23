import { EVENT_SAVE_BOUNDARY_READ_QUERIES } from './event-save-repair.ts';
import { nativePrivateContentMemorySchemaReads } from './memory-native-boundary.ts';
import type { WorkerEnv } from './runtime.ts';
import { consentHash } from './consequential-consent.ts';
import { refuseCurrent } from './generation-current-source-proof.ts';

export const CURRENT_SOURCE_LIMITS = Object.freeze({historyRows:50_000,historyBytes:64*1024*1024,cellBytes:2_200_000,pageRows:5000,
  statements:1024,returnedRows:150_000,returnedBytes:192*1024*1024,replyBytes:12_000_000});
export const currentBytes=(v:unknown)=>new TextEncoder().encode(typeof v==='string'?v:JSON.stringify(v)).length;
type Row=Record<string,unknown>;
/** Only module-owned queries can call read. Delegated helpers receive a smaller
 * schema-observation capability, never arbitrary body access or a real DB. */
export function currentReadSession(env:WorkerEnv) {
  const db=env.DB, witnesses:Array<{sql:string;args:unknown[];hash:string}>=[];
  let statements=0,rows=0,bytes=0;
  const execute=async(sql:string,args:unknown[])=>{
    if(env.DB!==db)refuseCurrent('database_changed');
    const tokens=sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*|\/\*[\s\S]*?\*\//gu,' ');
    if(!/^\s*(SELECT|WITH)\b/u.test(tokens)||/;|\b(?:INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|REPLACE|ATTACH|DETACH|VACUUM|PRAGMA)\b/u.test(tokens)||++statements>CURRENT_SOURCE_LIMITS.statements)refuseCurrent('read_budget_exceeded');
    const r=await db.prepare(sql).bind(...args).all<Row>();
    if(r.success!==true||!Array.isArray(r.results))refuseCurrent('read_unconfirmed');
    rows+=r.results.length;bytes+=currentBytes(r.results);
    if(rows>CURRENT_SOURCE_LIMITS.returnedRows||bytes>CURRENT_SOURCE_LIMITS.returnedBytes)refuseCurrent('read_budget_exceeded');
    return r.results;
  };
  const read=async(sql:string,args:unknown[]=[])=>{
    const value=await execute(sql,args);witnesses.push({sql,args:structuredClone(args),hash:await consentHash(value)});return value;
  };
  // Exact schema forms produced by the native Memory boundary. In particular,
  // SELECT body FROM private_content or event_private_payloads is not delegated.
  const schemaForms=new Set<string>();
  nativePrivateContentMemorySchemaReads({prepare:(sql:string)=>{schemaForms.add(sql);return {} as unknown as D1PreparedStatement;}} as WorkerEnv['DB']);
  for(const sql of EVENT_SAVE_BOUNDARY_READ_QUERIES)schemaForms.add(sql);
  const schemaAllowed=(sql:string)=>schemaForms.has(sql);
  const owned=new WeakSet<D1PreparedStatement>();
  const wrap=(sql:string,args:unknown[]=[]):D1PreparedStatement=>{
    if(!schemaAllowed(sql))refuseCurrent('helper_query_unsupported');
    const statement={bind:(...values:unknown[])=>wrap(sql,values),all:async()=>({success:true,results:await read(sql,args)}),
      first:async()=>(await read(sql,args))[0]??null,run:async()=>refuseCurrent('write_forbidden'),raw:async()=>refuseCurrent('write_forbidden')} as unknown as D1PreparedStatement;
    owned.add(statement);return statement;
  };
  const safe={prepare:wrap,batch:async(ss:D1PreparedStatement[])=>{if(ss.some(s=>!owned.has(s)))refuseCurrent('foreign_statement');return Promise.all(ss.map(s=>s.all()));},exec:async()=>refuseCurrent('write_forbidden'),dump:async()=>refuseCurrent('write_forbidden')} as unknown as WorkerEnv['DB'];
  const helperEnv={...env,DB:safe,MEDIA:new Proxy({}, {get:()=>()=>refuseCurrent('media_unsupported')})} as WorkerEnv;
  return {read,helperEnv,async recheck(){for(const w of witnesses)if(await consentHash(await execute(w.sql,w.args))!==w.hash)refuseCurrent('read_changed');if(env.DB!==db)refuseCurrent('database_changed');},
    usage:()=>({statements,rows,bytes})};
}

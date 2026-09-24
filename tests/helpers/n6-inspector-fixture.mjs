import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readLocalMigrations,migrateLocalDatabase} from '../../scripts/lib/local-migrations.mjs';
import {registerOutputSourceImports} from '../output-server-test-helpers.mjs';
registerOutputSourceImports();
const {ensureSchema}=await import('../../worker/runtime.ts');
const {inspectEventSaveRepair,applyEventSaveRepair}=await import('../../worker/event-save-repair.ts');
const {inspectMemorySchemaRepair,applyMemorySchemaRepair}=await import('../../worker/memory-schema-repair.ts');
const {makeEvent,eventWriteBindings,EVENT_WRITE_COLUMNS}=await import('../../worker/event-write-primitives.ts');
const migrations=readLocalMigrations(new URL('../../drizzle/',import.meta.url));
export async function fixture(t,runtime='source'){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());migrateLocalDatabase(sqlite,{migrations:migrations.slice(0,41)});
 const control={beforeBatch:null,externalChanges:0,inspecting:false,sqlEffects:[]};
 class Statement {
  constructor(sql,values=[]){this.sql=sql;this.values=values;}
  bind(...values){return new Statement(this.sql,values);}
  async all(){return {success:true,results:sqlite.prepare(this.sql).all(...this.values)};}
  async first(){return sqlite.prepare(this.sql).get(...this.values)??null;}
  async run(){const r=sqlite.prepare(this.sql).run(...this.values);return {success:true,meta:{changes:Number(r.changes)}};}
 }
 const db={prepare:sql=>{
  if(control.inspecting){const code=sql.replace(/'(?:[^']|'')*'/g,"''");if(!/^\s*(SELECT|WITH)\b/i.test(code)||/\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|REPLACE|PRAGMA|VACUUM|REINDEX)\b/i.test(code))control.sqlEffects.push(sql);}
  return new Statement(sql);
 },async batch(statements){control.beforeBatch?.(statements);sqlite.exec('BEGIN IMMEDIATE');try{const results=statements.map(s=>{const results=sqlite.prepare(s.sql).all(...s.values);return {success:true,results,meta:{changes:sqlite.prepare('SELECT changes() AS n').get().n}};});sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 const env={DB:db,ASSETS:{fetch:async()=>new Response(null,{status:404})}};
 await ensureSchema(env);
 const guard={sql:'1',bindings:[]};
 await applyMemorySchemaRepair(db,(await inspectMemorySchemaRepair(db)).proof,guard);
 await applyEventSaveRepair(db,(await inspectEventSaveRepair(db)).proof,guard);
 const {default:worker}=await import(runtime==='source'?'../../worker/index.ts':'../../dist/server/index.js');
 const background=[];const session=await(await worker.fetch(new Request('http://localhost/api/session'),env,{waitUntil:p=>background.push(p)})).json();
 while(background.length)await Promise.all(background.splice(0));
 const owner=session.user.userId,user={userId:owner,streamId:'creative:'+owner};
 sqlite.prepare("UPDATE users SET role='creator',consent_version='pilot-2026-08-10'").run();
 const headers={'oai-authenticated-user-id':owner,'oai-authenticated-user-email':session.user.email};
 const append=async(type,payload,actor='user',options={})=>{
  const head=sqlite.prepare('SELECT coalesce(max(sequence),0) AS n FROM events WHERE stream_id=?').get(user.streamId).n;
  const event=makeEvent(user.streamId,head+1,actor,'web:editor',options.correlationId??'n6-synthetic',type,payload,options);
  const values=eventWriteBindings(event);await db.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) VALUES(${values.map(()=>'?')})`).bind(...values).run();return event;
 };
 // Real origin and custody writers. Workspace profile must ignore ordinary worker
 // telemetry but retain unrelated manual history in its complete dependency census.
 const project=await append('ProjectCreated',{project_id:'project',name:'Synthetic private project',state:'active'});
 const document=await append('DocumentCreated',{project_id:'project',document_id:'document',title:'Synthetic inspector',handle:'page-document'});
 const block=await append('BlockCreated',{project_id:'project',document_id:'document',block_id:'direction',type:'direction',scope:'document',project_owned:true,handle:'Creative direction',properties:{weight:.8,text:'Synthetic harbor <script>inert</script>',authority:'authored'},position:'a1'});
 await append('GenerationPreflightRequested',{document_id:'document',preflight_id:'earlier'},'worker:policy');
 await append('GenerationPreflightCompleted',{document_id:'document',preflight_id:'earlier'},'worker:policy');
 await append('ProjectCreated',{project_id:'unrelated',name:'Other synthetic project'});
 await append('DocumentCreated',{project_id:'unrelated',document_id:'other',title:'Unrelated valid history'});
 const inspect=async(path='/api/source-advisory?documentId=document&preflightId=original',method='GET',customHeaders=headers)=>{
  const before=sqlite.prepare('SELECT total_changes() AS n').get().n,externalBefore=control.externalChanges,fetch=globalThis.fetch;
  let providerCalls=0,backgroundCalls=0;control.inspecting=true;control.sqlEffects=[];
  globalThis.fetch=()=>{providerCalls++;throw Error('provider call during inspection');};
  try{const response=await worker.fetch(new Request('https://forma.test'+path,{headers:customHeaders,method}),env,{waitUntil:()=>{backgroundCalls++;throw Error('background effect');}});
    assert.equal(sqlite.prepare('SELECT total_changes() AS n').get().n,before+control.externalChanges-externalBefore,'read must make zero writes');assert.equal(providerCalls,0,'no provider attempts, including caught failures');assert.equal(backgroundCalls,0,'no background/retention attempts');assert.deepEqual(control.sqlEffects,[],'no mutation/initializer SQL, even no-ops');return response;
  }finally{globalThis.fetch=fetch;control.inspecting=false;}
 };
 return {sqlite,db,env,control,owner,user,headers,append,project,document,block,worker,inspect};
}

export async function preflight(f,requestKey='original',variant='valid',inputPatch={}){
 const calls=[],previous=globalThis.fetch;
 f.env.OPENAI_API_KEY='synthetic-not-a-key';
 globalThis.fetch=async(url,init)=>{
  assert.equal(String(url),'https://api.openai.com/v1/moderations','no generation/provider recovery');
  const body=JSON.parse(init.body);calls.push(init.body);
  const results=body.input.map((_,i)=>({flagged:i===1,categories:{violence:i===1},...(variant==='unknown-scores'?{}:{category_scores:{violence:i===1?.8:.1}})}));
  if(variant==='cardinality')results.pop();
  if(variant==='invalid')results[0].categories.violence='unknown';
  const identity=variant==='unknown-identity'?{}:{id:'synthetic-response',model:'synthetic-returned-model'};
  if(variant==='duplicate')return new Response('{"model":"ambiguous-a","model":"ambiguous-b","results":'+JSON.stringify(results)+'}',{status:200});
  if(variant==='oversized')return new Response(' '.repeat(65537),{status:200});
  return variant==='json'?new Response('{not json',{status:200}):Response.json({...identity,results},{headers:variant==='unknown-identity'?{}:{'x-request-id':'synthetic-request'}});
 };
 try{
  const background=[];const response=await f.worker.fetch(new Request('https://forma.test/api/generation-readiness',{method:'POST',headers:{...f.headers,'content-type':'application/json'},body:JSON.stringify({kind:'generate',documentId:'document',sourceSurface:'still',requestKey,productionMode:'manual',promptTechnique:'prose',...inputPatch})}),f.env,{waitUntil:p=>background.push(p)});
  while(background.length)await Promise.all(background.splice(0));
  assert.equal(response.status,200,await response.clone().text());return {readiness:(await response.json()).readiness,calls};
 }finally{globalThis.fetch=previous;}
}

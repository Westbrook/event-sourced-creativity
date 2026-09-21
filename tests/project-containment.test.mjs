import './helpers/register-output-source-imports.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createSceneCostFixture } from './helpers/scene-cost-fixture.mjs';
import { projectContainmentForest, reparentProjectForest, visibleProjectAncestors } from '../src/model/project-containment.ts';
const { appendAuditEvent,makeEvent,eventWriteBindings,EVENT_WRITE_COLUMNS } = await import('../worker/runtime.ts');
const migration = readFileSync(new URL('../drizzle/0058_project_containment.sql',import.meta.url),'utf8');
const forest = (pairs) => pairs.map(([id,parentId,organizationId=null]) => ({id,parentId,organizationId}));

test('containment validates the entire forest and never inherits a grant', () => {
 const nodes=forest([['root',null],['child','root'],['leaf','child']]);
 const graph=projectContainmentForest(nodes);assert.ok(graph);
 assert.deepEqual(visibleProjectAncestors(graph,'leaf',new Set(['leaf','root'])),{ancestors:[],ancestryComplete:false});
 assert.equal(visibleProjectAncestors(graph,'leaf',new Set(['root'])),null);
 assert.deepEqual(visibleProjectAncestors(graph,'leaf',new Set(['leaf','root','child'])),{ancestors:['child','root'],ancestryComplete:true});
 assert.equal(reparentProjectForest(nodes,'root','leaf'),null);
 assert.equal(reparentProjectForest(nodes,'child','child'),null);
 assert.equal(reparentProjectForest(nodes,'leaf','missing'),null);
 assert.ok(reparentProjectForest(nodes,'child',null));
 assert.equal(projectContainmentForest(forest([['a',null,'org'],['b','a']])),null);
 assert.equal(projectContainmentForest(forest([['a',null],['a',null]])),null);
});

test('a move checks descendant depth, not just the new parent path', () => {
 const chain=Array.from({length:16},(_,i)=>['p'+i,i?'p'+(i-1):null]);
 assert.ok(projectContainmentForest(forest(chain)));
 const nodes=forest([...chain,['extra',null],['child','extra']]);
 assert.equal(reparentProjectForest(nodes,'extra','p14'),null);
 assert.ok(reparentProjectForest(nodes,'extra','p13'));
 assert.equal(projectContainmentForest(forest([...chain,['overflow','p15']])),null);
});

async function fixture(t,{install=true,shared=false}={}) {
 t.mock.method(globalThis,'fetch',async()=>assert.fail('No external network'));
 const f=await createSceneCostFixture(1,'visual',{shared}); t.after(async()=>{await f.drainBackground();f.close();});
 if(install)f.sqlite.exec(migration);
 const add=async id=>appendAuditEvent(f.env,f.streamId,'user:'+f.owner,'ProjectCreated',{project_id:id,name:id,state:'active'});
 await add('parent-a');await add('parent-b');
 const get=(id=f.projectId)=>f.request('/api/projects/containment?projectId='+id);
 const patch=(view,parentId)=>f.request('/api/projects/containment',{...f.json({projectId:view.projectId,parentId,revision:view.revision}),method:'PATCH'});
 return Object.assign(f,{add,get,move:patch});
}

test('native HTTP containment saves, reads ancestry, reparents and rejects stale edits',async t=>{
 const f=await fixture(t);let response=await f.get(),view=await response.json();assert.equal(response.status,200,JSON.stringify(view));
 assert.equal(view.accessInherited,false);assert.equal(view.canReparent,true);assert.ok(view.candidates.includes('parent-a'));
 assert.equal((await f.move(view,'parent-a')).status,200);
 response=await f.get();const nested=await response.json();assert.equal(response.status,200,JSON.stringify(nested));
 assert.deepEqual(nested.ancestors,['parent-a']);assert.notEqual(nested.revision,view.revision);
 assert.equal((await f.move(view,'parent-b')).status,409);
 assert.equal((await f.move(nested,'parent-b')).status,200);
 view=await(await f.get()).json();assert.deepEqual(view.ancestors,['parent-b']);
 const parent=await(await f.get('parent-b')).json();assert.equal(parent.candidates.includes(f.projectId),false);
 assert.equal((await f.move(parent,f.projectId)).status,403);
 assert.equal((await f.move(view,null)).status,200);assert.deepEqual((await(await f.get()).json()).ancestors,[]);
 assert.equal(response.headers.get('cache-control'),'private, no-store');
});

test('missing or modified containment schema never becomes a claimed root',async t=>{
 const f=await fixture(t,{install:false});assert.equal((await f.get()).status,503);f.sqlite.exec(migration);
 f.sqlite.exec('DROP TRIGGER project_containment_insert');assert.equal((await f.get()).status,503);
});

for(const fault of ['access','edge','declaration','custody','schema'])test('late '+fault+' changes cannot commit or deliver a stale hierarchy',async t=>{
 const f=await fixture(t),view=await(await f.get()).json();let injected=false;
 f.controls.beforeBatch=async statements=>{if(injected||!statements.some(s=>s.sql.startsWith('INSERT INTO project_containment')))return;injected=true;
  if(fault==='access')f.sqlite.exec("UPDATE users SET role='viewer'");
  if(fault==='edge')f.sqlite.prepare("INSERT INTO project_containment VALUES(?,?,?,NULL,NULL,NULL,'late','now')").run(f.owner,'parent-a',f.sqlite.prepare("SELECT event_id FROM events WHERE type='ProjectCreated' AND json_extract(payload,'$.project_id')='parent-a'").get().event_id);
  if(fault==='declaration')await f.add('late-project');
  if(fault==='custody')await compensate(f,'parent-a');
  if(fault==='schema')f.sqlite.exec('DROP TRIGGER project_containment_insert');
 };
 const response=await f.move(view,'parent-a');assert.equal(injected,true);assert.equal(response.status,503,await response.clone().text());
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM project_containment WHERE project_id=?').get(f.projectId).n,0);
});

test('native declaration mutation retires affected containment without rewriting history',async t=>{
 const f=await fixture(t),view=await(await f.get()).json();assert.equal((await f.move(view,'parent-a')).status,200);
 await compensate(f,'parent-a');
 const current=await(await f.get()).json();assert.deepEqual(current.ancestors,[]);assert.notEqual(current.revision,view.revision);
 assert.equal((await f.move(view,'parent-b')).status,409);
});

test('command boundary rejects oversized, duplicate and cross-origin writes',async t=>{
 const f=await fixture(t),view=await(await f.get()).json(),valid={projectId:f.projectId,parentId:'parent-a',revision:view.revision};
 for(const body of [JSON.stringify({...valid,extra:1}),JSON.stringify(valid).replace('{','{"parentId":null,'),' '.repeat(2049)+JSON.stringify(valid)]) {
  assert.equal((await f.request('/api/projects/containment',{method:'PATCH',headers:{'content-type':'application/json'},body})).status,400);
 }
 assert.equal((await f.request('/api/projects/containment',{method:'PATCH',headers:{'content-type':'application/json',origin:'https://attacker.invalid'},body:JSON.stringify(valid)})).status,403);
});

async function compensate(f,projectId){
 const target=f.sqlite.prepare("SELECT event_id FROM events WHERE type='ProjectCreated' AND json_extract(payload,'$.project_id')=?").get(projectId).event_id;
 const head=f.sqlite.prepare('SELECT MAX(sequence) AS n FROM events WHERE stream_id=?').get(f.streamId).n;
 const event=makeEvent(f.streamId,head+1,'user:'+f.owner,'synthetic','synthetic','ObjectDiscarded',{project_id:projectId});event.compensatesEventId=target;
 const values=eventWriteBindings(event);await f.env.DB.prepare('INSERT INTO event_write_stage('+EVENT_WRITE_COLUMNS+') VALUES('+values.map(()=>'?').join(',')+')').bind(...values).run();
}

function copyRow(f,table,where,bindings,changes){
 const row={...f.sqlite.prepare('SELECT * FROM '+table+' WHERE '+where).get(...bindings),...changes};
 f.sqlite.prepare('INSERT INTO '+table+'('+Object.keys(row).join(',')+') VALUES('+Object.keys(row).map(()=>'?').join(',')+')').run(...Object.values(row));
}
async function governedParent(f,id='parent-a'){
 const scope=f.sharing;
 copyRow(f,'organization_projects','project_access_id=?',[scope.projectAccessId],{project_access_id:'access-'+id,project_id:id});
 copyRow(f,'project_migration_states','project_access_id=?',[scope.projectAccessId],{project_access_id:'access-'+id});
}
test('governed containment requires same custody and independently authorized parent',async t=>{
 const f=await fixture(t,{shared:true});let view=await(await f.get()).json();assert.equal(view.canReparent,true,JSON.stringify(view));
 assert.equal(view.candidates.includes('parent-a'),false);assert.equal((await f.move(view,'parent-a')).status,403);
 await governedParent(f);view=await(await f.get()).json();assert.ok(view.candidates.includes('parent-a'));
 assert.equal((await f.move(view,'parent-a')).status,200);assert.deepEqual((await(await f.get()).json()).ancestors,['parent-a']);
 f.sqlite.prepare("UPDATE organization_projects SET updated_at='2026-09-19T12:00:00.000Z' WHERE project_access_id='access-parent-a'").run();
 assert.deepEqual((await(await f.get()).json()).ancestors,['parent-a']);
 f.sqlite.prepare("UPDATE organization_projects SET status='archived' WHERE project_access_id='access-parent-a'").run();
 assert.deepEqual((await(await f.get()).json()).ancestors,[]);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM project_containment').get().n,0);
});

test('native SQL rejects cycles independently of the API, and missing write acknowledgements are uncertain',async t=>{
 const f=await fixture(t),view=await(await f.get()).json();assert.equal((await f.move(view,'parent-a')).status,200);
 const declaration=id=>f.sqlite.prepare("SELECT event_id FROM events WHERE type='ProjectCreated' AND json_extract(payload,'$.project_id')=?").get(id).event_id;
 assert.throws(()=>f.sqlite.prepare("INSERT INTO project_containment VALUES(?,?,?,?,?,NULL,'cycle','now')").run(f.owner,'parent-a',declaration('parent-a'),f.projectId,declaration(f.projectId)),/cycle_or_depth/u);
 const current=await(await f.get()).json();let injected=false;
 f.controls.afterBatch=async(statements,results)=>{if(!injected&&statements.some(s=>s.sql.startsWith('INSERT INTO project_containment'))){injected=true;results.pop();}};
 assert.equal((await f.move(current,'parent-b')).status,503);assert.equal(injected,true);
 f.controls.afterBatch=null;assert.deepEqual((await(await f.get()).json()).ancestors,['parent-b']);
});

const {parseProjectContainment}=await import('../src/state/project-containment-client.ts');
test('browser protocol never accepts widened authority or unbounded ancestry',()=>{
 const value={version:'project-containment-v1',projectId:'child',revision:'sha256:'+'a'.repeat(64),ancestors:['parent'],ancestryComplete:true,parentId:'parent',candidates:['parent'],canReparent:true,accessInherited:false};
 assert.deepEqual(parseProjectContainment(value,'child'),value);
 for(const delta of [{accessInherited:true},{projectId:'other'},{parentId:'hidden'},{canReparent:false},{ancestors:['parent','parent']},{candidates:['child']},{extra:true},{revision:'arbitrary'},{ancestors:Array.from({length:16},(_,i)=>'parent'+i)}])assert.equal(parseProjectContainment({...value,...delta},'child'),null);
});

test('a shared child reader cannot discover or change an independently inaccessible parent',async t=>{
 const f=await fixture(t,{shared:true});await governedParent(f);
 const ownerView=await(await f.get()).json();assert.equal((await f.move(ownerView,'parent-a')).status,200);
 const viewer='synthetic-containment-viewer',email='containment-viewer@example.test',now=new Date().toISOString(),scope=f.sharing;
 copyRow(f,'users','user_id=?',[f.owner],{user_id:viewer,email,display_name:'Synthetic viewer'});
 copyRow(f,'organization_memberships','organization_id=? AND user_id=?',[scope.organizationId,f.owner],{membership_id:'synthetic-org-viewer',user_id:viewer,role:'member'});
 f.sqlite.prepare("INSERT INTO project_memberships(membership_id,project_access_id,project_id,organization_id,user_id,role,status,granted_by_user_id,created_at,updated_at) VALUES(?,?,?,?,?,'viewer','active',?,?,?)")
  .run('synthetic-child-viewer',scope.projectAccessId,f.projectId,scope.organizationId,viewer,f.owner,now,now);
 copyRow(f,'project_context_sessions','context_id=?',[scope.contextId],{context_id:'synthetic-viewer-context',principal_user_id:viewer});
 f.setScopedHeaders({'cookie':'forma_project_context=synthetic-viewer-context','oai-authenticated-user-id':viewer,'oai-authenticated-user-email':email,'oai-authenticated-user-full-name':'Synthetic viewer'});
 let response=await f.get(),view=await response.json();assert.equal(response.status,200,JSON.stringify(view));
 assert.deepEqual(view.ancestors,[]);assert.equal(view.ancestryComplete,false);assert.equal(view.parentId,null);assert.deepEqual(view.candidates,[]);assert.equal(view.canReparent,false);
 assert.equal(JSON.stringify(view).includes('parent-a'),false);assert.equal((await f.move(view,null)).status,403);
 f.sqlite.prepare("INSERT INTO project_memberships(membership_id,project_access_id,project_id,organization_id,user_id,role,status,granted_by_user_id,created_at,updated_at) VALUES(?,?,?,?,?,'viewer','active',?,?,?)")
  .run('synthetic-parent-viewer','access-parent-a','parent-a',scope.organizationId,viewer,f.owner,now,now);
 response=await f.get();view=await response.json();assert.equal(response.status,200,JSON.stringify(view));assert.deepEqual(view.ancestors,['parent-a']);assert.equal(view.canReparent,false);
 f.sqlite.exec("UPDATE project_memberships SET status='revoked',revoked_at='2026-01-01T00:00:00.000Z' WHERE membership_id='synthetic-parent-viewer'");
 assert.deepEqual((await(await f.get()).json()).ancestors,[]);
});

test('native hierarchy requests fit D1 expression and binding limits with bounded whole-request work',async t=>{
 const f=await fixture(t,{shared:true});await governedParent(f);
 const {enforceD1ExpressionDepth}=await import('./helpers/d1-expression-depth.mjs');
 const proof=enforceD1ExpressionDepth({env:f.env,sqlite:f.sqlite},{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}});
 let calls=0;f.controls.beforeRead=()=>{calls++;};f.controls.beforeBatch=statements=>{calls+=statements.length;};
 try{
  const before=calls;const response=await f.get(),view=await response.json();assert.equal(response.status,200,JSON.stringify(view));
  const read=calls-before;assert.ok(read<=50,'whole native GET within 50 statements');
  const start=calls;assert.equal((await f.move(view,'parent-a')).status,200);const write=calls-start;
  assert.ok(write<=50,'whole native PATCH within 50 statements');proof.assertVerified();t.diagnostic(JSON.stringify({readStatements:read,writeStatements:write}));
 }finally{proof.restore();}
});

test('organization deletion retires containment without removing unrelated personal structure',async t=>{
 const f=await fixture(t,{shared:true});await governedParent(f);const view=await(await f.get()).json();assert.equal((await f.move(view,'parent-a')).status,200);
 f.setScopedHeaders({});const personal=await(await f.get('parent-b')).json();assert.equal((await f.move(personal,null)).status,200);
 f.sqlite.prepare('DELETE FROM organization_projects WHERE organization_id=?').run(f.sharing.organizationId);
 const rows=f.sqlite.prepare('SELECT project_id FROM project_containment ORDER BY project_id').all();assert.deepEqual(rows.map(row=>row.project_id),['parent-b']);
});

for(const fault of ['oversized','late-growth'])test('project declarations are size-bound before native hydration: '+fault,async t=>{
 const f=await fixture(t);let hydrated=false,changed=false;
 if(fault==='oversized'){
  // Deliberately corrupt/legacy native public data: the normal writer minimizes it.
  const source=f.sqlite.prepare("SELECT event_id FROM events WHERE type='ProjectCreated' ORDER BY sequence LIMIT 1").get().event_id;
  const sequence=f.sqlite.prepare('SELECT MAX(sequence) AS n FROM events WHERE stream_id=?').get(f.streamId).n+1;
  copyRow(f,'events','event_id=?',[source],{event_id:crypto.randomUUID(),sequence,payload:JSON.stringify({project_id:'oversized-public',padding:'x'.repeat(1_048_577)})});
 }
 f.controls.afterRead=async(statement)=>{
  if(fault==='late-growth'&&!changed&&statement.sql.startsWith('SELECT COUNT(*) AS count,COALESCE(SUM(bytes)')){changed=true;await f.add('late-project');}
 };
 f.controls.beforeRead=statement=>{if(statement.sql.startsWith('SELECT * FROM (SELECT event.event_id AS declaration'))hydrated=true;};
 const response=await f.get();assert.equal(response.status,503);if(fault==='oversized')assert.equal(hydrated,false);else assert.equal(changed,true);
});

for(const fault of ['duplicate','utf8','bom','abort','deadline','oversized','length-mismatch'])test('containment bounded mutation upload rejects '+fault+' without writing',async t=>{
 const f=await fixture(t),view=await(await f.get()).json(),before=f.sqlite.prepare('SELECT * FROM project_containment').all();
 const {handleProjectContainment}=await import('../worker/project-containment-api.ts');
 const {NATIVE_CONTROL_READ_TIMEOUT_MS}=await import('../worker/native-control-body.ts');
 const requestController=new AbortController();let cancel=0,release;const pulled=new Promise(resolve=>{release=resolve;});
 if(fault==='deadline')t.mock.timers.enable({apis:['setTimeout']});
 let payload=JSON.stringify({projectId:view.projectId,parentId:'parent-a',revision:view.revision});
 if(fault==='duplicate')payload=payload.slice(0,-1)+',"parentId":"parent-b"}';if(fault==='bom')payload='\ufeff'+payload;
 const bytes=fault==='utf8'?new Uint8Array([0xe2,0x82]):new TextEncoder().encode(payload);
 const stream=new ReadableStream({pull(controller){release();if(['abort','deadline'].includes(fault))return;
  controller.enqueue(fault==='oversized'?new Uint8Array(2049):bytes);controller.close();
 },cancel(){cancel++;return new Promise(()=>{});}},{highWaterMark:0});
 const headers=new Headers(f.json({}).headers);headers.set('content-type','application/json');
 if(fault==='length-mismatch')headers.set('content-length',String(bytes.length+1));
 const request=new Request('http://localhost/api/projects/containment',{method:'PATCH',headers,body:stream,duplex:'half',signal:requestController.signal});
 const pending=handleProjectContainment(request,f.env);await pulled;
 if(fault==='abort')requestController.abort();if(fault==='deadline')t.mock.timers.tick(NATIVE_CONTROL_READ_TIMEOUT_MS);
 const response=await pending;assert.equal(response.status,400,await response.clone().text());assert.equal((await response.json()).error,'invalid_containment_command');
 assert.deepEqual(f.sqlite.prepare('SELECT * FROM project_containment').all(),before);assert.equal(request.body.locked,false);
 if(['abort','deadline'].includes(fault))assert.equal(cancel,1);
});

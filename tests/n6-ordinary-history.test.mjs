import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/n6-inspector-fixture.mjs';
import {readSourceAuthority,requalifySourceAuthority} from '../worker/source-authority-receipt.ts';
test('N6 ordinary user GenerationRequested preserves selected text authority',async t=>{
 const f=await fixture(t),before=await readSourceAuthority(f.env,f.user,'document');
 await f.append('GenerationRequested',{generation_id:'prior',document_id:'other',stream_id:f.user.streamId,requested_output:'image',source_surface:'still',quality:'high',purpose:'final',reference_input_count:0,reference_inputs:[],used_uploaded_reference_pixels:false,used_ideation_preview_pixels:false},'user');
 const after=await readSourceAuthority(f.env,f.user,'document');
 assert.deepEqual(after.snapshot,before.snapshot);assert.equal(after.receipt.dependencies.length,6);
 assert.deepEqual((await requalifySourceAuthority(f.env,after.receipt)).receipt,after.receipt);
});
const {ordinaryHistory}=await import('./helpers/n6-ordinary-history.mjs');
for(const outcome of ['completed','failed'])test('N6 ordinary '+outcome+' lifecycle retains all dependencies without changing selected text',async t=>{
 const f=await fixture(t),before=await readSourceAuthority(f.env,f.user,'document');
 const h=await ordinaryHistory(f,{outcome});
 const after=await readSourceAuthority(f.env,f.user,'document');
 assert.deepEqual(after.snapshot,before.snapshot);assert.ok(after.receipt.dependencies.some(d=>d.eventId===h.terminal.eventId));
 assert.deepEqual((await requalifySourceAuthority(f.env,after.receipt)).receipt,after.receipt);
});
const {preflight}=await import('./helpers/n6-inspector-fixture.mjs');
const select=r=>'/api/source-advisory?documentId=document&preflightId='+r.preflightId;
for(const runtime of ['source','production bundle']){
 for(const variant of ['completed','failed','fallback','same-document','saved-discarded'])test(`${runtime}: N6 ordinary history ${variant} original/adopted zero-effect GET`,async t=>{
  const f=await fixture(t,runtime),h=await ordinaryHistory(f,{outcome:variant==='failed'?'failed':'completed',documentId:variant==='same-document'?'document':'other',fallback:variant==='fallback'});
  if(variant==='saved-discarded'){await f.append('ObjectSaved',{object_id:h.outputId},'user');await f.append('ObjectDiscarded',{object_id:h.outputId},'user');}
  const {readiness,calls}=await preflight(f);assert.equal(calls.length,1);
  const r=await f.inspect(select(readiness)),body=await r.json();assert.equal(r.status,200,JSON.stringify(body));
  assert.equal(body.raw.requestBody,calls[0]);
  const adopted=await preflight(f,'adopted');assert.equal(adopted.calls.length,0);
  const r2=await f.inspect(select(adopted.readiness)),body2=await r2.json();assert.equal(r2.status,200,JSON.stringify(body2));
  assert.equal(body2.adopted,true);assert.equal(body2.expiresAt,body.expiresAt);assert.equal(body2.originPreflightId,readiness.preflightId);
 });
 for(const fault of ['foreign-actor','wrong-compiler','wrong-cause','wrong-correlation','wrong-document','wrong-project','scope','missing-compile','redacted-history','foreign-history','compile-substitution','derived-compile','memory','workflow','native','references','pinned','pin-cleared','duplicate-output','scope-race','history-race'])test(`${runtime}: N6 ordinary history refuses ${fault}`,async t=>{
  const f=await fixture(t,runtime),h=await ordinaryHistory(f),{readiness}=await preflight(f);
  const rewrite=(event,change)=>{const row=f.sqlite.prepare('SELECT private_json FROM event_private_payloads WHERE private_event_id=?').get(event.eventId),p=JSON.parse(row.private_json);change(p);f.sqlite.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run(JSON.stringify(p),event.eventId);};
  if(fault==='foreign-actor')await f.append('GenerationRequested',{generation_id:'foreign',document_id:'other',source_surface:'still'},'user:foreign');
  if(fault==='wrong-compiler')await f.append('ContextCompiled',h.compiled.payload,'worker:unknown',{causationId:h.request.eventId});
  if(fault==='wrong-cause')await f.append('GenerationFailed',{...h.terminal.payload,generation_id:'wrong'},'worker:generator',{causationId:f.block.eventId});
  if(fault==='wrong-correlation')await f.append('ContextCompiled',h.compiled.payload,'worker:compiler',{causationId:h.request.eventId,correlationId:'foreign'});
  if(fault==='wrong-document')await f.append('ObjectSaved',{object_id:h.outputId,document_id:'document'});
  if(fault==='wrong-project')await f.append('ObjectSaved',{object_id:h.outputId,project_id:'project'});
  const scope=()=>f.sqlite.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,actor_user_id,created_at) VALUES('history-access','output',?,'org','unrelated',?,?,'now')").run(h.outputId,f.owner,f.owner);
  if(fault==='scope')scope();
  if(fault==='missing-compile')f.sqlite.prepare('DELETE FROM event_private_payloads WHERE private_event_id=?').run(h.compiled.eventId);
  if(fault==='redacted-history')f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at='now' WHERE private_event_id=?").run(h.terminal.eventId);
  if(fault==='foreign-history')f.sqlite.prepare("UPDATE event_private_payloads SET owner_id='foreign' WHERE private_event_id=?").run(h.terminal.eventId);
  if(fault==='compile-substitution')rewrite(h.compiled,p=>p.compiled_snapshot.facts.push({block_id:'invented'}));
  if(fault==='derived-compile')rewrite(h.compiled,p=>p.compiled_snapshot.reference_inputs=[{source:'expired-output'}]);
  if(fault==='memory')rewrite(h.terminal,p=>p.memory_authored_version=1);
  if(fault==='workflow')rewrite(h.request,p=>p.workflow_id='workflow');
  if(fault==='native')rewrite(h.terminal,p=>p.source_surface='outputs');
  if(fault==='references')rewrite(h.request,p=>p.reference_inputs=[{source:'reference'}]);
  if(fault==='pinned'||fault==='pin-cleared'){await f.append('ObjectPinned',{object_id:h.outputId});if(fault==='pin-cleared')await f.append('ObjectUnpinned',{object_id:h.outputId});}
  if(fault==='duplicate-output')await f.append('GenerationCompleted',h.terminal.payload,'worker:generator',{causationId:h.compiled.eventId});
  if(fault.endsWith('-race')){let injected=false;f.control.beforeBatch=ss=>{if(injected||!ss.some(s=>s.sql.includes('WITH native_principal')))return;injected=true;const n=f.sqlite.prepare('SELECT total_changes() AS n').get().n;if(fault==='scope-race')scope();else rewrite(h.compiled,p=>p.compiled_snapshot.document.title='Changed');f.control.externalChanges+=f.sqlite.prepare('SELECT total_changes() AS n').get().n-n;};}
  const r=await f.inspect(select(readiness)),body=await r.json();assert.equal(r.status,409,JSON.stringify(body));assert.equal(body.rawAvailable,false);assert.equal(body.raw,undefined);
 });
}

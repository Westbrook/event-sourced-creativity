import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/n6-inspector-fixture.mjs';
const {readSourceAuthority,requalifySourceAuthority}=await import('../worker/source-authority-receipt.ts');
test('N6 positive canonical source receipt with telemetry and unrelated manual history',async t=>{
 const f=await fixture(t),before=f.sqlite.prepare('SELECT total_changes() AS n').get().n;
 const value=await readSourceAuthority(f.env,f.user,'document');
 assert.equal(value.receipt.dependencies.length,5);
 assert.ok(value.receipt.dependencies.some(d=>d.documentId==='other'));
 const current=await requalifySourceAuthority(f.env,value.receipt);
 assert.deepEqual(current.receipt,value.receipt);
 assert.equal(f.sqlite.prepare('SELECT total_changes() AS n').get().n,before);
});
for(const fault of ['missing','redacted','foreign','envelope','scope','unknown-event','duplicate-origin','wrong-project','derived','rights','expired-rights','memory','native','reference','canvas','incomplete','capacity','snapshot-bound','same-head-race','database-race'])test('N6 canonical source refuses '+fault,async t=>{
 const f=await fixture(t),receipt=(await readSourceAuthority(f.env,f.user,'document')).receipt;
 const target=f.block.eventId;
 if(fault==='missing')f.sqlite.prepare('DELETE FROM event_private_payloads WHERE private_event_id=?').run(target);
 if(fault==='redacted')f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at='2026-01-01' WHERE private_event_id=?").run(target);
 if(fault==='foreign')f.sqlite.prepare("UPDATE event_private_payloads SET owner_id='foreign' WHERE private_event_id=?").run(target);
 if(fault==='envelope')f.sqlite.prepare("UPDATE event_private_payloads SET document_id='other' WHERE private_event_id=?").run(target);
 if(fault==='scope')f.sqlite.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,actor_user_id,created_at) VALUES('access','document','document','org','project',?,?,'now')").run(f.owner,f.owner);
 if(fault==='unknown-event')await f.append('FutureSourceChanged',{document_id:'document'});
 if(fault==='duplicate-origin')await f.append('DocumentCreated',{project_id:'project',document_id:'document',title:'Replacement'});
 if(fault==='wrong-project')await f.append('BlockPropertyEdited',{project_id:'unrelated',block_id:'direction',property_path:'text',new_value:'Changed'});
 if(['derived','rights','expired-rights','memory'].includes(fault))await f.append('BlockPropertyEdited',{block_id:'direction',property_path:({'derived':'created_from','rights':'rights_class','expired-rights':'source_expires_at','memory':'memory_origin_version'})[fault],new_value:fault==='expired-rights'?'2000-01-01':'unsupported'});
 if(fault==='native')await f.append('DocumentRenderCompleted',{project_id:'project',document_id:'document',artifact_id:'artifact'});
 if(fault==='reference')await f.append('BlockCreated',{project_id:'project',document_id:'document',block_id:'ref',type:'reference',properties:{text:'No pixels'}});
 if(fault==='canvas')await f.append('CanvasCreated',{project_id:'project',canvas_id:'canvas'});
 if(fault==='capacity')for(let i=0;i<124;i++)await f.append('ProjectOpened',{project_id:'project'});
 if(fault==='snapshot-bound')await f.append('BlockPropertyEdited',{block_id:'direction',property_path:'text',new_value:'a'.repeat(28000)});
 if(fault==='incomplete'){
  const batch=f.db.batch;f.db.batch=async ss=>{const rows=await batch(ss);if(ss[0].sql.includes('custody_owner'))rows[0].results.pop();return rows;};
 }
 if(fault==='same-head-race'||fault==='database-race'){
  let n=0;f.control.beforeBatch=ss=>{if(ss[0].sql.includes('custody_owner')&&++n===2){if(fault==='database-race')f.env.DB={...f.db};else f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at='changed' WHERE private_event_id=?").run(target);}};
 }
 await assert.rejects(()=>requalifySourceAuthority(f.env,receipt));
});

test('N6 census exactly 128 dependencies qualifies and the 129th is unavailable',async t=>{
 const f=await fixture(t);for(let i=0;i<123;i++)await f.append('ProjectOpened',{project_id:'project'});
 const value=await readSourceAuthority(f.env,f.user,'document');assert.equal(value.receipt.dependencies.length,128);
 await f.append('ProjectOpened',{project_id:'project'});await assert.rejects(()=>readSourceAuthority(f.env,f.user,'document'),/source_census_capacity/);
});
test('N6 full snapshot must be strictly below 28000 UTF16 units',async t=>{
 const f=await fixture(t),edit=await f.append('BlockPropertyEdited',{block_id:'direction',property_path:'text',new_value:''});
 const baseline=await readSourceAuthority(f.env,f.user,'document'),length=JSON.stringify(baseline.snapshot).length;
 const row=f.sqlite.prepare('SELECT private_json FROM event_private_payloads WHERE private_event_id=?').get(edit.eventId),body=JSON.parse(row.private_json);
 body.new_value='x'.repeat(27999-length);f.sqlite.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run(JSON.stringify(body),edit.eventId);
 assert.equal(JSON.stringify((await readSourceAuthority(f.env,f.user,'document')).snapshot).length,27999);
 body.new_value+='x';f.sqlite.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run(JSON.stringify(body),edit.eventId);
 await assert.rejects(()=>readSourceAuthority(f.env,f.user,'document'),/source_snapshot_capacity/);
});

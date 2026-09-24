import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,preflight} from './helpers/n6-inspector-fixture.mjs';
import {ordinaryHistory} from './helpers/n6-ordinary-history.mjs';
import {readSourceAuthority} from '../worker/source-authority-receipt.ts';
// These refusals happen before a witness exists, so receipt inequality cannot
// mask a permissive source predicate. They exercise the actual preflight+GET.
for(const runtime of ['source','production bundle'])for(const fault of ['memory','workflow','native','references','derived-compile','wrong-document','wrong-project','wrong-cause','wrong-actor','pinned','incomplete-history','foreign-custody'])test(`${runtime}: N6 before-capture history eligibility denies ${fault}`,async t=>{
 const f=await fixture(t,runtime);
 const patch=fault==='memory'?{GenerationCompleted:{memory_authored_version:1}}:fault==='workflow'?{GenerationRequested:{workflow_id:'workflow'}}:fault==='native'?{GenerationCompleted:{source_surface:'outputs'}}:fault==='references'?{GenerationRequested:{reference_inputs:[{source:'pixel'}]}}:fault==='wrong-document'?{GenerationCompleted:{document_id:'document'}}:fault==='wrong-project'?{ContextCompiled:{project_id:'project'}}:{};
 const h=await ordinaryHistory(f,{patch});
 if(fault==='derived-compile'){
  const row=f.sqlite.prepare('SELECT private_json FROM event_private_payloads WHERE private_event_id=?').get(h.compiled.eventId),p=JSON.parse(row.private_json);p.compiled_snapshot.reference_inputs.push({source:'expired-output'});f.sqlite.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run(JSON.stringify(p),h.compiled.eventId);
 }
 if(fault==='wrong-cause')await f.append('GenerationFailed',{...h.terminal.payload,generation_id:'unbound'},'worker:generator',{causationId:f.block.eventId});
 if(fault==='wrong-actor')await f.append('GenerationRequested',{generation_id:'bad-actor',document_id:'other',source_surface:'still'},'user:foreign');
 if(fault==='pinned')await f.append('ObjectPinned',{object_id:h.outputId},'user');
 if(fault==='incomplete-history')f.sqlite.prepare('DELETE FROM event_private_payloads WHERE private_event_id=?').run(h.request.eventId);
 if(fault==='foreign-custody')f.sqlite.prepare("UPDATE event_private_payloads SET owner_id='foreign' WHERE private_event_id=?").run(h.terminal.eventId);
 await assert.rejects(()=>readSourceAuthority(f.env,f.user,'document'));
 const {readiness,calls}=await preflight(f);assert.equal(calls.length,1);assert.equal(readiness.advisoryCapture.sourceInspection,undefined);
 const r=await f.inspect('/api/source-advisory?documentId=document&preflightId='+readiness.preflightId),body=await r.json();assert.equal(r.status,409);assert.equal(body.rawAvailable,false);assert.equal(body.raw,undefined);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,preflight} from './helpers/n6-inspector-fixture.mjs';
for(const runtime of ['source','production bundle'])test(`${runtime}: N6 positive real preflight capture and selected zero-effect inspection`,async t=>{
 const f=await fixture(t,runtime),{readiness,calls}=await preflight(f);
 assert.equal(calls.length,1);assert.equal(readiness.advisoryCapture.sourceInspection,'prospective-v1',JSON.stringify(readiness.advisoryCapture));
 assert.ok(!JSON.stringify(readiness).includes('dependencies'));
 const response=await f.inspect('/api/source-advisory?documentId=document&preflightId='+readiness.preflightId),body=await response.json();
 assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.status,'available');
 assert.equal(body.raw.requestBody,calls[0]);assert.equal(body.inputs.length,2);assert.equal(body.inputs[1].flagged,true);
 assert.equal(body.identity.returnedModel,'synthetic-returned-model');assert.equal(response.headers.get('cache-control'),'private, no-store');
 const adopted=await preflight(f,'adopted');assert.equal(adopted.calls.length,0);
 const reuseResponse=await f.inspect('/api/source-advisory?documentId=document&preflightId='+adopted.readiness.preflightId),reuse=await reuseResponse.json();
 assert.equal(reuseResponse.status,200,JSON.stringify(reuse));assert.equal(reuse.originPreflightId,readiness.preflightId);assert.equal(reuse.adopted,true);assert.equal(reuse.expiresAt,body.expiresAt);
});

const selector=r=>'/api/source-advisory?documentId=document&preflightId='+r.preflightId;
const hash=async s=>{const {evidenceSha256}=await import('../worker/generation-evidence.ts');return evidenceSha256(s);};
function patchReadiness(f,r,change){const row=f.sqlite.prepare('SELECT result_json FROM generation_preflights WHERE preflight_id=?').get(r.preflightId),value=JSON.parse(row.result_json);change(value);f.sqlite.prepare('UPDATE generation_preflights SET result_json=? WHERE preflight_id=?').run(JSON.stringify(value),r.preflightId);}
async function patchEnvelope(f,r,phase,change,{rehash=true}={}){
 const [id,ref]=Object.entries(r.advisoryCapture.refs).find(([id])=>id.endsWith(':'+phase));
 const value=JSON.parse(f.sqlite.prepare('SELECT content FROM private_content WHERE content_id=?').get(ref.ref).content);
 await change(value);const raw=JSON.stringify(value);f.sqlite.prepare('UPDATE private_content SET content=? WHERE content_id=?').run(raw,ref.ref);
 if(rehash){const digest=await hash(raw);patchReadiness(f,r,v=>{v.advisoryCapture.refs[id].sha256=digest;});}
}
for(const runtime of ['source','production bundle']){
 for(const variant of ['cardinality','invalid','json','duplicate','unknown-identity','unknown-scores'])test(`${runtime}: N6 preserves ${variant} as invalid or unknown`,async t=>{
  const f=await fixture(t,runtime),{readiness}=await preflight(f,'original',variant),response=await f.inspect(selector(readiness)),body=await response.json();
  assert.equal(response.status,200,JSON.stringify(body));
  if(['cardinality','invalid','json','duplicate'].includes(variant)){assert.equal(body.validity,'invalid');assert.ok(body.inputs.every(i=>i.flagged===null&&i.categories===null&&i.scores===null));}
  if(variant==='unknown-identity')assert.deepEqual(body.identity,{requestedModel:'omni-moderation-latest',returnedModel:null,requestId:null,responseId:null});
  if(variant==='unknown-scores')assert.ok(body.inputs.every(i=>i.scores===null));
 });
 for(const fault of ['legacy','missing-body','redacted-body','foreign-body','body-expired','body-extended','envelope-digest','body-digest','request-input','result-identity','envelope-identity','witness-missing','witness-census','manifest-position','original-expired','original-extended','selected-expired','origin-deleted','owner','stream','document','revision','project','source-hash','adopter','scope','body-scope','retention','source-redacted','source-deleted','source-owner','source-change','source-incarnation','rights','memory','native','consent','principal','extra-refs','incomplete-census','census-overflow','deleted-document','missing-project','unknown-event','body-substitution','source-scope','reference','model3d','output','derived','canvas','cleared-rights'])test(`${runtime}: N6 denies ${fault} with zero effects`,async t=>{
  const f=await fixture(t,runtime),{readiness:r}=await preflight(f),ref=Object.values(r.advisoryCapture.refs)[0].ref;
  let selected=r;
  if(['selected-expired','origin-deleted','adopter'].includes(fault))selected=(await preflight(f,'adopted')).readiness;
  if(fault==='legacy')patchReadiness(f,r,v=>delete v.advisoryCapture.sourceInspection);
  if(fault==='missing-body')f.sqlite.prepare('DELETE FROM private_content WHERE content_id=?').run(ref);
  if(fault==='redacted-body')f.sqlite.prepare("UPDATE private_content SET redacted_at='2026-01-01' WHERE content_id=?").run(ref);
  if(fault==='foreign-body')f.sqlite.prepare("UPDATE private_content SET owner_id='foreign' WHERE content_id=?").run(ref);
  if(fault==='body-expired'||fault==='body-extended')f.sqlite.prepare('UPDATE private_content SET expires_at=? WHERE content_id=?').run(fault==='body-expired'?'2000-01-01T00:00:00.000Z':'2099-01-01T00:00:00.000Z',ref);
  if(fault==='envelope-digest')await patchEnvelope(f,r,'request',v=>v.requestBody+=' ',{rehash:false});
  if(fault==='body-digest')await patchEnvelope(f,r,'request',v=>v.requestBody+=' ');
  if(fault==='request-input'){let changedDigest;await patchEnvelope(f,r,'request',async v=>{const b=JSON.parse(v.requestBody);b.input.reverse();v.requestBody=JSON.stringify(b);changedDigest=v.operation.requestSha256=await hash(v.requestBody);});await patchEnvelope(f,r,'response',v=>v.operation.requestSha256=changedDigest);}
  if(fault==='result-identity')await patchEnvelope(f,r,'response',v=>v.operation.returnedModel='substituted');
  if(fault==='envelope-identity')await patchEnvelope(f,r,'response',v=>v.advisory.preflightId='other');
  if(fault==='witness-missing')await patchEnvelope(f,r,'request',v=>delete v.sourceWitness);
  if(fault==='witness-census')for(const phase of ['request','response'])await patchEnvelope(f,r,phase,v=>v.sourceWitness.authority.dependencies.pop());
  if(fault==='manifest-position')for(const phase of ['request','response'])await patchEnvelope(f,r,phase,v=>v.sourceWitness.manifest[1].sourceIndex=9);
  if(fault==='original-expired'||fault==='original-extended'||fault==='selected-expired')f.sqlite.prepare('UPDATE generation_preflights SET expires_at=? WHERE preflight_id=?').run(fault==='original-extended'?'2099-01-01T00:00:00.000Z':'2000-01-01T00:00:00.000Z',fault==='selected-expired'?selected.preflightId:r.preflightId);
  if(fault==='origin-deleted')f.sqlite.prepare('DELETE FROM generation_preflights WHERE preflight_id=?').run(r.preflightId);
  if(['owner','stream','document'].includes(fault))f.sqlite.prepare(`UPDATE generation_preflights SET ${{owner:'owner_id',stream:'stream_id',document:'document_id'}[fault]}='other' WHERE preflight_id=?`).run(r.preflightId);
  if(fault==='revision')patchReadiness(f,r,v=>v.documentRevision='wrong');
  if(fault==='project')patchReadiness(f,r,v=>v.advisoryCapture.origin.projectId='unrelated');
  if(fault==='source-hash')patchReadiness(f,r,v=>v.advisoryCapture.origin.sourceSha256='wrong');
  if(fault==='adopter')patchReadiness(f,selected,v=>v.advisoryCapture.adoptedBy.preflightId=r.preflightId);
  if(fault==='scope'||fault==='body-scope')f.sqlite.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,actor_user_id,created_at) VALUES('access',?,?,'org','project',?,?,'now')").run(fault==='scope'?'document':'content',fault==='scope'?'document':ref,f.owner,f.owner);
  if(fault==='retention')f.sqlite.prepare("INSERT INTO private_content_retention_scopes(content_id,organization_id,project_access_id,project_id,actor_user_id,classification,policy_version,assigned_expires_at,created_at) VALUES(?,'org','access','project','actor','evidence',1,'2099','now')").run(ref);
  if(fault==='source-redacted')f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at='now' WHERE private_event_id=?").run(f.block.eventId);
  if(fault==='source-deleted')f.sqlite.prepare('DELETE FROM event_private_payloads WHERE private_event_id=?').run(f.block.eventId);
  if(fault==='source-owner')f.sqlite.prepare("UPDATE event_private_payloads SET owner_id='other' WHERE private_event_id=?").run(f.block.eventId);
  if(fault==='source-change')await f.append('BlockPropertyEdited',{block_id:'direction',property_path:'text',new_value:'Changed source'});
  if(fault==='source-incarnation')await f.append('BlockCreated',{block_id:'direction',project_id:'project',document_id:'document',type:'direction',properties:{text:'Recreated'}});
  if(fault==='rights'||fault==='memory')await f.append('BlockPropertyEdited',{block_id:'direction',property_path:fault==='rights'?'rights_expires_at':'memory_origin_version',new_value:'unsupported'});
  if(fault==='native')await f.append('DocumentRenderCompleted',{project_id:'project',document_id:'document',artifact_id:'native'});
  if(fault==='consent')f.sqlite.prepare("UPDATE users SET consent_version='revoked'").run();
  if(fault==='principal')f.sqlite.prepare("UPDATE users SET role='viewer'").run();
  if(fault==='extra-refs')patchReadiness(f,r,v=>v.advisoryCapture.refs.extra=Object.values(v.advisoryCapture.refs)[0]);
  if(['reference','model3d','output','derived'].includes(fault))await f.append('BlockCreated',{project_id:'project',document_id:'document',block_id:'excluded',type:fault==='derived'?'direction':fault,properties:{text:'Synthetic excluded',...(fault==='derived'?{created_from:'provider'}:{})}});
  if(fault==='canvas')await f.append('CanvasCreated',{project_id:'project',canvas_id:'canvas'});
  if(fault==='cleared-rights'){await f.append('BlockPropertyEdited',{block_id:'direction',property_path:'rights_expires_at',new_value:'2000-01-01'});await f.append('BlockPropertyEdited',{block_id:'direction',property_path:'rights_expires_at',old_value:'2000-01-01',new_value:''});}
  if(fault==='incomplete-census'){const batch=f.db.batch;f.db.batch=async ss=>{const values=await batch(ss);if(ss[0]?.sql.includes('custody_owner'))values[0].results.pop();return values;};}
  if(fault==='census-overflow')for(let i=0;i<124;i++)await f.append('ProjectOpened',{project_id:'project'});
  if(fault==='deleted-document')await f.append('DocumentRemoved',{document_id:'document',project_id:'project'});
  if(fault==='missing-project')f.sqlite.prepare('DELETE FROM event_private_payloads WHERE private_event_id=?').run(f.project.eventId);
  if(fault==='unknown-event')await f.append('FutureSourceChanged',{document_id:'document'});
  if(fault==='body-substitution'){const second=Object.values(r.advisoryCapture.refs)[1].ref;const content=f.sqlite.prepare('SELECT content FROM private_content WHERE content_id=?').get(second).content;f.sqlite.prepare('UPDATE private_content SET content=? WHERE content_id=?').run(content,ref);}
  if(fault==='source-scope')f.sqlite.prepare("INSERT INTO project_event_scopes(event_id,project_access_id,organization_id,project_id,owner_user_id,source_stream_id,source_sequence,project_sequence,actor_user_id,created_at) VALUES(?,'a','org','project',?,?,1,1,?,'now')").run(f.block.eventId,f.owner,f.user.streamId,f.owner);
  const response=await f.inspect(selector(selected)),body=await response.json();assert.equal(response.status,409,JSON.stringify(body));assert.equal(body.rawAvailable,false);assert.ok(!JSON.stringify(body).includes('Synthetic harbor'));assert.equal(body.raw,undefined);
 });
 for(const race of ['principal','database','source','body','row','scope','deadline','wall-clock'])test(`${runtime}: N6 final batch catches ${race} race`,async t=>{
  const f=await fixture(t,runtime),{readiness:r}=await preflight(f);let injected=false;const originalNow=Date.now;t.after(()=>{Date.now=originalNow;});
  f.control.beforeBatch=statements=>{
   if(injected||!statements.some(s=>s.sql.includes('WITH native_principal')))return;
   injected=true;const before=f.sqlite.prepare('SELECT total_changes() AS n').get().n;
   if(race==='wall-clock')Date.now=()=>originalNow()+86400000;
   if(race==='principal')f.sqlite.prepare("UPDATE users SET role='viewer'").run();
   if(race==='database')f.env.DB={...f.db};
   if(race==='source')f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at='changed' WHERE private_event_id=?").run(f.block.eventId);
   if(race==='body')f.sqlite.prepare("UPDATE private_content SET content='changed' WHERE content_id=?").run(Object.values(r.advisoryCapture.refs)[0].ref);
   if(race==='row')f.sqlite.prepare("UPDATE generation_preflights SET status='changed' WHERE preflight_id=?").run(r.preflightId);
   if(race==='scope')f.sqlite.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,actor_user_id,created_at) VALUES('a','document','document','org','project',?,?,'now')").run(f.owner,f.owner);
   if(race==='deadline')f.sqlite.prepare("UPDATE generation_preflights SET expires_at='2000-01-01T00:00:00.000Z' WHERE preflight_id=?").run(r.preflightId);
   f.control.externalChanges+=f.sqlite.prepare('SELECT total_changes() AS n').get().n-before;
  };
  const response=await f.inspect(selector(r));assert.ok(injected);assert.equal(response.status,409,await response.text());
 });
 test(`${runtime}: N6 exact selection and method boundary`,async t=>{
  const f=await fixture(t,runtime),{readiness:r}=await preflight(f);
  for(const path of ['/api/source-advisory',selector(r)+'&preflightId=second',selector(r)+'&contentId=arbitrary',selector(r)+'&documentId=other'])assert.equal((await f.inspect(path)).status,400);
  assert.equal((await f.inspect(selector(r),'POST')).status,405);
  assert.equal((await f.inspect(selector(r),'GET',{})).status,409);
  assert.equal((await f.inspect(selector(r),'GET',{...f.headers,cookie:'forma_project_context=anything'})).status,409);
 });
}

for(const runtime of ['source','production bundle']){
 test(`${runtime}: N6 failed authority observation preserves ordinary preflight verdict`,async t=>{
  const f=await fixture(t,runtime);f.control.beforeBatch=ss=>{if(ss[0].sql.includes('custody_owner'))throw Error('observational census read failed');};
  const {readiness:r,calls}=await preflight(f);assert.equal(calls.length,1);assert.equal(r.probes.find(p=>p.id==='context-safety').status,'warning');assert.equal(r.advisoryCapture.sourceInspection,undefined);
  assert.equal((await f.inspect(selector(r))).status,409);
 });
 test(`${runtime}: N6 unsupported adopter cannot borrow source inspection eligibility`,async t=>{
  const f=await fixture(t,runtime),first=await preflight(f);assert.equal(first.readiness.advisoryCapture.sourceInspection,'prospective-v1');
  const adopted=await preflight(f,'narrowed','valid',{characterOutputKind:'headshot'});assert.equal(adopted.calls.length,0);
  assert.equal(adopted.readiness.advisoryCapture.sourceInspection,undefined);assert.equal((await f.inspect(selector(adopted.readiness))).status,409);
  assert.equal((await f.inspect(selector(first.readiness))).status,200);
 });
 test(`${runtime}: N6 registered Memory body origin is unavailable`,async t=>{
  const f=await fixture(t,runtime),{readiness:r}=await preflight(f),ref=Object.values(r.advisoryCapture.refs)[0].ref;
  const columns=f.sqlite.prepare('PRAGMA table_info(memory_native_answer_origins)').all();
  const values=Object.fromEntries(columns.map(c=>[c.name,c.notnull?(c.type.toLowerCase()==='integer'?1:'synthetic'):null]));
  Object.assign(values,{origin_id:'n6-synthetic-origin',schema_version:1,recipe_version:'native-answer-origin-v1',status:'active',owner_user_id:f.owner,actor_user_id:f.owner,answer_content_id:ref,selection_cursor:1,user_source_sequence:2,answer_source_sequence:3,created_at:'2020',answer_expires_at:'2098',source_retention_ceiling:'2099'});
  f.sqlite.prepare(`INSERT INTO memory_native_answer_origins(${columns.map(c=>c.name)}) VALUES(${columns.map(()=>'?')})`).run(...columns.map(c=>values[c.name]));
  assert.equal((await f.inspect(selector(r))).status,409);
 });
}

for(const runtime of ['source','production bundle'])test(`${runtime}: N6 oversized provider body stays unavailable`,async t=>{
 const f=await fixture(t,runtime),{readiness:r,calls}=await preflight(f,'original','oversized');
 assert.equal(calls.length,1);const response=await f.inspect(selector(r)),body=await response.json();assert.equal(response.status,409);assert.equal(body.rawAvailable,false);assert.equal(body.raw,undefined);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,readdirSync} from 'node:fs';
import {registerOutputSourceImports,outputTestDatabase} from './output-execution-test-helpers.mjs';
registerOutputSourceImports();
const {createSourceFreezeAdapter,resolveFreezeConfiguration}=await import('../evals/generation-reliability/preparation/source-freeze.mjs');
const {capturePreparation}=await import('../evals/generation-reliability/preparation/contract.mjs');
const {continueOutputTrustedContext}=await import('../worker/output-trusted-context.ts');
const {makeEvent,appendEvents,EVENT_WRITE_STAGE_TRIGGER_SQL}=await import('../worker/runtime.ts');
const {POLICY_VERSION,requireExistingHoldAdministrator}=await import('../worker/pilot-policy.ts');
const {preparePrivateContent}=await import('../worker/private-content-storage.ts');
const {hash}=await import('../evals/generation-reliability/core.mjs');
const target={documentId:'offline-document',projectId:'offline-project'};
async function fixture(t){
 const f=outputTestDatabase();t.after(()=>f.sqlite.close());
 for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())f.sqlite.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 f.sqlite.exec(readFileSync(new URL('../db/generation-study.pending.sql',import.meta.url),'utf8'));
 f.sqlite.exec(EVENT_WRITE_STAGE_TRIGGER_SQL);
 const now=new Date().toISOString();
 f.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES('mock-owner','owner@example.test','Offline only','admin',?,?,?,?)").run(POLICY_VERSION,now,now,now);
 const env={...f.env,FORMA_GENERATION_SOURCE_FREEZE_ENABLED:'1',FORMA_GENERATION_STUDY_ORIGIN:'https://freeze.example.test'};
 const request=()=>new Request(env.FORMA_GENERATION_STUDY_ORIGIN+'/internal-freeze',{method:'POST',headers:{origin:env.FORMA_GENERATION_STUDY_ORIGIN,'oai-authenticated-user-id':'mock-owner','oai-authenticated-user-email':'owner@example.test'}});
 const add=(type,payload)=>appendEvents(env,[makeEvent('creative:mock-owner',0,'user:mock-owner','offline','seed',type,{project_id:target.projectId,document_id:target.documentId,...payload})]);
 await add('ProjectCreated',{name:'Offline'});await add('DocumentCreated',{title:'Offline source'});
 await add('BlockCreated',{block_id:'source',scope:'document',type:'direction',position:'a0',properties:{text:'Élodie: preserve exact\nline breaks. No logos.',authority:'authored',weight:1}});
 const adapter=createSourceFreezeAdapter(env),freeze=()=>adapter.freezeSource(request(),target),read=ref=>adapter.readPrivateFreeze(request(),{...target,ref});
 return {...f,env,request,add,adapter,freeze,read};
}
const originalFetch=globalThis.fetch;let network=0;
test.before(()=>{globalThis.fetch=async()=>{network++;throw Error('no-network');};});
test.after(()=>{globalThis.fetch=originalFetch;assert.equal(network,0);});
test('disabled means no authority, database, key or body access',async()=>{
 const env={get DB(){throw Error('db');},get OPENAI_API_KEY(){throw Error('key');}};
 const a=createSourceFreezeAdapter(env);assert.deepEqual(await a.freezeSource(null,null),{status:'disabled'});assert.deepEqual(await a.readPrivateFreeze(null,null),{status:'disabled'});
});
test('real authoritative fold, private exact bytes and actual stored expiry; H4 builder reuse',async t=>{
 const f=await fixture(t),result=await f.freeze();assert.equal(result.status,'frozen');assert.equal(JSON.stringify(result).includes('Élodie'),false);
 const saved=await f.read(result.source.ref),auth=await requireExistingHoldAdministrator(f.request(),f.env);
 const trusted=await continueOutputTrustedContext(f.request(),f.env,target.documentId,'read',auth);
 assert.equal(saved.source.bytes,JSON.stringify({...trusted.context.snapshot,document:{id:target.documentId,title:"Offline source"},standing_constraints:[]}));assert.equal(hash(saved.source.bytes),result.source.sha256);
 const rows=f.sqlite.prepare('SELECT * FROM private_content').all();assert.equal(rows.length,2);
 assert.ok(rows.every(r=>r.expires_at===result.source.expiresAt));assert.ok(Date.parse(result.source.expiresAt)<Date.parse(result.source.nativeExpiresAt));
 const config={model:'gpt-5.6-terra',modelBasis:'application-default',accountId:'offline-account',region:'offline-region',projectHeader:null,endpoint:'https://api.openai.com/v1/responses',serviceTier:'standard',resolutionVersion:'offline-v1',resolutionEvidenceRef:'offline-evidence',credentialBinding:'offline-binding',expiresAt:new Date(Date.now()+3600000).toISOString()};
 const plan=capturePreparation({source:saved.source,config,payerId:'mock-owner',runtimeHash:hash('offline')});assert.equal(plan.source.projectId,target.projectId);assert.ok(plan.request.body.includes('Élodie'));
});
test('native document-artifact-input rejects expiryCeiling; bounded adapter does not use it',async t=>{
 const f=await fixture(t);await assert.rejects(preparePrivateContent(f.env,'mock-owner','document-artifact-input','{}',undefined,undefined,undefined,undefined,new Date(Date.now()+60000).toISOString()),/private_content_expiry_ceiling_invalid/);
 f.env.FORMA_EVIDENCE_RETENTION_DAYS='1';const r=await f.freeze();assert.equal(r.source.expiresAt,r.source.nativeExpiresAt);
});
for(const [name,mutate] of [
 ['revoked authority',f=>f.sqlite.exec("UPDATE users SET role='viewer'")],
 ['principal epoch change',f=>f.sqlite.exec("UPDATE users SET updated_at='2099-01-01T00:00:00.000Z'")],
 ['expired private source', (f,r)=>f.sqlite.prepare('UPDATE private_content SET expires_at=? WHERE content_id=?').run('2000-01-01T00:00:00.000Z',r.source.ref)],
 ['revoked private source',(f,r)=>f.sqlite.prepare('UPDATE private_content SET redacted_at=? WHERE content_id=?').run(new Date().toISOString(),r.source.ref)],
 ['changed stored expiry',(f,r)=>f.sqlite.prepare('UPDATE private_content SET expires_at=? WHERE content_id=?').run(new Date(Date.now()+3600000).toISOString(),r.source.ref)],
 ['source head change',f=>f.add('BlockPropertyEdited',{block_id:'source',property_path:'text',new_value:'Changed'})],
 ['missing private source history',f=>f.sqlite.exec("UPDATE event_private_payloads SET redacted_at='2026-01-01T00:00:00.000Z'")],
 ['project-scoped custody',(f,r)=>f.sqlite.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,actor_user_id,created_at) VALUES('offline-access','content',?,'offline-org','offline-project','mock-owner','actor_private','mock-owner',?)").run(r.source.ref,new Date().toISOString())],
])test(name+' refuses existing freeze',async t=>{const f=await fixture(t),r=await f.freeze();await mutate(f,r);await assert.rejects(f.read(r.source.ref));});
test('wrong document/project and client text never select alternate source',async t=>{
 const f=await fixture(t);await assert.rejects(f.adapter.freezeSource(f.request(),{...target,projectId:'other'}),/scope_requires_separate_binding/);
 const r=await f.adapter.freezeSource(f.request(),{...target,snapshot:{facts:[]}}),saved=await f.read(r.source.ref);assert.ok(saved.source.bytes.includes('Élodie'));
});
test('Memory authored source is excluded before new private custody',async t=>{
 const f=await fixture(t);await f.add('BlockPropertyEdited',{block_id:'source',property_path:'text',new_value:'Memory draft',memory_authored_version:1});await assert.rejects(f.freeze(),/source_binding_unqualified/);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM private_content').get().n,0);
});
test('head changes during custody preparation reject the entire insert transaction',async t=>{
 const f=await fixture(t),batch=f.env.DB.batch.bind(f.env.DB);let changed=false;
 f.env.DB.batch=async statements=>{if(!changed&&statements.some(s=>s.sql.startsWith('INSERT INTO private_content'))){changed=true;await f.add('BlockPropertyEdited',{block_id:'source',property_path:'text',new_value:'Later'});}return batch(statements);};
 await assert.rejects(f.freeze());assert.equal(changed,true);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM private_content').get().n,0);
});
test('lost custody acknowledgement never returns success or manufactures replacement',async t=>{
 const f=await fixture(t),batch=f.env.DB.batch.bind(f.env.DB);f.env.DB.batch=async statements=>{const r=await batch(statements);if(statements.some(s=>s.sql.startsWith('INSERT INTO private_content')))throw Error('lost-ack');return r;};
 await assert.rejects(f.freeze(),/lost-ack/);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM private_content').get().n,2);
});
test('configuration metadata is unavailable until server-bound; no secret access',()=>{
 const env={get OPENAI_API_KEY(){throw Error('key');}};assert.equal(resolveFreezeConfiguration(env).available,false);
 const c={model:'gpt-5.6-terra',modelBasis:'application-default',projectHeader:null,endpoint:'https://api.openai.com/v1/responses',serviceTier:'standard',accountId:'offline',region:'offline',resolutionVersion:'offline',resolutionEvidenceRef:'offline',credentialBinding:'offline',expiresAt:new Date(Date.now()+3600000).toISOString(),secret:'must-not-export'};
 env.FORMA_PREPARATION_CONFIG=c;env.FORMA_PREPARATION_CREDENTIAL_BINDING='offline';assert.equal(resolveFreezeConfiguration(env).configuration.secret,undefined);
 for(const patch of [{OPENAI_MODEL:'different'},{OPENAI_PROJECT:'different'},{FORMA_PREPARATION_CREDENTIAL_BINDING:'different'}])assert.throws(()=>resolveFreezeConfiguration(Object.assign(Object.create(env),patch)),/configuration_unqualified/);
});
test('partial history cannot be certified after private evidence disappears',async t=>{
 const f=await fixture(t);f.sqlite.exec("DELETE FROM event_private_payloads WHERE document_id='offline-document'");await assert.rejects(f.freeze(),/source_unavailable|source_incomplete/);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM private_content').get().n,0);
});
test('authority revocation during insert rolls both rows back',async t=>{
 const f=await fixture(t),batch=f.env.DB.batch.bind(f.env.DB);let changed=false;
 f.env.DB.batch=async statements=>{if(!changed&&statements.some(s=>s.sql.startsWith('INSERT INTO private_content'))){changed=true;f.sqlite.exec("UPDATE users SET role='viewer'");}return batch(statements);};
 await assert.rejects(f.freeze());assert.equal(changed,true);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM private_content').get().n,0);
});
test('custody revocation between read and disclosure is rechecked',async t=>{
 const f=await fixture(t),r=await f.freeze(),batch=f.env.DB.batch.bind(f.env.DB);let changed=false;
 f.env.DB.batch=async statements=>{const result=await batch(statements);if(!changed&&statements.some(s=>s.sql.startsWith('SELECT content_id,content,created_at,expires_at'))){changed=true;f.sqlite.prepare('UPDATE private_content SET redacted_at=? WHERE content_id=?').run(new Date().toISOString(),r.source.ref);}return result;};
 await assert.rejects(f.read(r.source.ref));assert.equal(changed,true);
});
test('complete source uses all durable history pages, including a late block',async t=>{
 const f=await fixture(t),events=Array.from({length:5000},()=>makeEvent('creative:mock-owner',0,'user:mock-owner','offline','page','OfflineNoop',{}));await appendEvents(f.env,events);
 await f.add('BlockCreated',{block_id:'late',scope:'document',type:'direction',position:'b0',properties:{text:'Late source, no omissions',authority:'approved',weight:1}});
 const saved=await f.read((await f.freeze()).source.ref);assert.equal(saved.source.sourceHead,5004);assert.ok(saved.source.bytes.includes('Late source, no omissions'));assert.equal(JSON.parse(saved.source.bytes).facts.length,2);
});
test('tighter rights deadline bounds actual storage without extending original retention',async t=>{
 const f=await fixture(t),expiresAt=new Date(Date.now()+600000).toISOString();await f.add('BlockPropertyEdited',{block_id:'source',property_path:'license_expires_at',new_value:expiresAt});
 const r=await f.freeze();assert.equal(r.source.expiresAt,expiresAt);assert.ok(f.sqlite.prepare('SELECT expires_at FROM private_content').all().every(row=>row.expires_at===expiresAt));
});
test('source hash corruption, receipt expiry extension and missing receipt deny reuse',async t=>{
 for(const mutation of ["UPDATE private_content SET content='{}' WHERE content_id NOT LIKE '%:freeze'","UPDATE private_content SET content=json_set(content,'$.expiresAt','2099-01-01T00:00:00.000Z') WHERE content_id LIKE '%:freeze'","DELETE FROM private_content WHERE content_id LIKE '%:freeze'"]){const f=await fixture(t),r=await f.freeze();f.sqlite.exec(mutation);await assert.rejects(f.read(r.source.ref));}
});
test('inactive source still imposes its custody deadline',async t=>{
 const f=await fixture(t),expiresAt=new Date(Date.now()+600000).toISOString();await f.add('BlockPropertyEdited',{block_id:'source',property_path:'license_expires_at',new_value:expiresAt});await f.add('BlockPropertyEdited',{block_id:'source',property_path:'weight',new_value:0});
 const r=await f.freeze();assert.equal(r.source.expiresAt,expiresAt);const body=JSON.parse((await f.read(r.source.ref)).source.bytes);assert.equal(body.facts[0].active,false);
});
test('global preferences are refused until full private custody is qualified, never silently summarized',async t=>{
 const f=await fixture(t);await f.add('PreferenceAuthored',{preference_id:'global',axis:'style',value:'Exact negative constraint '.repeat(20),polarity:'forbid'});await assert.rejects(f.freeze(),/source_binding_unqualified/);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM private_content').get().n,0);
});

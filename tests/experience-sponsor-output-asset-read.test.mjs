import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sponsorOutputAssetReadFixture,readPolicy,responseJson,hash} from './sponsor-output-asset-read-fixture.mjs';
const [{SPONSOR_OUTPUT_ASSET_READ_INDEXES},{handleOutputRequirements},{handleDocumentJobs},{appendAuditEvent}]=await Promise.all([
 import('../worker/experience-sponsor-output-asset-read.ts'),import('../worker/output-requirements-api.ts'),import('../worker/document-jobs-api.ts'),import('../worker/runtime.ts'),
]);
const BASE='/api/output-requirements';
const fixture=(t,options={})=>sponsorOutputAssetReadFixture(t,{indexDefinitions:SPONSOR_OUTPUT_ASSET_READ_INDEXES,...options});
async function image(response,f,asset=f.adopted){assert.equal(response.status,200, response.status===200?'':await response.text());assert.equal(response.headers.get('content-type'),'image/png');assert.equal(response.headers.get('x-output-sha256'),asset.sha256);const bytes=new Uint8Array(await response.arrayBuffer());assert.equal(hash(bytes),asset.sha256);assert.deepEqual(bytes,asset.bytes);return bytes;}
function snapshot(f,path=BASE){const request=new Request(`http://localhost${path}?documentId=${f.documentId}`,{headers:f.actorHeaders});return handleOutputRequirements(request,f.env,path,f.context);}
function updatePrivate(f,change){const body=JSON.parse(f.assetPrivate.private_json);change(body);f.sqlite.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run(JSON.stringify(body),f.assetEvent.eventId);}

test('actual native adopted Image downloads through one passive original media attempt with exact bytes and no native writes',async t=>{
 const f=await fixture(t),before=f.snapshotNativeState();await image(await f.readAsset(),f);
 assert.equal(f.attempts().length,1);assert.equal(f.attempts()[0].job_id,f.jobId);assert.equal(f.attempts()[0].operation,'image-media');assert.equal(f.io.get,1);f.assertReadOnly(before);
 const plan=f.sqlite.prepare('EXPLAIN QUERY PLAN SELECT asset_id FROM output_assets INDEXED BY idx_sponsor_output_asset_lookup WHERE owner_user_id=? AND document_id=? AND asset_id=?').all(f.actor,f.documentId,f.assetId);
 assert.ok(plan.some(row=>/SEARCH output_assets USING (?:COVERING )?INDEX idx_sponsor_output_asset_lookup/u.test(row.detail)));
});
test('Jobs and adopted asset aliases share the same actor request ledger',async t=>{
 const policy=readPolicy();policy.actor.maximumRequestsPerWindow=2;const f=await fixture(t,{policy}),before=f.snapshotNativeState();
 const request=new Request(`http://localhost/api/document-jobs/${f.jobId}`,{headers:f.actorHeaders});await responseJson(await handleDocumentJobs(request,f.env,f.jobId,f.context));
 await image(await f.readAsset(),f);await responseJson(await f.readAsset(),429);assert.equal(f.attempts().length,2);assert.equal(f.io.get,1);f.assertReadOnly(before);
});
for(const path of [BASE,`${BASE}/deliveries/known-or-guessed`])test(`${path} is explicitly closed for a sponsored Document without history reads or campaign charge`,async t=>{
 const f=await fixture(t),before=f.snapshotNativeState();const value=await responseJson(await snapshot(f,path),403);assert.equal(value.error,'sponsor_output_selection_required');assert.equal(f.attempts().length,0);assert.equal(f.io.get,0);f.assertReadOnly(before);
});
test('owned upload coexisting with sponsored assets keeps ordinary exact download without read policy or campaign charge',async t=>{
 const f=await fixture(t,{ordinary:true,policy:null}),before=f.snapshotNativeState();await image(await f.readAsset(f.ordinary.assetId),f,f.ordinary);assert.equal(f.attempts().length,0);f.assertReadOnly(before);
});
for(const missing of ['policy','read schema','asset index','actor index','both slot/grant tables'])test(`missing ${missing} cannot send a sponsored asset through an ordinary reader`,async t=>{
 const f=await fixture(t,{policy:missing==='policy'?null:readPolicy()});
 if(missing==='read schema')f.sqlite.exec('DROP TABLE experience_sponsor_read_attempts;DROP TABLE experience_sponsor_read_policies');
 if(missing==='asset index')f.sqlite.exec('DROP INDEX idx_sponsor_output_asset_lookup');
 if(missing==='actor index')f.sqlite.exec('DROP INDEX idx_sponsor_image_actor_history');
 if(missing==='both slot/grant tables'){f.sqlite.exec('PRAGMA foreign_keys=OFF;DROP TABLE output_operation_slots;DROP TABLE output_execution_grants');}
 const before=f.snapshotNativeState();await responseJson(await f.readAsset(),403);assert.equal(f.io.get,0);f.assertReadOnly(before);
});
for(const change of ['jobId','completionEventId','slotId','targetContractDigest','sourceDigest','redacted adoption','row storage','row owner'])test(`changed ${change} refuses exact sponsored adoption`,async t=>{
 const f=await fixture(t);
 if(change==='redacted adoption')f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at='2026-01-01' WHERE private_event_id=?").run(f.assetEvent.eventId);
 else if(change==='row storage')f.sqlite.prepare("UPDATE output_assets SET storage_key='other-owned-key' WHERE asset_id=?").run(f.assetId);
 else if(change==='row owner')f.sqlite.prepare("UPDATE output_assets SET owner_user_id='other-owner' WHERE asset_id=?").run(f.assetId);
 else updatePrivate(f,body=>body.asset.origin[change]='wrong-value');
 const before=f.snapshotNativeState();const response=await f.readAsset();assert.ok([403,404,409].includes(response.status),response.status===200?"Unexpected asset response":await response.text());assert.equal(f.io.get,change==='row storage'?1:0);f.assertReadOnly(before);
});
test('expired generation grants, disabled campaign and expired job retention preserve currently owned completed file reads',async t=>{
 const f=await fixture(t);f.sqlite.exec("UPDATE experience_sponsor_campaigns SET enabled=0;UPDATE experience_sponsor_grants SET enabled=0,expires_at_ms=issued_at_ms+1;UPDATE output_execution_grants SET expires_at='2000-01-01T00:00:00.000Z';UPDATE document_jobs SET expires_at='2000-01-01T00:00:00.000Z'");
 const before=f.snapshotNativeState();await image(await f.readAsset(),f);assert.equal(f.attempts().length,1);f.assertReadOnly(before);
});
test('late adoption redaction after R2 load fails final atomic custody instead of disclosing bytes',async t=>{
 const f=await fixture(t);f.beforeMediaGet=()=>f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at='2026-01-01' WHERE private_event_id=?").run(f.assetEvent.eventId);
 const response=await f.readAsset();assert.ok([403,409,410].includes(response.status),await response.text());assert.equal(f.io.get,1);assert.equal(f.attempts().length,1);f.assertNoIoWrites();
});
test('R2 metadata cannot substitute a different owned file',async t=>{
 const f=await fixture(t);f.transformMedia=object=>({...object,customMetadata:{...object.customMetadata,assetId:'other-asset'}});
 const response=await f.readAsset();assert.ok([403,404,409].includes(response.status),response.status===200?"Unexpected asset response":await response.text());assert.equal(f.attempts().length,1);f.assertNoIoWrites();
});
test('tiny allowance refuses before native source history or R2 and retains its one attempt',async t=>{
 const policy=readPolicy();policy.operations['image-media'].maximumBytes=200;const f=await fixture(t,{policy}),before=f.snapshotNativeState();
 await responseJson(await f.readAsset(),403);assert.equal(f.attempts().length,1);assert.equal(f.io.get,0);f.assertReadOnly(before);
});
test('oversized unrelated private source is rejected by scalar preflight before raw private history dispatch',async t=>{
 const policy=readPolicy();policy.operations['image-media'].maximumBytes=1_000_000;const f=await fixture(t,{policy});
 await appendAuditEvent(f.env,f.stream,'user','DocumentCreated',{document_id:'unrelated-source-doc',project_id:'project-atmosphere',title:'x'.repeat(300_000)});
 const prepare=f.DB.prepare.bind(f.DB);let raw=0;f.DB.prepare=sql=>{if(sql.includes('FROM candidate')&&sql.includes('WHERE (SELECT valid=1')&&sql.includes('events.event_id'))raw++;return prepare(sql);};
 const before=f.snapshotNativeState();await responseJson(await f.readAsset(),403);assert.equal(raw,0);assert.equal(f.io.get,0);f.assertReadOnly(before);
});
test('request abort after R2 acquisition withholds the response under the same absolute cutoff',async t=>{
 const f=await fixture(t),controller=new AbortController();f.beforeMediaGet=()=>controller.abort();
 await responseJson(await f.readAsset(f.assetId,{signal:controller.signal}),403);assert.equal(f.attempts().length,1);f.assertNoIoWrites();
});
test('another sponsored Document in the same stream remains internal source reconstruction; only selected asset returns and consumes allowance',async t=>{
 const f=await fixture(t,{secondSponsored:true}),keys=[];f.beforeMediaGet=key=>keys.push(key);const before=f.snapshotNativeState();
 await image(await f.readAsset(),f);assert.deepEqual(keys,[f.adopted.key]);assert.equal(f.attempts().length,1);assert.equal(f.attempts()[0].job_id,f.jobId);assert.notEqual(f.otherSponsored.jobId,f.jobId);f.assertReadOnly(before);
});
test('partial sponsor authority with missing consumption and malformed authorization cannot become ordinary',async t=>{
 const f=await fixture(t),authorization=f.sqlite.prepare('SELECT authorization_event_id FROM output_execution_grants WHERE grant_id=?').get(f.slot.grant_id);
 f.sqlite.exec('PRAGMA foreign_keys=OFF;DROP TABLE experience_sponsor_consumptions');f.sqlite.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run('x'.repeat(150_000),authorization.authorization_event_id);
 const before=f.snapshotNativeState();await responseJson(await f.readAsset(),403);assert.equal(f.attempts().length,0);assert.equal(f.io.get,0);f.assertReadOnly(before);
});
test('existing sponsored profile lifecycle changes refuse without initializing or mutating the account',async t=>{
 const f=await fixture(t),before=f.snapshotNativeState(),prepare=f.DB.prepare.bind(f.DB);let writes=0;
 f.DB.prepare=sql=>{if(/^\s*(?:CREATE|ALTER|INSERT|UPDATE|DELETE|DROP|REPLACE)/iu.test(sql)){writes++;throw Error('Lifecycle write forbidden in passive sponsored GET');}return prepare(sql);};
 await responseJson(await f.readAsset(f.assetId,{headers:{'oai-authenticated-user-full-name':'Changed%20Profile','oai-authenticated-user-full-name-encoding':'percent-encoded-utf-8'}}),403);
 assert.equal(writes,0);assert.equal(f.io.get,0);assert.equal(f.attempts().length,0);f.assertReadOnly(before);
});
test('ordinary coexisting upload classification is pinned through native final disclosure',async t=>{
 const f=await fixture(t,{ordinary:true}),prepare=f.DB.prepare.bind(f.DB);let changed=false;
 f.DB.prepare=sql=>{if(!changed&&sql==='SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?'){
  changed=true;const body=JSON.parse(f.ordinary.privateRow.private_json);body.asset.origin={...f.origin};
  f.sqlite.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run(JSON.stringify(body),f.ordinary.event.eventId);
 }return prepare(sql);};
 const response=await f.readAsset(f.ordinary.assetId);assert.ok([403,409,410].includes(response.status),response.status===200?'Unexpected unmetered asset':await response.text());assert.equal(changed,true);assert.equal(f.attempts().length,0);f.assertNoIoWrites();
});
test('ordinary Document snapshot coexists with sponsored history without campaign debit',async t=>{
 const f=await fixture(t);await appendAuditEvent(f.env,f.stream,'user','DocumentCreated',{document_id:'ordinary-output-doc',project_id:'project-atmosphere',title:'Ordinary Document'});
 const request=new Request(`http://localhost${BASE}?documentId=ordinary-output-doc`,{headers:f.actorHeaders}),before=f.snapshotNativeState();
 const result=await responseJson(await handleOutputRequirements(request,f.env,BASE,f.context));assert.equal(result.documentId,'ordinary-output-doc');assert.equal(f.attempts().length,0);f.assertReadOnly(before);
});
test('ordinary cold onboarding remains available when no sponsor configuration exists',async t=>{
 const {outputTestDatabase}=await import('./output-execution-test-helpers.mjs');const f=outputTestDatabase();t.after(()=>f.sqlite.close());
 const request=new Request(`http://localhost${BASE}?documentId=ordinary-new-doc`);const response=await handleOutputRequirements(request,f.env,BASE,{waitUntil(){throw Error('No work allowed');}});
 assert.equal(response.status,428,await response.text());assert.ok(f.sqlite.prepare("SELECT 1 FROM users WHERE user_id='dev-local-creative'").get());
});
test('cold partial install retaining sponsor configuration refuses without schema bootstrap',async t=>{
 const {outputTestDatabase}=await import('./output-execution-test-helpers.mjs');const f=outputTestDatabase();t.after(()=>f.sqlite.close());f.sqlite.exec('CREATE TABLE experience_sponsor_retained(marker TEXT)');
 const prepare=f.DB.prepare.bind(f.DB);let writes=0;f.DB.prepare=sql=>{if(/^\s*(?:CREATE|ALTER|INSERT|UPDATE|DELETE|DROP|REPLACE)/iu.test(sql)){writes++;throw Error('Cold sponsor read cannot bootstrap');}return prepare(sql);};
 const request=new Request(`http://localhost${BASE}?documentId=known-doc`);await responseJson(await handleOutputRequirements(request,f.env,BASE,{waitUntil(){throw Error('No work allowed');}}),403);assert.equal(writes,0);assert.equal(f.sqlite.prepare("SELECT 1 FROM sqlite_schema WHERE name='users'").get(),undefined);
});
test('delayed response consumer cannot renew the original asset read deadline',async t=>{
 const f=await fixture(t),response=await f.readAsset();assert.equal(response.status,200);const now=performance.now();t.mock.method(performance,'now',()=>now+60_000);
 await assert.rejects(response.arrayBuffer(),/sponsor_read_deadline/u);assert.equal(f.attempts().length,1);f.assertNoIoWrites();
});
test('ordinary native Slides download remains available in a Document containing sponsored Image history without charging Image allowance',async t=>{
 const f=await fixture(t,{ordinaryNativeSlides:true}),asset=f.ordinaryNativeSlides,keys=[];f.beforeMediaGet=key=>keys.push(key);const before=f.snapshotNativeState();
 const response=await f.readAsset(asset.assetId);assert.equal(response.status,200,response.status===200?'':await response.text());
 assert.equal(response.headers.get('content-type'),'application/vnd.openxmlformats-officedocument.presentationml.presentation');
 const bytes=new Uint8Array(await response.arrayBuffer());assert.deepEqual(bytes,asset.bytes);assert.equal(hash(bytes),asset.sha256);
 assert.equal(asset.asset.inspection.facts.slideCount,9);assert.deepEqual(keys,[asset.key]);assert.equal(f.attempts().length,0);f.assertReadOnly(before);
});
test('partial native schema cannot erase sponsorship merely by also losing the dormant sponsor tables',async t=>{
 const f=await fixture(t);f.sqlite.exec('PRAGMA foreign_keys=OFF;DROP TABLE output_operation_slots;DROP TABLE output_execution_grants');
 for(const {name} of f.sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name GLOB 'experience_sponsor_*'").all())f.sqlite.exec(`DROP TABLE "${name}"`);
 const before=f.snapshotNativeState();await responseJson(await f.readAsset(),403);assert.equal(f.io.get,0);f.assertReadOnly(before);
});

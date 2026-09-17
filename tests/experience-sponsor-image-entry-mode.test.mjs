import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {writeFileSync} from 'node:fs';
import {
  hostFixture,confirmationTerms,commitFromEmpty,attempts,count,nativeState,useActualWorker,seedCreativeSentinels,
  entryConfig,modePath,freshSelector,draftSelector,intentSelector,observeHostDatabase,
  assertModeDescriptor,assertModeUnavailable,assertFullBootstrapCharge,assertNoCreativeTransfer,
} from './helpers/sponsor-image-host-fixture.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';

const [{createSponsorImageEntryModeRoute},{SPONSOR_INTAKE_SCHEMA},{canonicalJson,digest},{resolveSponsorIntakeRead}]=await Promise.all([
  import('../worker/experience-sponsor-image-entry-mode.ts'),import('../worker/experience-sponsor-intake.ts'),
  import('../src/experiences/compiler.ts'),import('../worker/experience-sponsor-intake-reads.ts'),
]);
const originalFetch=globalThis.fetch;let outbound=0;
globalThis.fetch=()=>{outbound++;throw Error('Image entry-mode qualification prohibits every network/provider request');};
after(()=>{globalThis.fetch=originalFetch;assert.equal(outbound,0);});
const finalSql=sql=>sql.includes('/* sponsor-image-entry-mode-final */');
const ordinarySql=sql=>sql.includes('/* sponsor-image-entry-mode-ordinary */');
const readMode=async(f,selector=freshSelector(),config=f.config,options)=>{
  const response=await createSponsorImageEntryModeRoute(config)(f.modeRequest(selector,options),f.env);
  return {response,body:await response.json()};
};

test('fresh absent or disabled configuration is ordinary with zero database or principal queries',async()=>{
  let databaseCalls=0;
  const query=()=>{databaseCalls++;assert.fail('ordinary fresh mode queried the database');};
  const env={DB:{prepare:query,batch:query}};
  for(const config of [undefined,{version:2,enabled:false}]){
    const response=await createSponsorImageEntryModeRoute(config)(new Request('http://localhost'+modePath),env);
    assertModeDescriptor(response,await response.json(),{mode:'ordinary',selector:freshSelector()});
  }
  assert.equal(databaseCalls,0);
});

test('configuration is closed and does not invoke accessor properties',()=>{
  const valid=entryConfig('fixture-campaign');let getters=0;
  const accessor={...valid};Object.defineProperty(accessor,'freshCampaignId',{enumerable:true,get(){getters++;return 'fixture-campaign';}});
  for(const config of [null,{}, {...valid,version:1},{...valid,audience:'guest'},{...valid,output:'slides'},
    {...valid,generation:'enabled'},{...valid,payerUserId:'caller'},{...valid,freshCampaignId:''},
    {version:2,enabled:false,generation:'disabled'},accessor])
    assert.throws(()=>createSponsorImageEntryModeRoute(config),/sponsor_image_entry_configuration_invalid/);
  assert.equal(getters,0);
});

test('only the fixed GET route and exact bounded selector are accepted before database access',async()=>{
  const route=createSponsorImageEntryModeRoute(entryConfig('fixture-campaign'));
  const env=new Proxy({}, {get(){assert.fail('invalid request accessed environment');}});
  for(const path of ['/api/experiences/image','/api/experiences/image/entry-mode/','/api/experiences/slides/entry-mode'])
    assert.equal(await route(new Request('http://localhost'+path),env),null);
  for(const method of ['POST','PUT','DELETE','HEAD','OPTIONS']){
    const response=await route(new Request('http://localhost'+modePath,{method}),env);
    assert.equal(response.status,405);assert.equal(response.headers.get('allow'),'GET');
  }
  const draftId='experience-draft-'+'a'.repeat(64),intentId='7b45d97e-9164-459d-97fb-bdc2850654fe';
  for(const query of ['?campaignId=caller','?draftId=bad','?intentId=bad',`?draftId=${draftId}&draftId=${draftId}`,
    `?intentId=${intentId}&intentId=${intentId}`,`?draftId=${draftId}&intentId=${intentId}`,
    `?draftId=${draftId}&unexpected=true`,'?unused='+('x'.repeat(1100))]){
    const response=await route(new Request('http://localhost'+modePath+query),env);
    assert.equal(response.status,400);assert.equal(response.headers.get('cache-control'),'private, no-store');
  }
});

test('actual fresh resolver uses a single full bootstrap allocation and emits only the bounded descriptor under strict D1 limits',{timeout:120_000},async t=>{
  const f=await hostFixture(t),trace=observeHostDatabase(f),strict=enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100_000}});
  t.after(()=>{
    if(process.env.FORMA_SPONSOR_IMAGE_MODE_SQL_ARTIFACT)writeFileSync(process.env.FORMA_SPONSOR_IMAGE_MODE_SQL_ARTIFACT,JSON.stringify({
      kind:'actual-sponsor-image-entry-mode',outbound,records:trace.records,compileRecords:strict.records,failures:strict.failures},null,2));
    strict.restore();trace.restore();
  });
  const before=nativeState(f),{response,body}=await readMode(f);
  assertModeDescriptor(response,body,{mode:'sponsor-image',selector:freshSelector(),actorUserId:f.actor});
  assert.equal(f.bootstrapAttempts().length,1);assertFullBootstrapCharge(f,f.bootstrapAttempts()[0]);
  assert.deepEqual(nativeState(f),before);assertNoCreativeTransfer(trace.records);
  assert.ok(trace.records.length<=12,`actual statement count ${trace.records.length}`);
  assert.ok(trace.records.reduce((total,row)=>total+(row.returnedBytes??0),0)<=1024*1024);
  assert.equal(trace.records.filter(row=>/INSERT\s+INTO\s+experience_sponsor_intake_read_attempts/iu.test(row.sql)).length,1);
  assert.equal(trace.records.filter(row=>finalSql(row.sql)).length,1);
  strict.assertVerified();f.assertNoPaidWork();
  t.diagnostic(JSON.stringify({queries:trace.records.length,compiled:strict.records.length,
    maximumBindings:Math.max(...trace.records.map(row=>row.bindings.length)),maximumSqlBytes:Math.max(...trace.records.map(row=>row.sqlBytes)),outbound}));
});

test('the descriptor and subsequent actual bootstrap are separate charged HTTP attempts',async t=>{
  const f=await hostFixture(t),first=await readMode(f);
  assert.equal(first.body.mode,'sponsor-image');assert.equal(f.bootstrapAttempts().length,1);
  const {runtime,bootstrap}=await f.transport.bootstrap(undefined,{signal:new AbortController().signal});t.after(()=>runtime.dispose());
  assert.equal(bootstrap.mode,'fresh');assert.equal(f.bootstrapAttempts().length,2);
  const rows=f.bootstrapAttempts();assert.notEqual(rows[0].attempt_id,rows[1].attempt_id);
  for(const row of rows)assertFullBootstrapCharge(f,row);
  f.assertNoPaidWork();
});

test('the smaller descriptor uses unchanged explicitly approved V1 bootstrap terms',async t=>{
  const terms=confirmationTerms();terms.version=1;delete terms.operations['image-output-confirmation'];
  const f=await hostFixture(t,{terms}),{response,body}=await readMode(f);
  assertModeDescriptor(response,body,{mode:'sponsor-image',selector:freshSelector(),actorUserId:f.actor});
  assert.equal(attempts(f).length,1);assertFullBootstrapCharge(f,attempts(f)[0]);
  assert.equal(f.sqlite.prepare('SELECT policy_json FROM experience_sponsor_intake_read_policies WHERE campaign_id=?').get(f.campaignId).policy_json,canonicalJson(terms));
  f.assertNoPaidWork();
});

test('draft and intent aliases preserve the original resource and campaign when fresh selection is absent or different',{timeout:120_000},async t=>{
  const f=await hostFixture(t),{plan}=await commitFromEmpty(t,f),before=nativeState(f),previous=new Set(attempts(f).map(row=>row.attempt_id));
  const trace=observeHostDatabase(f),strict=enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100_000}});
  t.after(()=>{strict.restore();trace.restore();});
  for(const [selector,config] of [[draftSelector(plan.draftId),entryConfig(null)],
    [intentSelector(plan.request.intentId),entryConfig('different-unconfigured-campaign')]]){
    const {response,body}=await readMode(f,selector,config);
    assertModeDescriptor(response,body,{mode:'sponsor-image',selector,actorUserId:f.actor});
  }
  const added=attempts(f).filter(row=>!previous.has(row.attempt_id));assert.equal(added.length,2);
  for(const row of added)assertFullBootstrapCharge(f,row,{resourceKey:`draft:${plan.draftId}`});
  assert.notEqual(added[0].attempt_id,added[1].attempt_id);
  assertNoCreativeTransfer(trace.records,[plan.request.values.subject.value]);
  assert.ok(trace.records.length<=24);assert.ok(trace.records.reduce((total,row)=>total+(row.returnedBytes??0),0)<=2*1024*1024);
  strict.assertVerified();
  assert.deepEqual(nativeState(f),before);f.assertNoPaidWork();
});

test('actor project names and unrelated native Document bodies do not enter descriptor control reads',async t=>{
  const f=await hostFixture(t),{plan}=await commitFromEmpty(t,f),sentinels=await seedCreativeSentinels(f);
  const before=nativeState(f),trace=observeHostDatabase(f);t.after(()=>trace.restore());
  for(const selector of [freshSelector(),draftSelector(plan.draftId)]){
    const {response,body}=await readMode(f,selector);
    assertModeDescriptor(response,body,{mode:'sponsor-image',selector,actorUserId:f.actor});
  }
  assertNoCreativeTransfer(trace.records,[sentinels.documentText,sentinels.projectName,plan.request.values.subject.value]);
  assert.deepEqual(nativeState(f),before);
});

test('a saved sponsor never falls through to ordinary when configuration is absent or disabled',async t=>{
  const f=await hostFixture(t),{plan}=await commitFromEmpty(t,f),start=attempts(f).length;
  for(const config of [undefined,{version:2,enabled:false}])for(const selected of [draftSelector(plan.draftId),intentSelector(plan.request.intentId)])
    await assertModeUnavailable(await createSponsorImageEntryModeRoute(config)(f.modeRequest(selected),f.env));
  assert.equal(attempts(f).length,start);f.assertNoPaidWork();
});

for(const absent of [false,true])test(`ordinary retained selection stays ordinary with sponsor schema ${absent?'absent':'present'}`,async t=>{
  const f=await hostFixture(t);if(absent)f.sqlite.exec('DROP TABLE experience_sponsor_intakes');
  const selected=draftSelector('experience-draft-'+'b'.repeat(64)),trace=observeHostDatabase(f);t.after(()=>trace.restore());
  const {response,body}=await readMode(f,selected);
  assertModeDescriptor(response,body,{mode:'ordinary',selector:selected});
  assert.equal(attempts(f).length,0);assertNoCreativeTransfer(trace.records);f.assertNoPaidWork();
});

async function ordinaryPlan(f){
  const response=await f.nativeCall('drafts','POST',f.nativeRequest);
  assert.equal(response.status,200);const {plan}=await response.json();assert.equal(Object.hasOwn(plan,'sponsor_intake'),false);return plan;
}

for(const marker of [null,{version:99},{version:1,receiptId:'orphan'}])test(`orphan sponsor marker ${JSON.stringify(marker)} closes ordinary fallback`,async t=>{
  const f=await hostFixture(t),plan=await ordinaryPlan(f);
  f.sqlite.prepare('UPDATE private_content SET content=? WHERE content_id=?').run(canonicalJson({...plan,sponsor_intake:marker}),plan.draftId);
  const trace=observeHostDatabase(f);t.after(()=>trace.restore());
  await assertModeUnavailable(await createSponsorImageEntryModeRoute(f.config)(f.modeRequest(draftSelector(plan.draftId)),f.env));
  assert.equal(attempts(f).length,0);assertNoCreativeTransfer(trace.records,[plan.request.values.subject.value]);
});

test('invalid ordinary JSON alone is ordinary classification, without reading its body',async t=>{
  const f=await hostFixture(t),plan=await ordinaryPlan(f);
  f.sqlite.prepare('UPDATE private_content SET content=? WHERE content_id=?').run('{invalid-ordinary-json',plan.draftId);
  const trace=observeHostDatabase(f);t.after(()=>trace.restore());
  const selected=draftSelector(plan.draftId),{response,body}=await readMode(f,selected);
  assertModeDescriptor(response,body,{mode:'ordinary',selector:selected});
  assertNoCreativeTransfer(trace.records,['{invalid-ordinary-json']);assert.equal(attempts(f).length,0);
});

test('raw expired foreign-actor sidecar remains sponsor evidence after its private content disappears',async t=>{
  const f=await hostFixture(t),{plan}=await commitFromEmpty(t,f),start=attempts(f).length;
  f.sqlite.exec('DROP TRIGGER experience_sponsor_intake_no_update');
  f.sqlite.prepare("UPDATE experience_sponsor_intakes SET actor_user_id='different-actor',expires_at='2000-01-01T00:00:00.000Z' WHERE draft_id=?").run(plan.draftId);
  f.sqlite.prepare('DELETE FROM private_content WHERE content_id=?').run(plan.draftId);
  await assertModeUnavailable(await createSponsorImageEntryModeRoute(f.config)(f.modeRequest(draftSelector(plan.draftId)),f.env));
  assert.equal(attempts(f).length,start);f.assertNoPaidWork();
});

test('a substituted sidecar view cannot produce ordinary fallback',async t=>{
  const f=await hostFixture(t);
  f.sqlite.exec("DROP TABLE experience_sponsor_intakes; CREATE VIEW experience_sponsor_intakes AS SELECT 'other' AS draft_id");
  await assertModeUnavailable(await createSponsorImageEntryModeRoute(f.config)(f.modeRequest(draftSelector('experience-draft-'+'c'.repeat(64))),f.env));
  assert.equal(attempts(f).length,0);
});

test('oversized catalog SQL fails closed before the schema text crosses the database boundary',async t=>{
  const f=await hostFixture(t),oversized='catalog-fixture-'+('x'.repeat(33_000));
  f.sqlite.exec(`DROP TABLE experience_sponsor_intakes; CREATE TABLE experience_sponsor_intakes(draft_id TEXT /* ${oversized} */)`);
  const trace=observeHostDatabase(f);t.after(()=>trace.restore());
  await assertModeUnavailable(await createSponsorImageEntryModeRoute(f.config)(f.modeRequest(draftSelector('experience-draft-'+'d'.repeat(64))),f.env));
  assert.equal(attempts(f).length,0);assertNoCreativeTransfer(trace.records,[oversized]);
  assert.ok(trace.records.some(record=>record.sql.includes('sqlite_master')));
});

test('oversized canonical actor metadata is gated in SQL before transfer or allocation',async t=>{
  const f=await hostFixture(t),displayName='actor-fixture-'+('x'.repeat(132_000));
  f.sqlite.prepare('UPDATE users SET display_name=? WHERE user_id=?').run(displayName,f.actor);
  const trace=observeHostDatabase(f);t.after(()=>trace.restore());
  const request=f.modeRequest(undefined,{headers:{'oai-authenticated-user-full-name':encodeURIComponent(displayName),'oai-authenticated-user-full-name-encoding':'percent-encoded-utf-8'}});
  await assertModeUnavailable(await createSponsorImageEntryModeRoute(f.config)(request,f.env));
  assert.equal(attempts(f).length,0);assertNoCreativeTransfer(trace.records,[displayName]);
  assert.ok(trace.records.reduce((total,row)=>total+(row.returnedBytes??0),0)<=1024*1024);
});

for(const field of ['review_receipt_json','payer_authority_json'])test(`existing approval exception preserves its SQL byte ceiling for ${field}`,async t=>{
  const f=await hostFixture(t),{plan}=await commitFromEmpty(t,f),start=attempts(f).length;
  const oversized='approval-fixture-'+('x'.repeat(field==='review_receipt_json'?262_145:131_073));
  if(field==='review_receipt_json'){
    f.sqlite.exec('DROP TRIGGER experience_sponsor_intake_read_approvals_no_update');
    f.sqlite.prepare('UPDATE experience_sponsor_intake_read_approvals SET review_receipt_json=? WHERE campaign_id=?').run(oversized,f.campaignId);
  }else{
    f.sqlite.exec('DROP TRIGGER experience_sponsor_approval_immutable');
    f.sqlite.prepare('UPDATE experience_sponsor_approvals SET payer_authority_json=? WHERE campaign_id=?').run(oversized,f.campaignId);
  }
  const trace=observeHostDatabase(f);t.after(()=>trace.restore());
  await assertModeUnavailable(await createSponsorImageEntryModeRoute(f.config)(f.modeRequest(draftSelector(plan.draftId)),f.env));
  assert.equal(attempts(f).length,start);assertNoCreativeTransfer(trace.records,[oversized,plan.request.values.subject.value]);
  const approved=trace.records.find(record=>record.sql.includes('AS review_receipt_json')&&record.sql.includes('AS payer_authority_json'));
  assert.ok(approved,'the unchanged approved-policy reader must be exercised');
  assert.equal(approved.result.success,true);assert.equal(approved.result.results.length,1);
  const envelope=approved.result.results[0];assert.equal(envelope.mode_count,1);
  assert.equal(Buffer.byteLength(envelope.mode_body),envelope.mode_bytes);
  const rows=JSON.parse(envelope.mode_body);assert.equal(rows.length,1);
  assert.equal(rows[0][field],null,'the oversized exception field must never transfer through the actual SQL metadata envelope');
});

/** Genuine original sidecar, temporarily absent for a classification race. The
 * mutation restores its exact row; it is not a second issuance mechanism. */
async function classificationRaceFixture(t,{schemaAbsent=false}={}){
  const f=await hostFixture(t),{plan:marked}=await commitFromEmpty(t,f);
  const row=f.sqlite.prepare('SELECT * FROM experience_sponsor_intakes WHERE draft_id=?').get(marked.draftId);
  const {sponsor_intake:_marker,draftHash:_hash,...unmarked}=marked,plan={...unmarked,draftHash:await digest(unmarked)};
  f.sqlite.prepare('UPDATE private_content SET content=? WHERE content_id=?').run(canonicalJson(plan),plan.draftId);
  f.sqlite.exec('DROP TABLE experience_sponsor_intakes');
  const recreate=()=>{for(const sql of SPONSOR_INTAKE_SCHEMA.filter(sql=>!sql.startsWith('CREATE TABLE experience_sponsor_intake_assertions')))f.sqlite.exec(sql);};
  if(!schemaAbsent)recreate();
  f.restoreSidecar=()=>{
    if(schemaAbsent)recreate();
    const keys=Object.keys(row);
    f.sqlite.prepare(`INSERT INTO experience_sponsor_intakes(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...keys.map(key=>row[key]));
  };
  return {...f,plan};
}

for(const fault of ['marker','sidecar','schema'])test(`ordinary final scalar guard refuses a ${fault} appearing after classification`,async t=>{
  const f=await classificationRaceFixture(t,{schemaAbsent:fault==='schema'}),start=attempts(f).length;let fired=0;
  const trace=observeHostDatabase(f,{beforeExecute:record=>{
    if(!ordinarySql(record.sql))return;fired++;
    if(fault==='marker')f.sqlite.prepare('UPDATE private_content SET content=? WHERE content_id=?').run(canonicalJson({...f.plan,sponsor_intake:null}),f.plan.draftId);
    else f.restoreSidecar();
  }});t.after(()=>trace.restore());
  await assertModeUnavailable(await createSponsorImageEntryModeRoute(f.config)(f.modeRequest(draftSelector(f.plan.draftId)),f.env));
  assert.equal(fired,1);assert.equal(attempts(f).length,start);assertNoCreativeTransfer(trace.records,[f.plan.request.values.subject.value]);
});

for(const fault of ['email','display-name','consent','role'])test(`current principal ${fault} mismatch refuses a sponsor descriptor before allocation`,async t=>{
  const f=await hostFixture(t);
  const updates={email:"email='wrong@example.invalid'",'display-name':"display_name='Not the trusted identity'",consent:'consent_version=NULL',role:"role='viewer'"};
  f.sqlite.prepare(`UPDATE users SET ${updates[fault]} WHERE user_id=?`).run(f.actor);
  const trace=observeHostDatabase(f);t.after(()=>trace.restore());
  await assertModeUnavailable(await createSponsorImageEntryModeRoute(f.config)(f.modeRequest(),f.env));
  assert.equal(attempts(f).length,0);assertNoCreativeTransfer(trace.records);f.assertNoPaidWork();
});

test('another canonical actor cannot recover the original draft or alias resource',async t=>{
  const f=await hostFixture(t,{extraActorUserIds:['mode-other-actor']}),{plan}=await commitFromEmpty(t,f),start=attempts(f).length;
  await assertModeUnavailable(await createSponsorImageEntryModeRoute(f.config)(f.modeRequest(draftSelector(plan.draftId),{actorUserId:'mode-other-actor'}),f.env));
  assert.equal(attempts(f).length,start);f.assertNoPaidWork();
});

/** A competing governance binding uses actual persisted tables and a different
 * canonical owner. It does not change the original actor's access snapshot, so
 * owner-filtered personal-custody predicates would miss this exact regression. */
function governWithDifferentOwner(f,plan,kind){
  const other='mode-governance-other-actor',time=new Date().toISOString(),access=`mode-foreign-${kind}`;
  assert.notEqual(other,f.actor);
  f.sqlite.prepare("INSERT INTO organizations(organization_id,name,owner_user_id,status,created_at,updated_at) VALUES('mode-foreign-org','Synthetic competing workspace',?,'active',?,?)")
    .run(other,time,time);
  f.sqlite.prepare("INSERT INTO organization_projects(project_access_id,project_id,organization_id,owner_user_id,status,created_at,updated_at) VALUES(?,?,'mode-foreign-org',?,'active',?,?)")
    .run(access,kind==='project'?plan.projectId:'mode-foreign-unrelated-project',other,time,time);
  if(kind==='document')f.sqlite.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,actor_user_id,created_at) VALUES(?,'document',?,'mode-foreign-org','mode-foreign-unrelated-project',?,'collaborative_output',?,?)")
    .run(access,plan.documentId,other,other,time);
}

for(const kind of ['project','document'])for(const boundary of ['before-allocation','final-disclosure'])
  test(`foreign-owner ${kind} governance at ${boundary} refuses the original sponsor descriptor`,async t=>{
    const f=await hostFixture(t,{extraActorUserIds:['mode-governance-other-actor']}),{plan}=await commitFromEmpty(t,f);
    const previous=new Set(attempts(f).map(row=>row.attempt_id));let mutations=0;
    const mutate=()=>{governWithDifferentOwner(f,plan,kind);mutations++;};
    if(boundary==='before-allocation')mutate();
    const trace=observeHostDatabase(f,{beforeExecute:record=>{
      if(boundary==='final-disclosure'&&finalSql(record.sql)){
        assert.equal(attempts(f).filter(row=>!previous.has(row.attempt_id)).length,1);
        mutate();
      }
    }});t.after(()=>trace.restore());
    await assertModeUnavailable(await createSponsorImageEntryModeRoute(f.config)(f.modeRequest(draftSelector(plan.draftId)),f.env));
    assert.equal(mutations,1);
    const added=attempts(f).filter(row=>!previous.has(row.attempt_id));
    assert.equal(added.length,boundary==='before-allocation'?0:1);
    if(added.length)assertFullBootstrapCharge(f,added[0],{resourceKey:`draft:${plan.draftId}`});
    assertNoCreativeTransfer(trace.records,[plan.request.values.subject.value]);f.assertNoPaidWork();
  });

for(const cookie of ['forma_project_context=fixture-context','forma_impersonation=fixture-persona'])test(`${cookie.split('=')[0]} conservatively refuses sponsor metadata`,async t=>{
  const f=await hostFixture(t);
  await assertModeUnavailable(await createSponsorImageEntryModeRoute(f.config)(f.modeRequest(undefined,{headers:{cookie}}),f.env));
  assert.equal(attempts(f).length,0);f.assertNoPaidWork();
});

test('managed cohort configuration refuses this canonical-personal sponsor entry',async t=>{
  const f=await hostFixture(t);f.env.FORMA_PILOT_COHORT_ID='fixture-cohort';
  await assertModeUnavailable(await createSponsorImageEntryModeRoute(f.config)(f.modeRequest(),f.env));
  assert.equal(attempts(f).length,0);f.assertNoPaidWork();
});

for(const fault of ['erasure','principal','database'])test(`final ${fault} race withholds the descriptor and preserves its full charge`,async t=>{
  const f=await hostFixture(t),{plan}=await commitFromEmpty(t,f),previous=new Set(attempts(f).map(row=>row.attempt_id)),start=previous.size;let fired=0;
  const trace=observeHostDatabase(f,{beforeExecute:record=>{
    if(!finalSql(record.sql))return;fired++;assert.equal(attempts(f).length,start+1);
    if(fault==='erasure')f.sqlite.prepare("UPDATE private_content SET content='',redacted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE content_id=?").run(plan.draftId);
    if(fault==='principal')f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(f.actor);
    if(fault==='database')f.env.DB={...f.DB};
  }});t.after(()=>{f.env.DB=f.DB;trace.restore();});
  await assertModeUnavailable(await createSponsorImageEntryModeRoute(f.config)(f.modeRequest(draftSelector(plan.draftId)),f.env));
  assert.equal(fired,1);assert.equal(attempts(f).length,start+1);
  const added=attempts(f).filter(row=>!previous.has(row.attempt_id));assert.equal(added.length,1);
  assertFullBootstrapCharge(f,added[0],{resourceKey:`draft:${plan.draftId}`});
  assertNoCreativeTransfer(trace.records,[plan.request.values.subject.value]);f.assertNoPaidWork();
});

test('quota exhaustion cannot return ordinary, allocate a second receipt, or refund the first full reservation',async t=>{
  const f=await hostFixture(t,{terms:confirmationTerms({maximumRequestsPerWindow:1})});
  const first=await readMode(f);assert.equal(first.body.mode,'sponsor-image');
  const row=structuredClone(attempts(f)[0]);
  const denied=await createSponsorImageEntryModeRoute(f.config)(f.modeRequest(),f.env);
  assert.equal(denied.status,429);await assertModeUnavailable(denied);
  assert.deepEqual(structuredClone(attempts(f)),[row]);assertFullBootstrapCharge(f,row);f.assertNoPaidWork();
});

test('an allowance too small for the descriptor remains charged and discloses no partial descriptor',async t=>{
  const terms=confirmationTerms();terms.operations['image-intake-bootstrap'].maximumBytes=16;
  const f=await hostFixture(t,{terms});
  await assertModeUnavailable(await createSponsorImageEntryModeRoute(f.config)(f.modeRequest(),f.env));
  assert.equal(attempts(f).length,1);assertFullBootstrapCharge(f,attempts(f)[0]);f.assertNoPaidWork();
});

test('pre-aborted request performs no allocation',async t=>{
  const f=await hostFixture(t),controller=new AbortController();controller.abort();
  await assertModeUnavailable(await createSponsorImageEntryModeRoute(f.config)(f.modeRequest(undefined,{signal:controller.signal}),f.env));
  assert.equal(attempts(f).length,0);f.assertNoPaidWork();
});

test('abort after allocation keeps its receipt and suppresses late metadata',async t=>{
  const f=await hostFixture(t),controller=new AbortController();let fired=0;
  const trace=observeHostDatabase(f,{beforeExecute:record=>{
    if(finalSql(record.sql)){fired++;assert.equal(attempts(f).length,1);controller.abort();}
  }});t.after(()=>trace.restore());
  await assertModeUnavailable(await createSponsorImageEntryModeRoute(f.config)(f.modeRequest(undefined,{signal:controller.signal}),f.env));
  assert.equal(fired,1);assert.equal(attempts(f).length,1);assertFullBootstrapCharge(f,attempts(f)[0]);f.assertNoPaidWork();
});

test('a nonsettling database read returns at the five-second cutoff without waiting for cancellation',{timeout:9000},async t=>{
  const f=await hostFixture(t);let calls=0;
  const trace=observeHostDatabase(f,{beforeCall:()=>{calls++;return new Promise(()=>{});}});t.after(()=>trace.restore());
  const began=performance.now();
  await assertModeUnavailable(await createSponsorImageEntryModeRoute(f.config)(f.modeRequest(),f.env));
  const elapsed=performance.now()-began;
  assert.equal(calls,1);assert.ok(elapsed>=4500&&elapsed<7500,`cutoff elapsed ${elapsed}`);
  assert.equal(attempts(f).length,0);f.assertNoPaidWork();
});

test('aborting a nonsettling database call does not wait for that call to settle',{timeout:2000},async t=>{
  const f=await hostFixture(t),controller=new AbortController();let entered;
  const started=new Promise(resolve=>{entered=resolve;});
  const trace=observeHostDatabase(f,{beforeCall:()=>{entered();return new Promise(()=>{});}});t.after(()=>trace.restore());
  const pending=createSponsorImageEntryModeRoute(f.config)(f.modeRequest(undefined,{signal:controller.signal}),f.env);
  await started;controller.abort();await assertModeUnavailable(await pending);
  assert.equal(attempts(f).length,0);f.assertNoPaidWork();
});

// The internal metadata token is deliberately not exported. This public test
// proves only that a browser descriptor grants no private authority; an
// independent source review owns the genuine-token-before-take map boundary.
test('the public browser descriptor cannot be used as private-read authority',async t=>{
  const f=await hostFixture(t),request=f.modeRequest(),response=await createSponsorImageEntryModeRoute(f.config)(request,f.env),descriptor=await response.json();
  assert.equal(response.status,200);const before=attempts(f);
  await assert.rejects(()=>resolveSponsorIntakeRead(descriptor,Object.freeze({kind:'sponsor-image-intake-read-attempt'}),request,f.env));
  assert.deepEqual(attempts(f),before);f.assertNoPaidWork();
});

test('actual Worker dispatch marks resolver responses handled and schedules no detached retention work',async t=>{
  const f=await hostFixture(t);await useActualWorker(f);
  const response=await f.route(f.modeRequest()),body=await response.json();
  assertModeDescriptor(response,body,{mode:'sponsor-image',selector:freshSelector(),actorUserId:f.actor});
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  assert.equal(response.headers.get('referrer-policy'),'no-referrer');assert.match(response.headers.get('server-timing'),/^app;dur=/);
  assert.equal(attempts(f).length,1);assertFullBootstrapCharge(f,attempts(f)[0]);
  assert.equal(count(f,'retention_sweep_runs'),0);f.assertNoDetachedWork();f.assertNoPaidWork();
});

// ACK successor: planned, UNRUN against the held implementation. These faults
// replace only the acknowledgment returned AFTER an actual database operation.
// They do not replace SQL, bindings, native authorization, or a successful write.
function modeAckFault(f,{stage,mutate}){
  const prepare=f.DB.prepare.bind(f.DB),batch=f.DB.batch.bind(f.DB),wrapped=new WeakSet();
  const evidence={injections:0,underlying:[],getterCalls:0};
  const inject=(result,sql)=>{
    evidence.underlying.push({sql,result:structuredClone(result)});
    evidence.injections++;
    return mutate(result,evidence);
  };
  const wrap=statement=>{
    if(wrapped.has(statement))return statement;wrapped.add(statement);
    const bind=statement.bind.bind(statement),all=statement.all.bind(statement);
    statement.bind=(...values)=>wrap(bind(...values));
    statement.all=async(...args)=>{
      const actual=await all(...args);
      if(stage==='final'&&finalSql(statement.sql)||stage==='ordinary'&&ordinarySql(statement.sql))return inject(actual,statement.sql);
      return actual;
    };
    return statement;
  };
  f.DB.prepare=sql=>wrap(prepare(sql));
  f.DB.batch=async statements=>{
    const actual=await batch(statements);
    const allocation=statements.some(statement=>statement.sql.includes('INSERT INTO experience_sponsor_intake_read_attempts('));
    if(!allocation||!stage.startsWith('allocation-'))return actual;
    if(stage==='allocation-batch')return inject(actual,statements.map(statement=>statement.sql));
    const index=stage==='allocation-write'?0:1;
    const changed=[...actual];changed[index]=inject(actual[index],statements[index].sql);return changed;
  };
  return {evidence,restore(){f.DB.prepare=prepare;f.DB.batch=batch;}};
}

function corruptOwnField(object,key,kind,evidence,replacement){
  const value=object[key],copy={...object};delete copy[key];
  if(kind==='missing')return copy;
  if(kind==='inherited')return Object.assign(Object.create({[key]:value}),copy);
  if(kind==='accessor'){
    Object.defineProperty(copy,key,{enumerable:true,get(){evidence.getterCalls++;return value;}});return copy;
  }
  return {...copy,[key]:replacement};
}

function corruptArray(array,kind,evidence,index=0){
  const copy=[...array];delete copy[index];
  if(kind==='sparse')return copy;
  if(kind==='inherited'){
    const prototype=Object.create(Array.prototype);Object.defineProperty(prototype,String(index),{value:array[index],enumerable:true});
    Object.setPrototypeOf(copy,prototype);return copy;
  }
  Object.defineProperty(copy,String(index),{enumerable:true,get(){evidence.getterCalls++;return array[index];}});return copy;
}

async function requireAckRefusal(t,{stage,mutate}){
  const f=await hostFixture(t),before=nativeState(f),fault=modeAckFault(f,{stage,mutate});t.after(()=>fault.restore());
  const selected=stage==='ordinary'?draftSelector('experience-draft-'+'e'.repeat(64)):freshSelector();
  const response=await createSponsorImageEntryModeRoute(f.config)(f.modeRequest(selected),f.env);
  await assertModeUnavailable(response);
  assert.equal(fault.evidence.injections,1,'the actual requested DB acknowledgment must be reached');
  assert.equal(fault.evidence.getterCalls,0,'decoding must not invoke any adversarial getter');
  assert.deepEqual(nativeState(f),before,'ACK faults cannot write creative state');
  const charged=attempts(f);
  assert.equal(charged.length,stage==='ordinary'?0:1,'a completed allocation remains charged even when its ACK or final read is malformed');
  if(charged.length)assertFullBootstrapCharge(f,charged[0]);
  // Keep evidence from the genuine DB result, captured before corruption.
  const actual=fault.evidence.underlying[0].result;
  if(stage==='allocation-batch')assert.ok(actual.every(item=>item.success===true));
  else assert.equal(actual.success,true);
  f.assertNoPaidWork();return fault.evidence;
}

const successFaults=[
  ['false',false],['numeric true',1],['string true','true'],['missing',undefined],['inherited',undefined],['accessor',undefined],
];
for(const stage of ['final','allocation-read','allocation-write'])for(const [kind,value] of successFaults)
  test(`ACK ${stage} requires an own data success exactly true (${kind})`,async t=>{
    await requireAckRefusal(t,{stage,mutate:(actual,evidence)=>corruptOwnField(actual,'success',kind,evidence,value)});
  });

for(const stage of ['final','allocation-read'])for(const kind of ['missing','inherited','accessor'])
  test(`ACK ${stage} refuses ${kind} results without invoking a getter`,async t=>{
    await requireAckRefusal(t,{stage,mutate:(actual,evidence)=>corruptOwnField(actual,'results',kind,evidence)});
  });

for(const kind of ['sparse','inherited','accessor'])for(const stage of ['final','allocation-read','allocation-batch'])
  test(`ACK ${stage} refuses a ${kind} result-array slot`,async t=>{
    await requireAckRefusal(t,{stage,mutate:(actual,evidence)=>stage==='allocation-batch'
      ?corruptArray(actual,kind,evidence,1):{...actual,results:corruptArray(actual.results,kind,evidence)}});
  });

for(const column of ['mode_count','mode_bytes','mode_body'])for(const kind of ['missing','inherited','accessor'])
  test(`ACK final metadata requires own data ${column} (${kind})`,async t=>{
    await requireAckRefusal(t,{stage:'final',mutate:(actual,evidence)=>({...actual,
      results:[corruptOwnField(actual.results[0],column,kind,evidence)]})});
  });

const metadataFaults=[
  ['negative count',row=>({...row,mode_count:-1})],
  ['fractional count',row=>({...row,mode_count:0.5})],
  ['count mismatch',row=>({...row,mode_count:0})],
  ['two rows',()=>{
    const mode_body=JSON.stringify([{authorized:1},{authorized:1}]);
    return {mode_count:2,mode_bytes:Buffer.byteLength(mode_body),mode_body};
  }],
  ['negative bytes',row=>({...row,mode_bytes:-1})],
  ['string bytes',row=>({...row,mode_bytes:String(row.mode_bytes)})],
  ['byte mismatch',row=>({...row,mode_bytes:row.mode_bytes+1})],
  ['non-string body',row=>({...row,mode_body:[{authorized:1}]})],
  ['invalid JSON body',row=>({...row,mode_body:'[',mode_bytes:1})],
  ['extra metadata key',row=>({...row,extra:1})],
];
for(const [kind,mutate] of metadataFaults)test(`ACK final metadata refuses ${kind}`,async t=>{
  await requireAckRefusal(t,{stage:'final',mutate:actual=>({...actual,results:[mutate(actual.results[0])]})});
});

const authorizationRows=[
  ['zero',{authorized:0}],['null',{authorized:null}],['string one',{authorized:'1'}],
  ['object',{authorized:{}}],['missing',{}],['extra key',{authorized:1,extra:1}],
];
for(const stage of ['final','ordinary'])for(const [kind,row] of authorizationRows)
  test(`ACK ${stage} scalar requires exactly numeric authorized one (${kind})`,async t=>{
    await requireAckRefusal(t,{stage,mutate:actual=>{
      const mode_body=JSON.stringify([row]);
      return {...actual,results:[{mode_count:1,mode_bytes:Buffer.byteLength(mode_body),mode_body}]};
    }});
  });

// JavaScript accessors/prototypes cannot be represented in JSON. A malformed
// D1 result that places such a row directly in mode_body must fail at the body
// boundary without accessing `authorized`; the genuine parsed-row ownership
// check additionally remains part of independent candidate source review.
for(const kind of ['inherited','accessor'])test(`ACK final rejects a direct ${kind} authorized object without reading it`,async t=>{
  await requireAckRefusal(t,{stage:'final',mutate:(actual,evidence)=>({...actual,
    results:[{...actual.results[0],mode_body:[corruptOwnField({authorized:1},'authorized',kind,evidence)]}]})});
});

for(const key of ['meta','changes'])for(const kind of ['missing','inherited','accessor'])
  test(`ACK allocation INSERT requires own data ${key==='meta'?'meta':'meta.changes'} (${kind})`,async t=>{
    await requireAckRefusal(t,{stage:'allocation-write',mutate:(actual,evidence)=>key==='meta'
      ?corruptOwnField(actual,'meta',kind,evidence)
      :{...actual,meta:corruptOwnField(actual.meta,'changes',kind,evidence)}});
  });

for(const [label,value] of [['false',false],['null',null],['string one','1'],['two',2]])
  test(`ACK allocation INSERT refuses malformed meta.changes (${label})`,async t=>{
    await requireAckRefusal(t,{stage:'allocation-write',mutate:actual=>({...actual,meta:{...actual.meta,changes:value}})});
  });

test('actual quota denial preserves own numeric zero INSERT acknowledgment and returns 429 with Retry-After',async t=>{
  const f=await hostFixture(t,{terms:confirmationTerms({maximumRequestsPerWindow:1})});
  const first=await readMode(f);
  assertModeDescriptor(first.response,first.body,{mode:'sponsor-image',selector:freshSelector(),actorUserId:f.actor});
  const original=attempts(f);assert.equal(original.length,1);assertFullBootstrapCharge(f,original[0]);
  const before=nativeState(f);
  // Observe the real zero-change result without replacing it. An exact success
  // ACK with changes=0 is valid DB evidence of the unchanged quota refusal.
  const observed=modeAckFault(f,{stage:'allocation-write',mutate:actual=>actual});t.after(()=>observed.restore());
  const response=await createSponsorImageEntryModeRoute(f.config)(f.modeRequest(),f.env);
  assert.equal(response.status,429);
  assert.match(response.headers.get('retry-after')??'',/^[1-9]\d*$/u);
  assert.deepEqual(await response.json(),{error:'sponsor_intake_read_limit_reached'});
  assert.equal(observed.evidence.injections,1);assert.equal(observed.evidence.getterCalls,0);
  const actual=observed.evidence.underlying[0].result;
  assert.equal(actual.success,true);assert.equal(Object.hasOwn(actual,'meta'),true);
  assert.equal(Object.hasOwn(actual.meta,'changes'),true);assert.equal(actual.meta.changes,0);
  assert.deepEqual(attempts(f),original);assertFullBootstrapCharge(f,attempts(f)[0]);
  assert.deepEqual(nativeState(f),before);f.assertNoPaidWork();
});

import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {writeFileSync} from 'node:fs';
import {confirmationFixture,confirmationTerms,commitFromEmpty,count,attempts,nativeState,captureSql,base} from './sponsor-image-confirmation-fixture.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';

const [{confirmSponsorImageOutput,readSponsorImageConfirmation},{experienceResourceId},{experienceOutputBinding,experienceOutputCommandKey},{createSponsorImageEntryRoute}]=await Promise.all([
  import('../worker/experience-sponsor-image-confirmation.ts'),import('../src/experiences/intake.ts'),import('../worker/experience-output-binding.ts'),
  import('../worker/experience-sponsor-image-entry.ts'),
]);
const originalFetch=globalThis.fetch;let outbound=0;
globalThis.fetch=()=>{outbound++;throw Error('Confirmation qualification prohibits every provider/network request');};
after(()=>{globalThis.fetch=originalFetch;assert.equal(outbound,0);});
const entryConfig=campaignId=>({version:2,enabled:true,audience:'canonical-principal',output:'image',freshCampaignId:campaignId,generation:'disabled'});
const entryFor=f=>createSponsorImageEntryRoute(entryConfig(f.campaignId));
const confirmationPath=plan=>`${base}/drafts/${plan.draftId}/output-confirmation`;
const confirmationAttempts=f=>attempts(f).filter(row=>row.operation==='image-output-confirmation');

test('empty canonical state reaches actual native save and confirmation through reviewed intake then exact GET under strict D1 limits',{timeout:180_000},async t=>{
  const f=await confirmationFixture(t),trace=captureSql(f),strict=enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100_000}});
  t.after(()=>{
    if(process.env.FORMA_SPONSOR_CONFIRMATION_SQL_ARTIFACT)writeFileSync(process.env.FORMA_SPONSOR_CONFIRMATION_SQL_ARTIFACT,JSON.stringify({
      kind:'synthetic-real-intake-native-image-confirmation',outbound,records:trace.records,compileRecords:strict.records,failures:strict.failures},null,2));
    strict.restore();trace.restore();
  });
  const {plan}=await commitFromEmpty(t,f);trace.setStage('confirm');
  const response=await confirmSponsorImageOutput(f.confirmationRequest(plan),f.env,plan.draftId);
  assert.equal(response.status,200);const body=await response.json();assert.equal(body.status,'confirmed');assert.equal(body.replayed,false);
  assert.equal(body.generation,'unavailable');assert.equal(body.actorUserId,f.actor);assert.equal(body.campaignId,f.campaignId);
  const binding=await experienceOutputBinding(plan);assert.deepEqual(body.binding,binding);
  assert.equal(body.receipts.save.key,await experienceOutputCommandKey(binding,'save'));
  assert.equal(body.receipts.confirm.key,await experienceOutputCommandKey(binding,'confirm'));
  const requirement=await experienceResourceId(plan.draftId,'native-output-requirement');
  const saved=f.sqlite.prepare('SELECT type FROM events WHERE event_id=?').get(body.receipts.save.eventId);
  const confirmed=f.sqlite.prepare('SELECT type FROM events WHERE event_id=?').get(body.receipts.confirm.eventId);
  assert.equal(saved.type,'BlockCreated');assert.equal(confirmed.type,'OutputPlanConfirmed');
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='BlockCreated' AND json_extract(payload,'$.block_id')=?").get(requirement).n,1);
  assert.equal(count(f,'output_commands'),2);assert.equal(count(f,'output_plan_revisions'),1);assert.equal(count(f,'output_plan_targets'),1);
  const before=nativeState(f);trace.setStage('reopen');
  const reopened=await readSponsorImageConfirmation(f.readConfirmationRequest(plan),f.env,plan.draftId);
  assert.equal(reopened.status,200);const recovered=await reopened.json();assert.deepEqual(recovered,{...body,replayed:true});
  assert.deepEqual(nativeState(f),before);assert.equal(attempts(f).filter(row=>row.operation==='image-output-confirmation').length,2);
  strict.assertVerified();f.assertNoPaidWork();
  t.diagnostic(JSON.stringify({queries:trace.records.length,compiled:strict.records.length,maximumBindings:Math.max(...trace.records.map(row=>row.bindings.length)),
    maximumSqlBytes:Math.max(...trace.records.map(row=>row.sqlBytes)),outbound}));
});

test('entry is inert when absent or explicitly disabled and captures only the closed generation-disabled configuration',async()=>{
  const tripwire=new Proxy({}, {get(){throw Error('disabled entry accessed input');}});
  for(const config of [undefined,{version:2,enabled:false}])assert.equal(await createSponsorImageEntryRoute(config)(tripwire,tripwire),null);
  const valid=entryConfig('fixture-campaign');let accessed=0;
  const accessor={...valid};Object.defineProperty(accessor,'freshCampaignId',{enumerable:true,get(){accessed++;return 'fixture-campaign';}});
  for(const config of [null,{}, {...valid,version:1},{...valid,audience:'guest'},{...valid,output:'slides'},
    {...valid,generation:'enabled'},{...valid,generation:true},{...valid,payerUserId:'payer'},
    {...valid,freshCampaignId:''},{version:2,enabled:false,generation:'disabled'},accessor])
    assert.throws(()=>createSponsorImageEntryRoute(config),/sponsor_image_entry_configuration_invalid/);
  assert.equal(accessed,0);
});

test('entry refuses confirmation methods and query aliases before any admission and leaves ordinary paths alone',async()=>{
  const route=createSponsorImageEntryRoute(entryConfig('fixture-campaign'));
  const env=new Proxy({}, {get(){throw Error('invalid request touched DB');}}),path=`${base}/drafts/experience-draft-${'a'.repeat(64)}/output-confirmation`;
  for(const unrelated of ['/api/experiences/drafts','/api/output-requirements','/unrelated',base+'-other/bootstrap'])
    assert.equal(await route(new Request('http://localhost'+unrelated),env),null);
  for(const method of ['HEAD','PUT','DELETE','OPTIONS']){
    const response=await route(new Request('http://localhost'+path,{method}),env);
    assert.equal(response.status,405);assert.equal(response.headers.get('allow'),'GET, POST');
  }
  for(const method of ['GET','POST']){
    const response=await route(new Request('http://localhost'+path+'?campaignId=caller',{method}),env);
    assert.equal(response.status,400);assert.equal(response.headers.get('cache-control'),'private, no-store');
  }
});

test('fresh routed GET reports unconfirmed without native writes, then routed POST and GET preserve one exact confirmation',async t=>{
  const f=await confirmationFixture(t),route=entryFor(f);f.route=route;
  const {plan}=await commitFromEmpty(t,f),before=nativeState(f);
  const pending=await route(f.readConfirmationRequest(plan),f.env),pendingBody=await pending.json();
  assert.equal(pending.status,200);assert.equal(pendingBody.status,'unconfirmed');assert.equal(pendingBody.planRevisionId,undefined);
  assert.deepEqual(nativeState(f),before);
  const confirmed=await route(f.confirmationRequest(plan),f.env),body=await confirmed.json();
  assert.equal(confirmed.status,200,JSON.stringify(body));assert.equal(body.status,'confirmed');
  const saved=nativeState(f),read=await route(f.readConfirmationRequest(plan),f.env);assert.equal(read.status,200);
  assert.deepEqual(await read.json(),{...body,replayed:true});assert.deepEqual(nativeState(f),saved);
  assert.equal(confirmationAttempts(f).length,3);f.assertNoPaidWork();
});

test('fresh POST replay incurs a new read charge but returns the original save and confirm receipts without native writes',async t=>{
  const f=await confirmationFixture(t),{plan}=await commitFromEmpty(t,f);
  const first=await (await confirmSponsorImageOutput(f.confirmationRequest(plan),f.env,plan.draftId)).json(),before=nativeState(f);
  const repeated=await (await confirmSponsorImageOutput(f.confirmationRequest(plan),f.env,plan.draftId)).json();
  assert.deepEqual(repeated,{...first,replayed:true});assert.deepEqual(nativeState(f),before);
  assert.equal(confirmationAttempts(f).length,2);f.assertNoPaidWork();
});

test('a lost confirmation response is recovered by GET with no second native confirmation or read charge refund',async t=>{
  const f=await confirmationFixture(t),{plan}=await commitFromEmpty(t,f);let completed;
  await assert.rejects(async()=>{completed=await confirmSponsorImageOutput(f.confirmationRequest(plan),f.env,plan.draftId);throw Error('lost_confirmation_ack');},/lost_confirmation_ack/);
  const original=await completed.json(),before=nativeState(f),read=await readSponsorImageConfirmation(f.readConfirmationRequest(plan),f.env,plan.draftId);
  assert.deepEqual(await read.json(),{...original,replayed:true});assert.deepEqual(nativeState(f),before);
  assert.equal(confirmationAttempts(f).length,2);f.assertNoPaidWork();
});

test('confirmation rejects forged fields, changed draft hash and cross-origin commands before any read admission',async t=>{
  const f=await confirmationFixture(t),{plan}=await commitFromEmpty(t,f),route=entryFor(f),before=nativeState(f);
  const body={draftHash:plan.draftHash,explicitRequirementsConfirmation:true};
  for(const command of [{...body,payerUserId:f.payer},{...body,planRevisionId:'caller'},
    {...body,explicitRequirementsConfirmation:false},{...body,draftHash:`sha256:${'0'.repeat(64)}`},{draftHash:plan.draftHash}]){
    const response=await route(f.httpRequest('POST',confirmationPath(plan),command),f.env);
    assert.notEqual(response.status,200);assert.equal((await response.json()).planRevisionId,undefined);
  }
  for(const headers of [{origin:'https://other.invalid'},{'sec-fetch-site':'cross-site'}]){
    const response=await route(f.confirmationRequest(plan,{headers}),f.env);assert.notEqual(response.status,200);
  }
  assert.equal(confirmationAttempts(f).length,0);assert.deepEqual(nativeState(f),before);f.assertNoPaidWork();
});

test('another canonical actor and withdrawn native consent cannot confirm or disclose the original source',async t=>{
  const f=await confirmationFixture(t,{extraActorUserIds:['confirmation-other-actor']}),{plan}=await commitFromEmpty(t,f),route=entryFor(f),before=nativeState(f);
  for(const request of [f.confirmationRequest(plan,{actorUserId:'confirmation-other-actor'}),f.readConfirmationRequest(plan,{actorUserId:'confirmation-other-actor'})]){
    const response=await route(request,f.env);assert.notEqual(response.status,200);assert.equal((await response.json()).binding,undefined);
  }
  f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(f.actor);
  for(const request of [f.confirmationRequest(plan),f.readConfirmationRequest(plan)])assert.notEqual((await route(request,f.env)).status,200);
  assert.equal(confirmationAttempts(f).length,0);assert.deepEqual(nativeState(f),before);f.assertNoPaidWork();
});

test('a finite read-byte refusal retains its admitted charge and never writes a requirement or confirmation',async t=>{
  const terms=confirmationTerms();terms.operations['image-output-confirmation'].maximumBytes=128;
  const f=await confirmationFixture(t,{terms}),{plan}=await commitFromEmpty(t,f),route=entryFor(f),before=nativeState(f);
  const response=await route(f.confirmationRequest(plan),f.env),body=await response.json();
  assert.notEqual(response.status,200);assert.equal(body.binding,undefined);assert.equal(confirmationAttempts(f).length,1);
  assert.equal(confirmationAttempts(f)[0].maximum_bytes,128);assert.deepEqual(nativeState(f),before);f.assertNoPaidWork();
});

test('a refused confirm stage preserves its real saved requirement and retry reuses that exact save receipt',async t=>{
  const f=await confirmationFixture(t),{plan}=await commitFromEmpty(t,f);
  f.sqlite.exec("CREATE TRIGGER fixture_confirmation_fault BEFORE INSERT ON event_write_stage WHEN NEW.type='OutputPlanConfirmed' BEGIN SELECT RAISE(ABORT,'fixture_confirmation_fault'); END");
  await assert.rejects(()=>confirmSponsorImageOutput(f.confirmationRequest(plan),f.env,plan.draftId));
  assert.equal(count(f,'output_commands'),1);assert.equal(count(f,'output_plan_revisions'),0);
  const save=f.sqlite.prepare("SELECT * FROM output_commands WHERE action='save'").get();assert.ok(save);
  f.sqlite.exec('DROP TRIGGER fixture_confirmation_fault');
  const reopened=await readSponsorImageConfirmation(f.readConfirmationRequest(plan),f.env,plan.draftId);
  assert.equal((await reopened.json()).status,'unconfirmed');assert.equal(count(f,'output_commands'),1);
  const result=await (await confirmSponsorImageOutput(f.confirmationRequest(plan),f.env,plan.draftId)).json();
  assert.equal(result.status,'confirmed');assert.equal(result.receipts.save.eventId,save.event_id);
  assert.deepEqual(f.sqlite.prepare("SELECT * FROM output_commands WHERE action='save'").get(),save);
  assert.equal(count(f,'output_commands'),2);assert.equal(count(f,'output_plan_revisions'),1);assert.equal(confirmationAttempts(f).length,3);f.assertNoPaidWork();
});

test('a real native source edit refuses confirmation without rewriting the committed intake receipt',async t=>{
  const f=await confirmationFixture(t),{plan}=await commitFromEmpty(t,f);
  const {appendAuditEvent}=await import('../worker/runtime.ts');
  const source=plan.events.find(event=>event.type==='BlockCreated'&&event.payload.type==='subject');assert.ok(source);
  await appendAuditEvent(f.env,plan.streamId,'user','BlockPropertyEdited',{project_id:plan.projectId,document_id:plan.documentId,
    block_id:source.payload.block_id,property_path:'text',old_value:source.payload.properties.text,new_value:'A different orchard in winter'});
  const before=nativeState(f);
  await assert.rejects(()=>confirmSponsorImageOutput(f.confirmationRequest(plan),f.env,plan.draftId),/sponsor_confirmation_source_changed/);
  assert.deepEqual(nativeState(f),before);assert.equal(count(f,'output_commands'),0);assert.equal(confirmationAttempts(f).length,1);f.assertNoPaidWork();
});

function beforeQuery(f,predicate,hook){
  const prepare=f.DB.prepare.bind(f.DB);let fired=0;
  const wrap=statement=>{
    const bind=statement.bind.bind(statement);statement.bind=(...values)=>wrap(bind(...values));
    for(const method of ['first','all']){const actual=statement[method].bind(statement);statement[method]=async()=>{
      if(predicate(statement.sql)){fired++;await hook(statement);}return actual();
    };}return statement;
  };
  f.DB.prepare=sql=>wrap(prepare(sql));return {fired:()=>fired,restore(){f.DB.prepare=prepare;}};
}

for(const fault of ['expiry','erasure'])test(`native confirmation cannot disclose after draft ${fault} at the final guarded read`,async t=>{
  const f=await confirmationFixture(t),{plan}=await commitFromEmpty(t,f);let afterFault;
  const hook=beforeQuery(f,sql=>sql.includes('sponsor_image_confirmation_final')&&sql.includes('SELECT 1 AS current FROM'),()=>{
    assert.equal(confirmationAttempts(f).length,1);assert.equal(count(f,'output_commands'),2);
    if(fault==='expiry')f.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id=?").run(plan.draftId);
    else f.sqlite.prepare("UPDATE private_content SET content='',redacted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE content_id=? AND owner_id=?").run(plan.draftId,f.actor);
    afterFault=nativeState(f);
  });
  await assert.rejects(()=>confirmSponsorImageOutput(f.confirmationRequest(plan),f.env,plan.draftId),/sponsor_intake_read_custody_changed/);
  assert.equal(hook.fired(),1);assert.deepEqual(nativeState(f),afterFault);assert.equal(confirmationAttempts(f).length,1);f.assertNoPaidWork();hook.restore();
});

test('aborted request before confirmation and cancellation after admission cannot create native output stages',async t=>{
  const f=await confirmationFixture(t),{plan}=await commitFromEmpty(t,f),before=nativeState(f),stopped=new AbortController();stopped.abort();
  await assert.rejects(()=>confirmSponsorImageOutput(f.confirmationRequest(plan,{signal:stopped.signal}),f.env,plan.draftId));
  assert.equal(confirmationAttempts(f).length,0);
  const controller=new AbortController(),batch=f.DB.batch.bind(f.DB);let fired=0;
  f.DB.batch=async statements=>{const result=await batch(statements);
    if(statements.some(statement=>statement.sql.includes('INSERT INTO experience_sponsor_intake_read_attempts'))){fired++;controller.abort();}
    return result;
  };
  await assert.rejects(()=>confirmSponsorImageOutput(f.confirmationRequest(plan,{signal:controller.signal}),f.env,plan.draftId));
  assert.equal(fired,1);assert.equal(confirmationAttempts(f).length,1);assert.deepEqual(nativeState(f),before);f.assertNoPaidWork();
});

test('generation approval revocation refuses new native confirmation while retaining the charged read attempt',async t=>{
  const f=await confirmationFixture(t),{plan}=await commitFromEmpty(t,f),before=nativeState(f);
  f.sqlite.prepare('UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms WHERE campaign_id=?').run(f.campaignId);
  await assert.rejects(()=>confirmSponsorImageOutput(f.confirmationRequest(plan),f.env,plan.draftId));
  assert.equal(confirmationAttempts(f).length,1);assert.deepEqual(nativeState(f),before);assert.equal(count(f,'output_commands'),0);f.assertNoPaidWork();
});

test('exact completed native confirmation remains readable and replayable after generation approval revocation',async t=>{
  const f=await confirmationFixture(t),{plan}=await commitFromEmpty(t,f);
  const first=await (await confirmSponsorImageOutput(f.confirmationRequest(plan),f.env,plan.draftId)).json(),before=nativeState(f);
  f.sqlite.prepare('UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms WHERE campaign_id=?').run(f.campaignId);
  const read=await readSponsorImageConfirmation(f.readConfirmationRequest(plan),f.env,plan.draftId);
  const replay=await confirmSponsorImageOutput(f.confirmationRequest(plan),f.env,plan.draftId);
  assert.deepEqual(await read.json(),{...first,replayed:true});assert.deepEqual(await replay.json(),{...first,replayed:true});
  assert.deepEqual(nativeState(f),before);assert.equal(confirmationAttempts(f).length,3);f.assertNoPaidWork();
});

test('original intake erasure after its receipt read blocks every private row at the first native event-page boundary',async t=>{
  const f=await confirmationFixture(t),{plan,receipt}=await commitFromEmpty(t,f);
  const subject=receipt.appended.find(event=>event.type==='BlockCreated'&&event.payload.type==='subject');assert.ok(subject);
  const prepare=f.DB.prepare.bind(f.DB);let originalReceiptRead=0,erased=0,metadata,returnedRows=[];
  const wrapped=new WeakSet();
  const wrap=statement=>{
    if(wrapped.has(statement))return statement;wrapped.add(statement);
    const bind=statement.bind.bind(statement),all=statement.all.bind(statement);statement.bind=(...bindings)=>wrap(bind(...bindings));
    statement.all=async()=>{
      const page=statement.sql.includes('SELECT * FROM events LEFT JOIN event_private_payloads secret')
        &&statement.sql.includes('sponsor_confirmation_native_metadata');
      if(page&&!erased){
        assert.ok(originalReceiptRead>0,'The actual completed native intake receipt must have been read before withdrawal');
        assert.equal(confirmationAttempts(f).length,1);
        const original=f.sqlite.prepare('SELECT private_json,redacted_at FROM event_private_payloads WHERE private_event_id=? AND owner_id=?').get(subject.eventId,f.actor);
        assert.ok(original.private_json.length>0);assert.equal(original.redacted_at,null);
        assert.equal(f.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE private_event_id=? AND owner_id=? AND redacted_at IS NULL").run(subject.eventId,f.actor).changes,1);
        erased++;
      }
      const result=await all();
      if(statement.sql.includes('AS requested_key')&&statement.sql.includes('AS receipt_total')&&statement.sql.includes('sponsor_intake_receipt_gate'))originalReceiptRead++;
      if(page){
        metadata=structuredClone(result.results[0]);
        // Observe the actual D1 result at the transport edge. Neither its body
        // nor any row returned to the production adapter is replaced here.
        returnedRows=typeof metadata?.body==='string'?JSON.parse(metadata.body):[];
        if(process.env.FORMA_SPONSOR_CONFIRMATION_PRIVACY_ARTIFACT)writeFileSync(process.env.FORMA_SPONSOR_CONFIRMATION_PRIVACY_ARTIFACT,JSON.stringify({
          originalReceiptRead,erased,subjectEventId:subject.eventId,sql:statement.sql,bindings:statement.bindings,metadata,
          nonemptyPrivateRows:returnedRows.filter(row=>typeof row.private_json==='string'&&row.private_json.length>0).length},null,2));
      }
      return result;
    };return statement;
  };
  f.DB.prepare=sql=>wrap(prepare(sql));
  await assert.rejects(()=>confirmSponsorImageOutput(f.confirmationRequest(plan),f.env,plan.draftId));
  assert.equal(erased,1);assert.ok(metadata,'The actual bounded PAGE_READ result must be captured');
  assert.equal(count(f,'output_commands'),0);assert.equal(count(f,'output_plan_revisions'),0);f.assertNoPaidWork();
  assert.equal(returnedRows.filter(row=>typeof row.private_json==='string'&&row.private_json.length>0).length,0,
    'No private event body may cross into Worker memory after the original intake custody proof is invalid');
});

test('original client receipt mapping drift blocks every private row at the first native event-page boundary',async t=>{
  const f=await confirmationFixture(t),{plan,receipt}=await commitFromEmpty(t,f);
  const subject=receipt.appended.find(event=>event.type==='BlockCreated'&&event.payload.type==='subject');assert.ok(subject);
  const other=receipt.appended.find(event=>event.type==='BlockCreated'&&event.eventId!==subject.eventId);assert.ok(other);
  const privateBefore=f.sqlite.prepare('SELECT * FROM event_private_payloads ORDER BY private_event_id').all();
  const prepare=f.DB.prepare.bind(f.DB);let originalReceiptRead=0,changed=0,metadata,returnedRows=[];
  const wrapped=new WeakSet();
  const wrap=statement=>{
    if(wrapped.has(statement))return statement;wrapped.add(statement);
    const bind=statement.bind.bind(statement),all=statement.all.bind(statement);statement.bind=(...bindings)=>wrap(bind(...bindings));
    statement.all=async()=>{
      const page=statement.sql.includes('SELECT * FROM events LEFT JOIN event_private_payloads secret')
        &&statement.sql.includes('sponsor_confirmation_native_metadata');
      if(page&&!changed){
        assert.ok(originalReceiptRead>0);assert.equal(confirmationAttempts(f).length,1);
        // Both destination values belong to an actual native intake event.
        // Ordinary DML changes the mapping; no trigger or constraint is disabled.
        assert.equal(f.sqlite.prepare('UPDATE event_client_receipts SET event_id=?,sequence=? WHERE stream_id=? AND client_event_id=? AND event_id=?')
          .run(other.eventId,other.sequence,plan.streamId,subject.payload.client_event_id,subject.eventId).changes,1);
        changed++;
      }
      const result=await all();
      if(statement.sql.includes('AS requested_key')&&statement.sql.includes('AS receipt_total')&&statement.sql.includes('sponsor_intake_receipt_gate'))originalReceiptRead++;
      if(page){metadata=structuredClone(result.results[0]);returnedRows=typeof metadata?.body==='string'?JSON.parse(metadata.body):[];}
      return result;
    };return statement;
  };
  f.DB.prepare=sql=>wrap(prepare(sql));
  await assert.rejects(()=>confirmSponsorImageOutput(f.confirmationRequest(plan),f.env,plan.draftId));
  assert.equal(changed,1);assert.ok(metadata);assert.equal(metadata.authorized,0);
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM event_private_payloads ORDER BY private_event_id').all(),privateBefore);
  assert.equal(count(f,'output_commands'),0);assert.equal(count(f,'output_plan_revisions'),0);f.assertNoPaidWork();
  assert.equal(returnedRows.filter(row=>typeof row.private_json==='string'&&row.private_json.length>0).length,0,
    'Intact private bodies must not cross the boundary when their original native client-receipt mapping changes');
});

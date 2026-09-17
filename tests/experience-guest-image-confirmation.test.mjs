import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {fixture, origin, payer, rows, snapshot, changes, nativeEvents, unchangedExcept, digest,
  outputDigest, foldEvents, outputRequirements, authoritativeCreativeContext, experienceOutputBinding,
  experienceOutputCommandKey, publicEventPayload, batchHook, readHook, redactSource, addLease,
  makeEvent, insertEventAtHead, contextBytes} from './helpers/guest-image-stage-fixture.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';
const [{prepareGuestImageConfirmation,confirmGuestImageRequirement},{compileOutputPlan},{outputSourceDigests},{outputTargetContractDigest}]=await Promise.all([
  import('../worker/experience-guest-image-confirmation.ts'),import('../src/model/output-plan.ts'),
  import('../worker/output-trusted-context.ts'),import('../worker/output-requirements-api.ts')]);
const allowed=['events','event_private_payloads','output_commands','output_plan_revisions','output_plan_targets',
  'experience_sponsor_resource_receipts','experience_sponsor_driver_intents'];
const prepare=(f,input=f.input,req=f.request,env=f.env)=>prepareGuestImageConfirmation(req,env,input);
const confirm=(f,review,overrides={},req=f.request,env=f.env)=>confirmGuestImageRequirement(req,env,
  {...f.input,reviewedRequirementDigest:review.reviewedRequirementDigest,explicitRequirementsConfirmation:true,...overrides});
const confirms=statements=>statements.some(statement=>/^INSERT INTO output_plan_revisions\(/u.test(statement.sql));
const confirmationEvent=f=>nativeEvents(f).find(event=>event.type==='OutputPlanConfirmed');
const originalRows=(f,before,table,key)=>assert.deepEqual(rows(f,table).filter(row=>new Set(before.contents[table].map(value=>value[key])).has(row[key])),before.contents[table],`original ${table}`);
async function assertConfirmed(f,result,review,{replayed=false}={}){
  assert.equal(result.status,'confirmed');assert.equal(result.documentId,f.session.documentId);
  assert.equal(result.reviewedRequirementDigest,review.reviewedRequirementDigest);assert.equal(result.replayed,replayed);
  assert.ok(Object.isFrozen(result));assert.equal(result.planRevisionId,rows(f,'output_plan_revisions')[0].plan_revision_id);
  assert.deepEqual(result.plan,review.plan);
  for(const key of ['admissionCommitted','generationAvailable','custodyTransferred'])assert.equal(result[key],false,key);
  for(const value of [f.session.sessionToken,f.session.claimToken,'private_json','SELECT','payerUserId'])assert.equal(JSON.stringify(result).includes(value),false,'safe confirmation disclosure');
}

for(const memory of [false,true])test(`exact confirmation and replay qualify native D1 limits with ${memory?'complete':'absent'} Memory`,async t=>{
  const f=await fixture(t,{memory}),before=snapshot(f),limits=enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}});
  try{const review=await prepare(f),first=await confirm(f,review);await assertConfirmed(f,first,review);
    const after=snapshot(f),count=changes(f);await assertConfirmed(f,await confirm(f,review),review,{replayed:true});
    assert.deepEqual(snapshot(f),after);assert.equal(changes(f),count);limits.assertVerified();
    t.diagnostic(JSON.stringify({memory,qualifiedQueries:limits.records.length,maxBindings:Math.max(...limits.boundCounts),maxSqlBytes:Math.max(...limits.records.map(row=>row.statementBytes))}));
  }finally{limits.restore();}unchangedExcept(f,before,allowed);
});

test('review is read-only and derives its complete one-image plan from the retained native SAVE',async t=>{
  const f=await fixture(t),before=snapshot(f),count=changes(f),events=nativeEvents(f),projection=foldEvents(events),requirements=outputRequirements(projection);
  const context=authoritativeCreativeContext(events,{projectId:f.session.projectId,documentId:f.session.documentId});
  const expected=await outputSourceDigests(projection,requirements,f.session.documentId,f.session.projectId,context),review=await prepare(f);
  assert.deepEqual(snapshot(f),before);assert.equal(changes(f),count);assert.ok(Object.isFrozen(review));
  assert.match(review.reviewedRequirementDigest,/^sha256:[a-f0-9]{64}$/u);assert.equal(review.sourceDigest,expected.sourceDigest);assert.equal(review.requirementsDigest,expected.requirementsDigest);
  assert.deepEqual(review.requirement,requirements[0]);
  assert.deepEqual(review.plan,compileOutputPlan(requirements.map(row=>row.spec),{count_policies:{},suggested_counts:{},document_id:f.session.documentId,
    source_revision:expected.sourceDigest,requirement_revision:expected.requirementsDigest,max_targets:1000}));
  assert.equal(review.plan.targets.length,1);const [target]=review.plan.targets;
  assert.equal(target.media_kind,'image');assert.equal(target.required,true);assert.equal(target.selected,true);assert.equal(target.ordinal,1);
  assert.deepEqual(target.source_scope,{kind:'document'});assert.deepEqual(target.aspect_ratio,{width:1,height:1});assert.deepEqual(target.blocking_issues,[]);
  assert.equal(JSON.stringify(review).includes(f.session.sessionToken),false);assert.equal(JSON.stringify(review).includes(f.session.claimToken),false);
  assert.deepEqual(await prepare(f),review,'reopening exact review does not choose a new plan identity');
});

test('deliberate confirmation writes exactly one native N+2 plan and a distinct finite source receipt without changing the SAVE',async t=>{
  const f=await fixture(t),before=snapshot(f),original=nativeEvents(f),review=await prepare(f),result=await confirm(f,review);await assertConfirmed(f,result,review);
  unchangedExcept(f,before,allowed);for(const [table,key]of [['events','event_id'],['event_private_payloads','private_event_id'],['output_commands','command_key'],['experience_sponsor_resource_receipts','resource_id']])originalRows(f,before,table,key);
  const events=nativeEvents(f),event=confirmationEvent(f),body=event.payload;
  assert.deepEqual(events.slice(0,-1),original);assert.equal(events.length,f.committed.head+2);assert.equal(event.sequence,f.committed.head+2);
  assert.equal(event.actor,f.session.guestSubject);assert.equal(event.clientId,'server:guest-output');assert.equal(event.causationId,null);assert.equal(event.compensatesEventId,null);
  const key=await experienceOutputCommandKey(await experienceOutputBinding(f.prepared.plan),'confirm');assert.equal(event.correlationId,key);
  assert.equal(body.actor_user_id,f.session.guestSubject);assert.equal(body.document_id,f.session.documentId);assert.equal(body.project_id,f.session.projectId);
  const confirmed=body.confirmed_plan;assert.equal(body.plan_revision_id,result.planRevisionId);assert.equal(confirmed.id,f.session.documentId);assert.equal(confirmed.revisionId,result.planRevisionId);
  assert.equal(confirmed.revision,1);assert.equal(confirmed.confirmedAt,event.recordedAt);assert.equal(confirmed.sourceDigest,review.sourceDigest);assert.equal(confirmed.requirementsDigest,review.requirementsDigest);
  assert.deepEqual(confirmed.plan,review.plan);assert.deepEqual(confirmed.confirmationOptions,{count_policies:{},suggested_counts:{}});
  const [target]=review.plan.targets;assert.deepEqual(confirmed.targetContractDigests,{[target.id]:await outputTargetContractDigest(target,review.sourceDigest)});
  const [planRow]=rows(f,'output_plan_revisions'),[targetRow]=rows(f,'output_plan_targets');
  assert.deepEqual({...planRow},{scope_key:`personal:${f.session.guestSubject}:${f.session.projectId}`,scope_kind:'personal',owner_user_id:f.session.guestSubject,
    project_id:f.session.projectId,document_id:f.session.documentId,organization_id:null,project_access_id:null,plan_revision_id:confirmed.revisionId,plan_id:confirmed.id,
    revision:1,confirmed_event_id:event.eventId,requirements_digest:review.requirementsDigest,source_digest:review.sourceDigest,resolver_version:'output-plan-v1',source_head:f.committed.head+1,target_count:1,created_at:event.recordedAt});
  assert.deepEqual({...targetRow},{scope_key:planRow.scope_key,plan_revision_id:planRow.plan_revision_id,target_id:target.id,target_contract_digest:confirmed.targetContractDigests[target.id],media_kind:'image',required:1,selected:1,ordinal:0});
  assert.equal(rows(f,'output_commands').length,2);const command=rows(f,'output_commands').find(row=>row.action==='confirm');
  assert.equal(command.command_key,key);assert.equal(command.event_id,event.eventId);assert.equal(command.actor_user_id,f.session.guestSubject);assert.equal(command.request_digest,await outputDigest(body.output_command_envelope));
  assert.equal(body.output_command_envelope.explicitRequirementsConfirmation,true);assert.equal(body.output_command_envelope.reviewedRequirementDigest,review.reviewedRequirementDigest);
  assert.equal(body.output_command_envelope.expectedRevision,`output:${f.committed.head+1}`);assert.equal(Object.hasOwn(body.output_command_envelope,'explicitAuthorization'),false);
  const privateRow=rows(f,'event_private_payloads').find(row=>row.private_event_id===event.eventId),publicRow=rows(f,'events').find(row=>row.event_id===event.eventId);
  assert.equal(privateRow.owner_id,f.session.guestSubject);assert.equal(privateRow.private_json,JSON.stringify(body));assert.deepEqual(JSON.parse(publicRow.payload),publicEventPayload(event.eventId,body,true).payload);
  assert.equal(JSON.stringify(publicRow).includes('reviewedRequirementDigest'),false);assert.equal(JSON.stringify(body).includes(f.session.sessionToken),false);assert.equal(JSON.stringify(body).includes(f.session.claimToken),false);
  const [intent]=rows(f,'experience_sponsor_driver_intents');assert.ok(intent);assert.equal(intent.actor_user_id,f.session.guestSubject);assert.equal(intent.document_id,f.session.documentId);
  assert.equal(intent.source_digest,review.sourceDigest);assert.equal(intent.requirements_digest,review.requirementsDigest);assert.equal(intent.source_text_bytes,contextBytes(f));
  assert.equal(intent.command_digest,await digest(JSON.parse(intent.command_json)));assert.equal(JSON.parse(intent.command_json).action,'run-guest-sponsored-image');
  const receipt=rows(f,'experience_sponsor_resource_receipts').find(row=>row.resource_id===`${intent.driver_id}:text`);
  assert.ok(receipt);assert.equal(rows(f,'experience_sponsor_resource_receipts').length,2);assert.equal(receipt.operation,'text-intake');assert.equal(receipt.actor_user_id,f.session.guestSubject);
  assert.equal(receipt.intent_key,intent.intent_key);assert.equal(receipt.text_bytes,intent.source_text_bytes);assert.equal(receipt.payload_digest,await digest({command:JSON.parse(intent.command_json),sourceDigest:review.sourceDigest,requirementsDigest:review.requirementsDigest}));
  assert.equal(receipt.issued_grant_id,null);assert.equal(rows(f,'experience_sponsor_driver_stages').length,0);assert.equal(rows(f,'output_preflights').length,0);
  assert.equal(rows(f,'users').length,1);assert.equal(rows(f,'users')[0].user_id,payer);assert.equal(rows(f,'output_atomic_assertions').length,0);assert.equal(rows(f,'event_write_stage').length,0);
  await assert.rejects(f.read(),'first SAVE witness remains strict at N+1');await assert.rejects(f.save(),'first SAVE writer does not accept a general tail');
});

test('an explicit action is mandatory even when the review digest is genuine',async t=>{
  const f=await fixture(t),review=await prepare(f),before=snapshot(f);
  for(const value of [undefined,false,1,'true',null])await assert.rejects(confirm(f,review,{explicitRequirementsConfirmation:value}));
  assert.deepEqual(snapshot(f),before);
});

test('closed inputs reject caller-controlled plans, options, authority, source and payment fields',async t=>{
  const f=await fixture(t),review=await prepare(f),before=snapshot(f);
  for(const extra of [{options:{}},{plan:review.plan},{targetId:review.plan.targets[0].id},{actorUserId:payer},{ownerUserId:payer},{sourceSnapshot:{}},
    {expectedRevision:f.committed.head+1},{explicitAuthorization:true},{maximumMicrousd:1},{policy:f.compiled.policy},{reviewedRequirementDigest:`sha256:${'0'.repeat(64)}`},
    {proof:{...f.proof,claimToken:f.proof.sessionToken}}])await assert.rejects(confirm(f,review,extra));
  assert.deepEqual(snapshot(f),before);
  for(const extra of [{spec:{}},{reviewedRequirementDigest:review.reviewedRequirementDigest},{actorUserId:payer},{options:{}}])await assert.rejects(prepare(f,{...f.input,...extra}));
  assert.deepEqual(snapshot(f),before);
});

test('review from a different genuine source cannot authorize this source',async t=>{
  const a=await fixture(t),b=await fixture(t,{subjectText:'A copper kettle on a windowsill'}),review=await prepare(a),before=snapshot(b);
  await assert.rejects(confirm(b,review));assert.deepEqual(snapshot(b),before);
});

test('neither review nor confirmation creates the first SAVE implicitly',async t=>{
  const f=await fixture(t,{saved:false}),before=snapshot(f);await assert.rejects(prepare(f));
  await assert.rejects(confirm(f,{reviewedRequirementDigest:`sha256:${'0'.repeat(64)}`}));assert.deepEqual(snapshot(f),before);
});

for(const kind of ['session','session-policy','source-policy','campaign','resource-policy','approval','payer-consent','payer-revision','private-source','active-lease','expired-lease'])test(`current ${kind} remains required after explicit review`,async t=>{
  const f=await fixture(t),review=await prepare(f);
  const sql={session:'UPDATE experience_guest_sessions SET revoked_at_ms=1','session-policy':'UPDATE experience_guest_policies SET revoked_at_ms=1',
    'source-policy':'UPDATE experience_guest_source_policies SET revoked_at_ms=1',campaign:'UPDATE experience_sponsor_campaigns SET enabled=0',
    'resource-policy':'UPDATE experience_sponsor_resource_policies SET enabled=0',approval:'UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms+1',
    'payer-consent':'UPDATE users SET consent_version=NULL','payer-revision':"UPDATE users SET updated_at='2021-01-01T00:00:00.000Z'"}[kind];
  if(sql)f.sqlite.exec(sql);else if(kind==='private-source')redactSource(f);else addLease(f,kind==='expired-lease');
  const before=snapshot(f);await assert.rejects(confirm(f,review));await assert.rejects(prepare(f));assert.deepEqual(snapshot(f),before);
});

test('a distinct confirmed-source preparation debit obeys the approved finite operation cap',async t=>{
  const f=await fixture(t,{policyChange:policy=>{for(const scope of ['campaign','actor']){policy.resources[scope].maximumOperations=1;policy.resources[scope].maximumOperationsPerWindow=1;}}});
  const review=await prepare(f),before=snapshot(f);await assert.rejects(confirm(f,review));assert.deepEqual(snapshot(f),before);
  assert.equal(rows(f,'experience_sponsor_resource_receipts').length,1);assert.equal(rows(f,'output_plan_revisions').length,0);
});

for(const kind of ['lost','truncated','false','sparse'])test(`${kind} confirmation ACK returns only the original complete native plan without a second debit`,async t=>{
  const f=await fixture(t),review=await prepare(f),done=batchHook(f,confirms,result=>{
    if(kind==='lost')throw Error('lost confirmation acknowledgement');if(kind==='truncated')return result.slice(0,-1);
    if(kind==='sparse'){const copy=[...result];delete copy[Math.floor(copy.length/2)];return copy;}
    return result.map((row,index)=>index?row:{...row,success:false});
  });
  const result=await confirm(f,review);done();await assertConfirmed(f,result,review,{replayed:true});
  assert.equal(rows(f,'output_plan_revisions').length,1);assert.equal(rows(f,'output_commands').length,2);assert.equal(rows(f,'experience_sponsor_resource_receipts').length,2);
});

test('concurrent exact confirmations converge on one original plan, intent and resource receipt',{timeout:5000},async t=>{
  const f=await fixture(t),review=await prepare(f),batch=f.DB.batch;let release,arrivals=0;const barrier=new Promise(resolve=>{release=resolve;});
  f.DB.batch=async statements=>{if(confirms(statements)){arrivals++;if(arrivals===2)release();await barrier;}return batch.call(f.DB,statements);};
  const results=await Promise.all([confirm(f,review),confirm(f,review)]);f.DB.batch=batch;assert.equal(arrivals,2);
  assert.equal(results[0].planRevisionId,results[1].planRevisionId);assert.equal(results.filter(result=>!result.replayed).length,1);
  assert.equal(rows(f,'output_plan_revisions').length,1);assert.equal(rows(f,'experience_sponsor_driver_intents').length,1);assert.equal(rows(f,'experience_sponsor_resource_receipts').length,2);
});

for(const stage of ['resource','event','plan','target','intent','command','after-proof'])test(`late ${stage} failure rolls back the complete confirmation transaction`,async t=>{
  const f=await fixture(t),review=await prepare(f),before=snapshot(f),nativePrepare=f.DB.prepare;let hit=false,commandWritten=false;
  f.DB.prepare=function(sql){const statement=nativePrepare.call(this,sql),bind=statement.bind;statement.bind=function(...bindings){const bound=bind.call(this,...bindings),execute=bound.execute;
    bound.execute=function(kind){if(sql.startsWith('INSERT INTO output_commands'))commandWritten=true;
      const selected=stage==='resource'?sql.includes('INSERT INTO experience_sponsor_resource_receipts'):stage==='event'?sql.startsWith('INSERT INTO event_write_stage'):
        stage==='plan'?sql.startsWith('INSERT INTO output_plan_revisions'):stage==='target'?sql.startsWith('INSERT INTO output_plan_targets'):
          stage==='intent'?sql.startsWith('INSERT INTO experience_sponsor_driver_intents'):stage==='command'?sql.startsWith('INSERT INTO output_commands'):
            commandWritten&&sql.startsWith('INSERT INTO output_atomic_assertions');
      if(!hit&&selected){hit=true;throw Error('injected confirmation transaction failure');}return execute.call(this,kind);};return bound;};return statement;};
  await assert.rejects(confirm(f,review));f.DB.prepare=nativePrepare;assert.equal(hit,true,'targeted real statement executed');assert.deepEqual(snapshot(f),before);
});

for(const change of ['abort','headers','database','source-policy'])test(`a ${change} change during an authority await prevents confirmation`,async t=>{
  const f=await fixture(t),controller=new AbortController(),req=new Request(`${origin}/unregistered-guest-confirm`,{method:'POST',headers:{origin},signal:controller.signal}),review=await prepare(f),oldDb=f.env.DB;
  const done=readHook(f,sql=>sql.includes('experience_sponsor_campaigns'),()=>{
    if(change==='abort')controller.abort();else if(change==='headers')req.headers.set('x-changed','1');else if(change==='database')f.env.DB={...f.DB};else f.sqlite.exec('UPDATE experience_guest_source_policies SET revoked_at_ms=1');
  });
  const before=snapshot(f);await assert.rejects(confirm(f,review,{},req));done();f.env.DB=oldDb;
  const after=snapshot(f);if(change==='source-policy')before.contents.experience_guest_source_policies=after.contents.experience_guest_source_policies;
  assert.deepEqual(after,before);
});

for(const kind of ['missing-target','changed-target','changed-plan-head','changed-command','private-owner','private-redaction','unexpected-stage','extra-tail'])test(`a confirmed ${kind} is rejected on exact replay without repair`,async t=>{
  const f=await fixture(t),review=await prepare(f),result=await confirm(f,review),event=confirmationEvent(f);
  if(kind==='missing-target')f.sqlite.exec('DELETE FROM output_plan_targets');
  else if(kind==='changed-target')f.sqlite.exec('UPDATE output_plan_targets SET ordinal=1');
  else if(kind==='changed-plan-head')f.sqlite.exec('UPDATE output_plan_revisions SET source_head=source_head+1');
  else if(kind==='changed-command')f.sqlite.prepare("UPDATE output_commands SET request_digest=? WHERE action='confirm'").run('0'.repeat(64));
  else if(kind==='private-owner')f.sqlite.prepare('UPDATE event_private_payloads SET owner_id=? WHERE private_event_id=?').run(payer,event.eventId);
  else if(kind==='private-redaction')f.sqlite.prepare("UPDATE event_private_payloads SET private_json='{}',redacted_at=? WHERE private_event_id=?").run('2026-01-01T00:00:00.000Z',event.eventId);
  else if(kind==='unexpected-stage')f.sqlite.prepare('INSERT INTO experience_sponsor_driver_stages(driver_id,stage,command_json,command_digest) VALUES(?,?,?,?)').run(rows(f,'experience_sponsor_driver_intents')[0].driver_id,'authorize','{}','0'.repeat(64));
  else{const extra=makeEvent(`creative:${f.session.guestSubject}`,f.committed.head+3,f.session.guestSubject,'synthetic-native-client','unexpected-tail','BlockCreated',
    {project_id:f.session.projectId,document_id:f.session.documentId,block_id:crypto.randomUUID(),type:'subject',scope:'document',properties:{text:'Foreign tail',authority:'authored'}});await insertEventAtHead(f.env,extra,f.committed.head+2).run();}
  const before=snapshot(f);await assert.rejects(confirm(f,review));assert.deepEqual(snapshot(f),before);assert.equal(result.planRevisionId,rows(f,'output_plan_revisions')[0].plan_revision_id);
});

test('the driver intent is immutable and contains no bearer, spending authority or source text',async t=>{
  const f=await fixture(t),review=await prepare(f);await confirm(f,review);const [intent]=rows(f,'experience_sponsor_driver_intents'),before=snapshot(f);
  assert.throws(()=>f.sqlite.exec('DELETE FROM experience_sponsor_driver_intents'));assert.throws(()=>f.sqlite.exec("UPDATE experience_sponsor_driver_intents SET source_digest='changed'"));
  assert.deepEqual(snapshot(f),before);for(const secret of [f.subject,f.session.sessionToken,f.session.claimToken,'explicitAuthorization','maximumMicrousd'])assert.equal(JSON.stringify(intent).includes(secret),false);
});

test('partial Memory schemas fail before source disclosure or confirmation mutation',async t=>{
  const f=await fixture(t),review=await prepare(f);f.sqlite.exec('CREATE TABLE memory_native_answer_origins(id TEXT PRIMARY KEY)');const before=snapshot(f);
  await assert.rejects(prepare(f));await assert.rejects(confirm(f,review));assert.deepEqual(snapshot(f),before);
});

function sourceDeclaration(source, name) {
  const file = ts.createSourceFile('witness.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const matches = file.statements.filter(node => ts.isFunctionDeclaration(node) ? node.name?.text === name
    : ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === name));
  assert.equal(matches.length, 1, `one top-level declaration for ${name}`);
  return matches[0].getText(file);
}
test('stage witness mechanically preserves the sealed original prefix, private, schema and resource validators', () => {
  const original = readFileSync(new URL('../worker/experience-guest-image-output-witness.ts', import.meta.url), 'utf8');
  const successor = readFileSync(new URL('../worker/experience-guest-image-stage-witness.ts', import.meta.url), 'utf8');
  assert.equal(createHash('sha256').update(original).digest('hex'), '8893aee29f7658f011acb4961ad899f8c69823f6f8fe5389bfabc5030f9f4b71',
    'original first-SAVE witness remains byte-identical to accepted a2745c253587fff9715335c6ce22bcc8ebab845b');
  for (const name of ['originalPrefix','memoryProof','sponsorSchema','freshSource','personalBlockScopes','expectedResource','resourceProof',
    'eventRow','unsupportedIdentityJson','boundedIdentityValue','bytes','iso','uuid','flatRow','proof','together','current','prove',
    'sourceColumns','sessionColumns','policyColumns','draftColumns','commitColumns','eventColumns','bodyColumns','eventWitness','prefixWitness',
    'prefixJoins','commandColumns','resourceColumns','registries','registrySchemaSql','normalizedDdl','schemaItem','sponsorNames','sponsorTables','sponsorSchemaSql']) {
    assert.equal(sourceDeclaration(successor, name), sourceDeclaration(original, name), `${name} retains the accepted exact native contract`);
  }
  const oldDriverFamily = '{ required: false, sql: SPONSOR_DRIVER_SCHEMA }';
  const oldFamilies = sourceDeclaration(original, 'sponsorFamilies');
  assert.equal(oldFamilies.split(oldDriverFamily).length, 2, 'one previous optional driver family');
  assert.equal(sourceDeclaration(successor, 'sponsorFamilies'), oldFamilies.replace(oldDriverFamily, '{ required: true, sql: SPONSOR_DRIVER_SCHEMA }'),
    'the confirmation stage requires the exact existing driver schema');
  const omittedEmptyBranch = ' || data.state === "empty" && Date.parse(raw.recordedAt) < captured.minimumWriteMs';
  const originalValidation = sourceDeclaration(original, 'validateEvent');
  assert.equal(originalValidation.split(omittedEmptyBranch).length, 2, 'one deliberate former empty-state branch');
  assert.equal(sourceDeclaration(successor, 'validateEvent'), originalValidation.replace(omittedEmptyBranch, ''),
    'the successor validates an already-saved event; it never accepts original empty source');
  // objectSql deliberately chunks wider new sidecars under D1 arity 32. The new
  // closure deliberately permits only the four reviewed stage footprints.
  // Neither is asserted equal to the narrower first-SAVE implementation.
});

test('confirmed-source metering uses actual UTF-8 bytes, including non-ASCII authored input',async t=>{
  const f=await fixture(t,{subjectText:'A café beside a 橋 🌿'}),review=await prepare(f);
  const source=authoritativeCreativeContext(nativeEvents(f),{projectId:f.session.projectId,documentId:f.session.documentId}).snapshot;
  assert.ok(contextBytes(f)>JSON.stringify(source).length,'fixture distinguishes UTF-8 bytes from JavaScript code units');
  await confirm(f,review);const [intent]=rows(f,'experience_sponsor_driver_intents'),receipt=rows(f,'experience_sponsor_resource_receipts').find(row=>row.resource_id===`${intent.driver_id}:text`);
  assert.equal(intent.source_text_bytes,contextBytes(f));assert.equal(receipt.text_bytes,contextBytes(f));
});

for(const change of ['guest-revocation','payer-consent','source-redaction'])test(`in-transaction ${change} invalidates the after-proof and rolls back every confirmation side effect`,async t=>{
  const f=await fixture(t),review=await prepare(f),before=snapshot(f),nativePrepare=f.DB.prepare;let hit=false;
  f.DB.prepare=function(sql){const statement=nativePrepare.call(this,sql),bind=statement.bind;statement.bind=function(...bindings){const bound=bind.call(this,...bindings),execute=bound.execute;
    bound.execute=function(kind){const result=execute.call(this,kind);if(!hit&&sql.startsWith('INSERT INTO event_write_stage')){hit=true;
      if(change==='guest-revocation')f.sqlite.exec('UPDATE experience_guest_sessions SET revoked_at_ms=1');else if(change==='payer-consent')f.sqlite.exec('UPDATE users SET consent_version=NULL');else redactSource(f);}
      return result;};return bound;};return statement;};
  await assert.rejects(confirm(f,review));f.DB.prepare=nativePrepare;assert.equal(hit,true);assert.deepEqual(snapshot(f),before);
});

for(const acknowledgment of ['normal','lost'])for(const change of ['guest-revocation','payer-consent'])test(`postcommit ${change} refuses ${acknowledgment} confirmation disclosure and preserves the original charge`,async t=>{
  const f=await fixture(t),review=await prepare(f),done=batchHook(f,confirms,result=>{
    if(change==='guest-revocation')f.sqlite.exec('UPDATE experience_guest_sessions SET revoked_at_ms=1');else f.sqlite.exec('UPDATE users SET consent_version=NULL');
    if(acknowledgment==='lost')throw Error('lost confirmation acknowledgement after revocation');return result;
  });
  await assert.rejects(confirm(f,review));done();const before=snapshot(f);assert.equal(rows(f,'output_plan_revisions').length,1);
  assert.equal(rows(f,'experience_sponsor_driver_intents').length,1);assert.equal(rows(f,'experience_sponsor_resource_receipts').length,2);
  await assert.rejects(confirm(f,review));assert.deepEqual(snapshot(f),before);
});

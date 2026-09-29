import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {fixture,defaultIoPolicy,finances,attempts,nativeQuery,statements,actor} from './sponsor-story-read-fixture.mjs';

const originalFetch=globalThis.fetch;let unexpectedEgress=0;
globalThis.fetch=()=>{unexpectedEgress++;throw Error('Unexpected network in synthetic sponsored Story read qualification');};
after(()=>{globalThis.fetch=originalFetch;assert.equal(unexpectedEgress,0);});
const entryHas=(entry,predicate)=>(entry.statements??[entry]).some(statement=>predicate(statement.sql));
const noNativeReads=f=>assert.equal(f.observer.trace.some(entry=>entryHas(entry,nativeQuery.history)||entryHas(entry,nativeQuery.content)
  ||entryHas(entry,nativeQuery.final)||entry.kind==='batch'&&entryHas(entry,nativeQuery.principal)),false,
  'Refusal must precede budgeted native principal/history/content/final reads; bounded canonical actor-control authentication is permitted');
function assertReadCharge(f,count){
  const rows=attempts(f);assert.equal(rows.length,count);
  for(const row of rows){assert.equal(row.actor_user_id,actor);assert.equal(row.job_id,f.jobId);assert.equal(row.operation,'short-story-result');
    assert.equal(row.maximum_bytes,f.ioPolicy.operations['short-story-result'].maximumBytes);assert.ok(row.charged_through_ms>row.deadline_at_ms);}
}

// Standalone qualification of the NEW exported classifier and query adapter.
// Existing HTTP integration remains unapplied and is not exercised here.
// These tests never install, replace, emulate or claim a native HTTP endpoint.
const nativeRead=await import('../worker/experience-sponsor-native-story-read.ts');
const custody=await import('../worker/native-retained-text-custody.ts');

async function classified(f,{selected=f.selection(),request=f.readRequest(selected)}={}){
  const identity=custody.hostedIdentity(request);assert.ok(identity);
  const context=await nativeRead.beginSponsorNativeStoryRead(request,f.env,identity,{selection:selected});
  return {request,identity,context,selected,env:nativeRead.sponsorNativeStoryEnvironment(context,request,f.env)};
}

/** Read actual native helper results for a proof test; no HTTP response or
 * handler is constructed. The final proof is always invoked by its own test. */
async function proofParts(f,options){
  const parts=await classified(f,options),{request,identity,context,selected,env}=parts;
  const principal=await custody.readNativeRetainedPrincipal(env,identity);assert.equal(principal.observed.user_id,actor);
  const chosen=await custody.readNativeRetainedSelection(env,identity,selected,'short_story');assert.equal(chosen.native.completionId,f.completion.event_id);
  nativeRead.assertSponsorNativeStorySelection(context,request,f.env,selected,chosen.native);
  const retained=await custody.readNativeRetainedContent(env,identity,selected,chosen.native);assert.deepEqual(retained.selection,selected);
  const sql=nativeRead.sponsorNativeStoryFinalQuery(context,request,f.env);
  return {...parts,principal,chosen,retained,sql};
}
function finalStatement(parts,f){
  const {principal,chosen,retained}=parts;
  // This is the unchanged native helper's bind order, each value taken from
  // the actual preceding helper output rather than an invented authority DTO.
  return parts.env.DB.prepare(parts.sql).bind(...principal.auth.bindings,f.stream,chosen.snapshot,
    ...retained.contentBindings,retained.source.content,retained.source.expires_at,principal.principal.auth_json);
}

for(const edited of [false,true])test(`direct: actual native custody helpers and final siblings verify ${edited?'edited':'original'} sponsored Story under finite IO`,async t=>{
  const f=await fixture(t,{strict:!edited}),before=finances(f);
  if(edited)await f.edit('Mira chose the river path.\n\nThe clock reached its owner before dawn.');
  const parts=await proofParts(f);assert.equal(parts.retained.body.content_markdown,JSON.parse(f.raw()).content_markdown);
  assert.equal(parts.retained.selection.revision,edited?1:0);assert.equal(typeof parts.sql,'string');
  assert.deepEqual(await nativeRead.finishSponsorNativeStoryRead(parts.context,parts.request,f.env,finalStatement(parts,f)),{admitted:1});
  assertReadCharge(f,1);assert.deepEqual(finances(f),before);assert.equal(f.calls.length,1);
  if(!edited){f.limits.assertVerified();t.diagnostic(JSON.stringify({qualification:'standalone native helpers, no HTTP hook',strictLocalSqlStatements:f.limits.records.length,
    maximumBindings:Math.max(...f.limits.boundCounts),expressionDepth:100,functionArguments:32,parameters:100,sqlBytes:100000,actualExternalRequests:0}));}
});

test('direct: missing or exhausted IO refuses before budgeted native principal/history/content',async t=>{
  const missing=await fixture(t,{approved:false}),before=finances(missing);
  await assert.rejects(classified(missing),/sponsor_story_io_/);noNativeReads(missing);assert.equal(attempts(missing).length,0);assert.deepEqual(finances(missing),before);
  const ioPolicy=defaultIoPolicy();ioPolicy.actor.maximumRequestsPerWindow=1;
  const exhausted=await fixture(t,{ioPolicy});await classified(exhausted);assertReadCharge(exhausted,1);exhausted.observer.clear();
  await assert.rejects(classified(exhausted),/sponsor_story_io_limit_reached/);noNativeReads(exhausted);assertReadCharge(exhausted,1);
});

test('direct: legacy sponsored handle is refused before original native body retrieval',async t=>{
  const f=await fixture(t),request=f.legacyRequest(),identity=custody.hostedIdentity(request);
  await assert.rejects(nativeRead.beginSponsorNativeStoryRead(request,f.env,identity,{handle:{documentId:f.documentId,jobId:f.jobId}}),/sponsor_story_native_legacy_completion_unavailable/);
  noNativeReads(f);assert.equal(attempts(f).length,0);
});

for(const consumed of [true,false])for(const fault of ['project scope','context scope'])test(`direct: retained sponsorship marker ${consumed?'with':'without'} consumption cannot be laundered into an ordinary ${fault} read`,async t=>{
  const f=await fixture(t,{ordinary:!consumed}),before=finances(f);
  if(!consumed)f.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_set(private_json,'$.output_command_envelope.sponsor_entitlement',json('{}')) WHERE private_event_id=(SELECT authorization_event_id FROM output_execution_grants WHERE grant_id=?)").run(f.slot.grant_id);
  // Deliberately damaged disposable lineage. The original authorization marker
  // must still dominate a contradictory ordinary/project branch.
  if(fault==='project scope')f.sqlite.prepare("UPDATE output_plan_revisions SET scope_kind='project',organization_id='damaged-fixture-organization',project_access_id='damaged-fixture-access' WHERE plan_revision_id=?").run(f.planRevisionId);
  else f.sqlite.prepare("UPDATE output_execution_grants SET context_id='changed-project-context' WHERE grant_id=?").run(f.slot.grant_id);
  f.observer.clear();await assert.rejects(classified(f),/sponsor_story_/);noNativeReads(f);assert.deepEqual(finances(f),before);
});

test('direct: query adapter rejects unknown SQL before reaching the native database',async t=>{
  const f=await fixture(t),parts=await classified(f),before=statements(f.observer).length;
  assert.throws(()=>parts.env.DB.prepare('SELECT private_json FROM event_private_payloads'),/sponsor_story_read_query_unbounded/);
  assert.throws(()=>parts.env.DB.prepare('DELETE FROM private_content'),/sponsor_story_read_query_unbounded/);
  assert.equal(statements(f.observer).length,before);assertReadCharge(f,1);
});

for(const change of ['request identity','environment','database','abort'])test(`direct: ${change} after budgeted native principal return stops the read immediately`,async t=>{
  const f=await fixture(t),before=finances(f),database=f.env.DB,controller=new AbortController();
  const request=f.readRequest(f.selection(),{signal:controller.signal}),parts=await classified(f,{request});let changed=false;
  f.observer.after=entry=>{if(!changed&&entry.kind==='batch'&&entryHas(entry,nativeQuery.principal)){
    changed=true;
    if(change==='request identity')request.headers.set('oai-authenticated-user-email','changed@example.invalid');
    if(change==='environment')f.env.FORMA_PILOT_COHORT_ID='changed-after-native-read';
    if(change==='database')f.env.DB={...database};
    if(change==='abort')controller.abort();
  }};
  t.after(()=>{f.env.DB=database;delete f.env.FORMA_PILOT_COHORT_ID;});
  await assert.rejects(custody.readNativeRetainedPrincipal(parts.env,parts.identity),/sponsor_story_/);assert.equal(changed,true);
  assert.equal(statements(f.observer).some(entry=>nativeQuery.history(entry.sql)||nativeQuery.content(entry.sql)),false);
  assertReadCharge(f,1);assert.deepEqual(finances(f),before);
});

test('direct: escaped native row aggregation is refused in SQL before its retained content crosses the DB boundary',async t=>{
  const ioPolicy=defaultIoPolicy();ioPolicy.operations['short-story-result'].maximumBytes=300_000;
  const f=await fixture(t,{ioPolicy});await f.edit('\\'.repeat(100_000));f.observer.clear();
  const parts=await classified(f);await custody.readNativeRetainedPrincipal(parts.env,parts.identity);
  const chosen=await custody.readNativeRetainedSelection(parts.env,parts.identity,parts.selected,'short_story');
  assert.ok(Buffer.byteLength(f.raw())<300_000);
  await assert.rejects(custody.readNativeRetainedContent(parts.env,parts.identity,parts.selected,chosen.native),/sponsor_story_read_byte_capacity/);
  const reads=f.observer.trace.filter(entry=>entry.kind==='batch'&&entryHas(entry,nativeQuery.content));assert.equal(reads.length,1);
  assert.ok(reads[0].result[0].results[0].bytes>300_000);assert.deepEqual(reads[0].result[1].results,[]);assertReadCharge(f,1);
});

for(const fault of ['content changed','lineage changed','false sibling','null sibling'])test(`direct: actual native final batch fails closed when ${fault}`,async t=>{
  const f=await fixture(t),parts=await proofParts(f),before=finances(f);let injected=false;
  if(fault==='content changed')f.sqlite.prepare('UPDATE private_content SET content=? WHERE content_id=?').run(f.raw().replace('The Returned Clock','The Borrowed Clock'),f.contentId);
  if(fault==='lineage changed')f.sqlite.prepare('UPDATE output_operation_slots SET outcome_event_id=NULL WHERE slot_id=?').run(f.slot.slot_id);
  if(fault==='false sibling'||fault==='null sibling'){
    const database=f.env.DB,batch=database.batch;database.batch=async statements=>{
      if(!injected&&statements.some(statement=>nativeQuery.final(statement.sql))){
        const index=statements.findIndex(statement=>statement.sql.startsWith('SELECT CASE WHEN ('));assert.ok(index>0);injected=true;
        // Preserve the real native final statement and other siblings. Replace
        // only one proof's result with actual SQLite FALSE or NULL.
        const replacement=database.prepare('SELECT ? AS current').bind(fault==='false sibling'?0:null);
        return batch.call(database,statements.map((statement,position)=>position===index?replacement:statement));
      }
      return batch.call(database,statements);
    };t.after(()=>{database.batch=batch;});
  }
  await assert.rejects(nativeRead.finishSponsorNativeStoryRead(parts.context,parts.request,f.env,finalStatement(parts,f)),/sponsor_story_read_final_changed/);
  assert.throws(()=>nativeRead.sponsorNativeStoryResponse(parts.context,parts.request,f.env,JSON.stringify(parts.retained.body)),/sponsor_story_native_replay/,
    'A failed final proof never unlocks retained response bytes');
  if(fault.endsWith('sibling'))assert.equal(injected,true);assertReadCharge(f,1);assert.deepEqual(finances(f),before);
});

test('direct: ordinary read preserves its native environment and final negative sponsorship witness',async t=>{
  const f=await fixture(t,{ordinary:true}),parts=await classified(f);assert.equal(parts.env,f.env);
  assert.equal(nativeRead.sponsorNativeStoryFinalQuery(parts.context,parts.request,f.env),null);assert.equal(attempts(f).length,0);
  const principal=await custody.readNativeRetainedPrincipal(parts.env,parts.identity),chosen=await custody.readNativeRetainedSelection(parts.env,parts.identity,parts.selected,'short_story');
  const retained=await custody.readNativeRetainedContent(parts.env,parts.identity,parts.selected,chosen.native);
  f.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_set(private_json,'$.output_command_envelope.sponsor_entitlement',json('{}')) WHERE private_event_id=(SELECT authorization_event_id FROM output_execution_grants WHERE grant_id=?)").run(f.slot.grant_id);
  const {sponsorNativeStoryFinalSql}=await import('../worker/experience-sponsor-story-read-budget.ts');
  const statement=parts.env.DB.prepare(sponsorNativeStoryFinalSql(f.env,parts.identity)).bind(...principal.auth.bindings,f.stream,chosen.snapshot,
    ...retained.contentBindings,retained.source.content,retained.source.expires_at,principal.principal.auth_json);
  await assert.rejects(nativeRead.finishSponsorNativeStoryRead(parts.context,parts.request,f.env,statement),/sponsor_story_native_ordinary_changed/);
  assert.equal(attempts(f).length,0);
});

for(const change of ['database','abort','deadline'])test(`direct: ${change} after the actual native final batch rejects its successful result`,async t=>{
  const f=await fixture(t),before=finances(f),database=f.env.DB,controller=new AbortController();
  const parts=await proofParts(f,{request:f.readRequest(f.selection(),{signal:controller.signal})});let changed=false,clock;
  f.observer.after=entry=>{if(!changed&&entryHas(entry,nativeQuery.final)){
    changed=true;assert.equal(entry.result[0].results[0].admitted,1,'The real native proof must succeed before the context drifts');
    if(change==='database')f.env.DB={...database};
    else if(change==='abort')controller.abort();
    else{const later=performance.now()+31_000;clock=t.mock.method(performance,'now',()=>later);}
  }};
  t.after(()=>{f.env.DB=database;if(clock)clock.mock.restore();});
  await assert.rejects(nativeRead.finishSponsorNativeStoryRead(parts.context,parts.request,f.env,finalStatement(parts,f)),/sponsor_story_(?:native_context_changed|read_deadline)/);
  assert.equal(changed,true);assertReadCharge(f,1);assert.deepEqual(finances(f),before);
});

test('direct: response bytes remain locked while the actual final native proof is pending',async t=>{
  const f=await fixture(t),parts=await proofParts(f);let resume,entered;
  const blocked=new Promise(resolve=>{resume=resolve;}),arrived=new Promise(resolve=>{entered=resolve;});
  f.observer.before=async entry=>{if(entryHas(entry,nativeQuery.final)){entered();await blocked;}};
  const pending=nativeRead.finishSponsorNativeStoryRead(parts.context,parts.request,f.env,finalStatement(parts,f));
  await arrived;
  try{assert.throws(()=>nativeRead.sponsorNativeStoryResponse(parts.context,parts.request,f.env,JSON.stringify(parts.retained.body)),/sponsor_story_native_replay/);}
  finally{resume();}
  assert.deepEqual(await pending,{admitted:1});
  const stream=nativeRead.sponsorNativeStoryResponse(parts.context,parts.request,f.env,JSON.stringify(parts.retained.body));
  const reader=stream.getReader(),first=await reader.read();assert.equal(first.done,false);assert.ok(first.value.byteLength>0);await reader.cancel();assertReadCharge(f,1);
});

test('direct: more than 512 unrelated ordinary jobs cannot block the selected native Story',async t=>{
  const f=await fixture(t,{ordinary:true}),columns=f.sqlite.prepare('PRAGMA table_info(document_jobs)').all().map(row=>row.name);
  const insert=f.sqlite.prepare(`INSERT INTO document_jobs(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`);
  for(let index=0;index<513;index++){
    const row={...f.job,job_id:`unrelated-ordinary-story-${index}`,correlation_id:`unrelated-ordinary-correlation-${index}`,source_surface:'document',status:'queued',
      request_json:JSON.stringify({artifactKind:'short_story',productionMode:'manual',itemCount:1}),result_json:'{}'};
    insert.run(...columns.map(column=>row[column]));
  }
  const parts=await classified(f);assert.equal(parts.env,f.env);assert.equal(attempts(f).length,0);
  const principal=await custody.readNativeRetainedPrincipal(parts.env,parts.identity);
  const chosen=await custody.readNativeRetainedSelection(parts.env,parts.identity,parts.selected,'short_story');
  const retained=await custody.readNativeRetainedContent(parts.env,parts.identity,parts.selected,chosen.native);
  assert.equal(retained.selection.artifactId,f.artifactId);assert.equal(retained.body.title,'The Returned Clock');
  const {sponsorNativeStoryFinalSql}=await import('../worker/experience-sponsor-story-read-budget.ts');
  const final=parts.env.DB.prepare(sponsorNativeStoryFinalSql(f.env,parts.identity)).bind(...principal.auth.bindings,f.stream,chosen.snapshot,
    ...retained.contentBindings,retained.source.content,retained.source.expires_at,principal.principal.auth_json);
  assert.equal((await nativeRead.finishSponsorNativeStoryRead(parts.context,parts.request,f.env,final)).admitted,1);
  assert.equal(attempts(f).length,0);assert.equal(f.calls.length,1);
});

test('direct: consumed original correlation damage cannot hide its outcome behind an absent event-to-job join',async t=>{
  const f=await fixture(t),before=finances(f);
  f.sqlite.prepare("UPDATE document_jobs SET correlation_id='damaged-original-correlation' WHERE job_id=?").run(f.jobId);
  f.observer.clear();await assert.rejects(classified(f),/sponsor_story_/);
  noNativeReads(f);assert.equal(attempts(f).length,0);assert.deepEqual(finances(f),before);assert.equal(f.calls.length,1);
});

test('direct: capped oversized slot identities cannot masquerade as an absent ordinary native slot',async t=>{
  const f=await fixture(t,{ordinary:true}),before=finances(f);
  // A deliberately orphaned index row models damaged retained storage. The
  // disposable fixture disables foreign-key enforcement only for this fault;
  // production schema and every subsequent read keep enforcement enabled.
  f.sqlite.exec('PRAGMA foreign_keys=OFF');
  try{f.sqlite.prepare('UPDATE output_operation_slots SET scope_key=?,slot_id=?,grant_id=? WHERE job_id=?')
    .run('scope-'+ 'x'.repeat(241),'slot-'+ 'x'.repeat(241),'grant-'+ 'x'.repeat(241),f.jobId);}
  finally{f.sqlite.exec('PRAGMA foreign_keys=ON');}
  assert.equal(f.sqlite.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
  f.observer.clear();await assert.rejects(classified(f),/sponsor_story_/);
  noNativeReads(f);assert.equal(attempts(f).length,0);assert.deepEqual(finances(f),before);assert.equal(f.calls.length,1);
});

for(const ordinary of [false,true])test(`direct: sparse final acknowledgment cannot unlock ${ordinary?'ordinary':'sponsored'} retained Story bytes`,async t=>{
  for(const fault of ['sparse hole','explicit undefined','primitive receipt']){
    const f=await fixture(t,{ordinary}),parts=await proofParts(f),before=finances(f),database=f.env.DB,batch=database.batch;
    const {sponsorNativeStoryFinalSql}=await import('../worker/experience-sponsor-story-read-budget.ts');
    let injected=false;
    database.batch=async function(statements){
      const result=await batch.call(this,statements);
      if(!injected&&statements.some(statement=>nativeQuery.final(statement.sql))){
        assert.equal(result[0].results[0].admitted,1,'The real native final query must succeed');
        const index=statements.findIndex((statement,position)=>position>0&&statement.sql.startsWith('SELECT CASE WHEN ('));
        assert.ok(index>0);assert.equal(result[index].success,true);assert.equal(result[index].results[0].current,1);
        const malformed=result.slice();
        if(fault==='sparse hole')delete malformed[index];
        else malformed[index]=fault==='explicit undefined'?undefined:1;
        injected=true;assert.equal(malformed.length,result.length);assert.equal(Object.hasOwn(malformed,index),fault!=='sparse hole');
        assert.equal(malformed[0].results[0].admitted,1);return malformed;
      }
      return result;
    };
    t.after(()=>{database.batch=batch;});
    const statement=finalStatement({...parts,sql:parts.sql??sponsorNativeStoryFinalSql(f.env,parts.identity)},f);
    await assert.rejects(nativeRead.finishSponsorNativeStoryRead(parts.context,parts.request,f.env,statement),
      /sponsor_story_(?:read_final_changed|native_ordinary_changed)/,fault);
    assert.equal(injected,true,`Only one successful nonzero receipt is replaced after execution: ${fault}`);
    assert.throws(()=>nativeRead.sponsorNativeStoryResponse(parts.context,parts.request,f.env,JSON.stringify(parts.retained.body)),/sponsor_story_native_replay/);
    assert.equal(attempts(f).length,ordinary?0:1);assert.deepEqual(finances(f),before);assert.equal(f.calls.length,1);
  }
});

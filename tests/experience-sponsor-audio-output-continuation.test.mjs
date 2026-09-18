import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {after,test} from 'node:test';
import {fixture as intakeFixture,nativeRequest,responseBody,bytes,count,rows,snapshot,observeDatabase,headersFor,requestFor,databaseClock,queryLimits} from './experience-sponsor-audio-intake-native-fixture.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';
const [{prepareSponsorAudioDraft,commitSponsorAudioDraft},{canonicalJson},{receiptPrefix},outputPolicy,outputApproval,outputAttempts]=await Promise.all([
  import('../worker/experience-sponsor-audio-intake.ts'),import('../src/experiences/compiler.ts'),import('../src/experiences/intake.ts'),
  import('../worker/experience-sponsor-audio-output-policy.ts'),import('../worker/experience-sponsor-audio-output-approval.ts'),
  import('../worker/experience-sponsor-audio-output-attempts.ts')]);
const outputIO='experience_sponsor_audio_output_read_attempts';
const monetaryTables=['budget_reservations','cost_budget_reservations','budget_counters','cost_budget_counters',
  'output_execution_grants','output_operation_slots','document_jobs','output_provider_calls','experience_sponsor_grants',
  'experience_sponsor_resource_receipts','experience_sponsor_consumptions','experience_sponsor_active_jobs'];
const originalFetch=globalThis.fetch;let networkAttempts=0;
globalThis.fetch=()=>{networkAttempts++;throw Error('Initial native Audio output qualification forbids provider/network egress');};
after(()=>{globalThis.fetch=originalFetch;assert.equal(networkAttempts,0);});
function readPolicy(now){
  const allowance={maximumRequestsPerWindow:100,maximumBytesPerWindow:800_000_000,maximumQueriesPerWindow:1_000_000,maximumRowsPerWindow:10_000_000};
  return {version:1,family:'canonical-audio-output-read@1',purpose:'native-output-continuation',startsAtMs:now-60000,expiresAtMs:now+3600000,windowMs:60000,
    operations:Object.fromEntries(['audio-output-state','audio-output-prepare','audio-output-review','audio-output-authorize']
      .map(operation=>[operation,{maximumBytes:8_000_000,deadlineMs:30000,maximumQueries:10000,maximumRows:100000}])),
    actor:{...allowance},campaign:{...allowance}};
}
const businessSnapshot=f=>snapshot(f,{exclude:[outputIO]});
function assertNoExecution(f){
  for(const [table,expected]of Object.entries(f.financialBefore))assert.deepEqual(rows(f,table),expected,table);
  assert.deepEqual(f.effects,{media:0,assets:0});assert.equal(f.detached,0);assert.equal(f.media.size,0);assert.equal(networkAttempts,0);
}
async function refused(action){
  let result;try{result=await action();}catch(error){if(error?.code==='ERR_ASSERTION')throw error;assert.ok(error instanceof Error);return error;}
  assert.ok(result instanceof Response);assert.ok(result.status>=400,`Unexpected successful response: ${await result.text()}`);return result;
}
async function outputFixture(t,{detail='',strict=false,configurePolicy}={}){
  // Reuse accepted B at its default real registration. Its dormant transition
  // controls are never changed by this suite. Preserve B's genuine stored
  // plan, paired allocation/receipt, native actor digest and original events.
  const f=await intakeFixture(t,{detail,strict:false});
  f.intake=await responseBody(await prepareSponsorAudioDraft(f.prepareRequest(),f.env));
  f.plan=f.intake.plan;assert.equal(f.plan.events.length,detail?6:5);assert.equal(f.intake.status,'prepared');
  f.committed=await responseBody(await commitSponsorAudioDraft(f.commitRequest(f.plan),f.env));
  assert.equal(f.committed.status,'complete');assert.equal(f.committed.appended.length,f.plan.events.length);
  for(const schema of [outputPolicy.SPONSOR_AUDIO_OUTPUT_READ_POLICY_SCHEMA,outputApproval.SPONSOR_AUDIO_OUTPUT_READ_APPROVAL_SCHEMA,
    outputAttempts.SPONSOR_AUDIO_OUTPUT_READ_ATTEMPTS_SCHEMA])for(const sql of schema)f.sqlite.exec(sql);
  const now=Number(f.sqlite.prepare(`SELECT ${databaseClock} AS now`).get().now);f.outputPolicy=readPolicy(now);configurePolicy?.(f.outputPolicy);
  const proposal={version:1,family:'canonical-audio-output-read@1',campaignId:f.campaignId,sponsorPolicyDigest:f.compiled.policyDigest,readPolicy:f.outputPolicy};
  const review=await outputApproval.prepareSponsorAudioOutputReadApproval(requestFor(f,{action:'prepare-sponsor-audio-output-read-policy',proposal},{actorUserId:f.payer}),f.env);
  f.outputApproval=await outputApproval.approveSponsorAudioOutputReadPolicy(requestFor(f,{action:'approve-sponsor-audio-output-read-policy',
    approvalId:'fixture-native-audio-output-read',proposal,reviewedTermsDigest:review.termsDigest,confirmation:'APPROVE_SPONSOR_AUDIO_OUTPUT_READ_POLICY'},{actorUserId:f.payer}),f.env);
  f.outputRequest=(operation='audio-output-state',{body,signal,headers={},draftId=f.plan.draftId}={})=>new Request(`http://localhost/api/experiences/drafts/${draftId}/output${operation==='audio-output-prepare'?'/prepare':''}`,{
    method:operation==='audio-output-state'?'GET':'POST',headers:{...headersFor(f.actor),...(operation==='audio-output-state'?{}:{'content-type':'application/json'}),...headers},...(signal?{signal}:{}),
    ...(operation==='audio-output-state'?{}:{body:JSON.stringify(body??{draftHash:f.plan.draftHash,explicitRequirementsConfirmation:true})})});
  f.detached=0;f.executionContext={waitUntil(){f.detached++;throw Error('Initial native Audio output cannot detach work');}};
  const existing=new Set(f.sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row=>row.name));
  f.financialBefore=Object.fromEntries(monetaryTables.filter(table=>existing.has(table)).map(table=>[table,rows(f,table)]));
  t.after(()=>{assert.deepEqual(f.effects,{media:0,assets:0});assert.equal(f.detached,0);assert.equal(networkAttempts,0);});
  if(strict){f.limits=enforceD1ExpressionDepth(f,{queryLimits});t.after(()=>f.limits.restore());}
  return f;
}
async function originalBudget(f,request=f.outputRequest(),operation='audio-output-state'){
  const attempt=await outputAttempts.reserveSponsorAudioOutputReadAttempt(request,f.env,{operation,draftId:f.plan.draftId});
  const budget=await outputAttempts.takeSponsorAudioOutputReadAttempt(attempt,request,f.env);
  const view=outputAttempts.requireSponsorAudioOutputReadBudget(budget,request,f.env);
  assert.equal(view.original.draftId,f.plan.draftId);assert.equal(view.principal.userId,f.actor);
  assert.equal(view.authenticated.response,null);assert.equal(view.authenticated.impersonation,null);
  assert.equal(view.authenticated.user,view.principal);assert.equal(view.authenticated.principal,view.principal);
  return {request,attempt,budget,view};
}
function originalEvents(f){
  return f.sqlite.prepare(`SELECT receipt.client_event_id,event.type,event.event_id,event.sequence,secret.private_json
    FROM event_client_receipts receipt JOIN events event ON event.event_id=receipt.event_id
    JOIN event_private_payloads secret ON secret.private_event_id=event.event_id
    WHERE receipt.stream_id=? AND substr(receipt.client_event_id,1,?)=? ORDER BY event.sequence`)
    .all(f.stream,receiptPrefix(f.plan.draftId).length,receiptPrefix(f.plan.draftId)).map(row=>({...row}));
}
function assertOriginalIntake(f){
  const actual=originalEvents(f);assert.equal(actual.length,f.plan.events.length);
  for(const [index,event]of f.plan.events.entries()){
    assert.equal(actual[index].type,event.type);assert.equal(actual[index].client_event_id,event.payload.client_event_id);
    assert.equal(actual[index].private_json,JSON.stringify(event.payload));
  }
  const draft=f.sqlite.prepare('SELECT content,expires_at FROM private_content WHERE content_id=?').get(f.plan.draftId);
  assert.equal(draft.content,canonicalJson(f.plan));assert.equal(draft.expires_at,f.intake.expiresAt);return actual;
}

let controller;
async function initialOutput(f,operation='audio-output-state',options={}){
  controller??=await import('../worker/experience-sponsor-audio-output.ts');
  const request=options.request??f.outputRequest(operation,options);
  return controller.handleSponsorAudioOutputInitial(request,f.env,f.executionContext);
}
for(const detail of ['', 'A sustained ending with quiet strings. 水'])test(`Audio native ${detail?'six':'five'}-event initial state and original prepare preserve actual private plan and quote`,async t=>{
  const f=await outputFixture(t,{detail}),original=assertOriginalIntake(f),before=businessSnapshot(f);
  const initial=await responseBody(await initialOutput(f));
  assert.equal(initial.output,'audio');assert.equal(initial.status,'absent');assert.equal(initial.documentId,f.plan.documentId);
  assert.equal(initial.draftId,f.plan.draftId);assert.equal(initial.draftHash,f.plan.draftHash);assert.equal(initial.stage,null);
  assert.equal(initial.preflight,null);assert.equal(initial.grant,null);assert.equal(initial.permitted.run,false);
  assert.deepEqual(businessSnapshot(f),before);assert.equal(count(f,outputIO),1);
  const prepared=await responseBody(await initialOutput(f,'audio-output-prepare'));
  assert.equal(prepared.status,'review');assert.equal(prepared.stage,'preflight');assert.equal(prepared.disposition,'prepared');
  assert.equal(prepared.output,'audio');assert.equal(prepared.documentId,f.plan.documentId);assert.equal(prepared.draftHash,f.plan.draftHash);
  assert.ok(prepared.plan);assert.ok(prepared.preflight);assert.ok(prepared.audioCostPreview);
  assert.equal(prepared.preflight.planRevisionId,prepared.plan.revisionId);assert.equal(prepared.preflight.targets.length,1);
  assert.equal(prepared.preflight.targets[0].targetId,prepared.plan.targetId);assert.equal(prepared.preflight.targets[0].available,true);
  assert.equal(prepared.audioCostPreview.documentId,f.plan.documentId);assert.equal(prepared.audioCostPreview.actorUserId,f.actor);
  assert.deepEqual(prepared.audioCostPreview,prepared.preflight.targets[0].settings.costPreview);
  assert.equal(prepared.grant,null);assert.equal(prepared.permitted.run,false);assert.equal(prepared.permitted.resumeRun,false);
  assert.equal(count(f,outputIO),2);assert.equal(count(f,'output_preflights'),1);
  const stages=f.sqlite.prepare(`SELECT command.*,event.sequence,body.document_id,body.private_json FROM output_commands command
    JOIN events event ON event.event_id=command.event_id JOIN event_private_payloads body ON body.private_event_id=command.event_id ORDER BY event.sequence`).all();
  assert.deepEqual(stages.map(row=>row.action),['save','confirm','preflight']);
  const quoteBody=JSON.parse(stages[2].private_json);assert.deepEqual(quoteBody.preflight,prepared.preflight);
  assert.equal(stages[0].document_id,f.plan.documentId);assert.equal(stages[1].document_id,f.plan.documentId);assert.equal(stages[2].document_id,f.plan.documentId);
  assert.deepEqual(assertOriginalIntake(f),original);const complete=businessSnapshot(f);
  const replay=await responseBody(await initialOutput(f,'audio-output-prepare'));
  assert.deepEqual(replay,prepared);assert.deepEqual(businessSnapshot(f),complete);assert.equal(count(f,outputIO),3);
  const reopened=await responseBody(await initialOutput(f));assert.deepEqual(reopened,prepared);assert.deepEqual(businessSnapshot(f),complete);
  assert.equal(count(f,outputIO),4);assertNoExecution(f);
});

for(const invalid of ['extra key','missing confirmation','false confirmation','wrong hash','renewal'])test(`Audio native initial prepare rejects ${invalid} without stage writes`,async t=>{
  const f=await outputFixture(t),before=businessSnapshot(f),body={draftHash:f.plan.draftHash,explicitRequirementsConfirmation:true};
  if(invalid==='extra key')body.unreviewed='value';
  if(invalid==='missing confirmation')delete body.explicitRequirementsConfirmation;
  if(invalid==='false confirmation')body.explicitRequirementsConfirmation=false;
  if(invalid==='wrong hash')body.draftHash='a'.repeat(64);
  if(invalid==='renewal')body.renewal={explicit:true};
  await refused(()=>initialOutput(f,'audio-output-prepare',{body}));
  assert.equal(count(f,outputIO),1);assert.equal(count(f,'output_commands'),0);assert.deepEqual(businessSnapshot(f),before);assertNoExecution(f);
});

for(const invalid of ['authorize','run','review','query','hash','cross origin'])test(`Audio native dormant controller rejects ${invalid} before reservation`,async t=>{
  const f=await outputFixture(t),before=snapshot(f),base=`http://localhost/api/experiences/drafts/${f.plan.draftId}/output`;
  const url=invalid==='review'?`http://localhost/api/experiences/sponsor/audio/drafts/${f.plan.draftId}/review`:
    `${base}${invalid==='authorize'||invalid==='run'?`/${invalid}`:invalid==='query'?'?extra=1':invalid==='hash'?'#fragment':invalid==='cross origin'?'/prepare':''}`;
  const post=['authorize','run','cross origin'].includes(invalid);
  const request=new Request(url,{method:post?'POST':'GET',headers:{...headersFor(f.actor),...(invalid==='cross origin'?{origin:'https://foreign.example'}:{})},
    ...(post?{body:JSON.stringify({draftHash:f.plan.draftHash,explicitRequirementsConfirmation:true})}:{})});
  const {handleSponsorAudioOutputInitial}=await import('../worker/experience-sponsor-audio-output.ts');await assert.rejects(()=>handleSponsorAudioOutputInitial(request,f.env,f.executionContext));
  assert.deepEqual(snapshot(f),before);assertNoExecution(f);
});

test('Audio native continuation keeps the ordinary mini-app endpoint closed to marked drafts',async t=>{
  const f=await outputFixture(t),before=snapshot(f),{handleExperienceOutput}=await import('../worker/experience-output-api.ts');
  let bridgeCalls=0;const bridge=new Proxy({}, {get(){bridgeCalls++;throw Error('ordinary marked draft cannot reach execution bridge');}});
  const result=await handleExperienceOutput(f.outputRequest(),f.env,f.executionContext,bridge);
  assert.equal(result.status,403);assert.equal((await result.json()).error,'sponsor_intake_internal_only');assert.equal(bridgeCalls,0);
  assert.deepEqual(snapshot(f),before);assertNoExecution(f);
});

test('Audio native prepare meters five API loads plus native preflight source and replies on one original allowance',async t=>{
  const f=await outputFixture(t),observed=observeDatabase(f),request=f.outputRequest('audio-output-prepare');
  const {budget,view:budgetView}=await originalBudget(f,request,'audio-output-prepare');
  const reads=await import('../worker/experience-sponsor-audio-output-reads.ts');
  const {continueSponsorAudioOutputInitial}=await import('../worker/experience-output-api.ts');
  const owner=await reads.openSponsorAudioOutputReads(request,f.env,budget);t.after(()=>reads.closeSponsorAudioOutputReads(owner));
  const start=observed.records.length,usage={...budgetView.usage},deadline=budgetView.monotonicDeadline;
  const response=await continueSponsorAudioOutputInitial(owner,f.executionContext);
  // Inspect shared counters while still live. Final public disclosure retires
  // the owner itself; no post-retirement usage accessor can be reused.
  assert.equal(count(f,outputIO),1);
  const work=observed.records.slice(start),loads=work.filter(entry=>entry.statements.some(part=>/audio_output_native_*_rows AS MATERIALIZED \(SELECT content,expires_at FROM private_content WHERE content_id=/u.test(part.sql)));
  assert.equal(loads.length,6,'five API loads plus the genuine Audio preflight-source reentry');
  const actualQueries=work.reduce((total,entry)=>total+entry.statements.length,0);
  assert.equal(budgetView.usage.queries-usage.queries,actualQueries);
  assert.ok(budgetView.usage.bytes-usage.bytes>=work.reduce((total,entry)=>total+(entry.returnedBytes??0),0));
  const returnedRows=work.reduce((total,entry)=>total+(entry.kind==='batch'?entry.result:[entry.result]).reduce((sum,result)=>{
    const actual=Array.isArray(result?.results)?result.results:[result];
    return sum+Math.max(1,actual.length)+actual.reduce((extra,row)=>extra+(Number.isSafeInteger(row?.count)&&typeof row?.body==='string'?row.count:0),0);
  },0),0);
  assert.ok(budgetView.usage.rows-usage.rows>=returnedRows);assert.equal(budgetView.monotonicDeadline,deadline);
  assert.equal(request.bodyUsed,true);
  const disclosed=await reads.discloseSponsorAudioOutputResponse(owner,response),body=await responseBody(disclosed);
  assert.equal(body.status,'review');assert.equal(body.stage,'preflight');
  assert.throws(()=>outputAttempts.requireSponsorAudioOutputReadBudget(budget,request,f.env));assertNoExecution(f);
});

test('Audio native context reads the actual full personal stream including another retained Document',async t=>{
  const f=await outputFixture(t),marker='SECOND_DOCUMENT_PRIVATE_AUDIO_DIRECTION';
  const other=await responseBody(await prepareSponsorAudioDraft(f.prepareRequest(await nativeRequest({direction:marker})),f.env));
  await responseBody(await commitSponsorAudioDraft(f.commitRequest(other.plan),f.env));
  assert.notEqual(other.plan.documentId,f.plan.documentId);
  const observed=observeDatabase(f),before=businessSnapshot(f);
  const result=await responseBody(await initialOutput(f));assert.equal(result.status,'absent');assert.equal(result.documentId,f.plan.documentId);
  const streamReads=observed.records.filter(entry=>entry.statements.some(part=>part.sql.includes('FROM events LEFT JOIN event_private_payloads')));
  assert.ok(streamReads.length>0);assert.ok(streamReads.some(entry=>JSON.stringify(entry.result).includes(marker)),
    'Actual native stream hydration includes the unrelated retained Document; the read terms cover these bytes');
  assert.deepEqual(businessSnapshot(f),before);assert.equal(count(f,outputIO),1);assertNoExecution(f);
});

test('Audio native current draft proof refuses a change immediately after its first bounded body read',async t=>{
  const f=await outputFixture(t);let changed=0;
  const observed=observeDatabase(f,{after(entry){
    if(!changed&&entry.statements.some(part=>part.sql.includes('SELECT content,expires_at FROM private_content WHERE content_id='))){
      const mutation=f.sqlite.prepare('UPDATE private_content SET content=? WHERE content_id=?').run('{}',f.plan.draftId);assert.equal(mutation.changes,1);changed++;
    }
  }});
  await refused(()=>initialOutput(f,'audio-output-prepare'));
  assert.equal(changed,1);assert.ok(observed.records.length>0);assert.equal(count(f,'output_commands'),0);assert.equal(count(f,outputIO),1);
  assert.equal(f.sqlite.prepare('SELECT content FROM private_content WHERE content_id=?').get(f.plan.draftId).content,'{}');assertNoExecution(f);
});

test('Audio native SAVE transaction refuses original custody changed immediately before dispatch',async t=>{
  const f=await outputFixture(t),original=originalEvents(f);let changed=0;
  observeDatabase(f,{before(entry){
    if(!changed&&entry.kind==='batch'&&entry.statements.some(part=>/INSERT INTO (?:main\.)?event_write_stage\b/u.test(part.sql))){
      const mutation=f.sqlite.prepare('UPDATE private_content SET content=? WHERE content_id=?').run('{}',f.plan.draftId);assert.equal(mutation.changes,1);changed++;
    }
  }});
  await refused(()=>initialOutput(f,'audio-output-prepare'));
  assert.equal(changed,1);assert.equal(f.sqlite.prepare('SELECT content FROM private_content WHERE content_id=?').get(f.plan.draftId).content,'{}');
  assert.equal(count(f,'output_commands'),0);assert.equal(count(f,'events'),original.length);assert.equal(count(f,'output_preflights'),0);
  assert.equal(count(f,outputIO),1);assert.deepEqual(originalEvents(f),original);assertNoExecution(f);
});

for(const phase of ['save','confirm','preflight'])test(`Audio native ${phase} lost acknowledgement reopens the one genuine original`,async t=>{
  const f=await outputFixture(t),original=assertOriginalIntake(f);let lost=0;
  observeDatabase(f,{after(entry){
    if(!lost&&entry.kind==='batch'&&entry.statements.some(part=>/INSERT INTO (?:main\.)?output_commands\b/u.test(part.sql))
      &&f.sqlite.prepare('SELECT COUNT(*) AS n FROM output_commands WHERE action=?').get(phase).n===1){lost++;throw Error('synthetic lost actual native stage ACK');}
  }});
  let first;try{first=await initialOutput(f,'audio-output-prepare');}catch(error){assert.ok(error instanceof Error);}
  if(first)assert.ok(first.status===200||first.status>=400);
  assert.equal(lost,1);const recorded=rows(f,'output_commands');assert.ok(recorded.some(row=>row.action===phase));
  const result=await responseBody(await initialOutput(f,'audio-output-prepare'));assert.equal(result.stage,'preflight');
  const actual=rows(f,'output_commands');assert.equal(actual.length,3);assert.deepEqual(actual.map(row=>row.action).sort(),['confirm','preflight','save']);
  for(const row of recorded)assert.deepEqual(actual.find(item=>item.command_key===row.command_key),row);
  assert.equal(count(f,'output_preflights'),1);assert.deepEqual(assertOriginalIntake(f),original);assert.equal(count(f,outputIO),2);assertNoExecution(f);
});

// The accepted snapshot donor assumes rowid on every table. Audio A/C include
// WITHOUT ROWID tables, so this local synthetic copier uses declared key order
// for those tables and preserves real rowids everywhere else. It copies only
// actual native fixture state; future operations execute original SQL on D1.
const sqlName=name=>'"'+name.replaceAll('"','""')+'"';
function exportAudioSynthetic(sqlite){
  const schema=sqlite.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all().map(row=>({...row}));
  assert.ok(schema.length<=1024);assert.ok(schema.every(row=>!row.name.startsWith('sqlite_')||row.sql===null));
  const tables=schema.filter(row=>row.type==='table'),data={},inserts=[],queries={};
  for(const table of tables){
    const columns=sqlite.prepare(`PRAGMA table_info(${sqlName(table.name)})`).all();
    const without=/\bWITHOUT\s+ROWID\b/iu.test(table.sql),keys=columns.filter(column=>column.pk).sort((a,b)=>a.pk-b.pk).map(column=>column.name);
    assert.ok(!without||keys.length>0);
    const select=[...(without?[]:['CAST(rowid AS TEXT) AS original_rowid']),...columns.map((column,index)=>`quote(${sqlName(column.name)}) AS c${index}`)];
    const sql=`SELECT ${select.join(',')} FROM ${sqlName(table.name)} ORDER BY ${without?keys.map(sqlName).join(','):'rowid'}`;
    queries[table.name]=sql;data[table.name]=sqlite.prepare(sql).all().map(row=>({...row}));
    for(const row of data[table.name]){
      if(!without)assert.match(row.original_rowid,/^[0-9]+$/u);
      const names=[...(without?[]:['rowid']),...columns.map(column=>sqlName(column.name))];
      const values=[...(without?[]:[row.original_rowid]),...columns.map((_,index)=>row[`c${index}`])];
      const insert=`INSERT INTO ${sqlName(table.name)}(${names.join(',')}) VALUES(${values.join(',')})`;
      assert.ok(bytes(insert)<90000);inserts.push(insert);
    }
  }
  assert.ok(inserts.length<=2048);return {schema,data,inserts,queries};
}
async function d1Rows(db,table){
  return (await db.prepare(`SELECT * FROM ${sqlName(table)}`).all()).results.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
async function d1Snapshot(db,tables){return Object.fromEntries(await Promise.all(tables.map(async table=>[table,await d1Rows(db,table)])));}
// Opt-in lifecycle markers diagnose real local D1 awaits only. They do not
// change application SQL, deadlines, schema, acknowledgements or test oracles.
function d1Phase(phase){
  if(process.env.FORMA_AUDIO_INITIAL_D1_TRACE==='1')process.stderr.write(JSON.stringify({audioInitialD1Phase:phase,time:new Date().toISOString()})+'\n');
}
async function actualD1(t,f,{before}={}){
  d1Phase('miniflare-import:before');
  const {createRequire}=await import('node:module');
  const {Miniflare,Log,LogLevel}=createRequire(import.meta.resolve('wrangler'))('miniflare');d1Phase('miniflare-import:after');
  const {inheritRuntimeSchemaReadiness}=await import('../worker/runtime.ts');
  const exported=exportAudioSynthetic(f.sqlite);let outbound=0;d1Phase('miniflare-create:before');
  const mf=new Miniflare({modules:true,compatibilityDate:'2026-05-22',host:'127.0.0.1',port:0,log:new Log(LogLevel.NONE),d1Databases:['DB'],
    script:'export default {fetch(){return new Response("Synthetic initial Audio output D1 qualification")}}',
    outboundService(){outbound++;throw Error('Synthetic Audio D1 forbids outbound traffic');}});
  d1Phase('miniflare-create:after');
  t.after(async()=>{d1Phase('miniflare-dispose:before');await mf.dispose();d1Phase('miniflare-dispose:after');assert.equal(outbound,0);});
  d1Phase('miniflare-getDB:before');const db=await mf.getD1Database('DB');d1Phase('miniflare-getDB:after');
  d1Phase('schema-tables:before');
  await db.batch(exported.schema.filter(row=>row.type==='table').map(row=>db.prepare(row.sql)));
  d1Phase('schema-tables:after');d1Phase('data-copy:before');
  await db.batch([db.prepare('PRAGMA defer_foreign_keys=ON'),...exported.inserts.map(sql=>db.prepare(sql))]);
  d1Phase('data-copy:after');d1Phase('schema-other:before');
  await db.batch(exported.schema.filter(row=>row.sql&&row.type!=='table').map(row=>db.prepare(row.sql)));
  d1Phase('schema-other:after');d1Phase('fixture-qualification:before');
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
  for(const [table,sql]of Object.entries(exported.queries))assert.deepEqual((await db.prepare(sql).all()).results,exported.data[table],table);
  const names=new Set(exported.schema.map(row=>row.name));
  assert.deepEqual((await db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all()).results.filter(row=>names.has(row.name)),exported.schema);
  d1Phase('fixture-qualification:after');
  const records=[],statements=new WeakMap();
  const capture=async(kind,parts,execute)=>{
    const entry={kind,statements:parts.map(({sql,bindings})=>({sql,bindings:[...bindings]}))};records.push(entry);
    for(const part of parts){assert.ok(bytes(part.sql)<=queryLimits.sqlBytes);assert.ok(part.bindings.length<=queryLimits.parameters);}
    await before?.(entry,db);
    try{const result=await execute();entry.result=structuredClone(result);entry.returnedBytes=bytes(result);return result;}
    catch(error){entry.error=String(error);throw error;}
  };
  const wrap=(sql,bindings=[])=>{
    const original=db.prepare(sql).bind(...bindings),statement={bind:(...values)=>wrap(sql,values)};
    const part={sql,bindings,original};statements.set(statement,part);
    for(const kind of ['first','all','run'])statement[kind]=(...args)=>capture(kind,[part],()=>original[kind](...args));
    return statement;
  };
  const database={prepare:sql=>wrap(sql),batch(items){const parts=items.map(item=>{const part=statements.get(item);assert.ok(part);return part;});
    return capture('batch',parts,()=>db.batch(parts.map(part=>part.original)));}};
  inheritRuntimeSchemaReadiness(f.env.DB,database);f.env.DB=database;f.DB=database;
  return {db,records,tables:Object.keys(exported.data),exported};
}
async function assertD1NoExecution(f,d1){
  for(const [table,expected]of Object.entries(f.financialBefore))assert.deepEqual(await d1Rows(d1.db,table),expected,table);
  assert.deepEqual(f.effects,{media:0,assets:0});assert.equal(f.detached,0);assert.equal(networkAttempts,0);
}
// Compile after the application has finished: qualification cannot consume or
// renew a live request's allowance. EXPLAIN uses the actual schema and exact
// SQL/binding vectors, but executes none of the captured application statements.
// Workerd's unchanged compound-SELECT limit is five, independently of depth100.
const COMPILE_AUDIO_STATEMENTS=String.raw`
import hashlib,json,sqlite3,sys
length=int(sys.argv[1]);payload=sys.stdin.buffer.read(length)
assert len(payload)==length
data=json.loads(payload)
db=sqlite3.connect(':memory:',cached_statements=0)
class Aggregate:
    def step(self,*args): pass
    def finalize(self): return 1
class Window(Aggregate):
    def value(self): return 1
    def inverse(self,*args): pass
for function in data['functions']:
    if function['type']=='a': db.create_aggregate(function['name'],function['narg'],Aggregate)
    elif function['type']=='w': db.create_window_function(function['name'],function['narg'],Window)
    else: db.create_function(function['name'],function['narg'],lambda *args:1,deterministic=bool(function['flags']&2048))
for statement in data['schema']: db.executescript(statement+';')
limits=[(sqlite3.SQLITE_LIMIT_EXPR_DEPTH,100),(sqlite3.SQLITE_LIMIT_FUNCTION_ARG,32),
        (sqlite3.SQLITE_LIMIT_VARIABLE_NUMBER,100),(sqlite3.SQLITE_LIMIT_SQL_LENGTH,100000+len('EXPLAIN ')),
        (sqlite3.SQLITE_LIMIT_COMPOUND_SELECT,5)]
for category,value in limits:
    db.setlimit(category,value);assert db.getlimit(category)==value
def binding(item):
    kind,value=item
    if kind=='null': return None
    if kind=='text': return value
    if kind=='real': return float(value)
    if kind=='blob': return bytes.fromhex(value)
    raise ValueError('Unsupported captured binding')
maximum_bytes=0;maximum_parameters=0
for index,part in enumerate(data['statements']):
    sql=part['sql'];values=[binding(item) for item in part['bindings']]
    size=len(sql.encode('utf-8'));assert size<=100000;assert len(values)<=100
    maximum_bytes=max(maximum_bytes,size);maximum_parameters=max(maximum_parameters,len(values))
    try: db.execute('EXPLAIN '+sql,values).fetchall()
    except sqlite3.Error as error:
        print(json.dumps({'ok':False,'index':index,'sqlSha256':hashlib.sha256(sql.encode()).hexdigest(),'error':str(error)}))
        sys.exit(1)
print(json.dumps({'ok':True,'compiled':len(data['statements']),'maximumBytes':maximum_bytes,'maximumParameters':maximum_parameters,
                  'qualifiedDepth':100,'functionArguments':32,'compoundSelect':5,'sqlBytes':100000,'sqliteVersion':sqlite3.sqlite_version}))
`;
function capturedBinding(value){
  if(value===null)return ['null',null];
  if(typeof value==='string')return ['text',value];
  if(typeof value==='number'){
    assert.ok(Number.isFinite(value));
    return ['real',Object.is(value,-0)?'-0.0':String(value)];
  }
  if(value instanceof Uint8Array)return ['blob',Buffer.from(value).toString('hex')];
  assert.fail('Unsupported actual SQL binding');
}
function qualifyAudioStatements(f,records,t,{actualD1=false,mode}={}){
  const schema=f.sqlite.prepare("SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END,name").all().map(row=>row.sql);
  const functions=f.sqlite.prepare('PRAGMA function_list').all().filter(row=>!row.builtin).map(({name,narg,type,flags})=>({name,narg,type,flags}));
  const all=records.flatMap(entry=>entry.statements).map(({sql,bindings})=>({sql,bindings:bindings.map(capturedBinding)}));
  // Identical SQL with different actual bindings remains a separate compile.
  const statements=[...new Map(all.map(part=>[JSON.stringify(part),part])).values()];assert.ok(statements.length>0);
  const input=JSON.stringify({schema,functions,statements});
  const compiled=spawnSync(process.env.FORMA_SQLITE_PYTHON??'python3',['-I','-S','-B','-c',COMPILE_AUDIO_STATEMENTS,String(bytes(input))],{
    input,encoding:'utf8',maxBuffer:4*1024*1024,timeout:120000,
  });
  assert.equal(compiled.status,0,compiled.error?.message??compiled.stderr+compiled.stdout);
  const result=JSON.parse(compiled.stdout);assert.equal(result.ok,true);assert.equal(result.compiled,statements.length);
  t.diagnostic(JSON.stringify({actualD1,application:actualD1?'Node-hosted native application against workerd D1':'native SQLite application with post-flow strict compilation',
    mode,statements:all.length,uniqueSqlAndBindingVectors:statements.length,...result}));
  return result;
}
async function qualifyD1Statements(f,records,t){
  d1Phase('sql-qualification:before');
  // Real D1 has already executed every original binding and returned its ACK.
  qualifyAudioStatements(f,records,t,{actualD1:true});
  d1Phase('sql-qualification:after');
}

function assertSchemaCheckGroups(records){
  let guards=0;
  for(const {sql}of records.flatMap(entry=>entry.statements)){
    const first='native_schema_checks_0 AS MATERIALIZED (';
    for(let at=sql.indexOf(first);at>=0;at=sql.indexOf(first,at+first.length)){
      const boundaries=[at,...[1,2].map(index=>sql.indexOf(`native_schema_checks_${index} AS MATERIALIZED (`,at)),
        sql.indexOf('native_schema_checks AS MATERIALIZED (',at)];
      assert.ok(boundaries.every((value,index)=>value>=0&&(index===0||value>boundaries[index-1])));
      const sizes=boundaries.slice(0,3).map((start,index)=>(sql.slice(start,boundaries[index+1]).match(/SELECT selected\.mode,CASE WHEN \(/gu)??[]).length);
      assert.deepEqual(sizes,[4,4,3]);
      assert.ok(sql.slice(boundaries[3]).startsWith('native_schema_checks AS MATERIALIZED (SELECT mode,allowed FROM native_schema_checks_0 UNION ALL SELECT mode,allowed FROM native_schema_checks_1 UNION ALL SELECT mode,allowed FROM native_schema_checks_2)'));
      assert.ok(sql.slice(boundaries[3]).includes('GROUP BY mode HAVING COUNT(*)=11 AND MIN(allowed)=1'));
      guards++;
    }
  }
  assert.ok(guards>0,'the actual application must evaluate the complete native schema guard');return guards;
}

test('Audio native complete flow compiles within strict workerd limits in both native schema modes',{timeout:300000},async t=>{
  const [{SCENE_SOURCE_GENERATION_TABLES},{SCENE_SOURCE_GENERATION_TRIGGERS},{captureSceneSourceVersion}]=await Promise.all([
    import('../db/scene-source-generation-tables.ts'),import('../db/scene-source-generations.ts'),import('../worker/scene-source-generation.ts')]);
  for(const scene of [false,true]){
    const mode=scene?'complete Scene schema':'base schema',f=await outputFixture(t,{detail:scene?'A sustained ending with quiet strings. 水':''});
    let sourceVersion;
    if(scene){
      assert.equal(SCENE_SOURCE_GENERATION_TABLES.length,2);assert.equal(SCENE_SOURCE_GENERATION_TRIGGERS.length,15);
      for(const definition of [...SCENE_SOURCE_GENERATION_TABLES,...SCENE_SOURCE_GENERATION_TRIGGERS])f.sqlite.exec(definition.sql);
      // Genuine certified activation after historical intake does not backfill
      // authored history; the subsequent native output writes drive counters.
      sourceVersion=await captureSceneSourceVersion(f.env,{streamId:f.stream});
      assert.equal(sourceVersion.epoch,1);assert.equal(sourceVersion.streamGeneration,0);assert.equal(sourceVersion.projectGeneration,0);
    }else assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE name LIKE 'scene_source_%'").get().n,0);
    const schemaRows=()=>f.sqlite.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all().map(row=>({...row}));
    const schemaBefore=schemaRows(),original=assertOriginalIntake(f),before=businessSnapshot(f),observed=observeDatabase(f);
    const initial=await responseBody(await initialOutput(f));
    assert.equal(initial.status,'absent');assert.equal(initial.documentId,f.plan.documentId);assert.equal(initial.draftHash,f.plan.draftHash);
    assert.equal(initial.stage,null);assert.equal(initial.preflight,null);assert.equal(initial.grant,null);assert.equal(initial.permitted.run,false);
    assert.deepEqual(businessSnapshot(f),before);assert.equal(count(f,outputIO),1);
    const prepared=await responseBody(await initialOutput(f,'audio-output-prepare'));
    assert.equal(prepared.status,'review');assert.equal(prepared.stage,'preflight');assert.equal(prepared.disposition,'prepared');
    assert.equal(prepared.output,'audio');assert.equal(prepared.documentId,f.plan.documentId);assert.equal(prepared.draftHash,f.plan.draftHash);
    assert.equal(prepared.preflight.planRevisionId,prepared.plan.revisionId);assert.equal(prepared.preflight.targets.length,1);
    assert.equal(prepared.preflight.targets[0].targetId,prepared.plan.targetId);assert.equal(prepared.preflight.targets[0].available,true);
    assert.equal(prepared.audioCostPreview.documentId,f.plan.documentId);assert.equal(prepared.audioCostPreview.actorUserId,f.actor);
    assert.deepEqual(prepared.audioCostPreview,prepared.preflight.targets[0].settings.costPreview);
    assert.equal(prepared.grant,null);assert.equal(prepared.permitted.run,false);assert.equal(prepared.permitted.resumeRun,false);
    const stages=f.sqlite.prepare(`SELECT command.action,body.private_json FROM output_commands command
      JOIN events event ON event.event_id=command.event_id JOIN event_private_payloads body ON body.private_event_id=command.event_id ORDER BY event.sequence`).all();
    assert.deepEqual(stages.map(row=>row.action),['save','confirm','preflight']);assert.deepEqual(JSON.parse(stages[2].private_json).preflight,prepared.preflight);
    assert.equal(count(f,'output_preflights'),1);assert.deepEqual(assertOriginalIntake(f),original);
    if(scene){
      const generation=f.sqlite.prepare("SELECT generation FROM scene_source_generations WHERE scope_kind='stream' AND scope_key=?").get(f.stream);
      assert.ok(generation.generation>sourceVersion.streamGeneration);
    }
    const complete=businessSnapshot(f);
    assert.deepEqual(await responseBody(await initialOutput(f,'audio-output-prepare')),prepared);assert.deepEqual(businessSnapshot(f),complete);
    assert.deepEqual(await responseBody(await initialOutput(f)),prepared);assert.deepEqual(businessSnapshot(f),complete);
    assert.equal(count(f,outputIO),4);assertNoExecution(f);
    const draftReads=observed.records.filter(entry=>entry.statements.some(part=>/audio_output_native_*_rows AS MATERIALIZED \(SELECT content,expires_at FROM private_content WHERE content_id=/u.test(part.sql)));
    assert.equal(draftReads.length,10,'initial GET, six fresh-POST reads, two replay reads, reopened GET');
    assert.deepEqual(schemaRows(),schemaBefore,'post-flow compiler schema is the unchanged schema used by every captured application statement');
    const guards=assertSchemaCheckGroups(observed.records);
    qualifyAudioStatements(f,observed.records,t,{mode});
    t.diagnostic(JSON.stringify({mode,schemaGuardOccurrences:guards,obligationsPerMode:11,compoundGroups:[4,4,3],outerCompound:3}));
  }
});

test('Audio initial local workerd D1 five-event native preparation and exact retained replay',{timeout:180000},async t=>{
  d1Phase('positive-fixture:before');const f=await outputFixture(t);d1Phase('positive-fixture:after');
  const d1=await actualD1(t,f),original=await d1Snapshot(d1.db,['experience_sponsor_audio_intakes','experience_sponsor_audio_intake_allocations','private_content']);
  const originalIds=new Set(assertOriginalIntake(f).map(row=>row.event_id));
  const originalRows=async()=>Object.fromEntries(await Promise.all([
    ['events','event_id'],['event_private_payloads','private_event_id'],['event_client_receipts','event_id']
  ].map(async([table,key])=>[table,(await d1Rows(d1.db,table)).filter(row=>originalIds.has(row[key]))])));
  const originalEventRows=await originalRows();
  for(const actual of Object.values(originalEventRows))assert.equal(actual.length,f.plan.events.length);
  d1Phase('positive-prepare:before');const result=await responseBody(await initialOutput(f,'audio-output-prepare'));d1Phase('positive-prepare:after');
  assert.equal(result.status,'review');assert.equal(result.stage,'preflight');assert.equal(result.documentId,f.plan.documentId);assert.ok(result.audioCostPreview);
  assert.ok(result.plan);assert.ok(result.preflight);assert.equal(result.preflight.planRevisionId,result.plan.revisionId);
  assert.equal(result.preflight.targets.length,1);assert.equal(result.preflight.targets[0].targetId,result.plan.targetId);
  assert.equal(result.preflight.targets[0].available,true);assert.deepEqual(result.preflight.targets[0].settings.costPreview,result.audioCostPreview);
  assert.equal(result.audioCostPreview.documentId,f.plan.documentId);assert.equal(result.audioCostPreview.actorUserId,f.actor);
  const commands=await d1Rows(d1.db,'output_commands');assert.deepEqual(commands.map(row=>row.action).sort(),['confirm','preflight','save']);
  const preflightCommand=commands.find(row=>row.action==='preflight');
  const retainedEvent=await d1.db.prepare('SELECT * FROM events WHERE event_id=?').bind(preflightCommand.event_id).first();
  const retainedBody=await d1.db.prepare('SELECT * FROM event_private_payloads WHERE private_event_id=?').bind(preflightCommand.event_id).first();
  assert.ok(retainedEvent);assert.equal(retainedEvent.event_id,preflightCommand.event_id);
  assert.equal(retainedBody.document_id,f.plan.documentId);assert.equal(retainedBody.redacted_at,null);
  assert.deepEqual(JSON.parse(retainedBody.private_json).preflight,result.preflight);
  assert.equal((await d1Rows(d1.db,'output_preflights')).length,1);
  assert.deepEqual(await d1Snapshot(d1.db,Object.keys(original)),original);assert.deepEqual(await originalRows(),originalEventRows);
  const before=await d1Snapshot(d1.db,d1.tables.filter(table=>table!==outputIO));
  d1Phase('positive-replay:before');const replay=await responseBody(await initialOutput(f,'audio-output-prepare'));d1Phase('positive-replay:after');assert.deepEqual(replay,result);
  assert.deepEqual(await d1Snapshot(d1.db,d1.tables.filter(table=>table!==outputIO)),before);
  assert.equal((await d1Rows(d1.db,outputIO)).length,2);await assertD1NoExecution(f,d1);await qualifyD1Statements(f,d1.records,t);
});

test('Audio initial local workerd D1 six-event SAVE refuses a concurrent original-body change atomically',{timeout:180000},async t=>{
  d1Phase('race-fixture:before');const f=await outputFixture(t,{detail:'A native optional detail for actual D1.'});d1Phase('race-fixture:after');let changed=0,saveEntry;
  const d1=await actualD1(t,f,{async before(entry,db){
    if(!changed&&entry.kind==='batch'&&entry.statements.some(part=>/INSERT INTO (?:main\.)?event_write_stage\b/u.test(part.sql))){
      saveEntry=entry;const mutation=await db.prepare('UPDATE private_content SET content=? WHERE content_id=?').bind('{}',f.plan.draftId).run();assert.equal(mutation.meta.changes,1);changed++;
    }
  }});
  const original=await d1Snapshot(d1.db,['events','event_private_payloads','event_client_receipts','experience_sponsor_audio_intakes','experience_sponsor_audio_intake_allocations']);
  d1Phase('race-prepare:before');await refused(()=>initialOutput(f,'audio-output-prepare'));d1Phase('race-prepare:after');assert.equal(changed,1);
  assert.ok(saveEntry);assert.match(saveEntry.error,/CHECK constraint failed: passed=1/u);assert.equal(Object.hasOwn(saveEntry,'result'),false);
  assert.equal((await d1Rows(d1.db,'output_atomic_assertions')).length,0);
  assert.equal((await d1.db.prepare('SELECT content FROM private_content WHERE content_id=?').bind(f.plan.draftId).first()).content,'{}');
  assert.equal((await d1Rows(d1.db,'output_commands')).length,0);assert.equal((await d1Rows(d1.db,'output_preflights')).length,0);
  assert.equal((await d1Rows(d1.db,outputIO)).length,1);assert.deepEqual(await d1Snapshot(d1.db,Object.keys(original)),original);
  await assertD1NoExecution(f,d1);await qualifyD1Statements(f,d1.records,t);
});

// Intercept only actual producer calls on the genuine qualified environment.
// Original statements remain registered in the owner's private WeakMap. A
// changed descriptor is rebuilt by that same qualified adapter, before its
// validator; neither an auth object nor a successful database row is fabricated.
function interceptQualifiedBatch(database,hook){
  const prepare=database.prepare,batch=database.batch,known=new WeakMap();
  const track=(statement,sql,bindings)=>{
    known.set(statement,{sql,bindings:[...bindings]});const bind=statement.bind;
    statement.bind=function(...values){return track(bind.call(this,...values),sql,values);};return statement;
  };
  database.prepare=function(sql){return track(prepare.call(this,sql),sql,[]);};
  database.batch=async function(items){
    const descriptors=items.map(item=>{const value=known.get(item);assert.ok(value);return value;});
    const changed=await hook({items,descriptors,make:(sql,bindings)=>prepare.call(database,sql).bind(...bindings)});
    return batch.call(database,changed??items);
  };
  return()=>{database.prepare=prepare;database.batch=batch;};
}
async function ownedInitial(f,{operation='audio-output-prepare',beforeBatch,onExecute,onDisclose,beforeDisclosure,setupOwner,alterResponse}={}){
  const request=f.outputRequest(operation),actual=await originalBudget(f,request,operation);
  const reads=await import('../worker/experience-sponsor-audio-output-reads.ts');
  const {continueSponsorAudioOutputInitial}=await import('../worker/experience-output-api.ts');
  const {outputExperienceCommands}=await import('../worker/output-requirements-api.ts');
  const owner=await reads.openSponsorAudioOutputReads(request,f.env,actual.budget),view=reads.requireSponsorAudioOutputReads(owner);
  const execute=outputExperienceCommands.execute,disclose=outputExperienceCommands.disclose;
  const restoreOwner=await setupOwner?.({owner,view,budgetView:actual.view,reads})??(()=>{});
  const restore=beforeBatch?interceptQualifiedBatch(view.nativeEnv.DB,input=>beforeBatch({...input,owner,view,budgetView:actual.view})):()=>{};
  if(onExecute)outputExperienceCommands.execute=async function(...args){await onExecute(args[0],args[1],{owner,view,budgetView:actual.view,reads});return execute.apply(this,args);};
  if(onDisclose||beforeDisclosure)outputExperienceCommands.disclose=async function(...args){await beforeDisclosure?.({owner,view,budgetView:actual.view,reads});return onDisclose?onDisclose(disclose.bind(this),...args):disclose.apply(this,args);};
  try{
    const response=await continueSponsorAudioOutputInitial(owner,f.executionContext);
    return await reads.discloseSponsorAudioOutputResponse(owner,alterResponse?await alterResponse(response,actual):response);
  }finally{restore();restoreOwner();outputExperienceCommands.execute=execute;outputExperienceCommands.disclose=disclose;reads.closeSponsorAudioOutputReads(owner);}
}

// Separately qualify the native SQLite CHECK/rollback contract after producer
// validation. Only the closing truth operand changes; this is deliberately not
// evidence that the qualified validator accepts a caller's altered SQL.
for(const truth of ['1','0','NULL'])test(`Audio native SAVE actual closing sink keeps ${truth} truth semantics atomically`,async t=>{
  const f=await outputFixture(t),database=f.env.DB,batch=database.batch;let reached=0;
  database.batch=async function(items){
    const event=items.findIndex(item=>/INSERT INTO (?:main\.)?event_write_stage\(/u.test(item.sql));
    if(!reached&&event>=0){
      const at=items.findIndex((item,index)=>index>event&&item.sql.includes('INSERT INTO output_atomic_assertions(token,passed) VALUES('));
      assert.ok(at>event);const closing=items[at];assert.equal(closing.bindings.length,1);
      const vector=JSON.parse(closing.bindings[0]);assert.equal(vector.length,4);assert.equal(vector[2],f.actor);assert.equal(vector[3],f.plan.documentId);
      assert.ok(closing.sql.includes('EXISTS(SELECT 1 FROM events event JOIN event_private_payloads body'));
      assert.ok(closing.sql.endsWith(') THEN 1 ELSE 0 END)'));
      const sql=truth==='1'?closing.sql:closing.sql.replace(/\) THEN 1 ELSE 0 END\)$/u,`) AND (${truth}) THEN 1 ELSE 0 END)`);
      assert.equal(sql===closing.sql,truth==='1');const changed=items.slice();changed[at]=database.prepare(sql).bind(...closing.bindings);reached++;
      return batch.call(this,changed);
    }
    return batch.call(this,items);
  };
  try{
    if(truth==='1'){const result=await responseBody(await initialOutput(f,'audio-output-prepare'));assert.equal(result.stage,'preflight');assert.equal(count(f,'output_commands'),3);}
    else{await refused(()=>initialOutput(f,'audio-output-prepare'));assert.equal(count(f,'output_commands'),0);assert.equal(count(f,'events'),5);assert.equal(count(f,'output_preflights'),0);}
    assert.equal(reached,1);assert.equal(count(f,'output_atomic_assertions'),0);assert.equal(count(f,outputIO),1);assertNoExecution(f);
  }finally{database.batch=batch;}
});

for(const phase of ['save','confirm'])test(`Audio native ${phase} refuses coherent changed private payload and matching sidecars`,async t=>{
  const f=await outputFixture(t),observed=observeDatabase(f);let changed=0,dispatchAtChange;
  await refused(()=>ownedInitial(f,{async beforeBatch({items,descriptors,make}){
    const eventAt=descriptors.findIndex(part=>part.sql.startsWith('INSERT INTO event_write_stage('));if(eventAt<0)return;
    const event=descriptors[eventAt],expectedType=phase==='save'?'BlockCreated':'OutputPlanConfirmed';if(event.bindings[11]!==expectedType)return;
    assert.equal(changed,0);const b=[...event.bindings],payload=JSON.parse(b[16]);
    if(phase==='save'){payload.properties.text+=' DIFFERENT_NATIVELY_UNREVIEWED_TEXT';payload.properties.output_spec.original_text=payload.properties.text;}
    else{
      const target=payload.confirmed_plan.plan.targets[0];target.instruction_text+=' DIFFERENT_NATIVELY_UNREVIEWED_INSTRUCTION';
      const {outputTargetContractDigest}=await import('../worker/output-requirements-api.ts');
      const contract=await outputTargetContractDigest(target,payload.confirmed_plan.sourceDigest);payload.confirmed_plan.targetContractDigests[target.id]=contract;
      const at=descriptors.findIndex(part=>part.sql.startsWith('INSERT INTO output_plan_targets('));assert.ok(at>eventAt);
      const sidecar=[...descriptors[at].bindings];assert.equal(sidecar[2],target.id);sidecar[3]=contract;items=items.slice();items[at]=make(descriptors[at].sql,sidecar);
      assert.equal(sidecar[3],payload.confirmed_plan.targetContractDigests[target.id]);
    }
    const {eventWriteBindings}=await import('../worker/event-write-primitives.ts');
    const next=eventWriteBindings({eventId:b[0],streamId:b[1],sequence:b[2],occurredAt:b[3],recordedAt:b[4],actor:b[5],clientId:b[6],correlationId:b[7],
      causationId:b[8],compensatesEventId:b[9],schemaVersion:b[10],type:b[11],payload});
    assert.notEqual(next[16],b[16]);assert.equal(next[0],b[0]);const result=items.slice();result[eventAt]=make(event.sql,next);
    dispatchAtChange=observed.records.length;changed++;return result;
  }}));
  assert.equal(changed,1);assert.equal(observed.records.length,dispatchAtChange,'substituted native batch refused before underlying dispatch');
  assert.equal(count(f,'output_commands'),phase==='save'?0:1);assert.equal(count(f,'output_plan_revisions'),0);assert.equal(count(f,'output_preflights'),0);assertNoExecution(f);
});

test('Audio native SAVE refuses in-place removal of the genuine captured source assertions before dispatch',async t=>{
  const f=await outputFixture(t),observed=observeDatabase(f);let trusted,array,changed=0,dispatchAtChange;
  await refused(()=>ownedInitial(f,{onExecute(context,envelope){if(envelope.action==='save'){trusted=context;array=context.sourceAssertions;assert.ok(array.length>0);}},
    beforeBatch({descriptors}){if(descriptors.some(part=>part.sql.startsWith('INSERT INTO event_write_stage('))){
      assert.equal(changed,0);assert.equal(trusted.sourceAssertions,array);array.length=0;assert.equal(trusted.sourceAssertions.length,0);
      dispatchAtChange=observed.records.length;changed++;
    }} }));
  assert.equal(changed,1);assert.equal(observed.records.length,dispatchAtChange);assert.equal(count(f,'output_commands'),0);assert.equal(count(f,'events'),5);assertNoExecution(f);
});

test('Audio native SAVE refuses an allowance too small for the actual ACK before mutation',async t=>{
  const f=await outputFixture(t),observed=observeDatabase(f);let reached=0,dispatchAtChange;
  await refused(()=>ownedInitial(f,{beforeBatch({descriptors,budgetView}){
    if(descriptors.some(part=>part.sql.startsWith('INSERT INTO event_write_stage('))){
      assert.equal(reached,0);const remaining=budgetView.remaining();assert.ok(remaining.bytes>4095);
      budgetView.account({bytes:remaining.bytes-4095,queries:0,rows:0});assert.equal(budgetView.remaining().bytes,4095);
      dispatchAtChange=observed.records.length;reached++;
    }
  }}));
  assert.equal(reached,1);assert.equal(observed.records.length,dispatchAtChange);assert.equal(count(f,'output_commands'),0);assert.equal(count(f,'events'),5);assertNoExecution(f);
});

test('Audio native final disclosure refuses a copied Response despite the genuine complete proof',async t=>{
  const f=await outputFixture(t),observed=observeDatabase(f);let copied=0,dispatchAtCopy;
  await refused(()=>ownedInitial(f,{operation:'audio-output-state',async alterResponse(actual){
    assert.equal(actual.status,200);const text=await actual.clone().text();assert.equal(JSON.parse(text).status,'absent');
    const fake=new Response(text,{status:actual.status,headers:actual.headers});assert.notEqual(fake,actual);dispatchAtCopy=observed.records.length;copied++;return fake;
  }}));
  assert.equal(copied,1);assert.equal(observed.records.length,dispatchAtCopy);assert.equal(count(f,'output_commands'),0);assertNoExecution(f);
});

test('Audio native final disclosure refuses a two-proof subset before underlying dispatch',async t=>{
  const f=await outputFixture(t),observed=observeDatabase(f);let shortened=0,dispatchAtChange;
  await refused(()=>ownedInitial(f,{operation:'audio-output-state',async onDisclose(original,trusted,...args){
    const restore=interceptQualifiedBatch(trusted.env.DB,({items,descriptors})=>{
      assert.equal(shortened,0);assert.ok(items.length>2);assert.ok(descriptors.every(part=>part.sql.startsWith('SELECT CASE WHEN (')));
      dispatchAtChange=observed.records.length;shortened++;return items.slice(0,2);
    });
    try{return await original(trusted,...args);}finally{restore();}
  }}));
  assert.equal(shortened,1);assert.equal(observed.records.length,dispatchAtChange);assert.equal(count(f,'output_commands'),0);assertNoExecution(f);
});

test('Audio native full-stream read refuses a foreign private owner before transferring its body',async t=>{
  const f=await outputFixture(t),marker='FOREIGN_OWNER_PRIVATE_AUDIO_DIRECTION';
  const other=await responseBody(await prepareSponsorAudioDraft(f.prepareRequest(await nativeRequest({direction:marker})),f.env));
  const receipt=await responseBody(await commitSponsorAudioDraft(f.commitRequest(other.plan),f.env));
  const target=receipt.appended.find(event=>JSON.stringify(event.payload).includes(marker));assert.ok(target);assert.notEqual(f.actor,f.payer);
  assert.equal(f.sqlite.prepare('UPDATE event_private_payloads SET owner_id=? WHERE private_event_id=?').run(f.payer,target.eventId).changes,1);
  const observed=observeDatabase(f),before=businessSnapshot(f);
  await refused(()=>initialOutput(f));
  const streamReads=observed.records.filter(entry=>entry.statements.some(part=>part.sql.includes('FROM events LEFT JOIN event_private_payloads')));
  assert.equal(streamReads.length,1);assert.equal(streamReads[0].error,undefined);assert.equal(streamReads[0].result.results[0].body,null);
  assert.equal(JSON.stringify(streamReads[0].result).includes(marker),false);assert.deepEqual(businessSnapshot(f),before);assert.equal(count(f,outputIO),1);assertNoExecution(f);
});


for(const target of ['environment','nested context','source proof','save confirmation','confirm confirmation'])test(`Audio native genuine ${target} cannot change after its exact phase is captured`,async t=>{
  const f=await outputFixture(t),observed=observeDatabase(f);let checked=0,foreignDispatch=0;
  const foreignEnv={...f.env,DB:{prepare(){foreignDispatch++;throw Error('foreign context database');},batch(){foreignDispatch++;throw Error('foreign context database');}}};
  const result=await responseBody(await ownedInitial(f,{onExecute(trusted,envelope){
    const phase=target==='confirm confirmation'?'confirm':'save';if(envelope.action!==phase||checked)return;
    const before=observed.records.length;assert.equal(envelope.explicitRequirementsConfirmation,true);
    if(target==='environment'){const original=trusted.env;assert.throws(()=>{trusted.env=foreignEnv;},TypeError);assert.equal(trusted.env,original);}
    if(target==='nested context'){const count=trusted.projection.blocks.length;assert.ok(count>0);assert.throws(()=>{trusted.projection.blocks.length=0;},TypeError);assert.equal(trusted.projection.blocks.length,count);}
    if(target==='source proof'){assert.ok(trusted.sourceAssertions.length>0);const sql=trusted.sourceAssertions[0].sql;assert.throws(()=>{trusted.sourceAssertions[0].sql='1';},TypeError);assert.equal(trusted.sourceAssertions[0].sql,sql);}
    if(target.endsWith('confirmation')){assert.throws(()=>{envelope.explicitRequirementsConfirmation=false;},TypeError);assert.equal(envelope.explicitRequirementsConfirmation,true);}
    assert.equal(observed.records.length,before);assert.equal(foreignDispatch,0);checked++;
  }}));
  assert.equal(checked,1);assert.equal(foreignDispatch,0);assert.equal(result.stage,'preflight');assert.equal(count(f,'output_commands'),3);assertNoExecution(f);
});

test('Audio native genuine source proof replacement cannot be resealed as current authority',async t=>{
  const f=await outputFixture(t),observed=observeDatabase(f);let replaced=0,completed=0,dispatchAtChange;
  await refused(()=>ownedInitial(f,{onExecute(trusted,envelope,{owner,reads,view}){
    if(envelope.action!=='save')return;
    assert.ok(trusted.sourceAssertions.length>0);const original=trusted.sourceAssertions[0];
    trusted.sourceAssertions[0]={sql:'1',bindings:[]};
    assert.notEqual(trusted.sourceAssertions[0],original);assert.equal(trusted.sourceAssertions[0].sql,'1');
    dispatchAtChange=observed.records.length;replaced++;
    assert.throws(()=>reads.retainSponsorAudioOutputTrustedContext(owner,trusted));
    trusted.sourceAssertions[0]=original;assert.equal(trusted.sourceAssertions[0],original);
    assert.throws(()=>view.current(),'restoring the exact source proof cannot revive a refused owner');completed++;
  }}));
  assert.equal(replaced,1);assert.equal(completed,1);assert.equal(observed.records.length,dispatchAtChange);assert.equal(count(f,'output_commands'),0);assertNoExecution(f);
});

test('Audio native actual final proof batch refuses 8192 remaining bytes before dispatch',async t=>{
  const f=await outputFixture(t),observed=observeDatabase(f);let exhausted=0,dispatchAtChange;
  await refused(()=>ownedInitial(f,{operation:'audio-output-state',beforeDisclosure({budgetView}){
    const remaining=budgetView.remaining();assert.ok(remaining.bytes>8192);
    budgetView.account({bytes:remaining.bytes-8192,queries:0,rows:0});assert.equal(budgetView.remaining().bytes,8192);
    dispatchAtChange=observed.records.length;exhausted++;
  }}));
  assert.equal(exhausted,1);assert.equal(observed.records.length,dispatchAtChange);assert.equal(count(f,'output_commands'),0);assertNoExecution(f);
});

for(const alteration of ['extra native-table trigger','wrong revision index order'])test(`Audio native write schema refuses ${alteration} before any stage append`,async t=>{
  const f=await outputFixture(t);
  if(alteration==='extra native-table trigger')f.sqlite.exec('CREATE TRIGGER unexpected_audio_output_command AFTER INSERT ON output_commands BEGIN SELECT 1; END');
  else{
    const original=f.sqlite.prepare("SELECT sql FROM sqlite_schema WHERE name='idx_output_plans_document'").get();
    assert.match(original.sql,/revision DESC/iu);f.sqlite.exec('DROP INDEX idx_output_plans_document');
    f.sqlite.exec('CREATE INDEX idx_output_plans_document ON output_plan_revisions(scope_key,document_id,revision ASC)');
  }
  const before=businessSnapshot(f);await refused(()=>initialOutput(f,'audio-output-prepare'));
  assert.equal(count(f,'output_commands'),0);assert.equal(count(f,'events'),5);assert.deepEqual(businessSnapshot(f),before);assertNoExecution(f);
});


test('Audio native full-stream read permits a NULL sidecar on an unrelated same-owner event',async t=>{
  const f=await outputFixture(t),marker='UNRELATED_REDACTED_AUDIO_DIRECTION';
  const other=await responseBody(await prepareSponsorAudioDraft(f.prepareRequest(await nativeRequest({direction:marker})),f.env));
  const receipt=await responseBody(await commitSponsorAudioDraft(f.commitRequest(other.plan),f.env));
  const target=receipt.appended.find(event=>JSON.stringify(event.payload).includes(marker));assert.ok(target);assert.notEqual(other.plan.documentId,f.plan.documentId);
  const original=f.sqlite.prepare('SELECT owner_id,document_id,redacted_at FROM event_private_payloads WHERE private_event_id=?').get(target.eventId);
  assert.equal(original.owner_id,f.actor);assert.equal(original.document_id,other.plan.documentId);assert.equal(original.redacted_at,null);
  assert.equal(f.sqlite.prepare('UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?').run(new Date().toISOString(),target.eventId).changes,1);
  const observed=observeDatabase(f),before=businessSnapshot(f),selected=assertOriginalIntake(f);
  const result=await responseBody(await initialOutput(f));assert.equal(result.status,'absent');assert.equal(result.documentId,f.plan.documentId);
  const streamReads=observed.records.filter(entry=>entry.statements.some(part=>part.sql.includes('FROM events LEFT JOIN event_private_payloads')));
  assert.ok(streamReads.length>0);let nullRows=0;
  for(const entry of streamReads){
    assert.equal(entry.error,undefined);const body=JSON.parse(entry.result.results[0].body),row=body.find(value=>value[0]===target.eventId);
    if(row){assert.equal(row.length,20);assert.deepEqual(row.slice(13),Array(7).fill(null));nullRows++;}
  }
  assert.ok(nullRows>0);assert.deepEqual(assertOriginalIntake(f),selected);assert.deepEqual(businessSnapshot(f),before);assertNoExecution(f);
});

test('Audio native lost SAVE acknowledgement permits only one exact original lookup in the same stage',async t=>{
  const f=await outputFixture(t);let lost=0,firstRecovery=0,secondAttempt=0,completed=0,dispatchBeforeSecond;
  const observed=observeDatabase(f,{after(entry){
    if(!lost&&entry.kind==='batch'&&entry.statements.some(part=>/INSERT INTO (?:main\.)?output_commands\b/u.test(part.sql))
      &&f.sqlite.prepare("SELECT COUNT(*) AS n FROM output_commands WHERE action='save'").get().n===1){lost++;throw Error('synthetic lost actual SAVE ACK');}
  }});
  await refused(()=>ownedInitial(f,{setupOwner({view}){
    const database=view.nativeEnv.DB,prepare=database.prepare;
    const track=(statement,sql)=>{
      const bind=statement.bind;statement.bind=function(...values){return track(bind.call(this,...values),sql);};
      if(sql.startsWith('SELECT command.action,command.event_id,command.request_digest')){
        const first=statement.first;statement.first=async function(...args){
          if(lost&&!firstRecovery){
            firstRecovery++;const before=observed.records.length,row=await first.apply(this,args);
            const retained=f.sqlite.prepare("SELECT command.event_id,body.private_json FROM output_commands command JOIN event_private_payloads body ON body.private_event_id=command.event_id WHERE command.action='save'").get();
            assert.equal(row.action,'save');assert.equal(row.event_id,retained.event_id);assert.equal(row.private_json,retained.private_json);assert.equal(observed.records.length,before+1);
            dispatchBeforeSecond=observed.records.length;secondAttempt++;
            await assert.rejects(()=>first.apply(this,args),/sponsor_audio_output_native_final_proof_changed/u);assert.equal(observed.records.length,dispatchBeforeSecond);completed++;
            throw Error('second original lookup was refused as required');
          }
          return first.apply(this,args);
        };
      }
      return statement;
    };
    database.prepare=function(sql){return track(prepare.call(this,sql),sql);};return()=>{database.prepare=prepare;};
  }}));
  assert.equal(lost,1);assert.equal(firstRecovery,1);assert.equal(secondAttempt,1);assert.equal(completed,1);assert.equal(observed.records.length,dispatchBeforeSecond);
  assert.deepEqual(rows(f,'output_commands').map(row=>row.action),['save']);assert.equal(count(f,'events'),6);assert.equal(count(f,'output_preflights'),0);assertNoExecution(f);
});


test('Audio native observed genuine projection Set mutation stays terminal after exact restoration',async t=>{
  const f=await outputFixture(t),observed=observeDatabase(f);let changed=0,completed=0,dispatchAtChange;
  await refused(()=>ownedInitial(f,{onExecute(trusted,envelope,{view}){
    if(envelope.action!=='save')return;
    const values=trusted.projection.presentedBriefItems,marker='synthetic-unreviewed-brief-item';
    assert.ok(values instanceof Set);assert.equal(Set.prototype.has.call(values,marker),false);
    Set.prototype.add.call(values,marker);assert.equal(Set.prototype.has.call(values,marker),true);
    dispatchAtChange=observed.records.length;changed++;assert.throws(()=>view.current());
    Set.prototype.delete.call(values,marker);assert.equal(Set.prototype.has.call(values,marker),false);assert.throws(()=>view.current());completed++;
  }}));
  assert.equal(changed,1);assert.equal(completed,1);assert.equal(observed.records.length,dispatchAtChange);assert.equal(count(f,'output_commands'),0);assertNoExecution(f);
});

test('Audio native actual plan private-body read refuses 8192 remaining bytes before dispatch',async t=>{
  const f=await outputFixture(t),observed=observeDatabase(f);let exhausted=0,dispatchAtChange,commandsBefore;
  await refused(()=>ownedInitial(f,{setupOwner({view,budgetView}){
    const database=view.nativeEnv.DB,prepare=database.prepare;
    const track=(statement,sql)=>{
      const bind=statement.bind;statement.bind=function(...values){return track(bind.call(this,...values),sql);};
      if(sql==='SELECT private_json FROM event_private_payloads WHERE private_event_id=? AND owner_id=? AND project_id=? AND document_id=? AND redacted_at IS NULL'){
        const first=statement.first;statement.first=async function(...args){
          assert.equal(exhausted,0);const remaining=budgetView.remaining();assert.ok(remaining.bytes>8192);
          budgetView.account({bytes:remaining.bytes-8192,queries:0,rows:0});assert.equal(budgetView.remaining().bytes,8192);
          dispatchAtChange=observed.records.length;commandsBefore=rows(f,'output_commands');exhausted++;return first.apply(this,args);
        };
      }
      return statement;
    };
    database.prepare=function(sql){return track(prepare.call(this,sql),sql);};return()=>{database.prepare=prepare;};
  }}));
  assert.equal(exhausted,1);assert.equal(observed.records.length,dispatchAtChange);assert.deepEqual(rows(f,'output_commands'),commandsBefore);
  assert.ok(commandsBefore.some(row=>row.action==='confirm'));assert.equal(count(f,'output_preflights'),0);assertNoExecution(f);
});


// Semantic counterfactual after genuine producer/descriptor validation. The
// original native predicate, full binding vector and every other gate remain.
// This tests actual SQLite truth/cardinality; it is not caller-SQL permission.
for(const truth of ['1','0','NULL'])test(`Audio native materialized proof reuse preserves ${truth} truth and singleton cardinality`,async t=>{
  const f=await outputFixture(t),database=f.env.DB,batch=database.batch,before=businessSnapshot(f);
  let armed=false,reached=0,completed=0;
  database.batch=async function(items){
    if(armed&&!reached){
      const found=items.map((item,index)=>({item,index,match:/audio_output_native_*_rows AS MATERIALIZED \(SELECT allowed AS current FROM (audio_output_native_*_gate_\d+)\)/u.exec(item.sql)})).find(item=>item.match);
      assert.ok(found);const {item,index,match}=found,gate=match[1];assert.equal(item.bindings.length,1);assert.ok(Array.isArray(JSON.parse(item.bindings[0])));
      const opening=`${gate} AS MATERIALIZED (SELECT CASE WHEN (`,start=item.sql.indexOf(opening);assert.ok(start>=0);
      const end=item.sql.indexOf(') THEN 1 ELSE 0 END AS allowed)',start+opening.length);assert.ok(end>start);
      const sql=truth==='1'?item.sql:item.sql.slice(0,end+1)+` AND (${truth})`+item.sql.slice(end+1);
      assert.equal(sql===item.sql,truth==='1');const changed=items.slice();changed[index]=database.prepare(sql).bind(...item.bindings);reached++;
      const result=await batch.call(this,changed),row=result[index].results[0];
      assert.equal(result[index].results.length,1);assert.equal(row.count,1);assert.equal(row.authorized,truth==='1'?1:0);
      if(truth==='1')assert.deepEqual(JSON.parse(row.body),[[1]]);else assert.equal(row.body,null);
      completed++;return result;
    }
    return batch.call(this,items);
  };
  try{
    const run=()=>ownedInitial(f,{operation:'audio-output-state',onDisclose(original,...args){armed=true;return original(...args);}});
    if(truth==='1')assert.equal((await responseBody(await run())).status,'absent');else await refused(run);
    assert.equal(reached,1);assert.equal(completed,1);assert.equal(count(f,'output_commands'),0);assert.equal(count(f,outputIO),1);
    assert.deepEqual(businessSnapshot(f),before);assertNoExecution(f);
  }finally{database.batch=batch;}
});

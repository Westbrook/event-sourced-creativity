import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {outputTestDatabase,registerOutputSourceImports} from './output-execution-test-helpers.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';

registerOutputSourceImports();
const [{ensureSchema},{GUEST_CUSTODY_SCHEMA,issueGuestClaimSession,readGuestCustodyTerms},
  {GUEST_SOURCE_SCHEMA,readGuestSourcePolicy,prepareGuestImageSource,commitGuestImageSource},
  {retireExpiredGuestImageSource},{registeredExperience,initialValues},{canonicalJson,digest}]=await Promise.all([
  import('../worker/runtime.ts'),import('../worker/experience-guest-session.ts'),import('../worker/experience-guest-source.ts'),
  import('../worker/experience-guest-source-retirement.ts'),import('../src/experiences/intake.ts'),import('../src/experiences/compiler.ts')]);

const origin='https://guest.example.invalid';
const request=()=>new Request(`${origin}/unregistered-source`,{method:'POST',headers:{origin}});
const proof=session=>({sessionId:session.sessionId,sessionToken:session.sessionToken,claimToken:session.claimToken});
const unavailable=/guest_custody_source_retirement_unavailable/u;
const dbChanged=/guest_custody_database_changed/u;
const retirementBatch=statements=>statements.some(statement=>statement.sql.includes('INSERT INTO experience_guest_source_assertions'));
const rows=(f,table)=>f.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
const stableTables=['events','event_client_receipts','experience_guest_sources','experience_guest_source_commits',
  'experience_guest_sessions','experience_guest_policies','experience_guest_source_policies','experience_guest_claim_leases'];
const history=f=>Object.fromEntries(stableTables.map(table=>[table,rows(f,table)]));
const privateRows=f=>({drafts:rows(f,'private_content'),events:rows(f,'event_private_payloads')});

async function fixture(t,{draftLifetimeMs=300,sessionLifetimeMs=300000}={}){
  const f=outputTestDatabase();t.after(()=>f.sqlite.close());await ensureSchema(f.env);
  for(const sql of [...GUEST_CUSTODY_SCHEMA,...GUEST_SOURCE_SCHEMA])f.sqlite.exec(sql);
  const terms=readGuestCustodyTerms({version:1,policyId:'guest-policy',origin,startsAtMs:Date.now()-60000,expiresAtMs:Date.now()+600000,
    sessionLifetimeMs,leaseLifetimeMs:Math.min(60000,sessionLifetimeMs),maximumSessions:5,maximumLeaseAcquisitions:2});
  f.sqlite.prepare('INSERT INTO experience_guest_policies VALUES(?,?,?,?,NULL)').run(terms.policyId,await digest(terms),canonicalJson(terms),`sha256:${'b'.repeat(64)}`);
  const release=await registeredExperience('image'),values=initialValues(release);
  values.subject={value:'A blue heron on a stone bridge',provenance:'authored'};
  values.ratio={value:{width:1,height:1},provenance:'authored'};
  const policy=readGuestSourcePolicy({version:1,policyId:'source-policy',sessionPolicyId:terms.policyId,sessionTermsDigest:await digest(terms),
    releaseHash:release.releaseHash,maximumDraftBytes:65536,maximumEventBytes:65536,maximumEvents:16,draftLifetimeMs});
  f.sqlite.prepare('INSERT INTO experience_guest_source_policies VALUES(?,?,?,?,NULL)').run(policy.policyId,await digest(policy),canonicalJson(policy),`sha256:${'c'.repeat(64)}`);
  t.mock.method(globalThis,'fetch',()=>{throw Error('network forbidden');});
  for(const method of ['get','head','put','delete','list'])t.mock.method(f.env.MEDIA,method,()=>{throw Error('media forbidden');});
  const newSource=async()=>{
    const session=await issueGuestClaimSession(request(),f.env,terms.policyId);
    const input={proof:proof(session),policyId:policy.policyId,request:{intentId:session.sessionId,experienceId:'image',releaseHash:release.releaseHash,values}};
    const prepared=await prepareGuestImageSource(request(),f.env,input);
    return {session,input,prepared,commit:()=>commitGuestImageSource(request(),f.env,{proof:proof(session),draftHash:prepared.plan.draftHash})};
  };
  const source=await newSource();
  return {...f,...source,terms,policy,newSource,
    retire:()=>retireExpiredGuestImageSource(f.env,{sessionId:source.session.sessionId}),
    unpaid:()=>{for(const table of ['users','document_jobs','budget_reservations','cost_budget_reservations','output_execution_grants','output_provider_calls'])
      assert.equal(rows(f,table).length,0,table);}};
}

async function expire(f,sessionId=f.session.sessionId){
  const started=performance.now();
  // The immutable native receipt is never rewritten to manufacture expiry.
  while(!f.sqlite.prepare("SELECT expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AS expired FROM experience_guest_sources WHERE session_id=?")
    .get(sessionId)?.expired){
    assert.ok(performance.now()-started<5000,'native database deadline reached');await delay(10);
  }
}
function expectRetired(f,result,eventCount,replayed){
  assert.deepEqual(result,{status:'retired',sessionId:f.session.sessionId,draftId:f.prepared.plan.draftId,eventCount,replayed});
  const draft=f.sqlite.prepare('SELECT * FROM private_content WHERE content_id=?').get(f.prepared.plan.draftId);
  assert.equal(draft.content,'');assert.ok(draft.redacted_at);assert.equal(draft.expires_at,f.prepared.expiresAt);
  const events=f.sqlite.prepare('SELECT body.* FROM event_private_payloads body JOIN events event ON event.event_id=body.private_event_id WHERE event.stream_id=?')
    .all(`creative:${f.session.guestSubject}`);
  assert.equal(events.length,eventCount);for(const body of events){assert.equal(body.private_json,'');assert.ok(body.redacted_at);}
  f.unpaid();
}
function corrupt(f,table,sql,...bindings){
  // Historical damage is synthetic and explicit; immutable receipt/event guards
  // are proved before their fixture-only removal.
  if(['events','experience_guest_sources','experience_guest_source_commits','experience_guest_sessions',
    'experience_guest_policies','experience_guest_source_policies'].includes(table)){
    assert.throws(()=>f.sqlite.prepare(sql).run(...bindings),/append-only|immutable/u);
    for(const row of f.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name=?").all(table))f.sqlite.exec(`DROP TRIGGER ${row.name}`);
  }
  f.sqlite.prepare(sql).run(...bindings);
}

test('active source refuses retirement using database time even if the process clock jumps forward',async t=>{
  const f=await fixture(t,{draftLifetimeMs:60000}),committed=await f.commit(),before=privateRows(f),publicBefore=history(f);
  t.mock.method(Date,'now',()=>8_000_000_000_000);
  await assert.rejects(f.retire(),/guest_custody_source_retirement_not_due/u);
  assert.deepEqual(privateRows(f),before);assert.deepEqual(history(f),publicBefore);assert.ok(committed.eventIds.length);f.unpaid();
});
test('expired prepared-only source erases its native draft and preserves immutable evidence',async t=>{
  const f=await fixture(t),before=history(f);await expire(f);
  expectRetired(f,await f.retire(),0,false);assert.deepEqual(history(f),before);
  const erased=privateRows(f);expectRetired(f,await f.retire(),0,true);assert.deepEqual(privateRows(f),erased);
});
test('expired committed source retires only original private copies and exact repeat is inert',async t=>{
  const f=await fixture(t),committed=await f.commit(),before=history(f);await expire(f);
  const limits=enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}});
  let erased;
  try{expectRetired(f,await f.retire(),committed.eventIds.length,false);assert.deepEqual(history(f),before);
    erased=privateRows(f);expectRetired(f,await f.retire(),committed.eventIds.length,true);assert.deepEqual(privateRows(f),erased);
    limits.assertVerified();t.diagnostic(JSON.stringify({schema:'absent',maxBindings:Math.max(...limits.boundCounts),maxSqlBytes:Math.max(...limits.records.map(r=>r.statementBytes)),qualifiedQueries:limits.records.length}));
  }finally{limits.restore();}
  await assert.rejects(prepareGuestImageSource(request(),f.env,f.input));await assert.rejects(f.commit());
  assert.deepEqual(privateRows(f),erased);assert.deepEqual(history(f),before);
});
test('database expiry succeeds despite a backward process clock, revoked policies/session and a claim lease',async t=>{
  const f=await fixture(t),committed=await f.commit();
  f.sqlite.prepare('INSERT INTO experience_guest_claim_leases VALUES(?,?,?,?,?,?,?,?,?)').run(f.session.sessionId,'lease','destination',
    `sha256:${'d'.repeat(64)}`,'request','["request"]',1,Date.now(),Date.now()+60000);
  f.sqlite.exec('UPDATE experience_guest_sessions SET revoked_at_ms=1; UPDATE experience_guest_policies SET revoked_at_ms=1; UPDATE experience_guest_source_policies SET revoked_at_ms=1');
  const before=history(f);await expire(f);t.mock.method(Date,'now',()=>0);
  expectRetired(f,await f.retire(),committed.eventIds.length,false);assert.deepEqual(history(f),before);
});
test('an expired session credential cannot obstruct due retention cleanup',async t=>{
  const f=await fixture(t,{sessionLifetimeMs:500,draftLifetimeMs:300}),committed=await f.commit();await expire(f);
  while(!f.sqlite.prepare("SELECT expires_at_ms<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AS expired FROM experience_guest_sessions WHERE session_id=?")
    .get(f.session.sessionId).expired)await delay(10);
  expectRetired(f,await f.retire(),committed.eventIds.length,false);
});
test('an already erased draft does not strand committed private context copies',async t=>{
  const f=await fixture(t),committed=await f.commit();
  f.sqlite.prepare("UPDATE private_content SET content='',redacted_at='2026-01-01T00:00:00.000Z' WHERE content_id=?").run(f.prepared.plan.draftId);
  const before=history(f);await expire(f);expectRetired(f,await f.retire(),committed.eventIds.length,false);
  assert.equal(f.sqlite.prepare('SELECT redacted_at FROM private_content WHERE content_id=?').get(f.prepared.plan.draftId).redacted_at,'2026-01-01T00:00:00.000Z');
  assert.deepEqual(history(f),before);
});
test('already erased original event bodies are accepted without changing their first redaction time',async t=>{
  const f=await fixture(t),committed=await f.commit();
  f.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at='2026-01-01T00:00:00.000Z' WHERE private_event_id=?").run(committed.eventIds[0]);
  await expire(f);expectRetired(f,await f.retire(),committed.eventIds.length,false);
  assert.equal(f.sqlite.prepare('SELECT redacted_at FROM event_private_payloads WHERE private_event_id=?').get(committed.eventIds[0]).redacted_at,'2026-01-01T00:00:00.000Z');
});
test('another guest and ordinary user private rows are untouched even when their own expiry is past',async t=>{
  const f=await fixture(t),committed=await f.commit(),other=await f.newSource(),otherCommit=await other.commit();
  f.sqlite.prepare('INSERT INTO private_content VALUES(?,?,?,?,?,?,NULL)').run('ordinary-draft','ordinary-user','experience-draft','ordinary private body',
    '2026-01-01T00:00:00.000Z','2026-01-02T00:00:00.000Z');
  f.sqlite.prepare('INSERT INTO event_private_payloads VALUES(?,?,?,?,?,?,NULL)').run('ordinary-event','ordinary-user','ordinary-project','ordinary-document',
    '{"text":"ordinary private event"}','2026-01-01T00:00:00.000Z');
  const untouched=()=>({drafts:f.sqlite.prepare('SELECT * FROM private_content WHERE content_id<>? ORDER BY content_id').all(f.prepared.plan.draftId),
    events:f.sqlite.prepare('SELECT * FROM event_private_payloads WHERE private_event_id NOT IN (SELECT value FROM json_each(?)) ORDER BY private_event_id').all(JSON.stringify(committed.eventIds))});
  const before=untouched(),publicBefore=history(f);assert.ok(otherCommit.eventIds.length);await expire(f);
  expectRetired(f,await f.retire(),committed.eventIds.length,false);assert.deepEqual(untouched(),before);assert.deepEqual(history(f),publicBefore);
});

const corruptions={
  'missing private draft':f=>f.sqlite.prepare('DELETE FROM private_content WHERE content_id=?').run(f.prepared.plan.draftId),
  'changed draft owner':f=>f.sqlite.prepare("UPDATE private_content SET owner_id='other' WHERE content_id=?").run(f.prepared.plan.draftId),
  'changed draft kind':f=>f.sqlite.prepare("UPDATE private_content SET kind='other' WHERE content_id=?").run(f.prepared.plan.draftId),
  'changed draft expiry':f=>f.sqlite.prepare("UPDATE private_content SET expires_at='2026-01-01T00:00:00.000Z' WHERE content_id=?").run(f.prepared.plan.draftId),
  'changed unredacted draft bytes':f=>f.sqlite.prepare("UPDATE private_content SET content='{}' WHERE content_id=?").run(f.prepared.plan.draftId),
  'false draft redaction marker with retained bytes':f=>f.sqlite.prepare("UPDATE private_content SET redacted_at='2026-01-01T00:00:00.000Z' WHERE content_id=?").run(f.prepared.plan.draftId),
  'missing original event body':(f,c)=>f.sqlite.prepare('DELETE FROM event_private_payloads WHERE private_event_id=?').run(c.eventIds[0]),
  'changed private event owner':(f,c)=>f.sqlite.prepare("UPDATE event_private_payloads SET owner_id='other' WHERE private_event_id=?").run(c.eventIds[0]),
  'changed private event project':(f,c)=>f.sqlite.prepare("UPDATE event_private_payloads SET project_id='other' WHERE private_event_id=?").run(c.eventIds[0]),
  'changed private event Document':(f,c)=>f.sqlite.prepare("UPDATE event_private_payloads SET document_id='other' WHERE private_event_id=?").run(c.eventIds[0]),
  'changed unredacted event bytes':(f,c)=>f.sqlite.prepare("UPDATE event_private_payloads SET private_json='{}' WHERE private_event_id=?").run(c.eventIds[0]),
  'partially erased event with missing redaction marker':(f,c)=>f.sqlite.prepare("UPDATE event_private_payloads SET private_json='' WHERE private_event_id=?").run(c.eventIds[0]),
  'false event redaction marker with retained bytes':(f,c)=>f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at='2026-01-01T00:00:00.000Z' WHERE private_event_id=?").run(c.eventIds[0]),
  'missing original client receipt':(f,c)=>f.sqlite.prepare('DELETE FROM event_client_receipts WHERE event_id=?').run(c.eventIds[0]),
  'changed original public envelope':(f,c)=>corrupt(f,'events',"UPDATE events SET payload='{}' WHERE event_id=?",c.eventIds[0]),
  'public private reference redirected to a sibling':(f,c)=>{
    const publicPayload=JSON.parse(f.sqlite.prepare('SELECT payload FROM events WHERE event_id=?').get(c.eventIds[0]).payload);
    publicPayload._private_ref=c.eventIds[1];corrupt(f,'events','UPDATE events SET payload=? WHERE event_id=?',JSON.stringify(publicPayload),c.eventIds[0]);
  },
  'changed original actor':(f,c)=>corrupt(f,'events',"UPDATE events SET actor='other' WHERE event_id=?",c.eventIds[0]),
  'changed original stream':(f,c)=>corrupt(f,'events',"UPDATE events SET stream_id='creative:other' WHERE event_id=?",c.eventIds[0]),
  'changed original client':(f,c)=>corrupt(f,'events',"UPDATE events SET client_id='other' WHERE event_id=?",c.eventIds[0]),
  'changed original correlation':(f,c)=>corrupt(f,'events',"UPDATE events SET correlation_id='other' WHERE event_id=?",c.eventIds[0]),
  'changed original schema':(f,c)=>corrupt(f,'events','UPDATE events SET schema_version=2 WHERE event_id=?',c.eventIds[0]),
  'changed original sequence':(f,c)=>corrupt(f,'events','UPDATE events SET sequence=100 WHERE event_id=?',c.eventIds[0]),
  'duplicate IDs in immutable commit receipt':(f,c)=>corrupt(f,'experience_guest_source_commits','UPDATE experience_guest_source_commits SET event_ids_json=? WHERE session_id=?',
    JSON.stringify(c.eventIds.map(()=>c.eventIds[0])),f.session.sessionId),
  'oversized immutable event count':f=>corrupt(f,'experience_guest_sources','UPDATE experience_guest_sources SET event_count=17 WHERE session_id=?',f.session.sessionId),
  'source/session policy digest mismatch':f=>corrupt(f,'experience_guest_sources','UPDATE experience_guest_sources SET policy_digest=? WHERE session_id=?',`sha256:${'a'.repeat(64)}`,f.session.sessionId),
  'session/terms digest mismatch':f=>corrupt(f,'experience_guest_sessions','UPDATE experience_guest_sessions SET terms_digest=? WHERE session_id=?',`sha256:${'a'.repeat(64)}`,f.session.sessionId),
  'source policy review witness missing':f=>corrupt(f,'experience_guest_source_policies',"UPDATE experience_guest_source_policies SET review_digest='invalid'"),
};
for(const [name,damage] of Object.entries(corruptions))test(`${name} refuses all cleanup without partial erasure`,async t=>{
  const f=await fixture(t),committed=await f.commit();damage(f,committed);const before=privateRows(f),publicBefore=history(f);await expire(f);
  await assert.rejects(f.retire(),unavailable);assert.deepEqual(privateRows(f),before);assert.deepEqual(history(f),publicBefore);f.unpaid();
});

const scopes={
  'draft project resource scope':f=>f.sqlite.prepare('INSERT INTO project_resource_scopes VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run('access','content',f.prepared.plan.draftId,'organization',f.session.projectId,'other','collaborative_output',null,'other','2026-01-01T00:00:00.000Z'),
  'Document project resource scope':f=>f.sqlite.prepare('INSERT INTO project_resource_scopes VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run('access','document',f.session.documentId,'organization',f.session.projectId,'other','collaborative_output',null,'other','2026-01-01T00:00:00.000Z'),
  'draft retention scope':f=>f.sqlite.prepare('INSERT INTO private_content_retention_scopes VALUES(?,?,?,?,?,?,?,?,?)')
    .run(f.prepared.plan.draftId,'organization','access',f.session.projectId,'other','test',1,f.prepared.expiresAt,'2026-01-01T00:00:00.000Z'),
  'native project event scope':(f,c)=>f.sqlite.prepare('INSERT INTO project_event_scopes VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(c.eventIds[0],'access','organization',f.session.projectId,'other',`creative:${f.session.guestSubject}`,1,1,'other','2026-01-01T00:00:00.000Z'),
  'organization project custody':f=>f.sqlite.prepare('INSERT INTO organization_projects VALUES(?,?,?,?,?,?,?)')
    .run('access',f.session.projectId,'organization','other','active','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'),
};
for(const [name,assign] of Object.entries(scopes))test(`${name} excludes the source from guest retirement`,async t=>{
  const f=await fixture(t),committed=await f.commit();assign(f,committed);const before=privateRows(f),publicBefore=history(f);await expire(f);
  await assert.rejects(f.retire(),unavailable);assert.deepEqual(privateRows(f),before);assert.deepEqual(history(f),publicBefore);
});

const memoryMigrations={native:'0027_memory_native_origins.sql',structured:'0033_memory_structured_answer_provenance.sql',job:'0034_memory_document_job_origins.sql'};
function installMemorySchema(f,kind){f.sqlite.exec(readFileSync(new URL(`../drizzle/${memoryMigrations[kind]}`,import.meta.url),'utf8'));}
function insertMemoryRegistration(f,kind,slot='answer_content_id',value=f.prepared.plan.draftId){
  const hash='a'.repeat(64),created='2026-01-01T00:00:00.000Z',expires='2026-01-02T00:00:00.000Z';
  const actor=f.session.guestSubject,project=f.session.projectId,document=f.session.documentId,scope=JSON.stringify(['','',project,document]);
  const shared={origin_id:`fixture-${kind}-origin`,schema_version:1,actor_user_id:actor,scope_key:scope,turn_id:`fixture-${kind}-turn`,
    user_event_id:`fixture-${kind}-user-event`,user_content_id:`fixture-${kind}-user-content`,answer_event_id:`fixture-${kind}-answer-event`,
    answer_content_id:`fixture-${kind}-answer-content`,manifest_content_ref:`fixture-${kind}-manifest`,[slot]:value};
  let table,row;
  if(kind==='job'){
    table='memory_document_job_answer_origins';row={...shared,recipe_version:'native-document-job-answer-origin-v1',job_id:'fixture-job',
      status:'minimized',withdrawn_at:created,withdrawal_reason:'erased'};
  }else if(kind==='structured'){
    table='memory_structured_answer_origins';row={...shared,recipe_version:'native-structured-answer-origin-v1',owner_user_id:actor,
      project_id:project,document_id:document,user_source_sequence:2,user_sha256:hash,answer_source_sequence:3,answer_sha256:hash,
      answer_expires_at:expires,enrollment_id:'fixture-enrollment',enrollment_revision:1,permission_epoch:'fixture-epoch',policy_version:'fixture-policy',
      enrolled_at:created,enrollment_expires_at:expires,retention_days:1,source_head:1,ledger_id:hash,ledger_storage_revision:1,
      ledger_body_ref:'fixture-ledger-body',ledger_body_sha256:hash,consumed_context_sha256:hash,source_list_sha256:hash,source_count:2,
      ledger_history_sha256:hash,ledger_revision_count:1,manifest_sha256:hash,manifest_expires_at:expires,source_retention_ceiling:expires,
      created_at:created,status:'active'};
  }else{
    table='memory_native_answer_origins';
    row=Object.fromEntries(f.sqlite.prepare(`PRAGMA table_info(${table})`).all().filter(column=>column.notnull).map(column=>
      [column.name,column.type.toLowerCase()==='integer'?1:column.name.endsWith('_sha256')?hash:`fixture-${column.name}`]));
    Object.assign(row,{...shared,recipe_version:'native-answer-origin-v1',owner_user_id:actor,project_id:project,document_id:document,
      user_source_sequence:2,answer_source_sequence:3,selection_cursor:1,answer_expires_at:expires,enrolled_at:created,enrollment_expires_at:expires,
      source_retention_ceiling:expires,created_at:created,status:'active'});delete row.manifest_content_ref;
  }
  const keys=Object.keys(row);f.sqlite.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...Object.values(row));
}
function memoryMarker(f,version=1){
  const now='2026-01-01T00:00:00.000Z';f.sqlite.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,NULL,NULL,1,?,?)').run(
    crypto.randomUUID(),'creative:memory-boundary-fixture',1,now,now,'worker:memory','fixture:memory','fixture-memory-origin','AssistantReasoned',
    JSON.stringify({content_ref:f.prepared.plan.draftId,memory_origin_version:version}));
}
test('native memory complete empty migrations preserve ordinary due guest cleanup',async t=>{
  const f=await fixture(t),committed=await f.commit();for(const kind of ['native','structured','job'])installMemorySchema(f,kind);
  const before=history(f);await expire(f);const depth=enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}});
  try{expectRetired(f,await f.retire(),committed.eventIds.length,false);depth.assertVerified();
    t.diagnostic(JSON.stringify({schema:'complete',maxBindings:Math.max(...depth.boundCounts),maxSqlBytes:Math.max(...depth.records.map(r=>r.statementBytes)),qualifiedQueries:depth.records.length}));
  }finally{depth.restore();}
  assert.deepEqual(history(f),before);
});
for(const kind of ['structured','job'])for(const slot of ['user_content_id','answer_content_id','manifest_content_ref'])
  test(`native memory ${kind} ${slot} registration excludes a retyped draft from retirement`,async t=>{
    const f=await fixture(t);await f.commit();installMemorySchema(f,kind);insertMemoryRegistration(f,kind,slot);
    const before=privateRows(f),publicBefore=history(f);await expire(f);await assert.rejects(f.retire(),unavailable);
    assert.deepEqual(privateRows(f),before);assert.deepEqual(history(f),publicBefore);f.unpaid();
  });
test('native memory legacy answer registration excludes a retyped draft despite absent manifest evidence',async t=>{
  const f=await fixture(t);await f.commit();installMemorySchema(f,'native');insertMemoryRegistration(f,'native');
  const before=privateRows(f);await expire(f);await assert.rejects(f.retire(),unavailable);assert.deepEqual(privateRows(f),before);
});
for(const [name,version] of [['valid',1],['malformed',{unknown:true}],['null',null]])
  test(`native memory ${name} immutable public marker excludes a retyped draft`,async t=>{
    const f=await fixture(t);await f.commit();memoryMarker(f,version);const before=privateRows(f),publicBefore=history(f);
    await expire(f);await assert.rejects(f.retire(),unavailable);assert.deepEqual(privateRows(f),before);assert.deepEqual(history(f),publicBefore);
  });
test('native memory partial structured schema cannot authorize guest cleanup',async t=>{
  const f=await fixture(t);await f.commit();f.sqlite.exec('CREATE TABLE memory_structured_answer_origins(origin_id TEXT,answer_content_id TEXT)');
  const before=privateRows(f);await expire(f);await assert.rejects(f.retire(),unavailable);assert.deepEqual(privateRows(f),before);
});
test('native memory partial document-job schema cannot authorize guest cleanup',async t=>{
  const f=await fixture(t);await f.commit();f.sqlite.exec('CREATE TABLE memory_document_job_answer_origins(origin_id TEXT,answer_content_id TEXT)');
  const before=privateRows(f);await expire(f);await assert.rejects(f.retire(),unavailable);assert.deepEqual(privateRows(f),before);
});
test('native memory legacy schema missing required origin columns cannot authorize guest cleanup',async t=>{
  const f=await fixture(t);await f.commit();f.sqlite.exec('CREATE TABLE memory_native_answer_origins(origin_id TEXT,answer_content_id TEXT)');
  const before=privateRows(f);await expire(f);await assert.rejects(f.retire(),unavailable);assert.deepEqual(privateRows(f),before);
});
for(const kind of ['native','structured','job'])for(const slot of ['user_event_id','answer_event_id'])
  test(`native memory ${kind} original ${slot} registration excludes guest private event copies`,async t=>{
    const f=await fixture(t),committed=await f.commit();installMemorySchema(f,kind);insertMemoryRegistration(f,kind,slot,committed.eventIds[0]);
    const before=privateRows(f),publicBefore=history(f);await expire(f);await assert.rejects(f.retire(),unavailable);
    assert.deepEqual(privateRows(f),before);assert.deepEqual(history(f),publicBefore);
  });
test('native memory original event registration arriving before retirement invalidates the atomic proof',async t=>{
  const f=await fixture(t),committed=await f.commit();installMemorySchema(f,'job');await expire(f);
  const before=privateRows(f),batch=f.DB.batch;let changed=false;
  f.DB.batch=async statements=>{if(!changed&&retirementBatch(statements)){changed=true;insertMemoryRegistration(f,'job','answer_event_id',committed.eventIds[0]);}
    return batch.call(f.DB,statements);};
  await assert.rejects(f.retire(),unavailable);f.DB.batch=batch;assert.equal(changed,true);assert.deepEqual(privateRows(f),before);
});
for(const change of ['registration','schema'])test(`native memory ${change} arriving just before retirement invalidates the atomic proof`,async t=>{
  const f=await fixture(t);await f.commit();if(change==='registration')installMemorySchema(f,'structured');await expire(f);
  const before=privateRows(f),batch=f.DB.batch;let changed=false;
  f.DB.batch=async statements=>{if(!changed&&retirementBatch(statements)){changed=true;
    if(change==='registration')insertMemoryRegistration(f,'structured');else installMemorySchema(f,'structured');}return batch.call(f.DB,statements);};
  await assert.rejects(f.retire(),unavailable);f.DB.batch=batch;assert.equal(changed,true);assert.deepEqual(privateRows(f),before);
});
test('native memory registration arriving after successful cleanup prevents completion acknowledgement',async t=>{
  const f=await fixture(t);await f.commit();installMemorySchema(f,'structured');await expire(f);const batch=f.DB.batch;let changed=false;
  f.DB.batch=async statements=>{const result=await batch.call(f.DB,statements);if(!changed&&retirementBatch(statements)){changed=true;insertMemoryRegistration(f,'structured');}return result;};
  await assert.rejects(f.retire(),unavailable);f.DB.batch=batch;assert.equal(changed,true);
});

test('unknown session and malformed retirement input cannot select private records',async t=>{
  const f=await fixture(t),before=privateRows(f);
  for(const input of [{sessionId:'missing'},{sessionId:f.session.sessionId,draftId:f.prepared.plan.draftId},{sessionId:''},{sessionId:1},null])
    await assert.rejects(retireExpiredGuestImageSource(f.env,input),unavailable);
  assert.deepEqual(privateRows(f),before);
});
test('a failure after cleanup statements rolls back the draft and every private event',async t=>{
  const f=await fixture(t);await f.commit();await expire(f);const before=privateRows(f),publicBefore=history(f),batch=f.DB.batch;let injected=false;
  f.DB.batch=async statements=>{if(!retirementBatch(statements))return batch.call(f.DB,statements);
    injected=true;return batch.call(f.DB,[...statements,f.DB.prepare('INSERT INTO experience_guest_source_assertions VALUES(?,0)').bind('forced-rollback')]);};
  await assert.rejects(f.retire(),unavailable);f.DB.batch=batch;assert.equal(injected,true);
  assert.deepEqual(privateRows(f),before);assert.deepEqual(history(f),publicBefore);
});
test('custody reassignment immediately before the atomic batch fails closed',async t=>{
  const f=await fixture(t);await f.commit();await expire(f);const batch=f.DB.batch;let changed=false,before;
  f.DB.batch=async statements=>{if(!changed&&retirementBatch(statements)){changed=true;f.sqlite.prepare("UPDATE private_content SET owner_id='new-owner' WHERE content_id=?").run(f.prepared.plan.draftId);before=privateRows(f);}
    return batch.call(f.DB,statements);};
  await assert.rejects(f.retire(),unavailable);f.DB.batch=batch;assert.equal(changed,true);assert.deepEqual(privateRows(f),before);
});
test('a project event scope appearing immediately before the batch blocks every redaction',async t=>{
  const f=await fixture(t),committed=await f.commit();await expire(f);const before=privateRows(f),batch=f.DB.batch;let changed=false;
  f.DB.batch=async statements=>{if(!changed&&retirementBatch(statements)){changed=true;scopes['native project event scope'](f,committed);}return batch.call(f.DB,statements);};
  await assert.rejects(f.retire(),unavailable);f.DB.batch=batch;assert.equal(changed,true);assert.deepEqual(privateRows(f),before);
});
test('a native draft retention assignment immediately before the batch blocks every redaction',async t=>{
  const f=await fixture(t);await f.commit();await expire(f);const before=privateRows(f),batch=f.DB.batch;let changed=false;
  f.DB.batch=async statements=>{if(!changed&&retirementBatch(statements)){changed=true;scopes['draft retention scope'](f);}return batch.call(f.DB,statements);};
  await assert.rejects(f.retire(),unavailable);f.DB.batch=batch;assert.equal(changed,true);assert.deepEqual(privateRows(f),before);
});
test('database replacement after a receipt read denies cleanup before any batch',async t=>{
  const f=await fixture(t);await f.commit();await expire(f);const before=privateRows(f),prepare=f.DB.prepare;let swapped=false;
  f.DB.prepare=function(sql){const statement=prepare.call(this,sql),bind=statement.bind;
    statement.bind=function(...args){const bound=bind.call(this,...args),first=bound.first;
      bound.first=async function(){const result=await first.call(this);if(!swapped&&sql.includes('experience_guest_sources')){swapped=true;f.env.DB={...f.DB};}return result;};return bound;};return statement;};
  await assert.rejects(f.retire(),dbChanged);assert.equal(swapped,true);assert.deepEqual(privateRows(f),before);
});
test('database replacement after cleanup never acknowledges a different database',async t=>{
  const f=await fixture(t),committed=await f.commit();await expire(f);const batch=f.DB.batch;let swapped=false;
  f.DB.batch=async statements=>{const result=await batch.call(f.DB,statements);if(retirementBatch(statements)){swapped=true;f.env.DB={...f.DB};}return result;};
  await assert.rejects(f.retire(),dbChanged);f.DB.batch=batch;f.env.DB=f.DB;assert.equal(swapped,true);
  expectRetired(f,await f.retire(),committed.eventIds.length,true);
});
test('successful batch acknowledgement still requires the unchanged native custody postcondition',async t=>{
  const f=await fixture(t),committed=await f.commit();await expire(f);const before=history(f),batch=f.DB.batch;let changed=false;
  f.DB.batch=async statements=>{const result=await batch.call(f.DB,statements);if(retirementBatch(statements)){changed=true;
    f.sqlite.prepare("UPDATE event_private_payloads SET owner_id='new-owner' WHERE private_event_id=?").run(committed.eventIds[0]);}return result;};
  await assert.rejects(f.retire(),unavailable);f.DB.batch=batch;assert.equal(changed,true);assert.deepEqual(history(f),before);
  const body=f.sqlite.prepare('SELECT * FROM event_private_payloads WHERE private_event_id=?').get(committed.eventIds[0]);
  assert.equal(body.owner_id,'new-owner');assert.equal(body.private_json,'');assert.ok(body.redacted_at);
});
const postconditionChanges={
  'draft creation timestamp drift':{after:(f)=>f.sqlite.prepare("UPDATE private_content SET created_at='2025-01-01T00:00:00.000Z' WHERE content_id=?").run(f.prepared.plan.draftId)},
  'preexisting draft redaction timestamp rewrite':{
    before:f=>f.sqlite.prepare("UPDATE private_content SET content='',redacted_at='2026-01-01T00:00:00.000Z' WHERE content_id=?").run(f.prepared.plan.draftId),
    after:f=>f.sqlite.prepare("UPDATE private_content SET redacted_at='2026-02-01T00:00:00.000Z' WHERE content_id=?").run(f.prepared.plan.draftId)},
  'preexisting event redaction timestamp rewrite':{
    before:(f,c)=>f.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at='2026-01-01T00:00:00.000Z' WHERE private_event_id=?").run(c.eventIds[0]),
    after:(f,c)=>f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at='2026-02-01T00:00:00.000Z' WHERE private_event_id=?").run(c.eventIds[0])},
  'malformed newly written draft redaction timestamp':{after:f=>f.sqlite.prepare("UPDATE private_content SET redacted_at='not-a-time' WHERE content_id=?").run(f.prepared.plan.draftId)},
  'malformed newly written event redaction timestamp':{after:(f,c)=>f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at='not-a-time' WHERE private_event_id=?").run(c.eventIds[0])},
};
for(const [name,change] of Object.entries(postconditionChanges))test(`successful ACK with ${name} cannot acknowledge retirement`,async t=>{
  const f=await fixture(t),committed=await f.commit();change.before?.(f,committed);await expire(f);
  const before=history(f),batch=f.DB.batch;let changed=false;
  f.DB.batch=async statements=>{const result=await batch.call(f.DB,statements);if(retirementBatch(statements)){changed=true;change.after(f,committed);}return result;};
  await assert.rejects(f.retire(),unavailable);f.DB.batch=batch;assert.equal(changed,true);assert.deepEqual(history(f),before);
});
test('erased draft permits due original-association cleanup without claiming unavailable original private-byte proof',async t=>{
  const f=await fixture(t),committed=await f.commit();
  const body=f.sqlite.prepare("SELECT body.* FROM event_private_payloads body JOIN events event ON event.event_id=body.private_event_id WHERE event.type='BlockCreated' AND body.private_json LIKE '%A blue heron on a stone bridge%'").get();
  assert.ok(body,'native authored BlockCreated payload exists');
  f.sqlite.prepare("UPDATE private_content SET content='',redacted_at='2026-01-01T00:00:00.000Z' WHERE content_id=?").run(f.prepared.plan.draftId);
  const changed=body.private_json.replace('A blue heron on a stone bridge','A gray heron on a stone bridge');assert.notEqual(changed,body.private_json);
  f.sqlite.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run(changed,body.private_event_id);
  const before=history(f);await expire(f);expectRetired(f,await f.retire(),committed.eventIds.length,false);assert.deepEqual(history(f),before);
});
test('lost cleanup acknowledgement recovers the original redaction without rewriting its history',async t=>{
  const f=await fixture(t),committed=await f.commit();await expire(f);const before=history(f),batch=f.DB.batch;let lost=false,erased;
  f.DB.batch=async statements=>{const result=await batch.call(f.DB,statements);if(!lost&&retirementBatch(statements)){lost=true;erased=privateRows(f);throw Error('lost cleanup acknowledgement');}return result;};
  expectRetired(f,await f.retire(),committed.eventIds.length,true);f.DB.batch=batch;assert.equal(lost,true);
  assert.deepEqual(privateRows(f),erased);assert.deepEqual(history(f),before);
});
test('database replacement during lost-ack recovery cannot acknowledge the replacement database',async t=>{
  const f=await fixture(t);await f.commit();await expire(f);const batch=f.DB.batch,prepare=f.DB.prepare;let lost=false,swapped=false,erased;
  f.DB.batch=async statements=>{const result=await batch.call(f.DB,statements);if(!lost&&retirementBatch(statements)){lost=true;erased=privateRows(f);throw Error('lost acknowledgement');}return result;};
  f.DB.prepare=function(sql){const statement=prepare.call(this,sql),bind=statement.bind;
    statement.bind=function(...args){const bound=bind.call(this,...args),first=bound.first;
      bound.first=async function(){const result=await first.call(this);if(lost&&!swapped){swapped=true;f.env.DB={...f.DB};}return result;};return bound;};return statement;};
  await assert.rejects(f.retire(),dbChanged);assert.equal(lost,true);assert.equal(swapped,true);assert.deepEqual(privateRows(f),erased);
});
test('a source commit paused before its transaction cannot resurrect a draft retired at expiry',async t=>{
  const f=await fixture(t),batch=f.DB.batch;let release,arrived;
  const atCommit=new Promise(resolve=>{arrived=resolve;}),resume=new Promise(resolve=>{release=resolve;});
  f.DB.batch=async statements=>{
    if(statements.some(statement=>statement.sql.includes('INSERT INTO experience_guest_source_commits'))){arrived();await resume;}
    return batch.call(f.DB,statements);
  };
  const committing=f.commit();committing.catch(()=>{});
  try{
    await atCommit;await expire(f);expectRetired(f,await f.retire(),0,false);release();await assert.rejects(committing);
    assert.equal(rows(f,'events').length,0);assert.equal(rows(f,'event_private_payloads').length,0);
    assert.equal(rows(f,'event_client_receipts').length,0);assert.equal(rows(f,'experience_guest_source_commits').length,0);
    expectRetired(f,await f.retire(),0,true);
  }finally{release();f.DB.batch=batch;}
});
test('concurrent retirement attempts converge on the same original redaction',async t=>{
  const f=await fixture(t),committed=await f.commit();await expire(f);const before=history(f),results=await Promise.all([f.retire(),f.retire()]);
  assert.equal(results.length,2);for(const result of results)expectRetired(f,result,committed.eventIds.length,result.replayed);
  assert.ok(results.some(result=>result.replayed===false));assert.deepEqual(history(f),before);
});

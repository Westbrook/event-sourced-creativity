import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { after, test } from 'node:test';

const workspaceRoot=new URL('../',import.meta.url).href;
const sourceResolution=registerHooks({resolve(specifier,context,nextResolve){
  const workspaceSource=typeof context.parentURL==='string'&&context.parentURL.startsWith(workspaceRoot)&&!context.parentURL.includes('/node_modules/');
  return nextResolve(workspaceSource&&specifier.startsWith('.')&&!/\.[a-z0-9]+$/i.test(specifier)?`${specifier}.ts`:specifier,context);
}});
after(()=>sourceResolution.deregister());
const { preparePersonalSlidesPrivateContentPair, DURABLE_WORK_RETENTION_END } = await import('../worker/private-content-storage.ts');

// Actual source and actual SQLite SQL. This is preparation/cleanup qualification,
// not a Worker, provider, financial, publication or deployed D1 acceptance test.
const owner = 'synthetic-personal-slides-owner';
const artifact = '{"title":"Synthetic retained Slides"}';
const input = '{"source":"Synthetic context blocks"}';

function fixture(context) {
  const sqlite = new DatabaseSync(':memory:');
  context.after(() => sqlite.close());
  sqlite.exec(`CREATE TABLE private_content (
    content_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, kind TEXT NOT NULL,
    content TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, redacted_at TEXT);
    CREATE TABLE project_resource_scopes(resource_kind TEXT,resource_id TEXT);
    CREATE TABLE events(event_id TEXT,type TEXT,payload TEXT,actor TEXT);`);
  const controls = { bindings: 0, batches: [], writes: 0, afterRead: null };
  class Statement {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) { assert.ok(values.length <= 100); return new Statement(this.sql, values); }
    execute() {
      const statement = sqlite.prepare(this.sql);
      if (/^\s*(?:SELECT|WITH)\b/iu.test(this.sql)) {
        return { success: true, results: statement.all(...this.values), meta: { changes: 0 } };
      }
      controls.writes++;
      return { success: true, results: [], meta: { changes: Number(statement.run(...this.values).changes) } };
    }
    async first() { throw new Error('Unexpected unbatched read'); }
    async all() { throw new Error('Unexpected unbatched read'); }
    async run() { throw new Error('Unexpected unbatched write'); }
  }
  const DB = {
    prepare(sql) { return new Statement(sql); },
    async batch(statements) {
      controls.bindings++;
      controls.batches.push(statements);
      sqlite.exec('BEGIN');
      let results;
      try { results = statements.map(statement => statement.execute()); sqlite.exec('COMMIT'); }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
      return controls.afterRead && statements.every(statement => /^\s*SELECT\b/iu.test(statement.sql))
        ? controls.afterRead(results) : results;
    },
  };
  const env = { DB, FORMA_EVIDENCE_RETENTION_DAYS: '17' };
  const prepare = () => preparePersonalSlidesPrivateContentPair(env, owner, artifact, input);
  const seed = (id, kind = 'prompt', actor = owner) => sqlite.prepare('INSERT INTO private_content VALUES(?,?,?,?,?,?,NULL)')
    .run(id, actor, kind, `body:${id}`, '2000-01-01T00:00:00.000Z', '2001-01-01T00:00:00.000Z');
  const row = id => sqlite.prepare('SELECT * FROM private_content WHERE content_id=?').get(id);
  const snapshot = () => sqlite.prepare('SELECT * FROM private_content ORDER BY content_id').all();
  return { sqlite, DB, env, controls, prepare, seed, row, snapshot };
}

function installMemorySchema(f) {
  for (const name of ['0033_memory_structured_answer_provenance.sql', '0034_memory_document_job_origins.sql']) {
    f.sqlite.exec(readFileSync(new URL('../drizzle/' + name, import.meta.url), 'utf8'));
  }
}

function assertReadOnlyPair(f) {
  assert.equal(f.controls.bindings, 1, 'one captured DB binding');
  assert.equal(f.controls.batches.length, 1);
  assert.equal(f.controls.batches[0].length, 6, 'both original three-query qualifications remain');
  assert.ok(f.controls.batches[0].every(statement => /^\s*SELECT\b/iu.test(statement.sql)));
  assert.equal(f.controls.writes, 0, 'preparation cannot write');
}

function cleanup(prepared) {
  const statements = prepared.statements.filter(statement => /^UPDATE private_content SET content=''/u.test(statement.sql));
  assert.equal(statements.length, 1, 'exactly the existing optional cleanup');
  return statements[0];
}

test('personal Slides pair prepares both fixed kinds with one six-query binding and retains both insert assertions', async context => {
  const f = fixture(context), before = f.snapshot();
  const pair = await f.prepare();
  assertReadOnlyPair(f);
  assert.deepEqual(f.snapshot(), before);
  assert.equal(pair.length, 2);
  assert.notEqual(pair[0].contentId, pair[1].contentId);
  assert.equal(pair[0].expiresAt, DURABLE_WORK_RETENTION_END);
  assert.equal(Date.parse(pair[1].expiresAt) - Date.parse(pair[1].createdAt), 17 * 86_400_000);
  assert.deepEqual(pair.map(prepared => prepared.requiredInserts), [1, 1]);
  assert.deepEqual(pair.map(prepared => prepared.statements.length), [2, 2]);
  const reads = f.controls.batches[0];
  for (const offset of [0, 3]) {
    assert.match(reads[offset].sql, /memory_structured_answer_origins/u);
    assert.match(reads[offset + 1].sql, /memory_document_job_answer_origins/u);
    assert.match(reads[offset + 2].sql, /AS origins.*AS turns/u);
  }
  const acknowledgements = await f.DB.batch(pair.flatMap(prepared => prepared.statements));
  assert.equal(acknowledgements[0].meta.changes, 1);
  assert.equal(acknowledgements[2].meta.changes, 1);
  for (const [index, kind, body] of [[0, 'document-artifact', artifact], [1, 'document-artifact-input', input]]) {
    const row = f.row(pair[index].contentId);
    assert.equal(row.owner_id, owner);
    assert.equal(row.kind, kind);
    assert.equal(row.content, body);
    assert.equal(row.expires_at, pair[index].expiresAt);
    assert.equal(row.redacted_at, null);
  }
});

test('personal Slides pair rejects invalid fixed inputs before database access', async () => {
  let touches = 0;
  const env = { get DB() { touches++; throw new Error('Invalid input touched the DB'); } };
  for (const args of [[null, artifact, input], ['', artifact, input], [{ ownerId: owner }, artifact, input],
    [owner, null, input], [owner, artifact, {}], [owner, ['artifact'], input]]) {
    await assert.rejects(preparePersonalSlidesPrivateContentPair(env, ...args));
  }
  assert.equal(touches, 0);
});

test('personal Slides pair refuses malformed outer batch acknowledgements in either triple', async context => {
  const faults = [
    ['missing', () => undefined], ['not-array', () => ({})],
    ['short', results => results.slice(0, 5)], ['long', results => [...results, results[0]]],
    ...Array.from({ length: 6 }, (_, index) => [
      [`sparse-${index}`, results => { delete results[index]; return results; }],
      [`failed-${index}`, results => { results[index].success = false; return results; }],
      [`error-${index}`, results => { results[index].error = 'uncertain'; return results; }],
    ]).flat(),
  ];
  for (const [label, fault] of faults) {
    const f = fixture(context);
    f.seed('untouched'); const before = f.snapshot();
    f.controls.afterRead = fault;
    await assert.rejects(f.prepare(), /memory_boundary_schema_unavailable/u, label);
    assertReadOnlyPair(f);
    assert.deepEqual(f.snapshot(), before, label);
  }
});

test('personal Slides pair refuses malformed auxiliary flags in either member', async context => {
  const faults = [
    ['missing-row', result => { result.results = []; }],
    ['extra-row', result => { result.results.push({ origins: 0, turns: 0 }); }],
    ['sparse-row', result => { delete result.results[0]; }],
    ['null-row', result => { result.results[0] = null; }],
    ['extra-key', result => { result.results[0].unexpected = 0; }],
    ['missing-origins', result => { delete result.results[0].origins; }],
    ['missing-turns', result => { delete result.results[0].turns; }],
    ['string-origins', result => { result.results[0].origins = '0'; }],
    ['boolean-turns', result => { result.results[0].turns = false; }],
    ['out-of-range', result => { result.results[0].origins = 2; }],
  ];
  for (const offset of [0, 3]) for (const [label, fault] of faults) {
    const f = fixture(context);
    f.controls.afterRead = results => { fault(results[offset + 2]); return results; };
    await assert.rejects(f.prepare(), /memory_boundary_schema_unavailable/u, `${offset}: ${label}`);
    assertReadOnlyPair(f);
  }
});

test('individual structured or job schema refusal omits only that member optional cleanup', async context => {
  const faults = [
    ['missing-row', result => { result.results = []; }],
    ['extra-key', result => { result.results[0].unexpected = true; }],
    ['malformed-json', result => { result.results[0].schema_json = '{}'; }],
    ['partial-schema', result => { result.results[0].schema_json = '[{"name":"partial"}]'; }],
  ];
  for (const member of [0, 1]) for (const schema of [0, 1]) for (const [label, fault] of faults) {
    const f = fixture(context);
    f.controls.afterRead = results => { fault(results[member * 3 + schema]); return results; };
    const pair = await f.prepare();
    assertReadOnlyPair(f);
    assert.equal(pair[member].statements.length, 1, `${member}/${schema}: ${label}`);
    assert.equal(pair[1 - member].statements.length, 2, 'other member still qualifies independently');
    assert.deepEqual(pair.map(prepared => prepared.requiredInserts), [1, 1]);
    assert.equal(pair[member].statements.some(statement => /^UPDATE /u.test(statement.sql)), false);
  }
});

test('an unavailable member cannot hide a malformed acknowledgement or flags in its sibling', async context => {
  for (const unavailable of [0, 1]) for (const fault of ['ack', 'flags']) {
    const f = fixture(context);
    f.controls.afterRead = results => {
      results[unavailable * 3].results[0].schema_json = '{}';
      const sibling = (1 - unavailable) * 3;
      if (fault === 'ack') results[sibling + 1].success = false;
      else results[sibling + 2].results[0].turns = '0';
      return results;
    };
    await assert.rejects(f.prepare(), /memory_boundary_schema_unavailable/u, `${unavailable}: ${fault}`);
    assertReadOnlyPair(f);
  }
});

test('personal Slides pair propagates batch failure without preparing a widened cleanup', async context => {
  const f = fixture(context), sentinel = new Error('Synthetic read transport failure');
  f.controls.afterRead = () => { throw sentinel; };
  await assert.rejects(f.prepare(), error => error === sentinel);
  assertReadOnlyPair(f);
});

test('personal Slides pair rejects DB replacement after the captured six-query batch', async context => {
  const f = fixture(context);
  f.controls.afterRead = results => { f.env.DB = { ...f.DB }; return results; };
  await assert.rejects(f.prepare(), /database_changed/u);
  assertReadOnlyPair(f);
});

for (const digestNumber of [1, 2, 3, 4]) test(`personal Slides pair rejects DB replacement during qualification digest ${digestNumber}`, async context => {
  const f = fixture(context);
  installMemorySchema(f);
  const original = crypto.subtle.digest.bind(crypto.subtle);
  let digests = 0;
  context.mock.method(crypto.subtle, 'digest', async (...args) => {
    const result = await original(...args);
    if (++digests === digestNumber) f.env.DB = { ...f.DB };
    return result;
  });
  await assert.rejects(f.prepare(), /database_changed/u);
  assert.ok(digests >= digestNumber, 'target qualification await was reached');
  assertReadOnlyPair(f);
});

test('personal Slides pair owns both observations before an asynchronous schema fingerprint', async context => {
  const f = fixture(context);
  installMemorySchema(f);
  f.seed('ordinary');
  let returned;
  f.controls.afterRead = results => { returned = results; return results; };
  const original = crypto.subtle.digest.bind(crypto.subtle);
  let mutated = false;
  context.mock.method(crypto.subtle, 'digest', async (...args) => {
    if (!mutated) {
      mutated = true;
      for (const offset of [0, 3]) {
        returned[offset].results[0].schema_json = '[]';
        returned[offset + 1].results[0].schema_json = '[]';
        returned[offset + 2].results[0].origins = 1;
        returned[offset + 2].results[0].turns = 1;
      }
    }
    return original(...args);
  });
  const pair = await f.prepare();
  assert.equal(mutated, true, 'mutation happened after batch return at the awaited fingerprint');
  assertReadOnlyPair(f);
  for (const prepared of pair) {
    assert.equal(cleanup(prepared).execute().meta.changes, 1, 'captured exact schema and absent auxiliary tables still qualify');
    f.sqlite.prepare("UPDATE private_content SET content='body:ordinary',redacted_at=NULL WHERE content_id='ordinary'").run();
  }
});

test('both cleanup guards retain absence witnesses across an additive native origin table', async context => {
  const f = fixture(context);
  f.seed('registered'); f.seed('ordinary');
  const stale = await f.prepare();
  assertReadOnlyPair(f);
  f.sqlite.exec(`CREATE TABLE memory_native_answer_origins(answer_content_id TEXT,actor_user_id TEXT,scope_key TEXT,turn_id TEXT);
    INSERT INTO memory_native_answer_origins VALUES('registered','actor','scope','turn')`);
  for (const prepared of stale) assert.equal(cleanup(prepared).execute().meta.changes, 0, 'stale absence cannot authorize cleanup');
  const fresh = await f.prepare();
  assert.equal(f.controls.bindings, 2, 'absence was not cached');
  for (const prepared of fresh) {
    assert.equal(cleanup(prepared).execute().meta.changes, 1);
    assert.equal(f.row('registered').content, 'body:registered');
    assert.equal(f.row('ordinary').content, '');
    f.sqlite.prepare("UPDATE private_content SET content='body:ordinary',redacted_at=NULL WHERE content_id='ordinary'").run();
  }
});

test('both cleanup guards freeze exact deployed migrations and later schema changes', async context => {
  const f = fixture(context);
  f.seed('ordinary');
  const absent = await f.prepare();
  installMemorySchema(f);
  for (const prepared of absent) assert.equal(cleanup(prepared).execute().meta.changes, 0);
  const exact = await f.prepare();
  assert.equal(cleanup(exact[0]).execute().meta.changes, 1, 'exact deployed schema remains usable');
  f.sqlite.prepare("UPDATE private_content SET content='body:ordinary',redacted_at=NULL").run();
  f.sqlite.exec('CREATE INDEX synthetic_changed_job_origin_schema ON memory_document_job_answer_origins(origin_id)');
  for (const prepared of exact) assert.equal(cleanup(prepared).execute().meta.changes, 0, 'exact witness rejects a later index');
  const changed = await f.prepare();
  assert.deepEqual(changed.map(prepared => prepared.statements.length), [1, 1], 'unavailable schema omits both optional cleanups');
  assert.equal(f.row('ordinary').content, 'body:ordinary');
});

test('both cleanups preserve owner, project, durable and public-marker exclusions', async context => {
  const f = fixture(context);
  for (const id of ['ordinary', 'marked', 'project']) f.seed(id);
  f.seed('foreign', 'prompt', 'other-owner');
  f.seed('durable', 'document-artifact');
  f.seed('memory-answer', 'chat-assistant-memory');
  f.sqlite.prepare('INSERT INTO project_resource_scopes VALUES(?,?)').run('content', 'project');
  f.sqlite.prepare('INSERT INTO events VALUES(?,?,?,?)').run('marker', 'AssistantReasoned', JSON.stringify({ memory_origin_version: 'malformed-but-present', content_ref: 'marked' }), 'user:other-owner');
  const pair = await f.prepare();
  for (const prepared of pair) {
    assert.equal(cleanup(prepared).execute().meta.changes, 1);
    assert.equal(f.row('ordinary').content, '');
    for (const id of ['marked', 'project', 'foreign', 'durable', 'memory-answer']) {
      assert.equal(f.row(id).content, `body:${id}`, id);
      assert.equal(f.row(id).redacted_at, null, id);
    }
    f.sqlite.prepare("UPDATE private_content SET content='body:ordinary',redacted_at=NULL WHERE content_id='ordinary'").run();
  }
});

test('both cleanups retain minimized job registrations and original event identity after retyping', async context => {
  const f = fixture(context);
  installMemorySchema(f);
  for (const id of ['ordinary', 'job-user', 'job-answer', 'job-manifest', 'repointed']) f.seed(id);
  f.sqlite.prepare(`INSERT INTO memory_document_job_answer_origins(
    origin_id,schema_version,recipe_version,actor_user_id,scope_key,job_id,turn_id,
    user_event_id,user_content_id,answer_event_id,answer_content_id,manifest_content_ref,status,withdrawn_at,withdrawal_reason)
    VALUES(?,1,'native-document-job-answer-origin-v1',?,?,?,?,?,?,?,?,?,'minimized',?,'erased')`)
    .run('origin', owner, '["","","project","document"]', 'job', 'turn',
      'original-user-event', 'job-user', 'original-answer-event', 'job-answer', 'job-manifest', '2000-01-01T00:00:00.000Z');
  f.sqlite.prepare('INSERT INTO events VALUES(?,?,?,?)')
    .run('original-answer-event', 'RetypedEvent', JSON.stringify({ content_ref: 'repointed' }), 'user:other-owner');
  const pair = await f.prepare();
  for (const prepared of pair) {
    assert.equal(cleanup(prepared).execute().meta.changes, 1);
    assert.equal(f.row('ordinary').content, '');
    for (const id of ['job-user', 'job-answer', 'job-manifest', 'repointed']) assert.equal(f.row(id).content, `body:${id}`);
    f.sqlite.prepare("UPDATE private_content SET content='body:ordinary',redacted_at=NULL WHERE content_id='ordinary'").run();
  }
});

test('both cleanups preserve repointed marked turns only for their exact personal scope tuple', async context => {
  const f = fixture(context);
  for (const id of ['ordinary', 'personal-linked', 'different-scope']) f.seed(id);
  f.sqlite.exec(`CREATE TABLE assistant_turns(
    actor_user_id TEXT,scope_key TEXT,turn_id TEXT,project_id TEXT,document_id TEXT,
    organization_id TEXT,project_access_id TEXT,user_content_ref TEXT,assistant_content_ref TEXT)`);
  const turn = f.sqlite.prepare('INSERT INTO assistant_turns VALUES(?,?,?,?,?,?,?,?,?)');
  turn.run(owner, '["","","project","document"]', 'turn', 'project', 'document', null, null, 'personal-linked', 'missing-answer');
  turn.run(owner, '["org","access","project","document"]', 'turn', 'project', 'document', 'org', 'access', 'different-scope', 'missing-other-answer');
  f.sqlite.prepare('INSERT INTO events VALUES(?,?,?,?)').run('marker', 'AssistantReasoned', JSON.stringify({
    memory_origin_version: 1, content_ref: 'original-answer', turn_id: 'turn', project_id: 'project',
    document_id: 'document', organization_id: null, project_access_id: null,
  }), `user:${owner}`);
  const pair = await f.prepare();
  for (const prepared of pair) {
    assert.equal(cleanup(prepared).execute().meta.changes, 2);
    assert.equal(f.row('personal-linked').content, 'body:personal-linked');
    assert.equal(f.row('ordinary').content, '');
    assert.equal(f.row('different-scope').content, '', 'same turn ID in another scope does not inherit the marker');
    for (const id of ['ordinary', 'different-scope']) {
      f.sqlite.prepare('UPDATE private_content SET content=?,redacted_at=NULL WHERE content_id=?').run(`body:${id}`, id);
    }
  }
});

const {nativePrivateContentCleanupEnvironment,nativePrivateContentCleanupExclusion}=await import('../worker/memory-native-boundary.ts');
const {preparePrivateContent}=await import('../worker/private-content-storage.ts');

test('execution-local cleanup reuses only an exact negative predicate and never shares mutable guards',async t=>{
 const f=fixture(t),local=nativePrivateContentCleanupEnvironment(f.env);f.seed('ordinary');
 const [first,second]=await Promise.all([nativePrivateContentCleanupExclusion(local),nativePrivateContentCleanupExclusion(local)]);
 assert.equal(f.controls.bindings,1);assert.equal(f.controls.batches[0].length,3);assert.deepEqual(first,second);first.bindings.length=0;
 const third=await nativePrivateContentCleanupExclusion(local);assert.deepEqual(third,second);
 const prepared=await preparePrivateContent(local,owner,'provider-response','synthetic response');await local.DB.batch(prepared.statements);
 assert.equal(f.row('ordinary').content,'');
 await nativePrivateContentCleanupExclusion(f.env);assert.equal(f.controls.bindings,3,'ordinary callers still observe a fresh schema');
 await nativePrivateContentCleanupExclusion(nativePrivateContentCleanupEnvironment(f.env));assert.equal(f.controls.bindings,4,'a new execution has its own read');
});

for(const fault of ['new-memory-marker','retyped-memory','schema-arrived','schema-changed'])test('execution-local optional cleanup preserves memory after '+fault,async t=>{
 const f=fixture(t);if(fault==='schema-changed')installMemorySchema(f);
 const local=nativePrivateContentCleanupEnvironment(f.env);await nativePrivateContentCleanupExclusion(local);f.seed('protected');
 if(fault==='new-memory-marker')f.sqlite.prepare("INSERT INTO events VALUES(?,'AssistantReasoned',?,'user:synthetic')").run('late-marker',JSON.stringify({memory_origin_version:3,content_ref:'protected'}));
 if(fault==='retyped-memory')f.sqlite.prepare("UPDATE private_content SET kind='chat-assistant-memory' WHERE content_id='protected'").run();
 if(fault==='schema-arrived')installMemorySchema(f);
 if(fault==='schema-changed')f.sqlite.exec('CREATE INDEX memory_structured_answer_origins_extra_cleanup_test ON memory_structured_answer_origins(status)');
 const prepared=await preparePrivateContent(local,owner,'provider-response','synthetic response');await local.DB.batch(prepared.statements);
 assert.equal(f.row('protected').content,'body:protected');assert.equal(f.row(prepared.contentId).content,'synthetic response');
 assert.equal(f.controls.bindings,2,'the UPDATE itself carries current schema and negative-origin conditions');
});

for(const during of [false,true])test('execution-local cleanup rejects database replacement '+during,async t=>{
 const f=fixture(t),local=nativePrivateContentCleanupEnvironment(f.env);
 if(during)f.controls.afterRead=rows=>{local.DB={...f.DB};return rows;};else{await nativePrivateContentCleanupExclusion(local);local.DB={...f.DB};}
 await assert.rejects(()=>nativePrivateContentCleanupExclusion(local),/database_changed/u);assert.equal(f.controls.writes,0);
});

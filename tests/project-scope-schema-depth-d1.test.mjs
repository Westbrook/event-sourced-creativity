import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { registerOutputSourceImports } from './output-server-test-helpers.mjs';

const imports = registerOutputSourceImports();
const { ensureSchema, makeEvent, EVENT_WRITE_COLUMNS, eventWriteBindings } = await import('../worker/runtime.ts');
const { synchronizeProjectScope } = await import('../worker/project-access.ts');
const { POLICY_VERSION } = await import('../worker/pilot-policy.ts');
const { nativeStructuredOriginMinimizedCondition, nativeStructuredOriginMinimizedIntegrity,
  NATIVE_STRUCTURED_ORIGIN_HEADER_COLUMNS, NATIVE_STRUCTURED_ORIGIN_RECIPE, NATIVE_STRUCTURED_ORIGIN_TOMBSTONE_COLUMNS,
  validateNativeStructuredOriginTombstone } = await import('../worker/memory-native-origin.ts');
const requireWrangler = createRequire(import.meta.resolve('wrangler'));
const { Miniflare, Log, LogLevel } = requireWrangler('miniflare');
test.after(() => imports.deregister());
const sha = sql => createHash('sha256').update(sql).digest('hex');
const migrations = ['0032_memory_structured_conversation_ledger.sql', '0033_memory_structured_answer_provenance.sql'];
const split = sql => sql.split('--> statement-breakpoint').map(part => part.trim()).filter(Boolean);
const schemaTables = ['memory_structured_conversation_heads', 'memory_structured_answer_origins'];

function observedDatabase(raw) {
  const statements = new WeakMap(), records = [], batches = [];
  const observed = { records, batches, beforeBatch: null, afterRead: null };
  function wrap(statement, sql, bindings = []) {
    const row = { statement, sql, bindings };
    const record = method => {
      assert.ok(bindings.length <= 100);
      assert.ok(Buffer.byteLength(sql) <= 100000);
      records.push({ method, sql, sqlBytes: Buffer.byteLength(sql), parameters: bindings.length, sha256: sha(sql) });
    };
    const wrapped = {
      bind(...args) { return wrap(statement.bind(...args), sql, args); },
      async all(...args) { record('all'); const result = await statement.all(...args); await observed.afterRead?.(row); return result; },
      async first(...args) { record('first'); const result = await statement.first(...args); await observed.afterRead?.(row); return result; },
      async run(...args) { record('run'); return statement.run(...args); },
    };
    statements.set(wrapped, row); return wrapped;
  }
  observed.DB = {
    prepare(sql) { return wrap(raw.prepare(sql), sql); },
    async batch(items) {
      const rows = items.map(item => { const row = statements.get(item); assert.ok(row); return row; });
      for (const row of rows) {
        assert.ok(row.bindings.length <= 100); assert.ok(Buffer.byteLength(row.sql) <= 100000);
        records.push({ method: 'batch', sql: row.sql, sqlBytes: Buffer.byteLength(row.sql), parameters: row.bindings.length, sha256: sha(row.sql) });
      }
      const native = rows.map(row => row.statement);
      await observed.beforeBatch?.(rows, native);
      const result = await raw.batch(native); batches.push(rows.map(row => row.sql)); return result;
    },
  };
  return observed;
}

async function rows(db, table) { return (await db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results; }
async function snapshot(db) {
  return Object.fromEntries(await Promise.all(['project_resource_scopes', 'project_event_scopes', 'project_migration_states']
    .map(async table => [table, await rows(db, table)])));
}
async function fixture(t, memory) {
  const directory = await mkdtemp(join(tmpdir(), 'forma-project-scope-depth-d1-')), egress = [];
  const mf = new Miniflare({ modules: true, compatibilityDate: '2026-05-15', host: '127.0.0.1', port: 0,
    script: "export default { fetch() { return new Response('Local D1 qualification only.', {status:404}); } };",
    d1Databases: ['Scope'], d1Persist: directory, log: new Log(LogLevel.NONE),
    outboundService: req => { egress.push(req.url); throw Error('External network forbidden'); },
  });
  t.after(async () => { await mf.dispose(); await rm(directory, { recursive: true, force: true }); assert.deepEqual(egress, []); });
  const raw = await mf.getD1Database('Scope'), observed = observedDatabase(raw), env = { DB: observed.DB };
  t.mock.method(globalThis, 'fetch', () => { egress.push('fetch'); throw Error('Provider/network forbidden'); });
  await ensureSchema(env);
  if (memory) for (const name of migrations) await raw.batch(split(await readFile(new URL('../drizzle/' + name, import.meta.url), 'utf8')).map(sql => raw.prepare(sql)));
  const now = new Date().toISOString(), scope = { organizationId: 'organization', projectAccessId: 'project-access', projectId: 'project', ownerUserId: 'owner' };
  const insert = (table, row) => raw.prepare(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(() => '?').join(',')})`).bind(...Object.values(row)).run();
  await insert('organizations', { organization_id: scope.organizationId, name: 'Depth test', owner_user_id: 'owner', status: 'active', created_at: now, updated_at: now });
  await insert('users', { user_id: 'owner', email: 'owner@example.invalid', display_name: 'owner', role: 'creator', consent_version: POLICY_VERSION, consented_at: now, created_at: now, updated_at: now });
  await insert('organization_memberships', { membership_id: 'organization-owner', organization_id: scope.organizationId, user_id: 'owner', role: 'member', status: 'active', invited_by_user_id: 'owner', accepted_at: now, created_at: now, updated_at: now });
  await insert('organization_projects', { project_access_id: scope.projectAccessId, organization_id: scope.organizationId, project_id: scope.projectId, owner_user_id: 'owner', status: 'active', created_at: now, updated_at: now });
  await insert('project_migration_states', { project_access_id: scope.projectAccessId, organization_id: scope.organizationId, owner_user_id: 'owner', status: 'active', last_owner_sequence: 0, updated_at: now });
  for (const [index, [type, payload]] of [['ProjectCreated', { project_id: scope.projectId, name: 'Project' }], ['DocumentCreated', { project_id: scope.projectId, document_id: 'document', title: 'Document' }]].entries()) {
    const event = makeEvent('creative:owner', index + 1, 'user:owner', 'fixture', 'fixture', type, payload);
    await raw.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) VALUES(${eventWriteBindings(event).map(() => '?').join(',')})`).bind(...eventWriteBindings(event)).run();
  }
  observed.records.length = 0; observed.batches.length = 0;
  return { raw, observed, env, scope, insert, now };
}

for (const memory of [false, true]) test(`actual workerd D1 synchronizes and takes the four-read fast path with ${memory ? 'full' : 'absent'} structured Memory schema`, { timeout: 90000 }, async t => {
  const f = await fixture(t, memory);
  assert.deepEqual(await synchronizeProjectScope(f.env, f.scope), { eventCount: 2, documentCount: 1 });
  assert.equal(f.observed.batches.length, 2, 'one scope chunk and activation both executed');
  for (const batch of f.observed.batches) for (const sql of [batch[0], batch.at(-1)]) assert.match(sql, /memory_structured_schema_changed.*END AS verified/su);
  assert.equal((await rows(f.raw, 'project_event_scopes')).length, 2);
  assert.equal((await rows(f.raw, 'project_migration_states'))[0].last_owner_sequence, 2);
  const before = await snapshot(f.raw);
  f.observed.records.length = 0; f.observed.batches.length = 0;
  assert.deepEqual(await synchronizeProjectScope(f.env, f.scope), { eventCount: 2, documentCount: 1 });
  assert.equal(f.observed.records.length, 4); assert.equal(f.observed.batches.length, 0);
  assert.ok(f.observed.records.every(row => row.method === 'all' || row.method === 'first'));
  assert.match(f.observed.records[2].sql, /END AS verified$/u);
  assert.match(f.observed.records[3].sql, /END AS origin_integrity,migration.status/u);
  assert.deepEqual(await snapshot(f.raw), before);
  t.diagnostic(JSON.stringify({ engine: 'Wrangler-pinned Miniflare/workerd D1', memory, queries: f.observed.records.map(({ method, sqlBytes, parameters, sha256 }) => ({ method, sqlBytes, parameters, sha256 })), egress: 0 }));
});

for (const memory of [false, true]) for (const phase of ['chunk', 'activation']) test(`actual D1 ${phase} final bookend rejects schema drift and rolls back that batch (${memory ? 'full' : 'absent'})`, { timeout: 90000 }, async t => {
  const f = await fixture(t, memory), initial = await snapshot(f.raw); let injections = 0, beforeBatch;
  f.observed.beforeBatch = async (items, native) => {
    const activation = items.some(row => row.sql.startsWith('INSERT INTO project_migration_states'));
    if (activation !== (phase === 'activation')) return;
    beforeBatch = await snapshot(f.raw); injections++;
    const sql = memory ? 'CREATE TRIGGER injected_schema_drift AFTER INSERT ON memory_structured_answer_origins BEGIN SELECT 1; END'
      : 'CREATE TABLE memory_structured_answer_origins(injected TEXT)';
    native.splice(native.length - 1, 0, f.raw.prepare(sql));
  };
  await assert.rejects(synchronizeProjectScope(f.env, f.scope), /malformed JSON/u);
  assert.equal(injections, 1); assert.deepEqual(await snapshot(f.raw), beforeBatch);
  assert.equal((await f.raw.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE name='injected_schema_drift'").first()).n, 0);
  if (!memory) assert.equal((await f.raw.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE name='memory_structured_answer_origins'").first()).n, 0);
  if (phase === 'chunk') assert.deepEqual(beforeBatch, initial, 'first chunk left no scopes');
  else {
    assert.equal(beforeBatch.project_event_scopes.length, 2, 'earlier committed chunk remains');
    assert.deepEqual(beforeBatch.project_migration_states, initial.project_migration_states, 'activation did not advance');
  }
});

for (const boundary of ['assertion', 'state']) for (const table of schemaTables) test(`actual D1 rejects post-observation schema drift in ${table} at the ${boundary} query before copying scopes`, { timeout: 90000 }, async t => {
  const f = await fixture(t, true), before = await snapshot(f.raw); let injected = false;
  f.observed.afterRead = async row => {
    const selected = boundary === 'assertion' ? row.sql.endsWith('AS schema_json') && row.sql.includes('memory_structured_answer_origins') : row.sql.endsWith('END AS verified');
    if (injected || !selected) return;
    injected = true;
    await f.raw.prepare(`CREATE TRIGGER observed_schema_drift AFTER INSERT ON ${table} BEGIN SELECT 1; END`).run();
  };
  await assert.rejects(synchronizeProjectScope(f.env, f.scope), /malformed JSON/u);
  assert.equal(injected, true); assert.deepEqual(await snapshot(f.raw), before); assert.equal(f.observed.batches.length, 0);
});

const columns = NATIVE_STRUCTURED_ORIGIN_HEADER_COLUMNS, retained = NATIVE_STRUCTURED_ORIGIN_TOMBSTONE_COLUMNS,
  recipe = NATIVE_STRUCTURED_ORIGIN_RECIPE, balancedCondition = nativeStructuredOriginMinimizedCondition,
  validateTombstone = validateNativeStructuredOriginTombstone;
// Reference SQLite only. The historical condition deliberately is not sent to
// D1/workerd, where its full project-scope composition exceeds depth 100.
// Recorded 2026-09-17 reference run: Node v24.16.0 / SQLite 3.53.0;
// 398 cases x 2 aliases = 796 old/new comparisons, 776 JS comparisons;
// 212 accepted, 584 rejected, 16 raw NULL outcomes. All assertions passed.
// The 20 omitted JS comparisons are invalid UTF-8 fixtures with lossy JS decoding.
const predicateDifferentialBase = '8baaccd1744f1399f402ddd03ae9e9d0c2d3ad9c';
const identities = ['origin_id', 'actor_user_id', 'turn_id', 'user_event_id',
  'answer_event_id', 'user_content_id', 'answer_content_id', 'manifest_content_ref'];
const reasons = ['source-unavailable', 'source-changed', 'source-expired',
  'enrollment-changed', 'access-withdrawn', 'erased', 'manual'];

function historicalCondition() {
  // Exact historical builder, pinned here so exported/shallow checkouts work.
  // Only TypeScript annotations/export markers were removed from 8baaccd1744f1399f402ddd03ae9e9d0c2d3ad9c.
  const invalid = () => { throw new Error('native_memory_origin_invalid'); };
const NATIVE_STRUCTURED_ORIGIN_HEADER_COLUMNS = ["origin_id", "schema_version", "recipe_version", "actor_user_id", "owner_user_id",
  "organization_id", "project_access_id", "project_id", "document_id", "scope_key", "turn_id", "user_event_id", "user_content_id",
  "user_source_sequence", "user_sha256", "answer_event_id", "answer_content_id", "answer_source_sequence", "answer_sha256", "answer_expires_at",
  "enrollment_id", "enrollment_revision", "permission_epoch", "policy_version", "enrolled_at", "enrollment_expires_at", "retention_days",
  "source_head", "ledger_id", "ledger_storage_revision", "ledger_body_ref", "ledger_body_sha256", "consumed_context_sha256",
  "source_list_sha256", "source_count", "ledger_history_sha256", "ledger_revision_count", "manifest_content_ref", "manifest_sha256",
  "manifest_expires_at", "source_retention_ceiling", "created_at", "status", "withdrawn_at", "withdrawal_reason"]         ;
const NATIVE_STRUCTURED_ORIGIN_TOMBSTONE_COLUMNS = ["origin_id", "schema_version", "recipe_version", "actor_user_id", "scope_key", "turn_id",
  "user_event_id", "user_content_id", "answer_event_id", "answer_content_id", "manifest_content_ref", "status", "withdrawn_at", "withdrawal_reason"]         ;
const NATIVE_STRUCTURED_ORIGIN_RECIPE = "native-structured-answer-origin-v1";
function nativeStructuredOriginMinimizedCondition(alias                         = "origin") 
                                                            {
  if (alias !== "origin" && alias !== "tombstone") return invalid();
  const scope = `${alias}.scope_key`;
  // TEXT length/substr can stop at NUL. Walk the original UTF-8 bytes instead,
  // counting at most 240 UTF-16 units, including NUL and supplementary scalars.
  // Accept only an exact byte-end after validated, positive-width steps.
  const safeId = (value        ) => {
    const blob = `CAST(${value} AS BLOB)`;
    const widthAt = (position        ) => {
      const lead = `hex(substr(${blob},${position},1))`;
      return `(CASE WHEN ${lead} BETWEEN '00' AND '7F' THEN 1 WHEN ${lead} BETWEEN 'C2' AND 'DF' THEN 2
        WHEN ${lead} BETWEEN 'E0' AND 'EF' THEN 3 WHEN ${lead} BETWEEN 'F0' AND 'F4' THEN 4 ELSE 0 END)`;
    };
    const scalar = `substr(${blob},position,width)`;
    const code = `(CASE WHEN ${scalar}=X'00' THEN 0 ELSE unicode(CAST(${scalar} AS TEXT)) END)`;
    return `(CASE WHEN typeof(${value})='text' AND length(${blob}) BETWEEN 1 AND 960
      THEN (WITH RECURSIVE id_positions(position,units,width) AS(SELECT 1,0,${widthAt("1")} UNION ALL
        SELECT position+width,units+CASE WHEN ${code}>65535 THEN 2 ELSE 1 END,${widthAt("position+width")}
        FROM id_positions WHERE position<=length(${blob}) AND units<240 AND width BETWEEN 1 AND 4
          AND length(${scalar})=width AND ${code} BETWEEN 0 AND 1114111 AND ${code} NOT BETWEEN 55296 AND 57343
          AND CAST(char(${code}) AS BLOB) IS ${scalar})
        SELECT EXISTS(SELECT 1 FROM id_positions WHERE position=length(${blob})+1 AND units BETWEEN 1 AND 240)) ELSE 0 END)`;
  };
  const scopeValid = `(CASE WHEN typeof(${scope})='text' AND length(CAST(${scope} AS BLOB))<=1024 AND json_valid(${scope})
    THEN CASE WHEN json_type(${scope})='array' AND json_array_length(${scope})=4
      AND json_type(${scope},'$[0]')='text' AND json_type(${scope},'$[1]')='text'
      AND json_type(${scope},'$[2]')='text' AND json_type(${scope},'$[3]')='text'
      AND ((json_extract(${scope},'$[0]')='' AND json_extract(${scope},'$[1]')='')
        OR (${safeId(`json_extract(${scope},'$[0]')`)} AND ${safeId(`json_extract(${scope},'$[1]')`)}))
      AND ${safeId(`json_extract(${scope},'$[2]')`)} AND ${safeId(`json_extract(${scope},'$[3]')`)}
      THEN ${scope} IS json_array(json_extract(${scope},'$[0]'),json_extract(${scope},'$[1]'),
        json_extract(${scope},'$[2]'),json_extract(${scope},'$[3]')) ELSE 0 END ELSE 0 END)`;
  return {condition: `(${alias}.status='minimized' AND ${alias}.schema_version=1 AND ${alias}.recipe_version='${NATIVE_STRUCTURED_ORIGIN_RECIPE}'
    AND ${NATIVE_STRUCTURED_ORIGIN_HEADER_COLUMNS.filter(column => !NATIVE_STRUCTURED_ORIGIN_TOMBSTONE_COLUMNS.some(retained => retained === column)).map(column => `${alias}.${column} IS NULL`).join(" AND ")}
    AND ${["origin_id", "actor_user_id", "turn_id", "user_event_id", "answer_event_id", "user_content_id", "answer_content_id", "manifest_content_ref"].map(column => safeId(`${alias}.${column}`)).join(" AND ")}
    AND ${alias}.user_event_id<>${alias}.answer_event_id AND ${alias}.user_content_id<>${alias}.answer_content_id
    AND ${alias}.manifest_content_ref<>${alias}.user_content_id AND ${alias}.manifest_content_ref<>${alias}.answer_content_id
    AND ${scopeValid} AND typeof(${alias}.withdrawn_at)='text' AND length(${alias}.withdrawn_at)=24
    AND strftime('%Y-%m-%dT%H:%M:%fZ',julianday(${alias}.withdrawn_at)) IS ${alias}.withdrawn_at
    AND ${alias}.withdrawal_reason IN('source-unavailable','source-changed','source-expired','enrollment-changed','access-withdrawn','erased','manual'))`, bindings: []};
}
  const historical = {condition: nativeStructuredOriginMinimizedCondition, columns: NATIVE_STRUCTURED_ORIGIN_HEADER_COLUMNS,
    retained: NATIVE_STRUCTURED_ORIGIN_TOMBSTONE_COLUMNS, recipe: NATIVE_STRUCTURED_ORIGIN_RECIPE};
  assert.deepEqual(historical.columns, columns); assert.deepEqual(historical.retained, retained); assert.equal(historical.recipe, recipe);
  for (const [alias, digest] of Object.entries({"origin":"ca347e75975a0a5c6e616d699d31e66756fb16acb88892ce13ee290715faf9f4","tombstone":"5cd2aeaf502831f0c278be9377134cb1e1546d15d4d055e2000ab69095a5da9d"}))
    assert.equal(sha(historical.condition(alias).condition), digest, 'exact historical SQL fixture');
  return historical.condition;
}

function baseTombstone(scope) {
  return Object.assign(Object.fromEntries(columns.map(column => [column, null])), {
    origin_id: 'origin-valid', schema_version: 1, recipe_version: recipe, actor_user_id: 'actor',
    scope_key: JSON.stringify(scope === 'personal' ? ['', '', 'project', 'document']
      : ['organization', 'project-access', 'project', 'document']),
    turn_id: 'turn', user_event_id: 'user-event', answer_event_id: 'answer-event',
    user_content_id: 'user-body', answer_content_id: 'answer-body', manifest_content_ref: 'manifest-body',
    status: 'minimized', withdrawn_at: '2026-09-17T12:34:56.789Z', withdrawal_reason: 'erased',
  });
}

function predicateDifferentialCases() {
  const cases = [];
  for (const scope of ['personal', 'project']) {
    const base = baseTombstone(scope);
    const add = (name, changes, accepted, options = {}) => cases.push({name: `${scope}/${name}`,
      row: {...base, ...changes}, accepted, ...options});
    add('valid', {}, true);
    for (const column of retained) add(`null/${column}`, {[column]: null}, false);
    for (const column of columns.filter(column => !retained.includes(column)))
      add(`restored/${column}`, {[column]: 'restored'}, false);
    for (const column of identities) {
      for (const [name, value, accepted] of [
        ['empty', '', false], ['number', 7, false], ['blob', Buffer.from('id'), false],
        ['nul', '\0', true], ['embedded-nul', 'prefix\0suffix', true],
        ['ascii-240', 'a'.repeat(240), true], ['ascii-241', 'a'.repeat(241), false],
        ['supplementary-240-units', '😀'.repeat(120), true],
        ['supplementary-241-units', '😀'.repeat(120) + 'x', false],
        ['supplementary-242-units', '😀'.repeat(121), false],
        ['three-byte-240-units', '\u0800'.repeat(240), true],
        ['three-byte-241-units', '\u0800'.repeat(241), false],
      ]) add(`id/${column}/${name}`, {[column]: value}, accepted);
    }
    for (const [name, value] of [
      ['malformed', '{'], ['empty', ''], ['scalar-null', 'null'], ['object', '{}'], ['array-empty', '[]'],
      ['array-short', '["","","p"]'], ['array-long', '["","","p","d","extra"]'],
      ['numeric-member', '["","",7,"d"]'], ['null-member', '["","",null,"d"]'],
      ['nested-member', '["","",[],"d"]'], ['half-personal-a', '["org","","p","d"]'],
      ['half-personal-b', '["","access","p","d"]'], ['empty-project', '["","","","d"]'],
      ['empty-document', '["","","p",""]'], ['whitespace', '[ "", "", "p", "d" ]'],
      ['noncanonical-escape', '["","","\\u0070","d"]'],
      ['escaped-lone-high-surrogate', '["","","\\ud800","d"]'],
      ['escaped-lone-low-surrogate', '["","","\\udfff","d"]'],
      ['trailing-nul', '["","","p","d"]\0'], ['blob', Buffer.from('["","","p","d"]')],
      ['numeric', 7],
    ]) add(`scope/${name}`, {scope_key: value}, false);
    for (const [name, parts, accepted] of [
      ['nul-project', ['', '', '\0', 'document'], true],
      ['embedded-nul-organization', ['org\0end', 'access', 'project', 'document'], true],
      ['supplementary-240-units', ['', '', '😀'.repeat(120), 'd'], true],
      ['supplementary-241-units', ['', '', '😀'.repeat(120) + 'x', 'd'], false],
      ['ascii-240-units', ['', '', 'p'.repeat(240), 'd'], true],
      ['ascii-241-units', ['', '', 'p'.repeat(241), 'd'], false],
      ['all-ascii-bounded', ['o'.repeat(240), 'a'.repeat(240), 'p'.repeat(240), 'd'.repeat(240)], true],
      ['byte-ceiling', ['😀'.repeat(120), '😀'.repeat(120), '😀'.repeat(120), 'd'], false],
    ]) add(`scope/${name}`, {scope_key: JSON.stringify(parts)}, accepted);
    for (const reason of reasons) add(`reason/${reason}`, {withdrawal_reason: reason}, true);
    for (const [name, changes] of [
      ['version-zero', {schema_version: 0}], ['version-text', {schema_version: '1'}],
      ['recipe-wrong', {recipe_version: 'other'}], ['status-active', {status: 'active'}],
      ['status-withdrawn', {status: 'withdrawn'}], ['reason-unknown', {withdrawal_reason: 'unknown'}],
      ['same-events', {answer_event_id: base.user_event_id}],
      ['same-user-answer-body', {answer_content_id: base.user_content_id}],
      ['same-user-manifest-body', {manifest_content_ref: base.user_content_id}],
      ['same-answer-manifest-body', {manifest_content_ref: base.answer_content_id}],
      ['timestamp-empty', {withdrawn_at: ''}], ['timestamp-date-only', {withdrawn_at: '2026-09-17'}],
      ['timestamp-invalid-calendar', {withdrawn_at: '2026-02-30T12:34:56.789Z'}],
      ['timestamp-invalid-hour', {withdrawn_at: '2026-09-17T24:34:56.789Z'}],
      ['timestamp-no-ms', {withdrawn_at: '2026-09-17T12:34:56Z'}],
      ['timestamp-nul', {withdrawn_at: '2026-09-17T12:34:56.789Z\0'}],
    ]) add(name, changes, false);
    // Direct invalid UTF-8 bytes are not faithfully represented by a JavaScript
    // string. Compare SQL old/new and expected rejection, but not lossy readback
    // against the JS validator. No weakened schema or production writes occur.
    for (const hex of ['80', 'C080', 'EDA080', 'F4908080', 'E282'])
      add(`invalid-utf8/${hex}`, {}, false, {rawText: {column: 'origin_id', hex}, compareJs: false});
  }
  return cases;
}

async function runPredicateDifferential() {
  const historical = historicalCondition(), db = new DatabaseSync(':memory:');
  const cases = predicateDifferentialCases();
  let comparisons = 0, jsComparisons = 0, nullResults = 0, accepted = 0, rejected = 0;
  try {
    // No type affinities or table constraints mask malformed predicate inputs.
    db.exec(`CREATE TABLE differential_row(${columns.map(column => `"${column}"`).join(',')})`);
    const insert = db.prepare(`INSERT INTO differential_row VALUES(${columns.map(() => '?').join(',')})`);
    const statements = ['origin', 'tombstone'].map(alias => {
      const old = historical(alias), next = balancedCondition(alias);
      assert.deepEqual(old.bindings, []); assert.deepEqual(next.bindings, old.bindings);
      assert.notEqual(next.condition, old.condition, 'exercise changed native builder');
      // The wrapper explicitly observes raw NULL, CASE rejection, and IS NOT 1.
      const prepare = condition => db.prepare(`SELECT (${condition}) AS raw,
        CASE WHEN (${condition}) THEN 1 ELSE 0 END AS accepted,
        (${condition}) IS NOT 1 AS rejected FROM differential_row ${alias}`);
      return {alias, old: prepare(old.condition), next: prepare(next.condition)};
    });
    for (const candidate of cases) {
      db.exec('DELETE FROM differential_row');
      insert.run(...columns.map(column => candidate.row[column]));
      if (candidate.rawText) db.exec(`UPDATE differential_row SET "${candidate.rawText.column}"=CAST(X'${candidate.rawText.hex}' AS TEXT)`);
      for (const statement of statements) {
        const prior = statement.old.get(), next = statement.next.get();
        assert.deepEqual(next, prior, `${candidate.name}/${statement.alias}: raw, CASE, IS NOT 1 parity`);
        assert.equal(next.accepted, Number(candidate.accepted), `${candidate.name}/${statement.alias}: expected acceptance`);
        assert.equal(next.rejected, Number(!candidate.accepted), `${candidate.name}/${statement.alias}: fail-closed rejection`);
        if (candidate.compareJs !== false) {
          assert.equal(Boolean(validateTombstone(candidate.row)), candidate.accepted,
            `${candidate.name}/${statement.alias}: native JS tombstone validator parity`);
          jsComparisons++;
        }
        comparisons++;
        if (next.raw === null) nullResults++;
        if (next.accepted) accepted++; else rejected++;
      }
    }
    return {base: predicateDifferentialBase, runtime: process.version,
      sqlite: db.prepare('SELECT sqlite_version() AS version').get().version,
      cases: cases.length, aliases: 2, comparisons, jsComparisons, nullResults, accepted, rejected,
      historicalRuntime: 'reference SQLite only; no D1/workerd invocation',
      scope: 'Exact historical builder vs current clone export; raw SQL/CASE/IS NOT 1 and JS validation'};
  } finally { db.close(); }
}


test('reference SQLite preserves old/new raw NULL, CASE, IS NOT 1 and JS tombstone validation for both exact aliases', async t => {
  t.diagnostic(JSON.stringify(await runPredicateDifferential()));
  for (const alias of ['other', '', 'origin; SELECT 1', null]) assert.throws(() => balancedCondition(alias), /native_memory_origin_invalid/u);
});

test('actual workerd D1 evaluates the fixed tombstone predicate for both aliases across malformed and UTF-8 boundary rows', { timeout: 90000 }, async t => {
  const f = await fixture(t, false), cases = predicateDifferentialCases();
  const reference = new DatabaseSync(':memory:');
  t.after(() => reference.close());
  reference.exec(`CREATE TABLE differential_row(${columns.map(column => `"${column}"`).join(',')})`);
  const referenceInsert = reference.prepare(`INSERT INTO differential_row VALUES(${columns.map(() => '?').join(',')})`);
  const referenceRead = reference.prepare(`SELECT (${historicalCondition()('origin').condition}) AS raw FROM differential_row origin`);
  await f.raw.prepare(`CREATE TABLE differential_row(${columns.map(column => `"${column}"`).join(',')})`).run();
  const insert = f.raw.prepare(`INSERT INTO differential_row VALUES(${columns.map(() => '?').join(',')})`);
  const select = ['origin', 'tombstone'].map(alias => {
    const condition = balancedCondition(alias).condition;
    const sql = `SELECT (${condition}) AS raw, CASE WHEN (${condition}) THEN 1 ELSE 0 END AS accepted,
      (${condition}) IS NOT 1 AS rejected FROM differential_row ${alias}`;
    assert.ok(Buffer.byteLength(sql) <= 100000);
    return { alias, statement: f.raw.prepare(sql) };
  });
  let nullResults = 0;
  for (const candidate of cases) {
    const setup = [f.raw.prepare('DELETE FROM differential_row'), insert.bind(...columns.map(column => candidate.row[column]))];
    if (candidate.rawText) setup.push(f.raw.prepare(`UPDATE differential_row SET "${candidate.rawText.column}"=CAST(X'${candidate.rawText.hex}' AS TEXT)`));
    reference.exec('DELETE FROM differential_row');
    referenceInsert.run(...columns.map(column => candidate.row[column]));
    if (candidate.rawText) reference.exec(`UPDATE differential_row SET "${candidate.rawText.column}"=CAST(X'${candidate.rawText.hex}' AS TEXT)`);
    const expectedRaw = referenceRead.get().raw;
    const result = await f.raw.batch([...setup, ...select.map(item => item.statement)]);
    for (const [index, item] of select.entries()) {
      const actual = result[setup.length + index].results[0];
      assert.equal(actual.raw, expectedRaw, `${candidate.name}/${item.alias}: historical reference raw parity`);
      assert.equal(actual.accepted, Number(candidate.accepted), `${candidate.name}/${item.alias}`);
      assert.equal(actual.rejected, Number(!candidate.accepted), `${candidate.name}/${item.alias}`);
      if (actual.raw === null) nullResults++;
    }
  }
  assert.equal(nullResults, 16);
  t.diagnostic(JSON.stringify({ engine: 'Wrangler-pinned Miniflare/workerd D1', cases: cases.length, aliases: 2, comparisons: cases.length * 2, nullResults }));
});

function registerMinimizedIntegrityRegressions({test, fixture, snapshot, rows,
  synchronizeProjectScope, nativeStructuredOriginMinimizedIntegrity,
  baseTombstone, columns, retained, validateTombstone}) {
  const integrity = async f => {
    const proof = nativeStructuredOriginMinimizedIntegrity();
    return (await f.raw.prepare(`SELECT (${proof.sql}) AS intact`).bind(...proof.bindings).first()).intact;
  };
  async function seedMinimized(f) {
    const hash = 'a'.repeat(64), expires = new Date(Date.parse(f.now) + 86_400_000).toISOString();
    const tombstone = {...baseTombstone('project'), actor_user_id: f.scope.ownerUserId,
      scope_key: JSON.stringify([f.scope.organizationId, f.scope.projectAccessId, f.scope.projectId, 'document']),
      withdrawn_at: f.now};
    const full = {...tombstone, owner_user_id: f.scope.ownerUserId,
      organization_id: f.scope.organizationId, project_access_id: f.scope.projectAccessId,
      project_id: f.scope.projectId, document_id: 'document', user_source_sequence: 3,
      user_sha256: hash, answer_source_sequence: 4, answer_sha256: hash, answer_expires_at: expires,
      enrollment_id: 'fixture-enrollment', enrollment_revision: 1, permission_epoch: 'fixture-epoch',
      policy_version: 'fixture-policy', enrolled_at: f.now, enrollment_expires_at: expires, retention_days: 1,
      source_head: 2, ledger_id: hash, ledger_storage_revision: 1, ledger_body_ref: 'fixture-ledger-body',
      ledger_body_sha256: hash, consumed_context_sha256: hash, source_list_sha256: hash, source_count: 2,
      ledger_history_sha256: hash, ledger_revision_count: 1, manifest_sha256: hash,
      manifest_expires_at: expires, source_retention_ceiling: expires, created_at: f.now,
      status: 'active', withdrawn_at: null, withdrawal_reason: null};
    const originals = ['user', 'assistant'].map((role, ordinal) => ({origin_id: full.origin_id, ordinal,
      event_stream_id: 'creative:fixture-structured-source', event_id: `fixture-source-${role}-event`,
      source_sequence: ordinal + 1, event_type: role === 'user' ? 'ChatMessageSent' : 'AssistantReasoned',
      role, turn_id: 'fixture-source-turn', content_id: `fixture-source-${role}-body`,
      content_sha256: hash, projection_sha256: hash, recorded_at: f.now,
      source_retention_ceiling: expires, retained_by_ledger: 0, presented_in_context: 1}));
    const revision = {origin_id: full.origin_id, ordinal: 0, ledger_id: full.ledger_id,
      storage_revision: 1, predecessor_revision: 0, predecessor_hash: null,
      body_ref: full.ledger_body_ref, body_hash: hash, created_at: f.now, expires_at: expires};
    await f.insert('memory_structured_answer_origins', full);
    for (const row of originals) await f.insert('memory_structured_answer_originals', row);
    await f.insert('memory_structured_answer_ledger_revisions', revision);
    assert.equal((await rows(f.raw, 'memory_structured_answer_originals')).length, 2);
    assert.equal((await rows(f.raw, 'memory_structured_answer_ledger_revisions')).length, 1);
    // Follow each permitted state transition and delete sidecars only while
    // withdrawn. No triggers, CHECKs, schema text, or foreign keys are disabled.
    assert.equal((await f.raw.prepare("UPDATE memory_structured_answer_origins SET status='withdrawn',withdrawn_at=?,withdrawal_reason=? WHERE origin_id=? AND status='active'")
      .bind(tombstone.withdrawn_at, tombstone.withdrawal_reason, tombstone.origin_id).run()).meta.changes, 1);
    assert.equal((await f.raw.prepare('DELETE FROM memory_structured_answer_originals WHERE origin_id=?')
      .bind(tombstone.origin_id).run()).meta.changes, 2);
    assert.equal((await f.raw.prepare('DELETE FROM memory_structured_answer_ledger_revisions WHERE origin_id=?')
      .bind(tombstone.origin_id).run()).meta.changes, 1);
    assert.equal((await f.raw.prepare(`UPDATE memory_structured_answer_origins SET status='minimized',${columns
      .filter(column => !retained.includes(column)).map(column => `${column}=NULL`).join(',')}
      WHERE origin_id=? AND status='withdrawn'`).bind(tombstone.origin_id).run()).meta.changes, 1);
    const actual = await f.raw.prepare('SELECT * FROM memory_structured_answer_origins WHERE origin_id=?')
      .bind(tombstone.origin_id).first();
    assert.deepEqual(actual, tombstone);
    assert.ok(validateTombstone(actual));
    assert.equal(await integrity(f), 1);
    return {tombstone, full, originals, revision, expires};
  }

  test('actual D1 accepts canonical minimized headers and rejects every restored answer/manifest body or custody row before scope writes', {timeout: 90000}, async t => {
    const f = await fixture(t, true), seeded = await seedMinimized(f), {tombstone, expires} = seeded;
    // Original user content is explicitly outside the minimized-derived proof.
    const authored = {content_id: tombstone.user_content_id, owner_id: tombstone.actor_user_id,
      kind: 'chat-user', content: 'Original authored fixture content', created_at: f.now,
      expires_at: expires, redacted_at: null};
    await f.insert('private_content', authored);
    assert.deepEqual(await synchronizeProjectScope(f.env, f.scope), {eventCount: 2, documentCount: 1});
    const clean = await snapshot(f.raw);
    f.observed.records.length = 0; f.observed.batches.length = 0;
    assert.deepEqual(await synchronizeProjectScope(f.env, f.scope), {eventCount: 2, documentCount: 1});
    assert.equal(f.observed.records.length, 4, 'a valid minimized header still takes the qualified fast path');
    assert.equal(f.observed.batches.length, 0);
    assert.equal(await integrity(f), 1);
    assert.deepEqual(await snapshot(f.raw), clean);
    const residues = [];
    for (const [name, contentId, kind] of [['answer', tombstone.answer_content_id, 'chat-assistant-memory'],
      ['manifest', tombstone.manifest_content_ref, 'memory-structured-origin']]) {
      residues.push({name: `${name}/blank-redacted-body`, table: 'private_content', row: {
        content_id: contentId, owner_id: tombstone.actor_user_id, kind, content: '',
        created_at: f.now, expires_at: expires, redacted_at: f.now},
      remove: 'DELETE FROM private_content WHERE content_id=?', values: [contentId]});
      residues.push({name: `${name}/project-content-scope`, table: 'project_resource_scopes', row: {
        project_access_id: f.scope.projectAccessId, resource_kind: 'content', resource_id: contentId,
        organization_id: f.scope.organizationId, project_id: f.scope.projectId, owner_user_id: f.scope.ownerUserId,
        visibility: 'actor_private', source_event_id: null, actor_user_id: tombstone.actor_user_id, created_at: f.now},
      remove: "DELETE FROM project_resource_scopes WHERE project_access_id=? AND resource_kind='content' AND resource_id=?",
      values: [f.scope.projectAccessId, contentId]});
      residues.push({name: `${name}/retention-scope`, table: 'private_content_retention_scopes', row: {
        content_id: contentId, organization_id: f.scope.organizationId, project_access_id: f.scope.projectAccessId,
        project_id: f.scope.projectId, actor_user_id: tombstone.actor_user_id, classification: 'transient-private',
        policy_version: 1, assigned_expires_at: expires, created_at: f.now},
      remove: 'DELETE FROM private_content_retention_scopes WHERE content_id=?', values: [contentId]});
    }
    for (const residue of residues) {
      await f.insert(residue.table, residue.row);
      const before = await snapshot(f.raw), residueBefore = await rows(f.raw, residue.table);
      assert.equal(await integrity(f), 0, `${residue.name}: shared predicate sees the restored row`);
      f.observed.records.length = 0; f.observed.batches.length = 0;
      await assert.rejects(synchronizeProjectScope(f.env, f.scope), /malformed JSON/u, residue.name);
      assert.equal(f.observed.batches.length, 0, `${residue.name}: no scope chunk or activation ran`);
      assert.deepEqual(await snapshot(f.raw), before, `${residue.name}: synchronizer left scopes and cursor unchanged`);
      assert.deepEqual(await rows(f.raw, residue.table), residueBefore, `${residue.name}: rejection did not silently erase residue`);
      assert.deepEqual(await f.raw.prepare('SELECT * FROM private_content WHERE content_id=?')
        .bind(authored.content_id).first(), authored, 'original authored content remains unchanged');
      assert.equal((await f.raw.prepare(residue.remove).bind(...residue.values).run()).meta.changes, 1);
      assert.equal(await integrity(f), 1, `${residue.name}: removing only the fixture residue restores the proof`);
      assert.deepEqual(await snapshot(f.raw), clean);
    }
    assert.deepEqual(await synchronizeProjectScope(f.env, f.scope), {eventCount: 2, documentCount: 1});
    assert.deepEqual(await f.raw.prepare('SELECT * FROM memory_structured_answer_origins WHERE origin_id=?')
      .bind(tombstone.origin_id).first(), tombstone);
    t.diagnostic('Canonical active → withdrawn → minimized fixture; six independent derived-row resurrections rejected; original user content unchanged.');
  });

  test('actual D1 canonical schema blocks original and ledger dependency resurrection for minimized origins', {timeout: 90000}, async t => {
    const f = await fixture(t, true), seeded = await seedMinimized(f), before = await snapshot(f.raw);
    for (const [table, row, message] of [
      ['memory_structured_answer_originals', seeded.originals[0], /structured original requires active bounded origin/u],
      ['memory_structured_answer_ledger_revisions', seeded.revision, /structured ledger revision requires active bounded origin/u],
    ]) {
      await assert.rejects(f.insert(table, row), message);
      assert.deepEqual(await rows(f.raw, table), [], `${table}: insertion was stopped by the production trigger`);
      assert.equal(await integrity(f), 1);
      assert.deepEqual(await snapshot(f.raw), before);
    }
    assert.deepEqual(await synchronizeProjectScope(f.env, f.scope), {eventCount: 2, documentCount: 1});
  });
}

registerMinimizedIntegrityRegressions({test, fixture, snapshot, rows, synchronizeProjectScope,
  nativeStructuredOriginMinimizedIntegrity, baseTombstone, columns, retained, validateTombstone});

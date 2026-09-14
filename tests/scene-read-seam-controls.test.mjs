import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, test } from 'node:test';

// Authored proposal only. Root must review and explicitly execute it. Exact
// runtime readers/serializer/filter constants; isolated SQLite and proof port.
// No full runtime imports, Scene consumer, HTTP, live authority or provider.
assert.ok(process.env.FORMA_SCENE_READ_SEAM_ROOT, 'An explicit reviewed source root is required');
const root = resolve(process.env.FORMA_SCENE_READ_SEAM_ROOT);
const pins = {
  'worker/runtime.ts': 'fb1ab58dfc0b4aa3bf6574a5ffb043793f07d8621f9808deb244e98ef92e1ea2',
  'worker/event-read-primitives.ts': '935d33d4fae69e0826d7c9f7b7bccff80ab6ffc732c2c95b1221a684755a28b1',
  'src/model/event-profiles.ts': '6a868559e3a5933b9c2dbee5d85f41cbbb5b977ba1a180b9553c87480bb1aa10',
  'db/event-predicates.ts': '21dfff638c485f520310c1e39399b5a04211b86175a48fd82a7a69eff94e1e1d',
};
const sources = Object.fromEntries(Object.entries(pins).map(([path, sha]) => {
  const bytes = readFileSync(resolve(root, path));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), sha, path);
  return [path, bytes.toString('utf8')];
}));
function between(source, begin, end) {
  assert.equal(source.split(begin).length, 2, 'Exactly one source start: ' + begin);
  const start = source.indexOf(begin), finish = source.indexOf(end, start + begin.length);
  assert.ok(finish > start, 'Source endpoint: ' + end);
  return source.slice(start, finish);
}
const runtime = sources['worker/runtime.ts'];
const constant = runtime.match(/^export const SCOPED_EVENT_PAGE_SIZE = \d+;$/m)?.[0];
assert.equal(constant, 'export const SCOPED_EVENT_PAGE_SIZE = 6500;');
const readers = between(runtime, 'export async function readProfileEventPage(', '\n/** Intelligence interactions');
assert.deepEqual([...readers.matchAll(/(?:async )?function (\w+)\(/g)].map(match => match[1]), ['readProfileEventPage', 'readWorkspaceEvents']);
const serializer = sources['worker/event-read-primitives.ts'].slice(sources['worker/event-read-primitives.ts'].indexOf('export function serializeEvent('));
assert.deepEqual([...serializer.matchAll(/function (\w+)\(/g)].map(match => match[1]), ['serializeEvent']);
const excluded = between(sources['src/model/event-profiles.ts'], 'export const PROFILE_EXCLUDED_EVENT_TYPES:', '\nexport const SCOPED_EVENT_PROFILES');
const compiled = stripTypeScriptTypes([
  constant, excluded, sources['db/event-predicates.ts'], serializer, readers,
].join('\n').replace(/^export /gm, ''), { mode: 'transform' });

let forbidden = 0;
const restores = [];
for (const name of ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest', 'setInterval', 'setTimeout']) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value() { forbidden++; throw Error('forbidden_seam_work:' + name); } });
  restores.push(() => descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]);
}
after(() => { try { assert.equal(forbidden, 0); } finally { restores.reverse().forEach(restore => restore()); } });

// The projects-only branch is deliberately not tested or given a substitute
// catalog. Every invoked reader below uses the exact workspace profile.
const createReaders = new Function('observeSerialization', `
  const PROJECT_BOOTSTRAP_EVENT_TYPES = new Proxy([], {get(){throw Error('projects_profile_out_of_scope');}});
  ${compiled}
  const actualSerializeEvent = serializeEvent;
  serializeEvent = row => { observeSerialization(row); return actualSerializeEvent(row); };
  return { readProfileEventPage, readWorkspaceEvents, SCOPED_EVENT_PAGE_SIZE };
`);
const stream = 'creative:seam-owner', count = 6501, head = count + 1;
const changed = error => error instanceof Error && error.message === 'output_source_changed_during_read';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE events(event_id TEXT PRIMARY KEY,stream_id TEXT NOT NULL,sequence INTEGER NOT NULL,
      occurred_at TEXT NOT NULL,recorded_at TEXT NOT NULL,actor TEXT NOT NULL,client_id TEXT NOT NULL,
      correlation_id TEXT NOT NULL,causation_id TEXT,compensates_event_id TEXT,schema_version INTEGER NOT NULL,
      type TEXT NOT NULL,payload TEXT NOT NULL,UNIQUE(stream_id,sequence));
    CREATE TABLE event_private_payloads(private_event_id TEXT PRIMARY KEY,private_json TEXT,redacted_at TEXT);
  `);
  const insert = db.prepare("INSERT INTO events VALUES(?,?,?,'2026-09-13T00:00:00Z','2026-09-13T00:00:00Z','user:seam-owner','fixture','seam',NULL,NULL,1,?,?)");
  const secret = db.prepare('INSERT INTO event_private_payloads VALUES(?,?,NULL)');
  db.exec('BEGIN');
  try {
    for (let index = 1; index <= count; index++) {
      insert.run('event-' + index, stream, index, 'ProjectCreated', JSON.stringify({ name: 'public-' + index }));
      secret.run('event-' + index, JSON.stringify({ name: 'private-' + index }));
    }
    // A trailing genuine excluded event tests the unmodified head advancement.
    insert.run('telemetry', stream, head, 'ApplicationViewVisited', '{}');
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }

  let serialized = 0, verified = 0, live = true;
  const calls = [], originalResults = [];
  const state = { beforeBatch: null, afterBatch: null, mutateResults: null };
  class Statement {
    constructor(sql, bindings = []) { this.sql = sql; this.bindings = bindings; }
    bind(...bindings) { return new Statement(this.sql, bindings); }
  }
  const DB = {
    prepare(sql) { return new Statement(sql); },
    async batch(statements) {
      const number = calls.length + 1;
      assert.ok(number <= 2, 'This bounded fixture must never need a third page');
      calls.push(statements);
      state.beforeBatch?.(number, statements);
      db.exec('BEGIN IMMEDIATE');
      let actual;
      try {
        actual = statements.map(statement => {
          assert.match(statement.sql, /^SELECT\b/);
          assert.ok(statement.bindings.length <= 100);
          return { success: true, results: db.prepare(statement.sql).all(...statement.bindings), meta: { changes: 0 } };
        });
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      originalResults.push(actual);
      state.afterBatch?.(number, actual);
      return state.mutateResults ? state.mutateResults(number, actual) : actual;
    },
  };
  const api = createReaders(() => { serialized++; });
  // Three original, immutable fixture predicates, not a substitute claim of
  // completeness for captureSceneHistoryProof or real application authority.
  const assertions = Object.freeze([
    { sql: 'SELECT CASE WHEN ((SELECT COUNT(*) FROM events WHERE stream_id=?)=? AND (SELECT MAX(sequence) FROM events WHERE stream_id=?)=?) THEN 1 ELSE 0 END AS current', bindings: [stream, head, stream, head] },
    ...[1, count].map(index => ({ sql: 'SELECT CASE WHEN (EXISTS(SELECT 1 FROM event_private_payloads WHERE private_event_id=? AND private_json=? AND redacted_at IS NULL)) THEN 1 ELSE 0 END AS current', bindings: ['event-' + index, JSON.stringify({ name: 'private-' + index })] })),
  ].map(value => Object.freeze({ ...value, bindings: Object.freeze(value.bindings) })));
  const statements = Object.freeze(assertions.map(value => Object.freeze(DB.prepare(value.sql).bind(...value.bindings))));
  const proof = Object.freeze({
    statements,
    verify(results) {
      verified++;
      if (!live || results.length !== statements.length || !results.every(result => result?.success === true
        && Array.isArray(result.results) && result.results.length === 1 && result.results[0]?.current === 1)) {
        throw Error('output_source_changed_during_read');
      }
    },
  });
  function assertJoined() {
    for (const batch of calls) {
      assert.equal(batch.length, 2 + statements.length);
      assert.match(batch[0].sql, /^SELECT \* FROM events LEFT JOIN event_private_payloads/);
      assert.equal(batch[1].sql, 'SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?');
      for (const [index, statement] of statements.entries()) {
        assert.equal(batch[index + 2], statement, 'Every page uses the same original statement object');
        assert.equal(statement.sql, assertions[index].sql);
        assert.deepEqual(statement.bindings, assertions[index].bindings);
      }
    }
  }
  return { db, api, env: { DB }, state, calls, originalResults, proof, assertJoined,
    expire() { live = false; }, get serialized() { return serialized; }, get verified() { return verified; } };
}

test('6501 workspace events span two genuine pages, each joined to the same original proofs', async () => {
  const f = fixture();
  try {
    const events = await f.api.readWorkspaceEvents(f.env, stream, f.proof);
    assert.equal(events.length, count); assert.equal(f.calls.length, 2); assert.equal(f.verified, 2);
    assert.deepEqual(f.calls.map(batch => batch[0].bindings[1]), [0, 6500]);
    assert.deepEqual(f.originalResults.map(batch => batch[0].results.length), [6500, 1]);
    assert.deepEqual(events.map(event => event.sequence), Array.from({ length: count }, (_, index) => index + 1));
    assert.equal(events[0].payload.name, 'private-1'); assert.equal(events.at(-1).payload.name, 'private-6501');
    assert.ok(events.every(event => event.type === 'ProjectCreated')); assert.equal(f.serialized, count);
    f.assertJoined(); assert.equal(forbidden, 0);
  } finally { f.db.close(); }
});

test('a real no-head source edit between pages rejects the whole read, not a partial array', async () => {
  const f = fixture();
  try {
    f.state.afterBatch = number => {
      if (number !== 1) return;
      const original = f.db.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id='event-1'").get().private_json;
      const edited = original.replace('private-1', 'changed-1');
      assert.notEqual(edited, original); assert.equal(Buffer.byteLength(edited), Buffer.byteLength(original));
      f.db.prepare("UPDATE event_private_payloads SET private_json=? WHERE private_event_id='event-1'").run(edited);
      assert.equal(f.db.prepare('SELECT MAX(sequence) AS head FROM events').get().head, head);
    };
    await assert.rejects(f.api.readWorkspaceEvents(f.env, stream, f.proof), changed);
    assert.equal(f.calls.length, 2); assert.equal(f.verified, 2); assert.equal(f.serialized, 6500);
    assert.equal(f.originalResults[0][3].results[0].current, 1);
    assert.equal(f.originalResults[1][3].results[0].current, 0);
    f.assertJoined(); assert.equal(forbidden, 0);
  } finally { f.db.close(); }
});

const faults = {
  'missing-page': actual => [undefined, ...actual.slice(1)],
  'failed-page': actual => [{ ...actual[0], success: false }, ...actual.slice(1)],
  'malformed-page': actual => [{ ...actual[0], results: {} }, ...actual.slice(1)],
  'oversized-page': actual => [{ ...actual[0], results: [...actual[0].results, actual[0].results[0]] }, ...actual.slice(1)],
  'missing-head': actual => [actual[0], undefined, ...actual.slice(2)],
  'failed-head': actual => [actual[0], { ...actual[1], success: false }, ...actual.slice(2)],
  'malformed-head': actual => [actual[0], { ...actual[1], results: [{ head: '6502' }] }, ...actual.slice(2)],
  'duplicate-head': actual => [actual[0], { ...actual[1], results: [actual[1].results[0], actual[1].results[0]] }, ...actual.slice(2)],
  'missing-proof': actual => actual.slice(0, -1),
  'failed-proof': actual => [actual[0], actual[1], { ...actual[2], success: false }, ...actual.slice(3)],
  'false-proof': actual => [actual[0], actual[1], { ...actual[2], results: [{ current: 0 }] }, ...actual.slice(3)],
  'malformed-proof': actual => [actual[0], actual[1], { ...actual[2], results: [{ current: '1' }] }, ...actual.slice(3)],
  'extra-proof': actual => [...actual, actual.at(-1)],
};
for (const [name, fault] of Object.entries(faults)) test('joined read rejects ' + name + ' before serializing any source row', async () => {
  const f = fixture(); let faulted = false;
  try {
    f.state.mutateResults = (_number, actual) => {
      assert.equal(faulted, false); faulted = true;
      assert.equal(actual.length, 5); assert.equal(actual[0].results.length, 6500);
      assert.ok(actual.every(result => result.success === true));
      assert.ok(actual.slice(2).every(result => result.results.length === 1 && result.results[0].current === 1));
      return fault(actual);
    };
    await assert.rejects(f.api.readWorkspaceEvents(f.env, stream, f.proof), changed);
    assert.equal(faulted, true); assert.equal(f.calls.length, 1); assert.equal(f.serialized, 0);
    assert.equal(f.verified, name.includes('proof') ? 1 : 0);
    f.assertJoined(); assert.equal(forbidden, 0);
  } finally { f.db.close(); }
});

test('the synchronous caller verifier can veto expired ownership after the awaited batch', async () => {
  const f = fixture();
  try {
    f.state.afterBatch = () => f.expire();
    await assert.rejects(f.api.readWorkspaceEvents(f.env, stream, f.proof), changed);
    assert.equal(f.verified, 1); assert.equal(f.serialized, 0); assert.equal(f.calls.length, 1);
    assert.ok(f.originalResults[0].slice(2).every(result => result.results[0].current === 1));
    f.assertJoined();
  } finally { f.db.close(); }
});

test('omitting the proof keeps the ordinary two-statement pages, exact filters and serialized output', async () => {
  const ordinary = fixture(), guarded = fixture();
  try {
    const actual = await ordinary.api.readWorkspaceEvents(ordinary.env, stream);
    const checked = await guarded.api.readWorkspaceEvents(guarded.env, stream, guarded.proof);
    assert.deepEqual(actual, checked); assert.equal(ordinary.verified, 0);
    assert.equal(ordinary.calls.length, 2); assert.equal(ordinary.serialized, count);
    for (const [index, batch] of ordinary.calls.entries()) {
      assert.equal(batch.length, 2);
      for (let slot = 0; slot < 2; slot++) {
        assert.equal(batch[slot].sql, guarded.calls[index][slot].sql);
        assert.deepEqual(batch[slot].bindings, guarded.calls[index][slot].bindings);
      }
    }
    assert.equal(actual.at(-1).sequence, 6501); assert.equal(forbidden, 0);
  } finally { ordinary.db.close(); guarded.db.close(); }
});

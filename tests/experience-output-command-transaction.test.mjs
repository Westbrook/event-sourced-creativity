import assert from 'node:assert/strict';
import { closeSync, openSync, readSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// New isolated transaction tests, not native budget/provider qualification.
// Only ledger lines 161–257 execute (through 259 when the two-line option
// already exists). The delivered repository must contain the applied change;
// only an explicit pristine-checkout override enables in-memory patching.
// Dependencies, schema triggers, authority, private-body proof and synthetic
// grant/slot/job/reservation algorithms remain test seams.
const canonicalOverride = process.env.FORMA_EXPERIENCE_CANONICAL_ROOT;
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const canonicalLedger = resolve(canonicalOverride || repositoryRoot, 'worker/output-requirements-ledger.ts');
const retainedOption = '  retainedEnvelope?: Record<string, unknown>;';
const retainedMapping = '...(input.retainedEnvelope && index === input.events.length - 1 ? { output_command_envelope: input.retainedEnvelope } : {})';
function selectedLedgerLines(path) {
  const fd = openSync(path, 'r'), byte = Buffer.alloc(1), selected = [];
  let line = 1, last = 257, patched = false;
  const readThrough = limit => {
    while (line <= limit && readSync(fd, byte, 0, 1, null)) {
      if (line >= 161) selected.push(byte[0]);
      if (byte[0] === 10) line++;
    }
    assert.equal(line, limit + 1, 'selected ledger range must be complete');
  };
  try {
    // Skip the prefix without retaining it; stop at the selected final newline.
    // Do not copy, hash or import the whole canonical module.
    readThrough(last);
    patched = Buffer.from(selected).toString('utf8').split('\n').includes(retainedOption);
    // The option adds exactly two lines inside this fragment. Read only its
    // displaced closing lines, never the following canonical branch.
    if (patched) { last = 259; readThrough(last); }
  } finally { closeSync(fd); }
  return { source: Buffer.from(selected).toString('utf8'), patched, lastLine: last };
}
function applyLedgerHunks(original, patch) {
  let selected = false, hunk = null, count = 0, value = original;
  const flush = () => {
    if (!hunk) return;
    const before = `${hunk.before.join('\n')}\n`, after = `${hunk.after.join('\n')}\n`;
    assert.equal(value.split(before).length, 2, 'each selected patch hunk must match exactly once');
    value = value.replace(before, after); count++; hunk = null;
  };
  for (const line of patch.split('\n')) {
    if (line.startsWith('--- a/')) { flush(); selected = line === '--- a/worker/output-requirements-ledger.ts'; continue; }
    if (!selected || line.startsWith('+++ ')) continue;
    if (line.startsWith('@@ ')) { flush(); hunk = { before: [], after: [] }; continue; }
    if (!hunk) continue;
    if (line.startsWith(' ') || line.startsWith('-')) hunk.before.push(line.slice(1));
    if (line.startsWith(' ') || line.startsWith('+')) hunk.after.push(line.slice(1));
  }
  flush(); assert.equal(count, 2, 'only the retainedEnvelope type and mapping hunks are expected');
  return value;
}
const selected = selectedLedgerLines(canonicalLedger);
assert.equal(selected.patched, selected.source.includes(retainedMapping), 'retainedEnvelope must be wholly applied or wholly absent');
assert.ok(selected.patched || canonicalOverride, 'Apply the retainedEnvelope patch in this repository, or explicitly set FORMA_EXPERIENCE_CANONICAL_ROOT to a pristine checkout');
const selectedSource = selected.patched ? selected.source
  : applyLedgerHunks(selected.source, await readFile(new URL('../evidence/output-native-command-binding.patch', import.meta.url), 'utf8'));
assert.doesNotMatch(selectedSource, /^import\s/mu);

class OutputConflictError extends Error {
  constructor(message, status = 409) { super(message); this.status = status; }
}
const writeColumns = ['event_id', 'stream_id', 'sequence', 'actor', 'client_id', 'correlation_id', 'type', 'payload', 'compensates_event_id', 'created_at', 'owner_id', 'seam_1', 'seam_2', 'seam_3', 'project_id', 'document_id', 'private_json'];
const transactionTables = ['events', 'event_private_payloads', 'event_write_stage', 'output_commands', 'synthetic_grants', 'synthetic_slots', 'synthetic_jobs', 'synthetic_reservations', 'assertion_stage'];
function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE authority(enabled INTEGER NOT NULL); INSERT INTO authority VALUES(1);
    CREATE TABLE reservation_authority(enabled INTEGER NOT NULL); INSERT INTO reservation_authority VALUES(1);
    CREATE TABLE assertion_stage(value INTEGER NOT NULL CHECK(value=1));
    CREATE TABLE events(event_id TEXT PRIMARY KEY,stream_id TEXT,sequence INTEGER,actor TEXT,client_id TEXT,correlation_id TEXT,type TEXT,payload TEXT,UNIQUE(stream_id,sequence));
    CREATE TABLE event_private_payloads(private_event_id TEXT PRIMARY KEY REFERENCES events(event_id),owner_id TEXT,project_id TEXT,document_id TEXT,private_json TEXT,redacted_at TEXT);
    CREATE TABLE event_write_stage(${writeColumns.map(name => `${name} ${name === 'sequence' ? 'INTEGER' : 'TEXT'}`).join(',')});
    CREATE TRIGGER synthetic_private_event_stage AFTER INSERT ON event_write_stage BEGIN
      INSERT INTO events VALUES(new.event_id,new.stream_id,new.sequence,new.actor,new.client_id,new.correlation_id,new.type,new.payload);
      INSERT INTO event_private_payloads VALUES(new.event_id,new.owner_id,new.project_id,new.document_id,new.private_json,NULL);
    END;
    CREATE TABLE output_commands(scope_key TEXT,actor_user_id TEXT,command_key TEXT,request_digest TEXT,action TEXT,event_id TEXT REFERENCES events(event_id),created_at TEXT,PRIMARY KEY(scope_key,actor_user_id,command_key));
    CREATE TABLE synthetic_grants(grant_id TEXT PRIMARY KEY,command_key TEXT,event_id TEXT REFERENCES events(event_id));
    CREATE TABLE synthetic_slots(slot_id TEXT PRIMARY KEY,grant_id TEXT REFERENCES synthetic_grants(grant_id),command_key TEXT,event_id TEXT REFERENCES events(event_id));
    CREATE TABLE synthetic_jobs(job_id TEXT PRIMARY KEY,slot_id TEXT REFERENCES synthetic_slots(slot_id),command_key TEXT,event_id TEXT REFERENCES events(event_id));
    CREATE TABLE synthetic_reservations(reservation_id TEXT PRIMARY KEY,job_id TEXT REFERENCES synthetic_jobs(job_id),command_key TEXT,event_id TEXT REFERENCES events(event_id));`);
  return db;
}
function prepared(db, sql, bindings = []) {
  return { sql, bindings,
    bind(...values) { return prepared(db, sql, values); },
    async first() { return db.prepare(sql).get(...bindings) ?? null; },
    run() { return db.prepare(sql).run(...bindings); },
  };
}
const envelopeDigest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function harness(t) {
  const db = database(); t.after(() => db.close());
  const state = { attempts: 0, committed: 0, rolledBack: 0, beforeBatch: null, loseNextAcknowledgment: false, proofBodies: new Map() };
  const env = { DB: {
    prepare: sql => prepared(db, sql),
    async batch(statements) {
      state.attempts++; state.beforeBatch?.();
      db.exec('BEGIN');
      try { for (const statement of statements) statement.run(); db.exec('COMMIT'); state.committed++; }
      catch (error) { db.exec('ROLLBACK'); state.rolledBack++; throw error; }
      if (state.loseNextAcknowledgment) { state.loseNextAcknowledgment = false; throw new Error('synthetic committed batch acknowledgment lost'); }
      return statements.map(() => ({ success: true }));
    },
  } };
  const dependencies = {
    OutputConflictError,
    EVENT_WRITE_COLUMNS: writeColumns.join(','),
    makeEvent: (streamId, sequence, actor, clientId, correlationId, type, payload) => ({ eventId: randomUUID(), streamId, sequence, actor, clientId, correlationId, type, payload, createdAt: new Date().toISOString() }),
    eventWriteBindings: event => [event.eventId, event.streamId, event.sequence, event.actor, event.clientId, event.correlationId, event.type,
      JSON.stringify({ project_id: event.payload.project_id, document_id: event.payload.document_id }), null, event.createdAt, 'author-1', null, null, null,
      event.payload.project_id, event.payload.document_id, JSON.stringify(event.payload)],
    outputScopeAuthority: () => ({ sql: '(SELECT enabled FROM authority)=1', bindings: [] }),
    outputAssertionStatements: (_env, guard) => [env.DB.prepare(`INSERT INTO assertion_stage(value) SELECT CASE WHEN (${guard.sql}) THEN 1 ELSE 0 END`).bind(...(guard.bindings ?? []))],
    rememberOutputPrivateBody: (_scope, eventId, json) => { const value = JSON.parse(json); state.proofBodies.set(eventId, value); return value; },
  };
  const token = `command-transaction-${randomUUID()}`;
  globalThis[token] = dependencies;
  const code = `const {${Object.keys(dependencies).join(',')}}=globalThis[${JSON.stringify(token)}]; delete globalThis[${JSON.stringify(token)}];\n${stripTypeScriptTypes(selectedSource, { mode: 'strip' })}`;
  let ledger;
  try { ledger = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`); }
  finally { delete globalThis[token]; }
  const scope = { kind: 'personal', key: 'scope-1', actorUserId: 'author-1', ownerUserId: 'author-1', organizationId: null, projectAccessId: null, contextId: null, projectId: 'project-1', documentId: 'document-1' };
  const input = () => {
    const key = 'logical-intake:run', retainedEnvelope = { action: 'run', documentId: scope.documentId, expectedRevision: 'output:0', clientMutationId: key,
      request: { quoteId: 'synthetic-quote', subject: 'Authored synthetic input' } };
    return { scope, permission: 'author', expectedHead: 0, expectedProjectHead: 0, key, digest: envelopeDigest(retainedEnvelope), action: 'run', retainedEnvelope,
      events: [{ type: 'SyntheticGrantAccepted', payload: { grant_id: 'grant-1' } }, { type: 'SyntheticJobCreated', payload: { grant_id: 'grant-1', job_id: 'job-1' } }],
      buildSidecars: events => {
        const last = events.at(-1);
        return { statements: [
          env.DB.prepare('INSERT INTO synthetic_grants VALUES(?,?,?)').bind('grant-1', key, last.eventId),
          env.DB.prepare('INSERT INTO synthetic_slots VALUES(?,?,?,?)').bind('slot-1', 'grant-1', key, last.eventId),
          env.DB.prepare('INSERT INTO synthetic_jobs VALUES(?,?,?,?)').bind('job-1', 'slot-1', key, last.eventId),
          env.DB.prepare('INSERT INTO synthetic_reservations VALUES(?,?,?,?)').bind('reservation-1', 'job-1', key, last.eventId),
        ], assertions: [{ sql: '(SELECT enabled FROM reservation_authority)=1' }] };
      },
    };
  };
  const count = table => Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
  return { db, state, env, ledger, scope, input, count };
}
function assertSingleAssociation(h, command) {
  const row = h.db.prepare(`SELECT command.command_key,command.request_digest,command.event_id,body.private_json,
      grant_row.grant_id,slot.slot_id,job.job_id,reservation.reservation_id
    FROM output_commands command JOIN event_private_payloads body ON body.private_event_id=command.event_id
    JOIN synthetic_grants grant_row ON grant_row.command_key=command.command_key AND grant_row.event_id=command.event_id
    JOIN synthetic_slots slot ON slot.grant_id=grant_row.grant_id AND slot.command_key=command.command_key AND slot.event_id=command.event_id
    JOIN synthetic_jobs job ON job.slot_id=slot.slot_id AND job.command_key=command.command_key AND job.event_id=command.event_id
    JOIN synthetic_reservations reservation ON reservation.job_id=job.job_id AND reservation.command_key=command.command_key AND reservation.event_id=command.event_id`).get();
  assert.equal(row.command_key, command.key); assert.equal(row.request_digest, command.digest);
  assert.deepEqual(JSON.parse(row.private_json).output_command_envelope, command.retainedEnvelope);
  for (const table of ['output_commands', 'synthetic_grants', 'synthetic_slots', 'synthetic_jobs', 'synthetic_reservations']) assert.equal(h.count(table), 1, table);
  return row;
}

test('retained envelope, original command and synthetic grant/slot/job/reservation commit in one batch', async t => {
  const h = await harness(t), command = h.input();
  const result = await h.ledger.commitOutputCommand(h.env, command);
  assert.equal(result.replayed, false); assert.equal(h.state.attempts, 1); assert.equal(h.state.committed, 1);
  const joined = assertSingleAssociation(h, command);
  assert.equal(joined.event_id, result.receipt.eventId);
  assert.equal(h.count('events'), 2); assert.equal(h.count('event_private_payloads'), 2);
  assert.equal(Object.hasOwn(result.events[0].payload, 'output_command_envelope'), false);
  assert.deepEqual(result.events.at(-1).payload.output_command_envelope, command.retainedEnvelope);
  const replay = await h.ledger.readOutputCommand(h.env, h.scope, command.key, command.digest);
  assert.deepEqual(replay.payload.output_command_envelope, command.retainedEnvelope);
});

test('two interleaved identical requests converge on one committed association', async t => {
  const h = await harness(t), first = h.input(), second = h.input();
  const results = await Promise.all([h.ledger.commitOutputCommand(h.env, first), h.ledger.commitOutputCommand(h.env, second)]);
  assert.deepEqual(results.map(result => result.replayed).sort(), [false, true]);
  assert.equal(results[0].receipt.eventId, results[1].receipt.eventId);
  assert.equal(h.state.attempts, 2); assert.equal(h.state.committed, 1); assert.equal(h.state.rolledBack, 1);
  assert.equal(results.find(result => result.replayed).events.length, 0);
  assertSingleAssociation(h, first); assert.equal(h.count('events'), 2);
});

test('lost acknowledgment resolves through the original receipt and retry makes no new work', async t => {
  const h = await harness(t), command = h.input(); h.state.loseNextAcknowledgment = true;
  const lost = await h.ledger.commitOutputCommand(h.env, command);
  assert.equal(lost.replayed, true); assert.deepEqual(lost.events, []);
  assert.deepEqual(lost.receipt.payload.output_command_envelope, command.retainedEnvelope);
  const retry = await h.ledger.commitOutputCommand(h.env, h.input());
  assert.equal(retry.replayed, true); assert.equal(retry.receipt.eventId, lost.receipt.eventId);
  assert.equal(h.state.attempts, 1); assert.equal(h.state.committed, 1);
  assertSingleAssociation(h, command);
});

test('changed complete envelope digest on the same command key conflicts before another batch', async t => {
  const h = await harness(t), command = h.input();
  await h.ledger.commitOutputCommand(h.env, command);
  const changed = h.input(); changed.retainedEnvelope.request.subject = 'Changed synthetic input'; changed.digest = envelopeDigest(changed.retainedEnvelope);
  assert.equal(changed.key, command.key); assert.notEqual(changed.digest, command.digest);
  await assert.rejects(h.ledger.commitOutputCommand(h.env, changed), /mutation_key_reused_with_different_content/u);
  assert.equal(h.state.attempts, 1); assertSingleAssociation(h, command);
});

test('withdrawn entry or late synthetic reservation guard leaves no transaction rows', async t => {
  for (const guardTable of ['authority', 'reservation_authority']) {
    const h = await harness(t), command = h.input();
    h.state.beforeBatch = () => h.db.prepare(`UPDATE ${guardTable} SET enabled=0`).run();
    await assert.rejects(h.ledger.commitOutputCommand(h.env, command), /output_revision_or_authority_changed/u);
    assert.equal(h.state.committed, 0); assert.equal(h.state.rolledBack, 1);
    for (const table of transactionTables) assert.equal(h.count(table), 0, `${guardTable}: ${table}`);
    assert.equal(h.state.proofBodies.size, 0);
  }
});

test('missing or redacted original private body cannot become a successful content replay', async t => {
  for (const mode of ['missing', 'redacted']) {
    const h = await harness(t), command = h.input();
    const first = await h.ledger.commitOutputCommand(h.env, command);
    if (mode === 'missing') h.db.prepare('DELETE FROM event_private_payloads WHERE private_event_id=?').run(first.receipt.eventId);
    else h.db.prepare("UPDATE event_private_payloads SET redacted_at='synthetic-redaction' WHERE private_event_id=?").run(first.receipt.eventId);
    await assert.rejects(h.ledger.readOutputCommand(h.env, h.scope, command.key, command.digest), /original_command_content_unavailable/u);
    const replay = await h.ledger.commitOutputCommand(h.env, h.input());
    assert.equal(replay.replayed, true); assert.equal(replay.receipt.privateUnavailable, true);
    assert.deepEqual(replay.receipt.payload, {}); assert.deepEqual(replay.events, []);
    assert.equal(h.state.attempts, 1); assert.equal(h.count('events'), 2); assert.equal(h.count('synthetic_jobs'), 1);
  }
});

test('omitting retainedEnvelope preserves the generic payload shape', async t => {
  const h = await harness(t), command = h.input(); delete command.retainedEnvelope;
  const result = await h.ledger.commitOutputCommand(h.env, command);
  assert.equal(result.replayed, false);
  for (const event of result.events) assert.equal(Object.hasOwn(event.payload, 'output_command_envelope'), false);
  const retained = await h.ledger.readOutputCommand(h.env, h.scope, command.key, command.digest);
  assert.equal(Object.hasOwn(retained.payload, 'output_command_envelope'), false);
});

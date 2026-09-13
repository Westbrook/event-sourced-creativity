import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

// Source-authored fixture only. The caller must supply the actual reviewed R4
// module namespace. This file imports no production code, issues no authority
// DTO and performs no operation until its factory is explicitly invoked.
export const PAST = '2000-01-01T00:00:00.000Z';
export const FUTURE = '2999-01-01T00:00:00.000Z';
const COLUMNS = 'event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,schema_version,type,payload,owner_id,project_id,document_id,private_json';
const ident = value => { assert.match(value, /^[a-z_][a-z0-9_]*$/u); return value; };
const DDL = `
  CREATE TABLE users(user_id TEXT PRIMARY KEY,email TEXT,display_name TEXT,role TEXT,consent_version TEXT,consented_at TEXT,created_at TEXT,updated_at TEXT);
  CREATE TABLE capability_grants(grant_id TEXT PRIMARY KEY,user_id TEXT,capability TEXT,scope_type TEXT,organization_id TEXT,project_access_id TEXT,status TEXT,revoked_at TEXT,expires_at TEXT,updated_at TEXT);
  CREATE TABLE organizations(organization_id TEXT PRIMARY KEY,name TEXT,owner_user_id TEXT,status TEXT,updated_at TEXT);
  CREATE TABLE organization_memberships(membership_id TEXT PRIMARY KEY,organization_id TEXT,user_id TEXT,role TEXT,status TEXT,accepted_at TEXT,revoked_at TEXT,updated_at TEXT);
  CREATE TABLE organization_projects(project_access_id TEXT PRIMARY KEY,organization_id TEXT,project_id TEXT,owner_user_id TEXT,status TEXT,updated_at TEXT);
  CREATE TABLE project_memberships(membership_id TEXT PRIMARY KEY,project_access_id TEXT,organization_id TEXT,project_id TEXT,user_id TEXT,role TEXT,status TEXT,revoked_at TEXT,updated_at TEXT);
  CREATE TABLE pilot_cohorts(cohort_id TEXT PRIMARY KEY,organization_id TEXT,status TEXT,starts_at TEXT,ends_at TEXT,created_at TEXT,participant_cap_microusd INTEGER);
  CREATE TABLE pilot_participants(participant_id TEXT PRIMARY KEY,cohort_id TEXT,organization_id TEXT,email_normalized TEXT,user_id TEXT,status TEXT,revoked_at TEXT,role TEXT);
  CREATE TABLE organization_security_policies(organization_id TEXT PRIMARY KEY,authentication_source TEXT,allowed_domains_json TEXT,require_mfa INTEGER,version INTEGER,updated_at TEXT);
  CREATE TABLE organization_identity_bindings(organization_id TEXT,user_id TEXT,status TEXT,authentication_source TEXT,subject TEXT,updated_at TEXT,PRIMARY KEY(organization_id,user_id));
  CREATE TABLE canvas_governance_requirements(requirement_id TEXT PRIMARY KEY,status TEXT,details_json TEXT,evidence_ref TEXT);
  CREATE TABLE project_event_scopes(project_access_id TEXT,organization_id TEXT,event_id TEXT,project_sequence INTEGER);
  CREATE TABLE impersonation_sessions(impersonation_id TEXT PRIMARY KEY,actor_user_id TEXT,persona_id TEXT,fictional_user_id TEXT,status TEXT,expires_at TEXT,updated_at TEXT,replay_session_id TEXT,started_at TEXT);
  CREATE TABLE replay_personas(persona_id TEXT PRIMARY KEY,display_name TEXT,status TEXT);
  CREATE TABLE project_resource_scopes(owner_user_id TEXT,resource_kind TEXT,resource_id TEXT,PRIMARY KEY(owner_user_id,resource_kind,resource_id));
  CREATE TABLE project_context_sessions(context_id TEXT PRIMARY KEY,principal_user_id TEXT,organization_id TEXT,project_access_id TEXT,expires_at TEXT,revoked_at TEXT);
  CREATE TABLE project_migration_states(project_access_id TEXT,organization_id TEXT,status TEXT,PRIMARY KEY(project_access_id,organization_id));
  CREATE TABLE private_content(content_id TEXT PRIMARY KEY,owner_id TEXT,kind TEXT,content TEXT,redacted_at TEXT,expires_at TEXT);
  CREATE TABLE private_content_retention_scopes(content_id TEXT PRIMARY KEY);
  CREATE TABLE events (
    event_id TEXT PRIMARY KEY NOT NULL, stream_id TEXT NOT NULL, sequence INTEGER NOT NULL,
    occurred_at TEXT NOT NULL, recorded_at TEXT NOT NULL, actor TEXT NOT NULL, client_id TEXT NOT NULL,
    correlation_id TEXT NOT NULL, causation_id TEXT, compensates_event_id TEXT,
    schema_version INTEGER NOT NULL DEFAULT 1, type TEXT NOT NULL, payload TEXT NOT NULL
  );
  CREATE UNIQUE INDEX idx_events_stream_sequence ON events(stream_id, sequence);
  CREATE TABLE event_private_payloads (private_event_id TEXT PRIMARY KEY NOT NULL,owner_id TEXT NOT NULL,project_id TEXT,document_id TEXT,private_json TEXT NOT NULL,created_at TEXT NOT NULL,redacted_at TEXT);
  CREATE INDEX idx_event_private_payloads_owner_scope ON event_private_payloads(owner_id,project_id,document_id,redacted_at);
  CREATE TABLE event_write_stage (event_id TEXT PRIMARY KEY NOT NULL,stream_id TEXT NOT NULL,sequence INTEGER NOT NULL,occurred_at TEXT NOT NULL,recorded_at TEXT NOT NULL,actor TEXT NOT NULL,client_id TEXT NOT NULL,correlation_id TEXT NOT NULL,causation_id TEXT,compensates_event_id TEXT,schema_version INTEGER NOT NULL,type TEXT NOT NULL,payload TEXT NOT NULL,owner_id TEXT NOT NULL,project_id TEXT,document_id TEXT,private_json TEXT);
  CREATE TABLE event_client_receipts (stream_id TEXT NOT NULL, client_event_id TEXT NOT NULL, event_id TEXT NOT NULL, sequence INTEGER NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(stream_id,client_event_id));
  CREATE INDEX idx_event_client_receipts_event ON event_client_receipts(event_id);
`;

export function createAtomicIntakeSqlite({ primitives }) {
  assert.equal(primitives.EVENT_WRITE_COLUMNS, COLUMNS);
  assert.equal(typeof primitives.EVENT_WRITE_STAGE_TRIGGER_SQL, 'string');
  assert.equal(typeof primitives.eventWriteBindings, 'function');
  const stageSql = `INSERT INTO event_write_stage (${primitives.EVENT_WRITE_COLUMNS}) VALUES(${COLUMNS.split(',').map(() => '?').join(',')})`;
  const appendSql = `INSERT INTO event_write_stage (${primitives.EVENT_WRITE_COLUMNS}) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?`;
  const normalized = sql => sql.trim().replace(/\s+/gu, ' ');
  const receiptPrefix = /^INSERT INTO event_client_receipts\(stream_id,client_event_id,event_id,sequence,created_at\) (?:SELECT|VALUES)\b/u;
  const data = { retired: false, closed: false, forbiddenWrites: 0, reentrantAttempts: 0, lateReadAttempts: 0,
    prepares: 0, first: 0, all: 0, batchAttempts: 0, committedBatches: 0, rolledBackBatches: 0,
    lostAckThrows: 0, reads: [], batches: [], fixtureMutations: [], arrangements: [] };
  let connectionActive = false, transactionOpen = false, nextArrangement = null, nextLostAck = false;
  const statements = new WeakMap();
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(DDL);
    db.exec(primitives.EVENT_WRITE_STAGE_TRIGGER_SQL); // Actual imported trigger, not a fixture privacy split.
    const tableNames = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => row.name);
    const tables = new Set(tableNames);
    function live() {
      if (data.retired || data.closed) { data.lateReadAttempts++; throw Error('Atomic intake fixture retired'); }
    }
    function idle() {
      if (connectionActive) { data.reentrantAttempts++; throw Error('Atomic intake fixture connection is already owned'); }
    }
    function acquire() { live(); idle(); connectionActive = true; }
    function refuse(message) { data.forbiddenWrites++; throw Error(message); }
    function readable(sql) {
      if (!/^\s*(?:SELECT|WITH)\b/iu.test(sql)) refuse('Atomic intake attempted non-read SQL outside batch');
    }
    function appendOrReceipt(sql) {
      const compact = normalized(sql);
      if (sql.includes(';') || !(compact === appendSql || receiptPrefix.test(compact)))
        refuse('Atomic intake attempted an unexpected production batch statement');
    }
    function copyBindings(bindings) {
      assert.ok(Array.isArray(bindings));
      // This selected closure binds only scalar SQL values. Reject mutable blobs
      // rather than exposing a second alias into a prepared statement's values.
      for (const value of bindings) assert.ok(value === null || typeof value === 'string' ||
        typeof value === 'number' || typeof value === 'bigint', 'Only scalar fixture bindings are admitted');
      return Object.freeze([...bindings]);
    }
    function finish(failed, primary, batch) {
      const cleanup = [];
      if (transactionOpen) {
        try {
          db.exec('ROLLBACK'); transactionOpen = false;
          if (batch) { batch.rolledBack = true; data.rolledBackBatches++; }
        }
        catch (error) { cleanup.push(error); }
      }
      try { db.exec('PRAGMA query_only=OFF'); } catch (error) { cleanup.push(error); }
      if (cleanup.length) {
        data.retired = true;
        throw new AggregateError(failed ? [primary, ...cleanup] : cleanup, 'Atomic intake SQL cleanup failed; fixture retired');
      }
      if (failed) throw primary; // An explicit flag preserves even `throw undefined`.
    }
    function read(rows, log) {
      live(); rows.forEach(row => readable(row.sql)); acquire();
      try {
        let failed = false, primary, result;
        try {
          db.exec('PRAGMA query_only=ON');
          db.exec('BEGIN'); transactionOpen = true;
          result = rows.map(({ sql, bindings, kind, column }) => {
            live();
            if (log) data.reads.push({ sql, bindings: [...bindings], kind });
            const prepared = db.prepare(sql);
            if (kind === 'first') {
              const value = prepared.get(...bindings);
              return value === undefined ? null : column === undefined ? value : value[column];
            }
            return { success: true, results: prepared.all(...bindings) };
          });
          db.exec('COMMIT'); transactionOpen = false;
        } catch (error) {
          if (/readonly|read.only|SQLITE_READONLY/iu.test(String(error?.message))) data.forbiddenWrites++;
          failed = true; primary = error;
        }
        finish(failed, primary);
        return result;
      } finally { connectionActive = false; }
    }
    function snapshotOwned() {
      return {
        schema: db.prepare("SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index','trigger') ORDER BY type,name").all(),
        rows: Object.fromEntries(tableNames.map(table => [table, db.prepare(`SELECT * FROM ${ident(table)} ORDER BY rowid`).all()])),
      };
    }
    function copySnapshot(snapshot) {
      const copy = row => Object.assign(Object.create(Object.getPrototypeOf(row)), row);
      return { schema: snapshot.schema.map(copy),
        rows: Object.fromEntries(Object.entries(snapshot.rows).map(([table, rows]) => [table, rows.map(copy)])) };
    }
    function fixtureMutation(sql, bindings) {
      assert.equal(typeof sql, 'string');
      const match = /^\s*(?:INSERT INTO|UPDATE|DELETE FROM)\s+([a-z_][a-z0-9_]*)\b/u.exec(sql);
      assert.ok(match && tables.has(match[1]) && !sql.includes(';'), 'Fixture mutation needs one declared table DML statement');
      return { sql, bindings: copyBindings(bindings) };
    }
    function stageMutation(event) {
      // Actual primitive handles privacy and owner bindings; the fixture never
      // constructs a public/private split or inserts a successful receipt.
      return { sql: stageSql, bindings: copyBindings(primitives.eventWriteBindings(event)) };
    }
    function executeFixture(row, label) {
      live();
      const observation = { label, sql: row.sql, bindings: [...row.bindings] };
      data.fixtureMutations.push(observation);
      try {
        const result = db.prepare(row.sql).run(...row.bindings);
        observation.changes = result.changes;
        return result;
      } catch (error) { observation.failure = error; throw error; }
    }
    function arrangeNow(row, label) {
      acquire();
      try {
        let failed = false, primary, result;
        try { db.exec('PRAGMA query_only=OFF'); result = executeFixture(row, label); }
        catch (error) { failed = true; primary = error; }
        finish(failed, primary);
        return result;
      } finally { connectionActive = false; }
    }
    function statementFor(sql, bindings = []) {
      live(); assert.equal(typeof sql, 'string'); data.prepares++;
      const values = copyBindings(bindings);
      const statement = Object.freeze({
        bind(...next) { live(); return statementFor(sql, next); },
        async first(column) {
          data.first++;
          return read([{ sql, bindings: values, kind: 'first', column }], true)[0];
        },
        async all() {
          data.all++;
          return read([{ sql, bindings: values, kind: 'all' }], true)[0];
        },
        async run() { live(); refuse('Atomic intake attempted a production write outside batch'); },
      });
      statements.set(statement, { sql, bindings: values });
      return statement;
    }
    const DB = Object.freeze({
      prepare(sql) { assert.equal(arguments.length, 1); return statementFor(sql); },
      async exec() { live(); refuse('Atomic intake attempted production schema/write execution'); },
      async batch(input) {
        live(); data.batchAttempts++;
        const batch = { attempt: data.batchAttempts, statements: [], committed: false, rolledBack: false };
        data.batches.push(batch);
        let owned = false;
        try {
          assert.ok(Array.isArray(input) && input.length > 0, 'Batch needs actual prepared statements');
          const rows = input.map(statement => {
            const row = statements.get(statement);
            assert.ok(row, 'Batch only accepts statements from this actual fixture port');
            appendOrReceipt(row.sql);
            return row;
          });
          acquire(); owned = true;
          let failed = false, primary, results;
          try {
            try { db.exec('PRAGMA query_only=OFF'); }
            catch (error) { data.retired = true; throw error; }
            const arrangement = nextArrangement;
            nextArrangement = null; // Consume before applying; never replay after failure.
            if (arrangement) {
              const observation = { label: arrangement.label, batchAttempt: batch.attempt, applied: false };
              data.arrangements.push(observation);
              try {
                for (const row of arrangement.rows) executeFixture(row, arrangement.label);
                observation.baseline = snapshotOwned();
                observation.applied = true;
                batch.preBatchArrangement = observation;
              } catch (error) {
                observation.failure = error;
                data.retired = true; // Failed setup must not be swallowed as product refusal.
                throw error;
              }
            }
            db.exec('BEGIN'); transactionOpen = true;
            results = rows.map(row => {
              live();
              const observed = { sql: row.sql, bindings: [...row.bindings] };
              batch.statements.push(observed);
              try {
                const actual = db.prepare(row.sql).run(...row.bindings);
                observed.changes = actual.changes;
                // These are the direct per-statement SQLite changes, not total
                // trigger changes or an invented successful D1 count.
                return { success: true, meta: { changes: actual.changes } };
              } catch (error) { observed.failure = error; throw error; }
            });
            db.exec('COMMIT'); transactionOpen = false;
            batch.committed = true; data.committedBatches++;
          } catch (error) {
            failed = true; primary = error;
          }
          // One cleanup pass owns all transaction/pre-BEGIN failures. The outer
          // catch records only; it must not replay rollback or touch SQL on ACK.
          finish(failed, primary, batch);
          if (nextLostAck) {
            nextLostAck = false;
            data.lostAckThrows++;
            const error = Error('Atomic intake fixture: acknowledgement lost after actual COMMIT');
            error.code = 'FIXTURE_POST_COMMIT_ACK_LOST';
            batch.ackError = error;
            throw error; // Outside the transaction catch: committed rows stay committed.
          }
          return results;
        } catch (error) {
          batch.failure = error;
          throw error;
        } finally { if (owned) connectionActive = false; }
      },
    });
    const h = {
      DB, env: { DB },
      get state() {
        // Observations cannot be used to reset private ownership or lifetime.
        const copyRows = rows => rows.map(row => ({ ...row, ...(row.bindings ? { bindings: [...row.bindings] } : {}) }));
        const copyArrangement = arrangement => ({ ...arrangement,
          ...(arrangement.baseline ? { baseline: copySnapshot(arrangement.baseline) } : {}) });
        return { ...data, reads: copyRows(data.reads), fixtureMutations: copyRows(data.fixtureMutations),
          batches: data.batches.map(batch => ({ ...batch, statements: copyRows(batch.statements),
            ...(batch.preBatchArrangement ? { preBatchArrangement: copyArrangement(batch.preBatchArrangement) } : {}) })),
          arrangements: data.arrangements.map(copyArrangement) };
      },
      mutate(sql, ...bindings) { live(); return arrangeNow(fixtureMutation(sql, bindings), 'fixture-mutation'); },
      insert(table, values) {
        live(); assert.ok(tables.has(table), `Unknown fixture table: ${table}`);
        const keys = Object.keys(values); assert.ok(keys.length); keys.forEach(ident);
        return h.mutate(`INSERT INTO ${ident(table)}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`, ...Object.values(values));
      },
      stageEvent(event) { live(); return arrangeNow(stageMutation(event), 'fixture-stage-event'); },
      rows(sql, ...bindings) { return read([{ sql, bindings: copyBindings(bindings), kind: 'all' }], false)[0].results; },
      snapshot() {
        const requests = [
          { sql: "SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index','trigger') ORDER BY type,name", bindings: [], kind: 'all' },
          ...tableNames.map(table => ({ sql: `SELECT * FROM ${ident(table)} ORDER BY rowid`, bindings: [], kind: 'all' })),
        ];
        const [schema, ...rows] = read(requests, false);
        return { schema: schema.results, rows: Object.fromEntries(tableNames.map((table, index) => [table, rows[index].results])) };
      },
      beforeNextBatch({ label, mutations = [], stageEvents = [] }) {
        live(); idle();
        assert.equal(nextArrangement, null, 'Only one pending fixture arrangement is admitted');
        assert.equal(typeof label, 'string'); assert.ok(label.length);
        assert.ok(Array.isArray(mutations) && Array.isArray(stageEvents));
        const rows = [...stageEvents.map(stageMutation), ...mutations.map(row => fixtureMutation(row.sql, row.bindings ?? []))];
        assert.ok(rows.length > 0 && rows.length <= 8, 'Arrangement must be a finite nonempty descriptor list');
        nextArrangement = { label, rows };
      },
      loseNextCommitAck() { live(); idle(); assert.equal(nextLostAck, false); nextLostAck = true; },
      seedPrincipal(policyVersion, { actorId, email = `${actorId}@example.test`, name = `Fixture ${actorId}` }) {
        live(); assert.ok(typeof actorId === 'string' && actorId.length); assert.equal(typeof policyVersion, 'string');
        assert.equal(typeof email, 'string'); assert.equal(typeof name, 'string');
        h.insert('users', { user_id: actorId, email, display_name: name, role: 'creator', consent_version: policyVersion,
          consented_at: PAST, created_at: PAST, updated_at: PAST });
        return { actorId, email, name, headers: {
          'oai-authenticated-user-id': actorId, 'oai-authenticated-user-email': email,
          'oai-authenticated-user-full-name': encodeURIComponent(name),
          'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8',
        } }; // Request input metadata only. Never a user/auth/context result.
      },
      retire() { data.retired = true; nextArrangement = null; nextLostAck = false; },
      close() {
        idle(); data.retired = true; nextArrangement = null; nextLostAck = false;
        if (data.closed) return;
        connectionActive = true;
        const errors = [];
        try {
          if (transactionOpen) try { db.exec('ROLLBACK'); transactionOpen = false; } catch (error) { errors.push(error); }
          try { db.exec('PRAGMA query_only=OFF'); } catch (error) { errors.push(error); }
          try { db.close(); data.closed = true; } catch (error) { errors.push(error); }
          if (errors.length) throw new AggregateError(errors, 'Atomic intake fixture close failed');
        } finally { connectionActive = false; }
      },
    };
    return h;
  } catch (primary) {
    // Own the allocation immediately; setup failure cannot leak the database.
    try { db.close(); data.closed = true; }
    catch (cleanup) { throw new AggregateError([primary, cleanup], 'Atomic intake fixture construction and close failed'); }
    throw primary;
  }
}

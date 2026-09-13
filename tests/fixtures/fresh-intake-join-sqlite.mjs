import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

// Dedicated joined fixture. The main supplies actual reviewed event primitives;
// this module supplies no saved draft, authorization result or successful guard.
export const PAST = '2000-01-01T00:00:00.000Z';
export const FUTURE = '2999-01-01T00:00:00.000Z';
const ident = value => { assert.match(value, /^[a-z_][a-z0-9_]*$/u); return value; };
const COLUMNS = "event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,schema_version,type,payload,owner_id,project_id,document_id,private_json";
const DDL = "  CREATE TABLE users(user_id TEXT PRIMARY KEY,email TEXT,display_name TEXT,role TEXT,consent_version TEXT,consented_at TEXT,created_at TEXT,updated_at TEXT);\n  CREATE TABLE capability_grants(grant_id TEXT PRIMARY KEY,user_id TEXT,capability TEXT,scope_type TEXT,organization_id TEXT,project_access_id TEXT,status TEXT,revoked_at TEXT,expires_at TEXT,updated_at TEXT);\n  CREATE TABLE organizations(organization_id TEXT PRIMARY KEY,name TEXT,owner_user_id TEXT,status TEXT,updated_at TEXT);\n  CREATE TABLE organization_memberships(membership_id TEXT PRIMARY KEY,organization_id TEXT,user_id TEXT,role TEXT,status TEXT,accepted_at TEXT,revoked_at TEXT,updated_at TEXT);\n  CREATE TABLE organization_projects(project_access_id TEXT PRIMARY KEY,organization_id TEXT,project_id TEXT,owner_user_id TEXT,status TEXT,updated_at TEXT);\n  CREATE TABLE project_memberships(membership_id TEXT PRIMARY KEY,project_access_id TEXT,organization_id TEXT,project_id TEXT,user_id TEXT,role TEXT,status TEXT,revoked_at TEXT,updated_at TEXT);\n  CREATE TABLE pilot_cohorts(cohort_id TEXT PRIMARY KEY,organization_id TEXT,status TEXT,starts_at TEXT,ends_at TEXT,created_at TEXT,participant_cap_microusd INTEGER);\n  CREATE TABLE pilot_participants(participant_id TEXT PRIMARY KEY,cohort_id TEXT,organization_id TEXT,email_normalized TEXT,user_id TEXT,status TEXT,revoked_at TEXT,role TEXT);\n  CREATE TABLE organization_security_policies(organization_id TEXT PRIMARY KEY,authentication_source TEXT,allowed_domains_json TEXT,require_mfa INTEGER,version INTEGER,updated_at TEXT);\n  CREATE TABLE organization_identity_bindings(organization_id TEXT,user_id TEXT,status TEXT,authentication_source TEXT,subject TEXT,updated_at TEXT,PRIMARY KEY(organization_id,user_id));\n  CREATE TABLE canvas_governance_requirements(requirement_id TEXT PRIMARY KEY,status TEXT,details_json TEXT,evidence_ref TEXT);\n  CREATE TABLE project_event_scopes(project_access_id TEXT,organization_id TEXT,event_id TEXT,project_sequence INTEGER);\n  CREATE TABLE impersonation_sessions(impersonation_id TEXT PRIMARY KEY,actor_user_id TEXT,persona_id TEXT,fictional_user_id TEXT,status TEXT,expires_at TEXT,updated_at TEXT,replay_session_id TEXT,started_at TEXT);\n  CREATE TABLE replay_personas(persona_id TEXT PRIMARY KEY,display_name TEXT,status TEXT);\n  CREATE TABLE project_context_sessions(context_id TEXT PRIMARY KEY,principal_user_id TEXT,organization_id TEXT,project_access_id TEXT,expires_at TEXT,revoked_at TEXT);\n  CREATE TABLE project_migration_states(project_access_id TEXT,organization_id TEXT,status TEXT,PRIMARY KEY(project_access_id,organization_id));\n  CREATE TABLE events (\n    event_id TEXT PRIMARY KEY NOT NULL, stream_id TEXT NOT NULL, sequence INTEGER NOT NULL,\n    occurred_at TEXT NOT NULL, recorded_at TEXT NOT NULL, actor TEXT NOT NULL, client_id TEXT NOT NULL,\n    correlation_id TEXT NOT NULL, causation_id TEXT, compensates_event_id TEXT,\n    schema_version INTEGER NOT NULL DEFAULT 1, type TEXT NOT NULL, payload TEXT NOT NULL\n  );\n  CREATE UNIQUE INDEX idx_events_stream_sequence ON events(stream_id, sequence);\n  CREATE TABLE event_private_payloads (private_event_id TEXT PRIMARY KEY NOT NULL,owner_id TEXT NOT NULL,project_id TEXT,document_id TEXT,private_json TEXT NOT NULL,created_at TEXT NOT NULL,redacted_at TEXT);\n  CREATE INDEX idx_event_private_payloads_owner_scope ON event_private_payloads(owner_id,project_id,document_id,redacted_at);\n  CREATE TABLE event_client_receipts (stream_id TEXT NOT NULL, client_event_id TEXT NOT NULL, event_id TEXT NOT NULL, sequence INTEGER NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(stream_id,client_event_id));\n  CREATE INDEX idx_event_client_receipts_event ON event_client_receipts(event_id);\n  CREATE TABLE IF NOT EXISTS private_content (content_id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, kind TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, redacted_at TEXT);\n  CREATE TABLE IF NOT EXISTS project_resource_scopes (project_access_id TEXT NOT NULL,resource_kind TEXT NOT NULL,resource_id TEXT NOT NULL,organization_id TEXT NOT NULL,project_id TEXT NOT NULL,owner_user_id TEXT NOT NULL,visibility TEXT NOT NULL DEFAULT 'collaborative_output',source_event_id TEXT,actor_user_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(project_access_id,resource_kind,resource_id));\n  CREATE TABLE IF NOT EXISTS organization_retention_policies(organization_id TEXT PRIMARY KEY NOT NULL,transient_days INTEGER NOT NULL DEFAULT 30,evidence_days INTEGER NOT NULL DEFAULT 365,revision_days INTEGER NOT NULL DEFAULT 365,legal_hold INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 1,updated_by_user_id TEXT NOT NULL,updated_at TEXT NOT NULL);\n  CREATE TABLE IF NOT EXISTS private_content_retention_scopes(content_id TEXT PRIMARY KEY NOT NULL,organization_id TEXT NOT NULL,project_access_id TEXT NOT NULL,project_id TEXT NOT NULL,actor_user_id TEXT NOT NULL,classification TEXT NOT NULL,policy_version INTEGER NOT NULL,assigned_expires_at TEXT NOT NULL,created_at TEXT NOT NULL);\n  CREATE TABLE IF NOT EXISTS organization_legal_holds(hold_id TEXT PRIMARY KEY NOT NULL,organization_id TEXT NOT NULL,scope_kind TEXT NOT NULL,resource_id TEXT NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',created_by_user_id TEXT NOT NULL,created_at TEXT NOT NULL,released_at TEXT);\n  CREATE TABLE event_write_stage (event_id TEXT PRIMARY KEY NOT NULL,stream_id TEXT NOT NULL,sequence INTEGER NOT NULL,occurred_at TEXT NOT NULL,recorded_at TEXT NOT NULL,actor TEXT NOT NULL,client_id TEXT NOT NULL,correlation_id TEXT NOT NULL,causation_id TEXT,compensates_event_id TEXT,schema_version INTEGER NOT NULL,type TEXT NOT NULL,payload TEXT NOT NULL,owner_id TEXT NOT NULL,project_id TEXT,document_id TEXT,private_json TEXT);\n";
const MAX_INTAKE_STATEMENTS = 16; // Current Image: 4 decisions + 4 framing events, each with one receipt.
const FIXTURE_WRITE_TABLES = new Set([
  'users', 'capability_grants', 'organizations', 'organization_memberships',
  'organization_projects', 'project_memberships', 'pilot_cohorts', 'pilot_participants',
  'organization_security_policies', 'organization_identity_bindings', 'canvas_governance_requirements',
  'impersonation_sessions', 'replay_personas', 'project_context_sessions', 'project_migration_states',
  'project_resource_scopes', 'organization_retention_policies', 'private_content_retention_scopes',
  'organization_legal_holds', 'project_event_scopes',
]);
const ACK_CODES = Object.freeze({
  storage: 'FIXTURE_FRESH_INTAKE_JOIN_STORAGE_POST_COMMIT_ACK_LOST',
  intake: 'FIXTURE_FRESH_INTAKE_JOIN_INTAKE_POST_COMMIT_ACK_LOST',
});

export function createFreshIntakeJoinSqlite({ primitives }) {
  assert.equal(primitives.EVENT_WRITE_COLUMNS, COLUMNS);
  assert.equal(typeof primitives.EVENT_WRITE_STAGE_TRIGGER_SQL, 'string');
  const normalized = sql => sql.trim().replace(/\s+/gu, ' ');
  const appendSql = `INSERT INTO event_write_stage (${primitives.EVENT_WRITE_COLUMNS}) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?`;
  const childReceiptSql = 'INSERT INTO event_client_receipts(stream_id,client_event_id,event_id,sequence,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM events WHERE event_id=? AND stream_id=? AND sequence=?)';
  const rootReceiptPrefix = 'INSERT INTO event_client_receipts(stream_id,client_event_id,event_id,sequence,created_at) VALUES(?,?,CASE WHEN ';
  const rootReceiptSuffix = ' THEN ? ELSE NULL END,?,?)';
  const personalInsertPrefix = 'INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) SELECT ?,?,?,CASE WHEN (';
  const personalInsertSuffix = ') THEN ? ELSE NULL END,?,?,NULL';
  const personalCleanupPrefix = "UPDATE private_content SET content='',redacted_at=? WHERE owner_id=? AND redacted_at IS NULL AND kind NOT IN('document-artifact','memory-structured-ledger','memory-structured-origin','memory-document-job-origin') AND expires_at<=? AND NOT EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='content' AND resource.resource_id=private_content.content_id) AND ";
  const familyCounters = () => ({ attempts: 0, commits: 0, rollbacks: 0, lostAckThrows: 0 });
  const data = { retired: false, closed: false, forbiddenWrites: 0, reentrantAttempts: 0, lateReadAttempts: 0,
    prepares: 0, first: 0, all: 0, batchAttempts: 0, committedBatches: 0, rolledBackBatches: 0,
    lostAckThrows: 0, reads: [], batches: [], fixtureMutations: [], fixtureDdl: [], arrangements: [], faults: [],
    duplicateFaultArms: 0, faultArmRefusals: 0, perFamily: { storage: familyCounters(), intake: familyCounters() } };
  let connectionActive = false, transactionOpen = false;
  const statements = new WeakMap(), faultInputs = new WeakMap();
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys=ON');
    assert.equal(Number(db.prepare('PRAGMA foreign_keys').get().foreign_keys), 1);
    db.exec(DDL);
    db.exec(primitives.EVENT_WRITE_STAGE_TRIGGER_SQL);
    data.fixtureDdl.push({ label: 'full-private-storage-base-plus-event-stage', sql: DDL },
      { label: 'actual-event-write-stage-trigger', sql: primitives.EVENT_WRITE_STAGE_TRIGGER_SQL });
    const tableNames = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => row.name);
    const tables = new Set(tableNames);
    function live() {
      if (data.retired || data.closed) { data.lateReadAttempts++; throw Error('Fresh intake join fixture retired'); }
    }
    function idle() {
      if (connectionActive) { data.reentrantAttempts++; throw Error('Fresh intake join fixture connection is already owned'); }
    }
    function acquire() { live(); idle(); connectionActive = true; }
    function refuse(message) { data.forbiddenWrites++; throw Error(message); }
    function readable(sql) {
      if (!/^\s*(?:SELECT|WITH)\b/iu.test(sql)) refuse('Fresh intake join attempted non-read SQL outside batch');
    }
    function classify(rows) {
      const sql = [];
      for (let index = 0; index < rows.length; index++) {
        if (rows[index].sql.includes(';')) refuse('Joined batch must contain single SQL statements');
        sql.push(normalized(rows[index].sql));
      }
      if (sql[0].startsWith(personalInsertPrefix) && sql[0].endsWith(personalInsertSuffix)) {
        if (rows.length > 2 || rows.length === 2 && !sql[1].startsWith(personalCleanupPrefix))
          refuse('Storage batch contains mixed or unsupported statements');
        return 'storage';
      }
      if (sql[0] === appendSql) {
        if (rows.length < 2 || rows.length > MAX_INTAKE_STATEMENTS || rows.length % 2 !== 0)
          refuse('Intake needs a bounded equal stage/receipt range');
        const count = rows.length / 2;
        for (let index = 0; index < count; index++) if (sql[index] !== appendSql)
          refuse('Intake batch contains a non-stage statement before its receipts');
        for (let index = count; index < rows.length - 1; index++) if (sql[index] !== childReceiptSql)
          refuse('Intake batch contains an unsupported child receipt');
        if (!sql.at(-1).startsWith(rootReceiptPrefix) || !sql.at(-1).endsWith(rootReceiptSuffix))
          refuse('Intake batch requires the actual final root receipt assertion');
        return 'intake';
      }
      refuse('Joined fixture attempted an unknown production write family');
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
          if (batch) { batch.rolledBack = true; data.rolledBackBatches++; data.perFamily[batch.family].rollbacks++; }
        }
        catch (error) { cleanup.push(error); }
      }
      try { db.exec('PRAGMA query_only=OFF'); } catch (error) { cleanup.push(error); }
      if (cleanup.length) {
        data.retired = true;
        throw new AggregateError(failed ? [primary, ...cleanup] : cleanup, 'Fresh intake join SQL cleanup failed; fixture retired');
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
    function fixtureMutation(sql, bindings) {
      assert.equal(typeof sql, 'string');
      const match = /^\s*(?:INSERT INTO|UPDATE|DELETE FROM)\s+([a-z_][a-z0-9_]*)\b/u.exec(sql);
      assert.ok(match && tables.has(match[1]) && FIXTURE_WRITE_TABLES.has(match[1]) && !sql.includes(';'),
        'Fixture mutation needs one declared authority/custody table DML statement; draft/event/receipt writes are production-only');
      return { sql, bindings: copyBindings(bindings) };
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
    function ownObject(input, keys) {
      assert.ok(input !== null && typeof input === 'object' && !Array.isArray(input), 'Fault descriptor must be an object');
      const actualKeys = Reflect.ownKeys(input);
      assert.equal(actualKeys.length, keys.length, 'Fault descriptor fields must be exact');
      const result = Object.create(null);
      for (let index = 0; index < keys.length; index++) {
        const key = keys[index];
        assert.ok(actualKeys.includes(key), 'Fault descriptor field is missing');
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        assert.ok(descriptor && Object.hasOwn(descriptor, 'value'), 'Fault descriptor fields must be own data properties');
        result[key] = descriptor.value;
      }
      return result;
    }
    function ownArray(input, expectedLength) {
      assert.ok(Array.isArray(input), 'Fault values must be an array');
      const length = Object.getOwnPropertyDescriptor(input, 'length');
      assert.ok(length && Object.hasOwn(length, 'value') && length.value === expectedLength, 'Fault array has the wrong length');
      const result = [];
      for (let index = 0; index < expectedLength; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
        assert.ok(descriptor && Object.hasOwn(descriptor, 'value'), 'Fault array entries must be own data properties');
        result.push(descriptor.value);
      }
      return result;
    }
    function armFault(kind, input) {
      acquire();
      try {
        const fields = ownObject(input, kind === 'before' ? ['family', 'ordinal', 'label', 'mutations'] : ['family', 'ordinal']);
        assert.ok(fields.family === 'storage' || fields.family === 'intake');
        assert.equal(fields.ordinal, 1, 'Only the first family attempt can be selected');
        assert.equal(data.perFamily[fields.family].attempts, 0, 'A fault cannot target an already attempted family');
        if (data.faults.some(fault => fault.kind === kind)) {
          data.duplicateFaultArms++;
          throw Error('A joined fault kind can be armed only once');
        }
        let mutation;
        if (kind === 'before') {
          assert.equal(fields.family, 'intake', 'Only intake has a selected pre-BEGIN boundary');
          assert.ok(typeof fields.label === 'string' && fields.label.length > 0 && fields.label.length <= 160);
          const entry = ownObject(ownArray(fields.mutations, 1)[0], ['sql', 'bindings']);
          assert.equal(entry.sql, 'UPDATE users SET role=? WHERE user_id=?', 'Only the selected role mutation is admitted');
          const bindings = ownArray(entry.bindings, 2);
          assert.equal(bindings[0], 'viewer');
          assert.ok(typeof bindings[1] === 'string' && bindings[1].length > 0);
          mutation = Object.freeze({ sql: entry.sql, bindings: Object.freeze(bindings) });
        }
        live(); // Descriptor traps cannot retire the fixture and still arm later SQL.
        const fault = { kind, family: fields.family, ordinal: fields.ordinal, matched: false, consumed: false,
          failed: false, matchAttempt: null, ...(kind === 'ack' ? { fired: false } : { label: fields.label, applied: false }) };
        data.faults.push(fault);
        if (mutation) faultInputs.set(fault, mutation);
      } catch (error) { data.faultArmRefusals++; throw error; }
      finally { connectionActive = false; }
    }
    function statementFor(sql, bindings = []) {
      live(); assert.equal(typeof sql, 'string'); data.prepares++;
      const values = copyBindings(bindings);
      const statement = Object.freeze({
        bind(...next) { live(); return statementFor(sql, next); },
        async first(column) {
          data.first++;
          if (column !== undefined && typeof column !== 'string')
            throw new TypeError('Fresh intake join first column must be a string or undefined');
          return read([{ sql, bindings: values, kind: 'first', column }], true)[0];
        },
        async all() {
          data.all++;
          return read([{ sql, bindings: values, kind: 'all' }], true)[0];
        },
        async run() { live(); refuse('Fresh intake join attempted a production write outside batch'); },
      });
      statements.set(statement, { sql, bindings: values });
      return statement;
    }
    const DB = Object.freeze({
      prepare(sql) { assert.equal(arguments.length, 1); return statementFor(sql); },
      async exec() { live(); refuse('Fresh intake join attempted production schema/write execution'); },
      async batch(input) {
        live(); data.batchAttempts++;
        const batch = { attempt: data.batchAttempts, family: null, familyOrdinal: null, statements: [], committed: false, rolledBack: false };
        data.batches.push(batch);
        let owned = false, beforeFault, ackFault;
        try {
          if (!Array.isArray(input)) refuse('Joined batch needs an actual statement array');
          acquire(); owned = true; // Descriptor traps cannot re-enter the owned connection.
          const length = Object.getOwnPropertyDescriptor(input, 'length');
          if (!length || !Object.hasOwn(length, 'value') || !Number.isSafeInteger(length.value) || length.value < 1 || length.value > MAX_INTAKE_STATEMENTS)
            refuse('Joined batch exceeds its fixed statement bound');
          const rows = [];
          for (let index = 0; index < length.value; index++) {
            const item = Object.getOwnPropertyDescriptor(input, String(index));
            if (!item || !Object.hasOwn(item, 'value')) refuse('Batch statement must be an own indexed data property');
            const row = statements.get(item.value);
            if (!row) refuse('Batch only accepts statements from this actual fixture port');
            const bindings = [];
            for (let offset = 0; offset < row.bindings.length; offset++) bindings.push(row.bindings[offset]);
            rows.push(Object.freeze({ sql: row.sql, bindings: Object.freeze(bindings) }));
          }
          live();
          batch.family = classify(rows);
          batch.familyOrdinal = ++data.perFamily[batch.family].attempts;
          for (const fault of data.faults) {
            if (!fault.consumed && fault.family === batch.family && fault.ordinal === batch.familyOrdinal) {
              fault.matched = true; fault.consumed = true; fault.matchAttempt = batch.attempt;
              if (fault.kind === 'before') beforeFault = fault; else ackFault = fault;
            }
          }
          let failed = false, primary, results;
          try {
            try { db.exec('PRAGMA query_only=OFF'); }
            catch (error) { data.retired = true; throw error; }
            if (beforeFault) {
              const arrangement = { label: beforeFault.label, family: batch.family, ordinal: batch.familyOrdinal, applied: false };
              data.arrangements.push(arrangement); batch.preBatchArrangement = arrangement;
              try {
                const row = faultInputs.get(beforeFault);
                const user = db.prepare('SELECT role FROM users WHERE user_id=?').get(row.bindings[1]);
                assert.equal(user?.role, 'creator', 'Selected boundary target must still be the declared creator');
                const changed = executeFixture(row, beforeFault.label);
                assert.equal(Number(changed.changes), 1, 'The declared boundary mutation must change exactly one actual user');
                arrangement.baseline = snapshotOwned();
                arrangement.applied = true; beforeFault.applied = true;
              } catch (error) { data.retired = true; throw error; }
            }
            live();
            db.exec('BEGIN'); transactionOpen = true;
            results = [];
            for (let index = 0; index < rows.length; index++) {
              live();
              const row = rows[index], observed = { sql: row.sql, bindings: [...row.bindings] };
              batch.statements.push(observed);
              try {
                const actual = db.prepare(row.sql).run(...row.bindings);
                observed.changes = actual.changes;
                results.push({ success: true, meta: { changes: actual.changes } });
              } catch (error) { observed.failure = error; throw error; }
            }
            db.exec('COMMIT'); transactionOpen = false;
            batch.committed = true; data.committedBatches++; data.perFamily[batch.family].commits++;
          } catch (error) { failed = true; primary = error; }
          finish(failed, primary, batch);
          if (ackFault) {
            ackFault.fired = true;
            data.lostAckThrows++; data.perFamily[batch.family].lostAckThrows++;
            const error = Error(`Fresh intake join fixture: ${batch.family} acknowledgement lost after actual COMMIT`);
            error.code = ACK_CODES[batch.family]; batch.ackError = error;
            throw error; // COMMIT and cleanup already succeeded; the catch below never touches SQL.
          }
          return results;
        } catch (error) {
          if (beforeFault && !beforeFault.applied) beforeFault.failed = true;
          if (ackFault && !ackFault.fired) ackFault.failed = true;
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
        const copyArrangement = value => ({ ...value, ...(value.baseline ? { baseline: copySnapshot(value.baseline) } : {}) });
        return { ...data, reads: copyRows(data.reads), fixtureMutations: copyRows(data.fixtureMutations),
          batches: data.batches.map(batch => ({ ...batch, statements: copyRows(batch.statements),
            ...(batch.preBatchArrangement ? { preBatchArrangement: copyArrangement(batch.preBatchArrangement) } : {}) })),
          fixtureDdl: copyRows(data.fixtureDdl), arrangements: data.arrangements.map(copyArrangement),
          faults: data.faults.map(fault => ({ ...fault })), pendingFaults: data.faults.filter(fault => !fault.consumed).length,
          perFamily: { storage: { ...data.perFamily.storage }, intake: { ...data.perFamily.intake } } };
      },
      mutate(sql, ...bindings) { live(); return arrangeNow(fixtureMutation(sql, bindings), 'fixture-mutation'); },
      insert(table, values) {
        live(); assert.ok(tables.has(table), `Unknown fixture table: ${table}`);
        const keys = Object.keys(values); assert.ok(keys.length); keys.forEach(ident);
        return h.mutate(`INSERT INTO ${ident(table)}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`, ...Object.values(values));
      },
      rows(sql, ...bindings) { return read([{ sql, bindings: copyBindings(bindings), kind: 'all' }], false)[0].results; },
      snapshot() {
        const requests = [
          { sql: "SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index','trigger') ORDER BY type,name", bindings: [], kind: 'all' },
          ...tableNames.map(table => ({ sql: `SELECT * FROM ${ident(table)} ORDER BY rowid`, bindings: [], kind: 'all' })),
        ];
        const [schema, ...rows] = read(requests, false);
        return { schema: schema.results, rows: Object.fromEntries(tableNames.map((table, index) => [table, rows[index].results])) };
      },
      beforeBatch(input) { armFault('before', input); },
      loseCommitAck(input) { armFault('ack', input); },
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
      retire() { data.retired = true; },
      close() {
        idle(); data.retired = true;
        if (data.closed) return;
        connectionActive = true;
        const errors = [];
        try {
          if (transactionOpen) try { db.exec('ROLLBACK'); transactionOpen = false; } catch (error) { errors.push(error); }
          try { db.exec('PRAGMA query_only=OFF'); } catch (error) { errors.push(error); }
          try { db.close(); data.closed = true; } catch (error) { errors.push(error); }
          if (errors.length) throw new AggregateError(errors, 'Fresh intake join fixture close failed');
        } finally { connectionActive = false; }
      },
    };
    return h;
  } catch (primary) {
    // Own the allocation immediately; setup failure cannot leak the database.
    try { db.close(); data.closed = true; }
    catch (cleanup) { throw new AggregateError([primary, cleanup], 'Fresh intake join fixture construction and close failed'); }
    throw primary;
  }
}

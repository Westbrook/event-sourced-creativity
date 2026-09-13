import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

// Synthetic fixture setup only. This module imports no production code and does
// not issue authentication/context results. Production gets only the read-only
// D1-shaped port. No production schema initializer or lifecycle writer is used.
export const PAST = '2000-01-01T00:00:00.000Z';
export const FUTURE = '2999-01-01T00:00:00.000Z';
const ident = value => { assert.match(value, /^[a-z_][a-z0-9_]*$/u); return value; };
const sha256 = value => createHash('sha256').update(value).digest('hex');
const cloneJson = value => JSON.parse(JSON.stringify(value));
const DDL = `
    CREATE TABLE organization_audit_events(audit_id TEXT,organization_id TEXT,actor_user_id TEXT,action TEXT,resource_kind TEXT,resource_id TEXT);
    CREATE TABLE document_jobs(job_id TEXT,owner_id TEXT,stream_id TEXT,document_id TEXT,correlation_id TEXT,kind TEXT,source_surface TEXT,requested_sequence INTEGER);
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
    CREATE TABLE project_event_scopes(project_access_id TEXT,organization_id TEXT,project_id TEXT,owner_user_id TEXT,event_id TEXT,project_sequence INTEGER,source_stream_id TEXT,source_sequence INTEGER,actor_user_id TEXT,created_at TEXT);
    CREATE TABLE events(event_id TEXT PRIMARY KEY,stream_id TEXT,sequence INTEGER,occurred_at TEXT,recorded_at TEXT,
      actor TEXT,client_id TEXT,correlation_id TEXT,causation_id TEXT,compensates_event_id TEXT,schema_version INTEGER,type TEXT,payload TEXT,UNIQUE(stream_id,sequence));
    CREATE TABLE event_private_payloads(private_event_id TEXT PRIMARY KEY,owner_id TEXT,private_json TEXT,project_id TEXT,document_id TEXT,redacted_at TEXT);
    CREATE TABLE impersonation_sessions(impersonation_id TEXT PRIMARY KEY,actor_user_id TEXT,persona_id TEXT,fictional_user_id TEXT,status TEXT,expires_at TEXT,updated_at TEXT,replay_session_id TEXT,started_at TEXT);
    CREATE TABLE replay_personas(persona_id TEXT PRIMARY KEY,display_name TEXT,status TEXT);
    CREATE TABLE project_resource_scopes(project_access_id TEXT,organization_id TEXT,project_id TEXT,owner_user_id TEXT,resource_kind TEXT,resource_id TEXT,visibility TEXT,actor_user_id TEXT,source_event_id TEXT,PRIMARY KEY(owner_user_id,resource_kind,resource_id));
    CREATE TABLE project_context_sessions(context_id TEXT PRIMARY KEY,principal_user_id TEXT,organization_id TEXT,project_access_id TEXT,expires_at TEXT,revoked_at TEXT);
    CREATE TABLE project_migration_states(project_access_id TEXT,organization_id TEXT,owner_user_id TEXT,status TEXT,last_owner_sequence INTEGER,PRIMARY KEY(project_access_id,organization_id));
    CREATE TABLE private_content(content_id TEXT PRIMARY KEY,owner_id TEXT,kind TEXT,content TEXT,redacted_at TEXT,expires_at TEXT);
    CREATE TABLE private_content_retention_scopes(content_id TEXT PRIMARY KEY);
    CREATE TABLE output_plan_revisions(scope_key TEXT,scope_kind TEXT,owner_user_id TEXT,project_id TEXT,document_id TEXT,organization_id TEXT,project_access_id TEXT,plan_revision_id TEXT,plan_id TEXT,revision INTEGER,confirmed_event_id TEXT,requirements_digest TEXT,source_digest TEXT,resolver_version TEXT,source_head INTEGER,target_count INTEGER,created_at TEXT);
    CREATE TABLE output_assets(scope_key TEXT,asset_id TEXT,document_id TEXT,owner_user_id TEXT,created_by_user_id TEXT,source_digest TEXT,storage_key TEXT,content_sha256 TEXT,byte_length INTEGER,mime_type TEXT,media_kind TEXT,created_event_id TEXT,created_at TEXT,redacted_at TEXT);
    CREATE TABLE output_results(scope_key TEXT,result_id TEXT,document_id TEXT,plan_revision_id TEXT,target_id TEXT,target_contract_digest TEXT,source_digest TEXT,asset_id TEXT,result_revision TEXT,content_sha256 TEXT,validation_policy TEXT,checks_status TEXT,created_by_user_id TEXT,bound_event_id TEXT,created_at TEXT);
    CREATE TABLE output_execution_grants(scope_key TEXT,grant_id TEXT,plan_revision_id TEXT,actor_user_id TEXT,payer_user_id TEXT,context_id TEXT,preflight_id TEXT,authorization_event_id TEXT,maximum_microusd INTEGER,maximum_calls INTEGER,status TEXT,expires_at TEXT,created_at TEXT);
    CREATE TABLE output_operation_slots(scope_key TEXT,slot_id TEXT,grant_id TEXT,plan_revision_id TEXT,target_id TEXT,target_contract_digest TEXT,source_digest TEXT,provider TEXT,model TEXT,route_digest TEXT,job_id TEXT,cost_reservation_id TEXT,token_reservation_id TEXT,maximum_microusd INTEGER,maximum_calls INTEGER,maximum_tokens INTEGER,attempt_ordinal INTEGER,previous_slot_id TEXT,status TEXT,outcome_event_id TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE output_plan_fulfillments(scope_key TEXT,plan_revision_id TEXT,target_id TEXT,acceptance_id TEXT,eligibility_event_id TEXT,checked_at TEXT);
    CREATE TABLE output_preflights(scope_key TEXT,preflight_id TEXT,event_id TEXT);
    CREATE TABLE output_provider_calls(scope_key TEXT,slot_id TEXT,call_key TEXT,used_microusd INTEGER,reserved_microusd INTEGER,status TEXT);
    CREATE TABLE output_target_acceptances(scope_key TEXT,acceptance_id TEXT,result_id TEXT,approval_event_id TEXT,created_at TEXT,result_revision TEXT,content_sha256 TEXT,target_contract_digest TEXT,target_id TEXT,source_digest TEXT,validation_policy TEXT);
    CREATE TABLE project_context_package_members(binding_id TEXT,organization_id TEXT,source_block_id TEXT,target_block_id TEXT,content_sha256 TEXT);
    CREATE TABLE project_context_package_bindings(binding_id TEXT,organization_id TEXT,project_access_id TEXT,project_id TEXT,document_id TEXT,package_id TEXT,version_id TEXT,update_mode TEXT,status TEXT,pending_version_id TEXT,created_by_user_id TEXT);
    CREATE TABLE organization_context_packages(package_id TEXT,organization_id TEXT,status TEXT,created_by_user_id TEXT);
    CREATE TABLE organization_context_package_versions(package_id TEXT,organization_id TEXT,version_id TEXT,version INTEGER,content_sha256 TEXT,source_project_access_id TEXT,source_document_id TEXT,status TEXT,redacted_at TEXT,approved_by_user_id TEXT,published_at TEXT,created_by_user_id TEXT);
    CREATE TABLE organization_context_package_contents(version_id TEXT,organization_id TEXT,content_json TEXT,redacted_at TEXT);
    CREATE TABLE organization_context_package_sources(version_id TEXT,organization_id TEXT,source_project_access_id TEXT,source_block_id TEXT,source_kind TEXT,content_sha256 TEXT,rights_expires_at TEXT,position INTEGER);
`;

export function createOutputProducerSqlite(t) {
  const state = { retired: false, closed: false, forbiddenWrites: 0, lateReadAttempts: 0, reentrantAttempts: 0,
    prepares: 0, first: 0, all: 0, batches: 0, reads: [], fixtureMutations: [] };
  const db = new DatabaseSync(':memory:');
  try {
  db.exec(DDL); // Executed only when a later admitted harness invokes this factory.
  const tableNames = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => row.name);
  const tables = new Set(tableNames), statements = new WeakMap();
  let connectionActive = false;
  function live() {
    if (state.retired || state.closed) { state.lateReadAttempts++; throw Error('Output producer fixture retired'); }
  }
  function idle() {
    if (connectionActive) { state.reentrantAttempts++; throw Error('Output producer fixture connection is already owned'); }
  }
  function acquire() { live(); idle(); connectionActive = true; }
  function writable(operation) {
    // Acquisition precedes every PRAGMA. A nested operation cannot reset the
    // active reader's fence, and a refused acquisition performs no cleanup.
    acquire();
    try {
      try { db.exec('PRAGMA query_only=OFF'); }
      catch (error) { state.retired = true; throw error; }
      return operation();
    } finally { connectionActive = false; }
  }
  function refuseWrite(message) { state.forbiddenWrites++; throw Error(message); }
  function readable(sql) {
    if (!/^\s*(?:SELECT|WITH)\b/iu.test(sql)) refuseWrite('Output producer attempted non-read SQL');
  }
  function transaction(reads, log = true) {
    live();
    reads.forEach(row => readable(row.sql));
    acquire();
    try {
    let started = false, failed = false, failure, results;
    try {
      db.exec('PRAGMA query_only=ON');
      db.exec('BEGIN'); started = true;
      results = reads.map(({ sql, bindings, kind, column }) => {
        live(); if (log) state.reads.push({ sql, bindings: [...bindings], kind });
        const prepared = db.prepare(sql);
        if (kind === 'first') {
          const row = prepared.get(...bindings);
          return row === undefined ? null : column === undefined ? row : row[column];
        }
        return { results: prepared.all(...bindings), success: true };
      });
      db.exec('COMMIT'); started = false;
    } catch (error) {
      // query_only is the engine-level fence for writable CTEs and any write
      // concealed behind an apparently read-only SQL prefix.
      if (/readonly|read.only|SQLITE_READONLY/iu.test(String(error?.message))) state.forbiddenWrites++;
      failed = true; failure = error;
    }
    // Attempt both cleanup operations independently. A failed rollback/reset
    // leaves the connection retired, never available for another proof.
    const cleanupErrors = [];
    if (started) try { db.exec('ROLLBACK'); } catch (error) { cleanupErrors.push(error); }
    try { db.exec('PRAGMA query_only=OFF'); } catch (error) { cleanupErrors.push(error); }
    if (cleanupErrors.length) {
      state.retired = true;
      throw new AggregateError(failed ? [failure, ...cleanupErrors] : cleanupErrors,
        'Output producer SQL cleanup failed; fixture retired');
    }
    if (failed) throw failure;
    return results;
    } finally { connectionActive = false; }
  }
  function statementFor(sql, inputBindings = []) {
    live(); assert.equal(typeof sql, 'string'); state.prepares++;
    const bindings = Object.freeze([...inputBindings]);
    const statement = {
      bind(...values) { live(); return statementFor(sql, values); },
      async first(column) { state.first++; return transaction([{ sql, bindings, kind: 'first', column }])[0]; },
      async all() { state.all++; return transaction([{ sql, bindings, kind: 'all' }])[0]; },
      async run() { live(); refuseWrite('Output producer attempted a production write'); },
    };
    statements.set(statement, { sql, bindings: [...bindings], kind: 'all' });
    return statement;
  }
  const DB = {
    prepare(sql) { return statementFor(sql); },
    async batch(input) {
      live(); state.batches++; assert.ok(Array.isArray(input));
      const reads = input.map(statement => {
        const row = statements.get(statement);
        assert.ok(row, 'Batch only accepts statements created by this actual fixture port');
        return row;
      });
      return transaction(reads); // Real SQLite transaction, real SQL and bindings.
    },
    async exec() { live(); refuseWrite('Output producer attempted schema/write execution'); },
  };
  function mutate(sql, ...bindings) {
    return writable(() => {
      const result = db.prepare(sql).run(...bindings);
      state.fixtureMutations.push({ sql, bindings: [...bindings] });
      return result;
    });
  }
  function insert(table, values) {
    assert.ok(tables.has(table), `Unknown fixture table: ${table}`);
    const keys = Object.keys(values); assert.ok(keys.length); keys.forEach(ident);
    mutate(`INSERT INTO ${ident(table)}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`, ...Object.values(values));
    return values;
  }
  const h = {
    DB, env: { DB }, state, calls: state,
    seed: mutate, mutate, insert,
    rows(sql, ...bindings) { live(); readable(sql); return transaction([{ sql, bindings, kind: 'all' }], false)[0].results; },
    snapshot() {
      live();
      // A separate fixture read, with no fabricated expected row set.
      const [schema, ...rowSets] = transaction([
        { sql: "SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name", bindings: [], kind: 'all' },
        ...tableNames.map(table => ({ sql: `SELECT * FROM ${table} ORDER BY rowid`, bindings: [], kind: 'all' })),
      ], false);
      return { schema: schema.results, rows: Object.fromEntries(tableNames.map((table, index) => [table, rowSets[index].results])) };
    },
    retire() { state.retired = true; },
    close() {
      idle(); state.retired = true;
      if (!state.closed) {
        connectionActive = true;
        try { db.close(); state.closed = true; }
        finally { connectionActive = false; }
      }
    },
  };
  if (t) t.after(() => {
    let failed = false, failure;
    try {
      assert.equal(state.forbiddenWrites, 0, 'A production write was attempted, even if caught');
      assert.equal(state.reentrantAttempts, 0, 'A reentrant operation was attempted, even if caught');
    }
    catch (error) { failed = true; failure = error; }
    try { h.close(); }
    catch (error) {
      if (failed) throw new AggregateError([failure, error], 'Output producer assertion and close failed');
      throw error;
    }
    if (failed) throw failure;
  });

  h.seedPrincipal = (policyVersion, { actorId, ownerId = actorId, projectId, shared = false } = {}) => {
    assert.ok(actorId && ownerId && projectId && typeof policyVersion === 'string');
    const identities = [...new Set([actorId, ownerId])].map(userId => ({ userId,
      email: `${userId}@example.test`, name: `Fixture ${userId}` }));
    for (const identity of identities) insert('users', { user_id: identity.userId, email: identity.email, display_name: identity.name,
      role: 'creator', consent_version: policyVersion, consented_at: PAST, created_at: PAST, updated_at: PAST });
    if (shared) {
      const { organizationId, projectAccessId, contextId } = shared;
      assert.ok(organizationId && projectAccessId && contextId);
      insert('organizations', { organization_id: organizationId, name: 'Fixture organization', owner_user_id: ownerId, status: 'active', updated_at: PAST });
      for (const identity of identities) insert('organization_memberships', { membership_id: `${organizationId}:${identity.userId}`,
        organization_id: organizationId, user_id: identity.userId, role: identity.userId === ownerId ? 'owner' : 'member',
        status: 'active', accepted_at: PAST, revoked_at: null, updated_at: PAST });
      insert('organization_projects', { project_access_id: projectAccessId, organization_id: organizationId, project_id: projectId,
        owner_user_id: ownerId, status: 'active', updated_at: PAST });
      if (actorId !== ownerId) insert('project_memberships', { membership_id: `${projectAccessId}:${actorId}`,
        project_access_id: projectAccessId, organization_id: organizationId, project_id: projectId,
        user_id: actorId, role: 'editor', status: 'active', revoked_at: null, updated_at: PAST });
      insert('project_migration_states', { project_access_id: projectAccessId, organization_id: organizationId,
        owner_user_id: ownerId, status: 'active', last_owner_sequence: 0 });
      insert('project_resource_scopes', { project_access_id: projectAccessId, organization_id: organizationId,
        project_id: projectId, owner_user_id: ownerId, resource_kind: 'manifest_version', resource_id: 'canvas-v1' });
      insert('project_context_sessions', { context_id: contextId, principal_user_id: actorId, organization_id: organizationId,
        project_access_id: projectAccessId, expires_at: FUTURE, revoked_at: null });
    }
    const actor = identities.find(identity => identity.userId === actorId);
    return { ...actor, ownerId, projectId, shared,
      headers: { 'oai-authenticated-user-id': actor.userId, 'oai-authenticated-user-email': actor.email,
        'oai-authenticated-user-full-name': encodeURIComponent(actor.name), 'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8',
        ...(shared ? { cookie: `forma_project_context=${encodeURIComponent(shared.contextId)}` } : {}) } };
  };

  h.appendEvent = ({ ownerId, projectId, documentId, type, payload, eventId, shared = false,
    actor = `user:${ownerId}`, clientId = 'fixture:authored', correlationId = 'fixture:authored',
    causationId = null, compensatesEventId = null, resources = [] }) => {
    assert.ok(ownerId && projectId && typeof type === 'string' && payload && !Array.isArray(payload));
    const sequence = Number(h.rows('SELECT COALESCE(MAX(sequence),0)+1 AS next FROM events WHERE stream_id=?', `creative:${ownerId}`)[0].next);
    eventId ??= `${documentId ?? projectId}:event:${sequence}`;
    const body = cloneJson({ project_id: projectId, ...(documentId ? { document_id: documentId } : {}), ...payload });
    assert.equal(body.project_id, projectId); assert.equal(body.document_id ?? null, documentId || null);
    const privateJson = JSON.stringify(body);
    // Synthetic retained-row arrangement, not a claim to execute event privacy
    // or a canonical append path. Only public structural identity is included.
    const publicBody = { _private_ref: eventId };
    for (const field of ['project_id', 'document_id', 'block_id', 'type', 'kind', 'relation_id', 'from_block_id', 'to_block_id',
      'target_id', 'asset_id', 'result_id', 'grant_id', 'slot_id', 'plan_revision_id']) if (body[field] !== undefined) publicBody[field] = body[field];
    insert('events', { event_id: eventId, stream_id: `creative:${ownerId}`, sequence, occurred_at: PAST, recorded_at: PAST,
      actor, client_id: clientId, correlation_id: correlationId, causation_id: causationId, compensates_event_id: compensatesEventId,
      schema_version: 1, type, payload: JSON.stringify(publicBody) });
    insert('event_private_payloads', { private_event_id: eventId, owner_id: ownerId, private_json: privateJson,
      project_id: projectId, document_id: documentId || null, redacted_at: null });
    let projectSequence = 0;
    if (shared) {
      projectSequence = Number(h.rows('SELECT COALESCE(MAX(project_sequence),0)+1 AS next FROM project_event_scopes WHERE project_access_id=? AND organization_id=?', shared.projectAccessId, shared.organizationId)[0].next);
      insert('project_event_scopes', { project_access_id: shared.projectAccessId, organization_id: shared.organizationId, project_id: projectId,
        owner_user_id: ownerId, event_id: eventId, project_sequence: projectSequence, source_stream_id: `creative:${ownerId}`,
        source_sequence: sequence, actor_user_id: actor.startsWith('user:') ? actor.slice(5) : ownerId, created_at: PAST });
      mutate('UPDATE project_migration_states SET last_owner_sequence=? WHERE project_access_id=? AND organization_id=? AND owner_user_id=?',
        sequence, shared.projectAccessId, shared.organizationId, ownerId);
      const targets = [...resources, ...(documentId ? [{ kind: 'document', id: documentId }] : []),
        ...(body.block_id ? [{ kind: 'block', id: body.block_id }] : [])];
      for (const target of targets) {
        assert.ok(typeof target.kind === 'string' && typeof target.id === 'string');
        mutate('INSERT OR IGNORE INTO project_resource_scopes(project_access_id,organization_id,project_id,owner_user_id,resource_kind,resource_id) VALUES(?,?,?,?,?,?)',
          shared.projectAccessId, shared.organizationId, projectId, ownerId, target.kind, target.id);
      }
    }
    return { eventId, sequence, projectSequence, type, privateJson, projectId, documentId: documentId || null };
  };

  h.seedDocument = ({ ownerId, projectId, documentId, blocks = [], extraEvents = [], shared = false }) => {
    const events = [], blockEventIds = {};
    events.push(h.appendEvent({ ownerId, projectId, type: 'ProjectCreated', payload: { name: 'Fixture project' }, shared }));
    events.push(h.appendEvent({ ownerId, projectId, documentId, type: 'DocumentCreated', payload: { title: 'Fixture Document', handle: 'fixture-document' }, shared }));
    for (const [index, block] of blocks.entries()) {
      assert.ok(block.id && block.type && block.properties && !Array.isArray(block.properties));
      const event = h.appendEvent({ ownerId, projectId, documentId, type: 'BlockCreated', shared,
        payload: { block_id: block.id, type: block.type, properties: cloneJson(block.properties), handle: block.handle ?? block.id,
          position: block.position ?? `a${String(index).padStart(4, '0')}` } });
      events.push(event); blockEventIds[block.id] = event.eventId;
    }
    for (const event of extraEvents) events.push(h.appendEvent({ ownerId, projectId, documentId, shared, ...event }));
    return { events, eventIds: events.map(event => event.eventId), blockEventIds,
      head: events.at(-1).sequence, projectHead: events.at(-1).projectSequence };
  };

  h.seedSharedDecisionPackage = ({ shared, projectId, documentId, blockId, type, properties,
    sourceBlockId = `${blockId}:origin`, packageId = `${blockId}:package`, versionId = `${blockId}:version`, bindingId = `${blockId}:binding` }) => {
    assert.ok(shared && projectId && documentId && blockId && typeof type === 'string');
    assert.notEqual(type, 'reference', 'This helper arranges organization-owned decisions only, not licensed source evidence');
    const clean = cloneJson(properties);
    const licensedFields = ['reference_id', 'source_expires_at', 'license_expires_at', 'rights_expires_at', 'rights_revoked',
      'source_rights_revoked', 'rights_class', 'rights_status', 'source_evidence_hash'];
    for (const field of licensedFields) assert.ok(clean[field] === undefined || clean[field] === null || clean[field] === '', 'Licensed fixture needs separately reviewed origin setup');
    const contentSha256 = sha256(JSON.stringify({ type, properties: clean }));
    const snapshot = { schema: 1, organizationId: shared.organizationId, sourceProjectAccessId: shared.projectAccessId,
      sourceDocumentId: documentId, blocks: [{ sourceBlockId, type, properties: clean, contentSha256, rightsExpiresAt: null }] };
    const contentJson = JSON.stringify(snapshot), snapshotSha256 = sha256(contentJson);
    insert('organization_context_packages', { package_id: packageId, organization_id: shared.organizationId, status: 'active' });
    insert('organization_context_package_versions', { package_id: packageId, organization_id: shared.organizationId, version_id: versionId,
      version: 1, content_sha256: snapshotSha256, source_project_access_id: shared.projectAccessId, source_document_id: documentId,
      status: 'published', redacted_at: null, approved_by_user_id: 'fixture-historical-reviewer', published_at: PAST });
    insert('organization_context_package_contents', { version_id: versionId, organization_id: shared.organizationId, content_json: contentJson, redacted_at: null });
    insert('organization_context_package_sources', { version_id: versionId, organization_id: shared.organizationId,
      source_project_access_id: shared.projectAccessId, source_block_id: sourceBlockId, source_kind: type, content_sha256: contentSha256,
      rights_expires_at: null, position: 0 });
    insert('project_context_package_bindings', { binding_id: bindingId, organization_id: shared.organizationId,
      project_access_id: shared.projectAccessId, project_id: projectId, document_id: documentId, package_id: packageId,
      version_id: versionId, update_mode: 'pinned', status: 'active', pending_version_id: null });
    insert('project_context_package_members', { binding_id: bindingId, organization_id: shared.organizationId,
      source_block_id: sourceBlockId, target_block_id: blockId, content_sha256: contentSha256 });
    return { id: blockId, type, properties: { ...clean, organization_context_package_id: packageId,
      organization_context_package_version_id: versionId, organization_context_package_binding_id: bindingId,
      organization_context_source_block_id: sourceBlockId }, packageId, versionId, bindingId, sourceBlockId,
      contentSha256, snapshotSha256, contentJson };
  };
  return h;
  } catch (error) {
    // Until the factory returns, it owns the handle even if DDL, discovery,
    // registration or construction fails. Preserve both failure identities.
    state.retired = true;
    try { if (!state.closed) { db.close(); state.closed = true; } }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Output producer fixture construction and close failed'); }
    throw error;
  }
}

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as intake from '../src/experiences/intake.ts';
import * as compiler from '../src/experiences/compiler.ts';

// New, isolated boundary qualification. Only the selected module source executes.
// Auth, storage and appendEvents are explicit test seams, not production proofs.
// No canonical test, provider, filesystem DB or held transitive graph is loaded.
const source = new URL('../', import.meta.url);
const canonicalOverride = process.env.FORMA_EXPERIENCE_CANONICAL_ROOT;
if (canonicalOverride !== undefined) assert.ok(isAbsolute(canonicalOverride), 'FORMA_EXPERIENCE_CANONICAL_ROOT must be absolute');
const canonical = canonicalOverride ?? fileURLToPath(source);
async function isolated(path, dependencies) {
  const raw = await readFile(path, 'utf8');
  let code = stripTypeScriptTypes(raw, { mode: 'strip' });
  const imports = [...code.matchAll(/^import\s+(.+?)\s+from\s+['"]([^'"]+)['"];?$/gmu)];
  for (const [statement, bindings, specifier] of imports) {
    assert.ok(Object.hasOwn(dependencies, specifier), `Unapproved dependency: ${specifier}`);
    assert.match(bindings.trim(), /^\{[\s\S]*\}$/u);
    const key = `intake-boundary-${randomUUID()}`;
    globalThis[key] = dependencies[specifier];
    code = code.replace(statement, `const ${bindings} = globalThis[${JSON.stringify(key)}]; delete globalThis[${JSON.stringify(key)}];`);
  }
  assert.doesNotMatch(code, /^import\s/mu);
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}
const subtypes = { direction: 'Creative direction', audience: 'Audience segment', message: 'Single proposition', format: 'Aspect ratio', exclusion: 'Content restriction' };
const projectModel = await isolated(`${canonical}/src/model/project-intake.ts`, {
  './block-types': { suggestedSubtype: kind => subtypes[kind] },
});
function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE authority(enabled INTEGER); INSERT INTO authority VALUES(1);
    CREATE TABLE events(event_id TEXT PRIMARY KEY,stream_id TEXT,sequence INTEGER,actor TEXT,type TEXT,payload TEXT,client_id TEXT,correlation_id TEXT,compensates_event_id TEXT,UNIQUE(stream_id,sequence));
    CREATE TABLE event_private_payloads(private_event_id TEXT PRIMARY KEY,owner_id TEXT,private_json TEXT,redacted_at TEXT);
    CREATE TABLE event_client_receipts(stream_id TEXT,client_event_id TEXT,event_id TEXT NOT NULL,sequence INTEGER,created_at TEXT,PRIMARY KEY(stream_id,client_event_id));
    CREATE TABLE private_content(content_id TEXT PRIMARY KEY,owner_id TEXT,kind TEXT,content TEXT,created_at TEXT,expires_at TEXT,redacted_at TEXT);
    CREATE TABLE organization_projects(project_id TEXT,owner_user_id TEXT);
    CREATE TABLE project_resource_scopes(resource_kind TEXT,resource_id TEXT,owner_user_id TEXT);
    CREATE TABLE private_content_retention_scopes(content_id TEXT);`);
  return db;
}
function prepared(db, sql, bindings = []) {
  return { sql, bindings,
    bind(...args) { return prepared(db, sql, args); },
    async all() { return { results: db.prepare(sql).all(...bindings) }; },
    async first() { return db.prepare(sql).get(...bindings) ?? null; },
    run() { return db.prepare(sql).run(...bindings); },
  };
}
async function harness() {
  const db = database();
  const state = { appends: 0, stores: 0, beforeAppend: null, afterAppend: null, lostAck: false, selectedContext: null, consentDenied: false, releaseChanged: false };
  const user = { userId: 'verified-personal', role: 'creator', streamId: 'creative:verified-personal', fictional: false,
    access: { permissionEpoch: 'epoch-1', capabilities: ['project.author'] } };
  const auth = { user, principal: user, impersonation: null };
  const env = { DB: { prepare: sql => prepared(db, sql) } };
  const policy = {
    POLICY_VERSION: 'test-policy',
    configuredPilotAdmissionGuard: () => ({ sql: '1', bindings: [] }),
    requireUser: async (_request, _env, role, options) => {
      assert.equal(role, 'creator'); assert.equal(options.account, 'principal');
      return { user, principal: user, impersonation: null };
    },
    requireConsent: () => state.consentDenied ? Response.json({ error: 'consent_required' }, { status: 403 }) : null,
    storePrivateContent: async (_env, owner, kind, content, scope, guard, publish, identity) => {
      assert.equal(kind, 'experience-draft'); assert.equal(scope, undefined); assert.equal(publish, undefined);
      state.stores++;
      db.prepare(`INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at)
        SELECT ?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 day') WHERE ${guard.sql}`)
        .run(identity.contentId, owner, kind, content, ...guard.bindings);
    },
  };
  const core = await isolated(new URL('worker/project-intake.ts', source), {
    '../src/model/project-intake.ts': projectModel,
    './consequential-consent.ts': { executionAdmissionGuard: () => ({ sql: '(SELECT enabled FROM authority)=1', bindings: [] }) },
    './pilot-policy.ts': policy,
    './runtime.ts': {
      makeEvent: (streamId, sequence, actor, clientId, correlationId, type, payload) => ({ eventId: randomUUID(), streamId, sequence, actor, clientId, correlationId, type, payload, compensatesEventId: null }),
      serializeEvent: row => ({ eventId: row.event_id, streamId: row.stream_id, sequence: row.sequence, actor: row.actor, type: row.type, payload: JSON.parse(row.private_json), compensatesEventId: row.compensates_event_id }),
      appendEvents: async (_env, events, options) => {
        state.appends++; assert.equal(options.retries, 1); state.beforeAppend?.();
        db.exec('BEGIN');
        try {
          let sequence = Number(db.prepare('SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?').get(user.streamId).head);
          for (const event of events) {
            event.sequence = ++sequence;
            db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?)').run(event.eventId, event.streamId, event.sequence, event.actor, event.type, JSON.stringify(event.payload), event.clientId, event.correlationId, null);
            db.prepare('INSERT INTO event_private_payloads VALUES(?,?,?,NULL)').run(event.eventId, user.userId, JSON.stringify(event.payload));
          }
          for (const sidecar of options.prepareSidecars(events)) sidecar.run();
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        state.afterAppend?.();
        if (state.lostAck) throw new Error('synthetic lost acknowledgement');
      },
    },
  });
  const api = await isolated(new URL('worker/experience-intake-api.ts', source), {
    '../src/experiences/intake.ts': { ...intake, registeredExperience: async id => {
      const release = await intake.registeredExperience(id);
      return state.releaseChanged && release ? { ...release, releaseHash: `sha256:${'0'.repeat(64)}` } : release;
    } }, '../src/experiences/compiler.ts': compiler,
    './pilot-policy.ts': policy,
    './project-access.ts': { readProjectRequestContext: async () => ({ context: state.selectedContext }) },
    './project-intake.ts': core,
  });
  const call = (path, method = 'GET', body, headers = {}) => api.handleExperienceIntake(new Request(`https://forma.test/api/experiences/${path}`, {
    method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json', origin: 'https://forma.test' }), ...headers },
    ...(body === undefined ? {} : { body: typeof body === 'string' || body instanceof ReadableStream ? body : JSON.stringify(body) }),
    ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
  }), env);
  return { db, state, user, auth, env, core, call, count: table => Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count) };
}
async function requestFor(output, intentId = randomUUID()) {
  const release = await intake.registeredExperience(output);
  assert.ok(release);
  const values = intake.initialValues(release);
  const key = output === 'image' ? 'subject' : 'claim';
  values[key] = { value: 'Authored boundary input', provenance: 'authored' };
  if (output === 'image') values.ratio = { value: { width: 1, height: 1 }, provenance: 'authored' };
  if (output === 'slides') values.evidence = { value: [1, 2, 3].map(index => ({ id: `e${index}`, text: `Evidence ${index}` })), provenance: 'authored' };
  return { intentId, experienceId: output, releaseHash: release.releaseHash, values };
}
async function prepare(h, output) {
  const request = await requestFor(output);
  const response = await h.call('drafts', 'POST', request);
  assert.equal(response.status, 200);
  const { plan } = await response.json();
  return { request, plan };
}
const commit = (h, plan) => h.call(`drafts/${plan.draftId}/commit`, 'POST', { draftHash: plan.draftHash });

test('catalog admits only context-authoring Image and Slides', async () => {
  const h = await harness();
  const result = await (await h.call('catalog')).json();
  assert.deepEqual(result.experiences.map(item => item.output.output).sort(), ['image', 'slides']);
  assert.equal(result.generation, 'unavailable'); assert.equal(h.count('events'), 0);
});
for (const output of ['image', 'slides']) {
  test(`${output}: exact typed draft, original receipt and same Document survive duplicate/lost ACK`, async () => {
    const h = await harness(); const { request, plan } = await prepare(h, output);
    h.state.lostAck = true;
    const result = await (await commit(h, plan)).json();
    assert.equal(result.status, 'complete'); assert.equal(result.generation, 'unavailable');
    assert.equal(result.documentId, plan.documentId); assert.equal(result.projectId, plan.projectId);
    assert.equal(result.draftHash, plan.draftHash); assert.ok(result.documentRoute.includes(plan.documentId));
    assert.deepEqual(result.appended.map(event => ({ type: event.type, payload: event.payload })), plan.events);
    assert.deepEqual(plan.request, request);
    assert.equal(plan.events.at(-1).payload.properties.text, output === 'image' ? '1 image' : '5 slides');
    const check = await (await h.call(`drafts/${plan.draftId}/receipt`)).json();
    const retry = await (await commit(h, plan)).json();
    assert.deepEqual(retry.appended, result.appended); assert.deepEqual(check.appended, result.appended);
    assert.equal(h.state.appends, 1); assert.equal(h.count('event_client_receipts'), plan.events.length);
  });
}
test('same owner/intent recovers original and rejects changed authored payload', async () => {
  const h = await harness(); const { request, plan } = await prepare(h, 'image');
  const recovered = await (await h.call(`drafts?intentId=${request.intentId}`)).json();
  assert.equal(recovered.plan.draftHash, plan.draftHash);
  request.values.subject.value = 'Different input';
  const conflict = await h.call('drafts', 'POST', request);
  assert.equal(conflict.status, 409); assert.equal((await conflict.json()).error, 'experience_intent_conflict');
  assert.equal(h.count('private_content'), 1); assert.equal(h.count('events'), 0);
});
test('changed active release blocks recommit but does not reinterpret the original receipt', async () => {
  const h = await harness(); const { plan } = await prepare(h, 'slides');
  const original = await (await commit(h, plan)).json();
  h.state.releaseChanged = true;
  const blocked = await commit(h, plan);
  assert.equal(blocked.status, 409); assert.equal((await blocked.json()).error, 'experience_release_changed');
  const retained = await (await h.call(`drafts/${plan.draftId}/receipt`)).json();
  assert.deepEqual(retained.appended, original.appended); assert.equal(retained.draftHash, plan.draftHash);
  assert.equal(h.state.appends, 1);
});
test('strict request prevents other outputs and caller-supplied events/authority', async () => {
  const h = await harness(); const request = await requestFor('image');
  for (const body of [{ ...request, events: [] }, { ...request, ownerId: 'another' }, { ...request, grantId: 'invented' }, { ...request, experienceId: 'model3d' }]) {
    assert.equal((await h.call('drafts', 'POST', body)).status, 400);
  }
  assert.equal(h.state.stores, 0); assert.equal(h.count('events'), 0);
});
test('existing public project-intake grammar is not widened by extraction', async () => {
  const h = await harness(); const { plan } = await prepare(h, 'image');
  const denied = await h.core.handleProjectIntake(h.env, h.auth, { action: 'project_intake', intakeAction: 'commit', events: plan.events });
  assert.equal(denied.status, 400); assert.equal(h.state.appends, 0);
  const projectId = randomUUID(), documentId = randomUUID();
  const events = [{ type: 'ProjectCreated', payload: { project_id: projectId, name: 'Project', state: 'active' } },
    { type: 'DocumentCreated', payload: { project_id: projectId, document_id: documentId, handle: 'document', title: 'Document' } },
    { type: 'EmptyCanvasChosen', payload: { project_id: projectId, document_id: documentId, source_surface: 'projects' } }];
  const accepted = await h.core.handleProjectIntake(h.env, h.auth, { action: 'project_intake', intakeAction: 'commit', events });
  assert.equal((await accepted.json()).status, 'complete');
});
test('PERSONAL and consent checks fail before storage', async () => {
  for (const mode of ['project', 'fictional', 'capability', 'consent', 'viewer']) {
    const h = await harness(); const request = await requestFor('image');
    if (mode === 'project') h.state.selectedContext = { projectId: 'organization' };
    if (mode === 'fictional') h.user.fictional = true;
    if (mode === 'capability') h.user.access.capabilities = [];
    if (mode === 'consent') h.state.consentDenied = true;
    if (mode === 'viewer') h.user.role = 'viewer';
    assert.notEqual((await h.call('drafts', 'POST', request)).status, 200);
    assert.equal(h.count('private_content'), 0);
  }
});
test('same-origin and byte limit rejection precedes storage', async () => {
  const h = await harness(); const request = await requestFor('image');
  assert.equal((await h.call('drafts', 'POST', request, { origin: 'https://other.test' })).status, 403);
  assert.equal((await h.call('drafts', 'POST', request, { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await h.call('drafts', 'POST', ' '.repeat(32769))).status, 400);
  assert.equal(h.state.stores, 0);
});
test('oversized streaming body rejects even when cancellation never settles', async () => {
  const h = await harness(); let cancelled = false;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(32769)); },
    cancel() { cancelled = true; return new Promise(() => {}); },
  });
  let timeout;
  try {
    const response = await Promise.race([h.call('drafts', 'POST', stream), new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('bounded rejection waited for cancellation')), 1000);
    })]);
    assert.equal(response.status, 400); assert.equal(cancelled, true); assert.equal(h.state.stores, 0);
  } finally { clearTimeout(timeout); }
});
test('wrong owner, redaction, expiry and content/Document/Project custody revoke retained access', async () => {
  for (const mode of ['owner', 'redacted', 'expired', 'content', 'retention', 'document', 'project']) {
    const h = await harness(); const { plan } = await prepare(h, 'image');
    if (mode === 'owner') { h.user.userId = 'different-owner'; h.user.streamId = 'creative:different-owner'; }
    if (mode === 'redacted') h.db.exec("UPDATE private_content SET redacted_at='now'");
    if (mode === 'expired') h.db.exec("UPDATE private_content SET expires_at='2000-01-01'");
    if (mode === 'content') h.db.prepare('INSERT INTO project_resource_scopes VALUES(?,?,?)').run('content', plan.draftId, 'another-owner');
    if (mode === 'retention') h.db.prepare('INSERT INTO private_content_retention_scopes VALUES(?)').run(plan.draftId);
    if (mode === 'document') h.db.prepare('INSERT INTO project_resource_scopes VALUES(?,?,?)').run('document', plan.documentId, 'another-owner');
    if (mode === 'project') h.db.prepare('INSERT INTO organization_projects VALUES(?,?)').run(plan.projectId, 'another-owner');
    assert.equal((await h.call(`drafts/${plan.draftId}`)).status, 404, mode);
    assert.equal((await commit(h, plan)).status, 404, mode);
    assert.equal(h.state.appends, 0, mode);
  }
});
test('authority or custody withdrawal at atomic append rolls back all rows', async () => {
  for (const mode of ['authority', 'document']) {
    const h = await harness(); const { plan } = await prepare(h, 'slides');
    h.state.beforeAppend = () => mode === 'authority' ? h.db.exec('UPDATE authority SET enabled=0') : h.db.prepare('INSERT INTO project_resource_scopes VALUES(?,?,?)').run('document', plan.documentId, 'another');
    const response = await commit(h, plan);
    assert.equal(response.status, 403); assert.equal((await response.json()).status, 'unknown');
    for (const table of ['events', 'event_private_payloads', 'event_client_receipts']) assert.equal(h.count(table), 0, table);
  }
});
test('post-commit authority withdrawal never returns private appended bytes', async () => {
  const h = await harness(); const { plan } = await prepare(h, 'image');
  h.state.afterAppend = () => h.db.exec('UPDATE authority SET enabled=0');
  const response = await commit(h, plan); const result = await response.json();
  assert.equal(response.status, 403); assert.equal(result.appended, undefined);
  assert.equal(h.count('events'), plan.events.length);
});
test('stale approval and incomplete original receipt cannot append new work', async () => {
  const h = await harness(); const { plan } = await prepare(h, 'image');
  assert.equal((await h.call(`drafts/${plan.draftId}/commit`, 'POST', { draftHash: 'different' })).status, 409);
  const missing = await h.call(`drafts/${plan.draftId}/receipt`);
  assert.equal(missing.status, 409); assert.equal(h.state.appends, 0);
  h.db.prepare('INSERT INTO event_client_receipts VALUES(?,?,?,?,?)').run(h.user.streamId, plan.events[0].payload.client_event_id, 'missing-original', 1, 'now');
  const response = await commit(h, plan);
  assert.equal(response.status, 409); assert.equal((await response.json()).error, 'project_intake_original_unavailable');
  assert.equal(h.state.appends, 0);
});

import './helpers/register-output-source-imports.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createSceneCostFixture } from './helpers/scene-cost-fixture.mjs';

const { appendAuditEvent } = await import('../worker/runtime.ts');
const { liveMemorySourceQuery, LIVE_MEMORY_EVENT_TYPES } = await import('../worker/memory-live-sources.ts');
const { liveMemoryAuthority, liveMemoryPrincipal } = await import('../worker/memory-live-authority.ts');
const viewType = 'DocumentArtifactViewed';
const insert = statement => statement.sql.startsWith('INSERT INTO event_write_stage(') && statement.values.includes(viewType);

async function fixture(t, options = {}) {
  t.mock.method(globalThis, 'fetch', async () => assert.fail('No live provider/network in artifact observation tests'));
  const f = await createSceneCostFixture(1, 'visual', options);
  t.after(async () => { await f.drainBackground(); f.close(); });
  const payload = { artifact_id: 'saved-scene-story', artifact_kind: 'short_story', project_id: f.projectId, document_id: f.documentId,
    artifact_revision: 0, content_sha256: createHash('sha256').update(f.content).digest('hex'), source_surface: 'document-artifact-gallery' };
  const submit = (changes = {}, action = 'hot', extra = {}) => f.request(action === 'hot' ? '/api/events/hot' : '/api/events', f.json({
    action, event: { type: viewType, payload: { ...payload, ...changes } }, ...extra,
  }));
  const count = () => Number(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='DocumentArtifactViewed'").get().n);
  const original = f.sqlite.prepare("SELECT event_id FROM events WHERE type='DocumentRenderCompleted' AND json_extract(payload,'$.artifact_id')=?").get(payload.artifact_id).event_id;
  return Object.assign(f, { payload, submit, count, original });
}

test('real personal hot append binds current revision-zero bytes, project, and erasable source identity', async t => {
  const f = await fixture(t), money = f.counts();
  const response = await f.submit(), result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.appended.length, 1); assert.equal(f.count(), 1);
  const event = result.appended[0];
  assert.equal(event.actor, 'user:' + f.owner);
  assert.deepEqual(event.payload, { ...f.payload, artifact_source_event_id: f.original, capture_version: 'personal-artifact-view-v1' });
  const secret = f.sqlite.prepare('SELECT * FROM event_private_payloads WHERE private_event_id=?').get(event.eventId);
  assert.equal(secret.owner_id, f.owner); assert.equal(secret.project_id, f.projectId); assert.equal(secret.document_id, f.documentId);
  assert.deepEqual(JSON.parse(secret.private_json), event.payload);
  assert.deepEqual(f.counts(), money); assert.equal(response.headers.get('cache-control'), 'private, no-store');
});

test('exact-view payload and alternate generic routes cannot forge or omit authoritative binding', async t => {
  const f = await fixture(t);
  for (const changes of [{ project_id: 'wrong-project' }, { document_id: 'wrong-document' }, { artifact_id: 'wrong-artifact' },
    { artifact_kind: 'slides' }, { artifact_revision: 1 }, { artifact_revision: -1 }, { artifact_revision: 0.5 }, { artifact_revision: '0' },
    { content_sha256: 'a'.repeat(64) }, { content_sha256: f.payload.content_sha256.toUpperCase() }, { content_sha256: 'bad' },
    { project_id: null }, { simulation: true }, { actor_user_id: f.owner }, { artifact_source_event_id: f.original },
    { source_surface: 'invented-inspection' }, { block_id: 'not-a-block-inspection' }]) {
    const response = await f.submit(changes); assert.ok([400, 409].includes(response.status), JSON.stringify(changes));
  }
  for (const action of ['append', 'batch', 'canvas_sync']) {
    const response = await f.submit({ artifact_revision: 99 }, action);
    assert.equal(response.status, 409, action);
  }
  assert.equal(f.count(), 0);
});

test('mixed batches do not append companion mutations when a view claim is present', async t => {
  const f = await fixture(t), before = f.sqlite.prepare('SELECT COUNT(*) AS n FROM events').get().n;
  const response = await f.submit({}, 'batch', { events: [{ type: viewType, payload: f.payload },
    { type: 'DocumentRenamed', payload: { document_id: f.documentId, new_title: 'Must not be written' } }] });
  assert.equal(response.status, 409); assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM events').get().n, before);
  assert.equal((await f.submit({}, 'append', { event: { type: viewType, payload: f.payload, compensatesEventId: f.original } })).status, 409);
});

test('removed documents, synthetic producer metadata, and expired retained bodies cannot produce view evidence', async t => {
  const f = await fixture(t);
  f.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id=?").run(f.contentRef);
  assert.equal((await f.submit()).status, 409); assert.equal(f.count(), 0);
  f.sqlite.prepare("UPDATE private_content SET expires_at='2099-01-01T00:00:00.000Z' WHERE content_id=?").run(f.contentRef);
  f.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_set(private_json,'$.simulation',1) WHERE private_event_id=?").run(f.original);
  assert.equal((await f.submit()).status, 409);
  f.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_remove(private_json,'$.simulation') WHERE private_event_id=?").run(f.original);
  await appendAuditEvent(f.env, f.streamId, 'user', 'DocumentRemoved', { project_id: f.projectId, document_id: f.documentId });
  assert.equal((await f.submit()).status, 409); assert.equal(f.count(), 0);
});

for (const mutation of ['project', 'document', 'public']) test('preexisting divergent producer envelope is not frozen as valid authority: ' + mutation, async t => {
  const f = await fixture(t);
  if (mutation === 'project') f.sqlite.prepare("UPDATE event_private_payloads SET project_id='wrong-project' WHERE private_event_id=?").run(f.original);
  if (mutation === 'document') f.sqlite.prepare("UPDATE event_private_payloads SET document_id='wrong-document' WHERE private_event_id=?").run(f.original);
  if (mutation === 'public') f.controls.afterRead = (statement, result) => {
    if (!statement.sql.startsWith('SELECT event.*,secret.owner_id')) return;
    const row = result.results.find(row => row.event_id === f.original);
    row.payload = JSON.stringify({ ...JSON.parse(row.payload), artifact_id: 'wrong-artifact' });
  };
  assert.equal((await f.submit()).status, 409); assert.equal(f.count(), 0);
});

for (const type of ['DocumentArtifactEdited', 'DocumentRemoved', 'DocumentCreated', 'DocumentRenderCompleted'])
  test('partial successful workspace page cannot hide current native source selection: ' + type, async t => {
    const f = await fixture(t);
    const hidden = await appendAuditEvent(f.env, f.streamId, type === 'DocumentRenderCompleted' ? 'worker:renderer' : 'user', type,
      { project_id: f.projectId, document_id: f.documentId, artifact_id: f.payload.artifact_id,
        artifact_kind: 'short_story', content_ref: f.contentRef, revision: 1 });
    f.controls.afterBatch = (statements, results) => {
      statements.forEach((statement, index) => {
        if (statement.sql.startsWith('SELECT * FROM events LEFT JOIN event_private_payloads') && statement.sql.includes('type NOT IN'))
          results[index].results = results[index].results.filter(event => event.event_id !== hidden.eventId);
      });
    };
    assert.equal((await f.submit()).status, 409); assert.equal(f.count(), 0);
  });

for (const malformed of ['duplicate', 'failed']) test('source proof requires a complete successful distinct row set: ' + malformed, async t => {
  const f = await fixture(t);
  f.controls.afterRead = (statement, result) => {
    if (!statement.sql.startsWith('SELECT event.*,secret.owner_id')) return;
    if (malformed === 'duplicate') result.results[1] = result.results[0];
    if (malformed === 'failed') result.success = false;
  };
  assert.equal((await f.submit()).status, 409); assert.equal(f.count(), 0);
});

test('actual current edited bytes can be observed but old or invented historical versions cannot', async t => {
  const f = await fixture(t), revised = f.content.replace('keeper', 'harbormaster');
  f.sqlite.prepare('UPDATE private_content SET content=? WHERE content_id=?').run(revised, f.contentRef);
  await appendAuditEvent(f.env, f.streamId, 'user', 'DocumentArtifactEdited', {
    project_id: f.projectId, document_id: f.documentId, artifact_id: f.payload.artifact_id, revision: 1,
    content_ref: f.contentRef, content_sha256: createHash('sha256').update(revised).digest('hex'),
  });
  assert.equal((await f.submit()).status, 409);
  assert.equal((await f.submit({ artifact_revision: 1 })).status, 409);
  const response = await f.submit({ artifact_revision: 1, content_sha256: createHash('sha256').update(revised).digest('hex') }, 'append');
  assert.equal(response.status, 200, await response.clone().text()); assert.equal(f.count(), 1);
});

for (const mutation of ['body', 'body-redacted', 'body-owner', 'body-expiry', 'source-redacted', 'source-envelope', 'consent', 'permission-epoch', 'head', 'resource-custody', 'retention-custody'])
  test('final atomic view boundary rejects source or authority race: ' + mutation, async t => {
    const f = await fixture(t);
    let fired = false;
    f.controls.beforeBatch = async statements => {
      if (!statements.some(insert)) return; f.controls.beforeBatch = null; fired = true;
      if (mutation === 'body') f.sqlite.prepare('UPDATE private_content SET content=? WHERE content_id=?').run(f.content + ' ', f.contentRef);
      if (mutation === 'body-redacted') f.sqlite.prepare("UPDATE private_content SET redacted_at='2026-01-01' WHERE content_id=?").run(f.contentRef);
      if (mutation === 'body-owner') f.sqlite.prepare("UPDATE private_content SET owner_id='another-owner' WHERE content_id=?").run(f.contentRef);
      if (mutation === 'body-expiry') f.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01' WHERE content_id=?").run(f.contentRef);
      if (mutation === 'source-redacted') f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at='2026-01-01' WHERE private_event_id=?").run(f.original);
      if (mutation === 'source-envelope') f.sqlite.prepare("UPDATE event_private_payloads SET project_id='other-project' WHERE private_event_id=?").run(f.original);
      if (mutation === 'consent') f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(f.owner);
      if (mutation === 'permission-epoch') f.sqlite.prepare("UPDATE users SET permission_epoch='withdrawn' WHERE user_id=?").run(f.owner);
      if (mutation === 'head') await appendAuditEvent(f.env, f.streamId, 'user', 'DocumentArtifactEdited', { project_id: f.projectId, document_id: f.documentId, artifact_id: f.payload.artifact_id, revision: 1 });
      if (mutation === 'resource-custody') f.sqlite.prepare(`INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at)
        VALUES('other-access','artifact',?,'other-org','other-project','other-owner','collaborative_output',?,'other-owner',?)`).run(f.payload.artifact_id, f.original, new Date().toISOString());
      if (mutation === 'retention-custody') f.sqlite.prepare(`INSERT INTO private_content_retention_scopes VALUES(?,'other-org','other-access','other-project','other-owner','governed-evidence',1,'2099-01-01','2026-01-01')`).run(f.contentRef);
    };
    const response = await f.submit(); assert.ok(fired); assert.equal(response.status, 409, await response.clone().text()); assert.equal(f.count(), 0);
  });

for (const target of ['event', 'private']) test('post-write assertion rolls back suppressed ' + target + ' insertion', async t => {
  const f = await fixture(t);
  f.sqlite.exec(target === 'event'
    ? `CREATE TRIGGER suppress_view BEFORE INSERT ON events WHEN NEW.type='DocumentArtifactViewed' BEGIN SELECT RAISE(IGNORE); END`
    : `CREATE TRIGGER suppress_view BEFORE INSERT ON event_private_payloads WHEN json_extract(NEW.private_json,'$.capture_version')='personal-artifact-view-v1' BEGIN SELECT RAISE(IGNORE); END`);
  assert.equal((await f.submit()).status, 409); assert.equal(f.count(), 0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM event_private_payloads WHERE json_extract(private_json,'$.capture_version')='personal-artifact-view-v1'").get().n, 0);
});

for (const fault of ['throw', 'missing', 'truncated', 'failed']) test('uncertain commit acknowledgment is never replayed: ' + fault, async t => {
  const f = await fixture(t); let writes = 0;
  f.controls.afterBatch = (statements, results) => {
    if (!statements.some(insert)) return; writes++;
    if (fault === 'throw') throw new Error('lost acknowledgement');
    if (fault === 'missing') results.length = 0;
    if (fault === 'truncated') results.length = 1;
    if (fault === 'failed') results[0].success = false;
  };
  const response = await f.submit(); assert.equal(response.status, 409); assert.equal((await response.json()).noAutomaticRetry, true);
  assert.equal(writes, 1); assert.equal(f.count(), 1, 'original committed receipt remains; no duplicate write');
});

test('project-governed custody is not accepted through the personal hot path', async t => {
  const f = await fixture(t, { shared: true });
  assert.equal((await f.submit()).status, 403);
  f.setScopedHeaders({});
  assert.equal((await f.submit()).status, 409); assert.equal(f.count(), 0);
});

test('a genuine exact receipt is retained but does not silently expand navigation-only Memory sources', async t => {
  const f = await fixture(t);
  for (const name of ['0020_assistant_runtime_tables.sql', '0021_assistant_specialist_consent.sql', '0025_memory_live_base.sql', '0026_memory_live_conversation.sql'])
    f.sqlite.exec(readFileSync(new URL('../drizzle/' + name, import.meta.url), 'utf8'));
  const now = Date.now(), e = { enrollment_id: 'view-fixture-enrollment', actor_user_id: f.owner, owner_user_id: f.owner,
    project_id: f.projectId, document_id: f.documentId, organization_id: null, project_access_id: null,
    permission_epoch: '', policy_version: 'personal-memory-v2', retention_days: 30,
    enrolled_at: new Date(now - 60_000).toISOString(), expires_at: new Date(now + 60_000).toISOString() };
  const principal = await liveMemoryPrincipal(f.env, f.owner); assert.ok(principal); e.permission_epoch = principal.access.permissionEpoch;
  const a = await liveMemoryAuthority(f.env, e); assert.ok(a, 'actual current authority, no fake grant');
  const response = await f.submit(); assert.equal(response.status, 200, await response.clone().text()); assert.equal(f.count(), 1);
  const q = liveMemorySourceQuery(e, a);
  const selected = f.sqlite.prepare(`SELECT event.event_id ${q.joins} WHERE ${q.condition} AND event.type='DocumentArtifactViewed'`).all(...q.bindings);
  assert.deepEqual(selected, []); assert.equal(LIVE_MEMORY_EVENT_TYPES.includes(viewType), false);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { storageFixture, snapshot, policy } from './helpers/private-identity-admission-fixture.mjs';
import { createCreationDraft, readCreationDraft, updateCreationDraft, discardCreationDraft, ensureCreationSchema, serializeCreationPayload } from '../worker/creation-store.ts';

async function fixture(t, mode = 'personal') {
  const f = await storageFixture(t, mode);
  f.state.sqlite.exec(readFileSync(new URL('../drizzle/candidates/0074_still_creation.sql', import.meta.url), 'utf8'));
  await ensureCreationSchema(f.state.env);
  return { ...f, env: f.state.env, authority: { actorUserId: f.owner, scopeKey: mode === 'personal' ? 'personal' : f.scope.projectAccessId,
    destination: mode === 'personal' ? { entryKind: 'project' } : { entryKind: 'idea', projectId: f.scope.projectId }, projectScope: f.scope, guard: { sql: '1', bindings: [] } } };
}
const payload = { schemaVersion: 1, original: 'Paul and Jon sit with their instruments.', working: { text: 'Paul and Jon' }, review: { approved: [] } };

for (const mode of ['personal','scoped']) test(`draft create/read/CAS/reload/discard preserves exact protected bytes and custody: ${mode}`, async t => {
  const f = await fixture(t, mode), created = await createCreationDraft(f.env, f.authority, payload);
  assert.equal(created.revision, 1); assert.deepEqual((await readCreationDraft(f.env, f.authority, created.draftId)).payload, payload);
  const meta = f.state.sqlite.prepare('SELECT * FROM creation_drafts').get();
  assert.ok(!JSON.stringify(meta).includes(payload.original));
  const stored = f.state.sqlite.prepare('SELECT * FROM private_content WHERE content_id=?').get(meta.content_id);
  assert.equal(stored.kind, 'creation-draft'); assert.equal(stored.content, JSON.stringify(payload));
  if (f.scope) {
    assert.equal(f.state.sqlite.prepare('SELECT visibility FROM project_resource_scopes WHERE resource_id=?').get(meta.content_id).visibility, 'actor_private');
    assert.equal(f.state.sqlite.prepare('SELECT classification FROM private_content_retention_scopes WHERE content_id=?').get(meta.content_id).classification, 'transient-private');
  }
  const revised = await updateCreationDraft(f.env, f.authority, created.draftId, 1, { ...payload, working: { text: 'With the full original retained' } });
  assert.equal(revised.revision, 2); assert.equal(revised.expiresAt, created.expiresAt);
  await assert.rejects(updateCreationDraft(f.env, f.authority, created.draftId, 1, payload), error => error.code === 'creation_revision_conflict' && error.revision === 2);
  assert.equal((await readCreationDraft(f.env, f.authority, created.draftId)).payload.working.text, 'With the full original retained');
  await discardCreationDraft(f.env, f.authority, created.draftId, 2);
  await assert.rejects(readCreationDraft(f.env, f.authority, created.draftId), /creation_draft_unavailable/);
  const bodies = f.state.sqlite.prepare("SELECT content,redacted_at FROM private_content WHERE kind='creation-draft'").all();
  assert.equal(bodies.length, 2); assert.ok(bodies.every(body => body.content === '' && body.redacted_at));
  assert.equal(f.state.sqlite.prepare('SELECT COUNT(*) n FROM creation_write_assertions').get().n, 0);
});

test('serialized protected envelope byte bound includes UTF-8 and every field', () => {
  assert.equal(Buffer.byteLength(serializeCreationPayload({ text: 'a'.repeat(999_989) })), 1_000_000);
  assert.throws(() => serializeCreationPayload({ text: 'a'.repeat(999_990) }), /creation_payload_too_large/);
  assert.throws(() => serializeCreationPayload({ text: '界'.repeat(333_330) }), /creation_payload_too_large/);
  assert.throws(() => serializeCreationPayload([]), /creation_payload_invalid/);
});

test('actor, destination, authority and expiry denial never disclose draft payload', async t => {
  const f = await fixture(t), created = await createCreationDraft(f.env, f.authority, payload);
  for (const authority of [{ ...f.authority, actorUserId: 'other' }, { ...f.authority, scopeKey: 'other' }, { ...f.authority, destination: { entryKind: 'idea', projectId: 'other' } }, { ...f.authority, guard: { sql: '0', bindings: [] } }]) {
    await assert.rejects(readCreationDraft(f.env, authority, created.draftId), /creation_draft_unavailable/);
  }
  const before = snapshot(f.state);
  await assert.rejects(createCreationDraft(f.env, { ...f.authority, guard: { sql: '0', bindings: [] } }, payload));
  assert.deepEqual(snapshot(f.state), before);
  f.state.sqlite.prepare("UPDATE creation_drafts SET expires_at='2000-01-01T00:00:00.000Z'").run();
  await assert.rejects(readCreationDraft(f.env, f.authority, created.draftId), /creation_draft_unavailable/);
});

test('custody sidecar removal denies scoped draft reads and writes', async t => {
  const f = await fixture(t, 'scoped'), created = await createCreationDraft(f.env, f.authority, payload);
  const meta = f.state.sqlite.prepare('SELECT content_id FROM creation_drafts').get();
  f.state.sqlite.prepare('DELETE FROM private_content_retention_scopes WHERE content_id=?').run(meta.content_id);
  await assert.rejects(readCreationDraft(f.env, f.authority, created.draftId), /creation_draft_unavailable/);
  await assert.rejects(updateCreationDraft(f.env, f.authority, created.draftId, 1, payload), /creation_draft_unavailable/);
});

test('CAS race before batch aborts payload and pointer publication atomically', async t => {
  const f = await fixture(t), created = await createCreationDraft(f.env, f.authority, payload), before = snapshot(f.state);
  const batch = f.env.DB.batch.bind(f.env.DB); let injected = false;
  f.env.DB.batch = async statements => {
    if (!injected) { injected = true; f.state.sqlite.prepare('UPDATE creation_drafts SET revision=2 WHERE draft_id=?').run(created.draftId); }
    return batch(statements);
  };
  await assert.rejects(updateCreationDraft(f.env, f.authority, created.draftId, 1, { ...payload, original: 'losing edit' }), error => error.code === 'creation_revision_conflict');
  assert.deepEqual(snapshot(f.state), before);
  assert.equal(f.state.sqlite.prepare('SELECT COUNT(*) n FROM creation_draft_content_versions').get().n, 1);
});

test('failed oversized autosave retains last acknowledged content and revision', async t => {
  const f = await fixture(t), created = await createCreationDraft(f.env, f.authority, payload), before = snapshot(f.state);
  await assert.rejects(updateCreationDraft(f.env, f.authority, created.draftId, 1, { text: 'a'.repeat(1_000_000) }), /creation_payload_too_large/);
  assert.deepEqual(snapshot(f.state), before);
  const loaded = await readCreationDraft(f.env, f.authority, created.draftId);
  assert.equal(loaded.revision, 1); assert.deepEqual(loaded.payload, payload);
});

test('generic hydration excludes creation drafts and reserved pointer prefix', () => {
  const source = readFileSync(new URL('../worker/pilot-policy.ts', import.meta.url), 'utf8');
  assert.match(source, /kind NOT IN\('creation-search-source','creation-draft'/);
  assert.match(source, /substr\(content_id,1,15\)!='creation-draft-'/);
});

test('lost create response replays client draft identity without publishing another body', async t => {
  const f = await fixture(t), input = { ...payload, id: 'client-retained-draft-id' };
  const first = await createCreationDraft(f.env, f.authority, input), before = snapshot(f.state);
  const again = await createCreationDraft(f.env, f.authority, structuredClone(input));
  assert.equal(first.draftId, input.id); assert.deepEqual(again, first); assert.deepEqual(snapshot(f.state), before);
  await assert.rejects(createCreationDraft(f.env, f.authority, { ...input, original: 'conflicting input' }), /creation_revision_conflict/);
  await assert.rejects(createCreationDraft(f.env, { ...f.authority, actorUserId: 'other' }, input), /creation_draft_unavailable/);
  assert.deepEqual(snapshot(f.state), before);
});

test('a publication failure after private body insertion rolls back body, scopes and pointer', async t => {
  const f = await fixture(t, 'scoped'), created = await createCreationDraft(f.env, f.authority, payload), before = snapshot(f.state);
  f.state.sqlite.exec("CREATE TRIGGER fail_creation_version BEFORE INSERT ON creation_draft_content_versions BEGIN SELECT RAISE(ABORT,'injected_publication_failure'); END");
  await assert.rejects(updateCreationDraft(f.env, f.authority, created.draftId, 1, { ...payload, original: 'failed edit' }), /injected_publication_failure/);
  assert.deepEqual(snapshot(f.state), before);
  assert.equal((await readCreationDraft(f.env, f.authority, created.draftId)).revision, 1);
});


test('discard redacts retained operation bodies and preserves another draft', async t => {
  const f = await fixture(t, 'scoped'), created = await createCreationDraft(f.env, f.authority, payload);
  const other = await createCreationDraft(f.env, f.authority, { ...payload, original: 'other draft' });
  const operation = await policy.preparePrivateContent(f.env, f.owner, 'creation-draft', JSON.stringify({ plan: 'protected operation source' }), f.scope);
  assert.match(operation.contentId, /^creation-draft-/u);
  await f.env.DB.batch([...operation.statements, f.env.DB.prepare(`INSERT INTO creation_operations(operation_id,draft_id,actor_user_id,scope_key,draft_revision,kind,state,request_hash,content_id,expires_at,created_at,updated_at) VALUES ('operation',?,?,?,1,'interpretation','review','hash',?,?,?,?)`)
    .bind(created.draftId, f.owner, f.authority.scopeKey, operation.contentId, operation.expiresAt, operation.createdAt, operation.createdAt)]);
  await discardCreationDraft(f.env, f.authority, created.draftId, 1);
  assert.equal(f.state.sqlite.prepare('SELECT content FROM private_content WHERE content_id=?').get(operation.contentId).content, '');
  assert.equal((await readCreationDraft(f.env, f.authority, other.draftId)).payload.original, 'other draft');
});

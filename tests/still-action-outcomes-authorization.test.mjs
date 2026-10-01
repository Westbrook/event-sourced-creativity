import assert from 'node:assert/strict';
import test from 'node:test';
import { createSceneCostFixture } from './helpers/scene-cost-fixture.mjs';
import { authorizeStillActionScope } from '../worker/still-action-outcomes-api.ts';
import { appendAuditEvent } from '../worker/runtime.ts';
import { loadPrivateContent } from '../worker/pilot-policy.ts';

// Real authorization, project-context SQL and history projection over disposable
// fictional SQLite records. No injected authorization success or live account.
const options = { concurrency: false, timeout: 45_000 };
async function fixture(t, shared = false) {
  let externalCalls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    externalCalls++;
    assert.fail('Authorization fixtures must not contact a provider or network');
  });
  const f = await createSceneCostFixture(1, 'visual', { shared });
  const financial = f.counts();
  let mediaCalls = 0;
  for (const method of ['get', 'put']) t.mock.method(f.env.MEDIA, method, async () => {
    mediaCalls++;
    assert.fail('Action scope authorization must not read or write media');
  });
  t.after(async () => {
    try {
      await f.drainBackground();
      assert.deepEqual(f.counts(), financial);
      assert.equal(externalCalls, 0);
      assert.equal(mediaCalls, 0);
    } finally { f.close(); }
  });
  return f;
}
const exactScope = f => ({ projectId: f.projectId, documentId: f.documentId, blockId: 'scene-reuse-direction' });
function authorize(f, scope, headers = f.sharing?.headers ?? {}, origin = 'http://localhost') {
  return authorizeStillActionScope(new Request(origin + '/api/still/action-context', { headers }), f.env, scope);
}
async function denied(value, status, error) {
  assert.ok(value instanceof Response, 'Rejected scope must not return authorized history');
  assert.equal(value.status, status);
  assert.equal((await value.json()).error, error);
  return value;
}
function granted(value, userId, scope) {
  assert.ok(!(value instanceof Response), 'An exact live scope is authorized');
  assert.equal(value.user.userId, userId);
  if (scope.projectId) assert.ok(value.projection.projects.some(project => project.id === scope.projectId));
  if (scope.documentId) assert.ok(value.projection.documents.some(document => document.id === scope.documentId && document.projectId === scope.projectId && !document.removed));
  if (scope.blockId) assert.ok(value.projection.blocks.some(block => block.id === scope.blockId && block.documentId === scope.documentId && !block.removed));
  return value;
}
async function addPersonalTarget(f, owner, prefix) {
  const scope = { projectId: prefix + '-project', documentId: prefix + '-document', blockId: prefix + '-block' };
  const streamId = 'creative:' + owner;
  await appendAuditEvent(f.env, streamId, 'user:' + owner, 'ProjectCreated', { project_id: scope.projectId, name: 'Fictional scope fixture' });
  await appendAuditEvent(f.env, streamId, 'user:' + owner, 'DocumentCreated', { project_id: scope.projectId, document_id: scope.documentId, title: 'Fictional document' });
  await appendAuditEvent(f.env, streamId, 'user:' + owner, 'BlockCreated', {
    project_id: scope.projectId, document_id: scope.documentId, block_id: scope.blockId,
    type: 'direction', handle: prefix, position: 'a', properties: { text: 'Fictional scope evidence.' },
  });
  return scope;
}
async function addOtherUser(f) {
  const userId = 'still-action-other-user', email = 'still-action-other@example.test';
  const headers = { 'oai-authenticated-user-id': userId, 'oai-authenticated-user-email': email };
  const now = new Date().toISOString();
  f.sqlite.prepare('INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(userId, email, email.split('@')[0], 'creator', 'pilot-2026-08-10', now, now, now);
  return { userId, headers, scope: await addPersonalTarget(f, userId, 'other-user') };
}

test('real Still action authorization accepts each exact personal scope and isolates users after history is warmed', options, async t => {
  const f = await fixture(t), exact = exactScope(f);
  for (const scope of [{}, { projectId: exact.projectId }, { projectId: exact.projectId, documentId: exact.documentId }, exact]) {
    const access = granted(await authorize(f, scope), f.owner, scope);
    assert.equal(access.shared, undefined);
  }
  const other = await addOtherUser(f);
  await denied(await authorize(f, exact, other.headers), 409, 'selection_unavailable');
  const access = granted(await authorize(f, other.scope, other.headers), other.userId, other.scope);
  assert.equal(access.projection.projects.some(project => project.id === f.projectId), false);
  await denied(await authorize(f, other.scope), 409, 'selection_unavailable');
});

test('real Still action authorization rejects mismatched hierarchy and rechecks removals after a cached read', options, async t => {
  const f = await fixture(t), exact = exactScope(f), other = await addPersonalTarget(f, f.owner, 'separate-personal');
  granted(await authorize(f, exact), f.owner, exact);
  for (const scope of [
    { projectId: 'unavailable-project' },
    { projectId: exact.projectId, documentId: 'unavailable-document' },
    { ...exact, blockId: 'unavailable-block' },
    { ...exact, projectId: other.projectId },
    { ...exact, documentId: other.documentId },
    { ...other, blockId: exact.blockId },
  ]) await denied(await authorize(f, scope), 409, 'selection_unavailable');
  await appendAuditEvent(f.env, f.streamId, 'user', 'BlockRemoved', { project_id: exact.projectId, document_id: exact.documentId, block_id: exact.blockId });
  await denied(await authorize(f, exact), 409, 'selection_unavailable');
  const documentScope = { projectId: exact.projectId, documentId: exact.documentId };
  granted(await authorize(f, documentScope), f.owner, documentScope);
  await appendAuditEvent(f.env, f.streamId, 'user', 'DocumentRemoved', { project_id: exact.projectId, document_id: exact.documentId });
  await denied(await authorize(f, documentScope), 409, 'selection_unavailable');
});

test('real Still action authorization confines an issued shared context to its exact project and principal', options, async t => {
  const f = await fixture(t, true), exact = exactScope(f);
  const access = granted(await authorize(f, exact), f.owner, exact);
  assert.equal(access.shared.contextId, f.sharing.contextId);
  assert.equal(access.shared.projectAccessId, f.sharing.projectAccessId);
  assert.equal(access.shared.principalUserId, f.owner);
  const personal = await addPersonalTarget(f, f.owner, 'outside-shared');
  for (const scope of [{}, personal, { ...exact, documentId: personal.documentId }, { ...exact, blockId: personal.blockId }])
    await denied(await authorize(f, scope), 409, 'selection_unavailable');
  const other = await addOtherUser(f);
  const replayed = await denied(await authorize(f, exact, { ...other.headers, ...f.sharing.headers }), 403, 'project_access_revoked');
  assert.ok(replayed.headers.get('set-cookie')?.startsWith('forma_project_context=;'));
  // Removing an invalid context never grants that principal another user's work.
  await denied(await authorize(f, exact, other.headers), 409, 'selection_unavailable');
});

test('real Still action authorization rechecks shared context expiry, revocation and live membership', options, async t => {
  const f = await fixture(t, true), exact = exactScope(f), contextId = f.sharing.contextId;
  const context = f.sqlite.prepare('SELECT expires_at,revoked_at FROM project_context_sessions WHERE context_id=?').get(contextId);
  granted(await authorize(f, exact), f.owner, exact);
  for (const field of ['expires_at', 'revoked_at']) {
    f.sqlite.prepare('UPDATE project_context_sessions SET ' + field + '=? WHERE context_id=?').run('2000-01-01T00:00:00.000Z', contextId);
    const response = await denied(await authorize(f, exact), 403, 'project_access_revoked');
    assert.ok(response.headers.get('set-cookie')?.startsWith('forma_project_context=;'));
    f.sqlite.prepare('UPDATE project_context_sessions SET ' + field + '=? WHERE context_id=?').run(context[field], contextId);
    granted(await authorize(f, exact), f.owner, exact);
  }
  f.sqlite.prepare('UPDATE organization_memberships SET revoked_at=? WHERE organization_id=? AND user_id=?')
    .run(new Date().toISOString(), f.sharing.organizationId, f.owner);
  await denied(await authorize(f, exact), 403, 'project_access_revoked');
});

test('real Still action authorization requires authentication and current consent before reading a selection', options, async t => {
  const f = await fixture(t), exact = exactScope(f);
  await denied(await authorize(f, exact, {}, 'https://still.example.test'), 401, 'authentication_required');
  f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(f.owner);
  await denied(await authorize(f, exact), 428, 'pilot_terms_required');
});

test('routed personal privacy erasure removes Still evidence and private goals without affecting another owner or source counts', options, async t => {
  const f = await fixture(t), ownScope = exactScope(f), other = await addOtherUser(f);
  const send = (path, method, body, headers = {}) => f.request(path, {
    method, headers: { origin: 'http://localhost', 'content-type': 'application/json', ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  // Run the existing explicit migration route only if the synthetic fixture
  // contains legacy rows. This never accesses a persistent/local account DB.
  const initialPrivacy = await f.request('/api/privacy/events');
  assert.equal(initialPrivacy.status, 200);
  if ((await initialPrivacy.json()).legacyAuthoredEvents > 0) {
    const migrated = await send('/api/privacy/events', 'POST', {
      action: 'migrate-historical-events', confirmation: 'MIGRATE_HISTORICAL_EVENT_CONTENT',
    });
    assert.equal(migrated.status, 200, await migrated.clone().text());
  }
  async function remember(scope, headers, id) {
    const optedIn = await send('/api/still/action-context', 'PUT', { scope, enabled: true }, headers);
    assert.equal(optedIn.status, 200, await optedIn.clone().text());
    assert.equal((await optedIn.json()).enabled, true);
    const saved = await send('/api/still/goal', 'PUT', {
      scope, text: 'Fictional private goal ' + id, criteria: ['Keep the intent clear'], remember: true,
    }, headers);
    assert.equal(saved.status, 200, await saved.clone().text());
    const context = await saved.json();
    assert.ok(context.goal.id);
    assert.ok(context.directDecisionId);
    const observed = await send('/api/still/action-observations', 'POST', {
      scope, id, surface: 'document', source: 'direct', kind: 'invocation', actionId: 'compose', decisionId: context.directDecisionId,
    }, headers);
    assert.equal(observed.status, 201, await observed.clone().text());
    return f.sqlite.prepare('SELECT content_id FROM still_action_goals WHERE goal_id=?').get(context.goal.id).content_id;
  }
  const ownGoal = await remember(ownScope, {}, 'own-invocation');
  const otherGoal = await remember(other.scope, other.headers, 'other-invocation');
  await f.drainBackground();
  const ordinaryContent = await loadPrivateContent(f.env, f.owner, 'all', undefined, [ownGoal, f.contentRef]);
  assert.equal(ordinaryContent[f.contentRef], f.content, 'The ordinary private-content reader still returns permitted output content');
  assert.equal(Object.hasOwn(ordinaryContent, ownGoal), false, 'Remembered goals are excluded even when their exact content ID is requested');
  const tables = ['still_action_preferences', 'still_action_receipts', 'still_action_observations', 'still_action_goals'];
  const ownedRows = (table, owner) => f.sqlite.prepare('SELECT * FROM ' + table + ' WHERE owner_id=? ORDER BY rowid').all(owner);
  const otherBefore = Object.fromEntries(tables.map(table => [table, ownedRows(table, other.userId)]));
  for (const table of tables) {
    assert.ok(ownedRows(table, f.owner).length > 0, table + ' has own evidence to erase');
    assert.ok(otherBefore[table].length > 0, table + ' has independent evidence to preserve');
  }
  const sourceBefore = f.sqlite.prepare('SELECT * FROM events ORDER BY rowid').all();
  const otherPrivateBefore = ownedRows('private_content', other.userId);
  const otherEventBodiesBefore = ownedRows('event_private_payloads', other.userId);
  const ownBodiesBefore = f.sqlite.prepare('SELECT count(*) AS count FROM event_private_payloads WHERE owner_id=? AND redacted_at IS NULL').get(f.owner).count;
  assert.ok(ownBodiesBefore > 0);
  const privacyBefore = await f.request('/api/privacy/events');
  assert.equal(privacyBefore.status, 200);
  assert.equal((await privacyBefore.json()).governedAuthoredEvents, ownBodiesBefore);
  const erased = await send('/api/privacy/events', 'POST', {
    action: 'erase-personal-authored-context', confirmation: 'ERASE_MY_PERSONAL_AUTHORED_CONTEXT',
  });
  const result = await erased.json();
  assert.equal(erased.status, 200, JSON.stringify(result));
  assert.equal(result.authoredContentErasurePending, false);
  assert.equal(result.erasedAuthoredEventBodies, ownBodiesBefore, 'Adding Still deletion statements must not shift the existing event-body count');
  for (const table of tables) {
    assert.equal(ownedRows(table, f.owner).length, 0, table + ' own evidence erased');
    assert.deepEqual(ownedRows(table, other.userId), otherBefore[table], table + ' other evidence unchanged');
  }
  const erasedGoal = f.sqlite.prepare('SELECT content,redacted_at FROM private_content WHERE content_id=?').get(ownGoal);
  assert.equal(erasedGoal.content, '');
  assert.ok(erasedGoal.redacted_at);
  assert.deepEqual(ownedRows('private_content', other.userId), otherPrivateBefore);
  assert.ok(f.sqlite.prepare('SELECT content FROM private_content WHERE content_id=?').get(otherGoal).content.length > 0);
  assert.deepEqual(ownedRows('event_private_payloads', other.userId), otherEventBodiesBefore);
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM events ORDER BY rowid').all(), sourceBefore, 'Event IDs, sequence positions, and source rows survive personal body erasure');
  const privacyAfter = await f.request('/api/privacy/events');
  assert.equal(privacyAfter.status, 200);
  const after = await privacyAfter.json();
  assert.equal(after.legacyAuthoredEvents, 0);
  assert.equal(after.governedAuthoredEvents, 0);
});

test('semantic workflow replay and reads recheck real shared permission after recording', options, async t => {
  const f=await fixture(t,true),scope={projectId:f.projectId,documentId:f.documentId};
  const send=(path,method,body)=>f.request(path,{method,headers:{origin:'http://localhost','content-type':'application/json',...f.sharing.headers},...(body?{body:JSON.stringify(body)}:{})});
  const enabled=await send('/api/still/action-context','PUT',{scope,enabled:true});
  assert.equal(enabled.status,200,await enabled.clone().text());
  const context=await enabled.json(),occurredAt=new Date().toISOString();
  const report={scope,id:'shared-workflow',kind:'workflow',actionId:'compose',source:'direct',surface:'creation-review',decisionId:context.directDecisionId,workflow:{version:'still-workflow-v1',instanceId:'fictional-draft',stage:'final-review',transition:'final-review',status:'confirmed',target:{kind:'creation-draft',id:'fictional-draft',revision:'1'},draftRevision:1,occurredAt}};
  const recorded=await send('/api/still/action-observations','POST',report);assert.equal(recorded.status,201,await recorded.clone().text());
  const eventsBefore=f.sqlite.prepare('SELECT count(*) AS count FROM events').get().count;
  f.sqlite.prepare('UPDATE organization_memberships SET revoked_at=? WHERE organization_id=? AND user_id=?').run(occurredAt,f.sharing.organizationId,f.owner);
  assert.equal((await send('/api/still/action-observations','POST',report)).status,403,'Duplicate replay must still have live resource access');
  const query=new URLSearchParams(scope);
  assert.equal((await send('/api/still/action-context?'+query,'GET')).status,403,'Retained diagnostics do not bypass current read authorization');
  assert.equal(f.sqlite.prepare('SELECT count(*) AS count FROM events').get().count,eventsBefore,'Semantic reports never advance creative history');
});

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { completedResultFixture, guardInventory, inspectGuestImageResultInventory, guestImageResultInventoryData,
  assertGuestImageResultInventoryCurrent, deeplyFrozen, sha, admittedRunFixture, runGuestImage, rows, snapshot,
  nativeEvents, request, payer, origin, redactSource, addLease, insert } from './helpers/guest-image-result-inventory-fixture.mjs';
import { inspectAfterRegistryAdvance } from './helpers/guest-image-result-inventory-fixture.mjs';
const [{ digest, canonicalJson }, { inspectGuestImageStageInventory }, { inspectGuestImageSaveInventory }] = await Promise.all([
  import('../src/experiences/compiler.ts'), import('../worker/experience-guest-image-stage-inventory.ts'),
  import('../worker/experience-guest-image-claim-inventory.ts'),
]);
const inspect = (f, req = f.request, env = f.env, input = { proof: f.proof }, deadline) => inspectGuestImageResultInventory(req, env, input, deadline);
async function denied(f, t, operation = () => inspect(f)) {
  const guard = guardInventory(f, t); try { await assert.rejects(Promise.resolve().then(operation)); guard.assertUntouched(); } finally { guard.close(); }
}
function configurationTripwire(f, t) {
  let accesses = 0;
  for (const name of ['OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_IMAGE_MODEL', 'FAL_KEY', 'FAL_IMAGE_MODEL', 'FORMA_USER_COST_LIMIT_USD'])
    Object.defineProperty(f.env, name, { configurable: true, get() { accesses++; throw Error('historical inventory cannot reconstruct production authority'); } });
  t.after(() => assert.equal(accesses, 0));
}
function capture(t, f, guard, memory) {
  const statements = guard.statements, metrics = { memory, statements: statements.length, uniqueSql: new Set(statements.map(row => row.sql)).size,
    maxBindings: Math.max(0, ...statements.map(row => row.bindings)), maxSqlBytes: Math.max(0, ...statements.map(row => row.sqlBytes)),
    inventoryProviderCalls: 0, inventoryMediaOperations: 0, inventoryMutations: 0 };
  t.diagnostic(JSON.stringify(metrics));
  if (process.env.FORMA_RESULT_INVENTORY_SQL_CAPTURE_DIR) {
    const rank = { table: 0, index: 1, view: 2, trigger: 3 };
    const schema = snapshot(f).schema.filter(row => row.sql && !row.name.startsWith('sqlite_'))
      .sort((a, b) => rank[a.type] - rank[b.type] || a.name.localeCompare(b.name)).map(row => row.sql);
    writeFileSync(join(process.env.FORMA_RESULT_INVENTORY_SQL_CAPTURE_DIR, memory ? 'complete-memory.json' : 'absent-memory.json'),
      JSON.stringify({ memory, schema, statements }, null, 2) + '\n', { flag: 'wx' });
  }
}
async function assertOriginalManifest(f, data) {
  const { manifest: m, review } = data, { event, body, job, slot, token, cost } = f.completed;
  deeplyFrozen(data); assert.equal(data.manifestDigest, await digest(m));
  assert.equal(m.version, 1); assert.equal(m.kind, 'original-image-completed-result');
  assert.equal(m.sessionId, f.session.sessionId); assert.equal(m.guestSubject, f.session.guestSubject);
  assert.equal(m.projectId, f.session.projectId); assert.equal(m.documentId, f.session.documentId);
  assert.deepEqual([m.sourceHead, m.sourceSaveHead, m.quoteHead, m.runHead, m.resultHead],
    [f.committed.head, f.committed.head + 1, f.committed.head + 3, f.committed.head + 6, f.committed.head + 14]);
  assert.deepEqual(m.sourceEventIds, f.committed.eventIds); assert.equal(m.originalPayerUserId, payer);
  assert.equal(m.generationId, body.generation_id); assert.equal(m.completionEventId, event.eventId); assert.equal(m.completedAt, job.completed_at);
  assert.equal(m.usageEventId, nativeEvents(f).find(row => row.type === 'GenerationUsageRecorded').eventId);
  assert.deepEqual(m.nativeIdentity, { scopeKey: slot.scope_key, jobId: job.job_id, slotId: slot.slot_id,
    executionGrantId: slot.grant_id, issuerGrantId: f.issued.grantId, consumptionId: f.admitted.consumptionId,
    planRevisionId: slot.plan_revision_id, targetId: slot.target_id, preflightId: f.admitted.preflightId });
  assert.deepEqual(m.financialReceipt, { period: token.period, tokenReservationId: token.reservation_id,
    costReservationId: cost.reservation_id, usedTokens: 400, usedMicrousd: 4200 });
  const privateRows = [body.output_ref, body.prompt_ref].map(id => rows(f, 'private_content').find(row => row.content_id === id));
  assert.deepEqual(m.privateContents.map(row => [row.contentId, row.kind, row.bytes, row.createdAt, row.expiresAt]),
    privateRows.map(row => [row.content_id, row.kind, Buffer.byteLength(row.content), row.created_at, row.expires_at]));
  for (let index = 0; index < privateRows.length; index++) assert.equal(m.privateContents[index].contentDigest, await digest(privateRows[index].content));
  assert.equal(m.expiresAt, [rows(f, 'experience_guest_sources')[0].expires_at, ...privateRows.map(row => row.expires_at)].sort()[0]);
  assert.deepEqual(m.object, { storageKey: rows(f, 'output_native_storage_writes')[0].storage_key,
    contentSha256: sha(f.provider.imageBytes), mimeType: 'image/png', width: 1024, height: 1024,
    publicationEventId: event.eventId, recordedDescriptorOnly: true });
  assert.deepEqual(review, { version: 1, kind: 'guest-image-result-inventory', sessionId: m.sessionId, documentId: m.documentId, projectId: m.projectId,
    generationId: m.generationId, originalPayerUserId: payer, manifestDigest: data.manifestDigest, sourceHead: m.sourceHead, resultHead: m.resultHead,
    expiresAt: m.expiresAt, privateBodyCount: 2, recordedObjectCount: 1, custodyTransferred: false, publicReadAvailable: false, freshBytesVerified: false });
  for (const secret of [f.subject, f.session.sessionToken, f.session.claimToken, privateRows[0].content, privateRows[1].content, 'SELECT '])
    assert.equal(JSON.stringify(review).includes(secret), false, 'review exposes no source, private body, token or SQL');
}

// Execute only these two genuine positives first. Contract/adversarial cases and
// actual D1 are separately gated after both pass on frozen reviewed sources.
for (const memory of [false, true]) test(`positive completed guest result inventory with ${memory ? 'complete' : 'absent'} Memory is exact and read-only`, { timeout: 30000 }, async t => {
  const f = await completedResultFixture(t, { memory }); configurationTripwire(f, t); const guard = guardInventory(f, t);
  try {
    const cap = await inspect(f); assert.deepEqual(Reflect.ownKeys(cap), []); assert.ok(Object.isFrozen(cap));
    const original = guestImageResultInventoryData(f.request, f.env, cap); await assertOriginalManifest(f, original);
    await assertGuestImageResultInventoryCurrent(f.request, f.env, cap);
    const freshRequest = request(), replay = await inspect(f, freshRequest), current = guestImageResultInventoryData(freshRequest, f.env, replay);
    assert.deepEqual(current.manifest, original.manifest); assert.equal(current.manifestDigest, original.manifestDigest); assert.deepEqual(current.review, original.review);
    guard.assertUntouched();
  } finally { capture(t, f, guard, memory); guard.close(); }
});

test('historical result manifest survives production revocation and current provider configuration changes', async t => {
  const f = await completedResultFixture(t); let guard = guardInventory(f, t), original;
  try { original = guestImageResultInventoryData(f.request, f.env, await inspect(f)); } finally { guard.close(); }
  f.sqlite.exec('UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms+1');
  f.sqlite.exec("UPDATE experience_sponsor_campaigns SET enabled=0,policy_json='{}',policy_digest='replaced'");
  f.sqlite.exec("UPDATE experience_sponsor_resource_policies SET enabled=0,limits_json='{}',limits_digest='replaced'");
  f.sqlite.exec('UPDATE experience_guest_source_policies SET revoked_at_ms=1');
  configurationTripwire(f, t); guard = guardInventory(f, t);
  try { const current = guestImageResultInventoryData(f.request, f.env, await inspect(f));
    assert.deepEqual(current.manifest, original.manifest); assert.equal(current.manifestDigest, original.manifestDigest); assert.deepEqual(current.review, original.review);
  } finally { guard.close(); }
});

test('authentic completed result remains historical after an isolated genuinely compiled current registry advance', { timeout: 60000 }, async t => {
  const result = await inspectAfterRegistryAdvance(); assert.equal(result.currentDefaultRejectsOriginalFacts, true);
  assert.equal(result.retainedPredicateAcceptsOriginalFacts, true); assert.equal(result.historicalDatabaseUnchanged, true);
  assert.equal(result.objectDescriptorsUnchanged, true); assert.equal(result.productionMigration, false); t.diagnostic(JSON.stringify(result));
});

test('later unrelated payer usage leaves original completed-result manifest identity unchanged', async t => {
  const f = await completedResultFixture(t); let guard = guardInventory(f, t), original;
  try { original = guestImageResultInventoryData(f.request, f.env, await inspect(f)); } finally { guard.close(); }
  const calls = rows(f, 'output_provider_calls'), token = rows(f, 'budget_reservations'), cost = rows(f, 'cost_budget_reservations');
  f.sqlite.exec('UPDATE budget_counters SET used_tokens=used_tokens+20'); f.sqlite.exec('UPDATE cost_budget_counters SET used_microusd=used_microusd+100');
  assert.deepEqual(rows(f, 'output_provider_calls'), calls); assert.deepEqual(rows(f, 'budget_reservations'), token); assert.deepEqual(rows(f, 'cost_budget_reservations'), cost);
  guard = guardInventory(f, t);
  try { const current = guestImageResultInventoryData(f.request, f.env, await inspect(f)); assert.deepEqual(current.manifest, original.manifest); assert.equal(current.manifestDigest, original.manifestDigest); }
  finally { guard.close(); }
});

test('retained stage and V3 hooks preserve genuine current defaults and bind the whole original release before dependent reads', async t => {
  const f = await completedResultFixture(t), guard = guardInventory(f, t);
  try {
    const [{ collectRetainedGuestImageHistory }, stage, format, sponsor, compiler, { authoritativeCreativeContext }] = await Promise.all([
      import('../worker/experience-guest-image-history.ts'), import('../worker/experience-guest-image-stage-facts.ts'),
      import('../worker/experience-sponsor-image-format.ts'), import('../worker/experience-guest-sponsor-contract.ts'),
      import('../src/experiences/compiler.ts'), import('../worker/context-authority.ts'),
    ]);
    const history = await collectRetainedGuestImageHistory(f.request, f.env, { proof: f.proof });
    const token = await format.createRetainedSponsorImageFormat(f.release, f.release.releaseHash);
    const originalStage = await stage.collectGuestImageStageFacts(history), retainedStage = await stage.collectRetainedGuestImageStageFacts(history, token);
    assert.deepEqual(retainedStage, originalStage, 'old/default and retained engines return identical genuine current-release facts');
    const evidence = { sessionBinding: history.saved.sessionBinding.binding, authorization: f.authorizationInput,
      native: { sourceRevision: f.committed.head + 3, preflight: f.quoted.preflight,
        contextSnapshot: authoritativeCreativeContext(nativeEvents(f).filter(event => event.sequence <= f.committed.head + 3),
          { projectId: f.session.projectId, documentId: f.session.documentId }).snapshot,
        transport: originalStage.transport } };
    const policy = history.saved.approval.policy, original = await sponsor.compileGuestSponsorEnvelope(policy, f.envelope, evidence);
    assert.deepEqual(await sponsor.compileRetainedGuestSponsorEnvelope(policy, f.envelope, evidence, token), original);
    assert.equal(original.qualification, 'validation-only');
    const input = structuredClone({ policy, envelope: f.envelope, evidence });
    const pending = sponsor.compileRetainedGuestSponsorEnvelope(input.policy, input.envelope, input.evidence, token);
    input.policy.payerUserId = 'mutated-after-call'; input.envelope.ownerUserId = 'mutated-after-call'; input.evidence.authorization.explicitAuthorization = false;
    assert.deepEqual(await pending, original, 'new V3 entry captures every caller input before awaiting');
    const definition = structuredClone(f.release.definition), output = structuredClone(f.release.output); definition.revision++; output.result = '1 alternate retained image';
    const compiled = await compiler.compileExperience(definition, { version: 'forma-experience-context@2', qualification: 'context-authoring',
      interactions: Object.fromEntries(Object.values(f.release.interactions).map(value => [value.id, value])), outputs: { [output.id]: output }, copy: f.release.copy });
    assert.equal(compiled.ok, true); const different = await format.createRetainedSponsorImageFormat(compiled.release, compiled.release.releaseHash);
    for (const wrong of [{}, structuredClone(token), different]) {
      const before = guard.statements.length;
      await assert.rejects(Promise.resolve().then(() => stage.collectRetainedGuestImageStageFacts(history, wrong)));
      assert.equal(guard.statements.length, before, 'foreign/forged retained token rejected before a dependent database read');
      await assert.rejects(Promise.resolve().then(() => sponsor.compileRetainedGuestSponsorEnvelope(policy, f.envelope, evidence, wrong)));
    }
    for (const mutate of [value => { value.policy.guestAdmission.releaseHash = compiled.release.releaseHash; }, value => { value.envelope.guestSource.releaseHash = compiled.release.releaseHash; }]) {
      const changed = structuredClone({ policy, envelope: f.envelope }); mutate(changed);
      await assert.rejects(sponsor.compileRetainedGuestSponsorEnvelope(changed.policy, changed.envelope, evidence, token));
    }
  } finally { guard.close(); }
});

test('original quote expiry does not expire retained completed-result custody history', { timeout: 15000 }, async t => {
  const f = await completedResultFixture(t, { policyChange: policy => { policy.maximumGrantLifetimeMs = 4000; } });
  const guard = guardInventory(f, t);
  try {
    const original = guestImageResultInventoryData(f.request, f.env, await inspect(f)), quote = rows(f, 'output_preflights')[0];
    assert.ok(quote.expires_at < original.manifest.expiresAt); const start = performance.now();
    while (!f.sqlite.prepare("SELECT ?<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AS due").get(quote.expires_at).due) {
      assert.ok(performance.now() - start < 10000); await delay(10);
    }
    const current = guestImageResultInventoryData(f.request, f.env, await inspect(f));
    assert.deepEqual(current.manifest, original.manifest); assert.equal(current.manifestDigest, original.manifestDigest);
  } finally { guard.close(); }
});

for (const kind of ['session revoked', 'custody policy revoked', 'source tombstone', 'planner tombstone', 'prompt expiry', 'active claim lease', 'expired claim lease'])
  test(`result inventory refuses ${kind} without repairing retained history`, async t => {
    const f = await completedResultFixture(t);
    if (kind === 'session revoked') f.sqlite.exec('UPDATE experience_guest_sessions SET revoked_at_ms=created_at_ms+1');
    if (kind === 'custody policy revoked') f.sqlite.exec('UPDATE experience_guest_policies SET revoked_at_ms=1');
    if (kind === 'source tombstone') redactSource(f);
    if (kind === 'planner tombstone') f.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=?").run(new Date().toISOString(), f.completed.body.output_ref);
    if (kind === 'prompt expiry') {
      const body = rows(f, 'private_content').find(row => row.content_id === f.completed.body.prompt_ref);
      await delay(20); const expiry = new Date(Date.now() - 1).toISOString(); assert.ok(expiry > body.created_at);
      f.sqlite.prepare('UPDATE private_content SET expires_at=? WHERE content_id=?').run(expiry, body.content_id);
    }
    if (kind.includes('claim lease')) addLease(f, kind === 'expired claim lease');
    await denied(f, t);
  });

test('genuine original source lifetime expires without changing its recorded completed graph', { timeout: 15000 }, async t => {
  const f = await completedResultFixture(t, { draftLifetimeMs: 5000 }), source = rows(f, 'experience_guest_sources')[0], start = performance.now();
  while (!f.sqlite.prepare("SELECT ?<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AS due").get(source.expires_at).due) {
    assert.ok(performance.now() - start < 10000); await delay(10);
  }
  await denied(f, t);
});

const corruptions = {
  'planner body content': f => f.sqlite.prepare('UPDATE private_content SET content=? WHERE content_id=?').run('{"title":"replacement"}', f.completed.body.output_ref),
  'prompt ownership': f => f.sqlite.prepare("UPDATE private_content SET owner_id='foreign-owner' WHERE content_id=?").run(f.completed.body.prompt_ref),
  'completion private provider identity': f => {
    const row = rows(f, 'event_private_payloads').find(row => row.private_event_id === f.completed.event.eventId), value = JSON.parse(row.private_json);
    value.provider_submission_id = 'foreign-provider-submission'; f.sqlite.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run(JSON.stringify(value), row.private_event_id);
  },
  'storage hash': f => f.sqlite.exec(`UPDATE output_native_storage_writes SET content_sha256='${'f'.repeat(64)}'`),
  'missing storage acknowledgment': f => f.sqlite.exec('UPDATE output_native_storage_writes SET write_acknowledged=0'),
  'storage publication link': f => f.sqlite.prepare('UPDATE output_native_storage_writes SET publication_event_id=?').run(f.committed.eventIds[0]),
  'changed native source revision': f => f.sqlite.exec('UPDATE output_plan_revisions SET source_head=source_head+1'),
  'wrong Run command digest': f => f.sqlite.exec("UPDATE output_commands SET request_digest='changed' WHERE action='run'"),
  'unknown financial exposure': f => f.sqlite.exec("UPDATE output_provider_calls SET status='uncertain',used_microusd=NULL WHERE stage_key='image:initial'"),
  'changed paired cost settlement': f => f.sqlite.exec('UPDATE cost_budget_reservations SET used_microusd=used_microusd+1'),
  'changed provider response identity': f => f.sqlite.exec("UPDATE output_provider_calls SET provider_response_id='different' WHERE stage_key='image:initial'"),
  'extra private body': f => { const body = rows(f, 'private_content').find(row => row.content_id === f.completed.body.output_ref); insert(f, 'private_content', { ...body, content_id: randomUUID() }); },
  'extra private event body': f => { const body = rows(f, 'event_private_payloads').find(row => row.private_event_id === f.completed.event.eventId); insert(f, 'event_private_payloads', { ...body, private_event_id: randomUUID() }); },
  'extra native storage object': f => { const row = rows(f, 'output_native_storage_writes')[0]; insert(f, 'output_native_storage_writes', { ...row, storage_key: row.storage_key.replace(/[^/]+$/u, `${randomUUID()}.png`) }); },
  'extra output plan revision': f => { const row = rows(f, 'output_plan_revisions')[0]; insert(f, 'output_plan_revisions', { ...row, plan_revision_id: randomUUID(), revision: row.revision + 1 }); },
  'duplicate native completion': f => appendAdverseEvent(f, 'GenerationCompleted'),
  'unaccounted generated image revision': f => appendAdverseEvent(f, 'GeneratedImageEdited'),
};
function appendAdverseEvent(f, type) {
  const original = rows(f, 'events').find(row => row.event_id === f.completed.event.eventId), body = rows(f, 'event_private_payloads').find(row => row.private_event_id === original.event_id);
  const eventId = randomUUID(); insert(f, 'events', { ...original, event_id: eventId, type, sequence: Math.max(...rows(f, 'events').map(row => row.sequence)) + 1 });
  insert(f, 'event_private_payloads', { ...body, private_event_id: eventId });
}
for (const [name, mutate] of Object.entries(corruptions)) test(`completed-result closure refuses ${name}`, async t => {
  const f = await completedResultFixture(t); mutate(f); assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(), []); await denied(f, t);
});

test('native sponsor trigger refuses a duplicate foreign consumption and preserves completed inventory', async t => {
  const f = await completedResultFixture(t), original = await currentManifest(f, t), before = snapshot(f);
  const consumption = rows(f, 'experience_sponsor_consumptions')[0];
  assert.throws(() => insert(f, 'experience_sponsor_consumptions', { ...consumption, consumption_id: randomUUID(), actor_user_id: 'foreign-actor',
    session_digest: `sha256:${'f'.repeat(64)}`, intent_key: randomUUID(), job_id: randomUUID() }),
  error => error.code === 'ERR_SQLITE_ERROR' && error.message === 'sponsor_consumption_already_exists');
  assert.deepEqual(snapshot(f), before, 'the actual native trigger rejects before changing any original row');
  assert.deepEqual(rows(f, 'users').map(row => row.user_id), [payer]);
  const guard = guardInventory(f, t);
  try {
    const cap = await inspect(f), data = guestImageResultInventoryData(f.request, f.env, cap);
    await assertOriginalManifest(f, data); assert.deepEqual(data.manifest, original); assert.equal(data.manifest.originalPayerUserId, payer);
    await assertGuestImageResultInventoryCurrent(f.request, f.env, cap); guard.assertUntouched();
  } finally { guard.close(); }
});

// These regressions follow the independent source review. Fixture-only schema
// changes happen before read guards; no historical owned row is made current.
function installQualifiedMigration(f, file) {
  const sql = readFileSync(new URL(`../drizzle/${file}`, import.meta.url), 'utf8');
  for (const statement of sql.split('--> statement-breakpoint').map(value => value.trim()).filter(Boolean)) f.sqlite.exec(statement);
}
async function currentManifest(f, t) {
  const guard = guardInventory(f, t);
  try { const cap = await inspect(f); await assertGuestImageResultInventoryCurrent(f.request, f.env, cap);
    return guestImageResultInventoryData(f.request, f.env, cap).manifest; }
  finally { guard.close(); }
}

test('complete shipped Scene source-generation schema remains compatible with historical inventory', async t => {
  const f = await completedResultFixture(t); const before = await currentManifest(f, t);
  installQualifiedMigration(f, '0038_scene_source_generations.sql');
  assert.equal(f.sqlite.prepare("SELECT count(*) AS count FROM sqlite_schema WHERE type='trigger' AND name LIKE 'scene_source_%'").get().count, 15);
  assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(), []);
  const after = await currentManifest(f, t); assert.deepEqual(after, before);
});

test('original journal trigger spellings qualify without rewriting migrated definitions', async t => {
  const f = await completedResultFixture(t); const before = await currentManifest(f, t);
  const names = new Set(['events_block_update', 'events_block_delete', 'organization_audit_block_update', 'organization_audit_block_delete',
    'organization_context_package_source_immutable', 'organization_context_package_source_delete_guard', 'organization_context_package_version_delete_guard']);
  const installed = [];
  for (const file of ['0000_lively_owl.sql', '0017_previous_pixie.sql']) {
    for (const statement of readFileSync(new URL(`../drizzle/${file}`, import.meta.url), 'utf8').split('--> statement-breakpoint')) {
      const name = /^\s*CREATE TRIGGER(?: IF NOT EXISTS)? `([^`]+)`/u.exec(statement)?.[1];
      if (!names.has(name)) continue;
      assert.ok(f.sqlite.prepare("SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name=?").get(name));
      f.sqlite.exec(`DROP TRIGGER "${name}"`); f.sqlite.exec(statement); installed.push(name);
      const retained = f.sqlite.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name=?").get(name).sql;
      assert.match(retained, /`/u, 'SQLite retains the actual migration spelling');
    }
  }
  assert.deepEqual(installed.sort(), [...names].sort());
  assert.deepEqual(await currentManifest(f, t), before);
});

for (const table of ['Memory_extra', 'Experience_Guest_extra']) test(`case-insensitive schema closure refuses ${table}`, async t => {
  const f = await completedResultFixture(t); f.sqlite.exec(`CREATE TABLE "${table}"(resource_id TEXT)`);
  f.sqlite.prepare(`INSERT INTO "${table}"(resource_id) VALUES(?)`).run(f.completed.body.output_ref);
  await denied(f, t);
});

test('completed native timestamp cannot precede its final usage event', async t => {
  const f = await admittedRunFixture(t); f.provider.beforeResponse = async () => delay(20);
  const receipt = await runGuestImage(f.request, f.env, f.runInput); assert.equal(receipt.status, 'completed');
  const usage = nativeEvents(f).find(event => event.type === 'GenerationUsageRecorded'), job = rows(f, 'document_jobs')[0];
  const earlier = new Date(Date.parse(usage.recordedAt) - 1).toISOString(); assert.ok(earlier >= job.started_at); assert.ok(earlier < usage.recordedAt);
  f.sqlite.prepare('UPDATE document_jobs SET completed_at=? WHERE job_id=?').run(earlier, job.job_id);
  await denied(f, t);
});

function addForeignRetainedBody(f, family, linked, eventLink = 'causation_id') {
  const content = JSON.stringify({ padding: 'x'.repeat(140000), incidentalReference: f.completed.body.output_ref,
    incidentalUrl: `/api/media/${encodeURIComponent(rows(f, 'output_native_storage_writes')[0].storage_key)}` });
  assert.ok(Buffer.byteLength(content) > 131072);
  const original = rows(f, 'events').find(row => row.event_id === f.completed.event.eventId), eventId = randomUUID();
  if (family === 'artifact revision') insert(f, 'artifact_revisions', { revision_id: randomUUID(), owner_id: 'foreign-owner', organization_id: null,
    project_access_id: null, project_id: 'foreign-project', document_id: 'foreign-document', artifact_id: linked ? f.completed.body.output_ref : 'foreign-artifact', revision: 0,
    content_json: content, content_sha256: sha(content), created_by_user_id: 'foreign-owner', created_at: original.recorded_at,
    expires_at: new Date(Date.parse(original.recorded_at) + 86400000).toISOString(), redacted_at: null });
  else {
    insert(f, 'events', { ...original, event_id: eventId, stream_id: 'foreign-stream', sequence: 1, actor: 'foreign-owner', client_id: 'foreign-client',
      correlation_id: 'foreign-correlation', causation_id: null, compensates_event_id: null,
      ...(linked && family === 'public event' ? { [eventLink]: f.completed.event.eventId } : {}),
      type: 'ForeignRetainedEvidence', payload: family === 'public event' ? content : '{}' });
    if (family === 'private event') {
      const body = rows(f, 'event_private_payloads').find(row => row.private_event_id === f.completed.event.eventId);
      insert(f, 'event_private_payloads', { ...body, private_event_id: eventId, owner_id: 'foreign-owner', project_id: 'foreign-project',
        document_id: linked ? f.session.documentId : 'foreign-document', private_json: content });
    }
  }
  assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(), []);
}
for (const family of ['public event', 'private event', 'artifact revision']) {
  test(`fully foreign retained ${family} with large incidental original ID and URL remains unrelated`, async t => {
    const f = await completedResultFixture(t); const before = await currentManifest(f, t); addForeignRetainedBody(f, family, false);
    assert.deepEqual(await currentManifest(f, t), before);
  });
  test(`large retained ${family} refuses exact linked native metadata`, async t => {
    const f = await completedResultFixture(t); addForeignRetainedBody(f, family, true); await denied(f, t);
  });
}

test('a foreign public event cannot compensate an original native generation event', async t => {
  const f = await completedResultFixture(t); addForeignRetainedBody(f, 'public event', true, 'compensates_event_id'); await denied(f, t);
});

for (const link of ['resource', 'owner']) test(`foreign incidental share media keys remain unrelated but exact ${link} metadata refuses`, async t => {
  const f = await completedResultFixture(t); const before = await currentManifest(f, t);
  const addShare = related => {
    const shareId = randomUUID(), owner = related && link === 'owner' ? f.session.guestSubject : 'foreign-share-owner', created = f.completed.event.recordedAt;
    insert(f, 'shares', { share_id: shareId, token_hash: sha(shareId), owner_id: owner, stream_id: 'creative:foreign-share-owner',
      expires_at: new Date(Date.parse(created) + 86400000).toISOString(), revoked_at: null, created_at: created });
    insert(f, 'share_scopes', { share_id: shareId, owner_id: owner, resource_kind: 'document',
      resource_id: related && link === 'resource' ? f.session.documentId : 'foreign-share-document', project_id: 'foreign-share-project',
      media_keys_json: JSON.stringify([rows(f, 'output_native_storage_writes')[0].storage_key]), created_at: created });
  };
  addShare(false); assert.deepEqual(await currentManifest(f, t), before);
  addShare(true); assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(), []); await denied(f, t);
});

test('foreign Scene job receipt cannot repoint an original generation event through its typed witness', async t => {
  const f = await completedResultFixture(t), before = await currentManifest(f, t);
  const jobId = randomUUID(), owner = 'foreign-scene-owner', stream = `creative:${owner}`;
  const predecessor = { streamId: stream, instanceNonce: 'e'.repeat(32), epoch: 1, streamGeneration: 1, projectGeneration: 0 };
  const witness = { version: 1, phase: 'run', scopeKey: `personal:${owner}:foreign-scene-project`, slotId: 'foreign-scene-slot',
    grantId: 'foreign-scene-grant', planRevisionId: 'foreign-scene-plan', targetId: 'foreign-scene-target', routeDigest: `sha256:${'a'.repeat(64)}`,
    sourceDigest: `sha256:${'b'.repeat(64)}`, jobId, ownerId: owner, actorId: owner, projectId: 'foreign-scene-project', documentId: 'foreign-scene-document',
    streamId: stream, correlationId: 'foreign-scene-correlation', eventIds: ['foreign-scene-event'], eventSequences: [1],
    predecessor, successor: { ...predecessor, streamGeneration: 2 } };
  insert(f, 'document_jobs', { ...f.completed.job, job_id: jobId, owner_id: owner, stream_id: stream, document_id: witness.documentId,
    kind: 'render_document', correlation_id: witness.correlationId, requested_sequence: 0, request_json: '{"artifactKind":"scene"}',
    result_json: '{}', scene_source_version_json: JSON.stringify(witness), scene_source_protocol: 1 });
  assert.deepEqual(await currentManifest(f, t), before, 'foreign typed witness is outside this result graph');
  witness.eventIds = [f.completed.event.eventId];
  f.sqlite.prepare('UPDATE document_jobs SET scene_source_version_json=? WHERE job_id=?').run(JSON.stringify(witness), jobId);
  assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(), []); await denied(f, t);
});

test('same-column core table with an unqualified private-content foreign key fails current schema proof', async t => {
  const f = await completedResultFixture(t); let guard = guardInventory(f, t), cap;
  try { cap = await inspect(f); await assertGuestImageResultInventoryCurrent(f.request, f.env, cap); } finally { guard.close(); }
  const columns = f.sqlite.prepare('PRAGMA table_info(shares)').all(), table = f.sqlite.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name='shares'").get().sql;
  const indexes = f.sqlite.prepare("SELECT sql FROM sqlite_schema WHERE type='index' AND tbl_name='shares' AND sql IS NOT NULL").all();
  assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_list(shares)').all(), []); assert.deepEqual(rows(f, 'shares'), []);
  const changed = table.replace(/\)\s*$/u, ', FOREIGN KEY(token_hash) REFERENCES private_content(content_id))'); assert.notEqual(changed, table);
  f.sqlite.exec('DROP TABLE shares'); f.sqlite.exec(changed); for (const { sql } of indexes) f.sqlite.exec(sql);
  assert.deepEqual(f.sqlite.prepare('PRAGMA table_info(shares)').all(), columns);
  assert.equal(f.sqlite.prepare('PRAGMA foreign_key_list(shares)').all().length, 1);
  guard = guardInventory(f, t);
  try {
    await assert.rejects(Promise.resolve().then(() => assertGuestImageResultInventoryCurrent(f.request, f.env, cap)));
    await assert.rejects(inspect(f)); guard.assertUntouched();
  } finally { guard.close(); }
});

function addForeignMemoryReference(f, kind, linked) {
  const tag = linked ? 'linked' : 'unrelated', prefix = `foreign-${kind.replaceAll(' ', '-')}-${tag}`;
  const owner = `${prefix}-owner`, project = `${prefix}-project`, document = `${prefix}-document`, ledger = sha(`${prefix}-ledger`);
  const created = f.completed.event.recordedAt, expires = new Date(Date.parse(created) + 86400000).toISOString(), hash = 'a'.repeat(64);
  const reference = linked ? f.completed.body.output_ref : `${prefix}-body`, event = linked ? f.completed.event.eventId : `${prefix}-event`;
  const actualHash = linked ? sha(rows(f, 'private_content').find(row => row.content_id === reference).content) : hash;
  if (kind === 'conversation head' || kind === 'conversation revision') {
    const head = { ledger_id: ledger, actor_user_id: owner, owner_user_id: owner, organization_id: null, project_access_id: null,
      project_id: project, document_id: document, enrollment_id: `${prefix}-enrollment`, enrollment_revision: 1, permission_epoch: 'foreign-epoch',
      policy_version: 'foreign-policy', storage_revision: 1, current_body_ref: reference, current_body_hash: actualHash, annotation_count: 1,
      coverage_after_sequence: 0, coverage_through_sequence: 1, state: 'active', first_terminal_at: null, cleanup_turn: 0,
      expires_at: expires, created_at: created, updated_at: created };
    if (kind === 'conversation head') insert(f, 'memory_structured_conversation_heads', head);
    else {
      insert(f, 'memory_structured_conversation_heads', { ...head, enrollment_id: null, enrollment_revision: null, permission_epoch: null,
        policy_version: null, current_body_ref: null, current_body_hash: null, annotation_count: null, coverage_after_sequence: null,
        coverage_through_sequence: null, state: 'retiring', first_terminal_at: created, expires_at: null });
      insert(f, 'memory_structured_conversation_revisions', { ledger_id: ledger, revision: 1, predecessor_revision: 0, predecessor_hash: null,
        body_ref: reference, body_hash: actualHash, schema_version: 1, recipe_version: 'native-declared-ledger-v1', annotation_count: 1,
        coverage_after_sequence: 0, coverage_through_sequence: 1, created_at: created, expires_at: expires });
    }
  } else if (kind === 'answer ledger head' || kind === 'answer ledger revision') {
    const origin = { origin_id: `${prefix}-origin`, schema_version: 1, recipe_version: 'native-structured-answer-origin-v1', actor_user_id: owner,
      owner_user_id: owner, organization_id: null, project_access_id: null, project_id: project, document_id: document,
      scope_key: JSON.stringify(['', '', project, document]), turn_id: `${prefix}-turn`, user_event_id: `${prefix}-user-event`,
      user_content_id: `${prefix}-user-body`, user_source_sequence: 2, user_sha256: hash, answer_event_id: `${prefix}-answer-event`,
      answer_content_id: `${prefix}-answer-body`, answer_source_sequence: 3, answer_sha256: hash, answer_expires_at: expires,
      enrollment_id: `${prefix}-enrollment`, enrollment_revision: 1, permission_epoch: 'foreign-epoch', policy_version: 'foreign-policy',
      enrolled_at: created, enrollment_expires_at: expires, retention_days: 1, source_head: 1, ledger_id: ledger,
      ledger_storage_revision: kind === 'answer ledger head' ? 1 : 2, ledger_body_ref: kind === 'answer ledger head' ? reference : `${prefix}-latest-body`,
      ledger_body_sha256: kind === 'answer ledger head' ? actualHash : hash, consumed_context_sha256: hash, source_list_sha256: hash, source_count: 2,
      ledger_history_sha256: hash, ledger_revision_count: kind === 'answer ledger head' ? 1 : 2, manifest_content_ref: `${prefix}-manifest`,
      manifest_sha256: hash, manifest_expires_at: expires, source_retention_ceiling: expires, created_at: created,
      status: 'active', withdrawn_at: null, withdrawal_reason: null };
    insert(f, 'memory_structured_answer_origins', origin);
    if (kind === 'answer ledger revision') {
      insert(f, 'memory_structured_answer_ledger_revisions', { origin_id: origin.origin_id, ordinal: 0, ledger_id: ledger, storage_revision: 1,
        predecessor_revision: 0, predecessor_hash: null, body_ref: reference, body_hash: actualHash, created_at: created, expires_at: expires });
      insert(f, 'memory_structured_answer_ledger_revisions', { origin_id: origin.origin_id, ordinal: 1, ledger_id: ledger, storage_revision: 2,
        predecessor_revision: 1, predecessor_hash: actualHash, body_ref: origin.ledger_body_ref, body_hash: hash, created_at: created, expires_at: expires });
    }
  } else if (kind === 'conversation member') {
    const enrollmentId = `${prefix}-enrollment`;
    insert(f, 'memory_live_enrollments', { enrollment_id: enrollmentId, actor_user_id: owner, owner_user_id: owner, organization_id: null,
      project_access_id: null, project_id: project, document_id: document, permission_epoch: 'foreign-epoch', policy_version: 'foreign-policy',
      revision: 1, learn_enabled: 1, recall_enabled: 1, background_enabled: 0, retention_days: 1, time_zone: 'UTC', enrolled_at: created,
      expires_at: expires, cursor_sequence: 1, cutoff_sequence: null, last_local_day: null, last_admitted_at: null, next_due_at: expires,
      lease_token: null, lease_expires_at: null, attempts: 0, failure_code: null });
    insert(f, 'memory_live_conversation_segments', { enrollment_id: enrollmentId, enrollment_revision: 1, recipe_version: 'live-conversation-references-v1',
      first_sequence: 1, last_sequence: 1, member_count: 1, members_json: JSON.stringify([{ eventId: event, sequence: 1, turnId: `${prefix}-turn` }]),
      created_at: created, expires_at: expires });
  } else {
    assert.equal(kind, 'retirement evidence');
    const selectors = [{ resource_kind: 'event', resource_id: event }];
    const header = { origin_id: `${prefix}-origin`, schema_version: 1, recipe_version: 'native-document-job-answer-origin-v1', actor_user_id: owner,
      scope_key: JSON.stringify(['', '', project, document]), job_id: `${prefix}-job`, turn_id: `${prefix}-turn`, user_event_id: `${prefix}-user-event`,
      user_content_id: `${prefix}-user-body`, answer_event_id: `${prefix}-answer-event`, answer_content_id: `${prefix}-answer-body`,
      manifest_content_ref: `${prefix}-manifest`, owner_user_id: owner, stream_id: `creative:${owner}`, organization_id: null, project_access_id: null,
      project_id: project, document_id: document, attempt_count: 1, correlation_id: `${prefix}-correlation`, request_sha256: hash, claim_sha256: hash,
      input_content_ref: `${prefix}-input`, input_sha256: hash, input_expires_at: expires, job_requested_at: created, job_started_at: created,
      job_lease_expires_at: expires, job_expires_at: expires, requested_sequence: 1, source_head: 1, project_source_head: null, user_source_sequence: 2,
      user_sha256: hash, answer_source_sequence: 3, answer_sha256: hash, answer_expires_at: expires, mode: 'extractive',
      renderer_recipe: 'document-job-evidence-answer-v1', locale: 'en', enrollment_id: `${prefix}-enrollment`, enrollment_revision: 1,
      permission_epoch: 'foreign-epoch', policy_version: 'foreign-policy', enrolled_at: created, enrollment_expires_at: expires, retention_days: 1,
      selection_cursor: 1, consumed_value_sha256: hash, source_count: 1, ledger_revision_count: 0, selector_count: 1,
      selector_list_sha256: sha(JSON.stringify(selectors)), manifest_sha256: hash, manifest_expires_at: expires, proof_valid_until: expires,
      source_retention_ceiling: expires, created_at: created, status: 'withdrawn', withdrawn_at: created, withdrawal_reason: 'manual' };
    insert(f, 'memory_document_job_answer_origins', header);
    const evidence = { header, header_sha256: sha(canonicalJson(header)), selectors, ledgerHead: null,
      derived: [{ content_id: header.answer_content_id, owner_id: owner, kind: 'chat-assistant-memory', created_at: created, expires_at: expires, redacted_at: null },
        { content_id: header.manifest_content_ref, owner_id: owner, kind: 'memory-document-job-origin', created_at: created, expires_at: expires, redacted_at: null }],
      custody: [header.input_content_ref, header.user_content_id, header.answer_content_id, header.manifest_content_ref].sort()
        .map(content_id => ({ content_id, resource: [], retention: [] })) };
    const text = canonicalJson(evidence);
    insert(f, 'memory_document_job_origin_retirement_progress', { origin_id: header.origin_id, schema_version: 1, evidence_json: text,
      evidence_sha256: sha(text), selector_count: 1, selector_cursor: 0, phase: 'answer', revision: 0, answer_redacted_at: null,
      manifest_redacted_at: null, created_at: created, updated_at: created });
  }
  assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(), []);
}

for (const kind of ['conversation head', 'conversation revision', 'answer ledger head', 'answer ledger revision', 'conversation member', 'retirement evidence'])
  test(`foreign Memory ${kind} alone cannot retain an original generated-result alias`, async t => {
    const f = await completedResultFixture(t, { memory: true });
    if (kind.startsWith('conversation ') && kind !== 'conversation member') installQualifiedMigration(f, '0032_memory_structured_conversation_ledger.sql');
    if (kind === 'conversation member') for (const migration of ['0025_memory_live_base.sql', '0026_memory_live_conversation.sql']) installQualifiedMigration(f, migration);
    if (kind === 'retirement evidence') installQualifiedMigration(f, '0035_memory_document_job_origin_retirement_progress.sql');
    const before = await currentManifest(f, t); addForeignMemoryReference(f, kind, false);
    assert.deepEqual(await currentManifest(f, t), before, 'qualified unrelated foreign rows are accepted');
    addForeignMemoryReference(f, kind, true); await denied(f, t);
  });

test('genuine Memory base migration alone preserves completed-result inventory', async t => {
  const f = await completedResultFixture(t, { memory: true }), before = await currentManifest(f, t);
  installQualifiedMigration(f, '0025_memory_live_base.sql');
  assert.equal(f.sqlite.prepare('PRAGMA table_info(memory_live_sources)').all().some(column => column.name === 'conversation_segmented'), false);
  assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(), []);
  assert.deepEqual(await currentManifest(f, t), before);
});

// The existing conversation-member case installs both complete original
// migrations, first accepts their empty schema, then proves a foreign baseline
// before its linked-row refusal. These cases exercise incomplete actual journal
// steps, not source-derived fingerprint literals or invented replacement DDL.
for (const variant of ['partial conversation family', 'conversation family without base', 'raw base with complete conversation family', 'altered base without conversation family'])
  test(`Memory migration qualification refuses ${variant}`, async t => {
    const f = await completedResultFixture(t, { memory: true });
    if (variant !== 'conversation family without base') installQualifiedMigration(f, '0025_memory_live_base.sql');
    const statements = readFileSync(new URL('../drizzle/0026_memory_live_conversation.sql', import.meta.url), 'utf8')
      .split('--> statement-breakpoint').map(value => value.trim()).filter(Boolean);
    assert.equal(statements.length, 3);
    const selected = variant === 'partial conversation family' ? [statements[0]]
      : variant === 'altered base without conversation family' ? [statements[2]] : statements.slice(0, 2);
    for (const statement of selected) f.sqlite.exec(statement);
    await denied(f, t);
  });

test('partial Memory schema cannot qualify a completed inventory', async t => {
  const f = await completedResultFixture(t); f.sqlite.exec('CREATE TABLE memory_structured_answer_origins(origin_id TEXT PRIMARY KEY)'); await denied(f, t);
});

test('linked structured Memory provenance cannot disappear behind a generated result', async t => {
  const f = await completedResultFixture(t, { memory: true });
  insert(f, 'memory_document_job_answer_origins', { origin_id: 'result-memory', schema_version: 1, recipe_version: 'native-document-job-answer-origin-v1',
    job_id: 'foreign-job', actor_user_id: 'foreign-actor', scope_key: '["","","foreign-project","foreign-document"]', turn_id: 'foreign-turn',
    user_event_id: f.completed.event.eventId, user_content_id: 'foreign-user-body', answer_event_id: 'foreign-answer', answer_content_id: 'foreign-answer-body',
    manifest_content_ref: 'foreign-manifest', status: 'minimized', withdrawn_at: new Date().toISOString(), withdrawal_reason: 'erased' });
  await denied(f, t);
});

for (const outcome of ['unknown', 'interrupted']) test(`genuine ${outcome} Run does not become a completed-result inventory`, async t => {
  const f = await admittedRunFixture(t);
  if (outcome === 'unknown') f.provider.imageFailure = new Error('synthetic lost Image response');
  else f.storage.beforePut = () => { throw new Error('synthetic storage failure after known charges'); };
  try { await runGuestImage(f.request, f.env, f.runInput); } catch { /* The accepted producer may refuse or return closed metadata. */ }
  assert.notEqual(rows(f, 'document_jobs')[0].status, 'completed'); assert.notEqual(rows(f, 'output_operation_slots')[0].status, 'succeeded');
  assert.equal(rows(f, 'output_provider_calls').length, 2); await denied(f, t);
});

test('earlier SAVE and stage inventory brands remain strict after real completion', async t => {
  const f = await completedResultFixture(t), guard = guardInventory(f, t);
  try { await assert.rejects(inspectGuestImageStageInventory(f.request, f.env, { proof: f.proof }));
    await assert.rejects(inspectGuestImageSaveInventory(f.request, f.env, { proof: f.proof }));
  } finally { guard.close(); }
});

test('closed inventory input refuses exchanged credentials, extra fields and accessors without evaluating them', async t => {
  const f = await completedResultFixture(t); let accesses = 0;
  const accessor = { proof: f.proof }; Object.defineProperty(accessor, 'proof', { enumerable: true, get() { accesses++; return f.proof; } });
  const guard = guardInventory(f, t);
  try {
    for (const input of [{}, { proof: { ...f.proof, claimToken: f.proof.sessionToken } }, { proof: { ...f.proof, sessionToken: f.proof.claimToken } },
      { proof: f.proof, allowExpired: true }, { proof: f.proof, manifest: {} }, accessor]) await assert.rejects(inspect(f, f.request, f.env, input));
    assert.equal(accesses, 0);
  } finally { guard.close(); }
});

for (const defect of ['cloned brand', 'manifest as brand', 'different request', 'different environment', 'replaced database', 'changed headers', 'aborted signal'])
  test(`captured result inventory refuses ${defect}`, async t => {
    const f = await completedResultFixture(t), controller = new AbortController();
    const req = new Request(`${origin}/unregistered-result-inventory`, { method: 'POST', headers: { origin }, signal: controller.signal });
    const guard = guardInventory(f, t), originalDB = f.env.DB;
    try {
      const cap = await inspect(f, req), data = guestImageResultInventoryData(req, f.env, cap); let current = cap, env = f.env, currentRequest = req;
      if (defect === 'cloned brand') current = structuredClone(cap);
      if (defect === 'manifest as brand') current = data.manifest;
      if (defect === 'different request') currentRequest = request();
      if (defect === 'different environment') env = { ...f.env };
      if (defect === 'replaced database') f.env.DB = { ...f.DB };
      if (defect === 'changed headers') req.headers.set('x-changed', 'true');
      if (defect === 'aborted signal') controller.abort();
      assert.throws(() => guestImageResultInventoryData(currentRequest, env, current));
      await assert.rejects(Promise.resolve().then(() => assertGuestImageResultInventoryCurrent(currentRequest, env, current)));
    } finally { f.env.DB = originalDB; guard.close(); }
  });

test('captured inventory deadline is not renewed and late reads cannot continue locally', async t => {
  const f = await completedResultFixture(t); let monotonic = 1000; t.mock.method(performance, 'now', () => monotonic);
  const guard = guardInventory(f, t); let restore, pending; const release = Promise.withResolvers(), entered = Promise.withResolvers();
  try {
    const cap = await inspect(f, f.request, f.env, { proof: f.proof }, 31000), batch = f.DB.batch; let reads = 0;
    monotonic = 11000;
    f.DB.batch = async function (statements) { reads++; if (reads === 1) { entered.resolve(); await release.promise; } return batch.call(this, statements); };
    restore = () => { f.DB.batch = batch; };
    pending = assertGuestImageResultInventoryCurrent(f.request, f.env, cap); await entered.promise; const captured = reads;
    monotonic = 31000; release.resolve(); await assert.rejects(pending); assert.equal(reads, captured);
    assert.throws(() => guestImageResultInventoryData(f.request, f.env, cap));
  } finally { release.resolve(); if (pending) await pending.catch(() => {}); restore?.(); guard.close(); }
});

test('invalid deadlines and an already aborted request refuse before disclosure', async t => {
  const f = await completedResultFixture(t), guard = guardInventory(f, t);
  try {
    for (const deadline of [NaN, Infinity, -Infinity]) await assert.rejects(inspect(f, f.request, f.env, { proof: f.proof }, deadline));
    const controller = new AbortController(); controller.abort();
    await assert.rejects(inspect(f, new Request(`${origin}/unregistered`, { method: 'POST', headers: { origin }, signal: controller.signal })));
  } finally { guard.close(); }
});

test('a cold result database is read-only and never receives schema installation or balance initialization', async t => {
  const f = await completedResultFixture(t), guard = guardInventory(f, t, { database: false }); let reads = 0, mutations = 0;
  const cold = { prepare(sql) { reads++; if (!/^\s*(?:SELECT|WITH)\b/iu.test(sql) || /\b(?:CREATE|INSERT|UPDATE|DELETE|ALTER|DROP)\b/iu.test(sql)) mutations++;
    throw new Error('synthetic cold result database'); }, batch() { mutations++; throw new Error('cold batch unavailable'); }, exec() { mutations++; throw new Error('schema forbidden'); } };
  try { await assert.rejects(inspect(f, f.request, { ...f.env, DB: cold })); assert.equal(mutations, 0); assert.ok(reads <= 1); }
  finally { guard.close(); }
});

test('a captured manifest cannot remain current after its exact original planner body changes', async t => {
  const f = await completedResultFixture(t); let guard = guardInventory(f, t), cap;
  try { cap = await inspect(f); } finally { guard.close(); }
  corruptions['planner body content'](f); guard = guardInventory(f, t);
  try { await assert.rejects(assertGuestImageResultInventoryCurrent(f.request, f.env, cap));
    assert.throws(() => guestImageResultInventoryData(f.request, f.env, cap));
  } finally { guard.close(); }
});

for (const fault of ['false proof', 'NULL proof', 'error alongside success', 'inherited error', 'accessor error', 'sparse result', 'duplicate proof row'])
  test(`final completed inventory refuses ${fault} from the genuine atomic read`, async t => {
    const f = await completedResultFixture(t), guard = guardInventory(f, t), batch = f.DB.batch; let calls = 0, accesses = 0;
    f.DB.batch = async function (statements) {
      const result = await batch.call(this, statements);
      if (!statements.length || !statements.every(row => /^SELECT CASE WHEN \([\s\S]*\) THEN 1 ELSE 0 END AS current$/u.test(row.sql))) return result;
      calls++; assert.equal(calls, 1); assert.equal(result[0].results[0].current, 1, 'fault follows the genuine successful database proof');
      const changed = result.slice();
      if (fault === 'false proof' || fault === 'NULL proof') changed[0] = { ...result[0], results: [{ current: fault === 'NULL proof' ? null : 0 }] };
      if (fault === 'error alongside success') changed[0] = { ...result[0], error: 'synthetic proof transport error' };
      if (fault === 'inherited error') changed[0] = Object.assign(Object.create({ error: undefined }), result[0]);
      if (fault === 'accessor error') Object.defineProperty(changed[0] = { ...result[0] }, 'error', { get() { accesses++; throw Error('proof getter forbidden'); } });
      if (fault === 'sparse result') delete changed[0];
      if (fault === 'duplicate proof row') changed[0] = { ...result[0], results: [{ current: 1 }, { current: 1 }] };
      return changed;
    };
    try { await assert.rejects(inspect(f)); assert.equal(calls, 1); assert.equal(accesses, 0); }
    finally { f.DB.batch = batch; guard.close(); }
  });

for (const drift of ['headers', 'database', 'signal']) test(`inventory refuses ${drift} drift at an awaited read boundary`, async t => {
  const f = await completedResultFixture(t), controller = new AbortController();
  const req = new Request(`${origin}/unregistered-result-inventory`, { method: 'POST', headers: { origin }, signal: controller.signal });
  const guard = guardInventory(f, t), prepare = f.DB.prepare, originalDB = f.env.DB; let changed = false, reads = 0;
  const afterRead = result => { reads++; if (!changed) { changed = true;
    if (drift === 'headers') req.headers.set('x-late-change', 'true');
    if (drift === 'database') f.env.DB = { ...originalDB };
    if (drift === 'signal') controller.abort();
  } return result; };
  function wrap(statement) {
    const bind = statement.bind; statement.bind = function (...values) { return wrap(bind.apply(this, values)); };
    for (const method of ['first', 'all']) { const original = statement[method]; statement[method] = async function (...values) { return afterRead(await original.apply(this, values)); }; }
    return statement;
  }
  f.DB.prepare = function (sql) { return wrap(prepare.call(this, sql)); };
  try { await assert.rejects(inspect(f, req)); assert.equal(changed, true); assert.equal(reads, 1, 'no next local read after observed owner drift'); }
  finally { f.env.DB = originalDB; f.DB.prepare = prepare; guard.close(); }
});


function installReferenceOnlyConversationLedger(f) {
  const sql = readFileSync(new URL('../db/memory-conversation-capture.pending.sql', import.meta.url), 'utf8');
  f.sqlite.exec('BEGIN');
  try {
    for (const statement of sql.split('--> statement-breakpoint').map(value => value.trim()).filter(Boolean)) f.sqlite.exec(statement);
    f.sqlite.exec('COMMIT');
  } catch (error) { f.sqlite.exec('ROLLBACK'); throw error; }
}

for (const kind of ['conversation head', 'conversation revision'])
  test(`reference-only Memory ledger preserves guest inventory and refuses linked zero-annotation ${kind}`, async t => {
    const f = await completedResultFixture(t, { memory: true });
    installQualifiedMigration(f, '0032_memory_structured_conversation_ledger.sql');
    const before = await currentManifest(f, t);
    addForeignMemoryReference(f, kind, false);
    const retained = ['memory_structured_conversation_heads', 'memory_structured_conversation_revisions']
      .map(table => rows(f, table));
    installReferenceOnlyConversationLedger(f);
    assert.deepEqual(['memory_structured_conversation_heads', 'memory_structured_conversation_revisions']
      .map(table => rows(f, table)), retained, 'schema evolution preserves retained ledger data');
    f.sqlite.exec("UPDATE memory_structured_conversation_heads SET annotation_count=0 WHERE state='active'");
    f.sqlite.exec('UPDATE memory_structured_conversation_revisions SET annotation_count=0');
    assert.deepEqual(await currentManifest(f, t), before, 'unrelated reference-only Memory is not result custody');
    addForeignMemoryReference(f, kind, true);
    f.sqlite.exec("UPDATE memory_structured_conversation_heads SET annotation_count=0 WHERE state='active'");
    f.sqlite.exec('UPDATE memory_structured_conversation_revisions SET annotation_count=0');
    await denied(f, t);
  });

test('guest inventory refuses a partial reference-only Memory schema even with no rows', async t => {
  const f = await completedResultFixture(t, { memory: true });
  const partial = readFileSync(new URL('../drizzle/0032_memory_structured_conversation_ledger.sql', import.meta.url), 'utf8')
    .replace('annotation_count BETWEEN 1 AND 256', 'annotation_count BETWEEN 0 AND 256');
  for (const statement of partial.split('--> statement-breakpoint').map(value => value.trim()).filter(Boolean)) f.sqlite.exec(statement);
  await denied(f, t);
});

function installNativeBenchmarkSchema(f, baseOnly = false) {
  f.sqlite.exec(readFileSync(new URL('../db/memory-benchmark.pending.sql', import.meta.url), 'utf8'));
  if (!baseOnly) f.sqlite.exec(readFileSync(new URL('../db/memory-benchmark-native.pending.sql', import.meta.url), 'utf8'));
}

function seedUnrelatedBenchmark(f, principal = 'benchmark-actor', payerId = principal) {
  f.sqlite.prepare(`INSERT INTO memory_benchmark_experiments
    (experiment_id,plan_hash,principal_id,payer_id,period,expires_at,created_at,updated_at)
    VALUES('benchmark','plan',?,?,'2026-09',2000,1000,1000)`).run(principal, payerId);
}

test('complete exact benchmark schema preserves original guest inventory with unrelated receipts', async t => {
  const f = await completedResultFixture(t, { memory: true });
  const before = await currentManifest(f, t);
  installNativeBenchmarkSchema(f); seedUnrelatedBenchmark(f, payer, payer);
  assert.deepEqual(await currentManifest(f, t), before);
});

for (const drift of ['base-only', 'missing-native-trigger', 'changed-budget-trigger', 'unknown-object'])
  test(`guest inventory refuses benchmark schema drift: ${drift}`, async t => {
    const f = await completedResultFixture(t, { memory: true });
    installNativeBenchmarkSchema(f, drift === 'base-only');
    if (drift === 'missing-native-trigger') f.sqlite.exec('DROP TRIGGER memory_benchmark_native_operation_no_delete');
    if (drift === 'changed-budget-trigger') {
      f.sqlite.exec('DROP TRIGGER memory_benchmark_native_token_no_delete');
      f.sqlite.exec('CREATE TRIGGER memory_benchmark_native_token_no_delete BEFORE DELETE ON budget_reservations BEGIN SELECT 1; END;');
    }
    if (drift === 'unknown-object') f.sqlite.exec('CREATE TABLE memory_benchmark_unreviewed(id TEXT)');
    await denied(f, t);
  });

for (const identity of ['principal', 'payer'])
  test(`guest inventory refuses benchmark ${identity} identity linked to its guest`, async t => {
    const f = await completedResultFixture(t, { memory: true }); installNativeBenchmarkSchema(f);
    seedUnrelatedBenchmark(f, identity === 'principal' ? f.session.guestSubject : 'benchmark-actor', identity === 'payer' ? f.session.guestSubject : 'benchmark-payer');
    await denied(f, t);
  });

for (const reservation of ['token', 'cost'])
  test(`guest inventory refuses another benchmark actor's linked ${reservation} reservation`, async t => {
    const f = await completedResultFixture(t, { memory: true }); installNativeBenchmarkSchema(f); seedUnrelatedBenchmark(f);
    f.sqlite.exec(`INSERT INTO memory_benchmark_native_qualifications VALUES
      ('q','plan','source','${'e'.repeat(64)}','https://fixture.invalid','qualified',1000,2000,1,1,1,1,1,1,1);
      INSERT INTO memory_benchmark_native_grants VALUES('benchmark',1,'benchmark-actor','benchmark-actor','plan','q','2026-09',10000000,1000,2000,NULL);
      INSERT INTO memory_benchmark_operations(experiment_id,operation_id,request_hash,ordinal,reservation_token,maximum_micro_usd,created_at,updated_at)
        VALUES('benchmark','operation','request',0,'unrelated-reservation',100,1000,1000);`);
    f.sqlite.prepare(`INSERT INTO memory_benchmark_native_operations(binding_id,experiment_id,operation_id,request_hash,principal_id,payer_id,period,model,maximum_tokens,maximum_micro_usd,token_id,cost_id)
      VALUES('binding','benchmark','operation','request','benchmark-actor','benchmark-actor','2026-09','text-embedding-3-small',100,100,?,?)`)
      .run(reservation === 'token' ? f.completed.token.reservation_id : 'unrelated-token', reservation === 'cost' ? f.completed.cost.reservation_id : 'unrelated-cost');
    await denied(f, t);
  });

test('Memory processing checkpoint exact schema preserves guest inventory and partial schema refuses',async t=>{
  const f=await completedResultFixture(t,{memory:true}),before=await currentManifest(f,t);
  for(const migration of ['0025_memory_live_base.sql','0026_memory_live_conversation.sql','0042_memory_live_change_checkpoints.sql'])installQualifiedMigration(f,migration);
  assert.deepEqual(await currentManifest(f,t),before);
  f.sqlite.exec('DROP TRIGGER memory_live_checkpoint_source_deleted');await denied(f,t);
});

function installDerivationPurposeSchema(f){
  for(const migration of ['0025_memory_live_base.sql','0026_memory_live_conversation.sql','0043_memory_derivation_purpose_grants.sql'])installQualifiedMigration(f,migration);
}
function seedDerivationMetadata(f,link=null,{delivery=false}={}){
  const created='2026-01-01T00:00:00.000Z',expires='2027-01-01T00:00:00.000Z',actor=link==='actor'?f.session.guestSubject:'foreign-derivation-actor';
  insert(f,'memory_live_enrollments',{enrollment_id:'foreign-derivation-parent',actor_user_id:'foreign-derivation-actor',owner_user_id:'foreign-derivation-actor',organization_id:null,project_access_id:null,
    project_id:'foreign-project',document_id:'foreign-document',permission_epoch:'foreign-epoch',policy_version:'personal-memory-v2',revision:1,learn_enabled:1,recall_enabled:1,background_enabled:0,
    retention_days:1,time_zone:'UTC',enrolled_at:created,expires_at:expires,cursor_sequence:1,cutoff_sequence:null,last_local_day:null,last_admitted_at:null,next_due_at:expires,lease_token:null,lease_expires_at:null,attempts:0,failure_code:null});
  insert(f,'memory_derivation_qualifications',{qualification_id:'foreign-qualification',source_sha256:'a'.repeat(64),origin:'https://fixture.invalid',deployment_id:'foreign-deployment',terms_json:'{}',terms_sha256:sha('{}'),status:'qualified',qualified_at:created,expires_at:expires});
  insert(f,'memory_derivation_grants',{consent_id:randomUUID(),grant_id:'b'.repeat(64),revision:1,actor_user_id:actor,payer_user_id:actor,
    owner_user_id:link==='owner'?f.session.guestSubject:'foreign-derivation-owner',organization_id:'foreign-organization',project_access_id:'foreign-access',
    project_id:link==='project'?f.session.projectId:'foreign-project',document_id:link==='document'?f.session.documentId:'foreign-document',enrollment_id:'foreign-derivation-parent',enrollment_revision:1,
    permission_epoch:'foreign-epoch',policy_version:'personal-memory-derivation-v1',purpose:'rolling-summary',qualification_id:'foreign-qualification',terms_sha256:sha('{}'),monthly_cap_microusd:1000,
    source_after_sequence:1,retention_days:1,background_enabled:Number(delivery),consented_at:created,expires_at:expires,revoked_at:null});
  assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
}
test('Memory derivation exact schema and unrelated metadata preserve guest inventory byte-for-byte',async t=>{
  const f=await completedResultFixture(t,{memory:true}),before=await currentManifest(f,t);installDerivationPurposeSchema(f);configurationTripwire(f,t);
  assert.deepEqual(await currentManifest(f,t),before);seedDerivationMetadata(f);assert.deepEqual(await currentManifest(f,t),before);
});
for(const link of ['actor','owner','project','document'])test('guest inventory refuses derivation grant '+link+' link even when its parent is unrelated',async t=>{
  const f=await completedResultFixture(t,{memory:true});installDerivationPurposeSchema(f);seedDerivationMetadata(f,link);configurationTripwire(f,t);await denied(f,t);
});
for(const fault of ['missing-trigger','unknown-object','external-inbound-fk','external-view'])test('guest inventory closes derivation schema: '+fault,async t=>{
  const f=await completedResultFixture(t,{memory:true});installDerivationPurposeSchema(f);
  if(fault==='missing-trigger')f.sqlite.exec('DROP TRIGGER memory_derivation_grant_no_replace');
  if(fault==='unknown-object')f.sqlite.exec('CREATE TABLE memory_derivation_unknown(value TEXT)');
  if(fault==='external-inbound-fk')f.sqlite.exec('CREATE TABLE unrelated_copy(id TEXT REFERENCES memory_derivation_qualifications(qualification_id))');
  if(fault==='external-view')f.sqlite.exec('CREATE VIEW unrelated_view AS SELECT * FROM memory_derivation_grants');
  await denied(f,t);
});

for(const linked of [false,true])test('Memory reference delivery exact schema closes guest source references '+linked,async t=>{
  const f=await completedResultFixture(t,{memory:true}),before=await currentManifest(f,t);installDerivationPurposeSchema(f);installQualifiedMigration(f,'0044_memory_derivation_reference_jobs.sql');
  seedDerivationMetadata(f,null,{delivery:true});const g=rows(f,'memory_derivation_grants')[0],job='c'.repeat(64),event=linked?f.completed.event.eventId:'foreign-memory-source';
  insert(f,'memory_live_sources',{enrollment_id:g.enrollment_id,event_id:event,sequence:2,expires_at:g.expires_at});
  insert(f,'memory_derivation_cursors',{consent_id:g.consent_id,grant_id:g.grant_id,grant_revision:g.revision,purpose:g.purpose,registered_through_sequence:1,generation:0,created_at:g.consented_at,updated_at:g.consented_at,expires_at:g.expires_at});
  insert(f,'memory_derivation_jobs',{job_id:job,consent_id:g.consent_id,purpose:g.purpose,after_sequence:1,through_sequence:2,source_count:1,created_at:g.consented_at,expires_at:g.expires_at,state:'waiting',lease_token:null,lease_expires_at:null,attempts:0,not_before:g.consented_at,failure_code:null});
  insert(f,'memory_derivation_job_sources',{job_id:job,enrollment_id:g.enrollment_id,event_id:event,sequence:2,expires_at:g.expires_at});
  configurationTripwire(f,t);if(linked)await denied(f,t);else assert.deepEqual(await currentManifest(f,t),before);
});
for(const fault of ['missing-inverse','inbound-view'])test('guest inventory closes Memory reference delivery schema '+fault,async t=>{
  const f=await completedResultFixture(t,{memory:true});installDerivationPurposeSchema(f);installQualifiedMigration(f,'0044_memory_derivation_reference_jobs.sql');
  if(fault==='missing-inverse')f.sqlite.exec('DROP TRIGGER memory_derivation_dependency_deleted');else f.sqlite.exec('CREATE VIEW foreign_memory_jobs AS SELECT * FROM memory_derivation_jobs');await denied(f,t);
});

function installDerivationFinanceSchema(f){
  installDerivationPurposeSchema(f);
  installQualifiedMigration(f,'0044_memory_derivation_reference_jobs.sql');
  installQualifiedMigration(f,'0045_memory_derivation_finance.sql');
}
for(const linked of [false,true])test('Memory finance cap identity remains separate from guest result custody '+linked,async t=>{
  const f=await completedResultFixture(t,{memory:true}),before=await currentManifest(f,t);installDerivationFinanceSchema(f);
  insert(f,'memory_derivation_month_caps',{payer_id:linked?f.session.guestSubject:'unrelated-finance-payer',period:'2026-09',cap_microusd:1000});
  configurationTripwire(f,t);if(linked)await denied(f,t);else assert.deepEqual(await currentManifest(f,t),before);
});
for(const fault of ['missing-protection','inbound-view'])test('guest inventory closes Memory finance schema '+fault,async t=>{
  const f=await completedResultFixture(t,{memory:true});installDerivationFinanceSchema(f);
  if(fault==='missing-protection')f.sqlite.exec('DROP TRIGGER memory_derivation_token_counter_no_replace');
  else f.sqlite.exec('CREATE VIEW unrelated_finance_view AS SELECT * FROM memory_derivation_finance');
  await denied(f,t);
});
for(const target of ['token','cost'])for(const field of ['token_id','cost_id'])test('guest inventory refuses cross-kind Memory finance reservation alias '+field+'='+target,async t=>{
  const f=await completedResultFixture(t,{memory:true});installDerivationFinanceSchema(f);
  const now=new Date().toISOString(),payerId='unrelated-finance-payer';
  insert(f,'memory_derivation_month_caps',{payer_id:payerId,period:now.slice(0,7),cap_microusd:1000});
  const token=rows(f,'budget_reservations')[0],cost=rows(f,'cost_budget_reservations')[0];
  // Inject a corrupt retained row, then restore the exact schema before any
  // inventory read. Even a full schema digest cannot authorize this alias.
  const original=f.sqlite.prepare("SELECT sql FROM sqlite_schema WHERE name='memory_derivation_finance_admit'").get().sql;
  f.sqlite.exec('DROP TRIGGER memory_derivation_finance_admit');
  insert(f,'memory_derivation_finance',{finance_id:'unrelated-finance',payer_id:payerId,period:now.slice(0,7),token_id:'unrelated-tokens',cost_id:'unrelated-cost',
    operation:'memory-derivation:profile',provider:'openai',model:'synthetic-model',terms_sha256:'a'.repeat(64),request_sha256:'b'.repeat(64),
    input_price:1000000,cached_input_price:0,output_price:1000000,maximum_input:1,maximum_output:1,maximum_tokens:2,maximum_microusd:2,
    authorized_cap_microusd:1000,workspace_id:'forma',project_access_id:null,pilot_cohort_id:null,created_at:now,dispatch_token:null,dispatched_at:null,admission_closed_at:null,
    [field]:(target==='token'?token:cost).reservation_id});
  f.sqlite.exec(original);configurationTripwire(f,t);await denied(f,t);
});
for(const fault of ['none','missing-protection','inbound-view'])test('guest inventory verifies Memory recovery scan schema '+fault,async t=>{
  const f=await completedResultFixture(t,{memory:true}),before=await currentManifest(f,t);installDerivationFinanceSchema(f);installQualifiedMigration(f,'0046_memory_derivation_recovery_cursor.sql');
  insert(f,'memory_derivation_recovery_cursor',{singleton:1,after_finance_id:null,generation:0,updated_at:new Date().toISOString()});
  if(fault==='missing-protection')f.sqlite.exec('DROP TRIGGER memory_derivation_recovery_update');
  if(fault==='inbound-view')f.sqlite.exec('CREATE VIEW unexpected_memory_recovery AS SELECT * FROM memory_derivation_recovery_cursor');
  configurationTripwire(f,t);if(fault==='none')assert.deepEqual(await currentManifest(f,t),before);else await denied(f,t);
});
for(const fault of ['none','missing-inverse','inbound-view'])test('guest inventory verifies native semantic result schema '+fault,async t=>{
  const f=await completedResultFixture(t,{memory:true}),before=await currentManifest(f,t);installDerivationFinanceSchema(f);
  installQualifiedMigration(f,'0020_assistant_runtime_tables.sql');
  installQualifiedMigration(f,'0047_memory_derivation_results.sql');
  if(fault==='missing-inverse')f.sqlite.exec('DROP TRIGGER memory_derivation_result_private_content_delete');
  if(fault==='inbound-view')f.sqlite.exec('CREATE VIEW unexpected_memory_results AS SELECT * FROM memory_derivation_results');
  configurationTripwire(f,t);if(fault==='none')assert.deepEqual(await currentManifest(f,t),before);else await denied(f,t);
});

for(const link of ['unrelated','manifest-guest','manifest-document','manifest-duplicate-key','inverse-document'])test('Memory retained semantic result inventory checks '+link,async t=>{
  const f=await completedResultFixture(t,{memory:true}),before=await currentManifest(f,t);installDerivationFinanceSchema(f);
  installQualifiedMigration(f,'0020_assistant_runtime_tables.sql');installQualifiedMigration(f,'0047_memory_derivation_results.sql');
  // Restore exact schema after simulating a retained/restored private row. An
  // intact schema alone must never hide a guest alias in a private manifest.
  const definitions=['memory_derivation_result_insert','memory_derivation_result_dependency_insert'].map(name=>f.sqlite.prepare('SELECT name,sql FROM sqlite_schema WHERE name=?').get(name));
  const wasForeignKeys=f.sqlite.prepare('PRAGMA foreign_keys').get().foreign_keys;f.sqlite.exec('PRAGMA foreign_keys=OFF');
  for(const row of definitions)f.sqlite.exec('DROP TRIGGER '+row.name);
  const manifest=link==='manifest-duplicate-key'?'"identity":"unrelated","identity":'+JSON.stringify(f.session.documentId)
    :'"identity":'+JSON.stringify(link==='manifest-guest'?f.session.guestSubject:link==='manifest-document'?f.session.documentId:'unrelated');
  insert(f,'memory_derivation_results',{job_id:'e'.repeat(64),finance_id:'unrelated-finance',state:'active',raw_json:'{}',manifest_json:'{'+manifest+'}',
    output_sha256:'a'.repeat(64),manifest_sha256:'b'.repeat(64),dependency_count:1,published_at:'2026-01-01T00:00:00.000Z',expires_at:'2027-01-01T00:00:00.000Z',retired_at:null});
  insert(f,'memory_derivation_result_dependencies',{job_id:'e'.repeat(64),kind:'content',resource_id:link==='inverse-document'?f.session.documentId:'unrelated',actor_user_id:'',scope_key:''});
  for(const row of definitions)f.sqlite.exec(row.sql);f.sqlite.exec('PRAGMA foreign_keys='+Number(wasForeignKeys));
  configurationTripwire(f,t);if(link==='unrelated')assert.deepEqual(await currentManifest(f,t),before);else await denied(f,t);
});

for(const fault of ['none','missing-inverse','inbound-view'])test('Memory user-control schema preserves guest isolation '+fault,async t=>{
  const f=await completedResultFixture(t,{memory:true}),before=await currentManifest(f,t);installDerivationFinanceSchema(f);
  installQualifiedMigration(f,'0020_assistant_runtime_tables.sql');installQualifiedMigration(f,'0047_memory_derivation_results.sql');installQualifiedMigration(f,'0048_memory_derivation_user_controls.sql');
  if(fault==='missing-inverse')f.sqlite.exec('DROP TRIGGER memory_derivation_user_control_source_update');
  if(fault==='inbound-view')f.sqlite.exec('CREATE VIEW unqualified_user_controls AS SELECT correction_text FROM memory_derivation_user_controls');
  configurationTripwire(f,t);if(fault==='none')assert.deepEqual(await currentManifest(f,t),before);else await denied(f,t);
});

for(const fault of ['none','missing-guard','inbound-view'])test('Memory completion schema preserves guest isolation '+fault,async t=>{
  const f=await completedResultFixture(t,{memory:true}),before=await currentManifest(f,t);installDerivationFinanceSchema(f);
  for(const name of ['0020_assistant_runtime_tables','0047_memory_derivation_results','0048_memory_derivation_user_controls','0049_memory_derivation_completion'])installQualifiedMigration(f,name+'.sql');
  if(fault==='missing-guard')f.sqlite.exec('DROP TRIGGER memory_derivation_completion_cursor_update');
  if(fault==='inbound-view')f.sqlite.exec('CREATE VIEW unqualified_completion AS SELECT * FROM memory_derivation_completions');
  configurationTripwire(f,t);if(fault==='none')assert.deepEqual(await currentManifest(f,t),before);else await denied(f,t);
});

for(const fault of ['none','missing-guard','inbound-trigger'])test('Memory lifecycle schema preserves guest isolation '+fault,async t=>{
  const f=await completedResultFixture(t,{memory:true}),before=await currentManifest(f,t);installDerivationFinanceSchema(f);
  for(const name of ['0020_assistant_runtime_tables','0047_memory_derivation_results','0050_memory_derivation_lifecycle'])installQualifiedMigration(f,name+'.sql');
  if(fault==='missing-guard')f.sqlite.exec('DROP TRIGGER memory_derivation_lifecycle_event_insert');
  if(fault==='inbound-trigger')f.sqlite.exec("CREATE TRIGGER unqualified_lifecycle AFTER INSERT ON memory_derivation_results BEGIN SELECT COUNT(*) FROM memory_derivation_results; END");
  configurationTripwire(f,t);if(fault==='none')assert.deepEqual(await currentManifest(f,t),before);else await denied(f,t);
});

for(const fault of ['none','missing-guard','old-job-trigger','retained-command','inbound-trigger'])test('Memory split schema preserves guest isolation '+fault,async t=>{
  const f=await completedResultFixture(t,{memory:true}),before=await currentManifest(f,t);installDerivationFinanceSchema(f);
  const old=f.sqlite.prepare("SELECT sql FROM sqlite_schema WHERE name='memory_derivation_job_insert'").get().sql;
  for(const name of ['0020_assistant_runtime_tables','0047_memory_derivation_results','0048_memory_derivation_user_controls','0049_memory_derivation_completion','0051_memory_derivation_split'])installQualifiedMigration(f,name+'.sql');
  if(fault==='missing-guard')f.sqlite.exec('DROP TRIGGER memory_derivation_split_insert');
  if(fault==='old-job-trigger')f.sqlite.exec('DROP TRIGGER memory_derivation_job_insert;'+old);
  if(fault==='inbound-trigger')f.sqlite.exec('CREATE TRIGGER unqualified_split AFTER INSERT ON memory_derivation_split_commands BEGIN SELECT COUNT(*) FROM memory_derivation_split_commands; END');
  if(fault==='retained-command'){
    const definitions=f.sqlite.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name='memory_derivation_split_commands'").all();
    for(const row of definitions)f.sqlite.exec('DROP TRIGGER '+row.name);
    insert(f,'memory_derivation_split_commands',{parent_job_id:'a'.repeat(64),left_job_id:'b'.repeat(64),right_job_id:'c'.repeat(64),lease_token:randomUUID(),split_sequence:1,finance_id:'d'.repeat(64),parent_json:'[]',references_json:'[]'});
    for(const row of definitions)f.sqlite.exec(row.sql);
  }
  configurationTripwire(f,t);if(fault==='none')assert.deepEqual(await currentManifest(f,t),before);else await denied(f,t);
});

for(const fault of ['none','missing-guard','inbound-trigger'])test('Memory rolling history schema preserves guest isolation '+fault,async t=>{
  const f=await completedResultFixture(t,{memory:true}),before=await currentManifest(f,t);installDerivationFinanceSchema(f);
  for(const name of ['0020_assistant_runtime_tables','0047_memory_derivation_results','0048_memory_derivation_user_controls','0049_memory_derivation_completion','0052_memory_derivation_history_privacy'])installQualifiedMigration(f,name+'.sql');
  if(fault==='missing-guard')f.sqlite.exec('DROP TRIGGER memory_derivation_history_source_replace');
  if(fault==='inbound-trigger')f.sqlite.exec('CREATE TRIGGER unqualified_history AFTER INSERT ON memory_derivation_results BEGIN SELECT COUNT(*) FROM memory_live_sources; END');
  configurationTripwire(f,t);if(fault==='none')assert.deepEqual(await currentManifest(f,t),before);else await denied(f,t);
});

for(const fault of ['none','missing-guard','inbound-trigger','old-job-trigger'])test('Memory Chat Studio producer schema preserves guest isolation '+fault,async t=>{
  const f=await completedResultFixture(t,{memory:true}),before=await currentManifest(f,t);installDerivationFinanceSchema(f);
  for(const name of ['0020_assistant_runtime_tables','0047_memory_derivation_results','0048_memory_derivation_user_controls','0049_memory_derivation_completion','0050_memory_derivation_lifecycle','0051_memory_derivation_split','0052_memory_derivation_history_privacy'])installQualifiedMigration(f,name+'.sql');
  const old=f.sqlite.prepare("SELECT sql FROM sqlite_schema WHERE name='memory_derivation_job_insert'").get().sql;
  installQualifiedMigration(f,'0053_memory_derivation_producers.sql');
  if(fault==='missing-guard')f.sqlite.exec('DROP TRIGGER memory_derivation_producer_job_delete');
  if(fault==='inbound-trigger')f.sqlite.exec('CREATE TRIGGER unqualified_producer AFTER INSERT ON memory_derivation_producer_jobs BEGIN SELECT COUNT(*) FROM memory_live_sources; END');
  if(fault==='old-job-trigger')f.sqlite.exec('DROP TRIGGER memory_derivation_job_insert;'+old);
  configurationTripwire(f,t);if(fault==='none')assert.deepEqual(await currentManifest(f,t),before);else await denied(f,t);
});

for(const fault of ['none','missing-guard','inbound-trigger'])test('Memory native index intent schema preserves guest isolation '+fault,async t=>{
  const f=await completedResultFixture(t,{memory:true}),before=await currentManifest(f,t);installDerivationFinanceSchema(f);
  for(const name of ['0020_assistant_runtime_tables','0047_memory_derivation_results','0054_memory_derivation_index_intents'])installQualifiedMigration(f,name+'.sql');
  if(fault==='missing-guard')f.sqlite.exec('DROP TRIGGER memory_derivation_index_erased');
  if(fault==='inbound-trigger')f.sqlite.exec('CREATE TRIGGER unqualified_index AFTER INSERT ON memory_derivation_index_intents BEGIN SELECT COUNT(*) FROM memory_live_sources; END');
  configurationTripwire(f,t);if(fault==='none')assert.deepEqual(await currentManifest(f,t),before);else await denied(f,t);
});

for(const fault of ['none','missing-guard','inbound-trigger'])test('Memory relation lifecycle schema preserves guest isolation '+fault,async t=>{
  const f=await completedResultFixture(t,{memory:true}),before=await currentManifest(f,t);installDerivationFinanceSchema(f);
  for(const name of ['0020_assistant_runtime_tables','0047_memory_derivation_results','0055_memory_derivation_relation_lifecycle'])installQualifiedMigration(f,name+'.sql');
  if(fault==='missing-guard')f.sqlite.exec('DROP TRIGGER memory_derivation_relation_event_insert');
  if(fault==='inbound-trigger')f.sqlite.exec('CREATE TRIGGER unqualified_relation AFTER INSERT ON events BEGIN SELECT COUNT(*) FROM memory_derivation_results; END');
  configurationTripwire(f,t);if(fault==='none')assert.deepEqual(await currentManifest(f,t),before);else await denied(f,t);
});

for(const fault of ['none','missing-inverse','inbound-view'])test('Memory observation-control schema preserves guest isolation '+fault,async t=>{
  const f=await completedResultFixture(t,{memory:true}),before=await currentManifest(f,t);installDerivationFinanceSchema(f);
  for(const name of ['0020_assistant_runtime_tables','0047_memory_derivation_results','0048_memory_derivation_user_controls','0057_memory_derivation_observation_controls'])installQualifiedMigration(f,name+'.sql');
  if(fault==='missing-inverse')f.sqlite.exec('DROP TRIGGER memory_derivation_observation_control_remembered_delete');
  if(fault==='inbound-view')f.sqlite.exec('CREATE VIEW unqualified_observation_controls AS SELECT correction_text FROM memory_derivation_observation_controls');
  configurationTripwire(f,t);if(fault==='none')assert.deepEqual(await currentManifest(f,t),before);else await denied(f,t);
});

test('guest inventory accepts exact optional native project containment without inferring guest ancestry',async t=>{
 const f=await completedResultFixture(t,{memory:true});
 f.sqlite.exec(readFileSync(new URL('../drizzle/0058_project_containment.sql',import.meta.url),'utf8'));
 const guard=guardInventory(f,t);try{const cap=await inspect(f);await assertOriginalManifest(f,guestImageResultInventoryData(f.request,f.env,cap));guard.assertUntouched();}finally{guard.close();}
 f.sqlite.exec('DROP TRIGGER project_containment_compensation');await denied(f,t);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { issuedFixture, createGuestImageAdmissionAuthority, admitGuestImage, readGuestImageAdmission, request, rows, snapshot,
  changes, payer, origin, addLease, redactSource, observeAdmissionSql } from './helpers/guest-image-admission-fixture.mjs';
const [{ createOutputAdmissionReads, createGuestImageAdmissionReads, requireGuestImageAdmissionPreparation,
  outputAdmissionBudgetOwner, outputAdmissionSponsor, outputAdmissionGovernanceAssertions,
  assertOutputAdmissionRequest, assertOutputAdmissionActor, assertOutputAdmissionBudget, readOutputAdmissionValue },
  { preflightGuestImageAdmission }] = await Promise.all([
  import('../worker/output-admission-reads.ts'), import('../worker/generation-readiness.ts'),
]);

test('genuine issued graph mints a private guest admission capability and truthful sealed read scope without writes', async t => {
  const f = await issuedFixture(t), before = snapshot(f), count = changes(f);
  assert.equal(await readGuestImageAdmission(f.request, f.env, f.input), null);
  const authority = await createGuestImageAdmissionAuthority(f.request, f.env, f.input);
  assert.ok(Object.isFrozen(authority)); assert.equal(JSON.stringify(authority), '{}');
  const reads = createGuestImageAdmissionReads(f.request, f.env, authority), frame = requireGuestImageAdmissionPreparation(reads, f.request, f.env);
  assert.equal(frame.actorKind, 'guest'); assert.equal(frame.actorUserId, f.session.guestSubject);
  assert.equal(frame.ownerUserId, f.session.guestSubject); assert.equal(frame.payerUserId, payer);
  assert.equal(frame.documentId, f.session.documentId); assert.equal(frame.projectId, f.session.projectId);
  assert.equal(frame.streamId, `creative:${f.session.guestSubject}`); assert.equal(frame.planSourceHead, f.committed.head + 1);
  assert.equal(frame.quoteHead, f.committed.head + 3); assert.ok(Object.isFrozen(frame)); assert.ok(frame.assertions.length > 0);
  assert.equal(Object.hasOwn(frame, 'user'), false, 'guest frame is not a fabricated PilotUser');
  assert.equal(outputAdmissionBudgetOwner(reads, f.env, f.session.guestSubject, f.session.guestSubject), payer);
  assert.throws(() => outputAdmissionBudgetOwner(reads, f.env, f.session.guestSubject, payer));
  assert.throws(() => outputAdmissionSponsor(reads), /guest|forbidden/iu);
  assert.ok(outputAdmissionGovernanceAssertions(reads).length > 0);
  assert.deepEqual(snapshot(f), before); assert.equal(changes(f), count);
});

test('forged and cloned capabilities, another Request/env and caller financial fields cannot confer admission', async t => {
  const f = await issuedFixture(t), authority = await createGuestImageAdmissionAuthority(f.request, f.env, f.input), before = snapshot(f);
  for (const value of [{}, structuredClone(authority), { ...authority }, f.envelope]) {
    await assert.rejects(admitGuestImage(f.request, f.env, value));
    assert.throws(() => createGuestImageAdmissionReads(f.request, f.env, value));
  }
  await assert.rejects(admitGuestImage(request(), f.env, authority));
  await assert.rejects(admitGuestImage(f.request, { ...f.env }, authority));
  for (const field of ['payerUserId', 'billingUserId', 'principal', 'authorization', 'sql'])
    await assert.rejects(createGuestImageAdmissionAuthority(f.request, f.env, { ...f.input, [field]: payer }));
  assert.deepEqual(snapshot(f), before);
});

for (const ownerDeadline of [NaN, Infinity, -Infinity]) test(`nonfinite owner deadline ${String(ownerDeadline)} cannot mint guest admission authority`, async t => {
  const f = await issuedFixture(t), before = snapshot(f), count = changes(f), observer = observeAdmissionSql(f);
  try {
    await assert.rejects(createGuestImageAdmissionAuthority(f.request, f.env, f.input, ownerDeadline));
    assert.equal(observer.executed.length, 0, 'invalid owner deadline is rejected before any new database observation');
    observer.assertClean();
  } finally { observer.restore(); }
  assert.deepEqual(snapshot(f), before); assert.equal(changes(f), count);
});

test('guest read scope cannot populate canonical identity caches or cross identity/budget boundaries', async t => {
  const f = await issuedFixture(t), authority = await createGuestImageAdmissionAuthority(f.request, f.env, f.input);
  const scope = createGuestImageAdmissionReads(f.request, f.env, authority); let calls = 0;
  for (const key of ['principal', 'project-selection', 'project-execution'])
    assert.throws(() => readOutputAdmissionValue(scope, key, async () => { calls++; return {}; }), /guest|forbidden/iu);
  assert.equal(calls, 0);
  assertOutputAdmissionRequest(scope, f.request, f.env, f.session.documentId);
  assertOutputAdmissionActor(scope, f.env, f.session.guestSubject, null, null, f.session.documentId);
  const period = new Date().toISOString().slice(0, 7); assertOutputAdmissionBudget(scope, f.env, payer, period);
  assert.throws(() => assertOutputAdmissionRequest(scope, request(), f.env, f.session.documentId));
  assert.throws(() => assertOutputAdmissionActor(scope, f.env, payer, null, null, f.session.documentId));
  assert.throws(() => assertOutputAdmissionActor(scope, f.env, f.session.guestSubject, 'org', 'project', f.session.documentId));
  assert.throws(() => assertOutputAdmissionBudget(scope, f.env, f.session.guestSubject, period));
  assert.throws(() => assertOutputAdmissionBudget(scope, f.env, payer, '1900-01'));
  assert.throws(() => assertOutputAdmissionBudget(scope, f.env, payer, period, { organizationId: 'org', projectAccessId: 'project', actorUserId: f.session.guestSubject }));
  const canonical = createOutputAdmissionReads({ request: f.request, env: f.env, documentId: f.session.documentId,
    actorUserId: payer, billingUserId: payer, organizationId: null, projectAccessId: null });
  assert.throws(() => requireGuestImageAdmissionPreparation(canonical, f.request, f.env));
});

for (const cached of [false, true]) for (const boundary of ['headers', 'database', 'abort'])
  test(`${cached ? 'cached' : 'new'} guest preparation read rechecks ${boundary} after its await`, async t => {
    const f = await issuedFixture(t), controller = new AbortController();
    const req = new Request(`${origin}/unregistered-admission`, { method: 'POST', headers: { origin }, signal: controller.signal });
    const authority = await createGuestImageAdmissionAuthority(req, f.env, f.input), scope = createGuestImageAdmissionReads(req, f.env, authority);
    let resolveRead, calls = 0;
    const value = { sourceFreeFixture: true };
    if (cached) assert.deepEqual(await readOutputAdmissionValue(scope, 'provider-health', async () => { calls++; return value; }), value);
    const pending = readOutputAdmissionValue(scope, 'provider-health', () => { calls++; return new Promise(resolve => { resolveRead = resolve; }); });
    if (boundary === 'headers') req.headers.set('x-after-await', 'changed');
    if (boundary === 'database') f.env.DB = { ...f.DB };
    if (boundary === 'abort') controller.abort();
    resolveRead?.(value); await assert.rejects(pending);
    assert.equal(calls, 1, 'cached reads remain cached but may not skip their new currentness check');
  });

const withdrawn = {
  'payer permission': f => f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(payer),
  'payer approval': f => f.sqlite.prepare('UPDATE experience_sponsor_campaigns SET enabled=0 WHERE campaign_id=?').run(f.input.campaignId),
  'guest session': f => f.sqlite.prepare('UPDATE experience_guest_sessions SET revoked_at_ms=1 WHERE session_id=?').run(f.session.sessionId),
  'source policy': f => f.sqlite.prepare('UPDATE experience_guest_source_policies SET revoked_at_ms=1 WHERE policy_id=?').run(f.sourcePolicy.policyId),
  'source body': redactSource,
  'claim lease': addLease,
};
for (const [name, change] of Object.entries(withdrawn)) test(`admission witness refuses withdrawn ${name} without repairing the issued graph`, async t => {
  const f = await issuedFixture(t); change(f); const before = snapshot(f);
  await assert.rejects(createGuestImageAdmissionAuthority(f.request, f.env, f.input));
  await assert.rejects(readGuestImageAdmission(f.request, f.env, f.input));
  assert.deepEqual(snapshot(f), before); assert.equal(rows(f, 'document_jobs').length, 0);
});

test('fixed guest readiness probes the real issued source, provider health and payer budget without writes or disclosure', async t => {
  const f = await issuedFixture(t), authority = await createGuestImageAdmissionAuthority(f.request, f.env, f.input);
  const scope = createGuestImageAdmissionReads(f.request, f.env, authority), before = snapshot(f), observer = observeAdmissionSql(f);
  try {
    const result = await preflightGuestImageAdmission(f.request, f.env, scope);
    assert.ok(['ready', 'review'].includes(result.status), 'real fixed-source probes permit native preparation');
    assert.equal(result.probes.some(probe => probe.status === 'fail'), false);
    assert.ok(observer.executed.some(row => /FROM provider_health/iu.test(row.sql)), 'actual native health reader was reached');
    assert.ok(observer.executed.some(row => /FROM (?:cost_)?budget_counters/iu.test(row.sql)), 'actual sealed payer budget probes were reached');
    assert.deepEqual(snapshot(f), before); observer.assertClean();
  } finally { observer.restore(); }
});

test('a cold DB handle refuses guest native admission without schema installation or financial initialization', async t => {
  const f = await issuedFixture(t), before = snapshot(f), observer = observeAdmissionSql(f);
  f.env.DB = { prepare: f.DB.prepare.bind(f.DB), batch: f.DB.batch.bind(f.DB) };
  try {
    await assert.rejects((async () => {
      const authority = await createGuestImageAdmissionAuthority(f.request, f.env, f.input);
      return admitGuestImage(f.request, f.env, authority);
    })());
    assert.deepEqual(snapshot(f), before); observer.assertClean();
    assert.equal(observer.batches.filter(batch => batch.some(sql => /INSERT.*output_execution_grants/iu.test(sql))).length, 0);
  } finally { observer.restore(); }
});

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { after, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { DEFAULT_SPONSOR_POLICY, readSponsorPolicy, compileSponsorEnvelope } from '../worker/experience-sponsor-policy.ts';
import { SPONSOR_ENTITLEMENT_SCHEMA, prepareSponsorEntitlement, resolveSponsorReplay } from '../worker/experience-sponsor-entitlement.ts';

// Complete production modules, real disposable SQLite. Native admission rows
// below are explicitly synthetic seams, not proof of guest identity, financial
// reservation implementation, actual native integration or production admission.
const originalFetch = globalThis.fetch;
let fetchAttempts = 0;
globalThis.fetch = () => { fetchAttempts++; throw Error('No network in sponsor foundation qualification'); };
after(() => { globalThis.fetch = originalFetch; assert.equal(fetchAttempts, 0); });
const h = digit => `sha256:${digit.repeat(64)}`;
const now = Date.now();
const recipe = (outputKind = 'image') => ({ appId: outputKind, recipeVersion: 'recipe@1', releaseDigest: h('1'), outputKind,
  provider: 'fixture-provider', model: 'fixture-model', routeDigest: h('2'), settingsDigest: h('3'),
  outputCount: 1, durationMs: 0, width: 1024, height: 1024,
  calls: { parsing: 0, planning: 1, render: 1, repair: 0 }, maximumTokens: 1000, maximumMicrousd: 100 });
const policy = (changes = {}) => ({ version: 1, mode: 'candidate', campaignId: 'campaign', policyVersion: 'policy@1', payerUserId: 'sponsor',
  audience: 'canonical-principal', approvalReceiptDigest: h('4'), startsAtMs: now - 60_000, expiresAtMs: now + 3_600_000,
  maximumGrantLifetimeMs: 900_000, maximumAdmissions: 10, maximumMicrousd: 1000, maximumAdmissionsPerActor: 5,
  windowMs: 60_000, maximumAdmissionsPerWindow: 10, maximumAdmissionsPerActorWindow: 5, recipes: [recipe()], ...changes });
const envelope = (changes = {}) => ({ version: 1, campaignId: 'campaign', policyVersion: 'policy@1', consumptionId: 'consume-1', intentKey: 'intent-1',
  actorKind: 'canonical-principal', actorUserId: 'author', sessionDigest: h('5'), payerUserId: 'sponsor', ownerUserId: 'author',
  projectId: 'project', documentId: 'document', sourceRevision: 7, sourceDigest: h('6'), orderedAssetDigests: [h('7'), h('8')],
  rightsDigest: h('9'), compiledInputDigest: h('a'), transferEnvelopeDigest: h('b'), recipe: recipe(), issuedAtMs: now - 1000,
  expiresAtMs: now + 600_000, ...changes });
const nativeIds = suffix => ({ scopeKey: `scope-${suffix}`, planRevisionId: `plan-${suffix}`, slotId: `slot-${suffix}`, executionGrantId: `execution-${suffix}`,
  jobId: `job-${suffix}`, costReservationId: `cost-${suffix}`, tokenReservationId: `tokens-${suffix}`, commandKey: `command-${suffix}` });
const input = (suffix = '1', p = policy(), e = envelope()) => ({ policy: p, envelope: e, grantId: `grant-${suffix}`, native: nativeIds(suffix) });

function fixture(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  db.exec('PRAGMA foreign_keys=ON');
  for (const sql of SPONSOR_ENTITLEMENT_SCHEMA) db.exec(sql);
  db.exec(`
    CREATE TABLE output_plan_revisions(scope_key TEXT,plan_revision_id TEXT,scope_kind TEXT,owner_user_id TEXT,project_id TEXT,document_id TEXT,source_digest TEXT,source_head INTEGER);
    CREATE TABLE output_execution_grants(scope_key TEXT,grant_id TEXT,plan_revision_id TEXT,actor_user_id TEXT,payer_user_id TEXT,status TEXT,context_id TEXT,maximum_microusd INTEGER,maximum_calls INTEGER,expires_at TEXT);
    CREATE TABLE output_operation_slots(scope_key TEXT,slot_id TEXT,grant_id TEXT,plan_revision_id TEXT,job_id TEXT,cost_reservation_id TEXT,token_reservation_id TEXT,status TEXT,source_digest TEXT,provider TEXT,model TEXT,route_digest TEXT,maximum_microusd INTEGER,maximum_tokens INTEGER,maximum_calls INTEGER);
    CREATE TABLE document_jobs(job_id TEXT PRIMARY KEY,owner_id TEXT,stream_id TEXT,document_id TEXT,status TEXT,correlation_id TEXT);
    CREATE TABLE budget_reservations(reservation_id TEXT PRIMARY KEY,owner_id TEXT,status TEXT,reserved_tokens INTEGER,correlation_id TEXT,stream_id TEXT);
    CREATE TABLE cost_budget_reservations(reservation_id TEXT PRIMARY KEY,owner_id TEXT,status TEXT,reserved_microusd INTEGER,allow_user_overage INTEGER,correlation_id TEXT,stream_id TEXT);
    CREATE TABLE output_commands(scope_key TEXT,actor_user_id TEXT,command_key TEXT,event_id TEXT);
    CREATE TABLE event_private_payloads(private_event_id TEXT PRIMARY KEY,owner_id TEXT,project_id TEXT,document_id TEXT,redacted_at TEXT,private_json TEXT);
    CREATE TABLE fixture_financial_counter(reserved INTEGER NOT NULL CHECK(reserved<=1000));
    INSERT INTO fixture_financial_counter VALUES(0);
  `);
  function insert(table, row) { return { sql: `INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(() => '?').join(',')})`, bindings: Object.values(row) }; }
  function run(s) { return db.prepare(s.sql).run(...s.bindings); }
  function provision(plan, raw) {
    if (!db.prepare('SELECT 1 FROM experience_sponsor_campaigns WHERE campaign_id=?').get(plan.policy.campaignId))
      run(insert('experience_sponsor_campaigns', { campaign_id: plan.policy.campaignId, policy_digest: plan.policyDigest, policy_json: plan.policyJson, enabled: 1 }));
    run(insert('experience_sponsor_grants', { grant_id: raw.grantId, campaign_id: plan.policy.campaignId, policy_digest: plan.policyDigest,
      actor_user_id: plan.envelope.actorUserId, session_digest: plan.envelope.sessionDigest, intent_key: plan.envelope.intentKey,
      envelope_digest: plan.envelopeDigest, issued_at_ms: plan.envelope.issuedAtMs, expires_at_ms: plan.envelope.expiresAtMs, enabled: 1 }));
  }
  function nativeStatements(plan, raw, { omitMarker = false, payer = plan.envelope.payerUserId } = {}) {
    const n = raw.native, e = plan.envelope, r = e.recipe, calls = Object.values(r.calls).reduce((a, b) => a + b, 0), stream = `creative:${e.ownerUserId}`;
    return [
      insert('output_plan_revisions', { scope_key: n.scopeKey, plan_revision_id: n.planRevisionId, scope_kind: 'personal', owner_user_id: e.ownerUserId, project_id: e.projectId, document_id: e.documentId, source_digest: e.sourceDigest, source_head: e.sourceRevision }),
      insert('output_execution_grants', { scope_key: n.scopeKey, grant_id: n.executionGrantId, plan_revision_id: n.planRevisionId, actor_user_id: e.actorUserId, payer_user_id: payer, status: 'authorized', context_id: null, maximum_microusd: r.maximumMicrousd, maximum_calls: calls, expires_at: new Date(e.expiresAtMs).toISOString() }),
      insert('output_operation_slots', { scope_key: n.scopeKey, slot_id: n.slotId, grant_id: n.executionGrantId, plan_revision_id: n.planRevisionId, job_id: n.jobId, cost_reservation_id: n.costReservationId, token_reservation_id: n.tokenReservationId, status: 'queued', source_digest: e.sourceDigest, provider: r.provider, model: r.model, route_digest: r.routeDigest, maximum_microusd: r.maximumMicrousd, maximum_tokens: r.maximumTokens, maximum_calls: calls }),
      insert('document_jobs', { job_id: n.jobId, owner_id: e.ownerUserId, stream_id: stream, document_id: e.documentId, status: 'queued', correlation_id: n.jobId }),
      insert('budget_reservations', { reservation_id: n.tokenReservationId, owner_id: payer, status: 'active', reserved_tokens: r.maximumTokens, correlation_id: n.jobId, stream_id: stream }),
      insert('cost_budget_reservations', { reservation_id: n.costReservationId, owner_id: payer, status: 'active', reserved_microusd: r.maximumMicrousd, allow_user_overage: 0, correlation_id: n.jobId, stream_id: stream }),
      insert('output_commands', { scope_key: n.scopeKey, actor_user_id: e.actorUserId, command_key: n.commandKey, event_id: n.commandKey }),
      insert('event_private_payloads', { private_event_id: n.commandKey, owner_id: e.ownerUserId, project_id: e.projectId, document_id: e.documentId, redacted_at: null,
        private_json: JSON.stringify({ output_command_envelope: omitMarker ? {} : { sponsor_entitlement: { envelope_digest: plan.envelopeDigest, policy_digest: plan.policyDigest, consumption_id: e.consumptionId } } }) }),
      { sql: 'UPDATE fixture_financial_counter SET reserved=reserved+?', bindings: [r.maximumMicrousd] },
    ];
  }
  function transaction(statements) {
    db.exec('BEGIN');
    try { statements.forEach(run); db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function original(plan) {
    const row = db.prepare(plan.replayLookup.sql).get(...plan.replayLookup.bindings) ?? null;
    return resolveSponsorReplay(row, { actorUserId: plan.envelope.actorUserId, sessionDigest: plan.envelope.sessionDigest, envelopeDigest: plan.envelopeDigest });
  }
  function admit(plan, raw, options = {}) {
    const replay = original(plan); if (replay) return replay;
    try { transaction([...nativeStatements(plan, raw, options), ...plan.statements]); }
    catch (error) { const competing = original(plan); if (competing) return competing; throw error; }
    if (options.loseAcknowledgment) throw Error('fixture lost committed acknowledgment');
    return original(plan);
  }
  const count = table => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  return { db, provision, transaction, nativeStatements, original, admit, count };
}

test('default disabled, explicit candidate only, and no runtime registration', async () => {
  assert.equal(readSponsorPolicy(), DEFAULT_SPONSOR_POLICY);
  await assert.rejects(prepareSponsorEntitlement({ ...input(), policy: undefined }), /sponsor_disabled/);
  for (const changed of [{ mode: 'enabled' }, { extra: true }, { maximumMicrousd: Infinity }, { maximumAdmissions: 0 }, { audience: 'anyone' }])
    assert.throws(() => readSponsorPolicy(policy(changed)), /sponsor_policy_invalid/);
  for (const name of ['experience-intake-api.ts', 'output-requirements-api.ts', 'experience-output-dispatch.ts', 'output-requirements-schema.ts'])
    assert.doesNotMatch(readFileSync(new URL(`../worker/${name}`, import.meta.url), 'utf8'), /experience-sponsor/);
});

test('campaign and issued-grant schema defaults refuse admission without explicit enabling', async t => {
  const f = fixture(t), raw = input(), plan = await prepareSponsorEntitlement(raw);
  f.db.prepare('INSERT INTO experience_sponsor_campaigns(campaign_id,policy_digest,policy_json) VALUES(?,?,?)')
    .run(plan.policy.campaignId, plan.policyDigest, plan.policyJson);
  f.db.prepare(`INSERT INTO experience_sponsor_grants(grant_id,campaign_id,policy_digest,actor_user_id,session_digest,intent_key,envelope_digest,issued_at_ms,expires_at_ms)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(raw.grantId, plan.policy.campaignId, plan.policyDigest, plan.envelope.actorUserId, plan.envelope.sessionDigest,
    plan.envelope.intentKey, plan.envelopeDigest, plan.envelope.issuedAtMs, plan.envelope.expiresAtMs);
  assert.equal(f.db.prepare('SELECT enabled FROM experience_sponsor_campaigns').get().enabled, 0);
  assert.equal(f.db.prepare('SELECT enabled FROM experience_sponsor_grants').get().enabled, 0);
  assert.throws(() => f.admit(plan, raw), /CHECK/);
  f.db.exec('UPDATE experience_sponsor_campaigns SET enabled=1');
  assert.throws(() => f.admit(plan, raw), /CHECK/);
  assert.equal(f.count('document_jobs'), 0);
});

test('closed envelope refuses guest custody, payer confusion, scope and recipe upgrades', async () => {
  for (const changed of [{ actorKind: 'guest' }, { payerUserId: 'author' }, { ownerUserId: 'other' }, { recipe: { ...recipe(), maximumMicrousd: 101 } },
    { orderedAssetDigests: ['https://private-source'] }, { sourceRevision: -1 }, { transferEnvelopeDigest: '' }, { unknown: true }])
    await assert.rejects(compileSponsorEnvelope(policy(), envelope(changed)), /sponsor_/);
  const getter = envelope(); Object.defineProperty(getter, 'sourceDigest', { enumerable: true, get() { throw Error('getter invoked'); } });
  await assert.rejects(compileSponsorEnvelope(policy(), getter), /sponsor_envelope_invalid/);
});

test('compiled binding copies before hashing; asset order and transfer settings change digest', async () => {
  const raw = envelope(), pending = compileSponsorEnvelope(policy(), raw);
  raw.orderedAssetDigests.reverse(); raw.recipe.width = 2048;
  const first = await pending;
  assert.deepEqual(first.envelope.orderedAssetDigests, [h('7'), h('8')]); assert.equal(first.envelope.recipe.width, 1024);
  assert.ok(Object.isFrozen(first.envelope.recipe.calls));
  for (const changed of [{ orderedAssetDigests: [h('8'), h('7')] }, { compiledInputDigest: h('c') }, { transferEnvelopeDigest: h('d') }, { sourceDigest: h('e') }])
    assert.notEqual((await compileSponsorEnvelope(policy(), envelope(changed))).envelopeDigest, first.envelopeDigest);
});

test('admission metadata is closed JSON and copied before asynchronous envelope hashing', async () => {
  const raw = input(), pending = prepareSponsorEntitlement(raw);
  raw.grantId = 'mutated'; raw.native.jobId = 'mutated';
  const prepared = await pending;
  assert.ok(prepared.statements[0].bindings.includes('grant-1'));
  assert.ok(prepared.statements[0].bindings.includes('job-1'));
  assert.equal(prepared.statements[0].bindings[0], 'consume-1');
  for (const accessorOwner of ['root', 'native']) {
    const bad = input();
    Object.defineProperty(accessorOwner === 'root' ? bad : bad.native, accessorOwner === 'root' ? 'grantId' : 'jobId',
      { enumerable: true, get() { throw Error('getter must never run'); } });
    await assert.rejects(prepareSponsorEntitlement(bad), /sponsor_admission_invalid/);
  }
  for (const bad of [{ ...input(), extra: 1 }, { ...input(), native: { ...nativeIds('1'), extra: 1 } }])
    await assert.rejects(prepareSponsorEntitlement(bad), /sponsor_admission_invalid/);
  const symbolic = input(); symbolic.native[Symbol('extra')] = 'hidden';
  await assert.rejects(prepareSponsorEntitlement(symbolic), /sponsor_admission_invalid/);
});

test('preparing is inert; one synthetic native transaction consumes once and replay locates original', async t => {
  const f = fixture(t), raw = input(), a = await prepareSponsorEntitlement(raw), b = await prepareSponsorEntitlement(raw);
  assert.equal(f.count('experience_sponsor_consumptions'), 0); assert.equal(f.count('document_jobs'), 0);
  f.provision(a, raw);
  assert.deepEqual(f.admit(a, raw), { kind: 'original', consumptionId: 'consume-1', jobId: 'job-1' });
  assert.deepEqual(f.admit(b, raw), f.original(a));
  assert.equal(f.count('experience_sponsor_consumptions'), 1); assert.equal(f.count('document_jobs'), 1);
  assert.equal(f.db.prepare('SELECT reserved FROM fixture_financial_counter').get().reserved, 100);
});

test('changed content under original intent conflicts instead of purchasing again', async t => {
  const f = fixture(t), raw = input(), first = await prepareSponsorEntitlement(raw); f.provision(first, raw); f.admit(first, raw);
  for (const changed of [{ sourceDigest: h('c') }, { orderedAssetDigests: [h('8'), h('7')] }, { compiledInputDigest: h('d') },
    { consumptionId: 'consume-replacement' }, { transferEnvelopeDigest: h('e') }]) {
    const altered = input('2', policy(), envelope(changed)), next = await prepareSponsorEntitlement(altered);
    assert.throws(() => f.admit(next, altered), /sponsor_intent_conflict/);
  }
  assert.equal(f.count('document_jobs'), 1);
});

test('two prepared distinct actors compete for final shared campaign allowance', async t => {
  const f = fixture(t), r = recipe('model3d'), p = policy({ maximumMicrousd: 100, recipes: [recipe(), r] }), rawA = input('1', p), rawB = input('2', p,
    envelope({ recipe: r, actorUserId: 'other', ownerUserId: 'other', consumptionId: 'consume-2', intentKey: 'intent-2' }));
  const [a, b] = await Promise.all([prepareSponsorEntitlement(rawA), prepareSponsorEntitlement(rawB)]);
  f.provision(a, rawA); f.provision(b, rawB); f.admit(a, rawA);
  assert.throws(() => f.admit(b, rawB), /CHECK/); assert.equal(f.count('experience_sponsor_consumptions'), 1); assert.equal(f.count('document_jobs'), 1);
});

test('identical contenders with stale absent pre-reads resolve one original after loser rollback', async t => {
  const f = fixture(t), raw = input(), a = await prepareSponsorEntitlement(raw), b = await prepareSponsorEntitlement(raw); f.provision(a, raw);
  assert.equal(f.original(a), null); assert.equal(f.original(b), null);
  f.transaction([...f.nativeStatements(a, raw), ...a.statements]);
  assert.throws(() => f.transaction([...f.nativeStatements(b, raw), ...b.statements]), /UNIQUE/);
  assert.deepEqual(f.original(b), f.original(a)); assert.equal(f.count('experience_sponsor_consumptions'), 1);
  assert.equal(f.db.prepare('SELECT reserved FROM fixture_financial_counter').get().reserved, 100);
});

test('active principal slot spans campaigns and output types', async t => {
  const f = fixture(t), rawA = input(), a = await prepareSponsorEntitlement(rawA); f.provision(a, rawA); f.admit(a, rawA);
  const r = recipe('model3d'), rawB = input('2', policy({ campaignId: 'other-campaign', recipes: [r] }), envelope({ campaignId: 'other-campaign', recipe: r, intentKey: 'intent-2', consumptionId: 'consume-2' }));
  const b = await prepareSponsorEntitlement(rawB); f.provision(b, rawB);
  assert.throws(() => f.admit(b, rawB), /UNIQUE/); assert.equal(f.count('document_jobs'), 1);
});

for (const constraint of ['maximumAdmissionsPerActor', 'maximumAdmissionsPerWindow', 'maximumAdmissionsPerActorWindow'])
  test(`${constraint} is rechecked at commit`, async t => {
    const f = fixture(t), p = policy({ [constraint]: 1, ...(constraint === 'maximumAdmissionsPerActor' ? { maximumAdmissionsPerActorWindow: 1 } : {}) });
    const rawA = input('1', p), rawB = input('2', p, envelope({ consumptionId: 'consume-2', intentKey: 'intent-2' }));
    const [a, b] = await Promise.all([prepareSponsorEntitlement(rawA), prepareSponsorEntitlement(rawB)]);
    f.provision(a, rawA); f.provision(b, rawB); f.admit(a, rawA);
    // Synthetic verified terminal release seam; this is NOT an exported refund or release API.
    f.db.exec('DELETE FROM experience_sponsor_active_jobs');
    assert.throws(() => f.admit(b, rawB), /CHECK/); assert.equal(f.count('document_jobs'), 1);
  });

for (const revocation of ['campaign', 'grant', 'policy', 'session', 'envelope', 'expiry'])
  test(`${revocation} changed after preparation prevents every write`, async t => {
    const f = fixture(t), raw = input(), plan = await prepareSponsorEntitlement(raw); f.provision(plan, raw);
    const mutations = { campaign: 'UPDATE experience_sponsor_campaigns SET enabled=0', grant: 'UPDATE experience_sponsor_grants SET enabled=0',
      policy: "UPDATE experience_sponsor_campaigns SET policy_json='{}'", session: "UPDATE experience_sponsor_grants SET session_digest='revoked'",
      envelope: "UPDATE experience_sponsor_grants SET envelope_digest='changed'", expiry: 'UPDATE experience_sponsor_grants SET expires_at_ms=issued_at_ms+1' };
    f.db.exec(mutations[revocation]);
    assert.throws(() => f.admit(plan, raw), /CHECK/); assert.equal(f.count('experience_sponsor_consumptions'), 0); assert.equal(f.count('document_jobs'), 0);
    assert.equal(f.db.prepare('SELECT reserved FROM fixture_financial_counter').get().reserved, 0);
  });

test('database transaction clock rejects expired grants', async t => {
  const f = fixture(t), raw = input('1', policy(), envelope({ issuedAtMs: now - 2000, expiresAtMs: now - 1000 }));
  const plan = await prepareSponsorEntitlement(raw); f.provision(plan, raw);
  assert.throws(() => f.admit(plan, raw), /CHECK/); assert.equal(f.count('experience_sponsor_consumptions'), 0);
});

test('future caller clock is refused instead of advancing a short-window cutoff', async () => {
  await assert.rejects(prepareSponsorEntitlement({ ...input(), nowMs: now + 120_000 }), /sponsor_admission_invalid/);
});

test('database clock rejects future-issued grants and retains recent campaign consumption', async t => {
  const f = fixture(t), p = policy({ maximumAdmissionsPerWindow: 1 });
  const rawA = input('1', p), a = await prepareSponsorEntitlement(rawA); f.provision(a, rawA);
  const rawB = input('2', p, envelope({ actorUserId: 'other', ownerUserId: 'other', consumptionId: 'consume-2', intentKey: 'intent-2', issuedAtMs: now + 120_000 }));
  const b = await prepareSponsorEntitlement(rawB); f.provision(b, rawB);
  assert.throws(() => f.admit(b, rawB), /CHECK/);
  assert.equal(f.count('experience_sponsor_consumptions'), 0); // No quota refusal can mask the issue-time check.
  f.admit(a, rawA);
  const rawC = input('3', p, envelope({ actorUserId: 'third', ownerUserId: 'third', consumptionId: 'consume-3', intentKey: 'intent-3' }));
  const c = await prepareSponsorEntitlement(rawC); f.provision(c, rawC);
  const originalNow = Date.now;
  try {
    Date.now = () => now + 120_000; // The application's clock cannot advance SQL windows.
    assert.throws(() => f.admit(c, rawC), /CHECK/);
  } finally { Date.now = originalNow; }
  assert.equal(f.count('experience_sponsor_consumptions'), 1); assert.equal(f.count('document_jobs'), 1);
});

test('entitlement alone, missing native envelope marker, and wrong financial payer all roll back', async t => {
  const f = fixture(t), raw = input(), plan = await prepareSponsorEntitlement(raw); f.provision(plan, raw);
  assert.throws(() => f.transaction(plan.statements), /CHECK/);
  assert.throws(() => f.admit(plan, raw, { omitMarker: true }), /CHECK/);
  assert.throws(() => f.admit(plan, raw, { payer: 'author' }), /CHECK/);
  assert.equal(f.count('experience_sponsor_consumptions'), 0); assert.equal(f.count('experience_sponsor_active_jobs'), 0); assert.equal(f.count('document_jobs'), 0);
});

test('existing exact native rows satisfy presence proof; same-transaction integration remains a caller contract', async t => {
  const f = fixture(t), raw = input(), plan = await prepareSponsorEntitlement(raw); f.provision(plan, raw);
  // Deliberately separate transactions document the SQL boundary, not a permitted
  // integration. No exported executor can do this; future callers must not split.
  f.transaction(f.nativeStatements(plan, raw));
  f.transaction(plan.statements);
  assert.equal(f.count('experience_sponsor_consumptions'), 1);
});

test('late financial refusal and native source drift roll back entitlement and all synthetic native writes', async t => {
  const f = fixture(t), raw = input(), plan = await prepareSponsorEntitlement(raw); f.provision(plan, raw);
  const native = f.nativeStatements(plan, raw);
  assert.throws(() => f.transaction([...native, ...plan.statements, { sql: 'UPDATE fixture_financial_counter SET reserved=1001', bindings: [] }]), /CHECK/);
  assert.throws(() => f.transaction([...native, { sql: 'UPDATE output_plan_revisions SET source_head=8', bindings: [] }, ...plan.statements]), /CHECK/);
  assert.equal(f.count('experience_sponsor_consumptions'), 0); assert.equal(f.count('document_jobs'), 0); assert.equal(f.count('budget_reservations'), 0);
});

test('native route, custody and financial records must match every bound admission', async t => {
  const f = fixture(t), raw = input(), plan = await prepareSponsorEntitlement(raw); f.provision(plan, raw);
  for (const sql of ["UPDATE output_operation_slots SET route_digest='changed'", "UPDATE output_operation_slots SET maximum_calls=3",
    "UPDATE output_execution_grants SET actor_user_id='other'", "UPDATE output_plan_revisions SET scope_kind='project'",
    "UPDATE document_jobs SET document_id='other'", "UPDATE budget_reservations SET reserved_tokens=999",
    "UPDATE cost_budget_reservations SET status='settled'", "UPDATE cost_budget_reservations SET allow_user_overage=1",
    "UPDATE cost_budget_reservations SET correlation_id='other'", "UPDATE event_private_payloads SET redacted_at='revoked'"]) {
    assert.throws(() => f.transaction([...f.nativeStatements(plan, raw), { sql, bindings: [] }, ...plan.statements]), /CHECK/);
    assert.equal(f.count('experience_sponsor_consumptions'), 0); assert.equal(f.count('document_jobs'), 0);
  }
});

test('lost acknowledgment and expired grant retain original job without another consumption', async t => {
  const f = fixture(t), raw = input(), plan = await prepareSponsorEntitlement(raw); f.provision(plan, raw);
  assert.throws(() => f.admit(plan, raw, { loseAcknowledgment: true }), /lost committed/);
  f.db.exec('UPDATE experience_sponsor_grants SET enabled=0,expires_at_ms=issued_at_ms+1; UPDATE experience_sponsor_campaigns SET enabled=0');
  assert.deepEqual(f.admit(plan, raw), { kind: 'original', consumptionId: 'consume-1', jobId: 'job-1' });
  const row = f.db.prepare(plan.replayLookup.sql).get(...plan.replayLookup.bindings);
  assert.throws(() => resolveSponsorReplay(row, { actorUserId: 'other', sessionDigest: h('5'), envelopeDigest: plan.envelopeDigest }), /authority_changed/);
  assert.throws(() => resolveSponsorReplay(row, { actorUserId: 'author', sessionDigest: h('a'), envelopeDigest: plan.envelopeDigest }), /authority_changed/);
  assert.equal(f.count('experience_sponsor_consumptions'), 1); assert.equal(f.count('document_jobs'), 1);
});

test('same issued grant under a changed key cannot be consumed again', async t => {
  const f = fixture(t), raw = input(), plan = await prepareSponsorEntitlement(raw); f.provision(plan, raw); f.admit(plan, raw);
  f.db.exec('DELETE FROM experience_sponsor_active_jobs');
  const changed = input('2', policy(), envelope({ consumptionId: 'consume-2', intentKey: 'intent-2' })); changed.grantId = raw.grantId;
  const another = await prepareSponsorEntitlement(changed);
  assert.throws(() => f.admit(another, changed), /CHECK/); assert.equal(f.count('experience_sponsor_consumptions'), 1);
});

test('terminal and uncertain outcomes never refund cumulative entitlement; history cannot be replaced', async t => {
  const f = fixture(t), raw = input(), plan = await prepareSponsorEntitlement(raw); f.provision(plan, raw); f.admit(plan, raw);
  for (const status of ['failed', 'cancelled', 'uncertain', 'completed']) {
    f.db.prepare('UPDATE document_jobs SET status=?').run(status);
    assert.equal(f.db.prepare('SELECT SUM(maximum_microusd) AS amount FROM experience_sponsor_consumptions').get().amount, 100);
    assert.equal(f.count('experience_sponsor_active_jobs'), 1);
  }
  assert.throws(() => f.db.exec('UPDATE experience_sponsor_consumptions SET maximum_microusd=1'), /immutable/);
  assert.throws(() => f.db.exec('DELETE FROM experience_sponsor_consumptions'), /immutable/);
  assert.throws(() => f.db.exec('INSERT OR REPLACE INTO experience_sponsor_consumptions SELECT * FROM experience_sponsor_consumptions'), /already_exists/);
});

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { writeFileSync } from 'node:fs';
import { outputTestDatabase, registerOutputSourceImports } from './output-server-test-helpers.mjs';
import { enforceD1ExpressionDepth } from './helpers/d1-expression-depth.mjs';
const imports = registerOutputSourceImports();
const originalFetch = globalThis.fetch; let egress = 0;
globalThis.fetch = () => { egress++; throw Error('Audio V8 approval tests forbid network'); };
after(() => { globalThis.fetch = originalFetch; imports.deregister(); assert.equal(egress, 0); });
const [approval, { canonicalJson }, { registeredExperience }, { AUDIO_OUTPUT_POLICY }, { STABLE_AUDIO_ADAPTER_CONTRACT, estimateAudioProviderCostMicrousd },
  { EXPERIENCE_AUDIO_INTENT }, { OUTPUT_NATIVE_EXECUTION_POLICY }, { OPENAI_TEXT_PRICING_VERSION, estimateOpenAITextCallMaximumMicrousd },
  { SPONSOR_AUDIO_TRANSFER_DESCRIPTION }, { handleSession, POLICY_VERSION }, { OUTPUT_REQUIREMENTS_SCHEMA }, { SPONSOR_ENTITLEMENT_SCHEMA }, { SPONSOR_RESOURCE_SCHEMA }] = await Promise.all([
  import('../worker/experience-sponsor-approval.ts'), import('../src/experiences/compiler.ts'), import('../src/experiences/intake.ts'),
  import('../src/model/output-audio-contract.ts'), import('../src/model/audio.ts'), import('../src/experiences/contracts.ts'), import('../src/model/output-execution-policy.ts'),
  import('../worker/openai-text-cost.ts'), import('../worker/experience-sponsor-audio-contract.ts'), import('../worker/pilot-policy.ts'),
  import('../worker/output-requirements-schema.ts'), import('../worker/experience-sponsor-entitlement.ts'), import('../worker/experience-sponsor-resources.ts'),
]);
const { compileSponsorApprovalProposal, approveSponsorCampaign, loadApprovedSponsorAudioCampaign, loadApprovedSponsorCampaign,
  loadApprovedSponsorStoryCampaign, loadApprovedSponsorSlidesCampaign, loadApprovedSponsorSceneCampaign } = approval;
const actor = 'audio-approval-actor', payer = 'audio-approval-payer', campaignId = 'audio-approval-campaign';
const headers = userId => ({ 'oai-authenticated-user-id': userId, 'oai-authenticated-user-email': `${userId}@example.invalid` });
const request = (userId = actor, body, signal) => new Request('http://localhost/__fixture/audio-v8-approval', {
  method: body ? 'POST' : 'GET', headers: { ...headers(userId), ...(body ? { 'content-type': 'application/json' } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}), signal,
});
const hash = digit => `sha256:${digit.repeat(64)}`;
const audioCost = estimateAudioProviderCostMicrousd(STABLE_AUDIO_ADAPTER_CONTRACT, EXPERIENCE_AUDIO_INTENT);
const plannerCost = Math.max(500000, estimateOpenAITextCallMaximumMicrousd('gpt-5.6-terra', 61000, 3000));
const release = await registeredExperience('audio');
const template = { version: 1, family: 'canonical-instrumental-cue@1', appId: 'audio', recipeVersion: `audio@${release.definition.revision}`, releaseDigest: release.releaseHash,
  outputKind: 'audio', inputMode: 'authorized-document-text', outputCount: 1, durationMs: 20000, width: 0, height: 0,
  route: 'document-audio-timed-music-manual-v1', maximumCalls: 3, maximumTokens: 128000, maximumMicrousd: 2 * plannerCost + audioCost,
  calls: [
    { stage: 'planning:0:initial', provider: 'openai', model: 'gpt-5.6-terra', optional: false, maximumInputTokens: 61000, maximumOutputTokens: 3000, maximumMicrousd: plannerCost },
    { stage: 'planning:0:repair', provider: 'openai', model: 'gpt-5.6-terra', optional: true, maximumInputTokens: 61000, maximumOutputTokens: 3000, maximumMicrousd: plannerCost },
    { stage: 'audio:initial', provider: 'fal', model: 'fal-ai/stable-audio-3/medium/text-to-audio', optional: false, maximumMicrousd: audioCost },
  ], audioContract: AUDIO_OUTPUT_POLICY,
  mediaRequest: { duration: 20, output_format: 'mp3', enable_safety_checker: true, negative_prompt: 'singing, vocals, spoken dialogue' },
  sourceFilesTransferred: 0, pricingVersion: OPENAI_TEXT_PRICING_VERSION, adapterVersion: STABLE_AUDIO_ADAPTER_CONTRACT.adapterVersion,
  executionPolicy: OUTPUT_NATIVE_EXECUTION_POLICY, transferDescription: SPONSOR_AUDIO_TRANSFER_DESCRIPTION };
const allowance = { maximumOperations: 20, maximumTextBytes: 100000, maximumOperationsPerWindow: 10,
  maximumTextBytesPerWindow: 50000, maximumPendingGrants: 2, maximumInflightJobs: 1 };
function proposal(now = Date.now()) {
  return { policy: { version: 8, family: 'canonical-instrumental-cue@1', mode: 'candidate', campaignId, policyVersion: 'audio-payer-approval@1', payerUserId: payer,
    audience: 'canonical-principal', startsAtMs: now - 10000, expiresAtMs: now + 300000, maximumGrantLifetimeMs: 60000,
    maximumAdmissions: 10, maximumMicrousd: template.maximumMicrousd * 10, maximumAdmissionsPerActor: 5, windowMs: 60000,
    maximumAdmissionsPerWindow: 10, maximumAdmissionsPerActorWindow: 5, templates: [structuredClone(template)],
    resources: { version: 1, startsAtMs: now - 10000, expiresAtMs: now + 300000, windowMs: 60000, maximumOperationTextBytes: 10000, campaign: allowance, actor: allowance } },
  eligibleActorUserIds: [actor], issuerUserIds: [actor] };
}
const sponsorRows = f => Object.fromEntries(['experience_sponsor_approvals', 'experience_sponsor_campaigns', 'experience_sponsor_resource_policies',
  'experience_sponsor_resource_receipts', 'experience_sponsor_grants', 'experience_sponsor_consumptions', 'experience_sponsor_active_jobs',
  'budget_reservations', 'cost_budget_reservations'].map(table => [table, f.sqlite.prepare(`SELECT * FROM ${table}`).all()]));
const snapshot = f => ({ rows: sponsorRows(f), changes: f.sqlite.prepare('SELECT total_changes() AS n').get().n,
  schema: f.sqlite.prepare('SELECT type,name,sql FROM sqlite_schema ORDER BY type,name').all() });
async function fixture(t, approved = true) {
  const f = outputTestDatabase(); t.after(() => f.sqlite.close());
  for (const userId of [actor, payer, 'audio-unlisted']) assert.equal((await handleSession(new Request('http://localhost/api/session', { headers: headers(userId) }), f.env)).status, 200);
  f.sqlite.prepare('UPDATE users SET consent_version=?').run(POLICY_VERSION);
  for (const sql of [OUTPUT_REQUIREMENTS_SCHEMA[0], ...SPONSOR_ENTITLEMENT_SCHEMA, ...SPONSOR_RESOURCE_SCHEMA, ...approval.SPONSOR_APPROVAL_SCHEMA]) f.sqlite.exec(sql);
  f.env.MEDIA = new Proxy({}, { get() { throw Error('Audio approval cannot access media'); } });
  f.input = proposal(); f.compiled = await compileSponsorApprovalProposal(f.input);
  f.command = { action: 'approve-sponsor-campaign', approvalId: 'audio-v8-approval', proposal: f.input,
    confirmation: 'APPROVE_SPONSOR_CAMPAIGN', reviewedTermsDigest: f.compiled.termsDigest };
  if (approved) f.approved = await approveSponsorCampaign(request(payer, f.command), f.env);
  return f;
}

// Actual dormant functions on disposable SQLite, never live approval/finance.
test('Audio payer approval, exact replay and current loader preserve thirteen principal fields and bounded SQL', async t => {
  const f = await fixture(t, false), capturePath = process.env.FORMA_AUDIO_V8_APPROVAL_CAPTURE;
  const queries = [], wrapped = new WeakSet(), prepare = f.DB.prepare;
  const initial = capturePath ? { schema: f.sqlite.prepare("SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type='trigger',type='index',name").all(),
    tables: f.sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
      .map(({ name }) => ({ name, rows: f.sqlite.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all() })) } : null;
  function track(statement) {
    if (wrapped.has(statement)) return statement; wrapped.add(statement);
    const bind = statement.bind, execute = statement.execute;
    statement.bind = function(...values) { return track(bind.apply(this, values)); };
    statement.execute = function(kind) { queries.push({ sql: this.sql, bindings: [...this.bindings], kind }); return execute.call(this, kind); };
    return statement;
  }
  if (capturePath) f.DB.prepare = function(sql) { return track(prepare.call(this, sql)); };
  const limits = enforceD1ExpressionDepth(f, { queryLimits: { functionArguments: 32, parameters: 100, sqlBytes: 100000 } });
  t.after(() => limits.restore());
  const approved = await approveSponsorCampaign(request(payer, f.command), f.env);
  assert.equal(approved.policy.version, 8); assert.equal(approved.replayed, false);
  const row = f.sqlite.prepare('SELECT * FROM experience_sponsor_approvals').get();
  assert.equal(row.approved_by_user_id, payer); assert.equal(row.approval_command_json, canonicalJson(f.command));
  assert.equal(JSON.parse(row.payer_authority_json).length, 13);
  const before = snapshot(f);
  assert.equal((await approveSponsorCampaign(request(payer, f.command), f.env)).replayed, true);
  const current = await loadApprovedSponsorAudioCampaign(request(), f.env, campaignId);
  assert.equal(current.actor.userId, actor); assert.equal(current.policy.version, 8); assert.equal(current.policyDigest, approved.policyDigest);
  assert.ok(Object.isFrozen(current.actor.authorizationSnapshot)); assert.deepEqual(snapshot(f), before);
  for (const loader of [loadApprovedSponsorCampaign, loadApprovedSponsorStoryCampaign, loadApprovedSponsorSlidesCampaign, loadApprovedSponsorSceneCampaign])
    await assert.rejects(loader(request(), f.env, campaignId));
  assert.deepEqual(snapshot(f), before); limits.assertVerified();
  for (const table of ['experience_sponsor_grants', 'experience_sponsor_consumptions', 'experience_sponsor_resource_receipts', 'budget_reservations', 'cost_budget_reservations'])
    assert.equal(f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0);
  t.diagnostic(JSON.stringify({ statements: limits.records.length, maximumBindings: Math.max(...limits.boundCounts), readerAndReplayWrites: 0, egress }));
  if (capturePath) writeFileSync(capturePath, JSON.stringify({ kind: 'synthetic-audio-v8-approval-query-capture', initial, queries,
    strict: limits.records, maximumBindings: Math.max(...limits.boundCounts), finalSponsorRows: sponsorRows(f), egress }, null, 2));
});

test('V8 proposal captures own data and caller mutations before both hashes', async () => {
  const input = proposal(), original = structuredClone(input), pending = compileSponsorApprovalProposal(input);
  input.policy.payerUserId = 'late-payer'; input.eligibleActorUserIds.push('late-actor');
  assert.equal((await pending).termsJson, canonicalJson(original));
  let reads = 0;
  const proxied = new Proxy(original, { get(target, key, receiver) { reads++; return Reflect.get(target, key, receiver); } });
  assert.equal((await compileSponsorApprovalProposal(proxied)).termsJson, canonicalJson(original)); assert.equal(reads, 0);
  const accessor = proposal(); Object.defineProperty(accessor, 'issuerUserIds', { enumerable: true, get() { reads++; return [actor]; } });
  await assert.rejects(compileSponsorApprovalProposal(accessor)); assert.equal(reads, 0);
  for (const change of [p => p.policy.approvalReceiptDigest = hash('a'), p => p.eligibleActorUserIds.push(payer),
    p => p.issuerUserIds = ['unlisted'], p => p.issuerUserIds = [], p => p.eligibleActorUserIds.push(actor)]) {
    const changed = proposal(); change(changed); await assert.rejects(compileSponsorApprovalProposal(changed));
  }
});

test('V8 payer authentication, reviewed terms and explicit command remain mandatory with zero writes on refusal', async t => {
  const f = await fixture(t, false), before = snapshot(f);
  for (const [user, changes] of [[actor, {}], [payer, { confirmation: 'yes' }], [payer, { reviewedTermsDigest: hash('f') }],
    [payer, { proposal: { ...f.input, issuerUserIds: ['audio-unlisted'] } }], [payer, { extra: true }]])
    await assert.rejects(approveSponsorCampaign(request(user, { ...f.command, ...changes }), f.env));
  assert.deepEqual(snapshot(f), before);
});

for (const fault of ['disabled', 'revoked', 'actor-consent', 'payer-consent', 'payer-email', 'payer-display', 'payer-consented', 'unlisted', 'expired'])
  test(`Audio current loader denies ${fault} without a database write`, async t => {
    const f = await fixture(t); let user = actor;
    if (fault === 'disabled') f.sqlite.exec('UPDATE experience_sponsor_campaigns SET enabled=0');
    if (fault === 'revoked') f.sqlite.exec('UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms');
    if (fault === 'actor-consent') f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(actor);
    if (fault === 'payer-consent') f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(payer);
    if (fault === 'payer-email') f.sqlite.prepare('UPDATE users SET email=? WHERE user_id=?').run('changed@invalid', payer);
    if (fault === 'payer-display') f.sqlite.prepare('UPDATE users SET display_name=? WHERE user_id=?').run('Changed payer', payer);
    if (fault === 'payer-consented') f.sqlite.prepare('UPDATE users SET consented_at=? WHERE user_id=?').run('2099-01-01T00:00:00.000Z', payer);
    if (fault === 'unlisted') user = 'audio-unlisted';
    const before = snapshot(f), clock = Date.now;
    if (fault === 'expired') Date.now = () => f.input.policy.expiresAtMs;
    try { await assert.rejects(loadApprovedSponsorAudioCampaign(request(user), f.env, campaignId)); }
    finally { Date.now = clock; }
    assert.deepEqual(snapshot(f), before);
  });

for (const mode of ['approval', 'loader']) for (const column of ['role', 'updated_at', 'consented_at'])
  test(`Audio ${mode} refuses changed-and-restored principal ${column}`, async t => {
    const f = await fixture(t, mode === 'loader'), user = mode === 'approval' ? payer : actor;
    f.sqlite.prepare("UPDATE users SET role='creator' WHERE user_id=?").run(user);
    const original = f.sqlite.prepare(`SELECT ${column} AS value FROM users WHERE user_id=?`).get(user).value;
    const changed = column === 'role' ? 'admin' : '2099-01-01T00:00:00.000Z', before = sponsorRows(f), prepare = f.DB.prepare; let reads = 0;
    f.DB.prepare = function(sql) {
      const statement = prepare.call(this, sql), bind = statement.bind;
      statement.bind = function(...bindings) {
        const bound = bind.apply(this, bindings);
        if (sql.includes('SELECT principal.*') && bindings[0] === user) {
          const first = bound.first; bound.first = async function(...args) {
            const row = await first.apply(this, args); reads++;
            if (reads === 1) f.sqlite.prepare(`UPDATE users SET ${column}=? WHERE user_id=?`).run(changed, user);
            if (reads === 2) f.sqlite.prepare(`UPDATE users SET ${column}=? WHERE user_id=?`).run(original, user);
            return row;
          };
        }
        return bound;
      };
      return statement;
    };
    await assert.rejects(mode === 'approval' ? approveSponsorCampaign(request(user, f.command), f.env)
      : loadApprovedSponsorAudioCampaign(request(user), f.env, campaignId), /sponsor_approval_principal_changed/u);
    assert.equal(reads, 2); assert.deepEqual(sponsorRows(f), before);
    assert.equal(f.sqlite.prepare(`SELECT ${column} AS value FROM users WHERE user_id=?`).get(user).value, original);
  });

for (const fault of ['abort', 'headers', 'database', 'configuration']) test(`V8 approval guards body await against ${fault}`, async t => {
  const f = await fixture(t, false), before = sponsorRows(f), controller = new AbortController(); let reads = 0, req, releaseBody;
  const stream = new ReadableStream({ start(streamController) { releaseBody = () => {
    if (fault === 'abort') controller.abort();
    if (fault === 'headers') req.headers.set('oai-authenticated-user-email', 'changed@invalid');
    if (fault === 'database') f.env.DB = { ...f.DB };
    if (fault === 'configuration') f.env.FORMA_PILOT_COHORT_ID = 'changed';
    streamController.enqueue(new TextEncoder().encode(JSON.stringify(f.command))); streamController.close();
  }; } });
  req = new Request('http://localhost/__fixture/audio-v8-approval', { method: 'POST', headers: { ...headers(payer), 'content-type': 'application/json' }, body: stream, duplex: 'half', signal: controller.signal });
  const prepare = f.DB.prepare; f.DB.prepare = function(sql) { reads++; return prepare.call(this, sql); };
  const pending = approveSponsorCampaign(req, f.env); releaseBody();
  await assert.rejects(pending, /sponsor_approval_principal_changed/u);
  assert.equal(reads, 0); assert.deepEqual(sponsorRows(f), before);
});

for (const hashAt of [1, 2]) test(`V8 approval refuses drift at owned hash ${hashAt} before dispatch`, async t => {
  const f = await fixture(t, false), before = sponsorRows(f), req = request(payer, f.command), subtle = crypto.subtle, original = subtle.digest; let hashes = 0, batches = 0;
  const batch = f.DB.batch; f.DB.batch = function(...args) { batches++; return batch.apply(this, args); };
  subtle.digest = async function(...args) { const result = await original.apply(this, args); if (++hashes === hashAt) req.headers.set('oai-authenticated-user-email', 'changed@invalid'); return result; };
  try { await assert.rejects(approveSponsorCampaign(req, f.env), /sponsor_approval_principal_changed/u); }
  finally { subtle.digest = original; }
  assert.equal(hashes, hashAt); assert.equal(batches, 0); assert.deepEqual(sponsorRows(f), before);
});

test('V8 approval final preparation drift prevents transaction dispatch', async t => {
  const f = await fixture(t, false), before = sponsorRows(f), req = request(payer, f.command), prepare = f.DB.prepare, batch = f.DB.batch; let batches = 0;
  f.DB.prepare = function(sql) { const statement = prepare.call(this, sql); if (sql.startsWith('INSERT INTO experience_sponsor_campaigns')) req.headers.set('oai-authenticated-user-email', 'changed@invalid'); return statement; };
  f.DB.batch = function(...args) { batches++; return batch.apply(this, args); };
  await assert.rejects(approveSponsorCampaign(req, f.env), /sponsor_approval_principal_changed/u);
  assert.equal(batches, 0); assert.deepEqual(sponsorRows(f), before);
});

test('V8 approval final SQL payer proof rolls back all new records on current authority loss', async t => {
  const f = await fixture(t, false), before = sponsorRows(f), batch = f.DB.batch.bind(f.DB);
  f.DB.batch = async statements => { f.sqlite.prepare('UPDATE users SET display_name=? WHERE user_id=?').run('Changed at commit', payer); return batch(statements); };
  await assert.rejects(approveSponsorCampaign(request(payer, f.command), f.env), /CHECK constraint failed/u);
  assert.deepEqual(sponsorRows(f), before);
});

for (const fault of ['abort', 'sparse', 'failed']) test(`V8 ${fault} after transaction dispatch preserves the original approval and never retries`, async t => {
  const f = await fixture(t, false), controller = new AbortController(), batch = f.DB.batch.bind(f.DB); let batches = 0;
  f.DB.batch = async statements => { const results = await batch(statements); batches++;
    if (fault === 'abort') controller.abort(); if (fault === 'sparse') delete results[0]; if (fault === 'failed') results[0].success = false;
    return results;
  };
  await assert.rejects(approveSponsorCampaign(request(payer, f.command, controller.signal), f.env));
  assert.equal(batches, 1); const original = sponsorRows(f);
  assert.equal(original.experience_sponsor_approvals.length, 1); assert.equal(original.experience_sponsor_campaigns.length, 1);
  f.DB.batch = batch; assert.equal((await approveSponsorCampaign(request(payer, f.command), f.env)).replayed, true);
  assert.deepEqual(sponsorRows(f), original);
});

for (const fault of ['abort', 'database', 'headers', 'sparse', 'failed', 'inherited', 'getter', 'expired', 'overridden-some', 'array-result', 'array-row', 'error-getter', 'inherited-error', 'results-getter', 'current-getter'])
  test(`Audio current metadata refuses final response ${fault}`, async t => {
    const f = await fixture(t), before = sponsorRows(f), controller = new AbortController(), req = request(actor, undefined, controller.signal), batch = f.DB.batch.bind(f.DB), clock = Date.now;
    let getters = 0;
    f.DB.batch = async statements => {
      const results = await batch(statements);
      if (fault === 'abort') controller.abort(); if (fault === 'database') f.env.DB = { ...f.DB }; if (fault === 'headers') req.headers.set('oai-authenticated-user-email', 'changed@invalid');
      if (fault === 'sparse') delete results[0]; if (fault === 'failed') results[0].success = false;
      if (fault === 'inherited') results[0] = Object.create(results[0]);
      if (fault === 'getter') Object.defineProperty(results[0], 'success', { get() { getters++; return true; } });
      if (fault === 'expired') Date.now = () => f.input.policy.expiresAtMs;
      if (fault === 'overridden-some') { results[0].results = []; results.some = () => false; }
      if (fault === 'array-result') results[0] = Object.assign([], results[0]);
      if (fault === 'array-row') results[0].results[0] = Object.assign([], { current: 1 });
      if (fault === 'error-getter') Object.defineProperty(results[0], 'error', { enumerable: true, get() { getters++; return 'hidden failure'; } });
      if (fault === 'inherited-error') Object.setPrototypeOf(results[0], { error: 'inherited failure' });
      if (fault === 'results-getter') Object.defineProperty(results[0], 'results', { enumerable: true, get() { getters++; return [{ current: 1 }]; } });
      if (fault === 'current-getter') Object.defineProperty(results[0].results[0], 'current', { enumerable: true, get() { getters++; return 1; } });
      return results;
    };
    try { await assert.rejects(loadApprovedSponsorAudioCampaign(req, f.env, campaignId)); } finally { Date.now = clock; }
    assert.equal(getters, 0); assert.deepEqual(sponsorRows(f), before);
  });

test('V8 expired replay refuses before any database operation and preserves its approval', async t => {
  const f = await fixture(t), before = sponsorRows(f), clock = Date.now; let reads = 0;
  const prepare = f.DB.prepare; f.DB.prepare = function(sql) { reads++; return prepare.call(this, sql); };
  Date.now = () => f.input.policy.expiresAtMs;
  try { await assert.rejects(approveSponsorCampaign(request(payer, f.command), f.env), /sponsor_approved_campaign_unavailable/u); }
  finally { Date.now = clock; }
  assert.equal(reads, 0); assert.deepEqual(sponsorRows(f), before);
});

for (const boundary of ['resource-hash', 'replay-overridden-some']) test(`Audio approval rejects ${boundary}`, async t => {
  const f = await fixture(t, boundary === 'replay-overridden-some'), before = sponsorRows(f), req = request(payer, f.command);
  const subtle = crypto.subtle, originalDigest = subtle.digest, prepare = f.DB.prepare, batch = f.DB.batch.bind(f.DB); let armed = false, hashes = 0, batches = 0;
  if (boundary === 'resource-hash') {
    f.DB.prepare = function(sql) { const statement = prepare.call(this, sql), bind = statement.bind;
      statement.bind = function(...args) { const bound = bind.apply(this, args), first = bound.first;
        if (sql.startsWith('SELECT * FROM experience_sponsor_approvals')) bound.first = async function(...values) { const row = await first.apply(this, values); armed = true; return row; };
        return bound; }; return statement; };
    subtle.digest = async function(...args) { const result = await originalDigest.apply(this, args); if (armed) { hashes++; req.headers.set('oai-authenticated-user-email', 'changed@invalid'); } return result; };
  }
  f.DB.batch = async statements => { batches++; const results = await batch(statements);
    if (boundary === 'replay-overridden-some') { results[0].results = []; results.some = () => false; } return results; };
  try { await assert.rejects(approveSponsorCampaign(req, f.env)); } finally { subtle.digest = originalDigest; }
  if (boundary === 'resource-hash') { assert.equal(hashes, 1); assert.equal(batches, 0); }
  assert.deepEqual(sponsorRows(f), before);
});

test('V8 proposal states its exact 64-actor list boundary', async () => {
  const input = proposal(); input.eligibleActorUserIds = [actor, ...Array.from({ length: 63 }, (_, index) => `audio-eligible-${index}`)];
  assert.equal((await compileSponsorApprovalProposal(input)).policy.version, 8);
  input.eligibleActorUserIds.push('audio-over-limit'); await assert.rejects(compileSponsorApprovalProposal(input));
});

test('V8 pre-aborted approval and loader perform no database read', async t => {
  const f = await fixture(t, false), controller = new AbortController(); controller.abort(); let reads = 0;
  f.DB.prepare = () => { reads++; throw Error('No DB after abort'); };
  await assert.rejects(approveSponsorCampaign(request(payer, f.command, controller.signal), f.env), /sponsor_approval_principal_changed/u);
  await assert.rejects(loadApprovedSponsorAudioCampaign(request(actor, undefined, controller.signal), f.env, campaignId), /sponsor_approval_principal_changed/u);
  assert.equal(reads, 0);
});

for (const mode of ['approval', 'loader']) test(`Audio ${mode} pins proof preparation to the original DB`, async t => {
  const f = await fixture(t, mode === 'loader'), prepare = f.DB.prepare, before = sponsorRows(f); let substituted = 0, batches = 0, drifted = false;
  const batch = f.DB.batch; f.DB.batch = function(...args) { batches++; return batch.apply(this, args); };
  f.DB.prepare = function(sql) { const statement = prepare.call(this, sql);
    if (!drifted && sql.startsWith(mode === 'approval' ? 'INSERT INTO output_atomic_assertions' : 'SELECT CASE WHEN')) {
      drifted = true; f.env.DB = { prepare() { substituted++; throw Error('No statement on substituted DB'); }, batch() { throw Error('No substituted batch'); } };
    }
    return statement;
  };
  await assert.rejects(mode === 'approval' ? approveSponsorCampaign(request(payer, f.command), f.env) : loadApprovedSponsorAudioCampaign(request(), f.env, campaignId));
  assert.equal(drifted, true); assert.equal(substituted, 0); assert.equal(batches, 0); assert.deepEqual(sponsorRows(f), before);
});

for (const fault of ['campaign-row-getter', 'campaign-row-hash-swap']) test(`Audio loader refuses ${fault}`, async t => {
  const f = await fixture(t), prepare = f.DB.prepare, subtle = crypto.subtle, originalDigest = subtle.digest; let campaignRow, getters = 0;
  f.DB.prepare = function(sql) { const statement = prepare.call(this, sql), bind = statement.bind;
    statement.bind = function(...values) { const bound = bind.apply(this, values), first = bound.first;
      if (sql.startsWith('SELECT policy_json,policy_digest')) bound.first = async function(...args) {
        const row = await first.apply(this, args); campaignRow = row;
        if (fault === 'campaign-row-getter') { const json = row.policy_json; Object.defineProperty(row, 'policy_json', { enumerable: true, get() { getters++; return json; } }); }
        return row;
      };
      return bound;
    }; return statement;
  };
  subtle.digest = async function(...args) {
    const result = await originalDigest.apply(this, args);
    if (fault === 'campaign-row-hash-swap' && campaignRow) {
      const changed = JSON.parse(campaignRow.policy_json); changed.policyVersion = 'unapproved-policy-change'; campaignRow.policy_json = canonicalJson(changed);
      f.sqlite.prepare('UPDATE experience_sponsor_campaigns SET policy_json=? WHERE campaign_id=?').run(campaignRow.policy_json, campaignId);
    }
    return result;
  };
  try { await assert.rejects(loadApprovedSponsorAudioCampaign(request(), f.env, campaignId)); } finally { subtle.digest = originalDigest; }
  assert.equal(getters, 0);
});

test('V8 closing SQL deadline rolls back approval when database time expires during inserts', async t => {
  const f = await fixture(t, false), before = sponsorRows(f), batch = f.DB.batch.bind(f.DB); let sqlClock = Date.now(), crossed = false;
  f.sqlite.function('julianday', value => { assert.equal(value, 'now'); return sqlClock / 86400000 + 2440587.5; });
  f.DB.batch = async statements => {
    for (const statement of statements) if (statement.sql.startsWith('INSERT INTO experience_sponsor_approvals')) {
      const execute = statement.execute; statement.execute = function(kind) {
        sqlClock = f.input.policy.expiresAtMs + 100; crossed = true; return execute.call(this, kind);
      };
    }
    return batch(statements);
  };
  await assert.rejects(approveSponsorCampaign(request(payer, f.command), f.env), /CHECK constraint failed/u);
  assert.equal(crossed, true); assert.deepEqual(sponsorRows(f), before);
});

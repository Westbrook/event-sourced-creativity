import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { registerOutputSourceImports } from './output-execution-test-helpers.mjs';

registerOutputSourceImports();
const [{ ensureSchema }, { SPONSOR_ENTITLEMENT_SCHEMA }, { SPONSOR_RESOURCE_SCHEMA }, { SPONSOR_APPROVAL_SCHEMA },
  { approveGuestSponsorCampaign, revokeGuestSponsorCampaign }, { compileGuestSponsorApprovalProposal },
  { preflightOutputImageSlidesTarget }, { sponsorImageTransport }, { registeredExperience }, { canonicalJson, digest },
  { POLICY_VERSION }, { PRINCIPAL_WITH_ACCESS_SQL }] = await Promise.all([
  import('../worker/runtime.ts'), import('../worker/experience-sponsor-entitlement.ts'), import('../worker/experience-sponsor-resources.ts'),
  import('../worker/experience-sponsor-approval.ts'), import('../worker/experience-guest-sponsor-approval.ts'),
  import('../worker/experience-guest-sponsor-contract.ts'), import('../worker/output-image-slides-preflight.ts'),
  import('../worker/experience-sponsor-image-evidence.ts'), import('../src/experiences/intake.ts'), import('../src/experiences/compiler.ts'),
  import('../worker/policy-version.ts'), import('../worker/access-policy.ts'),
]);
const requireWrangler = createRequire(import.meta.resolve('wrangler'));
const { Miniflare, Log, LogLevel } = requireWrangler('miniflare');
const origin = 'https://guest.example.invalid', payer = 'synthetic-payer', other = 'synthetic-other';
const instant = "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)", time = '2020-01-01T00:00:00.000Z';
const hash = letter => `sha256:${letter.repeat(64)}`;
const quote = name => '"' + name.replaceAll('"', '""') + '"';
const authorityColumns = ['user_id', 'role', 'consent_version', 'updated_at', 'permission_epoch', 'grants_json',
  'organizations_json', 'projects_json', 'identity_policies_json', 'approved_canvas_requirements'];
const commandRequest = (body, actor = payer) => new Request(`${origin}/unregistered-guest-sponsor-approval`, {
  method: 'POST', headers: { origin, 'content-type': 'application/json',
    'oai-authenticated-user-id': actor, 'oai-authenticated-user-email': `${actor}@example.invalid` }, body: JSON.stringify(body),
});

// Forward every application statement to actual workerd D1. Optional hooks add
// explicit fixture changes in the native batch, or simulate lost acknowledgments;
// they never interpret SQL or manufacture database result rows.
function observedDatabase(raw, diagnostic) {
  const handles = new WeakMap(), observed = { records: [], batches: [], readOnly: false, beforeBatch: null, afterBatch: null };
  function record(row) {
    assert.ok(row.bindings.length <= 100); assert.ok(Buffer.byteLength(row.sql) <= 100000);
    if (observed.readOnly) {
      assert.match(row.sql, /^\s*(?:SELECT|WITH)\b/iu, 'replay must be read-only');
      assert.doesNotMatch(row.sql, /\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE\s+[\w"]+\s+SET|DELETE\s+FROM|CREATE\s+(?:TABLE|TRIGGER)|DROP\s+(?:TABLE|TRIGGER)|ALTER\s+TABLE)\b/iu);
    }
    observed.records.push({ sql: row.sql, parameters: row.bindings.length, sqlBytes: Buffer.byteLength(row.sql) });
  }
  function wrap(statement, sql, bindings = []) {
    const row = { statement, sql, bindings };
    const wrapped = {
      bind(...args) { return wrap(statement.bind(...args), sql, args); },
      async first(...args) { record(row); try { return await statement.first(...args); } catch (error) { diagnostic(`Actual D1 read failed: ${String(error)}; bindings=${bindings.length}; bytes=${Buffer.byteLength(sql)}`); throw error; } },
      async all(...args) { record(row); return statement.all(...args); },
      async run(...args) { record(row); return statement.run(...args); },
    };
    handles.set(wrapped, row); return wrapped;
  }
  observed.DB = {
    prepare(sql) { return wrap(raw.prepare(sql), sql); },
    async batch(items) {
      const original = items.map(item => handles.get(item)); assert.ok(original.every(Boolean));
      if (observed.beforeBatch) items = await observed.beforeBatch(items, original) ?? items;
      const rows = items.map(item => handles.get(item)); assert.ok(rows.every(Boolean));
      rows.forEach(record); observed.batches.push(rows.map(row => row.sql));
      let result;
      try { result = await raw.batch(rows.map(row => row.statement)); }
      catch (error) { diagnostic(`Actual D1 batch failed: ${String(error)}`); throw error; }
      if (observed.afterBatch) await observed.afterBatch(rows);
      return result;
    },
  };
  return observed;
}
async function rows(db, table) { return (await db.prepare(`SELECT * FROM ${quote(table)} ORDER BY rowid`).all()).results; }
async function snapshot(db) {
  const schema = (await db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all()).results, contents = {};
  for (const row of schema.filter(row => row.type === 'table' && !row.name.startsWith('_cf_'))) contents[row.name] = await rows(db, row.name);
  return { schema, contents };
}
function withoutMutable(snapshotValue) {
  const copy = structuredClone(snapshotValue);
  for (const table of ['experience_sponsor_campaigns', 'experience_sponsor_resource_policies', 'experience_sponsor_approvals', 'experience_sponsor_grants']) delete copy.contents[table];
  return copy;
}
async function databaseNow(f) { return (await f.DB.prepare(`SELECT ${instant} AS value`).first()).value; }
async function templateFor(env, release) {
  // Pure native local preflight quotation: no persisted preflight or provider call.
  const offered = await preflightOutputImageSlidesTarget({ env,
    target: { id: 'synthetic-template', selected: true, blocking_issues: [], media_kind: 'image', source_scope: { kind: 'document' },
      aspect_ratio: { width: 1, height: 1 }, instruction_text: 'Show a pear orchard', label: 'Synthetic template', coverage: { kind: 'document_outline' } },
    context: { snapshot: { facts: [{ type: 'subject', properties: { text: 'A pear orchard' } }] } } });
  assert.equal(offered.available, true);
  const settings = offered.settings, payload = settings.payload;
  return { version: 2, appId: 'image', recipeVersion: `image@${release.definition.revision}`, releaseDigest: release.releaseHash,
    outputKind: 'image', inputMode: 'text-only', outputCount: 1, durationMs: 0, width: 1024, height: 1024,
    route: offered.route, maximumCalls: offered.maximumCalls, maximumTokens: offered.maximumTokens, maximumMicrousd: offered.maximumMicrousd,
    calls: structuredClone(settings.calls), settings: { kind: settings.kind, productionMode: payload.productionMode,
      budgetAcknowledged: payload.budgetAcknowledged, preflightAcknowledged: payload.preflightAcknowledged,
      imageRender: structuredClone(settings.imageRender), imageBudget: structuredClone(settings.imageBudget), executionPolicy: structuredClone(settings.executionPolicy) },
    transport: await sponsorImageTransport(env) };
}
async function proposalFor(f, name = 'main', lifetime = 600000) {
  const now = await databaseNow(f), allowance = { maximumOperations: 100, maximumTextBytes: 1000000,
    maximumOperationsPerWindow: 100, maximumTextBytesPerWindow: 1000000, maximumPendingGrants: 10, maximumInflightJobs: 1 };
  const resources = { version: 1, startsAtMs: now - 60000, expiresAtMs: now + lifetime, windowMs: 60000,
    maximumOperationTextBytes: 65536, campaign: { ...allowance, maximumInflightJobs: 3 }, actor: allowance };
  const proposal = { version: 1, purpose: 'guest-sponsored-image', issuerProtocol: 'guest-image-source@1', policy: {
    version: 3, mode: 'candidate', campaignId: `synthetic-guest-${name}`, policyVersion: 'synthetic-guest@1', payerUserId: payer,
    audience: 'guest-session', startsAtMs: resources.startsAtMs, expiresAtMs: resources.expiresAtMs,
    maximumGrantLifetimeMs: Math.min(30000, lifetime), maximumAdmissions: 10,
    maximumMicrousd: Math.max(1000000, f.template.maximumMicrousd * 10), maximumAdmissionsPerActor: 5,
    windowMs: 60000, maximumAdmissionsPerWindow: 10, maximumAdmissionsPerActorWindow: 5, templates: [f.template], resources,
    guestAdmission: { protocol: 'guest-image-source@1', origin, sessionPolicyId: 'synthetic-guest-policy', sessionTermsDigest: hash('b'),
      sourcePolicyId: 'synthetic-source-policy', sourcePolicyDigest: hash('c'), releaseHash: f.release.releaseHash },
  } };
  const compiled = await compileGuestSponsorApprovalProposal(proposal);
  const command = { version: 1, action: 'approve-guest-sponsor-campaign', approvalId: `synthetic-approval-${name}`, proposal,
    reviewedTermsDigest: compiled.termsDigest, confirmation: 'APPROVE_GUEST_SPONSOR_CAMPAIGN' };
  return { proposal, compiled, command, approve: (actor = payer) => approveGuestSponsorCampaign(commandRequest(command, actor), f.env),
    revoke: (actor = payer) => revokeGuestSponsorCampaign(commandRequest({ version: 1, action: 'revoke-guest-sponsor-campaign',
      campaignId: compiled.policy.campaignId, policyDigest: compiled.policyDigest, confirmation: 'REVOKE_GUEST_SPONSOR_CAMPAIGN' }, actor), f.env) };
}
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'forma-guest-sponsor-approval-d1-')), egress = [], media = [];
  const mf = new Miniflare({ modules: true, compatibilityDate: '2026-05-15', host: '127.0.0.1', port: 0,
    script: "export default { fetch() { return new Response('Local D1 fixture only.', {status:404}); } };",
    d1Databases: ['Approval'], d1Persist: directory, log: new Log(LogLevel.NONE),
    outboundService: request => { egress.push(request.url); throw Error('Worker egress forbidden.'); },
  });
  t.after(async () => { await mf.dispose(); await rm(directory, { recursive: true, force: true }); assert.deepEqual(egress, []); assert.deepEqual(media, []); });
  const raw = await mf.getD1Database('Approval'), observed = observedDatabase(raw, message => t.diagnostic(message)), DB = observed.DB;
  t.mock.method(globalThis, 'fetch', request => { egress.push(typeof request === 'string' ? request : request?.url); throw Error('Native fetch forbidden.'); });
  const env = { DB, OPENAI_API_KEY: 'no-network-fixture', OPENAI_MODEL: 'gpt-5.6-terra', OPENAI_IMAGE_MODEL: 'gpt-image-2',
    MEDIA: Object.fromEntries(['get', 'head', 'put', 'delete', 'list'].map(method => [method, () => { media.push(method); throw Error('Media forbidden.'); }])),
    ASSETS: { fetch() { egress.push('assets'); throw Error('Assets forbidden.'); } } };
  await ensureSchema(env);
  // Installation and existing synthetic users are fixture-only. Product functions
  // neither install these dormant tables nor bootstrap/link/update any account.
  for (const sql of [...SPONSOR_ENTITLEMENT_SCHEMA, ...SPONSOR_RESOURCE_SCHEMA, ...SPONSOR_APPROVAL_SCHEMA]) await DB.prepare(sql).run();
  for (const userId of [payer, other]) await DB.prepare('INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    .bind(userId, `${userId}@example.invalid`, userId, userId === other ? 'admin' : 'creator', POLICY_VERSION, time, time, time).run();
  await DB.prepare("INSERT INTO organizations(organization_id,name,owner_user_id,status,created_at,updated_at) VALUES('approval-org','Synthetic organization',?,'active',?,?)").bind(payer, time, time).run();
  await DB.prepare("INSERT INTO organization_memberships(membership_id,organization_id,user_id,role,status,invited_by_user_id,accepted_at,created_at,updated_at) VALUES('approval-member','approval-org',?,'owner','active',?,?,?,?)").bind(payer, payer, time, time, time).run();
  await DB.prepare("INSERT INTO organization_projects(project_access_id,project_id,organization_id,owner_user_id,status,created_at,updated_at) VALUES('approval-project','synthetic-project','approval-org',?,'active',?,?)").bind(payer, time, time).run();
  await DB.prepare("INSERT INTO organization_security_policies(organization_id,authentication_source,allowed_domains_json,require_mfa,version,updated_by_user_id,updated_at) VALUES('approval-org','any','[]',0,1,?,?)").bind(payer, time).run();
  await DB.prepare("INSERT INTO capability_grants(grant_id,user_id,capability,scope_type,status,granted_by_user_id,created_at,updated_at) VALUES('approval-capability',?,'self.usage.read','self','active',?,?,?)").bind(payer, payer, time, time).run();
  await DB.prepare("UPDATE canvas_governance_requirements SET status='approved' WHERE requirement_id='trust_safety'").run();
  const release = await registeredExperience('image'), template = await templateFor(env, release);
  const f = { DB, env, observed, release, template }; f.main = await proposalFor(f);
  observed.records.length = 0; observed.batches.length = 0;
  return f;
}
function receipt(expected, status, replayed, actual) {
  assert.deepEqual(actual, { version: 1, status, approvalId: expected.command.approvalId, campaignId: expected.compiled.policy.campaignId,
    termsDigest: expected.compiled.termsDigest, policyDigest: expected.compiled.policyDigest, replayed, generationAvailable: false });
  assert.ok(Object.isFrozen(actual));
}
function metrics(t, f) {
  t.diagnostic(JSON.stringify({ engine: 'Wrangler-pinned Miniflare/workerd D1', executedStatements: f.observed.records.length,
    maxBindings: Math.max(...f.observed.records.map(row => row.parameters)), maxSqlBytes: Math.max(...f.observed.records.map(row => row.sqlBytes)),
    applicationBatches: f.observed.batches.length }));
}
const isCreate = rows => rows.some(row => /INSERT INTO experience_sponsor_approvals\b/u.test(row.sql));
const isRevoke = rows => rows.some(row => /UPDATE experience_sponsor_approvals\b/u.test(row.sql));
function injectBeforeFinalGuard(f, items, records, sql) {
  const indexes = records.flatMap((row, index) => /^\s*INSERT INTO output_atomic_assertions\b/u.test(row.sql) ? [index] : []);
  assert.ok(indexes.length >= 2, 'actual production batch has initial and final native assertion guards');
  const result = [...items]; result.splice(indexes.at(-1), 0, f.DB.prepare(sql)); return result;
}

// Actual dormant handler integration only: no public route, production campaign,
// guest admission, generated result, financial reservation or provider invoice.
test('local workerd D1 records exact payer approval, read-only replay and denies current authority/configuration changes', { timeout: 90000 }, async t => {
  const f = await fixture(t), before = await snapshot(f.DB), start = await databaseNow(f);
  receipt(f.main, 'approved', false, await f.main.approve());
  const finish = await databaseNow(f), approved = await snapshot(f.DB), stored = approved.contents.experience_sponsor_approvals[0];
  assert.equal(approved.contents.experience_sponsor_approvals.length, 1);
  assert.deepEqual(approved.contents.experience_sponsor_campaigns, [{ campaign_id: f.main.compiled.policy.campaignId,
    policy_digest: f.main.compiled.policyDigest, policy_json: f.main.compiled.policyJson, enabled: 1 }]);
  assert.deepEqual(approved.contents.experience_sponsor_grants, before.contents.experience_sponsor_grants, 'approval cannot issue any guest grant');
  assert.equal(stored.approval_id, f.main.command.approvalId); assert.equal(stored.campaign_id, f.main.compiled.policy.campaignId); assert.equal(stored.payer_user_id, payer);
  assert.equal(stored.approval_command_json, canonicalJson(f.main.command)); assert.equal(stored.terms_json, f.main.compiled.termsJson);
  assert.equal(stored.policy_json, f.main.compiled.policyJson); assert.equal(stored.terms_digest, f.main.compiled.termsDigest);
  assert.equal(stored.policy_digest, f.main.compiled.policyDigest); assert.equal(stored.approved_by_user_id, payer);
  assert.ok(stored.approved_at_ms >= start && stored.approved_at_ms <= finish); assert.equal(stored.revoked_at_ms, null);
  const principal = await f.DB.prepare(PRINCIPAL_WITH_ACCESS_SQL).bind(payer).first();
  assert.deepEqual(JSON.parse(stored.payer_authority_json), authorityColumns.map(column => principal[column] ?? null));
  for (const column of ['grants_json', 'organizations_json', 'projects_json', 'identity_policies_json']) assert.ok(JSON.parse(principal[column]).length > 0);
  assert.deepEqual(approved.contents.experience_sponsor_resource_policies, [{ campaign_id: f.main.compiled.policy.campaignId,
    limits_digest: await digest(f.main.compiled.policy.resources), limits_json: canonicalJson(f.main.compiled.policy.resources), enabled: 1 }]);
  assert.deepEqual(withoutMutable(approved), withoutMutable(before), 'approval changes no native account/source/hold/job/usage row or schema');
  f.observed.readOnly = true;
  receipt(f.main, 'approved', true, await f.main.approve());
  await assert.rejects(f.main.approve(other));
  assert.deepEqual(await snapshot(f.DB), approved);
  f.observed.readOnly = false;
  for (const [mutate, restore] of [
    ["UPDATE experience_sponsor_resource_policies SET limits_json='{}'", `UPDATE experience_sponsor_resource_policies SET limits_json=${sqlLiteral(canonicalJson(f.main.compiled.policy.resources))}`],
    ["UPDATE experience_sponsor_resource_policies SET limits_digest='changed'", `UPDATE experience_sponsor_resource_policies SET limits_digest=${sqlLiteral(await digest(f.main.compiled.policy.resources))}`],
    ['UPDATE experience_sponsor_resource_policies SET enabled=0', 'UPDATE experience_sponsor_resource_policies SET enabled=1'],
    ["UPDATE users SET updated_at='2021-01-01' WHERE user_id='synthetic-payer'", `UPDATE users SET updated_at=${sqlLiteral(time)} WHERE user_id='synthetic-payer'`],
  ]) {
    await f.DB.prepare(mutate).run(); const changed = await snapshot(f.DB); f.observed.readOnly = true;
    await assert.rejects(f.main.approve()); assert.deepEqual(await snapshot(f.DB), changed);
    f.observed.readOnly = false; await f.DB.prepare(restore).run();
  }
  f.env.FORMA_PILOT_COHORT_ID = 'configured-pilot'; f.observed.readOnly = true;
  await assert.rejects(f.main.approve()); delete f.env.FORMA_PILOT_COHORT_ID;
  assert.deepEqual(await snapshot(f.DB), approved); f.observed.readOnly = false;
  await f.DB.prepare("INSERT INTO organizations(organization_id,name,owner_user_id,status,created_at,updated_at) VALUES('synthetic-pilot-org','Synthetic separate pilot',?,'active',?,?)").bind(other, time, time).run();
  await f.DB.prepare("INSERT INTO pilot_cohorts(cohort_id,organization_id,status,starts_at,ends_at,created_by_user_id,created_at,updated_at) VALUES('synthetic-pilot','synthetic-pilot-org','active','2020-01-01','2099-01-01',?,?,?)").bind(payer, time, time).run();
  await f.DB.prepare("INSERT INTO pilot_participants(participant_id,cohort_id,organization_id,email_normalized,user_id,status,invited_by_user_id,created_at) VALUES('synthetic-participant','synthetic-pilot','synthetic-pilot-org',?,NULL,'active',?,?)").bind(`${payer}@example.invalid`, payer, time).run();
  const pilotPrincipal = await f.DB.prepare(PRINCIPAL_WITH_ACCESS_SQL).bind(payer).first();
  assert.deepEqual(authorityColumns.map(column => pilotPrincipal[column] ?? null), JSON.parse(stored.payer_authority_json), 'pilot exclusion is tested independently of all ten native authority fields');
  const pilot = await snapshot(f.DB); f.observed.readOnly = true;
  await assert.rejects(f.main.approve()); assert.deepEqual(await snapshot(f.DB), pilot, 'normalized-email pilot membership blocks actual current approval proof');
  f.observed.readOnly = false; await f.DB.prepare("DELETE FROM pilot_participants WHERE participant_id='synthetic-participant'").run();
  await f.DB.prepare("UPDATE pilot_cohorts SET status='closed' WHERE cohort_id='synthetic-pilot'").run();
  await f.DB.prepare("DELETE FROM pilot_cohorts WHERE cohort_id='synthetic-pilot'").run();
  await f.DB.prepare("DELETE FROM organizations WHERE organization_id='synthetic-pilot-org'").run();
  assert.deepEqual(await snapshot(f.DB), approved);
  // Fixture-only installation of an otherwise complete immutable original with
  // semantically equivalent, noncanonical command bytes proves the live SQL
  // compares the entire command, not only its parsed action or digest fields.
  const poison = await proposalFor(f, 'noncanonical-command');
  await f.DB.prepare('INSERT INTO experience_sponsor_campaigns VALUES(?,?,?,1)').bind(poison.compiled.policy.campaignId, poison.compiled.policyDigest, poison.compiled.policyJson).run();
  await f.DB.prepare('INSERT INTO experience_sponsor_resource_policies VALUES(?,?,?,1)').bind(poison.compiled.policy.campaignId, await digest(poison.compiled.policy.resources), canonicalJson(poison.compiled.policy.resources)).run();
  await f.DB.prepare(`INSERT INTO experience_sponsor_approvals(approval_id,campaign_id,payer_user_id,terms_digest,terms_json,policy_digest,policy_json,approved_by_user_id,payer_authority_json,approval_command_json,approved_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,${instant})`)
    .bind(poison.command.approvalId, poison.compiled.policy.campaignId, payer, poison.compiled.termsDigest, poison.compiled.termsJson, poison.compiled.policyDigest, poison.compiled.policyJson, payer, stored.payer_authority_json, canonicalJson(poison.command) + ' ').run();
  const poisoned = await snapshot(f.DB); f.observed.readOnly = true;
  await assert.rejects(poison.approve()); assert.deepEqual(await snapshot(f.DB), poisoned);
  receipt(f.main, 'approved', true, await f.main.approve());
  metrics(t, f);
});
function sqlLiteral(value) { return "'" + value.replaceAll("'", "''") + "'"; }

test('local workerd D1 concurrent exact creates and lost acknowledgment recover one immutable approval without automatic remutation', { timeout: 90000 }, async t => {
  const f = await fixture(t), results = await Promise.all([f.main.approve(), f.main.approve()]);
  assert.deepEqual(results.map(row => row.replayed).sort(), [false, true]);
  for (const result of results) receipt(f.main, 'approved', result.replayed, result);
  assert.equal((await rows(f.DB, 'experience_sponsor_approvals')).length, 1);
  const second = await proposalFor(f, 'lost-ack'); let attempts = 0, lost = 0;
  f.observed.beforeBatch = (_items, records) => { if (isCreate(records)) attempts++; };
  f.observed.afterBatch = records => { if (isCreate(records)) { lost++; throw Error('Synthetic lost D1 acknowledgment after successful commit'); } };
  receipt(second, 'approved', true, await second.approve()); assert.equal(attempts, 1); assert.equal(lost, 1);
  f.observed.beforeBatch = null; f.observed.afterBatch = null;
  const before = await snapshot(f.DB); f.observed.readOnly = true;
  receipt(second, 'approved', true, await second.approve()); assert.deepEqual(await snapshot(f.DB), before);
  assert.equal(before.contents.experience_sponsor_approvals.length, 2);
  metrics(t, f);
});

test('local workerd D1 final approval guard rejects in-batch resource drift and rolls back the entire actual create', { timeout: 90000 }, async t => {
  const f = await fixture(t), before = await snapshot(f.DB); let injected = 0;
  f.observed.beforeBatch = (items, records) => {
    if (!isCreate(records)) return; injected++;
    return injectBeforeFinalGuard(f, items, records, "UPDATE experience_sponsor_resource_policies SET limits_json='{}'");
  };
  await assert.rejects(f.main.approve()); assert.equal(injected, 1);
  assert.deepEqual(await snapshot(f.DB), before, 'late native final CHECK failure rolls back campaign/resource/approval and fixture drift');
  f.observed.beforeBatch = null; receipt(f.main, 'approved', false, await f.main.approve());
  metrics(t, f);
});

async function seedHistory(f, approved) {
  const campaign = approved.compiled.policy.campaignId, now = await databaseNow(f);
  // Direct synthetic retained records, not actual grant issuance, admission,
  // reservation or settlement APIs. Nonempty histories make preservation real.
  for (const [id, actor] of [['used', other], ['pending', 'synthetic-guest']]) await f.DB.prepare('INSERT INTO experience_sponsor_grants VALUES(?,?,?,?,?,?,?,?,?,1)')
    .bind(`synthetic-${id}-grant`, campaign, approved.compiled.policyDigest, actor, hash('d'), `intent-${id}`, hash('e'), now - 100, now + 60000).run();
  await f.DB.prepare('INSERT INTO experience_sponsor_campaigns VALUES(?,?,?,1)').bind('synthetic-unrelated-campaign', hash('f'), '{}').run();
  await f.DB.prepare('INSERT INTO experience_sponsor_resource_policies VALUES(?,?,?,1)').bind('synthetic-unrelated-campaign', hash('f'), '{}').run();
  await f.DB.prepare('INSERT INTO experience_sponsor_grants VALUES(?,?,?,?,?,?,?,?,?,1)')
    .bind('synthetic-unrelated-grant', 'synthetic-unrelated-campaign', hash('f'), other, hash('d'), 'unrelated-intent', hash('e'), now - 100, now + 60000).run();
  await f.DB.prepare('INSERT INTO experience_sponsor_consumptions VALUES(?,?,?,?,?,?,?,?,?,?)')
    .bind('synthetic-consumption', 'synthetic-used-grant', campaign, other, hash('d'), 'intent-used', hash('e'), 'synthetic-job', 1234, now).run();
  await f.DB.prepare('INSERT INTO experience_sponsor_active_jobs VALUES(?,?,?)').bind(other, 'synthetic-consumption', 'synthetic-job').run();
  await f.DB.prepare('INSERT INTO experience_sponsor_resource_receipts VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind('synthetic-resource', campaign, approved.compiled.policyDigest, await digest(approved.compiled.policy.resources), other, hash('d'), 'text-intake', 'resource-intent', hash('e'), 17, null, now).run();
  await f.DB.prepare("INSERT INTO budget_reservations(reservation_id,owner_id,stream_id,correlation_id,operation,period,reserved_tokens,used_tokens,status,created_at,updated_at) VALUES('synthetic-token-hold',?,'synthetic-stream','synthetic-correlation','image','synthetic-period',123,7,'active',?,?)").bind(payer, time, time).run();
  await f.DB.prepare("INSERT INTO cost_budget_reservations(reservation_id,owner_id,stream_id,correlation_id,operation,period,reserved_microusd,used_microusd,status,created_at,updated_at) VALUES('synthetic-cost-hold',?,'synthetic-stream','synthetic-correlation','image','synthetic-period',1234,17,'active',?,?)").bind(payer, time, time).run();
  await f.DB.prepare("INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,requested_at,expires_at,updated_at) VALUES('synthetic-job',?,'synthetic-stream','synthetic-document','image','queued','synthetic','synthetic-correlation',0,'{}',?,'2099-01-01',?)").bind(other, time, time).run();
}

test('local workerd D1 fresh payer revokes after expiry and drift, with final rollback and monotonic history-preserving retry', { timeout: 90000 }, async t => {
  const f = await fixture(t), approved = await proposalFor(f, 'expiry', 2500);
  receipt(approved, 'approved', false, await approved.approve()); await seedHistory(f, approved);
  await f.DB.prepare("UPDATE users SET updated_at='2021-01-01' WHERE user_id='synthetic-payer'").run();
  await f.DB.prepare("UPDATE experience_sponsor_campaigns SET policy_json='{}',policy_digest='changed' WHERE campaign_id=?").bind(approved.compiled.policy.campaignId).run();
  await f.DB.prepare("UPDATE experience_sponsor_resource_policies SET limits_json='{}',limits_digest='changed' WHERE campaign_id=?").bind(approved.compiled.policy.campaignId).run();
  while (await databaseNow(f) < approved.compiled.policy.expiresAtMs) await new Promise(resolve => setTimeout(resolve, 25));
  const before = await snapshot(f.DB); f.observed.readOnly = true;
  await assert.rejects(approved.approve()); await assert.rejects(approved.revoke(other));
  assert.deepEqual(await snapshot(f.DB), before); f.observed.readOnly = false;
  let injected = 0;
  f.observed.beforeBatch = (items, records) => {
    if (!isRevoke(records)) return; injected++;
    return injectBeforeFinalGuard(f, items, records, "UPDATE experience_sponsor_grants SET enabled=1 WHERE grant_id='synthetic-pending-grant'");
  };
  await assert.rejects(approved.revoke()); assert.equal(injected, 1);
  assert.deepEqual(await snapshot(f.DB), before, 'the actual final disabled-grant proof rolls back every earlier revocation update');
  f.observed.beforeBatch = null; let revokeAttempts = 0;
  f.observed.afterBatch = records => { if (isRevoke(records)) { revokeAttempts++; throw Error('Synthetic lost revocation acknowledgment'); } };
  receipt(approved, 'revoked', true, await approved.revoke()); assert.equal(revokeAttempts, 1); f.observed.afterBatch = null;
  const after = await snapshot(f.DB), original = before.contents.experience_sponsor_approvals[0], revoked = after.contents.experience_sponsor_approvals[0];
  assert.deepEqual({ ...revoked, revoked_at_ms: null }, original); assert.ok(revoked.revoked_at_ms >= approved.compiled.policy.expiresAtMs);
  assert.deepEqual(withoutMutable(after), withoutMutable(before), 'all retained usage, resource receipts, active jobs, token/cost holds and native rows remain byte-for-byte unchanged');
  for (const table of ['experience_sponsor_campaigns', 'experience_sponsor_resource_policies', 'experience_sponsor_grants'])
    assert.deepEqual(after.contents[table], before.contents[table].map(row => row.campaign_id === approved.compiled.policy.campaignId ? { ...row, enabled: 0 } : row));
  receipt(approved, 'revoked', true, await approved.revoke()); f.observed.readOnly = true;
  await assert.rejects(approved.approve()); assert.deepEqual(await snapshot(f.DB), after, 'repeat revoke preserves the first DB timestamp and all original rows');
  metrics(t, f);
});

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { registerOutputSourceImports } from './output-execution-test-helpers.mjs';

registerOutputSourceImports();
const [{ ensureSchema }, { GUEST_CUSTODY_SCHEMA, GUEST_DB_NOW, issueGuestClaimSession, readGuestCustodyTerms },
  { GUEST_SOURCE_SCHEMA, readGuestSourcePolicy, prepareGuestImageSource, commitGuestImageSource },
  { prepareGuestImageProducer, recheckGuestImagePreparation }, { preflightOutputImageSlidesTarget }, { sponsorImageTransport },
  { registeredExperience, initialValues }, { canonicalJson, digest }] = await Promise.all([
  import('../worker/runtime.ts'), import('../worker/experience-guest-session.ts'), import('../worker/experience-guest-source.ts'),
  import('../worker/experience-guest-image-preparation.ts'), import('../worker/output-image-slides-preflight.ts'), import('../worker/experience-sponsor-image-evidence.ts'),
  import('../src/experiences/intake.ts'), import('../src/experiences/compiler.ts'),
]);
const requireWrangler = createRequire(import.meta.resolve('wrangler'));
const { Miniflare, Log, LogLevel } = requireWrangler('miniflare');
const origin = 'https://guest.example.invalid', subject = 'A blue heron on a stone bridge';
const request = () => new Request(`${origin}/unregistered-guest-image-preparation`, { method: 'POST', headers: { origin } });
const proofFor = session => ({ sessionId: session.sessionId, sessionToken: session.sessionToken, claimToken: session.claimToken });
const statements = sql => sql.split('--> statement-breakpoint').map(part => part.trim()).filter(Boolean);
const quote = name => '"' + name.replaceAll('"', '""') + '"';

// Observes actual workerd D1 execution, never a SQLite mock. During preparation
// every issued statement must be SELECT (optionally prefixed by read CTEs).
function observedDatabase(raw, diagnostic) {
  const records = [], handles = new WeakMap(), observed = { records, readOnly: false };
  function record(row) {
    assert.ok(row.bindings.length <= 100); assert.ok(Buffer.byteLength(row.sql) <= 100000);
    if (observed.readOnly) {
      assert.match(row.sql, /^\s*(?:SELECT|WITH)\b/iu, 'preparation may issue only read-only SQL');
      assert.doesNotMatch(row.sql, /\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE\s+[\w"]+\s+SET|DELETE\s+FROM|CREATE\s+(?:TABLE|TRIGGER)|DROP\s+(?:TABLE|TRIGGER)|ALTER\s+TABLE)\b/iu);
    }
    records.push({ sql: row.sql, parameters: row.bindings.length, sqlBytes: Buffer.byteLength(row.sql) });
  }
  function wrap(statement, sql, bindings = []) {
    const row = { statement, sql, bindings };
    const result = {
      bind(...args) { return wrap(statement.bind(...args), sql, args); },
      async first(...args) { record(row); try { return await statement.first(...args); } catch (error) { diagnostic(`Actual D1 first() failure: ${String(error)}; parameters=${bindings.length}; SQL bytes=${Buffer.byteLength(sql)}`); throw error; } },
      async all(...args) { record(row); return statement.all(...args); },
      async run(...args) { record(row); return statement.run(...args); },
    };
    handles.set(result, row); return result;
  }
  observed.DB = {
    prepare(sql) { return wrap(raw.prepare(sql), sql); },
    async batch(items) { return raw.batch(items.map(item => { const row = handles.get(item); assert.ok(row); record(row); return row.statement; })); },
  };
  return observed;
}
async function rows(db, table) { return (await db.prepare(`SELECT * FROM ${quote(table)} ORDER BY rowid`).all()).results; }
async function snapshot(db) {
  const schema = (await db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all()).results;
  const contents = {};
  for (const entry of schema.filter(row => row.type === 'table' && !row.name.startsWith('_cf_'))) contents[entry.name] = await rows(db, entry.name);
  return { schema, contents };
}
async function templateFor(env, release) {
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
async function candidatePolicy(f) {
  const now = (await f.DB.prepare(`SELECT ${GUEST_DB_NOW} AS value`).first()).value, template = await templateFor(f.env, f.release);
  const allowance = { maximumOperations: 100, maximumTextBytes: 1000000, maximumOperationsPerWindow: 100, maximumTextBytesPerWindow: 1000000,
    maximumPendingGrants: 10, maximumInflightJobs: 1 };
  const resources = { version: 1, startsAtMs: now - 60000, expiresAtMs: now + 60000, windowMs: 60000, maximumOperationTextBytes: 65536,
    campaign: { ...allowance, maximumInflightJobs: 3 }, actor: { ...allowance } };
  return { version: 3, mode: 'candidate', campaignId: 'synthetic-guest-campaign', policyVersion: 'synthetic-guest@1', payerUserId: 'synthetic-unprovisioned-payer',
    audience: 'guest-session', approvalReceiptDigest: `sha256:${'d'.repeat(64)}`, startsAtMs: resources.startsAtMs, expiresAtMs: resources.expiresAtMs,
    maximumGrantLifetimeMs: 30000, maximumAdmissions: 10, maximumMicrousd: Math.max(1000000, template.maximumMicrousd * 10), maximumAdmissionsPerActor: 5,
    windowMs: 60000, maximumAdmissionsPerWindow: 10, maximumAdmissionsPerActorWindow: 5, templates: [template], resources,
    guestAdmission: { protocol: 'guest-image-source@1', origin, sessionPolicyId: f.terms.policyId, sessionTermsDigest: await digest(f.terms),
      sourcePolicyId: f.sourcePolicy.policyId, sourcePolicyDigest: await digest(f.sourcePolicy), releaseHash: f.release.releaseHash } };
}
async function fixture(t, memory = false) {
  const directory = await mkdtemp(join(tmpdir(), 'forma-guest-preparation-d1-')), egress = [], media = [];
  const mf = new Miniflare({ modules: true, compatibilityDate: '2026-05-15', host: '127.0.0.1', port: 0,
    script: "export default { fetch() { return new Response('Local D1 fixture only.', {status:404}); } };",
    d1Databases: ['Preparation'], d1Persist: directory, log: new Log(LogLevel.NONE),
    outboundService: req => { egress.push(req.url); throw Error('Worker egress forbidden.'); },
  });
  t.after(async () => { await mf.dispose(); await rm(directory, { recursive: true, force: true }); assert.deepEqual(egress, []); assert.deepEqual(media, []); });
  const raw = await mf.getD1Database('Preparation'), observed = observedDatabase(raw, message => t.diagnostic(message)), DB = observed.DB;
  t.mock.method(globalThis, 'fetch', req => { egress.push(typeof req === 'string' ? req : req?.url); throw Error('Native application fetch forbidden.'); });
  const env = { DB, OPENAI_API_KEY: 'no-network-fixture', OPENAI_MODEL: 'gpt-5.6-terra', OPENAI_IMAGE_MODEL: 'gpt-image-2',
    MEDIA: Object.fromEntries(['get', 'head', 'put', 'delete', 'list'].map(method => [method, () => { media.push(method); throw Error('Media forbidden.'); }])),
    ASSETS: { fetch() { egress.push('assets'); throw Error('Assets forbidden.'); } } };
  // Native schema and guest source only. No native user, campaign enrollment,
  // grant, entitlement, sponsor policy row, persisted preflight or provider call
  // is made. A pure local preflight quote only supplies the candidate template.
  await ensureSchema(env);
  for (const sql of [...GUEST_CUSTODY_SCHEMA, ...GUEST_SOURCE_SCHEMA]) await DB.prepare(sql).run();
  if (memory) for (const name of ['0027_memory_native_origins.sql', '0033_memory_structured_answer_provenance.sql', '0034_memory_document_job_origins.sql'])
    await DB.batch(statements(await readFile(new URL('../drizzle/' + name, import.meta.url), 'utf8')).map(sql => DB.prepare(sql)));
  const databaseNow = (await DB.prepare(`SELECT ${GUEST_DB_NOW} AS value`).first()).value;
  const terms = readGuestCustodyTerms({ version: 1, policyId: 'guest-policy', origin, startsAtMs: databaseNow - 60000, expiresAtMs: databaseNow + 600000,
    sessionLifetimeMs: 300000, leaseLifetimeMs: 120000, maximumSessions: 5, maximumLeaseAcquisitions: 3 });
  await DB.prepare('INSERT INTO experience_guest_policies VALUES(?,?,?,?,NULL)').bind(terms.policyId, await digest(terms), canonicalJson(terms), `sha256:${'b'.repeat(64)}`).run();
  const session = await issueGuestClaimSession(request(), env, terms.policyId), release = await registeredExperience('image'), values = initialValues(release);
  values.subject = { value: subject, provenance: 'authored' }; values.ratio = { value: { width: 1, height: 1 }, provenance: 'authored' };
  const sourcePolicy = readGuestSourcePolicy({ version: 1, policyId: 'source-policy', sessionPolicyId: terms.policyId, sessionTermsDigest: await digest(terms), releaseHash: release.releaseHash,
    maximumDraftBytes: 65536, maximumEventBytes: 65536, maximumEvents: 16, draftLifetimeMs: 120000 });
  await DB.prepare('INSERT INTO experience_guest_source_policies VALUES(?,?,?,?,NULL)').bind(sourcePolicy.policyId, await digest(sourcePolicy), canonicalJson(sourcePolicy), `sha256:${'c'.repeat(64)}`).run();
  const proof = proofFor(session), prepared = await prepareGuestImageSource(request(), env, {
    proof, policyId: sourcePolicy.policyId, request: { intentId: session.sessionId, experienceId: 'image', releaseHash: release.releaseHash, values },
  });
  const committed = await commitGuestImageSource(request(), env, { proof, draftHash: prepared.plan.draftHash });
  const f = { DB, env, observed, session, terms, sourcePolicy, release, proof, prepared, committed };
  f.policy = await candidatePolicy(f); f.request = request();
  f.input = { proof, policy: f.policy, draftHash: prepared.plan.draftHash };
  f.prepare = () => prepareGuestImageProducer(f.request, env, f.input);
  f.recheck = witness => recheckGuestImagePreparation(f.request, env, witness);
  assert.deepEqual(await rows(DB, 'users'), []);
  for (const table of ['document_jobs', 'output_preflights', 'output_execution_grants', 'output_provider_calls', 'budget_reservations', 'cost_budget_reservations', 'experience_guest_claim_leases']) assert.deepEqual(await rows(DB, table), []);
  observed.records.length = 0;
  return f;
}
function metrics(t, f, memory) {
  t.diagnostic(JSON.stringify({ engine: 'Wrangler-pinned Miniflare/workerd D1', memory, executedStatements: f.observed.records.length,
    maxBindings: Math.max(...f.observed.records.map(row => row.parameters)), maxSqlBytes: Math.max(...f.observed.records.map(row => row.sqlBytes)) }));
}

function expected(f, result) {
  assert.deepEqual(Object.keys(result).sort(), ['preparation', 'status', 'summary']);
  assert.equal(result.status, 'source-bound'); assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.preparation)); assert.equal(Object.getPrototypeOf(result.preparation), null);
  assert.deepEqual(Object.keys(result.preparation), []); assert.ok(Object.isFrozen(result.summary));
  const summary = result.summary;
  assert.deepEqual(Object.keys(summary).sort(), ['admissionCommitted', 'campaignId', 'custodyTransferred', 'draftHash', 'driverId', 'expiresAtMs',
    'generationAvailable', 'guestSourceDigest', 'intentKey', 'issuerVerified', 'policyDigest', 'proposedRequirementDigest', 'protocol', 'providerSubmitted', 'sessionDigest', 'targetId'].sort());
  assert.equal(summary.protocol, 'guest-image-source@1'); assert.equal(summary.campaignId, f.policy.campaignId); assert.equal(summary.draftHash, f.prepared.plan.draftHash);
  for (const key of ['issuerVerified', 'admissionCommitted', 'providerSubmitted', 'generationAvailable', 'custodyTransferred']) assert.equal(summary[key], false, key);
  for (const key of ['sessionDigest', 'guestSourceDigest', 'policyDigest', 'proposedRequirementDigest']) assert.match(summary[key], /^sha256:[a-f0-9]{64}$/u);
  assert.match(summary.intentKey, /^guest-sponsor-intent-[a-f0-9]{64}$/u); assert.match(summary.driverId, /^guest-sponsor-driver-[a-f0-9]{64}$/u);
  assert.equal(typeof summary.targetId, 'string'); assert.ok(summary.targetId.length > 0);
  assert.ok(Number.isSafeInteger(summary.expiresAtMs)); assert.ok(summary.expiresAtMs <= Math.min(f.policy.expiresAtMs, f.policy.resources.expiresAtMs,
    f.session.expiresAtMs, f.terms.expiresAtMs, Date.parse(f.prepared.expiresAt)));
  const serialized = JSON.stringify(result);
  for (const secret of [subject, f.session.sessionToken, f.session.claimToken]) assert.ok(!serialized.includes(secret), 'summary contains no source prose or bearer credentials');
}

// Both existing native Memory schema paths execute actual production proofs.
// This is dormant source preparation, not payer approval, admission, provider
// access, generation, a deployed endpoint or a real campaign configuration.
for (const memory of [false, true]) test(`local workerd D1 prepares and rechecks guest Image source with ${memory ? 'complete' : 'absent'} Memory schema without writes, then refuses changed private bytes`, { timeout: 90000 }, async t => {
  const f = await fixture(t, memory), before = await snapshot(f.DB);
  f.observed.records.length = 0; f.observed.readOnly = true;
  const prepared = await f.prepare(); expected(f, prepared);
  assert.equal(prepared.summary.policyDigest, await digest(f.policy));
  assert.equal(await f.recheck(prepared.preparation), undefined);
  await assert.rejects(recheckGuestImagePreparation(request(), f.env, prepared.preparation), /guest_custody_image_preparation_unavailable/u);
  await assert.rejects(recheckGuestImagePreparation(f.request, { ...f.env }, prepared.preparation), /guest_custody_image_preparation_unavailable/u);
  await assert.rejects(f.recheck(structuredClone(prepared.preparation)), /guest_custody_image_preparation_unavailable/u);
  assert.deepEqual(await snapshot(f.DB), before, 'minting and rechecking the request-local witness cannot alter any application row or schema');
  f.observed.readOnly = false;
  await f.DB.prepare("UPDATE private_content SET content='{}' WHERE content_id=?").bind(f.prepared.plan.draftId).run();
  const changed = await snapshot(f.DB); f.observed.readOnly = true;
  await assert.rejects(f.recheck(prepared.preparation), /guest_custody_image_preparation_unavailable/u);
  await assert.rejects(f.prepare(), /guest_custody_/u);
  assert.deepEqual(await snapshot(f.DB), changed, 'denial cannot rewrite or repair the changed original source');
  metrics(t, f, memory);
});

test('local workerd D1 preparation enforces current source-policy revocation without changing the retained historical source', { timeout: 90000 }, async t => {
  const f = await fixture(t), before = await snapshot(f.DB); f.observed.records.length = 0; f.observed.readOnly = true;
  const prepared = await f.prepare(); expected(f, prepared); await f.recheck(prepared.preparation);
  assert.deepEqual(await snapshot(f.DB), before);
  f.observed.readOnly = false;
  await f.DB.prepare(`UPDATE experience_guest_source_policies SET revoked_at_ms=${GUEST_DB_NOW} WHERE policy_id=?`).bind(f.sourcePolicy.policyId).run();
  const revoked = await snapshot(f.DB); f.observed.readOnly = true;
  await assert.rejects(f.recheck(prepared.preparation), /guest_custody_image_preparation_unavailable/u);
  await assert.rejects(f.prepare(), /guest_custody_image_preparation_unavailable/u);
  assert.deepEqual(await snapshot(f.DB), revoked, 'current production denial preserves every original policy/source/event/private row');
  metrics(t, f, false);
});

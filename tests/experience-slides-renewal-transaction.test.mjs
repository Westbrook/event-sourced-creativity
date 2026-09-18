import assert from 'node:assert/strict';
import test from 'node:test';
import { registerOutputSourceImports, outputTestDatabase } from './output-server-test-helpers.mjs';

// Real local intake, custody, ledger, preflight and SQLite transactions; no
// provider/network or authority port replacements. Synthetic authored content.
const imports = registerOutputSourceImports();
const previousFetch = globalThis.fetch;
let forbidden = 0;
const noPaid = () => { forbidden++; throw Error('Unpaid Slides renewal cannot execute'); };
globalThis.fetch = noPaid;
test.after(() => { imports.deregister(); globalThis.fetch = previousFetch; assert.equal(forbidden, 0); });
const runtime = await import('../worker/runtime.ts');
const { handleExperienceIntake } = await import('../worker/experience-intake-api.ts');
const { handleExperienceOutput } = await import('../worker/experience-output-api.ts');
const { registeredExperience } = await import('../src/experiences/intake.ts');
const { preflightOutputImageSlidesTarget } = await import('../worker/output-image-slides-preflight.ts');
const { decodeExperienceBinding } = await import('../src/experiences/output-binding-client.ts');
const execution = { waitUntil: noPaid };
const owner = 'dev-local-creative';
const financial = ['output_execution_grants', 'output_operation_slots', 'document_jobs', 'budget_reservations', 'cost_budget_reservations', 'output_provider_calls'];
const post = (path, body) => new Request('http://localhost' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function fixture(t) {
  const s = outputTestDatabase(); t.after(() => s.sqlite.close()); await runtime.ensureSchema(s.env);
  const now = new Date().toISOString();
  s.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,'creator','pilot-2026-08-10',?,?,?)")
    .run(owner, 'creative@local.forma', 'Local creative', now, now, now);
  s.env.OPENAI_API_KEY = 'fixture-no-network';
  const release = await registeredExperience('slides');
  const intent = { experienceId: 'slides', intentId: '00000000-0000-4000-8000-000000000093', releaseHash: release.releaseHash,
    values: { claim: { value: 'The local image export verification passed.', provenance: 'authored' },
      evidence: { value: [{ id: 'e1', text: 'The exported image opens.' }, { id: 'e2', text: 'Its saved dimensions match the request.' }, { id: 'e3', text: 'The original source remains unchanged.' }], provenance: 'authored' } } };
  let response = await handleExperienceIntake(post('/api/experiences/drafts', intent), s.env);
  assert.equal(response.status, 200, await response.clone().text()); s.plan = (await response.json()).plan;
  response = await handleExperienceIntake(post(`/api/experiences/drafts/${s.plan.draftId}/commit`, { draftHash: s.plan.draftHash }), s.env);
  assert.equal(response.status, 200, await response.clone().text()); assert.equal((await response.json()).status, 'complete');
  s.path = `/api/experiences/drafts/${s.plan.draftId}/output`;
  s.bridge = { preflight: preflightOutputImageSlidesTarget, prepareAdmission: noPaid, dispatch: noPaid, resolveResult: noPaid, cleanupExpiredOrRevoked: noPaid };
  s.send = body => handleExperienceOutput(body ? post(s.path + '/prepare', body) : new Request('http://localhost' + s.path), s.env, execution, s.bridge);
  const RealDate = Date, old = Date.now() - 1_200_000;
  globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [old])); } static now() { return old; } };
  try { response = await s.send({ draftHash: s.plan.draftHash, explicitRequirementsConfirmation: true }); assert.equal(response.status, 200, await response.clone().text()); }
  finally { globalThis.Date = RealDate; }
  response = await s.send(); assert.equal(response.status, 200, await response.clone().text());
  s.expired = await response.json(); assert.equal(s.expired.permitted.renewPreparation, true, JSON.stringify(s.expired));
  s.body = { draftHash: s.plan.draftHash, explicitRequirementsConfirmation: true, renewal: { predecessorPreflightId: s.expired.preflight.id, explicitRenewal: true } };
  s.unpaid = () => { for (const table of financial) assert.equal(s.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0, table); assert.equal(s.media.size, 0); };
  return s;
}

test('expired Slides quote renews in the same draft with unchanged content and no paid effects', async t => {
  const s = await fixture(t), oldCommands = s.sqlite.prepare('SELECT * FROM output_commands ORDER BY command_key').all();
  const retained = s.sqlite.prepare('SELECT * FROM private_content WHERE content_id=?').get(s.plan.draftId);
  const created = s.sqlite.prepare("SELECT * FROM events WHERE type IN('ProjectCreated','DocumentCreated','BlockCreated') ORDER BY sequence").all();
  const response = await s.send(s.body); assert.equal(response.status, 200, await response.clone().text()); const fresh = await response.json();
  assert.equal(fresh.documentId, s.plan.documentId); assert.equal(fresh.draftId, s.plan.draftId);
  assert.notEqual(fresh.preflight.id, s.expired.preflight.id); assert.ok(Date.parse(fresh.preflight.expiresAt) > Date.now());
  assert.equal(fresh.permitted.authorize, true); assert.equal(fresh.permitted.run, false); assert.equal(fresh.grant, null);
  assert.equal(fresh.preflight.targets[0].settings.payload.itemCount, 5);
  assert.equal(fresh.preflight.maximumCalls, 2);
  assert.ok(decodeExperienceBinding(s.expired, { ...s.expired, actorUserId: owner }));
  assert.ok(decodeExperienceBinding(fresh, { ...fresh, actorUserId: owner }));
  assert.deepEqual(s.sqlite.prepare('SELECT * FROM private_content WHERE content_id=?').get(s.plan.draftId), retained);
  assert.deepEqual(s.sqlite.prepare("SELECT * FROM events WHERE type IN('ProjectCreated','DocumentCreated','BlockCreated') ORDER BY sequence").all(), created);
  for (const row of oldCommands) assert.deepEqual(s.sqlite.prepare('SELECT * FROM output_commands WHERE command_key=?').get(row.command_key), row);
  const replay = await s.send(s.body); assert.equal(replay.status, 200, await replay.clone().text());
  assert.equal((await replay.json()).preflight.id, fresh.preflight.id); s.unpaid();
});

test('lost Slides preflight response resumes one successor without another Save', async t => {
  const s = await fixture(t), preflight = s.bridge.preflight; let interrupted = false;
  s.bridge.preflight = async (...args) => { if (!interrupted) { interrupted = true; throw Error('fixture interruption'); } return preflight(...args); };
  assert.notEqual((await s.send(s.body)).status, 200);
  const retry = await s.send(s.body); assert.equal(retry.status, 200, await retry.clone().text());
  assert.equal((await retry.json()).permitted.authorize, true);
  assert.equal(s.sqlite.prepare("SELECT COUNT(*) AS n FROM output_commands WHERE action='save'").get().n, 1);
  assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS n FROM output_plan_revisions').get().n, 2); s.unpaid();
});

test('concurrent Slides renewals converge on one successor', async t => {
  const s = await fixture(t), results = await Promise.all([s.send(s.body), s.send(s.body)]);
  assert.ok(results.some(r => r.status === 200));
  assert.equal((await s.send(s.body)).status, 200);
  assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS n FROM output_plan_revisions').get().n, 2);
  assert.equal(s.sqlite.prepare("SELECT COUNT(*) AS n FROM output_commands WHERE command_key LIKE 'slides-cycle-v1:%' AND action='preflight'").get().n, 1); s.unpaid();
});

for (const mutation of ['authorization', 'retention', 'source', 'token-reservation', 'cost-reservation']) test(`late ${mutation} change blocks Slides renewal atomically`, async t => {
  const s = await fixture(t), batch = s.DB.batch.bind(s.DB); let raced = false;
  s.DB.batch = async statements => {
    if (!raced && statements.some(q => /^INSERT INTO output_commands\b/u.test(q.sql.trim()))) {
      raced = true;
      if (mutation === 'authorization') s.sqlite.prepare("INSERT INTO output_commands SELECT scope_key,actor_user_id,'late-slides-authorize',request_digest,'authorize',event_id,created_at FROM output_commands WHERE action='confirm' LIMIT 1").run();
      else if (mutation === 'retention') s.sqlite.prepare('UPDATE private_content SET expires_at=? WHERE content_id=?').run(new Date(Date.now() + 60_000).toISOString(), s.plan.draftId);
      else if (mutation === 'source') s.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_set(private_json,'$.text','changed') WHERE private_event_id IN(SELECT event_id FROM events WHERE type='BlockCreated')").run();
      else {
        const token = mutation === 'token-reservation', table = token ? 'budget_reservations' : 'cost_budget_reservations', amount = token ? 'reserved_tokens' : 'reserved_microusd';
        s.sqlite.prepare(`INSERT INTO ${table}(reservation_id,owner_id,stream_id,correlation_id,operation,period,${amount},status,created_at,updated_at) VALUES('late',?,?,?,'document-render:slides','2026-09',1,'settled',?,?)`)
          .run(owner, `creative:${owner}`, 'unassociated-job', new Date().toISOString(), new Date().toISOString());
      }
    }
    return batch(statements);
  };
  assert.notEqual((await s.send(s.body)).status, 200); assert.equal(raced, true);
  assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS n FROM output_plan_revisions').get().n, 1);
  if (!mutation.endsWith('reservation')) s.unpaid();
  else { assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS n FROM output_execution_grants').get().n, 0); assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS n FROM document_jobs').get().n, 0); }
});

test('stale predecessor and non-explicit Slides renewal cannot mint new quotes', async t => {
  const s = await fixture(t);
  for (const renewal of [{ ...s.body.renewal, predecessorPreflightId: 'other' }, { ...s.body.renewal, explicitRenewal: false }])
    assert.notEqual((await s.send({ ...s.body, renewal })).status, 200);
  assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS n FROM output_plan_revisions').get().n, 1); s.unpaid();
});

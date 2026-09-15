import assert from 'node:assert/strict';
import test from 'node:test';
import { outputTestDatabase } from './output-server-test-helpers.mjs';
import { glb } from './helpers/model3d-native-execution-fixture.mjs';
import { registerOutputSourceImports } from './output-execution-test-helpers.mjs';
registerOutputSourceImports();
const { ensureSchema } = await import('../worker/runtime.ts');
const { POLICY_VERSION } = await import('../worker/policy-version.ts');
const { handleExperienceIntake } = await import('../worker/experience-intake-api.ts');
const { handleExperienceOutput } = await import('../worker/experience-output-api.ts');
const { registeredExperience, initialValues } = await import('../src/experiences/intake.ts');
const { outputDocumentExecutionBridge } = await import('../worker/output-document-execution.ts');
const { runDocumentJob } = await import('../worker/document-jobs-api.ts');
const { requireUser } = await import('../worker/pilot-policy.ts');
const { RODIN_TEXT_MODEL } = await import('../src/model/model3d.ts');
const { decodeExperienceBinding, ExperienceOutputBindingClient } = await import('../src/experiences/output-binding-client.ts');
const { readRetainedOutputModel3d } = await import('../worker/output-model3d-retained.ts');
const { outputAssertionStatements } = await import('../worker/output-requirements-ledger.ts');
const { outputTerms } = await import('../src/experiences/output-terms.ts');
const { readModel3dExecutionOffer } = await import('../src/model/output-model3d-offer.ts');

const flush = async () => { for (let i = 0; i < 100; i++) await new Promise(resolve => setImmediate(resolve)); };
const post = (path, body) => new Request('http://localhost' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
// Full real HTTP intake/prepare/authorize/run and runner. Only remote provider
// traffic and wall time are synthetic. Not evidence of a live paid generation.
for (const renewalFailure of [false, true]) test(`native 3D survives slow provider: first renewal fault=${renewalFailure}`, async t => {
  const f = outputTestDatabase(':memory:'); t.after(() => f.sqlite.close());
  let posts = 0, renewals = 0, injected = false, monotonic = 0;
  t.mock.method(globalThis, 'fetch', () => { throw Error('provider called before deliberate Start'); });
  await ensureSchema(f.env);
  const owner = 'dev-local-creative', now = new Date().toISOString();
  f.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,'creator',?,?,?,?)")
    .run(owner, 'qualification@invalid', 'Local qualification', POLICY_VERSION, now, now, now);
  f.env.FAL_KEY = 'qualification-not-a-provider-key';
  const release = await registeredExperience('model3d');
  const intent = { intentId: '00000000-0000-4000-8000-000000000094', experienceId: 'model3d', releaseHash: release.releaseHash,
    values: { ...initialValues(release), subject: { value: 'One ceramic desk lamp', provenance: 'authored' },
      direction: { value: 'Rounded blue base. One static object, no text.', provenance: 'authored' } } };
  const saved = await handleExperienceIntake(post('/api/experiences/drafts', intent), f.env);
  assert.equal(saved.status, 200, await saved.clone().text()); const { plan } = await saved.json();
  const committed = await handleExperienceIntake(post(`/api/experiences/drafts/${plan.draftId}/commit`, { draftHash: plan.draftHash }), f.env);
  assert.equal(committed.status, 200, await committed.clone().text());
  const identity = { ...plan, output: 'model3d', actorUserId: owner, releaseHash: release.releaseHash };
  const path = `/api/experiences/drafts/${plan.draftId}/output`, executionContext = { waitUntil() { throw Error('unexpected background execution'); } };
  const send = async (action, body) => {
    const response = await handleExperienceOutput(post(path + '/' + action, body), f.env, executionContext, outputDocumentExecutionBridge);
    assert.equal(response.status, 200, await response.clone().text()); return response.json();
  };
  const prepared = await send('prepare', { draftHash: plan.draftHash, explicitRequirementsConfirmation: true });
  assert.equal(prepared.permitted.authorize, true); assert.ok(prepared.model3dCostPreview);
  const admitted = await send('authorize', { draftHash: plan.draftHash, termsDigest: prepared.preflight.termsDigest,
    maximumMicrousd: prepared.preflight.maximumMicrousd, explicitAuthorization: true,
    model3dCostConsent: { ...prepared.model3dCostPreview, confirmed: true, providerTransferConfirmed: true } });
  assert.equal(admitted.permitted.run, true);
  await send('run', { draftHash: plan.draftHash, grantId: admitted.original.grantId, explicitRun: true });
  const jobId = admitted.original.jobId;
  const auth = await requireUser(new Request('http://localhost/api/session'), f.env, 'creator'); assert.ok(auth.user);
  const entered = Promise.withResolvers(), releaseStatus = Promise.withResolvers(), bytes = glb();
  const batch = f.env.DB.batch.bind(f.env.DB);
  f.env.DB.batch = async statements => {
    if (statements.some(statement => statement.sql.includes('UPDATE document_jobs SET lease_expires_at'))) {
      renewals++;
      if (renewalFailure && !injected) { injected = true; throw Error('D1_ERROR: synthetic heartbeat write failure'); }
    }
    return batch(statements);
  };
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const target = String(url);
    if (target === `https://queue.fal.run/${RODIN_TEXT_MODEL}` && init?.method === 'POST') {
      posts++; return Response.json({ request_id: posts === 1 ? 'slow-model-original' : 'slow-model-replacement', status: 'IN_PROGRESS' });
    }
    if (/^https:\/\/queue\.fal\.run\/fal-ai\/hyper3d\/requests\/slow-model-(original|replacement)\/status\?logs=1$/u.test(target)) {
      entered.resolve(); await releaseStatus.promise;
      init?.signal?.throwIfAborted();
      return Response.json({ request_id: target.includes('replacement') ? 'slow-model-replacement' : 'slow-model-original', status: 'COMPLETED' });
    }
    if (/^https:\/\/queue\.fal\.run\/fal-ai\/hyper3d\/requests\/slow-model-(original|replacement)$/u.test(target)) return Response.json({ seed: 7,
      model_mesh: { url: 'https://fal.media/files/slow.glb', file_name: 'slow.glb', content_type: 'model/gltf-binary', file_size: bytes.length }, textures: [] });
    if (target === 'https://fal.media/files/slow.glb') return new Response(bytes, { headers: { 'content-type': 'model/gltf-binary', 'content-length': String(bytes.length) } });
    throw Error(`unexpected synthetic provider route: ${target}`);
  });
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  t.mock.method(performance, 'now', () => monotonic);
  let running;
  try {
    running = runDocumentJob(f.env, auth.user, jobId);
    await Promise.race([entered.promise, running.then(() => { throw Error('runner stopped before provider status: ' + JSON.stringify(f.sqlite.prepare('SELECT status,error_message,result_json FROM document_jobs WHERE job_id=?').get(jobId))); })]);
    for (let i = 0; i < 2; i++) { monotonic += 60000; t.mock.timers.tick(60000); await flush(); }
    if (!renewalFailure) {
      assert.equal(renewals, 2);
      const waiting = f.sqlite.prepare('SELECT status,result_json FROM document_jobs WHERE job_id=?').get(jobId);
      assert.equal(waiting.status, 'running');
      const submissions = Object.values(JSON.parse(waiting.result_json).providerSubmissions);
      assert.equal(submissions.length, 1); assert.equal(submissions[0].status, 'accepted');
      assert.equal(submissions[0].providerRequestId, 'slow-model-original');
    }
    monotonic += 5000; t.mock.timers.tick(5000); await flush(); releaseStatus.resolve(); await running;
    const row = f.sqlite.prepare('SELECT * FROM document_jobs WHERE job_id=?').get(jobId);
    assert.equal(posts, 1);
    assert.equal(row.status, renewalFailure ? 'failed' : 'completed', JSON.stringify({ error: row.error_message, result: row.result_json }));
    const call = f.sqlite.prepare('SELECT * FROM output_provider_calls').get();
    assert.equal(call.status, renewalFailure ? 'uncertain' : 'settled');
    assert.equal(call.used_microusd, renewalFailure ? null : 400000);
    if (renewalFailure) {
      assert.equal(injected, true);
      assert.equal(Object.values(JSON.parse(row.result_json).providerSubmissions)[0].status, 'accepted');
      assert.notEqual(f.sqlite.prepare('SELECT status FROM cost_budget_reservations').get().status, 'settled');
      assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM events WHERE type='DocumentRenderCompleted'").get().n, 0);
    } else {
      assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM events WHERE type='DocumentRenderCompleted'").get().n, 1);
      assert.ok(f.sqlite.prepare('SELECT COUNT(*) n FROM output_native_storage_writes WHERE publication_event_id IS NOT NULL').get().n > 0);
    }
    await runDocumentJob(f.env, auth.user, jobId); assert.equal(posts, 1, 'terminal replay never resubmits');
    if (renewalFailure) {
      // Near-retention edge: child has a fixed15-minute quote, not a new
      //15-minute parent runway on each authorization/execution refresh.
      monotonic += 16 * 60000; t.mock.timers.tick(16 * 60000); await flush();
      // SQLite's SQL clock is real rather than Node's mocked Date.
      f.sqlite.prepare('UPDATE output_execution_grants SET expires_at=? WHERE grant_id=?')
        .run('2000-01-01T00:00:00.000Z', admitted.original.grantId);
      f.sqlite.prepare('UPDATE document_jobs SET expires_at=? WHERE job_id=?').run(new Date(Date.now() + 16 * 60000).toISOString(), jobId);
      const oldCall = structuredClone(f.sqlite.prepare('SELECT * FROM output_provider_calls WHERE slot_id=?').get(admitted.original.slotId));
      const oldCost = structuredClone(f.sqlite.prepare('SELECT * FROM cost_budget_reservations WHERE reservation_id=(SELECT cost_reservation_id FROM output_operation_slots WHERE slot_id=?)').get(admitted.original.slotId));
      const view = await handleExperienceOutput(new Request('http://localhost' + path), f.env, executionContext, outputDocumentExecutionBridge);
      assert.equal(view.status, 200, await view.clone().text()); const current = await view.json();
      assert.equal(current.permitted.prepareReplacement, true, JSON.stringify({ status: current.status, permitted: current.permitted,
        call: f.sqlite.prepare('SELECT status,used_microusd FROM output_provider_calls').get(), cost: oldCost }));
      const replacement = current.model3dReplacement;
      assert.equal(current.status, 'unavailable', 'expired original authorization cannot start work but may qualify for a separately admitted child');
      assert.ok(decodeExperienceBinding(current, identity), 'native failed state and replacement are browser-decodable');
      for (const change of [{ cycleId: 'wrong' }, { previousSlotId: 'wrong' }, { previousJobId: 'wrong' }, { priorHeldMicrousd: 0 }, { newMaximumMicrousd: 0 }, { cumulativeMaximumMicrousd: 400000 }, { extra: true }])
        assert.equal(decodeExperienceBinding({ ...current, model3dReplacement: { ...replacement, ...change } }, identity), null);
      const transport = [];
      const client = new ExperienceOutputBindingClient(identity, { origin: 'http://localhost', current: () => true, request: async (url, init) => {
        transport.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null });
        const response = Response.json(current); Object.defineProperty(response, 'url', { value: 'http://localhost' + url }); return response;
      } });
      await client.read(); assert.equal(transport.length, 1); assert.equal(transport[0].method, 'GET');
      await client.command('prepareReplacement', structuredClone(client.state)); assert.equal(transport.length, 1, 'stale state cannot submit');
      await client.command('prepareReplacement', client.state);
      assert.equal(transport.length, 2); assert.ok(transport[1].url.endsWith('/prepare'));
      assert.deepEqual(transport[1].body.replacement, { cycleId: replacement.cycleId, previousSlotId: replacement.previousSlotId, explicitReplacement: true });
      client.dispose();
      assert.equal(replacement.priorHeldMicrousd, 400000); assert.equal(replacement.cumulativeMaximumMicrousd, 800000);
      const next = await send('prepare', { draftHash: plan.draftHash, explicitRequirementsConfirmation: true,
        replacement: { cycleId: replacement.cycleId, previousSlotId: replacement.previousSlotId, explicitReplacement: true } });
      assert.equal(next.permitted.authorize, true, JSON.stringify(next));
      assert.equal(next.model3dCostPreview.version, 'model3d-mini-app-replacement-cost-v1');
      assert.ok(decodeExperienceBinding(next, identity), 'replacement quote is browser-decodable');
      const termsOptions = { now: Date.now(), output: 'model3d', targetId: next.plan.targetId,
        expectedModel3dContract: readModel3dExecutionOffer(next.preflight.targets[0]).contract, model3dCostPreview: next.model3dCostPreview };
      assert.equal(outputTerms(next.preflight, termsOptions).available, true, 'actual replacement cost terms enable informed consent');
      for (const change of [{ ordinal: 0 }, { ordinal: 2 }, { previousSlotId: null }, { previousSlotId: 'other' }]) {
        const bad = structuredClone(next.preflight); Object.assign(bad.operationAttempts[next.plan.targetId], change);
        assert.equal(outputTerms(bad, termsOptions).available, false);
      }
      assert.notEqual(next.model3dCostPreview.requestId, jobId);
      assert.equal(posts, 1, 'replacement preparation is unpaid');
      const replayedPreparation = await send('prepare', { draftHash: plan.draftHash, explicitRequirementsConfirmation: true,
        replacement: { cycleId: replacement.cycleId, previousSlotId: replacement.previousSlotId, explicitReplacement: true } });
      assert.equal(replayedPreparation.preflight.id, next.preflight.id, 'lost preparation ACK reuses the same child');
      monotonic += 120000; t.mock.timers.tick(120000); await flush();
      const child = await send('authorize', { draftHash: plan.draftHash, termsDigest: next.preflight.termsDigest,
        maximumMicrousd: next.preflight.maximumMicrousd, explicitAuthorization: true,
        model3dCostConsent: { ...next.model3dCostPreview, confirmed: true, providerTransferConfirmed: true } });
      assert.equal(child.permitted.run, true, JSON.stringify(child));
      assert.equal(outputTerms(child.preflight, { ...termsOptions, now: Date.now(), grant: child.grant }).grantAvailable, true);
      assert.notEqual(child.original.grantId, admitted.original.grantId);
      assert.equal(posts, 1, 'replacement authorization is unpaid');
      assert.deepEqual(structuredClone(f.sqlite.prepare('SELECT * FROM output_provider_calls WHERE slot_id=?').get(admitted.original.slotId)), oldCall);
      assert.deepEqual(structuredClone(f.sqlite.prepare('SELECT * FROM cost_budget_reservations WHERE reservation_id=?').get(oldCost.reservation_id)), oldCost);
      await send('run', { draftHash: plan.draftHash, grantId: child.original.grantId, explicitRun: true });
      await runDocumentJob(f.env, auth.user, child.original.jobId);
      await runDocumentJob(f.env, auth.user, child.original.jobId);
      const after = f.sqlite.prepare('SELECT status,error_message,result_json FROM document_jobs WHERE job_id=?').get(child.original.jobId);
      assert.equal(after.status, 'completed', JSON.stringify(after)); assert.equal(posts, 2);
      assert.deepEqual(structuredClone(f.sqlite.prepare('SELECT * FROM output_provider_calls WHERE slot_id=?').get(admitted.original.slotId)), oldCall);
      assert.deepEqual(structuredClone(f.sqlite.prepare('SELECT * FROM cost_budget_reservations WHERE reservation_id=?').get(oldCost.reservation_id)), oldCost);
      const final = await handleExperienceOutput(new Request('http://localhost' + path), f.env, executionContext, outputDocumentExecutionBridge);
      assert.equal(final.status, 200, await final.clone().text()); const finished = await final.json();
      assert.equal(finished.status, 'succeeded'); assert.notEqual(finished.permitted.prepareReplacement, true);
      assert.equal(finished.grant.usedMicrousd, 400000);
      assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM output_operation_slots').get().n, 2);
      assert.ok(decodeExperienceBinding(finished, identity), 'completed replacement is browser-decodable');
      const completion = f.sqlite.prepare("SELECT e.event_id,p.private_json FROM events e JOIN event_private_payloads p ON p.private_event_id=e.event_id WHERE e.type='DocumentRenderCompleted' AND e.correlation_id=(SELECT correlation_id FROM document_jobs WHERE job_id=?)").get(child.original.jobId);
      const payload = JSON.parse(completion.private_json), content = f.sqlite.prepare('SELECT content,expires_at FROM private_content WHERE content_id=?').get(payload.content_ref);
      const read = async () => {
        const proof = await readRetainedOutputModel3d(f.env, { ownerId: owner, completionId: completion.event_id, documentId: plan.documentId,
          projectId: plan.projectId, artifactId: payload.artifact_id, contentId: payload.content_ref, inputId: payload.input_ref,
          rawContent: content.content, contentExpiresAt: content.expires_at, completionRaw: completion.private_json });
        await f.env.DB.batch(proof.assertions.flatMap(a => outputAssertionStatements(f.env, a))); return proof;
      };
      await read();
      const rowWitnesses = [
        ['UPDATE output_operation_slots SET previous_slot_id=? WHERE slot_id=?', [child.original.slotId, child.original.slotId]],
        ['UPDATE output_provider_calls SET provider_response_id=? WHERE slot_id=?', ['wrong', admitted.original.slotId]],
        ["UPDATE event_private_payloads SET private_json=json_set(private_json,'$.output_command_envelope.experienceBinding.replacementCycle.id','wrong') WHERE private_event_id=(SELECT confirmed_event_id FROM output_plan_revisions WHERE plan_revision_id=?)", [child.plan.revisionId]],
        ["UPDATE event_private_payloads SET redacted_at='2026-01-01T00:00:00.000Z' WHERE private_event_id=(SELECT confirmed_event_id FROM output_plan_revisions WHERE plan_revision_id=?)", [child.plan.revisionId]],
      ];
      for (const [sql, values] of rowWitnesses) {
        f.sqlite.exec('SAVEPOINT retained_negative');
        try { f.sqlite.prepare(sql).run(...values); await assert.rejects(read()); }
        finally { f.sqlite.exec('ROLLBACK TO retained_negative'); f.sqlite.exec('RELEASE retained_negative'); }
      }
      await read(); assert.equal(posts, 2, 'retained reads never regenerate');
    }
  } finally { releaseStatus.resolve(); t.mock.timers.reset(); if (running) await running.catch(() => {}); await flush(); }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, readFile, chmod, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCreativeDirectionRequest, buildCreativeImagePrompt, generateCreativeDirection } from '../worker/openai-adapter.ts';
import { generateCreativeImage } from '../worker/image-adapter.ts';
import { moderateGenerationSnapshot } from '../worker/openai-moderation.ts';
import { sourceAdvisoryInputs } from '../src/model/source-advisory.ts';
import { hash, factorDiff, validateCoverage, seal } from '../evals/generation-reliability/core.mjs';
import { reviewedRequests, safetyIdentifier } from '../evals/generation-reliability/execution-plan.mjs';
import { capturePreparation } from '../evals/generation-reliability/preparation/contract.mjs';
import { createPreparationHost } from '../evals/generation-reliability/preparation/native-host.mjs';
import { validateWire, submitStudyStage } from '../evals/generation-reliability/native-host/transport.mjs';
import { suppliedInput, validateSuppliedInput, assessInvocation } from '../evals/generation-reliability/p1/input-contract.mjs';
import { brief, snapshot, direction, demoInstruction, config } from '../evals/generation-reliability/p1/demo-fixture.mjs';
import { png } from './output-asset-fixtures.mjs';
import { PROFILE, applyProfile, promptSections } from '../docs/evidence/generation-p1/i-profile.mjs';

const env = { OPENAI_API_KEY: 'OFFLINE-NON-CREDENTIAL-SENTINEL', OPENAI_MODEL: 'gpt-5.6-terra', OPENAI_IMAGE_MODEL: config.model, IMAGE_PROVIDER: 'openai' };
const owner = 'p1-demonstration-only';
const usage = { input_tokens: 10, output_tokens: 20, total_tokens: 30, input_tokens_details: { text_tokens: 10, image_tokens: 0 } };
const pixels = Buffer.from(png({ width: 1536, height: 1024 })).toString('base64');
const options = { quality: config.quality, size: config.size, outputFormat: 'png', partialImages: 0, references: [], promptTechnique: 'prose' };
const requirements = ['runs freely off leash', 'all four paws', 'clear gap', 'leash, tether, collar, harness', 'people, text, signs, logos or additional animals'].map((s, i) => ({ id: `r${i}`, text: s, mustContain: [s] }));
const report = { schema: 'p1-offline-interception-v1', evidenceClass: 'synthetic-plumbing-only', liveProviderCalls: 0, empiricalQualityEvidence: false, checks: [], scenarios: [] };
const check = (name, detail = {}) => report.checks.push({ name, ...detail });

// Test-only composition: calls real adapters; does NOT instantiate job admission or a study service.
async function exercise({ mode = 'renderer', fault = null, faultStage = 'image', stop = null, candidate = false } = {}) {
  const calls = [], evidence = [], finance = [], order = [], outcomes = [];
  let arm = 'baseline', captureFailed = false;
  const original = globalThis.fetch;
  const onEvidence = async e => {
    order.push(`evidence:${e.phase}:${e.outcome.pipelineStage}`);
    if (fault === 'custody' && e.phase === 'response' && e.outcome.pipelineStage === 'media_result') throw Error('mock_private_custody_failed');
    if (fault === 'advisory-custody' && e.outcome.pipelineStage === 'app_moderation') throw Error('mock_private_custody_failed');
    evidence.push(structuredClone(e));
  };
  const paid = async e => { finance.push({ arm, ...e }); order.push(`finance:${e.status}:${e.operation}`); };
  globalThis.fetch = async (url, init) => {
    assert.equal(new URL(url).origin, 'https://api.openai.com');
    assert.equal(init.method, 'POST');
    const body = JSON.parse(init.body);
    const stage = String(url).endsWith('/responses') ? 'planner' : String(url).endsWith('/moderations') ? (typeof body.input[0] === 'string' ? 'advisory' : 'exact') : 'image';
    assert.ok(['planner', 'advisory', 'exact', 'image'].includes(stage));
    calls.push({ arm, stage, endpoint: url, body: init.body, clientId: init.headers['X-Client-Request-Id'] ?? null });
    order.push(`fetch:${stage}`);
    if (arm === 'baseline' && stage === faultStage) {
      if (fault === 'uncertain') throw new TypeError('offline simulated network loss');
      if (fault === 'error') return Response.json({ error: { code: 'server_error' } }, { status: 503 });
      if (fault === 'invalid') return Response.json({});
      if (fault === 'refusal' && stage === 'planner') return Response.json({ id: 'mock-refusal', status: 'completed', model: env.OPENAI_MODEL, output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'refusal', refusal: 'Synthetic refusal fixture' }] }], usage });
      if (fault === 'refusal' && stage === 'image') return Response.json({ error: { code: 'moderation_blocked', message: 'Synthetic content policy fixture' } }, { status: 400 });
    }
    const headers = { 'x-request-id': `mock-${arm}-${stage}` };
    if (stage === 'advisory' || stage === 'exact') return Response.json({ id: `mock-${arm}-${stage}`, model: 'omni-moderation-latest', results: body.input.map(() => ({ flagged: arm === 'baseline' && stage === faultStage && fault === 'refusal', categories: {} })) }, { headers });
    if (stage === 'planner') return Response.json({ id: `mock-${arm}-planner`, model: env.OPENAI_MODEL, status: 'completed', output_text: JSON.stringify({ ...direction, ...(arm === 'treatment' ? { rationale: `${direction.rationale} ${demoInstruction}` } : {}) }), ...(fault === 'missing-usage' && stage === faultStage ? {} : { usage }) }, { headers });
    return Response.json({ data: [{ b64_json: pixels }], ...(fault === 'missing-usage' && stage === faultStage ? {} : { usage }) }, { headers });
  };
  try {
    for (arm of ['baseline', 'treatment']) {
      try {
        if (stop === 'before-advisory') throw Error('explicit_stop');
        const advisory = await moderateGenerationSnapshot(env, snapshot, undefined, { onEvidence, onCaptureError: () => { captureFailed = true; } });
        // Existing advisory capture is intentionally observational; this stricter comparison hold belongs to the missing seam.
        if (captureFailed) throw Error('comparison_advisory_capture_missing');
        if (advisory.flagged) throw Error('source_advisory_review_stop');
        if (stop === 'after-advisory') throw Error('explicit_stop');
        const d = mode === 'pipeline' ? (await generateCreativeDirection(env, owner, snapshot, undefined, 'en', paid, { onEvidence, ...(arm === 'treatment' ? { outputTargetInstructions: demoInstruction } : {}) })).output : candidate ? candidateDirection : direction;
        const base = buildCreativeImagePrompt(snapshot, d, [], 'prose', options);
        const prompt = candidate ? applyProfile(base, { enabled: arm === 'treatment' }) : base + (mode === 'renderer' && arm === 'treatment' ? `\n${demoInstruction}` : '');
        if (stop === 'before-image') throw Error('explicit_stop');
        const image = await generateCreativeImage(env, owner, snapshot, d, { ...options, preparedPrompt: prompt, onEvidence, onProviderSubmission: paid,
          onBeforeProviderDispatch: () => { if (stop === 'after-exact') throw Error('explicit_stop'); } });
        assert.equal(image.prompt, prompt);
        if (fault === 'settlement') throw Error('comparison_original_settlement_hold');
        outcomes.push({ arm, outcome: 'mock-completed-not-quality' });
      } catch (error) {
        outcomes.push({ arm, outcome: 'stopped', code: error.detail?.code ?? error.message });
        break;
      }
    }
  } finally { globalThis.fetch = original; }
  return { calls, evidence, finance, order, outcomes };
}

// Deliberately conflicting frozen test input, NOT an observed provider response.
// Requires review of this conflict as part of the mechanism pilot, independent of the brief.
const candidateDirection = { ...direction, scene: direction.scene + ' A thin tether attaches to the dog collar and trails left.', next_moves: ['Keep the tether legible', 'Preserve the gap'] };

test('I selected factor: exact unchanged profile on new supplied inputs; actual renderer invocation', async () => {
  const source = JSON.stringify(snapshot), frozenDirection = JSON.stringify(candidateDirection);
  const run = await exercise({ candidate: true });
  assert.ok(run.outcomes.every(o => o.outcome === 'mock-completed-not-quality'));
  assert.equal(run.calls.filter(c => c.stage === 'planner').length, 0);
  const image = run.calls.filter(c => c.stage === 'image').map(c => JSON.parse(c.body));
  const moderation = run.calls.filter(c => c.stage === 'exact').map(c => JSON.parse(c.body));
  assert.deepEqual(factorDiff(image[0], image[1]), ['prompt']);
  assert.equal(image[1].prompt, applyProfile(image[0].prompt, { enabled: true }));
  assert.equal(image[1].prompt.slice(PROFILE.treatment.length), image[0].prompt.slice(PROFILE.baseline.length));
  assert.equal(image[1].prompt.length - image[0].prompt.length, 311);
  assert.deepEqual(promptSections(image[0].prompt).context, promptSections(image[1].prompt).context);
  assert.deepEqual(promptSections(image[0].prompt).direction, candidateDirection);
  assert.deepEqual(promptSections(image[1].prompt).direction, candidateDirection);
  image.forEach((im, i) => { assert.equal(im.prompt, moderation[i].input[0].text); validateCoverage({ requirements }, im.prompt); });
  const candidateBytes = await readFile(new URL('../docs/evidence/generation-p1/i-candidate.json', import.meta.url));
  const candidate = JSON.parse(candidateBytes);
  assert.equal(candidate.id, PROFILE.id); assert.equal(candidate.exactDiff.remove, PROFILE.baseline); assert.equal(candidate.exactDiff.insert, PROFILE.treatment);
  const packet = seal('p1-pilot', {
    schemaVersion: 'p1-prospective-request-pilot-v1', ready: false, liveAuthorized: false,
    baseCommit: 'c28af5fea0fc3ec2b37b878a544ec59c52a64daf', selectedFactor: PROFILE.id,
    candidateManifestSha256: hash(candidateBytes), candidateProfileSha256: hash(await readFile(new URL('../docs/evidence/generation-p1/i-profile.mjs', import.meta.url))),
    input: suppliedInput(source, { expiresAt: '2026-10-01T00:00:00.000Z' }), suppliedSnapshot: snapshot,
    direction: { value: candidateDirection, sha256: hash(frozenDirection), origin: 'agent-proposed intentionally conflicting frozen study input; never a provider response', reviewed: false },
    mode: 'renderer-only; frozen supplied direction', humanReviewRequired: ['brief', 'intentional direction conflict', 'exact arms', 'factor/rubric', 'future authority, lifecycle and financial proposal'],
    claimsExcluded: ['N4 original response replay', 'historical cause', 'complete workspace authority', 'source-rights lineage', 'model quality improvement'],
    logicalCounts: { planner: 0, sourceAdvisory: 2, exactModeration: 2, images: 2, checker: 0, evaluator: 0, referenceModeration: 0, retrieval: 0 },
    transport: { maxAttemptsPerOperation: 1, maxTotalPOSTs: 6, concurrency: 1, automaticRetries: 0, ordering: 'baseline then treatment; disclosed order confound' },
    advisoryItemsPerArm: 2, maximumFinalImagesPerArm: 1, partialImages: 0,
    settings: config, arms: run.calls.map(c => ({ ...c, byteLength: Buffer.byteLength(c.body), sha256: hash(c.body), identityNote: 'mock capture identities; future operations require newly reserved identities' })),
    exactDiff: { offset: 0, remove: PROFILE.baseline, insert: PROFILE.treatment, fields: ['image.prompt', 'exactModeration.input[0].text'], netUTF8Bytes: 311 },
    budget: { currency: 'USD', authorizedMicrousd: 0, proposedAllowanceMicrousd: 3000000, maximumExposureMicrousd: null, providerEnforcedCap: false, historicalApprovalsReusable: false, perArmAllowanceMicrousd: 1500000, conditionalStressEstimateMicrousd: 1276845, inputTokenProxy: 'exact image request UTF-8 bytes plus 4096 per arm; unqualified', assumedOutputTokensPerArm: 20000, lifecycleFunded: false },
    actualOutcomes: { providerAcceptance: 'not measured', imageFidelity: 'not measured', accounting: 'no live operations', userAcceptance: 'unreviewed' },
    blockers: ['no qualified supplied-input admission/custody/finance binding', 'input/direction/factor unreviewed', 'live environment/account/configuration unverified', 'funded retention/settlement and separate paid authority absent'],
  });
  if (process.env.P1_WRITE_EVIDENCE === '1') await writeFile(new URL('../docs/evidence/generation-p1/pilot-packet.json', import.meta.url), JSON.stringify(packet, null, 2) + '\n');
});

test('P1 exact actual-adapter bytes, bounded contract and stops; no live capability', async t => {
  const bytes = JSON.stringify(snapshot);
  const manifest = suppliedInput(bytes, { expiresAt: '2026-10-01T00:00:00.000Z' });
  const at = Date.parse('2026-09-25T00:00:00Z');
  assert.deepEqual(validateSuppliedInput(manifest, bytes, { now: at }), { integrity: true, reviewed: false, executionAuthority: false });
  assert.equal(assessInvocation(manifest, bytes, { now: at }).ready, false);
  assert.throws(() => validateSuppliedInput(manifest, bytes + ' ', { now: at }), /changed/);
  assert.throws(() => validateSuppliedInput(manifest, bytes, { now: Date.parse(manifest.expiresAt) }), /unavailable/);
  assert.throws(() => validateSuppliedInput(manifest, bytes, { now: at, revoked: true }), /unavailable/);
  // Do not populate fabricated H4 provenance fields to pass this actual historical interface.
  assert.throws(() => capturePreparation({ source: { bytes }, config: {}, payerId: owner, runtimeHash: hash('offline') }), /preparation_source_provenance/);
  const disabled = createPreparationHost({}, { plan: {} });
  assert.deepEqual(await disabled.execute(new Request('https://offline.invalid')), { action: 'disabled', newPurchases: 0 });
  check('supplied-input integrity, expiry/revocation and unchanged historical refusal');
  const advisory = sourceAdvisoryInputs(snapshot);
  assert.equal(advisory.input.length, 2); assert.ok(advisory.mapping.every(v => !v.truncated));
  assert.ok(advisory.input[0].includes(brief));
  check('source advisory covers complete supplied snapshot plus one fact', { inputItems: 2 });

  const pairs = {};
  for (const mode of ['renderer', 'pipeline']) {
    const run = await exercise({ mode });
    assert.equal(run.outcomes.length, 2); assert.ok(run.outcomes.every(o => o.outcome === 'mock-completed-not-quality'));
    const expected = mode === 'pipeline' ? ['advisory', 'planner', 'exact', 'image'] : ['advisory', 'exact', 'image'];
    for (const arm of ['baseline', 'treatment']) assert.deepEqual(run.calls.filter(c => c.arm === arm).map(c => c.stage), expected);
    const images = run.calls.filter(c => c.stage === 'image'), exact = run.calls.filter(c => c.stage === 'exact');
    assert.deepEqual(factorDiff(JSON.parse(images[0].body), JSON.parse(images[1].body)), ['prompt']);
    for (let i = 0; i < 2; i++) {
      const image = JSON.parse(images[i].body), moderation = JSON.parse(exact[i].body);
      assert.equal(image.prompt, moderation.input[0].text);
      assert.deepEqual(Object.keys(image), ['model', 'prompt', 'n', 'size', 'quality', 'output_format', 'user']);
      assert.deepEqual(validateCoverage({ requirements }, image.prompt), { required: 5, covered: 5, method: 'literal anchors; human blinded semantic fidelity still required' });
      const wire = reviewedRequests({ id: `demo-${i}`, config: { ...config, prompt: image.prompt } }, safetyIdentifier(owner));
      assert.equal(wire.image.body, images[i].body); assert.equal(wire.moderation.body, exact[i].body);
      validateWire(wire.image, 'image', safetyIdentifier(owner));
      const captured = run.evidence.find(e => e.phase === 'request' && e.outcome.pipelineStage === 'media_submission' && e.requestBody === images[i].body);
      assert.equal(captured.operation.requestSha256, hash(images[i].body));
    }
    assert.notEqual(images[0].clientId, images[1].clientId);
    const plannerCalls = run.calls.filter(c => c.stage === 'planner');
    if (mode === 'pipeline') {
      assert.notEqual(plannerCalls[0].clientId, plannerCalls[1].clientId);
      for (let i = 0; i < 2; i++) assert.equal(plannerCalls[i].body, buildCreativeDirectionRequest(snapshot, env.OPENAI_MODEL, safetyIdentifier(owner), 'en', i ? demoInstruction : undefined).requestBody);
      assert.deepEqual(factorDiff(JSON.parse(plannerCalls[0].body), JSON.parse(plannerCalls[1].body)), ['input']);
      assert.deepEqual(factorDiff(JSON.parse(JSON.parse(plannerCalls[0].body).input), JSON.parse(JSON.parse(plannerCalls[1].body).input)), ['output_requirements']);
    }
    const receiptIds = run.evidence.filter(e => e.phase === 'request' && e.requestBody).map(e => e.evidenceId);
    assert.equal(new Set(receiptIds).size, receiptIds.length);
    pairs[mode] = { calls: run.calls, outcomes: run.outcomes, requests: run.calls.map(c => ({ arm: c.arm, stage: c.stage, bytes: Buffer.byteLength(c.body), sha256: hash(c.body) })), operationIdentitiesDistinct: true };
    check(`${mode}: actual invocation, exact wire hashes, non-treatment preservation, full moderation and distinct identities`, { logicalCounts: { planner: plannerCalls.length, image: images.length, moderation: exact.length + 2 }, attemptsPerOperation: 1 });
  }

  for (const [fault, stage] of [['refusal','advisory'],['refusal','exact'],['refusal','planner'],['refusal','image'],['error','planner'],['error','image'],['error','exact'],['invalid','exact'],['invalid','planner'],['uncertain','planner'],['uncertain','image'],['missing-usage','planner'],['missing-usage','image'],['custody','image'],['advisory-custody','advisory'],['settlement','image']]) {
    await t.test(`${fault} at ${stage} stops both arms`, async () => {
      const run = await exercise({ mode: 'pipeline', fault, faultStage: stage });
      assert.equal(run.outcomes.at(-1).outcome, 'stopped');
      assert.ok(run.calls.every(c => c.arm === 'baseline'));
      assert.equal(run.calls.filter(c => c.stage === stage).length, 1);
      if (['advisory', 'exact', 'planner'].includes(stage)) assert.equal(run.calls.filter(c => c.stage === 'image').length, 0);
      if (fault === 'uncertain') assert.ok(run.evidence.some(e => e.outcome.dispatchState === 'dispatch_unknown'));
      if (fault === 'custody') assert.ok(run.order.indexOf('finance:completed:image') < run.order.indexOf('evidence:response:media_result'));
      report.scenarios.push({ fault, stage, calls: run.calls.map(c => c.stage), outcomes: run.outcomes, liveCalls: 0 });
    });
  }
  for (const stop of ['before-advisory', 'after-advisory', 'before-image', 'after-exact']) {
    const run = await exercise({ mode: 'pipeline', stop });
    assert.ok(run.calls.every(c => c.arm === 'baseline')); assert.equal(run.calls.filter(c => c.stage === 'image').length, 0);
    report.scenarios.push({ stop, calls: run.calls.map(c => c.stage), outcomes: run.outcomes });
  }
  check('stop and failure composition is test-only; durable admission/settlement integration remains missing');

  // H wire transport accepts these frozen bytes; transport alone confers no authority.
  const wire = reviewedRequests({ id: 'demo', config: { ...config, prompt: JSON.parse(pairs.renderer.calls.find(c => c.stage === 'image').body).prompt } }, safetyIdentifier(owner));
  const original = globalThis.fetch; const seen = [];
  try {
    globalThis.fetch = async (url, init) => { seen.push(init); return Response.json({ results: [{ flagged: false, categories: {} }] }); };
    const r = await submitStudyStage(env, wire.moderation, 'moderation', { signal: new AbortController().signal, checkpoint: async () => {} });
    assert.equal(r.outcome, 'usable'); assert.equal(seen.length, 1); assert.equal(seen[0].body, wire.moderation.body); assert.equal(seen[0].redirect, 'error');
  } finally { globalThis.fetch = original; }
  check('H one-attempt transport preserves exact supported wire; no H authority claimed');

  const dir = await mkdtemp(join(tmpdir(), 'p1-private-test-'));
  try {
    await chmod(dir, 0o700); const file = join(dir, 'synthetic-evidence.json');
    await writeFile(file, bytes, { mode: 0o600 }); await chmod(file, 0o400);
    assert.equal((await stat(dir)).mode & 0o777, 0o700); assert.equal((await stat(file)).mode & 0o777, 0o400);
    assert.equal(hash(await readFile(file)), manifest.bytesSha256);
    let reads = 0;
    const read = async now => { validateSuppliedInput(manifest, bytes, { now }); reads++; return readFile(file); };
    await assert.rejects(read(Date.parse(manifest.expiresAt)), /unavailable/); assert.equal(reads, 0);
  } finally { await rm(dir, { recursive: true }); }
  check('synthetic private file permissions, hash, pre-read expiry denial and cleanup; no production retention proof');
  if (process.env.P1_WRITE_EVIDENCE === '1') {
    await writeFile(new URL('../docs/evidence/generation-p1/demo-envelopes.json', import.meta.url), JSON.stringify({ manifest, input: snapshot, authorship: 'agent proposed; unreviewed', demoInstruction, pairs }, null, 2) + '\n');
    await writeFile(new URL('../docs/evidence/generation-p1/interception.json', import.meta.url), JSON.stringify(seal('p1-interception', report), null, 2) + '\n');
  }
});

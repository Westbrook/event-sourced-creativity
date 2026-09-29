import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Only the canonical model's one existing extensionless value edge is mapped.
// Native Scene preparation is deliberately outside these pure/negative tests.
let nativeImports = 0, networkCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { networkCalls++; throw new Error('scene_test_network_forbidden'); };
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.endsWith('/src/model/project-intake.ts') && specifier === './block-types') return next('./block-types.ts', context);
  if (specifier.endsWith('/scene-cost-consent.ts') && context.parentURL?.endsWith('/worker/output-scene-preflight.ts')) {
    nativeImports++; throw new Error('native_scene_preparation_outside_test_scope');
  }
  return next(specifier, context);
} });
test.after(() => { hooks.deregister(); globalThis.fetch = originalFetch; assert.equal(nativeImports, 0); assert.equal(networkCalls, 0); });

const { outputScenePreparationIdentity, resolveOutputSceneSource } = await import('../worker/output-scene-source.ts');
const { createOutputSceneProviderInput, preflightOutputSceneTarget, outputScenePreflightProof } = await import('../worker/output-scene-preflight.ts');
const { scenePreflightFixture } = await import('./helpers/scene-output-fixture.mjs');
const { createOutputSceneRequestContract } = await import('../worker/output-scene-request.ts');
const { outputScenePreflightConfiguration } = await import('../worker/output-scene-preflight-contract.ts');
const { canonicalJson } = await import('../src/experiences/compiler.ts');

test('original Scene request identity is stable across rechecks and expiry never rolls forward', async () => {
  const { outputScene: { sceneContract } } = await scenePreflightFixture();
  const plan = { revisionId: 'original-plan', confirmedAt: '2026-09-13T04:00:00.000Z' };
  const first = await outputScenePreparationIdentity(sceneContract, plan, 'original-target');
  assert.match(first.requestId, /^scene-[a-f0-9]{64}$/u);
  assert.equal(first.expiresAt, '2026-09-13T04:15:00.000Z');
  assert.deepEqual(await outputScenePreparationIdentity(structuredClone(sceneContract), { ...plan }, 'original-target'), first);
  assert.notEqual((await outputScenePreparationIdentity(sceneContract, { ...plan, revisionId: 'another-plan' }, 'original-target')).requestId, first.requestId);
  assert.notEqual((await outputScenePreparationIdentity(sceneContract, plan, 'another-target')).requestId, first.requestId);
  assert.notEqual((await outputScenePreparationIdentity({ ...sceneContract, source: { ...sceneContract.source, draftId: 'experience-draft-' + 'd'.repeat(64) } }, plan, 'original-target')).requestId, first.requestId);
  assert.equal(await outputScenePreparationIdentity(sceneContract, { ...plan, confirmedAt: '2026-09-13T04:00:00Z' }, 'original-target'), null);
  assert.equal(await outputScenePreparationIdentity(sceneContract, { ...plan, confirmedAt: 'invalid' }, 'original-target'), null);
  assert.equal(await outputScenePreparationIdentity(sceneContract, plan, 'target/invalid'), null);
  assert.equal(await outputScenePreparationIdentity({ ...sceneContract, sceneCount: 2 }, plan, 'original-target'), null);
});

test('shared provider builder preserves authored Scene slots and compiles the effective snapshot without authority claims', async () => {
  const payload = await scenePreflightFixture(), { intake } = payload.outputScene;
  const snapshot = { document: { id: 'private-document', title: 'The “door”' }, facts: [
    { block_id: 'source-a', type: 'action', text: '  A closed door.\n\n', active: true },
    { block_id: 'not-active', type: 'action', text: 'Excluded', active: false },
    { block_id: 'output-id', type: 'output', text: 'Output is not factual source', active: true },
  ], relationships: [], standing_constraints: [{ axis: 'tempo', value: 'slow', authority: 'authored' }] };
  const before = structuredClone(snapshot), input = await createOutputSceneProviderInput(intake, snapshot, '  Scene direction  ');
  assert.equal(input.document_title, 'The “door”');
  assert.deepEqual(input.output_requirements, { instructions: 'Scene direction', source_evidence: false });
  assert.equal(input.scene_intent.characters.length, 2);
  assert.equal(input.scene_intent.characters[0].id, 'A'); assert.equal(input.scene_intent.characters[1].id, 'B');
  assert.equal(input.scene_intent.characters[0].name.value, input.scene_intent.characters[1].name.value);
  assert.equal(input.scene_configuration.medium, 'visual'); assert.equal(input.scene_configuration.source, 'manual');
  assert.equal(input.scene_configuration.alternate_rendering.preserve_authored_context, true);
  assert.equal(input.audience, 'general'); assert.equal(input.tone, 'derived from the document');
  assert.ok(!canonicalJson(input.creative_context).includes('Output is not factual source'));
  assert.ok(!canonicalJson(input.creative_context).includes('Excluded'));
  assert.deepEqual(snapshot, before); assert.ok(Object.isFrozen(input));
  const contract = await createOutputSceneRequestContract(intake, input, 30000);
  assert.ok(contract); assert.equal(contract.input, canonicalJson(input)); assert.equal(contract.maximumCalls, 1);
  for (const key of ['guard', 'sourceAssertions', 'binding', 'confirmed', 'jobId', 'grantId']) assert.equal(Object.hasOwn(input, key), false);
});

test('provider builder snapshots before awaiting and refuses missing title or unregistered intake', async () => {
  const { outputScene: { intake } } = await scenePreflightFixture();
  const snapshot = { document: { id: 'doc', title: 'Original' }, facts: [], relationships: [] };
  const pending = createOutputSceneProviderInput(intake, snapshot, ''); snapshot.document.title = 'Changed';
  assert.equal((await pending).document_title, 'Original');
  assert.equal(Object.hasOwn(await createOutputSceneProviderInput(intake, snapshot, ''), 'output_requirements'), false);
  assert.equal(await createOutputSceneProviderInput(intake, { facts: [] }, ''), null);
  assert.equal(await createOutputSceneProviderInput({ ...intake, releaseHash: 'sha256:' + 'f'.repeat(64) }, snapshot, ''), null);
  assert.equal(await createOutputSceneProviderInput(intake, snapshot, 'a'.repeat(65537)), null);
});

test('Scene contract and configured-route refusals do not touch DB or load native preparation', async () => {
  const { outputScene: { sceneContract } } = await scenePreflightFixture();
  let dbCalls = 0;
  const env = { DB: { prepare() { dbCalls++; throw new Error('db_forbidden'); } } };
  const target = { id: 'target', scene_contract: sceneContract, media_kind: 'document', selected: true, blocking_issues: [],
    quantity: { kind: 'exact', unit: 'document', value: 1 }, source_scope: { kind: 'document' }, coverage: { kind: 'document_context' },
    aspect_ratio: null, content_quantity: null, count_policy: null, variant_id: null, member_id: null };
  assert.equal((await preflightOutputSceneTarget({ target, env })).reasonCode, 'output_scene_provider_unavailable');
  assert.equal((await preflightOutputSceneTarget({ target, env: { ...env, OPENAI_API_KEY: 'inert-local-value', OPENAI_MODEL: 'unqualified-model' } })).available, false);
  for (const changed of [{ media_kind: 'video' }, { selected: false }, { quantity: { kind: 'exact', unit: 'document', value: 2 } },
    { source_scope: { kind: 'block' } }, { scene_contract: { ...sceneContract, characterCount: 3 } }]) {
    const result = await preflightOutputSceneTarget({ target: { ...target, ...changed }, env });
    assert.equal(result.reasonCode, 'output_scene_contract_unsupported'); assert.equal(outputScenePreflightProof(result), null);
  }
  assert.equal(dbCalls, 0);
});

test('the resolver rejects nonpersonal authority before any retained-data lookup', async () => {
  const { outputScene: { sceneContract } } = await scenePreflightFixture();
  let dbCalls = 0;
  // Negative input only. No successful auth/SQL/source proof is supplied or claimed.
  await assert.rejects(resolveOutputSceneSource({ target: { scene_contract: sceneContract },
    scope: { kind: 'project' }, principal: {}, env: { DB: { prepare() { dbCalls++; throw new Error('db_forbidden'); } } } }),
  error => error.code === 'output_scene_personal_source_required');
  assert.equal(dbCalls, 0);
});

test('serialized valid preflight settings cannot mint private source proof or approval', async () => {
  const payload = await scenePreflightFixture(), preflight = await outputScenePreflightConfiguration('target', payload, Date.parse('2026-09-13T04:00:00.000Z'));
  assert.ok(preflight); assert.equal(preflight.available, true);
  assert.equal(outputScenePreflightProof(preflight), null);
  assert.equal(outputScenePreflightProof(structuredClone(preflight)), null);
  assert.equal(Object.hasOwn(payload.outputScene.costPreview, 'confirmed'), false);
  assert.equal(Object.hasOwn(preflight.settings, 'sourceAssertions'), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { registeredExperience, initialValues } from '../src/experiences/intake.ts';
import { digest } from '../src/experiences/compiler.ts';
import { captureExperienceSceneIntent } from '../worker/experience-scene-intent.ts';

// Unadmitted in-memory intake only: no account, grant, provider, job or database.
const release = await registeredExperience('scene');
const request = () => ({ intentId: '00000000-0000-4000-8000-000000000091', experienceId: 'scene', releaseHash: release.releaseHash,
  values: { ...initialValues(release), ...Object.fromEntries(Object.entries({ characterA: '  ليلى  ', goalA: 'Keep the room open',
    characterB: '  ليلى  ', goalB: 'Close the room', location: 'The waiting room', secret: 'The door is already locked' })
    .map(([key, value]) => [key, { value, provenance: 'authored' }])) } });

test('Scene capture preserves distinct participants and all exact source decisions without turning defaults into authorship', async () => {
  const input = request(), intent = await captureExperienceSceneIntent(input);
  assert.equal(intent.qualification, 'intent-only');
  assert.deepEqual(intent.characters, [
    { id: 'A', name: input.values.characterA, goal: input.values.goalA },
    { id: 'B', name: input.values.characterB, goal: input.values.goalB },
  ]);
  for (const key of ['location', 'secret', 'knowledge', 'tension']) assert.deepEqual(intent[key], input.values[key]);
  assert.equal(intent.knowledge.provenance, 'default');
  assert.deepEqual(intent.output, { artifactKind: 'scene', productionMode: 'manual', medium: 'visual', sceneCount: 1,
    characterCount: 2, locationCount: 1, format: 'screenplay', content: ['action', 'dialogue'], pageRange: { min: 1, max: 2 }, paginationPolicy: null });
  assert.deepEqual(intent.source, { intentId: input.intentId, releaseHash: input.releaseHash, requestDigest: await digest(input) });
  input.values.characterA.value = 'Changed';
  assert.equal(intent.characters[0].name.value, '  ليلى  ');
  assert.throws(() => { intent.characters[0].name.value = 'Changed'; }, TypeError);
  assert.throws(() => { intent.output.pageRange.max = 20; }, TypeError);
});

test('Scene request identity changes with each decision and provenance, without inferring new source authority', async () => {
  const original = request(), before = await captureExperienceSceneIntent(original);
  for (const key of Object.keys(original.values)) {
    const input = request(); input.values[key] = { value: key === 'knowledge' ? 'both' : key === 'tension' ? 'explosive' : original.values[key].value + ' revised', provenance: 'authored' };
    const result = await captureExperienceSceneIntent(input);
    assert.ok(result, key); assert.notEqual(result.source.requestDigest, before.source.requestDigest, key);
  }
  const adoptedDefault = request(); adoptedDefault.values.knowledge.provenance = 'authored';
  assert.notEqual((await captureExperienceSceneIntent(adoptedDefault)).source.requestDigest, before.source.requestDigest);
  assert.deepEqual(await captureExperienceSceneIntent(original), before);
});

test('Scene capture refuses foreign or stale intake, executable fields and hostile objects before reading them', async () => {
  const story = await registeredExperience('short-story');
  for (const mutate of [input => { input.experienceId = 'short-story'; input.releaseHash = story.releaseHash; },
    input => { input.releaseHash = 'sha256:' + '0'.repeat(64); }, input => { input.grant = {}; },
    input => { input.values.location.provenance = 'default'; }, input => { input.values.knowledge.value = 'everyone'; }]) {
    const input = request(); mutate(input); assert.equal(await captureExperienceSceneIntent(input), null);
  }
  let getterCalled = false; const input = request();
  Object.defineProperty(input.values.characterA, 'value', { enumerable: true, get() { getterCalled = true; return 'Intruder'; } });
  assert.equal(await captureExperienceSceneIntent(input), null); assert.equal(getterCalled, false);
  assert.equal(await captureExperienceSceneIntent(null), null);
});

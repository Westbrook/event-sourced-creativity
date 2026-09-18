import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { registeredExperience, initialValues } from '../src/experiences/intake.ts';
import { createSceneConfiguration } from '../src/model/scene-configuration.ts';
import { sceneScreenplayText } from '../src/model/scene-screenplay.ts';
import { EXPERIENCE_SCENE_RESPONSE_SCHEMA, createExperienceSceneAdapterRequest, projectExperienceSceneAdapterResponse } from '../worker/experience-scene-adapter-contract.ts';

// Synthetic in-memory content. No provider request, native job or authority chain.
const release = await registeredExperience('scene');
const intake = () => ({ intentId: '00000000-0000-4000-8000-000000000092', experienceId: 'scene', releaseHash: release.releaseHash,
  values: { ...initialValues(release), ...Object.fromEntries(Object.entries({ characterA: 'ليلى', goalA: 'Keep the door locked',
    characterB: 'ليلى', goalB: 'Open the door', location: 'The waiting room', secret: 'The key is outside', knowledge: 'b', tension: 'explosive' })
    .map(([key, value]) => [key, { value, provenance: 'authored' }])) } });
const response = () => ({ title: 'The key', summary: 'A closed door divides two intentions.', screenplay: { schemaVersion: 1, format: 'forma-screenplay@1',
  heading: { setting: 'INT.', location: 'location', time: 'NIGHT' }, blocks: [
    { kind: 'action', text: 'A fist stops an inch from the handle.' },
    { kind: 'dialogue', speaker: 'A', parenthetical: null, text: ' Leave it.\nPlease. ' },
    { kind: 'dialogue', speaker: 'B', parenthetical: 'still', text: 'I have to open it.' },
  ] } });
const hash = value => createHash('sha256').update(value).digest('hex');

test('Scene request binds all eight decisions to manual visual settings without disclosing durable source identifiers', async () => {
  const source = intake(), request = await createExperienceSceneAdapterRequest(source), input = JSON.parse(request.input);
  assert.equal(request.qualification, 'request-only'); assert.equal(request.kind, 'scene');
  assert.deepEqual(request.options, { productionMode: 'manual', itemCount: 1, sceneConfiguration: createSceneConfiguration('visual') });
  assert.deepEqual(input.characters.map(c => [c.id, c.name, c.goal]), [
    ['A', source.values.characterA, source.values.goalA], ['B', source.values.characterB, source.values.goalB],
  ]);
  for (const key of ['location', 'secret', 'knowledge', 'tension']) assert.deepEqual(input[key], source.values[key]);
  for (const identifier of [source.intentId, source.releaseHash, request.source.requestDigest]) assert.ok(!request.input.includes(identifier));
  assert.equal(input.output.paginationPolicy, null); assert.equal(request.responseSchema, EXPERIENCE_SCENE_RESPONSE_SCHEMA);
  assert.equal(request.responseSchema.additionalProperties, false);
  assert.deepEqual(request.responseSchema.required, ['title', 'summary', 'screenplay']);
  assert.throws(() => { request.responseSchema.properties.screenplay.properties.blocks.maxItems = 10000; }, TypeError);
});

test('Scene projection matches its original request and preserves complete structured and literal body hashes', async () => {
  const source = intake(), request = await createExperienceSceneAdapterRequest(source), raw = JSON.stringify(response(), null, 2);
  const projected = await projectExperienceSceneAdapterResponse(source, request.requestDigest, raw);
  const body = sceneScreenplayText(response().screenplay, { characters: [{ id: 'A', name: 'ليلى' }, { id: 'B', name: 'ليلى' }], location: 'The waiting room' });
  assert.equal(projected.qualification, 'projection-only'); assert.equal(projected.responseSha256, hash(raw));
  assert.equal(projected.bodySha256, hash(body)); assert.equal(projected.requestDigest, request.requestDigest);
  assert.equal(projected.sourceRequestDigest, request.source.requestDigest); assert.deepEqual(projected.screenplay, response().screenplay);
  assert.deepEqual(projected.artifact, { title: response().title, summary: response().summary, content_markdown: body, presentation: null,
    items: [{ title: response().title, body, notes: '', image_prompt: '', context_group_ids: [], slide: null }] });
  assert.deepEqual(projected.layout, { status: 'unqualified', policy: null, pageCount: null, authoredPageRange: { min: 1, max: 2 } });
  assert.throws(() => { projected.artifact.items[0].body = 'Shortened'; }, TypeError);
});

test('Scene response cannot cross request revisions or manufacture page counts, source assignments or native artifact fields', async () => {
  const source = intake(), request = await createExperienceSceneAdapterRequest(source), changed = intake(); changed.values.secret.value = 'The key is gone';
  assert.notEqual((await createExperienceSceneAdapterRequest(changed)).requestDigest, request.requestDigest);
  assert.equal(await projectExperienceSceneAdapterResponse(changed, request.requestDigest, JSON.stringify(response())), null);
  for (const mutate of [r => { r.pageCount = 1; }, r => { r.content_markdown = 'Substitute'; }, r => { r.items = []; },
    r => { r.screenplay.blocks[1].speaker = 'Other'; }, r => { r.screenplay.heading.location = 'new-place'; }, r => { r.screenplay.blocks[0].context_group_ids = ['private']; }]) {
    const raw = response(); mutate(raw); assert.equal(await projectExperienceSceneAdapterResponse(source, request.requestDigest, JSON.stringify(raw)), null);
  }
});

test('Scene response refuses malformed, oversize or non-content envelopes without repair, fallback or an invented completed result', async () => {
  const source = intake(), request = await createExperienceSceneAdapterRequest(source);
  for (const raw of ['{', 'null', '[]', '界'.repeat(50000), JSON.stringify({ status: 'completed', output_text: JSON.stringify(response()) }),
    JSON.stringify({ refusal: 'No' }), JSON.stringify({ ...response(), title: '' }), JSON.stringify({ ...response(), summary: 'bad\u202etext' })]) {
    assert.equal(await projectExperienceSceneAdapterResponse(source, request.requestDigest, raw), null);
  }
  assert.equal(await projectExperienceSceneAdapterResponse(source, 'wrong', JSON.stringify(response())), null);
  const forged = intake(); forged.run = true; assert.equal(await createExperienceSceneAdapterRequest(forged), null);
});

test('Scene projection snapshots intake before awaiting and is stable when the caller mutates its source afterward', async () => {
  const source = intake(), request = await createExperienceSceneAdapterRequest(source);
  const pending = projectExperienceSceneAdapterResponse(source, request.requestDigest, JSON.stringify(response()));
  source.values.characterA.value = 'Replacement'; source.values.knowledge.value = 'both';
  const projected = await pending;
  assert.ok(projected); assert.ok(projected.artifact.content_markdown.includes('A · ليلى'));
  assert.ok(!projected.artifact.content_markdown.includes('Replacement'));
});

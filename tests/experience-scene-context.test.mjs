import test from 'node:test';
import assert from 'node:assert/strict';
import { registeredExperience, initialValues, intakeValueIssues, validateIntakeRequest, buildExperiencePlan, parseExperienceEntryRoute, isExperienceContextOutput } from '../src/experiences/intake.ts';
import { compileExperience } from '../src/experiences/compiler.ts';
import { contextCatalog } from '../src/experiences/catalog.ts';
import { sceneCharacterLabel, sceneKnowledgeLabel } from '../src/experiences/scene-context.ts';
import { experienceOutputSettings } from '../src/experiences/native-host.ts';
import { experienceNavigationAdapter } from '../src/experiences/navigation-adapter.ts';
import { experienceHostRoute, parseExperienceHostRoute, isStandaloneExperienceRoute } from '../src/experiences/host-route.ts';
import { resolveServerRoute } from '../src/platform/applications.ts';

const release = await registeredExperience('scene');
const values = () => ({ ...initialValues(release), ...Object.fromEntries(Object.entries({
  characterA: 'Alex', goalA: 'Keep the station open', characterB: 'Alex', goalB: 'Leave before dawn',
  secret: 'The last train has been cancelled', knowledge: 'a', location: 'The waiting room', tension: 'restrained',
}).map(([key, value]) => [key, { value, provenance: 'authored' }])) });
const request = () => ({ intentId: '00000000-0000-4000-8000-000000000081', experienceId: 'scene', releaseHash: release.releaseHash, values: values() });
const blocks = plan => plan.events.filter(event => event.type === 'BlockCreated');
const props = (plan, id) => blocks(plan).find(event => event.payload.properties.experience_binding === id).payload.properties;

test('Scene compiles without changing existing releases or introducing executable capabilities', async () => {
  for (const [id, hash] of Object.entries({ image: '72c2627350f6928135d3f0dcb0d1d118bb391a8820b943364103eb485607d16f', slides: '9c7847a372e3ec9f98ae8d870e030e940ebf55f465e4dfa6d0d97769d909432c', 'short-story': '8fa5bde0564550eb8f3d1f1dc25637c778d2fa47e04b90947a2a9bbcfe2d1021' })) {
    assert.equal((await registeredExperience(id)).releaseHash, 'sha256:' + hash);
  }
  assert.equal(release.qualification, 'context-authoring');
  assert.equal(release.output.result, '1 scene · 2 characters · 1 location');
  assert.equal(release.output.essentialInteractionRef, 'scene-knowledge@1');
  for (const definition of [
    { ...release.definition, provider: 'new-provider' },
    { ...release.definition, decisions: release.definition.decisions.filter(item => item.id !== 'knowledge') },
    { ...release.definition, viewerRef: 'scene.editor@1' },
  ]) assert.equal((await compileExperience(definition, contextCatalog)).ok, false);
});

test('Scene validates both names, opposing goals, an authored secret and one location', async () => {
  assert.deepEqual(intakeValueIssues(release, initialValues(release)).map(issue => issue.path), ['characterA', 'goalA', 'characterB', 'goalB', 'secret', 'location']);
  assert.deepEqual(intakeValueIssues(release, values()), []);
  for (const [id, invalid] of [['knowledge', 'neither'], ['knowledge', 'left'], ['tension', 'random'], ['characterA', 'x'.repeat(81)], ['secret', ' '], ['location', ['room', 'street']]]) {
    const input = request(); input.values[id].value = invalid;
    assert.equal(await validateIntakeRequest(input), null, id);
  }
  const forged = request(); forged.values.secret.provenance = 'default';
  assert.equal(await validateIntakeRequest(forged), null);
});

test('Scene preserves participant-specific goals, secret ownership and screenplay format in typed contexts', async () => {
  const input = request(), plan = await buildExperiencePlan('scene-user', input, release);
  assert.deepEqual(plan, await buildExperiencePlan('scene-user', input, release));
  assert.deepEqual(blocks(plan).map(event => event.payload.type), ['subject', 'direction', 'subject', 'direction', 'message', 'message', 'environment', 'emotion', 'format']);
  assert.equal(props(plan, 'characterA').text, 'Character A: Alex');
  assert.equal(props(plan, 'characterB').text, 'Character B: Alex');
  assert.equal(props(plan, 'goalA').text, 'Character A · Alex\nGoal: Keep the station open');
  assert.equal(props(plan, 'goalB').text, 'Character B · Alex\nGoal: Leave before dawn');
  assert.equal(props(plan, 'knowledge').text, 'Secret knowledge: A · Alex');
  assert.equal(props(plan, 'secret').text, 'Secret: The last train has been cancelled');
  assert.equal(props(plan, 'secret').subtype, 'Subtext');
  assert.equal(blocks(plan).at(-1).payload.properties.text, '1 scene · 2 characters · 1 location\nScreenplay · Action and dialogue\n1–2 pages');
  for (const [id, entry] of Object.entries(input.values)) {
    assert.deepEqual(props(plan, id).experience_value, entry.value);
    assert.equal(props(plan, id).authority, 'authored');
  }
});

test('knowledge changes only its scoped block; stable A/B labels distinguish equal, renamed and RTL names', async () => {
  const input = request(), before = await buildExperiencePlan('scene-user', input, release);
  assert.equal(sceneKnowledgeLabel(input.values, 'a'), 'A · Alex');
  assert.equal(sceneKnowledgeLabel(input.values, 'b'), 'B · Alex');
  assert.equal(sceneKnowledgeLabel(input.values, 'both'), 'Both · A · Alex / B · Alex');
  for (const selection of ['b', 'both']) {
    input.values.knowledge.value = selection;
    const after = await buildExperiencePlan('scene-user', input, release);
    assert.equal(after.documentId, before.documentId); assert.notEqual(after.draftHash, before.draftHash);
    for (const event of before.events.filter(event => event.payload.properties?.experience_binding !== 'knowledge')) {
      assert.deepEqual(after.events.find(row => row.payload.client_event_id === event.payload.client_event_id), event);
    }
    assert.equal(props(after, 'knowledge').text, 'Secret knowledge: ' + sceneKnowledgeLabel(input.values, selection));
  }
  input.values.characterA.value = 'ليلى';
  assert.equal(sceneCharacterLabel(input.values, 'A'), 'A · ليلى');
  input.values.characterB.value = '';
  assert.equal(sceneCharacterLabel(input.values, 'B'), 'B');
  assert.throws(() => sceneKnowledgeLabel(input.values, 'unregistered'), /knowledge_invalid/);
});

test('Scene routes select the same-Document host without granting native admission', () => {
  const draft = 'experience-draft-' + 'a'.repeat(64), path = '/experiences/scene?draft=' + draft + '&progress-report';
  assert.deepEqual(parseExperienceEntryRoute(new URL(path, 'https://forma.test')), { output: 'scene', draftId: draft });
  assert.equal(isStandaloneExperienceRoute(path), true);
  assert.deepEqual(resolveServerRoute(path), { application: 'creative', entryPath: '/experiences', canonicalFamily: '/experiences/scene' });
  assert.equal(isExperienceContextOutput('scene'), true);
  for (const suffix of ['?draft=bad', '?draft=' + draft + '&draft=' + draft, '?experience=scene', '#fragment']) assert.equal(parseExperienceEntryRoute(new URL('/experiences/scene' + suffix, 'https://forma.test')), null);
  const selected = parseExperienceHostRoute('/document/scene/scene?experience=scene&experience-draft=' + draft);
  assert.deepEqual(selected, {output: 'scene', draftId: draft, documentId: 'scene', documentRoute: '/document/scene/scene'});
  assert.equal(experienceHostRoute(selected.documentRoute, 'scene', draft), '/document/scene/scene?experience=scene&experience-draft=' + draft);
});

test('Scene Continue carries exact retained intake to the host without issuing an admission command', async () => {
  const plan = await buildExperiencePlan('scene-user', request(), release);
  assert.deepEqual(experienceOutputSettings(plan), {output: 'scene', kind: 'render_document', productionMode: 'manual', artifactKind: 'scene', sceneMedium: 'visual', itemCount: 1});
  const nodes = [], target = {ownerDocument: {createElement(tag) {assert.equal(tag, 'a'); return {};}},
    replaceChildren(...next) {nodes.splice(0, nodes.length, ...next);}};
  const signal = new AbortController();
  const session = await experienceNavigationAdapter('/experiences/scene?progress-report').mount(target,
    {plan, receipt: {documentRoute: '/document/' + plan.documentId}}, signal.signal);
  assert.equal(nodes.length, 1); assert.equal(nodes[0].textContent, 'Continue');
  const selected = parseExperienceHostRoute(nodes[0].href);
  assert.equal(selected.output, 'scene'); assert.equal(selected.draftId, plan.draftId); assert.equal(selected.documentId, plan.documentId);
  assert.match(selected.documentRoute, /progress-report/);
  signal.abort(); assert.equal(nodes.length, 0); session.dispose();
});

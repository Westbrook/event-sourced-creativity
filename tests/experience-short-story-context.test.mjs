import test from 'node:test';
import assert from 'node:assert/strict';
import { registeredExperience, initialValues, intakeValueIssues, validateIntakeRequest, buildExperiencePlan, parseExperienceEntryRoute, isExperienceContextOutput } from '../src/experiences/intake.ts';
import { compileExperience } from '../src/experiences/compiler.ts';
import { contextCatalog } from '../src/experiences/catalog.ts';
import { experienceOutputSettings } from '../src/experiences/native-host.ts';
import { experienceNavigationAdapter } from '../src/experiences/navigation-adapter.ts';
import { experienceHostRoute, parseExperienceHostRoute, isStandaloneExperienceRoute } from '../src/experiences/host-route.ts';
import { resolveServerRoute } from '../src/platform/applications.ts';
import { experienceOutputBinding } from '../worker/experience-output-binding.ts';

const release = await registeredExperience('short-story');
const values = () => ({ ...initialValues(release), ...Object.fromEntries(Object.entries({
  character: 'A lighthouse keeper', goal: 'Bring a lost boat home', obstacle: 'The light has failed', decision: 'Light the old signal fire', ending: 'bittersweet',
}).map(([key, value]) => [key, { value, provenance: 'authored' }])) });
const request = () => ({ intentId: '00000000-0000-4000-8000-000000000071', experienceId: 'short-story', releaseHash: release.releaseHash, values: values() });

test('Short story adds authoring without changing accepted Image or Slides releases', async () => {
  assert.equal((await registeredExperience('image')).releaseHash, 'sha256:72c2627350f6928135d3f0dcb0d1d118bb391a8820b943364103eb485607d16f');
  assert.equal((await registeredExperience('slides')).releaseHash, 'sha256:9c7847a372e3ec9f98ae8d870e030e940ebf55f465e4dfa6d0d97769d909432c');
  assert.equal(release.output.output, 'short_story');
  assert.equal(release.output.result, '1 story · 600–800 words');
  assert.equal(release.qualification, 'context-authoring');
  assert.equal(release.output.essentialInteractionRef, 'story-ending@1');
  assert.ok(Object.isFrozen(release));
});

test('authoring and explicit native Story route selectors agree', () => {
  const draft = 'experience-draft-' + 'a'.repeat(64);
  const path = '/experiences/short-story?draft=' + draft + '&progress-report';
  assert.deepEqual(parseExperienceEntryRoute(new URL(path, 'https://forma.test')), { output: 'short-story', draftId: draft });
  assert.equal(isStandaloneExperienceRoute(path), true);
  assert.deepEqual(resolveServerRoute(path), { application: 'creative', entryPath: '/experiences', canonicalFamily: '/experiences/short-story' });
  for (const suffix of ['?draft=bad', '?draft=' + draft + '&draft=' + draft, '?experience=short-story', '#fragment']) {
    assert.equal(parseExperienceEntryRoute(new URL('/experiences/short-story' + suffix, 'https://forma.test')), null);
  }
  assert.equal(parseExperienceHostRoute('/document/story/story?experience=short-story&experience-draft=' + draft), null);
  assert.equal(parseExperienceHostRoute(experienceHostRoute('/document/story/story', 'short_story', draft)).output, 'short_story');
  assert.equal(isExperienceContextOutput('short_story'), true);
  assert.equal(isExperienceContextOutput('scene'), true);
});

test('story decisions validate independently; optional detail has no forced input', async () => {
  assert.deepEqual(intakeValueIssues(release, initialValues(release)).map(issue => issue.path), ['character', 'goal', 'obstacle', 'decision']);
  assert.deepEqual(intakeValueIssues(release, values()), []);
  const changed = values(); changed.ending.value = 'invented-choice';
  assert.deepEqual(intakeValueIssues(release, changed), [{ code: 'choice_unavailable', path: 'ending' }]);
  changed.ending.value = 'hopeful'; changed.detail.value = 'x'.repeat(601); changed.detail.provenance = 'authored';
  assert.deepEqual(intakeValueIssues(release, changed), [{ code: 'text_limit', path: 'detail' }]);
  const forged = request(); forged.values.goal.provenance = 'default';
  assert.equal(await validateIntakeRequest(forged), null);
});

test('canonical story plan keeps stable typed context and a fictional word-count promise', async () => {
  const input = request(); assert.ok(await validateIntakeRequest(input));
  const plan = await buildExperiencePlan('story-test-user', input, release);
  assert.deepEqual(plan, await buildExperiencePlan('story-test-user', input, release));
  const blocks = plan.events.filter(event => event.type === 'BlockCreated');
  assert.deepEqual(blocks.slice(0, -1).map(event => event.payload.type), ['subject', 'direction', 'message', 'action', 'emotion']);
  for (const event of blocks.slice(0, -1)) {
    const p = event.payload.properties, entry = input.values[p.experience_binding];
    assert.equal(p.experience_value, entry.value); assert.equal(p.authority, entry.provenance);
  }
  assert.equal(blocks.at(-1).payload.properties.text, '1 story · 600–800 words\nFiction');
  assert.equal(new Set(plan.events.map(event => event.payload.client_event_id)).size, plan.events.length);
  assert.equal(blocks.some(event => event.payload.properties.experience_binding === 'detail'), false);
  const withDetail = request(); withDetail.values.detail = { value: 'A red scarf', provenance: 'authored' };
  const next = await buildExperiencePlan('story-test-user', withDetail, release);
  assert.equal(next.documentId, plan.documentId);
  assert.equal(next.events.find(event => event.payload.properties?.experience_binding === 'detail').payload.properties.experience_value, 'A red scarf');
});

test('ending changes preserve the other authored decisions and their stable block identities', async () => {
  const input = request(), before = await buildExperiencePlan('story-test-user', input, release);
  input.values.ending.value = 'unresolved';
  const after = await buildExperiencePlan('story-test-user', input, release);
  assert.notEqual(before.draftHash, after.draftHash);
  assert.equal(before.documentId, after.documentId);
  for (const event of before.events.filter(event => event.payload.properties?.experience_binding !== 'ending')) {
    assert.deepEqual(after.events.find(row => row.payload.client_event_id === event.payload.client_event_id), event);
  }
});

test('story definitions cannot omit their essential interaction or add executable capabilities', async () => {
  const missing = structuredClone(release.definition); missing.decisions = missing.decisions.filter(item => item.id !== 'ending');
  assert.equal((await compileExperience(missing, contextCatalog)).ok, false);
  assert.equal((await compileExperience({ ...release.definition, provider: 'openai' }, contextCatalog)).ok, false);
});

test('Story context selects only its explicit native settings and passive Continue link', async () => {
  const plan = await buildExperiencePlan('story-test-user', request(), release);
  assert.deepEqual(experienceOutputSettings(plan), { output: 'short_story', kind: 'render_document', productionMode: 'manual', artifactKind: 'short_story', itemCount: 3 });
  assert.equal((await experienceOutputBinding(plan)).output, 'short_story');
  const nodes = [], target = { ownerDocument: { createElement: tag => ({ tag }) }, replaceChildren(...children) { nodes.splice(0, nodes.length, ...children); } };
  const session = await experienceNavigationAdapter('/experiences/short-story').mount(target, { plan, receipt: { documentRoute: '/document/' + plan.documentId } }, new AbortController().signal);
  assert.equal(nodes[0].tag, 'a'); assert.equal(nodes[0].textContent, 'Continue');
  assert.equal(parseExperienceHostRoute(nodes[0].href).documentId, plan.documentId);
  session.dispose(); assert.deepEqual(nodes, []);
});

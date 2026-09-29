import test from 'node:test';
import assert from 'node:assert/strict';
import { readExperienceImageRatio, experienceImageFormat, EXPERIENCE_IMAGE_RATIOS } from '../src/experiences/image-ratio.ts';
import { registeredExperience, initialValues, intakeValueIssues, validateIntakeRequest, buildExperiencePlan } from '../src/experiences/intake.ts';
import { compileExperience, canonicalJson } from '../src/experiences/compiler.ts';
import { contextCatalog, definitions } from '../src/experiences/catalog.ts';
import { ExperienceIntakeRuntime } from '../src/experiences/intake-runtime.ts';

const image = () => registeredExperience('image');
const authoredValues = release => ({ ...initialValues(release), subject: { value: 'Copper lamp', provenance: 'authored' }, ratio: { value: { width: 16, height: 9 }, provenance: 'authored' } });
const makeRequest = (release, values = authoredValues(release)) => ({ intentId: crypto.randomUUID(), experienceId: 'image', releaseHash: release.releaseHash, values });

// Transcribed, independently exercised exact geometry algorithm from the pinned
// native outputExactImageRender (lines56–65). No provider module is imported.
function pinnedNativeDimensions(ratio) {
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  const divisor = gcd(ratio.width, ratio.height), w = ratio.width / divisor, h = ratio.height / divisor;
  const a = 16 / gcd(w, 16), b = 16 / gcd(h, 16), step = a * b / gcd(a, b);
  const bw = w * step, bh = h * step, multiplier = Math.max(1, Math.ceil(Math.max(1024 / Math.min(bw, bh), Math.sqrt(655360 / (bw * bh)))));
  return { width: bw * multiplier, height: bh * multiplier };
}

test('all offered ratios match pinned exact native geometry and bounded validation', () => {
  for (const choice of EXPERIENCE_IMAGE_RATIOS) {
    const dimensions = pinnedNativeDimensions(choice), pixels = dimensions.width * dimensions.height;
    assert.deepEqual(choice.dimensions, dimensions);
    assert.equal(dimensions.width % 16, 0); assert.equal(dimensions.height % 16, 0);
    assert.ok(pixels >= 655360 && pixels <= 8294400); assert.ok(Math.max(dimensions.width, dimensions.height) <= 3840);
    assert.ok(Math.max(dimensions.width, dimensions.height) / Math.min(dimensions.width, dimensions.height) <= 3);
    assert.equal(dimensions.width * choice.height, dimensions.height * choice.width);
  }
});

test('ratio reads reject missing, string, equivalent-unregistered and accessor values without fallback', () => {
  for (const value of [undefined, null, '', '16:9', {}, [], { width: 32, height: 18 }, { width: 0, height: 1 }, { width: 16, height: 9, crop: true }, { width: '16', height: 9 }]) { assert.equal(readExperienceImageRatio(value), null); assert.equal(experienceImageFormat(value), null); }
  let invoked = false; const value = { height: 9 }; Object.defineProperty(value, 'width', { enumerable: true, get() { invoked = true; return 16; } });
  assert.equal(readExperienceImageRatio(value), null); assert.equal(invoked, false);
});

test('no initial ratio and no request before an explicit authored selection', async () => {
  const release = await image(), values = initialValues(release);
  assert.deepEqual(values.ratio, { value: '', provenance: 'default' });
  let requests = 0;
  const runtime = new ExperienceIntakeRuntime(release, async () => { requests++; throw new Error('must_not_send'); });
  runtime.change('subject', 'Lamp'); await runtime.prepare();
  assert.equal(requests, 0); assert.equal(runtime.state.phase, 'setup'); assert.ok(runtime.state.issues.some(issue => issue.path === 'ratio' && issue.code === 'required'));
  runtime.dispose();
});

test('authored ratio survives canonical context and native image format without default substitution', async () => {
  const release = await image();
  for (const selected of EXPERIENCE_IMAGE_RATIOS) {
    const values = authoredValues(release); values.ratio.value = { width: selected.width, height: selected.height };
    const request = makeRequest(release, values); assert.ok(await validateIntakeRequest(request));
    const plan = await buildExperiencePlan('ratio-test-owner', request, release);
    const event = plan.events.find(event => event.payload.properties?.experience_binding === 'ratio');
    assert.equal(event.payload.type, 'format'); assert.equal(event.payload.properties.experience_origin, 'authored'); assert.equal(event.payload.properties.authority, 'authored');
    assert.deepEqual(event.payload.properties.experience_value, values.ratio.value);
    assert.deepEqual(event.payload.properties.image_format, { schema_version: 1, aspect_ratio: values.ratio.value, dimensions: { ...selected.dimensions, unit: 'px' } });
    assert.ok(event.payload.position < plan.events.at(-1).payload.position); // Canonical format selection sees the explicit ratio first.
  }
});

test('selected ratio cannot be relabeled as default and extra reference input cannot disappear', async () => {
  const release = await image(), values = authoredValues(release);
  values.ratio.provenance = 'default'; assert.ok(intakeValueIssues(release, values).some(issue => issue.path === 'ratio'));
  assert.equal(await validateIntakeRequest(makeRequest(release, values)), null);
  values.ratio.provenance = 'authored'; values.reference = { value: 'owned-image', provenance: 'authored' };
  assert.equal(await validateIntakeRequest(makeRequest(release, values)), null);
});

test('ratio and binding changes receive new exact immutable release identities', async () => {
  const release = await image(), slides = await registeredExperience('slides');
  assert.equal(release.definition.revision, 2); assert.equal(release.output.id, 'image.single@2'); assert.equal(release.output.bindingPackRef, 'image.direction@2');
  assert.equal(release.definitionHash, 'sha256:fa586999b2f7f311b6da26f81d831a7ef36da31fd579466b261c77e612614fc8');
  assert.equal(release.releaseHash, 'sha256:72c2627350f6928135d3f0dcb0d1d118bb391a8820b943364103eb485607d16f');
  assert.equal(slides.definition.revision, 1); assert.equal(slides.output.result, '5 slides');
  assert.equal(slides.definitionHash, 'sha256:545ae81a4e2e9315c912be873bd4d16394280f6684c741335aabb44fda69d740');
  assert.equal(slides.releaseHash, 'sha256:9c7847a372e3ec9f98ae8d870e030e940ebf55f465e4dfa6d0d97769d909432c');
  const request = makeRequest(release); request.releaseHash = 'sha256:f43f5f52826b8c60537cb7c02befd07cf3ff10399528b8142f12c2da8d22cf35';
  assert.equal(await validateIntakeRequest(request), null);
});

test('altered ratio metadata or omitted required binding fails compilation', async () => {
  const catalog = structuredClone(contextCatalog); catalog.interactions['image-ratio@1'].ratios[0].dimensions.width = 1000;
  assert.equal((await compileExperience(definitions[0], catalog)).ok, false);
  const missing = structuredClone(definitions[0]); missing.decisions = missing.decisions.filter(decision => decision.id !== 'ratio');
  assert.equal((await compileExperience(missing, contextCatalog)).ok, false);
});

test('editing ratio creates new immutable intake content and retains exact authored choices', async () => {
  const release = await image(), requests = [];
  const runtime = new ExperienceIntakeRuntime(release, async (url, init) => {
    const request = JSON.parse(init.body); requests.push(request);
    const plan = await buildExperiencePlan('ratio-test-owner', request, release);
    return new Response(JSON.stringify({ status: 'prepared', plan }), { headers: { 'content-type': 'application/json' } });
  });
  runtime.change('subject', 'Lamp'); runtime.change('ratio', { width: 4, height: 5 }); await runtime.prepare();
  assert.equal(runtime.state.phase, 'review'); const originalIntent = runtime.intentId;
  runtime.back(); runtime.change('ratio', { width: 9, height: 16 }); await runtime.prepare();
  assert.notEqual(runtime.intentId, originalIntent); assert.equal(requests.length, 2);
  assert.notEqual(canonicalJson(requests[0]), canonicalJson(requests[1])); assert.deepEqual(requests[1].values.ratio, { value: { width: 9, height: 16 }, provenance: 'authored' });
  runtime.dispose();
});

import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { after, test } from 'node:test';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Proposed finite pure-preflight qualification; source authored, not executed here.
// Owner runs the integrated extraction only after all runtime paths are reviewed/pinned.
// Whole actual functions only: no source slicing, provider/HTTP/authority substitute,
// native preparation, mixed wrapper, aggregate Runtime or legacy adapter import.
const rootInput = process.env.FORMA_EXPERIENCE_PREFLIGHT_CANDIDATE_ROOT;
const manifestInput = process.env.FORMA_EXPERIENCE_PREFLIGHT_REVIEWED_MANIFEST;
assert.ok(rootInput && manifestInput, 'Explicit integrated checkout and reviewed source manifest required');
const root = realpathSync(rootInput);
const manifest = JSON.parse(readFileSync(manifestInput, 'utf8'));
assert.equal(manifest.reviewedFor, 'image-slides-pure-preflight');
const modulePaths = [
  'worker/image-generation-policy.ts', 'worker/openai-image-route-contract.ts',
  'worker/output-fal-image-contract.ts', 'src/model/output-fal-image-contract.ts', 'src/model/fal-image-identity.ts',
  'worker/output-image-slides-preflight.ts', 'worker/image-adapter-selection.ts', 'worker/fal-image-identity.ts',
  'src/model/output-execution-policy.ts', 'src/model/image-format.ts', 'src/model/block-types.ts',
  'src/model/managed-production.ts', 'src/model/presentation-source.ts', 'src/model/generation-budget.ts',
  'src/model/presentation-count-policy.ts', 'worker/output-image-budget.ts', 'worker/replay-cost.ts',
  'worker/openai-text-cost.ts', 'worker/presentation-model-routing.ts', 'src/model/replay-development.ts',
  'src/model/combined-context.ts', 'src/model/context-adaptation.ts', 'src/model/prompt-policy.ts',
  'src/model/video-adapter.ts', 'src/model/output-source-policy.ts', 'src/model/presentation-delivery.ts',
];
assert.deepEqual(manifest.modules.map(entry => entry.path).sort(), [...modulePaths].sort(), 'Exact reviewed closure only');
const allowed = new Set(), expectedHashes = new Map();
for (const entry of manifest.modules) {
  assert.match(entry.sha256, /^[a-f0-9]{64}$/u);
  const file = realpathSync(resolve(root, entry.path)), local = relative(root, file);
  assert.ok(!local.startsWith('..' + sep) && !isAbsolute(local), 'Reviewed source must be in the integrated checkout');
  assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), entry.sha256, `Changed reviewed source: ${entry.path}`);
  allowed.add(file); expectedHashes.set(file, entry.sha256);
}
// Forbidden-side-effect tripwire only: never a fabricated provider response.
const originalFetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
let forbiddenFetchAttempts = 0, fetchRestored = false;
Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, enumerable: originalFetchDescriptor?.enumerable ?? true,
  value: function forbiddenPreflightFetch() { forbiddenFetchAttempts++; throw Error('Network forbidden in pure-preflight qualification'); },
});
function restoreFetch() {
  if (fetchRestored) return;
  fetchRestored = true;
  if (originalFetchDescriptor) Object.defineProperty(globalThis, 'fetch', originalFetchDescriptor);
  else delete globalThis.fetch;
}
process.once('exit', restoreFetch);
const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  // The reviewed production closure imports no runtime Node built-ins.
  assert.ok(!specifier.startsWith('node:') && !/^[a-z]+:/iu.test(specifier.replace(/^file:/u, '')), `Unreviewed dependency: ${specifier}`);
  const file = realpathSync(specifier.startsWith('file:') ? fileURLToPath(specifier)
    : resolve(dirname(fileURLToPath(context.parentURL)), specifier));
  assert.ok(allowed.has(file), `Unreviewed preflight dependency: ${file}`);
  return nextResolve(pathToFileURL(file).href, context);
}, load(url, context, nextLoad) {
  const file = realpathSync(fileURLToPath(url));
  assert.ok(allowed.has(file), `Unreviewed loaded preflight dependency: ${file}`);
  const loaded = nextLoad(url, context), source = loaded.source;
  assert.ok(source !== null && source !== undefined, `Missing source bytes: ${file}`);
  const bytes = typeof source === 'string' ? Buffer.from(source)
    : ArrayBuffer.isView(source) ? Buffer.from(source.buffer, source.byteOffset, source.byteLength)
      : Buffer.from(source);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedHashes.get(file), `Loaded source differs from reviewed pin: ${file}`);
  return loaded; // Return exactly the bytes verified above, not a second filesystem read.
} });
let hookActive = true;
function cleanup() {
  restoreFetch();
  if (hookActive) { hookActive = false; hook.deregister(); }
}
process.once('exit', cleanup);
after(() => {
  try { assert.equal(forbiddenFetchAttempts, 0, 'A forbidden fetch was attempted, even if a preflight catch swallowed its error'); }
  finally { cleanup(); }
});
let preflightModule, selectorModule, identityModule;
try {
  preflightModule = await import(pathToFileURL(resolve(root, 'worker/output-image-slides-preflight.ts')).href);
  selectorModule = await import(pathToFileURL(resolve(root, 'worker/image-adapter-selection.ts')).href);
  identityModule = await import(pathToFileURL(resolve(root, 'worker/fal-image-identity.ts')).href);
} catch (error) { cleanup(); throw error; }
// Keep the guard through tests: an unexpected late import must also fail closed.

const { preflightOutputImageSlidesTarget: preflight, outputExactImageRender: exactRender,
  outputNativeTargetRefusal: targetRefusal } = preflightModule;
const { selectImageAdapter: selectAdapter } = selectorModule;
// Presence sentinels only. Never read process.env for provider/model configuration.
const INERT_OPENAI_CONFIGURATION = 'qualification-only-not-a-credential';
const INERT_FAL_CONFIGURATION = 'qualification-only-not-a-fal-credential';
const ratios = [
  [1, 1, 1024, 1024], [3, 2, 1536, 1024], [2, 3, 1024, 1536],
  [4, 5, 1024, 1280], [5, 4, 1280, 1024], [16, 9, 2048, 1152], [9, 16, 1152, 2048],
];
const ordinarySource = () => ({ block_id: 'source-1', type: 'subject', active: true, intent: 'include',
  properties: { text: 'A copper lamp is on a wooden desk.', weight: 1 } });
const reference = (mode, properties = {}) => ({ block_id: 'reference-1', type: 'reference', active: true,
  properties: { text: 'The lamp has a narrow stem.', weight: 1, pixel_reference_mode: mode, ...properties } });

function inputFor(output) {
  const slides = output === 'slides', unit = slides ? 'presentation' : 'image';
  const obligation = slides ? 'deliverable-1' : 'variant-1';
  // Resolved target shape from the task-owned R2 fixed recipe fixture. This is
  // not a compiler/confirmed-plan receipt: no HTTP principal, custody, scope,
  // accepted quote or digests are fabricated. Unconsumed authority members of
  // OutputBridgeTargetInput are intentionally absent from this pure surface.
  return {
    env: { OPENAI_API_KEY: INERT_OPENAI_CONFIGURATION },
    target: {
      id: `${obligation}:target:1`, requirement_id: 'requirement-1', deliverable_id: 'deliverable-1',
      obligation_id: obligation, variant_id: slides ? null : 'variant-1', member_id: null,
      label: slides ? 'Slides' : 'Image 1:1', media_kind: output,
      required: true, selected: true, ordinal: 1, quantity: { kind: 'exact', unit, value: 1 },
      aspect_ratio: slides ? null : { width: 1, height: 1 }, source_scope: { kind: 'document' },
      coverage: { kind: slides ? 'document_outline' : 'document_context' },
      content_quantity: slides ? { kind: 'exact', unit: 'slide', value: 5 } : null,
      count_policy: slides ? { kind: 'exact', unit: 'slide', value: 5 } : null,
      suggested_count: null, instruction_text: slides ? '5 slides' : '1 image\n1:1',
      source_revision: 'source-1', requirement_revision: 'requirements-1', blocking_issues: [],
    },
    context: { snapshot: { facts: [ordinarySource()] } },
  };
}
function imageWithRatio(width, height) {
  const input = inputFor('image');
  input.target.aspect_ratio = { width, height };
  input.target.label = `Image ${width}:${height}`;
  input.target.instruction_text = `1 image\n${width}:${height}`;
  return input;
}
function assertRefused(result, targetId, code) {
  assert.equal(result.targetId, targetId);
  assert.equal(result.available, false);
  assert.equal(result.reasonCode, code);
  assert.equal(result.transferCode, 'output_transfer_none_owned_adoption');
  assert.deepEqual([result.provider, result.model, result.route], [null, null, null]);
  assert.deepEqual([result.maximumMicrousd, result.maximumCalls, result.maximumTokens], [0, 0, 0]);
  assert.deepEqual(result.settings, {});
  assert.equal(result.transferDescription, 'No source or file is sent by this check. You can use an owned file after inspection and review.');
}
async function refused(input, code) { assertRefused(await preflight(input), input.target.id, code); }
function assertAvailable(result, input, route) {
  assert.equal(result.targetId, input.target.id);
  assert.equal(result.available, true, `${result.reasonCode}: ${result.reason}`);
  assert.equal(result.reasonCode, `output_native_${input.target.media_kind}_ready`);
  assert.equal(result.route, route);
  assert.equal(result.transferCode, 'output_transfer_document_after_authorization');
  assert.equal(result.maximumCalls, 2);
  assert.equal(result.maximumTokens, 128_000);
  assert.ok(Number.isSafeInteger(result.maximumMicrousd) && result.maximumMicrousd > 0);
  const settings = result.settings;
  assert.equal(settings.calls.length, 2);
  assert.ok(settings.calls.every(call => Number.isSafeInteger(call.maximumMicrousd) && call.maximumMicrousd > 0));
  assert.equal(result.maximumMicrousd, settings.calls.reduce((sum, call) => sum + call.maximumMicrousd, 0));
  assert.deepEqual(settings.executionPolicy, { maximumMilliseconds: 240_000, heartbeatMilliseconds: 60_000, maximumRenewals: 3 });
  assert.ok(Object.isFrozen(settings.executionPolicy)); // Actual shared policy guarantee only.
  assert.deepEqual(result.reasonValues, { maximumExecutionSeconds: 240 });
  assert.equal(settings.payload.productionMode, 'manual');
  // Existing downstream payload fields; NOT evidence of a user's consent/action.
  assert.equal(settings.payload.budgetAcknowledged, true);
  assert.equal(settings.payload.preflightAcknowledged, true);
  assert.equal(settings.payload.outputTargetInstructions, [input.target.instruction_text,
    `Only this deliverable is requested: ${input.target.label}.`,
    `Coverage contract: ${JSON.stringify(input.target.coverage)}.`,
    'The delivery instructions are not evidence. Ground factual claims in the authorized Document sources.',
  ].join('\n'));
  assert.match(result.transferDescription, /This preflight sends nothing\./u);
  assert.match(result.transferDescription, /not a guarantee of provider billing/u);
  return settings;
}

test('Image fixed recipe yields exact square geometry and bounded estimate/settings, not a grant', async () => {
  const input = inputFor('image'), result = await preflight(input);
  const settings = assertAvailable(result, input, 'document-image-manual-v1');
  assert.deepEqual([result.provider, result.model, settings.kind], ['openai', 'gpt-image-2', 'generate']);
  assert.deepEqual(settings.imageRender, { size: '1024x1024', format: {
    schema_version: 1, aspect_ratio: { width: 1, height: 1 }, dimensions: { width: 1024, height: 1024, unit: 'px' },
  } });
  assert.deepEqual(settings.payload.outputImageFormat, settings.imageRender.format);
  assert.deepEqual(settings.calls.map(({ stage, provider, model }) => ({ stage, provider, model })), [
    { stage: 'planning:initial', provider: 'openai', model: 'gpt-5.6-terra' },
    { stage: 'image:initial', provider: 'openai', model: 'gpt-image-2' },
  ]);
  assert.ok(settings.calls[0].maximumMicrousd >= 100_000);
  assert.equal(settings.calls[1].maximumMicrousd, Math.max(900_000, settings.imageBudget.maximumMicrousd));
  assert.deepEqual({ version: settings.imageBudget.version, quality: settings.imageBudget.quality,
    maximumPromptBytes: settings.imageBudget.maximumPromptBytes, maximumReferenceImages: settings.imageBudget.maximumReferenceImages,
    estimatedOutputTokens: settings.imageBudget.estimatedOutputTokens, maximumOutputTokens: settings.imageBudget.maximumOutputTokens,
    maximumInputTokens: settings.imageBudget.maximumInputTokens, allowanceCode: settings.imageBudget.allowanceCode }, {
    version: 'gpt-image-2-doc-calculator-2026-08-27', quality: 'high', maximumPromptBytes: 32_000, maximumReferenceImages: 0,
    estimatedOutputTokens: 7024, maximumOutputTokens: 14_048, maximumInputTokens: 36_096,
    allowanceCode: 'output_native_image_allowance_verified',
  });
  assert.equal(Object.hasOwn(result, 'grantId'), false);
  assert.equal(Object.hasOwn(result, 'termsDigest'), false);
});

test('each of the seven mini-app ratio values reaches its exact native dimensions without crop or substitution', async () => {
  for (const [width, height, pixelsWide, pixelsHigh] of ratios) {
    const input = imageWithRatio(width, height);
    const expected = { size: `${pixelsWide}x${pixelsHigh}`, format: { schema_version: 1,
      aspect_ratio: { width, height }, dimensions: { width: pixelsWide, height: pixelsHigh, unit: 'px' } } };
    assert.deepEqual(exactRender({ width, height }), expected);
    const result = await preflight(input), settings = assertAvailable(result, input, 'document-image-manual-v1');
    assert.deepEqual(settings.imageRender, expected);
    assert.deepEqual(settings.payload.outputImageFormat, expected.format);
    assert.equal(input.target.aspect_ratio.width, width);
    assert.equal(input.target.aspect_ratio.height, height);
  }
});

test('generic geometry normalizes equivalent ratios; it is not the mini-app allowlist', async () => {
  const expected = { size: '2048x1152', format: { schema_version: 1,
    aspect_ratio: { width: 16, height: 9 }, dimensions: { width: 2048, height: 1152, unit: 'px' } } };
  assert.deepEqual(exactRender({ width: 32, height: 18 }), expected);
  const input = imageWithRatio(32, 18), result = await preflight(input);
  assert.deepEqual(assertAvailable(result, input, 'document-image-manual-v1').imageRender, expected);
  assert.deepEqual(input.target.aspect_ratio, { width: 32, height: 18 });
  // This is preserved generic behavior. R2's intake/compiler separately refuses
  // an unregistered 32:18 authored pair; that module is not imported here.
});

test('Image refuses absent or invalid ratio rather than defaulting to a size', async () => {
  for (const absent of [null, undefined]) {
    const input = inputFor('image'); input.target.aspect_ratio = absent;
    await refused(input, 'output_native_image_ratio_required');
  }
  for (const ratio of [{ width: 0, height: 1 }, { width: -1, height: 1 }, { width: 1.5, height: 1 },
    { width: 1, height: 0 }, { width: Number.MAX_SAFE_INTEGER + 1, height: 1 }, { width: 4, height: 1 }]) {
    assert.equal(exactRender(ratio), null);
    const input = inputFor('image'); input.target.aspect_ratio = ratio;
    await refused(input, 'output_native_image_ratio_unsupported');
  }
});

test('selection/blocking issue and Document-scope refusals precede provider/source checks', async () => {
  const input = inputFor('image'); input.env = {}; input.context.snapshot.facts = [];
  input.target.selected = false; input.target.source_scope = { kind: 'blocks', block_ids: ['source-1'] };
  input.target.blocking_issues = [{ code: 'fixture_first_issue', message: 'First issue', path: 'target' },
    { code: 'fixture_second_issue', message: 'Second issue', path: 'target' }];
  const first = targetRefusal(input);
  assertRefused(first, input.target.id, 'fixture_first_issue');
  assert.equal(first.reason, 'First issue');
  assert.deepEqual(await preflight(input), first);
  input.target.blocking_issues = [];
  await refused(input, 'output_native_target_not_selected');
  input.target.selected = true;
  await refused(input, 'output_native_document_scope_required');
  input.target.source_scope = { kind: 'document' };
  assert.equal(targetRefusal(input), null);
  input.target.media_kind = 'document';
  await refused(input, 'output_native_medium_adoption_only'); // No Model3D branch/import.
  input.target.media_kind = 'image';
  await refused(input, 'output_native_planner_unconfigured');
});

test('Image planner configuration and source guards retain their actual priority', async () => {
  const input = inputFor('image'); input.env = {}; input.context.snapshot.facts = [];
  input.target.aspect_ratio = null;
  await refused(input, 'output_native_planner_unconfigured');
  input.env = { OPENAI_API_KEY: INERT_OPENAI_CONFIGURATION, OPENAI_MODEL: 'unpriced-planner-fixture' };
  await refused(input, 'output_native_planner_price_unknown');
  input.env.OPENAI_MODEL = 'gpt-5.6-terra';
  await refused(input, 'output_native_source_required');
  input.context.snapshot.facts = [ordinarySource()];
  await refused(input, 'output_native_image_ratio_required');
});

test('common source check refuses absent, inactive, output-only and negative facts for both outputs', async () => {
  const cases = [undefined, {}, [], [{ ...ordinarySource(), active: false }],
    [{ ...ordinarySource(), type: 'OUTPUT' }], [{ ...ordinarySource(), intent: 'prohibit' }],
    [{ ...ordinarySource(), effect: 'must_not_include' }]];
  for (const output of ['image', 'slides']) for (const facts of cases) {
    const input = inputFor(output); input.context.snapshot.facts = structuredClone(facts);
    await refused(input, 'output_native_source_required');
  }
});

test('required reference-pixel modes are refused before provider selection; no reference is silently omitted', async () => {
  for (const mode of ['inspiration', 'preserve_composition', 'preserve_subject', 'preserve_style']) {
    const input = inputFor('image'); input.context.snapshot.facts.push(reference(mode));
    input.env.FORMA_IMAGE_PROVIDER = 'fal'; input.env.FAL_KEY = INERT_FAL_CONFIGURATION;
    await refused(input, 'output_native_reference_input_unpriced');
    input.target.aspect_ratio = { width: 4, height: 1 };
    await refused(input, 'output_native_image_ratio_unsupported');
  }
});

test('Image retains existing inactive, zero-weight and describe-only reference semantics', async () => {
  for (const fact of [reference('context_only'), reference('unknown-fixture-mode'),
    { ...reference('inspiration'), active: false }, reference('inspiration', { weight: 0 })]) {
    const input = inputFor('image'); input.context.snapshot.facts.push(fact);
    assertAvailable(await preflight(input), input, 'document-image-manual-v1');
  }
  // Unknown reference mode is currently context_only in the shared predicate;
  // no new reference-authority validation is claimed by this pure computation.
});

test('bounded Image preflight refuses an explicit unavailable provider or unknown image price contract', async () => {
  const configuredFal = inputFor('image');
  configuredFal.env.FORMA_IMAGE_PROVIDER = 'fal'; configuredFal.env.FAL_KEY = INERT_FAL_CONFIGURATION;
  await refused(configuredFal, 'output_native_image_adapter_unsupported');
  delete configuredFal.env.FAL_KEY;
  await refused(configuredFal, 'output_native_image_provider_unavailable');
  configuredFal.env.FORMA_IMAGE_PROVIDER = 'unsupported-fixture-provider';
  await refused(configuredFal, 'output_native_image_provider_unavailable');
  configuredFal.env.FORMA_IMAGE_PROVIDER = ' OpenAI ';
  configuredFal.env.OPENAI_IMAGE_MODEL = 'unpriced-image-fixture';
  await refused(configuredFal, 'output_native_image_price_unknown');
  configuredFal.env.OPENAI_IMAGE_MODEL = 'gpt-image-2'; configuredFal.env.OPENAI_MODEL = 'gpt-5.6-sol';
  const result = await preflight(configuredFal);
  const settings = assertAvailable(result, configuredFal, 'document-image-manual-v1');
  assert.equal(settings.calls[0].model, 'gpt-5.6-sol');
  assert.equal(settings.calls[1].model, 'gpt-image-2');
});

test('actual selector preserves configured Fal models/identity and its legacy OpenAI fallback reasons', () => {
  const env = { FORMA_IMAGE_PROVIDER: 'fal', FAL_KEY: INERT_FAL_CONFIGURATION };
  const high = selectAdapter(env, { quality: 'high' });
  assert.deepEqual([high.provider, high.providerName, high.model, high.adapterId, high.adapterVersion],
    ['fal-ideogram', 'fal', 'ideogram/v4', identityModule.FAL_IDEOGRAM_ADAPTER_ID, identityModule.FAL_IDEOGRAM_ADAPTER_VERSION]);
  assert.equal(high.adapterId, 'fal-ideogram-v4'); assert.equal(high.adapterVersion, 'v52');
  assert.equal(selectAdapter(env, { quality: 'low' }).model, 'gpt-image-2.5-flare');
  const inertReference = { bytes: new Uint8Array(0), mimeType: 'image/png', source: 'uploaded-reference' };
  const edit = selectAdapter(env, { references: [inertReference] });
  assert.equal(edit.model, 'ideogram/v4/image-to-image');
  assert.equal(edit.reason, 'one-reference Ideogram 4 image-to-image');
  assert.equal(selectAdapter({ ...env, FAL_IMAGE_MODEL: 'configured-fixture-fal-model' }, { quality: 'high' }).model, 'configured-fixture-fal-model');
  for (const [candidateEnv, options, reason] of [
    [{ FORMA_IMAGE_PROVIDER: 'fal' }, {}, 'Fal is not configured'],
    [env, { references: [inertReference, inertReference] }, 'Ideogram 4 accepts one reference; preserving the multi-reference contract'],
    [env, { outputFormat: 'webp' }, 'Ideogram 4 does not return WebP'],
  ]) {
    const fallback = selectAdapter(candidateEnv, options);
    assert.deepEqual([fallback.providerName, fallback.model, fallback.reason], ['openai', 'gpt-image-2.5-sunburst', reason]);
  }
  // Selector compatibility is not configured-Fal execution. The separate
  // bounded preflight above refuses its explicitly requested fallback route.
});

test('exact-five Slides recipe produces one presentation with preserved count and two bounded planning routes', async () => {
  const input = inputFor('slides'), result = await preflight(input);
  const settings = assertAvailable(result, input, 'document-slides-manual-v1');
  assert.deepEqual([result.provider, result.model, settings.kind], ['openai', 'gpt-5.6-terra', 'render_document']);
  assert.deepEqual(input.target.quantity, { kind: 'exact', unit: 'presentation', value: 1 });
  assert.equal(settings.payload.artifactKind, 'slides');
  assert.equal(settings.payload.itemCount, 5); assert.equal(settings.payload.requestedSlideCount, 5);
  assert.deepEqual(settings.payload.slideCountPolicy, { kind: 'exact', unit: 'slide', value: 5 });
  assert.deepEqual(settings.calls.map(call => call.stage), ['planning:0:initial', 'planning:0:repair']);
  const expectedInput = Buffer.byteLength(JSON.stringify(input.context.snapshot), 'utf8') * 4 + 25_000;
  for (const [index, call] of settings.calls.entries()) {
    assert.equal(call.provider, 'openai'); assert.equal(call.model, 'gpt-5.6-terra');
    assert.equal(call.maximumInputTokens, expectedInput); assert.equal(call.maximumOutputTokens, 6500);
    assert.ok(call.maximumMicrousd >= 500_000);
    assert.equal(call.presentationRoute.workflow, index === 0 ? 'slides.composition' : 'slides.editorial_repair');
    assert.equal(call.presentationRoute.reasoningEffort, 'low');
    assert.equal(call.presentationRoute.modelSource, 'default');
    assert.equal(call.presentationRoute.effortSource, 'default');
    assert.equal(call.presentationRoute.serviceTier, 'default');
    assert.equal(call.presentationRoute.cachePolicy, 'disabled-explicit');
    assert.equal(call.presentationRoute.routingVersion, 'slides-model-routing-v1');
    assert.ok(Object.isFrozen(call.presentationRoute));
  }
  assert.equal(Object.hasOwn(settings, 'imageRender'), false);
});

test('generic Slides flexible-count compatibility preserves the policy and suggestion without inventing an exact count', async () => {
  const input = inputFor('slides');
  input.target.content_quantity = { kind: 'range', unit: 'slide', min: 4, max: 8 };
  input.target.count_policy = { kind: 'flexible', unit: 'slide', min: 4, max: 8, aim: 6 };
  input.target.suggested_count = 7;
  const result = await preflight(input), settings = assertAvailable(result, input, 'document-slides-manual-v1');
  assert.deepEqual(settings.payload.slideCountPolicy, input.target.count_policy);
  assert.equal(settings.payload.itemCount, 7);
  assert.equal(Object.hasOwn(settings.payload, 'requestedSlideCount'), false);
  assert.deepEqual(settings.calls.map(call => call.maximumOutputTokens), [7200, 7200]);
  assert.equal(input.target.suggested_count, 7);
  // Existing generic compatibility, not a newly offered mini-app recipe.
});

test('Slides invalid count policy, unit and out-of-range suggestions are refused without clamping', async () => {
  for (const policy of [null, { kind: 'exact', unit: 'image', value: 5 }]) {
    const input = inputFor('slides'); input.target.count_policy = policy;
    await refused(input, 'output_native_slide_count_policy_required');
  }
  for (const value of [0, 16, 5.5, '5']) {
    const input = inputFor('slides'); input.target.count_policy = { kind: 'exact', unit: 'slide', value };
    await refused(input, 'output_native_slide_count_unsupported');
  }
  const input = inputFor('slides');
  input.target.count_policy = { kind: 'flexible', unit: 'slide', min: 4, max: 8, aim: 6 };
  input.target.suggested_count = 9;
  await refused(input, 'output_native_slide_count_unsupported');
  assert.equal(input.target.suggested_count, 9);
});

test('Slides requires a resolvable source block after count validation and before workflow configuration', async () => {
  const input = inputFor('slides');
  const fact = ordinarySource(); delete fact.block_id;
  input.context.snapshot.facts = [fact];
  input.env.OPENAI_SLIDES_COMPOSITION_MODEL = 'unsupported-fixture-model';
  input.target.count_policy = null;
  await refused(input, 'output_native_slide_count_policy_required');
  input.target.count_policy = { kind: 'exact', unit: 'slide', value: 5 };
  await refused(input, 'output_native_slide_source_unresolved');
  input.context.snapshot.facts = [ordinarySource()];
  await refused(input, 'presentation_model_configuration_invalid');
});

test('Slides workflow model/effort choices remain exact and may override the legacy planner setting', async () => {
  const input = inputFor('slides');
  input.env = { OPENAI_API_KEY: INERT_OPENAI_CONFIGURATION, OPENAI_MODEL: 'unsupported-legacy-fixture',
    OPENAI_SLIDES_COMPOSITION_MODEL: 'gpt-5.6-sol', OPENAI_SLIDES_COMPOSITION_REASONING_EFFORT: 'medium',
    OPENAI_SLIDES_REPAIR_MODEL: 'gpt-5.6-terra', OPENAI_SLIDES_REPAIR_REASONING_EFFORT: 'high' };
  const result = await preflight(input), settings = assertAvailable(result, input, 'document-slides-manual-v1');
  assert.equal(result.model, 'gpt-5.6-sol');
  assert.deepEqual(settings.calls.map(call => [call.model, call.presentationRoute.reasoningEffort,
    call.presentationRoute.modelSource, call.presentationRoute.effortSource]),
  [['gpt-5.6-sol', 'medium', 'workflow', 'workflow'], ['gpt-5.6-terra', 'high', 'workflow', 'workflow']]);
  for (const call of settings.calls) assert.ok(Object.isFrozen(call.presentationRoute));
  input.env = { OPENAI_API_KEY: INERT_OPENAI_CONFIGURATION, OPENAI_MODEL: 'gpt-5.6-sol' };
  const legacy = assertAvailable(await preflight(input), input, 'document-slides-manual-v1');
  assert.deepEqual(legacy.calls.map(call => [call.model, call.presentationRoute.modelSource]),
    [['gpt-5.6-sol', 'legacy'], ['gpt-5.6-sol', 'legacy']]);
});

test('Slides refuses invalid explicit composition/repair models or effort rather than silently defaulting', async () => {
  for (const [key, value] of [
    ['OPENAI_SLIDES_COMPOSITION_MODEL', 'unsupported-fixture-model'],
    ['OPENAI_SLIDES_REPAIR_MODEL', 'unsupported-fixture-model'],
    ['OPENAI_SLIDES_COMPOSITION_REASONING_EFFORT', 'unsupported-fixture-effort'],
    ['OPENAI_SLIDES_REPAIR_REASONING_EFFORT', 'unsupported-fixture-effort'],
    ['OPENAI_MODEL', 'unsupported-legacy-fixture'],
  ]) {
    const input = inputFor('slides'); input.env[key] = value;
    await refused(input, 'presentation_model_configuration_invalid');
  }
});

test('repeated pure checks retain deterministic settings/estimate shape and do not mutate supplied inputs', async () => {
  for (const output of ['image', 'slides']) {
    const input = inputFor(output);
    input.context.snapshot.facts[0].properties.text += ' Copper finish · α.';
    const before = structuredClone(input);
    const first = await preflight(input), second = await preflight(input);
    assert.equal(first.available, true); assert.deepEqual(second, first); assert.deepEqual(input, before);
    assert.ok(Object.isFrozen(first.settings.executionPolicy));
    if (output === 'slides') {
      for (const call of first.settings.calls) assert.ok(Object.isFrozen(call.presentationRoute));
      const expectedInput = Buffer.byteLength(JSON.stringify(input.context.snapshot), 'utf8') * 4 + 25_000;
      assert.equal(first.settings.calls[0].maximumInputTokens, expectedInput);
    }
    // No assertion that the overall result/settings is deeply frozen: current
    // source offers no such guarantee, and no quote acceptance is exercised.
    assert.equal(Object.hasOwn(first, 'expiresAt'), false);
    assert.equal(Object.hasOwn(first, 'jobId'), false);
  }
});

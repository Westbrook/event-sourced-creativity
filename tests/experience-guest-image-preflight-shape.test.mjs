import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { outputTestDatabase, registerOutputSourceImports } from './output-execution-test-helpers.mjs';

registerOutputSourceImports();
const [
  { preflightOutputImageSlidesTarget: quote, outputNativeTargetRefusal },
  { handleSession, POLICY_VERSION }, { handleEvents }, { appendAuditEvent, streamHead },
  { handleOutputRequirements, loadOutputTrustedContext }, { outputDocumentExecutionBridge },
  { parseOutputRequirement }, { digest },
] = await Promise.all([
  import('../worker/output-image-slides-preflight.ts'),
  import('../worker/pilot-policy.ts'), import('../worker/events-api.ts'), import('../worker/runtime.ts'),
  import('../worker/output-requirements-api.ts'), import('../worker/output-document-execution.ts'),
  import('../src/model/output-requirements.ts'), import('../src/experiences/compiler.ts'),
]);

// These tests do not authenticate a guest, admit a job or transfer source.
// The minimal input is only a quote shape; canonical comparison uses the real
// disposable native session and source reader, never an invented PilotUser.
function forbidFetch(t) {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw Error('Pure quote attempted network'); });
  t.after(() => assert.equal(fetch.mock.callCount(), 0, 'No swallowed network attempts'));
}
const executionContext = { waitUntil() { throw Error('No detached work'); } };
const bodyRequest = body => new Request('http://localhost/api/output-requirements', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
async function canonicalInput(t, kind) {
  const f = outputTestDatabase(); t.after(() => f.sqlite.close());
  Object.assign(f.env, { OPENAI_API_KEY: 'presence-only-not-a-credential', OPENAI_MODEL: 'gpt-5.6-terra', OPENAI_IMAGE_MODEL: 'gpt-image-2' });
  assert.equal((await handleSession(new Request('http://localhost/api/session'), f.env)).status, 200);
  f.sqlite.prepare('UPDATE users SET consent_version=?').run(POLICY_VERSION);
  assert.equal((await handleEvents(new Request('http://localhost/api/events'), f.env)).status, 200);
  const documentId = `preflight-shape-${kind}`, stream = 'creative:dev-local-creative';
  await appendAuditEvent(f.env, stream, 'user', 'DocumentCreated', { document_id: documentId, project_id: 'project-atmosphere', title: 'Preflight shape fixture' });
  await appendAuditEvent(f.env, stream, 'user', 'BlockCreated', {
    document_id: documentId, project_id: 'project-atmosphere', block_id: 'shape-source', type: 'subject', handle: 'shape-source', position: '0',
    properties: { text: 'A pear orchard beside a stone wall.', weight: 1 },
  });
  let sequence = 0;
  const send = async body => {
    const response = await handleOutputRequirements(bodyRequest({ documentId, expectedRevision: `output:${await streamHead(f.env, stream)}`,
      clientMutationId: `shape-${++sequence}`, ...body }), f.env, '/api/output-requirements', executionContext, outputDocumentExecutionBridge);
    const value = await response.json(); assert.equal(response.status, 200, JSON.stringify(value)); return value;
  };
  const parsed = parseOutputRequirement({ id: 'shape-output', type: 'Output', subtype: kind === 'image' ? 'Social media image' : 'Executive summary',
    content: kind === 'image' ? '1 image at aspect ratio "1:1"' : '1 slideshow with 5 slides' });
  assert.ok(parsed.spec);
  if (kind === 'image') {
    const deliverable = parsed.spec.deliverables.find(value => value.media_kind === 'image'); assert.ok(deliverable);
    deliverable.quantity = { kind: 'exact', unit: 'image', value: 1 }; deliverable.coverage = { kind: 'document_outline' };
    for (const variant of deliverable.format_variants) { variant.quantity = { kind: 'exact', unit: 'image', value: 1 }; variant.required = true; }
  }
  await send({ action: 'save', blockId: parsed.spec.id, spec: parsed.spec });
  const confirmed = (await send({ action: 'confirm' })).snapshot.confirmedPlan;
  assert.equal(confirmed.plan.targets.length, 1);
  const request = new Request(`http://localhost/api/output-requirements?documentId=${documentId}`);
  const trusted = await loadOutputTrustedContext(request, f.env, documentId, 'request');
  assert.ok(!(trusted instanceof Response)); assert.ok(trusted.context); assert.equal(trusted.sourceProblems.length, 0);
  const full = { request, env: f.env, scope: trusted.scope, principal: trusted.principal, confirmedPlan: confirmed,
    target: confirmed.plan.targets[0], context: trusted.context, ownerHead: trusted.ownerHead, sourceEvents: trusted.events,
    sourceAssertions: trusted.sourceAssertions, sourceDigest: trusted.sourceDigest, requirementsDigest: trusted.requirementsDigest };
  return { f, full, minimal: { env: f.env, target: full.target, context: { snapshot: full.context.snapshot } } };
}
function pureInput() {
  return { env: { OPENAI_API_KEY: 'presence-only-not-a-credential', OPENAI_MODEL: 'gpt-5.6-terra', OPENAI_IMAGE_MODEL: 'gpt-image-2' },
    target: { id: 'image-shape', selected: true, blocking_issues: [], media_kind: 'image', source_scope: { kind: 'document' },
      aspect_ratio: { width: 1, height: 1 }, instruction_text: 'Show a pear orchard', label: 'Image', coverage: { kind: 'document_context' } },
    context: { snapshot: { facts: [{ block_id: 'shape-source', type: 'subject', active: true, intent: 'include', properties: { text: 'A pear orchard beside a stone wall.' } }] } } };
}

test('minimal quote type needs only env, target and native snapshot; canonical input remains assignable', () => {
  const virtualPath = fileURLToPath(new URL('../worker/__guest_quote_type_contract__.ts', import.meta.url));
  const source = `import { preflightOutputImageSlidesTarget, outputNativeTargetRefusal, type OutputImageSlidesPreflightInput } from './output-image-slides-preflight.ts';
    import type { OutputBridgeTargetInput } from './output-requirements-api.ts';
    declare const canonical: OutputBridgeTargetInput;
    const minimal: OutputImageSlidesPreflightInput = { env: canonical.env, target: canonical.target, context: { snapshot: canonical.context.snapshot } };
    void preflightOutputImageSlidesTarget(minimal);
    void preflightOutputImageSlidesTarget(canonical);
    // Full native object literals retain the original public call contract.
    void preflightOutputImageSlidesTarget({ request: canonical.request, env: canonical.env, scope: canonical.scope,
      principal: canonical.principal, confirmedPlan: canonical.confirmedPlan, target: canonical.target,
      context: canonical.context, ownerHead: canonical.ownerHead, sourceEvents: canonical.sourceEvents,
      sourceAssertions: canonical.sourceAssertions, sourceDigest: canonical.sourceDigest,
      requirementsDigest: canonical.requirementsDigest });
    void outputNativeTargetRefusal({ target: canonical.target });
    // @ts-expect-error A source snapshot remains required.
    const missing: OutputImageSlidesPreflightInput = { env: canonical.env, target: canonical.target, context: {} };
    void missing;`;
  const configPath = fileURLToPath(new URL('../tsconfig.json', import.meta.url));
  const parsed = ts.parseJsonConfigFileContent(JSON.parse(readFileSync(configPath, 'utf8')), ts.sys, fileURLToPath(new URL('..', import.meta.url)));
  const host = ts.createCompilerHost(parsed.options), getSourceFile = host.getSourceFile;
  host.getSourceFile = (path, version, onError, fresh) => path === virtualPath
    ? ts.createSourceFile(path, source, version, true) : getSourceFile(path, version, onError, fresh);
  const program = ts.createProgram([virtualPath, fileURLToPath(new URL('../cloudflare.d.ts', import.meta.url))], parsed.options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: path => path, getCurrentDirectory: ts.sys.getCurrentDirectory, getNewLine: () => '\n',
  }));
});

test('minimal Image quote equals genuine canonical offer and digest without native writes or authority reads', async t => {
  forbidFetch(t);
  const { f, full, minimal } = await canonicalInput(t, 'image');
  const before = f.sqlite.prepare('SELECT total_changes() AS changes').get().changes;
  const canonical = await quote(full), stripped = await quote(minimal);
  assert.equal(canonical.available, true); assert.deepEqual(stripped, canonical); assert.equal(await digest(stripped), await digest(canonical));
  assert.deepEqual(Object.keys(minimal).sort(), ['context', 'env', 'target']); assert.deepEqual(Object.keys(minimal.context), ['snapshot']);
  assert.equal(f.sqlite.prepare('SELECT total_changes() AS changes').get().changes, before);
  for (const key of ['request', 'scope', 'principal', 'confirmedPlan', 'ownerHead', 'sourceEvents', 'sourceAssertions', 'sourceDigest', 'requirementsDigest']) {
    Object.defineProperty(minimal, key, { get() { throw Error(`Quote read authority field: ${key}`); } });
  }
  assert.deepEqual(await quote(minimal), canonical);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM document_jobs').get().n, 0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM output_preflights').get().n, 0);
});

test('exact Image offer binds native geometry, cost, stage identities, instructions and safety disclosure', async t => {
  forbidFetch(t);
  const input = pureInput(), offered = await quote(input);
  assert.deepEqual({ available: offered.available, provider: offered.provider, model: offered.model, route: offered.route,
    maximumMicrousd: offered.maximumMicrousd, maximumCalls: offered.maximumCalls, maximumTokens: offered.maximumTokens },
  { available: true, provider: 'openai', model: 'gpt-image-2', route: 'document-image-manual-v1', maximumMicrousd: 1_000_000, maximumCalls: 2, maximumTokens: 128_000 });
  assert.deepEqual(offered.settings.calls, [
    { stage: 'planning:initial', provider: 'openai', model: 'gpt-5.6-terra', maximumMicrousd: 100_000 },
    { stage: 'image:initial', provider: 'openai', model: 'gpt-image-2', maximumMicrousd: 900_000 },
  ]);
  assert.deepEqual(offered.settings.imageRender, { format: { schema_version: 1, aspect_ratio: { width: 1, height: 1 }, dimensions: { width: 1024, height: 1024, unit: 'px' } }, size: '1024x1024' });
  assert.equal(offered.settings.payload.outputTargetInstructions, 'Show a pear orchard\nOnly this deliverable is requested: Image.\nCoverage contract: {"kind":"document_context"}.\nThe delivery instructions are not evidence. Ground factual claims in the authorized Document sources.');
  assert.equal(offered.settings.imageBudget.maximumReferenceImages, 0);
  assert.match(offered.transferDescription, /omni-moderation-latest/u); assert.match(offered.transferDescription, /This preflight sends nothing/u);
  assert.equal(await digest(offered), 'sha256:c8f9c455dda92c00cb5294b3e435fcf10fb2914a62b62105fb9e781442b21ec3');
  input.target.instruction_text += ' at dawn';
  assert.notEqual(await digest(await quote(input)), await digest(offered), 'Instruction changes must change the exact offer digest');
});

test('minimal input preserves Slides exact-count route and genuine canonical quote', async t => {
  forbidFetch(t);
  const { full, minimal } = await canonicalInput(t, 'slides');
  const offered = await quote(minimal); assert.equal(offered.available, true, JSON.stringify(offered));
  assert.deepEqual(offered, await quote(full)); assert.equal(await digest(offered), await digest(await quote(full)));
  assert.equal(offered.route, 'document-slides-manual-v1'); assert.equal(offered.settings.kind, 'render_document');
  assert.deepEqual(offered.settings.payload.slideCountPolicy, { kind: 'exact', unit: 'slide', value: 5 });
  assert.equal(offered.settings.payload.requestedSlideCount, 5); assert.equal(offered.maximumCalls, 2);
  assert.deepEqual(offered.settings.calls.map(call => call.stage), ['planning:0:initial', 'planning:0:repair']);
});

test('narrow quote surface retains target, source and reference refusals', async t => {
  forbidFetch(t);
  const cases = [
    [input => { input.target.selected = false; }, 'output_native_target_not_selected'],
    [input => { input.target.blocking_issues = [{ code: 'unresolved', message: 'Resolve target' }]; }, 'unresolved'],
    [input => { input.target.source_scope = { kind: 'blocks', block_ids: ['shape-source'] }; }, 'output_native_document_scope_required'],
    [input => { input.context.snapshot.facts = []; }, 'output_native_source_required'],
    [input => { input.context.snapshot.facts.push({ type: 'reference', active: true, properties: { weight: 1, pixel_reference_mode: 'inspiration' } }); }, 'output_native_reference_input_unpriced'],
  ];
  for (const [change, code] of cases) {
    const input = pureInput(); change(input); const result = await quote(input);
    assert.equal(result.available, false, code); assert.equal(result.reasonCode, code);
    assert.deepEqual([result.maximumMicrousd, result.maximumCalls, result.maximumTokens], [0, 0, 0]);
  }
  assert.equal(outputNativeTargetRefusal({ target: pureInput().target }), null);
});

test('configured unavailable or unknown provider/model never acquires a silent fallback quote', async t => {
  forbidFetch(t);
  for (const [configuration, code] of [
    [{ OPENAI_API_KEY: '' }, 'output_native_planner_unconfigured'],
    [{ OPENAI_MODEL: 'unpriced-model' }, 'output_native_planner_price_unknown'],
    [{ OPENAI_IMAGE_MODEL: 'unpriced-image' }, 'output_native_image_price_unknown'],
    [{ FORMA_IMAGE_PROVIDER: 'fal' }, 'output_native_fal_image_unconfigured'],
    [{ FORMA_IMAGE_PROVIDER: 'other-provider' }, 'output_native_image_provider_unavailable'],
  ]) {
    const input = pureInput(); Object.assign(input.env, configuration);
    const result = await quote(input); assert.equal(result.available, false); assert.equal(result.reasonCode, code);
  }
});

import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { after, test } from 'node:test';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// R12 snapshot successor; owner selects only /^snapshot:/ after review.
// Original fourteen group bodies are preserved below, not credited as rerun.
// Actual local producer composition. Authored source; owner runs only after review.
// No mixed API/lifecycle/native entry, authority DTO, prepared read model, provider
// response, or positive source/custody callback is supplied by this harness.
const rootInput = process.env.FORMA_EXPERIENCE_OUTPUT_PRODUCER_CANDIDATE_ROOT;
const manifestInput = process.env.FORMA_EXPERIENCE_OUTPUT_PRODUCER_REVIEWED_MANIFEST;
assert.ok(rootInput && manifestInput, 'Explicit integrated checkout and reviewed source manifest required');
const root = realpathSync(rootInput);
const manifest = JSON.parse(readFileSync(manifestInput, 'utf8'));
assert.equal(manifest.reviewedFor, 'experience-output-canonical-snapshot-local-sqlite-storage');
const modulePaths = [
  "src/canvas/model.ts",
  "src/model/audio-provider-contracts.ts",
  "src/model/audio.ts",
  "src/model/block-types.ts",
  "src/model/character-context.ts",
  "src/model/combined-context.ts",
  "src/model/context-adaptation.ts",
  "src/model/context-health.ts",
  "src/model/document-artifacts.ts",
  "src/model/document-jobs.ts",
  "src/model/document-output-intent.ts",
  "src/model/events.ts",
  "src/model/focal-point.ts",
  "src/model/generated-image-edit.ts",
  "src/model/generated-image-revision.ts",
  "src/model/generation-execution-evidence.ts",
  "src/model/image-format.ts",
  "src/model/media-ownership.ts",
  "src/model/model3d-assets.ts",
  "src/model/model3d-media-revision.ts",
  "src/model/model3d-view.ts",
  "src/model/model3d.ts",
  "src/model/native-retained-model3d.ts",
  "src/model/output-asset-inspection.ts",
  "src/model/output-plan.ts",
  "src/model/output-requirement-events.ts",
  "src/model/output-requirements.ts",
  "src/model/output-scope-amendment.ts",
  "src/model/output-source-policy.ts",
  "src/model/presentation-candidates.ts",
  "src/model/presentation-count-policy.ts",
  "src/model/presentation-delivery.ts",
  "src/model/presentation-source.ts",
  "src/model/prompt-policy.ts",
  "src/model/prompt-structures.ts",
  "src/model/provider-submission.ts",
  "src/model/reference-composition.ts",
  "src/model/reference-media.ts",
  "src/model/source-documents.ts",
  "src/model/spatial-scope.ts",
  "src/platform/capabilities.ts",
  "worker/access-policy.ts",
  "worker/assistant-context-source.ts",
  "worker/canvas-governance-policy.ts",
  "worker/context-authority.ts",
  "worker/context-package-source-selection.ts",
  "worker/event-privacy.ts",
  "worker/event-read-primitives.ts",
  "worker/event-stream-read.ts",
  "worker/event-write-primitives.ts",
  "worker/image-adapter-evaluation-evidence.ts",
  "worker/output-asset-storage-identity.ts",
  "worker/output-command-core.ts",
  "worker/output-disclosure-proof.ts",
  "worker/output-governance-witness.ts",
  "worker/output-read-model-producer.ts",
  "worker/output-read-state.ts",
  "worker/output-requirement-governance-assertions.ts",
  "worker/output-requirements-read-model.ts",
  "worker/output-requirements-snapshot.ts",
  "worker/output-revision.ts",
  "worker/output-source-evidence-capacity.ts",
  "worker/output-trusted-context.ts",
  "worker/policy-version.ts",
  "worker/principal-request-core.ts",
  "worker/project-request-context.ts",
  "worker/project-source-read.ts",
  "worker/source-reference-evidence.ts"
];
const fixtureBuiltins = {
  'tests/fixtures/output-producer-sqlite.mjs': ['node:assert/strict', 'node:crypto', 'node:sqlite'],
  'tests/fixtures/output-producer-storage.mjs': [],
};
assert.deepEqual(manifest.modules.map(entry => entry.path).sort(), [...modulePaths].sort());
assert.deepEqual(manifest.fixtures.map(entry => entry.path).sort(), Object.keys(fixtureBuiltins).sort());
assert.equal(Object.hasOwn(manifest, 'extensionlessEdges'), false);
const allowed = new Map(), fixtureFiles = new Map(), loadedFiles = new Set();
for (const entry of [...manifest.modules, ...manifest.fixtures]) {
  assert.match(entry.sha256, /^[a-f0-9]{64}$/u);
  const file = realpathSync(resolve(root, entry.path)), local = relative(root, file);
  assert.ok(!local.startsWith('..' + sep) && !isAbsolute(local));
  assert.ok(!allowed.has(file), 'No module-cache alias or duplicate reviewed path');
  assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), entry.sha256, `Changed reviewed source: ${entry.path}`);
  allowed.set(file, entry);
  if (Object.hasOwn(fixtureBuiltins, entry.path)) {
    assert.deepEqual(entry.builtins, fixtureBuiltins[entry.path], 'Exact fixture-only builtin closure');
    fixtureFiles.set(file, new Set(entry.builtins));
  }
}
const originalFetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
let forbiddenFetchAttempts = 0, fetchInstalled = false, fetchRestored = false, hookActive = false, hook;
function throwFailures(errors, message) {
  // Array membership preserves any thrown value, including undefined.
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, message);
}
function cleanupLoader(errors = []) {
  try {
    if (hookActive) { hook.deregister(); hookActive = false; }
  } catch (error) { errors.push(error); }
  try {
    if (fetchInstalled && !fetchRestored) {
      if (originalFetchDescriptor) Object.defineProperty(globalThis, 'fetch', originalFetchDescriptor);
      else delete globalThis.fetch;
      fetchRestored = true;
    }
  } catch (error) { errors.push(error); }
  return errors;
}
function cleanupLoaderAtExit() {
  throwFailures(cleanupLoader(), 'Producer loader exit cleanup failed');
}
function exactFile(url) {
  const parsed = new URL(url);
  assert.equal(parsed.protocol, 'file:');
  assert.equal(parsed.search, ''); assert.equal(parsed.hash, '');
  const file = realpathSync(fileURLToPath(parsed));
  assert.equal(pathToFileURL(file).href, url, 'One exact URL per loaded module; no aliases');
  return file;
}
const load = name => import(pathToFileURL(resolve(root, name)).href);
let readPrincipal, continueOutputTrustedContext, readOutputModel, discloseOutputJson, discloseOutputResponse;
let OutputConflictError, outputDigest, POLICY_VERSION, createOutputProducerSqlite, createOutputProducerStorage;
let inspectOutputRequirement, sourceDocumentEvidence, sourceDocumentEvidenceDigest, extractSourceDocument;
let ownerMediaNamespace, outputAssetObjectKeys, createReferenceComposition, addReferenceCompositionLayer, normalizeReferenceComposition;
let verifyReferenceCompositionAssets, buildSnapshot, compileOutputPlan;
try {
  // Own guard, hook, after-hook registration and initial imports in one setup.
  process.once('exit', cleanupLoaderAtExit);
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true,
    enumerable: originalFetchDescriptor?.enumerable ?? true,
    value() { forbiddenFetchAttempts++; throw Error('Network forbidden in producer qualification'); },
  });
  fetchInstalled = true;
  hook = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('node:')) {
        const parent = exactFile(context.parentURL);
        assert.ok(fixtureFiles.get(parent)?.has(specifier), `Forbidden runtime builtin: ${specifier}`);
        return nextResolve(specifier, context);
      }
      assert.ok(specifier.startsWith('file:') || specifier.startsWith('./') || specifier.startsWith('../'), `No package/protocol fallback: ${specifier}`);
      assert.ok(!specifier.includes('?') && !specifier.includes('#'));
      const file = specifier.startsWith('file:') ? exactFile(specifier)
        : realpathSync(resolve(dirname(fileURLToPath(context.parentURL)), specifier));
      assert.ok(allowed.has(file), `Unreviewed producer dependency: ${file}`);
      if (context.parentURL && context.parentURL !== import.meta.url) {
        const parent = exactFile(context.parentURL);
        assert.ok(allowed.has(parent));
        assert.ok(!fixtureFiles.has(file), 'Production/fixture modules cannot import fixture helpers');
      }
      return nextResolve(pathToFileURL(file).href, context);
    },
    load(url, context, nextLoad) {
      if (url.startsWith('node:')) {
        assert.ok(Object.values(fixtureBuiltins).some(names => names.includes(url)));
        return nextLoad(url, context);
      }
      const file = exactFile(url), entry = allowed.get(file);
      assert.ok(entry, `Unreviewed loaded producer source: ${file}`);
      const result = nextLoad(url, context), source = result.source;
      assert.ok(source !== undefined && source !== null);
      const bytes = typeof source === 'string' ? Buffer.from(source)
        : ArrayBuffer.isView(source) ? Buffer.from(source.buffer, source.byteOffset, source.byteLength) : Buffer.from(source);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, `Loaded bytes changed: ${entry.path}`);
      loadedFiles.add(entry.path);
      return result; // Exactly the returned bytes checked above; no second source read.
    },
  });
  hookActive = true;
  after(() => {
    const errors = [];
    try {
      assert.equal(forbiddenFetchAttempts, 0, 'Forbidden fetch attempts remain failures even if swallowed');
    } catch (error) { errors.push(error); }
    try {
      assert.deepEqual([...loadedFiles].sort(), [...modulePaths, ...Object.keys(fixtureBuiltins)].sort(), 'Actual loaded finite graph includes every selected path and no extras');
    } catch (error) { errors.push(error); }
    cleanupLoader(errors);
    throwFailures(errors, 'Producer loader verification and cleanup failed');
  });
  ({ readExistingPrincipalRequest: readPrincipal } = await load('worker/principal-request-core.ts'));
  ({ continueOutputTrustedContext } = await load('worker/output-trusted-context.ts'));
  ({ readOutputModel } = await load('worker/output-read-model-producer.ts'));
  ({ buildSnapshot } = await load('worker/output-requirements-snapshot.ts'));
  ({ compileOutputPlan } = await load('src/model/output-plan.ts'));
  ({ discloseOutputJson, discloseOutputResponse, outputDigest } = await load('worker/output-disclosure-proof.ts'));
  ({ OutputConflictError } = await load('worker/output-command-core.ts'));
  ({ POLICY_VERSION } = await load('worker/policy-version.ts'));
  ({ inspectOutputRequirement } = await load('src/model/output-requirements.ts'));
  ({ sourceDocumentEvidence, sourceDocumentEvidenceDigest, extractSourceDocument } = await load('src/model/source-documents.ts'));
  ({ ownerMediaNamespace } = await load('src/model/media-ownership.ts'));
  ({ outputAssetObjectKeys } = await load('worker/output-asset-storage-identity.ts'));
  ({ createReferenceComposition, addReferenceCompositionLayer, normalizeReferenceComposition } = await load('src/model/reference-composition.ts'));
  ({ verifyReferenceCompositionAssets } = await load('worker/source-reference-evidence.ts'));
  ({ createOutputProducerSqlite } = await load('tests/fixtures/output-producer-sqlite.mjs'));
  ({ createOutputProducerStorage } = await load('tests/fixtures/output-producer-storage.mjs'));
} catch (error) {
  throwFailures(cleanupLoader([error]), 'Producer loader setup and cleanup failed');
}
// Hooks and the fail-closed fetch guard remain installed throughout actual tests.

const PAST = '2000-01-01T00:00:00.000Z', FUTURE = '2999-01-01T00:00:00.000Z';
const OWNER = 'r11-author', PROJECT = 'r11-project', DOCUMENT = 'r11-document';
const SHARED = Object.freeze({ organizationId: 'r11-organization', projectAccessId: 'r11-access', contextId: 'r11-context' });
const SOURCE_TEXT = 'Local owned evidence: the botanical exhibit opens in October.';
const PRIVATE_MARKER = 'R11 private authored direction: botanical shapes';
const rawHash = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
  .map(value => value.toString(16).padStart(2, '0')).join('');
const authRequests = new WeakMap(), issuedTrusted = new WeakSet();

function delayResult(milliseconds, value) {
  let timer;
  const promise = new Promise(resolve => { timer = setTimeout(() => resolve(value), milliseconds); });
  return { promise, dispose() { clearTimeout(timer); } };
}
function track(h, work, label) {
  const pending = Promise.resolve().then(work);
  // Observe both branches immediately; late rejection must never become unhandled.
  const observed = pending.then(value => ({ kind: 'fulfilled', value }), error => ({ kind: 'rejected', error }));
  h.pending.add(observed);
  observed.then(() => h.pending.delete(observed));
  const timer = delayResult(5000, { kind: 'timeout' });
  return Promise.race([observed, timer.promise]).then(result => {
    if (result.kind === 'timeout') { h.sql.retire(); throw Error(`Producer fixture deadline: ${label}`); }
    if (result.kind === 'rejected') throw result.error;
    return result.value;
  }).finally(() => timer.dispose());
}
async function retireAndDrain(h) {
  // The drain itself is bounded even if real crypto or an earlier await stalls.
  // Retirement prevents a late production read from touching a closed database.
  const timer = delayResult(5000, false);
  try {
    const drained = await Promise.race([Promise.all([...h.pending]).then(() => true), timer.promise]);
    if (!drained) h.sql.retire();
    return drained;
  } finally { timer.dispose(); }
}
function fixture(t, { shared = false, pageSize = 1000 } = {}) {
  let sql, storage;
  function closeOwned(errors) {
    for (const dispose of [() => sql?.retire(), () => storage?.dispose(), () => sql?.close()]) {
      try { dispose(); } catch (error) { errors.push(error); }
    }
  }
  try {
    sql = createOutputProducerSqlite();
    storage = createOutputProducerStorage([], { pageSize });
    const h = { sql, storage, shared: shared ? SHARED : false, pending: new Set(), env: { DB: sql.DB, MEDIA: storage.MEDIA } };
    h.action = (work, label = 'actual action') => track(h, work, label);
    h.read = async (work, label = 'actual read') => {
      const errors = [];
      let before, stored, value;
      try { before = sql.snapshot(); } catch (error) { errors.push(error); }
      try { stored = storage.snapshot().records; } catch (error) { errors.push(error); }
      throwFailures(errors, 'Producer read baseline snapshots failed');
      try { value = await h.action(work, label); } catch (error) { errors.push(error); }
      try {
        if (!sql.state.retired) assert.deepEqual(sql.snapshot(), before, 'Production reader must not write, repair or replace fixture state');
      } catch (error) { errors.push(error); }
      try {
        assert.deepEqual(storage.snapshot().records, stored, 'Production reader must not mutate owned storage');
      } catch (error) { errors.push(error); }
      throwFailures(errors, 'Producer read and snapshot verification failed');
      return value;
    };
    t.after(async () => {
      const errors = [];
      try {
        const drained = await retireAndDrain(h);
        assert.equal(sql.state.forbiddenWrites, 0, 'A production SQL write was attempted even if swallowed');
        assert.equal(sql.state.reentrantAttempts, 0, 'No reentrant connection ownership escape');
        const counters = storage.snapshot().counts;
        for (const name of ['put', 'delete', 'copy', 'createMultipartUpload', 'resumeMultipartUpload', 'uploadPart', 'completeMultipartUpload', 'abortMultipartUpload']) {
          assert.equal(counters[name], 0, `Forbidden production storage action: ${name}`);
        }
        assert.equal(drained, true, 'Unsettled work was retired, not certified as completed');
      } catch (error) { errors.push(error); }
      finally { closeOwned(errors); }
      if (errors.length === 1) throw errors[0];
      if (errors.length) throw new AggregateError(errors, 'Producer fixture verification and cleanup failed');
    });
    h.principal = sql.seedPrincipal(POLICY_VERSION, { actorId: OWNER, ownerId: OWNER, projectId: PROJECT, shared: h.shared });
    return h;
  } catch (error) {
    // Own every handle even when storage construction, hook registration or
    // principal arrangement fails before this function returns to its caller.
    const errors = [error]; closeOwned(errors);
    if (errors.length === 1) throw error;
    throw new AggregateError(errors, 'Producer fixture setup and cleanup failed');
  }
}
function requestFor(h, { authenticated = true, shared = Boolean(h.shared) } = {}) {
  const headers = new Headers(authenticated ? h.principal.headers : {});
  if (shared) headers.set('cookie', `forma_project_context=${encodeURIComponent(SHARED.contextId)}`);
  return new Request(`https://qualification.invalid/api/output-requirements?documentId=${DOCUMENT}`, { headers });
}
async function loadTrusted(h, request = requestFor(h)) {
  const auth = await h.read(() => readPrincipal(request, h.env, 'viewer', { account: 'principal' }), 'actual R7 principal');
  authRequests.set(auth, request);
  assert.equal(Object.hasOwn(auth, 'kind'), false, 'Lifecycle-required is unqualified; never synthesize its completion');
  assert.equal(authRequests.get(auth), request);
  const trusted = await h.read(() => continueOutputTrustedContext(request, h.env, DOCUMENT, 'read', auth), 'actual R11 continuation');
  if (!(trusted instanceof Response)) {
    assert.equal(trusted.request, request); assert.equal(trusted.env, h.env); assert.equal(trusted.principal, auth.user);
    issuedTrusted.add(trusted);
  }
  return trusted;
}
async function liveTrusted(h) {
  const trusted = await loadTrusted(h);
  assert.equal(trusted instanceof Response, false);
  assert.ok(trusted.context); assert.equal(trusted.sourcePrivateCaptured, true);
  assert.deepEqual(trusted.sourceProblems, []);
  assert.equal(trusted.sourceEvidence.status, 'verified');
  assert.ok(trusted.context.snapshot.facts.length > 0);
  assert.ok(trusted.events.length > 0 && trusted.sourceAssertions.length > 0);
  return trusted;
}
function requirement(output, { snapshotPlan = false } = {}) {
  const label = output === 'image' ? 'Image' : 'Slides';
  const deliverable = { id: 'r11-deliverable', label, media_kind: output, required: true,
    quantity: { kind: 'exact', unit: output === 'image' ? 'image' : 'presentation', value: 1 },
    source_scope: { kind: 'document' }, coverage: { kind: 'document_context' }, original_text: label,
    value_origins: { quantity: { kind: 'authored' } } };
  if (output === 'slides') deliverable.content_quantity = { kind: 'exact', unit: 'slide', value: 5 };
  else deliverable.format_variants = [{ id: 'r11-format', label: '1:1', required: true,
    aspect_ratio: { width: 1, height: 1 }, quantity: { kind: 'exact', unit: 'image', value: 1 },
    placements: [], original_text: '1:1', value_origins: { aspect_ratio: { kind: 'authored' } } }];
  const spec = { schema_version: 1, id: 'r11-requirement', label, original_text: label,
    deliverables: [deliverable], value_origins: { deliverables: { kind: 'authored' } } };
  if (snapshotPlan) {
    // Declared synthetic authoring before persistence/authentication. Interpreted
    // wording is not fabricated confirmation, consent or a native plan receipt.
    spec.id = 'r11-output';
    spec.value_origins.interpretation_basis = { kind: 'interpreted', text: spec.original_text };
  }
  assert.equal(inspectOutputRequirement(spec).status, 'valid', 'Authored fixture must pass the actual requirement inspector');
  return spec;
}
async function sourceDocument(h) {
  const bytes = new TextEncoder().encode(SOURCE_TEXT), mime = 'text/plain';
  const key = `${ownerMediaNamespace(OWNER)}/r11-source.txt`;
  const contentHash = await h.action(() => rawHash(bytes), 'owned source hash');
  // Actual text extractor runs on these owned bytes, not a prepared extraction DTO.
  const extraction = await h.action(() => extractSourceDocument({ type: mime, name: 'r11-source.txt', size: bytes.byteLength,
    text: async () => new TextDecoder().decode(bytes), arrayBuffer: async () => bytes.slice().buffer }), 'actual local text extraction');
  assert.equal(extraction.status, 'ready');
  const evidence = sourceDocumentEvidence(extraction, contentHash, mime);
  const evidenceHash = await h.action(() => sourceDocumentEvidenceDigest(evidence), 'actual source evidence digest');
  const properties = { reference_id: 'r11-reference', label: 'Owned source', text: extraction.text,
    media_url: `/api/media/${encodeURIComponent(key)}`, media_type: mime, rights_class: 'owned',
    source_mime_type: mime, source_content_hash: contentHash, source_evidence_hash: evidenceHash,
    extraction_status: extraction.status, source_kind: extraction.sourceKind,
    source_citations: evidence.citations, source_segment_count: evidence.segmentCount,
    source_excerpt_truncated: evidence.truncated };
  h.storage.set({ key, bytes, customMetadata: { ownerId: OWNER, mimeType: mime, sha256: contentHash,
    sourceEvidenceSha256: evidenceHash, rights: 'asserted' }, httpMetadata: { contentType: mime } });
  return { key, bytes, properties };
}
async function setupSource(t, { shared = false, output = shared ? 'slides' : 'image', pageSize, snapshotPlan = false } = {}) {
  const h = fixture(t, { shared, pageSize }), source = await sourceDocument(h);
  const spec = requirement(output, { snapshotPlan }), direction = { id: 'r11-direction', type: 'style', properties: { text: PRIVATE_MARKER } };
  const governed = shared ? h.sql.seedSharedDecisionPackage({ shared: SHARED, projectId: PROJECT, documentId: DOCUMENT,
    blockId: direction.id, type: direction.type, properties: direction.properties }) : null;
  const blocks = [governed ? { id: governed.id, type: governed.type, properties: governed.properties } : direction,
    { id: 'r11-source', type: 'reference', properties: source.properties },
    { id: 'r11-output', type: 'output', properties: { text: output === 'image' ? 'One image, 1:1' : 'One presentation, exactly five slides', subtype: output === 'image' ? 'Image' : 'Slides', output_spec: spec } }];
  const seeded = h.sql.seedDocument({ ownerId: OWNER, projectId: PROJECT, documentId: DOCUMENT, blocks, shared: h.shared,
    extraEvents: [{ eventId: 'r11-rights', type: 'RightsAsserted', payload: { project_id: PROJECT, document_id: DOCUMENT,
      reference_id: source.properties.reference_id, rights_class: 'owned' } }] });
  Object.assign(h, { source, spec, governed, seeded, output });
  if (snapshotPlan) h.snapshotPlan = true;
  const trusted = await liveTrusted(h);
  assert.equal(trusted.scope.kind, shared ? 'project' : 'personal');
  assert.ok(trusted.context.snapshot.facts.some(fact => fact.properties?.text === PRIVATE_MARKER));
  assert.equal(trusted.requirements.length, 1);
  assert.deepEqual(trusted.requirements[0].spec, spec);
  return { h, trusted };
}

// Synthetic HISTORICAL records only. No command/admission/inspection/provider
// runs create these rows. Actual producer reads, matches and captures them.
async function seedHistory(h, sourceTrusted, { amendmentReason } = {}) {
  assert.ok(issuedTrusted.has(sourceTrusted));
  const scope = sourceTrusted.scope, ids = { plan: 'r11-plan-revision', asset: 'r11-asset', result: 'r11-result',
    target: 'r11-target', acceptance: 'r11-acceptance', preflight: 'r11-preflight', grant: 'r11-historical-grant', slot: 'r11-historical-slot' };
  let compiledPlan = null;
  if (h.snapshotPlan) {
    const rows = sourceTrusted.requirements;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'valid'); assert.ok(rows[0].spec);
    assert.equal(rows[0].spec.id, rows[0].blockId, 'Persisted requirement identity is aligned before the genuine producer read');
    compiledPlan = await h.read(() => compileOutputPlan(rows.map(row => row.spec), {
      document_id: sourceTrusted.scope.documentId, source_revision: sourceTrusted.sourceDigest,
      requirement_revision: sourceTrusted.requirementsDigest, max_targets: 1000,
    }), 'actual finite snapshot plan compilation');
    assert.deepEqual(compiledPlan.issues, []); assert.deepEqual(compiledPlan.unresolved_groups, []);
    assert.equal(compiledPlan.groups.length, 1); assert.equal(compiledPlan.obligations.length, 1);
    assert.equal(compiledPlan.targets.length, 1);
    assert.equal(compiledPlan.groups[0].requirement_id, rows[0].blockId);
    ids.target = compiledPlan.targets[0].id; // Exact compiler identity; no normalization or replacement.
  }
  if (amendmentReason !== undefined) assert.ok(compiledPlan, 'Historical amendment arrangement is snapshot opt-in only');
  const mime = h.output === 'image' ? 'image/png' : 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  const extension = h.output === 'image' ? 'png' : 'pptx';
  // Deliberately non-renderable owned marker bytes; no generated quality or real
  // inspection is claimed by the historical retained inspection fixture.
  const bytes = new TextEncoder().encode(`R11 owned historical ${h.output} artifact marker`);
  const hash = await h.action(() => rawHash(bytes), 'owned historical artifact hash');
  const storageKey = outputAssetObjectKeys(scope, ids.asset, hash, extension).key;
  h.storage.set({ key: storageKey, bytes, customMetadata: { outputRequirementAsset: '1', ownerId: OWNER,
    projectId: PROJECT, documentId: DOCUMENT, assetId: ids.asset, scopeKey: scope.key, sha256: hash }, httpMetadata: { contentType: mime } });
  const target = compiledPlan?.targets[0] ?? { id: ids.target, label: h.output === 'image' ? 'Image' : 'Five slides', media_kind: h.output,
    source_scope: { kind: 'document' }, quantity: h.spec.deliverables[0].quantity,
    ...(h.output === 'slides' ? { content_quantity: h.spec.deliverables[0].content_quantity } : { aspect_ratio: { width: 1, height: 1 } }) };
  const contractDigest = await h.action(() => outputDigest({ target, sourceDigest: sourceTrusted.sourceDigest }), 'fixture historical contract digest');
  const plan = { revisionId: ids.plan, sourceDigest: sourceTrusted.sourceDigest,
    requirementsDigest: sourceTrusted.requirementsDigest, plan: compiledPlan ?? { targets: [target] },
    ...(compiledPlan ? { targetContractDigests: { [ids.target]: contractDigest } } : {}) };
  const event = (name, type, payload) => h.sql.appendEvent({ ownerId: OWNER, projectId: PROJECT, documentId: DOCUMENT,
    eventId: name, type, payload: { project_id: PROJECT, document_id: DOCUMENT, ...payload }, shared: h.shared });
  event('r11-confirmed-event', 'OutputPlanConfirmed', { confirmed_plan: plan,
    ...(compiledPlan ? { plan_revision_id: ids.plan, actor_user_id: scope.actorUserId } : {}),
    ...(amendmentReason === undefined ? {} : { scope_amendment: {
      previous_plan_revision_id: 'r12-previous-plan-revision', reason: amendmentReason,
      withdrawn_target_ids: [], withdrawn_obligation_ids: [],
    } }),
  });
  const inspection = { status: 'inspected', sha256: hash, byteLength: bytes.byteLength, mimeType: mime };
  const asset = { id: ids.asset, name: 'Historical marker', inspection, origin: { kind: 'uploaded', createdByUserId: OWNER } };
  event('r11-asset-event', 'OutputAssetAdopted', { asset });
  const candidate = { id: ids.result, assetId: ids.asset, targetId: ids.target, sha256: hash,
    resultRevision: 'r11-result-revision', targetContractDigest: contractDigest,
    sourceDigest: sourceTrusted.sourceDigest, checks: ['historical fixture'], problems: [] };
  event('r11-bound-event', 'OutputResultBound', { result: candidate });
  event('r11-approved-event', 'OutputTargetAccepted', { result_id: ids.result, target_id: ids.target,
    acceptance_id: ids.acceptance, content_sha256: hash, result_revision: candidate.resultRevision,
    target_contract_digest: contractDigest, source_digest: sourceTrusted.sourceDigest,
    reviewed_coverage: true, reviewed_rights: true });
  event('r11-preflight-event', 'OutputPlanPreflighted', { preflight: { historicalFixture: true } });
  event('r11-authorization-event', 'OutputExecutionAuthorized', { grant_id: ids.grant, historicalFixture: true });
  event('r11-eligibility-event', 'OutputFulfillmentSelected', { target_id: ids.target, acceptance_id: ids.acceptance, plan_revision_id: ids.plan });
  const insert = (table, values) => h.sql.insert(table, values);
  insert('output_plan_revisions', { scope_key: scope.key, scope_kind: scope.kind, owner_user_id: OWNER,
    project_id: PROJECT, document_id: DOCUMENT, organization_id: scope.organizationId, project_access_id: scope.projectAccessId,
    plan_revision_id: ids.plan, plan_id: 'r11-plan', revision: 1, confirmed_event_id: 'r11-confirmed-event',
    requirements_digest: sourceTrusted.requirementsDigest, source_digest: sourceTrusted.sourceDigest,
    resolver_version: 'historical-fixture', source_head: sourceTrusted.ownerHead, target_count: 1, created_at: PAST });
  insert('output_assets', { scope_key: scope.key, asset_id: ids.asset, document_id: DOCUMENT, owner_user_id: OWNER,
    created_by_user_id: OWNER, source_digest: sourceTrusted.sourceDigest, storage_key: storageKey,
    content_sha256: hash, byte_length: bytes.byteLength, mime_type: mime, media_kind: h.output,
    created_event_id: 'r11-asset-event', created_at: PAST, redacted_at: null });
  insert('output_results', { scope_key: scope.key, result_id: ids.result, document_id: DOCUMENT,
    plan_revision_id: ids.plan, target_id: ids.target, target_contract_digest: contractDigest,
    source_digest: sourceTrusted.sourceDigest, asset_id: ids.asset, result_revision: candidate.resultRevision,
    content_sha256: hash, validation_policy: 'historical-fixture', checks_status: 'passed',
    created_by_user_id: OWNER, bound_event_id: 'r11-bound-event', created_at: PAST });
  insert('output_target_acceptances', { scope_key: scope.key, acceptance_id: ids.acceptance, result_id: ids.result,
    target_id: ids.target, result_revision: candidate.resultRevision, content_sha256: hash,
    target_contract_digest: contractDigest, source_digest: sourceTrusted.sourceDigest, validation_policy: 'historical-fixture',
    approval_event_id: 'r11-approved-event', created_at: PAST });
  insert('output_preflights', { scope_key: scope.key, preflight_id: ids.preflight, event_id: 'r11-preflight-event' });
  insert('output_execution_grants', { scope_key: scope.key, grant_id: ids.grant, plan_revision_id: ids.plan,
    actor_user_id: OWNER, payer_user_id: OWNER, context_id: scope.contextId, preflight_id: ids.preflight,
    authorization_event_id: 'r11-authorization-event', maximum_microusd: 100, maximum_calls: 3,
    status: 'expired', expires_at: PAST, created_at: PAST });
  insert('output_operation_slots', { scope_key: scope.key, slot_id: ids.slot, grant_id: ids.grant,
    plan_revision_id: ids.plan, target_id: ids.target, target_contract_digest: contractDigest,
    source_digest: sourceTrusted.sourceDigest, provider: 'historical-inert', model: 'historical-inert', route_digest: contractDigest,
    job_id: 'historical-unavailable-job', cost_reservation_id: null, token_reservation_id: null,
    maximum_microusd: 100, maximum_calls: 3, maximum_tokens: 0, attempt_ordinal: 1,
    previous_slot_id: null, status: 'expired', outcome_event_id: null, created_at: PAST, updated_at: PAST });
  insert('output_provider_calls', { scope_key: scope.key, slot_id: ids.slot, call_key: 'r11-historical-used',
    used_microusd: 7, reserved_microusd: 9, status: 'complete' });
  insert('output_provider_calls', { scope_key: scope.key, slot_id: ids.slot, call_key: 'r11-historical-pending',
    used_microusd: null, reserved_microusd: 11, status: 'uncertain' });
  insert('output_plan_fulfillments', { scope_key: scope.key, plan_revision_id: ids.plan, target_id: ids.target,
    acceptance_id: ids.acceptance, eligibility_event_id: 'r11-eligibility-event', checked_at: PAST });
  Object.assign(h, { ids, artifact: { bytes, hash, mime, key: storageKey }, sourceDigest: sourceTrusted.sourceDigest });
  if (compiledPlan) h.compiledPlan = compiledPlan;
  const trusted = await liveTrusted(h); // Fresh real principal/continuation; no map or scope transfer.
  assert.notEqual(trusted, sourceTrusted); assert.notEqual(trusted.scope, sourceTrusted.scope);
  assert.equal(trusted.sourceDigest, sourceTrusted.sourceDigest);
  assert.equal(trusted.requirementsDigest, sourceTrusted.requirementsDigest);
  return trusted;
}
async function setupHistory(t, options = {}) {
  const { h, trusted: source } = await setupSource(t, options);
  const trusted = await seedHistory(h, source);
  return { h, trusted };
}
async function modelFor(h, trusted) {
  assert.ok(issuedTrusted.has(trusted));
  const model = await h.read(() => readOutputModel(trusted), 'actual retained model');
  return model;
}
async function disclose(h, trusted, model) {
  assert.ok(issuedTrusted.has(trusted));
  // A bounded fixture response projection of ACTUAL returned values. This tests
  // the real final proof/formatter, not canonical buildSnapshot/HTTP routing.
  return h.read(() => discloseOutputJson(trusted, { sourceDigest: trusted.sourceDigest,
    asset: model.assets[0]?.id, available: model.assets[0]?.available, result: model.results[0]?.id,
    review: model.results[0]?.review, grant: model.grants[0]?.id }), 'actual final disclosure');
}
const conflict = (code, status) => error => error instanceof OutputConflictError && error.code === code && error.status === status;

test('personal Image: actual Request, source evidence, retained model, pending identity and final disclosure', async t => {
  const { h, trusted } = await setupHistory(t);
  const beforeBatches = h.sql.state.batches;
  let original;
  const model = await h.read(() => {
    original = readOutputModel(trusted);
    assert.equal(readOutputModel(trusted), original, 'Exact original pending Promise, not an async adopting wrapper');
    return original;
  });
  assert.equal(readOutputModel(trusted), original);
  assert.equal(h.sql.state.batches - beforeBatches, 1, 'Boundary-observed model batch count');
  assert.equal(model.databaseBindingCalls, 1); assert.equal(model.complete, true);
  assert.equal(model.assets.length, 1); assert.equal(model.assets[0].available, true);
  assert.equal(model.results.length, 1); assert.equal(model.results[0].review, 'approved');
  assert.equal(model.results[0].reviewAllowed, true); assert.equal(model.results[0].independentReviewBlocked, false);
  assert.equal(model.plans.size, 1); assert.equal(model.confirmedPlan.revisionId, h.ids.plan);
  assert.ok(model.assertions.length > 0);
  assert.equal(model.fulfillments.get(h.ids.plan).get(h.ids.target), h.ids.acceptance);
  assert.equal(model.grants.length, 1);
  assert.equal(model.grants[0].status, 'expired', 'Historical fixture never creates current dispatch authority');
  assert.deepEqual([model.grants[0].usedMicrousd, model.grants[0].exposedMicrousd, model.grants[0].usedCalls, model.grants[0].pendingCalls], [7, 11, 2, 1]);
  assert.equal(model.grants[0].operations.length, 1);
  const calls = h.storage.snapshot().calls;
  assert.ok(calls.some(call => call.operation === 'head' && call.arguments.key === h.source.key));
  assert.ok(calls.some(call => call.operation === 'list' && call.arguments.prefix === `output-requirements/${OWNER}/${PROJECT}/${DOCUMENT}/`));
  assert.equal(h.storage.snapshot().counts.get, 0, 'Ordinary document metadata evidence does not read source bytes here');
  const response = await disclose(h, trusted, model);
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  const body = await h.action(() => response.text(), 'response encoding');
  assert.equal(JSON.parse(body).asset, h.ids.asset);
  assert.equal(body.includes(PRIVATE_MARKER), false);
  assert.equal(body.includes('private_json'), false);
  // This explicit fixture projection is not a proof that arbitrary caller DTOs
  // are sanitized by the formatter or that canonical buildSnapshot ran.
});

test('shared exact-five Slides: real selected context and nonempty immutable organization decision governance', async t => {
  const { h, trusted } = await setupHistory(t, { shared: true });
  assert.equal(trusted.projectContext.contextId, SHARED.contextId);
  assert.ok(trusted.governanceWitness);
  assert.ok(trusted.sourceAssertions.some(item => item.sql.includes('project_context_package_members')));
  assert.ok(trusted.sourceAssertions.some(item => item.sql.includes('organization_context_package_contents')));
  assert.deepEqual(trusted.requirements[0].spec.deliverables[0].content_quantity, { kind: 'exact', unit: 'slide', value: 5 });
  const model = await modelFor(h, trusted);
  assert.equal(model.complete, true); assert.equal(model.assets[0].available, true);
  assert.equal(model.results[0].review, 'approved', 'Stored historical review and present contributor eligibility are distinct');
  assert.equal(model.results[0].reviewAllowed, false);
  assert.equal(model.results[0].independentReviewBlocked, true, 'Real shared rule rejects same contributor, not a fake capability callback');
  assert.equal((await disclose(h, trusted, model)).status, 200);
  // Nonempty organization-owned decision lineage is covered. This does not
  // execute licensed-origin reconstruction, package publication or mini-app
  // personal-custody admission; the production shared graph is not specialized.
});

test('genuine principal denial is forwarded; lifecycle-required is never normalized into continuation success', async t => {
  const { h } = await setupSource(t);
  const request = requestFor(h, { authenticated: false, shared: false });
  const denied = await h.read(() => readPrincipal(request, h.env, 'viewer', { account: 'principal' }));
  assert.ok(denied.response instanceof Response);
  const before = h.sql.state.reads.length;
  const result = await h.read(() => continueOutputTrustedContext(request, h.env, DOCUMENT, 'read', denied));
  assert.equal(result, denied.response); assert.equal(result.status, 401);
  assert.equal(h.sql.state.reads.length, before, 'Denied result does not reach context/source readers');
  h.sql.mutate('DELETE FROM users WHERE user_id=?', OWNER);
  const missing = await h.read(() => readPrincipal(requestFor(h), h.env, 'viewer', { account: 'principal' }));
  assert.equal(missing.kind, 'lifecycle-required');
  assert.equal(Object.hasOwn(missing, 'user'), false);
  assert.equal(Object.hasOwn(missing, 'response'), false);
  // Deliberately no continuation call with this disjoint lifecycle result.
});

test('source private owner/custody mismatches stay loader problems and cannot pass mandatory private disclosure', async t => {
  for (const column of ['owner_id', 'document_id']) {
    const { h } = await setupSource(t);
    const eventId = h.seeded.blockEventIds['r11-direction'];
    h.sql.mutate(`UPDATE event_private_payloads SET ${column}=? WHERE private_event_id=?`, 'wrong-scope', eventId);
    const trusted = await loadTrusted(h);
    assert.equal(trusted instanceof Response, false);
    assert.equal(trusted.sourcePrivateCaptured, false);
    assert.ok(trusted.sourceProblems.includes('output_source_private_evidence_unavailable'));
    let prepared = false;
    await assert.rejects(h.read(() => discloseOutputResponse(trusted, () => { prepared = true; return { body: 'unreachable', init: {} }; })),
      conflict('output_private_evidence_unavailable', 410));
    assert.equal(prepared, false);
  }
});

test('final proof preserves authority403 before retained/model410 before source-head409', async t => {
  for (const level of ['authority', 'private', 'head']) {
    const { h, trusted } = await setupHistory(t);
    const model = await modelFor(h, trusted);
    h.sql.appendEvent({ ownerId: OWNER, projectId: PROJECT, documentId: DOCUMENT, eventId: 'r11-new-head',
      type: 'DocumentRenamed', payload: { new_title: 'Changed source title' }, shared: false });
    if (level !== 'head') h.sql.mutate('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?',
      JSON.stringify({ project_id: PROJECT, document_id: DOCUMENT, replaced: true }), 'r11-asset-event');
    if (level === 'authority') h.sql.mutate('UPDATE users SET consent_version=NULL WHERE user_id=?', OWNER);
    const expected = level === 'authority' ? ['output_execution_authority_revoked', 403]
      : level === 'private' ? ['output_private_evidence_unavailable', 410] : ['output_source_changed_during_read', 409];
    await assert.rejects(disclose(h, trusted, model), conflict(...expected));
  }
});

test('model metadata and aggregate changes are actual retained-model assertions in the410 proof segment', async t => {
  for (const mutation of ['asset', 'cost']) {
    const { h, trusted } = await setupHistory(t), model = await modelFor(h, trusted);
    if (mutation === 'asset') h.sql.mutate('UPDATE output_assets SET byte_length=byte_length+1 WHERE asset_id=?', h.ids.asset);
    else h.sql.mutate('UPDATE output_provider_calls SET used_microusd=8 WHERE call_key=?', 'r11-historical-used');
    await assert.rejects(disclose(h, trusted, model), conflict('output_private_evidence_unavailable', 410));
  }
});

test('shared selected-session revocation and captured nonempty governance change fail their actual proof segments', async t => {
  for (const mutation of ['session', 'binding']) {
    const { h, trusted } = await setupHistory(t, { shared: true }), model = await modelFor(h, trusted);
    if (mutation === 'session') h.sql.mutate('UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?', PAST, SHARED.contextId);
    else h.sql.mutate('UPDATE project_context_package_bindings SET status=? WHERE binding_id=?', 'revoked', h.governed.bindingId);
    await assert.rejects(disclose(h, trusted, model), mutation === 'session'
      ? conflict('output_execution_authority_revoked', 403) : conflict('output_source_changed_during_read', 409));
  }
});

test('actual storage absence and custody mismatch before model acquisition do not become available assets', async t => {
  for (const mutation of ['absent', 'owner', 'mime', 'bytes']) {
    const { h, trusted } = await setupHistory(t);
    if (mutation === 'absent') h.storage.remove(h.artifact.key);
    else {
      const record = h.storage.snapshot().records.find(record => record.key === h.artifact.key);
      if (mutation === 'owner') record.customMetadata.ownerId = 'wrong-owner';
      if (mutation === 'mime') record.httpMetadata.contentType = 'text/plain';
      if (mutation === 'bytes') record.bytes = new Uint8Array(record.bytes.length + 1);
      h.storage.set(record);
    }
    const model = await modelFor(h, trusted);
    assert.equal(model.custody.complete, true, 'Exhausted inventory proves coverage, not existence or matching custody');
    assert.equal(model.assets[0].available, false);
    assert.equal(model.complete, true, 'Complete model is not successful generation/delivery');
    assert.equal((await disclose(h, trusted, model)).status, 200);
  }
});

test('default eight-page inventory limit refuses incomplete coverage without dropping the retained asset', async t => {
  const { h, trusted } = await setupHistory(t, { pageSize: 1 });
  const prefix = `output-requirements/${OWNER}/${PROJECT}/${DOCUMENT}/`;
  for (let index = 0; index < 9; index++) h.storage.set({ key: `${prefix}a-unrelated-${index}.png`, bytes: new Uint8Array([index]) });
  const before = h.storage.snapshot().counts.list;
  const model = await modelFor(h, trusted);
  assert.equal(h.storage.snapshot().counts.list - before, 8);
  assert.equal(model.complete, false); assert.ok(model.reasonCodes.includes('output_custody_inventory_incomplete'));
  assert.equal(model.assets.length, 1); assert.equal(model.assets[0].available, false);
  assert.equal(model.results[0].reviewAllowed, false);
  // Selected wrapper uses the default. No invalid maximumPages override is
  // clamped or exercised here; the generic helper caveat stays unchanged.
});

test('actual legacy identity uses exact HEAD and keeps a missing object unavailable', async t => {
  for (const missing of [false, true]) {
    const { h, trusted } = await setupHistory(t);
    const legacy = outputAssetObjectKeys(trusted.scope, h.ids.asset, h.artifact.hash, h.output === 'image' ? 'png' : 'pptx').legacyKey;
    assert.ok(legacy);
    h.sql.mutate('UPDATE output_assets SET storage_key=? WHERE asset_id=?', legacy, h.ids.asset);
    const record = h.storage.snapshot().records.find(record => record.key === h.artifact.key);
    h.storage.remove(h.artifact.key);
    if (!missing) h.storage.set({ ...record, key: legacy });
    const before = h.storage.snapshot().counts;
    const model = await modelFor(h, trusted), after = h.storage.snapshot().counts;
    assert.equal(after.head - before.head, 1); assert.equal(after.list - before.list, 0);
    assert.equal(model.custody.complete, true); assert.equal(model.assets[0].available, !missing);
  }
});

test('rejected model retains original Promise and original parsing error without replacement reads', async t => {
  const { h, trusted } = await setupHistory(t);
  h.sql.mutate('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?', '{not-json', 'r11-asset-event');
  const before = h.sql.state.batches;
  let original, failure;
  await assert.rejects(h.read(() => {
    original = readOutputModel(trusted);
    assert.equal(readOutputModel(trusted), original);
    return original;
  }), error => { failure = error; return error instanceof SyntaxError; });
  assert.equal(readOutputModel(trusted), original);
  await assert.rejects(h.read(() => readOutputModel(trusted)), error => error === failure);
  await assert.rejects(h.read(() => discloseOutputJson(trusted, { historical: true })), error => error === failure);
  assert.equal(h.sql.state.batches - before, 1, 'No new model, read or error normalization after retained rejection');
});

test('unavailable current source evidence is reported without pretending retained-history reads are forbidden', async t => {
  const { h } = await setupHistory(t);
  const source = h.storage.snapshot().records.find(record => record.key === h.source.key);
  source.customMetadata.sourceEvidenceSha256 = '0'.repeat(64); h.storage.set(source);
  const trusted = await loadTrusted(h);
  assert.equal(trusted instanceof Response, false); assert.equal(trusted.sourcePrivateCaptured, true);
  assert.equal(trusted.sourceEvidence.status, 'unavailable');
  assert.ok(trusted.sourceProblems.includes('context_source_evidence_unavailable'));
  const model = await modelFor(h, trusted);
  assert.equal((await disclose(h, trusted, model)).status, 200, 'Retained history is not certification of currently verified source evidence');
});

test('real composition helper GET/hash is separate from the unchanged full-loader nested-key refusal', async t => {
  const { h } = await setupHistory(t);
  const nestedKey = `${ownerMediaNamespace(OWNER)}/r11-nested.png`, compositionKey = `${ownerMediaNamespace(OWNER)}/r11-composition.png`;
  const nestedBytes = new TextEncoder().encode('Owned synthetic composition source, not image-quality evidence');
  const compositionBytes = new TextEncoder().encode('Owned synthetic composition receipt, not rendered pixels');
  const nestedHash = await h.action(() => rawHash(nestedBytes)), compositionHash = await h.action(() => rawHash(compositionBytes));
  const recipe = normalizeReferenceComposition(addReferenceCompositionLayer(createReferenceComposition('1:1'), {
    id: 'r11-composition-input', blockId: 'r11-nested', label: 'Owned source',
    mediaUrl: `/api/media/${encodeURIComponent(nestedKey)}`, contentHash: nestedHash, kind: 'image',
  }, 'r11-layer'));
  assert.ok(recipe);
  const recipeHash = await h.action(() => rawHash(new TextEncoder().encode(JSON.stringify(recipe))));
  h.storage.set({ key: nestedKey, bytes: nestedBytes, customMetadata: { ownerId: OWNER, rights: 'asserted' }, httpMetadata: { contentType: 'image/png' } });
  h.storage.set({ key: compositionKey, bytes: compositionBytes, customMetadata: { ownerId: OWNER,
    mimeType: 'image/png', rights: 'asserted', sha256: compositionHash,
    referenceCompositionVersion: '1', referenceCompositionSha256: recipeHash }, httpMetadata: { contentType: 'image/png' } });
  const properties = { reference_id: 'r11-composition-reference', label: 'Owned composition',
    media_url: `/api/media/${encodeURIComponent(compositionKey)}`, media_type: 'image/png',
    source_content_hash: compositionHash, reference_composition: recipe, extraction_status: 'ready' };
  const before = h.storage.snapshot().counts;
  assert.equal(await h.read(() => verifyReferenceCompositionAssets(h.env, OWNER, properties), 'actual direct composition evidence helper'), true);
  const after = h.storage.snapshot().counts;
  assert.equal(after.get - before.get, 1, 'Actual missing-hash fallback consumes the same owned bytes');
  assert.ok(after.head - before.head >= 2);
  h.sql.appendEvent({ ownerId: OWNER, projectId: PROJECT, documentId: DOCUMENT, type: 'BlockCreated', eventId: 'r11-composition-block',
    payload: { block_id: 'r11-composition', type: 'reference', properties, position: 'z' } });
  h.sql.appendEvent({ ownerId: OWNER, projectId: PROJECT, documentId: DOCUMENT, type: 'RightsAsserted', eventId: 'r11-composition-rights',
    payload: { reference_id: properties.reference_id, rights_class: 'owned' } });
  const beforeLoaderGet = h.storage.snapshot().counts.get;
  const trusted = await loadTrusted(h);
  assert.equal(trusted instanceof Response, false);
  assert.equal(trusted.sourceEvidence.status, 'unavailable');
  assert.ok(trusted.sourceProblems.includes('context_source_evidence_unavailable'));
  assert.equal(h.storage.snapshot().counts.get, beforeLoaderGet, 'Nested source outside actual extracted-reference key set is not acquired');
  // This direct helper success proves neither a verified full-loader GET path,
  // real pixel inspection, generated quality, download nor provider execution.
});

test('actual SQL and response preparation exceptions propagate rather than produce replacement success', async t => {
  const { h, trusted } = await setupHistory(t), model = await modelFor(h, trusted);
  const prepareFailure = new Error('Fixture response preparation failure');
  await assert.rejects(h.read(() => discloseOutputResponse(trusted, () => { throw prepareFailure; })), error => error === prepareFailure);
  h.sql.mutate('ALTER TABLE output_plan_fulfillments RENAME COLUMN eligibility_event_id TO removed_evidence_id');
  await assert.rejects(disclose(h, trusted, model), error => /no such column/iu.test(String(error?.message)));
});


// R12 only: actual canonical snapshot composition, not a replacement DTO.
async function snapshotFor(h, trusted) {
  const model = await modelFor(h, trusted);
  const original = readOutputModel(trusted); // Already observed/settled by modelFor.
  const beforeBatches = h.sql.state.batches;
  const snapshot = await h.read(() => buildSnapshot(trusted), 'actual canonical snapshot');
  assert.equal(readOutputModel(trusted), original, 'Snapshot uses the same actual cached model binding');
  assert.equal(h.sql.state.batches, beforeBatches, 'Snapshot does not replace the model read');
  return { model, snapshot }; // The snapshot value is the actual production return.
}
async function discloseSnapshot(h, trusted, snapshot) {
  assert.ok(issuedTrusted.has(trusted));
  const response = await h.read(() => discloseOutputJson(trusted, snapshot), 'actual canonical snapshot disclosure');
  const text = await h.action(() => response.text(), 'canonical snapshot response body');
  return { response, text, body: JSON.parse(text) };
}

test('snapshot: personal Image response and specific internal omissions', async t => {
  const { h, trusted: source } = await setupSource(t, { snapshotPlan: true });
  const empty = await snapshotFor(h, source);
  assert.equal(empty.snapshot.confirmedPlan, null); assert.equal(empty.snapshot.summary, null);
  assert.deepEqual(empty.snapshot.targetStates, []);
  assert.equal(empty.snapshot.requirementFileCounts[h.spec.id], null);
  const emptyResponse = await discloseSnapshot(h, source, empty.snapshot);
  assert.equal(emptyResponse.response.status, 200);
  assert.equal(emptyResponse.body.confirmedPlan, null);

  const trusted = await seedHistory(h, source);
  const { model, snapshot } = await snapshotFor(h, trusted);
  assert.equal(snapshot.confirmedPlan, model.confirmedPlan);
  assert.deepEqual(snapshot.confirmedPlan.plan, h.compiledPlan);
  assert.deepEqual(snapshot.confirmedPlan.plan.targets[0].aspect_ratio, { width: 1, height: 1 });
  const target = snapshot.targetStates[0];
  assert.equal(target.target_id, h.ids.target);
  assert.equal(target.result_id, h.ids.result);
  assert.equal(target.freshness, 'current'); assert.equal(target.availability, 'available');
  assert.equal(target.review, 'accepted'); assert.equal(target.export_available, true);
  assert.equal(snapshot.summary.completion, 'complete'); assert.equal(snapshot.summary.delivery_ready, true);
  assert.equal(snapshot.requirementSummaries[h.spec.id].scope_known, true);
  assert.equal(snapshot.requirementFileCounts[h.spec.id], 1);
  assert.equal(snapshot.capabilities.nativeGeneration, false, 'No bridge is supplied or invoked');
  assert.ok(snapshot.capabilities.limitationCodes.includes('output_native_execution_unavailable'));
  const { response, body, text } = await discloseSnapshot(h, trusted, snapshot);
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(body.revision, `output:${trusted.ownerHead}`);
  assert.equal(body.sourceRevision, trusted.sourceDigest);
  assert.equal(body.requirementRevision, trusted.requirementsDigest);
  assert.equal(body.scope.actorUserId, trusted.scope.actorUserId);
  assert.equal(body.requirements[0].spec.original_text, h.spec.original_text, 'Authored requirement content is legitimate public snapshot content');
  assert.equal(body.confirmedPlan.targetContractDigests[h.ids.target], body.results[0].targetContractDigest);
  assert.equal(Object.hasOwn(body.sourceVerification, 'governance'), false, 'Personal undefined governance is omitted by actual JSON encoding');
  for (const name of ['request', 'env', 'events', 'projection', 'context', 'sourceAssertions', 'sourcePrivateCaptured', 'governanceWitness']) {
    assert.equal(Object.hasOwn(body, name), false, `Named internal field is not part of the snapshot: ${name}`);
  }
  assert.equal(text.includes(PRIVATE_MARKER), false, 'The fixture private direction is not a projected source label or requirement');
  // Complete is the current projection of explicitly synthetic retained history,
  // not a native confirmation, real inspection/approval, rendered file or delivery.
});

test('snapshot: shared exact-five Slides response and contributor restriction', async t => {
  const { h, trusted } = await setupHistory(t, { shared: true, snapshotPlan: true });
  const { model, snapshot } = await snapshotFor(h, trusted);
  assert.ok(trusted.governanceWitness);
  assert.equal(snapshot.scope.kind, 'project'); assert.equal(snapshot.scope.projectAccessId, SHARED.projectAccessId);
  assert.equal(snapshot.permissions.independentReview, true);
  assert.equal(snapshot.permissions.canAuthor, true); assert.equal(snapshot.permissions.canReview, true);
  assert.equal(snapshot.results[0].review, 'approved', 'Historical review is not a new independent approval');
  assert.equal(model.results[0].independentReviewBlocked, true);
  assert.equal(snapshot.results[0].reviewAllowed, false, 'Current contributor restriction remains distinct from scoped review capability');
  assert.equal(snapshot.sourceVerification.status, 'verified');
  assert.deepEqual(snapshot.sourceVerification.capacity.sources.map(item => item.blockId), ['r11-source']);
  assert.deepEqual(snapshot.sourceVerification.governance.sources.map(item => item.blockId), ['r11-direction']);
  assert.equal(snapshot.sourceVerification.governance.sourcesComplete, true);
  const target = snapshot.confirmedPlan.plan.targets[0];
  assert.deepEqual(target.quantity, { kind: 'exact', unit: 'presentation', value: 1 });
  assert.deepEqual(target.content_quantity, { kind: 'exact', unit: 'slide', value: 5 });
  assert.equal(snapshot.targetStates.length, 1);
  assert.equal(snapshot.requirementFileCounts[h.spec.id], 1, 'Five content slides are one presentation file');
  assert.equal(snapshot.summary.completion, 'complete');
  assert.equal(snapshot.capabilities.nativeGeneration, false);
  const { response, body } = await discloseSnapshot(h, trusted, snapshot);
  assert.equal(response.status, 200);
  assert.equal(body.permissions.independentReview, true);
  assert.equal(body.results[0].reviewAllowed, false);
  assert.equal(body.requirementFileCounts[h.spec.id], 1);
  // Owner==actor in this existing fixture; not a distinct collaborator's approval,
  // licensed-origin qualification or personal mini-app admission.
});

test('snapshot: missing and incomplete inventory preserve different projections', async t => {
  for (const mode of ['missing', 'incomplete']) {
    const { h, trusted } = await setupHistory(t, { snapshotPlan: true, pageSize: mode === 'incomplete' ? 1 : undefined });
    if (mode === 'missing') h.storage.remove(h.artifact.key);
    else {
      const prefix = `output-requirements/${OWNER}/${PROJECT}/${DOCUMENT}/`;
      for (let index = 0; index < 9; index++) h.storage.set({ key: `${prefix}a-unrelated-${index}.png`, bytes: new Uint8Array([index]) });
    }
    const { model, snapshot } = await snapshotFor(h, trusted);
    assert.equal(model.complete, mode === 'missing');
    assert.equal(snapshot.assets.length, 1); assert.equal(snapshot.assets[0].id, h.ids.asset);
    assert.equal(snapshot.assets[0].available, false); assert.equal(snapshot.results.length, 1);
    assert.equal(snapshot.targetStates[0].availability, mode === 'missing' ? 'missing' : 'unknown');
    assert.equal(snapshot.targetStates[0].export_available, false);
    assert.equal(snapshot.summary.delivery_ready, false);
    assert.equal(snapshot.summary.completion, mode === 'missing' ? 'partial' : 'unknown');
    assert.equal(snapshot.summary.scope_known, mode === 'missing');
    assert.equal(snapshot.requirementFileCounts[h.spec.id], mode === 'missing' ? 0 : null);
    if (mode === 'incomplete') {
      assert.deepEqual(snapshot.permissions, { canAuthor: false, canRequest: false, canReview: false, canDownload: false, independentReview: false });
      assert.equal(snapshot.results[0].reviewAllowed, false);
      assert.ok(snapshot.capabilities.limitationCodes.includes('output_custody_inventory_incomplete'));
    }
    const { response, body } = await discloseSnapshot(h, trusted, snapshot);
    assert.equal(response.status, 200, 'Unavailable production is still a guarded retained-history response');
    assert.equal(body.assets[0].id, h.ids.asset);
    assert.equal(body.requirementFileCounts[h.spec.id], mode === 'missing' ? 0 : null);
  }
  // Reuses the qualified default-budget cause only to exercise actual snapshot
  // projection. No invalid override, new inventory campaign or fake model flag.
});

test('snapshot: retained amendment reason withholds package readiness', async t => {
  const { h, trusted: source } = await setupSource(t, { snapshotPlan: true });
  const trusted = await seedHistory(h, source, { amendmentReason: '   ' });
  const { snapshot } = await snapshotFor(h, trusted);
  assert.equal(snapshot.scopeAmendments.length, 1);
  assert.deepEqual(snapshot.scopeAmendments[0], { eventId: 'r11-confirmed-event',
    previousPlanRevisionId: 'r12-previous-plan-revision', planRevisionId: h.ids.plan,
    actorUserId: trusted.scope.actorUserId, occurredAt: PAST, reason: '   ',
    withdrawnTargetIds: [], withdrawnObligationIds: [] });
  assert.equal(snapshot.summary.completion, 'unknown'); assert.equal(snapshot.summary.delivery_ready, false);
  assert.equal(snapshot.requirementSummaries[h.spec.id].completion, 'unknown');
  assert.equal(snapshot.requirementSummaries[h.spec.id].delivery_ready, false);
  assert.equal(snapshot.requirementFileCounts[h.spec.id], 1, 'History problem does not rewrite the actual known file denominator');
  assert.equal(snapshot.targetStates[0].export_available, true, 'Per-target projection and package-history readiness remain distinct');
  assert.ok(snapshot.capabilities.limitationCodes.includes('output_scope_history_reason_unverified'));
  const { response, body } = await discloseSnapshot(h, trusted, snapshot);
  assert.equal(response.status, 200); assert.equal(body.scopeAmendments[0].reason, '   ');
  assert.equal(body.summary.delivery_ready, false);
  // Synthetic retained amendment metadata, not an executed amendment or ancestry
  // assertion. The actual reason validator/summary path runs without a substitute.
});

test('snapshot: current authority is rechecked after construction', async t => {
  const { h, trusted } = await setupHistory(t, { snapshotPlan: true });
  const { snapshot } = await snapshotFor(h, trusted);
  assert.equal(snapshot.confirmedPlan.revisionId, h.ids.plan);
  h.sql.mutate('UPDATE users SET consent_version=NULL WHERE user_id=?', OWNER);
  await assert.rejects(h.read(() => discloseOutputJson(trusted, snapshot), 'actual post-snapshot disclosure refusal'),
    conflict('output_execution_authority_revoked', 403));
  // No response is returned, no positive guard injected, and no full error-matrix
  // replay: a previously computed snapshot is not current disclosure authority.
});

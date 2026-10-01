import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertQualityFixture, qualityInput, qualityQuestionContract, replayQualityCase, summarizeQualityReplays, summarizeQualityOutcomes, summarizeQualityOutcomesBySource,
  QUALITY_REPLAY_VERSION, QUALITY_POLICIES, QUALITY_ABLATIONS, QUALITY_REPLAY_VIEWS, QUALITY_UNSUPPORTED_SURFACES,
} from '../src/still/decision-quality.ts';

// Replay never calls an API, persists user observations, changes product flags,
// submits jobs, or estimates what a provider would say about changed evidence.
globalThis.fetch = () => { throw new Error('Network access is forbidden in the offline Still evaluator'); };
const root = fileURLToPath(new URL('..', import.meta.url));
const options = { fixture: resolve(root, 'tests/fixtures/still-action-quality-v1.json'), policies: QUALITY_POLICIES.join(','), ablations: 'full' };
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i]?.slice(2), value = process.argv[i + 1];
  if (!process.argv[i]?.startsWith('--') || !['fixture','out','policies','ablations','captures'].includes(key) || !value || value.startsWith('--')) throw new Error('Usage: node --experimental-strip-types scripts/evaluate-still-actions.mjs [--fixture path] [--out path] [--policies local,scored,next-best] [--ablations full,without-next-best,without-support] [--captures path]');
  options[key] = value;
}
const choose = (raw, choices, name) => {
  const values = raw.split(',');
  if (!values.length || new Set(values).size !== values.length || values.some(value => !choices.includes(value))) throw new Error(`Invalid ${name}: ${raw}`);
  return values;
};
const policies = choose(options.policies, QUALITY_POLICIES, 'policies');
const ablations = choose(options.ablations, QUALITY_ABLATIONS, 'ablations');
const hash = value => createHash('sha256').update(value).digest('hex');
const fixtureText = await readFile(resolve(options.fixture), 'utf8');
const fixture = JSON.parse(fixtureText);
assertQualityFixture(fixture);
const { freezeSha256, ...frozen } = fixture;
if (hash(JSON.stringify(frozen)) !== freezeSha256) throw new Error('Frozen fixture hash mismatch. Preserve this release and create a reviewed new fixture version for changed labels or evidence.');
const inputHashes = Object.fromEntries(fixture.cases.map(c => [c.id, hash(JSON.stringify(qualityInput(c)))]));
const questionHashes = Object.fromEntries(fixture.cases.map(c => [c.id, hash(JSON.stringify(qualityQuestionContract(c)))]));
const captures = new Map();
let captureReceipt;
if (options.captures) {
  const content = await readFile(resolve(options.captures), 'utf8'), set = JSON.parse(content);
  if (set.schemaVersion !== 1 || set.fixtureId !== fixture.id || set.fixtureVersion !== fixture.version || set.provenance !== 'authorized-redacted' || typeof set.authorizationReference !== 'string' || !set.authorizationReference.trim() || !Array.isArray(set.cases)) throw new Error('Capture set must name this fixture/version and retain its authorized-redacted provenance and authorization reference.');
  for (const row of set.cases) {
    if (captures.has(row.caseId) || !Object.hasOwn(inputHashes, row.caseId) || inputHashes[row.caseId] !== row.inputSha256 || questionHashes[row.caseId] !== row.questionContractSha256 || row.providerRequestSha256 !== undefined && !/^[a-f0-9]{64}$/.test(row.providerRequestSha256) || !row.answers || typeof row.answers !== 'object' || Array.isArray(row.answers) || typeof row.policy !== 'string' || !row.policy || typeof row.model !== 'string' || !row.model) throw new Error(`Invalid or stale capture for ${row.caseId}`);
    captures.set(row.caseId, row);
  }
  captureReceipt = { sha256: hash(content), provenance: set.provenance, authorizationReference: set.authorizationReference, cases: set.cases.map(({ caseId, inputSha256, questionContractSha256, providerRequestSha256, policy, model }) => ({ caseId, inputSha256, questionContractSha256, providerRequestSha256, policy, model })) };
}

// Include the local module closure, dependency lock, and CLI in the receipt so
// comparing two runs cannot silently reuse a different evaluator or policy.
const sourceFiles = new Map();
async function retainSource(path) {
  const absolute = resolve(path), key = relative(root, absolute);
  if (sourceFiles.has(key)) return;
  const content = await readFile(absolute, 'utf8');
  sourceFiles.set(key, hash(content));
  if (!/\.[cm]?[jt]s$/.test(absolute)) return;
  for (const match of content.matchAll(/(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/g)) {
    if (/\.[cm]?[jt]s$/.test(match[1])) await retainSource(resolve(dirname(absolute), match[1]));
  }
}
await retainSource(fileURLToPath(import.meta.url));
await retainSource(resolve(root, 'package.json'));
await retainSource(resolve(root, 'pnpm-lock.yaml'));
const sources = Object.fromEntries([...sourceFiles].sort(([a], [b]) => a.localeCompare(b)));
const rows = [];
for (const ablation of ablations) for (const policy of policies) for (const c of fixture.cases) {
  const captured = captures.get(c.id);
  rows.push({ ...replayQualityCase(c, policy, ablation, captured?.answers), answerSource: captured ? 'authorized-redacted-capture' : 'fixture', inputSha256: inputHashes[c.id], questionContractSha256: questionHashes[c.id] });
}
const groups = [...new Set(rows.map(r => `${r.policy}/${r.ablation}`))];
const receipt = {
  schemaVersion: 1, evaluator: QUALITY_REPLAY_VERSION, createdAt: new Date().toISOString(),
  fixture: { id: fixture.id, version: fixture.version, labelVersion: fixture.labelVersion, frozenAt: fixture.frozenAt, freezeSha256, fileSha256: hash(fixtureText), provenance: fixture.provenance, partition: fixture.partition ?? 'legacy-unspecified', parent: fixture.parent ?? null },
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  sources, sourceSha256: hash(JSON.stringify(sources)), capture: captureReceipt ?? null,
  policies, ablations,
  coverage: { kind: 'toolbar-recommendation-policy', views: Object.fromEntries(QUALITY_REPLAY_VIEWS.map(view=>[view,fixture.cases.filter(c=>c.position.view===view).length])), unsupported: QUALITY_UNSUPPORTED_SURFACES },
  summaries: Object.fromEntries(groups.map(group => [group, summarizeQualityReplays(rows.filter(r => `${r.policy}/${r.ablation}` === group))])),
  surfaces: Object.fromEntries(groups.map(group => [group, Object.fromEntries([...new Set(rows.map(r => r.surface))].map(surface => [surface, summarizeQualityReplays(rows.filter(r => `${r.policy}/${r.ablation}` === group && r.surface === surface))]))])),
  cohorts: Object.fromEntries(groups.map(group => [group, Object.fromEntries([...new Set(fixture.cases.flatMap(c=>c.tags))].map(tag=>[tag,summarizeQualityReplays(rows.filter(r=>`${r.policy}/${r.ablation}`===group&&r.tags.includes(tag)))]))])),
  outcomes: summarizeQualityOutcomes(fixture.outcomes),
  outcomesBySource: summarizeQualityOutcomesBySource(fixture.outcomes),
  cases: rows,
  limits: [
    'Deterministic policy replay with supplied judgments. No provider calls or user-outcome experiment.',
    'Quality labels are scoped to the frozen cases. Unlabeled actions remain unknown; absent/censored outcomes are never failures.',
    'Ablations remove nomination influence or supporting ranking signals from supplied answers. They cannot measure the effect of omitting goals/history on provider judgments.',
    'Calibration against fictional invitation labels is a policy diagnostic, not empirical model calibration or a forecast of task success.',
    'Exposure, selection and position bias are reported but not causally corrected. Synthetic outcomes cannot authorize rollout or threshold changes.',
    'Browser layout, utility controls, optional server enrichment, live retrieval, API latency and costs require their separate verification lanes.',
  ],
};
const serialized = JSON.stringify(receipt, null, 2) + '\n';
if (options.out) {
  const path = resolve(options.out); await mkdir(dirname(path), { recursive: true }); await writeFile(path, serialized);
  process.stdout.write(JSON.stringify({ receipt: path, fixture: fixture.id, cases: fixture.cases.length, comparisons: rows.length, sourceSha256: receipt.sourceSha256, summaries: receipt.summaries }, null, 2) + '\n');
} else process.stdout.write(serialized);

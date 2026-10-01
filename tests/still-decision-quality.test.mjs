import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  assertQualityFixture, qualityInput, qualityQuestionContract, replayQualityCase, calibrationSummary,
  summarizeQualityOutcomes, summarizeQualityOutcomesBySource, summarizeQualityReplays, QUALITY_POLICIES, QUALITY_ABLATIONS, QUALITY_REPLAY_VIEWS,
} from '../src/still/decision-quality.ts';

const fixturePath = new URL('./fixtures/still-action-quality-v1.json', import.meta.url);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const hash = value => createHash('sha256').update(value).digest('hex');
const scenario = id => structuredClone(fixture.cases.find(c => c.id === id));
const expanded=JSON.parse(readFileSync(new URL('./fixtures/still-action-quality-v2.json',import.meta.url),'utf8'));
const holdout=JSON.parse(readFileSync(new URL('./fixtures/still-action-quality-holdout-v2.json',import.meta.url),'utf8'));

test('v2 freezes every supported toolbar view and keeps holdout and original evidence separate',()=>{
  assert.equal(fixture.freezeSha256,'d3dbadaf9725fdbfd25f258635630ad380dfc642295da5dc05723bb19b01a987');
  assert.equal(fixture.cases.length,12);
  for(const release of [expanded,holdout]){
    assertQualityFixture(release);
    const {freezeSha256,...frozen}=release;assert.equal(hash(JSON.stringify(frozen)),freezeSha256);
    assert.equal(release.parent.freezeSha256,fixture.freezeSha256);
    assert.ok(release.cases.every(c=>!fixture.cases.some(old=>old.id===c.id)));
  }
  assert.equal(expanded.partition,'development');assert.equal(holdout.partition,'holdout');
  assert.deepEqual([...new Set(expanded.cases.map(c=>c.position.view))].sort(),[...QUALITY_REPLAY_VIEWS].sort());
  const tags=new Set(expanded.cases.flatMap(c=>c.tags));
  for(const tag of ['sparse','incomplete-history','stale-history','collaborator','permission-restricted','interrupted','review','recovery','no-primary'])assert.ok(tags.has(tag),tag);
  assert.ok(holdout.cases.every(c=>!expanded.cases.some(other=>other.id===c.id)));
});

test('canonical jobs determine replay eligibility even when supplied derived context contradicts the job',()=>{
  const c=structuredClone(expanded.cases.find(c=>c.id==='v2-generation-uncertain-canonical'));
  c.position.generation={canStartNew:true,active:false,mayDuplicateCharge:false};
  for(const policy of QUALITY_POLICIES){
    const row=replayQualityCase(c,policy);
    assert.ok(!row.candidates.includes('generate-again'));
    assert.ok(row.candidates.includes('refresh-generation'));
  }
  const mismatched=structuredClone(expanded);mismatched.cases.find(c=>c.generationJob).generationJob.documentId='elsewhere';
  assert.throws(()=>assertQualityFixture(mismatched),/canonical generation job scope/);
});

test('an emphasized unjudged action remains unknown unless the case requires abstention',()=>{
  const c=scenario('cold-start');c.labels.useful=[];c.labels.primary.acceptable=[];c.labels.primary.abstention='allowed';
  const row=replayQualityCase(c,'next-best');assert.equal(row.primary,'new-project');
  assert.equal(row.metrics.primaryAppropriate,null);
  const summary=summarizeQualityReplays([row]);assert.equal(summary.primaryAppropriateness,null);assert.equal(summary.primaryUnknown,1);assert.equal(summary.primaryJudged,0);
  c.labels.primary.abstention='required';assert.equal(replayQualityCase(c,'next-best').metrics.primaryAppropriate,false);
});

test('frozen fictional inventory labels goals, quality, missing evidence, and the required difficult journeys', () => {
  assertQualityFixture(fixture);
  const { freezeSha256, ...frozen } = fixture;
  assert.equal(hash(JSON.stringify(frozen)), freezeSha256);
  assert.equal(fixture.provenance.kind, 'fictional');
  const tags = new Set(fixture.cases.flatMap(c => c.tags));
  for (const tag of ['cold-start','changed-goal','constraints','failure','exploration','partial-evidence','revocation','undo','collaborator','final-evidence']) assert.ok(tags.has(tag), tag);
  for (const c of fixture.cases) assert.ok(c.goal.criteria.length && c.labels.rationale && c.labels.source === 'fictional');
});

test('replay compares production policies without mutating inputs or granting revoked capabilities', () => {
  const c = scenario('permission-revoked'), before = JSON.stringify(c);
  for (const policy of QUALITY_POLICIES) for (const ablation of QUALITY_ABLATIONS) {
    const row = replayQualityCase(c, policy, ablation);
    assert.ok(row.selected.every(id => row.candidates.includes(id)));
    for (const id of ['edit-block','create','generate-again','image','new-document']) assert.ok(!row.selected.includes(id));
    assert.equal(row.metrics.constraintViolations, 0);
  }
  assert.equal(JSON.stringify(c), before);
});

test('final-evidence changes and a nominee cut from the final menu cannot restore primary emphasis', () => {
  const changed = replayQualityCase(scenario('enrichment-changed'), 'next-best');
  assert.equal(changed.nextBest.accepted, false);
  assert.match(changed.nextBest.reason, /evidence|enrichment/i);
  const cut = replayQualityCase(scenario('nominee-cut'), 'next-best');
  assert.equal(cut.nextBest.accepted, false);
  assert.ok(!cut.selected.includes('supply-reference'));
  assert.match(cut.nextBest.reason, /final selected menu/);
});

test('nomination ablation only changes the nomination policy and never fabricates new provider judgments', () => {
  const c = scenario('cold-start');
  const on = replayQualityCase(c, 'next-best');
  const off = replayQualityCase(c, 'next-best', 'without-next-best');
  assert.equal(on.nextBest.accepted, true);
  assert.equal(off.nextBest.accepted, false);
  assert.deepEqual(on.usefulnessSamples, off.usefulnessSamples);
  assert.deepEqual(replayQualityCase(c, 'local').usefulnessSamples, []);
});

test('unlabeled selections remain unknown and empty calibration never means perfect performance', () => {
  const c = scenario('cold-start');
  c.labels.useful = []; c.labels.primary.acceptable = []; c.labels.primary.abstention = 'allowed';
  const row = replayQualityCase(c, 'local');
  assert.equal(row.metrics.usefulSetPrecision, null);
  assert.equal(row.metrics.usefulRecall, null);
  assert.equal(row.metrics.labelCoverage, 0);
  assert.deepEqual(row.unknownLabels, ['new-project']);
  assert.equal(calibrationSummary([]).brier, null);
  assert.equal(summarizeQualityReplays([]).primaryAppropriateness, null);
  const calibration = calibrationSummary([{ probability: .8, positive: true }, { probability: .2, positive: false }]);
  assert.equal(calibration.count, 2);
  assert.ok(Math.abs(calibration.brier - .04) < 1e-9);
  assert.equal(calibration.bins.reduce((n,b) => n + b.count, 0), 2);
});

test('late, censored, pending, unknown, withdrawn, and direct outcomes keep separate denominators', () => {
  const base = { outcomeId: 'o', revision: 1, caseId: 'cold-start', actionId: 'new-project', source: 'fictional', status: 'pending', occurredAt: '2026-09-28T12:00:00Z', recordedAt: '2026-09-28T12:00:00Z', horizonMs: 86_400_000, exposure: { invocationId: 'invoke', assignment: 'observational', alternatives: ['new-project'] } };
  const outcomes = [
    base,
    { ...base, revision: 2, status: 'observed', success: true, quality: .9, predictedSuccess: .8, regret: false, recordedAt: '2026-09-30T12:00:00Z' },
    { ...base, outcomeId: 'censored', status: 'censored', success: false, predictedSuccess: .7 },
    { ...base, outcomeId: 'pending' },
    { ...base, outcomeId: 'unknown', status: 'unknown', success: true },
    { ...base, outcomeId: 'withdrawn', status: 'observed', success: false },
    { ...base, outcomeId: 'withdrawn', revision: 2, status: 'revoked', success: false },
    { ...base, outcomeId: 'direct', status: 'observed', exposure: { invocationId: 'direct', assignment: 'direct', alternatives: [] } },
  ];
  const summary = summarizeQualityOutcomes(outcomes);
  assert.equal(summary.outcomes, 6);
  assert.equal(summary.revisions, 8);
  assert.deepEqual(summary.success, { count: 1, rate: 1 });
  assert.equal(summary.unknownSuccess, 4);assert.equal(summary.unknown, 1);
  assert.equal(summary.censored, 1); assert.equal(summary.pending, 1); assert.equal(summary.revoked, 1);
  assert.equal(summary.late, 1); assert.equal(summary.direct, 1); assert.equal(summary.observational, 5);
  assert.equal(summary.successCalibration.count, 1);
  assert.deepEqual(summary.costUsd, { count: 0, mean: null });
  assert.match(summary.inference, /No selection-bias correction/);
});

test('fixture schema rejects contradictory labels and ambiguous outcome revisions', () => {
  const conflict = structuredClone(fixture);
  conflict.cases[0].labels.unacceptable.push(conflict.cases[0].labels.useful[0]);
  assert.throws(() => assertQualityFixture(conflict), /conflicting quality labels/);
  const duplicate = structuredClone(fixture);
  duplicate.outcomes.push(structuredClone(duplicate.outcomes[0]));
  assert.throws(() => assertQualityFixture(duplicate), /unique outcome revision/);
});

test('source cohorts resolve withdrawals before partitioning and unsupported surfaces cannot produce toolbar metrics', () => {
  const row = { ...fixture.outcomes.find(o => o.status === 'observed'), source: 'user' };
  const bySource = summarizeQualityOutcomesBySource([row, { ...row, revision: row.revision + 1, status: 'revoked', source: 'expert' }]);
  assert.equal(bySource.user.success.count, 0);
  assert.equal(bySource.expert.revoked, 1);
  for (const position of [{ view: 'choose-format' }, { view: 'find-action' }, { palette: { query: '' } }, { surfaceContext: { version: 1, surface: 'workflow', step: 'edit' } }]) {
    const c = scenario('cold-start'); Object.assign(c.position, position);
    assert.throws(() => replayQualityCase(c, 'scored'), /Unsupported quality replay surface/);
  }
});

test('offline CLI retains reproducible identities and rejects stale captures and modified frozen evidence', () => {
  const directory = mkdtempSync(join(tmpdir(), 'still-quality-'));
  const script = new URL('../scripts/evaluate-still-actions.mjs', import.meta.url).pathname;
  const run = (...args) => spawnSync(process.execPath, ['--experimental-strip-types', script, ...args], { encoding: 'utf8', timeout: 30_000 });
  try {
    const out = join(directory, 'receipt.json');
    const result = run('--out', out, '--policies', 'local,scored,next-best', '--ablations', 'full,without-next-best');
    assert.equal(result.status, 0, result.stderr);
    const receipt = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(receipt.cases.length, fixture.cases.length * 6);
    assert.equal(receipt.fixture.freezeSha256, fixture.freezeSha256);
    assert.equal(receipt.fixture.partition,'legacy-unspecified');
    assert.equal(receipt.coverage.kind,'toolbar-recommendation-policy');
    assert.equal(receipt.coverage.views.artifact,0);
    for(const surface of ['palette','formats','workflow','more','renderedToolbar'])assert.ok(receipt.coverage.unsupported[surface]);
    assert.ok(receipt.cohorts['local/full']['partial-evidence']);
    for (const path of ['scripts/evaluate-still-actions.mjs','src/still/decision-quality.ts','src/still/decisions.ts','src/still/decision-coherence.ts','pnpm-lock.yaml']) assert.match(receipt.sources[path], /^[a-f0-9]{64}$/);
    assert.ok(receipt.limits.some(line => line.includes('No provider calls')));
    const capture = join(directory, 'capture.json');
    const c = fixture.cases[0];
    const set = { schemaVersion: 1, fixtureId: fixture.id, fixtureVersion: fixture.version, provenance: 'authorized-redacted', authorizationReference: 'fictional-test-authorization', cases: [{ caseId: c.id, inputSha256: hash(JSON.stringify(qualityInput(c))), questionContractSha256: hash(JSON.stringify(qualityQuestionContract(c))), policy: 'fixture-policy', model: 'fixture-model', answers: c.answers }] };
    writeFileSync(capture, JSON.stringify(set));
    assert.equal(run('--captures', capture, '--out', out, '--policies', 'scored').status, 0);
    const contractHash = set.cases[0].questionContractSha256;
    set.cases[0].questionContractSha256 = '0'.repeat(64); writeFileSync(capture, JSON.stringify(set));
    assert.match(run('--captures', capture).stderr, /Invalid or stale capture/);
    set.cases[0].questionContractSha256 = contractHash;
    set.cases[0].inputSha256 = '0'.repeat(64); writeFileSync(capture, JSON.stringify(set));
    assert.match(run('--captures', capture).stderr, /Invalid or stale capture/);
    const altered = join(directory, 'altered.json'), input = structuredClone(fixture);
    input.cases[0].goal.description = 'Changed without a new freeze'; writeFileSync(altered, JSON.stringify(input));
    assert.match(run('--fixture', altered).stderr, /Frozen fixture hash mismatch/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

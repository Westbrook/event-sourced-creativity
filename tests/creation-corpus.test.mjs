import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { seedCreationAccount, evaluateCreationRetrievalCorpus, runCreationRetrievalCorpus } from './helpers/creation-corpus.mjs';
const corpus = JSON.parse(await readFile(new URL('./fixtures/still-creation-corpus.json', import.meta.url), 'utf8'));

test('v19 fixed corpus has sufficient cases, exact UTF-16 evidence and disjoint target families', () => {
  assert.ok(corpus.organizationCases.length >= 30);
  assert.ok(corpus.retrievalCases.length >= 50);
  for (const collection of [corpus.organizationCases, corpus.retrievalCases, corpus.retrievalTargets]) {
    assert.equal(new Set(collection.map(({ id }) => id)).size, collection.length);
    assert.ok(collection.every(({ split }) => ['tuning', 'held-out'].includes(split)));
  }
  for (const item of corpus.organizationCases) {
    assert.ok(item.sourceConstraints.mustPreserve.length);
    assert.ok(item.sourceConstraints.mustNotInfer.length);
    for (const evidence of item.sourceConstraints.mustPreserve) {
      assert.equal(item.source.slice(evidence.start, evidence.end), evidence.quote, item.id);
    }
  }
  const targets = new Map(corpus.retrievalTargets.map((item) => [item.id, item]));
  for (const item of corpus.retrievalCases) {
    assert.equal(item.expectedIds.length === 0, item.classification === 'no-match');
    for (const id of item.expectedIds) {
      assert.equal(targets.get(id)?.split, item.split, `${item.id} crosses tuning/held-out identity`);
    }
  }
  const tags = new Set(corpus.organizationCases.flatMap((item) => item.tags));
  for (const required of ['multilingual', 'negation', 'title', 'short', 'long', 'ambiguous', 'preferences', 'identity', 'qualification']) assert.ok(tags.has(required));
  const words = (text) => new Set(text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  for (const item of corpus.retrievalCases.filter((item) => item.tags.includes('zero-token-overlap'))) {
    const record = targets.get(item.expectedIds[0]);
    const source = words(`${record.title} ${record.body}`);
    assert.deepEqual([...words(item.query)].filter((word) => source.has(word)), [], item.id);
  }
});

test('seeded accounts include exact Idea counts, stable distractors and no evaluation labels', () => {
  for (const profile of corpus.accountProfiles) {
    const records = seedCreationAccount(corpus, profile.id);
    assert.equal(records.filter((item) => item.kind === 'idea').length, profile.ideaCount);
    assert.equal(new Set(records.map((item) => item.id)).size, records.length);
    assert.deepEqual(records, seedCreationAccount(corpus, profile.id));
    assert.ok(records.every((item) => !('split' in item) && !('expectedIds' in item)));
  }
});

const perfectRuns = () => corpus.accountProfiles.flatMap((profile) => corpus.retrievalCases.map((item) => ({
  caseId: item.id, profileId: profile.id, lexicalIds: [], semanticIds: item.expectedIds,
  rankedIds: item.expectedIds.slice(0, 3), durationMs: 5, evidenceKind: 'mocked',
})));

test('mocked oracle verifies scoring but never claims live semantic qualification', () => {
  const score = evaluateCreationRetrievalCorpus(corpus, perfectRuns());
  assert.equal(score.complete, true);
  assert.equal(score.recallAt3, 1);
  assert.equal(score.lexicalRecallAt20, 0);
  assert.equal(score.semanticRecallAt20, 1);
  assert.equal(score.rerankRecallAt3GivenCandidate, 1);
  assert.equal(score.noMatchFalsePositiveRate, 0);
  assert.equal(score.metricsMeetTargets, true);
  assert.equal(score.liveRetrievalQualityGatePassed, false);
});

test('missing, malformed, unauthorized and false-positive results fail independently', () => {
  const absent = evaluateCreationRetrievalCorpus(corpus, []);
  assert.equal(absent.evidenceKind, 'not-run');
  assert.equal(absent.recallAt3, null);
  assert.equal(absent.liveRetrievalQualityGatePassed, false);
  const missing = perfectRuns().slice(0, -1);
  assert.equal(evaluateCreationRetrievalCorpus(corpus, missing).complete, false);
  for (const unauthorized of ['private', 'revoked', 'deleted', 'cross-project', 'nonexistent']) {
    const runs = perfectRuns();
    runs[0].exposedIds = [unauthorized];
    const score = evaluateCreationRetrievalCorpus(corpus, runs);
    assert.equal(score.authorizationLeaks.length, 1, unauthorized);
    assert.equal(score.metricsMeetTargets, false);
  }
  const positives = perfectRuns();
  positives.filter((run) => run.caseId.startsWith('query-none')).forEach((run) => { run.rankedIds = ['h01']; });
  assert.equal(evaluateCreationRetrievalCorpus(corpus, positives).noMatchFalsePositiveRate, 1);
  const malformed = perfectRuns();
  malformed[0].rankedIds = ['t01', 't01'];
  assert.equal(evaluateCreationRetrievalCorpus(corpus, malformed).complete, false);
});

test('candidate retrieval and reranking quality are measured separately', () => {
  const runs = perfectRuns();
  for (const run of runs) run.rankedIds = [];
  const score = evaluateCreationRetrievalCorpus(corpus, runs);
  assert.equal(score.candidateUnionRecall, 1);
  assert.equal(score.recallAt3, 0);
  assert.equal(score.rerankRecallAt3GivenCandidate, 0);
});

test('runner strips labels from service inputs and records explicit evidence type', async () => {
  let calls = 0;
  const runs = await runCreationRetrievalCorpus(corpus, async (input) => {
    calls += 1;
    assert.ok(!('expectedIds' in input));
    assert.ok(!('split' in input));
    assert.ok(input.records.every((item) => !('split' in item)));
    return { lexicalIds: [], semanticIds: [], rankedIds: [], degraded: true };
  }, { profiles: ['small'], split: 'tuning' });
  assert.equal(calls, 12);
  assert.equal(runs.length, 12);
  assert.ok(runs.every((run) => run.evidenceKind === 'mocked' && run.durationMs >= 0));
});

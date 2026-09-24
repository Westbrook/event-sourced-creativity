import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { searchCreationContent } from '../worker/creation-search.ts';
import { runCreationRetrievalCorpus, evaluateCreationRetrievalCorpus, isCorpusRecordAuthorized } from './helpers/creation-corpus.mjs';
const corpus = JSON.parse(await readFile(new URL('./fixtures/still-creation-corpus.json', import.meta.url), 'utf8'));

// This is deliberately a fixture oracle, not an embedding model or a relevance benchmark.
// It exercises service scheduling/bounds/authorization with fixed targets at each seeded account size.
const fixtureSemanticIds = new Map(corpus.retrievalCases.map((item) => [item.query, item.expectedIds]));
const words = (text) => new Set(text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);

test('mocked service runs the fixed corpus at 64/1000/10000 Ideas without mistaking scores for live qualification', async () => {
  let maxHydrated = 0;
  let serviceCalls = 0;
  let noOverlapSemanticRescues = 0;
  const runs = await runCreationRetrievalCorpus(corpus, async (input) => {
    serviceCalls += 1;
    const queryScope = { actorId: input.actorId, entry: input.entry, projectId: input.projectId };
    const recordMap = new Map(input.records.map((record) => [record.id, record]));
    const permitted = input.records.filter((record) => isCorpusRecordAuthorized(record, queryScope));
    const terms = words(input.query);
    const lexical = permitted.map((record) => ({ record, score: [...words(`${record.title} ${record.body}`)]
      .reduce((score, word) => score + Number(terms.has(word)), 0) }))
      .filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.record.id.localeCompare(b.record.id))
      .slice(0, 20).map((item) => item.record.id);
    const semantic = fixtureSemanticIds.get(input.query) ?? [];
    const partition = { projectId: input.projectId, custody: 'personal-alex', permissionEpoch: '1',
      contentVersion: '1', indexVersion: '1', providerPolicy: 'fixture-only' };
    const hit = (id, rank = 0) => {
      const record = recordMap.get(id);
      return { id, projectId: record.projectId, custody: record.custodyId, kind: record.kind,
        revision: String(record.revision), contentHash: `fixture:${record.id}:${record.revision}`, rank };
    };
    const hydrated = new Set();
    const exposedIds = [];
    const response = await searchCreationContent({
      principal: input.actorId, request: { draftId: 'corpus-draft', draftRevision: 1, queryRevision: serviceCalls, query: input.query },
      entryKind: input.entry, projectId: input.projectId, partitions: [partition], partitionsComplete: true,
      index: {
        lexical: async (_partition, _query, limit) => { assert.equal(limit, 20); return lexical.map(hit); },
        current: async (_partition, hits) => hits.filter((candidate) => recordMap.get(candidate.id)?.state === 'active'),
        coverage: async () => ({ projectId: partition.projectId, custody: partition.custody,
          expected: permitted.length, lexical: permitted.length, semantic: permitted.length, backfillComplete: true }),
      },
      learned: {
        modelVersion: 'mocked-corpus-oracle-v1',
        query: async (_partition, _query, limit) => { assert.equal(limit, 20); return semantic.map(hit); },
      },
      authority: {
        authorize: async (principal, value) => principal === input.actorId && value.projectId === input.projectId,
        permitsProvider: (_partition, model) => model.startsWith('mocked-'),
        hydrate: async (_principal, _partition, candidate) => {
          const record = recordMap.get(candidate.id);
          if (!isCorpusRecordAuthorized(record, queryScope)) return undefined;
          hydrated.add(record.id);
          return { ...hit(record.id), title: record.title, text: record.body, locations: [] };
        },
      },
      reranker: {
        modelVersion: 'mocked-relevance-oracle-v1',
        rank: async (_partition, _query, candidates) => {
          assert.ok(candidates.length <= 24);
          exposedIds.push(...candidates.map((candidate) => candidate.id));
          return candidates.map((candidate) => ({ id: candidate.id, relevant: semantic.includes(candidate.id),
            rank: semantic.indexOf(candidate.id), evidence: candidate.text }));
        },
      },
    });
    assert.ok(hydrated.size <= 24);
    maxHydrated = Math.max(maxHydrated, hydrated.size);
    assert.equal(response.mode, 'hybrid');
    assert.equal(response.partial, false);
    assert.ok(response.candidates.length <= 3);
    if (semantic.length && !semantic.some((id) => lexical.includes(id))) {
      assert.ok(response.candidates.some((item) => semantic.includes(item.id)));
      noOverlapSemanticRescues += 1;
    }
    return { lexicalIds: lexical, semanticIds: semantic, rankedIds: response.candidates.map((item) => item.id),
      exposedIds, degraded: response.partial || response.mode !== 'hybrid' };
  });
  const score = evaluateCreationRetrievalCorpus(corpus, runs);
  assert.equal(serviceCalls, corpus.retrievalCases.length * corpus.accountProfiles.length);
  assert.ok(maxHydrated <= 24);
  assert.ok(noOverlapSemanticRescues >= 15);
  assert.equal(score.complete, true);
  assert.equal(score.authorizationLeaks.length, 0);
  assert.equal(score.metricsMeetTargets, true, JSON.stringify(score));
  assert.equal(score.evidenceKind, 'mocked');
  assert.equal(score.liveRetrievalQualityGatePassed, false);
});

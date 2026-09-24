/** Offline corpus utilities. These never call a provider and never infer a quality pass from schema validity. */
import { createHash } from 'node:crypto';

export function corpusDigest(corpus) {
  return createHash('sha256').update(JSON.stringify(corpus)).digest('hex');
}

export function seedCreationAccount(corpus, profileId) {
  const profile = corpus.accountProfiles.find((item) => item.id === profileId);
  if (!profile) throw new Error(`Unknown account profile: ${profileId}`);
  const records = structuredClone(corpus.retrievalTargets).map(({ split: _split, ...record }) => record);
  const count = records.filter((record) => record.kind === 'idea').length;
  for (let index = count; index < profile.ideaCount; index += 1) {
    const number = (Math.imul(index + 1, 1664525) + corpus.seedPolicy.seed + 1013904223) >>> 0;
    records.push({
      id: `filler-${index}`, kind: 'idea', title: `Inventory ${number}`,
      body: `Storage inventory record ${number}. Bin identifier ${index}.`,
      projectId: index % 7 === 0 ? 'project-other' : 'project-main',
      custodyId: 'personal-alex', readableBy: ['actor-alex'], revision: 1, state: 'active',
    });
  }
  return records;
}

export function isCorpusRecordAuthorized(record, query) {
  return Boolean(record && record.state === 'active' && record.readableBy.includes(query.actorId)
    && (query.entry === 'project' || record.projectId === query.projectId));
}

/** Supply an adapter around the real service. The adapter receives NO expected IDs or split labels. */
export async function runCreationRetrievalCorpus(corpus, search, { evidenceKind = 'mocked', profiles, split } = {}) {
  if (!['mocked', 'live'].includes(evidenceKind)) throw new Error('Evidence must be mocked or live');
  const runs = [];
  for (const profile of corpus.accountProfiles.filter((item) => !profiles || profiles.includes(item.id))) {
    const records = seedCreationAccount(corpus, profile.id);
    for (const item of corpus.retrievalCases.filter((query) => !split || query.split === split)) {
      const started = performance.now();
      const response = await search({
        query: item.query, entry: item.entry, projectId: item.projectId, actorId: item.actorId,
        records: structuredClone(records), profileId: profile.id,
      });
      runs.push({ ...response, caseId: item.id, profileId: profile.id,
        durationMs: performance.now() - started, evidenceKind });
    }
  }
  return runs;
}

const ratio = (numerator, denominator) => denominator ? numerator / denominator : null;
const p95 = (values) => values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1] : null;

export function evaluateCreationRetrievalCorpus(corpus, runs) {
  const seen = new Set();
  const cases = new Map(corpus.retrievalCases.map((item) => [item.id, item]));
  const recordsByProfile = new Map(corpus.accountProfiles.map((profile) => [profile.id,
    new Map(seedCreationAccount(corpus, profile.id).map((record) => [record.id, record]))]));
  const aggregate = { unambiguous: 0, lexicalHitsAt20: 0, semanticHitsAt20: 0, unionHits: 0,
    finalHitsAt3: 0, rerankHitsWithCandidate: 0, noMatchQueries: 0, falsePositives: 0,
    authorizationLeaks: [], ambiguityCases: 0, invalidRuns: [], degradedRuns: 0 };
  const timings = new Map(corpus.accountProfiles.map((profile) => [profile.id, []]));
  let live = true;
  for (const run of runs) {
    const query = cases.get(run.caseId);
    const records = recordsByProfile.get(run.profileId);
    const key = `${run.profileId}:${run.caseId}`;
    if (!query || !records || seen.has(key)) { aggregate.invalidRuns.push(key); continue; }
    seen.add(key);
    live &&= run.evidenceKind === 'live';
    if (!Array.isArray(run.rankedIds) || !Array.isArray(run.lexicalIds) || !Array.isArray(run.semanticIds)
      || run.rankedIds.length > 3 || new Set(run.rankedIds).size !== run.rankedIds.length) {
      aggregate.invalidRuns.push(key); continue;
    }
    if (run.degraded) aggregate.degradedRuns += 1;
    if (Number.isFinite(run.durationMs) && run.durationMs >= 0) timings.get(run.profileId).push(run.durationMs);
    else aggregate.invalidRuns.push(`${key}:missing-duration`);
    for (const id of new Set([...run.rankedIds, ...(run.exposedIds ?? [])])) {
      if (!isCorpusRecordAuthorized(records.get(id), query)) aggregate.authorizationLeaks.push({ key, id });
    }
    // Tuning is never part of held-out acceptance metrics.
    if (query.split !== 'held-out') continue;
    const hit = (ids) => ids.some((id) => query.expectedIds.includes(id));
    if (query.classification === 'unambiguous') {
      aggregate.unambiguous += 1;
      aggregate.lexicalHitsAt20 += Number(hit(run.lexicalIds.slice(0, 20)));
      aggregate.semanticHitsAt20 += Number(hit(run.semanticIds.slice(0, 20)));
      const inUnion = hit([...run.lexicalIds.slice(0, 20), ...run.semanticIds.slice(0, 20)]);
      const final = hit(run.rankedIds.slice(0, 3));
      aggregate.unionHits += Number(inUnion);
      aggregate.finalHitsAt3 += Number(final);
      aggregate.rerankHitsWithCandidate += Number(inUnion && final);
    } else if (query.classification === 'no-match') {
      aggregate.noMatchQueries += 1;
      aggregate.falsePositives += Number(run.rankedIds.length > 0);
    } else aggregate.ambiguityCases += 1;
  }
  const required = corpus.retrievalCases.filter((item) => item.split === 'held-out');
  const missing = corpus.accountProfiles.flatMap((profile) => required
    .filter((query) => !seen.has(`${profile.id}:${query.id}`)).map((query) => `${profile.id}:${query.id}`));
  const complete = missing.length === 0 && aggregate.invalidRuns.length === 0;
  const recallAt3 = ratio(aggregate.finalHitsAt3, aggregate.unambiguous);
  const noMatchFalsePositiveRate = ratio(aggregate.falsePositives, aggregate.noMatchQueries);
  const metricsMeetTargets = complete && recallAt3 !== null && noMatchFalsePositiveRate !== null
    && recallAt3 >= corpus.qualificationTargets.recallAt3
    && noMatchFalsePositiveRate <= corpus.qualificationTargets.noMatchFalsePositiveRate
    && aggregate.authorizationLeaks.length === 0;
  return {
    corpusDigest: corpusDigest(corpus), evidenceKind: runs.length ? live ? 'live' : 'mocked' : 'not-run',
    complete, missing, ...aggregate, recallAt3,
    lexicalRecallAt20: ratio(aggregate.lexicalHitsAt20, aggregate.unambiguous),
    semanticRecallAt20: ratio(aggregate.semanticHitsAt20, aggregate.unambiguous),
    candidateUnionRecall: ratio(aggregate.unionHits, aggregate.unambiguous),
    rerankRecallAt3GivenCandidate: ratio(aggregate.rerankHitsWithCandidate, aggregate.unionHits),
    noMatchFalsePositiveRate, p95MsByProfile: Object.fromEntries([...timings].map(([id, values]) => [id, p95(values)])),
    metricsMeetTargets,
    liveRetrievalQualityGatePassed: runs.length > 0 && live && metricsMeetTargets && aggregate.degradedRuns === 0,
    qualificationNote: 'Mocked scores test the harness only. Live retrieval metrics do not qualify organizational fidelity, UI accessibility, production latency or deployment. Human semantic adjudication remains separate.',
  };
}

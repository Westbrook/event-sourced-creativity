import { buildDecisionState, evaluateActions, questionsFor, POLICY_VERSION, type Abilities, type Answer, type Position } from './decisions.ts';
import { evaluateLocalActions } from './local-policy.ts';
import { assessNextBest, nextBestOrder, type NextBestAnswer } from './next-best.ts';
import { finalNextBest } from './decision-coherence.ts';
import { inspectAnswer } from './diagnostics.ts';
import { presentActions, presentToolbar, type EmphasisEvidence } from './presentation.ts';
import type { CreativeEvent } from '../model/events.ts';

/** Offline judgments evaluate an invitation. They do not establish realized user benefit. */
export const QUALITY_REPLAY_VERSION = 'still-action-quality-v1';
export const QUALITY_POLICIES = ['local', 'scored', 'next-best'] as const;
export const QUALITY_ABLATIONS = ['full', 'without-next-best', 'without-support'] as const;
export const QUALITY_REPLAY_VIEWS = ['projects','documents','ideas','document','results','artifact','generation','rejection'] as const;
export type QualityPolicy = typeof QUALITY_POLICIES[number];
export type QualityAblation = typeof QUALITY_ABLATIONS[number];
export type QualityLabels = {
  source: 'fictional' | 'expert' | 'user';
  useful: string[];
  neutral: string[];
  unacceptable: string[];
  primary: { acceptable: string[]; abstention: 'required' | 'allowed' | 'unexpected' };
  complementaryGroups: string[];
  rationale: string;
};
export type QualityCase = {
  id: string;
  tags: string[];
  goal: { id: string; revision: number; description: string; criteria: string[] };
  position: Position;
  abilities: Abilities;
  events: CreativeEvent[];
  evidence: { coverage: 'complete' | 'partial' | 'unknown'; omissions: string[]; revoked: string[] };
  answers: Record<string, Answer>;
  finalEvidenceChanged?: string;
  labels: QualityLabels;
};
/** Later observations append a revision; withdrawal wins without converting missingness to failure. */
export type QualityOutcome = {
  outcomeId: string;
  revision: number;
  caseId: string;
  actionId: string;
  source: 'fictional' | 'user' | 'expert';
  status: 'observed' | 'pending' | 'censored' | 'revoked';
  occurredAt: string;
  recordedAt: string;
  horizonMs: number;
  success?: boolean;
  quality?: number;
  regret?: boolean;
  predictedSuccess?: number;
  elapsedMs?: number;
  costUsd?: number;
  exposure: {
    decisionId?: string;
    impressionId?: string;
    invocationId: string;
    assignment: 'randomized' | 'observational' | 'direct';
    position?: number;
    propensity?: number;
    alternatives: string[];
  };
  feedback?: {
    id: string;
    assessor: 'user' | 'expert';
    kind: 'not-useful-now' | 'already-done' | 'different-goal' | 'keep-available' | 'quality-assessment';
    scope: 'idea' | 'document' | 'project';
    expiresAt?: string;
    supersedes?: string;
  };
};
export type QualityFixture = {
  schemaVersion: 1;
  id: string;
  version: string;
  labelVersion: string;
  frozenAt: string;
  freezeSha256: string;
  provenance: { kind: 'fictional' | 'authorized-redacted'; authorizationReference?: string };
  cases: QualityCase[];
  outcomes: QualityOutcome[];
};
export type QualityCaptureSet = {
  schemaVersion: 1;
  fixtureId: string;
  fixtureVersion: string;
  provenance: 'authorized-redacted';
  authorizationReference: string;
  cases: { caseId: string; inputSha256: string; questionContractSha256: string; providerRequestSha256?: string; policy: string; model: string; answers: Record<string, Answer> }[];
};
const ratio = (n: number, total: number) => total ? n / total : null;
const unique = (values: string[]) => [...new Set(values)];
const bounded = (n: unknown, maximum = 1): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= maximum;
const stringList = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string' && !!item.trim());

export function assertQualityFixture(input: unknown): asserts input is QualityFixture {
  const f = input as QualityFixture;
  const require = (valid: unknown, reason: string) => { if (!valid) throw new Error(`Invalid quality fixture: ${reason}`); };
  require(f && f.schemaVersion === 1 && typeof f.id === 'string' && f.id && typeof f.version === 'string' && f.version && typeof f.labelVersion === 'string' && f.labelVersion, 'identity and versions');
  require(Number.isFinite(Date.parse(f.frozenAt)), 'frozen timestamp');
  require(typeof f.freezeSha256 === 'string' && /^[a-f0-9]{64}$/.test(f.freezeSha256), 'frozen content hash');
  require(['fictional', 'authorized-redacted'].includes(f.provenance?.kind), 'provenance');
  require(f.provenance.kind !== 'authorized-redacted' || typeof f.provenance.authorizationReference === 'string' && !!f.provenance.authorizationReference.trim(), 'redacted-data authorization reference');
  require(Array.isArray(f.cases) && f.cases.length > 0 && f.cases.length <= 500, '1–500 cases required');
  const ids = new Set<string>();
  for (const c of f.cases) {
    require(c && typeof c.id === 'string' && c.id && !ids.has(c.id), 'unique case identity'); ids.add(c.id);
    require(c.goal && typeof c.goal.id === 'string' && c.goal.id.trim() && typeof c.goal.description === 'string' && c.goal.description.trim() && Number.isInteger(c.goal.revision) && c.goal.revision > 0 && stringList(c.goal.criteria) && c.goal.criteria.length, `${c.id}: explicit goal and quality criteria`);
    require(c.position && ['projectId','documentId','blockId','outputId','view','intent'].every(key => typeof c.position[key as keyof Position] === 'string') && stringList(c.position.recentActions), `${c.id}: position`);
    require(c.abilities && ['author','generate','projectCreate'].every(key => typeof c.abilities[key as keyof Abilities] === 'boolean') && stringList(c.abilities.formats), `${c.id}: abilities`);
    require(Array.isArray(c.events) && c.events.every(e => typeof e.type === 'string' && typeof e.eventId === 'string' && Number.isInteger(e.sequence) && e.payload && typeof e.payload === 'object'), `${c.id}: events`);
    require(c.answers && typeof c.answers === 'object' && !Array.isArray(c.answers), `${c.id}: supplied answers`);
    require(stringList(c.tags) && c.evidence && ['complete','partial','unknown'].includes(c.evidence.coverage) && stringList(c.evidence.omissions) && stringList(c.evidence.revoked), `${c.id}: evidence coverage`);
    require(c.finalEvidenceChanged === undefined || typeof c.finalEvidenceChanged === 'string' && !!c.finalEvidenceChanged.trim(), `${c.id}: final evidence change`);
    const l = c.labels;
    require(l && ['fictional','expert','user'].includes(l.source) && typeof l.rationale === 'string' && l.rationale, `${c.id}: labels and rationale`);
    require([l.useful,l.neutral,l.unacceptable,l.complementaryGroups,l.primary?.acceptable].every(a => stringList(a) && unique(a).length === a.length), `${c.id}: unique label arrays`);
    require(unique([...l.useful,...l.neutral,...l.unacceptable]).length === l.useful.length + l.neutral.length + l.unacceptable.length, `${c.id}: conflicting quality labels`);
    require(['required','allowed','unexpected'].includes(l.primary.abstention) && l.primary.acceptable.every(id => l.useful.includes(id)) && (l.primary.abstention !== 'required' || !l.primary.acceptable.length), `${c.id}: primary labels`);
  }
  require(Array.isArray(f.outcomes), 'outcomes');
  const revisions = new Set<string>();
  for (const o of f.outcomes) {
    require(o && typeof o.outcomeId === 'string' && o.outcomeId && Number.isInteger(o.revision) && o.revision > 0 && !revisions.has(`${o.outcomeId}:${o.revision}`), 'unique outcome revision');
    revisions.add(`${o.outcomeId}:${o.revision}`);
    require(ids.has(o.caseId) && typeof o.actionId === 'string' && ['fictional','user','expert'].includes(o.source) && ['observed','pending','censored','revoked'].includes(o.status), 'outcome scope and status');
    require(Number.isFinite(Date.parse(o.occurredAt)) && Number.isFinite(Date.parse(o.recordedAt)) && bounded(o.horizonMs, Number.MAX_SAFE_INTEGER), 'outcome timing');
    require(o.success === undefined || typeof o.success === 'boolean', 'outcome success');
    require(o.regret === undefined || typeof o.regret === 'boolean', 'outcome regret');
    for (const key of ['quality','predictedSuccess'] as const) require(o[key] === undefined || bounded(o[key]), `outcome ${key}`);
    for (const key of ['elapsedMs','costUsd'] as const) require(o[key] === undefined || bounded(o[key], Number.MAX_SAFE_INTEGER), `outcome ${key}`);
    require(o.exposure && typeof o.exposure.invocationId === 'string' && ['randomized','observational','direct'].includes(o.exposure.assignment) && Array.isArray(o.exposure.alternatives), 'exposure provenance');
    require(o.exposure.propensity === undefined || bounded(o.exposure.propensity) && o.exposure.propensity > 0, 'assignment propensity');
    require(o.exposure.position === undefined || Number.isInteger(o.exposure.position) && o.exposure.position > 0, 'exposure position');
  }
}

/** Hash this exact value when binding a normalized capture to its frozen replay case. */
export function qualityInput(c: QualityCase) {
  return { events: c.events, position: c.position, abilities: c.abilities, goal: c.goal, evidence: c.evidence, finalEvidenceChanged: c.finalEvidenceChanged };
}

/** This is the replay question/candidate contract, not a reconstructed server exchange. */
export function qualityQuestionContract(c: QualityCase) {
  const head = Math.max(0, ...c.events.map(e => e.sequence));
  const { state, candidates } = buildDecisionState(c.events, c.position, c.abilities, head);
  return { policy: POLICY_VERSION, candidates, questions: questionsFor(candidates, c.position, state.selectedWork?.kind, state.active.blocks) };
}

export function replayQualityCase(c: QualityCase, policy: QualityPolicy, ablation: QualityAblation = 'full', capturedAnswers?: Record<string, Answer>) {
  if (!QUALITY_REPLAY_VIEWS.some(view => view === c.position.view) || c.position.palette || c.position.surfaceContext && !['main','result','recovery'].includes(c.position.surfaceContext.surface)) throw new Error(`Unsupported quality replay surface: ${c.position.surfaceContext?.surface ?? c.position.view}. This version evaluates action toolbars; formats, workflows, More, and the palette require separate surface policies.`);
  const answers = structuredClone(capturedAnswers ?? c.answers);
  // This is a policy ablation of already supplied judgments, never a simulation of
  // how Jev would answer after removing history, constraints, or goal evidence.
  if (ablation === 'without-support') for (const key of Object.keys(answers)) if (!key.startsWith('use_') && key !== 'next_best_action') delete answers[key];
  const head = Math.max(0, ...c.events.map(e => e.sequence));
  const { candidates, projection } = buildDecisionState(c.events, c.position, c.abilities, head);
  const evaluation = policy === 'local' ? evaluateLocalActions(candidates, projection, c.position) : evaluateActions(candidates, c.position, answers, projection);
  const evidence: Record<string, EmphasisEvidence> = policy === 'local' ? {} : presentActions(candidates.map(a => a.id), answers);
  const raw = answers.next_best_action;
  const nextQuestion = questionsFor(candidates, c.position).next_best_action;
  const inspected = raw && nextQuestion ? inspectAnswer(nextQuestion, raw) : undefined;
  const nomination: NextBestAnswer | undefined = inspected ? { status: inspected.status, quality: inspected.quality, choice: inspected.choice, confidence: inspected.confidence, probabilities: inspected.probabilities } : undefined;
  const restricted = c.position.generation?.mayDuplicateCharge ? ['generate-again','refresh-generation'] : [];
  const finalNomination = finalNextBest(nomination, evaluation.selected.map(a => a.id), c.finalEvidenceChanged);
  const assessment = assessNextBest(finalNomination, evaluation.selected.map(a => a.id), evidence, policy === 'next-best' && ablation !== 'without-next-best', restricted);
  const selected = nextBestOrder(evaluation.selected, evaluation.ranked, assessment);
  const ids = selected.map(a => a.id);
  const presentation = presentToolbar(ids, evidence, { view: c.position.view, emptyProject: c.position.view === 'documents' && !projection.documents.some(d => !d.removed), secondaryOnly: restricted, nextBest: assessment.accepted ? assessment.choice : undefined });
  const primary = ids.find(id => presentation[id]?.variant === 'primary') ?? null;
  const known = new Set([...c.labels.useful, ...c.labels.neutral, ...c.labels.unacceptable]);
  const usefulSelected = ids.filter(id => c.labels.useful.includes(id));
  const judgedSelected = ids.filter(id => known.has(id));
  const violations = ids.filter(id => c.labels.unacceptable.includes(id));
  const groups = unique(selected.map(a => a.group));
  const usefulGroups = unique(selected.filter(a => c.labels.useful.includes(a.id)).map(a => a.group));
  return {
    caseId: c.id, surface: c.position.view, tags: c.tags, labelSource: c.labels.source, policy, ablation, productionPolicy: POLICY_VERSION,
    candidates: candidates.map(a => a.id), selected: ids, primary, nextBest: assessment, groups,
    metrics: {
      usefulSetPrecision: ratio(usefulSelected.length, judgedSelected.length), labelCoverage: ratio(judgedSelected.length, ids.length),
      usefulRecall: ratio(usefulSelected.length, c.labels.useful.length), retrievalRecall: ratio(c.labels.useful.filter(id => candidates.some(a => a.id === id)).length, c.labels.useful.length),
      complementaryGroupRecall: ratio(c.labels.complementaryGroups.filter(g => usefulGroups.includes(g as typeof usefulGroups[number])).length, c.labels.complementaryGroups.length),
      groupDiversity: ratio(groups.length, ids.length), constraintViolations: violations.length,
      primaryAppropriate: primary ? c.labels.primary.acceptable.includes(primary) : c.labels.primary.abstention !== 'unexpected',
      abstained: primary === null, unwantedInvitationProxy: ratio(violations.length, ids.length),
    },
    violations,
    unknownLabels: ids.filter(id => !known.has(id)),
    // Calibration of invitation usefulness labels, not calibration of task success.
    usefulnessSamples: policy === 'local' ? [] : candidates.flatMap(a => {
      const probability = evidence[a.id]?.usefulProbability;
      return bounded(probability) && known.has(a.id) ? [{ actionId: a.id, probability, positive: c.labels.useful.includes(a.id), source: c.labels.source }] : [];
    }),
  };
}
export type QualityReplay = ReturnType<typeof replayQualityCase>;

export function calibrationSummary(samples: { probability: number; positive: boolean }[]) {
  const valid = samples.filter(s => bounded(s.probability) && typeof s.positive === 'boolean');
  const bins = Array.from({ length: 5 }, (_, index) => {
    const rows = valid.filter(s => Math.min(4, Math.floor(s.probability * 5)) === index);
    return { lower: index / 5, upper: (index + 1) / 5, count: rows.length, meanProbability: ratio(rows.reduce((n,s) => n + s.probability, 0), rows.length), positiveRate: ratio(rows.filter(s => s.positive).length, rows.length) };
  });
  return { count: valid.length, brier: ratio(valid.reduce((n,s) => n + (s.probability - Number(s.positive)) ** 2, 0), valid.length), bins };
}

function latestQualityOutcomes(observations: QualityOutcome[]) {
  const latest = new Map<string, QualityOutcome>();
  for (const row of observations) if (!latest.has(row.outcomeId) || latest.get(row.outcomeId)!.revision < row.revision) latest.set(row.outcomeId, row);
  return [...latest.values()];
}

/** Resolve withdrawals across all sources before deriving a source cohort. */
export function summarizeQualityOutcomesBySource(observations: QualityOutcome[]) {
  const rows = latestQualityOutcomes(observations);
  return Object.fromEntries(['fictional','user','expert'].map(source => [source, summarizeQualityOutcomes(rows.filter(o => o.source === source))]));
}

export function summarizeQualityOutcomes(observations: QualityOutcome[]) {
  const rows = latestQualityOutcomes(observations);
  const observed = rows.filter(o => o.status === 'observed');
  const success = observed.filter(o => typeof o.success === 'boolean');
  const quality = observed.filter(o => bounded(o.quality));
  const regret = observed.filter(o => typeof o.regret === 'boolean');
  const measured = (key: 'costUsd' | 'elapsedMs') => { const samples = observed.filter(o => o[key] !== undefined); return { count: samples.length, mean: ratio(samples.reduce((n,o) => n + o[key]!, 0), samples.length) }; };
  return {
    revisions: observations.length, outcomes: rows.length, observed: observed.length,
    pending: rows.filter(o => o.status === 'pending').length, censored: rows.filter(o => o.status === 'censored').length, revoked: rows.filter(o => o.status === 'revoked').length,
    unknownSuccess: rows.filter(o => o.status !== 'revoked' && (o.status !== 'observed' || typeof o.success !== 'boolean')).length,
    success: { count: success.length, rate: ratio(success.filter(o => o.success).length, success.length) },
    quality: { count: quality.length, mean: ratio(quality.reduce((n,o) => n + o.quality!, 0), quality.length) },
    regret: { count: regret.length, rate: ratio(regret.filter(o => o.regret).length, regret.length) },
    late: observed.filter(o => Date.parse(o.recordedAt) - Date.parse(o.occurredAt) > o.horizonMs).length,
    direct: rows.filter(o => o.exposure.assignment === 'direct').length,
    observational: rows.filter(o => o.exposure.assignment === 'observational').length,
    missingExposure: rows.filter(o => o.exposure.assignment !== 'direct' && (!o.exposure.decisionId || !o.exposure.impressionId)).length,
    missingPropensity: rows.filter(o => o.exposure.assignment !== 'direct' && o.exposure.propensity === undefined).length,
    sourceCounts: Object.fromEntries(['fictional','user','expert'].map(source => [source, rows.filter(o => o.source === source).length])),
    successCalibration: calibrationSummary(success.filter(o => o.predictedSuccess !== undefined).map(o => ({ probability: o.predictedSuccess!, positive: o.success! }))),
    elapsedMs: measured('elapsedMs'), costUsd: measured('costUsd'),
    inference: 'Descriptive observations only. No selection-bias correction or causal benefit estimate is performed. Unknown and censored outcomes are not failures.',
  };
}

export function summarizeQualityReplays(rows: QualityReplay[]) {
  const average = (key: keyof QualityReplay['metrics']) => {
    const values = rows.map(r => r.metrics[key]).filter((n): n is number => typeof n === 'number');
    return { count: values.length, mean: ratio(values.reduce((n,v) => n + v, 0), values.length) };
  };
  return {
    count: rows.length,
    usefulSetPrecision: average('usefulSetPrecision'), usefulRecall: average('usefulRecall'), retrievalRecall: average('retrievalRecall'),
    labelCoverage: average('labelCoverage'), groupDiversity: average('groupDiversity'), complementaryGroupRecall: average('complementaryGroupRecall'),
    primaryAppropriateness: ratio(rows.filter(r => r.metrics.primaryAppropriate).length, rows.length),
    abstentionRate: ratio(rows.filter(r => r.metrics.abstained).length, rows.length),
    constraintViolations: rows.reduce((n,r) => n + r.metrics.constraintViolations, 0), unwantedInvitationProxy: average('unwantedInvitationProxy'),
    usefulnessCalibration: calibrationSummary(rows.flatMap(r => r.usefulnessSamples)),
    usefulnessCalibrationBySource: Object.fromEntries(['fictional','expert','user'].map(source => [source, calibrationSummary(rows.filter(r => r.labelSource === source).flatMap(r => r.usefulnessSamples))])),
    warning: 'Fictional labels test policy behavior. They do not measure real users, actual regret, model calibration on live traffic, or improved outcomes.',
  };
}

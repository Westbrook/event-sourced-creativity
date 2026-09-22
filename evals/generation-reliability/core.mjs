import { createHash } from 'node:crypto';

export const VERSION = 'generation-reliability-v1';
export const SOURCE_REVISION = '1587f9067162e38ce437d9cf443faf5620b388ae';
export function canonical(value) {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol'
    || typeof value === 'number' && !Number.isFinite(value)) throw new Error('non_json_identity');
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
export function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export function seal(kind, value) {
  const body = structuredClone(value);
  return freeze({ ...body, id: `${kind}:${hash(body)}` });
}
export function verifySeal(kind, value) {
  const { id, ...body } = value;
  if (id !== `${kind}:${hash(body)}`) throw new Error(`${kind}_identity_mismatch`);
}
export const HIST = seal('baseline', {
  class: 'HIST', jobId: '01a0c62c-dcaf-70ec-9821-598ab1c66aff', generationId: '01a0c62c-ee03-75ab-825d-902bfb2a30b7',
  promptHash: 'a121553479bb542c2618a51b374e32d1ad88c24a2a316f9580f4b43a72d23953', promptCharacters: 5596, promptBytes: 5621,
  retainedContextHash: '8e682c7a1c6decfed553f73b038b8ca321f89f5bf63c3dddf50f9ed89289f4b3', retainedSourceRevision: 'rev-1pygpag',
  retainedAccounting: { reservationMicrousd: 1000000, aggregateSettledMicrousd: 4946, stageAllocation: null, plannerCalls: 1, mediaCalls: 1, moderationCalls: null },
  requestedModel: 'gpt-image-2', plannerModel: 'gpt-5.6-terra', quality: 'high', size: '1536x1024', technique: 'prose', references: [],
  outcome: 'provider_safety_block', httpStatus: 400, providerCode: 'moderation_blocked', providerRequestId: 'req_a30af8cff4254dd286d2eddf3e5488ce',
  unknown: { sourceHash: null, plannerDirectionHash: null, fullRequestHash: null, modelSnapshot: null, outputFormat: null, moderation: null, providerModerationStage: null, historicalEnvironment: null, chatGPTToolPrompt: null, chatGPTImageModel: null },
  retentionExpiresAt: '2026-10-21T22:55:19.772Z', evidencePolicy: 'private authorized read only; never copy prompt into public examples',
});
export const PROD = seal('baseline', {
  class: 'PROD', sourceRevision: SOURCE_REVISION, configurationEvidence: 'review-v2 retained releases; no fresh live receipt',
  routes: { stillFinal: 'configured OpenAI Sunburst/high', sharedLow: 'forced OpenAI Flare/low', otherFormaHigh: 'configured provider, may be Fal', nativeOutputStoryboard: 'separate Ideogram/high', privateMemoryPreview: 'configured OpenAI/high with strict receipts', historicalRecovery: 'original purchased provider/request' },
});
export function freezeCase({ key, stratum, source, direction, prompt, requirements, references = [], privacy = 'synthetic', ...rest }) {
  if (!key || !stratum || !source || !direction || !prompt || !requirements?.length) throw new Error('case_incomplete');
  if (privacy !== 'synthetic') throw new Error('private_case_requires_authorized_external_fixture');
  const hashes = { source: hash(source), planner: hash(direction), prompt: hash(prompt), references: hash(references) };
  const c = seal('case', { key, stratum, source, direction, prompt, requirements, references, hashes, privacy, ...rest });
  validateCoverage(c, prompt);
  return c;
}
export function validateCoverage(c, prompt) {
  const seen = new Set();
  for (const r of c.requirements) {
    if (!r.id || seen.has(r.id) || !r.text || !Array.isArray(r.mustContain) || !r.mustContain.length) throw new Error('invalid_requirement');
    seen.add(r.id);
  }
  const missing = c.requirements.filter(r => r.mustContain.some(text => !prompt.includes(text))).map(r => r.id);
  if (missing.length) throw new Error(`semantic_coverage_missing:${missing.join(',')}`);
  return { required: c.requirements.length, covered: c.requirements.length, method: 'literal anchors; human blinded semantic fidelity still required' };
}
export function validateCorpus(cases) {
  const ids = new Set(), keys = new Set();
  for (const c of cases) {
    verifySeal('case', c);
    if (ids.has(c.id) || keys.has(c.key)) throw new Error('duplicate_case');
    ids.add(c.id); keys.add(c.key);
    for (const [key, value] of Object.entries({ source:c.source, planner:c.direction, prompt:c.prompt, references:c.references })) {
      if (hash(value) !== c.hashes[key]) throw new Error(`case_hash_mismatch:${key}`);
    }
    validateCoverage(c, c.prompt);
    for (const r of c.references) if (!/^[a-f0-9]{64}$/.test(r.bytesHash) || !r.role || !r.provenance || !r.width || !r.height) throw new Error('reference_incomplete');
  }
  return { cases: cases.length, strata: [...new Set(cases.map(c => c.stratum))] };
}
export function factorDiff(a, b, prefix = '') {
  if (canonical(a) === canonical(b)) return [];
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) || Array.isArray(b)) return [prefix];
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap(key => {
    const p = prefix ? `${prefix}.${key}` : key;
    return !Object.hasOwn(a, key) || !Object.hasOwn(b, key) ? [p] : factorDiff(a[key], b[key], p);
  }).sort();
}
export function makeCell(c, config, parent = null, allowedFactors = []) {
  const coverage = validateCoverage(c, config.prompt);
  const changedFactors = parent ? factorDiff(parent.config, config) : [];
  if (parent && (canonical([...allowedFactors].sort()) !== canonical(changedFactors))) throw new Error(`factor_isolation:${changedFactors.join(',')}`);
  return seal('cell', { caseId: c.id, baselineClass: 'CTRL', parentId: parent?.id ?? null, config,
    sourceHash: c.hashes.source, plannerHash: c.hashes.planner, promptHash: hash(config.prompt), referenceHash: hash(config.references),
    changedFactors, coverage, interpretation: changedFactors.includes('endpoint') ? 'route-plus-orchestration or reference route composite; never endpoint-only' : 'prespecified factor contrast' });
}
export function assertRequestedModel(cell, request) {
  if (request.model !== cell.config.model) throw new Error('actual_requested_model_mismatch');
}
export function makeManifest({ experiment, cases, cells, repetitions = 1, allowedFactors = [], interpretation, callsPerTrial, gates = [] }) {
  validateCorpus(cases);
  if (!Number.isInteger(repetitions) || repetitions < 1) throw new Error('invalid_repetitions');
  const trials = [];
  // Interleave arms inside each prespecified case/repetition block. Hash controls first arm reproducibly.
  for (const c of cases) for (let repeat = 0; repeat < repetitions; repeat++) {
    const arms = cells.filter(cell => cell.caseId === c.id);
    if (parseInt(hash(`${experiment}:${c.id}:${repeat}`).slice(0, 2), 16) % 2) arms.reverse();
    for (const cell of arms) {
      const plannedCalls={...callsPerTrial,planner:cell.config.planner.mode==='frozen'?0:callsPerTrial.planner,contextChecker:cell.config.checker.mode==='off'?0:callsPerTrial.contextChecker};
      trials.push(seal('trial', { experiment, caseId: c.id, cellId: cell.id, repeat, plannedCalls, newPurchase: 'not_authorized' }));
    }
  }
  const plannedCalls = Object.fromEntries(Object.keys(callsPerTrial).map(stage => [stage, trials.reduce((n,t)=>n+t.plannedCalls[stage],0)]));
  return seal('manifest', { schemaVersion: VERSION, sourceRevision: SOURCE_REVISION, experiment, mode: 'dry-run', baselineIds: [HIST.id, PROD.id],
    cases, cells, trials, allowedFactors, interpretation, repetitions, plannedCalls, callBudgetBasis:'maximum prespecified stage slots; a downstream evaluator not initiated after failure stays unexecuted',
    counts: { planned: trials.length, initiated: 0, dispatched: 0, completed: 0, blocked: 0, unexecuted: trials.length },
    budget: { currency: 'USD', maximumCostMicrousd: null, authorizedCostMicrousd: 0, actualCostMicrousd: 0, unknownExposure: 'all future planner/media/check/evaluator consumption unqualified', maxConcurrent: 1, maxUnreconciled: 0 },
    stopRules: ['unexpected_unsafe_output', 'critical_intent_loss', 'budget_bound', 'unknown_financial_exposure', 'systematic_access_failure', 'invalid_comparison_infrastructure'],
    gates: ['exact_manifest_user_review', 'existing_credential_consent_and_budget_workflow', 'A_stage_evidence', 'F_capability_and_consumption_qualification', 'zero_replacement_purchase_admission', ...gates],
    review: { reviewedManifestId: null, spendAuthorized: false },
  });
}
export function validateManifest(m) {
  verifySeal('manifest', m); validateCorpus(m.cases);
  const cases = new Map(m.cases.map(c => [c.id, c]));
  const cells = new Map();
  for (const cell of m.cells) {
    verifySeal('cell', cell);
    if (cells.has(cell.id)) throw new Error('duplicate_cell');
    const c = cases.get(cell.caseId);
    if (!c || cell.sourceHash !== c.hashes.source || cell.plannerHash !== c.hashes.planner || cell.promptHash !== hash(cell.config.prompt) || cell.referenceHash !== hash(cell.config.references)) throw new Error('frozen_inputs_mismatch');
    validateCoverage(c, cell.config.prompt);
    if (cell.parentId) {
      const parent = cells.get(cell.parentId);
      if (!parent || parent.caseId !== cell.caseId) throw new Error('parent_missing');
      if (canonical(factorDiff(parent.config, cell.config)) !== canonical(cell.changedFactors) || cell.changedFactors.some(f => !m.allowedFactors.includes(f))) throw new Error('factor_isolation');
    }
    cells.set(cell.id, cell);
  }
  const trialIds = new Set();
  for (const t of m.trials) {
    verifySeal('trial', t);
    if (trialIds.has(t.id) || !cells.has(t.cellId) || cells.get(t.cellId).caseId !== t.caseId || t.experiment !== m.experiment) throw new Error('trial_identity_mismatch');
    trialIds.add(t.id);
  }
  if (m.counts.planned !== m.trials.length || m.counts.unexecuted !== m.trials.length || ['initiated','dispatched','completed','blocked'].some(k=>m.counts[k]!==0)) throw new Error('dry_run_count_mismatch');
  if (m.mode !== 'dry-run' || m.review.spendAuthorized || m.budget.authorizedCostMicrousd !== 0) throw new Error('offline_only');
  return { valid: true, planned: m.trials.length, liveAdmitted: false };
}

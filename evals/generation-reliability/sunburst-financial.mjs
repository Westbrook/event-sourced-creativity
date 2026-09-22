import { outputImageBudget, OUTPUT_IMAGE_MAX_PROMPT_BYTES } from '../../worker/output-image-budget.ts';
import { qualifyImageExperimentFinancials } from '../../worker/image-financial-qualification.ts';
import { canonical, freeze, hash, seal } from './core.mjs';

export const F2_VERSION = 'sunburst-financial-2026-09-22-v1';
export const F2_REVIEWED_AT = '2026-09-22T17:12:16Z';
// An evidence-review TTL, not a promise that the undated alias is stable for a day.
export const F2_REVIEW_EXPIRES_AT = '2026-09-23T17:12:16Z';
export const F2_CELL = freeze({
  model: 'gpt-image-2.5-sunburst', endpoint: '/v1/images/generations', referenceCount: 0,
  settings: { quality: 'high', size: '1536x1024', outputFormat: 'png' },
});
export const F2_STAGE_INVENTORY = freeze([
  { stage: 'source_access_and_freeze', providerCalls: 0, costBasis: 'infrastructure_unqualified' },
  { stage: 'compiler', providerCalls: 0, costBasis: 'infrastructure_unqualified' },
  { stage: 'planner', providerCalls: 0, costBasis: 'excluded_frozen_direction' },
  { stage: 'app_moderation', providerCalls: 1, costBasis: 'documented_free', model: 'omni-moderation-latest' },
  { stage: 'image_generation', providerCalls: 1, costBasis: 'uncached_estimate_only', outputCount: 1, automaticRetries: 0 },
  { stage: 'mainline_checker_evaluator', providerCalls: 0, costBasis: 'excluded' },
  { stage: 'artifact_validation', providerCalls: 0, costBasis: 'infrastructure_unqualified' },
  { stage: 'evidence_and_artifact_storage', providerCalls: 0, costBasis: 'infrastructure_unqualified', planWrites: 1, stageReceiptWrites: 6, artifactWrites: 1 },
  { stage: 'human_review', providerCalls: 0, costBasis: 'human_time_unpriced' },
  { stage: 'original_charge_reconciliation', providerCalls: 0, costBasis: 'manual_receipt_read_infrastructure_unqualified', lifetimeConditionalReadSlots: 2, directImagesRetrievalSupported: false, maximumConditionalRetentionWrites: 2 },
]);
export const F2_PRICING_EVIDENCE = freeze({
  reviewedAt: F2_REVIEWED_AT, reviewExpiresAt: F2_REVIEW_EXPIRES_AT,
  pricingUrl: 'https://developers.openai.com/api/docs/pricing',
  modelUrl: 'https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst',
  moderationUrl: 'https://developers.openai.com/api/docs/guides/moderation',
  calculatorUrl: 'https://developers.openai.com/_astro/GptImageTokenCalculator.react.Z2Zu5XGo.js',
  calculatorSha256: '893dc3f5500595ac138e607ed0f59aff87bd92354938ec9213e089c0a5d0b60a',
  calculatorOutputTokens: 1372,
  usdPerMillionTokens: { textInput: 5, imageInput: 8, imageOutput: 30 },
  cacheDiscountAssumed: false, requestedAliasSnapshot: null,
});

/** Offline evidence worksheet only. No credential, private-source reader, purchase
 * authority, transport, settlement mutation, or positive admission path exists.
 * H must resolve owner access and retention BEFORE handing private bytes here.
 * Hashes bind evidence; neither hashes nor caller-provided provenance grant access. */
export function qualifySunburstFinancialCell({ cell = F2_CELL, prompts = [], captureEvidence = null, stageInventory = null, now = F2_REVIEWED_AT } = {}) {
  const gaps = [];
  const exactCell = canonical(cell) === canonical(F2_CELL);
  if (!exactCell) gaps.push('outside_exact_f2_cell');
  if (canonical(stageInventory) !== canonical(F2_STAGE_INVENTORY)) gaps.push('stage_inventory_missing_or_changed');
  const time = Date.parse(now);
  if (!Number.isFinite(time) || time < Date.parse(F2_REVIEWED_AT) || time >= Date.parse(F2_REVIEW_EXPIRES_AT)) gaps.push('pricing_review_expired_or_invalid');
  if (!Array.isArray(prompts) || !prompts.length || prompts.length > 2) gaps.push('exact_c_h_prompt_set_missing_or_invalid');
  // Descriptive metadata only; H independently verifies the capture seal and
  // authority. Never accept a caller boolean as private access or paid consent.
  const capture = {
    id: captureEvidence?.id ?? null, evidenceClass: captureEvidence?.evidenceClass ?? 'unknown',
    sourceBytesHash: captureEvidence?.sourceBytesHash ?? null,
    directionBytesHash: captureEvidence?.directionBytesHash ?? null,
    directionProvenance: captureEvidence?.directionProvenance ?? 'unknown',
  };
  if (!capture.id || ![capture.sourceBytesHash, capture.directionBytesHash].every(v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v))) gaps.push('source_direction_capture_missing');
  if (capture.directionProvenance !== 'retained-actual-planner-output') gaps.push('actual_planner_direction_missing_separate_preparation_required');
  const ids = new Set();
  const promptEvidence = (Array.isArray(prompts) ? prompts : []).map(entry => {
    if (!entry || typeof entry.id !== 'string' || !entry.id.trim() || ids.has(entry.id)
      || typeof entry.captureId !== 'string' || !entry.captureId.trim() || typeof entry.prompt !== 'string') {
      gaps.push('prompt_capture_identity_invalid');
      return null;
    }
    ids.add(entry.id);
    if (capture.id !== entry.captureId) gaps.push('prompt_capture_binding_mismatch');
    const bytes = Buffer.byteLength(entry.prompt, 'utf8');
    // Shared preparedPrompt trims; require a future transport to preserve the
    // reviewed bytes. Never silently trim/normalize here or invent a new capture.
    const valid = entry.prompt.length > 0 && entry.prompt === entry.prompt.trim()
      && Buffer.from(entry.prompt, 'utf8').toString('utf8') === entry.prompt
      && bytes <= OUTPUT_IMAGE_MAX_PROMPT_BYTES;
    if (!valid) gaps.push('prompt_empty_noncanonical_or_over_byte_limit');
    const budget = exactCell && valid ? outputImageBudget(cell.model, cell.settings.size, bytes) : null;
    return {
      id: entry.id, captureId: entry.captureId, sha256: hash(entry.prompt), utf8Bytes: bytes,
      estimatedOutputTokens: budget?.estimatedOutputTokens ?? null,
      applicationInputTokenAllowance: budget?.maximumInputTokens ?? null,
      applicationOutputTokenAllowance: budget?.maximumOutputTokens ?? null,
      conservativeImageEstimateMicrousd: budget?.maximumMicrousd ?? null,
      estimateVersion: budget?.version ?? null,
    };
  });
  gaps.push('consumption_allowance_not_a_verified_upper_bound', 'charge_reconciliation_unqualified',
    'storage_retention_and_operational_costs_unqualified', 'no_live_authorization_in_this_task');
  const estimates = promptEvidence.map(p => p?.conservativeImageEstimateMicrousd ?? null);
  const estimate = estimates.length && estimates.every(n => n !== null) ? estimates.reduce((sum, n) => sum + n, 0) : null;
  return seal('f2-financial', {
    version: F2_VERSION, cell: structuredClone(cell), cellHash: hash(cell),
    available: false, maximumCostMicrousd: null, providerEnforcedChargeCap: false,
    status: 'unavailable_pending_separate_empirical_qualification',
    evaluatedAt: now, pricingEvidence: F2_PRICING_EVIDENCE, captureEvidence: capture,
    stageInventoryHash: hash(stageInventory), promptEvidence,
    components: {
      imageGeneration: { state: 'estimate_only', conservativeMicrousd: estimate },
      standaloneModeration: { state: 'documented_free', providerFeeMicrousd: 0, callsPerTrial: 1 },
      cache: { state: 'discount_not_used', settlementCachedSplit: null },
      referencesAndPartials: { state: exactCell ? 'not_applicable' : 'outside_scope' },
      plannerMainlineCheckerEvaluator: { state: 'excluded', callsPerTrial: 0 },
      infrastructureAndHumanReview: { state: 'unqualified', maximumMicrousd: null },
    },
    inheritedFinancialGate: qualifyImageExperimentFinancials(F2_CELL, OUTPUT_IMAGE_MAX_PROMPT_BYTES).available,
    limits: {
      maximumPromptUtf8Bytes: OUTPUT_IMAGE_MAX_PROMPT_BYTES, maximumConcurrentInFlight: 1,
      automaticGenerationRetries: 0, authorizedAllowanceMicrousd: 0,
      maximumUnreconciledExposureMicrousd: null, newDispatchAllowed: false,
    },
    gaps: [...new Set(gaps)],
  });
}

/** Upper-rate arithmetic for already observed usage; NOT a measured charge or
 * settlement record. Missing cache splits do not require inventing zero splits.
 * Unexpected image-input usage is held even though its rate is documented. */
export function estimateUncachedSunburstReceipt(usage) {
  if (!usage || !['textInputTokens', 'imageInputTokens', 'outputTokens', 'inputTokens', 'totalTokens']
    .every(k => Number.isSafeInteger(usage[k]) && usage[k] >= 0)) return null;
  if (usage.imageInputTokens !== 0 || usage.inputTokens !== usage.textInputTokens
    || usage.totalTokens !== usage.inputTokens + usage.outputTokens) return null;
  const cost = usage.textInputTokens * 5 + usage.outputTokens * 30;
  return Number.isSafeInteger(cost) ? {
    conservativeMicrousd: cost, measuredChargeMicrousd: null, cachedTokenSplit: null,
    basis: 'all_observed_input_uncached_upper_rate_only', version: F2_VERSION,
  } : null;
}

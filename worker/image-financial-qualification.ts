import { outputImageBudget } from "./output-image-budget.ts";
import { IMAGE_CANDIDATE_MODELS, type ImageExperimentCell } from "./image-operation-capabilities.ts";

export const IMAGE_FINANCIAL_VERSION = "image-financial-2026-09-22-v1";
export const IMAGE_PRICING_PROVENANCE = Object.freeze({
  reviewedAt: "2026-09-22", source: "https://developers.openai.com/api/docs/pricing",
  modelSources: ["https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst", "https://developers.openai.com/api/docs/models/gpt-image-2.5-flare"],
  usdPerMillionTokens: { textInput: 5, cachedTextInput: 1.25, imageInput: 8, cachedImageInput: 2, imageOutput: 30 },
  partialImageOutputTokens: 100, partialSource: "https://developers.openai.com/api/docs/guides/image-generation#partial-images-cost",
  partialInReportedUsage: "unknown", providerEnforcedChargeCap: false,
});
type Component = { state: "estimated" | "unavailable" | "not_applicable"; maximumMicrousd: number | null; evidence: string };
const unavailable = (evidence: string): Component => ({ state: "unavailable", maximumMicrousd: null, evidence });
const absent = (evidence: string): Component => ({ state: "not_applicable", maximumMicrousd: 0, evidence });
/** Existing Output estimate is a narrow application allowance, never qualification
 * of the experiment as a whole, Replay, reference inputs or another model. */
export function qualifyImageExperimentFinancials(cell: ImageExperimentCell, promptBytes: number) {
  const direct = cell.endpoint === "/v1/images/generations";
  const knownRates = IMAGE_CANDIDATE_MODELS.includes(cell.model);
  const budget = direct && cell.referenceCount === 0 && cell.settings.quality === "high" && !cell.settings.stream && !(cell.settings.partialImages ?? 0)
    ? outputImageBudget(cell.model, cell.settings.size ?? "auto", promptBytes) : null;
  const components = {
    noReferenceOutput: budget ? { state: "estimated" as const, maximumMicrousd: budget.maximumMicrousd, evidence: budget.version } : unavailable("No exact-model/quality/size output allowance in the current registry."),
    referenceInput: cell.referenceCount ? unavailable("Reference token consumption requires separate empirical qualification.") : absent("No references selected."),
    cachedInput: unavailable("Rates documented; current image receipts do not qualify cached text/image splits. No cache discount assumed."),
    partialImages: cell.settings.stream ? unavailable("100 output tokens per delivered partial documented; inclusion in aggregate usage unverified. Never add it twice.") : absent("Non-streaming cell."),
    orchestration: unavailable(cell.endpoint === "/v1/responses" ? "Mainline/tool/planner/check/evaluator calls need separate bounds and receipts." : "Planner/check/evaluator inventory and bounds must be qualified separately."),
  };
  return { version: IMAGE_FINANCIAL_VERSION, model: cell.model, ratesRegistered: knownRates,
    components, available: false as const, maximumCostMicrousd: null,
    reason: "End-to-end consumption/exposure not qualified; retain Replay and existing admission guards.",
    providerEnforcedChargeCap: false as const };
}

export type ImageUsageForPricing = {
  textInputTokens: number; imageInputTokens: number; outputTokens: number;
  cachedTextInputTokens: number; cachedImageInputTokens: number;
  deliveredPartialImages: number; partialTokensInOutput: "included" | "excluded" | "unknown";
};
/** Price evidenced usage only. Caller must reconcile authoritative receipts first;
 * this does not manufacture a maximum charge or overwrite production accounting. */
export function priceQualifiedImageUsage(model: string, usage: ImageUsageForPricing) {
  if (!IMAGE_CANDIDATE_MODELS.includes(model)) return null;
  for (const count of [usage.textInputTokens, usage.imageInputTokens, usage.outputTokens, usage.cachedTextInputTokens, usage.cachedImageInputTokens, usage.deliveredPartialImages]) {
    if (!Number.isSafeInteger(count) || count < 0) return null;
  }
  if (usage.cachedTextInputTokens > usage.textInputTokens || usage.cachedImageInputTokens > usage.imageInputTokens || usage.deliveredPartialImages > 3) return null;
  if (!["included", "excluded", "unknown"].includes(usage.partialTokensInOutput)) return null;
  if (usage.deliveredPartialImages && usage.partialTokensInOutput === "unknown") return null;
  const outputTokens = usage.outputTokens + (usage.partialTokensInOutput === "excluded" ? usage.deliveredPartialImages * 100 : 0);
  const cost = (usage.textInputTokens - usage.cachedTextInputTokens) * 5 + usage.cachedTextInputTokens * 1.25
    + (usage.imageInputTokens - usage.cachedImageInputTokens) * 8 + usage.cachedImageInputTokens * 2 + outputTokens * 30;
  return Number.isSafeInteger(Math.ceil(cost)) ? { costMicrousd: Math.ceil(cost), version: IMAGE_FINANCIAL_VERSION, partialFeeAdded: usage.partialTokensInOutput === "excluded" } : null;
}

export type ExposureLedger = {
  maximumConcurrentInFlight: number; maximumUnreconciledMicrousd: number; authorizedAllowanceMicrousd: number;
  settledMicrousd: number; inFlight: Array<{ operationId: string; maximumMicrousd: number | null }>;
  unreconciled: Array<{ operationId: string; maximumMicrousd: number | null }>;
};
/** Pure fail-closed check. The dispatcher must check+reserve atomically; a pass is
 * not authority to purchase, and reservations are not provider-enforced caps. */
export function checkImageExperimentExposure(ledger: ExposureLedger, next: { operationId: string; maximumMicrousd: number | null }) {
  const fail = (reason: string) => ({ allowed: false, reason, providerEnforcedChargeCap: false as const });
  const amount = (n: number | null) => n !== null && Number.isSafeInteger(n) && n >= 0;
  if (!Number.isSafeInteger(ledger.maximumConcurrentInFlight) || ledger.maximumConcurrentInFlight < 1
    || ![ledger.maximumUnreconciledMicrousd, ledger.authorizedAllowanceMicrousd, ledger.settledMicrousd].every(amount)) return fail("invalid_limits");
  const outstanding = [...ledger.inFlight, ...ledger.unreconciled];
  if (!next.operationId.trim() || outstanding.some(o => !o.operationId.trim()) || new Set(outstanding.map(o => o.operationId)).size !== outstanding.length) return fail("invalid_operation_identity");
  if (outstanding.some(o => o.operationId === next.operationId)) return fail("original_operation_requires_reconciliation");
  if (!amount(next.maximumMicrousd) || outstanding.some(o => !amount(o.maximumMicrousd))) return fail("unknown_exposure_stop_dispatch");
  if (ledger.inFlight.length >= ledger.maximumConcurrentInFlight) return fail("concurrency_limit");
  const exposure = outstanding.reduce((total, o) => total + o.maximumMicrousd!, next.maximumMicrousd!);
  const total = ledger.settledMicrousd + exposure;
  if (!Number.isSafeInteger(exposure) || !Number.isSafeInteger(total)) return fail("unknown_exposure_stop_dispatch");
  // In-flight purchases are also not yet reconciled. Include both sets.
  if (exposure > ledger.maximumUnreconciledMicrousd) return fail("unreconciled_exposure_limit");
  if (total > ledger.authorizedAllowanceMicrousd) return fail("authorized_allowance_exceeded");
  return { allowed: true, reason: "within_application_estimates", estimatedExposureMicrousd: exposure, providerEnforcedChargeCap: false as const };
}

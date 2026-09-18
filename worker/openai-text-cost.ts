import type { ProviderCostBreakdown } from "./replay-cost.ts";

/** Standard direct-API tariffs verified on this date; never reprice settled historical receipts. */
export const OPENAI_TEXT_PRICING_VERSION = "openai-text-2026-09-02";
export const OPENAI_TEXT_LONG_CONTEXT_THRESHOLD = 272_000;
export type OpenAITextModel = "gpt-5.6-terra" | "gpt-5.6-sol" | "gpt-5.6-luna";

// Integer nano-USD/token avoids floating-point ceil errors at micro-USD boundaries.
// https://developers.openai.com/api/docs/pricing
const STANDARD_RATES_NANOUSD = {
  "gpt-5.6-terra": { input: 2_000, cachedInput: 200, cacheWrite: 2_500, output: 12_000 },
  "gpt-5.6-sol": { input: 4_000, cachedInput: 400, cacheWrite: 5_000, output: 20_000 },
  "gpt-5.6-luna": { input: 200, cachedInput: 20, cacheWrite: 250, output: 1_200 },
} as const;

export type OpenAITextDerivedUsageField = "cachedInputTokens" | "cacheWriteTokens";
export type OpenAITextRequestPolicy = Readonly<{
  cachePolicy: "disabled-explicit";
  promptCacheMode: "explicit";
  explicitBreakpoints: 0;
}>;
export type OpenAITextUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  /** Already included in outputTokens. Null means not disclosed, never zero by inference. */
  reasoningTokens: number | null;
  /** Request evidence is separate from provider-reported token counters. */
  accountingEvidence?: {
    requestPolicy: OpenAITextRequestPolicy;
    derivedUsageFields: readonly OpenAITextDerivedUsageField[];
  };
};

export class OpenAITextAccountingError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message); this.name = "OpenAITextAccountingError"; this.code = code;
  }
}

const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const tokenCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function validateUsage(usage: OpenAITextUsage): void {
  if (![usage.inputTokens, usage.outputTokens, usage.totalTokens, usage.cachedInputTokens, usage.cacheWriteTokens].every(tokenCount)
    || usage.totalTokens !== usage.inputTokens + usage.outputTokens
    || usage.cachedInputTokens + usage.cacheWriteTokens > usage.inputTokens
    || usage.reasoningTokens !== null && (!tokenCount(usage.reasoningTokens) || usage.reasoningTokens > usage.outputTokens)) {
    throw new OpenAITextAccountingError("openai_text_usage_invalid", "The provider token evidence is inconsistent; retain the reservation for review.");
  }
}

/** Default decoding is strict. Only a verified explicit/no-breakpoint request permits absent cache counters to be derived. */
export function readOpenAITextUsage(value: unknown, options?: { cachePolicy: "disabled-explicit" }): OpenAITextUsage {
  if (options !== undefined && record(options).cachePolicy !== "disabled-explicit") {
    throw new OpenAITextAccountingError("openai_text_request_policy_invalid", "Only a verified explicit no-cache request can supply missing cache evidence.");
  }
  const raw = record(value), input = record(raw.input_tokens_details), output = record(raw.output_tokens_details);
  const disabled = options?.cachePolicy === "disabled-explicit";
  if (Object.hasOwn(raw, "input_tokens_details") && (raw.input_tokens_details === null || typeof raw.input_tokens_details !== "object" || Array.isArray(raw.input_tokens_details))) {
    throw new OpenAITextAccountingError("openai_text_usage_invalid", "Malformed cache details are not absent cache evidence.");
  }
  const derivedUsageFields: OpenAITextDerivedUsageField[] = [];
  const cacheCounter = (key: "cached_tokens" | "cache_write_tokens", field: OpenAITextDerivedUsageField): unknown => {
    if (Object.hasOwn(input, key)) return input[key];
    if (!disabled) throw new OpenAITextAccountingError("openai_text_usage_details_missing", "The provider did not disclose complete cache accounting; retain the original reservation.");
    derivedUsageFields.push(field);
    return 0;
  };
  const usage = {
    inputTokens: raw.input_tokens, outputTokens: raw.output_tokens, totalTokens: raw.total_tokens,
    cachedInputTokens: cacheCounter("cached_tokens", "cachedInputTokens"), cacheWriteTokens: cacheCounter("cache_write_tokens", "cacheWriteTokens"),
    reasoningTokens: Object.hasOwn(output, "reasoning_tokens") ? output.reasoning_tokens : null,
  } as OpenAITextUsage;
  validateUsage(usage);
  if (disabled) {
    if (usage.cachedInputTokens !== 0 || usage.cacheWriteTokens !== 0) {
      throw new OpenAITextAccountingError("openai_text_usage_request_policy_conflict", "The provider cache counters conflict with the explicit no-cache request; retain the reservation.");
    }
    usage.accountingEvidence = { requestPolicy: { cachePolicy: "disabled-explicit", promptCacheMode: "explicit", explicitBreakpoints: 0 }, derivedUsageFields };
  }
  return usage;
}

export type OpenAITextCostReceipt = ProviderCostBreakdown & {
  pricingVersion: typeof OPENAI_TEXT_PRICING_VERSION;
  costBasis: "measured_usage_published_tariff" | "measured_usage_request_policy_published_tariff";
  requestPolicy: OpenAITextRequestPolicy | null;
  derivedUsageFields: readonly OpenAITextDerivedUsageField[];
  model: OpenAITextModel;
  serviceTier: "default";
  contextBand: "short" | "long";
  usage: OpenAITextUsage;
  ratesNanousdPerToken: { input: number; cachedInput: number; cacheWrite: number; output: number };
};

/** Only explicit, known direct-API model IDs are priced. No unknown-model fallback. */
export function hasCurrentOpenAITextPricing(model: string): model is OpenAITextModel {
  return Object.hasOwn(STANDARD_RATES_NANOUSD, model);
}

const micros = (nano: bigint): number => {
  const amount = Number((nano + 999n) / 1_000n);
  if (!Number.isSafeInteger(amount)) throw new OpenAITextAccountingError("openai_text_cost_overflow", "The measured cost exceeds the supported ledger range.");
  return amount;
};

/** Price each call once, then persist this tariff and breakdown with its immutable call identity. */
export function priceCurrentOpenAITextUsage(model: string, usage: OpenAITextUsage, serviceTier = "default"): OpenAITextCostReceipt {
  if (!hasCurrentOpenAITextPricing(model)) throw new OpenAITextAccountingError("openai_text_model_price_unknown", "This model has no verified text-price contract.");
  if (serviceTier !== "default") throw new OpenAITextAccountingError("openai_text_service_tier_unpriced", "This text-price contract covers only standard direct-API processing.");
  validateUsage(usage);
  const { accountingEvidence, ...tokenUsage } = usage;
  const requestPolicy = accountingEvidence?.requestPolicy ?? null;
  const derivedUsageFields = accountingEvidence?.derivedUsageFields ?? [];
  if (accountingEvidence !== undefined && (requestPolicy?.cachePolicy !== "disabled-explicit" || requestPolicy.promptCacheMode !== "explicit"
    || requestPolicy.explicitBreakpoints !== 0 || !Array.isArray(derivedUsageFields)
    || derivedUsageFields.some(field => field !== "cachedInputTokens" && field !== "cacheWriteTokens")
    || new Set(derivedUsageFields).size !== derivedUsageFields.length || usage.cachedInputTokens !== 0 || usage.cacheWriteTokens !== 0)) {
    throw new OpenAITextAccountingError("openai_text_usage_request_policy_conflict", "The usage derivation does not match the recorded request policy.");
  }
  const base = STANDARD_RATES_NANOUSD[model], long = usage.inputTokens > OPENAI_TEXT_LONG_CONTEXT_THRESHOLD;
  const rates = {
    input: base.input * (long ? 2 : 1), cachedInput: base.cachedInput * (long ? 2 : 1),
    cacheWrite: base.cacheWrite * (long ? 2 : 1), output: base.output * (long ? 1.5 : 1),
  };
  const ordinary = usage.inputTokens - usage.cachedInputTokens - usage.cacheWriteTokens;
  const textInputMicrousd = micros(BigInt(ordinary) * BigInt(rates.input)
    + BigInt(usage.cachedInputTokens) * BigInt(rates.cachedInput)
    + BigInt(usage.cacheWriteTokens) * BigInt(rates.cacheWrite));
  const textOutputMicrousd = micros(BigInt(usage.outputTokens) * BigInt(rates.output));
  const totalMicrousd = textInputMicrousd + textOutputMicrousd;
  if (!Number.isSafeInteger(totalMicrousd)) throw new OpenAITextAccountingError("openai_text_cost_overflow", "The measured cost exceeds the supported ledger range.");
  return {
    pricingVersion: OPENAI_TEXT_PRICING_VERSION,
    costBasis: derivedUsageFields.length ? "measured_usage_request_policy_published_tariff" : "measured_usage_published_tariff",
    requestPolicy: requestPolicy ? { ...requestPolicy } : null, derivedUsageFields: [...derivedUsageFields], model,
    serviceTier: "default", contextBand: long ? "long" : "short", usage: tokenUsage, ratesNanousdPerToken: rates,
    textInputMicrousd, textOutputMicrousd, imageTextInputMicrousd: 0, imageInputMicrousd: 0, imageOutputMicrousd: 0, totalMicrousd,
  };
}

/** A reservation assumes all possible input is a cache write; no cache hit is promised. */
export function estimateOpenAITextCallMaximumMicrousd(model: string, maximumInputTokens: number, maximumOutputTokens: number): number {
  if (!tokenCount(maximumInputTokens) || !tokenCount(maximumOutputTokens) || maximumInputTokens > 1_050_000 || maximumOutputTokens > 128_000
    || maximumInputTokens + maximumOutputTokens > 1_050_000) {
    throw new OpenAITextAccountingError("openai_text_request_limit_invalid", "The request allowance must fit the model context and output limits.");
  }
  // max_output_tokens includes visible, reasoning, and non-visible formatting tokens.
  return priceCurrentOpenAITextUsage(model, {
    inputTokens: maximumInputTokens, outputTokens: maximumOutputTokens, totalTokens: maximumInputTokens + maximumOutputTokens,
    cachedInputTokens: 0, cacheWriteTokens: maximumInputTokens, reasoningTokens: null,
  }).totalMicrousd;
}

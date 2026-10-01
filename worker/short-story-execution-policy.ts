import {
  OPENAI_TEXT_PRICING_VERSION,
  estimateOpenAITextCallMaximumMicrousd,
  priceCurrentOpenAITextUsage,
  readOpenAITextUsage,
  type OpenAITextCostReceipt,
  type OpenAITextUsage,
} from "./openai-text-cost.ts";
import { OUTPUT_NATIVE_EXECUTION_POLICY } from "../src/model/output-execution-policy.ts";

/** Disconnected classification only. These values grant no execution or financial authority. */
export const SHORT_STORY_EXECUTION_POLICY = Object.freeze({
  profile: "personal-owner-manual-document-short_story-v1",
  routeVersion: "forma.short-story.execution@1",
  requestAllowanceVersion: "forma.short-story.request-allowance@1",
  pricingVersion: "openai-text-2026-09-02",
  model: "gpt-5.6-terra", effort: "low", serviceTier: "default",
  cachePolicy: "disabled-explicit", promptCacheMode: "explicit", explicitBreakpoints: 0,
  verbosity: "medium", store: false, truncation: "disabled",
  itemCount: 1, movements: 1, artifactFiles: 1,
  stages: Object.freeze(["planning:0:initial", "planning:0:repair"] as const),
  maxCalls: 2, requestAllowanceOverhead: 4_096, maximumSerializedRequestBytes: 53_904,
  maxInputAllowance: 58_000, maxOutputTokens: 6_000, perCallTokens: 64_000,
  aggregateTokens: 128_000, perCallMicrousd: 217_000, aggregateMicrousd: 434_000,
  ratesNanousdPerToken: Object.freeze({ input: 2_000, cachedInput: 200, cacheWrite: 2_500, output: 12_000 }),
  maximumMilliseconds: 240_000, heartbeatMilliseconds: 60_000, maximumRenewals: 3,
  // Parser transport limits, not provider context or financial allowances.
  serializedInputLimits: Object.freeze({ requestBytes: 65_536, capsBytes: 2_048, evidenceBytes: 1_000_000 }),
  qualification: "described-policy-only",
  connectedGuaranteesImplemented: false,
} as const);

const POLICY = SHORT_STORY_EXECUTION_POLICY;
type Data = Record<string, unknown>;
export type ShortStoryDisposition = "eligible" | "invalid" | "quarantine";
export type ShortStoryStage = typeof POLICY.stages[number];
export type ShortStoryRequestAssessment = Readonly<{
  disposition: "eligible" | "invalid";
  reasons: readonly string[];
  serializedRequest: string | null;
  byteLength: number | null;
  inputAllowance: number | null;
  formatName: "document_short_story" | "document_short_story_repair" | null;
}>;
export type ShortStoryCapsAssessment = Readonly<{
  disposition: "within_bounds" | "out_of_bounds";
  reasons: readonly string[];
  qualification: "arithmetic-only";
}>;
export type ShortStoryCallAssessment = Readonly<{
  stage: ShortStoryStage | null;
  callId: string | null;
  clientRequestId: string | null;
  providerResponseId: string | null;
  disposition: ShortStoryDisposition;
  reasons: readonly string[];
  request: ShortStoryRequestAssessment | null;
  observedUsageJson: string | null;
  usage: Readonly<OpenAITextUsage> | null;
  cost: Readonly<OpenAITextCostReceipt> | null;
  usable: boolean;
  describedValidationRepairConditionsMatch: boolean;
}>;
export type ShortStoryExecutionAssessment = Readonly<{
  qualification: "described-policy-only";
  connectedGuaranteesImplemented: false;
  authorizations: Readonly<{ dispatch: false; settlement: false; publication: false; certifiedRecovery: false }>;
  disposition: ShortStoryDisposition;
  reasons: readonly string[];
  /** Exact supplied private evidence, including paid facts that could not be classified. Not a public response. */
  capturedEvidence: string | null;
  calls: readonly ShortStoryCallAssessment[];
  aggregateTokens: number | null;
  aggregateMicrousd: number | null;
  repair: Readonly<{
    disposition: "ineligible";
    dispatchEligible: false;
    descriptiveAssessment: Readonly<{
      disposition: "awaiting-trusted-evidence" | "conditions-not-satisfied";
      conditionsSatisfied: boolean;
      reasons: readonly string[];
    }>;
    unimplementedPrerequisites: readonly ["genuine-validation", "retained-evidence-custody", "current-original-authority"];
  }>;
}>;

const record = (value: unknown): value is Data => value !== null && typeof value === "object" && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const identity = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 200 && value.trim() === value;
const exact = (value: unknown, keys: readonly string[]): value is Data => record(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const oneOf = (value: unknown, choices: readonly unknown[]): boolean => choices.includes(value);

// Only owned JSON.parse results and locally constructed records reach this function.
function freezeOwned<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeOwned(child);
    Object.freeze(value);
  }
  return value;
}

/** No caller hooks. The cheap code-unit bound prevents an unbounded temporary UTF-8 allocation. */
function captureSerialized(value: unknown, maximumBytes: number): { captured: string | null; byteLength: number | null; problem: string | null } {
  if (typeof value !== "string") return { captured: null, byteLength: null, problem: "serialized_data_required" };
  // UTF-8 bytes are never fewer than UTF-16 code units, including replacement of lone surrogates.
  if (value.length > maximumBytes) return { captured: value, byteLength: null, problem: "serialized_byte_limit_exceeded" };
  const byteLength = new TextEncoder().encode(value).byteLength;
  return byteLength > maximumBytes
    ? { captured: value, byteLength, problem: "serialized_byte_limit_exceeded" }
    : { captured: value, byteLength, problem: null };
}

function dependenciesCurrent(): boolean {
  if (OPENAI_TEXT_PRICING_VERSION !== POLICY.pricingVersion
    || OUTPUT_NATIVE_EXECUTION_POLICY.maximumMilliseconds !== POLICY.maximumMilliseconds
    || OUTPUT_NATIVE_EXECUTION_POLICY.heartbeatMilliseconds !== POLICY.heartbeatMilliseconds
    || OUTPUT_NATIVE_EXECUTION_POLICY.maximumRenewals !== POLICY.maximumRenewals) return false;
  try {
    const receipt = priceCurrentOpenAITextUsage(POLICY.model, {
      inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, reasoningTokens: null,
    }, POLICY.serviceTier);
    return receipt.pricingVersion === POLICY.pricingVersion && receipt.model === POLICY.model
      && receipt.serviceTier === POLICY.serviceTier && receipt.contextBand === "short"
      && Object.entries(POLICY.ratesNanousdPerToken).every(([key, rate]) => receipt.ratesNanousdPerToken[key as keyof typeof POLICY.ratesNanousdPerToken] === rate)
      && estimateOpenAITextCallMaximumMicrousd(POLICY.model, POLICY.maxInputAllowance, POLICY.maxOutputTokens) === POLICY.perCallMicrousd
      && POLICY.perCallTokens * POLICY.maxCalls === POLICY.aggregateTokens
      && POLICY.perCallMicrousd * POLICY.maxCalls === POLICY.aggregateMicrousd;
  } catch { return false; }
}

/** Measures the supplied exact string, not a reconstructed request. Opaque content/schema are not validated artifacts. */
export function readShortStoryExecutionRequest(serializedRequest: unknown): ShortStoryRequestAssessment {
  const reasons: string[] = [];
  const capture = captureSerialized(serializedRequest, POLICY.serializedInputLimits.requestBytes);
  const { captured, byteLength } = capture;
  const inputAllowance = byteLength === null ? null : byteLength + POLICY.requestAllowanceOverhead;
  let formatName: ShortStoryRequestAssessment["formatName"] = null;
  if (!dependenciesCurrent()) reasons.push("policy_dependency_changed");
  if (capture.problem !== null) reasons.push(capture.problem);
  if (typeof serializedRequest !== "string") reasons.push("serialized_request_required");
  else if (byteLength === null || byteLength > POLICY.maximumSerializedRequestBytes || !count(inputAllowance) || inputAllowance > POLICY.maxInputAllowance) reasons.push("request_bytes_exceeded");
  if (capture.problem === null && captured !== null && !reasons.includes("request_bytes_exceeded")) {
    try {
      const request = JSON.parse(captured) as unknown;
      if (!exact(request, ["model", "instructions", "input", "text", "reasoning", "max_output_tokens", "store", "safety_identifier", "service_tier", "prompt_cache_options", "truncation"])
        || request.model !== POLICY.model || typeof request.instructions !== "string" || typeof request.input !== "string"
        || request.max_output_tokens !== POLICY.maxOutputTokens || request.store !== false || request.service_tier !== POLICY.serviceTier
        || request.truncation !== POLICY.truncation || !identity(request.safety_identifier)
        || !exact(request.reasoning, ["effort"]) || request.reasoning.effort !== POLICY.effort
        || !exact(request.prompt_cache_options, ["mode"]) || request.prompt_cache_options.mode !== POLICY.promptCacheMode
        || !exact(request.text, ["verbosity", "format"]) || request.text.verbosity !== POLICY.verbosity
        || !exact(request.text.format, ["type", "name", "strict", "schema"])
        || request.text.format.type !== "json_schema" || request.text.format.strict !== true || !record(request.text.format.schema)
        || !oneOf(request.text.format.name, ["document_short_story", "document_short_story_repair"])) {
        reasons.push("request_policy_invalid");
      } else formatName = request.text.format.name as typeof formatName;
    } catch { reasons.push("request_policy_invalid"); }
  }
  return freezeOwned({ disposition: reasons.length ? "invalid" : "eligible", reasons, serializedRequest: captured, byteLength, inputAllowance, formatName });
}

type CapDimensions = {
  requestInputAllowance: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  costMicrousd: number | null;
  aggregateTokens: number | null;
  aggregateMicrousd: number | null;
};

/** Internal nulls are unknown dimensions, never zero. Known dimensions remain independently enforceable. */
function evaluateCaps(c: CapDimensions): string[] {
  const reasons: string[] = [];
  if (c.requestInputAllowance !== null && (c.requestInputAllowance < POLICY.requestAllowanceOverhead || c.requestInputAllowance > POLICY.maxInputAllowance)) reasons.push("request_allowance_invalid");
  if (c.inputTokens !== null && c.outputTokens !== null && c.totalTokens !== null
    && (!Number.isSafeInteger(c.inputTokens + c.outputTokens) || c.totalTokens !== c.inputTokens + c.outputTokens)) reasons.push("token_sum_invalid");
  if (c.inputTokens !== null && c.requestInputAllowance !== null && c.inputTokens > c.requestInputAllowance) reasons.push("exact_request_input_exceeded");
  if (c.inputTokens !== null && c.inputTokens > POLICY.maxInputAllowance) reasons.push("input_cap_exceeded");
  if (c.outputTokens !== null && c.outputTokens > POLICY.maxOutputTokens) reasons.push("output_cap_exceeded");
  if (c.totalTokens !== null && c.totalTokens > POLICY.perCallTokens) reasons.push("call_token_cap_exceeded");
  if (c.costMicrousd !== null && c.costMicrousd > POLICY.perCallMicrousd) reasons.push("call_cost_cap_exceeded");
  if (c.aggregateTokens !== null && c.aggregateTokens > POLICY.aggregateTokens) reasons.push("aggregate_token_cap_exceeded");
  if (c.aggregateMicrousd !== null && c.aggregateMicrousd > POLICY.aggregateMicrousd) reasons.push("aggregate_cost_cap_exceeded");
  return reasons;
}

/** Numeric limit checks only: supplied cost is not evidence that a provider receipt is correctly priced. */
export function classifyShortStoryExecutionCaps(serializedCaps: unknown): ShortStoryCapsAssessment {
  const reasons: string[] = [];
  try {
    const capture = captureSerialized(serializedCaps, POLICY.serializedInputLimits.capsBytes);
    if (capture.problem !== null || capture.captured === null) throw new Error("caps_invalid");
    const caps = JSON.parse(capture.captured) as unknown;
    if (!exact(caps, ["requestInputAllowance", "inputTokens", "outputTokens", "totalTokens", "costMicrousd", "aggregateTokens", "aggregateMicrousd"])
      || !Object.values(caps).every(count)) reasons.push("caps_invalid");
    else reasons.push(...evaluateCaps(caps as CapDimensions));
  } catch { reasons.push("caps_invalid"); }
  return freezeOwned({ disposition: reasons.length ? "out_of_bounds" : "within_bounds", reasons, qualification: "arithmetic-only" });
}

function classifyCall(value: unknown): ShortStoryCallAssessment {
  const reasons: string[] = [];
  const call = record(value) ? value : {};
  const stage = oneOf(call.stage, POLICY.stages) ? call.stage as ShortStoryStage : null;
  const callId = identity(call.callId) ? call.callId : null;
  const clientRequestId = identity(call.clientRequestId) ? call.clientRequestId : null;
  const providerResponseId = identity(call.providerResponseId) ? call.providerResponseId : null;
  if (!exact(call, ["stage", "callId", "clientRequestId", "providerResponseId", "serializedRequest", "response"])
    || stage === null || callId === null || clientRequestId === null || providerResponseId === null) reasons.push("call_identity_invalid");
  const request = readShortStoryExecutionRequest(call.serializedRequest);
  if (request.disposition !== "eligible") reasons.push(...request.reasons);
  if (stage !== null && request.formatName !== (stage === POLICY.stages[0] ? "document_short_story" : "document_short_story_repair")) reasons.push("stage_request_mismatch");
  const response = record(call.response) ? call.response : {};
  const responseShape = exact(response, ["model", "serviceTier", "status", "messageStatus", "refused", "hasError", "hasIncompleteDetails", "fullyRetained", "validation", "usage"])
    && (response.model === null || typeof response.model === "string") && (response.serviceTier === null || typeof response.serviceTier === "string")
    && oneOf(response.status, ["completed", "incomplete", "failed", null]) && oneOf(response.messageStatus, ["completed", "incomplete", "failed", null])
    && [response.refused, response.hasError, response.hasIncompleteDetails, response.fullyRetained].every(value => typeof value === "boolean");
  if (!responseShape) reasons.push("response_evidence_invalid");
  if (response.status === null || response.messageStatus === null) reasons.push("completion_unknown");
  if (response.model !== POLICY.model) reasons.push("model_unknown_or_changed");
  if (response.serviceTier !== POLICY.serviceTier) reasons.push("tier_unknown_or_changed");
  const validation = record(response.validation) ? response.validation : {};
  const validationShape = exact(validation, ["kind", "issueCount"])
    && oneOf(validation.kind, ["valid", "structural", "context", "creative", "unknown"]) && count(validation.issueCount)
    && (validation.kind !== "valid" || validation.issueCount === 0);
  if (!validationShape) reasons.push("validation_evidence_invalid");

  let usage: OpenAITextUsage | null = null;
  let cost: OpenAITextCostReceipt | null = null;
  const observedUsageJson = Object.hasOwn(response, "usage") ? JSON.stringify(response.usage) : null;
  try {
    if (!record(response.usage)) throw new Error("usage_invalid");
    const raw = response.usage;
    if (Object.hasOwn(raw, "output_tokens_details") && !record(raw.output_tokens_details)) throw new Error("usage_invalid");
    const details = record(raw.input_tokens_details) ? raw.input_tokens_details : null;
    const completeCounters = details !== null && Object.hasOwn(details, "cached_tokens") && Object.hasOwn(details, "cache_write_tokens");
    if (completeCounters) {
      // Complete measured facts remain priceable even when they violate the captured request policy.
      usage = readOpenAITextUsage(raw);
      if (request.disposition === "eligible" && (usage.cachedInputTokens !== 0 || usage.cacheWriteTokens !== 0)) reasons.push("cache_request_policy_conflict");
    } else {
      // Only the exact request may derive genuinely absent counters. A partial conflict cannot infer zero.
      usage = readOpenAITextUsage(raw, request.disposition === "eligible" ? { cachePolicy: POLICY.cachePolicy } : undefined);
    }
  } catch { reasons.push("usage_unknown_or_invalid"); }
  if (usage !== null && response.model === POLICY.model && response.serviceTier === POLICY.serviceTier && dependenciesCurrent()) {
    try { cost = priceCurrentOpenAITextUsage(POLICY.model, usage, POLICY.serviceTier); }
    catch { reasons.push("cost_unknown_or_invalid"); }
  }
  reasons.push(...evaluateCaps({ requestInputAllowance: request.inputAllowance,
    inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null, totalTokens: usage?.totalTokens ?? null,
    costMicrousd: cost?.totalMicrousd ?? null, aggregateTokens: usage?.totalTokens ?? null, aggregateMicrousd: cost?.totalMicrousd ?? null }));
  if (cost !== null && cost.contextBand !== "short") reasons.push("context_band_changed");
  const complete = responseShape && response.status === "completed" && response.messageStatus === "completed"
    && response.refused === false && response.hasError === false && response.hasIncompleteDetails === false;
  const retained = response.fullyRetained === true;
  const valid = validationShape && validation.kind === "valid" && validation.issueCount === 0;
  const accountingKnown = usage !== null && cost !== null;
  const quarantine = reasons.length > 0 || !accountingKnown;
  const usable = !quarantine && complete && retained && valid;
  const describedValidationRepairConditionsMatch = !quarantine && complete && retained && stage === POLICY.stages[0]
    && validationShape && oneOf(validation.kind, ["structural", "context"]) && (validation.issueCount as number) > 0;
  if (!complete) reasons.push("response_not_completed_nonrefused");
  if (!retained) reasons.push("response_not_fully_retained");
  if (!valid) reasons.push("result_not_validated");
  return freezeOwned({ stage, callId, clientRequestId, providerResponseId, disposition: quarantine ? "quarantine" : usable ? "eligible" : "invalid",
    reasons, request, observedUsageJson: observedUsageJson ?? null, usage, cost, usable, describedValidationRepairConditionsMatch });
}

/**
 * Accepts only serialized private evidence and an explicit clock scalar. Retention, validation and identity
 * are supplied descriptions, not verified custody, source proof, hashes, provider facts or current authority.
 * No dispatch, admission, durable quarantine, settlement, publication or same-call recovery is implemented.
 */
export function classifyShortStoryExecution(evidenceJson: unknown, nowMs: unknown): ShortStoryExecutionAssessment {
  const capture = captureSerialized(evidenceJson, POLICY.serializedInputLimits.evidenceBytes);
  const capturedEvidence = capture.captured;
  const reasons: string[] = [];
  const calls: ShortStoryCallAssessment[] = [];
  let aggregateTokens: number | null = null, aggregateMicrousd: number | null = null;
  let originalDeadlineMs: number | null = null;
  if (!dependenciesCurrent()) reasons.push("policy_dependency_changed");
  if (capture.problem !== null) reasons.push(capture.problem);
  try {
    if (capture.problem !== null || capturedEvidence === null) throw new Error("evidence_invalid");
    const evidence = JSON.parse(capturedEvidence) as unknown;
    if (!exact(evidence, ["routeVersion", "pricingVersion", "profile", "itemCount", "movements", "artifactFiles", "startedAtMs", "originalDeadlineMs", "calls"])) throw new Error("evidence_invalid");
    if (evidence.routeVersion !== POLICY.routeVersion || evidence.pricingVersion !== POLICY.pricingVersion || evidence.profile !== POLICY.profile
      || evidence.itemCount !== 1 || evidence.movements !== 1 || evidence.artifactFiles !== 1) reasons.push("execution_policy_invalid");
    if (!count(evidence.startedAtMs) || !count(evidence.originalDeadlineMs) || !count(nowMs)
      || !Number.isSafeInteger((evidence.startedAtMs as number) + POLICY.maximumMilliseconds)
      || evidence.originalDeadlineMs !== (evidence.startedAtMs as number) + POLICY.maximumMilliseconds
      || (nowMs as number) < (evidence.startedAtMs as number)) reasons.push("original_lifetime_invalid");
    else originalDeadlineMs = evidence.originalDeadlineMs;
    if (!Array.isArray(evidence.calls) || evidence.calls.length < 1 || evidence.calls.length > POLICY.maxCalls) reasons.push("call_count_invalid");
    else {
      for (const call of evidence.calls) calls.push(classifyCall(call));
      for (const key of ["stage", "callId", "clientRequestId", "providerResponseId"] as const) {
        const values = calls.map(call => call[key]);
        if (values.some(value => value === null) || new Set(values).size !== values.length) reasons.push("duplicate_or_missing_" + key);
      }
      if (calls.some((call, index) => call.stage !== POLICY.stages[index])) reasons.push("call_stage_order_invalid");
      if (calls.length === 2 && !calls[0].describedValidationRepairConditionsMatch) reasons.push("repair_basis_invalid");
      if (calls.every(call => call.usage !== null)) {
        const total = calls.reduce((sum, call) => sum + call.usage!.totalTokens, 0);
        if (count(total)) aggregateTokens = total; else reasons.push("aggregate_token_sum_invalid");
      }
      if (calls.every(call => call.cost !== null)) {
        const total = calls.reduce((sum, call) => sum + call.cost!.totalMicrousd, 0);
        if (count(total)) aggregateMicrousd = total; else reasons.push("aggregate_cost_sum_invalid");
      }
      for (const call of calls) reasons.push(...evaluateCaps({
        requestInputAllowance: call.request?.inputAllowance ?? null, inputTokens: call.usage?.inputTokens ?? null,
        outputTokens: call.usage?.outputTokens ?? null, totalTokens: call.usage?.totalTokens ?? null,
        costMicrousd: call.cost?.totalMicrousd ?? null, aggregateTokens, aggregateMicrousd,
      }));
    }
  } catch { reasons.push("execution_evidence_invalid"); }
  const repairReasons: string[] = [];
  if (reasons.length || calls.some(call => call.disposition === "quarantine")) repairReasons.push("execution_not_qualified");
  if (calls.length !== 1 || !calls[0]?.describedValidationRepairConditionsMatch) repairReasons.push("validation_repair_basis_missing");
  if (originalDeadlineMs === null || !count(nowMs) || nowMs >= originalDeadlineMs) repairReasons.push("original_deadline_expired_or_invalid");
  const disposition: ShortStoryDisposition = reasons.length || calls.some(call => call.disposition === "quarantine") ? "quarantine"
    : calls.at(-1)?.usable ? "eligible" : "invalid";
  return freezeOwned({ qualification: POLICY.qualification, connectedGuaranteesImplemented: false,
    authorizations: { dispatch: false, settlement: false, publication: false, certifiedRecovery: false }, disposition, reasons, capturedEvidence,
    calls, aggregateTokens, aggregateMicrousd, repair: {
      disposition: "ineligible", dispatchEligible: false,
      descriptiveAssessment: { disposition: repairReasons.length ? "conditions-not-satisfied" : "awaiting-trusted-evidence",
        conditionsSatisfied: repairReasons.length === 0, reasons: repairReasons },
      unimplementedPrerequisites: ["genuine-validation", "retained-evidence-custody", "current-original-authority"],
    } });
}

import assert from "node:assert/strict";
import test from "node:test";
import {
  SHORT_STORY_EXECUTION_POLICY,
  readShortStoryExecutionRequest,
  classifyShortStoryExecutionCaps,
  classifyShortStoryExecution,
} from "../worker/short-story-execution-policy.ts";

// Synthetic descriptions only. No provider, retained store, validator, clock,
// dispatch or financial system supplies authority to these pure test vectors.
const INITIAL = "planning:0:initial", REPAIR = "planning:0:repair";
const encode = value => JSON.stringify(value);
const bytes = value => new TextEncoder().encode(value).byteLength;
function requestObject(stage = INITIAL) {
  return {
    model: "gpt-5.6-terra", instructions: "Return one complete Short story.", input: "Synthetic context.",
    text: { verbosity: "medium", format: { type: "json_schema", name: stage === INITIAL ? "document_short_story" : "document_short_story_repair", strict: true,
      schema: { type: "object", properties: { content_markdown: { type: "string" } }, required: ["content_markdown"], additionalProperties: false } } },
    reasoning: { effort: "low" }, max_output_tokens: 6000, store: false, safety_identifier: "synthetic-c1-owner",
    service_tier: "default", prompt_cache_options: { mode: "explicit" }, truncation: "disabled",
  };
}
function serializedRequest(byteLength, stage = INITIAL, prefix = "") {
  const value = requestObject(stage);
  if (byteLength === undefined) return encode(value);
  value.input = prefix;
  const remaining = byteLength - bytes(encode(value));
  assert.ok(remaining >= 0, "The fixture byte budget must fit its fixed request fields");
  value.input += "x".repeat(remaining);
  const raw = encode(value);
  assert.equal(bytes(raw), byteLength);
  return raw;
}
function usage(input = 1000, output = 100) {
  return { input_tokens: input, output_tokens: output, total_tokens: input + output,
    input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: Math.min(output, 10) } };
}
function call(stage = INITIAL) {
  const suffix = stage === INITIAL ? "initial" : "repair";
  return { stage, callId: "call-" + suffix, clientRequestId: "client-" + suffix, providerResponseId: "response-" + suffix,
    serializedRequest: serializedRequest(undefined, stage),
    response: { model: "gpt-5.6-terra", serviceTier: "default", status: "completed", messageStatus: "completed",
      refused: false, hasError: false, hasIncompleteDetails: false, fullyRetained: true,
      validation: { kind: "valid", issueCount: 0 }, usage: usage() } };
}
function evidence(calls = [call()]) {
  return { routeVersion: "forma.short-story.execution@1", pricingVersion: "openai-text-2026-09-02",
    profile: "personal-owner-manual-document-short_story-v1", itemCount: 1, movements: 1, artifactFiles: 1,
    startedAtMs: 1000, originalDeadlineMs: 241000, calls };
}
const assess = (value, now = 2000) => classifyShortStoryExecution(encode(value), now);
const reasons = result => [...result.reasons, ...(result.calls ?? []).flatMap(value => value.reasons)];
function hasReason(result, reason) { assert.ok(reasons(result).includes(reason), reason + ": " + encode(result)); }
function noAuthority(result) {
  assert.equal(result.qualification, "described-policy-only");
  assert.equal(result.connectedGuaranteesImplemented, false);
  assert.deepEqual(result.authorizations, { dispatch: false, settlement: false, publication: false, certifiedRecovery: false });
  assert.equal(result.repair.disposition, "ineligible"); assert.equal(result.repair.dispatchEligible, false);
  assert.deepEqual(result.repair.unimplementedPrerequisites, ["genuine-validation", "retained-evidence-custody", "current-original-authority"]);
  for (const key of ["dispatchAuthorized", "settlementAuthorized", "publicationAuthorized", "recoveryCertified"]) assert.equal(Object.hasOwn(result, key), false);
}
function frozen(value) {
  if (value !== null && typeof value === "object") {
    assert.equal(Object.isFrozen(value), true);
    for (const child of Object.values(value)) frozen(child);
  }
}
function caps(overrides = {}) {
  return { requestInputAllowance: 58000, inputTokens: 1000, outputTokens: 100, totalTokens: 1100,
    costMicrousd: 3200, aggregateTokens: 1100, aggregateMicrousd: 3200, ...overrides };
}
const bounds = value => classifyShortStoryExecutionCaps(encode(value));

test("C1 policy: literal constants remain disconnected and immutable", () => {
  const policy = SHORT_STORY_EXECUTION_POLICY;
  assert.deepEqual(policy, {
    profile: "personal-owner-manual-document-short_story-v1", routeVersion: "forma.short-story.execution@1",
    requestAllowanceVersion: "forma.short-story.request-allowance@1", pricingVersion: "openai-text-2026-09-02",
    model: "gpt-5.6-terra", effort: "low", serviceTier: "default", cachePolicy: "disabled-explicit", promptCacheMode: "explicit", explicitBreakpoints: 0,
    verbosity: "medium", store: false, truncation: "disabled", itemCount: 1, movements: 1, artifactFiles: 1,
    stages: [INITIAL, REPAIR], maxCalls: 2, requestAllowanceOverhead: 4096, maximumSerializedRequestBytes: 53904,
    maxInputAllowance: 58000, maxOutputTokens: 6000, perCallTokens: 64000, aggregateTokens: 128000,
    perCallMicrousd: 217000, aggregateMicrousd: 434000,
    ratesNanousdPerToken: { input: 2000, cachedInput: 200, cacheWrite: 2500, output: 12000 },
    maximumMilliseconds: 240000, heartbeatMilliseconds: 60000, maximumRenewals: 3,
    serializedInputLimits: { requestBytes: 65536, capsBytes: 2048, evidenceBytes: 1000000 },
    qualification: "described-policy-only", connectedGuaranteesImplemented: false,
  });
  frozen(policy);
  const result = assess(evidence());
  assert.equal(result.disposition, "eligible"); assert.equal(result.calls[0].usable, true); noAuthority(result); frozen(result);
  for (const [key, value] of [["routeVersion", "forma.short-story.execution@2"], ["pricingVersion", "unpriced"], ["profile", "shared"], ["itemCount", 2], ["movements", 2], ["artifactFiles", 2]]) {
    const altered = evidence(); altered[key] = value;
    const denied = assess(altered); assert.equal(denied.disposition, "quarantine"); hasReason(denied, "execution_policy_invalid"); noAuthority(denied);
  }
});

test("C1 request: exact UTF8 bytes determine the allowance at both size edges", () => {
  for (const size of [53903, 53904, 53905]) {
    const raw = serializedRequest(size, INITIAL, "é😀"), result = readShortStoryExecutionRequest(raw);
    assert.equal(result.serializedRequest, raw); assert.equal(result.byteLength, size); assert.equal(result.inputAllowance, size + 4096);
    assert.equal(result.disposition, size <= 53904 ? "eligible" : "invalid");
    assert.deepEqual(result.reasons, size <= 53904 ? [] : ["request_bytes_exceeded"]);
  }
  const value = requestObject(); value.input = "é😀";
  const raw = encode(value), escaped = raw.replace("é", "\\u00e9"), spaced = JSON.stringify(value, null, 2);
  assert.equal(bytes(raw) - raw.length, 3, "One two-byte and one four-byte character differ from UTF16 code-unit length");
  for (const exact of [raw, escaped, spaced]) {
    const result = readShortStoryExecutionRequest(exact);
    assert.equal(result.disposition, "eligible"); assert.equal(result.serializedRequest, exact);
    assert.equal(result.inputAllowance, bytes(exact) + 4096);
  }
  assert.equal(readShortStoryExecutionRequest(escaped).byteLength - readShortStoryExecutionRequest(raw).byteLength, 4);
});

test("C1 request: fixed fields and nested containers cannot silently drift", () => {
  const changes = [
    value => { value.model = "gpt-5.6-sol"; }, value => { value.reasoning.effort = "medium"; },
    value => { value.max_output_tokens = 5999; }, value => { value.max_output_tokens = 6001; },
    value => { value.store = true; }, value => { value.service_tier = "flex"; }, value => { value.truncation = "auto"; },
    value => { value.prompt_cache_options.mode = "auto"; }, value => { value.prompt_cache_options.breakpoints = []; },
    value => { value.text.verbosity = "low"; }, value => { value.text.format.strict = false; },
    value => { value.text.format.name = "document_slides"; }, value => { value.text.format.schema = []; },
    value => { value.text.format.schema = null; }, value => { value.reasoning = []; }, value => { value.text = null; },
    value => { value.input = [{ role: "user", content: "text" }]; }, value => { value.instructions = null; },
    value => { value.safety_identifier = ""; }, value => { value.tools = []; }, value => { delete value.store; },
  ];
  for (const change of changes) { const value = requestObject(); change(value); const result = readShortStoryExecutionRequest(encode(value)); assert.equal(result.disposition, "invalid"); assert.ok(result.reasons.includes("request_policy_invalid")); }
  for (const raw of ["null", "[]", "false", "{}", "{", ""]) assert.equal(readShortStoryExecutionRequest(raw).disposition, "invalid");
  assert.equal(readShortStoryExecutionRequest(serializedRequest(undefined, REPAIR)).formatName, "document_short_story_repair");
});

test("C1 caps: numeric thresholds are checked separately from provider eligibility", () => {
  // These numeric cost/aggregate vectors are arithmetic-only. No-cache valid
  // calls top out at188000 micro-USD, not the conservative217000 reserve.
  for (const [key, maximum, reason] of [["outputTokens", 6000, "output_cap_exceeded"], ["costMicrousd", 217000, "call_cost_cap_exceeded"],
    ["aggregateTokens", 128000, "aggregate_token_cap_exceeded"], ["aggregateMicrousd", 434000, "aggregate_cost_cap_exceeded"]]) {
    for (const delta of [-1, 0, 1]) {
      const value = caps({ [key]: maximum + delta });
      if (key === "outputTokens") value.totalTokens = value.inputTokens + value.outputTokens;
      const result = bounds(value);
      assert.equal(result.qualification, "arithmetic-only"); assert.deepEqual(result.reasons, delta <= 0 ? [] : [reason]);
      assert.equal(result.disposition, delta <= 0 ? "within_bounds" : "out_of_bounds");
    }
  }
  for (const allowance of [4095, 4096, 4097, 57999, 58000, 58001]) {
    const result = bounds(caps({ requestInputAllowance: allowance, inputTokens: 0, outputTokens: 0, totalTokens: 0 }));
    assert.deepEqual(result.reasons, allowance < 4096 || allowance > 58000 ? ["request_allowance_invalid"] : []);
  }
  for (const input of [57999, 58000, 58001]) {
    const result = bounds(caps({ inputTokens: input, outputTokens: 0, totalTokens: input }));
    // Crossing the route input maximum also necessarily crosses its exact A.
    assert.deepEqual(result.reasons, input <= 58000 ? [] : ["exact_request_input_exceeded", "input_cap_exceeded"]);
  }
  for (const total of [63999, 64000, 64001]) {
    const result = bounds(caps({ inputTokens: 58000, outputTokens: total - 58000, totalTokens: total }));
    // A consistent64001-token call necessarily also exceeds an individual cap.
    assert.deepEqual(result.reasons, total <= 64000 ? [] : ["output_cap_exceeded", "call_token_cap_exceeded"]);
  }
  assert.deepEqual(bounds(caps({ totalTokens: 1101 })).reasons, ["token_sum_invalid"]);
  const unsafeSum = bounds(caps({ inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1, totalTokens: Number.MAX_SAFE_INTEGER }));
  assert.deepEqual(unsafeSum.reasons, ["token_sum_invalid", "exact_request_input_exceeded", "input_cap_exceeded", "call_token_cap_exceeded"]);
  for (const key of Object.keys(caps())) for (const invalid of [-1, 0.5, null, "1", Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(bounds(caps({ [key]: invalid })).reasons, ["caps_invalid"]);
  }
  const extra = caps(); extra.authorized = true;
  assert.deepEqual(bounds(extra).reasons, ["caps_invalid"]);
});

test("C1 accounting: each exact request bound survives unused aggregate allowance", () => {
  const raw = serializedRequest(), allowance = bytes(raw) + 4096;
  assert.ok(allowance + 1 < 58000);
  for (const input of [allowance - 1, allowance, allowance + 1]) {
    const value = evidence(); value.calls[0].serializedRequest = raw; value.calls[0].response.usage = usage(input, 0);
    const result = assess(value);
    assert.equal(result.aggregateTokens, input); assert.equal(result.calls[0].cost.totalMicrousd, input * 2);
    assert.equal(result.disposition, input <= allowance ? "eligible" : "quarantine");
    if (input > allowance) hasReason(result, "exact_request_input_exceeded");
  }
  const initial = call(), repair = call(REPAIR);
  initial.response.validation = { kind: "structural", issueCount: 1 };
  for (const value of [initial, repair]) { value.serializedRequest = serializedRequest(53904, value.stage); value.response.usage = usage(58000, 6000); }
  const full = assess(evidence([initial, repair]));
  assert.equal(full.disposition, "eligible");
  assert.equal(full.aggregateTokens, 128000); assert.equal(full.aggregateMicrousd, 376000);
  assert.deepEqual(full.calls.map(value => value.cost.totalMicrousd), [188000, 188000]);
  const exceeded = evidence(); exceeded.calls[0].serializedRequest = serializedRequest(53904); exceeded.calls[0].response.usage = usage(1000, 6001);
  const denied = assess(exceeded); hasReason(denied, "output_cap_exceeded"); assert.equal(denied.disposition, "quarantine"); assert.ok(denied.aggregateTokens < 128000);
});

test("C1 usage: safe integers and exact token sums precede classification", () => {
  for (const key of ["input_tokens", "output_tokens", "total_tokens"]) for (const invalid of [-1, 0.5, null, "100", Number.MAX_SAFE_INTEGER + 1]) {
    const value = evidence(); value.calls[0].response.usage[key] = invalid;
    const result = assess(value); hasReason(result, "usage_unknown_or_invalid"); assert.equal(result.calls[0].usage, null); assert.equal(result.calls[0].cost, null);
  }
  for (const delta of [-1, 1]) {
    const value = evidence(); value.calls[0].response.usage.total_tokens += delta;
    hasReason(assess(value), "usage_unknown_or_invalid");
  }
  const maximum = evidence(); maximum.calls[0].response.usage = usage(Number.MAX_SAFE_INTEGER, 0);
  const result = assess(maximum);
  assert.equal(result.calls[0].usage.inputTokens, Number.MAX_SAFE_INTEGER); assert.equal(result.calls[0].cost, null); hasReason(result, "cost_unknown_or_invalid");
  const infinity = encode(evidence()).replace('"input_tokens":1000', '"input_tokens":1e309');
  hasReason(classifyShortStoryExecution(infinity, 2000), "usage_unknown_or_invalid");
});

test("C1 usage: malformed detail containers are never treated as absent", () => {
  for (const key of ["input_tokens_details", "output_tokens_details"]) for (const invalid of [null, false, 0, "details", []]) {
    const value = evidence(); value.calls[0].response.usage[key] = invalid;
    const result = assess(value); hasReason(result, "usage_unknown_or_invalid"); assert.equal(result.calls[0].usage, null);
  }
  for (const invalid of [null, [], "usage", false]) {
    const value = evidence(); value.calls[0].response.usage = invalid;
    const result = assess(value); hasReason(result, "usage_unknown_or_invalid"); assert.equal(result.calls[0].observedUsageJson, encode(invalid));
  }
  for (const reasoning of [-1, 0.5, "10", 101, Number.MAX_SAFE_INTEGER + 1]) {
    const value = evidence(); value.calls[0].response.usage.output_tokens_details.reasoning_tokens = reasoning;
    hasReason(assess(value), "usage_unknown_or_invalid");
  }
  const absent = evidence(); delete absent.calls[0].response.usage.output_tokens_details;
  const result = assess(absent); assert.equal(result.calls[0].usage.reasoningTokens, null); assert.equal(result.calls[0].usage.outputTokens, 100); assert.equal(result.calls[0].usage.totalTokens, 1100);
  const explicitUnknown = evidence(); explicitUnknown.calls[0].response.usage.output_tokens_details.reasoning_tokens = null;
  const unknown = assess(explicitUnknown); assert.equal(unknown.disposition, "eligible"); assert.equal(unknown.calls[0].usage.reasoningTokens, null);
  assert.equal(unknown.calls[0].usage.outputTokens, 100); assert.equal(unknown.calls[0].usage.totalTokens, 1100);
});

test("C1 cache: absent counters require exact explicit no-breakpoint evidence", () => {
  for (const missing of [[], ["cached_tokens"], ["cache_write_tokens"], ["cached_tokens", "cache_write_tokens"]]) {
    const value = evidence();
    for (const key of missing) delete value.calls[0].response.usage.input_tokens_details[key];
    const result = assess(value), receipt = result.calls[0].cost;
    assert.equal(result.disposition, "eligible"); assert.equal(receipt.totalMicrousd, 3200);
    assert.deepEqual(receipt.derivedUsageFields, missing.map(key => key === "cached_tokens" ? "cachedInputTokens" : "cacheWriteTokens"));
    assert.deepEqual(receipt.requestPolicy, missing.length ? { cachePolicy: "disabled-explicit", promptCacheMode: "explicit", explicitBreakpoints: 0 } : null);
    assert.equal(receipt.costBasis, missing.length ? "measured_usage_request_policy_published_tariff" : "measured_usage_published_tariff");
  }
  const absent = evidence(); delete absent.calls[0].response.usage.input_tokens_details;
  assert.deepEqual(assess(absent).calls[0].cost.derivedUsageFields, ["cachedInputTokens", "cacheWriteTokens"]);
  const noProof = evidence(); delete noProof.calls[0].response.usage.input_tokens_details;
  const request = requestObject(); request.prompt_cache_options.mode = "auto"; noProof.calls[0].serializedRequest = encode(request);
  const denied = assess(noProof); hasReason(denied, "request_policy_invalid"); hasReason(denied, "usage_unknown_or_invalid"); assert.equal(denied.calls[0].cost, null);
  for (const [key, normalizedKey, expectedCost] of [["cached_tokens", "cachedInputTokens", 3199], ["cache_write_tokens", "cacheWriteTokens", 3201]]) {
    const value = evidence(); value.calls[0].response.usage.input_tokens_details[key] = 1;
    const result = assess(value); hasReason(result, "cache_request_policy_conflict"); assert.equal(result.disposition, "quarantine");
    assert.equal(result.calls[0].usage[normalizedKey], 1); assert.equal(result.calls[0].cost.totalMicrousd, expectedCost);
    assert.deepEqual(result.calls[0].cost.derivedUsageFields, []); assert.equal(result.calls[0].cost.requestPolicy, null);
    assert.equal(result.calls[0].observedUsageJson, encode(value.calls[0].response.usage)); noAuthority(result);
    const partial = evidence(); partial.calls[0].response.usage.input_tokens_details[key] = 1;
    delete partial.calls[0].response.usage.input_tokens_details[key === "cached_tokens" ? "cache_write_tokens" : "cached_tokens"];
    const unknown = assess(partial); hasReason(unknown, "usage_unknown_or_invalid"); assert.equal(unknown.calls[0].usage, null); assert.equal(unknown.calls[0].cost, null);
  }
  for (const key of ["cached_tokens", "cache_write_tokens"]) for (const bad of [null, "0", -1, 0.5, 1001]) {
    const value = evidence(); value.calls[0].response.usage.input_tokens_details[key] = bad;
    const result = assess(value); hasReason(result, "usage_unknown_or_invalid"); assert.equal(result.calls[0].cost, null);
    assert.equal(result.calls[0].observedUsageJson, encode(value.calls[0].response.usage));
  }
});

test("C1 receipts: changed model tier or provider identity never uses a fallback", () => {
  for (const model of [null, "gpt-5.6-sol", "gpt-5.6-terra-unknown-snapshot", ""]) {
    const value = evidence(); value.calls[0].response.model = model;
    const result = assess(value); hasReason(result, "model_unknown_or_changed"); assert.equal(result.calls[0].cost, null); assert.equal(result.calls[0].usage.totalTokens, 1100);
  }
  for (const tier of [null, "flex", "priority", ""]) {
    const value = evidence(); value.calls[0].response.serviceTier = tier;
    const result = assess(value); hasReason(result, "tier_unknown_or_changed"); assert.equal(result.calls[0].cost, null);
  }
  for (const id of [null, "", " padded ", "x".repeat(201)]) {
    const value = evidence(); value.calls[0].providerResponseId = id;
    const result = assess(value); hasReason(result, "call_identity_invalid"); assert.equal(result.disposition, "quarantine"); assert.equal(result.calls[0].cost.totalMicrousd, 3200);
  }
  const suppliedCost = evidence(); suppliedCost.calls[0].response.costMicrousd = 0;
  const denied = assess(suppliedCost); hasReason(denied, "response_evidence_invalid");
  assert.equal(denied.disposition, "quarantine"); assert.equal(denied.calls[0].cost.totalMicrousd, 3200, "Caller amounts never replace the strict pricer receipt");
  for (const [key, unknown] of [["model", "unpriced-model"], ["serviceTier", "unpriced-tier"]]) {
    const initial = call(), repair = call(REPAIR); initial.response.validation = { kind: "structural", issueCount: 1 };
    for (const value of [initial, repair]) {
      value.serializedRequest = serializedRequest(53904, value.stage); value.response[key] = unknown; value.response.usage = usage(58001, 6001);
    }
    const result = assess(evidence([initial, repair]));
    assert.equal(result.aggregateTokens, 128004); assert.equal(result.aggregateMicrousd, null);
    assert.ok(result.reasons.includes("aggregate_token_cap_exceeded"));
    for (const value of result.calls) {
      assert.equal(value.cost, null); assert.equal(value.usage.totalTokens, 64002);
      for (const reason of ["exact_request_input_exceeded", "input_cap_exceeded", "output_cap_exceeded", "call_token_cap_exceeded"]) assert.ok(value.reasons.includes(reason));
    }
    noAuthority(result);
  }
});

test("C1 paid facts: unusable and over-policy observations are not clamped or refunded", () => {
  const changes = [
    response => { response.refused = true; }, response => { response.status = "incomplete"; }, response => { response.messageStatus = "incomplete"; },
    response => { response.hasError = true; }, response => { response.hasIncompleteDetails = true; }, response => { response.fullyRetained = false; },
    response => { response.status = null; }, response => { response.messageStatus = null; },
    response => { response.validation = { kind: "structural", issueCount: 1 }; },
  ];
  for (const change of changes) {
    const value = evidence(); change(value.calls[0].response); const raw = encode(value), result = classifyShortStoryExecution(raw, 2000);
    assert.equal(result.capturedEvidence, raw); assert.equal(result.calls[0].usable, false); assert.equal(result.calls[0].usage.totalTokens, 1100);
    assert.equal(result.calls[0].cost.totalMicrousd, 3200); assert.equal(result.aggregateMicrousd, 3200); noAuthority(result);
    if (value.calls[0].response.status === null || value.calls[0].response.messageStatus === null) hasReason(result, "completion_unknown");
  }
  const value = evidence(); value.calls[0].serializedRequest = serializedRequest(53904); value.calls[0].response.usage = usage(72501, 6000);
  const result = assess(value); assert.equal(result.disposition, "quarantine"); hasReason(result, "call_cost_cap_exceeded");
  assert.equal(result.calls[0].usage.inputTokens, 72501); assert.equal(result.calls[0].cost.totalMicrousd, 217002); assert.equal(result.aggregateMicrousd, 217002);
  const long = evidence(); long.calls[0].response.usage = usage(272001, 1);
  const longResult = assess(long); hasReason(longResult, "context_band_changed"); assert.equal(longResult.calls[0].cost.contextBand, "long"); assert.equal(longResult.calls[0].cost.totalMicrousd, 1088022);
});

test("C1 calls: ordered stages and each identity column reject duplication", () => {
  function pair() { const initial = call(); initial.response.validation = { kind: "structural", issueCount: 1 }; return evidence([initial, call(REPAIR)]); }
  const control = assess(pair()); assert.equal(control.calls.length, 2); assert.equal(control.calls[1].usable, true); assert.equal(control.aggregateMicrousd, 6400);
  assert.equal(control.disposition, "eligible");
  for (const key of ["stage", "callId", "clientRequestId", "providerResponseId"]) {
    const value = pair(); value.calls[1][key] = value.calls[0][key];
    const result = assess(value); hasReason(result, "duplicate_or_missing_" + key); assert.equal(result.disposition, "quarantine");
  }
  const reversed = pair(); reversed.calls.reverse(); hasReason(assess(reversed), "call_stage_order_invalid");
  const wrongRequest = pair(); wrongRequest.calls[1].serializedRequest = serializedRequest(); hasReason(assess(wrongRequest), "stage_request_mismatch");
  for (const calls of [[], [call(), call(REPAIR), call(REPAIR)], null, {}]) { const value = evidence(); value.calls = calls; hasReason(assess(value), "call_count_invalid"); }
  const unknown = evidence(); unknown.calls[0].stage = "planning:1:repair"; hasReason(assess(unknown), "call_identity_invalid");
  const validInitial = evidence([call(), call(REPAIR)]); hasReason(assess(validInitial), "repair_basis_invalid");
});

test("C1 repair: missing described prerequisites cannot imply actual eligibility", () => {
  // Supplied issue claims can match modeled conditions but cannot establish
  // genuine validation, retained custody or current original authority.
  for (const kind of ["structural", "context"]) {
    const value = evidence(); value.calls[0].response.validation = { kind, issueCount: 1 };
    const result = assess(value);
    assert.equal(result.calls[0].describedValidationRepairConditionsMatch, true);
    assert.deepEqual(result.repair.descriptiveAssessment, { disposition: "awaiting-trusted-evidence", conditionsSatisfied: true, reasons: [] });
    noAuthority(result);
  }
  const changes = [
    response => { response.validation = { kind: "valid", issueCount: 0 }; }, response => { response.validation = { kind: "structural", issueCount: 0 }; },
    response => { response.validation = { kind: "context", issueCount: 0 }; }, response => { response.validation = { kind: "creative", issueCount: 1 }; },
    response => { response.validation = { kind: "unknown", issueCount: 1 }; }, response => { response.refused = true; },
    response => { response.status = "incomplete"; }, response => { response.messageStatus = "failed"; },
    response => { response.fullyRetained = false; }, response => { response.usage = null; }, response => { response.model = null; },
  ];
  for (const change of changes) {
    const value = evidence(); value.calls[0].response.validation = { kind: "structural", issueCount: 1 }; change(value.calls[0].response);
    const result = assess(value); assert.equal(result.repair.descriptiveAssessment.disposition, "conditions-not-satisfied");
    assert.equal(result.repair.descriptiveAssessment.conditionsSatisfied, false); assert.equal(result.calls[0].describedValidationRepairConditionsMatch, false); noAuthority(result);
  }
  for (const validation of [null, [], { kind: "valid", issueCount: 1 }, { kind: "structural", issueCount: -1 }, { kind: "context", issueCount: 0.5 }, { kind: "context", issueCount: 1, approved: true }]) {
    const value = evidence(); value.calls[0].response.validation = validation; const result = assess(value);
    hasReason(result, "validation_evidence_invalid"); assert.equal(result.repair.disposition, "ineligible");
  }
});

test("C1 lifetime: the original deadline cannot be renewed by repair descriptions", () => {
  const value = evidence(); value.calls[0].response.validation = { kind: "structural", issueCount: 1 };
  for (const now of [241000, 241001]) {
    const result = assess(value, now); assert.equal(result.repair.descriptiveAssessment.conditionsSatisfied, false);
    assert.ok(result.repair.descriptiveAssessment.reasons.includes("original_deadline_expired_or_invalid"));
    assert.equal(result.aggregateMicrousd, 3200); noAuthority(result);
  }
  const before = assess(value, 240999);
  assert.equal(before.repair.descriptiveAssessment.conditionsSatisfied, true); noAuthority(before);
  for (const deadline of [240999, 241001]) { const altered = evidence(); altered.originalDeadlineMs = deadline; hasReason(assess(altered), "original_lifetime_invalid"); }
  for (const now of [999, -1, 0.5, null, Number.MAX_SAFE_INTEGER + 1]) hasReason(assess(value, now), "original_lifetime_invalid");
  const unsafeStart = evidence(); unsafeStart.startedAtMs = Number.MAX_SAFE_INTEGER; unsafeStart.originalDeadlineMs = Number.MAX_SAFE_INTEGER;
  hasReason(assess(unsafeStart, Number.MAX_SAFE_INTEGER), "original_lifetime_invalid");
  const renewed = evidence(); renewed.calls[0].startedAtMs = 240999;
  const result = assess(renewed, 241000); hasReason(result, "call_identity_invalid"); assert.equal(result.repair.disposition, "ineligible");
});

test("C1 capture: primitive boundaries avoid getters and own every returned snapshot", () => {
  let gets = 0, keys = 0, descriptors = 0;
  const target = Object.defineProperty({}, "toJSON", { enumerable: true, get() { gets++; throw new Error("caller_getter_evaluated"); } });
  const proxy = new Proxy(target, { get() { gets++; throw new Error("caller_get_evaluated"); }, ownKeys() { keys++; throw new Error("caller_keys_evaluated"); }, getOwnPropertyDescriptor() { descriptors++; throw new Error("caller_descriptor_evaluated"); } });
  for (const value of [target, proxy, null, [], 1, true, new String("{}")]) {
    assert.equal(readShortStoryExecutionRequest(value).disposition, "invalid");
    assert.equal(classifyShortStoryExecutionCaps(value).disposition, "out_of_bounds");
    const result = classifyShortStoryExecution(value, 2000); assert.equal(result.disposition, "quarantine"); assert.equal(result.capturedEvidence, null);
  }
  hasReason(classifyShortStoryExecution(encode(evidence()), proxy), "original_lifetime_invalid");
  assert.deepEqual([gets, keys, descriptors], [0, 0, 0]);
  for (const raw of ["null", "[]", "{}", "{", ""]) { const result = classifyShortStoryExecution(raw, 2000); assert.equal(result.disposition, "quarantine"); assert.equal(result.capturedEvidence, raw); }
  for (const size of [65535, 65536, 65537]) {
    const raw = serializedRequest(size, INITIAL, "é😀"), result = readShortStoryExecutionRequest(raw);
    assert.equal(result.serializedRequest, raw); assert.equal(result.reasons.includes("serialized_byte_limit_exceeded"), size > 65536);
    assert.equal(result.disposition, "invalid", "The stricter provider request cap still applies below the transport cap");
  }
  const grossRequest = serializedRequest(65537), gross = readShortStoryExecutionRequest(grossRequest);
  assert.equal(grossRequest.length, 65537); assert.equal(gross.byteLength, null); assert.equal(gross.inputAllowance, null);
  assert.equal(gross.serializedRequest, grossRequest); assert.ok(gross.reasons.includes("serialized_byte_limit_exceeded"));
  const rawCaps = encode(caps());
  for (const size of [2047, 2048, 2049]) {
    const raw = rawCaps + " ".repeat(size - bytes(rawCaps));
    assert.equal(bytes(raw), size);
    assert.equal(classifyShortStoryExecutionCaps(raw).disposition, size <= 2048 ? "within_bounds" : "out_of_bounds");
  }
  const transport = evidence(); transport.calls[0].response.usage.unclassified_detail = "é".repeat(400000);
  const rawTransport = encode(transport);
  assert.ok(bytes(rawTransport) < 999999); assert.ok(rawTransport.length < bytes(rawTransport));
  for (const size of [999999, 1000000, 1000001]) {
    const raw = rawTransport + " ".repeat(size - bytes(rawTransport));
    assert.equal(bytes(raw), size); assert.ok(raw.length < 1000000, "Only a byte-based bound detects this over-limit UTF8 envelope");
    const result = classifyShortStoryExecution(raw, 2000);
    assert.equal(result.capturedEvidence, raw); assert.equal(result.disposition, size <= 1000000 ? "eligible" : "quarantine");
    assert.equal(result.reasons.includes("serialized_byte_limit_exceeded"), size > 1000000); noAuthority(result);
  }
  const source = evidence(), exact = encode(source), result = classifyShortStoryExecution(exact, 2000);
  source.calls[0].response.usage.input_tokens = 999999; source.calls[0].response.validation.kind = "unknown";
  assert.equal(result.capturedEvidence, exact); assert.equal(result.calls[0].usage.inputTokens, 1000); assert.equal(result.calls[0].cost.totalMicrousd, 3200);
  frozen(result); frozen(readShortStoryExecutionRequest(serializedRequest())); frozen(bounds(caps()));
  assert.throws(() => { result.calls[0].cost.usage.inputTokens = 0; }, TypeError);
  assert.throws(() => { result.calls.push(null); }, TypeError); noAuthority(result);
});

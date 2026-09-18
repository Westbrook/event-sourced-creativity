import test from "node:test";
import assert from "node:assert/strict";
import { executeBenchmarkOperation, priceOperation, validateBenchmarkOperation, validateBenchmarkResult, BenchmarkProviderError,
  BENCHMARK_PRICE_SOURCE_DATE } from "../worker/memory-benchmark/provider.ts";

// These tests never resolve a real credential or call a network transport.
globalThis.fetch = async () => { throw new Error("NO_NETWORK_PERMITTED"); };
const env = { OPENAI_API_KEY: "synthetic-test-key", OPENAI_PROJECT: "proj_synthetic" };
const operation = (kind = "review", patch = {}) => {
  const base = {
    id: `synthetic.${kind}.1`, ordinal: 0, kind,
    model: kind === "embedding" ? "text-embedding-3-small" : "gpt-5.6-luna",
    instructions: kind === "embedding" ? "" : "Return synthetic evidence only.",
    input: kind === "embedding" ? ["Synthetic fact one.", "Synthetic fact two."] : "Synthetic fact one.",
    maximumInputTokens: kind === "review" ? 20_000 : 10_000,
    maximumOutputTokens: kind === "embedding" ? 0 : kind === "review" ? 2000 : 1000,
    allowedFactIds: ["f1", "f2"],
    ...(kind === "embedding" ? { dimensions: 512 } : {}), ...patch,
  };
  return { ...base, maximumMicroUsd: priceOperation(base.model, base.maximumInputTokens, base.maximumOutputTokens) };
};
const review = { entries: [{ factIds: ["f1"], text: "Synthetic fact one." }] };
const answer = { answer: "Synthetic fact one.", factIds: ["f1"], abstain: false };
const envelope = (data = review, patch = {}) => ({
  id: "resp_synthetic_1", object: "response", status: "completed", service_tier: "default",
  model: "gpt-5.6-luna", error: null, incomplete_details: null,
  output: [{ id: "msg_synthetic_1", type: "message", role: "assistant", status: "completed",
    content: [{ type: "output_text", text: typeof data === "string" ? data : JSON.stringify(data), annotations: [] }] }],
  usage: { input_tokens: 20, output_tokens: 30, total_tokens: 50,
    input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
  ...patch,
});
const embeddingEnvelope = () => ({ object: "list", model: "text-embedding-3-small",
  data: [0, 1].map(index => ({ object: "embedding", index, embedding: Array(512).fill((index + 1) / 10) })),
  usage: { prompt_tokens: 10, total_tokens: 10 } });
const jsonResponse = value => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
const mocked = value => async () => jsonResponse(value);
const rejectsCode = (promise, code) => assert.rejects(promise, error => {
  assert.equal(error instanceof BenchmarkProviderError, true);
  assert.equal(error.message, code);
  assert.equal(error.code, code);
  assert.equal(error.cause, undefined);
  return true;
});

test("standard pricing uses integer micro-USD rounding without undercounting", () => {
  assert.equal(BENCHMARK_PRICE_SOURCE_DATE, "2026-09-04");
  assert.equal(priceOperation("text-embedding-3-small", 1_000_000, 0), 20_000);
  assert.equal(priceOperation("text-embedding-3-small", 1, 0), 1);
  assert.equal(priceOperation("gpt-5.6-luna", 1_000_000, 1_000_000), 1_400_000);
  assert.equal(priceOperation("gpt-5.6-terra", 1_000_000, 1_000_000), 14_000_000);
  assert.equal(priceOperation("gpt-5.6-luna", 1, 1), 2);
  for (const args of [["unknown", 1, 0], ["gpt-5.6-luna", -1, 0], ["gpt-5.6-luna", 0.1, 0],
    ["gpt-5.6-luna", NaN, 0], ["gpt-5.6-luna", Infinity, 0], ["text-embedding-3-small", 1, 1],
    ["gpt-5.6-terra", Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]]) {
    assert.throws(() => priceOperation(...args), { message: "MB_OPERATION_INVALID" });
  }
});

test("cached input pricing discounts only validated cached tokens and still rounds upward", () => {
  assert.equal(priceOperation("gpt-5.6-luna", 1_000_000, 0, 1_000_000), 20_000);
  assert.equal(priceOperation("gpt-5.6-terra", 1_000_000, 0, 1_000_000), 200_000);
  assert.equal(priceOperation("gpt-5.6-luna", 1_000_000, 100_000, 500_000), 230_000);
  assert.equal(priceOperation("gpt-5.6-terra", 1_000_000, 100_000, 500_000), 2_300_000);
  assert.equal(priceOperation("gpt-5.6-luna", 1, 0, 1), 1);
  for (const cached of [-1, 0.5, NaN, Infinity, 11, "1"]) {
    assert.throws(() => priceOperation("gpt-5.6-luna", 10, 0, cached), { message: "MB_OPERATION_INVALID" });
  }
  assert.throws(() => priceOperation("text-embedding-3-small", 10, 0, 1), { message: "MB_OPERATION_INVALID" });
});

test("Responses receipt reports cached usage and accounts at the current cached rate", async () => {
  for (const [model, microUsd] of [["gpt-5.6-luna", 37], ["gpt-5.6-terra", 364]]) {
    const value = envelope(review, { model });
    value.usage.input_tokens_details.cached_tokens = 20;
    const result = await executeBenchmarkOperation(operation("review", { model }), env, mocked(value));
    assert.deepEqual(result.usage, { inputTokens: 20, outputTokens: 30, microUsd, cachedInputTokens: 20 });
  }
});

test("review dispatch is fixed endpoint, private, synchronous, standard tier and schema-bound", async () => {
  let count = 0;
  const op = operation();
  validateBenchmarkOperation(op);
  const result = await executeBenchmarkOperation(op, env, async (url, init) => {
    count++;
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(init.method, "POST");
    assert.equal(init.redirect, "error");
    assert.equal(init.headers["OpenAI-Project"], "proj_synthetic");
    assert.equal(init.headers.Authorization, "Bearer synthetic-test-key");
    assert.equal(init.signal.aborted, false);
    const request = JSON.parse(init.body);
    assert.deepEqual(Object.keys(request).sort(), ["background", "input", "instructions", "max_output_tokens", "model",
      "reasoning", "service_tier", "store", "stream", "text", "truncation"].sort());
    assert.deepEqual(request.reasoning, { effort: "none" });
    assert.equal(request.store, false);
    assert.equal(request.background, false);
    assert.equal(request.stream, false);
    assert.equal(request.service_tier, "default");
    assert.equal(request.max_output_tokens, 2000);
    assert.equal(request.text.format.strict, true);
    assert.equal(request.text.format.type, "json_schema");
    assert.equal(request.text.format.schema.additionalProperties, false);
    return jsonResponse(envelope());
  });
  assert.equal(count, 1);
  assert.deepEqual(result.entries, review.entries);
  assert.deepEqual(result.usage, { inputTokens: 20, outputTokens: 30, microUsd: 40 });
  assert.equal(result.providerId, "resp_synthetic_1");
});

test("answer accepts grounded shape and evidence-free abstention", async () => {
  const grounded = await executeBenchmarkOperation(operation("answer"), env, mocked(envelope(answer)));
  assert.deepEqual(grounded.answer, answer);
  const abstain = { answer: "", factIds: [], abstain: true };
  assert.deepEqual((await executeBenchmarkOperation(operation("answer", { allowedFactIds: [] }), env,
    mocked(envelope(abstain)))).answer, abstain);
});

test("embedding request uses bounded array, float encoding and exactly 512 dimensions", async () => {
  const result = await executeBenchmarkOperation(operation("embedding"), env, async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/embeddings");
    assert.deepEqual(JSON.parse(init.body), { model: "text-embedding-3-small",
      input: ["Synthetic fact one.", "Synthetic fact two."], dimensions: 512, encoding_format: "float" });
    const response = embeddingEnvelope();
    response.data.reverse();
    return jsonResponse(response);
  });
  assert.equal(result.providerId, null);
  assert.equal(result.vectors.length, 2);
  assert.equal(result.vectors[0][0], 0.1);
  assert.equal(result.vectors[1][0], 0.2);
  assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 0, microUsd: 1 });
});

for (const [name, mutate] of [
  ["unknown operation field", op => ({ ...op, url: "https://example.invalid" })],
  ["unknown operation kind", op => ({ ...op, kind: "other" })],
  ["unknown operation model", op => ({ ...op, model: "gpt-5.6-luna-unknown" })],
  ["underreserved cost", op => ({ ...op, maximumMicroUsd: op.maximumMicroUsd - 1 })],
  ["oversized reservation", op => ({ ...op, maximumMicroUsd: op.maximumMicroUsd + 1 })],
  ["negative ordinal", op => ({ ...op, ordinal: -1 })],
  ["empty instructions", op => ({ ...op, instructions: "" })],
  ["empty input", op => ({ ...op, input: "" })],
  ["array Responses input", op => ({ ...op, input: ["one"] })],
  ["multibyte input exceeds bound", op => ({ ...op, input: "😀".repeat(5001) })],
  ["insufficient request framing allowance", op => ({ ...op, maximumInputTokens: 4096,
    maximumMicroUsd: priceOperation(op.model, 4096, op.maximumOutputTokens) })],
  ["review input ceiling", op => ({ ...op, maximumInputTokens: 20001,
    maximumMicroUsd: priceOperation(op.model, 20001, op.maximumOutputTokens) })],
  ["output ceiling", op => ({ ...op, maximumOutputTokens: 2001,
    maximumMicroUsd: priceOperation(op.model, op.maximumInputTokens, 2001) })],
  ["zero output", op => ({ ...op, maximumOutputTokens: 0,
    maximumMicroUsd: priceOperation(op.model, op.maximumInputTokens, 0) })],
  ["unexpected dimensions", op => ({ ...op, dimensions: 512 })],
  ["duplicate fact identifiers", op => ({ ...op, allowedFactIds: ["f1", "f1"] })],
  ["sparse fact identifiers", op => ({ ...op, allowedFactIds: Array(1) })],
]) test(`preflight rejects ${name} before dispatch`, async () => {
  let dispatched = false;
  const invalid = mutate(operation());
  assert.throws(() => validateBenchmarkOperation(invalid), { message: "MB_OPERATION_INVALID" });
  await rejectsCode(executeBenchmarkOperation(invalid, env, async () => {
    dispatched = true; return jsonResponse(envelope());
  }), "MB_OPERATION_INVALID");
  assert.equal(dispatched, false);
});

for (const [name, patch] of [
  ["empty list", { input: [] }], ["empty item", { input: [""] }], ["sparse list", { input: Array(1) }],
  ["too many items", { input: Array(129).fill("a") }], ["item token byte bound", { input: ["😀".repeat(2049)] }],
  ["aggregate token bound", { input: ["a".repeat(6000), "b".repeat(6000)] }],
  ["wrong dimensions", { dimensions: 1536 }], ["instructions", { instructions: "extra" }],
  ["unknown item type", { input: [[1, 2]] }],
]) test(`embedding preflight rejects ${name}`, async () => {
  await rejectsCode(executeBenchmarkOperation(operation("embedding", patch), env), "MB_OPERATION_INVALID");
});

for (const [name, patch] of [
  ["incomplete", { status: "incomplete" }], ["missing tier", { service_tier: undefined }],
  ["different tier", { service_tier: "priority" }], ["model prefix trick", { model: "gpt-5.6-luna-evil" }],
  ["unapproved snapshot", { model: "gpt-5.6-luna-2026-09-04" }],
  ["unexpected stored response", { store: true }], ["unexpected background run", { background: true }],
  ["unexpected tools", { tools: [{ type: "web_search" }] }],
  ["unexpected conversation continuation", { previous_response_id: "resp_prior" }],
  ["reported error", { error: { message: "private-provider-body" } }],
  ["reported incompleteness", { incomplete_details: { reason: "max_output_tokens" } }],
  ["missing output", { output: [] }], ["tool output", { output: [{ type: "function_call" }] }],
]) test(`provider response rejects ${name}`, async () => {
  await rejectsCode(executeBenchmarkOperation(operation(), env, mocked(envelope(review, patch))), "MB_PROVIDER_RESPONSE_INVALID");
});

for (const [name, usage] of [
  ["missing", undefined], ["fraction", { input_tokens: 1.5, output_tokens: 30, total_tokens: 31.5 }],
  ["numeric string", { input_tokens: "20", output_tokens: 30, total_tokens: 50 }],
  ["incoherent total", { input_tokens: 20, output_tokens: 30, total_tokens: 51 }],
  ["input above reservation", { input_tokens: 20001, output_tokens: 30, total_tokens: 20031 }],
  ["output above reservation", { input_tokens: 20, output_tokens: 2001, total_tokens: 2021 }],
  ["negative", { input_tokens: -1, output_tokens: 30, total_tokens: 29 }],
  ["zero output", { input_tokens: 20, output_tokens: 0, total_tokens: 20 }],
  ["new charge field", { input_tokens: 20, output_tokens: 30, total_tokens: 50, tool_tokens: 1 }],
  ["cache writes", { input_tokens: 20, output_tokens: 30, total_tokens: 50, input_tokens_details: { cache_write_tokens: 1 } }],
  ["impossible cached count", { input_tokens: 20, output_tokens: 30, total_tokens: 50, input_tokens_details: { cached_tokens: 21 } }],
  ["impossible reasoning count", { input_tokens: 20, output_tokens: 30, total_tokens: 50, output_tokens_details: { reasoning_tokens: 31 } }],
]) test(`usage rejects ${name}`, async () => {
  await rejectsCode(executeBenchmarkOperation(operation(), env, mocked(envelope(review, { usage }))), "MB_PROVIDER_RESPONSE_INVALID");
});

for (const [name, data] of [
  ["non JSON", "not JSON"], ["duplicate keys", '{"entries":[],"entries":[]}'],
  ["extra root key", { ...review, extra: true }], ["extra entry key", { entries: [{ ...review.entries[0], extra: true }] }],
  ["unknown evidence", { entries: [{ factIds: ["forbidden"], text: "Fact." }] }],
  ["empty evidence", { entries: [{ factIds: [], text: "Fact." }] }],
  ["duplicate evidence", { entries: [{ factIds: ["f1", "f1"], text: "Fact." }] }],
  ["empty text", { entries: [{ factIds: ["f1"], text: " " }] }],
  ["too many entries", { entries: Array(65).fill(review.entries[0]) }],
  ["oversize UTF8 entry", { entries: [{ factIds: ["f1"], text: "😀".repeat(1001) }] }],
]) test(`review evidence rejects ${name}`, async () => {
  await rejectsCode(executeBenchmarkOperation(operation(), env, mocked(envelope(data))), "MB_PROVIDER_RESPONSE_INVALID");
});

for (const [name, data] of [
  ["unknown evidence", { ...answer, factIds: ["forbidden"] }], ["ungrounded answer", { ...answer, factIds: [] }],
  ["non-boolean abstention", { ...answer, abstain: "false" }], ["extra key", { ...answer, extra: true }],
  ["empty non-abstention", { ...answer, answer: "" }], ["oversize serialized answer", { ...answer, answer: "x".repeat(3990) }],
]) test(`answer evidence rejects ${name}`, async () => {
  await rejectsCode(executeBenchmarkOperation(operation("answer"), env, mocked(envelope(data))), "MB_PROVIDER_RESPONSE_INVALID");
});

for (const [name, mutate] of [
  ["refusal", value => { value.output[0].content = [{ type: "refusal", refusal: "provider-private" }]; }],
  ["unknown content", value => { value.output[0].content[0].type = "audio"; }],
  ["extra content", value => { value.output[0].content.push(value.output[0].content[0]); }],
  ["annotation", value => { value.output[0].content[0].annotations = [{ type: "url_citation" }]; }],
  ["extra output message", value => { value.output.push(value.output[0]); }],
  ["message not complete", value => { value.output[0].status = "in_progress"; }],
]) test(`output envelope rejects ${name}`, async () => {
  const value = envelope(); mutate(value);
  await rejectsCode(executeBenchmarkOperation(operation(), env, mocked(value)), "MB_PROVIDER_RESPONSE_INVALID");
});

for (const [name, mutate] of [
  ["wrong model", value => { value.model = "text-embedding-3-large"; }],
  ["missing vector", value => { value.data.pop(); }],
  ["wrong dimensions", value => { value.data[0].embedding.pop(); }],
  ["non-finite vector", value => { value.data[0].embedding[0] = Infinity; }],
  ["string vector", value => { value.data[0].embedding[0] = "1"; }],
  ["duplicate index", value => { value.data[1].index = 0; }],
  ["out-of-bounds index", value => { value.data[1].index = 2; }],
  ["fractional index", value => { value.data[1].index = 0.5; }],
  ["unexpected item key", value => { value.data[0].other = true; }],
  ["bad usage total", value => { value.usage.total_tokens = 11; }],
  ["new usage field", value => { value.usage.output_tokens = 1; }],
]) test(`embeddings response rejects ${name}`, async () => {
  const value = embeddingEnvelope(); mutate(value);
  await rejectsCode(executeBenchmarkOperation(operation("embedding"), env, mocked(value)), "MB_PROVIDER_RESPONSE_INVALID");
});

test("missing or invalid credentials fail before dispatch without exposing values", async () => {
  for (const invalid of [{}, { OPENAI_API_KEY: "" }, { OPENAI_API_KEY: "synthetic\nkey" },
    { ...env, OPENAI_PROJECT: "header\r\ninjection" }]) {
    await rejectsCode(executeBenchmarkOperation(operation(), invalid), "MB_CREDENTIAL_UNAVAILABLE");
  }
});

test("no provider retries and errors never include response or fetch exception details", async () => {
  let calls = 0;
  await rejectsCode(executeBenchmarkOperation(operation(), env, async () => {
    calls++;
    return new Response("provider-private-response-body", { status: 429 });
  }), "MB_PROVIDER_HTTP");
  assert.equal(calls, 1);
  await rejectsCode(executeBenchmarkOperation(operation(), env, async () => {
    throw new Error("provider-private-exception-value");
  }), "MB_PROVIDER_TRANSPORT");
});

test("redirect status and already-followed redirect responses are rejected", async () => {
  await rejectsCode(executeBenchmarkOperation(operation(), env, async () => new Response(null,
    { status: 302, headers: { location: "https://example.invalid" } })), "MB_PROVIDER_HTTP");
  const response = jsonResponse(envelope());
  Object.defineProperty(response, "redirected", { value: true });
  await rejectsCode(executeBenchmarkOperation(operation(), env, async () => response), "MB_PROVIDER_HTTP");
});

test("body is bounded even without content-length and malformed UTF8 is safe", async () => {
  let cancelled = false;
  const oversized = new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array(1024 * 1024 + 1));
  }, cancel() { cancelled = true; } });
  await rejectsCode(executeBenchmarkOperation(operation(), env, async () => new Response(oversized,
    { headers: { "content-type": "application/json" } })), "MB_PROVIDER_RESPONSE_TOO_LARGE");
  assert.equal(cancelled, true);
  await rejectsCode(executeBenchmarkOperation(operation(), env, async () => new Response(new Uint8Array([0xff]),
    { headers: { "content-type": "application/json" } })), "MB_PROVIDER_TRANSPORT");
});

test("declared oversize, non-JSON MIME and invalid JSON are safely rejected", async () => {
  await rejectsCode(executeBenchmarkOperation(operation(), env, async () => new Response("{}",
    { headers: { "content-type": "application/json", "content-length": "1048577" } })), "MB_PROVIDER_RESPONSE_TOO_LARGE");
  await rejectsCode(executeBenchmarkOperation(operation(), env, async () => new Response("{}",
    { headers: { "content-type": "text/html" } })), "MB_PROVIDER_RESPONSE_INVALID");
  await rejectsCode(executeBenchmarkOperation(operation(), env, async () => new Response("{broken",
    { headers: { "content-type": "application/json" } })), "MB_PROVIDER_RESPONSE_INVALID");
});

test("duplicate escaped provider keys and excessive JSON nesting are rejected", async () => {
  const raw = JSON.stringify(envelope()).replace('"model":"gpt-5.6-luna"',
    '"model":"gpt-5.6-luna","mo\\u0064el":"gpt-5.6-luna"');
  await rejectsCode(executeBenchmarkOperation(operation(), env, async () => new Response(raw,
    { headers: { "content-type": "application/json" } })), "MB_PROVIDER_RESPONSE_INVALID");
  const value = envelope();
  let deep = {}; value.unused = deep;
  for (let i = 0; i < 34; i++) { deep.next = {}; deep = deep.next; }
  await rejectsCode(executeBenchmarkOperation(operation(), env, mocked(value)), "MB_PROVIDER_RESPONSE_INVALID");
});

test("30-second deadline applies to unresolved fetch without waiting for abort compliance", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal;
  const pending = executeBenchmarkOperation(operation(), env, async (_url, init) => {
    signal = init.signal;
    return new Promise(() => {});
  });
  const rejected = rejectsCode(pending, "MB_PROVIDER_TIMEOUT");
  t.mock.timers.tick(30_000);
  await rejected;
  assert.equal(signal.aborted, true);
});

test("deadline also cancels a stalled response stream", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let cancelled = false;
  const stream = new ReadableStream({ cancel() { cancelled = true; } });
  const pending = executeBenchmarkOperation(operation(), env, async () => new Response(stream,
    { headers: { "content-type": "application/json" } }));
  const rejected = rejectsCode(pending, "MB_PROVIDER_TIMEOUT");
  await Promise.resolve();
  await Promise.resolve();
  t.mock.timers.tick(30_000);
  await rejected;
  assert.equal(cancelled, true);
});

const receipt = (kind = "review") => ({ kind,
  model: kind === "embedding" ? "text-embedding-3-small" : "gpt-5.6-luna",
  providerId: kind === "embedding" ? null : "resp_synthetic_1",
  usage: kind === "embedding" ? { inputTokens: 10, outputTokens: 0, microUsd: 1 } :
    { inputTokens: 20, outputTokens: 30, microUsd: 40 },
  ...(kind === "embedding" ? { vectors: [Array(512).fill(0.1), Array(512).fill(0.2)] } :
    kind === "review" ? structuredClone(review) : { answer: structuredClone(answer) }),
});

test("stored result validation is network-free and returns detached data", () => {
  for (const kind of ["review", "answer", "embedding"]) {
    const stored = receipt(kind);
    const validated = validateBenchmarkResult(operation(kind), stored);
    assert.deepEqual(validated, stored);
    assert.notEqual(validated, stored);
    assert.notEqual(validated.usage, stored.usage);
    if (kind === "review") {
      validated.entries[0].factIds.push("f2");
      assert.deepEqual(stored.entries[0].factIds, ["f1"]);
    } else if (kind === "answer") {
      validated.answer.factIds.push("f2");
      assert.deepEqual(stored.answer.factIds, ["f1"]);
    } else {
      validated.vectors[0][0] = 0.9;
      assert.equal(stored.vectors[0][0], 0.1);
    }
  }
});

test("stored cached receipt must match recomputed cached-token price", () => {
  const stored = receipt();
  stored.usage.cachedInputTokens = 20;
  stored.usage.microUsd = 37;
  assert.deepEqual(validateBenchmarkResult(operation(), stored).usage, stored.usage);
  stored.usage.microUsd = 40;
  assert.throws(() => validateBenchmarkResult(operation(), stored), { message: "MB_PROVIDER_RESPONSE_INVALID" });
});

test("abstention may cite actual observations without claiming the unsupported inference", async () => {
  const observed = { answer: "The exposure was observed, but preference is unknown.", factIds: ["f1"], abstain: true };
  const stored = receipt("answer");
  stored.answer = observed;
  assert.deepEqual(validateBenchmarkResult(operation("answer"), stored).answer, observed);
  assert.deepEqual((await executeBenchmarkOperation(operation("answer"), env, mocked(envelope(observed)))).answer, observed);
});

for (const [name, kind, mutate] of [
  ["wrong operation kind", "review", value => { value.kind = "answer"; }],
  ["wrong exact model", "review", value => { value.model = "gpt-5.6-luna-snapshot"; }],
  ["missing provider id", "review", value => { value.providerId = null; }],
  ["unsafe provider id", "review", value => { value.providerId = "unexpected\nprivate"; }],
  ["extra result key", "review", value => { value.unexpected = undefined; }],
  ["wrong payload key", "review", value => { value.answer = answer; delete value.entries; }],
  ["extra usage key", "review", value => { value.usage.newBilling = 1; }],
  ["fractional usage", "review", value => { value.usage.inputTokens = 20.5; }],
  ["usage above reservation", "review", value => { value.usage.inputTokens = 20001; }],
  ["output above reservation", "review", value => { value.usage.outputTokens = 2001; }],
  ["zero output", "review", value => { value.usage.outputTokens = 0; }],
  ["altered actual cost", "review", value => { value.usage.microUsd = 39; }],
  ["altered cache count", "review", value => { value.usage.cachedInputTokens = 20; }],
  ["cache count above input", "review", value => { value.usage.cachedInputTokens = 21; }],
  ["undefined cache count", "review", value => { value.usage.cachedInputTokens = undefined; }],
  ["unknown evidence", "review", value => { value.entries[0].factIds = ["forbidden"]; }],
  ["duplicate evidence", "review", value => { value.entries[0].factIds = ["f1", "f1"]; }],
  ["sparse evidence", "review", value => { value.entries[0].factIds = Array(1); }],
  ["extra entry key", "review", value => { value.entries[0].unexpected = undefined; }],
  ["empty entry", "review", value => { value.entries[0].text = " "; }],
  ["oversize entry", "review", value => { value.entries[0].text = "😀".repeat(1001); }],
  ["sparse entries", "review", value => { value.entries = Array(1); }],
  ["too many entries", "review", value => { value.entries = Array(65).fill(value.entries[0]); }],
  ["answer without grounding", "answer", value => { value.answer.factIds = []; }],
  ["non-boolean abstain", "answer", value => { value.answer.abstain = "true"; }],
  ["extra answer key", "answer", value => { value.answer.unexpected = undefined; }],
  ["oversize serialized answer", "answer", value => { value.answer.answer = "x".repeat(3990); }],
  ["embedding provider id", "embedding", value => { value.providerId = "resp_unexpected"; }],
  ["embedding output usage", "embedding", value => { value.usage.outputTokens = 1; }],
  ["embedding cache usage", "embedding", value => { value.usage.cachedInputTokens = 1; }],
  ["wrong vector count", "embedding", value => { value.vectors.pop(); }],
  ["wrong vector dimensions", "embedding", value => { value.vectors[0].pop(); }],
  ["sparse vectors", "embedding", value => { value.vectors = Array(2); }],
  ["sparse components", "embedding", value => { value.vectors[0] = Array(512); }],
  ["zero vector", "embedding", value => { value.vectors[0].fill(0); }],
  ["norm underflow", "embedding", value => { value.vectors[0].fill(Number.MIN_VALUE); }],
  ["nonfinite component", "embedding", value => { value.vectors[0][0] = Infinity; }],
  ["component above normalized range", "embedding", value => { value.vectors[0][0] = 1.1; }],
  ["component below normalized range", "embedding", value => { value.vectors[0][0] = -1.1; }],
]) test(`stored receipt rejects ${name}`, () => {
  const stored = receipt(kind); mutate(stored);
  assert.throws(() => validateBenchmarkResult(operation(kind), stored), { message: "MB_PROVIDER_RESPONSE_INVALID" });
});

test("fresh provider vectors also reject zero norms and components outside normalized range", async () => {
  for (const component of [0, 1.1, -1.1, Number.MIN_VALUE]) {
    const value = embeddingEnvelope();
    value.data[0].embedding.fill(component);
    await rejectsCode(executeBenchmarkOperation(operation("embedding"), env, mocked(value)), "MB_PROVIDER_RESPONSE_INVALID");
  }
});

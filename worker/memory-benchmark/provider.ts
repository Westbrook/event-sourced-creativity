import type { BenchmarkAnswer, BenchmarkOperation, BenchmarkResult, BenchmarkUsage, MemoryEntry } from "./types.ts";

/** Fixed, standard-tier prices, checked against official model pages on 2026-09-04.
 * Integers below are hundredths of one micro-dollar per token. Reservation calls
 * omit cached input; receipts use only the provider's validated cached count.
 * https://developers.openai.com/api/docs/models/gpt-5.6-luna
 * https://developers.openai.com/api/docs/models/gpt-5.6-terra
 * https://developers.openai.com/api/docs/models/text-embedding-3-small
 */
const PRICES = {
  "text-embedding-3-small": [2, 0, 0],
  "gpt-5.6-luna": [20, 120, 2],
  "gpt-5.6-terra": [200, 1200, 20],
} as const;
export const BENCHMARK_PRICE_SOURCE_DATE = "2026-09-04";
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_REQUEST_BYTES = 128 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const encoder = new TextEncoder();
const ERROR_CODES = new Set([
  "MB_OPERATION_INVALID", "MB_CREDENTIAL_UNAVAILABLE", "MB_PROVIDER_TIMEOUT",
  "MB_PROVIDER_HTTP", "MB_PROVIDER_RESPONSE_INVALID", "MB_PROVIDER_TRANSPORT",
  "MB_PROVIDER_RESPONSE_TOO_LARGE",
]);

export class BenchmarkProviderError extends Error {
  readonly code: string;
  constructor(code: string) {
    const safeCode = ERROR_CODES.has(code) ? code : "MB_PROVIDER_TRANSPORT";
    super(safeCode);
    this.name = "BenchmarkProviderError";
    this.code = safeCode;
  }
}

function fail(code: string): never { throw new BenchmarkProviderError(code); }
const bytes = (value: string): number => encoder.encode(value).byteLength;
const integer = (value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const onlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).every(key => keys.includes(key));
const boundedText = (value: unknown, maximum: number, allowEmpty = false): value is string =>
  typeof value === "string" && (allowEmpty || value.trim().length > 0) && bytes(value) <= maximum;
const identifier = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/.test(value);

/** Rounded UP to whole micro-USD; output includes any billed reasoning tokens. */
export function priceOperation(model: string, inputTokens: number, outputTokens: number, cachedInputTokens = 0): number {
  if (!Object.hasOwn(PRICES, model) || !integer(inputTokens) || !integer(outputTokens) ||
      !integer(cachedInputTokens, 0, inputTokens) ||
      (model === "text-embedding-3-small" && (outputTokens !== 0 || cachedInputTokens !== 0))) fail("MB_OPERATION_INVALID");
  const rates = PRICES[model as keyof typeof PRICES];
  const hundredths = BigInt(inputTokens - cachedInputTokens) * BigInt(rates[0]) +
    BigInt(outputTokens) * BigInt(rates[1]) + BigInt(cachedInputTokens) * BigInt(rates[2]);
  const rounded = (hundredths + 99n) / 100n;
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) fail("MB_OPERATION_INVALID");
  return Number(rounded);
}

function validateOperation(operation: BenchmarkOperation): void {
  if (!record(operation) || !onlyKeys(operation, [
    "id", "ordinal", "kind", "model", "instructions", "input", "maximumInputTokens",
    "maximumOutputTokens", "maximumMicroUsd", "allowedFactIds", "dimensions",
  ]) || !identifier(operation.id) || !integer(operation.ordinal) ||
      !["review", "embedding", "answer"].includes(operation.kind) ||
      !boundedText(operation.instructions, 4096, operation.kind === "embedding") ||
      !integer(operation.maximumInputTokens, 1, 128 * 8192) ||
      !integer(operation.maximumOutputTokens, 0, 4000) ||
      !integer(operation.maximumMicroUsd, 1) ||
      !Array.isArray(operation.allowedFactIds) || operation.allowedFactIds.length > 512 ||
      ![...operation.allowedFactIds].every(identifier) ||
      new Set(operation.allowedFactIds).size !== operation.allowedFactIds.length) fail("MB_OPERATION_INVALID");

  if (operation.kind === "embedding") {
    if (operation.model !== "text-embedding-3-small" || operation.dimensions !== 512 ||
        operation.instructions !== "" || operation.maximumOutputTokens !== 0 || operation.maximumInputTokens > 10_000 ||
        !Array.isArray(operation.input) || operation.input.length < 1 || operation.input.length > 128 ||
        ![...operation.input].every(item => boundedText(item, 8192)) ||
        operation.input.reduce((sum, item) => sum + bytes(item), 0) > operation.maximumInputTokens) fail("MB_OPERATION_INVALID");
  } else {
    if (!["gpt-5.6-luna", "gpt-5.6-terra"].includes(operation.model) ||
        operation.dimensions !== undefined || !boundedText(operation.input, 20_000) ||
        operation.maximumInputTokens > (operation.kind === "review" ? 20_000 : 10_000) ||
        operation.maximumOutputTokens < 1 ||
        operation.maximumOutputTokens > (operation.kind === "review" ? 2000 : 1000)) fail("MB_OPERATION_INVALID");
  }
  if (operation.maximumMicroUsd !== priceOperation(operation.model, operation.maximumInputTokens,
    operation.maximumOutputTokens)) fail("MB_OPERATION_INVALID");
}

function outputSchema(kind: "review" | "answer"): Record<string, unknown> {
  const facts = { type: "array", items: { type: "string" }, maxItems: 64 };
  if (kind === "review") return {
    type: "object", additionalProperties: false, required: ["entries"],
    properties: { entries: { type: "array", maxItems: 64, items: {
      type: "object", additionalProperties: false, required: ["factIds", "text"],
      properties: { factIds: { ...facts, minItems: 1 }, text: { type: "string" } },
    } } },
  };
  return {
    type: "object", additionalProperties: false, required: ["answer", "factIds", "abstain"],
    properties: { answer: { type: "string" }, factIds: facts, abstain: { type: "boolean" } },
  };
}

function buildRequest(operation: BenchmarkOperation): { url: string; body: string } {
  const embedding = operation.kind === "embedding";
  // No tools, files, previous response, metadata, cache control, or custom endpoint.
  const body = JSON.stringify(embedding ? {
    model: operation.model, input: operation.input, dimensions: 512, encoding_format: "float",
  } : {
    model: operation.model, instructions: operation.instructions, input: operation.input,
    store: false, background: false, stream: false, service_tier: "default",
    reasoning: { effort: "none" }, truncation: "disabled",
    max_output_tokens: operation.maximumOutputTokens,
    text: { format: { type: "json_schema", name: `memory_benchmark_${operation.kind}`,
      strict: true, schema: outputSchema(operation.kind as "review" | "answer") } },
  });
  const size = bytes(body);
  // UTF-8 bytes upper-bound text tokenization. Count the entire serialized request
  // and an extra framing margin for Responses instead of assuming chars / 4.
  if (size > MAX_REQUEST_BYTES || (!embedding && size + 4096 > operation.maximumInputTokens)) fail("MB_OPERATION_INVALID");
  return { url: `https://api.openai.com/v1/${embedding ? "embeddings" : "responses"}`, body };
}

/** Run before reserving funds. Exact model availability, current rates, and the
 * UTF-8/token framing contract still require hosted qualification. No dated
 * snapshot aliases are accepted until separately reviewed against official docs.
 */
export function validateBenchmarkOperation(operation: BenchmarkOperation): void {
  try {
    validateOperation(operation);
    buildRequest(operation);
  } catch { fail("MB_OPERATION_INVALID"); }
}

function parseJson(text: string): unknown {
  try {
    const parsed: unknown = JSON.parse(text);
    // JSON.parse silently accepts duplicate keys; reject that ambiguity in both
    // the provider envelope and generated evidence objects. Syntax is already
    // checked above; this second bounded scan checks keys and nesting only.
    let offset = 0;
    const whitespace = () => { while (/\s/.test(text[offset] ?? "!")) offset++; };
    const string = (): string => {
      const start = offset++;
      while (offset < text.length) {
        const character = text[offset++];
        if (character === "\\") offset++;
        else if (character === '"') return JSON.parse(text.slice(start, offset)) as string;
      }
      return fail("MB_PROVIDER_RESPONSE_INVALID");
    };
    const value = (depth: number): void => {
      if (depth > 32) fail("MB_PROVIDER_RESPONSE_INVALID");
      whitespace();
      if (text[offset] === '"') { string(); return; }
      if (text[offset] === "{") {
        offset++; whitespace();
        const keys = new Set<string>();
        if (text[offset] === "}") { offset++; return; }
        while (offset < text.length) {
          const key = string();
          if (keys.has(key)) fail("MB_PROVIDER_RESPONSE_INVALID");
          keys.add(key); whitespace(); offset++; value(depth + 1); whitespace();
          if (text[offset++] === "}") return;
          whitespace();
        }
      } else if (text[offset] === "[") {
        offset++; whitespace();
        if (text[offset] === "]") { offset++; return; }
        while (offset < text.length) {
          value(depth + 1); whitespace();
          if (text[offset++] === "]") return;
        }
      } else {
        while (offset < text.length && !/[\s,}\]]/.test(text[offset])) offset++;
      }
    };
    value(0);
    return parsed;
  } catch { return fail("MB_PROVIDER_RESPONSE_INVALID"); }
}

function parseUsage(value: unknown, operation: BenchmarkOperation): BenchmarkUsage {
  if (!record(value)) fail("MB_PROVIDER_RESPONSE_INVALID");
  const embedding = operation.kind === "embedding";
  const input = embedding ? value.prompt_tokens : value.input_tokens;
  const output = embedding ? 0 : value.output_tokens;
  if (!integer(input, 1, operation.maximumInputTokens) ||
      !integer(output, embedding ? 0 : 1, operation.maximumOutputTokens) ||
      !integer(value.total_tokens) || value.total_tokens !== input + output) fail("MB_PROVIDER_RESPONSE_INVALID");
  if (embedding && !exactKeys(value, ["prompt_tokens", "total_tokens"])) fail("MB_PROVIDER_RESPONSE_INVALID");
  if (!embedding && !onlyKeys(value, ["input_tokens", "output_tokens", "total_tokens", "input_tokens_details", "output_tokens_details"])) fail("MB_PROVIDER_RESPONSE_INVALID");
  let cachedInputTokens = 0;
  if (value.input_tokens_details !== undefined) {
    if (!record(value.input_tokens_details) || !onlyKeys(value.input_tokens_details, ["cached_tokens", "cache_write_tokens"]) ||
        (value.input_tokens_details.cached_tokens !== undefined && !integer(value.input_tokens_details.cached_tokens, 0, input)) ||
        (value.input_tokens_details.cache_write_tokens !== undefined && value.input_tokens_details.cache_write_tokens !== 0)) fail("MB_PROVIDER_RESPONSE_INVALID");
    cachedInputTokens = (value.input_tokens_details.cached_tokens as number | undefined) ?? 0;
  }
  if (value.output_tokens_details !== undefined) {
    if (!record(value.output_tokens_details) || !onlyKeys(value.output_tokens_details, ["reasoning_tokens"]) ||
        (value.output_tokens_details.reasoning_tokens !== undefined && !integer(value.output_tokens_details.reasoning_tokens, 0, output))) fail("MB_PROVIDER_RESPONSE_INVALID");
  }
  const microUsd = priceOperation(operation.model, input, output, cachedInputTokens);
  if (microUsd > operation.maximumMicroUsd) fail("MB_PROVIDER_RESPONSE_INVALID");
  return { inputTokens: input, outputTokens: output, microUsd,
    ...(cachedInputTokens > 0 ? { cachedInputTokens } : {}) };
}

function factIds(value: unknown, allowed: readonly string[], minimum: number): string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > 64 ||
      ![...value].every(id => typeof id === "string" && allowed.includes(id)) ||
      new Set(value).size !== value.length) fail("MB_PROVIDER_RESPONSE_INVALID");
  return [...value];
}

function parseOutput(text: string, operation: BenchmarkOperation): { entries?: MemoryEntry[]; answer?: BenchmarkAnswer } {
  if (!boundedText(text, operation.kind === "answer" ? 4000 : 64 * 4096)) fail("MB_PROVIDER_RESPONSE_INVALID");
  return validateOutputShape(parseJson(text), operation);
}

function validateOutputShape(value: unknown, operation: BenchmarkOperation): { entries?: MemoryEntry[]; answer?: BenchmarkAnswer } {
  if (!record(value)) fail("MB_PROVIDER_RESPONSE_INVALID");
  if (operation.kind === "review") {
    if (!exactKeys(value, ["entries"]) || !Array.isArray(value.entries) || value.entries.length > 64) fail("MB_PROVIDER_RESPONSE_INVALID");
    const entries = [...value.entries].map(entry => {
      if (!record(entry) || !exactKeys(entry, ["factIds", "text"]) || !boundedText(entry.text, 4000)) fail("MB_PROVIDER_RESPONSE_INVALID");
      return { factIds: factIds(entry.factIds, operation.allowedFactIds, 1), text: entry.text };
    });
    if (bytes(JSON.stringify({ entries })) > 64 * 4096) fail("MB_PROVIDER_RESPONSE_INVALID");
    return { entries };
  }
  if (!exactKeys(value, ["answer", "factIds", "abstain"]) || typeof value.abstain !== "boolean" ||
      !boundedText(value.answer, 4000, value.abstain)) fail("MB_PROVIDER_RESPONSE_INVALID");
  const evidence = factIds(value.factIds, operation.allowedFactIds, value.abstain ? 0 : 1);
  const answer = { answer: value.answer, factIds: evidence, abstain: value.abstain };
  if (bytes(JSON.stringify(answer)) > 4000) fail("MB_PROVIDER_RESPONSE_INVALID");
  return { answer };
}

function validateVectors(value: unknown, count: number): number[][] {
  if (!Array.isArray(value) || value.length !== count) fail("MB_PROVIDER_RESPONSE_INVALID");
  return [...value].map(vector => {
    if (!Array.isArray(vector) || vector.length !== 512 ||
        ![...vector].every(component => typeof component === "number" && Number.isFinite(component) &&
          component >= -1 && component <= 1)) fail("MB_PROVIDER_RESPONSE_INVALID");
    const normSquared = vector.reduce((sum, component) => sum + component * component, 0);
    if (!Number.isFinite(normSquared) || normSquared <= 0) fail("MB_PROVIDER_RESPONSE_INVALID");
    return [...vector];
  });
}

/** Recheck a stored receipt without network or credentials. Storage integrity,
 * request-hash binding and ledger cost equality remain the caller's responsibility.
 * Return fresh arrays/objects, not mutable references to the persisted input.
 */
export function validateBenchmarkResult(operation: BenchmarkOperation, result: unknown): BenchmarkResult {
  validateBenchmarkOperation(operation);
  try {
    const payloadKey = operation.kind === "embedding" ? "vectors" : operation.kind === "review" ? "entries" : "answer";
    if (!record(result) || !exactKeys(result, ["kind", "model", "providerId", "usage", payloadKey]) ||
        result.kind !== operation.kind || result.model !== operation.model ||
        (operation.kind === "embedding" ? result.providerId !== null : !identifier(result.providerId)) ||
        !record(result.usage)) fail("MB_PROVIDER_RESPONSE_INVALID");
    const stored = result.usage;
    const cachedPresent = Object.hasOwn(stored, "cachedInputTokens");
    if (!exactKeys(stored, ["inputTokens", "outputTokens", "microUsd", ...(cachedPresent ? ["cachedInputTokens"] : [])]) ||
        !integer(stored.inputTokens, 1, operation.maximumInputTokens) ||
        !integer(stored.outputTokens, operation.kind === "embedding" ? 0 : 1, operation.maximumOutputTokens) ||
        !integer(stored.microUsd, 1, operation.maximumMicroUsd) ||
        (cachedPresent && !integer(stored.cachedInputTokens, 0, stored.inputTokens)) ||
        (operation.kind === "embedding" && cachedPresent && stored.cachedInputTokens !== 0)) fail("MB_PROVIDER_RESPONSE_INVALID");
    const usage = parseUsage(operation.kind === "embedding" ? {
      prompt_tokens: stored.inputTokens, total_tokens: stored.inputTokens,
    } : {
      input_tokens: stored.inputTokens, output_tokens: stored.outputTokens,
      total_tokens: stored.inputTokens + stored.outputTokens,
      input_tokens_details: { cached_tokens: cachedPresent ? stored.cachedInputTokens : 0 },
    }, operation);
    if (stored.microUsd !== usage.microUsd) fail("MB_PROVIDER_RESPONSE_INVALID");
    const base = { kind: operation.kind, model: operation.model,
      providerId: result.providerId as string | null, usage };
    if (operation.kind === "embedding") return {
      ...base, vectors: validateVectors(result.vectors, (operation.input as string[]).length),
    };
    return { ...base, ...validateOutputShape(operation.kind === "review" ? { entries: result.entries } : result.answer, operation) };
  } catch { return fail("MB_PROVIDER_RESPONSE_INVALID"); }
}

function parseResponse(value: unknown, operation: BenchmarkOperation): BenchmarkResult {
  if (!record(value) || value.model !== operation.model) fail("MB_PROVIDER_RESPONSE_INVALID");
  const usage = parseUsage(value.usage, operation);
  if (operation.kind === "embedding") {
    if (!exactKeys(value, ["object", "data", "model", "usage"]) || value.object !== "list" ||
        !Array.isArray(value.data) || value.data.length !== (operation.input as string[]).length) fail("MB_PROVIDER_RESPONSE_INVALID");
    const vectors: number[][] = new Array(value.data.length);
    for (const item of value.data) {
      if (!record(item) || !exactKeys(item, ["object", "index", "embedding"]) || item.object !== "embedding" ||
          !integer(item.index, 0, vectors.length - 1) || vectors[item.index] !== undefined ||
          !Array.isArray(item.embedding) || item.embedding.length !== 512 ||
          !item.embedding.every(component => typeof component === "number" && Number.isFinite(component))) fail("MB_PROVIDER_RESPONSE_INVALID");
      vectors[item.index] = item.embedding;
    }
    return { kind: "embedding", model: operation.model, providerId: null, usage, vectors };
  }
  if (value.object !== "response" || value.status !== "completed" || value.service_tier !== "default" ||
      value.error != null || value.incomplete_details != null || !identifier(value.id) ||
      (value.store !== undefined && value.store !== false) ||
      (value.background !== undefined && value.background !== false) ||
      (value.tools !== undefined && (!Array.isArray(value.tools) || value.tools.length !== 0)) ||
      value.previous_response_id != null ||
      !Array.isArray(value.output) || value.output.length !== 1) fail("MB_PROVIDER_RESPONSE_INVALID");
  const message = value.output[0];
  if (!record(message) || !onlyKeys(message, ["id", "type", "status", "role", "content"]) ||
      message.type !== "message" || message.role !== "assistant" || message.status !== "completed" ||
      !identifier(message.id) || !Array.isArray(message.content) || message.content.length !== 1) fail("MB_PROVIDER_RESPONSE_INVALID");
  const content = message.content[0];
  if (!record(content) || !onlyKeys(content, ["type", "text", "annotations", "logprobs"]) ||
      content.type !== "output_text" || typeof content.text !== "string" ||
      !Array.isArray(content.annotations) || content.annotations.length !== 0 ||
      (content.logprobs !== undefined && (!Array.isArray(content.logprobs) || content.logprobs.length !== 0))) fail("MB_PROVIDER_RESPONSE_INVALID");
  return { kind: operation.kind, model: operation.model, providerId: value.id, usage, ...parseOutput(content.text, operation) };
}

export interface BenchmarkProviderEnvironment { OPENAI_API_KEY?: string; OPENAI_PROJECT?: string }

/** Only call after the caller durably reserves the full maximumMicroUsd. Errors
 * intentionally omit provider bodies, headers and causes. Every post-dispatch
 * failure is potentially charged: the caller must retain its reservation and
 * must NOT retry automatically. This module does not authorize paid execution.
 */
export async function executeBenchmarkOperation(
  operation: BenchmarkOperation,
  env: BenchmarkProviderEnvironment,
  fetcher: typeof fetch = fetch,
): Promise<BenchmarkResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const controller = new AbortController();
  try {
    validateBenchmarkOperation(operation);
    const { url, body } = buildRequest(operation);
    if (!env || typeof env.OPENAI_API_KEY !== "string" || !/^[!-~]{8,4096}$/.test(env.OPENAI_API_KEY) ||
        (env.OPENAI_PROJECT !== undefined && (typeof env.OPENAI_PROJECT !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(env.OPENAI_PROJECT)))) fail("MB_CREDENTIAL_UNAVAILABLE");
    const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` };
    if (env.OPENAI_PROJECT) headers["OpenAI-Project"] = env.OPENAI_PROJECT;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new BenchmarkProviderError("MB_PROVIDER_TIMEOUT"));
      }, REQUEST_TIMEOUT_MS);
    });
    const request = (async (): Promise<BenchmarkResult> => {
      const response = await fetcher(url, { method: "POST", headers, body, signal: controller.signal, redirect: "error" });
      if (controller.signal.aborted) fail("MB_PROVIDER_TIMEOUT");
      if (response.redirected || response.status !== 200 || !response.ok) fail("MB_PROVIDER_HTTP");
      if (!/^application\/json(?:\s*;|\s*$)/i.test(response.headers.get("content-type") ?? "")) fail("MB_PROVIDER_RESPONSE_INVALID");
      const declaredSize = response.headers.get("content-length");
      if (declaredSize !== null && (!/^\d+$/.test(declaredSize) || !integer(Number(declaredSize), 0, MAX_RESPONSE_BYTES))) fail("MB_PROVIDER_RESPONSE_TOO_LARGE");
      if (!response.body) fail("MB_PROVIDER_RESPONSE_INVALID");
      reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let size = 0;
      let text = "";
      while (true) {
        const chunk = await reader.read();
        if (controller.signal.aborted) fail("MB_PROVIDER_TIMEOUT");
        if (chunk.done) break;
        if (!(chunk.value instanceof Uint8Array)) fail("MB_PROVIDER_RESPONSE_INVALID");
        size += chunk.value.byteLength;
        if (size > MAX_RESPONSE_BYTES) fail("MB_PROVIDER_RESPONSE_TOO_LARGE");
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
      return validateBenchmarkResult(operation, parseResponse(parseJson(text), operation));
    })();
    return await Promise.race([request, deadline]);
  } catch (error) {
    if (error instanceof BenchmarkProviderError) throw new BenchmarkProviderError(error.code);
    return fail(controller.signal.aborted ? "MB_PROVIDER_TIMEOUT" : "MB_PROVIDER_TRANSPORT");
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    controller.abort();
    // A hostile/stalled stream must not prolong the deadline during cleanup.
    if (reader) void reader.cancel().catch(() => undefined);
  }
}

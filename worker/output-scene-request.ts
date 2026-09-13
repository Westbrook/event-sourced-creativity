import { canonicalJson, freeze } from "../src/experiences/compiler.ts";
import { createExperienceSceneAdapterRequest } from "./experience-scene-adapter-contract.ts";
import { OPENAI_TEXT_PRICING_VERSION, readOpenAITextUsage, priceCurrentOpenAITextUsage } from "./openai-text-cost.ts";

export const OUTPUT_SCENE_MODEL = "gpt-5.6-terra";
const sha256 = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, "0")).join("");
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
/** Compiled context and the response schema exceed intake-definition depth and
 * string limits. Validate their own bounded JSON envelope before any getters. */
function snapshotRecord(value: unknown): Record<string, unknown> | null {
  const seen = new Set<object>(); let nodes = 0, characters = 0;
  const visit = (item: unknown, depth: number): boolean => {
    if (++nodes > 8192 || depth > 24) return false;
    if (item === null || typeof item === "boolean") return true;
    if (typeof item === "number") return Number.isFinite(item);
    if (typeof item === "string") { characters += item.length; return characters <= 524288; }
    if (!item || typeof item !== "object" || seen.has(item)) return false;
    const array = Array.isArray(item);
    if (array ? Object.getPrototypeOf(item) !== Array.prototype || item.length > 8192 : ![Object.prototype, null].includes(Object.getPrototypeOf(item))) return false;
    seen.add(item); const descriptors = Object.getOwnPropertyDescriptors(item);
    if (Reflect.ownKeys(descriptors).some(key => typeof key !== "string") || array && Object.keys(descriptors).length !== item.length + 1) return false;
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (array && key === "length") continue;
      if (!descriptor.enumerable || !("value" in descriptor) || ["__proto__", "prototype", "constructor"].includes(key)
        || array && !/^(0|[1-9]\d*)$/u.test(key) || !visit(descriptor.value, depth + 1)) return false;
    }
    seen.delete(item); return true;
  };
  return record(value) && visit(value, 0) ? structuredClone(value) : null;
}

/** Capture the existing adapter's server-compiled context PLUS the exact Scene
 * intent. This is not source authorization: the original job must separately
 * bind current document/source/plan/grant/slot identities and deadlines.
 * No provider call, preflight eligibility or layout qualification is enabled. */
export async function createOutputSceneRequestContract(rawIntake: unknown, providerInput: unknown, maximumInputTokens: number) {
  if (!Number.isSafeInteger(maximumInputTokens) || maximumInputTokens < 4096 || maximumInputTokens > 125000) return null;
  const input = snapshotRecord(providerInput);
  if (!input) return null;
  const adapter = await createExperienceSceneAdapterRequest(rawIntake);
  if (!adapter) return null;
  const required = ["document_title", "creative_context", "combined_context_plan", "audience", "tone", "scene_configuration", "scene_intent"];
  if (required.some(key => !Object.hasOwn(input, key)) || Object.keys(input).some(key => !required.includes(key) && key !== "output_requirements")
    || typeof input.document_title !== "string" || !input.document_title.trim() || !record(input.creative_context)
    || !Array.isArray(input.combined_context_plan) || typeof input.audience !== "string" || typeof input.tone !== "string"
    || !same(input.scene_intent, JSON.parse(adapter.input))
    || !same(input.scene_configuration, { medium: "visual", source: "manual", target_format: null, downstream_formats: [], alternate_medium: "audio",
      context_continuity: "same-authored-narrative-context", alternate_rendering: { medium: "audio", preserve_authored_context: true } })) return null;
  if (Object.hasOwn(input, "output_requirements") && (!record(input.output_requirements)
    || !same(Object.keys(input.output_requirements).sort(), ["instructions", "source_evidence"])
    || typeof input.output_requirements.instructions !== "string" || input.output_requirements.source_evidence !== false)) return null;
  const serialized = canonicalJson(input);
  return freeze({ schemaVersion: 1 as const, qualification: "request-only" as const, artifactKind: "scene" as const,
    adapterRequestDigest: adapter.requestDigest, sourceRequestDigest: adapter.source.requestDigest,
    compiledInputSha256: await sha256(serialized), input: serialized,
    instructions: adapter.instructions, responseSchema: adapter.responseSchema,
    model: OUTPUT_SCENE_MODEL, maximumInputTokens, maximumOutputTokens: 3000 as const, maximumCalls: 1 as const,
    stage: "planning:0:initial" as const, pricingVersion: OPENAI_TEXT_PRICING_VERSION, cachePolicy: "disabled-explicit" as const,
    reasoningEffort: "low" as const, layoutQualification: "unqualified" as const });
}
export type OutputSceneRequestContract = NonNullable<Awaited<ReturnType<typeof createOutputSceneRequestContract>>>;
export type OriginalSceneRequest = Readonly<{ contract: unknown; intake: unknown; body: string; clientRequestId: string; safetyIdentifier: string }>;

/** Reusable server selection read; no admission or provider work. */
export async function readOutputSceneRequestContract(rawIntake: unknown, rawContract: unknown) {
  const snapshot = snapshotRecord(rawContract);
  if (!snapshot || typeof snapshot.input !== "string" || typeof snapshot.maximumInputTokens !== "number") return null;
  let input: unknown;
  try { input = JSON.parse(snapshot.input); } catch { return null; }
  const contract = await createOutputSceneRequestContract(rawIntake, input, snapshot.maximumInputTokens);
  return contract && same(snapshot, contract) ? contract : null;
}

/** Reconstruct and compare the whole original wire body, not just its text or
 * hash. The eventual call-claim hook must compare this capture with its original
 * admitted settings; this pure helper cannot mint/renew a call or paid grant. */
export async function captureOutputSceneRequest(original: OriginalSceneRequest) {
  const snapshot = snapshotRecord(original.contract);
  if (typeof original.body !== "string" || original.body.length > 125000 || typeof original.clientRequestId !== "string"
    || !/^forma-scene-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(original.clientRequestId)
    || typeof original.safetyIdentifier !== "string" || !/^forma_[a-f0-9]{32}$/u.test(original.safetyIdentifier)
    || !snapshot || typeof snapshot.input !== "string" || typeof snapshot.maximumInputTokens !== "number") throw new Error("output_scene_request_invalid");
  const body = original.body, clientRequestId = original.clientRequestId, safetyIdentifier = original.safetyIdentifier;
  const contract = await createOutputSceneRequestContract(original.intake, JSON.parse(snapshot.input), snapshot.maximumInputTokens);
  if (!contract || !same(snapshot, contract)) throw new Error("output_scene_request_outside_contract");
  const expected = { model: contract.model, instructions: contract.instructions, input: contract.input,
    text: { verbosity: "medium", format: { type: "json_schema", name: "document_scene", strict: true, schema: contract.responseSchema } },
    reasoning: { effort: contract.reasoningEffort }, max_output_tokens: contract.maximumOutputTokens, store: false,
    safety_identifier: safetyIdentifier, service_tier: "default", prompt_cache_options: { mode: "explicit" } };
  const maximumInputTokens = new TextEncoder().encode(body).length + 4096;
  if (body !== JSON.stringify(expected) || maximumInputTokens > contract.maximumInputTokens) throw new Error("output_scene_request_outside_contract");
  return freeze({ body, contract, attempt: { model: contract.model, clientRequestId, logicalCallKey: contract.stage,
    maximumInputTokens, maximumOutputTokens: contract.maximumOutputTokens, requestDigest: await sha256(body),
    reasoningEffort: contract.reasoningEffort, pricingVersion: contract.pricingVersion, cachePolicy: contract.cachePolicy } });
}

/** Inspect only after the caller retained the response with its own original
 * call identity. Invalid content/refusal can still have measured cost. Missing
 * usage/model never becomes zero dollars. No second call or layout acceptance.
 * This inspection is not proof that supplied bytes came from a provider. */
export async function inspectOutputSceneResponse(original: OriginalSceneRequest, rawEnvelope: string) {
  const request = await captureOutputSceneRequest(original);
  if (typeof rawEnvelope !== "string" || rawEnvelope.length > 262144 || new TextEncoder().encode(rawEnvelope).length > 262144) throw new Error("output_scene_response_limit");
  let body: Record<string, unknown> = {};
  try { const parsed: unknown = JSON.parse(rawEnvelope); if (record(parsed)) body = parsed; } catch { /* Retain the exact malformed envelope hash below. */ }
  const responseId = typeof body.id === "string" && body.id.trim() && body.id.length <= 240 ? body.id : null;
  const effectiveModel = typeof body.model === "string" ? body.model : null;
  const output = Array.isArray(body.output) ? body.output : [];
  const pieces: string[] = []; let refusal = Boolean(body.refusal), malformed = body.output !== undefined && !Array.isArray(body.output);
  for (const item of output) {
    if (!record(item)) { malformed = true; continue; }
    if (item.type === "refusal" || item.refusal) refusal = true;
    if (item.type === "reasoning") {
      // Reasoning may accompany the answer but never supplies Scene text.
      if (typeof item.id !== "string" || !item.id.trim() || item.id.length > 240
        || Object.keys(item).some(key => !["id", "type", "summary", "content", "encrypted_content", "status"].includes(key))
        || item.status !== undefined && item.status !== "completed"
        || !Array.isArray(item.summary) || item.summary.some(entry => !record(entry) || entry.type !== "summary_text" || typeof entry.text !== "string")
        || item.content !== undefined && (!Array.isArray(item.content) || item.content.some(entry => !record(entry) || entry.type !== "reasoning_text" || typeof entry.text !== "string"))
        || item.encrypted_content !== undefined && item.encrypted_content !== null && typeof item.encrypted_content !== "string") malformed = true;
      continue;
    }
    if (item.type !== "message" || item.role !== "assistant" || item.status !== "completed"
      || typeof item.id !== "string" || !item.id.trim() || item.id.length > 240 || !Array.isArray(item.content)
      || item.phase !== undefined && item.phase !== null && item.phase !== "final_answer") { malformed = true; continue; }
    for (const entry of item.content) {
      if (!record(entry)) { malformed = true; continue; }
      if (entry.type === "refusal" || entry.refusal) refusal = true;
      if (entry.type === "output_text") { if (typeof entry.text === "string") pieces.push(entry.text); else malformed = true; }
      else if (entry.type !== "refusal" || typeof entry.refusal !== "string") malformed = true;
    }
  }
  if (body.output_text !== undefined && typeof body.output_text !== "string") malformed = true;
  const top = typeof body.output_text === "string" ? body.output_text : null;
  // A convenience output_text cannot rescue missing/malformed message items.
  const candidateRaw = !malformed && pieces.length === 1 && (top === null || top === pieces[0]) ? pieces[0] : null;
  let usage: ReturnType<typeof readOpenAITextUsage> | null = null, cost: ReturnType<typeof priceCurrentOpenAITextUsage> | null = null;
  if (effectiveModel === request.contract.model) {
    try {
      usage = readOpenAITextUsage(body.usage, { cachePolicy: request.contract.cachePolicy });
      cost = priceCurrentOpenAITextUsage(effectiveModel, usage, body.service_tier === undefined ? "default" : typeof body.service_tier === "string" ? body.service_tier : "unsupported");
    } catch { /* Unknown price remains unknown; the original hold stays unsettled. */ }
  }
  const problem = !responseId ? "scene_response_identity_missing" : effectiveModel !== request.contract.model ? "scene_effective_model_mismatch"
    : refusal || record(body.incomplete_details) && body.incomplete_details.reason === "content_filter" ? "scene_provider_refused"
    : body.status !== "completed" || body.incomplete_details != null || body.error != null ? "scene_provider_response_incomplete"
    : !candidateRaw ? "scene_response_content_ambiguous" : !usage || !cost ? "scene_usage_evidence_missing"
    : usage.inputTokens > request.contract.maximumInputTokens || usage.outputTokens > request.contract.maximumOutputTokens ? "scene_usage_outside_contract" : null;
  return freeze({ qualification: "evidence-only" as const, requestDigest: request.attempt.requestDigest, compiledInputSha256: request.contract.compiledInputSha256,
    clientRequestId: request.attempt.clientRequestId, responseId, effectiveModel, completionStatus: typeof body.status === "string" ? body.status : null,
    responseSha256: await sha256(rawEnvelope), candidateRaw, usage, cost, problem, layoutQualification: "unqualified" as const });
}

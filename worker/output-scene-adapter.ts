import { canonicalJson, freeze } from "../src/experiences/compiler.ts";
import { validateIntakeRequest, type IntakeRequest } from "../src/experiences/intake.ts";
import { projectExperienceSceneAdapterResponse } from "./experience-scene-adapter-contract.ts";
import { captureOutputSceneRequest, inspectOutputSceneResponse, readOutputSceneRequestContract, type OutputSceneRequestContract } from "./output-scene-request.ts";
import { ProviderRequestError, type ProviderAttemptAccounting } from "./provider-errors.ts";
import type { DocumentArtifactValidationIssue } from "../src/model/document-artifacts.ts";
import type { GenerationValidationStageReceipt } from "./generation-self-healing.ts";
import type { PaidProviderSubmission, PaidProviderSubmissionObserver } from "../src/model/provider-submission.ts";
import type { ProviderAttemptPreflight, ProviderAttemptReceipt } from "./openai-adapter.ts";

export type OutputSceneAttempt = Readonly<{ contract: OutputSceneRequestContract; intake: IntakeRequest; requestBody: string }>;
export type OutputSceneEnvelope = Readonly<{ rawEnvelope: string; candidateRaw: string | null; httpStatus: number; call: PaidProviderSubmission; request: OutputSceneAttempt }>;
/** FUNCTION-valued private retention is mandatory. No incoming JSON can select
 * this branch, and existing admission handlers do not pass the option. */
export type OutputSceneAdapterSelection = Readonly<{
  intake: unknown; contract: unknown;
  retainEnvelope(receipt: OutputSceneEnvelope): Promise<{ responseRef: string }>;
}>;
export async function prepareOutputSceneAdapter(value: unknown) {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = ["intake", "contract", "retainEnvelope"];
  if (Reflect.ownKeys(descriptors).length !== keys.length || !keys.every(key => descriptors[key]?.enumerable && "value" in descriptors[key])
    || typeof descriptors.retainEnvelope.value !== "function") return null;
  // Both helpers snapshot before yielding. Do not retain caller-mutable intake.
  const [valid, contract] = await Promise.all([validateIntakeRequest(descriptors.intake.value), readOutputSceneRequestContract(descriptors.intake.value, descriptors.contract.value)]);
  if (!valid || valid.request.experienceId !== "scene" || !contract) return null;
  return Object.freeze({ intake: valid.request, contract, retainEnvelope: descriptors.retainEnvelope.value as OutputSceneAdapterSelection["retainEnvelope"] });
}
type Selection = NonNullable<Awaited<ReturnType<typeof prepareOutputSceneAdapter>>>;
type Hooks = Readonly<{
  onBeforeProviderAttempt(attempt: ProviderAttemptPreflight): void | Promise<void>;
  onProviderSubmission: PaidProviderSubmissionObserver;
  onBeforeProviderDispatch(clientRequestId: string): void;
  onProviderNotDispatched?(attempt: ProviderAttemptPreflight): void | Promise<void>;
  onProviderAttempt?(receipt: ProviderAttemptReceipt): void | Promise<void>;
}>;
const sha256 = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, "0")).join("");
const failure = (code: string, accounting?: ProviderAttemptAccounting) => new ProviderRequestError({ code, category: "provider", scope: "request", action: "edit_request",
  message: "Scene unavailable", retryable: false, retryAfterMs: null, requestId: null, httpStatus: 422 }, null, accounting);

/** Fetch exposes decoded bytes. Cap them before text decoding/JSON parsing,
 * and cancel incomplete streams without letting cancellation delay withdrawal.
 * An over-limit body cannot prove a provider rejection or a zero-dollar charge.
 */
async function readSceneEnvelope(response: Response): Promise<string> {
  const maximum = 262144;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let complete = false;
  try {
    const declared = response.headers.get("content-length"), encoding = response.headers.get("content-encoding");
    const identityEncoding = encoding === null || encoding.trim().toLowerCase() === "identity";
    if (!response.body || declared !== null && (!/^(0|[1-9]\d*)$/u.test(declared)
      || !Number.isSafeInteger(Number(declared)) || identityEncoding && Number(declared) > maximum)) throw failure("output_scene_response_limit");
    reader = response.body.getReader();
    let length = 0; const chunks: Uint8Array[] = [];
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      if (!(next.value instanceof Uint8Array) || next.value.byteLength === 0 || length + next.value.byteLength > maximum) throw failure("output_scene_response_limit");
      length += next.value.byteLength; chunks.push(next.value);
    }
    complete = true;
    if (identityEncoding && declared !== null && Number(declared) !== length) throw failure("output_scene_response_length_mismatch");
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } finally {
    if (!complete) {
      try { const cancellation = reader ? reader.cancel() : response.body?.cancel(); if (cancellation) void cancellation.catch(() => undefined); }
      catch { /* Keep the original pending/unknown-charge disposition. */ }
    }
    reader?.releaseLock();
  }
}

/** Pure control-flow seam around the EXISTING adapter transport. Exactly one
 * invocation, no retry or repair. Original call claim and current-source/lease
 * guards remain caller responsibilities; this module creates no authority. */
export async function generateOutputSceneArtifact(selection: Selection, providerInput: string, safetyIdentifier: string, hooks: Hooks,
  dispatch: (body: string, clientRequestId: string) => Promise<Response>) {
  const started = Date.now(), { contract, intake } = selection;
  if (canonicalJson(JSON.parse(providerInput)) !== contract.input) throw failure("output_scene_current_input_changed");
  const clientRequestId = `forma-scene-${crypto.randomUUID()}`;
  const body = JSON.stringify({ model: contract.model, instructions: contract.instructions, input: contract.input,
    text: { verbosity: "medium", format: { type: "json_schema", name: "document_scene", strict: true, schema: contract.responseSchema } },
    reasoning: { effort: contract.reasoningEffort }, max_output_tokens: contract.maximumOutputTokens, store: false,
    safety_identifier: safetyIdentifier, service_tier: "default", prompt_cache_options: { mode: "explicit" } });
  const original = { contract, intake, body, clientRequestId, safetyIdentifier }, captured = await captureOutputSceneRequest(original);
  const request = freeze({ contract: captured.contract, intake, requestBody: body });
  const attempt = freeze({ ...captured.attempt, scene: request });
  let call: PaidProviderSubmission = { clientRequestId, provider: "openai", operation: "planning", model: contract.model, unitId: contract.stage,
    status: "pending", requestDigest: captured.attempt.requestDigest, maximumOutputTokens: contract.maximumOutputTokens,
    reasoningEffort: contract.reasoningEffort, pricingVersion: contract.pricingVersion, cachePolicy: contract.cachePolicy, serviceTier: "default", submittedAt: new Date().toISOString() };
  try {
    await hooks.onBeforeProviderAttempt(attempt);
    await hooks.onProviderSubmission(freeze({ ...call }));
    // No await on the success path between this guard and dispatch below.
    hooks.onBeforeProviderDispatch(clientRequestId);
  } catch (error) {
    // This lexical branch is unreachable after dispatch. A server-only hook
    // may persist exact non-submission evidence; failure keeps the hold intact.
    try { await hooks.onProviderNotDispatched?.(attempt); } catch { /* Preserve the original failure and unresolved allowance. */ }
    throw error;
  }
  let response: Response;
  try { response = await dispatch(body, clientRequestId); } catch { throw failure("output_scene_submission_uncertain"); }
  let rawEnvelope: string;
  try { rawEnvelope = await readSceneEnvelope(response); }
  catch {
    await hooks.onProviderSubmission(freeze({ ...call, status: "pending", responseReceivedAt: new Date().toISOString(),
      httpRequestId: response.headers.get("x-request-id") ?? undefined, latencyMs: Date.now() - started, validationStatus: "pending" }));
    throw failure("output_scene_response_unreadable");
  }
  // Extraction is for PRIVATE retention only, never acceptance. The entire raw
  // envelope preserves ambiguous/invalid candidates for later inspection.
  let retainedCandidate: string | null = null;
  try {
    const raw = JSON.parse(rawEnvelope);
    const values = Array.isArray(raw?.output) ? raw.output.flatMap((item: { content?: unknown }) => Array.isArray(item?.content) ? item.content : []) : [];
    retainedCandidate = typeof raw?.output_text === "string" ? raw.output_text : values.find((item: { type?: string; text?: unknown }) => item?.type === "output_text" && typeof item.text === "string")?.text ?? null;
  } catch { /* Exact malformed raw envelope is still retained. */ }
  let retentionFailure: unknown, responseRef: string | undefined;
  try {
    const retained = await selection.retainEnvelope(freeze({ rawEnvelope, candidateRaw: retainedCandidate, httpStatus: response.status, call: { ...call }, request }));
    if (!retained || typeof retained.responseRef !== "string" || !retained.responseRef.trim()) throw failure("output_scene_response_retention_required");
    responseRef = retained.responseRef;
  } catch (error) { retentionFailure = error; }
  // Retention failure must not erase source-free financial evidence. Inspect
  // and persist received usage/cost before any rejection or artifact projection.
  const evidence = await inspectOutputSceneResponse(original, rawEnvelope);
  call = { ...call, status: response.ok ? "completed" : "pending", ...(responseRef ? { responseRef } : {}),
    ...(evidence.responseId ? { providerRequestId: evidence.responseId } : {}), ...(evidence.effectiveModel ? { effectiveModel: evidence.effectiveModel } : {}),
    responseReceivedAt: new Date().toISOString(), httpRequestId: response.headers.get("x-request-id") ?? undefined,
    completionStatus: evidence.completionStatus ?? "unspecified", latencyMs: Date.now() - started, validationStatus: "pending",
    ...(evidence.usage ? { inputTokens: evidence.usage.inputTokens, outputTokens: evidence.usage.outputTokens, totalTokens: evidence.usage.totalTokens,
      cachedInputTokens: evidence.usage.cachedInputTokens, cacheWriteInputTokens: evidence.usage.cacheWriteTokens,
      ...(evidence.usage.reasoningTokens === null ? {} : { reasoningTokens: evidence.usage.reasoningTokens }) } : {}),
    ...(evidence.cost ? { costMicrousd: evidence.cost.totalMicrousd, textInputCostMicrousd: evidence.cost.textInputMicrousd,
      textOutputCostMicrousd: evidence.cost.textOutputMicrousd, usageCostBasis: evidence.cost.costBasis, pricingReceipt: evidence.cost } : {}) };
  await hooks.onProviderSubmission(freeze({ ...call }));
  const accounting: ProviderAttemptAccounting | undefined = evidence.usage ? { providerUsage: { inputTokens: evidence.usage.inputTokens, outputTokens: evidence.usage.outputTokens, totalTokens: evidence.usage.totalTokens },
    providerResponseIds: evidence.responseId ? [evidence.responseId] : [], providerModel: evidence.effectiveModel ?? contract.model, providerCallCount: 1 } : undefined;
  if (retentionFailure || !responseRef) throw failure("output_scene_response_retention_failed", accounting);
  if (!response.ok || evidence.problem || !evidence.candidateRaw) {
    await hooks.onProviderSubmission(freeze({ ...call, validationStatus: "invalid", validationIssueCount: 1 }));
    throw failure(evidence.problem ?? "output_scene_provider_response_failed", accounting);
  }
  const projection = await projectExperienceSceneAdapterResponse(intake, contract.adapterRequestDigest, evidence.candidateRaw);
  if (!projection) {
    await hooks.onProviderSubmission(freeze({ ...call, validationStatus: "invalid", validationIssueCount: 1 }));
    throw failure("output_scene_structure_invalid", accounting);
  }
  call = { ...call, validationStatus: "valid", validationIssueCount: 0 };
  await hooks.onProviderSubmission(freeze({ ...call }));
  const usage = accounting!.providerUsage;
  const receipt = { model: evidence.effectiveModel!, responseId: evidence.responseId!, responseIds: [evidence.responseId!], usage, latencyMs: Date.now() - started };
  await hooks.onProviderAttempt?.(receipt);
  return { responseId: receipt.responseId, model: receipt.model, output: { ...projection.artifact, scene_screenplay: projection.screenplay }, raw: evidence.candidateRaw,
    inputReceipt: { output_scene: contract, scene_adapter_specification_digest: contract.adapterRequestDigest, scene_source_request_digest: contract.sourceRequestDigest,
      scene_compiled_input_sha256: contract.compiledInputSha256, scene_request_sha256: captured.attempt.requestDigest, scene_envelope_sha256: evidence.responseSha256,
      scene_candidate_sha256: projection.responseSha256, scene_screenplay_sha256: await sha256(canonicalJson(projection.screenplay)), scene_body_sha256: projection.bodySha256,
      scene_layout: projection.layout, scene_configuration: JSON.parse(contract.input).scene_configuration, provider_calls: [call],
      instructions: contract.instructions, providerInput: JSON.parse(contract.input) as Record<string, unknown>,
      validation: { status: "structure_valid_layout_pending", maximum_provider_calls: 1, provider_call_count: 1, provider_response_ids: [receipt.responseId], repair_attempted: false, requirement_fulfilled: false,
        initial_issues: [] as DocumentArtifactValidationIssue[], repair_issues: [] as DocumentArtifactValidationIssue[],
        validation_history: [{ stage: "initial", issue_count: 0, issues: [], provider_attempt: 1 }] as GenerationValidationStageReceipt[] } },
    latencyMs: receipt.latencyMs, usage };
}

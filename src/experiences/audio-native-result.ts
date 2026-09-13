import { canonicalJson, freeze } from "./compiler.ts";
import { createAudioOutputContract, parseAudioOutputContract, type AudioOutputSource } from "../model/output-audio-contract.ts";
import { parseAudioMiniAppCostPreview } from "../model/audio-mini-app-consent.ts";
import { EXPERIENCE_AUDIO_INTENT } from "./contracts.ts";
const row = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const sha = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, "0")).join("");
const own = (value: unknown, key: string): unknown => {
  if (!row(value)) return undefined;
  const field = Object.getOwnPropertyDescriptor(value, key);
  return field?.enumerable && Object.hasOwn(field, "value") ? field.value : undefined;
};
/** Bounded immutable descriptor snapshot. No getter, iterator or toJSON invocation. */
function snapshot(value: unknown): unknown {
  let nodes = 0, characters = 0;
  const seen = new Set<object>();
  const visit = (entry: unknown, depth: number): unknown => {
    if (++nodes > 12000 || depth > 24) throw Error("audio_metadata_limit");
    if (entry === null || typeof entry === "boolean" || typeof entry === "number" && Number.isFinite(entry)) return entry;
    if (typeof entry === "string" && (characters += entry.length) <= 1048576) return entry;
    if (!entry || typeof entry !== "object" || seen.has(entry)) throw Error("audio_metadata_invalid");
    const array = Array.isArray(entry), prototype = Object.getPrototypeOf(entry);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw Error("audio_metadata_invalid");
    const descriptors = Object.getOwnPropertyDescriptors(entry), keys = Reflect.ownKeys(descriptors);
    seen.add(entry);
    try {
      if (array) {
        const length = Object.getOwnPropertyDescriptor(entry, "length")?.value;
        if (!Number.isSafeInteger(length) || length < 0 || length > 12000 || keys.length !== length + 1) throw Error("audio_metadata_invalid");
        const result: unknown[] = [];
        for (let index = 0; index < length; index++) {
          const descriptor = descriptors[String(index)];
          if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw Error("audio_metadata_invalid");
          result.push(visit(descriptor.value, depth + 1));
        }
        return Object.freeze(result);
      }
      const result: Record<string, unknown> = Object.create(null);
      for (const key of keys) {
        if (typeof key !== "string" || key.length > 256 || ["__proto__", "constructor", "prototype"].includes(key)) throw Error("audio_metadata_invalid");
        const descriptor = descriptors[key]!;
        if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) throw Error("audio_metadata_invalid");
        result[key] = visit(descriptor.value, depth + 1);
      }
      return Object.freeze(result);
    } finally { seen.delete(entry); }
  };
  return visit(value, 0);
}
const executionKeys = ["scopeKey", "grantId", "slotId", "planRevisionId", "targetId", "targetContractDigest", "sourceDigest"] as const;
const receiptKeys = ["schemaVersion", "contract", "plannerCallIds", "mediaCallId", "providerRequestId", "requestDigest", "requestedSeconds", "measuredSeconds", "requirementFulfilled"] as const;
export type ExperienceAudioEvidence = Readonly<{
  contract: NonNullable<ReturnType<typeof parseAudioOutputContract>>;
  execution: Readonly<Record<typeof executionKeys[number], string>>;
  receipt: Readonly<{ schemaVersion: 1; contract: NonNullable<ReturnType<typeof parseAudioOutputContract>>; plannerCallIds: readonly string[];
    mediaCallId: string; providerRequestId: string; requestDigest: string; requestedSeconds: 20; measuredSeconds: null; requirementFulfilled: false }>;
  mediaSha256: string;
}>;
/** Completion metadata witness, not access authority or proof of audible quality/duration. */
export function captureExperienceAudioEvidence(value: unknown): ExperienceAudioEvidence | null {
  try {
    const selected = snapshot({ contract: own(value, "output_audio"), execution: own(value, "output_audio_execution"),
      receipt: own(value, "output_audio_receipt"), mediaSha256: own(value, "source_media_sha256") }) as Record<string, unknown>;
    const contract = parseAudioOutputContract(selected.contract), execution = selected.execution, receipt = selected.receipt;
    if (!contract || !row(execution) || Object.keys(execution).length !== executionKeys.length
      || !executionKeys.every(key => typeof execution[key] === "string" && String(execution[key]).length > 0 && String(execution[key]).length <= 1024)
      || !hash(execution.targetContractDigest) || !hash(execution.sourceDigest)
      || !row(receipt) || Object.keys(receipt).length !== receiptKeys.length || !receiptKeys.every(key => Object.hasOwn(receipt, key))
      || receipt.schemaVersion !== 1 || canonicalJson(receipt.contract) !== canonicalJson(contract)
      || receipt.requestedSeconds !== 20 || receipt.measuredSeconds !== null || receipt.requirementFulfilled !== false
      || !Array.isArray(receipt.plannerCallIds) || receipt.plannerCallIds.length < 1 || receipt.plannerCallIds.length > 2
      || !receipt.plannerCallIds.every(id) || new Set(receipt.plannerCallIds).size !== receipt.plannerCallIds.length
      || !id(receipt.mediaCallId) || receipt.plannerCallIds.includes(receipt.mediaCallId) || !id(receipt.providerRequestId)
      || !hash(receipt.requestDigest) || !hash(selected.mediaSha256)) return null;
    return freeze(selected) as ExperienceAudioEvidence;
  } catch { return null; }
}
export type ExperienceAudioExpected = Readonly<{
  documentId: string; projectId: string; artifactId: string; jobId: string; plannerResponseId: string; source: AudioOutputSource; costPreview: unknown;
  usedMicrousd: number; usedCalls: number;
  grantId: string; slotId: string; planRevisionId: string; targetId: string; targetContractDigest: string; sourceDigest: string;
}>;
/** Cross-check exact private input against the original completion witness.
 * Caller owns current original job/event, private reference access and before/
 * after-await withdrawal checks. No paid action or provider request is made. */
export async function verifyExperienceAudioInput(rawInput: unknown, evidenceValue: unknown, expectedValue: ExperienceAudioExpected): Promise<boolean> {
  try {
    if (typeof rawInput !== "string" || new TextEncoder().encode(rawInput).length > 1048576) return false;
    const expected = snapshot(expectedValue) as ExperienceAudioExpected, evidence = snapshot(evidenceValue) as ExperienceAudioEvidence;
    const contract = createAudioOutputContract(expected.source), preview = parseAudioMiniAppCostPreview(expected.costPreview);
    if (!contract || !preview || preview.requestId !== expected.jobId || preview.documentId !== expected.documentId
      || preview.projectId !== expected.projectId || preview.draftId !== contract.source.draftId
      || preview.sourceDigest !== expected.sourceDigest || canonicalJson(evidence.contract) !== canonicalJson(contract)
      || executionKeys.filter(key => key !== "scopeKey").some(key => evidence.execution[key] !== expected[key])) return false;
    const input = snapshot(JSON.parse(rawInput));
    if (!row(input) || input.schema_version !== 1 || input.artifact_kind !== "audio" || input.artifact_id !== expected.artifactId
      || input.document_id !== expected.documentId || input.project_id !== expected.projectId
      || canonicalJson(input.output_audio) !== canonicalJson(contract) || canonicalJson(input.output_audio_execution) !== canonicalJson(evidence.execution)
      || !row(input.request) || input.request.item_count !== 1 || input.request.source_surface !== "outputs" || input.request.production_mode !== "manual"
      || canonicalJson(input.request.audio_profile) !== canonicalJson(EXPERIENCE_AUDIO_INTENT)
      || input.request.audio_image_block_id !== null || input.request.audio_video_artifact_id !== null
      || input.request.audio_video_provider_transfer !== false || input.request.soundtrack_provider_transfer !== false
      || !Array.isArray(input.request.soundtrack_block_ids) || input.request.soundtrack_block_ids.length !== 0
      || !Array.isArray(input.output_audio_calls) || !row(input.output_audio_request) || !row(input.planner) || !row(input.render)) return false;
    const calls = input.output_audio_calls, receipt = evidence.receipt;
    if (calls.length !== receipt.plannerCallIds.length + 1 || calls.some(call => !row(call) || !id(call.clientRequestId))
      || new Set(calls.map(call => (call as Record<string, unknown>).clientRequestId)).size !== calls.length) return false;
    if (!count(expected.usedMicrousd) || expected.usedCalls !== calls.length) return false;
    let totalCost = 0, totalTokens = 0;
    const plannerIds = new Set(receipt.plannerCallIds), stages = new Set<string>();
    for (const call of calls as Record<string, unknown>[]) {
      if (call.status !== "completed" || !id(call.providerRequestId) || !count(call.costMicrousd) || !count(call.totalTokens)) return false;
      totalCost += call.costMicrousd; totalTokens += call.totalTokens;
      if (!Number.isSafeInteger(totalCost) || !Number.isSafeInteger(totalTokens) || totalCost > preview.maximumMicrousd || totalTokens > preview.maximumTokens) return false;
      if (plannerIds.has(String(call.clientRequestId))) {
        if (call.operation !== "planning" || call.provider !== "openai" || call.model !== preview.planningModel || call.effectiveModel !== call.model
          || !id(call.responseRef) || !["planning:0:initial", "planning:0:repair"].includes(String(call.unitId)) || stages.has(String(call.unitId))) return false;
        stages.add(String(call.unitId));
      } else if (call.clientRequestId !== receipt.mediaCallId || call.operation !== "audio" || call.provider !== "fal"
        || call.model !== preview.audioModel || call.unitId !== "audio:initial" || call.providerRequestId !== receipt.providerRequestId
        || call.requestDigest !== receipt.requestDigest || call.costMicrousd <= 0 || call.totalTokens !== 0) return false;
    }
    if (totalCost !== expected.usedMicrousd) return false;
    const finalStage = plannerIds.size === 2 ? "planning:0:repair" : "planning:0:initial";
    const final = (calls as Record<string, unknown>[]).find(call => call.operation === "planning" && call.unitId === finalStage);
    if (!stages.has("planning:0:initial") || !final || final.validationStatus !== "valid" || final.completionStatus !== "completed"
      || expected.plannerResponseId !== final.providerRequestId || input.planner.provider !== "openai" || input.planner.model !== preview.planningModel || input.planner.response_id !== final.providerRequestId) return false;
    const request = input.output_audio_request;
    if (Object.keys(request).length !== 4 || canonicalJson(request.contract) !== canonicalJson(contract)
      || request.clientRequestId !== receipt.mediaCallId || request.requestDigest !== receipt.requestDigest
      || typeof request.requestBody !== "string" || new TextEncoder().encode(request.requestBody).length > 262144) return false;
    const wire = JSON.parse(request.requestBody);
    if (!row(wire) || Object.keys(wire).length !== 5 || typeof wire.prompt !== "string" || !wire.prompt.trim()
      || wire.prompt !== wire.prompt.trim() || wire.prompt.length > 5000 || wire.duration !== 20 || wire.output_format !== "mp3"
      || wire.enable_safety_checker !== true || wire.negative_prompt !== "singing, vocals, spoken dialogue"
      || input.render.provider !== "fal" || input.render.model !== preview.audioModel || input.render.provider_job_id !== receipt.providerRequestId
      || input.render.submitted_prompt !== wire.prompt || !row(input.render.parameters)
      || canonicalJson(input.render.parameters.provider_parameters) !== canonicalJson({ duration: 20, output_format: "mp3", enable_safety_checker: true, negative_prompt: "singing, vocals, spoken dialogue" })
      || input.render.parameters.goal !== "timed_music" || input.render.parameters.destination !== "standalone"
      || input.render.parameters.duration_seconds !== 20 || input.render.parameters.image_reference_count !== 0
      || input.render.parameters.audio_waveform_submitted !== false
      || input.render.image_reference !== null || Object.hasOwn(input.render, "video_reference") || input.render.audio_waveform_submitted !== false
      || !Array.isArray(input.render.source_audio_block_ids) || input.render.source_audio_block_ids.length > 100
      || !input.render.source_audio_block_ids.every(id)
      || input.render.parameters.semantic_audio_reference_count !== input.render.source_audio_block_ids.length
      || input.render.source_audio_treatment !== (input.render.source_audio_block_ids.length ? "authored-description-only" : "none")) return false;
    return await sha(request.requestBody) === receipt.requestDigest;
  } catch { return false; }
}

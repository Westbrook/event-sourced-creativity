import { sourceAdvisoryInputs, type SourceAdvisoryVerdict } from '../src/model/source-advisory.ts';
import { validModerationResults } from "./moderation-response-validation.ts";
import type { GenerationEvidenceObserver } from "../src/model/generation-outcome-evidence.ts";
import { checkpointGenerationEvidence, evidenceSha256, operationEvidence, generationDispatchFailure } from "./generation-evidence.ts";
import { readBoundedAssistantProviderResponse } from './assistant-provider.ts';
import { memoryDerivationJsonUniqueKeys } from './memory-derivation-result.ts';
import { OPENAI_IMAGE_MODERATION_CONTRACT } from "./openai-image-route-contract.ts";
import type { WorkerEnv } from "./runtime.ts";
import type { ImageReference } from "./openai-adapter.ts";
import type { PromptTechnique } from "../src/model/prompt-structures.ts";
import { ProviderRequestError, providerErrorFromResponse } from "./provider-errors.ts";

type ModerationResult = { flagged?: boolean; categories?: Record<string, boolean>; category_scores?: Record<string, number> };
type ModerationResponse = { id?: string; model?: string; results?: ModerationResult[]; error?: { message?: string; code?: string; type?: string } };
export type GenerationModerationReceipt = {
  sourceVerdicts?: SourceAdvisoryVerdict[];
  available: boolean;
  flagged: boolean;
  categories: string[];
  scores: Record<string, number>;
  blockIds: string[];
  referenceIds: string[];
  model: string;
  requestId: string | null;
  requestIds: string[];
  probeCount: number;
  latencyMs: number;
  coverage: "text" | "text-and-images" | "text-and-some-images";
  // Retained only to read historical receipts; new preflights preserve exact text.
  promptNormalization?: "fictional-software-mystery";
};

const headers = (env: WorkerEnv) => ({
  authorization: `Bearer ${env.OPENAI_API_KEY}`,
  "content-type": "application/json",
  ...(env.OPENAI_PROJECT ? { "OpenAI-Project": env.OPENAI_PROJECT } : {}),
});

async function requestModeration(env: WorkerEnv, input: unknown, signal?: AbortSignal,strict=false, onEvidence?: GenerationEvidenceObserver, expectedResults=1) {
  const started = Date.now();
  const requestBody=JSON.stringify({ model: OPENAI_IMAGE_MODERATION_CONTRACT.model, input });
  const evidenceId=`moderation-${crypto.randomUUID()}`;
  const operation=operationEvidence("openai",OPENAI_IMAGE_MODERATION_CONTRACT.api,OPENAI_IMAGE_MODERATION_CONTRACT.model,{}, {requestSha256:await evidenceSha256(requestBody)});
  await checkpointGenerationEvidence(onEvidence,evidenceId,"request",operation,"app_moderation",{dispatchState:"not_dispatched"},{requestBody});
  let response:Response;try{response = await fetch(OPENAI_IMAGE_MODERATION_CONTRACT.api, { method: "POST", headers: headers(env), signal, body: requestBody });}catch(error){throw await generationDispatchFailure(onEvidence,evidenceId,operation,"app_moderation",error);}
  let body: ModerationResponse = {};
  let responseBody="";let uniqueKeys=false;let responseReadComplete=false;
  if(strict&&!signal)throw Error('private_image_moderation_invalid');
  try {
    responseBody=await readBoundedAssistantProviderResponse(response,signal??new AbortController().signal,65536);responseReadComplete=true;
    uniqueKeys=memoryDerivationJsonUniqueKeys(responseBody);
    const parsed:unknown=JSON.parse(responseBody);
    if(parsed&&typeof parsed==="object"&&!Array.isArray(parsed))body=parsed as ModerationResponse;
  } catch(error) {
    // Private Memory keeps its original abort/size failures; ordinary checks become explicit invalid evidence.
    if(strict)throw error;
    if(signal?.aborted)throw error;
  }
  const shapeValid = uniqueKeys && validModerationResults(body,expectedResults);
  await checkpointGenerationEvidence(onEvidence,evidenceId,"response",{...operation,returnedModel:body?.model??null,requestId:response.headers.get("x-request-id")??response.headers.get("openai-request-id"),responseId:body?.id??null,responseSha256:responseReadComplete?await evidenceSha256(responseBody):null},"app_moderation",{dispatchState:"response_received",contentOutcome:shapeValid?"usable":"invalid"},{...(responseReadComplete?{responseBody}:{}),safety:{schemaVersion:"forma-safety-evidence-v1",source:"standalone_omni",stage:"unknown",verdict:shapeValid?(body.results!.some(result=>result.flagged)?"flagged":"clear"):"unknown",validity:shapeValid?"valid":"invalid",expectedResultCount:expectedResults,returnedResultCount:Array.isArray(body?.results)?body.results.length:null,requestedModel:operation.effectiveModel,returnedModel:body?.model??null,requestId:response.headers.get("x-request-id"),responseId:body?.id??null,...(shapeValid&&expectedResults===1?{categories:body.results![0]!.categories,...(body.results![0]!.category_scores?{scores:body.results![0]!.category_scores}:{})}:{})}});
  if (!response.ok) throw providerErrorFromResponse(response, body, `openai_moderation_${response.status}`,null,"app_moderation");
  if(!shapeValid){
    if(strict)throw Error('private_image_moderation_invalid');
    throw new ProviderRequestError({code:"moderation_response_invalid",category:"provider",scope:"provider",action:"contact_support",message:"The moderation response was incomplete or invalid. No safety pass was established and no image request was sent.",retryable:false,retryAfterMs:null,requestId:response.headers.get("x-request-id")??response.headers.get("openai-request-id"),httpStatus:response.status,pipelineStage:"app_moderation",providerModerationStage:"unknown"});
  }
  return { body, requestId: response.headers.get("x-request-id") ?? response.headers.get("openai-request-id"), latencyMs: Date.now() - started };
}

const summarize = (results: ModerationResult[]) => {
  const categories = new Set<string>(); const scores: Record<string, number> = {};
  for (const result of results) {
    for (const [category, value] of Object.entries(result.categories ?? {})) if (value) categories.add(category);
    for (const [category, value] of Object.entries(result.category_scores ?? {})) scores[category] = Math.max(scores[category] ?? 0, Number(value) || 0);
  }
  return { flagged: results.some((result) => Boolean(result.flagged)), categories: [...categories].sort(), scores };
};

export async function moderateGenerationSnapshot(env: WorkerEnv, snapshot: Record<string, unknown>, signal?: AbortSignal, advisory?: {onEvidence:GenerationEvidenceObserver;onCaptureError:()=>void}): Promise<GenerationModerationReceipt> {
  if (!env.OPENAI_API_KEY) throw new Error("provider_not_configured");
  const {input:inputs,mapping}=sourceAdvisoryInputs(snapshot);
  // Advisory observation cannot suppress dispatch or erase a valid verdict.
  // Exact-prompt moderation retains its existing strict checkpoint behavior.
  const observe:GenerationEvidenceObserver|undefined=advisory?async evidence=>{
    try{await advisory.onEvidence(evidence);}catch{try{advisory.onCaptureError();}catch{/* Capture reporting is observational too. */}}
  }:undefined;
  const { body, requestId, latencyMs } = await requestModeration(env, inputs, signal,false,observe,inputs.length); const results = body.results ?? []; const summary = summarize(results);
  const sourceVerdicts=mapping.map((item,index)=>({...item,flagged:Boolean(results[index]!.flagged),categories:Object.entries(results[index]!.categories??{}).filter(([,flag])=>flag).map(([name])=>name).sort(),scores:results[index]!.category_scores??null}));
  const blockIds=sourceVerdicts.filter(item=>item.kind==='fact'&&item.flagged&&item.blockId).map(item=>item.blockId!);
  return { available: true, ...summary, sourceVerdicts, blockIds, referenceIds: [], model: body.model ?? OPENAI_IMAGE_MODERATION_CONTRACT.model, requestId, requestIds: requestId ? [requestId] : [], probeCount: 1, latencyMs, coverage: "text" };
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ""; const size = 0x4000;
  for (let offset = 0; offset < bytes.length; offset += size) binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + size, bytes.length)));
  return btoa(binary);
}

export async function moderateExactImagePrompt(env: WorkerEnv, prompt: string, references: ImageReference[], signal?: AbortSignal,strict=false,onEvidence?:GenerationEvidenceObserver): Promise<GenerationModerationReceipt> {
  if (!env.OPENAI_API_KEY) throw new Error("provider_not_configured");
  // The moderation endpoint accepts one image per multimodal input. Image edits,
  // including GPT Image 2 reference workflows, can legitimately receive more
  // than one image. Probe the exact text once, then every image independently;
  // never truncate safety coverage or submit an invalid multi-image probe.
  const probes: Array<{ reference: ImageReference | null; input: unknown }> = [
    { reference: null, input: [{ type: OPENAI_IMAGE_MODERATION_CONTRACT.input, text: prompt }] },
    ...references.map((reference) => ({
      reference,
      input: [{ type: "image_url", image_url: { url: `data:${reference.mimeType};base64,${bytesToBase64(reference.bytes)}` } }],
    })),
  ];
  const categories = new Set<string>(); const scores: Record<string, number> = {}; const referenceIds = new Set<string>(); const requestIds: string[] = [];
  let flagged = false; let latencyMs = 0; let model: string = OPENAI_IMAGE_MODERATION_CONTRACT.model; let flaggedRequestId: string | null = null;
  for (const probe of probes) {
    const result = await requestModeration(env, probe.input, signal,strict,onEvidence); const summary = summarize(result.body.results ?? []);
    latencyMs += result.latencyMs; model = result.body.model ?? model;
    if (result.requestId) requestIds.push(result.requestId);
    for (const category of summary.categories) categories.add(category);
    for (const [category, score] of Object.entries(summary.scores)) scores[category] = Math.max(scores[category] ?? 0, score);
    if (!summary.flagged) continue;
    flagged = true; flaggedRequestId ??= result.requestId;
    if (probe.reference) referenceIds.add(probe.reference.referenceId ?? probe.reference.blockId ?? probe.reference.label ?? probe.reference.source);
  }
  return {
    available: true, flagged, categories: [...categories].sort(), scores, blockIds: [], referenceIds: [...referenceIds], model,
    requestId: flaggedRequestId ?? requestIds[0] ?? null, requestIds, probeCount: probes.length, latencyMs,
    coverage: references.length ? "text-and-images" : "text",
  };
}

export type PromptTechniqueModerationResult = {
  technique: PromptTechnique;
  flagged: boolean;
  categories: string[];
  scores: Record<string, number>;
  requestId: string | null;
  latencyMs: number;
};

/**
 * Compare all four exact prompt representations without making an image request.
 * Text is sent as one moderation batch; each selected image is checked once and
 * shared across the four results so reference pixels are never multiplied by the
 * number of prompt techniques.
 */
export async function moderatePromptTechniqueSet(
  env: WorkerEnv,
  prompts: Array<{ technique: PromptTechnique; prompt: string }>,
  references: ImageReference[],
  signal?: AbortSignal,
) {
  if (!env.OPENAI_API_KEY) throw new Error("provider_not_configured");
  const textResponse = await requestModeration(env, prompts.map((entry) => entry.prompt), signal,false,undefined,prompts.length);
  const perPromptLatency = Math.round(textResponse.latencyMs / Math.max(1, prompts.length));
  const promptResults: PromptTechniqueModerationResult[] = prompts.map((entry, index) => {
    const result = textResponse.body.results?.[index];
    const summary = summarize(result ? [result] : []);
    return { technique: entry.technique, ...summary, requestId: textResponse.requestId, latencyMs: perPromptLatency };
  });

  const categories = new Set<string>();
  const scores: Record<string, number> = {};
  const referenceIds = new Set<string>();
  const requestIds: string[] = [];
  let flagged = false;
  let latencyMs = 0;
  let flaggedRequestId: string | null = null;
  let model = textResponse.body.model ?? OPENAI_IMAGE_MODERATION_CONTRACT.model;
  for (const reference of references) {
    const result = await requestModeration(env, [{ type: "image_url", image_url: { url: `data:${reference.mimeType};base64,${bytesToBase64(reference.bytes)}` } }], signal);
    const summary = summarize(result.body.results ?? []);
    latencyMs += result.latencyMs;
    model = result.body.model ?? model;
    if (result.requestId) requestIds.push(result.requestId);
    for (const category of summary.categories) categories.add(category);
    for (const [category, score] of Object.entries(summary.scores)) scores[category] = Math.max(scores[category] ?? 0, score);
    if (!summary.flagged) continue;
    flagged = true;
    flaggedRequestId ??= result.requestId;
    referenceIds.add(reference.referenceId ?? reference.blockId ?? reference.label ?? reference.source);
  }
  return {
    promptResults,
    references: {
      flagged,
      categories: [...categories].sort(),
      scores,
      referenceIds: [...referenceIds],
      requestId: flaggedRequestId ?? requestIds[0] ?? null,
      requestIds,
      probeCount: references.length,
      latencyMs,
      model,
      coverage: references.length ? "images" as const : "none" as const,
    },
    textRequestId: textResponse.requestId,
    textModel: textResponse.body.model ?? OPENAI_IMAGE_MODERATION_CONTRACT.model,
  };
}

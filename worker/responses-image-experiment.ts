import { unknownGenerationOutcome, type GenerationOutcomeEvidence, type OperationEvidence } from '../src/model/generation-outcome-evidence.ts';
import { validateImageExperimentCell, IMAGE_CAPABILITY_VERSION } from './image-operation-capabilities.ts';
import { classifyProviderFailure } from './provider-errors.ts';

/** Offline request/result contract only. No credentials, fetch, persistence or production registration. */
export const RESPONSES_IMAGE_VERSION = 'responses-image-offline-2026-09-22-v1';
export const RESPONSES_IMAGE_GATE = Object.freeze({
  enabled: false, liveDispatchAuthorized: false, runtime: 'responses_runtime_unqualified',
  financial: 'unavailable', maximumCostMicrousd: null, automaticReplacementPurchases: 0,
} as const);
export type ResponsesImageCell = {
  mainlineModel: 'gpt-5.5'; imageModel: 'gpt-image-2.5-sunburst'; action: 'generate';
  context: { kind: 'single-user-brief'; text: string }; assets: [];
  settings: { quality: 'high'; size: '1536x1024'; outputFormat: 'png'; background: 'opaque'; moderation: 'auto'; stream: false };
};
const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown) => typeof v === 'string' ? v : null;
const nonempty = (v: unknown) => typeof v === 'string' && v.length > 0 ? v : null;
const ownKeys = (v: Record<string, unknown>, expected: string[]) => Object.keys(v).length === expected.length && expected.every(k => Object.hasOwn(v, k));
const sha256 = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), b => b.toString(16).padStart(2, '0')).join('');

/** Reject extra context/history/assets/settings instead of silently dropping a treatment. */
export function validateResponsesImageCell(value: unknown) {
  const v = record(value), context = record(v.context), s = record(v.settings);
  const issues: string[] = [];
  if (!ownKeys(v, ['mainlineModel', 'imageModel', 'action', 'context', 'assets', 'settings'])) issues.push('cell_shape_unsupported');
  if (v.mainlineModel !== 'gpt-5.5') issues.push('mainline_model_unsupported');
  if (v.imageModel !== 'gpt-image-2.5-sunburst') issues.push('image_model_unsupported');
  if (v.action !== 'generate') issues.push('action_unsupported');
  if (!ownKeys(context, ['kind', 'text']) || context.kind !== 'single-user-brief' || !nonempty(context.text)?.trim()) issues.push('context_unsupported');
  if (!Array.isArray(v.assets) || v.assets.length !== 0) issues.push('assets_unsupported');
  if (!ownKeys(s, ['quality', 'size', 'outputFormat', 'background', 'moderation', 'stream']) || s.quality !== 'high' || s.size !== '1536x1024' || s.outputFormat !== 'png' || s.background !== 'opaque' || s.moderation !== 'auto' || s.stream !== false) issues.push('settings_unsupported');
  return { schemaValid: issues.length === 0, issues, ...RESPONSES_IMAGE_GATE };
}

export async function prepareResponsesImageExperiment(value: unknown) {
  // Snapshot synchronously so callers cannot change the brief during hashing.
  const cell = structuredClone(value) as ResponsesImageCell;
  const validation = validateResponsesImageCell(cell);
  if (!validation.schemaValid) throw new Error(`responses_image_cell_invalid:${validation.issues.join(',')}`);
  const shared = validateImageExperimentCell({ model: cell.imageModel, mainlineModel: cell.mainlineModel, action: cell.action,
    endpoint: '/v1/responses', referenceCount: 0, settings: cell.settings });
  const body = { model: cell.mainlineModel, input: [{ role: 'user', content: [{ type: 'input_text', text: cell.context.text }] }],
    tools: [{ type: 'image_generation', model: cell.imageModel, action: cell.action, quality: cell.settings.quality,
      size: cell.settings.size, output_format: cell.settings.outputFormat, background: cell.settings.background, moderation: cell.settings.moderation }],
    tool_choice: { type: 'image_generation' }, parallel_tool_calls: false, stream: false, store: false };
  const requestBody = JSON.stringify(body);
  return { version: RESPONSES_IMAGE_VERSION, ...RESPONSES_IMAGE_GATE, endpoint: '/v1/responses' as const,
    cell, requestBody, requestSha256: await sha256(requestBody), briefSha256: await sha256(cell.context.text),
    selectedContext: { kind: cell.context.kind, messageCount: 1, role: 'user', previousResponseId: null, conversationId: null,
      instructions: { state: 'omitted' }, assets: [] }, sharedCapabilityIssues: shared.issues };
}
export type ResponsesImagePlan = Awaited<ReturnType<typeof prepareResponsesImageExperiment>>;

/** Deliberate hard stop: not an enabled flag or a mock-transport escape hatch. */
export function dispatchResponsesImageExperiment(): never { throw new Error('responses_runtime_unqualified'); }

export type ResponsesImageObservation =
  | { kind: 'http'; status: number; requestId: string | null; body: unknown }
  | { kind: 'stream'; requestId: string | null; events: readonly unknown[] }
  | { kind: 'transport_error' | 'canceled'; dispatch: 'not_dispatched' | 'dispatch_unknown'; requestId: string | null; responseId: string | null };

function usageEvidence(value: unknown) {
  if (value === undefined || value === null) return { state: 'missing' as const, raw: null };
  const v = record(value);
  const count = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  const detailShape = ['input_tokens_details', 'output_tokens_details'].every(k => v[k] === undefined || v[k] !== null && typeof v[k] === 'object' && !Array.isArray(v[k]));
  const valid = detailShape && count(v.input_tokens) && count(v.output_tokens) && count(v.total_tokens)
    && Number.isSafeInteger(Number(v.input_tokens) + Number(v.output_tokens)) && v.total_tokens === Number(v.input_tokens) + Number(v.output_tokens)
    && (record(v.input_tokens_details).cached_tokens === undefined || count(record(v.input_tokens_details).cached_tokens) && Number(record(v.input_tokens_details).cached_tokens) <= Number(v.input_tokens))
    && (record(v.output_tokens_details).reasoning_tokens === undefined || count(record(v.output_tokens_details).reasoning_tokens) && Number(record(v.output_tokens_details).reasoning_tokens) <= Number(v.output_tokens));
  return { state: valid ? 'recorded' as const : 'invalid' as const, raw: structuredClone(value) };
}
function callEvidence(value: unknown) {
  const c = record(value);
  const settings = Object.fromEntries(['quality', 'size', 'background', 'output_format'].filter(k => Object.hasOwn(c, k)).map(k => [k, c[k]]));
  return { id: nonempty(c.id), status: text(c.status), returnedModel: nonempty(c.model), returnedAction: text(c.action), settings,
    // These fields are optional observations, never copied from the requested model/prompt.
    ...(typeof c.revised_prompt === 'string' ? { revisedPrompt: c.revised_prompt } : {}),
    result: text(c.result), usage: usageEvidence(c.usage) };
}
export type ResponsesImageToolEvidence = ReturnType<typeof callEvidence>;
const base64 = (v: string | null) => v !== null && v.length > 0 && v.length % 4 === 0 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v);
export type ResponsesImageResult = {
  version: string; outcome: 'image_returned' | 'no_tool' | 'refusal' | 'incomplete' | 'provider_error' | 'invalid' | 'stream_unsupported' | 'transport_error' | 'canceled';
  evidence: GenerationOutcomeEvidence; requestId: string | null; responseId: string | null;
  returnedMainlineModel: string | null; calls: ResponsesImageToolEvidence[];
  responseUsage: ReturnType<typeof usageEvidence>; privateResponse: unknown;
  accounting: { state: 'unknown'; mainlineAllocation: 'unqualified'; responseTokens: ReturnType<typeof usageEvidence>; imageCallsObserved: number;
    imageCallTotal: number | null; aggregateIncludesImageUsage: 'unknown'; maximumCostMicrousd: null; settledCostMicrousd: null };
  automaticReplacementPurchases: 0;
};

/** Pure parser of already-held fixtures/envelopes. Entire return value is PRIVATE evidence.
 * It grants no read/write access. H must bind existing owner authorization + unexpired
 * retention before retrieval and every persistence operation; no boolean can authorize it.
 */
export function inspectResponsesImageObservation(observation: ResponsesImageObservation): ResponsesImageResult {
  const o = structuredClone(observation);
  const evidence = unknownGenerationOutcome('media_result');
  let outcome: ResponsesImageResult['outcome'] = 'invalid';
  let responseId: string | null = null, returnedMainlineModel: string | null = null;
  let calls: ResponsesImageToolEvidence[] = [], responseUsage = usageEvidence(undefined);
  let imageCallTotal: number | null = null;
  if (o.kind === 'http') {
    const body = record(o.body);
    responseId = nonempty(body.id); returnedMainlineModel = nonempty(body.model);
    responseUsage = usageEvidence(body.usage);
    const output = Array.isArray(body.output) ? body.output : [];
    calls = output.filter(x => record(x).type === 'image_generation_call').map(callEvidence);
    evidence.dispatchState = 'response_received';
    evidence.accountingState = responseUsage.state === 'recorded' ? 'usage_recorded' : 'unknown';
    const refusal = output.some(x => record(x).type === 'message' && Array.isArray(record(x).content)
      && (record(x).content as unknown[]).some(c => record(c).type === 'refusal'));
    if (o.status < 200 || o.status >= 300 || body.error || body.status === 'failed') {
      outcome = 'provider_error';
      const detail = classifyProviderFailure(new Error('responses_image_provider_error'), new Response(null, { status: o.status }), body);
      evidence.failureKind = detail.category === 'network' ? 'transport' : detail.category;
      evidence.correctiveActionScope = detail.scope;
      const stage = record(record(body.error).moderation_details).moderation_stage ?? record(record(body.error).moderation_details).stage;
      evidence.providerModerationStage = stage === 'input' || stage === 'output' ? stage : detail.providerModerationStage ?? 'unknown';
      if (detail.category === 'safety') evidence.contentOutcome = 'refused';
    } else if (refusal) {
      outcome = 'refusal'; evidence.failureKind = 'safety'; evidence.contentOutcome = 'refused';
    } else if (body.status === 'incomplete' || body.status === 'in_progress' || body.status === 'queued') {
      outcome = 'incomplete'; evidence.failureKind = 'incomplete';
    } else if (body.status === 'cancelled') {
      outcome = 'canceled'; evidence.failureKind = 'canceled';
    } else if (body.status === 'completed' && responseId && Array.isArray(body.output)) {
      imageCallTotal = calls.length;
      if (output.some(x => !['message', 'reasoning', 'image_generation_call'].includes(String(record(x).type)))) {
        evidence.failureKind = 'validation'; evidence.contentOutcome = 'invalid';
      } else if (!calls.length) { outcome = 'no_tool'; evidence.pipelineStage = 'planner'; evidence.contentOutcome = 'invalid'; }
      else if (calls.length === 1 && calls[0].id && calls[0].status === 'completed' && base64(calls[0].result)
        && (calls[0].returnedAction === null || calls[0].returnedAction === 'generate')
        && Object.entries(calls[0].settings).every(([k, v]) => v === null || v === ({ quality: 'high', size: '1536x1024', background: 'opaque', output_format: 'png' } as Record<string, string>)[k])
        && (calls[0].returnedModel === null || calls[0].returnedModel === 'gpt-image-2.5-sunburst' || calls[0].returnedModel === 'gpt-image-2.5-sunburst-2026-09-08')) {
        // Encoded bytes are not proof of successful decode, custody or fidelity.
        outcome = 'image_returned';
      } else if (calls.length === 1 && ['in_progress', 'generating'].includes(calls[0].status ?? '')) {
        outcome = 'incomplete'; evidence.failureKind = 'incomplete';
      } else if (calls.length === 1 && calls[0].status === 'failed') {
        outcome = 'provider_error'; evidence.failureKind = 'provider';
      } else { evidence.failureKind = 'validation'; evidence.contentOutcome = 'invalid'; }
    } else { evidence.failureKind = 'validation'; evidence.contentOutcome = 'invalid'; }
  } else if (o.kind === 'stream') {
    // Transport is unqualified. Retain events, but never promote partials to final pixels
    // or aggregate snapshots/deltas into a fabricated settled usage total.
    outcome = 'stream_unsupported'; evidence.dispatchState = 'response_received'; evidence.failureKind = 'validation';
    for (const event of o.events) {
      const e = record(event), r = record(e.response);
      responseId ??= nonempty(r.id); returnedMainlineModel ??= nonempty(r.model);
      if (e.type === 'response.completed' || e.type === 'response.incomplete' || e.type === 'response.failed') responseUsage = usageEvidence(r.usage);
      if (e.type === 'response.output_item.done' && record(e.item).type === 'image_generation_call') {
        const call = callEvidence(e.item);
        if (!call.id || !calls.some(c => c.id === call.id)) calls.push(call);
      }
    }
    evidence.accountingState = responseUsage.state === 'recorded' ? 'usage_recorded' : 'unknown';
  } else {
    outcome = o.kind; responseId = o.responseId; evidence.dispatchState = o.dispatch;
    evidence.failureKind = o.kind === 'canceled' ? 'canceled' : 'transport';
    evidence.accountingState = o.dispatch === 'not_dispatched' ? 'not_incurred' : 'unknown';
  }
  return { version: RESPONSES_IMAGE_VERSION, outcome, evidence, requestId: o.requestId, responseId,
    returnedMainlineModel, calls, responseUsage, privateResponse: o,
    accounting: { state: 'unknown', mainlineAllocation: 'unqualified', responseTokens: responseUsage, imageCallsObserved: calls.length, imageCallTotal,
      aggregateIncludesImageUsage: 'unknown', maximumCostMicrousd: null, settledCostMicrousd: null }, automaticReplacementPurchases: 0 };
}

/** Two identities mapped to A. The mainline response's model NEVER identifies the image model. */
export function responsesImageOperationEvidence(plan: ResponsesImagePlan, result: ResponsesImageResult): { mainline: OperationEvidence; image: OperationEvidence } {
  const common = { schemaVersion: 'forma-operation-evidence-v1' as const, entryPath: 'offline-responses-image-experiment', provider: 'openai',
    requestedQuality: plan.cell.settings.quality, endpoint: plan.endpoint, routingPolicyVersion: 'experiment-fixed-model-v1',
    capabilityVersion: IMAGE_CAPABILITY_VERSION, overrideProvenance: 'explicit-frozen-experiment', deploymentVersion: null,
    compilerVersion: null, adapterVersion: RESPONSES_IMAGE_VERSION, requestId: result.requestId, responseId: result.responseId,
    requestSha256: plan.requestSha256, responseSha256: null };
  return { mainline: { ...common, requestedAlias: plan.cell.mainlineModel, effectiveModel: plan.cell.mainlineModel,
    returnedModel: result.returnedMainlineModel, settings: { stream: false, store: false, parallel_tool_calls: false, tool_choice: { type: 'image_generation' } } },
    image: { ...common, requestedAlias: plan.cell.imageModel, effectiveModel: plan.cell.imageModel,
      returnedModel: result.calls.length === 1 ? result.calls[0].returnedModel : null,
      settings: { action: plan.cell.action, quality: plan.cell.settings.quality, size: plan.cell.settings.size,
        output_format: plan.cell.settings.outputFormat, background: plan.cell.settings.background, moderation: plan.cell.settings.moderation } } };
}

/** An inspection recommendation only; deliberately contains no callable recovery transport. */
export function responsesImageRecovery(result: ResponsesImageResult) {
  return { requestId: result.requestId, responseId: result.responseId, automaticReplacementPurchases: 0,
    next: result.evidence.dispatchState === 'not_dispatched' ? 'review_before_new_authorization' : 'reconcile_original_only',
    retrieveAuthorized: false, cancelAuthorized: false, requiresExistingOwnerAuthorizationAndRetention: true };
}

/** Exact later two-arm payloads; producing a recipe is never permission to execute it. */
export async function prepareDirectVersusResponsesRecipe(value: unknown) {
  const responses = await prepareResponsesImageExperiment(value);
  const c = responses.cell;
  const directBody = JSON.stringify({ model: c.imageModel, prompt: c.context.text, n: 1,
    quality: c.settings.quality, size: c.settings.size, output_format: c.settings.outputFormat,
    background: c.settings.background, moderation: c.settings.moderation, stream: false });
  return { version: RESPONSES_IMAGE_VERSION, status: 'proposal_requires_separate_review_and_authorization',
    ...RESPONSES_IMAGE_GATE, briefSha256: responses.briefSha256, assets: [],
    sharedImageModel: c.imageModel, aliasResolution: 'unknown', sharedSettings: structuredClone(c.settings),
    arms: [ { id: 'direct', endpoint: '/v1/images/generations', requestBody: directBody, requestSha256: await sha256(directBody) },
      { id: 'responses', endpoint: responses.endpoint, requestBody: responses.requestBody, requestSha256: responses.requestSha256 } ],
    treatment: 'route-plus-mainline-orchestration-and-automatic-prompt-revision',
    pureEndpointEffect: false, chatGPTImplementationEvidence: false, automaticReplacementPurchases: 0 };
}

/** Non-additive stage ledger: response and tool usage can overlap. This must never
 * be fed to settlement by summing rows. Preflight/planning/storage outside the
 * Responses envelope remain H's separate checkpointed operations. */
export function responsesImageStageAccounting(result: ResponsesImageResult) {
  return {
    source: 'held-envelope-observation', additive: false, costQualified: false,
    stages: [
      { stage: 'mainline_orchestration', operationId: result.responseId, requestId: result.requestId,
        usage: result.responseUsage, allocation: 'unqualified', settledCostMicrousd: null },
      ...result.calls.map(call => ({ stage: 'image_tool', operationId: call.id, requestId: result.requestId,
        usage: call.usage, allocation: 'unqualified', settledCostMicrousd: null })),
    ],
    noTool: result.outcome === 'no_tool', observedImageCalls: result.accounting.imageCallsObserved,
    unobservedStages: ['source_preparation', 'standalone_moderation', 'retrieval', 'storage', 'evaluation'],
    maximumCostMicrousd: null, mainlineImageOverlap: 'unknown', automaticReplacementPurchases: 0,
  };
}

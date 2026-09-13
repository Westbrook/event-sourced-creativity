import { canonicalJson, digest, freeze } from './compiler.ts';
import { parseSceneOutputContract, createSceneOutputContract, type SceneOutputSource } from '../model/output-scene-contract.ts';
import { parseSceneMiniAppCostPreview } from '../model/scene-mini-app-consent.ts';
import { readExperienceSceneContent, type ExperienceSceneReadSelection } from './scene-result.ts';

const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const prefixed = (value: unknown): value is string => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/u.test(value);
const row = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const hashes = ['scene_compiled_input_sha256', 'scene_request_sha256', 'scene_envelope_sha256', 'scene_candidate_sha256', 'scene_screenplay_sha256', 'scene_body_sha256'] as const;
const keys = ['scene_output_contract', 'scene_output_contract_digest', 'scene_cost_binding_hash',
  'scene_adapter_specification_digest', 'scene_source_request_digest', ...hashes, 'scene_layout', 'validation'] as const;
const sha = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, '0')).join('');

/** Capture only selected JSON metadata. Getters, custom prototypes and oversized
 * structures are rejected before cloning; provider-shaped flags confer no authority. */
function snapshot(value: unknown): unknown {
  let nodes = 0, characters = 0;
  const seen = new Set<object>();
  const visit = (value: unknown, depth: number): unknown => {
    if (++nodes > 8192 || depth > 24) throw Error('scene_metadata_limit');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') { characters += value.length; if (characters <= 524288) return value; }
    if (!value || typeof value !== 'object' || seen.has(value)) throw Error('scene_metadata_invalid');
    const array = Array.isArray(value);
    if (array ? Object.getPrototypeOf(value) !== Array.prototype : ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error('scene_metadata_invalid');
    seen.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value), result: Record<string, unknown> = Object.create(null);
    if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string') || array && Object.keys(descriptors).length !== value.length + 1) throw Error('scene_metadata_invalid');
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (array && key === 'length') continue;
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || ['__proto__', 'constructor', 'prototype'].includes(key)
        || array && !/^(0|[1-9]\d*)$/u.test(key)) throw Error('scene_metadata_invalid');
      result[key] = visit(descriptor.value, depth + 1);
    }
    seen.delete(value);
    return Object.freeze(array ? Object.values(result) : result);
  };
  return visit(value, 0);
}
const own = (value: unknown, key: string): unknown => {
  if (!row(value)) return undefined;
  const d = Object.getOwnPropertyDescriptor(value, key);
  return d?.enumerable && Object.hasOwn(d, 'value') ? d.value : undefined;
};
export type ExperienceSceneEvidence = Readonly<{
  fields: Readonly<Record<string, unknown>>; contentSha256: string; inputSha256: string;
}>;

export function captureExperienceSceneEvidence(value: unknown): ExperienceSceneEvidence | null {
  try {
    const fields = snapshot(Object.fromEntries(keys.map(key => [key, own(value, key)]))) as Record<string, unknown>;
    const contract = parseSceneOutputContract(fields.scene_output_contract), layout = fields.scene_layout, validation = fields.validation;
    const contentSha256 = own(value, 'scene_content_sha256'), inputSha256 = own(value, 'scene_input_sha256');
    if (!contract || !prefixed(fields.scene_output_contract_digest) || !hash(fields.scene_cost_binding_hash)
      || !prefixed(fields.scene_adapter_specification_digest) || !prefixed(fields.scene_source_request_digest)
      || !hash(contentSha256) || !hash(inputSha256) || hashes.some(key => !hash(fields[key])) || !row(layout) || !row(validation)
      || validation.maximum_provider_calls !== 1 || validation.provider_call_count !== 1 || validation.repair_attempted !== false
      || !Array.isArray(validation.provider_response_ids) || validation.provider_response_ids.length !== 1
      || typeof validation.provider_response_ids[0] !== 'string' || !validation.provider_response_ids[0]) return null;
    if (layout.status === 'qualified') {
      if (validation.status !== 'structure_valid_layout_verified' || validation.requirement_fulfilled !== true
        || layout.profile !== 'dm-mono-simple-text-v1' || layout.fontSha256 !== contract.fontSha256 || layout.metricsSha256 !== contract.metricsSha256
        || layout.policySha256 !== contract.paginationPolicySha256 || layout.screenplaySha256 !== fields.scene_screenplay_sha256
        || layout.bodySha256 !== fields.scene_body_sha256 || !hash(layout.displaySourceSha256) || !hash(layout.pagesSha256)
        || layout.pageCount !== 1 && layout.pageCount !== 2) return null;
    } else if (layout.status !== 'unqualified' || typeof layout.reason !== 'string'
      || validation.status !== 'structure_valid_layout_unqualified' || validation.requirement_fulfilled !== false) return null;
    return freeze({ fields, contentSha256, inputSha256 });
  } catch { return null; }
}

/** Verify both original private strings against the matching completion event.
 * Caller owns original job/event/Document association, current authorization,
 * private-read retirement and a fresh result lease before and after every await. */
export async function readExperienceNativeScene(raw: unknown, rawInput: unknown, evidence: ExperienceSceneEvidence, expected: {
  documentId: string; projectId: string; artifactId: string; providerResponseId: string; expiresAt: string;
  source: SceneOutputSource; costPreview: unknown; displaySource: ExperienceSceneReadSelection['displaySource'];
}, now = Date.now()) {
  try {
    if (typeof raw !== 'string' || typeof rawInput !== 'string' || new TextEncoder().encode(raw).length > 1_000_000
      || new TextEncoder().encode(rawInput).length > 1_000_000 || !Number.isFinite(now)) return null;
    const captured = snapshot(expected) as typeof expected, e = snapshot(evidence) as ExperienceSceneEvidence;
    const preview = parseSceneMiniAppCostPreview(captured.costPreview), contract = createSceneOutputContract(captured.source);
    const fields = e.fields;
    if (!preview || !contract || preview.documentId !== captured.documentId || preview.projectId !== captured.projectId
      || canonicalJson(fields.scene_output_contract) !== canonicalJson(contract) || fields.scene_cost_binding_hash !== preview.bindingHash
      || fields.scene_output_contract_digest !== preview.sceneContractDigest || fields.scene_source_request_digest !== captured.source.requestHash) return null;
    const input = JSON.parse(rawInput), planner = input?.planner, request = input?.request;
    if (!row(input) || input.schema_version !== 1 || input.document_id !== captured.documentId || input.project_id !== captured.projectId
      || input.artifact_id !== captured.artifactId || input.artifact_kind !== 'scene' || !row(planner) || !row(request)
      || request.source_surface !== 'outputs' || request.production_mode !== 'manual' || request.item_count !== 1
      || planner.provider !== 'openai' || planner.model !== preview.model || planner.response_id !== captured.providerResponseId
      || keys.some(key => canonicalJson(planner[key]) !== canonicalJson(fields[key]))) return null;
    const execution = planner.output_scene, calls = planner.provider_calls;
    if (!row(execution) || execution.model !== preview.model || execution.maximumCalls !== 1 || execution.maximumOutputTokens !== 3000
      || execution.stage !== 'planning:0:initial' || execution.sourceRequestDigest !== fields.scene_source_request_digest
      || execution.adapterRequestDigest !== fields.scene_adapter_specification_digest || execution.compiledInputSha256 !== fields.scene_compiled_input_sha256
      || !Array.isArray(calls) || calls.length !== 1 || !row(calls[0])) return null;
    const call = calls[0], validation = fields.validation as Record<string, unknown>;
    if (call.provider !== 'openai' || call.operation !== 'planning' || call.model !== preview.model || call.effectiveModel !== preview.model
      || call.status !== 'completed' || call.completionStatus !== 'completed' || call.validationStatus !== 'valid'
      || call.unitId !== execution.stage || call.requestDigest !== fields.scene_request_sha256 || call.providerRequestId !== captured.providerResponseId
      || (validation.provider_response_ids as string[])[0] !== captured.providerResponseId
      || typeof call.clientRequestId !== 'string' || !/^forma-scene-[a-f0-9-]{36}$/u.test(call.clientRequestId)
      || typeof call.responseRef !== 'string' || !call.responseRef || typeof execution.input !== 'string') return null;
    const [contentHash, inputHash, contractDigest, executionDigest, compiledHash, displayHash] = await Promise.all([
      sha(raw), sha(rawInput), digest(contract), digest(execution), sha(execution.input), sha(canonicalJson(captured.displaySource)),
    ]);
    if (contentHash !== e.contentSha256 || inputHash !== e.inputSha256 || contractDigest !== fields.scene_output_contract_digest
      || executionDigest !== preview.executionContractDigest || compiledHash !== fields.scene_compiled_input_sha256) return null;
    const layout = fields.scene_layout as Record<string, unknown>;
    if (layout.status === 'qualified' && displayHash !== layout.displaySourceSha256) return null;
    const content = await readExperienceSceneContent(raw, { documentId: captured.documentId, artifactId: captured.artifactId, revision: 0,
      contentSha256: e.contentSha256, screenplaySha256: fields.scene_screenplay_sha256, bodySha256: fields.scene_body_sha256,
      displaySource: captured.displaySource, expiresAt: captured.expiresAt }, now);
    return content ? freeze({ content, layout }) : null;
  } catch { return null; }
}

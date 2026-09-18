import { canonicalJson, freeze } from "../src/experiences/compiler.ts";
import { combinedContextGroups, combinedContextPromptDirectives } from "../src/model/combined-context.ts";
import { promptFactIsActive, providerFacingRenderingContext } from "../src/model/prompt-policy.ts";
import { createSceneConfiguration } from "../src/model/scene-configuration.ts";
import { parseSceneOutputContract } from "../src/model/output-scene-contract.ts";
import type { OutputNativeTargetPreflight } from "../src/model/output-delivery-contract.ts";
import { createExperienceSceneAdapterRequest } from "./experience-scene-adapter-contract.ts";
import { createOutputSceneRequestContract, OUTPUT_SCENE_MODEL } from "./output-scene-request.ts";
import { createSceneMiniAppCostPreview } from "./scene-mini-app-consent.ts";
import { outputScenePreflightConfiguration } from "./output-scene-preflight-contract.ts";
import { resolveOutputSceneSource } from "./output-scene-source.ts";
import type { PreparedSceneCost } from "./scene-cost-consent.ts";
import type { OutputSqlAssertion } from "./output-command-core.ts";
import { outputProofReadStatements } from "./output-disclosure-proof.ts";
import type { OutputBridgeTargetInput } from "./output-requirements-api.ts";
import { captureSceneSourceVersion } from './scene-source-generation.ts';

type ScenePreflightProof = Readonly<{ prepared: PreparedSceneCost; sourceAssertions: readonly OutputSqlAssertion[]; requestId: string; expiresAt: string }>;
const proofs = new WeakMap<OutputNativeTargetPreflight, ScenePreflightProof>();
/** Server object identity only. Serialized settings or copied preflights cannot
 * supply SQL/private-source proof, consent, or authority to admission/dispatch. */
export const outputScenePreflightProof = (preflight: OutputNativeTargetPreflight): ScenePreflightProof | null => proofs.get(preflight) ?? null;
const unavailable = (targetId: string, code: string): OutputNativeTargetPreflight => ({ targetId, available: false,
  reasonCode: code, reason: "Scene unavailable", transferCode: "output_transfer_none_owned_adoption", provider: null, model: null,
  route: null, maximumMicrousd: 0, maximumCalls: 0, maximumTokens: 0, settings: {}, transferDescription: "No transfer" });

/** Shared with dispatch. This is the manual Scene branch of the canonical
 * rendering-context/group mapping, applied to PreparedSceneCost.effectiveSnapshot
 * (including the actual Document title and authored standing constraints).
 * The builder captures request data only; callers still need real source proof.
 * Dispatch compares this whole object with the actual compiled provider input. */
export async function createOutputSceneProviderInput(rawIntake: unknown, effectiveSnapshot: Record<string, unknown>, outputTargetInstructions: string) {
  const snapshot = structuredClone(effectiveSnapshot), instructions = outputTargetInstructions.trim();
  const document = snapshot.document;
  if (!document || typeof document !== "object" || Array.isArray(document)
    || typeof (document as Record<string, unknown>).title !== "string" || !(document as Record<string, string>).title.trim()
    || instructions.length > 65536) return null;
  const adapter = await createExperienceSceneAdapterRequest(rawIntake);
  if (!adapter) return null;
  const activeSnapshot = { ...snapshot, facts: (Array.isArray(snapshot.facts) ? snapshot.facts : []).filter(promptFactIsActive) };
  const groups = combinedContextGroups(activeSnapshot), directives = combinedContextPromptDirectives(activeSnapshot, "scene");
  const plan = groups.map((group, index) => ({ context_key: `context_group_${index + 1}`, name: group.name, role: group.role,
    target: group.target, application: group.application, relativity: group.relativity,
    members: group.members.map(({ label, role, relativity, order }) => ({ label, role, relativity, order })), instruction: directives[index] }));
  const configuration = createSceneConfiguration("visual");
  return freeze({ document_title: (document as Record<string, string>).title,
    creative_context: providerFacingRenderingContext(snapshot),
    ...(instructions ? { output_requirements: { instructions, source_evidence: false } } : {}), combined_context_plan: plan,
    audience: "general", tone: "derived from the document",
    scene_configuration: { medium: configuration.medium, source: configuration.source, target_format: configuration.targetFormat,
      downstream_formats: configuration.downstreamFormats, alternate_medium: configuration.alternateMedium,
      context_continuity: "same-authored-narrative-context", alternate_rendering: { medium: configuration.alternateMedium, preserve_authored_context: true } },
    scene_intent: JSON.parse(adapter.input),
  });
}

/** Read-only preparation through the actual retained-intake and Scene source
 * readers. No approval, provider call, slot/job, reservation or schema mutation.
 * Private assertions must be consumed again by the existing atomic admission and
 * synchronous paid-dispatch boundary; this final read is not a durable grant. */
export async function preflightOutputSceneTarget(input: OutputBridgeTargetInput): Promise<OutputNativeTargetPreflight> {
  const { target, env } = input;
  if (!parseSceneOutputContract(target.scene_contract) || target.media_kind !== "document" || !target.selected || target.blocking_issues.length
    || target.quantity.kind !== "exact" || target.quantity.unit !== "document" || target.quantity.value !== 1
    || target.source_scope.kind !== "document" || target.coverage.kind !== "document_context"
    || target.aspect_ratio || target.content_quantity || target.count_policy || target.variant_id || target.member_id)
    return unavailable(target.id, "output_scene_contract_unsupported");
  if (!env.OPENAI_API_KEY || (env.OPENAI_MODEL ?? OUTPUT_SCENE_MODEL) !== OUTPUT_SCENE_MODEL) return unavailable(target.id, "output_scene_provider_unavailable");
  const source = await resolveOutputSceneSource(input);
  if (Date.parse(source.expiresAt) <= Date.now() || Date.parse(input.confirmedPlan.confirmedAt) > Date.now()) return unavailable(target.id, "output_scene_original_expired");
  // Load the existing native source reader only for actual preparation, not for
  // grammar/provider-input inspection. Its real guards and callbacks remain intact.
  const { prepareSceneCostConsent } = await import("./scene-cost-consent.ts");
  const sourceVersion=input.sceneSourceVersion??(input.sceneUseVersionedHistory?await captureSceneSourceVersion(env,{streamId:input.principal.streamId}):undefined);
  const prepared = await prepareSceneCostConsent(env, input.principal, input.scope.documentId, {
    artifactKind: "scene", productionMode: "manual", sceneMedium: "visual", itemCount: 1, sceneRequestId: source.requestId,
    snapshot: input.context.snapshot, sourceBlockVersions: input.context.sourceBlockVersions,
  }, null, { synchronize: false,...(sourceVersion?{versionedSource:{version:sourceVersion,projectId:input.scope.projectId,assertions:source.sourceAssertions}}:{}) });
  if (canonicalJson(prepared.authoredSnapshot) !== canonicalJson(input.context.snapshot)) return unavailable(target.id, "output_scene_source_changed");
  const providerInput = await createOutputSceneProviderInput(source.plan.request, prepared.effectiveSnapshot, target.instruction_text);
  if (!providerInput) return unavailable(target.id, "output_scene_request_unavailable");
  // Byte-based conservative budget includes schema/instruction/wire overhead;
  // actual dispatch still checks the whole serialized request against this cap.
  const maximumInputTokens = new TextEncoder().encode(canonicalJson(providerInput)).byteLength * 4 + 25000;
  const contract = await createOutputSceneRequestContract(source.plan.request, providerInput, maximumInputTokens);
  if (!contract) return unavailable(target.id, "output_scene_context_limit");
  const costPreview = await createSceneMiniAppCostPreview(prepared, source.contract, source.plan.request, contract, source.expiresAt);
  if (!costPreview || costPreview.requestId !== source.requestId) return unavailable(target.id, "output_scene_cost_unavailable");
  const preflight = await outputScenePreflightConfiguration(target.id, { artifactKind: "scene", productionMode: "manual", sceneMedium: "visual", itemCount: 1,
    budgetAcknowledged: true, preflightAcknowledged: true, outputTargetInstructions: target.instruction_text.trim(), sceneRequestId: source.requestId,
    outputScene: { intake: source.plan.request, sceneContract: source.contract, contract, costPreview } });
  if (!preflight) return unavailable(target.id, "output_scene_request_unavailable");
  const sourceAssertions: OutputSqlAssertion[] = [...source.sourceAssertions, ...prepared.assertions,
    { sql: "? > strftime('%Y-%m-%dT%H:%M:%fZ','now')", bindings: [source.expiresAt], deadlineMs: Date.parse(source.expiresAt) }]
    .map(assertion => ({ ...assertion, bindings: [...(assertion.bindings ?? [])] }));
  // A renewed plan retains every ancestor witness. Keep each statement within
  // D1's parameter limits, while reading all predicates in one atomic batch.
  // Preserve the original assertions for admission and dispatch revalidation.
  const checked = await env.DB.batch<Record<string, unknown>>(outputProofReadStatements(env, sourceAssertions));
  if (!Array.isArray(checked) || checked.length !== sourceAssertions.length
    || Array.from({length:sourceAssertions.length},(_,index)=>checked[index]).some(result=>!result
      || result.success!==true || !Array.isArray(result.results) || result.results.length!==1 || result.results[0]?.current!==1)
    || sourceAssertions.some(assertion => assertion.deadlineMs !== undefined && Date.now() >= assertion.deadlineMs)) return unavailable(target.id, "output_scene_source_changed");
  proofs.set(preflight, Object.freeze({ prepared: freeze(prepared), sourceAssertions: freeze(sourceAssertions), requestId: source.requestId, expiresAt: source.expiresAt }));
  return preflight;
}

import { canonicalJson, freeze } from "../src/experiences/compiler.ts";
import { MODEL3D_MINI_APP_SETTINGS, parseModel3dOutputContract } from "../src/model/output-model3d-contract.ts";
import { adaptDocumentToModel3d, model3dAdaptationReceipt } from "../src/model/model3d-prompt-adapter.ts";
import { prepareModel3dRequest } from "./model3d-request.ts";
import { describeModel3dPreparation } from "./output-model3d-preparation.ts";
import { resolveOutputModel3dSource } from "./output-model3d-source.ts";
import { outputProofReadStatements, assertOutputProofRead } from "./output-disclosure-proof.ts";
import { parseModel3dMiniAppCostPreview } from "../src/model/model3d-mini-app-consent.ts";
import { OUTPUT_MODEL3D_EXECUTION_POLICY } from "../src/model/output-execution-policy.ts";
import { readOutputModel3dPayload } from "./output-model3d-execution.ts";
import type { OutputBridgeTargetInput } from "./output-requirements-api.ts";
import type { OutputNativeTargetPreflight } from "../src/model/output-delivery-contract.ts";
import type { OutputSqlAssertion } from "./output-command-core.ts";

const unavailable = (targetId: string, code: string): OutputNativeTargetPreflight => ({
  targetId, available: false, reasonCode: code, reason: "3D preparation unavailable",
  transferCode: "output_transfer_none_authorized", transferDescription: "No source or media is sent by this check.",
  provider: null, model: null, route: null, maximumMicrousd: 0, maximumCalls: 0, maximumTokens: 0, settings: {},
});
const proofs = new WeakMap<OutputNativeTargetPreflight, readonly OutputSqlAssertion[]>();
export const outputModel3dPreflightAssertions = (value: OutputNativeTargetPreflight) => proofs.get(value) ?? null;

/** Read-only original-source quote. Admission, transfer and dispatch independently
 * require this exact source, explicit approval and the original durable job. */
export async function preflightOutputModel3dMiniAppTarget(input: OutputBridgeTargetInput): Promise<OutputNativeTargetPreflight> {
  const { target } = input, contract = parseModel3dOutputContract(target.model3d_contract);
  if (!contract || target.media_kind !== "model3d" || !target.selected || target.blocking_issues.length
    || target.quantity.kind !== "exact" || target.quantity.unit !== "model" || target.quantity.value !== 1
    || target.source_scope.kind !== "document" || target.coverage.kind !== "document_context"
    || target.aspect_ratio || target.content_quantity || target.count_policy || target.variant_id || target.member_id
    || ["audio_contract", "scene_contract", "narrative_contract", "video_contract", "storyboard_contract"].some(key => Object.hasOwn(target, key)))
    return unavailable(target.id, "output_model3d_contract_unsupported");
  const source = await resolveOutputModel3dSource(input);
  if (Date.parse(source.expiresAt) <= Date.now() || Date.parse(input.confirmedPlan.confirmedAt) > Date.now())
    return unavailable(target.id, "output_model3d_original_expired");
  const snapshot = structuredClone(input.context.snapshot);
  if (new TextEncoder().encode(canonicalJson(snapshot)).byteLength > 262_144)
    return unavailable(target.id, "output_model3d_context_limit");
  const referenceBlockIds = contract.reference ? [contract.reference.copiedBlockId] : [];
  const adapted = adaptDocumentToModel3d(snapshot, { referenceCount: referenceBlockIds.length });
  if (!adapted.valid) return unavailable(target.id, adapted.issues[0]?.code ?? "output_model3d_prompt_unavailable");
  const prepared = await prepareModel3dRequest({ env: input.env, ownerId: input.scope.ownerUserId, snapshot,
    sourceEvents: input.sourceEvents!, prompt: adapted.prompt, promptSource: "document", adaptation: model3dAdaptationReceipt(adapted),
    settings: MODEL3D_MINI_APP_SETTINGS, referenceBlockIds });
  const description = await describeModel3dPreparation(contract, prepared);
  const assertions: OutputSqlAssertion[] = [...source.sourceAssertions, {
    sql: "? > strftime('%Y-%m-%dT%H:%M:%fZ','now')", bindings: [source.expiresAt], deadlineMs: Date.parse(source.expiresAt),
  }];
  // Keep each original head/authority/private proof intact within D1's bind
  // limit. Check every result in one read-only batch, never one flattened SQL.
  assertOutputProofRead(await input.env.DB.batch(outputProofReadStatements(input.env, assertions)), assertions.length);
  if (assertions.some(value => value.deadlineMs !== undefined && Date.now() >= value.deadlineMs))
    return unavailable(target.id, "output_model3d_source_changed");
  const selected = description.references[0];
  const costPreview = parseModel3dMiniAppCostPreview({ version: "model3d-mini-app-cost-v1", requestId: source.requestId,
    expiresAt: source.expiresAt, draftId: source.plan.draftId, actorUserId: input.scope.actorUserId,
    projectId: input.scope.projectId, documentId: input.scope.documentId, sourceDigest: input.sourceDigest,
    requirementsDigest: input.requirementsDigest, preparationDigest: description.preparationDigest,
    maximumMicrousd: description.maximumMicrousd, maximumCalls: 1, maximumTokens: 1, model: prepared.model,
    sourceFilesTransferred: selected ? 1 : 0, sourceKind: contract.reference?.selection.kind ?? null,
    referenceSha256: selected?.sha256 ?? null, referenceBytes: selected?.byteLength ?? 0, referenceMimeType: selected?.mimeType ?? null });
  if (!costPreview) return unavailable(target.id, "output_model3d_quote_unavailable");
  const payload = { productionMode: "manual", artifactKind: "model3d", itemCount: 1,
    outputModel3d: contract, model3dPreparation: description, model3dCostPreview: costPreview,
    model3dPrompt: prepared.prompt, model3dPromptSource: "document", model3dAdaptation: prepared.adaptation ?? null,
    model3dSettings: prepared.settings, model3dReferenceBlockIds: referenceBlockIds };
  if (!await readOutputModel3dPayload(payload)) return unavailable(target.id, "output_model3d_quote_unavailable");
  const configured = Boolean(input.env.FAL_KEY?.trim());
  const result: OutputNativeTargetPreflight = freeze({
    targetId: target.id, available: configured, reasonCode: configured ? "output_model3d_ready_for_separate_approval" : "output_native_model3d_unconfigured",
    reason: "One original Rodin request for a static GLB. Static assembly checks do not prove one semantic object or visual quality; review the retained model.",
    provider: "fal", model: prepared.model, route: "model3d-mini-app-static-glb-v1",
    maximumMicrousd: description.maximumMicrousd, maximumCalls: 1, maximumTokens: 1,
    transferCode: "output_transfer_model3d_not_yet_authorized",
    transferDescription: "This check sends nothing. After separate approval and Start, the displayed adapted prompt and fixed settings go to fal.ai / Hyper3D Rodin, with only the listed owned image or saved PNG view. Original mesh bytes are not sent. Prices are estimates, not provider billing evidence. An uncertain request is not automatically resubmitted.",
    settings: { kind: "render_document", payload,
      calls: [{ stage: "model3d:initial", provider: "fal", model: prepared.model, maximumMicrousd: description.maximumMicrousd }],
      executionPolicy: OUTPUT_MODEL3D_EXECUTION_POLICY, preparationOnly: false, executionAvailable: configured,
      explicitCostAndTransferApprovalRequired: true, costPreview, description,
      original: { requestId: source.requestId, expiresAt: source.expiresAt, draftId: source.plan.draftId,
        actorUserId: input.scope.actorUserId, projectId: input.scope.projectId, documentId: input.scope.documentId,
        sourceDigest: input.sourceDigest, requirementsDigest: input.requirementsDigest } },
  });
  proofs.set(result, freeze(assertions.map(value => ({ ...value, bindings: [...(value.bindings ?? [])] }))));
  return result;
}

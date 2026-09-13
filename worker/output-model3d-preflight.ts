import { canonicalJson, freeze } from "../src/experiences/compiler.ts";
import { MODEL3D_MINI_APP_SETTINGS, parseModel3dOutputContract } from "../src/model/output-model3d-contract.ts";
import { adaptDocumentToModel3d, model3dAdaptationReceipt } from "../src/model/model3d-prompt-adapter.ts";
import { prepareModel3dRequest } from "./model3d-request.ts";
import { describeModel3dPreparation } from "./output-model3d-preparation.ts";
import { resolveOutputModel3dSource } from "./output-model3d-source.ts";
import { outputProofReadStatements, assertOutputProofRead } from "./output-disclosure-proof.ts";
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

/** Connected read-only preparation. Until the exact original-job dispatch and
 * static-result join are implemented, this path deliberately cannot authorize
 * an operation, including through the general Document Model3D bridge. */
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
  const result: OutputNativeTargetPreflight = freeze({
    ...unavailable(target.id, "output_model3d_execution_not_connected"),
    reason: "Current source prepared for one static GLB target; Start is not connected yet. Static assembly checks cannot prove that the model depicts one semantic object.",
    provider: "fal", model: prepared.model, route: "model3d-mini-app-preparation-v1",
    transferDescription: "This check sends nothing. A later separately authorized Start would send the displayed adapted prompt and fixed settings to fal.ai / Hyper3D Rodin, with only the listed owned image or saved PNG view. Original mesh bytes are not sent. No generation, grant or cost reservation is created by preparation.",
    settings: { preparationOnly: true, executionAvailable: false, explicitCostAndTransferApprovalRequired: true,
      description, original: { requestId: source.requestId, expiresAt: source.expiresAt, draftId: source.plan.draftId,
        actorUserId: input.scope.actorUserId, projectId: input.scope.projectId, documentId: input.scope.documentId,
        sourceDigest: input.sourceDigest, requirementsDigest: input.requirementsDigest } },
  });
  proofs.set(result, freeze(assertions.map(value => ({ ...value, bindings: [...(value.bindings ?? [])] }))));
  return result;
}

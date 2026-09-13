import { canonicalJson, digest, freeze } from "./compiler.ts";
import type { ExperiencePlan } from "./intake.ts";
import { createModel3dOutputContract, parseModel3dOutputContract, type Model3dOutputContract } from "../model/output-model3d-contract.ts";
import { parseModel3dMiniAppCostPreview } from "../model/model3d-mini-app-consent.ts";
import { captureModel3dComparisonData as snapshot, readModel3dExecutionPayload } from "../model/output-model3d-offer.ts";
import { verifyModel3dPreparedReceipt } from "../model/model3d-mini-app-execution.ts";
import { projectNativeRetainedModel3d } from "../model/native-retained-model3d.ts";
import { MODEL3D_STATIC_POLICY } from "../model/model3d-static-policy.ts";
import type { NativeRetainedOutputDto } from "../model/native-retained-output.ts";
import type { Model3dPreparedReceipt } from "../../worker/fal-model3d-adapter.ts";
const row = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const executionKeys = ["scopeKey", "grantId", "slotId", "planRevisionId", "targetId", "targetContractDigest", "sourceDigest"] as const;
/** Exact intake correspondence only. Server custody and rights remain separate. */
export async function experienceModel3dContract(plan: ExperiencePlan): Promise<Model3dOutputContract | null> {
  if (plan.release.output.output !== "model3d") return null;
  const copies = plan.events.filter(event => event.type === "BlockCreated" && event.payload.handle === "reference/experience-model3d");
  if (copies.length !== (plan.reference ? 1 : 0)) return null;
  return createModel3dOutputContract({ draftId: plan.draftId, draftHash: plan.draftHash, releaseHash: plan.release.releaseHash,
    requestHash: await digest(plan.request), sourceBindingHash: await digest({ projectId: plan.projectId, documentId: plan.documentId, events: plan.events }),
    reference: plan.reference ? { selection: plan.reference.selection, sourceDigest: plan.reference.sourceDigest, copiedBlockId: copies[0]!.payload.block_id } : null });
}
export function captureExperienceModel3dTarget(value: unknown, expected: unknown): boolean {
  try {
    const target = snapshot(value), contract = parseModel3dOutputContract(expected);
    return Boolean(contract && row(target) && target.media_kind === "model3d" && target.selected === true && target.required === true
      && canonicalJson(target.model3d_contract) === canonicalJson(contract)
      && canonicalJson(target.quantity) === canonicalJson({ kind: "exact", unit: "model", value: 1 })
      && canonicalJson(target.source_scope) === canonicalJson({ kind: "document" })
      && canonicalJson(target.coverage) === canonicalJson({ kind: "document_context" })
      && Array.isArray(target.blocking_issues) && target.blocking_issues.length === 0);
  } catch { return false; }
}
export type ExperienceModel3dEvidence = Readonly<{
  schemaVersion: 1; jobId: string; actorUserId: string; documentId: string; projectId: string; artifactId: string;
  execution: Readonly<Record<typeof executionKeys[number], string>>;
  contract: Model3dOutputContract; costPreview: NonNullable<ReturnType<typeof parseModel3dMiniAppCostPreview>>;
  receipt: Readonly<Record<string, unknown>>;
  files: NonNullable<ReturnType<typeof projectNativeRetainedModel3d>>["files"];
}>;
/** Qualified completion association only, not media availability or authority.
 * Unqualified paid originals remain retained but cannot claim this static reader. */
export function captureExperienceModel3dEvidence(value: unknown): ExperienceModel3dEvidence | null {
  try {
    if (!row(value)) return null;
    const field = Object.getOwnPropertyDescriptor(value, "output_model3d");
    if (!field?.enumerable || !Object.hasOwn(field, "value")) return null;
    const evidence = snapshot(field.value);
    if (!row(evidence) || evidence.schemaVersion !== 1 || Object.keys(evidence).length !== 11
      || !["jobId", "actorUserId", "documentId", "projectId", "artifactId"].every(key => id(evidence[key]))) return null;
    const contract = parseModel3dOutputContract(evidence.contract), preview = parseModel3dMiniAppCostPreview(evidence.costPreview);
    const execution = evidence.execution, receipt = evidence.receipt;
    if (!contract || !preview || !row(execution) || Object.keys(execution).length !== executionKeys.length
      || !executionKeys.every(key => typeof execution[key] === "string" && String(execution[key]).length > 0 && String(execution[key]).length <= 1024 && !/[\p{Cc}]/u.test(String(execution[key])))
      || !hash(execution.sourceDigest) || !hash(execution.targetContractDigest) || !row(receipt) || Object.keys(receipt).length !== 11
      || preview.requestId !== evidence.jobId || preview.actorUserId !== evidence.actorUserId || preview.documentId !== evidence.documentId || preview.projectId !== evidence.projectId
      || preview.draftId !== contract.source.draftId || preview.sourceDigest !== execution.sourceDigest
      || receipt.schemaVersion !== 1 || canonicalJson(receipt.contract) !== canonicalJson(contract) || receipt.preparationDigest !== preview.preparationDigest
      || !id(receipt.mediaCallId) || !id(receipt.providerRequestId) || !hash(receipt.requestDigest) || !hash(receipt.primarySha256)
      || receipt.requirementFulfilled !== false || receipt.semanticObjectCount !== "unverified") return null;
    const qualification = receipt.qualification;
    if (!row(qualification) || qualification.status !== "qualified" || qualification.policy !== MODEL3D_STATIC_POLICY
      || qualification.sha256 !== receipt.primarySha256 || qualification.byteLength !== receipt.primaryByteLength
      || qualification.sceneIndex !== 0 || qualification.semanticObjectCount !== "unverified"
      || !["byteLength", "nodeCount", "meshNodeCount", "meshDefinitionCount", "primitiveDefinitionCount"].every(key => Number.isSafeInteger(qualification[key]) && Number(qualification[key]) > 0)
      || !Number.isSafeInteger(qualification.rootNodeIndex) || Number(qualification.rootNodeIndex) < 0
      || !Number.isSafeInteger(qualification.materialDefinitionCount) || Number(qualification.materialDefinitionCount) < 0) return null;
    const content = projectNativeRetainedModel3d({ artifact_kind: "model3d", settings: { model3d_files: evidence.files } }), primary = content?.files[0];
    if (!primary || primary.sha256 !== receipt.primarySha256 || primary.fileSize !== receipt.primaryByteLength || primary.role !== "mesh" || primary.format !== "glb"
      || primary.mimeType !== "model/gltf-binary" || primary.previewSupported === false) return null;
    return freeze({ ...evidence, contract, costPreview: preview, files: content.files }) as ExperienceModel3dEvidence;
  } catch { return null; }
}
export async function verifyExperienceModel3dRead(rawInput: unknown, evidenceValue: unknown, retained: Extract<NativeRetainedOutputDto, { output: "model3d" }>, expected: {
  contract: Model3dOutputContract; costPreview: unknown; jobId: string; actorUserId: string; documentId: string; projectId: string; artifactId: string;
  grantId: string; slotId: string; targetId: string; planRevisionId: string; sourceDigest: string; targetContractDigest: string; usedMicrousd: number; usedCalls: number;
}): Promise<boolean> {
  try {
    if (typeof rawInput !== "string" || new TextEncoder().encode(rawInput).byteLength > 1048576) return false;
    const evidence = captureExperienceModel3dEvidence({ output_model3d: evidenceValue }), input = snapshot(JSON.parse(rawInput));
    if (!evidence || !row(input) || canonicalJson(evidence.contract) !== canonicalJson(expected.contract)
      || canonicalJson(evidence.costPreview) !== canonicalJson(expected.costPreview)
      || !["jobId", "actorUserId", "documentId", "projectId", "artifactId"].every(key => evidence[key as keyof typeof evidence] === expected[key as keyof typeof expected])
      || !executionKeys.filter(key => key !== "scopeKey").every(key => evidence.execution[key] === expected[key])
      || expected.usedCalls !== 1 || expected.usedMicrousd !== evidence.costPreview.maximumMicrousd
      || input.schema_version !== 1 || input.artifact_kind !== "model3d" || input.artifact_id !== expected.artifactId || input.document_id !== expected.documentId || input.project_id !== expected.projectId
      || canonicalJson(input.output_model3d) !== canonicalJson(evidence) || !row(input.request) || !row(input.render)
      || input.request.source_surface !== "outputs" || retained.output !== "model3d" || retained.selection.documentId !== expected.documentId
      || retained.selection.artifactId !== expected.artifactId || retained.selection.revision !== 0
      || canonicalJson(retained.content.files) !== canonicalJson(evidence.files)) return false;
    const description = input.model3d_preparation;
    const offer = readModel3dExecutionPayload({ productionMode: "manual", artifactKind: "model3d", itemCount: 1,
      outputModel3d: evidence.contract, model3dCostPreview: evidence.costPreview, model3dPreparation: description,
      model3dPrompt: input.request.model3d_prompt, model3dPromptSource: input.request.model3d_prompt_source,
      model3dAdaptation: input.request.model3d_adaptation, model3dSettings: input.request.model3d_settings,
      model3dReferenceBlockIds: input.request.model3d_reference_block_ids });
    if (!offer || !row(description)) return false;
    const { preparationDigest, ...body } = description;
    if (await digest(body) !== preparationDigest) return false;
    const render = input.render;
    const prepared = Object.fromEntries(["provider", "model", "adapterVersion", "submittedPrompt", "settings", "parameters", "acceptedFields", "referenceInputs", "usedReferencePixels", "estimatedCostMicrousd", "requestDigest"].map(key => [key, render[key]]));
    const checked = await verifyModel3dPreparedReceipt(offer, prepared as Model3dPreparedReceipt);
    return checked.requestDigest === evidence.receipt.requestDigest && input.render.providerJobId === evidence.receipt.providerRequestId;
  } catch { return false; }
}

import { canonicalJson, freeze } from "../src/experiences/compiler.ts";
import { captureExperienceModel3dEvidence } from "../src/experiences/model3d-native-result.ts";
import { projectNativeRetainedModel3d } from "../src/model/native-retained-model3d.ts";
import { qualifyOutputModel3dCompletion, verifyModel3dPreparedReceipt, type OutputModel3dPayload } from "./output-model3d-execution.ts";
import type { Model3dGeneratedFile, Model3dPreparedReceipt } from "./fal-model3d-adapter.ts";
import type { PaidProviderSubmission } from "../src/model/provider-submission.ts";
import { ownerMediaNamespace } from "../src/model/media-ownership.ts";
import { captureModel3dComparisonData } from "../src/model/output-model3d-offer.ts";

function fail(): never { throw new Error("output_model3d_recovery_completion_invalid"); }
const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : fail();
const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
export const MODEL3D_RECOVERY_PRIMARY_QUALIFICATION_BYTES = 16 * 1024 * 1024;
/** Recovery-only memory bound. Original paid bytes are stored before checking. */
export function assertOutputModel3dRecoveryPrimarySize(bytes: number) {
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > MODEL3D_RECOVERY_PRIMARY_QUALIFICATION_BYTES)
    throw new Error("output_model3d_recovery_qualification_size_limit");
}

/** Exactly the current private media writer's extension mapping. A new storage
 * token is not a new job, artifact, authorization or provider submission. */
export function outputModel3dRecoveryStorage(ownerId: string, artifactId: string, token: string, index: number,
  file: Pick<Model3dGeneratedFile, "role" | "mimeType" | "format">) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(artifactId) || !/^[a-f0-9-]{36}$/u.test(token)
    || !Number.isSafeInteger(index) || index < 0 || index >= 64 || !["mesh", "texture", "preview"].includes(file.role)) fail();
  const artifactKey = artifactId + "-recovery-" + token + (index === 0 ? "" : "-" + file.role + "-" + index);
  const mime = file.mimeType;
  const extension = mime === "model/gltf-binary" ? "glb" : mime === "model/vnd.usdz+zip" ? "usdz" : mime === "model/obj" ? "obj"
    : mime === "model/stl" ? "stl" : mime === "application/octet-stream" && file.format === "fbx" ? "fbx" : mime === "application/zip" ? "zip"
      : mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png";
  const storageKey = ownerMediaNamespace(ownerId) + "/generated/" + artifactKey + "." + extension;
  return { artifactKey, storageKey, url: "/api/media/" + encodeURIComponent(storageKey) };
}

/** Shared wire shape of the normal Model3D producer. Every qualification is
 * reconstructed from the actual primary bytes, never copied from a checkpoint.
 * This pure assembly is not current authority or storage/call custody. */
type AssemblyIdentity = {
  jobId: string; ownerId: string; documentId: string; projectId: string; artifactId: string;
  execution: Record<string, string>; offer: OutputModel3dPayload; prepared: Model3dPreparedReceipt;
  submission: PaidProviderSubmission; request: Record<string, unknown>;
};
export function createOutputModel3dRecoveryAssembly(identity: AssemblyIdentity) {
  // SQL publication compares the exact stored JSON tuples, including key
  // order. Snapshot without serialization/getters; canonical equality remains
  // the comparison, never a rewrite of the approved request representation.
  const input = captureModel3dComparisonData(identity) as AssemblyIdentity;
  if (!equal(input.request.outputExecution, input.execution) || !equal(input.request.outputModel3d, input.offer.contract)) fail();
  let qualified: Awaited<ReturnType<typeof qualifyOutputModel3dCompletion>> | undefined;
  return {
    async qualify(primary: Model3dGeneratedFile) {
      if (qualified) fail();
      assertOutputModel3dRecoveryPrimarySize(primary.bytes.byteLength);
      qualified = await qualifyOutputModel3dCompletion({ offer: input.offer, prepared: input.prepared, calls: [input.submission],
        providerRequestId: input.submission.providerRequestId!, primary });
      // Only the compact immutable proof survives this call, not primary bytes.
      return qualified;
    },
    async finish(files: readonly unknown[], title: string, seed: number) {
      if (!qualified) fail();
      if (!Number.isSafeInteger(seed) || seed < 0 || seed > 65535) fail();
      return assembleQualified({ ...input, files, title, seed }, qualified);
    },
  };
}
export async function assembleOutputModel3dRecoveryCompletion(input: AssemblyIdentity & { primary: Model3dGeneratedFile; files: readonly unknown[]; title: string; seed: number }) {
  const { primary, files, title, seed, ...identity } = input;
  const assembly = createOutputModel3dRecoveryAssembly(identity);
  await assembly.qualify(primary);
  return assembly.finish(files, title, seed);
}
async function assembleQualified(input: AssemblyIdentity & { files: readonly unknown[]; title: string; seed: number }, receipt: Awaited<ReturnType<typeof qualifyOutputModel3dCompletion>>) {
  const prepared = await verifyModel3dPreparedReceipt(input.offer, input.prepared);
  const captured = projectNativeRetainedModel3d({ artifact_kind: "model3d", settings: { model3d_files: input.files } });
  if (!captured || captured.files.length !== input.files.length) fail();
  const completion = { schemaVersion: 1, jobId: input.jobId, actorUserId: input.ownerId, documentId: input.documentId,
    projectId: input.projectId, artifactId: input.artifactId, execution: input.request.outputExecution,
    contract: input.request.outputModel3d, costPreview: input.offer.preview, receipt, files: captured.files };
  // The normal reader intentionally refuses animated/unsafe/unqualified files.
  // The caller has already retained and settled their actual paid receipt; this
  // refusal does not relabel the provider call rejected or grant a replacement.
  if (!captureExperienceModel3dEvidence({ output_model3d: completion })) fail();
  if (!equal(input.request.outputExecution, input.execution)) fail();
  const content = { title: input.title, summary: prepared.submittedPrompt, content_markdown: prepared.submittedPrompt, presentation: null, items: [] };
  const invocation = { schema_version: 1, artifact_id: input.artifactId, artifact_kind: "model3d", document_id: input.documentId,
    project_id: input.projectId, output_model3d: completion, model3d_preparation: input.offer.description,
    request: { model3d_prompt: prepared.submittedPrompt, model3d_settings: prepared.settings,
      model3d_reference_block_ids: input.request.model3dReferenceBlockIds, source_surface: "outputs",
      ...(input.request.model3dPromptSource === "document" ? { model3d_prompt_source: "document", model3d_adaptation: input.request.model3dAdaptation } : {}),
      estimated_cost_microusd: prepared.estimatedCostMicrousd, reserved_cost_microusd: input.offer.preview.maximumMicrousd },
    planner: null, render: { ...prepared, submitted_prompt: prepared.submittedPrompt, reference_inputs: prepared.referenceInputs,
      used_reference_pixels: prepared.usedReferencePixels, providerJobId: input.submission.providerRequestId, seed: input.seed } };
  return freeze({ completion, content, invocation, files: captured.files });
}

/** All prior correlated usage must belong to this same original. Reject missing
 * or malformed numbers, foreign IDs and over-counts instead of hiding them with
 * Math.max. Returning zero permits finalization without recording more usage. */
export function remainingOutputModel3dRecoveryUsage(input: {
  rows: readonly unknown[]; costMicrousd: number; artifactId: string; documentId: string;
  reservationId: string; costReservationId: string; providerRequestId: string;
}) {
  if (!Number.isSafeInteger(input.costMicrousd) || input.costMicrousd < 0 || input.rows.length > 64) fail();
  let used = 0;
  for (const raw of input.rows) {
    const row = object(raw);
    if (row.operation !== "document-render:model3d" || row.artifact_id !== input.artifactId || row.document_id !== input.documentId
      || row.reservation_id !== input.reservationId || row.cost_reservation_id !== input.costReservationId
      || row.provider_job_id !== input.providerRequestId) fail();
    for (const key of ["input_tokens", "output_tokens", "total_tokens"]) if (row[key] !== 0) fail();
    if (!Number.isSafeInteger(row.cost_microusd) || Number(row.cost_microusd) < 0) fail();
    used += Number(row.cost_microusd);
    if (!Number.isSafeInteger(used) || used > input.costMicrousd) fail();
  }
  return { input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_microusd: input.costMicrousd - used };
}

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createModel3dOutputContract, MODEL3D_MINI_APP_SETTINGS } from "../../src/model/output-model3d-contract.ts";
import { RODIN_ADAPTER_VERSION, estimateModel3dCostMicrousd, RODIN_IMAGE_MODEL, RODIN_TEXT_MODEL } from "../../src/model/model3d.ts";
import { describeModel3dPreparation } from "../../worker/output-model3d-preparation.ts";
import { readOutputModel3dPayload } from "../../worker/output-model3d-execution.ts";
export const sha = value => createHash("sha256").update(value).digest("hex");
const adapterJson = value => JSON.stringify(value, (_key, entry) => entry && typeof entry === "object" && !Array.isArray(entry)
  ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry);
const source = { draftId: "experience-draft-" + "a".repeat(64), draftHash: "sha256:" + "b".repeat(64), releaseHash: "sha256:" + "c".repeat(64), requestHash: "sha256:" + "d".repeat(64), sourceBindingHash: "sha256:" + "e".repeat(64) };
export async function fixture(kind = null) {
  const bytes = new Uint8Array([137,80,78,71,13,10,26,10]), selected = kind ? { selection: { version: 1, kind, sourceProjectId: "source-project", sourceDocumentId: "source-document", sourceBlockId: "source-block", referenceId: "original-reference", sha256: sha(bytes), permissionAttestation: "i-own-or-have-permission" }, sourceDigest: "f".repeat(64), copiedBlockId: "distinct-copy" } : null;
  const contract = createModel3dOutputContract({ ...source, reference: selected }); assert(contract);
  const prepared = { prompt: "One ceramic kettle · إبريق", settings: MODEL3D_MINI_APP_SETTINGS, model: kind ? RODIN_IMAGE_MODEL : RODIN_TEXT_MODEL,
    estimatedCostMicrousd: estimateModel3dCostMicrousd(MODEL3D_MINI_APP_SETTINGS), references: kind ? [{ bytes, mimeType: "image/png", blockId: "distinct-copy", referenceId: "original-reference", label: "Owned kettle" }] : [], referenceBlockIds: kind ? ["distinct-copy"] : [], adaptation: null };
  const description = await describeModel3dPreparation(contract, prepared);
  const preview = { version: "model3d-mini-app-cost-v1", requestId: "model3d-" + "b".repeat(64), actorUserId: "owner", projectId: "project", documentId: "document", draftId: source.draftId,
    sourceDigest: "c".repeat(64), requirementsDigest: "d".repeat(64), expiresAt: "2099-01-01T00:00:00.000Z", preparationDigest: description.preparationDigest,
    maximumMicrousd: description.maximumMicrousd, maximumCalls: 1, maximumTokens: 1, model: prepared.model,
    sourceFilesTransferred: kind ? 1 : 0, sourceKind: kind, referenceSha256: kind ? sha(bytes) : null, referenceBytes: kind ? bytes.byteLength : 0, referenceMimeType: kind ? "image/png" : null };
  const payload = { productionMode: "manual", artifactKind: "model3d", itemCount: 1, outputModel3d: contract, model3dPreparation: description, model3dCostPreview: preview,
    model3dPrompt: prepared.prompt, model3dPromptSource: "document", model3dAdaptation: null, model3dSettings: prepared.settings, model3dReferenceBlockIds: prepared.referenceBlockIds };
  const referenceInputs = description.references.map((entry, index) => ({ index, ...entry, label: "Owned kettle" }));
  const receipt = { provider: "fal", model: prepared.model, adapterVersion: RODIN_ADAPTER_VERSION, submittedPrompt: prepared.prompt, settings: prepared.settings,
    parameters: description.parameters, acceptedFields: description.acceptedFields, referenceInputs, usedReferencePixels: Boolean(kind), estimatedCostMicrousd: description.maximumMicrousd,
    requestDigest: sha(adapterJson({ model: prepared.model, parameters: description.parameters, referenceInputs })) };
  return { payload, receipt, preview, offer: await readOutputModel3dPayload(payload) };
}
// New tiny synthetic GLB, not a retained/user/provider fixture. One triangle is
// enough to exercise structural qualification; it proves no model quality.
export function glb(extra = {}) {
  const binary = Buffer.alloc(36); new Float32Array(binary.buffer, binary.byteOffset, 9).set([0,0,0,1,0,0,0,1,0]);
  const json = Buffer.from(JSON.stringify({ asset: { version: "2.0" }, buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0,0,0], max: [1,1,0] }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0, ...extra }));
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32); json.copy(padded);
  const header = Buffer.alloc(20); header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + padded.length + binary.length, 8); header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(binary.length); binHeader.writeUInt32LE(0x004e4942, 4);
  return new Uint8Array(Buffer.concat([header, padded, binHeader, binary]));
}

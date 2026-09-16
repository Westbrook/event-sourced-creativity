import { MAX_MODEL3D_UPLOAD_BYTES, MODEL3D_MIME_TYPE, validateModel3dAsset } from "./model3d-assets.ts";

/** Structural qualification only: not object-count, rights, source, or delivery authority. */
export const MODEL3D_STATIC_POLICY = "model3d-static-rooted-assembly-v1" as const;
export type StaticModel3dRefusal =
  | "invalid_bytes" | "invalid_glb" | "animations" | "skins" | "morph_targets"
  | "instancing" | "unsupported_extension" | "scene_assembly" | "digest_unavailable";
export type StaticModel3dQualification =
  | Readonly<{ status: "unqualified"; policy: typeof MODEL3D_STATIC_POLICY; reason: StaticModel3dRefusal }>
  | Readonly<{
    status: "qualified";
    policy: typeof MODEL3D_STATIC_POLICY;
    sha256: string;
    byteLength: number;
    sceneIndex: 0;
    rootNodeIndex: number;
    nodeCount: number;
    meshNodeCount: number;
    meshDefinitionCount: number;
    primitiveDefinitionCount: number;
    materialDefinitionCount: number;
    semanticObjectCount: "unverified";
  }>;

// Known static rendering extensions only. Unknown optional extensions can carry
// behavior too; the general app still accepts its existing wider asset policy.
const STATIC_EXTENSIONS = new Set([
  "KHR_lights_punctual", "KHR_materials_unlit", "KHR_materials_clearcoat", "KHR_materials_sheen",
  "KHR_materials_transmission", "KHR_materials_volume", "KHR_materials_ior", "KHR_materials_specular",
  "KHR_materials_iridescence", "KHR_materials_anisotropy", "KHR_materials_emissive_strength",
  "KHR_mesh_quantization", "KHR_texture_transform", "EXT_texture_webp",
]);
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")!.get!;
const typedBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")!.get!;
const typedOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset")!.get!;
const bufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
const bufferResizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable")?.get;
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** Capture native bytes once, before any await; never call supplied iterators/getters. */
export function captureModel3dAssetBytes(input: unknown, ownership: "copy" | "transfer" = "copy"): Uint8Array<ArrayBuffer> | null {
  try {
    if (input === null || typeof input !== "object") return null;
    let length: number;
    if (Object.getPrototypeOf(input) === Uint8Array.prototype) {
      length = typedLength.call(input);
      // Reject shared backing memory: its contents can race even a synchronous copy.
      const buffer = typedBuffer.call(input) as ArrayBuffer;
      const backingLength = bufferLength.call(buffer);
      if (!length || length > MAX_MODEL3D_UPLOAD_BYTES) return null;
      if (ownership === "transfer") {
        if (Object.getPrototypeOf(buffer) !== ArrayBuffer.prototype || backingLength > MAX_MODEL3D_UPLOAD_BYTES || bufferResizable?.call(buffer)) return null;
        const offset = typedOffset.call(input);
        return new Uint8Array(structuredClone(buffer, { transfer: [buffer] }), offset, length);
      }
      return new Uint8Array(input as Uint8Array);
    }
    if (Object.getPrototypeOf(input) !== ArrayBuffer.prototype) return null;
    length = bufferLength.call(input);
    if (!length || length > MAX_MODEL3D_UPLOAD_BYTES) return null;
    if (ownership === "transfer") {
      if (bufferResizable?.call(input)) return null;
      return new Uint8Array(structuredClone(input as ArrayBuffer, { transfer: [input as ArrayBuffer] }));
    }
    return new Uint8Array(new Uint8Array(input as ArrayBuffer));
  } catch { return null; }
}

function extensionRefusal(model: Record<string, unknown>): StaticModel3dRefusal | null {
  const names: string[] = [];
  for (const field of ["extensionsUsed", "extensionsRequired"]) {
    if (Array.isArray(model[field])) for (const name of model[field] as string[]) names.push(name);
  }
  const pending: unknown[] = [model];
  while (pending.length) {
    const value = pending.pop();
    if (Array.isArray(value)) { for (const child of value) pending.push(child); continue; }
    const object = record(value);
    if (!object) continue;
    for (const [key, child] of Object.entries(object)) {
      if (key === "extras") continue; // App-specific metadata is not a glTF rendering extension.
      if (key === "extensions") {
        const extensions = record(child);
        if (!extensions) return "unsupported_extension";
        for (const name of Object.keys(extensions)) names.push(name);
      }
      pending.push(child);
    }
  }
  if (names.includes("EXT_mesh_gpu_instancing")) return "instancing";
  return names.some(name => !STATIC_EXTENSIONS.has(name)) ? "unsupported_extension" : null;
}

/**
 * Mini-app-only qualifier. Call on authoritative, exact retained GLB bytes, then
 * compare the returned hash with that caller-owned file identity. No URL, owned
 * reference, provider receipt, or approval metadata is accepted in place of bytes.
 * One rooted assembly may contain several objects, meshes, primitives or materials;
 * semantic "one object" and visual quality still require separate review.
 */
export async function qualifyStaticModel3dAsset(
  input: Uint8Array | ArrayBuffer,
  mimeType: unknown = MODEL3D_MIME_TYPE,
): Promise<StaticModel3dQualification> {
  return qualifyOwnedStaticModel3dAsset(captureModel3dAssetBytes(input), mimeType);
}

/** Consumes the native backing buffer before any await. Only its private view
 * survives; all caller aliases are detached. No mutable-view bypass exists.
 * Qualification and custody digest describe the same exact bounded bytes. */
export async function inspectTransferredStaticModel3dAsset(input: Uint8Array, mimeType: unknown) {
  const bytes = captureModel3dAssetBytes(input, "transfer");
  if (!bytes) return null;
  const byteLength = bytes.byteLength;
  const qualification = await qualifyOwnedStaticModel3dAsset(bytes, mimeType);
  const sha256 = qualification.status === "qualified" ? qualification.sha256
    : Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
  return Object.freeze({ qualification, sha256, byteLength });
}

async function qualifyOwnedStaticModel3dAsset(bytes: Uint8Array<ArrayBuffer> | null, mimeType: unknown): Promise<StaticModel3dQualification> {
  const refuse = (reason: StaticModel3dRefusal): StaticModel3dQualification =>
    Object.freeze({ status: "unqualified", policy: MODEL3D_STATIC_POLICY, reason });
  if (!bytes) return refuse("invalid_bytes");
  if (typeof mimeType !== "string") return refuse("invalid_glb");
  let model: Record<string, unknown>;
  try { model = validateModel3dAsset(bytes, mimeType).json; }
  catch { return refuse("invalid_glb"); }
  // The general validator supplies bounded, JSON-parsed arrays and acyclic node trees.
  const objects = (key: string) => (model[key] ?? []) as Record<string, unknown>[];
  const nodes = objects("nodes"), meshes = objects("meshes"), scenes = objects("scenes");
  if (objects("animations").length) return refuse("animations");
  if (objects("skins").length || nodes.some(node => node.skin !== undefined)) return refuse("skins");
  for (const mesh of meshes) {
    if (mesh.weights !== undefined) return refuse("morph_targets");
    for (const primitive of mesh.primitives as Record<string, unknown>[]) {
      if (primitive.targets !== undefined) return refuse("morph_targets");
      if (Object.keys(primitive.attributes as Record<string, unknown>).some(key => /^(?:JOINTS|WEIGHTS)_[0-9]+$/.test(key))) return refuse("skins");
    }
  }
  if (nodes.some(node => node.weights !== undefined)) return refuse("morph_targets");
  const unsupported = extensionRefusal(model);
  if (unsupported) return refuse(unsupported);
  if (scenes.length !== 1 || (model.scene !== undefined && model.scene !== 0)) return refuse("scene_assembly");
  const roots = scenes[0]!.nodes as number[] | undefined;
  if (!roots || roots.length !== 1) return refuse("scene_assembly");
  const rootNodeIndex = roots[0]!;
  const seen = new Set<number>(), usedMeshes = new Set<number>(), pending = [rootNodeIndex];
  let meshNodeCount = 0;
  while (pending.length) {
    const index = pending.pop()!;
    if (seen.has(index)) return refuse("scene_assembly");
    seen.add(index);
    const node = nodes[index]!;
    if (node.mesh !== undefined) { meshNodeCount++; usedMeshes.add(node.mesh as number); }
    for (const child of (node.children ?? []) as number[]) pending.push(child);
  }
  // No hidden, unselected second scene or detached geometry is part of this qualification.
  if (!meshNodeCount || seen.size !== nodes.length || usedMeshes.size !== meshes.length) return refuse("scene_assembly");
  let sha256: string;
  try {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    sha256 = Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
  } catch { return refuse("digest_unavailable"); }
  return Object.freeze({
    status: "qualified", policy: MODEL3D_STATIC_POLICY, sha256, byteLength: bytes.byteLength,
    sceneIndex: 0, rootNodeIndex, nodeCount: nodes.length, meshNodeCount,
    meshDefinitionCount: meshes.length,
    primitiveDefinitionCount: meshes.reduce((sum, mesh) => sum + (mesh.primitives as unknown[]).length, 0),
    materialDefinitionCount: objects("materials").length,
    semanticObjectCount: "unverified",
  });
}

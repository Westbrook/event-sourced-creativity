import { MAX_MODEL3D_UPLOAD_BYTES, MODEL3D_MIME_TYPE, validateModel3dAsset } from "./model3d-assets.ts";
import { qualifyStaticModel3dAsset, MODEL3D_STATIC_POLICY } from "./model3d-static-policy.ts";

/** Exact-byte metadata qualification only; never custody or publication authority. */
export const SELECTED_OUTPUT_SHARE_MODEL3D_POLICY = "selected-output-share-glb-untextured-v1" as const;
export const SELECTED_OUTPUT_SHARE_MODEL3D_LIMITS = Object.freeze({ bytes: MAX_MODEL3D_UPLOAD_BYTES });
export type SelectedOutputShareModel3dExpected = Readonly<{ sha256: string; byteLength: number }>;
export type SelectedOutputShareModel3dRefusal = "invalid_input" | "invalid_glb" | "unqualified_metadata"
  | "unsupported_geometry" | "unreferenced_data" | "unsupported_static_preview" | "selection_mismatch";
declare const modelQualification: unique symbol;
export type QualifiedSelectedOutputShareModel3d = Readonly<{
  [modelQualification]: true;
  status: "qualified";
  policy: typeof SELECTED_OUTPUT_SHARE_MODEL3D_POLICY;
  staticPolicy: typeof MODEL3D_STATIC_POLICY;
  mimeType: typeof MODEL3D_MIME_TYPE;
  sha256: string;
  byteLength: number;
}>;
export type SelectedOutputShareModel3dQualification = QualifiedSelectedOutputShareModel3d
  | Readonly<{ status: "unqualified"; policy: typeof SELECTED_OUTPUT_SHARE_MODEL3D_POLICY; reason: SelectedOutputShareModel3dRefusal }>;

type RecordValue = Record<string, unknown>;
const ownedModels = new WeakMap<QualifiedSelectedOutputShareModel3d, Uint8Array<ArrayBuffer>>();
const typedPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedLength = Object.getOwnPropertyDescriptor(typedPrototype, "byteLength")!.get!;
const typedBuffer = Object.getOwnPropertyDescriptor(typedPrototype, "buffer")!.get!;
const bufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
const setBytes = Uint8Array.prototype.set;
const object = (value: unknown): value is RecordValue => value !== null && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const scalar = (value: unknown, minimum = 0, maximum = 1) => typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
const vector = (value: unknown, length: number) => Array.isArray(value) && value.length === length && value.every(n => scalar(n));
const unit = (values: number[]) => Math.abs(values.reduce((sum, value) => sum + value * value, 0) - 1) <= 0.00001;
const closed = (value: unknown, keys: string[]): value is RecordValue => object(value) && Object.keys(value).every(key => keys.includes(key));

function expectedFacts(value: unknown): SelectedOutputShareModel3dExpected | null {
  if (!object(value) || Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || keys.some(key => key !== "sha256" && key !== "byteLength")) return null;
  const hash = Object.getOwnPropertyDescriptor(value, "sha256"), length = Object.getOwnPropertyDescriptor(value, "byteLength");
  if (!hash?.enumerable || !length?.enumerable || !Object.hasOwn(hash, "value") || !Object.hasOwn(length, "value")
    || typeof hash.value !== "string" || !/^[a-f0-9]{64}$/u.test(hash.value)
    || !integer(length.value) || length.value < 1 || length.value > SELECTED_OUTPUT_SHARE_MODEL3D_LIMITS.bytes) return null;
  return Object.freeze({ sha256: hash.value, byteLength: length.value });
}

function captureBytes(value: unknown): Uint8Array<ArrayBuffer> | null {
  if (!object(value) || Object.getPrototypeOf(value) !== Uint8Array.prototype) return null;
  const length = typedLength.call(value) as number;
  bufferLength.call(typedBuffer.call(value)); // Intrinsics reject shared memory and proxy impostors.
  if (!length || length > SELECTED_OUTPUT_SHARE_MODEL3D_LIMITS.bytes) return null;
  const copy = new Uint8Array(length);
  setBytes.call(copy, value as unknown as Uint8Array);
  return copy;
}

/** The native validator has already bounded and validated geometry/references.
 * This narrower policy closes every JSON object and requires complete use of
 * packed, untextured render data. It never edits or normalizes the supplied GLB. */
function publicModel(model: RecordValue, bytes: Uint8Array): SelectedOutputShareModel3dRefusal | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true), binStart = 28 + jsonLength;
  // Canonical compact JSON plus only required GLB space padding: duplicate keys,
  // escaped hidden text and ignored whitespace payloads cannot disappear in parse.
  const canonical = new TextEncoder().encode(JSON.stringify(model));
  if (jsonLength !== Math.ceil(canonical.length / 4) * 4 || !canonical.every((byte, index) => bytes[20 + index] === byte)
    || bytes.subarray(20 + canonical.length, 20 + jsonLength).some(byte => byte !== 32)) return "unqualified_metadata";
  if (!closed(model, ["asset", "scene", "scenes", "nodes", "meshes", "materials", "buffers", "bufferViews", "accessors"])
    || !closed(model.asset, ["version"]) || model.asset.version !== "2.0") return "unqualified_metadata";
  const records = (key: string) => (model[key] ?? []) as RecordValue[];
  const scenes = records("scenes"), nodes = records("nodes"), meshes = records("meshes"), materials = records("materials");
  const buffers = records("buffers"), views = records("bufferViews"), accessors = records("accessors");
  if (scenes.some(scene => !closed(scene, ["nodes"]))
    || nodes.some(node => !closed(node, ["children", "mesh", "translation", "rotation", "scale"]))
    || meshes.some(mesh => !closed(mesh, ["primitives"]))
    || buffers.some(buffer => !closed(buffer, ["byteLength"]))
    || views.some(bufferView => !closed(bufferView, ["buffer", "byteOffset", "byteLength", "target"]))
    || accessors.some(accessor => !closed(accessor, ["bufferView", "byteOffset", "componentType", "count", "type", "min", "max"]))) return "unqualified_metadata";
  for (const node of nodes) {
    // Matrix decomposition can silently discard non-affine/shear payloads. This
    // first subset permits explicit TRS only, with a valid unit quaternion.
    if (node.rotation !== undefined && !unit(node.rotation as number[])) return "unsupported_geometry";
    if (node.mesh === undefined && !(node.children as number[] | undefined)?.length) return "unreferenced_data";
  }
  for (const material of materials) {
    if (!closed(material, ["pbrMetallicRoughness", "emissiveFactor", "doubleSided", "alphaMode", "alphaCutoff"])) return "unqualified_metadata";
    if (material.emissiveFactor !== undefined && !vector(material.emissiveFactor, 3)
      || material.doubleSided !== undefined && typeof material.doubleSided !== "boolean"
      || material.alphaMode !== undefined && !["OPAQUE", "MASK", "BLEND"].includes(material.alphaMode as string)
      || material.alphaCutoff !== undefined && (material.alphaMode !== "MASK" || !scalar(material.alphaCutoff))) return "unsupported_geometry";
    if (material.pbrMetallicRoughness !== undefined) {
      const pbr = material.pbrMetallicRoughness;
      if (!closed(pbr, ["baseColorFactor", "metallicFactor", "roughnessFactor"])) return "unqualified_metadata";
      if (pbr.baseColorFactor !== undefined && !vector(pbr.baseColorFactor, 4)
        || pbr.metallicFactor !== undefined && !scalar(pbr.metallicFactor)
        || pbr.roughnessFactor !== undefined && !scalar(pbr.roughnessFactor)) return "unsupported_geometry";
    }
  }
  const usedAccessors = new Set<number>(), usedMaterials = new Set<number>(), positions = new Set<number>();
  const bin = new DataView(bytes.buffer, bytes.byteOffset + binStart, bytes.byteLength - binStart);
  for (const mesh of meshes) for (const primitive of mesh.primitives as RecordValue[]) {
    if (!closed(primitive, ["attributes", "indices", "material", "mode"])
      || !closed(primitive.attributes, ["POSITION", "NORMAL", "COLOR_0"])) return "unqualified_metadata";
    if (primitive.mode !== undefined && primitive.mode !== 4) return "unsupported_geometry";
    const attributes = primitive.attributes;
    for (const index of Object.values(attributes) as number[]) usedAccessors.add(index);
    positions.add(attributes.POSITION as number);
    for (const index of Object.values(attributes) as number[]) if (accessors[index]!.componentType !== 5126) return "unsupported_geometry";
    for (const semantic of ["NORMAL", "COLOR_0"] as const) {
      if (attributes[semantic] === undefined) continue;
      const accessor = accessors[attributes[semantic] as number]!, bufferView = views[accessor.bufferView as number];
      if (!bufferView) return "unsupported_geometry";
      const components = accessor.type === "VEC4" ? 4 : 3;
      const at = Number(bufferView.byteOffset ?? 0) + Number(accessor.byteOffset ?? 0);
      for (let vertex = 0; vertex < Number(accessor.count); vertex++) {
        const values = Array.from({ length: components }, (_, component) => bin.getFloat32(at + (vertex * components + component) * 4, true));
        if (semantic === "NORMAL" ? !unit(values) : !values.every(value => scalar(value))) return "unsupported_geometry";
      }
    }
    if (primitive.material !== undefined) usedMaterials.add(primitive.material as number);
    if (primitive.indices !== undefined) {
      const index = primitive.indices as number, accessor = accessors[index]!, bufferView = views[accessor.bufferView as number]!;
      usedAccessors.add(index);
      if (![5121, 5123, 5125].includes(accessor.componentType as number)) return "unsupported_geometry";
      const width = accessor.componentType === 5121 ? 1 : accessor.componentType === 5123 ? 2 : 4;
      const at = Number(bufferView.byteOffset ?? 0) + Number(accessor.byteOffset ?? 0);
      const seen = new Uint8Array(accessors[attributes.POSITION as number]!.count as number);
      for (let element = 0; element < Number(accessor.count); element++) {
        const offset = at + element * width;
        const vertex = width === 1 ? bin.getUint8(offset) : width === 2 ? bin.getUint16(offset, true) : bin.getUint32(offset, true);
        seen[vertex] = 1;
      }
      // This first subset requires each indexed primitive to use every supplied
      // vertex. Disjoint index sets sharing a larger vertex pool remain unsupported.
      if (seen.some(value => value === 0)) return "unreferenced_data";
    }
  }
  if (usedAccessors.size !== accessors.length || usedMaterials.size !== materials.length) return "unreferenced_data";
  const usedViews = new Set<number>();
  for (let index = 0; index < accessors.length; index++) {
    const accessor = accessors[index]!, bufferView = views[accessor.bufferView as number];
    const components = ({ SCALAR: 1, VEC3: 3, VEC4: 4 } as Record<string, number>)[accessor.type as string];
    const width = ({ 5121: 1, 5123: 2, 5125: 4, 5126: 4 } as Record<number, number>)[accessor.componentType as number];
    if (!bufferView || !components || !width || Number(accessor.byteOffset ?? 0) !== 0
      || Number(bufferView.byteLength) !== Number(accessor.count) * width * components) return "unsupported_geometry";
    if (usedViews.has(accessor.bufferView as number)) return "unsupported_geometry";
    usedViews.add(accessor.bufferView as number);
    if (!positions.has(index) && (accessor.min !== undefined || accessor.max !== undefined)) return "unqualified_metadata";
    if (positions.has(index)) {
      const minimum = [Infinity, Infinity, Infinity], maximum = [-Infinity, -Infinity, -Infinity];
      for (let vertex = 0; vertex < Number(accessor.count); vertex++) for (let component = 0; component < 3; component++) {
        const value = bin.getFloat32(Number(bufferView.byteOffset ?? 0) + vertex * 12 + component * 4, true);
        minimum[component] = Math.min(minimum[component]!, value); maximum[component] = Math.max(maximum[component]!, value);
      }
      if (!minimum.every((value, component) => value === (accessor.min as number[])[component])
        || !maximum.every((value, component) => value === (accessor.max as number[])[component])) return "unsupported_geometry";
    }
  }
  if (buffers.length !== 1 || usedViews.size !== views.length) return "unreferenced_data";
  let end = 0;
  for (const bufferView of [...views].sort((a, b) => Number(a.byteOffset ?? 0) - Number(b.byteOffset ?? 0))) {
    const start = Number(bufferView.byteOffset ?? 0);
    // Only exact zero alignment padding is permitted between fully used views.
    if (start !== Math.ceil(end / 4) * 4) return "unreferenced_data";
    for (let at = end; at < start; at++) if (bin.getUint8(at) !== 0) return "unreferenced_data";
    end = start + Number(bufferView.byteLength);
  }
  return end === buffers[0]!.byteLength ? null : "unreferenced_data";
}

/** Qualify one exact, compact, untextured static GLB. No URI, image, extension,
 * arbitrary JSON metadata or unused binary payload is supported. Visible content,
 * numerical steganography, artistic quality, rights and sharing consent still
 * require separate review. No bytes are rewritten and no provider is called. */
export async function qualifySelectedOutputShareModel3d(input: unknown, expected: unknown): Promise<SelectedOutputShareModel3dQualification> {
  const refused = (reason: SelectedOutputShareModel3dRefusal): SelectedOutputShareModel3dQualification =>
    Object.freeze({ status: "unqualified", policy: SELECTED_OUTPUT_SHARE_MODEL3D_POLICY, reason });
  let bytes: Uint8Array<ArrayBuffer> | null = null, retained = false;
  try {
    const facts = expectedFacts(expected);
    if (!facts) return refused("invalid_input");
    bytes = captureBytes(input);
    if (!bytes) return refused("invalid_input");
    if (bytes.length !== facts.byteLength) return refused("selection_mismatch");
    let model: RecordValue;
    try { model = validateModel3dAsset(bytes, MODEL3D_MIME_TYPE).json; }
    catch { return refused("invalid_glb"); }
    const failure = publicModel(model, bytes);
    if (failure) return refused(failure);
    const inspection = await qualifyStaticModel3dAsset(bytes, MODEL3D_MIME_TYPE);
    if (inspection.status !== "qualified") return refused("unsupported_static_preview");
    if (inspection.sha256 !== facts.sha256 || inspection.byteLength !== facts.byteLength) return refused("selection_mismatch");
    const result = Object.freeze({ status: "qualified", policy: SELECTED_OUTPUT_SHARE_MODEL3D_POLICY,
      staticPolicy: MODEL3D_STATIC_POLICY, mimeType: MODEL3D_MIME_TYPE, ...facts }) as QualifiedSelectedOutputShareModel3d;
    ownedModels.set(result, bytes); retained = true;
    return result;
  } catch { return refused("invalid_input"); }
  finally { if (!retained) bytes?.fill(0); }
}

/** A fresh copy only for the exact local opaque result, never serialized facts.
 * Receiving bytes does not establish current custody or permission to publish. */
export function copySelectedOutputShareModel3dBytes(qualification: unknown): Uint8Array<ArrayBuffer> | null {
  if (!object(qualification)) return null;
  const bytes = ownedModels.get(qualification as QualifiedSelectedOutputShareModel3d);
  return bytes ? new Uint8Array(bytes) : null;
}

import { MAX_MODEL3D_JSON_BYTES, MAX_MODEL3D_UPLOAD_BYTES, MODEL3D_MIME_TYPE, validateModel3dAsset } from "./model3d-assets.ts";
import { copySelectedOutputShareModel3dBytes, qualifySelectedOutputShareModel3d, qualifySelectedOutputShareTexturedModel3d,
  type QualifiedSelectedOutputShareModel3d, type QualifiedSelectedOutputShareTexturedModel3d,
  type SelectedOutputShareModel3dExpected, type SelectedOutputShareModel3dRefusal } from "./selected-output-share-model3d.ts";

/** A share-copy representation only. It establishes neither current custody nor
 * permission to disclose the selected artwork or publish to any audience. */
export const SELECTED_OUTPUT_SHARE_MODEL3D_PROJECTION_POLICY = "selected-output-share-glb-current-view-v1" as const;
export const SELECTED_OUTPUT_SHARE_MODEL3D_PROJECTION_LIMITS = Object.freeze({ sourceBytes: MAX_MODEL3D_UPLOAD_BYTES,
  publicBytes: MAX_MODEL3D_UPLOAD_BYTES, jsonBytes: MAX_MODEL3D_JSON_BYTES });
type ByteQualification = QualifiedSelectedOutputShareModel3d | QualifiedSelectedOutputShareTexturedModel3d;
declare const projectionBrand: unique symbol;
export type ProjectedSelectedOutputShareModel3d = Readonly<{
  [projectionBrand]: true;
  status: "qualified";
  policy: typeof SELECTED_OUTPUT_SHARE_MODEL3D_PROJECTION_POLICY;
  source: SelectedOutputShareModel3dExpected;
  public: Readonly<{ sha256: string; byteLength: number; mimeType: typeof MODEL3D_MIME_TYPE;
    qualificationPolicy: ByteQualification["policy"]; staticPolicy: ByteQualification["staticPolicy"];
    texturePolicy?: QualifiedSelectedOutputShareTexturedModel3d["texturePolicy"] }>;
}>;
export type SelectedOutputShareModel3dProjection = ProjectedSelectedOutputShareModel3d | Readonly<{
  status: "unqualified"; policy: typeof SELECTED_OUTPUT_SHARE_MODEL3D_PROJECTION_POLICY; reason: SelectedOutputShareModel3dRefusal;
}>;

type RecordValue = Record<string, unknown>;
const ownedProjections = new WeakMap<object, ByteQualification>();
const object = (value: unknown): value is RecordValue => value !== null && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const closed = (value: unknown, keys: string[]): value is RecordValue => object(value) && Object.keys(value).every(key => keys.includes(key));
const typedPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedLength = Object.getOwnPropertyDescriptor(typedPrototype, "byteLength")!.get!;
const typedBuffer = Object.getOwnPropertyDescriptor(typedPrototype, "buffer")!.get!;
const bufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
const setBytes = Uint8Array.prototype.set;
const aligned = (length: number) => Math.ceil(length / 4) * 4;

function expectedFacts(value: unknown): SelectedOutputShareModel3dExpected | null {
  if (!object(value) || Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || keys.some(key => key !== "sha256" && key !== "byteLength")) return null;
  const hash = Object.getOwnPropertyDescriptor(value, "sha256"), length = Object.getOwnPropertyDescriptor(value, "byteLength");
  if (!hash?.enumerable || !length?.enumerable || !Object.hasOwn(hash, "value") || !Object.hasOwn(length, "value")
    || typeof hash.value !== "string" || !/^[a-f0-9]{64}$/u.test(hash.value)
    || !integer(length.value) || length.value < 1 || length.value > MAX_MODEL3D_UPLOAD_BYTES) return null;
  return Object.freeze({ sha256: hash.value, byteLength: length.value });
}

function captureBytes(value: unknown): Uint8Array<ArrayBuffer> | null {
  if (!object(value) || Object.getPrototypeOf(value) !== Uint8Array.prototype) return null;
  const length = typedLength.call(value) as number;
  bufferLength.call(typedBuffer.call(value));
  if (!length || length > MAX_MODEL3D_UPLOAD_BYTES) return null;
  const copy = new Uint8Array(length);
  setBytes.call(copy, value as unknown as Uint8Array);
  return copy;
}

const digest = async (bytes: Uint8Array<ArrayBuffer>) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  byte => byte.toString(16).padStart(2, "0")).join("");
class ProjectionRefusal extends Error {
  readonly reason: SelectedOutputShareModel3dRefusal;
  constructor(reason: SelectedOutputShareModel3dRefusal) { super(reason); this.reason = reason; }
}
const refuse = (reason: SelectedOutputShareModel3dRefusal): never => { throw new ProjectionRefusal(reason); };

/** All omitted source ranges must be complete, closed stale POSITION-shaped
 * streams. No metadata, unowned view, interleaving hole or opaque tail is pruned.
 * Preserved JSON remains subject to the unchanged final byte qualifier. */
function repack(bytes: Uint8Array<ArrayBuffer>, model: RecordValue): Uint8Array<ArrayBuffer> {
  const input = new DataView(bytes.buffer), jsonLength = input.getUint32(12, true), binStart = 28 + jsonLength;
  const canonical = new TextEncoder().encode(JSON.stringify(model));
  if (jsonLength !== aligned(canonical.length) || !canonical.every((byte, index) => bytes[20 + index] === byte)
    || bytes.subarray(20 + canonical.length, 20 + jsonLength).some(byte => byte !== 32)) refuse("unqualified_metadata");
  const records = (key: string) => (model[key] ?? []) as RecordValue[];
  const buffers = records("buffers"), views = records("bufferViews"), accessors = records("accessors"), images = records("images");
  if (buffers.length !== 1 || !closed(buffers[0], ["byteLength"]) || binStart > bytes.length) refuse("unsupported_geometry");
  if (views.some(view => !closed(view, ["buffer", "byteOffset", "byteLength", "target"]))
    || accessors.some(accessor => !closed(accessor, ["bufferView", "byteOffset", "componentType", "count", "type", "min", "max"]))) refuse("unqualified_metadata");
  // The native validator established references and finite array limits. Only
  // mesh attribute/index references can keep an accessor in this closed subset.
  const active = new Set<number>();
  for (const mesh of records("meshes")) for (const primitive of mesh.primitives as RecordValue[]) {
    for (const index of Object.values(primitive.attributes as RecordValue)) active.add(index as number);
    if (primitive.indices !== undefined) active.add(primitive.indices as number);
  }
  const ownedViews = new Set<number>(), retainedViews = new Set<number>();
  const claimView = (index: unknown) => {
    if (!integer(index) || !views[index] || ownedViews.has(index)) refuse("unsupported_geometry");
    ownedViews.add(index as number);
    return views[index as number]!;
  };
  const binary = new DataView(bytes.buffer, binStart, bytes.length - binStart);
  for (let index = 0; index < accessors.length; index++) {
    const accessor = accessors[index]!, view = claimView(accessor.bufferView);
    const components = ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 } as Record<string, number>)[accessor.type as string];
    const width = ({ 5121: 1, 5123: 2, 5125: 4, 5126: 4 } as Record<number, number>)[accessor.componentType as number];
    if (!components || !width || Number(accessor.byteOffset ?? 0) !== 0
      || view.byteLength !== Number(accessor.count) * components * width) refuse("unsupported_geometry");
    if (active.has(index)) { retainedViews.add(accessor.bufferView as number); continue; }
    // Only unused POSITION-shaped streams can be omitted; this does not prove
    // their edit history. Exact byte-derived bounds exclude arbitrary metadata.
    if (accessor.componentType !== 5126 || accessor.type !== "VEC3"
      || !Array.isArray(accessor.min) || !Array.isArray(accessor.max)) refuse("unreferenced_data");
    const minimum = [Infinity, Infinity, Infinity], maximum = [-Infinity, -Infinity, -Infinity];
    for (let vertex = 0; vertex < Number(accessor.count); vertex++) for (let component = 0; component < 3; component++) {
      const value = binary.getFloat32(Number(view.byteOffset ?? 0) + vertex * 12 + component * 4, true);
      if (!Number.isFinite(value)) refuse("unsupported_geometry");
      minimum[component] = Math.min(minimum[component]!, value); maximum[component] = Math.max(maximum[component]!, value);
    }
    if (!minimum.every((value, component) => value === (accessor.min as number[])[component])
      || !maximum.every((value, component) => value === (accessor.max as number[])[component])) refuse("unsupported_geometry");
  }
  for (const image of images) { claimView(image.bufferView); retainedViews.add(image.bufferView as number); }
  if (ownedViews.size !== views.length) refuse("unreferenced_data");
  // Full source accounting prevents normalization of unknown tails or unused
  // bytes inside a declared view. Source append history may use final alignment.
  let end = 0;
  for (const view of [...views].sort((a, b) => Number(a.byteOffset ?? 0) - Number(b.byteOffset ?? 0))) {
    const start = Number(view.byteOffset ?? 0);
    if (start !== aligned(end)) refuse("unreferenced_data");
    for (let at = end; at < start; at++) if (binary.getUint8(at) !== 0) refuse("unreferenced_data");
    end = start + Number(view.byteLength);
  }
  const declaredLength = Number(buffers[0]!.byteLength);
  if (declaredLength !== end && declaredLength !== aligned(end) || binary.byteLength !== aligned(declaredLength)) refuse("unreferenced_data");
  for (let at = end; at < binary.byteLength; at++) if (binary.getUint8(at) !== 0) refuse("unreferenced_data");

  const accessorMap = new Map<number, number>(), viewMap = new Map<number, number>();
  const selectedViews: RecordValue[] = [], ranges: { start: number; length: number; destination: number }[] = [];
  let publicBinLength = 0;
  views.forEach((view, index) => {
    if (!retainedViews.has(index)) return;
    const destination = aligned(publicBinLength), length = Number(view.byteLength);
    viewMap.set(index, selectedViews.length); selectedViews.push({ ...view, byteOffset: destination });
    ranges.push({ start: binStart + Number(view.byteOffset ?? 0), length, destination });
    publicBinLength = destination + length;
  });
  const selectedAccessors: RecordValue[] = [];
  accessors.forEach((accessor, index) => {
    if (!active.has(index)) return;
    accessorMap.set(index, selectedAccessors.length);
    selectedAccessors.push({ ...accessor, bufferView: viewMap.get(accessor.bufferView as number)! });
  });
  for (const mesh of records("meshes")) for (const primitive of mesh.primitives as RecordValue[]) {
    const attributes = primitive.attributes as RecordValue;
    for (const semantic of Object.keys(attributes)) attributes[semantic] = accessorMap.get(attributes[semantic] as number)!;
    if (primitive.indices !== undefined) primitive.indices = accessorMap.get(primitive.indices as number)!;
  }
  for (const image of images) image.bufferView = viewMap.get(image.bufferView as number)!;
  model.accessors = selectedAccessors; model.bufferViews = selectedViews;
  model.buffers = [{ ...buffers[0], byteLength: publicBinLength }];
  const json = new TextEncoder().encode(JSON.stringify(model)), publicJsonLength = aligned(json.length);
  const length = 28 + publicJsonLength + aligned(publicBinLength);
  if (publicJsonLength > MAX_MODEL3D_JSON_BYTES || length > MAX_MODEL3D_UPLOAD_BYTES) refuse("unsupported_geometry");
  const result = new Uint8Array(length), output = new DataView(result.buffer);
  output.setUint32(0, 0x46546c67, true); output.setUint32(4, 2, true); output.setUint32(8, length, true);
  output.setUint32(12, publicJsonLength, true); output.setUint32(16, 0x4e4f534a, true);
  result.fill(32, 20, 20 + publicJsonLength); result.set(json, 20);
  output.setUint32(20 + publicJsonLength, aligned(publicBinLength), true); output.setUint32(24 + publicJsonLength, 0x004e4942, true);
  for (const range of ranges) result.set(bytes.subarray(range.start, range.start + range.length), 28 + publicJsonLength + range.destination);
  return result;
}

/** Produce a deterministic current-view copy from a supported packed GLB. The
 * retained source and public copy have separate identity roles, even if an
 * already compact input happens to produce identical bytes. No source history
 * is fetched. Unknown metadata is refused, not stripped. */
export async function projectSelectedOutputShareModel3d(input: unknown, expected: unknown): Promise<SelectedOutputShareModel3dProjection> {
  const refused = (reason: SelectedOutputShareModel3dRefusal): SelectedOutputShareModel3dProjection =>
    Object.freeze({ status: "unqualified", policy: SELECTED_OUTPUT_SHARE_MODEL3D_PROJECTION_POLICY, reason });
  let source: Uint8Array<ArrayBuffer> | null = null, projected: Uint8Array<ArrayBuffer> | null = null;
  try {
    const facts = expectedFacts(expected);
    if (!facts) return refused("invalid_input");
    source = captureBytes(input);
    if (!source) return refused("invalid_input");
    if (source.length !== facts.byteLength || await digest(source) !== facts.sha256) return refused("selection_mismatch");
    let model: RecordValue;
    try { model = validateModel3dAsset(source, MODEL3D_MIME_TYPE).json; }
    catch { return refused("invalid_glb"); }
    const textured = ["textures", "images", "samplers"].some(key => model[key] !== undefined);
    projected = repack(source, model);
    const publicFacts = { sha256: await digest(projected), byteLength: projected.length };
    const qualified = textured ? await qualifySelectedOutputShareTexturedModel3d(projected, publicFacts)
      : await qualifySelectedOutputShareModel3d(projected, publicFacts);
    if (qualified.status !== "qualified") return refused(qualified.reason);
    const result = Object.freeze({ status: "qualified", policy: SELECTED_OUTPUT_SHARE_MODEL3D_PROJECTION_POLICY, source: facts,
      public: Object.freeze({ ...publicFacts, mimeType: qualified.mimeType, qualificationPolicy: qualified.policy, staticPolicy: qualified.staticPolicy,
        ...("texturePolicy" in qualified ? { texturePolicy: qualified.texturePolicy } : {}) }) }) as ProjectedSelectedOutputShareModel3d;
    ownedProjections.set(result, qualified);
    return result;
  } catch (error) { return refused(error instanceof ProjectionRefusal ? error.reason : "invalid_input"); }
  finally { source?.fill(0); projected?.fill(0); }
}

/** Only the exact local opaque result yields fresh public bytes. Serialized
 * descriptors, clones and proxies are not qualification or custody handles. */
export function copyProjectedSelectedOutputShareModel3dBytes(projection: unknown): Uint8Array<ArrayBuffer> | null {
  if (!object(projection)) return null;
  const qualification = ownedProjections.get(projection);
  return qualification ? copySelectedOutputShareModel3dBytes(qualification) : null;
}

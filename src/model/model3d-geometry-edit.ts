import { MAX_MODEL3D_JSON_BYTES, MAX_MODEL3D_UPLOAD_BYTES, validateModel3dAsset } from "./model3d-assets.ts";

type Vector3 = [number, number, number];
export type Model3dGeometryBounds = { min: Vector3; max: Vector3; size: Vector3 };
export type Model3dGeometryScaleResult = {
  bytes: Uint8Array;
  changed: boolean;
  factor: number;
  beforeBounds: Model3dGeometryBounds;
  afterBounds: Model3dGeometryBounds;
  /** Vertices in unique POSITION accessors, counting a shared accessor once. */
  vertexCount: number;
  positionAccessorCount: number;
};

export class GeometryScaleError extends Error {
  readonly code: "unsupported" | "factor" | "precision";
  constructor(code: "unsupported" | "factor" | "precision", message: string) {
    super(message);
    this.code = code;
    this.name = "GeometryScaleError";
  }
}

type ObjectRecord = Record<string, unknown>;
type PositionPlan = { index: number; start: number; stride: number; count: number; min: Vector3; max: Vector3 };
const identityMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const unsupported: (message: string) => never = (message) => { throw new GeometryScaleError("unsupported", message); };
const precision = (message: string): never => { throw new GeometryScaleError("precision", message); };
const minimum = (): Vector3 => [Infinity, Infinity, Infinity];
const maximum = (): Vector3 => [-Infinity, -Infinity, -Infinity];
const bounds = (min: Vector3, max: Vector3): Model3dGeometryBounds => ({
  min: [...min], max: [...max], size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
});
const expand = (min: Vector3, max: Vector3, axis: number, value: number) => {
  // Signed zero has one geometric bound and one JSON representation.
  const coordinate = value === 0 ? 0 : value;
  min[axis] = Math.min(min[axis]!, coordinate);
  max[axis] = Math.max(max[axis]!, coordinate);
};
const assertExtent = (beforeMin: Vector3, beforeMax: Vector3, afterMin: Vector3, afterMax: Vector3) => {
  if (beforeMin.some((value, axis) => beforeMax[axis]! > value && afterMax[axis] === afterMin[axis])) {
    precision("This factor collapses a nonzero mesh dimension at Float32 precision.");
  }
};

function assertStaticGeometry(model: ObjectRecord) {
  const arrays = (key: string) => (model[key] ?? []) as ObjectRecord[];
  if (arrays("animations").length || arrays("skins").length) {
    unsupported("Uniform scaling currently supports static models without animation or skinning.");
  }
  if ((model.extensionsUsed as unknown[] | undefined)?.length || (model.extensionsRequired as unknown[] | undefined)?.length) {
    unsupported("Uniform scaling currently supports models without active glTF extensions.");
  }
  // The validator bounds this walk. Extras are opaque metadata, not active features.
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "extras") continue;
      if (key === "extensions" && Object.keys(child as ObjectRecord).length) {
        unsupported("Uniform scaling currently supports models without active glTF extensions.");
      }
      visit(child);
    }
  };
  visit(model);
  for (const node of arrays("nodes")) {
    if (node.skin !== undefined || node.weights !== undefined) {
      unsupported("Uniform scaling currently supports models without skinning or morph weights.");
    }
    for (const [key, identity] of [["matrix", identityMatrix], ["translation", [0, 0, 0]], ["rotation", [0, 0, 0, 1]], ["scale", [1, 1, 1]]] as const) {
      const transform = node[key] as number[] | undefined;
      if (transform && (transform.length !== identity.length || transform.some((value, index) => value !== identity[index]))) {
        unsupported("Uniform scaling currently requires identity node transforms.");
      }
    }
  }
  for (const mesh of arrays("meshes")) {
    if (mesh.weights !== undefined || (mesh.primitives as ObjectRecord[]).some(primitive => primitive.targets !== undefined)) {
      unsupported("Uniform scaling currently supports models without morph targets or weights.");
    }
  }
}

/**
 * Bake a positive uniform scale about model origin into static POSITION vertices.
 * New streams preserve aliases and interleaving: every original BIN byte and
 * every non-POSITION reference remains unchanged. This does not edit a camera.
 */
export function scaleModel3dGeometry(input: Uint8Array | ArrayBuffer, factor: number): Model3dGeometryScaleResult {
  const source = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input) : null;
  if (!source || source.byteLength > MAX_MODEL3D_UPLOAD_BYTES) unsupported("Choose a supported GLB smaller than 64 MB.");
  // Own a bounded snapshot before parsing or writing; never change caller bytes.
  const original = new Uint8Array(source);
  let model: ObjectRecord;
  try { model = validateModel3dAsset(original).json; }
  catch (error) { unsupported(error instanceof Error ? error.message : "Choose a valid self-contained GLB model."); }
  if (typeof factor !== "number" || !Number.isFinite(factor) || factor <= 0) {
    throw new GeometryScaleError("factor", "Enter a finite scale factor greater than zero.");
  }
  assertStaticGeometry(model!);
  const buffers = (model!.buffers ?? []) as ObjectRecord[];
  if (buffers.length !== 1 || buffers[0]!.uri !== undefined) {
    unsupported("Uniform scaling requires one embedded BIN buffer, not a data-URI buffer.");
  }
  const framing = new DataView(original.buffer, original.byteOffset, original.byteLength);
  const binHeader = 20 + framing.getUint32(12, true);
  if (binHeader + 8 > original.byteLength || framing.getUint32(binHeader + 4, true) !== 0x004e4942) {
    unsupported("Uniform scaling requires an embedded BIN chunk.");
  }
  const bin = original.subarray(binHeader + 8, binHeader + 8 + framing.getUint32(binHeader, true));
  const data = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const views = model!.bufferViews as ObjectRecord[], accessors = model!.accessors as ObjectRecord[];
  const primitives = (model!.meshes as ObjectRecord[]).flatMap(mesh => mesh.primitives as ObjectRecord[]);
  const ids = new Set(primitives.map(primitive => Number((primitive.attributes as ObjectRecord).POSITION)));
  const plans: PositionPlan[] = [];
  const beforeMin = minimum(), beforeMax = maximum(), afterMin = minimum(), afterMax = maximum();
  let changed = false, vertexCount = 0;
  for (const index of ids) {
    const accessor = accessors[index]!;
    if (accessor.componentType !== 5126 || accessor.type !== "VEC3" || accessor.normalized === true || accessor.bufferView === undefined || accessor.sparse !== undefined) {
      unsupported("Uniform scaling requires materialized, non-normalized Float32 POSITION vertices.");
    }
    const view = views[Number(accessor.bufferView)]!;
    const start = Number(view.byteOffset ?? 0) + Number(accessor.byteOffset ?? 0), stride = Number(view.byteStride ?? 12), count = Number(accessor.count);
    const localBeforeMin = minimum(), localBeforeMax = maximum(), min = minimum(), max = maximum();
    for (let vertex = 0; vertex < count; vertex++) {
      for (let axis = 0; axis < 3; axis++) {
        const value = data.getFloat32(start + vertex * stride + axis * 4, true);
        const scaled = Math.fround(value * factor);
        if (!Number.isFinite(scaled)) precision("This factor exceeds the model's Float32 coordinate range.");
        if (value !== 0 && scaled === 0) precision("This factor reduces a nonzero coordinate below Float32 precision.");
        changed ||= scaled !== value;
        expand(localBeforeMin, localBeforeMax, axis, value); expand(beforeMin, beforeMax, axis, value);
        expand(min, max, axis, scaled); expand(afterMin, afterMax, axis, scaled);
      }
    }
    assertExtent(localBeforeMin, localBeforeMax, min, max);
    plans.push({ index, start, stride, count, min, max });
    vertexCount += count;
  }
  assertExtent(beforeMin, beforeMax, afterMin, afterMax);
  const result = { factor, beforeBounds: bounds(beforeMin, beforeMax), afterBounds: bounds(afterMin, afterMax), vertexCount, positionAccessorCount: ids.size };
  if (!changed) return { ...result, bytes: original, changed: false };

  // Keep the complete original BIN prefix, including original alignment padding.
  let binLength = bin.byteLength;
  const replacements = new Map<number, number>();
  for (const plan of plans) {
    const byteLength = plan.count * 12, bufferView = views.length;
    views.push({ buffer: 0, byteOffset: binLength, byteLength, target: 34962 });
    replacements.set(plan.index, accessors.length);
    accessors.push({ ...accessors[plan.index], bufferView, byteOffset: 0, min: [...plan.min], max: [...plan.max] });
    binLength += byteLength;
  }
  for (const primitive of primitives) {
    const attributes = primitive.attributes as ObjectRecord;
    attributes.POSITION = replacements.get(Number(attributes.POSITION))!;
  }
  buffers[0]!.byteLength = binLength;
  const json = new TextEncoder().encode(JSON.stringify(model!)), jsonLength = Math.ceil(json.byteLength / 4) * 4;
  const byteLength = 12 + 8 + jsonLength + 8 + binLength;
  if (jsonLength > MAX_MODEL3D_JSON_BYTES || byteLength > MAX_MODEL3D_UPLOAD_BYTES) {
    unsupported("The scaled model exceeds the supported GLB file or metadata size.");
  }
  const bytes = new Uint8Array(byteLength), output = new DataView(bytes.buffer);
  output.setUint32(0, 0x46546c67, true); output.setUint32(4, 2, true); output.setUint32(8, byteLength, true);
  output.setUint32(12, jsonLength, true); output.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20, 20 + jsonLength); bytes.set(json, 20);
  const outputBinHeader = 20 + jsonLength, outputBinStart = outputBinHeader + 8;
  output.setUint32(outputBinHeader, binLength, true); output.setUint32(outputBinHeader + 4, 0x004e4942, true);
  bytes.set(bin, outputBinStart);
  let destination = outputBinStart + bin.byteLength;
  for (const plan of plans) {
    for (let vertex = 0; vertex < plan.count; vertex++) {
      for (let axis = 0; axis < 3; axis++) {
        output.setFloat32(destination, Math.fround(data.getFloat32(plan.start + vertex * plan.stride + axis * 4, true) * factor), true);
        destination += 4;
      }
    }
  }
  try { validateModel3dAsset(bytes); }
  catch (error) { unsupported(error instanceof Error ? error.message : "The scaled model exceeds supported geometry limits."); }
  return { ...result, bytes, changed: true };
}

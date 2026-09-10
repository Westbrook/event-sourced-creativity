import { MAX_MODEL3D_UPLOAD_BYTES } from "./model3d-assets.ts";
import type { Model3dGeometryBounds } from "./model3d-geometry-edit.ts";
import type { NativeRetainedModel3dFile } from "./native-retained-model3d.ts";

/** Stored authored geometry metadata. Its enclosing edit and source must be independently witnessed. */
export type Model3dMediaRevision = {
  schemaVersion: 1;
  operation: "uniform-scale";
  media: { url: string; mediaType: "model/gltf-binary"; sha256: string; byteLength: number; fileName: string };
  source: { url: string; sha256: string; byteLength: number; revision: number; contentSha256: string };
  factor: number;
  beforeBounds: Model3dGeometryBounds;
  afterBounds: Model3dGeometryBounds;
  vertexCount: number;
  positionAccessorCount: number;
};

export type Model3dScaleEditCode = "saved" | "unchanged" | "source_changed" | "invalid_scale" | "unsupported" | "unavailable" | "access_denied" | "unconfirmed" | "retired";
export type Model3dScaleEditResult =
  | { status: "saved"; code: "saved"; revision: number; contentSha256: string; model3dRevision: Model3dMediaRevision }
  | { status: "unchanged"; code: "unchanged" }
  | { status: "conflict"; code: "source_changed" }
  | { status: "refused"; code: "invalid_scale" | "unsupported" | "unavailable" | "access_denied" }
  | { status: "unconfirmed"; code: "unconfirmed" }
  | { status: "retired"; code: "retired" };

function closed(value: unknown, names: readonly string[]): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value), keys = Reflect.ownKeys(value);
  if (prototype !== Object.prototype && prototype !== null || keys.length !== names.length
    || keys.some(key => typeof key !== "string" || !names.includes(key))) return null;
  const result: Record<string, unknown> = {};
  for (const key of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) return null;
    result[key] = descriptor.value;
  }
  return result;
}

const integer = (value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const sha256 = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);

// Match the native retained-file convention: one canonical encoded private key.
// A matching URL is a metadata constraint, never proof of ownership or availability.
function privateMediaUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048 || !/^\/api\/media\/(?:[A-Za-z0-9._~!'()*-]|%[A-Fa-f0-9]{2})+$/u.test(value)) return false;
  const segment = value.slice("/api/media/".length), key = decodeURIComponent(segment);
  return !!key && encodeURIComponent(key) === segment && !/[\p{Cc}\\]/u.test(key)
    && !key.split("/").some(part => part === "." || part === "..");
}

function fileName(value: unknown): value is string {
  return typeof value === "string" && value.length > 4 && value.length <= 240 && value === value.trim()
    && !/[\p{Cc}/\\]/u.test(value) && /\.glb$/iu.test(value);
}

function vector(value: unknown, float32: boolean): [number, number, number] | null {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
  const length = Object.getOwnPropertyDescriptor(value, "length"), keys = Reflect.ownKeys(value);
  if (!length || !Object.hasOwn(length, "value") || length.value !== 3 || keys.length !== 4
    || keys.some(key => key !== "length" && key !== "0" && key !== "1" && key !== "2")) return null;
  const result: [number, number, number] = [0, 0, 0];
  for (let index = 0; index < 3; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) return null;
    const number: unknown = descriptor.value;
    if (typeof number !== "number" || !Number.isFinite(number) || float32 && Math.fround(number) !== number) return null;
    result[index] = number === 0 ? 0 : number;
  }
  return result;
}

function bounds(value: unknown): Model3dGeometryBounds | null {
  const row = closed(value, ["min", "max", "size"]);
  if (!row) return null;
  const min = vector(row.min, true), max = vector(row.max, true), size = vector(row.size, false);
  if (!min || !max || !size || min.some((value, axis) => max[axis]! < value
    || size[axis]! < 0 || size[axis] !== max[axis]! - value)) return null;
  return { min, max, size };
}

/** Closed own-data parser. It validates metadata, not GLB bytes, a saved revision, or access rights. */
export function parseModel3dMediaRevision(value: unknown): Model3dMediaRevision | null {
  try {
    const row = closed(value, ["schemaVersion", "operation", "media", "source", "factor", "beforeBounds", "afterBounds", "vertexCount", "positionAccessorCount"]);
    if (!row || row.schemaVersion !== 1 || row.operation !== "uniform-scale") return null;
    const media = closed(row.media, ["url", "mediaType", "sha256", "byteLength", "fileName"]);
    const source = closed(row.source, ["url", "sha256", "byteLength", "revision", "contentSha256"]);
    if (!media || !source || !privateMediaUrl(media.url) || !privateMediaUrl(source.url) || media.url === source.url
      || media.mediaType !== "model/gltf-binary" || !sha256(media.sha256) || !sha256(source.sha256) || media.sha256 === source.sha256
      || !integer(media.byteLength, 1, MAX_MODEL3D_UPLOAD_BYTES) || !integer(source.byteLength, 1, MAX_MODEL3D_UPLOAD_BYTES)
      || !fileName(media.fileName) || !integer(source.revision, 0) || !sha256(source.contentSha256)
      || typeof row.factor !== "number" || !Number.isFinite(row.factor) || row.factor <= 0 || row.factor === 1
      || !integer(row.vertexCount, 1) || !integer(row.positionAccessorCount, 1, row.vertexCount)) return null;
    const beforeBounds = bounds(row.beforeBounds), afterBounds = bounds(row.afterBounds), factor = row.factor;
    if (!beforeBounds || !afterBounds || beforeBounds.min.some((value, axis) =>
      afterBounds.min[axis] !== Math.fround(value * factor)
      || afterBounds.max[axis] !== Math.fround(beforeBounds.max[axis]! * factor))) return null;
    // Equal outer bounds are allowed: an interior vertex can change at Float32
    // precision while extrema stay fixed. The byte-writing path proves change.
    return {
      schemaVersion: 1, operation: "uniform-scale",
      media: { url: media.url, mediaType: "model/gltf-binary", sha256: media.sha256, byteLength: media.byteLength, fileName: media.fileName },
      source: { url: source.url, sha256: source.sha256, byteLength: source.byteLength, revision: source.revision, contentSha256: source.contentSha256 },
      factor, beforeBounds, afterBounds, vertexCount: row.vertexCount, positionAccessorCount: row.positionAccessorCount,
    };
  } catch { return null; }
}

/** Project only the authored derivative; original alternate formats are not scaled files. */
export function model3dRevisionFile(value: unknown): NativeRetainedModel3dFile | null {
  const revision = parseModel3dMediaRevision(value);
  return revision ? Object.freeze({ url: revision.media.url, mimeType: revision.media.mediaType,
    fileName: revision.media.fileName, fileSize: revision.media.byteLength, format: "glb", role: "mesh",
    sha256: revision.media.sha256, previewSupported: true }) : null;
}

/** Server-created current-file projection for a shared event whose private
 * predecessor references are redacted. This record does not authorize access. */
export type Model3dCurrentProjection = {
  schemaVersion: 1;
  revision: number;
  contentSha256: string;
  media: Model3dMediaRevision["media"];
};

/** Separate from the full private revision parser; no source witness is inferred. */
export function parseModel3dCurrentProjection(value: unknown): Model3dCurrentProjection | null {
  try {
    const row = closed(value, ["schemaVersion", "revision", "contentSha256", "media"]);
    if (!row || row.schemaVersion !== 1 || !integer(row.revision, 1) || !sha256(row.contentSha256)) return null;
    const media = closed(row.media, ["url", "mediaType", "sha256", "byteLength", "fileName"]);
    if (!media || !privateMediaUrl(media.url) || media.mediaType !== "model/gltf-binary" || !sha256(media.sha256)
      || !integer(media.byteLength, 1, MAX_MODEL3D_UPLOAD_BYTES) || !fileName(media.fileName)) return null;
    return { schemaVersion: 1, revision: row.revision, contentSha256: row.contentSha256,
      media: { url: media.url, mediaType: "model/gltf-binary", sha256: media.sha256, byteLength: media.byteLength, fileName: media.fileName } };
  } catch { return null; }
}

export function model3dCurrentProjectionFile(value: unknown): NativeRetainedModel3dFile | null {
  const projection = parseModel3dCurrentProjection(value);
  return projection ? Object.freeze({ url: projection.media.url, mimeType: projection.media.mediaType,
    fileName: projection.media.fileName, fileSize: projection.media.byteLength, format: "glb", role: "mesh",
    sha256: projection.media.sha256, previewSupported: true }) : null;
}

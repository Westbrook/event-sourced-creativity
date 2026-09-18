import { MODEL3D_FORMAT_MIME_TYPES, MODEL3D_PRIVATE_TRANSFER_MAX_BYTES, isModel3dFormat, type Model3dFormat } from "./model3d.ts";
import { model3dRevisionFile, parseModel3dMediaRevision } from "./model3d-media-revision.ts";

export type NativeRetainedModel3dFile = Readonly<{
  url: string;
  mimeType: string;
  fileName: string;
  fileSize: number;
  format: Model3dFormat | null;
  role: "mesh" | "texture" | "preview";
  sha256: string;
  previewSupported?: boolean;
}>;
export type NativeRetainedModel3dContent = Readonly<{
  files: readonly NativeRetainedModel3dFile[];
  /** Declared references only. An authenticated media read establishes byte availability. */
  availability: "mesh-reference" | "file-references" | "metadata-only";
}>;

export const NATIVE_RETAINED_MODEL3D_FILES_MAX = 64;
export const NATIVE_RETAINED_MODEL3D_JSON_MAX_BYTES = 64_000;
const encoder = new TextEncoder();
const requiredFileKeys = ["url", "mimeType", "fileName", "fileSize", "format", "role", "sha256"] as const;
const imageMimeTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/x-exr", "image/x-tga"]);
const mimeToken = /^[a-z0-9!#$%&'*+.^_`|~-]+\/[a-z0-9!#$%&'*+.^_`|~-]+$/u;

function invalid(): never { throw new TypeError("Invalid native retained 3D metadata"); }
function record(value: unknown): object {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  return value;
}
function own(value: object, key: string, required = true): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) { if (required) invalid(); return undefined; }
  if (!Object.hasOwn(descriptor, "value") || !descriptor.enumerable) invalid();
  return descriptor.value;
}
function closed(value: unknown, required: readonly string[], optional: readonly string[] = []): object {
  const result = record(value), keys = Reflect.ownKeys(result);
  if (keys.length < required.length || keys.length > required.length + optional.length) invalid();
  for (const key of keys) {
    if (typeof key !== "string" || !required.includes(key) && !optional.includes(key)) invalid();
    own(result, key);
  }
  for (const key of required) own(result, key);
  return result;
}
function privateMediaUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048 || !/^\/api\/media\/(?:[A-Za-z0-9._~!'()*-]|%[A-Fa-f0-9]{2})+$/u.test(value)) return false;
  const segment = value.slice("/api/media/".length);
  // The producer encodes the whole storage key, including its path separators.
  const key = decodeURIComponent(segment);
  // eslint-disable-next-line no-control-regex -- Reject control characters in decoded private storage keys.
  return key.length > 0 && !/[\u0000-\u001f\u007f\\]/u.test(key)
    && !key.split("/").some(part => part === "." || part === "..")
    && encodeURIComponent(key) === segment;
}
function file(value: unknown): NativeRetainedModel3dFile {
  const row = closed(value, requiredFileKeys, ["previewSupported"]);
  const url = own(row, "url"), mimeType = own(row, "mimeType"), fileName = own(row, "fileName");
  const fileSize = own(row, "fileSize"), format = own(row, "format"), role = own(row, "role"), sha256 = own(row, "sha256");
  if (!privateMediaUrl(url) || typeof mimeType !== "string" || mimeType.length > 127 || !mimeToken.test(mimeType) || typeof fileName !== "string"
    // eslint-disable-next-line no-control-regex -- Reject control characters and path separators in display filenames.
    || !fileName.length || fileName.length > 240 || fileName !== fileName.trim() || /[\u0000-\u001f\u007f/\\]/u.test(fileName)
    || typeof fileSize !== "number" || !Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > MODEL3D_PRIVATE_TRANSFER_MAX_BYTES
    || typeof sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(sha256)) invalid();
  if (role === "mesh") {
    // A returned ZIP is an exact package reference, never a decoded mesh.
    // The producer preserves an advertised FBX MIME in place of octet-stream.
    if (format === null ? mimeType !== "application/zip" : !isModel3dFormat(format) || format !== "fbx" && mimeType !== MODEL3D_FORMAT_MIME_TYPES[format]) invalid();
  } else if (role === "texture" || role === "preview") {
    // Other companion files may likewise retain their normalized advertised MIME.
    if (format !== null || role === "preview" && !imageMimeTypes.has(mimeType)) invalid();
  } else invalid();
  const previewDescriptor = Object.getOwnPropertyDescriptor(row, "previewSupported");
  const previewSupported = previewDescriptor ? own(row, "previewSupported") : undefined;
  if (previewDescriptor && typeof previewSupported !== "boolean") invalid();
  return Object.freeze({ url, mimeType, fileName, fileSize, format: format as Model3dFormat | null, role, sha256,
    ...(previewDescriptor ? { previewSupported: previewSupported as boolean } : {}) });
}
function files(value: unknown): readonly NativeRetainedModel3dFile[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) invalid();
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, "value")) invalid();
  const length: unknown = lengthDescriptor.value;
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || length > NATIVE_RETAINED_MODEL3D_FILES_MAX
    || Reflect.ownKeys(value).length !== length + 1) invalid();
  const result: NativeRetainedModel3dFile[] = [], urls = new Set<string>();
  for (let index = 0; index < length; index++) {
    const entry = file(own(value, String(index)));
    if (urls.has(entry.url)) invalid();
    urls.add(entry.url); result.push(entry);
  }
  return Object.freeze(result);
}
function content(retainedFiles: readonly NativeRetainedModel3dFile[]): NativeRetainedModel3dContent {
  const availability: NativeRetainedModel3dContent["availability"] = retainedFiles.some(entry => entry.role === "mesh" && entry.format !== null)
    ? "mesh-reference" : retainedFiles.length ? "file-references" : "metadata-only";
  const result: NativeRetainedModel3dContent = Object.freeze({ files: retainedFiles, availability });
  if (encoder.encode(JSON.stringify(result)).length > NATIVE_RETAINED_MODEL3D_JSON_MAX_BYTES) invalid();
  return result;
}

/** Select only among already validated descriptors; metadata is not authority. */
export function selectRetainedModel3dEditFile(retained: readonly NativeRetainedModel3dFile[], primaryUrl?: unknown): NativeRetainedModel3dFile | null {
  const glbs = retained.filter(value => value.role === "mesh" && value.format === "glb" && value.mimeType === "model/gltf-binary");
  const selected = glbs.length === 1 ? glbs : glbs.filter(value => value.url === primaryUrl);
  return selected.length === 1 && selected[0]!.previewSupported !== false ? selected[0]! : null;
}

/** Project the selected completion, or only its independently witnessed current
 * GLB derivative. The caller binds the edit/source/auth witness before this call.
 * Only named own data descriptors are read here; input getters, iterators and
 * serialization hooks are never called. Reflection traps may throw and fail closed.
 * Neither the raw prose plan nor legacy media_url fields imply retained files.
 */
export function projectNativeRetainedModel3d(source: unknown, model3dRevision?: unknown): NativeRetainedModel3dContent | null {
  try {
    const envelope = record(source);
    if (own(envelope, "artifact_kind") !== "model3d") invalid();
    const settingsDescriptor = Object.getOwnPropertyDescriptor(envelope, "settings");
    let retained: readonly NativeRetainedModel3dFile[] = Object.freeze([]);
    if (settingsDescriptor) {
      const settings = record(own(envelope, "settings"));
      if (Object.getOwnPropertyDescriptor(settings, "model3d_files")) retained = files(own(settings, "model3d_files"));
    }
    if (model3dRevision !== undefined) {
      const revision = parseModel3dMediaRevision(model3dRevision);
      const original = selectRetainedModel3dEditFile(retained, own(envelope, "media_url", false));
      if (!revision || !original) invalid();
      if (revision.source.revision === 0 && (revision.source.url !== original.url
        || revision.source.sha256 !== original.sha256 || revision.source.byteLength !== original.fileSize)) invalid();
      const derivative = model3dRevisionFile(revision);
      if (!derivative) invalid();
      // Unedited alternate meshes, textures and previews stay in original history.
      // They are never presented as files of the scaled current revision.
      return content(Object.freeze([file(derivative)]));
    }
    return content(retained);
  } catch { return null; }
}

/** Validate the closed audience content and derive availability from its files. */
export function validateNativeRetainedModel3d(value: unknown): NativeRetainedModel3dContent | null {
  try {
    const input = closed(value, ["files", "availability"]);
    const result = content(files(own(input, "files")));
    if (own(input, "availability") !== result.availability) invalid();
    return result;
  } catch { return null; }
}

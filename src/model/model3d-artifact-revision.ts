import { MAX_MODEL3D_UPLOAD_BYTES } from "./model3d-assets.ts";
import { scaleModel3dGeometry, type Model3dGeometryScaleResult } from "./model3d-geometry-edit.ts";

/** A caller-selected generated artifact and its current private GLB, not a reference block. */
export type Model3dArtifactScaleSource = {
  artifactKind: "model3d";
  artifactId: string;
  documentId: string;
  projectId: string | null;
  sourceEventId: string;
  revision: number;
  contentSha256: string;
  mediaUrl: string;
  mediaSha256: string;
  byteLength: number;
};

/** Prepared input for the existing artifact edit protocol; this module does not publish it. */
export type Model3dScaleEditRequest = {
  expectedRevision: number;
  expectedContentSha256: string;
  model3dScale: { sourceMediaSha256: string; factor: number; resultMediaSha256: string };
};

export type Model3dArtifactScalePreparation = {
  source: Model3dArtifactScaleSource;
  geometry: Model3dGeometryScaleResult;
} & (
  | { status: "prepared"; request: Model3dScaleEditRequest }
  | { status: "unchanged"; request: null }
);

export class Model3dArtifactRevisionError extends Error {
  readonly code: "invalid_source" | "source_changed" | "media_mismatch" | "content_mismatch";
  constructor(code: Model3dArtifactRevisionError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "Model3dArtifactRevisionError";
  }
}

const sourceKeys = ["artifactKind", "artifactId", "documentId", "projectId", "sourceEventId", "revision",
  "contentSha256", "mediaUrl", "mediaSha256", "byteLength"] as const;
const typedArrayByteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "byteLength")!.get!;

// Match the closed, non-coercing Video edit DTO convention. Capture data-property
// values instead of reading getters; canonical output also fixes fingerprint order.
function closedRecord(value: unknown, names: readonly string[]): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value), keys = Reflect.ownKeys(value);
  if (prototype !== Object.prototype && prototype !== null || keys.length !== names.length
    || keys.some(key => typeof key !== "string" || !names.includes(key))) return null;
  const result: Record<string, unknown> = {};
  for (const key of names) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property?.enumerable || !Object.hasOwn(property, "value")) return null;
    result[key] = property.value;
  }
  return result;
}

const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const integer = (value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const identity = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 1024 && !/\p{Cc}/u.test(value);

// Same canonical private-media segment convention as the existing Video revision.
// A private-looking URL is an identity constraint here, never proof of access rights.
function privateMediaUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048 || !/^\/api\/media\/(?:[A-Za-z0-9._~!'()*-]|%[A-Fa-f0-9]{2})+$/u.test(value)) return false;
  try {
    const segment = value.slice("/api/media/".length), key = decodeURIComponent(segment);
    return !!key && encodeURIComponent(key) === segment && !/[\p{Cc}\\]/u.test(key)
      && !key.split("/").some(part => part === "." || part === "..");
  } catch { return false; }
}

function sourceSnapshot(value: unknown): Model3dArtifactScaleSource | null {
  try {
    const row = closedRecord(value, sourceKeys);
    if (!row || row.artifactKind !== "model3d" || !identity(row.artifactId) || !identity(row.documentId)
      || row.projectId !== null && !identity(row.projectId) || !identity(row.sourceEventId)
      || !integer(row.revision, 0) || !digest(row.contentSha256) || !privateMediaUrl(row.mediaUrl)
      || !digest(row.mediaSha256) || !integer(row.byteLength, 1, MAX_MODEL3D_UPLOAD_BYTES)) return null;
    return { artifactKind: "model3d", artifactId: row.artifactId, documentId: row.documentId,
      projectId: row.projectId, sourceEventId: row.sourceEventId, revision: row.revision,
      contentSha256: row.contentSha256, mediaUrl: row.mediaUrl, mediaSha256: row.mediaSha256, byteLength: row.byteLength };
  } catch { return null; }
}

/** Closed canonical request, without a persisted revision, destination URL or approval. */
export function parseModel3dScaleEditRequest(value: unknown): Model3dScaleEditRequest | null {
  try {
    const row = closedRecord(value, ["expectedRevision", "expectedContentSha256", "model3dScale"]);
    const scale = row && closedRecord(row.model3dScale, ["sourceMediaSha256", "factor", "resultMediaSha256"]);
    if (!row || !scale || !integer(row.expectedRevision, 0) || !digest(row.expectedContentSha256)
      || !digest(scale.sourceMediaSha256) || !digest(scale.resultMediaSha256)
      || scale.sourceMediaSha256 === scale.resultMediaSha256
      || typeof scale.factor !== "number" || !Number.isFinite(scale.factor) || scale.factor <= 0 || scale.factor === 1) return null;
    return { expectedRevision: row.expectedRevision, expectedContentSha256: row.expectedContentSha256,
      model3dScale: { sourceMediaSha256: scale.sourceMediaSha256, factor: scale.factor, resultMediaSha256: scale.resultMediaSha256 } };
  } catch { return null; }
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, "0")).join("");
}

/**
 * Stage one positive uniform POSITION edit against two exact source snapshots.
 * Own all metadata, raw JSON UTF-8 and GLB bytes before the first async digest.
 * No JSON normalization, network, media upload, history write or approval occurs.
 *
 * The caller must obtain these snapshots/media through the existing authorized
 * artifact path and bind the selected media descriptor to that saved JSON, then
 * recheck current ownership/revision when publishing. Matching
 * supplied identities does not establish authority, a saved revision, or a review.
 * Returned bytes are a candidate only; even a second prepared edit is not history.
 */
export async function prepareModel3dArtifactScale(input: {
  captured: Model3dArtifactScaleSource;
  current: Model3dArtifactScaleSource;
  rawContent: string;
  bytes: Uint8Array | ArrayBuffer;
  factor: number;
}): Promise<Model3dArtifactScalePreparation> {
  const captured = sourceSnapshot(input.captured), current = sourceSnapshot(input.current);
  if (!captured || !current) throw new Model3dArtifactRevisionError("invalid_source", "Choose an exact generated Model3D source revision.");
  if (sourceKeys.some(key => captured[key] !== current[key])) {
    throw new Model3dArtifactRevisionError("source_changed", "The generated model source no longer matches the captured revision.");
  }
  const factor = input.factor, rawContent = input.rawContent;
  if (typeof rawContent !== "string") throw new Model3dArtifactRevisionError("invalid_source", "The exact serialized artifact content is required.");
  const supplied = input.bytes instanceof Uint8Array ? input.bytes : input.bytes instanceof ArrayBuffer ? new Uint8Array(input.bytes) : null;
  // Read the native view length, not an overridable own property, before copying.
  let byteLength = 0;
  try { byteLength = typedArrayByteLength.call(supplied); } catch { /* Not a native typed-array view. */ }
  if (!supplied || byteLength !== current.byteLength || byteLength > MAX_MODEL3D_UPLOAD_BYTES) {
    throw new Model3dArtifactRevisionError("media_mismatch", "The private model length does not match this revision.");
  }
  const bytes = new Uint8Array(supplied), content = new TextEncoder().encode(rawContent);
  if (await sha256(content) !== current.contentSha256) {
    throw new Model3dArtifactRevisionError("content_mismatch", "The serialized artifact does not match this revision.");
  }
  if (await sha256(bytes) !== current.mediaSha256) {
    throw new Model3dArtifactRevisionError("media_mismatch", "The private model bytes do not match this revision.");
  }
  // Preserve the accepted writer's static/unsupported/precision refusal behavior.
  const geometry = scaleModel3dGeometry(bytes, factor);
  if (!geometry.changed) return { status: "unchanged", source: current, geometry, request: null };
  const resultMediaSha256 = await sha256(geometry.bytes as Uint8Array<ArrayBuffer>);
  return { status: "prepared", source: current, geometry,
    request: { expectedRevision: current.revision, expectedContentSha256: current.contentSha256,
      model3dScale: { sourceMediaSha256: current.mediaSha256, factor, resultMediaSha256 } } };
}

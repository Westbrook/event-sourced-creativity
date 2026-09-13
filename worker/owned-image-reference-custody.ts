import { mediaKeyMatchesOwnerNamespace } from "../src/model/media-ownership.ts";
import type { CreativeEvent } from "../src/model/events.ts";
import { readGeneratedImageReference } from "./media-api.ts";
import { assertDerivedReferenceProvenance } from "./derived-reference-guard.ts";
import type { WorkerEnv } from "./runtime.ts";

const modelFields = ["model_url", "model_view", "model_reference_id", "model_content_hash", "reference_composition"];
const storedDerivedFields = ["modelSourceKey", "modelSourceSha256", "modelView", "referenceComposition", "referenceCompositionSha256", "referenceCompositionVersion"];
export class OwnedImageReferenceError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
const fail = (code: string): never => { throw new OwnedImageReferenceError(code); };
const mime = (value: string) => value.split(";")[0]!.trim().toLowerCase();

/** Byte custody only. The caller owns trusted source/principal, current rights,
 * pixel policy and final source-read proof. No saved model/composition support,
 * reusable authorization token, write, provider submission or inferred consent. */
export async function readOwnedImageReferenceCustody(input: {
  env: WorkerEnv; ownerId: string; blockId: string; referenceId: string; sha256: string;
  properties: Record<string, unknown>; sourceEvents: readonly CreativeEvent[];
  maximumBytes: number; mimeTypes: readonly string[]; signal: AbortSignal;
}) {
  const { env, ownerId, properties, referenceId, signal } = input;
  signal.throwIfAborted();
  if (!ownerId || !input.blockId || !referenceId || !/^[a-f0-9]{64}$/u.test(input.sha256)
    || properties.reference_id !== referenceId || properties.source_content_hash !== input.sha256)
    fail("owned_image_reference_hash_required");
  if (modelFields.some(key => properties[key] !== undefined)) fail("owned_image_reference_ordinary_image_required");
  if (!Number.isSafeInteger(input.maximumBytes) || input.maximumBytes < 1 || !input.mimeTypes.length)
    fail("owned_image_reference_limits_invalid");
  const mediaUrl = properties.media_url;
  if (typeof mediaUrl !== "string" || !mediaUrl.startsWith("/api/media/") || /[?#]/u.test(mediaUrl))
    return fail("owned_image_reference_private_media_required");
  let key: string;
  try { key = decodeURIComponent(mediaUrl.slice("/api/media/".length)); }
  catch { return fail("owned_image_reference_private_media_required"); }
  if (!key || /[\\?#\p{Cc}]/u.test(key) || key.split("/").some(part => !part || part === "." || part === "..")
    || !mediaKeyMatchesOwnerNamespace(key, ownerId)) fail("owned_image_reference_private_media_required");
  const events = [...input.sourceEvents].sort((a, b) => a.sequence - b.sequence);
  const ingestion = events.findLast(event => event.type === "ReferenceIngested" && event.payload.reference_id === referenceId);
  if (!ingestion || (ingestion.payload.source_ref ?? ingestion.payload.media_url) !== mediaUrl
    || ingestion.payload.content_hash !== input.sha256) fail("owned_image_reference_retained_hash_required");
  const readHead = async () => {
    const head = await env.MEDIA.head(key); signal.throwIfAborted();
    if (!head || head.customMetadata?.ownerId !== ownerId || typeof head.size !== "number" || !Number.isSafeInteger(head.size)
      || head.size < 1 || head.size > input.maximumBytes
      || head.customMetadata.sha256 !== undefined && head.customMetadata.sha256 !== input.sha256)
      return fail("owned_image_reference_media_unavailable");
    if (storedDerivedFields.some(field => Object.hasOwn(head.customMetadata!, field))) fail("owned_image_reference_ordinary_image_required");
    const headers = new Headers(); head.writeHttpMetadata(headers);
    const mimeType = mime(headers.get("content-type") ?? "");
    if (!input.mimeTypes.includes(mimeType) || properties.media_type !== undefined && mime(String(properties.media_type)) !== mimeType)
      fail("owned_image_reference_image_required");
    return { size: head.size, mimeType, metadata: { ...head.customMetadata } };
  };
  const before = await readHead();
  // Reject stripped canonical or stored derivation markers through the existing
  // provenance path too; never reinterpret a saved 3D view as an ordinary image.
  await assertDerivedReferenceProvenance({ env, ownerId, properties, blockId: input.blockId, sourceEvents: events });
  signal.throwIfAborted();
  const image = await readGeneratedImageReference(env, ownerId, mediaUrl);
  signal.throwIfAborted();
  if (!image || image.bytes.byteLength !== before.size || image.bytes.byteLength > input.maximumBytes
    || mime(image.mimeType) !== before.mimeType) return fail("owned_image_reference_read_mismatch");
  const bytes = new Uint8Array(image.bytes);
  const actual = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
  if (actual !== input.sha256 || JSON.stringify(await readHead()) !== JSON.stringify(before)) fail("owned_image_reference_source_changed");
  signal.throwIfAborted();
  return { bytes, sha256: actual, mimeType: before.mimeType };
}

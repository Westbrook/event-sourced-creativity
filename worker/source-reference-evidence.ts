import {memoryAuthoredImageMediaAllowed} from './memory-authored-image-custody.ts';
import { mediaKeyMatchesOwnerNamespace } from "../src/model/media-ownership.ts";
import { sourceDocumentEvidenceDigest, sourceDocumentEvidenceFromProperties } from "../src/model/source-documents.ts";
import { normalizeReferenceComposition, referenceCompositionMediaUrl, REFERENCE_COMPOSITION_MAX_SOURCE_BYTES, type ReferenceCompositionRecipe } from "../src/model/reference-composition.ts";
import type { WorkerEnv } from "./runtime.ts";

const SAFE_UPLOADED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"]);

const sha256Hex = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)), (value) => value.toString(16).padStart(2, "0")).join("");

async function ownedCompositionSourcesValid(env: WorkerEnv, ownerId: string, recipe: ReferenceCompositionRecipe, projectAccessId: string) {
  if (!recipe.layers.some((layer) => layer.opacity > 0)) return false;
  for (const source of recipe.sources) {
    const url = referenceCompositionMediaUrl(source.mediaUrl);
    if (!url) return false;
    const key = decodeURIComponent(url.slice("/api/media/".length));
    if (!mediaKeyMatchesOwnerNamespace(key, ownerId)) return false;
    const object = typeof env.MEDIA.head === "function" ? await env.MEDIA.head(key) : await env.MEDIA.get(key);
    if(!await memoryAuthoredImageMediaAllowed(env,ownerId,key))return false;
  const metadata = object?.customMetadata;
    if (!object || !metadata || metadata.ownerId !== ownerId || metadata.rights !== "asserted" && metadata.source !== "provider-generated-media" && metadata.source !== "provider-image-api") return false;
    const headers = new Headers(); object.writeHttpMetadata(headers);
    if (!SAFE_UPLOADED_IMAGE_TYPES.has(String(headers.get("content-type")).split(";")[0]!.trim().toLowerCase())
      || typeof object.size === "number" && (!object.size || object.size > REFERENCE_COMPOSITION_MAX_SOURCE_BYTES)) return false;
    if (projectAccessId) {
      if (metadata.projectAccessId && metadata.projectAccessId !== projectAccessId) return false;
      const scoped = await env.DB.prepare("SELECT 1 AS valid FROM project_resource_scopes WHERE project_access_id=? AND resource_kind='media' AND resource_id=? AND owner_user_id=?")
        .bind(projectAccessId, key, ownerId).first();
      if (!scoped) return false;
    }
    // Old generated image metadata may predate retained hashes; compute only from bounded owned bytes.
    let digest = metadata.sha256;
    if (!digest) {
      const content = await env.MEDIA.get(key);
      if (!content || content.customMetadata?.ownerId !== ownerId) return false;
      const bytes = new Uint8Array(await new Response(content.body).arrayBuffer());
      if (!bytes.byteLength || bytes.byteLength > REFERENCE_COMPOSITION_MAX_SOURCE_BYTES) return false;
      digest = await sha256Hex(bytes);
    }
    if (digest !== source.contentHash) return false;
    if (source.kind === "model-view" && (!metadata.modelSourceKey || !metadata.modelSourceSha256 || !metadata.modelView)) return false;
  }
  return true;
}

/** The immutable PNG receipt commits to every source hash, layer, and placement in the saved recipe. */
export async function verifyReferenceCompositionAssets(env: WorkerEnv, ownerId: string, properties: Record<string, unknown>, projectAccessId = ""): Promise<boolean> {
  const recipe = normalizeReferenceComposition(properties.reference_composition), url = referenceCompositionMediaUrl(properties.media_url);
  if (!recipe || !url || properties.media_type !== "image/png") return false;
  const key = decodeURIComponent(url.slice("/api/media/".length));
  if (!mediaKeyMatchesOwnerNamespace(key, ownerId)) return false;
  const object = typeof env.MEDIA.head === "function" ? await env.MEDIA.head(key) : await env.MEDIA.get(key);
  if(!await memoryAuthoredImageMediaAllowed(env,ownerId,key))return false;
  const metadata = object?.customMetadata;
  if (!object || !metadata || metadata.ownerId !== ownerId || metadata.mimeType !== "image/png" || metadata.rights !== "asserted"
    || metadata.sha256 !== properties.source_content_hash || metadata.referenceCompositionVersion !== "1"
    || metadata.referenceCompositionSha256 !== await sha256Hex(new TextEncoder().encode(JSON.stringify(recipe)))) return false;
  const headers = new Headers(); object.writeHttpMetadata(headers);
  if (headers.get("content-type") !== "image/png") return false;
  if (projectAccessId) {
    if (metadata.projectAccessId && metadata.projectAccessId !== projectAccessId) return false;
    const scoped = await env.DB.prepare("SELECT 1 AS valid FROM project_resource_scopes WHERE project_access_id=? AND resource_kind='media' AND resource_id=? AND owner_user_id=?")
      .bind(projectAccessId, key, ownerId).first();
    if (!scoped) return false;
  }
  return ownedCompositionSourcesValid(env, ownerId, recipe, projectAccessId);
}

/** Validate server-extracted source facts against immutable R2-owned evidence metadata. */
export async function verifySourceDocumentEvidence(env: WorkerEnv, ownerId: string, mediaUrl: unknown, properties: Record<string, unknown>): Promise<boolean> {
  const prefix = "/api/media/";
  if (typeof mediaUrl !== "string" || !mediaUrl.startsWith(prefix)) return false;
  let key = "";
  try { key = decodeURIComponent(mediaUrl.slice(prefix.length)); } catch { return false; }
  if (!mediaKeyMatchesOwnerNamespace(key, ownerId)) return false;
  const object = typeof env.MEDIA.head === "function" ? await env.MEDIA.head(key) : await env.MEDIA.get(key);
  if(!await memoryAuthoredImageMediaAllowed(env,ownerId,key))return false;
  const metadata = object?.customMetadata;
  if (!metadata || metadata.ownerId !== ownerId) return false;
  if (metadata.referenceCompositionSha256 || properties.reference_composition) return verifyReferenceCompositionAssets(env, ownerId, properties);
  if (!metadata.sourceEvidenceSha256) {
    const claimedMime = String(properties.source_mime_type ?? "");
    const actualMime = String(metadata.mimeType ?? "");
    if (actualMime && claimedMime && actualMime !== claimedMime) return false;
    if (actualMime && !actualMime.startsWith("image/") || claimedMime && !claimedMime.startsWith("image/")) return false;
    if (properties.source_content_hash && String(properties.source_content_hash) !== metadata.sha256) return false;
    if (properties.source_evidence_hash || properties.source_kind || properties.source_citations !== undefined
      || properties.source_segment_count !== undefined || properties.source_excerpt_truncated !== undefined || properties.extraction_status === "ready") return false;
    // Compatibility is intentionally limited to existing private image
    // references that make no claims about extracted document evidence.
    return true;
  }
  if (String(properties.source_evidence_hash ?? "") !== metadata.sourceEvidenceSha256) return false;
  if (String(properties.source_mime_type ?? "") !== metadata.mimeType || String(properties.source_content_hash ?? "") !== metadata.sha256) return false;
  const supplied = sourceDocumentEvidenceFromProperties(properties, metadata.sha256 ?? "", metadata.mimeType ?? "");
  return await sourceDocumentEvidenceDigest(supplied) === metadata.sourceEvidenceSha256;
}

export { SAFE_UPLOADED_IMAGE_TYPES, sha256Hex, ownedCompositionSourcesValid };

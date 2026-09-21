import {memoryAuthoredImageMediaAllowed} from './memory-authored-image-custody.ts';
import { creativeContextRightsIssue } from "../src/model/context-health.ts";
import { foldEvents, type CreativeBlock, type CreativeEvent } from "../src/model/events.ts";
import { mediaKeyMatchesOwnerNamespace } from "../src/model/media-ownership.ts";
import { normalizeModel3dView } from "../src/model/model3d-view.ts";
import { normalizeReferenceComposition, referenceCompositionMediaUrl, REFERENCE_COMPOSITION_MAX_SOURCE_BYTES } from "../src/model/reference-composition.ts";
import { verifyModel3dBlockAssets, verifyReferenceCompositionAssets } from "./media-api.ts";
import type { ProjectExecutionScope } from "./pilot-policy.ts";
import { ProviderRequestError } from "./provider-errors.ts";
import type { WorkerEnv } from "./runtime.ts";

const ALLOWED_RIGHTS = new Set(["owned", "owned_or_licensed", "licensed", "account-generated"]);
const MAX_DERIVATION_DEPTH = 8;
const MAX_DERIVATION_BLOCKS = 128;
const string = (value: unknown) => typeof value === "string" ? value.trim() : "";
const hash = (value: unknown) => /^[a-f0-9]{64}$/iu.test(string(value)) ? string(value).toLowerCase() : "";
const hasModel = (properties: Record<string, unknown>) =>
  ["model_url", "model_reference_id", "model_content_hash", "model_view"].some(key => properties[key] !== undefined && properties[key] !== null);
const hasComposition = (properties: Record<string, unknown>) => properties.reference_composition !== undefined && properties.reference_composition !== null;
type StoredImage = { key: string; mimeType: string; metadata: Record<string, string> };

function reject(code: string, message: string, blockId: string, referenceId = ""): never {
  throw new ProviderRequestError({ code, category: "provider", scope: "request", action: "edit_request", message,
    retryable: false, retryAfterMs: null, requestId: null, httpStatus: 403,
    contributingBlockIds: blockId ? [blockId] : [], contributingReferenceIds: referenceId ? [referenceId] : [],
  });
}

function binding(properties: Record<string, unknown>): string {
  return JSON.stringify([
    string(properties.reference_id), referenceCompositionMediaUrl(properties.media_url),
    hash(properties.source_content_hash ?? properties.content_hash), string(properties.media_type),
    string(properties.model_reference_id), referenceCompositionMediaUrl(properties.model_url),
    hash(properties.model_content_hash), string(properties.model_mime_type), normalizeModel3dView(properties.model_view),
    normalizeReferenceComposition(properties.reference_composition), hasModel(properties), hasComposition(properties),
  ]);
}

/** Personal streams can contain other opened projects after the requested block. */
function authoredRootScope(events: CreativeEvent[], blockId: string): { documentId: string; projectId: string } {
  const createdIndex = events.findLastIndex(event => event.type === "BlockCreated" && string(event.payload.block_id) === blockId);
  if (createdIndex < 0) return { documentId: "", projectId: "" };
  const created = events[createdIndex]!.payload;
  const atCreation = foldEvents(events.slice(0, createdIndex + 1), Number.POSITIVE_INFINITY, string(created.document_id), string(created.project_id));
  const root = atCreation.libraryBlocks.find(block => block.id === blockId);
  let documentId = root?.documentId ?? "", projectId = root?.projectId ?? "";
  for (const event of events.slice(createdIndex + 1)) {
    if (event.type !== "BlockRehomed" || string(event.payload.block_id) !== blockId) continue;
    documentId = event.payload.scope === "document" ? string(event.payload.document_id) : "";
    projectId = String(event.payload.project_id ?? projectId);
  }
  return { documentId, projectId };
}

/**
 * Admission for saved 3D views and reference compositions. sourceEvents must be
 * the caller's canonical, authorized project events, never a browser snapshot.
 * A disabled constituent still belongs to a saved composition; removal, changed
 * bytes, or withdrawn rights invalidate that composition before provider work.
 */
export async function assertDerivedReferenceProvenance(input: {
  env: WorkerEnv;
  ownerId: string;
  properties: Record<string, unknown>;
  blockId: string;
  sourceEvents: readonly CreativeEvent[];
  projectScope?: ProjectExecutionScope;
}): Promise<void> {
  const { env, ownerId, properties, blockId, projectScope } = input;
  const stored = new Map<string, Promise<StoredImage | null>>();
  const readImage = (mediaUrl: unknown): Promise<StoredImage | null> => {
    const url = referenceCompositionMediaUrl(mediaUrl);
    if (!url) return Promise.resolve(null);
    const previous = stored.get(url);
    if (previous) return previous;
    const pending = (async () => {
      const key = decodeURIComponent(url.slice("/api/media/".length));
      if (!mediaKeyMatchesOwnerNamespace(key, ownerId)) return null;
      const object = typeof env.MEDIA.head === "function" ? await env.MEDIA.head(key) : await env.MEDIA.get(key);
      if (!object || object.customMetadata?.ownerId !== ownerId || !await memoryAuthoredImageMediaAllowed(env,ownerId,key)) return null;
      const headers = new Headers(); object.writeHttpMetadata(headers);
      const mimeType = (headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
      if (!mimeType.startsWith("image/")) return null;
      return { key, mimeType, metadata: object.customMetadata };
    })();
    stored.set(url, pending);
    return pending;
  };
  const rootImage = await readImage(properties.media_url);
  const storedModel = (image: StoredImage | null) => Boolean(image && ["modelSourceKey", "modelSourceSha256", "modelView"].some(key => key in image.metadata));
  const storedComposition = (image: StoredImage | null) => Boolean(image && ["referenceComposition", "referenceCompositionSha256", "referenceCompositionVersion"].some(key => key in image.metadata));
  const events = [...input.sourceEvents].sort((left, right) => left.sequence - right.sequence);
  const rootScope = projectScope ? { documentId: "", projectId: projectScope.projectId } : authoredRootScope(events, blockId);
  const projection = foldEvents(events, Number.POSITIVE_INFINITY, rootScope.documentId, rootScope.projectId);
  const blocks = new Map(projection.libraryBlocks.map(block => [block.id, block]));
  const root = blocks.get(blockId);
  const canonicalImage = root ? await readImage(root.properties.media_url) : null;
  // Neither stripped fields nor a substituted ordinary image can hide the
  // canonical root's derivation or the immutable PNG's storage markers.
  if (!hasModel(properties) && !hasComposition(properties) && !storedModel(rootImage) && !storedComposition(rootImage)
    && root?.type !== "model3d" && (!root || !hasModel(root.properties) && !hasComposition(root.properties))
    && !storedModel(canonicalImage) && !storedComposition(canonicalImage)) return;
  if (!root || !["reference", "model3d"].includes(root.type) || projectScope && root.projectId !== projectScope.projectId
    || binding(root.properties) !== binding(properties)) {
    reject("derived_reference_source_changed", "This saved reference no longer matches its current source block. Reopen the model or composition and save its reference again.", blockId, string(properties.reference_id));
  }
  if (projectScope && projectScope.ownerUserId !== ownerId) {
    reject("derived_reference_not_authorized", "This saved reference does not belong to the selected project.", blockId, string(properties.reference_id));
  }
  const latestRights = new Map<string, CreativeEvent>(), latestIngestions = new Map<string, CreativeEvent>();
  for (const event of events) {
    if (event.type !== "RightsAsserted" && event.type !== "ReferenceIngested") continue;
    const id = string(event.payload.reference_id);
    if (!id) continue;
    latestRights.set(id, event);
    if (event.type === "ReferenceIngested") latestIngestions.set(id, event);
  }
  const sourceHash = (source: Record<string, unknown>) => hash(source.source_content_hash ?? source.content_hash
    ?? latestIngestions.get(string(source.reference_id))?.payload.content_hash);
  const assertRights = (referenceId: string, mediaUrl: unknown, contentHash: unknown, sourceBlockId: string, originalModel = false) => {
    const receipt = latestRights.get(referenceId), ingested = latestIngestions.get(referenceId);
    if (!referenceId || !receipt || !ALLOWED_RIGHTS.has(string(receipt.payload.rights_class))) {
      reject("derived_reference_rights_required", originalModel
        ? "Confirm current rights to the original 3D model before using its saved view."
        : "Confirm current owned, licensed, or account-generated rights for every source in this saved reference.", sourceBlockId, referenceId);
    }
    if (creativeContextRightsIssue(receipt.payload)) {
      reject("derived_reference_rights_unavailable", "A source license has expired, was withdrawn, or has an invalid expiry date. Update its rights before using this saved reference.", sourceBlockId, referenceId);
    }
    const url = referenceCompositionMediaUrl(mediaUrl), digest = hash(contentHash);
    if (!url || !digest || !ingested || referenceCompositionMediaUrl(ingested.payload.source_ref ?? ingested.payload.media_url) !== url
      || hash(ingested.payload.content_hash) !== digest) {
      reject("derived_reference_integrity_mismatch", "The source file and its rights receipt no longer match. Reopen the source and save the model view or composition again.", sourceBlockId, referenceId);
    }
  };
  const assertProjectBinding = async (sourceBlockId: string, referenceId: string, mediaUrl: unknown) => {
    if (!projectScope) return;
    const url = referenceCompositionMediaUrl(mediaUrl);
    const key = url ? decodeURIComponent(url.slice("/api/media/".length)) : "";
    const matched = key && await env.DB.prepare(`SELECT 1 AS present FROM project_resource_scopes media
      JOIN project_resource_scopes block ON block.project_access_id=media.project_access_id AND block.organization_id=media.organization_id AND block.project_id=media.project_id AND block.owner_user_id=media.owner_user_id AND block.resource_kind='block' AND block.resource_id=?
      JOIN project_resource_scopes reference ON reference.project_access_id=media.project_access_id AND reference.organization_id=media.organization_id AND reference.project_id=media.project_id AND reference.owner_user_id=media.owner_user_id AND reference.resource_kind='reference' AND reference.resource_id=?
      WHERE media.project_access_id=? AND media.organization_id=? AND media.project_id=? AND media.owner_user_id=? AND media.resource_kind='media' AND media.resource_id=?`)
      .bind(sourceBlockId, referenceId, projectScope.projectAccessId, projectScope.organizationId, projectScope.projectId, projectScope.ownerUserId, key).first();
    if (!matched) reject("derived_reference_not_authorized", "A source in this saved reference is no longer available in the selected project.", sourceBlockId, referenceId);
  };

  const visiting = new Set<string>(), verified = new Map<string, number>();
  const verify = async (block: CreativeBlock, depth: number): Promise<void> => {
    const source = block.properties, referenceId = string(source.reference_id);
    const subtreeDepth = verified.get(block.id);
    if (visiting.has(block.id) || depth + (subtreeDepth ?? 0) > MAX_DERIVATION_DEPTH) {
      reject("derived_reference_chain_invalid", "This composition contains a circular or overly nested reference. Rebuild it from the original images and saved 3D views.", block.id, referenceId);
    }
    if (subtreeDepth !== undefined) return;
    if (verified.size + visiting.size >= MAX_DERIVATION_BLOCKS) {
      reject("derived_reference_chain_invalid", "This composition contains too many source blocks. Rebuild it from a smaller set of original images and saved 3D views.", block.id, referenceId);
    }
    visiting.add(block.id);
    let retainedDepth = 0;
    if (creativeContextRightsIssue(source) || creativeContextRightsIssue(block.id === blockId ? properties : source)) {
      reject("derived_reference_rights_unavailable", "A source license has expired, was withdrawn, or has an invalid expiry date. Update its rights before using this saved reference.", block.id, referenceId);
    }
    const image = await readImage(source.media_url);
    const model = block.type === "model3d" || hasModel(source), composition = hasComposition(source);
    if (storedModel(image) && !model || storedComposition(image) && !composition) {
      reject("derived_reference_provenance_missing", "This image is missing its saved model or composition provenance. Reopen the original source and save its reference again.", block.id, referenceId);
    }
    let imageHash = hash(image?.metadata.sha256);
    if (image && !imageHash && !model && !composition) {
      const content = await env.MEDIA.get(image.key);
      if (content?.customMetadata?.ownerId === ownerId && (typeof content.size !== "number" || content.size > 0 && content.size <= REFERENCE_COMPOSITION_MAX_SOURCE_BYTES)) {
        const bytes = new Uint8Array(await new Response(content.body).arrayBuffer());
        if (bytes.byteLength && bytes.byteLength <= REFERENCE_COMPOSITION_MAX_SOURCE_BYTES) {
          imageHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
        }
      }
    }
    if (!image || !sourceHash(source) || imageHash !== sourceHash(source)
      || image.metadata.mimeType && image.metadata.mimeType !== image.mimeType
      || string(source.media_type ?? source.source_mime_type) && string(source.media_type ?? source.source_mime_type) !== image.mimeType) {
      reject("derived_reference_input_unavailable", model
        ? "Open this 3D model and save a reference view before using it in a generation."
        : "A source image is unavailable or has changed. Reopen the composition and replace the affected source.", block.id, referenceId);
    }
    if (projectScope && image.metadata.projectAccessId && image.metadata.projectAccessId !== projectScope.projectAccessId) {
      reject("derived_reference_not_authorized", "A source image belongs to a different project. Choose a source from the selected project.", block.id, referenceId);
    }
    assertRights(referenceId, source.media_url, sourceHash(source), block.id);
    await assertProjectBinding(block.id, referenceId, source.media_url);
    if (model) {
      assertRights(string(source.model_reference_id), source.model_url, source.model_content_hash, block.id, true);
      await assertProjectBinding(block.id, string(source.model_reference_id), source.model_url);
      if (!await verifyModel3dBlockAssets(env, ownerId, source, projectScope?.projectAccessId ?? "")) {
        reject("derived_reference_model_view_changed", "The saved view no longer matches its original 3D model and camera. Open the model and save the view again.", block.id, referenceId);
      }
    }
    if (composition) {
      const recipe = normalizeReferenceComposition(source.reference_composition);
      if (!recipe || !recipe.layers.some(layer => layer.opacity > 0)
        || !await verifyReferenceCompositionAssets(env, ownerId, source, projectScope?.projectAccessId ?? "")) {
        reject("derived_reference_composition_changed", "This saved composition no longer matches its source recipe. Reopen it and save the reviewed arrangement again.", block.id, referenceId);
      }
      for (const retained of recipe.sources) {
        const current = blocks.get(retained.blockId);
        if (!current || !["reference", "model3d"].includes(current.type) || current.projectId !== root.projectId) {
          reject("derived_reference_source_unavailable", "A source block was removed or is no longer available. Reopen the composition and replace that source.", retained.blockId);
        }
        const currentKind = current.type === "model3d" || hasModel(current.properties) ? "model-view" : "image";
        if (currentKind !== retained.kind || referenceCompositionMediaUrl(current.properties.media_url) !== retained.mediaUrl
          || sourceHash(current.properties) !== retained.contentHash) {
          reject("derived_reference_source_changed", "A source image or 3D view changed after this composition was saved. Reopen the composition and save it again.", current.id, string(current.properties.reference_id));
        }
        await verify(current, depth + 1);
        retainedDepth = Math.max(retainedDepth, 1 + verified.get(current.id)!);
      }
    }
    visiting.delete(block.id);
    verified.set(block.id, retainedDepth);
  };
  await verify(root, 0);
}

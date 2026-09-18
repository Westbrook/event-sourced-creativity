import { readModel3dReferenceIntent, type Model3dReferenceIntent } from "../src/experiences/model3d-reference.ts";
import { mediaKeyMatchesOwnerNamespace } from "../src/model/media-ownership.ts";
import { normalizeModel3dView, type Model3dView } from "../src/model/model3d-view.ts";
import { prepareModel3dRequest } from "./model3d-request.ts";
import { projectIntakeAuthority, type ProjectIntakeAuthorization } from "./intake-authority.ts";
import { outputActiveSourceDeadlineAssertions, verifyOutputSourceRead } from "./output-disclosure-proof.ts";
import type { OutputTrustedContext } from "./output-requirements-api.ts";

export const MAX_MODEL3D_INTAKE_REFERENCE_BYTES = 24 * 1024 * 1024;
const MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
function fail(code: string, status = 409): never { throw Object.assign(new Error(code), { code, status }); }

export type Model3dReferenceInspection = Readonly<{
  version: 1;
  qualification: "read-only-reference-inspection";
  selection: Model3dReferenceIntent;
  sourceDigest: string;
  content: Readonly<{ sha256: string; byteLength: number; mimeType: string }>;
  savedModel: Readonly<{ referenceId: string; sha256: string; view: Readonly<Model3dView> }> | null;
}>;

/**
 * Server-only read preparation from loadOutputTrustedContext + intake authorization.
 * Returned metadata is not a reusable authority token, a cross-project transfer,
 * a RightsAsserted event, or permission to generate. Save/commit must reread it.
 */
export async function inspectModel3dReferenceCustody(
  trusted: OutputTrustedContext,
  auth: ProjectIntakeAuthorization,
  value: unknown,
): Promise<Model3dReferenceInspection> {
  const selection = readModel3dReferenceIntent(value);
  if (!selection) fail("model3d_reference_selection_invalid", 400);
  const { scope, env } = trusted;
  if (scope.kind !== "personal" || scope.projectAccessId || scope.organizationId || scope.contextId
    || scope.ownerUserId !== scope.actorUserId || scope.actorUserId !== auth.user.userId
    || auth.principal.userId !== auth.user.userId || auth.impersonation || auth.user.fictional || auth.user.projectExecution
    || scope.documentId !== selection.sourceDocumentId || scope.projectId !== selection.sourceProjectId) {
    fail("model3d_reference_scope_unavailable", 403);
  }
  if (!trusted.context || trusted.sourceProblems.length || !trusted.sourcePrivateCaptured
    || !trusted.sourceDigest || !Number.isSafeInteger(trusted.ownerHead) || trusted.ownerHead < 0
    || !trusted.sourceAssertions.length) fail("model3d_reference_source_unavailable");
  const projected = trusted.projection.libraryBlocks.filter(block => block.id === selection.sourceBlockId);
  const facts = Array.isArray(trusted.context.snapshot.facts) ? trusted.context.snapshot.facts.map(record) : [];
  const selected = facts.filter(fact => fact.block_id === selection.sourceBlockId);
  if (projected.length !== 1 || selected.length !== 1) fail("model3d_reference_source_unavailable");
  const block = projected[0]!, fact = selected[0]!, properties = record(fact.properties);
  if (block.removed || block.scope !== "document" || block.documentId !== scope.documentId || block.projectId !== scope.projectId
    || block.type !== fact.type || !["reference", "model3d"].includes(block.type)) fail("model3d_reference_source_unavailable");
  const captured = () => JSON.stringify({
    scope: [scope.kind, scope.ownerUserId, scope.actorUserId, scope.projectId, scope.documentId, scope.projectAccessId],
    source: [trusted.sourceDigest, trusted.ownerHead],
    block: [block.type, block.scope, block.removed, block.documentId, block.projectId, block.properties],
    fact: fact,
    referenceEvents: trusted.events.filter(event => ["RightsAsserted", "ReferenceIngested"].includes(event.type)
      && [selection.referenceId, properties.model_reference_id].includes(event.payload.reference_id as string)),
  });
  const before = captured(), sourceDigest = trusted.sourceDigest, ownerHead = trusted.ownerHead;
  if (properties.reference_id !== selection.referenceId || properties.source_content_hash !== selection.sha256
    || block.properties.reference_id !== selection.referenceId || block.properties.source_content_hash !== selection.sha256
    || block.properties.media_url !== properties.media_url) fail("model3d_reference_hash_required");
  const mediaUrl = properties.media_url;
  if (typeof mediaUrl !== "string" || !mediaUrl.startsWith("/api/media/") || /[?#]/u.test(mediaUrl)) fail("model3d_reference_private_media_required");
  let key: string;
  try { key = decodeURIComponent(mediaUrl.slice("/api/media/".length)); } catch { return fail("model3d_reference_private_media_required"); }
  if (!key || key.includes("\\") || key.split("/").some(part => part === "." || part === "..")
    || !mediaKeyMatchesOwnerNamespace(key, scope.ownerUserId)) fail("model3d_reference_private_media_required", 403);
  const ingestion = (referenceId: string) => trusted.events.findLast(event => event.type === "ReferenceIngested" && event.payload.reference_id === referenceId);
  const imageReceipt = ingestion(selection.referenceId);
  if (!imageReceipt || (imageReceipt.payload.source_ref ?? imageReceipt.payload.media_url) !== mediaUrl
    || imageReceipt.payload.content_hash !== selection.sha256) fail("model3d_reference_retained_hash_required");

  let savedModel: Model3dReferenceInspection["savedModel"] = null;
  if (selection.kind === "saved-model-view") {
    const view = normalizeModel3dView(properties.model_view), referenceId = properties.model_reference_id;
    const modelReceipt = typeof referenceId === "string" ? ingestion(referenceId) : null;
    if (block.type !== "model3d" || !view || typeof referenceId !== "string" || !referenceId
      || !hash(properties.model_content_hash) || !modelReceipt
      || (modelReceipt.payload.source_ref ?? modelReceipt.payload.media_url) !== properties.model_url
      || modelReceipt.payload.content_hash !== properties.model_content_hash) fail("model3d_reference_saved_view_unavailable");
    Object.freeze(view.position); Object.freeze(view.target); Object.freeze(view);
    savedModel = Object.freeze({ referenceId, sha256: properties.model_content_hash, view });
  } else if (block.type !== "reference"
    || ["model_url", "model_view", "model_reference_id", "model_content_hash"].some(field => properties[field] !== undefined)) {
    fail("model3d_reference_kind_changed");
  }
  const assertions = [
    projectIntakeAuthority(env, auth, { projectId: scope.projectId, documentId: scope.documentId }),
    ...trusted.sourceAssertions, ...outputActiveSourceDeadlineAssertions(trusted.context),
  ].map(assertion => ({ sql: assertion.sql, bindings: [...(assertion.bindings ?? [])] }));
  trusted.request.signal.throwIfAborted();
  const head = await env.MEDIA.head(key);
  if (!head || head.customMetadata?.ownerId !== scope.ownerUserId
    || typeof head.size !== "number" || !Number.isSafeInteger(head.size) || head.size < 1 || head.size > MAX_MODEL3D_INTAKE_REFERENCE_BYTES
    || head.customMetadata.sha256 !== undefined && head.customMetadata.sha256 !== selection.sha256) fail("model3d_reference_media_unavailable", 403);
  const headers = new Headers(); head.writeHttpMetadata(headers);
  const mimeType = (headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (!MIME_TYPES.has(mimeType) || selection.kind === "saved-model-view" && mimeType !== "image/png") fail("model3d_reference_image_required");
  // Existing server path preserves pixel opt-in, current rights, derived-source
  // provenance, original model/camera/PNG custody and owner-private byte access.
  // This constant is only a read-preparation placeholder, never sent or saved.
  const prepared = await prepareModel3dRequest({
    env, ownerId: scope.ownerUserId, snapshot: trusted.context.snapshot, sourceEvents: trusted.events,
    prompt: "Inspect the selected reference without generation.", settings: undefined,
    referenceBlockIds: [selection.sourceBlockId],
  });
  trusted.request.signal.throwIfAborted();
  const image = prepared.references[0];
  if (prepared.references.length !== 1 || prepared.referenceBlockIds.length !== 1
    || prepared.referenceBlockIds[0] !== selection.sourceBlockId || !image
    || image.blockId !== selection.sourceBlockId || image.referenceId !== selection.referenceId
    || image.mimeType.split(";")[0]!.trim().toLowerCase() !== mimeType
    || !(image.bytes instanceof Uint8Array) || image.bytes.byteLength !== head.size
    || image.bytes.byteLength > MAX_MODEL3D_INTAKE_REFERENCE_BYTES) fail("model3d_reference_read_mismatch");
  const bytes = new Uint8Array(image.bytes);
  const actual = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
  if (actual !== selection.sha256 || captured() !== before) fail("model3d_reference_source_changed");
  trusted.request.signal.throwIfAborted();
  // Reuse the existing bounded read-only proof batch and exact source-head join;
  // do not combine an arbitrary Document's bindings into one D1 expression.
  await verifyOutputSourceRead(env, scope, ownerHead, assertions);
  if (captured() !== before) fail("model3d_reference_source_changed");
  trusted.request.signal.throwIfAborted();
  return Object.freeze({
    version: 1, qualification: "read-only-reference-inspection", selection, sourceDigest,
    content: Object.freeze({ sha256: actual, byteLength: bytes.byteLength, mimeType }), savedModel,
  });
}

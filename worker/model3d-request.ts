import { sendsReferencePixels } from "../src/model/block-types.ts";
import { audioRightsAllowed } from "../src/model/audio.ts";
import { promptFactIsActive } from "../src/model/prompt-policy.ts";
import { validateModel3dRequest, type Model3dSettings } from "../src/model/model3d.ts";
import { adaptDocumentToModel3d, model3dAdaptationReceipt } from "../src/model/model3d-prompt-adapter.ts";
import type { CreativeEvent } from "../src/model/events.ts";
import type { ProjectExecutionScope } from "./pilot-policy.ts";
import { readGeneratedImageReference, verifyModel3dBlockAssets } from "./media-api.ts";
import { ProviderRequestError } from "./provider-errors.ts";
import type { WorkerEnv } from "./runtime.ts";
import { assertDerivedReferenceProvenance } from "./derived-reference-guard.ts";

export type Model3dReferenceInput = {
  bytes: Uint8Array;
  mimeType: string;
  blockId: string;
  referenceId: string;
  label: string;
};

export type PreparedModel3dRequest = {
  prompt: string;
  settings: Model3dSettings;
  model: ReturnType<typeof validateModel3dRequest>["model"];
  estimatedCostMicrousd: number;
  references: Model3dReferenceInput[];
  referenceBlockIds: string[];
  promptSource?: "document";
  adaptation?: ReturnType<typeof model3dAdaptationReceipt>;
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

function reject(code: string, message: string, blockId?: string, referenceId?: string, status = 422): never {
  throw new ProviderRequestError({ code, category: "provider", scope: "request", action: "edit_request", message,
    retryable: false, retryAfterMs: null, requestId: null, httpStatus: status,
    ...(blockId ? { contributingBlockIds: [blockId] } : {}),
    ...(referenceId ? { contributingReferenceIds: [referenceId] } : {}),
  });
}

export function model3dReferenceSelection(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 5 || value.some((id) => typeof id !== "string" || !id.trim() || id !== id.trim())
    || new Set(value).size !== value.length) {
    reject("model3d_reference_selection_invalid", "Choose up to five different image references in the order to send them. Leave the selection empty for text-to-3D.");
  }
  return [...value] as string[];
}

function rightsConfirmed(events: readonly CreativeEvent[], referenceId: string) {
  const latest = events.findLast((event) => (event.type === "RightsAsserted" || event.type === "ReferenceIngested")
    && String(event.payload.reference_id ?? "") === referenceId);
  return Boolean(referenceId && latest && audioRightsAllowed(latest.payload.rights_class));
}

async function sha256(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Read-only admission. The snapshot must already be rebuilt from authorized source events. */
export async function prepareModel3dRequest(input: {
  env: WorkerEnv;
  ownerId: string;
  snapshot: Record<string, unknown>;
  sourceEvents: readonly CreativeEvent[];
  prompt: unknown;
  promptSource?: unknown;
  adaptation?: unknown;
  settings: unknown;
  referenceBlockIds: unknown;
  projectScope?: ProjectExecutionScope;
}): Promise<PreparedModel3dRequest> {
  const referenceBlockIds = model3dReferenceSelection(input.referenceBlockIds);
  if (input.promptSource !== undefined && input.promptSource !== "exact" && input.promptSource !== "document") {
    reject("model3d_prompt_source_invalid", "Choose document adaptation or an exact 3D prompt.");
  }
  let prompt = input.prompt;
  let adaptation: ReturnType<typeof model3dAdaptationReceipt> | undefined;
  if (input.promptSource === "document") {
    const adapted = adaptDocumentToModel3d(input.snapshot, { referenceCount: referenceBlockIds.length });
    if (!adapted.valid) {
      const issue = adapted.issues[0]!;
      reject(issue.code, issue.message, issue.blockIds[0]);
    }
    adaptation = model3dAdaptationReceipt(adapted);
    const reviewed = record(input.adaptation);
    if (input.prompt !== adapted.prompt || reviewed.adapterVersion !== adaptation.adapterVersion
      || JSON.stringify(reviewed.includedBlockIds) !== JSON.stringify(adaptation.includedBlockIds)
      || JSON.stringify(reviewed.omittedBlockIds) !== JSON.stringify(adaptation.omittedBlockIds)) {
      reject("model3d_document_adaptation_changed", "The document's prepared 3D prompt changed. Reopen Render document to review its current context before generating.", undefined, undefined, 409);
    }
    prompt = adapted.prompt;
  } else if (input.adaptation !== undefined) {
    reject("model3d_prompt_source_invalid", "Document adaptation details require a document-derived 3D request.");
  }
  const checked = validateModel3dRequest({ prompt, settings: input.settings, referenceCount: referenceBlockIds.length });
  if (!checked.valid) {
    const issue = checked.issues[0]!;
    reject(issue.code, issue.message);
  }
  const facts = new Map((Array.isArray(input.snapshot.facts) ? input.snapshot.facts : []).map(record)
    .map((fact) => [String(fact.block_id ?? ""), fact]));
  const references: Model3dReferenceInput[] = [];
  for (const blockId of referenceBlockIds) {
    const fact = facts.get(blockId);
    const properties = record(fact?.properties);
    const referenceId = String(properties.reference_id ?? "");
    if (!fact || !["reference", "model3d"].includes(String(fact.type)) || !promptFactIsActive(fact)
      || !sendsReferencePixels(properties.pixel_reference_mode)) {
      reject("model3d_reference_not_authorized", "Choose an active image reference or saved 3D view with permission to send its pixels.", blockId, referenceId, 403);
    }
    if (!rightsConfirmed(input.sourceEvents, referenceId)) {
      reject("model3d_reference_rights_required", "Confirm owned, licensed, or account-generated rights for each selected reference before generating a 3D model.", blockId, referenceId, 403);
    }
    if (properties.context_reference_kind === "character_identity" && properties.pixel_reference_mode === "preserve_subject"
      && properties.likeness_transfer_consent !== true) {
      reject("character_likeness_consent_required", "Confirm permission to use this character's likeness before sending its image.", blockId, referenceId, 403);
    }
    await assertDerivedReferenceProvenance({ env: input.env, ownerId: input.ownerId, properties, blockId,
      sourceEvents: input.sourceEvents, projectScope: input.projectScope });
    if (fact.type === "model3d") {
      const modelReferenceId = String(properties.model_reference_id ?? "");
      if (!rightsConfirmed(input.sourceEvents, modelReferenceId)) {
        reject("model3d_source_rights_required", "Confirm rights to the original 3D model before sending a saved view of it.", blockId, modelReferenceId, 403);
      }
      if (!await verifyModel3dBlockAssets(input.env, input.ownerId, properties, input.projectScope?.projectAccessId ?? "")) {
        reject("model3d_view_unavailable", "Open this 3D model and save its reference view again before generating.", blockId, referenceId, 403);
      }
    }
    const mediaUrl = String(properties.media_url ?? "");
    let mediaKey = "";
    try { if (mediaUrl.startsWith("/api/media/")) mediaKey = decodeURIComponent(mediaUrl.slice("/api/media/".length)); } catch { /* Invalid URLs never reach storage. */ }
    if (input.projectScope) {
      const scope = input.projectScope;
      const authorized = mediaKey ? await input.env.DB.prepare(`SELECT 1 AS present FROM project_resource_scopes media
        JOIN project_resource_scopes block ON block.project_access_id=media.project_access_id AND block.organization_id=media.organization_id
          AND block.project_id=media.project_id AND block.owner_user_id=media.owner_user_id AND block.resource_kind='block' AND block.resource_id=?
        JOIN project_resource_scopes reference ON reference.project_access_id=media.project_access_id AND reference.organization_id=media.organization_id
          AND reference.project_id=media.project_id AND reference.owner_user_id=media.owner_user_id AND reference.resource_kind='reference' AND reference.resource_id=?
        WHERE media.project_access_id=? AND media.organization_id=? AND media.project_id=? AND media.owner_user_id=? AND media.resource_kind='media' AND media.resource_id=?`)
        .bind(blockId, referenceId, scope.projectAccessId, scope.organizationId, scope.projectId, scope.ownerUserId, mediaKey).first() : null;
      if (!authorized) reject("model3d_reference_project_scope_invalid", "This reference is not available in the selected project and document.", blockId, referenceId, 403);
    }
    const image = await readGeneratedImageReference(input.env, input.ownerId, mediaUrl);
    if (!image) reject("model3d_reference_image_unavailable", "Choose an available image or save a PNG view of the 3D model before generating.", blockId, referenceId);
    const ingested = input.sourceEvents.findLast((event) => event.type === "ReferenceIngested"
      && String(event.payload.reference_id ?? "") === referenceId
      && String(event.payload.source_ref ?? event.payload.media_url ?? "") === mediaUrl);
    if (!ingested) reject("model3d_reference_source_mismatch", "The selected image does not match its saved source. Save or re-upload the reference before generating.", blockId, referenceId, 403);
    const hashes = [properties.source_content_hash, ingested.payload.content_hash].filter((hash): hash is string => typeof hash === "string" && /^[a-f0-9]{64}$/iu.test(hash));
    if (hashes.length) {
      const actualHash = await sha256(image.bytes);
      if (hashes.some((hash) => hash.toLowerCase() !== actualHash)) reject("model3d_reference_integrity_mismatch", "The selected reference bytes changed. Save or re-upload the reference before generating.", blockId, referenceId, 403);
    }
    references.push({ bytes: image.bytes, mimeType: image.mimeType, blockId, referenceId, label: String(properties.label ?? fact.handle ?? "Reference image") });
  }
  const final = validateModel3dRequest({ prompt, settings: input.settings, referenceCount: references.length, referenceMimeTypes: references.map((reference) => reference.mimeType) });
  if (!final.valid) reject(final.issues[0]!.code, final.issues[0]!.message);
  return { prompt: typeof prompt === "string" ? prompt : "", settings: final.settings, model: final.model,
    estimatedCostMicrousd: final.estimatedCostMicrousd, references, referenceBlockIds,
    ...(adaptation ? { promptSource: "document", adaptation } : {}) };
}

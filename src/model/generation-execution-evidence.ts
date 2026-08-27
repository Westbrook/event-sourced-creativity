import { providerSubmissions } from "./provider-submission.ts";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" && value.trim() ? value : null;
const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

/** Explicit render-policy rejection only; a queue, result, or CDN HTTP error is not an output verdict. */
export function knownProviderRejection(failure: unknown) {
  const detail = record(failure);
  return Boolean(text(detail.requestId) && detail.httpStatus === 422 && detail.code === "fal_content_policy_violation"
    && detail.category === "safety" && detail.retryable === false);
}

/** Read-only presentation of retained evidence. Never changes a submission or a reservation. */
export function generationExecutionSummary(checkpoint: Record<string, unknown>, failure: unknown = null) {
  const receipt = record(checkpoint.generationReceipt);
  // The server removes private observer records after deriving this projection.
  // A second client-side projection cannot disprove its known pending calls.
  if (receipt.execution_evidence_version === 1 && !Object.hasOwn(checkpoint, "providerSubmissions")) return { ...receipt };
  const submissions = providerSubmissions(checkpoint);
  const confirmed = submissions.filter((entry) => entry.status !== "pending");
  const mediaRequests = new Set(confirmed.filter((entry) => entry.operation !== "planning").map((entry) => `${entry.provider}:${entry.providerRequestId ?? entry.clientRequestId}`));
  const addMedia = (value: unknown, defaultProvider = "fal") => {
    const item = record(value), id = text(item.providerJobId) ?? text(item.provider_job_id) ?? text(item.provider_request_id);
    if (id) mediaRequests.add(`${text(item.provider) ?? defaultProvider}:${id}`);
  };
  // Legacy accepted media predates the generic submission observer. Reconcile identities, never add it twice.
  if (text(checkpoint.providerJobId)) addMedia(checkpoint);
  addMedia(checkpoint.productionAnchor);
  for (const scene of Object.values(record(checkpoint.productionSceneReceipts))) addMedia(scene);
  for (const frame of Array.isArray(checkpoint.productionFrameReceipts) ? checkpoint.productionFrameReceipts : Object.values(record(checkpoint.productionFrameReceipts))) addMedia(frame);
  for (const item of Array.isArray(checkpoint.renderedItems) ? checkpoint.renderedItems : []) addMedia(item);
  const plannerInput = record(checkpoint.plannerInput);
  const plannerIds = Array.isArray(checkpoint.plannerResponseIds) ? new Set(checkpoint.plannerResponseIds.filter((id) => typeof id === "string" && id)) : new Set();
  const plannerCount = Math.max(plannerIds.size, count(plannerInput.provider_request_count) ?? 0,
    confirmed.filter((entry) => entry.operation === "planning").length);
  const retainedTotal = count(receipt.actual_provider_call_count);
  const identifiedTotal = plannerCount + mediaRequests.size;
  const breakdownComplete = retainedTotal === null || retainedTotal <= identifiedTotal;
  const pending = submissions.filter((entry) => entry.status === "pending");
  const legacyPending = checkpoint.providerSubmissionLegacyUncertain === true
    || checkpoint.audioProviderSubmission === "pending" && !text(checkpoint.providerJobId) && !pending.some((entry) => entry.operation === "audio")
    || checkpoint.storyboardProviderSubmission === "pending" && !text(checkpoint.providerJobId) && !pending.some((entry) => entry.operation === "image")
    || checkpoint.presentationProviderSubmission === "pending" && !text(checkpoint.plannerResponseId) && !pending.some((entry) => entry.operation === "planning");
  const rejected = knownProviderRejection(failure);
  const scenes = Object.values(record(checkpoint.productionSceneReceipts)).map(record);
  const retainedCount = count(checkpoint.productionCompletedSceneCount)
    ?? (Array.isArray(checkpoint.renderedItems) ? checkpoint.renderedItems.filter((item) => text(record(item).media_url)).length : null);
  return {
    ...receipt,
    execution_evidence_version: 1,
    ...(rejected ? {
      recorded_provider_request_status: receipt.recorded_provider_request_status ?? receipt.provider_request_status ?? "unknown",
      provider_request_status: "rejected", provider_contacted: true, failure_stage: "provider",
      request_outcome_basis: "retained_provider_error_response",
    } : {}),
    ...(submissions.length || identifiedTotal ? {
      actual_planner_call_count: breakdownComplete ? plannerCount : null,
      actual_media_call_count: breakdownComplete ? mediaRequests.size : null,
      unresolved_provider_call_count: legacyPending ? null : pending.length,
      provider_submission_uncertain: legacyPending || pending.length > 0,
      actual_provider_call_count: Math.max(retainedTotal ?? 0, identifiedTotal),
      provider_call_breakdown_complete: breakdownComplete,
    } : legacyPending ? { unresolved_provider_call_count: null, provider_submission_uncertain: true } : {}),
    ...(receipt.maximum_provider_call_count !== undefined ? { provider_call_forecast_scope: "planning" } : {}),
    ...(retainedCount !== null && (checkpoint.artifactKind === "video" || scenes.length) ? { retained_clip_count: retainedCount } : {}),
  };
}

/** Only call on the already actor-authorized private job detail, never a project list. */
export function managedProductionInputEvidence(checkpoint: Record<string, unknown>, failure: unknown = null) {
  const failedId = knownProviderRejection(failure) ? text(record(failure).requestId) : null;
  const sourceScenes = record(checkpoint.productionSceneReceipts);
  const scenes = Object.entries(sourceScenes).flatMap(([id, value]) => {
    const scene = record(value);
    if (!Object.keys(scene).length || scene.sceneId !== id) return [];
    const prepared = record(scene.videoInputReceipt);
    const providerRequestId = text(scene.providerJobId);
    return [{
      scene_id: id, narrative_order: count(scene.narrativeOrder), generation_order: count(scene.generationOrder),
      request_status: failedId && providerRequestId === failedId ? "rejected" : text(scene.status) ?? "unknown",
      provider_request_id: providerRequestId, provider: text(prepared.provider), model: text(scene.providerModel) ?? text(prepared.model),
      duration_seconds: count(scene.durationSeconds),
      input_status: Object.keys(prepared).length ? providerRequestId ? "submitted" : "prepared" : "unavailable",
      render_input: Object.keys(prepared).length ? {
        provider: prepared.provider ?? null, model: prepared.model ?? null, submitted_prompt: prepared.submitted_prompt ?? null,
        parameters: prepared.parameters ?? null, reference_inputs: Array.isArray(prepared.reference_inputs) ? prepared.reference_inputs : null,
        used_reference_pixels: typeof prepared.used_reference_pixels === "boolean" ? prepared.used_reference_pixels : null, adaptation: prepared.adaptation ?? null,
      } : null,
    }];
  }).sort((left, right) => (left.narrative_order ?? 0) - (right.narrative_order ?? 0));
  const sourceAnchor = record(checkpoint.productionAnchor);
  const anchor = Object.keys(sourceAnchor).length ? {
    scene_id: text(sourceAnchor.sceneId), source: text(sourceAnchor.source), rights: text(sourceAnchor.rights),
    provider: text(sourceAnchor.provider), model: text(sourceAnchor.providerModel), provider_request_id: text(sourceAnchor.providerJobId),
    media_stored: text(sourceAnchor.mediaUrl) ? true : null, frame_guidance: text(sourceAnchor.frameGuidance),
    // Older anchors retain identity/provenance, not a final provider parameter receipt.
    render_input: null,
  } : null;
  return scenes.length || anchor ? { scenes, anchor } : null;
}

/** Missing private scene receipts cannot turn a managed planning narrative into a final wire prompt. */
export function isManagedVideoInspection(receipt: Record<string, unknown>) {
  const job = record(receipt.job), accounting = record(receipt.generation_receipt), checkpoint = record(receipt.artifact_checkpoint);
  return Boolean(checkpoint.managed_inputs) || (job.artifact_kind === "video" || accounting.artifact_kind === "video")
    && (job.production_mode === "managed" || accounting.production_mode === "managed" || record(record(receipt.private_input).request).production_mode === "managed");
}

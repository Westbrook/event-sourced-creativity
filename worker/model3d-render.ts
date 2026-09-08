import type { CreativeEvent, CreativeProjection } from "../src/model/events.ts";
import { Model3dInputError, RODIN_ADAPTER_VERSION } from "../src/model/model3d.ts";
import { hasUnresolvedProviderSubmission, hasUnsettledProviderSubmission, providerSubmissions } from "../src/model/provider-submission.ts";
import type { EventExecutionControl } from "./events-api.ts";
import { generateFalModel3d, type Model3dPreparedReceipt } from "./fal-model3d-adapter.ts";
import { storeGeneratedMedia } from "./media-api.ts";
import type { PreparedModel3dRequest } from "./model3d-request.ts";
import {
  claimCostBudgetReservation, costBudgetReservation, releaseBudget, releaseCostBudget, reserveBudget, reserveCostBudget,
  settleBudget, settleCostBudget, settleDocumentGenerationBudgets, storePrivateContent,
  type PilotUser, type ProjectBudgetScope, type ProjectExecutionScope,
} from "./pilot-policy.ts";
import { applicationFailureDetail, classifyProviderFailure, publicFailureDetail, type ProviderFailureDetail } from "./provider-errors.ts";
import { paidProviderObserver } from "./provider-submission.ts";
import { appendEvents, makeEvent, streamHead, uuidV7, type EventRow, type WorkerEnv } from "./runtime.ts";

export type Model3dRenderInput = {
  env: WorkerEnv;
  user: PilotUser;
  body: Record<string, unknown>;
  sourceEvents: readonly CreativeEvent[];
  projection: CreativeProjection;
  ownerId: string;
  storageOwnerId: string;
  billingOwnerId: string;
  streamId: string;
  client: string;
  corr: string;
  userActor: string;
  projectBudgetScope?: ProjectBudgetScope;
  executionScope?: ProjectExecutionScope;
  execution?: EventExecutionControl;
  appendOperationEvents: typeof appendEvents;
  settleOperationOutputBudgets: (input: Parameters<typeof settleDocumentGenerationBudgets>[2]) => ReturnType<typeof settleDocumentGenerationBudgets>;
  prepared: PreparedModel3dRequest;
};

const OPERATION = "document-render:model3d";
// The ledger requires a positive token hold. Rodin makes no text-model call and
// consumes none of this technical reservation.
const RESERVED_TOKENS = 1;
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" ? value : "";
type StoredModel3dFile = { url: string; mimeType: string; fileName: string; fileSize: number; format: string | null; role: "mesh" | "texture" | "preview"; sha256: string; previewSupported?: boolean };

function failureFields(detail: ProviderFailureDetail) {
  return {
    error_class: detail.category, error_code: detail.code, error_category: detail.category, error_scope: detail.scope,
    error_action: detail.action, error_message: detail.message, retryable: detail.retryable, retry_after_ms: detail.retryAfterMs,
    provider_request_id: detail.requestId, http_status: detail.httpStatus, risk_categories: detail.riskCategories ?? [],
    contributing_block_ids: detail.contributingBlockIds ?? [], contributing_reference_ids: detail.contributingReferenceIds ?? [],
  };
}

function uncertainSubmissionDetail(requestId: string | null = null): ProviderFailureDetail {
  return {
    code: "provider_submission_uncertain", category: "network", scope: "network", action: "contact_support",
    message: "The 3D request may already have reached Rodin, but its receipt is incomplete. The original reservation is held; another paid request will not be submitted automatically.",
    retryable: false, retryAfterMs: null, requestId, httpStatus: null,
  };
}

/**
 * Execute the reviewed Rodin request directly. Source authorization, reference
 * ownership, prompt/settings validation, and paid consent are checked by the
 * caller before this lifecycle receives PreparedModel3dRequest.
 */
export async function handleModel3dRender(input: Model3dRenderInput): Promise<Response> {
  const { user, body, sourceEvents, projection, ownerId, storageOwnerId, billingOwnerId, streamId, client, corr,
    userActor, projectBudgetScope, executionScope, execution, appendOperationEvents, settleOperationOutputBudgets, prepared } = input;
  const env = execution?.output?.guardedEnvironment ?? input.env;
  const artifactId = text(body.artifactId) || uuidV7();
  const sourceSurface = text(body.sourceSurface) || "document";
  const sourceBlockVersions = Array.isArray(body.sourceBlockVersions) ? body.sourceBlockVersions : [];
  const snapshot = record(body.snapshot);
  const workflowLineage = body.workflowId && body.workflowStageId ? {
    workflow_id: body.workflowId, workflow_stage_id: body.workflowStageId, workflow_sources: body.workflowSources ?? [],
  } : {};
  const sourceReceipt = { document_id: projection.documentId, project_id: projection.projectId, source_block_versions: sourceBlockVersions };
  const estimatedCostMicrousd = prepared.estimatedCostMicrousd;

  // These fields are supplied only by the worker's durable job checkpoint.
  // A browser receipt cannot authorize a provider poll or reuse an account hold.
  if (!execution && (body.providerJobId || body.model3dInputReceipt || body.providerSubmissions || body.reservationId || body.costReservationId)) {
    return Response.json({ error: "model3d_recovery_requires_saved_job", message: "Resume this 3D generation from its saved job so its original provider receipt can be verified." }, { status: 409 });
  }
  const savedSubmissions = providerSubmissions(body).filter(receipt => receipt.operation === "model3d" && receipt.provider === "fal"
    && (receipt.status === "accepted" || receipt.status === "completed") && receipt.providerRequestId);
  // A crash can follow the generic paid receipt and precede the queue-URL
  // checkpoint. The verified request ID is sufficient for the adapter's GETs.
  const recoveredSubmission = execution && !body.providerJobId && savedSubmissions.length === 1 ? savedSubmissions[0] : undefined;
  let activeProviderJobId = text(body.providerJobId) || recoveredSubmission?.providerRequestId || "";
  let activeProviderModel = activeProviderJobId ? text(body.providerModel) || prepared.model : prepared.model;
  let activeProviderStatusUrl = text(body.providerStatusUrl);
  let activeProviderResponseUrl = text(body.providerResponseUrl);
  let activeProviderCancelUrl = text(body.providerCancelUrl);
  let preparedReceipt = execution && activeProviderJobId && body.model3dInputReceipt ? body.model3dInputReceipt as Model3dPreparedReceipt : undefined;
  const retainedSubmission = savedSubmissions.find(receipt => receipt.operation === "model3d"
    && receipt.provider === "fal" && receipt.model === activeProviderModel && receipt.providerRequestId === activeProviderJobId
    && (receipt.status === "accepted" || receipt.status === "completed"));
  if (hasUnresolvedProviderSubmission(body)) {
    const detail = uncertainSubmissionDetail(activeProviderJobId || null);
    return Response.json({ error: detail.code, errorDetail: publicFailureDetail(detail), artifactId, artifactKind: "model3d" }, { status: 409 });
  }
  if (activeProviderJobId && (!preparedReceipt || !retainedSubmission)) {
    return Response.json({ error: "model3d_recovery_receipt_missing", message: "The original 3D provider receipt is unavailable. Keep its reservation and recover the saved job before starting another request." }, { status: 409 });
  }
  const completedSubmission = retainedSubmission?.status === "completed" && retainedSubmission.costMicrousd === estimatedCostMicrousd;
  const previousCompleted = sourceEvents.find(event => event.type === "DocumentRenderCompleted" && event.correlationId === corr
    && event.payload.artifact_id === artifactId && event.payload.artifact_kind === "model3d");
  if (previousCompleted) {
    const previousUsage = sourceEvents.find(event => event.type === "GenerationUsageRecorded" && event.correlationId === corr
      && event.payload.artifact_id === artifactId && event.payload.operation === OPERATION);
    if (previousUsage) return Response.json({
      appended: [previousCompleted, previousUsage], artifactId, artifactKind: "model3d", provider: "fal",
      providerJobId: previousCompleted.payload.provider_job_id, head: Math.max(previousCompleted.sequence, previousUsage.sequence), idempotent: true,
    });
  }
  if (sourceEvents.some(event => event.type === "DocumentRenderCompleted" && event.payload.artifact_id === artifactId && event.correlationId !== corr)) {
    return Response.json({ error: "artifact_identity_already_used", message: "This artifact already belongs to a completed render. Start a new 3D render with a new artifact identity." }, { status: 409 });
  }

  let reservationId = execution?.output?.reservations.reservationId ?? text(body.reservationId);
  let costReservationId = execution?.output?.reservations.costReservationId ?? text(body.costReservationId);
  let costReservationPeriod = execution?.output?.reservations.costReservationPeriod ?? text(body.costReservationPeriod);
  let costReservationMicrousd = execution?.output?.reservations.costReservationMicrousd ?? 0;
  let reservationCreated = false;
  let costReservationSettled = false;
  let phase: "preparing" | "provider" | "persistence" = "preparing";
  let finalPublicationUnconfirmed = false;
  let requestEvent: EventRow | null = null;
  let budgeted: EventRow | null = null;
  const accounting = () => ({ artifactId, reservationId, costReservationId, costReservationPeriod, costReservationMicrousd });
  const checkpoint = () => ({
    ...accounting(), provider: "fal", providerJobId: activeProviderJobId, providerModel: activeProviderModel,
    providerStatusUrl: activeProviderStatusUrl, providerResponseUrl: activeProviderResponseUrl, providerCancelUrl: activeProviderCancelUrl,
    model3dSettings: prepared.settings, model3dEstimatedCostMicrousd: estimatedCostMicrousd,
    ...(preparedReceipt ? { model3dInputReceipt: preparedReceipt } : {}),
  });
  const failBudget = async (scope: string, reason: string) => {
    const denied = makeEvent(streamId, await streamHead(env, streamId) + 1, "worker:policy", client, corr, "BudgetExceeded", {
      ...sourceReceipt, artifact_id: artifactId, artifact_kind: "model3d", operation: OPERATION,
      reason, scope, reserved_tokens: 0, estimated_cost_microusd: estimatedCostMicrousd,
    });
    await appendOperationEvents(env, [denied]);
    const detail = applicationFailureDetail("budget_hard_cap_reached", scope, 429);
    return Response.json({ error: detail.code, errorDetail: publicFailureDetail(detail), scope, appended: [denied], head: denied.sequence }, { status: 429 });
  };

  if (reservationId) {
    const token = await env.DB.prepare("SELECT stream_id,correlation_id,operation,period,reserved_tokens,used_tokens,status FROM budget_reservations WHERE reservation_id=? AND owner_id=?")
      .bind(reservationId, billingOwnerId).first<{ stream_id: string; correlation_id: string; operation: string; period: string; reserved_tokens: number; used_tokens: number; status: string }>();
    if (!token || token.stream_id !== streamId || token.correlation_id !== corr || token.operation !== OPERATION
      || token.reserved_tokens !== RESERVED_TOKENS || token.status !== "active" && !(completedSubmission && token.status === "released" && token.used_tokens === 0)
      || costReservationPeriod && token.period !== costReservationPeriod) {
      return Response.json({ error: "model3d_token_reservation_invalid", message: "The saved 3D reservation no longer matches this request." }, { status: 409 });
    }
    costReservationPeriod = token.period;
  } else {
    const reservation = await reserveBudget(env, billingOwnerId, RESERVED_TOKENS, { streamId, correlationId: corr, operation: OPERATION, projectScope: projectBudgetScope });
    if (!reservation.ok) return failBudget(reservation.scope, "hard_cap_reached");
    reservationId = reservation.reservationId;
    costReservationPeriod = reservation.period;
    reservationCreated = true;
  }

  let alreadyClaimed = false;
  if (costReservationId) {
    const existing = await costBudgetReservation(env, billingOwnerId, costReservationId);
    const retainedExecuting = Boolean(activeProviderJobId && retainedSubmission && existing?.status === "executing");
    const retainedSettled = Boolean(activeProviderJobId && completedSubmission && existing?.status === "settled" && existing.used_microusd === estimatedCostMicrousd);
    if (!existing || existing.stream_id !== streamId || existing.correlation_id !== corr || existing.operation !== OPERATION
      || existing.period !== costReservationPeriod || existing.reserved_microusd !== estimatedCostMicrousd
      || existing.status !== "active" && !retainedExecuting && !retainedSettled) {
      if (reservationCreated) await releaseBudget(env, billingOwnerId, reservationId, { reason: "document_model3d_cost_reservation_invalid" });
      return Response.json({ error: "cost_reservation_invalid_or_expired" }, { status: 409 });
    }
    costReservationMicrousd = existing.reserved_microusd;
    alreadyClaimed = retainedExecuting || retainedSettled;
    costReservationSettled = retainedSettled;
  } else {
    const reservation = await reserveCostBudget(env, billingOwnerId, estimatedCostMicrousd, {
      maximumMicrousd: estimatedCostMicrousd, allowUserOverage: false, streamId, correlationId: corr, operation: OPERATION,
      period: costReservationPeriod, projectScope: projectBudgetScope,
    });
    if (!reservation.ok) {
      if (reservationCreated) await releaseBudget(env, billingOwnerId, reservationId, { reason: "document_model3d_cost_cap_reached" });
      return failBudget(reservation.scope, "monthly_cost_cap_reached");
    }
    costReservationId = reservation.reservationId;
    costReservationMicrousd = reservation.reservedMicrousd;
    costReservationPeriod = reservation.period;
  }
  if (!alreadyClaimed && !await claimCostBudgetReservation(env, billingOwnerId, costReservationId)) {
    if (reservationCreated) await releaseBudget(env, billingOwnerId, reservationId, { reason: "document_model3d_cost_reservation_claim_conflict" });
    return Response.json({ error: "cost_reservation_already_in_use" }, { status: 409 });
  }

  // Checkpoint the reservation before any upload or provider call. Recovery uses
  // the same artifact and budget identities even when the next write is lost.
  Object.assign(body, checkpoint());
  const persistPaid = paidProviderObserver(body, execution?.progress, accounting(), execution?.output?.observeProvider);
  const observePaid: typeof persistPaid = async receipt => {
    await persistPaid(receipt);
    if (receipt.status === "accepted" || receipt.status === "completed") prepared.references.length = 0;
    if (receipt.providerRequestId) activeProviderJobId = receipt.providerRequestId;
    activeProviderModel = receipt.model;
    const marker = receipt.status === "pending" ? "pending" : receipt.status === "rejected" ? "rejected" : "confirmed";
    const patch = { ...checkpoint(), model3dProviderSubmission: marker };
    Object.assign(body, patch);
    await execution?.progress("provider-receipt", receipt.status === "rejected" ? "Rodin rejected the request before accepting paid generation." : "The original 3D provider request and its current status are saved.", patch,
      execution?.output && receipt.status !== "pending" ? { financialReceiptPersisted: true } : undefined);
  };
  const recordedCostMicrousd = () => sourceEvents.filter(event => event.type === "GenerationUsageRecorded"
    && (event.payload.operation === OPERATION || text(event.payload.operation).startsWith(`${OPERATION}:`))
    && event.payload.reservation_id === reservationId && event.payload.cost_reservation_id === costReservationId
    && (!event.payload.provider_job_id || event.payload.provider_job_id === activeProviderJobId))
    .reduce((total, event) => total + Math.max(0, Number(event.payload.cost_microusd) || 0), 0);
  try {
    await execution?.progress("preparing", activeProviderJobId ? "Recovering the original Rodin request." : "Preparing the reviewed 3D prompt and selected image views.", checkpoint());
    let sequence = await streamHead(env, streamId);
    requestEvent = makeEvent(streamId, ++sequence, userActor, client, corr, "DocumentRenderRequested", {
      ...sourceReceipt, ...workflowLineage, artifact_id: artifactId, artifact_kind: "model3d", item_count: 0,
      source_surface: sourceSurface, request_key: body.requestKey ?? null, paid_media_confirmed: body.paidMediaConfirmed === true,
      model_id: prepared.model, estimated_cost_microusd: estimatedCostMicrousd, resumed_provider_job: Boolean(activeProviderJobId),
      model3d_reference_block_ids: prepared.referenceBlockIds, adapter_version: RODIN_ADAPTER_VERSION,
    });
    if (!sourceEvents.some(event => event.type === "BudgetReserved" && event.payload.reservation_id === reservationId)) budgeted = makeEvent(streamId, ++sequence, "worker:policy", client, corr, "BudgetReserved", {
      operation: OPERATION, artifact_id: artifactId, artifact_kind: "model3d", reservation_id: reservationId, cost_reservation_id: costReservationId,
      reserved_tokens: RESERVED_TOKENS, reserved_microusd: costReservationMicrousd, period: costReservationPeriod,
      resumed_provider_job: Boolean(activeProviderJobId),
    }, { causationId: requestEvent.eventId });
    await appendOperationEvents(env, budgeted ? [requestEvent, budgeted] : [requestEvent]);

    const files: StoredModel3dFile[] = [];
    phase = "provider";
    const generated = await generateFalModel3d(env, prepared.prompt, {
      settings: prepared.settings, references: prepared.references, estimatedCostMicrousd: costReservationMicrousd,
      providerJobId: activeProviderJobId || undefined, providerModel: activeProviderModel,
      providerStatusUrl: activeProviderStatusUrl || undefined, providerResponseUrl: activeProviderResponseUrl || undefined,
      providerCancelUrl: activeProviderCancelUrl || undefined, retainedReceipt: preparedReceipt, retainedSubmission,
      signal: execution?.signal, onProviderSubmission: observePaid, retainFileBytes: false,
      onResultManifest: async providerFiles => {
        body.model3dProviderFiles = providerFiles;
        await execution?.progress("saving", "The provider's original 3D file locations are saved before downloading them.", {
          ...checkpoint(), model3dProviderFiles: providerFiles,
        });
      },
      onGeneratedFile: async (asset, index) => {
        execution?.signal.throwIfAborted();
        phase = "persistence";
        const stored = await storeGeneratedMedia(env, storageOwnerId, index === 0 ? artifactId : `${artifactId}-${asset.role}-${index}`, asset.bytes, activeProviderModel, asset.mimeType, {
          artifactRole: `document-model3d-${asset.role}`, artifactId, documentId: projection.documentId, projectId: projection.projectId,
          actorUserId: user.userId, provider: "fal", providerJobId: activeProviderJobId, providerRequestId: activeProviderJobId,
          providerModel: activeProviderModel, providerMediaUrl: asset.providerMediaUrl, sha256: asset.sha256,
          fileName: asset.fileName, fileSize: String(asset.fileSize), ...(asset.format ? { format: asset.format, modelFormat: asset.format } : {}), mediaKind: "model3d", source: "provider-generated-media",
        });
        files[index] = { url: stored.url, mimeType: asset.mimeType, fileName: asset.fileName, fileSize: asset.fileSize,
          format: asset.format, role: asset.role, sha256: stored.contentHash,
          ...(stored.previewSupported !== undefined ? { previewSupported: stored.previewSupported } : {}) };
        phase = "provider";
      },
      ...(execution?.output ? {
        onBeforeSourceTransmission: execution.output.beforeSourceTransmission,
        onBeforeProviderAttempt: execution.output.beforeProviderAttempt,
        onBeforeProviderDispatch: execution.output.beforeProviderDispatch,
      } : {}),
      onPrepared: async receipt => {
        preparedReceipt = receipt;
        Object.assign(body, checkpoint());
        await execution?.progress("prepared", "The exact Rodin prompt, settings, and ordered reference views are saved.", checkpoint());
      },
      onStage: async (stage, message) => {
        const patch = checkpoint();
        Object.assign(body, patch);
        await execution?.progress(stage, message, patch);
      },
      onReceipt: async receipt => {
        activeProviderJobId = receipt.providerJobId;
        activeProviderModel = receipt.model;
        activeProviderStatusUrl = receipt.providerStatusUrl;
        activeProviderResponseUrl = receipt.providerResponseUrl;
        activeProviderCancelUrl = receipt.providerCancelUrl;
        const patch = { ...checkpoint(), model3dProviderSubmission: "confirmed" };
        Object.assign(body, patch);
        await execution?.progress("queued", "Rodin accepted the 3D request. The saved provider receipt will resume this same generation.", patch);
      },
    });
    activeProviderJobId = generated.providerJobId;
    activeProviderModel = generated.model;
    activeProviderStatusUrl = generated.providerStatusUrl;
    activeProviderResponseUrl = generated.providerResponseUrl;
    activeProviderCancelUrl = generated.providerCancelUrl;
    preparedReceipt = generated.preparedReceipt;
    Object.assign(body, checkpoint());

    phase = "persistence";
    if (!files[0] || files.length !== 1 + generated.additionalMeshes.length + generated.textures.length) throw new Error("model3d_private_files_incomplete");
    const primary = files[0]!;
    const plan = {
      title: projection.documentTitle ? `${projection.documentTitle} · 3D model` : "3D model",
      summary: prepared.prompt || "3D model generated from the selected image views.",
      content_markdown: prepared.prompt, presentation: null, items: [],
    };
    const inputReceipt = {
      schema_version: 1, artifact_id: artifactId, artifact_kind: "model3d", ...sourceReceipt, captured_at: new Date().toISOString(),
      request: { ...workflowLineage, model3d_prompt: prepared.prompt, model3d_settings: prepared.settings,
        model3d_reference_block_ids: prepared.referenceBlockIds, source_surface: sourceSurface,
        ...(body.model3dPromptSource === "document" ? { model3d_prompt_source: "document", model3d_adaptation: body.model3dAdaptation } : {}),
        estimated_cost_microusd: estimatedCostMicrousd, reserved_cost_microusd: costReservationMicrousd },
      document_snapshot: snapshot, planner: null, render: { ...preparedReceipt, submitted_prompt: preparedReceipt.submittedPrompt,
        reference_inputs: preparedReceipt.referenceInputs, used_reference_pixels: preparedReceipt.usedReferencePixels,
        providerJobId: generated.providerJobId, seed: generated.seed },
    };
    await execution?.beginCommit();
    const stored = await storePrivateContent(env, storageOwnerId, "document-artifact", JSON.stringify(plan));
    const inputStored = await storePrivateContent(env, ownerId, "document-artifact-input", JSON.stringify(inputReceipt), executionScope);
    const actualCostMicrousd = generated.costMicrousd;
    if (execution?.output) {
      const settlement = await settleOperationOutputBudgets({ reservationId, costReservationId, usedTokens: 0, usedMicrousd: actualCostMicrousd, reason: "document_model3d_completed" });
      if (settlement.status !== "known") throw new Error("model3d_output_settlement_unconfirmed");
    }
    else {
      await settleBudget(env, billingOwnerId, reservationId, 0, "document_model3d_completed");
      await settleCostBudget(env, billingOwnerId, costReservationId, actualCostMicrousd);
    }
    costReservationSettled = true;
    const next = await streamHead(env, streamId);
    const completed = makeEvent(streamId, next + 1, "worker:renderer", client, corr, "DocumentRenderCompleted", {
      ...sourceReceipt, ...workflowLineage, artifact_id: artifactId, artifact_kind: "model3d", requested_by_user_id: executionScope?.actorUserId ?? ownerId,
      title: plan.title, summary: plan.summary, content_ref: stored.contentId, content_expires_at: stored.expiresAt,
      input_ref: inputStored.contentId, input_expires_at: inputStored.expiresAt, item_count: 0, items: [], presentation: null,
      media_url: primary.url, media_type: primary.mimeType, provider: "fal", provider_job_id: generated.providerJobId,
      model_id: generated.model, planner_model_id: null, planner_response_id: null,
      reference_inputs: preparedReceipt.referenceInputs, used_reference_pixels: preparedReceipt.usedReferencePixels,
      latency_ms: generated.latencyMs, source_surface: sourceSurface,
      settings: { model3d: prepared.settings, model3d_settings: prepared.settings, model3d_files: files, seed: generated.seed,
        adapter_version: RODIN_ADAPTER_VERSION, reserved_cost_microusd: costReservationMicrousd, settled_cost_microusd: actualCostMicrousd,
        source_media_sha256: primary.sha256, ...(body.workflowId ? { production_workflow: { id: body.workflowId, stage_id: body.workflowStageId, sources: body.workflowSources ?? [] } } : {}) },
    }, { causationId: requestEvent.eventId });
    const previouslyRecorded = recordedCostMicrousd();
    const unrecordedCostMicrousd = Math.max(0, actualCostMicrousd - previouslyRecorded);
    const usage = makeEvent(streamId, next + 2, "worker:policy", client, corr, "GenerationUsageRecorded", {
      operation: OPERATION, artifact_id: artifactId, artifact_kind: "model3d", document_id: projection.documentId,
      reservation_id: reservationId, cost_reservation_id: costReservationId, reserved_tokens: RESERVED_TOKENS,
      input_tokens: 0, output_tokens: 0, total_tokens: 0, planner_tokens: 0, planner_cost_microusd: 0,
      reserved_microusd: costReservationMicrousd, budget_period: costReservationPeriod, model_ids: [generated.model],
      provider_job_id: generated.providerJobId, provider_charge_status: "confirmed", cost_microusd: unrecordedCostMicrousd,
      model3d_cost_microusd: unrecordedCostMicrousd, provider_cost_microusd: actualCostMicrousd,
      provider_usage_previously_recorded: previouslyRecorded > 0, cost_precision: "published-rodin-rate", pricing_version: RODIN_ADAPTER_VERSION,
    }, { causationId: completed.eventId });
    finalPublicationUnconfirmed = true;
    try {
      await appendOperationEvents(env, [completed, usage]);
    } catch (error) {
      // Output's append wrapper already performs its current-authority recovery.
      // For ordinary jobs, one bounded identity read handles a committed batch
      // whose acknowledgement was lost without emitting a second usage charge.
      if (execution?.output) throw error;
      const committed = await env.DB.prepare(`SELECT COUNT(*) AS present FROM events
        WHERE stream_id=? AND correlation_id=? AND ((event_id=? AND type='DocumentRenderCompleted') OR (event_id=? AND type='GenerationUsageRecorded'))`)
        .bind(streamId, corr, completed.eventId, usage.eventId).first<{ present: number }>();
      if (Number(committed?.present) !== 2) throw error;
    }
    finalPublicationUnconfirmed = false;
    return Response.json({ appended: [requestEvent, ...(budgeted ? [budgeted] : []), completed, usage],
      content: { [stored.contentId]: JSON.stringify(plan), [inputStored.contentId]: JSON.stringify(inputReceipt) },
      artifactId, artifactKind: "model3d", providerJobId: generated.providerJobId, provider: "fal", head: usage.sequence });
  } catch (error) {
    if (execution?.signal.aborted || error instanceof Error && error.message === "document_job_canceled") throw error;
    if (execution?.output?.dispatchStop(error)) throw error;
    let detail = classifyProviderFailure(error);
    if (phase === "persistence" && activeProviderJobId && ["unknown", "network", "server"].includes(detail.category)) detail = {
      code: "model3d_local_persistence_failed", category: "server", scope: "request", action: "retry",
      message: "Rodin finished this 3D request, but its files or saved result could not be stored. Recover the original request to finish saving it without purchasing another generation.",
      retryable: true, retryAfterMs: null, requestId: activeProviderJobId, httpStatus: 502,
    };
    if (error instanceof Model3dInputError) detail = { code: error.issues[0]?.code ?? "model3d_input_invalid", category: "provider", scope: "request",
      action: "edit_request", message: error.message, retryable: false, retryAfterMs: null, requestId: null, httpStatus: 400 };
    if (hasUnresolvedProviderSubmission(body)) detail = uncertainSubmissionDetail(activeProviderJobId || null);
    else if (activeProviderJobId && !detail.requestId) detail = { ...detail, requestId: activeProviderJobId };
    if (finalPublicationUnconfirmed) {
      const publicationDetail: ProviderFailureDetail = {
        code: "model3d_publication_unconfirmed", category: "server", scope: "request", action: "retry",
        message: "Confirmation of the saved 3D result was interrupted. Recover this saved job to check its original result; no new generation will be purchased.",
        retryable: true, retryAfterMs: null, requestId: activeProviderJobId || null, httpStatus: 502,
      };
      // The completed and usage events may already exist. Do not append a
      // contradictory failure or another monetary event while their write is
      // unknown; durable recovery re-reads this exact artifact and correlation.
      return Response.json({ error: publicationDetail.code, errorDetail: publicFailureDetail(publicationDetail),
        artifactId, artifactKind: "model3d", providerJobId: activeProviderJobId || undefined }, { status: 502 });
    }
    const unresolved = hasUnsettledProviderSubmission(body);
    const completed = providerSubmissions(body).find(receipt => receipt.operation === "model3d" && receipt.status === "completed"
      && receipt.providerRequestId === activeProviderJobId && Number.isFinite(receipt.costMicrousd));
    const knownCost = completed?.costMicrousd ?? 0;
    // A queue acceptance is not a settlement. Hold uncertain/accepted paid work
    // for GET-only recovery; settle only a terminal financial witness.
    if (!unresolved && !costReservationSettled) {
      if (execution?.output) await settleOperationOutputBudgets({ reservationId, costReservationId, usedTokens: 0, usedMicrousd: knownCost, reason: "document_model3d_failed" });
      else {
        await releaseBudget(env, billingOwnerId, reservationId, { reason: "document_model3d_failed" });
        if (knownCost > 0) await settleCostBudget(env, billingOwnerId, costReservationId, knownCost);
        else await releaseCostBudget(env, billingOwnerId, costReservationId);
      }
      costReservationSettled = true;
    }
    await execution?.beginCommit();
    const next = await streamHead(env, streamId);
    const failed = makeEvent(streamId, next + 1, "worker:renderer", client, corr, "DocumentRenderFailed", {
      ...sourceReceipt, artifact_id: artifactId, artifact_kind: "model3d", provider: "fal", model_id: activeProviderModel,
      provider_job_id: activeProviderJobId || null, provider_charge_status: unresolved ? "unconfirmed" : knownCost > 0 ? "confirmed" : "not_submitted",
      source_surface: sourceSurface, reservation_id: reservationId, cost_reservation_id: costReservationId,
      ...failureFields(detail), ...(error instanceof Model3dInputError ? { validation_issues: error.issues } : {}),
    }, { causationId: requestEvent?.eventId ?? null });
    const failureEvents = [failed];
    const unrecordedCost = Math.max(0, knownCost - recordedCostMicrousd());
    if (!unresolved && unrecordedCost > 0) failureEvents.push(makeEvent(streamId, next + 2, "worker:policy", client, corr, "GenerationUsageRecorded", {
      operation: `${OPERATION}:failed`, artifact_id: artifactId, artifact_kind: "model3d", document_id: projection.documentId,
      reservation_id: reservationId, cost_reservation_id: costReservationId, reserved_tokens: RESERVED_TOKENS, reserved_microusd: costReservationMicrousd,
      input_tokens: 0, output_tokens: 0, total_tokens: 0, planner_tokens: 0, model_ids: [activeProviderModel],
      provider_job_id: activeProviderJobId, provider_charge_status: "confirmed", cost_microusd: unrecordedCost,
      model3d_cost_microusd: unrecordedCost, provider_cost_microusd: knownCost, cost_precision: "published-rodin-rate", pricing_version: RODIN_ADAPTER_VERSION,
    }, { causationId: failed.eventId }));
    if (!unresolved && !knownCost) failureEvents.push(makeEvent(streamId, next + 2, "worker:policy", client, corr, "BudgetReleased", {
      operation: OPERATION, artifact_id: artifactId, artifact_kind: "model3d", reservation_id: reservationId, cost_reservation_id: costReservationId,
      reserved_tokens: RESERVED_TOKENS, used_tokens: 0, released_tokens: RESERVED_TOKENS, reason: "document_model3d_failed",
    }, { causationId: failed.eventId }));
    await appendOperationEvents(env, failureEvents);
    return Response.json({ error: detail.code, errorDetail: publicFailureDetail(detail),
      ...(error instanceof Model3dInputError ? { issues: error.issues } : {}),
      appended: [...(requestEvent ? [requestEvent] : []), ...(budgeted ? [budgeted] : []), ...failureEvents],
      artifactId, artifactKind: "model3d", providerJobId: activeProviderJobId || undefined, head: failureEvents.at(-1)!.sequence },
    { status: detail.httpStatus === 400 ? 400 : detail.httpStatus === 403 ? 403 : detail.httpStatus === 429 ? 429 : 502 });
  }
}

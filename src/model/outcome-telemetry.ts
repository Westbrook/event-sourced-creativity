import type { CreativeEvent } from "./events.ts";

export type OutcomeTelemetryStream = {
  streamId: string;
  fictional: boolean;
  events: readonly CreativeEvent[];
};

export type OutcomeLedgerPeriod = {
  /** Original reservation period, not the dashboard's selected event range. */
  period: string;
  reservationCount: number;
  activeCount: number;
  executingCount: number;
  settledCount: number;
  releasedCount: number;
  unclassifiedCount: number;
  invalidAmountCount: number;
  heldMicrousd: number | null;
  settledMicrousd: number | null;
};

export type OutcomeTelemetryLiveEvidence = {
  asOf: string;
  finance: {
    scope: "actor-account";
    window: "all-reservation-periods";
    currency: "USD";
    source: "cost_budget_reservations";
    periods: OutcomeLedgerPeriod[];
    truncated: boolean;
    heldMicrousd: number | null;
    settledMicrousd: number | null;
    providerInvoiceReconciled: null;
  };
  jobs: {
    scope: "actor-owned-currently-readable-jobs";
    window: "active-or-unexpired";
    source: "document_jobs";
    total: number;
    queued: number;
    running: number;
    committing: number;
    completed: number;
    partial: number;
    failed: number;
    canceled: number;
    unclassified: number;
    completedExplicitlyUnavailable: number;
    completedAvailabilityUnknown: number;
    retainedCheckpointCount: number;
    missingOrInvalidCheckpointCount: number;
    /** A stored checkpoint is not proof that a result or its media can be opened. */
    usableResultCount: null;
    mediaAvailability: "not-checked";
  };
};

/**
 * Public, historical Output command metadata only. These records are not the
 * current Output read model, and never establish a current grant or delivery.
 * Optional on OutcomeTelemetry so older saved report snapshots remain readable.
 */
export type OutcomeOutputHistory = {
  basis: "historical-output-command-receipts";
  planConfirmationReceiptCount: number;
  targetAcceptanceReceiptCount: number;
  reusedAcceptanceSelectionReceiptCount: number;
  changesRequestedReceiptCount: number;
  deliveryPreparationReceiptCount: number;
  ignoredDuplicateReceiptCount: number;
  unclassifiedReceiptCount: number;
  /** Scope amendments live in private payloads, not public receipt metadata. */
  scopeAmendmentReceiptCount: null;
  currentlyOwedTargetCount: null;
  currentlyAcceptedTargetCount: null;
  currentScopeAmended: null;
  currentDeliveryReady: null;
  browserDownloadCount: null;
  recipientDeliveryCount: null;
};

export type OutcomeTelemetry = {
  version: 1;
  basis: "historical-canonical-receipts";
  window: { from: string | null; through: string; includeSynthetic: boolean };
  coverage: {
    truncated: boolean;
    countedReceipts: number;
    ignoredDuplicateReceipts: number;
    invalidIdentityOrTimeReceipts: number;
  };
  signals: {
    renderCompletionReceipts: number;
    generationCompletionReceipts: number;
    viewReceipts: number;
    canvasInteractionReceipts: number;
  };
  approvals: {
    receiptCount: number;
    distinctArtifactCount: number;
    exactRevisionReceiptCount: number;
    distinctExactRevisionCount: number;
    unboundReceiptCount: number;
    /** Current revision, source, rights and reviewer policy require the delivery authority. */
    currentlyApprovedArtifactCount: null;
  };
  exports: {
    artifactReceiptCount: number;
    distinctArtifactCount: number;
    exactRevisionReceiptCount: number;
    distinctExactRevisionCount: number;
    unboundArtifactReceiptCount: number;
    /** ObjectExported also covers documents/blocks; it is not an image-only metric. */
    otherResourceReceiptCount: number;
    distinctOtherResourceCount: number;
    browserDownloadCount: null;
    recipientDeliveryCount: null;
  };
  usage: {
    receiptCount: number;
    recordedCostReceiptCount: number;
    unpricedReceiptCount: number;
    /** Only explicit cost_microusd, including exact zero; no legacy price estimate. */
    recordedMicrousd: number | null;
    providerInvoiceReconciled: null;
  };
  outputHistory?: OutcomeOutputHistory;
  /** Separate current read: not a cross-user/project or selected-date-range rollup. */
  live: OutcomeTelemetryLiveEvidence | null;
};

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const identifier = (value: unknown) => typeof value === "string" && value.trim() && value.length <= 160 ? value : null;
const money = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const synthetic = (event: CreativeEvent) => event.payload.synthetic === true || event.payload.simulation === true
  || event.payload.mock_data_source === "openai-provider" || record(event.payload.origin).synthetic === true;
const key = (...values: unknown[]) => JSON.stringify(values);
const safeAdd = (left: number | null, right: number) => left !== null && Number.isSafeInteger(left + right) ? left + right : null;

function artifactIdentity(streamId: string, payload: Record<string, unknown>) {
  const artifact = identifier(payload.artifact_id);
  return artifact ? key(streamId, artifact) : null;
}

/** Binding presence is a receipt fact, not a fresh approval or permission decision. */
function exactArtifactIdentity(streamId: string, payload: Record<string, unknown>) {
  const artifact = identifier(payload.artifact_id), document = identifier(payload.document_id);
  const revision = money(payload.artifact_revision), digest = payload.content_sha256;
  return artifact && document && revision !== null && typeof digest === "string" && /^[a-f0-9]{64}$/i.test(digest)
    ? key(streamId, document, artifact, revision, digest.toLowerCase()) : null;
}

type OutputCounter = "planConfirmationReceiptCount" | "targetAcceptanceReceiptCount" | "reusedAcceptanceSelectionReceiptCount" | "changesRequestedReceiptCount" | "deliveryPreparationReceiptCount";
const outputReceiptKinds = new Map<string, { counter: OutputCounter; required: readonly string[]; receiptId?: string }>([
  ["OutputPlanConfirmed", { counter: "planConfirmationReceiptCount", required: ["plan_revision_id"], receiptId: "plan_revision_id" }],
  ["OutputTargetAccepted", { counter: "targetAcceptanceReceiptCount", required: ["plan_revision_id", "target_id", "result_id", "acceptance_id"], receiptId: "acceptance_id" }],
  ["OutputFulfillmentSelected", { counter: "reusedAcceptanceSelectionReceiptCount", required: ["plan_revision_id", "target_id", "result_id", "acceptance_id"] }],
  ["OutputTargetChangesRequested", { counter: "changesRequestedReceiptCount", required: ["plan_revision_id", "target_id", "result_id"] }],
  ["OutputDeliveryPrepared", { counter: "deliveryPreparationReceiptCount", required: ["plan_revision_id", "manifest_id"], receiptId: "manifest_id" }],
]);
const outputIdentifier = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(value);

/** Only this strict, public subset may be retained in the existing analytics cache. */
export function outputHistoryReceiptMetadata(event: Pick<CreativeEvent,"type"|"actor"|"clientId"|"correlationId"|"payload">):
  {clientId:"server:output-requirements";correlationId:string;payload:Record<string,string>}|null {
  const kind=outputReceiptKinds.get(event.type),payload=event.payload;
  if(!kind||event.clientId!=="server:output-requirements"||!outputIdentifier(payload.actor_user_id)
    ||event.actor!=="user:"+payload.actor_user_id||!outputIdentifier(payload.project_id)
    ||!outputIdentifier(payload.document_id)||!outputIdentifier(event.correlationId)
    ||kind.required.some(field=>!outputIdentifier(payload[field])))return null;
  return {clientId:"server:output-requirements",correlationId:event.correlationId,
    payload:Object.fromEntries(["actor_user_id","project_id","document_id",...kind.required].map(field=>[field,payload[field] as string]))};
}

/** Reuse canonical server command/event identities; never inspect private bodies or part counts. */
function countOutputReceipt(event: CreativeEvent, history: OutcomeOutputHistory, operations: Set<string>, receipts: Set<string>) {
  const kind = outputReceiptKinds.get(event.type);
  if (!kind) return;
  const metadata=outputHistoryReceiptMetadata(event);
  if(!metadata){history.unclassifiedReceiptCount+=1;return;}
  const payload=metadata.payload;
  const scope = [event.streamId, payload.project_id, payload.document_id];
  const operation = key(...scope, payload.actor_user_id, metadata.correlationId, event.type);
  const receipt = kind.receiptId ? key(...scope, event.type, payload[kind.receiptId]) : null;
  if (operations.has(operation) || receipt !== null && receipts.has(receipt)) {
    history.ignoredDuplicateReceiptCount += 1;
    return;
  }
  operations.add(operation);
  if (receipt !== null) receipts.add(receipt);
  history[kind.counter] += 1;
}

function copyLiveEvidence(evidence: OutcomeTelemetryLiveEvidence | undefined): OutcomeTelemetryLiveEvidence | null {
  if (!evidence) return null;
  const finance = evidence.finance, jobs = evidence.jobs;
  // Explicit fields prevent a host's extra private payload from hitching a ride.
  return {
    asOf: evidence.asOf,
    finance: {
      scope: "actor-account", window: "all-reservation-periods", currency: "USD", source: "cost_budget_reservations",
      periods: finance.periods.map((row) => ({
        period: row.period, reservationCount: row.reservationCount, activeCount: row.activeCount,
        executingCount: row.executingCount, settledCount: row.settledCount, releasedCount: row.releasedCount,
        unclassifiedCount: row.unclassifiedCount, invalidAmountCount: row.invalidAmountCount,
        heldMicrousd: row.heldMicrousd, settledMicrousd: row.settledMicrousd,
      })),
      truncated: finance.truncated, heldMicrousd: finance.heldMicrousd, settledMicrousd: finance.settledMicrousd,
      providerInvoiceReconciled: null,
    },
    jobs: {
      scope: "actor-owned-currently-readable-jobs", window: "active-or-unexpired", source: "document_jobs",
      total: jobs.total, queued: jobs.queued, running: jobs.running, committing: jobs.committing,
      completed: jobs.completed, partial: jobs.partial, failed: jobs.failed, canceled: jobs.canceled,
      unclassified: jobs.unclassified, completedExplicitlyUnavailable: jobs.completedExplicitlyUnavailable,
      completedAvailabilityUnknown: jobs.completedAvailabilityUnknown,
      retainedCheckpointCount: jobs.retainedCheckpointCount, missingOrInvalidCheckpointCount: jobs.missingOrInvalidCheckpointCount,
      usableResultCount: null, mediaAvailability: "not-checked",
    },
  };
}

/**
 * Read-only complement to buildAnalyticsReport, over the same already-authorized
 * streams. No inference of current approval, delivery, availability, savings or ROI.
 */
export function buildOutcomeTelemetry(
  streams: readonly OutcomeTelemetryStream[],
  options: { now?: number; rangeStart?: string | null; includeSynthetic?: boolean; truncated?: boolean; liveEvidence?: OutcomeTelemetryLiveEvidence } = {},
): OutcomeTelemetry {
  const now = options.now ?? Date.now();
  if (!Number.isFinite(now)) throw new Error("invalid_outcome_telemetry_time");
  const from = options.rangeStart ?? null, start = from === null ? Number.NEGATIVE_INFINITY : Date.parse(from);
  if (Number.isNaN(start)) throw new Error("invalid_outcome_telemetry_range");
  const includeSynthetic = options.includeSynthetic === true;
  const approvedArtifacts = new Set<string>(), approvedRevisions = new Set<string>();
  const exportedArtifacts = new Set<string>(), exportedRevisions = new Set<string>(), exportedResources = new Set<string>();
  const seen = new Set<string>(), outputOperations = new Set<string>(), outputReceipts = new Set<string>();
  const outputHistory: OutcomeOutputHistory = {
    basis: "historical-output-command-receipts", planConfirmationReceiptCount: 0, targetAcceptanceReceiptCount: 0,
    reusedAcceptanceSelectionReceiptCount: 0, changesRequestedReceiptCount: 0, deliveryPreparationReceiptCount: 0,
    ignoredDuplicateReceiptCount: 0, unclassifiedReceiptCount: 0, scopeAmendmentReceiptCount: null,
    currentlyOwedTargetCount: null, currentlyAcceptedTargetCount: null, currentScopeAmended: null, currentDeliveryReady: null,
    browserDownloadCount: null, recipientDeliveryCount: null,
  };
  const result: OutcomeTelemetry = {
    version: 1, basis: "historical-canonical-receipts",
    window: { from, through: new Date(now).toISOString(), includeSynthetic },
    coverage: { truncated: options.truncated === true, countedReceipts: 0, ignoredDuplicateReceipts: 0, invalidIdentityOrTimeReceipts: 0 },
    signals: { renderCompletionReceipts: 0, generationCompletionReceipts: 0, viewReceipts: 0, canvasInteractionReceipts: 0 },
    approvals: { receiptCount: 0, distinctArtifactCount: 0, exactRevisionReceiptCount: 0, distinctExactRevisionCount: 0, unboundReceiptCount: 0, currentlyApprovedArtifactCount: null },
    exports: { artifactReceiptCount: 0, distinctArtifactCount: 0, exactRevisionReceiptCount: 0, distinctExactRevisionCount: 0, unboundArtifactReceiptCount: 0, otherResourceReceiptCount: 0, distinctOtherResourceCount: 0, browserDownloadCount: null, recipientDeliveryCount: null },
    usage: { receiptCount: 0, recordedCostReceiptCount: 0, unpricedReceiptCount: 0, recordedMicrousd: 0, providerInvoiceReconciled: null },
    outputHistory,
    live: copyLiveEvidence(options.liveEvidence),
  };
  for (const stream of streams) {
    if (!includeSynthetic && stream.fictional) continue;
    for (const event of stream.events) {
      if (!includeSynthetic && synthetic(event)) continue;
      const occurred = Date.parse(event.occurredAt);
      if (!identifier(stream.streamId) || event.streamId !== stream.streamId || !identifier(event.eventId) || !Number.isFinite(occurred)) {
        result.coverage.invalidIdentityOrTimeReceipts += 1;
        continue;
      }
      if (occurred < start || occurred > now) continue;
      const eventKey = key(stream.streamId, event.eventId);
      if (seen.has(eventKey)) { result.coverage.ignoredDuplicateReceipts += 1; continue; }
      seen.add(eventKey);
      result.coverage.countedReceipts += 1;
      const payload = event.payload;
      countOutputReceipt(event, outputHistory, outputOperations, outputReceipts);
      if (event.type === "DocumentRenderCompleted") result.signals.renderCompletionReceipts += 1;
      if (event.type === "GenerationCompleted" || event.type === "IdeationPreviewCompleted") result.signals.generationCompletionReceipts += 1;
      if (event.type === "DocumentArtifactViewed" || event.type === "ObjectViewed") result.signals.viewReceipts += 1;
      if (event.type === "CanvasInteractionRecorded") result.signals.canvasInteractionReceipts += 1;
      if (event.type === "ArtifactApproved") {
        result.approvals.receiptCount += 1;
        const artifact = artifactIdentity(stream.streamId, payload), revision = exactArtifactIdentity(stream.streamId, payload);
        if (artifact) approvedArtifacts.add(artifact);
        if (revision) { approvedRevisions.add(revision); result.approvals.exactRevisionReceiptCount += 1; }
        else result.approvals.unboundReceiptCount += 1;
      }
      if (event.type === "DocumentArtifactExported") {
        result.exports.artifactReceiptCount += 1;
        const artifact = artifactIdentity(stream.streamId, payload), revision = exactArtifactIdentity(stream.streamId, payload);
        if (artifact) exportedArtifacts.add(artifact);
        if (revision) { exportedRevisions.add(revision); result.exports.exactRevisionReceiptCount += 1; }
        else result.exports.unboundArtifactReceiptCount += 1;
      }
      if (event.type === "ObjectExported") {
        result.exports.otherResourceReceiptCount += 1;
        const objectId = identifier(payload.object_id);
        if (objectId) exportedResources.add(key(stream.streamId, objectId));
      }
      if (event.type === "GenerationUsageRecorded") {
        result.usage.receiptCount += 1;
        const amount = money(payload.cost_microusd);
        if (amount !== null) {
          result.usage.recordedCostReceiptCount += 1;
          result.usage.recordedMicrousd = safeAdd(result.usage.recordedMicrousd, amount);
        } else result.usage.unpricedReceiptCount += 1;
      }
    }
  }
  result.approvals.distinctArtifactCount = approvedArtifacts.size;
  result.approvals.distinctExactRevisionCount = approvedRevisions.size;
  result.exports.distinctArtifactCount = exportedArtifacts.size;
  result.exports.distinctExactRevisionCount = exportedRevisions.size;
  result.exports.distinctOtherResourceCount = exportedResources.size;
  return result;
}

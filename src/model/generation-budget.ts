export type GenerationCostBudget = {
  usedMicrousd: number;
  reservedMicrousd: number;
  limitMicrousd: number;
  remainingMicrousd: number;
};

export type GenerationCostBudgets = {
  period: string;
  currency: "USD";
  user: GenerationCostBudget;
  workspace: GenerationCostBudget;
};

export type GenerationBudgetGate = {
  level: "none" | "notice" | "every-generation" | "critical" | "blocked";
  scope: "user" | "workspace";
  utilization: number;
  projectedUtilization: number;
  projectedMicrousd: number;
  requiresAcknowledgement: boolean;
  dismissible: boolean;
  suppressed: boolean;
  remainingMicrousd: number;
};

const safeAmount = (value: unknown) => Math.max(0, Math.floor(Number(value) || 0));

/**
 * Actual provider dollars, not token counts or an individual render's sticker
 * price, determine whether a generation needs a spending acknowledgement.
 */
export function generationBudgetGate(
  budgets: GenerationCostBudgets | null | undefined,
  options: { projectedMicrousd?: number; suppressedUntilCritical?: boolean; noticeAcknowledged?: boolean } = {},
): GenerationBudgetGate {
  const projectedMicrousd = safeAmount(options.projectedMicrousd);
  const scopes = (["user", "workspace"] as const).map((scope) => {
    const budget = budgets?.[scope];
    const limit = Math.max(1, safeAmount(budget?.limitMicrousd));
    const occupied = safeAmount(budget?.usedMicrousd) + safeAmount(budget?.reservedMicrousd);
    return {
      scope,
      utilization: budgets ? occupied / limit : 0,
      projectedUtilization: budgets ? (occupied + projectedMicrousd) / limit : 0,
      remainingMicrousd: budgets ? Math.max(0, limit - occupied) : Number.POSITIVE_INFINITY,
    };
  });
  const constrained = scopes.sort((left, right) => right.projectedUtilization - left.projectedUtilization)[0]!;
  const ratio = constrained.projectedUtilization;
  const occupied = constrained.utilization;
  const blocked = projectedMicrousd > constrained.remainingMicrousd;
  // Warnings begin strictly above 60% and 80%; suppression ends at 95%.
  const critical = occupied >= .95 || ratio >= .95;
  const suppressed = Boolean(options.suppressedUntilCritical) && !critical && !blocked;
  const level = !budgets ? "none" : blocked ? "blocked" : critical ? "critical" : suppressed ? "none" : ratio > .8 ? "every-generation" : ratio > .6 ? "notice" : "none";
  return {
    ...constrained,
    projectedMicrousd,
    level,
    suppressed,
    dismissible: level === "notice" || level === "every-generation",
    requiresAcknowledgement: level === "critical" || level === "every-generation" || level === "notice" && !options.noticeAcknowledged,
  };
}

export const generationBudgetPreferenceKey = (userId: string, period: string, preference: "notice" | "suppressed", organizationId?: string | null) =>
  `forma:generation-budget:${encodeURIComponent(userId || "anonymous")}:${period || "unknown"}${organizationId?`:organization:${encodeURIComponent(organizationId)}`:""}:${preference}`;

export const formatGenerationUsd = (microusd: number) => `$${(Math.max(0, Number(microusd) || 0) / 1_000_000).toFixed(2)}`;

/** Reserve a bounded planning slice for full document context and one repair. */
export function documentPlanningTokenReservation(maximumProviderCalls = 2) {
  return Math.max(128_000, 32_000 * Math.max(1, Math.ceil(Number(maximumProviderCalls) || 0)));
}

export function presentationTokenReservation(maximumProviderCalls = 2) {
  return documentPlanningTokenReservation(maximumProviderCalls);
}

/** Media must not consume or masquerade as the separately reserved planning slice. */
export function documentRenderTokenReservation(kind: string, itemCount = 1, maximumProviderCalls = 2) {
  // Rodin receives the authored prompt directly. Keep only the ledger's minimum
  // positive reservation; completion records zero language-model tokens.
  if (kind === "model3d") return 1;
  const media = kind === "storyboard" ? Math.max(1, safeAmount(itemCount)) * 24_000 : kind === "video" ? 24_000 : 0;
  return documentPlanningTokenReservation(maximumProviderCalls) + media;
}

const PRESENTATION_SERVER_OWNED_CHECKPOINT_FIELDS = [
  "ordinaryImageExecution", "imageRecoveryAvailable", "generationEvidenceRefs", "generationOutcome", "imageResponseJournal", "imageResultState",
  "scenePolicyStopSummary", "outputVideoPlannerCheckpoint", "outputVideoPlannerEnvelope", "outputVideoMediaCheckpoint", "outputVideoMediaEnvelopes", "outputVideoMediaResult",
  "providerSubmissionProtocol", "providerSubmissionLegacyUncertain", "providerSubmissions", "presentationModelRoutes",
  "artifactId", "artifactPlan", "plannerUsage", "plannerResponseId", "plannerResponseIds", "plannerModel", "plannerLatencyMs", "plannerInput", "presentationProviderSubmission", "presentationProviderClientRequestId", "presentationCandidates", "presentationRecoveryOnly", "recoverablePresentationCandidate",
  "reservationId", "costReservationId", "costReservationPeriod", "costReservationMicrousd", "prepaidProviderCostMicrousd", "audioEstimatedCostMicrousd",
  "providerJobId", "providerRequestId", "providerModel", "providerStatusUrl", "providerResponseUrl", "providerCancelUrl", "storyboardProviderSubmission", "storyboardProviderRequestedAt", "storyboardProviderAcceptedAt", "storyboardSafeRecovery", "storyboardRejectedProviderReceipt", "videoInputReceipt", "audioInputReceipt", "renderedItems",
  "model3dInputReceipt", "model3dProviderSubmission", "model3dEstimatedCostMicrousd", "model3dProviderFiles",
  "productionPlan", "productionSceneReceipts", "productionFrameReceipts", "productionPrepaidSceneIds", "productionPrepaidAnchor", "productionAnchor",
] as const;

/** Durable recovery state belongs to a worker-owned checkpoint, never an initial slideshow request. */
export function presentationServerOwnedCheckpointField(request: Record<string, unknown>) {
  return PRESENTATION_SERVER_OWNED_CHECKPOINT_FIELDS.find((field) => Object.hasOwn(request, field)) ?? null;
}

/** Legacy queued submissions cannot smuggle recovery state into an otherwise trusted worker execution. */
export function clearPresentationServerOwnedCheckpointFields(request: Record<string, unknown>) {
  for (const field of PRESENTATION_SERVER_OWNED_CHECKPOINT_FIELDS) delete request[field];
}

/** Model-aware admission estimates match the actual bounded provider-price receipt. */
export function estimatePlannerOperationMicrousd(model: string | undefined, operation: "chat" | "structure_adaptive") {
  const rates = model === "gpt-5.6-terra" ? { input: 2, output: 12 }
    : model === "gpt-5.6-luna" ? { input: .2, output: 1.2 }
      : { input: 5, output: 30 };
  const usage = operation === "chat" ? { input: 10_400, output: 1_600 } : { input: 10_600, output: 1_400 };
  return Math.ceil(usage.input * rates.input) + Math.ceil(usage.output * rates.output);
}

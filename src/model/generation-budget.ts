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

/** Model-aware admission estimates match the actual bounded provider-price receipt. */
export function estimatePlannerOperationMicrousd(model: string | undefined, operation: "chat" | "structure_adaptive") {
  const rates = model === "gpt-5.6-terra" ? { input: 2, output: 12 }
    : model === "gpt-5.6-luna" ? { input: .2, output: 1.2 }
      : { input: 5, output: 30 };
  const usage = operation === "chat" ? { input: 10_400, output: 1_600 } : { input: 10_600, output: 1_400 };
  return Math.ceil(usage.input * rates.input) + Math.ceil(usage.output * rates.output);
}

export const ASSISTANT_MODELS = ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"] as const;
export type AssistantModel = typeof ASSISTANT_MODELS[number];
export type AssistantTask = "intake" | "page-guidance" | "context-projection" | "proposal" | "adaptive-structure" | "creative-authoring" | "cross-document-synthesis" | "governance-review";

export type AssistantModelPolicy = {
  allowedModels: readonly AssistantModel[];
  remainingMicrousd: number;
  premiumApproved: boolean;
  requestedModel?: string | null;
  inputTokens?: number;
  outputTokens?: number;
};

export type AssistantModelDecision = {
  task: AssistantTask;
  model: AssistantModel | null;
  inputTokens: number;
  outputTokens: number;
  estimatedMicrousd: number;
  blocked: boolean;
  reason: "approved" | "unknown-model" | "model-not-allowed" | "task-model-insufficient" | "premium-approval-required" | "budget-exceeded";
};

const MODEL_PRICES: Record<AssistantModel, { input: number; output: number }> = {
  "gpt-5.6-luna": { input: 0.2, output: 1.2 },
  "gpt-5.6-terra": { input: 2, output: 12 },
  "gpt-5.6-sol": { input: 5, output: 30 },
};

export function assistantModelCostMicrousd(model: AssistantModel, inputTokens: number, outputTokens: number) {
  const price = MODEL_PRICES[model];
  return Math.ceil(Math.max(0, inputTokens) * price.input) + Math.ceil(Math.max(0, outputTokens) * price.output);
}

/** Browser-provided model strings never authorize capability or premium escalation. */
export function selectAssistantModel(task: AssistantTask, policy: AssistantModelPolicy): AssistantModelDecision {
  const inputTokens = Math.max(0, Math.ceil(policy.inputTokens ?? 10_400));
  const outputTokens = Math.max(0, Math.ceil(policy.outputTokens ?? 1_600));
  const minimum: AssistantModel = task === "intake" || task === "page-guidance" || task === "context-projection"
    ? "gpt-5.6-luna"
    : task === "cross-document-synthesis" || task === "governance-review" ? "gpt-5.6-sol" : "gpt-5.6-terra";
  const requested = policy.requestedModel?.trim();
  if (requested && !ASSISTANT_MODELS.includes(requested as AssistantModel)) {
    return { task, model: null, inputTokens, outputTokens, estimatedMicrousd: 0, blocked: true, reason: "unknown-model" };
  }
  const model = (requested as AssistantModel | undefined) ?? minimum;
  if (ASSISTANT_MODELS.indexOf(model) < ASSISTANT_MODELS.indexOf(minimum)) {
    return { task, model, inputTokens, outputTokens, estimatedMicrousd: 0, blocked: true, reason: "task-model-insufficient" };
  }
  if (!policy.allowedModels.includes(model)) {
    return { task, model: null, inputTokens, outputTokens, estimatedMicrousd: 0, blocked: true, reason: "model-not-allowed" };
  }
  const estimate = assistantModelCostMicrousd(model, inputTokens, outputTokens);
  if (model === "gpt-5.6-sol" && !policy.premiumApproved) {
    return { task, model, inputTokens, outputTokens, estimatedMicrousd: estimate, blocked: true, reason: "premium-approval-required" };
  }
  if (estimate > policy.remainingMicrousd) {
    return { task, model, inputTokens, outputTokens, estimatedMicrousd: estimate, blocked: true, reason: "budget-exceeded" };
  }
  return { task, model, inputTokens, outputTokens, estimatedMicrousd: estimate, blocked: false, reason: "approved" };
}

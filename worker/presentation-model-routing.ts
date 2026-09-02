import type { WorkerEnv } from "./runtime.ts";
import { OPENAI_TEXT_PRICING_VERSION } from "./openai-text-cost.ts";

export const PRESENTATION_MODEL_ROUTING_VERSION = "slides-model-routing-v1";
export const PRESENTATION_TEXT_MODELS = ["gpt-5.6-terra", "gpt-5.6-sol"] as const;
export const PRESENTATION_REASONING_EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"] as const;
export type PresentationTextModel = typeof PRESENTATION_TEXT_MODELS[number];
export type PresentationReasoningEffort = typeof PRESENTATION_REASONING_EFFORTS[number];
export type PresentationPlanningPhase = "composition" | "validation-repair" | "editorial-rewrite" | "editorial-validation-repair";
export type PresentationModelRoutingEnv = Pick<WorkerEnv,
  "OPENAI_MODEL" | "OPENAI_SLIDES_COMPOSITION_MODEL" | "OPENAI_SLIDES_COMPOSITION_REASONING_EFFORT"
  | "OPENAI_SLIDES_REPAIR_MODEL" | "OPENAI_SLIDES_REPAIR_REASONING_EFFORT">;

export type PresentationModelRoute = Readonly<{
  workflow: "slides.composition" | "slides.editorial_repair";
  model: PresentationTextModel;
  reasoningEffort: PresentationReasoningEffort;
  serviceTier: "default";
  cachePolicy: "disabled-explicit";
  modelSource: "workflow" | "legacy" | "default";
  effortSource: "workflow" | "default";
  routingVersion: typeof PRESENTATION_MODEL_ROUTING_VERSION;
  pricingVersion: typeof OPENAI_TEXT_PRICING_VERSION;
}>;
export type PresentationModelRoutes = Readonly<{ composition: PresentationModelRoute; repair: PresentationModelRoute }>;

export class PresentationModelConfigurationError extends Error {
  readonly code = "presentation_model_configuration_invalid";
  readonly field: string;
  constructor(field: string, expected: string) {
    super(`${field} must be ${expected}; no new provider request was submitted.`);
    this.name = "PresentationModelConfigurationError"; this.field = field;
  }
}

function choice<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== "string" || !allowed.includes(value.trim() as T)) throw new PresentationModelConfigurationError(field, allowed.join(", "));
  return value.trim() as T;
}

/** Resolve BOTH workflows before reservation or dispatch, then freeze them with the accepted request. */
export function resolvePresentationModelRoutes(env: PresentationModelRoutingEnv): PresentationModelRoutes {
  const route = (workflow: PresentationModelRoute["workflow"], modelKey: "OPENAI_SLIDES_COMPOSITION_MODEL" | "OPENAI_SLIDES_REPAIR_MODEL",
    effortKey: "OPENAI_SLIDES_COMPOSITION_REASONING_EFFORT" | "OPENAI_SLIDES_REPAIR_REASONING_EFFORT"): PresentationModelRoute => {
    const modelSource = env[modelKey] !== undefined ? "workflow" : env.OPENAI_MODEL !== undefined ? "legacy" : "default";
    return Object.freeze({
      workflow, model: choice(env[modelKey] ?? env.OPENAI_MODEL ?? "gpt-5.6-terra", PRESENTATION_TEXT_MODELS, modelSource === "legacy" ? "OPENAI_MODEL" : modelKey),
      reasoningEffort: choice(env[effortKey] ?? "low", PRESENTATION_REASONING_EFFORTS, effortKey), serviceTier: "default", cachePolicy: "disabled-explicit",
      modelSource, effortSource: env[effortKey] !== undefined ? "workflow" : "default",
      routingVersion: PRESENTATION_MODEL_ROUTING_VERSION, pricingVersion: OPENAI_TEXT_PRICING_VERSION,
    });
  };
  const composition = route("slides.composition", "OPENAI_SLIDES_COMPOSITION_MODEL", "OPENAI_SLIDES_COMPOSITION_REASONING_EFFORT");
  const repair = route("slides.editorial_repair", "OPENAI_SLIDES_REPAIR_MODEL", "OPENAI_SLIDES_REPAIR_REASONING_EFFORT");
  return Object.freeze({ composition, repair });
}

/** Managed whole-work rewrites are editorial work even when the adapter calls them an initial pass. */
export function selectPresentationModelRoute(routes: PresentationModelRoutes, phase: PresentationPlanningPhase): PresentationModelRoute {
  switch (phase) {
    case "composition": return routes.composition;
    case "validation-repair":
    case "editorial-rewrite":
    case "editorial-validation-repair": return routes.repair;
    default: throw new PresentationModelConfigurationError("presentation planning phase", "an explicit composition or editorial phase");
  }
}

/** Read only from the worker-owned admission receipt, never from an end-user request. */
export function readFrozenPresentationModelRoutes(value: unknown): PresentationModelRoutes {
  const record=(v:unknown):Record<string,unknown>=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:{};
  const saved=record(value),composition=record(saved.composition),repair=record(saved.repair);
  const resolved=resolvePresentationModelRoutes({OPENAI_SLIDES_COMPOSITION_MODEL:composition.model as string,
    OPENAI_SLIDES_COMPOSITION_REASONING_EFFORT:composition.reasoningEffort as string,
    OPENAI_SLIDES_REPAIR_MODEL:repair.model as string,OPENAI_SLIDES_REPAIR_REASONING_EFFORT:repair.reasoningEffort as string});
  const restore=(stored:Record<string,unknown>,route:PresentationModelRoute):PresentationModelRoute=>{
    for(const key of ["workflow","model","reasoningEffort","serviceTier","cachePolicy","routingVersion","pricingVersion"] as const)
      if(stored[key]!==route[key])throw new PresentationModelConfigurationError("frozen presentation route","the exact supported admitted model, effort, and tariff");
    if(!["workflow","legacy","default"].includes(String(stored.modelSource))||!["workflow","default"].includes(String(stored.effortSource)))throw new PresentationModelConfigurationError("frozen presentation route source","a server-admitted route source");
    return Object.freeze({...route,modelSource:stored.modelSource as PresentationModelRoute["modelSource"],effortSource:stored.effortSource as PresentationModelRoute["effortSource"]});
  };
  return Object.freeze({composition:restore(composition,resolved.composition),repair:restore(repair,resolved.repair)});
}

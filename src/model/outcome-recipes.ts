import type { CanvasOrganization } from "../canvas/model.ts";
import type { BlockKind } from "./block-types.ts";
import type { SlideStylePresetId } from "./document-artifacts.ts";
import type { CreativeMedium } from "./workspace-intelligence.ts";
import type { FormaCapability } from "../platform/capabilities.ts";
import { inspectOutputRequirement, isOutputRequirementId, type OutputCountPolicy, type OutputMediaKind, type OutputQuantityUnit, type OutputRequirementSpec } from "./output-requirements.ts";

export const OUTCOME_RECIPE_IDS = ["executive-deck", "campaign", "film-continuity"] as const;
export type OutcomeRecipeId = typeof OUTCOME_RECIPE_IDS[number];
export type OutcomeRecipeStep = "inspect" | "author" | "prepare" | "review" | "deliver";
export type OutcomeRecipe = {
  readonly id: OutcomeRecipeId;
  readonly arrangement: CanvasOrganization;
  readonly formats: readonly CreativeMedium[];
  readonly contextTypes: readonly BlockKind[];
  readonly slidePresets: readonly SlideStylePresetId[];
  readonly steps: readonly OutcomeRecipeStep[];
};

/**
 * Optional guidance over existing editors and production workflows, not source
 * content, a ProductionWorkflow, a dependency graph, or permission to execute.
 * Choosing a recipe does not set a document's requested medium or enable a stage.
 */
export const OUTCOME_RECIPES = [
  {
    id: "executive-deck", arrangement: "column",
    formats: ["slides"], contextTypes: ["direction", "audience", "message", "exclusion", "format"],
    slidePresets: ["editorial", "field-notes"], steps: ["inspect", "author", "prepare", "review", "deliver"],
  },
  {
    id: "campaign", arrangement: "grid",
    formats: ["image", "slides", "short_story", "scene"],
    contextTypes: ["brand", "audience", "message", "style", "exclusion", "format"],
    slidePresets: ["gallery", "editorial"], steps: ["inspect", "author", "prepare", "review", "deliver"],
  },
  {
    id: "film-continuity", arrangement: "row",
    formats: ["scene", "storyboard", "video", "audio"],
    contextTypes: ["subject", "environment", "action", "camera", "audio", "exclusion", "format"],
    slidePresets: [], steps: ["inspect", "author", "prepare", "review", "deliver"],
  },
] as const satisfies readonly OutcomeRecipe[];

/** References only. These do not grant access, invoke a store method, or bind inputs. */
export const OUTCOME_RECIPE_EXECUTORS: Readonly<Record<OutcomeRecipeStep, {
  readonly capability: FormaCapability;
  readonly existingBoundary: string;
  readonly opensOnly: true;
}>> = {
  inspect: { capability: "project.read", existingBoundary: "CreativeNextPorts.output / artifact / job; document source inspection", opensOnly: true },
  author: { capability: "project.author", existingBoundary: "CreativeNextPorts.context; existing typed block and proposal review editor", opensOnly: true },
  prepare: { capability: "project.output.request", existingBoundary: "CreativeNextPorts.configure; recommendProductionWorkflow preview", opensOnly: true },
  review: { capability: "project.read", existingBoundary: "existing exact-revision artifact review; independent reviewer authority rechecked there", opensOnly: true },
  deliver: { capability: "project.read", existingBoundary: "existing artifact delivery/export; exact approval and export authority rechecked there", opensOnly: true },
};

export function outcomeRecipe(value: unknown): OutcomeRecipe | null {
  return OUTCOME_RECIPES.find((recipe) => recipe.id === value) ?? null;
}

export type OutcomeRecipeFileChoice = {
  readonly key: string;
  readonly media: OutputMediaKind;
  readonly unit: OutputQuantityUnit;
  readonly contentUnit?: "slide" | "second";
  /** A preparation format is navigation guidance, never a native Output adapter. */
  readonly preparation: CreativeMedium;
  readonly unresolvedDelivery?: "script" | "composed-film";
};
const RECIPE_FILE_CHOICES: Readonly<Record<OutcomeRecipeId, readonly OutcomeRecipeFileChoice[]>> = {
  "executive-deck": [{ key: "deck", media: "slides", unit: "presentation", contentUnit: "slide", preparation: "slides" }],
  campaign: [
    { key: "campaign-image", media: "image", unit: "image", preparation: "image" },
    { key: "campaign-deck", media: "slides", unit: "presentation", contentUnit: "slide", preparation: "slides" },
    { key: "campaign-video", media: "video", unit: "video", contentUnit: "second", preparation: "video" },
    { key: "campaign-audio", media: "audio", unit: "episode", contentUnit: "second", preparation: "audio" },
  ],
  "film-continuity": [
    { key: "visual-study", media: "image", unit: "image", preparation: "storyboard" },
    { key: "video-units", media: "video", unit: "video", contentUnit: "second", preparation: "video" },
    { key: "separate-audio", media: "audio", unit: "episode", contentUnit: "second", preparation: "audio" },
    { key: "script", media: "document", unit: "document", preparation: "scene", unresolvedDelivery: "script" },
    { key: "composed-film", media: "video", unit: "video", contentUnit: "second", preparation: "video", unresolvedDelivery: "composed-film" },
  ],
};
export function outcomeRecipeFileChoices(id: OutcomeRecipeId): readonly OutcomeRecipeFileChoice[] {
  return RECIPE_FILE_CHOICES[id] ?? [];
}
/** A local authored choice, never a saved requirement or a read certificate. */
export type OutcomeRecipeInput = { recipeId: OutcomeRecipeId; originalText: string; selectedChoices: readonly string[] };
export type OutcomeRecipeInputSource = {
  projectId: string; documentId: string; actorUserId: string; authorizationScopeKey: string; head: number;
};
export type OutcomeRecipeDraft = {
  scope: { projectId: string; documentId: string; authorizationScopeKey: string };
  expectedRevision: string;
  sourceRevision: string;
  requirementRevision: string;
  requirementId: string;
  recipeId: OutcomeRecipeId;
  recipeVersion: 1;
  spec: OutputRequirementSpec;
  planSuggestions: { countPolicies: Record<string, OutputCountPolicy>; suggestedCounts: Record<string, number> };
};
export type OutcomeRecipeDraftLabels = {
  requirement: string;
  choices: Readonly<Record<string, string>>;
  sourceUnknown: string;
  coverageUnknown: string;
  scriptOwed: string;
  composedFilmOwed: string;
};
/** Pure, unsaved suggestions. No parser, random IDs, rights assertion or execution. */
export function buildOutcomeRecipeDraft(input: Omit<OutcomeRecipeDraft, "recipeVersion" | "spec" | "planSuggestions"> & {
  originalText: string; selectedChoices: readonly string[]; labels: OutcomeRecipeDraftLabels;
}): OutcomeRecipeDraft {
  const recipe = outcomeRecipe(input.recipeId), choices = outcomeRecipeFileChoices(input.recipeId);
  if (!recipe || !isOutputRequirementId(input.requirementId) || !input.originalText.trim()
    || !input.scope.projectId || !input.scope.documentId || !input.scope.authorizationScopeKey
    || !input.expectedRevision || !input.sourceRevision || !input.requirementRevision
    || !input.selectedChoices.length || new Set(input.selectedChoices).size !== input.selectedChoices.length
    || input.selectedChoices.some(key => !choices.some(choice => choice.key === key))) throw new Error("outcome_recipe_draft_invalid");
  const suggested = { kind: "suggested" as const };
  const spec: OutputRequirementSpec = {
    schema_version: 1, id: input.requirementId, label: input.labels.requirement, original_text: input.originalText,
    value_origins: { label: suggested, recipe_template: { kind: "suggested", text: `forma-recipe:${input.recipeId}@1` } },
    deliverables: input.selectedChoices.map(key => {
      const choice = choices.find(value => value.key === key)!;
      const description = choice.unresolvedDelivery === "script" ? input.labels.scriptOwed
        : choice.unresolvedDelivery === "composed-film" ? input.labels.composedFilmOwed : input.labels.coverageUnknown;
      return {
        id: `${input.requirementId}:${choice.key}`, label: input.labels.choices[choice.key], media_kind: choice.media,
        required: true, quantity: { kind: "unknown" as const, unit: choice.unit },
        ...(choice.contentUnit ? { content_quantity: { kind: "unknown" as const, unit: choice.contentUnit } } : {}),
        source_scope: { kind: "unknown" as const, reason: input.labels.sourceUnknown },
        coverage: { kind: "unresolved" as const, description }, original_text: input.originalText,
        value_origins: {
          label: suggested, media_kind: suggested, required: suggested, quantity: suggested, source_scope: suggested, coverage: suggested,
          ...(choice.contentUnit ? { content_quantity: suggested } : {}),
          ...(choice.unresolvedDelivery ? { delivery_limitation: { kind: "suggested" as const, text: description } } : {}),
        },
      };
    }),
  };
  if (inspectOutputRequirement(spec).status !== "valid") throw new Error("outcome_recipe_draft_invalid");
  return {
    scope: { ...input.scope }, expectedRevision: input.expectedRevision, sourceRevision: input.sourceRevision,
    requirementRevision: input.requirementRevision, requirementId: input.requirementId,
    recipeId: input.recipeId, recipeVersion: 1, spec, planSuggestions: { countPolicies: {}, suggestedCounts: {} },
  };
}

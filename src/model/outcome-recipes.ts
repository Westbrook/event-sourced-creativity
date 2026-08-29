import type { CanvasOrganization } from "../canvas/model.ts";
import type { BlockKind } from "./block-types.ts";
import type { SlideStylePresetId } from "./document-artifacts.ts";
import type { CreativeMedium } from "./workspace-intelligence.ts";
import type { FormaCapability } from "../platform/capabilities.ts";

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

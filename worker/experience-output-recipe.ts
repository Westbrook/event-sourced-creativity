import { createExperienceModel3dRecipe } from "./experience-model3d-recipe.ts";
import type { Model3dOutputContract } from "../src/model/output-model3d-contract.ts";
import { createExperienceVideoRecipe } from "./experience-video-recipe.ts";
import type { VideoOutputContract } from "../src/model/output-video-contract.ts";
import { createExperienceAudioRecipe } from "./experience-audio-recipe.ts";
import { createExperienceStoryboardRecipe } from "./experience-storyboard-recipe.ts";
import type { StoryboardOutputContract } from "../src/model/output-storyboard-contract.ts";
import type { AudioOutputContract } from "../src/model/output-audio-contract.ts";
import { createExperienceSceneRecipe } from "./experience-scene-recipe.ts";
import type { SceneOutputContract } from "../src/model/output-scene-contract.ts";
import { createExperienceNarrativeRecipe } from "./experience-narrative-recipe.ts";
import type { ShortStoryNarrativeContract } from "../src/model/output-narrative-contract.ts";
import type { OutputAspectRatio, OutputRequirementSpec } from "../src/model/output-requirements.ts";
import type { OutputPlanTarget } from "../src/model/output-plan.ts";
import { readExperienceImageRatio } from "../src/experiences/image-ratio.ts";

/** Deterministic schema-1 intent only; never a grant, quote, or acceptance. */
export type ExperienceOutputKind = "image" | "slides" | "short_story" | "scene" | "audio" | "video" | "storyboard" | "model3d";
export type ExperienceOutputRecipe = Readonly<{
  output: ExperienceOutputKind;
  spec: OutputRequirementSpec;
  targetId: string;
  nativeReadiness: "eligible_for_existing_preflight" | "unavailable";
}>;
export type ExperienceOutputRecipeInput =
  | { output: "model3d"; requirementId: string; deliverableId: string; contract: Model3dOutputContract }
  | { output: "video"; requirementId: string; deliverableId: string; contract: VideoOutputContract }
  | { output: "storyboard"; requirementId: string; deliverableId: string; contract: StoryboardOutputContract }
  | { output: "audio"; requirementId: string; deliverableId: string; contract: AudioOutputContract }
  | { output: "scene"; requirementId: string; deliverableId: string; contract: SceneOutputContract }
  | { output: "short_story"; requirementId: string; deliverableId: string; contract: ShortStoryNarrativeContract }
  | { output: "slides"; requirementId: string; deliverableId: string }
  | { output: "image"; requirementId: string; deliverableId: string; variantId: string; aspectRatio: OutputAspectRatio };
export type ExperiencePlanIdentity = Readonly<{
  documentId: string;
  sourceRevision: string;
  requirementRevision: string;
}>;

const safeId = (value: unknown): value is string => typeof value === "string"
  && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,147}$/u.test(value);
const identity = (value: unknown): value is string => typeof value === "string"
  && value.trim().length > 0 && value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value);
const record = (value: unknown): value is Record<string, unknown> => value !== null
  && typeof value === "object" && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const interpreted = (text: string) => ({ kind: "interpreted" as const, text });
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/**
 * Map the registered fixed promise, not free-form prose. Authored decisions remain
 * in the canonical Document and are read and digested by the existing native API.
 * `interpreted` records this mapping; `confirmed` would assert an author action.
 * Image requires the exact authored ratio from validated intake; no default or
 * reference-pixel mode is accepted here.
 */
export function createExperienceOutputRecipe(input: ExperienceOutputRecipeInput): ExperienceOutputRecipe {
  if (input?.output === "model3d") return createExperienceModel3dRecipe(input);
  if (input?.output === "video") return createExperienceVideoRecipe(input);
  if (input?.output === "storyboard") return createExperienceStoryboardRecipe(input);
  if (input?.output === "audio") return createExperienceAudioRecipe(input);
  if (input?.output === "scene") return Object.freeze({ ...createExperienceSceneRecipe(input), nativeReadiness: "eligible_for_existing_preflight" });
  if (input?.output === "short_story") return Object.freeze({ ...createExperienceNarrativeRecipe(input), nativeReadiness: "eligible_for_existing_preflight" });
  const keys = input?.output === "image"
    ? ["output", "requirementId", "deliverableId", "variantId", "aspectRatio"]
    : ["output", "requirementId", "deliverableId"];
  if (!record(input) || Object.keys(input).length !== keys.length
    || !keys.every(key => Object.hasOwn(input, key))
    || (input.output !== "image" && input.output !== "slides")
    || !safeId(input.requirementId) || !safeId(input.deliverableId)
    || input.requirementId === input.deliverableId) throw new Error("experience_output_recipe_invalid");
  const slides = input.output === "slides";
  const aspectRatio = input.output === "image" ? readExperienceImageRatio(input.aspectRatio) : null;
  if (input.output === "image" && (!aspectRatio || !safeId(input.variantId)
    || input.variantId === input.requirementId || input.variantId === input.deliverableId)) {
    throw new Error("experience_output_recipe_invalid");
  }
  const label = slides ? "Slides" : "Image";
  const ratioText = aspectRatio ? `${aspectRatio.width}:${aspectRatio.height}` : "";
  const wording = slides ? "5 slides" : `1 image\n${ratioText}`;
  const quantity = slides
    ? { kind: "exact" as const, unit: "presentation" as const, value: 1 }
    : { kind: "exact" as const, unit: "image" as const, value: 1 };
  const spec: OutputRequirementSpec = {
    schema_version: 1,
    id: input.requirementId,
    label,
    original_text: wording,
    deliverables: [{
      id: input.deliverableId,
      label,
      media_kind: input.output,
      required: true,
      quantity,
      ...(slides ? { content_quantity: { kind: "exact" as const, unit: "slide" as const, value: 5 } } : {}),
      source_scope: { kind: "document" },
      coverage: { kind: slides ? "document_outline" : "document_context" },
      ...(input.output === "image" ? { format_variants: [{
        id: input.variantId, label: `Image ${ratioText}`, required: true,
        aspect_ratio: aspectRatio!, quantity: { kind: "exact" as const, unit: "image" as const, value: 1 },
        placements: [], original_text: wording,
        value_origins: { aspect_ratio: { kind: "authored" as const, text: ratioText },
          required: interpreted("1 image"), quantity: interpreted("1 image") },
      }] } : {}),
      original_text: wording,
      value_origins: {
        media_kind: interpreted(label),
        required: interpreted(wording),
        quantity: interpreted(slides ? "1 presentation" : wording),
        ...(slides ? { content_quantity: interpreted(wording) } : {}),
        source_scope: interpreted("document"),
        coverage: interpreted(slides ? "document_outline" : "document_context"),
      },
    }],
    value_origins: {
      label: interpreted(label),
      deliverables: interpreted(wording),
      interpretation_basis: interpreted(wording),
    },
  };
  return freeze({ output: input.output, spec,
    targetId: `${input.output === "image" ? input.variantId : input.deliverableId}:target:1`,
    nativeReadiness: "eligible_for_existing_preflight" });
}

function same(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length
    && expected.every((item, index) => same(actual[index], item));
  if (!record(expected) || !record(actual)) return false;
  const keys = Object.keys(expected);
  return keys.length === Object.keys(actual).length && keys.every(key => Object.hasOwn(actual, key)
    && same(actual[key], expected[key]));
}

/**
 * A shape/revision association check for a trusted recipe returned by the builder.
 * The caller must separately verify the
 * canonical confirmed-plan receipt/digests, ownership, source and native admission.
 * An associated target still needs the existing source, native-route and cost checks.
 */
export function matchExperienceOutputRecipeTarget(
  recipe: ExperienceOutputRecipe,
  plan: unknown,
  scope: ExperiencePlanIdentity,
): OutputPlanTarget | null {
  if (!scope || !identity(scope.documentId) || !identity(scope.sourceRevision)
    || !identity(scope.requirementRevision) || !record(plan)) return null;
  const entry = recipe.spec.deliverables[0];
  const variant = recipe.output === "image" ? entry.format_variants![0] : null;
  const obligationId = variant?.id ?? entry.id;
  const targetLabel = variant?.label ?? entry.label;
  const expectedTarget: OutputPlanTarget = {
    id: recipe.targetId, requirement_id: recipe.spec.id, deliverable_id: entry.id, obligation_id: obligationId,
    variant_id: variant?.id ?? null, member_id: null, label: targetLabel, media_kind: entry.media_kind,
    required: true, selected: true, ordinal: 1,
    quantity: { kind: "exact", unit: entry.quantity.unit, value: 1 },
    ...(entry.audio_contract ? { audio_contract: entry.audio_contract } : {}),
    ...(entry.video_contract ? { video_contract: entry.video_contract } : {}),
    ...(entry.storyboard_contract ? { storyboard_contract: entry.storyboard_contract } : {}),
    ...(entry.model3d_contract ? { model3d_contract: entry.model3d_contract } : {}),
    ...(entry.scene_contract ? { scene_contract: entry.scene_contract } : {}),
    ...(entry.narrative_contract ? { narrative_contract: entry.narrative_contract } : {}),
    aspect_ratio: variant?.aspect_ratio ?? null, source_scope: { kind: "document" }, coverage: entry.coverage,
    content_quantity: entry.content_quantity ?? null,
    count_policy: recipe.output === "slides" ? { kind: "exact", unit: "slide", value: 5 } : recipe.output === "video" ? { kind: "exact", unit: "second", value: 4 } : null,
    suggested_count: null, instruction_text: variant?.original_text ?? entry.original_text,
    source_revision: scope.sourceRevision, requirement_revision: scope.requirementRevision, blocking_issues: [],
  };
  const expected = {
    schema_version: 1, document_id: scope.documentId, source_revision: scope.sourceRevision,
    requirement_revision: scope.requirementRevision,
    groups: [{ id: entry.id, requirement_id: recipe.spec.id, label: entry.label,
      media_kind: entry.media_kind, required: true, obligation_ids: [obligationId] }],
    obligations: [{ id: obligationId, requirement_id: recipe.spec.id, deliverable_id: entry.id,
      variant_id: variant?.id ?? null, member_id: null, label: targetLabel, media_kind: entry.media_kind,
      required: true, selected: true, quantity: entry.quantity, quantity_policy: entry.quantity,
      target_ids: [recipe.targetId], resolution: "resolved" }],
    targets: [expectedTarget], unresolved_groups: [], issues: [],
  };
  if (!same(plan, expected)) return null;
  return (plan.targets as OutputPlanTarget[])[0];
}

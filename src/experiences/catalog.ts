import { EXPERIENCE_VIDEO_INTENT } from "./video-reference.ts";
import type { Binding, Catalog, Definition, Interaction, OutputContract, OutputKind } from "./contracts.ts";
import { EXPERIENCE_AUDIO_INTENT } from "./contracts.ts";
import { freeze } from "./compiler.ts";
import { EXPERIENCE_IMAGE_RATIOS } from "./image-ratio.ts";

const source = (id: string): Interaction => ({ id, version: 1, kind: "source", renderer: "role-source@1", feedback: "source-role@1", required: true, maxLength: 600, defaultValue: "" });
const choices = (id: string, kind: "treatment" | "spatial", labels: string[], feedback: string): Interaction => ({ id, version: 1, kind, renderer: kind === "spatial" ? "spatial-stage@1" : "scoped-treatment@1", feedback, required: true, maxLength: 80, options: labels.map(label => ({ value: label.toLowerCase().replaceAll(" ", "-"), label })), defaultValue: labels[0].toLowerCase().replaceAll(" ", "-") });
const interactions: Interaction[] = [
  source("video-motion@1"), choices("video-frame@1", "spatial", ["Landscape", "Portrait"], "video-frame@1"),
  source("subject@1"), source("claim@1"),
  source("storyboard-story@1"), source("storyboard-visual@1"),
  source("audio-direction@1"), { ...source("audio-development@1"), required: false, maxLength: 300 },
  source("model3d-subject@1"), { ...source("model3d-detail@1"), required: false, maxLength: 300 },
  { ...source("scene-name@1"), maxLength: 80 }, source("scene-secret@1"), source("scene-location@1"),
  choices("scene-knowledge@1", "treatment", ["A", "B", "Both"], "scene-knowledge@1"),
  choices("scene-tension@1", "treatment", ["Restrained", "Explosive"], "scene-tension@1"),
  source("character@1"), source("goal@1"), source("obstacle@1"), source("decision@1"),
  { ...source("story-detail@1"), required: false },
  choices("story-ending@1", "treatment", ["Hopeful", "Unresolved", "Bittersweet"], "story-turn@1"),
  { id: "image-ratio@1", version: 1, kind: "ratio", renderer: "image-ratio-choice@1", feedback: "image-frame@1", required: true, maxLength: 0, ratios: EXPERIENCE_IMAGE_RATIOS, defaultValue: "" },
  choices("composition@1", "spatial", ["Center", "Left", "Right"], "composition-stage@1"),
  choices("lighting@1", "treatment", ["Daylight", "Soft light", "Low key"], "lighting-stage@1"),
  { id: "evidence@1", version: 1, kind: "order", renderer: "ordered-evidence@1", feedback: "five-slide-order@1", required: true, maxLength: 600, defaultValue: [1, 2, 3].map(index => ({ id: `e${index}`, text: "" })) },
];
type Recipe = { output: OutputKind; label: string; result: string; essential: string; decisions: [string, string, string, Binding["role"]][] };
const recipes: Recipe[] = [
  { output: "image", label: "Image", result: "1 image", essential: "composition@1", decisions: [["subject", "subject@1", "Subject", "subject"], ["ratio", "image-ratio@1", "Ratio", "constraint"], ["composition", "composition@1", "Composition", "direction"], ["lighting", "lighting@1", "Lighting", "direction"]] },
  { output: "slides", label: "Slides", result: "5 slides", essential: "evidence@1", decisions: [["claim", "claim@1", "Claim", "subject"], ["evidence", "evidence@1", "Evidence order", "evidence"]] },
  { output: "short_story", label: "Short story", result: "1 story · 600–800 words", essential: "story-ending@1", decisions: [["character", "character@1", "Character", "subject"], ["goal", "goal@1", "Goal", "direction"], ["obstacle", "obstacle@1", "Obstacle", "direction"], ["decision", "decision@1", "Decision", "direction"], ["ending", "story-ending@1", "Ending", "direction"], ["detail", "story-detail@1", "Required detail (optional)", "constraint"]] },
  { output: "scene", label: "Scene", result: "1 scene · 2 characters · 1 location", essential: "scene-knowledge@1", decisions: [["characterA", "scene-name@1", "Character A", "subject"], ["goalA", "goal@1", "Goal A", "direction"], ["characterB", "scene-name@1", "Character B", "subject"], ["goalB", "goal@1", "Goal B", "direction"], ["secret", "scene-secret@1", "Secret", "evidence"], ["knowledge", "scene-knowledge@1", "Knowledge", "constraint"], ["location", "scene-location@1", "Location", "constraint"], ["tension", "scene-tension@1", "Tension", "direction"]] },
  // Text-only context authoring; reference custody and native generation are not registered here.
  { output: "model3d", label: "3D object", result: "1 static GLB object", essential: "model3d-subject@1", decisions: [["subject", "model3d-subject@1", "Object description", "subject"], ["direction", "model3d-detail@1", "Material and shape detail (optional)", "direction"]] },
  // Four frames are planned output, not invented frame records or a generation grant.
  { output: "storyboard", label: "Storyboard", result: "4 storyboard frames", essential: "storyboard-story@1", decisions: [["story", "storyboard-story@1", "Ordered story beats", "evidence"], ["composition", "storyboard-visual@1", "Visual direction", "direction"]] },
  { output: "audio", label: "Audio", result: "1 instrumental track · about 20 seconds", essential: "audio-direction@1", decisions: [["direction", "audio-direction@1", "Musical direction", "direction"], ["detail", "audio-development@1", "Development over time (optional)", "direction"]] },
  // Owned-still context authoring only; native generation remains unavailable.
  { output: "video", label: "Video", result: "1 clip · 4 seconds · 480p · Silent", essential: "video-frame@1", decisions: [["motion", "video-motion@1", "Motion", "direction"], ["frame", "video-frame@1", "Frame", "constraint"]] },
];
const outputs: Record<string, OutputContract> = {};
const copy: Record<string, string> = {};
export const definitions: readonly Definition[] = freeze(recipes.map(recipe => {
  const contractVersion = recipe.output === "image" ? 2 : 1;
  const outputContractRef = `${recipe.output}.single@${contractVersion}`, bindingPackRef = `${recipe.output}.direction@${contractVersion}`, viewerRef = `${recipe.output}.read-only@1`;
  outputs[outputContractRef] = { id: outputContractRef, version: contractVersion, output: recipe.output, label: recipe.label, result: recipe.result, ...(recipe.output === "audio" ? { audioIntent: EXPERIENCE_AUDIO_INTENT } : {}), ...(recipe.output === "video" ? { videoIntent: EXPERIENCE_VIDEO_INTENT } : {}), bindingPackRef, essentialInteractionRef: recipe.essential, viewerRef, bindings: recipe.decisions.map(([id, interactionRef, , role]) => ({ slot: id, decisionId: id, interactionRef, role, target: recipe.output })) };
  return { schemaVersion: 1, id: recipe.output === "short_story" ? "short-story" : recipe.output, revision: recipe.output === "image" ? 2 : 1, outputContractRef, bindingPackRef, essentialInteractionRef: recipe.essential, layout: "stage-and-controls", decisions: recipe.decisions.map(([id, interactionRef, label]) => { const labelKey = `${recipe.output}.${id}`; copy[labelKey] = label; return { id, interactionRef, bindingSlot: id, labelKey }; }), viewerRef, mobileProfileRef: "touch.standard@1", copySetRef: "functional.en@1" };
}));
/** This registry qualifies typed context authoring, never an account, provider or financial grant. */
export const contextCatalog: Catalog = freeze({ version: "forma-experience-context@2", qualification: "context-authoring", interactions: Object.fromEntries(interactions.map(item => [item.id, item])), outputs, copy });

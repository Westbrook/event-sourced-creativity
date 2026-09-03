import type { Binding, Catalog, Definition, ExperienceValue, Interaction, OutputContract, OutputKind } from "./contracts.ts";

const source = (id: string, maxLength = 600): Interaction => ({ id, version: 1, kind: "source", renderer: "role-source@1", feedback: "source-role@1", required: true, maxLength, defaultValue: "" });
const choices = (id: string, kind: "treatment" | "spatial", values: string[], feedback: string): Interaction => ({ id, version: 1, kind, renderer: kind === "spatial" ? "spatial-stage@1" : "scoped-treatment@1", feedback, required: true, maxLength: 80, options: values.map(value => ({ value: value.toLowerCase().replaceAll(" ", "-"), label: value })), defaultValue: values[0].toLowerCase().replaceAll(" ", "-") });
const fields = (id: string, kind: "relationship" | "profile" | "proportion", entries: [string, string][], defaultValue: ExperienceValue, feedback: string): Interaction => ({ id, version: 1, kind, renderer: `${kind}-board@1`, feedback, required: true, maxLength: 400, fields: entries.map(([id, label]) => ({ id, label })), defaultValue, ...(kind === "relationship" ? {} : { minimum: kind === "profile" ? 0 : 1, maximum: 5 }) });
const interactions = [
  source("subject@1"), source("character@1"), source("claim@1"), source("moment@1"), source("object@1"), source("event@1"), source("reveal@1"),
  choices("composition@1", "spatial", ["Center", "Left", "Right"], "composition-stage@1"),
  choices("focal-anchor@1", "spatial", ["Center", "Upper left", "Upper right", "Lower left", "Lower right"], "focal-anchor@1"),
  choices("lighting@1", "treatment", ["Daylight", "Soft light", "Low key"], "lighting-stage@1"),
  choices("ending@1", "treatment", ["Resolution", "Reversal", "Open"], "ending-label@1"),
  choices("knowledge@1", "treatment", ["A", "B", "Both"], "knowledge-ownership@1"),
  choices("tension@1", "treatment", ["Low", "Medium", "High"], "tension-label@1"),
  choices("reveal-frame@1", "spatial", ["2", "3", "4"], "four-frame-reveal@1"),
  choices("camera@1", "treatment", ["Fixed", "Push in", "Pan"], "camera-direction@1"),
  choices("motion@1", "treatment", ["Still", "Slow", "Moderate"], "motion-label@1"),
  choices("instrument@1", "treatment", ["Piano", "Strings", "Synth"], "instrument-label@1"),
  choices("surface@1", "treatment", ["Matte", "Gloss", "Metal"], "surface-intent@1"),
  fields("causality@1", "relationship", [["goal", "Goal"], ["obstacle", "Obstacle"], ["decision", "Decision"]], { goal: "", obstacle: "", decision: "" }, "causal-chain@1"),
  fields("conflict@1", "relationship", [["a", "Participant A"], ["goalA", "Goal A"], ["b", "Participant B"], ["goalB", "Goal B"], ["secret", "Secret"]], { a: "", goalA: "", b: "", goalB: "", secret: "" }, "opposing-goals@1"),
  fields("energy@1", "profile", [["opening", "Opening"], ["peak", "Peak"], ["ending", "Ending"]], { opening: 1, peak: 4, ending: 2 }, "three-anchor-curve@1"),
  fields("proportions@1", "proportion", [["width", "Width"], ["height", "Height"], ["depth", "Depth"]], { width: 2, height: 3, depth: 2 }, "proportion-bounds@1"),
  { id: "evidence@1", version: 1, kind: "order", renderer: "ordered-evidence@1", feedback: "five-slide-order@1", required: true, maxLength: 600, defaultValue: [1, 2, 3].map(index => ({ id: `e${index}`, text: "" })) } satisfies Interaction,
];
type Recipe = { output: OutputKind; label: string; result: string; essential: string; decisions: [string, string, string, Binding["role"]][] };
const recipes: Recipe[] = [
  { output: "image", label: "Image", result: "1 image", essential: "composition@1", decisions: [["subject", "subject@1", "Subject", "subject"], ["composition", "composition@1", "Composition", "direction"], ["lighting", "lighting@1", "Lighting", "direction"]] },
  { output: "short_story", label: "Short story", result: "1 short story", essential: "causality@1", decisions: [["character", "character@1", "Character", "subject"], ["causality", "causality@1", "Cause and effect", "direction"], ["ending", "ending@1", "Ending", "direction"]] },
  { output: "scene", label: "Scene", result: "1 scene", essential: "conflict@1", decisions: [["conflict", "conflict@1", "Participants", "subject"], ["knowledge", "knowledge@1", "Secret known by", "constraint"], ["tension", "tension@1", "Tension", "direction"]] },
  { output: "slides", label: "Slides", result: "5 slides", essential: "evidence@1", decisions: [["claim", "claim@1", "Claim", "subject"], ["evidence", "evidence@1", "Evidence order", "evidence"]] },
  { output: "storyboard", label: "Storyboard", result: "4 frames", essential: "reveal-frame@1", decisions: [["subject", "subject@1", "Subject", "subject"], ["event", "event@1", "Event", "direction"], ["reveal", "reveal@1", "Reveal", "direction"], ["revealFrame", "reveal-frame@1", "Reveal frame", "constraint"]] },
  { output: "video", label: "Video", result: "1 clip · 4 seconds", essential: "focal-anchor@1", decisions: [["subject", "subject@1", "Subject", "subject"], ["anchor", "focal-anchor@1", "Focal anchor", "direction"], ["camera", "camera@1", "Camera", "direction"], ["motion", "motion@1", "Motion", "direction"]] },
  { output: "audio", label: "Audio", result: "1 instrumental cue", essential: "energy@1", decisions: [["moment", "moment@1", "Moment", "subject"], ["energy", "energy@1", "Energy", "direction"], ["instrument", "instrument@1", "Instrument", "direction"]] },
  { output: "model3d", label: "3D model", result: "1 object · GLB", essential: "proportions@1", decisions: [["object", "object@1", "Object", "subject"], ["proportions", "proportions@1", "Proportions", "direction"], ["surface", "surface@1", "Surface", "direction"]] },
];
const outputs: Record<string, OutputContract> = {};
const copy: Record<string, string> = {};
export const definitions: readonly Definition[] = recipes.map(recipe => {
  const outputContractRef = `${recipe.output}.single@1`;
  const bindingPackRef = `${recipe.output}.direction@1`;
  const viewerRef = `${recipe.output}.read-only@1`;
  outputs[outputContractRef] = { id: outputContractRef, version: 1, output: recipe.output, label: recipe.label, result: recipe.result, bindingPackRef, essentialInteractionRef: recipe.essential, viewerRef, bindings: recipe.decisions.map(([id, interactionRef, , role]) => ({ slot: id, decisionId: id, interactionRef, role, target: recipe.output })) };
  return { schemaVersion: 1, id: recipe.output.replaceAll("_", "-"), revision: 1, outputContractRef, bindingPackRef, essentialInteractionRef: recipe.essential, layout: "stage-and-controls", decisions: recipe.decisions.map(([id, interactionRef, label]) => { const labelKey = `${recipe.output}.${id}`; copy[labelKey] = label; return { id, interactionRef, bindingSlot: id, labelKey }; }), viewerRef, mobileProfileRef: "touch.standard@1", copySetRef: "functional.en@1" };
});

/** Synthetic qualification only. Presence here never grants provider, account or spending authority. */
export const fixtureCatalog: Catalog = { version: "forma-experience-fixture@1", qualification: "fixture", interactions: Object.fromEntries(interactions.map(item => [item.id, item])), outputs, copy };

import type { EXPERIENCE_VIDEO_INTENT } from "./video-reference.ts";
export type OutputKind = "image" | "slides" | "short_story" | "scene" | "model3d" | "storyboard" | "audio" | "video";
/** Planned musical intent only, never measured output or execution authority. */
export const EXPERIENCE_AUDIO_INTENT = Object.freeze({
  role: "score", goal: "timed_music", destination: "standalone", durationSeconds: 20, requireInstrumental: true,
} as const);
export type InteractionKind = "source" | "spatial" | "order" | "treatment" | "ratio";
export type ExperienceValue = string | Record<string, string | number> | Array<{ id: string; text: string }>;
export type Issue = Readonly<{ code: string; path: string }>;
export type Decision = Readonly<{ id: string; interactionRef: string; bindingSlot: string; labelKey: string }>;
export type Definition = Readonly<{
  schemaVersion: 1;
  id: string;
  revision: number;
  outputContractRef: string;
  bindingPackRef: string;
  essentialInteractionRef: string;
  layout: "stage-and-controls" | "stacked-stage";
  decisions: readonly Decision[];
  viewerRef: string;
  mobileProfileRef: "touch.standard@1";
  copySetRef: "functional.en@1";
}>;
export type Interaction = Readonly<{
  id: string;
  version: 1;
  kind: InteractionKind;
  renderer: string;
  feedback: string;
  options?: readonly Readonly<{ value: string; label: string }>[];
  fields?: readonly Readonly<{ id: string; label: string }>[];
  ratios?: readonly Readonly<{ width: number; height: number; label: string; dimensions: Readonly<{ width: number; height: number }> }>[];
  required: boolean;
  maxLength: number;
  minimum?: number;
  maximum?: number;
  defaultValue: ExperienceValue;
}>;
export type Binding = Readonly<{ slot: string; decisionId: string; interactionRef: string; role: "subject" | "direction" | "evidence" | "constraint"; target: OutputKind }>;
export type OutputContract = Readonly<{
  id: string;
  version: 1 | 2;
  output: OutputKind;
  label: string;
  result: string;
  audioIntent?: typeof EXPERIENCE_AUDIO_INTENT;
  videoIntent?: typeof EXPERIENCE_VIDEO_INTENT;
  bindingPackRef: string;
  essentialInteractionRef: string;
  viewerRef: string;
  bindings: readonly Binding[];
}>;
export type Catalog = Readonly<{
  version: "forma-experience-context@2";
  qualification: "context-authoring";
  interactions: Readonly<Record<string, Interaction>>;
  outputs: Readonly<Record<string, OutputContract>>;
  copy: Readonly<Record<string, string>>;
}>;
export type CompiledRelease = Readonly<{
  schemaVersion: 1;
  qualification: "context-authoring";
  definition: Definition;
  output: OutputContract;
  interactions: Readonly<Record<string, Interaction>>;
  copy: Readonly<Record<string, string>>;
  definitionHash: string;
  releaseHash: string;
  dependencies: Readonly<Record<string, string>>;
}>;
export type CompileResult = { ok: true; release: CompiledRelease } | { ok: false; issues: readonly Issue[] };
export type DecisionValue = Readonly<{ value: ExperienceValue; provenance: "default" | "authored" }>;
export type Draft = Readonly<{ id: string; revision: number; releaseHash: string; values: Readonly<Record<string, DecisionValue>> }>;
export type BoundContext = Readonly<{
  id: string;
  bindingSlot: string;
  role: Binding["role"];
  scope: "document";
  target: OutputKind;
  value: ExperienceValue;
  provenance: DecisionValue["provenance"];
}>;

export const CREATIVE_STUDY_DEFINITIONS = [
  { kind: "character", label: "Character study", shortLabel: "Character", description: "Lock identity, silhouette, expression, pose language, and distinguishing details before composition." },
  { kind: "location", label: "Location study", shortLabel: "Location", description: "Lock geography, architecture, spatial character, time, weather, and environmental continuity." },
  { kind: "logo", label: "Logo study", shortLabel: "Logo", description: "Lock mark construction, typography, spacing, contrast, and permitted presentation behavior." },
  { kind: "prop", label: "Prop study", shortLabel: "Prop", description: "Lock an important object’s form, materials, scale, wear, and recognizable details." },
  { kind: "wardrobe", label: "Wardrobe study", shortLabel: "Wardrobe", description: "Lock garments, styling, palette, fit, texture, and continuity across subjects." },
  { kind: "material", label: "Material study", shortLabel: "Material", description: "Lock surface, finish, fabrication, aging, reflectance, and tactile qualities." },
  { kind: "lighting", label: "Lighting study", shortLabel: "Lighting", description: "Lock source direction, contrast, color temperature, atmosphere, and exposure intent." },
] as const;

export type CreativeStudyKind = typeof CREATIVE_STUDY_DEFINITIONS[number]["kind"];
export type ReplayDevelopmentStageKind = CreativeStudyKind | "composition";

export type ReplayDevelopmentStage = {
  kind: ReplayDevelopmentStageKind;
  label: string;
  purpose: string;
  sequence: number;
  total: number;
  study: boolean;
  consumesStudies: CreativeStudyKind[];
};

const STUDY_KINDS = new Set<string>(CREATIVE_STUDY_DEFINITIONS.map((definition) => definition.kind));

export function normalizeCreativeStudyTypes(value: unknown): CreativeStudyKind[] {
  const candidates = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return [...new Set(candidates.map((item) => String(item).trim()).filter((item): item is CreativeStudyKind => STUDY_KINDS.has(item)))];
}

export function creativeStudyDefinition(kind: CreativeStudyKind) {
  return CREATIVE_STUDY_DEFINITIONS.find((definition) => definition.kind === kind)!;
}

export function buildReplayDevelopmentStages(studyTypes: unknown, minimumMilestones = 1): ReplayDevelopmentStage[] {
  const studies = normalizeCreativeStudyTypes(studyTypes);
  const compositionCount = Math.max(1, Math.floor(minimumMilestones) - studies.length);
  const unnumbered = [
    ...studies.map((kind) => {
      const definition = creativeStudyDefinition(kind);
      return { kind, label: definition.label, purpose: definition.description, study: true, consumesStudies: [] as CreativeStudyKind[] };
    }),
    ...Array.from({ length: compositionCount }, (_, index) => ({
      kind: "composition" as const,
      label: index === 0 ? "Composed image" : `Composition refinement ${index}`,
      purpose: index === 0
        ? "Combine the locked study decisions into one coherent production image without silently changing them."
        : "Refine the composed image while preserving every accepted study decision.",
      study: false,
      consumesStudies: studies,
    })),
  ];
  return unnumbered.map((stage, index) => ({ ...stage, sequence: index + 1, total: unnumbered.length }));
}

export function replayDevelopmentSummary(stages: ReplayDevelopmentStage[]) {
  const studies = stages.filter((stage) => stage.study);
  return {
    studyCount: studies.length,
    compositionCount: stages.length - studies.length,
    studyTypes: studies.map((stage) => stage.kind as CreativeStudyKind),
    stageLabels: stages.map((stage) => stage.label),
  };
}

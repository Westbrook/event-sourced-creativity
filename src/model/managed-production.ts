import { combinedContextGroups, combinedContextMemberships, normalizeCombinedContextMembership } from "./combined-context.ts";
import { requiredContextAdaptationFacts } from "./context-adaptation.ts";
import type { DocumentArtifactKind } from "./document-artifacts.ts";
import { promptFactIsActive } from "./prompt-policy.ts";
import { inferPresentationSourceOutline } from "./presentation-source.ts";
import { VIDEO_ADAPTER_CONTRACT, type VideoDurationSeconds } from "./video-adapter.ts";

export type ProductionMode = "manual" | "managed";
export type ProductionFormat = DocumentArtifactKind | "image";

export type ArtifactProductionSelection = {
  kind: DocumentArtifactKind;
  mode: ProductionMode;
  storyboardManagedDefault: boolean;
  storyboardManualOptOut: boolean;
};

/** Automatically improve storyboard continuity without changing another format's paid behavior. */
export function selectArtifactProductionKind(selection: ArtifactProductionSelection, kind: DocumentArtifactKind): ArtifactProductionSelection {
  if (selection.kind === kind) return selection;
  const mode = selection.kind === "storyboard" && selection.storyboardManagedDefault ? "manual" : selection.mode;
  const storyboardManagedDefault = kind === "storyboard" && mode === "manual" && !selection.storyboardManualOptOut;
  return { kind, mode: storyboardManagedDefault ? "managed" : mode, storyboardManagedDefault, storyboardManualOptOut: selection.storyboardManualOptOut };
}

export type ProductionSpecialist = {
  id: string;
  label: string;
  responsibility: string;
  deliverable: string;
};

export type ProductionTeam = {
  id: string;
  version: string;
  label: string;
  format: ProductionFormat;
  specialists: readonly ProductionSpecialist[];
};

const specialist = (id: string, label: string, responsibility: string, deliverable: string): ProductionSpecialist =>
  ({ id, label, responsibility, deliverable });

/** Deployable, versioned role contracts; these are not claims of autonomous model calls. */
export const PRODUCTION_TEAMS: Readonly<Record<ProductionFormat, ProductionTeam>> = {
  audio: {
    id: "music-production-team", version: "1.0.0", label: "Music production team", format: "audio",
    specialists: [
      specialist("music-director", "Music director", "Choose a purposeful musical language, dramatic structure, recurring motifs, and cue timing.", "Emotional arc, music brief, and scene-by-scene cue sheet"),
      specialist("film-music-composer", "Film music composer", "Translate authored narrative beats, images, and emotional turns into original composition.", "Original score, instrumentation, and dramatic transitions"),
      specialist("sound-designer", "Sound designer", "Shape believable ambience, texture, spatial depth, environmental sound, and deliberate silence.", "Layered sonic environment and accessibility-ready descriptions"),
      specialist("record-producer", "Record producer", "Balance arrangement, energy, originality, clarity, and audience impact without genre imitation.", "Production-ready arrangement and originality review"),
    ],
  },
  video: {
    id: "film-production-team", version: "1.0.0", label: "Film production team", format: "video",
    specialists: [
      specialist("director", "Director", "Shape the complete dramatic arc, pacing, editorial priorities, and key-scene selection.", "Narrative structure, anchor rationale, and final editorial contract"),
      specialist("script-writer", "Script writer", "Translate every authored decision into distinct, source-attributed, playable story beats.", "Non-repeating scene script and complete context-coverage ledger"),
      specialist("cinematographer", "Cinematographer", "Preserve identity, wardrobe, location, light, palette, camera axis, lens, and movement.", "Shared visual-continuity bible and scene camera direction"),
      specialist("story-boarder", "Story boarder", "Design shots, approved reference bindings, transition boundaries, and execution dependencies.", "Chronological storyboard and anchor-first scene dependency graph"),
    ],
  },
  storyboard: {
    id: "previsualization-team", version: "1.0.0", label: "Previsualization team", format: "storyboard",
    specialists: [
      specialist("director", "Director", "Set shot intent and choose the strongest visual anchor.", "Shot progression and anchor selection"),
      specialist("story-boarder", "Storyboard artist", "Design distinct compositions and coherent shot-to-shot action.", "Ordered frame and transition plan"),
      specialist("cinematographer", "Cinematographer", "Maintain recurring subjects, lenses, lighting, and screen direction.", "Reusable visual-continuity bible"),
      specialist("continuity-supervisor", "Continuity supervisor", "Prevent visual drift and repeated narrative beats.", "Reference-handoff and context-coverage review"),
    ],
  },
  slides: {
    id: "presentation-editorial-team", version: "1.0.0", label: "Presentation editorial team", format: "slides",
    specialists: [
      specialist("narrative-strategist", "Narrative strategist", "Organize a complete argument and audience-specific progression.", "Distinct deck argument and chapter spine"),
      specialist("information-designer", "Information designer", "Choose the clearest visual expression for each source claim.", "Per-slide visual and evidence plan"),
      specialist("presentation-art-director", "Presentation art director", "Maintain one accessible, coherent presentation design system.", "Reusable layout, typography, and color direction"),
      specialist("fact-checker", "Fact and continuity editor", "Check grounding, missing context, isolation, and duplicated claims.", "Source-coverage and duplication review"),
    ],
  },
  short_story: {
    id: "writers-room", version: "1.0.0", label: "Writers’ room", format: "short_story",
    specialists: [
      specialist("developmental-editor", "Developmental editor", "Shape the emotional structure and coherent narrative progression.", "Narrative arc and editorial priorities"),
      specialist("story-architect", "Story architect", "Assign authored context to distinct story movements.", "Source-attributed narrative beat sheet"),
      specialist("continuity-editor", "Continuity editor", "Protect character, setting, chronology, and factual consistency.", "Character and world continuity bible"),
      specialist("prose-stylist", "Prose stylist", "Match voice, audience, tone, and sentence-level quality.", "Final prose and repetition review"),
    ],
  },
  scene: {
    id: "screenwriting-room", version: "1.0.0", label: "Screenwriting room", format: "scene",
    specialists: [
      specialist("showrunner", "Showrunner", "Define dramatic purpose, escalation, and editorial focus.", "Playable scene structure"),
      specialist("screenwriter", "Screenwriter", "Turn authored context into production-readable action and dialogue.", "Distinct source-attributed screenplay beats"),
      specialist("dialogue-editor", "Dialogue editor", "Keep dialogue purposeful, specific, and consistent with character.", "Voice and dialogue polish"),
      specialist("script-supervisor", "Script supervisor", "Protect wardrobe, props, geography, chronology, and restrictions.", "Screen continuity and source-coverage review"),
    ],
  },
  image: {
    id: "image-art-direction-team", version: "1.0.0", label: "Image art-direction team", format: "image",
    specialists: [
      specialist("creative-director", "Creative director", "Prioritize the complete authored visual intent.", "Source-grounded image concept"),
      specialist("art-director", "Art director", "Resolve composition, styling, materials, and visual hierarchy.", "Production design and composition direction"),
      specialist("lighting-designer", "Lighting designer", "Coordinate lighting, camera treatment, palette, and atmosphere.", "Photographic lighting and camera contract"),
      specialist("brand-steward", "Brand and continuity steward", "Check identity, approved references, exclusions, and exact copy.", "Authorial constraint and continuity review"),
    ],
  },
};

export const productionTeamFor = (format: ProductionFormat) => PRODUCTION_TEAMS[format];

export type ProductionClaim = {
  id: string;
  blockId: string;
  type: string;
  text: string;
  required: boolean;
  continuity: boolean;
  negative: boolean;
  contextGroupIds: string[];
  storyboardSequence: number | null;
  palette?: string[];
  artifactId?: string;
  artifactItemId?: string;
  ordinal?: number;
  sourceKind?: "fact" | "artifact-item" | "standing-constraint" | "authored-slide";
};

export type ProductionReference = {
  referenceId: string;
  blockId: string;
  sequence: number | null;
  contextGroupIds: string[];
  label: string;
};

export type ProductionContinuityBible = {
  subjects: string[];
  locations: string[];
  wardrobe: string[];
  props: string[];
  palette: string[];
  lighting: string[];
  camera: string[];
  style: string[];
  sound: string[];
  prohibitions: string[];
  requiredBlockIds: string[];
};

export type ProductionScene = {
  id: string;
  narrativeOrder: number;
  title: string;
  action: string;
  cameraDirection: string;
  imagePrompt: string;
  narrativePurpose: "opening" | "development" | "turning-point" | "climax" | "resolution";
  durationSeconds: VideoDurationSeconds;
  sourceClaimIds: string[];
  sourceBlockIds: string[];
  sourceArtifactItemIds?: string[];
  contextGroupIds: string[];
  section?: string;
  sourceOutlineOrder?: number;
  referenceIds: string[];
  dependsOn: string[];
  startBoundaryId: string | null;
  endBoundaryId: string | null;
  transitionIn: string;
  transitionOut: string;
  anchorScore: number;
  continuityStrategy: "existing-references" | "generated-anchor" | "chained-boundary";
};

export type ManagedProductionPlan = {
  schemaVersion: 1;
  mode: "managed";
  format: ProductionFormat;
  team: ProductionTeam;
  claims: ProductionClaim[];
  contextGroups: ReturnType<typeof combinedContextGroups>;
  continuityBible: ProductionContinuityBible;
  scenes: ProductionScene[];
  authoredSlideCount: number;
  requestedSlideCount: number | null;
  predictedSlideCount: number;
  slideCountMismatch: boolean;
  slideCountMismatchCode: "requested_less_than_authored" | "requested_more_than_authored" | null;
  slideCountMismatchReason: "requested_less_than_authored" | "requested_more_than_authored" | null;
  slideCountMismatchMessage: string | null;
  providerBatchSize: number;
  providerBatchCount: number;
  providerCallCount: number;
  maxRepairCallCount: number;
  maximumProviderCallCount: number;
  providerBatches: Array<{
    index: number;
    startSlide: number;
    endSlide: number;
    slideCount: number;
    reservationMicrousd: number;
  }>;
  narrativeOrder: string[];
  executionOrder: string[];
  parallelWaves: string[][];
  anchorSceneId: string;
  anchorRationale: string;
  totalDurationSeconds: number;
  estimatedVideoCostMicrousd: number;
  estimatedReferenceCostMicrousd: number;
  estimatedPlanningCostMicrousd: number;
  estimatedTotalCostMicrousd: number;
  providerCapabilities: {
    maximumSceneSeconds: 15;
    maximumReferencesPerScene: 9;
    nativeBoundaryFrames: false;
    videoFrameExtraction: false;
    finalVideoComposition: false;
    assembly: "ordered-scene-reel";
  };
};

export type ProductionPlanOptions = {
  references?: ProductionReference[];
  preferredSceneSeconds?: number;
  requestedItemCount?: number;
  requestedSlideCount?: number;
  resolution?: "480p" | "720p";
  maximumParallelScenes?: number;
};

export const MANAGED_PRODUCTION_BATCH_SIZE = 8;
export const MANAGED_PRODUCTION_BATCH_RESERVATION_MICROUSD = 1_000_000;
/** The editable PowerPoint adapter supports at most one hundred slides. */
export const MAX_MANAGED_PRESENTATION_SLIDES = 100;

const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const clean = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
const unique = (values: Iterable<string>) => [...new Set([...values].map(clean).filter(Boolean))];
const continuityTypes = new Set(["subject", "environment", "location", "wardrobe", "object", "prop", "palette", "lighting", "camera", "style", "material", "brand", "typography", "format", "audio"]);
const negativeIntents = new Set(["avoid", "prohibit", "exclude", "must_not_include", "exclusion", "forbid"]);

export function isNegativeProductionFact(fact: Record<string, unknown>) {
  const properties = asRecord(fact.properties);
  return [fact.intent, fact.effect, fact.polarity, properties.intent, properties.effect, properties.polarity, fact.type, fact.role]
    .some((value) => negativeIntents.has(clean(value).toLowerCase()));
}

function factText(fact: Record<string, unknown>) {
  const properties = asRecord(fact.properties);
  const authoredPalette = Array.isArray(properties.palette) && properties.palette.length ? properties.palette : Array.isArray(properties.output_palette) && properties.output_palette.length ? properties.output_palette : null;
  const authored = unique([properties.text, properties.instruction, properties.description, properties.label, properties.value, properties.storyboard_shot_direction, properties.video_scene_direction, properties.exact_text, authoredPalette ? authoredPalette.join(", ") : Array.isArray(properties.colors) ? properties.colors.join(", ") : ""].map(clean));
  return (authored.length ? authored : unique([clean(fact.handle)])).join(" · ");
}

export function productionClaims(snapshot: Record<string, unknown>): ProductionClaim[] {
  const mandatory = new Set(requiredContextAdaptationFacts(snapshot).map((fact) => fact.blockId));
  const facts = (Array.isArray(snapshot.facts) ? snapshot.facts : []).filter(promptFactIsActive).map(asRecord);
  const authoritativeGroups = new Map<string, string[]>();
  for (const group of combinedContextGroups(snapshot)) for (const member of group.members) {
    authoritativeGroups.set(member.blockId, [...(authoritativeGroups.get(member.blockId) ?? []), group.id]);
  }
  const materializedItems = new Set(facts.flatMap((fact) => {
    const properties = asRecord(fact.properties);
    const artifactId = clean(properties.source_artifact_id);
    const itemId = clean(properties.source_artifact_item_id);
    return artifactId && itemId ? [`${artifactId}\u0000${itemId}`] : [];
  }));
  const claims = facts.flatMap((fact, index): ProductionClaim[] => {
    const properties = asRecord(fact.properties);
    const text = factText(fact);
    const blockId = clean(fact.block_id) || `source-${index + 1}`;
    const type = clean(fact.type || fact.role || "direction");
    const rawSequence = Number(properties.storyboard_frame_index ?? properties.storyboard_sequence ?? properties.video_scene_index ?? properties.narrative_order);
    const storyboardSequence = Number.isSafeInteger(rawSequence) && rawSequence > 0 ? rawSequence : null;
    const negative = isNegativeProductionFact(fact);
    const authoredPalette = Array.isArray(properties.palette) && properties.palette.length ? properties.palette : Array.isArray(properties.output_palette) ? properties.output_palette : [];
    const contextGroupIds = unique([
      ...combinedContextMemberships(properties).map((membership) => membership.contextSetId),
      ...(Array.isArray(properties.context_group_ids) ? properties.context_group_ids.map(clean) : []),
      ...(authoritativeGroups.get(blockId) ?? []),
    ]);
    const artifactId = clean(properties.source_artifact_id);
    const artifactStructure = asRecord(properties.artifact_structure);
    const artifactItems = Array.isArray(artifactStructure.items) ? artifactStructure.items.map(asRecord) : [];
    if (artifactItems.length) {
      return artifactItems.flatMap((item, itemIndex): ProductionClaim[] => {
        const itemId = clean(item.source_artifact_item_id ?? item.id) || `item-${itemIndex + 1}`;
        if (artifactId && materializedItems.has(`${artifactId}\u0000${itemId}`)) return [];
        const slide = asRecord(item.slide);
        const visual = asRecord(slide.visual);
        const itemText = unique([
          item.title, item.body, item.notes, item.image_prompt,
          ...(Array.isArray(slide.bullets) ? slide.bullets : []),
          slide.headline, slide.subheadline, visual.description, visual.caption,
        ].map(clean)).join(" · ");
        if (!itemText) return [];
        const sequence = Number(item.narrative_order ?? item.storyboard_frame_index ?? item.video_scene_index ?? itemIndex + 1);
        return [{
          id: `claim:${blockId}:item:${itemId}`,
          blockId,
          type,
          text: itemText,
          required: mandatory.has(blockId),
          continuity: false,
          negative: negative || isNegativeProductionFact(item),
          contextGroupIds: unique([...contextGroupIds, ...(Array.isArray(item.context_group_ids) ? item.context_group_ids.map(clean) : [])]),
          storyboardSequence: Number.isSafeInteger(sequence) && sequence > 0 ? sequence : itemIndex + 1,
          ...(authoredPalette.length ? { palette: unique(authoredPalette.map(clean)) } : {}),
          ...(artifactId ? { artifactId } : {}),
          artifactItemId: itemId,
          ordinal: index * 1_000_000 + itemIndex,
          sourceKind: "artifact-item",
        }];
      });
    }
    if (!text) return [];
    const itemId = clean(properties.source_artifact_item_id);
    return [{
      id: `claim:${blockId}`,
      blockId,
      type,
      text,
      required: mandatory.has(blockId),
      continuity: continuityTypes.has(type) && storyboardSequence === null,
      negative,
      contextGroupIds,
      storyboardSequence,
      ...(authoredPalette.length ? { palette: unique(authoredPalette.map(clean)) } : {}),
      ...(artifactId ? { artifactId } : {}),
      ...(itemId ? { artifactItemId: itemId } : {}),
      ordinal: index * 1_000_000,
      sourceKind: "fact",
    } satisfies ProductionClaim];
  });
  const standing = (Array.isArray(snapshot.standing_constraints) ? snapshot.standing_constraints : []).map(asRecord)
    .filter((constraint) => !constraint.authority || clean(constraint.authority).toLowerCase() === "authored")
    .flatMap((constraint, index): ProductionClaim[] => {
      const axis = clean(constraint.axis);
      const value = clean(constraint.value);
      if (!value) return [];
      return [{
        id: `claim:standing:${index + 1}`,
        blockId: `standing:${index + 1}`,
        type: axis || "direction",
        text: axis ? `${axis}: ${value}` : value,
        required: true,
        continuity: continuityTypes.has(axis),
        negative: isNegativeProductionFact(constraint),
        contextGroupIds: [],
        storyboardSequence: null,
        ordinal: (facts.length + index) * 1_000_000,
        sourceKind: "standing-constraint",
      }];
    });
  return [...claims, ...standing];
}

function continuityBible(claims: ProductionClaim[]): ProductionContinuityBible {
  const select = (...types: string[]) => unique(claims.filter((claim) => !claim.negative && types.includes(claim.type)).map((claim) => claim.text));
  return {
    subjects: select("subject", "character"),
    locations: select("environment", "location"),
    wardrobe: select("wardrobe"),
    props: select("object", "prop"),
    palette: unique([...select("palette"), ...claims.filter((claim) => !claim.negative).flatMap((claim) => claim.palette ?? [])]),
    lighting: select("lighting"),
    camera: select("camera"),
    style: select("style", "material", "brand"),
    sound: select("audio"),
    prohibitions: unique(claims.filter((claim) => claim.negative).map((claim) => claim.text)),
    requiredBlockIds: unique(claims.filter((claim) => claim.required).map((claim) => claim.blockId)),
  };
}

export type ProviderFacingProductionContinuity = Omit<ProductionContinuityBible, "requiredBlockIds">;
export type ProviderFacingProductionTarget = { target: string; role: string; required: string[]; prohibitions: string[] };

/** Resolve target-scoped decisions without exposing durable Combined Context IDs. */
export function providerFacingProductionTargets(plan: Pick<ManagedProductionPlan, "claims"> & Partial<Pick<ManagedProductionPlan, "contextGroups">>, snapshot?: Record<string, unknown>): ProviderFacingProductionTarget[] {
  const groups = new Map((snapshot ? combinedContextGroups(snapshot) : plan.contextGroups ?? []).map((group) => [group.id, group]));
  const scoped = new Map<string, ProviderFacingProductionTarget>();
  for (const claim of plan.claims) for (const groupId of claim.contextGroupIds) {
    const group = groups.get(groupId);
    if (!group || group.role === "sequence" || group.role === "slide_chapter") continue;
    const key = `${group.role}\u0000${group.target}`;
    const target = scoped.get(key) ?? { target: group.target, role: group.role, required: [], prohibitions: [] };
    (claim.negative ? target.prohibitions : target.required).push(claim.text);
    scoped.set(key, target);
  }
  return [...scoped.values()].map((target) => ({ ...target, required: unique(target.required), prohibitions: unique(target.prohibitions) }));
}

/** Authorial continuity may reach a provider; durable identifiers and another target's decisions may not. */
export function providerFacingProductionContinuity(
  plan: Pick<ManagedProductionPlan, "claims">,
  scene?: Pick<ProductionScene, "contextGroupIds">,
): ProviderFacingProductionContinuity {
  const allowedGroups = new Set(scene?.contextGroupIds ?? []);
  const scoped = scene
    ? plan.claims.filter((claim) => !claim.contextGroupIds.length || claim.contextGroupIds.some((id) => allowedGroups.has(id)))
    : plan.claims;
  const bible = continuityBible(scoped);
  return { subjects: bible.subjects, locations: bible.locations, wardrobe: bible.wardrobe, props: bible.props, palette: bible.palette, lighting: bible.lighting, camera: bible.camera, style: bible.style, sound: bible.sound, prohibitions: bible.prohibitions };
}

const purposeFor = (index: number, count: number): ProductionScene["narrativePurpose"] =>
  index === 0 ? "opening" : index === count - 1 ? "resolution" : index === Math.max(1, Math.round((count - 1) * .7)) ? "climax" : index === Math.floor((count - 1) / 2) ? "turning-point" : "development";

const sceneDuration = (text: string, preferredSeconds?: number): VideoDurationSeconds => {
  const words = clean(text).split(" ").filter(Boolean).length;
  const requested = Number.isFinite(preferredSeconds) ? Number(preferredSeconds) : Math.ceil(words / 2.5) + 5;
  return Math.max(4, Math.min(15, Math.max(6, Math.round(requested)))) as VideoDurationSeconds;
};

function storyboardFacts(snapshot: Record<string, unknown>, claims: ProductionClaim[]) {
  const facts = new Map((Array.isArray(snapshot.facts) ? snapshot.facts : []).filter(promptFactIsActive).map(asRecord).map((fact) => [clean(fact.block_id), fact]));
  const groupOrder = new Map<string, number>();
  return claims.flatMap((claim, index) => {
    if (claim.storyboardSequence === null || claim.negative) return [];
    const fact = facts.get(claim.blockId);
    if (!fact) return [];
    const base = asRecord(fact.properties);
    const nested = claim.artifactItemId
      ? (Array.isArray(asRecord(base.artifact_structure).items) ? asRecord(base.artifact_structure).items as unknown[] : [])
        .map(asRecord).find((item) => clean(item.source_artifact_item_id ?? item.id) === claim.artifactItemId)
      : undefined;
    const properties = nested ? {
      ...base,
      text: clean(nested.body ?? nested.title),
      label: clean(nested.title),
      storyboard_shot_title: clean(nested.title),
      storyboard_shot_direction: clean(nested.body ?? nested.title),
      storyboard_camera_direction: clean(nested.notes),
      storyboard_frame_prompt: clean(nested.image_prompt ?? nested.body),
      source_artifact_item_id: claim.artifactItemId,
    } : base;
    const groupId = clean(claim.artifactId ?? properties.source_artifact_id ?? properties.reference_set_id ?? properties.context_set_id ?? properties.storyboard_title) || `source-${index + 1}`;
    if (!groupOrder.has(groupId)) groupOrder.set(groupId, groupOrder.size);
    return [{ fact, properties, sequence: claim.storyboardSequence, groupId, claim, position: index }];
  }).sort((left, right) => groupOrder.get(left.groupId)! - groupOrder.get(right.groupId)! || left.sequence - right.sequence || left.position - right.position);
}

function boundReferences(scene: ProductionScene, references: ProductionReference[]) {
  const source = new Set(scene.sourceBlockIds);
  const groups = new Set(scene.contextGroupIds);
  return [...references]
    .filter((reference) => {
      if (reference.contextGroupIds.length && groups.size && !reference.contextGroupIds.some((id) => groups.has(id))) return false;
      if (reference.contextGroupIds.length && !groups.size && !source.has(reference.blockId)) return false;
      return true;
    })
    .sort((left, right) => {
      const rank = (value: ProductionReference) =>
        (source.has(value.blockId) ? 100 : 0) +
        (value.sequence === scene.narrativeOrder ? 40 : 0) +
        (value.contextGroupIds.some((id) => groups.has(id)) ? 20 : 0) +
        (value.sequence === null ? 10 : 0) -
        (value.sequence === null ? 0 : Math.abs(value.sequence - scene.narrativeOrder));
      return rank(right) - rank(left) || left.referenceId.localeCompare(right.referenceId);
    })
    .filter((reference) => source.has(reference.blockId) || reference.sequence === scene.narrativeOrder || reference.sequence === null || reference.contextGroupIds.some((id) => groups.has(id)))
    .slice(0, VIDEO_ADAPTER_CONTRACT.maxReferenceImages)
    .map((reference) => reference.referenceId);
}

function anchorRank(scene: ProductionScene, count: number) {
  const dramatic = /\b(?:climax|reveal|revelation|turning point|key moment|hero|iconic|confront|transform|discover|culminat|resolve)\b/i.test(`${scene.title} ${scene.action}`) ? 50 : 0;
  const purpose = scene.narrativePurpose === "climax" ? 18 : scene.narrativePurpose === "turning-point" ? 12 : 0;
  const centrality = Math.max(0, 10 - Math.abs(scene.narrativeOrder - (count + 1) / 2));
  return dramatic + purpose + centrality + scene.referenceIds.length * 16 + scene.contextGroupIds.length * 7 + Math.min(12, scene.sourceClaimIds.length * 3);
}

function buildWaves(scenes: ProductionScene[], anchorId: string, maximumParallelScenes: number) {
  const parallelLimit = Number.isFinite(maximumParallelScenes)
    ? Math.min(VIDEO_ADAPTER_CONTRACT.referenceUploadConcurrency, Math.max(1, Math.floor(maximumParallelScenes)))
    : VIDEO_ADAPTER_CONTRACT.referenceUploadConcurrency;
  const completed = new Set<string>();
  const pending = new Map(scenes.map((scene) => [scene.id, scene]));
  const waves: string[][] = [];
  while (pending.size) {
    let ready = [...pending.values()].filter((scene) => scene.dependsOn.every((dependency) => completed.has(dependency)));
    if (!waves.length) ready = ready.filter((scene) => scene.id === anchorId);
    if (!ready.length) throw new Error("production_scene_dependency_cycle");
    ready.sort((left, right) => right.anchorScore - left.anchorScore || left.narrativeOrder - right.narrativeOrder);
    const wave = ready.slice(0, parallelLimit).map((scene) => scene.id);
    waves.push(wave);
    for (const sceneId of wave) { completed.add(sceneId); pending.delete(sceneId); }
  }
  return waves;
}

type ManagedPresentationSlideTarget = { start: number; end: number; explicit: boolean };

/** Safe, actionable source-planning errors; messages never include durable source identifiers. */
export class ManagedPresentationPlanningError extends RangeError {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ManagedPresentationPlanningError";
  }
}

const normalizedPresentationTarget = (value: string) => clean(value)
  .normalize("NFKC")
  .replace(/[‐‑‒–—―]/gu, "-")
  .replace(/\s+/gu, " ")
  .trim()
  .toLowerCase();

function explicitManagedPresentationTarget(target: string, count: number, groupName: string): ManagedPresentationSlideTarget | null {
  const normalized = normalizedPresentationTarget(target);
  if (!normalized) return null;
  if (/^(?:first|opening) slide$/u.test(normalized)) return { start: 0, end: 0, explicit: true };
  if (/^(?:last|final|closing) slide$/u.test(normalized)) return { start: count - 1, end: count - 1, explicit: true };
  const range = /^slides?\s+(\d+)\s*(?:-|to|through)\s*(?:slides?\s+)?(\d+)$/u.exec(normalized);
  const individual = /^slides?\s+(\d+)$/u.exec(normalized);
  if (!range && !individual) {
    if (/\bslides?\b/u.test(normalized)) {
      throw new ManagedPresentationPlanningError("presentation_context_target_ambiguous", `Combined Context “${groupName}” needs one slide or one contiguous slide range; “${clean(target)}” is ambiguous.`);
    }
    return null;
  }
  const start = Number((range ?? individual)![1]);
  const end = range ? Number(range[2]) : start;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end > count) {
    throw new ManagedPresentationPlanningError("presentation_context_target_out_of_range", `Combined Context “${groupName}” targets ${clean(target)}, outside the requested ${count}-slide presentation.`);
  }
  return { start: start - 1, end: end - 1, explicit: true };
}

function managedPresentationGroupTargets(
  snapshot: Record<string, unknown>,
  groups: ReturnType<typeof combinedContextGroups>,
  count: number,
): Map<string, ManagedPresentationSlideTarget> {
  const memberships = new Map<string, Array<{ target: string; name: string; role: string; application: string }>>();
  for (const fact of (Array.isArray(snapshot.facts) ? snapshot.facts : []).filter(promptFactIsActive).map(asRecord)) {
    const properties = asRecord(fact.properties);
    const rawMemberships = Array.isArray(properties.combined_context_memberships)
      ? properties.combined_context_memberships
      : properties.combined_context ? [properties.combined_context] : [];
    const definitions = rawMemberships.length
      ? rawMemberships.flatMap((value, index) => {
        const normalized = normalizeCombinedContextMembership(value, index);
        return normalized ? [normalized] : [];
      })
      : combinedContextMemberships(properties);
    for (const membership of definitions) {
      const existing = memberships.get(membership.contextSetId) ?? [];
      existing.push({ target: membership.target, name: membership.name, role: membership.role, application: membership.application });
      memberships.set(membership.contextSetId, existing);
    }
  }
  const targets = new Map<string, ManagedPresentationSlideTarget>();
  for (const group of groups) {
    const definitions = memberships.get(group.id) ?? [{ target: group.target, name: group.name, role: group.role, application: group.application }];
    const roles = new Set(definitions.map((definition) => definition.role));
    const applications = new Set(definitions.map((definition) => definition.application));
    if (roles.size > 1 || applications.size > 1) {
      throw new ManagedPresentationPlanningError("presentation_context_target_conflict", `Combined Context “${group.name}” has conflicting role or placement settings; resolve them before generating slides.`);
    }
    const resolved = definitions.flatMap((definition) => {
      const target = explicitManagedPresentationTarget(definition.target, count, group.name);
      return target ? [target] : [];
    });
    const distinctNamedTargets = new Set(definitions.map((definition) => normalizedPresentationTarget(definition.target)).filter(Boolean));
    if (resolved.some((target) => target.start !== resolved[0]!.start || target.end !== resolved[0]!.end)
      || resolved.length > 0 && resolved.length !== definitions.length
      || resolved.length === 0 && distinctNamedTargets.size > 1) {
      throw new ManagedPresentationPlanningError("presentation_context_target_conflict", `Combined Context “${group.name}” points to conflicting presentation targets; choose one slide or contiguous chapter.`);
    }
    if (resolved[0]) targets.set(group.id, resolved[0]);
  }
  const isolatedGroups = groups.filter((group) => group.role === "slide_chapter" && group.application === "isolate" && targets.has(group.id));
  for (let left = 0; left < isolatedGroups.length; left += 1) for (let right = left + 1; right < isolatedGroups.length; right += 1) {
    const first = targets.get(isolatedGroups[left]!.id)!;
    const second = targets.get(isolatedGroups[right]!.id)!;
    if (Math.max(first.start, second.start) <= Math.min(first.end, second.end)) {
      throw new ManagedPresentationPlanningError("presentation_context_target_conflict", `Independently isolated Combined Context chapters “${isolatedGroups[left]!.name}” and “${isolatedGroups[right]!.name}” cannot share the same presentation slide.`);
    }
  }
  return targets;
}

/** Required authored outline positions and independently isolated chapters cannot be silently merged. */
export function minimumPresentationSlideCount(snapshot: Record<string, unknown>): number {
  const authoredCount = inferPresentationSourceOutline(snapshot).authoredSlideCount ?? 0;
  const chapters = combinedContextGroups(snapshot).filter((group) => group.role === "slide_chapter" && group.application === "isolate");
  const explicitPositions = chapters.flatMap((group) => {
    const match = /^slides?\s+(\d+)(?:\s*(?:-|to|through)\s*(?:slides?\s+)?(\d+))?$/u.exec(normalizedPresentationTarget(group.target));
    return match ? [Number(match[2] ?? match[1])] : [];
  }).filter((position) => Number.isSafeInteger(position) && position > 0);
  return Math.max(authoredCount, chapters.length, ...explicitPositions, 0);
}

/** Compile the full source context without inheriting the legacy twelve-item schema cap. */
export function buildManagedProductionPlan(format: ProductionFormat, snapshot: Record<string, unknown>, options: ProductionPlanOptions = {}): ManagedProductionPlan {
  const sourceClaims = productionClaims(snapshot);
  const sourceOutline = format === "slides" ? inferPresentationSourceOutline(snapshot) : null;
  const authoredSlides = sourceOutline?.slides ?? [];
  const authoredClaims = authoredSlides.map((slide, index): ProductionClaim => {
    const source = sourceClaims.find((claim) => claim.blockId === slide.sourceBlockId && !claim.negative)
      ?? sourceClaims.find((claim) => !claim.negative && !claim.continuity);
    const blockId = clean(slide.sourceBlockId) || source?.blockId || "";
    return {
      id: `${source?.id ?? `claim:${blockId}`}:slide:${slide.number}:${index + 1}`,
      blockId,
      type: source?.type ?? "direction",
      text: clean(slide.content) || clean(slide.title),
      required: source?.required ?? false,
      continuity: false,
      negative: false,
      contextGroupIds: unique([...(source?.contextGroupIds ?? []), ...(slide.contextGroupIds ?? [])]),
      storyboardSequence: null,
      ordinal: (source?.ordinal ?? index * 1_000_000) + index + 1,
      sourceKind: "authored-slide",
    };
  });
  const outlineSourceBlockIds = new Set(authoredClaims.map((claim) => claim.blockId).filter(Boolean));
  const claims = authoredSlides.length
    ? [
      ...sourceClaims.filter((claim) => !outlineSourceBlockIds.has(claim.blockId) || claim.negative || claim.continuity),
      ...authoredClaims,
    ]
    : [...sourceClaims];
  const references = options.references ?? [];
  const groups = combinedContextGroups(snapshot);
  const beats = storyboardFacts(snapshot, sourceClaims);
  const plotClaims = sourceClaims.filter((claim) => !claim.continuity && !claim.negative && claim.storyboardSequence === null);
  const requiredSlideCount = format === "slides" ? minimumPresentationSlideCount(snapshot) : 0;
  const isolatedSlideChapters = format === "slides" && groups.some((group) => group.role === "slide_chapter" && group.application === "isolate");
  const baselineCount = Math.max(requiredSlideCount, authoredSlides.length || beats.length || (isolatedSlideChapters ? requiredSlideCount : Math.max(1, Math.ceil(plotClaims.length / 2), groups.filter((group) => group.role === "sequence" || group.role === "scene" || group.role === "message").length)));
  const rawRequestedCount = format === "slides" ? options.requestedSlideCount ?? options.requestedItemCount : options.requestedItemCount;
  if (format === "slides" && rawRequestedCount !== undefined && rawRequestedCount !== null
    && (!Number.isFinite(Number(rawRequestedCount)) || !Number.isInteger(Number(rawRequestedCount))
      || Number(rawRequestedCount) < 0 || options.requestedSlideCount !== undefined && Number(rawRequestedCount) === 0)) {
    throw new RangeError("invalid_managed_presentation_slide_count");
  }
  const requestedCount = Number.isFinite(Number(rawRequestedCount)) ? Math.max(0, Math.floor(Number(rawRequestedCount))) : 0;
  const requestedSlideCount = format === "slides" && requestedCount > 0 ? requestedCount : null;
  if (requestedSlideCount !== null && requestedSlideCount < requiredSlideCount && requiredSlideCount > authoredSlides.length) {
    throw new ManagedPresentationPlanningError("presentation_slide_count_conflict", `The source requires at least ${requiredSlideCount} independently isolated or explicitly positioned slides; requesting ${requestedSlideCount} would merge or omit an authored chapter.`);
  }
  const plannedCount = format === "image"
    ? 1
    : format === "slides" && requestedSlideCount !== null
      ? Math.max(authoredSlides.length, requestedSlideCount)
      : Math.max(baselineCount, requestedCount);
  if (format === "slides" && plannedCount > MAX_MANAGED_PRESENTATION_SLIDES) {
    throw new RangeError(`managed_presentation_slide_count_exceeds_supported_maximum:${MAX_MANAGED_PRESENTATION_SLIDES}`);
  }
  const count = plannedCount;
  const groupTargets = format === "slides" ? managedPresentationGroupTargets(snapshot, groups, count) : new Map<string, ManagedPresentationSlideTarget>();
  const buckets: ProductionClaim[][] = Array.from({ length: count }, () => []);
  const targetedClaims = new Set<string>();
  const groupMemberOrder = new Map(groups.flatMap((group) => group.members.map((member) => [`${group.id}\u0000${member.blockId}`, member.order] as const)));
  const assignTargetedClaim = (claim: ProductionClaim, claimIndex: number, groupClaims: ProductionClaim[]) => {
    const constraints = claim.contextGroupIds.flatMap((groupId) => groupTargets.has(groupId) ? [groupTargets.get(groupId)!] : []);
    if (!constraints.length) return false;
    const start = Math.max(...constraints.map((target) => target.start));
    const end = Math.min(...constraints.map((target) => target.end));
    if (end < start) {
      throw new ManagedPresentationPlanningError("presentation_context_target_conflict", "A source decision belongs to Combined Context groups assigned to different slides; resolve the conflicting targets before generating.");
    }
    const offset = Math.min(end - start, Math.floor(claimIndex * (end - start + 1) / Math.max(1, groupClaims.length)));
    const position = start + offset;
    const authoredPosition = authoredClaims.findIndex((authored) => authored.id === claim.id);
    if (authoredPosition >= 0 && (authoredPosition < start || authoredPosition > end)) {
      const group = groups.find((candidate) => claim.contextGroupIds.includes(candidate.id) && groupTargets.has(candidate.id));
      throw new ManagedPresentationPlanningError("presentation_context_target_conflict", `Combined Context “${group?.name ?? "source chapter"}” conflicts with its explicitly authored slide position.`);
    }
    if (!buckets[position]!.some((existing) => existing.id === claim.id)) buckets[position]!.push(claim);
    targetedClaims.add(claim.id);
    return true;
  };
  for (const group of groups.filter((candidate) => groupTargets.has(candidate.id))) {
    const members = claims.filter((claim) => !claim.negative && !claim.continuity && claim.contextGroupIds.includes(group.id))
      .sort((left, right) => (groupMemberOrder.get(`${group.id}\u0000${left.blockId}`) ?? left.ordinal ?? 0)
        - (groupMemberOrder.get(`${group.id}\u0000${right.blockId}`) ?? right.ordinal ?? 0)
        || (left.ordinal ?? 0) - (right.ordinal ?? 0));
    members.forEach((claim, index) => {
      if (!targetedClaims.has(claim.id)) assignTargetedClaim(claim, index, members);
    });
  }
  const finalOutlineSourceBlockId = authoredClaims.at(-1)?.blockId;
  const expansionSourceIndexes = authoredClaims
    .map((claim, index) => ({ claim, index }))
    .filter(({ claim }) => !finalOutlineSourceBlockId || claim.blockId === finalOutlineSourceBlockId)
    .map(({ index }) => index);

  if (authoredSlides.length) {
    for (const [index, claim] of authoredClaims.entries()) {
      const constraints = claim.contextGroupIds.flatMap((groupId) => groupTargets.has(groupId) ? [groupTargets.get(groupId)!] : []);
      if (constraints.some((target) => index < target.start || index > target.end)) {
        throw new ManagedPresentationPlanningError("presentation_context_target_conflict", `An authored slide at position ${index + 1} conflicts with its Combined Context target.`);
      }
      if (!buckets[index]!.some((existing) => existing.id === claim.id)) buckets[index]!.push(claim);
    }
    const supportingClaims = plotClaims.filter((claim) => !outlineSourceBlockIds.has(claim.blockId));
    supportingClaims.filter((claim) => !targetedClaims.has(claim.id)).forEach((claim, index) => buckets[index % authoredSlides.length]!.push(claim));
    for (let index = authoredSlides.length; index < count; index += 1) {
      // Append extra evidence within the final authored chapter; reopening an earlier isolated
      // chapter would split its source group and fail the completed-deck grounding contract.
      const originalIndex = expansionSourceIndexes[(index - authoredSlides.length) % expansionSourceIndexes.length]!;
      const source = authoredClaims[originalIndex]!;
      const extension: ProductionClaim = {
        ...source,
        id: `${source.id}:expansion:${index + 1}`,
        required: false,
        ordinal: (source.ordinal ?? 0) + count + index,
      };
      if (extension.contextGroupIds.some((groupId) => {
        const target = groupTargets.get(groupId);
        return Boolean(target && (index < target.start || index > target.end));
      })) throw new ManagedPresentationPlanningError("presentation_context_target_conflict", "Requested supporting slides would reopen a Combined Context chapter outside its explicitly assigned range.");
      claims.push(extension);
      buckets[index]!.push(extension);
    }
  } else {
    for (let index = 0; index < beats.length; index += 1) {
      const beat = beats[index]!;
      const claim = beat.claim;
      if (claim && !targetedClaims.has(claim.id)) buckets[index % count]!.push(claim);
    }
    plotClaims.filter((claim) => !targetedClaims.has(claim.id)).forEach((claim, index) => buckets[index % count]!.push(claim));
  }
  for (const group of groups) {
    const assigned = buckets.findIndex((bucket) => bucket.some((claim) => claim.contextGroupIds.includes(group.id)));
    if (assigned >= 0) continue;
    const groupClaim = claims.find((claim) => group.members.some((member) => member.blockId === claim.blockId));
    if (groupClaim) buckets[Math.min(count - 1, groups.indexOf(group))]!.push(groupClaim);
  }
  const unassignedMandatory = claims.filter((claim) => claim.required && !claim.continuity && !claim.negative && !buckets.some((bucket) => bucket.some((item) => item.id === claim.id)));
  unassignedMandatory.forEach((claim, index) => {
    if (!assignTargetedClaim(claim, index, unassignedMandatory)) buckets[index % count]!.push(claim);
  });
  if (format === "slides" && !authoredSlides.length) {
    const authorizedBlockIds = new Set((Array.isArray(snapshot.facts) ? snapshot.facts : [])
      .filter(promptFactIsActive)
      .map(asRecord)
      .map((fact) => clean(fact.block_id))
      .filter(Boolean));
    const groundingClaims = claims.filter((claim) => !claim.negative && authorizedBlockIds.has(claim.blockId));
    let previous = groundingClaims[0];
    for (const [index, bucket] of buckets.entries()) {
      const assigned = bucket.find((claim) => authorizedBlockIds.has(claim.blockId));
      if (assigned) {
        previous = assigned;
        continue;
      }
      const source = [previous, ...groundingClaims].find((candidate) => candidate && candidate.contextGroupIds.every((groupId) => {
        const target = groupTargets.get(groupId);
        return !target || index >= target.start && index <= target.end;
      }));
      if (!source) {
        throw new ManagedPresentationPlanningError("presentation_context_target_unfillable", `Slide ${index + 1} has no authorized source decision that can be placed there without violating an isolated Combined Context target.`);
      }
      const extension: ProductionClaim = {
        ...source,
        id: `${source.id}:supporting-slide:${index + 1}`,
        text: `${source.text} · Develop a distinct source-grounded supporting perspective for presentation position ${index + 1}.`,
        required: false,
        continuity: false,
        ordinal: (source.ordinal ?? 0) + count + index,
        sourceKind: "authored-slide",
      };
      claims.push(extension);
      bucket.push(extension);
    }
  }

  const sceneIds = Array.from({ length: count }, (_, index) => `scene-${String(index + 1).padStart(3, "0")}`);
  const scenes = sceneIds.map((id, index): ProductionScene => {
    const authoredSlide = authoredSlides[index];
    const expandedSource = authoredSlides.length && index >= authoredSlides.length
      ? authoredSlides[expansionSourceIndexes[(index - authoredSlides.length) % expansionSourceIndexes.length]!]
      : undefined;
    const beat = authoredSlides.length ? undefined : beats[index];
    const facts = unique(buckets[index]!.map((claim) => claim.id)).map((claimId) => claims.find((claim) => claim.id === claimId)!).filter(Boolean);
    const properties = beat?.properties ?? {};
    const action = authoredSlide
      ? clean(authoredSlide.content) || clean(authoredSlide.title)
      : expandedSource
        ? `Develop a distinct supporting analysis of the authored slide “${clean(expandedSource.title)}”: ${clean(expandedSource.content)} Preserve its exact source facts, verbatim quotations, attributed evidence, and terminology without repeating another slide.`
        : clean(properties.storyboard_shot_direction ?? properties.video_scene_direction ?? properties.text ?? facts.map((claim) => claim.text).join("; ")) || `Advance ${purposeFor(index, count)} without repeating another scene.`;
    const title = authoredSlide
      ? clean(authoredSlide.title) || `Slide ${authoredSlide.number}`
      : expandedSource
        ? `${clean(expandedSource.title) || `Slide ${expandedSource.number}`} · supporting evidence ${index - authoredSlides.length + 1}`
        : clean(properties.storyboard_shot_title ?? properties.video_scene_title ?? properties.label) || `${purposeFor(index, count).replaceAll("-", " ")} · ${index + 1}`;
    const contextGroupIds = unique(facts.flatMap((claim) => claim.contextGroupIds));
    const scene: ProductionScene = {
      id,
      narrativeOrder: index + 1,
      title,
      action,
      cameraDirection: clean(properties.storyboard_camera_direction ?? properties.video_scene_camera_direction) || continuityBible(claims).camera[0] || "Motivated camera movement; preserve established screen direction.",
      imagePrompt: clean(properties.storyboard_frame_prompt ?? properties.video_scene_frame_prompt) || action,
      narrativePurpose: purposeFor(index, count),
      durationSeconds: sceneDuration(action, options.preferredSceneSeconds),
      sourceClaimIds: facts.map((claim) => claim.id),
      sourceBlockIds: unique(facts.map((claim) => claim.blockId)),
      ...(facts.some((claim) => claim.artifactItemId) ? { sourceArtifactItemIds: unique(facts.flatMap((claim) => claim.artifactItemId ? [claim.artifactItemId] : [])) } : {}),
      contextGroupIds,
      ...((authoredSlide ?? expandedSource)?.section ? { section: clean((authoredSlide ?? expandedSource)!.section) } : {}),
      ...(authoredSlide ? { sourceOutlineOrder: authoredSlide.number } : expandedSource ? { sourceOutlineOrder: index + 1 } : {}),
      referenceIds: [],
      dependsOn: [],
      startBoundaryId: index > 0 ? `boundary-${String(index).padStart(3, "0")}` : null,
      endBoundaryId: index < count - 1 ? `boundary-${String(index + 1).padStart(3, "0")}` : null,
      transitionIn: index === 0 ? "open-on-action" : "match composition, camera axis, screen direction, and preceding action",
      transitionOut: index === count - 1 ? "resolve on a held closing image" : "carry matching action, eyeline, palette, and screen direction into the next shot",
      anchorScore: 0,
      continuityStrategy: "generated-anchor",
    };
    scene.referenceIds = boundReferences(scene, references);
    scene.continuityStrategy = scene.referenceIds.length ? "existing-references" : "generated-anchor";
    scene.anchorScore = anchorRank(scene, count);
    return scene;
  });

  const anchor = [...scenes].sort((left, right) => right.anchorScore - left.anchorScore || left.narrativeOrder - right.narrativeOrder)[0]!;
  for (const scene of scenes) {
    if (scene.id === anchor.id || scene.referenceIds.length) continue;
    const direction = scene.narrativeOrder < anchor.narrativeOrder ? 1 : -1;
    const neighbor = scenes[scene.narrativeOrder - 1 + direction];
    if (neighbor) scene.dependsOn = [neighbor.id];
    scene.continuityStrategy = "chained-boundary";
  }

  const parallelWaves = buildWaves(scenes, anchor.id, options.maximumParallelScenes ?? 3);
  const totalDurationSeconds = scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
  const videoRate = VIDEO_ADAPTER_CONTRACT.publishedCostPerSecondMicrousd[options.resolution ?? VIDEO_ADAPTER_CONTRACT.defaultResolution];
  const estimatedVideoCostMicrousd = format === "video" ? totalDurationSeconds * videoRate : 0;
  const estimatedReferenceCostMicrousd = format === "video" && scenes.some((scene) => !scene.referenceIds.length) ? 500_000 : 0;
  const providerBatchCount = Math.ceil(count / MANAGED_PRODUCTION_BATCH_SIZE);
  const providerBatches = Array.from({ length: providerBatchCount }, (_, index) => {
    const startSlide = index * MANAGED_PRODUCTION_BATCH_SIZE + 1;
    const endSlide = Math.min(count, startSlide + MANAGED_PRODUCTION_BATCH_SIZE - 1);
    return {
      index,
      startSlide,
      endSlide,
      slideCount: endSlide - startSlide + 1,
      reservationMicrousd: MANAGED_PRODUCTION_BATCH_RESERVATION_MICROUSD,
    };
  });
  const authoredSlideCount = format === "slides" ? authoredSlides.length : 0;
  const slideCountMismatch = authoredSlideCount > 0 && requestedSlideCount !== null && requestedSlideCount !== authoredSlideCount;
  const estimatedPlanningCostMicrousd = providerBatchCount * MANAGED_PRODUCTION_BATCH_RESERVATION_MICROUSD;
  return {
    schemaVersion: 1,
    mode: "managed",
    format,
    team: productionTeamFor(format),
    claims,
    contextGroups: groups,
    continuityBible: continuityBible(claims),
    scenes,
    authoredSlideCount,
    requestedSlideCount,
    predictedSlideCount: count,
    slideCountMismatch,
    slideCountMismatchCode: slideCountMismatch
      ? requestedSlideCount! < authoredSlideCount ? "requested_less_than_authored" : "requested_more_than_authored"
      : null,
    slideCountMismatchReason: slideCountMismatch
      ? requestedSlideCount! < authoredSlideCount ? "requested_less_than_authored" : "requested_more_than_authored"
      : null,
    slideCountMismatchMessage: slideCountMismatch
      ? requestedSlideCount! < authoredSlideCount
        ? `The source contains ${authoredSlideCount} authored slides, so the requested ${requestedSlideCount} slides would omit required material; all ${authoredSlideCount} authored slides will be preserved.`
        : `The source contains ${authoredSlideCount} authored slides; the requested ${requestedSlideCount} slides expand that outline with additional source-grounded supporting material.`
      : null,
    providerBatchSize: MANAGED_PRODUCTION_BATCH_SIZE,
    providerBatchCount,
    providerCallCount: providerBatchCount,
    maxRepairCallCount: providerBatchCount * 3,
    // Each page and its bounded whole-production retry can each require one provider-side schema repair.
    maximumProviderCallCount: providerBatchCount * 4,
    providerBatches,
    narrativeOrder: scenes.map((scene) => scene.id),
    executionOrder: parallelWaves.flat(),
    parallelWaves,
    anchorSceneId: anchor.id,
    anchorRationale: `Start with scene ${anchor.narrativeOrder}: ${anchor.title}. Its dramatic importance, approved references, recurring context, and continuity centrality establish the strongest reusable visual anchor.`,
    totalDurationSeconds,
    estimatedVideoCostMicrousd,
    estimatedReferenceCostMicrousd,
    estimatedPlanningCostMicrousd,
    estimatedTotalCostMicrousd: estimatedVideoCostMicrousd + estimatedReferenceCostMicrousd + estimatedPlanningCostMicrousd,
    providerCapabilities: { maximumSceneSeconds: 15, maximumReferencesPerScene: 9, nativeBoundaryFrames: false, videoFrameExtraction: false, finalVideoComposition: false, assembly: "ordered-scene-reel" },
  };
}

/** Keep global hard decisions while isolating a shot to its own plot beat and target groups. */
export function productionSceneSnapshot(snapshot: Record<string, unknown>, scene: ProductionScene): Record<string, unknown> {
  const ids = new Set(scene.sourceBlockIds);
  const groups = new Set(scene.contextGroupIds);
  const authoritativeGroups = new Map<string, string[]>();
  for (const group of combinedContextGroups(snapshot)) for (const member of group.members) {
    authoritativeGroups.set(member.blockId, [...(authoritativeGroups.get(member.blockId) ?? []), group.id]);
  }
  const requiredIds = new Set(requiredContextAdaptationFacts(snapshot).map((fact) => fact.blockId));
  const facts = (Array.isArray(snapshot.facts) ? snapshot.facts : []).map(asRecord).filter(promptFactIsActive).filter((fact) => {
    const properties = asRecord(fact.properties);
    const blockId = clean(fact.block_id);
    const memberships = unique([...combinedContextMemberships(properties).map((membership) => membership.contextSetId), ...(authoritativeGroups.get(blockId) ?? [])]);
    const structuredItems = Array.isArray(asRecord(properties.artifact_structure).items) ? asRecord(properties.artifact_structure).items as unknown[] : [];
    if (structuredItems.length && scene.sourceArtifactItemIds?.length && !structuredItems.some((item) => scene.sourceArtifactItemIds!.includes(clean(asRecord(item).source_artifact_item_id ?? asRecord(item).id)))) return false;
    if (memberships.length && !memberships.some((membership) => groups.has(membership))) return false;
    const type = clean(fact.type || fact.role);
    if (ids.has(blockId)) return true;
    const narrativeBeat = type === "message" && /^narrative[\s_-]+beat$/i.test(clean(properties.subtype));
    if (narrativeBeat || Number(properties.storyboard_frame_index ?? properties.storyboard_sequence ?? properties.video_scene_index ?? properties.narrative_order ?? 0) > 0) return false;
    if (requiredIds.has(blockId)) return true;
    const negative = isNegativeProductionFact(fact);
    const globalIntent = type === "audience" || type === "emotion" || type === "message";
    return negative || continuityTypes.has(type) || type === "direction" || type === "accessibility" || !memberships.length && globalIntent;
  }).map((fact) => {
    const properties = asRecord(fact.properties);
    const structure = asRecord(properties.artifact_structure);
    if (!scene.sourceArtifactItemIds?.length || !Array.isArray(structure.items)) return fact;
    const allowed = new Set(scene.sourceArtifactItemIds);
    const items = structure.items.map(asRecord).filter((item) => allowed.has(clean(item.source_artifact_item_id ?? item.id)));
    if (!items.length) return fact;
    const scopedText = items.map((item) => unique([item.title, item.body, item.notes, item.image_prompt].map(clean)).join(" · ")).join("\n");
    return { ...fact, properties: { ...properties, text: scopedText, artifact_markdown: scopedText, artifact_structure: { ...structure, items } } };
  });
  const retainedIds = new Set(facts.map((fact) => clean(fact.block_id)));
  const relationships = (Array.isArray(snapshot.relationships) ? snapshot.relationships : []).map(asRecord).filter((relation) => retainedIds.has(clean(relation.from_block_id)) && retainedIds.has(clean(relation.to_block_id)));
  return {
    ...snapshot,
    facts,
    relationships,
    context_groups: combinedContextGroups({ facts, relationships }),
    production_scene: {
      id: scene.id,
      narrative_order: scene.narrativeOrder,
      narrative_purpose: scene.narrativePurpose,
      start_boundary_guidance: scene.startBoundaryId,
      end_boundary_guidance: scene.endBoundaryId,
      transition_in: scene.transitionIn,
      transition_out: scene.transitionOut,
    },
  };
}

export type ProductionQualityScore = {
  basis: "deterministic-plan-contract";
  contextAdherence: number;
  contextCoverage: number;
  continuity: number;
  nonDuplication: number;
  transitionQuality: number;
  score: number;
  weightedDefect: number;
  requiredClaimCoverage: number;
  representedNarrativeClaims: number;
  totalNarrativeClaims: number;
};

export function scoreManagedProductionPlan(plan: ManagedProductionPlan): ProductionQualityScore {
  const narrative = plan.claims.filter((claim) => !claim.continuity && !claim.negative);
  const assigned = plan.scenes.flatMap((scene) => scene.sourceClaimIds);
  const represented = new Set(assigned);
  const required = plan.claims.filter((claim) => claim.required && !claim.continuity && !claim.negative);
  const requiredClaimCoverage = required.length ? required.filter((claim) => represented.has(claim.id)).length / required.length : 1;
  const contextCoverage = narrative.length ? narrative.filter((claim) => represented.has(claim.id)).length / narrative.length : 1;
  const duplicateCount = assigned.length - new Set(assigned).size;
  const nonDuplication = assigned.length ? Math.max(0, 1 - duplicateCount / assigned.length) : 1;
  const continuity = plan.scenes.length < 2 ? 1 : plan.scenes.filter((scene) => scene.id === plan.anchorSceneId || scene.referenceIds.length || scene.dependsOn.length).length / plan.scenes.length;
  const boundaries = Math.max(0, plan.scenes.length - 1);
  const matchedBoundaries = plan.scenes.slice(0, -1).filter((scene, index) => scene.endBoundaryId && scene.endBoundaryId === plan.scenes[index + 1]?.startBoundaryId).length;
  // Guided stills and editing instructions are not native frame locks or actual media review.
  const transitionQuality = boundaries ? (matchedBoundaries / boundaries) * .96 : 1;
  const validDurations = plan.format !== "video" || plan.scenes.every((scene) => scene.durationSeconds >= 4 && scene.durationSeconds <= 15);
  const validReferences = plan.scenes.every((scene) => scene.referenceIds.length <= VIDEO_ADAPTER_CONTRACT.maxReferenceImages);
  const contextAdherence = validDurations && validReferences ? requiredClaimCoverage : 0;
  const score = .25 * contextAdherence + .30 * contextCoverage + .20 * continuity + .15 * nonDuplication + .10 * transitionQuality;
  return {
    basis: "deterministic-plan-contract",
    contextAdherence,
    contextCoverage,
    continuity,
    nonDuplication,
    transitionQuality,
    score,
    weightedDefect: Math.max(0, 1 - score),
    requiredClaimCoverage,
    representedNarrativeClaims: narrative.filter((claim) => represented.has(claim.id)).length,
    totalNarrativeClaims: narrative.length,
  };
}

export function scoreManualVideoBaseline(plan: ManagedProductionPlan, seconds: VideoDurationSeconds = VIDEO_ADAPTER_CONTRACT.defaultDuration): ProductionQualityScore {
  const narrative = plan.claims.filter((claim) => !claim.continuity && !claim.negative);
  const beats = Math.max(1, plan.scenes.length, narrative.length);
  const legibleCoverage = Math.min(1, seconds / (beats * 6));
  const hasReferences = plan.scenes.some((scene) => scene.referenceIds.length);
  const continuity = plan.scenes.length > 1 ? hasReferences ? .55 : .35 : 1;
  const transitionQuality = plan.scenes.length > 1 ? Math.min(.65, seconds / (beats * 4)) : 1;
  const nonDuplication = plan.scenes.length > 1 ? .72 : 1;
  const contextAdherence = Math.max(.2, Math.min(1, legibleCoverage + .22));
  const score = .25 * contextAdherence + .30 * legibleCoverage + .20 * continuity + .15 * nonDuplication + .10 * transitionQuality;
  return {
    basis: "deterministic-plan-contract",
    contextAdherence,
    contextCoverage: legibleCoverage,
    continuity,
    nonDuplication,
    transitionQuality,
    score,
    weightedDefect: Math.max(0, 1 - score),
    requiredClaimCoverage: Math.min(1, legibleCoverage + .22),
    representedNarrativeClaims: Math.min(narrative.length, Math.floor(seconds / 6)),
    totalNarrativeClaims: narrative.length,
  };
}

export const productionDefectReduction = (baseline: ProductionQualityScore, managed: ProductionQualityScore) =>
  baseline.weightedDefect / Math.max(.000_001, managed.weightedDefect);

export function productionTeamInstructions(plan: Pick<ManagedProductionPlan, "team" | "continuityBible" | "scenes"> & Partial<Pick<ManagedProductionPlan, "claims">>, scenes = plan.scenes) {
  const roles = plan.team.specialists.map((member) => `${member.label}: ${member.responsibility} Deliver ${member.deliverable}.`).join(" ");
  const legacySafeBible = Object.fromEntries(Object.entries(plan.continuityBible).filter(([key]) => key !== "requiredBlockIds"));
  const sharedClaims = plan.claims?.filter((claim) => !claim.contextGroupIds.length) ?? [];
  const shared = plan.claims
    ? providerFacingProductionContinuity({ claims: sharedClaims })
    : legacySafeBible;
  const bible = JSON.stringify(scenes.length === 1 && plan.claims ? providerFacingProductionContinuity({ claims: plan.claims }, scenes[0]) : shared);
  const assignments = scenes.map((scene) => {
    const scoped = plan.claims ? ` Scoped target continuity: ${JSON.stringify(providerFacingProductionContinuity({ claims: plan.claims }, scene))}.` : "";
    return `${scene.narrativeOrder}. ${scene.title}: ${scene.action}. Camera: ${scene.cameraDirection}.${scoped} Introduce only the assigned new information; ${scene.transitionIn}; ${scene.transitionOut}.`;
  }).join(" ");
  return `Act as a coordinated ${plan.team.label}, not as an unaudited set of autonomous agents. ${roles} Preserve this shared production continuity bible: ${bible}. Create distinct source-grounded work units without repeating plot claims: ${assignments}`;
}

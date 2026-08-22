import { combinedContextGroups, combinedContextMemberships } from "./combined-context.ts";
import { requiredContextAdaptationFacts } from "./context-adaptation.ts";
import type { DocumentArtifactKind } from "./document-artifacts.ts";
import { promptFactIsActive } from "./prompt-policy.ts";
import { VIDEO_ADAPTER_CONTRACT, type VideoDurationSeconds } from "./video-adapter.ts";

export type ProductionMode = "manual" | "managed";
export type ProductionFormat = DocumentArtifactKind | "image";

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
  contextGroupIds: string[];
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
  continuityBible: ProductionContinuityBible;
  scenes: ProductionScene[];
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
  resolution?: "480p" | "720p";
  maximumParallelScenes?: number;
};

const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const clean = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
const unique = (values: Iterable<string>) => [...new Set([...values].map(clean).filter(Boolean))];
const continuityTypes = new Set(["subject", "environment", "location", "wardrobe", "object", "prop", "palette", "lighting", "camera", "style", "material", "brand", "typography", "format"]);
const negativeIntents = new Set(["avoid", "prohibit", "exclude"]);

function factText(fact: Record<string, unknown>) {
  const properties = asRecord(fact.properties);
  return unique([properties.text, properties.instruction, properties.description, properties.label, properties.value, properties.storyboard_shot_direction, properties.exact_text, Array.isArray(properties.colors) ? properties.colors.join(", ") : "", fact.handle].map(clean)).join(" · ");
}

export function productionClaims(snapshot: Record<string, unknown>): ProductionClaim[] {
  const mandatory = new Set(requiredContextAdaptationFacts(snapshot).map((fact) => fact.blockId));
  const facts = (Array.isArray(snapshot.facts) ? snapshot.facts : []).filter(promptFactIsActive).map(asRecord);
  return facts.flatMap((fact, index) => {
    const properties = asRecord(fact.properties);
    const text = factText(fact);
    if (!text) return [];
    const blockId = clean(fact.block_id) || `source-${index + 1}`;
    const type = clean(fact.type || fact.role || "direction");
    const rawSequence = Number(properties.storyboard_frame_index ?? properties.storyboard_sequence);
    const storyboardSequence = Number.isSafeInteger(rawSequence) && rawSequence > 0 ? rawSequence : null;
    const negative = negativeIntents.has(clean(fact.intent || properties.intent).toLowerCase()) || clean(fact.effect).toLowerCase() === "exclude";
    return [{
      id: `claim:${blockId}`,
      blockId,
      type,
      text,
      required: mandatory.has(blockId),
      continuity: continuityTypes.has(type) && storyboardSequence === null,
      negative,
      contextGroupIds: unique(combinedContextMemberships(properties).map((membership) => membership.contextSetId)),
      storyboardSequence,
    } satisfies ProductionClaim];
  });
}

function continuityBible(claims: ProductionClaim[]): ProductionContinuityBible {
  const select = (...types: string[]) => unique(claims.filter((claim) => !claim.negative && types.includes(claim.type)).map((claim) => claim.text));
  return {
    subjects: select("subject", "character"),
    locations: select("environment", "location"),
    wardrobe: select("wardrobe"),
    props: select("object", "prop"),
    palette: select("palette"),
    lighting: select("lighting"),
    camera: select("camera"),
    style: select("style", "material", "brand"),
    prohibitions: unique(claims.filter((claim) => claim.negative).map((claim) => claim.text)),
    requiredBlockIds: unique(claims.filter((claim) => claim.required).map((claim) => claim.blockId)),
  };
}

const purposeFor = (index: number, count: number): ProductionScene["narrativePurpose"] =>
  index === 0 ? "opening" : index === count - 1 ? "resolution" : index === Math.max(1, Math.round((count - 1) * .7)) ? "climax" : index === Math.floor((count - 1) / 2) ? "turning-point" : "development";

const sceneDuration = (text: string, preferredSeconds?: number): VideoDurationSeconds => {
  const words = clean(text).split(" ").filter(Boolean).length;
  const requested = Number.isFinite(preferredSeconds) ? Number(preferredSeconds) : Math.ceil(words / 2.5) + 5;
  return Math.max(4, Math.min(15, Math.max(6, Math.round(requested)))) as VideoDurationSeconds;
};

function storyboardFacts(snapshot: Record<string, unknown>) {
  return (Array.isArray(snapshot.facts) ? snapshot.facts : []).filter(promptFactIsActive).map(asRecord).flatMap((fact) => {
    const properties = asRecord(fact.properties);
    const sequence = Number(properties.storyboard_frame_index ?? properties.storyboard_sequence);
    if (!Number.isSafeInteger(sequence) || sequence < 1) return [];
    return [{ fact, properties, sequence, groupId: clean(properties.source_artifact_id ?? properties.reference_set_id ?? properties.context_set_id ?? properties.storyboard_title) }];
  }).sort((left, right) => left.groupId.localeCompare(right.groupId) || left.sequence - right.sequence);
}

function boundReferences(scene: ProductionScene, references: ProductionReference[]) {
  const source = new Set(scene.sourceBlockIds);
  const groups = new Set(scene.contextGroupIds);
  return [...references]
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
  const completed = new Set<string>();
  const pending = new Map(scenes.map((scene) => [scene.id, scene]));
  const waves: string[][] = [];
  while (pending.size) {
    let ready = [...pending.values()].filter((scene) => scene.dependsOn.every((dependency) => completed.has(dependency)));
    if (!waves.length) ready = ready.filter((scene) => scene.id === anchorId);
    if (!ready.length) throw new Error("production_scene_dependency_cycle");
    ready.sort((left, right) => right.anchorScore - left.anchorScore || left.narrativeOrder - right.narrativeOrder);
    const wave = ready.slice(0, Math.max(1, maximumParallelScenes)).map((scene) => scene.id);
    waves.push(wave);
    for (const sceneId of wave) { completed.add(sceneId); pending.delete(sceneId); }
  }
  return waves;
}

/** Compile the full source context without inheriting the legacy twelve-item schema cap. */
export function buildManagedProductionPlan(format: ProductionFormat, snapshot: Record<string, unknown>, options: ProductionPlanOptions = {}): ManagedProductionPlan {
  const claims = productionClaims(snapshot);
  const references = options.references ?? [];
  const groups = combinedContextGroups(snapshot);
  const beats = storyboardFacts(snapshot);
  const plotClaims = claims.filter((claim) => !claim.continuity && !claim.negative && claim.storyboardSequence === null);
  const groupedClaims = new Map(claims.map((claim) => [claim.blockId, claim]));
  const baselineCount = beats.length || Math.max(1, Math.ceil(plotClaims.length / 2), groups.filter((group) => group.role === "sequence" || group.role === "scene" || group.role === "message").length);
  const count = format === "image" ? 1 : Math.max(baselineCount, Math.max(0, Math.floor(Number(options.requestedItemCount) || 0)));
  const buckets: ProductionClaim[][] = Array.from({ length: count }, () => []);

  for (let index = 0; index < beats.length; index += 1) {
    const beat = beats[index]!;
    const claim = groupedClaims.get(clean(beat.fact.block_id));
    if (claim) buckets[index % count]!.push(claim);
  }
  plotClaims.forEach((claim, index) => buckets[index % count]!.push(claim));
  const groupedBlockIds = new Set(groups.flatMap((group) => group.members.map((member) => member.blockId)));
  for (const group of groups) {
    const assigned = buckets.findIndex((bucket) => bucket.some((claim) => claim.contextGroupIds.includes(group.id)));
    if (assigned >= 0) continue;
    const groupClaim = claims.find((claim) => group.members.some((member) => member.blockId === claim.blockId));
    if (groupClaim) buckets[Math.min(count - 1, groups.indexOf(group))]!.push(groupClaim);
  }
  const unassignedMandatory = claims.filter((claim) => claim.required && !claim.continuity && !claim.negative && !buckets.some((bucket) => bucket.some((item) => item.id === claim.id)));
  unassignedMandatory.forEach((claim, index) => buckets[index % count]!.push(claim));

  const sceneIds = Array.from({ length: count }, (_, index) => `scene-${String(index + 1).padStart(3, "0")}`);
  const scenes = sceneIds.map((id, index): ProductionScene => {
    const beat = beats[index];
    const facts = unique(buckets[index]!.map((claim) => claim.id)).map((claimId) => claims.find((claim) => claim.id === claimId)!).filter(Boolean);
    const properties = beat?.properties ?? {};
    const action = clean(properties.storyboard_shot_direction ?? properties.text ?? facts.map((claim) => claim.text).join("; ")) || `Advance ${purposeFor(index, count)} without repeating another scene.`;
    const title = clean(properties.storyboard_shot_title ?? properties.label) || `${purposeFor(index, count).replaceAll("-", " ")} · ${index + 1}`;
    const contextGroupIds = unique(facts.flatMap((claim) => claim.contextGroupIds));
    const scene: ProductionScene = {
      id,
      narrativeOrder: index + 1,
      title,
      action,
      cameraDirection: clean(properties.storyboard_camera_direction) || continuityBible(claims).camera[0] || "Motivated camera movement; preserve established screen direction.",
      imagePrompt: clean(properties.storyboard_frame_prompt) || action,
      narrativePurpose: purposeFor(index, count),
      durationSeconds: sceneDuration(action, options.preferredSceneSeconds),
      sourceClaimIds: facts.map((claim) => claim.id),
      sourceBlockIds: unique(facts.map((claim) => claim.blockId)),
      contextGroupIds,
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

  // Groups define scoped authorial units; never promote their decisions to a global rule.
  for (const scene of scenes) {
    for (const blockId of scene.sourceBlockIds) {
      if (!groupedBlockIds.has(blockId)) continue;
      const claim = groupedClaims.get(blockId);
      if (claim) scene.contextGroupIds = unique([...scene.contextGroupIds, ...claim.contextGroupIds]);
    }
  }

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
  const estimatedReferenceCostMicrousd = (format === "video" || format === "storyboard") && scenes.some((scene) => !scene.referenceIds.length) ? 500_000 : 0;
  const estimatedPlanningCostMicrousd = Math.ceil(count / 8) * 1_000_000;
  return {
    schemaVersion: 1,
    mode: "managed",
    format,
    team: productionTeamFor(format),
    claims,
    continuityBible: continuityBible(claims),
    scenes,
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
  const requiredIds = new Set(requiredContextAdaptationFacts(snapshot).map((fact) => fact.blockId));
  const facts = (Array.isArray(snapshot.facts) ? snapshot.facts : []).map(asRecord).filter(promptFactIsActive).filter((fact) => {
    const properties = asRecord(fact.properties);
    const blockId = clean(fact.block_id);
    const memberships = combinedContextMemberships(properties);
    if (memberships.length && !memberships.some((membership) => groups.has(membership.contextSetId))) return false;
    if (ids.has(blockId) || requiredIds.has(blockId)) return true;
    if (Number(properties.storyboard_frame_index ?? properties.storyboard_sequence ?? 0) > 0) return false;
    const type = clean(fact.type || fact.role);
    const negative = negativeIntents.has(clean(fact.intent || properties.intent).toLowerCase()) || clean(fact.effect).toLowerCase() === "exclude";
    return negative || continuityTypes.has(type) || type === "direction" || type === "accessibility";
  });
  const retainedIds = new Set(facts.map((fact) => clean(fact.block_id)));
  const relationships = (Array.isArray(snapshot.relationships) ? snapshot.relationships : []).map(asRecord).filter((relation) => retainedIds.has(clean(relation.from_block_id)) && retainedIds.has(clean(relation.to_block_id)));
  return {
    ...snapshot,
    facts,
    relationships,
    context_groups: combinedContextGroups({ facts }),
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

export function productionTeamInstructions(plan: Pick<ManagedProductionPlan, "team" | "continuityBible" | "scenes">, scenes = plan.scenes) {
  const roles = plan.team.specialists.map((member) => `${member.label}: ${member.responsibility} Deliver ${member.deliverable}.`).join(" ");
  const bible = JSON.stringify(plan.continuityBible);
  const assignments = scenes.map((scene) => `${scene.narrativeOrder}. ${scene.title}: ${scene.action}. Camera: ${scene.cameraDirection}. Introduce only the assigned new information; ${scene.transitionIn}; ${scene.transitionOut}.`).join(" ");
  return `Act as a coordinated ${plan.team.label}, not as an unaudited set of autonomous agents. ${roles} Preserve this shared production continuity bible: ${bible}. Create distinct source-grounded work units without repeating plot claims: ${assignments}`;
}

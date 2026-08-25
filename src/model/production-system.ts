import { productionTeamFor, type ManagedProductionPlan, type ProductionFormat } from "./managed-production.ts";
import { VIDEO_ADAPTER_CONTRACT } from "./video-adapter.ts";
import { AUDIO_ADAPTER_CONTRACT } from "./audio.ts";

export type ProductionUnitKind = "plan" | "look-development" | "write" | "render-image" | "render-video" | "render-audio" | "review" | "assemble";

export type ProductionUnit = {
  id: string;
  kind: ProductionUnitKind;
  format: ProductionFormat;
  dependsOn: string[];
  narrativeOrder: number | null;
  sourceClaimIds: string[];
  contextGroupIds: string[];
  referenceIds: string[];
  estimatedCostMicrousd: number;
  sceneId?: string;
};

export type ProductionSystemCapabilities = {
  unitKinds: readonly ProductionUnitKind[];
  maxParallelUnits: number;
  maxUnitDurationSeconds: number | null;
  maxReferencesPerUnit: number | null;
  reusableGeneratedReferences: boolean;
  nativeBoundaryFrames: boolean;
  videoFrameExtraction: boolean;
  finalVideoComposition: boolean;
  delivery: "single-artifact" | "ordered-item-collection" | "ordered-scene-reel";
};

export type ProductionSystemContract = {
  adapterId: string;
  adapterVersion: string;
  format: ProductionFormat;
  teamId: string;
  capabilities: ProductionSystemCapabilities;
};

const capabilities = (format: ProductionFormat): ProductionSystemCapabilities => ({
  unitKinds: format === "video" ? ["plan", "look-development", "write", "render-video", "review", "assemble"]
    : format === "audio" ? ["plan", "write", "render-audio", "review", "assemble"]
    : format === "storyboard" ? ["plan", "write", "render-image", "review", "assemble"]
    : format === "image" ? ["plan", "render-image", "review"]
    : ["plan", "write", "review", "assemble"],
  maxParallelUnits: format === "video" ? VIDEO_ADAPTER_CONTRACT.referenceUploadConcurrency : format === "storyboard" ? 3 : 1,
  maxUnitDurationSeconds: format === "video" ? Math.max(...VIDEO_ADAPTER_CONTRACT.supportedDurations) : null,
  maxReferencesPerUnit: format === "video" ? VIDEO_ADAPTER_CONTRACT.maxReferenceImages : null,
  reusableGeneratedReferences: format === "video" || format === "storyboard",
  nativeBoundaryFrames: false,
  videoFrameExtraction: false,
  finalVideoComposition: false,
  delivery: format === "video" ? "ordered-scene-reel" : format === "image" || format === "audio" || format === "short_story" || format === "scene" ? "single-artifact" : "ordered-item-collection",
});

const contractFor = (format: ProductionFormat): ProductionSystemContract => ({
  adapterId: `${format.replaceAll("_", "-")}-managed-production-system`,
  adapterVersion: "1.0.0",
  format,
  teamId: productionTeamFor(format).id,
  capabilities: capabilities(format),
});

export const PRODUCTION_SYSTEMS: Readonly<Record<ProductionFormat, ProductionSystemContract>> = {
  audio: contractFor("audio"),
  video: contractFor("video"),
  storyboard: contractFor("storyboard"),
  slides: contractFor("slides"),
  short_story: contractFor("short_story"),
  scene: contractFor("scene"),
  image: contractFor("image"),
};

export const productionSystemFor = (format: ProductionFormat) => PRODUCTION_SYSTEMS[format];

/** Provider-neutral, auditable work graph; delivery never advertises unsupported composition or frame locking. */
export function productionUnitsForPlan(plan: ManagedProductionPlan): ProductionUnit[] {
  const units: ProductionUnit[] = [{
    id: "production-plan",
    kind: "plan",
    format: plan.format,
    dependsOn: [],
    narrativeOrder: null,
    sourceClaimIds: [],
    contextGroupIds: [],
    referenceIds: [],
    estimatedCostMicrousd: plan.estimatedPlanningCostMicrousd,
  }];

  const requiresAnchor = plan.format === "video" && plan.estimatedReferenceCostMicrousd > 0;
  const requiresScript = plan.format === "video" || plan.format === "storyboard" || plan.format === "audio";
  if (requiresScript) units.push({
    id: "production-script",
    kind: "write",
    format: plan.format,
    dependsOn: ["production-plan"],
    narrativeOrder: null,
    sourceClaimIds: plan.scenes.flatMap((scene) => scene.sourceClaimIds),
    contextGroupIds: [...new Set(plan.scenes.flatMap((scene) => scene.contextGroupIds))],
    referenceIds: [],
    estimatedCostMicrousd: 0,
  });
  if (requiresAnchor) {
    const anchor = plan.scenes.find((scene) => scene.id === plan.anchorSceneId)!;
    units.push({
      id: "production-look-anchor",
      kind: "look-development",
      format: plan.format,
      dependsOn: [requiresScript ? "production-script" : "production-plan"],
      narrativeOrder: anchor.narrativeOrder,
      sourceClaimIds: [...anchor.sourceClaimIds],
      contextGroupIds: [...anchor.contextGroupIds],
      referenceIds: [...anchor.referenceIds],
      estimatedCostMicrousd: plan.estimatedReferenceCostMicrousd,
      sceneId: anchor.id,
    });
  }

  const rate = plan.totalDurationSeconds ? plan.estimatedVideoCostMicrousd / plan.totalDurationSeconds : 0;
  if(plan.format==="audio")units.push({
    id:"production-audio-track",
    kind:"render-audio",
    format:plan.format,
    dependsOn:["production-script"],
    narrativeOrder:null,
    sourceClaimIds:[...new Set(plan.scenes.flatMap((scene)=>scene.sourceClaimIds))],
    contextGroupIds:[...new Set(plan.scenes.flatMap((scene)=>scene.contextGroupIds))],
    referenceIds:[...new Set(plan.scenes.flatMap((scene)=>scene.referenceIds))],
    estimatedCostMicrousd:AUDIO_ADAPTER_CONTRACT.publishedCostMicrousd,
  });
  for (const sceneId of plan.format==="audio"?[]:plan.executionOrder) {
    const scene = plan.scenes.find((item) => item.id === sceneId)!;
    const kind: ProductionUnitKind = plan.format === "video" ? "render-video"
      : plan.format === "audio" ? "render-audio"
      : plan.format === "image" || plan.format === "storyboard" ? "render-image"
      : "write";
    const prerequisites = [
      requiresAnchor && !scene.referenceIds.length ? "production-look-anchor" : requiresScript ? "production-script" : "production-plan",
      ...scene.dependsOn.map((id) => `production-unit:${id}`),
    ];
    units.push({
      id: `production-unit:${scene.id}`,
      kind,
      format: plan.format,
      dependsOn: [...new Set(prerequisites)],
      narrativeOrder: scene.narrativeOrder,
      sourceClaimIds: [...scene.sourceClaimIds],
      contextGroupIds: [...scene.contextGroupIds],
      referenceIds: [...scene.referenceIds],
      estimatedCostMicrousd: plan.format === "video" ? Math.round(scene.durationSeconds * rate) : plan.format === "storyboard" ? 1_000_000 : 0,
      sceneId: scene.id,
    });
  }

  units.push({
    id: "production-review",
    kind: "review",
    format: plan.format,
    dependsOn: plan.format==="audio"?["production-audio-track"]:plan.scenes.map((scene) => `production-unit:${scene.id}`),
    narrativeOrder: null,
    sourceClaimIds: [],
    contextGroupIds: [],
    referenceIds: [],
    estimatedCostMicrousd: 0,
  });
  if (plan.format !== "image") units.push({
    id: "production-assembly",
    kind: "assemble",
    format: plan.format,
    dependsOn: ["production-review"],
    narrativeOrder: null,
    sourceClaimIds: [],
    contextGroupIds: [],
    referenceIds: [],
    estimatedCostMicrousd: 0,
  });
  validateProductionUnits(units);
  return units;
}

export function validateProductionUnits(units: readonly ProductionUnit[]) {
  const ids = new Set<string>();
  for (const unit of units) {
    if (ids.has(unit.id)) throw new Error("production_unit_duplicate");
    for (const dependency of unit.dependsOn) {
      if (!ids.has(dependency)) throw new Error("production_unit_dependency_invalid");
    }
    ids.add(unit.id);
  }
}

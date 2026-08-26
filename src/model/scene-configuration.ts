import type { ProductionFormat } from "./managed-production.ts";

export const SCENE_MEDIA = ["visual", "audio"] as const;

export type SceneMedium = typeof SCENE_MEDIA[number];

export type SceneConfiguration = {
  medium: SceneMedium;
  source: "manual" | "production-path";
  targetFormat: ProductionFormat | null;
  downstreamFormats: ProductionFormat[];
  alternateMedium: SceneMedium;
};

export function isSceneMedium(value: unknown): value is SceneMedium {
  return SCENE_MEDIA.includes(value as SceneMedium);
}

/** Preserve the chosen interpretation and the context needed to render its alternate later. */
export function createSceneConfiguration(
  medium: SceneMedium,
  overrides: Partial<Omit<SceneConfiguration, "medium" | "alternateMedium">> = {},
): SceneConfiguration {
  return {
    medium,
    source: overrides.source ?? "manual",
    targetFormat: overrides.targetFormat ?? null,
    downstreamFormats: [...new Set(overrides.downstreamFormats ?? [])],
    alternateMedium: medium === "audio" ? "visual" : "audio",
  };
}

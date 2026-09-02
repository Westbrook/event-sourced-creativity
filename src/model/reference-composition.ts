import { creativeContextRightsIssue } from "./context-health.ts";
import type { CreativeBlock, CreativeEvent } from "./events.ts";
import { promptFactIsActive } from "./prompt-policy.ts";
import { isImageReference } from "./reference-media.ts";
import { referencePixelMode, sendsReferencePixels } from "./block-types.ts";

export const REFERENCE_COMPOSITION_MAX_EDGE = 1536;
export const REFERENCE_COMPOSITION_MAX_LAYERS = 12;
export const REFERENCE_COMPOSITION_MAX_SOURCE_BYTES = 24 * 1024 * 1024;
export const REFERENCE_COMPOSITION_ASPECTS = ["1:1", "16:9", "9:16"] as const;
export type ReferenceCompositionAspect = typeof REFERENCE_COMPOSITION_ASPECTS[number];
export type ReferenceCompositionBackground = "transparent" | "#ffffff" | "#171717";

export type ReferenceCompositionSource = {
  id: string;
  blockId: string;
  label: string;
  mediaUrl: string;
  contentHash: string;
  kind: "image" | "model-view";
  requiresUnlock?: boolean;
};

export type ReferenceCompositionLayer = {
  id: string;
  sourceId: string;
  x: number;
  y: number;
  scale: number;
  opacity: number;
};

export type ReferenceCompositionRecipe = {
  version: 1;
  aspect: ReferenceCompositionAspect;
  width: number;
  height: number;
  background: ReferenceCompositionBackground;
  sources: ReferenceCompositionSource[];
  /** Paint order, from back to front. Coordinates are canvas percentages. */
  layers: ReferenceCompositionLayer[];
};

export type ReferenceCompositionIssue = "invalid" | "empty" | "source-unavailable" | "source-changed" | "source-locked";
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const hash = (value: unknown) => /^[a-f0-9]{64}$/iu.test(text(value)) ? text(value).toLowerCase() : "";
const token = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 256 && !/\p{Cc}/u.test(value);
const bounded = (value: unknown, minimum: number, maximum: number): value is number => typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
const background = (value: unknown): value is ReferenceCompositionBackground => value === "transparent" || value === "#ffffff" || value === "#171717";
const aspect = (value: unknown): value is ReferenceCompositionAspect => REFERENCE_COMPOSITION_ASPECTS.includes(value as ReferenceCompositionAspect);

/** Return only the existing private media route; remote and redirect-like paths never enter the board. */
export function referenceCompositionMediaUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/api/media/") || /[?#\s\\]/u.test(value)) return null;
  try {
    const key = decodeURIComponent(value.slice("/api/media/".length));
    if (!key || key.length > 2048 || /[\p{Cc}\\]/u.test(key) || key.split("/").some(part => part === ".." || part === ".")) return null;
    return `/api/media/${encodeURIComponent(key)}`;
  } catch { return null; }
}

export function normalizeReferenceCompositionSource(value: unknown): ReferenceCompositionSource | null {
  if (!record(value) || !token(value.id) || !token(value.blockId) || !["image", "model-view"].includes(text(value.kind))) return null;
  const mediaUrl = referenceCompositionMediaUrl(value.mediaUrl), contentHash = hash(value.contentHash);
  if (!mediaUrl || !contentHash) return null;
  return { id: value.id as string, blockId: value.blockId as string, label: text(value.label).slice(0, 160), mediaUrl, contentHash, kind: value.kind as ReferenceCompositionSource["kind"], ...(value.requiresUnlock === true ? { requiresUnlock: true } : {}) };
}

/** The caller supplies the current document's readable blocks and events; this grants no access. */
export function referenceCompositionSources(blocks: readonly CreativeBlock[], events: readonly CreativeEvent[], now = Date.now()): ReferenceCompositionSource[] {
  const rights = new Map<string, boolean>();
  const ingested = new Map<string, Record<string, unknown>>();
  for (const event of events) {
    if (event.type !== "ReferenceIngested" && event.type !== "RightsAsserted") continue;
    const id = text(event.payload.reference_id);
    if (!id) continue;
    rights.set(id, ["owned", "owned_or_licensed", "account-generated"].includes(text(event.payload.rights_class)));
    if (event.type === "ReferenceIngested") ingested.set(id, event.payload);
  }
  const result: ReferenceCompositionSource[] = [];
  for (const block of blocks) {
    if (!["reference", "model3d"].includes(block.type) || block.removed || !promptFactIsActive(block) || creativeContextRightsIssue(block.properties, now)) continue;
    const properties = block.properties, id = text(properties.reference_id), receipt = ingested.get(id);
    if (!id || !rights.get(id) || !receipt || !isImageReference(properties)) continue;
    const mediaUrl = referenceCompositionMediaUrl(properties.media_url);
    const receiptUrl = referenceCompositionMediaUrl(receipt.source_ref ?? receipt.media_url);
    const contentHash = hash(properties.source_content_hash ?? properties.content_hash ?? receipt.content_hash);
    if (!mediaUrl || receiptUrl !== mediaUrl || !contentHash || hash(receipt.content_hash) !== contentHash) continue;
    const source = normalizeReferenceCompositionSource({ id: `${block.id}:${block.type === "model3d" ? "view" : "image"}`, blockId: block.id, label: text(properties.label) || block.handle, mediaUrl, contentHash, kind: block.type === "model3d" ? "model-view" : "image", requiresUnlock: block.locked && sendsReferencePixels(referencePixelMode(properties.pixel_reference_mode)) });
    if (source) result.push(source);
  }
  return result;
}

export function referenceCompositionSize(value: ReferenceCompositionAspect): { width: number; height: number } {
  if (value === "16:9") return { width: REFERENCE_COMPOSITION_MAX_EDGE, height: 864 };
  if (value === "9:16") return { width: 864, height: REFERENCE_COMPOSITION_MAX_EDGE };
  return { width: REFERENCE_COMPOSITION_MAX_EDGE, height: REFERENCE_COMPOSITION_MAX_EDGE };
}

export function createReferenceComposition(value: ReferenceCompositionAspect = "16:9"): ReferenceCompositionRecipe {
  return { version: 1, aspect: value, ...referenceCompositionSize(value), background: "#ffffff", sources: [], layers: [] };
}

/** Strict persisted-recipe validation, including bounds and an exact retained source set. */
export function normalizeReferenceComposition(value: unknown): ReferenceCompositionRecipe | null {
  if (!record(value) || value.version !== 1 || !aspect(value.aspect) || !background(value.background)
    || !Array.isArray(value.sources) || !Array.isArray(value.layers) || value.layers.length > REFERENCE_COMPOSITION_MAX_LAYERS
    || value.sources.length > REFERENCE_COMPOSITION_MAX_LAYERS) return null;
  const size = referenceCompositionSize(value.aspect);
  if (value.width !== size.width || value.height !== size.height) return null;
  const sources = value.sources.map(normalizeReferenceCompositionSource);
  if (sources.some(source => !source)) return null;
  const retainedSources = (sources as ReferenceCompositionSource[]).map(({ requiresUnlock, ...source }) => source);
  const sourceIds = new Set(retainedSources.map(source => source.id));
  if (sourceIds.size !== sources.length) return null;
  const layers: ReferenceCompositionLayer[] = [];
  for (const layer of value.layers) {
    if (!record(layer) || !token(layer.id) || !token(layer.sourceId) || !sourceIds.has(layer.sourceId as string)
      || !bounded(layer.x, 0, 100) || !bounded(layer.y, 0, 100) || !bounded(layer.scale, 5, 200) || !bounded(layer.opacity, 0, 100)) return null;
    layers.push({ id: layer.id as string, sourceId: layer.sourceId as string, x: layer.x, y: layer.y, scale: layer.scale, opacity: layer.opacity });
  }
  if (new Set(layers.map(layer => layer.id)).size !== layers.length || new Set(layers.map(layer => layer.sourceId)).size !== sources.length) return null;
  return { version: 1, aspect: value.aspect, ...size, background: value.background, sources: retainedSources, layers };
}

export function validateReferenceComposition(value: unknown, availableSources: readonly ReferenceCompositionSource[]): ReferenceCompositionIssue | null {
  const recipe = normalizeReferenceComposition(value);
  if (!recipe) return "invalid";
  if (!recipe.layers.some(layer => layer.opacity > 0)) return "empty";
  const current = new Map(availableSources.map(source => [source.id, normalizeReferenceCompositionSource(source)]));
  for (const retained of recipe.sources) {
    const source = current.get(retained.id);
    if (!source) return "source-unavailable";
    if (source.requiresUnlock) return "source-locked";
    if (source.blockId !== retained.blockId || source.kind !== retained.kind || source.mediaUrl !== retained.mediaUrl || source.contentHash !== retained.contentHash) return "source-changed";
  }
  return null;
}

export function addReferenceCompositionLayer(recipe: ReferenceCompositionRecipe, input: ReferenceCompositionSource, id: string): ReferenceCompositionRecipe {
  const source = normalizeReferenceCompositionSource(input);
  if (!source || !token(id) || recipe.layers.length >= REFERENCE_COMPOSITION_MAX_LAYERS || recipe.layers.some(layer => layer.id === id)) return recipe;
  const retained = recipe.sources.find(candidate => candidate.id === source.id);
  if (retained && (retained.contentHash !== source.contentHash || retained.mediaUrl !== source.mediaUrl || retained.blockId !== source.blockId || retained.kind !== source.kind)) return recipe;
  return { ...recipe, sources: retained ? recipe.sources : [...recipe.sources, source], layers: [...recipe.layers, { id, sourceId: source.id, x: 50, y: 50, scale: 70, opacity: 100 }] };
}

/** Explicitly refresh all placements of one current source without changing their authored geometry. */
export function updateReferenceCompositionSource(recipe: ReferenceCompositionRecipe, input: ReferenceCompositionSource): ReferenceCompositionRecipe {
  const source = normalizeReferenceCompositionSource(input), retained = recipe.sources.find(candidate => candidate.id === source?.id);
  if (!source || !retained || retained.blockId !== source.blockId || retained.kind !== source.kind) return recipe;
  return { ...recipe, sources: recipe.sources.map(candidate => candidate.id === source.id ? source : candidate) };
}

export function updateReferenceCompositionLayer(recipe: ReferenceCompositionRecipe, id: string, values: Partial<Pick<ReferenceCompositionLayer, "x" | "y" | "scale" | "opacity">>): ReferenceCompositionRecipe {
  const limits = { x: [0, 100], y: [0, 100], scale: [5, 200], opacity: [0, 100] } as const;
  const patch: Partial<ReferenceCompositionLayer> = {};
  for (const key of ["x", "y", "scale", "opacity"] as const) {
    const value = values[key];
    if (typeof value === "number" && Number.isFinite(value)) patch[key] = Math.round(Math.min(limits[key][1], Math.max(limits[key][0], value)) * 100) / 100;
  }
  return { ...recipe, layers: recipe.layers.map(layer => layer.id === id ? { ...layer, ...patch } : layer) };
}

export function removeReferenceCompositionLayer(recipe: ReferenceCompositionRecipe, id: string): ReferenceCompositionRecipe {
  const layers = recipe.layers.filter(layer => layer.id !== id), used = new Set(layers.map(layer => layer.sourceId));
  return { ...recipe, layers, sources: recipe.sources.filter(source => used.has(source.id)) };
}

export function moveReferenceCompositionLayer(recipe: ReferenceCompositionRecipe, id: string, direction: -1 | 1): ReferenceCompositionRecipe {
  const index = recipe.layers.findIndex(layer => layer.id === id), target = index + direction;
  if (index < 0 || target < 0 || target >= recipe.layers.length) return recipe;
  const layers = [...recipe.layers];
  [layers[index], layers[target]] = [layers[target], layers[index]];
  return { ...recipe, layers };
}

export function referenceCompositionLayerRect(recipe: Pick<ReferenceCompositionRecipe, "width" | "height">, layer: ReferenceCompositionLayer, sourceWidth: number, sourceHeight: number) {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) return null;
  const ratio = Math.min(recipe.width / sourceWidth, recipe.height / sourceHeight) * layer.scale / 100;
  const width = sourceWidth * ratio, height = sourceHeight * ratio;
  return { x: recipe.width * layer.x / 100 - width / 2, y: recipe.height * layer.y / 100 - height / 2, width, height };
}

/** Content and membership changes invalidate async local rendering, including equal-ID replacements. */
export function referenceCompositionSourcesFingerprint(sources: readonly ReferenceCompositionSource[]): string {
  return JSON.stringify(sources.map(normalizeReferenceCompositionSource).filter((source): source is ReferenceCompositionSource => Boolean(source))
    .map(source => [source.id, source.blockId, source.mediaUrl, source.contentHash, source.kind, Boolean(source.requiresUnlock)]).sort((left, right) => String(left[0]).localeCompare(String(right[0]), "en")));
}

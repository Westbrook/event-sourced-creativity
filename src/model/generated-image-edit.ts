import { inspectOutputAsset, MAX_OUTPUT_ASSET_BYTES, outputAssetSha256 } from "./output-asset-inspection.ts";
import { ownerMediaNamespace } from "./media-ownership.ts";
import { normalizeReferenceComposition, referenceCompositionMediaUrl, validateReferenceComposition,
  type ReferenceCompositionRecipe, type ReferenceCompositionSource } from "./reference-composition.ts";

export const GENERATED_IMAGE_EDIT_LIMITS = Object.freeze({ pngBytes: MAX_OUTPUT_ASSET_BYTES, rawBytes: 1_048_576, recipeBytes: 32_768, nodes: 4096, depth: 24 });

/** Supplied by a later current-output adapter. This module does not derive an
 * image revision from DocumentArtifact events or authenticate the owner. */
export type GeneratedImageEditBasis = Readonly<{
  kind: "generated-image"; ownerId: string; documentId: string; outputId: string;
  generationId: string; sourceEventId: string; contentRef: string; revision: number;
  rawJson: string; contentSha256: string;
  media: Readonly<{ url: string; mediaType: "image/png"; sha256: string; width: number; height: number }>;
}>;
export type GeneratedImageEditCurrent = Readonly<{ basis: GeneratedImageEditBasis; sources: readonly ReferenceCompositionSource[] }>;
export type GeneratedImageEditInput = Readonly<{
  basis: GeneratedImageEditBasis; sources: readonly ReferenceCompositionSource[];
  sourceId: string; recipe: ReferenceCompositionRecipe; originalPng: Uint8Array; editedPng: Uint8Array;
}>;
export type PreparedGeneratedImageEdit = Readonly<{
  status: "prepared";
  expected: Omit<GeneratedImageEditBasis, "rawJson">;
  sourceId: string; recipe: ReferenceCompositionRecipe; recipeSha256: string;
  png: Readonly<{ mediaType: "image/png"; sha256: string; byteLength: number; width: number; height: number }>;
  unchangedBytes: boolean;
  /** Fresh copy only while this exact captured basis/source set is current. */
  copyPng(): Uint8Array | null;
  /** Retires this preparation and clears its private byte snapshot. */
  dispose(): void;
}>;
export type GeneratedImageEditPreparation = PreparedGeneratedImageEdit | Readonly<{
  status: "refused"; code: "invalid" | "unsupported" | "source_changed";
}>;

type Row = Record<string, unknown>;
const encoder = new TextEncoder();
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const byteLengthOf = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")!.get!;
const bufferOf = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")!.get!;
const sha = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const integer = (value: unknown, minimum = 0): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
const token = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\p{Cc}\p{Cf}]/u.test(value);
const row = (value: unknown): value is Row => value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value: Row, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const refused = (code: "invalid" | "unsupported" | "source_changed"): GeneratedImageEditPreparation => Object.freeze({ status: "refused", code });

// Compare captured data by values rather than object insertion order. Array
// order remains significant; rawJson remains one exact, unparsed string here.
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  if (row(value)) return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + stableJson(value[key])).join(",") + "}";
  return JSON.stringify(value);
}

// Closed data capture: no accessors/toJSON, sparse arrays, cycles or non-finite
// values. Raw JSON itself remains its exact string, never a normalized draft.
function snapshot(value: unknown, maxBytes = GENERATED_IMAGE_EDIT_LIMITS.rawBytes + GENERATED_IMAGE_EDIT_LIMITS.recipeBytes * 2): unknown {
  let nodes = 0, bytes = 0;
  const ancestors = new Set<object>();
  const charge = (text: string) => { bytes += encoder.encode(text).byteLength; if (bytes > maxBytes) throw new TypeError("image_edit_data_size"); };
  const copy = (input: unknown, depth: number): unknown => {
    if (++nodes > GENERATED_IMAGE_EDIT_LIMITS.nodes || depth > GENERATED_IMAGE_EDIT_LIMITS.depth) throw new TypeError("image_edit_data_bounds");
    if (input === null || typeof input === "boolean") return input;
    if (typeof input === "string") { charge(input); return input; }
    if (typeof input === "number" && Number.isFinite(input)) return input;
    if (!input || typeof input !== "object" || ancestors.has(input)) throw new TypeError("image_edit_data_value");
    const array = Array.isArray(input), prototype = Object.getPrototypeOf(input);
    if (prototype !== (array ? Array.prototype : Object.prototype) && !(prototype === null && !array)) throw new TypeError("image_edit_data_prototype");
    const descriptors = Object.getOwnPropertyDescriptors(input), keys = Reflect.ownKeys(descriptors);
    ancestors.add(input);
    try {
      if (array) {
        const length = descriptors.length;
        if (!length || !("value" in length) || !integer(length.value) || length.value > GENERATED_IMAGE_EDIT_LIMITS.nodes || keys.length !== length.value + 1) throw new TypeError("image_edit_data_array");
        const result: unknown[] = [];
        for (let index = 0; index < length.value; index++) {
          const property = descriptors[index];
          if (!property || !("value" in property) || !property.enumerable) throw new TypeError("image_edit_data_accessor");
          result.push(copy(property.value, depth + 1));
        }
        return Object.freeze(result);
      }
      const result: Row = {};
      for (const key of keys) {
        if (typeof key !== "string") throw new TypeError("image_edit_data_symbol");
        const property = descriptors[key]!;
        if (!("value" in property) || !property.enumerable) throw new TypeError("image_edit_data_accessor");
        charge(key); Object.defineProperty(result, key, { value: copy(property.value, depth + 1), enumerable: true });
      }
      return Object.freeze(result);
    } finally { ancestors.delete(input); }
  };
  return copy(value, 0);
}

function basis(value: unknown): GeneratedImageEditBasis | null {
  if (!row(value) || !exact(value, ["kind", "ownerId", "documentId", "outputId", "generationId", "sourceEventId", "contentRef", "revision", "rawJson", "contentSha256", "media"])
    || value.kind !== "generated-image" || ![value.ownerId, value.documentId, value.outputId, value.generationId, value.sourceEventId, value.contentRef].every(token)
    || !integer(value.revision) || !sha(value.contentSha256) || typeof value.rawJson !== "string" || !value.rawJson.length
    || encoder.encode(value.rawJson).byteLength > GENERATED_IMAGE_EDIT_LIMITS.rawBytes) return null;
  const media = value.media;
  if (!row(media) || !exact(media, ["url", "mediaType", "sha256", "width", "height"]) || typeof media.url !== "string"
    || media.mediaType !== "image/png" || !sha(media.sha256) || !integer(media.width, 1) || !integer(media.height, 1)
    || media.width > 16_384 || media.height > 16_384 || referenceCompositionMediaUrl(media.url) !== media.url) return null;
  const key = decodeURIComponent(media.url.slice("/api/media/".length));
  const prefix = ownerMediaNamespace(value.ownerId as string) + "/generated/";
  if (!key.startsWith(prefix) || !/^[A-Za-z0-9._-]+\.png$/u.test(key.slice(prefix.length))) return null;
  try { if (!row(JSON.parse(value.rawJson))) return null; } catch { return null; }
  return value as GeneratedImageEditBasis;
}

/** Prepare exact bytes only. PNG structural facts do not prove compositor pixel
 * provenance; this joins supplied recipe/source claims, without network, upload,
 * authenticated rights, a media URL, a saved revision, or a server re-render. */
export async function prepareGeneratedImageEdit(input: GeneratedImageEditInput, current: () => GeneratedImageEditCurrent | null): Promise<GeneratedImageEditPreparation> {
  let original: Uint8Array | null = null, edited: Uint8Array | null = null;
  try {
    if (!input || typeof input !== "object" || typeof current !== "function") return refused("invalid");
    const descriptors = Object.getOwnPropertyDescriptors(input), keys = Reflect.ownKeys(descriptors);
    const names = ["basis", "sources", "sourceId", "recipe", "originalPng", "editedPng"];
    if (keys.length !== names.length || keys.some(key => typeof key !== "string" || !names.includes(key))
      || names.some(key => !descriptors[key]?.enumerable || !("value" in descriptors[key]!))) return refused("invalid");
    const copyBytes = (value: unknown): Uint8Array | null => {
      if (!(value instanceof Uint8Array) || Object.getPrototypeOf(value) !== Uint8Array.prototype) return null;
      const length = byteLengthOf.call(value);
      if (!(bufferOf.call(value) instanceof ArrayBuffer) || !length || length > GENERATED_IMAGE_EDIT_LIMITS.pngBytes) return null;
      const copy = new Uint8Array(length);
      Uint8Array.prototype.set.call(copy, value);
      return copy;
    };
    original = copyBytes(descriptors.originalPng!.value); edited = copyBytes(descriptors.editedPng!.value);
    if (!original || !edited) return refused("invalid");
    const metadata = snapshot({ basis: descriptors.basis!.value, sources: descriptors.sources!.value,
      sourceId: descriptors.sourceId!.value, recipe: descriptors.recipe!.value }) as Row;
    const captured = basis(metadata.basis);
    if (!captured || !token(metadata.sourceId) || !Array.isArray(metadata.sources)) return refused("invalid");
    const sources = metadata.sources as ReferenceCompositionSource[];
    if (sources.length > 12 || sources.some(source => !row(source) || !token(source.id))
      || new Set(sources.map(source => source.id)).size !== sources.length) return refused("invalid");
    const recipe = normalizeReferenceComposition(metadata.recipe);
    if (!recipe || encoder.encode(JSON.stringify(metadata.recipe)).byteLength > GENERATED_IMAGE_EDIT_LIMITS.recipeBytes
      || stableJson(recipe) !== stableJson(metadata.recipe) || validateReferenceComposition(recipe, sources)) return refused("invalid");
    const retained = recipe.sources.find(source => source.id === metadata.sourceId);
    if (!retained || retained.kind !== "image" || retained.mediaUrl !== captured.media.url || retained.contentHash !== captured.media.sha256) return refused("invalid");
    const sourceSet = (values: readonly ReferenceCompositionSource[]) => [...values].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    const fingerprint = stableJson({ basis: captured, sources: sourceSet(sources) });
    const isCurrent = () => {
      try {
        const now = snapshot(current());
        return row(now) && exact(now, ["basis", "sources"]) && basis(now.basis) !== null && Array.isArray(now.sources)
          && stableJson({ basis: now.basis, sources: sourceSet(now.sources) }) === fingerprint;
      } catch { return false; }
    };
    if (!isCurrent()) return refused("source_changed");
    const contentSha256 = await outputAssetSha256(encoder.encode(captured.rawJson));
    if (!isCurrent()) return refused("source_changed");
    if (contentSha256 !== captured.contentSha256) return refused("invalid");
    const sourceInspection = await inspectOutputAsset(original, undefined, { snapshot: false });
    if (!isCurrent()) return refused("source_changed");
    if (sourceInspection.status !== "inspected" || sourceInspection.mimeType !== "image/png") return refused("unsupported");
    if (sourceInspection.sha256 !== captured.media.sha256 || sourceInspection.facts.width !== captured.media.width
      || sourceInspection.facts.height !== captured.media.height) return refused("invalid");
    const inspection = await inspectOutputAsset(edited, undefined, { snapshot: false });
    if (!isCurrent()) return refused("source_changed");
    if (inspection.status !== "inspected" || inspection.mimeType !== "image/png") return refused("unsupported");
    if (!inspection.sha256 || inspection.facts.width !== recipe.width || inspection.facts.height !== recipe.height) return refused("invalid");
    const recipeSha256 = await outputAssetSha256(encoder.encode(JSON.stringify(recipe)));
    if (!isCurrent()) return refused("source_changed");
    const { rawJson, ...expected } = captured;
    void rawJson;
    const preparedRecipe = snapshot(recipe, GENERATED_IMAGE_EDIT_LIMITS.recipeBytes) as ReferenceCompositionRecipe;
    const png = Object.freeze({ mediaType: "image/png" as const, sha256: inspection.sha256, byteLength: edited.byteLength, width: recipe.width, height: recipe.height });
    let bytes: Uint8Array | null = edited; edited = null;
    const dispose = () => { bytes?.fill(0); bytes = null; };
    return Object.freeze({ status: "prepared", expected: Object.freeze(expected), sourceId: metadata.sourceId,
      recipe: preparedRecipe, recipeSha256, png,
      unchangedBytes: inspection.sha256 === sourceInspection.sha256,
      copyPng() { if (!bytes || !isCurrent() || !bytes) { dispose(); return null; } return new Uint8Array(bytes); }, dispose });
  } catch { return refused("invalid"); }
  finally { original?.fill(0); edited?.fill(0); }
}

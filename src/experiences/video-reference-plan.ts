import { canonicalJson, exactKeys, freeze, jsonIssues, record } from "./compiler.ts";
import { readVideoReferenceIntent, type VideoReferenceIntent } from "./video-reference.ts";
import { referenceCompositionMediaUrl } from "../model/reference-composition.ts";

/** Deterministic saved source material, not reusable inspection or authority. */
export type VideoReferencePlan = Readonly<{
  version: 1;
  selection: VideoReferenceIntent;
  sourceDigest: string;
  properties: Readonly<Record<string, unknown>>;
}>;

export function readVideoReferencePlan(value: unknown, requested: unknown): VideoReferencePlan | null {
  const selection = readVideoReferenceIntent(requested);
  if (!selection || jsonIssues(value).length || !record(value)
    || !exactKeys(value, ["version", "selection", "sourceDigest", "properties"]) || value.version !== 1
    || typeof value.sourceDigest !== "string" || !/^[a-f0-9]{64}$/u.test(value.sourceDigest)
    || !record(value.properties) || canonicalJson(value.selection) !== canonicalJson(selection)) return null;
  const properties = value.properties;
  if (properties.reference_id !== selection.referenceId || properties.source_content_hash !== selection.sha256
    || !referenceCompositionMediaUrl(properties.media_url)
    || ["model_url", "model_view", "model_reference_id", "model_content_hash", "reference_composition"].some(key => key in properties)) return null;
  return freeze(structuredClone({ version: 1 as const, selection, sourceDigest: value.sourceDigest, properties }));
}

/** Provenance-only context material. No copied ingestion/rights event and no new
 * reference identity: current rights still belong to the original reference. */
export function videoReferenceContextProperties(value: VideoReferencePlan) {
  const reference = readVideoReferencePlan(value, value.selection);
  if (!reference) throw new Error("video_reference_plan_invalid");
  return freeze({ ...structuredClone(reference.properties), experience_reference_source: {
    project_id: reference.selection.sourceProjectId, document_id: reference.selection.sourceDocumentId,
    block_id: reference.selection.sourceBlockId, source_digest: reference.sourceDigest,
  }, experience_value: structuredClone(reference.selection), experience_origin: "authored" as const });
}

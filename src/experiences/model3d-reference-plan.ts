import { canonicalJson, exactKeys, freeze, jsonIssues, record } from "./compiler.ts";
import { readModel3dReferenceIntent, type Model3dReferenceIntent } from "./model3d-reference.ts";
import { normalizeModel3dView } from "../model/model3d-view.ts";

export function isPrivateReferencePreview(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 4096 || !value.startsWith("/api/media/") || /[?#]/u.test(value)) return false;
  try { const key = decodeURIComponent(value.slice(11)); return Boolean(key) && !key.includes("\\") && !key.split("/").some(part => part === "." || part === ".."); }
  catch { return false; }
}

/** Retained authored source material, never reusable backend authority. */
export type Model3dReferencePlan = Readonly<{
  version: 1;
  selection: Model3dReferenceIntent;
  sourceDigest: string;
  properties: Readonly<Record<string, unknown>>;
}>;

/** Parsing qualifies deterministic rendering/rebuilding only; the Worker must reread custody. */
export function readModel3dReferencePlan(value: unknown, requested: unknown): Model3dReferencePlan | null {
  const selection = readModel3dReferenceIntent(requested);
  if (!selection || jsonIssues(value).length || !record(value)
    || !exactKeys(value, ["version", "selection", "sourceDigest", "properties"]) || value.version !== 1
    || typeof value.sourceDigest !== "string" || !/^[a-f0-9]{64}$/u.test(value.sourceDigest)
    || !record(value.properties) || canonicalJson(value.selection) !== canonicalJson(selection)) return null;
  const properties = value.properties;
  if (properties.reference_id !== selection.referenceId || properties.source_content_hash !== selection.sha256
    || !isPrivateReferencePreview(properties.media_url)) return null;
  if (selection.kind === "saved-model-view" && (!normalizeModel3dView(properties.model_view)
    || typeof properties.model_reference_id !== "string" || typeof properties.model_content_hash !== "string"
    || !/^[a-f0-9]{64}$/u.test(properties.model_content_hash) || properties.media_type !== "image/png"
    || !isPrivateReferencePreview(properties.model_url))) return null;
  if (selection.kind === "image" && ["model_url", "model_view", "model_reference_id", "model_content_hash"].some(key => key in properties)) return null;
  return freeze(structuredClone({ version: 1 as const, selection, sourceDigest: value.sourceDigest, properties }));
}

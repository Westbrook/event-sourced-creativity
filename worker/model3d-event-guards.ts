import { verifyModel3dBlockAssets } from "./media-api.ts";
import type { WorkerEnv } from "./runtime.ts";

type AssetEvent = { type?: string; payload?: Record<string, unknown> };
type Block = { type: string; properties: Record<string, unknown> };
const MODEL_PROPERTIES = ["model_url", "model_mime_type", "model_content_hash", "model_reference_id", "model_view"] as const;
const VIEW_PROPERTIES = ["media_url", "media_type", "source_mime_type", "source_content_hash", "reference_id", "pixel_reference_mode"] as const;
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const present = (value: unknown) => value !== undefined && value !== null && value !== "";

function fold(blocks: Map<string, Block>, event: AssetEvent) {
  const payload = record(event.payload), id = String(payload.block_id ?? "");
  if (!id) return;
  if (event.type === "BlockCreated") blocks.set(id, { type: String(payload.type ?? ""), properties: { ...record(payload.properties) } });
  const block = blocks.get(id);
  if (!block) return;
  if (event.type === "BlockPropertyEdited") {
    const path = String(payload.property_path ?? "");
    if (path === "type") block.type = String(payload.new_value ?? "");
    else if (path) block.properties[path] = payload.new_value;
  }
  if (event.type === "ChipEdited") block.properties[String(payload.property ?? "value")] = payload.new_value;
}

/** Verify the final atomic edit, so a camera and its saved PNG are replaced together. */
export async function validateModel3dAssetEvents(input: {
  env: WorkerEnv;
  ownerId: string;
  sourceEvents: readonly AssetEvent[];
  events: readonly AssetEvent[];
  projectAccessId?: string;
}): Promise<{ error: string; message: string; status: 403; blockId: string } | null> {
  const candidates = input.events.filter((event) => event.type === "BlockCreated"
    ? event.payload?.type === "model3d" || MODEL_PROPERTIES.some((key) => present(record(event.payload?.properties)[key]))
    : event.type === "BlockPropertyEdited" || event.type === "ChipEdited");
  if (!candidates.length) return null;
  const blocks = new Map<string, Block>();
  for (const event of input.sourceEvents) fold(blocks, event);
  const originalTypes = new Map([...blocks].map(([id, block]) => [id, block.type]));
  const touched = new Set<string>();
  for (const event of input.events) {
    const payload = record(event.payload), id = String(payload.block_id ?? ""), block = blocks.get(id);
    const path = String(event.type === "ChipEdited" ? payload.property : payload.property_path);
    if (event.type === "BlockCreated" && (payload.type === "model3d" || MODEL_PROPERTIES.some((key) => present(record(payload.properties)[key])))
      || (event.type === "BlockPropertyEdited" || event.type === "ChipEdited")
      && (MODEL_PROPERTIES.includes(path as typeof MODEL_PROPERTIES[number])
        || block?.type === "model3d" && (VIEW_PROPERTIES.includes(path as typeof VIEW_PROPERTIES[number]) || path === "type")
        || path === "type" && payload.new_value === "model3d")) touched.add(id);
    fold(blocks, event);
  }
  const allEvents = [...input.sourceEvents, ...input.events];
  const fail = (blockId: string, error: string, message: string) => ({ error, message, status: 403 as const, blockId });
  for (const blockId of touched) {
    const block = blocks.get(blockId);
    if (!block) continue;
    const originalType = originalTypes.get(blockId);
    if (originalType && (originalType === "model3d") !== (block.type === "model3d")) {
      return fail(blockId, "model3d_type_transition_forbidden", "Create a 3D model context with its own uploaded asset before using it as a reference.");
    }
    if (block.type !== "model3d") return fail(blockId, "model3d_asset_requires_model3d_block", "3D assets and saved camera views belong to a 3D model context.");
    const properties = block.properties;
    if (!MODEL_PROPERTIES.some((key) => present(properties[key])) && !VIEW_PROPERTIES.some((key) => key !== "pixel_reference_mode" && present(properties[key]))) continue;
    if (!await verifyModel3dBlockAssets(input.env, input.ownerId, properties, input.projectAccessId ?? "")) {
      return fail(blockId, "model3d_asset_not_verified", "The 3D asset and its saved view do not match their original private upload. Save the model view again.");
    }
    for (const [referenceField, urlField, hashField] of [["model_reference_id", "model_url", "model_content_hash"], ["reference_id", "media_url", "source_content_hash"]] as const) {
      if (!properties[urlField]) continue;
      const referenceId = String(properties[referenceField] ?? ""), sourceUrl = String(properties[urlField]);
      const receipt = allEvents.findLast((event) => event.type === "ReferenceIngested"
        && String(event.payload?.reference_id ?? "") === referenceId
        && String(event.payload?.source_ref ?? event.payload?.media_url ?? "") === sourceUrl);
      if (!referenceId || !receipt || receipt.payload?.content_hash !== properties[hashField]) {
        return fail(blockId, "model3d_reference_receipt_mismatch", "The model or saved image must retain the source receipt for these exact uploaded bytes.");
      }
    }
  }
  return null;
}

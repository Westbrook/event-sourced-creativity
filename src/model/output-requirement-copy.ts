import { copyOutputRequirement, inspectOutputRequirement, isOutputContextType, parseOutputRequirement, type OutputSourceScope } from "./output-requirements.ts";
import type { EventInput } from "./events.ts";

type SourceBlock = { id: string; type: string; properties: Record<string, unknown> };
type CopyOptions = { preserveDocumentScope?: boolean };

/** Copy authored requirements, never the original plan, result, acceptance or permission to spend. */
export function copyOutputRequirementBlock(block: SourceBlock, newBlockId: string, sourceBlockIds: ReadonlyMap<string, string>, options: CopyOptions = {}) {
  const properties = { ...block.properties };
  if (!isOutputContextType(block.type)) return { type: block.type, properties };
  for (const key of Object.keys(properties)) {
    if (["weight", "influence", "intent", "effect"].includes(key)
      || key.startsWith("output_") && key !== "output_spec"
      || /^(?:plan|preflight|grant|slot|acceptance|fulfillment|execution|result|asset|delivery)_(?:id|status|revision|approved|confirmed|receipt)$/u.test(key)) delete properties[key];
  }
  const original = Object.hasOwn(properties, "output_spec") ? properties.output_spec : parseOutputRequirement({
    id: block.id, type: "output", content: typeof properties.text === "string" ? properties.text : "",
    subtype: typeof properties.subtype === "string" ? properties.subtype : "Custom deliverables",
  }).spec;
  const inspected = inspectOutputRequirement(original);
  if (inspected.status !== "valid") {
    // Unknown schemas cannot be safely remapped. Preserve their opaque intent as non-executable evidence.
    if (original !== null && original !== undefined) properties.output_spec = structuredClone(original);
    return { type: "output", properties };
  }
  const copied = copyOutputRequirement(inspected.spec!, newBlockId).spec;
  const source = (scope: OutputSourceScope): OutputSourceScope => {
    if (scope.kind === "unknown") return { ...scope };
    if (scope.kind === "document") return options.preserveDocumentScope ? { kind: "document" }
      : { kind: "unknown", reason: "Review source coverage in the destination Document before confirming these copied requirements." };
    if (scope.block_ids.every((id) => sourceBlockIds.has(id))) return { kind: "blocks", block_ids: scope.block_ids.map((id) => sourceBlockIds.get(id)!) };
    return { kind: "unknown", reason: "One or more required source blocks were not copied. Review the complete source scope; it has not been narrowed automatically." };
  };
  for (const deliverable of copied.deliverables) {
    deliverable.source_scope = source(deliverable.source_scope);
    for (const member of deliverable.series?.members ?? []) member.source_scope = source(member.source_scope);
  }
  properties.output_spec = copied;
  return { type: "output", properties };
}

/** Apply the same safe copy semantics to library sets and independent forks after their ID map is complete. */
export function copyOutputRequirementCreationEvents(events: readonly EventInput[], sourceBlockIds: ReadonlyMap<string, string>, options: CopyOptions = {}): EventInput[] {
  const originals = new Map([...sourceBlockIds].map(([source, destination]) => [destination, source]));
  return events.map((event) => {
    if (event.type !== "BlockCreated" || !isOutputContextType(event.payload.type)) return event;
    const newId = String(event.payload.block_id ?? ""), originalId = originals.get(newId);
    if (!originalId) throw new Error("A copied Output requirement needs its original and destination block identities.");
    const copied = copyOutputRequirementBlock({ id: originalId, type: String(event.payload.type), properties: event.payload.properties as Record<string, unknown> ?? {} }, newId, sourceBlockIds, options);
    return { ...event, payload: { ...event.payload, ...copied } };
  });
}

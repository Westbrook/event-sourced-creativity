import { isDocumentArtifactKind, type DocumentArtifactKind, type SlidePresentation, type SlideVisualData } from "./document-artifacts.ts";
import type { CreativeBlock, CreativeBlockRelation, EventInput } from "./events.ts";

export type OutputInputItem = {
  source_artifact_item_id: string;
  title: string;
  body: string;
  notes: string;
  image_prompt: string;
  context_group_ids: string[];
  slide: SlideVisualData | null;
};

export type OutputInputDraft = {
  kind: DocumentArtifactKind;
  title: string;
  summary: string;
  markdown: string;
  presentation: SlidePresentation | null;
  items: OutputInputItem[];
};

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const copy = <T>(value: T): T => structuredClone(value);
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const string = (value: unknown) => typeof value === "string" ? value : "";
const AUTHORED_DETAILS = "\n\n---\n\n## Supporting creative direction\n\n";

/** Read an adopted output without mutating its immutable source or event snapshots. */
export function outputInputDraft(block: CreativeBlock): OutputInputDraft | null {
  const kind = block.properties.source_artifact_kind;
  if (!isDocumentArtifactKind(kind) || block.properties.source_artifact_item_id) return null;
  const structure = record(block.properties.artifact_structure);
  const values = Array.isArray(structure.items) ? structure.items : [];
  const items = values.map((value, index): OutputInputItem => {
    const item = record(value);
    return {
      source_artifact_item_id: string(item.source_artifact_item_id) || string(item.id) || `${String(block.properties.source_artifact_id ?? block.id)}:${index + 1}`,
      title: string(item.title),
      body: string(item.body),
      notes: string(item.notes),
      image_prompt: string(item.image_prompt),
      context_group_ids: Array.isArray(item.context_group_ids) ? item.context_group_ids.map(String) : [],
      slide: item.slide && typeof item.slide === "object" ? copy(item.slide as SlideVisualData) : null,
    };
  });
  return {
    kind,
    title: string(block.properties.label),
    summary: string(block.properties.artifact_summary),
    markdown: typeof block.properties.artifact_markdown === "string" ? block.properties.artifact_markdown : string(block.properties.text).split(AUTHORED_DETAILS)[0] ?? "",
    presentation: structure.presentation && typeof structure.presentation === "object" ? copy(structure.presentation as SlidePresentation) : null,
    items,
  };
}

/** Serialize all visible authored details into the copy consumed by later generators. */
export function serializeOutputInputDraft(draft: OutputInputDraft): string {
  const authoredMarkdown = draft.markdown;
  const parts = [draft.title && !authoredMarkdown.includes(draft.title) ? `Title: ${draft.title}` : "", draft.summary ? `Summary: ${draft.summary}` : ""];
  if (draft.presentation?.theme) parts.push(`Presentation theme: ${draft.presentation.theme}`);
  if (draft.presentation?.footerLabel) parts.push(`Presentation footer: ${draft.presentation.footerLabel}`);
  if (draft.presentation?.stylePreset) parts.push(`Presentation style: ${draft.presentation.stylePreset}`);
  if (draft.presentation?.mode) parts.push(`Presentation appearance: ${draft.presentation.mode}`);
  if (draft.presentation?.palette) parts.push(`Presentation palette: ${Object.entries(draft.presentation.palette).map(([name, value]) => `${name} ${value}`).join(", ")}`);

  for (const [index, item] of draft.items.entries()) {
    const heading = item.title ? `## ${index + 1}. ${item.title}` : `## ${index + 1}`;
    parts.push(heading, item.body);
    if (item.notes) parts.push(`Notes: ${item.notes}`);
    if (item.image_prompt) parts.push(`Visual direction: ${item.image_prompt}`);
    if (item.slide) {
      if (item.slide.layout) parts.push(`Slide layout: ${item.slide.layout}`);
      if (item.slide.kicker) parts.push(`Section: ${item.slide.kicker}`);
      if (item.slide.bullets.length) parts.push(item.slide.bullets.map((bullet) => `- ${bullet}`).join("\n"));
      if (item.slide.visual.label) parts.push(`Visual label: ${item.slide.visual.label}`);
      if (item.slide.visual.value) parts.push(`Visual value: ${item.slide.visual.value}`);
      if (item.slide.visual.kind) parts.push(`Visual type: ${item.slide.visual.kind}`);
      for (const datum of item.slide.visual.data) parts.push([datum.label, datum.value].filter(Boolean).join(": "));
    }
  }

  const details = parts.filter((part) => part !== "").join("\n\n");
  return [authoredMarkdown, details].filter((part) => part !== "").join(AUTHORED_DETAILS);
}

type OutputInputEventOptions = { sourceSurface?: string; frameTextOverrides?: ReadonlyMap<string, string> };

/** Replace only top-level event properties; nested property paths are not supported. */
export function outputInputEditEvents(root: CreativeBlock, blocks: readonly CreativeBlock[], next: OutputInputDraft, options: OutputInputEventOptions = {}): EventInput[] {
  const current = outputInputDraft(root);
  if (!current || root.locked || current.kind !== next.kind) return [];
  const draft = copy(next);
  if (draft.title !== current.title && current.title) {
    const firstHeading = draft.markdown.match(/^(#{1,6})\s+([^\r\n]+)(\r?\n|$)/);
    if (firstHeading?.[2] === current.title) draft.markdown = `${firstHeading[1]} ${draft.title}${firstHeading[3]}${draft.markdown.slice(firstHeading[0].length)}`;
  }
  const itemsWereEdited = !same(current.items, draft.items);
  const originalStructure = record(root.properties.artifact_structure);
  const rootSet = string(root.properties.context_set_id);
  const frames = blocks.filter((block) => !block.removed && block.documentId === root.documentId && block.properties.source_artifact_id === root.properties.source_artifact_id && block.properties.source_artifact_item_id && (!rootSet || string(block.properties.context_set_id) === rootSet || string(block.properties.context_set_root_id) === root.id));
  for (const [index, item] of draft.items.entries()) {
    if (item.source_artifact_item_id !== `${String(root.properties.source_artifact_id ?? root.id)}:${index + 1}`) continue;
    const frame = frames.find((block) => Number(block.properties.storyboard_frame_index) === index + 1);
    if (frame) item.source_artifact_item_id = string(frame.properties.source_artifact_item_id);
  }
  let structure = { ...copy(originalStructure), presentation: draft.presentation ? copy(draft.presentation) : null, items: copy(draft.items) };
  let structureChanged = !same(originalStructure, structure);

  // Single prose sections remain useful to structured consumers after direct writing.
  if (draft.markdown !== current.markdown && !itemsWereEdited && draft.items.length === 1) {
    draft.items[0]!.body = draft.markdown;
    structure = { ...copy(originalStructure), presentation: draft.presentation ? copy(draft.presentation) : null, items: copy(draft.items) };
    structureChanged = !same(originalStructure, structure);
  }

  const metadataChanged = draft.title !== current.title || draft.summary !== current.summary;
  const text = draft.markdown !== current.markdown && !itemsWereEdited && !metadataChanged ? draft.markdown : structureChanged || metadataChanged || itemsWereEdited ? serializeOutputInputDraft(draft) : string(root.properties.text);
  const events: EventInput[] = [];
  const change = (block: CreativeBlock, path: string, value: unknown) => {
    const previous = block.properties[path];
    if (same(previous, value)) return;
    events.push({ type: "BlockPropertyEdited", payload: { block_id: block.id, property_path: path, old_value: previous === undefined ? null : copy(previous), new_value: copy(value), source_surface: options.sourceSurface ?? "output-input-editor" } });
  };
  const renameMemberships = (block: CreativeBlock) => {
    if (draft.title === current.title || !Array.isArray(block.properties.combined_context_memberships)) return;
    const memberships = block.properties.combined_context_memberships.map((value) => {
      const membership = record(value);
      const name = membership.name === current.title ? draft.title : membership.name;
      const target = typeof membership.target === "string" && membership.target.startsWith(`${current.title} `) ? `${draft.title}${membership.target.slice(current.title.length)}` : membership.target;
      return { ...membership, name, target };
    });
    change(block, "combined_context_memberships", memberships);
  };

  change(root, "label", draft.title);
  change(root, "artifact_summary", draft.summary);
  change(root, "artifact_item_count", draft.items.length);
  change(root, "artifact_markdown", draft.markdown);
  change(root, "text", text);
  if (structureChanged) change(root, "artifact_structure", structure);
  renameMemberships(root);

  if (draft.kind !== "storyboard") return events;

  for (const [index, item] of draft.items.entries()) {
    const frame = frames.find((block) => String(block.properties.source_artifact_item_id) === item.source_artifact_item_id)
      ?? frames.find((block) => Number(block.properties.storyboard_frame_index) === index + 1);
    if (!frame) continue;
    const frameNumber = Number(frame.properties.storyboard_frame_index) || index + 1;
    const authoredText = options.frameTextOverrides?.get(frame.id) ?? [item.body, item.notes].filter(Boolean).join(" ");
    if (frame.locked && (frame.properties.label !== `${draft.title} · Frame ${frameNumber}${item.title ? ` · ${item.title}` : ""}` || frame.properties.text !== authoredText || frame.properties.storyboard_title !== draft.title || frame.properties.storyboard_shot_title !== item.title || frame.properties.storyboard_shot_direction !== item.body || frame.properties.storyboard_camera_direction !== item.notes || frame.properties.storyboard_frame_prompt !== item.image_prompt)) return [];
    change(frame, "label", `${draft.title} · Frame ${frameNumber}${item.title ? ` · ${item.title}` : ""}`);
    change(frame, "text", authoredText);
    change(frame, "storyboard_title", draft.title);
    change(frame, "storyboard_shot_title", item.title);
    change(frame, "storyboard_shot_direction", item.body);
    change(frame, "storyboard_camera_direction", item.notes);
    change(frame, "storyboard_frame_prompt", item.image_prompt);
    renameMemberships(frame);
  }
  return events;
}

/** A standalone storyboard-frame edit updates its parent and provider-facing fields. */
export function outputFrameEditEvents(frame: CreativeBlock, blocks: readonly CreativeBlock[], value: string, sourceSurface = "output-frame-editor"): EventInput[] {
  if (frame.locked) return [];
  const root = blocks.find((block) => !block.removed && block.documentId === frame.documentId && block.properties.source_artifact_id === frame.properties.source_artifact_id && !block.properties.source_artifact_item_id && (!frame.properties.context_set_root_id || block.id === frame.properties.context_set_root_id || block.properties.context_set_id === frame.properties.context_set_id));
  const draft = root ? outputInputDraft(root) : null;
  if (!root || !draft) {
    const events: EventInput[] = [];
    for (const path of ["text", "storyboard_shot_direction"]) {
      const oldValue = frame.properties[path];
      if (oldValue !== value) events.push({ type: "BlockPropertyEdited", payload: { block_id: frame.id, property_path: path, old_value: oldValue ?? null, new_value: value, source_surface: sourceSurface } });
    }
    return events;
  }
  let index = draft.items.findIndex((item) => item.source_artifact_item_id === frame.properties.source_artifact_item_id);
  if (index < 0) index = draft.items.findIndex((_, position) => Number(frame.properties.storyboard_frame_index) === position + 1);
  if (index < 0) return [];
  draft.items[index] = { ...draft.items[index]!, body: value };
  return outputInputEditEvents(root, blocks, draft, { sourceSurface, frameTextOverrides: new Map([[frame.id, value]]) });
}

/** Route every existing plain-text editor through the same derived-output boundary. */
export function outputBlockTextEditEvents(block: CreativeBlock, blocks: readonly CreativeBlock[], value: string, sourceSurface = "output-context-editor"): EventInput[] {
  if (block.properties.source_artifact_kind === "storyboard" && block.properties.source_artifact_item_id) return outputFrameEditEvents(block, blocks, value, sourceSurface);
  const draft = outputInputDraft(block);
  if (draft) return outputInputEditEvents(block, blocks, { ...draft, markdown: value }, { sourceSurface });
  const path = block.properties.text !== undefined ? "text" : "label";
  const previous = block.properties[path];
  if (same(previous, value) || block.locked) return [];
  return [{ type: "BlockPropertyEdited", payload: { block_id: block.id, property_path: path, old_value: previous ?? null, new_value: value, source_surface: sourceSurface } }];
}

/** Remove an output and only its relation-owned children as one reversible family. */
export function outputBlockRemovalEvents(block: CreativeBlock, blocks: readonly CreativeBlock[], relations: readonly CreativeBlockRelation[], input: EventInput): EventInput[] {
  if (block.locked || relations.some((relation) => relation.kind === "artifact_contains" && relation.toBlockId === block.id)) return [];
  const ownedIds = new Set(relations.filter((relation) => relation.kind === "artifact_contains" && relation.fromBlockId === block.id).map((relation) => relation.toBlockId));
  const owned = blocks.filter((candidate) => !candidate.removed && ownedIds.has(candidate.id));
  if (owned.some((candidate) => candidate.locked)) return [];
  return [...owned.map((candidate): EventInput => ({
    type: "BlockRemoved",
    payload: { ...input.payload, block_id: candidate.id, scope: candidate.scope, document_id: candidate.documentId || undefined, source_artifact_id: candidate.properties.source_artifact_id, context_set_root_id: block.id, reason: "removed-with-owned-output-input" },
  })), input];
}

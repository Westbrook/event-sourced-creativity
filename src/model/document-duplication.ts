import { ideasInDocument } from './project-ideas.ts';
import { copyOutputRequirementBlock } from "./output-requirement-copy.ts";
import {
  ACTION_PARTICIPANT_RELATION, ACTION_REFERENCE_ROLES, normalizeActionBlockReferences,
  validateContextCompositionGraph,
} from "./combined-context.ts";
import type { CreativeProjection, EventInput } from "./events.ts";
import { documentSlug } from "./routes.ts";

export const DOCUMENT_DUPLICATION_MAX_BLOCKS = 100;
export const DOCUMENT_DUPLICATION_MAX_EVENTS = 512;

export type DocumentDuplicationInput = {
  projection: CreativeProjection;
  sourceDocumentId: string;
  title: string;
  sourceStreamId: string;
  sourceSequence: number;
  /** Omitted inherits the source folder; null explicitly selects the project root. */
  collectionId?: string | null;
  createId?: () => string;
};

export type DocumentDuplicationPlan = {
  documentId: string;
  title: string;
  collectionId: string | null;
  blockCount: number;
  relationCount: number;
  events: EventInput[];
};

export function normalizeDocumentDuplicationTitle(value: unknown): string {
  const title = typeof value === "string" ? value.normalize("NFC").trim() : "";
  if (!title || Array.from(title).length > 80 || /\p{Cc}/u.test(title)) {
    throw new Error("document_duplicate_title_invalid");
  }
  return title;
}

/** Resolve the whole destination path. A removed or foreign parent is not the project root. */
export function documentDuplicationFolder(projection: CreativeProjection, collectionId: string | null) {
  const path = [], seen = new Set<string>();
  let id = collectionId;
  while (id !== null) {
    if (!id || seen.has(id)) throw new Error("document_duplicate_folder_unavailable");
    seen.add(id);
    const collection = projection.collections.find((item) =>
      item.id === id && item.projectId === projection.projectId && !item.removed,
    );
    if (!collection) throw new Error("document_duplicate_folder_unavailable");
    path.unshift(collection);
    id = collection.parentId;
  }
  return path;
}

const contextKeys = new Set(["context_set_id", "contextSetId", "reference_set_id", "referenceSetId"]);
const blockKeys = new Set(["context_set_root_id", "contextSetRootId", "root_block_id", "rootBlockId", "parent_block_id", "parentBlockId", "target_block_id", "targetBlockId", "from_block_id", "fromBlockId", "to_block_id", "toBlockId", "block_id", "blockId"]);
const blockLists = new Set(["ancestor_block_ids", "ancestorBlockIds", "context_path_ids", "contextPathIds"]);
const groupKeys = new Set(["parent_group_id", "parentGroupId", "root_group_id", "rootGroupId"]);
const groupLists = new Set(["context_group_ids", "contextGroupIds"]);
const relationKeys = new Set(["relation_id", "relationId"]);
const relationLists = new Set(["relation_path_ids", "relationPathIds"]);
const present = (value: unknown) => value !== undefined && value !== null && value !== "";

/** Duplicate one complete authored snapshot. Provenance remains evidence; mutable routes get new IDs. */
export function buildDocumentDuplicationPlan(input: DocumentDuplicationInput): DocumentDuplicationPlan {
  const source = input.projection.documents.find((document) =>
    document.id === input.sourceDocumentId && document.projectId === input.projection.projectId && !document.removed,
  );
  if (!source) throw new Error("That document is no longer available in this project.");
  if(ideasInDocument(input.projection,source.id).some(block=>Object.hasOwn(block.properties,'rich_text_body')))throw new Error('This Document contains rich Idea bodies. Use its Ideas in another Document in Still; independent duplication requires a compatible reference copy editor. The source has not changed.');
  const title = normalizeDocumentDuplicationTitle(input.title);
  if (!input.sourceStreamId || !Number.isSafeInteger(input.sourceSequence) || input.sourceSequence < 0) {
    throw new Error("document_duplicate_source_invalid");
  }
  const blocks = input.projection.libraryBlocks
    .filter((block) => block.scope === "document" && block.documentId === source.id && block.projectId === source.projectId && !block.removed)
    .sort((left, right) => left.position.localeCompare(right.position) || left.id.localeCompare(right.id));
  if (blocks.length > DOCUMENT_DUPLICATION_MAX_BLOCKS) throw new Error("document_duplicate_too_large");
  if (blocks.some((block) => Object.keys(block.properties).some((key) =>
    key.startsWith("organization_context_package_") || key === "organization_context_source_block_id",
  ))) {
    throw new Error("Published organization context cannot be duplicated. Adopt its approved package in a new document instead.");
  }

  const membership = input.projection.membership[source.id];
  const sourceFolder = membership?.collectionId ?? null;
  documentDuplicationFolder(input.projection, sourceFolder);
  const collectionId = input.collectionId === undefined ? sourceFolder : input.collectionId;
  documentDuplicationFolder(input.projection, collectionId);
  const sourceIds = new Set(blocks.map((block) => block.id));
  const relations = input.projection.libraryBlockRelations.filter((relation) => !relation.removed
    && (relation.documentId === source.id || sourceIds.has(relation.fromBlockId) || sourceIds.has(relation.toBlockId)));
  for (const relation of relations) {
    if (relation.projectId !== source.projectId || relation.documentId && relation.documentId !== source.id
      || !sourceIds.has(relation.fromBlockId) || !sourceIds.has(relation.toBlockId)) {
      throw new Error("document_duplicate_external_dependency");
    }
    if (relation.kind === ACTION_PARTICIPANT_RELATION
      && (blocks.find((block) => block.id === relation.fromBlockId)?.type !== "action"
        || !ACTION_REFERENCE_ROLES.includes(relation.properties.participant_role as typeof ACTION_REFERENCE_ROLES[number]))) {
      throw new Error("document_duplicate_invalid_participant");
    }
  }

  const createId = input.createId ?? (() => crypto.randomUUID());
  const documentId = createId(), blockIds = new Map(blocks.map((block) => [block.id, createId()]));
  const relationIds = new Map(relations.map((relation) => [relation.id, createId()]));
  const contextIds = new Map<string, string>();
  const collectGroups = (value: unknown, output: Set<string>) => {
    if (Array.isArray(value)) { for (const item of value) collectGroups(item, output); return; }
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (contextKeys.has(key) && present(item)) {
        if (typeof item !== "string") throw new Error("document_duplicate_context_route_unavailable");
        output.add(item);
      } else if (!key.startsWith("source_") && !key.startsWith("source")) collectGroups(item, output);
    }
  };
  const groupIds = new Set<string>();
  for (const block of blocks) collectGroups(block.properties, groupIds);
  for (const relation of relations) collectGroups(relation.properties, groupIds);
  for (const id of groupIds) contextIds.set(id, createId());
  for (const block of input.projection.libraryBlocks.filter((item) => !item.removed && !sourceIds.has(item.id))) {
    const external = new Set<string>(); collectGroups(block.properties, external);
    if ([...external].some((id) => groupIds.has(id))) throw new Error("document_duplicate_external_dependency");
  }
  const copiedRelationIds = new Set(relations.map((relation) => relation.id));
  for (const relation of input.projection.libraryBlockRelations.filter((item) => !item.removed && !copiedRelationIds.has(item.id))) {
    const external = new Set<string>(); collectGroups(relation.properties, external);
    if ([...external].some((id) => groupIds.has(id))) throw new Error("document_duplicate_external_dependency");
  }
  const remap = (value: unknown, ids: Map<string, string>): unknown => {
    if (!present(value)) return value;
    if (typeof value !== "string" || !ids.has(value)) throw new Error("document_duplicate_context_route_unavailable");
    return ids.get(value)!;
  };
  const remapList = (value: unknown, ids: Map<string, string>) => {
    if (!Array.isArray(value)) throw new Error("document_duplicate_context_route_unavailable");
    return value.map((item) => remap(item, ids));
  };
  const copyProperties = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(copyProperties);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      // The retained PNG commits to this complete recipe, including its original source identities.
      // Rebinding the editable scene requires a new capture and a new immutable media receipt.
      if (key === "reference_composition") return [key, structuredClone(item)];
      if (contextKeys.has(key) || groupKeys.has(key)) return [key, remap(item, contextIds)];
      if (blockKeys.has(key)) return [key, remap(item, blockIds)];
      if (blockLists.has(key)) return [key, remapList(item, blockIds)];
      if (groupLists.has(key)) return [key, remapList(item, contextIds)];
      if (relationKeys.has(key)) return [key, remap(item, relationIds)];
      if (relationLists.has(key)) return [key, remapList(item, relationIds)];
      // Source identifiers describe immutable provenance and are not links to new mutable decisions.
      if (/^(?:source_|source[A-Z]|copied_from_|copiedFrom|forked_from_|forkedFrom)/u.test(key)) {
        return [key, structuredClone(item)];
      }
      if (["document_id", "documentId"].includes(key)) return [key, remap(item, new Map([[source.id, documentId]]))];
      if (["project_id", "projectId"].includes(key)) return [key, remap(item, new Map([[source.projectId, source.projectId]]))];
      if (present(item) && ["canvas_id", "canvasId", "context_groups", "contextGroups", "combined_contexts", "combinedContexts"].includes(key)) {
        throw new Error("document_duplicate_context_route_unavailable");
      }
      const canonicalKey = key.replace(/[A-Z]/gu, (letter) => "_" + letter.toLowerCase());
      if (present(item) && /(?:context|group|block|relation)_(?:id|ids|route|routes)$/u.test(canonicalKey)) {
        throw new Error("document_duplicate_context_route_unavailable");
      }
      return [key, copyProperties(item)];
    }));
  };

  const events: EventInput[] = [{
    type: "DocumentCreated",
    payload: {
      project_id: source.projectId, document_id: documentId,
      handle: documentSlug(title).slice(0, 48) || `document-${documentId.slice(0, 8)}`,
      title, source_document_id: source.id, source_stream_id: input.sourceStreamId,
      source_sequence: input.sourceSequence, carried_block_ids: blocks.map((block) => block.id),
      copy_mode: "independent-snapshot", source_surface: "project-document-duplicate",
    },
  }];
  const deferred: EventInput[] = [];
  for (const block of blocks) {
    const original = block.properties;
    if (Object.hasOwn(original, "block_references")) {
      const raw = original.block_references;
      if (block.type !== "action" || !Array.isArray(raw)
        || normalizeActionBlockReferences(raw).length !== raw.length
        || raw.some((item) => !item || typeof item !== "object"
          || typeof item.block_id !== "string" || typeof item.handle !== "string"
          || Object.keys(item).some((key) => !["block_id", "handle", "role"].includes(key))
          || !blockIds.has(item.block_id))) throw new Error("document_duplicate_external_participant");
    }
    const copied = copyOutputRequirementBlock(block, blockIds.get(block.id)!, blockIds, { preserveDocumentScope: true });
    // Output's complete-map helper owns its requirement identities and source-scope semantics.
    // Do not remap those freshly allocated IDs twice or interpret an opaque future schema.
    const outputSpec = copied.type === "output" && Object.hasOwn(copied.properties, "output_spec");
    const properties = copyProperties(outputSpec
      ? Object.fromEntries(Object.entries(copied.properties).filter(([key]) => key !== "output_spec"))
      : copied.properties) as Record<string, unknown>;
    if (outputSpec) properties.output_spec = structuredClone(copied.properties.output_spec);
    if (Array.isArray(properties.block_references) && properties.block_references.length) {
      deferred.push({
        type: "BlockPropertyEdited",
        payload: {
          project_id: source.projectId, document_id: documentId, block_id: blockIds.get(block.id),
          property_path: "block_references", old_value: [], new_value: properties.block_references,
          source_surface: "project-document-duplicate",
        },
      });
      properties.block_references = [];
    }
    events.push({
      type: "BlockCreated",
      payload: {
        project_id: source.projectId, document_id: documentId, block_id: blockIds.get(block.id),
        copied_from_block_id: block.id, type: copied.type, handle: block.handle,
        position: block.position, properties, source_surface: "project-document-duplicate",
      },
    });
  }
  events.push(...deferred);
  for (const relation of relations) {
    events.push({
      type: "BlockRelationAdded",
      payload: {
        project_id: source.projectId, document_id: documentId, relation_id: relationIds.get(relation.id),
        from_block_id: blockIds.get(relation.fromBlockId), to_block_id: blockIds.get(relation.toBlockId),
        kind: relation.kind, properties: copyProperties(relation.properties),
        copied_from_relation_id: relation.id, source_surface: "project-document-duplicate",
      },
    });
  }
  // Mutate only new identities; restore every original lock after the complete graph is assembled.
  for (const block of blocks.filter((item) => item.locked)) {
    events.push({
      type: "BlockLocked",
      payload: { project_id: source.projectId, document_id: documentId, block_id: blockIds.get(block.id), source_surface: "project-document-duplicate" },
    });
  }
  if (collectionId !== null) {
    events.push({
      type: "CollectionItemAdded",
      payload: {
        project_id: source.projectId, collection_id: collectionId, item_ref: { document_id: documentId },
        position: membership?.position ?? "a0", source_surface: "project-document-duplicate",
      },
    });
  }
  if (events.length > DOCUMENT_DUPLICATION_MAX_EVENTS) throw new Error("document_duplicate_too_large");
  const issue = validateContextCompositionGraph({ blocks: [], relations: [], events });
  if (issue) throw new Error(issue.code);
  return { documentId, title, collectionId, blockCount: blocks.length, relationCount: relations.length, events };
}

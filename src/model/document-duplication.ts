import { copyOutputRequirementBlock } from "./output-requirement-copy.ts";
import { normalizeActionBlockReferences } from "./combined-context.ts";
import type { CreativeProjection, EventInput } from "./events.ts";
import { documentSlug } from "./routes.ts";

export type DocumentDuplicationInput = {
  projection: CreativeProjection;
  sourceDocumentId: string;
  title: string;
  sourceStreamId: string;
  sourceSequence: number;
  createId?: () => string;
};

export type DocumentDuplicationPlan = {
  documentId: string;
  title: string;
  blockCount: number;
  relationCount: number;
  events: EventInput[];
};

/** Duplicate authored context without sharing mutable block or relationship identities. */
export function buildDocumentDuplicationPlan(input: DocumentDuplicationInput): DocumentDuplicationPlan {
  const source = input.projection.documents.find((document) =>
    document.id === input.sourceDocumentId && document.projectId === input.projection.projectId && !document.removed,
  );
  if (!source) throw new Error("That document is no longer available in this project.");

  const title = input.title.normalize("NFC").trim();
  if (!title || Array.from(title).length > 80) throw new Error("Enter a document name with no more than 80 characters.");

  const blocks = input.projection.libraryBlocks
    .filter((block) => block.scope === "document" && block.documentId === source.id && block.projectId === source.projectId && !block.removed)
    .sort((left, right) => left.position.localeCompare(right.position));

  if (blocks.some((block) => Object.keys(block.properties).some((key) =>
    key.startsWith("organization_context_package_") || key === "organization_context_source_block_id",
  ))) {
    throw new Error("Published organization context cannot be duplicated. Adopt its approved package in a new document instead.");
  }

  const createId = input.createId ?? (() => crypto.randomUUID());
  const documentId = createId();
  const blockIds = new Map(blocks.map((block) => [block.id, createId()]));
  const contextIds = new Map<string, string>();
  const contextId = (value: unknown) => {
    if (typeof value !== "string" || !value) return value;
    const existing = contextIds.get(value);
    if (existing) return existing;
    const replacement = createId();
    contextIds.set(value, replacement);
    return replacement;
  };

  const events: EventInput[] = [{
    type: "DocumentCreated",
    payload: {
      project_id: source.projectId,
      document_id: documentId,
      handle: documentSlug(title).slice(0, 48) || `document-${documentId.slice(0, 8)}`,
      title,
      source_document_id: source.id,
      source_stream_id: input.sourceStreamId,
      source_sequence: input.sourceSequence,
      carried_block_ids: blocks.map((block) => block.id),
      source_surface: "project-document-duplicate",
    },
  }];

  const deferredActionReferences: EventInput[] = [];
  for (const block of blocks) {
    const copied=copyOutputRequirementBlock(block,blockIds.get(block.id)!,blockIds,{preserveDocumentScope:true});
    const properties: Record<string, unknown> = copied.properties;
    for (const key of ["context_set_id", "reference_set_id"]) {
      if (properties[key]) properties[key] = contextId(properties[key]);
    }
    if (typeof properties.context_set_root_id === "string") {
      properties.context_set_root_id = blockIds.get(properties.context_set_root_id) ?? properties.context_set_root_id;
    }
    const copiedMembership = (value: unknown) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return value;
      const membership = value as Record<string, unknown>;
      return {
        ...membership,
        ...(typeof membership.contextSetId === "string" ? { contextSetId: contextId(membership.contextSetId) } : {}),
        ...(typeof membership.context_set_id === "string" ? { context_set_id: contextId(membership.context_set_id) } : {}),
      };
    };
    if (Array.isArray(properties.combined_context_memberships)) {
      properties.combined_context_memberships = properties.combined_context_memberships.map(copiedMembership);
    }
    if (properties.combined_context) {
      properties.combined_context = copiedMembership(properties.combined_context);
    }

    if (block.type === "action" && Array.isArray(properties.block_references)) {
      const references = normalizeActionBlockReferences(properties.block_references)
        .flatMap((reference) => {
          const target = blockIds.get(reference.block_id);
          return target ? [{ ...reference, block_id: target }] : [];
        });
      properties.block_references = [];
      if (references.length) {
        deferredActionReferences.push({
          type: "BlockPropertyEdited",
          payload: {
            project_id: source.projectId,
            document_id: documentId,
            block_id: blockIds.get(block.id),
            property_path: "block_references",
            old_value: [],
            new_value: references,
            source_surface: "project-document-duplicate",
          },
        });
      }
    }

    events.push({
      type: "BlockCreated",
      payload: {
        project_id: source.projectId,
        document_id: documentId,
        block_id: blockIds.get(block.id),
        copied_from_block_id: block.id,
        type: copied.type,
        handle: block.handle,
        position: block.position,
        properties,
        source_surface: "project-document-duplicate",
      },
    });
  }
  events.push(...deferredActionReferences);

  const relations = input.projection.libraryBlockRelations.filter((relation) =>
    !relation.removed && relation.documentId === source.id && relation.projectId === source.projectId
    && blockIds.has(relation.fromBlockId) && blockIds.has(relation.toBlockId),
  );
  for (const relation of relations) {
    const properties = { ...relation.properties };
    if (properties.context_set_id) properties.context_set_id = contextId(properties.context_set_id);
    events.push({
      type: "BlockRelationAdded",
      payload: {
        project_id: source.projectId,
        document_id: documentId,
        relation_id: createId(),
        from_block_id: blockIds.get(relation.fromBlockId),
        to_block_id: blockIds.get(relation.toBlockId),
        kind: relation.kind,
        properties,
        copied_from_relation_id: relation.id,
        source_surface: "project-document-duplicate",
      },
    });
  }

  for (const block of blocks.filter((candidate) => candidate.locked)) {
    events.push({
      type: "BlockLocked",
      payload: {
        project_id: source.projectId,
        document_id: documentId,
        block_id: blockIds.get(block.id),
        source_surface: "project-document-duplicate",
      },
    });
  }

  const membership = input.projection.membership[source.id];
  if (membership && input.projection.collections.some((collection) =>
    collection.id === membership.collectionId && collection.projectId === source.projectId && !collection.removed,
  )) {
    events.push({
      type: "CollectionItemAdded",
      payload: {
        project_id: source.projectId,
        collection_id: membership.collectionId,
        item_ref: { document_id: documentId },
        position: membership.position,
        source_surface: "project-document-duplicate",
      },
    });
  }

  return { documentId, title, blockCount: blocks.length, relationCount: relations.length, events };
}

import type { CreativeProjection } from "./events.ts";
import { mediaKeyMatchesOwnerNamespace } from "./media-ownership.ts";

export type DocumentShareScope = {
  resourceKind: "document";
  resourceId: string;
  projectId: string;
  ownerId: string;
  mediaKeys: string[];
};

/** Only canonical, owner-scoped local objects may become shareable media. */
export function ownedMediaKey(value: unknown, ownerId: string): string | null {
  if (typeof value !== "string" || !value.startsWith("/api/media/")) return null;
  try {
    const key = decodeURIComponent(value.slice("/api/media/".length));
    return mediaKeyMatchesOwnerNamespace(key, ownerId) ? key : null;
  } catch {
    return null;
  }
}

/** Freeze the exact object set visible when the immutable document share is created. */
export function documentShareScope(projection: CreativeProjection, ownerId: string, documentId: string, projectId: string): DocumentShareScope | null {
  if (!documentId || !projectId || projection.documentId !== documentId || projection.projectId !== projectId) return null;
  if (!projection.documents.some((document) => document.id === documentId && document.projectId === projectId)) return null;

  const candidates = [
    ...projection.blocks.map((block) => block.properties.media_url),
    ...projection.blocks.flatMap((block) => {
      const structure = block.properties.artifact_structure;
      if (!structure || typeof structure !== "object" || Array.isArray(structure)) return [];
      const items = (structure as Record<string, unknown>).items;
      return Array.isArray(items) ? items.map((item) => item && typeof item === "object" ? (item as Record<string, unknown>).media_url : null) : [];
    }),
    ...projection.outputs.map((output) => output.mediaUrl),
    ...projection.artifacts.flatMap((artifact) => [artifact.mediaUrl, ...artifact.items.map((item) => item.mediaUrl)]),
  ];
  const mediaKeys = [...new Set(candidates.map((value) => ownedMediaKey(value, ownerId)).filter((value): value is string => Boolean(value)))].sort();
  return { resourceKind: "document", resourceId: documentId, projectId, ownerId, mediaKeys };
}

export function shareAllowsMedia(scope: Pick<DocumentShareScope, "ownerId" | "mediaKeys">, key: string) {
  return mediaKeyMatchesOwnerNamespace(key, scope.ownerId) && scope.mediaKeys.includes(key);
}

/** Remove private references and rewrite only explicitly authorized object URLs. */
export function sanitizeSharedValue(value: unknown, scope: Pick<DocumentShareScope, "ownerId" | "mediaKeys">, token: string, mediaReference = false): unknown {
  if (typeof value === "string" && value.startsWith("/api/media/")) {
    const key = ownedMediaKey(value, scope.ownerId);
    return key && shareAllowsMedia(scope, key) ? `/api/shared/${encodeURIComponent(token)}/media/${encodeURIComponent(key)}` : null;
  }
  if (typeof value === "string" && mediaReference) return null;
  if (Array.isArray(value)) return value.map((item) => sanitizeSharedValue(item, scope, token, mediaReference));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([key]) => {
      const normalized=key.replace(/([a-z\d])([A-Z])/g,"$1_$2").replace(/([A-Z]+)([A-Z][a-z])/g,"$1_$2").toLowerCase().replace(/_i_ds$/,"_ids");
      return !/(?:^|_)(?:content|prompt|intent|input)_?ref$/i.test(normalized)
        && !/(?:^|_)prompt(?:_|$)/.test(normalized)
        && !/(?:^|_)(?:model|adapter)(?:_id|_version)?$/.test(normalized)
        && !/(?:^|_)provider(?:$|_(?:id|name|model|request|receipt|job|status|response|cancel|url))/.test(normalized)
        && !/^(?:request_id|client_id|correlation_id|causation_id|scene_id|source_artifact_item_id)$/.test(normalized)
        && !/^(?:(?:source(?:_[a-z]+)*|context_(?:group|set)|block|claim|group)_ids?|source_(?:keys?|alias(?:es|_map)?))$/.test(normalized)
        && !/^organization_context_(?:source_block|package(?:_version|_binding)?)_ids?$/.test(normalized)
        && !/^(?:source|evidence)(?:_[a-z]+)*_refs?$/.test(normalized)
        && !/^source_block_versions?$/.test(normalized)
        && !/^(?:source|context)(?:_[a-z]+)*_fingerprints?$/.test(normalized);
    }).map(([key, item]) => [key, sanitizeSharedValue(item, scope, token, /^(?:media|image|thumbnail|preview|poster)_?url$/i.test(key))]));
  }
  return value;
}

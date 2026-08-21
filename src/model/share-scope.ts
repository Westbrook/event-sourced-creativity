import type { CreativeProjection } from "./events.ts";

export type DocumentShareScope = {
  resourceKind: "document";
  resourceId: string;
  projectId: string;
  ownerId: string;
  mediaKeys: string[];
};

const ownerNamespace = (ownerId: string) => ownerId.replace(/[^a-zA-Z0-9._-]/g, "-");

/** Only canonical, owner-scoped local objects may become shareable media. */
export function ownedMediaKey(value: unknown, ownerId: string): string | null {
  if (typeof value !== "string" || !value.startsWith("/api/media/")) return null;
  try {
    const key = decodeURIComponent(value.slice("/api/media/".length));
    return key.startsWith(`${ownerNamespace(ownerId)}/`) ? key : null;
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
    ...projection.outputs.map((output) => output.mediaUrl),
    ...projection.artifacts.flatMap((artifact) => [artifact.mediaUrl, ...artifact.items.map((item) => item.mediaUrl)]),
  ];
  const mediaKeys = [...new Set(candidates.map((value) => ownedMediaKey(value, ownerId)).filter((value): value is string => Boolean(value)))].sort();
  return { resourceKind: "document", resourceId: documentId, projectId, ownerId, mediaKeys };
}

export function shareAllowsMedia(scope: Pick<DocumentShareScope, "ownerId" | "mediaKeys">, key: string) {
  return key.startsWith(`${ownerNamespace(scope.ownerId)}/`) && scope.mediaKeys.includes(key);
}

/** Remove private references and rewrite only explicitly authorized object URLs. */
export function sanitizeSharedValue(value: unknown, scope: Pick<DocumentShareScope, "ownerId" | "mediaKeys">, token: string): unknown {
  if (typeof value === "string" && value.startsWith("/api/media/")) {
    const key = ownedMediaKey(value, scope.ownerId);
    return key && shareAllowsMedia(scope, key) ? `/api/shared/${encodeURIComponent(token)}/media/${encodeURIComponent(key)}` : null;
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeSharedValue(item, scope, token));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([key]) => !/(?:^|_)(?:content|prompt|intent|input)_?ref$/i.test(key)).map(([key, item]) => [key, sanitizeSharedValue(item, scope, token)]));
  }
  return value;
}

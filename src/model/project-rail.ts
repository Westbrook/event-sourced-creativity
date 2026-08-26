import type { CreativeDocument, CreativeProjection } from "./events.ts";
import { isDocumentViewRoute } from "./routes.ts";

type ProjectDocumentScope = Pick<CreativeProjection, "projectId" | "documentId" | "documents">;

const scopedDocuments = (projection: ProjectDocumentScope) => projection.documents.filter((document) =>
  document.projectId === projection.projectId && !document.removed,
);

/** Count only documents the current project is actually allowed to show. */
export function projectRailDocumentCount(projection: ProjectDocumentScope) {
  return scopedDocuments(projection).length;
}

/** Keep a project compass scoped to real, available documents without changing projection order. */
export function projectRailDocuments(projection: ProjectDocumentScope, limit = 4): CreativeDocument[] {
  if (limit <= 0) return [];

  const documents = scopedDocuments(projection);
  const current = documents.find((document) => document.id === projection.documentId);
  const remaining = documents.filter((document) => document.id !== projection.documentId);

  return (current ? [current, ...remaining] : remaining).slice(0, limit);
}

/** Preserve the caller's document lens; non-document surfaces intentionally return to the editor. */
export function projectRailDocumentDestination(route: string, requestedDestination?: string | null) {
  if (requestedDestination && isDocumentViewRoute(requestedDestination)) return requestedDestination;
  if (isDocumentViewRoute(route)) return route;
  return "/";
}

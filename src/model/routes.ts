export type DocumentView = "document" | "board" | "guided" | "layers" | "adaptive";

const legacyDocumentViews: Record<string, DocumentView> = {
  "/": "document",
  "/document": "document",
  "/studio/board": "board",
  "/studio/guided": "guided",
  "/studio/layers": "layers",
  "/studio/adaptive": "adaptive",
};

const routeUrl = (route: string) => new URL(route, "https://forma.local");
const documentViews = new Set<DocumentView>(["document", "board", "guided", "layers", "adaptive"]);

export function routePathname(route: string) {
  return routeUrl(route).pathname;
}

function documentRouteParts(route: string) {
  const url = routeUrl(route);
  const legacyView = legacyDocumentViews[url.pathname];
  if (legacyView) return { url, id: url.searchParams.get("document")?.trim() || null, slug: null, view: legacyView };
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "document" || !parts[1]) return null;
  const viewMarker = parts.indexOf("view", 2);
  const candidateView = viewMarker >= 0 ? parts[viewMarker + 1] : "document";
  const view = documentViews.has(candidateView as DocumentView) ? candidateView as DocumentView : "document";
  return {
    url,
    id: (() => { try { return decodeURIComponent(parts[1]); } catch { return parts[1]; } })(),
    slug: viewMarker === 3 ? parts[2] : viewMarker < 0 ? parts[2] ?? null : null,
    view,
  };
}

export function documentViewFromRoute(route: string): DocumentView | null {
  return documentRouteParts(route)?.view ?? null;
}

export function isDocumentViewRoute(route: string) {
  return documentRouteParts(route) !== null;
}

export function documentIdFromRoute(route: string) {
  return documentRouteParts(route)?.id ?? null;
}

export function documentSlug(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 64);
}

export function withDocumentInRoute(route: string, documentId: string, documentName = "") {
  const parts = documentRouteParts(route);
  if (!parts) return route;
  const slug = documentSlug(documentName);
  const viewSuffix = parts.view === "document" ? "" : `/view/${parts.view}`;
  parts.url.searchParams.delete("document");
  const path = `/document/${encodeURIComponent(documentId)}${slug ? `/${slug}` : ""}${viewSuffix}`;
  return `${path}${parts.url.search}${parts.url.hash}`;
}

export function documentEntryPath(route: string) {
  const view = documentViewFromRoute(route);
  if (!view || view === "document") return "/index.html";
  return `/studio/${view}/index.html`;
}

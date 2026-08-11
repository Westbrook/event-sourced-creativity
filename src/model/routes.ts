export type DocumentView = "document" | "board" | "guided" | "layers" | "adaptive" | "editor";
export type LibraryFocusKind = "block" | "output" | "family";
export type LibraryFocus = { kind: LibraryFocusKind; id: string };

const legacyDocumentViews: Record<string, DocumentView> = {
  "/": "document",
  "/document": "document",
  "/studio/board": "board",
  "/studio/guided": "guided",
  "/studio/layers": "layers",
  "/studio/adaptive": "adaptive",
  "/studio/editor": "editor",
};

const routeUrl = (route: string) => new URL(route, "https://forma.local");
const documentViews = new Set<DocumentView>(["document", "board", "guided", "layers", "adaptive", "editor"]);
const libraryFocusKinds = new Set<LibraryFocusKind>(["block", "output", "family"]);
const safeDecode = (value: string) => { try { return decodeURIComponent(value); } catch { return value; } };

export function routePathname(route: string) {
  return routeUrl(route).pathname;
}

function documentRouteParts(route: string) {
  const url = routeUrl(route);
  const focused = url.pathname.endsWith("/focus");
  const legacyPath = focused ? url.pathname.slice(0, -"/focus".length) || "/" : url.pathname;
  const legacyView = legacyDocumentViews[legacyPath];
  if (legacyView) return { url, id: url.searchParams.get("document")?.trim() || null, slug: null, view: legacyView, focused };
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "document" || !parts[1]) return null;
  const viewMarker = parts.indexOf("view", 2);
  const candidateView = viewMarker >= 0 ? parts[viewMarker + 1] : "document";
  const view = documentViews.has(candidateView as DocumentView) ? candidateView as DocumentView : "document";
  return {
    url,
    id: safeDecode(parts[1]),
    slug: viewMarker === 3 ? parts[2] : viewMarker < 0 && (!focused || parts.length > 3) ? parts[2] ?? null : null,
    view,
    focused,
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

export function documentFocusFromRoute(route: string) {
  return documentRouteParts(route)?.focused ?? false;
}

export function documentSlug(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 64);
}

export function libraryFocusFromRoute(route: string): LibraryFocus | null {
  const parts = routePathname(route).split("/").filter(Boolean);
  if (parts[0] !== "library" || !libraryFocusKinds.has(parts[1] as LibraryFocusKind) || !parts[2]) return null;
  return { kind: parts[1] as LibraryFocusKind, id: safeDecode(parts[2]) };
}

export function libraryFocusRoute(kind: LibraryFocusKind, id: string, label = "") {
  const slug = documentSlug(label);
  return `/library/${kind}/${encodeURIComponent(id)}${slug ? `/${slug}` : ""}`;
}

export function libraryRootRoute(route: string) {
  const url = routeUrl(route);
  return `/library${url.search}${url.hash}`;
}

export function withDocumentInRoute(route: string, documentId: string, documentName = "") {
  const parts = documentRouteParts(route);
  if (!parts) return route;
  const slug = documentSlug(documentName);
  const viewSuffix = parts.view === "document" ? slug === "focus" ? "/view/document" : "" : `/view/${parts.view}`;
  const focusSuffix = parts.focused ? "/focus" : "";
  parts.url.searchParams.delete("document");
  const path = `/document/${encodeURIComponent(documentId)}${slug ? `/${slug}` : ""}${viewSuffix}${focusSuffix}`;
  return `${path}${parts.url.search}${parts.url.hash}`;
}

export function withDocumentFocusInRoute(route: string, focused: boolean) {
  const parts = documentRouteParts(route);
  if (!parts || parts.focused === focused) return route;
  const path = focused ? `${parts.url.pathname.replace(/\/$/, "")}/focus` : parts.url.pathname.slice(0, -"/focus".length) || "/";
  return `${path}${parts.url.search}${parts.url.hash}`;
}

export function documentEntryPath(route: string) {
  const view = documentViewFromRoute(route);
  if (!view || view === "document") return "/index.html";
  return `/studio/${view}/index.html`;
}

export function appEntryPath(route: string) {
  const pathname = routePathname(route);
  if (pathname.startsWith("/library/")) return "/library/index.html";
  return documentEntryPath(route);
}

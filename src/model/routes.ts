export type DocumentView = "document" | "board" | "guided" | "layers" | "adaptive" | "editor" | "chat";
import type { ArtifactDeliveryIntent } from "./artifact-delivery.ts";

export type LibraryFocusKind = "block" | "output" | "artifact" | "family";
export type LibraryFocus = { kind: LibraryFocusKind; id: string };
export type LibraryBlockEditorTarget = { blockId: string | null };

const legacyDocumentViews: Record<string, DocumentView> = {
  "/": "document",
  "/document": "document",
  "/studio/board": "board",
  "/studio/guided": "guided",
  "/studio/layers": "layers",
  "/studio/adaptive": "adaptive",
  "/studio/editor": "editor",
  "/studio/chat": "chat",
};

const routeUrl = (route: string) => new URL(route, "https://forma.local");
const documentViews = new Set<DocumentView>(["document", "board", "guided", "layers", "adaptive", "editor", "chat"]);
const libraryFocusKinds = new Set<LibraryFocusKind>(["block", "output", "artifact", "family"]);
const safeDecode = (value: string) => { try { return decodeURIComponent(value); } catch { return value; } };

export function routePathname(route: string) {
  const pathname = routeUrl(route).pathname;
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}


/** Only project-scoped task views carry a Document context; this does not change Document-view or job-feed routing. */
export function isProjectTaskRoute(route: string) {
  const pathname = routePathname(route);
  if (pathname === "/deliver" || pathname === "/activity" || pathname === "/make/short-story") return true;
  const base = libraryBaseRoute(route);
  if (pathname === base) return true;
  if (!pathname.startsWith(base + "/")) return false;
  const parts = pathname.slice(base.length + 1).split("/");
  return parts.every(Boolean) && ((parts.length === 2 || parts.length === 3) && Boolean(libraryFocusFromRoute(route))
    || parts.length === 3 && Boolean(libraryBlockEditorFromRoute(route)));
}

/** null means no task context; an empty string means an invalid/ambiguous claimed context, never a fallback. */
export function projectTaskDocumentIdFromRoute(route: string): string | null {
  if (!isProjectTaskRoute(route)) return null;
  const values = routeUrl(route).searchParams.getAll("document");
  return !values.length ? null : values.length === 1 ? values[0]! : "";
}

/** A view address only. An unavailable current task address may be carried, never promoted to authority. */
export function withProjectTaskDocumentInRoute(route: string, documentId: string, currentTaskRoute?: string) {
  if (!isProjectTaskRoute(route)) return route;
  const url = routeUrl(route);
  if (documentId) url.searchParams.set("document", documentId);
  else if (currentTaskRoute !== undefined) {
    if (!url.searchParams.has("document") && isProjectTaskRoute(currentTaskRoute))
      for (const value of routeUrl(currentTaskRoute).searchParams.getAll("document")) url.searchParams.append("document", value);
  } else url.searchParams.delete("document");
  return `${url.pathname}${url.search}${url.hash}`;
}

function documentRouteParts(route: string) {
  const url = routeUrl(route);
  const normalizedPath = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
  const focused = normalizedPath.endsWith("/focus");
  const legacyPath = focused ? normalizedPath.slice(0, -"/focus".length) || "/" : normalizedPath;
  const legacyView = legacyDocumentViews[legacyPath];
  if (legacyView) return { url, id: url.searchParams.get("document")?.trim() || null, slug: null, view: legacyView, focused };
  const parts = normalizedPath.split("/").filter(Boolean);
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

export function documentContextBlockFromRoute(route: string) {
  if (!isDocumentViewRoute(route)) return null;
  const hash = routeUrl(route).hash;
  const prefix = "#context=";
  return hash.startsWith(prefix) && hash.length > prefix.length ? safeDecode(hash.slice(prefix.length)) : null;
}

export function documentSlug(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 64);
}

export function libraryBaseRoute(route = "/library") {
  const path = routePathname(route);
  return path === "/canvas/library" || path.startsWith("/canvas/library/") ? "/canvas/library" : "/library";
}

export function libraryFocusFromRoute(route: string): LibraryFocus | null {
  const parts = routePathname(route).slice(libraryBaseRoute(route).length).split("/").filter(Boolean);
  if (!libraryFocusKinds.has(parts[0] as LibraryFocusKind) || !parts[1]) return null;
  return { kind: parts[0] as LibraryFocusKind, id: safeDecode(parts[1]) };
}

export function libraryFocusRoute(kind: LibraryFocusKind, id: string, label = "", currentRoute = "/library") {
  const slug = documentSlug(label);
  return withProjectTaskDocumentInRoute(`${libraryBaseRoute(currentRoute)}/${kind}/${encodeURIComponent(id)}${slug ? `/${slug}` : ""}`, documentIdFromRoute(currentRoute) ?? projectTaskDocumentIdFromRoute(currentRoute) ?? "", currentRoute);
}

export function libraryBlockEditorFromRoute(route: string): LibraryBlockEditorTarget | null {
  const parts = routePathname(route).slice(libraryBaseRoute(route).length).split("/").filter(Boolean);
  if (parts[0] !== "blocks" || parts[1] !== "editor") return null;
  const blockId = parts[2] && parts[2] !== "new" ? safeDecode(parts[2]) : null;
  return { blockId };
}

export function libraryBlockEditorRoute(blockId = "", currentRoute = "/library") {
  return withProjectTaskDocumentInRoute(`${libraryBaseRoute(currentRoute)}/blocks/editor/${blockId ? encodeURIComponent(blockId) : "new"}`, documentIdFromRoute(currentRoute) ?? projectTaskDocumentIdFromRoute(currentRoute) ?? "", currentRoute);
}

export function libraryRootRoute(route: string) {
  const url = routeUrl(route);
  return `${libraryBaseRoute(route)}${url.search}${url.hash}`;
}

export function withDocumentInRoute(route: string, documentId: string, documentName = "") {
  const parts = documentRouteParts(route);
  if (!parts) return route;
  if (!documentId.trim()) return "/projects";
  const slug = documentSlug(documentName);
  const viewSuffix = parts.view === "document" ? slug === "focus" ? "/view/document" : "" : `/view/${parts.view}`;
  const focusSuffix = parts.focused ? "/focus" : "";
  parts.url.searchParams.delete("document");
  const path = `/document/${encodeURIComponent(documentId)}${slug ? `/${slug}` : ""}${viewSuffix}${focusSuffix}`;
  return `${path}${parts.url.search}${parts.url.hash}`;
}

export function documentContextBlockRoute(documentId: string, documentName: string, blockId: string) {
  return `${withDocumentInRoute("/", documentId, documentName)}#context=${encodeURIComponent(blockId)}`;
}

export function withDocumentFocusInRoute(route: string, focused: boolean) {
  const parts = documentRouteParts(route);
  if (!parts || parts.focused === focused) return route;
  const path = focused ? `${parts.url.pathname.replace(/\/$/, "")}/focus` : parts.url.pathname.slice(0, -"/focus".length) || "/";
  return `${path}${parts.url.search}${parts.url.hash}`;
}

export function documentEntryPath(route: string) {
  const view = documentViewFromRoute(route);
  if (!view || view === "document") return "/";
  return `/studio/${view}/`;
}

export type ArtifactFocusOptions = { expectedRevision: number; expectedContentSha256?: string; intent: ArtifactDeliveryIntent };

/** A deep link names a revision; it never silently substitutes the newest output. */
export function artifactFocusRoute(
  artifactId: string, title: string, options: ArtifactFocusOptions, currentRoute = "/library",
) {
  const url = routeUrl(libraryFocusRoute("artifact", artifactId, title, currentRoute));
  url.searchParams.set("revision", String(options.expectedRevision));
  url.searchParams.set("intent", options.intent);
  if (options.expectedContentSha256) url.searchParams.set("sha256", options.expectedContentSha256);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function artifactFocusOptionsFromRoute(route: string): ArtifactFocusOptions | null | "invalid" {
  if (libraryFocusFromRoute(route)?.kind !== "artifact") return null;
  const query = routeUrl(route).searchParams;
  if (!["revision", "sha256", "intent"].some(key => query.has(key))) return null;
  const revision = query.get("revision"), intent = query.get("intent"), digest = query.get("sha256");
  if (["revision", "sha256", "intent"].some(key => query.getAll(key).length > 1)
    || revision === null || !/^(0|[1-9]\d*)$/.test(revision) || !Number.isSafeInteger(Number(revision))
    || !["inspect", "review", "export"].includes(intent ?? "") || digest !== null && !/^[a-f0-9]{64}$/.test(digest)) return "invalid";
  return { expectedRevision: Number(revision), intent: intent as ArtifactDeliveryIntent,
    ...(digest === null ? {} : { expectedContentSha256: digest }) };
}

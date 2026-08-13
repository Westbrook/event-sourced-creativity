export type ApplicationId = "creative" | "operations" | "laboratory";

export type ApplicationNavigationItem = {
  id: string;
  href: string;
  label: string;
  description: string;
};

export type ApplicationDefinition = {
  id: ApplicationId;
  label: string;
  description: string;
  home: string;
  entry: string;
  navigation: readonly ApplicationNavigationItem[];
};

export const CREATE_ROUTE_PREFIX = "/creative/create";

export const APPLICATIONS: readonly ApplicationDefinition[] = [
  {
    id: "creative",
    label: "Creative",
    description: "Projects, creation, context, re-entry, and creative intelligence",
    home: "/projects",
    entry: "src/apps/creative/entry.ts",
    navigation: [
      { id: "projects", href: "/projects", label: "Projects", description: "Choose a creative workspace" },
      { id: "create", href: "/", label: "Create", description: "Work in the current document" },
      { id: "library", href: "/library", label: "Library", description: "Reuse project context and outputs" },
      { id: "sessions", href: "/sessions", label: "Re-entry", description: "Resume witnessed work" },
      { id: "scout", href: "/scout", label: "Scout", description: "Investigate creative trajectories" },
      { id: "memory", href: "/memory", label: "Taste & time", description: "Manage preferences and resurfacing" },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    description: "Governance, health, permissions, and durable stream inspection",
    home: "/operations",
    entry: "src/apps/operations/entry.ts",
    navigation: [
      { id: "system", href: "/operations", label: "System & governance", description: "Policies, gates, and operational health" },
      { id: "stream", href: "/operations/events", label: "Durable stream", description: "Inspect immutable event envelopes" },
      { id: "permissions", href: "/operations/events/permissions", label: "Permissions", description: "Review producer and concurrency boundaries" },
    ],
  },
  {
    id: "laboratory",
    label: "Laboratory",
    description: "Controlled experiments over the same durable creative data",
    home: "/laboratory/replay",
    entry: "src/apps/laboratory/entry.ts",
    navigation: [
      { id: "replay", href: "/laboratory/replay", label: "Replay", description: "Rehearse theoretical and provider-backed workflows" },
      { id: "focal-points", href: "/laboratory/focal-points", label: "Focal points", description: "Compare image focal-point calculations" },
    ],
  },
] as const;

export const applicationDefinition = (id: ApplicationId) => APPLICATIONS.find((application) => application.id === id)!;

export function applicationIdFromRoute(route: string): ApplicationId {
  const path = new URL(route, "https://forma.local").pathname.replace(/\/+$/, "") || "/";
  if (path.startsWith("/laboratory") || path === "/system/focal-points" || path === "/admin/events/replay") return "laboratory";
  if (path.startsWith("/operations") || path === "/system" || path === "/admin/events" || path === "/admin/events/stream" || path === "/admin/events/permissions") return "operations";
  return "creative";
}

export function applicationEntryPath(route: string) {
  const id = applicationIdFromRoute(route);
  return id === "operations" ? "/operations/" : id === "laboratory" ? "/laboratory/" : "/creative/";
}

export function navigationItemActive(applicationId: ApplicationId, itemId: string, route: string) {
  const path = new URL(route, "https://forma.local").pathname.replace(/\/+$/, "") || "/";
  if (applicationId === "creative") {
    if (itemId === "projects") return path.startsWith("/projects") || path.startsWith("/studio/project") || path === "/creative";
    if (itemId === "create") return path === "/" || path === "/document" || path.startsWith("/document/") || (path.startsWith("/studio/") && !path.startsWith("/studio/project")) || path.startsWith(CREATE_ROUTE_PREFIX);
    return path === `/${itemId}` || path.startsWith(`/${itemId}/`);
  }
  if (applicationId === "operations") {
    if (itemId === "system") return path === "/operations" || path === "/system";
    if (itemId === "stream") return path === "/operations/events" || path === "/operations/events/stream" || path === "/admin/events" || path === "/admin/events/stream";
    return path === "/operations/events/permissions" || path === "/admin/events/permissions";
  }
  if (itemId === "replay") return path === "/laboratory" || path === "/laboratory/replay" || path === "/admin/events/replay";
  return path === "/laboratory/focal-points" || path === "/system/focal-points";
}

export type SiteRouteEntry = {
  path: string;
  application: ApplicationId;
  module: string;
  title: string;
  description: string;
};

const route = (path: string, application: ApplicationId, title: string, description: string): SiteRouteEntry => ({
  path,
  application,
  module: applicationDefinition(application).entry,
  title,
  description,
});

export const SITE_ROUTE_ENTRIES: readonly SiteRouteEntry[] = [
  route("/", "creative", "Create — Forma", "Shape a durable creative document through replayable context and visual generation."),
  route("/creative", "creative", "Creative — Forma", "Open projects, create visual work, and manage reusable creative context."),
  route("/creative/create", "creative", "Create — Forma", "Shape the current durable creative document."),
  route("/document", "creative", "Document — Forma", "Open a durable creative document."),
  route("/projects", "creative", "Projects — Forma", "Open and manage creative projects."),
  route("/studio/project", "creative", "Project overview — Forma", "Review every collection and document in the current project."),
  route("/studio/board", "creative", "Context board — Forma", "Arrange replayable creative context as a spatial working board."),
  route("/studio/guided", "creative", "Guided brief — Forma", "Turn a guided creative interview into structured context."),
  route("/studio/layers", "creative", "Reality layers — Forma", "Compose context as independently controlled reality layers."),
  route("/studio/adaptive", "creative", "Adaptive path — Forma", "Build context through an interface that responds to intent."),
  route("/studio/editor", "creative", "Creative editor — Forma", "Shape a complete document through a focused editor."),
  route("/studio/chat", "creative", "Chat — Forma", "Shape a complete document through conversation and visual generation."),
  route("/library", "creative", "Project library — Forma", "Review reusable context, recent outputs, and aesthetic families."),
  route("/sessions", "creative", "Re-entry — Forma", "Resume witnessed work through event-derived re-entry briefs."),
  route("/scout", "creative", "Scout — Forma", "Run bounded creative research and inspect its evidence."),
  route("/memory", "creative", "Taste & time — Forma", "Review reversible preferences, taste evidence, and time-based memory."),
  route("/share", "creative", "Shared creative context — Forma", "Open an expiring, read-only creative context handoff."),
  route("/operations", "operations", "Operations — Forma", "Review governance, system health, and operational gates."),
  route("/operations/events", "operations", "Durable stream — Forma", "Inspect immutable event envelopes and projections."),
  route("/operations/events/stream", "operations", "Durable stream — Forma", "Inspect immutable event envelopes and projections."),
  route("/operations/events/permissions", "operations", "Producer permissions — Forma", "Review producer permissions and concurrency behavior."),
  route("/system", "operations", "System & governance — Forma", "Review governance, evaluation gates, privacy, and system health."),
  route("/admin/events", "operations", "Event operations — Forma", "Inspect the durable creative event stream."),
  route("/admin/events/stream", "operations", "Durable stream — Forma", "Inspect immutable event envelopes and payloads."),
  route("/admin/events/permissions", "operations", "Producer permissions — Forma", "Review event producer permissions and concurrency behavior."),
  route("/laboratory", "laboratory", "Laboratory — Forma", "Run controlled experiments over durable creative data."),
  route("/laboratory/replay", "laboratory", "Replay laboratory — Forma", "Build and replay theoretical and provider-backed creative event streams."),
  route("/laboratory/focal-points", "laboratory", "Focal-point laboratory — Forma", "Compare focal-point calculations and image containment."),
  route("/system/focal-points", "laboratory", "Focal-point laboratory — Forma", "Compare focal-point calculations and image containment."),
  route("/admin/events/replay", "laboratory", "Replay laboratory — Forma", "Build and replay theoretical and provider-backed creative event streams."),
] as const;

export type ServerRouteResolution = {
  application: ApplicationId;
  entryPath: string;
  canonicalFamily: string;
};

const directoryEntry = (path: string) => path === "/" ? "/" : `${path.replace(/\/+$/, "")}/`;

/**
 * The server owns the complete public navigation vocabulary. Dynamic IDs and
 * optional slugs select a prebuilt application/view entry before the client
 * router hydrates; unknown paths are not silently treated as SPA pages.
 */
export function resolveServerRoute(routeValue: string): ServerRouteResolution | null {
  const path = new URL(routeValue, "https://forma.local").pathname.replace(/\/+$/, "") || "/";
  const named = SITE_ROUTE_ENTRIES.find((entry) => entry.path === path);
  if (named) return { application: named.application, entryPath: directoryEntry(named.path), canonicalFamily: named.path };

  const documentMatch = path.match(/^\/document\/[^/]+(?:\/[^/]+)?(?:\/view\/(document|board|guided|layers|adaptive|editor|chat))?(?:\/focus)?$/);
  if (documentMatch) {
    const view = documentMatch[1] ?? "document";
    const entryPath = view === "document" ? "/" : `/studio/${view}/`;
    return { application: "creative", entryPath, canonicalFamily: `/document/:document${view === "document" ? "" : `/view/${view}`}` };
  }

  const legacyDocumentMatch = path.match(/^\/studio\/(board|guided|layers|adaptive|editor|chat)\/focus$/);
  if (legacyDocumentMatch) return { application: "creative", entryPath: `/studio/${legacyDocumentMatch[1]}/`, canonicalFamily: `/studio/${legacyDocumentMatch[1]}/focus` };

  if (/^\/share\/[^/]+$/.test(path)) return { application: "creative", entryPath: "/share/", canonicalFamily: "/share/:token" };
  if (/^\/library\/(?:block|output|family)\/[^/]+(?:\/[^/]+)?$/.test(path)) return { application: "creative", entryPath: "/library/", canonicalFamily: "/library/:focus/:id" };
  if (/^\/library\/blocks\/editor\/(?:new|[^/]+)$/.test(path)) return { application: "creative", entryPath: "/library/", canonicalFamily: "/library/blocks/editor/:id" };
  if (/^\/creative\/create(?:\/[^/]+)*$/.test(path)) return { application: "creative", entryPath: "/creative/create/", canonicalFamily: "/creative/create/*" };
  if (/^\/projects(?:\/[^/]+)*$/.test(path)) return { application: "creative", entryPath: "/projects/", canonicalFamily: "/projects/*" };
  if (/^\/studio\/project(?:\/[^/]+)*$/.test(path)) return { application: "creative", entryPath: "/studio/project/", canonicalFamily: "/studio/project/*" };
  if (/^\/(?:operations|laboratory)(?:\/[^/]+)*$/.test(path)) {
    const application = path.startsWith("/operations") ? "operations" : "laboratory";
    return { application, entryPath: applicationEntryPath(path), canonicalFamily: `/${application}/*` };
  }
  return null;
}

export type ApplicationId = "creative" | "canvas" | "operations" | "laboratory";
export type ApplicationAudience = "creator" | "platform-operator" | "product-quality" | "design-knowledge" | "engineering-diagnostics";
export type ApplicationRole = "admin" | "creator" | "agent" | "viewer";

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
  audiences: readonly ApplicationAudience[];
  administratorOnly: boolean;
  home: string;
  entry: string;
  navigation: readonly ApplicationNavigationItem[];
};

export type CreativeCreationContext = {
  projectId: string;
  documentId: string;
  documentTitle?: string;
  documents: readonly {
    id: string;
    projectId: string;
    title: string;
    removed?: boolean;
    createdSequence?: number;
  }[];
};

export const CREATE_ROUTE_PREFIX = "/creative/create";

export const APPLICATIONS: readonly ApplicationDefinition[] = [
  {
    id: "creative",
    label: "Creative",
    description: "Projects, creation, context, re-entry, and creative intelligence",
    audiences: ["creator"],
    administratorOnly: false,
    home: "/projects",
    entry: "src/apps/creative/entry.ts",
    navigation: [
      { id: "projects", href: "/projects", label: "Projects", description: "Choose a creative workspace" },
      { id: "create", href: "/", label: "Create", description: "Work in the current document" },
      { id: "library", href: "/library", label: "Library", description: "Reuse project context and outputs" },
      { id: "sessions", href: "/sessions", label: "Re-entry", description: "Resume witnessed work" },
      { id: "scout", href: "/scout", label: "Scout", description: "Investigate creative trajectories" },
      { id: "memory", href: "/memory", label: "Taste & time", description: "Manage preferences and resurfacing" },
      { id: "settings", href: "/settings", label: "Settings", description: "Manage your privacy, sharing, and personal production spending" },
    ],
  },
  {
    id: "canvas",
    label: "Canvas",
    description: "A spatial project workspace for documents, decisions, references, and every creative result",
    audiences: ["creator"],
    administratorOnly: false,
    home: "/canvas",
    entry: "src/apps/canvas/entry.ts",
    navigation: [
      { id: "canvases", href: "/canvas", label: "Canvases", description: "Arrange shared project context spatially" },
      { id: "proposals", href: "/canvas/proposals", label: "Report space", description: "Review agent arrangement proposals" },
      { id: "library", href: "/library", label: "Project library", description: "Open the shared blocks and outputs" },
      { id: "projects", href: "/projects", label: "Projects", description: "Switch the shared project" },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    description: "Governance, health, permissions, and durable stream inspection",
    audiences: ["platform-operator", "engineering-diagnostics"],
    administratorOnly: true,
    home: "/operations",
    entry: "src/apps/operations/entry.ts",
    navigation: [
      { id: "system", href: "/operations", label: "System & governance", description: "Policies, gates, and operational health" },
      { id: "analytics", href: "/operations/analytics", label: "Analytics", description: "Find product improvements and creative outcome evidence" },
      { id: "canvas", href: "/operations/canvas", label: "Canvas governance", description: "Review and approve Canvas release requirements" },
      { id: "stream", href: "/operations/events", label: "Durable stream", description: "Inspect immutable event envelopes" },
      { id: "permissions", href: "/operations/events/permissions", label: "Permissions", description: "Review producer and concurrency boundaries" },
      { id: "sync", href: "/operations/events/sync", label: "Canvas sync", description: "Inspect convergence, locks, queues, and formalized context" },
    ],
  },
  {
    id: "laboratory",
    label: "Laboratory",
    description: "Controlled experiments over the same durable creative data",
    audiences: ["product-quality", "design-knowledge"],
    administratorOnly: true,
    home: "/laboratory/replay",
    entry: "src/apps/laboratory/entry.ts",
    navigation: [
      { id: "replay", href: "/laboratory/replay", label: "Replay", description: "Rehearse theoretical and provider-backed workflows" },
      { id: "image-adapters", href: "/laboratory/image-adapters", label: "Image adapters", description: "Preview provider routing, capabilities, costs, and qualification" },
      { id: "focal-points", href: "/laboratory/focal-points", label: "Focal points", description: "Compare image focal-point calculations" },
      { id: "design-system", href: "/laboratory/design-system", label: "Design system", description: "Review foundations, components, workflows, and accessible interaction patterns" },
    ],
  },
] as const;

export const applicationDefinition = (id: ApplicationId) => APPLICATIONS.find((application) => application.id === id)!;

export type ApplicationAccess = {
  role: ApplicationRole | null | undefined;
  principalRole?: ApplicationRole | null;
  canvasAccess?: boolean;
};

/** Shared visibility contract; the Worker independently enforces privileged delivery. */
export function applicationAccessible(id: ApplicationId, access: ApplicationAccess) {
  if (!access.role) return false;
  const definition = applicationDefinition(id);
  if (definition.administratorOnly) return (access.principalRole ?? access.role) === "admin";
  if (id === "canvas") return access.canvasAccess === true;
  return true;
}

export function creativeCreationHref(
  context: CreativeCreationContext,
  documentHref: (documentId: string, documentTitle: string) => string,
) {
  if (!context.projectId.trim()) return "/projects";
  const projectDocuments = context.documents.filter((document) => !document.removed && document.projectId === context.projectId);
  const currentDocument = projectDocuments.find((document) => document.id === context.documentId);
  const document = currentDocument ?? [...projectDocuments].sort((left, right) => (right.createdSequence ?? 0) - (left.createdSequence ?? 0))[0];
  return document ? documentHref(document.id, document.title || context.documentTitle || "") : "/studio/project";
}

export function applicationIdFromRoute(route: string): ApplicationId {
  const path = new URL(route, "https://forma.local").pathname.replace(/\/+$/, "") || "/";
  if (path.startsWith("/canvas")) return "canvas";
  if (path.startsWith("/laboratory") || path === "/system/focal-points" || path === "/admin/events/replay") return "laboratory";
  if (path.startsWith("/operations") || path === "/system" || path === "/admin/events" || path === "/admin/events/stream" || path === "/admin/events/permissions" || path === "/admin/events/sync") return "operations";
  return "creative";
}

export function applicationEntryPath(route: string) {
  const id = applicationIdFromRoute(route);
  return id === "canvas" ? "/canvas/" : id === "operations" ? "/operations/" : id === "laboratory" ? "/laboratory/" : "/creative/";
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
    if (itemId === "analytics") return path === "/operations/analytics";
    if (itemId === "canvas") return path === "/operations/canvas";
    if (itemId === "stream") return path === "/operations/events" || path === "/operations/events/stream" || path === "/admin/events" || path === "/admin/events/stream";
    if(itemId==="permissions")return path === "/operations/events/permissions" || path === "/admin/events/permissions";
    return path === "/operations/events/sync" || path === "/admin/events/sync";
  }
  if (applicationId === "canvas") {
    if (itemId === "canvases") return path === "/canvas" || /^\/canvas\/(?!proposals(?:\/|$))/.test(path);
    if (itemId === "proposals") return path.startsWith("/canvas/proposals");
    return path === `/${itemId}` || path.startsWith(`/${itemId}/`);
  }
  if (itemId === "replay") return path === "/laboratory" || path === "/laboratory/replay" || path === "/admin/events/replay";
  if (itemId === "image-adapters") return path === "/laboratory/image-adapters";
  if (itemId === "design-system") return path === "/laboratory/design-system";
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
  route("/settings", "creative", "Personal settings — Forma", "Manage your own privacy, sharing, consent, and creative production spending."),
  route("/share", "creative", "Shared creative context — Forma", "Open an expiring, read-only creative context handoff."),
  route("/canvas", "canvas", "Canvas", "Arrange project context and creative results on a replayable infinite canvas."),
  route("/canvas/proposals", "canvas", "Canvas report space", "Review agent proposals without mixing them into authored work."),
  route("/operations", "operations", "Operations — Forma", "Review governance, system health, and operational gates."),
  route("/operations/analytics", "operations", "Product analytics — Forma", "Find product improvements, creative outcome evidence, cost, timing, and usage patterns in the durable event stream."),
  route("/operations/canvas", "operations", "Canvas governance — Forma", "Review the server-enforced Canvas pilot release gate and its approval evidence."),
  route("/operations/events", "operations", "Durable stream — Forma", "Inspect immutable event envelopes and projections."),
  route("/operations/events/stream", "operations", "Durable stream — Forma", "Inspect immutable event envelopes and projections."),
  route("/operations/events/permissions", "operations", "Producer permissions — Forma", "Review producer permissions and concurrency behavior."),
  route("/operations/events/sync", "operations", "Canvas sync — Forma", "Inspect Canvas convergence, project access, and offline delivery."),
  route("/system", "operations", "System & governance — Forma", "Review governance, evaluation gates, privacy, and system health."),
  route("/admin/events", "operations", "Event operations — Forma", "Inspect the durable creative event stream."),
  route("/admin/events/stream", "operations", "Durable stream — Forma", "Inspect immutable event envelopes and payloads."),
  route("/admin/events/permissions", "operations", "Producer permissions — Forma", "Review event producer permissions and concurrency behavior."),
  route("/admin/events/sync", "operations", "Canvas sync — Forma", "Inspect Canvas convergence, project access, and offline delivery."),
  route("/laboratory", "laboratory", "Laboratory — Forma", "Run controlled experiments over durable creative data."),
  route("/laboratory/replay", "laboratory", "Replay laboratory — Forma", "Build and replay theoretical and provider-backed creative event streams."),
  route("/laboratory/image-adapters", "laboratory", "Image-adapter laboratory — Forma", "Preview provider routing, capabilities, normalized receipts, costs, and qualification evidence without making paid calls."),
  route("/laboratory/focal-points", "laboratory", "Focal-point laboratory — Forma", "Compare focal-point calculations and image containment."),
  route("/laboratory/design-system", "laboratory", "Design system — Forma", "Explore accessible foundations, atomic components, workflow patterns, and complete application templates."),
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
  if (/^\/canvas\/proposals\/[^/]+$/.test(path)) return { application: "canvas", entryPath: "/canvas/proposals/", canonicalFamily: "/canvas/proposals/:proposal" };
  if (/^\/canvas\/[^/]+(?:\/[^/]+)?(?:\/view\/(?:spatial|list|compare|folders))?(?:\/focus)?$/.test(path)) return { application: "canvas", entryPath: "/canvas/", canonicalFamily: "/canvas/:canvas/:view" };
  if (/^\/library\/(?:block|output|artifact|family)\/[^/]+(?:\/[^/]+)?$/.test(path)) return { application: "creative", entryPath: "/library/", canonicalFamily: "/library/:focus/:id" };
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

import { PLATFORM_ADMIN_CAPABILITIES, type FormaCapability } from "./capabilities.ts";

export type ApplicationId = "creative" | "canvas" | "operations" | "product" | "knowledge" | "engineering";
export type ApplicationAudience = "creator" | "platform-operator" | "product-quality" | "design-knowledge" | "engineering-diagnostics";
export type ApplicationRole = "admin" | "creator" | "agent" | "viewer";

export type ApplicationNavigationItem = {
  id: string;
  href: string;
  label: string;
  description: string;
  requiredCapabilities?: readonly FormaCapability[];
};

export type ApplicationDefinition = {
  id: ApplicationId;
  label: string;
  description: string;
  audiences: readonly ApplicationAudience[];
  administratorOnly: boolean;
  requiredCapabilities: readonly FormaCapability[];
  sensitivity: "personal" | "project" | "internal" | "synthetic" | "restricted";
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
    label: "Creator Workspace",
    description: "Projects, creation, context, re-entry, and creative intelligence",
    audiences: ["creator"],
    administratorOnly: false,
    requiredCapabilities: [],
    sensitivity: "personal",
    home: "/projects",
    entry: "src/apps/creative/entry.ts",
    navigation: [
      { id: "projects", href: "/projects", label: "Projects", description: "Choose a creative workspace" },
      { id: "work", href: "/", label: "Work", description: "Continue shaping the current creative document" },
      { id: "explore", href: "/library", label: "Explore", description: "Discover reusable context, results, and creative intelligence" },
      { id: "activity", href: "/activity", label: "Activity", description: "Review project updates, assigned work, and your production activity" },
      { id: "deliver", href: "/deliver", label: "Deliver", description: "Review, present, and release completed creative work" },
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
    requiredCapabilities: ["project.canvas.use"],
    sensitivity: "project",
    home: "/canvas",
    entry: "src/apps/canvas/entry.ts",
    navigation: [
      { id: "canvases", href: "/canvas", label: "Canvases", description: "Arrange shared project context spatially" },
      { id: "proposals", href: "/canvas/proposals", label: "Report space", description: "Review agent arrangement proposals" },
      { id: "library", href: "/canvas/library", label: "Project library", description: "Open the same project blocks and outputs without leaving Canvas" },
      { id: "projects", href: "/canvas/projects", label: "Projects", description: "Choose a project without leaving Canvas" },
    ],
  },
  {
    id: "operations",
    label: "Platform Operations",
    description: "Platform access, provider policy, governed releases, and accountable operational decisions",
    audiences: ["platform-operator"],
    administratorOnly: false,
    requiredCapabilities: ["platform.identity.manage", "platform.policy.manage", "platform.provider.configure", "platform.release.approve", "platform.incident.manage"],
    sensitivity: "restricted",
    home: "/operations",
    entry: "src/apps/operations/entry.ts",
    navigation: [
      { id: "system", href: "/operations", label: "Overview", description: "Platform governance and service status", requiredCapabilities: ["platform.policy.manage", "platform.incident.manage"] },
      { id: "providers", href: "/operations/providers", label: "Providers", description: "Review approved provider configuration", requiredCapabilities: ["platform.provider.configure"] },
      { id: "release", href: "/operations/canvas", label: "Release gates", description: "Review and approve controlled production releases", requiredCapabilities: ["platform.release.approve", "platform.policy.manage"] },
      { id: "access", href: "/operations/access", label: "Access", description: "Manage explicit specialist privileges", requiredCapabilities: ["platform.identity.manage"] },
    ],
  },
  {
    id: "product",
    label: "Product & Quality",
    description: "Privacy-preserving product outcomes, delivery readiness, and controlled evaluation",
    audiences: ["product-quality"],
    administratorOnly: false,
    requiredCapabilities: ["product.analytics.read", "product.delivery.read", "product.delivery.manage", "product.release.read", "evaluation.synthetic.read", "evaluation.synthetic.run", "evaluation.qualification.read", "evaluation.qualification.run"],
    sensitivity: "internal",
    home: "/product",
    entry: "src/apps/product/entry.ts",
    navigation: [
      { id: "insights", href: "/product/insights", label: "Insights", description: "Review anonymous product outcomes and creator friction", requiredCapabilities: ["product.analytics.read"] },
      { id: "delivery", href: "/product/delivery", label: "Delivery", description: "Inspect owned decisions, blockers, and evidence gates", requiredCapabilities: ["product.delivery.read", "product.delivery.manage", "product.release.read"] },
      { id: "evaluation", href: "/product/evaluation", label: "Evaluation", description: "Review controlled synthetic evaluation and qualification", requiredCapabilities: ["evaluation.synthetic.read", "evaluation.synthetic.run", "evaluation.qualification.read", "evaluation.qualification.run"] },
    ],
  },
  {
    id: "knowledge",
    label: "Design & Knowledge",
    description: "Approved design guidance, component contracts, and safely isolated fictional examples",
    audiences: ["design-knowledge"],
    administratorOnly: false,
    requiredCapabilities: ["design.catalog.read", "design.docs.read"],
    sensitivity: "synthetic",
    home: "/knowledge",
    entry: "src/apps/knowledge/entry.ts",
    navigation: [
      { id: "components", href: "/knowledge/design-system", label: "Components", description: "Explore production components using fictional examples only", requiredCapabilities: ["design.catalog.read"] },
      { id: "patterns", href: "/knowledge/patterns", label: "Patterns", description: "Review accessible interaction and composition patterns", requiredCapabilities: ["design.catalog.read", "design.docs.read"] },
      { id: "guidance", href: "/knowledge/guidance", label: "Guidance", description: "Read approved product, localization, and accessibility guidance", requiredCapabilities: ["design.docs.read"] },
      { id: "landing-pages", href: "/knowledge/landing-pages", label: "Landing page catalog", description: "Explore four audience-specific landing pages, each available in every supported language.", requiredCapabilities: ["design.catalog.read", "design.docs.read"] },
    ],
  },
  {
    id: "engineering",
    label: "Engineering Diagnostics",
    description: "Redacted service health, event integrity, project synchronization, and job reliability",
    audiences: ["engineering-diagnostics"],
    administratorOnly: false,
    requiredCapabilities: ["engineering.diagnostics.read", "engineering.events.read", "engineering.sync.read"],
    sensitivity: "restricted",
    home: "/engineering",
    entry: "src/apps/engineering/entry.ts",
    navigation: [
      { id: "health", href: "/engineering", label: "Health", description: "Review bounded service health and reliability evidence", requiredCapabilities: ["engineering.diagnostics.read"] },
      { id: "events", href: "/engineering/events", label: "Events", description: "Inspect redacted event and projection integrity", requiredCapabilities: ["engineering.events.read"] },
      { id: "sync", href: "/engineering/sync", label: "Synchronization", description: "Diagnose scoped offline delivery and synchronization", requiredCapabilities: ["engineering.sync.read"] },
      { id: "jobs", href: "/engineering/jobs", label: "Jobs", description: "Review operational job status without customer content", requiredCapabilities: ["engineering.diagnostics.read"] },
    ],
  },
] as const;

export const applicationDefinition = (id: ApplicationId) => APPLICATIONS.find((application) => application.id === id)!;

export type ApplicationAccess = {
  role: ApplicationRole | null | undefined;
  principalRole?: ApplicationRole | null;
  canvasAccess?: boolean;
  capabilities?: readonly FormaCapability[];
};

/** Shared visibility contract; the Worker independently enforces privileged delivery. */
export function applicationAccessible(id: ApplicationId, access: ApplicationAccess) {
  if (!access.role) return false;
  const definition = applicationDefinition(id);
  if (id === "canvas") return access.canvasAccess === true;
  if (!definition.requiredCapabilities.length) return true;
  const capabilities = access.capabilities ?? ((access.principalRole ?? access.role) === "admin" ? PLATFORM_ADMIN_CAPABILITIES : []);
  return definition.requiredCapabilities.some((capability) => capabilities.includes(capability));
}

export function navigationItemAccessible(item: ApplicationNavigationItem, access: ApplicationAccess) {
  if (!item.requiredCapabilities?.length) return true;
  const capabilities = access.capabilities ?? ((access.principalRole ?? access.role) === "admin" ? PLATFORM_ADMIN_CAPABILITIES : []);
  return item.requiredCapabilities.some((capability) => capabilities.includes(capability));
}

/** A specialist always lands on a task authorized for their actual grant. */
export function authorizedApplicationHome(id:ApplicationId,access:ApplicationAccess){
  const application=applicationDefinition(id);
  if(id==="creative"||id==="canvas")return application.home;
  return application.navigation.find((item)=>navigationItemAccessible(item,access))?.href??application.home;
}

/** Aliases inherit the destination task's exact policy, never a broader legacy application role. */
export function routeRequiredCapabilities(route: string): readonly FormaCapability[] {
  const path = new URL(route, "https://forma.local").pathname.replace(/\/+$/, "") || "/";
  const application = applicationIdFromRoute(path);
  if (application === "creative") return [];
  if (application === "canvas") return ["project.canvas.use"];
  if (application === "operations") {
    if(path==="/system")return ["platform.policy.manage","platform.incident.manage"];
    if (path === "/operations/access") return ["platform.identity.manage"];
    if (path === "/operations/providers") return ["platform.provider.configure"];
    if (path === "/operations/canvas") return ["platform.release.approve", "platform.policy.manage"];
  }
  if (application === "product") {
    if (path === "/product/insights" || path === "/operations/analytics") return ["product.analytics.read"];
    if (path === "/product/delivery") return ["product.delivery.read", "product.delivery.manage", "product.release.read"];
    if (path === "/product/evaluation/actual" || path === "/admin/events/replay") return ["evaluation.actual.run"];
    if (path === "/product/evaluation/replay" || path === "/laboratory/replay") return ["evaluation.synthetic.read", "evaluation.synthetic.run"];
    if (path === "/product/evaluation/adapters" || path === "/laboratory/image-adapters") return ["evaluation.qualification.read", "evaluation.qualification.run"];
    if (path !== "/product") return ["evaluation.synthetic.read", "evaluation.synthetic.run", "evaluation.qualification.read", "evaluation.qualification.run"];
  }
  if (application === "knowledge") {
    if (path === "/knowledge/landing-pages") return ["design.catalog.read", "design.docs.read"];
    if (path === "/knowledge/guidance") return ["design.docs.read"];
    if (path === "/knowledge/design-system" || path === "/knowledge/focal-points" || path === "/laboratory/design-system" || path === "/laboratory/focal-points" || path === "/system/focal-points") return ["design.catalog.read"];
  }
  if (application === "engineering") {
    if(path==="/engineering")return applicationDefinition(application).requiredCapabilities;
    if (path.endsWith("/sync")) return ["engineering.sync.read"];
    if (path.includes("/events") || path === "/admin/events") return ["engineering.events.read"];
    return ["engineering.diagnostics.read"];
  }
  return applicationDefinition(application).requiredCapabilities;
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
  if (path === "/operations/analytics" || path === "/admin/events/replay" || path === "/laboratory" || path === "/laboratory/replay" || path === "/laboratory/image-adapters" || path.startsWith("/product")) return "product";
  if (path === "/laboratory/design-system" || path === "/laboratory/focal-points" || path === "/system/focal-points" || path.startsWith("/knowledge")) return "knowledge";
  if (path.startsWith("/engineering") || path.startsWith("/operations/events") || path === "/admin/events" || path === "/admin/events/stream" || path === "/admin/events/permissions" || path === "/admin/events/sync") return "engineering";
  if (path.startsWith("/operations") || path === "/system") return "operations";
  return "creative";
}

export function applicationEntryPath(route: string) {
  const id = applicationIdFromRoute(route);
  return id === "creative" ? "/creative/" : `/${id}/`;
}

export function navigationItemActive(applicationId: ApplicationId, itemId: string, route: string) {
  const path = new URL(route, "https://forma.local").pathname.replace(/\/+$/, "") || "/";
  if (applicationId === "creative") {
    if (itemId === "projects") return path.startsWith("/projects") || path.startsWith("/studio/project") || path === "/creative";
    if (itemId === "work" || itemId === "create") return path === "/" || path === "/document" || path.startsWith("/document/") || (path.startsWith("/studio/") && !path.startsWith("/studio/project")) || path.startsWith(CREATE_ROUTE_PREFIX);
    if (itemId === "explore") return /^\/(?:library|scout|memory)(?:\/|$)/.test(path);
    if (itemId === "activity") return /^\/(?:activity|sessions)(?:\/|$)/.test(path);
    return path === `/${itemId}` || path.startsWith(`/${itemId}/`);
  }
  if (applicationId === "operations") {
    if (itemId === "system") return path === "/operations" || path === "/system";
    if (itemId === "release") return path === "/operations/canvas";
    return path === `/operations/${itemId}` || path.startsWith(`/operations/${itemId}/`);
  }
  if (applicationId === "canvas") {
    if (itemId === "canvases") return path === "/canvas" || /^\/canvas\/(?!(?:proposals|projects|library)(?:\/|$))/.test(path);
    if (itemId === "proposals") return path.startsWith("/canvas/proposals");
    return path === `/canvas/${itemId}` || path.startsWith(`/canvas/${itemId}/`);
  }
  if (applicationId === "product") {
    if (itemId === "insights") return path === "/product" || path === "/product/insights" || path === "/operations/analytics";
    if (itemId === "evaluation") return path.startsWith("/product/evaluation") || path === "/admin/events/replay" || path === "/laboratory" || path === "/laboratory/replay" || path === "/laboratory/image-adapters";
    return path === `/product/${itemId}`;
  }
  if (applicationId === "knowledge") {
    if (itemId === "components") return path === "/knowledge" || path === "/knowledge/design-system" || path === "/laboratory/design-system";
    return path === `/knowledge/${itemId}` || itemId === "patterns" && (path === "/knowledge/focal-points" || path === "/laboratory/focal-points" || path === "/system/focal-points");
  }
  if (itemId === "health") return path === "/engineering";
  if (itemId === "events") return path.startsWith("/engineering/events") || path.startsWith("/operations/events") && !path.endsWith("/sync") || path.startsWith("/admin/events") && !path.endsWith("/sync");
  if (itemId === "sync") return path === "/engineering/sync" || path === "/operations/events/sync" || path === "/admin/events/sync";
  return path === `/engineering/${itemId}`;
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
  route("/activity", "creative", "Activity — Forma", "Track authorized creative work, project updates, and assigned reviews."),
  route("/deliver", "creative", "Deliver — Forma", "Review and present completed outputs from the current project."),
  route("/sessions", "creative", "Re-entry — Forma", "Resume witnessed work through event-derived re-entry briefs."),
  route("/scout", "creative", "Scout — Forma", "Run bounded creative research and inspect its evidence."),
  route("/memory", "creative", "Taste & time — Forma", "Review reversible preferences, taste evidence, and time-based memory."),
  route("/settings", "creative", "Personal settings — Forma", "Manage your own privacy, sharing, consent, and creative production spending."),
  route("/share", "creative", "Shared creative context — Forma", "Open an expiring, read-only creative context handoff."),
  route("/canvas", "canvas", "Canvas", "Arrange project context and creative results on a replayable infinite canvas."),
  route("/canvas/proposals", "canvas", "Canvas report space", "Review agent proposals without mixing them into authored work."),
  route("/canvas/projects", "canvas", "Projects — Canvas — Forma", "Choose a shared creative project without leaving Canvas."),
  route("/canvas/library", "canvas", "Project library — Canvas — Forma", "Review the same project decisions and creative results without leaving Canvas."),
  route("/operations", "operations", "Platform Operations — Forma", "Review platform governance, service health, and operational decisions."),
  route("/operations/providers", "operations", "Provider policy — Forma", "Review approved provider policy and operational readiness."),
  route("/operations/access", "operations", "Platform access — Forma", "Manage explicit, revocable specialist capabilities."),
  route("/operations/canvas", "operations", "Canvas governance — Forma", "Review the server-enforced Canvas pilot release gate and its approval evidence."),
  route("/system", "operations", "System & governance — Forma", "Review governance, evaluation gates, privacy, and system health."),
  route("/product", "product", "Product & Quality — Forma", "Make product, delivery, and evaluation decisions from approved role-safe evidence."),
  route("/product/insights", "product", "Product insights — Forma", "Review anonymous product outcomes and creator friction."),
  route("/product/delivery", "product", "Delivery readiness — Forma", "Inspect current release evidence, blockers, and ownership."),
  route("/product/evaluation", "product", "Evaluation — Forma", "Review controlled synthetic evaluation and qualification evidence."),
  route("/product/evaluation/replay", "product", "Synthetic replay — Forma", "Rehearse fictional application workflows without providers or customer data."),
  route("/product/evaluation/adapters", "product", "Adapter qualification — Forma", "Inspect authorized frozen qualification evidence."),
  route("/product/evaluation/actual", "product", "Restricted actual-data replay — Forma", "Review approved, owner-isolated saved replay sessions and reusable fictional personas."),
  route("/operations/analytics", "product", "Product insights — Forma", "Review privacy-preserving aggregate product outcomes."),
  route("/laboratory", "product", "Product evaluation — Forma", "Review controlled synthetic evaluation evidence."),
  route("/laboratory/replay", "product", "Product evaluation — Forma", "Review controlled evaluation and approved replay evidence."),
  route("/laboratory/image-adapters", "product", "Provider qualification — Forma", "Review approved adapter qualification evidence."),
  route("/admin/events/replay", "product", "Product evaluation — Forma", "Review controlled synthetic evaluation evidence."),
  route("/knowledge", "knowledge", "Design & Knowledge — Forma", "Explore approved design guidance and fictional examples."),
  route("/knowledge/design-system", "knowledge", "Design system — Forma", "Explore accessible production components using fictional data only."),
  route("/knowledge/patterns", "knowledge", "Interaction patterns — Forma", "Review accessible interaction and application patterns."),
  route("/knowledge/focal-points", "knowledge", "Focal-point comparison — Forma", "Compare image presentation methods using approved fictional examples only."),
  route("/knowledge/guidance", "knowledge", "Product guidance — Forma", "Review approved accessibility, localization, and delivery guidance."),
  route("/knowledge/landing-pages", "knowledge", "Landing page catalog — Forma", "Explore four audience-specific landing pages in every supported language."),
  route("/laboratory/design-system", "knowledge", "Design system — Forma", "Explore components without loading creator projects."),
  route("/laboratory/focal-points", "knowledge", "Synthetic image patterns — Forma", "Compare fictional image focal-point examples."),
  route("/system/focal-points", "knowledge", "Synthetic image patterns — Forma", "Compare fictional image focal-point examples."),
  route("/engineering", "engineering", "Engineering Diagnostics — Forma", "Inspect redacted operational reliability evidence."),
  route("/engineering/events", "engineering", "Event integrity — Forma", "Inspect redacted event and projection integrity."),
  route("/engineering/sync", "engineering", "Synchronization diagnostics — Forma", "Inspect scoped synchronization reliability."),
  route("/engineering/jobs", "engineering", "Job diagnostics — Forma", "Inspect redacted durable job health and recovery."),
  route("/operations/events", "engineering", "Event integrity — Forma", "Inspect authorized event and projection integrity."),
  route("/operations/events/stream", "engineering", "Event integrity — Forma", "Inspect authorized event and projection integrity."),
  route("/operations/events/permissions", "engineering", "Event permissions — Forma", "Inspect authorized producer boundaries."),
  route("/operations/events/sync", "engineering", "Synchronization diagnostics — Forma", "Inspect authorized synchronization reliability."),
  route("/admin/events", "engineering", "Event integrity — Forma", "Inspect authorized event and projection integrity."),
  route("/admin/events/stream", "engineering", "Event integrity — Forma", "Inspect authorized event and projection integrity."),
  route("/admin/events/permissions", "engineering", "Event permissions — Forma", "Inspect authorized producer boundaries."),
  route("/admin/events/sync", "engineering", "Synchronization diagnostics — Forma", "Inspect authorized synchronization reliability."),
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

  if (["/make/short-story", "/make/scene", "/make/slides"].includes(path)) return { application: "creative", entryPath: "/creative/", canonicalFamily: path };

  if(/^\/settings\/workspaces(?:\/(?:invitations|[^/]+(?:\/(?:overview|members|projects|usage|activity))?))?$/.test(path)){
    const family=path==="/settings/workspaces"?"/settings/workspaces":path==="/settings/workspaces/invitations"?"/settings/workspaces/invitations":"/settings/workspaces/:organization/:section";
    return{application:"creative",entryPath:"/settings/",canonicalFamily:family};
  }

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
  if (/^\/canvas\/projects\/[^/]+(?:\/[^/]+)*$/.test(path)) return { application: "canvas", entryPath: "/canvas/projects/", canonicalFamily: "/canvas/projects/*" };
  if (/^\/canvas\/library\/(?:block|output|artifact|family)\/[^/]+(?:\/[^/]+)?$/.test(path)) return { application: "canvas", entryPath: "/canvas/library/", canonicalFamily: "/canvas/library/:focus/:id" };
  if (/^\/canvas\/library\/blocks\/editor\/(?:new|[^/]+)$/.test(path)) return { application: "canvas", entryPath: "/canvas/library/", canonicalFamily: "/canvas/library/blocks/editor/:id" };
  if (/^\/canvas\/(?!(?:proposals|projects|library)(?:\/|$))[^/]+(?:\/[^/]+)?(?:\/view\/(?:spatial|list|compare|folders))?(?:\/focus)?$/.test(path)) return { application: "canvas", entryPath: "/canvas/", canonicalFamily: "/canvas/:canvas/:view" };
  if (/^\/library\/(?:block|output|artifact|family)\/[^/]+(?:\/[^/]+)?$/.test(path)) return { application: "creative", entryPath: "/library/", canonicalFamily: "/library/:focus/:id" };
  if (/^\/library\/blocks\/editor\/(?:new|[^/]+)$/.test(path)) return { application: "creative", entryPath: "/library/", canonicalFamily: "/library/blocks/editor/:id" };
  if (/^\/creative\/create(?:\/[^/]+)*$/.test(path)) return { application: "creative", entryPath: "/creative/create/", canonicalFamily: "/creative/create/*" };
  if (/^\/projects(?:\/[^/]+)*$/.test(path)) return { application: "creative", entryPath: "/projects/", canonicalFamily: "/projects/*" };
  if (/^\/studio\/project(?:\/[^/]+)*$/.test(path)) return { application: "creative", entryPath: "/studio/project/", canonicalFamily: "/studio/project/*" };
  return null;
}

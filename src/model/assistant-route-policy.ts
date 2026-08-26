import { canvasIdFromRoute } from "../canvas/routes.ts";
import { applicationIdFromRoute, resolveServerRoute, routeRequiredCapabilities, type ApplicationId } from "../platform/applications.ts";
import type { FormaCapability } from "../platform/capabilities.ts";
import { documentContextBlockFromRoute, documentIdFromRoute, documentViewFromRoute, libraryFocusFromRoute, routePathname } from "./routes.ts";

export type AssistantHost = "creator" | "platform" | "public";
export type AssistantPage =
  | "projects" | "document" | "board" | "guided" | "layers" | "adaptive" | "editor" | "chat"
  | "library" | "activity" | "deliver" | "sessions" | "scout" | "memory" | "settings"
  | "workspace" | "canvas" | "canvas-proposals" | "canvas-projects" | "canvas-library"
  | "operations" | "product" | "knowledge" | "engineering" | "public-share";

export type AssistantSurface = {
  route: string;
  canonicalFamily: string;
  application: ApplicationId;
  host: AssistantHost;
  page: AssistantPage;
  documentId: string | null;
  canvasId: string | null;
  focusedBlockId: string | null;
  focusedResourceId: string | null;
  requiredCapabilities: readonly FormaCapability[];
  available: boolean;
};

export const ASSISTANT_ROUTE_LIMITS = { pathname: 512, search: 192, hash: 64, identifier: 160 } as const;
const safeIdentifier = (value: string | null) => value && value.length <= ASSISTANT_ROUTE_LIMITS.identifier ? value : null;

/** Resolve user-visible location without accidentally treating public shares as Creator. */
export function assistantSurfaceForRoute(route: string): AssistantSurface {
  const pathname = routePathname(route);
  const routeUrl = new URL(route, "https://forma.local");
  const resolution = resolveServerRoute(pathname);
  const application = resolution?.application ?? applicationIdFromRoute(pathname);
  const share = pathname === "/share" || pathname.startsWith("/share/");
  const host: AssistantHost = share ? "public" : application === "creative" || application === "canvas" ? "creator" : "platform";
  const view = documentViewFromRoute(route);
  const focus = libraryFocusFromRoute(route);
  let page: AssistantPage;
  if (share) page = "public-share";
  else if (application === "canvas") {
    page = pathname.startsWith("/canvas/proposals") ? "canvas-proposals"
      : pathname.startsWith("/canvas/projects") ? "canvas-projects"
      : pathname.startsWith("/canvas/library") ? "canvas-library" : "canvas";
  } else if (application !== "creative") page = application;
  else if (pathname.startsWith("/settings/workspaces")) page = "workspace";
  else if (pathname === "/activity") page = "activity";
  else if (pathname === "/deliver") page = "deliver";
  else if (pathname === "/sessions") page = "sessions";
  else if (pathname === "/scout") page = "scout";
  else if (pathname === "/memory") page = "memory";
  else if (pathname.startsWith("/library")) page = "library";
  else if (pathname.startsWith("/projects") || pathname.startsWith("/studio/project")) page = "projects";
  else if (pathname.startsWith("/settings")) page = "settings";
  else page = view ?? "document";

  return {
    route: `${pathname.slice(0, ASSISTANT_ROUTE_LIMITS.pathname)}${routeUrl.search.slice(0, ASSISTANT_ROUTE_LIMITS.search)}${routeUrl.hash.slice(0, ASSISTANT_ROUTE_LIMITS.hash)}`,
    canonicalFamily: resolution?.canonicalFamily ?? "",
    application,
    host,
    page,
    documentId: safeIdentifier(documentIdFromRoute(route)),
    canvasId: safeIdentifier(canvasIdFromRoute(route)),
    focusedBlockId: safeIdentifier(documentContextBlockFromRoute(route) ?? (focus?.kind === "block" ? focus.id : null)),
    focusedResourceId: safeIdentifier(focus?.id ?? null),
    requiredCapabilities: share ? [] : routeRequiredCapabilities(route),
    available: Boolean(resolution) && !share && pathname.length <= ASSISTANT_ROUTE_LIMITS.pathname,
  };
}

/** Page playbooks remain declarative: suggestions never grant execution authority. */
export const ASSISTANT_PAGE_PLAYBOOKS: Record<AssistantPage, readonly string[]> = {
  projects: ["choose-project", "summarize-project", "continue-work"],
  document: ["summarize-context", "identify-missing-decisions", "propose-next-action"],
  board: ["explain-layout", "inspect-selected-context", "propose-next-action"],
  guided: ["explain-current-step", "identify-missing-decisions", "propose-next-action"],
  layers: ["explain-context-layers", "inspect-constraints", "propose-next-action"],
  adaptive: ["explain-suggestions", "separate-decisions", "propose-next-action"],
  editor: ["summarize-context", "inspect-source-evidence", "propose-next-action"],
  chat: ["summarize-context", "review-open-proposals", "propose-next-action"],
  library: ["find-reusable-context", "inspect-selected-resource", "propose-next-action"],
  activity: ["explain-recent-activity", "review-failed-work", "resume-authorized-work"],
  deliver: ["find-ready-results", "explain-review-status", "review-seven-output-formats"],
  sessions: ["summarize-unfinished-intent", "resume-authorized-work", "review-recent-decisions"],
  scout: ["explain-research", "review-scout-findings", "propose-next-action"],
  memory: ["explain-preferences", "inspect-consent", "review-recent-decisions"],
  settings: ["explain-privacy", "explain-spending", "review-access"],
  workspace: ["explain-workspace-policy", "review-access", "explain-spending"],
  canvas: ["inspect-selected-items", "explain-board", "review-arrangement"],
  "canvas-proposals": ["review-arrangement", "explain-proposed-changes", "inspect-approval"],
  "canvas-projects": ["choose-project", "summarize-project", "continue-work"],
  "canvas-library": ["find-reusable-context", "inspect-selected-resource", "inspect-selected-items"],
  operations: ["explain-service-health", "inspect-policy", "review-governed-actions"],
  product: ["summarize-approved-insights", "inspect-delivery-readiness", "review-evaluation"],
  knowledge: ["explain-approved-guidance", "inspect-component-contract", "review-accessibility"],
  engineering: ["explain-redacted-diagnostics", "inspect-service-health", "review-job-recovery"],
  "public-share": [],
};

/** Internal application pages receive task-specific guidance without loading any creative work. */
export const ASSISTANT_PLATFORM_ROUTE_PLAYBOOKS: Readonly<Record<string, readonly string[]>> = {
  "/operations": ["inspect-service-health", "review-operational-policy", "propose-authorized-navigation"],
  "/operations/providers": ["inspect-provider-policy", "explain-provider-readiness", "review-authorized-billing-recovery"],
  "/operations/access": ["explain-explicit-capabilities", "inspect-specialist-access", "review-revocation-controls"],
  "/operations/canvas": ["inspect-canvas-release-gates", "explain-approval-evidence", "review-authorized-rollout"],
  "/system": ["explain-governance-boundaries", "inspect-service-health", "review-release-approvals"],
  "/product": ["summarize-approved-product-evidence", "identify-delivery-priorities", "propose-authorized-navigation"],
  "/product/insights": ["inspect-privacy-safe-insights", "explain-creator-friction", "review-anonymous-outcomes"],
  "/product/delivery": ["inspect-release-readiness", "explain-open-blockers", "review-accountable-ownership"],
  "/product/evaluation": ["explain-evaluation-boundaries", "review-synthetic-evidence", "inspect-qualification-results"],
  "/product/evaluation/replay": ["explain-fictional-replay", "inspect-synthetic-scenarios", "review-replay-controls"],
  "/product/evaluation/adapters": ["inspect-adapter-qualification", "explain-frozen-evidence", "review-provider-readiness"],
  "/product/evaluation/actual": ["explain-restricted-replay", "inspect-owner-isolated-approvals", "review-administrator-boundaries"],
  "/operations/analytics": ["inspect-privacy-safe-insights", "explain-aggregate-outcomes", "review-anonymous-evidence"],
  "/laboratory": ["explain-synthetic-evaluation", "inspect-fictional-scenarios", "review-safe-evidence"],
  "/laboratory/replay": ["explain-fictional-replay", "inspect-synthetic-scenarios", "review-replay-controls"],
  "/laboratory/image-adapters": ["inspect-adapter-qualification", "explain-frozen-evidence", "review-provider-readiness"],
  "/admin/events/replay": ["explain-restricted-replay", "inspect-owner-isolated-approvals", "review-administrator-boundaries"],
  "/knowledge": ["explain-approved-design-guidance", "identify-relevant-patterns", "propose-authorized-navigation"],
  "/knowledge/design-system": ["inspect-component-contracts", "explain-accessible-patterns", "review-fictional-examples"],
  "/knowledge/patterns": ["inspect-interaction-patterns", "explain-accessible-behavior", "review-approved-guidance"],
  "/knowledge/focal-points": ["compare-image-focal-patterns", "explain-fictional-examples", "review-accessible-presentation"],
  "/knowledge/guidance": ["explain-approved-guidance", "inspect-localization-rules", "review-accessibility-requirements"],
  "/knowledge/landing-pages": ["inspect-marketing-audiences", "compare-supported-locales", "review-approved-positioning"],
  "/laboratory/design-system": ["inspect-component-contracts", "explain-accessible-patterns", "review-fictional-examples"],
  "/laboratory/focal-points": ["compare-image-focal-patterns", "explain-fictional-examples", "review-accessible-presentation"],
  "/system/focal-points": ["compare-image-focal-patterns", "explain-fictional-examples", "review-accessible-presentation"],
  "/engineering": ["inspect-redacted-system-health", "identify-safe-diagnostics", "propose-authorized-navigation"],
  "/engineering/events": ["inspect-redacted-event-integrity", "explain-producer-boundaries", "review-projection-health"],
  "/engineering/sync": ["inspect-synchronization-health", "explain-scope-boundaries", "review-safe-recovery"],
  "/engineering/jobs": ["inspect-redacted-job-health", "explain-durable-recovery", "review-provider-safety"],
  "/operations/events": ["inspect-redacted-event-integrity", "explain-producer-boundaries", "review-projection-health"],
  "/operations/events/stream": ["inspect-redacted-event-stream", "explain-producer-boundaries", "review-integrity-signals"],
  "/operations/events/permissions": ["inspect-producer-permissions", "explain-event-authority", "review-revocation-controls"],
  "/operations/events/sync": ["inspect-synchronization-health", "explain-scope-boundaries", "review-safe-recovery"],
  "/admin/events": ["inspect-redacted-event-integrity", "explain-producer-boundaries", "review-projection-health"],
  "/admin/events/stream": ["inspect-redacted-event-stream", "explain-producer-boundaries", "review-integrity-signals"],
  "/admin/events/permissions": ["inspect-producer-permissions", "explain-event-authority", "review-revocation-controls"],
  "/admin/events/sync": ["inspect-synchronization-health", "explain-scope-boundaries", "review-safe-recovery"],
};

export function assistantPlaybookForSurface(surface: AssistantSurface): readonly string[] {
  return surface.host === "platform" && ASSISTANT_PLATFORM_ROUTE_PLAYBOOKS[surface.canonicalFamily]
    ? ASSISTANT_PLATFORM_ROUTE_PLAYBOOKS[surface.canonicalFamily]!
    : ASSISTANT_PAGE_PLAYBOOKS[surface.page];
}

type PopulationCache = "miss" | "indexeddb" | "memory";

type RoutePopulation = {
  routeFamily: string;
  routeSurface: string;
  historyProfile: string | null;
  cache: PopulationCache;
  events: number;
  pages: number;
  populatedMs: number;
  routeLatencyMs: number;
  sessionMs: number;
  sessionSource: "document" | "prefetch" | "preload" | "request" | null;
  sessionServerMs: number | null;
  sessionHeadStartMs: number | null;
  privateContentState: string | null;
  privateContentReadyMs: number | null;
  navigationSource: "worker" | "static" | null;
  apiRequests: number;
  apiTransferBytes: number;
  apiServerMs: number;
  apiBreakdown: Array<{ path: string; requests: number; durationMs: number; serverMs: number; transferBytes: number }>;
  ttfbMs: number | null;
  responseEndMs: number | null;
  firstAssetMs: number | null;
  assetHeadStartMs: number | null;
  fcpMs: number | null;
  lcpMs: number | null;
  inpMs: number | null;
  cls: number;
};

type RecordedResource = { path: string; durationMs: number; serverMs: number; transferBytes: number; decodedBytes: number };

const metrics = {
  routeFamily: "unknown",
  routeSurface: "unknown",
  routePath: "",
  cache: "miss" as PopulationCache,
  pages: 0,
  events: 0,
  sessionMs: 0,
  populationStartedAt: 0,
  navigationSource: null as "worker" | "static" | null,
  ttfbMs: null as number | null,
  responseEndMs: null as number | null,
  firstAssetMs: null as number | null,
  assetHeadStartMs: null as number | null,
  fcpMs: null as number | null,
  lcpMs: null as number | null,
  inpMs: null as number | null,
  cls: 0,
  clsWindowStart: 0,
  clsWindowLatest: 0,
  clsWindowValue: 0,
  completed: new Set<string>(),
  resources: [] as RecordedResource[],
};

const root = () => document.documentElement.dataset;
const rounded = (value: number) => Math.round(value * 10) / 10;

export function performanceRouteFamily(path: string) {
  const pathname = path.split(/[?#]/)[0]?.replace(/\/+$/, "") || "/";
  if (pathname.startsWith("/projects") || pathname === "/creative") return "projects";
  if (pathname === "/canvas/proposals" || pathname.startsWith("/canvas/proposals/")) return "canvas-proposals";
  if (pathname.startsWith("/canvas/")) return "canvas-workspace";
  if (pathname.startsWith("/canvas")) return "canvas-home";
  if (pathname.startsWith("/document/")) return "document";
  if (pathname.startsWith("/studio/project")) return "project-contents";
  if (pathname.startsWith("/studio/")) return "studio";
  if (pathname.startsWith("/laboratory") || pathname.startsWith("/admin/events/replay") || pathname.startsWith("/system/focal-points")) return "laboratory";
  if (pathname.startsWith("/operations") || pathname.startsWith("/admin/events") || pathname.startsWith("/system")) return "operations";
  if (pathname === "/share" || pathname.startsWith("/share/")) return "share";
  if (pathname.startsWith("/library")) return "library";
  if (pathname.startsWith("/sessions")) return "sessions";
  if (pathname.startsWith("/scout")) return "scout";
  if (pathname.startsWith("/memory")) return "memory";
  return "creative-workspace";
}

export function performanceRouteSurface(path: string) {
  const pathname = path.split(/[?#]/)[0]?.replace(/\/+$/, "") || "/";
  if (pathname === "/share" || pathname.startsWith("/share/")) return "shared-document";
  if (pathname === "/operations/analytics") return "operations-analytics";
  if (pathname === "/operations/canvas") return "operations-canvas-governance";
  if (["/operations/events/sync", "/admin/events/sync"].includes(pathname)) return "operations-canvas-sync";
  if (["/operations/events/permissions", "/admin/events/permissions"].includes(pathname)) return "operations-permissions";
  if (["/operations/events", "/operations/events/stream", "/admin/events", "/admin/events/stream"].includes(pathname)) return "operations-event-stream";
  if (pathname === "/operations" || pathname === "/system") return "operations-system";
  if (["/laboratory", "/laboratory/replay", "/admin/events/replay"].includes(pathname)) return "laboratory-replay";
  if (pathname === "/laboratory/image-adapters") return "laboratory-image-adapters";
  if (["/laboratory/focal-points", "/system/focal-points"].includes(pathname)) return "laboratory-focal-points";
  if (pathname === "/laboratory/design-system") return "laboratory-design-system";
  if (pathname.startsWith("/studio/")) return `studio-${pathname.split("/")[2]}`;
  if (pathname.startsWith("/document/")) {
    const view = pathname.match(/\/view\/([^/]+)/)?.[1];
    return view ? `document-${view}` : "document-workspace";
  }
  return performanceRouteFamily(path);
}

function observe(type: string, callback: (entry: PerformanceEntry) => void, options: Record<string, unknown> = {}) {
  if (typeof PerformanceObserver === "undefined") return;
  try {
    const observer = new PerformanceObserver((list) => list.getEntries().forEach(callback));
    observer.observe({ type, buffered: true, ...options } as PerformanceObserverInit);
  } catch {
    // Older browsers simply omit unsupported individual field metrics.
  }
}

function installFieldMetrics() {
  const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  if(navigation){metrics.navigationSource=navigation.serverTiming?.some((entry)=>entry.name==="app")?"worker":"static";root().formaNavigationSource=metrics.navigationSource;}
  if (navigation?.responseStart) {
    metrics.ttfbMs = rounded(navigation.responseStart);
    root().formaTtfbMs = String(metrics.ttfbMs);
  }
  if (navigation?.responseEnd) {
    metrics.responseEndMs = rounded(navigation.responseEnd);
    root().formaResponseEndMs = String(metrics.responseEndMs);
    const assets = performance.getEntriesByType("resource").filter((entry) => {
      try {
        const url = new URL(entry.name);
        return url.origin === location.origin && url.pathname.startsWith("/assets/") && /\.(?:js|css)$/.test(url.pathname) && entry.startTime > 0;
      } catch {
        return false;
      }
    });
    const first = assets.reduce((earliest, entry) => Math.min(earliest, entry.startTime), Number.POSITIVE_INFINITY);
    if (Number.isFinite(first)) {
      metrics.firstAssetMs = rounded(first);
      metrics.assetHeadStartMs = rounded(navigation.responseEnd - first);
      root().formaFirstAssetMs = String(metrics.firstAssetMs);
      root().formaAssetHeadStartMs = String(metrics.assetHeadStartMs);
    }
  }

  observe("paint", (entry) => {
    if (entry.name !== "first-contentful-paint") return;
    metrics.fcpMs = rounded(entry.startTime);
    root().formaFcpMs = String(metrics.fcpMs);
  });

  observe("largest-contentful-paint", (entry) => {
    metrics.lcpMs = rounded(entry.startTime);
    root().formaLcpMs = String(metrics.lcpMs);
  });

  observe("layout-shift", (entry) => {
    const shift = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
    if (shift.hadRecentInput) return;
    const value = Number(shift.value ?? 0);
    if (entry.startTime - metrics.clsWindowLatest > 1000 || entry.startTime - metrics.clsWindowStart > 5000) {
      metrics.clsWindowStart = entry.startTime;
      metrics.clsWindowValue = value;
    } else {
      metrics.clsWindowValue += value;
    }
    metrics.clsWindowLatest = entry.startTime;
    metrics.cls = Math.max(metrics.cls, metrics.clsWindowValue);
    root().formaCls = String(Math.round(metrics.cls*1000)/1000);
  });

  observe("event", (entry) => {
    const event = entry as PerformanceEntry & { interactionId?: number };
    if (!event.interactionId) return;
    metrics.inpMs = Math.max(metrics.inpMs ?? 0, rounded(entry.duration));
    root().formaInpMs = String(metrics.inpMs);
  }, { durationThreshold: 16 });

  observe("resource", (entry) => {
    const resource = entry as PerformanceResourceTiming;
    let url: URL;
    try { url = new URL(resource.name); } catch { return; }
    if (url.origin !== location.origin || !url.pathname.startsWith("/api/")) return;
    const path = url.pathname.startsWith("/api/media/") ? "/api/media/:key"
      : url.pathname.startsWith("/api/shared/") ? "/api/shared/:token"
      : url.pathname.startsWith("/api/document-jobs/") ? "/api/document-jobs/:job"
      : url.pathname;
    const serverMs = rounded(Number(resource.serverTiming?.find((timing) => timing.name === "app")?.duration ?? 0));
    metrics.resources.push({ path, durationMs: rounded(resource.duration), serverMs, transferBytes: resource.transferSize, decodedBytes: resource.decodedBodySize });
    if (metrics.resources.length > 80) metrics.resources.shift();
    root().formaApiRequests = String(metrics.resources.length);
    root().formaApiPaths = [...new Set(metrics.resources.map((item) => item.path))].join(",");
  });
}

export function beginRoutePopulation(path: string) {
  const family = performanceRouteFamily(path);
  const surface = performanceRouteSurface(path);
  metrics.routeFamily = family;
  metrics.routeSurface = surface;
  metrics.routePath = path.split(/[?#]/)[0]?.replace(/\/+$/, "") || "/";
  metrics.populationStartedAt = performance.now();
  metrics.pages = 0;
  metrics.events = 0;
  metrics.sessionMs = 0;
  metrics.resources = [];
  metrics.cache = "miss";
  root().formaPhase = "session";
  root().formaRouteFamily = family;
  root().formaRouteSurface = surface;
  root().formaCache = "miss";
  root().formaApiRequests = "0";
  delete root().formaApiPaths;
  delete root().formaHistoryProfile;
  delete root().formaPrivateContentState;
  delete root().formaPrivateContentReadyMs;
  delete root().formaAuditEventCount;
  delete root().formaAuditTotal;
  delete root().formaAuditMatched;
  delete root().formaPopulatedMs;
  delete root().formaRouteLatencyMs;
  delete root().formaSessionSource;
  delete root().formaSessionServerMs;
  delete root().formaSessionHeadStartMs;
  delete root().formaSessionRequestStartMs;
  delete root().formaSessionRequestCount;
  delete root().formaSessionInitiator;
  metrics.completed.clear();
  performance.mark("forma:population-start");
}

export function recordRouteHistoryProfile(profile: string) {
  root().formaHistoryProfile = profile;
}

export function recordPrivateContentState(state: "pending" | "ready" | "unavailable" | "not-required") {
  root().formaPrivateContentState = state;
  if (state === "ready") root().formaPrivateContentReadyMs = String(rounded(performance.now()));
}

export function recordSessionReady(startedAt: number, source: "document" | "prefetch" | "request" = "request") {
  const sessionResources=source!=="document"?performance.getEntriesByName(new URL("/api/session",location.href).href,"resource") as PerformanceResourceTiming[]:[];
  const sessionResource=sessionResources.at(-1);
  const preloaded=source==="request"&&Boolean(sessionResource&&sessionResource.startTime<startedAt&&["link","early-hint"].includes(sessionResource.initiatorType));
  metrics.sessionMs = rounded(performance.now() - startedAt);
  root().formaSessionMs = String(metrics.sessionMs);
  root().formaSessionSource = preloaded?"preload":source;
  if(sessionResource){root().formaSessionRequestCount=String(sessionResources.length);root().formaSessionRequestStartMs=String(rounded(sessionResource.startTime));root().formaSessionInitiator=sessionResource.initiatorType;}
  const prefetchedAt=source==="prefetch"?Number(root().formaSessionPrefetchStartedMs):preloaded?sessionResource?.startTime:undefined;
  if(prefetchedAt!==undefined&&Number.isFinite(prefetchedAt)&&prefetchedAt<=startedAt)root().formaSessionHeadStartMs=String(rounded(startedAt-prefetchedAt));
  root().formaPhase = "events";
  performance.mark("forma:session-ready");
}

export function recordEventPage(eventCount: number) {
  metrics.pages += 1;
  metrics.events += eventCount;
  root().formaEventPages = String(metrics.pages);
  root().formaEventCount = String(metrics.events);
}

export function recordPopulationSource(cache: PopulationCache, events: number) {
  metrics.cache = cache;
  metrics.events = events;
  root().formaCache = cache === "miss" ? "miss" : "hit";
  root().formaEventCount = String(events);
  root().formaPhase = "rendering";
}

export function completeRoutePopulation(path: string, retry = 0) {
  const family = performanceRouteFamily(path);
  const surface = performanceRouteSurface(path);
  const pathname = path.split(/[?#]/)[0]?.replace(/\/+$/, "") || "/";
  const currentPathname = location.pathname.replace(/\/+$/, "") || "/";
  if (family !== metrics.routeFamily || surface !== metrics.routeSurface || pathname !== metrics.routePath || pathname !== currentPathname || metrics.completed.has(surface)) return;
  requestAnimationFrame(() => {
    const main = document.querySelector("#main-content");
    let meaningful = family === "projects"
      ? Boolean(main?.querySelector(".project-card,forma-ui-empty-state"))
      : Boolean(main && main.querySelectorAll("*").length > 2 && !main.querySelector(".application-loading"));
    if (surface === "shared-document") meaningful = Boolean(document.querySelector(".shared-view .shared-hero,.shared-view .shared-status h1"));
    else if (surface === "operations-analytics") meaningful = Boolean(main?.querySelector("forma-analytics .analytics-overview,forma-analytics .analytics-error[role=alert]"));
    else if (surface === "operations-canvas-governance") meaningful = Boolean(main?.querySelector("forma-canvas-governance .canvas-governance-grid,forma-canvas-governance .canvas-governance-error[role=alert]"));
    else if (surface === "operations-canvas-sync") meaningful = Boolean(main?.querySelector('forma-canvas-sync-inspector[data-forma-surface-ready="true"] .system-metrics'));
    else if (surface === "operations-permissions") meaningful = Boolean(main?.querySelector("forma-admin-events .permission-table,forma-admin-events > .admin-page > .replay-empty"));
    else if (surface === "operations-event-stream") meaningful = Boolean(main?.querySelector('forma-admin-events [data-forma-surface-ready="true"] .event-table tbody,forma-admin-events [data-forma-surface-ready="true"] [role="alert"],forma-admin-events > .admin-page > .replay-empty'));
    else if (surface === "laboratory-replay") meaningful = Boolean(main?.querySelector('forma-admin-events .saved-replays[data-forma-surface-ready="true"],forma-admin-events > .admin-page > .replay-empty'));
    else if (surface === "laboratory-image-adapters") meaningful = Boolean(main?.querySelector("forma-image-adapter-lab .adapter-lab-status,forma-image-adapter-lab .adapter-lab-warning[role=alert]"));
    else if (surface === "laboratory-focal-points") meaningful = Boolean(main?.querySelector("forma-focal-point-lab .focal-lab-controls") && main.querySelector("forma-focal-point-lab .focal-lab-assets,forma-focal-point-lab .focal-lab-empty"));
    else if (surface === "laboratory-design-system") meaningful = Boolean(main?.querySelector("forma-design-system-lab .design-lab-content forma-component-catalog") && main.querySelector("forma-design-system-lab .design-lab-section"));
    const shell=document.querySelector("forma-shell") as (HTMLElement & {store?:{projection?:{get:()=>{documentId?:string;conditions?:unknown[]}};canvasProjection?:{get:()=>{selectedCanvasId?:string}}}})|null;
    if (family === "memory" && (shell?.store?.projection?.get().conditions?.length ?? 0) > 0 && root().formaPrivateContentState === "pending") meaningful = false;
    if ((surface === "document-chat" || surface === "studio-chat") && root().formaPrivateContentState === "pending") meaningful = false;
    if(family==="document"){
      const requested=decodeURIComponent((path.split(/[?#]/)[0].split("/")[2]??""));
      if(requested&&shell?.store?.projection?.get().documentId!==requested)meaningful=false;
    }
    if(family==="canvas-workspace"){
      const requested=decodeURIComponent((path.split(/[?#]/)[0].split("/")[2]??""));
      if(requested&&shell?.store?.canvasProjection?.get().selectedCanvasId!==requested)meaningful=false;
    }
    if (!meaningful && retry < 480) {
      window.setTimeout(() => completeRoutePopulation(path, retry + 1), 25);
      return;
    }
    if (!meaningful || metrics.completed.has(surface) || metrics.routeSurface !== surface || metrics.routePath !== pathname || (location.pathname.replace(/\/+$/, "") || "/") !== pathname) return;
    metrics.completed.add(surface);
    const populatedMs = rounded(performance.now());
    root().formaPopulatedMs = String(populatedMs);
    root().formaRouteLatencyMs = String(rounded(populatedMs-metrics.populationStartedAt));
    root().formaApiRequests = String(metrics.resources.length);
    root().formaApiPaths = [...new Set(metrics.resources.map((resource) => resource.path))].join(",");
    root().formaPhase = "populated";
    performance.mark("forma:route-populated");
    const apiBreakdown = [...metrics.resources.reduce((groups, resource) => {
      const group = groups.get(resource.path) ?? { path: resource.path, requests: 0, durationMs: 0, serverMs: 0, transferBytes: 0 };
      group.requests += 1;
      group.durationMs += resource.durationMs;
      group.serverMs += resource.serverMs;
      group.transferBytes += resource.transferBytes;
      groups.set(resource.path, group);
      return groups;
    }, new Map<string, { path: string; requests: number; durationMs: number; serverMs: number; transferBytes: number }>()).values()]
      .map((group) => ({ ...group, durationMs: rounded(group.durationMs), serverMs: rounded(group.serverMs) }));
    const detail: RoutePopulation = {
      routeFamily: family,
      routeSurface: surface,
      historyProfile: root().formaHistoryProfile ?? null,
      cache: metrics.cache,
      events: metrics.events,
      pages: metrics.pages,
      populatedMs,
      routeLatencyMs:rounded(populatedMs-metrics.populationStartedAt),
      sessionMs:metrics.sessionMs,
      sessionSource:root().formaSessionSource==="document"?"document":root().formaSessionSource==="prefetch"?"prefetch":root().formaSessionSource==="preload"?"preload":root().formaSessionSource==="request"?"request":null,
      sessionServerMs:root().formaSessionServerMs===undefined?null:Number(root().formaSessionServerMs),
      sessionHeadStartMs:root().formaSessionHeadStartMs===undefined?null:Number(root().formaSessionHeadStartMs),
      privateContentState:root().formaPrivateContentState ?? null,
      privateContentReadyMs:root().formaPrivateContentReadyMs===undefined?null:Number(root().formaPrivateContentReadyMs),
      navigationSource:metrics.navigationSource,
      apiRequests:metrics.resources.length,
      apiTransferBytes:metrics.resources.reduce((total,resource)=>total+resource.transferBytes,0),
      apiServerMs:rounded(metrics.resources.reduce((total,resource)=>total+resource.serverMs,0)),
      apiBreakdown,
      ttfbMs: metrics.ttfbMs,
      responseEndMs: metrics.responseEndMs,
      firstAssetMs: metrics.firstAssetMs,
      assetHeadStartMs: metrics.assetHeadStartMs,
      fcpMs: metrics.fcpMs,
      lcpMs: metrics.lcpMs,
      inpMs: metrics.inpMs,
      cls: Math.round(metrics.cls*1000)/1000,
    };
    console.info("[forma-performance]", JSON.stringify(detail));
    window.dispatchEvent(new CustomEvent("forma-performance", { detail }));
  });
}

export function completeBackgroundHydration(events: number, profile: "workspace" | "memory" | "scout" | "sessions" | "full") {
  root().formaHistoryEvents = String(events);
  root().formaHistoryProfile = profile;
  root().formaHistoryReadyMs = String(rounded(performance.now()));
  performance.mark(profile === "full" ? "forma:history-ready" : `forma:${profile}-ready`);
}

if (typeof window !== "undefined") installFieldMetrics();

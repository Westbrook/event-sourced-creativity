type PopulationCache = "miss" | "indexeddb" | "memory";

type RoutePopulation = {
  routeFamily: string;
  cache: PopulationCache;
  events: number;
  pages: number;
  populatedMs: number;
  routeLatencyMs: number;
  sessionMs: number;
  apiRequests: number;
  apiTransferBytes: number;
  apiServerMs: number;
  apiBreakdown: Array<{ path: string; requests: number; durationMs: number; serverMs: number; transferBytes: number }>;
  ttfbMs: number | null;
  fcpMs: number | null;
  lcpMs: number | null;
  inpMs: number | null;
  cls: number;
};

type RecordedResource = { path: string; durationMs: number; serverMs: number; transferBytes: number; decodedBytes: number };

const metrics = {
  routeFamily: "unknown",
  cache: "miss" as PopulationCache,
  pages: 0,
  events: 0,
  sessionMs: 0,
  populationStartedAt: 0,
  ttfbMs: null as number | null,
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
  const pathname = path.split(/[?#]/)[0] || "/";
  if (pathname.startsWith("/projects") || pathname === "/creative") return "projects";
  if (pathname === "/canvas/proposals" || pathname.startsWith("/canvas/proposals/")) return "canvas-proposals";
  if (pathname.startsWith("/canvas/")) return "canvas-workspace";
  if (pathname.startsWith("/canvas")) return "canvas-home";
  if (pathname.startsWith("/document/")) return "document";
  if (pathname.startsWith("/studio/project")) return "project-contents";
  if (pathname.startsWith("/studio/")) return "studio";
  if (pathname.startsWith("/laboratory") || pathname.startsWith("/admin/events/replay") || pathname.startsWith("/system/focal-points")) return "laboratory";
  if (pathname.startsWith("/operations") || pathname.startsWith("/admin/events") || pathname.startsWith("/system")) return "operations";
  if (pathname.startsWith("/share/")) return "share";
  if (pathname.startsWith("/library")) return "library";
  if (pathname.startsWith("/sessions")) return "sessions";
  if (pathname.startsWith("/scout")) return "scout";
  if (pathname.startsWith("/memory")) return "memory";
  return "creative-workspace";
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
  if (navigation?.responseStart) {
    metrics.ttfbMs = rounded(navigation.responseStart);
    root().formaTtfbMs = String(metrics.ttfbMs);
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
  });
}

export function beginRoutePopulation(path: string) {
  const family = performanceRouteFamily(path);
  metrics.routeFamily = family;
  metrics.populationStartedAt = performance.now();
  metrics.pages = 0;
  metrics.events = 0;
  metrics.sessionMs = 0;
  metrics.resources = [];
  metrics.cache = "miss";
  root().formaPhase = "session";
  root().formaRouteFamily = family;
  root().formaCache = "miss";
  delete root().formaPopulatedMs;
  delete root().formaRouteLatencyMs;
  metrics.completed.clear();
  performance.mark("forma:population-start");
}

export function recordSessionReady(startedAt: number) {
  metrics.sessionMs = rounded(performance.now() - startedAt);
  root().formaSessionMs = String(metrics.sessionMs);
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
  if (family !== metrics.routeFamily || metrics.completed.has(family)) return;
  requestAnimationFrame(() => {
    const main = document.querySelector("#main-content");
    let meaningful = family === "projects"
      ? Boolean(main?.querySelector(".project-card,forma-ui-empty-state"))
      : Boolean(main && main.querySelectorAll("*").length > 2 && !main.querySelector(".application-loading"));
    const shell=document.querySelector("forma-shell") as (HTMLElement & {store?:{projection?:{get:()=>{documentId?:string}};canvasProjection?:{get:()=>{selectedCanvasId?:string}}}})|null;
    if(family==="document"){
      const requested=decodeURIComponent((path.split(/[?#]/)[0].split("/")[2]??""));
      if(requested&&shell?.store?.projection?.get().documentId!==requested)meaningful=false;
    }
    if(family==="canvas-workspace"){
      const requested=decodeURIComponent((path.split(/[?#]/)[0].split("/")[2]??""));
      if(requested&&shell?.store?.canvasProjection?.get().selectedCanvasId!==requested)meaningful=false;
    }
    if (!meaningful && retry < 120) {
      window.setTimeout(() => completeRoutePopulation(path, retry + 1), 25);
      return;
    }
    if (!meaningful || metrics.completed.has(family)) return;
    metrics.completed.add(family);
    const populatedMs = rounded(performance.now());
    root().formaPopulatedMs = String(populatedMs);
    root().formaRouteLatencyMs = String(rounded(populatedMs-metrics.populationStartedAt));
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
      cache: metrics.cache,
      events: metrics.events,
      pages: metrics.pages,
      populatedMs,
      routeLatencyMs:rounded(populatedMs-metrics.populationStartedAt),
      sessionMs:metrics.sessionMs,
      apiRequests:metrics.resources.length,
      apiTransferBytes:metrics.resources.reduce((total,resource)=>total+resource.transferBytes,0),
      apiServerMs:rounded(metrics.resources.reduce((total,resource)=>total+resource.serverMs,0)),
      apiBreakdown,
      ttfbMs: metrics.ttfbMs,
      fcpMs: metrics.fcpMs,
      lcpMs: metrics.lcpMs,
      inpMs: metrics.inpMs,
      cls: Math.round(metrics.cls*1000)/1000,
    };
    console.info("[forma-performance]", JSON.stringify(detail));
    window.dispatchEvent(new CustomEvent("forma-performance", { detail }));
  });
}

export function completeBackgroundHydration(events: number, profile: "workspace" | "full") {
  root().formaHistoryEvents = String(events);
  root().formaHistoryProfile = profile;
  root().formaHistoryReadyMs = String(rounded(performance.now()));
  performance.mark(profile === "full" ? "forma:history-ready" : "forma:workspace-ready");
}

if (typeof window !== "undefined") installFieldMetrics();

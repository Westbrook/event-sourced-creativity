import { documentViewFromRoute } from "./model/routes";

type RouteModule = Promise<unknown>;

/**
 * Keep page implementations out of the shared shell bundle. Vite turns every
 * explicit import below into a separately cacheable route chunk.
 */
export function loadRouteComponent(path: string): RouteModule {
  const documentView = documentViewFromRoute(path);
  if (path.startsWith("/share/")) return import("./components/forma-shared-view");
  if (path.startsWith("/projects")) return import("./components/forma-projects");
  if (path.startsWith("/studio/project")) return import("./components/forma-project-contents");
  if (documentView === "board" || documentView === "guided") return import("./components/forma-studio-alternatives");
  if (documentView === "layers" || documentView === "adaptive") return import("./components/forma-studio-editor-alternatives");
  if (path.startsWith("/admin/events")) return import("./components/forma-admin-events");
  if (path.startsWith("/library")) return import("./components/forma-library");
  if (path.startsWith("/sessions")) return import("./components/forma-sessions");
  if (path.startsWith("/scout")) return import("./components/forma-scout");
  if (path.startsWith("/memory")) return import("./components/forma-memory");
  if (path.startsWith("/system")) return import("./components/forma-system");
  return import("./components/forma-workspace");
}

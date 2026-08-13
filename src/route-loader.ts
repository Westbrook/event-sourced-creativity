import { applicationIdFromRoute } from "./platform/applications";

type RouteModule = Promise<unknown>;

/**
 * Keep page implementations out of the shared shell bundle. Vite turns every
 * explicit import below into a separately cacheable route chunk.
 */
export function loadRouteComponent(path: string): RouteModule {
  const application=applicationIdFromRoute(path);
  if(application==="operations")return import("./apps/operations/entry").then((module)=>module.loadOperationsRoute(path));
  if(application==="laboratory")return import("./apps/laboratory/entry").then((module)=>module.loadLaboratoryRoute(path));
  return import("./apps/creative/entry").then((module)=>module.loadCreativeRoute(path));
}

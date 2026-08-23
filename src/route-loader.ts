import { applicationIdFromRoute } from "./platform/applications";

type RouteModule = Promise<unknown>;

/**
 * Keep page implementations out of the shared shell bundle. Vite turns every
 * explicit import below into a separately cacheable route chunk.
 */
export function loadRouteComponent(path: string): RouteModule {
  const application=applicationIdFromRoute(path);
  if(application==="canvas")return import("./apps/canvas/entry").then((module)=>module.loadCanvasRoute(path));
  if(application==="operations")return import("./apps/operations/entry").then((module)=>module.loadOperationsRoute(path));
  if(application==="product")return import("./apps/product/entry").then((module)=>module.loadProductRoute(path));
  if(application==="knowledge")return import("./apps/knowledge/entry").then((module)=>module.loadKnowledgeRoute(path));
  if(application==="engineering")return import("./apps/engineering/entry").then((module)=>module.loadEngineeringRoute(path));
  return import("./apps/creative/entry").then((module)=>module.loadCreativeRoute(path));
}

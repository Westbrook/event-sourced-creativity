import { documentSlug } from "./routes.ts";
import type { CreativeMedium } from "./workspace-intelligence.ts";
export function documentPreparationRoute(documentId:string,title:string,medium:CreativeMedium|"context"|null){
  return `/document/${encodeURIComponent(documentId)}/${documentSlug(title)}?prepare=${medium??"choose"}`;
}

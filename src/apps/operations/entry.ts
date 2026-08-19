import { html } from "lit";
import { FormaElement } from "../../components/forma-element";
import { routePathname } from "../../model/routes";

const isEventsRoute=(path:string)=>path.startsWith("/operations/events")||path.startsWith("/admin/events");

export function loadOperationsRoute(path: string): Promise<unknown> {
  if(routePathname(path)==="/operations/analytics")return import("../../components/forma-analytics");
  if(["/operations/events/sync","/admin/events/sync"].includes(routePathname(path)))return import("./canvas-sync-inspector");
  return isEventsRoute(routePathname(path))?import("../../components/forma-admin-events"):import("../../components/forma-system");
}

export class FormaOperationsApplication extends FormaElement {
  override render(){const path=routePathname(this.store.route.get());if(path==="/operations/analytics")return html`<forma-analytics></forma-analytics>`;if(["/operations/events/sync","/admin/events/sync"].includes(path))return html`<forma-canvas-sync-inspector></forma-canvas-sync-inspector>`;return isEventsRoute(path)?html`<forma-admin-events></forma-admin-events>`:html`<forma-system></forma-system>`;}
}

if(!customElements.get("forma-operations-application"))customElements.define("forma-operations-application",FormaOperationsApplication);

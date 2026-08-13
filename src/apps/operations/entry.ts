import { html } from "lit";
import { FormaElement } from "../../components/forma-element";
import { routePathname } from "../../model/routes";

const isEventsRoute=(path:string)=>path.startsWith("/operations/events")||path.startsWith("/admin/events");

export function loadOperationsRoute(path: string): Promise<unknown> {
  return isEventsRoute(routePathname(path))?import("../../components/forma-admin-events"):import("../../components/forma-system");
}

export class FormaOperationsApplication extends FormaElement {
  override render(){return isEventsRoute(routePathname(this.store.route.get()))?html`<forma-admin-events></forma-admin-events>`:html`<forma-system></forma-system>`;}
}

if(!customElements.get("forma-operations-application"))customElements.define("forma-operations-application",FormaOperationsApplication);

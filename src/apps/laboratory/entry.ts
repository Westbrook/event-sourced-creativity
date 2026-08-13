import { html } from "lit";
import { FormaElement } from "../../components/forma-element";
import { routePathname } from "../../model/routes";

const isFocalRoute=(path:string)=>path==="/laboratory/focal-points"||path==="/system/focal-points";

export function loadLaboratoryRoute(path: string): Promise<unknown> {
  return isFocalRoute(routePathname(path))?import("../../components/forma-focal-point-lab"):import("../../components/forma-admin-events");
}

export class FormaLaboratoryApplication extends FormaElement {
  override render(){return isFocalRoute(routePathname(this.store.route.get()))?html`<forma-focal-point-lab></forma-focal-point-lab>`:html`<forma-admin-events></forma-admin-events>`;}
}

if(!customElements.get("forma-laboratory-application"))customElements.define("forma-laboratory-application",FormaLaboratoryApplication);

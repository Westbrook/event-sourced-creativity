import { html } from "lit";
import { FormaElement } from "../../components/forma-element";
import { routePathname } from "../../model/routes";

const isFocalRoute=(path:string)=>path==="/laboratory/focal-points"||path==="/system/focal-points";
const isAdapterRoute=(path:string)=>path==="/laboratory/image-adapters";
const isDesignSystemRoute=(path:string)=>path==="/laboratory/design-system";

export function loadLaboratoryRoute(path: string): Promise<unknown> {
  const route=routePathname(path);return isFocalRoute(route)?import("../../components/forma-focal-point-lab"):isAdapterRoute(route)?import("../../components/forma-image-adapter-lab"):isDesignSystemRoute(route)?import("../../components/forma-design-system-lab"):import("../../components/forma-admin-events");
}

export class FormaLaboratoryApplication extends FormaElement {
  override render(){const route=routePathname(this.store.route.get());return isFocalRoute(route)?html`<forma-focal-point-lab></forma-focal-point-lab>`:isAdapterRoute(route)?html`<forma-image-adapter-lab></forma-image-adapter-lab>`:isDesignSystemRoute(route)?html`<forma-design-system-lab></forma-design-system-lab>`:html`<forma-admin-events></forma-admin-events>`;}
}

if(!customElements.get("forma-laboratory-application"))customElements.define("forma-laboratory-application",FormaLaboratoryApplication);

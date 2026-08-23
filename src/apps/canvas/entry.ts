import { html } from "lit";
import { FormaElement } from "../../components/forma-element";
import { routePathname } from "../../model/routes";

export function loadCanvasRoute(path:string):Promise<unknown>{
  const pathname=routePathname(path);
  if(pathname==="/canvas/projects"||pathname.startsWith("/canvas/projects/"))return import("../../components/forma-projects");
  if(pathname==="/canvas/library"||pathname.startsWith("/canvas/library/"))return import("../../components/forma-library");
  return import("../../canvas/canvas-application");
}

export class FormaCanvasApplication extends FormaElement {
  override render(){
    const pathname=routePathname(this.store.route.get());
    if(pathname==="/canvas/projects"||pathname.startsWith("/canvas/projects/"))return html`<forma-projects></forma-projects>`;
    if(pathname==="/canvas/library"||pathname.startsWith("/canvas/library/"))return html`<forma-library></forma-library>`;
    return html`<forma-canvas-surface></forma-canvas-surface>`;
  }
}

if(!customElements.get("forma-canvas-application"))customElements.define("forma-canvas-application",FormaCanvasApplication);

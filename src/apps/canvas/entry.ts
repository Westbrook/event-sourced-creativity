import { html } from "lit";
import { FormaElement } from "../../components/forma-element";

export function loadCanvasRoute(path:string){void path;return import("../../canvas/canvas-application");}

export class FormaCanvasApplication extends FormaElement {
  override render(){return html`<forma-canvas-surface></forma-canvas-surface>`;}
}

if(!customElements.get("forma-canvas-application"))customElements.define("forma-canvas-application",FormaCanvasApplication);

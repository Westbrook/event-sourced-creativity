import { html } from "lit";
import { FormaPresentationalElement } from "../../components/presentational-element";
import { routePathname } from "../../model/routes";

export function loadOperationsRoute(path: string): Promise<unknown> {
  const route=routePathname(path);
  if(route==="/operations/access")return import("./access-management");
  if(route==="/operations/providers")return import("./providers");
  if(route==="/operations/canvas")return import("./canvas-governance");
  return import("./overview");
}

export class FormaOperationsApplication extends FormaPresentationalElement {
  override render(){const path=routePathname(location.pathname);if(path==="/operations/access")return html`<forma-access-management></forma-access-management>`;if(path==="/operations/providers")return html`<forma-operations-providers></forma-operations-providers>`;if(path==="/operations/canvas")return html`<forma-canvas-governance></forma-canvas-governance>`;return html`<forma-operations-overview></forma-operations-overview>`;}
}

if(!customElements.get("forma-operations-application"))customElements.define("forma-operations-application",FormaOperationsApplication);

import { html } from "lit";
import { routePathname } from "../../model/routes";
import { FormaPresentationalElement } from "../../components/presentational-element";

export function loadProductRoute(path: string): Promise<unknown> {
  const route = routePathname(path);
  if(route==="/product/evaluation/actual"||route==="/admin/events/replay")return import("./actual-replay");
  if(route==="/product/evaluation/replay"||route==="/laboratory/replay")return import("./synthetic-replay");
  if(route==="/product/evaluation/adapters"||route==="/laboratory/image-adapters")return import("./adapter-preview");
  if (route === "/product/delivery") return import("./delivery");
  if (route === "/product/evaluation" || route === "/product/evaluation/adapters" || route.startsWith("/laboratory")) return import("./evaluation");
  return import("./insights");
}

export class FormaProductApplication extends FormaPresentationalElement {
  override render() {
    const route = routePathname(location.pathname);
    if(route==="/product/evaluation/actual"||route==="/admin/events/replay")return html`<forma-actual-replay></forma-actual-replay>`;
    if(route==="/product/evaluation/replay"||route==="/laboratory/replay")return html`<forma-synthetic-replay></forma-synthetic-replay>`;
    if(route==="/product/evaluation/adapters"||route==="/laboratory/image-adapters")return html`<forma-product-adapter-preview></forma-product-adapter-preview>`;
    if (route === "/product/delivery") return html`<forma-product-delivery></forma-product-delivery>`;
    if (route === "/product/evaluation" || route === "/product/evaluation/adapters" || route.startsWith("/laboratory")) return html`<forma-product-evaluation></forma-product-evaluation>`;
    return html`<forma-product-insights></forma-product-insights>`;
  }
}

if (!customElements.get("forma-product-application")) customElements.define("forma-product-application", FormaProductApplication);

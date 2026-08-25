import { html, nothing } from "lit";
import { FormaPresentationalElement } from "../../components/presentational-element";
import type { FormaLocaleController } from "../../components/design-system/localization";
import { platformSession } from "../../platform/session-controller";

let renderLandingPageCatalog: ((i18n: FormaLocaleController) => ReturnType<typeof html>) | undefined;

export function loadKnowledgeRoute(path: string): Promise<unknown> {
  if (path.replace(/\/+$/, "") === "/knowledge/landing-pages") {
    return import("./landing-pages").then((module) => {
      renderLandingPageCatalog = module.renderKnowledgeLandingPages;
    });
  }
  if(path.endsWith("/focal-points"))return import("../../components/forma-focal-point-lab");
  const componentInventory=path==="/knowledge"||path.startsWith("/knowledge/design-system")||path==="/laboratory/design-system";
  return componentInventory
    ? Promise.all([import("../../components/forma-design-system-lab"),import("../../components/design-system/component-catalog")])
    : import("../../components/forma-design-system-lab");
}

export class FormaKnowledgeApplication extends FormaPresentationalElement {
  override render() {
    if (location.pathname.replace(/\/+$/, "") === "/knowledge/landing-pages") return renderLandingPageCatalog?.(this.i18n) ?? nothing;
    if(location.pathname.endsWith("/focal-points"))return html`<forma-focal-point-lab></forma-focal-point-lab>`;
    const view=location.pathname.startsWith("/knowledge/patterns")||location.pathname.endsWith("/focal-points")?"patterns":location.pathname.startsWith("/knowledge/guidance")?"guidance":"components";
    const focalAuthorized=view==="patterns"&&platformSession.get()?.capabilities.includes("design.catalog.read");
    return html`<forma-design-system-lab .view=${view}></forma-design-system-lab>${focalAuthorized?html`<section class="page-pad" aria-labelledby="knowledge-focal-link-heading"><h2 id="knowledge-focal-link-heading">${this.i18n.t("knowledge.focal.heading","Focal-point comparison")}</h2><p>${this.i18n.t("knowledge.focal.description","Compare local image calculations using approved fictional examples only; creator projects and private media are never loaded.")}</p><a class="button secondary" href="/knowledge/focal-points">${this.i18n.t("knowledge.focal.open","Compare focal-point treatments")}</a></section>`:nothing}`;
  }
}

if (!customElements.get("forma-knowledge-application")) customElements.define("forma-knowledge-application", FormaKnowledgeApplication);

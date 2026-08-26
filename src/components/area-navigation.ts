import { html } from "lit";
import { FormaElement } from "./forma-element";
import { applicationDefinition, navigationItemAccessible } from "../platform/applications";
import "./design-system/navigation";

type Area = "intelligence" | "operations" | "product" | "knowledge" | "engineering";

const intelligenceIds = new Set(["sessions", "scout", "memory"]);

export class AreaNavigation extends FormaElement {
  #go(event: Event, href: string) {
    event.preventDefault();
    this.store.setRoute(href);
    window.scrollTo({ top: 0 });
  }

  override render() {
    const requestedArea=this.getAttribute("area");
    const area = (requestedArea === "operations" || requestedArea === "administration" ? "operations" : requestedArea === "laboratory" ? "product" : ["product","knowledge","engineering"].includes(requestedArea??"") ? requestedArea : "intelligence") as Area;
    const active = this.getAttribute("active") ?? "";
    const session = this.store.session.get();
    const access = { role: session?.user.role, capabilities: session?.capabilities, canvasAccess: session?.canvas.access };
    const items = area === "operations"
      ? applicationDefinition("operations").navigation.filter((item) => navigationItemAccessible(item, access))
      : area !== "intelligence"
        ? applicationDefinition(area).navigation.filter((item) => navigationItemAccessible(item, access))
        : applicationDefinition("creative").navigation.filter((item) => intelligenceIds.has(item.id));
    const label = area === "intelligence" ? this.i18n.t("shell.intelligence", "Creative intelligence") : this.i18n.t(`shell.${area}`,applicationDefinition(area).label);
    const destinations=items.map((item)=>({label:this.i18n.t("shell.navigation."+item.id,item.label),value:item.id,href:item.href,description:this.i18n.t("shell.description."+item.id,item.description)}));
    return html`<forma-ui-audience-navigation class=${`area-navigation--${area}`} .label=${label} .value=${active} .destinations=${destinations} @forma-navigate=${(event:CustomEvent<{value:string;href:string}>)=>this.#go(event,event.detail.href)}></forma-ui-audience-navigation>`;
  }
}

if (!customElements.get("forma-area-navigation")) customElements.define("forma-area-navigation", AreaNavigation);

import { html, nothing } from "lit";
import { FormaElement } from "./forma-element";
import { applicationDefinition } from "../platform/applications";

type Area = "intelligence" | "operations" | "laboratory";

const intelligenceIds = new Set(["sessions", "scout", "memory"]);

export class AreaNavigation extends FormaElement {
  #revealedLocation = "";

  protected override updated() {
    const location = `${this.getAttribute("area") ?? ""}:${this.getAttribute("active") ?? ""}`;
    if (location === this.#revealedLocation) return;
    const scroller = this.querySelector<HTMLElement>(".area-navigation > div");
    const current = scroller?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!scroller || !current) return;
    this.#revealedLocation = location;
    const viewport = scroller.getBoundingClientRect();
    const target = current.getBoundingClientRect();
    if (target.right > viewport.right) scroller.scrollLeft += target.right - viewport.right;
    else if (target.left < viewport.left) scroller.scrollLeft -= viewport.left - target.left;
  }

  #go(event: MouseEvent, href: string) {
    event.preventDefault();
    this.store.setRoute(href);
    window.scrollTo({ top: 0 });
  }

  override render() {
    const requestedArea=this.getAttribute("area");
    const area = (requestedArea === "operations" || requestedArea === "administration" ? "operations" : requestedArea === "laboratory" ? "laboratory" : "intelligence") as Area;
    const active = this.getAttribute("active") ?? "";
    const session = this.store.session.get();
    const items = area === "operations"
      ? applicationDefinition("operations").navigation.filter((item) => item.id === "system" || session?.user.role === "admin")
      : area === "laboratory"
        ? applicationDefinition("laboratory").navigation.filter(() => session?.user.role === "admin")
        : applicationDefinition("creative").navigation.filter((item) => intelligenceIds.has(item.id));
    const label = area === "operations" ? "Operations" : area === "laboratory" ? "Laboratory" : "Creative intelligence";
    const administrative = area === "operations" || area === "laboratory";
    const classes = `area-navigation${administrative ? " area-navigation--administrative" : ""} area-navigation--${area}`;
    return html`<nav class=${classes} aria-label=${label}>
      <span>${label}</span>
      <div>${items.map((item) => html`<a href=${item.href} title=${item.description} class=${active === item.id ? "active" : ""} aria-current=${active === item.id ? "page" : nothing} @click=${(event:MouseEvent)=>this.#go(event,item.href)}>${item.label}</a>`)}</div>
    </nav>`;
  }
}

customElements.define("forma-area-navigation", AreaNavigation);

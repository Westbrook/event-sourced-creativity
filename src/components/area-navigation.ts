import { html, nothing } from "lit";
import { FormaElement } from "./forma-element";

type Area = "intelligence" | "administration";

const intelligence = [
  { id: "sessions", href: "/sessions", label: "Re-entry", description: "Resume witnessed work" },
  { id: "scout", href: "/scout", label: "Scout", description: "Investigate trajectories" },
  { id: "memory", href: "/memory", label: "Taste & time", description: "Manage preference and future memory" },
] as const;

const administration = [
  { id: "system", href: "/system", label: "System & governance", description: "Policies, gates, and operational health" },
  { id: "events", href: "/admin/events", label: "Event operations", description: "Inspect and replay the durable stream" },
] as const;

export class AreaNavigation extends FormaElement {
  #go(event: MouseEvent, href: string) {
    event.preventDefault();
    this.store.setRoute(href);
    window.scrollTo({ top: 0 });
  }

  override render() {
    const area = (this.getAttribute("area") === "administration" ? "administration" : "intelligence") as Area;
    const active = this.getAttribute("active") ?? "";
    const session = this.store.session.get();
    const items = area === "administration"
      ? administration.filter((item) => item.id !== "events" || session?.user.role === "admin")
      : intelligence;
    const label = area === "administration" ? "Administration" : "Creative intelligence";
    return html`<nav class=${`area-navigation area-navigation--${area}`} aria-label=${label}>
      <span>${label}</span>
      <div>${items.map((item) => html`<a href=${item.href} title=${item.description} class=${active === item.id ? "active" : ""} aria-current=${active === item.id ? "page" : nothing} @click=${(event:MouseEvent)=>this.#go(event,item.href)}>${item.label}</a>`)}</div>
    </nav>`;
  }
}

customElements.define("forma-area-navigation", AreaNavigation);

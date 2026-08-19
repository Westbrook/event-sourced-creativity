import { html, nothing } from "lit";
import { FormaElement } from "./forma-element";

type Area = "intelligence" | "operations" | "laboratory";

const intelligence = [
  { id: "sessions", href: "/sessions", label: "Re-entry", description: "Resume witnessed work" },
  { id: "scout", href: "/scout", label: "Scout", description: "Investigate trajectories" },
  { id: "memory", href: "/memory", label: "Taste & time", description: "Manage preference and future memory" },
] as const;

const operations = [
  { id: "system", href: "/operations", label: "System & governance", description: "Policies, gates, and operational health" },
  { id: "analytics", href: "/operations/analytics", label: "Analytics", description: "Find product improvements and creative outcome evidence" },
  { id: "stream", href: "/operations/events", label: "Durable stream", description: "Inspect immutable event envelopes and projections" },
  { id: "permissions", href: "/operations/events/permissions", label: "Permissions", description: "Review producer and concurrency boundaries" },
  { id: "sync", href: "/operations/events/sync", label: "Canvas sync", description: "Inspect convergence and offline operation delivery" },
] as const;

const laboratory = [
  { id: "replay", href: "/laboratory/replay", label: "Replay", description: "Rehearse theoretical and provider-backed workflows" },
  { id: "focal-points", href: "/laboratory/focal-points", label: "Focal points", description: "Compare image focal-point calculations" },
] as const;

export class AreaNavigation extends FormaElement {
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
      ? operations.filter((item) => item.id === "system" || session?.user.role === "admin")
      : area === "laboratory"
        ? laboratory.filter(() => session?.user.role === "admin")
        : intelligence;
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

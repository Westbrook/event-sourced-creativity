import { html } from "lit";
import { FormaPresentationalElement } from "../../components/presentational-element";

export function loadEngineeringRoute(path: string): Promise<unknown> {
  void path;
  return import("./diagnostics");
}

export class FormaEngineeringApplication extends FormaPresentationalElement {
  override render() {
    const view=location.pathname.endsWith("/sync")?"sync":location.pathname.includes("events")?"events":location.pathname.endsWith("/jobs")?"jobs":"health";
    return html`<forma-engineering-diagnostics .view=${view}></forma-engineering-diagnostics>`;
  }
}

if (!customElements.get("forma-engineering-application")) customElements.define("forma-engineering-application", FormaEngineeringApplication);

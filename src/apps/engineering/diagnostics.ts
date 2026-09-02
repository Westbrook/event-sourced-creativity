import { FormaRoleDashboard } from "../../components/forma-role-dashboard";
import { html, nothing } from "lit";
import { platformSession } from "../../platform/session-controller";

export class FormaEngineeringDiagnostics extends FormaRoleDashboard {
  static properties={view:{type:String}};
  view:"health"|"events"|"sync"|"jobs"="health";
  #schema = "";
  #schemaIssue = "";
  #schemaPending = false;
  #schemaRevision = 0;
  #unsubscribe?: () => void;
  #canInspectSchema() {
    const session = platformSession.get();
    return this.reportReadOutcome !== "denied" && session?.audience === "engineering" && session.capabilities.includes("platform.identity.manage")
      && session.capabilities.includes("engineering.diagnostics.read");
  }
  #retireSchema() {
    this.#schemaRevision++;
    this.#schema = "";
    this.#schemaIssue = "";
    this.#schemaPending = false;
    this.requestUpdate();
  }
  protected override reportDenied() {
    this.#retireSchema();
    super.reportDenied();
  }
  override connectedCallback() {
    super.connectedCallback();
    this.#unsubscribe = platformSession.subscribe(() => this.#retireSchema());
  }
  override disconnectedCallback() {
    this.#unsubscribe?.();
    this.#retireSchema();
    super.disconnectedCallback();
  }
  async #inspectSchema() {
    if (!this.#canInspectSchema() || this.#schemaPending) return;
    this.#retireSchema();
    const revision = this.#schemaRevision, session = platformSession.get(), route = location.pathname + location.search;
    const current = () => this.isConnected && revision === this.#schemaRevision && session === platformSession.get()
      && route === location.pathname + location.search && this.#canInspectSchema();
    this.#schemaPending = true;
    this.requestUpdate();
    try {
      const response = await fetch("/api/portfolio/engineering/schema-preflight", { credentials: "same-origin", cache: "no-store" });
      const body = await response.json();
      if (!current()) return;
      if (!response.ok || body.contract !== "forma.output-schema-preflight.v1" || body.complete !== true) throw new Error("unavailable");
      this.#schema = JSON.stringify(body, null, 2);
    } catch {
      if (current()) this.#schemaIssue = "unavailable";
    } finally {
      if (current()) { this.#schemaPending = false; this.requestUpdate(); }
    }
  }
  protected endpoint=`/api/portfolio/engineering/${location.pathname.endsWith("/sync")?"sync":location.pathname.includes("events")?"events":location.pathname.endsWith("/jobs")?"jobs":"health"}`;
  protected override willUpdate(changed:Map<PropertyKey,unknown>){
    if(changed.has("view")){
      this.#retireSchema();
      const endpoint=`/api/portfolio/engineering/${this.view}`;
      if(endpoint!==this.endpoint){this.endpoint=endpoint;this.report=null;if(this.hasUpdated)void this.refresh();}
    }
  }
  override render() { return html`${this.dashboard(this.i18n.t("shell.engineering", "Engineering Diagnostics"), this.i18n.t(`engineering.${this.view}.heading`,this.i18n.t("engineering.heading", "Service reliability")), this.i18n.t(`engineering.${this.view}.description`,this.i18n.t("engineering.description", "Redacted operational evidence only. Customer identity, document text, private media, and production approvals never appear in this diagnostic surface.")))}
    ${this.view === "health" && this.#canInspectSchema() ? html`<section class="role-dashboard page-pad" aria-labelledby="schema-preflight-heading">
      <h2 id="schema-preflight-heading">${this.i18n.t("engineering.schema.heading", "Output schema preflight")}</h2>
      <p>${this.i18n.t("engineering.schema.description", "Read database structure and aggregate counts only. This does not migrate data, authorize release, or start generation.")}</p>
      <button type="button" class="button secondary" ?disabled=${this.#schemaPending} @click=${() => this.#inspectSchema()}>${this.i18n.t("engineering.schema.inspect", "Inspect schema metadata")}</button>
      ${this.#schemaPending ? html`<p role="status">${this.i18n.t("role.loading", "Loading approved evidence…")}</p>` : nothing}
      ${this.#schemaIssue ? html`<p role="alert">${this.i18n.t("engineering.schema.unavailable", "Schema metadata is unavailable. Return to your principal account and check both administrative permissions.")}</p>` : nothing}
      ${this.#schema ? html`<pre tabindex="0" aria-label=${this.i18n.t("engineering.schema.heading", "Output schema preflight")} style="max-inline-size:100%;white-space:pre-wrap;overflow-wrap:anywhere">${this.#schema}</pre>` : nothing}
    </section>` : nothing}`; }
}

if (!customElements.get("forma-engineering-diagnostics")) customElements.define("forma-engineering-diagnostics", FormaEngineeringDiagnostics);

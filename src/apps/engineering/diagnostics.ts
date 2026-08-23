import { FormaRoleDashboard } from "../../components/forma-role-dashboard";

export class FormaEngineeringDiagnostics extends FormaRoleDashboard {
  static properties={view:{type:String}};
  view:"health"|"events"|"sync"|"jobs"="health";
  protected endpoint=`/api/portfolio/engineering/${location.pathname.endsWith("/sync")?"sync":location.pathname.includes("events")?"events":location.pathname.endsWith("/jobs")?"jobs":"health"}`;
  protected override willUpdate(changed:Map<PropertyKey,unknown>){
    if(changed.has("view")){
      const endpoint=`/api/portfolio/engineering/${this.view}`;
      if(endpoint!==this.endpoint){this.endpoint=endpoint;this.report=null;if(this.hasUpdated)void this.refresh();}
    }
  }
  override render() { return this.dashboard(this.i18n.t("shell.engineering", "Engineering Diagnostics"), this.i18n.t(`engineering.${this.view}.heading`,this.i18n.t("engineering.heading", "Service reliability")), this.i18n.t(`engineering.${this.view}.description`,this.i18n.t("engineering.description", "Redacted operational evidence only. Customer identity, document text, private media, and production approvals never appear in this diagnostic surface."))); }
}

if (!customElements.get("forma-engineering-diagnostics")) customElements.define("forma-engineering-diagnostics", FormaEngineeringDiagnostics);

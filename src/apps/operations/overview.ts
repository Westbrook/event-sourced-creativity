import { FormaRoleDashboard } from "../../components/forma-role-dashboard";

/** Policy and incident operators see aggregate service health without creator or provider data. */
export class FormaOperationsOverview extends FormaRoleDashboard {
  protected endpoint = "/api/portfolio/operations/overview";
  override render() {
    return this.dashboard(
      this.i18n.t("shell.operations", "Platform Operations"),
      this.i18n.t("operations.overview.heading", "Platform oversight"),
      this.i18n.t("operations.overview.description", "Review bounded service health and release decisions. Creator content, customer identities, provider credentials, and financial limits are never exposed."),
    );
  }
}

if (!customElements.get("forma-operations-overview")) customElements.define("forma-operations-overview", FormaOperationsOverview);

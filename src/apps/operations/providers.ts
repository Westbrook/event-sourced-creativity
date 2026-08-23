import { FormaRoleDashboard } from "../../components/forma-role-dashboard";

/** Provider operators inspect bounded configuration readiness without budgets, secrets, or creator work. */
export class FormaOperationsProviders extends FormaRoleDashboard {
  protected endpoint = "/api/portfolio/operations/providers";
  override render() {
    return this.dashboard(
      this.i18n.t("shell.operations", "Platform Operations"),
      this.i18n.t("operations.providers.heading", "Provider readiness"),
      this.i18n.t("operations.providers.description", "Inspect approved provider availability and frozen qualification. Secrets, customer material, paid execution, and release approval remain separate."),
    );
  }
}

if (!customElements.get("forma-operations-providers")) customElements.define("forma-operations-providers", FormaOperationsProviders);

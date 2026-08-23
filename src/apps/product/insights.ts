import { FormaRoleDashboard } from "../../components/forma-role-dashboard";

export class FormaProductInsights extends FormaRoleDashboard {
  protected endpoint = "/api/portfolio/product/insights";
  override render() { return this.dashboard(this.i18n.t("shell.product", "Product & Quality"), this.i18n.t("product.insights.heading", "Product outcomes"), this.i18n.t("product.insights.description", "Privacy-preserving, aggregate-only evidence about useful creative work. Names, documents, prompts, media, and small cohorts are never included.")); }
}

if (!customElements.get("forma-product-insights")) customElements.define("forma-product-insights", FormaProductInsights);

import { html, nothing } from "lit";
import { FormaPresentationalElement } from "./presentational-element";
import { consumeRoutePrefetch } from "../state/session-bootstrap";

export type RoleMetric = { id: string; label: string; value: string | number | null; detail: string; values?: Record<string, string | number> };
export type RoleEvidence = { id: string; label: string; status: "passed" | "pending" | "approval_required" | "blocked"; detail: string; values?: Record<string, string | number> };
export type DeliveryDecision = { decisionId: string; title: string; audience: string; status: string; owner: string; ownerUserId?:string; evidence: string; dependencyIds: string[]; createdAt: string; updatedAt: string };
export type QualificationReport = { corpusVersion: string; evaluationRef: string; adapterVersion: string; status: string; passed: boolean; caseCount: number; evaluatedPairs: number; candidateUsable: number; referenceUsable: number; referenceEvaluated: number; finding: string };
export type ProductQualification = { corpusVersion: string; corpusHash: string; caseCount: number; adapterVersion: string; passed: boolean; productionApproved: boolean; reports: QualificationReport[] };
export type RoleReport = {
  id: string;
  scope: string;
  refreshedAt: string;
  synthetic: boolean;
  metrics: RoleMetric[];
  evidence: RoleEvidence[];
  decisions?: DeliveryDecision[];
  owners?:Array<{userId:string;displayName:string}>;
  approvalAuthority?:boolean;
  qualification?: ProductQualification;
};

/** Bounded internal dashboards consume only role-approved server projections. */
export abstract class FormaRoleDashboard extends FormaPresentationalElement {
  protected report: RoleReport | null = null;
  protected issue = "";
  protected dashboardHeadingLevel:1|2=1;
  protected abstract endpoint: string;
  #refreshVersion=0;

  override connectedCallback() {
    super.connectedCallback();
    void this.updateComplete.then(()=>{if(this.isConnected)void this.refresh();});
  }

  protected async refresh() {
    const version=++this.#refreshVersion;
    const endpoint=this.endpoint;
    try {
      const prefetched=consumeRoutePrefetch(endpoint);
      const response=(prefetched?await prefetched:null)??await fetch(endpoint, { credentials: "same-origin" });
      const body = await response.json() as { report?: RoleReport; error?: string };
      if(version!==this.#refreshVersion||endpoint!==this.endpoint||!this.isConnected)return;
      if (!response.ok || !body.report) throw new Error(body.error ?? "Approved reporting is unavailable.");
      this.report = body.report;
      this.issue = "";
    } catch (error) {
      if(version!==this.#refreshVersion||endpoint!==this.endpoint||!this.isConnected)return;
      this.issue = error instanceof Error ? error.message : "Approved reporting is unavailable.";
    }
    this.requestUpdate();
  }

  protected dashboard(eyebrow: string, title: string, description: string) {
    const report = this.report;
    const priority:Record<RoleEvidence["status"],number>={blocked:0,approval_required:1,pending:2,passed:3};
    const evidence=report?[...report.evidence].sort((left,right)=>priority[left.status]-priority[right.status]):[];
    return html`<section class="role-dashboard page-pad" aria-labelledby="role-dashboard-heading"><header class="page-header page-header--hero"><div class="page-header-copy"><span class="eyebrow">${eyebrow}</span>${this.dashboardHeadingLevel===1?html`<h1 id="role-dashboard-heading">${title}</h1>`:html`<h2 id="role-dashboard-heading">${title}</h2>`}<p>${description}</p></div><button type="button" class="button secondary compact" @click=${() => this.refresh()}>${this.i18n.t("role.refresh", "Refresh evidence")}</button></header>
      ${this.issue ? html`<p class="role-dashboard-error" role="alert">${this.i18n.system(this.issue)}</p>` : !report ? html`<p role="status">${this.i18n.t("role.loading", "Loading approved evidence…")}</p>` : html`
      <p class="role-dashboard-scope"><strong>${this.i18n.t("role.scope", "Scope")}:</strong> ${this.i18n.t(`report.scope.${report.id}`,report.scope)} · <strong>${this.i18n.t("role.refreshed", "Refreshed")}:</strong> ${this.i18n.date(new Date(report.refreshedAt), { dateStyle: "medium", timeStyle: "short" })}${report.synthetic ? html` · <strong>${this.i18n.t("role.syntheticOnly", "Frozen fictional-context evaluation; historical provider results")}</strong>` : nothing}</p>
      <section class="role-evidence" aria-labelledby="role-evidence-heading" ?data-forma-empty-state=${!evidence.length}><h2 id="role-evidence-heading">${this.i18n.t("role.evidence", "Current evidence and decisions")}</h2>${evidence.length?html`<ol>${evidence.map((item) => html`<li data-forma-content="primary"><div><strong>${this.i18n.t(`report.evidence.${item.id}.label`,item.label,item.values)}</strong><p>${this.i18n.t(`report.evidence.${item.id}.detail`,item.detail,item.values)}</p></div><span class=${`role-evidence-state role-evidence-state--${item.status}`}>${this.i18n.t(`role.status.${item.status}`, item.status.replaceAll("_", " "))}</span></li>`)}</ol>`:html`<p>${this.i18n.t("workbench.noTasks","No active tasks")}</p>`}</section>
      <section class="role-metric-grid" aria-label=${this.i18n.t("role.metrics", "Approved decision measures")}>${report.metrics.slice(0, 5).map((metric) => html`<article class="role-metric-card"><h2>${this.i18n.t(`report.metric.${metric.id}.label`,metric.label,metric.values)}</h2><p class="role-metric-value">${typeof metric.value==="number"?this.i18n.number(metric.value):metric.value===null?this.i18n.t("role.notMeasured", "Not measured"):metric.id==="videoProviderReady"?this.i18n.t(`report.metric.videoProviderReady.value.${metric.value}`,metric.value):metric.value}</p><p>${this.i18n.t(`report.metric.${metric.id}.detail`,metric.detail,metric.values)}</p></article>`)}</section>`}
    </section>`;
  }
}

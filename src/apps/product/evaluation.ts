import { html, nothing } from "lit";
import { FormaRoleDashboard } from "../../components/forma-role-dashboard";
import { platformSession } from "../../platform/session-controller";
import type { FormaPlatformShell } from "../../components/forma-platform-shell";

export class FormaProductEvaluation extends FormaRoleDashboard {
  protected endpoint = "/api/portfolio/product/evaluation";

  #openTool(event: MouseEvent, path: string) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.currentTarget as HTMLAnchorElement;
    const target = anchor.getAttribute("target");
    if (anchor.getAttribute("href") !== path || anchor.hasAttribute("download") || target && target.toLowerCase() !== "_self") return;
    const host = this.closest<FormaPlatformShell>("forma-platform-shell");
    if (!host) return;
    event.preventDefault();
    host.navigateFrom(this, path);
  }
  override render() {
    const qualification=this.report?.qualification;
    const session=platformSession.get();
    return html`${this.dashboard(this.i18n.t("shell.product", "Product & Quality"), this.i18n.t("product.evaluation.heading", "Evaluation evidence"), this.i18n.t("product.evaluation.description", "Synthetic evaluation and approved qualification evidence. Provider activation, paid execution, and customer content require separate authorization."))}
      <nav class="evaluation-tools page-pad" aria-label=${this.i18n.t("evaluation.tools","Authorized evaluation tools")}>${session?.capabilities.includes("evaluation.synthetic.read")||session?.capabilities.includes("evaluation.synthetic.run")?html`<a class="button secondary" href="/product/evaluation/replay" @click=${(event:MouseEvent)=>this.#openTool(event,"/product/evaluation/replay")}>${this.i18n.t("evaluation.syntheticReplay","Open fictional replay")}</a>`:nothing}${session?.capabilities.includes("evaluation.qualification.read")||session?.capabilities.includes("evaluation.qualification.run")?html`<a class="button secondary" href="/product/evaluation/adapters" @click=${(event:MouseEvent)=>this.#openTool(event,"/product/evaluation/adapters")}>${this.i18n.t("evaluation.adapterPreview","Inspect adapter contract simulations")}</a>`:nothing}${session?.user.role==="admin"&&session.capabilities.includes("evaluation.actual.run")?html`<a class="button secondary" href="/product/evaluation/actual" @click=${(event:MouseEvent)=>this.#openTool(event,"/product/evaluation/actual")}>${this.i18n.t("evaluation.actualReplay","Review approved replay sessions")}</a>`:nothing}</nav>
      ${qualification?html`<section class="qualification-evidence page-pad" aria-labelledby="qualification-evidence-heading"><h2 id="qualification-evidence-heading">${this.i18n.t("evaluation.history","Retained qualification history")}</h2><p><strong>${this.i18n.t("evaluation.corpus","Frozen corpus")}</strong> <code>${qualification.corpusVersion}</code> · ${this.i18n.number(qualification.caseCount)} ${this.i18n.t("evaluation.cases","cases")}</p><p><strong>${this.i18n.t("evaluation.qualification","Qualification")}</strong> ${this.i18n.t(`role.status.${qualification.passed?"passed":"blocked"}`,qualification.passed?"Passed":"Blocked")} · <strong>${this.i18n.t("evaluation.approval","Production approval")}</strong> ${this.i18n.t(`role.status.${qualification.productionApproved?"passed":"approval_required"}`,qualification.productionApproved?"Passed":"Approval required")}</p>
      <div class="qualification-evidence-table"><table><caption>${this.i18n.t("evaluation.historyCaption","Immutable historical results from frozen fictional-context evaluations")}</caption><thead><tr><th scope="col">${this.i18n.t("evaluation.version","Adapter version")}</th><th scope="col">${this.i18n.t("evaluation.outcome","Outcome")}</th><th scope="col">${this.i18n.t("evaluation.usable","Usable results")}</th><th scope="col">${this.i18n.t("evaluation.references","Usable references")}</th><th scope="col">${this.i18n.t("evaluation.finding","Finding")}</th></tr></thead><tbody>${qualification.reports.map((item)=>html`<tr><th scope="row">${item.adapterVersion}</th><td>${this.i18n.t(`role.status.${item.passed?"passed":"blocked"}`,item.passed?"Passed":"Blocked")}</td><td>${this.i18n.number(item.candidateUsable)}/${this.i18n.number(item.evaluatedPairs)}</td><td>${this.i18n.number(item.referenceUsable)}/${this.i18n.number(item.referenceEvaluated)}</td><td dir="auto">${item.finding}</td></tr>`)}</tbody></table></div><p>${this.i18n.t("evaluation.historicalOnly","These provider results are historical. This page never starts a new paid operation or approves production.")}</p></section>`:nothing}`;
  }
}

if (!customElements.get("forma-product-evaluation")) customElements.define("forma-product-evaluation", FormaProductEvaluation);

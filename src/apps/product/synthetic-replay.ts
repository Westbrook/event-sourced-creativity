import { html, nothing } from "lit";
import { FormaPresentationalElement } from "../../components/presentational-element";
import { buildComprehensiveScenario, SCENARIO_EVENT_TYPES, SCENARIOS } from "../../model/scenarios";
import { evaluateReplayCoverage } from "../../model/replay-coverage";
import type { CreativeEvent } from "../../model/events";
import { platformSession } from "../../platform/session-controller";

/** Pure in-memory rehearsal: never reads account history, starts a provider, or writes records. */
export class FormaSyntheticReplay extends FormaPresentationalElement {
  #events:CreativeEvent[]=[];
  #count=1000;

  #rehearse(event:SubmitEvent){
    event.preventDefault();
    if(!platformSession.get()?.capabilities.includes("evaluation.synthetic.run"))return;
    this.#events=buildComprehensiveScenario("fictional:isolated-product-evaluation",this.#count);
    this.requestUpdate();
  }

  override render(){
    const coverage=this.#events.length?evaluateReplayCoverage(this.#events,SCENARIO_EVENT_TYPES):null;
    const canRun=platformSession.get()?.capabilities.includes("evaluation.synthetic.run")===true;
    const canReviewActual=platformSession.get()?.user.role==="admin"&&platformSession.get()?.capabilities.includes("evaluation.actual.run");
    return html`<section class="synthetic-replay page-pad" aria-labelledby="synthetic-replay-heading"><header class="page-header page-header--hero"><div class="page-header-copy"><span class="eyebrow">${this.i18n.t("shell.product","Product & Quality")}</span><h1 id="synthetic-replay-heading">${this.i18n.t("replay.synthetic.heading","Fictional workflow rehearsal")}</h1><p>${this.i18n.t("replay.synthetic.description","Rehearse complete creative workflows using isolated fictional events. No customer history is loaded, no record is written, and no provider is contacted.")}</p></div></header>
      ${canRun?html`<form class="synthetic-replay-controls" @submit=${(event:SubmitEvent)=>this.#rehearse(event)}><label>${this.i18n.t("replay.synthetic.eventCount","Fictional event count")}<select .value=${String(this.#count)} @change=${(event:Event)=>{this.#count=Number((event.target as HTMLSelectElement).value);}}>${[250,1000,2500,5000].map((count)=>html`<option value=${count}>${this.i18n.number(count)}</option>`)}</select></label><button class="button primary" type="submit">${this.i18n.t("replay.synthetic.run","Run free fictional rehearsal")}</button></form>`:html`<p role="note">${this.i18n.t("replay.synthetic.readOnly","Your access allows reviewing fictional scenarios; running a rehearsal requires its separately granted execution capability.")}</p>`}
      ${canReviewActual?html`<a class="button secondary" href="/product/evaluation/actual">${this.i18n.t("evaluation.actualReplay","Review approved replay sessions")}</a>`:nothing}
      <p>${this.i18n.t("replay.synthetic.scenarios","Available fictional scenario families")}: ${this.i18n.number(SCENARIOS.length)}</p>
      ${coverage?html`<section class="replay-coverage-summary" aria-labelledby="synthetic-coverage-heading"><h2 id="synthetic-coverage-heading">${this.i18n.t("replay.synthetic.coverage","Workflow coverage")}</h2><p role="status">${this.i18n.number(coverage.passedCount)} / ${this.i18n.number(coverage.total)} ${this.i18n.t("replay.synthetic.checks","checks passed")}</p><ol>${coverage.checks.map((check)=>html`<li><strong>${check.label}</strong> · ${this.i18n.t(`role.status.${check.passed?"passed":"blocked"}`,check.passed?"Passed":"Blocked")}<p>${check.summary}</p></li>`)}</ol></section><section aria-labelledby="synthetic-events-heading"><h2 id="synthetic-events-heading">${this.i18n.t("replay.synthetic.timeline","Fictional event timeline")}</h2><ol>${this.#events.slice(0,40).map((event)=>html`<li>${this.i18n.number(event.sequence)} · <code>${event.type}</code></li>`)}</ol></section>`:nothing}
    </section>`;
  }
}

if(!customElements.get("forma-synthetic-replay"))customElements.define("forma-synthetic-replay",FormaSyntheticReplay);

import { html, nothing } from "lit";
import { FormaRoleDashboard, type DeliveryDecision } from "../../components/forma-role-dashboard";
import { APPLICATIONS } from "../../platform/applications";
import { DELIVERY_DECISION_STATUSES, deliveryNeedsReleaseAuthority, deliveryTransitionAllowed } from "../../platform/delivery-lifecycle";
import { platformSession } from "../../platform/session-controller";

export class FormaProductDelivery extends FormaRoleDashboard {
  protected endpoint = "/api/portfolio/product/delivery";
  protected override dashboardHeadingLevel:1|2=2;
  #saving=false;
  #notice="";
  #failed=false;

  async #create(event:SubmitEvent){
    event.preventDefault();if(this.#saving)return;
    const form=event.currentTarget as HTMLFormElement;
    const values=new FormData(form);
    await this.#mutate("POST",{title:String(values.get("title")??""),audience:String(values.get("audience")??""),evidence:String(values.get("evidence")??""),ownerUserId:String(values.get("ownerUserId")??""),dependencyIds:values.getAll("dependencies").map(String)},()=>form.reset());
  }

  async #update(event:SubmitEvent,decision:DeliveryDecision){
    event.preventDefault();
    const values=new FormData(event.currentTarget as HTMLFormElement);
    await this.#mutate("PATCH",{decisionId:decision.decisionId,title:String(values.get("title")??""),evidence:String(values.get("evidence")??""),ownerUserId:String(values.get("ownerUserId")??""),status:String(values.get("status")??""),expectedUpdatedAt:decision.updatedAt});
  }

  async #mutate(method:"POST"|"PATCH",body:Record<string,unknown>,done?:()=>void){
    if(this.#saving)return;this.#saving=true;this.#notice="";this.#failed=false;this.requestUpdate();
    try{
      const response=await fetch(this.endpoint,{method,headers:{"content-type":"application/json"},body:JSON.stringify(body)});
      const result=await response.json() as {error?:string};
      if(!response.ok){
        const key=String(result.error??"");
        const fallback=key==="delivery_decision_revision_conflict"?this.i18n.t("delivery.conflict","This decision changed. Refresh it and try again."):this.i18n.t("delivery.failed","The delivery decision could not be saved.");
        throw new Error(this.i18n.t(`delivery.error.${key}`,fallback));
      }
      done?.();this.#notice=this.i18n.t("delivery.saved","Delivery decision saved.");await this.refresh();
    }catch(error){this.#failed=true;this.#notice=error instanceof Error?error.message:this.i18n.t("delivery.failed","The delivery decision could not be saved.");}
    finally{this.#saving=false;this.requestUpdate();}
  }

  override render() {
    const decisions=this.report?.decisions??[];
    const readsDecisions=Array.isArray(this.report?.decisions);
    const canManage=platformSession.get()?.capabilities.includes("product.delivery.manage")??false;
    const approvalAuthority=this.report?.approvalAuthority===true;
    const owners=this.report?.owners??[];
    const byId=new Map(decisions.map((decision)=>[decision.decisionId,decision]));
    if(!this.report||this.issue)return html`<section class="delivery-planning page-pad" aria-labelledby="delivery-planning-heading"><h1 id="delivery-planning-heading">${this.i18n.t("delivery.decisions","Delivery decisions")}</h1>${this.issue?html`<p role="alert">${this.i18n.system(this.issue)}</p><button type="button" class="button secondary compact" @click=${()=>this.refresh()}>${this.i18n.t("role.refresh","Refresh evidence")}</button>`:html`<p role="status">${this.i18n.t("role.loading","Loading approved evidence…")}</p>`}</section>`;
    const decisionPriority:Record<string,number>={failed:0,approval_required:1,running:2,planned:3,passed:4,approved:5,revoked:6,superseded:7};
    const visibleDecisions=[...decisions].sort((left,right)=>(decisionPriority[left.status]??8)-(decisionPriority[right.status]??8)||Date.parse(right.updatedAt)-Date.parse(left.updatedAt));
    return html`
      ${!readsDecisions?html`<section class="delivery-planning page-pad"><h1>${this.i18n.t("delivery.decisions","Delivery decisions")}</h1><p>${this.i18n.t("delivery.evidenceOnly","Your authorization includes release evidence and aggregate readiness; individual delivery decisions require separate access.")}</p></section>`:html`
      <section class="delivery-planning page-pad" aria-labelledby="delivery-planning-heading"><h1 id="delivery-planning-heading">${this.i18n.t("delivery.decisions","Delivery decisions")}</h1>
      ${this.#notice?html`<p role=${this.#failed?"alert":"status"} aria-live=${this.#failed?"assertive":"polite"}>${this.#notice}</p>`:nothing}
      ${visibleDecisions.length?html`<ol class="delivery-decision-list">${visibleDecisions.map((decision)=>{const locked=["approved","revoked"].includes(decision.status)&&!approvalAuthority;const editable=canManage&&!locked;return html`<li data-forma-content="primary"><article><header><h2 dir="auto">${decision.title}</h2><span>${this.i18n.t(`shell.${decision.audience}`,decision.audience)}</span></header><dl><div><dt>${this.i18n.t("delivery.owner","Owner")}</dt><dd dir="auto">${decision.owner}</dd></div><div><dt>${this.i18n.t("delivery.status","Status")}</dt><dd>${this.i18n.t(`delivery.status.${decision.status}`,decision.status)}</dd></div>${decision.dependencyIds.length?html`<div><dt>${this.i18n.t("delivery.dependencies","Existing dependencies")}</dt><dd dir="auto">${decision.dependencyIds.map((dependency)=>byId.get(dependency)?.title??this.i18n.t("delivery.unavailableDependency","Unavailable decision")).join(" · ")}</dd></div>`:nothing}</dl>${editable?html`<form class="delivery-decision-form" @submit=${(event:SubmitEvent)=>this.#update(event,decision)}><label>${this.i18n.t("delivery.title","Decision or milestone")}<input name="title" required maxlength="160" dir="auto" .value=${decision.title}></label><label>${this.i18n.t("delivery.owner","Owner")}<select name="ownerUserId" .value=${decision.ownerUserId??""}>${owners.map((owner)=>html`<option value=${owner.userId} ?selected=${owner.userId===decision.ownerUserId}>${owner.displayName}</option>`)}</select></label><label>${this.i18n.t("delivery.evidence","Current evidence")}<textarea name="evidence" maxlength="800" dir="auto" .value=${decision.evidence}></textarea></label><label>${this.i18n.t("delivery.status","Status")}<select name="status" .value=${decision.status}>${DELIVERY_DECISION_STATUSES.filter((status)=>deliveryTransitionAllowed(decision.status,status)&&(approvalAuthority||!deliveryNeedsReleaseAuthority(status))).map((status)=>html`<option value=${status} ?selected=${status===decision.status}>${this.i18n.t(`delivery.status.${status}`,status)}</option>`)}</select></label><button class="button secondary compact" type="submit" aria-label=${this.i18n.t("delivery.saveNamed","Save decision {name}",{name:`\u2068${decision.title}\u2069`})} ?disabled=${this.#saving}>${this.#saving?this.i18n.t("delivery.saving","Saving…"):this.i18n.t("delivery.save","Save decision")}</button></form>`:html`${decision.evidence?html`<p dir="auto">${decision.evidence}</p>`:nothing}${locked?html`<p>${this.i18n.t("delivery.approvalLocked","An approved or revoked decision can only be changed by a release approver.")}</p>`:nothing}`}</article></li>`;})}</ol>`:html`<p data-forma-empty-state>${this.i18n.t("delivery.empty","No delivery decisions have been recorded yet.")}</p>`}
      ${canManage?html`<form class="delivery-decision-form" @submit=${(event:SubmitEvent)=>this.#create(event)}><label>${this.i18n.t("delivery.title","Decision or milestone")}<input name="title" required maxlength="160" dir="auto"></label><label>${this.i18n.t("delivery.audience","Audience")}<select name="audience" required>${APPLICATIONS.map((application)=>html`<option value=${application.id}>${this.i18n.t(`shell.${application.id}`,application.label)}</option>`)}</select></label><label>${this.i18n.t("delivery.owner","Owner")}<select name="ownerUserId"><option value="">${this.i18n.t("delivery.owner.me","Assign to me")}</option>${owners.map((owner)=>html`<option value=${owner.userId}>${owner.displayName}</option>`)}</select></label><label>${this.i18n.t("delivery.evidence","Current evidence")}<textarea name="evidence" maxlength="800" dir="auto"></textarea></label>${decisions.length?html`<label>${this.i18n.t("delivery.dependencies","Existing dependencies")}<select name="dependencies" multiple>${decisions.map((decision)=>html`<option value=${decision.decisionId}>${decision.title}</option>`)}</select></label>`:nothing}<button class="button primary" type="submit" ?disabled=${this.#saving}>${this.#saving?this.i18n.t("delivery.saving","Saving…"):this.i18n.t("delivery.add","Add delivery decision")}</button></form>`:html`<p>${this.i18n.t("delivery.readOnly","Your access allows review; managing decisions requires a separate authorization.")}</p>`}
      </section>`}
      ${this.dashboard(this.i18n.t("shell.product", "Product & Quality"), this.i18n.t("product.delivery.heading", "Delivery readiness"), this.i18n.t("product.delivery.description", "Current delivery decisions, ownership, dependencies, and evidence. Human approvals remain explicit."))}`;
  }
}

if (!customElements.get("forma-product-delivery")) customElements.define("forma-product-delivery", FormaProductDelivery);

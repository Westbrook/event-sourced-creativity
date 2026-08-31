import { html, noChange, nothing } from "lit";
import type { CommandDeparture } from "../../components/command-departure";
import { repeat } from "lit/directives/repeat.js";
import { qualifyDisplayCollisions } from "../../model/output-naming";
import { FormaRoleDashboard, type DeliveryDecision } from "../../components/forma-role-dashboard";
import { APPLICATIONS } from "../../platform/applications";
import { DELIVERY_DECISION_STATUSES, deliveryNeedsReleaseAuthority, deliveryTransitionAllowed } from "../../platform/delivery-lifecycle";
import { deliveryCreateIntentDigest, readDeliveryCreateReceipt, type DeliveryCreateIntent } from "../../platform/delivery-create-receipt";
import { platformSession } from "../../platform/session-controller";

type DeliveryNotice = { key: string; fallback: string; fallbackKey?: string; values?: Record<string, string | number>; afterRefresh?: DeliveryNotice };

export class FormaProductDelivery extends FormaRoleDashboard {
  protected endpoint = "/api/portfolio/product/delivery";
  protected override dashboardHeadingLevel:1|2=2;
  #saving=false;
  #notice: DeliveryNotice | null = null;
  #failed=false;

  #lifetime = 0;
  #resourceRoute = "";
  #save: object | null = null;
  #createIntent: { requestId: string; intent: DeliveryCreateIntent; originalFields: string;
    actorUserId: string; scope: string; form: HTMLFormElement | null; uncertain: boolean; digest?: string } | null = null;
  #unsubscribe?: () => void;
  #retire = () => {
    this.#lifetime += 1; this.#save = null; this.#saving = false; this.#createIntent = null;
    this.#notice = null; this.#failed = false; this.report = null; this.issue = ""; this.reportReadOutcome = "unavailable"; this.requestUpdate();
  };
  #sessionChanged = () => { this.#retire(); if (platformSession.get()?.audience === "product" && this.isConnected) void this.refresh(); };

  override connectedCallback() {
    this.#resourceRoute = location.pathname + location.search;
    super.connectedCallback(); this.#unsubscribe = platformSession.subscribe(this.#sessionChanged);
    window.addEventListener("popstate", this.#popstate);
  }

  override disconnectedCallback() {
    this.#retire(); this.#unsubscribe?.(); this.#unsubscribe = undefined;
    window.removeEventListener("popstate", this.#popstate); super.disconnectedCallback();
  }

  #scope() {
    const session = platformSession.get();
    return session?.audience === "product" && location.pathname.replace(/\/+$/, "") === "/product/delivery"
      ? JSON.stringify([location.pathname, location.search, session.user, session.audience,
        session.permissionEpoch, [...session.capabilities].sort()]) : "";
  }

  #popstate = () => {
    const route = location.pathname + location.search;
    if (route === this.#resourceRoute) return;
    this.#resourceRoute = route;
    this.#retire();
  };

  #departureForms() {
    return { create: this.#createForm(), decisions: [...this.querySelectorAll<HTMLFormElement>("form[data-delivery-decision-id]")]
      .filter(form => form.isConnected && this.contains(form) && Boolean(form.getAttribute("data-delivery-decision-id"))) };
  }

  #departureBlocked() {
    if (!this.#scope() || !this.report || this.reportReadOutcome === "denied"
      || !platformSession.get()?.capabilities.includes("product.delivery.manage")) return false;
    if (this.#saving) return true;
    const forms = this.#departureForms();
    if (forms.decisions.some(form => form.getAttribute("data-delivery-dirty") === "true")) return true;
    if (!forms.create) return false;
    const fields = this.#createFields(forms.create), original = this.#createIntent;
    // Already submitted A is not a new draft or a permanent uncertainty lock.
    // B remains native-owned. Multiple selection has no ordering operation.
    if (original?.uncertain && original.form === forms.create && original.scope === this.#scope()
      && original.actorUserId === platformSession.get()?.user.userId) {
      const submitted = JSON.parse(original.originalFields) as typeof fields;
      if (JSON.stringify({ ...fields, dependencyIds: [...fields.dependencyIds].sort() })
        === JSON.stringify({ ...submitted, dependencyIds: [...submitted.dependencyIds].sort() })) return false;
    }
    // These are the actual create template's empty text, first audience, self
    // owner and no-dependency defaults; use raw values, not trimmed intent.
    return fields.title !== "" || fields.evidence !== "" || fields.audience !== APPLICATIONS[0].id
      || fields.ownerUserId !== "" || fields.dependencyIds.length > 0;
  }

  captureCommandDeparture(): Omit<CommandDeparture, "element"> & { readonly element: HTMLElement } {
    const lifetime = this.#lifetime, scope = this.#scope(), session = platformSession.get(), forms = this.#departureForms();
    let retired = false;
    const current = () => {
      if (retired) return false;
      const now = this.#departureForms();
      if (!this.isConnected || lifetime !== this.#lifetime || scope !== this.#scope()
        || session !== platformSession.get() || now.create !== forms.create
        || now.decisions.length !== forms.decisions.length
        || forms.decisions.some(form => !form.isConnected
          || this.#decisionForm(form.getAttribute("data-delivery-decision-id")!) !== form)) retired = true;
      return !retired;
    };
    return { element: this, current, blocked: () => this.#departureBlocked(),
      reason: () => "next.lifecycle.currentWorkOpen" };
  }

  #noticeText() {
    const notice = this.#notice;
    return notice ? this.i18n.t(notice.key, notice.fallbackKey ? this.i18n.t(notice.fallbackKey, notice.fallback) : notice.fallback, notice.values ?? {}) : "";
  }

  protected override reportDenied() {
    super.reportDenied();
    // Revoke presentation and in-flight publication, not the identity of a
    // dispatched original. Never reconnect its former private draft form.
    this.#lifetime += 1; this.#save = null; this.#saving = false;
    if (this.#createIntent?.uncertain) {
      this.#createIntent.form = null; this.#createIntent.originalFields = "";
      this.#failed = true;
      this.#notice = { key: "delivery.originalWithdrawn", fallback: "The original save is still unconfirmed. Private draft controls were withdrawn. Refresh access before explicitly retrying that same original save." };
    } else this.#createIntent = null;
    this.requestUpdate();
  }

  protected override async refresh(owned: () => boolean = () => true) {
    const lifetime = this.#lifetime, scope = this.#scope(), notice = this.#notice;
    if (!scope) return;
    await super.refresh(() => this.isConnected && lifetime === this.#lifetime && scope === this.#scope() && owned());
    if (this.isConnected && lifetime === this.#lifetime && scope === this.#scope() && owned()
      && this.reportReadOutcome === "ready" && this.report) {
      if (this.#createIntent?.form === null) {
        this.#notice = { key: "delivery.createUnknown", fallback: "The original save is unconfirmed. Retry that same save; edited draft fields will not be submitted." };
      } else if (this.#notice === notice && notice?.key === "delivery.savedRefreshFailed" && notice.afterRefresh) {
        // The earlier write acknowledgment owns this completion. This read
        // only retires its refresh warning, never acknowledges another save.
        this.#notice = notice.afterRefresh;
      } else return;
      this.requestUpdate();
    }
  }

  #beginSave(form: HTMLFormElement) {
    const lifetime = this.#lifetime, scope = this.#scope(), save = {};
    if (!scope || !this.isConnected || !form.isConnected || !this.contains(form)
      || !this.report || this.reportReadOutcome !== "ready" || this.issue
      || !platformSession.get()?.capabilities.includes("product.delivery.manage")) return null;
    this.#save = save; this.#saving = true; this.#notice = null; this.#failed = false; this.requestUpdate();
    return { save, current: () => this.#save === save && this.isConnected && form.isConnected && this.contains(form)
      && lifetime === this.#lifetime && scope === this.#scope()
      && Boolean(platformSession.get()?.capabilities.includes("product.delivery.manage")) };
  }

  #createForm() {
    const forms = [...this.querySelectorAll<HTMLFormElement>("form[data-delivery-create]")].filter(form =>
      form.isConnected && this.contains(form) && form.hasAttribute("data-delivery-create")
      && form.getAttribute("data-delivery-create-owner") === String(this.#lifetime));
    return forms.length === 1 ? forms[0] : null;
  }

  #createSelections(form: HTMLFormElement | null) {
    const owner = form?.elements.namedItem("ownerUserId") as HTMLSelectElement | null | undefined;
    if (!owner) return null;
    const dependencies = form?.elements.namedItem("dependencies") as HTMLSelectElement | null | undefined;
    return { ownerUserId: owner.value, dependencyIds: dependencies ? [...dependencies.selectedOptions].map(option => option.value) : [] };
  }

  #createSelectionsUnavailable(selections: { ownerUserId: string; dependencyIds: string[] }) {
    return Boolean(selections.ownerUserId && !this.report?.owners?.some(owner => owner.userId === selections.ownerUserId))
      || selections.dependencyIds.some(id => !this.report?.decisions?.some(decision => decision.decisionId === id));
  }

  #removeUnavailableCreateDependencies(event: Event) {
    const form = this.#createForm();
    if (this.#saving || !form || !form.contains(event.currentTarget as Node) || !this.#scope()
      || !this.report || this.issue || this.reportReadOutcome !== "ready"
      || !platformSession.get()?.capabilities.includes("product.delivery.manage")) return;
    const dependencies = form.elements.namedItem("dependencies") as HTMLSelectElement | null;
    if (!dependencies) return;
    const current = new Set(this.report.decisions?.map(decision => decision.decisionId) ?? []);
    for (const option of [...dependencies.selectedOptions]) if (!current.has(option.value)) option.selected = false;
    this.requestUpdate();
  }

  #createFields(form: HTMLFormElement) {
    const values = new FormData(form), selections = this.#createSelections(form);
    // Successful FormData controls omit disabled selected options. Raw native
    // choices still belong to this draft when an original receipt resolves.
    return { title: String(values.get("title") ?? ""), audience: String(values.get("audience") ?? ""),
      evidence: String(values.get("evidence") ?? ""), ownerUserId: selections?.ownerUserId ?? String(values.get("ownerUserId") ?? ""),
      dependencyIds: selections?.dependencyIds ?? values.getAll("dependencies").map(String) };
  }

  async #create(event: SubmitEvent) {
    event.preventDefault(); if (this.#saving) return;
    const form = event.currentTarget as HTMLFormElement, values = this.#createFields(form);
    if (this.#createIntent && (this.#createIntent.actorUserId !== platformSession.get()?.user.userId
      || this.#createIntent.scope !== this.#scope()
      || this.#createIntent.form !== null && this.#createIntent.form !== form)) return;
    if (!this.#createIntent?.uncertain) {
      const selections = this.#createSelections(form);
      if (!selections || this.#createSelectionsUnavailable(selections)) {
        // A validation refusal must not publish from an already retired form.
        // This mirrors admission without allocating a save owner or an intent.
        if (!this.isConnected || this.#createForm() !== form || !this.#scope()
          || !this.report || this.reportReadOutcome !== "ready" || this.issue
          || !platformSession.get()?.capabilities.includes("product.delivery.manage")) return;
        this.#failed = true;
        this.#notice = { key: "delivery.createSelectionsUnavailable", fallback: "Choose a current owner and remove unavailable dependencies before adding a new decision." };
        this.requestUpdate(); return;
      }
    }
    const operation = this.#beginSave(form); if (!operation) return;
    const attempt = this.#createIntent ??= { requestId: crypto.randomUUID(), form, originalFields: JSON.stringify(values), uncertain: false,
      actorUserId: platformSession.get()!.user.userId, scope: this.#scope(),
      intent: { title: values.title.trim(), audience: values.audience, status: "planned", evidence: values.evidence.trim(),
        ownerUserId: values.ownerUserId.trim() || platformSession.get()!.user.userId, dependencyIds: [...values.dependencyIds] } };
    const actorUserId = attempt.actorUserId, wasUncertain = attempt.uncertain;
    let dispatched = false, acknowledged = false;
    try {
      attempt.digest ??= await deliveryCreateIntentDigest(attempt.intent);
      if (!operation.current()) return;
      dispatched = true; attempt.uncertain = true;
      const response = await fetch(this.endpoint, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...attempt.intent, requestId: attempt.requestId }) });
      if (!operation.current()) return;
      const result: unknown = await response.json();
      if (!operation.current()) return;
      if (!response.ok) {
        const body = result !== null && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : {};
        // This marker describes only this attempt. It cannot erase an earlier unknown commit.
        if (!wasUncertain && [400, 403, 409].includes(response.status) && body.createDisposition === "rejected_before_write") {
          this.#createIntent = null;
          this.#failed = true; this.#notice = { key: `delivery.error.${String(body.error ?? "")}`,
            fallbackKey: "delivery.failed", fallback: "The delivery decision could not be saved." };
          return;
        }
        throw new Error("delivery_create_unknown");
      }
      const original = await readDeliveryCreateReceipt(result, { requestId: attempt.requestId,
        actorUserId, requestDigest: attempt.digest, intent: attempt.intent });
      if (!operation.current()) return;
      if (!original) throw new Error("delivery_create_receipt_unavailable");
      acknowledged = true;
      this.#createIntent = null;
      const unchanged = attempt.form === form && (() => {
        const currentFields = this.#createFields(form);
        const originalFields = JSON.parse(attempt.originalFields) as typeof currentFields;
        // Native multiple selection has no ordering action. Compare cloned
        // arrays only here; original intent, receipt and raw fields stay exact.
        return JSON.stringify({ ...currentFields, dependencyIds: [...currentFields.dependencyIds].sort() })
          === JSON.stringify({ ...originalFields, dependencyIds: [...originalFields.dependencyIds].sort() });
      })();
      if (unchanged) form.reset();
      this.#notice = unchanged
        ? { key: "delivery.saved", fallback: "Delivery decision saved." }
        : attempt.form === form
          ? { key: "delivery.originalSavedDraftKept", fallback: "The original milestone is saved. Your edited draft remains unsubmitted." }
          : { key: "delivery.originalSavedCurrentForm", fallback: "The original milestone is saved. The current form was not submitted." };
      await this.refresh(operation.current);
      if (operation.current() && this.issue) this.#notice = { key: "delivery.savedRefreshFailed", fallback: "The milestone is saved, but current delivery evidence could not be refreshed.",
        afterRefresh: this.#notice ?? { key: "delivery.saved", fallback: "Delivery decision saved." } };
    } catch {
      if (!operation.current()) return;
      if (acknowledged) {
        this.#createIntent = null; this.#failed = false;
        this.#notice = { key: "delivery.savedRefreshFailed", fallback: "The milestone is saved, but current delivery evidence could not be refreshed.",
          afterRefresh: this.#notice ?? { key: "delivery.saved", fallback: "Delivery decision saved." } };
        return;
      }
      attempt.uncertain ||= dispatched; this.#failed = true;
      if (!dispatched) this.#createIntent = null;
      this.#notice = dispatched
        ? { key: "delivery.createUnknown", fallback: "The original save is unconfirmed. Retry that same save; edited draft fields will not be submitted." }
        : { key: "delivery.failed", fallback: "The delivery decision could not be saved." };
    } finally {
      if (this.#save === operation.save) { this.#save = null; this.#saving = false; this.requestUpdate(); }
    }
  }

  #decisionForm(decisionId: string) {
    return [...this.querySelectorAll<HTMLFormElement>("form[data-delivery-decision-id]")]
      .find(form => form.isConnected && this.contains(form) && form.getAttribute("data-delivery-decision-id") === decisionId) ?? null;
  }

  #currentDecision(form: HTMLFormElement, decisionId: string) {
    if (!this.#scope() || !this.isConnected || !form.isConnected || !this.contains(form)
      || form.getAttribute("data-delivery-decision-id") !== decisionId
      || this.reportReadOutcome !== "ready" || this.issue
      || !platformSession.get()?.capabilities.includes("product.delivery.manage")) return null;
    const decision = this.report?.decisions?.find(item => item.decisionId === decisionId);
    return decision && (!["approved", "revoked"].includes(decision.status) || this.report?.approvalAuthority === true) ? decision : null;
  }

  #updateValues(form: HTMLFormElement) {
    const values = new FormData(form);
    return { title: String(values.get("title") ?? ""), evidence: String(values.get("evidence") ?? ""),
      ownerUserId: String(values.get("ownerUserId") ?? ""), status: String(values.get("status") ?? "") };
  }

  #retainDecisionDraft(event: Event, decision: DeliveryDecision) {
    const form = event.currentTarget as HTMLFormElement;
    if (!this.#currentDecision(form, decision.decisionId)) return;
    // Native controls own the only raw draft. Metadata is content-free and
    // stays with this keyed form; a report read never rebases its revision.
    if (!form.getAttribute("data-delivery-revision")) form.setAttribute("data-delivery-revision", decision.updatedAt);
    form.setAttribute("data-delivery-dirty", "true"); this.requestUpdate();
  }

  #reloadDecision(event: Event, decision: DeliveryDecision) {
    if (this.#saving) return;
    const invoker = event.currentTarget as HTMLElement, form = this.#decisionForm(decision.decisionId);
    const current = form && this.#currentDecision(form, decision.decisionId);
    if (!invoker.isConnected || !this.contains(invoker) || !form || !current || current.updatedAt !== decision.updatedAt) return;
    const values = { title: current.title, evidence: current.evidence, ownerUserId: current.ownerUserId ?? "", status: current.status };
    const fields = Object.entries(values).map(([name, value]) => ({ value,
      field: form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null }));
    if (fields.some(item => !item.field || !("value" in item.field))) return;
    // This explicit discard action is the only read-side draft replacement.
    for (const item of fields) item.field!.value = item.value;
    form.removeAttribute("data-delivery-dirty"); form.setAttribute("data-delivery-revision", current.updatedAt);
    this.#notice = null; this.#failed = false; this.requestUpdate();
  }

  #acknowledgedUpdateRevision(result: unknown, body: Record<string, unknown>) {
    if (!result || typeof result !== "object" || Array.isArray(result)) return null;
    const value = (result as { decision?: unknown }).decision;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const decision = value as Partial<DeliveryDecision>;
    // This is the existing Worker PATCH decision response, not a new receipt
    // or an inference from a later GET. Only the exact submitted body can
    // advance the native form's base revision after its positive response.
    return decision.decisionId === body.decisionId && decision.title === String(body.title).trim()
      && decision.evidence === String(body.evidence).trim() && decision.ownerUserId === String(body.ownerUserId).trim()
      && decision.status === body.status && typeof decision.updatedAt === "string"
      && Number.isFinite(Date.parse(decision.updatedAt))
      && Date.parse(decision.updatedAt) > Date.parse(String(body.expectedUpdatedAt)) ? decision.updatedAt : null;
  }

  async #update(event:SubmitEvent,decision:DeliveryDecision){
    event.preventDefault(); if(this.#saving)return;
    const form=event.currentTarget as HTMLFormElement,current=this.#currentDecision(form,decision.decisionId);
    if(!current)return;
    const expectedUpdatedAt=form.getAttribute("data-delivery-revision");
    if(expectedUpdatedAt!==current.updatedAt){
      this.#failed=true;this.#notice={key:"delivery.conflict",fallback:"This decision changed. Refresh it and try again."};
      this.requestUpdate();return;
    }
    const values=this.#updateValues(form);
    form.setAttribute("data-delivery-dirty","true");
    await this.#mutate("PATCH",{decisionId:decision.decisionId,...values,expectedUpdatedAt},form);
  }

  async #mutate(method:"PATCH",body:Record<string,unknown>,form:HTMLFormElement){
    if(this.#saving)return;const operation=this.#beginSave(form);if(!operation)return;
    // Eligibility admits the command before dispatch. Temporary report loss
    // does not retire its exact form owner; real denial still retires lifetime.
    const current=()=>operation.current()&&form.getAttribute("data-delivery-decision-id")===String(body.decisionId);
    const unchanged=()=>Object.entries(this.#updateValues(form)).every(([name,value])=>value===body[name]);
    let acknowledged=false;
    try{
      const response=await fetch(this.endpoint,{method,headers:{"content-type":"application/json"},body:JSON.stringify(body)});
      if(!current())return;
      const result:unknown=await response.json();
      if(!current())return;
      if(!response.ok){
        if(response.status>=500&&response.status<600)throw new Error("delivery_update_acknowledgment_unavailable");
        const key=String(result&&typeof result==="object"&&!Array.isArray(result)?(result as {error?:unknown}).error??"":"");
        const conflict=key==="delivery_decision_revision_conflict";
        this.#failed=true;this.#notice={key:"delivery.error."+key,fallbackKey:conflict?"delivery.conflict":"delivery.failed",
          fallback:conflict?"This decision changed. Refresh it and try again.":"The delivery decision could not be saved."};return;
      }
      const revision=this.#acknowledgedUpdateRevision(result,body);
      if(!revision)throw new Error("delivery_update_acknowledgment_unavailable");
      acknowledged=true;form.setAttribute("data-delivery-revision",revision);
      if(unchanged())form.removeAttribute("data-delivery-dirty");
      this.#notice={key:"delivery.saved",fallback:"Delivery decision saved."};
      await this.refresh(operation.current);
      if(operation.current()){
        const completion:DeliveryNotice=form.getAttribute("data-delivery-dirty")==="true"&&!unchanged()
          ?{key:"delivery.updateSavedDraftKept",fallback:"The submitted update is saved. Your newer fields remain unsubmitted."}
          :{key:"delivery.saved",fallback:"Delivery decision saved."};
        this.#notice=this.issue
          ?{key:"delivery.savedRefreshFailed",fallback:"The milestone is saved, but current delivery evidence could not be refreshed.",afterRefresh:completion}
          :completion;
      }
    }catch{
      if(!operation.current())return;this.#failed=!acknowledged;
      this.#notice=acknowledged
        ?{key:"delivery.savedRefreshFailed",fallback:"The milestone is saved, but current delivery evidence could not be refreshed.",
          afterRefresh:this.#notice??{key:"delivery.saved",fallback:"Delivery decision saved."}}
        :{key:"delivery.updateUnknown",fallback:"The submitted update is unconfirmed. Refresh current evidence to inspect the decision. Your retained fields have not been submitted again."};
    }
    finally{if(this.#save===operation.save){this.#save=null;this.#saving=false;this.requestUpdate();}}
  }

  override render() {
    const notice=this.#noticeText();
    const decisions=this.report?.decisions??[];
    const readsDecisions=Array.isArray(this.report?.decisions);
    const canManage=platformSession.get()?.capabilities.includes("product.delivery.manage")??false;
    const approvalAuthority=this.report?.approvalAuthority===true;
    const owners=this.report?.owners??[];
    // Include the fixed self-assignment label in collision closure without
    // changing its empty value, wording, or the exact owner IDs sent by forms.
    const ownerNames=qualifyDisplayCollisions([{key:"self",label:this.i18n.t("delivery.owner.me","Assign to me")},
      ...owners.map(owner=>({key:"owner:"+owner.userId,label:`\u2068${owner.displayName}\u2069`}))],
      number=>this.i18n.t("delivery.ownerQualifier","Owner {number}",{number:this.i18n.number(number)}),
      key=>this.i18n.t("delivery.ownerIdentity","Owner ID {id}",{id:`\u2068[${encodeURIComponent(key.startsWith("owner:")?key.slice(6):"")}]\u2069`}));
    const byId=new Map(decisions.map((decision)=>[decision.decisionId,decision]));
    if(!this.report||(this.issue&&this.reportReadOutcome!=="unavailable"))return html`<section class="delivery-planning page-pad" aria-labelledby="delivery-planning-heading"><h1 id="delivery-planning-heading">${this.i18n.t("delivery.decisions","Delivery decisions")}</h1>${this.#notice?html`<p role=${this.#failed?"alert":"status"}>${notice}</p>`:nothing}${this.issue?html`<p role="alert">${this.i18n.system(this.issue)}</p><button type="button" class="button secondary compact" @click=${()=>this.refresh()}>${this.i18n.t("role.refresh","Refresh evidence")}</button>`:html`<p role="status">${this.i18n.t("role.loading","Loading approved evidence…")}</p>`}</section>`;
    const createSelection = this.#createSelections(this.#createForm()) ?? { ownerUserId: "", dependencyIds: [] };
    const createOwnerUnavailable = Boolean(createSelection.ownerUserId && !owners.some(owner => owner.userId === createSelection.ownerUserId));
    const unavailableCreateDependencies = createSelection.dependencyIds.filter(id => !byId.has(id));
    const createUnavailable = createOwnerUnavailable || unavailableCreateDependencies.length > 0;
    const decisionPriority:Record<string,number>={failed:0,approval_required:1,running:2,planned:3,passed:4,approved:5,revoked:6,superseded:7};
    const visibleDecisions=[...decisions].sort((left,right)=>(decisionPriority[left.status]??8)-(decisionPriority[right.status]??8)||Date.parse(right.updatedAt)-Date.parse(left.updatedAt));
    return html`
      ${!readsDecisions?html`<section class="delivery-planning page-pad"><h1>${this.i18n.t("delivery.decisions","Delivery decisions")}</h1><p>${this.i18n.t("delivery.evidenceOnly","Your authorization includes release evidence and aggregate readiness; individual delivery decisions require separate access.")}</p></section>`:html`
      <section class="delivery-planning page-pad" aria-labelledby="delivery-planning-heading"><h1 id="delivery-planning-heading">${this.i18n.t("delivery.decisions","Delivery decisions")}</h1>
      ${this.#notice?html`<p role=${this.#failed?"alert":"status"} aria-live=${this.#failed?"assertive":"polite"}>${notice}</p>`:nothing}
      ${visibleDecisions.length?html`<ol class="delivery-decision-list" ?hidden=${Boolean(this.issue)} ?inert=${Boolean(this.issue)}>${repeat(visibleDecisions,(decision)=>decision.decisionId,(decision)=>{const locked=["approved","revoked"].includes(decision.status)&&!approvalAuthority;const editable=canManage&&!locked,editForm=this.#decisionForm(decision.decisionId),dirty=editForm?.getAttribute("data-delivery-dirty")==="true";const ownerValue=dirty?String((editForm?.elements.namedItem("ownerUserId") as HTMLSelectElement|null)?.value??""):decision.ownerUserId??"",statusValue=dirty?String((editForm?.elements.namedItem("status") as HTMLSelectElement|null)?.value??""):decision.status;const statuses=DELIVERY_DECISION_STATUSES.filter((status)=>deliveryTransitionAllowed(decision.status,status)&&(approvalAuthority||!deliveryNeedsReleaseAuthority(status))),ownerUnavailable=dirty&&!owners.some(owner=>owner.userId===ownerValue),statusUnavailable=dirty&&!statuses.some(status=>status===statusValue),conflict=dirty&&editForm?.getAttribute("data-delivery-revision")!==decision.updatedAt;return html`<li data-forma-content="primary"><article><header><h2 dir="auto">${decision.title}</h2><span>${this.i18n.t(`shell.${decision.audience}`,decision.audience)}</span></header><dl><div><dt>${this.i18n.t("delivery.owner","Owner")}</dt><dd dir="auto">${decision.owner}</dd></div><div><dt>${this.i18n.t("delivery.status","Status")}</dt><dd>${this.i18n.t(`delivery.status.${decision.status}`,decision.status)}</dd></div>${decision.dependencyIds.length?html`<div><dt>${this.i18n.t("delivery.dependencies","Existing dependencies")}</dt><dd dir="auto">${decision.dependencyIds.map((dependency)=>byId.get(dependency)?.title??this.i18n.t("delivery.unavailableDependency","Unavailable decision")).join(" · ")}</dd></div>`:nothing}</dl>${editable?html`<form class="delivery-decision-form" data-delivery-decision-id=${decision.decisionId} data-delivery-revision=${dirty?noChange:decision.updatedAt} @input=${(event:Event)=>this.#retainDecisionDraft(event,decision)} @change=${(event:Event)=>this.#retainDecisionDraft(event,decision)} @compositionstart=${(event:Event)=>this.#retainDecisionDraft(event,decision)} @submit=${(event:SubmitEvent)=>this.#update(event,decision)}><label>${this.i18n.t("delivery.title","Decision or milestone")}<input name="title" required maxlength="160" dir="auto" .value=${dirty?noChange:decision.title}></label><label>${this.i18n.t("delivery.owner","Owner")}<select name="ownerUserId" .value=${dirty?noChange:decision.ownerUserId??""}>${ownerUnavailable?html`<option value=${ownerValue} disabled .selected=${true}>${this.i18n.t("delivery.unavailableOwner","No longer an eligible owner")} · ${ownerValue}</option>`:nothing}${repeat(owners,(owner)=>owner.userId,(owner)=>html`<option value=${owner.userId} .selected=${owner.userId===ownerValue}>${ownerNames.get("owner:"+owner.userId)!.label}</option>`)}</select></label><label>${this.i18n.t("delivery.evidence","Current evidence")}<textarea name="evidence" maxlength="800" dir="auto" .value=${dirty?noChange:decision.evidence}></textarea></label><label>${this.i18n.t("delivery.status","Status")}<select name="status" .value=${dirty?noChange:decision.status}>${statusUnavailable?html`<option value=${statusValue} disabled .selected=${true}>${this.i18n.t("delivery.unavailableStatus","No longer available: {status}",{status:this.i18n.t("delivery.status."+statusValue,statusValue)})}</option>`:nothing}${repeat(statuses,(status)=>status,(status)=>html`<option value=${status} .selected=${status===statusValue}>${this.i18n.t(`delivery.status.${status}`,status)}</option>`)}</select></label>${conflict?html`<p role="alert">${this.i18n.t("delivery.conflict","This decision changed. Refresh it and try again.")}</p>`:nothing}${dirty?html`<button class="button ghost compact" type="button" ?disabled=${this.#saving} @click=${(event:Event)=>this.#reloadDecision(event,decision)}>${this.i18n.t("delivery.discardDraft","Discard draft and reload saved values")}</button>`:nothing}<button class="button secondary compact" type="submit" aria-label=${this.i18n.t("delivery.saveNamed","Save decision {name}",{name:`\u2068${decision.title}\u2069`})} ?disabled=${this.#saving||conflict||ownerUnavailable||statusUnavailable}>${this.#saving?this.i18n.t("delivery.saving","Saving…"):this.i18n.t("delivery.save","Save decision")}</button></form>`:html`${decision.evidence?html`<p dir="auto">${decision.evidence}</p>`:nothing}${locked?html`<p>${this.i18n.t("delivery.approvalLocked","An approved or revoked decision can only be changed by a release approver.")}</p>`:nothing}`}</article></li>`;})}</ol>`:html`<p data-forma-empty-state ?hidden=${Boolean(this.issue)}>${this.i18n.t("delivery.empty","No delivery decisions have been recorded yet.")}</p>`}
      ${canManage?html`<form class="delivery-decision-form" data-delivery-create data-delivery-create-owner=${String(this.#lifetime)} ?hidden=${Boolean(this.issue)} ?inert=${Boolean(this.issue)} @change=${()=>this.requestUpdate()} @submit=${(event:SubmitEvent)=>this.#create(event)}><label>${this.i18n.t("delivery.title","Decision or milestone")}<input name="title" required maxlength="160" dir="auto"></label><label>${this.i18n.t("delivery.audience","Audience")}<select name="audience" required>${APPLICATIONS.map((application)=>html`<option value=${application.id}>${this.i18n.t(`shell.${application.id}`,application.label)}</option>`)}</select></label><label>${this.i18n.t("delivery.owner","Owner")}<select name="ownerUserId"><option value="" .selected=${createSelection.ownerUserId===""}>${this.i18n.t("delivery.owner.me","Assign to me")}</option>${createOwnerUnavailable?html`<option value=${createSelection.ownerUserId} disabled .selected=${true}>${this.i18n.t("delivery.unavailableOwner","No longer an eligible owner")} · ${createSelection.ownerUserId}</option>`:nothing}${repeat(owners,(owner)=>owner.userId,(owner)=>html`<option value=${owner.userId} .selected=${owner.userId===createSelection.ownerUserId}>${ownerNames.get("owner:"+owner.userId)!.label}</option>`)}</select></label><label>${this.i18n.t("delivery.evidence","Current evidence")}<textarea name="evidence" maxlength="800" dir="auto"></textarea></label>${decisions.length||unavailableCreateDependencies.length?html`<label>${this.i18n.t("delivery.dependencies","Existing dependencies")}<select name="dependencies" multiple>${repeat(unavailableCreateDependencies,(id)=>id,(id)=>html`<option value=${id} disabled .selected=${true}>${this.i18n.t("delivery.unavailableDependency","Unavailable decision")} · ${id}</option>`)}${repeat(decisions,(decision)=>decision.decisionId,(decision)=>html`<option value=${decision.decisionId} .selected=${createSelection.dependencyIds.includes(decision.decisionId)}>${decision.title}</option>`)}</select></label>${unavailableCreateDependencies.length?html`<button class="button ghost compact" type="button" ?disabled=${this.#saving} @click=${(event:Event)=>this.#removeUnavailableCreateDependencies(event)}>${this.i18n.t("delivery.removeUnavailableDependencies","Remove unavailable dependencies")}</button>`:nothing}`:nothing}${createUnavailable?html`<p role="status">${this.i18n.t("delivery.createSelectionsUnavailable","Choose a current owner and remove unavailable dependencies before adding a new decision.")}</p>`:nothing}<button class="button primary" type="submit" ?formnovalidate=${Boolean(this.#createIntent?.uncertain)} ?disabled=${this.#saving||createUnavailable&&!this.#createIntent?.uncertain}>${this.#saving?this.i18n.t("delivery.saving","Saving…"):this.#createIntent?.uncertain?this.i18n.t("delivery.retryOriginal","Retry original save"):this.i18n.t("delivery.add","Add delivery decision")}</button></form>`:html`<p>${this.i18n.t("delivery.readOnly","Your access allows review; managing decisions requires a separate authorization.")}</p>`}
      </section>`}
      ${this.dashboard(this.i18n.t("shell.product", "Product & Quality"), this.i18n.t("product.delivery.heading", "Delivery readiness"), this.i18n.t("product.delivery.description", "Current delivery decisions, ownership, dependencies, and evidence. Human approvals remain explicit."))}`;
  }
}

if (!customElements.get("forma-product-delivery")) customElements.define("forma-product-delivery", FormaProductDelivery);

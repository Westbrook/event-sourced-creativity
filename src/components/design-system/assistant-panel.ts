import { html, nothing, type PropertyValues } from "lit";
import { ASSISTANT_CONTEXT_LIMITS,type AssistantContext } from "../../model/conversation-context.ts";
import { icon } from "../icons.ts";
import { FormaPresentationalElement } from "../presentational-element.ts";
import "./assistant-panel.css";

export type AssistantDisplayedMessage = { id: string; role: "user" | "assistant"; text?: string; key?: string; values?: Record<string, string | number> };
export type AssistantDisplayedProposal = {
  id: string;
  key: string;
  route?: string;
  kind: "navigate" | "context.create" | "context.edit" | "context.remove" | "context.relation.add" | "context.relation.remove";
  turnId: string;
  summary?: string;
  summaryKey?: string;
};
export type AssistantDisplayedTask = {
  id: string;
  turnId: string;
  kind: string;
  model: string;
  status: string;
  error?: string | null;
  estimatedMicrousd: number;
};
export type AssistantDisplayedModel = { id: "gpt-5.6-luna" | "gpt-5.6-terra" | "gpt-5.6-sol"; maximumMicrousd: number; premiumApprovalRequired: boolean };

/**
 * Private, page-aware conversational assistant.
 * Ask about the current page, selected work, recent authorized activity, and reviewable next steps without leaving the page.
 */
export class FormaAssistantPanel extends FormaPresentationalElement {
  static override properties = {
    open: { type: Boolean },
    messages: { attribute: false },
    proposals: { attribute: false },
    tasks: { attribute: false },
    models: { attribute: false },
    context: { attribute: false },
    pending: { type: Number },
    readOnly: { type: Boolean },
    guidanceOnly: { type: Boolean },
    canReconcile: { type: Boolean },
    pageLabel: { type: String },
  };

  declare open: boolean;
  declare messages: AssistantDisplayedMessage[];
  declare proposals: AssistantDisplayedProposal[];
  declare tasks: AssistantDisplayedTask[];
  declare models: AssistantDisplayedModel[];
  declare context: AssistantContext | null;
  declare pending: number;
  declare readOnly: boolean;
  declare guidanceOnly: boolean;
  declare canReconcile: boolean;
  declare pageLabel: string;
  #draft = "";
  #composing = false;
  #selectedModel = "";
  #premiumApproved = false;

  constructor() {
    super();
    this.open = false;
    this.messages = [];
    this.proposals = [];
    this.tasks = [];
    this.models = [];
    this.context = null;
    this.pending = 0;
    this.readOnly = false;
    this.guidanceOnly = false;
    this.canReconcile = false;
    this.pageLabel = "";
  }

  protected override updated(changed: PropertyValues) {
    super.updated(changed);
    if (changed.has("open") && this.open) queueMicrotask(() => this.querySelector<HTMLTextAreaElement>(".forma-assistant-input")?.focus());
    if (changed.has("open") && !this.open && changed.get("open")) queueMicrotask(() => this.querySelector<HTMLButtonElement>(".forma-assistant-launcher")?.focus());
    if (changed.has("messages")) queueMicrotask(() => {
      const transcript = this.querySelector<HTMLElement>(".forma-assistant-transcript");
      if (transcript) transcript.scrollTop = transcript.scrollHeight;
    });
  }

  #toggle(open: boolean) {
    this.dispatchEvent(new CustomEvent("forma-assistant-toggle", { detail: { open }, bubbles: true, composed: true }));
  }

  restoreDraft(value: string) {
    if (this.#draft || !value) return;
    this.#draft = value.slice(0, ASSISTANT_CONTEXT_LIMITS.turnChars);
    const field = this.querySelector<HTMLTextAreaElement>(".forma-assistant-input");
    if (field) field.value = this.#draft;
    this.requestUpdate();
  }

  #submit(event: SubmitEvent) {
    event.preventDefault();
    const value = this.#draft.trim();
    const selected = this.models.find((model) => model.id === this.#selectedModel);
    if (!value||value.length>ASSISTANT_CONTEXT_LIMITS.turnChars||this.#composing||selected?.premiumApprovalRequired&&!this.#premiumApproved)return;
    this.#draft = "";
    const field = this.querySelector<HTMLTextAreaElement>(".forma-assistant-input");
    if (field) field.value = "";
    this.dispatchEvent(new CustomEvent("forma-assistant-message", { detail: { message: value,
      ...(selected ? { model: selected.id } : {}), ...(selected?.premiumApprovalRequired ? { premiumApproval: true } : {}) }, bubbles: true, composed: true }));
    if (selected?.premiumApprovalRequired) this.#premiumApproved = false;
    this.requestUpdate();
  }

  #amount(microusd: number) {
    return new Intl.NumberFormat(this.i18n.locale, { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(Math.max(0, microusd) / 1_000_000);
  }

  #modelLabel(model: string) {
    const id = model.endsWith("-sol") ? "sol" : model.endsWith("-terra") ? "terra" : "luna";
    return this.i18n.t(`assistant.model.${id}`);
  }

  #taskStatus(task: AssistantDisplayedTask) {
    const id = task.status === "queued" ? "queued" : task.status === "running" ? "running"
      : task.status === "completed" ? "completed" : task.status === "canceled" ? "canceled"
      : task.status === "reconciled" ? "reconciled" : task.status === "needs-review" || task.status === "reconciling" ? "needsReview" : "failed";
    return this.i18n.t(`assistant.task.${id}`);
  }

  override render() {
    if (!this.open) return html`<button type="button" class="forma-assistant-launcher" aria-haspopup="dialog" @click=${() => { this.#toggle(true); }}>${icon("spark")}<span>${this.i18n.t("assistant.open")}</span></button>`;
    const context = this.context;
    const selectedModel = this.models.find((model) => model.id === this.#selectedModel);
    const readable=context?.decisionAtoms.filter((item)=>item.providerEligible&&(!item.immutable||item.providerVisibility==="governed")
      &&item.type!=="reference"&&item.providerVisibility!=="restricted").length??0;
    const withheld=context?.decisionAtoms.filter((item)=>item.type==="reference"||item.providerVisibility==="restricted").length??0;
    const includedProtected=context?.decisionAtoms.filter((item)=>item.providerEligible&&(item.protected||item.locked||item.type==="exclusion"||item.intent==="prohibit")).length??0;
    const protectedOverflow=Math.max(0,Number(context?.totals.protectedDecisions??0)-includedProtected);
    const protectedTextOverflow=Number(context?.totals.truncatedProtectedDecisions??0);
    const unsafeRights=Number(context?.totals.unsafeRightsDecisions??0);
    return html`<section class="forma-assistant-panel" role="dialog" aria-modal="false" aria-labelledby="forma-assistant-title" @keydown=${(event: KeyboardEvent) => { if (event.key === "Escape" && !event.isComposing) { event.stopPropagation(); this.#toggle(false); } }}>
      <header class="forma-assistant-header"><div><strong id="forma-assistant-title">${this.i18n.t("assistant.heading")}</strong><small>${this.i18n.t("assistant.privacy")}</small></div><button type="button" class="icon-button forma-assistant-close" aria-label=${this.i18n.t("assistant.close")} @click=${() => this.#toggle(false)}>${icon("close")}</button></header>
      <div class="forma-assistant-transcript" role="log" aria-live="polite" aria-relevant="additions">
        ${context ? html`<small class="forma-assistant-page">${this.i18n.t("assistant.page", "", { page: this.pageLabel || this.i18n.system(context.surface.page) })}</small>${context.documentTitle ? html`<small class="forma-assistant-page">${this.i18n.t("assistant.document", "", { title: context.documentTitle })}</small>` : nothing}${context.scope.documentId?html`<small class="forma-assistant-page" role="status">${this.i18n.t("assistant.coverage.visible","",{count:this.i18n.number(context.decisionAtoms.length),total:this.i18n.number(context.totals.decisions)})}${context.decisionAtoms.length<context.totals.decisions?` ${this.i18n.system("· truncated")}`:""}</small><small class="forma-assistant-page">${this.i18n.t("assistant.coverage.readable","",{count:this.i18n.number(readable)})}${withheld?` · ${this.i18n.t("assistant.coverage.withheld","",{count:this.i18n.number(withheld)})}`:""}</small>${protectedOverflow?html`<small class="forma-assistant-page" role="status">${this.i18n.t("assistant.coverage.protectedOverflow","",{count:this.i18n.number(protectedOverflow)})}</small>`:nothing}${protectedTextOverflow?html`<small class="forma-assistant-page" role="status">${this.i18n.t("assistant.coverage.protectedText","",{count:this.i18n.number(protectedTextOverflow)})}</small>`:nothing}${unsafeRights?html`<small class="forma-assistant-page" role="status">${this.i18n.t("assistant.coverage.rightsBlocked","",{count:this.i18n.number(unsafeRights)})}</small>`:nothing}`:nothing}${context.selectedItems.map((item) => html`<small class="forma-assistant-page">${this.i18n.t("assistant.selection", "", { title: item.title })}</small>`)}` : nothing}
        ${this.messages.length ? this.messages.map((message) => html`<p class=${`forma-assistant-message forma-assistant-message--${message.role}`} dir="auto">${message.key ? this.i18n.t(message.key, "", message.values ?? {}) : message.text}</p>`) : html`<p class="forma-assistant-message forma-assistant-message--assistant">${this.i18n.t("assistant.greeting")}</p>`}
        ${this.proposals.map((proposal) => html`<article class="forma-assistant-proposal"><small>${this.i18n.t("assistant.proposedAction")}</small>${proposal.summary || proposal.summaryKey ? html`<p dir="auto">${proposal.summaryKey ? this.i18n.t(proposal.summaryKey) : proposal.summary}</p>` : nothing}<button type="button" class="button secondary compact" @click=${() => this.dispatchEvent(new CustomEvent("forma-assistant-proposal", { detail: { proposal, action: "accept" }, bubbles: true, composed: true }))}>${this.i18n.t(proposal.key)}</button><button type="button" class="button ghost compact" @click=${() => this.dispatchEvent(new CustomEvent("forma-assistant-proposal", { detail: { proposal, action: "dismiss" }, bubbles: true, composed: true }))}>${this.i18n.t("assistant.dismissProposal")}</button></article>`)}
        ${this.tasks.map((task) => html`<article class="forma-assistant-task" data-task-id=${task.id} data-task-status=${task.status}>
          <small>${this.i18n.t("assistant.task.heading")} · ${this.#modelLabel(task.model)}</small>
          <p role="status" dir="auto">${this.#taskStatus(task)}</p>
          <small>${this.i18n.t("assistant.task.estimatedCost", "", { amount: this.#amount(task.estimatedMicrousd) })}</small>
          ${task.status === "queued" ? html`<button type="button" class="button ghost compact" @click=${() => this.dispatchEvent(new CustomEvent("forma-assistant-task", { detail: { task, action: "cancel" }, bubbles: true, composed: true }))}>${this.i18n.t("assistant.task.cancel")}</button>` : nothing}
          ${task.status === "running" ? html`<small>${this.i18n.t("assistant.task.cancelUnavailable")}</small>` : nothing}
          ${["needs-review", "reconciling"].includes(task.status) && !this.canReconcile ? html`<small>${this.i18n.t("assistant.task.contactAdministrator")}</small><small>${this.i18n.t("assistant.task.reviewReference", "", { id: task.id })}</small>` : nothing}
          ${["needs-review", "reconciling"].includes(task.status) && this.canReconcile ? html`<button type="button" class="button secondary compact" @click=${() => this.dispatchEvent(new CustomEvent("forma-assistant-task", { detail: { task, action: "reconcile" }, bubbles: true, composed: true }))}>${this.i18n.t("assistant.task.reconcile")}</button>` : nothing}
        </article>`)}
        ${this.guidanceOnly ? html`<p class="forma-assistant-read-only">${this.i18n.t("assistant.guidanceOnly")}</p>`
          : this.readOnly ? html`<p class="forma-assistant-read-only">${this.i18n.t("assistant.readOnly")}</p>` : nothing}
        ${this.pending ? html`<p class="forma-assistant-pending" role="status">${this.pending === 1 ? this.i18n.t("assistant.sending") : this.i18n.t("assistant.pending", "", { count: this.i18n.number(this.pending) })}</p>` : nothing}
      </div>
      <form class="forma-assistant-composer" @submit=${this.#submit}>
        ${this.models.length && !this.readOnly ? html`<div class="forma-assistant-model"><label><span>${this.i18n.t("assistant.model.choose")}</span><select aria-label=${this.i18n.t("assistant.model.choose")} .value=${this.#selectedModel} @change=${(event: Event) => { this.#selectedModel = (event.currentTarget as HTMLSelectElement).value; this.#premiumApproved = false; this.requestUpdate(); }}><option value="">${this.i18n.t("assistant.model.automatic")}</option>${this.models.map((model) => html`<option value=${model.id}>${this.#modelLabel(model.id)}</option>`)}</select></label>
        ${selectedModel?.premiumApprovalRequired ? html`<label class="forma-assistant-premium"><input type="checkbox" .checked=${this.#premiumApproved} @change=${(event: Event) => { this.#premiumApproved = (event.currentTarget as HTMLInputElement).checked; this.requestUpdate(); }}><span>${this.i18n.t("assistant.model.premiumApproval", "", { amount: this.#amount(selectedModel.maximumMicrousd) })}</span></label>` : nothing}</div>` : nothing}
        <textarea class="forma-assistant-input" rows="1" maxlength=${ASSISTANT_CONTEXT_LIMITS.turnChars} dir="auto" aria-label=${this.i18n.t("assistant.messageLabel")} placeholder=${this.i18n.t("assistant.placeholder")} @input=${(event: Event) => { this.#draft = (event.currentTarget as HTMLTextAreaElement).value; }} @compositionstart=${() => { this.#composing = true; }} @compositionend=${(event: CompositionEvent) => { this.#composing = false; this.#draft = (event.currentTarget as HTMLTextAreaElement).value; }} @keydown=${(event: KeyboardEvent) => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing && !this.#composing) { event.preventDefault(); (event.currentTarget as HTMLTextAreaElement).form?.requestSubmit(); } }}></textarea>
        <button type="submit" class="button primary forma-assistant-send" aria-label=${this.i18n.t("assistant.send")} ?disabled=${Boolean(selectedModel?.premiumApprovalRequired && !this.#premiumApproved)}>${icon("arrow")}</button>
      </form>
    </section>`;
  }
}

if (!customElements.get("forma-assistant-panel")) customElements.define("forma-assistant-panel", FormaAssistantPanel);

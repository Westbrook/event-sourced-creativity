import { html, nothing, type PropertyValues } from "lit";
import { ASSISTANT_CONTEXT_LIMITS,type AssistantContext } from "../../model/conversation-context.ts";
import type { AssistantInteractionMode } from "../../model/assistant-route-policy.ts";
import { icon } from "../icons.ts";
import { FormaPresentationalElement } from "../presentational-element.ts";
import "./conversation-composer.ts";
import "./assistant-panel.css";

export type AssistantDisplayedMessage = {
  id: string;
  role: "user" | "assistant";
  text?: string;
  key?: string;
  values?: Record<string, string | number>;
  reviewMode?: "plan-document" | "plan-board";
  reviewReady?: boolean;
};
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
    modes: { attribute: false },
    busyModes: { attribute: false },
    context: { attribute: false },
    pending: { type: Number },
    readOnly: { type: Boolean },
    guidanceOnly: { type: Boolean },
    canReconcile: { type: Boolean },
    pageLabel: { type: String },
    conversationScope: { type: String },
  };

  declare open: boolean;
  declare messages: AssistantDisplayedMessage[];
  declare proposals: AssistantDisplayedProposal[];
  declare tasks: AssistantDisplayedTask[];
  declare models: AssistantDisplayedModel[];
  declare modes: readonly AssistantInteractionMode[];
  declare busyModes: readonly AssistantInteractionMode[];
  declare context: AssistantContext | null;
  declare pending: number;
  declare readOnly: boolean;
  declare guidanceOnly: boolean;
  declare canReconcile: boolean;
  declare pageLabel: string;
  declare conversationScope: string;
  #draft = "";
  #activeMode: AssistantInteractionMode = "guidance";
  #toolSubmitting = false;
  #drafts = new Map<AssistantInteractionMode, string>();
  #selectedModel = "";
  #premiumApproved = false;
  #positionFrame = 0;
  #schedulePosition = () => {
    if (this.#positionFrame || this.open) return;
    this.#positionFrame = requestAnimationFrame(() => {
      this.#positionFrame = 0;
      this.#positionLauncher();
    });
  };

  constructor() {
    super();
    this.open = false;
    this.messages = [];
    this.proposals = [];
    this.tasks = [];
    this.models = [];
    this.modes = ["guidance"];
    this.busyModes = [];
    this.context = null;
    this.pending = 0;
    this.readOnly = false;
    this.guidanceOnly = false;
    this.canReconcile = false;
    this.pageLabel = "";
    this.conversationScope = "";
  }

  override connectedCallback() {
    super.connectedCallback();
    window.addEventListener("resize", this.#schedulePosition, { passive: true });
    window.addEventListener("scroll", this.#schedulePosition, { capture: true, passive: true });
  }

  override disconnectedCallback() {
    window.removeEventListener("resize", this.#schedulePosition);
    window.removeEventListener("scroll", this.#schedulePosition, true);
    if (this.#positionFrame) cancelAnimationFrame(this.#positionFrame);
    this.#positionFrame = 0;
    super.disconnectedCallback();
  }

  protected override willUpdate(changed: PropertyValues) {
    super.willUpdate(changed);
    if (changed.has("conversationScope") && changed.get("conversationScope") !== undefined) {
      this.#draft = "";
      this.#drafts.clear();
      this.#activeMode = "guidance";
      this.#toolSubmitting = false;
      this.#selectedModel = "";
      this.#premiumApproved = false;
    }
  }

  protected override updated(changed: PropertyValues) {
    super.updated(changed);
    if (changed.has("modes") && !this.modes.includes(this.#activeMode)) this.#activeMode = "guidance";
    if (changed.has("open") && this.open) queueMicrotask(() => this.querySelector<HTMLTextAreaElement>(".forma-assistant-input")?.focus());
    if (changed.has("open") && !this.open && changed.get("open")) queueMicrotask(() => this.querySelector<HTMLButtonElement>(".forma-assistant-launcher")?.focus());
    if (changed.has("messages")) queueMicrotask(() => {
      const transcript = this.querySelector<HTMLElement>(".forma-assistant-transcript");
      if (transcript) transcript.scrollTop = transcript.scrollHeight;
    });
    if (this.open) {
      this.style.removeProperty("--forma-assistant-obstacle-offset");
      delete this.dataset.compactLauncher;
    } else this.#schedulePosition();
  }

  #positionLauncher() {
    const launcher = this.querySelector<HTMLButtonElement>(".forma-assistant-launcher");
    if (!launcher || this.open || launcher.matches(":hover") || launcher.contains(document.activeElement)) return;

    delete this.dataset.compactLauncher;
    this.style.setProperty("--forma-assistant-obstacle-offset", "0px");
    const controls = [...document.querySelectorAll<HTMLElement>("a[href], button, input, textarea, select, summary, [role='button'], [contenteditable='true']")]
      .filter((control) => !this.contains(control)
        && !("disabled" in control && Boolean(control.disabled))
        && !control.closest("[hidden], [inert], [aria-hidden='true']"))
      .map((control) => ({ element: control, box: control.getBoundingClientRect() }))
      .filter(({ element, box }) => box.width > 0 && box.height > 0 && box.bottom > 0
        && box.top < innerHeight && box.right > 0 && box.left < innerWidth
        && getComputedStyle(element).visibility !== "hidden"
        && getComputedStyle(element).pointerEvents !== "none");
    const intersections = (box: DOMRect) => controls.filter(({ box: control }) =>
      box.left < control.right && box.right > control.left && box.top < control.bottom && box.bottom > control.top);

    let offset = 0;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      this.style.setProperty("--forma-assistant-obstacle-offset", `${offset}px`);
      const box = launcher.getBoundingClientRect();
      const obstacles = intersections(box);
      if (!obstacles.length) return;
      const next = offset + box.bottom - Math.min(...obstacles.map(({ box: obstacle }) => obstacle.top)) + 8;
      if (next > 96 || box.top - (next - offset) < 8) break;
      offset = next;
    }

    this.style.setProperty("--forma-assistant-obstacle-offset", "0px");
    this.dataset.compactLauncher = "true";
    if (!intersections(launcher.getBoundingClientRect()).length) return;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const box = launcher.getBoundingClientRect();
      const obstacles = intersections(box);
      if (!obstacles.length) return;
      const next = box.bottom - Math.min(...obstacles.map(({ box: obstacle }) => obstacle.top)) + 8
        + Number.parseFloat(this.style.getPropertyValue("--forma-assistant-obstacle-offset") || "0");
      if (next > 128 || box.top < 8) return;
      this.style.setProperty("--forma-assistant-obstacle-offset", `${next}px`);
    }
  }

  #toggle(open: boolean) {
    this.dispatchEvent(new CustomEvent("forma-assistant-toggle", { detail: { open }, bubbles: true, composed: true }));
  }

  restoreDraft(value: string) {
    if (this.#draft || !value) return;
    this.#draft = value.slice(0, this.#maximumLength());
    const field = this.querySelector<HTMLTextAreaElement>(".forma-assistant-input");
    if (field) field.value = this.#draft;
    this.requestUpdate();
  }

  resolveToolRequest(accepted: boolean, message: string) {
    this.#toolSubmitting = false;
    this.#draft = accepted ? "" : message.slice(0, this.#maximumLength());
    this.requestUpdate();
    if (!accepted) {
      const draft=this.#draft;
      // The containing host must first clear its busy mode and re-enable the
      // field. Focusing in the previous microtask silently targeted a disabled input.
      void this.updateComplete.then(()=>requestAnimationFrame(()=>{
        if(this.isConnected&&this.open&&this.#draft===draft&&!this.#toolSubmitting&&!document.querySelector("dialog:modal"))this.querySelector<HTMLTextAreaElement>(".forma-assistant-input")?.focus({preventScroll:true});
      }));
    }
  }

  #maximumLength() {
    return this.#activeMode === "creative-chat" ? 4_000
      : this.#activeMode === "plan-document" || this.#activeMode === "plan-board" ? 2_000
      : ASSISTANT_CONTEXT_LIMITS.turnChars;
  }

  #modeName(mode: AssistantInteractionMode) {
    const names: Record<AssistantInteractionMode, string> = {
      guidance: "guidance", "creative-chat": "creativeChat", "quick-edit": "quickEdit", "plan-document": "planDocument", "plan-board": "planBoard",
    };
    return names[mode];
  }

  #submit(event: SubmitEvent) {
    event.preventDefault();
    const value = this.#draft.trim();
    const selected = this.#activeMode === "guidance" ? this.models.find((model) => model.id === this.#selectedModel) : undefined;
    if (!value || value.length > this.#maximumLength() || this.#toolSubmitting || this.busyModes.includes(this.#activeMode)
      || selected?.premiumApprovalRequired && !this.#premiumApproved) return;
    if (this.#activeMode !== "guidance") {
      this.#toolSubmitting = true;
      this.requestUpdate();
      this.dispatchEvent(new CustomEvent("forma-assistant-message", { detail: { message: value, mode: this.#activeMode }, bubbles: true, composed: true }));
      return;
    }
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
    if (!this.open) return html`<button type="button" class="forma-assistant-launcher" aria-haspopup="dialog" aria-label=${this.i18n.t("assistant.open")} title=${this.i18n.t("assistant.open")} @click=${() => { this.#toggle(true); }}>${icon("spark")}<span>${this.i18n.t("assistant.open")}</span></button>`;
    const context = this.context;
    const selectedModel = this.#activeMode === "guidance" ? this.models.find((model) => model.id === this.#selectedModel) : undefined;
    const modeName = this.#modeName(this.#activeMode);
    const modePlaceholder = this.#activeMode === "guidance"
      ? this.i18n.t("assistant.placeholder")
      : this.i18n.t(`assistant.mode.${modeName}Placeholder`);
    const submitLabel = this.#activeMode === "guidance"
      ? this.i18n.t("assistant.send")
      : this.i18n.t(`assistant.mode.${modeName}Submit`);
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
        ${this.messages.length ? this.messages.map((message) => html`<div class=${`forma-assistant-message forma-assistant-message--${message.role}`} dir="auto"><p>${message.key ? this.i18n.t(message.key, "", message.values ?? {}) : message.text}</p>${message.reviewMode?html`<button type="button" class="button secondary compact forma-assistant-review" ?disabled=${!message.reviewReady} @click=${()=>{const mode=message.reviewMode;if(mode)this.dispatchEvent(new CustomEvent<{mode:"plan-document"|"plan-board"}>("forma-assistant-review",{detail:{mode},bubbles:true,composed:true}));}}>${this.i18n.t("assistant.reviewSuggestions")}</button>`:nothing}</div>`) : html`<p class="forma-assistant-message forma-assistant-message--assistant">${this.i18n.t("assistant.greeting")}</p>`}
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
        ${this.guidanceOnly && this.#activeMode === "guidance" ? html`<p class="forma-assistant-read-only">${this.i18n.t("assistant.guidanceOnly")}</p>`
          : this.readOnly ? html`<p class="forma-assistant-read-only">${this.i18n.t("assistant.readOnly")}</p>` : nothing}
        ${this.pending ? html`<p class="forma-assistant-pending" role="status">${this.pending === 1 ? this.i18n.t("assistant.sending") : this.i18n.t("assistant.pending", "", { count: this.i18n.number(this.pending) })}</p>` : nothing}
      </div>
      <form class="forma-assistant-composer" data-attention-context=${this.#activeMode==="guidance"?"assistant-guidance":"writing-direction"} @submit=${this.#submit}>
        ${this.modes.length > 1 ? html`<div class="forma-assistant-modes" role="group" aria-label=${this.i18n.t("assistant.mode.label")}>${this.modes.map((mode) => html`<button type="button" class="forma-assistant-mode" aria-pressed=${String(this.#activeMode === mode)} ?disabled=${this.#toolSubmitting} @click=${() => { this.#drafts.set(this.#activeMode, this.#draft); this.#activeMode = mode; this.#draft = this.#drafts.get(mode) ?? ""; this.#premiumApproved = false; this.requestUpdate(); }}>${this.i18n.t(`assistant.mode.${this.#modeName(mode)}`)}</button>`)}</div><p class="forma-assistant-mode-detail">${this.i18n.t(`assistant.mode.${modeName}Detail`)}</p>` : nothing}
        ${this.#activeMode === "guidance" && this.models.length && !this.readOnly ? html`<div class="forma-assistant-model"><p class="forma-assistant-mode-detail">${this.i18n.t("assistant.mode.guidanceBudget")}</p><label><span>${this.i18n.t("assistant.model.choose")}</span><select aria-label=${this.i18n.t("assistant.model.choose")} .value=${this.#selectedModel} @change=${(event: Event) => { this.#selectedModel = (event.currentTarget as HTMLSelectElement).value; this.#premiumApproved = false; this.requestUpdate(); }}><option value="">${this.i18n.t("assistant.model.automatic")}</option>${this.models.map((model) => html`<option value=${model.id}>${this.#modelLabel(model.id)}</option>`)}</select></label>
        ${selectedModel?.premiumApprovalRequired ? html`<label class="forma-assistant-premium"><input type="checkbox" .checked=${this.#premiumApproved} @change=${(event: Event) => { this.#premiumApproved = (event.currentTarget as HTMLInputElement).checked; this.requestUpdate(); }}><span>${this.i18n.t("assistant.model.premiumApproval", "", { amount: this.#amount(selectedModel.maximumMicrousd) })}</span></label>` : nothing}</div>` : nothing}
        <forma-ui-conversation-composer class="forma-assistant-shared-composer" .label=${this.#activeMode === "guidance" ? this.i18n.t("assistant.messageLabel") : this.i18n.t(`assistant.mode.${modeName}`)}
          .value=${this.#draft} .placeholder=${modePlaceholder} .submitLabel=${submitLabel}
          .inputClass=${"forma-assistant-input"} .buttonClass=${"forma-assistant-send"}
          .help=${this.i18n.t("assistant.composer.help")}
          .maxLength=${this.#maximumLength()} .busy=${this.#toolSubmitting}
          .submitDisabled=${Boolean(selectedModel?.premiumApprovalRequired && !this.#premiumApproved || this.busyModes.includes(this.#activeMode))} .compact=${true}
          @forma-input=${(event: CustomEvent<{ value: string }>) => { this.#draft = event.detail.value; this.requestUpdate(); }}></forma-ui-conversation-composer>
      </form>
    </section>`;
  }
}

if (!customElements.get("forma-assistant-panel")) customElements.define("forma-assistant-panel", FormaAssistantPanel);

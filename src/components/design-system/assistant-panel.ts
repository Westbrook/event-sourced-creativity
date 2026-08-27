import { html, nothing, type PropertyValues } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { ASSISTANT_CONTEXT_LIMITS,type AssistantContext } from "../../model/conversation-context.ts";
import type { AssistantInteractionMode } from "../../model/assistant-route-policy.ts";
import { icon } from "../icons.ts";
import { FormaPresentationalElement } from "../presentational-element.ts";
import type { AvailableConsequentialPreview } from "../../../worker/consequential-consent";
import { contextConsentAction } from "../../model/context-consent-state.ts";
import { consequentialPreview } from "../consequential-preview.ts";
import { ensureNativeModalDialog } from "./native-dialog.ts";
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
  savedTurnId?: string;
  canReviewSpecialist?: boolean;
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
  kind?: string;
  model?: string;
  status: string;
  error?: string | null;
  estimatedMicrousd?: number;
  executionId?: string;
  /** A content-free existing-consent reference; never an invented queued task. */
  recoveryOnly?: boolean;
  /** Present only with an exact, current retained-result certificate from a verified response. */
  certifiedCompleted?: boolean;
  completedReview?: AssistantSpecialistCompletedReview;
  retentionUnavailable?: boolean;
  retainedResultUnavailable?: boolean;
  recoveryError?: string;
  bindingHash?: string;
  canExecute?: boolean;
  submission?: "not-submitted" | "submitting" | "uncertain" | "usage-recorded" | "settled";
};
export type AssistantDisplayedModel = { id: "gpt-5.6-luna" | "gpt-5.6-terra" | "gpt-5.6-sol"; maximumMicrousd: number; premiumApprovalRequired: boolean };
export type AssistantTurnOriginalRequest = {
  schema: 1; turnId: string; route: string; projectId: string; documentId: string | null;
  canvasId: string | null; selectedItemIds: string[]; locale: string;
};
type SpecialistReply = { key?: string; values?: Record<string, string | number>; text?: string };
export type AssistantSpecialistOriginalRequest = {
  turnId: string; route: string; projectId: string; documentId: string; canvasId: string | null;
  selectedItemIds: string[]; locale: string; model: string; taskKind: string; sourceHash: string; conversationTurnIds: string[];
};
export type AssistantSpecialistResponse = {
  turnId: string; executionId: string; quote?: AvailableConsequentialPreview; originalRequest?: AssistantSpecialistOriginalRequest;
  task?: AssistantDisplayedTask;
  turn?: { id: string; user: string; reply: SpecialistReply; proposal: AssistantDisplayedProposal | null; proposals?: AssistantDisplayedProposal[]; originalRequest?: AssistantTurnOriginalRequest };
  result?: { reply: SpecialistReply | string; sourceStatus: "original-approved-source" };
  requestedExecutionId?: string; reusedExecutionId?: string; winnerExecutionId?: string; noAutomaticRetry?: boolean; reused?: boolean;
  /** Present only after an exact successful read proves no task, provider submission, or reservation exists. */
  unusedExecution?: boolean;
  error?: string; recoveryError?: string; submission?: string; retentionUnavailable?: boolean; retainedResultUnavailable?: boolean;
};
export type AssistantSpecialistCompletedReview = {
  turnId: string; executionId: string; quote: AvailableConsequentialPreview;
  originalRequest: AssistantSpecialistOriginalRequest;
  result: { reply: SpecialistReply | string; sourceStatus: "original-approved-source" };
};
export type AssistantSpecialistReview = {
  id: string; scope: string; turnId: string; executionId: string; task: AssistantDisplayedTask | null;
  quote: AvailableConsequentialPreview | null; originalRequest: AssistantSpecialistOriginalRequest | null;
  working: boolean; stopping?: boolean; retrievalOnly: boolean; selectedModel?: string; unusedExecution?: boolean;
  notice: "" | "failed" | "uncertain" | "unavailable" | "redirected" | "denied" | "stopUnconfirmed" | "lookupFailed"; resultReply: SpecialistReply | string | null;
};

/** A captured control is an exact user intention, never an instruction to infer the current action. */
export type AssistantSpecialistControl = {
  reviewId: string; turnId: string; executionId: string; bindingHash: string;
  action: "approve" | "run-approved" | "retrieve" | "resume" | "quote"; model?: string;
};

/** Resume is a free read. Only a fresh, exact server proof can enable this separate user action. */
export function assistantApprovedRequestCanRun(state: AssistantSpecialistReview | null, canRequest: boolean) {
  const quote = state?.quote, task = state?.task;
  return Boolean(canRequest && state && !state.working && state.retrievalOnly && !state.notice
    && quote?.status === "reserved" && quote.providerAvailable === true && quote.canExecute === true
    && task && !task.recoveryOnly && task.canExecute === true && task.submission === "not-submitted"
    && ["queued", "running"].includes(task.status) && task.executionId === state.executionId
    && quote.executionId === state.executionId && task.bindingHash === quote.bindingHash
    && Date.parse(quote.expiresAt) > Date.now());
}

/** Stopping is not a purchase: no current key, budget, month or model enrollment is required. */
export function assistantApprovedRequestCanStop(state: AssistantSpecialistReview | null, canRequest: boolean) {
  const quote = state?.quote, task = state?.task, original = state?.originalRequest;
  return Boolean(canRequest && state && !state.working && state.retrievalOnly
    && (!state.notice || state.notice === "redirected") && quote && original && task && !task.recoveryOnly
    && quote.operation === "assistant-specialist" && quote.blockId === ""
    && !task.retentionUnavailable && !task.retainedResultUnavailable
    && ["reserved", "submitting", "uncertain"].includes(quote.status)
    && ["queued", "running", "reconciling"].includes(task.status)
    && task.id === state.executionId && task.executionId === state.executionId && quote.executionId === state.executionId
    && task.turnId === state.turnId && original.turnId === state.turnId
    && task.bindingHash === quote.bindingHash && Boolean(quote.bindingHash)
    && original.sourceHash === quote.sourceHash && original.projectId === quote.projectId
    && original.documentId === quote.documentId && original.canvasId === quote.canvasId
    && task.model === original.model && quote.models.includes(original.model));
}

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
    retainGuidanceDraft: { type: Boolean },
    guidanceDelivery: { type: String },
    canSpecialist: { type: Boolean },
    specialist: { attribute: false },
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
  declare retainGuidanceDraft: boolean;
  declare guidanceDelivery: "" | "sending" | "uncertain";
  declare canSpecialist: boolean;
  declare specialist: AssistantSpecialistReview | null;
  #draft = "";
  #activeMode: AssistantInteractionMode = "guidance";
  #toolSubmitting = false;
  #drafts = new Map<AssistantInteractionMode, string>();
  #guidanceSubmitting = false;
  #specialistOpener: HTMLElement | null = null;
  #specialistFocusScope = "";
  #specialistDialogId = "assistant-specialist-" + crypto.randomUUID();
  #modalReady = false;
  #dismissedSpecialistId = "";
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
    this.retainGuidanceDraft = false;
    this.guidanceDelivery = "";
    this.canSpecialist = false;
    this.specialist = null;
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
    if (changed.has("guidanceDelivery") && this.guidanceDelivery !== "sending") this.#guidanceSubmitting = false;
    if (changed.has("conversationScope") && changed.get("conversationScope") !== undefined) {
      this.clearConversationDrafts();
    }
  }

  protected override updated(changed: PropertyValues) {
    super.updated(changed);
    if (changed.has("modes") && !this.modes.includes(this.#activeMode)) this.#activeMode = "guidance";
    if (changed.has("open") && this.open) queueMicrotask(() => { if (!this.specialist && !document.querySelector("dialog:modal")) this.querySelector<HTMLTextAreaElement>(".forma-assistant-input")?.focus(); });
    if (changed.has("open") && !this.open && changed.get("open")) queueMicrotask(() => this.querySelector<HTMLButtonElement>(".forma-assistant-launcher")?.focus());
    if (changed.has("messages") && !this.#sameRenderedMessages(changed.get("messages") as AssistantDisplayedMessage[] | undefined)) queueMicrotask(() => {
      const transcript = this.querySelector<HTMLElement>(".forma-assistant-transcript");
      if (transcript) transcript.scrollTop = transcript.scrollHeight;
    });
    if (this.specialist && this.specialist.id !== this.#dismissedSpecialistId && this.open) {
      const ready = ensureNativeModalDialog(this.querySelector<HTMLDialogElement>(".forma-assistant-specialist"));
      if (this.#modalReady !== ready) { this.#modalReady = ready; this.requestUpdate(); }
    } else this.#modalReady = false;
    if (this.open) {
      this.style.removeProperty("--forma-assistant-obstacle-offset");
      delete this.dataset.compactLauncher;
    } else this.#schedulePosition();
  }

  #sameRenderedMessages(previous: AssistantDisplayedMessage[] | undefined) {
    if (!previous || previous.length !== this.messages.length) return false;
    // Lit already retains the prior property for this update. Compare what is
    // displayed, not new object identities, without retaining another transcript.
    const visible = (message: AssistantDisplayedMessage) => [
      message.id, message.role, message.key ? this.i18n.t(message.key, "", message.values ?? {}) : message.text ?? "",
      message.savedTurnId ?? "", Boolean(message.canReviewSpecialist), message.reviewMode ?? "", Boolean(message.reviewReady),
    ];
    return this.messages.every((message, index) => JSON.stringify(visible(message)) === JSON.stringify(visible(previous[index]!)));
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

  clearConversationDrafts() {
    this.#draft = "";
    this.#drafts.clear();
    this.#activeMode = "guidance";
    this.#toolSubmitting = false;
    this.#guidanceSubmitting = false;
    this.#specialistOpener = null;
    this.#specialistFocusScope = "";
    this.#modalReady = false;
    this.#dismissedSpecialistId = "";
    const field = this.querySelector<HTMLTextAreaElement>(".forma-assistant-input");
    if (field) field.value = "";
    this.requestUpdate();
  }

  restoreDraft(value: string) {
    if (this.#draft || !value) return;
    this.#draft = value.slice(0, this.#maximumLength());
    const field = this.querySelector<HTMLTextAreaElement>(".forma-assistant-input");
    if (field) field.value = this.#draft;
    this.requestUpdate();
  }

  resolveGuidanceRequest(accepted: boolean, message: string) {
    this.#guidanceSubmitting = false;
    if (this.#activeMode === "guidance") {
      if (accepted && this.#draft.trim() === message) this.#draft = "";
      else if (!accepted && !this.#draft) this.#draft = message.slice(0, this.#maximumLength());
    }
    const saved = this.#drafts.get("guidance") ?? "";
    if (accepted && saved.trim() === message) this.#drafts.set("guidance", "");
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
    if (!value || value.length > this.#maximumLength() || this.#toolSubmitting || this.busyModes.includes(this.#activeMode)
      || this.#activeMode === "guidance" && (this.#guidanceSubmitting || this.guidanceDelivery)) return;
    if (this.#activeMode !== "guidance") {
      this.#toolSubmitting = true;
      this.requestUpdate();
      this.dispatchEvent(new CustomEvent("forma-assistant-message", { detail: { message: value, mode: this.#activeMode }, bubbles: true, composed: true }));
      return;
    }
    // Creator retains this exact draft until its saved turn is confirmed. Platform
    // keeps its independent host contract and never acquires specialist controls.
    if (this.retainGuidanceDraft) this.#guidanceSubmitting = true;
    else {
      this.#draft = "";
      const field = this.querySelector<HTMLTextAreaElement>(".forma-assistant-input");
      if (field) field.value = "";
    }
    this.dispatchEvent(new CustomEvent("forma-assistant-message", { detail: { message: value }, bubbles: true, composed: true }));
    this.requestUpdate();
  }

  #contextName() {
    return this.context?.documentTitle || this.pageLabel || this.i18n.system(this.context?.surface.page ?? "");
  }

  #openSpecialist(event: Event, turnId: string, task?: AssistantDisplayedTask) {
    if (document.querySelector("dialog:modal")) return;
    this.#specialistOpener = event.currentTarget as HTMLElement;
    this.#specialistFocusScope = this.conversationScope;
    this.dispatchEvent(new CustomEvent("forma-assistant-specialist-review", { detail: { turnId, ...(task ? { task } : {}) }, bubbles: true, composed: true }));
  }

  #closeSpecialist(expectedReviewId: string) {
    const state = this.specialist;
    if (!state || state.id !== expectedReviewId || state.id === this.#dismissedSpecialistId) return;
    // A child readiness render can precede the host clearing its old prop.
    // Dismissal is terminal for this review ID, even before that parent commit.
    this.#dismissedSpecialistId = state.id;
    this.#modalReady = false;
    const scope = this.conversationScope, opener = this.#specialistOpener;
    const target = { turnId: state.turnId, executionId: state.executionId };
    const dialog = this.querySelector<HTMLDialogElement>(".forma-assistant-specialist");
    if (dialog?.open) dialog.close();
    this.dispatchEvent(new CustomEvent("forma-assistant-specialist-close", { detail: { reviewId: state.id }, bubbles: true, composed: true }));
    void this.updateComplete.then(() => requestAnimationFrame(() => {
      if (!this.isConnected || scope !== this.conversationScope || this.specialist || document.querySelector("dialog:modal")) return;
      if (!this.open) { this.querySelector<HTMLButtonElement>(".forma-assistant-launcher")?.focus(); return; }
      const controls = [...this.querySelectorAll<HTMLButtonElement>("[data-assistant-recovery]")]
        .filter((button) => button.isConnected && !button.disabled);
      const matches = (button: HTMLElement, allowTurnOnly = false) => Boolean(target
        && button.dataset.assistantTurnId === target.turnId
        && (button.dataset.assistantExecutionId === target.executionId || allowTurnOnly && !button.dataset.assistantExecutionId));
      const exact = target?.executionId ? controls.find((button) => matches(button)) : undefined;
      const original = scope === this.#specialistFocusScope && opener?.isConnected && matches(opener, true) ? opener : null;
      const sameTurn = controls.find((button) => matches(button, true));
      (exact ?? original ?? sameTurn ?? this.querySelector<HTMLElement>(".forma-assistant-header [data-assistant-heading]"))?.focus({ preventScroll: true });
    }));
  }

  #specialistLabelValues(id: string) {
    return { id: "\u2068" + id + "\u2069", context: "\u2068" + this.#contextName() + "\u2069" };
  }

  #specialistTargetCurrent(target: Omit<AssistantSpecialistControl, "action" | "model">) {
    const state = this.specialist, dialog = this.querySelector<HTMLDialogElement>(".forma-assistant-specialist");
    return Boolean(this.isConnected && this.open && this.#modalReady && state && !state.working
      && state.scope === this.conversationScope && state.id === target.reviewId && state.turnId === target.turnId
      && state.executionId === target.executionId
      && (state.quote?.bindingHash ?? state.task?.bindingHash ?? "") === target.bindingHash
      && dialog?.matches(":modal") && ![...document.querySelectorAll<HTMLDialogElement>("dialog:modal")].some(other => other !== dialog));
  }

  #hasUnusedSpecialistProof(state: AssistantSpecialistReview | null) {
    const quote = state?.quote, original = state?.originalRequest;
    return Boolean(state && state.scope === this.conversationScope && !state.working && !state.notice
      && state.retrievalOnly && state.unusedExecution === true
      && (!state.task || state.task.recoveryOnly && state.task.id === state.executionId && state.task.executionId === state.executionId
        && state.task.turnId === state.turnId && (!state.task.bindingHash || state.task.bindingHash === quote?.bindingHash))
      && state.resultReply === null && quote?.status === "quoted" && quote.canExecute === false && original
      && Boolean(state.id && state.turnId && state.executionId) && quote.executionId === state.executionId
      && /^[a-f0-9]{64}$/u.test(quote.bindingHash) && original.turnId === state.turnId
      && quote.operation === "assistant-specialist" && quote.blockId === ""
      && original.projectId === quote.projectId && original.documentId === quote.documentId
      && original.canvasId === quote.canvasId && original.sourceHash === quote.sourceHash
      && quote.models.includes(original.model));
  }

  #canRefreshSpecialist(state: AssistantSpecialistReview) {
    // Inspection can retain the original model even when its next purchase is unavailable.
    return this.canSpecialist && this.#hasUnusedSpecialistProof(state);
  }

  #specialistControl(detail: AssistantSpecialistControl, modelChange = false) {
    if (!this.#specialistTargetCurrent(detail)) return;
    const state = this.specialist!, quote = state.quote;
    const purchase = Boolean(quote && !state.retrievalOnly && quote.status === "quoted");
    const allowed = detail.action === "approve" ? purchase && this.canSpecialist && quote
      && Date.parse(quote.expiresAt) > Date.now() && !contextConsentAction(quote.status, quote.providerAvailable, quote.canExecute === true).disabled
      : detail.action === "run-approved" ? assistantApprovedRequestCanRun(state, this.canSpecialist)
      : detail.action === "retrieve" ? !purchase && Boolean(detail.executionId && detail.bindingHash)
      : detail.action === "resume" ? !purchase && Boolean(detail.executionId && !detail.bindingHash)
      : detail.action === "quote" && this.canSpecialist && detail.model
        && (modelChange ? this.models.some(model => model.id === detail.model) && !state.retrievalOnly && (!quote || quote.status === "quoted")
          : this.#canRefreshSpecialist(state) && detail.model === state.originalRequest?.model);
    if (!allowed || modelChange && detail.action !== "quote") return;
    if (modelChange) this.dispatchEvent(new CustomEvent<AssistantSpecialistControl>("forma-assistant-specialist-model", { detail, bubbles: true, composed: true }));
    else this.dispatchEvent(new CustomEvent<AssistantSpecialistControl>("forma-assistant-specialist-action", { detail, bubbles: true, composed: true }));
  }

  #taskHasSignedApproval(task: AssistantDisplayedTask) {
    return Boolean(task.executionId && task.id === task.executionId && task.bindingHash
      && /^[a-f0-9]{64}$/u.test(task.bindingHash) && task.error !== "assistant_legacy_approval_required");
  }

  #specialistFinancial(task: AssistantDisplayedTask | null) {
    const review = this.specialist;
    // A content-free recovery row is not proof. Reuse only the currently read
    // certificate, and only for this exact request, independently of purchasing.
    if (this.#hasUnusedSpecialistProof(review) && (!task || task.recoveryOnly
      && task.id === review!.executionId && task.executionId === review!.executionId
      && task.turnId === review!.turnId && task.bindingHash === review!.quote!.bindingHash)) {
      return this.i18n.t("assistant.specialist.unusedFinancial");
    }
    const state = task?.submission;
    return this.i18n.t(state === "settled" ? "assistant.specialist.settled"
      : state === "usage-recorded" ? "assistant.specialist.usageRecorded"
      : state === "not-submitted" ? "assistant.specialist.notSubmitted"
      : "assistant.specialist.billingUnknown");
  }

  #specialistView() {
    const state = this.specialist;
    if (!state || state.id === this.#dismissedSpecialistId) return nothing;
    const quote = state.quote;
    const purchase = Boolean(quote && !state.retrievalOnly && quote.status === "quoted");
    const canRunApproved = assistantApprovedRequestCanRun(state, this.canSpecialist);
    const canStopApproved = assistantApprovedRequestCanStop(state, this.canSpecialist);
    const canRefresh = this.#canRefreshSpecialist(state);
    const target = { reviewId: state.id, turnId: state.turnId, executionId: state.executionId, bindingHash: quote?.bindingHash ?? state.task?.bindingHash ?? "" };
    const primaryControl: AssistantSpecialistControl = { ...target, action: purchase ? "approve" : target.bindingHash ? "retrieve" : "resume" };
    const runControl: AssistantSpecialistControl = { ...target, action: "run-approved" };
    const modelControl: AssistantSpecialistControl = { ...target, action: "quote" };
    const refreshControl: AssistantSpecialistControl = { ...target, action: "quote", model: state.originalRequest?.model };
    const action = quote ? contextConsentAction(quote.status, quote.providerAvailable, quote.canExecute === true) : null;
    const expired = Boolean(quote && Date.parse(quote.expiresAt) <= Date.now());
    const disabled = state.working || !this.#modalReady || (purchase
      ? !this.canSpecialist || expired || !action || action.disabled
      : !state.executionId);
    const selected = this.models.find((model) => model.id === (quote?.models[0] ?? state.selectedModel));
    const reply = typeof state.resultReply === "string" ? state.resultReply
      : state.resultReply?.key ? this.i18n.t(state.resultReply.key, "", state.resultReply.values ?? {}) : state.resultReply?.text;
    // Native cancel/close tasks target an element, not a render-time callback.
    // Give each review its own element even when close and reopen coalesce.
    return keyed(state.id, html`<dialog class="modal forma-assistant-specialist" aria-labelledby=${this.#specialistDialogId} aria-describedby=${this.#specialistDialogId + "-detail"}
      @cancel=${(event: Event) => { event.preventDefault(); event.stopPropagation(); this.#closeSpecialist(state.id); }}
      @close=${(event: Event) => { if (this.specialist?.id === state.id && !(event.currentTarget as HTMLDialogElement).open) this.#closeSpecialist(state.id); }}
      @keydown=${(event: KeyboardEvent) => { if (event.key === "Escape" && !event.isComposing) { event.preventDefault(); event.stopPropagation(); this.#closeSpecialist(state.id); } }}>
      <section class="modal-card context-consent">
        <header><h2 id=${this.#specialistDialogId}>${this.i18n.t("assistant.specialist.title")}</h2></header>
        <p id=${this.#specialistDialogId + "-detail"}>${this.i18n.t("assistant.specialist.summary")}</p>
        <p dir="auto">${this.i18n.t("assistant.specialist.reference", "", { id: state.turnId, task: state.task?.id || state.executionId || "—" })}</p>
        ${quote ? consequentialPreview(quote, this.i18n) : nothing}
        ${!state.retrievalOnly && this.canSpecialist && this.models.length && (quote || state.selectedModel) ? html`<div class="forma-assistant-model">
          <label><span>${this.i18n.t("assistant.model.choose")}</span>
            <select aria-label=${this.i18n.t("assistant.specialist.modelLabel", "", this.#specialistLabelValues(state.turnId))} .value=${quote?.models[0] ?? state.selectedModel ?? ""} ?disabled=${state.working || !this.#modalReady}
              @change=${(event: Event) => this.#specialistControl({ ...modelControl, model: (event.currentTarget as HTMLSelectElement).value }, true)}>
              ${quote?.models[0] && !selected ? html`<option value=${quote.models[0]} disabled selected>${this.i18n.t("assistant.specialist.modelUnavailable", "", { model: this.#modelLabel(quote.models[0]) })}</option>` : nothing}
              ${this.models.map((model) => html`<option value=${model.id}>${this.#modelLabel(model.id)}</option>`)}
            </select>
          </label>
          ${quote && selected?.premiumApprovalRequired ? html`<p>${this.i18n.t("assistant.specialist.premium", "", { amount: this.#amount(quote.maximumMicrousd) })}</p>` : nothing}
        </div>` : nothing}
        ${canRunApproved ? html`<p>${this.i18n.t("assistant.specialist.runApprovedDetail")}</p>` : nothing}
        ${canStopApproved ? html`<p>${this.i18n.t("assistant.specialist.stopDetail")}</p>` : nothing}
        ${canRefresh ? html`<p>${this.i18n.t("assistant.specialist.refreshDetail")}</p>` : nothing}
        ${state.working ? html`<p role="status">${this.i18n.t(state.stopping ? "assistant.specialist.stopping" : "assistant.specialist.working")}</p>` : nothing}
        ${state.notice ? html`<p role="status">${this.i18n.t("assistant.specialist." + state.notice)}</p>` : nothing}
        ${purchase && expired ? html`<p role="status">${this.i18n.t("assistant.specialist.expired")}</p>` : nothing}
        ${state.task && !state.task.recoveryOnly ? html`<p role="status">${this.#taskStatus(state.task)}</p>` : nothing}
        ${state.retrievalOnly || state.task ? html`<p role="status">${this.#specialistFinancial(state.task)}</p>` : nothing}
        ${reply ? html`<section class="forma-assistant-specialist-result"><h3>${this.i18n.t("assistant.specialist.originalResult")}</h3><p dir="auto">${reply}</p><small>${this.i18n.t("assistant.specialist.resultReview")}</small></section>` : nothing}
        <footer>
          <button type="button" class="button secondary" @click=${() => this.#closeSpecialist(state.id)}>${this.i18n.t("assistant.specialist.close")}</button>
          ${canStopApproved || state.stopping && state.working ? html`<button type="button" class="button ghost" ?disabled=${!canStopApproved || !this.#modalReady}
            aria-label=${this.i18n.t("assistant.specialist.stopLabel", "", this.#specialistLabelValues(state.executionId))}
            @click=${() => { if (this.#specialistTargetCurrent(target) && assistantApprovedRequestCanStop(this.specialist, this.canSpecialist)) this.dispatchEvent(new CustomEvent("forma-assistant-task", { detail: { task: this.specialist!.task!, action: "cancel" }, bubbles: true, composed: true })); }}>
            ${this.i18n.t("assistant.specialist.stop")}</button>` : nothing}
          ${canRunApproved ? html`<button type="button" class="button" ?disabled=${!this.#modalReady}
            aria-label=${this.i18n.t("assistant.specialist.runApprovedLabel", "", this.#specialistLabelValues(state.executionId))}
            @click=${() => this.#specialistControl(runControl)}>
            ${this.i18n.t("assistant.specialist.runApproved")}</button>` : nothing}
          ${quote || state.executionId ? html`<button type="button" class=${canRunApproved ? "button secondary" : "button"} ?disabled=${disabled}
            aria-label=${this.i18n.t(purchase ? "assistant.specialist.approveLabel" : "assistant.specialist.retrieveLabel", "", this.#specialistLabelValues(state.executionId))}
            @click=${() => { if (!disabled) this.#specialistControl(primaryControl); }}>
            ${this.i18n.t(purchase ? "assistant.specialist.approve" : "assistant.specialist.retrieve")}
          </button>` : nothing}
          ${canRefresh ? html`<button type="button" class="button secondary" ?disabled=${!this.#modalReady}
            aria-label=${this.i18n.t("assistant.specialist.refreshLabel", "", this.#specialistLabelValues(state.executionId))}
            @click=${() => this.#specialistControl(refreshControl)}>${this.i18n.t("assistant.specialist.refresh")}</button>` : nothing}
        </footer>
      </section>
    </dialog>`);
  }

  #amount(microusd: number) {
    return new Intl.NumberFormat(this.i18n.locale, { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(Math.max(0, microusd) / 1_000_000);
  }

  #modelLabel(model: string) {
    const id = model.endsWith("-sol") ? "sol" : model.endsWith("-terra") ? "terra" : model.endsWith("-luna") ? "luna" : "";
    return id ? this.i18n.t(`assistant.model.${id}`) : model;
  }

  #taskStatus(task: AssistantDisplayedTask) {
    if (task.recoveryOnly) return this.i18n.t("assistant.specialist.recoveryStatus");
    if (task.executionId && task.status === "canceled") return this.i18n.t("assistant.specialist.canceled");
    const id = task.status === "queued" ? "queued" : task.status === "running" ? "running"
      : task.status === "completed" ? "completed" : task.status === "canceled" ? "canceled"
      : task.status === "reconciled" ? "reconciled" : task.status === "needs-review" || task.status === "reconciling" ? "needsReview" : "failed";
    return this.i18n.t(`assistant.task.${id}`);
  }

  override render() {
    if (!this.open) return html`<button type="button" class="forma-assistant-launcher" aria-haspopup="dialog" aria-label=${this.i18n.t("assistant.open")} title=${this.i18n.t("assistant.open")} @click=${() => { this.#toggle(true); }}>${icon("spark")}<span>${this.i18n.t("assistant.open")}</span></button>`;
    const context = this.context;
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
    return html`<section class="forma-assistant-panel" role="dialog" aria-modal="false" aria-labelledby="forma-assistant-title" @keydown=${(event: KeyboardEvent) => { if (event.key === "Escape" && !event.isComposing && !document.querySelector("dialog:modal")) { event.preventDefault(); event.stopPropagation(); this.#toggle(false); } }}>
      <header class="forma-assistant-header"><div><h2 id="forma-assistant-title" data-assistant-heading tabindex="-1">${this.i18n.t("assistant.heading")}</h2><small>${this.i18n.t("assistant.privacy")}</small></div><button type="button" class="icon-button forma-assistant-close" aria-label=${this.i18n.t("assistant.close")} @click=${() => this.#toggle(false)}>${icon("close")}</button></header>
      <div class="forma-assistant-transcript" role="log" aria-live="polite" aria-relevant="additions">
        ${context ? html`<small class="forma-assistant-page">${this.i18n.t("assistant.page", "", { page: this.pageLabel || this.i18n.system(context.surface.page) })}</small>${context.documentTitle ? html`<small class="forma-assistant-page">${this.i18n.t("assistant.document", "", { title: context.documentTitle })}</small>` : nothing}${context.scope.documentId?html`<small class="forma-assistant-page" role="status">${this.i18n.t("assistant.coverage.visible","",{count:this.i18n.number(context.decisionAtoms.length),total:this.i18n.number(context.totals.decisions)})}${context.decisionAtoms.length<context.totals.decisions?` ${this.i18n.system("· truncated")}`:""}</small><small class="forma-assistant-page">${this.i18n.t("assistant.coverage.readable","",{count:this.i18n.number(readable)})}${withheld?` · ${this.i18n.t("assistant.coverage.withheld","",{count:this.i18n.number(withheld)})}`:""}</small>${protectedOverflow?html`<small class="forma-assistant-page" role="status">${this.i18n.t("assistant.coverage.protectedOverflow","",{count:this.i18n.number(protectedOverflow)})}</small>`:nothing}${protectedTextOverflow?html`<small class="forma-assistant-page" role="status">${this.i18n.t("assistant.coverage.protectedText","",{count:this.i18n.number(protectedTextOverflow)})}</small>`:nothing}${unsafeRights?html`<small class="forma-assistant-page" role="status">${this.i18n.t("assistant.coverage.rightsBlocked","",{count:this.i18n.number(unsafeRights)})}</small>`:nothing}`:nothing}${context.selectedItems.map((item) => html`<small class="forma-assistant-page">${this.i18n.t("assistant.selection", "", { title: item.title })}</small>`)}` : nothing}
        ${this.messages.length ? this.messages.map((message) => html`<div class=${`forma-assistant-message forma-assistant-message--${message.role}`} dir="auto"><p>${message.key ? this.i18n.t(message.key, "", message.values ?? {}) : message.text}</p>${message.savedTurnId && message.canReviewSpecialist && this.canSpecialist && !this.tasks.some((task) => task.turnId === message.savedTurnId && task.executionId) ? html`<button type="button" class="button secondary compact forma-assistant-review" data-assistant-recovery data-assistant-turn-id=${message.savedTurnId} aria-label=${this.i18n.t("assistant.specialist.reviewLabel", "", this.#specialistLabelValues(message.savedTurnId))} @click=${(event: Event) => this.#openSpecialist(event, message.savedTurnId!)}>${this.i18n.t("assistant.specialist.review")}</button>` : nothing}${message.reviewMode?html`<button type="button" class="button secondary compact forma-assistant-review" ?disabled=${!message.reviewReady} @click=${()=>{const mode=message.reviewMode;if(mode)this.dispatchEvent(new CustomEvent<{mode:"plan-document"|"plan-board"}>("forma-assistant-review",{detail:{mode},bubbles:true,composed:true}));}}>${this.i18n.t("assistant.reviewSuggestions")}</button>`:nothing}</div>`) : html`<p class="forma-assistant-message forma-assistant-message--assistant">${this.i18n.t("assistant.greeting")}</p>`}
        ${this.proposals.map((proposal) => html`<article class="forma-assistant-proposal"><small>${this.i18n.t("assistant.proposedAction")}</small>${proposal.summary || proposal.summaryKey ? html`<p dir="auto">${proposal.summaryKey ? this.i18n.t(proposal.summaryKey) : proposal.summary}</p>` : nothing}<button type="button" class="button secondary compact" ?disabled=${this.readOnly && proposal.kind !== "navigate"} @click=${() => this.dispatchEvent(new CustomEvent("forma-assistant-proposal", { detail: { proposal, action: "accept" }, bubbles: true, composed: true }))}>${this.i18n.t(proposal.key)}</button><button type="button" class="button ghost compact" ?disabled=${this.readOnly && proposal.kind !== "navigate"} @click=${() => this.dispatchEvent(new CustomEvent("forma-assistant-proposal", { detail: { proposal, action: "dismiss" }, bubbles: true, composed: true }))}>${this.i18n.t("assistant.dismissProposal")}</button></article>`)}
        ${this.tasks.map((task) => html`<article class="forma-assistant-task" data-task-id=${task.id} data-task-status=${task.status}>
          <small>${this.i18n.t(task.recoveryOnly ? "assistant.specialist.recoveryHeading" : "assistant.task.heading")}${task.model ? " · " + this.#modelLabel(task.model) : ""}</small>
          <p role="status" dir="auto">${this.#taskStatus(task)}</p>
          ${!task.recoveryOnly && typeof task.estimatedMicrousd === "number" ? html`<small>${this.i18n.t(this.#taskHasSignedApproval(task) ? "assistant.task.estimatedCost" : "assistant.task.historicalEstimate", "", { amount: this.#amount(task.estimatedMicrousd) })}</small>` : nothing}
          ${!task.recoveryOnly && !this.#taskHasSignedApproval(task) ? html`<small>${this.i18n.t("assistant.task.approvalUnverified")}</small>` : nothing}
          ${task.executionId ? html`<p role="status">${this.#specialistFinancial(task)}</p><button type="button" class="button secondary compact"
            data-assistant-recovery data-assistant-turn-id=${task.turnId} data-assistant-execution-id=${task.executionId}
            aria-label=${this.i18n.t("assistant.specialist.retrieveLabel", "", this.#specialistLabelValues(task.id))}
            @click=${(event: Event) => this.#openSpecialist(event, task.turnId, task)}>${this.i18n.t("assistant.specialist.retrieve")}</button>` : nothing}
          ${!task.executionId && task.status === "queued" ? html`<button type="button" class="button ghost compact" @click=${() => this.dispatchEvent(new CustomEvent("forma-assistant-task", { detail: { task, action: "cancel" }, bubbles: true, composed: true }))}>${this.i18n.t("assistant.task.cancel")}</button>` : nothing}
          ${!task.executionId && task.status === "running" ? html`<small>${this.i18n.t("assistant.task.cancelUnavailable")}</small>` : nothing}
          ${!task.executionId && ["needs-review", "reconciling"].includes(task.status) && !this.canReconcile ? html`<small>${this.i18n.t("assistant.task.contactAdministrator")}</small><small>${this.i18n.t("assistant.task.reviewReference", "", { id: task.id })}</small>` : nothing}
          ${!task.executionId && ["needs-review", "reconciling"].includes(task.status) && this.canReconcile ? html`<button type="button" class="button secondary compact" @click=${() => this.dispatchEvent(new CustomEvent("forma-assistant-task", { detail: { task, action: "reconcile" }, bubbles: true, composed: true }))}>${this.i18n.t("assistant.task.reconcile")}</button>` : nothing}
        </article>`)}
        ${this.guidanceOnly && this.#activeMode === "guidance" ? html`<p class="forma-assistant-read-only">${this.i18n.t("assistant.guidanceOnly")}</p>`
          : this.readOnly ? html`<p class="forma-assistant-read-only">${this.i18n.t("assistant.readOnly")}</p>` : nothing}
        ${this.pending ? html`<p class="forma-assistant-pending" role="status">${this.pending === 1 ? this.i18n.t("assistant.sending") : this.i18n.t("assistant.pending", "", { count: this.i18n.number(this.pending) })}</p>` : nothing}
      </div>
      <form class="forma-assistant-composer" data-attention-context=${this.#activeMode==="guidance"?"assistant-guidance":"writing-direction"} @submit=${this.#submit}>
        ${this.modes.length > 1 ? html`<div class="forma-assistant-modes" role="group" aria-label=${this.i18n.t("assistant.mode.label")}>${this.modes.map((mode) => html`<button type="button" class="forma-assistant-mode" aria-pressed=${String(this.#activeMode === mode)} ?disabled=${this.#toolSubmitting} @click=${() => { this.#drafts.set(this.#activeMode, this.#draft); this.#activeMode = mode; this.#draft = this.#drafts.get(mode) ?? ""; this.requestUpdate(); }}>${this.i18n.t(`assistant.mode.${this.#modeName(mode)}`)}</button>`)}</div><p class="forma-assistant-mode-detail">${this.i18n.t(`assistant.mode.${modeName}Detail`)}</p>` : nothing}
        ${this.#activeMode === "guidance" && this.retainGuidanceDraft ? html`<p class="forma-assistant-mode-detail">${this.i18n.t("assistant.mode.guidanceBudget")}</p>` : nothing}
        ${this.guidanceDelivery === "uncertain" ? html`<div class="forma-assistant-guidance-recovery">
          <p role="status">${this.i18n.t("assistant.guidance.unconfirmed")}</p>
          <button type="button" class="button secondary" @click=${() => this.dispatchEvent(new CustomEvent("forma-assistant-guidance-recovery", { detail: { action: "check" }, bubbles: true, composed: true }))}>${this.i18n.t("assistant.guidance.check")}</button>
          <button type="button" class="button ghost" @click=${() => this.dispatchEvent(new CustomEvent("forma-assistant-guidance-recovery", { detail: { action: "retry" }, bubbles: true, composed: true }))}>${this.i18n.t("assistant.guidance.retry")}</button>
        </div>` : nothing}
        <forma-ui-conversation-composer class="forma-assistant-shared-composer" .label=${this.#activeMode === "guidance" ? this.i18n.t("assistant.messageLabel") : this.i18n.t(`assistant.mode.${modeName}`)}
          .value=${this.#draft} .placeholder=${modePlaceholder} .submitLabel=${submitLabel}
          .inputClass=${"forma-assistant-input"} .buttonClass=${"forma-assistant-send"}
          .help=${this.i18n.t("assistant.composer.help")}
          .maxLength=${this.#maximumLength()} .busy=${this.#toolSubmitting}
          .submitDisabled=${Boolean(this.busyModes.includes(this.#activeMode) || this.#activeMode === "guidance" && (this.#guidanceSubmitting || this.guidanceDelivery))} .compact=${true}
          @forma-input=${(event: CustomEvent<{ value: string }>) => { this.#draft = event.detail.value; this.requestUpdate(); }}></forma-ui-conversation-composer>
      </form>
      ${this.#specialistView()}
    </section>`;
  }
}

if (!customElements.get("forma-assistant-panel")) customElements.define("forma-assistant-panel", FormaAssistantPanel);

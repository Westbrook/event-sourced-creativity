import { html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { ASSISTANT_CONTEXT_LIMITS,type AssistantContext } from "../../model/conversation-context.ts";
import type { AssistantInteractionMode } from "../../model/assistant-route-policy.ts";
import { icon } from "../icons.ts";
import { FormaPresentationalElement } from "../presentational-element.ts";
import type { AvailableConsequentialPreview } from "../../../worker/consequential-consent";
import { contextConsentAction } from "../../model/context-consent-state.ts";
import { consequentialPreview } from "../consequential-preview.ts";
import { ensureNativeModalDialog } from "./native-dialog.ts";
import { captureOutputNavigationFocus, type OutputNavigationFocusLease } from "../output-navigation-focus.ts";
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
    continuation: { attribute: false },
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
  /** Local presentation only; never a conversation message or tool request. */
  declare continuation: TemplateResult | typeof nothing;
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
  #browsePointer: MediaQueryList | null = null;
  #revalidateBrowseSlot = () => {
    this.#schedulePosition();
  };
  #schedulePosition = () => {
    if (this.#positionFrame || this.open && this.dataset.browseSlot !== "true") return;
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
    this.continuation = nothing;
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
    window.addEventListener("focusin", this.#schedulePosition, { passive: true });
    window.addEventListener("transitionend", this.#schedulePosition, { passive: true });
    this.#browsePointer = typeof window.matchMedia === "function" ? window.matchMedia("(pointer: coarse)") : null;
    this.#browsePointer?.addEventListener("change", this.#revalidateBrowseSlot);
  }

  override disconnectedCallback() {
    this.#clearStudioLauncher();
    this.#clearBrowseLauncher();
    this.#browsePointer?.removeEventListener("change", this.#revalidateBrowseSlot);
    this.#browsePointer = null;
    window.removeEventListener("resize", this.#schedulePosition);
    window.removeEventListener("scroll", this.#schedulePosition, true);
    window.removeEventListener("focusin", this.#schedulePosition);
    window.removeEventListener("transitionend", this.#schedulePosition);
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
    if (changed.has("open") && !this.open && changed.get("open")) {
      const launcher = this.querySelector<HTMLButtonElement>(".forma-assistant-launcher");
      queueMicrotask(() => {
        if (!this.isConnected || this.open || !launcher?.isConnected
          || this.querySelector(".forma-assistant-launcher") !== launcher) return;
        this.#positionLauncher();
        if (this.isConnected && !this.open && launcher.isConnected
          && this.querySelector(".forma-assistant-launcher") === launcher) launcher.focus();
      });
    }
    if (changed.has("messages") && !this.#sameRenderedMessages(changed.get("messages") as AssistantDisplayedMessage[] | undefined)) queueMicrotask(() => {
      const transcript = this.querySelector<HTMLElement>(".forma-assistant-transcript");
      if (transcript) transcript.scrollTop = transcript.scrollHeight;
    });
    if (this.specialist && this.specialist.id !== this.#dismissedSpecialistId && this.open) {
      const ready = ensureNativeModalDialog(this.querySelector<HTMLDialogElement>(".forma-assistant-specialist"));
      if (this.#modalReady !== ready) { this.#modalReady = ready; this.requestUpdate(); }
    } else this.#modalReady = false;
    if (this.open) {
      this.#clearStudioLauncher();
      this.#clearBrowseLauncher(false);
      this.style.removeProperty("--forma-assistant-obstacle-offset");
      delete this.dataset.compactLauncher;
      delete this.dataset.tightLauncher;
      if (this.dataset.browseSlot === "true") this.#schedulePosition();
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

  #clearStudioLauncher() {
    delete this.dataset.studioLauncher;
    for (const name of ["left", "top", "size"]) this.style.removeProperty(`--forma-assistant-studio-${name}`);
  }

  #clearBrowseLauncher(reservation = true) {
    delete this.dataset.browseLauncher;
    if (reservation) delete this.dataset.browseSlot;
    for (const name of ["left", "top", "size"]) this.style.removeProperty(`--forma-assistant-browse-${name}`);
  }

  #positionInStudioSlot() {
    // The actual floating owner, not a session flag, qualifies this layout.
    const owner = this.parentElement;
    const shell = owner?.closest<HTMLElement>(".application-creative");
    if (!this.isConnected || !owner?.matches("forma-creative-assistant") || !shell
      || shell.getAttribute("data-layout-intent") !== "workbench"
      || !(shell.getAttribute("data-nav-posture") === "compact" || shell.getAttribute("data-short-height") === "true")) return false;
    const panels = [...shell.querySelectorAll("forma-assistant-panel")]
      .filter(panel => panel.closest(".application-creative") === shell);
    const main = shell.querySelector<HTMLElement>("#main-content");
    if (panels.length !== 1 || panels[0] !== this || !main
      || main.closest(".application-creative") !== shell || main.getAttribute("aria-busy") === "true") return false;
    const hosts = [...main.querySelectorAll<HTMLElement>("forma-studio-mode-nav")]
      .filter(host => host.isConnected && host.closest("#main-content") === main
        && host.closest(".application-creative") === shell && host.closest(".studio-header-stack"));
    if (hosts.length !== 1) return false;
    const host = hosts[0]!, nav = host.querySelector<HTMLElement>(".studio-mode-nav");
    if (!nav || nav.closest("forma-studio-mode-nav") !== host
      || host.closest("[hidden], [inert], [aria-hidden='true']")) return false;
    const style = getComputedStyle(host), bounds = host.getBoundingClientRect();
    if (style.getPropertyValue("--forma-assistant-studio-slot").trim() !== "1" || style.display !== "grid") return false;
    const columns = style.gridTemplateColumns.trim().split(/\s+/u).map(value => Number.parseFloat(value));
    const gap = Number.parseFloat(style.columnGap), size = columns[1];
    if (columns.length !== 2 || !columns.every(value => Number.isFinite(value) && value > 0)
      || !Number.isFinite(gap) || gap < 0 || size === undefined || bounds.height < size
      || bounds.left < 0 || bounds.top < 0 || bounds.right > innerWidth || bounds.bottom > innerHeight) return false;
    const inset = style.direction === "rtl"
      ? Number.parseFloat(style.borderLeftWidth) + Number.parseFloat(style.paddingLeft)
      : Number.parseFloat(style.borderRightWidth) + Number.parseFloat(style.paddingRight);
    if (!Number.isFinite(inset)) return false;
    const left = style.direction === "rtl" ? bounds.left + inset : bounds.right - inset - size;
    const top = bounds.top + (bounds.height - size) / 2;
    const box = { left, right: left + size, top, bottom: top + size };
    const navBox = nav.getBoundingClientRect();
    if (navBox.width <= 0 || navBox.height <= 0
      || (style.direction === "rtl" ? box.right + gap > navBox.left : navBox.right + gap > box.left)) return false;
    // A reserved cell is not permission to reuse a transformed, hidden, or
    // clipped old-page coordinate. Unknown geometry keeps the floating path.
    for (let ancestor: HTMLElement | null = host; ancestor; ancestor = ancestor.parentElement) {
      const computed = getComputedStyle(ancestor);
      if (computed.display === "none" || computed.visibility !== "visible" || Number(computed.opacity) === 0
        || [computed.transform, computed.translate, computed.rotate, computed.scale, computed.perspective,
          computed.filter, computed.clipPath, computed.maskImage].some(value => value && value !== "none")
        || Boolean(computed.zoom && !["normal", "1", "100%"].includes(computed.zoom))) return false;
      const clipsX = /^(auto|scroll|hidden|clip)$/.test(computed.overflowX);
      const clipsY = /^(auto|scroll|hidden|clip)$/.test(computed.overflowY);
      if (!clipsX && !clipsY) continue;
      // Client rectangles do not prove clearance inside a rounded clip.
      if ([computed.borderTopLeftRadius, computed.borderTopRightRadius,
        computed.borderBottomLeftRadius, computed.borderBottomRightRadius].some(radius =>
        typeof radius !== "string" || !/^0(?:\.0+)?(?:px|%)?(?:\s+0(?:\.0+)?(?:px|%)?)?$/u.test(radius.trim()))) return false;
      const clip = ancestor.getBoundingClientRect();
      const x = clip.left + ancestor.clientLeft, y = clip.top + ancestor.clientTop;
      if (clipsX && (box.left < x || box.right > x + ancestor.clientWidth)
        || clipsY && (box.top < y || box.bottom > y + ancestor.clientHeight)) return false;
    }
    this.dataset.compactLauncher = "true";
    this.dataset.tightLauncher = "true";
    this.dataset.studioLauncher = "true";
    this.style.removeProperty("--forma-assistant-obstacle-offset");
    this.style.setProperty("--forma-assistant-studio-left", `${left}px`);
    this.style.setProperty("--forma-assistant-studio-top", `${top}px`);
    this.style.setProperty("--forma-assistant-studio-size", `${size}px`);
    return true;
  }

  #positionInBrowseSlot(launcher?: HTMLButtonElement) {
    // CSS excludes the short-landscape rail before any reservation is made.
    // A failed measurement restores the original five-link layout in this pass.
    if (!this.isConnected || getComputedStyle(this).getPropertyValue?.("--forma-assistant-browse-slot")?.trim() !== "1") return false;
    const owner = this.parentElement, shell = owner?.closest<HTMLElement>(".application-creative");
    if (!owner?.matches("forma-creative-assistant") || !shell
      || shell.getAttribute("data-layout-intent") !== "browse" || shell.getAttribute("data-nav-posture") !== "compact") return false;
    const panels = [...shell.querySelectorAll("forma-assistant-panel")]
      .filter(panel => panel.closest(".application-creative") === shell);
    const main = shell.querySelector<HTMLElement>("#main-content");
    if (panels.length !== 1 || panels[0] !== this || !main
      || main.closest(".application-creative") !== shell || main.getAttribute("aria-busy") === "true") return false;
    const hosts = [...shell.querySelectorAll<HTMLElement>(':scope > forma-ui-audience-navigation.application-task-navigation[data-primary-navigation="true"]')]
      .filter(host => host.isConnected && host.parentElement === shell && host.closest(".application-creative") === shell);
    if (hosts.length !== 1) return false;
    const host = hosts[0]!;
    if (host.closest("[hidden], [inert], [aria-hidden='true']")) return false;
    const navs = [...host.querySelectorAll<HTMLElement>(":scope > .ui-audience-navigation")], nav = navs[0];
    if (navs.length !== 1 || nav?.parentElement !== host) return false;
    const lists = [...nav.querySelectorAll<HTMLElement>(":scope > .ui-audience-navigation-list")], list = lists[0];
    if (lists.length !== 1 || list?.parentElement !== nav) return false;
    const links = [...list.querySelectorAll<HTMLAnchorElement>(":scope > li > a[href]")];
    if (links.length !== 5 || links.some(link => !link.isConnected || link.parentElement?.parentElement !== list)) return false;
    let accepted = false;
    const compact = this.dataset.compactLauncher, tight = this.dataset.tightLauncher;
    this.dataset.browseSlot = "true";
    try {
      const style = getComputedStyle(host), bounds = host.getBoundingClientRect(), navBox = nav.getBoundingClientRect();
      const finite = (box: Pick<DOMRect, "left" | "top" | "right" | "bottom" | "width" | "height">) =>
        [box.left, box.top, box.right, box.bottom, box.width, box.height].every(Number.isFinite);
      const columns = style.gridTemplateColumns?.trim().split(/\s+/u).map(value => Number.parseFloat(value)) ?? [];
      const gap = Number.parseFloat(style.columnGap), size = columns[1];
      if (style.display !== "grid" || columns.length !== 2 || !columns.every(value => Number.isFinite(value) && value > 0)
        || size === undefined || size < 44 || !Number.isFinite(gap) || gap < 0 || !finite(bounds) || !finite(navBox)
        || !Number.isFinite(innerWidth) || !Number.isFinite(innerHeight)
        || bounds.left < 0 || bounds.top < 0 || bounds.right > innerWidth || bounds.bottom > innerHeight
        || navBox.width <= 0 || navBox.height < size) return false;
      const inset = style.direction === "rtl"
        ? Number.parseFloat(style.borderLeftWidth) + Number.parseFloat(style.paddingLeft)
        : Number.parseFloat(style.borderRightWidth) + Number.parseFloat(style.paddingRight);
      if (!Number.isFinite(inset) || inset < 0) return false;
      const left = style.direction === "rtl" ? bounds.left + inset : bounds.right - inset - size;
      // The navigation row excludes its host's bottom safe-area padding.
      const top = navBox.top + (navBox.height - size) / 2;
      const box = { left, right: left + size, top, bottom: top + size };
      if (box.left < bounds.left || box.right > bounds.right || box.top < bounds.top || box.bottom > bounds.bottom
        || (style.direction === "rtl" ? box.right + gap > navBox.left : navBox.right + gap > box.left)) return false;
      if (links.some(link => {
        const rect = link.getBoundingClientRect(), computed = getComputedStyle(link);
        return !finite(rect) || rect.width < size || rect.height < size
          || rect.left < navBox.left || rect.right > navBox.right || rect.top < navBox.top || rect.bottom > navBox.bottom
          || link.scrollWidth > link.clientWidth || link.scrollHeight > link.clientHeight
          || computed.display === "none" || computed.visibility !== "visible" || Number(computed.opacity) === 0;
      })) return false;
      // Reuse the Studio cell's conservative native clipping boundary.
      for (let ancestor: HTMLElement | null = host; ancestor; ancestor = ancestor.parentElement) {
        const computed = getComputedStyle(ancestor);
        if (computed.display === "none" || computed.visibility !== "visible" || Number(computed.opacity) === 0
          || [computed.transform, computed.translate, computed.rotate, computed.scale, computed.perspective,
            computed.filter, computed.clipPath, computed.maskImage].some(value => value && value !== "none")
          || Boolean(computed.zoom && !["normal", "1", "100%"].includes(computed.zoom))) return false;
        const clipsX = /^(auto|scroll|hidden|clip)$/.test(computed.overflowX), clipsY = /^(auto|scroll|hidden|clip)$/.test(computed.overflowY);
        if (!clipsX && !clipsY) continue;
        if ([computed.borderTopLeftRadius, computed.borderTopRightRadius, computed.borderBottomLeftRadius,
          computed.borderBottomRightRadius].some(radius => typeof radius !== "string"
          || !/^0(?:\.0+)?(?:px|%)?(?:\s+0(?:\.0+)?(?:px|%)?)?$/u.test(radius.trim()))) return false;
        const clip = ancestor.getBoundingClientRect(), x = clip.left + ancestor.clientLeft, y = clip.top + ancestor.clientTop;
        if (clipsX && (box.left < x || box.right > x + ancestor.clientWidth)
          || clipsY && (box.top < y || box.bottom > y + ancestor.clientHeight)) return false;
      }
      if (launcher) {
        this.dataset.compactLauncher = "true";
        this.dataset.tightLauncher = "true";
        this.dataset.browseLauncher = "true";
        this.style.setProperty("--forma-assistant-browse-left", `${left}px`);
        this.style.setProperty("--forma-assistant-browse-top", `${top}px`);
        this.style.setProperty("--forma-assistant-browse-size", `${size}px`);
        const actual = launcher.getBoundingClientRect();
        if (!finite(actual) || actual.width !== size || actual.height !== size || actual.left < box.left || actual.right > box.right
          || actual.top < navBox.top || actual.bottom > navBox.bottom) return false;
        this.style.removeProperty("--forma-assistant-obstacle-offset");
      }
      accepted = true;
      return true;
    } finally {
      if (!accepted) {
        this.#clearBrowseLauncher();
        if (compact === undefined) delete this.dataset.compactLauncher; else this.dataset.compactLauncher = compact;
        if (tight === undefined) delete this.dataset.tightLauncher; else this.dataset.tightLauncher = tight;
      }
    }
  }

  #ordinaryCopyObstacles() {
    const obstacles: Array<{ element: HTMLElement; box: Pick<DOMRect, "left" | "top" | "right" | "bottom" | "width" | "height"> }> = [];
    const owner = this.parentElement;
    const shell = owner?.closest<HTMLElement>(".application-creative");
    if (!this.isConnected || !owner?.matches("forma-creative-assistant") || !shell) return obstacles;
    const panels = [...shell.querySelectorAll("forma-assistant-panel")]
      .filter(panel => panel.closest(".application-creative") === shell);
    const main = shell.querySelector<HTMLElement>("#main-content");
    if (panels.length !== 1 || panels[0] !== this || !main
      || main.closest(".application-creative") !== shell || main.getAttribute("aria-busy") === "true") return obstacles;
    // Only current, owned copy families participate. Text is not native focus
    // authority. Whitespace is protected only by explicit box-level contracts.
    const libraryOutputCopySelector = ".library-main > .library-body > .library-content > section > .library-output-grid > article.library-output > forma-output-card > article.output-card > .output-info > div:first-child";
    const libraryWeightFormSelector = ".library-main > forma-library-block-editor > .library-block-editor > .library-block-editor-layout > .library-block-workbench > form.library-block-form";
    const libraryWeightLabelSelector = ':scope > fieldset[aria-labelledby="library-block-content"] > label.library-weight';
    const libraryWeightCopySelector = `${libraryWeightFormSelector} > fieldset[aria-labelledby="library-block-content"] > label.library-weight > output`;
    const libraryWeightLabelCopySelector = `${libraryWeightFormSelector} > fieldset[aria-labelledby="library-block-content"] > label.library-weight`;
    const libraryStateEditorSelector = ".library-main > forma-library-block-editor";
    const libraryStateCopySelector = `${libraryStateEditorSelector} > section.library-block-editor > header.library-block-editor-header > div:first-child > p.context-library-state`;
    const librarySearchFormSelector = ".library-main > .library-body > form.library-toolbar";
    const librarySearchCopySelector = `${librarySearchFormSelector} > forma-ui-search.searchbox > div.ui-search > label`;
    const documentStatePanelSelector = ':scope > section.workspace-page[data-workbench="document"] > .studio-main > .studio-grid > section#document-context-panel.context-column';
    const documentStateHostsSelector = ':scope > .block-list[data-forma-content="primary"] > forma-context-block';
    const documentSummarySelector = "article.context-block.context-block--summary[data-block-id]";
    const documentStatusPath = " > div.block-body > header.block-heading > div.block-heading-state > span.context-lock-state";
    const documentStateCopySelector = `${documentStatePanelSelector} > .block-list[data-forma-content="primary"] > forma-context-block > section.context-decision[data-controls-open="false"] > div[id^="context-controls-document-"] ${documentSummarySelector}${documentStatusPath}`;
    const documentBodyPath = ' > div.block-body > p.block-copy[data-forma-content="primary"][dir="auto"]';
    const documentBodyCopySelector = `${documentStatePanelSelector} > .block-list[data-forma-content="primary"] > forma-context-block > section.context-decision[data-controls-open="false"] > div[id^="context-controls-document-"] ${documentSummarySelector}${documentBodyPath}`;
    type DocumentContextHost = HTMLElement & { surface?: string; block?: { id?: string } };
    const families = [
      ["forma-workspace-settings", [
        ".page-header-copy > :is(.eyebrow,h1,p)",
        'section[aria-labelledby="workspace-invitations-heading"] > :is(h2,p)',
        'section[aria-labelledby="workspace-organizations-heading"] > :is(h2,p)',
        'section[aria-labelledby="workspace-projects-heading"] > :is(h2,p)',
        'section[aria-labelledby="workspace-organizations-heading"] > form.workspace-settings-form > label:has(> input[name="name"])',
      ]],
      ["forma-library", [
        ".library-main > .page-header--library > .page-header-copy > :is(.eyebrow,h1,p)",
        ".library-body .section-heading > div > :is(.eyebrow,h2,p.section-note)",
        ".library-main > .library-body > section.lifecycle-next-actions > p.lifecycle-next-scope",
        '.library-main > .library-body > section.lifecycle-next-actions > p.muted[role="status"]',
        '.library-main > forma-library-block-editor > .library-block-editor > .library-block-editor-layout > .library-block-workbench > form.library-block-form > fieldset[aria-labelledby="library-block-content"] > h3#library-block-content',
        '.library-main > forma-library-block-editor > .library-block-editor > .library-block-editor-layout > .library-block-workbench > form.library-block-form > fieldset[aria-labelledby="library-block-content"] > forma-ui-rich-text.block-editor-copy > .ui-rich-text > :is(label.ui-rich-text-label,small:not(.ui-field-error))',
        '.library-main > .library-body > .library-content > section:has(> .section-heading > forma-ui-segmented-control.compact-segmented) > .family-empty[data-forma-empty-state] > :is(h3,p)',
        libraryOutputCopySelector,
        libraryWeightCopySelector,
        libraryWeightLabelCopySelector,
        libraryStateCopySelector,
        librarySearchCopySelector,
      ]],
      ["forma-reality-layers", [
        ':scope > .workspace-page.studio-alternative > .studio-main > .studio-subpage-body > .reality-editor[data-forma-content="primary"] > .layers-panel > form.layer-inspector[data-layer-inspector] > label:has(> input[name="weight"][type="range"])',
        ':scope > .workspace-page.studio-alternative > .studio-main > .studio-subpage-body > .reality-editor[data-forma-content="primary"] > .layers-panel > form.layer-inspector[data-layer-inspector] > label:has(> input[name="weight"][type="range"]) > output',
      ]],
      ["forma-project-contents", [".studio-main > .page-header--document > .page-header-copy > :is(.eyebrow,h1,p)"]],
      ["forma-workspace", [
        '#document-context-panel [data-output-recipe-draft] > forma-output-requirement-card .output-requirement-card > form.output-requirement-form > p.output-requirement-note:first-child',
        '#document-context-panel [data-output-recipe-draft] > forma-output-requirement-card .output-requirement-card > form.output-requirement-form > p.output-requirement-note:first-child + p:not([class])',
        '#document-context-panel [data-output-recipe-draft] > forma-output-requirement-card .output-requirement-card > form.output-requirement-form > label.output-requirement-field:has(> :is(input[name="packageLabel"],textarea[name="originalText"])) > :is(span,small:not(.output-requirement-error))',
        '#document-context-panel [data-output-recipe-draft] > forma-output-requirement-card .output-requirement-card > form.output-requirement-form > footer.output-requirement-form-footer > p',
        documentStateCopySelector,
        documentBodyCopySelector,
      ]],
      ['.application-loading[role="status"]', [":scope > div > :is(b,p)"]],
      ["forma-document-generations", [
        ":scope > section.document-generations > header > div:first-child > :is(.eyebrow,h2,p)",
      ]],
    ] as const;
    for (const [ownerSelector, selectors] of families) {
      const surfaces = [...main.querySelectorAll<HTMLElement>(ownerSelector)]
        .filter(surface => surface.isConnected && surface.closest("#main-content") === main
          && surface.closest(".application-creative") === shell
          && (ownerSelector !== '.application-loading[role="status"]' || surface.parentElement === main));
      if (surfaces.length !== 1) continue;
      const surface = surfaces[0]!;
      let libraryStates: HTMLElement[] = [];
      let librarySearchLabels: HTMLElement[] = [];
      let documentStates: HTMLElement[] = [];
      let documentBodies: HTMLElement[] = [];
      const elements = new Set(selectors.flatMap(selector => {
        const selected = [...surface.querySelectorAll<HTMLElement>(selector)];
        if (selector === libraryStateCopySelector) libraryStates = selected;
        if (selector === librarySearchCopySelector) librarySearchLabels = selected;
        if (selector === documentStateCopySelector) documentStates = selected;
        if (selector === documentBodyCopySelector) documentBodies = selected;
        return selected;
      }));
      for (const element of elements) {
        if (!element.isConnected || element.closest(ownerSelector) !== surface
          || element.closest("[hidden], [inert], [aria-hidden='true']")) continue;
        const documentBody = documentBodies.includes(element);
        const documentState = documentStates.includes(element) || documentBody;
        if (documentState) {
          const panels = [...surface.querySelectorAll<HTMLElement>(documentStatePanelSelector)];
          const panel = panels[0];
          if (panels.length !== 1 || !panel?.isConnected || element.closest("#document-context-panel") !== panel) continue;
          const hosts = [...panel.querySelectorAll<DocumentContextHost>(documentStateHostsSelector)];
          const host = element.closest<DocumentContextHost>("forma-context-block"), blockId = host?.block?.id;
          if (!host?.isConnected || host.surface !== "document" || typeof blockId !== "string" || !blockId.trim()
            || !hosts.includes(host) || hosts.filter(candidate => candidate.block?.id === blockId).length !== 1) continue;
          const decisions = [...host.querySelectorAll<HTMLElement>(":scope > section.context-decision")];
          const decision = decisions[0];
          if (decisions.length !== 1 || !decision?.isConnected || decision.dataset.controlsOpen !== "false") continue;
          const wrappers = [...decision.querySelectorAll<HTMLElement>(':scope > div[id^="context-controls-"]')];
          const wrapper = wrappers[0];
          if (wrappers.length !== 1 || !wrapper?.isConnected || wrapper.id !== `context-controls-document-${blockId}`) continue;
          const roots = [...wrapper.querySelectorAll<HTMLElement>(`:scope > ${documentSummarySelector}`)];
          const root = roots[0], card = element.closest<HTMLElement>(documentSummarySelector);
          if (roots.length !== 1 || !root?.isConnected || root.dataset.blockId !== blockId || !card?.isConnected) continue;
          // Peers and recursive authored summaries each own their own copy.
          // Only the renderer's exact child chain can reach this bound root.
          let ancestor: HTMLElement | null = card;
          while (ancestor && ancestor !== root) {
            const item: HTMLElement | null = ancestor.parentElement, children: HTMLElement | null | undefined = item?.parentElement;
            const body: HTMLElement | null | undefined = children?.parentElement, parent: HTMLElement | null | undefined = body?.parentElement;
            if (!item?.matches?.("li") || !children?.matches?.("ol.context-authored-children")
              || !body?.matches?.("div.block-body") || !parent?.matches?.(documentSummarySelector)) {
              ancestor = null; break;
            }
            ancestor = parent;
          }
          if (ancestor !== root) continue;
          const copies = [...card.querySelectorAll<HTMLElement>(`:scope${documentBody ? documentBodyPath : documentStatusPath}`)];
          if (copies.length !== 1 || copies[0] !== element) continue;
        }
        const libraryState = libraryStates.includes(element);
        if (libraryState) {
          const editors = [...surface.querySelectorAll<HTMLElement>(libraryStateEditorSelector)];
          if (libraryStates.length !== 1 || editors.length !== 1 || !editors[0]?.isConnected
            || element.closest("forma-library-block-editor") !== editors[0]) continue;
        }
        const librarySearchLabel = librarySearchLabels.includes(element);
        if (librarySearchLabel) {
          const forms = [...surface.querySelectorAll<HTMLFormElement>(librarySearchFormSelector)];
          const form = forms[0], box = element.parentElement, search = box?.parentElement;
          if (librarySearchLabels.length !== 1 || !(element instanceof HTMLLabelElement)
            || forms.length !== 1 || !(form instanceof HTMLFormElement) || !form.isConnected
            || !box?.isConnected || !search?.isConnected || search.parentElement !== form) continue;
          const searches = [...form.querySelectorAll<HTMLElement>(":scope > forma-ui-search.searchbox")];
          const boxes = [...search.querySelectorAll<HTMLElement>(":scope > div.ui-search")];
          const labels = [...box.querySelectorAll<HTMLLabelElement>(":scope > label")];
          const fields = [...box.querySelectorAll<HTMLInputElement>(':scope > div.ui-search-control > input[type="search"]')];
          const field = fields[0];
          if (searches.length !== 1 || searches[0] !== search || boxes.length !== 1 || boxes[0] !== box
            || labels.length !== 1 || labels[0] !== element || fields.length !== 1
            || !(field instanceof HTMLInputElement) || !field.isConnected || field.type !== "search"
            || !field.id || element.control !== field || element.htmlFor !== field.id
            || element.form !== form || field.form !== form
            || field.labels?.length !== 1 || field.labels[0] !== element) continue;
          const ids = [...document.querySelectorAll(`[id="${CSS.escape(field.id)}"]`)];
          if (ids.length !== 1 || ids[0] !== field) continue;
        }
        const libraryWeightLabel = ownerSelector === "forma-library" && element.tagName === "LABEL"
          && element.matches(libraryWeightLabelCopySelector);
        if (ownerSelector === "forma-workspace-settings" && element.tagName === "LABEL") {
          const field = element.querySelector<HTMLInputElement>(':scope > input[name="name"]');
          if (!(element instanceof HTMLLabelElement) || !field || element.control !== field
            || field.form !== element.parentElement) continue;
        }
        if (ownerSelector === "forma-library" && (element.tagName === "OUTPUT" || libraryWeightLabel)) {
          const forms = [...surface.querySelectorAll<HTMLFormElement>(libraryWeightFormSelector)];
          const form = forms[0], label = libraryWeightLabel ? element : element.parentElement;
          if (forms.length !== 1 || !(form instanceof HTMLFormElement)
            || !(label instanceof HTMLLabelElement) || !label.isConnected) continue;
          const labels = [...form.querySelectorAll<HTMLLabelElement>(libraryWeightLabelSelector)];
          const outputs = [...label.querySelectorAll<HTMLOutputElement>(":scope > output")];
          const fields = [...label.querySelectorAll<HTMLInputElement>(':scope > input[type="range"]')];
          const field = fields[0], output = outputs[0];
          // The visible label names the current range; OUTPUT refers to that
          // same range while retaining its separately measured copy box.
          if (labels.length !== 1 || labels[0] !== label || outputs.length !== 1
            || !(output instanceof HTMLOutputElement) || !output.isConnected || output.form !== form
            || !libraryWeightLabel && output !== element
            || fields.length !== 1 || !(field instanceof HTMLInputElement) || !field.isConnected
            || field.form !== form || field.previousElementSibling !== output
            || !field.id || label.htmlFor !== field.id || label.control !== field
            || field.labels?.length !== 1 || field.labels[0] !== label
            || output.htmlFor.length !== 1 || output.htmlFor[0] !== field.id
            || field.min !== "0" || field.max !== "1" || field.step !== ".05") continue;
          const value = Number(field.value);
          if (!field.value.trim() || !Number.isFinite(value) || value < 0 || value > 1
            || output.value !== `${Math.round(value * 100)}%`
            || output.textContent?.trim() !== output.value) continue;
        }
        if (ownerSelector === "forma-library" && ["LABEL", "SMALL"].includes(element.tagName) && !libraryWeightLabel && !librarySearchLabel) {
          const rich = element.parentElement;
          const field = rich?.querySelector<HTMLTextAreaElement>(":scope > textarea.ui-rich-text-input");
          const label = rich?.querySelector<HTMLLabelElement>(":scope > label.ui-rich-text-label");
          const form = element.closest("form.library-block-form");
          if (!field?.id || !(label instanceof HTMLLabelElement) || label.control !== field
            || label.htmlFor !== field.id || !form || field.form !== form
            || element.tagName === "LABEL" && element !== label) continue;
          if (element.tagName === "SMALL" && (element.id !== `${field.id}-help`
            || !field.getAttribute("aria-describedby")?.split(/\s+/u).includes(element.id))) continue;
        }
        if (ownerSelector === "forma-reality-layers") {
          const forms = [...surface.querySelectorAll<HTMLFormElement>(':scope > .workspace-page.studio-alternative > .studio-main > .studio-subpage-body > .reality-editor[data-forma-content="primary"] > .layers-panel > form.layer-inspector[data-layer-inspector]')];
          const form = forms[0];
          const label = element.tagName === "LABEL" ? element : element.parentElement;
          if (forms.length !== 1 || !(form instanceof HTMLFormElement)
            || !form.getAttribute("data-layer-inspector") || !(label instanceof HTMLLabelElement)
            || label.parentElement !== form) continue;
          const fields = [...label.querySelectorAll<HTMLInputElement>(':scope > input[name="weight"][type="range"]')];
          const outputs = [...label.querySelectorAll<HTMLOutputElement>(":scope > output")];
          const field = fields[0], output = outputs[0];
          if (fields.length !== 1 || outputs.length !== 1 || !(field instanceof HTMLInputElement)
            || !(output instanceof HTMLOutputElement) || !field.id || label.htmlFor !== field.id
            || label.control !== field || field.labels?.length !== 1 || field.labels[0] !== label
            || field.form !== form || output.form !== form || field.previousElementSibling !== output
            || element !== label && element !== output) continue;
        }
        if (ownerSelector === "forma-workspace" && !documentState && ["SPAN", "SMALL"].includes(element.tagName)) {
          const label = element.parentElement;
          const field = label?.querySelector<HTMLInputElement | HTMLTextAreaElement>(':scope > input[name="packageLabel"], :scope > textarea[name="originalText"]');
          if (!(label instanceof HTMLLabelElement) || !field?.id || label.control !== field
            || label.htmlFor !== field.id) continue;
          if (element.tagName === "SMALL" && (element.id !== `${field.id}-help`
            || !field.getAttribute("aria-describedby")?.split(/\s+/u).includes(element.id))) continue;
        }
        // The Document editor, associated Library field/empty-state regions and
        // current Library weight output, native Layers weight label/output and full Image-history header copy
        // carry box-level copy contracts, including their intentional whitespace.
        // Other admitted copy keeps text fragments.
        const wholeRegion = ownerSelector === "forma-workspace" && !documentState
          || ownerSelector === "forma-library" && (["LABEL", "SMALL"].includes(element.tagName) && !libraryWeightLabel && !librarySearchLabel
            || element.tagName === "OUTPUT"
            || element.tagName === "P" && element.parentElement?.matches(".family-empty[data-forma-empty-state]")
            || element.tagName === "DIV" && element.matches(libraryOutputCopySelector))
          || ownerSelector === "forma-reality-layers" && ["LABEL", "OUTPUT"].includes(element.tagName)
          || ownerSelector === "forma-document-generations";
        // Search/weight labels, editor metadata and closed-card authored copy have direct
        // fragment contracts. Never include icon descendants or the whole row.
        const directText = libraryWeightLabel || librarySearchLabel || libraryState || documentState ? [...element.childNodes].filter(node => node.nodeType === 3) : null;
        const walker = wholeRegion || directText ? null : document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let directIndex = 0;
        for (let text: Node | null = wholeRegion ? element : directText?.[directIndex++] ?? walker?.nextNode() ?? null;
          text; text = directText ? directText[directIndex++] ?? null : walker?.nextNode() ?? null) {
          const parent = wholeRegion ? element : text.parentElement;
          if (!text.textContent?.trim() || !parent
            || parent.closest("[hidden], [inert], [aria-hidden='true'], script, style, svg, .forma-icon")
            || ["hidden", "collapse"].includes(getComputedStyle(parent).visibility)) continue;
          let fragments: DOMRect[];
          if (wholeRegion) fragments = [element.getBoundingClientRect()];
          else {
            const range = document.createRange();
            range.selectNodeContents(text);
            fragments = [...range.getClientRects()];
            range.detach();
          }
          for (const fragment of fragments) {
            let { left, top, right, bottom } = fragment;
            let displayed = true, bounded = true;
            const topLayer = parent.closest(":modal, :popover-open");
            for (let ancestor: HTMLElement | null = parent; ancestor;
              ancestor = ancestor === topLayer ? null : ancestor.parentElement) {
              const style = getComputedStyle(ancestor);
              if (style.display === "none" || Number(style.opacity) === 0) displayed = false;
              // Native client sizes are untransformed. Keep the original measured
              // rectangle for an unknown chain, never a larger ancestor box.
              if ([style.transform, style.translate, style.rotate, style.scale, style.perspective, style.filter,
                style.clipPath, style.maskImage].some(value => value && value !== "none")
                || Boolean(style.zoom && !["normal", "1", "100%"].includes(style.zoom))) bounded = false;
              const clipsX = /^(auto|scroll|hidden|clip)$/.test(style.overflowX);
              const clipsY = /^(auto|scroll|hidden|clip)$/.test(style.overflowY);
              if (!clipsX && !clipsY) continue;
              const bounds = ancestor.getBoundingClientRect();
              if (clipsX) {
                const start = bounds.left + ancestor.clientLeft;
                left = Math.max(left, start); right = Math.min(right, start + ancestor.clientWidth);
              }
              if (clipsY) {
                const start = bounds.top + ancestor.clientTop;
                top = Math.max(top, start); bottom = Math.min(bottom, start + ancestor.clientHeight);
              }
            }
            if (!bounded) ({ left, top, right, bottom } = fragment);
            // Pointer-events does not determine whether ordinary text paints.
            if (displayed && right > left && bottom > top && bottom > 0 && top < innerHeight
              && right > 0 && left < innerWidth) {
              obstacles.push({ element, box: { left, top, right, bottom, width: right - left, height: bottom - top } });
            }
          }
        }
      }
    }
    return obstacles;
  }

  #positionLauncher() {
    if (this.open) {
      if (this.dataset.browseSlot === "true") {
        this.#clearBrowseLauncher();
        this.#positionInBrowseSlot();
      }
      return;
    }
    const launcher = this.querySelector<HTMLButtonElement>(".forma-assistant-launcher");
    this.#clearStudioLauncher();
    this.#clearBrowseLauncher();
    // Following the same reserved cell is layout reflow, even under its own
    // focus/hover. No collision search or lane change runs in that cell.
    if (launcher && !this.open && this.#positionInStudioSlot()) return;
    if (launcher && this.#positionInBrowseSlot(launcher)) return;
    const focused = document.activeElement;
    if (!launcher || this.open || launcher.contains(focused)) return;
    const hovered = launcher.matches(":hover");

    let exactFocusPaint = !focused?.shadowRoot?.activeElement;
    const unboundedFocusPaint = (style: CSSStyleDeclaration) =>
      [style.transform, style.translate, style.rotate, style.scale, style.perspective, style.filter]
        .some((value) => value && value !== "none")
      || Boolean(style.zoom && !["normal", "1", "100%"].includes(style.zoom));
    const controls = [...document.querySelectorAll<HTMLElement>("a[href], button, input, textarea, select, summary, [role='button'], [contenteditable='true'], .output-requirement-warning, .output-recipe-entry, forma-ui-notice, .app-shell > .error-banner[role='alert']")]
      .filter((control) => !this.contains(control)
        && !control.closest("[hidden], [inert], [aria-hidden='true']"))
      .map((control) => {
        const file = control.tagName === "INPUT" && (control as HTMLInputElement).type === "file"
          && control instanceof HTMLInputElement ? control : null;
        const label = file?.parentElement;
        // The native input owns focus; its unique direct file label owns visible paint.
        const paint = file?.isConnected && label instanceof HTMLLabelElement && label.isConnected
          && label.matches("label.button.file-button") && Number(getComputedStyle(file).opacity) === 0
          && file.labels?.length === 1 && file.labels[0] === label && label.control === file
          && label.querySelectorAll("input,button,select,textarea,output,meter,progress").length === 1
          ? label : control;
        const box = paint.getBoundingClientRect();
        let { left, top, right, bottom } = box;
        const ownStyle = getComputedStyle(paint);
        const outline = control === focused && !["none", "hidden"].includes(ownStyle.outlineStyle)
          ? Math.max(0, (Number.parseFloat(ownStyle.outlineWidth) || 0) + (Number.parseFloat(ownStyle.outlineOffset) || 0)) : 0;
        if (control === focused && (ownStyle.outlineStyle === "auto"
          || ownStyle.boxShadow && ownStyle.boxShadow !== "none"
          || unboundedFocusPaint(ownStyle))) exactFocusPaint = false;
        left -= outline; top -= outline; right += outline; bottom += outline;
        const topLayer = paint.closest(":modal, :popover-open");
        for (let ancestor = paint === topLayer ? null : paint.parentElement; ancestor;
          ancestor = ancestor === topLayer ? null : ancestor.parentElement) {
          const style = getComputedStyle(ancestor);
          if (control === focused && unboundedFocusPaint(style)) exactFocusPaint = false;
          // Native client sizes are untransformed; retain prior bounds for transformed chains.
          if ([style.transform, style.translate, style.rotate, style.scale, style.perspective]
            .some((value) => value && value !== "none")) {
            if (control === focused) exactFocusPaint = false;
            return { element: control, paint, box };
          }
          const clipsX = /^(auto|scroll|hidden|clip)$/.test(style.overflowX);
          const clipsY = /^(auto|scroll|hidden|clip)$/.test(style.overflowY);
          if (!clipsX && !clipsY) continue;
          const bounds = ancestor.getBoundingClientRect();
          if (clipsX) {
            const start = bounds.left + ancestor.clientLeft;
            left = Math.max(left, start); right = Math.min(right, start + ancestor.clientWidth);
          }
          if (clipsY) {
            const start = bounds.top + ancestor.clientTop;
            top = Math.max(top, start); bottom = Math.min(bottom, start + ancestor.clientHeight);
          }
        }
        return { element: control, paint, box: { left, top, right, bottom, width: right - left, height: bottom - top } };
      })
      .filter(({ paint, box }) => box.width > 0 && box.height > 0 && box.bottom > 0
        && box.top < innerHeight && box.right > 0 && box.left < innerWidth
        && getComputedStyle(paint).visibility !== "hidden"
        && getComputedStyle(paint).pointerEvents !== "none");
    if (focused && focused !== document.body && focused !== document.documentElement
      && !controls.some(({ element }) => element === focused)) exactFocusPaint = false;
    const intersections = (box: Pick<DOMRect, "left" | "top" | "right" | "bottom">) => controls.filter(({ box: control }) =>
      box.left < control.right && box.right > control.left && box.top < control.bottom && box.bottom > control.top);

    // Hover stays stationary unless the launcher obstructs exactly measured
    // current page focus. This includes a compact fallback retained after a
    // popover closes; a settled position does not keep moving.
    if (hovered && (!exactFocusPaint || !intersections(launcher.getBoundingClientRect())
      .some(({ element }) => element === focused))) return;
    // Placement uses both lists; only native controls above authorize a
    // hovered move or establish exact current-focus paint.
    const placementObstacles = [...controls, ...this.#ordinaryCopyObstacles()];
    const placementIntersections = (box: Pick<DOMRect, "left" | "top" | "right" | "bottom">) =>
      placementObstacles.filter(({ box: obstacle }) => box.left < obstacle.right && box.right > obstacle.left
        && box.top < obstacle.bottom && box.bottom > obstacle.top);
    delete this.dataset.compactLauncher;
    delete this.dataset.tightLauncher;
    this.style.setProperty("--forma-assistant-obstacle-offset", "0px");

    let offset = 0;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      this.style.setProperty("--forma-assistant-obstacle-offset", `${offset}px`);
      const box = launcher.getBoundingClientRect();
      const obstacles = placementIntersections(box);
      if (!obstacles.length) return;
      const next = offset + box.bottom - Math.min(...obstacles.map(({ box: obstacle }) => obstacle.top)) + 8;
      if (box.top - (next - offset) < 8) break;
      offset = next;
    }

    this.style.setProperty("--forma-assistant-obstacle-offset", "0px");
    this.dataset.compactLauncher = "true";
    if (!placementIntersections(launcher.getBoundingClientRect()).length) return;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const box = launcher.getBoundingClientRect();
      const obstacles = placementIntersections(box);
      if (!obstacles.length) return;
      const offset = Number.parseFloat(this.style.getPropertyValue("--forma-assistant-obstacle-offset") || "0");
      const next = box.bottom - Math.min(...obstacles.map(({ box: obstacle }) => obstacle.top)) + 8 + offset;
      const preferred = { left: box.left, right: box.right, top: box.top - (next - offset), bottom: box.bottom - (next - offset) };
      if (exactFocusPaint && (preferred.top < 8 || placementIntersections(preferred).length)) {
        // Reuse the compact lane and finite pass. Never trade a control, task
        // region, or current focus outline for the preferred eight-pixel gap.
        const ceiling = Math.min(...obstacles.map(({ box: obstacle }) => obstacle.top));
        const floor = Math.max(8, ...placementObstacles.filter(({ box: obstacle }) =>
          box.left < obstacle.right && box.right > obstacle.left && obstacle.bottom <= ceiling)
          .map(({ box: obstacle }) => obstacle.bottom));
        const top = floor + (ceiling - floor - box.height) / 2;
        const candidate = { left: box.left, right: box.right, top, bottom: top + box.height };
        if (ceiling - floor >= box.height && candidate.top >= 8
          && candidate.bottom <= innerHeight - 8 && !placementIntersections(candidate).length) {
          // The existing named 44px launcher keeps its focus ring inside this
          // tight footprint, including when its own focus freezes positioning.
          this.dataset.tightLauncher = "true";
          this.style.setProperty("--forma-assistant-obstacle-offset", `${offset + box.top - top}px`);
          return;
        }
      }
      if (box.top - (next - offset) < 8) break;
      this.style.setProperty("--forma-assistant-obstacle-offset", `${next}px`);
    }

    // An upward boundary or the pass budget can leave a lower gap unexplored.
    // Complete the search from the same sampled owners, in the same lane.
    if (!exactFocusPaint) return;
    const box = launcher.getBoundingClientRect();
    const finiteBox = (value: Pick<DOMRect, "left" | "top" | "right" | "bottom" | "width" | "height">) =>
      [value.left, value.top, value.right, value.bottom, value.width, value.height].every(Number.isFinite);
    if (!finiteBox(box) || !Number.isFinite(innerHeight) || box.width <= 0 || box.height <= 0
      || placementObstacles.some(({ box: obstacle }) => !finiteBox(obstacle))) return;
    if (!placementIntersections(box).length) return;
    const intervals = placementObstacles.filter(({ box: obstacle }) =>
      box.left < obstacle.right && box.right > obstacle.left)
      .map(({ box: obstacle }) => ({ top: Math.max(8, obstacle.top), bottom: Math.min(innerHeight - 8, obstacle.bottom) }))
      .filter(interval => interval.bottom > interval.top)
      .sort((a, b) => a.top - b.top || a.bottom - b.bottom);
    const merged: Array<{ top: number; bottom: number }> = [];
    for (const interval of intervals) {
      const previous = merged[merged.length - 1];
      if (previous && interval.top <= previous.bottom) previous.bottom = Math.max(previous.bottom, interval.bottom);
      else merged.push({ ...interval });
    }
    const candidates: Array<{ top: number; floor: number; ceiling: number }> = [];
    let floor = 8;
    for (const interval of [...merged, { top: innerHeight - 8, bottom: innerHeight - 8 }]) {
      const ceiling = interval.top;
      if (ceiling - floor >= box.height) {
        const top = floor + (ceiling - floor - box.height) / 2;
        const candidate = { left: box.left, right: box.right, top, bottom: top + box.height };
        if (candidate.top >= 8 && candidate.bottom <= innerHeight - 8
          && !placementIntersections(candidate).length) candidates.push({ top, floor, ceiling });
      }
      floor = Math.max(floor, interval.bottom);
    }
    // Nearest centered gap wins; equal displacements retain upward preference.
    candidates.sort((a, b) => Math.abs(a.top - box.top) - Math.abs(b.top - box.top) || a.top - b.top);
    const candidate = candidates[0];
    if (!candidate) return;
    const previousOffset = this.style.getPropertyValue("--forma-assistant-obstacle-offset");
    const previousTight = this.dataset.tightLauncher;
    const currentOffset = Number.parseFloat(previousOffset || "0");
    if (!Number.isFinite(currentOffset)) return;
    this.dataset.tightLauncher = "true";
    this.style.setProperty("--forma-assistant-obstacle-offset", `${currentOffset + box.top - candidate.top}px`);
    // Native layout may quantize the center. Accept only the observed body in
    // this same clear gap, with unchanged inline bounds and compact footprint.
    const actual = launcher.getBoundingClientRect();
    if (!finiteBox(actual) || !Number.isFinite(innerHeight)
      || actual.left !== box.left || actual.right !== box.right || actual.width !== box.width || actual.height !== box.height
      || actual.top < candidate.floor || actual.bottom > candidate.ceiling
      || actual.top < 8 || actual.bottom > innerHeight - 8 || placementIntersections(actual).length) {
      this.style.setProperty("--forma-assistant-obstacle-offset", previousOffset);
      if (previousTight === undefined) delete this.dataset.tightLauncher;
      else this.dataset.tightLauncher = previousTight;
    }
  }

  #toggle(open: boolean) {
    this.dispatchEvent(new CustomEvent("forma-assistant-toggle", { detail: { open }, bubbles: true, composed: true }));
  }

  /** Read existing owners; navigation must not acknowledge or discard their work. */
  get navigationBlocked() {
    return Boolean(this.#draft || [...this.#drafts].some(([mode, value]) => mode !== this.#activeMode && Boolean(value))
      || this.#toolSubmitting || this.#guidanceSubmitting || this.guidanceDelivery || this.specialist);
  }

  /** Closing a settled recovery is not cancellation; raw drafts and active work still own departure. */
  get commandDepartureBlocked() {
    return Boolean(this.#draft || [...this.#drafts].some(([mode,value])=>mode!==this.#activeMode&&Boolean(value))
      || this.#toolSubmitting || this.#guidanceSubmitting || this.guidanceDelivery === "sending"
      || this.specialist && (this.specialist.working || this.specialist.stopping || this.specialist.id !== this.#dismissedSpecialistId));
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

  async resolveToolRequest(accepted: boolean, message: string, controls: { current?: () => boolean; focus?: OutputNavigationFocusLease } = {}) {
    this.#toolSubmitting = false;
    this.#draft = accepted ? "" : message.slice(0, this.#maximumLength());
    this.requestUpdate();
    if (!accepted) {
      const draft=this.#draft;
      // Immediate refusals also yield to a newer gesture before the native frame.
      // A supplied lease stays owned by the caller; only our local fallback ends here.
      const focus=controls.focus??captureOutputNavigationFocus(this.ownerDocument);
      try{
      // The containing host must first clear its busy mode and re-enable the
      // field. Focusing in the previous microtask silently targeted a disabled input.
      await this.updateComplete;
      await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
      if(this.isConnected&&this.open&&this.#draft===draft&&!this.#toolSubmitting
        &&controls.current?.()!==false&&!document.querySelector("dialog:modal")){
        const field=this.querySelector<HTMLTextAreaElement>(".forma-assistant-input");
        if(field){
          const restore=()=>{field.focus({preventScroll:true});return true;};
          focus.run(field,restore);
        }
      }
      }finally{if(!controls.focus)focus.dispose();}
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
      <div class="forma-assistant-transcript">
        ${this.continuation !== nothing ? html`<div class="forma-assistant-continuation">
          ${this.navigationBlocked ? html`<p class="forma-assistant-mode-detail">${this.i18n.t("next.lifecycle.assistantOwnsWork", "Clear unsent drafts or review the current request before continuing; wait if it is still running. Closing the Assistant keeps drafts and does not cancel submitted requests.")}</p>` : nothing}
          <fieldset ?disabled=${this.navigationBlocked} aria-label=${this.i18n.t("next.exact.heading", "Next for this document")}>${this.continuation}</fieldset>
        </div>` : nothing}
        <div class="forma-assistant-conversation" role="log" aria-live="polite" aria-relevant="additions">
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

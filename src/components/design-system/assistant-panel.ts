import { parseMemoryProfileSynthesis,type MemoryProfileSynthesis } from '../../model/memory-profile-synthesis.ts';
import { memoryCreationApprovalHash,parseMemoryCreationReview,type MemoryCreationReview } from '../../model/memory-creation-review.ts';
import type { MemoryFieldRequest } from '../../model/memory-field-request.ts';
import { memoryEditApprovalHash,parseMemoryEditReview,type MemoryEditReview } from '../../model/memory-edit-review.ts';
import { parseSemanticMemoryAnswerPresentation,type SemanticMemoryAnswerPresentation } from '../../model/memory-answer.ts';
import { html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { ASSISTANT_CONTEXT_LIMITS,type AssistantContext } from "../../model/conversation-context.ts";
import type { AssistantInteractionMode } from "../../model/assistant-route-policy.ts";
import { libraryBlockEditorFromRoute } from "../../model/routes.ts";
import type { FormaStore } from "../../state/store.ts";
import type { LibraryBlockEditor } from "../library-block-editor.ts";
import type { ContextBlock } from "../context-block.ts";
import { icon } from "../icons.ts";
import { FormaPresentationalElement } from "../presentational-element.ts";
import type { AvailableConsequentialPreview } from "../../../worker/consequential-consent";
import { contextConsentAction } from "../../model/context-consent-state.ts";
import { consequentialPreview } from "../consequential-preview.ts";
import { ensureNativeModalDialog } from "./native-dialog.ts";
import { captureOutputNavigationFocus, type OutputNavigationFocusLease } from "../output-navigation-focus.ts";
import "./conversation-composer.ts";
import "./assistant-panel.css";

/** Permission for the existing final gap search, never native-control focus authority. */
export function captureLibraryInspectionArrivalGap(main: HTMLElement, current: () => boolean) {
  const document = main.ownerDocument, view = document.defaultView;
  if (!view) return null;
  const read = () => {
    if (!current() || !main.isConnected || main.ownerDocument !== document
      || document.activeElement !== main || !main.matches('main#main-content[tabindex="-1"]')
      || !main.matches(":focus-visible") || main.shadowRoot?.activeElement
      || main.closest("[hidden], [inert], [aria-hidden='true']") || main.getAttribute("aria-busy") === "true"
      || main.getClientRects().length !== 1) return null;
    const width = view.innerWidth, height = view.innerHeight, box = main.getBoundingClientRect();
    const style = view.getComputedStyle(main), stroke = Number.parseFloat(style.outlineWidth), offset = Number.parseFloat(style.outlineOffset);
    if (![width, height, box.left, box.top, box.right, box.bottom, box.width, box.height, stroke, offset].every(Number.isFinite)
      || width <= 0 || height <= 0 || box.width <= 0 || box.height <= 0
      || style.outlineStyle !== "solid" || stroke <= 0 || offset < 0) return null;
    const outer = stroke + offset;
    const bands = [
      { left: box.left - outer, top: box.top - outer, right: box.right + outer, bottom: box.top - offset },
      { left: box.left - outer, top: box.bottom + offset, right: box.right + outer, bottom: box.bottom + outer },
      { left: box.left - outer, top: box.top - offset, right: box.left - offset, bottom: box.bottom + offset },
      { left: box.right + offset, top: box.top - offset, right: box.right + outer, bottom: box.bottom + offset },
    ];
    const viewportPaint = () => bands.some(band => Math.max(0, band.left) < Math.min(width, band.right)
      && Math.max(0, band.top) < Math.min(height, band.bottom));
    // This permission covers only an already offscreen painted perimeter;
    // clipping must not manufacture eligibility for an otherwise visible ring.
    if (viewportPaint()) return null;
    const ancestors: HTMLElement[] = [], geometry: unknown[] = [width, height, stroke, offset, style.outlineColor];
    const zeroRadius = (value: string) => /^0(?:\.0+)?(?:px|%)?(?:\s+0(?:\.0+)?(?:px|%)?)?$/u.test(value.trim());
    for (let node: HTMLElement | null = main; node; node = node.parentElement) {
      ancestors.push(node);
      const computed = view.getComputedStyle(node), bounds = node.getBoundingClientRect();
      const effects = [computed.transform, computed.translate, computed.rotate, computed.scale, computed.perspective,
        computed.filter, computed.backdropFilter, computed.clipPath, computed.maskImage, computed.boxShadow, computed.textShadow];
      if (!node.isConnected || node.getClientRects().length !== 1
        || computed.display === "none" || computed.visibility !== "visible" || computed.opacity !== "1"
        || !["static", "relative"].includes(computed.position)
        || effects.some(value => typeof value !== "string" || value !== "none")
        || !["normal", "1", "100%"].includes(computed.zoom) || computed.clip !== "auto"
        || ![computed.borderTopLeftRadius, computed.borderTopRightRadius, computed.borderBottomLeftRadius, computed.borderBottomRightRadius].every(zeroRadius)
        || computed.animationName !== "none" || computed.transitionDuration.split(",").some(value => Number.parseFloat(value) !== 0)
        || ["::before", "::after"].some(pseudo => !["none", "normal"].includes(view.getComputedStyle(node, pseudo).content))) return null;
      const overflow = [computed.overflowX, computed.overflowY];
      if (overflow.some(value => !["visible", "auto", "scroll", "hidden", "clip"].includes(value))
        || overflow.includes("clip") && computed.overflowClipMargin !== "0px"
        || ![bounds.left, bounds.top, bounds.right, bounds.bottom, bounds.width, bounds.height,
          node.clientLeft, node.clientTop, node.clientWidth, node.clientHeight].every(Number.isFinite)) return null;
      geometry.push([bounds.left, bounds.top, bounds.right, bounds.bottom, bounds.width, bounds.height,
        node.clientLeft, node.clientTop, node.clientWidth, node.clientHeight, computed.position, ...overflow]);
      // Own overflow clips descendants, not main's outline. Supported ancestor
      // overflow contributes only its ordinary rectangular client clip.
      if (node !== main) for (const band of bands) {
        if (computed.overflowX !== "visible") {
          band.left = Math.max(band.left, bounds.left + node.clientLeft);
          band.right = Math.min(band.right, bounds.left + node.clientLeft + node.clientWidth);
        }
        if (computed.overflowY !== "visible") {
          band.top = Math.max(band.top, bounds.top + node.clientTop);
          band.bottom = Math.min(band.bottom, bounds.top + node.clientTop + node.clientHeight);
        }
      }
    }
    if (viewportPaint()) return null;
    return { ancestors, signature: JSON.stringify(geometry), width, height };
  };
  const captured = read();
  if (!captured) return null;
  return { clear: (candidate: Pick<DOMRect, "left" | "top" | "right" | "bottom" | "width" | "height">) => {
    const next = read();
    return Boolean(next && next.signature === captured.signature && next.ancestors.length === captured.ancestors.length
      && next.ancestors.every((node, index) => node === captured.ancestors[index])
      && [candidate.left, candidate.top, candidate.right, candidate.bottom, candidate.width, candidate.height].every(Number.isFinite)
      && candidate.width > 0 && candidate.height > 0 && candidate.right - candidate.left === candidate.width
      && candidate.bottom - candidate.top === candidate.height && candidate.left >= 0 && candidate.top >= 0
      && candidate.right <= next.width && candidate.bottom <= next.height);
  } };
}

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
  fieldTarget?:MemoryFieldRequest;
  schema: 1; turnId: string; route: string; projectId: string; documentId: string | null;
  canvasId: string | null; selectedItemIds: string[]; locale: string;
};
type SpecialistReply = { key?: string; values?: Record<string, string | number>; text?: string };
export type AssistantSpecialistOriginalRequest = {
  fieldTarget?:MemoryFieldRequest;
  turnId: string; route: string; projectId: string; documentId: string; canvasId: string | null;
  selectedItemIds: string[]; locale: string; model: string; taskKind: string; sourceHash: string; conversationTurnIds: string[];
};
export type AssistantSpecialistResponse = {
  memory?: SemanticMemoryAnswerPresentation;
  turnId: string; executionId: string; quote?: AvailableConsequentialPreview; originalRequest?: AssistantSpecialistOriginalRequest;
  task?: AssistantDisplayedTask;
  turn?: { id: string; user: string; reply: SpecialistReply; proposal: AssistantDisplayedProposal | null; proposals?: AssistantDisplayedProposal[]; originalRequest?: AssistantTurnOriginalRequest };
  result?: { profileSynthesis?:MemoryProfileSynthesis;creationReview?:MemoryCreationReview;editReview?:MemoryEditReview; reply: SpecialistReply | string; sourceStatus: "original-approved-source" | "semantic-memory-assisted" };
  requestedExecutionId?: string; reusedExecutionId?: string; winnerExecutionId?: string; noAutomaticRetry?: boolean; reused?: boolean;
  /** Present only after an exact successful read proves no task, provider submission, or reservation exists. */
  unusedExecution?: boolean;
  error?: string; recoveryError?: string; submission?: string; retentionUnavailable?: boolean; retainedResultUnavailable?: boolean;
};
export type AssistantSpecialistCompletedReview = {
  memory?: SemanticMemoryAnswerPresentation;
  turnId: string; executionId: string; quote: AvailableConsequentialPreview;
  originalRequest: AssistantSpecialistOriginalRequest;
  result: { profileSynthesis?:MemoryProfileSynthesis;creationReview?:MemoryCreationReview;editReview?:MemoryEditReview; reply: SpecialistReply | string; sourceStatus: "original-approved-source" | "semantic-memory-assisted" };
};
export type AssistantSpecialistReview = {
  profileSynthesis?:MemoryProfileSynthesis;creationReview?:MemoryCreationReview;editReview?:MemoryEditReview; memoryRequested?: boolean; semanticMemory?: SemanticMemoryAnswerPresentation; resultSource?: "original-approved-source" | "semantic-memory-assisted";
  id: string; scope: string; turnId: string; executionId: string; task: AssistantDisplayedTask | null;
  quote: AvailableConsequentialPreview | null; originalRequest: AssistantSpecialistOriginalRequest | null;
  working: boolean; stopping?: boolean; retrievalOnly: boolean; selectedModel?: string; unusedExecution?: boolean;
  notice: "" | "failed" | "uncertain" | "unavailable" | "redirected" | "denied" | "stopUnconfirmed" | "lookupFailed"; resultReply: SpecialistReply | string | null;
};

/** A captured control is an exact user intention, never an instruction to infer the current action. */
export type AssistantSpecialistControl = {
  reviewId: string; turnId: string; executionId: string; bindingHash: string;
  action: "approve" | "run-approved" | "retrieve" | "resume" | "quote" | "apply-edit" | "apply-creation"; model?: string; memory?: boolean; blockId?:string; approvedEditHash?:string;proposalId?:string;approvedCreationHash?:string;
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
    embedded: { type: Boolean },
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
    canMemoryEdit: { type: Boolean },
    memoryImageControls: { attribute: false },
    specialist: { attribute: false },
  };

  declare open: boolean;
  declare embedded: boolean;
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
  declare canMemoryEdit: boolean;
  declare memoryImageControls:TemplateResult|undefined;
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
  #browseLane: { main: HTMLElement; owner: HTMLElement; shell: HTMLElement; route: string; scope: string;
    direction: string; posture: string | null; shortHeight: string | null; stable: boolean;
    value: string; priority: string; written: string } | null = null;
  #browseLaneRefusal: { main: HTMLElement; focus: Element | null; layout: string } | null = null;
  #browsePointer: MediaQueryList | null = null;
  #revalidateBrowseSlot = () => {
    this.#browseLaneRefusal = null;
    this.#schedulePosition();
  };
  #schedulePosition = () => {
    if (this.embedded || this.#positionFrame || this.open && this.dataset.browseSlot !== "true" && this.dataset.browseLane !== "true") return;
    this.#positionFrame = requestAnimationFrame(() => {
      this.#positionFrame = 0;
      this.#positionLauncher();
    });
  };
  #librarySearchInput = (event: Event) => {
    const search = event.target;
    const owner = this.parentElement, shell = owner?.closest<HTMLElement>(".application-creative");
    const main = shell?.querySelector<HTMLElement>("#main-content");
    if (!(search instanceof HTMLElement) || !search.matches("forma-ui-search.searchbox")
      || !this.isConnected || !owner?.matches("forma-creative-assistant") || !shell || owner.parentElement !== shell
      || this.closest("[hidden], [inert], [aria-hidden='true']") || shell.getAttribute("data-layout-intent") !== "browse"
      || !main?.isConnected || main.parentElement !== shell || main.closest(".application-creative") !== shell
      || main.closest("[hidden], [inert], [aria-hidden='true']") || main.getAttribute("aria-busy") === "true") return;
    const panels = [...shell.querySelectorAll("forma-assistant-panel")]
      .filter(panel => panel.closest(".application-creative") === shell);
    const libraries = [...main.querySelectorAll<HTMLElement>("forma-library")]
      .filter(library => library.closest("#main-content") === main && library.closest(".application-creative") === shell);
    const library = libraries[0];
    if (panels.length !== 1 || panels[0] !== this || libraries.length !== 1 || !library?.isConnected
      || !search.isConnected || search.closest("forma-library") !== library
      || search.closest("[hidden], [inert], [aria-hidden='true']")) return;
    const primary = [...library.querySelectorAll(".library-main > .library-body > form.library-toolbar > forma-ui-search.searchbox")]
      .filter(element => element.closest("forma-library") === library);
    if (primary.length !== 1 || primary[0] !== search) return;
    // The Library has queued its own render before this bubbling event arrives.
    // Reuse the coalesced placement frame without retaining the search value.
    this.#schedulePosition();
  };

  constructor() {
    super();
    this.open = false;
    this.embedded = false;
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
    this.canMemoryEdit = false;
    this.specialist = null;
  }

  override connectedCallback() {
    super.connectedCallback();
    window.addEventListener("resize", this.#schedulePosition, { passive: true });
    window.addEventListener("scroll", this.#schedulePosition, { capture: true, passive: true });
    window.addEventListener("focusin", this.#schedulePosition, { passive: true });
    window.addEventListener("transitionend", this.#schedulePosition, { passive: true });
    window.addEventListener("forma-input", this.#librarySearchInput, { passive: true });
    this.#browsePointer = typeof window.matchMedia === "function" ? window.matchMedia("(pointer: coarse)") : null;
    this.#browsePointer?.addEventListener("change", this.#revalidateBrowseSlot);
  }

  override disconnectedCallback() {
    this.#clearStudioLauncher();
    this.#clearBrowseLauncher();
    this.#clearBrowseLane();
    this.#browseLaneRefusal = null;
    this.#browsePointer?.removeEventListener("change", this.#revalidateBrowseSlot);
    this.#browsePointer = null;
    window.removeEventListener("resize", this.#schedulePosition);
    window.removeEventListener("scroll", this.#schedulePosition, true);
    window.removeEventListener("focusin", this.#schedulePosition);
    window.removeEventListener("transitionend", this.#schedulePosition);
    window.removeEventListener("forma-input", this.#librarySearchInput);
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
    if (!this.embedded && changed.has("open") && this.open) queueMicrotask(() => { if (!this.specialist && !document.querySelector("dialog:modal")) this.querySelector<HTMLTextAreaElement>(".forma-assistant-input")?.focus(); });
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
      if (this.dataset.browseSlot === "true" || this.dataset.browseLane === "true") this.#schedulePosition();
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

  #clearBrowseLane() {
    delete this.dataset.browseLane;
    for (const name of ["left", "top"]) this.style.removeProperty(`--forma-assistant-browse-lane-${name}`);
    const previous = this.#browseLane;
    this.#browseLane = null;
    const property = "--forma-assistant-browse-lane-base-inset";
    if (previous && previous.main.style.getPropertyValue(property) === previous.written
      && previous.main.style.getPropertyPriority(property) === "") {
      if (previous.value) previous.main.style.setProperty(property, previous.value, previous.priority);
      else previous.main.style.removeProperty(property);
    }
  }

  #browseLaneLayout(main: HTMLElement) {
    const shell = main.closest(".application-creative"), bounds = main.getBoundingClientRect();
    // Scroll alone does not retry an unchanged rejected width reservation.
    return { main, focus: document.activeElement,
      layout: [innerWidth, innerHeight, bounds.width, bounds.height, getComputedStyle(main).direction,
        shell?.getAttribute("data-nav-posture"), shell?.getAttribute("data-short-height"),
        this.ownerDocument?.location?.href, this.conversationScope].join("|") };
  }

  #refuseBrowseLane() {
    const main = this.#browseLane?.main;
    this.#clearBrowseLane();
    if (main) this.#browseLaneRefusal = this.#browseLaneLayout(main);
  }

  #positionInBrowseLane(launcher?: HTMLButtonElement, stable = false) {
    // This is space in the current main's padding, not another floating search
    // over its content. Keep the same reservation while its Assistant is open.
    const owner = this.parentElement, shell = owner?.closest<HTMLElement>(".application-creative");
    const main = shell?.querySelector<HTMLElement>("#main-content");
    const available = getComputedStyle(this).getPropertyValue?.("--forma-assistant-browse-lane-available")?.trim();
    const panels = shell ? [...shell.querySelectorAll("forma-assistant-panel")]
      .filter(panel => panel.closest(".application-creative") === shell) : [];
    if (!this.isConnected || !owner?.matches("forma-creative-assistant") || !shell
      || owner.parentElement !== shell || this.closest("[hidden], [inert], [aria-hidden='true']")
      || shell.getAttribute("data-layout-intent") !== "browse" || !main?.isConnected
      || main.parentElement !== shell || main.closest(".application-creative") !== shell
      || main.closest("[hidden], [inert], [aria-hidden='true']")
      || main.getAttribute("aria-busy") === "true" || panels.length !== 1 || panels[0] !== this
      || available !== "1") { this.#clearBrowseLane(); return false; }
    const finite = (box: Pick<DOMRect, "left" | "top" | "right" | "bottom" | "width" | "height">) =>
      [box.left, box.top, box.right, box.bottom, box.width, box.height].every(Number.isFinite);
    let style = getComputedStyle(main);
    const direction = style.direction;
    if (!["ltr", "rtl"].includes(direction) || getComputedStyle(this).direction !== direction) {
      this.#clearBrowseLane(); return false;
    }
    const posture = shell.getAttribute("data-nav-posture"), shortHeight = shell.getAttribute("data-short-height");
    const route = this.ownerDocument?.location?.href ?? "", scope = this.conversationScope;
    if (this.#browseLane && (this.#browseLane.main !== main || this.#browseLane.owner !== owner
      || this.#browseLane.shell !== shell || this.#browseLane.route !== route || this.#browseLane.scope !== scope
      || this.#browseLane.direction !== direction || this.#browseLane.posture !== posture
      || this.#browseLane.shortHeight !== shortHeight)) {
      this.#clearBrowseLane(); return false;
    }
    const property = "--forma-assistant-browse-lane-base-inset";
    const previousTop = launcher?.getBoundingClientRect().top;
    if (!this.#browseLane) {
      const current = this.#browseLaneLayout(main), refused = this.#browseLaneRefusal;
      if (refused?.main === current.main && refused.focus === current.focus && refused.layout === current.layout) return false;
      const base = Number.parseFloat(direction === "rtl" ? style.paddingLeft : style.paddingRight);
      if (!Number.isFinite(base) || base < 0 || !launcher) return false;
      this.#browseLane = { main, owner, shell, route, scope, direction, posture, shortHeight, stable,
        value: main.style.getPropertyValue(property),
        priority: main.style.getPropertyPriority(property), written: `${base}px` };
      main.style.setProperty(property, this.#browseLane.written);
      this.dataset.browseLane = "true";
    }
    const previousCompact = this.dataset.compactLauncher, previousTight = this.dataset.tightLauncher;
    let accepted = false;
    try {
      if (main.style.getPropertyValue(property) !== this.#browseLane.written
        || main.style.getPropertyPriority(property) !== "") return false;
      style = getComputedStyle(main);
      const bounds = main.getBoundingClientRect();
      const padding = Number.parseFloat(direction === "rtl" ? style.paddingLeft : style.paddingRight);
      const border = Number.parseFloat(direction === "rtl" ? style.borderLeftWidth : style.borderRightWidth);
      const base = Number.parseFloat(this.#browseLane.written);
      if (!finite(bounds) || !Number.isFinite(innerWidth) || !Number.isFinite(innerHeight)
        || ![padding, border, base].every(value => Number.isFinite(value) && value >= 0)
        || style.display === "none" || style.visibility !== "visible" || Number(style.opacity) === 0
        || padding <= base || bounds.width <= padding || bounds.right <= 0 || bounds.left >= innerWidth) return false;
      for (let ancestor: HTMLElement | null = main; ancestor; ancestor = ancestor.parentElement) {
        const computed = getComputedStyle(ancestor);
        if (computed.display === "none" || computed.visibility !== "visible" || Number(computed.opacity) === 0
          || [computed.transform, computed.translate, computed.rotate, computed.scale, computed.perspective,
            computed.filter, computed.clipPath, computed.maskImage].some(value => value && value !== "none")
          || Boolean(computed.zoom && !["normal", "1", "100%"].includes(computed.zoom))) return false;
      }
      if (!launcher) { accepted = true; return true; }
      this.dataset.compactLauncher = "true";
      this.dataset.tightLauncher = "true";
      const size = launcher.getBoundingClientRect();
      const gap = (padding - base - size.width) / 2;
      if (!finite(size) || size.width < 44 || size.height < 44 || size.width !== size.height
        || !Number.isFinite(gap) || gap < 8) return false;
      const left = direction === "rtl" ? bounds.left + border + padding - gap - size.width
        : bounds.right - border - padding + gap;
      const floor = Math.max(8, bounds.top + Number.parseFloat(style.borderTopWidth));
      const ceiling = Math.min(innerHeight - 8, bounds.bottom - Number.parseFloat(style.borderBottomWidth));
      const top = Math.max(floor, Math.min(previousTop ?? size.top, ceiling - size.height));
      const box = { left, right: left + size.width, top, bottom: top + size.height };
      if (![floor, ceiling, top].every(Number.isFinite) || floor > ceiling - size.height
        || box.left < 0 || box.right > innerWidth) return false;
      this.style.setProperty("--forma-assistant-browse-lane-left", `${left}px`);
      this.style.setProperty("--forma-assistant-browse-lane-top", `${top}px`);
      const actual = launcher.getBoundingClientRect();
      // Native layout can quantize the requested position. The observed button
      // must still fit wholly in the measured strip and vertical visible band.
      if (!finite(actual) || actual.width !== size.width || actual.height !== size.height
        || Math.abs(actual.left - left) > 1 / 64 || Math.abs(actual.top - top) > 1 / 64
        || actual.left < box.left - gap + 8 || actual.right > box.right + gap - 8
        || actual.top < floor || actual.bottom > ceiling) return false;
      for (let ancestor: HTMLElement | null = main; ancestor; ancestor = ancestor.parentElement) {
        const computed = getComputedStyle(ancestor);
        const clipsX = /^(auto|scroll|hidden|clip)$/.test(computed.overflowX);
        const clipsY = /^(auto|scroll|hidden|clip)$/.test(computed.overflowY);
        if (!clipsX && !clipsY) continue;
        if ([computed.borderTopLeftRadius, computed.borderTopRightRadius, computed.borderBottomLeftRadius,
          computed.borderBottomRightRadius].some(radius => typeof radius !== "string"
          || !/^0(?:\.0+)?(?:px|%)?(?:\s+0(?:\.0+)?(?:px|%)?)?$/u.test(radius.trim()))) return false;
        const clip = ancestor.getBoundingClientRect(), x = clip.left + ancestor.clientLeft, y = clip.top + ancestor.clientTop;
        if (clipsX && (actual.left < x || actual.right > x + ancestor.clientWidth)
          || clipsY && (actual.top < y || actual.bottom > y + ancestor.clientHeight)) return false;
      }
      this.style.removeProperty("--forma-assistant-obstacle-offset");
      this.#browseLaneRefusal = null;
      accepted = true;
      return true;
    } finally {
      if (!accepted) {
        this.#refuseBrowseLane();
        if (previousCompact === undefined) delete this.dataset.compactLauncher;
        else this.dataset.compactLauncher = previousCompact;
        if (previousTight === undefined) delete this.dataset.tightLauncher;
        else this.dataset.tightLauncher = previousTight;
      }
    }
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
    // CSS declares either the existing row or the short-landscape rail cell.
    // A failed measurement restores the original five-link layout in this pass.
    if (!this.isConnected) return false;
    const posture = getComputedStyle(this).getPropertyValue?.("--forma-assistant-browse-slot")?.trim();
    const rail = posture === "rail";
    if (!rail && posture !== "1") return false;
    const owner = this.parentElement, shell = owner?.closest<HTMLElement>(".application-creative");
    if (!owner?.matches("forma-creative-assistant") || !shell
      || shell.getAttribute("data-layout-intent") !== "browse" || (shell.getAttribute("data-nav-posture") !== "compact"
        && (!rail || shell.getAttribute("data-nav-posture") !== "rail"
          || shell.getAttribute("data-short-height") !== "true"))) return false;
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
      const tracks = rail ? style.gridTemplateRows?.trim().split(/\s+/u).map(value => Number.parseFloat(value)) ?? [] : columns;
      const gap = Number.parseFloat(rail ? style.rowGap : style.columnGap), size = tracks[1];
      if (style.display !== "grid" || columns.length !== (rail ? 1 : 2) || !columns.every(value => Number.isFinite(value) && value > 0)
        || tracks.length !== 2 || !tracks.every(value => Number.isFinite(value) && value > 0)
        || size === undefined || size < 44 || !Number.isFinite(gap) || gap < 0 || !finite(bounds) || !finite(navBox)
        || !Number.isFinite(innerWidth) || !Number.isFinite(innerHeight)
        || bounds.left < 0 || bounds.top < 0 || bounds.right > innerWidth
        || navBox.width <= 0 || navBox.height < size) return false;
      if (bounds.bottom > innerHeight) {
        // Tab zoom can expose a fractional final CSS pixel while innerHeight is
        // integral. Only the rail host may use it; every target stays inside.
        const viewport = rail ? window.visualViewport : null;
        if (!viewport || !Number.isFinite(viewport.height) || viewport.scale !== 1
          || viewport.offsetTop !== 0 || viewport.offsetLeft !== 0
          || viewport.height < innerHeight || viewport.height - innerHeight >= 1
          || bounds.bottom > viewport.height) return false;
      }
      let left: number, top: number;
      if (rail) {
        const start = Number.parseFloat(style.borderLeftWidth) + Number.parseFloat(style.paddingLeft);
        const end = Number.parseFloat(style.borderRightWidth) + Number.parseFloat(style.paddingRight);
        const before = Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.paddingTop);
        const after = Number.parseFloat(style.borderBottomWidth) + Number.parseFloat(style.paddingBottom);
        if (![start, end, before, after].every(value => Number.isFinite(value) && value >= 0)
          || bounds.width - start - end < size
          || navBox.left < bounds.left + start || navBox.right > bounds.right - end
          || navBox.top < bounds.top + before) return false;
        left = bounds.left + start + (bounds.width - start - end - size) / 2;
        top = bounds.bottom - after - size;
      } else {
        const inset = style.direction === "rtl"
          ? Number.parseFloat(style.borderLeftWidth) + Number.parseFloat(style.paddingLeft)
          : Number.parseFloat(style.borderRightWidth) + Number.parseFloat(style.paddingRight);
        if (!Number.isFinite(inset) || inset < 0) return false;
        left = style.direction === "rtl" ? bounds.left + inset : bounds.right - inset - size;
        // The navigation row excludes its host's bottom safe-area padding.
        top = navBox.top + (navBox.height - size) / 2;
      }
      const box = { left, right: left + size, top, bottom: top + size };
      if (box.left < bounds.left || box.right > bounds.right || box.top < bounds.top || box.bottom > bounds.bottom
        || (rail ? navBox.bottom + gap > box.top || box.bottom > innerHeight
          : style.direction === "rtl" ? box.right + gap > navBox.left : navBox.right + gap > box.left)) return false;
      if (links.some(link => {
        const rect = link.getBoundingClientRect(), computed = getComputedStyle(link);
        return !finite(rect) || rect.width < size || rect.height < size
          || rect.left < navBox.left || rect.right > navBox.right || rect.top < navBox.top || rect.bottom > navBox.bottom
          || (rail && (rect.left < 0 || rect.top < 0 || rect.right > innerWidth || rect.bottom > innerHeight))
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
          || (rail ? actual.top < box.top || actual.bottom > box.bottom || actual.left < 0 || actual.top < 0
            || actual.right > innerWidth || actual.bottom > innerHeight
            : actual.top < navBox.top || actual.bottom > navBox.bottom)) return false;
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
    const obstacles: Array<{ element: HTMLElement; box: Pick<DOMRect, "left" | "top" | "right" | "bottom" | "width" | "height">;
      inspection?: { main: HTMLElement; current: () => boolean } }> = [];
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
    const libraryInspectionSelector = ".library-main > forma-library-block-editor > section.library-block-inspection";
    const libraryInspectionCopySelector = `${libraryInspectionSelector} > forma-context-block[surface="library"] > section.context-decision[data-controls-open="false"] > div > article.context-block--summary > .block-body > p.block-copy[data-forma-content="primary"]`;
    const documentContextStatusSelector = '#document-context-panel forma-context-block > section.context-decision[data-controls-open="false"] > div[id^="context-controls-document-"] > article.context-block--summary > .block-body > .block-heading > .block-heading-state > .context-lock-state';
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
        libraryInspectionCopySelector,
      ]],
      ["forma-reality-layers", [
        ':scope > .workspace-page.studio-alternative > .studio-main > .studio-subpage-body > .reality-editor[data-forma-content="primary"] > .layers-panel > form.layer-inspector[data-layer-inspector] > label:has(> input[name="weight"][type="range"])',
        ':scope > .workspace-page.studio-alternative > .studio-main > .studio-subpage-body > .reality-editor[data-forma-content="primary"] > .layers-panel > form.layer-inspector[data-layer-inspector] > label:has(> input[name="weight"][type="range"]) > output',
      ]],
      ["forma-project-contents", [".studio-main > .page-header--document > .page-header-copy > :is(.eyebrow,h1,p)"]],
      ["forma-workspace", [
        documentContextStatusSelector,
        '#document-context-panel [data-output-recipe-draft] > forma-output-requirement-card .output-requirement-card > form.output-requirement-form > p.output-requirement-note:first-child',
        '#document-context-panel [data-output-recipe-draft] > forma-output-requirement-card .output-requirement-card > form.output-requirement-form > p.output-requirement-note:first-child + p:not([class])',
        '#document-context-panel [data-output-recipe-draft] > forma-output-requirement-card .output-requirement-card > form.output-requirement-form > label.output-requirement-field:has(> :is(input[name="packageLabel"],textarea[name="originalText"])) > :is(span,small:not(.output-requirement-error))',
        '#document-context-panel [data-output-recipe-draft] > forma-output-requirement-card > .output-requirement-card > form.output-requirement-form > footer.output-requirement-form-footer > p',
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
      const elements = new Set(selectors.flatMap(selector => [...surface.querySelectorAll<HTMLElement>(selector)]));
      for (const element of elements) {
        if (!element.isConnected || element.closest(ownerSelector) !== surface
          || element.closest("[hidden], [inert], [aria-hidden='true']")) continue;
        const libraryWeightLabel = ownerSelector === "forma-library" && element.tagName === "LABEL"
          && element.matches(libraryWeightLabelCopySelector);
        let inspectionWitness: { main: HTMLElement; current: () => boolean } | undefined;
        if (ownerSelector === "forma-library" && element.matches(libraryInspectionCopySelector)) {
          // This is painted source copy, not a focus target or an authoring surface.
          // Read the existing organism-owned Store without importing its runtime.
          type StoreOwner = HTMLElement & { store?: FormaStore };
          const store = (owner as StoreOwner).store;
          const editors = [...surface.querySelectorAll<LibraryBlockEditor>(".library-main > forma-library-block-editor")];
          const inspections = [...surface.querySelectorAll<HTMLElement>(libraryInspectionSelector)];
          const editor = editors[0], inspection = inspections[0];
          const contexts = inspection ? [...inspection.querySelectorAll<ContextBlock>(':scope > forma-context-block[surface="library"]')] : [];
          const context = contexts[0];
          if (!store || owner.parentElement !== shell || main.parentElement !== shell
            || (surface as StoreOwner).store !== store || editors.length !== 1 || !editor?.isConnected
            || (editor as unknown as StoreOwner).store !== store || inspections.length !== 1
            || inspection?.parentElement !== editor || contexts.length !== 1 || !context?.isConnected
            || (context as unknown as StoreOwner).store !== store || context.readOnly !== true
            || context.surface !== "library" || !store.routeDataReady()) continue;
          const route = store.route.get(), target = libraryBlockEditorFromRoute(route);
          const source = store.captureSourceOwnership(), authorization = store.captureAuthorizationScope();
          const projection = store.projection.get();
          const blocks = projection.libraryBlocks.filter(block => block.id === target?.blockId);
          const block = blocks[0];
          const summary = element.parentElement?.parentElement, content = summary?.parentElement;
          // Route folds reconstruct blocks while the editor retains its subtree.
          // Match the complete serialized block revision, including sourceEvents.
          if (!target?.blockId || editor.blockId !== target.blockId || blocks.length !== 1 || !block
            || JSON.stringify(context.block) !== JSON.stringify(block) || block.projectId !== projection.projectId
            || summary?.getAttribute("data-block-id") !== block.id
            || content?.id !== `context-controls-library-${block.id}`
            || content.parentElement?.parentElement !== context
            || context.querySelectorAll(':scope > section.context-decision[data-controls-open="false"] > div > article.context-block--summary > .block-body > p.block-copy[data-forma-content="primary"]').length !== 1
            || !store.sourceOwnershipActive(source) || !store.authorizationScopeActive(authorization)
            || store.route.get() !== route) continue;
          const revision = JSON.stringify(block), copyText = element.textContent;
          inspectionWitness = { main, current: () => {
            const latest = store.projection.get().libraryBlocks.filter(candidate => candidate.id === block.id);
            return this.isConnected && this.parentElement === owner && owner.isConnected && owner.parentElement === shell
              && shell.isConnected && this.closest(".application-creative") === shell
              && (owner as StoreOwner).store === store && main.isConnected && main.parentElement === shell
              && main.closest(".application-creative") === shell && surface.closest(".application-creative") === shell
              && shell.querySelector("#main-content") === main && main.getAttribute("aria-busy") !== "true"
              && shell.querySelectorAll(":scope > main#main-content").length === 1
              && [...shell.querySelectorAll("forma-assistant-panel")].filter(panel => panel.closest(".application-creative") === shell).length === 1
              && main.querySelectorAll("forma-library").length === 1 && surface.isConnected && surface.closest("#main-content") === main
              && (surface as StoreOwner).store === store && editor.isConnected && (editor as unknown as StoreOwner).store === store
              && editor.blockId === block.id && inspection.isConnected && inspection.parentElement === editor
              && context.isConnected && context.parentElement === inspection && (context as unknown as StoreOwner).store === store
              && context.readOnly === true && context.surface === "library" && element.isConnected
              && element.textContent === copyText && element.matches(libraryInspectionCopySelector) && element.closest("forma-library") === surface
              && element.parentElement?.parentElement === summary && summary.getAttribute("data-block-id") === block.id
              && summary.parentElement === content && content.id === `context-controls-library-${block.id}`
              && content.parentElement?.parentElement === context
              && !element.closest("[hidden], [inert], [aria-hidden='true']")
              && surface.querySelectorAll(libraryInspectionCopySelector).length === 1
              && surface.querySelectorAll(".library-main > forma-library-block-editor").length === 1
              && surface.querySelectorAll(libraryInspectionSelector).length === 1
              && inspection.querySelectorAll(":scope > forma-context-block").length === 1
              && latest.length === 1 && JSON.stringify(latest[0]) === revision && JSON.stringify(context.block) === revision
              && store.projection.get().projectId === block.projectId && store.route.get() === route && store.routeDataReady()
              && store.sourceOwnershipActive(source) && store.authorizationScopeActive(authorization);
          } };
        }
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
        if (ownerSelector === "forma-library" && ["LABEL", "SMALL"].includes(element.tagName) && !libraryWeightLabel) {
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
        if (ownerSelector === "forma-workspace" && ["SPAN", "SMALL"].includes(element.tagName)
          && !element.matches(documentContextStatusSelector)) {
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
        const wholeRegion = ownerSelector === "forma-workspace"
          || ownerSelector === "forma-library" && (["LABEL", "SMALL"].includes(element.tagName) && !libraryWeightLabel
            || element.tagName === "OUTPUT"
            || element.tagName === "P" && element.parentElement?.matches(".family-empty[data-forma-empty-state]")
            || element.tagName === "DIV" && element.matches(libraryOutputCopySelector))
          || ownerSelector === "forma-reality-layers" && ["LABEL", "OUTPUT"].includes(element.tagName)
          || ownerSelector === "forma-document-generations";
        // Weight-label text is a separate fragment contract. Never walk into
        // its OUTPUT or replace the row with a duplicate whole-label box.
        const directText = libraryWeightLabel ? [...element.childNodes].filter(node => node.nodeType === 3) : null;
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
              obstacles.push({ element, box: { left, top, right, bottom, width: right - left, height: bottom - top },
                ...(inspectionWitness ? { inspection: inspectionWitness } : {}) });
            }
          }
        }
      }
    }
    return obstacles;
  }

  #captureBrowseLaneFocus(focused: Element | null) {
    if (!(focused instanceof HTMLElement) || this.#browseLane
      || !focused.matches("a[href], button, input, textarea, select, summary")
      || !focused.matches(":focus-visible")) return null;
    const document = focused.ownerDocument, view = document.defaultView;
    const owner = this.parentElement, shell = owner?.closest<HTMLElement>(".application-creative");
    const main = focused.closest<HTMLElement>("#main-content");
    if (!view || !owner || !shell || !main || main.parentElement !== shell
      || owner.parentElement !== shell || !main.contains(focused)) return null;
    const context = this.context, scope = this.conversationScope, href = view.location.href;
    const focus = captureOutputNavigationFocus(document);
    return {
      reveal: () => {
        const lane = this.#browseLane;
        const current = () => Boolean(lane?.stable && this.#browseLane === lane && lane.main === main
          && this.isConnected && this.parentElement === owner && owner.parentElement === shell
          && main.isConnected && main.parentElement === shell && shell.querySelector("#main-content") === main
          && main.getAttribute("aria-busy") !== "true" && !main.closest("[hidden], [inert], [aria-hidden='true']")
          && shell.getAttribute("data-layout-intent") === "browse"
          && shell.getAttribute("data-nav-posture") === lane.posture
          && shell.getAttribute("data-short-height") === lane.shortHeight
          && view.getComputedStyle(main).direction === lane.direction
          && view.getComputedStyle(this).direction === lane.direction
          && this.context === context && this.conversationScope === scope && view.location.href === href
          && focused.isConnected && focused.ownerDocument === document && focused.closest("#main-content") === main
          && !focused.matches(":disabled") && !focused.closest("[hidden], [inert], [aria-hidden='true']")
          && document.activeElement === focused && document.hasFocus() && document.visibilityState === "visible"
          && focus.current());
        if (!current() || focused.getClientRects().length !== 1) return;
        const box = focused.getBoundingClientRect(), style = view.getComputedStyle(focused);
        const extent = ["none", "hidden"].includes(style.outlineStyle) ? 0
          : Math.max(0, (Number.parseFloat(style.outlineWidth) || 0) + (Number.parseFloat(style.outlineOffset) || 0));
        if (![box.left, box.top, box.right, box.bottom, box.width, box.height, extent,
          view.innerWidth, view.innerHeight].every(Number.isFinite)
          || box.width <= 0 || box.height <= 0 || style.display === "none" || style.visibility !== "visible"
          || Number(style.opacity) === 0 || box.width + 2 * extent > view.innerWidth
          || box.height + 2 * extent > view.innerHeight) return;
        if (box.left >= extent && box.top >= extent && box.right <= view.innerWidth - extent
          && box.bottom <= view.innerHeight - extent) return;
        // Late main readiness can make the first reservation follow native Tab.
        // Reveal only this still-owned, previously complete control once. The
        // native nearest operation honors its existing CSS scroll margins.
        if (current()) {
          try { focused.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" }); }
          catch { /* Existing placement validation still runs; never replace focus. */ }
        }
      },
      dispose: () => focus.dispose(),
    };
  }

  #positionLauncher(allowReservation = true) {
    if (this.embedded) return;
    if (this.open) {
      if (this.dataset.browseSlot === "true") {
        this.#clearBrowseLauncher();
        this.#positionInBrowseSlot();
      }
      if (this.dataset.browseLane === "true") this.#positionInBrowseLane();
      return;
    }
    const launcher = this.querySelector<HTMLButtonElement>(".forma-assistant-launcher");
    const focused = document.activeElement;
    this.#clearStudioLauncher();
    this.#clearBrowseLauncher();
    const stable = this.#browseLane?.stable === true && this.#positionInBrowseLane(launcher ?? undefined);
    const shell = this.parentElement?.closest(".application-creative");
    const main = shell?.querySelector<HTMLElement>(":scope > #main-content");
    const deliver = main?.querySelector<HTMLElement>("forma-deliver > .forma-deliver-page");
    const navigation = shell?.querySelector<HTMLElement>(':scope > forma-ui-audience-navigation.application-task-navigation[data-primary-navigation="true"]');
    // Deliver's fixed navigation can host Ask without narrowing the entire page.
    // The existing slot measurement still validates every target and can refuse it.
    const preferDeliverSlot = Boolean(allowReservation && launcher && main && deliver
      && deliver.closest("#main-content") === main
      && shell?.getAttribute("data-layout-intent") === "browse"
      && shell.getAttribute("data-nav-posture") === "compact"
      && navigation && getComputedStyle(navigation).position === "fixed"
      && getComputedStyle(this).getPropertyValue("--forma-assistant-browse-slot").trim() === "1"
      && !launcher.contains(focused) && !launcher.matches(":hover"));
    const preferStableLane = !preferDeliverSlot && (stable || Boolean(allowReservation && launcher
      && getComputedStyle(this).getPropertyValue?.("--forma-assistant-browse-lane-available")?.trim() === "1"
      && shell?.getAttribute("data-layout-intent") === "browse"
      && shell.getAttribute("data-nav-posture") === "compact"
      && !launcher.contains(focused) && !launcher.matches(":hover")));
    // An accepted compact browse gutter belongs to the current main, not to a
    // temporary floating gap or a navigation cell that can scroll out of view.
    // Other postures keep following their existing reserved cell.
    if (launcher && (this.#positionInStudioSlot() || !preferStableLane && this.#positionInBrowseSlot(launcher))) {
      const reserved = this.dataset.browseLane === "true";
      this.#clearBrowseLane();
      this.#browseLaneRefusal = null;
      if (reserved) this.#positionLauncher(false);
      return;
    }
    const reserved = stable || this.dataset.browseLane === "true" && this.#positionInBrowseLane(launcher ?? undefined);
    if (!launcher || this.open || launcher.contains(focused) && !reserved) return;
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
        const focusEnvelope = control === focused ? { left, top, right, bottom } : null;
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
        const completeFocus = Boolean(focusEnvelope && left === focusEnvelope.left && top === focusEnvelope.top
          && right === focusEnvelope.right && bottom === focusEnvelope.bottom
          && left >= 0 && top >= 0 && right <= innerWidth && bottom <= innerHeight);
        return { element: control, paint, focusEnvelope, completeFocus,
          box: { left, top, right, bottom, width: right - left, height: bottom - top } };
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
    if (!reserved && hovered && (!exactFocusPaint || !intersections(launcher.getBoundingClientRect())
      .some(({ element }) => element === focused))) return;
    // Placement uses both lists; only native controls above authorize a
    // hovered move or establish exact current-focus paint.
    const ordinaryCopy = this.#ordinaryCopyObstacles();
    const placementObstacles = [...controls, ...ordinaryCopy];
    const placementIntersections = (box: Pick<DOMRect, "left" | "top" | "right" | "bottom">) =>
      placementObstacles.filter(({ box: obstacle }) => box.left < obstacle.right && box.right > obstacle.left
        && box.top < obstacle.bottom && box.bottom > obstacle.top);
    if (!reserved && preferStableLane) {
      const main = shell?.querySelector("#main-content");
      const mainFocus = Boolean(focused && main?.contains(focused));
      const currentFocus = controls.find(control => control.element === focused);
      const reveal = allowReservation && exactFocusPaint && mainFocus && currentFocus?.completeFocus
        && currentFocus.paint === focused ? this.#captureBrowseLaneFocus(focused) : null;
      try {
        // Reserve before the first compact browse traversal, even when a
        // floating gap currently fits. A late main may already own native
        // focus; preserve only that exact, previously complete control once.
        if (allowReservation && exactFocusPaint && (!mainFocus || reveal)
          && this.#positionInBrowseLane(launcher, true)) {
          reveal?.reveal();
          this.#positionLauncher(false);
          return;
        }
      } finally { reveal?.dispose(); }
      if (this.#positionInBrowseSlot(launcher)) return;
    }
    if (reserved) {
      // Native Tab may leave page focus at a viewport edge. Keep the real gutter
      // when its complete, untrimmed focus envelope is clear of the inline lane;
      // restoring main's width here would reflow content during keyboard travel.
      const pageFocus = focused && focused !== document.body && focused !== document.documentElement
        && !this.contains(focused);
      const launcherBox = launcher.getBoundingClientRect();
      const currentFocus = controls.find(control => control.element === focused);
      const inlineClearFocus = currentFocus?.focusEnvelope
        && (currentFocus.focusEnvelope.right <= launcherBox.left || currentFocus.focusEnvelope.left >= launcherBox.right);
      if (placementIntersections(launcherBox).length
        || pageFocus && (!exactFocusPaint || !(currentFocus?.completeFocus || inlineClearFocus))) {
        this.#refuseBrowseLane();
        this.#positionLauncher(false);
      }
      return;
    }
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
    // Reserve real browse space before accepting a temporary compact gap.
    // Native Tab can scroll different controls through that floating gap.
    if (allowReservation && !preferStableLane && exactFocusPaint && this.#positionInBrowseLane(launcher)) {
      this.#positionLauncher(false);
      return;
    }
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
    // The route-focused main remains outside the native control census. Only a
    // current inspection with its genuine focus perimeter outside the viewport
    // may use this final search; earlier hover/reservation rules stay unchanged.
    const inspection = !exactFocusPaint ? ordinaryCopy.find(copy => copy.inspection?.main === focused)?.inspection : undefined;
    const arrivalGap = inspection ? captureLibraryInspectionArrivalGap(inspection.main, inspection.current) : null;
    if (!exactFocusPaint && !arrivalGap) return;
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
    if (arrivalGap && !arrivalGap.clear({ left: box.left, right: box.right, top: candidate.top,
      bottom: candidate.top + box.height, width: box.width, height: box.height })) return;
    this.dataset.tightLauncher = "true";
    this.style.setProperty("--forma-assistant-obstacle-offset", `${currentOffset + box.top - candidate.top}px`);
    // Native layout may quantize the center. Accept only the observed body in
    // this same clear gap, with unchanged inline bounds and compact footprint.
    const actual = launcher.getBoundingClientRect();
    if (!finiteBox(actual) || !Number.isFinite(innerHeight)
      || actual.left !== box.left || actual.right !== box.right || actual.width !== box.width || actual.height !== box.height
      || actual.top < candidate.floor || actual.bottom > candidate.ceiling
      || actual.top < 8 || actual.bottom > innerHeight - 8 || placementIntersections(actual).length
      || arrivalGap && !arrivalGap.clear(actual)) {
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

  async #applyReviewedMemoryEdit(target:Omit<AssistantSpecialistControl,'action'|'model'>,review:MemoryEditReview,blockId:string){
    // Hash the rendered clone, not a later response that shares an execution ID.
    const approvedEditHash=await memoryEditApprovalHash(review,blockId);
    if(approvedEditHash)this.#specialistControl({...target,action:'apply-edit',blockId,approvedEditHash});
  }

  async #applyReviewedMemoryCreation(target:Omit<AssistantSpecialistControl,'action'|'model'>,review:MemoryCreationReview,proposalId:string){
    const approvedCreationHash=await memoryCreationApprovalHash(review,proposalId);
    if(approvedCreationHash)this.#specialistControl({...target,action:'apply-creation',proposalId,approvedCreationHash});
  }

  #specialistControl(detail: AssistantSpecialistControl, modelChange = false) {
    if (!this.#specialistTargetCurrent(detail)) return;
    const state = this.specialist!, quote = state.quote;
    const purchase = Boolean(quote && !state.retrievalOnly && quote.status === "quoted");
    const allowed = detail.action === "apply-creation" ? this.canMemoryEdit && quote?.status==='completed'
      && state.resultSource==='semantic-memory-assisted' && Boolean(parseSemanticMemoryAnswerPresentation(state.semanticMemory))
      && typeof detail.approvedCreationHash==='string'&&/^[a-f0-9]{64}$/u.test(detail.approvedCreationHash)
      && Boolean(state.creationReview?.creations.some(item=>item.proposalId===detail.proposalId))
      : detail.action === "apply-edit" ? this.canMemoryEdit && quote?.status==='completed'
      && state.resultSource==='semantic-memory-assisted' && Boolean(parseSemanticMemoryAnswerPresentation(state.semanticMemory))
      && typeof detail.approvedEditHash==='string'&&/^[a-f0-9]{64}$/u.test(detail.approvedEditHash)
      && Boolean(state.editReview?.edits.some(edit=>edit.blockId===detail.blockId))
      : detail.action === "approve" ? purchase && this.canSpecialist && quote
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
    const editReview=state.resultSource==='semantic-memory-assisted'&&parseSemanticMemoryAnswerPresentation(state.semanticMemory)&&state.originalRequest&&quote?.status==='completed'
      ?parseMemoryEditReview(state.editReview,{executionId:state.executionId,turnId:state.turnId,projectId:state.originalRequest.projectId,
        documentId:state.originalRequest.documentId,sourceHash:state.originalRequest.sourceHash,locale:state.originalRequest.locale}):null;
    const creationReview=state.resultSource==='semantic-memory-assisted'&&parseSemanticMemoryAnswerPresentation(state.semanticMemory)&&state.originalRequest&&quote?.status==='completed'
      ?parseMemoryCreationReview(state.creationReview,{executionId:state.executionId,turnId:state.turnId,projectId:state.originalRequest.projectId,
        documentId:state.originalRequest.documentId,sourceHash:state.originalRequest.sourceHash,locale:state.originalRequest.locale}):null;
    const profileSynthesis=state.resultSource==='semantic-memory-assisted'&&parseSemanticMemoryAnswerPresentation(state.semanticMemory)&&state.originalRequest&&quote?.status==='completed'
      ?parseMemoryProfileSynthesis(state.profileSynthesis,{executionId:state.executionId,turnId:state.turnId,projectId:state.originalRequest.projectId,
        documentId:state.originalRequest.documentId,sourceHash:state.originalRequest.sourceHash,locale:state.originalRequest.locale}):null;
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
        ${state.originalRequest?.fieldTarget?html`<p dir="auto">${this.i18n.t('assistant.specialist.fieldGenerationTarget','',{id:state.originalRequest.fieldTarget.blockId,revision:state.originalRequest.fieldTarget.revision})}</p>`:nothing}
        ${quote ? consequentialPreview(quote, this.i18n) : nothing}
        ${!state.retrievalOnly && this.canSpecialist && this.models.length && (quote || state.selectedModel) ? html`<div class="forma-assistant-model">
          <label><span>${this.i18n.t("assistant.model.choose")}</span>
            <select aria-label=${this.i18n.t("assistant.specialist.modelLabel", "", this.#specialistLabelValues(state.turnId))} .value=${quote?.models[0] ?? state.selectedModel ?? ""} ?disabled=${state.working || !this.#modalReady}
              @change=${(event: Event) => this.#specialistControl({ ...modelControl, model: (event.currentTarget as HTMLSelectElement).value }, true)}>
              ${quote?.models[0] && !selected ? html`<option value=${quote.models[0]} disabled selected>${this.i18n.t("assistant.specialist.modelUnavailable", "", { model: this.#modelLabel(quote.models[0]) })}</option>` : nothing}
              ${this.models.map((model) => html`<option value=${model.id}>${this.#modelLabel(model.id)}</option>`)}
            </select>
          </label>
          ${state.originalRequest?.documentId ? html`<label><input type="checkbox" .checked=${state.memoryRequested??false}
            ?disabled=${state.working||!this.#modalReady||Boolean(quote&&quote.status!=="quoted")||Boolean(state.originalRequest?.fieldTarget)}
            @change=${(event:Event)=>this.#specialistControl({...modelControl,model:quote?.models[0]??state.selectedModel,memory:(event.currentTarget as HTMLInputElement).checked},true)}>
            <span>${this.i18n.t("assistant.specialist.memoryInclude")}</span></label>`:nothing}
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
        ${profileSynthesis?html`<section class="forma-assistant-memory-profile-synthesis" aria-label=${this.i18n.t('assistant.specialist.profileSynthesisTitle')}>
          <h3>${this.i18n.t('assistant.specialist.profileSynthesisTitle')}</h3><p>${this.i18n.t('assistant.specialist.profileSynthesisDetail')}</p>
          ${profileSynthesis.items.map(item=>html`<article><p dir="auto">${item.text}</p><p>${this.i18n.t('assistant.specialist.profileSynthesisEvidence','',{count:item.originalCount})}</p><p>${this.i18n.t('assistant.specialist.profileSynthesisScope','',{scope:this.i18n.t('assistant.specialist.profileZoom.'+item.zoom),weight:this.i18n.number(item.weight)})}</p>
            <details><summary>${this.i18n.t('assistant.specialist.profileSynthesisSources')}</summary>
              ${item.sources.map(source=>html`<div><p><bdi>${source.projectId}</bdi> · <bdi>${source.documentId}</bdi></p><p dir="auto">${source.interpretation}</p>
                ${source.quotes.map(quote=>html`<blockquote dir="auto">${quote}</blockquote>`)}</div>`)}
            </details></article>`)}
        </section>`:nothing}
        ${editReview?html`<section class="forma-assistant-memory-edit-review" aria-label=${this.i18n.t('assistant.specialist.editReviewTitle')}>
          <h3>${this.i18n.t('assistant.specialist.editReviewTitle')}</h3><p>${this.i18n.t('assistant.specialist.editReviewDetail')}</p>
          ${this.canMemoryEdit?html`<p>${this.i18n.t('assistant.specialist.editPublishDetail')}</p>`:nothing}
          ${editReview.edits.map(edit=>html`<article><h4 dir="auto">${this.i18n.t('assistant.specialist.editReviewTarget','',{id:edit.blockId,revision:edit.revision})}</h4>
            <dl><dt>${this.i18n.t('assistant.specialist.editReviewBefore')}</dt><dd dir="auto">${edit.beforeExcerpt}</dd>
              <dt>${this.i18n.t('assistant.specialist.editReviewAfter')}</dt><dd dir="auto">${edit.suggestedText}</dd></dl>
              ${this.canMemoryEdit?html`<button type="button" class="button secondary" ?disabled=${state.working||!this.#modalReady}
                @click=${()=>this.#applyReviewedMemoryEdit(target,editReview,edit.blockId)}>${this.i18n.t('assistant.specialist.editApply')}</button>`:nothing}</article>`)}
        </section>`:nothing}
        ${creationReview?html`<section class="forma-assistant-memory-creation-review" aria-label=${this.i18n.t('assistant.specialist.creationTitle')}>
          <h3>${this.i18n.t('assistant.specialist.creationTitle')}</h3><p>${this.i18n.t('assistant.specialist.creationDetail')}</p>
          ${creationReview.creations.map(item=>html`<article><h4>${this.i18n.system(item.blockType[0]!.toUpperCase()+item.blockType.slice(1))}${item.blockType==='output'?nothing:html` · ${this.i18n.system(item.intent==='include'?'Include':'Avoid')}`}</h4><p dir="auto">${item.text}</p>
            ${item.blockType==='output'?html`<p>${this.i18n.t('assistant.specialist.outputCreationDetail')}</p>`:nothing}
            ${this.canMemoryEdit?html`<button type="button" class="button secondary" ?disabled=${state.working||!this.#modalReady}
              @click=${()=>this.#applyReviewedMemoryCreation(target,creationReview,item.proposalId)}>${this.i18n.t(item.blockType==='output'?'assistant.specialist.outputCreationApply':'assistant.specialist.creationApply')}</button>`:nothing}</article>`)}
        </section>`:nothing}
        ${state.resultSource==='semantic-memory-assisted'&&parseSemanticMemoryAnswerPresentation(state.semanticMemory)?this.memoryImageControls:nothing}
        ${reply ? html`<section class="forma-assistant-specialist-result"><h3>${this.i18n.t(state.resultSource==="semantic-memory-assisted"?"assistant.specialist.memoryResult":"assistant.specialist.originalResult")}</h3><p dir="auto">${reply}</p><small>${this.i18n.t(state.resultSource==="semantic-memory-assisted"?"assistant.specialist.memoryReview":"assistant.specialist.resultReview")}</small></section>` : nothing}
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
    return html`<section class="forma-assistant-panel" role=${this.embedded ? "region" : "dialog"} aria-modal=${this.embedded ? nothing : "false"} aria-labelledby="forma-assistant-title" @keydown=${(event: KeyboardEvent) => { if (!this.embedded && event.key === "Escape" && !event.isComposing && !document.querySelector("dialog:modal")) { event.preventDefault(); event.stopPropagation(); this.#toggle(false); } }}>
      <header class="forma-assistant-header"><div><h2 id="forma-assistant-title" data-assistant-heading tabindex="-1">${this.i18n.t("assistant.heading")}</h2><small>${this.i18n.t("assistant.privacy")}</small></div>${this.embedded ? nothing : html`<button type="button" class="icon-button forma-assistant-close" aria-label=${this.i18n.t("assistant.close")} @click=${() => this.#toggle(false)}>${icon("close")}</button>`}</header>
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

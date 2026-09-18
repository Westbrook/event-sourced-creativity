import { html, nothing } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { navigateInApp, navigationPresentationClosing, type CommandDeparture } from "./command-departure";
import type { CapturedSourceOwnership } from "../state/store.ts";
import { assistantInteractionForSurface, assistantSurfaceForRoute, type AssistantInteractionMode, type AssistantToolRequest } from "../model/assistant-route-policy.ts";
import { ASSISTANT_CONTEXT_LIMITS, type AssistantContext } from "../model/conversation-context.ts";
import { contextConsentAction } from "../model/context-consent-state.ts";
import { withDocumentInRoute } from "../model/routes.ts";
import { creativeNextActions, type CreativeNextAction } from "../model/workspace-intelligence.ts";
import { nextActionFacts } from "../state/next-action-context.ts";
import { renderLifecycleNextActionCards } from "./next-action-cards.ts";
import { openCreativeNextActionDestination } from "./creative-next-action-navigation.ts";
import { FormaElement } from "./forma-element.ts";
import { captureOutputNavigationFocus } from "./output-navigation-focus.ts";
import type { AssistantDisplayedMessage, AssistantDisplayedProposal, AssistantDisplayedTask, AssistantSpecialistControl, AssistantSpecialistReview, AssistantSpecialistResponse, AssistantTurnOriginalRequest, FormaAssistantPanel } from "./design-system/assistant-panel.ts";
import { assistantApprovedRequestCanRun, assistantApprovedRequestCanStop } from "./design-system/assistant-panel.ts";
import { personalMemoryMessage } from "./design-system/locales/personal-memory-messages.ts";
import { parseMemoryAnswerPresentation, type MemoryAnswerPresentation } from "../model/memory-answer.ts";
import { createMemoryElapsed } from "../model/memory-lifetime.ts";
import type { FormaPersonalMemory } from "./forma-personal-memory.ts";
import "./forma-personal-memory.ts";

type AssistantServerTurn = {
  id: string;
  user: string;
  reply: { key?: string; values?: Record<string, string | number>; text?: string };
  proposal: AssistantDisplayedProposal | null;
  proposals?: AssistantDisplayedProposal[];
  originalRequest?: AssistantTurnOriginalRequest;
  memory?: unknown;
};

type AssistantGuidanceRequest = {
  turnId: string; message: string; locale: string; url: string; scope: string; status: "sending" | "uncertain"; sourceRetired?: true;
  memoryMode?: "recall"; memoryEpoch?: number; memoryContext?: string; controller?: AbortController;
};
type MemoryAnswerLease = {
  presentation: MemoryAnswerPresentation; context: string; epoch: number; source: CapturedSourceOwnership | null;
  elapsed: ReturnType<typeof createMemoryElapsed>; remainingMs: number; controller: AbortController;
};

/**
 * Private, page-aware conversational assistant.
 * Ask about the current page, selected work, recent authorized activity, and reviewable next steps without leaving the page.
 */
export class FormaCreativeAssistant extends FormaElement {
  #open = false;
  #memoryOpen = false;
  #memoryScope = "";
  #memoryPresentation = 0;
  #memoryRecallActive = false;
  #memoryRecallEpoch = 0;
  #memoryRecallNotice = "";
  #memoryAnswerTimer = 0;
  #memoryAnswers = new Map<string, MemoryAnswerLease>();
  #memoryMarked = new Set<string>();
  #memoryRetired = new Set<string>();
  #memoryFocus = () => { this.#pruneMemoryAnswers(); this.requestUpdate(); };
  #memoryDisconnect?: () => void;
  #memoryInvalidated = () => { this.#closeMemory(); this.requestUpdate(); };
  #memoryVisibility = () => {
    if (document.visibilityState !== "visible") this.#closeMemory();
    this.requestUpdate();
  };
  #nextNavigation = 0;
  #context: AssistantContext | null = null;
  #contextUnavailable = false;
  #messages: AssistantDisplayedMessage[] = [];
  #localToolMessages: AssistantDisplayedMessage[] = [];
  #proposals: AssistantDisplayedProposal[] = [];
  #tasks: AssistantDisplayedTask[] = [];
  #pending = new Set<string>();
  #activeTasks = new Set<string>();
  #taskTimer = 0;
  #loadedScope = "";
  #turns: AssistantServerTurn[] = [];
  #readRevision = 0;
  #reviewRevision = 0;
  #retentionVersions = new Map<string, number>();
  // Request-order clock: a deliberate read gets a position at dispatch, but
  // only its accepted exact response can certify private presentation.
  #withdrawalRevision = 0;
  #guidance: AssistantGuidanceRequest | null = null;
  #specialist: AssistantSpecialistReview | null = null;
  #specialistUrl = "";
  #sourceProject: { source: CapturedSourceOwnership; projectId: string } | null = null;
  #sourceRetired = (event: Event) => {
    const detail = (event as CustomEvent<{ source: CapturedSourceOwnership; generation: number; status: number }>).detail;
    const source = this.store.captureSourceOwnership();
    if (!detail || ![401, 403, 404].includes(detail.status) || !source || source.generation !== detail.generation
      || !this.store.sourceOwnershipScopeActive(detail.source) || this.store.sourceOwnershipActive(source)) return;
    this.#closeMemory();
    // The original request owners survive; no private conversation or saved proposal does.
    const active = this.#specialist, retainedTasks = this.#tasks;
    if (active) this.#rememberSpecialistExecution(active);
    this.#tasks = this.#tasks.map(task => this.#taskReference(retainedTasks.find(previous => previous.id === task.id
      && previous.executionId === task.executionId && previous.bindingHash === task.bindingHash) ?? task));
    this.#readRevision += 1; this.#reviewRevision += 1;
    this.#retentionVersions.set("withdrawal:scope", ++this.#withdrawalRevision);
    this.#context = null; this.#turns = []; this.#messages = []; this.#localToolMessages = []; this.#proposals = [];
    if (this.#guidance) this.#guidance = { ...this.#guidance, message: "", sourceRetired: true, status: "uncertain" };
    if (active) this.#specialist = { ...active, quote: null, originalRequest: null, resultReply: null, unusedExecution: false,
      task: this.#tasks.find(task => task.executionId === active.executionId) ?? null, working: false, stopping: false,
      retrievalOnly: true, notice: "unavailable" };
    this.querySelector<FormaAssistantPanel>("forma-assistant-panel")?.clearConversationDrafts();
    this.#activeTasks.clear(); window.clearTimeout(this.#taskTimer); this.#taskTimer = 0;
    this.requestUpdate();
  };

  override connectedCallback() {
    super.connectedCallback();
    window.addEventListener("forma-event-source-retired", this.#sourceRetired);
    for (const name of ["forma-route-changed", "forma-authorization-changed"])
      window.addEventListener(name, this.#memoryInvalidated);
    document.addEventListener("visibilitychange", this.#memoryVisibility);
    window.addEventListener("focus", this.#memoryFocus);
    const unsubscribeMemory = this.store.subscribe(() => {
      if (this.#memoryOpen && (this.#memoryScope !== this.#memoryContext(this.#scope())
        || !this.store.sourceOwnershipActive(this.store.captureSourceOwnership()))) this.#closeMemory();
      this.#pruneMemoryAnswers();
    });
    this.#memoryDisconnect = () => {
      for (const name of ["forma-route-changed", "forma-authorization-changed"])
        window.removeEventListener(name, this.#memoryInvalidated);
      document.removeEventListener("visibilitychange", this.#memoryVisibility);
      window.removeEventListener("focus", this.#memoryFocus);
      unsubscribeMemory();
    };
  }
  override disconnectedCallback() {
    window.removeEventListener("forma-event-source-retired", this.#sourceRetired);
    this.#memoryDisconnect?.(); this.#memoryDisconnect = undefined;
    window.clearTimeout(this.#taskTimer);
    this.#taskTimer = 0;
    this.#clearPrivateState("");
    super.disconnectedCallback();
  }

  #closeMemory() {
    this.#closeMemoryRecall();
    this.#memoryOpen = false;
    this.#memoryScope = "";
    for (const component of this.querySelectorAll<FormaPersonalMemory>("forma-personal-memory")) component.suspendPresentation();
  }

  #memoryContext(scope: string) {
    return JSON.stringify([scope, this.i18n.locale, this.store.captureSourceOwnership()?.generation]);
  }

  #canRecallDocument() {
    const surface = assistantSurfaceForRoute(this.store.route.get()), projection = this.store.projection.get();
    return Boolean(this.isConnected && this.#open && this.#memoryOpen && document.visibilityState === "visible"
      && !this.store.session.get()?.impersonation && surface.documentId && !surface.canvasId
      && surface.documentId === projection.documentId && projection.projectId === this.#projectId()
      && this.store.sourceOwnershipActive(this.store.captureSourceOwnership()));
  }

  #memoryRequestCurrent(request: AssistantGuidanceRequest) {
    return request.memoryMode === "recall" && !request.controller?.signal.aborted && this.#canRecallDocument()
      && this.#memoryRecallActive && request.memoryEpoch === this.#memoryRecallEpoch
      && request.scope === this.#scope() && request.memoryContext === this.#memoryContext(request.scope);
  }

  #stripMemoryContext(turnId: string) {
    if (this.#context?.recentTurns) this.#context = { ...this.#context,
      recentTurns: this.#context.recentTurns.filter(turn => turn.id !== turnId + ":user" && turn.id !== turnId + ":assistant") };
  }

  #retireMemoryTurn(turnId: string) {
    this.#memoryMarked.add(turnId); this.#memoryRetired.add(turnId);
    const lease = this.#memoryAnswers.get(turnId);
    lease?.elapsed.retire(); lease?.controller.abort(); this.#memoryAnswers.delete(turnId);
    this.#pending.delete(turnId);
    if (this.#guidance?.turnId === turnId && this.#guidance.memoryMode === "recall") {
      this.#guidance.controller?.abort(); this.#guidance = null;
    }
    this.#turns = this.#turns.filter(turn => turn.id !== turnId);
    this.#messages = this.#messages.filter(message => message.id !== turnId + ":user" && message.id !== turnId + ":assistant");
    this.#proposals = this.#proposals.filter(proposal => proposal.turnId !== turnId);
    this.#stripMemoryContext(turnId);
    if (!this.#memoryAnswers.size) { window.clearTimeout(this.#memoryAnswerTimer); this.#memoryAnswerTimer = 0; }
  }

  #closeMemoryRecall() {
    this.#memoryRecallActive = false; this.#memoryRecallEpoch++; this.#memoryRecallNotice = "";
    const pending = this.#guidance?.memoryMode === "recall" ? this.#guidance.turnId : null;
    for (const id of new Set([...this.#memoryAnswers.keys(), ...(pending ? [pending] : [])])) this.#retireMemoryTurn(id);
    window.clearTimeout(this.#memoryAnswerTimer); this.#memoryAnswerTimer = 0;
  }

  #memoryRemaining(lease: MemoryAnswerLease) {
    const wall = Date.now();
    return Math.max(0, Math.min(Date.parse(lease.presentation.validUntil) - wall,
      lease.remainingMs - lease.elapsed.elapsed({ wall, monotonic: performance.now() })));
  }

  #pruneMemoryAnswers() {
    let retired = false;
    for (const [id, lease] of this.#memoryAnswers) {
      if (this.#canRecallDocument() && this.#memoryRecallActive && lease.epoch === this.#memoryRecallEpoch
        && lease.context === this.#memoryContext(this.#scope()) && this.store.sourceOwnershipActive(lease.source)
        && this.#memoryRemaining(lease) > 0) continue;
      this.#retireMemoryTurn(id); retired = true;
    }
    if (retired) this.#memoryRecallNotice = "assistantRecallExpired";
  }

  #scheduleMemoryDeadline() {
    window.clearTimeout(this.#memoryAnswerTimer); this.#memoryAnswerTimer = 0;
    if (!this.#memoryAnswers.size) return;
    const remaining = Math.min(...[...this.#memoryAnswers.values()].map(lease => this.#memoryRemaining(lease)));
    this.#memoryAnswerTimer = window.setTimeout(() => {
      this.#memoryAnswerTimer = 0; this.#pruneMemoryAnswers(); this.requestUpdate(); this.#scheduleMemoryDeadline();
    }, Math.max(1, remaining));
  }

  #renderMemoryRecall(scope: string) {
    const available = this.#canRecallDocument();
    if (!available) return html`<p>${personalMemoryMessage(this.i18n.locale, "memory.live.assistantRecallDocument")}</p>`;
    const memoryContext = this.#memoryContext(scope);
    const busy = Boolean(this.#guidance || this.#pending.size || this.#specialist
      || this.querySelector<FormaAssistantPanel>("forma-assistant-panel")?.navigationBlocked);
    const lease = this.#memoryAnswers.values().next().value;
    const status = this.#guidance?.memoryMode === "recall"
      ? this.#guidance.status === "sending" ? "assistantRecallWorking" : "assistantRecallUncertain"
      : this.#memoryRecallNotice;
    return html`<section>
      <button type="button" data-assistant-memory-recall ?disabled=${busy} @click=${(event: Event) => {
      const button = event.currentTarget as HTMLButtonElement;
      if (!button.isConnected || button.closest("forma-creative-assistant") !== this || button.matches(":disabled")
        || !this.#canRecallDocument() || scope !== this.#scope() || memoryContext !== this.#memoryContext(scope)
        || this.#guidance || this.#pending.size || this.#specialist
        || this.querySelector<FormaAssistantPanel>("forma-assistant-panel")?.navigationBlocked) return;
      this.#closeMemoryRecall();
      this.#memoryRecallActive = true; this.#memoryRecallEpoch++; this.#memoryRecallNotice = "";
      void this.#send({ message: personalMemoryMessage(this.i18n.locale, "memory.live.assistantRecallPrompt"), memoryMode: "recall" });
    }}>${personalMemoryMessage(this.i18n.locale, "memory.live.assistantRecall")}</button>
      <p>${personalMemoryMessage(this.i18n.locale, "memory.live.assistantRecallHelp")}</p>
      ${status ? html`<p role="status">${personalMemoryMessage(this.i18n.locale, "memory.live." + status)}</p>` : nothing}
      ${lease ? html`<p role="status">${personalMemoryMessage(this.i18n.locale, "memory.live.assistantRecallReady",
        { until: "\u2068" + this.i18n.date(new Date(lease.presentation.validUntil), { timeStyle: "medium" }) + "\u2069" })}</p>` : nothing}
    </section>`;
  }

  #renderMemory(scope: string) {
    if (!this.#open || document.visibilityState !== "visible" || this.store.session.get()?.impersonation
      || !this.store.sourceOwnershipActive(this.store.captureSourceOwnership())) {
      this.#closeMemory();
      return nothing;
    }
    const memoryScope = this.#memoryContext(scope);
    if (this.#memoryOpen && this.#memoryScope !== memoryScope) this.#closeMemory();
    return html`<details class="personal-memory-disclosure" data-assistant-memory lang=${this.i18n.locale} dir=${this.i18n.direction}
      .open=${this.#memoryOpen} @toggle=${(event: Event) => {
        const disclosure = event.currentTarget as HTMLDetailsElement;
        const current = this.isConnected && this.#open && disclosure.isConnected
          && disclosure.closest("forma-creative-assistant") === this && document.visibilityState === "visible"
          && scope === this.#scope() && memoryScope === this.#memoryContext(scope)
          && !this.store.session.get()?.impersonation && this.store.sourceOwnershipActive(this.store.captureSourceOwnership());
        if (!current || !disclosure.open) {
          this.#closeMemory(); disclosure.open = false; this.requestUpdate(); return;
        }
        if (!this.#memoryOpen) this.#memoryPresentation++;
        this.#memoryOpen = true; this.#memoryScope = memoryScope; this.requestUpdate();
      }}>
      <summary>${personalMemoryMessage(this.i18n.locale, "memory.live.heading")}</summary>
      ${this.#memoryOpen ? html`${this.#renderMemoryRecall(scope)}${keyed(this.#memoryPresentation, html`<forma-personal-memory></forma-personal-memory>`)}` : nothing}
    </details>`;
  }

  #refreshActiveTasks() {
    window.clearTimeout(this.#taskTimer);
    if (!this.#open || !this.#activeTasks.size || !this.store.sourceOwnershipActive(this.store.captureSourceOwnership())) return;
    this.#taskTimer = window.setTimeout(() => {
      this.#taskTimer = 0;
      if (!this.#open) return;
      if (this.#pending.size) this.#refreshActiveTasks();
      else void this.#load();
    }, 750);
  }

  #projectId() {
    const context = this.store.session.get()?.projectContext;
    if (context) return context.projectId;
    const source = this.store.captureSourceOwnership();
    return !this.store.sourceOwnershipActive(source) && this.#sourceProject
      && this.store.sourceOwnershipScopeActive(this.#sourceProject.source)
      ? this.#sourceProject.projectId : this.store.projection.get().projectId;
  }

  #scope(route=this.store.route.get()) {
    const session = this.store.session.get();
    return JSON.stringify([
      this.store.captureAuthorizationScope()?.key ?? "",
      session?.impersonation?.impersonationId ?? "",
      this.#projectId(),
      session?.projectContext?.expiresAt ?? "",
      session?.projectContext?.permissions ?? session?.capabilities ?? [],
      session?.policy.accepted ?? false, session?.policy.version ?? "",
      session?.assistant?.enabled ?? false, session?.assistant?.capabilities ?? [],
      route, this.#selection().sort(),
    ]);
  }

  #clearPrivateState(scope: string) {
    this.#closeMemory();
    if (scope !== this.#loadedScope) { this.#memoryMarked.clear(); this.#memoryRetired.clear(); }
    this.querySelector<FormaAssistantPanel>("forma-assistant-panel")?.clearConversationDrafts();
    this.#loadedScope = scope;
    this.#readRevision += 1;
    this.#reviewRevision += 1;
    this.#retentionVersions.clear();
    this.#retentionVersions.set("withdrawal:scope", ++this.#withdrawalRevision);
    this.#context = null;
    this.#contextUnavailable = false;
    this.#turns = [];
    this.#messages = [];
    this.#localToolMessages = [];
    this.#proposals = [];
    this.#tasks = [];
    this.#guidance = null;
    this.#specialist = null;
    this.#specialistUrl = "";
    this.#sourceProject = null;
    this.#pending.clear();
    this.#activeTasks.clear();
    window.clearTimeout(this.#taskTimer);
    this.#taskTimer = 0;
  }

  #synchronizeScope() {
    const scope = this.#scope();
    if (this.#loadedScope !== scope) this.#clearPrivateState(scope);
    const source = this.store.captureSourceOwnership();
    if (source && this.store.sourceOwnershipActive(source)) this.#sourceProject = { source, projectId: this.#projectId() };
    return scope;
  }

  #canAuthor() {
    const session = this.store.session.get();
    return Boolean(session && this.store.sourceOwnershipActive(this.store.captureSourceOwnership()) && (session.projectContext?.permissions ?? session.capabilities ?? []).includes("project.author"));
  }

  #canSpecialist(turnId?: string) {
    if (turnId && this.#memoryMarked.has(turnId)) return false;
    const session = this.store.session.get();
    const permissions = session?.projectContext?.permissions ?? session?.capabilities ?? [];
    const surface = assistantSurfaceForRoute(this.store.route.get());
    const canRequest = Boolean(session?.assistant?.enabled && session.policy.accepted
      && this.#canAuthor() && permissions.includes("project.output.request")
      && surface.host === "creator" && surface.available);
    if (!canRequest || !turnId) return canRequest;
    const original = this.#turns.find((turn) => turn.id === turnId)?.originalRequest;
    const projectId = this.#projectId();
    if (!original || original.schema !== 1 || original.turnId !== turnId || original.projectId !== projectId) return false;
    const saved = assistantSurfaceForRoute(original.route);
    if (saved.documentId !== original.documentId || saved.canvasId !== original.canvasId) return false;
    if (surface.documentId) return saved.documentId === surface.documentId && !saved.canvasId;
    return Boolean(surface.canvasId && saved.canvasId === surface.canvasId && original.selectedItemIds.length
      && this.store.canvasPlanningDocumentId(original.selectedItemIds));
  }

  #selection() {
    const surface = assistantSurfaceForRoute(this.store.route.get());
    if (surface.application !== "canvas" || !surface.canvasId) return [];
    return [...document.querySelectorAll<HTMLElement>(".canvas-item.selected[data-canvas-item-id]")]
      .map((element) => element.dataset.canvasItemId ?? "")
      .filter(Boolean)
      .slice(0, 8);
  }

  #url() {
    const url = new URL("/api/assistant", location.origin);
    url.searchParams.set("route", this.store.route.get());
    const projectId = this.#projectId();
    if (projectId) url.searchParams.set("projectId", projectId);
    for (const item of this.#selection()) url.searchParams.append("selected", item);
    return url;
  }

  #refreshTranscript() {
    this.#pruneMemoryAnswers();
    this.#messages = this.#turns.filter(turn => !this.#memoryMarked.has(turn.id) || this.#memoryAnswers.has(turn.id)).flatMap((turn) => [
      { id: turn.id + ":user", role: "user" as const, text: turn.user },
      { id: turn.id + ":assistant", role: "assistant" as const,
        key: this.#memoryMarked.has(turn.id) ? undefined : turn.reply.key,
        values: this.#memoryMarked.has(turn.id) ? undefined : turn.reply.values,
        text: this.#memoryMarked.has(turn.id)
          ? personalMemoryMessage(this.i18n.locale, "memory.live.assistantRecallHistorical") + "\n\n" + turn.reply.text : turn.reply.text,
        savedTurnId: turn.id, canReviewSpecialist: this.#canSpecialist(turn.id) },
    ]);
    if (this.#guidance && !this.#turns.some((turn) => turn.id === this.#guidance?.turnId)) {
      this.#messages.push({ id: this.#guidance.turnId + ":user", role: "user", text: this.#guidance.message });
    }
    this.#messages.push(...this.#localToolMessages);
    if (this.#contextUnavailable) this.#messages.push({ id: "load:unavailable", role: "assistant", key: "assistant.unavailable" });
    this.#proposals = [...new Map(this.#turns.filter(turn => !this.#memoryMarked.has(turn.id)).flatMap((turn) =>
      (turn.proposals ?? (turn.proposal ? [turn.proposal] : [])).filter((proposal) => proposal.turnId === turn.id)
    ).map((proposal) => [proposal.id, proposal])).values()];
  }

  #mergeTurn(turn: AssistantServerTurn, memoryRequest?: AssistantGuidanceRequest) {
    if (!turn || typeof turn.id !== "string" || typeof turn.user !== "string" || !turn.reply) return false;
    if (Object.hasOwn(turn, "memory") || this.#memoryMarked.has(turn.id)) {
      this.#memoryMarked.add(turn.id); this.#stripMemoryContext(turn.id);
      const now = Date.now(), presentation = parseMemoryAnswerPresentation(turn.memory, now);
      if (!memoryRequest) {
        // Unsolicited history never opens memory. A later GET cannot extend the
        // original displayed lease, and malformed/downgraded copies retire it.
        if (!presentation || !this.#memoryAnswers.has(turn.id)) this.#retireMemoryTurn(turn.id);
        return false;
      }
      if (!presentation || this.#memoryRetired.has(turn.id) || memoryRequest.memoryMode !== "recall"
        || this.#guidance !== memoryRequest || memoryRequest.turnId !== turn.id || memoryRequest.message !== turn.user
        || !this.#memoryRequestCurrent(memoryRequest) || typeof turn.reply.text !== "string"
        || turn.proposal !== null || Boolean(turn.proposals?.length) || turn.originalRequest !== undefined) {
        this.#retireMemoryTurn(turn.id); this.#memoryRecallNotice = "assistantRecallUnavailable"; return false;
      }
      this.#memoryAnswers.set(turn.id, { presentation, context: memoryRequest.memoryContext!, epoch: memoryRequest.memoryEpoch!,
        source: this.store.captureSourceOwnership(), controller: memoryRequest.controller!,
        elapsed: createMemoryElapsed({ wall: now, monotonic: performance.now() }), remainingMs: Date.parse(presentation.validUntil) - now });
      this.#scheduleMemoryDeadline();
      turn = { id: turn.id, user: turn.user, reply: { text: turn.reply.text }, proposal: null, memory: presentation };
    } else if (memoryRequest?.memoryMode === "recall") {
      this.#retireMemoryTurn(memoryRequest.turnId); this.#memoryRecallNotice = "assistantRecallUnavailable"; return false;
    }
    const previous = this.#turns.findIndex((item) => item.id === turn.id);
    if (previous < 0) this.#turns = [...this.#turns, turn];
    else this.#turns = this.#turns.map((item, index) => index === previous ? turn : item);
    if (this.#guidance?.turnId === turn.id && (this.#guidance.sourceRetired || this.#guidance.message === turn.user)) {
      if (this.#guidance.memoryMode !== "recall")
        this.querySelector<FormaAssistantPanel>("forma-assistant-panel")?.resolveGuidanceRequest(true, this.#guidance.message);
      this.#guidance = null;
    }
    this.#refreshTranscript();
    return true;
  }

  #taskReference(task: AssistantDisplayedTask): AssistantDisplayedTask {
    const status = ["queued", "running", "reconciling", "completed", "partial", "canceled", "failed", "needs-review", "reconciled"].includes(task.status) ? task.status : "recovery";
    const submission = ["not-submitted", "submitting", "uncertain", "usage-recorded", "settled"].includes(task.submission ?? "") ? task.submission : undefined;
    return { id: task.id, turnId: task.turnId, executionId: task.executionId, bindingHash: task.bindingHash, status,
      recoveryOnly: true, canExecute: false, ...(submission ? { submission } : {}),
      ...(typeof task.estimatedMicrousd === "number" && Number.isSafeInteger(task.estimatedMicrousd) && task.estimatedMicrousd >= 0 ? { estimatedMicrousd: task.estimatedMicrousd } : {}) };
  }

  #mergeTask(task: AssistantDisplayedTask) {
    this.#tasks = [task, ...this.#tasks.filter((item) => item.id !== task.id
      && (!task.executionId || item.executionId !== task.executionId))];
    this.#activeTasks = new Set(this.#tasks.filter((item) =>
      item.status === "queued" || item.status === "running" || item.status === "reconciling").map((item) => item.id));
  }

  #sameSpecialistLifecycle(previous: AssistantDisplayedTask | null, next: AssistantDisplayedTask) {
    // A repeatedly listed terminal row is not new lifecycle or accounting
    // evidence. It must not cancel the exact read fetching its missing contract.
    return Boolean(previous && JSON.stringify([previous.id, previous.turnId, previous.executionId, previous.bindingHash,
      previous.status, previous.submission ?? null]) === JSON.stringify([next.id, next.turnId, next.executionId,
      next.bindingHash, next.status, next.submission ?? null]));
  }

  #certifiedSpecialistCompletion(task: AssistantDisplayedTask) {
    const review = task.completedReview, quote = review?.quote, original = review?.originalRequest;
    const surface = assistantSurfaceForRoute(this.store.route.get());
    if (task.certifiedCompleted !== true || task.status !== "completed" || this.#retentionUnavailable(task)
      || !review || !quote || !original || !review.result
      || quote.operation !== "assistant-specialist" || quote.blockId !== "" || quote.status !== "completed"
      || quote.canExecute !== false || review.turnId !== task.turnId || review.executionId !== task.executionId
      || quote.executionId !== task.executionId || quote.bindingHash !== task.bindingHash || !quote.bindingHash
      || original.turnId !== task.turnId || original.projectId !== quote.projectId
      || original.documentId !== quote.documentId || original.canvasId !== quote.canvasId
      || original.sourceHash !== quote.sourceHash || !quote.models.includes(original.model) || task.model !== original.model
      || quote.projectId !== this.#url().searchParams.get("projectId")
      || quote.canvasId !== surface.canvasId || surface.documentId && quote.documentId !== surface.documentId
      || review.result.sourceStatus !== "original-approved-source") return null;
    // Never derive paid evidence from a copied chat reply or a completed status.
    return { quote, original, reply: review.result.reply };
  }

  async #load() {
    const scope = this.#synchronizeScope(), source = this.store.captureSourceOwnership();
    if (!this.store.sourceOwnershipActive(source)) return;
    const revision = ++this.#readRevision, withdrawalRevision = this.#withdrawalRevision;
    // Reconcile an unconfirmed Send against its original query, never a newly inferred turn.
    const url = this.#guidance?.url ?? this.#url().href;
    try {
      const response = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
      if (scope !== this.#scope() || !this.#open || !this.store.sourceOwnershipActive(source) || !this.#withdrawalCurrent("", "", withdrawalRevision)) return;
      if (!response.ok) {
        if ([401, 403, 404, 410].includes(response.status)) {
          this.#clearPrivateState(scope);
          this.#messages = [{ id: "load:unavailable", role: "assistant", key: "assistant.unavailable" }];
        }
        throw new Error("assistant_unavailable");
      }
      const payload = await response.json() as { context: AssistantContext; contextUnavailable?: boolean; turns: AssistantServerTurn[]; tasks?: AssistantDisplayedTask[] };
      if (scope !== this.#scope() || !this.#open || !this.store.sourceOwnershipActive(source) || !this.#withdrawalCurrent("", "", withdrawalRevision)) return;
      const canMerge = revision === this.#readRevision;
      const supplied = payload.tasks ?? [];
      // A current negative outranks incidental completion and unproven pending
      // reads. Only newer successful exact evidence can supersede that negative.
      for (const task of supplied) if (task.executionId && this.#retentionUnavailable(task)
        && this.#negativeReadCurrent(task.turnId, task.executionId, withdrawalRevision)) {
        const active = this.#specialist?.turnId === task.turnId ? this.#specialist : null;
        this.#withdrawSpecialist({ id: active?.id ?? "", scope, turnId: task.turnId, executionId: task.executionId,
          quote: null, originalRequest: null, task, working: false, stopping: false, retrievalOnly: true, notice: "unavailable", resultReply: null }, false, withdrawalRevision);
      }
      if (!canMerge) return;
      // Page context has a separate source proof from retained conversation and
      // task receipts. Only a current owned GET can restore this presentation.
      this.#contextUnavailable = payload.contextUnavailable === true;
      this.#context = this.#contextUnavailable || (this.#specialist && this.#privatePresentationHidden(this.#specialist.turnId, this.#specialist.executionId)) ? null : payload.context;
      for (const id of this.#memoryMarked) this.#stripMemoryContext(id);
      this.#pruneMemoryAnswers();
      this.#turns = this.#turns.filter(turn => this.#memoryAnswers.has(turn.id));
      for (const turn of payload.turns) if (this.#withdrawalCurrent(turn.id, "", withdrawalRevision) && !this.#privatePresentationHidden(turn.id))
        this.#mergeTurn(turn, this.#guidance?.memoryMode === "recall" && this.#guidance.turnId === turn.id ? this.#guidance : undefined);
      this.#refreshTranscript();
      const incoming: AssistantDisplayedTask[] = supplied.map((task) => task.executionId
        && (!this.#withdrawalCurrent(task.turnId, task.executionId, withdrawalRevision) || this.#retentionUnavailable(task) || this.#privatePresentationHidden(task.turnId, task.executionId))
        ? { id: task.id, turnId: task.turnId, executionId: task.executionId, bindingHash: task.bindingHash, status: "recovery", recoveryOnly: true }
        : task);
      // A bounded feed is not proof of erasure. Keep only content-free references
      // for omitted existing executions, never a cached response or a guessed new job.
      const omitted = this.#tasks.filter((task) => task.executionId
        && !incoming.some((item) => item.executionId === task.executionId))
        .map(({ id, turnId, executionId, bindingHash }) => ({ id, turnId, executionId, bindingHash, status: "recovery", recoveryOnly: true }));
      this.#tasks = [...incoming, ...omitted];
      const active = this.#specialist;
      const latest = active?.executionId ? incoming.find((task) => task.executionId === active.executionId) : undefined;
      const completed = latest ? this.#certifiedSpecialistCompletion(latest) : null;
      const activeHash = active?.quote?.bindingHash ?? active?.task?.bindingHash;
      if (active && latest && completed && latest.turnId === active.turnId && latest.bindingHash === activeHash) {
        // Consume the terminal certificate synchronously. An older running/failed
        // resume must not restore its receipt after this currently retained result.
        this.#invalidateSpecialistReceipt(active.turnId, active.executionId);
        this.#specialist = { ...active, task: { ...latest, canExecute: false }, quote: completed.quote,
          originalRequest: completed.original, resultReply: completed.reply, working: false, stopping: false,
          retrievalOnly: true, notice: "" };
      } else if (active && latest && !this.#retentionUnavailable(latest) && latest.turnId === active.turnId
        && latest.bindingHash === activeHash && active.quote?.status !== "completed"
        && ["canceled", "failed", "needs-review", "reconciled"].includes(latest.status)
        && !this.#sameSpecialistLifecycle(active.task, latest)) {
        this.#invalidateSpecialistReceipt(active.turnId, active.executionId);
        this.#specialist = { ...active, task: { ...latest, canExecute: false }, working: false, stopping: false,
          quote: active.quote ? { ...active.quote, canExecute: false } : null, retrievalOnly: true, notice: "" };
      } else if (active && latest && !this.#retentionUnavailable(latest) && latest.turnId === active.turnId
        && latest.bindingHash === activeHash && active.quote?.status !== "completed" && (!active.task || latest.status !== active.task.status
          || latest.submission !== active.task.submission)) {
        // A progress row may update eligibility but is not a terminal or privacy
        // receipt. Do not invalidate a live exact read or discard its eventual result.
        this.#specialist = { ...active, task: { ...latest, canExecute: false },
          quote: active.quote ? { ...active.quote, canExecute: false } : null, retrievalOnly: true };
      }
      this.#activeTasks = new Set(this.#tasks.filter((task) => task.status === "queued" || task.status === "running" || task.status === "reconciling").map((task) => task.id));
    } catch {
      if (scope === this.#scope() && this.store.sourceOwnershipActive(source) && revision === this.#readRevision && this.#open) {
        this.#refreshTranscript();
        if (!this.#contextUnavailable) this.#messages.push({ id: "load:unavailable", role: "assistant", key: "assistant.unavailable" });
      }
    } finally {
      if (scope === this.#scope()) { this.requestUpdate(); this.#refreshActiveTasks(); }
    }
  }

  async #send(input: { message: string; memoryMode?: "recall" }) {
    const scope = this.#synchronizeScope();
    if (this.#guidance || !this.#open || !this.store.session.get()?.assistant?.enabled || !this.store.sourceOwnershipActive(this.store.captureSourceOwnership())) return;
    if (input.memoryMode === "recall" && (!this.#canRecallDocument() || !this.#memoryRecallActive)) return;
    this.#guidance = { turnId: crypto.randomUUID(), message: input.message.trim(), locale: this.i18n.locale,
      url: this.#url().href, scope, status: "sending", ...(input.memoryMode === "recall"
        ? { memoryMode: "recall" as const, memoryEpoch: this.#memoryRecallEpoch, memoryContext: this.#memoryContext(scope), controller: new AbortController() } : {}) };
    if (!this.#guidance.message) { this.#guidance = null; return; }
    if (this.#guidance.memoryMode === "recall") this.#memoryMarked.add(this.#guidance.turnId);
    this.#refreshTranscript();
    await this.#deliverGuidance();
  }

  async #deliverGuidance() {
    const request = this.#guidance;
    const source = this.store.captureSourceOwnership();
    if (!request || request.sourceRetired || request.scope !== this.#scope() || this.#pending.has(request.turnId) || !this.store.sourceOwnershipActive(source)) return;
    if (request.memoryMode === "recall" && !this.#memoryRequestCurrent(request)) return;
    const message = request.message;
    this.#pending.add(request.turnId);
    request.status = "sending";
    const revision = ++this.#readRevision, withdrawalRevision = this.#withdrawalRevision;
    this.requestUpdate();
    try {
      const response = await this.store.guardedFetch(request.url, {
        method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, cache: "no-store",
        body: JSON.stringify({ turnId: request.turnId, message: request.message, locale: request.locale,
          ...(request.memoryMode === "recall" ? { memoryMode: request.memoryMode } : {}) }),
        ...(request.controller ? { signal: request.controller.signal } : {}),
      }, this.i18n.t("assistant.send"), request.memoryMode === "recall" ? { current: () => this.#memoryRequestCurrent(request) } : undefined);
      if (request.scope !== this.#scope() || !this.store.sourceOwnershipScopeActive(source)) return;
      if (request.memoryMode === "recall" && !this.#memoryRequestCurrent(request)) return;
      if (!response.ok) {
        if (response.status === 409) {
          const failure = await response.json() as { error?: string; noAutomaticRetry?: boolean; messageNotSaved?: boolean } | null;
          if (request.scope !== this.#scope() || !this.store.sourceOwnershipActive(source)) return;
          if (failure?.error === "assistant_turn_unavailable" && failure.noAutomaticRetry === true) {
            // A GET may already have acknowledged this send. The explicit
            // negative still owns its old turn, never a newer send or draft.
            if (this.#withdrawGuidanceTurn(request.turnId, withdrawalRevision, failure.messageNotSaved === true)) {
              if (request.memoryMode === "recall") this.#memoryRecallNotice = "assistantRecallUnavailable";
              else this.#messages.push({ id: request.turnId + ":unavailable", role: "assistant", key: "assistant.guidance.unavailable" });
            }
            return;
          }
        }
        if (this.#guidance?.turnId !== request.turnId) return;
        if (request.memoryMode === "recall" && response.status >= 400 && response.status < 500) {
          this.#retireMemoryTurn(request.turnId); this.#memoryRecallNotice = "assistantRecallUnavailable"; return;
        }
        if ([401, 403, 404, 410].includes(response.status)) {
          this.#clearPrivateState(request.scope);
          this.#messages = [{ id: "send:unavailable", role: "assistant", key: "assistant.unavailable" }];
        }
        throw new Error("assistant_unavailable");
      }
      const payload = await response.json() as { context: AssistantContext; contextUnavailable?: boolean; turn: AssistantServerTurn; retiredTurnIds?: unknown };
      if (request.scope !== this.#scope() || !this.store.sourceOwnershipScopeActive(source)) return;
      if (request.memoryMode === "recall" && !this.#memoryRequestCurrent(request)) return;
      if (!this.store.sourceOwnershipActive(source)) {
        if (this.#guidance?.turnId === request.turnId && payload.turn?.id === request.turnId && payload.turn.user === message) this.#guidance = null;
        return;
      }
      if (payload.turn?.id !== request.turnId || payload.turn.user !== message) throw new Error("assistant_turn_mismatch");
      const retired = payload.retiredTurnIds ?? [];
      if (!Array.isArray(retired) || retired.length > ASSISTANT_CONTEXT_LIMITS.turns
        || retired.some((id) => typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/u.test(id) || id === request.turnId)
        || new Set(retired).size !== retired.length) throw new Error("assistant_retirement_invalid");
      // Capture before retirement increments the read clock. A certified
      // negative survives an obsolete positive response, but never comes from
      // absence in the bounded context view or an unbound response identity.
      const canMerge = revision === this.#readRevision && this.#withdrawalCurrent(request.turnId, "", withdrawalRevision);
      for (const id of retired) this.#withdrawGuidanceTurn(id, withdrawalRevision);
      if (this.#guidance !== request) return;
      if (!canMerge) {
        request.status = "uncertain";
        if (this.#open && request.memoryMode !== "recall") void this.#load();
        return;
      }
      if (request.memoryMode !== "recall" && Object.hasOwn(payload.turn, "memory")) {
        this.#memoryMarked.add(payload.turn.id); this.#memoryRetired.add(payload.turn.id);
        throw new Error("assistant_memory_mode_mismatch");
      }
      // A retained replay can certify its turn without certifying current page
      // context. Its negative owns only this accepted current response; POST
      // never clears a context denial established by an earlier request.
      if (payload.contextUnavailable === true) this.#contextUnavailable = true;
      this.#context = this.#contextUnavailable ? null : payload.context;
      for (const id of this.#memoryMarked) this.#stripMemoryContext(id);
      this.#mergeTurn(payload.turn, request.memoryMode === "recall" ? request : undefined);
    } catch {
      if (request.scope === this.#scope() && this.store.sourceOwnershipActive(source) && this.#guidance === request) {
        request.status = "uncertain";
        if (request.memoryMode !== "recall")
          this.querySelector<FormaAssistantPanel>("forma-assistant-panel")?.resolveGuidanceRequest(false, request.message);
      }
    } finally {
      this.#pending.delete(request.turnId);
      if (request.scope === this.#scope()) { this.requestUpdate(); this.#refreshActiveTasks(); }
    }
  }

  #withdrawGuidanceTurn(turnId: string, denialRevision: number, preserveDraft = false) {
    const active = this.#specialist?.turnId === turnId ? this.#specialist : null;
    const tasks = this.#tasks.filter((task) => task.turnId === turnId);
    const executions = new Set([active?.executionId ?? "", ...tasks.map((task) => task.executionId ?? "")]);
    if ([...executions].some((id) => !this.#negativeReadCurrent(turnId, id, denialRevision))) return false;
    if (this.#memoryMarked.has(turnId)) this.#retireMemoryTurn(turnId);
    if (this.#guidance?.turnId === turnId) {
      // An explicit unsaved receipt ends delivery without discarding the user's
      // draft. Persisted or uncertain-retention withdrawals still clear only
      // the matching draft, never a different mode or newer unfinished work.
      // Empty recovery text also respects an intentional edit to an empty draft.
      if (this.#guidance.memoryMode !== "recall")
        this.querySelector<FormaAssistantPanel>("forma-assistant-panel")?.resolveGuidanceRequest(!preserveDraft, preserveDraft ? "" : this.#guidance.message);
      this.#guidance = null;
    }
    if (active) this.#withdrawSpecialist(active, false, denialRevision);
    else {
      this.#retentionVersions.set("withdrawal:turn:" + turnId, ++this.#withdrawalRevision);
      this.#readRevision += 1;
      this.#invalidateSpecialistReceipt(turnId, "");
    }
    this.#tasks = this.#tasks.map((task) => task.turnId === turnId ? this.#taskReference(task) : task);
    this.#turns = this.#turns.filter((turn) => turn.id !== turnId);
    if (this.#context?.recentTurns) this.#context = { ...this.#context,
      recentTurns: this.#context.recentTurns.filter((turn) => turn.id !== turnId + ":user" && turn.id !== turnId + ":assistant") };
    this.#refreshTranscript();
    return true;
  }

  #rememberSpecialistExecution(state: AssistantSpecialistReview) {
    if (!state.executionId || state.scope !== this.#scope()) return;
    const previous = state.task ?? this.#tasks.find((task) => task.executionId === state.executionId);
    // This row is a reference to retained consent, not a claimed queued task.
    const reference: AssistantDisplayedTask = {
      id: previous?.id ?? state.executionId, turnId: state.turnId, executionId: state.executionId,
      bindingHash: state.quote?.bindingHash ?? previous?.bindingHash,
      status: "recovery", recoveryOnly: true,
    };
    this.#mergeTask(reference);
  }

  #retentionVersion(turnId: string, executionId: string) {
    return [this.#retentionVersions.get("turn:" + turnId) ?? 0, this.#retentionVersions.get("execution:" + executionId) ?? 0].join(":");
  }

  #withdrawalCurrent(turnId: string, executionId: string, revision: number) {
    return Math.max(this.#retentionVersions.get("withdrawal:scope") ?? 0,
      turnId ? this.#retentionVersions.get("withdrawal:turn:" + turnId) ?? 0 : 0,
      executionId ? this.#retentionVersions.get("withdrawal:execution:" + executionId) ?? 0 : 0) <= revision;
  }

  #negativeReadCurrent(turnId: string, executionId: string, revision: number) {
    return this.#withdrawalCurrent(turnId, executionId, revision)
      && (this.#retentionVersions.get("certified-read:" + JSON.stringify([turnId, executionId])) ?? 0) <= revision;
  }

  #privatePresentationHidden(turnId: string, executionId = "") {
    const prefix = "hidden-read:" + JSON.stringify(executionId ? [turnId, executionId] : [turnId]);
    return executionId ? this.#retentionVersions.has(prefix)
      : [...this.#retentionVersions.keys()].some((key) => key.startsWith(prefix.slice(0, -1) + ","));
  }

  #certifyPrivateRead(turnId: string, executionId: string, revision: number) {
    const key = JSON.stringify([turnId, executionId]);
    this.#retentionVersions.set("certified-read:" + key, Math.max(revision, this.#retentionVersions.get("certified-read:" + key) ?? 0));
    if ((this.#retentionVersions.get("hidden-read:" + key) ?? 0) <= revision) this.#retentionVersions.delete("hidden-read:" + key);
  }

  #retentionUnavailable(value: { retentionUnavailable?: boolean; retainedResultUnavailable?: boolean; recoveryError?: string; error?: string | null }) {
    return value.retentionUnavailable === true || value.retainedResultUnavailable === true
      || value.recoveryError === "assistant_result_unavailable"
      || ["assistant_execution_unavailable", "assistant_existing_task_unavailable", "assistant_read_scope_denied"].includes(value.error ?? "");
  }

  #invalidateSpecialistReceipt(turnId: string, executionId: string) {
    for (const key of ["turn:" + turnId, "execution:" + executionId]) {
      this.#retentionVersions.set(key, (this.#retentionVersions.get(key) ?? 0) + 1);
    }
    if (this.#specialist && (this.#specialist.turnId === turnId || this.#specialist.executionId === executionId)) this.#reviewRevision += 1;
  }

  #withdrawSpecialist(state: AssistantSpecialistReview, readScopeDenied = false, denialRevision = this.#withdrawalRevision) {
    const active = this.#specialist, key = JSON.stringify([state.turnId, state.executionId]);
    const pendingRead = this.#retentionVersions.get("pending-read:" + key) ?? 0;
    const preservePending = Boolean(active && active.id === state.id && active.turnId === state.turnId
      && active.executionId === state.executionId && pendingRead > denialRevision);
    const withdrawal = ++this.#withdrawalRevision, boundary = preservePending ? pendingRead : withdrawal;
    if (state.turnId) this.#retentionVersions.set("withdrawal:turn:" + state.turnId, boundary);
    if (state.executionId) this.#retentionVersions.set("withdrawal:execution:" + state.executionId, boundary);
    if (preservePending) this.#retentionVersions.set("hidden-read:" + key, pendingRead);
    this.#readRevision += 1;
    // Hide cached bytes immediately, but do not invalidate the newer request
    // whose own exact response is still needed to establish fresh authority.
    if (!preservePending) this.#invalidateSpecialistReceipt(state.turnId, state.executionId);
    this.#rememberSpecialistExecution(preservePending ? active! : state);
    this.#turns = this.#turns.filter((turn) => turn.id !== state.turnId);
    this.#refreshTranscript();
    if (active && (active.turnId === state.turnId || active.executionId && active.executionId === state.executionId)) {
      // A current withdrawal invalidates older requests. An older denial can
      // hide private presentation while a genuinely newer exact read continues.
      if (readScopeDenied) {
        this.#context = null;
        if (!preservePending) this.querySelector<FormaAssistantPanel>("forma-assistant-panel")?.clearConversationDrafts();
      }
      this.#specialist = { ...active, executionId: state.executionId || active.executionId,
        quote: null, originalRequest: null, resultReply: null, unusedExecution: false,
        task: this.#tasks.find((task) => task.executionId === state.executionId) ?? null,
        working: preservePending, stopping: false, retrievalOnly: true, notice: "unavailable" };
    }
  }

  #closeSpecialist(expectedReviewId?: string) {
    if (!this.#specialist || expectedReviewId && this.#specialist.id !== expectedReviewId) return;
    if (this.#specialist && (this.#specialist.retrievalOnly || this.#specialist.task)) this.#rememberSpecialistExecution(this.#specialist);
    this.#reviewRevision += 1;
    this.#specialist = null;
    this.#specialistUrl = "";
    this.requestUpdate();
    // Existing tasks/turns are the recovery index. Closing is never cancellation.
    if (this.#open) void this.#load();
  }

  async #reviewSpecialist(detail: { turnId: string; task?: AssistantDisplayedTask }) {
    const scope = this.#synchronizeScope();
    if (!this.#open || this.#specialist?.working || this.#memoryMarked.has(detail.turnId)) return;
    const task = detail.task && this.#tasks.find((item) => item.id === detail.task?.id
      && item.turnId === detail.turnId && item.executionId === detail.task.executionId);
    if (detail.task ? !task?.executionId : !this.#canSpecialist(detail.turnId)) return;
    const existing = task ?? this.#tasks.find((item) => item.turnId === detail.turnId && item.executionId);
    const url = this.#url(); url.pathname = "/api/assistant/specialist";
    const savedScope = this.#turns.find((turn) => turn.id === detail.turnId)?.originalRequest;
    const savedSurface = savedScope ? assistantSurfaceForRoute(savedScope.route) : null;
    const currentSurface = assistantSurfaceForRoute(this.store.route.get());
    if (savedScope?.schema === 1 && savedScope.turnId === detail.turnId
      && savedScope.projectId === url.searchParams.get("projectId")
      && savedSurface?.host === "creator" && savedSurface.available
      && (currentSurface.documentId && savedSurface.documentId === currentSurface.documentId
        || currentSurface.canvasId && savedSurface.canvasId === currentSurface.canvasId)) {
      url.searchParams.set("route", savedScope.route);
      url.searchParams.delete("selected");
      for (const id of savedScope.selectedItemIds) url.searchParams.append("selected", id);
    }
    this.#specialistUrl = url.href;
    this.#specialist = { id: crypto.randomUUID(), scope, turnId: detail.turnId, executionId: existing?.executionId ?? "",
      task: existing ?? null, quote: null, originalRequest: null, working: false, stopping: false, retrievalOnly: Boolean(existing),
      notice: "", resultReply: null };
    this.requestUpdate();
    await this.#requestSpecialist(existing ? "resume" : "quote");
  }

  async #requestSpecialist(action: "quote" | "execute" | "retrieve" | "resume" | "stop", model?: string) {
    const state = this.#specialist, source = this.store.captureSourceOwnership();
    if (!state || state.working || this.#memoryMarked.has(state.turnId) || state.scope !== this.#scope() || !this.store.sourceOwnershipScopeActive(source)) return;
    if (["quote", "execute", "stop"].includes(action) && !this.store.sourceOwnershipActive(source)) return;
    const refreshUnused = action === "quote" && !state.notice && state.retrievalOnly && state.unusedExecution === true
      && state.quote?.status === "quoted" && state.quote.canExecute === false && state.originalRequest
      && (!state.task || state.task.recoveryOnly) && !state.resultReply
      && state.quote.executionId === state.executionId && state.originalRequest.turnId === state.turnId
      && state.originalRequest.projectId === state.quote.projectId && state.originalRequest.documentId === state.quote.documentId
      && state.originalRequest.canvasId === state.quote.canvasId && state.originalRequest.sourceHash === state.quote.sourceHash
      && state.quote.models.includes(state.originalRequest.model);
    if (action === "quote") {
      if (state.retrievalOnly && !refreshUnused) return;
      // A refresh is a separate free preview of the same saved request, never an
      // approval unlock or permission to select a different model silently.
      if (refreshUnused) {
        if (model && model !== state.originalRequest!.model) return;
        model = state.originalRequest!.model;
      }
      // The exact unused certificate permits a free original-model inspection,
      // not enrollment in that model or approval of any later paid request.
      if (!this.#canSpecialist() || !refreshUnused && model && !this.store.session.get()?.assistant?.models?.some((item) => item.id === model)) return;
    }
    if (action === "stop" && !assistantApprovedRequestCanStop(state, this.#canSpecialist())) return;
    if (action === "execute") {
      if (!state.quote || !this.#canSpecialist()) return;
      const continuingApproved = assistantApprovedRequestCanRun(state, this.#canSpecialist());
      if (!continuingApproved) {
        if (state.retrievalOnly) return;
        const allowed = contextConsentAction(state.quote.status, state.quote.providerAvailable, state.quote.canExecute === true);
        if (allowed.disabled || allowed.action !== "execute" || Date.parse(state.quote.expiresAt) <= Date.now()) return;
      }
    }
    if (action !== "quote" && !state.executionId) return;
    const revision = ++this.#reviewRevision, endpoint = new URL(this.#specialistUrl);
    if (action === "stop" || refreshUnused) {
      if (action === "stop") endpoint.pathname = `/api/assistant/tasks/${encodeURIComponent(state.executionId)}/cancel`;
      endpoint.searchParams.set("route", state.originalRequest!.route);
      endpoint.searchParams.set("projectId", state.originalRequest!.projectId);
      endpoint.searchParams.delete("selected");
      for (const id of state.originalRequest!.selectedItemIds) endpoint.searchParams.append("selected", id);
    }
    const url = endpoint.href;
    const approvedHash = state.quote?.bindingHash ?? state.task?.bindingHash;
    if ((action === "execute" || action === "retrieve") && !approvedHash) return;
    const exactRead = action === "resume" || action === "retrieve";
    const readKey = JSON.stringify([state.turnId, state.executionId]);
    if (exactRead) {
      // Pending work is not proof. Keep its start order separately so an older
      // denial can hide private bytes without cancelling this fresh lookup.
      this.#retentionVersions.set("pending-read:" + readKey, ++this.#withdrawalRevision);
      this.#readRevision += 1;
    } else this.#retentionVersions.delete("pending-read:" + readKey);
    const retentionVersion = this.#retentionVersion(state.turnId, state.executionId), withdrawalRevision = this.#withdrawalRevision;
    const body = action === "stop" ? undefined : { action, turnId: state.turnId,
      ...(action === "quote" ? model ? { model } : {} : { executionId: state.executionId }),
      ...(action === "execute" || action === "retrieve" ? { approvedBindingHash: approvedHash } : {}) };
    if (action === "execute" || refreshUnused) this.#rememberSpecialistExecution(state);
    this.#specialist = { ...state, working: true, stopping: action === "stop", notice: "",
      ...(action === "quote" ? { quote: null, originalRequest: null,
        executionId: refreshUnused ? state.executionId : "",
        task: refreshUnused ? this.#tasks.find((task) => task.executionId === state.executionId) ?? null : null,
        selectedModel: model, unusedExecution: false } : {}),
      ...(action !== "quote" ? { retrievalOnly: true } : {}) };
    this.requestUpdate();
    const receiptScope = () => state.scope === this.#scope() && this.#specialist?.id === state.id
      && !this.#memoryMarked.has(state.turnId) && this.store.sourceOwnershipScopeActive(source);
    const readable = () => receiptScope() && this.#withdrawalCurrent(state.turnId, state.executionId, withdrawalRevision);
    const current = () => readable() && this.store.sourceOwnershipActive(source) && (revision === this.#reviewRevision
      && retentionVersion === this.#retentionVersion(state.turnId, state.executionId)
      || exactRead && this.#retentionVersions.get("pending-read:" + readKey) === withdrawalRevision
        && this.#privatePresentationHidden(state.turnId, state.executionId));
    try {
      const response = await this.store.guardedFetch(url, { method: "POST", headers: { accept: "application/json",
        ...(action === "stop" ? {} : { "content-type": "application/json" }) },
        cache: "no-store", ...(body ? { body: JSON.stringify(body) } : {}) }, this.i18n.t(action === "stop" ? "assistant.specialist.stop"
          : action === "execute" ? "assistant.specialist.approve" : action === "quote" ? "assistant.specialist.review" : "assistant.specialist.retrieve"));
      if (!receiptScope() || !readable() && this.store.sourceOwnershipActive(source)) { if (state.scope === this.#scope() && this.store.sourceOwnershipActive(source) && this.#open && (action === "execute" || action === "stop")) void this.#load(); return; }
      if (response.status === 401) { this.#clearPrivateState(state.scope); return; }
      if ([403, 404, 410].includes(response.status) && (exactRead || action === "stop")) {
        // These are current per-request privacy denials even if the server body
        // is missing, HTML or still streaming. Consume them before decoding.
        if (this.#negativeReadCurrent(state.turnId, state.executionId, withdrawalRevision)) {
          this.#withdrawSpecialist(state, response.status === 403, withdrawalRevision);
        }
        return;
      }
      const payload = await response.json() as AssistantSpecialistResponse;
      if (!receiptScope() || !readable() && this.store.sourceOwnershipActive(source)) return;
      const withdrawn = this.#retentionUnavailable(payload);
      if (withdrawn) {
        const identity = { ...state, executionId: payload.executionId || state.executionId };
        if (this.#negativeReadCurrent(identity.turnId, identity.executionId, withdrawalRevision)) {
          this.#withdrawSpecialist(identity, payload.error === "assistant_read_scope_denied", withdrawalRevision);
        }
        return;
      }
      if (!response.ok) {
        if (!current()) return;
        // Refusing a new purchase is not withdrawal of an older valid result.
        if (action === "quote") {
          this.#specialist = { ...state, working: false, stopping: false, unusedExecution: false,
            notice: payload.submission === "not-submitted" ? "denied" : "failed" };
        } else this.#unconfirmedSpecialistRequest(action, payload.submission === "not-submitted");
        return;
      }
      const quote = payload.quote, original = payload.originalRequest;
      // A different model requested for a free preview can discover an already
      // admitted original request. Its signed contract is review-only, not a
      // cheaper/newer-model substitute for the requested purchase.
      const reusedQuote = action === "quote" && payload.reused === true && Boolean(payload.task && quote
        && !payload.task.recoveryOnly && payload.task.id === quote.executionId
        && payload.task.executionId === quote.executionId && payload.task.bindingHash === quote.bindingHash
        && payload.task.turnId === state.turnId && quote.status !== "quoted");
      const redirected = action !== "quote" && quote?.executionId !== state.executionId;
      const sameRedirect = redirected && payload.requestedExecutionId === state.executionId
        && payload.reusedExecutionId === quote?.executionId && payload.winnerExecutionId === quote?.executionId;
      const expectedProject = new URL(url).searchParams.get("projectId");
      const surface = assistantSurfaceForRoute(this.store.route.get());
      const savedUrl = new URL(url), savedSurface = assistantSurfaceForRoute(savedUrl.searchParams.get("route") ?? "");
      const savedSelection = savedUrl.searchParams.getAll("selected");
      const expectedDocument = savedSurface.documentId || (savedSurface.canvasId && savedSelection.length
        ? this.store.canvasPlanningDocumentId(savedSelection) : null);
      if (!quote || quote.operation !== "assistant-specialist" || quote.blockId !== ""
        || payload.turnId !== state.turnId || original?.turnId !== state.turnId
        || payload.executionId !== quote.executionId || !quote.executionId || !quote.bindingHash
        || expectedProject !== quote.projectId || original.projectId !== quote.projectId
        || original.documentId !== quote.documentId || original.canvasId !== quote.canvasId
        || original.sourceHash !== quote.sourceHash || !quote.models.includes(original.model)
        || quote.canvasId !== surface.canvasId || surface.documentId && quote.documentId !== surface.documentId
        || action === "quote" && ((!reusedQuote && (!expectedDocument || quote.documentId !== expectedDocument))
          || original.route !== new URL(url).searchParams.get("route")
          || JSON.stringify([...original.selectedItemIds].sort()) !== JSON.stringify([...savedSelection].sort())
          || !reusedQuote && model && original.model !== model)
        || redirected && (!sameRedirect || action === "stop")
        || action !== "quote" && !redirected && approvedHash && quote.bindingHash !== approvedHash
        || action === "stop" && (!payload.task || payload.task.id !== state.executionId || quote.bindingHash !== approvedHash)
        || payload.turn && payload.turn.id !== state.turnId
        || payload.result && payload.result.sourceStatus !== "original-approved-source"
        || payload.task && (payload.task.turnId !== state.turnId || payload.task.executionId !== quote.executionId
          || payload.task.bindingHash !== quote.bindingHash || payload.task.model !== original.model)) {
        throw new Error("assistant_specialist_identity_mismatch");
      }
      if (!this.store.sourceOwnershipActive(source)) {
        // Decode the exact original acknowledgment, but never rehydrate its source,
        // reply, proposed actions, or approval contract through an older source owner.
        const existing = this.#tasks.find(task => task.executionId === quote.executionId);
        const reference = this.#taskReference(payload.task ?? existing ?? {
          id: quote.executionId, turnId: state.turnId, executionId: quote.executionId, bindingHash: quote.bindingHash, status: "recovery",
        });
        if (payload.task && existing && payload.task.id !== existing.id) return;
        const retained = existing && (!existing.recoveryOnly
          || existing.submission === "settled" && reference.submission !== "settled"
          || existing.status === "completed" && reference.status !== "completed") ? existing : reference;
        if (retained === reference) this.#mergeTask(reference);
        const active = this.#specialist;
        if (active?.id === state.id && (revision === this.#reviewRevision || !active.working && !active.quote)) this.#specialist = { ...active,
          executionId: quote.executionId, task: retained, working: false,
          originalRequest: null, resultReply: null, quote: null, unusedExecution: false, stopping: false, retrievalOnly: true, notice: "unavailable" };
        return;
      }
      const canonicalCompletion = quote.status === "completed" && payload.result?.sourceStatus === "original-approved-source";
      const activeHash = this.#specialist?.quote?.bindingHash ?? this.#specialist?.task?.bindingHash;
      // A late paid completion may outrank a stopped/failed task receipt, but never
      // a newer withdrawal, changed review, different execution or different binding.
      if (!current() && !(canonicalCompletion && this.#specialist?.executionId === quote.executionId
        && activeHash === quote.bindingHash)) return;
      const latestTask = this.#tasks.find((task) => task.executionId === quote.executionId);
      const certifiedTask = [latestTask, this.#specialist?.task].find((task) => task?.executionId === quote.executionId
        && task.turnId === state.turnId && task.bindingHash === quote.bindingHash && this.#certifiedSpecialistCompletion(task));
      const certificate = certifiedTask ? this.#certifiedSpecialistCompletion(certifiedTask) : null;
      const responseTask: AssistantDisplayedTask | undefined = canonicalCompletion && payload.task ? {
        ...payload.task, canExecute: false, certifiedCompleted: true, completedReview: {
          turnId: payload.turnId, executionId: quote.executionId, quote: { ...quote, canExecute: false },
          originalRequest: original, result: payload.result!,
        },
      } : payload.task;
      // Ordinary progress never cancels retrieval, but stale unused-reservation
      // evidence cannot re-enable Run after a submitted or terminal receipt.
      const newerSubmission = latestTask && latestTask !== state.task && latestTask.turnId === state.turnId
        && latestTask.bindingHash === quote.bindingHash && latestTask.submission
        && latestTask.submission !== "not-submitted" && responseTask?.submission === "not-submitted";
      const task = certificate && certifiedTask ? { ...certifiedTask, canExecute: false }
        : newerSubmission ? { ...latestTask, canExecute: false } : responseTask;
      const currentQuote = certificate?.quote ?? (newerSubmission || canonicalCompletion || reusedQuote ? { ...quote, canExecute: false } : quote);
      const unusedExecution = exactRead && payload.unusedExecution === true && !payload.task && !payload.result
        && !redirected && !certificate && quote.status === "quoted" && quote.canExecute === false
        && quote.executionId === state.executionId && (!approvedHash || quote.bindingHash === approvedHash);
      // Certify only private evidence actually returned by this accepted exact
      // read, not a cached completion inherited by an ordinary progress reply.
      if (exactRead && (canonicalCompletion || !certificate)) {
        this.#certifyPrivateRead(state.turnId, state.executionId, withdrawalRevision);
        if (quote.executionId !== state.executionId) this.#certifyPrivateRead(state.turnId, quote.executionId, withdrawalRevision);
      }
      if (canonicalCompletion || task && ["canceled", "failed", "needs-review", "reconciled"].includes(task.status)) {
        this.#invalidateSpecialistReceipt(state.turnId, quote.executionId);
      }
      this.#readRevision += 1; // An older positive GET cannot replace this response.
      this.#specialist = { ...this.#specialist!, quote: currentQuote, originalRequest: certificate?.original ?? original, executionId: quote.executionId,
        task: task ? reusedQuote ? { ...task, canExecute: false } : task : null, working: false, stopping: false,
        unusedExecution, retrievalOnly: action === "quote" && !reusedQuote ? quote.status !== "quoted" || Boolean(payload.task)
          : this.#specialist!.retrievalOnly || redirected || reusedQuote || quote.status !== "quoted" || Boolean(payload.task),
        notice: redirected || reusedQuote ? "redirected" : "", resultReply: certificate?.reply ?? payload.result?.reply ?? payload.turn?.reply ?? this.#specialist!.resultReply };
      if (redirected || action === "quote" && state.unusedExecution && quote.executionId !== state.executionId) {
        this.#tasks = this.#tasks.filter((task) => task.executionId !== state.executionId);
      }
      if (task) this.#mergeTask(reusedQuote ? { ...task, canExecute: false } : task);
      else if (action !== "quote") this.#rememberSpecialistExecution(this.#specialist!);
      if (payload.turn && (!certificate || canonicalCompletion)) this.#mergeTurn(payload.turn as AssistantServerTurn);
      this.#refreshActiveTasks();
    } catch {
      if (!current()) { if (state.scope === this.#scope() && this.store.sourceOwnershipActive(source) && this.#open && (action === "execute" || action === "stop")) void this.#load(); return; }
      if (action === "quote") this.#specialist = { ...this.#specialist!, working: false, stopping: false, notice: "failed" };
      else this.#unconfirmedSpecialistRequest(action);
    } finally {
      if (exactRead && this.#retentionVersions.get("pending-read:" + readKey) === withdrawalRevision) this.#retentionVersions.delete("pending-read:" + readKey);
      if (receiptScope() && revision === this.#reviewRevision && !this.store.sourceOwnershipActive(source) && this.#specialist) {
        this.#specialist = { ...this.#specialist, working: false, stopping: false, quote: null, originalRequest: null,
          resultReply: null, unusedExecution: false, retrievalOnly: true, notice: "unavailable" };
      }
      if (state.scope === this.#scope()) this.requestUpdate();
    }
  }

  #unconfirmedSpecialistRequest(action: "execute" | "retrieve" | "resume" | "stop", notSubmitted = false) {
    const state = this.#specialist;
    if (!state) return;
    const quote = state.quote, original = state.originalRequest;
    // A failed read is not new provider or accounting evidence. Preserve an
    // exact receipt still visible under the current privacy fence, while an
    // identity-only re-entry must remain identity-only.
    const retained = Boolean(quote && original && quote.executionId === state.executionId
      && original.turnId === state.turnId && original.projectId === quote.projectId
      && original.documentId === quote.documentId && original.canvasId === quote.canvasId
      && original.sourceHash === quote.sourceHash && !this.#privatePresentationHidden(state.turnId, state.executionId)
      && (!state.task || state.task.executionId === state.executionId && state.task.bindingHash === quote.bindingHash)
      && (action !== "stop" || quote.status === "completed"
        && (state.task?.submission === "settled" || state.task?.certifiedCompleted === true)));
    if (!retained) this.#rememberSpecialistExecution(state);
    const completed = retained && quote!.status === "completed"
      && (state.task?.submission === "settled" || state.task?.certifiedCompleted === true);
    this.#specialist = { ...state, working: false, stopping: false, retrievalOnly: true,
      unusedExecution: false,
      task: retained ? state.task ? { ...state.task, canExecute: false } : null
        : this.#tasks.find((task) => task.executionId === state.executionId) ?? null,
      quote: quote ? { ...quote, canExecute: false,
        ...((action === "execute" || action === "stop") && !completed && !notSubmitted ? { status: "uncertain" as const } : {}) } : null,
      notice: action === "stop" ? "stopUnconfirmed" : action === "execute" ? notSubmitted ? "denied" : "uncertain" : "lookupFailed" };
  }

  #specialistAction(control?: AssistantSpecialistControl) {
    const state = this.#specialist;
    if (!control || !state || state.working || !this.#open || state.scope !== this.#scope()
      || control.reviewId !== state.id || control.turnId !== state.turnId || control.executionId !== state.executionId
      || control.bindingHash !== (state.quote?.bindingHash ?? state.task?.bindingHash ?? "")) return;
    // A captured free Retrieve must never become approval of whichever review
    // happens to be current when the event arrives.
    if (control.action === "approve") {
      if (state.retrievalOnly || !state.quote || state.quote.status !== "quoted") return;
      return this.#requestSpecialist("execute");
    }
    if (control.action === "run-approved") {
      if (!assistantApprovedRequestCanRun(state, this.#canSpecialist())) return;
      return this.#requestSpecialist("execute");
    }
    if (control.action === "retrieve") return this.#requestSpecialist("retrieve");
    if (control.action === "resume") return this.#requestSpecialist("resume");
    if (control.action === "quote") return this.#requestSpecialist("quote", control.model);
  }

  #nextContext() {
    if (this.#contextUnavailable) return null;
    const surface = assistantSurfaceForRoute(this.store.route.get()), projection = this.store.projection.get();
    // Canvas has no implicit global Document. Resolve its existing exact anchor
    // independently; never remove canvasId from a previously captured target.
    const documentId = surface.application === "canvas"
      ? surface.canvasId ? this.store.canvasPlanningDocumentId() : ""
      : projection.documentId;
    const document = projection.documents.find(value => value.id === documentId
      && value.projectId === projection.projectId && !value.removed);
    if (!document || !this.store.routeDataReady()) return null;
    const facts = nextActionFacts(this.store, document.id, null, { lifecycle: true });
    return facts.canRead ? { facts, document, projectName: projection.projectName } : null;
  }

  #nextOrigin(route=this.store.route.get()) {
    const surface = assistantSurfaceForRoute(route);
    const canvas = surface.canvasId ? this.store.canvasProjection.get() : null;
    return JSON.stringify([this.#scope(route), canvas?.selectedCanvasId ?? null,
      canvas ? this.store.canvasPlanningSelection.get() : null,
      canvas ? this.store.canvasPlanningDocumentId() : null]);
  }

  captureCommandDeparture():CommandDeparture {
    const owned=()=>[...this.querySelectorAll<FormaAssistantPanel>("forma-assistant-panel")].filter(panel=>panel.isConnected);
    const panels=owned(),route=this.store.route.get(),scope=this.#nextOrigin();
    return {element:this,current:context=>{
      const current=owned(),closing=context?.closingPresentation,shell=this.closest("forma-shell");
      // Only Shell's already-adopted native Library root substitutes this one
      // route slot. Scope clearing, actual selection/panels and raw work stay real.
      const heldRoute=closing?.originalRoute===route&&shell?.isConnected
        &&closing.presentation.owner.closest("forma-shell")===shell
        &&FormaElement.hasStoreIdentity(closing.presentation.owner,this.store)
        &&navigationPresentationClosing(context,closing.presentation.owner)?route:undefined;
      return this.isConnected&&scope===this.#nextOrigin(heldRoute)
        &&current.length===panels.length&&panels.every((panel,index)=>panel===current[index]);},
      blocked:()=>panels.some(panel=>panel.commandDepartureBlocked),reason:()=>"next.lifecycle.assistantOwnsWork"};
  }

  async #followNextAction(action: CreativeNextAction) {
    const panel = this.querySelector<FormaAssistantPanel>("forma-assistant-panel"), next = this.#nextContext();
    if (!this.#open || !panel?.isConnected || !panel.open || panel.navigationBlocked
      || !next || action.target.documentId !== next.document.id) return false;
    const request = ++this.#nextNavigation, origin = this.#nextOrigin();
    const originCurrent = () => this.isConnected && this.#open && !this.#contextUnavailable && panel.isConnected && panel.open
      && this.querySelector<FormaAssistantPanel>("forma-assistant-panel") === panel
      && request === this.#nextNavigation && origin === this.#nextOrigin() && !panel.navigationBlocked;
    let opened = false, navigationRefusal = "";
    try {
      opened = await openCreativeNextActionDestination(this.store, this.ownerDocument, action, {
        origin:this, originCurrent, navigationCurrent: () => request === this.#nextNavigation,
        onRefusal: reason => { navigationRefusal = reason; },
      });
    } catch { /* An unavailable destination is not a completed handoff. */ }
    if (!opened && navigationRefusal !== "current-work" && originCurrent()) this.store.toast(this.i18n.t("next.exact.unavailable", "This exact action changed or is no longer available. Review the current document."));
    return opened;
  }

  #interaction() {
    const session = this.store.session.get();
    const surface = assistantSurfaceForRoute(this.store.route.get());
    const context = session?.projectContext;
    const canAuthor = this.#canAuthor();
    const permissions = context?.permissions ?? session?.capabilities ?? [];
    const canGenerate = Boolean(session && permissions.includes("project.output.request"));
    const canEditCanvas = Boolean(session && (!context || ["owner", "editor"].includes(context.role))
      && permissions.includes("project.canvas.use") && canAuthor);
    return assistantInteractionForSurface(surface, {
      enabled: Boolean(session?.assistant?.enabled && session.policy.accepted),
      canAuthor,
      canGenerate,
      canEditCanvas,
      providerConfigured: Boolean(session?.provider.plannerConfigured ?? session?.provider.configured),
      personal: Boolean(session && !context),
    });
  }

  async #tool(input: { message: string; mode: Exclude<AssistantInteractionMode, "guidance"> }) {
    const panel = this.querySelector<FormaAssistantPanel>("forma-assistant-panel");
    const scope = this.#scope(), source = this.store.captureSourceOwnership();
    const session = this.store.session.get();
    const surface = assistantSurfaceForRoute(this.store.route.get());
    if (!panel || !session || !this.store.sourceOwnershipActive(source) || !this.#interaction().modes.includes(input.mode)) {
      panel?.resolveToolRequest(false, input.message);
      return;
    }

    const projection = this.store.projection.get();
    if (input.mode === "creative-chat") {
      if (this.store.documentJobActive("chat", projection.documentId)) {
        panel.resolveToolRequest(false, input.message);
        return;
      }
      const handoff=captureOutputNavigationFocus(this.ownerDocument);
      const current=()=>this.isConnected&&panel.isConnected&&this.querySelector<FormaAssistantPanel>("forma-assistant-panel")===panel
        &&scope===this.#scope()&&this.store.sourceOwnershipActive(source);
      try{
        const accepted=await this.store.chat(input.message,false);
        if(!current())return;
        await panel.resolveToolRequest(Boolean(accepted),input.message,{current,focus:handoff});
        if(!current())return;
        if(accepted){
          this.store.toast(`${this.i18n.t("activity.kind.chat")} · ${this.i18n.t("activity.inProgress")} · ${this.i18n.t("shell.navigation.activity")}`);
          if(this.#open&&panel.open&&handoff.current()&&!this.ownerDocument.querySelector("dialog[open]"))
            this.store.setRoute(withDocumentInRoute("/studio/chat",projection.documentId,projection.documentTitle));
        }
      }finally{handoff.dispose();}
      return;
    }

    const documentId = surface.canvasId ? this.store.canvasPlanningDocumentId() : projection.documentId;
    if(!documentId){this.store.toast(this.i18n.t("next.exact.chooseDocument","Choose a document"));panel.resolveToolRequest(false,input.message);return;}
    let closingQuickEdit = false;
    const handoffCurrent = () => this.isConnected && panel.isConnected
      && this.querySelector<FormaAssistantPanel>("forma-assistant-panel") === panel
      && scope === this.#scope() && this.store.sourceOwnershipActive(source);
    // Capture before dispatch/await, not after a reply or after the user moves.
    // Only this owned close may return to its own native launcher on the way to
    // the review; a newer pointer/key/focus gesture permanently retires the lease.
    const handoff = captureOutputNavigationFocus(this.ownerDocument, {
      ownedRouteFocus: element => closingQuickEdit && !this.#open && handoffCurrent()
        && element === panel.querySelector<HTMLElement>(".forma-assistant-launcher"),
    });
    try {
    const accepted = await new Promise<boolean>((resolve) => {
      const detail: AssistantToolRequest = {
        requestId: crypto.randomUUID(),
        mode: input.mode,
        message: input.message,
        actorUserId: session.user.userId,
        projectId: session.projectContext?.projectId ?? projection.projectId,
        documentId,
        canvasId: surface.canvasId,
        resolve,
      };
      const event = new CustomEvent<AssistantToolRequest>("forma-assistant-tool-request", { detail, cancelable: true });
      if (window.dispatchEvent(event)) resolve(false);
    });
    if (scope !== this.#scope() || !this.store.sourceOwnershipActive(source)) return;
    await panel.resolveToolRequest(accepted, input.message, {current:handoffCurrent,focus:handoff});
    if(!handoffCurrent())return;
    if (accepted && input.mode === "quick-edit") {
      if (!handoff || !handoffCurrent() || !handoff.current()) return;
      closingQuickEdit = true;
      this.#open = false;
      this.#closeMemory();
      this.requestUpdate();
      await this.updateComplete;
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      if (!handoffCurrent() || this.#open || !handoff.current() || document.querySelector("dialog[open]")) return;
      const review = document.querySelector<HTMLElement>(".document-quick-edit-review");
      if (review?.isConnected) handoff.run(review, () => {
        review.scrollIntoView({block:"nearest",behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});
        review.focus({preventScroll:true});
        return true;
      });
      return;
    }
    const messages:AssistantDisplayedMessage[]=[
      ...(accepted ? [{ id: crypto.randomUUID(), role: "user" as const, text: input.message }] : []),
      { id: crypto.randomUUID(), role: "assistant", key: accepted ? "assistant.mode.queued" : ["plan-document","plan-board"].includes(input.mode)?"assistant.mode.reviewClosed":"assistant.mode.failed",
        ...(accepted && ["plan-document", "plan-board"].includes(input.mode)
          ? { reviewMode: input.mode as "plan-document" | "plan-board", reviewReady: false } : {}) },
    ];
    if(accepted&&["plan-document","plan-board"].includes(input.mode))this.#localToolMessages=[...this.#localToolMessages,...messages].slice(-12);
    this.#messages=[...this.#messages,...messages];
    this.requestUpdate();
    } finally { handoff?.dispose(); }
  }

  #review(mode: "plan-document" | "plan-board") {
    const selector = mode === "plan-document" ? ".adaptive-model-plan" : ".canvas-intent-response";
    if (!document.querySelector<HTMLElement>(selector)) return;
    this.#open = false;
    this.#closeMemory();
    this.requestUpdate();
    void this.updateComplete.then(() => requestAnimationFrame(() => {
      const review = document.querySelector<HTMLElement>(selector);
      if (!review) return;
      if (!review.hasAttribute("tabindex")) review.tabIndex = -1;
      review.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      review.focus({ preventScroll: true });
    }));
  }

  #removeProposal(id: string) {
    this.#readRevision += 1;
    this.#proposals = this.#proposals.filter((item) => item.id !== id);
    this.#turns = this.#turns.map((turn) => ({ ...turn,
      proposal: turn.proposal?.id === id ? null : turn.proposal,
      ...(turn.proposals ? { proposals: turn.proposals.filter((item) => item.id !== id) } : {}),
    }));
  }

  async #proposal(detail: { proposal: AssistantDisplayedProposal; action: "accept" | "dismiss" }) {
    const { proposal, action } = detail;
    if (!this.store.sourceOwnershipActive(this.store.captureSourceOwnership())) return;
    if (proposal.kind === "navigate") {
      if (!this.#proposals.includes(proposal)) return;
      if (action !== "accept") { this.#removeProposal(proposal.id); this.requestUpdate(); return; }
      const path = proposal.route;
      if (!path) return;
      const destination = assistantSurfaceForRoute(path);
      const session = this.store.session.get();
      if (!destination.available || destination.host !== "creator") return;
      if (destination.application === "canvas" && !session?.canvas.access) return;
      if (destination.requiredCapabilities.length && !destination.requiredCapabilities.some((capability) => session?.capabilities?.includes(capability))) return;
      const scope = this.#scope(), source = this.store.captureSourceOwnership();
      await navigateInApp(this, async navigation => {
        if (!navigation.current() || scope !== this.#scope() || !this.store.sourceOwnershipActive(source)
          || !this.#proposals.includes(proposal)) return false;
        const opened = await navigation.route(path);
        // A refusal leaves this exact suggestion available. A genuine route
        // departure retires its conversation through the existing scope owner.
        if (opened && scope === this.#scope() && this.#proposals.includes(proposal)) {
          this.#removeProposal(proposal.id); this.requestUpdate();
        }
        return opened;
      });
      return;
    }
    if (!this.#canAuthor()) return;
    const scope = this.#scope();
    const url = this.#url();
    url.pathname = `/api/assistant/proposals/${encodeURIComponent(proposal.id)}/${action === "accept" ? "accept" : "reject"}`;
    try {
      const response = await fetch(url, { method: "POST", headers: { accept: "application/json" }, cache: "no-store" });
      if (scope !== this.#scope()) return;
      if (!response.ok) {
        const key = response.status === 410 ? "assistant.action.expired" : response.status === 409 ? "assistant.action.stale" : "assistant.unavailable";
        this.store.toast(this.i18n.t(key));
        if (response.status === 410 || response.status === 409) this.#removeProposal(proposal.id);
        return;
      }
      this.#removeProposal(proposal.id);
      if (action === "accept") {
        await this.store.refreshEvents();
        if (scope !== this.#scope()) return;
      }
      this.#messages = [...this.#messages, { id: `${proposal.id}:${action}`, role: "assistant", key: action === "accept" ? "assistant.action.accepted" : "assistant.action.rejected" }];
    } catch {
      if (scope === this.#scope()) this.store.toast(this.i18n.t("assistant.unavailable"));
    } finally {
      this.requestUpdate();
    }
  }

  async #task(detail: { task: AssistantDisplayedTask; action: "cancel" | "reconcile" }) {
    if (!this.store.sourceOwnershipActive(this.store.captureSourceOwnership())) return;
    if (detail.task.executionId) {
      const state = this.#specialist;
      if (detail.action === "cancel" && state?.task?.id === detail.task.id && state.turnId === detail.task.turnId
        && state.executionId === detail.task.executionId && state.quote?.bindingHash === detail.task.bindingHash
        && assistantApprovedRequestCanStop(state, this.#canSpecialist())) await this.#requestSpecialist("stop");
      return; // Signed tasks never use legacy cancellation or actor-self billing reconciliation.
    }
    if (detail.action !== "cancel") return; // Actor-self reconciliation has no independent billing authority.
    const scope = this.#scope();
    const url = this.#url();
    url.pathname = `/api/assistant/tasks/${encodeURIComponent(detail.task.id)}/cancel`;
    try {
      const response = await fetch(url, { method: "POST", headers: { accept: "application/json" } });
      if (scope !== this.#scope()) return;
      if (!response.ok) {
        this.store.toast(this.i18n.t(response.status === 409 ? "assistant.task.cancelUnavailable" : "assistant.unavailable"));
        await this.#load();
        return;
      }
      const status = "canceled";
      this.#tasks = this.#tasks.map((task) => task.id === detail.task.id ? { ...task, status, error: null } : task);
      this.#activeTasks.delete(detail.task.id);
      this.#messages = [...this.#messages, { id: `${detail.task.id}:${status}`, role: "assistant", key: `assistant.task.${status}` }];
    } catch {
      if (scope === this.#scope()) this.store.toast(this.i18n.t("assistant.unavailable"));
    } finally {
      this.requestUpdate();
      this.#refreshActiveTasks();
    }
  }

  override render() {
    this.#pruneMemoryAnswers();
    const previousScope = this.#loadedScope;
    const scope = this.#synchronizeScope();
    const session = this.store.session.get();
    const surface = assistantSurfaceForRoute(this.store.route.get());
    const interaction = this.#interaction();
    if (!session?.assistant?.enabled || surface.host !== "creator" || !surface.available || !session.policy.accepted || interaction.presentation !== "floating") {
      this.#clearPrivateState(scope);
      return nothing;
    }
    if (this.#open && previousScope !== scope) queueMicrotask(() => { if (this.#open && scope === this.#scope()) void this.#load(); });
    const projection = this.store.projection.get();
    const documentId = surface.canvasId ? this.store.canvasPlanningDocumentId() : projection.documentId;
    const planning = Boolean(documentId && this.store.documentJobActive("structure_adaptive", documentId,surface.canvasId??null));
    const next = this.#open ? this.#nextContext() : null;
    const chatting = Boolean(documentId && this.store.documentJobActive("chat", documentId));
    const busyModes: AssistantInteractionMode[] = [...(this.store.planningConsent.get() ? ["plan-document" as const, "plan-board" as const] : []), ...(chatting ? ["creative-chat" as const] : [])];
    const messages = this.#messages.map((message) => message.reviewMode
      ? { ...message, reviewReady: !planning && Boolean(message.reviewMode === "plan-document"
        ? this.store.adaptiveStructureFor(documentId)
        : surface.canvasId&&this.store.adaptiveSuggestionSetsFor(documentId,surface.canvasId).length) }
      : message);
    return html`<forma-assistant-panel .open=${this.#open} .conversationScope=${this.#scope()} .context=${this.#context} .messages=${messages} .proposals=${this.#proposals}
      .tasks=${this.#tasks} .models=${session.assistant.models ?? []} .modes=${interaction.modes}
      .busyModes=${busyModes}
      .continuation=${this.#open ? html`${next ? renderLifecycleNextActionCards(creativeNextActions(next.facts), this.i18n, action => this.#followNextAction(action), {
        projectName: next.projectName, documentTitle: next.document.title,
        scopeUnknown: next.facts.lifecycle?.output.state !== "ready" || next.facts.lifecycle?.output.scopeKnown !== true,
        creatorHandoff: surface.application === "canvas",
      }) : nothing}${this.#renderMemory(scope)}` : nothing}
      .retainGuidanceDraft=${true} .guidanceDelivery=${this.#guidance?.status ?? ""}
      .canSpecialist=${this.#canSpecialist()} .specialist=${this.#specialist}
      .canReconcile=${false}
      .pending=${this.#pending.size + this.#activeTasks.size + Number(planning)} .readOnly=${!this.#canAuthor()}
      .guidanceOnly=${this.#canAuthor() && (session.assistant.phase !== "actions" || !surface.documentId)}
      @forma-assistant-toggle=${(event: CustomEvent<{ open: boolean }>) => { this.#nextNavigation += 1; this.#open = event.detail.open; if (!this.#open) { this.#closeMemory(); this.#specialist = null; this.#reviewRevision += 1; } this.requestUpdate(); if (this.#open) void this.#load(); }}
      @forma-assistant-message=${(event: CustomEvent<{ message: string; mode?: Exclude<AssistantInteractionMode, "guidance"> }>) => { if (event.detail.mode) void this.#tool({ message: event.detail.message, mode: event.detail.mode }); else void this.#send({ message: event.detail.message }); }}
      @forma-assistant-guidance-recovery=${(event: CustomEvent<{ action: "check" | "retry" }>) => { if (event.detail.action === "check") void this.#load(); else void this.#deliverGuidance(); }}
      @forma-assistant-specialist-review=${(event: CustomEvent<{ turnId: string; task?: AssistantDisplayedTask }>) => { void this.#reviewSpecialist(event.detail); }}
      @forma-assistant-specialist-action=${(event: CustomEvent<AssistantSpecialistControl>) => { void this.#specialistAction(event.detail); }}
      @forma-assistant-specialist-model=${(event: CustomEvent<AssistantSpecialistControl>) => { if (event.detail?.action === "quote") void this.#specialistAction(event.detail); }}
      @forma-assistant-specialist-close=${(event: CustomEvent<{ reviewId: string }>) => this.#closeSpecialist(event.detail.reviewId)}
      @forma-assistant-review=${(event: CustomEvent<{ mode: "plan-document" | "plan-board" }>) => { this.#review(event.detail.mode); }}
      @forma-assistant-proposal=${(event: CustomEvent<{ proposal: AssistantDisplayedProposal; action: "accept" | "dismiss" }>) => { void this.#proposal(event.detail); }}
      @forma-assistant-task=${(event: CustomEvent<{ task: AssistantDisplayedTask; action: "cancel" | "reconcile" }>) => { void this.#task(event.detail); }}></forma-assistant-panel>`;
  }
}

if (!customElements.get("forma-creative-assistant")) customElements.define("forma-creative-assistant", FormaCreativeAssistant);

import { html, nothing } from "lit";
import { assistantSurfaceForRoute } from "../model/assistant-route-policy.ts";
import type { AssistantContext } from "../model/conversation-context.ts";
import { FormaElement } from "./forma-element.ts";
import type { AssistantDisplayedMessage, AssistantDisplayedProposal, AssistantDisplayedTask, FormaAssistantPanel } from "./design-system/assistant-panel.ts";
import "./design-system/assistant-panel.ts";

type AssistantServerTurn = {
  id: string;
  user: string;
  reply: { key?: string; values?: Record<string, string | number>; text?: string };
  proposal: AssistantDisplayedProposal | null;
  proposals?: AssistantDisplayedProposal[];
};

/**
 * Private, page-aware conversational assistant.
 * Ask about the current page, selected work, recent authorized activity, and reviewable next steps without leaving the page.
 */
export class FormaCreativeAssistant extends FormaElement {
  #open = false;
  #context: AssistantContext | null = null;
  #messages: AssistantDisplayedMessage[] = [];
  #proposals: AssistantDisplayedProposal[] = [];
  #tasks: AssistantDisplayedTask[] = [];
  #pending = new Set<string>();
  #activeTasks = new Set<string>();
  #taskTimer = 0;
  #loadedScope = "";

  override disconnectedCallback() {
    window.clearTimeout(this.#taskTimer);
    this.#taskTimer = 0;
    super.disconnectedCallback();
  }

  #refreshActiveTasks() {
    window.clearTimeout(this.#taskTimer);
    if (!this.#open || !this.#activeTasks.size) return;
    this.#taskTimer = window.setTimeout(() => {
      this.#taskTimer = 0;
      if (!this.#open) return;
      if (this.#pending.size) this.#refreshActiveTasks();
      else void this.#load();
    }, 750);
  }

  #scope() {
    const session = this.store.session.get();
    return [session?.user.userId ?? "", session?.permissionEpoch ?? "", session?.projectContext?.projectAccessId ?? "personal", this.store.route.get()].join("\u0000");
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
    const projectId = this.store.session.get()?.projectContext?.projectId ?? this.store.projection.get().projectId;
    if (projectId) url.searchParams.set("projectId", projectId);
    for (const item of this.#selection()) url.searchParams.append("selected", item);
    return url;
  }

  async #load() {
    const scope = this.#scope();
    try {
      const response = await fetch(this.#url(), { headers: { accept: "application/json" }, cache: "no-store" });
      if (!response.ok) throw new Error("assistant_unavailable");
      const payload = await response.json() as { context: AssistantContext; turns: AssistantServerTurn[]; tasks?: AssistantDisplayedTask[] };
      if (scope !== this.#scope() || !this.#open) return;
      this.#context = payload.context;
      this.#messages = payload.turns.flatMap((turn) => [
        { id: `${turn.id}:user`, role: "user" as const, text: turn.user },
        { id: `${turn.id}:assistant`, role: "assistant" as const, key: turn.reply.key, values: turn.reply.values, text: turn.reply.text },
      ]);
      this.#proposals = payload.turns.flatMap((turn) => turn.proposals ?? (turn.proposal ? [turn.proposal] : []));
      this.#tasks = payload.tasks ?? [];
      this.#activeTasks = new Set(this.#tasks.filter((task) => task.status === "queued" || task.status === "running" || task.status === "reconciling").map((task) => task.id));
      this.#loadedScope = scope;
    } catch {
      if (scope === this.#scope()) this.#messages = [{ id: crypto.randomUUID(), role: "assistant", key: "assistant.unavailable" }];
    } finally {
      this.requestUpdate();
      this.#refreshActiveTasks();
    }
  }

  async #send(input: { message: string; model?: string; premiumApproval?: boolean }) {
    const message = input.message;
    const scope = this.#scope();
    const turnId = crypto.randomUUID();
    this.#pending.add(turnId);
    this.#messages = [...this.#messages, { id: `${turnId}:user`, role: "user", text: message }];
    this.requestUpdate();
    try {
      const response = await fetch(this.#url(), {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ turnId, message, locale: this.i18n.locale,
          ...(input.model ? { model: input.model } : {}), ...(input.premiumApproval === true ? { premiumApproval: true } : {}) }),
      });
      if (!response.ok) throw new Error("assistant_unavailable");
      const payload = await response.json() as { context: AssistantContext; turn: AssistantServerTurn; task?: AssistantDisplayedTask };
      if (scope !== this.#scope()) return;
      this.#context = payload.context;
      this.#messages = [...this.#messages, { id: `${turnId}:assistant`, role: "assistant", key: payload.turn.reply.key, values: payload.turn.reply.values, text: payload.turn.reply.text }];
      const suggestions = payload.turn.proposals ?? (payload.turn.proposal ? [payload.turn.proposal] : []);
      if (suggestions.length) this.#proposals = [...this.#proposals, ...suggestions];
      if (payload.task) {
        this.#tasks = [payload.task, ...this.#tasks.filter((task) => task.id !== payload.task!.id)];
        this.#activeTasks.add(payload.task.id);
      }
    } catch {
      if (scope === this.#scope()) {
        this.#messages = [...this.#messages, { id: `${turnId}:error`, role: "assistant", key: "assistant.unavailable" }];
        this.querySelector<FormaAssistantPanel>("forma-assistant-panel")?.restoreDraft(message);
      }
    } finally {
      this.#pending.delete(turnId);
      this.requestUpdate();
      this.#refreshActiveTasks();
    }
  }

  async #proposal(detail: { proposal: AssistantDisplayedProposal; action: "accept" | "dismiss" }) {
    const { proposal, action } = detail;
    if (proposal.kind === "navigate") {
      this.#proposals = this.#proposals.filter((item) => item.id !== proposal.id);
      this.requestUpdate();
      if (action !== "accept" || !proposal.route) return;
      const destination = assistantSurfaceForRoute(proposal.route);
      const session = this.store.session.get();
      if (!destination.available || destination.host !== "creator") return;
      if (destination.application === "canvas" && !session?.canvas.access) return;
      if (destination.requiredCapabilities.length && !destination.requiredCapabilities.some((capability) => session?.capabilities?.includes(capability))) return;
      this.store.setRoute(proposal.route);
      return;
    }
    const scope = this.#scope();
    const url = this.#url();
    url.pathname = `/api/assistant/proposals/${encodeURIComponent(proposal.id)}/${action === "accept" ? "accept" : "reject"}`;
    try {
      const response = await fetch(url, { method: "POST", headers: { accept: "application/json" }, cache: "no-store" });
      if (scope !== this.#scope()) return;
      if (!response.ok) {
        const key = response.status === 410 ? "assistant.action.expired" : response.status === 409 ? "assistant.action.stale" : "assistant.unavailable";
        this.store.toast(this.i18n.t(key));
        if (response.status === 410 || response.status === 409) this.#proposals = this.#proposals.filter((item) => item.id !== proposal.id);
        return;
      }
      this.#proposals = this.#proposals.filter((item) => item.id !== proposal.id);
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
    if (detail.action === "reconcile" && !window.confirm(this.i18n.t("assistant.task.reconcileConfirm"))) return;
    const scope = this.#scope();
    const url = this.#url();
    url.pathname = `/api/assistant/tasks/${encodeURIComponent(detail.task.id)}/${detail.action}`;
    try {
      const response = await fetch(url, { method: "POST", headers: {
        accept: "application/json",
        ...(detail.action === "reconcile" ? { "content-type": "application/json" } : {}),
      }, ...(detail.action === "reconcile" ? { body: JSON.stringify({ confirmedNoProviderCharge: true }) } : {}) });
      if (scope !== this.#scope()) return;
      if (!response.ok) {
        this.store.toast(this.i18n.t(response.status === 409 ? "assistant.task.cancelUnavailable" : "assistant.unavailable"));
        await this.#load();
        return;
      }
      const status = detail.action === "cancel" ? "canceled" : "reconciled";
      this.#tasks = this.#tasks.map((task) => task.id === detail.task.id ? { ...task, status, error: null } : task);
      this.#activeTasks.delete(detail.task.id);
      this.#messages = [...this.#messages, { id: `${detail.task.id}:${status}`, role: "assistant", key: `assistant.task.${status}` }];
      if (detail.action === "reconcile") await this.store.refreshSession();
    } catch {
      if (scope === this.#scope()) this.store.toast(this.i18n.t("assistant.unavailable"));
    } finally {
      this.requestUpdate();
      this.#refreshActiveTasks();
    }
  }

  override render() {
    const session = this.store.session.get();
    const surface = assistantSurfaceForRoute(this.store.route.get());
    if (!session?.assistant?.enabled || surface.host !== "creator" || !surface.available || !session.policy.accepted) return nothing;
    if (this.#open && this.#loadedScope && this.#loadedScope !== this.#scope()) {
      this.#loadedScope = "";
      this.#context = null;
      this.#messages = [];
      this.#proposals = [];
      this.#tasks = [];
      this.#activeTasks.clear();
      window.clearTimeout(this.#taskTimer);
      queueMicrotask(() => { if (this.#open) void this.#load(); });
    }
    return html`<forma-assistant-panel .open=${this.#open} .context=${this.#context} .messages=${this.#messages} .proposals=${this.#proposals}
      .tasks=${this.#tasks} .models=${session.assistant.models ?? []}
      .canReconcile=${false}
      .pending=${this.#pending.size + this.#activeTasks.size} .readOnly=${Boolean(session.projectContext && !session.projectContext.permissions.includes("project.author"))}
      @forma-assistant-toggle=${(event: CustomEvent<{ open: boolean }>) => { this.#open = event.detail.open; this.requestUpdate(); if (this.#open) void this.#load(); }}
      @forma-assistant-message=${(event: CustomEvent<{ message: string; model?: string; premiumApproval?: boolean }>) => { void this.#send(event.detail); }}
      @forma-assistant-proposal=${(event: CustomEvent<{ proposal: AssistantDisplayedProposal; action: "accept" | "dismiss" }>) => { void this.#proposal(event.detail); }}
      @forma-assistant-task=${(event: CustomEvent<{ task: AssistantDisplayedTask; action: "cancel" | "reconcile" }>) => { void this.#task(event.detail); }}></forma-assistant-panel>`;
  }
}

if (!customElements.get("forma-creative-assistant")) customElements.define("forma-creative-assistant", FormaCreativeAssistant);

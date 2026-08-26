import { html, nothing, type PropertyValues } from "lit";
import { assistantSurfaceForRoute } from "../model/assistant-route-policy.ts";
import type { AssistantContext } from "../model/conversation-context.ts";
import { applicationDefinition, navigationItemActive } from "../platform/applications.ts";
import { platformSession } from "../platform/session-controller.ts";
import type { AssistantDisplayedMessage, AssistantDisplayedProposal, FormaAssistantPanel } from "./design-system/assistant-panel.ts";
import "./design-system/assistant-panel.ts";
import { FormaPresentationalElement } from "./presentational-element.ts";

type PlatformTurn = { id: string; user: string; reply: { key: string; values?: Record<string, string | number> }; proposal: AssistantDisplayedProposal | null };

/** Independent internal assistant: no Creator store, project documents, media, provider calls, or mutations. */
export class FormaPlatformAssistant extends FormaPresentationalElement {
  static override properties = { route: { type: String } };
  declare route: string;
  #open = false;
  #context: AssistantContext | null = null;
  #messages: AssistantDisplayedMessage[] = [];
  #proposals: AssistantDisplayedProposal[] = [];
  #pending = new Set<string>();
  #loadedScope = "";
  #unsubscribe?: () => void;

  constructor() {
    super();
    this.route = "";
  }

  override connectedCallback() {
    super.connectedCallback();
    this.#unsubscribe = platformSession.subscribe(() => { this.#sessionChanged(); });
  }

  override disconnectedCallback() {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    super.disconnectedCallback();
  }

  #sessionChanged() {
    const current = platformSession.get();
    if (!this.#loadedScope && !this.#messages.length && !this.#pending.size) {
      this.requestUpdate();
      if (this.#open && current?.assistant?.enabled && current.assistant.host === "platform"
        && assistantSurfaceForRoute(this.route).application === current.audience) queueMicrotask(() => { void this.#load(); });
      return;
    }
    if (current && this.#loadedScope === this.#scope()) { this.requestUpdate(); return; }
    this.#loadedScope = "";
    this.#context = null;
    this.#messages = [];
    this.#proposals = [];
    this.#pending.clear();
    this.requestUpdate();
    if (this.#open && current?.assistant?.enabled && current.assistant.host === "platform"
      && assistantSurfaceForRoute(this.route).application === current.audience) queueMicrotask(() => { void this.#load(); });
  }

  protected override updated(changed: PropertyValues) {
    super.updated(changed);
    if (!changed.has("route") || !this.#loadedScope || this.#loadedScope === this.#scope()) return;
    this.#loadedScope = "";
    this.#context = null;
    this.#messages = [];
    this.#proposals = [];
    this.#pending.clear();
    if (this.#open) queueMicrotask(() => { void this.#load(); });
  }

  #scope() {
    const session = platformSession.get();
    return [session?.user.userId ?? "", session?.audience ?? "", session?.permissionEpoch ?? "", this.route].join("\u0000");
  }

  #request() {
    const session = platformSession.get();
    if (!session) return null;
    const url = new URL("/api/platform/assistant", location.origin);
    url.searchParams.set("route", this.route);
    return { url, headers: { accept: "application/json", "x-forma-assistant-audience": session.audience,
      "x-forma-platform-permission-epoch": session.permissionEpoch } };
  }

  async #load() {
    const current = this.#request();
    if (!current) return;
    const scope = this.#scope();
    try {
      const response = await fetch(current.url, { headers: current.headers, cache: "no-store" });
      if (!response.ok) throw new Error("assistant_unavailable");
      const payload = await response.json() as { context: AssistantContext; turns: PlatformTurn[] };
      if (!this.#open || scope !== this.#scope()) return;
      this.#context = payload.context;
      this.#messages = payload.turns.flatMap((turn) => [
        { id: `${turn.id}:user`, role: "user" as const, text: turn.user },
        { id: `${turn.id}:assistant`, role: "assistant" as const, key: turn.reply.key, values: turn.reply.values },
      ]);
      this.#proposals = payload.turns.flatMap((turn) => turn.proposal ? [turn.proposal] : []);
      this.#loadedScope = scope;
    } catch {
      if (scope === this.#scope()) this.#messages = [{ id: crypto.randomUUID(), role: "assistant", key: "assistant.unavailable" }];
    } finally { this.requestUpdate(); }
  }

  async #send(message: string) {
    const current = this.#request();
    if (!current) return;
    const scope = this.#scope();
    const turnId = crypto.randomUUID();
    this.#pending.add(turnId);
    this.#messages = [...this.#messages, { id: `${turnId}:user`, role: "user", text: message }];
    this.requestUpdate();
    try {
      const response = await fetch(current.url, { method: "POST", headers: { ...current.headers, "content-type": "application/json" },
        body: JSON.stringify({ turnId, message, locale: this.i18n.locale }) });
      if (!response.ok) throw new Error("assistant_unavailable");
      const payload = await response.json() as { context: AssistantContext; turn: PlatformTurn };
      if (scope !== this.#scope()) return;
      this.#context = payload.context;
      this.#messages = [...this.#messages, { id: `${turnId}:assistant`, role: "assistant", key: payload.turn.reply.key, values: payload.turn.reply.values }];
      if (payload.turn.proposal) this.#proposals = [...this.#proposals, payload.turn.proposal];
    } catch {
      if (scope === this.#scope()) {
        this.#messages = [...this.#messages, { id: `${turnId}:error`, role: "assistant", key: "assistant.unavailable" }];
        this.querySelector<FormaAssistantPanel>("forma-assistant-panel")?.restoreDraft(message);
      }
    } finally { this.#pending.delete(turnId); this.requestUpdate(); }
  }

  #proposal(detail: { proposal: AssistantDisplayedProposal; action: "accept" | "dismiss" }) {
    this.#proposals = this.#proposals.filter((item) => item.id !== detail.proposal.id);
    this.requestUpdate();
    if (detail.action !== "accept" || detail.proposal.kind !== "navigate" || !detail.proposal.route) return;
    const session = platformSession.get();
    const destination = assistantSurfaceForRoute(detail.proposal.route);
    if (!session || destination.host !== "platform" || !destination.available
      || destination.application === session.audience && !destination.requiredCapabilities.some((capability) => session.capabilities.includes(capability))
      || destination.application !== session.audience && !session.availableApplications?.some((application) => application.id === destination.application)
      || ["/product/evaluation/actual", "/admin/events/replay"].includes(destination.canonicalFamily) && session.user.role !== "admin") return;
    if (destination.application !== session.audience) { location.assign(destination.route); return; }
    history.pushState({}, "", destination.route);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  #pageLabel() {
    const session = platformSession.get();
    if (!session) return "";
    const path = assistantSurfaceForRoute(this.route).canonicalFamily;
    const specific = path === "/product/evaluation/actual" || path === "/admin/events/replay" ? "actual"
      : path.endsWith("/evaluation/adapters") || path === "/laboratory/image-adapters" ? "adapters"
      : path.endsWith("/evaluation/replay") || path === "/laboratory/replay" ? "replay"
      : path.endsWith("/events/permissions") ? "permissions"
      : path.endsWith("/events/stream") ? "stream"
      : path.includes("focal-points") ? "focal" : "";
    if (specific) return this.i18n.t(`assistant.platform.page.${specific}`);
    const application = applicationDefinition(session.audience);
    const task = application.navigation.find((item) => navigationItemActive(session.audience, item.id, this.route));
    return task ? this.i18n.t(`shell.navigation.${task.id}`, task.label) : this.i18n.t(`shell.${session.audience}`, application.label);
  }

  override render() {
    const session = platformSession.get();
    const surface = assistantSurfaceForRoute(this.route || location.pathname);
    if (!session?.assistant?.enabled || session.assistant.host !== "platform" || surface.host !== "platform"
      || surface.application !== session.audience || !surface.available) return nothing;
    return html`<forma-assistant-panel .open=${this.#open} .conversationScope=${this.#scope()} .context=${this.#context} .messages=${this.#messages}
      .proposals=${this.#proposals} .tasks=${[]} .models=${[]} .pending=${this.#pending.size} .readOnly=${false} .guidanceOnly=${true}
      .pageLabel=${this.#pageLabel()}
      @forma-assistant-toggle=${(event: CustomEvent<{ open: boolean }>) => { this.#open = event.detail.open; this.requestUpdate(); if (this.#open) void this.#load(); }}
      @forma-assistant-message=${(event: CustomEvent<{ message: string }>) => { void this.#send(event.detail.message); }}
      @forma-assistant-proposal=${(event: CustomEvent<{ proposal: AssistantDisplayedProposal; action: "accept" | "dismiss" }>) => { this.#proposal(event.detail); }}></forma-assistant-panel>`;
  }
}

if (!customElements.get("forma-platform-assistant")) customElements.define("forma-platform-assistant", FormaPlatformAssistant);

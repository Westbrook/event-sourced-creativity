import { Signal } from "signal-polyfill";
import { SignalObject } from "signal-utils/object";
import { foldEvents, type CreativeEvent, type CreativeProjection, type EventInput } from "../model/events";
import { buildScenario, type ScenarioKey } from "../model/scenarios";
import type { ImageSample } from "../model/extractors";

type Listener = () => void;
export type PilotSession = {
  user: { userId: string; email: string; displayName: string; role: "admin" | "creator" | "agent" | "viewer"; consentVersion: string | null; consentedAt: string | null };
  policy: { version: string; accepted: boolean; passiveCapture: false; externalAssetsRequireAssertion: true; retentionDays: number; sharing: string };
  provider: { name: string; model: string; configured: boolean };
  budgets: { period: string; user: { used: number; reserved: number; limit: number }; workspace: { used: number; reserved: number; limit: number } };
};
export type ShareRecord = { shareId: string; token?: string; expiresAt: string; revokedAt?: string | null; createdAt?: string; active: boolean };

export class FormaStore {
  readonly events = new Signal.State<CreativeEvent[]>([]);
  readonly head = new Signal.State(0);
  readonly loading = new Signal.State(true);
  readonly busy = new Signal.State("");
  readonly error = new Signal.State("");
  readonly asOf = new Signal.State(Number.POSITIVE_INFINITY);
  readonly replayEvents = new Signal.State<CreativeEvent[]>([]);
  readonly replayAsOf = new Signal.State(0);
  readonly route = new Signal.State(location.pathname);
  readonly session = new Signal.State<PilotSession | null>(null);
  readonly content = new Signal.State<Record<string, string>>({});
  readonly shares = new Signal.State<ShareRecord[]>([]);
  readonly ui = new SignalObject({ inspectorOpen: false, commandOpen: false, accountOpen: false, shareOpen: false, compareOpen: false, instrumentation: true, selectedEventId: "", selectedOutputId: "", search: "", toast: "" });
  readonly projection = new Signal.Computed<CreativeProjection>(() => foldEvents(this.events.get(), this.asOf.get()));
  readonly replayProjection = new Signal.Computed<CreativeProjection>(() => foldEvents(this.replayEvents.get(), this.replayAsOf.get()));
  #listeners = new Set<Listener>();
  #undo: CreativeEvent[] = [];
  #redo: CreativeEvent[] = [];

  subscribe(listener: Listener) { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  notify() { this.#listeners.forEach((listener) => listener()); }
  patchUi(patch: Partial<typeof this.ui>) { Object.assign(this.ui, patch); this.notify(); }
  toast(message: string) { this.ui.toast = message; this.notify(); window.setTimeout(() => { if (this.ui.toast === message) { this.ui.toast = ""; this.notify(); } }, 2800); }
  setRoute(path: string) { if (location.pathname !== path) history.pushState({}, "", path); this.route.set(path); this.notify(); }

  async load() {
    this.loading.set(true); this.notify();
    try {
      await this.refreshSession();
      const response = await fetch("/api/events");
      if (!response.ok) throw new Error(`Event stream returned ${response.status}`);
      const body = await response.json() as { events: CreativeEvent[]; content?: Record<string, string>; head: number };
      this.events.set(body.events); this.content.set(body.content ?? {}); this.head.set(body.head); this.error.set("");
    } catch (error) { this.error.set(error instanceof Error ? error.message : "Unable to load event stream"); }
    finally { this.loading.set(false); this.notify(); }
  }

  async refreshSession() {
    const response = await fetch("/api/session"); const body = await response.json() as PilotSession & { error?: string };
    if (!response.ok) throw new Error(body.error ?? "Authentication required"); this.session.set(body); this.notify(); return body;
  }

  async acceptTerms() {
    this.busy.set("consent"); this.notify();
    try {
      const response = await fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "accept_terms", ownershipConfirmed: true, providerProcessingConfirmed: true }) });
      const body = await response.json() as PilotSession & { error?: string }; if (!response.ok) throw new Error(body.error ?? "Consent could not be recorded");
      this.session.set(body); await this.load(); this.toast("Pilot terms accepted and witnessed in the event stream.");
    } catch (error) { this.toast(error instanceof Error ? error.message : "Consent failed"); }
    finally { this.busy.set(""); this.notify(); }
  }

  async append(event: EventInput, options: { expected?: number; remember?: boolean } = {}) {
    return this.appendBatch([event], options);
  }

  async appendBatch(events: EventInput[], options: { expected?: number; remember?: boolean } = {}) {
    this.busy.set(events[0]?.type ?? "append"); this.notify();
    try {
      const response = await fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: events.length > 1 ? "batch" : "append", event: events[0], events, expectedSequence: options.expected ?? this.head.get(), clientId: "web:lit" }) });
      const body = await response.json() as { appended?: CreativeEvent[]; rejected?: Array<{ reason: string }>; head?: number; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Append rejected");
      const appended = body.appended ?? [];
      this.events.set([...this.events.get(), ...appended]); this.head.set(body.head ?? this.head.get());
      if (options.remember !== false) { this.#undo.push(...appended.filter((e) => e.actor === "user")); this.#redo = []; }
      if (body.rejected?.length) this.toast(`${body.rejected.length} event${body.rejected.length === 1 ? "" : "s"} rejected; valid events still appended.`);
      return appended;
    } catch (error) { this.toast(error instanceof Error ? error.message : "Append failed"); return []; }
    finally { this.busy.set(""); this.notify(); }
  }

  async hot(event: EventInput) {
    try {
      const response = await fetch("/api/events/hot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "hot", event, events: [event], clientId: "web:lit" }) });
      if (!response.ok) return;
      const body = await response.json() as { appended?: CreativeEvent[]; head?: number };
      this.events.set([...this.events.get(), ...(body.appended ?? [])]); this.head.set(body.head ?? this.head.get()); this.notify();
    } catch { /* Engagement instrumentation never blocks the creative action. */ }
  }

  async propose(prompt: string, events: EventInput[]) {
    this.busy.set("proposal"); this.notify();
    try {
      const response = await fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "propose", prompt, events, expectedSequence: this.head.get(), clientId: "web:lit" }) });
      if (!response.ok) throw new Error("Proposal could not be recorded");
      const body = await response.json() as { appended: CreativeEvent[]; head: number };
      this.events.set([...this.events.get(), ...body.appended]); this.head.set(body.head); this.toast("Proposal recorded — review it before applying.");
      return body.appended[0];
    } finally { this.busy.set(""); this.notify(); }
  }

  async generate() {
    const projection = this.projection.get(); this.busy.set("generate"); this.notify();
    try {
      const response = await fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "generate", expectedSequence: this.head.get(), snapshot: { facts: projection.blocks.map((b) => ({ handle: b.handle, properties: b.properties, authority: b.properties.authority ?? "authored", citations: b.sourceEvents })), pins: projection.outputs.filter((o) => o.pinned).map((o) => o.id), tail: [] }, sourceBlockVersions: projection.blocks.map((b) => ({ block_id: b.id, version: b.sourceEvents.length })) }) });
      const body = await response.json() as { appended?: CreativeEvent[]; content?: Record<string, string>; head?: number; error?: string };
      if (body.appended?.length) { this.events.set([...this.events.get(), ...body.appended]); this.head.set(body.head ?? this.head.get()); }
      if (body.content) this.content.set({ ...this.content.get(), ...body.content });
      if (!response.ok) throw new Error(body.error === "provider_not_configured" ? "OpenAI is ready but its production key has not been connected." : body.error ?? "Generation failed");
      await this.refreshSession(); this.toast(`Generated with ${this.session.get()?.provider.model ?? "OpenAI"}; provenance and usage recorded.`);
    } catch (error) { this.toast(error instanceof Error ? error.message : "Generation failed"); }
    finally { this.busy.set(""); this.notify(); }
  }

  async evaluateExtractors() {
    this.busy.set("extractor-eval"); this.notify();
    try {
      const response = await fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "evaluate_extractors", expectedSequence: this.head.get(), clientId: "web:system" }) });
      const body = await response.json() as { appended?: CreativeEvent[]; head?: number; error?: string };
      if (!response.ok) throw new Error(body.error === "admin_required" ? "An admin must witness the quality-gate rerun." : body.error ?? "Extractor evaluation failed");
      this.events.set([...this.events.get(), ...(body.appended ?? [])]); this.head.set(body.head ?? this.head.get()); this.toast("Extractor gate passed and the result was appended to the event stream.");
    } catch (error) { this.toast(error instanceof Error ? error.message : "Extractor evaluation failed"); }
    finally { this.busy.set(""); this.notify(); }
  }

  async extractReference(blockId: string, referenceId: string, sample: ImageSample) {
    this.busy.set("extract-reference"); this.notify();
    try {
      const response = await fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "extract_reference", expectedSequence: this.head.get(), clientId: "web:lit", blockId, referenceId, sample }) });
      const body = await response.json() as { appended?: CreativeEvent[]; head?: number; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Reference extraction failed");
      this.events.set([...this.events.get(), ...(body.appended ?? [])]); this.head.set(body.head ?? this.head.get()); this.toast("Reference stored and deterministic extraction completed.");
    } catch (error) { this.toast(error instanceof Error ? error.message : "Reference extraction failed"); }
    finally { this.busy.set(""); this.notify(); }
  }

  async closeSession() {
    this.busy.set("close-session"); this.notify();
    try {
      const response = await fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "close_session", expectedSequence: this.head.get(), clientId: "web:sessions" }) });
      const body = await response.json() as { appended?: CreativeEvent[]; head?: number; error?: string; eligibility?: { closedSessions?: number; requiredClosedSessions?: number } };
      if (!response.ok) throw new Error(body.error === "no_open_session" ? "Open a session before closing it." : body.error ?? "Session could not be closed");
      this.events.set([...this.events.get(), ...(body.appended ?? [])]); this.head.set(body.head ?? this.head.get()); this.toast(`Session closed with a state receipt · ${body.eligibility?.closedSessions ?? 0}/${body.eligibility?.requiredClosedSessions ?? 3} toward brief eligibility.`);
    } catch (error) { this.toast(error instanceof Error ? error.message : "Session could not be closed"); }
    finally { this.busy.set(""); this.notify(); }
  }

  async openSession() {
    this.busy.set("open-session"); this.notify();
    try {
      const response = await fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "open_session", expectedSequence: this.head.get(), clientId: "web:sessions" }) });
      const body = await response.json() as { appended?: CreativeEvent[]; head?: number; error?: string; briefComposed?: boolean };
      if (!response.ok) throw new Error(body.error === "session_already_open" ? "The current session is already open." : body.error ?? "Session could not be opened");
      this.events.set([...this.events.get(), ...(body.appended ?? [])]); this.head.set(body.head ?? this.head.get()); this.toast(body.briefComposed ? "Session opened with an eligible re-entry brief; every impression was witnessed." : "Session opened. More history is needed before composing a valid brief.");
    } catch (error) { this.toast(error instanceof Error ? error.message : "Session could not be opened"); }
    finally { this.busy.set(""); this.notify(); }
  }

  async composeBrief() {
    this.busy.set("compose-brief"); this.notify();
    try {
      const response = await fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "compose_brief", expectedSequence: this.head.get(), clientId: "web:sessions" }) });
      const body = await response.json() as { appended?: CreativeEvent[]; head?: number; error?: string; eligibility?: { reasons?: string[] } };
      if (!response.ok) throw new Error(body.error === "brief_not_eligible" ? `Brief is not eligible: ${body.eligibility?.reasons?.join(" and ") ?? "more history required"}.` : body.error === "open_session_required" ? "Open a session before composing a brief." : body.error ?? "Brief could not be composed");
      this.events.set([...this.events.get(), ...(body.appended ?? [])]); this.head.set(body.head ?? this.head.get()); this.toast("Re-entry brief composed from the event stream; impressions were witnessed in the same batch.");
    } catch (error) { this.toast(error instanceof Error ? error.message : "Brief could not be composed"); }
    finally { this.busy.set(""); this.notify(); }
  }

  async declareIntent(statement: string, deadline: string | null = null) {
    this.busy.set("declare-intent"); this.notify();
    try {
      const response = await fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "declare_intent", expectedSequence: this.head.get(), clientId: "web:sessions", statement, deadline }) });
      const body = await response.json() as { appended?: CreativeEvent[]; head?: number; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Intent could not be recorded");
      this.events.set([...this.events.get(), ...(body.appended ?? [])]); this.head.set(body.head ?? this.head.get()); this.toast("Intent recorded privately; the immutable event keeps only its expiring reference.");
    } catch (error) { this.toast(error instanceof Error ? error.message : "Intent could not be recorded"); }
    finally { this.busy.set(""); this.notify(); }
  }

  async loadShares() {
    const response = await fetch("/api/shares"); if (!response.ok) return; const body = await response.json() as { shares: ShareRecord[] }; this.shares.set(body.shares); this.notify();
  }

  async createShare(expiresHours: number) {
    const response = await fetch("/api/shares", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expiresHours }) }); const body = await response.json() as { share?: ShareRecord; error?: string };
    if (!response.ok || !body.share) { this.toast(body.error ?? "Share link could not be created"); return null; }
    await this.loadShares(); this.toast("Private read-only link created."); return body.share;
  }

  async revokeShare(shareId: string) {
    const response = await fetch(`/api/shares/${encodeURIComponent(shareId)}`, { method: "DELETE" }); const body = await response.json() as { error?: string };
    if (!response.ok) return this.toast(body.error ?? "Share link could not be revoked"); await this.loadShares(); this.toast("Share link revoked immediately.");
  }

  async undo() {
    const source = this.#undo.pop(); if (!source) return this.toast("Nothing to undo in this session.");
    const inverse = inverseEvent(source); if (!inverse) return this.toast(`${source.type} has no safe compensation in this prototype.`);
    const appended = await this.append({ ...inverse, compensatesEventId: source.eventId }, { remember: false });
    if (appended.length) this.#redo.push(source);
  }

  async redo() {
    const source = this.#redo.pop(); if (!source) return this.toast("Nothing to redo in this session.");
    const appended = await this.append({ type: source.type, payload: source.payload }, { remember: false });
    if (appended.length) this.#undo.push(source);
  }

  buildReplay(key: ScenarioKey, count: number) { const events = buildScenario(key, count); this.replayEvents.set(events); this.replayAsOf.set(0); this.notify(); }
  setReplayAsOf(value: number) { this.replayAsOf.set(value); this.notify(); }
}

function inverseEvent(event: CreativeEvent): EventInput | null {
  const p = event.payload;
  const pairs: Record<string, string> = { BlockLocked: "BlockUnlocked", BlockUnlocked: "BlockLocked", BlockRemoved: "BlockRestored", BlockRestored: "BlockRemoved", ObjectPinned: "ObjectUnpinned", ObjectUnpinned: "ObjectPinned", AddedToLibrary: "RemovedFromLibrary", RemovedFromLibrary: "AddedToLibrary" };
  if (pairs[event.type]) return { type: pairs[event.type], payload: p };
  if (event.type === "BlockPropertyEdited") return { type: event.type, payload: { ...p, old_value: p.new_value, new_value: p.old_value } };
  if (event.type === "BlockWeightSet") return { type: event.type, payload: { ...p, weight: p.previous_weight, previous_weight: p.weight } };
  if (event.type === "ChipEdited") return { type: event.type, payload: { ...p, old_value: p.new_value, new_value: p.old_value } };
  return null;
}

export const store = new FormaStore();

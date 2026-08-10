import { Signal } from "signal-polyfill";
import { SignalObject } from "signal-utils/object";
import { foldEvents, type CreativeEvent, type CreativeProjection, type EventInput } from "../model/events";
import { buildScenario, type ScenarioKey } from "../model/scenarios";

type Listener = () => void;

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
      const response = await fetch("/api/events");
      if (!response.ok) throw new Error(`Event stream returned ${response.status}`);
      const body = await response.json() as { events: CreativeEvent[]; head: number };
      this.events.set(body.events); this.head.set(body.head); this.error.set("");
    } catch (error) { this.error.set(error instanceof Error ? error.message : "Unable to load event stream"); }
    finally { this.loading.set(false); this.notify(); }
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
      const body = await response.json() as { appended?: CreativeEvent[]; head?: number; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Generation failed");
      this.events.set([...this.events.get(), ...(body.appended ?? [])]); this.head.set(body.head ?? this.head.get()); this.toast("Adapter-neutral simulation completed. Provider activation is human-gated.");
    } catch (error) { this.toast(error instanceof Error ? error.message : "Generation failed"); }
    finally { this.busy.set(""); this.notify(); }
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

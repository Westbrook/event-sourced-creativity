/**
 * Untrusted, ephemeral same-account / same-browser tab hints only.
 * BroadcastChannel is not authenticated collaboration. Same-origin script can
 * forge frames; these hints must never grant access, locks, selections or actions.
 * No names, colors, cursor history or durable transport are accepted.
 */
export type CanvasPresence = {
  tabId: string;
  connectionId: string;
  x: number;
  y: number;
  hasPosition: boolean;
  selectedItemId: string;
  updatedAt: number;
  expiresAt: number;
};

export type CanvasPresenceScope = {
  userId: string;
  projectId: string;
  canvasId: string;
  authorizationKey: string;
};

type PresenceChannel = Pick<BroadcastChannel, "onmessage" | "postMessage" | "close">;
type TabSession = { id: string; connections: number };
/** Injectable browser ports for deterministic local-transport tests. */
type PresenceRuntime = {
  tab?: TabSession;
  now?: () => number;
  connectionId?: () => string;
  channel?: (name: string) => PresenceChannel;
  setInterval?: (callback: () => void, delay: number) => unknown;
  clearInterval?: (timer: unknown) => void;
};
type Envelope = CanvasPresenceScope & {
  version: 1;
  kind: "presence" | "leave";
  tabId: string;
  connectionId: string;
  generation: number;
  sequence: number;
  sentAt: number;
};
type PresenceFrame = Envelope & {
  kind: "presence";
  x: number;
  y: number;
  hasPosition: boolean;
  selectedItemId: string;
};
type Peer = {
  connectionId: string;
  generation: number;
  sequence: number;
  sentAt: number;
  retainUntil: number;
  closed: boolean;
  presence: CanvasPresence | null;
};

const TTL = 6_000, HEARTBEAT = 2_000, FUTURE_SKEW = 1_000, MAX_TABS = 64;
const id = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z0-9][a-z0-9:_-]{0,127}$/i.test(value);
const integer = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const coordinate = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1_000_000;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const scopeValid = (scope: CanvasPresenceScope) => Boolean(scope && id(scope.userId) &&
  scope.userId.toLowerCase() !== "anonymous" && id(scope.projectId) && id(scope.canvasId) &&
  typeof scope.authorizationKey === "string" && scope.authorizationKey.length > 0 &&
  scope.authorizationKey.length <= 4_096);
const fresh = (sentAt: unknown, now: number): sentAt is number =>
  integer(sentAt) && sentAt > now - TTL && sentAt <= now + FUTURE_SKEW;
const ephemeralId = () => globalThis.crypto?.randomUUID?.() ?? "";
let browserTab: TabSession | undefined;

export class CanvasPresenceHub {
  #tab: TabSession;
  #now: () => number;
  #connectionId: () => string;
  #open: (name: string) => PresenceChannel;
  #setInterval: NonNullable<PresenceRuntime["setInterval"]>;
  #clearInterval: NonNullable<PresenceRuntime["clearInterval"]>;
  #channel: PresenceChannel | null = null;
  #scope: CanvasPresenceScope | null = null;
  #current: (() => boolean) | null = null;
  #connection = "";
  #generation = 0;
  #sequence = 0;
  #epoch = 0;
  #timer: unknown;
  #self = { x: 0, y: 0, hasPosition: false, selectedItemId: "" };
  #peers = new Map<string, Peer>();
  #listeners = new Set<(presence: CanvasPresence[]) => void>();

  constructor(runtime: PresenceRuntime = {}) {
    this.#tab = runtime.tab ?? (browserTab ??= { id: ephemeralId(), connections: 0 });
    this.#now = runtime.now ?? Date.now;
    this.#connectionId = runtime.connectionId ?? ephemeralId;
    this.#open = runtime.channel ?? ((name) => new BroadcastChannel(name));
    this.#setInterval = runtime.setInterval ?? ((callback, delay) => globalThis.setInterval(callback, delay));
    this.#clearInterval = runtime.clearInterval ?? ((timer) => globalThis.clearInterval(timer as ReturnType<typeof setInterval>));
  }

  connect(scope: CanvasPresenceScope, current: () => boolean): boolean {
    this.disconnect();
    if (!scopeValid(scope) || !id(this.#tab.id)) return false;
    this.#current = current;
    if (!this.#allowed()) { this.#current = null; return false; }
    try {
      this.#connection = this.#connectionId();
      this.#generation = ++this.#tab.connections;
      if (!id(this.#connection) || !integer(this.#generation)) { this.disconnect(); return false; }
      this.#scope = { ...scope };
      const channel = this.#open(JSON.stringify(["canvas-local-tabs", 1, scope.userId,
        scope.projectId, scope.canvasId, scope.authorizationKey]));
      this.#channel = channel;
      const epoch = ++this.#epoch;
      channel.onmessage = (event) => {
        if (this.#epoch !== epoch || this.#channel !== channel || !this.#ensureCurrent()) return;
        this.#receive(event.data);
      };
      this.#timer = this.#setInterval(() => {
        if (this.#epoch !== epoch || this.#channel !== channel || !this.#ensureCurrent()) return;
        this.#prune(this.#now());
        this.#send();
      }, HEARTBEAT);
      this.#send();
      return this.#channel === channel;
    } catch {
      this.disconnect();
      return false;
    }
  }

  update(patch: Partial<Pick<CanvasPresence, "x" | "y" | "selectedItemId">>): boolean {
    if (!this.#ensureCurrent() || !record(patch)) return false;
    if (Object.keys(patch).some((key) => !["x", "y", "selectedItemId"].includes(key))) return false;
    const positioned = Object.hasOwn(patch, "x"), hasY = Object.hasOwn(patch, "y");
    const selected = Object.hasOwn(patch, "selectedItemId");
    if (positioned !== hasY || (!positioned && !selected) ||
      positioned && (!coordinate(patch.x) || !coordinate(patch.y)) ||
      selected && patch.selectedItemId !== "" && !id(patch.selectedItemId)) return false;
    if (positioned) this.#self = { ...this.#self, x: patch.x!, y: patch.y!, hasPosition: true };
    if (selected) this.#self.selectedItemId = patch.selectedItemId!;
    return this.#send();
  }

  subscribe(listener: (presence: CanvasPresence[]) => void) {
    this.#ensureCurrent();
    this.#listeners.add(listener);
    listener(this.#snapshot());
    return () => this.#listeners.delete(listener);
  }

  disconnect() {
    const channel = this.#channel;
    const leave = channel && this.#allowed() ? this.#envelope("leave") : null;
    this.#epoch++;
    this.#channel = null;
    this.#scope = null;
    this.#current = null;
    this.#connection = "";
    this.#sequence = 0;
    this.#self = { x: 0, y: 0, hasPosition: false, selectedItemId: "" };
    if (this.#timer !== undefined) this.#clearInterval(this.#timer);
    this.#timer = undefined;
    if (channel) {
      channel.onmessage = null;
      try { if (leave) channel.postMessage(leave); } catch { /* Optional local transport. */ }
      try { channel.close(); } catch { /* Already closed or unavailable. */ }
    }
    const hadPeers = this.#peers.size > 0;
    this.#peers.clear();
    if (channel || hadPeers) this.#emit();
  }

  #allowed() { try { return this.#current?.() === true; } catch { return false; } }
  #ensureCurrent() {
    if (!this.#channel) return false;
    if (this.#allowed()) return true;
    this.disconnect();
    return false;
  }
  #envelope(kind: Envelope["kind"]): Envelope | null {
    const sentAt = this.#now();
    if (!this.#scope || !integer(sentAt) || !integer(this.#sequence + 1)) return null;
    return { ...this.#scope, version: 1, kind, tabId: this.#tab.id,
      connectionId: this.#connection, generation: this.#generation,
      sequence: ++this.#sequence, sentAt };
  }
  #send(): boolean {
    if (!this.#ensureCurrent()) return false;
    const envelope = this.#envelope("presence");
    if (!envelope) { this.disconnect(); return false; }
    try { this.#channel!.postMessage({ ...envelope, ...this.#self }); return true; }
    catch { this.disconnect(); return false; }
  }

  #receive(value: unknown) {
    const scope = this.#scope, now = this.#now();
    if (!scope || !integer(now) || !record(value) || value.version !== 1 ||
      (value.kind !== "presence" && value.kind !== "leave") ||
      value.userId !== scope.userId || value.projectId !== scope.projectId ||
      value.canvasId !== scope.canvasId || value.authorizationKey !== scope.authorizationKey ||
      !id(value.tabId) || value.tabId === this.#tab.id || !id(value.connectionId) ||
      !integer(value.generation) || !integer(value.sequence) || !fresh(value.sentAt, now)) return;
    if (value.kind === "presence" && (!coordinate(value.x) || !coordinate(value.y) ||
      typeof value.hasPosition !== "boolean" || value.selectedItemId !== "" && !id(value.selectedItemId))) return;
    // Copy only validated fields. Sender-supplied names/colors never reach UI.
    const message = value as unknown as Envelope | PresenceFrame;
    this.#prune(now);
    const previous = this.#peers.get(message.tabId);
    if (previous && (message.generation < previous.generation ||
      message.sentAt < previous.sentAt || message.generation === previous.generation &&
      (message.connectionId !== previous.connectionId || message.sequence <= previous.sequence || previous.closed))) return;
    if (message.kind === "leave") {
      // An old/unknown connection cannot erase a newer session in the same tab.
      if (!previous || previous.generation !== message.generation ||
        previous.connectionId !== message.connectionId) return;
      this.#peers.set(message.tabId, { ...previous, sequence: message.sequence,
        sentAt: message.sentAt, retainUntil: message.sentAt + TTL * 2, closed: true, presence: null });
      this.#emit();
      return;
    }
    if (!previous && this.#peers.size >= MAX_TABS) return;
    const frame = message as PresenceFrame;
    this.#peers.set(frame.tabId, {
      connectionId: frame.connectionId, generation: frame.generation,
      sequence: frame.sequence, sentAt: frame.sentAt, retainUntil: frame.sentAt + TTL * 2,
      closed: false, presence: { tabId: frame.tabId, connectionId: frame.connectionId,
        x: frame.x, y: frame.y, hasPosition: frame.hasPosition, selectedItemId: frame.selectedItemId,
        updatedAt: frame.sentAt, expiresAt: Math.min(now + TTL, frame.sentAt + TTL) },
    });
    this.#emit();
  }

  #prune(now: number) {
    let changed = false;
    for (const [tabId, peer] of this.#peers) {
      if (peer.presence && peer.presence.expiresAt <= now) { peer.presence = null; changed = true; }
      if (peer.retainUntil <= now) this.#peers.delete(tabId);
    }
    if (changed) this.#emit();
  }
  #snapshot(): CanvasPresence[] {
    const now = this.#now();
    return [...this.#peers.values()].flatMap((peer) => peer.presence && peer.presence.expiresAt > now ? [{ ...peer.presence }] : []);
  }
  #emit() { for (const listener of this.#listeners) listener(this.#snapshot()); }
}

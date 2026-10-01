import type { NativeImageEditTarget } from "./native-image-controller.ts";
import { captureNativeImageWork, type NativeImageWorkCapture } from "./native-image-outcome-consumer.ts";

export const NATIVE_IMAGE_STARTUP_SLOTS = Object.freeze([
  "component-load", "document-sync", "history", "private-hydration", "initial-visible-job-read",
] as const);
export type NativeImageStartupSlot = typeof NATIVE_IMAGE_STARTUP_SLOTS[number];
export type NativeImageCommitReceipt = Readonly<{ intent: Readonly<object>; path: string }>;
export type NativeImageStartupCommit = Readonly<{ status: "unconfirmed" }> | Readonly<{
  status: "confirmed"; receipt: NativeImageCommitReceipt;
}>;
export type NativeImageStartupSlotReceipt = Readonly<{
  slot: NativeImageStartupSlot; disposition: "started";
  /** The actual returned value/promise, or the original synchronous throw. */
  invocation: PromiseSettledResult<unknown>;
  /** Null only when invocation threw before any observation was attempted. */
  observation: PromiseSettledResult<void> | null;
  /** Null in capture-time evidence, or when no returned operation existed. */
  outcome: PromiseSettledResult<unknown> | null;
}> | Readonly<{
  slot: NativeImageStartupSlot; disposition: "unnecessary"; reason: string;
}> | Readonly<{ slot: NativeImageStartupSlot; disposition: "superseded" }>;
export type NativeImageStartupSnapshot = Readonly<{
  context: NativeImageEditTarget;
  commit: NativeImageStartupCommit;
  slots: readonly NativeImageStartupSlotReceipt[];
}>;
export type NativeImageStartupReceipt = NativeImageStartupSnapshot & Readonly<{
  consumer: PromiseSettledResult<void>;
  cleanups: readonly PromiseSettledResult<void>[];
}>;
export type NativeImageStartupPorts = Readonly<{
  consumeTerminal: (snapshot: NativeImageStartupSnapshot) => void | PromiseLike<void>;
  cleanups?: readonly (() => void | PromiseLike<void>)[];
}>;
export type NativeImageStartupSlotHandle = Readonly<{
  capture: Promise<NativeImageStartupSlotReceipt>;
  settled: Promise<NativeImageStartupSlotReceipt>;
}>;

/** One explicit Image Edit startup, not a scheduler or proof of arrival. Slots
 * retain opaque operation results; fulfilled undefined/false proves no read.
 * The later Store bridge must supply real initial-read acknowledgment separately.
 * The exact accepted frozen Edit target remains this ticket's context. */
export function createNativeImageStartupTicket(context: NativeImageEditTarget, ports: NativeImageStartupPorts) {
  let consumeTerminal: NativeImageStartupPorts["consumeTerminal"] | null = ports.consumeTerminal;
  const cleanupRoster = [...(ports.cleanups ?? [])];
  const slots: (NativeImageStartupSlotHandle | null)[] = NATIVE_IMAGE_STARTUP_SLOTS.map(() => null);
  let commit: NativeImageStartupCommit = Object.freeze({ status: "unconfirmed" });
  let closed = false;
  let complete: ((receipt: NativeImageStartupReceipt) => void) | null = null;
  const completion = new Promise<NativeImageStartupReceipt>(resolve => { complete = resolve; });
  let captureStartup: ((snapshot: NativeImageStartupSnapshot) => void) | null = null;
  const capture = new Promise<NativeImageStartupSnapshot>(resolve => { captureStartup = resolve; });
  let captureTerminal: ((value: NativeImageWorkCapture<void>) => void) | null = null;
  const terminalCapture = new Promise<NativeImageWorkCapture<void>>(resolve => { captureTerminal = resolve; });
  let captureCleanups: ((values: readonly NativeImageWorkCapture<void>[]) => void) | null = null;
  const cleanupCapture = new Promise<readonly NativeImageWorkCapture<void>[]>(resolve => { captureCleanups = resolve; });

  function indexOf(slot: NativeImageStartupSlot): number {
    const index = NATIVE_IMAGE_STARTUP_SLOTS.indexOf(slot);
    if (index < 0) throw new TypeError("native_image_startup_slot_required");
    return index;
  }

  function available(slot: NativeImageStartupSlot): number {
    if (closed) throw new Error("native_image_startup_closed");
    const index = indexOf(slot);
    if (slots[index] !== null) throw new Error("native_image_startup_slot_claimed");
    return index;
  }

  function start(slot: NativeImageStartupSlot, work: () => unknown): NativeImageStartupSlotHandle {
    const index = available(slot);
    let finish!: (receipt: NativeImageStartupSlotReceipt) => void;
    const settled = new Promise<NativeImageStartupSlotReceipt>(resolve => { finish = resolve; });
    let captureSlot!: (receipt: NativeImageStartupSlotReceipt) => void;
    const capture = new Promise<NativeImageStartupSlotReceipt>(resolve => { captureSlot = resolve; });
    const handle = Object.freeze({ capture, settled });
    // Reserve before the task can reenter. A rejected premature close leaves
    // this exact started operation owned; no replacement or second dispatch.
    slots[index] = handle;
    const observed = captureNativeImageWork(work);
    const { invocation, observation } = observed.capture;
    captureSlot(Object.freeze({ slot, disposition: "started", invocation, observation, outcome: null }));
    void observed.settled.then(outcome => {
      finish(Object.freeze({ slot, disposition: "started", invocation, observation,
        outcome: invocation.status === "rejected" ? null : outcome }));
    });
    return handle;
  }

  function unnecessary(slot: NativeImageStartupSlot, reason: string): void {
    const index = available(slot);
    const receipt: NativeImageStartupSlotReceipt = Object.freeze({ slot, disposition: "unnecessary", reason });
    const captured = Promise.resolve(receipt);
    slots[index] = Object.freeze({ capture: captured, settled: captured });
  }
  function superseded(slot: NativeImageStartupSlot): void {
    const index = available(slot);
    const receipt: NativeImageStartupSlotReceipt = Object.freeze({ slot, disposition: "superseded" });
    const captured = Promise.resolve(receipt);
    slots[index] = Object.freeze({ capture: captured, settled: captured });
  }
  function confirmCommit(receipt: NativeImageCommitReceipt): void {
    if (closed) throw new Error("native_image_startup_closed");
    if (commit.status === "confirmed") throw new Error("native_image_startup_commit_confirmed");
    // Records the bridge's exact receipt; this module does not grant authority
    // or infer a commit from a route string, boolean return or rejected tail.
    commit = Object.freeze({ status: "confirmed", receipt });
  }
  function close(): void {
    if (closed) return;
    if (slots.some(slot => slot === null)) throw new Error("native_image_startup_incomplete");
    // The bridge closes only after original navigation settlement and after
    // supplying any exact commit receipt. Seal before any terminal callback.
    closed = true;
    const capturedCommit = commit;
    const pending = slots as NativeImageStartupSlotHandle[];
    void Promise.all(pending.map(slot => slot.capture)).then(outcomes => {
      const finishCapture = captureStartup!;
      captureStartup = null;
      finishCapture(Object.freeze({ context, commit: capturedCommit, slots: Object.freeze(outcomes) }));
    });
    void Promise.all(pending.map(slot => slot.settled)).then(async outcomes => {
      const snapshot: NativeImageStartupSnapshot = Object.freeze({
        context, commit: capturedCommit, slots: Object.freeze(outcomes),
      });
      const terminal = consumeTerminal!;
      const consumer = captureNativeImageWork(() => terminal(snapshot));
      const finishTerminalCapture = captureTerminal!;
      captureTerminal = null;
      finishTerminalCapture(consumer.capture);
      // A pending recipient or cleanup cannot prevent another cleanup starting.
      const cleanupPending = cleanupRoster.map(work => captureNativeImageWork(work));
      cleanupRoster.length = 0;
      const finishCleanupCapture = captureCleanups!;
      captureCleanups = null;
      finishCleanupCapture(Object.freeze(cleanupPending.map(work => work.capture)));
      const [consumerOutcome, cleanupOutcomes] = await Promise.all([consumer.settled, Promise.all(cleanupPending.map(work => work.settled))]);
      const receipt: NativeImageStartupReceipt = Object.freeze({
        ...snapshot, consumer: consumerOutcome, cleanups: Object.freeze(cleanupOutcomes),
      });
      commit = Object.freeze({ status: "unconfirmed" });
      consumeTerminal = null;
      const finish = complete!;
      complete = null;
      finish(receipt);
    });
  }

  // The five public slot handles remain stable through closure and completion.
  // They are caller-owned receipt state, not an accumulating private history.
  return Object.freeze({ context, capture, terminalCapture, cleanupCapture, completion,
    slot: (slot: NativeImageStartupSlot) => slots[indexOf(slot)],
    start, unnecessary, superseded, confirmCommit, close });
}

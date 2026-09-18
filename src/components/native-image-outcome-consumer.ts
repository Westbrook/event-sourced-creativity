import type { NativeImageOperation } from "./native-image-controller.ts";
import type { NativeImageLauncherOperationContext } from "./native-image-launcher.ts";

export type NativeImageChannelReceipt = Readonly<{
  outcome: PromiseSettledResult<void>;
  consumer: PromiseSettledResult<void>;
}>;
export type NativeImageWorkCapture<T> = Readonly<{
  invocation: PromiseSettledResult<T | PromiseLike<T>>;
  observation: PromiseSettledResult<void> | null;
  /** Capture-time evidence only. Observation failure never fabricates an outcome. */
  outcome: PromiseSettledResult<T> | null;
}>;
export type NativeImageChannelCapture = Readonly<{
  outcome: PromiseSettledResult<void>;
  consumer: NativeImageWorkCapture<void>;
}>;
export type NativeImageOperationReceipt = Readonly<{
  originals: NativeImageOperation;
  context: NativeImageLauncherOperationContext;
  ui: NativeImageChannelReceipt;
  settled: NativeImageChannelReceipt;
  cleanups: readonly PromiseSettledResult<void>[];
}>;
export type NativeImageOutcomeConsumerPorts = Readonly<{
  consumeUi: (outcome: PromiseSettledResult<void>, context: NativeImageLauncherOperationContext) => void | PromiseLike<void>;
  consumeSettled: (outcome: PromiseSettledResult<void>, context: NativeImageLauncherOperationContext) => void | PromiseLike<void>;
  cleanups?: readonly (() => void | PromiseLike<void>)[];
}>;

function fulfilled<T>(value: T): PromiseSettledResult<T> {
  return Object.freeze({ status: "fulfilled", value });
}
function rejected(reason: unknown): PromiseRejectedResult {
  return Object.freeze({ status: "rejected", reason });
}
function observeOriginal(promise: Promise<void>): Promise<PromiseSettledResult<void>> {
  return promise.then(fulfilled, rejected);
}
/** @internal Shared only by the two disconnected Image ownership modules. */
export function captureNativeImageWork<T>(work: () => T | PromiseLike<T>) {
  let finish!: (outcome: PromiseSettledResult<T>) => void;
  const settled = new Promise<PromiseSettledResult<T>>(resolve => { finish = resolve; });
  let returned: T | PromiseLike<T>;
  try { returned = work(); }
  catch (reason) {
    const outcome = rejected(reason);
    finish(outcome);
    const capture: NativeImageWorkCapture<T> = Object.freeze({ invocation: outcome, observation: null, outcome });
    return Object.freeze({ capture, settled });
  }
  const invocation = fulfilled(returned);
  let installing = true, installed = false;
  let candidate: PromiseSettledResult<T> | null = null;
  const receive = (outcome: PromiseSettledResult<T>) => {
    if ((!installing && !installed) || candidate !== null) return;
    candidate = outcome;
    if (!installing) finish(outcome);
  };
  let observation: PromiseSettledResult<void>;
  try {
    // Read the original then property once and invoke that captured observer
    // once with its original receiver. Assimilation would hide getter/call
    // setup failures inside another Promise's rejection.
    const then = returned !== null && (typeof returned === "object" || typeof returned === "function")
      ? (returned as { then?: unknown }).then : undefined;
    if (typeof then === "function") {
      Reflect.apply(then, returned, [
        (value: T) => receive(fulfilled(value)),
        (reason: unknown) => receive(rejected(reason)),
      ]);
    } else receive(fulfilled(returned as T));
    observation = fulfilled(undefined);
    installed = true;
  } catch (reason) {
    observation = rejected(reason);
  }
  installing = false;
  if (installed && candidate !== null) finish(candidate);
  if (!installed) candidate = null;
  const capture: NativeImageWorkCapture<T> = Object.freeze({ invocation, observation, outcome: null });
  // A setup failure remains inspectable in capture while settled stays pending.
  // No fallback observer, retry permission or underlying quiescence is implied.
  return Object.freeze({ capture, settled });
}

/** A disconnected owner for one actual I2 operation. The accepted I5 context is
 * already frozen: retain that exact reference, not a copy or a deep-frozen input.
 * Required recipients receive every outcome, including after UI retirement.
 * A production host must supply real recipients and own the completion receipt. */
export function consumeNativeImageOperation(
  operation: NativeImageOperation,
  context: NativeImageLauncherOperationContext,
  ports: NativeImageOutcomeConsumerPorts,
) {
  const originals = Object.freeze({ ui: operation.ui, settled: operation.settled });
  const consumeUi = ports.consumeUi, consumeSettled = ports.consumeSettled;
  const cleanupRoster = [...(ports.cleanups ?? [])];

  // Attach both exact original observers before any recipient can be invoked.
  // These are the genuine native Promises provided by the accepted I2 contract.
  const uiOutcome = observeOriginal(originals.ui);
  const settledOutcome = observeOriginal(originals.settled);
  const uiWork = uiOutcome.then(outcome => Object.freeze({
    outcome, work: captureNativeImageWork(() => consumeUi(outcome, context)),
  }));
  const settledWork = settledOutcome.then(outcome => Object.freeze({
    outcome, work: captureNativeImageWork(() => consumeSettled(outcome, context)),
  }));
  const uiCapture: Promise<NativeImageChannelCapture> = uiWork.then(({ outcome, work }) => Object.freeze({ outcome, consumer: work.capture }));
  const settledCapture: Promise<NativeImageChannelCapture> = settledWork.then(({ outcome, work }) => Object.freeze({ outcome, consumer: work.capture }));
  const uiReceipt = uiWork.then(async ({ outcome, work }) => Object.freeze({ outcome, consumer: await work.settled }));
  const settledReceipt = settledWork.then(async ({ outcome, work }) => Object.freeze({ outcome, consumer: await work.settled }));

  // Required cleanup depends on actual operation settlement, not on a recipient
  // acknowledging it. Start every cleanup before awaiting any cleanup result.
  const cleanupWork = Promise.all([uiOutcome, settledOutcome]).then(() => {
    const pending = cleanupRoster.map(work => captureNativeImageWork(work));
    cleanupRoster.length = 0;
    return Object.freeze(pending);
  });
  const cleanupCapture = cleanupWork.then(work => Object.freeze(work.map(value => value.capture)));
  const cleanups = cleanupWork.then(work => Promise.all(work.map(value => value.settled)).then(outcomes => Object.freeze(outcomes)));
  const completion: Promise<NativeImageOperationReceipt> = Promise.all([
    uiReceipt, settledReceipt, cleanups,
  ]).then(([ui, settled, cleanupOutcomes]) => Object.freeze({
    originals, context, ui, settled, cleanups: cleanupOutcomes,
  }));
  // No registry or completed-history owner is created. The caller's returned
  // promises and genuinely pending callbacks may retain their original values.
  return Object.freeze({ originals, context, uiCapture, settledCapture, cleanupCapture, uiReceipt, settledReceipt, completion });
}

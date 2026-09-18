import { html, nothing } from "lit";
import type { FormaElement } from "./forma-element";
import type { FormaStore as Store, NativeImageInitialListReadOperation, NativeImageInitialListReadReceipt, NativeImageWorkspaceStartup } from "../state/store";
import { captureNativeImageSetup } from "../model/native-image-generation.ts";
import { NativeImageController, type NativeImageEditTarget, type NativeImageOperation, type NativeImageOpening } from "./native-image-controller.ts";
import { createNativeImageLauncher, nativeImageLauncherStyles, type NativeImageLauncherOperationContext } from "./native-image-launcher.ts";
import { consumeNativeImageOperation, type NativeImageOperationReceipt, type NativeImageChannelCapture, type NativeImageWorkCapture } from "./native-image-outcome-consumer.ts";
import { createNativeImageStartupTicket, NATIVE_IMAGE_STARTUP_SLOTS, type NativeImageCommitReceipt, type NativeImageStartupReceipt, type NativeImageStartupSnapshot, type NativeImageStartupSlotReceipt } from "./native-image-startup-ticket.ts";
import { captureOutputNavigationFocus } from "./output-navigation-focus";
import "../experiences/results/image-reader.css";
import "./native-image-inline-result.css";

export type NativeImageHostPresentation = Readonly<{
  current: () => boolean;
  subscribe: (recheck: () => void) => () => void;
}>;
export type NativeImageShellNavigationReceipt = Readonly<{
  navigation: PromiseSettledResult<boolean>;
  reporting: readonly PromiseSettledResult<void>[];
  cleanups: readonly Readonly<{
    phase: "origin-retire" | "cancel-native-close" | "navigation-dispose";
    outcome: PromiseSettledResult<void>;
  }>[];
}>;
type Ports = Readonly<{
  store: () => Store;
  text: (key: string, fallback: string) => string;
  locale: () => Readonly<{ locale: string; messages: Readonly<Record<string, string>>; direction: "ltr" | "rtl" }>;
  changed: () => void;
  navigate: (origin: FormaElement, target: NativeImageEditTarget, current: () => boolean,
    retire: () => PromiseSettledResult<void>, startup: NativeImageWorkspaceStartup) => Promise<NativeImageShellNavigationReceipt>;
}>;
type Presentation = {
  origin: FormaElement; presentation: NativeImageHostPresentation;
  opener: HTMLButtonElement | null;
  store: Store; lifetime: NonNullable<ReturnType<Store["captureNativeImageLifetime"]>>;
  stopped: boolean;
  launcher: ReturnType<typeof createNativeImageLauncher>;
  locale: ReturnType<Ports["locale"]>;
};
type OperationCell = {
  context: NativeImageLauncherOperationContext;
  phase: "reserved" | "unknown" | "owned" | "publishing" | "completed";
  invocationFailure: PromiseRejectedResult | null;
  observationFailure: PromiseRejectedResult | null;
  original: NativeImageOperation | null;
  consumer: ReturnType<typeof consumeNativeImageOperation> | null;
  ui: PromiseSettledResult<void> | null;
  settled: PromiseSettledResult<void> | null;
  receipt: NativeImageOperationReceipt | null;
  notification: PromiseSettledResult<void> | null;
  captures: { ui: NativeImageChannelCapture | null; settled: NativeImageChannelCapture | null; cleanups: readonly NativeImageWorkCapture<void>[] | null };
  captureNotifications: { ui: PromiseSettledResult<void> | null; settled: PromiseSettledResult<void> | null; cleanups: PromiseSettledResult<void> | null };
};
type EditCell = {
  target: NativeImageEditTarget;
  store: Store;
  bridge: NativeImageWorkspaceStartup;
  ticket: ReturnType<typeof createNativeImageStartupTicket>;
  commit: NativeImageCommitReceipt | null;
  original: Promise<NativeImageShellNavigationReceipt> | null;
  navigation: PromiseSettledResult<NativeImageShellNavigationReceipt> | null;
  initialOriginals: NativeImageInitialListReadOperation | null;
  initial: PromiseSettledResult<NativeImageInitialListReadReceipt> | null;
  physical: PromiseSettledResult<void> | null;
  eventFailure: PromiseRejectedResult | null;
  finalization: PromiseSettledResult<void> | null;
  withdrawal: PromiseSettledResult<void> | null;
  snapshot: NativeImageStartupSnapshot | null;
  receipt: NativeImageStartupReceipt | null;
  navigationNotification: PromiseSettledResult<void> | null;
  completionNotification: PromiseSettledResult<void> | null;
  focusCleanup: (() => void) | null;
  focusOutcome: PromiseSettledResult<void> | null;
  focusReleasing: boolean;
  publishing: boolean;
  withdrawing: boolean;
  receiptHandled: boolean;
  slotCaptures: (NativeImageStartupSlotReceipt | null)[];
  slotNotifications: (PromiseSettledResult<void> | null)[];
  dispatchFailures: (PromiseRejectedResult | null)[];
  dispatchNotifications: (PromiseSettledResult<void> | null)[];
  dispatchClosures: (PromiseSettledResult<void> | null)[];
  ended: boolean;
};
const yes = <T>(value: T): PromiseFulfilledResult<T> => Object.freeze({ status: "fulfilled", value });
const no = (reason: unknown): PromiseRejectedResult => Object.freeze({ status: "rejected", reason });
function attempt(work: () => void): PromiseSettledResult<void> {
  try { work(); return yes(undefined); } catch (reason) { return no(reason); }
}
function throwFailures(outcomes: readonly PromiseSettledResult<void>[]): void {
  const failures = outcomes.filter((value): value is PromiseRejectedResult => value.status === "rejected").map(value => value.reason);
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "native_image_host_cleanup_failed", { cause: failures[0] });
}
const rejected = (outcome: PromiseSettledResult<unknown> | null) => outcome?.status === "rejected";
function retainFailure(previous: PromiseSettledResult<void> | null, next: PromiseSettledResult<void>): PromiseSettledResult<void> {
  if (previous?.status !== "rejected") return next;
  if (next.status !== "rejected") return previous;
  return no(new AggregateError([previous.reason, next.reason], "native_image_startup_reporting_failed", { cause: previous.reason }));
}

/** One Shell's Image custodian. Presentation may disappear; the fixed original
 * operation cells do not. This does not survive page reload or grant a retry. */
export class NativeImageHost {
  readonly #ports: Ports;
  readonly #controller: NativeImageController;
  #launcher: ReturnType<typeof createNativeImageLauncher> | null = null;
  readonly #operations: { create: OperationCell | null; check: OperationCell | null } = { create: null, check: null };
  #presentation: Presentation | null = null;
  #openingRevision = 0;
  #retirementRevision = 0;
  #edit: EditCell | null = null;
  #retiring = false;
  #retirement: PromiseSettledResult<void> | null = null;
  // At most one displaced completed publication per kind: its failure closes
  // further admission before any third operation can enter. This retains the
  // exact A context/receipt if synchronous publication already admitted B.
  readonly #releasedFailureOwners: { create: OperationCell | null; check: OperationCell | null; edit: EditCell | null } = { create: null, check: null, edit: null };

  constructor(ports: Ports) {
    this.#ports = ports;
    this.#controller = new NativeImageController({
      submit: (setup, controls) => ports.store().submitNativeImage(setup, controls),
      read: (handle, controls) => ports.store().inspectNativeImage(handle, controls),
      changed: state => { this.#launcher?.controllerChanged(state); this.#notify(); },
    });
  }

  #localeCurrent(locale: ReturnType<Ports["locale"]>): boolean {
    const current = this.#ports.locale();
    return current.locale === locale.locale && current.messages === locale.messages && current.direction === locale.direction;
  }

  #createLauncher(): ReturnType<typeof createNativeImageLauncher> {
    const ports = this.#ports, text = ports.text;
    const imageLabel = text("lab.icon.image", "Image"), unavailable = text("settings.unavailable", "Unavailable");
    let launcher: ReturnType<typeof createNativeImageLauncher> | null = null;
    const launcherPorts = {
      controller: this.#controller,
      labels: { create: text("shell.navigation.create", "Create"), check: text("nativeImage.check", "Check"), close: text("action.close", "Close"),
        status: { ready: imageLabel, blocked: unavailable,
          submitting: text("nativeImage.creating", "Creating"), submitted: text("system.auto.1grw9tu.9", "Submitted"),
          "not-dispatched": text("system.auto.unvahb.13", "Not submitted"), uncertain: text("nativeImage.unconfirmed", "Unconfirmed"),
          checking: text("system.auto.1mydkgh.8", "Checking"), pending: text("role.status.pending", "Pending"), terminal: unavailable,
          unavailable, matched: imageLabel, retired: text("nativeImage.closed", "Closed") },
        image: { loading: text("status.loading", "Loading"), unavailable, edit: text("retainedStory.editInForma", "Edit in Forma") } },
      imageText: (image: { title: string | null }) => Object.freeze({ title: image.title ?? imageLabel, alt: image.title ?? imageLabel, caption: "" }),
      changed: (state: { status: string }) => {
        if (this.#launcher !== launcher) return;
        if (state.status === "retired" && this.#presentation) this.retire();
        this.#notify();
      },
      admission: {
        available: (kind: "create" | "check") => this.#operations[kind] === null && this.#edit === null && !this.#retiring && !rejected(this.#retirement),
        reserve: (context: NativeImageLauncherOperationContext) => this.#reserve(context),
      },
      operation: (operation: NativeImageOperation, context: NativeImageLauncherOperationContext) => this.#ownOperation(operation, context),
      close: (button: HTMLButtonElement, current: () => boolean) => this.#close(button, current),
      edit: (target: NativeImageEditTarget, _event: MouseEvent, current: () => boolean) => {
        try { this.#beginEdit(target, current); }
        catch (reason) { this.#recordRetirement(no(reason)); this.retire(); }
      },
    };
    launcher = createNativeImageLauncher(launcherPorts);
    return launcher;
  }

  get available(): boolean {
    return !this.#retiring && !rejected(this.#retirement) && this.#edit === null
      && this.#operations.create === null && this.#operations.check === null;
  }

  #notify(): void {
    // Both presentation and Shell status get a chance. No raw reason is rendered.
    const origin = this.#presentation?.origin;
    const outcomes = [attempt(() => { origin?.requestUpdate(); }), attempt(this.#ports.changed)];
    throwFailures(outcomes);
  }

  #recordRetirement(outcome: PromiseSettledResult<void>): void {
    if (outcome.status !== "rejected") return;
    const previous = this.#retirement;
    this.#retirement = previous?.status === "rejected"
      ? attempt(() => throwFailures([previous, outcome])) : outcome;
  }

  #reserve(context: NativeImageLauncherOperationContext) {
    if (this.#operations[context.kind] !== null || this.#edit !== null || this.#retiring || rejected(this.#retirement)) return null;
    const cell: OperationCell = { context, phase: "reserved", invocationFailure: null, observationFailure: null,
      original: null, consumer: null, ui: null, settled: null, receipt: null, notification: null,
      captures: { ui: null, settled: null, cleanups: null }, captureNotifications: { ui: null, settled: null, cleanups: null } };
    // No callback or render here: the original trusted button must remain enabled
    // through I5's post-reservation action guard. Reentry sees the occupied cell.
    this.#operations[context.kind] = cell;
    return Object.freeze({
      cancelBeforeCreation: () => {
        if (this.#operations[context.kind] === cell && cell.phase === "reserved") this.#operations[context.kind] = null;
      },
      creationThrew: (reason: unknown) => {
        cell.phase = "unknown"; cell.invocationFailure = no(reason);
        cell.notification = attempt(() => this.#notify());
        // The call may have started work before throwing. Keep the reservation;
        // neither dismissing UI nor an exception from reporting permits a retry.
        throwFailures([cell.notification]);
      },
    });
  }

  #ownOperation(operation: NativeImageOperation, context: NativeImageLauncherOperationContext): void {
    const cell = this.#operations[context.kind];
    if (!cell || cell.context !== context || cell.phase !== "reserved") throw new Error("native_image_operation_reservation_required");
    cell.original = operation;
    cell.phase = "owned";
    // The accepted handoff installs both original observers before any consumer
    // callback. It is required even if the originating presentation has retired.
    try {
      cell.consumer = consumeNativeImageOperation(operation, context, {
        consumeUi: outcome => { cell.ui = outcome; this.#notify(); },
        consumeSettled: outcome => { cell.settled = outcome; this.#notify(); },
      });
    } catch (reason) {
      cell.observationFailure = no(reason); cell.phase = "unknown";
      throw reason;
    }
    void cell.consumer.uiCapture.then(capture => {
      cell.captures.ui = capture; cell.captureNotifications.ui = attempt(() => this.#notify());
    });
    void cell.consumer.settledCapture.then(capture => {
      cell.captures.settled = capture; cell.captureNotifications.settled = attempt(() => this.#notify());
    });
    void cell.consumer.cleanupCapture.then(capture => {
      cell.captures.cleanups = capture; cell.captureNotifications.cleanups = attempt(() => this.#notify());
    });
    void cell.consumer.completion.then(receipt => {
      cell.receipt = receipt; cell.phase = "publishing";
      cell.notification = attempt(() => this.#notify());
      const failed = rejected(receipt.ui.outcome) || rejected(receipt.settled.outcome)
        || rejected(receipt.ui.consumer) || rejected(receipt.settled.consumer)
        || receipt.cleanups.some(rejected) || rejected(cell.notification) || Object.values(cell.captureNotifications).some(rejected);
      cell.phase = "completed";
      if (!failed && this.#operations[context.kind] === cell) {
        this.#operations[context.kind] = null;
        // The cell owns this final notification too; a failure reinstates the
        // completed record, never an unobserved asynchronous rejection.
        cell.notification = attempt(() => { this.#launcher?.controllerChanged(this.#controller.state); this.#notify(); });
        if (rejected(cell.notification)) {
          if (this.#operations[context.kind] === null) this.#operations[context.kind] = cell;
          else { this.#releasedFailureOwners[context.kind] = cell; this.#recordRetirement(cell.notification); }
        }
      }
    });
  }

  open(origin: FormaElement, input: unknown, presentation: NativeImageHostPresentation): NativeImageOpening | null {
    try { return this.#open(origin, input, presentation); }
    catch (reason) { this.#recordRetirement(no(reason)); this.#recordRetirement(attempt(this.#ports.changed)); return null; }
  }

  #open(origin: FormaElement, input: unknown, presentation: NativeImageHostPresentation): NativeImageOpening | null {
    const observedRevision = this.#openingRevision;
    if (!this.available || !presentation.current()) return null;
    if (this.#openingRevision !== observedRevision || !this.available) return null;
    const setup = captureNativeImageSetup(input), store = this.#ports.store(), source = store.captureSourceOwnership();
    const locale = Object.freeze({ ...this.#ports.locale() });
    if (!setup) return null;
    if (this.#openingRevision !== observedRevision || !this.available) return null;
    const revision = ++this.#openingRevision;
    const prior = this.retire();
    if (prior.status === "rejected" || !this.available || !presentation.current() || this.#ports.store() !== store
      || !store.sourceOwnershipActive(source) || !this.#localeCurrent(locale) || this.#openingRevision !== revision) return null;
    let value: Presentation | null = null;
    let unassignedLifetime: Presentation["lifetime"] | null = null;
    try {
      const launcher = this.#createLauncher();
      if (!this.#localeCurrent(locale)) return null;
      const lifetime = store.captureNativeImageLifetime(setup);
      if (!lifetime) return null;
      unassignedLifetime = lifetime;
      if (this.#presentation !== null || !this.available || !this.#localeCurrent(locale) || !presentation.current()
        || this.#ports.store() !== store || !store.sourceOwnershipActive(source)
        || this.#openingRevision !== revision || this.#presentation !== null || !this.available) { unassignedLifetime = null; lifetime.dispose(); return null; }
      const opener = origin.querySelector<HTMLButtonElement>("button.native-image-entry");
      value = { origin, presentation, store, lifetime, launcher, locale, opener, stopped: false };
      unassignedLifetime = null;
      this.#launcher = launcher;
      this.#presentation = value;
      const owned = () => this.#presentation === value && !value!.stopped && this.#launcher === launcher
        && this.#openingRevision === revision && this.#ports.store() === store && this.#localeCurrent(locale);
      const opening = launcher.open({ setup, lifetime: {
        current: () => owned() && lifetime.current(),
        presentationCurrent: () => owned() && presentation.current(),
        subscribe: recheck => {
          let source: (() => void) | null = null, view: (() => void) | null = null;
          let installed = false;
          const guardedRecheck = () => {
            try { recheck(); }
            catch (reason) {
              if (!installed || this.#retiring) throw reason;
              const cleanup = this.#retire(origin, presentation, undefined, false);
              const outcome = attempt(() => throwFailures([no(reason), cleanup]));
              this.#recordRetirement(outcome);
              this.#recordRetirement(attempt(this.#ports.changed));
              throwFailures([outcome]);
            }
          };
          try { source = lifetime.subscribe(guardedRecheck); view = presentation.subscribe(guardedRecheck); installed = true; }
          catch (reason) {
            const outcomes = [no(reason), attempt(() => { source?.(); }), attempt(() => { view?.(); })];
            throwFailures(outcomes); throw reason;
          }
          return () => throwFailures([attempt(() => { source?.(); }), attempt(() => { view?.(); })]);
        },
      } });
      if (opening === null) this.retire(origin, presentation);
      return opening;
    } catch (reason) {
      const unassigned = unassignedLifetime; unassignedLifetime = null;
      const unassignedCleanup = attempt(() => { unassigned?.dispose(); });
      const cleanup = value && this.#presentation === value ? this.#retire(origin, presentation, undefined, false) : yes(undefined);
      this.#recordRetirement(attempt(() => throwFailures([no(reason), unassignedCleanup, cleanup])));
      return null;
    }
  }

  #close(button: HTMLButtonElement, current: () => boolean): void {
    const value = this.#presentation;
    if (!value || !current() || this.#presentation !== value || value.stopped) return;
    const { origin, store, opener, locale } = value, ownerDocument = origin.ownerDocument;
    const shell = origin.closest("forma-shell"), main = shell?.querySelector<HTMLElement>("#main-content") ?? null;
    const source = store.captureSourceOwnership(), route = store.route.get(), projection = store.projection.get();
    const revision = store.documentGenerationRevision(), technique = store.promptTechniquePreference().technique, opening = this.#openingRevision;
    const retiredRevision = this.#retirementRevision + 1;
    const focus = ownerDocument.hasFocus() && ownerDocument.activeElement === button && button.ownerDocument === ownerDocument
      ? captureOutputNavigationFocus(ownerDocument) : null;
    const currentSource = () => this.#openingRevision === opening && this.#ports.store() === store
      && this.#localeCurrent(locale) && origin.isConnected && origin.ownerDocument === ownerDocument
      && shell?.isConnected === true && origin.closest("forma-shell") === shell
      && store.sourceOwnershipActive(source) && store.route.get() === route
      && store.projection.get().documentId === projection.documentId
      && store.projection.get().projectId === projection.projectId && store.documentGenerationRevision() === revision
      && store.promptTechniquePreference().technique === technique;
    const eligible = (target: HTMLElement) => {
      if (!target.isConnected || target.ownerDocument !== ownerDocument || !target.getClientRects().length
        || target.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
      for (let at: HTMLElement | null = target; at; at = at.parentElement) {
        const style = ownerDocument.defaultView?.getComputedStyle(at);
        if (!style || style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.opacity === "0") return false;
      }
      return true;
    };
    const targetNow = () => {
      if (!opener || origin.querySelector("button.native-image-entry") !== opener || !eligible(opener)) return null;
      if (!opener.disabled && !opener.matches(":disabled")) return opener;
      return main && shell?.querySelector("#main-content") === main && main.contains(origin) && eligible(main) ? main : null;
    };
    let scheduled = false;
    try {
      if (!current() || this.#presentation !== value || !currentSource()) return;
      const outcome = this.retire(origin, value.presentation);
      if (!focus || outcome.status !== "fulfilled") return;
      // Only this explicit Close may return focus. Intentional retirement ends
      // the presentation lifetime; the captured source and opening still fence it.
      void origin.updateComplete.then(() => {
        try {
          if (!currentSource() || this.#retirementRevision !== retiredRevision || this.#presentation !== null || this.#launcher !== null || this.#retiring
            || !focus.current() || ownerDocument.visibilityState === "hidden" || !ownerDocument.hasFocus()) return;
          // Pending work may keep the exact opener disabled. Return once to the
          // same existing Document landmark; never wait to refocus on settlement.
          const target = targetNow();
          if (!target) return;
          focus.run(target, () => {
            if (!currentSource() || this.#retirementRevision !== retiredRevision || this.#presentation !== null
              || !ownerDocument.hasFocus() || targetNow() !== target) return false;
            target.focus();
            return ownerDocument.activeElement === target && currentSource();
          });
        } catch (reason) { this.#recordRetirement(no(reason)); }
        finally { focus.dispose(); }
      }, reason => { focus.dispose(); this.#recordRetirement(no(reason)); });
      scheduled = true;
    } finally {
      // A clean asynchronous return retains its lease until updateComplete;
      // every earlier refusal or failure must release it here.
      if (!scheduled) focus?.dispose();
    }
  }

  retire(origin?: FormaElement, presentation?: NativeImageHostPresentation, notify?: () => void): PromiseSettledResult<void> {
    return this.#retire(origin, presentation, notify, true);
  }

  refreshLocale(): PromiseSettledResult<void> {
    const value = this.#presentation;
    if (!value) return yes(undefined);
    try {
      if (this.#localeCurrent(value.locale)) return yes(undefined);
      return this.retire(value.origin, value.presentation);
    } catch (reason) {
      const cleanup = this.#retire(value.origin, value.presentation, undefined, false);
      const outcome = attempt(() => throwFailures([no(reason), cleanup]));
      this.#recordRetirement(outcome);
      this.#recordRetirement(attempt(this.#ports.changed));
      return outcome;
    }
  }

  #retire(origin: FormaElement | undefined, presentation: NativeImageHostPresentation | undefined,
    notify: (() => void) | undefined, report: boolean): PromiseSettledResult<void> {
    this.#retirementRevision++;
    const value = this.#presentation;
    const exact = value !== null && (!origin || value.origin === origin) && (!presentation || value.presentation === presentation);
    if (exact) { value.stopped = true; this.#presentation = null; if (this.#launcher === value.launcher) this.#launcher = null; }
    const previous = this.#retiring; this.#retiring = true;
    const outcomes: PromiseSettledResult<void>[] = [];
    try {
      if (notify) outcomes.push(attempt(notify));
      if (exact) {
        outcomes.push(attempt(() => value.launcher.retire()));
        outcomes.push(attempt(() => value.lifetime.dispose()));
        outcomes.push(attempt(() => value.origin.requestUpdate()));
      }
    } finally { this.#retiring = previous; }
    const outcome = attempt(() => throwFailures(outcomes));
    if (report) {
      this.#recordRetirement(outcome);
      if (outcome.status === "rejected") this.#recordRetirement(attempt(this.#ports.changed));
    }
    return outcome;
  }

  disconnect(): PromiseSettledResult<void> {
    const cell = this.#edit;
    const previousWithdrawing = cell?.withdrawing ?? false;
    if (cell) { cell.ended = true; cell.withdrawing = true; }
    const outcomes: PromiseSettledResult<void>[] = [];
    try {
      outcomes.push(this.#retire(undefined, undefined, undefined, false));
      // Withdrawal is one-shot for this Edit. A nested disconnect must not
      // recurse into the same dispatcher/focus cleanup or lower the outer gate.
      if (cell && !previousWithdrawing && cell.withdrawal === null) {
        cell.withdrawal = attempt(() => {
          cell.store.finishNativeImageStartup(cell.bridge, "host-disconnected");
          if (!cell.dispatchFailures.some(rejected))
            for (const slot of NATIVE_IMAGE_STARTUP_SLOTS) if (cell.ticket.slot(slot) === null) cell.ticket.unnecessary(slot, "host-disconnected");
          if (cell.navigation !== null && NATIVE_IMAGE_STARTUP_SLOTS.every(slot => cell.ticket.slot(slot) !== null)) cell.ticket.close();
        });
        outcomes.push(cell.withdrawal);
        outcomes.push(attempt(() => this.#releaseFocus(cell)));
      }
    } finally { if (cell) cell.withdrawing = previousWithdrawing; }
    const outcome = attempt(() => throwFailures(outcomes));
    this.#recordRetirement(outcome);
    return outcome;
  }

  retainStartupFocus(startup: NativeImageWorkspaceStartup, cleanup: () => void): void {
    const cell = this.#edit;
    if (!cell || cell.bridge !== startup || cell.ended || cell.focusCleanup !== null || cell.focusOutcome !== null || cell.focusReleasing)
      throw new Error("native_image_startup_focus_unavailable");
    // Registration has no callback or publication. The Shell may now retain its
    // exact original lease; terminal cleanup (or Shell withdrawal) owns disposal.
    cell.focusCleanup = cleanup;
  }

  #releaseFocus(cell: EditCell): void {
    if (cell.focusReleasing) return;
    if (cell.focusOutcome === null) {
      const cleanup = cell.focusCleanup;
      cell.focusCleanup = null; cell.focusReleasing = true;
      try { cell.focusOutcome = attempt(() => { cleanup?.(); }); }
      finally { cell.focusReleasing = false; }
    }
    throwFailures([cell.focusOutcome]);
  }

  render(origin: FormaElement) {
    const value = this.#presentation;
    if (!value || value.origin !== origin) return nothing;
    try {
      if (this.#ports.store() !== value.store || !this.#localeCurrent(value.locale) || !value.presentation.current()) { this.retire(origin, value.presentation); return nothing; }
      // FormaElement is light DOM. This explicit scoped style node is the actual
      // stylesheet path; an unused staticStyles property would not apply.
      return html`<style>${nativeImageLauncherStyles.cssText}</style>${value.launcher.render()}`;
    } catch (reason) {
      const cleanup = this.#retire(origin, value.presentation, undefined, false);
      this.#recordRetirement(attempt(() => throwFailures([no(reason), cleanup])));
      return nothing;
    }
  }

  ownsStartup(startup: NativeImageWorkspaceStartup, commit: NativeImageCommitReceipt): boolean {
    return this.#edit?.bridge === startup && this.#edit.commit === commit && !this.#edit.ended;
  }

  routeEventFailed(startup: NativeImageWorkspaceStartup, reason: unknown): void {
    const cell = this.#edit;
    if (!cell || cell.bridge !== startup) return;
    // The one synchronous route-event phase has its own outcome. Native
    // dispatchEvent does not promise to rethrow listener errors to Store.
    cell.eventFailure = cell.eventFailure
      ? no(new AggregateError([cell.eventFailure.reason, reason], "native_image_route_event_failed", { cause: cell.eventFailure.reason })) : no(reason);
  }

  #beginEdit(target: NativeImageEditTarget, current: () => boolean): void {
    const value = this.#presentation;
    if (!value || this.#edit !== null || this.#retiring || rejected(this.#retirement) || !current()) return;
    if (this.#presentation !== value || value.stopped || this.#edit !== null || this.#retiring || rejected(this.#retirement)) return;
    const store = value.store;
    const ticket = createNativeImageStartupTicket(target, {
      consumeTerminal: snapshot => { cell.snapshot = snapshot; this.#notify(); },
      cleanups: [() => this.#releaseFocus(cell)],
    });
    const maybeClose = () => {
      if (cell.navigation !== null && NATIVE_IMAGE_STARTUP_SLOTS.every(slot => ticket.slot(slot) !== null)) ticket.close();
    };
    const bridge: NativeImageWorkspaceStartup = Object.freeze({
      id: Object.freeze({}),
      commit: receipt => {
        if (cell.commit !== null) throw new Error("native_image_startup_commit_claimed");
        ticket.confirmCommit(receipt); cell.commit = receipt;
      },
      start: (slot, work) => {
        const handle = ticket.start(slot, work), index = NATIVE_IMAGE_STARTUP_SLOTS.indexOf(slot);
        void handle.capture.then(capture => {
          cell.slotCaptures[index] = capture;
          cell.slotNotifications[index] = attempt(() => this.#notify());
          this.#finishEditReceipt(cell);
        });
        maybeClose();
      },
      unnecessary: (slot, reason) => { ticket.unnecessary(slot, reason); maybeClose(); },
      superseded: slot => { ticket.superseded(slot); maybeClose(); },
      failed: (slot, reason) => {
        const previousPublishing = cell.publishing;
        cell.publishing = true;
        try {
          const index = NATIVE_IMAGE_STARTUP_SLOTS.indexOf(slot), previous = cell.dispatchFailures[index];
          cell.dispatchFailures[index] = previous
            ? no(new AggregateError([previous.reason, reason], "native_image_startup_dispatch_failed", { cause: previous.reason })) : no(reason);
          cell.ended = true;
          const detached = this.#edit !== cell;
          if (detached) {
            const previousOwner = this.#releasedFailureOwners.edit;
            if (previousOwner === null || previousOwner === cell) this.#releasedFailureOwners.edit = cell;
            else if (this.#edit === null) this.#edit = cell;
            else {
              // Qualified Store delivery precedes native Promise completion and
              // cannot produce this third historic owner. Do not overwrite A/B.
              const contract = no(new Error("native_image_startup_failure_capacity"));
              this.#recordRetirement(no(reason)); this.#recordRetirement(contract);
              throwFailures([no(reason), contract]);
            }
            // Defensive late producer delivery retains its exact old context and
            // receipt before any notification can admit or acknowledge a view.
            this.#recordRetirement(no(reason));
          }
          // Supplemental failure does not replace an already-started/superseded
          // slot. Store has disarmed before calling this concrete local recipient.
          // Record first; acknowledgment stays fenced until both reporting phases
          // are captured. Later successful reporting cannot erase an earlier error.
          const notification = attempt(() => this.#notify());
          cell.dispatchNotifications[index] = retainFailure(cell.dispatchNotifications[index], notification);
          const closure = attempt(maybeClose);
          cell.dispatchClosures[index] = retainFailure(cell.dispatchClosures[index], closure);
          if (detached) { this.#recordRetirement(notification); this.#recordRetirement(closure); }
        } finally { cell.publishing = previousPublishing; }
      },
      initial: operation => {
        if (cell.initialOriginals !== null) throw new Error("native_image_initial_read_claimed");
        cell.initialOriginals = operation;
        // Pure local capture: attach both exact originals before returning to
        // the ticket's work callback. No UI or recipient runs in this interval.
        void operation.initial.then(result => { cell.initial = yes(result); this.#finishEditReceipt(cell); }, reason => { cell.initial = no(reason); this.#finishEditReceipt(cell); });
        void operation.settled.then(() => { cell.physical = yes(undefined); this.#finishEditReceipt(cell); }, reason => { cell.physical = no(reason); this.#finishEditReceipt(cell); });
      },
    });
    const cell: EditCell = { target, store, bridge, ticket, commit: null, original: null, navigation: null,
      initialOriginals: null, initial: null, physical: null, eventFailure: null, finalization: null, withdrawal: null,
      snapshot: null, receipt: null, navigationNotification: null, completionNotification: null,
      focusCleanup: null, focusOutcome: null, focusReleasing: false, publishing: false, withdrawing: false, receiptHandled: false,
      slotCaptures: NATIVE_IMAGE_STARTUP_SLOTS.map(() => null), slotNotifications: NATIVE_IMAGE_STARTUP_SLOTS.map(() => null),
      dispatchFailures: NATIVE_IMAGE_STARTUP_SLOTS.map(() => null), dispatchNotifications: NATIVE_IMAGE_STARTUP_SLOTS.map(() => null),
      dispatchClosures: NATIVE_IMAGE_STARTUP_SLOTS.map(() => null), ended: false };
    this.#edit = cell;
    void ticket.completion.then(receipt => {
      cell.receipt = receipt;
      this.#finishEditReceipt(cell);
    });
    const finish = (outcome: PromiseSettledResult<NativeImageShellNavigationReceipt>) => {
      cell.navigation = outcome;
      const failed = outcome.status === "rejected" || outcome.value.navigation.status === "rejected" || outcome.value.navigation.value === false
        || cell.eventFailure !== null || cell.dispatchFailures.some(rejected);
      cell.finalization = attempt(() => {
        if (failed) {
          cell.ended = true;
          store.finishNativeImageStartup(bridge);
          // Proposed bridge contract: only after actual navigation settlement
          // and irrevocable dispatcher disarm. Never manufacture a started task
          // or infer that the already-recorded commit did not happen.
          // A prior dispatch/classification failure may leave unknown accounting.
          // Do not overwrite that failure by manufacturing missing dispositions.
          if (!cell.dispatchFailures.some(rejected))
            for (const slot of NATIVE_IMAGE_STARTUP_SLOTS) if (ticket.slot(slot) === null) ticket.unnecessary(slot, "navigation-ended-before-start");
        }
        maybeClose();
      });
      cell.navigationNotification = attempt(() => this.#notify());
    };
    try {
      const original = this.#ports.navigate(value.origin, target, current,
        () => this.retire(value.origin, value.presentation), bridge);
      cell.original = original;
      void original.then(result => finish(yes(result)), reason => finish(no(reason)));
    } catch (reason) { finish(no(reason)); }
  }

  #editFailed(cell: EditCell): boolean {
    const navigation = cell.navigation;
    return navigation === null || navigation.status === "rejected"
      || rejected(navigation.value.navigation) || navigation.value.navigation.status === "fulfilled" && navigation.value.navigation.value === false
      || navigation.value.reporting.some(rejected) || navigation.value.cleanups.some(value => rejected(value.outcome))
      || rejected(cell.initial) || rejected(cell.physical) || rejected(cell.eventFailure)
      || cell.initialOriginals !== null && (cell.initial === null || cell.physical === null)
      || rejected(cell.finalization) || rejected(cell.withdrawal) || rejected(cell.navigationNotification) || rejected(cell.completionNotification) || rejected(cell.focusOutcome) || !cell.receipt
      || cell.slotNotifications.some(rejected)
      || cell.dispatchFailures.some(rejected) || cell.dispatchNotifications.some(rejected) || cell.dispatchClosures.some(rejected)
      || rejected(cell.receipt.consumer) || cell.receipt.cleanups.some(rejected)
      || cell.receipt.slots.some(slot => slot.disposition === "started" && (rejected(slot.invocation) || rejected(slot.observation) || rejected(slot.outcome)));
  }

  #finishEditReceipt(cell: EditCell): void {
    if (!cell.receipt || cell.receiptHandled || cell.publishing || cell.withdrawing || cell.initialOriginals !== null && (cell.initial === null || cell.physical === null)
      || cell.receipt.slots.some((slot, index) => slot.disposition === "started" && cell.slotCaptures[index] === null)) return;
    cell.receiptHandled = true;
    cell.publishing = true;
    try { cell.completionNotification = attempt(() => this.#notify()); }
    finally { cell.publishing = false; }
    if (!this.#editFailed(cell) && this.#edit === cell) {
      this.#edit = null;
      cell.completionNotification = attempt(() => this.#notify());
      if (rejected(cell.completionNotification)) {
        if (this.#edit === null) this.#edit = cell;
        else { this.#releasedFailureOwners.edit = cell; this.#recordRetirement(cell.completionNotification); }
      }
    }
  }

  #dismiss(cells: readonly Readonly<{ kind: "create" | "check"; cell: OperationCell; receipt: NativeImageOperationReceipt | null; notification: PromiseSettledResult<void> | null }>[],
    edit: Readonly<{ cell: EditCell; receipt: NativeImageStartupReceipt; notification: PromiseSettledResult<void> | null;
      finalization: PromiseSettledResult<void> | null; withdrawal: PromiseSettledResult<void> | null; eventFailure: PromiseRejectedResult | null;
      dispatchFailures: readonly (PromiseRejectedResult | null)[]; dispatchNotifications: readonly (PromiseSettledResult<void> | null)[];
      dispatchClosures: readonly (PromiseSettledResult<void> | null)[] }> | null,
    retirement: PromiseSettledResult<void> | null): void {
    // Only genuinely completed operations can release their retained failures.
    for (const value of cells) if (this.#operations[value.kind] === value.cell && value.cell.phase === "completed"
      && value.cell.receipt === value.receipt && value.cell.notification === value.notification) this.#operations[value.kind] = null;
    if (edit && this.#edit === edit.cell && edit.cell.receipt === edit.receipt && edit.cell.receiptHandled && !edit.cell.publishing && !edit.cell.withdrawing
      && edit.cell.completionNotification === edit.notification && edit.cell.finalization === edit.finalization && edit.cell.withdrawal === edit.withdrawal && edit.cell.eventFailure === edit.eventFailure
      && edit.dispatchFailures.every((outcome, index) => edit.cell.dispatchFailures[index] === outcome)
      && edit.dispatchNotifications.every((outcome, index) => edit.cell.dispatchNotifications[index] === outcome)
      && edit.dispatchClosures.every((outcome, index) => edit.cell.dispatchClosures[index] === outcome)
      && (edit.cell.initialOriginals === null || edit.cell.initial !== null && edit.cell.physical !== null)) this.#edit = null;
    if (this.#retirement === retirement && !this.#retiring
      && this.#releasedFailureOwners.create?.phase !== "publishing" && this.#releasedFailureOwners.check?.phase !== "publishing"
      && !this.#releasedFailureOwners.edit?.publishing && !this.#releasedFailureOwners.edit?.withdrawing) {
      this.#retirement = null;
      this.#releasedFailureOwners.create = null; this.#releasedFailureOwners.check = null; this.#releasedFailureOwners.edit = null;
    }
    const outcome = attempt(() => { this.#launcher?.controllerChanged(this.#controller.state); this.#notify(); });
    this.#recordRetirement(outcome);
  }

  renderStatus() {
    const cells = [this.#operations.create, this.#operations.check];
    const edit = this.#edit;
    const unknown = cells.some(cell => cell?.phase === "unknown" || cell &&
      (rejected(cell.captures.ui?.consumer.observation ?? null) || rejected(cell.captures.settled?.consumer.observation ?? null)
        || cell.captures.cleanups?.some(capture => rejected(capture.observation))))
      || Boolean(edit && !edit.receipt && (rejected(edit.finalization) || rejected(edit.withdrawal) || edit.dispatchFailures.some(rejected)
        || edit.dispatchClosures.some(rejected) || edit.slotCaptures.some(slot => slot?.disposition === "started" && rejected(slot.observation))));
    const failed = rejected(this.#retirement) || cells.some(cell => cell?.phase === "completed")
      || cells.some(cell => cell && (rejected(cell.ui) || rejected(cell.settled)))
      || Boolean(edit && (rejected(edit.eventFailure) || rejected(edit.navigationNotification) || rejected(edit.finalization) || rejected(edit.withdrawal)
        || edit.dispatchFailures.some(rejected) || edit.dispatchNotifications.some(rejected) || edit.dispatchClosures.some(rejected)
        || edit.receipt && this.#editFailed(edit)));
    if (!unknown && !failed) return nothing;
    const roster = (["create", "check"] as const).flatMap(kind => {
      const cell = this.#operations[kind];
      return cell?.phase === "completed" ? [Object.freeze({ kind, cell, receipt: cell.receipt, notification: cell.notification })] : [];
    });
    const acknowledgedEdit = edit?.receipt && edit.receiptHandled && !edit.publishing && !edit.withdrawing && (edit.initialOriginals === null || edit.initial !== null && edit.physical !== null)
      ? Object.freeze({ cell: edit, receipt: edit.receipt, notification: edit.completionNotification, finalization: edit.finalization,
        withdrawal: edit.withdrawal, eventFailure: edit.eventFailure, dispatchFailures: Object.freeze([...edit.dispatchFailures]),
        dispatchNotifications: Object.freeze([...edit.dispatchNotifications]), dispatchClosures: Object.freeze([...edit.dispatchClosures]) }) : null;
    const retirement = this.#retirement;
    const canDismiss = roster.length > 0 || acknowledgedEdit !== null || rejected(retirement);
    const text = this.#ports.text;
    return html`<section class="error-banner native-image-host-status" role="status" aria-live="polite">
      <span>${unknown ? text("nativeImage.unconfirmed", "Unconfirmed") : text("settings.unavailable", "Unavailable")}</span>
      ${canDismiss ? html`<button type="button" class="button" style="min-inline-size:44px;min-block-size:44px" @click=${() => this.#dismiss(roster, acknowledgedEdit, retirement)}>${text("system.auto.an1pf7.7", "Dismiss")}</button>` : nothing}
    </section>`;
  }
}

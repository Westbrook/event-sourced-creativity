import { css, html, nothing } from "lit";
import { Directive, directive, PartType, type PartInfo } from "lit/directive.js";
import { keyed } from "lit/directives/keyed.js";
import { ref } from "lit/directives/ref.js";
import { captureNativeImageSetup, type NativeImageMatch, type NativeImageSetup } from "../model/native-image-generation.ts";
import type { NativeImageController, NativeImageControllerState, NativeImageEditTarget, NativeImageOpening, NativeImageOperation } from "./native-image-controller.ts";
import { createNativeImageInlineResult, type NativeImageInlineState } from "./native-image-inline-result.ts";

export type NativeImageLauncherLifetime = Readonly<{
  current: () => boolean;
  presentationCurrent: () => boolean;
  /** Synchronous notifications for source/auth/route/Document/authored-revision
   * and presentation lifetime changes, including hidden, pagehide and disconnect.
   * Benign hydration may notify too: recheck evaluates both captured predicates.
   * A throwing installation must clean its own partial listener before throwing. */
  subscribe: (recheck: () => void) => () => void;
}>;
export type NativeImageLauncherLabels = Readonly<{
  create: string; check: string; close: string;
  status: Readonly<Record<NativeImageControllerState["status"], string>>;
  image: Readonly<{ loading: string; unavailable: string; edit: string }>;
}>;
export type NativeImageLauncherState = Readonly<{
  binding: Readonly<object> | null; status: NativeImageControllerState["status"];
  canCreate: boolean; canCheck: boolean; imageReady: boolean; imageStatus: NativeImageInlineState["status"] | null;
  editTarget: NativeImageEditTarget | null;
}>;
export type NativeImageLauncherOperationContext = Readonly<{
  binding: Readonly<object>; opening: NativeImageOpening; kind: "create" | "check";
}>;
export type NativeImageLauncherReservation = Readonly<{
  cancelBeforeCreation: () => void;
  creationThrew: (reason: unknown) => void;
}>;
export type NativeImageLauncherAdmission = Readonly<{
  /** Pure capacity only; presentation and Document lifetime remain I5 guards. */
  available: (kind: "create" | "check") => boolean;
  /** Atomically claim capacity without callbacks or rendering. */
  reserve: (context: NativeImageLauncherOperationContext) => NativeImageLauncherReservation | null;
}>;
export type NativeImageLauncherPorts = Readonly<{
  controller: NativeImageController;
  labels: NativeImageLauncherLabels;
  imageText: (image: NativeImageMatch) => Readonly<{ title: string; alt: string; caption: string }>;
  changed?: (state: NativeImageLauncherState) => void;
  admission?: NativeImageLauncherAdmission;
  /** Retain and handle BOTH originals; a thrown observer is not delivery success. */
  operation: (operation: NativeImageOperation, context: NativeImageLauncherOperationContext) => void;
  /** Existing owner navigation owns any asynchronous work and carries current
   * through every await/departure/openDocument boundary. No navigation here. */
  edit: (target: NativeImageEditTarget, event: MouseEvent, current: () => boolean) => void;
  close?: (button: HTMLButtonElement, current: () => boolean) => void;
}>;

export const nativeImageLauncherStyles = css`
  .native-image-launcher { --image-launcher-gutter: max(clamp(1rem, 3vi, 2rem), env(safe-area-inset-left), env(safe-area-inset-right)); font-size: 1rem; }
  .native-image-launcher .experience-image-reader { box-sizing: border-box; min-inline-size: 0; inline-size: 100%; max-inline-size: 100%; }
  .native-image-launcher .experience-image-reader__image { display: block; min-inline-size: 0; inline-size: auto; max-inline-size: 100%; block-size: auto; margin-inline: auto; object-fit: contain; }
  .native-image-launcher > .native-image-inline-result__status { padding-inline: var(--image-launcher-gutter); }
  .native-image-launcher__controls { padding-inline: var(--image-launcher-gutter); padding-block: 1rem; }
  .native-image-launcher__status { overflow-wrap: anywhere; }
  .native-image-launcher__actions { display: flex; flex-wrap: wrap; align-items: stretch; gap: .75rem; }
  .native-image-launcher__actions > button { min-inline-size: 44px; min-block-size: 44px; flex: 1 1 9rem; white-space: normal; overflow-wrap: anywhere; font: inherit; }
  .native-image-launcher__actions > button[hidden] { display: none; }
`;

type Inline = ReturnType<typeof createNativeImageInlineResult>;
type Entry = {
  binding: Readonly<object>; setup: NativeImageSetup; lifetime: NativeImageLauncherLifetime;
  token: NativeImageOpening | null; state: NativeImageControllerState | null;
  stopped: boolean; evaluating: boolean; installed: boolean;
  unsubscribe: (() => void) | null; region: HTMLElement | null;
  inline: Inline | null; target: NativeImageEditTarget | null;
  regionRef: (element: Element | undefined) => void; commit: () => unknown;
};
const regions = new WeakMap<Element, object>();
const targetKeys = ["openingId", "submissionId", "readId", "documentId", "jobId", "outputId", "sourceEventId", "generationId", "mediaUrl"] as const;
const statuses: readonly NativeImageControllerState["status"][] = ["ready", "blocked", "submitting", "submitted", "not-dispatched", "uncertain", "checking", "pending", "terminal", "unavailable", "matched", "retired"];
function sameTarget(a: NativeImageEditTarget | null, b: NativeImageEditTarget | null): boolean {
  return a !== null && b !== null && targetKeys.every(key => a[key] === b[key]);
}
function failures(errors: unknown[]): void {
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "native_image_launcher_failed", { cause: errors[0] });
}
function attempt(errors: unknown[], work: () => void): void { try { work(); } catch (error) { errors.push(error); } }
function imageText(value: Readonly<{ title: string; alt: string; caption: string }>) {
  const properties = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(properties).length !== 3) throw new TypeError("invalid_image_text");
  const out: Record<string, string> = {};
  for (const key of ["title", "alt", "caption"]) {
    const property = properties[key];
    if (!property || !("value" in property) || typeof property.value !== "string") throw new TypeError("invalid_image_text");
    out[key] = property.value;
  }
  return Object.freeze({ title: out.title!, alt: out.alt!, caption: out.caption! });
}

/** One presentation owner around an injected persistent I2 controller. The owner
 * forwards that controller's changed(state) here; no subscription is patched into
 * I2. Retire this launcher before replacing its DOM/instance, retaining I2 itself. */
export function createNativeImageLauncher(ports: NativeImageLauncherPorts) {
  const controller = ports.controller, changed = ports.changed, observe = ports.operation;
  const describe = ports.imageText, edit = ports.edit, close = ports.close;
  const admission = ports.admission, available = admission?.available, reserve = admission?.reserve;
  const labels = Object.freeze({ create: ports.labels.create, check: ports.labels.check, close: ports.labels.close,
    status: Object.freeze({ ...ports.labels.status }), image: Object.freeze({ ...ports.labels.image }) });
  if (typeof observe !== "function" || typeof describe !== "function" || typeof edit !== "function" ||
      (changed !== undefined && typeof changed !== "function") || (close !== undefined && typeof close !== "function") ||
      (admission !== undefined && (typeof available !== "function" || typeof reserve !== "function")) ||
      [labels.create, labels.check, labels.close, ...statuses.map(status => labels.status[status]), ...Object.values(labels.image)].some(value => typeof value !== "string"))
    throw new TypeError("invalid_image_launcher_ports");
  let entry: Entry | null = null, intent: object = {};
  let publishedImageBinding: Readonly<object> | null = null;
  let state: NativeImageLauncherState = Object.freeze({ binding: null, status: "retired", canCreate: false, canCheck: false, imageReady: false, imageStatus: null, editTarget: null });
  const owned = (value: Entry) => entry === value && !value.stopped;
  const snapshot = (value: Entry, retired = false): NativeImageLauncherState => Object.freeze({
    binding: value.binding, status: retired ? "retired" : value.state?.status ?? "retired",
    canCreate: !retired && value.state?.canCreate === true && (!available || available("create") === true),
    canCheck: !retired && value.state?.canCheck === true && (!available || available("check") === true),
    imageReady: !retired && value.inline?.state.ready === true,
    imageStatus: retired ? null : value.inline?.state.status ?? null,
    editTarget: !retired && value.inline?.state.ready === true ? value.inline.state.editTarget : null,
  });

  function retire(value: Entry, errors: unknown[] = [], notify = true): void {
    if (value.stopped) { failures(errors); return; }
    value.stopped = true;
    const wasCurrent = entry === value;
    if (wasCurrent) entry = null;
    const inline = value.inline, region = value.region, unsubscribe = value.unsubscribe, token = value.token;
    value.inline = null; value.target = null; value.region = null; value.unsubscribe = null; value.state = null;
    const withdrawn = snapshot(value, true);
    if (wasCurrent) { state = withdrawn; publishedImageBinding = null; }
    // Revoke before any callbacks; independent cleanup cannot wipe a newer entry.
    if (inline) attempt(errors, () => inline.retire());
    if (region && regions.get(region) === value.binding) attempt(errors, () => { region.hidden = true; });
    if (region && regions.get(region) === value.binding) attempt(errors, () => region.remove());
    if (unsubscribe) attempt(errors, unsubscribe);
    if (token) attempt(errors, () => controller.retire(token));
    if (notify && wasCurrent && entry === null && state === withdrawn && changed) attempt(errors, () => changed(withdrawn));
    failures(errors);
  }

  function live(value: Entry): boolean {
    if (!owned(value)) return false;
    if (value.evaluating) { retire(value); return false; }
    let current = false, visible = false;
    const errors: unknown[] = [];
    value.evaluating = true;
    try {
      current = value.lifetime.current() === true;
      if (owned(value) && current) visible = value.lifetime.presentationCurrent() === true;
    } catch (error) { errors.push(error); }
    finally { value.evaluating = false; }
    if (errors.length) { retire(value, errors); return false; }
    if (!owned(value)) return false;
    if (!current || !visible || (value.token && (controller.state.openingId !== value.token.id || controller.state.status === "retired"))) {
      retire(value); return false;
    }
    return true;
  }

  function currentTarget(value: Entry): NativeImageEditTarget | null {
    if (!live(value) || !value.token || !value.state || value.state.status !== "matched") return null;
    // I2 may replace an equivalent availability snapshot after changed returns.
    // Adopt only its actual state, retaining this presentation's exact image and
    // target. Never refresh/publish here: I3 may hold its currentness latch.
    const before = controller.state, image = before.image;
    if (before.openingId !== value.token.id || before.status !== "matched" || !image || image !== value.state.image) return null;
    const target = controller.editTarget(value.token);
    if (!live(value) || controller.state !== before || !target || !sameTarget(target, value.target)) return null;
    if (target.documentId !== value.setup.documentId || target.jobId !== image.jobId || target.outputId !== image.id ||
        target.sourceEventId !== image.sourceEventId || target.generationId !== image.generationId || target.mediaUrl !== image.mediaUrl) return null;
    value.state = before;
    return target;
  }

  function publish(value: Entry): void {
    if (!live(value) || !value.token || !value.state) return;
    const inline = value.inline;
    if (inline && !currentTarget(value)) { retire(value); return; }
    const before = value.state;
    if (!owned(value) || !before || controller.state !== before || value.inline !== inline) return;
    const next = snapshot(value);
    const imageBinding = inline?.state.binding ?? null;
    const equalTarget = state.editTarget === null && next.editTarget === null || sameTarget(state.editTarget, next.editTarget);
    if (state.binding === next.binding && state.status === next.status && state.canCreate === next.canCreate &&
        state.canCheck === next.canCheck && state.imageReady === next.imageReady && state.imageStatus === next.imageStatus &&
        publishedImageBinding === imageBinding && equalTarget) return;
    // Commit before changed: a synchronous host render sees no new publication.
    state = next; publishedImageBinding = imageBinding;
    try { changed?.(state); } catch (error) { retire(value, [error], false); }
    if (!live(value)) return;
    if (value.state === before && controller.state === before && value.inline === inline && inline && !currentTarget(value)) retire(value);
  }

  function dropInline(value: Entry): void {
    const previous = value.inline;
    value.inline = null; value.target = null;
    if (previous) previous.retire();
  }

  function refresh(value: Entry, incoming: NativeImageControllerState): void {
    if (!owned(value) || !value.installed || !value.token || incoming !== controller.state || incoming.openingId !== value.token.id) return;
    try {
      if (!live(value) || incoming !== controller.state) return;
      value.state = incoming;
      if (incoming.status !== "matched" || !incoming.image) dropInline(value);
      else {
        const target = controller.editTarget(value.token);
        if (!live(value) || incoming !== controller.state || value.state !== incoming) return;
        if (!target || target.documentId !== value.setup.documentId || target.jobId !== incoming.image.jobId ||
            target.outputId !== incoming.image.id || target.sourceEventId !== incoming.image.sourceEventId ||
            target.generationId !== incoming.image.generationId || target.mediaUrl !== incoming.image.mediaUrl) { retire(value); return; }
        if (!value.inline || !sameTarget(target, value.target)) {
          dropInline(value);
          if (!live(value) || incoming !== controller.state) return;
          const text = imageText(describe(incoming.image));
          if (!live(value) || incoming !== controller.state || value.state !== incoming ||
              !sameTarget(target, controller.editTarget(value.token))) return;
          if (!live(value) || incoming !== controller.state || value.state !== incoming) return;
          const binding: Inline = createNativeImageInlineResult({ ...text, width: incoming.image.width, height: incoming.image.height,
            editTarget: target, labels: labels.image }, {
            currentTarget: () => owned(value) && value.inline === binding ? currentTarget(value) : null,
            changed: (next: NativeImageInlineState) => {
              if (!owned(value) || value.inline !== binding || next.binding !== binding.state.binding) return;
              if (next.status === "retired") retire(value); else publish(value);
            },
            edit: (selected, event, readyCurrent) => {
              const current = () => owned(value) && value.inline === binding && live(value) &&
                sameTarget(selected, currentTarget(value)) && readyCurrent() && owned(value) && value.inline === binding && live(value) &&
                sameTarget(selected, currentTarget(value));
              if (!current()) return;
              try { edit(selected, event, current); } catch (error) { retire(value, [error], false); }
              if (owned(value) && value.inline === binding && !current()) retire(value);
            },
          });
          value.target = target; value.inline = binding;
        }
      }
      publish(value);
    } catch (error) { retire(value, [error], false); }
  }

  function perform(value: Entry, kind: "create" | "check", actionCurrent?: () => boolean): NativeImageOperation | null {
    if (!live(value) || !value.installed || !value.token) return null;
    const current = controller.state;
    if (current.openingId !== value.token.id || (kind === "create" ? !current.canCreate : !current.canCheck) ||
        (available && available(kind) !== true)) return null;
    if (actionCurrent && !actionCurrent()) { retire(value); return null; }
    const context = Object.freeze({ binding: value.binding, opening: value.token, kind });
    let operation: NativeImageOperation;
    let reservation: NativeImageLauncherReservation | null = null, invoked = false;
    try {
      if (reserve) {
        reservation = reserve(context);
        if (!reservation) return null;
        // A reservation is not presentation authority. Recheck the original
        // owner/action and I2 eligibility, but never test capacity against this
        // operation's own reservation. Keep cancellation local to this claim.
        let current = live(value) && value.installed && value.token === context.opening;
        if (current && actionCurrent && !actionCurrent()) { retire(value); current = false; }
        const after = controller.state;
        current = current && owned(value) && value.token === context.opening && after.openingId === context.opening.id &&
          (kind === "create" ? after.canCreate : after.canCheck);
        if (!current) {
          const cancelled = reservation;
          reservation = null;
          cancelled.cancelBeforeCreation();
          return null;
        }
      }
      // Once invoked, even a synchronous throw can leave work running. Only the
      // owner can retain/report that uncertainty; it is never safe cancellation.
      invoked = true;
      operation = kind === "create" ? controller.create(context.opening, value.setup) : controller.check(context.opening);
    } catch (error) {
      const errors = [error];
      if (reservation) {
        if (invoked) attempt(errors, () => reservation!.creationThrew(error));
        else attempt(errors, () => reservation!.cancelBeforeCreation());
      }
      retire(value, errors, false);
      throw error;
    }
    // Observe independently without replacing either original or retaining a
    // completed error history. The owner receives both, including falsy failures.
    const errors: unknown[] = [];
    attempt(errors, () => { void operation.ui.then(() => {}, () => {}); });
    attempt(errors, () => { void operation.settled.then(() => {}, () => {}); });
    attempt(errors, () => { if (owned(value)) live(value); });
    // Ownership handoff is required even after A retired or a guard threw. Its
    // captured context is not B's current UI or authority to publish diagnostics.
    attempt(errors, () => observe(operation, context));
    attempt(errors, () => { if (owned(value)) live(value); });
    if (errors.length) retire(value, errors, false);
    return operation;
  }

  function click(value: Entry, kind: "create" | "check" | "close", event: MouseEvent): void {
    const button = event.currentTarget as HTMLButtonElement | null, region = value.region;
    const exact = () => owned(value) && event.isTrusted === true && event.currentTarget === button && button !== null &&
      button.tagName === "BUTTON" && button.disabled === false && button.isConnected && region !== null && value.region === region &&
      regions.get(region) === value.binding && region.isConnected && region.contains(button);
    if (!exact()) return;
    if (kind === "close") {
      if (!live(value) || !exact()) return;
      const errors: unknown[] = [];
      if (close) attempt(errors, () => close(button!, () => exact() && live(value)));
      retire(value, errors);
    } else perform(value, kind, exact);
  }

  function template(value: Entry) {
    if (!live(value) || !value.state || value.state !== controller.state) return nothing;
    const canCreate = value.state.canCreate && (!available || available("create") === true);
    const canCheck = value.state.canCheck && (!available || available("check") === true);
    return html`<section class="native-image-launcher" ${ref(value.regionRef)}>
      ${value.inline?.render() ?? nothing}
      <div class="native-image-launcher__controls">
        <p class="native-image-launcher__status" role="status" aria-live="polite" dir="auto">${labels.status[value.state.status]}</p>
        <div class="native-image-launcher__actions">
          <button type="button" class=${canCreate ? "button primary" : "button"} ?hidden=${value.state.status === "matched"} ?disabled=${!canCreate} @click=${(event: MouseEvent) => click(value, "create", event)}>${labels.create}</button>
          <button type="button" class="button" ?disabled=${!canCheck} @click=${(event: MouseEvent) => click(value, "check", event)}>${labels.check}</button>
          <button type="button" class="button" @click=${(event: MouseEvent) => click(value, "close", event)}>${labels.close}</button>
        </div>
      </div>
    </section>`;
  }

  function open(input: Readonly<{ setup: unknown; lifetime: NativeImageLauncherLifetime }>): NativeImageOpening | null {
    const openingIntent = {}; intent = openingIntent;
    const setup = captureNativeImageSetup(input.setup), supplied = input.lifetime;
    const lifetime = Object.freeze({ current: supplied.current, presentationCurrent: supplied.presentationCurrent, subscribe: supplied.subscribe });
    if (!setup || Object.values(lifetime).some(value => typeof value !== "function")) throw new TypeError("invalid_image_launcher_opening");
    if (intent !== openingIntent) return null;
    if (entry) retire(entry);
    if (intent !== openingIntent || entry) return null;
    const value: Entry = { binding: Object.freeze({}), setup, lifetime, token: null, state: null,
      stopped: false, evaluating: false, installed: false, unsubscribe: null, region: null, inline: null, target: null,
      regionRef: () => {}, commit: () => nothing };
    value.regionRef = element => {
      if (!element) { if (owned(value) && value.region) retire(value); return; }
      const owner = regions.get(element);
      if (owner && owner !== value.binding) { retire(value); return; }
      if (!owned(value) || (value.region && value.region !== element)) {
        const errors: unknown[] = [];
        if (owned(value)) attempt(errors, () => retire(value));
        if (!regions.has(element) || regions.get(element) === value.binding)
          attempt(errors, () => { (element as HTMLElement).hidden = true; });
        if (!regions.has(element) || regions.get(element) === value.binding) attempt(errors, () => element.remove());
        failures(errors); return;
      }
      regions.set(element, value.binding); value.region = element as HTMLElement;
    };
    const commit = directive(class extends Directive {
      constructor(part: PartInfo) { super(part); if (part.type !== PartType.CHILD) throw new TypeError("Image launcher requires a child part"); }
      render() { return template(value); }
    });
    value.commit = () => commit();
    entry = value;
    try {
      if (!live(value)) return null;
      const unsubscribe = lifetime.subscribe(() => {
        if (!owned(value)) return;
        if (live(value) && value.token) refresh(value, controller.state);
      });
      if (typeof unsubscribe !== "function") throw new TypeError("invalid_image_lifetime_subscription");
      if (!owned(value)) { unsubscribe(); return null; }
      value.unsubscribe = unsubscribe;
      if (!live(value)) return null;
      value.installed = true;
      const token = controller.open({ documentId: setup.documentId, current: () => live(value) });
      // changed may run before open returns. No provisional token/state mounts.
      if (!owned(value) || intent !== openingIntent) { controller.retire(token); return null; }
      value.token = token;
      if (!live(value)) return null;
      refresh(value, controller.state);
      return owned(value) ? token : null;
    } catch (error) { retire(value, [error], false); throw error; }
  }

  return Object.freeze({
    open,
    controllerChanged: (incoming: NativeImageControllerState) => { const value = entry; if (value && incoming === controller.state) refresh(value, incoming); },
    create: () => entry ? perform(entry, "create") : null,
    check: () => entry ? perform(entry, "check") : null,
    render: () => { const value = entry; if (!value) return nothing; refresh(value, controller.state); return owned(value) ? keyed(value.binding, value.commit()) : nothing; },
    retire: () => { intent = {}; if (entry) retire(entry); },
    disconnect: () => { intent = {}; if (entry) retire(entry); },
    get state(): NativeImageLauncherState { return state; },
  });
}

import { html, nothing } from "lit";
import { Directive, directive, PartType, type PartInfo } from "lit/directive.js";
import { keyed } from "lit/directives/keyed.js";
import { ref } from "lit/directives/ref.js";
import type { NativeImageEditTarget } from "./native-image-controller.ts";

export type NativeImageInlineState = Readonly<{
  binding: Readonly<object>;
  status: "loading" | "ready" | "unavailable" | "retired";
  ready: boolean;
  editTarget: NativeImageEditTarget | null;
}>;
export type NativeImageInlineInput = Readonly<{
  title: string; alt: string; caption: string; width: number; height: number;
  editTarget: NativeImageEditTarget;
  labels: Readonly<{ loading: string; unavailable: string; edit: string }>;
}>;
export type NativeImageInlinePorts = Readonly<{
  currentTarget: () => NativeImageEditTarget | null;
  changed?: (state: NativeImageInlineState) => void;
  edit: (target: NativeImageEditTarget, event: MouseEvent, current: () => boolean) => void;
}>;

const targetKeys = ["openingId", "submissionId", "readId", "documentId", "jobId", "outputId", "sourceEventId", "generationId", "mediaUrl"] as const;
const owners = new WeakMap<Element, object>();
const sameTarget = (a: NativeImageEditTarget, b: NativeImageEditTarget | null) =>
  b !== null && targetKeys.every(key => a[key] === b[key]);
function throwFailures(errors: unknown[]): void {
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "native_image_inline_cleanup_failed", { cause: errors[0] });
}
function attempt(errors: unknown[], action: () => void): void { try { action(); } catch (error) { errors.push(error); } }
class CurrentImageDirective extends Directive {
  constructor(info: PartInfo) {
    super(info);
    if (info.type !== PartType.CHILD) throw new TypeError("native_image_inline_child_only");
  }
  render(currentTemplate: () => unknown) { return currentTemplate(); }
}
const currentImage = directive(CurrentImageDirective);

/** NEW reconstruction from the surviving Launcher/Host contracts. Presentation
 * only: no generation, job reads, decode/fetch loop or navigation. A matched
 * result mounts one normal image; only its actual load can enable guarded Edit.
 * The launcher owns synchronous source/auth/presentation lifetime retirement. */
export function createNativeImageInlineResult(input: NativeImageInlineInput, ports: NativeImageInlinePorts) {
  const { title, alt, caption, width, height } = input;
  const target = Object.freeze({ ...input.editTarget });
  const labels = Object.freeze({ ...input.labels });
  const { currentTarget, changed, edit } = ports;
  if ([title, alt, caption].some(value => typeof value !== "string") || !alt.trim()
    || !Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0
    || targetKeys.slice(0, 3).some(key => !Number.isSafeInteger(target[key]) || Number(target[key]) <= 0)
    || targetKeys.slice(3).some(key => typeof target[key] !== "string" || !String(target[key]).trim())
    || !target.mediaUrl.startsWith("/api/media/")
    || [labels.loading, labels.unavailable, labels.edit].some(value => typeof value !== "string" || !value.trim())
    || typeof currentTarget !== "function" || typeof edit !== "function" || changed !== undefined && typeof changed !== "function")
    throw new TypeError("invalid_native_image_inline_input");

  const binding = Object.freeze({});
  let state: NativeImageInlineState = Object.freeze({ binding, status: "loading", ready: false, editTarget: null });
  let region: HTMLElement | null = null, image: HTMLImageElement | null = null;
  let status: HTMLParagraphElement | null = null, action: HTMLButtonElement | null = null;
  let document: Document | null = null, evaluating = false, started = false, mountDeferred = false;
  let expectedUrl: string | null = null;
  const terminal = () => state.status === "retired" || state.status === "unavailable";
  const owned = (node: Element | null) => node !== null && owners.get(node) === binding;

  function finish(kind: "unavailable" | "retired", errors: unknown[] = []): void {
    if (state.status === "retired" || state.status === kind) { throwFailures(errors); return; }
    // Revoke authority before independent DOM cleanup or notification can reenter.
    state = Object.freeze({ binding, status: kind, ready: false, editTarget: null });
    const next = state, held = { region, image, status, action };
    region = null; image = null; status = null; action = null; document = null; expectedUrl = null;
    if (owned(held.action)) attempt(errors, () => { held.action!.disabled = true; });
    if (held.image) {
      if (owned(held.image)) attempt(errors, () => held.image!.removeAttribute("src"));
      attempt(errors, () => held.image!.removeEventListener("load", loaded));
      attempt(errors, () => held.image!.removeEventListener("error", failed));
    }
    if (owned(held.region)) attempt(errors, () => { held.region!.hidden = true; });
    for (const node of [held.image, held.action, held.status, held.region]) {
      if (owned(node)) attempt(errors, () => node!.remove());
      if (owned(node)) owners.delete(node!);
    }
    if (state === next) attempt(errors, () => changed?.(next));
    throwFailures(errors);
  }

  function live(): boolean {
    if (terminal()) return false;
    if (evaluating) { finish("retired"); return false; }
    let current: NativeImageEditTarget | null = null;
    const errors: unknown[] = [];
    evaluating = true;
    try { current = currentTarget(); } catch (error) { errors.push(error); }
    finally { evaluating = false; }
    if (errors.length) { finish("retired", errors); return false; }
    if (terminal()) return false;
    if (!sameTarget(target, current)) { finish("retired"); return false; }
    return true;
  }

  function placed(): boolean {
    return owned(region) && owned(image) && owned(status) && owned(action)
      && !region!.hidden && !image!.hidden && region!.ownerDocument === document
      && region!.contains(image) && region!.contains(status) && region!.contains(action);
  }
  function mounted(): boolean {
    return placed() && region!.isConnected && image!.isConnected && status!.isConnected && action!.isConnected;
  }
  function loadedImage(): boolean {
    if (!mounted() || image!.getAttribute("src") !== target.mediaUrl || !image!.currentSrc) return false;
    try {
      return expectedUrl !== null && new URL(image!.currentSrc, image!.ownerDocument.URL).href === expectedUrl
        && image!.complete && image!.naturalWidth === width && image!.naturalHeight === height;
    } catch { return false; }
  }
  function readyCurrent(): boolean {
    if (!live()) return false;
    if (state.status !== "ready") return false;
    if (!loadedImage()) { finish("unavailable"); return false; }
    return true;
  }
  function loaded(event: Event): void {
    if (terminal() || event.isTrusted !== true || event.currentTarget !== image || !live()) return;
    if (!loadedImage()) { finish("unavailable"); return; }
    if (state.status === "ready") return;
    state = Object.freeze({ binding, status: "ready", ready: true, editTarget: target });
    const next = state;
    try { action!.disabled = false; status!.textContent = ""; changed?.(next); }
    catch (error) { finish("retired", [error]); }
    if (state === next) readyCurrent();
  }
  function failed(event: Event): void {
    if (terminal() || event.isTrusted !== true || event.currentTarget !== image || !live()) return;
    finish("unavailable");
  }
  function activate(event: MouseEvent): void {
    const button = action;
    if (event.isTrusted !== true || event.currentTarget !== button || !button || button.disabled || !readyCurrent()) return;
    if (action !== button || !owned(button) || button.disabled || !mounted()) return;
    try { edit(target, event, readyCurrent); } catch (error) { finish("retired", [error]); }
    if (!terminal()) readyCurrent();
  }
  function start(): void {
    if (terminal() || started || !region || !image || !status || !action || !live()) return;
    // Lit calls new refs in its cloned fragment before inserting that fragment.
    // Give that one synchronous commit its microtask; never poll or load a
    // still-detached, stale or only partially connected presentation.
    if (!mountDeferred && placed() && [region, image, status, action].every(node => !node.isConnected)) {
      mountDeferred = true; queueMicrotask(start); return;
    }
    if (!mounted()) { finish("retired"); return; }
    const node = image;
    try {
      const base = new URL(node.ownerDocument.URL), selected = new URL(target.mediaUrl, base);
      if (!/^https?:$/.test(base.protocol) || selected.origin !== base.origin || !selected.pathname.startsWith("/api/media/")) {
        finish("unavailable"); return;
      }
      expectedUrl = selected.href;
      // Install both listeners before assigning src; no rendering pass retries a
      // request, and a cached image still needs its native load notification.
      node.addEventListener("load", loaded); node.addEventListener("error", failed);
      action.disabled = true; status.textContent = labels.loading; started = true;
      if (!live() || image !== node || !mounted()) return;
      node.setAttribute("src", target.mediaUrl);
      if (!terminal() && (!live() || image !== node || !mounted())) return;
    } catch (error) { finish("retired", [error]); }
  }
  function attach(kind: "region" | "image" | "status" | "action", node: Element | undefined): void {
    if (terminal()) return;
    const old = { region, image, status, action }[kind];
    if (!node) { if (old) finish("retired"); return; }
    const tag = { region: "SECTION", image: "IMG", status: "P", action: "BUTTON" }[kind];
    if (node.tagName !== tag || old && old !== node) { finish("retired"); return; }
    const previousOwner = owners.get(node);
    if (previousOwner && previousOwner !== binding) { finish("retired"); return; }
    if (kind === "region") { region = node as HTMLElement; document ??= node.ownerDocument; }
    if (kind === "image") image = node as HTMLImageElement;
    if (kind === "status") status = node as HTMLParagraphElement;
    if (kind === "action") action = node as HTMLButtonElement;
    owners.set(node, binding);
    start();
  }
  const regionRef = (node: Element | undefined) => attach("region", node);
  const imageRef = (node: Element | undefined) => attach("image", node);
  const statusRef = (node: Element | undefined) => attach("status", node);
  const actionRef = (node: Element | undefined) => attach("action", node);
  function template() {
    if (state.status === "retired") return nothing;
    if (state.status === "unavailable") return html`<p class="native-image-inline-result__status" role="status" aria-live="polite">${labels.unavailable}</p>`;
    if (!live()) return nothing;
    return html`<section class="native-image-inline-result experience-image-reader" ${ref(regionRef)}>
      ${title ? html`<h2 dir="auto" translate="no">${title}</h2>` : nothing}
      <img class="experience-image-reader__image" alt=${alt} width=${width} height=${height} ${ref(imageRef)}>
      ${caption ? html`<p dir="auto" translate="no">${caption}</p>` : nothing}
      <p class="native-image-inline-result__status" role="status" aria-live="polite" aria-atomic="true" ${ref(statusRef)}>${state.ready ? "" : labels.loading}</p>
      <button type="button" class="button native-image-inline-result__edit" ?disabled=${!state.ready} ${ref(actionRef)} @click=${activate}>${labels.edit}</button>
    </section>`;
  }
  return Object.freeze({ get state() { return state; },
    render: () => keyed(binding, currentImage(template)), retire: () => finish("retired") });
}

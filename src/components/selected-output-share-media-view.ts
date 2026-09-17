import { validateSelectedOutputShareMediaPublicOutput, type SelectedOutputShareMediaPublicOutput } from "../model/selected-output-share.ts";
import { accessVerifiedSelectedOutputShareMedia, disposeVerifiedSelectedOutputShareMedia,
  type SelectedOutputShareReadMedia, type VerifiedSelectedOutputShareMedia } from "../selected-output-share-media-client.ts";
import type { FormaLocaleController } from "./design-system/localization.ts";
import { selectedOutputShareCopy } from "./selected-output-share-messages.ts";
import "./selected-output-share-media-view.css";

export type SelectedOutputShareMediaLocale = Pick<FormaLocaleController, "locale" | "t" | "number" | "system">;
export type SelectedOutputShareMediaPresentation = Readonly<{ refresh: (locale: SelectedOutputShareMediaLocale) => void; dispose: () => void }>;
type Options = Readonly<{ locale: SelectedOutputShareMediaLocale; readMedia: SelectedOutputShareReadMedia;
  signal: AbortSignal; isCurrent: () => boolean; onReady?: (ready: boolean) => void }>;
type Preview = { refresh: (locale: SelectedOutputShareMediaLocale) => void; dispose: () => void };

/** The caller owns authority and its original expiry lease. This leaf owns only
 * deliberately loaded verified bytes and native presentation. No source URL,
 * private DTO, autoplay, provider action or durable view edit is accepted. */
export function mountSelectedOutputShareMedia(host: HTMLElement, output: SelectedOutputShareMediaPublicOutput,
  options: Options): SelectedOutputShareMediaPresentation {
  const captured = validateSelectedOutputShareMediaPublicOutput(output);
  if (!captured) throw Error("selected_output_media_unavailable");
  output = captured;
  const document = host.ownerDocument, root = document.createElement("section");
  root.className = "selected-output-share-media";
  const actions = document.createElement("div"), status = document.createElement("p"), playback = document.createElement("div"), previewHost = document.createElement("div");
  actions.className = "selected-output-share-media-actions";
  status.setAttribute("data-selected-media-status", ""); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  previewHost.setAttribute("data-selected-media-preview", "");
  const button = (name: string) => { const element = document.createElement("button"); element.type = "button";
    element.className = "button secondary"; element.setAttribute("data-selected-media-" + name, ""); actions.append(element); return element; };
  const load = button("load"), download = button("download"), view = button("view"), close = button("close");
  root.append(actions, status, playback, previewHost);
  let locale = options.locale, disposed = false, loading = false, failed = false, expired = false, ready = false;
  let file: VerifiedSelectedOutputShareMedia | null = null, url: string | null = null, player: HTMLMediaElement | null = null;
  let readOwner: AbortController | null = null, previewOwner: AbortController | null = null, preview: Preview | null = null, previewFailed = false;
  const expiresAt = Date.parse(output.expiresAt), expiryDeadline = performance.now() + Math.max(0, expiresAt - Date.now());
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  const current = () => {
    try { return !disposed && !options.signal.aborted && root.parentNode === host && root.isConnected && host.ownerDocument === document
      && Date.now() < expiresAt && performance.now() < expiryDeadline && options.isCurrent() === true; } catch { return false; }
  };
  const notify = (value: boolean) => { if (ready === value) return; ready = value;
    try { options.onReady?.(value); } catch { /* A consumer cannot prevent owned resource cleanup. */ } };
  const attempt = (action: () => void) => { try { action(); } catch { /* Continue every independent release. */ } };
  const endPreview = () => {
    const controller = previewOwner, owned = preview;
    previewOwner = null; preview = null; controller?.abort();
    if (owned) attempt(() => owned.dispose());
    previewHost.replaceChildren(); previewFailed = false;
  };
  const clearFile = () => {
    const controller = readOwner, media = player, objectUrl = url, handle = file;
    readOwner = null; player = null; url = null; file = null; loading = false;
    controller?.abort(); endPreview(); notify(false);
    if (media) {
      attempt(() => media.pause()); attempt(() => media.removeAttribute("src")); attempt(() => media.load());
    }
    playback.replaceChildren();
    if (objectUrl) attempt(() => URL.revokeObjectURL(objectUrl));
    disposeVerifiedSelectedOutputShareMedia(handle);
  };
  const draw = () => {
    if (disposed) return;
    const copy = selectedOutputShareCopy(locale.locale);
    root.lang = locale.locale;
    load.textContent = loading ? copy.loadingFile : copy.loadFile;
    load.setAttribute("aria-disabled", String(loading || file !== null));
    // A failed focus transfer must not remove the still-focused Load control.
    load.hidden = file !== null && document.activeElement !== load;
    download.textContent = copy.downloadFile; download.hidden = file === null;
    view.textContent = copy.viewModel;
    view.setAttribute("aria-disabled", String(previewOwner !== null));
    view.hidden = file === null || output.output !== "model3d" || previewOwner !== null && document.activeElement !== view;
    close.textContent = copy.closePreview; close.hidden = previewOwner === null;
    status.textContent = expired ? copy.fileExpired : failed || previewFailed ? copy.fileUnavailable : loading ? copy.loadingFile : "";
    if (player) player.setAttribute("aria-label", output.title);
  };
  const retire = (wasExpired: boolean) => { clearFile(); expired = wasExpired; failed = !wasExpired; draw(); };
  const check = () => { if (current()) return true; retire(Date.now() >= expiresAt || performance.now() >= expiryDeadline); return false; };
  const schedule = () => {
    const remaining = Math.min(expiresAt - Date.now(), expiryDeadline - performance.now());
    if (remaining <= 0 || !current()) { retire(remaining <= 0); return; }
    expiryTimer = setTimeout(() => { expiryTimer = undefined; schedule(); }, Math.min(remaining, 2_147_483_647));
  };
  const failPlayer = (media: HTMLMediaElement, objectUrl: string) => {
    if (!current() || player !== media || url !== objectUrl) return;
    const ownsFocus = document.activeElement === media;
    retire(false);
    if (ownsFocus && current() && load.isConnected) attempt(() => load.focus({ preventScroll: true }));
  };
  const start = async () => {
    if (!check() || loading || file) return;
    const controller = new AbortController(); readOwner = controller;
    loading = true; failed = expired = false; draw();
    const owns = () => readOwner === controller && !controller.signal.aborted && current();
    let received: VerifiedSelectedOutputShareMedia | null = null;
    try {
      received = await options.readMedia(output, { signal: controller.signal, isCurrent: owns });
      if (!owns()) return;
      const access = accessVerifiedSelectedOutputShareMedia(received, output);
      if (!access) throw Error("selected_output_media_unavailable");
      const objectUrl = URL.createObjectURL(access.blob);
      if (!owns()) { URL.revokeObjectURL(objectUrl); return; }
      file = received; received = null; url = objectUrl;
      if (output.output === "audio" || output.output === "video") {
        const media = document.createElement(output.output) as HTMLMediaElement;
        player = media; media.controls = true; media.preload = "none"; media.tabIndex = 0;
        if (output.output === "video") (media as HTMLVideoElement).playsInline = true;
        media.setAttribute("src", objectUrl); media.setAttribute("aria-label", output.title);
        media.addEventListener("error", () => failPlayer(media, objectUrl)); playback.append(media);
      }
      draw();
      if (document.activeElement === load && current()) attempt(() => (player ?? download).focus({ preventScroll: true }));
      if (!owns()) { clearFile(); return; }
      notify(true);
    } catch {
      if (owns()) { clearFile(); failed = true; }
    } finally {
      disposeVerifiedSelectedOutputShareMedia(received);
      if (readOwner === controller) loading = false;
      draw();
    }
  };
  load.addEventListener("click", () => { void start(); });
  load.addEventListener("blur", () => { queueMicrotask(draw); });
  download.addEventListener("click", () => {
    if (!check() || !file || !url) return;
    const access = accessVerifiedSelectedOutputShareMedia(file, output);
    if (!access) { retire(false); return; }
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = access.fileName; anchor.rel = "noreferrer";
    root.append(anchor);
    try { if (current()) anchor.click(); } finally { anchor.remove(); }
  });
  view.addEventListener("click", () => { void (async () => {
    if (!check() || output.output !== "model3d" || !file || previewOwner) return;
    const handle = file, controller = new AbortController(); previewOwner = controller; previewFailed = false; draw();
    // Close exists immediately. Transfer the focused origin before hiding it;
    // if focus fails, draw keeps that exact View control visible and inert.
    if (document.activeElement === view && current()) attempt(() => close.focus({ preventScroll: true }));
    draw();
    const owns = () => previewOwner === controller && !controller.signal.aborted && current() && file === handle;
    try {
      const module = await import("./selected-output-share-model3d-view.ts");
      if (!owns()) return;
      const mounted = await module.mountSelectedOutputShareModel3d(previewHost, handle, output,
        { locale, signal: controller.signal, isCurrent: owns });
      if (!owns()) { mounted.dispose(); return; }
      preview = mounted; preview.refresh(locale);
      if (document.activeElement === view && current()) attempt(() => close.focus({ preventScroll: true }));
    } catch { if (owns()) { endPreview(); previewFailed = true; } }
    finally { draw(); }
  })(); });
  view.addEventListener("blur", () => { queueMicrotask(draw); });
  close.addEventListener("click", () => {
    if (!check()) return;
    const ownsFocus = document.activeElement === close || previewHost.contains(document.activeElement);
    endPreview(); draw();
    if (ownsFocus && current()) attempt(() => view.focus({ preventScroll: true }));
  });
  const dispose = () => {
    if (disposed) return;
    disposed = true; options.signal.removeEventListener("abort", dispose);
    document.removeEventListener("visibilitychange", visibility);
    if (expiryTimer !== undefined) clearTimeout(expiryTimer);
    expiryTimer = undefined; clearFile(); root.remove();
  };
  const visibility = () => { if (document.visibilityState === "visible") { check(); draw(); } };
  host.append(root); options.signal.addEventListener("abort", dispose, { once: true });
  document.addEventListener("visibilitychange", visibility);
  if (!current()) dispose(); else { draw(); schedule(); }
  return Object.freeze({ dispose, refresh(next: SelectedOutputShareMediaLocale) { locale = next; if (check()) { preview?.refresh(locale); draw(); } } });
}

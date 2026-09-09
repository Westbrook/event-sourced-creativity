import { html, nothing, render } from "lit";
import type { FormaLocaleController } from "./design-system/localization";
import type { NativeRetainedOutputDto } from "../model/native-retained-output.ts";
import { renderVideoReel } from "./video-reel.ts";
import "./native-retained-video.css";

type VideoResult = Extract<NativeRetainedOutputDto, { output: "video" }>;
type VideoLocale = Pick<FormaLocaleController, "t" | "number" | "locale">;
export type NativeVideoCleanupAttempt = Readonly<{
  operation: "pause" | "remove-source" | "reset-resource" | "remove-root";
  outcome: "returned" | "threw";
  error?: unknown;
}>;
export type NativeVideoPresentation = Readonly<{ dispose: () => readonly NativeVideoCleanupAttempt[]; refresh: () => void }>;
export type NativeVideoHost = Readonly<{
  locale: VideoLocale;
  isCurrent: (result: VideoResult, host: HTMLElement) => boolean;
}>;

// Reuse the retained reader's adjacent native Text nodes without adding break
// characters or markup, preserving literal copy and complex-script shaping.
function headingText(value: string, document: Document, locale: string): string | DocumentFragment {
  const threshold = 1024, chunkSize = 256;
  if (value.length <= threshold || typeof Intl.Segmenter !== "function") return value;
  const segmenter = new Intl.Segmenter(locale, { granularity: "grapheme" });
  const segments = [...segmenter.segment(value)];
  const starts = [0];
  for (let start = 0; start < segments.length;) {
    if (/\s/u.test(segments[start]!.segment)) { start++; continue; }
    let end = start + 1;
    while (end < segments.length && !/\s/u.test(segments[end]!.segment)) end++;
    if (end - start > threshold) {
      for (let index = start + chunkSize; index < end; index += chunkSize) starts.push(segments[index]!.index);
    }
    start = end;
  }
  if (starts.length === 1) return value;
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < starts.length; index++) {
    fragment.append(document.createTextNode(value.slice(starts[index], starts[index + 1] ?? value.length)));
  }
  return fragment;
}


// Native adaptation of the retained manual media reader. The Host establishes
// exact retained authority, expiry and same-Document handoff. This leaf owns one
// explicit streaming player; content SHA is not a digest of its media bytes.
export function mountNativeRetainedVideo(host: HTMLElement, result: VideoResult, options: NativeVideoHost): NativeVideoPresentation {
  if (!Object.isFrozen(result)) throw new TypeError("immutable_result_required");
  const checkCurrent = options.isCurrent, locale = options.locale;
  const root = host.ownerDocument.createElement("article");
  root.className = "retained-story-reader native-retained-video";
  let retired = false, activated = false, opening = false;
  let headings: { title: string | DocumentFragment; clips: (string | DocumentFragment)[] } | undefined;
  const media = new Set<HTMLMediaElement>();
  const attempts: NativeVideoCleanupAttempt[] = [];
  let finalAttempts: readonly NativeVideoCleanupAttempt[] | undefined;
  const owned = () => !retired && root.parentNode === host && root.isConnected;
  const current = () => {
    if (!owned()) return false;
    try { return checkCurrent(result, host) === true && owned(); }
    catch { return false; }
  };
  const attempt = (operation: NativeVideoCleanupAttempt["operation"], action: () => void) => {
    try { action(); attempts.push(Object.freeze({ operation, outcome: "returned" })); }
    catch (error) { attempts.push(Object.freeze({ operation, outcome: "threw", error })); }
  };
  const releaseMedia = () => {
    const originals = [...media]; media.clear();
    for (const element of originals) {
      attempt("pause", () => element.pause());
      attempt("remove-source", () => element.removeAttribute("src"));
      attempt("reset-resource", () => element.load());
    }
  };
  const dispose = () => {
    if (retired) return finalAttempts ?? Object.freeze([...attempts]);
    retired = true; // Every old selection handler loses ownership before cleanup.
    releaseMedia();
    attempt("remove-root", () => root.remove());
    finalAttempts = Object.freeze([...attempts]);
    return finalAttempts;
  };
  const playerCurrent = (player: HTMLVideoElement) => {
    if (!activated || !media.has(player) || !root.contains(player)) return false;
    return current() && activated && media.has(player) && root.contains(player);
  };
  const activate = (event: Event) => {
    if (activated || opening) return;
    if (!current()) { dispose(); return; }
    const origin = event.currentTarget as HTMLButtonElement | null, document = host.ownerDocument;
    activated = true; opening = true;
    try { draw(); } catch (error) { dispose(); throw error; }
    try {
      const player = [...media][0];
      if (player && current() && media.has(player) && root.contains(player)
        && origin?.isConnected && root.contains(origin) && document.hasFocus() && document.activeElement === origin)
        player.focus({ preventScroll: true });
    } catch {
      // A failed ready-focus transfer cannot remove a still-focused Open part.
    }
    if (current()) {
      if (origin?.isConnected && document.activeElement === origin) {
        releaseMedia(); activated = false;
      }
      opening = false;
      try { draw(); } catch (error) { dispose(); throw error; }
    } else dispose();
  };
  const draw = () => {
    if (!current()) { dispose(); return; }
    headings ??= { title: headingText(result.title, host.ownerDocument, locale.locale),
      clips: result.content.clips.map(clip => headingText(clip.title, host.ownerDocument, locale.locale)) };
    const primary = result.content.primaryMedia;
    const playable = result.content.clips.filter(clip => clip.media !== null);
    const original = root.querySelector<HTMLVideoElement>(".forma-video-reel-player");
    const savedIndex = original && playerCurrent(original) ? original.dataset.sceneIndex : undefined;
    const selectedIndex = typeof savedIndex === "string" && /^(0|[1-9]\d*)$/u.test(savedIndex)
      && Number.isSafeInteger(Number(savedIndex)) && Number(savedIndex) < playable.length ? Number(savedIndex) : 0;
    const player = activated ? renderVideoReel(playable.map(clip => Object.freeze({
      id: clip.id, title: clip.title, mediaUrl: clip.media!.url, mediaType: clip.media!.mediaType,
    })), null, result.title, locale, { manual: true, isCurrent: playerCurrent, selectedIndex }) : nothing;
    const view = html`${result.title.trim() ? html`<h2 class="retained-story-title" dir="auto" translate="no">${headings.title}</h2>` : nothing}
      ${(primary || playable.length) && (!activated || opening) ? html`<button class="button secondary native-video-open" type="button" @click=${activate}>${locale.t("action.open", "Open")}</button>` : nothing}
      ${primary ? html`<section class="native-video-primary">
        <h3>${locale.t("video.retainedFile", "Video file")}</h3>
        ${activated ? html`<video class="native-video-primary-player" controls playsinline preload="none" tabindex="0"
          aria-label=${result.title || locale.t("artifact.video.label", "Video")} src=${primary.url}></video>` : nothing}
      </section>` : nothing}
      ${playable.length ? html`<section class="native-video-scenes">
        <h3>${locale.t("video.individualScenes", "Individual scenes")} (${locale.number(playable.length)})</h3>
        ${!primary && playable.length > 1 ? html`<p class="native-video-availability">${locale.t("video.sceneDescription", "{count} individually playable scenes in narrative order. A combined MP4 is not available.", { count: locale.number(playable.length) })}</p>` : nothing}
        ${player}
      </section>` : nothing}
      <pre class="retained-story-content" dir="auto" translate="no">${result.content.content_markdown}</pre>
      <ol class="native-video-clips">${result.content.clips.map((clip, index) => html`<li data-video-clip=${clip.id}>
        ${clip.title.trim() ? html`<h3 dir="auto" translate="no">${headings!.clips[index]}</h3>` : nothing}
        <p dir="auto" translate="no">${clip.body}</p><small dir="auto" translate="no">${clip.notes}</small>
        ${clip.media === null ? html`<p class="native-video-unavailable">${locale.t("lab.unavailable", "Unavailable")}</p>` : nothing}
      </li>`)}</ol>`;
    if (!current()) { dispose(); return; }
    try { render(view, root); }
    catch (error) {
      for (const element of root.querySelectorAll<HTMLMediaElement>("video")) media.add(element);
      dispose(); throw error;
    }
    for (const element of root.querySelectorAll<HTMLMediaElement>("video")) media.add(element);
    if (!current()) dispose();
  };
  host.append(root);
  try { draw(); } catch (error) { dispose(); throw error; }
  return Object.freeze({ dispose, refresh: () => {
    if (!current()) { dispose(); return; }
    try { draw(); } catch (error) { dispose(); throw error; }
  } });
}

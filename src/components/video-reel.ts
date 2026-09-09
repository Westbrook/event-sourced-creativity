import { html, nothing } from "lit";
import { live } from "lit/directives/live.js";
import type { FormaLocaleController } from "./design-system/localization";

export type VideoReelItem = {
  id?: string;
  source_artifact_item_id?: string;
  title: string;
  mediaUrl?: string | null;
  mediaType?: string | null;
  media_url?: string | null;
  media_type?: string | null;
  durationSeconds?: number | null;
  duration_seconds?: number | null;
};

type VideoScene = { id: string; title: string; url: string; duration: number | null };
export type VideoReelOptions = {
  /** Opt-in manual result presentation; existing callers retain reel playback. */
  manual?: boolean;
  /** The result owner rejects events from retired or replaced player elements. */
  isCurrent?: (player: HTMLVideoElement) => boolean;
  /** Current owned manual scene; locale refresh must not reset its resource. */
  selectedIndex?: number;
};

/** One accessible, honest player for original, shared, and adopted scene reels. */
export function renderVideoReel(items: readonly VideoReelItem[], fallbackUrl?: string | null, title = "Video", locale?: Pick<FormaLocaleController, "t" | "number">, options: VideoReelOptions = {}) {
  const number = (value: number) => locale?.number(value) ?? String(value);
  const copy = (id: string, fallback: string, values: Record<string, string | number> = {}) => locale?.t(id, fallback, values)
    ?? fallback.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ""));
  const scenes: VideoScene[] = items.flatMap((item, index) => {
    const url = item.mediaUrl ?? item.media_url;
    const mediaType = item.mediaType ?? item.media_type;
    if (!url || mediaType && !mediaType.startsWith("video/")) return [];
    return [{ id: item.id ?? item.source_artifact_item_id ?? `scene-${index + 1}`, title: item.title || `${copy("video.scene", "Scene")} ${number(index + 1)}`, url, duration: item.durationSeconds ?? item.duration_seconds ?? null }];
  });
  if (!scenes.length && fallbackUrl) scenes.push({ id: "scene-1", title: title || `${copy("video.scene", "Scene")} ${number(1)}`, url: fallbackUrl, duration: null });
  if (!scenes.length) return nothing;
  const selectedIndex = options.manual && Number.isSafeInteger(options.selectedIndex)
    && options.selectedIndex! >= 0 && options.selectedIndex! < scenes.length ? options.selectedIndex! : 0;

  const label = (index: number) => copy("video.scenePosition", "Scene {index} of {total}: {title}", { index: number(index + 1), total: number(scenes.length), title: scenes[index]?.title ?? copy("video.untitledScene", "Untitled scene") });
  const current = (player: HTMLVideoElement) => {
    try { return options.isCurrent ? options.isCurrent(player) === true : true; }
    catch { return false; }
  };
  const selectScene = (player: HTMLVideoElement, index: number, resume: boolean) => {
    const scene = scenes[index];
    if (!scene || !current(player)) return;
    if (options.manual) { player.pause(); if (!current(player)) return; }
    player.dataset.sceneIndex = String(index);
    player.src = scene.url;
    player.setAttribute("aria-label", label(index));
    const root = player.closest<HTMLElement>(".forma-video-reel");
    const picker = root?.querySelector<HTMLSelectElement>(".forma-video-reel-picker select");
    const status = root?.querySelector<HTMLElement>("[data-scene-status]");
    if (picker) picker.value = String(index);
    if (status) status.textContent = label(index);
    if (resume && !options.manual && current(player)) void player.play().catch(() => undefined);
  };

  return html`<section class="forma-video-reel" aria-label=${copy("video.reelLabel", "{title} video reel", { title })}>
    <video class="forma-video-reel-player output-input-video" controls playsinline preload=${options.manual ? "none" : "metadata"} data-scene-index=${String(selectedIndex)} aria-label=${label(selectedIndex)} src=${options.manual ? live(scenes[selectedIndex]!.url) : scenes[0]!.url}
      @ended=${(event: Event) => { if (options.manual) return; const player = event.currentTarget as HTMLVideoElement; const next = Number(player.dataset.sceneIndex ?? 0) + 1; if (next < scenes.length) selectScene(player, next, true); }}></video>
    ${scenes.length > 1 ? html`${options.manual ? nothing : html`<p class="forma-video-reel-description">${copy("video.sceneDescription", "{count} individually playable scenes in narrative order. A combined MP4 is not available.", { count: number(scenes.length) })}</p>`}
      <label class="forma-video-reel-picker">${copy("video.chooseScene", "Choose a scene")}<select @change=${(event: Event) => { const picker = event.currentTarget as HTMLSelectElement; const player = picker.closest<HTMLElement>(".forma-video-reel")?.querySelector<HTMLVideoElement>(".forma-video-reel-player"); if (player) selectScene(player, Number(picker.value), !player.paused); }}>
        ${scenes.map((scene, index) => html`<option value=${String(index)}>${copy("video.sceneChoice", "Scene {index} · {title}", { index: number(index + 1), title: scene.title })}${scene.duration ? ` · ${number(scene.duration)}s` : ""}</option>`)}
      </select></label><p class="forma-video-reel-status" role="status" aria-live="polite" aria-atomic="true" data-scene-status .textContent=${label(selectedIndex)}></p>` : nothing}
  </section>`;
}

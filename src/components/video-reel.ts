import { html, nothing } from "lit";

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

/** One accessible, honest player for original, shared, and adopted scene reels. */
export function renderVideoReel(items: readonly VideoReelItem[], fallbackUrl?: string | null, title = "Video") {
  const scenes: VideoScene[] = items.flatMap((item, index) => {
    const url = item.mediaUrl ?? item.media_url;
    const mediaType = item.mediaType ?? item.media_type;
    if (!url || mediaType && !mediaType.startsWith("video/")) return [];
    return [{ id: item.id ?? item.source_artifact_item_id ?? `scene-${index + 1}`, title: item.title || `Scene ${index + 1}`, url, duration: item.durationSeconds ?? item.duration_seconds ?? null }];
  });
  if (!scenes.length && fallbackUrl) scenes.push({ id: "scene-1", title: title || "Scene 1", url: fallbackUrl, duration: null });
  if (!scenes.length) return nothing;

  const label = (index: number) => `Scene ${index + 1} of ${scenes.length}: ${scenes[index]?.title ?? "Untitled scene"}`;
  const selectScene = (player: HTMLVideoElement, index: number, resume: boolean) => {
    const scene = scenes[index];
    if (!scene) return;
    player.dataset.sceneIndex = String(index);
    player.src = scene.url;
    player.setAttribute("aria-label", label(index));
    const root = player.closest<HTMLElement>(".forma-video-reel");
    const picker = root?.querySelector<HTMLSelectElement>(".forma-video-reel-picker select");
    const status = root?.querySelector<HTMLElement>("[data-scene-status]");
    if (picker) picker.value = String(index);
    if (status) status.textContent = label(index);
    if (resume) void player.play().catch(() => undefined);
  };

  return html`<section class="forma-video-reel" aria-label=${`${title} video reel`}>
    <video class="forma-video-reel-player output-input-video" controls playsinline preload="metadata" data-scene-index="0" aria-label=${label(0)} src=${scenes[0]!.url}
      @ended=${(event: Event) => { const player = event.currentTarget as HTMLVideoElement; const next = Number(player.dataset.sceneIndex ?? 0) + 1; if (next < scenes.length) selectScene(player, next, true); }}></video>
    ${scenes.length > 1 ? html`<p class="forma-video-reel-description">${scenes.length} individually playable scenes in narrative order. A combined MP4 is not available.</p>
      <label class="forma-video-reel-picker">Choose a scene<select @change=${(event: Event) => { const picker = event.currentTarget as HTMLSelectElement; const player = picker.closest<HTMLElement>(".forma-video-reel")?.querySelector<HTMLVideoElement>(".forma-video-reel-player"); if (player) selectScene(player, Number(picker.value), !player.paused); }}>
        ${scenes.map((scene, index) => html`<option value=${String(index)}>Scene ${index + 1} · ${scene.title}${scene.duration ? ` · ${scene.duration}s` : ""}</option>`)}
      </select></label><p class="forma-video-reel-status" role="status" aria-live="polite" aria-atomic="true" data-scene-status .textContent=${label(0)}></p>` : nothing}
  </section>`;
}

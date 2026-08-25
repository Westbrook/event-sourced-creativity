import { html, nothing } from "lit";
import type { FormaLocaleController } from "./design-system/localization";

export type SoundtrackAsset = {
  label?: string;
  media_url?: string | null;
  media_type?: string | null;
  duration_seconds?: number | null;
  inclusion?: string;
  provider_audio_transmitted?: boolean;
  transcript?: string;
  cues?: Array<{ start_seconds?: number; end_seconds?: number | null; target_kind?:string;target_id?:string;label?: string; emotional_intent?: string }>;
};

type AudioLocale = Pick<FormaLocaleController, "t" | "number">;

/** Native controls never autoplay, fetch remote URLs, or masquerade as embedded audio. */
export function renderAudioPlayer(url: string | null | undefined, title: string, locale: AudioLocale, options: { transcript?: string; description?: string; compact?: boolean } = {}) {
  if (!url || !url.startsWith("/api/media/") && !url.startsWith("/api/shared/")) return nothing;
  return html`<section class=${`forma-audio-player${options.compact ? " forma-audio-player--compact" : ""}`}>
    <audio controls preload="none" src=${url} aria-label=${locale.t("audio.player.label", "Play {name}", { name: title })}></audio>
    ${options.description ? html`<p class="forma-audio-description" dir="auto">${options.description}</p>` : nothing}
    ${options.transcript?.trim() ? html`<details class="forma-audio-transcript"><summary>${locale.t("audio.reference.transcript", "Transcript or listening notes")}</summary><p dir="auto">${options.transcript}</p></details>` : nothing}
  </section>`;
}

/** Provider-included clips already belong to the delivered video and must not play twice. */
export function soundtrackCompanions(value: unknown): SoundtrackAsset[] {
  return Array.isArray(value) ? value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const asset = entry as SoundtrackAsset;
    if (!asset.media_url || !String(asset.media_type ?? "").startsWith("audio/") || asset.provider_audio_transmitted === true || asset.inclusion === "provider-soundtrack-reference") return [];
    return [asset];
  }) : [];
}

export function renderSoundtrackCompanions(value: unknown, locale: AudioLocale,options:{followCues?:boolean;onFollowCues?:(enabled:boolean)=>void;onDownload?:(asset:SoundtrackAsset)=>void}={}) {
  const assets = soundtrackCompanions(value);
  if (!assets.length) return nothing;
  return html`<section class="forma-soundtrack-companions" aria-label=${locale.t("audio.soundtrack.label", "Optional soundtrack")}>
    <header><span>${locale.t("audio.soundtrack.companion", "Separate playback companion")}</span></header>
    ${assets.map((asset) => html`<div class="forma-soundtrack-companion"><b dir="auto">${asset.label}</b>${renderAudioPlayer(asset.media_url, asset.label ?? locale.t("artifact.audio.label", "Audio"), locale, { compact: true,transcript:asset.transcript })}${options.onDownload?html`<button type="button" class="button secondary compact" @click=${()=>options.onDownload?.(asset)}>${locale.t("audio.output.download","Download audio")}</button>`:nothing}
      ${asset.cues?.length ? html`<details class="forma-audio-cues"><summary>${locale.t("audio.generation.cues", "Musical cue sheet")}</summary><ol>${asset.cues.map((cue) => html`<li><time>${locale.number(cue.start_seconds ?? 0)}s</time> <span dir="auto">${[cue.target_kind?locale.t(`audio.target.${cue.target_kind}`,cue.target_kind):"",cue.label, cue.emotional_intent].filter(Boolean).join(" · ")}</span></li>`)}</ol></details>` : nothing}
    </div>`)}
    ${options.onFollowCues&&assets.some((asset)=>asset.cues?.some((cue)=>cue.target_kind==="slide"))?html`<label class="forma-soundtrack-follow"><input type="checkbox" .checked=${options.followCues===true} @change=${(event:Event)=>options.onFollowCues?.((event.currentTarget as HTMLInputElement).checked)}><span><b>${locale.t("audio.cues.follow","Follow slide cues")}</b><small>${locale.t("audio.cues.followDescription","When audio is already playing, moving between slides seeks to its matching cue. Audio never starts automatically.")}</small></span></label>`:nothing}
    <p class="forma-soundtrack-notice">${locale.t("audio.soundtrack.companionNotice", "This soundtrack is played alongside the output; it is not embedded in exported PDF or video files.")}</p>
  </section>`;
}

/** A provider-included spoken reference still needs a visible textual equivalent without replaying the track twice. */
export function renderIncludedSoundtrackTranscripts(value:unknown,locale:AudioLocale){
  const assets=Array.isArray(value)?value.flatMap((entry)=>{
    if(!entry||typeof entry!=="object")return[];
    const asset=entry as SoundtrackAsset;
    return (asset.provider_audio_transmitted===true||asset.inclusion==="provider-soundtrack-reference")&&asset.transcript?.trim()?[asset]:[];
  }):[];
  return assets.length?html`<section class="forma-included-audio-transcripts" aria-label=${locale.t("audio.reference.transcript","Transcript or listening notes")}>${assets.map((asset)=>html`<details class="forma-audio-transcript"><summary>${asset.label||locale.t("audio.reference.transcript","Transcript or listening notes")}</summary><p dir="auto">${asset.transcript}</p></details>`)}</section>`:nothing;
}

import { html, nothing } from "lit";
import { pcmWavPeaks, trimPcmWav, type PcmWavInfo } from "../model/audio-container.ts";
import { audioTrimCopy } from "./design-system/locales/audio-trim-messages.ts";
import { FormaPresentationalElement } from "./presentational-element";
import { captureOutputNavigationFocus } from "./output-navigation-focus";
import "./audio-trim-editor.css";

export type AudioTrimSelection = Readonly<{
  bytes: Uint8Array; info: PcmWavInfo; startFrame: number; endFrame: number;
}>;

/** The host owns private access and Save. This leaf only displays verified PCM
 * bytes and creates an explicitly requested local preview of its exact range. */
export class AudioTrimEditor extends FormaPresentationalElement {
  static properties = { selection: { attribute: false, noAccessor: true }, disabled: { type: Boolean } };
  disabled = false;
  #selection: AudioTrimSelection | null = null;
  #waveform = "";
  #previewUrl: string | null = null;
  #previewFailed = false;
  #invalidRange = false;
  #audio: HTMLAudioElement | null = null;

  get selection() { return this.#selection; }
  set selection(value: AudioTrimSelection | null) {
    const previous = this.#selection;
    if (previous === value) return;
    // Property assignment retires playback before a queued Lit render.
    this.#retirePreview();
    this.#selection = value;
    // An accepted host selection replaces both displayed numeric drafts. Lit's
    // cached .value binding alone may leave an invalid, user-edited value in an
    // otherwise unchanged bound. Keep incomplete input intact until acceptance.
    if (value) {
      for (const [selector, frame] of [[".audio-trim-start", value.startFrame], [".audio-trim-end", value.endFrame]] as const) {
        const input = this.querySelector<HTMLInputElement>(selector);
        const seconds = String(frame / value.info.sampleRate);
        // Preserve valid decimal typing (for example 0.20 while entering
        // 0.205) when it already denotes the accepted nearest PCM frame.
        if (input && (!Number.isFinite(input.valueAsNumber)
          || Math.round(input.valueAsNumber * value.info.sampleRate) !== frame)) input.value = seconds;
      }
    }
    this.#previewFailed = false; this.#invalidRange = false;
    if (previous?.bytes !== value?.bytes) {
      const peaks = value ? pcmWavPeaks(value.bytes) : null;
      this.#waveform = peaks?.map((peak, index) => {
        const x = (index + .5) / peaks.length * 1000, height = Math.max(.6, peak * 44);
        return `M${x.toFixed(3)} ${(50 - height).toFixed(3)}V${(50 + height).toFixed(3)}`;
      }).join(" ") ?? "";
    }
    this.requestUpdate("selection", previous);
  }

  #retirePreview() {
    const audio = this.#audio, url = this.#previewUrl;
    this.#audio = null; this.#previewUrl = null;
    try { audio?.pause(); } catch { /* Continue releasing the private source. */ }
    try { audio?.removeAttribute("src"); } catch { /* The node may be detached. */ }
    try { audio?.load(); } catch { /* The source is already removed. */ }
    if (url) URL.revokeObjectURL(url);
  }

  override disconnectedCallback() {
    this.#retirePreview();
    this.#selection = null; this.#waveform = "";
    super.disconnectedCallback();
  }

  protected override updated() {
    this.#audio = this.#previewUrl ? this.querySelector<HTMLAudioElement>("audio") : null;
    if (this.disabled && this.#previewUrl) { this.#retirePreview(); this.requestUpdate(); }
  }

  #change(part: "start" | "end", event: Event, seconds = false) {
    const selection = this.selection;
    if (!selection || this.disabled || !this.isConnected) return;
    const entered = (event.currentTarget as HTMLInputElement).valueAsNumber;
    // Time inputs offer useful hundredth-second keyboard steps. The retained
    // request still contains the single nearest exact PCM frame, never seconds.
    const value = seconds ? Math.round(entered * selection.info.sampleRate) : entered;
    const startFrame = part === "start" ? value : selection.startFrame;
    const endFrame = part === "end" ? value : selection.endFrame;
    if (!Number.isSafeInteger(startFrame) || !Number.isSafeInteger(endFrame)
      || startFrame < 0 || startFrame >= endFrame || endFrame > selection.info.frameCount) {
      this.#invalidRange = true; this.#retirePreview();
      this.dispatchEvent(new CustomEvent("audio-trim-invalid", { bubbles: true, composed: true }));
      this.requestUpdate(); return;
    }
    this.#retirePreview(); this.#previewFailed = false;
    this.dispatchEvent(new CustomEvent("audio-trim-change", {
      detail: { startFrame, endFrame }, bubbles: true, composed: true,
    }));
    this.requestUpdate();
  }

  async #loadPreview(event: Event) {
    const selection = this.selection;
    if (!selection || this.disabled || this.#invalidRange || !this.isConnected || this.#previewUrl) return;
    const preview = trimPcmWav(selection.bytes, selection.startFrame, selection.endFrame);
    if (!preview) { this.#previewFailed = true; this.requestUpdate(); return; }
    const origin = event.currentTarget as HTMLButtonElement, document = this.ownerDocument;
    const url = URL.createObjectURL(new Blob([new Uint8Array(preview.bytes)], { type: "audio/wav" }));
    this.#previewUrl = url; this.#previewFailed = false; this.requestUpdate();
    try {
      await this.updateComplete;
      const audio = this.#audio;
      // Loading alone never starts playback, and only the still-focused exact
      // native origin may transfer focus to its new native playback control.
      if (this.isConnected && this.selection === selection && !this.disabled && this.#previewUrl === url
        && this.ownerDocument === document && origin.isConnected && this.contains(origin)
        && document.activeElement === origin && audio?.isConnected && this.contains(audio)
        && audio.getAttribute("src") === url) audio.focus({ preventScroll: true });
    } catch { /* A failed render never acquires another element's focus. */ }
  }

  async #previewError(url: string, event: Event) {
    if (this.#previewUrl !== url) return;
    const document = this.ownerDocument, selection = this.selection, audio = event.currentTarget;
    const focus = audio === this.#audio && document.activeElement === audio ? captureOutputNavigationFocus(document) : null;
    this.#retirePreview(); this.#previewFailed = true; this.requestUpdate();
    if (!focus) return;
    const current = () => this.isConnected && this.ownerDocument === document && this.selection === selection
      && !this.disabled && this.#previewFailed && !this.#previewUrl && focus.current();
    try {
      await this.updateComplete;
      const target = this.querySelector<HTMLButtonElement>(".audio-trim-preview");
      if (current() && target?.isConnected && this.contains(target))
        focus.run(target, () => { if (!current()) return false; target.focus({ preventScroll: true }); return true; });
    } catch { /* A replaced source or interrupted focus cannot recover here. */ }
    finally { focus.dispose(); }
  }

  override render() {
    const selection = this.selection;
    if (!selection) return nothing;
    const copy = audioTrimCopy(this.i18n.locale), { info, startFrame, endFrame } = selection;
    const seconds = (frames: number) => this.i18n.number(frames / info.sampleRate, { maximumFractionDigits: 3 });
    const x = startFrame / info.frameCount * 1000, width = (endFrame - startFrame) / info.frameCount * 1000;
    const previewUrl = this.#previewUrl;
    return html`<section class="audio-trim-editor" dir=${this.i18n.direction}>
      <svg class="audio-trim-waveform" dir="ltr" viewBox="0 0 1000 100" role="img" aria-label=${copy.waveform} preserveAspectRatio="none">
        <rect class="audio-trim-selection" x=${x} y="0" width=${width} height="100"></rect>
        <path d=${this.#waveform}></path>
        <line x1=${x} x2=${x} y1="0" y2="100"></line>
        <line x1=${x + width} x2=${x + width} y1="0" y2="100"></line>
      </svg>
      <div class="audio-trim-ranges">
        <div class="audio-trim-bound"><label><span>${copy.start}</span>
          <input type="number" class="audio-trim-time audio-trim-start" dir="ltr" inputmode="decimal"
            min="0" max=${(endFrame - 1) / info.sampleRate} step="0.01" .value=${String(startFrame / info.sampleRate)}
            ?disabled=${this.disabled} aria-invalid=${String(this.#invalidRange)} @input=${(event: Event) => this.#change("start", event, true)}></label>
          <input type="range" dir="ltr" aria-label=${copy.start} aria-valuetext=${seconds(startFrame)}
            min="0" max=${endFrame - 1} step="1" .value=${String(startFrame)} ?disabled=${this.disabled}
            @input=${(event: Event) => this.#change("start", event)}></div>
        <div class="audio-trim-bound"><label><span>${copy.end}</span>
          <input type="number" class="audio-trim-time audio-trim-end" dir="ltr" inputmode="decimal"
            min="0" max=${info.frameCount / info.sampleRate} step="0.01" .value=${String(endFrame / info.sampleRate)}
            ?disabled=${this.disabled} aria-invalid=${String(this.#invalidRange)} @input=${(event: Event) => this.#change("end", event, true)}></label>
          <input type="range" dir="ltr" aria-label=${copy.end} aria-valuetext=${seconds(endFrame)}
            min=${startFrame + 1} max=${info.frameCount} step="1" .value=${String(endFrame)} ?disabled=${this.disabled}
            @input=${(event: Event) => this.#change("end", event)}></div>
      </div>
      ${this.#invalidRange ? html`<p role="status">${copy.status.invalid_range}</p>` : nothing}
      <p class="audio-trim-duration">${copy.duration.replace("{seconds}", seconds(endFrame - startFrame))}
        <small>${copy.sourceDuration.replace("{seconds}", seconds(info.frameCount))}</small></p>
      <button type="button" class="button secondary audio-trim-preview" aria-disabled=${String(this.disabled || this.#invalidRange || Boolean(previewUrl))}
        @click=${(event: Event) => this.#loadPreview(event)}>${copy.preview}</button>
      ${previewUrl ? html`<section class="forma-audio-player"><audio controls preload="none" tabindex="0"
        src=${previewUrl} aria-label=${copy.previewLabel} @error=${(event: Event) => this.#previewError(previewUrl, event)}></audio></section>` : nothing}
      ${this.#previewFailed ? html`<p role="status">${copy.previewUnavailable}</p>` : nothing}
    </section>`;
  }
}

if (!customElements.get("forma-audio-trim-editor")) customElements.define("forma-audio-trim-editor", AudioTrimEditor);

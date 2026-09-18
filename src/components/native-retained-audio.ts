import "./native-retained-audio.css";
import { audioTrimCopy } from "./design-system/locales/audio-trim-messages.ts";
import { html, nothing } from "lit";
import { keyed } from "lit/directives/keyed.js";
import type { FormaLocaleController } from "./design-system/localization.ts";
import type { NativeRetainedOutputDto } from "../model/native-retained-output.ts";
import { readNativeRetainedAudioMedia } from "../model/native-retained-audio-media.ts";
import { FormaPresentationalElement } from "./presentational-element";

type AudioResult = Extract<NativeRetainedOutputDto, { output: "audio" }>;
type AudioLocale = Pick<FormaLocaleController, "system" | "t" | "number"> & Partial<Pick<FormaLocaleController, "locale">>;
type AudioRecovery = { result: AudioResult; audio: HTMLAudioElement; document: Document };

/* The host owns retained-source access. This leaf owns only the explicit media
 * read and its verified Blob. Native playback never receives the mutable media
 * URL, starts automatically, or converts the input text into an audio editor.
 */
export class NativeRetainedAudio extends FormaPresentationalElement {
  static properties = { result: { attribute: false, noAccessor: true }, locale: { attribute: false } };
  locale: AudioLocale | null = null;
  #result: AudioResult | null = null;
  #controller: AbortController | null = null;
  #url: string | null = null;
  #audio: HTMLAudioElement | null = null;
  #loading = false;
  #failed = false;
  #recovery: AudioRecovery | null = null;

  get result() { return this.#result; }
  set result(value: AudioResult | null) {
    if (value === this.#result) return;
    const previous = this.#result;
    // Retire synchronously at property assignment, before Lit's next update.
    this.#retire();
    this.#result = value;
    this.#failed = false;
    this.requestUpdate("result", previous);
  }

  #retire() {
    const controller = this.#controller, audio = this.#audio, url = this.#url;
    this.#controller = null; this.#audio = null; this.#url = null; this.#loading = false;
    this.#recovery = null;
    controller?.abort();
    // Each release still runs if an already-detached native control throws.
    try { audio?.pause(); } catch { /* The node may already be retired. */ }
    try { audio?.removeAttribute("src"); } catch { /* Continue releasing the source. */ }
    try { audio?.load(); } catch { /* The source is already removed. */ }
    if (url) URL.revokeObjectURL(url);
  }

  override disconnectedCallback() {
    this.#retire();
    super.disconnectedCallback();
  }

  protected override updated() {
    this.#audio = this.#url ? this.querySelector<HTMLAudioElement>("audio") : null;
  }

  async #load(result: AudioResult, event: Event) {
    const media = result.content.media;
    if (!this.isConnected || this.result !== result || !(Date.parse(result.expiresAt) > Date.now()) || !media || this.#loading || this.#url) return;
    this.#recovery = null;
    const controller = new AbortController(), document = this.ownerDocument;
    const origin = event.currentTarget as HTMLButtonElement | null;
    this.#controller = controller; this.#loading = true; this.#failed = false; this.requestUpdate();
    const owned = () => this.isConnected && this.result === result && this.#controller === controller;
    const current = () => owned() && !controller.signal.aborted && Date.parse(result.expiresAt) > Date.now();
    try {
      const blob = await readNativeRetainedAudioMedia(media, { signal: controller.signal, current,
        origin: location.origin, request: (path, init) => fetch(path, init) });
      if (!current()) return;
      const url = URL.createObjectURL(blob);
      if (!current()) { URL.revokeObjectURL(url); return; }
      this.#url = url;
      // Keep the same enabled native origin until playback has rendered.
      // aria-disabled plus the loading guard prevents duplicate activation
      // without the native disabled-button blur that would lose ownership.
      this.requestUpdate();
      await this.updateComplete;
      const audio = this.#audio;
      if (current() && this.ownerDocument === document && origin?.isConnected && origin.tagName === "BUTTON"
        && this.contains(origin) && document.activeElement === origin && this.#url === url
        && audio?.isConnected && this.contains(audio) && audio.getAttribute("src") === url)
        audio.focus({ preventScroll: true });
    } catch {
      if (current()) this.#failed = true;
    } finally {
      if (owned()) {
        if (!current()) this.#retire();
        else if (this.#url && this.ownerDocument === document && origin?.isConnected && origin.tagName === "BUTTON"
          && this.contains(origin) && document.activeElement === origin) {
          // A failed render or focus transfer must leave this native Load part
          // usable. Release the ready bytes so an explicit retry is a real read.
          this.#retire(); this.#failed = true;
        } else { this.#controller = null; this.#loading = false; }
        this.requestUpdate();
      }
    }
  }

  #recoveryFocused(recovery: AudioRecovery) {
    return this.#recovery === recovery && this.isConnected && this.result === recovery.result
      && this.ownerDocument === recovery.document && Date.parse(recovery.result.expiresAt) > Date.now()
      && this.#failed && !this.#controller && !this.#url && !this.#loading
      && recovery.audio.isConnected && this.contains(recovery.audio)
      && recovery.document.activeElement === recovery.audio;
  }

  #audioBlur(event: Event) {
    const recovery = this.#recovery;
    if (!recovery || event.currentTarget !== recovery.audio) return;
    // Blur precedes the next activeElement. A later return to this exact node
    // still owns its focus; an old source's queued cleanup owns nothing.
    queueMicrotask(() => {
      if (this.#recovery === recovery && !this.#recoveryFocused(recovery)) {
        this.#recovery = null; this.requestUpdate();
      }
    });
  }

  async #audioError(result: AudioResult, url: string, event: Event) {
    const audio = event.currentTarget as HTMLAudioElement | null;
    if (!this.isConnected || this.result !== result || this.#url !== url || !audio?.isConnected
      || audio !== this.#audio || !this.contains(audio)) return;
    const document = this.ownerDocument;
    const recovery = document.activeElement === audio ? { result, audio, document } : null;
    this.#retire();
    if (!this.isConnected || this.result !== result || this.#controller || this.#url) return;
    this.#failed = true; this.#recovery = recovery; this.requestUpdate();
    if (!recovery) return;
    try {
      // Clear bytes immediately, but retain the focused native part until its
      // replacement has rendered. Source retirement invalidates this handoff.
      await this.updateComplete;
      const load = this.querySelector<HTMLButtonElement>("button");
      if (this.#recoveryFocused(recovery) && load?.isConnected && this.contains(load) && !load.disabled)
        load.focus({ preventScroll: true });
    } catch {
      // A failed render or native focus cannot transfer ownership elsewhere.
    } finally {
      if (this.#recovery === recovery) {
        if (!this.#recoveryFocused(recovery)) this.#recovery = null;
        this.requestUpdate();
      }
    }
  }

  override render() {
    const result = this.result;
    if (!result) return nothing;
    const locale = this.locale ?? this.i18n, content = result.content, url = this.#url;
    const timing = content.timing;
    const duration = timing ? locale.t(`audio.duration.${timing.basis}`,
      timing.basis === "measured" ? "Measured audio: {seconds}s" : timing.basis === "estimate"
        ? "Estimated audio duration: {seconds}s" : "Recorded audio duration: {seconds}s",
      { seconds: locale.number(timing.seconds) }) : null;
    return keyed(result, html`<section class="artifact-audio-result" aria-label=${locale.system("Audio")}>
      ${result.title.trim() ? html`<h2 dir="auto" translate="no">${result.title}</h2>` : nothing}
      ${!content.media || this.#failed ? html`<p role="status">${locale.t("lab.unavailable", "Unavailable")}</p>` : nothing}
      ${content.media && (!url || this.#loading) ? html`<button type="button" class="button secondary" aria-disabled=${String(this.#loading)}
        @click=${(event: Event) => this.#load(result, event)}>${locale.system(this.#loading ? "Loading audio…" : "Load audio")}</button>` : nothing}
      ${url || this.#recovery ? html`<section class="forma-audio-player"><audio controls preload="none" tabindex="0" src=${url ?? nothing}
        aria-label=${locale.t("audio.player.label", "Play {name}", { name: result.title })}
        @error=${url ? (event: Event) => this.#audioError(result, url, event) : nothing}
        @blur=${(event: Event) => this.#audioBlur(event)}></audio></section>` : nothing}
      ${duration ? html`<p class="forma-audio-description">${duration}</p>` : nothing}
      ${content.synthIdWatermarked ? html`<p>${locale.t("audio.generation.watermark", "Generated audio includes an embedded SynthID watermark.")}</p>` : nothing}
      <p>${audioTrimCopy(locale.locale ?? this.i18n.locale).nativeHint}</p>
      <details class="forma-audio-transcript"><summary>${locale.t("audio.reference.transcript", "Transcript or listening notes")}</summary>
        <pre dir="auto" translate="no">${content.content_markdown}</pre></details>
      ${content.lyrics ? html`<details class="forma-audio-transcript"><summary>${locale.t("audio.generation.lyrics", "Lyrics and production notes")}</summary>
        <pre dir="auto" translate="no">${content.lyrics}</pre></details>` : nothing}
    </section>`);
  }
}

if (!customElements.get("forma-native-retained-audio")) customElements.define("forma-native-retained-audio", NativeRetainedAudio);
declare global { interface HTMLElementTagNameMap { "forma-native-retained-audio": NativeRetainedAudio } }
export function renderNativeRetainedAudio(result: AudioResult, locale: AudioLocale) {
  return html`<forma-native-retained-audio .result=${result} .locale=${locale}></forma-native-retained-audio>`;
}

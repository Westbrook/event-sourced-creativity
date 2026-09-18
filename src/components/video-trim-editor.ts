import { html, nothing } from "lit";
import { VIDEO_PREFIX_TRIM_MAX_SAMPLES, type VideoPrefixInfo } from "../model/video-container.ts";
import { videoTrimCopy } from "./design-system/locales/video-trim-messages.ts";
import { FormaPresentationalElement } from "./presentational-element";
import "./video-trim-editor.css";

export type VideoTrimSelection = Readonly<{
  info: VideoPrefixInfo; startSample: 0; endSample: number;
}>;

let nextFieldForm = 0;

/** The host owns private access and Save. This quiet leaf selects an exact
 * encoded sample boundary without loading, decoding or playing media. */
export class VideoTrimEditor extends FormaPresentationalElement {
  static properties = { selection: { attribute: false, noAccessor: true }, disabled: { type: Boolean } };
  disabled = false;
  #selection: VideoTrimSelection | null = null;
  #prefixTicks: readonly number[] = [];
  #invalidRange = false;
  // An unassociated form ID keeps these native controls out of an enclosing
  // dirty form, including its implicit Enter submission and constraint checks.
  readonly #fieldForm = `forma-video-trim-fields-${++nextFieldForm}`;

  get selection() { return this.#selection; }
  set selection(value: VideoTrimSelection | null) {
    const previous = this.#selection;
    const ticks = [0];
    const info = value?.info;
    let valid = Boolean(value && info && value.startSample === 0
      && Number.isSafeInteger(value.endSample) && value.endSample >= 1
      && Number.isSafeInteger(info.sampleCount) && info.sampleCount >= 1
      && info.sampleCount <= VIDEO_PREFIX_TRIM_MAX_SAMPLES && value.endSample <= info.sampleCount
      && Number.isSafeInteger(info.timescale) && info.timescale > 0
      && Number.isSafeInteger(info.durationTicks) && info.durationTicks > 0
      && Number.isSafeInteger(info.width) && info.width > 0
      && Number.isSafeInteger(info.height) && info.height > 0
      && typeof info.sourceSha256 === "string" && /^[a-f0-9]{64}$/.test(info.sourceSha256)
      && Array.isArray(info.sampleDurationTicks) && info.sampleDurationTicks.length === info.sampleCount);
    if (valid && info) {
      for (const duration of info.sampleDurationTicks) {
        if (!Number.isSafeInteger(duration) || duration <= 0) { valid = false; break; }
        const sum = ticks[ticks.length - 1] + duration;
        if (!Number.isSafeInteger(sum)) { valid = false; break; }
        ticks.push(sum);
      }
      valid = valid && ticks[ticks.length - 1] === info.durationTicks
        && Number.isFinite(info.durationSeconds) && info.durationSeconds === info.durationTicks / info.timescale;
    }
    // Snapshot primitive inspection facts. A later mutation of the supplied
    // array cannot silently change a previously displayed endpoint or clock.
    this.#selection = valid && value && info ? Object.freeze({
      startSample: 0 as const, endSample: value.endSample,
      info: Object.freeze({ sampleCount: info.sampleCount, timescale: info.timescale,
        durationTicks: info.durationTicks, durationSeconds: info.durationSeconds,
        width: info.width, height: info.height, sourceSha256: info.sourceSha256,
        sampleDurationTicks: Object.freeze([...info.sampleDurationTicks]) }),
    }) : null;
    this.#prefixTicks = valid ? Object.freeze(ticks) : [];
    this.#invalidRange = false;
    if (this.#selection) {
      for (const selector of [".video-trim-end", ".video-trim-end-range"]) {
        const input = this.querySelector<HTMLInputElement>(selector);
        if (input && input.valueAsNumber !== this.#selection.endSample) input.value = String(this.#selection.endSample);
      }
    }
    this.requestUpdate("selection", previous);
  }

  override disconnectedCallback() {
    this.#selection = null; this.#prefixTicks = []; this.#invalidRange = false;
    super.disconnectedCallback();
  }

  #change(event: Event, renderedSelection: VideoTrimSelection) {
    const selection = this.#selection, input = event.currentTarget;
    if (!selection || selection !== renderedSelection || this.disabled || !this.isConnected
      || !(input instanceof HTMLInputElement) || !input.isConnected || !this.contains(input)
      || (input !== this.querySelector(".video-trim-end") && input !== this.querySelector(".video-trim-end-range"))) return;
    const endSample = input.valueAsNumber;
    if (!Number.isSafeInteger(endSample) || endSample < 1 || endSample > selection.info.sampleCount) {
      this.#invalidRange = true;
      this.dispatchEvent(new CustomEvent("video-trim-invalid", { bubbles: true, composed: true }));
      this.requestUpdate(); return;
    }
    // Only an accepted host assignment clears an invalid draft. A rejected or
    // stale host event cannot make a different endpoint appear ready to Save.
    this.dispatchEvent(new CustomEvent("video-trim-change", {
      detail: { startSample: 0, endSample }, bubbles: true, composed: true,
    }));
  }

  override render() {
    const selection = this.#selection;
    if (!selection) return nothing;
    const copy = videoTrimCopy(this.i18n.locale), { info, endSample } = selection;
    const ticks = this.#prefixTicks[endSample];
    const integer = (value: number) => this.i18n.number(value, { maximumFractionDigits: 0 });
    const seconds = (value: number) => this.i18n.number(value / info.timescale, { maximumFractionDigits: 6 });
    const duration = copy.duration.replace("{seconds}", seconds(ticks));
    const fraction = `${integer(ticks)} ÷ ${integer(info.timescale)}`;
    const exact = copy.exactTime.replace("{fraction}", `\u2066${fraction}\u2069`);
    const [beforeFraction, afterFraction] = copy.exactTime.split("{fraction}");
    return html`<section class="video-trim-editor" dir=${this.i18n.direction}>
      <p class="video-trim-fixed-start">${copy.start}</p>
      <div class="video-trim-bound"><label><span>${copy.end}</span>
        <input type="number" class="video-trim-end" dir="ltr" inputmode="numeric" form=${this.#fieldForm}
          min="1" max=${info.sampleCount} step="1" .value=${String(endSample)}
          ?disabled=${this.disabled} aria-invalid=${String(this.#invalidRange)}
          @input=${(event: Event) => this.#change(event, selection)}></label>
        <input type="range" class="video-trim-end-range" dir="ltr" form=${this.#fieldForm}
          aria-label=${copy.end} aria-valuetext=${`${integer(endSample)}; ${duration}; ${exact}`}
          min="1" max=${info.sampleCount} step="1" .value=${String(endSample)}
          ?disabled=${this.disabled} aria-invalid=${String(this.#invalidRange)}
          @input=${(event: Event) => this.#change(event, selection)}></div>
      ${this.#invalidRange ? html`<p role="status">${copy.status.invalid_range}</p>` : nothing}
      <p class="video-trim-duration">${duration}<small>${beforeFraction}<bdi dir="ltr">${fraction}</bdi>${afterFraction}</small>
        <small>${copy.sourceDuration.replace("{seconds}", seconds(info.durationTicks))}</small></p>
      <p>${copy.dimensions.replace("{width}", integer(info.width)).replace("{height}", integer(info.height))}</p>
      <p>${copy.interval.replaceAll("{end}", integer(endSample)).replace("{count}", integer(info.sampleCount))}</p>
      ${endSample === info.sampleCount ? html`<p class="video-trim-unchanged">${copy.status.unchanged}</p>` : nothing}
    </section>`;
  }
}

if (!customElements.get("forma-video-trim-editor")) customElements.define("forma-video-trim-editor", VideoTrimEditor);

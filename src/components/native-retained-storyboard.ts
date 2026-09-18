import { html, nothing } from "lit";
import { keyed } from "lit/directives/keyed.js";
import type { FormaLocaleController } from "./design-system/localization.ts";
import type { NativeRetainedOutputDto, NativeRetainedStoryboardFrame } from "../model/native-retained-output.ts";
import { savedStoryboardMediaUrl } from "../model/saved-storyboard-inspection.ts";
import { FormaPresentationalElement } from "./presentational-element";
import "./native-retained-storyboard.css";

type StoryboardResult = Extract<NativeRetainedOutputDto, { output: "storyboard" }>;
type StoryboardLocale = Pick<FormaLocaleController, "system">;

/* Read-only native content. The host establishes current retained source
 * custody and retires this entire leaf when that ends. Each image GET still
 * checks its own current media access and may fail or find no retained file.
 * The ordered list transposes the accepted pure storyboard-frames template;
 * no Experience identity, reference-image actions or duration is inferred.
 */
export class NativeRetainedStoryboard extends FormaPresentationalElement {
  static properties = { result: { attribute: false }, locale: { attribute: false } };
  result: StoryboardResult | null = null;
  locale: StoryboardLocale | null = null;
  #failedResult: StoryboardResult | null = null;
  #failedFrames = new Set<string>();

  protected override willUpdate() {
    if (this.#failedResult !== this.result) {
      this.#failedResult = this.result;
      this.#failedFrames.clear();
    }
  }

  #imageError(result: StoryboardResult, frame: NativeRetainedStoryboardFrame, event: Event) {
    const image = event.currentTarget as HTMLImageElement | null;
    if (!this.isConnected || this.result !== result || !image?.isConnected || !this.contains(image)) return;
    this.#failedFrames.add(frame.id);
    this.requestUpdate();
  }

  override render() {
    const result = this.result;
    if (!result) return nothing;
    const locale = this.locale ?? this.i18n;
    // A new retained result gets new image nodes; an old request's error cannot
    // be delivered through a reused node to the new result's error handler.
    return keyed(result, html`<section class="native-retained-storyboard-reader" aria-label=${locale.system("Storyboard")}>
      ${result.title.trim() ? html`<h2 class="native-retained-storyboard-title" dir="auto" translate="no">${result.title}</h2>` : nothing}
      <ol class="native-retained-storyboard-list" role="list">${result.content.frames.map(frame => {
        const image = frame.image;
        const url = image && savedStoryboardMediaUrl(image.url);
        return html`<li data-frame-id=${frame.id}>
          ${url && !this.#failedFrames.has(frame.id) ? html`<img class="native-retained-storyboard-image" src=${url}
            alt=${frame.title} width=${image?.width ?? nothing} height=${image?.height ?? nothing}
            loading="lazy" decoding="async" @error=${(event: Event) => this.#imageError(result, frame, event)}>`
            : html`<p class="native-retained-storyboard-unavailable">${locale.system("Image unavailable")}</p>`}
          <b class="native-retained-storyboard-frame-title" dir="auto" translate="no">${frame.title}</b>
          ${frame.body ? html`<p class="native-retained-storyboard-body" dir="auto" translate="no">${frame.body}</p>` : nothing}
          ${frame.notes || frame.imagePrompt ? html`<dl class="native-retained-storyboard-details">
            ${frame.notes ? html`<dt>${locale.system("Notes")}</dt><dd dir="auto" translate="no">${frame.notes}</dd>` : nothing}
            ${frame.imagePrompt ? html`<dt>${locale.system("Image prompt input")}</dt><dd dir="auto" translate="no">${frame.imagePrompt}</dd>` : nothing}
          </dl>` : nothing}
        </li>`;
      })}</ol>
    </section>`);
  }
}

if (!customElements.get("forma-native-retained-storyboard")) customElements.define("forma-native-retained-storyboard", NativeRetainedStoryboard);

declare global { interface HTMLElementTagNameMap { "forma-native-retained-storyboard": NativeRetainedStoryboard } }

export function renderNativeRetainedStoryboard(result: StoryboardResult, locale: StoryboardLocale) {
  return html`<forma-native-retained-storyboard .result=${result} .locale=${locale}></forma-native-retained-storyboard>`;
}

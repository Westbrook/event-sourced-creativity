import { html, nothing } from "lit";
import { documentArtifactDefinition, type DocumentArtifact } from "../model/document-artifacts";
import { positionImageAtFocalPoint } from "../model/image-focus";
import { focalPointCss } from "../model/focal-point";
import { icon } from "./icons";
import { FormaPresentationalElement } from "./presentational-element";
import "./icons-media";
import "./presentation-slide";
import "./video-cover";

/** One reusable visual summary for every non-image creative result, with focal-aware image previews. */
export class FormaArtifactSummary extends FormaPresentationalElement {
  static properties = { artifact: { attribute: false }, compact: { type: Boolean } };
  artifact?: DocumentArtifact; compact = false;

  private readonly coverLoaded = { capture: true, handleEvent: (event: Event) => {
    if (event.target instanceof HTMLImageElement) positionImageAtFocalPoint(event.target);
  } };

  override render() {
    const artifact = this.artifact;
    if (!artifact) return nothing;
    const definition = documentArtifactDefinition(artifact.kind);
    const first = artifact.items[0];
    const media = artifact.kind === "video" && artifact.mediaUrl
      ? html`<forma-video-cover .source=${artifact.mediaUrl} .label=${artifact.title} @load=${this.coverLoaded}></forma-video-cover>`
      : artifact.kind === "storyboard" && artifact.items.some((item) => item.mediaUrl)
        ? html`<div class="artifact-summary-frames">${artifact.items.filter((item) => item.mediaUrl).slice(0, 4).map((item) => html`<img src=${item.mediaUrl!} alt=${item.title} loading="lazy" decoding="async" style=${focalPointCss(item.focalPoint)} @load=${(event: Event) => positionImageAtFocalPoint(event.currentTarget as HTMLImageElement, item.focalPoint)}>` )}</div>`
        : artifact.kind === "slides" && first
          ? html`<forma-presentation-slide .item=${{ title: first.title, body: first.body, notes: first.notes, image_prompt: first.imagePrompt, slide: first.slide }} .presentation=${artifact.presentation} .index=${0} .total=${artifact.itemCount} .compact=${true}></forma-presentation-slide>`
          : html`<div class="artifact-summary-copy"><span aria-hidden="true">${icon(artifact.kind === "audio" ? "audio" : artifact.kind === "scene" ? "scene" : "story")}</span><p>${artifact.summary}</p></div>`;
    const label = this.i18n.t(`artifact.${artifact.kind}.label`, definition.label);
    return html`<div class=${`artifact-summary artifact-summary--${artifact.kind}${this.compact ? " compact" : ""}`} aria-label=${`${label}: \u2068${artifact.title}\u2069`}>${media}</div>`;
  }
}

if (!customElements.get("forma-artifact-summary")) customElements.define("forma-artifact-summary", FormaArtifactSummary);
declare global { interface HTMLElementTagNameMap { "forma-artifact-summary": FormaArtifactSummary; } }

import { html, LitElement, nothing } from "lit";
import { documentArtifactDefinition, type DocumentArtifact } from "../model/document-artifacts";
import type { CreativeOutput } from "../model/events";
import { FormaLocaleController } from "./design-system/localization";
import { completeRoutePopulation } from "../performance";
import { renderVideoReel, type VideoReelItem } from "./video-reel";
import "./artifact-summary";
import "./output-visual";

type SharedArtifact=DocumentArtifact&{contentMarkdown?:string|null;contentAvailable?:boolean};
type SharedProjection = { projectName: string; documentTitle: string; blocks: Array<{ id: string; type: string; handle: string; properties: Record<string, unknown> }>; outputs: CreativeOutput[]; artifacts: SharedArtifact[] };
type SharedResult = { kind: "image"; sequence: number; outputs: CreativeOutput[] } | { kind: "artifact"; sequence: number; artifact: SharedArtifact };

export class FormaSharedView extends LitElement {
  static properties = { token: { type: String } };
  token = ""; #loading = true; #error = ""; #projection: SharedProjection | null = null; #expiresAt = "";
  #i18n = new FormaLocaleController(this);
  protected override createRenderRoot() { return this; }
  override connectedCallback() { super.connectedCallback(); void this.#load(); }
  async #load() {
    try {if(!this.token.trim())throw new Error("Shared view unavailable");const response = await fetch(`/api/shared/${encodeURIComponent(this.token)}`); const body = await response.json() as { projection?: SharedProjection; share?: { expiresAt: string }; error?: string }; if (!response.ok || !body.projection) throw new Error(body.error ?? "Shared view unavailable"); this.#projection = body.projection; this.#expiresAt = body.share?.expiresAt ?? ""; }
    catch (error) { this.#error = error instanceof Error ? error.message : "Shared view unavailable"; }
    finally { this.#loading = false;this.requestUpdate();void this.updateComplete.then(()=>completeRoutePopulation(location.pathname)); }
  }

  #results(projection: SharedProjection): SharedResult[] {
    const imageGroups = new Map<string, CreativeOutput[]>();
    for (const output of projection.outputs) {
      const key = output.promptFanId ? `fan:${output.promptFanId}` : `image:${output.id}`;
      const existing = imageGroups.get(key);
      if (existing) existing.push(output);
      else imageGroups.set(key, [output]);
    }
    const images: SharedResult[] = [...imageGroups.values()].map((outputs) => ({ kind: "image", sequence: Math.max(...outputs.map((output) => output.sequence)), outputs }));
    const artifacts: SharedResult[] = (projection.artifacts ?? []).map((artifact) => ({ kind: "artifact", sequence: artifact.sequence, artifact }));
    return [...images, ...artifacts].sort((left, right) => right.sequence - left.sequence);
  }

  #artifactDetails(artifact: SharedArtifact) {
    if (artifact.kind === "video" && artifact.mediaUrl) return renderVideoReel(artifact.items, artifact.mediaUrl, artifact.title);
    if (artifact.kind === "slides") return html`<div class="shared-slide-list">${artifact.items.map((item, index) => html`<forma-presentation-slide .item=${{ title: item.title, body: item.body, notes: item.notes, image_prompt: item.imagePrompt, slide: item.slide }} .presentation=${artifact.presentation} .index=${index} .total=${artifact.itemCount} .compact=${true}></forma-presentation-slide>`)}</div>`;
    if(artifact.kind==="short_story"||artifact.kind==="scene")return typeof artifact.contentMarkdown==="string"?html`<pre class="shared-artifact-copy" dir="auto">${artifact.contentMarkdown}</pre>`:html`<p class="shared-artifact-unavailable">The original full writing is no longer available; retained titles and summary are shown.</p><ol class="shared-narrative-list">${artifact.items.map((item)=>html`<li><b dir="auto">${item.title}</b>${item.body?html`<p dir="auto">${item.body}</p>`:nothing}</li>`)}</ol>`;
    return html`<ol class=${artifact.kind === "storyboard" ? "shared-storyboard-list" : "shared-narrative-list"}>${artifact.items.map((item) => html`<li>${item.mediaUrl ? html`<img src=${item.mediaUrl} alt=${item.title} loading="lazy">` : nothing}<b dir="auto">${item.title}</b>${item.body ? html`<p dir="auto">${item.body}</p>` : nothing}${item.notes ? html`<small dir="auto">${item.notes}</small>` : nothing}</li>`)}</ol>`;
  }

  #result(result: SharedResult, projection: SharedProjection) {
    if (result.kind === "artifact") {
      const artifact = result.artifact;
      const definition = documentArtifactDefinition(artifact.kind);
      const label = this.#i18n.t(`artifact.${artifact.kind}.label`, definition.label);
      const unit = artifact.kind === "slides" ? "slides" : artifact.kind === "storyboard" ? "shots" : artifact.kind === "video" ? "scenes" : "parts";
      const count = this.#i18n.plural(`shared.${unit}`, artifact.itemCount, `{count} ${unit === "parts" ? "part" : unit === "shots" ? "shot" : unit === "scenes" ? "scene" : "slide"}`, `{count} ${unit}`);
      return html`<section class="shared-output shared-artifact"><forma-artifact-summary .artifact=${artifact} .compact=${true}></forma-artifact-summary><div class="shared-result-description"><b dir="auto">${artifact.title}</b><small>${label} · ${count}</small></div><details class="shared-result-details"><summary>${this.#i18n.t("shared.view", "View {format}", { format: label })}</summary>${this.#artifactDetails(artifact)}</details></section>`;
    }
    const fan = result.outputs.length > 1;
    return html`<section class=${`shared-output${fan ? " shared-output-fan" : ""}`}><div class="shared-output-images">${result.outputs.map((output) => output.mediaUrl ? html`<forma-output-visual .output=${output} .fanOutputs=${projection.outputs} .interactive=${true} .readOnly=${true}></forma-output-visual>` : html`<span class="shared-output-empty">${this.#i18n.t("shared.imageUnavailable", "Image unavailable")}</span>`)}</div><div class="shared-result-description"><b>${fan ? this.#i18n.plural("shared.alternatives", result.outputs.length, "{count} creative alternative", "{count} creative alternatives") : result.outputs[0]?.purpose === "ideate" ? this.#i18n.t("shared.exploration", "Exploration draft") : this.#i18n.t("shared.finishedImage", "Finished image")}</b><small>${fan ? this.#i18n.t("shared.alternativesDetail", "One result shown through different prompt approaches") : this.#i18n.t("shared.generatedDetail", "Generated from the shared creative direction")}</small></div></section>`;
  }

  override render() {
    if (this.#loading) return html`<main class="shared-view"><div class="shared-status" role="status">${this.#i18n.t("shared.loading", "Opening this shared creative document…")}</div></main>`;
    if (this.#error || !this.#projection) return html`<main class="shared-view"><div class="shared-status"><span>${this.#i18n.t("shared.unavailable", "Link unavailable")}</span><h1>${this.#i18n.t("shared.expired", "This view has expired or been revoked.")}</h1><p>${this.#i18n.t("shared.noData", "No project data was returned.")}</p></div></main>`;
    const p = this.#projection;
    const results = this.#results(p);
    const expires = this.#expiresAt ? this.#i18n.date(new Date(this.#expiresAt), { dateStyle: "medium", timeStyle: "short" }) : "";
    return html`<main class="shared-view"><header><div class="brand"><span class="brand-mark">F</span><span>Forma</span></div><span>${this.#i18n.t("shared.expires", "Private · view only · expires {date}", { date: expires })}</span></header><section class="shared-hero"><h1 dir="auto">${p.documentTitle}</h1><p><bdi dir="auto">${p.projectName}</bdi> · ${this.#i18n.t("shared.description", "A private, read-only view of this document and its creative results.")}</p></section><section class="shared-grid"><div><h2>${this.#i18n.t("shared.direction", "Creative direction")}</h2>${p.blocks.map((block) => {const video=block.properties.source_artifact_kind==="video"||String(block.properties.media_type??"").startsWith("video/");const structure=block.properties.artifact_structure&&typeof block.properties.artifact_structure==="object"?block.properties.artifact_structure as Record<string,unknown>:{};const items=Array.isArray(structure.items)?structure.items as VideoReelItem[]:[];const label=String(block.properties.label??block.handle);const copy=typeof block.properties.artifact_markdown==="string"?block.properties.artifact_markdown:String(block.properties.text??block.properties.label??this.#i18n.t("shared.retainedDecision","A retained creative decision"));return html`<article><small dir="ltr">${block.type}</small><h3 dir="auto">${label}</h3>${video?renderVideoReel(items,typeof block.properties.media_url==="string"?block.properties.media_url:null,label):typeof block.properties.media_url === "string" ? html`<img class="shared-reference-image" src=${block.properties.media_url} alt=${label} loading="lazy">` : nothing}<p dir="auto">${copy}</p></article>`;})}</div><aside><h2>${this.#i18n.t("shared.results", "Creative results")}</h2>${results.length ? results.map((result) => this.#result(result, p)) : html`<p>${this.#i18n.t("shared.noResults", "No results have been shared yet.")}</p>`}</aside></section><footer>${this.#i18n.t("shared.footer", "This link provides access only to the selected document and can be revoked immediately.")}</footer></main>`;
  }
}
customElements.define("forma-shared-view", FormaSharedView);

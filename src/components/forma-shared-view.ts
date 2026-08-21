import { html, LitElement, nothing } from "lit";
import { documentArtifactDefinition, type DocumentArtifact } from "../model/document-artifacts";
import type { CreativeOutput } from "../model/events";
import "./artifact-summary";
import "./output-visual";

type SharedProjection = { projectName: string; documentTitle: string; blocks: Array<{ id: string; type: string; handle: string; properties: Record<string, unknown> }>; outputs: CreativeOutput[]; artifacts: DocumentArtifact[] };
type SharedResult = { kind: "image"; sequence: number; outputs: CreativeOutput[] } | { kind: "artifact"; sequence: number; artifact: DocumentArtifact };

export class FormaSharedView extends LitElement {
  static properties = { token: { type: String } };
  token = ""; #loading = true; #error = ""; #projection: SharedProjection | null = null; #expiresAt = "";
  protected override createRenderRoot() { return this; }
  override connectedCallback() { super.connectedCallback(); void this.#load(); }
  async #load() {
    try { const response = await fetch(`/api/shared/${encodeURIComponent(this.token)}`); const body = await response.json() as { projection?: SharedProjection; share?: { expiresAt: string }; error?: string }; if (!response.ok || !body.projection) throw new Error(body.error ?? "Shared view unavailable"); this.#projection = body.projection; this.#expiresAt = body.share?.expiresAt ?? ""; }
    catch (error) { this.#error = error instanceof Error ? error.message : "Shared view unavailable"; }
    finally { this.#loading = false; this.requestUpdate(); }
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

  #artifactDetails(artifact: DocumentArtifact) {
    if (artifact.kind === "video" && artifact.mediaUrl) return html`<video controls playsinline preload="metadata" src=${artifact.mediaUrl}></video>`;
    if (artifact.kind === "slides") return html`<div class="shared-slide-list">${artifact.items.map((item, index) => html`<forma-presentation-slide .item=${{ title: item.title, body: item.body, notes: item.notes, image_prompt: item.imagePrompt, slide: item.slide }} .presentation=${artifact.presentation} .index=${index} .total=${artifact.itemCount} .compact=${true}></forma-presentation-slide>`)}</div>`;
    return html`<ol class=${artifact.kind === "storyboard" ? "shared-storyboard-list" : "shared-narrative-list"}>${artifact.items.map((item) => html`<li>${item.mediaUrl ? html`<img src=${item.mediaUrl} alt=${item.title} loading="lazy">` : nothing}<b>${item.title}</b>${item.body ? html`<p>${item.body}</p>` : nothing}${item.notes ? html`<small>${item.notes}</small>` : nothing}</li>`)}</ol>`;
  }

  #result(result: SharedResult, projection: SharedProjection) {
    if (result.kind === "artifact") {
      const artifact = result.artifact;
      const definition = documentArtifactDefinition(artifact.kind);
      return html`<section class="shared-output shared-artifact"><forma-artifact-summary .artifact=${artifact} .compact=${true}></forma-artifact-summary><div class="shared-result-description"><b>${artifact.title}</b><small>${definition.label} · ${artifact.itemCount} ${artifact.kind === "slides" ? "slides" : artifact.kind === "storyboard" ? "shots" : artifact.itemCount === 1 ? "part" : "parts"}</small></div><details class="shared-result-details"><summary>View ${definition.label.toLowerCase()}</summary>${this.#artifactDetails(artifact)}</details></section>`;
    }
    const fan = result.outputs.length > 1;
    return html`<section class=${`shared-output${fan ? " shared-output-fan" : ""}`}><div class="shared-output-images">${result.outputs.map((output) => output.mediaUrl ? html`<forma-output-visual .output=${output} .fanOutputs=${projection.outputs} .interactive=${true} .readOnly=${true}></forma-output-visual>` : html`<span class="shared-output-empty">Image unavailable</span>`)}</div><div class="shared-result-description"><b>${fan ? `${result.outputs.length} creative alternatives` : result.outputs[0]?.purpose === "ideate" ? "Exploration draft" : "Finished image"}</b><small>${fan ? "One result shown through different prompt approaches" : "Generated from the shared creative direction"}</small></div></section>`;
  }

  override render() {
    if (this.#loading) return html`<main class="shared-view"><div class="shared-status" role="status">Opening this shared creative document…</div></main>`;
    if (this.#error || !this.#projection) return html`<main class="shared-view"><div class="shared-status"><span>Link unavailable</span><h1>This view has expired or been revoked.</h1><p>No project data was returned.</p></div></main>`;
    const p = this.#projection;
    const results = this.#results(p);
    return html`<main class="shared-view"><header><div class="brand"><span class="brand-mark">F</span><span>Forma</span></div><span>Private · view only · expires ${new Date(this.#expiresAt).toLocaleString()}</span></header><section class="shared-hero"><h1>${p.documentTitle}</h1><p>${p.projectName} · A private, read-only view of this document and its creative results.</p></section><section class="shared-grid"><div><h2>Creative direction</h2>${p.blocks.map((block) => html`<article><small>${block.type}</small><h3>${block.handle}</h3>${typeof block.properties.media_url === "string" ? html`<img class="shared-reference-image" src=${block.properties.media_url} alt=${block.handle} loading="lazy">` : nothing}<p>${String(block.properties.text ?? block.properties.label ?? "A retained creative decision")}</p></article>`)}</div><aside><h2>Creative results</h2>${results.length ? results.map((result) => this.#result(result, p)) : html`<p>No results have been shared yet.</p>`}</aside></section><footer>This link provides access only to the selected document and can be revoked immediately.</footer></main>`;
  }
}
customElements.define("forma-shared-view", FormaSharedView);

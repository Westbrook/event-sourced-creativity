import { html, LitElement } from "lit";

type SharedProjection = { projectName: string; documentTitle: string; blocks: Array<{ id: string; type: string; handle: string; properties: Record<string, unknown> }>; outputs: Array<{ id: string; modelId: string; variant: number; sequence: number; mediaUrl:string|null; width:number|null; height:number|null }> };

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
  override render() {
    if (this.#loading) return html`<main class="shared-view"><div class="shared-status">Opening private read-only projection…</div></main>`;
    if (this.#error || !this.#projection) return html`<main class="shared-view"><div class="shared-status"><span>Link unavailable</span><h1>This view has expired or been revoked.</h1><p>No project data was returned.</p></div></main>`;
    const p = this.#projection; return html`<main class="shared-view"><header><div class="brand"><span class="brand-mark">F</span><span>Forma</span></div><span>Private · read-only · expires ${new Date(this.#expiresAt).toLocaleString()}</span></header><section class="shared-hero"><span class="eyebrow">Witnessed creative projection</span><h1>${p.documentTitle}</h1><p>${p.projectName} · shared without edit, export, or event-append authority.</p></section><section class="shared-grid"><div><span class="eyebrow">Creative context</span>${p.blocks.map((block) => html`<article><small>${block.type}</small><h2>${block.handle}</h2><p>${String(block.properties.text ?? block.properties.label ?? "Structured creative context")}</p></article>`)}</div><aside><span class="eyebrow">Generated objects</span>${p.outputs.length ? p.outputs.slice(0, 4).map((output) => html`<div class="shared-output">${output.mediaUrl?html`<img src=${output.mediaUrl} alt=${`Generated image ${output.id}`} width=${output.width??1536} height=${output.height??1024}>`:html`<span class="shared-output-empty">Image unavailable</span>`}<b>${output.id}</b><small>${output.modelId} · event #${output.sequence}</small></div>`) : html`<p>No generated objects are included yet.</p>`}</aside></section><footer>Built from an immutable event stream. Revocation takes effect immediately.</footer></main>`;
  }
}
customElements.define("forma-shared-view", FormaSharedView);

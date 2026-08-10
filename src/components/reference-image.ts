import { LitElement, html } from "lit";

export class ReferenceImage extends LitElement {
  static properties = { src: { type: String }, alt: { type: String }, compact: { type: Boolean } };
  src = ""; alt = "Uploaded reference"; compact = false; #failed = false;

  protected override createRenderRoot() { return this; }

  override render() {
    if (!this.src || this.#failed) return html`<div class="reference-image-fallback ${this.compact ? "compact" : ""}" role="img" aria-label="${this.alt}. Preview unavailable"><span>▧</span><small>Preview unavailable</small></div>`;
    return html`<figure class="reference-image ${this.compact ? "compact" : ""}"><a href=${this.src} target="_blank" rel="noopener" aria-label="Open original image: ${this.alt}"><img src=${this.src} alt=${this.alt} loading="lazy" decoding="async" @error=${()=>{this.#failed=true;this.requestUpdate();}}><span>Open original ↗</span></a></figure>`;
  }
}

customElements.define("forma-reference-image", ReferenceImage);

declare global { interface HTMLElementTagNameMap { "forma-reference-image": ReferenceImage } }

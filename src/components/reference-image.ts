import { LitElement, html } from "lit";

export class ReferenceImage extends LitElement {
  static properties = { src: { type: String }, alt: { type: String }, compact: { type: Boolean } };
  src = ""; alt = "Uploaded reference"; compact = false; #failed = false; #open = false;

  protected override createRenderRoot() { return this; }

  protected override updated() {
    const dialog = this.querySelector<HTMLDialogElement>(".reference-viewer");
    if (this.#open && dialog && !dialog.open) dialog.showModal();
  }

  #close() { this.querySelector<HTMLDialogElement>(".reference-viewer")?.close(); this.#open = false; this.requestUpdate(); }

  override render() {
    if (!this.src || this.#failed) return html`<div class="reference-image-fallback ${this.compact ? "compact" : ""}" role="img" aria-label="${this.alt}. Preview unavailable"><span>▧</span><small>Preview unavailable</small></div>`;
    return html`<figure class="reference-image ${this.compact ? "compact" : ""}"><button @click=${()=>{this.#open=true;this.requestUpdate();}} aria-label="Open original image: ${this.alt}"><img src=${this.src} alt=${this.alt} loading="lazy" decoding="async" @error=${()=>{this.#failed=true;this.requestUpdate();}}><span>Open original</span></button></figure>
      ${this.#open ? html`<dialog class="modal reference-viewer" closedby="any" aria-modal="true" aria-labelledby="reference-viewer-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.#close();}} @cancel=${(event:Event)=>{event.preventDefault();this.#close();}} @close=${()=>{if(this.#open){this.#open=false;this.requestUpdate();}}}><div class="modal-card wide"><button class="icon-button modal-close" aria-label="Close original image" @click=${this.#close}>×</button><span class="eyebrow">Uploaded reference · original</span><h2 id="reference-viewer-title">${this.alt}</h2><div class="reference-viewer-stage"><img src=${this.src} alt=${this.alt}></div><footer><span>Stored privately with its rights receipt.</span><button class="button primary" @click=${this.#close}>Done</button></footer></div></dialog>` : ""}`;
  }
}

customElements.define("forma-reference-image", ReferenceImage);

declare global { interface HTMLElementTagNameMap { "forma-reference-image": ReferenceImage } }

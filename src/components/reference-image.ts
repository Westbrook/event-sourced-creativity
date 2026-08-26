import { html } from "lit";
import { focalPointCss } from "../model/focal-point";
import { positionImageAtFocalPoint } from "../model/image-focus";
import { FormaElement, icon } from "./forma-element";
import { ensureModalDialog } from "./modal-dialog";

export class ReferenceImage extends FormaElement {
  static properties = { src: { type: String }, alt: { type: String }, compact: { type: Boolean }, separateOpenControl:{type:Boolean,attribute:"separate-open-control"}, focalPoint:{attribute:false}, targetId:{type:String}, referenceId:{type:String} };
  src = ""; alt = "Uploaded reference"; compact = false; separateOpenControl=false; focalPoint:unknown=null;targetId="";referenceId="";#failed = false; #open = false;

  protected override updated() {
    const dialog = this.querySelector<HTMLDialogElement>(".reference-viewer");
    if (this.#open) ensureModalDialog(dialog);
  }

  #close() { this.querySelector<HTMLDialogElement>(".reference-viewer")?.close(); this.#open = false; this.requestUpdate(); }
  #openViewer(event:MouseEvent){if(event.shiftKey&&this.separateOpenControl){const requested=this.dispatchEvent(new CustomEvent("forma-reference-image-select-requested",{bubbles:true,composed:true,cancelable:true,detail:{targetId:this.targetId,referenceId:this.referenceId,additive:true}}));if(!requested){event.preventDefault();event.stopPropagation();return;}}event.stopPropagation();this.dispatchEvent(new CustomEvent("forma-reference-image-opened",{bubbles:true,composed:true,detail:{targetId:this.targetId,referenceId:this.referenceId}}));if(!this.store.session.get()?.projectContext&&this.separateOpenControl&&this.store.ui.instrumentation)void this.store.hot({type:"ObjectViewed",payload:{object_id:this.targetId||this.referenceId,reference_id:this.referenceId||null,source_surface:"canvas",source_kind:"reference",interaction:"open"}});this.#open=true;this.requestUpdate();}
  #image(){return html`<img src=${this.src} alt=${this.alt} loading="lazy" decoding="async" style=${focalPointCss(this.focalPoint)} @load=${(event:Event)=>{positionImageAtFocalPoint(event.currentTarget as HTMLImageElement,this.focalPoint);if(!this.store.session.get()?.projectContext&&this.targetId&&!this.focalPoint)void this.store.calculateImageFocalPoint({targetKind:"reference",targetId:this.targetId,referenceId:this.referenceId,mediaUrl:this.src});}} @error=${()=>{this.#failed=true;this.requestUpdate();}}>`;}

  override render() {
    if (!this.src || this.#failed) return html`<div class="reference-image-fallback ${this.compact ? "compact" : ""}" role="img" aria-label="${this.alt}. Preview unavailable"><span>${icon("image")}</span><small>Preview unavailable</small></div>`;
    return html`<figure class="reference-image ${this.compact ? "compact" : ""}">${this.separateOpenControl?html`<div class="reference-image-selectable">${this.#image()}<button type="button" class="reference-image-open" @pointerdown=${(event:PointerEvent)=>event.stopPropagation()} @click=${this.#openViewer} aria-label="Open original image: ${this.alt}. Shift-click to add this idea to the selection" title="Open original · Shift-click to add this idea to the selection"><span>Open original</span></button></div>`:html`<button type="button" @pointerdown=${(event:PointerEvent)=>event.stopPropagation()} @click=${this.#openViewer} aria-label="Open original image: ${this.alt}">${this.#image()}<span>Open original</span></button>`}</figure>
      ${this.#open ? html`<dialog class="modal reference-viewer" closedby="any" aria-modal="true" aria-labelledby="reference-viewer-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.#close();}} @cancel=${(event:Event)=>{event.preventDefault();this.#close();}} @close=${()=>{if(this.#open){this.#open=false;this.requestUpdate();}}}><div class="modal-card wide"><button class="icon-button modal-close" aria-label="Close original image" @click=${this.#close}>${icon("close")}</button><span class="eyebrow">Uploaded reference · original</span><h2 id="reference-viewer-title">${this.alt}</h2><div class="reference-viewer-stage"><img src=${this.src} alt=${this.alt}></div><footer><span>Stored privately with its rights receipt.</span><button class="button primary" @click=${this.#close}>Done</button></footer></div></dialog>` : ""}`;
  }
}

if (!customElements.get("forma-reference-image")) customElements.define("forma-reference-image", ReferenceImage);

declare global { interface HTMLElementTagNameMap { "forma-reference-image": ReferenceImage } }

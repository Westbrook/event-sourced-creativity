import { html, nothing } from "lit";
import { cache } from "lit/directives/cache.js";
import { localizeTemplateResult } from "./design-system/localized-template";
import { FormaElement, icon } from "./forma-element";
import { ensureModalDialog } from "./modal-dialog";
import { focalPointCss } from "../model/focal-point";
import { positionImageAtFocalPoint } from "../model/image-focus";

type PaletteStrategy = "extracted" | "muted" | "warm" | "nocturne" | "sampled";

const rgb = (hex: string) => {
  const value = hex.replace("#", "").padEnd(6, "0").slice(0,6);
  return [0,2,4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
};
const mix = (color: string, target: string, amount: number) => {
  const left = rgb(color); const right = rgb(target);
  return `#${left.map((value,index)=>Math.round(value+(right[index]-value)*amount).toString(16).padStart(2,"0")).join("")}`;
};

export class ReferencePalettePicker extends FormaElement {
  static properties = { referenceBlockId: { type: String }, referenceId: { type: String }, mediaUrl: { type: String }, label: { type: String }, colors: { attribute: false }, focalPoint:{attribute:false} };
  referenceBlockId = ""; referenceId = ""; mediaUrl = ""; label = "Reference"; colors: string[] = [];focalPoint:unknown=null;
  #strategy: PaletteStrategy = "extracted"; #sampled: string[] = []; #sampleCursor = 0; #lastSample = "";

  #suspended = false;
  /** Retain sampled colors while leaving the native top layer. */
  suspendControls() { this.#suspended = true; this.querySelector<HTMLDialogElement>(".palette-picker")?.close(); this.requestUpdate(); }
  openControls() { if (!this.isConnected) return; this.#suspended = false; this.requestUpdate(); void this.updateComplete.then(() => { if (this.isConnected && !this.#suspended) ensureModalDialog(this.querySelector<HTMLDialogElement>(".palette-picker")); }); }
  override disconnectedCallback() { this.suspendControls(); super.disconnectedCallback(); }
  protected override firstUpdated() { if (!this.#suspended) this.openControls(); }

  #base() { return this.colors.length ? this.colors.slice(0,6) : ["#24242b","#7f716b","#c79670","#e7d5b9"]; }
  #palette(strategy = this.#strategy) {
    const base = this.#base();
    if (strategy === "muted") return base.map((color) => mix(color,"#9a968b",.28));
    if (strategy === "warm") return base.map((color) => mix(color,"#e88f55",.24));
    if (strategy === "nocturne") return base.map((color) => mix(color,"#17242b",.38));
    if (strategy === "sampled") return this.#sampled.length ? this.#sampled : base;
    return base;
  }
  #choose(strategy: PaletteStrategy) {
    if (strategy === "sampled" && !this.#sampled.length) this.#sampled = this.#base();
    this.#strategy = strategy; this.requestUpdate();
  }
  #sampleImage(event: MouseEvent) {
    const image = event.currentTarget as HTMLImageElement; if (!image.complete || !image.naturalWidth) return;
    try {
      const rect = image.getBoundingClientRect(); const width = Math.min(512,image.naturalWidth); const height = Math.max(1,Math.round(image.naturalHeight*(width/image.naturalWidth)));
      const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height; const context = canvas.getContext("2d",{willReadFrequently:true}); if (!context) return;
      context.drawImage(image,0,0,width,height); const x = Math.max(0,Math.min(width-1,Math.round(((event.clientX-rect.left)/rect.width)*width))); const y = Math.max(0,Math.min(height-1,Math.round(((event.clientY-rect.top)/rect.height)*height)));
      const [red,green,blue] = context.getImageData(x,y,1,1).data; const color = `#${[red,green,blue].map(value=>value.toString(16).padStart(2,"0")).join("")}`;
      if (!this.#sampled.length) this.#sampled = this.#base(); const index = this.#sampleCursor % this.#sampled.length; this.#sampled = this.#sampled.map((value,position)=>position===index?color:value); this.#sampleCursor += 1; this.#lastSample = `Set swatch ${index+1} to ${color}.`; this.#strategy = "sampled"; this.requestUpdate();
    } catch { this.store.toast("This image could not be sampled in the current browser."); }
  }
  async #adopt() {
    const palette = this.#palette(); const id = crypto.randomUUID(); const suffix = this.#strategy === "sampled" ? "sampled" : this.#strategy;
    const appended = await this.store.append({ type:"BlockCreated", payload:{ block_id:id, type:"palette", handle:`palette/${suffix}-${String(this.store.head.get()+1).padStart(3,"0")}`, position:`z${String(this.store.head.get()+1).padStart(4,"0")}`, properties:{ colors:palette, label:`${suffix} palette from ${this.label}`, source_reference_id:this.referenceId, source_reference_block_id:this.referenceBlockId, palette_strategy:this.#strategy, authority:"authored", weight:.72 } } });
    if (appended.length) { this.store.toast("Palette adopted as a separate authored block."); this.dispatchEvent(new Event("picker-close",{bubbles:true,composed:true})); }
  }
  #close() { this.querySelector<HTMLDialogElement>(".palette-picker")?.close(); this.dispatchEvent(new Event("picker-close",{bubbles:true,composed:true})); }

  #dialog() {
    const strategies: Array<[PaletteStrategy,string,string]> = [["extracted","Extracted","Deterministic colors from this image"],["muted","Muted","Lower contrast, quieter relationships"],["warm","Warm shift","A warmer interpretation of the source"],["nocturne","Nocturne","Deeper values for low-light work"]];
    const nextSample = this.#sampleCursor % Math.max(1,this.#palette("sampled").length);
    return html`<dialog class="modal palette-picker" closedby="any" aria-modal="true" aria-labelledby="palette-picker-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.#close();}} @cancel=${(event:Event)=>{event.preventDefault();this.#close();}} @close=${()=>{if(!this.#suspended)this.dispatchEvent(new Event("picker-close",{bubbles:true,composed:true}));}}><div class="modal-card wide"><button class="icon-button modal-close" aria-label="Close palette picker" @click=${this.#close}>${icon("close")}</button><span class="eyebrow">Reference-derived palette</span><h2 id="palette-picker-title">Adopt colors from ${this.label}</h2><p>The reference stays unchanged. Choosing a palette creates a separate authored palette block with a citation back to this image.</p>
      <div class="palette-picker-grid"><div class="palette-source"><div class="palette-source-frame"><img src=${this.mediaUrl} alt=${this.label} style=${focalPointCss(this.focalPoint)} @load=${(event:Event)=>positionImageAtFocalPoint(event.currentTarget as HTMLImageElement,this.focalPoint)} @click=${this.#sampleImage}><span>Click image → set swatch ${nextSample+1}</span></div><small>${this.#lastSample?`${this.#lastSample} `:""}The next click replaces swatch ${nextSample+1}; samples can only be taken from this image.</small></div><div class="palette-options">${strategies.map(([key,title,description])=>html`<button aria-pressed=${this.#strategy===key} @click=${()=>this.#choose(key)}><span class="palette-strip">${this.#palette(key).map(color=>html`<i style=${`--swatch:${color}`}></i>`)}</span><b>${this.i18n.system(title)}</b><small>${this.i18n.system(description)}</small></button>`)}<button aria-pressed=${this.#strategy==="sampled"} @click=${()=>this.#choose("sampled")}><span class="palette-strip">${this.#palette("sampled").map((color,index)=>html`<i class=${this.#strategy==="sampled"&&index===nextSample?"sample-target":""} style=${`--swatch:${color}`}></i>`)}</span><b>Your samples</b><small>Click the image to replace the highlighted swatch.</small></button></div></div>
      ${this.#strategy==="sampled"?html`<div class="sampled-swatches" aria-label=${this.i18n.system("Image samples. Next image click will replace swatch {value}.", { value: this.i18n.number(nextSample+1) })}>${this.#palette("sampled").map((color,index)=>html`<div class=${index===nextSample?"next":""}><span style=${`--swatch:${color}`}></span><small>${index===nextSample?this.i18n.system("Next · {color}", { color: color }):color}</small></div>`)}</div>`:""}
      <footer class="palette-picker-actions"><button class="button ghost" @click=${this.#close}>Cancel</button><button class="button primary" @click=${this.#adopt}>Adopt ${this.#strategy} palette</button></footer></div></dialog>`;
  }
  override render() { return cache(this.#suspended ? nothing : localizeTemplateResult(this.#dialog(), this.i18n)); }
}

if (!customElements.get("forma-reference-palette-picker")) customElements.define("forma-reference-palette-picker", ReferencePalettePicker);

declare global { interface HTMLElementTagNameMap { "forma-reference-palette-picker": ReferencePalettePicker } }

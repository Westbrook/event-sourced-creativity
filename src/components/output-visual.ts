import { html, nothing } from "lit";
import { FormaElement, icon } from "./forma-element";
import type { CreativeOutput } from "../model/events";
import { focalPointCss } from "../model/focal-point";
import { positionImageAtFocalPoint } from "../model/image-focus";

export class OutputVisual extends FormaElement {
  static properties={output:{attribute:false},compact:{type:Boolean},interactive:{type:Boolean}};
  output?:CreativeOutput;compact=false;interactive=false;#open=false;

  protected override updated(){
    const dialog=this.querySelector<HTMLDialogElement>(".generated-image-viewer");
    if(this.#open&&dialog&&!dialog.open)dialog.showModal();
  }

  #close(){this.querySelector<HTMLDialogElement>(".generated-image-viewer")?.close();this.#open=false;this.requestUpdate();}

  #image(output:CreativeOutput){return html`<img class="generated-output-image" src=${output.mediaUrl!} alt=${`Generated image ${output.id}`} width=${output.width??1536} height=${output.height??1024} loading=${this.compact?"lazy":"eager"} style=${focalPointCss(output.focalPoint)} @load=${(event:Event)=>positionImageAtFocalPoint(event.currentTarget as HTMLImageElement,output.focalPoint)}>`;}

  override render(){
    const output=this.output;
    return output?.mediaUrl
      ? html`${this.interactive?html`<button type="button" class="generated-output-trigger" aria-label=${`Open generated image ${output.id} at full size`} @click=${()=>{this.#open=true;this.requestUpdate();}}>${this.#image(output)}<span>Open full image</span></button>`:this.#image(output)}
        ${this.#open?html`<dialog class="modal generated-image-viewer" closedby="any" aria-modal="true" aria-labelledby=${`generated-image-title-${output.id}`} @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.#close();}} @cancel=${(event:Event)=>{event.preventDefault();this.#close();}} @close=${()=>{if(this.#open){this.#open=false;this.requestUpdate();}}}><div class="modal-card image-lightbox-card"><button type="button" class="icon-button modal-close" aria-label="Close generated image" @click=${this.#close}>${icon("close")}</button><header><span class="eyebrow">Generated image · ${output.modelId}</span><h2 id=${`generated-image-title-${output.id}`}>${output.id}</h2></header><div class="image-lightbox-stage">${this.#image(output)}</div><footer><span>${output.width??1536} × ${output.height??1024} · generation event #${output.sequence}</span><button type="button" class="button primary" @click=${this.#close}>Done</button></footer></div></dialog>`:nothing}`
      : html`<span class="generated-output-empty">${icon("image")}<small>${output?.provider==="simulation"?"Legacy simulated output":"No generated image"}</small></span>`;
  }
}

customElements.define("forma-output-visual",OutputVisual);

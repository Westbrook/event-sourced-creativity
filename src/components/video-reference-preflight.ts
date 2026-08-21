import { html, nothing } from "lit";
import { REFERENCE_PIXEL_MODES, referencePixelModeDefinition, type ReferencePixelMode } from "../model/block-types";
import type { EventInput } from "../model/events";
import { focalPointCss } from "../model/focal-point";
import { positionImageAtFocalPoint } from "../model/image-focus";
import { videoReferencePreflight, type VideoReferencePreflightItem } from "../model/video-references";
import { FormaElement, icon } from "./forma-element";

export class VideoReferencePreflight extends FormaElement {
  static properties={disabled:{type:Boolean},source:{type:String}};
  disabled=false;source="document";#busy="";

  #eventsFor(items:VideoReferencePreflightItem[],mode:ReferencePixelMode,batchId:string):EventInput[]{
    return items.filter((item)=>!item.block.locked&&item.mode!==mode).map((item)=>({type:"BlockPropertyEdited",payload:{block_id:item.block.id,document_id:item.block.documentId,property_path:"pixel_reference_mode",old_value:item.mode,new_value:mode,source_surface:`${this.source}-video-reference-preflight`,reference_set_kind:item.isStoryboardFrame?"storyboard":"independent",reference_set_id:item.storyboardId||null,storyboard_sequence:item.sequence,batch_id:batchId,video_reference_preflight:true}}));
  }

  async #apply(items:VideoReferencePreflightItem[],mode:ReferencePixelMode,label:string){
    if(this.disabled||this.#busy)return;const batchId=crypto.randomUUID();const events=this.#eventsFor(items,mode,batchId);if(!events.length){this.store.toast(`${label} already use ${referencePixelModeDefinition(mode).label.toLowerCase()}.`);return;}
    this.#busy=batchId;this.dispatchEvent(new CustomEvent("video-reference-change",{bubbles:true,composed:true}));this.dispatchEvent(new CustomEvent("video-reference-busy",{detail:{busy:true},bubbles:true,composed:true}));this.requestUpdate();
    try{const appended=await this.store.appendBatch(events,{rebaseAttempts:6});if(appended.length)this.store.toast(`${appended.length} ${label.toLowerCase()} updated for this and future renders.`);}
    finally{this.#busy="";this.dispatchEvent(new CustomEvent("video-reference-busy",{detail:{busy:false},bubbles:true,composed:true}));this.requestUpdate();}
  }

  async #change(item:VideoReferencePreflightItem,mode:ReferencePixelMode){await this.#apply([item],mode,item.sequence?`Storyboard shot ${item.sequence}`:"Reference");}

  #item(item:VideoReferencePreflightItem){const mode=referencePixelModeDefinition(item.mode),disabled=this.disabled||Boolean(this.#busy)||item.block.locked;return html`<li class=${item.sendsPixels?"sends-pixels":"describes-only"}>
    <img src=${item.mediaUrl} alt="" loading="lazy" decoding="async" style=${focalPointCss(item.focalPoint)} @load=${(event:Event)=>positionImageAtFocalPoint(event.currentTarget as HTMLImageElement,item.focalPoint)}>
    <div><span>${item.isStoryboardFrame?`Shot ${item.sequence??"—"}${item.frameCount?` of ${item.frameCount}`:""}`:"Reference"}</span><b>${item.label}</b><small>${item.shotDirection||"No shot direction recorded"}</small>${item.cameraDirection?html`<small>Camera · ${item.cameraDirection}</small>`:nothing}</div>
    <div class="video-reference-mode-controls"><label class="video-reference-pixel-toggle"><input type="checkbox" .checked=${item.sendsPixels} ?disabled=${disabled} @change=${(event:Event)=>this.#change(item,(event.target as HTMLInputElement).checked?"preserve_composition":"context_only")}><span>Send this frame’s pixels</span></label><label><span>Pixel role</span><select aria-label=${`Pixel role for ${item.label}`} .value=${item.sendsPixels?item.mode:"preserve_composition"} ?disabled=${disabled||!item.sendsPixels} @change=${(event:Event)=>this.#change(item,(event.target as HTMLSelectElement).value as ReferencePixelMode)}>${REFERENCE_PIXEL_MODES.filter((option)=>option.id!=="context_only").map((option)=>html`<option value=${option.id}>${option.label}</option>`)}</select></label><small>${item.block.locked?"Unlock this block to change it.":item.sendsPixels&&!item.rightsConfirmed?"Rights evidence required before submission.":mode.description}</small></div>
  </li>`;}

  override render(){const projection=this.store.projection.get();const preflight=videoReferencePreflight(projection.blocks,this.store.events.get());const storyboardGroups=new Map<string,VideoReferencePreflightItem[]>();for(const item of preflight.storyboardItems){const key=item.storyboardId||"storyboard";storyboardGroups.set(key,[...(storyboardGroups.get(key)??[]),item]);}const blockedDetails=[preflight.providerLimitExceededCount?`${preflight.providerPixelCount} pixel references selected; the adopted adapter accepts at most ${preflight.providerReferenceLimit}`:"",preflight.unavailablePixelCount?`${preflight.unavailablePixelCount} pixel reference${preflight.unavailablePixelCount===1?" has":"s have"} no available source image`:"",preflight.rightsBlockedCount?`${preflight.rightsBlockedCount} ${preflight.rightsBlockedCount===1?"is":"are"} missing usable rights evidence`:""].filter(Boolean).join("; ");const route=preflight.providerPath==="blocked"?{label:"Needs attention",detail:`${blockedDetails}. Adjust the selected pixel set, replace unavailable images, or confirm rights before rendering.`}:preflight.providerPath==="reference-to-video"?{label:"Pixel-backed reference-to-video",detail:`${preflight.providerPixelCount} actual image${preflight.providerPixelCount===1?"":"s"} will be uploaded to short-lived provider storage and sent in the order below.`}:{label:"Prompt-only video",detail:preflight.items.length?`${preflight.describeOnlyCount} image${preflight.describeOnlyCount===1?" is":"s are"} represented by their authored descriptions; no pixels will be sent.`:"No active image references are attached to this document."};return html`<section class="video-reference-preflight" aria-labelledby="video-reference-preflight-title">
    <header><div><span>${icon("image")}</span><div><h3 id="video-reference-preflight-title">Visual references</h3><p>${route.detail}</p></div></div><strong class=${preflight.providerPath}>${route.label}</strong></header>
    ${storyboardGroups.size?html`${[...storyboardGroups.entries()].map(([,items])=>html`<section class="video-reference-set"><header><div><b>${items[0].storyboardTitle}</b><small>Ordered storyboard · ${items.length} available frame${items.length===1?"":"s"} · choose pixels frame by frame below</small></div><div><button type="button" class="button secondary compact" ?disabled=${this.disabled||Boolean(this.#busy)||!items.some((item)=>!item.block.locked&&item.mode!=="preserve_composition")} @click=${()=>this.#apply(items,"preserve_composition","Storyboard frames")}>Send all frame pixels</button><button type="button" class="button ghost compact" ?disabled=${this.disabled||Boolean(this.#busy)||!items.some((item)=>!item.block.locked&&item.mode!=="context_only")} @click=${()=>this.#apply(items,"context_only","Storyboard frames")}>Describe all only</button></div></header><ol>${items.map((item)=>this.#item(item))}</ol></section>`)}`:nothing}
    ${preflight.otherItems.length?html`<details class="video-reference-other"><summary>${preflight.otherItems.length} other image reference${preflight.otherItems.length===1?"":"s"}</summary><ul>${preflight.otherItems.map((item)=>this.#item(item))}</ul></details>`:nothing}
    ${preflight.items.length||preflight.unavailablePixelCount?html`<footer><span>${preflight.providerPixelCount} provider pixel-backed</span><span>${preflight.describeOnlyCount} user-selected description-only</span>${preflight.providerLimitExceededCount?html`<span>${preflight.providerLimitExceededCount} over the ${preflight.providerReferenceLimit}-image limit</span>`:nothing}${preflight.unavailablePixelCount?html`<span>${preflight.unavailablePixelCount} unavailable</span>`:nothing}<span>${preflight.items.length+preflight.unavailablePixelCount} total</span></footer>`:nothing}
  </section>`;}
}

customElements.define("forma-video-reference-preflight",VideoReferencePreflight);
declare global{interface HTMLElementTagNameMap{"forma-video-reference-preflight":VideoReferencePreflight}}

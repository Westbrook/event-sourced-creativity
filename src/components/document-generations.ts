import { html, nothing } from "lit";
import { generationMix, isDraftOutput, outputQualityLabel, type CreativeOutput } from "../model/events";
import { FormaElement, icon } from "./forma-element";
import "./output-visual";
import "./generation-actions";

export class DocumentGenerations extends FormaElement {
  static properties={view:{type:String},presentation:{type:String}};
  view="document";presentation:"full"|"compact"|"canvas"|"rail"="full";#selectedId="";#filter:"all"|"draft"|"full"="all";#collapsed=false;

  #select(output:CreativeOutput){
    this.#selectedId=output.id;
    this.store.patchUi({selectedOutputId:output.id});
    if(this.store.ui.instrumentation)void this.store.hot({type:"ObjectViewed",payload:{object_id:output.id,source_surface:`${this.view}-results`}});
    this.requestUpdate();
  }

  #embedded(outputs:CreativeOutput[],selected:CreativeOutput|undefined,progress:ReturnType<typeof this.store.documentPreviewProgress>){
    const presentation=this.presentation;
    const currentIndex=selected?outputs.findIndex((output)=>output.id===selected.id):-1;
    return html`<section class=${`document-generation-embedded document-generation-embedded--${presentation}`} aria-label="Current generation from this document">
      <div class="document-generation-embedded-media">
        ${progress
          ? html`<div class="streaming-preview"><img class="streaming-preview-image" src=${progress.mediaUrl} width=${progress.width} height=${progress.height} alt="Early image preview still being refined"><span>Early preview · finalizing</span></div>`
          : selected
          ? html`<forma-output-visual .output=${selected} .interactive=${true}></forma-output-visual>`
          : html`<span class="document-generation-empty">${icon("image")}<b>No image yet</b><small>The document is ready to become a visual result.</small></span>`}
      </div>
      <div class="document-generation-embedded-copy">
        <div><span class="eyebrow">${progress?"Image arriving":selected?outputQualityLabel(selected):"Document preview"}</span><h3>${progress?"A working image is already visible":selected?currentIndex===0?`Latest ${isDraftOutput(selected)?"draft":"full-quality image"}`:`Selected ${outputQualityLabel(selected).toLowerCase()} ${currentIndex+1}`:"See the decisions working together"}</h3><p>${progress?"This early pass will be replaced automatically by the completed draft.":selected?`${isDraftOutput(selected)?"Fast exploration":"Full resolution"} from this document’s complete creative context · ${selected.modelId}`:"Generate an image without leaving this way of working."}</p></div>
        ${outputs.length>1?html`<div class="document-generation-switcher" role="list" aria-label="Choose a document generation">${outputs.map((output,index)=>html`<button role="listitem" class=${output.id===selected?.id?"selected":""} aria-pressed=${output.id===selected?.id} aria-label=${`Show ${outputQualityLabel(output).toLowerCase()} ${index+1}`} @click=${()=>this.#select(output)}>${isDraftOutput(output)?"D":"F"}${outputs.length-index}</button>`)}</div>`:nothing}
        <forma-generation-actions source=${this.view} .selected=${selected??null} compact></forma-generation-actions>
      </div>
    </section>`;
  }

  override render(){
    const allOutputs=this.store.projection.get().outputs;const progress=this.store.documentPreviewProgress();const mix=generationMix(allOutputs);const outputs=allOutputs.filter((output)=>this.#filter==="all"||(this.#filter==="draft"?isDraftOutput(output):!isDraftOutput(output)));
    const selected=outputs.find((output)=>output.id===(this.#selectedId||this.store.ui.selectedOutputId))??outputs[0];
    if(this.presentation!=="full")return this.#embedded(outputs,selected,progress);
    return html`<section class=${`document-generations ${this.#collapsed?"collapsed":""}`} aria-label="Generations from this document">
      <header><div><span class="eyebrow">Results from this document</span><h2>${mix.total?`${mix.total} generation${mix.total===1?"":"s"} · ${mix.drafts} draft · ${mix.full} full quality`:"The document has no generations yet"}</h2><p>${mix.total?"Drafts and full-quality images share one history in every view. Select a draft before generating full quality to preserve that explicit promotion.":"Preview quickly or generate at full quality from the same durable context represented by this view."}</p></div><div class="document-generation-header-actions"><button class="document-generation-collapse" aria-expanded=${!this.#collapsed} @click=${()=>{this.#collapsed=!this.#collapsed;this.requestUpdate();}}>${this.#collapsed?"Show images":"Collapse images"}</button><forma-generation-actions source=${this.view} .selected=${selected??null}></forma-generation-actions></div></header>
      ${this.#collapsed?nothing:html`${mix.total?html`<div class="generation-filter" role="group" aria-label="Filter generation quality">${(["all","draft","full"] as const).map((filter)=>html`<button aria-pressed=${this.#filter===filter} @click=${()=>{this.#filter=filter;this.#selectedId="";this.requestUpdate();}}>${filter==="all"?`All ${mix.total}`:filter==="draft"?`Drafts ${mix.drafts}`:`Full quality ${mix.full}`}</button>`)}</div>`:nothing}
      ${progress||selected?html`<div class="document-generation-layout"><div class="document-generation-feature">${progress?html`<div class="streaming-preview"><img class="streaming-preview-image" src=${progress.mediaUrl} width=${progress.width} height=${progress.height} alt="Early image preview still being refined"><span>Early preview · finalizing</span></div>`:html`<forma-output-visual .output=${selected} .interactive=${true}></forma-output-visual>`}<footer><span><b>${progress?"Working image arriving":`${outputQualityLabel(selected)} · ${selected.id}`}</b><small>${progress?"GPT Image is refining the completed draft now":`${selected.modelId}${selected.promotedFromId?` · refined from ${selected.promotedFromId}`:""}`}</small></span><em>${progress?"Streaming":selected.pinned?"Pinned":selected.saved?"Saved":isDraftOutput(selected)?"Fast exploration":`Version ${selected.variant+1}`}</em></footer></div><div class="document-generation-list" role="list" aria-label="Filtered document generations">${outputs.map((output,index)=>html`<button role="listitem" class=${output.id===selected?.id?"selected":""} aria-pressed=${output.id===selected?.id} @click=${()=>this.#select(output)}><i><forma-output-visual .output=${output} .compact=${true}></forma-output-visual></i><span><b>${outputQualityLabel(output)} ${index===0?"· latest":""}</b><small>${output.id}</small></span></button>`)}</div></div>`:mix.total?html`<p class="generation-filter-empty">No ${this.#filter==="draft"?"draft":"full-quality"} images yet.</p>`:nothing}`}
    </section>`;
  }
}

customElements.define("forma-document-generations",DocumentGenerations);

declare global{interface HTMLElementTagNameMap{"forma-document-generations":DocumentGenerations}}

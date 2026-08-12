import { html, nothing } from "lit";
import type { CreativeOutput } from "../model/events";
import { FormaElement, icon } from "./forma-element";
import "./output-visual";

export class DocumentGenerations extends FormaElement {
  static properties={view:{type:String},presentation:{type:String}};
  view="document";presentation:"full"|"compact"|"canvas"|"rail"="full";#selectedId="";

  #select(output:CreativeOutput){
    this.#selectedId=output.id;
    this.store.patchUi({selectedOutputId:output.id});
    if(this.store.ui.instrumentation)void this.store.hot({type:"ObjectViewed",payload:{object_id:output.id,source_surface:`${this.view}-results`}});
    this.requestUpdate();
  }

  #generateLabel(hasOutputs:boolean){
    return this.store.busy.get()==="generate"?"Generating…":hasOutputs?"Try another":"Generate image";
  }

  #embedded(outputs:CreativeOutput[],selected:CreativeOutput|undefined,providerReady:boolean){
    const presentation=this.presentation;
    const currentIndex=selected?outputs.findIndex((output)=>output.id===selected.id):-1;
    return html`<section class=${`document-generation-embedded document-generation-embedded--${presentation}`} aria-label="Current generation from this document">
      <div class="document-generation-embedded-media">
        ${selected
          ? html`<forma-output-visual .output=${selected} .interactive=${true}></forma-output-visual>`
          : html`<span class="document-generation-empty">${icon("image")}<b>No image yet</b><small>The document is ready to become a visual result.</small></span>`}
      </div>
      <div class="document-generation-embedded-copy">
        <div><span class="eyebrow">${selected?"Current generation":"Document preview"}</span><h3>${selected?currentIndex===0?"Latest generated image":`Selected result ${currentIndex+1}`:"See the decisions working together"}</h3><p>${selected?`Generated from this document’s complete creative context · ${selected.modelId}`:"Generate an image without leaving this way of working."}</p></div>
        ${outputs.length>1?html`<div class="document-generation-switcher" role="list" aria-label="Choose a document generation">${outputs.map((output,index)=>html`<button role="listitem" class=${output.id===selected?.id?"selected":""} aria-pressed=${output.id===selected?.id} aria-label=${index===0?"Show latest generation":`Show generation ${index+1}`} @click=${()=>this.#select(output)}>${index===0?"Latest":index+1}</button>`)}</div>`:nothing}
        <button class="button secondary compact" ?disabled=${!providerReady||Boolean(this.store.busy.get())} @click=${()=>this.store.generate()}>${icon("spark")} ${this.#generateLabel(Boolean(outputs.length))}</button>
      </div>
    </section>`;
  }

  override render(){
    const outputs=this.store.projection.get().outputs;
    const selected=outputs.find((output)=>output.id===(this.#selectedId||this.store.ui.selectedOutputId))??outputs[0];
    const providerReady=Boolean(this.store.session.get()?.provider.configured);
    if(this.presentation!=="full")return this.#embedded(outputs,selected,providerReady);
    return html`<section class="document-generations" aria-label="Generations from this document">
      <header><div><span class="eyebrow">Results from this document</span><h2>${outputs.length?`${outputs.length} generation${outputs.length===1?"":"s"}, available in every view`:"The document has no generations yet"}</h2><p>${outputs.length?"Choose a result to inspect it here. Changing views never changes which document or results you are working with.":"Generate from the same durable context represented by this view."}</p></div><button class="button secondary compact" ?disabled=${!providerReady||Boolean(this.store.busy.get())} @click=${()=>this.store.generate()}>${icon("spark")} ${this.#generateLabel(Boolean(outputs.length))}</button></header>
      ${selected?html`<div class="document-generation-layout"><div class="document-generation-feature"><forma-output-visual .output=${selected} .interactive=${true}></forma-output-visual><footer><span><b>${selected.id}</b><small>${selected.modelId} · event #${selected.sequence}</small></span><em>${selected.pinned?"Pinned":selected.saved?"Saved":`Version ${selected.variant+1}`}</em></footer></div><div class="document-generation-list" role="list" aria-label="All document generations">${outputs.map((output,index)=>html`<button role="listitem" class=${output.id===selected.id?"selected":""} aria-pressed=${output.id===selected.id} @click=${()=>this.#select(output)}><i><forma-output-visual .output=${output} .compact=${true}></forma-output-visual></i><span><b>${index===0?"Latest result":`Earlier result ${index}`}</b><small>${output.id}</small></span></button>`)}</div></div>`:nothing}
    </section>`;
  }
}

customElements.define("forma-document-generations",DocumentGenerations);

declare global{interface HTMLElementTagNameMap{"forma-document-generations":DocumentGenerations}}

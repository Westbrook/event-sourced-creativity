import { html, nothing } from "lit";
import type { CreativeOutput } from "../model/events";
import { FormaElement, icon } from "./forma-element";
import "./output-visual";

export class DocumentGenerations extends FormaElement {
  static properties={view:{type:String}};
  view="document";#selectedId="";

  #select(output:CreativeOutput){
    this.#selectedId=output.id;
    this.store.patchUi({selectedOutputId:output.id});
    if(this.store.ui.instrumentation)void this.store.hot({type:"ObjectViewed",payload:{object_id:output.id,source_surface:`${this.view}-results`}});
    this.requestUpdate();
  }

  override render(){
    const outputs=this.store.projection.get().outputs;
    const selected=outputs.find((output)=>output.id===(this.#selectedId||this.store.ui.selectedOutputId))??outputs[0];
    const providerReady=Boolean(this.store.session.get()?.provider.configured);
    return html`<section class="document-generations" aria-label="Generations from this document">
      <header><div><span class="eyebrow">Results from this document</span><h2>${outputs.length?`${outputs.length} generation${outputs.length===1?"":"s"}, available in every view`:"The document has no generations yet"}</h2><p>${outputs.length?"Choose a result to inspect it here. Changing views never changes which document or results you are working with.":"Generate from the same durable context represented by this view."}</p></div><button class="button secondary compact" ?disabled=${!providerReady||Boolean(this.store.busy.get())} @click=${()=>this.store.generate()}>${icon("spark")} ${this.store.busy.get()==="generate"?"Generating…":outputs.length?"Try another":"Generate image"}</button></header>
      ${selected?html`<div class="document-generation-layout"><div class="document-generation-feature"><forma-output-visual .output=${selected} .interactive=${true}></forma-output-visual><footer><span><b>${selected.id}</b><small>${selected.modelId} · event #${selected.sequence}</small></span><em>${selected.pinned?"Pinned":selected.saved?"Saved":`Version ${selected.variant+1}`}</em></footer></div><div class="document-generation-list" role="list" aria-label="All document generations">${outputs.map((output,index)=>html`<button role="listitem" class=${output.id===selected.id?"selected":""} aria-pressed=${output.id===selected.id} @click=${()=>this.#select(output)}><i><forma-output-visual .output=${output} .compact=${true}></forma-output-visual></i><span><b>${index===0?"Latest result":`Earlier result ${index}`}</b><small>${output.id}</small></span></button>`)}</div></div>`:nothing}
    </section>`;
  }
}

customElements.define("forma-document-generations",DocumentGenerations);

declare global{interface HTMLElementTagNameMap{"forma-document-generations":DocumentGenerations}}

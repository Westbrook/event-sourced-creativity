import { html } from "lit";
import { isDraftOutput, type CreativeOutput } from "../model/events";
import { documentJobActionLabel } from "../model/document-jobs";
import { FormaElement, icon } from "./forma-element";

export class GenerationActions extends FormaElement {
  static properties={source:{type:String},selected:{attribute:false},compact:{type:Boolean}};
  source="studio";selected:CreativeOutput|null=null;compact=false;

  override render(){
    const providerReady=Boolean(this.store.session.get()?.provider.configured);const busy=this.store.busy.get();const previewJob=this.store.documentJob("preview");const generateJob=this.store.documentJob("generate");const previewActive=Boolean(previewJob);const generateActive=Boolean(generateJob);const selected=this.selected??this.store.projection.get().outputs.find((output)=>output.id===this.store.ui.selectedOutputId)??this.store.projection.get().outputs[0]??null;const promotes=isDraftOutput(selected);const previewLabel=documentJobActionLabel(previewJob,"preview");const generateLabel=documentJobActionLabel(generateJob,"generate",Boolean(previewJob));
    return html`<div class=${`generation-actions ${this.compact?"compact":""}`} role="group" aria-label="Image generation quality">
      <button class="button secondary compact" ?disabled=${!providerReady||Boolean(busy)||previewActive} title=${previewJob?.progressMessage||(providerReady?"Generate a fast, lower-quality image for exploring the current document":"Image generation is not available yet")} @click=${()=>this.store.preview(this.source)}>${previewActive?previewLabel:html`${icon("spark")} ${previewLabel}`}</button>
      <button class="button primary compact" ?disabled=${!providerReady||Boolean(busy)||generateActive} title=${generateJob?.progressMessage||(providerReady?(promotes?"Refine the selected draft with the full-quality model":"Generate a full-quality image from the current document"):"Image generation is not available yet")} @click=${()=>this.store.generate({sourceSurface:this.source,sourcePreviewId:promotes?selected?.id:undefined})}>${generateActive?generateLabel:html`${icon("spark")} ${promotes?"Generate full from draft":"Generate full"}`}</button>
    </div>`;
  }
}
customElements.define("forma-generation-actions",GenerationActions);
declare global{interface HTMLElementTagNameMap{"forma-generation-actions":GenerationActions}}

import { html } from "lit";
import { isDraftOutput, type CreativeOutput } from "../model/events";
import { documentJobActionLabel, type DocumentJob } from "../model/document-jobs";
import { FormaElement, icon } from "./forma-element";
import { promptTechniqueDefinition } from "../model/prompt-structures";
import "./prompt-fan-review";

const surfaceLabel = (surface: string) => ({
  studio: "Document",
  chat: "Chat",
  editor: "Creative editor",
  adaptive: "Adaptive path",
  guided: "Guided brief",
  layers: "Reality layers",
  board: "Context board",
}[surface] ?? surface.replace(/[-_]/g, " "));

export class GenerationActions extends FormaElement {
  static properties={source:{type:String},selected:{attribute:false},compact:{type:Boolean}};
  source="studio";selected:CreativeOutput|null=null;compact=false;#queueOpen=false;

  protected override updated(){
    const dialog=this.querySelector<HTMLDialogElement>(".generation-queue-dialog");
    if(this.#queueOpen&&dialog&&!dialog.open)dialog.showModal();
  }

  #closeQueue(){this.querySelector<HTMLDialogElement>(".generation-queue-dialog")?.close();this.#queueOpen=false;this.requestUpdate();}

  #queueItem(job:DocumentJob,index:number,currentRevision:string){
    const current=job.documentRevision===currentRevision;const technique=promptTechniqueDefinition(job.promptTechnique);const title=`${job.kind==="preview"?"Draft":"Full-quality"} · ${technique.shortLabel}`;const status=job.status==="running"?"Running now":`Waiting · ${index+1} in the image queue`;const requested=new Date(job.requestedAt);
    return html`<li class=${`generation-queue-item ${job.status}`}>
      <span class="generation-queue-order" aria-hidden="true">${job.status==="running"?icon("spark"):index+1}</span>
      <div>
        <header><b>${title}</b><span class=${current?"current":"earlier"}>${current?"Current document state":"Earlier document state"}</span></header>
        <p>${job.progressMessage||status}</p>
        <small>${status} · from ${surfaceLabel(job.sourceSurface)} · <time datetime=${job.requestedAt}>${Number.isNaN(requested.getTime())?"recently":requested.toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})}</time>${job.sourcePreviewId?" · refines a selected draft":""}</small>
      </div>
    </li>`;
  }

  override render(){
    const providerReady=Boolean(this.store.session.get()?.provider.configured);const busy=this.store.busy.get();const selected=this.selected??this.store.projection.get().outputs.find((output)=>output.id===this.store.ui.selectedOutputId)??this.store.projection.get().outputs[0]??null;const promotes=isDraftOutput(selected);const sourcePreviewId=promotes?selected?.id:null;const currentRevision=this.store.documentGenerationRevision();const preference=this.store.promptTechniquePreference();const technique=promptTechniqueDefinition(preference.technique);const previewKey=this.store.documentGenerationRequestKey("preview",null,preference.technique);const generateKey=this.store.documentGenerationRequestKey("generate",sourcePreviewId,preference.technique);const previewStarting=this.store.documentJobStarting(previewKey);const generateStarting=this.store.documentJobStarting(generateKey);const jobs=this.store.documentGenerationJobs();const previewJob=this.store.documentJobForRequest("preview",previewKey);const generateJob=this.store.documentJobForRequest("generate",generateKey);const previewJobs=jobs.filter((job)=>job.kind==="preview");const generateJobs=jobs.filter((job)=>job.kind==="generate");const previewLabel=previewStarting?"Adding draft…":previewJob?documentJobActionLabel(previewJob,"preview"):previewJobs.length?"Queue updated draft":"Preview draft";const generateLabel=generateStarting?"Adding full image…":generateJob?documentJobActionLabel(generateJob,"generate",previewJobs.length>0):generateJobs.length?(promotes?"Generate updated full from draft":"Queue updated full"):(promotes?"Generate full from draft":"Generate full");
    return html`<div class=${`generation-actions-shell ${this.compact?"compact":""}`}>
      <div class=${`generation-actions ${this.compact?"compact":""}`} role="group" aria-label="Image generation quality">
        <span class="generation-action-pair"><button class="button secondary compact" ?disabled=${!providerReady||Boolean(busy)||previewStarting||Boolean(previewJob)} title=${previewJob?.progressMessage||(providerReady?`${previewJobs.length?"Queue a draft from the latest document state":"Generate a fast, lower-quality image"} using ${technique.label.toLowerCase()}`:"Image generation is not available yet")} @click=${()=>this.store.preview(this.source,preference.technique)}>${previewJob||previewStarting?previewLabel:html`${icon("spark")} ${previewLabel}`}</button><button class="generation-fan-button secondary" ?disabled=${!providerReady||Boolean(busy)} title="Generate four drafts from prose, bullets, JSON, and XML" aria-label="Fan preview across all four prompt structures" @click=${()=>this.store.generatePromptFan("preview",{sourceSurface:this.source})}>Fan ×4</button></span>
        <span class="generation-action-pair"><button class="button primary compact" ?disabled=${!providerReady||Boolean(busy)||generateStarting||Boolean(generateJob)} title=${generateJob?.progressMessage||(providerReady?`${generateJobs.length?"Queue a full-quality image from the latest document state":promotes?"Refine the selected draft":"Generate a full-quality image"} using ${technique.label.toLowerCase()}`:"Image generation is not available yet")} @click=${()=>this.store.generate({sourceSurface:this.source,sourcePreviewId:sourcePreviewId??undefined,promptTechnique:preference.technique})}>${generateJob||generateStarting?generateLabel:html`${icon("spark")} ${generateLabel}`}</button><button class="generation-fan-button primary" ?disabled=${!providerReady||Boolean(busy)} title="Generate four full-quality images from prose, bullets, JSON, and XML" aria-label="Fan full-quality generation across all four prompt structures" @click=${()=>this.store.generatePromptFan("generate",{sourceSurface:this.source,sourcePreviewId:sourcePreviewId??undefined})}>Fan ×4</button></span>
        ${jobs.length?html`<button class="generation-queue-trigger" aria-label=${`Review ${jobs.length} active image generation request${jobs.length===1?"":"s"}`} aria-haspopup="dialog" @click=${()=>{this.#queueOpen=true;this.requestUpdate();}}>${icon("clock")}<span>${jobs.length} in progress</span><b aria-hidden="true">${jobs.length}</b></button>`:""}
      </div>
      <forma-prompt-fan-review></forma-prompt-fan-review>
      ${this.#queueOpen&&jobs.length?html`<dialog class="modal generation-queue-dialog" closedby="any" aria-labelledby="generation-queue-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.#closeQueue();}} @cancel=${(event:Event)=>{event.preventDefault();this.#closeQueue();}} @close=${()=>{if(this.#queueOpen){this.#queueOpen=false;this.requestUpdate();}}}>
        <section class="modal-card generation-queue-card">
          <button class="icon-button modal-close" aria-label="Close generation queue" @click=${this.#closeQueue}>${icon("close")}</button>
          <header><h2 id="generation-queue-title">Images in progress</h2><p>${jobs.length} request${jobs.length===1?" is":"s are"} safely stored on the server. They continue if you refresh or leave this document.</p></header>
          <ol class="generation-queue-list">${jobs.map((job,index)=>this.#queueItem(job,index,currentRevision))}</ol>
          <footer><p>Editing creates a new document state, so you can queue an updated image immediately. The same state remains disabled to prevent duplicate cost.</p><button class="button secondary" @click=${this.#closeQueue}>Done</button></footer>
        </section>
      </dialog>`:""}
    </div>`;
  }
}
customElements.define("forma-generation-actions",GenerationActions);
declare global{interface HTMLElementTagNameMap{"forma-generation-actions":GenerationActions}}

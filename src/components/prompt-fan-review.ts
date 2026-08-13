import { html, nothing } from "lit";
import { outputQualityLabel, type CreativeOutput } from "../model/events";
import { PROMPT_TECHNIQUE_DEFINITIONS, type PromptPreferenceScope, type PromptTechnique } from "../model/prompt-structures";
import { FormaElement, icon } from "./forma-element";
import "./output-visual";

export class PromptFanReview extends FormaElement {
  #open=false;#scope:PromptPreferenceScope="document";

  protected override updated(){const dialog=this.querySelector<HTMLDialogElement>(".prompt-fan-dialog");if(this.#open&&dialog&&!dialog.open)dialog.showModal();}
  #close(){this.querySelector<HTMLDialogElement>(".prompt-fan-dialog")?.close();this.#open=false;this.requestUpdate();}

  #latestFan(){
    const groups=new Map<string,CreativeOutput[]>();for(const output of this.store.projection.get().outputs){if(!output.promptFanId)continue;groups.set(output.promptFanId,[...(groups.get(output.promptFanId)??[]),output]);}
    return [...groups.entries()].sort(([,left],[,right])=>Math.max(...right.map((output)=>output.sequence))-Math.max(...left.map((output)=>output.sequence)))[0]??null;
  }

  override render(){
    const latest=this.#latestFan();if(!latest)return nothing;const [fanId,fanOutputs]=latest;const byTechnique=new Map(fanOutputs.map((output)=>[output.promptTechnique,output]));const activeJobs=this.store.documentGenerationJobs().filter((job)=>job.promptFanId===fanId);const complete=PROMPT_TECHNIQUE_DEFINITIONS.filter((definition)=>byTechnique.has(definition.id)).length;const quality=fanOutputs[0]?outputQualityLabel(fanOutputs[0]):activeJobs[0]?.kind==="preview"?"Draft":"Full quality";const projection=this.store.projection.get();const folder=projection.membership[projection.documentId]?.collectionId;const preference=this.store.promptTechniquePreference();
    return html`<div class="prompt-fan-review-trigger-wrap"><button class="prompt-fan-review-trigger" aria-haspopup="dialog" @click=${()=>{this.#open=true;this.requestUpdate();}}>${icon("compare")}<span>${complete===4?`Compare ${quality.toLowerCase()} prompt fan`:`Prompt fan · ${complete} of 4 ready`}</span></button></div>
      ${this.#open?html`<dialog class="modal prompt-fan-dialog" closedby="any" aria-labelledby="prompt-fan-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.#close();}} @cancel=${(event:Event)=>{event.preventDefault();this.#close();}} @close=${()=>{if(this.#open){this.#open=false;this.requestUpdate();}}}>
        <section class="modal-card prompt-fan-card">
          <button class="icon-button modal-close" aria-label="Close prompt fan comparison" @click=${this.#close}>${icon("close")}</button>
          <header><span>${quality} experiment</span><h2 id="prompt-fan-title">One document, four prompt structures</h2><p>The creative direction and document state are held constant. Only the language used to hand that context to the image model changes.</p></header>
          <div class="prompt-fan-preference-bar"><div><b>Prefer the clearest handoff</b><small>A preference changes future single-image requests. Fan always runs all four.</small></div><label>Apply preference to<select .value=${this.#scope} @change=${(event:Event)=>{this.#scope=(event.target as HTMLSelectElement).value as PromptPreferenceScope;this.requestUpdate();}}><option value="document">This document</option><option value="collection" ?disabled=${!folder}>${folder?"Current folder":"Current folder · file document first"}</option><option value="project">This project</option><option value="account">Every project</option></select></label></div>
          <div class="prompt-fan-grid">${PROMPT_TECHNIQUE_DEFINITIONS.map((definition)=>{const output=byTechnique.get(definition.id);const preferred=preference.technique===definition.id&&Boolean(preference.preference);const prompt=output?.promptRef?this.store.content.get()[output.promptRef]:"";return html`<article class=${`prompt-fan-option ${preferred?"preferred":""}`}>
            <header><div><span>${definition.shortLabel}</span><h3>${definition.label}</h3></div>${preferred?html`<em>${icon("check")} Preferred</em>`:nothing}</header>
            <p>${definition.description}</p>
            <div class="prompt-fan-image">${output?html`<forma-output-visual .output=${output} .interactive=${true}></forma-output-visual>`:html`<div class="prompt-fan-pending">${icon("clock")}<span>${activeJobs.some((job)=>job.promptTechnique===definition.id)?"Queued on the server":"Awaiting this result"}</span></div>`}</div>
            ${output?html`<footer><span><b>${outputQualityLabel(output)}</b><small>${output.modelId} · ${Math.max(0,Math.round(output.latency/100)/10)}s</small></span><button class="button secondary compact" @click=${()=>this.store.preferPromptTechnique(definition.id as PromptTechnique,this.#scope,{fanId,outputId:output.id})}>${preferred?"Keep preferred":"Prefer this method"}</button></footer>${prompt?html`<details><summary>Inspect prepared prompt</summary><pre>${prompt}</pre></details>`:nothing}`:nothing}
          </article>`;})}</div>
          <footer><p>${complete===4?"All four results are durable generations and remain available in every document view.":`${complete} result${complete===1?" is":"s are"} ready. The remaining server jobs continue if this dialog or page closes.`}</p><button class="button secondary" @click=${this.#close}>Done</button></footer>
        </section>
      </dialog>`:nothing}`;
  }
}

customElements.define("forma-prompt-fan-review",PromptFanReview);
declare global{interface HTMLElementTagNameMap{"forma-prompt-fan-review":PromptFanReview}}

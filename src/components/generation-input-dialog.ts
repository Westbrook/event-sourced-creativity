import { html, nothing } from "lit";
import type { GenerationInputInspection } from "../model/generation-inputs";
import { copyTextToClipboard, FormaElement, icon } from "./forma-element";
import { ensureModalDialog } from "./modal-dialog";

export class GenerationInputDialog extends FormaElement {
  static properties={open:{type:Boolean},inspection:{attribute:false}};
  open=false;inspection:GenerationInputInspection|null=null;
  protected override updated(){const dialog=this.renderRoot.querySelector<HTMLDialogElement>("dialog");if(this.open&&dialog&&!dialog.open)ensureModalDialog(dialog);if(!this.open&&dialog?.open)dialog.close();}
  #close(){this.open=false;this.renderRoot.querySelector<HTMLDialogElement>("dialog")?.close();this.dispatchEvent(new CustomEvent("generation-input-close",{bubbles:true,composed:true}));this.requestUpdate();}
  #backdrop(event:MouseEvent){if(event.target===event.currentTarget)this.#close();}
  async #copy(value:string,label:string){const copied=await copyTextToClipboard(value);this.store.toast(copied?this.i18n.system("{label} copied.",{label:this.i18n.system(label)}):this.i18n.system("{label} could not be copied.",{label:this.i18n.system(label)}));}
  override render(){
    const inspection=this.inspection;if(!inspection)return nothing;
    const failed=inspection.outcome==="failed",running=inspection.outcome==="in_progress";
    const receipt=JSON.stringify(inspection.receipt,null,2),accounting=record(inspection.receipt.generation_receipt);
    const render=record(inspection.receipt.render);
    const frozenInputs=Array.isArray(inspection.receipt.frozen_inputs)?inspection.receipt.frozen_inputs.map(record):[];
    const frozenReferences=frozenInputs.flatMap((input)=>Array.isArray(input.reference_inputs)?input.reference_inputs:[]);
    const references=Array.isArray(render.reference_inputs)?render.reference_inputs:Array.isArray(inspection.receipt.reference_inputs)?inspection.receipt.reference_inputs:frozenReferences;
    const providerContacted=accounting.provider_contacted;
    const promptLabel=providerContacted===true?"Submitted prompt":providerContacted===false?"Prepared prompt":"Retained prompt";
    const knownStatuses=new Set(["not_submitted","submitted","completed","submission_unknown","unknown","not_transmitted","transmitted","estimated","authorizing","active","executing","settled","released","local_persistence","source_fidelity_validation","provider","application","planning"]);
    const status=(value:unknown)=>typeof value==="string"?knownStatuses.has(value)?this.i18n.system(value.replaceAll("_"," ")):value.replaceAll("_"," "):this.i18n.system("unknown");
    const dollars=(value:unknown)=>typeof value==="number"&&Number.isFinite(value)?`$${(value/1_000_000).toFixed(6)}`:this.i18n.system("Not yet confirmed");
    const facts:Array<[string,string|null]>=[
      ["Provider",accounting.provider?`${String(accounting.provider)}${accounting.model?` · ${String(accounting.model)}`:""}`:null],
      ["Authored slides",typeof accounting.authored_slide_count==="number"?this.i18n.number(accounting.authored_slide_count):null],
      ["Requested slides",typeof accounting.requested_slide_count==="number"?this.i18n.number(accounting.requested_slide_count):null],
      ["Predicted slides",typeof accounting.predicted_slide_count==="number"?this.i18n.number(accounting.predicted_slide_count):null],
      ["Completed slides",typeof accounting.actual_slide_count==="number"?this.i18n.number(accounting.actual_slide_count):null],
      ["Provider batches",typeof accounting.batch_count==="number"?this.i18n.number(accounting.batch_count):null],
      ["Provider calls",typeof accounting.actual_provider_call_count==="number"?typeof accounting.maximum_provider_call_count==="number"?this.i18n.system("{count} recorded · up to {maximum}",{count:this.i18n.number(accounting.actual_provider_call_count),maximum:this.i18n.number(accounting.maximum_provider_call_count)}):this.i18n.system("{count} recorded",{count:this.i18n.number(accounting.actual_provider_call_count)}):typeof accounting.minimum_provider_call_count==="number"&&typeof accounting.maximum_provider_call_count==="number"?this.i18n.system("{minimum}–{maximum} possible",{minimum:this.i18n.number(accounting.minimum_provider_call_count),maximum:this.i18n.number(accounting.maximum_provider_call_count)}):null],
      ["Provider request",accounting.provider_request_status?status(accounting.provider_request_status):null],
      ["Source transmission",accounting.source_transmission_status?status(accounting.source_transmission_status):null],
      ["Reserved amount",typeof accounting.reservation_microusd==="number"?dollars(accounting.reservation_microusd):null],
      ["Application spending ceiling",accounting.reservation_is_application_hard_cap===true&&typeof accounting.maximum_authorized_cost_microusd==="number"?dollars(accounting.maximum_authorized_cost_microusd):null],
      ["Settled cost",typeof accounting.settled_cost_microusd==="number"?dollars(accounting.settled_cost_microusd):accounting.provider_request_status?this.i18n.system("Not yet confirmed"):null],
      ["Reservation",accounting.reservation_status?status(accounting.reservation_status):null],
      ["Failure stage",accounting.failure_stage?status(accounting.failure_stage):null],
    ].filter((entry):entry is [string,string]=>entry[1]!==null);
    const description=inspection.retained?failed?this.i18n.system("These are the retained inputs captured before the attempt failed. They are not rebuilt from the document’s current state."):running?this.i18n.system("These are the immutable private inputs captured when this in-progress generation was accepted."):this.i18n.system("This is the retained input receipt for the completed output. It is not rebuilt from the document’s current state."):failed?this.i18n.system("Only the surviving job and event receipt is available; private inputs expired or were not captured for this earlier failure."):running?this.i18n.system("The accepted generation receipt is available, but its private inputs have not been loaded."):this.i18n.system("Only the surviving public receipt is available for this older output.");
    return html`<dialog class="generation-input-dialog" closedby="any" @click=${this.#backdrop} @close=${()=>{if(this.open){this.open=false;this.dispatchEvent(new CustomEvent("generation-input-close",{bubbles:true,composed:true}));this.requestUpdate();}}}>
      <article><header><div><span>${inspection.subtitle}</span><h2>${inspection.title}</h2><p>${description}</p></div><button class="icon-button" aria-label="Close generation inputs" @click=${()=>this.#close()}>${icon("close")}</button></header>
      <main>
        ${facts.length?html`<section class="generation-receipt-summary"><header><div><h3>Generation receipt</h3><p>Verified provider, source-transmission, slide-count, reservation, and settlement details for this attempt.</p></div></header><dl>${facts.map(([label,value])=>html`<div><dt>${this.i18n.system(label)}</dt><dd>${value}</dd></div>`)}</dl>${accounting.slide_count_mismatch===true?html`<p role="status">The requested slide count intentionally differs from the authored outline.</p>`:nothing}${accounting.reservation_is_application_hard_cap===true?html`<p>Forma checks the remaining application spending ceiling before every provider request or repair. This is not a provider-enforced spending cap.</p>`:accounting.reservation_is_provider_hard_cap===false?html`<p>A reservation is an application estimate, not a provider-enforced spending cap. Bounded repair calls may add billable usage.</p>`:nothing}</section>`:nothing}
        ${inspection.prompt?html`<section><header><div><h3>${this.i18n.system(promptLabel)}</h3><p>${providerContacted===true?failed?this.i18n.system("The exact retained prompt associated with the failed provider request."):this.i18n.system("The exact retained prompt sent to the generation provider."):providerContacted===false?this.i18n.system("The retained prompt was prepared locally and has not been submitted to a provider."):this.i18n.system("The retained prompt is available, but provider submission has not been confirmed.")}</p></div><button class="button secondary compact" @click=${()=>this.#copy(inspection.prompt,"Prompt")}>Copy prompt</button></header><textarea readonly spellcheck="false" .value=${inspection.prompt} aria-label=${this.i18n.system("{promptLabel} for generation", { promptLabel: this.i18n.system(promptLabel) })}></textarea></section>`:nothing}
        ${references.length?html`<section><header><div><h3>Reference pixels</h3><p>${references.length} ordered reference image${references.length===1?" " + this.i18n.system("was"):this.i18n.system("s were")} supplied or prepared. Pixel receipts show whether bytes reached the provider and include hashes without duplicating private image data.</p></div></header><ol class="generation-reference-receipts">${references.map((value,index)=>{const item=record(value);return html`<li><b>${String(item.label??`Reference ${index+1}`)}</b><span>${item.storyboard_sequence?this.i18n.system("Storyboard shot {storyboard_sequence}", { storyboard_sequence: String(item.storyboard_sequence) }):this.i18n.system("Reference {count}", { count: this.i18n.number(index+1) })} · ${String(item.mode??"context")}</span><small>${item.pixels_submitted===true?this.i18n.system("Pixels submitted"):item.pixels_submitted===false?this.i18n.system("Metadata only"):this.i18n.system("Prepared before failure")}${item.byte_length?" " + this.i18n.system("· {formatted} bytes", { formatted: Number(item.byte_length).toLocaleString(this.i18n.locale) }):""}${item.sha256?` · SHA-256 ${String(item.sha256).slice(0,16)}…`:""}</small>${item.shot_direction?html`<p>${String(item.shot_direction)}</p>`:nothing}</li>`;})}</ol></section>`:nothing}
        <section><header><div><h3>Complete input receipt</h3><p>Frozen document state, request settings, provider parameters, provenance, reference ordering, and any technical failure.</p></div><button class="button secondary compact" @click=${()=>this.#copy(receipt,"Input receipt")}>Copy receipt</button></header><textarea class="generation-input-receipt" readonly spellcheck="false" .value=${receipt} aria-label="Complete generation input receipt"></textarea></section>
      </main><footer><span>${inspection.retained?failed?this.i18n.system("Retained failed-attempt input"):running?this.i18n.system("Retained in-progress input"):this.i18n.system("Retained private input"):failed?this.i18n.system("Partial failure receipt"):running?this.i18n.system("Partial in-progress receipt"):this.i18n.system("Partial legacy receipt")}</span><button class="button primary" @click=${()=>this.#close()}>Done</button></footer></article>
    </dialog>`;
  }
}

const record=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
customElements.define("forma-generation-input-dialog",GenerationInputDialog);
declare global{interface HTMLElementTagNameMap{"forma-generation-input-dialog":GenerationInputDialog}}

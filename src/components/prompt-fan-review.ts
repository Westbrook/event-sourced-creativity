import { html, nothing } from "lit";
import { outputQualityLabel, type CreativeOutput } from "../model/events";
import { generationFailureGuidance } from "../model/document-jobs";
import { localizedGenerationFailureGuidance } from "./design-system/localized-runtime-copy";
import { outputGenerationInputInspection } from "../model/generation-inputs";
import { PROMPT_TECHNIQUE_DEFINITIONS, type PromptPreferenceScope, type PromptTechnique } from "../model/prompt-structures";
import { copyTextToClipboard, FormaElement, icon } from "./forma-element";
import { ensureModalDialog } from "./modal-dialog";
import { reuseManualOutput, type ManualOutputReuse } from "./manual-output-reuse";
import "./icons-history";
import "./generation-input-dialog";
import "./output-visual";

export class PromptFanReview extends FormaElement {
  static properties = { fanId: { type: String } };
  fanId = "";
  #open = false;
  #presentationRevision=0;
  #outputReuse:ManualOutputReuse={cancel:null};
  override disconnectedCallback(){this.#outputReuse.cancel?.();this.#presentationRevision++;super.disconnectedCallback();}
  #inputId = "";
  #scope: PromptPreferenceScope = "document";
  #promptCopy: { key: string; ok: boolean } | null = null;

  protected override updated() {
    const dialog = this.querySelector<HTMLDialogElement>(".prompt-fan-dialog");
    if (this.#open) ensureModalDialog(dialog);
  }

  #close() {
    this.#presentationRevision++;
    this.querySelector<HTMLDialogElement>(".prompt-fan-dialog")?.close();
    this.#open = false;
    this.#promptCopy = null;
    this.requestUpdate();
  }

  async #copyPrompt(prompt: string, key: string) {
    const ok = await copyTextToClipboard(prompt);
    this.#promptCopy = { key, ok };
    this.requestUpdate();
  }

  async #useAsInput(output:CreativeOutput,event:MouseEvent){
    const element=this.querySelector<HTMLDialogElement>(".prompt-fan-dialog"),trigger=event.currentTarget as HTMLElement|null;
    if(!element||!trigger)return;
    const destination=this.store.projection.get().documentId,fanId=this.fanId,revision=this.#presentationRevision;
    const opener=this.querySelector<HTMLButtonElement>(".prompt-fan-review-trigger")??undefined;let closedRevision:number|null=null;
    await reuseManualOutput(this,this.store,this.#outputReuse,event,{
      destinationDocumentId:destination,
      current:()=>this.fanId===fanId&&this.#fan()?.[0]===fanId
        &&this.#fan()?.[1].some(value=>value.id===output.id&&value.sourceEventId===output.sourceEventId
          &&value.documentId===output.documentId&&value.mediaUrl===output.mediaUrl&&!value.discarded)===true,
      copy:()=>this.store.addImageOutputAsContext(output.id,destination,"prompt-fan-comparison",{reveal:false}),
      presentation:{owner:this,element,trigger,opener,
        current:()=>this.#open&&this.#presentationRevision===revision&&this.querySelector(".prompt-fan-dialog")===element,
        close:()=>{this.#close();closedRevision=this.#presentationRevision;},
        closedCurrent:()=>!this.#open&&closedRevision!==null&&this.#presentationRevision===closedRevision,
      },
    });
    this.requestUpdate();
  }
  #inputLabel(output:CreativeOutput,technique:string){const adopted=this.store.projection.get().blocks.some((block)=>block.properties.source_output_id===output.id);if(this.store.route.get().startsWith("/canvas/"))return`${this.i18n.t(adopted?"projects.editCreator":"projects.useEditCreator",adopted?"Edit in Creator Workspace":"Use & edit in Creator Workspace")}: \u2068${technique}\u2069`;return`${adopted?"Edit":"Use and edit"} the ${technique} image as input`;}

  #fans() {
    const groups = new Map<string, CreativeOutput[]>();
    for (const output of this.store.projection.get().outputs) {
      if (!output.promptFanId) continue;
      groups.set(output.promptFanId, [...(groups.get(output.promptFanId) ?? []), output]);
    }
    for (const job of this.store.documentJobs.get()) if (job.promptFanId) groups.set(job.promptFanId, groups.get(job.promptFanId) ?? []);
    for (const event of this.store.events.get()) if (event.type === "GenerationFailed" && event.payload.prompt_fan_id) { const id=String(event.payload.prompt_fan_id);groups.set(id,groups.get(id)??[]); }
    const recency=(id:string,outputs:CreativeOutput[])=>Math.max(0,...outputs.map((output)=>output.sequence),...this.store.events.get().filter((event)=>event.payload.prompt_fan_id===id).map((event)=>event.sequence));
    return [...groups.entries()].sort(([rightId, right], [leftId, left]) => recency(leftId,left)-recency(rightId,right));
  }

  #fan() {
    const groups = this.#fans();
    return (this.fanId ? groups.find(([id]) => id === this.fanId) : groups[0]) ?? null;
  }

  #show(fanId: string, outputs: CreativeOutput[]) {
    this.#presentationRevision++;
    this.fanId = fanId;
    this.#open = true;
    this.requestUpdate();
    if(!this.store.session.get()?.projectContext){
      const content=this.store.content.get();const fan=this.store.documentJobs.get().find((job)=>job.kind==="prompt_fan"&&job.promptFanId===fanId);const reference=[...outputs.map((output)=>output.promptRef),...(fan?.members??[]).map((member)=>member.moderationPromptRef)].find((value)=>value&&!content[value]);if(reference)void this.store.ensurePrivateContent(reference).then(()=>this.requestUpdate());
      if(this.store.ui.instrumentation&&outputs.length)void this.store.hot({type:"ComparisonOpened",payload:{object_ids:outputs.map((output)=>output.id),prompt_fan_id:fanId,source_surface:"prompt-fan-comparison"}});
    }
  }

  override render() {
    const fan = this.#fan();
    if (!fan) return nothing;
    const [fanId, fanOutputs] = fan;
    const byTechnique = new Map(fanOutputs.map((output) => [output.promptTechnique, output]));
    const fanJob = this.store.documentJobs.get().find((job) => job.kind === "prompt_fan" && job.promptFanId === fanId);
    const memberByTechnique = new Map(fanJob?.members.map((member)=>[member.promptTechnique,member])??[]);
    const failedEvents = new Map(this.store.events.get().filter((event)=>event.type==="GenerationFailed"&&event.payload.prompt_fan_id===fanId&&event.payload.prompt_technique).map((event)=>[String(event.payload.prompt_technique),event]));
    const failedTechniques = new Set(PROMPT_TECHNIQUE_DEFINITIONS.filter((definition)=>memberByTechnique.get(definition.id)?.status==="failed"||failedEvents.has(definition.id)).map((definition)=>definition.id));
    const complete = PROMPT_TECHNIQUE_DEFINITIONS.filter((definition) => byTechnique.has(definition.id)||failedTechniques.has(definition.id)).length;
    const failed = failedTechniques.size;
    const standalone = fanOutputs.filter((output) => output.standalone).length;
    const quality = fanOutputs[0] ? outputQualityLabel(fanOutputs[0]) : fanJob?.fanKind === "preview" ? "Draft" : "Full quality";
    const projection = this.store.projection.get();
    const folder = projection.membership[projection.documentId]?.collectionId;
    const preference = this.store.promptTechniquePreference();
    const promotable = fanOutputs.filter((output) => !output.standalone);
    const inputOutput = fanOutputs.find((output) => output.id === this.#inputId);
    const context=this.store.session.get()?.projectContext;
    const canAuthor=!context||context.permissions.includes("project.author");
    return html`<div class="prompt-fan-review-trigger-wrap"><button class="prompt-fan-review-trigger" aria-haspopup="dialog" @click=${() => this.#show(fanId, fanOutputs)}>${icon("compare")}<span>${context?this.i18n.t("projects.compareImages","Compare images"):this.i18n.system("Compare & promote")}</span><small>${fanOutputs.length} ready${failed ? " " + this.i18n.system("· {failed} failed", { failed: this.i18n.number(failed) }) : complete<4?" " + this.i18n.system("· {value} running", { value: this.i18n.number(4-complete) }):""}${standalone ? " " + this.i18n.system("· {standalone} standalone", { standalone: this.i18n.number(standalone) }) : ""}</small></button></div>
      ${this.#open ? html`<dialog class="modal prompt-fan-dialog" closedby="any" aria-labelledby="prompt-fan-title" @click=${(event: MouseEvent) => { if (event.target === event.currentTarget) this.#close(); }} @cancel=${(event: Event) => { event.preventDefault(); this.#close(); }} @close=${() => { if (this.#open) { this.#presentationRevision++;this.#open = false; this.requestUpdate(); } }}>
        <section class="modal-card prompt-fan-card">
          <button class="icon-button modal-close" aria-label="Close prompt fan comparison" @click=${this.#close}>${icon("close")}</button>
          <header><span>${this.i18n.system("{quality} fan generation",{quality:this.i18n.system(quality)})}</span><h2 id="prompt-fan-title">One generation, four ways to hand off the plan</h2><p>All four images share one document state and one fan identity. Compare the prompt processes, then promote only the images that deserve to stand alone.</p></header>
          ${!context?html`<form class="prompt-fan-preference-bar" @submit=${(event:SubmitEvent)=>event.preventDefault()}><div><b>Choose a future prompt default</b><small>This affects future single generations at the scope you choose. A fan always tests all four processes.</small></div><label>Apply default to<select .value=${this.#scope} @change=${(event: Event) => { this.#scope = (event.target as HTMLSelectElement).value as PromptPreferenceScope; this.requestUpdate(); }}><option value="document">This document</option><option value="collection" ?disabled=${!folder}>${folder ? this.i18n.system("Current folder") : this.i18n.system("Current folder · file document first")}</option><option value="project">This project</option><option value="account">Every project</option></select></label></form>`:nothing}
          <div class="prompt-fan-grid">${PROMPT_TECHNIQUE_DEFINITIONS.map((definition) => {
            const output = byTechnique.get(definition.id);
            const preferred = preference.technique === definition.id && Boolean(preference.preference);
            const prompt = output?.promptRef ? this.store.content.get()[output.promptRef] : "";
            const member=memberByTechnique.get(definition.id);const failedEvent=failedEvents.get(definition.id);const failure=member?.error;const failedHere=member?.status==="failed"||Boolean(failedEvent);const failureCategory=failure?.category??String(failedEvent?.payload.error_category??"unknown");const failureRequestId=failure?.requestId??(failedEvent?.payload.provider_request_id?String(failedEvent.payload.provider_request_id):null);const failurePromptRef=member?.moderationPromptRef??(failedEvent?.payload.prompt_ref?String(failedEvent.payload.prompt_ref):null);const failurePrompt=failurePromptRef?this.store.content.get()[failurePromptRef]:"";const fallback=failureCategory==="safety"?"Change this request or its reference before trying again.":"This prompt structure did not produce an image.";const failureGuidance=localizedGenerationFailureGuidance(generationFailureGuidance(failure??null,fallback),failure??null,fallback,this.i18n);
            return html`<article class=${`prompt-fan-option ${preferred ? "preferred" : ""} ${output?.standalone ? "standalone" : ""}`}>
              <header><div><span>${this.i18n.system(definition.shortLabel)} prompt process</span><h3>${this.i18n.system(definition.label)}</h3></div><div class="prompt-fan-statuses">${output?.standalone ? html`<em>${icon("check")} Standalone</em>` : nothing}${preferred ? html`<em>${icon("check")} Default</em>` : nothing}</div></header>
              <p>${this.i18n.system(definition.description)}</p>
              <div class="prompt-fan-image">${output ? html`<forma-output-visual .output=${output} .fanOutputs=${fanOutputs} .interactive=${true}></forma-output-visual>` : failedHere ? html`<div class="prompt-fan-pending failed">${icon("close")}<span><b>${failureGuidance.title}</b><small>${failureGuidance.summary}${failureRequestId?" " + this.i18n.system("Request {failureRequestId}.", { failureRequestId: failureRequestId }):""}</small></span></div>` : html`<div class="prompt-fan-pending">${icon("clock")}<span>${member?.status==="running"?this.i18n.system("Generating on the server"):member?.status==="queued"||fanJob?this.i18n.system("Queued on the server"):this.i18n.system("No recorded result")}</span></div>`}</div>
              ${failedHere&&failureCategory==="safety"?failurePrompt?html`<details class="prompt-fan-failure-prompt"><summary>Review submitted prompt</summary><div class="prompt-copy-heading"><p>Exact private request sent to the generation workflow.</p><button type="button" class="button ghost compact" @click=${()=>this.#copyPrompt(failurePrompt,definition.id)}>${this.#promptCopy?.key===definition.id&&this.#promptCopy.ok?html`${icon("check")} Copied`:this.i18n.system("Copy prompt")}</button></div><pre>${failurePrompt}</pre>${this.#promptCopy?.key===definition.id?html`<span class=${`prompt-copy-status ${this.#promptCopy.ok?"success":"error"}`} role="status">${this.#promptCopy.ok?this.i18n.system("Prompt copied to the clipboard."):this.i18n.system("The prompt could not be copied. Select the text above and copy it manually.")}</span>`:nothing}</details>`:html`<p class="prompt-fan-failure-prompt-unavailable">Submitted prompt was not retained for this earlier failure.</p>`:nothing}
              ${output ? html`<footer><span><b>${this.i18n.system(outputQualityLabel(output))}</b><small>${output.modelId} · ${this.i18n.system("Latency")} ${this.i18n.number(Math.max(0, Math.round(output.latency / 100) / 10))}s</small></span><div class="prompt-fan-output-actions">${!context?html`<button class="button secondary compact" ?disabled=${output.standalone} @click=${() => this.store.promotePromptFanOutputs(fanId, [output.id])}>${output.standalone ? this.i18n.system("Promoted") : this.i18n.system("Promote image")}</button><button class="button ghost compact" @click=${() => this.store.preferPromptTechnique(definition.id as PromptTechnique, this.#scope, { fanId, outputId: output.id })}>${preferred ? this.i18n.system("Keep as default") : this.i18n.system("Use as default")}</button>`:nothing}${canAuthor?html`<button type="button" class="button ghost compact" aria-label=${this.#inputLabel(output,definition.label)} @click=${(event:MouseEvent)=>this.#useAsInput(output,event)}>${this.store.route.get().startsWith("/canvas/")?projection.blocks.some((block)=>block.properties.source_output_id===output.id)?this.i18n.t("projects.editCreator","Edit in Creator Workspace"):this.i18n.t("projects.useEditCreator","Use & edit in Creator Workspace"):projection.blocks.some((block)=>block.properties.source_output_id===output.id)?this.i18n.system("Edit input"):this.i18n.system("Use & edit")}</button>`:nothing}<button class="button ghost compact" @click=${()=>{this.#inputId=output.id;this.requestUpdate();}}>${this.i18n.system("Inspect inputs")}</button></div></footer>${!context&&prompt ? html`<details><summary>Inspect prepared ${this.i18n.system(definition.shortLabel).toLocaleLowerCase(this.i18n.locale)} prompt</summary><pre>${prompt}</pre></details>` : nothing}` : nothing}
            </article>`;
          })}</div>
          <footer><p>${complete === 4 ? failed ? (fanOutputs.length===1 ? this.i18n.system("{count} image ready and {failed} failed. Failures are terminal and remain part of this comparison receipt.", { count: this.i18n.number(fanOutputs.length), failed: this.i18n.number(failed) }) : this.i18n.system("{count} images ready and {failed} failed. Failures are terminal and remain part of this comparison receipt.", { count: this.i18n.number(fanOutputs.length), failed: this.i18n.number(failed) })) : (standalone === 1 ? this.i18n.system("{count} image promoted. The complete fan remains one comparison in history.", { count: standalone || "No" }) : this.i18n.system("{count} images promoted. The complete fan remains one comparison in history.", { count: standalone || "No" })) : this.i18n.system("{complete} of 4 prompt processes finished. Remaining jobs continue if this dialog or page closes.", { complete: this.i18n.number(complete) })}</p><div>${!context?html`<button class="button primary" ?disabled=${!promotable.length} @click=${() => this.store.promotePromptFanOutputs(fanId, promotable.map((output) => output.id))}>${promotable.length ? this.i18n.system("Promote all {count}", { count: this.i18n.number(promotable.length) }) : this.i18n.system("No images to promote")}</button>`:nothing}<button class="button secondary" @click=${this.#close}>Done</button></div></footer>
        </section>
      </dialog>` : nothing}${inputOutput?html`<forma-generation-input-dialog .open=${true} .inspection=${outputGenerationInputInspection(inputOutput,this.store.events.get(),this.store.content.get())} @generation-input-close=${()=>{this.#inputId="";this.requestUpdate();}}></forma-generation-input-dialog>`:nothing}`;
  }
}

if (!customElements.get("forma-prompt-fan-review")) customElements.define("forma-prompt-fan-review", PromptFanReview);
declare global { interface HTMLElementTagNameMap { "forma-prompt-fan-review": PromptFanReview } }

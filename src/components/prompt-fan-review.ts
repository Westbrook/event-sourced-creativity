import { html, nothing } from "lit";
import { outputQualityLabel, type CreativeOutput } from "../model/events";
import { generationFailureGuidance } from "../model/document-jobs";
import { PROMPT_TECHNIQUE_DEFINITIONS, type PromptPreferenceScope, type PromptTechnique } from "../model/prompt-structures";
import { copyTextToClipboard, FormaElement, icon } from "./forma-element";
import "./output-visual";

export class PromptFanReview extends FormaElement {
  static properties = { fanId: { type: String } };
  fanId = "";
  #open = false;
  #scope: PromptPreferenceScope = "document";
  #promptCopy: { key: string; ok: boolean } | null = null;

  protected override updated() {
    const dialog = this.querySelector<HTMLDialogElement>(".prompt-fan-dialog");
    if (this.#open && dialog && !dialog.open) dialog.showModal();
  }

  #close() {
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
    this.fanId = fanId;
    this.#open = true;
    this.requestUpdate();
    if (this.store.ui.instrumentation && outputs.length) void this.store.hot({ type: "ComparisonOpened", payload: { object_ids: outputs.map((output) => output.id), prompt_fan_id: fanId, source_surface: "prompt-fan-comparison" } });
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
    return html`<div class="prompt-fan-review-trigger-wrap"><button class="prompt-fan-review-trigger" aria-haspopup="dialog" @click=${() => this.#show(fanId, fanOutputs)}>${icon("compare")}<span>Compare & promote</span><small>${fanOutputs.length} ready${failed ? ` · ${failed} failed` : complete<4?` · ${4-complete} running`:""}${standalone ? ` · ${standalone} standalone` : ""}</small></button></div>
      ${this.#open ? html`<dialog class="modal prompt-fan-dialog" closedby="any" aria-labelledby="prompt-fan-title" @click=${(event: MouseEvent) => { if (event.target === event.currentTarget) this.#close(); }} @cancel=${(event: Event) => { event.preventDefault(); this.#close(); }} @close=${() => { if (this.#open) { this.#open = false; this.requestUpdate(); } }}>
        <section class="modal-card prompt-fan-card">
          <button class="icon-button modal-close" aria-label="Close prompt fan comparison" @click=${this.#close}>${icon("close")}</button>
          <header><span>${quality} fan generation</span><h2 id="prompt-fan-title">One generation, four ways to hand off the plan</h2><p>All four images share one document state and one fan identity. Compare the prompt processes, then promote only the images that deserve to stand alone.</p></header>
          <div class="prompt-fan-preference-bar"><div><b>Choose a future prompt default</b><small>This affects future single generations at the scope you choose. A fan always tests all four processes.</small></div><label>Apply default to<select .value=${this.#scope} @change=${(event: Event) => { this.#scope = (event.target as HTMLSelectElement).value as PromptPreferenceScope; this.requestUpdate(); }}><option value="document">This document</option><option value="collection" ?disabled=${!folder}>${folder ? "Current folder" : "Current folder · file document first"}</option><option value="project">This project</option><option value="account">Every project</option></select></label></div>
          <div class="prompt-fan-grid">${PROMPT_TECHNIQUE_DEFINITIONS.map((definition) => {
            const output = byTechnique.get(definition.id);
            const preferred = preference.technique === definition.id && Boolean(preference.preference);
            const prompt = output?.promptRef ? this.store.content.get()[output.promptRef] : "";
            const member=memberByTechnique.get(definition.id);const failedEvent=failedEvents.get(definition.id);const failure=member?.error;const failedHere=member?.status==="failed"||Boolean(failedEvent);const failureCategory=failure?.category??String(failedEvent?.payload.error_category??"unknown");const failureRequestId=failure?.requestId??(failedEvent?.payload.provider_request_id?String(failedEvent.payload.provider_request_id):null);const failurePromptRef=member?.moderationPromptRef??(failedEvent?.payload.prompt_ref?String(failedEvent.payload.prompt_ref):null);const failurePrompt=failurePromptRef?this.store.content.get()[failurePromptRef]:"";const failureGuidance=generationFailureGuidance(failure??null,failureCategory==="safety"?"Change this request or its reference before trying again.":"This prompt structure did not produce an image.");
            return html`<article class=${`prompt-fan-option ${preferred ? "preferred" : ""} ${output?.standalone ? "standalone" : ""}`}>
              <header><div><span>${definition.shortLabel} prompt process</span><h3>${definition.label}</h3></div><div class="prompt-fan-statuses">${output?.standalone ? html`<em>${icon("check")} Standalone</em>` : nothing}${preferred ? html`<em>${icon("check")} Default</em>` : nothing}</div></header>
              <p>${definition.description}</p>
              <div class="prompt-fan-image">${output ? html`<forma-output-visual .output=${output} .fanOutputs=${fanOutputs} .interactive=${true}></forma-output-visual>` : failedHere ? html`<div class="prompt-fan-pending failed">${icon("close")}<span><b>${failureGuidance.title}</b><small>${failureGuidance.summary}${failureRequestId?` Request ${failureRequestId}.`:""}</small></span></div>` : html`<div class="prompt-fan-pending">${icon("clock")}<span>${member?.status==="running"?"Generating on the server":member?.status==="queued"||fanJob?"Queued on the server":"No recorded result"}</span></div>`}</div>
              ${failedHere&&failureCategory==="safety"?failurePrompt?html`<details class="prompt-fan-failure-prompt"><summary>Review submitted prompt</summary><div class="prompt-copy-heading"><p>Exact private request sent to the generation workflow.</p><button type="button" class="button ghost compact" @click=${()=>this.#copyPrompt(failurePrompt,definition.id)}>${this.#promptCopy?.key===definition.id&&this.#promptCopy.ok?`${icon("check")} Copied`:"Copy prompt"}</button></div><pre>${failurePrompt}</pre>${this.#promptCopy?.key===definition.id?html`<span class=${`prompt-copy-status ${this.#promptCopy.ok?"success":"error"}`} role="status">${this.#promptCopy.ok?"Prompt copied to the clipboard.":"The prompt could not be copied. Select the text above and copy it manually."}</span>`:nothing}</details>`:html`<p class="prompt-fan-failure-prompt-unavailable">Submitted prompt was not retained for this earlier failure.</p>`:nothing}
              ${output ? html`<footer><span><b>${outputQualityLabel(output)}</b><small>${output.modelId} · ${Math.max(0, Math.round(output.latency / 100) / 10)}s</small></span><div class="prompt-fan-output-actions"><button class="button secondary compact" ?disabled=${output.standalone} @click=${() => this.store.promotePromptFanOutputs(fanId, [output.id])}>${output.standalone ? "Promoted" : "Promote image"}</button><button class="button ghost compact" @click=${() => this.store.preferPromptTechnique(definition.id as PromptTechnique, this.#scope, { fanId, outputId: output.id })}>${preferred ? "Keep as default" : "Use as default"}</button></div></footer>${prompt ? html`<details><summary>Inspect prepared ${definition.shortLabel.toLowerCase()} prompt</summary><pre>${prompt}</pre></details>` : nothing}` : nothing}
            </article>`;
          })}</div>
          <footer><p>${complete === 4 ? failed ? `${fanOutputs.length} image${fanOutputs.length===1?"":"s"} ready and ${failed} failed. Failures are terminal and remain part of this comparison receipt.` : `${standalone || "No"} image${standalone === 1 ? "" : "s"} promoted. The complete fan remains one comparison in history.` : `${complete} of 4 prompt processes finished. Remaining jobs continue if this dialog or page closes.`}</p><div><button class="button primary" ?disabled=${!promotable.length} @click=${() => this.store.promotePromptFanOutputs(fanId, promotable.map((output) => output.id))}>${promotable.length ? `Promote all ${promotable.length}` : "No images to promote"}</button><button class="button secondary" @click=${this.#close}>Done</button></div></footer>
        </section>
      </dialog>` : nothing}`;
  }
}

customElements.define("forma-prompt-fan-review", PromptFanReview);
declare global { interface HTMLElementTagNameMap { "forma-prompt-fan-review": PromptFanReview } }

import { html, nothing } from "lit";
import { outputQualityLabel, type CreativeOutput } from "../model/events";
import { PROMPT_TECHNIQUE_DEFINITIONS, type PromptPreferenceScope, type PromptTechnique } from "../model/prompt-structures";
import { FormaElement, icon } from "./forma-element";
import "./output-visual";

export class PromptFanReview extends FormaElement {
  static properties = { fanId: { type: String } };
  fanId = "";
  #open = false;
  #scope: PromptPreferenceScope = "document";

  protected override updated() {
    const dialog = this.querySelector<HTMLDialogElement>(".prompt-fan-dialog");
    if (this.#open && dialog && !dialog.open) dialog.showModal();
  }

  #close() {
    this.querySelector<HTMLDialogElement>(".prompt-fan-dialog")?.close();
    this.#open = false;
    this.requestUpdate();
  }

  #fans() {
    const groups = new Map<string, CreativeOutput[]>();
    for (const output of this.store.projection.get().outputs) {
      if (!output.promptFanId) continue;
      groups.set(output.promptFanId, [...(groups.get(output.promptFanId) ?? []), output]);
    }
    return [...groups.entries()].sort(([, left], [, right]) => Math.max(...right.map((output) => output.sequence)) - Math.max(...left.map((output) => output.sequence)));
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
    const activeJobs = this.store.documentGenerationJobs().filter((job) => job.promptFanId === fanId);
    const complete = PROMPT_TECHNIQUE_DEFINITIONS.filter((definition) => byTechnique.has(definition.id)).length;
    const standalone = fanOutputs.filter((output) => output.standalone).length;
    const quality = fanOutputs[0] ? outputQualityLabel(fanOutputs[0]) : activeJobs[0]?.kind === "preview" ? "Draft" : "Full quality";
    const projection = this.store.projection.get();
    const folder = projection.membership[projection.documentId]?.collectionId;
    const preference = this.store.promptTechniquePreference();
    const promotable = fanOutputs.filter((output) => !output.standalone);
    return html`<div class="prompt-fan-review-trigger-wrap"><button class="prompt-fan-review-trigger" aria-haspopup="dialog" @click=${() => this.#show(fanId, fanOutputs)}>${icon("compare")}<span>Compare & promote</span><small>${complete} of 4 ready${standalone ? ` · ${standalone} standalone` : ""}</small></button></div>
      ${this.#open ? html`<dialog class="modal prompt-fan-dialog" closedby="any" aria-labelledby="prompt-fan-title" @click=${(event: MouseEvent) => { if (event.target === event.currentTarget) this.#close(); }} @cancel=${(event: Event) => { event.preventDefault(); this.#close(); }} @close=${() => { if (this.#open) { this.#open = false; this.requestUpdate(); } }}>
        <section class="modal-card prompt-fan-card">
          <button class="icon-button modal-close" aria-label="Close prompt fan comparison" @click=${this.#close}>${icon("close")}</button>
          <header><span>${quality} fan generation</span><h2 id="prompt-fan-title">One generation, four ways to hand off the plan</h2><p>All four images share one document state and one fan identity. Compare the prompt processes, then promote only the images that deserve to stand alone.</p></header>
          <div class="prompt-fan-preference-bar"><div><b>Choose a future prompt default</b><small>This affects future single generations at the scope you choose. A fan always tests all four processes.</small></div><label>Apply default to<select .value=${this.#scope} @change=${(event: Event) => { this.#scope = (event.target as HTMLSelectElement).value as PromptPreferenceScope; this.requestUpdate(); }}><option value="document">This document</option><option value="collection" ?disabled=${!folder}>${folder ? "Current folder" : "Current folder · file document first"}</option><option value="project">This project</option><option value="account">Every project</option></select></label></div>
          <div class="prompt-fan-grid">${PROMPT_TECHNIQUE_DEFINITIONS.map((definition) => {
            const output = byTechnique.get(definition.id);
            const preferred = preference.technique === definition.id && Boolean(preference.preference);
            const prompt = output?.promptRef ? this.store.content.get()[output.promptRef] : "";
            return html`<article class=${`prompt-fan-option ${preferred ? "preferred" : ""} ${output?.standalone ? "standalone" : ""}`}>
              <header><div><span>${definition.shortLabel} prompt process</span><h3>${definition.label}</h3></div><div class="prompt-fan-statuses">${output?.standalone ? html`<em>${icon("check")} Standalone</em>` : nothing}${preferred ? html`<em>${icon("check")} Default</em>` : nothing}</div></header>
              <p>${definition.description}</p>
              <div class="prompt-fan-image">${output ? html`<forma-output-visual .output=${output} .interactive=${true}></forma-output-visual>` : html`<div class="prompt-fan-pending">${icon("clock")}<span>${activeJobs.some((job) => job.promptTechnique === definition.id) ? "Queued on the server" : "Awaiting this result"}</span></div>`}</div>
              ${output ? html`<footer><span><b>${outputQualityLabel(output)}</b><small>${output.modelId} · ${Math.max(0, Math.round(output.latency / 100) / 10)}s</small></span><div class="prompt-fan-output-actions"><button class="button secondary compact" ?disabled=${output.standalone} @click=${() => this.store.promotePromptFanOutputs(fanId, [output.id])}>${output.standalone ? "Promoted" : "Promote image"}</button><button class="button ghost compact" @click=${() => this.store.preferPromptTechnique(definition.id as PromptTechnique, this.#scope, { fanId, outputId: output.id })}>${preferred ? "Keep as default" : "Use as default"}</button></div></footer>${prompt ? html`<details><summary>Inspect prepared ${definition.shortLabel.toLowerCase()} prompt</summary><pre>${prompt}</pre></details>` : nothing}` : nothing}
            </article>`;
          })}</div>
          <footer><p>${complete === 4 ? `${standalone || "No"} image${standalone === 1 ? "" : "s"} promoted. The complete fan remains one comparison in history.` : `${complete} result${complete === 1 ? " is" : "s are"} ready. Remaining jobs continue if this dialog or page closes.`}</p><div><button class="button primary" ?disabled=${!promotable.length} @click=${() => this.store.promotePromptFanOutputs(fanId, promotable.map((output) => output.id))}>${promotable.length ? `Promote all ${promotable.length}` : "All promoted"}</button><button class="button secondary" @click=${this.#close}>Done</button></div></footer>
        </section>
      </dialog>` : nothing}`;
  }
}

customElements.define("forma-prompt-fan-review", PromptFanReview);
declare global { interface HTMLElementTagNameMap { "forma-prompt-fan-review": PromptFanReview } }

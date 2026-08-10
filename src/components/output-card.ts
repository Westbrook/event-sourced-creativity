import { html, nothing } from "lit";
import { FormaElement, icon, downloadJson } from "./forma-element";
import type { CreativeOutput } from "../model/events";
import { CREATOR_AXES } from "../model/taste";

export class OutputCard extends FormaElement {
  static properties = { output: { attribute: false }, primary: { type: Boolean } };
  output!: CreativeOutput; primary = false;
  #critiqueOpen=false;#axis="style";#polarity:"positive"|"negative"="negative";#value="";#note="";
  async #saveCritique(event:SubmitEvent){event.preventDefault();if(!this.#value.trim())return;const saved=await this.store.critiqueObject(this.output.id,this.#axis,this.#polarity,this.#value.trim(),this.#note.trim());if(saved){this.#critiqueOpen=false;this.#value="";this.#note="";this.requestUpdate();}}
  override render() {
    const out = this.output; if (!out) return html``;
    const raw = out.contentRef ? this.store.content.get()[out.contentRef] : ""; let direction: Record<string, unknown> | null = null;
    if (raw) { try { direction = JSON.parse(raw) as Record<string, unknown>; } catch { direction = { rationale: raw }; } }
    return html`<article class="output-card ${this.primary ? "primary" : ""} ${this.store.ui.selectedOutputId === out.id ? "selected" : ""}" data-output-id=${out.id}>
      <button class="output-art variant-${out.variant % 4}" aria-label="Select generated output ${out.id}" aria-pressed=${this.store.ui.selectedOutputId === out.id} @click=${() => { this.store.patchUi({ selectedOutputId: out.id }); if (this.store.ui.instrumentation) void this.store.hot({ type: "ObjectViewed", payload: { object_id: out.id } }); }}><span class="art-glow"></span><span class="art-frame"></span><span class="art-vase"></span><span class="art-table"></span></button>
      ${direction ? html`<div class="provider-direction"><span class="eyebrow">Private provider output · retained 30 days</span><h3>${String(direction.title ?? "Creative direction")}</h3><p>${String(direction.rationale ?? direction.scene ?? "")}</p>${Array.isArray(direction.palette) ? html`<div>${direction.palette.map((color) => html`<span>${String(color)}</span>`)}</div>` : ""}</div>` : ""}
      <div class="output-info"><div><b>${direction ? String(direction.title ?? "Creative direction") : `Quiet nocturne ${out.variant + 1}`}</b><small>${out.provider} · ${out.modelId} · ${(out.latency / 1000).toFixed(1)}s</small></div><div class="output-actions">
        <button aria-pressed=${out.pinned} @click=${() => this.store.append({ type: out.pinned ? "ObjectUnpinned" : "ObjectPinned", payload: { object_id: out.id, scope: "project" } })}>${icon("pin")} ${out.pinned ? "Pinned" : "Pin"}</button>
        <button aria-pressed=${out.saved} @click=${() => this.store.append({ type: "ObjectSaved", payload: { object_id: out.id } })}>${icon("check")} ${out.saved ? "Saved" : "Save"}</button>
        <button aria-expanded=${this.#critiqueOpen} @click=${()=>{this.#critiqueOpen=!this.#critiqueOpen;this.requestUpdate();}}>${icon("edit")} Critique</button>
        <button @click=${() => { downloadJson(`${out.id}.json`, { output: out, context: this.store.projection.get().latestCompile, clearance: "owned" }); void this.store.append({ type: "ObjectExported", payload: { object_id: out.id, destination_class: "download", format: "application/json" } }); }}>${icon("download")} Export</button>
      </div></div>${this.#critiqueOpen?html`<form class="output-critique" @submit=${this.#saveCritique}><header><div><span class="eyebrow">Taste evidence · authored critique</span><b>What worked—or did not?</b></div><button type="button" class="icon-button" aria-label="Close critique" @click=${()=>{this.#critiqueOpen=false;this.requestUpdate();}}>${icon("close")}</button></header><div class="critique-grid"><label>Axis<select .value=${this.#axis} @change=${(event:Event)=>{this.#axis=(event.target as HTMLSelectElement).value;}}>${CREATOR_AXES.map(axis=>html`<option value=${axis}>${axis}</option>`)}</select></label><label>Signal<select .value=${this.#polarity} @change=${(event:Event)=>{this.#polarity=(event.target as HTMLSelectElement).value as "positive"|"negative";}}><option value="negative">Did not work</option><option value="positive">Worked well</option></select></label></div><label>Specific preference<input maxlength="120" required placeholder="e.g. neon accents" .value=${this.#value} @input=${(event:InputEvent)=>{this.#value=(event.target as HTMLInputElement).value;this.requestUpdate();}}></label><label>Optional private note<textarea maxlength="500" rows="2" placeholder="Why? Stored outside the immutable log for 30 days." .value=${this.#note} @input=${(event:InputEvent)=>{this.#note=(event.target as HTMLTextAreaElement).value;}}></textarea></label><footer><button type="button" class="button ghost compact" @click=${()=>{this.#critiqueOpen=false;this.requestUpdate();}}>Cancel</button><button class="button primary compact" ?disabled=${!this.#value.trim()||this.store.busy.get()==="critique-object"}>Record critique</button></footer></form>`:nothing}
    </article>`;
  }
}
customElements.define("forma-output-card", OutputCard);

import { html, nothing } from "lit";
import { FormaElement, icon } from "./forma-element";
import type { CreativeBlock } from "../model/events";
import "./reference-image";
import "./reference-palette-picker";

export class ContextBlock extends FormaElement {
  static properties = { block: { attribute: false } };
  block!: CreativeBlock;
  #draft = "";
  #confirmRemove = false; #paletteOpen = false; #dropPosition: ""|"before"|"after" = "";

  #beginEdit() {
    if (this.block.locked) return;
    this.#draft = String(this.block.properties.text ?? this.block.properties.label ?? "");
    this.store.patchUi({ editingBlockId: this.block.id });
    void this.updateComplete.then(() => this.querySelector<HTMLTextAreaElement>(".block-editor textarea")?.focus());
  }
  #cancelEdit() { this.store.patchUi({ editingBlockId: "" }); }
  async #saveEdit() {
    const current = String(this.block.properties.text ?? this.block.properties.label ?? ""); const next = this.#draft.trim();
    if (next === current) return this.#cancelEdit();
    const appended = await this.store.append({ type: "BlockPropertyEdited", payload: { block_id: this.block.id, property_path: this.block.properties.text !== undefined ? "text" : "label", old_value: current, new_value: next } });
    if (appended.length) this.#cancelEdit();
  }
  #rename() {
    const next = window.prompt("Rename handle", this.block.handle)?.trim();
    if (next && next !== this.block.handle) void this.store.append({ type: "BlockRenamed", payload: { block_id: this.block.id, old_handle: this.block.handle, new_handle: next, reason: "user" } });
  }
  #commitOrder(list: CreativeBlock[]) {
    const events = list.map((block,index)=>({type:"BlockPropertyEdited",payload:{block_id:block.id,property_path:"position",old_value:block.position,new_value:`p${String(index).padStart(4,"0")}`}})).filter((event)=>event.payload.old_value!==event.payload.new_value);
    if (events.length) void this.store.appendBatch(events);
  }
  #move(delta: number) {
    const list = [...this.store.projection.get().blocks]; const index = list.findIndex((block) => block.id === this.block.id); const target = index + delta;
    if (target < 0 || target >= list.length) return this.store.toast(delta < 0 ? "This block is already first." : "This block is already last.");
    const [moved] = list.splice(index,1); list.splice(target,0,moved); this.#commitOrder(list);
  }
  #dragStart(event: DragEvent) {
    if (this.block.locked || !event.dataTransfer) return; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/forma-block-id",this.block.id);
  }
  #dragOver(event: DragEvent) {
    if (!event.dataTransfer?.types.includes("text/forma-block-id")) return; event.preventDefault(); event.dataTransfer.dropEffect = "move";
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect(); this.#dropPosition = event.clientY < rect.top + rect.height / 2 ? "before" : "after"; this.requestUpdate();
  }
  #drop(event: DragEvent) {
    event.preventDefault(); const sourceId = event.dataTransfer?.getData("text/forma-block-id"); const position = this.#dropPosition || "before"; this.#dropPosition = "";
    if (!sourceId || sourceId === this.block.id) { this.requestUpdate(); return; }
    const list = [...this.store.projection.get().blocks]; const sourceIndex = list.findIndex((block)=>block.id===sourceId); if (sourceIndex < 0) return;
    const [moved] = list.splice(sourceIndex,1); const targetIndex = list.findIndex((block)=>block.id===this.block.id); list.splice(position==="after"?targetIndex+1:targetIndex,0,moved); this.#commitOrder(list); this.requestUpdate();
  }
  #changeColor(index: number, value: string) {
    const colors = Array.isArray(this.block.properties.colors) ? [...this.block.properties.colors] as string[] : [];
    const old = [...colors]; colors[index] = value;
    void this.store.append({ type: "ChipEdited", payload: { chip_id: `chip-${this.block.id}-${index}`, block_id: this.block.id, property: "colors", old_value: old, new_value: colors } });
  }
  #weight(value: number) { void this.store.append({ type: "BlockWeightSet", payload: { block_id: this.block.id, weight: value, previous_weight: Number(this.block.properties.weight ?? .5) } }); }
  async #remove() { const appended = await this.store.append({type:"BlockRemoved",payload:{block_id:this.block.id}}); if (appended.length) this.#confirmRemove=false; }

  override render() {
    if (!this.block) return nothing;
    const p = this.block.properties; const authority = String(p.authority ?? "authored"); const confidence = Number(p.confidence ?? 1); const colors = Array.isArray(p.colors) ? p.colors as string[] : []; const dimensions = p.dimensions && typeof p.dimensions === "object" ? p.dimensions as Record<string, unknown> : null; const extractionStatus = String(p.extraction_status ?? "");
    const copy = String(p.text ?? p.label ?? ""); const displayCopy = copy || String(p.placeholder ?? "Describe a direction…"); const focused = this.store.ui.focusBlockId === this.block.id; const editing = this.store.ui.editingBlockId === this.block.id;
    return html`<article class="context-block ${focused?"brief-focus":""} ${this.#dropPosition?`drop-${this.#dropPosition}`:""}" tabindex="0" data-block-id=${this.block.id} aria-label="${this.block.type} block, ${this.block.handle}" @dragover=${this.#dragOver} @dragleave=${()=>{this.#dropPosition="";this.requestUpdate();}} @drop=${this.#drop}>
      <div class="block-rail">
        <button class="drag-handle" .draggable=${!this.block.locked} aria-label=${this.block.locked?"Unlock block to reorder":"Drag block to reorder"} title=${this.block.locked?"Unlock block to reorder":"Drag to reorder"} @dragstart=${this.#dragStart} @dragend=${()=>{this.#dropPosition="";this.requestUpdate();}}>${icon("dots")}</button>
        <div class="reorder-buttons"><button aria-label="Move block up" @click=${() => this.#move(-1)}>↑</button><button aria-label="Move block down" @click=${() => this.#move(1)}>↓</button></div>
      </div>
      <div class="block-body">
        <header><div><span class="block-type">${this.block.type}</span><button class="handle" @click=${this.#rename}>${this.block.handle} ${icon("edit")}</button></div><button class="icon-button lock-button" aria-label=${this.block.locked ? "Unlock block" : "Lock block"} title=${this.block.locked ? "Unlock block" : "Lock block"} @click=${() => this.store.append({ type: this.block.locked ? "BlockUnlocked" : "BlockLocked", payload: { block_id: this.block.id, locked_by: "user" } })}>${icon(this.block.locked ? "lock" : "unlock")}<span class="lock-label">${this.block.locked ? "Locked" : "Lock"}</span></button></header>
        ${colors.length && this.block.type === "reference" ? html`<div class="reference-palette"><div class="palette-strip" aria-label="Extracted reference colors">${colors.map(color=>html`<i style=${`--swatch:${color}`}></i>`)}</div><div><span><b>Extracted palette</b><small>Read-only evidence from this reference</small></span><button class="button secondary compact" @click=${()=>{this.#paletteOpen=true;this.requestUpdate();}}>Explore palettes</button></div></div>` : colors.length ? html`<div class="palette-row" aria-label="Editable palette">${colors.map((color, i) => html`<label class="swatch" style="--swatch:${color}" title="Edit swatch ${i+1}"><input type="color" .value=${color} @change=${(e: Event) => this.#changeColor(i, (e.target as HTMLInputElement).value)}><span></span><small>${color}</small></label>`)}</div>` : editing ? html`<div class="block-editor"><label for=${`block-copy-${this.block.id}`}>Edit ${this.block.type} content</label><textarea id=${`block-copy-${this.block.id}`} rows="3" .value=${this.#draft} placeholder=${String(p.placeholder??"Describe a direction…")} @input=${(event:InputEvent)=>{this.#draft=(event.target as HTMLTextAreaElement).value;this.requestUpdate();}} @keydown=${(event:KeyboardEvent)=>{if(event.key==="Escape"){event.preventDefault();this.#cancelEdit();}else if(event.key==="Enter"&&(event.metaKey||event.ctrlKey)){event.preventDefault();void this.#saveEdit();}}}></textarea><div><small>⌘/Ctrl + Enter to save · Esc to cancel</small><button class="button ghost" @click=${this.#cancelEdit}>Cancel</button><button class="button primary" @click=${this.#saveEdit}>Save</button></div></div>` : html`<button class="block-copy ${copy?"":"placeholder"}" ?disabled=${this.block.locked} title=${this.block.locked?"Unlock this block to edit":"Edit block content"} @click=${this.#beginEdit}>${displayCopy}</button>`}
        ${this.block.type === "reference" ? html`<forma-reference-image .src=${String(p.media_url??"")} .alt=${String(p.label??this.block.handle)}></forma-reference-image>` : nothing}
        ${this.block.type === "reference" && extractionStatus ? html`<div class="extraction-summary" aria-live="polite" aria-busy=${extractionStatus === "pending" ? "true" : "false"}>
          <span>${extractionStatus === "pending" ? "Extracting deterministic facts…" : extractionStatus === "complete" ? "Extraction complete" : "Extraction unavailable"}</span>
          ${dimensions ? html`<b>${String(dimensions.width)} × ${String(dimensions.height)}</b><b>${String(p.dominant_edges ?? "balanced")} edges</b>` : nothing}
          ${extractionStatus === "complete" ? html`<small>${Math.round(confidence * 100)}% confidence · ${String(p.extractor ?? "deterministic suite")}</small>` : nothing}
        </div>` : nothing}
        <div class="block-meta">
          <label><span class="meta-long">Influence</span><span class="meta-short" aria-hidden="true">Inf.</span><input aria-label="Block influence" type="range" min="0" max="1" step="0.05" .value=${String(Number(p.weight ?? .5))} @change=${(e: Event) => this.#weight(Number((e.target as HTMLInputElement).value))}><output>${Math.round(Number(p.weight ?? .5) * 100)}%</output></label>
          <span class="authority ${authority}" aria-label=${`${authority} authority`} title=${`${authority} authority`}><span class="meta-long">${authority}</span><span class="meta-short" aria-hidden="true">${authority.slice(0,1).toUpperCase()}</span></span>
          ${confidence < .75 ? html`<span class="confidence low" aria-label=${`Low confidence, ${Math.round(confidence * 100)} percent`} title=${`Low confidence · ${Math.round(confidence * 100)}%`}><span class="meta-long">Low confidence · </span>${Math.round(confidence * 100)}%</span>` : confidence < 1 ? html`<span class="confidence" aria-label=${`${Math.round(confidence * 100)} percent confidence`} title=${`${Math.round(confidence * 100)}% confidence`}>${Math.round(confidence * 100)}%<span class="meta-long"> confidence</span></span>` : nothing}
          <button class="why-button" aria-label="Why does this block have these values?" title="Why does this block have these values?" @click=${() => this.store.patchUi({ inspectorOpen: true, selectedEventId: this.block.sourceEvents.at(-1) ?? "" })}><span class="meta-long">Why?</span><span class="meta-short" aria-hidden="true">?</span></button>
          <button class="remove-block" aria-label="Remove block" ?disabled=${this.block.locked} title=${this.block.locked?"Unlock this block to remove":"Remove block"} @click=${()=>{this.#confirmRemove=true;this.requestUpdate();}}><span class="meta-long">Remove</span><span class="meta-short" aria-hidden="true">×</span></button>
        </div>
        ${this.#confirmRemove?html`<div class="block-remove-confirm" role="alert"><span><b>Remove this block?</b><small>It will be tombstoned and can be restored with Undo.</small></span><button class="button ghost compact" @click=${()=>{this.#confirmRemove=false;this.requestUpdate();}}>Cancel</button><button class="button danger compact" @click=${this.#remove}>Remove block</button></div>`:nothing}
      </div>
      ${this.#paletteOpen?html`<forma-reference-palette-picker .referenceBlockId=${this.block.id} .referenceId=${String(p.reference_id??"")} .mediaUrl=${String(p.media_url??"")} .label=${String(p.label??this.block.handle)} .colors=${colors} @picker-close=${()=>{this.#paletteOpen=false;this.requestUpdate();}}></forma-reference-palette-picker>`:nothing}
    </article>`;
  }
}
customElements.define("forma-context-block", ContextBlock);

declare global { interface HTMLElementTagNameMap { "forma-context-block": ContextBlock } }

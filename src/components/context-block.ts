import { html, nothing } from "lit";
import { FormaElement, icon } from "./forma-element";
import type { CreativeBlock } from "../model/events";
import "./reference-image";

export class ContextBlock extends FormaElement {
  static properties = { block: { attribute: false } };
  block!: CreativeBlock;

  #editText() {
    const current = String(this.block.properties.text ?? this.block.properties.label ?? "");
    const next = window.prompt("Edit block content", current);
    if (next !== null && next !== current) void this.store.append({ type: "BlockPropertyEdited", payload: { block_id: this.block.id, property_path: this.block.properties.text !== undefined ? "text" : "label", old_value: current, new_value: next } });
  }
  #rename() {
    const next = window.prompt("Rename handle", this.block.handle)?.trim();
    if (next && next !== this.block.handle) void this.store.append({ type: "BlockRenamed", payload: { block_id: this.block.id, old_handle: this.block.handle, new_handle: next, reason: "user" } });
  }
  #move(delta: number) {
    const list = this.store.projection.get().blocks; const index = list.findIndex((b) => b.id === this.block.id); const target = list[index + delta];
    if (!target) return this.store.toast(delta < 0 ? "This block is already first." : "This block is already last.");
    const next = delta < 0 ? `${target.position}-0` : `${target.position}z`;
    void this.store.append({ type: "BlockPropertyEdited", payload: { block_id: this.block.id, property_path: "position", old_value: this.block.position, new_value: next } });
  }
  #changeColor(index: number, value: string) {
    const colors = Array.isArray(this.block.properties.colors) ? [...this.block.properties.colors] as string[] : [];
    const old = [...colors]; colors[index] = value;
    void this.store.append({ type: "ChipEdited", payload: { chip_id: `chip-${this.block.id}-${index}`, block_id: this.block.id, property: "colors", old_value: old, new_value: colors } });
  }
  #weight(value: number) { void this.store.append({ type: "BlockWeightSet", payload: { block_id: this.block.id, weight: value, previous_weight: Number(this.block.properties.weight ?? .5) } }); }

  override render() {
    if (!this.block) return nothing;
    const p = this.block.properties; const authority = String(p.authority ?? "authored"); const confidence = Number(p.confidence ?? 1); const colors = Array.isArray(p.colors) ? p.colors as string[] : []; const dimensions = p.dimensions && typeof p.dimensions === "object" ? p.dimensions as Record<string, unknown> : null; const extractionStatus = String(p.extraction_status ?? "");
    const copy = String(p.text ?? p.label ?? ""); const displayCopy = copy || String(p.placeholder ?? "Describe a direction…"); const focused = this.store.ui.focusBlockId === this.block.id;
    return html`<article class="context-block ${focused?"brief-focus":""}" tabindex="0" data-block-id=${this.block.id} aria-label="${this.block.type} block, ${this.block.handle}">
      <div class="block-rail">
        <span class="drag-handle" aria-hidden="true" title="Reorder with the adjacent arrow controls">${icon("dots")}</span>
        <div class="reorder-buttons"><button aria-label="Move block up" @click=${() => this.#move(-1)}>↑</button><button aria-label="Move block down" @click=${() => this.#move(1)}>↓</button></div>
      </div>
      <div class="block-body">
        <header><div><span class="block-type">${this.block.type}</span><button class="handle" @click=${this.#rename}>${this.block.handle} ${icon("edit")}</button></div><button class="icon-button lock-button" aria-label=${this.block.locked ? "Unlock block" : "Lock block"} title=${this.block.locked ? "Unlock block" : "Lock block"} @click=${() => this.store.append({ type: this.block.locked ? "BlockUnlocked" : "BlockLocked", payload: { block_id: this.block.id, locked_by: "user" } })}>${icon(this.block.locked ? "lock" : "unlock")}<span class="lock-label">${this.block.locked ? "Locked" : "Lock"}</span></button></header>
        ${colors.length ? html`<div class="palette-row" aria-label="Editable palette">${colors.map((color, i) => html`<label class="swatch" style="--swatch:${color}" title="Edit swatch ${i+1}"><input type="color" .value=${color} @change=${(e: Event) => this.#changeColor(i, (e.target as HTMLInputElement).value)}><span></span><small>${color}</small></label>`)}</div>` : html`<button class="block-copy ${copy?"":"placeholder"}" @click=${this.#editText}>${displayCopy}</button>`}
        ${this.block.type === "reference" ? html`<forma-reference-image .src=${String(p.media_url??"")} .alt=${String(p.label??this.block.handle)}></forma-reference-image>` : nothing}
        ${this.block.type === "reference" && extractionStatus ? html`<div class="extraction-summary" aria-live="polite" aria-busy=${extractionStatus === "pending" ? "true" : "false"}>
          <span>${extractionStatus === "pending" ? "Extracting deterministic facts…" : extractionStatus === "complete" ? "Extraction complete" : "Extraction unavailable"}</span>
          ${dimensions ? html`<b>${String(dimensions.width)} × ${String(dimensions.height)}</b><b>${String(p.dominant_edges ?? "balanced")} edges</b>` : nothing}
          ${extractionStatus === "complete" ? html`<small>${Math.round(confidence * 100)}% confidence · ${String(p.extractor ?? "deterministic suite")}</small>` : nothing}
        </div>` : nothing}
        <div class="block-meta">
          <label>Influence <input type="range" min="0" max="1" step="0.05" .value=${String(Number(p.weight ?? .5))} @change=${(e: Event) => this.#weight(Number((e.target as HTMLInputElement).value))}><output>${Math.round(Number(p.weight ?? .5) * 100)}%</output></label>
          <span class="authority ${authority}">${authority}</span>
          ${confidence < .75 ? html`<span class="confidence low">Low confidence · ${Math.round(confidence * 100)}%</span>` : confidence < 1 ? html`<span class="confidence">${Math.round(confidence * 100)}% confidence</span>` : nothing}
          <button class="why-button" @click=${() => this.store.patchUi({ inspectorOpen: true, selectedEventId: this.block.sourceEvents.at(-1) ?? "" })}>Why?</button>
        </div>
      </div>
    </article>`;
  }
}
customElements.define("forma-context-block", ContextBlock);

declare global { interface HTMLElementTagNameMap { "forma-context-block": ContextBlock } }

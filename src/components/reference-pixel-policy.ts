import { html, nothing } from "lit";
import type { CreativeBlock } from "../model/events";
import { REFERENCE_PIXEL_MODES, referencePixelMode, referencePixelModeDefinition, type ReferencePixelMode } from "../model/block-types";
import { FormaElement, icon } from "./forma-element";

export class ReferencePixelPolicy extends FormaElement {
  static properties = { block: { attribute: false }, surface: { type: String }, compact: { type: Boolean } };
  block: CreativeBlock | null = null;
  surface = "document";
  compact = false;

  async #change(mode: ReferencePixelMode) {
    if (!this.block || this.block.locked) return;
    const oldValue = referencePixelMode(this.block.properties.pixel_reference_mode);
    if (mode === oldValue) return;
    await this.store.append({ type:"BlockPropertyEdited", payload:{
      block_id:this.block.id,
      document_id:this.block.documentId,
      property_path:"pixel_reference_mode",
      old_value:oldValue,
      new_value:mode,
      source_surface:this.surface,
    }});
  }

  override render() {
    const block = this.block;
    if (!block || block.type !== "reference") return nothing;
    const selected = referencePixelMode(block.properties.pixel_reference_mode);
    const definition = referencePixelModeDefinition(selected);
    const storyboardFrame = String(block.properties.reference_set_kind ?? block.properties.source_artifact_kind) === "storyboard";
    const storyboardIndex = Number(block.properties.storyboard_frame_index);
    const storyboardCount = Number(block.properties.storyboard_frame_count);
    return html`<section class=${`reference-pixel-policy ${this.compact ? "compact" : ""}`} aria-label="Generation reference policy">
      <div class="reference-pixel-policy-heading">
        <span>${icon("image")}</span>
        <div><b>Use in generation</b><small>${selected === "context_only" ? "Original pixels stay private from image and video models" : "Original pixels can be attached to compatible image and video generations"}</small>${storyboardFrame ? html`<small>Storyboard shot ${Number.isFinite(storyboardIndex) ? storyboardIndex : "—"}${Number.isFinite(storyboardCount) ? ` of ${storyboardCount}` : ""} · retained in source order</small>` : nothing}</div>
      </div>
      <label>
        <span class="sr-only">How should generation models use this reference?</span>
        <select .value=${selected} ?disabled=${block.locked} @change=${(event:Event)=>this.#change((event.target as HTMLSelectElement).value as ReferencePixelMode)}>
          ${REFERENCE_PIXEL_MODES.map((option)=>html`<option value=${option.id} ?selected=${option.id===selected}>${option.label}</option>`)}
        </select>
      </label>
      <p>${definition.description}</p>
      ${selected !== "context_only" ? html`<small class="reference-pixel-receipt">Rights receipt required · saved with this block · passed as a high-fidelity input to compatible providers</small>` : nothing}
    </section>`;
  }
}

customElements.define("forma-reference-pixel-policy", ReferencePixelPolicy);

declare global { interface HTMLElementTagNameMap { "forma-reference-pixel-policy": ReferencePixelPolicy } }

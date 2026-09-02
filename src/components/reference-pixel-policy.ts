import { html, nothing } from "lit";
import type { CreativeBlock } from "../model/events";
import { REFERENCE_PIXEL_MODES, referencePixelMode, referencePixelModeDefinition, type ReferencePixelMode } from "../model/block-types";
import { hasSavedModel3dView } from "../model/reference-media";
import { FormaElement, icon } from "./forma-element";

export class ReferencePixelPolicy extends FormaElement {
  static properties = { block: { attribute: false }, surface: { type: String }, compact: { type: Boolean }, readOnly: { type: Boolean }, disabled: { type: Boolean } };
  block: CreativeBlock | null = null;
  surface = "document";
  compact = false;
  readOnly = false;
  disabled = false;

  async #change(mode: ReferencePixelMode) {
    if (!this.block || this.block.locked || this.readOnly || this.disabled || !REFERENCE_PIXEL_MODES.some((option)=>option.id===mode)) return;
    if (this.block.type === "model3d" && mode !== "context_only" && !hasSavedModel3dView(this.block.properties)) return;
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
    if (!block || block.type !== "reference" && block.type !== "model3d") return nothing;
    const modelView = block.type === "model3d";
    const modelViewAvailable = !modelView || hasSavedModel3dView(block.properties);
    const selected = referencePixelMode(block.properties.pixel_reference_mode);
    const definition = referencePixelModeDefinition(selected);
    const storyboardFrame = String(block.properties.reference_set_kind ?? block.properties.source_artifact_kind) === "storyboard";
    const storyboardIndex = Number(block.properties.storyboard_frame_index);
    const storyboardCount = Number(block.properties.storyboard_frame_count);
    const inheritedForm = this.closest("form");
    const policyFormId = `reference-pixel-policy-${block.id}`;
    return html`${inheritedForm ? nothing : html`<form id=${policyFormId} hidden @submit=${(event:SubmitEvent)=>event.preventDefault()}></form>`}<section class=${`reference-pixel-policy ${this.compact ? "compact" : ""}`} aria-label="Generation reference policy">
      <div class="reference-pixel-policy-heading">
        <span>${icon("image")}</span>
        <div><b>Use in generation</b><small>${modelView ? !modelViewAvailable ? this.i18n.t("model3d.view.policySaveFirst","Save a view before allowing its pixels in generation.") : selected === "context_only" ? this.i18n.t("model3d.view.policyPrivate","The saved image view stays private from generation models.") : this.i18n.t("model3d.view.policyApproved","The saved image view can be attached to compatible generations.") : selected === "context_only" ? this.i18n.t("audio.image.scopePrivate","Original pixels stay private from image, video, and audio models") : this.i18n.t("audio.image.scopeApproved","Original pixels can be attached to compatible image, video, and audio generations")}</small>${storyboardFrame ? html`<small>Storyboard shot ${Number.isFinite(storyboardIndex) ? storyboardIndex : "—"}${Number.isFinite(storyboardCount) ? " " + this.i18n.system("of {storyboardCount}", { storyboardCount: this.i18n.number(storyboardCount) }) : ""} · retained in source order</small>` : nothing}</div>
      </div>
      <label>
        <span class="sr-only">How should generation models use this reference?</span>
        <select form=${inheritedForm ? nothing : policyFormId} .value=${selected} ?disabled=${block.locked || this.readOnly || this.disabled || !modelViewAvailable} @change=${(event:Event)=>this.#change((event.target as HTMLSelectElement).value as ReferencePixelMode)}>
          ${REFERENCE_PIXEL_MODES.map((option)=>html`<option value=${option.id} ?selected=${option.id===selected}>${this.i18n.system(option.label)}</option>`)}
        </select>
      </label>
      <p>${this.i18n.system(definition.description)}</p>
      ${selected !== "context_only" && modelViewAvailable ? html`<small class="reference-pixel-receipt">Rights receipt required · saved with this block · passed as a high-fidelity input to compatible providers</small>` : nothing}
    </section>`;
  }
}

if (!customElements.get("forma-reference-pixel-policy")) customElements.define("forma-reference-pixel-policy", ReferencePixelPolicy);

declare global { interface HTMLElementTagNameMap { "forma-reference-pixel-policy": ReferencePixelPolicy } }

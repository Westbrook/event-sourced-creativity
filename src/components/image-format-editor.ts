import { html } from "lit";
import type { CreativeBlock } from "../model/events";
import { documentImageFormat, imageAspectRatioLabel, imageFormatForPreset, IMAGE_FORMAT_PRESETS, imageFormatLabel, normalizeImageFormat } from "../model/image-format";
import { FormaElement } from "./forma-element";

export class ImageFormatEditor extends FormaElement {
  static properties = { block:{attribute:false}, compact:{type:Boolean}, surface:{type:String} };
  block: CreativeBlock | null = null;
  compact = false;
  surface = "document";
  #saving = false;

  #sourceBlock() {
    if (this.block) return this.block;
    const selected = documentImageFormat(this.store.projection.get().blocks);
    return selected.blockId ? this.store.projection.get().blocks.find((block) => block.id === selected.blockId) ?? null : null;
  }

  #selectPreset(event: Event) {
    const select = event.target as HTMLSelectElement; const form = select.closest("form");
    if (!form || select.value === "custom") return;
    const format = imageFormatForPreset(select.value);
    const width = form.elements.namedItem("width") as HTMLInputElement | null; const height = form.elements.namedItem("height") as HTMLInputElement | null;
    if (width) width.value = String(format.dimensions.width);
    if (height) height.value = String(format.dimensions.height);
  }

  async #apply(event: SubmitEvent) {
    event.preventDefault(); if (this.#saving) return;
    const form = event.currentTarget as HTMLFormElement; const data = new FormData(form);
    const next = normalizeImageFormat({ dimensions:{ width:Number(data.get("width")), height:Number(data.get("height")), unit:"px" } });
    const target = this.#sourceBlock();
    this.#saving = true; this.requestUpdate();
    try {
      if (target) {
        const current = normalizeImageFormat(target.properties.image_format);
        if (JSON.stringify(current) !== JSON.stringify(next)) await this.store.append({ type:"BlockPropertyEdited", payload:{ block_id:target.id, document_id:target.documentId, property_path:"image_format", old_value:current, new_value:next, source_surface:this.surface } });
      } else {
        const projection = this.store.projection.get();
        await this.store.append({ type:"BlockCreated", payload:{ block_id:crypto.randomUUID(), document_id:projection.documentId, project_id:projection.projectId, type:"format", handle:`format/${imageAspectRatioLabel(next).replace(":","x")}`, position:`p${String(projection.blocks.length).padStart(4,"0")}`, properties:{ text:`Create for a ${imageAspectRatioLabel(next)} frame at ${next.dimensions.width} × ${next.dimensions.height} pixels.`, subtype:"Resolution", weight:1, intent:"include", authority:"authored", image_format:next, created_from:this.surface } } });
      }
      this.store.toast(this.i18n.system("Output frame set to {format}.",{format:imageFormatLabel(next)}));
    } finally { this.#saving = false; this.requestUpdate(); }
  }

  override render() {
    const target = this.#sourceBlock(); const format = target ? normalizeImageFormat(target.properties.image_format) : documentImageFormat(this.store.projection.get().blocks).format;
    const ratio = imageAspectRatioLabel(format); const preset = IMAGE_FORMAT_PRESETS.find((item) => item.id === ratio && item.dimensions.width === format.dimensions.width && item.dimensions.height === format.dimensions.height)?.id ?? "custom";
    const disabled = Boolean(target?.locked) || this.#saving;
    const fields = html`<form class="image-format-form" @submit=${this.#apply}>
      <label><span>Aspect ratio</span><select name="preset" .value=${preset} ?disabled=${disabled} @change=${this.#selectPreset}>${IMAGE_FORMAT_PRESETS.map((item) => html`<option value=${item.id} ?selected=${item.id===preset}>${item.id} · ${this.i18n.system(item.label)}</option>`)}<option value="custom" ?selected=${preset==="custom"}>Custom dimensions</option></select></label>
      <div class="image-format-dimensions" aria-label="Target image dimensions">
        <label><span>Width</span><input name="width" type="number" min="64" max="8192" step="1" .value=${String(format.dimensions.width)} ?disabled=${disabled}></label>
        <span aria-hidden="true">×</span>
        <label><span>Height</span><input name="height" type="number" min="64" max="8192" step="1" .value=${String(format.dimensions.height)} ?disabled=${disabled}></label>
        <span>px</span>
      </div>
      <button class="button secondary compact" type="submit" ?disabled=${disabled}>${this.#saving ? this.i18n.system("Saving…") : target ? this.i18n.system("Apply frame") : this.i18n.system("Add format block")}</button>
      ${target?.locked ? html`<small>Unlock the active Format block to change its frame.</small>` : html`<small>Drafts and full images preserve this ratio while using an appropriate render size.</small>`}
    </form>`;
    return this.compact ? html`<details class="image-format-control compact"><summary><span>Output frame</span><b>${imageFormatLabel(format)}</b></summary>${fields}</details>` : html`<section class="image-format-control"><header><span>Image frame</span><b>${imageFormatLabel(format)}</b></header>${fields}</section>`;
  }
}

if (!customElements.get("forma-image-format-editor")) customElements.define("forma-image-format-editor", ImageFormatEditor);

declare global { interface HTMLElementTagNameMap { "forma-image-format-editor": ImageFormatEditor } }

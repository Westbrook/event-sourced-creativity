import { html, nothing } from "lit";
import { applySlideStylePreset, documentArtifactDefinition, SLIDE_LAYOUTS, SLIDE_STYLE_PRESETS, SLIDE_VISUAL_KINDS, type SlideLayout, type SlidePresentation, type SlideStylePresetId, type SlideVisualKind } from "../model/document-artifacts";
import type { CreativeBlock } from "../model/events";
import { outputInputDraft, type OutputInputDraft, type OutputInputItem } from "../model/output-authoring";
import { FormaElement } from "./forma-element";
import { renderVideoReel } from "./video-reel";
import "./design-system/forms";
import "./presentation-slide";
import "./reference-image";

/** A single format-aware workbench for every adopted document work product. */
export class OutputInputEditor extends FormaElement {
  static properties = { block: { attribute: false }, standalone: { type: Boolean }, source: { type: String }, shortcutHelp: { type: String, attribute: false } };
  block!: CreativeBlock;
  standalone = false;
  source = "output-input-editor";
  // Display-only copy supplied by the owning form; it does not handle keys.
  shortcutHelp = "";
  #loaded = "";
  #edited = false;
  #draft: OutputInputDraft | null = null;
  #saving = false;
  #error = "";
  #composing = false;

  get draft() { return this.#draft ? structuredClone(this.#draft) : null; }

  /** Existing local work only; no permission, receipt or navigation authority. */
  get localWorkBlocked() {
    return this.#saving || this.#composing || this.#edited && JSON.stringify(this.#draft) !== JSON.stringify(outputInputDraft(this.block));
  }

  reset(){this.#loaded="";this.#draft=null;this.#edited=false;this.#error="";this.#load();this.requestUpdate();}

  #load() {
    if (!this.block) return;
    const draft = outputInputDraft(this.block);
    const identity = JSON.stringify([this.block.projectId, this.block.documentId, this.block.id, this.block.properties.source_artifact_id ?? null, draft?.kind ?? null]);
    if (this.#loaded === identity && (!this.standalone || this.#edited || JSON.stringify(this.#draft) === JSON.stringify(draft))) return;
    this.#loaded = identity;
    this.#draft = draft;
    this.#edited = false;
    this.#error = "";
  }

  #change(next: OutputInputDraft) {
    this.#edited = true;
    this.#draft = next;
    this.#error = "";
    this.dispatchEvent(new CustomEvent("output-input-change", { detail: { blockId: this.block.id, draft: structuredClone(next) }, bubbles: true, composed: true }));
    if (!this.#composing) this.requestUpdate();
  }

  #item(index: number, patch: Partial<OutputInputItem>) {
    if (!this.#draft) return;
    const items = this.#draft.items.map((item, position) => position === index ? { ...item, ...patch } : item);
    this.#change({ ...this.#draft, items });
  }

  #slide(index: number, patch: Partial<NonNullable<OutputInputItem["slide"]>>) {
    const slide = this.#draft?.items[index]?.slide;
    if (slide) this.#item(index, { slide: { ...slide, ...patch } });
  }

  #visual(index: number, patch: Partial<NonNullable<OutputInputItem["slide"]>["visual"]>) {
    const slide = this.#draft?.items[index]?.slide;
    if (slide) this.#slide(index, { visual: { ...slide.visual, ...patch } });
  }

  #datum(index: number, datumIndex: number, key: "label" | "value", value: string) {
    const visual = this.#draft?.items[index]?.slide?.visual;
    if (!visual) return;
    this.#visual(index, { data: visual.data.map((datum, position) => {if(position!==datumIndex)return datum;const percentage=key==="value"&&/^\s*\d+(?:\.\d+)?\s*%\s*$/.test(value)?Math.max(0,Math.min(1,Number.parseFloat(value)/100)):null;return{...datum,[key]:value,...(percentage===null?{}:{weight:percentage})};}) });
  }

  #presentation(patch: Partial<SlidePresentation>) {
    if (this.#draft?.presentation) this.#change({ ...this.#draft, presentation: { ...this.#draft.presentation, ...patch } });
  }

  async #save(event: SubmitEvent) {
    event.preventDefault();
    if (!this.#draft || this.#saving || this.block.locked) return;
    this.#saving = true;
    this.#error = "";
    this.requestUpdate();
    const saved = await this.store.saveOutputInput(this.block.id, this.#draft, this.source);
    this.#saving = false;
    if (saved) {
      this.#loaded = "";
      this.dispatchEvent(new CustomEvent("output-input-saved", { detail: { blockId: this.block.id }, bubbles: true, composed: true }));
    } else {
      this.#error = this.store.appendFailure.get() || "These changes could not be saved. Unlock any related frames and try again.";
    }
    this.requestUpdate();
  }

  #slideFields(item: OutputInputItem, index: number) {
    const slide = item.slide;
    if (!slide) return nothing;
    const number = index + 1;
    return html`<details class="output-input-slide-details"><summary>Slide ${number} visual details</summary>
      <div class="output-input-field-grid">
        <label>Slide ${number} section label<input .value=${slide.kicker} @input=${(event: InputEvent) => this.#slide(index, { kicker: (event.target as HTMLInputElement).value })}></label>
        <label>Slide ${number} layout<select .value=${slide.layout} @change=${(event: Event) => this.#slide(index, { layout: (event.target as HTMLSelectElement).value as SlideLayout })}>${SLIDE_LAYOUTS.map((layout) => html`<option value=${layout}>${this.i18n.system(layout.replaceAll("-", " "))}</option>`)}</select></label>
      </div>
      <label>Slide ${number} bullet points<textarea rows="3" .value=${slide.bullets.join("\n")} @input=${(event: InputEvent) => { const value = (event.target as HTMLTextAreaElement).value; this.#slide(index, { bullets: value ? value.split("\n") : [] }); }}></textarea><small>Write one point on each line.</small></label>
      <div class="output-input-field-grid">
        <label>Slide ${number} visual label<input .value=${slide.visual.label} @input=${(event: InputEvent) => this.#visual(index, { label: (event.target as HTMLInputElement).value })}></label>
        <label>Slide ${number} visual value<input .value=${slide.visual.value} @input=${(event: InputEvent) => this.#visual(index, { value: (event.target as HTMLInputElement).value })}></label>
        <label>Slide ${number} visual type<select .value=${slide.visual.kind} @change=${(event: Event) => this.#visual(index, { kind: (event.target as HTMLSelectElement).value as SlideVisualKind })}>${SLIDE_VISUAL_KINDS.map((kind) => html`<option value=${kind}>${this.i18n.system(kind.replaceAll("-", " "))}</option>`)}</select></label>
      </div>
      ${slide.visual.data.length ? html`<div class="output-input-data-points">${slide.visual.data.map((datum, datumIndex) => html`<div class="output-input-field-grid"><label>Slide ${number} point ${datumIndex + 1} label<input .value=${datum.label} @input=${(event: InputEvent) => this.#datum(index, datumIndex, "label", (event.target as HTMLInputElement).value)}></label><label>Slide ${number} point ${datumIndex + 1} value<input .value=${datum.value} @input=${(event: InputEvent) => this.#datum(index, datumIndex, "value", (event.target as HTMLInputElement).value)}></label></div>`)}</div>` : nothing}
    </details>`;
  }

  #items(draft: OutputInputDraft) {
    if (!draft.items.length) return nothing;
    const noun = draft.kind === "storyboard" ? "Frame" : draft.kind === "slides" ? "Slide" : draft.kind === "scene" ? "Scene section" : draft.kind === "video" ? "Video scene" : draft.kind === "audio" ? "Audio section" : "Story section";
    const open = (draft.kind === "storyboard" || draft.kind === "slides" || draft.kind === "video") && draft.items.length <= 6;
    const ownedFrameIds=new Set(this.store.projection.get().libraryBlockRelations.filter((relation)=>relation.kind==="artifact_contains"&&relation.fromBlockId===this.block.id).map((relation)=>relation.toBlockId));
    return html`<details class="output-input-sections" ?open=${open}><summary>${this.i18n.system(draft.items.length===1?"{count} editable {noun}":"{count} editable {noun}s",{count:this.i18n.number(draft.items.length),noun:this.i18n.system(noun).toLocaleLowerCase(this.i18n.locale)})}</summary>
      <ol>${draft.items.map((item, index) => html`<li><fieldset ?disabled=${this.block.locked || this.#saving}>
        <legend>${this.i18n.system(noun)} ${index + 1}${item.title ? ` · ${item.title}` : ""}</legend>
        ${draft.kind==="video"&&item.duration_seconds?html`<small>Rendered scene duration: ${item.duration_seconds} seconds</small>`:nothing}
        ${draft.kind==="storyboard"?(()=>{const frame=this.store.projection.get().libraryBlocks.find((block)=>ownedFrameIds.has(block.id)&&block.properties.source_artifact_item_id===item.source_artifact_item_id);return frame?.properties.media_url?html`<forma-reference-image class="output-input-frame-preview" .src=${String(frame.properties.media_url)} .alt=${item.title?this.i18n.system("Frame {count}: {title}", { count: this.i18n.number(index+1), title: item.title }):this.i18n.system("Storyboard frame {count}", { count: this.i18n.number(index+1) })} .compact=${true} .targetId=${frame.id} .referenceId=${String(frame.properties.reference_id??"")} .focalPoint=${frame.properties.focal_point}></forma-reference-image>`:nothing;})():nothing}
        ${draft.kind==="slides"&&item.slide?html`<div class="output-input-slide-preview" aria-label=${this.i18n.system("Preview of slide {count}", { count: this.i18n.number(index+1) })}><forma-presentation-slide .item=${{title:item.title,body:item.body,notes:item.notes,image_prompt:item.image_prompt,slide:item.slide}} .presentation=${draft.presentation} .index=${index} .total=${draft.items.length} .compact=${true}></forma-presentation-slide></div>`:nothing}
        <label>${this.i18n.system(noun)} ${index + 1} title<input .value=${item.title} @input=${(event: InputEvent) => this.#item(index, { title: (event.target as HTMLInputElement).value })}></label>
        <label>${draft.kind === "storyboard" ? this.i18n.system("Frame {count} shot description", { count: this.i18n.number(index + 1) }) : draft.kind === "slides" ? this.i18n.system("Slide {count} content", { count: this.i18n.number(index + 1) }) : this.i18n.system("{noun} {count} content", { noun: this.i18n.system(noun), count: this.i18n.number(index + 1) })}<textarea rows=${draft.kind === "storyboard" || draft.kind === "slides" ? 4 : 6} .value=${item.body} @input=${(event: InputEvent) => this.#item(index, { body: (event.target as HTMLTextAreaElement).value })}></textarea></label>
        <label>${draft.kind === "storyboard" ? this.i18n.system("Frame {count} camera and action notes", { count: this.i18n.number(index + 1) }) : draft.kind === "slides" ? this.i18n.system("Slide {count} speaker notes", { count: this.i18n.number(index + 1) }) : this.i18n.system("{noun} {count} notes", { noun: this.i18n.system(noun), count: this.i18n.number(index + 1) })}<textarea rows="3" .value=${item.notes} @input=${(event: InputEvent) => this.#item(index, { notes: (event.target as HTMLTextAreaElement).value })}></textarea></label>
        <label>${draft.kind === "storyboard" ? this.i18n.system("Frame {count} image direction", { count: this.i18n.number(index + 1) }) : this.i18n.system("{noun} {count} visual direction", { noun: this.i18n.system(noun), count: this.i18n.number(index + 1) })}<textarea rows="3" .value=${item.image_prompt} @input=${(event: InputEvent) => this.#item(index, { image_prompt: (event.target as HTMLTextAreaElement).value })}></textarea></label>
        ${this.#slideFields(item, index)}
      </fieldset></li>`)}</ol>
    </details>`;
  }

  #deck(presentation: SlidePresentation | null) {
    if (!presentation) return nothing;
    const roleLabels = new Map([["background", this.i18n.system("Background")], ["foreground", this.i18n.system("Foreground")], ["accent", this.i18n.system("Accent")], ["muted", this.i18n.system("Muted")], ["surface", this.i18n.system("Surface")]]);
    return html`<details class="output-input-presentation"><summary>Presentation style and labels</summary><div class="output-input-field-grid">
      <label>Presentation theme<input .value=${presentation.theme} @input=${(event: InputEvent) => this.#presentation({ theme: (event.target as HTMLInputElement).value })}></label>
      <label>Presentation footer<input .value=${presentation.footerLabel} @input=${(event: InputEvent) => this.#presentation({ footerLabel: (event.target as HTMLInputElement).value })}></label>
      <label>Presentation style<select .value=${presentation.stylePreset} @change=${(event: Event) => this.#presentation(applySlideStylePreset(presentation, (event.target as HTMLSelectElement).value as SlideStylePresetId))}>${SLIDE_STYLE_PRESETS.map((preset) => html`<option value=${preset.id}>${this.i18n.system(preset.label)}</option>`)}</select></label>
      <label>Presentation appearance<select .value=${presentation.mode} @change=${(event: Event) => this.#presentation({ mode: (event.target as HTMLSelectElement).value as "light" | "dark" })}><option value="light">Light</option><option value="dark">Dark</option></select></label>
      ${Object.entries(presentation.palette).map(([key, value]) => html`<label>Presentation ${roleLabels.get(key) ?? key} color<input type="color" .value=${value} @input=${(event: InputEvent) => this.#presentation({ palette: { ...presentation.palette, [key]: (event.target as HTMLInputElement).value } })}></label>`)}
    </div></details>`;
  }

  #fields() {
    this.#load();
    const draft = this.#draft;
    if (!draft) return nothing;
    const label = this.i18n.system(documentArtifactDefinition(draft.kind).label);
    const narrative = draft.kind === "short_story" ? "Story manuscript" : draft.kind === "scene" ? "Scene and dialogue" : draft.kind === "storyboard" ? "Storyboard narrative" : draft.kind === "slides" ? "Presentation narrative" : draft.kind === "audio" ? "Audio transcript, lyrics, and direction" : "Video direction and transcript";
    return html`<section class="output-input-editor" aria-label=${this.i18n.system("{label} input editor", { label: label })} @compositionstart=${()=>{this.#composing=true;}} @compositionend=${()=>{this.#composing=false;this.requestUpdate();}}>
      <header><div><span>${label} input</span><p>${draft.kind === "audio" ? this.i18n.t("output.input.audioGuidance", "Edits change only this reusable text, not the original recording. Saving does not generate audio or enable provider audio transfer.") : this.i18n.system("The original stays unchanged. Every saved edit becomes part of future work.")}</p></div></header>
      ${draft.kind === "video" ? renderVideoReel(draft.items, typeof this.block.properties.media_url === "string" ? this.block.properties.media_url : null, draft.title, this.i18n) : nothing}
      <fieldset class="output-input-primary" ?disabled=${this.block.locked || this.#saving}>
        <label>${label} title<input .value=${draft.title} @input=${(event: InputEvent) => this.#change({ ...draft, title: (event.target as HTMLInputElement).value })}></label>
        <label>${label} summary<textarea rows="3" .value=${draft.summary} @input=${(event: InputEvent) => this.#change({ ...draft, summary: (event.target as HTMLTextAreaElement).value })}></textarea></label>
        <forma-ui-rich-text .label=${this.i18n.system(narrative)} .value=${draft.markdown} .rows=${draft.kind === "short_story" || draft.kind === "scene" ? 12 : 8} .help=${this.shortcutHelp || this.i18n.system("Your complete writing remains separate from the original output. Command or Control plus Enter saves; Escape cancels.")} ?disabled=${this.block.locked || this.#saving} @forma-input=${(event: CustomEvent<{ value: string }>) => this.#change({ ...this.#draft!, markdown: event.detail.value })}></forma-ui-rich-text>
        ${draft.kind === "slides" ? this.#deck(draft.presentation) : nothing}
        ${this.#items(draft)}
      </fieldset>
      ${this.#error ? html`<p class="output-input-error" role="alert">${this.#error}</p>` : nothing}
    </section>`;
  }

  override render() {
    if (!this.block) return nothing;
    const fields = this.#fields();
    if (!this.standalone) return fields;
    return html`<form class="output-input-standalone" @submit=${this.#save}>${fields}<footer><button type="button" class="button ghost" @click=${() => this.dispatchEvent(new CustomEvent("output-input-cancel", { bubbles: true, composed: true }))}>Cancel</button><button type="submit" class="button primary" ?disabled=${this.#saving || this.block.locked}>${this.#saving ? this.i18n.system("Saving…") : this.i18n.system("Save input")}</button></footer></form>`;
  }
}

if (!customElements.get("forma-output-input-editor")) customElements.define("forma-output-input-editor", OutputInputEditor);

declare global { interface HTMLElementTagNameMap { "forma-output-input-editor": OutputInputEditor } }

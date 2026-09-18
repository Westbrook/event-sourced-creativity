import { html, nothing, type PropertyValues } from "lit";
import {
  MODEL3D_FORMATS,
  RODIN_MATERIALS,
  RODIN_PROMPT_MAX_CHARS,
  RODIN_QUALITY_MESH_OPTIONS,
  RODIN_TEXTURE_MODES,
  RODIN_TIERS,
  estimateModel3dCostMicrousd,
  normalizeModel3dSettings,
  validateModel3dRequest,
  type Model3dSettings,
  type Model3dValidationIssue,
} from "../model/model3d";
import { FormaElement } from "./forma-element";
import type { Model3dDocumentAdaptation } from "../model/model3d-prompt-adapter";
import { localizedModel3dValidationIssue } from "./design-system/localized-model3d";
import "./model3d-settings-editor.css";

type NumericField = "seed" | "width" | "height" | "length";
type SelectField = "tier" | "geometry_file_format" | "material" | "quality_mesh_option" | "texture_mode";
type BooleanField = "enable_creative_mode" | "hd_texture" | "texture_delight" | "is_micro" | "TAPose" | "use_original_alpha" | "preview_render";
export type Model3dSettingsChange = { settings: Model3dSettings; prompt: string; valid: boolean };

/** Exact provider settings; the owning generation form manages references and submission. */
export class Model3dSettingsEditor extends FormaElement {
  static properties = {
    settings: { attribute: false },
    prompt: { type: String },
    promptSource: { type: String, attribute: "prompt-source" },
    adaptation: { attribute: false },
    blockLabels: { attribute: false },
    referenceCount: { type: Number, attribute: "reference-count" },
    disabled: { type: Boolean },
  };
  settings: Model3dSettings = normalizeModel3dSettings();
  prompt = "";
  promptSource: "exact" | "document" = "exact";
  adaptation: Model3dDocumentAdaptation | null = null;
  blockLabels: Record<string,string> = {};
  referenceCount = 0;
  disabled = false;
  #id = `model3d-settings-${crypto.randomUUID()}`;
  #numericDrafts: Record<NumericField, string> = { seed: "", width: "1", height: "1", length: "1" };
  #numericValues: Partial<Record<NumericField, unknown>> = {};
  #lastEmitted = "";

  protected override willUpdate(changed: PropertyValues<this>) {
    super.willUpdate(changed);
    if (!changed.has("settings")) return;
    const settings = normalizeModel3dSettings(this.settings);
    const values: Record<NumericField, unknown> = {
      seed: settings.seed,
      width: settings.bbox_condition?.width,
      height: settings.bbox_condition?.height,
      length: settings.bbox_condition?.length,
    };
    for (const field of ["seed", "width", "height", "length"] as const) {
      if (!Object.is(values[field], this.#numericValues[field])) {
        // Do not replace a raw draft when its parsed value returns from the parent.
        if (values[field] !== undefined) this.#numericDrafts[field] = values[field] === null ? "" : String(values[field]);
        this.#numericValues[field] = values[field];
      }
    }
  }

  protected override updated(changed: PropertyValues<this>) {
    super.updated(changed);
    if (changed.has("settings") || changed.has("prompt") || changed.has("referenceCount") || changed.has("promptSource")) this.#emitChange();
  }

  #preflight(settings: unknown = this.settings) {
    return validateModel3dRequest({ prompt: this.prompt, settings, referenceCount: this.referenceCount });
  }

  #emitChange() {
    const checked = this.#preflight();
    const detail: Model3dSettingsChange = { settings: structuredClone(this.settings), prompt: this.prompt, valid: checked.valid };
    const signature = JSON.stringify([detail, this.referenceCount], (_key, value: unknown) => typeof value === "number" && !Number.isFinite(value) ? String(value) : value);
    if (signature === this.#lastEmitted) return;
    this.#lastEmitted = signature;
    this.dispatchEvent(new CustomEvent<Model3dSettingsChange>("model3d-settings-change", { detail, bubbles: true, composed: true }));
  }

  #change(patch: Partial<Model3dSettings>) {
    if (this.disabled) return;
    this.settings = { ...normalizeModel3dSettings(this.settings), ...patch };
    this.#emitChange();
  }

  #changePrompt(event: InputEvent) {
    if (this.disabled || this.promptSource === "document") return;
    this.prompt = (event.currentTarget as HTMLTextAreaElement).value;
    this.#emitChange();
  }

  #changeNumber(field: NumericField, event: InputEvent) {
    if (this.disabled) return;
    const draft = (event.currentTarget as HTMLInputElement).value;
    this.#numericDrafts[field] = draft;
    // Text inputs preserve incomplete numbers. NaN reaches the same validator as every other setting.
    const value = draft.trim() ? Number(draft) : field === "seed" ? null : Number.NaN;
    this.#numericValues[field] = value;
    if (field === "seed") this.#change({ seed: value });
    else this.#change({ bbox_condition: { ...this.settings.bbox_condition!, [field]: value as number } });
  }

  #toggleBoundingBox(event: Event) {
    if (this.disabled) return;
    if (!(event.currentTarget as HTMLInputElement).checked) { this.#change({ bbox_condition: null }); return; }
    const dimensions = Object.fromEntries((["width", "height", "length"] as const).map((field) => {
      const value = this.#numericDrafts[field].trim() ? Number(this.#numericDrafts[field]) : Number.NaN;
      this.#numericValues[field] = value;
      return [field, value];
    })) as NonNullable<Model3dSettings["bbox_condition"]>;
    this.#change({ bbox_condition: dimensions });
  }

  #invalid(field: string) { return this.#preflight().issues.some((issue) => issue.field === field); }

  #issueText(issue: Model3dValidationIssue) {
    return localizedModel3dValidationIssue(issue, this.i18n);
  }

  #tierLabel(value: string) {
    const labels: Record<string, string> = {
      "Gen-2.5-Minimum": this.i18n.t("model3d.tier.minimum", "Minimum"),
      "Gen-2.5-Extreme-Low": this.i18n.t("model3d.tier.extremeLow", "Extreme Low"),
      "Gen-2.5-Low": this.i18n.t("model3d.tier.low", "Low"),
      "Gen-2.5-Medium": this.i18n.t("model3d.tier.medium", "Medium"),
      "Gen-2.5-High": this.i18n.t("model3d.tier.high", "High"),
      "Gen-2.5-Extreme-High": this.i18n.t("model3d.tier.extremeHigh", "Extreme High"),
    };
    return labels[value] ?? value;
  }

  #materialLabel(value: string) {
    if (value === "Shaded") return this.i18n.t("model3d.material.shaded", "Shaded");
    if (value === "All") return this.i18n.t("model3d.material.all", "All materials");
    if (value === "None") return this.i18n.t("model3d.material.none", "Geometry only");
    return value;
  }

  #meshLabel(value: string) {
    if (value === "Auto") return this.i18n.t("model3d.mesh.auto", "Automatic");
    const [count, topology] = value.split(" ");
    return topology === "Quad" ? this.i18n.t("model3d.mesh.quad", "{count} Quad", { count }) : this.i18n.t("model3d.mesh.triangle", "{count} Triangle", { count });
  }

  #textureLabel(value: string) {
    if (value === "auto") return this.i18n.t("model3d.texture.auto", "Automatic");
    if (value === "legacy") return this.i18n.t("model3d.texture.legacy", "Legacy");
    return this.#tierLabel(`Gen-2.5-${value.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join("-")}`);
  }

  #select(field: SelectField, choices: readonly string[], label: string, help: string, format: (value: string) => string = (value) => value) {
    const value = String(this.settings[field]);
    const descriptionId = `${this.#id}-${field}-help`;
    return html`<label>${label}<select name=${field} .value=${value} aria-describedby=${descriptionId} aria-invalid=${this.#invalid(field) ? "true" : "false"} @change=${(event: Event) => this.#change({ [field]: (event.currentTarget as HTMLSelectElement).value } as Partial<Model3dSettings>)}>
      ${choices.includes(value) ? nothing : html`<option value=${value} selected disabled>${this.i18n.t("model3d.settings.unsupportedValue", "Choose a supported value")}</option>`}
      ${choices.map((choice) => html`<option value=${choice} ?selected=${choice === value} ?disabled=${this.#preflight({ ...this.settings, [field]: choice }).issues.some((issue) => issue.field === field)}>${format(choice)}</option>`)}
    </select><small id=${descriptionId}>${help}</small></label>`;
  }

  #toggle(field: BooleanField, label: string, help: string) {
    const checked = this.settings[field] === true;
    const unavailable = !checked && this.#preflight({ ...this.settings, [field]: true }).issues.some((issue) => issue.field === field);
    return html`<label class="model3d-settings-toggle"><input name=${field} type="checkbox" .checked=${checked} ?disabled=${this.disabled || unavailable} aria-invalid=${this.#invalid(field) ? "true" : "false"} aria-describedby=${`${this.#id}-${field}-help`} @change=${(event: Event) => this.#change({ [field]: (event.currentTarget as HTMLInputElement).checked })}><span>${label}<small id=${`${this.#id}-${field}-help`}>${help}</small></span></label>`;
  }

  #number(field: NumericField, label: string, help: string) {
    const issueField = field === "seed" ? "seed" : `bbox_condition.${field}`;
    return html`<label>${label}<input type="text" inputmode="numeric" autocomplete="off" spellcheck="false" name=${issueField} .value=${this.#numericDrafts[field]} aria-invalid=${this.#invalid(issueField) ? "true" : "false"} aria-describedby=${`${this.#id}-${field}-help`} @input=${(event: InputEvent) => this.#changeNumber(field, event)}><small id=${`${this.#id}-${field}-help`}>${help}</small></label>`;
  }

  override render() {
    const checked = this.#preflight();
    const adaptation = this.promptSource === "document" ? this.adaptation : null;
    const issues = checked.issues.filter(issue => !(adaptation?.issues.length && issue.field === "prompt"));
    const bboxEnabled = this.settings.bbox_condition !== null;
    const highPackCost = estimateModel3dCostMicrousd({ ...this.settings, addons: { high_pack: true } }) - estimateModel3dCostMicrousd({ ...this.settings, addons: { high_pack: false } });
    const dimensionHelp = this.i18n.t("model3d.settings.dimensionHelp", "Whole number from 1 to 2,048.");
    return html`<section class="model3d-settings-editor" aria-label=${this.i18n.t("model3d.settings.heading", "3D generation settings")}>
      ${this.promptSource === "document" ? html`<p>${this.i18n.t("model3d.document.help", "Forma adapts the active document context into a model description. You do not need to write a separate prompt. Only the prepared text and the image views you select are sent to Rodin.")}</p>` : nothing}
      ${adaptation?.issues.length ? html`<div class="model3d-settings-validation has-errors" role="status"><h4>${this.i18n.t("model3d.settings.review", "Review before generating")}</h4><ul>${adaptation.issues.map(issue => html`<li>${this.i18n.t(`model3d.adaptation.${issue.code}`, issue.message)}${issue.blockIds.some(id => this.blockLabels[id]) ? html`<ul>${issue.blockIds.filter(id => this.blockLabels[id]).map(id => html`<li dir="auto">${this.blockLabels[id]}</li>`)}</ul>` : nothing}</li>`)}</ul></div>` : nothing}
      ${adaptation?.suggestions.length ? html`<details class="model3d-settings-advanced"><summary>${this.i18n.t("model3d.document.suggestions", "Suggestions for clearer model direction")}</summary><ul class="model3d-settings-guidance">${adaptation.suggestions.map(suggestion => html`<li>${this.i18n.t(`model3d.adaptation.${suggestion.code}`, suggestion.message)}</li>`)}</ul></details>` : nothing}
      ${adaptation?.omittedBlockIds.length ? html`<details class="model3d-settings-advanced"><summary>${this.i18n.t("model3d.document.omitted", "Context left out of the prepared prompt: {count}", { count: this.i18n.number(adaptation.omittedBlockIds.length) })}</summary><p>${this.i18n.t("model3d.document.omittedHelp", "Review the prepared description before generating. To prioritize another detail, revise the document's context blocks.")}</p><ul class="model3d-settings-guidance">${adaptation.omittedBlockIds.filter(id => this.blockLabels[id]).map(id => html`<li dir="auto">${this.blockLabels[id]}</li>`)}</ul></details>` : nothing}
      <fieldset ?disabled=${this.disabled}>
        ${this.promptSource === "document" ? html`<details class="model3d-settings-advanced model3d-document-prompt"><summary>${this.i18n.t("model3d.document.prompt", "Prepared model prompt")}</summary><p>${this.i18n.t("model3d.document.promptHelp", "Forma prepares this text from the document. Edit its context blocks to change the model direction.")}</p>${this.prompt ? html`<textarea readonly rows="4" .value=${this.prompt} aria-label=${this.i18n.t("model3d.document.prompt", "Prepared model prompt")}></textarea>` : this.referenceCount > 0 ? html`<p>${this.i18n.t("model3d.document.imageOnly", "The selected image views supply the model direction without an additional text prompt.")}</p>` : nothing}<small>${this.i18n.t("model3d.prompt.count", "{count} / {limit} characters", { count: this.i18n.number(checked.promptCharacters), limit: this.i18n.number(RODIN_PROMPT_MAX_CHARS) })}</small></details>` : html`
          <label>${this.i18n.t("model3d.prompt.label", "Exact 3D prompt")}<textarea name="model3d_prompt" rows="4" .value=${this.prompt} ?required=${this.referenceCount === 0} aria-invalid=${this.#invalid("prompt") ? "true" : "false"} aria-describedby=${`${this.#id}-prompt-help ${this.#id}-prompt-count`} @input=${this.#changePrompt}></textarea></label>
          <div class="model3d-prompt-meta"><small id=${`${this.#id}-prompt-help`}>${this.referenceCount > 0 ? this.i18n.t("model3d.prompt.imageHelp", "Optional with image references. Describe a single subject and the details the views do not show. This exact text is sent to Rodin.") : this.i18n.t("model3d.prompt.textHelp", "Describe a single subject, its shape, and its materials. This exact text is sent to Rodin; document text is not added automatically.")}</small><small class=${`model3d-prompt-count${checked.promptCharacters > RODIN_PROMPT_MAX_CHARS ? " over-limit" : ""}`} id=${`${this.#id}-prompt-count`}>${this.i18n.t("model3d.prompt.count", "{count} / {limit} characters", { count: this.i18n.number(checked.promptCharacters), limit: this.i18n.number(RODIN_PROMPT_MAX_CHARS) })}</small></div>`}
        <div class="model3d-settings-grid">
          ${this.#select("tier", RODIN_TIERS, this.i18n.t("model3d.settings.tier", "Generation tier"), this.i18n.t("model3d.settings.tierHelp", "Choose the geometry detail level. Micro detail requires Extreme High; creative mode requires Medium or higher."), (value) => this.#tierLabel(value))}
          ${this.#select("geometry_file_format", MODEL3D_FORMATS, this.i18n.t("model3d.settings.format", "Model format"), this.i18n.t("model3d.settings.formatHelp", "GLB supports interactive preview and saved image views in Forma. USDZ, FBX, OBJ, and STL can be downloaded."), (value) => value.toUpperCase())}
          ${this.#select("material", RODIN_MATERIALS, this.i18n.t("model3d.settings.material", "Materials"), this.i18n.t("model3d.settings.materialHelp", "Choose PBR, shaded materials, both, or geometry without textures."), (value) => this.#materialLabel(value))}
          ${this.#select("quality_mesh_option", RODIN_QUALITY_MESH_OPTIONS, this.i18n.t("model3d.settings.mesh", "Mesh quality"), this.i18n.t("model3d.settings.meshHelp", "Quad and triangle options are supported. Minimum always returns 50K Triangle; the selected tier determines available triangle sizes."), (value) => this.#meshLabel(value))}
        </div>
      </fieldset>
      <details class="model3d-settings-advanced"><summary>${this.i18n.t("model3d.settings.advanced", "Advanced 3D settings")}</summary><fieldset ?disabled=${this.disabled}>
        <div class="model3d-settings-grid">
          ${this.#select("texture_mode", RODIN_TEXTURE_MODES, this.i18n.t("model3d.settings.textureMode", "Texture mode"), this.i18n.t("model3d.settings.textureHelp", "Automatic lets Rodin choose its texture mode for the selected tier."), (value) => this.#textureLabel(value))}
          ${this.#number("seed", this.i18n.t("model3d.settings.seed", "Seed"), this.i18n.t("model3d.settings.seedHelp", "Leave empty for a random seed, or enter a whole number from 0 to 65,535."))}
        </div>
        <div class="model3d-settings-grid">
          ${this.#toggle("enable_creative_mode", this.i18n.t("model3d.settings.creative", "Creative mode"), this.i18n.t("model3d.settings.creativeHelp", "Available with Medium, High, and Extreme High tiers."))}
          ${this.#toggle("is_micro", this.i18n.t("model3d.settings.micro", "Micro detail"), this.i18n.t("model3d.settings.microHelp", "Add micro geometry detail with the Extreme High tier."))}
          ${this.#toggle("hd_texture", this.i18n.t("model3d.settings.hdTexture", "HD texture"), this.i18n.t("model3d.settings.hdTextureHelp", "Request higher-resolution textures."))}
          ${this.#toggle("texture_delight", this.i18n.t("model3d.settings.delight", "Remove baked lighting"), this.i18n.t("model3d.settings.delightHelp", "Reduce lighting and shadow information in the generated textures."))}
          ${this.#toggle("TAPose", this.i18n.t("model3d.settings.pose", "T/A pose"), this.i18n.t("model3d.settings.poseHelp", "Request a T-pose or A-pose for a character."))}
          ${this.#toggle("use_original_alpha", this.i18n.t("model3d.settings.originalAlpha", "Keep reference transparency"), this.i18n.t("model3d.settings.originalAlphaHelp", "Use the original image transparency. Requires image references."))}
          ${this.#toggle("preview_render", this.i18n.t("model3d.settings.previewRender", "Provider preview render"), this.i18n.t("model3d.settings.previewRenderHelp", "Request the provider preview available for image-to-3D. Requires image references; GLB can also be viewed in Forma."))}
          <label class="model3d-settings-toggle"><input type="checkbox" name="addons.high_pack" .checked=${this.settings.addons?.high_pack === true} aria-invalid=${this.#invalid("addons.high_pack") ? "true" : "false"} aria-describedby=${`${this.#id}-high-pack-help`} @change=${(event: Event) => this.#change({ addons: { high_pack: (event.currentTarget as HTMLInputElement).checked } })}><span>${this.i18n.t("model3d.settings.highPack", "HighPack textures (+{amount})", { amount: this.i18n.number(highPackCost / 1_000_000, { style: "currency", currency: "USD" }) })}<small id=${`${this.#id}-high-pack-help`}>${this.i18n.t("model3d.settings.highPackHelp", "Adds the provider’s HighPack texture package to each generation. Choose textured materials to use it.")}</small></span></label>
        </div>
        <div class="model3d-settings-bbox"><label class="model3d-settings-toggle"><input type="checkbox" name="bbox_enabled" .checked=${bboxEnabled} @change=${this.#toggleBoundingBox}><span>${this.i18n.t("model3d.settings.boundingBox", "Set model proportions")}<small>${this.i18n.t("model3d.settings.boundingBoxHelp", "Supply width, height, and length together. Rodin does not specify physical units.")}</small></span></label>
          ${bboxEnabled ? html`<div class="model3d-bbox-grid">${this.#number("width", this.i18n.t("model3d.settings.width", "Width"), dimensionHelp)}${this.#number("height", this.i18n.t("model3d.settings.height", "Height"), dimensionHelp)}${this.#number("length", this.i18n.t("model3d.settings.length", "Length"), dimensionHelp)}</div>` : nothing}
        </div>
      </fieldset></details>
      ${issues.length ? html`<div class="model3d-settings-validation has-errors" role="status" aria-live="polite"><h4>${this.i18n.t("model3d.settings.review", "Review before generating")}</h4><ul>${issues.map((issue) => html`<li>${this.#issueText(issue)}</li>`)}</ul></div>` : nothing}
      ${checked.warnings.length ? html`<ul class="model3d-settings-guidance" aria-label=${this.i18n.t("model3d.settings.guidance", "3D generation guidance")}>${checked.warnings.map((warning) => html`<li>${this.i18n.system(warning)}</li>`)}</ul>` : nothing}
    </section>`;
  }
}

if (!customElements.get("forma-model3d-settings-editor")) customElements.define("forma-model3d-settings-editor", Model3dSettingsEditor);
declare global { interface HTMLElementTagNameMap { "forma-model3d-settings-editor": Model3dSettingsEditor } }

import { html, nothing } from "lit";
import { icon } from "../icons";
import { FormaPresentationalElement } from "../presentational-element";
import { defineFormaElements, emitFormaEvent, nextFormaId, type FormaOption } from "./contracts";

/**
 * @tag forma-ui-search
 * @summary Visibly labelled native search input with an optional clear action.
 * @fires {CustomEvent<{ value: string }>} forma-input - Search terms changed.
 * @fires {CustomEvent<{ value: string }>} forma-change - Search terms were committed.
 * @fires {CustomEvent<{ value: string }>} forma-clear - Search terms were cleared.
 * @cssprop {<length>} --forma-control-min-size - Input and clear-button target size.
 * @cssprop {<color>} --forma-color-border-strong - Accessible input boundary.
 */
export class FormaUiSearch extends FormaPresentationalElement {
  static properties = { label: { type: String }, value: { type: String }, placeholder: { type: String }, name: { type: String }, form: { type: String }, help: { type: String }, disabled: { type: Boolean } };
  label = "Search"; value = ""; placeholder = ""; name = ""; form = ""; help = ""; disabled = false; #id = nextFormaId("search");
  #input(event: Event) { this.value = (event.target as HTMLInputElement).value; emitFormaEvent(this, "forma-input", { value: this.value }); }
  #change(event: Event) { this.value = (event.target as HTMLInputElement).value; emitFormaEvent(this, "forma-change", { value: this.value }); }
  #clear() { if (this.disabled || !this.value) return; const input = this.querySelector("input"); if (!input) return; input.value = ""; input.dispatchEvent(new Event("input", { bubbles: true, composed: true })); emitFormaEvent(this, "forma-clear", { value: "" }); input.focus(); }
  override render() { return html`<div class="ui-search"><label for=${this.#id}>${this.label || "Search"}</label><div class="ui-search-control"><span aria-hidden="true">${icon("search")}</span><input id=${this.#id} type="search" .value=${this.value} name=${this.name || nothing} form=${this.form || nothing} placeholder=${this.placeholder || nothing} ?disabled=${this.disabled} aria-describedby=${this.help ? `${this.#id}-help` : nothing} @input=${this.#input} @change=${this.#change}><button type="button" class=${this.value ? "" : "ui-search-clear-empty"} aria-label="Clear search" ?disabled=${this.disabled || !this.value} @click=${this.#clear}>${icon("close")}</button></div>${this.help ? html`<small id=${`${this.#id}-help`}>${this.help}</small>` : nothing}</div>`; }
}

/**
 * @tag forma-ui-textarea
 * @summary Native multiline field with independent help, errors, and form participation.
 * @fires {CustomEvent<{ value: string }>} forma-input - The content changed.
 * @fires {CustomEvent<{ value: string }>} forma-change - The content was committed.
 * @cssprop {<color>} --forma-color-border-strong - Accessible input boundary.
 * @cssprop {<color>} --forma-color-danger-text - Error message foreground.
 */
export class FormaUiTextarea extends FormaPresentationalElement {
  static properties = { label: { type: String }, value: { type: String }, name: { type: String }, form: { type: String }, placeholder: { type: String }, help: { type: String }, error: { type: String }, required: { type: Boolean }, disabled: { type: Boolean }, readOnly: { type: Boolean, attribute: "readonly" }, rows: { type: Number }, maxLength: { type: Number, attribute: "max-length" }, autocomplete: { type: String } };
  label = ""; value = ""; name = ""; form = ""; placeholder = ""; help = ""; error = ""; required = false; disabled = false; readOnly = false; rows = 4; maxLength = 0; autocomplete = ""; #id = nextFormaId("textarea");
  #input(event: Event) { this.value = (event.target as HTMLTextAreaElement).value; emitFormaEvent(this, "forma-input", { value: this.value }); }
  #change(event: Event) { this.value = (event.target as HTMLTextAreaElement).value; emitFormaEvent(this, "forma-change", { value: this.value }); }
  override render() { const descriptions = [this.help && `${this.#id}-help`, this.error && `${this.#id}-error`].filter(Boolean).join(" "); return html`<label class=${`ui-field ui-textarea${this.error ? " ui-field--invalid" : ""}`} for=${this.#id}><span>${this.label || "Text"}${this.required ? html` <span aria-hidden="true">*</span>` : nothing}</span><textarea id=${this.#id} .value=${this.value} rows=${Math.max(2, this.rows)} name=${this.name || nothing} form=${this.form || nothing} placeholder=${this.placeholder || nothing} maxlength=${this.maxLength > 0 ? this.maxLength : nothing} autocomplete=${this.autocomplete || nothing} ?required=${this.required} ?disabled=${this.disabled} ?readonly=${this.readOnly} aria-invalid=${this.error ? "true" : "false"} aria-describedby=${descriptions || nothing} aria-errormessage=${this.error ? `${this.#id}-error` : nothing} @input=${this.#input} @change=${this.#change}></textarea>${this.help ? html`<small id=${`${this.#id}-help`}>${this.help}</small>` : nothing}${this.error ? html`<small id=${`${this.#id}-error`} class="ui-field-error">${this.error}</small>` : nothing}</label>`; }
}

/**
 * @tag forma-ui-select
 * @summary Labelled native select with JavaScript-supplied option records.
 * @fires {CustomEvent<{ value: string }>} forma-change - A new option was selected.
 * @cssprop {<length>} --forma-control-min-size - Native select target size.
 * @cssprop {<color>} --forma-color-border-strong - Accessible select boundary.
 */
export class FormaUiSelect extends FormaPresentationalElement {
  static properties = { label: { type: String }, value: { type: String }, name: { type: String }, form: { type: String }, help: { type: String }, error: { type: String }, placeholder: { type: String }, required: { type: Boolean }, disabled: { type: Boolean }, options: { attribute: false } };
  label = ""; value = ""; name = ""; form = ""; help = ""; error = ""; placeholder = ""; required = false; disabled = false; options: FormaOption[] = []; #id = nextFormaId("select");
  #change(event: Event) { this.value = (event.target as HTMLSelectElement).value; emitFormaEvent(this, "forma-change", { value: this.value }); }
  override render() { const descriptions = [this.help && `${this.#id}-help`, this.error && `${this.#id}-error`].filter(Boolean).join(" "); return html`<label class=${`ui-field ui-select${this.error ? " ui-field--invalid" : ""}`} for=${this.#id}><span>${this.label || "Choose an option"}${this.required ? html` <span aria-hidden="true">*</span>` : nothing}</span><select id=${this.#id} .value=${this.value} name=${this.name || nothing} form=${this.form || nothing} ?required=${this.required} ?disabled=${this.disabled} aria-invalid=${this.error ? "true" : "false"} aria-describedby=${descriptions || nothing} aria-errormessage=${this.error ? `${this.#id}-error` : nothing} @change=${this.#change}>${this.placeholder ? html`<option value="" ?selected=${!this.value}>${this.placeholder}</option>` : nothing}${this.options.map((option) => html`<option value=${option.value} ?selected=${option.value === this.value} ?disabled=${option.disabled ?? false}>${option.label}</option>`)}</select>${this.help ? html`<small id=${`${this.#id}-help`}>${this.help}</small>` : nothing}${this.error ? html`<small id=${`${this.#id}-error`} class="ui-field-error">${this.error}</small>` : nothing}</label>`; }
}

/**
 * @tag forma-ui-checkbox
 * @summary Native form-associated checkbox with a full-label pointer target.
 * @fires {CustomEvent<{ checked: boolean; value: string }>} forma-change - The checked state changed.
 * @cssprop {<length>} --forma-control-min-size - Full-row pointer target height.
 * @cssprop {<color>} --forma-color-accent - Native checkbox accent.
 */
export class FormaUiCheckbox extends FormaPresentationalElement {
  static properties = { label: { type: String }, name: { type: String }, form: { type: String }, value: { type: String }, checked: { type: Boolean }, disabled: { type: Boolean }, required: { type: Boolean }, help: { type: String } };
  label = ""; name = ""; form = ""; value = "on"; checked = false; disabled = false; required = false; help = ""; #id = nextFormaId("checkbox");
  #change(event: Event) { this.checked = (event.target as HTMLInputElement).checked; emitFormaEvent(this, "forma-change", { checked: this.checked, value: this.value }); }
  override render() { return html`<label class="ui-choice" for=${this.#id}><input id=${this.#id} type="checkbox" name=${this.name || nothing} form=${this.form || nothing} value=${this.value} .checked=${this.checked} ?disabled=${this.disabled} ?required=${this.required} aria-describedby=${this.help ? `${this.#id}-help` : nothing} @change=${this.#change}><span><span>${this.label || "Option"}</span>${this.help ? html`<small id=${`${this.#id}-help`}>${this.help}</small>` : nothing}</span></label>`; }
}

/**
 * @tag forma-ui-switch
 * @summary Native checkbox-based on/off control with a visible persistent label.
 * @fires {CustomEvent<{ checked: boolean; value: string }>} forma-change - The setting changed.
 * @cssprop {<length>} --forma-control-min-size - Full-row pointer target height.
 * @cssprop {<color>} --forma-color-accent - Active switch accent.
 */
export class FormaUiSwitch extends FormaPresentationalElement {
  static properties = { label: { type: String }, name: { type: String }, form: { type: String }, value: { type: String }, checked: { type: Boolean }, disabled: { type: Boolean }, help: { type: String } };
  label = ""; name = ""; form = ""; value = "on"; checked = false; disabled = false; help = ""; #id = nextFormaId("switch");
  #change(event: Event) { this.checked = (event.target as HTMLInputElement).checked; emitFormaEvent(this, "forma-change", { checked: this.checked, value: this.value }); }
  override render() { return html`<label class="ui-choice ui-switch" for=${this.#id}><input id=${this.#id} type="checkbox" name=${this.name || nothing} form=${this.form || nothing} value=${this.value} role="switch" .checked=${this.checked} ?disabled=${this.disabled} aria-describedby=${this.help ? `${this.#id}-help` : nothing} @change=${this.#change}><span><span>${this.label || "Setting"}</span>${this.help ? html`<small id=${`${this.#id}-help`}>${this.help}</small>` : nothing}</span></label>`; }
}

/**
 * @tag forma-ui-radio-group
 * @summary Native fieldset and radio group with browser-owned arrow-key navigation.
 * @fires {CustomEvent<{ value: string }>} forma-change - A radio option was selected.
 * @cssprop {<length>} --forma-control-min-size - Each option's full-row target size.
 * @cssprop {<color>} --forma-color-accent - Native radio accent.
 */
export class FormaUiRadioGroup extends FormaPresentationalElement {
  static properties = { label: { type: String }, name: { type: String }, form: { type: String }, value: { type: String }, help: { type: String }, required: { type: Boolean }, disabled: { type: Boolean }, options: { attribute: false } };
  label = ""; name = ""; form = ""; value = ""; help = ""; required = false; disabled = false; options: FormaOption[] = []; #id = nextFormaId("radio");
  #change(event: Event) { this.value = (event.target as HTMLInputElement).value; emitFormaEvent(this, "forma-change", { value: this.value }); }
  override render() { return html`<fieldset class="ui-radio-group" ?disabled=${this.disabled} aria-describedby=${this.help ? `${this.#id}-help` : nothing}><legend>${this.label || "Choose an option"}</legend>${this.options.map((option) => html`<label class="ui-choice"><input type="radio" name=${this.name || this.#id} form=${this.form || nothing} value=${option.value} .checked=${option.value === this.value} ?required=${this.required} ?disabled=${option.disabled ?? false} @change=${this.#change}><span><span>${option.label}</span>${option.description ? html`<small>${option.description}</small>` : nothing}</span></label>`)}${this.help ? html`<small id=${`${this.#id}-help`}>${this.help}</small>` : nothing}</fieldset>`; }
}

/**
 * @tag forma-ui-number-field
 * @summary Native numeric input with visible bounds and form-compatible name.
 * @fires {CustomEvent<{ value: number | null }>} forma-input - The numeric value changed.
 * @fires {CustomEvent<{ value: number | null }>} forma-change - The numeric value was committed.
 * @cssprop {<color>} --forma-color-border-strong - Accessible input boundary.
 */
export class FormaUiNumberField extends FormaPresentationalElement {
  static properties = { label: { type: String }, name: { type: String }, form: { type: String }, value: { type: Number }, min: { type: Number }, max: { type: Number }, step: { type: Number }, help: { type: String }, disabled: { type: Boolean }, required: { type: Boolean } };
  label = ""; name = ""; form = ""; value = 0; min = Number.NaN; max = Number.NaN; step = 1; help = ""; disabled = false; required = false; #id = nextFormaId("number");
  #update(event: Event, name: "forma-input" | "forma-change") { const value = (event.target as HTMLInputElement).valueAsNumber; if (Number.isFinite(value)) this.value = value; emitFormaEvent(this, name, { value: Number.isFinite(value) ? value : null }); }
  #input(event: Event) { this.#update(event, "forma-input"); }
  #change(event: Event) { this.#update(event, "forma-change"); }
  override render() { return html`<label class="ui-field" for=${this.#id}><span>${this.label || "Number"}</span><input id=${this.#id} type="number" name=${this.name || nothing} form=${this.form || nothing} .value=${Number.isNaN(this.value) ? "" : String(this.value)} min=${Number.isNaN(this.min) ? nothing : this.min} max=${Number.isNaN(this.max) ? nothing : this.max} step=${this.step} ?disabled=${this.disabled} ?required=${this.required} aria-describedby=${this.help ? `${this.#id}-help` : nothing} @input=${this.#input} @change=${this.#change}>${this.help ? html`<small id=${`${this.#id}-help`}>${this.help}</small>` : nothing}</label>`; }
}

const definitions = [
  ["forma-ui-search", FormaUiSearch], ["forma-ui-textarea", FormaUiTextarea], ["forma-ui-select", FormaUiSelect],
  ["forma-ui-checkbox", FormaUiCheckbox], ["forma-ui-switch", FormaUiSwitch], ["forma-ui-radio-group", FormaUiRadioGroup],
  ["forma-ui-number-field", FormaUiNumberField],
] as const;
defineFormaElements(definitions);

declare global {
  interface HTMLElementTagNameMap {
    "forma-ui-search": FormaUiSearch; "forma-ui-textarea": FormaUiTextarea; "forma-ui-select": FormaUiSelect;
    "forma-ui-checkbox": FormaUiCheckbox; "forma-ui-switch": FormaUiSwitch; "forma-ui-radio-group": FormaUiRadioGroup;
    "forma-ui-number-field": FormaUiNumberField;
  }
}

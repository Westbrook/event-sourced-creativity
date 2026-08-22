import { html, noChange, nothing } from "lit";
import { icon, type FormaIconName } from "./icons";
import { FormaPresentationalElement } from "./presentational-element";

export type InterfaceTone = "neutral" | "accent" | "positive" | "warning" | "danger";
export type InterfaceButtonVariant = "primary" | "secondary" | "ghost" | "danger";

/**
 * Native, form-participating action button with a stable busy label.
 * @tag forma-ui-button
 * @summary Accessible action button that preserves native submit and reset behavior.
 * @fires {CustomEvent<{ value: string }>} forma-press - A non-disabled action was activated.
 * @cssprop {<length>} --forma-control-min-size - Minimum interactive target size.
 * @cssprop {<color>} --forma-color-accent - Accent and focus color.
 * @cssprop {<length>} --forma-radius-small - Control corner radius.
 */
export class FormaUiButton extends FormaPresentationalElement {
  static properties = { label: { type: String }, variant: { type: String }, disabled: { type: Boolean }, busy: { type: Boolean }, compact: { type: Boolean }, iconName: { type: String, attribute: "icon-name" }, type: { type: String }, name: { type: String }, value: { type: String }, form: { type: String }, busyLabel: { type: String, attribute: "busy-label" }, expanded: { type: Boolean }, pressed: { type: Boolean }, controls: { type: String } };
  label = ""; variant: InterfaceButtonVariant = "secondary"; disabled = false; busy = false; compact = false; iconName: FormaIconName | "" = ""; type: "button" | "submit" | "reset" = "button"; name = ""; value = ""; form = ""; busyLabel = ""; expanded?: boolean; pressed?: boolean; controls = "";
  #press(event: MouseEvent) {
    if (this.disabled || this.busy) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    if (!this.dispatchEvent(new CustomEvent("forma-press", { detail: { value: this.value }, bubbles: true, composed: true, cancelable: true }))) event.preventDefault();
  }
  override render() {
    const label = this.label || this.i18n.t("action.default");
    const busy = this.busy ? this.busyLabel || this.i18n.t("action.working") : "";
    return html`<button type=${this.type} class=${`button ${this.variant}${this.compact ? " compact" : ""}`} ?disabled=${this.disabled} aria-disabled=${this.busy ? "true" : nothing} aria-busy=${this.busy ? "true" : "false"} aria-expanded=${typeof this.expanded === "boolean" ? String(this.expanded) : nothing} aria-pressed=${typeof this.pressed === "boolean" ? String(this.pressed) : nothing} aria-controls=${this.controls || nothing} name=${this.name || nothing} value=${this.value || nothing} form=${this.form || nothing} @click=${this.#press}>${this.iconName ? html`<span class=${this.iconName === "arrow" ? "ui-directional-icon" : nothing} aria-hidden="true">${icon(this.iconName)}</span>` : nothing}<span>${label}</span>${this.busy ? html`<span class="ui-spinner-mark ui-button-busy" aria-hidden="true"></span>` : nothing}</button><span class="sr-only" role="status" aria-live="polite" aria-atomic="true">${this.busy ? this.i18n.t("action.busy", "", { label, status: busy }) : ""}</span>`;
  }
}

/**
 * Textual status indicator; color is never its only carrier of meaning.
 * @tag forma-ui-badge
 * @summary Compact, contrast-safe textual status indicator.
 * @cssprop {<color>} --forma-color-text-muted - Neutral badge foreground.
 * @cssprop {<color>} --forma-color-positive-text - Positive status foreground.
 * @cssprop {<color>} --forma-color-warning-text - Warning status foreground.
 * @cssprop {<color>} --forma-color-danger-text - Error status foreground.
 */
export class FormaUiBadge extends FormaPresentationalElement {
  static properties = { label: { type: String }, tone: { type: String } };
  label = ""; tone: InterfaceTone = "neutral";
  override render() { return html`<span class=${`ui-badge ui-badge--${this.tone}`}>${this.label}</span>`; }
}

/**
 * Native input with an always-visible label, independent help and error text.
 * @tag forma-ui-field
 * @summary Form-participating input with native validation and accessible descriptions.
 * @fires {CustomEvent<{ value: string }>} forma-input - The input value changed.
 * @fires {CustomEvent<{ value: string }>} forma-change - The input value was committed.
 * @cssprop {<length>} --forma-control-min-size - Minimum input target size.
 * @cssprop {<color>} --forma-color-border-strong - Accessible input boundary.
 * @cssprop {<color>} --forma-color-danger-text - Validation message foreground.
 */
export class FormaUiField extends FormaPresentationalElement {
  static properties = { label: { type: String }, value: { type: String }, placeholder: { type: String }, help: { type: String }, error: { type: String }, type: { type: String }, name: { type: String }, form: { type: String }, autocomplete: { type: String }, inputMode: { type: String, attribute: "input-mode" }, required: { type: Boolean }, disabled: { type: Boolean }, readOnly: { type: Boolean, attribute: "readonly" }, minLength: { type: Number, attribute: "min-length" }, maxLength: { type: Number, attribute: "max-length" }, pattern: { type: String }, min: { type: String }, max: { type: String }, step: { type: String } };
  label = ""; value = ""; placeholder = ""; help = ""; error = ""; type = "text"; name = ""; form = ""; autocomplete = ""; inputMode = ""; required = false; disabled = false; readOnly = false; minLength = 0; maxLength = 0; pattern = ""; min = ""; max = ""; step = "";
  #id = `forma-field-${crypto.randomUUID()}`;
  #composing = false;
  #input(event: Event) { if (this.#composing || (event instanceof InputEvent && event.isComposing)) return; const value = (event.target as HTMLInputElement).value; if (value === this.value) return; this.value = value; this.dispatchEvent(new CustomEvent("forma-input", { detail: { value }, bubbles: true, composed: true })); }
  #compositionStart() { this.#composing = true; }
  #compositionEnd(event: CompositionEvent) { this.#composing = false; this.#input(event); }
  #change(event: Event) { this.value = (event.target as HTMLInputElement).value; this.dispatchEvent(new CustomEvent("forma-change", { detail: { value: this.value }, bubbles: true, composed: true })); }
  override render() {
    const descriptions = [this.help ? `${this.#id}-help` : "", this.error ? `${this.#id}-error` : ""].filter(Boolean).join(" ");
    return html`<label class=${`ui-field${this.error ? " ui-field--invalid" : ""}`} for=${this.#id}><span>${this.label || this.i18n.t("field.text")}${this.required ? html` <span aria-hidden="true">*</span>` : nothing}</span><input id=${this.#id} type=${this.type} .value=${this.#composing ? noChange : this.value} name=${this.name || nothing} form=${this.form || nothing} placeholder=${this.placeholder || nothing} autocomplete=${this.autocomplete || nothing} inputmode=${this.inputMode || nothing} minlength=${this.minLength > 0 ? this.minLength : nothing} maxlength=${this.maxLength > 0 ? this.maxLength : nothing} pattern=${this.pattern || nothing} min=${this.min || nothing} max=${this.max || nothing} step=${this.step || nothing} ?required=${this.required} ?disabled=${this.disabled} ?readonly=${this.readOnly} aria-invalid=${this.error ? "true" : "false"} aria-describedby=${descriptions || nothing} aria-errormessage=${this.error ? `${this.#id}-error` : nothing} @input=${this.#input} @change=${this.#change} @compositionstart=${this.#compositionStart} @compositionend=${this.#compositionEnd}>${this.help ? html`<small id=${`${this.#id}-help`}>${this.help}</small>` : nothing}${this.error ? html`<small id=${`${this.#id}-error`} class="ui-field-error">${this.error}</small>` : nothing}</label>`;
  }
}

/**
 * Accessible definition-list summary for one named measurement.
 * @tag forma-ui-metric
 * @summary Named metric with an optional explanatory caption.
 * @cssprop {<color>} --forma-color-text - Measurement foreground.
 * @cssprop {<color>} --forma-color-text-muted - Caption foreground.
 */
export class FormaUiMetric extends FormaPresentationalElement {
  static properties = { label: { type: String }, value: { type: String }, detail: { type: String } };
  label = ""; value = ""; detail = "";
  override render() { return html`<dl class="ui-metric"><dt>${this.label}</dt><dd>${this.value}${this.detail ? html`<span class="ui-metric-detail">${this.detail}</span>` : nothing}</dd></dl>`; }
}

/**
 * Outcome-led empty state that offers one explicit follow-up action.
 * @tag forma-ui-empty-state
 * @summary Explain an empty surface and offer a meaningful next step.
 * @fires {CustomEvent<null>} forma-action - The visible follow-up action was requested.
 * @cssprop {<color>} --forma-color-accent - Illustration and focus accent.
 * @cssprop {<length>} --forma-space-6 - Vertical spacing.
 */
export class FormaUiEmptyState extends FormaPresentationalElement {
  static properties = { heading: { type: String }, detail: { type: String }, action: { type: String }, iconName: { type: String, attribute: "icon-name" }, level: { type: Number } };
  heading = ""; detail = ""; action = ""; iconName: FormaIconName = "spark"; level = 3;
  #heading() { switch (Math.max(1, Math.min(6, Math.trunc(this.level)))) { case 1: return html`<h1>${this.heading}</h1>`; case 2: return html`<h2>${this.heading}</h2>`; case 4: return html`<h4>${this.heading}</h4>`; case 5: return html`<h5>${this.heading}</h5>`; case 6: return html`<h6>${this.heading}</h6>`; default: return html`<h3>${this.heading}</h3>`; } }
  override render() {
    return html`<section class="ui-empty-state"><span aria-hidden="true">${icon(this.iconName)}</span>${this.#heading()}<p>${this.detail}</p>${this.action ? html`<forma-ui-button variant="secondary" .label=${this.action} @forma-press=${() => this.dispatchEvent(new CustomEvent("forma-action", { bubbles: true, composed: true }))}></forma-ui-button>` : nothing}</section>`;
  }
}

const definitions: Array<[string, CustomElementConstructor]> = [["forma-ui-button", FormaUiButton], ["forma-ui-badge", FormaUiBadge], ["forma-ui-field", FormaUiField], ["forma-ui-metric", FormaUiMetric], ["forma-ui-empty-state", FormaUiEmptyState]];
for (const [name, constructor] of definitions) if (!customElements.get(name)) customElements.define(name, constructor);

declare global { interface HTMLElementTagNameMap { "forma-ui-button": FormaUiButton; "forma-ui-badge": FormaUiBadge; "forma-ui-field": FormaUiField; "forma-ui-metric": FormaUiMetric; "forma-ui-empty-state": FormaUiEmptyState; } }

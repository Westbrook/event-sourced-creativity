import { html, noChange, nothing } from "lit";
import { icon } from "../icons.ts";
import { FormaPresentationalElement } from "../presentational-element.ts";
import { emitFormaEvent, nextFormaId } from "./contracts.ts";
import "./conversation-composer.css";

/**
 * @tag forma-ui-conversation-composer
 * @summary Form-participating input with native validation and accessible descriptions.
 * @fires {CustomEvent<{ value: string }>} forma-input - The input value changed.
 * @fires {CustomEvent<{ value: string }>} forma-submit - The input value was committed.
 * @cssprop {<length>} --forma-control-min-size - Minimum input target size.
 * @cssprop {<color>} --forma-color-border-strong - Accessible input boundary.
 * @cssprop {<color>} --forma-focus-ring-color - Focus-ring color.
 * @cssprop {<length>} --forma-radius-medium - Control corner radius.
 */
export class FormaUiConversationComposer extends FormaPresentationalElement {
  static override properties = {
    label: { type: String },
    value: { type: String },
    placeholder: { type: String },
    submitLabel: { type: String, attribute: "submit-label" },
    fieldId: { type: String, attribute: "field-id" },
    inputClass: { type: String, attribute: "input-class" },
    buttonClass: { type: String, attribute: "button-class" },
    help: { type: String },
    rows: { type: Number },
    maxLength: { type: Number, attribute: "max-length" },
    disabled: { type: Boolean },
    submitDisabled: { type: Boolean, attribute: "submit-disabled" },
    busy: { type: Boolean },
    compact: { type: Boolean },
    showSubmitLabel: { type: Boolean, attribute: "show-submit-label" },
  };

  label = "";
  value = "";
  placeholder = "";
  submitLabel = "";
  fieldId = "";
  inputClass = "";
  buttonClass = "";
  help = "";
  rows = 1;
  maxLength = 1_200;
  disabled = false;
  submitDisabled = false;
  busy = false;
  compact = false;
  showSubmitLabel = false;
  #id = nextFormaId("conversation");
  #composing = false;

  #input(event: Event) {
    if (this.#composing || event instanceof InputEvent && event.isComposing) return;
    const value = (event.currentTarget as HTMLTextAreaElement).value;
    if (this.value === value) return;
    this.value = value;
    emitFormaEvent(this, "forma-input", { value });
  }

  #compositionEnd(event: CompositionEvent) {
    this.#composing = false;
    this.#input(event);
  }

  #notifySubmit() {
    const value = this.value.trim();
    if (!value || this.disabled || this.submitDisabled || this.busy || this.#composing) return false;
    emitFormaEvent(this, "forma-submit", { value });
    return true;
  }

  #keydown(event: KeyboardEvent) {
    if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey || event.isComposing || this.#composing) return;
    const submitter = this.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (!submitter || submitter.disabled || !submitter.form) return;
    event.preventDefault();
    if (this.#notifySubmit()) submitter.form.requestSubmit(submitter);
  }

  focusInput(options?: FocusOptions) {
    this.querySelector<HTMLTextAreaElement>("textarea")?.focus(options);
  }

  override render() {
    const fieldId = this.fieldId || this.#id;
    const submitLabel = this.submitLabel || this.i18n.t("assistant.send");
    return html`<div class=${`forma-conversation-composer${this.compact ? " forma-conversation-composer--compact" : ""}`}>
      <label class="sr-only" for=${fieldId}>${this.label || this.i18n.t("assistant.messageLabel")}</label>
      <textarea id=${fieldId} class=${`forma-conversation-input${this.inputClass ? ` ${this.inputClass}` : ""}`}
        rows=${Math.max(1, this.rows)} maxlength=${this.maxLength > 0 ? this.maxLength : nothing} dir="auto"
        aria-label=${this.label || this.i18n.t("assistant.messageLabel")}
        aria-describedby=${this.help ? `${fieldId}-help` : nothing}
        placeholder=${this.placeholder || nothing} .value=${this.#composing ? noChange : this.value}
        ?disabled=${this.disabled || this.busy}
        @input=${this.#input} @compositionstart=${() => { this.#composing = true; }}
        @compositionend=${this.#compositionEnd} @keydown=${this.#keydown}></textarea>
      <button type="submit" class=${`button primary forma-conversation-submit${this.buttonClass ? ` ${this.buttonClass}` : ""}`}
        aria-label=${submitLabel} ?disabled=${this.disabled || this.submitDisabled || this.busy || !this.value.trim()}
        @click=${() => { this.#notifySubmit(); }}>${this.showSubmitLabel ? html`<span>${submitLabel}</span>` : nothing}${icon("arrow")}</button>
    </div>${this.help ? html`<small id=${`${fieldId}-help`} class="forma-conversation-help">${this.help}</small>` : nothing}`;
  }
}

if (!customElements.get("forma-ui-conversation-composer")) customElements.define("forma-ui-conversation-composer", FormaUiConversationComposer);

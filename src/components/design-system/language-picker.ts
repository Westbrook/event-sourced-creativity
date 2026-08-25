import { FORMA_SUPPORTED_LOCALES } from "./language-options";
import "./language-picker.css";

export type FormaLanguagePickerOption = Readonly<{
  value: string;
  label: string;
  direction: "ltr" | "rtl";
}>;

const defaultOptions: ReadonlyArray<FormaLanguagePickerOption> = FORMA_SUPPORTED_LOCALES.map(({ locale, label, direction }) => ({ value: locale, label, direction }));

/**
 * Choose an available language by its own name using a visible translated label and a native select.
 * @tag forma-ui-language-picker
 * @summary Choose an available language by its own name using a visible translated label and a native select.
 * @attr {string} label
 * @attr {string} value
 * @attr {boolean} disabled
 * @attr {boolean} busy
 * @fires {CustomEvent<{ value: string }>} forma-change - A new option was selected.
 * @cssprop {<length>} --forma-control-min-size - Native select target size.
 * @cssprop {<color>} --forma-color-border-strong - Accessible select boundary.
 */
export class FormaUiLanguagePicker extends HTMLElement {
  static observedAttributes = ["label", "value", "disabled", "busy"];

  #options: ReadonlyArray<FormaLanguagePickerOption> = defaultOptions;
  #copy?: HTMLSpanElement;
  #control?: HTMLSelectElement;

  get label() { return this.getAttribute("label") ?? ""; }
  set label(value: string) { this.setAttribute("label", value); }

  get value() { return this.getAttribute("value") ?? ""; }
  set value(value: string) { this.setAttribute("value", value); }

  get disabled() { return this.hasAttribute("disabled"); }
  set disabled(value: boolean) { this.toggleAttribute("disabled", value); }

  get busy() { return this.hasAttribute("busy"); }
  set busy(value: boolean) { this.toggleAttribute("busy", value); }

  get options() { return this.#options; }
  set options(value: ReadonlyArray<FormaLanguagePickerOption>) {
    this.#options = value;
    this.#syncOptions();
    this.#sync();
  }

  connectedCallback() {
    if (this.#control) { this.#sync(); return; }

    const label = document.createElement("label");
    label.className = "locale-switcher";
    this.#copy = document.createElement("span");
    this.#control = document.createElement("select");
    this.#control.addEventListener("change", this.#requested);
    label.append(this.#copy, this.#control);
    this.replaceChildren(label);
    this.#syncOptions();
    this.#sync();
  }

  attributeChangedCallback() { this.#sync(); }

  #syncOptions() {
    if (!this.#control) return;
    this.#control.replaceChildren(...this.#options.map((choice) => {
      const option = document.createElement("option");
      option.value = choice.value;
      option.lang = choice.value;
      option.dir = choice.direction;
      option.textContent = choice.label;
      return option;
    }));
  }

  #sync() {
    if (!this.#control || !this.#copy) return;
    this.#copy.textContent = this.label;
    this.#control.value = this.value;
    this.#control.disabled = this.disabled || this.busy;
    if (this.busy) this.#control.setAttribute("aria-busy", "true");
    else this.#control.removeAttribute("aria-busy");
  }

  #requested = (event: Event) => {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (this.disabled || this.busy || !this.#options.some((choice) => choice.value === value)) {
      this.#sync();
      return;
    }
    this.value = value;
    this.dispatchEvent(new CustomEvent<{ value: string }>("forma-change", {
      bubbles: true,
      composed: true,
      detail: { value },
    }));
  };
}

if (!customElements.get("forma-ui-language-picker")) customElements.define("forma-ui-language-picker", FormaUiLanguagePicker);

declare global {
  interface HTMLElementTagNameMap {
    "forma-ui-language-picker": FormaUiLanguagePicker;
  }
}

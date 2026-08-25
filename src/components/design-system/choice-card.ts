import { html, nothing } from "lit";
import { icon, type FormaIconName } from "../icons";
import { FormaPresentationalElement } from "../presentational-element";
import { defineFormaElements, emitFormaEvent } from "./contracts";

/**
 * Present an actionable choice with an icon, supporting context, and a stable value.
 * @tag forma-ui-choice-card
 * @summary Present an actionable choice with an icon, supporting context, and a stable value.
 * @fires {CustomEvent<{ value: string }>} forma-action - A non-disabled action was activated.
 * @cssprop {<length>} --forma-control-min-size - Minimum interactive target size.
 * @cssprop {<color>} --forma-color-accent - Accent and focus color.
 * @cssprop {<length>} --forma-radius-medium - Control corner radius.
 */
export class FormaUiChoiceCard extends FormaPresentationalElement {
  static properties = {
    label: { type: String },
    detail: { type: String },
    value: { type: String },
    iconName: { type: String, attribute: "icon-name" },
    selected: { type: Boolean },
    disabled: { type: Boolean },
    compact: { type: Boolean },
  };

  label = "";
  detail = "";
  value = "";
  iconName: FormaIconName | "" = "";
  selected?: boolean;
  disabled = false;
  compact = false;

  #choose() {
    if (!this.disabled) emitFormaEvent(this, "forma-action", { value: this.value });
  }

  override render() {
    return html`<button
      type="button"
      class=${`ui-choice-card${this.compact ? " ui-choice-card--compact" : ""}${this.selected ? " ui-choice-card--selected" : ""}`}
      ?disabled=${this.disabled}
      aria-pressed=${typeof this.selected === "boolean" ? String(this.selected) : nothing}
      data-choice-value=${this.value || nothing}
      @click=${this.#choose}
    >
      ${this.iconName ? html`<span class="ui-choice-card-icon" aria-hidden="true">${icon(this.iconName)}</span>` : nothing}
      <span class="ui-choice-card-copy"><strong>${this.label}</strong>${this.detail ? html`<small>${this.detail}</small>` : nothing}</span>
    </button>`;
  }
}

defineFormaElements([["forma-ui-choice-card", FormaUiChoiceCard]]);

declare global {
  interface HTMLElementTagNameMap {
    "forma-ui-choice-card": FormaUiChoiceCard;
  }
}

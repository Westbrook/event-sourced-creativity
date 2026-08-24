import { html, nothing } from "lit";
import { icon } from "../icons";
import { ensureModalDialog } from "../modal-dialog";
import { FormaPresentationalElement } from "../presentational-element";
import { copyInterfaceText } from "./clipboard";
import { defineFormaElements, emitFormaEvent, nextFormaId, type FormaOption, type FormaTone } from "./contracts";
import { FormaSlottedElement } from "./slotted-element";

/**
 * @tag forma-ui-notice
 * @summary Composable announcement with contrasted content and independently operable recovery actions.
 * @slot - Rich announcement content; the detail attribute remains additive.
 * @slot actions - Keyboard-operable recovery actions outside the announcement live region.
 * @slot heading - Visible announcement heading with a concise, meaningful outcome.
 * @slot leading - Leading icon or meaningful contextual content.
 * @fires {CustomEvent<{ value: string }>} forma-dismiss - The notice was dismissed.
 * @cssprop {<color>} --forma-color-positive-text - Success-message foreground.
 * @cssprop {<color>} --forma-color-warning-text - Warning-message foreground.
 * @cssprop {<color>} --forma-color-danger-text - Error-message foreground.
 */
export class FormaUiNotice extends FormaSlottedElement {
  static properties = { heading: { type: String }, detail: { type: String }, value: { type: String }, tone: { type: String }, dismissible: { type: Boolean }, live: { type: Boolean } };
  heading = ""; detail = ""; value = ""; tone: FormaTone = "neutral"; dismissible = false; live = false;
  override render() {
    return html`<aside class=${`ui-notice ui-notice--${this.tone}`}>
      <span class="ui-notice-symbol"><slot name="leading"><span aria-hidden="true">${icon(this.tone === "positive" ? "check" : this.tone === "warning" || this.tone === "danger" ? "warning" : "info")}</span></slot></span>
      <div class="ui-notice-copy" role=${this.live ? this.tone === "danger" ? "alert" : "status" : nothing}>
        <slot name="heading">${this.heading ? html`<strong>${this.heading}</strong>` : nothing}</slot>
        ${this.detail ? html`<p>${this.detail}</p>` : nothing}
        <slot></slot>
      </div>
      <div class="ui-notice-actions"><slot name="actions"></slot>${this.dismissible ? html`<button type="button" class="icon-button" aria-label=${this.i18n.t("notice.dismiss")} @click=${() => emitFormaEvent(this, "forma-dismiss", { value: this.value })}>${icon("close")}</button>` : nothing}</div>
    </aside>`;
  }
}

/**
 * @tag forma-ui-disclosure
 * @summary Native disclosure with authored summary text, rich content, and browser-owned keyboard behavior.
 * @slot - Rich disclosure content; the detail attribute remains additive.
 * @slot summary - Text or noninteractive phrasing content; never include a button, link, or form control.
 * @fires {CustomEvent<{ open: boolean }>} forma-toggle - The disclosure opened or closed.
 * @cssprop {<length>} --forma-control-min-size - Minimum disclosure-summary target.
 * @cssprop {<length>} --forma-row-inset-inline - Scoped component spacing.
 */
export class FormaUiDisclosure extends FormaSlottedElement {
  static properties = { label: { type: String }, detail: { type: String }, open: { type: Boolean }, group: { type: String } };
  label = ""; detail = ""; open = false; group = "";
  #toggle(event: Event) {
    const open = (event.target as HTMLDetailsElement).open;
    if (open && this.group) {
      const root = this.getRootNode() as ParentNode;
      for (const peer of root.querySelectorAll<FormaUiDisclosure>("forma-ui-disclosure")) {
        if (peer !== this && peer.group === this.group) {
          const details = peer.shadowRoot?.querySelector("details");
          if (details?.open) details.open = false;
        }
      }
    }
    if (open === this.open) return;
    this.open = open;
    emitFormaEvent(this, "forma-toggle", { open });
  }
  override render() {
    return html`<details class="ui-disclosure" name=${this.group || nothing} ?open=${this.open} @toggle=${this.#toggle}>
      <summary><slot name="summary">${this.label || this.i18n.t("disclosure.more")}</slot></summary>
      ${this.detail ? html`<p>${this.detail}</p>` : nothing}
      <slot></slot>
    </details>`;
  }
}

/**
 * @tag forma-ui-popover
 * @summary Native auto-dismiss popover containing ordinary focusable action buttons.
 * @fires {CustomEvent<{ open: boolean }>} forma-toggle - The browser opened or closed the popover.
 * @fires {CustomEvent<{ value: string }>} forma-action - A popover action was requested.
 * @cssprop {<color>} --forma-color-surface - Popover panel background.
 * @cssprop {<color>} --forma-color-border-strong - Accessible popover boundary.
 */
export class FormaUiPopover extends FormaPresentationalElement {
  static properties = { label: { type: String }, heading: { type: String }, detail: { type: String }, actions: { attribute: false } };
  label = ""; heading = ""; detail = ""; actions: FormaOption[] = []; #id = nextFormaId("popover"); #open = false;
  #toggle(event: ToggleEvent) { this.#open = event.newState === "open"; emitFormaEvent(this, "forma-toggle", { open: this.#open }); this.requestUpdate(); }
  #action(value: string) { emitFormaEvent(this, "forma-action", { value }); this.querySelector<HTMLElement>("[popover]")?.hidePopover?.(); this.querySelector<HTMLButtonElement>(".ui-popover-trigger")?.focus(); }
  override render() { const label = this.label || this.i18n.t("popover.open"); return html`<div class="ui-popover"><button type="button" class="button secondary ui-popover-trigger" popovertarget=${this.#id} aria-controls=${this.#id} aria-expanded=${String(this.#open)}>${label}</button><section id=${this.#id} class="ui-popover-panel" popover="auto" aria-label=${this.heading || label} @toggle=${this.#toggle}>${this.heading ? html`<h3>${this.heading}</h3>` : nothing}${this.detail ? html`<p>${this.detail}</p>` : nothing}${this.actions.map((action) => html`<button type="button" ?disabled=${action.disabled ?? false} @click=${() => this.#action(action.value)}>${action.label}</button>`)}</section></div>`; }
}

/**
 * @tag forma-ui-dialog
 * @summary Native modal dialog with browser-owned focus, inert background, and Escape dismissal.
 * @fires {CustomEvent<{ open: boolean }>} forma-toggle - The dialog opened or closed.
 * @fires {CustomEvent<{ value: string }>} forma-confirm - The explicit confirmation action was requested.
 * @fires {CustomEvent<{ value: string }>} forma-close - The dialog was dismissed.
 * @cssprop {<color>} --forma-color-surface - Modal surface background.
 * @cssprop {<length>} --forma-radius-large - Modal corner radius.
 */
export class FormaUiDialog extends FormaPresentationalElement {
  static properties = { heading: { type: String }, detail: { type: String }, trigger: { type: String }, confirm: { type: String }, cancel: { type: String }, open: { type: Boolean } };
  heading = ""; detail = ""; trigger?: string; confirm = ""; cancel = ""; open = false; #id = nextFormaId("dialog");
  protected override updated() { const dialog = this.querySelector<HTMLDialogElement>("dialog"); if (this.open && dialog && !dialog.open) { dialog.returnValue = ""; ensureModalDialog(dialog); } else if (!this.open && dialog?.open) dialog.close("cancel"); }
  #show() { this.open = true; emitFormaEvent(this, "forma-toggle", { open: true }); }
  #close(value: string) { const dialog = this.querySelector<HTMLDialogElement>("dialog"); if (dialog?.open) dialog.close(value); else { this.open = false; emitFormaEvent(this, "forma-close", { value }); } }
  #closed(event: Event) { const value = (event.target as HTMLDialogElement).returnValue || "cancel"; this.open = false; emitFormaEvent(this, "forma-toggle", { open: false }); emitFormaEvent(this, value === "confirm" ? "forma-confirm" : "forma-close", { value }); }
  override render() { const trigger = this.trigger == null ? this.i18n.t("dialog.open") : this.trigger; return html`${trigger ? html`<button type="button" class="button secondary" @click=${this.#show}>${trigger}</button>` : nothing}<dialog class="ui-dialog modal" aria-labelledby=${`${this.#id}-heading`} @close=${this.#closed} @click=${(event: MouseEvent) => { if (event.target === event.currentTarget) this.#close("cancel"); }}><section class="ui-dialog-card"><header><h2 id=${`${this.#id}-heading`}>${this.heading || this.i18n.t("dialog.heading")}</h2><button type="button" class="icon-button" aria-label=${this.i18n.t("dialog.close")} @click=${() => this.#close("cancel")}>${icon("close")}</button></header>${this.detail ? html`<p>${this.detail}</p>` : nothing}<footer><button type="button" class="button ghost" @click=${() => this.#close("cancel")}>${this.cancel || this.i18n.t("dialog.cancel")}</button><button type="button" class="button primary" @click=${() => this.#close("confirm")}>${this.confirm || this.i18n.t("dialog.confirm")}</button></footer></section></dialog>`; }
}

/**
 * @tag forma-ui-copy-button
 * @summary Explicit copy action with persistent, polite success or failure feedback.
 * @fires {CustomEvent<{ value: string; success: boolean }>} forma-copy - The clipboard request completed.
 * @cssprop {<length>} --forma-control-min-size - Minimum copy-action target size.
 */
export class FormaUiCopyButton extends FormaPresentationalElement {
  static properties = { label: { type: String }, value: { type: String } };
  label = ""; value = ""; #result: "idle" | "success" | "failure" = "idle";
  async #copy() { const success = await copyInterfaceText(this.value); this.#result = success ? "success" : "failure"; emitFormaEvent(this, "forma-copy", { value: this.value, success }); this.requestUpdate(); }
  override render() { return html`<span class="ui-copy"><button type="button" class="button secondary" @click=${this.#copy}>${this.label || this.i18n.t("clipboard.copy")}</button><span class="ui-copy-status" role="status" aria-live="polite" aria-atomic="true">${this.#result === "idle" ? "" : this.i18n.t("clipboard." + this.#result)}</span></span>`; }
}

const definitions = [
  ["forma-ui-notice", FormaUiNotice], ["forma-ui-disclosure", FormaUiDisclosure], ["forma-ui-popover", FormaUiPopover],
  ["forma-ui-dialog", FormaUiDialog], ["forma-ui-copy-button", FormaUiCopyButton],
] as const;
defineFormaElements(definitions);

declare global {
  interface HTMLElementTagNameMap {
    "forma-ui-notice": FormaUiNotice; "forma-ui-disclosure": FormaUiDisclosure; "forma-ui-popover": FormaUiPopover;
    "forma-ui-dialog": FormaUiDialog; "forma-ui-copy-button": FormaUiCopyButton;
  }
}

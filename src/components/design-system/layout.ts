import { html, nothing } from "lit";
import { icon, type FormaIconName } from "../icons";
import { FormaPresentationalElement } from "../presentational-element";
import { defineFormaElements, emitFormaEvent, type FormaTone } from "./contracts";
import { FormaSlottedElement } from "./slotted-element";

/**
 * @tag forma-ui-stack
 * @summary Vertical light-DOM composition that preserves every authored child.
 * @cssprop {<length>} --forma-stack-gap - Vertical space between authored children.
 */
export class FormaUiStack extends FormaPresentationalElement {
  static properties = { gap: { type: String, reflect: true }, alignment: { type: String, reflect: true } };
  gap = "medium"; alignment = "stretch";
  override render() { return nothing; }
}

/**
 * @tag forma-ui-cluster
 * @summary Wrapping horizontal light-DOM composition that preserves authored children.
 * @cssprop {<length>} --forma-cluster-gap - Space between adjacent authored children.
 */
export class FormaUiCluster extends FormaPresentationalElement {
  static properties = { gap: { type: String, reflect: true }, alignment: { type: String, reflect: true } };
  gap = "medium"; alignment = "center";
  override render() { return nothing; }
}

/**
 * @tag forma-ui-surface
 * @summary Scoped, composable light-DOM surface that preserves authored child content.
 * @cssprop {<color>} --forma-color-surface - Surface background.
 * @cssprop {<color>} --forma-color-border - Optional boundary color.
 * @cssprop {<length>} --forma-radius-medium - Surface corner radius.
 */
export class FormaUiSurface extends FormaPresentationalElement {
  static properties = { tone: { type: String, reflect: true }, bordered: { type: Boolean, reflect: true }, padded: { type: Boolean, reflect: true } };
  tone: FormaTone = "neutral"; bordered = false; padded = false;
  override render() { return nothing; }
}

/**
 * @tag forma-ui-card
 * @summary Composable article with authored media, semantic heading, rich content, and actions.
 * @slot - Rich article content; the detail attribute remains additive for compatibility.
 * @slot actions - Keyboard-operable follow-up controls with at least 44px targets.
 * @slot eyebrow - Supporting introductory or categorization content.
 * @slot heading - One semantic h1–h6 element appropriate to its document outline.
 * @slot media - Meaningful visual content; images require useful alternative text.
 * @fires {CustomEvent<{ value: string }>} forma-action - The card follow-up was requested.
 * @cssprop {<color>} --forma-color-surface - Article background.
 * @cssprop {<length>} --forma-space-5 - Article interior spacing.
 * @cssprop {<length>} --forma-heading-size - Scoped article-heading size.
 */
export class FormaUiCard extends FormaSlottedElement {
  static properties = { heading: { type: String }, detail: { type: String }, eyebrow: { type: String }, action: { type: String }, value: { type: String }, level: { type: Number } };
  heading = ""; detail = ""; eyebrow = ""; action = ""; value = ""; level = 3;
  #heading() { switch (Math.max(1, Math.min(6, Math.trunc(this.level)))) { case 1: return html`<h1>${this.heading}</h1>`; case 2: return html`<h2>${this.heading}</h2>`; case 4: return html`<h4>${this.heading}</h4>`; case 5: return html`<h5>${this.heading}</h5>`; case 6: return html`<h6>${this.heading}</h6>`; default: return html`<h3>${this.heading}</h3>`; } }
  override render() {
    return html`<article class="ui-card">
      <slot name="media"></slot>
      <slot name="eyebrow">${this.eyebrow ? html`<span class="ui-card-eyebrow">${this.eyebrow}</span>` : nothing}</slot>
      <slot name="heading">${this.heading ? this.#heading() : nothing}</slot>
      ${this.detail ? html`<p>${this.detail}</p>` : nothing}
      <slot></slot>
      <div class="ui-card-actions"><slot name="actions">${this.action ? html`<button type="button" class="button secondary" @click=${() => emitFormaEvent(this, "forma-action", { value: this.value })}>${this.action}</button>` : nothing}</slot></div>
    </article>`;
  }
}

/**
 * @tag forma-ui-list-item
 * @summary Composable item row with leading content, a heading, details, and trailing controls.
 * @slot - Rich supporting item content; the detail attribute remains additive.
 * @slot heading - Visible item name, using strong text or a context-appropriate semantic heading.
 * @slot leading - Leading icon, avatar, image, or other meaningful contextual content.
 * @slot trailing - Keyboard-operable actions, status, or other trailing content.
 * @fires {CustomEvent<{ value: string }>} forma-action - The row's explicit action was requested.
 * @cssprop {<length>} --forma-control-min-size - Minimum row-action target size.
 */
export class FormaUiListItem extends FormaSlottedElement {
  static properties = { label: { type: String }, detail: { type: String }, action: { type: String }, value: { type: String }, iconName: { type: String, attribute: "icon-name" } };
  label = ""; detail = ""; action = ""; value = ""; iconName: FormaIconName | "" = "";
  override render() {
    return html`<div class="ui-list-item">
      <slot name="leading">${this.iconName ? html`<span aria-hidden="true">${icon(this.iconName)}</span>` : nothing}</slot>
      <div class="ui-list-item-copy">
        <slot name="heading">${this.label ? html`<strong>${this.label}</strong>` : nothing}</slot>
        ${this.detail ? html`<span class="ui-list-item-detail">${this.detail}</span>` : nothing}
        <slot></slot>
      </div>
      <div class="ui-list-item-trailing"><slot name="trailing">${this.action ? html`<button type="button" class="button ghost" @click=${() => emitFormaEvent(this, "forma-action", { value: this.value })}>${this.action}</button>` : nothing}</slot></div>
    </div>`;
  }
}

/**
 * @tag forma-ui-page-header
 * @summary Composable page introduction with authored semantic heading, context, and actions.
 * @slot - Rich supporting page content; the detail attribute remains additive.
 * @slot actions - Keyboard-operable page actions with accessible names and 44px targets.
 * @slot eyebrow - Supporting introduction, category, or current page context.
 * @slot heading - One semantic h1–h6 element appropriate to the surrounding document.
 * @fires {CustomEvent<{ value: string }>} forma-action - The page's primary action was requested.
 * @cssprop {<color>} --forma-color-text - Heading foreground.
 * @cssprop {<color>} --forma-color-text-muted - Supporting-copy foreground.
 * @cssprop {<length>} --forma-heading-size - Scoped page-heading size.
 */
export class FormaUiPageHeader extends FormaSlottedElement {
  static properties = { heading: { type: String }, detail: { type: String }, eyebrow: { type: String }, action: { type: String }, value: { type: String }, level: { type: Number } };
  heading = ""; detail = ""; eyebrow = ""; action = ""; value = ""; level = 1;
  #heading() { switch (Math.max(1, Math.min(6, Math.trunc(this.level)))) { case 1: return html`<h1>${this.heading}</h1>`; case 2: return html`<h2>${this.heading}</h2>`; case 3: return html`<h3>${this.heading}</h3>`; case 4: return html`<h4>${this.heading}</h4>`; case 5: return html`<h5>${this.heading}</h5>`; default: return html`<h6>${this.heading}</h6>`; } }
  override render() {
    return html`<header class="ui-page-header">
      <div class="ui-page-header-copy">
        <slot name="eyebrow">${this.eyebrow ? html`<span class="ui-page-header-eyebrow">${this.eyebrow}</span>` : nothing}</slot>
        <slot name="heading">${this.heading ? this.#heading() : nothing}</slot>
        ${this.detail ? html`<p>${this.detail}</p>` : nothing}
        <slot></slot>
      </div>
      <div class="ui-page-header-actions"><slot name="actions">${this.action ? html`<button type="button" class="button primary" @click=${() => emitFormaEvent(this, "forma-action", { value: this.value })}>${this.action}</button>` : nothing}</slot></div>
    </header>`;
  }
}

const definitions = [
  ["forma-ui-stack", FormaUiStack], ["forma-ui-cluster", FormaUiCluster], ["forma-ui-surface", FormaUiSurface],
  ["forma-ui-card", FormaUiCard], ["forma-ui-list-item", FormaUiListItem], ["forma-ui-page-header", FormaUiPageHeader],
] as const;
defineFormaElements(definitions);

declare global {
  interface HTMLElementTagNameMap {
    "forma-ui-stack": FormaUiStack; "forma-ui-cluster": FormaUiCluster; "forma-ui-surface": FormaUiSurface;
    "forma-ui-card": FormaUiCard; "forma-ui-list-item": FormaUiListItem; "forma-ui-page-header": FormaUiPageHeader;
  }
}

import { html, nothing } from "lit";
import { icon } from "../icons";
import { FormaPresentationalElement } from "../presentational-element";
import { defineFormaElements, emitFormaEvent, type FormaButtonVariant, type FormaSize, type FormaTone } from "./contracts";

const iconActionMessageKeys: Record<string, string> = { dots: "action.more", close: "action.close", search: "field.search", save: "action.save", open: "action.open" };

/**
 * @tag forma-ui-icon
 * @summary Render the shared visual vocabulary, decorative by default.
 * @cssprop {<color>} --forma-color-text - Icon foreground.
 * @cssprop {<length>} --forma-icon-size - Icon dimensions.
 */
export class FormaUiIcon extends FormaPresentationalElement {
  static properties = { name: { type: String }, label: { type: String }, size: { type: String } };
  name = "spark"; label = ""; size: FormaSize = "medium";
  override render() { return html`<span class=${`ui-icon ui-icon--${this.size}`} role=${this.label ? "img" : nothing} aria-label=${this.label || nothing} aria-hidden=${this.label ? nothing : "true"}>${icon(this.name)}</span>`; }
}

/**
 * @tag forma-ui-icon-button
 * @summary Icon-only native button with a mandatory spoken label and 44px target.
 * @fires {CustomEvent<{ value: string }>} forma-press - The named action was requested.
 * @cssprop {<length>} --forma-control-min-size - Minimum width and height.
 * @cssprop {<color>} --forma-color-accent - Focus-ring color.
 */
export class FormaUiIconButton extends FormaPresentationalElement {
  static properties = { label: { type: String }, iconName: { type: String, attribute: "icon-name" }, variant: { type: String }, disabled: { type: Boolean }, pressed: { type: Boolean }, expanded: { type: Boolean }, controls: { type: String }, value: { type: String } };
  label = ""; iconName = "dots"; variant: FormaButtonVariant = "ghost"; disabled = false; pressed?: boolean; expanded?: boolean; controls = ""; value = "";
  #press() { if (!this.disabled) emitFormaEvent(this, "forma-press", { value: this.value }); }
  override render() { const name = this.label || (iconActionMessageKeys[this.iconName] ? this.i18n.t(iconActionMessageKeys[this.iconName]) : this.iconName.replace(/[-_]+/g, " ").replace(/^./, (letter) => letter.toLocaleUpperCase(this.i18n.locale)) || this.i18n.t("action.default")); return html`<button type="button" class=${`icon-button ui-icon-button ui-icon-button--${this.variant}`} aria-label=${name} aria-pressed=${typeof this.pressed === "boolean" ? String(this.pressed) : nothing} aria-expanded=${typeof this.expanded === "boolean" ? String(this.expanded) : nothing} aria-controls=${this.controls || nothing} ?disabled=${this.disabled} @click=${this.#press}><span aria-hidden="true">${icon(this.iconName)}</span></button>`; }
}

/**
 * @tag forma-ui-avatar
 * @summary Named person or workspace image with readable initials fallback.
 * @cssprop {<color>} --forma-color-surface-subtle - Avatar background.
 * @cssprop {<color>} --forma-color-text - Initials foreground.
 */
export class FormaUiAvatar extends FormaPresentationalElement {
  static properties = { name: { type: String }, initials: { type: String }, src: { type: String }, size: { type: String } };
  name = ""; initials = ""; src = ""; size: FormaSize = "medium";
  override render() { const letters = this.src ? "" : this.initials || this.name.normalize("NFC").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => this.i18n.firstGrapheme(part)).join("").toLocaleUpperCase(this.i18n.locale); return html`<span class=${`ui-avatar ui-avatar--${this.size}`} role=${this.src ? nothing : "img"} aria-label=${this.src ? nothing : this.name || this.i18n.t("avatar.unnamed")}>${this.src ? html`<img src=${this.src} alt=${this.name || this.i18n.t("avatar.person")} loading="lazy" decoding="async">` : letters || "?"}</span>`; }
}

/**
 * @tag forma-ui-chip
 * @summary Optional pressed-state or removable textual filter chip.
 * @fires {CustomEvent<{ value: string; selected: boolean }>} forma-change - The chip selection changed.
 * @fires {CustomEvent<{ value: string }>} forma-remove - The named chip was removed.
 * @cssprop {<color>} --forma-color-accent-text - Selected chip foreground.
 * @cssprop {<length>} --forma-control-min-size - Interactive chip target size.
 */
export class FormaUiChip extends FormaPresentationalElement {
  static properties = { label: { type: String }, value: { type: String }, tone: { type: String }, selected: { type: Boolean }, removable: { type: Boolean }, disabled: { type: Boolean } };
  label = ""; value = ""; tone: FormaTone = "neutral"; selected = false; removable = false; disabled = false;
  #activate() { if (this.disabled) return; if (this.removable) emitFormaEvent(this, "forma-remove", { value: this.value }); else { this.selected = !this.selected; emitFormaEvent(this, "forma-change", { value: this.value, selected: this.selected }); } }
  override render() { const label = this.label || this.i18n.t("filter.label"); return html`<button type="button" class=${`ui-chip ui-chip--${this.tone}${this.selected ? " is-selected" : ""}`} ?disabled=${this.disabled} aria-pressed=${this.removable ? nothing : String(this.selected)} aria-label=${this.removable ? this.i18n.t("filter.remove", "", { label }) : nothing} @click=${this.#activate}><span>${label}</span>${this.removable ? html`<span aria-hidden="true">${icon("close")}</span>` : nothing}</button>`; }
}

/**
 * @tag forma-ui-status
 * @summary Textual status with an icon; meaning never depends on color alone.
 * @cssprop {<color>} --forma-color-positive-text - Positive status text.
 * @cssprop {<color>} --forma-color-warning-text - Warning status text.
 * @cssprop {<color>} --forma-color-danger-text - Failure status text.
 */
export class FormaUiStatus extends FormaPresentationalElement {
  static properties = { label: { type: String }, tone: { type: String }, iconName: { type: String, attribute: "icon-name" }, live: { type: Boolean } };
  label = ""; tone: FormaTone = "neutral"; iconName = ""; live = false;
  override render() { return html`<span class=${`ui-status ui-status--${this.tone}`} role=${this.live ? "status" : nothing} aria-live=${this.live ? "polite" : nothing}><span aria-hidden="true">${icon(this.iconName || (this.tone === "positive" ? "check" : this.tone === "warning" || this.tone === "danger" ? "warning" : "info"))}</span>${this.label}</span>`; }
}

/**
 * @tag forma-ui-spinner
 * @summary Polite, reduced-motion-aware loading announcement.
 * @cssprop {<color>} --forma-color-accent - Loading indicator foreground.
 */
export class FormaUiSpinner extends FormaPresentationalElement {
  static properties = { label: { type: String }, size: { type: String } };
  label = ""; size: FormaSize = "medium";
  override render() { return html`<span class=${`ui-spinner ui-spinner--${this.size}`} role="status" aria-live="polite"><span class="ui-spinner-mark" aria-hidden="true"></span><span class="sr-only">${this.label || this.i18n.t("status.loading")}</span></span>`; }
}

/**
 * @tag forma-ui-progress
 * @summary Labelled native progress control with determinate and indeterminate states.
 * @cssprop {<color>} --forma-color-accent - Progress indicator color.
 * @cssprop {<color>} --forma-color-surface-subtle - Progress track color.
 */
export class FormaUiProgress extends FormaPresentationalElement {
  static properties = { label: { type: String }, value: { type: Number }, max: { type: Number }, indeterminate: { type: Boolean }, showValue: { type: Boolean, attribute: "show-value" } };
  label = ""; value = 0; max = 100; indeterminate = false; showValue = false;
  override render() { const maximum = Number.isFinite(this.max) ? Math.max(1, this.max) : 100; const bounded = Number.isFinite(this.value) ? Math.max(0, Math.min(maximum, this.value)) : 0; return html`<label class="ui-progress"><span>${this.label || this.i18n.t("status.progress")}${this.showValue && !this.indeterminate ? html`<span aria-hidden="true">${this.i18n.number(bounded / maximum, { style: "percent", maximumFractionDigits: 0 })}</span>` : nothing}</span><progress max=${maximum} value=${this.indeterminate ? nothing : bounded}></progress></label>`; }
}

/**
 * @tag forma-ui-kbd
 * @summary Semantic keyboard shortcut or key-cap label.
 * @cssprop {<color>} --forma-color-border-strong - Key-cap boundary.
 * @cssprop {<font-family>} --forma-font-family-mono - Shortcut typeface.
 */
export class FormaUiKbd extends FormaPresentationalElement {
  static properties = { keys: { type: String }, label: { type: String } };
  keys = ""; label = "";
  override render() { return html`<kbd class="ui-kbd" aria-label=${this.label || nothing}>${this.keys}</kbd>`; }
}

/**
 * @tag forma-ui-divider
 * @summary Native thematic break with an optional visible label.
 * @cssprop {<color>} --forma-color-border - Divider line color.
 */
export class FormaUiDivider extends FormaPresentationalElement {
  static properties = { label: { type: String }, vertical: { type: Boolean } };
  label = ""; vertical = false;
  override render() { return this.label ? html`<div class="ui-divider ui-divider--labelled" role="separator" aria-label=${this.label}><span>${this.label}</span></div>` : this.vertical ? html`<div class="ui-divider ui-divider--vertical" role="separator" aria-orientation="vertical"></div>` : html`<hr class="ui-divider">`; }
}

/**
 * @tag forma-ui-skeleton
 * @summary Decorative loading placeholder hidden from assistive technology.
 * @cssprop {<color>} --forma-color-surface-subtle - Placeholder background.
 * @cssprop {<length>} --forma-radius-small - Placeholder corner radius.
 */
export class FormaUiSkeleton extends FormaPresentationalElement {
  static properties = { lines: { type: Number }, rounded: { type: Boolean } };
  lines = 1; rounded = false;
  override render() { return html`<span class=${`ui-skeleton${this.rounded ? " ui-skeleton--rounded" : ""}`} aria-hidden="true">${Array.from({ length: Math.max(1, Math.min(8, this.lines)) }, () => html`<span></span>`)}</span>`; }
}

/**
 * @tag forma-ui-theme
 * @summary Non-rendering inherited token scope that preserves all authored child nodes.
 * @cssprop {<color>} --forma-color-canvas - User-preference-reactive application canvas.
 * @cssprop {<color>} --forma-color-surface - Scoped component surface.
 * @cssprop {<color>} --forma-color-surface-subtle - Quiet secondary component surface.
 * @cssprop {<color>} --forma-color-text - Primary high-contrast component foreground.
 * @cssprop {<color>} --forma-color-text-muted - Accessible supporting-copy foreground.
 * @cssprop {<color>} --forma-color-border - Decorative component boundary.
 * @cssprop {<color>} --forma-color-border-strong - At-least-3:1 interactive boundary.
 * @cssprop {<color>} --forma-color-accent - Scoped component accent.
 * @cssprop {<color>} --forma-color-accent-subtle - Accessible selected-state background.
 * @cssprop {<color>} --forma-color-accent-text - At-least-7:1 selected-state foreground.
 * @cssprop {<color>} --forma-color-positive - Decorative positive-state color.
 * @cssprop {<color>} --forma-color-positive-text - At-least-7:1 positive-state foreground.
 * @cssprop {<color>} --forma-color-warning - Decorative warning-state color.
 * @cssprop {<color>} --forma-color-warning-text - At-least-7:1 warning-state foreground.
 * @cssprop {<color>} --forma-color-danger - Decorative error-state color.
 * @cssprop {<color>} --forma-color-danger-text - At-least-7:1 error-state foreground.
 * @cssprop {<color>} --forma-color-on-strong - Foreground on strong neutral surfaces.
 * @cssprop {<color>} --forma-color-on-accent - Foreground on filled accent surfaces.
 * @cssprop {<font-family>} --forma-font-family - Shared component typeface.
 * @cssprop {<font-family>} --forma-font-family-mono - Code and keyboard-shortcut typeface.
 * @cssprop {<length>} --forma-heading-letter-spacing - Script-aware heading tracking.
 * @cssprop {<number>} --forma-heading-line-height - Script-aware minimum heading line height.
 * @cssprop {<number>} --forma-body-line-height - Comfortable, script-aware body line height.
 * @cssprop {<length>} --forma-font-size-body - Browser-scaled component body text.
 * @cssprop {<length>} --forma-font-size-supporting - Readable labels and supporting copy.
 * @cssprop {<length>} --forma-space-1 - First inherited spacing step.
 * @cssprop {<length>} --forma-space-2 - Second inherited spacing step.
 * @cssprop {<length>} --forma-radius-medium - Scoped component corner radius.
 * @cssprop {<length>} --forma-space-3 - Scoped component spacing.
 * @cssprop {<length>} --forma-space-4 - Fourth inherited spacing step.
 * @cssprop {<length>} --forma-space-5 - Fifth inherited spacing step.
 * @cssprop {<length>} --forma-space-6 - Sixth inherited spacing step.
 * @cssprop {<length>} --forma-space-8 - Eighth inherited spacing step.
 * @cssprop {<length>} --forma-radius-small - Compact component corner radius.
 * @cssprop {<length>} --forma-radius-large - Modal and large-surface corner radius.
 * @cssprop {<length>} --forma-control-min-size - Minimum 44px interaction target.
 * @cssprop {<length>} --forma-focus-ring-width - Visible, user-customizable focus width.
 * @cssprop {<color>} --forma-focus-ring-color - Visible, high-contrast focus color.
 * @cssprop {<time>} --forma-duration-fast - Reduced-motion-aware short transition duration.
 * @cssprop {<time>} --forma-duration-normal - Reduced-motion-aware normal transition duration.
 * @cssprop {<easing-function>} --forma-ease-standard - Shared easing curve.
 */
export class FormaUiTheme extends HTMLElement {
  static observedAttributes = ["density", "radius"];
  get density() { return this.getAttribute("density") || "comfortable"; }
  set density(value: string) { this.setAttribute("density", value); }
  get radius() { return this.getAttribute("radius") || "default"; }
  set radius(value: string) { this.setAttribute("radius", value); }
}

const definitions = [
  ["forma-ui-icon", FormaUiIcon], ["forma-ui-icon-button", FormaUiIconButton], ["forma-ui-avatar", FormaUiAvatar],
  ["forma-ui-chip", FormaUiChip], ["forma-ui-status", FormaUiStatus], ["forma-ui-spinner", FormaUiSpinner],
  ["forma-ui-progress", FormaUiProgress], ["forma-ui-kbd", FormaUiKbd], ["forma-ui-divider", FormaUiDivider],
  ["forma-ui-skeleton", FormaUiSkeleton], ["forma-ui-theme", FormaUiTheme],
] as const;
defineFormaElements(definitions);

declare global {
  interface HTMLElementTagNameMap {
    "forma-ui-icon": FormaUiIcon; "forma-ui-icon-button": FormaUiIconButton; "forma-ui-avatar": FormaUiAvatar;
    "forma-ui-chip": FormaUiChip; "forma-ui-status": FormaUiStatus; "forma-ui-spinner": FormaUiSpinner;
    "forma-ui-progress": FormaUiProgress; "forma-ui-kbd": FormaUiKbd; "forma-ui-divider": FormaUiDivider;
    "forma-ui-skeleton": FormaUiSkeleton; "forma-ui-theme": FormaUiTheme;
  }
}

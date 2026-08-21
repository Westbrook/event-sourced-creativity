import { html, nothing } from "lit";
import { icon } from "../icons";
import { FormaPresentationalElement } from "../presentational-element";
import { defineFormaElements, emitFormaEvent, nextFormaId, type FormaOption } from "./contracts";

/**
 * @tag forma-ui-segmented-control
 * @summary Named native-button group with honest pressed states.
 * @fires {CustomEvent<{ value: string }>} forma-change - The active segment changed.
 * @cssprop {<length>} --forma-control-min-size - Minimum segment hit area.
 * @cssprop {<color>} --forma-color-accent-text - Selected segment foreground.
 */
export class FormaUiSegmentedControl extends FormaPresentationalElement {
  static properties = { label: { type: String }, value: { type: String }, disabled: { type: Boolean }, options: { attribute: false } };
  label = "Choose an option"; value = ""; disabled = false; options: FormaOption[] = [];
  #choose(value: string) { if (this.disabled || value === this.value) return; this.value = value; emitFormaEvent(this, "forma-change", { value }); }
  override render() { return html`<div class="ui-segmented" role="group" aria-label=${this.label}>${this.options.map((option) => html`<button type="button" aria-pressed=${String(option.value === this.value)} ?disabled=${this.disabled || (option.disabled ?? false)} @click=${() => this.#choose(option.value)}>${option.label}</button>`)}</div>`; }
}

/**
 * @tag forma-ui-tabs
 * @summary Complete tab and panel widget with roving Arrow, Home, and End focus.
 * @fires {CustomEvent<{ value: string }>} forma-change - The selected tab and panel changed.
 * @cssprop {<length>} --forma-control-min-size - Minimum tab hit area.
 * @cssprop {<color>} --forma-color-accent - Selected-tab indicator.
 */
export class FormaUiTabs extends FormaPresentationalElement {
  static properties = { label: { type: String }, value: { type: String }, options: { attribute: false } };
  label = "Sections"; value = ""; options: FormaOption[] = []; #id = nextFormaId("tabs");
  #select(value: string) { if (value === this.value) return; this.value = value; emitFormaEvent(this, "forma-change", { value }); }
  #keydown(event: KeyboardEvent) { const available = this.options.filter((option) => !option.disabled); if (!available.length || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); const current = available.findIndex((option) => option.value === this.value); const index = event.key === "Home" ? 0 : event.key === "End" ? available.length - 1 : (Math.max(0, current) + (event.key === "ArrowRight" ? 1 : -1) + available.length) % available.length; const option = available[index]; const originalIndex = this.options.findIndex((candidate) => candidate.value === option.value); this.#select(option.value); void this.updateComplete.then(() => this.querySelector<HTMLButtonElement>(`#${this.#id}-tab-${originalIndex}`)?.focus()); }
  override render() { const chosen = this.options.find((option) => option.value === this.value && !option.disabled) ?? this.options.find((option) => !option.disabled); const active = chosen?.value ?? ""; return html`<div class="ui-tabs"><div role="tablist" aria-label=${this.label} @keydown=${this.#keydown}>${this.options.map((option, index) => html`<button type="button" id=${`${this.#id}-tab-${index}`} role="tab" aria-selected=${String(option.value === active)} aria-controls=${`${this.#id}-panel-${index}`} tabindex=${option.value === active ? "0" : "-1"} ?disabled=${option.disabled ?? false} @click=${() => this.#select(option.value)}>${option.label}</button>`)}</div>${this.options.map((option, index) => html`<section id=${`${this.#id}-panel-${index}`} role="tabpanel" aria-labelledby=${`${this.#id}-tab-${index}`} tabindex="0" ?hidden=${option.value !== active}>${option.description || option.label}</section>`)}</div>`; }
}

/**
 * @tag forma-ui-breadcrumbs
 * @summary Named navigation landmark with a native ordered list and current-page state.
 * @fires {CustomEvent<{ value: string }>} forma-navigate - A breadcrumb destination was activated.
 * @cssprop {<color>} --forma-color-text-muted - Non-current breadcrumb foreground.
 */
export class FormaUiBreadcrumbs extends FormaPresentationalElement {
  static properties = { label: { type: String }, items: { attribute: false } };
  label = "Breadcrumb"; items: FormaOption[] = [];
  #navigate(event: MouseEvent, value: string) { if (!emitFormaEvent(this, "forma-navigate", { value }, { cancelable: true })) event.preventDefault(); }
  override render() { return html`<nav class="ui-breadcrumbs" aria-label=${this.label}><ol>${this.items.map((item, index) => html`<li>${index === this.items.length - 1 ? html`<span aria-current="page">${item.label}</span>` : html`<a href=${item.value} @click=${(event: MouseEvent) => this.#navigate(event, item.value)}>${item.label}</a><span aria-hidden="true">/</span>`}</li>`)}</ol></nav>`; }
}

/**
 * @tag forma-ui-pagination
 * @summary Named page navigation with explicit current-page and disabled boundaries.
 * @fires {CustomEvent<{ value: number }>} forma-change - A different page was requested.
 * @cssprop {<length>} --forma-control-min-size - Minimum pagination hit area.
 */
export class FormaUiPagination extends FormaPresentationalElement {
  static properties = { label: { type: String }, page: { type: Number }, total: { type: Number } };
  label = "Pagination"; page = 1; total = 1;
  #change(page: number) { const total = Math.max(1, Math.trunc(this.total)); const next = Math.max(1, Math.min(total, page)); if (next === this.page) return; this.page = next; emitFormaEvent(this, "forma-change", { value: next }); }
  override render() { const total = Math.max(1, Math.trunc(this.total)); const page = Math.max(1, Math.min(total, Math.trunc(this.page))); return html`<nav class="ui-pagination" aria-label=${this.label}><button type="button" ?disabled=${page <= 1} aria-label="Previous page" @click=${() => this.#change(page - 1)}>←</button><span aria-current="page">Page ${page} of ${total}</span><button type="button" ?disabled=${page >= total} aria-label="Next page" @click=${() => this.#change(page + 1)}>→</button></nav>`; }
}

/**
 * @tag forma-ui-toolbar
 * @summary Named native-button action group with visible labels.
 * @fires {CustomEvent<{ value: string }>} forma-action - A toolbar action was requested.
 * @cssprop {<length>} --forma-control-min-size - Minimum action hit area.
 */
export class FormaUiToolbar extends FormaPresentationalElement {
  static properties = { label: { type: String }, actions: { attribute: false } };
  label = "Actions"; actions: FormaOption[] = [];
  override render() { return html`<div class="ui-toolbar" role="group" aria-label=${this.label}>${this.actions.map((action) => html`<button type="button" ?disabled=${action.disabled ?? false} @click=${() => emitFormaEvent(this, "forma-action", { value: action.value })}>${action.label}</button>`)}</div>`; }
}

/**
 * @tag forma-ui-link
 * @summary Native anchor that supports real navigation and named external destinations.
 * @fires {CustomEvent<{ value: string }>} forma-navigate - The link was activated.
 * @cssprop {<color>} --forma-color-accent-text - Link foreground.
 */
export class FormaUiLink extends FormaPresentationalElement {
  static properties = { label: { type: String }, href: { type: String }, external: { type: Boolean } };
  label = ""; href = "#"; external = false;
  #navigate(event: MouseEvent) { if (!emitFormaEvent(this, "forma-navigate", { value: this.href }, { cancelable: true })) event.preventDefault(); }
  override render() { return html`<a class="ui-link" href=${this.href} target=${this.external ? "_blank" : nothing} rel=${this.external ? "noopener noreferrer" : nothing} @click=${this.#navigate}>${this.label || "Open link"}${this.external ? html`<span aria-hidden="true"> ${icon("share")}</span><span class="sr-only"> (opens in a new tab)</span>` : nothing}</a>`; }
}

const definitions = [
  ["forma-ui-segmented-control", FormaUiSegmentedControl], ["forma-ui-tabs", FormaUiTabs],
  ["forma-ui-breadcrumbs", FormaUiBreadcrumbs], ["forma-ui-pagination", FormaUiPagination],
  ["forma-ui-toolbar", FormaUiToolbar], ["forma-ui-link", FormaUiLink],
] as const;
defineFormaElements(definitions);

declare global {
  interface HTMLElementTagNameMap {
    "forma-ui-segmented-control": FormaUiSegmentedControl; "forma-ui-tabs": FormaUiTabs;
    "forma-ui-breadcrumbs": FormaUiBreadcrumbs; "forma-ui-pagination": FormaUiPagination;
    "forma-ui-toolbar": FormaUiToolbar; "forma-ui-link": FormaUiLink;
  }
}

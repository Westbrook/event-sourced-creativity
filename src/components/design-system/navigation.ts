import { html, nothing } from "lit";
import { icon } from "../icons";
import { FormaPresentationalElement } from "../presentational-element";
import { captureOutputNavigationFocus, type OutputNavigationFocusLease } from "../output-navigation-focus";
import { defineFormaElements, emitFormaEvent, nextFormaId, type FormaOption } from "./contracts";

export type FormaNavigationDestination = FormaOption & { href: string; icon?: string; badge?: number; badgeLabel?: string };

/**
 * @tag forma-ui-segmented-control
 * @summary Named native-button group with honest pressed states.
 * @fires {CustomEvent<{ value: string }>} forma-change - The active segment changed.
 * @cssprop {<length>} --forma-control-min-size - Minimum segment hit area.
 * @cssprop {<color>} --forma-color-accent-text - Selected segment foreground.
 */
export class FormaUiSegmentedControl extends FormaPresentationalElement {
  static properties = { label: { type: String }, value: { type: String }, disabled: { type: Boolean }, options: { attribute: false } };
  label = ""; value = ""; disabled = false; options: FormaOption[] = [];
  #choose(value: string) { if (this.disabled || value === this.value) return; this.value = value; emitFormaEvent(this, "forma-change", { value }); }
  override render() { return html`<div class="ui-segmented" role="group" aria-label=${this.label || this.i18n.t("field.choose")}>${this.options.map((option) => html`<button type="button" aria-pressed=${String(option.value === this.value)} ?disabled=${this.disabled || (option.disabled ?? false)} @click=${() => this.#choose(option.value)}>${option.label}</button>`)}</div>`; }
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
  label = ""; value = ""; options: FormaOption[] = []; #id = nextFormaId("tabs");
  #select(value: string) { if (value === this.value) return; this.value = value; emitFormaEvent(this, "forma-change", { value }); }
  #keydown(event: KeyboardEvent) { const available = this.options.filter((option) => !option.disabled); if (!available.length || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); const current = available.findIndex((option) => option.value === this.value); const direction = (event.key === "ArrowRight") === !this.matches(":dir(rtl)") ? 1 : -1; const index = event.key === "Home" ? 0 : event.key === "End" ? available.length - 1 : (Math.max(0, current) + direction + available.length) % available.length; const option = available[index]; const originalIndex = this.options.findIndex((candidate) => candidate.value === option.value); this.#select(option.value); void this.updateComplete.then(() => this.querySelector<HTMLButtonElement>(`#${this.#id}-tab-${originalIndex}`)?.focus()); }
  override render() { const chosen = this.options.find((option) => option.value === this.value && !option.disabled) ?? this.options.find((option) => !option.disabled); const active = chosen?.value ?? ""; return html`<div class="ui-tabs"><div role="tablist" aria-label=${this.label || this.i18n.t("navigation.sections")} @keydown=${this.#keydown}>${this.options.map((option, index) => html`<button type="button" id=${`${this.#id}-tab-${index}`} role="tab" aria-selected=${String(option.value === active)} aria-controls=${`${this.#id}-panel-${index}`} tabindex=${option.value === active ? "0" : "-1"} ?disabled=${option.disabled ?? false} @click=${() => this.#select(option.value)}>${option.label}</button>`)}</div>${this.options.map((option, index) => html`<section id=${`${this.#id}-panel-${index}`} role="tabpanel" aria-labelledby=${`${this.#id}-tab-${index}`} tabindex="0" ?hidden=${option.value !== active}>${option.description || option.label}</section>`)}</div>`; }
}

/**
 * @tag forma-ui-breadcrumbs
 * @summary Named navigation landmark with a native ordered list and current-page state.
 * @fires {CustomEvent<{ value: string }>} forma-navigate - A breadcrumb destination was activated.
 * @cssprop {<color>} --forma-color-text-muted - Non-current breadcrumb foreground.
 */
export class FormaUiBreadcrumbs extends FormaPresentationalElement {
  static properties = { label: { type: String }, items: { attribute: false } };
  label = ""; items: FormaOption[] = [];
  #navigate(event: MouseEvent, value: string) { if (!emitFormaEvent(this, "forma-navigate", { value }, { cancelable: true })) event.preventDefault(); }
  override render() { return html`<nav class="ui-breadcrumbs" aria-label=${this.label || this.i18n.t("navigation.breadcrumbs")}><ol>${this.items.map((item, index) => html`<li>${index === this.items.length - 1 ? html`<span aria-current="page">${item.label}</span>` : html`<a href=${item.value} @click=${(event: MouseEvent) => this.#navigate(event, item.value)}>${item.label}</a><span class="ui-directional-icon" aria-hidden="true">${icon("next")}</span>`}</li>`)}</ol></nav>`; }
}

/**
 * @tag forma-ui-pagination
 * @summary Named page navigation with explicit current-page and disabled boundaries.
 * @fires {CustomEvent<{ value: number }>} forma-change - A different page was requested.
 * @cssprop {<length>} --forma-control-min-size - Minimum pagination hit area.
 */
export class FormaUiPagination extends FormaPresentationalElement {
  static properties = { label: { type: String }, page: { type: Number }, total: { type: Number } };
  label = ""; page = 1; total = 1;
  #change(page: number) { const total = Math.max(1, Math.trunc(this.total)); const next = Math.max(1, Math.min(total, page)); if (next === this.page) return; this.page = next; emitFormaEvent(this, "forma-change", { value: next }); }
  override render() { const total = Math.max(1, Math.trunc(this.total)); const page = Math.max(1, Math.min(total, Math.trunc(this.page))); const rightToLeft = this.matches(":dir(rtl)"); return html`<nav class="ui-pagination" aria-label=${this.label || this.i18n.t("navigation.pagination")}><button type="button" ?disabled=${page <= 1} aria-label=${this.i18n.t("navigation.previous")} @click=${() => this.#change(page - 1)}>${icon(rightToLeft ? "next" : "previous")}</button><span aria-current="page">${this.i18n.t("navigation.page", "", { page: this.i18n.number(page), total: this.i18n.number(total) })}</span><button type="button" ?disabled=${page >= total} aria-label=${this.i18n.t("navigation.next")} @click=${() => this.#change(page + 1)}>${icon(rightToLeft ? "previous" : "next")}</button></nav>`; }
}

/**
 * @tag forma-ui-toolbar
 * @summary Named native-button action group with visible labels.
 * @fires {CustomEvent<{ value: string }>} forma-action - A toolbar action was requested.
 * @cssprop {<length>} --forma-control-min-size - Minimum action hit area.
 */
export class FormaUiToolbar extends FormaPresentationalElement {
  static properties = { label: { type: String }, actions: { attribute: false } };
  label = ""; actions: FormaOption[] = [];
  override render() { return html`<div class="ui-toolbar" role="group" aria-label=${this.label || this.i18n.t("navigation.actions")}>${this.actions.map((action) => html`<button type="button" ?disabled=${action.disabled ?? false} @click=${() => emitFormaEvent(this, "forma-action", { value: action.value })}>${action.label}</button>`)}</div>`; }
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
  override render() { return html`<a class="ui-link" href=${this.href} target=${this.external ? "_blank" : nothing} rel=${this.external ? "noopener noreferrer" : nothing} @click=${this.#navigate}>${this.label || this.i18n.t("navigation.openLink")}${this.external ? html`<span aria-hidden="true"> ${icon("share")}</span><span class="sr-only"> ${this.i18n.t("navigation.opensInNewTab")}</span>` : nothing}</a>`; }
}

/**
 * @tag forma-ui-workspace-switcher
 * @summary Audience-safe workspace picker with native navigation links and an automatically dismissed popover.
 * @fires {CustomEvent<{ value: string; href: string }>} forma-navigate - An authorized workspace identifier and destination were activated.
 * @cssprop {<length>} --forma-control-min-size - Minimum workspace-switcher hit area.
 * @cssprop {<color>} --forma-color-accent - Active workspace indicator.
 */
export class FormaUiWorkspaceSwitcher extends FormaPresentationalElement {
  static properties = { label: { type: String }, value: { type: String }, destinations: { attribute: false } };
  label = ""; value = ""; destinations: FormaNavigationDestination[] = [];
  #id = nextFormaId("workspace-switcher");
  #open = false;
  #returnFocus = false;
  #focus: { panel: HTMLElement; closing: boolean; lease: OutputNavigationFocusLease } | null = null;

  #retireFocus() { this.#focus?.lease.dispose(); this.#focus = null; }
  #beginFocus(panel: HTMLElement, closing: boolean) {
    this.#retireFocus();
    const trigger = this.querySelector<HTMLButtonElement>(".ui-workspace-switcher-trigger");
    // Native dismissal may itself restore the exact invoker synchronously.
    // A newer pointer/key or focus anywhere else still retires this lease.
    const lease = captureOutputNavigationFocus(this.ownerDocument, {
      ownedRouteFocus: element => closing && element === trigger && Boolean(trigger?.isConnected),
    });
    return this.#focus = { panel, closing, lease };
  }
  #beforeToggle(event: ToggleEvent) {
    const panel = event.currentTarget as HTMLElement | null;
    if (!this.isConnected || !panel?.isConnected || panel !== this.querySelector(".ui-workspace-switcher-panel")) return;
    const closing = event.newState === "closed";
    this.#beginFocus(panel, closing);
  }
  override disconnectedCallback() { this.#retireFocus(); this.#returnFocus = false; super.disconnectedCallback(); }
  protected override updated() {
    if (this.#focus && this.querySelector(".ui-workspace-switcher-panel") !== this.#focus.panel) this.#retireFocus();
    if (!this.querySelector(".ui-workspace-switcher-panel")) { this.#open = false; this.#returnFocus = false; }
  }

  #toggle(event: ToggleEvent) {
    const panel = event.currentTarget as HTMLElement | null, open = event.newState === "open";
    if (!this.isConnected || !panel?.isConnected || panel !== this.querySelector(".ui-workspace-switcher-panel")
      || panel.matches(":popover-open") !== open) return;
    const focus = this.#focus;
    this.#open = open;
    try {
      if (focus?.panel === panel && focus.closing === !open) {
        const target = open ? panel.querySelector<HTMLAnchorElement>('a[aria-current="page"]') ?? panel.querySelector<HTMLAnchorElement>("a")
          : this.#returnFocus ? this.querySelector<HTMLButtonElement>(".ui-workspace-switcher-trigger") : null;
        if (target) focus.lease.run(target, () => { target.focus(); return true; });
      }
    } finally {
      if (this.#focus === focus) this.#retireFocus();
      this.#returnFocus = false;
      this.requestUpdate();
    }
  }

  #activate(event: MouseEvent, destination: FormaNavigationDestination) {
    if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    const panel = this.querySelector<HTMLElement>(".ui-workspace-switcher-panel");
    if (panel?.matches(":popover-open")) {
      // Finish this menu's synchronous handoff before the destination captures
      // its own load-focus lease. Queued close cannot restore afterward.
      this.#returnFocus = false;
      panel.hidePopover();
      this.#retireFocus();
      this.querySelector<HTMLButtonElement>(".ui-workspace-switcher-trigger")?.focus();
    }
    if (!emitFormaEvent(this, "forma-navigate", { value: destination.value, href: destination.href }, { cancelable: true })) event.preventDefault();
  }

  override render() {
    const destinations = this.destinations.filter((destination) => !destination.disabled);
    if (destinations.length < 2) return nothing;
    const label = this.label || this.i18n.t("navigation.availableWorkspaces", "Available workspaces");
    const current = destinations.find((destination) => destination.value === this.value) ?? destinations[0];
    const links = destinations.map((destination) => html`<a href=${destination.href} title=${destination.description || nothing} class=${destination.value === this.value ? "active" : ""} aria-current=${destination.value === this.value ? "page" : nothing} @click=${(event: MouseEvent) => this.#activate(event, destination)}>${destination.label}</a>`);
    if (destinations.length === 2) return html`<nav class="ui-workspace-switcher application-switcher" aria-label=${label}>${links}</nav>`;
    const triggerLabel = this.i18n.t("navigation.switchWorkspaceCurrent", "Switch workspace. Current workspace: {workspace}", { workspace: current.label });
    return html`<div class="ui-workspace-switcher platform-switcher ui-popover">
      <button type="button" class="button secondary compact ui-popover-trigger ui-workspace-switcher-trigger" popovertarget=${this.#id} aria-controls=${this.#id} aria-expanded=${String(this.#open)} aria-label=${triggerLabel}>
        <span dir="auto">${current.label}</span><span class="ui-workspace-switcher-indicator" aria-hidden="true"></span>
      </button>
      <nav id=${this.#id} class="ui-popover-panel ui-workspace-switcher-panel" popover="auto" aria-label=${label} @beforetoggle=${this.#beforeToggle} @toggle=${this.#toggle} @keydown=${(event: KeyboardEvent) => { if (event.key === "Escape") this.#returnFocus = true; }}>${links}</nav>
    </div>`;
  }
}

/**
 * @tag forma-ui-audience-navigation
 * @summary Audience-neutral task rail containing only explicitly authorized native navigation links.
 * @fires {CustomEvent<{ value: string; href: string }>} forma-navigate - An authorized task identifier and destination were activated.
 * @cssprop {<length>} --forma-control-min-size - Minimum audience-navigation hit area.
 * @cssprop {<color>} --forma-color-surface - Preference-reactive task-rail surface.
 * @cssprop {<color>} --forma-color-border - Quiet task-rail boundary.
 * @cssprop {<color>} --forma-color-text - Hovered task foreground.
 * @cssprop {<color>} --forma-color-text-muted - Default task foreground.
 * @cssprop {<color>} --forma-color-accent-text - Current-task foreground.
 * @cssprop {<color>} --forma-color-accent - Current-task underline.
 */
export class FormaUiAudienceNavigation extends FormaPresentationalElement {
  static properties = { label: { type: String }, value: { type: String }, destinations: { attribute: false } };
  label = ""; value = ""; destinations: FormaNavigationDestination[] = [];
  #revealedLocation = "";

  protected override updated() {
    const location = `${this.value}:${this.destinations.map((destination) => destination.value).join(",")}:${this.i18n.locale}:${this.matches(":dir(rtl)")}`;
    if (location === this.#revealedLocation) return;
    const scroller = this.querySelector<HTMLElement>(".ui-audience-navigation-list");
    const current = scroller?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!scroller || !current) return;
    this.#revealedLocation = location;
    const viewport = scroller.getBoundingClientRect();
    const target = current.getBoundingClientRect();
    const focusClearance = Number.parseFloat(getComputedStyle(current).outlineWidth) || 3;
    if (target.right > viewport.right - focusClearance) scroller.scrollLeft += target.right - viewport.right + focusClearance;
    else if (target.left < viewport.left + focusClearance) scroller.scrollLeft -= viewport.left - target.left + focusClearance;
  }

  #activate(event: MouseEvent, destination: FormaNavigationDestination) {
    if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    if (!emitFormaEvent(this, "forma-navigate", { value: destination.value, href: destination.href }, { cancelable: true })) event.preventDefault();
  }

  override render() {
    const authorized = this.destinations.filter((destination) => !destination.disabled);
    if (!authorized.length) return nothing;
    const destinations = authorized.slice(0, 5);
    const current = authorized.find((destination) => destination.value === this.value);
    if (current && !destinations.includes(current)) destinations[destinations.length - 1] = current;
    const currentIndex = destinations.findIndex((destination) => destination.value === this.value);
    const label = this.label || this.i18n.t("navigation.scopedNavigation", "Workspace navigation");
    return html`<nav class="ui-audience-navigation" aria-label=${label}><ul class="ui-audience-navigation-list">${destinations.map((destination, index) => html`<li><a href=${destination.href} title=${destination.description || nothing} aria-label=${destination.badge && destination.badgeLabel ? destination.badgeLabel : nothing} aria-current=${index === currentIndex ? "page" : nothing} @click=${(event: MouseEvent) => this.#activate(event, destination)}>${destination.icon ? html`<span class="forma-primary-nav-icon" aria-hidden="true">${icon(destination.icon)}</span>` : nothing}<span class="forma-primary-nav-label">${destination.label}</span>${destination.badge ? html`<span class="forma-primary-nav-badge" aria-hidden="true">${destination.badge > 99 ? "99+" : destination.badge}</span>` : nothing}</a></li>`)}</ul></nav>`;
  }
}

const definitions = [
  ["forma-ui-segmented-control", FormaUiSegmentedControl], ["forma-ui-tabs", FormaUiTabs],
  ["forma-ui-breadcrumbs", FormaUiBreadcrumbs], ["forma-ui-pagination", FormaUiPagination],
  ["forma-ui-toolbar", FormaUiToolbar], ["forma-ui-link", FormaUiLink],
  ["forma-ui-workspace-switcher", FormaUiWorkspaceSwitcher], ["forma-ui-audience-navigation", FormaUiAudienceNavigation],
] as const;
defineFormaElements(definitions);

declare global {
  interface HTMLElementTagNameMap {
    "forma-ui-segmented-control": FormaUiSegmentedControl; "forma-ui-tabs": FormaUiTabs;
    "forma-ui-breadcrumbs": FormaUiBreadcrumbs; "forma-ui-pagination": FormaUiPagination;
    "forma-ui-toolbar": FormaUiToolbar; "forma-ui-link": FormaUiLink;
    "forma-ui-workspace-switcher": FormaUiWorkspaceSwitcher; "forma-ui-audience-navigation": FormaUiAudienceNavigation;
  }
}

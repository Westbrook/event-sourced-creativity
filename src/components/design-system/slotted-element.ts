import { css, LitElement } from "lit";
import { FormaLocaleController } from "./localization";

/**
 * One adopted stylesheet is shared by every composition-oriented shadow root.
 * Public custom properties remain inherited from the surrounding theme scope.
 */
const compositionStyles = css`
  :host {
    display: block;
    min-inline-size: 0;
    color: var(--forma-color-text, var(--ink));
    font-family: var(--forma-font-family, var(--sans));
    line-height: 1.6;
  }

  *, *::before, *::after { box-sizing: border-box; }
  slot { display: contents; }
  ::slotted(*) { min-inline-size: 0; max-inline-size: 100%; }
  ::slotted([hidden]) { display: none !important; }
  ::slotted(h1), ::slotted(h2), ::slotted(h3), ::slotted(h4),
  ::slotted(h5), ::slotted(h6), ::slotted(p) { margin: 0; }
  ::slotted([slot="eyebrow"]) {
    color: var(--forma-color-text-muted, var(--muted));
    font-size: var(--forma-font-size-supporting, var(--type-small));
  }
  ::slotted([slot="media"]) {
    display: block;
    inline-size: 100%;
    block-size: auto;
    border-radius: var(--forma-radius-small, var(--radius-small));
  }
  ::slotted(button), ::slotted(a[slot="actions"]),
  ::slotted(a[slot="trailing"]) {
    display: inline-flex;
    min-inline-size: var(--forma-control-min-size, 2.75rem);
    min-block-size: var(--forma-control-min-size, 2.75rem);
    align-items: center;
    justify-content: center;
  }
  slot:not([name])::slotted(p) {
    color: var(--forma-color-text-muted, var(--muted));
    font-size: var(--forma-font-size-supporting, var(--type-small));
    line-height: 1.6;
  }
  ::slotted(:focus-visible) {
    outline: var(--forma-focus-ring-width, .1875rem) solid
      var(--forma-focus-ring-color, var(--forma-color-accent, var(--accent)));
    outline-offset: .1875rem;
  }

  button {
    min-block-size: var(--forma-control-min-size, 2.75rem);
    color: inherit;
    border: 0;
    background: none;
    font: inherit;
    cursor: pointer;
  }
  button:focus-visible, summary:focus-visible {
    outline: var(--forma-focus-ring-width, .1875rem) solid
      var(--forma-focus-ring-color, var(--forma-color-accent, var(--accent)));
    outline-offset: .1875rem;
  }
  button:disabled { cursor: not-allowed; opacity: .48; }
  .button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--forma-space-2, var(--space-2));
    padding-inline: var(--forma-space-4, var(--space-4));
    border-radius: var(--forma-radius-small, var(--radius-small));
    font-size: var(--forma-font-size-supporting, var(--type-small));
    font-weight: 650;
  }
  .button.primary {
    color: var(--forma-color-on-strong, var(--on-strong));
    background: var(--forma-color-text, var(--ink));
  }
  .button.primary:hover { background: var(--forest-2, var(--forma-color-text)); }
  .button.secondary {
    background: var(--forma-color-surface, var(--panel));
    border: 1px solid var(--forma-color-border-strong, var(--line-strong));
  }
  .button.ghost {
    color: var(--forma-color-text-muted, var(--muted));
    background: transparent;
    border: 1px solid transparent;
  }
  .button.secondary:hover, .button.ghost:hover {
    color: var(--forma-color-text, var(--ink));
    background: var(--forma-color-surface-subtle, var(--panel-2));
  }
  .icon-button {
    display: inline-grid;
    min-inline-size: var(--forma-control-min-size, 2.75rem);
    place-items: center;
    color: var(--forma-color-text-muted, var(--muted));
    border-radius: var(--forma-radius-small, var(--radius-small));
  }
  .icon-button:hover {
    color: var(--forma-color-text, var(--ink));
    background: var(--forma-color-surface, var(--panel));
  }

  .ui-card {
    display: grid;
    min-inline-size: 0;
    justify-items: start;
    gap: var(--forma-space-2, var(--space-2));
    padding: var(--forma-space-5, var(--space-5));
    background: var(--forma-color-surface, var(--panel));
    border: 1px solid var(--forma-color-border, var(--line));
    border-radius: var(--forma-radius-medium, var(--radius-medium));
  }
  .ui-card-eyebrow, .ui-list-item-detail, .ui-page-header-eyebrow {
    color: var(--forma-color-text-muted, var(--muted));
    font-size: var(--forma-font-size-supporting, var(--type-small));
  }
  :is(.ui-card, .ui-page-header) :is(h1, h2, h3, h4, h5, h6, p) { margin: 0; }
  :is(h1, h2, h3, h4, h5, h6),
  ::slotted(h1), ::slotted(h2), ::slotted(h3), ::slotted(h4),
  ::slotted(h5), ::slotted(h6) {
    font-family: var(--forma-font-family, var(--sans));
    font-weight: 600;
    letter-spacing: var(--forma-heading-letter-spacing, -.04em);
    line-height: max(var(--forma-heading-line-height, .98), 1.2);
  }
  .ui-card :is(h1, h2, h3, h4, h5, h6),
  .ui-card slot[name="heading"]::slotted(:is(h1, h2, h3, h4, h5, h6)) {
    font-size: var(--forma-heading-size, var(--type-lede, 1.125rem));
  }
  .ui-page-header :is(h1, h2, h3, h4, h5, h6),
  .ui-page-header slot[name="heading"]::slotted(:is(h1, h2, h3, h4, h5, h6)) {
    font-size: var(--forma-heading-size, var(--type-heading, 1.5rem));
  }
  .ui-card p, .ui-page-header p, .ui-notice p, .ui-disclosure p {
    color: var(--forma-color-text-muted, var(--muted));
  }
  .ui-card-actions, .ui-page-header-actions, .ui-notice-actions,
  .ui-list-item-trailing {
    display: flex;
    min-inline-size: 0;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--forma-space-2, var(--space-2));
  }
  .ui-list-item {
    display: flex;
    min-inline-size: 0;
    min-block-size: var(--forma-control-min-size, 2.75rem);
    align-items: center;
    gap: var(--forma-space-3, var(--space-3));
  }
  .ui-list-item-copy {
    display: grid;
    min-inline-size: 0;
    flex: 1;
    gap: .125rem;
  }
  .ui-list-item strong {
    font-size: var(--forma-font-size-supporting, var(--type-small));
  }
  .ui-list-item slot[name="heading"]::slotted(strong) {
    font-size: var(--forma-font-size-supporting, var(--type-small));
  }
  .ui-page-header {
    display: flex;
    min-inline-size: 0;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--forma-space-4, var(--space-4));
  }
  .ui-page-header-copy {
    display: grid;
    min-inline-size: 0;
    gap: var(--forma-space-1, var(--space-1));
  }

  .ui-notice {
    display: grid;
    min-inline-size: 0;
    grid-template-columns: 1.5rem minmax(0, 1fr) auto;
    align-items: start;
    gap: var(--forma-space-3, var(--space-3));
    padding: var(--forma-space-4, var(--space-4));
    color: var(--forma-color-text, var(--ink));
    background: var(--forma-color-surface-subtle, var(--panel-2));
    border-radius: var(--forma-radius-medium, var(--radius-medium));
  }
  .ui-notice-symbol { padding-block-start: .15rem; }
  .ui-notice-copy { min-inline-size: 0; }
  .ui-notice strong {
    display: block;
    font-size: var(--forma-font-size-supporting, var(--type-small));
  }
  .ui-notice p {
    margin: var(--forma-space-1, var(--space-1)) 0 0;
    font-size: var(--forma-font-size-supporting, var(--type-small));
  }
  .ui-notice--accent .ui-notice-symbol, .ui-notice--accent strong,
  .ui-notice--accent slot[name="heading"]::slotted(*) {
    color: var(--forma-color-accent-text, var(--accent-strong));
  }
  .ui-notice--positive .ui-notice-symbol, .ui-notice--positive strong,
  .ui-notice--positive slot[name="heading"]::slotted(*) {
    color: var(--forma-color-positive-text, var(--positive));
  }
  .ui-notice--warning .ui-notice-symbol, .ui-notice--warning strong,
  .ui-notice--warning slot[name="heading"]::slotted(*) {
    color: var(--forma-color-warning-text, var(--warning));
  }
  .ui-notice--danger .ui-notice-symbol, .ui-notice--danger strong,
  .ui-notice--danger slot[name="heading"]::slotted(*) {
    color: var(--forma-color-danger-text, var(--danger));
  }

  .ui-disclosure > summary {
    display: flex;
    min-block-size: var(--forma-control-min-size, 2.75rem);
    align-items: center;
    color: var(--forma-color-text, var(--ink));
    font-weight: 600;
    cursor: pointer;
  }
  .ui-disclosure > p {
    margin: var(--forma-space-2, var(--space-2)) 0
      var(--forma-space-3, var(--space-3));
  }

  @media (forced-colors: active) {
    .ui-card, .ui-notice, .button, .icon-button {
      border: 1px solid CanvasText;
    }
    button:focus-visible, summary:focus-visible,
    ::slotted(:focus-visible) { outline-color: Highlight; }
  }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: .01ms !important;
      transition-duration: .01ms !important;
      scroll-behavior: auto !important;
    }
  }
`;

/** Store-independent composition base with genuine slots and one shared adopted stylesheet. */
export abstract class FormaSlottedElement extends LitElement {
  static override styles = compositionStyles;
  #locale?: FormaLocaleController;
  protected get i18n() { return this.#locale ||= new FormaLocaleController(this); }
}

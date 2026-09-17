import { html } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
export const buttonTemplate = (view) => html `
  <button
    class=${view.iconOnly ? 'en-button en-icon-button' : 'en-button'}
    ?data-icon-only=${view.iconOnly}
    part="control"
    type="button"
    tabindex=${view.tabIndex ?? 0}
    data-variant=${view.variant}
    data-size=${view.size}
    ?disabled=${view.disabled || view.loading}
    aria-busy=${view.loading ? 'true' : 'false'}
    aria-haspopup=${ifDefined(view.popupRole ?? undefined)}
    aria-expanded=${ifDefined(view.popupExpanded ?? undefined)}
    aria-disabled=${ifDefined(view.ariaDisabled ?? undefined)}
  >
    ${view.loading ? html `<span class="en-spinner" part="indicator" aria-hidden="true"></span>` : null}
    <slot class="en-button__prefix" name="prefix"></slot>
    <span class="en-button__label" part="label"><slot name="label"><slot></slot></slot></span>
    <slot class="en-button__suffix" name="suffix"></slot>
  </button>
`;

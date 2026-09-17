import { html, nothing } from 'lit';
import { icons } from '../icon/template.js';
import { ifDefined } from 'lit/directives/if-defined.js';
/** Native activation is preserved; ornamental slots cannot add an action target. */
export const menuItemTemplate = (view) => html `
  <button class="en-menu-item" part=${view.disabled ? 'control option option-disabled' : 'control option'}
    type="button" role=${view.type === 'checkbox' ? 'menuitemcheckbox' : view.type === 'radio' ? 'menuitemradio' : 'menuitem'}
    aria-checked=${ifDefined(view.type === 'checkbox' || view.type === 'radio' ? String(view.checked) : undefined)}
    aria-haspopup=${ifDefined(view.hasPopup)} aria-expanded=${ifDefined(view.hasPopup ? view.expanded : undefined)} aria-disabled=${String(view.disabled)} tabindex=${view.tabStop}
    @click=${view.activate}>
    ${view.type === 'checkbox' || view.type === 'radio' ? html `<span class="en-menu-item-check" part="checkmark" aria-hidden="true">${view.checked ? view.type === 'radio' ? html `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="4" /></svg>` : html `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icons.check}</svg>` : nothing}</span>` : nothing}
    <slot class="en-menu-item-prefix" name="prefix" aria-hidden="true"></slot>
    <span class="en-menu-item-label" part="label"><slot></slot></span>
    <slot class="en-menu-item-suffix" name="suffix" aria-hidden="true"></slot>
    ${view.hasPopup === 'menu' ? html `<span class="en-menu-item-submenu" part="submenu-indicator" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icons['chevron-down']}</svg></span>` : nothing}
    <slot class="en-menu-item-shortcut" part="shortcut" name="shortcut"></slot>
  </button>`;

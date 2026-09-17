import { nativeSurfaceBeforeToggle } from '../internal/native-surface.js';
import { html, nothing } from 'lit';
import { icons } from '../icon/template.js';
/** Authored items stay in the host; the native top-layer menu owns the landmark. */
export const menuTemplate = (view) => html `
  <div class="en-menu" ?data-replaced=${view.replaced} ?data-replacement=${view.replacement} part="surface" popover="manual" role=${view.replaced ? 'presentation' : 'menu'} aria-label=${view.replaced ? nothing : view.label} tabindex="-1"
    inert @beforetoggle=${nativeSurfaceBeforeToggle} @toggle=${view.nativeToggle}>
    ${view.replacement ? html `<button type="button" class="en-menu-back" part="back" role="menuitem" tabindex="-1" @click=${view.back}><svg class="en-menu-back-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icons['chevron-down']}</svg><span>${view.backLabel}</span></button>` : nothing}
    <slot @slotchange=${view.childrenChanged}></slot>
  </div>`;

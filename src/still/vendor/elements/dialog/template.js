import { nativeSurfaceBeforeToggle } from '../internal/native-surface.js';
import { html, nothing } from 'lit';
/** Shared native modal markup. All state transitions are supplied by its adapter. */
export function dialogTemplate(view) {
    return html `
    <dialog class=${view.surfaceClass} part=${view.surfacePart ?? "surface"} data-placement=${view.placement}
      role=${view.kind ?? 'dialog'} aria-describedby="en-overlay-description"
      aria-labelledby="en-overlay-heading" closedby=${view.closedBy}
      inert @beforetoggle=${nativeSurfaceBeforeToggle} @cancel=${view.cancel} @close=${view.close}
      @pointerdown=${view.pointerDown} @pointerup=${view.pointerUp}
      @pointercancel=${view.pointerCancel} @keydown=${view.keyDown}>
      <div class="en-overlay-header" part="header">
        <h2 class="en-heading-small" id="en-overlay-heading" part="heading"><slot name="label">${view.label}</slot></h2>
        ${view.dismissible ? html `
          <en-button class="en-overlay-close" variant="ghost" icon-only size="inherit"
            exportparts="control:close" @click=${view.dismiss}>
            <en-icon slot="prefix" name="close" size="inherit"></en-icon>
            <span slot="label">${view.closeLabel}</span>
          </en-button>
        ` : null}
      </div>
      <div id="en-overlay-description" class="en-overlay-description" part="description"><slot name="description"><span class="en-overlay-description-fallback">${view.description || nothing}</span></slot></div>
      <div class="en-overlay-body" part="body">${view.body ?? html `<slot></slot>`}</div>
      ${view.footer === nothing ? nothing : html `<div class="en-overlay-footer" part="footer">${view.footer ?? html `<slot name="footer"></slot>`}</div>`}
    </dialog>`;
}

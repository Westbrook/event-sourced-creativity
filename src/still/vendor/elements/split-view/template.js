import { html } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import { ref } from 'lit/directives/ref.js';
export function splitViewTemplate(view, setHandle, action, handleKey) {
    const name = (pane) => (view.collapsed === pane ? view.restoreLabel : view.collapseLabel).replaceAll('{pane}', pane === 'primary' ? view.primaryLabel : view.secondaryLabel);
    return html `<div class="en-split-shell">
    <div class="en-split-controls" part="controls" role="group" aria-label=${view.controlsLabel} ?hidden=${!view.primaryAction && !view.secondaryAction && view.collapsed === 'none'}>
      <en-button part="primary-action" exportparts="control:primary-toggle" variant="secondary" size="small" ?disabled=${view.disabled}
        ?hidden=${!view.primaryAction && view.collapsed !== 'primary'} @click=${() => action('primary')}>${name('primary')}</en-button>
      <en-button part="secondary-action" exportparts="control:secondary-toggle" variant="secondary" size="small" ?disabled=${view.disabled}
        ?hidden=${!view.secondaryAction && view.collapsed !== 'secondary'} @click=${() => action('secondary')}>${name('secondary')}</en-button>
    </div>
    <div class="en-split-view" part="base" data-orientation=${view.orientation} data-collapsed=${view.collapsed}
    style=${styleMap({ '--en-split-ratio': String(view.value / 100) })}>
    <div id="primary-pane" class="en-split-pane" part="primary" tabindex="-1" ?hidden=${view.collapsed === 'primary'} ?inert=${view.collapsed === 'primary'}><slot name="primary"></slot></div>
    <en-splitter ${ref(setHandle)} class="en-split-handle" part="separator" role="separator" aria-controls="primary-pane"
      ?hidden=${view.collapsed !== 'none'} ?inert=${view.collapsed !== 'none'} @keydown=${handleKey}
      aria-label=${view.label} aria-orientation=${view.orientation === 'vertical' ? 'horizontal' : 'vertical'}
      aria-valuenow=${Math.round(view.value * 100) / 100} aria-valuemin=${view.min} aria-valuemax=${view.max}
      aria-disabled=${String(view.disabled)} tabindex=${view.disabled ? -1 : 0} .min=${view.min} .max=${view.max}
      .value=${view.value} .step=${view.step} .label=${view.label} .disabled=${view.disabled}
      .orientation=${view.orientation === 'vertical' ? 'horizontal' : 'vertical'}></en-splitter>
    <div class="en-split-pane" part="secondary" tabindex="-1" ?hidden=${view.collapsed === 'secondary'} ?inert=${view.collapsed === 'secondary'}><slot name="secondary"></slot></div>
  </div></div>`;
}

import { css } from 'lit';
import { token as t, override as o } from './values.js';
export const fieldBorderWidth = o('--en-input-border-width', t('--en-border-width'));
export const fieldInvalidWidth = o('--en-input-invalid-border-width', t('--en-border-invalid-width'));
export const fieldRadius = o('--en-input-radius', o('--en-control-radius', t('--en-radius-control')));
/** Frame-only refinements. Compound controls pass their outer frame, never steppers. */
export function fieldPresentation(base, invalid) {
    return css `
    ${base} { border-radius: ${fieldRadius}; border-width: ${fieldBorderWidth}; border-color: ${o('--en-input-border-color', o('--en-control-border-color', t('--en-color-boundary')))}; }
    @media (hover: hover) {
      ${base}:hover:where(:not(:disabled):not([aria-disabled='true']):not(:has(:disabled))) { border-color: var(--en-input-hover-border-color, var(--en-input-border-color, var(--en-control-border-color, ${t('--en-color-boundary')}))); }
    }
    ${invalid} { border-color: ${o('--en-input-invalid-border-color', t('--en-color-danger-text'))}; }
  `;
}

import { css } from 'lit';
import { token as t, override as o } from './values.js';
import { textControlBlockSize } from './control-size.js';
/** Evaluate public tokens on the authored consumer, including local Parts. */
export function controlBlockSizeStyles(selector, coarse = false) {
    return css `${selector} { --_en-text-control-block-size: ${textControlBlockSize(coarse)}; }`;
}
export function controlSurfaceStyles(selector) {
    return css `${selector} {
    box-sizing: border-box;
    min-inline-size: 0;
    min-block-size: max(${o('--en-control-min-size', t('--en-size-control-min'))}, ${t('--en-size-target-min')});
    max-inline-size: 100%;
    padding-block: ${t('--en-space-control-block')};
    padding-inline: ${o('--en-control-inline-padding', t('--en-space-control-inline'))};
    border: ${t('--en-border-width')} solid ${o('--en-control-border-color', t('--en-color-boundary'))};
    border-radius: ${o('--en-control-radius', t('--en-radius-control'))};
    background: ${o('--en-control-background', t('--en-color-surface'))};
    color: ${o('--en-control-color', t('--en-color-text'))};
    font: inherit;
    text-align: start;
  }`;
}
export function controlEnvelopeStyles(selector) {
    return css `${selector} { min-block-size: var(--_en-text-control-block-size); }`;
}
export function controlDisabledStyles(selector) {
    return css `${selector} {
    color: ${t('--en-color-text-muted')};
    background: ${t('--en-color-surface-subtle')};
    border-color: ${t('--en-color-boundary')};
    cursor: default;
  }`;
}
export function controlTouchBlockStyles(selector) {
    return css `${selector} { min-block-size: max(${o('--en-control-min-size', t('--en-size-control-min'))}, ${t('--en-size-target-touch')}); }`;
}
export function controlTouchInlineStyles(selector) {
    return css `${selector} { min-inline-size: max(${o('--en-control-min-size', t('--en-size-control-min'))}, ${t('--en-size-target-touch')}); }`;
}
export function controlReducedMotionStyles(selector) {
    return css `${selector} { transition: none; }`;
}
export function controlForcedColorStyles(selector) {
    return css `${selector} { color: CanvasText !important; background: Canvas !important; border-color: ButtonText !important; }`;
}
export function controlForcedDisabledStyles(selector) {
    return css `${selector} { color: GrayText !important; border-color: GrayText !important; }`;
}

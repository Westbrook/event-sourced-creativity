import { controlTargetSize } from './internal/target-size.js';
import { css } from 'lit';
import { sizedStyles } from './internal/sizing.js';
import { token as t, override as o } from './internal/values.js';
import { activityStyles } from './activity.js';
import { focusStyles } from './internal/focus.js';
export { activityStyles } from './activity.js';
export const feedbackStyles = sizedStyles(css `
  .en-alert { display: flex; align-items: flex-start; gap: ${t('--en-space-3')}; min-inline-size: 0; padding: ${t('--en-space-4')}; border: ${t('--en-border-width')} solid ${o('--en-alert-border-color', t('--en-color-accent-border'))}; border-radius: ${t('--en-radius-container')}; background: ${o('--en-alert-background', t('--en-color-surface'))}; color: ${o('--en-alert-color', t('--en-color-text'))}; }
  .en-alert__icon { flex: none; color: ${t('--en-color-action')}; }
  .en-alert__content { min-inline-size: 0; flex: 1 1 auto; overflow-wrap: break-word; }
  .en-alert__close { flex: none; margin-inline-start: auto; }
  .en-alert[data-variant='success'] { border-color: ${o('--en-alert-border-color', t('--en-color-success-text'))}; }
  .en-alert[data-variant='warning'] { border-color: ${o('--en-alert-border-color', t('--en-color-warning-text'))}; }
  .en-alert[data-variant='danger'] { border-color: ${o('--en-alert-border-color', t('--en-color-danger-text'))}; }
  .en-alert[data-variant='success'] .en-alert__icon { color: ${t('--en-color-success-text')}; }
  .en-alert[data-variant='warning'] .en-alert__icon { color: ${t('--en-color-warning-text')}; }
  .en-alert[data-variant='danger'] .en-alert__icon { color: ${t('--en-color-danger-text')}; }
  .en-badge { display: inline-flex; align-items: center; gap: ${t('--en-space-icon-label')}; max-inline-size: 100%; padding-block: ${t('--en-space-badge-block')}; padding-inline: ${t('--en-space-badge-inline')}; border: ${t('--en-border-width')} solid ${t('--en-color-line')}; border-radius: ${o('--en-badge-radius', t('--en-radius-control'))}; background: ${o('--en-badge-background', t('--en-color-surface-subtle'))}; color: ${o('--en-badge-color', t('--en-color-text'))}; font-size: ${t('--en-font-metadata-size')}; line-height: ${t('--en-font-metadata-line-height')}; overflow-wrap: break-word; }
  .en-badge__prefix { display: contents; }
  .en-badge__label { min-inline-size: 0; }
  .en-badge[data-variant='accent'] { background: ${o('--en-badge-background', t('--en-color-accent-subtle'))}; color: ${o('--en-badge-color', t('--en-color-action-text'))}; }
  .en-badge:is([data-variant='success'], [data-variant='warning'], [data-variant='danger']) { background: ${o('--en-badge-background', t('--en-color-surface'))}; }
  .en-badge[data-variant='success'] { color: ${o('--en-badge-color', t('--en-color-success-text'))}; }
  .en-badge[data-variant='warning'] { color: ${o('--en-badge-color', t('--en-color-warning-text'))}; }
  .en-badge[data-variant='danger'] { color: ${o('--en-badge-color', t('--en-color-danger-text'))}; }
  .en-progress, .en-progress-track { display: block; inline-size: 100%; block-size: ${o('--en-progress-size', t('--en-size-progress'))}; overflow: hidden; border: 0; border-radius: ${t('--en-radius-pill')}; background: ${o('--en-progress-track-color', t('--en-color-surface-subtle'))}; }
  .en-progress { appearance: none; accent-color: ${o('--en-progress-color', t('--en-color-action'))}; }
  .en-progress-fill { display: block; inline-size: clamp(0%, var(--en-progress-value, 0%), 100%); block-size: 100%; border-radius: inherit; background: ${o('--en-progress-color', t('--en-color-action'))}; }
  .en-progress::-webkit-progress-bar { background: ${o('--en-progress-track-color', t('--en-color-surface-subtle'))}; border-radius: inherit; }
  .en-progress::-webkit-progress-value { background: ${o('--en-progress-color', t('--en-color-action'))}; border-radius: inherit; }
  .en-progress::-moz-progress-bar { background: ${o('--en-progress-color', t('--en-color-action'))}; border-radius: inherit; }
  ${activityStyles}
  @media (forced-colors: active) {
    .en-alert, .en-alert[data-variant], .en-badge, .en-badge[data-variant] { color: CanvasText; background: Canvas; border-color: CanvasText; }
    .en-alert__icon, .en-alert[data-variant] .en-alert__icon { color: CanvasText; }
    .en-progress, .en-progress-track { background: Canvas; border: ${t('--en-border-width')} solid CanvasText; }
    .en-progress-fill { background: Highlight; }
    .en-progress::-webkit-progress-bar { background: Canvas; }
    .en-progress::-webkit-progress-value { background: Highlight; }
    .en-progress::-moz-progress-bar { background: Highlight; }
  }
`);
export const mediaStyles = sizedStyles(css `
  .en-icon { display: inline-flex; align-items: center; justify-content: center; flex: none; inline-size: ${o('--en-icon-size', t('--en-size-icon'))}; block-size: ${o('--en-icon-size', t('--en-size-icon'))}; vertical-align: middle; color: inherit; }
  svg.en-icon[data-logical]:dir(rtl) { scale:-1 1; }
  .en-icon > :where(svg, img), .en-icon ::slotted(svg), .en-icon ::slotted(img) { display: block; inline-size: 100%; block-size: 100%; }
  svg.en-icon, .en-icon > svg, .en-icon ::slotted(svg) { display: block; stroke-width: ${t('--en-size-icon-stroke')}; }
  .en-avatar { display: inline-grid; place-items: center; vertical-align: middle; flex: none; inline-size: ${o('--en-avatar-size', t('--en-size-avatar'))}; block-size: ${o('--en-avatar-size', t('--en-size-avatar'))}; overflow: hidden; border-radius: ${o('--en-avatar-radius', t('--en-radius-pill'))}; background: ${t('--en-color-surface-subtle')}; color: ${t('--en-color-text')}; }
  .en-avatar__image { display: block; inline-size: 100%; block-size: 100%; object-fit: cover; }
  .en-avatar__fallback { font-weight: ${t('--en-font-label-strong-weight')}; }
  .en-media { display: block; max-inline-size: 100%; block-size: auto; border-radius: ${o('--en-media-radius', t('--en-radius-container'))}; aspect-ratio: ${o('--en-media-aspect-ratio', css `auto`)}; }
  @media (forced-colors: active) { .en-avatar { color: CanvasText; background: Canvas; border: ${t('--en-border-width')} solid CanvasText; } }
`);
/** A neutral color-sample control; its surrounding presentation belongs to the consumer. */
export const swatchStyles = sizedStyles(css `
  :host { inline-size: max(${o('--en-swatch-size', t('--en-size-swatch'))}, ${controlTargetSize(false, t('--en-size-target-min'))}); min-inline-size: ${controlTargetSize(false, t('--en-size-target-min'))}; }
  .en-swatch__sample { position: relative; display: block; appearance: none; inline-size: 100%; block-size: max(${o('--en-swatch-size', t('--en-size-swatch'))}, ${controlTargetSize(false, t('--en-size-target-min'))}); min-inline-size: ${controlTargetSize(false, t('--en-size-target-min'))}; padding: 0; margin: 0; overflow: hidden; border: ${t('--en-border-width')} solid ${t('--en-color-boundary')}; border-radius: ${t('--en-radius-control')}; background: transparent; color: inherit; cursor: pointer; }
  @media (any-pointer: coarse) {
    :host { inline-size:max(${o('--en-swatch-size', t('--en-size-swatch'))},${controlTargetSize(true, t('--en-size-target-min'))}); min-inline-size:${controlTargetSize(true, t('--en-size-target-min'))}; }
    .en-swatch__sample { min-inline-size:${controlTargetSize(true, t('--en-size-target-min'))}; min-block-size:${controlTargetSize(true, t('--en-size-target-min'))}; }
  }
  @media (hover: hover) { .en-swatch__sample:not(:disabled):hover { border-color: ${t('--en-color-action')}; } }
  .en-swatch__sample:not(:disabled):active { border-width: max(2px, ${t('--en-border-width')}); }
  .en-swatch__sample:disabled { cursor: default; }
  .en-swatch__color { display: block; inline-size: 100%; block-size: 100%; }
  ${focusStyles}
  @media (forced-colors: active) {
    .en-swatch__sample { border-color: ButtonText; background: Canvas; }
  @media (hover: hover) { .en-swatch__sample:not(:disabled):hover { border-color: ButtonText; background: Canvas; } }
    .en-swatch__sample:disabled { border-color: GrayText; }
    .en-swatch__color { forced-color-adjust: none; }
  }
`);

import { css } from 'lit';
import { sizedStyles } from './internal/sizing.js';
import { token as t, override as o } from './internal/values.js';
/** Leaf stylesheet for loading indicators; imports no alert/media/selection styles. */
export const activityStyles = sizedStyles(css `
  .en-spinner {
    display: inline-block;
    flex: none;
    inline-size: ${t('--en-size-spinner')};
    block-size: ${t('--en-size-spinner')};
    border: ${t('--en-size-spinner-stroke')} solid currentColor;
    border-inline-end-color: ${t('--en-color-line')};
    border-radius: ${t('--en-radius-pill')};
    animation: en-style-spin ${t('--en-duration-spin')} linear infinite;
  }
  @keyframes en-style-spin { to { transform: rotate(1turn); } }
  .en-skeleton { display: block; inline-size: 100%; block-size: ${o('--en-skeleton-size', t('--en-size-skeleton-line'))}; background: ${o('--en-skeleton-color', t('--en-color-surface-subtle'))}; border-radius: ${t('--en-radius-control')}; }
  .en-skeleton[data-shape='circle'] { inline-size: ${o('--en-skeleton-size', t('--en-size-avatar'))}; block-size: ${o('--en-skeleton-size', t('--en-size-avatar'))}; border-radius: ${t('--en-radius-pill')}; }
  .en-skeleton[data-shape='rectangle'] { block-size: ${o('--en-skeleton-size', t('--en-space-16'))}; }
  @media (prefers-reduced-motion: reduce) { .en-spinner { animation: none; } }
  @media (forced-colors: active) { .en-spinner { border-color: CanvasText; border-inline-end-color: GrayText; } .en-skeleton { background: Canvas; border: ${t('--en-border-width')} solid GrayText; } }
`);

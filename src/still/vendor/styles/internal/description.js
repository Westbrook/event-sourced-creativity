import { css } from 'lit';
import { override as o, token as t } from './values.js';
/** Native slot precedence, empty fallback collapse and shared supporting text. */
export const descriptionStyles = css `
  .en-description { margin: 0; font-size: ${t('--en-font-ui-size')}; line-height: ${t('--en-font-body-line-height')}; overflow-wrap: break-word; display: flow-root; color: ${t('--en-color-text-muted')}; }
  .en-description-fallback,
  .en-description > slot::slotted(:not([hidden])) { display: block; margin-block-start: var(--_en-field-gap, ${o('--en-field-gap', t('--en-space-label-control'))}); }
  .en-description-fallback:empty { display: none; }
  @media (forced-colors: active) { .en-description { color: CanvasText; } }
`;

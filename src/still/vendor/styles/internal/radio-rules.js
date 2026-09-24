import { pressStyles } from './press.js';
import { pressRecipes } from './press-recipes.js';
import { css } from 'lit';
import { token as t, override as o } from './values.js';
/** One native-input paint recipe for the radio element and composed patterns. */
export const radioRules = css `
  .en-radio {
    flex: none;
    inline-size: ${o('--en-choice-size', t('--en-size-icon'))};
    block-size: ${o('--en-choice-size', t('--en-size-icon'))};
    margin: 0;
    accent-color: ${t('--en-color-action')};
    appearance: none;
    display: inline-grid;
    /* Keep the inline baseline independent of the checked-state grid dot. */
    vertical-align: middle;
    place-items: center;
    box-sizing: border-box;
    border: ${t('--en-border-width')} solid ${t('--en-color-boundary')};
    border-radius: ${t('--en-radius-pill')};
    background: ${t('--en-color-surface')};
    cursor: pointer;
  }
  .en-radio:checked { border-color: ${o('--en-radio-selected-color', t('--en-color-action'))}; }
  .en-radio:checked::before { content: ''; inline-size: ${t('--en-size-choice-dot')}; block-size: ${t('--en-size-choice-dot')}; border-radius: ${t('--en-radius-pill')}; background: ${o('--en-radio-selected-color', t('--en-color-action'))}; }
  .en-radio:not(:disabled):active { border-color: ${t('--en-color-action-pressed')}; }
  .en-radio:disabled { cursor: default; background: ${t('--en-color-surface-subtle')}; border-color: ${t('--en-color-boundary')}; }
  .en-radio:disabled::before { background: ${t('--en-color-text-muted')}; }
  ${pressStyles(css `.en-radio`, css `.en-radio:not(:disabled):not([data-press='none']):is(:active, .en-choice:active > .en-radio)`, pressRecipes['radio'])}
  @media (forced-colors: active) {
    .en-radio { accent-color: auto; background: Canvas; border-color: CanvasText; }
    .en-radio:checked { background: Canvas; border-color: CanvasText; }
    .en-radio:checked::before { background: CanvasText; }
    .en-radio:not(:disabled):active { border-color: Highlight; box-shadow: none; }
    .en-radio:disabled { background: Canvas; border-color: GrayText; }
    .en-radio:disabled::before { background: GrayText; }
    .en-radio:focus-visible { outline-color: CanvasText; }
  }
`;

import { css } from 'lit';
import { token as t } from './values.js';
const track = css `
  block-size: ${t('--en-size-range-track')};
  border: 0;
  border-radius: ${t('--en-radius-pill')};
  background: ${t('--en-color-boundary')};
`;
const thumb = css `
  box-sizing: border-box;
  inline-size: ${t('--en-size-icon')};
  block-size: ${t('--en-size-icon')};
  border: ${t('--en-border-width')} solid ${t('--en-color-action')};
  border-radius: ${t('--en-radius-pill')};
  background: ${t('--en-color-action')};
`;
const thumbFocus = css `outline: ${t('--en-focus-width')} solid ${t('--en-color-focus')}; outline-offset: ${t('--en-focus-offset')};`;
/** Paint native range affordances only where the relevant thumb is exposed.
 * Other engines keep the native range and its whole-control focus outline.
 */
export const rangeStyles = css `
  @supports selector(input::-webkit-slider-thumb) {
    .en-range { appearance: none; background: none; cursor: pointer; }
    .en-range::-webkit-slider-runnable-track { ${track} }
    .en-range::-webkit-slider-thumb { appearance: none; ${thumb} margin-block-start: calc((${t('--en-size-range-track')} - ${t('--en-size-icon')}) / 2); }
    /* Exposed native thumbs own focus. A global halo must not reintroduce a
       rectangular range-host ring; native unsupported fallbacks keep that route. */
    .en-range, .en-range:focus-visible { box-shadow: none; }
    .en-range:focus-visible { outline: none; }
    .en-range:focus-visible::-webkit-slider-thumb { ${thumbFocus} }
    .en-range:disabled::-webkit-slider-thumb { background: ${t('--en-color-text-muted')}; border-color: ${t('--en-color-text-muted')}; }
    @media (forced-colors: active) {
      .en-range::-webkit-slider-runnable-track { background: ButtonText; }
      .en-range::-webkit-slider-thumb { background: Highlight; border-color: Highlight; }
      .en-range:disabled::-webkit-slider-thumb { background: GrayText; border-color: GrayText; }
      .en-range:focus-visible::-webkit-slider-thumb { outline-color: CanvasText; }
    }
  }
  @supports selector(input::-moz-range-thumb) {
    .en-range { appearance: none; background: none; cursor: pointer; }
    .en-range::-moz-range-track { ${track} }
    .en-range::-moz-range-thumb { ${thumb} }
    /* Exposed native thumbs own focus. A global halo must not reintroduce a
       rectangular range-host ring; native unsupported fallbacks keep that route. */
    .en-range, .en-range:focus-visible { box-shadow: none; }
    .en-range:focus-visible { outline: none; }
    .en-range:focus-visible::-moz-range-thumb { ${thumbFocus} }
    .en-range:disabled::-moz-range-thumb { background: ${t('--en-color-text-muted')}; border-color: ${t('--en-color-text-muted')}; }
    @media (forced-colors: active) {
      .en-range::-moz-range-track { background: ButtonText; }
      .en-range::-moz-range-thumb { background: Highlight; border-color: Highlight; }
      .en-range:disabled::-moz-range-thumb { background: GrayText; border-color: GrayText; }
      .en-range:focus-visible::-moz-range-thumb { outline-color: CanvasText; }
    }
  }
  .en-range:disabled { cursor: default; }
`;

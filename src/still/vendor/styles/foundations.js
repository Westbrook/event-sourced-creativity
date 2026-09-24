import { css } from 'lit';
import { token as t } from './internal/values.js';
import { focusScrollStylesFor } from './internal/focus-core.js';
import { sizedStyles } from './internal/sizing.js';
export const blockHostStyles = css `:host { display: block; min-inline-size: 0; }`;
export const inlineHostStyles = css `:host { display: inline-block; vertical-align: middle; max-inline-size: 100%; }`;
/** Icons inherit contextual action/status color and do not introduce a text baseline box. */
export const iconHostStyles = css `:host { display: inline-flex; align-items: center; justify-content: center; color: inherit; line-height: 0; vertical-align: middle; }`;
export const sizeStyles = css `
  :host, .en-foundation { --_en-size-small: 0; --_en-size-medium: 1; --_en-size-large: 0; }
  :host([size='inherit']), .en-foundation[data-size='inherit'] { --_en-size-small: inherit; --_en-size-medium: inherit; --_en-size-large: inherit; }
  :host([size='small']), .en-foundation[data-size='small'] { --_en-size-small: 1; --_en-size-medium: 0; --_en-size-large: 0; }
  :host([size='medium']), .en-foundation[data-size='medium'] { --_en-size-small: 0; --_en-size-medium: 1; --_en-size-large: 0; }
  :host([size='large']), .en-foundation[data-size='large'] { --_en-size-small: 0; --_en-size-medium: 0; --_en-size-large: 1; }
`;
/** Scoped baseline for a shadow root, or an explicitly opted-in .en-foundation region. */
export const foundationStyles = sizedStyles(css `
  ${sizeStyles}
  :host, .en-foundation {
    box-sizing: border-box;
    color: ${t('--en-color-text')};
    font-family: ${t('--en-font-ui-family')};
    font-style: ${t('--en-font-ui-style')};
    letter-spacing: ${t('--en-font-ui-tracking')};
    font-size: ${t('--en-font-ui-size')};
    font-weight: ${t('--en-font-ui-weight')};
    line-height: ${t('--en-font-ui-line-height')};
    text-align: start;
  }
  :host *, :host *::before, :host *::after,
  .en-foundation *, .en-foundation *::before, .en-foundation *::after { box-sizing: border-box; }
  :host([hidden]), :host [hidden], .en-foundation [hidden] { display: none !important; }
  :host :where(button, input, textarea, select), .en-foundation :where(button, input, textarea, select) {
    font: inherit;
    letter-spacing: inherit;
    word-spacing: inherit;
  }
  ${focusScrollStylesFor(css `:where(:host([tabindex]), .en-foundation[tabindex]),
    :where(:host, .en-foundation) :where(button, input, textarea, select, a[href], [tabindex])`)}
  :host(:focus-visible), .en-foundation:focus-visible {
    outline: ${t('--en-focus-width')} solid ${t('--en-color-focus')};
    outline-offset: ${t('--en-focus-offset')};
  }
  .en-sr-only {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    padding: 0;
    border: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .en-break { overflow-wrap: anywhere; }
  .en-truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  @media (forced-colors: active) {
    :host, .en-foundation { color: CanvasText; }
    :host(:focus-visible), .en-foundation:focus-visible { outline-color: Highlight; }
  }
`);
// Preserve the existing foundation entry while allowing isolated typography adoption.
export { typographyStyles } from './typography.js';

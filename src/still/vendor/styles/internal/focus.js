import { css } from 'lit';
import { token as t, override as o } from './values.js';
import { focusStylesFor, focusValues as values } from './focus-core.js';
import { buttonFocusStyles } from './button-rules.js';
// Existing internal imports retain their contract; leaf styles use the pure core.
export { focusStylesFor, focusVisibleStylesFor, focusScrollStylesFor, focusExtent, focusClearance } from './focus-core.js';
export const focusStyles = css `
  ${buttonFocusStyles}
  ${focusStylesFor(css `.en-accordion-trigger`, { family: 'button' })}
  ${focusStylesFor(css `:where(.en-input, .en-textarea, .en-select, .en-color-control)`, { family: 'input' })}
  ${focusStylesFor(css `.en-option`, { family: 'option' })}
  ${focusStylesFor(css `:where(.en-link, .en-control:not(.en-color-control), .en-checkbox, .en-radio, .en-switch,
    .en-range, .en-tab, .en-split-separator, .en-rating-item)`)}
`;
/** One noninteractive frame around a painted field or complete compound field.
 * The pseudo-element never intercepts pointer input or clips native focus. */
const fieldHalo = values({ family: 'input' });
export const fieldFocusStyles = css `
  .en-field-focus-frame {
    position: relative;
    min-inline-size: 0;
    --_en-field-focus-accent-width: ${o('--en-input-focus-accent-width', t('--en-focus-accent-width'))};
  }
  .en-field-focus-frame:not(.en-number-group) { display: grid; }
  .en-field-focus-frame > :is(input, textarea) { display: block; }
  .en-field-focus-frame::after {
    content: '';
    position: absolute;
    pointer-events: none;
    inset-inline: 0;
    inset-block-end: 0;
    box-sizing: border-box;
    block-size: max(var(--_en-field-focus-accent-width), ${o('--en-control-radius', t('--en-radius-control'))});
    border-end-start-radius: ${o('--en-control-radius', t('--en-radius-control'))};
    border-end-end-radius: ${o('--en-control-radius', t('--en-radius-control'))};
    border-block-end: var(--_en-field-focus-accent-width) solid ${o('--en-input-focus-accent-color', t('--en-color-focus'))};
    clip-path: inset(calc(100% - var(--_en-field-focus-accent-width)) 0 0 0);
    transform: scaleX(0);
    transform-origin: center;
    transition: transform ${t('--en-duration-focus-exit')} ${t('--en-ease-focus-exit')};
  }
  .en-number-group.en-field-focus-frame {
    box-shadow: 0 0 0 0 ${fieldHalo.haloColor};
    transition: box-shadow ${t('--en-duration-focus-exit')} ${t('--en-ease-focus-exit')};
  }
  .en-number-group.en-field-focus-frame:focus-within {
    box-shadow: 0 0 0 ${fieldHalo.haloWidth} ${fieldHalo.haloColor};
    transition-duration: ${t('--en-duration-focus-enter')};
    transition-timing-function: ${t('--en-ease-focus-enter')};
  }
  .en-field-focus-frame:focus-within::after {
    transform: scaleX(1);
    transition-duration: ${t('--en-duration-focus-enter')};
    transition-timing-function: ${t('--en-ease-focus-enter')};
  }
  @media (prefers-reduced-motion: reduce) {
    .en-field-focus-frame::after, .en-field-focus-frame:focus-within::after,
    .en-number-group.en-field-focus-frame, .en-number-group.en-field-focus-frame:focus-within { transition: none; }
  }
  @media (forced-colors: active) {
    .en-field-focus-frame::after, .en-field-focus-frame:focus-within::after { border-block-end-color: Highlight; transition: none; }
    .en-number-group.en-field-focus-frame, .en-number-group.en-field-focus-frame:focus-within { box-shadow: none; transition: none; }
  }
`;

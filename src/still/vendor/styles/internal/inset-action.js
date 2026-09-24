import { css } from 'lit';
import { token as t, override as o } from './values.js';
import { focusExtent } from './focus-core.js';
import { textControlBlockSize } from './control-size.js';
import { pointerTargetSize, controlTargetSize } from './target-size.js';
/** Resolve on the enclosing frame, before descendants establish their own size
 * scope. Only the actual action receives these private context values. */
export function insetActionContext(frame, action, radius, border) {
    return css `
    ${frame} {
      --_en-inset-gap: max(${t('--en-space-1')}, ${focusExtent({ family: 'button' })});
      --_en-inset-radius: max(0px, calc(${radius} - ${border} - var(--_en-inset-gap)));
      --_en-inset-size: max(${pointerTargetSize()}, calc(${textControlBlockSize()} - 2 * var(--_en-inset-gap)));
      --_en-inset-padding: max(0px, calc(${t('--en-space-control-block')} - var(--_en-inset-gap)));
    }
    ${action} {
      --_en-inset-action-radius: var(--_en-inset-radius);
      --_en-inset-action-size: var(--_en-inset-size);
      --_en-inset-action-padding: var(--_en-inset-padding);
      margin: var(--_en-inset-gap);
      flex-shrink: 0;
    }
    @media (any-pointer: coarse) {
      ${frame} { --_en-inset-size: max(${pointerTargetSize(true)}, calc(${textControlBlockSize(true)} - 2 * var(--_en-inset-gap))); }
    }
  `;
}
/** Applied after ordinary button geometry, including its coarse-pointer rules.
 * Fallbacks preserve the existing geometry when there is no embedded context. */
export const insetButtonStyles = css `
  .en-button {
    padding-block: var(--_en-inset-action-padding, ${t('--en-space-control-block')});
    border-radius: var(--_en-inset-action-radius, ${o('--en-button-radius', o('--en-control-radius', t('--en-radius-control')))});
  }
  .en-button:not(.en-icon-button) { min-block-size: var(--_en-inset-action-size, var(--_en-text-control-block-size)); }
  .en-button.en-icon-button:not([data-icon-only]) {
    min-block-size: var(--_en-inset-action-size, ${controlTargetSize()});
    min-inline-size: var(--_en-inset-action-size, ${controlTargetSize()});
  }
  .en-button[data-icon-only] {
    min-block-size: var(--_en-inset-action-size, var(--_en-icon-button-side));
    min-inline-size: var(--_en-inset-action-size, var(--_en-icon-button-side));
  }
  @media (any-pointer: coarse) {
    .en-button.en-icon-button:not([data-icon-only]) {
      min-block-size: var(--_en-inset-action-size, ${controlTargetSize(true)});
      min-inline-size: var(--_en-inset-action-size, ${controlTargetSize(true)});
    }
  }
`;

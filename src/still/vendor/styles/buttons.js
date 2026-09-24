import { insetButtonStyles } from './internal/inset-action.js';
import { css } from 'lit';
import { sizedStyles } from './internal/sizing.js';
import { buttonAppearanceStyles, buttonFocusStyles, buttonForcedHoverStyles } from './internal/button-rules.js';
import { controlBlockSizeStyles, controlSurfaceStyles, controlEnvelopeStyles, controlDisabledStyles, controlTouchBlockStyles, controlTouchInlineStyles, controlReducedMotionStyles, controlForcedColorStyles, controlForcedDisabledStyles } from './internal/control-shared.js';
/** Native action leaf: no field, picker, choice, range or form stylesheet imports. */
export const buttonStyles = sizedStyles(css `
  ${controlBlockSizeStyles(css `.en-button:not(.en-icon-button), .en-button[data-icon-only]`)}
  ${controlSurfaceStyles(css `.en-button`)}
  ${controlEnvelopeStyles(css `.en-button:not(.en-icon-button)`)}
  ${buttonAppearanceStyles}
  ${controlDisabledStyles(css `:is(.en-button):is(:disabled, [aria-disabled='true'])`)}
  ${buttonFocusStyles}
  @media (any-pointer: coarse) {
    ${controlBlockSizeStyles(css `.en-button:not(.en-icon-button), .en-button[data-icon-only]`, true)}
    ${controlTouchBlockStyles(css `.en-button`)}
    ${controlEnvelopeStyles(css `.en-button:not(.en-icon-button)`)}
    ${controlTouchInlineStyles(css `.en-icon-button`)}
  }
  @media (prefers-reduced-motion: reduce) { ${controlReducedMotionStyles(css `.en-button`)} }
  @media (forced-colors: active) {
    ${controlForcedColorStyles(css `.en-button`)}
    ${controlForcedDisabledStyles(css `:is(.en-button):is(:disabled, [aria-disabled='true'])`)}
    ${buttonForcedHoverStyles}
  }
  ${insetButtonStyles}
`);

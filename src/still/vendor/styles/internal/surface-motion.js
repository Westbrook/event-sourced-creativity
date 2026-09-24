import { css } from 'lit';
import { token as t } from './values.js';
const enter = css `clamp(0ms, var(--en-dialog-enter-duration, ${t('--en-duration-enter')}), 500ms)`;
const exit = css `clamp(0ms, var(--en-dialog-exit-duration, ${t('--en-duration-exit')}), 500ms)`;
const offset = css `clamp(0px, ${t('--en-motion-surface-offset')}, 8px)`;
const scale = css `clamp(.95, ${t('--en-motion-surface-scale')}, 1)`;
const phase = css `var(--_en-surface-duration, 0ms) var(--_en-surface-ease, linear)`;
/** Compose with the focus helper so focus halo and surface paint keep separate timing. */
export const surfaceTransitions = css `opacity var(--_en-surface-opacity-duration, 0ms) var(--_en-surface-ease, linear), translate ${phase}, scale ${phase}, display ${phase} allow-discrete, overlay ${phase} allow-discrete`;
/**
 * Only native display/overlay transitions retain exit paint. The adapter closes
 * and removes focus participation immediately. Anchored rectangles never move.
 */
export function nativeSurfaceMotion(base, open, closed, entry, pseudoElement = css ``, family = 'popup') {
    const enter = family === 'dialog' ? css `clamp(0ms, var(--en-dialog-enter-duration, ${t('--en-duration-enter')}), 500ms)` : css `clamp(0ms, var(--en-popup-enter-duration, ${t('--en-duration-enter')}), 500ms)`;
    const exit = family === 'dialog' ? css `clamp(0ms, var(--en-dialog-exit-duration, ${t('--en-duration-exit')}), 500ms)` : css `clamp(0ms, var(--en-popup-exit-duration, ${t('--en-duration-exit')}), 500ms)`;
    const enterEase = family === 'dialog' ? css `var(--en-dialog-enter-ease, ${t('--en-ease-enter')})` : css `var(--en-popup-enter-ease, ${t('--en-ease-enter')})`;
    const exitEase = family === 'dialog' ? css `var(--en-dialog-exit-ease, ${t('--en-ease-exit')})` : css `var(--en-popup-exit-ease, ${t('--en-ease-exit')})`;
    // Pseudo-elements must sit outside :where(), including the native select picker.
    const restSelector = css `:where(${base})${pseudoElement}`;
    const openSelector = css `${open}${pseudoElement}`;
    const closedSelector = css `${closed}${pseudoElement}`;
    return css `
    @supports (transition-behavior: allow-discrete) and (overlay: auto) {
      ${restSelector} {
        --_en-surface-duration: ${exit};
        --_en-surface-opacity-duration: ${exit};
        --_en-surface-ease: ${exitEase};
        opacity: 0;
        transition: ${surfaceTransitions};
      }
      ${openSelector} {
        --_en-surface-duration: ${enter};
        /* Modal and menu entry keep content opaque. Fade surfaces reverse
           from their current opacity when reopened during exit. */
        --_en-surface-opacity-duration: ${entry === 'fade' ? enter : css `0ms`};
        --_en-surface-ease: ${enterEase};
        opacity: 1;
      }
      ${closedSelector} { pointer-events: none; }
      ${entry === 'elevation' ? css `
        /* Opaque command content and its primary focus contour are immediate.
           Elevation adds entry paint without corrupting measured iPhone geometry. */
        @keyframes en-surface-elevation { from { box-shadow: none; } }
        ${openSelector} { animation: en-surface-elevation ${enter} ${enterEase}; }
      ` : css ``}
      @starting-style { ${openSelector} { opacity: ${entry === 'fade' ? 0 : 1}; } }
    }
    @media (prefers-reduced-motion: reduce) {
      ${restSelector} { transition: none !important; animation: none !important; }
    }
    @media (forced-colors: active) {
      ${restSelector} { animation: none; }
    }
  `;
}
/** Palette styles provide an origin that keeps centering independent of this scale. */
export const modalSurfaceMotion = css `
  ${nativeSurfaceMotion(css `dialog:is(.en-dialog, .en-drawer)`, css `dialog:is(.en-dialog, .en-drawer)[open]`, css `dialog:is(.en-dialog, .en-drawer):not([open])`, 'move', css ``, 'dialog')}
  @supports (transition-behavior: allow-discrete) and (overlay: auto) {
    dialog:is(.en-dialog, .en-drawer) {
      --_en-surface-x: 0px;
      --_en-surface-y: ${offset};
      translate: var(--_en-surface-x) var(--_en-surface-y);
      scale: ${scale};
    }
    /* Share modal travel distance; attachment selects its axis and sign.
       Keep the drawer unscaled so its attached edge stays flush. */
    dialog.en-drawer { --_en-surface-x: ${offset}; --_en-surface-y: 0px; scale: 1; }
    dialog.en-drawer:is([data-placement='start'], [data-placement='left']) { --_en-surface-x: calc(-1 * ${offset}); }
    dialog.en-drawer[data-placement='end']:dir(rtl) { --_en-surface-x: calc(-1 * ${offset}); }
    dialog.en-drawer[data-placement='start']:dir(rtl) { --_en-surface-x: ${offset}; }
    dialog.en-drawer:is([data-placement='top'], [data-placement='bottom']) { --_en-surface-x: 0px; --_en-surface-y: ${offset}; }
    dialog.en-drawer[data-placement='top'] { --_en-surface-y: calc(-1 * ${offset}); }
    dialog:is(.en-dialog, .en-drawer)[open] { translate: 0px 0px; scale: 1; }
    @starting-style {
      dialog:is(.en-dialog, .en-drawer)[open] {
        translate: var(--_en-surface-x) var(--_en-surface-y);
        scale: ${scale};
      }
      dialog.en-drawer[open] { scale: 1; }
    }
    dialog:is(.en-dialog, .en-drawer)::backdrop {
      opacity: 0;
      transition: opacity ${exit} var(--en-dialog-exit-ease, ${t('--en-ease-exit')}), display ${exit} allow-discrete, overlay ${exit} allow-discrete;
    }
    dialog:is(.en-dialog, .en-drawer)[open]::backdrop {
      opacity: 1;
      transition: opacity ${enter} var(--en-dialog-enter-ease, ${t('--en-ease-enter')}), display ${enter} allow-discrete, overlay ${enter} allow-discrete;
    }
    dialog:is(.en-dialog, .en-drawer):not([open])::backdrop { pointer-events: none; }
    @starting-style { dialog:is(.en-dialog, .en-drawer)[open]::backdrop { opacity: 0; } }
  }
  @media (prefers-reduced-motion: reduce) {
    dialog:is(.en-dialog, .en-drawer) { translate: none !important; scale: none !important; }
    dialog:is(.en-dialog, .en-drawer)::backdrop { transition: none !important; }
  }
`;

import { css } from 'lit';
import { nativeSurfaceMotion, surfaceTransitions, modalSurfaceMotion } from './internal/surface-motion.js';
import { sizedStyles } from './internal/sizing.js';
import { focusStylesFor, focusClearance } from './internal/focus.js';
import { defaultCSSValue } from '../tokens/defaults.js';
import { token as t, override as o } from './internal/values.js';
/** Generated default only; an element's responsiveQuery can select a different threshold. */
export const overlayResponsiveQuery = `(width < ${defaultCSSValue('--en-layout-dialog-collapse')})`;
/** Native dialog/popover surfaces. Elements supply positioning, modality, and focus behavior. */
export const overlayStyles = sizedStyles(css `
  .en-dialog, .en-drawer, .en-popover, .en-tooltip {
    box-sizing: border-box;
    min-inline-size: 0;
    max-inline-size: min(${o('--en-overlay-max-inline-size', t('--en-layout-form-max'))}, calc(100% - ${t('--en-space-8')}));
    max-block-size: ${o('--en-overlay-max-block-size', css `calc(100dvh - ${t('--en-space-8')})`)};
    padding: ${o('--en-overlay-padding', t('--en-space-panel'))};
    border: ${t('--en-border-width')} solid ${o('--en-overlay-border-color', t('--en-color-boundary'))};
    border-radius: ${o('--en-overlay-radius', t('--en-radius-dialog'))};
    background: ${o('--en-overlay-background', t('--en-color-surface-raised'))};
    color: ${o('--en-overlay-color', t('--en-color-text'))};
    font: inherit;
    text-align: start;
    overflow: auto;
    box-shadow: ${t('--en-shadow-overlay')};
  }
  ${nativeSurfaceMotion(css `.en-popover[popover]`, css `.en-popover:popover-open`, css `.en-popover[popover]:not(:popover-open)`, 'fade')}
  ${nativeSurfaceMotion(css `.en-tooltip[popover]`, css `.en-tooltip:popover-open`, css `.en-tooltip[popover]:not(:popover-open)`, 'fade')}
  ${modalSurfaceMotion}
  .en-dialog { position: fixed; inset: 0; margin: auto; box-shadow: ${t('--en-shadow-dialog')}; }
  dialog.en-dialog, dialog.en-drawer { flex-direction: column; gap: ${t('--en-space-4')}; }
  dialog.en-dialog[open], dialog.en-drawer[open] { display: flex; }
  dialog.en-dialog:not([open]), dialog.en-drawer:not([open]) { display: none; }
  .en-dialog::backdrop, .en-drawer::backdrop { background: ${t('--en-color-scrim')}; }
  .en-overlay-header, .en-overlay-footer { display: flex; align-items: center; flex-wrap: wrap; gap: ${t('--en-space-3')}; min-inline-size: 0; }
  .en-overlay-header { justify-content: space-between; }
  .en-overlay-footer { justify-content: flex-end; gap: ${t('--en-space-actions')}; }
  .en-overlay-header > slot, .en-overlay-footer > slot { display: contents; }
  .en-overlay-body {
    --_en-overlay-focus-clearance: ${focusClearance};
    min-inline-size: 0;
    min-block-size: 0;
    /* Expand the scrollport without moving content or changing the surrounding gaps. */
    margin: calc(0px - var(--_en-overlay-focus-clearance));
    padding: var(--_en-overlay-focus-clearance);
    scroll-padding: var(--_en-overlay-focus-clearance);
    overflow: auto;
  }
  .en-overlay-close { margin-inline-start: auto; }
  .en-popover { position: fixed; display: flex; flex-direction: column; margin: 0; row-gap: ${t('--en-space-4')}; border-radius: ${o('--en-overlay-radius', t('--en-radius-container'))}; }
  [popover].en-popover:not(:popover-open), [popover].en-tooltip:not(:popover-open) { display: none; }
  .en-tooltip { position: fixed; inline-size: max-content; margin: 0; row-gap: ${t('--en-space-2')}; padding: ${o('--en-overlay-padding', t('--en-space-2'))}; border-radius: ${o('--en-overlay-radius', t('--en-radius-control'))}; overflow-wrap: break-word; }
  /* An outside separator is clipped at viewport-flush edges, even for a drawer
     that fills the whole viewport. Keep it separate from the immediate focus cue. */
  :where(.en-drawer) { outline: ${t('--en-border-width')} solid ${o('--en-overlay-border-color', t('--en-color-boundary'))}; outline-offset: 0; }
  ${focusStylesFor(css `:where(.en-dialog, .en-drawer)`, { family: 'overlay', baseShadow: t('--en-shadow-dialog'), baseTransitions: surfaceTransitions })}
  ${focusStylesFor(css `.en-popover`, { family: 'overlay', baseShadow: t('--en-shadow-overlay'), baseTransitions: surfaceTransitions })}
  .en-drawer {
    position: fixed;
    margin: 0;
    inset: auto;
    inset-block: 0;
    inset-inline-end: 0;
    inline-size: min(${o('--en-overlay-max-inline-size', t('--en-layout-form-max'))}, 100%);
    max-inline-size: 100%;
    block-size: 100%;
    max-block-size: 100%;
    border-radius: 0;
    border-width: 0;
    box-shadow: ${t('--en-shadow-dialog')};
  }
  .en-drawer[data-placement='start'] { inset-inline-end: auto; inset-inline-start: 0; }
  .en-drawer[data-placement='left'] { inset-inline: auto; left: 0; right: auto; }
  .en-drawer[data-placement='right'] { inset-inline: auto; left: auto; right: 0; }
  .en-drawer[data-placement='top'], .en-drawer[data-placement='bottom'] { inset-inline: 0; inline-size: 100%; block-size: auto; max-block-size: ${o('--en-overlay-max-block-size', css `calc(100dvh - ${t('--en-space-8')})`)}; }
  .en-drawer[data-placement='top'] { inset-block-start: 0; inset-block-end: auto; }
  .en-drawer[data-placement='bottom'] { inset-block-start: auto; inset-block-end: 0; }
  @media (forced-colors: active) {
    .en-dialog, .en-drawer, .en-popover, .en-tooltip { color: CanvasText; background: Canvas; border-color: CanvasText; box-shadow: none; }
    :where(.en-drawer) { outline-color: CanvasText; }
    :where(.en-dialog, .en-drawer, .en-popover):focus-visible { outline-color: Highlight; }
  }
`);

import { controlTargetSize } from './internal/target-size.js';
import { css } from 'lit';
import { nativeSurfaceMotion, surfaceTransitions } from './internal/surface-motion.js';
import { sizedStyles } from './internal/sizing.js';
import { optionPaint } from './internal/option-paint.js';
import { focusVisibleStylesFor, focusExtent } from './internal/focus.js';
import { token as t, override as o } from './internal/values.js';
const listRadius = o('--en-option-list-radius', o('--en-overlay-radius', t('--en-radius-container')));
const listPadding = css `max(${o('--en-option-list-padding', o('--en-overlay-padding', t('--en-space-1')))}, ${focusExtent({ family: 'option', inset: true })})`;
const listColor = o('--en-option-list-color', o('--en-overlay-color', t('--en-color-text')));
const listBackground = o('--en-option-list-background', o('--en-overlay-background', t('--en-color-surface-raised')));
const listGap = o('--en-option-list-gap', css `0px`);
const rowRadius = o('--en-option-radius', css `max(0px, ${listRadius} - ${listPadding} - ${t('--en-border-width')})`);
function rowGeometry(selector, radius = rowRadius) {
    return css `
    ${selector} {
      position: relative;
      display: flex;
      align-items: center;
      gap: ${t('--en-space-icon-label')};
      box-sizing: border-box;
      min-inline-size: ${t('--en-size-target-min')};
      min-block-size: ${controlTargetSize()};
      max-inline-size: 100%;
      inline-size: 100%;
      margin: 0;
      padding: ${o('--en-option-block-padding', t('--en-space-control-block'))} ${o('--en-option-inline-padding', t('--en-space-control-inline'))};
      border: 0;
      border-radius: ${radius};
      font: inherit;
      text-align: start;
      white-space: normal;
      overflow-wrap: anywhere;
      cursor: pointer;
    }
    @media (any-pointer: coarse) {
      ${selector} { min-block-size: ${controlTargetSize(true)}; }
    }
  `;
}
function commandPaint(base, active) {
    return optionPaint({
        base,
        hover: css `${base}:not([aria-disabled='true']):hover`,
        active,
        pressed: css `${base}:not([aria-disabled='true']):active`,
        disabled: css `${base}[aria-disabled='true']`,
        restBackground: css `transparent`, restColor: listColor,
        hoverBackground: t('--en-color-surface-subtle'),
    });
}
function commandFocus(active, rest) {
    return css `
    ${active} { z-index: 1; }
    ${focusVisibleStylesFor(active, { family: 'option', inset: true, restSelector: rest })}
    @media (forced-colors: active) {
      ${active} { outline-color: HighlightText; background: Highlight; color: HighlightText; }
    }
  `;
}
/** Menu surface only. The controller owns native-popover state and coordinates. */
export const menuStyles = sizedStyles(css `
  .en-menu {
    position: fixed;
    inset: auto;
    left: var(--_en-menu-x, 0px);
    top: var(--_en-menu-y, 0px);
    visibility: var(--_en-menu-visibility, hidden);
    display: flex;
    flex-direction: column;
    gap: ${listGap};
    box-sizing: border-box;
    margin: 0;
    inline-size: max-content;
    min-inline-size: min(${t('--en-layout-panel-preferred')}, ${o('--en-overlay-max-inline-size', t('--en-layout-form-max'))}, var(--_en-menu-viewport-width, calc(100dvw - ${t('--en-space-4')})));
    max-inline-size: min(${o('--en-overlay-max-inline-size', t('--en-layout-form-max'))}, var(--_en-menu-viewport-width, calc(100dvw - ${t('--en-space-4')})));
    max-block-size: min(var(--_en-menu-max-height, calc(100dvh - ${t('--en-space-8')})), ${o('--en-option-list-max-block-size', o('--en-overlay-max-block-size', t('--en-layout-panel-preferred')))});
    padding: ${listPadding};
    border: ${t('--en-border-width')} solid ${o('--en-option-list-border-color', o('--en-overlay-border-color', t('--en-color-boundary')))};
    border-radius: ${listRadius};
    background: ${listBackground};
    color: ${listColor};
    box-shadow: ${o('--en-option-list-shadow', t('--en-shadow-overlay'))};
    font: inherit;
    text-align: start;
    overflow: auto;
    overscroll-behavior: contain;
    scroll-behavior: auto;
  }
  ${nativeSurfaceMotion(css `.en-menu[popover]`, css `.en-menu:popover-open`, css `.en-menu[popover]:not(:popover-open)`, 'elevation')}
  .en-menu > slot { display: contents; }
  ::slotted(hr[role='separator']) { inline-size: 100%; box-sizing: border-box; border: 0; border-block-start: ${t('--en-border-width')} solid ${t('--en-color-line')}; margin-block: ${t('--en-space-1')}; margin-inline: 0; }
  .en-menu[data-replaced] { background: transparent; border-color: transparent; box-shadow: none; pointer-events: none; }
  .en-menu[data-replaced] > .en-menu-back,
  .en-menu[data-replaced] > slot::slotted(:not(en-menu)) { visibility: hidden; }
  .en-menu[data-replaced] > slot::slotted(en-menu) { pointer-events: auto; }
  .en-menu[data-replacement] { inline-size: var(--_en-menu-replacement-width); min-inline-size: 0; pointer-events: auto; }
  ${rowGeometry(css `.en-menu-back`)}
  ${commandPaint(css `.en-menu-back`, css `.en-menu-back:focus`)}
  .en-menu-back { appearance: none; text-align: start; }
  .en-menu-back-icon { inline-size: 1em; block-size: 1em; flex: 0 0 auto; transform: rotate(90deg); }
  :host(:dir(rtl)) .en-menu-back-icon { transform: rotate(-90deg); }
  ${commandFocus(css `.en-menu-back:focus`, css `.en-menu-back`)}
  .en-menu[popover]:not(:popover-open), .en-menu[hidden] { display: none; }
  ${focusVisibleStylesFor(css `.en-menu:focus`, { family: 'overlay', inset: true, restSelector: css `.en-menu`, baseShadow: o('--en-option-list-shadow', t('--en-shadow-overlay')), baseTransitions: surfaceTransitions })}
  @media (forced-colors: active) {
    .en-menu { color: CanvasText; background: Canvas; border-color: CanvasText; box-shadow: none; }
    .en-menu:focus { outline-color: Highlight; }
  }
`);
/** Native menu-item focus and action paint; no checked/selected state is implied. */
export const menuItemStyles = sizedStyles(css `
  :host(:focus-within) { position: relative; z-index: 1; }
  ${rowGeometry(css `.en-menu-item`)}
  ${commandPaint(css `.en-menu-item`, css `.en-menu-item:not([aria-disabled='true']):focus`)}
  .en-menu-item { appearance: none; }
  .en-menu-item-check, .en-menu-item-submenu { display: inline-flex; flex: 0 0 auto; inline-size: 1em; block-size: 1em; }
  .en-menu-item-check svg, .en-menu-item-submenu svg { inline-size: 100%; block-size: 100%; }
  .en-menu-item-submenu { transform: rotate(-90deg); }
  :host(:dir(rtl)) .en-menu-item-submenu { transform: rotate(90deg); }
  .en-menu-item-label { flex: 1 1 auto; min-inline-size: 0; }
  .en-menu-item-prefix, .en-menu-item-suffix, .en-menu-item-shortcut { display: contents; }
  .en-menu-item-shortcut { font-family: ${t('--en-font-code-family')}; }
  ::slotted([slot='shortcut']) { margin-inline-start: auto; }
  .en-menu-item[aria-disabled='true'] { cursor: default; }
  @media (forced-colors: active) {
    .en-menu-item { color: CanvasText; background: Canvas; }
    .en-menu-item[aria-disabled='true'] { color: GrayText; }
  }
  ${commandFocus(css `.en-menu-item:focus`, css `.en-menu-item`)}
  @media (forced-colors: active) {
    .en-menu-item[aria-disabled='true']:focus { color: GrayText; background: Canvas; outline-color: CanvasText; }
  }
`);
/** Group layout only. Buttons retain their own appearance, names and target floors. */
export const toolbarStyles = sizedStyles(css `
  .en-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: ${t('--en-space-actions')};
    min-inline-size: 0;
    max-inline-size: 100%;
  }
  .en-toolbar > slot { display: contents; }
  .en-toolbar[aria-orientation='vertical'], .en-toolbar[data-orientation='vertical'] {
    flex-direction: column;
    align-items: stretch;
  }
  .en-toolbar > :not(slot) { min-inline-size: 0; max-inline-size: 100%; }
  .en-toolbar > slot::slotted(*) { min-inline-size: 0; max-inline-size: 100%; }
`);
/** Compose with overlayStyles/controlStyles; only result rows normally scroll. */
export const commandPaletteStyles = sizedStyles(css `
  .en-command-palette {
    position: fixed;
    inset: auto;
    left: calc(var(--_en-command-viewport-left, 0px) + var(--_en-command-viewport-width, 100dvw) / 2);
    top: calc(var(--_en-command-viewport-top, 0px) + var(--_en-command-viewport-height, 100dvh) / 2);
    transform: translate(-50%, -50%);
    /* Individual scale composes outside the centering transform. The layout
       origin is already the viewport center; scaling around it avoids drift. */
    transform-origin: 0 0;
    margin: 0;
    inline-size: min(${o('--en-overlay-max-inline-size', t('--en-layout-form-max'))}, max(0px, calc(var(--_en-command-viewport-width, 100dvw) - ${t('--en-space-8')})));
    max-inline-size: max(0px, calc(var(--_en-command-viewport-width, 100dvw) - ${t('--en-space-8')}));
    max-block-size: min(${o('--en-overlay-max-block-size', css `100dvh`)}, max(0px, calc(var(--_en-command-viewport-height, 100dvh) - ${t('--en-space-8')})));
    /* At exceptionally short viewports, retain outer scroll reachability rather
       than clipping the query/close controls to preserve a fixed composition. */
    overflow: auto;
    scroll-behavior: auto;
  }
  .en-command-palette > .en-overlay-header, .en-command-palette > .en-overlay-footer { flex: none; }
  .en-command-palette > .en-overlay-body { display: flex; min-block-size: 0; overflow: visible; }
  .en-command-palette-content {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-inline-size: 0;
    min-block-size: 0;
    gap: ${t('--en-space-label-control')};
  }
  .en-command-palette-content > slot { display: contents; }
  .en-command-palette-content > .en-label {
    flex: none;
    color: ${t('--en-color-text')};
    font-weight: ${t('--en-font-label-strong-weight')};
    overflow-wrap: anywhere;
  }
  .en-command-palette-content > .en-field-focus-frame { flex: none; }
  .en-command-palette-input { flex: none; inline-size: 100%; }
  .en-command-list {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    gap: ${listGap};
    box-sizing: border-box;
    min-inline-size: 0;
    min-block-size: 0;
    max-block-size: ${o('--en-option-list-max-block-size', t('--en-layout-panel-preferred'))};
    margin: 0;
    padding: ${listPadding};
    border: 0;
    border-radius: ${listRadius};
    background: ${listBackground};
    color: ${listColor};
    overflow: auto;
    overscroll-behavior: contain;
    scroll-behavior: auto;
  }
  .en-command-list:empty { display: none; }
  ${rowGeometry(css `.en-command-option`, o('--en-option-radius', css `max(0px, ${listRadius} - ${listPadding})`))}
  .en-command-option { flex: none; }
  ${commandPaint(css `.en-command-option`, css `.en-command-option:not([aria-disabled='true'])[data-active]`)}
  .en-command-label { flex: 1 1 auto; min-inline-size: 0; }
  .en-command-shortcut { flex: 0 1 auto; min-inline-size: 0; margin-inline-start: auto; font-family: ${t('--en-font-code-family')}; }
  .en-command-shortcut:empty { display: none; }
  .en-command-option[aria-disabled='true'] { cursor: default; }
  .en-command-status { flex: none; margin: 0; color: ${t('--en-color-text-muted')}; line-height: ${t('--en-font-body-line-height')}; overflow-wrap: anywhere; }
  .en-command-status:empty { display: none; }
  @media (forced-colors: active) {
    .en-command-list, .en-command-option { color: CanvasText; background: Canvas; }
    .en-command-status { color: CanvasText; }
    .en-command-option[aria-disabled='true'] { color: GrayText; }
  }
  ${commandFocus(css `.en-command-option:not([aria-disabled='true'])[data-active]`, css `.en-command-option`)}
`);

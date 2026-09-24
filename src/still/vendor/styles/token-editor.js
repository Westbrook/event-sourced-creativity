import { pressStyles } from './internal/press.js';
import { pressRecipes } from './internal/press-recipes.js';
import { fieldPresentation } from './internal/field-presentation.js';
import { controlTargetSize } from './internal/target-size.js';
import { css } from 'lit';
import { descriptionStyles } from './internal/description.js';
import { sizedStyles } from './internal/sizing.js';
import { controlSurfaceStyles, controlDisabledStyles } from './internal/control-shared.js';
import { focusStylesFor, focusVisibleStylesFor, focusExtent } from './internal/focus.js';
import { optionPaint } from './internal/option-paint.js';
import { nativeSurfaceMotion } from './internal/surface-motion.js';
import { token as t, override as o } from './internal/values.js';
/** Editing geometry shares control, option, focus and overlay theme families. */
export const tokenEditorStyles = sizedStyles(css `
 :host{display:block;min-inline-size:0;color:${t('--en-color-text')};font:inherit}
 ${descriptionStyles}
 .en-description{--_en-field-gap:${o('--en-field-gap', t('--en-space-label-control'))}}
 .label{display:block;font-weight:${t('--en-font-label-strong-weight')};margin-block-end:${o('--en-field-gap', t('--en-space-2'))}}
 ${controlSurfaceStyles(css `.editor`)}
 .editor{padding-inline:${o('--en-input-inline-padding', o('--en-control-inline-padding', t('--en-space-control-inline')))};background:${o('--en-input-background', o('--en-control-background', t('--en-color-surface')))};color:${o('--en-input-color', o('--en-control-color', t('--en-color-text')))};font: ${t('--en-font-input-weight')} ${t('--en-font-input-size')} / ${t('--en-font-input-line-height')} ${t('--en-font-input-family')}; font-style: ${t('--en-font-input-style')}; letter-spacing: ${t('--en-font-input-tracking')};min-block-size:7rem;max-block-size:var(--en-editor-max-size,20rem);overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}
 ${fieldPresentation(css `.editor`, css `.editor[aria-invalid='true']`)}
 ${focusStylesFor(css `.editor`, { family: 'input' })}
 ${controlDisabledStyles(css `.editor[aria-disabled=true]`)}
 [data-token]{
  box-sizing:border-box;position:relative;display:inline-flex;align-items:center;justify-content:center;vertical-align:middle;
  max-inline-size:100%;min-inline-size:var(--en-editor-token-min-size,2rem);min-block-size:var(--en-editor-token-min-size,2rem);
  margin-inline:calc(var(--en-editor-token-gap,.25rem) / 2);margin-block:.125em;
  border:${t('--en-border-width')} solid ${o('--en-editor-token-border-color', t('--en-color-line'))};
  border-radius:${o('--en-editor-token-radius', t('--en-radius-control'))};
  padding:var(--en-editor-token-block-padding,.125em) var(--en-editor-token-inline-padding,.375em);
  background:${o('--en-editor-token-background', t('--en-color-surface-subtle'))};color:${o('--en-editor-token-color', t('--en-color-text'))};
  font:inherit;text-align:start;text-decoration:none;white-space:pre-wrap;overflow-wrap:anywhere;
 }
 [part~="token-content"]{display:block;min-inline-size:0;max-inline-size:100%}
 button[data-token]{cursor:pointer;min-inline-size:max(var(--en-editor-token-min-size,2rem),${controlTargetSize(false, t('--en-size-target-min'))});min-block-size:max(var(--en-editor-token-min-size,2rem),${controlTargetSize(false, t('--en-size-target-min'))})}
 @media(hover:hover){button[data-token]:not(:disabled):hover{background:${o('--en-editor-token-hover-background', t('--en-color-selected'))}}}
 button[data-token]:not(:disabled):active{background:${o('--en-editor-token-pressed-background', t('--en-color-accent-subtle'))}}
 button[data-token]:focus-visible{z-index:1}
 button[data-token]:disabled{cursor:default;color:${t('--en-color-text-muted')};border-color:${t('--en-color-line')}}
 ${focusStylesFor(css `button[data-token]`, { family: 'button' })}
 @media(any-pointer:coarse){button[data-token]{min-inline-size:max(var(--en-editor-token-min-size,2rem),${controlTargetSize(true, t('--en-size-target-min'))});min-block-size:max(var(--en-editor-token-min-size,2rem),${controlTargetSize(true, t('--en-size-target-min'))})}}
 .popup{
  position:fixed;inset:auto;margin:0;box-sizing:border-box;
  max-inline-size:calc(100vw - 1rem);max-block-size:min(var(--popup-height,18rem),${o('--en-option-list-max-block-size', css `18rem`)});overflow:auto;inline-size:var(--popup-width,20rem);
  padding:max(${o('--en-option-list-padding', o('--en-overlay-padding', t('--en-space-2')))},${focusExtent({ family: 'option', inset: true })});
  --_en-editor-list-radius:${o('--en-option-list-radius', o('--en-overlay-radius', t('--en-radius-container')))};
  --_en-editor-list-padding:max(${o('--en-option-list-padding', o('--en-overlay-padding', t('--en-space-2')))},${focusExtent({ family: 'option', inset: true })});
  border:${t('--en-border-width')} solid ${o('--en-option-list-border-color', o('--en-overlay-border-color', t('--en-color-boundary')))};
  border-radius:${o('--en-option-list-radius', o('--en-overlay-radius', t('--en-radius-container')))};
  background:${o('--en-option-list-background', o('--en-overlay-background', t('--en-color-surface-raised')))};
  color:${o('--en-option-list-color', o('--en-overlay-color', t('--en-color-text')))};
  box-shadow:${o('--en-option-list-shadow', t('--en-shadow-overlay'))};
 }
 ${nativeSurfaceMotion(css `.popup`, css `.popup:popover-open`, css `.popup:not(:popover-open)`, 'elevation')}
 .option{box-sizing:border-box;position:relative;display:grid;align-content:center;padding:${o('--en-option-block-padding', t('--en-space-control-block'))} ${o('--en-option-inline-padding', t('--en-space-control-inline'))};min-block-size:${controlTargetSize()};border-radius:${o('--en-option-radius', css `max(0px,var(--_en-editor-list-radius) - var(--_en-editor-list-padding) - ${t('--en-border-width')})`)};cursor:pointer}
 .option + .option{margin-block-start:${o('--en-option-list-gap', css `0px`)}}
 ${optionPaint({ base: css `.option`, selected: css `.option[aria-selected=true]`, hover: css `.option:hover`, pressed: css `.option:active`, disabled: css `.option[aria-disabled=true]`, restBackground: css `transparent`, restColor: o('--en-option-list-color', o('--en-overlay-color', t('--en-color-text'))), hoverBackground: t('--en-color-surface-subtle') })}
 ${focusVisibleStylesFor(css `.option[aria-selected=true]`, { family: 'option', inset: true, restSelector: css `.option` })}
 .description{display:block;color:${t('--en-color-text-muted')};font: ${t('--en-font-metadata-weight')} ${t('--en-font-metadata-size')} / ${t('--en-font-metadata-line-height')} ${t('--en-font-metadata-family')}}
 .hint{position:absolute; font-style: ${t('--en-font-metadata-style')}; letter-spacing: ${t('--en-font-metadata-tracking')};inline-size:1px;block-size:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
 @media(any-pointer:coarse){.option{min-block-size:${controlTargetSize(true)}}}
  ${pressStyles(css `button[data-token]`, css `button[data-token]:not(:disabled):not([data-press='none']):active`, pressRecipes['editor-token'])}
 @media(forced-colors:active){.editor,.popup,[data-token]{background:Canvas;color:CanvasText;border-color:CanvasText}button[data-token]:disabled{color:GrayText;border-color:GrayText}button[data-token]:not(:disabled):active{background:Highlight;color:HighlightText}.option[aria-selected=true]{color:HighlightText;background:Highlight}}
`);

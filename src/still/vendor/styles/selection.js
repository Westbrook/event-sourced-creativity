import { pressStyles } from './internal/press.js';
import { pressRecipes } from './internal/press-recipes.js';
import { optionPaint } from './internal/option-paint.js';
import { controlTargetSize, pointerTargetSize } from './internal/target-size.js';
import { css } from 'lit';
import { sizedStyles } from './internal/sizing.js';
import { token as t, override as o } from './internal/values.js';
import { focusStyles, focusVisibleStylesFor } from './internal/focus.js';
import { controlFrameInset, segmentedFramePadding, textControlBlockSize } from './internal/control-size.js';
/** Visual states for semantic selection/disclosure patterns; no keyboard or selection behavior. */
export const selectionStyles = sizedStyles(css `
  /* Recompute for both frame and item; descendant overrides stay effective. */
  .en-segmented-control, .en-segmented-item {
    --_en-text-control-block-size: ${textControlBlockSize(false, true)};
  }
  .en-option, .en-tab, .en-accordion-trigger {
    min-inline-size: ${t('--en-size-target-min')};
    min-block-size: ${controlTargetSize()};
    padding-block: ${t('--en-space-control-block')};
    padding-inline: ${t('--en-space-control-inline')};
    color: ${o('--en-option-color', t('--en-color-text'))};
    font: inherit;
    text-align: start;
    overflow-wrap: break-word;
    cursor: pointer;
  }
  .en-option {
    display: flex;
    align-items: center;
    gap: ${t('--en-space-icon-label')};
    border-radius: ${o('--en-option-radius', t('--en-radius-control'))};
    background: ${o('--en-option-background', t('--en-color-surface'))};
  }
  ${optionPaint({
    base: css `.en-option`, selected: css `.en-option[aria-selected='true'], .en-option[aria-checked='true'], .en-option[data-selected]`,
    hover: css `.en-option:not([aria-disabled='true']):hover`, active: css `.en-option[data-active]`,
    pressed: css `.en-option:not([aria-disabled='true']):active`, disabled: css `.en-option[aria-disabled='true']`,
    restBackground: t('--en-color-surface'), restColor: t('--en-color-text'), hoverBackground: t('--en-color-surface-subtle'),
})}
  /* Keep the native recipe's visible keyboard candidate fallback. */
  .en-option[data-active] { --_en-option-active-background: var(--en-option-active-background, var(--en-option-background, ${t('--en-color-surface-subtle')})); }
  .en-option[aria-disabled='true'] { cursor: default; }
  .en-listbox, .en-tree { display: flex; flex-direction: column; gap: ${t('--en-space-1')}; min-inline-size: 0; }
  .en-tree-group { padding-inline-start: ${t('--en-space-4')}; }
  .en-choice-group, .en-rating, .en-toolbar, .en-segmented { display: flex; align-items: center; flex-wrap: wrap; gap: ${t('--en-space-actions')}; min-inline-size: 0; }
  .en-choice-group[data-orientation='vertical'], .en-choice-group[aria-orientation='vertical'] { flex-direction: column; align-items: stretch; }
  .en-choice-group > slot, .en-rating > slot, .en-toolbar > slot, .en-segmented > slot { display: contents; }
  .en-rating-item, .en-rating-clear, .en-segmented-item {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-inline-size: ${t('--en-size-target-min')};
    min-block-size: ${controlTargetSize()};
    border: ${t('--en-border-width')} solid transparent;
    border-radius: ${t('--en-radius-control')};
    color: ${t('--en-color-text')};
    cursor: pointer;
    overflow-wrap: break-word;
  }
  .en-rating-values {
    display: flex;
    flex-wrap: wrap;
    gap: ${t('--en-space-0-5')};
    min-inline-size: 0;
    max-inline-size: 100%;
  }
  /* Preserve each target instead of squeezing stars to keep a row on one line. */
  .en-rating-item {
    --_en-rating-target-min: ${t('--en-size-target-min')};
    --_en-rating-target-size: max(${controlTargetSize()}, var(--_en-rating-target-min), calc(${t('--en-size-icon')} + 2 * ${t('--en-space-control-block')} + 2 * ${t('--en-border-width')}));
    flex: 0 0 auto;
    inline-size: var(--_en-rating-target-size);
    block-size: var(--_en-rating-target-size);
    padding: ${t('--en-space-control-block')};
    border-radius: ${o('--en-rating-star-radius', t('--en-radius-control'))};
  }
  .en-rating-clear { max-inline-size: 100%; }
  .en-rating-clear, .en-segmented-item { padding: ${t('--en-space-control-block')} ${t('--en-space-control-inline')}; }
  .en-rating-clear { color: ${t('--en-color-text-muted')}; }
  .en-rating-clear:has(:checked) { background: ${t('--en-color-selected')}; color: ${t('--en-color-action-text')}; border-color: ${t('--en-color-accent-border')}; }
  .en-rating-star { font-size: ${t('--en-size-icon')}; line-height: 1; color: ${t('--en-color-text-muted')}; }
  .en-rating-star[data-filled] { color: ${t('--en-color-action-text')}; }
  .en-rating-item:has(:disabled), .en-rating-clear:has(:disabled), .en-segmented-item[data-disabled] { cursor: default; color: ${t('--en-color-text-muted')}; }
  .en-rating-item:has(:disabled) .en-rating-star { color: ${t('--en-color-text-muted')}; }
  ${focusVisibleStylesFor(css `.en-rating-item:has(:focus-visible), .en-rating-clear:has(:focus-visible), .en-segmented-item:has(:focus-visible)`)}
  .en-segmented-control { display: flex; align-items: stretch; flex-wrap: wrap; gap: ${t('--en-space-0-5')}; min-inline-size: 0; min-block-size: var(--_en-text-control-block-size); padding: ${segmentedFramePadding}; border: ${t('--en-border-width')} solid ${t('--en-color-line')}; border-radius: ${o('--en-control-radius', t('--en-radius-control'))}; background: ${t('--en-color-surface-subtle')}; }
  .en-segmented-item {
    flex: 1 1 auto;
    /* The shared control height includes the frame; each label keeps its target floor. */
    min-block-size: max(calc(var(--_en-text-control-block-size) - 2 * ${controlFrameInset}), ${t('--en-size-target-min')});
    padding-block: max(0px, calc(${t('--en-space-control-block')} - ${controlFrameInset}));
    border-radius: max(0px, ${o('--en-control-radius', t('--en-radius-control'))} - ${controlFrameInset});
    text-align: center;
  }
  .en-segmented-item[data-selected] { background: ${t('--en-color-surface')}; border-color: ${t('--en-color-boundary')}; color: ${t('--en-color-action-text')}; font-weight: ${t('--en-font-label-strong-weight')}; }
  @media (hover: hover) { .en-segmented-item:not([data-disabled]):hover { background: ${t('--en-color-selected')}; } }
  .en-segmented-item:not([data-disabled]):active, .en-rating-item:not(:has(:disabled)):active, .en-rating-clear:not(:has(:disabled)):active, .en-accordion-trigger:not(:disabled):not([aria-disabled='true']):active { background: ${t('--en-color-accent-subtle')}; }
  .en-segmented-item[data-disabled] { color: ${t('--en-color-text-muted')}; }
  .en-segmented-label { min-inline-size: 0; }
  .en-tabs { min-inline-size: 0; isolation: isolate; }
  .en-tab-list { position: relative; display: flex; flex-wrap: wrap; gap: ${t('--en-space-1')}; min-inline-size: 0; border-block-end: ${t('--en-border-width')} solid ${t('--en-color-line')}; }
  .en-tab-list > slot { display: contents; }
  /* Raise focus paint within the tabs, including over following rows and panels.
     Slotted hosts and native tabs are flex items; their z-index needs no positioning. */
  .en-tab-list:focus-within { z-index: 1; }
  .en-tab-list > slot::slotted(:focus-within), .en-tab-list > .en-tab:focus-within { z-index: 1; }
  .en-tab-list[aria-orientation='vertical'], .en-tab-list[data-orientation='vertical'] { flex-direction: column; border-block-end: 0; border-inline-end: ${t('--en-border-width')} solid ${t('--en-color-line')}; }
  .en-tab {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: ${t('--en-space-icon-label')};
    border: 0;
    border-block-end: ${t('--en-size-tab-indicator')} solid ${t('--en-color-line')};
    background: ${o('--en-tab-background', t('--en-color-surface'))};
    color: ${o('--en-tab-color', t('--en-color-text'))};
  }
  @media (hover: hover) { .en-tab:not([aria-disabled='true']):hover { background: ${o('--en-tab-hover-background', o('--en-tab-background', t('--en-color-surface-subtle')))}; color: ${o('--en-tab-hover-color', o('--en-tab-color', t('--en-color-text')))}; } }
  .en-tab[aria-selected='true'], :host([role='tab'][aria-selected='true']) .en-tab {
    color: ${o('--en-tab-selected-color', o('--en-tab-color', t('--en-color-action-text')))};
    border-block-end-color: ${o('--en-tab-indicator-color', t('--en-color-action'))};
    background: ${o('--en-tab-selected-background', o('--en-tab-background', t('--en-color-selected')))};
    font-weight: ${t('--en-font-label-strong-weight')};
  }
  .en-tab:not([aria-disabled='true']):not(:host([aria-disabled='true']) *):active { background: ${o('--en-tab-pressed-background', t('--en-color-accent-subtle'))}; }
  .en-tab[aria-disabled='true'], :host([role='tab'][aria-disabled='true']) .en-tab { color: ${t('--en-color-text-muted')}; cursor: default; }
  .en-tab-panel { min-inline-size: 0; padding-block: ${t('--en-space-4')}; }
  .en-accordion { display: flex; flex-direction: column; min-inline-size: 0; isolation: isolate; }
  .en-accordion > slot { display: contents; }
  /* Keep the focused item's outline above adjacent surfaces within this group.
     Slotted hosts are flex items, so no positioned containing block is needed. */
  .en-accordion > slot::slotted(:focus-within) { z-index: 1; }
  .en-accordion-item { border-block-end: ${t('--en-border-width')} solid ${t('--en-color-line')}; min-inline-size: 0; }
  .en-accordion-trigger { display: flex; align-items: center; justify-content: space-between; gap: ${t('--en-space-icon-label')}; inline-size: 100%; border: 0; background: ${t('--en-color-surface')}; font-weight: ${t('--en-font-label-strong-weight')}; }
  @media (hover: hover) { .en-accordion-trigger:hover { background: ${t('--en-color-surface-subtle')}; } }
  .en-accordion-trigger[aria-disabled='true'], .en-accordion-trigger:disabled { color: ${t('--en-color-text-muted')}; cursor: default; }
  .en-accordion-panel { padding-block: ${t('--en-space-3')} ${t('--en-space-4')}; padding-inline: ${t('--en-space-control-inline')}; }
  ${focusStyles}
  @media (any-pointer: coarse) {
    .en-option, .en-tab, .en-accordion-trigger, .en-rating-item, .en-rating-clear { min-inline-size: ${pointerTargetSize(true)}; min-block-size: ${controlTargetSize(true)}; }
    .en-segmented-control, .en-segmented-item { --_en-text-control-block-size: ${textControlBlockSize(true, true)}; }
    .en-segmented-item { min-inline-size: ${pointerTargetSize(true)}; min-block-size: max(calc(var(--_en-text-control-block-size) - 2 * ${controlFrameInset}), ${pointerTargetSize(true)}); }
    .en-rating-item { --_en-rating-target-min: ${pointerTargetSize(true)}; min-inline-size: ${pointerTargetSize(true)}; }
  }
  ${pressStyles(css `:is(.en-segmented-item)`, css `.en-segmented-item:not([data-disabled]):not([data-press='none']):active`, pressRecipes['segmented'])}
  ${pressStyles(css `:is(.en-rating-item, .en-rating-clear)`, css `:is(.en-rating-item, .en-rating-clear):not(:has(:disabled)):not([data-press='none']):active`, pressRecipes['rating'])}
  ${pressStyles(css `.en-accordion-trigger`, css `.en-accordion-trigger:not(:disabled):not([aria-disabled='true']):not([data-press='none']):active`, pressRecipes['accordion'])}
  ${pressStyles(css `.en-tab`, css `.en-tab:not([aria-disabled='true']):not(:host([aria-disabled='true']) *):not([data-press='none']):active`, pressRecipes['tab'])}
  @media (forced-colors: active) {
    .en-option, .en-tab, .en-accordion-trigger { background: Canvas; color: CanvasText; }
    .en-option[aria-selected='true'], .en-option[aria-checked='true'], .en-option[data-selected], .en-tab[aria-selected='true'], :host([role='tab'][aria-selected='true']) .en-tab { background: Highlight; color: HighlightText; border-color: Highlight; }
    .en-option[aria-disabled='true'], .en-tab[aria-disabled='true'], :host([role='tab'][aria-disabled='true']) .en-tab { color: GrayText; }
    .en-segmented-control { background: Canvas; border-color: CanvasText; }
    .en-segmented-item { color: CanvasText; }
    .en-segmented-item[data-selected], .en-rating-clear:has(:checked) { background: Highlight; color: HighlightText; border-color: Highlight; }
    @media (hover: hover) { .en-segmented-item:not([data-disabled]):hover { background: Highlight; color: HighlightText; } }
    /* Chromium can draw an opaque text backplate even for explicit system colors.
       Only this text span avoids that second adjustment; its inherited foreground
       and the parent surface still come entirely from the user's system palette. */
    .en-segmented-label { forced-color-adjust: none; color: inherit; background: none; }
    .en-segmented-label[data-rich] { forced-color-adjust: auto; }
    .en-rating-star { color: CanvasText; }
    .en-rating-star[data-filled] { color: Highlight; }
    .en-segmented-item[data-disabled] { background: Canvas; color: GrayText; border-color: GrayText; }
    .en-rating-item:has(:disabled) .en-rating-star, .en-rating-clear:has(:disabled) { color: GrayText; }
    .en-rating-item:has(:focus-visible), .en-rating-clear:has(:focus-visible), .en-segmented-item:has(:focus-visible) { outline-color: Highlight; }
  }
`);

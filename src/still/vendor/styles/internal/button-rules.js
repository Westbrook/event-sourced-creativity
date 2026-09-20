import { css } from 'lit';
import { token as t, override as o } from './values.js';
import { focusStylesFor } from './focus-core.js';
const buttonInlinePadding = o('--en-button-inline-padding', o('--en-control-inline-padding', t('--en-space-control-inline')));
/** Shared authored button rules; aggregate and leaf keep the same source. */
export const buttonAppearanceStyles = css `
  .en-button {
    --_en-button-state-background: var(--en-button-rest-background);
    --_en-button-state-color: var(--en-button-rest-color);
    padding-inline: ${buttonInlinePadding};
    display: inline-flex;
    min-inline-size: ${t('--en-size-target-min')};
    align-items: center;
    justify-content: center;
    gap: ${t('--en-space-icon-label')};
    border-color: ${o('--en-button-border-color', t('--en-color-action'))};
    border-radius: ${o('--en-button-radius', o('--en-control-radius', t('--en-radius-control')))};
    background: var(--_en-button-state-background, ${o('--en-button-background', t('--en-color-action'))});
    color: var(--_en-button-state-color, ${o('--en-button-color', t('--en-color-on-action'))});
    font-weight: ${t('--en-font-label-strong-weight')};
    text-align: center;
    text-decoration: none;
    white-space: normal;
    overflow-wrap: break-word;
    cursor: pointer;
    transition: background-color ${t('--en-duration-fast')} ${t('--en-ease-standard')},
      border-color ${t('--en-duration-fast')} ${t('--en-ease-standard')};
  }
  @media (hover: hover) { .en-button:where(:not(:disabled):not([aria-disabled='true']):hover) { background: var(--_en-button-state-background, ${o('--en-button-background', t('--en-color-action-hover'))}); } }
  .en-button:where(:not(:disabled):not([aria-disabled='true']):active) { background: var(--_en-button-state-background, ${o('--en-button-background', t('--en-color-action-pressed'))}); }
  .en-button--secondary, .en-button[data-variant='secondary'] {
    background: var(--_en-button-state-background, ${o('--en-button-background', t('--en-color-surface-subtle'))});
    color: var(--_en-button-state-color, ${o('--en-button-color', t('--en-color-text'))});
    border-color: ${o('--en-button-border-color', t('--en-color-boundary'))};
  }
  .en-button--quiet, .en-button[data-variant='ghost'] {
    background: var(--_en-button-state-background, none);
    color: var(--_en-button-state-color, ${o('--en-button-color', t('--en-color-action-text'))});
    border-color: ${o('--en-button-border-color', t('--en-color-line'))};
  }
  @media (hover: hover) { :is(.en-button--secondary, .en-button--quiet, .en-button[data-variant='secondary'], .en-button[data-variant='ghost']):not(:disabled):not([aria-disabled='true']):hover {
    background: var(--_en-button-state-background, ${o('--en-button-background', t('--en-color-selected'))});
  } }
  .en-button--danger, .en-button[data-variant='danger'] {
    background: var(--_en-button-state-background, ${o('--en-button-background', t('--en-color-surface'))});
    color: var(--_en-button-state-color, ${o('--en-button-color', t('--en-color-danger-text'))});
    border-color: ${o('--en-button-border-color', t('--en-color-danger-text'))};
  }
  @media (hover: hover) { :is(.en-button--danger, .en-button[data-variant='danger']):not(:disabled):not([aria-disabled='true']):hover {
    background: var(--_en-button-state-background, ${o('--en-button-background', t('--en-color-surface-subtle'))});
  } }
  /* Explicit state refinements have a shared order across variants. Clearing an
     absent state slot preserves each variant's existing broad/semantic fallback. */
  @media (hover: hover) {
    .en-button:where(:not(:disabled):not([aria-disabled='true']):hover) {
      --_en-button-state-background: var(--en-button-hover-background);
      --_en-button-state-color: var(--en-button-hover-color);
    }
  }
  .en-button:where(:not(:disabled):not([aria-disabled='true']):active) {
    --_en-button-state-background: var(--en-button-pressed-background);
    --_en-button-state-color: var(--en-button-pressed-color);
  }
  .en-button__prefix, .en-button__suffix { display: contents; }
  .en-button__label { min-inline-size: 0; }
  .en-icon-button { padding-inline: ${t('--en-space-2')}; min-inline-size: max(${o('--en-control-min-size', t('--en-size-control-min'))}, ${t('--en-size-target-min')}); }
  /* Explicit button mode; existing stepper/overlay icon recipes retain their layout. */
  .en-button[data-icon-only] {
    --_en-icon-button-side: max(var(--_en-text-control-block-size), calc(max(${o('--en-icon-size', t('--en-size-icon'))}, ${t('--en-size-spinner')}) + 2 * ${t('--en-space-control-block')} + 2 * ${t('--en-border-width')}));
    min-inline-size: var(--_en-icon-button-side);
    min-block-size: var(--_en-icon-button-side);
    inline-size: max-content;
    aspect-ratio: 1;
    padding: ${t('--en-space-control-block')};
    gap: 0;
    flex-shrink: 0;
  }
  .en-button[data-icon-only] > .en-button__label {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    padding: 0;
    margin: -1px;
    border: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  /* Keep one visual glyph while busy. The label and slotted nodes remain intact. */
  .en-button[data-icon-only][aria-busy='true'] > :is(.en-button__prefix, .en-button__suffix) { display: none; }

`;
const buttonTransitions = css `background-color ${t('--en-duration-fast')} ${t('--en-ease-standard')}, border-color ${t('--en-duration-fast')} ${t('--en-ease-standard')}`;
export const buttonFocusStyles = focusStylesFor(css `.en-button`, { family: 'button', baseTransitions: buttonTransitions });
export const buttonForcedHoverStyles = css `@media (hover: hover) { .en-button:not(:disabled):not([aria-disabled='true']):hover { background: Highlight !important; color: HighlightText !important; } }`;

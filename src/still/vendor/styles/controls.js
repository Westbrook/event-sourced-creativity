import { insetButtonStyles, insetActionContext } from './internal/inset-action.js';
import { pressStyles } from './internal/press.js';
import { pressRecipes } from './internal/press-recipes.js';
import { fieldPresentation, fieldBorderWidth, fieldInvalidWidth, fieldRadius } from './internal/field-presentation.js';
import { selectChevron } from './internal/select-chevron.js';
import { controlTargetSize, pointerTargetSize } from './internal/target-size.js';
import { css } from 'lit';
import { descriptionStyles } from './internal/description.js';
import { nativeSurfaceMotion } from './internal/surface-motion.js';
import { radioRules } from './internal/radio-rules.js';
import { sizedStyles } from './internal/sizing.js';
import { optionPaint } from './internal/option-paint.js';
import { token as t, override as o } from './internal/values.js';
import { focusStyles, focusVisibleStylesFor, focusStylesFor, fieldFocusStyles, focusExtent } from './internal/focus.js';
import { rangeStyles } from './internal/range.js';
import { buttonAppearanceStyles, buttonForcedHoverStyles } from './internal/button-rules.js';
import { linkAppearanceStyles, linkDisabledStyles, linkForcedColorStyles } from './internal/link-rules.js';
import { controlBlockSizeStyles, controlSurfaceStyles, controlEnvelopeStyles, controlDisabledStyles, controlTouchBlockStyles, controlTouchInlineStyles, controlReducedMotionStyles, controlForcedColorStyles, controlForcedDisabledStyles } from './internal/control-shared.js';
const inputInlinePadding = o('--en-input-inline-padding', o('--en-control-inline-padding', t('--en-space-control-inline')));
const numberGroupRadius = fieldRadius;
const numberStepRadius = css `max(0px, ${numberGroupRadius} - ${fieldBorderWidth})`;
// The single-line editor centers its line within the shared target envelope.
// Give multiline editors that same first-line inset, including rows=1 and coarse
// targets, without fixing their height or changing native rows/resize behavior.
const inputBlockPadding = css `max(
  ${t('--en-space-control-block')},
  calc((var(--_en-text-control-block-size) - ${t('--en-font-input-size')} * ${t('--en-font-input-line-height')}) / 2 - ${fieldBorderWidth})
)`;
/** Native controls and action surfaces. Behavior, names, and form association belong to the host. */
// Number-step selectors must outrank the shared inset icon-button fallback so
// the compound frame includes its border within the shared block-size minimum.
export const controlStyles = sizedStyles(css `
  /* Compute on each consumer so local token/part overrides retain their scope. */
  ${controlBlockSizeStyles(css `.en-button:not(.en-icon-button), .en-button[data-icon-only], .en-input, .en-textarea, .en-select, .en-number-input, .en-number-step, .en-color-control`)}
  ${controlSurfaceStyles(css `.en-control, .en-button, .en-input, .en-textarea, .en-select`)}
  ${controlEnvelopeStyles(css `.en-button:not(.en-icon-button), .en-input, .en-textarea, .en-select`)}
  /* Field tokens customize inputs without changing action and choice surfaces.
     Family refinements take precedence over shared control defaults. */
  .en-input, .en-textarea, .en-select {
    padding-inline: ${inputInlinePadding};
    background: ${o('--en-input-background', o('--en-control-background', t('--en-color-surface')))};
    color: ${o('--en-input-color', o('--en-control-color', t('--en-color-text')))};
  }
  ${buttonAppearanceStyles}
  ${linkAppearanceStyles}
  ${controlDisabledStyles(css `:is(.en-button, .en-input, .en-textarea, .en-select, .en-control):is(:disabled, [aria-disabled='true'])`)}
  ${linkDisabledStyles}
  .en-input, .en-textarea, .en-select {
    inline-size: 100%;
    font: ${t('--en-font-input-weight')} ${t('--en-font-input-size')} / ${t('--en-font-input-line-height')} ${t('--en-font-input-family')}; font-style: ${t('--en-font-input-style')}; letter-spacing: ${t('--en-font-input-tracking')};
  }
  /* Apply after the font shorthand so editable numeric content retains equal
     digit widths. Input modes also cover text-based numeric editors. */
  .en-input:is(.en-time-input, [type='number'], [type='date'], [type='time'], [type='datetime-local'], [type='month'], [type='week'], [type='tel']),
  :is(.en-input, .en-textarea):is([inputmode='numeric'], [inputmode='decimal'], [inputmode='tel']) {
    font-variant-numeric: tabular-nums;
  }
  /* Use the shared text-field surface and target envelope around the native
     date editor. Keep its fields, separators and calendar-picker activation. */
  .en-input[type='date'] {
    -webkit-appearance: none;
    appearance: none;
    padding-block: ${inputBlockPadding};
  }
  .en-input[type='date']::-webkit-datetime-edit { padding: 0; }
  .en-input[type='date']::-webkit-datetime-edit-fields-wrapper { padding-block: 0; }
  .en-input[type='date']::-webkit-datetime-edit-year-field,
  .en-input[type='date']::-webkit-datetime-edit-month-field,
  .en-input[type='date']::-webkit-datetime-edit-day-field { padding-block: 0; }
  .en-input[type='date']::-webkit-date-and-time-value {
    margin-block: 0;
    text-align: inherit;
  }
  .en-input::placeholder, .en-textarea::placeholder { color: ${t('--en-color-text-muted')}; opacity: 1; }
  .en-text-input, .en-textarea { padding-block: ${inputBlockPadding}; }
  .en-textarea { resize: block; }
  .en-input[aria-invalid='true'], .en-textarea[aria-invalid='true'], .en-select[aria-invalid='true'], .en-control[data-invalid] {
    border-color: ${t('--en-color-danger-text')};
  }
  .en-input:user-invalid, .en-textarea:user-invalid, .en-select:user-invalid { border-color: ${t('--en-color-danger-text')}; }
  /* The text-field marker keeps stronger invalid geometry out of other native controls.
     Preserve border + padding on each edge, including scoped padding/base-border tokens. */
  .en-text-input:is([aria-invalid='true'], :user-invalid) {
    border-width: ${fieldInvalidWidth};
    padding-block: max(0px, calc(${inputBlockPadding} + ${fieldBorderWidth} - ${fieldInvalidWidth}));
    padding-inline: max(0px, calc(${inputInlinePadding} + ${fieldBorderWidth} - ${fieldInvalidWidth}));
  }
  ${fieldPresentation(css `:is(.en-input, .en-textarea, .en-select, .en-number-group)`, css `:is(.en-input, .en-textarea, .en-select)[aria-invalid='true'], :is(.en-input, .en-textarea, .en-select):user-invalid, .en-number-group[data-invalid]`)}
  .en-input-group { display: flex; align-items: stretch; gap: ${t('--en-space-1')}; min-inline-size: 0; }
  .en-input-group > .en-input { flex: 1 1 auto; inline-size: 0; min-inline-size: 0; }
  .en-number-group {
    gap: 0;
    padding: 0;
    border: ${fieldBorderWidth} solid ${o('--en-input-border-color', o('--en-control-border-color', t('--en-color-boundary')))};
    border-radius: ${numberGroupRadius};
    background: ${o('--en-input-background', o('--en-control-background', t('--en-color-surface')))};
  }
  .en-number-group[data-invalid] { border-color: ${o('--en-input-invalid-border-color', t('--en-color-danger-text'))}; }
  .en-number-group > :is(.en-number-input, .en-number-step, button.en-button.en-number-step) { min-block-size: max(calc(var(--_en-text-control-block-size) - 2 * ${fieldBorderWidth}), ${t('--en-size-target-min')}); }
  .en-number-group > .en-number-input { border: 0; border-radius: 0; background: none; appearance: textfield; }
  .en-number-input::-webkit-inner-spin-button, .en-number-input::-webkit-outer-spin-button { appearance: none; margin: 0; }
  .en-number-step {
    flex: none;
    min-inline-size: ${controlTargetSize()};
    padding-inline: ${t('--en-space-control-block')};
    border: 0;
    border-inline-start: ${t('--en-border-width')} solid ${t('--en-color-line')};
    border-radius: 0;
    background: ${t('--en-color-surface-subtle')};
    color: ${t('--en-color-text')};
  }
  /* Match the frame's override as well as its token. Keep overflow visible so
     consumer-defined outward focus contours remain intact. */
  .en-number-step:not(:disabled):not([aria-disabled='true']):active { background: var(--en-button-pressed-background, ${t('--en-color-accent-subtle')}); }
  .en-number-step:last-child { border-start-end-radius: ${numberStepRadius}; border-end-end-radius: ${numberStepRadius}; }
  .en-number-step:first-child { border-inline-start: 0; border-inline-end: ${t('--en-border-width')} solid ${t('--en-color-line')}; border-start-start-radius: ${numberStepRadius}; border-end-start-radius: ${numberStepRadius}; }

  .en-color-control { cursor: pointer; padding: ${t('--en-space-control-block')}; block-size: var(--_en-text-control-block-size); }
  .en-color-control::-webkit-color-swatch-wrapper { padding: 0; }
  .en-color-control::-webkit-color-swatch { border: ${t('--en-border-width')} solid ${t('--en-color-boundary')}; border-radius: max(0px, ${t('--en-radius-control')} - ${t('--en-space-control-block')}); }
  .en-color-control::-moz-color-swatch { border: ${t('--en-border-width')} solid ${t('--en-color-boundary')}; border-radius: max(0px, ${t('--en-radius-control')} - ${t('--en-space-control-block')}); }
  ${radioRules}
  .en-checkbox, .en-switch {
    flex: none;
    inline-size: ${o('--en-choice-size', t('--en-size-icon'))};
    block-size: ${o('--en-choice-size', t('--en-size-icon'))};
    margin: 0;
    accent-color: ${t('--en-color-action')};
  }
  .en-checkbox {
    appearance: none;
    display: inline-grid;
    place-items: center;
    box-sizing: border-box;
    border: ${t('--en-border-width')} solid ${t('--en-color-boundary')};
    background: ${t('--en-color-surface')};
    cursor: pointer;
  }
  .en-checkbox { border-radius: ${t('--en-radius-choice')}; }
  .en-checkbox:checked, .en-checkbox:indeterminate { background: ${t('--en-color-action')}; border-color: ${t('--en-color-action')}; }
  .en-checkbox:checked::before {
    content: '';
    box-sizing: border-box;
    inline-size: ${t('--en-size-choice-mark-inline')};
    block-size: ${t('--en-size-choice-mark-block')};
    /* The check is directional artwork, not an inline-layout edge; never mirror it in RTL. */
    border-right: ${t('--en-size-choice-mark-stroke')} solid ${t('--en-color-on-action')};
    border-bottom: ${t('--en-size-choice-mark-stroke')} solid ${t('--en-color-on-action')};
    transform: rotate(45deg);
  }
  .en-checkbox:indeterminate::before { content: ''; inline-size: ${t('--en-size-choice-mark-block')}; block-size: 0; border: 0; border-block-end: ${t('--en-size-choice-mark-stroke')} solid ${t('--en-color-on-action')}; transform: none; }
  .en-checkbox:disabled { cursor: default; background: ${t('--en-color-surface-subtle')}; border-color: ${t('--en-color-boundary')}; }
  .en-checkbox:disabled::before { border-color: ${t('--en-color-text-muted')}; }
  .en-switch {
    position: relative;
    appearance: none;
    box-sizing: border-box;
    inline-size: ${o('--en-switch-inline-size', t('--en-size-switch-inline'))};
    block-size: ${o('--en-switch-block-size', t('--en-size-switch-block'))};
    border: ${t('--en-border-width')} solid ${t('--en-color-boundary')};
    border-radius: ${t('--en-radius-pill')};
    background: ${t('--en-color-surface-subtle')};
    cursor: pointer;
  }
  .en-switch::before {
    content: '';
    pointer-events: none;
    position: absolute;
    inset-block-start: ${t('--en-space-switch-inset')};
    inset-inline-start: ${t('--en-space-switch-inset')};
    --_en-switch-thumb-inline: ${o('--en-switch-thumb-size', t('--en-size-switch-thumb'))};
    inline-size: var(--_en-switch-thumb-inline);
    block-size: ${o('--en-switch-thumb-size', t('--en-size-switch-thumb'))};
    border-radius: ${t('--en-radius-pill')};
    background: ${t('--en-color-text-muted')};
    transition: inset-inline-start var(--_en-press-duration, ${t('--en-duration-fast')}) ${t('--en-ease-standard')}, inline-size var(--_en-press-duration, ${t('--en-duration-fast')}) ${t('--en-ease-standard')};
  }
  .en-switch:checked { background: ${t('--en-color-action')}; border-color: ${t('--en-color-action')}; }
  .en-switch:checked::before { inset-inline-start: calc(100% - var(--_en-switch-thumb-inline) - ${t('--en-space-switch-inset')}); background: ${t('--en-color-on-action')}; }
  .en-switch:not(:disabled):is(:active, .en-choice:active > .en-switch)::before { --_en-switch-thumb-inline: clamp(0px, var(--en-switch-thumb-pressed-size, var(--en-switch-thumb-size, ${t('--en-size-switch-thumb')})), calc(100% - 2 * ${t('--en-space-switch-inset')})); }
  @media (prefers-reduced-motion: reduce) { .en-switch:is(:active, .en-choice:active > .en-switch)::before { --_en-switch-thumb-inline: var(--en-switch-thumb-size, ${t('--en-size-switch-thumb')}); transition: none; } }
  :host([data-press=none]) .en-switch:is(:active, .en-choice:active > .en-switch)::before { --_en-switch-thumb-inline: var(--en-switch-thumb-size, ${t('--en-size-switch-thumb')}); }
  .en-switch:disabled { cursor: default; border-color: ${t('--en-color-boundary')}; background: ${t('--en-color-surface-subtle')}; }
  :is(.en-checkbox, .en-switch):not(:disabled):active { border-color: ${t('--en-color-action-pressed')}; }
  .en-switch:disabled::before { background: ${t('--en-color-text-muted')}; }
  .en-range { inline-size: 100%; min-inline-size: ${t('--en-size-target-min')}; min-block-size: ${controlTargetSize()}; margin: 0; accent-color: ${t('--en-color-action')}; }
  .en-range-row { display: flex; align-items: center; gap: ${t('--en-space-3')}; min-inline-size: 0; }
  .en-range-row > .en-range { flex: 1 1 auto; inline-size: 0; }
  .en-range-row[data-editable] { flex-wrap: wrap; }
  .en-range-row > .en-range-editor {
    flex: 0 1 calc(3 * ${t('--en-size-control-min')});
    inline-size: calc(3 * ${t('--en-size-control-min')});
    min-inline-size: min(100%, ${t('--en-size-target-min')});
    font-variant-numeric: tabular-nums;
  }
  /* The value axis alone becomes vertical. Labels, output and number editing
     retain the surrounding writing direction and normal text layout. */
  .en-range-row[data-orientation='vertical'] { flex-direction: column; flex-wrap: nowrap; }
  .en-range-row[data-orientation='vertical'] > .en-range {
    writing-mode: vertical-lr;
    direction: rtl;
    flex: none;
    inline-size: ${o('--en-slider-length', t('--en-size-range-length'))};
    min-inline-size: ${controlTargetSize()};
    block-size: ${controlTargetSize()};
  }
  .en-range-row[data-orientation='vertical'] > .en-range-editor {
    flex: none;
    inline-size: min(100%, calc(3 * ${t('--en-size-control-min')}));
  }
  .en-range-error[data-pending] { visibility: hidden; }
  .en-range-row > output { flex: none; font-variant-numeric: tabular-nums; color: ${t('--en-color-text')}; }
  ${pressStyles(css `.en-checkbox`, css `.en-checkbox:not(:disabled):not([data-press='none']):is(:active, .en-choice:active > .en-checkbox)`, pressRecipes['checkbox'])}
  ${pressStyles(css `.en-switch`, css `.en-switch:not(:disabled):not([data-press='none']):is(:active, .en-choice:active > .en-switch)`, pressRecipes['switch'])}
  ${pressStyles(css `.en-select`, css `.en-select:not(:disabled):not([data-press='none']):active`, pressRecipes['select'])}
  ${pressStyles(css `.en-number-step`, css `.en-number-step:not(:disabled):not([aria-disabled='true']):not([data-press='none']):active`, pressRecipes['number-step'])}
  ${focusStyles}
  ${fieldFocusStyles}
  ${focusStylesFor(css `.en-number-group > .en-number-input`, { family: 'input', inset: true, halo: false })}
  ${focusStylesFor(css `.en-number-group > .en-number-step`, { family: 'button', inset: true, halo: false })}
  ${rangeStyles}
  @media (any-pointer: coarse) {
    ${controlBlockSizeStyles(css `.en-button:not(.en-icon-button), .en-button[data-icon-only], .en-input, .en-textarea, .en-select, .en-number-input, .en-number-step, .en-color-control`, true)}
    ${controlTouchBlockStyles(css `.en-button, .en-control, .en-input, .en-textarea, .en-select, .en-range`)}
    .en-range-row[data-orientation='vertical'] > .en-range { min-inline-size: ${controlTargetSize(true)}; }
    ${controlEnvelopeStyles(css `.en-button:not(.en-icon-button), .en-input, .en-textarea, .en-select`)}
    .en-color-control { block-size: var(--_en-text-control-block-size); }
    ${controlTouchInlineStyles(css `.en-icon-button, .en-number-step`)}
    .en-number-group > :is(.en-number-input, .en-number-step, button.en-button.en-number-step) { min-block-size: max(calc(var(--_en-text-control-block-size) - 2 * ${fieldBorderWidth}), ${pointerTargetSize(true)}); }
  }
  @media (prefers-reduced-motion: reduce) { ${controlReducedMotionStyles(css `.en-button, .en-switch::before`)} }
  @media (forced-colors: active) {
    ${controlForcedColorStyles(css `.en-button, .en-control, .en-input, .en-textarea, .en-select, .en-number-group`)}
    ${linkForcedColorStyles}
    ${controlForcedDisabledStyles(css `:is(.en-button, .en-control, .en-input, .en-textarea, .en-select):is(:disabled, [aria-disabled='true']), .en-link[aria-disabled='true']`)}
    ${buttonForcedHoverStyles}
    .en-checkbox, .en-switch, .en-range { accent-color: auto; }
    .en-checkbox { background: Canvas; border-color: CanvasText; }
    .en-checkbox:checked, .en-checkbox:indeterminate { background: Canvas; border-color: CanvasText; }
    .en-checkbox::before { border-color: CanvasText; }
    .en-checkbox:disabled { background: Canvas; border-color: GrayText; }
    .en-checkbox:disabled::before { border-color: GrayText; }
    .en-checkbox:focus-visible, .en-switch:focus-visible { outline-color: CanvasText; }
    .en-switch { background: Canvas; border-color: ButtonText; }
    .en-switch::before { background: ButtonText; }
    .en-switch:checked { background: Highlight; border-color: Highlight; }
    .en-switch:checked::before { background: HighlightText; }
  .en-switch:disabled { background: Canvas; border-color: GrayText; }
    :is(.en-checkbox, .en-switch):not(:disabled):active { border-color: Highlight; box-shadow: none; }
  .en-switch:disabled::before { background: GrayText; }
  }
  ${insetButtonStyles}
`);
const optionListRadius = o('--en-option-list-radius', o('--en-overlay-radius', t('--en-radius-container')));
const optionListPadding = css `max(${o('--en-option-list-padding', o('--en-overlay-padding', t('--en-space-1')))}, ${focusExtent({ family: 'option', inset: true })})`;
/** Progressive enhancement of the native select; auto restores the OS picker. */
export const selectEnhancementStyles = sizedStyles(css `
  .en-select { min-inline-size: 0; max-inline-size: 100%; white-space: nowrap; text-overflow: ellipsis; }
  .en-select > button { display: none; }
  /* Styling the closed control does not replace its OS picker. Keep this
     fallback outside base-select; ordinary select pseudos are not portable. */
  @supports selector(:has(> .en-select)) {
    @supports not ((appearance: base-select) and selector(::picker(select))) {
      .en-select {
        -webkit-appearance: none;
        appearance: none;
        padding-inline-end: calc(${inputInlinePadding} + ${t('--en-size-icon')} + ${t('--en-space-icon-label')});
        min-block-size: max(var(--_en-text-control-block-size), calc(${t('--en-size-icon')} + 2 * ${t('--en-space-control-block')} + 2 * ${t('--en-border-width')}));
      }
      .en-field-focus-frame:has(> .en-select)::before {
        content: '';
        position: absolute;
        z-index: 1;
        inset-inline-end: calc(${inputInlinePadding} + ${t('--en-border-width')});
        inset-block-start: 50%;
        translate: 0 -50%;
        inline-size: ${t('--en-size-icon')};
        block-size: ${t('--en-size-icon')};
        color: ${t('--en-color-text-muted')};
        background-color: currentColor;
        mask: ${selectChevron} center / contain no-repeat;
        pointer-events: none;
      }
      @media (forced-colors: active) {
        .en-field-focus-frame:has(> .en-select)::before { forced-color-adjust: none; color: ButtonText; }
        .en-field-focus-frame:has(> .en-select:disabled)::before { color: GrayText; }
      }
    }
  }
  @supports (appearance: base-select) and selector(::picker(select)) {
    .en-select, .en-select::picker(select) { appearance: ${o('--en-select-appearance', css `base-select`)}; }
    .en-select { align-items: center; gap: ${t('--en-space-icon-label')}; }
    /* Give the browser-owned label a shrinkable box separate from the caret.
       The implicit select button's anonymous text cannot be truncated reliably. */
    .en-select > button { all: unset; display: block; flex: 1; min-inline-size: 0; }
    .en-select selectedcontent { display: block; min-inline-size: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .en-select::picker(select) {
      padding: ${optionListPadding};
      border: ${t('--en-border-width')} solid ${o('--en-option-list-border-color', o('--en-overlay-border-color', t('--en-color-boundary')))};
      border-radius: ${optionListRadius};
      background: ${o('--en-option-list-background', o('--en-overlay-background', t('--en-color-surface-raised')))};
      color: ${o('--en-option-list-color', o('--en-overlay-color', t('--en-color-text')))};
      box-shadow: ${o('--en-option-list-shadow', t('--en-shadow-overlay'))};
      max-block-size: min(${o('--en-option-list-max-block-size', o('--en-overlay-max-block-size', t('--en-layout-panel-preferred')))}, calc(100dvh - ${t('--en-space-8')}));
      overflow: auto;
    }
    ${nativeSurfaceMotion(css `.en-select`, css `.en-select:open`, css `.en-select:not(:open)`, 'fade', css `::picker(select)`)}
    .en-select option {
      white-space: normal; overflow-wrap: anywhere;
      position: relative;
      min-block-size: ${controlTargetSize()};
      padding: ${o('--en-option-block-padding', t('--en-space-control-block'))} ${o('--en-option-inline-padding', t('--en-space-control-inline'))};
      border-radius: ${o('--en-option-radius', css `max(0px, ${optionListRadius} - ${optionListPadding} - ${t('--en-border-width')})`)};
    }
    .en-select option + option { margin-block-start: ${o('--en-option-list-gap', css `0px`)}; }
    ${optionPaint({
    base: css `.en-select option`, selected: css `.en-select option:checked`,
    hover: css `.en-select option:not(:disabled):hover`,
    focus: css `.en-select option:not(:disabled):focus-visible`,
    pressed: css `.en-select option:not(:disabled):active`, disabled: css `.en-select option:disabled`,
    restBackground: css `transparent`, restColor: o('--en-option-list-color', o('--en-overlay-color', css `inherit`)),
    selectedColor: o('--en-option-list-color', o('--en-overlay-color', t('--en-color-action-text'))), hoverBackground: t('--en-color-selected'),
})}
    .en-select option:not(:disabled):focus-visible { z-index: 1; }
    @media (hover: hover) { .en-select option:not(:disabled):hover { z-index: 1; } }
    /* Native :active is pressed activation, not the combobox's keyboard candidate. */
    ${focusVisibleStylesFor(css `.en-select option:not(:disabled):focus-visible`, { family: 'option', inset: true, restSelector: css `.en-select option` })}
    @media (hover: hover) { ${focusVisibleStylesFor(css `.en-select option:not(:disabled):hover`, { family: 'option', inset: true, restSelector: css `.en-select option` })} }
    .en-select::picker-icon {
      content: '';
      inline-size: ${t('--en-size-icon')};
      block-size: ${t('--en-size-icon')};
      flex: none;
      color: ${t('--en-color-text-muted')};
      background-color: currentColor;
      mask: ${selectChevron} center / contain no-repeat;
    }
    @media (any-pointer: coarse) { .en-select option { min-block-size: ${controlTargetSize(true)}; } }
    @media (forced-colors: active) {
      .en-select::picker(select) { background: Canvas; color: CanvasText; border-color: ButtonText; box-shadow: none; }
      .en-select option { background: Canvas; color: CanvasText; }
      .en-select option:checked, .en-select option:not(:disabled):focus-visible { background: Highlight; color: HighlightText; outline-color: HighlightText; }
      @media (hover: hover) { .en-select option:not(:disabled):hover { background: Highlight; color: HighlightText; outline-color: HighlightText; } }
      .en-select option:disabled { color: GrayText; }
      /* Keep the decorative mask visible while using the user's system colors. */
      .en-select::picker-icon { forced-color-adjust: none; color: ButtonText; }
      .en-select:disabled::picker-icon { color: GrayText; }
    }
  }
`);
export const formStyles = sizedStyles(css `
  .en-field, .en-rating-field { --_en-field-gap: ${o('--en-field-gap', t('--en-space-label-control'))}; }
  .en-field { display: flex; flex-direction: column; min-inline-size: 0; gap: 0; }
  .en-field > :not(:first-child):not(.en-description),
  .en-choice-content > :not(:first-child):not(.en-description) { margin-block-start: var(--_en-field-gap); }
  /* A fieldset legend already separates its first content through its margin. */
  .en-field > .en-legend + :not(.en-description) { margin-block-start: 0; }
  .en-label { display: block; color: ${t('--en-color-text')}; font-weight: ${t('--en-font-label-strong-weight')}; overflow-wrap: break-word; }
  ${descriptionStyles}
  .en-error { margin: 0; font-size: ${t('--en-font-ui-size')}; line-height: ${t('--en-font-body-line-height')}; overflow-wrap: break-word; }
  .en-error { color: ${t('--en-color-danger-text')}; }
  .en-choice { display: flex; align-items: center; gap: ${t('--en-space-icon-label')}; min-block-size: ${controlTargetSize()}; min-inline-size: ${t('--en-size-target-min')}; cursor: pointer; }
  .en-choice > :where(.en-label, .en-choice-content) { min-inline-size: 0; }
  .en-choice-content { --_en-field-gap: ${o('--en-field-gap', t('--en-space-control-description'))}; display: flex; flex-direction: column; gap: 0; }
  .en-fieldset { margin: 0; padding: 0; min-inline-size: 0; border: 0; }
  .en-legend { padding: 0; margin-block-end: ${t('--en-space-label-control')}; font-weight: ${t('--en-font-label-strong-weight')}; }
  .en-form-stack { display: flex; flex-direction: column; gap: ${t('--en-space-fields')}; }
  .en-validation-summary { padding: ${t('--en-space-panel')}; border: ${t('--en-border-width')} solid ${t('--en-color-danger-text')}; border-radius: ${t('--en-radius-container')}; }
  .en-validation-summary :where(ul, ol) { padding-inline-start: ${t('--en-space-6')}; }
  @media (any-pointer: coarse) { .en-choice { min-block-size: ${controlTargetSize(true)}; min-inline-size: ${pointerTargetSize(true)}; } }
  @media (forced-colors: active) { .en-label, .en-error { color: CanvasText; } .en-validation-summary { border-color: CanvasText; } }
`);
/** Adorned single-line fields share a frame; slotted actions retain their own
 * keyboard focus and receive compact geometry without changing their size API. */
export const adornedFieldStyles = sizedStyles(css `
  .en-adorned { display:flex !important; align-items:center; border:${fieldBorderWidth} solid ${o('--en-input-border-color', t('--en-color-boundary'))}; border-radius:${fieldRadius}; background:${o('--en-input-background', t('--en-color-surface'))}; }
  .en-adorned > input { flex:1; min-inline-size:0; border:0; background:transparent; }
  .en-adorned:has(:focus-visible) { outline:var(--en-input-focus-width, ${t('--en-focus-width')}) solid var(--en-input-focus-color, ${t('--en-color-focus')}); outline-offset:var(--en-input-focus-offset, ${t('--en-focus-offset')}); }
  .en-adorned > input:focus-visible { outline:none; box-shadow:none; }
  .en-adorned[data-invalid] { border-color:var(--en-input-invalid-border-color, ${t('--en-color-danger-text')}); }
  .en-adorned slot::slotted(*) { margin-inline:${t('--en-space-2')}; }
  ${insetActionContext(css `.en-adorned`, css `.en-adorned slot[name='help-action']::slotted(*)`, fieldRadius, fieldBorderWidth)}
`);

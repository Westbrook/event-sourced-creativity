import { pressStyles } from './press.js';
import { pressRecipes } from './press-recipes.js';
import { css } from 'lit';
import { token as t, override as o } from './values.js';
/** Shared paint only. Callers retain native semantics, focus, geometry and forced colors. */
export function optionPaint(s) {
    return css `
    ${s.motion === false ? css `` : pressStyles(s.base, css `${s.pressed}:not([aria-disabled='true']):not(:disabled):not([data-press='none']):not([data-reorderable])`, pressRecipes.option)}
    ${s.base} {
      /* Reset each row's state slots: a nested option must not inherit its parent's state. */
      --_en-option-selected-background: initial;
      --_en-option-selected-color: initial;
      --_en-option-active-background: initial;
      --_en-option-active-color: initial;
      --_en-option-hover-background: initial;
      --_en-option-hover-color: initial;
      --_en-option-pressed-background: initial;
      --_en-option-pressed-color: initial;
      --_en-option-disabled-background: initial;
      --_en-option-disabled-color: initial;
      --_en-option-rest-background: var(--en-option-rest-background, var(--en-option-background));
      --_en-option-rest-color: var(--en-option-rest-color, var(--en-option-color));
      background: var(--_en-option-disabled-background, var(--_en-option-pressed-background, var(--_en-option-hover-background, var(--_en-option-active-background, var(--_en-option-selected-background, var(--_en-option-rest-background, ${s.restBackground}))))));
      color: var(--_en-option-disabled-color, var(--_en-option-pressed-color, var(--_en-option-hover-color, var(--_en-option-active-color, var(--_en-option-selected-color, var(--_en-option-rest-color, ${s.restColor}))))));
      font-weight: ${o('--en-option-font-weight', css `inherit`)};
    }
    ${s.selected ? css `${s.selected} {
      --_en-option-selected-background: ${o('--en-option-selected-background', o('--en-option-background', t('--en-color-selected')))};
      --_en-option-selected-color: ${o('--en-option-selected-color', o('--en-option-color', s.selectedColor ?? s.restColor))};
      font-weight: ${o('--en-option-selected-font-weight', o('--en-option-font-weight', t('--en-font-label-strong-weight')))};
    }` : css ``}
    @media (hover: hover) { ${s.hover} {
      --_en-option-hover-background: ${o('--en-option-hover-background', o('--en-option-background', s.hoverBackground))};
      /* With neither override set, the state slot is invalid and falls through
         to active/selected/rest paint, rather than resetting it. */
      --_en-option-hover-color: var(--en-option-hover-color, var(--en-option-color));
    } }
    ${s.focus ? css `${s.focus} {
      --_en-option-hover-background: ${o('--en-option-hover-background', o('--en-option-background', s.hoverBackground))};
      --_en-option-hover-color: var(--en-option-hover-color, var(--en-option-color));
    }` : css ``}
    ${s.active ? css `${s.active} {
      --_en-option-active-background: var(--en-option-active-background, var(--en-option-background));
      --_en-option-active-color: var(--en-option-active-color, var(--en-option-color));
    }` : css ``}
    ${s.pressed} {
      --_en-option-pressed-background: var(--en-option-pressed-background, var(--en-option-background, color-mix(in srgb, ${s.hoverBackground} 82%, currentColor)));
      --_en-option-pressed-color: var(--en-option-pressed-color, var(--en-option-color));
    }
    ${s.disabled} {
      --_en-option-disabled-background: var(--en-option-disabled-background, var(--en-option-background));
      --_en-option-disabled-color: ${o('--en-option-disabled-color', o('--en-option-color', t('--en-color-text-muted')))};
    }
  `;
}

import { pressTransitions } from './press.js';
import { css } from 'lit';
import { token as t, override as o } from './values.js';
function familyValue(family, name, fallback) {
    return family ? o(`--en-${family}-focus-${name}`, fallback) : fallback;
}
export function focusValues(options) {
    const width = familyValue(options.family, 'width', t('--en-focus-width'));
    const offset = familyValue(options.family, 'offset', options.inset ? css `calc(0px - ${width})` : t('--en-focus-offset'));
    return {
        width, offset,
        color: familyValue(options.family, 'color', t('--en-color-focus')),
        haloWidth: options.halo === false ? css `0px` : familyValue(options.family, 'halo-width', t('--en-focus-halo-width')),
        haloColor: familyValue(options.family, 'halo-color', t('--en-color-focus-halo')),
    };
}
/** Actual outer extent used by owned scrollports. Descendant-only overrides may
 * require additional author clearance; ancestor CSS cannot inspect their values. */
export function focusExtent(options = {}) {
    const v = focusValues(options);
    return css `max(0px, calc(${v.width} + ${v.offset}), ${v.haloWidth})`;
}
export const focusClearance = css `max(${focusExtent()}, ${focusExtent({ family: 'button' })}, ${focusExtent({ family: 'input' })}, ${focusExtent({ family: 'option', inset: true })}, ${focusExtent({ family: 'overlay' })})`;
/** Applied before focus so native focus scrolling can account for the clearance.
 * Sticky headers and other obstructions belong to the scroll container's scroll-padding. */
export function focusScrollStylesFor(selector, options = {}) {
    return css `${selector} {
    scroll-margin-block: max(${t('--en-focus-scroll-margin-block')}, ${focusExtent(options)});
    scroll-margin-inline: max(${t('--en-focus-scroll-margin-inline')}, ${focusExtent(options)});
  }`;
}
/** Ordinary focus-visible controls and complete selectors share the same paint. */
export function focusStylesFor(selector, options = {}) {
    return focusVisibleStylesFor(css `${selector}:focus-visible`, { ...options, restSelector: options.restSelector ?? selector });
}
/** The primary contour appears immediately. Only supplementary halo paint may
 * transition, with explicit rest selectors and preserved owned transitions. */
export function focusVisibleStylesFor(selector, options = {}) {
    const v = focusValues(options);
    const rest = options.restSelector;
    const animate = rest && options.halo !== false;
    const baseShadow = options.baseShadow ?? css `var(--_en-press-shadow, 0 0 0 0 transparent)`;
    const otherTransitions = css `${options.baseTransitions ?? pressTransitions},`;
    return css `
    ${rest ? focusScrollStylesFor(rest, options) : css ``}
    ${animate ? css `${rest} {
      box-shadow: 0 0 0 0 ${v.haloColor}, ${baseShadow};
      transition: ${otherTransitions} box-shadow ${t('--en-duration-focus-exit')} ${t('--en-ease-focus-exit')};
    }` : css ``}
    ${selector} {
      outline: ${v.width} solid ${v.color};
      outline-offset: ${v.offset};
      box-shadow: 0 0 0 ${v.haloWidth} ${v.haloColor}, ${baseShadow};
      ${animate ? css `transition: ${otherTransitions} box-shadow ${t('--en-duration-focus-enter')} ${t('--en-ease-focus-enter')};` : css ``}
    }
    ${animate ? css `@media (prefers-reduced-motion: reduce) {
      ${rest}, ${selector} { transition: none; }
    }` : css ``}
    @media (forced-colors: active) {
      ${selector} { outline-color: Highlight; box-shadow: none; }
      ${animate ? css `${rest}, ${selector} { box-shadow: none; transition: none; }` : css ``}
    }
  `;
}

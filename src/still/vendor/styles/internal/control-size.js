import { css } from 'lit';
import { token as t, override as o } from './values.js';
/** Padding inside the segmented border, independent of the shared layout reserve. */
export const segmentedFramePadding = css `max(0px, ${o('--en-segmented-control-frame-inset', t('--en-space-1'))})`;
/** Every inner edge uses the same border-to-option distance. */
export const controlFrameInset = css `calc(${segmentedFramePadding} + ${t('--en-border-width')})`;
/**
 * Comparable text controls share a minimum, not a fixed height. The envelope
 * accommodates both typography roles, native compound-control borders, and a
 * complete option target inside the segmented frame. Wrapped content can grow.
 */
export function textControlBlockSize(coarse = false) {
    const target = t(coarse ? '--en-size-target-touch' : '--en-size-target-min');
    const padding = t('--en-space-control-block');
    const border = t('--en-border-width');
    // Preserve the default alignment envelope when a theme tightens the frame.
    // A larger shared-scope frame can grow the envelope to protect each option.
    // A host/Part-only override is local; it cannot resize sibling controls.
    const frameReserve = css `max(calc(${t('--en-space-1')} + ${border}), ${controlFrameInset})`;
    return css `max(
    ${o('--en-control-min-size', t('--en-size-control-min'))},
    calc(${target} + 2 * ${frameReserve}),
    calc(${t('--en-font-input-size')} * ${t('--en-font-input-line-height')} + 2 * ${padding} + 2 * ${border}),
    calc(${t('--en-font-ui-size')} * ${t('--en-font-ui-line-height')} + 2 * max(${padding}, ${frameReserve}) + 2 * ${border})
  )`;
}

import { css } from 'lit';
import { token as t, override as o } from './values.js';
/** Touch capability adds a floor; it must never reduce the ordinary target. */
export function pointerTargetSize(coarse = false) {
    return coarse
        ? css `max(${t('--en-size-target-min')}, ${t('--en-size-target-touch')})`
        : t('--en-size-target-min');
}
/** Evaluate on the consumer so scoped control minima and size roles still apply. */
export function controlTargetSize(coarse = false, fallback = t('--en-size-control-min')) {
    return css `max(${o('--en-control-min-size', fallback)}, ${pointerTargetSize(coarse)})`;
}

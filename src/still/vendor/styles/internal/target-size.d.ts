import { type CSSResult } from 'lit';
/** Touch capability adds a floor; it must never reduce the ordinary target. */
export declare function pointerTargetSize(coarse?: boolean): CSSResult;
/** Evaluate on the consumer so scoped control minima and size roles still apply. */
export declare function controlTargetSize(coarse?: boolean, fallback?: CSSResult): CSSResult;

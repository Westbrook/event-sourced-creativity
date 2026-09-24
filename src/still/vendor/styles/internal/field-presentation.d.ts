import { type CSSResult } from 'lit';
export declare const fieldBorderWidth: CSSResult;
export declare const fieldInvalidWidth: CSSResult;
export declare const fieldRadius: CSSResult;
/** Frame-only refinements. Compound controls pass their outer frame, never steppers. */
export declare function fieldPresentation(base: CSSResult, invalid: CSSResult): CSSResult;

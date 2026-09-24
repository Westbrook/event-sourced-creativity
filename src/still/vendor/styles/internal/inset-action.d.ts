import { type CSSResult } from 'lit';
/** Resolve on the enclosing frame, before descendants establish their own size
 * scope. Only the actual action receives these private context values. */
export declare function insetActionContext(frame: CSSResult, action: CSSResult, radius: CSSResult, border: CSSResult): CSSResult;
/** Applied after ordinary button geometry, including its coarse-pointer rules.
 * Fallbacks preserve the existing geometry when there is no embedded context. */
export declare const insetButtonStyles: CSSResult;

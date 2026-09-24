import { type CSSResult } from 'lit';
export type FocusFamily = 'button' | 'input' | 'option' | 'overlay';
export interface FocusStyleOptions {
    readonly family?: FocusFamily;
    /** Context fallback only; an explicit family offset is signed and wins. */
    readonly inset?: boolean;
    /** Compound children keep their contour; the complete frame owns the halo. */
    readonly halo?: boolean;
    /** Preserve owned elevation when adding a supplementary focus halo. */
    readonly baseShadow?: CSSResult;
    /** Explicit rest selector: no string parsing or inverse-selector guessing. */
    readonly restSelector?: CSSResult;
    /** Compose known owned transitions instead of replacing background/elevation behavior. */
    readonly baseTransitions?: CSSResult;
}
export declare function focusValues(options: FocusStyleOptions): {
    width: CSSResult;
    offset: CSSResult;
    color: CSSResult;
    haloWidth: CSSResult;
    haloColor: CSSResult;
};
/** Actual outer extent used by owned scrollports. Descendant-only overrides may
 * require additional author clearance; ancestor CSS cannot inspect their values. */
export declare function focusExtent(options?: FocusStyleOptions): CSSResult;
export declare const focusClearance: CSSResult;
/** Applied before focus so native focus scrolling can account for the clearance.
 * Sticky headers and other obstructions belong to the scroll container's scroll-padding. */
export declare function focusScrollStylesFor(selector: CSSResult, options?: FocusStyleOptions): CSSResult;
/** Ordinary focus-visible controls and complete selectors share the same paint. */
export declare function focusStylesFor(selector: CSSResult, options?: FocusStyleOptions): CSSResult;
/** The primary contour appears immediately. Only supplementary halo paint may
 * transition, with explicit rest selectors and preserved owned transitions. */
export declare function focusVisibleStylesFor(selector: CSSResult, options?: FocusStyleOptions): CSSResult;

import { type CSSResult } from 'lit';
export interface PressMotion {
    readonly scale: CSSResult;
    readonly offset: CSSResult;
    readonly press: CSSResult;
    readonly release: CSSResult;
}
export interface PressRecipe extends PressMotion {
    readonly paint: CSSResult;
    readonly shadow: CSSResult;
}
export declare const pressTransitions: CSSResult;
/** Callers pass one complete selector and an enabled-only held selector.
 * Native :active owns the lifetime; no selection or ARIA state is manufactured. */
export declare function pressMotion(surface: CSSResult, held: CSSResult, recipe: PressMotion): CSSResult;
export declare function pressStyles(surface: CSSResult, held: CSSResult, recipe: PressRecipe): CSSResult;

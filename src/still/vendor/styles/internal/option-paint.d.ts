import { type CSSResult } from 'lit';
interface OptionPaint {
    readonly base: CSSResult;
    /** Calendar retains its own motion family; drag rows never transform. */
    readonly motion?: boolean;
    readonly selected?: CSSResult;
    readonly hover: CSSResult;
    readonly focus?: CSSResult;
    readonly active?: CSSResult;
    readonly pressed: CSSResult;
    readonly disabled: CSSResult;
    readonly restBackground: CSSResult;
    readonly restColor: CSSResult;
    readonly selectedColor?: CSSResult;
    readonly hoverBackground: CSSResult;
}
/** Shared paint only. Callers retain native semantics, focus, geometry and forced colors. */
export declare function optionPaint(s: OptionPaint): CSSResult;
export {};

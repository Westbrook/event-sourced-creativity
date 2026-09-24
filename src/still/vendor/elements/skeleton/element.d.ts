import { EnElement } from '../internal/en-element.js';
/**
 * A decorative loading placeholder. The surrounding region owns loading status.
 * @tagname en-skeleton
 * @cssprop --en-skeleton-color - Placeholder color.
 * @cssprop --en-skeleton-size - Placeholder block size.
 * @csspart base - The placeholder surface.
 */
export declare class EnSkeleton extends EnElement {
    static properties: {
        shape: {
            reflect: boolean;
        };
    };
    static styles: import("lit").CSSResult[];
    shape: 'text' | 'circle' | 'rectangle';
    constructor();
    protected render(): import("lit-html").TemplateResult<1>;
}
declare global {
    interface HTMLElementTagNameMap {
        'en-skeleton': EnSkeleton;
    }
}

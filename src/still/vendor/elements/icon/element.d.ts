import { EnElement } from '../internal/en-element.js';
import type { IconName } from './template.js';
/**
 * A small built-in icon set. Decorative by default; provide label for meaningful images.
 * @tagname en-icon
 * @cssprop --en-icon-size - Icon dimensions.
 * @cssprop --en-size-icon-stroke - Icon stroke weight in SVG user units.
 * @csspart base - The SVG icon.
 */
export declare class EnIcon extends EnElement {
    static properties: {
        name: {
            type: StringConstructor;
        };
        label: {
            type: StringConstructor;
        };
    };
    static styles: import("lit").CSSResult[];
    /** Identifier of a built-in, trusted SVG template. */
    name: IconName;
    /** Localized accessible text. Empty means decorative. */
    label: string;
    constructor();
    protected render(): import("lit-html").TemplateResult<1>;
}
declare global {
    interface HTMLElementTagNameMap {
        'en-icon': EnIcon;
    }
}

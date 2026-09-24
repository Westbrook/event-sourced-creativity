import { EnElement } from '../internal/en-element.js';
/**
 * A compact, noninteractive status label. State must be conveyed in its text.
 * @tagname en-badge
 * @cssprop --en-badge-background - Badge fill.
 * @cssprop --en-badge-color - Badge text color.
 * @cssprop --en-badge-radius - Badge corner radius.
 * @slot - Default status text, used when no named label is supplied.
 * @slot label - The status text.
 * @slot prefix - Optional indicator. Content is exposed to assistive technology; authors must hide decorative content with aria-hidden="true" and supply alternatives for meaningful images.
 * @csspart base - The badge surface.
 * @csspart label - The status label container.
 */
export declare class EnBadge extends EnElement {
    static properties: {
        variant: {
            reflect: boolean;
        };
    };
    static styles: import("lit").CSSResult[];
    /** Semantic color treatment; does not change its accessibility role. */
    variant: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
    constructor();
    protected render(): import("lit-html").TemplateResult<1>;
}
declare global {
    interface HTMLElementTagNameMap {
        'en-badge': EnBadge;
    }
}

import { EnElement } from '../internal/en-element.js';
/**
 * A named action group with roving button navigation or ordinary mixed-control Tab order.
 * Buttons retain their native click behavior; the toolbar dispatches no command.
 * @tagname en-toolbar
 * @slot - Direct buttons in automatic roving mode; arbitrary labelled controls in tab mode.
 * @csspart base - The named toolbar layout.
 * @cssprop --en-space-actions - Space between toolbar actions.
 */
export declare class EnToolbar extends EnElement {
    static properties: {
        label: {
            useDefault: boolean;
        };
        orientation: {
            reflect: boolean;
        };
        keyboardNavigation: {
            attribute: string;
            reflect: boolean;
        };
    };
    static styles: import("lit").CSSResult[];
    /** Accessible name of this group of commands. */
    label: string;
    /** Arrow-key axis. Wrapped horizontal toolbars retain logical DOM order.
     * @default "horizontal"
     */
    orientation: 'horizontal' | 'vertical';
    /** Auto uses roving navigation for direct buttons; other interactive content uses
     * ordinary Tab order and group semantics. Tab explicitly selects that delivery,
     * including server rendering, without intercepting native editing keys.
     * @default "auto"
     */
    keyboardNavigation: 'auto' | 'tab';
    private nativeNavigation;
    private observer?;
    private readonly roving;
    private readonly upgrades;
    private initialized;
    constructor();
    private usesNativeNavigation;
    private items;
    connectedCallback(): void;
    private observeButtonUpgrade;
    disconnectedCallback(): void;
    private refresh;
    protected render(): import("lit-html").TemplateResult<1>;
}
declare global {
    interface HTMLElementTagNameMap {
        'en-toolbar': EnToolbar;
    }
}

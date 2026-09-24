import type { PropertyValues } from 'lit';
import { EnElement } from '../internal/en-element.js';
/**
 * A command inside en-menu. Disabled commands remain discoverable by arrow keys.
 * Rich labels and decorative slots must not contain additional interactive controls.
 * @tagname en-menu-item
 * @cssprop --en-option-focus-width - Immediate primary focus contour width.
 * @cssprop --en-option-focus-color - Immediate primary focus contour color.
 * @cssprop --en-option-focus-offset - Signed primary focus contour offset.
 * @cssprop --en-option-focus-halo-width - Supplemental outer focus halo width.
 * @cssprop --en-option-focus-halo-color - Supplemental focus halo color; alpha is supported.
 * @cssprop --en-duration-focus-enter - Supplemental halo and field-accent entry duration.
 * @cssprop --en-duration-focus-exit - Supplemental halo and field-accent exit duration.
 * @cssprop --en-ease-focus-enter - Supplemental focus entry timing function.
 * @cssprop --en-ease-focus-exit - Supplemental focus exit timing function.
 * @cssprop --en-option-background - Shared command row customization.
 * @cssprop --en-option-color - Shared command row customization.
 * @cssprop --en-option-inline-padding - Shared command row customization.
 * @cssprop --en-option-block-padding - Shared command row customization.
 * @cssprop --en-option-radius - Shared command row customization.
 * @cssprop --en-option-font-weight - Shared command row customization.
 * @cssprop --en-color-focus - Shared command row customization.
 * @cssprop --en-option-rest-background - Shared command row customization.
 * @cssprop --en-option-rest-color - Shared command row customization.
 * @cssprop --en-option-hover-background - Shared command row customization.
 * @cssprop --en-option-hover-color - Shared command row customization.
 * @cssprop --en-option-active-background - Shared command row customization.
 * @cssprop --en-option-active-color - Shared command row customization.
 * @cssprop --en-option-pressed-background - Shared command row customization.
 * @cssprop --en-option-pressed-color - Shared command row customization.
 * @cssprop --en-option-disabled-background - Shared command row customization.
 * @cssprop --en-option-disabled-color - Shared command row customization.
 * @slot - Noninteractive command label.
 * @slot prefix - Decorative leading content.
 * @slot suffix - Decorative trailing content.
 * @slot shortcut - Display-only shortcut hint; no keyboard shortcut is registered.
 * @csspart control - Native menuitem button.
 * @csspart option - Shared option row surface; additive to control.
 * @csspart option-disabled - Disabled row; additive to control and option.
 * @csspart label - Command label container.
 * @csspart shortcut - Shortcut slot.
 * @csspart checkmark - Stable decorative checked indicator position.
 * @csspart submenu-indicator - Decorative library chevron for a bound submenu.
 * @fires {import('../events.js').MenuItemChangeEvent} en-change - Cancelable tentative checked state: {previous, proposed, reason: "checked"}; radio peers are staged coherently.
 * @fires {import('../events.js').CommandActionEvent} en-action - Cancelable command intent: {action, data: undefined}. No command is executed by the component.
 */
export declare class EnMenuItem extends EnElement {
    #private;
    static properties: {
        action: {
            type: StringConstructor;
        };
        type: {
            type: StringConstructor;
            reflect: boolean;
        };
        name: {
            type: StringConstructor;
        };
        checked: {
            type: BooleanConstructor;
            reflect: boolean;
            noAccessor: boolean;
        };
        menuHasPopup: {
            type: StringConstructor;
            attribute: string;
        };
        menuExpanded: {
            type: StringConstructor;
            attribute: string;
        };
        disabled: {
            type: BooleanConstructor;
            reflect: boolean;
        };
    };
    static styles: import("lit").CSSResult[];
    /** Application command key; never a callback, URL or native commandfor target. */
    action: string;
    /** Discoverable but cannot activate. Does not use native disabled. */
    disabled: boolean;
    /** Command, independently checkable command, or member of a same-menu radio group. */
    type: 'command' | 'checkbox' | 'radio';
    /** Radio group key scoped to this item's owning menu. */
    name: string;
    /** @internal Trigger ARIA is forwarded to the native menu item. */
    menuHasPopup: string | undefined;
    /** @internal Trigger ARIA is forwarded to the native menu item. */
    menuExpanded: string | undefined;
    /** Tentative checked state during en-change; author writes silently supersede proposals. */
    get checked(): boolean;
    set checked(value: boolean);
    private tabStop;
    constructor();
    protected updated(changes: PropertyValues): void;
    focus(options?: FocusOptions): void;
    private readonly activate;
    protected render(): import("lit-html").TemplateResult<1>;
}
declare global {
    interface HTMLElementTagNameMap {
        'en-menu-item': EnMenuItem;
    }
}

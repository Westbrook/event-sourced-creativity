import { EditableFieldElement } from '../forms-private/editable-field.js';
/**
 * A native single-line editor with a same-shadow visible label and form-associated accepted value.
 * Native drafts emit en-input; non-composing value changes dispatch the cancelable en-change event.
 * The label slot falls back to label. External labels are not forwarded into shadow DOM.
 * @tagname en-text-field
 * @slot prefix - Leading decoration or independently named action; never part of the input label.
 * @slot suffix - Trailing units or independently named action.
 * @slot help-action - Adjacent independently named help button.
 * @slot label - Visible field label; falls back to label.
 * @slot description - Supporting text; falls back to the description attribute/property.
 * @csspart field - Field layout.
 * @csspart label - Visible label.
 * @csspart control - Native input.
 * @csspart focus-frame - Noninteractive field frame supporting the supplemental focus accent.
 * @csspart description - Supporting text.
 * @csspart error - Validation feedback.
 * @cssprop --en-input-border-color - Optional theme presentation; see the customization registry for state, fallback and reachability.
 * @cssprop --en-input-border-width - Optional theme presentation; see the customization registry for state, fallback and reachability.
 * @cssprop --en-input-hover-border-color - Optional theme presentation; see the customization registry for state, fallback and reachability.
 * @cssprop --en-input-invalid-border-color - Optional theme presentation; see the customization registry for state, fallback and reachability.
 * @cssprop --en-input-invalid-border-width - Optional theme presentation; see the customization registry for state, fallback and reachability.
 * @cssprop --en-input-radius - Optional theme presentation; see the customization registry for state, fallback and reachability.
 * @cssprop --en-control-background - Control background.
 * @cssprop --en-input-background - Field fill falling back to the shared control background.
 * @cssprop --en-input-color - Field text falling back to the shared control color.
 * @cssprop --en-color-text - Foreground color.
 * @cssprop --en-control-radius - Control corner radius.
 * @cssprop --en-border-width - Base border width used by padding compensation.
 * @cssprop --en-border-invalid-width - Invalid border width; defaults to 2px and consumes existing padding.
 * @cssprop --en-control-inline-padding - Inline padding before invalid-border compensation.
 * @cssprop --en-field-gap - Gap between label, control and supporting text.
 * @cssprop --en-input-inline-padding - Text-editor inline padding; takes precedence over shared control-inline-padding.
 * @cssprop --en-control-min-size - Minimum control block size.
 * @cssprop --en-input-focus-width - Width of the immediate input-family focus contour.
 * @cssprop --en-input-focus-color - Color of the immediate input-family focus contour.
 * @cssprop --en-input-focus-offset - Offset of the immediate input-family focus contour.
 * @cssprop --en-input-focus-halo-width - Width of the supplemental input-family focus halo.
 * @cssprop --en-input-focus-halo-color - Color of the supplemental input-family focus halo.
 * @cssprop --en-input-focus-accent-width - Thickness of the optional bottom focus accent on the field frame.
 * @cssprop --en-input-focus-accent-color - Color of the optional bottom focus accent on the field frame.
 * @cssprop --en-duration-focus-enter - Entry duration for supplemental focus decoration; the focus contour appears immediately.
 * @cssprop --en-duration-focus-exit - Exit duration for supplemental focus decoration.
 * @cssprop --en-ease-focus-enter - Entry easing for supplemental focus decoration.
 * @cssprop --en-ease-focus-exit - Exit easing for supplemental focus decoration.
 * @fires {import('../events.js').DraftInputEvent} en-input - Current native editing draft and composition state.
 * @fires {import('../events.js').FieldChangeEvent} en-change - Cancelable accepted-value change; provisional value and form data are available during dispatch.
 */
export declare class EnTextField extends EditableFieldElement {
    static properties: {
        label: {
            type: StringConstructor;
        };
        description: {
            type: StringConstructor;
        };
        validationText: {
            attribute: string;
        };
        error: {
            type: StringConstructor;
            noAccessor: boolean;
        };
        value: {
            type: StringConstructor;
            noAccessor: boolean;
            attribute: boolean;
        };
        defaultValue: {
            attribute: string;
            noAccessor: boolean;
        };
        name: {
            type: StringConstructor;
            reflect: boolean;
        };
        disabled: {
            type: BooleanConstructor;
            reflect: boolean;
        };
        required: {
            type: BooleanConstructor;
            reflect: boolean;
        };
        placeholder: {
            type: StringConstructor;
        };
        readOnly: {
            type: BooleanConstructor;
            attribute: string;
            reflect: boolean;
        };
        autocomplete: {
            type: StringConstructor;
        };
        inputMode: {
            type: StringConstructor;
            attribute: string;
        };
        adorned: {
            type: BooleanConstructor;
            reflect: boolean;
        };
        type: {
            type: StringConstructor;
        };
        minLength: {
            type: NumberConstructor;
            attribute: string;
        };
        maxLength: {
            type: NumberConstructor;
            attribute: string;
        };
        pattern: {
            type: StringConstructor;
        };
    };
    static styles: import("lit").CSSResult[];
    /** Opt into prefix/suffix/help-action composition with one field boundary. */
    adorned: boolean;
    type: 'text' | 'email' | 'password' | 'url' | 'tel';
    minLength: number | undefined;
    maxLength: number | undefined;
    pattern: string;
    constructor();
    protected renderControlFrame(): import("lit-html").TemplateResult;
    protected renderControl(): import("lit-html").TemplateResult<1>;
}
declare global {
    interface HTMLElementTagNameMap {
        'en-text-field': EnTextField;
    }
}

import { EditableFieldElement } from '../forms-private/editable-field.js';
/**
 * Native number editing plus keyboard-operable decrement/increment buttons.
 * Accepted value is a string, including the empty string; bounds and stepping use native number semantics.
 * Label slots prefer consumer content and fall back to the corresponding label properties.
 * @cssprop --en-number-step-pressed-scale - number-step held-state refinement; geometry is bounded and reduced motion wins.
 * @cssprop --en-number-step-pressed-offset - number-step held-state refinement; geometry is bounded and reduced motion wins.
 * @cssprop --en-number-step-press-duration - number-step held-state refinement; geometry is bounded and reduced motion wins.
 * @cssprop --en-number-step-release-duration - number-step held-state refinement; geometry is bounded and reduced motion wins.
 * @cssprop --en-number-step-pressed-shadow - number-step held-state refinement; geometry is bounded and reduced motion wins.
 * @cssprop --en-number-step-pressed-background - number-step held-state refinement; geometry is bounded and reduced motion wins.
 * @tagname en-number-field
 * @slot label - Visible field label; falls back to label.
 * @slot description - Supporting text; falls back to the description attribute/property.
 * @slot decrement-label - Accessible decrement action name; falls back to decrement-label.
 * @slot increment-label - Accessible increment action name; falls back to increment-label.
 * @csspart field - Field layout.
 * @csspart label - Visible label.
 * @csspart control - Native number input.
 * @csspart focus-frame - Noninteractive field frame supporting the supplemental focus accent.
 * @csspart stepper - Group containing input and step buttons.
 * @csspart decrement - Decrease button.
 * @csspart increment - Increase button.
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
 * @cssprop --en-control-radius - Control corner radius.
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
export declare class EnNumberField extends EditableFieldElement {
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
        min: {
            type: NumberConstructor;
        };
        max: {
            type: NumberConstructor;
        };
        step: {
            type: NumberConstructor;
        };
        decrementLabel: {
            type: StringConstructor;
            attribute: string;
        };
        incrementLabel: {
            type: StringConstructor;
            attribute: string;
        };
    };
    min: number | undefined;
    max: number | undefined;
    step: number;
    decrementLabel: string;
    incrementLabel: string;
    constructor();
    private stepValue;
    /** The compound stepper is already the complete paint frame; avoid a second wrapper. */
    protected renderControlFrame(): import("lit-html").TemplateResult<1>;
    protected renderControl(): import("lit-html").TemplateResult<1>;
}
declare global {
    interface HTMLElementTagNameMap {
        'en-number-field': EnNumberField;
    }
}

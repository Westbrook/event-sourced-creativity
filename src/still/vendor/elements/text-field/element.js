import { adornedFieldStyles } from '../../styles/controls.js';
import { html, nothing } from 'lit';
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
export class EnTextField extends EditableFieldElement {
    static properties = {
        ...EditableFieldElement.properties,
        adorned: { type: Boolean, reflect: true },
        type: { type: String },
        minLength: { type: Number, attribute: 'minlength' },
        maxLength: { type: Number, attribute: 'maxlength' },
        pattern: { type: String },
    };
    static styles = [...EditableFieldElement.styles, adornedFieldStyles];
    constructor() {
        super();
        this.type = 'text';
        this.adorned = false;
        this.minLength = undefined;
        this.maxLength = undefined;
        this.pattern = '';
    }
    renderControlFrame() {
        if (!this.adorned)
            return super.renderControlFrame();
        return html `<div class="en-field-focus-frame en-adorned" part="focus-frame" ?data-invalid=${Boolean(this.visibleError)}><slot name="prefix"></slot>${this.renderControl()}<slot name="suffix"></slot><slot name="help-action"></slot></div>`;
    }
    renderControl() {
        const inputType = ['text', 'email', 'password', 'url', 'tel'].includes(this.type) ? this.type : 'text';
        return html `<input id="control" class="en-input en-text-input" part="control"
      type=${inputType} name=${this.name} value=${this.defaultControlValue}
      placeholder=${this.placeholder || nothing} autocomplete=${this.autocomplete || nothing}
      inputmode=${this.inputMode || nothing} minlength=${this.minLength ?? nothing}
      maxlength=${this.maxLength ?? nothing} pattern=${this.pattern || nothing}
      ?disabled=${this.isDisabled} ?readonly=${this.readOnly} ?required=${this.required}
      aria-describedby=${this.describedBy} aria-invalid=${this.controlAriaInvalid}>`;
    }
}

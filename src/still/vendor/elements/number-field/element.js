import { html, nothing } from 'lit';
import { EditableFieldElement } from '../forms-private/editable-field.js';
/**
 * Native number editing plus keyboard-operable decrement/increment buttons.
 * Accepted value is a string, including the empty string; bounds and stepping use native number semantics.
 * Label slots prefer consumer content and fall back to the corresponding label properties.
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
 * @cssprop --en-control-background - Control background.
 * @cssprop --en-input-background - Field fill when no control background override is set.
 * @cssprop --en-input-color - Field text when no control color override is set.
 * @cssprop --en-control-radius - Control corner radius.
 * @cssprop --en-field-gap - Gap between label, control and supporting text.
 * @cssprop --en-input-inline-padding - Text-editor inline padding; shared control-inline-padding takes precedence.
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
 * @fires en-input - Current native editing draft and composition state.
 * @fires en-change - Cancelable accepted-value change; provisional value and form data are available during dispatch.
 */
export class EnNumberField extends EditableFieldElement {
    static properties = {
        ...EditableFieldElement.properties,
        min: { type: Number },
        max: { type: Number },
        step: { type: Number },
        decrementLabel: { type: String, attribute: 'decrement-label' },
        incrementLabel: { type: String, attribute: 'increment-label' },
    };
    constructor() {
        super();
        this.min = undefined;
        this.max = undefined;
        this.step = 1;
        this.decrementLabel = 'Decrease value';
        this.incrementLabel = 'Increase value';
    }
    stepValue(direction) {
        const control = this.controlNode;
        if (!control || this.isDisabled || this.readOnly || this.model.isComposing.get())
            return;
        // Compute the native step without changing the live draft before a cancelable action is accepted.
        const candidate = control.cloneNode();
        candidate.value = control.value;
        if (direction < 0)
            candidate.stepDown();
        else
            candidate.stepUp();
        this.requestValue(candidate.value, direction < 0 ? 'decrement' : 'increment');
    }
    /** The compound stepper is already the complete paint frame; avoid a second wrapper. */
    renderControlFrame() { return this.renderControl(); }
    renderControl() {
        const draft = this.model.draft.get();
        const numeric = draft === '' ? undefined : Number(draft);
        const decrementDisabled = this.isDisabled || this.readOnly || (numeric !== undefined && this.min !== undefined && numeric <= this.min);
        const incrementDisabled = this.isDisabled || this.readOnly || (numeric !== undefined && this.max !== undefined && numeric >= this.max);
        return html `<div class="en-input-group en-number-group en-field-focus-frame" part="stepper focus-frame" data-invalid=${this.visibleError ? '' : nothing}>
      <button class="en-button en-button--quiet en-icon-button en-number-step en-number-decrement" part="decrement" type="button"
        ?disabled=${decrementDisabled} @click=${() => this.stepValue(-1)}><span class="en-sr-only"><slot name="decrement-label">${this.decrementLabel}</slot></span><span aria-hidden="true">−</span></button>
      <input id="control" class="en-input en-number-input" part="control" type="number" name=${this.name}
        value=${this.defaultControlValue} min=${this.min ?? nothing} max=${this.max ?? nothing} step=${this.step}
        placeholder=${this.placeholder || nothing} autocomplete=${this.autocomplete || nothing}
        inputmode=${this.inputMode || nothing} ?disabled=${this.isDisabled} ?readonly=${this.readOnly} ?required=${this.required}
        aria-describedby=${this.describedBy} aria-invalid=${this.controlAriaInvalid}>
      <button class="en-button en-button--quiet en-icon-button en-number-step en-number-increment" part="increment" type="button"
        ?disabled=${incrementDisabled} @click=${() => this.stepValue(1)}><span class="en-sr-only"><slot name="increment-label">${this.incrementLabel}</slot></span><span aria-hidden="true">+</span></button>
    </div>`;
    }
}

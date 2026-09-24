import { ChoiceBase } from './choice-base.js';
/**
 * A form-associated checkbox. Application writes are silent; canceling en-change restores the native control without moving focus.
 * @cssprop --en-checkbox-pressed-scale - checkbox held-state refinement; geometry is bounded and reduced motion wins.
 * @cssprop --en-checkbox-pressed-offset - checkbox held-state refinement; geometry is bounded and reduced motion wins.
 * @cssprop --en-checkbox-press-duration - checkbox held-state refinement; geometry is bounded and reduced motion wins.
 * @cssprop --en-checkbox-release-duration - checkbox held-state refinement; geometry is bounded and reduced motion wins.
 * @cssprop --en-checkbox-pressed-shadow - checkbox held-state refinement; geometry is bounded and reduced motion wins.
 * @cssprop --en-checkbox-pressed-border-color - checkbox held-state refinement; geometry is bounded and reduced motion wins.
 * @tagname en-checkbox
 * @slot - The visible label. Use plain text or phrasing content.
 * @slot label - Preferred visible label; falls back to the default slot and then the label attribute.
 * @slot description - Supporting text; falls back to the description attribute/property.
 * @csspart field - The outer field.
 * @csspart control - The native checkbox.
 * @csspart label - The associated label.
 * @csspart label-text - Label content referenced by the native control; plain labels may be visually omitted with display:none.
 * @csspart description - Supporting text.
 * @csspart error - Associated application or constraint validation feedback.
 * @cssprop --en-choice-size - Optional family presentation; see the customization registry.
 * @cssprop --en-color-action - Selected control color.
 * @cssprop --en-size-target-touch - Minimum pointer target.
 * @fires {import('../../primitives/interactions/events.js').ChangeEvent<boolean>} en-change - Tentative, cancelable change; the property and form data expose the proposed state during dispatch.
 */
export class EnCheckbox extends ChoiceBase {
    static properties = { ...ChoiceBase.properties, indeterminate: { type: Boolean, noAccessor: true } };
    mixedState = false;
    /** A visual/accessible mixed state. An accepted user change clears it. */
    get indeterminate() { return this.mixedState; }
    set indeterminate(value) {
        ++this.authorRevision;
        this.setIndeterminate(Boolean(value));
    }
    setIndeterminate(value) {
        const previous = this.mixedState;
        this.mixedState = value;
        this.requestUpdate('indeterminate', previous);
        this.syncControl();
    }
    get kind() { return 'checkbox'; }
    get mixed() { return this.indeterminate; }
    didCommit() { this.setIndeterminate(false); }
    formResetCallback() { this.indeterminate = false; super.formResetCallback(); }
}

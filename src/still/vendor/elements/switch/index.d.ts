import { ChoiceBase } from '../checkbox/choice-base.js';
/**
 * An immediate on/off setting, backed by a native checkbox with switch semantics.
 * @cssprop --en-switch-pressed-scale - switch held-state refinement; geometry is bounded and reduced motion wins.
 * @cssprop --en-switch-pressed-offset - switch held-state refinement; geometry is bounded and reduced motion wins.
 * @cssprop --en-switch-press-duration - switch held-state refinement; geometry is bounded and reduced motion wins.
 * @cssprop --en-switch-release-duration - switch held-state refinement; geometry is bounded and reduced motion wins.
 * @cssprop --en-switch-pressed-shadow - switch held-state refinement; geometry is bounded and reduced motion wins.
 * @cssprop --en-switch-pressed-border-color - switch held-state refinement; geometry is bounded and reduced motion wins.
 * @cssprop --en-switch-thumb-pressed-size - Thumb-only held geometry; reduced motion retains rest geometry.
 * @tagname en-switch
 * @slot - The visible setting label.
 * @slot label - Preferred visible setting label; falls back to the default slot and then the label attribute.
 * @slot description - Supporting text; falls back to the description attribute/property.
 * @csspart field - The outer field.
 * @csspart control - The native switch control.
 * @csspart label - The associated label.
 * @csspart label-text - Label content referenced by the native control; plain labels may be visually omitted with display:none.
 * @csspart description - Supporting text.
 * @csspart error - Associated application or constraint validation feedback.
 * @cssprop --en-switch-block-size - Optional family presentation; see the customization registry.
 * @cssprop --en-switch-inline-size - Optional family presentation; see the customization registry.
 * @cssprop --en-switch-thumb-size - Optional family presentation; see the customization registry.
 * @cssprop --en-color-action - Enabled setting color.
 * @cssprop --en-size-target-touch - Minimum pointer target.
 * @fires {import('../../primitives/interactions/events.js').ChangeEvent<boolean>} en-change - Tentative, cancelable change; the property and form data expose the proposed state during dispatch.
 */
export declare class EnSwitch extends ChoiceBase {
    protected get kind(): 'switch';
}
declare global {
    interface HTMLElementTagNameMap {
        'en-switch': EnSwitch;
    }
}

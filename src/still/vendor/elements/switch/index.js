import { ChoiceBase } from '../checkbox/choice-base.js';
/**
 * An immediate on/off setting, backed by a native checkbox with switch semantics.
 * @tagname en-switch
 * @slot - The visible setting label.
 * @slot label - Preferred visible setting label; falls back to the default slot and then the label attribute.
 * @slot description - Supporting text; falls back to the description attribute/property.
 * @csspart field - The outer field.
 * @csspart control - The native switch control.
 * @csspart label - The associated label.
 * @csspart label-text - Label content referenced by the native control; plain labels may be visually omitted with display:none.
 * @csspart description - Supporting text.
 * @cssprop --en-color-action - Enabled setting color.
 * @cssprop --en-size-target-touch - Minimum pointer target.
 * @fires {import('../../primitives/interactions/events.js').ChangeEvent<boolean>} en-change - Tentative, cancelable change; the property and form data expose the proposed state during dispatch.
 */
export class EnSwitch extends ChoiceBase {
    get kind() { return 'switch'; }
}

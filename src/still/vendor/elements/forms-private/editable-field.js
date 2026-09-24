import { EditingController } from '../../primitives/interactions/editing-controller.js';
import { FormFieldElement } from './form-field.js';
/** Private native-editing adapter shared by text, multiline, date and numeric fields. */
export class EditableFieldElement extends FormFieldElement {
    static properties = {
        ...FormFieldElement.properties,
        readOnly: { type: Boolean, attribute: 'readonly', reflect: true },
        autocomplete: { type: String },
        inputMode: { type: String, attribute: 'inputmode' },
    };
    editing = new EditingController(this, {
        model: this.model,
        control: () => this.controlNode,
        onCommit: (value, reason) => {
            if (!this.readOnly)
                this.requestValue(value, reason);
        },
    });
    constructor() {
        super();
        this.readOnly = false;
        this.autocomplete = '';
        this.inputMode = '';
    }
    canCommitValue(value) {
        return !this.readOnly && super.canCommitValue(value);
    }
    reconcile() { this.editing?.sync(); }
    /** Select editable text using native selection behavior where the input type supports it. */
    select() { this.controlNode?.select(); }
}

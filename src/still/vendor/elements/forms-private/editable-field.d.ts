import { EditingController } from '../../primitives/interactions/editing-controller.js';
import { FormFieldElement } from './form-field.js';
/** Private native-editing adapter shared by text, multiline, date and numeric fields. */
export declare abstract class EditableFieldElement extends FormFieldElement {
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
    };
    /** Preserve focus and text selection while preventing edits. */
    readOnly: boolean;
    /** Native autocomplete purpose, such as email or current-password. */
    autocomplete: string;
    inputMode: string;
    protected readonly editing: EditingController;
    constructor();
    protected canCommitValue(value: string): boolean;
    protected reconcile(): void;
    /** Select editable text using native selection behavior where the input type supports it. */
    select(): void;
}

import { DefaultState } from './default-state.js';
import { nothing } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import type { FormValidation } from '../../primitives/interactions/form-controller.js';
import { EnElement } from '../internal/en-element.js';
export type NativeField = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
/** Private adapter. Internal nodes, selectors and IDs are not public APIs.
 * @fires {import('../events.js').FieldChangeEvent} en-change - Cancelable tentative string value.
 */
export declare abstract class FormFieldElement extends EnElement {
    static formAssociated: boolean;
    protected readonly valueDefaults: DefaultState<string>;
    /** Reset default, reflected synchronously to the value attribute. Pristine controls follow default changes. */
    get defaultValue(): string;
    set defaultValue(value: string);
    /** @internal Route default attributes without invoking the live-state setter as an author edit. */
    attributeChangedCallback(name: string, old: string | null, value: string | null): void;
    static styles: import("lit").CSSResult[];
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
    };
    /** Fallback visible label when no content is assigned to the label slot. */
    label: string;
    /** Supporting text read with the control. */
    description: string;
    /** Application-supplied error; also sets custom validity until cleared. */
    private applicationError;
    /** Application-supplied error; sets custom validity until cleared. */
    get error(): string;
    set error(value: string);
    /** Localized constraint-message override; text alone never invalidates a control. */
    validationText: string;
    /** Successful form control name. */
    name: string;
    disabled: boolean;
    required: boolean;
    placeholder: string;
    protected readonly model: import("../../primitives/state/draft.js").DraftModel;
    private readonly signal;
    private readonly internals;
    private readonly formAdapter;
    private authorRevision;
    private showNativeError;
    private nativeErrorMessage;
    constructor();
    /** Accepted string value. Assigning even the same value explicitly reconciles a different draft. */
    get value(): string;
    set value(value: string);
    get form(): HTMLFormElement | null;
    get labels(): NodeList | undefined;
    get validity(): ValidityState | undefined;
    get validationMessage(): string;
    get willValidate(): boolean;
    focus(options?: FocusOptions): void;
    blur(): void;
    checkValidity(): boolean;
    reportValidity(): boolean;
    /** Restore defaultValue unless the application cancels the containing form's native reset event. */
    formResetCallback(): void;
    formDisabledCallback(disabled: boolean): void;
    /** Browser restoration is an authoritative, silent accepted-value write. */
    formStateRestoreCallback(state: string | File | FormData | null, mode: 'restore' | 'autocomplete'): void;
    /** Successful native submission data; a subclass may omit an unavailable accepted choice. */
    protected get submissionValue(): string | FormData | null;
    protected get submissionState(): string;
    protected get isDisabled(): boolean;
    /** First delivery paints current state; after adoption, native defaults follow the public default. */
    protected get defaultControlValue(): string;
    protected get controlNode(): NativeField | null;
    protected get describedBy(): string;
    protected get visibleError(): string;
    protected get controlAriaInvalid(): 'true' | typeof nothing;
    protected abstract renderControl(): TemplateResult;
    /** A paint-only wrapper keeps supplemental focus decoration off native replaced controls. */
    protected renderControlFrame(): TemplateResult;
    /** Tracks explicit writes, including same-value assignments, for subclass adoption guards. */
    protected get valueRevision(): number;
    /** Revalidate a proposed value after synchronous consumer edits to its available choices. */
    protected canCommitValue(_value: string): boolean;
    protected abstract reconcile(): void;
    /** Stage accepted submission data while preserving the native draft, selection and composition. */
    protected stageValue(value: string): void;
    protected requestValue(proposed: string, reason: string): void;
    protected updated(_changed: PropertyValues): void;
    /** Native constraints validate accepted submission data, which can differ from an unaccepted draft. */
    protected syncForm(): void;
    protected validateAcceptedValue(): FormValidation;
    /** Distinct source aliases let composites preserve legacy mappings across browsers. */
    protected descriptionPart: string;
    protected errorPart: string;
    protected render(): TemplateResult;
}

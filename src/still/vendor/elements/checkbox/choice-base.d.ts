import { DefaultState } from '../forms-private/default-state.js';
import type { PropertyValues } from 'lit';
import { EnElement } from '../internal/en-element.js';
import { SignalController } from '../../primitives/interactions/signal-controller.js';
import { FormController } from '../../primitives/interactions/form-controller.js';
import type { FormValidation } from '../../primitives/interactions/form-controller.js';
/** Shared native toggle adapter. Element classes own their public names and metadata. */
export declare abstract class ChoiceBase extends EnElement {
    static properties: {
        error: {
            noAccessor: boolean;
        };
        validationText: {
            attribute: string;
        };
        checked: {
            type: BooleanConstructor;
            noAccessor: boolean;
            attribute: boolean;
        };
        defaultChecked: {
            type: BooleanConstructor;
            attribute: string;
            noAccessor: boolean;
        };
        disabled: {
            type: BooleanConstructor;
            reflect: boolean;
        };
        required: {
            type: BooleanConstructor;
            reflect: boolean;
        };
        name: {
            reflect: boolean;
        };
        value: {};
        label: {};
        description: {};
    };
    static styles: import("lit").CSSResult[];
    static formAssociated: boolean;
    protected readonly checkedDefaults: DefaultState<boolean>;
    private readonly feedback;
    /** Application-supplied error; sets custom validity until explicitly cleared. */
    get error(): string;
    set error(value: string);
    protected get visibleError(): string;
    /** Reset default, reflected synchronously to the checked attribute. Pristine controls follow default changes. */
    get defaultChecked(): boolean;
    set defaultChecked(value: boolean);
    /** @internal Route default attributes without invoking the live-state setter as an author edit. */
    attributeChangedCallback(name: string, old: string | null, value: string | null): void;
    protected readonly checkedModel: import("../../primitives/state/value.js").ValueModel<boolean>;
    protected readonly signalController: SignalController<import("../../primitives/state/value.js").ValueSnapshot<boolean>>;
    protected authorRevision: number;
    protected formDisabled: boolean;
    protected readonly internals: ElementInternals | undefined;
    protected readonly formController: FormController | undefined;
    /** Localized required-constraint message; does not itself invalidate the control. */
    validationText: string;
    /** Disable interaction and omit the field from form data. */
    disabled: boolean;
    /** Require checked state for native form validation. */
    required: boolean;
    /** The form entry name. */
    name: string;
    /** Submitted value while checked; defaults to on. */
    value: string;
    /** Plain-text label fallback when no label content is slotted. */
    label: string;
    /** Supporting text associated with the native input. */
    description: string;
    constructor();
    /** Current checked state; user changes are tentative during en-change. The checked attribute defines the reset default. */
    get checked(): boolean;
    set checked(value: boolean);
    /** Apply component-owned state without claiming an authoritative application write. */
    protected setChecked(value: boolean): void;
    protected abstract get kind(): 'checkbox' | 'switch' | 'radio';
    protected get mixed(): boolean;
    protected get effectiveDisabled(): boolean;
    protected get controlTabIndex(): number;
    protected get nativeControl(): HTMLInputElement | null;
    protected get formValue(): string | null;
    focus(options?: FocusOptions): void;
    get form(): HTMLFormElement | null;
    get labels(): NodeList | undefined;
    get willValidate(): boolean;
    get validity(): ValidityState | undefined;
    get validationMessage(): string;
    checkValidity(): boolean;
    reportValidity(): boolean;
    formDisabledCallback(disabled: boolean): void;
    formResetCallback(): void;
    formStateRestoreCallback(state: string | File | FormData, mode?: 'restore' | 'autocomplete'): void;
    protected formValidation(): FormValidation;
    protected syncForm(): void;
    protected syncControl(): void;
    protected handleChange(_event: Event): void;
    protected didCommit(): void;
    protected updated(_changes: PropertyValues): void;
    protected render(): import("lit-html").TemplateResult<1>;
}

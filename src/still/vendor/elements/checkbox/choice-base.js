import { EnElement } from '../internal/en-element.js';
import { createValueModel } from '../../primitives/state/value.js';
import { SignalController } from '../../primitives/interactions/signal-controller.js';
import { dispatchChange } from '../../primitives/interactions/events.js';
import { FormController } from '../../primitives/interactions/form-controller.js';
import { foundationStyles, blockHostStyles } from '../../styles/foundations.js';
import { controlStyles, formStyles } from '../../styles/controls.js';
import { selectionStyles } from '../../styles/selection.js';
import { choiceTemplate } from './template.js';
/** Shared native toggle adapter. Element classes own their public names and metadata. */
export class ChoiceBase extends EnElement {
    static properties = {
        checked: { type: Boolean, noAccessor: true },
        disabled: { type: Boolean, reflect: true },
        required: { type: Boolean }, name: {}, value: {}, label: {}, description: {},
    };
    static styles = [foundationStyles, blockHostStyles, controlStyles, formStyles, selectionStyles];
    static formAssociated = true;
    checkedModel = createValueModel(false);
    signalController = new SignalController(this, () => this.checkedModel.view.get());
    authorRevision = 0;
    formDisabled = false;
    internals = typeof this.attachInternals === 'function' ? this.attachInternals() : undefined;
    formController = this.internals ? new FormController(this, {
        internals: this.internals, control: () => this.nativeControl,
        value: () => this.formValue, state: () => this.checked ? 'checked' : 'unchecked',
        disabled: () => this.effectiveDisabled,
        onReset: () => { this.checked = this.hasAttribute('checked'); this.syncControl(); },
        onRestore: (state) => { if (typeof state === 'string')
            this.checked = state === 'checked'; this.syncControl(); },
        validate: () => this.formValidation(),
    }) : undefined;
    constructor() {
        super();
        this.disabled = false;
        this.required = false;
        this.name = '';
        this.value = 'on';
        this.label = '';
        this.description = '';
    }
    /** Current checked state; user changes are tentative during en-change. The checked attribute defines the reset default. */
    get checked() { return this.checkedModel.value.get(); }
    set checked(value) {
        ++this.authorRevision;
        this.setChecked(Boolean(value));
    }
    /** Apply component-owned state without claiming an authoritative application write. */
    setChecked(value) {
        const previous = this.checked;
        this.checkedModel.set(value);
        this.requestUpdate('checked', previous);
        this.syncForm();
    }
    get mixed() { return false; }
    get effectiveDisabled() { return this.disabled || this.formDisabled; }
    get controlTabIndex() { return 0; }
    get nativeControl() { return this.renderRoot?.querySelector('input') ?? null; }
    get formValue() { return this.checked ? this.value : null; }
    focus(options) { this.nativeControl?.focus(options); }
    get form() { return this.internals?.form ?? null; }
    get validity() { return this.internals?.validity; }
    get validationMessage() { return this.internals?.validationMessage ?? ''; }
    checkValidity() { return this.internals?.checkValidity?.() ?? true; }
    reportValidity() { return this.internals?.reportValidity?.() ?? true; }
    formDisabledCallback(disabled) {
        this.formDisabled = disabled;
        this.requestUpdate();
        this.formController?.formDisabled(disabled);
    }
    formResetCallback() {
        this.formController?.formReset();
    }
    formStateRestoreCallback(state, mode = 'restore') {
        this.formController?.formStateRestore(state, mode);
    }
    formValidation() {
        const missing = this.required && !this.checked && !this.effectiveDisabled;
        return { flags: missing ? { valueMissing: true } : {},
            message: missing ? this.nativeControl?.validationMessage || 'Please select this option.' : '', anchor: this.nativeControl ?? undefined };
    }
    syncForm() { this.formController?.sync(); }
    syncControl() {
        if (this.nativeControl) {
            this.nativeControl.checked = this.checked;
            this.nativeControl.indeterminate = this.mixed;
        }
    }
    handleChange(_event) {
        if (this.effectiveDisabled) {
            this.syncControl();
            return;
        }
        const proposed = this.nativeControl?.checked ?? !this.checked;
        dispatchChange(this, {
            previous: this.checked, proposed, reason: 'toggle',
            getRevision: () => this.authorRevision,
            stage: (next) => { this.setChecked(next); this.syncControl(); },
            rollback: (previous) => { this.setChecked(previous); this.syncControl(); },
            commit: () => { this.didCommit(); this.syncForm(); },
        });
        this.syncControl();
    }
    didCommit() { }
    updated(_changes) { this.syncForm(); this.syncControl(); }
    render() {
        return choiceTemplate({
            kind: this.kind, checked: this.checked, indeterminate: this.mixed,
            disabled: this.effectiveDisabled, required: this.required, value: this.value,
            label: this.label, description: this.description, tabIndex: this.controlTabIndex,
        }, (event) => this.handleChange(event));
    }
}

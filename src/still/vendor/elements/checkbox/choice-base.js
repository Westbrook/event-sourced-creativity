import { applicationValidation, ValidationFeedback } from '../forms-private/validation-feedback.js';
import { DefaultState } from '../forms-private/default-state.js';
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
        error: { noAccessor: true }, validationText: { attribute: 'validation-text' },
        checked: { type: Boolean, noAccessor: true, attribute: false },
        defaultChecked: { type: Boolean, attribute: 'checked', noAccessor: true },
        disabled: { type: Boolean, reflect: true },
        required: { type: Boolean, reflect: true }, name: { reflect: true }, value: {}, label: {}, description: {},
    };
    static styles = [foundationStyles, blockHostStyles, controlStyles, formStyles, selectionStyles];
    static formAssociated = true;
    checkedDefaults = new DefaultState(this, 'checked', attribute => attribute !== null, value => value ? '' : null, value => { this.checked = value; });
    feedback = new ValidationFeedback(this, () => { this.syncForm(); }, () => this.validationMessage);
    /** Application-supplied error; sets custom validity until explicitly cleared. */
    get error() { return this.feedback.error; }
    set error(value) { this.feedback.error = value; }
    get visibleError() { return this.feedback.visible; }
    /** Reset default, reflected synchronously to the checked attribute. Pristine controls follow default changes. */
    get defaultChecked() { return this.checkedDefaults.value; }
    set defaultChecked(value) { this.checkedDefaults.value = Boolean(value); }
    /** @internal Route default attributes without invoking the live-state setter as an author edit. */
    attributeChangedCallback(name, old, value) {
        if (name === 'checked') {
            this.checkedDefaults.attributeChanged();
            return;
        }
        super.attributeChangedCallback(name, old, value);
    }
    checkedModel = createValueModel(false);
    signalController = new SignalController(this, () => this.checkedModel.view.get());
    authorRevision = 0;
    formDisabled = false;
    internals = typeof this.attachInternals === 'function' ? this.attachInternals() : undefined;
    formController = this.internals ? new FormController(this, {
        internals: this.internals, control: () => this.nativeControl,
        value: () => this.formValue, state: () => this.checked ? 'checked' : 'unchecked',
        disabled: () => this.effectiveDisabled,
        onReset: () => { this.feedback.reset(); this.checkedDefaults.reset(); this.syncControl(); },
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
        this.validationText = '';
        this.label = '';
        this.description = '';
    }
    /** Current checked state; user changes are tentative during en-change. The checked attribute defines the reset default. */
    get checked() { return this.checkedModel.value.get(); }
    set checked(value) {
        this.checkedDefaults.markDirty();
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
    get labels() { return this.internals?.labels; }
    get willValidate() { return this.internals?.willValidate ?? false; }
    get validity() { return this.internals?.validity; }
    get validationMessage() { return this.internals?.validationMessage ?? ''; }
    checkValidity() { this.syncForm(); return this.internals?.checkValidity?.() ?? true; }
    reportValidity() { this.syncForm(); return this.internals?.reportValidity?.() ?? true; }
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
        return applicationValidation({ flags: missing ? { valueMissing: true } : {},
            message: missing ? this.validationText || this.nativeControl?.validationMessage || 'Please select this option.' : '', anchor: this.nativeControl ?? undefined }, this.error);
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
        this.checkedDefaults.markDirty();
        const proposed = this.nativeControl?.checked ?? !this.checked;
        const connected = this.isConnected;
        dispatchChange(this, {
            previous: this.checked, proposed, reason: 'toggle',
            getRevision: () => this.authorRevision,
            canCommit: () => !this.effectiveDisabled && (!connected || this.isConnected),
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
            label: this.label, description: this.description, error: this.visibleError, tabIndex: this.controlTabIndex,
        }, (event) => this.handleChange(event));
    }
}

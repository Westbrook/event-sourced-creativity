import { descriptionTemplate } from '../../primitives/templates/description.js';
import { css, html, nothing } from 'lit';
import { createDraftModel } from '../../primitives/state/draft.js';
import { dispatchChange } from '../../primitives/interactions/events.js';
import { SignalController } from '../../primitives/interactions/signal-controller.js';
import { FormController } from '../../primitives/interactions/form-controller.js';
import { foundationStyles } from '../../styles/foundations.js';
import { formStyles, controlStyles } from '../../styles/controls.js';
import { EnElement } from '../internal/en-element.js';
/** Private adapter. Internal nodes, selectors and IDs are not public APIs. */
export class FormFieldElement extends EnElement {
    static formAssociated = true;
    static styles = [foundationStyles, formStyles, controlStyles, css `:host { display: block; }`];
    static properties = {
        label: { type: String },
        description: { type: String },
        error: { type: String },
        value: { type: String, noAccessor: true },
        name: { type: String, reflect: true },
        disabled: { type: Boolean, reflect: true },
        required: { type: Boolean, reflect: true },
        placeholder: { type: String },
    };
    model = createDraftModel();
    signal = new SignalController(this, () => this.model.view.get());
    internals;
    formAdapter;
    authorRevision = 0;
    initialValue;
    showNativeError = false;
    nativeErrorMessage = '';
    constructor() {
        super();
        this.label = '';
        this.description = '';
        this.error = '';
        this.name = '';
        this.disabled = false;
        this.required = false;
        this.placeholder = '';
        this.internals = typeof this.attachInternals === 'function' ? this.attachInternals() : undefined;
        if (this.internals)
            this.formAdapter = new FormController(this, {
                internals: this.internals,
                control: () => this.controlNode,
                value: () => this.submissionValue,
                state: () => this.value,
                disabled: () => this.disabled,
                validate: () => this.validateAcceptedValue(),
                onReset: () => {
                    this.showNativeError = false;
                    this.value = this.initialValue ?? '';
                },
                onRestore: state => {
                    if (typeof state === 'string')
                        this.value = state;
                },
            });
        this.addEventListener('invalid', () => {
            this.showNativeError = true;
            this.requestUpdate();
        });
    }
    /** Accepted string value. Assigning even the same value explicitly reconciles a different draft. */
    get value() { return this.model.value.get(); }
    set value(value) {
        const previous = this.value;
        this.authorRevision++;
        this.model.setValue(String(value ?? ''));
        this.reconcile();
        this.syncForm();
        this.requestUpdate('value', previous);
    }
    get form() { return this.internals?.form ?? null; }
    get labels() { return this.internals?.labels; }
    get validity() { return this.internals?.validity ?? this.controlNode?.validity; }
    get validationMessage() { return this.internals?.validationMessage ?? ''; }
    get willValidate() { return this.internals?.willValidate ?? false; }
    willUpdate(_changed) {
        super.willUpdate(_changed);
        if (this.initialValue === undefined)
            this.initialValue = this.value;
    }
    focus(options) { this.controlNode?.focus(options); }
    blur() { this.controlNode?.blur(); }
    checkValidity() {
        this.syncForm();
        return this.internals?.checkValidity?.() ?? this.controlNode?.checkValidity() ?? true;
    }
    reportValidity() {
        this.syncForm();
        return this.internals?.reportValidity?.() ?? this.controlNode?.reportValidity() ?? true;
    }
    /** Restore the initial value unless the application cancels the containing form's native reset event. */
    formResetCallback() {
        this.formAdapter?.formReset();
    }
    formDisabledCallback(disabled) {
        this.formAdapter?.formDisabled(disabled);
    }
    /** Browser restoration is an authoritative, silent accepted-value write. */
    formStateRestoreCallback(state, mode) {
        this.formAdapter?.formStateRestore(state, mode);
    }
    /** Successful native submission data; a subclass may omit an unavailable accepted choice. */
    get submissionValue() { return this.value; }
    get isDisabled() { return this.formAdapter?.disabled ?? this.disabled; }
    /** A stable default attribute supports SSR without rewriting native editing defaults on each draft. */
    get defaultControlValue() { return this.initialValue ?? this.value; }
    get controlNode() {
        return this.shadowRoot?.querySelector('#control') ?? null;
    }
    get describedBy() {
        return this.visibleError ? 'description error' : 'description';
    }
    get visibleError() {
        return this.error || (this.showNativeError ? this.nativeErrorMessage : '');
    }
    get controlAriaInvalid() { return this.visibleError ? 'true' : nothing; }
    /** A paint-only wrapper keeps supplemental focus decoration off native replaced controls. */
    renderControlFrame() {
        return html `<div class="en-field-focus-frame" part="focus-frame">${this.renderControl()}</div>`;
    }
    /** Tracks explicit writes, including same-value assignments, for subclass adoption guards. */
    get valueRevision() { return this.authorRevision; }
    /** Revalidate a proposed value after synchronous consumer edits to its available choices. */
    canCommitValue(_value) { return true; }
    /** Stage accepted submission data while preserving the native draft, selection and composition. */
    stageValue(value) {
        const previous = this.value;
        this.model.stageValue(value);
        this.syncForm();
        this.requestUpdate('value', previous);
    }
    requestValue(proposed, reason) {
        if (this.isDisabled)
            return;
        dispatchChange(this, {
            previous: this.value,
            proposed,
            reason,
            getRevision: () => this.authorRevision,
            canCommit: value => this.canCommitValue(value),
            stage: value => this.stageValue(value),
            rollback: value => this.stageValue(value),
            commit: value => {
                this.model.setValue(value);
                this.reconcile();
                this.syncForm();
                this.requestUpdate();
            },
        });
    }
    updated(_changed) {
        super.updated(_changed);
        this.reconcile();
        this.syncForm();
    }
    /** Native constraints validate accepted submission data, which can differ from an unaccepted draft. */
    syncForm() {
        const previousMessage = this.nativeErrorMessage;
        this.formAdapter?.sync();
        this.nativeErrorMessage = this.validationMessage;
        if (this.showNativeError && previousMessage !== this.nativeErrorMessage)
            this.requestUpdate();
    }
    validateAcceptedValue() {
        const control = this.controlNode;
        if (!control)
            return { flags: {} };
        const validationControl = control.value === this.value ? control : control.cloneNode(true);
        if (validationControl !== control)
            validationControl.value = this.value;
        validationControl.setCustomValidity(this.error);
        const native = validationControl.validity;
        const flags = {
            badInput: native.badInput,
            customError: native.customError,
            patternMismatch: native.patternMismatch,
            rangeOverflow: native.rangeOverflow,
            rangeUnderflow: native.rangeUnderflow,
            stepMismatch: native.stepMismatch,
            tooLong: native.tooLong,
            tooShort: native.tooShort,
            typeMismatch: native.typeMismatch,
            valueMissing: native.valueMissing,
        };
        return { flags, message: native.valid ? '' : validationControl.validationMessage, anchor: control };
    }
    render() {
        return html `<div class="en-field" part="field" data-invalid=${this.visibleError ? '' : nothing}>
      <label class="en-label" part="label" for="control"><slot name="label">${this.label}</slot></label>
      ${this.renderControlFrame()}
      ${descriptionTemplate(this.description)}
      ${this.visibleError ? html `<div class="en-error" part="error" id="error">${this.visibleError}</div>` : nothing}
    </div>`;
    }
}

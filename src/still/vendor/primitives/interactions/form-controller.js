const validityKeys = ['badInput', 'customError', 'patternMismatch', 'rangeOverflow', 'rangeUnderflow', 'stepMismatch', 'tooLong', 'tooShort', 'typeMismatch', 'valueMissing'];
/** FACE lifecycle adapter. The host attaches internals and forwards browser form callbacks explicitly. */
export class FormController {
    #host;
    #options;
    #fieldsetDisabled = false;
    constructor(host, options) {
        this.#host = host;
        this.#options = options;
        host.addController(this);
    }
    get disabled() { return this.#fieldsetDisabled || (this.#options.disabled?.() ?? false); }
    hostUpdated() { this.sync(); }
    sync() {
        const { internals } = this.#options;
        // Lit's server shim does not implement the browser's submission/validity algorithms.
        if (typeof internals.setFormValue !== 'function')
            return;
        const value = this.disabled ? null : this.#options.value();
        internals.setFormValue(value, this.#options.state ? this.#options.state() : value);
        const control = this.#options.control?.() ?? null;
        if (control)
            control.disabled = this.disabled;
        if (typeof internals.setValidity !== 'function')
            return;
        if (this.disabled) {
            internals.setValidity({});
            return;
        }
        const validation = this.#options.validate?.();
        if (validation) {
            const invalid = Object.values(validation.flags).some(Boolean);
            if (invalid && !validation.message)
                throw new TypeError('Invalid form state requires a localized validation message.');
            internals.setValidity(validation.flags, invalid ? validation.message : '', validation.anchor);
        }
        else if (control) {
            const flags = {};
            for (const key of validityKeys)
                if (control.validity[key])
                    flags[key] = true;
            internals.setValidity(flags, control.validationMessage, control);
        }
        else {
            internals.setValidity({});
        }
    }
    formDisabled(disabled) {
        this.#fieldsetDisabled = disabled;
        this.sync();
        this.#host.requestUpdate();
    }
    formReset() {
        this.#options.onReset();
        this.sync();
        this.#host.requestUpdate();
    }
    formStateRestore(state, mode) {
        this.#options.onRestore?.(state, mode);
        this.sync();
        this.#host.requestUpdate();
    }
}

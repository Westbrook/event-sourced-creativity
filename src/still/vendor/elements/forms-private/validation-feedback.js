/** Application errors invalidate; translated constraint messages only describe existing failures. */
export function applicationValidation(validation, error) {
    return error ? { ...validation, flags: { ...validation.flags, customError: true }, message: error } : validation;
}
/** Shared presentation state for choice controls without a native editing draft. */
export class ValidationFeedback {
    host;
    sync;
    constraintMessage;
    message = '';
    shown = false;
    constructor(host, sync, constraintMessage) {
        this.host = host;
        this.sync = sync;
        this.constraintMessage = constraintMessage;
        host.addEventListener('invalid', event => {
            if (event.target !== host)
                return;
            this.shown = true;
            host.requestUpdate();
        });
    }
    get error() { return this.message; }
    set error(value) {
        const previous = this.message;
        this.message = String(value ?? '');
        this.sync();
        this.host.requestUpdate('error', previous);
    }
    get visible() { return this.message || (this.shown ? this.constraintMessage() : ''); }
    reset() { this.shown = false; this.host.requestUpdate(); }
}

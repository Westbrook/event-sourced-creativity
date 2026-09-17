import { dispatchDraftInput } from './events.js';
/** Native editing bridge. Templates must not independently bind the editable value. */
export class EditingController {
    #host;
    #options;
    #control = null;
    #abort;
    #connected = false;
    #composedValue;
    #initialized = new WeakSet();
    constructor(host, options) {
        this.#host = host;
        this.#options = options;
        host.addController(this);
    }
    hostConnected() { this.#connected = true; }
    hostUpdated() { this.#attach(); this.sync(); }
    hostDisconnected() {
        this.#connected = false;
        this.#finishOrphanedComposition();
        this.#abort?.abort();
        this.#abort = undefined;
        this.#control = null;
    }
    /** Reconcile an explicit accepted-value write without touching active native composition. */
    sync() {
        const control = this.#control;
        if (!control || this.#options.model.isComposing.get())
            return;
        const value = this.#options.model.draft.get();
        if (control.value !== value) {
            this.#composedValue = undefined;
            control.value = value;
        }
    }
    #notify(value, isComposing, inputType) {
        const revision = this.#options.model.view.get().revision;
        const detail = Object.freeze({ value, isComposing, inputType });
        dispatchDraftInput(this.#host, detail);
        this.#options.onInput?.(detail);
        // An observer may author-write or process a nested native edit. Never replay
        // this notification's captured draft over that newer model transaction.
        return this.#options.model.view.get().revision === revision;
    }
    #attach() {
        if (!this.#connected)
            return;
        const control = this.#options.control();
        if (control === this.#control)
            return;
        this.#finishOrphanedComposition();
        this.#abort?.abort();
        this.#control = control;
        if (!control)
            return;
        const Abort = control.ownerDocument.defaultView?.AbortController ?? globalThis.AbortController;
        this.#abort = new Abort();
        const options = { signal: this.#abort.signal };
        const model = this.#options.model;
        control.addEventListener('compositionstart', () => {
            this.#composedValue = undefined;
            model.startComposition();
            model.setDraft(control.value);
            this.#host.requestUpdate();
        }, options);
        control.addEventListener('compositionend', () => {
            const value = control.value;
            const deferred = model.hasDeferredValue.get();
            model.endComposition(value);
            this.#composedValue = value;
            const unchanged = this.#notify(value, false, 'insertCompositionText');
            if (unchanged && !deferred && value !== model.value.get())
                this.#options.onCommit?.(value, 'compositionend');
            this.sync();
            this.#host.requestUpdate();
        }, options);
        control.addEventListener('input', (event) => {
            const input = event;
            if (input.isComposing && !model.isComposing.get())
                model.startComposition();
            const value = control.value;
            model.setDraft(value);
            const composing = model.isComposing.get();
            const unchanged = this.#notify(value, composing, input.inputType ?? '');
            const duplicateCompositionCommit = !composing && value === this.#composedValue;
            if (!composing)
                this.#composedValue = undefined;
            if (unchanged && !composing && !duplicateCompositionCommit && value !== model.value.get())
                this.#options.onCommit?.(value, 'input');
            this.sync();
            this.#host.requestUpdate();
        }, options);
        control.addEventListener('change', () => {
            if (model.isComposing.get())
                return;
            model.setDraft(control.value);
            if (control.value !== model.value.get())
                this.#options.onCommit?.(control.value, 'change');
            this.sync();
            this.#host.requestUpdate();
        }, options);
        if (!this.#initialized.has(control)) {
            this.#initialized.add(control);
            const adopt = this.#options.adoptInitialValue?.(control) ?? control.value !== control.defaultValue;
            if (adopt && control.value !== model.draft.get()) {
                const value = control.value;
                model.setDraft(value);
                if (this.#notify(value, false, 'hydrate') && value !== model.value.get())
                    this.#options.onCommit?.(value, 'hydrate');
            }
        }
    }
    #finishOrphanedComposition() {
        if (this.#options.model.isComposing.get()) {
            // A removed native editing surface may never dispatch compositionend.
            // Retain its draft, but do not infer acceptance or synthesize a user action.
            this.#options.model.endComposition(this.#control?.value);
        }
        this.#composedValue = undefined;
    }
}

import { observeIdReference, referenceRoot } from '../internal/id-reference.js';
/** External same-tree reference and owned ARIA restoration; no cross-root IDREF is invented. */
export class ModalTriggerController {
    host;
    options;
    #root = null;
    #id = '';
    #release;
    #trigger = null;
    #original = {};
    #written = {};
    constructor(host, options) {
        this.host = host;
        this.options = options;
        host.addController(this);
    }
    hostConnected() { this.hostUpdated(); }
    hostUpdated() {
        if (!this.host.isConnected)
            return;
        const root = referenceRoot(this.host);
        const id = typeof this.options.id() === 'string' ? this.options.id() : '';
        if (!this.#release || root !== this.#root || id !== this.#id) {
            this.#release?.();
            this.#release = undefined;
            this.#root = root;
            this.#id = id;
            this.#release = observeIdReference(root, id, this.accept);
        }
        this.sync();
    }
    hostDisconnected() { this.#release?.(); this.#release = undefined; this.#root = null; this.#id = ''; this.detach(); }
    accept = (element) => {
        const trigger = this.host.isConnected && element?.namespaceURI === 'http://www.w3.org/1999/xhtml'
            && (element.localName === 'button' || element.localName === 'en-button') ? element : null;
        if (trigger === this.#trigger)
            return;
        this.detach();
        this.#trigger = trigger;
        if (!trigger)
            return;
        this.#original = Object.fromEntries(['aria-haspopup', 'aria-expanded'].map(name => [name, trigger.getAttribute(name)]));
        trigger.addEventListener('click', this.click);
        this.sync();
    };
    click = (event) => {
        const trigger = this.#trigger;
        const valid = () => Boolean(this.host.isConnected && trigger?.isConnected
            && trigger === this.#trigger && this.options.id() === this.#id
            && referenceRoot(this.host) === this.#root && this.#root?.getElementById(this.#id) === trigger
            && !trigger.disabled && !trigger.loading && !trigger.matches(':disabled,[aria-disabled="true"]'));
        if (event.defaultPrevented || !trigger || !valid())
            return;
        // A valid associated button is an opener, including inside a form.
        // Cancel en-change to intercept the modal default independently of click listener order.
        event.preventDefault();
        this.options.activate(trigger, valid);
    };
    sync() {
        if (!this.#trigger)
            return;
        for (const [name, value] of Object.entries({ 'aria-haspopup': 'dialog', 'aria-expanded': String(this.options.open()) })) {
            if (this.#trigger.getAttribute(name) !== value)
                this.#trigger.setAttribute(name, value);
            this.#written[name] = value;
        }
    }
    detach() {
        const trigger = this.#trigger;
        if (trigger) {
            trigger.removeEventListener('click', this.click);
            for (const [name, value] of Object.entries(this.#original)) {
                if (trigger.getAttribute(name) !== this.#written[name])
                    continue;
                if (value === null)
                    trigger.removeAttribute(name);
                else
                    trigger.setAttribute(name, value);
            }
        }
        this.#trigger = null;
        this.#original = {};
        this.#written = {};
    }
}

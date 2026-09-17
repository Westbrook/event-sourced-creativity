/** Menu-only typeahead and Tab exit; arrows remain the shared roving controller. */
export class MenuInteractionController {
    host;
    options;
    abort;
    search = '';
    lastKey = 0;
    constructor(host, options) {
        this.host = host;
        this.options = options;
        host.addController(this);
    }
    hostConnected() {
        const Abort = this.host.ownerDocument.defaultView?.AbortController ?? globalThis.AbortController;
        this.abort = new Abort();
        this.host.addEventListener('keydown', this.keyDown, { signal: this.abort.signal });
    }
    hostDisconnected() { this.abort?.abort(); this.abort = undefined; this.search = ''; this.lastKey = 0; }
    keyDown = (event) => {
        if (event.defaultPrevented || event.isComposing || !this.options.open())
            return;
        if (event.composedPath().find(node => node.localName === 'en-menu') !== this.host)
            return;
        if (event.key === 'Tab') {
            this.options.closeForTab(event);
            return;
        }
        if (event.altKey || event.ctrlKey || event.metaKey)
            return;
        if (!this.options.presented() || event.key.length !== 1 || event.key === ' ')
            return;
        const items = this.options.items();
        const current = items.find(item => event.composedPath().includes(item));
        if (!current || !items.length)
            return;
        const key = event.key.toLocaleLowerCase();
        this.search = event.timeStamp - this.lastKey > 700 ? key : this.search + key;
        this.lastKey = event.timeStamp;
        const needle = [...this.search].every(char => char === key) ? key : this.search;
        const start = items.indexOf(current);
        const ordered = [...items.slice(start + 1), ...items.slice(0, start + 1)];
        const next = ordered.find(item => {
            // Decorative named slots and shortcut text do not change the typed label.
            const label = [...item.childNodes].filter(node => node.nodeType !== 1 || !node.hasAttribute('slot')).map(node => node.textContent ?? '').join('').trim().toLocaleLowerCase();
            return label.startsWith(needle);
        });
        if (next) {
            event.preventDefault();
            this.options.focus(next);
        }
    };
}

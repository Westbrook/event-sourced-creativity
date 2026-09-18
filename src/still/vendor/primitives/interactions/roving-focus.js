/** Roving tabindex and navigation only; selection and activation remain separate actions. */
export class RovingFocusController {
    #host;
    #options;
    #original = new Map();
    #leases = new Map();
    #current = null;
    #abort;
    #connected = false;
    #lastItems = [];
    #focusOwner;
    constructor(host, options) {
        this.#host = host;
        this.#options = options;
        host.addController(this);
    }
    get current() { return this.#current; }
    hostConnected() {
        this.#connected = true;
        this.#abort?.abort();
        const Abort = this.#host.ownerDocument.defaultView?.AbortController ?? globalThis.AbortController;
        this.#abort = new Abort();
        this.#host.addEventListener('keydown', this.#keydown, { signal: this.#abort.signal, capture: this.#options.keydownCapture });
        this.#host.addEventListener('focusin', this.#focusin, { signal: this.#abort.signal });
        if (this.#options.recoverFocus)
            this.#host.addEventListener('focusout', this.#focusout, { signal: this.#abort.signal });
        this.refresh();
    }
    hostUpdated() { if (this.#connected)
        this.refresh(); }
    hostDisconnected() {
        this.#connected = false;
        this.#focusOwner = undefined;
        this.#lastItems = [];
        this.#abort?.abort();
        this.#abort = undefined;
        for (const [item, value] of this.#original)
            this.#restore(item, value);
        this.#original.clear();
        for (const lease of this.#leases.values())
            lease.release();
        this.#leases.clear();
    }
    refresh() {
        const items = this.#options.items();
        const present = new Set(items);
        for (const [item, lease] of this.#leases) {
            if (!present.has(item)) {
                lease.release();
                this.#leases.delete(item);
            }
        }
        for (const [item, value] of this.#original) {
            if (!present.has(item)) {
                this.#restore(item, value);
                this.#original.delete(item);
            }
        }
        const eligible = this.#eligible(items);
        if (this.#options.recoverFocus) {
            const focused = eligible.find(item => item.matches(':focus-within'));
            if (focused) {
                this.#current = focused;
                this.#focusOwner = { item: focused, root: this.#host.getRootNode() };
            }
        }
        const owner = this.#focusOwner;
        const displaced = owner && !eligible.includes(owner.item);
        const recover = displaced && this.#canRecover(owner)
            ? this.#adjacent(eligible, owner.item) : null;
        if (recover)
            this.#current = recover;
        else if (!this.#current || !eligible.includes(this.#current))
            this.#current = this.#adjacent(eligible, this.#current);
        this.#lastItems = [...items];
        for (const item of items) {
            const tabIndex = item === this.#current ? 0 : -1;
            if (this.#options.claimTabStop) {
                let lease = this.#leases.get(item);
                if (!lease)
                    this.#leases.set(item, lease = this.#options.claimTabStop(item));
                lease.set(tabIndex);
            }
            else {
                if (!this.#original.has(item))
                    this.#original.set(item, item.getAttribute('tabindex'));
                item.tabIndex = tabIndex;
            }
        }
        if (displaced)
            this.#focusOwner = undefined;
        // Set every tab stop first. Native focus then produces the ordinary focusin
        // event; a reentrant author focus change before this point takes precedence.
        if (recover && owner && this.#canRecover(owner))
            recover.focus();
        else if (displaced && !eligible.length && owner && this.#canRecover(owner))
            this.#options.focusEmpty?.();
    }
    #adjacent(eligible, previous) {
        if (this.#options.recoverFocus && previous) {
            const index = this.#lastItems.indexOf(previous);
            if (index !== -1) {
                for (const item of this.#lastItems.slice(index + 1))
                    if (eligible.includes(item))
                        return item;
                for (const item of this.#lastItems.slice(0, index).reverse())
                    if (eligible.includes(item))
                        return item;
            }
        }
        return eligible[0] ?? null;
    }
    #canRecover(owner) {
        const document = this.#host.ownerDocument;
        if (!this.#options.recoverFocus || !this.#connected || !this.#host.isConnected
            || this.#host.getRootNode() !== owner.root || !document.hasFocus())
            return false;
        const active = owner.root.activeElement;
        // The native target may still be active during disable/hide fixup. Otherwise
        // only the browser's default focus location is recoverable, never a sibling.
        if (active === owner.item)
            return true;
        const defaultFocus = (root, element) => element === null || (root === document && (element === document.body || element === document.documentElement));
        if (!defaultFocus(owner.root, active))
            return false;
        // A shadow root's null activeElement can also mean focus moved outside that
        // tree. Inspect only our ancestry so another field/iframe is never mistaken
        // for the browser's body fallback.
        let root = owner.root;
        while (root !== document) {
            const container = root;
            const outer = container.host.getRootNode();
            if (outer.activeElement !== container.host && !defaultFocus(outer, outer.activeElement))
                return false;
            root = outer;
        }
        return true;
    }
    setCurrent(item, { focus = false } = {}) {
        if (!this.#eligible(this.#options.items()).includes(item))
            return false;
        this.#current = item;
        this.refresh();
        if (focus)
            item.focus();
        return true;
    }
    #eligible(items) {
        return items.filter((item) => !(this.#options.isDisabled?.(item) ?? item.matches('[disabled], [aria-disabled="true"], [hidden], [inert]')));
    }
    #restore(item, value) {
        if (value === null)
            item.removeAttribute('tabindex');
        else
            item.setAttribute('tabindex', value);
    }
    #focusin = (event) => {
        const items = this.#eligible(this.#options.items());
        const item = event.composedPath().find((node) => items.includes(node));
        if (this.#options.recoverFocus)
            this.#focusOwner = item
                ? { item, root: this.#host.getRootNode() } : undefined;
        if (item) {
            this.setCurrent(item);
            this.#options.onFocus?.(item);
        }
    };
    #focusout = (event) => {
        const owner = this.#focusOwner;
        if (!owner || !event.composedPath().includes(owner.item))
            return;
        // An explicit destination owns focus, including a body made focusable by
        // the application. A following in-toolbar focusin records a fresh owner.
        if (event.relatedTarget) {
            this.#focusOwner = undefined;
            return;
        }
        queueMicrotask(() => {
            if (this.#focusOwner !== owner)
                return;
            // Retain ownership only for mutation-caused loss. A normal blur of a still
            // eligible control must not authorize recovery on an unrelated later edit.
            if (this.#eligible(this.#options.items()).includes(owner.item))
                this.#focusOwner = undefined;
        });
    };
    #keydown = (event) => {
        if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey)
            return;
        const path = event.composedPath();
        const source = path[0];
        if (source?.matches?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])'))
            return;
        const items = this.#eligible(this.#options.items());
        const item = path.find((node) => items.includes(node));
        if (!item || !items.length)
            return;
        const orientation = this.#options.orientation ?? 'horizontal';
        const direction = this.#options.direction?.() ?? this.#host.ownerDocument.defaultView?.getComputedStyle(this.#host).direction ?? 'ltr';
        let delta = 0;
        let index = items.indexOf(item);
        if (event.key === 'Home')
            index = 0;
        else if (event.key === 'End')
            index = items.length - 1;
        else {
            if (orientation !== 'vertical' && event.key === 'ArrowRight')
                delta = direction === 'rtl' ? -1 : 1;
            if (orientation !== 'vertical' && event.key === 'ArrowLeft')
                delta = direction === 'rtl' ? 1 : -1;
            if (orientation !== 'horizontal' && event.key === 'ArrowDown')
                delta = 1;
            if (orientation !== 'horizontal' && event.key === 'ArrowUp')
                delta = -1;
            if (!delta)
                return;
            index = this.#options.wrap === false ? Math.max(0, Math.min(items.length - 1, index + delta)) : (index + delta + items.length) % items.length;
        }
        event.preventDefault();
        this.setCurrent(items[index], { focus: true });
    };
}

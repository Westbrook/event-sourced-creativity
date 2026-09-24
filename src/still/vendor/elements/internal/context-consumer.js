import { ContextEvent, ContextRoot } from '@lit/context';
const roots = new WeakMap();
/** Install replay before requesting, including consumers inside shadow roots. */
function retainRoot(document) {
    let entry = roots.get(document);
    if (!entry) {
        entry = { root: new ContextRoot(), users: 0 };
        entry.root.attach(document);
        roots.set(document, entry);
    }
    entry.users++;
    return () => {
        if (--entry.users === 0) {
            entry.root.detach(document);
            roots.delete(document);
        }
    };
}
/** A subscription belongs to one connection; late callbacks cannot revive it. */
export class ScopedContext {
    host;
    context;
    changed;
    value;
    generation = 0;
    unsubscribe;
    releaseRoot;
    callback;
    constructor(host, context, changed) {
        this.host = host;
        this.context = context;
        this.changed = changed;
        host.addController(this);
    }
    hostConnected() {
        const generation = ++this.generation;
        this.releaseRoot = retainRoot(this.host.ownerDocument);
        this.callback = (value, unsubscribe) => {
            if (!this.host.isConnected || generation !== this.generation) {
                unsubscribe?.();
                return;
            }
            if (this.unsubscribe !== unsubscribe)
                this.unsubscribe?.();
            this.unsubscribe = unsubscribe;
            this.value = value;
            this.changed?.(value);
            this.host.requestUpdate();
        };
        this.host.dispatchEvent(new ContextEvent(this.context, this.host, this.callback, true));
    }
    hostDisconnected() {
        ++this.generation;
        this.callback = undefined;
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        this.releaseRoot?.();
        this.releaseRoot = undefined;
        this.value = undefined;
        this.changed?.(undefined);
        this.host.requestUpdate();
    }
}

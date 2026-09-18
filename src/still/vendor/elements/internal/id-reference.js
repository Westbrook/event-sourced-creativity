export function referenceRoot(node) {
    const root = node.getRootNode();
    return (root.nodeType === 9 || (root.nodeType === 11 && 'host' in root))
        && 'getElementById' in root ? root : null;
}
const roots = new WeakMap();
/** One observer per subscribed tree; mutations use indexed ID lookups, never tree scans. */
class RootReferences {
    root;
    subscribers = new Map();
    resolved = new Map();
    observer;
    constructor(root) {
        this.root = root;
        const document = root.nodeType === 9 ? root : root.ownerDocument;
        const Observer = document?.defaultView?.MutationObserver;
        this.observer = Observer ? new Observer(records => {
            const changed = new Set();
            for (const record of records) {
                if (record.type === 'childList') {
                    if (![...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1))
                        continue;
                    // Insertion, removal, or reordering may change which duplicate ID wins.
                    for (const id of this.subscribers.keys())
                        changed.add(id);
                    break;
                }
                if (record.oldValue)
                    changed.add(record.oldValue);
                const id = record.target.id;
                if (id)
                    changed.add(id);
            }
            for (const id of changed)
                this.notify(id);
        }) : undefined;
        this.observer?.observe(root, {
            childList: true, subtree: true, attributes: true, attributeFilter: ['id'], attributeOldValue: true,
        });
    }
    notify(id) {
        const subscribers = this.subscribers.get(id);
        if (!subscribers)
            return;
        const element = this.root.getElementById(id);
        if (this.resolved.has(id) && this.resolved.get(id) === element)
            return;
        this.resolved.set(id, element);
        for (const subscriber of [...subscribers]) {
            if (this.subscribers.get(id) === subscribers && subscribers.has(subscriber))
                subscriber(element);
        }
    }
    subscribe(id, subscriber) {
        let subscribers = this.subscribers.get(id);
        if (!subscribers)
            this.subscribers.set(id, subscribers = new Set());
        subscribers.add(subscriber);
        const current = this.root.getElementById(id);
        if (!this.resolved.has(id) || this.resolved.get(id) !== current) {
            // Reconcile existing subscribers too if the DOM changed before its observer batch.
            this.resolved.set(id, current);
            for (const candidate of [...subscribers]) {
                if (this.subscribers.get(id) === subscribers && subscribers.has(candidate))
                    candidate(current);
            }
        }
        else
            subscriber(current);
        let disposed = false;
        return () => {
            if (disposed)
                return;
            disposed = true;
            subscribers.delete(subscriber);
            if (!subscribers.size && this.subscribers.get(id) === subscribers) {
                this.subscribers.delete(id);
                this.resolved.delete(id);
            }
            if (!this.subscribers.size) {
                this.observer?.disconnect();
                if (roots.get(this.root) === this)
                    roots.delete(this.root);
            }
        };
    }
}
/** Observe one literal ID. Empty IDs and detached fragments remain unresolved. */
export function observeIdReference(root, id, subscriber) {
    if (!root || !id) {
        subscriber(null);
        return () => { };
    }
    const document = root.nodeType === 9 ? root : root.ownerDocument;
    if (!document?.defaultView?.MutationObserver) {
        subscriber(root.getElementById(id));
        return () => { };
    }
    let references = roots.get(root);
    if (!references)
        roots.set(root, references = new RootReferences(root));
    return references.subscribe(id, subscriber);
}

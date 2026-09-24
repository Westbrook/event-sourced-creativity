const adapters = new WeakMap();
/** Register on the actual slotted editor host. Dispose on teardown. Latest registration wins. */
export function registerChatEditor(editor, adapter) {
    adapters.set(editor, adapter);
    return () => { if (adapters.get(editor) === adapter)
        adapters.delete(editor); };
}
/** Resolve only explicitly registered editors. Ordinary value-bearing elements are not editors. */
export function getChatEditorAdapter(editor) {
    return adapters.get(editor);
}
/** Copy and deeply freeze structured data; reject live objects, cycles and lossy JSON values. */
export function snapshotChatEditor(snapshot) {
    if (typeof snapshot.value !== 'string')
        throw new TypeError('An editor snapshot requires a string value.');
    return Object.freeze(snapshot.content === undefined ? { value: snapshot.value } : { value: snapshot.value, content: snapshotEditorData(snapshot.content) });
}
/** Detach and deeply freeze JSON-bearing editor action data. Reject cycles, accessors and non-JSON values. */
export function snapshotEditorData(data) {
    const ancestors = new Set();
    const copy = (value) => {
        if (value === null || typeof value === 'string' || typeof value === 'boolean')
            return value;
        if (typeof value === 'number' && Number.isFinite(value))
            return value;
        if (typeof value !== 'object' || ancestors.has(value))
            throw new TypeError('Editor content must be acyclic JSON-compatible data.');
        ancestors.add(value);
        try {
            if (Array.isArray(value))
                return Object.freeze(Array.from(value, item => copy(item)));
            const prototype = Object.getPrototypeOf(value);
            if (prototype !== Object.prototype && prototype !== null)
                throw new TypeError('Editor content must contain plain records.');
            const result = {};
            for (const key of Reflect.ownKeys(value)) {
                if (typeof key !== 'string')
                    throw new TypeError('Editor content cannot contain symbol keys.');
                const descriptor = Object.getOwnPropertyDescriptor(value, key);
                if (!descriptor.enumerable || !('value' in descriptor))
                    throw new TypeError('Editor content must contain enumerable data properties.');
                Object.defineProperty(result, key, { value: copy(descriptor.value), enumerable: true });
            }
            return Object.freeze(result);
        }
        finally {
            ancestors.delete(value);
        }
    };
    return copy(data);
}

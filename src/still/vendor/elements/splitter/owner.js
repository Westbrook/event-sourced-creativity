const owners = new WeakMap();
/** @internal No property or event is added to the public splitter host. */
export function setSplitterOwner(splitter, owner) {
    if (owner)
        owners.set(splitter, owner);
    else
        owners.delete(splitter);
}
/** @internal Resolve ownership before a standalone splitter stages a transaction. */
export function getSplitterOwner(splitter) {
    return owners.get(splitter);
}

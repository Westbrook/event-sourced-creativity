/** Component identities are opaque, unique nonblank strings. Never trim the stored key. */
export function isCollectionKey(key) {
    return typeof key === 'string' && key.trim().length > 0;
}
/** Resolve the canonical extractor first; retain key as a compatibility option. */
export function collectionGetKey(options) {
    const getKey = options.getKey !== undefined ? options.getKey : options.key;
    if (typeof getKey !== 'function')
        throw new TypeError('Collections require a getKey function (legacy alias: key).');
    return getKey;
}

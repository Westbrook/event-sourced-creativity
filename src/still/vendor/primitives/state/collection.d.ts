/** Shared delivery vocabulary; components expose only modes they implement. */
export type CollectionMode = 'all' | 'paginated' | 'virtual';
/** Component identities are opaque, unique nonblank strings. Never trim the stored key. */
export declare function isCollectionKey(key: unknown): key is string;
/** Resolve the canonical extractor first; retain key as a compatibility option. */
export declare function collectionGetKey<T>(options: {
    getKey?: (item: T) => string;
    key?: (item: T) => string;
}): (item: T) => string;

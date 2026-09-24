/** Resolve a flat message group without mutating caller data. Empty strings are intentional. */
export function resolveMessages(defaults, overrides) {
    return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, overrides?.[key] ?? fallback]));
}

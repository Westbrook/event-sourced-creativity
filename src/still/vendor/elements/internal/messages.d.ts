/** Resolve a flat message group without mutating caller data. Empty strings are intentional. */
export declare function resolveMessages<T extends Record<string, string>>(defaults: T, overrides?: Partial<T> | null): T;

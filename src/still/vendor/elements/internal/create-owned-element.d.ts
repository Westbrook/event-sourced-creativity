/** Synchronous factory for a required, already registered dependency in the owner's scope. */
export declare function createOwnedElement<K extends keyof HTMLElementTagNameMap>(owner: Element, tag: K): HTMLElementTagNameMap[K];

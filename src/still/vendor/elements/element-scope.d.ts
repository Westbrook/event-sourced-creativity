import { type ElementDefinition } from '../primitives/interactions/registration.js';
/** Qualified creation path, cached per browser realm. No browser globals are read at import time. */
export interface ElementScopeCapabilities {
    readonly native: boolean;
    readonly importMode: 'options' | 'document' | 'global';
    readonly dormant: boolean;
}
/** Probe behavior, including ignored dictionary members, without registering global test tags. */
export declare function elementScopeCapabilities(document: Document): ElementScopeCapabilities;
/** @internal Lit's Document-shaped import bridge; never patches the owning document. */
export declare function registryCreationScope(document: Document, registry: CustomElementRegistry | null): Document;
export interface ElementScopeOptions {
    /** The browser document that owns the new tree; required for SSR-safe imports and multiple realms. */
    readonly document: Document;
    /** Auto prefers a fresh native registry; global explicitly retains global consumption. */
    readonly registry?: 'auto' | 'global' | CustomElementRegistry;
}
export interface ElementScope {
    readonly document: Document;
    readonly registry: CustomElementRegistry;
    readonly mode: 'scoped' | 'global';
    /** Pass as Lit render's creationScope option; does not change the render container's association. */
    readonly creationScope: Document;
    register(definitions: readonly ElementDefinition[]): void;
    createElement<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K];
    createElement(tag: string): HTMLElement;
    attachShadow(host: Element, options?: ShadowRootInit): ShadowRoot;
    /** Associates only null nodes, never rebinds global nodes or enters nested shadow roots. */
    initialize(root: Element | ShadowRoot): void;
    get(tag: string): CustomElementConstructor | undefined;
    whenDefined(tag: string): Promise<CustomElementConstructor>;
    upgrade(root: Node): void;
}
/** Own an eagerly registered ordinary subtree or shadow tree. Importing this module defines no elements. */
export declare function createElementScope({ document, registry: requested }: ElementScopeOptions): ElementScope;

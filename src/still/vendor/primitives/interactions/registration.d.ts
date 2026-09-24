export interface ElementDefinition {
    readonly tagName: string;
    readonly elementClass: CustomElementConstructor;
    readonly dependencies?: readonly ElementDefinition[];
}
export type ElementRegistry = Pick<CustomElementRegistry, 'get' | 'define'>;
/** Resolve the dependency closure without registering anything or reading a global registry. */
export declare function collectDefinitions(definitions: readonly ElementDefinition[]): readonly ElementDefinition[];
/** Preflight identity conflicts, then define dependency-first. Browser validation errors are not rolled back. */
export declare function registerDefinitions(registry: ElementRegistry, definitions: readonly ElementDefinition[]): void;
export declare function registerDefinition(registry: ElementRegistry, definition: ElementDefinition): void;

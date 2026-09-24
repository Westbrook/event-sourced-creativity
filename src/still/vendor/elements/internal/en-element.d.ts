import { LitElement, type PropertyValues, type PropertyDeclarations } from 'lit';
/** The requested size scope; `inherit` uses the nearest containing size scope. */
export type ElementSize = 'inherit' | 'small' | 'medium' | 'large';
export interface ElementEventListener<Host, Events> {
    <K extends keyof Events>(type: K, listener: ((this: Host, event: Events[K]) => void) | {
        handleEvent(event: Events[K]): void;
    } | null, options?: boolean | AddEventListenerOptions): void;
    <K extends keyof HTMLElementEventMap>(type: K, listener: ((this: Host, event: HTMLElementEventMap[K]) => void) | {
        handleEvent(event: HTMLElementEventMap[K]): void;
    } | null, options?: boolean | AddEventListenerOptions): void;
    (type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void;
}
export interface ElementEventRemover<Host, Events> {
    <K extends keyof Events>(type: K, listener: ((this: Host, event: Events[K]) => void) | {
        handleEvent(event: Events[K]): void;
    } | null, options?: boolean | EventListenerOptions): void;
    <K extends keyof HTMLElementEventMap>(type: K, listener: ((this: Host, event: HTMLElementEventMap[K]) => void) | {
        handleEvent(event: HTMLElementEventMap[K]): void;
    } | null, options?: boolean | EventListenerOptions): void;
    (type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void;
}
/**
 * Shared reactive base for En Rêve custom elements.
 *
 * Concrete size modes establish an absolute size scope through foundation styles.
 * Inherited size is resolved by CSS, so the getter reports the requested mode,
 * not a measured or computed size. This class performs no element registration.
 */
export declare class EnElement<Events extends {
    [K in keyof Events]: Event;
} = {}> extends LitElement {
    #private;
    /** @internal Type-only specialization of the native listener method. */
    addEventListener: ElementEventListener<this, Events>;
    /** @internal Type-only specialization of the native listener method. */
    removeEventListener: ElementEventRemover<this, Events>;
    /** Override only to request an explicit render registry. Register its dependencies first. */
    protected getRenderRegistry(): CustomElementRegistry | null | undefined;
    attachShadow(options: ShadowRootInit): ShadowRoot;
    protected createRenderRoot(): HTMLElement | DocumentFragment;
    protected update(changed: PropertyValues): void;
    connectedCallback(): void;
    disconnectedCallback(): void;
    adoptedCallback(): void;
    private readonly staticStyles;
    static properties: PropertyDeclarations;
    /**
     * Requested size scope: inherit, small, medium, or large.
     * Defaults to medium without adding an attribute. Explicit property writes
     * reflect; removing the attribute or supplying an invalid value restores
     * medium. Inheritance is an explicit opt-in. Its effective size is resolved
     * by CSS and is deliberately not returned by this property.
     * @default "medium"
     */
    get size(): ElementSize;
    set size(value: ElementSize);
}

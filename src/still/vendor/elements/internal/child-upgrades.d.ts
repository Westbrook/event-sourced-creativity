import type { ReactiveController, ReactiveControllerHost } from 'lit';
/** Internal notification from the explicit initialization boundary, not a readiness event. */
export declare const registryInitialized = "en-internal-registry-initialized";
type Host = HTMLElement & ReactiveControllerHost;
/** Watches actual child registries. No polling, global fallback or retained removed children. */
export declare class ChildUpgrades implements ReactiveController {
    private host;
    private changed;
    private subscriptions;
    private epoch;
    private documents;
    private queued;
    private attempted;
    constructor(host: Host, changed: () => void);
    watch(elements: Iterable<Element>): void;
    private initialized;
    /** @internal Recollect current children after constructors and their first reactive updates. */
    definitionReady(epoch: number): void;
    hostConnected(): void;
    hostDisconnected(): void;
}
export {};

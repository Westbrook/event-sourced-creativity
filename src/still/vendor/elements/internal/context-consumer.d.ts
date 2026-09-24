import { type Context } from '@lit/context';
import type { ReactiveController, ReactiveControllerHost } from 'lit';
type Host = HTMLElement & ReactiveControllerHost;
/** A subscription belongs to one connection; late callbacks cannot revive it. */
export declare class ScopedContext<T> implements ReactiveController {
    private host;
    private context;
    private changed?;
    value: T | undefined;
    private generation;
    private unsubscribe?;
    private releaseRoot?;
    private callback?;
    constructor(host: Host, context: Context<unknown, T>, changed?: ((value: T | undefined) => void) | undefined);
    hostConnected(): void;
    hostDisconnected(): void;
}
export {};

import { ContextProvider as LitContextProvider, type Context, type ContextType } from '@lit/context';
import type { ReactiveControllerHost } from 'lit';
/** Lit 1.1.x uses stopPropagation; the current protocol requires immediate stop. */
export declare class ContextProvider<C extends Context<unknown, unknown>> extends LitContextProvider<C> {
    private installed;
    constructor(host: HTMLElement & Partial<ReactiveControllerHost>, options: {
        context: C;
        initialValue?: ContextType<C>;
    });
    /** A connected host may invoke this during super(); announce only after wrapping. */
    hostConnected(): void;
}

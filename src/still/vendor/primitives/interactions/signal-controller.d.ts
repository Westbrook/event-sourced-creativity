import type { ReactiveController, ReactiveControllerHost } from 'lit';
/** Watches a pure snapshot only while its host is connected. Reading a snapshot never requires this controller. */
export declare class SignalController<T> implements ReactiveController {
    #private;
    constructor(host: ReactiveControllerHost, readSnapshot: () => T);
    get snapshot(): T;
    hostConnected(): void;
    hostDisconnected(): void;
    /** Permanently detach this controller. Ordinary DOM removal should use hostDisconnected. */
    dispose(): void;
}

import type { ReactiveController, ReactiveControllerHost } from 'lit';
interface TriggerOptions {
    id(): string;
    open(): boolean;
    activate(trigger: HTMLElement, valid: () => boolean): void;
}
/** External same-tree reference and owned ARIA restoration; no cross-root IDREF is invented. */
export declare class ModalTriggerController implements ReactiveController {
    #private;
    private readonly host;
    private readonly options;
    constructor(host: ReactiveControllerHost & HTMLElement, options: TriggerOptions);
    hostConnected(): void;
    hostUpdated(): void;
    hostDisconnected(): void;
    private readonly accept;
    private readonly click;
    private sync;
    private detach;
}
export {};

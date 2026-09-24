import type { ReactiveController, ReactiveControllerHost } from 'lit';
interface MenuInteractionOptions {
    open(): boolean;
    presented(): boolean;
    items(): readonly HTMLElement[];
    focus(item: HTMLElement): void;
    closeForTab(event: KeyboardEvent): void;
}
/** Menu-only typeahead and Tab exit; arrows remain the shared roving controller. */
export declare class MenuInteractionController implements ReactiveController {
    private readonly host;
    private readonly options;
    private abort?;
    private search;
    private lastKey;
    constructor(host: HTMLElement & ReactiveControllerHost, options: MenuInteractionOptions);
    hostConnected(): void;
    hostDisconnected(): void;
    private keyDown;
}
export {};

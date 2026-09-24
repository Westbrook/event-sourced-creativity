import type { ReactiveController, ReactiveControllerHost } from 'lit';
export interface RovingFocusOptions {
    /** Return visible items. Disabled/aria-disabled/hidden/inert items are excluded unless isDisabled is provided. */
    items: () => readonly HTMLElement[];
    orientation?: 'horizontal' | 'vertical' | 'both';
    direction?: () => 'ltr' | 'rtl';
    wrap?: boolean;
    isDisabled?: (item: HTMLElement) => boolean;
    onFocus?: (item: HTMLElement) => void;
    /** Recover adjacent focus only when an owned focused item becomes ineligible or leaves. */
    recoverFocus?: boolean;
    /** Recoverable focus loss with no remaining item, e.g. focus an empty menu surface. */
    focusEmpty?: () => void;
    /** Optional encapsulated tab-stop ownership for controls with private native focus targets. */
    claimTabStop?: (item: HTMLElement) => {
        set(value: 0 | -1): void;
        release(): void;
    };
    /** A composite can claim its own axis before a popup trigger handles arrows. */
    keydownCapture?: boolean;
}
/** Roving tabindex and navigation only; selection and activation remain separate actions. */
export declare class RovingFocusController implements ReactiveController {
    #private;
    constructor(host: HTMLElement & ReactiveControllerHost, options: RovingFocusOptions);
    get current(): HTMLElement | null;
    hostConnected(): void;
    hostUpdated(): void;
    hostDisconnected(): void;
    refresh(): void;
    setCurrent(item: HTMLElement, { focus }?: {
        focus?: boolean;
    }): boolean;
}

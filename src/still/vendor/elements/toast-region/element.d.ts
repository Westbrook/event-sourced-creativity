import { type PropertyValues } from 'lit';
import { EnElement } from '../internal/en-element.js';
import type { EnToast } from '../toast.js';
export interface ToastOptions {
    message: string;
    variant?: EnToast['variant'];
    duration?: number;
    priority?: EnToast['priority'];
    dismissLabel?: string;
    interrupt?: boolean;
    swipe?: boolean;
}
export interface ToastHistoryEntry {
    readonly message: string;
    readonly variant: EnToast['variant'];
}
/**
 * A slotted notification collection. Initial messages are readable; newly opened messages announce without moving focus.
 * @tagname en-toast-region
 * @slot - en-toast children; forwarding through slots is supported.
 * @csspart base - Named, focusable collection and scroll surface.
 * @csspart stack-summary - Localized description of waiting messages.
 * @csspart history - Optional waiting/recent disclosure.
 * @csspart history-summary - Named disclosure toggle.
 * @csspart history-list - Plain-text waiting and recent lists.
 * @csspart announcements - Persistent polite announcer.
 * @csspart urgent - Persistent assertive announcer.
 * @cssprop --en-toast-region-layer - Stacking level for fixed placement.
 * @cssprop --en-toast-region-gap - Gap between messages.
 * @cssprop --en-toast-region-width - Width of a fixed region.
 * @cssprop --en-toast-region-max-size - Maximum block size before scrolling.
 */
export declare class EnToastRegion extends EnElement {
    static properties: {
        label: {};
        placement: {
            reflect: boolean;
        };
        max: {
            type: NumberConstructor;
            reflect: boolean;
            noAccessor: boolean;
        };
        stackLabel: {
            attribute: string;
        };
        history: {
            type: BooleanConstructor;
        };
        historyLimit: {
            type: NumberConstructor;
            attribute: string;
        };
        historyLabel: {
            attribute: string;
        };
        waitingLabel: {
            attribute: string;
        };
        recentLabel: {
            attribute: string;
        };
        clearHistoryLabel: {
            attribute: string;
        };
    };
    static styles: import("lit").CSSResult[];
    /** Accessible region name, localized by the consumer. */
    label: string;
    /** Inline by default; fixed positions use logical edges and safe areas. */
    placement: 'inline' | 'block-start' | 'block-end' | 'block-start-start' | 'block-start-center' | 'block-start-end' | 'block-end-start' | 'block-end-center' | 'block-end-end';
    /** Opt-in plain-text waiting and recently closed notification history. */
    history: boolean;
    /** Retain at most this many recent snapshots in memory (default 20, maximum 1000); zero disables retention. */
    historyLimit: number;
    historyLabel: string;
    waitingLabel: string;
    recentLabel: string;
    clearHistoryLabel: string;
    private recent;
    private historyOpen;
    private waitingMessages;
    /** Immutable snapshots, newest dismissal first. Authored message elements remain application-owned. */
    get historyItems(): readonly ToastHistoryEntry[];
    /** Clear retained snapshots without dismissing active/waiting messages or replaying announcements. */
    clearHistory(): void;
    private get retention();
    private limit;
    /** Maximum full toasts; zero, absent or invalid means unlimited. Positive fractions round down. */
    get max(): number;
    set max(value: number);
    /** Localized description of the collapsed waiting stack. */
    stackLabel: string;
    private waiting?;
    /** Number of open, non-hidden messages currently waiting for a visible slot. */
    get queuedCount(): number;
    private managed;
    private announced;
    private pending;
    private additions;
    private known;
    private observer?;
    private ready;
    private readonly upgrades;
    private epoch;
    private queue;
    private timer?;
    private polite;
    private urgent;
    constructor();
    private get toasts();
    /** Add a plain-text message: prepend interruptions, append ordinary notifications. For rich content/actions, slot an authored en-toast instead. Returns the element immediately; insertion waits for the initial render. Pending additions participate in dismissAll; disconnect cancels insertion. */
    notify(options: ToastOptions): EnToast;
    /** Propose dismissal of each open notification, including waiting and not-yet-inserted messages; each may independently veto. */
    dismissAll(): void;
    focus(options?: FocusOptions): void;
    private sync;
    private displayable;
    private pump;
    private changed;
    private viewport;
    private visibility;
    private recover;
    connectedCallback(): void;
    private observe;
    protected updated(changed: PropertyValues): void;
    protected firstUpdated(): void;
    disconnectedCallback(): void;
    protected render(): import("lit-html").TemplateResult<1>;
}
declare global {
    interface HTMLElementTagNameMap {
        'en-toast-region': EnToastRegion;
    }
}

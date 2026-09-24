import type { ReactiveController, ReactiveControllerHost } from 'lit';
export type PopupPresentation = 'pending' | 'visible' | 'suspended';
export type SuspensionReason = 'no-room' | 'offscreen' | 'unmeasured';
interface PositionOptions {
    anchor(): HTMLElement | null;
    row(): HTMLElement | null;
    /** Returns true only when application ownership requires a constrained surface to remain visible. */
    unfit(reason: SuspensionReason): boolean;
    popup(): HTMLElement | null;
    open(): boolean;
    submenu(): boolean;
    replacement(): boolean;
    /** Returns true when a presentation change needs a host update before placement. */
    adaptPresentation(viewportWidth: number, gap: number): boolean;
    resized(): void;
    presented(state: PopupPresentation, reason?: SuspensionReason): void;
}
/** Adapted from combobox positioning: same empirical origin, edge, fit and precision policy.
 * Menu width is content-authored and viewport-clamped; caller supplies an original slotted row. */
export declare class MenuPositionController implements ReactiveController {
    private readonly host;
    private readonly options;
    private connected;
    private anchor;
    private popup;
    private measurement?;
    private view?;
    private geometry;
    private originX?;
    private originY?;
    private presented;
    private reason;
    constructor(host: ReactiveControllerHost, options: PositionOptions);
    hostConnected(): void;
    hostDisconnected(): void;
    hostUpdated(): void;
    sync(): void;
    private readonly schedule;
    private position;
    private setPresented;
    private stop;
}
export {};

import type { OverlayEventMap } from '../dialog/types.js';
import { EnElement } from '../internal/en-element.js';
import type { PropertyValues } from 'lit';
import type { ChangeOutcome } from '../../primitives/interactions/events.js';
import type { OverlayReason } from '../dialog/types.js';
/** Supported public trigger surface; en-button forwards ARIA attributes to its native semantic control. */
export type OverlayTrigger = HTMLElement & {
    disabled?: boolean;
    loading?: boolean;
};
/** Shared native floating-surface lifecycle; not registered as a custom element. */
export declare class FloatingSurface extends EnElement<OverlayEventMap> {
    #private;
    static properties: {
        open: {
            type: BooleanConstructor;
            reflect: boolean;
            noAccessor: boolean;
        };
        for: {
            type: StringConstructor;
            reflect: boolean;
        };
    };
    static styles: import("lit").CSSResult[];
    /** Open state, including a tentative value during en-change. Author writes are silent. */
    get open(): boolean;
    set open(value: boolean);
    /**
     * Literal ID of an external native button or en-button in this element's Document or ShadowRoot.
     * No matching trigger defers initial display; an already visible surface retains its last position.
     * @default ""
     */
    for: string;
    constructor();
    show(reason?: OverlayReason): ChangeOutcome;
    hide(reason?: OverlayReason): ChangeOutcome;
    protected requestOpen(proposed: boolean, reason: OverlayReason): ChangeOutcome;
    protected get surface(): HTMLElement | null;
    protected get trigger(): OverlayTrigger | null;
    protected get movesFocus(): boolean;
    /** Author writes and accepted nested open transitions invalidate deferred action defaults. */
    protected get openRevision(): number;
    protected get changingOpen(): boolean;
    protected get presentedOpen(): boolean;
    protected get managesOwnPosition(): boolean;
    protected focusSurface(): void;
    protected returnsFocus(reason: OverlayReason): boolean;
    /** Snapshot the return target when presentation opens, including non-click entry. */
    protected openerFor(active: Element | null, fromTrigger: boolean): HTMLElement | null;
    protected get activeElement(): Element | null;
    /** A tooltip sharing a trigger must not consume Escape before its interactive popover. */
    protected get hasOpenPopoverForTrigger(): boolean;
    protected triggerChanged(): void;
    protected get triggerAttributes(): Readonly<Record<string, string>>;
    connectedCallback(): void;
    disconnectedCallback(): void;
    protected updated(_changes: PropertyValues): void;
    protected triggerClick: (event: MouseEvent) => void;
    protected connectTrigger(trigger: OverlayTrigger): void;
    protected disconnectTrigger(trigger: OverlayTrigger): void;
    protected observeTrigger(): void;
    /** Specialized surfaces may accept additional encapsulated trigger components. */
    protected acceptsTrigger(element: Element): boolean;
    protected acceptTrigger: (element: Element | null) => void;
    protected detachTrigger(): void;
    protected syncTriggerAttributes(): void;
    protected syncPopover(): void;
    /** Native toggle is terminal; an external hide cannot be canceled afterward. */
    protected nativeToggle: (event: ToggleEvent) => void;
    private reconcileNativeHide;
    protected position: () => void;
    protected startListening(): void;
    protected stopListening(): void;
}

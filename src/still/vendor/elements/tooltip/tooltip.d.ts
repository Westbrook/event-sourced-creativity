import type { ChangeOutcome } from '../../primitives/interactions/events.js';
import { FloatingSurface } from '../popover/floating-surface.js';
import type { OverlayTrigger } from '../popover/floating-surface.js';
import type { OverlayReason } from '../dialog/types.js';
import type { Point } from './hover-corridor.js';
export type { TooltipAxis } from './position-controller.js';
/**
 * Supplemental text for a native button or en-button, exposed on hover and keyboard focus.
 * `for` identifies an external trigger in this element's Document or ShadowRoot.
 * The trigger's aria-describedby references the real light-DOM content in that same tree.
 * Put required instructions in persistent content, not exclusively in a tooltip.
 * Content must be phrasing content without interactive descendants; use popover
 * for interactive content. en-button forwards the actual description elements to
 * its native semantic control; arbitrary custom-element triggers are unsupported.
 *
 * @tag en-tooltip
 * @tagname en-tooltip
 * @slot content - One phrasing element containing supplemental text; no controls.
 * @csspart arrow - Decorative pointer; size with --en-overlay-arrow-size.
 * @csspart arrow-shape - SVG path styling; use arrow-path for portable shape customization.
 * @csspart content - Scrollable content inside the arrow surface.
 * @cssprop --en-overlay-arrow-size - Pointer projection length; base is twice this size.
 * @csspart surface - Hoverable tooltip surface in the native top layer.
 * @fires {import('../dialog/types.js').OverlayChangeEvent} en-change - Cancelable tentative open state: {previous, proposed, reason}.
 * @cssprop --en-overlay-background - Tooltip background.
 * @cssprop --en-overlay-color - Tooltip foreground.
 * @cssprop --en-overlay-padding - Tooltip padding.
 * @cssprop --en-overlay-radius - Tooltip corner radius.
 * @cssprop --en-duration-enter - Optional tooltip fade-in duration; hover timing and focus behavior are unchanged.
 * @cssprop --en-duration-exit - Optional tooltip fade-out duration; native dismissal remains immediate.
 * @cssprop --en-ease-enter - Tooltip fade-in easing.
 * @cssprop --en-ease-exit - Tooltip fade-out easing.
 */
export declare class EnTooltip extends FloatingSurface {
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
        arrow: {
            type: BooleanConstructor;
            reflect: boolean;
        };
        arrowPath: {
            type: StringConstructor;
            attribute: string;
        };
        warmupGroup: {
            type: StringConstructor;
            attribute: string;
        };
        showDelay: {
            type: NumberConstructor;
            attribute: string;
        };
        hideDelay: {
            type: NumberConstructor;
            attribute: string;
        };
        transitDuration: {
            type: NumberConstructor;
            attribute: string;
        };
        inline: {
            type: StringConstructor;
            reflect: boolean;
        };
        block: {
            type: StringConstructor;
            reflect: boolean;
        };
    };
    /**
     * Optional literal ID of a containing toolbar/group in the external trigger's tree.
     * After a pointer-opened tooltip is displayed, peers skip show-delay until 500ms
     * after all group pointer activity ends. Displayed focused help suppresses peer hover
     * until blur or accepted Escape. Fresh hover after focused Escape is pointer-only
     * until a new focus interaction. Missing/non-containing groups stay independent.
     * @default ""
     */
    warmupGroup: string;
    /** Pointer hover delay in milliseconds. Keyboard focus opens immediately. */
    showDelay: number;
    /** Pointer exit grace period; permits moving onto the tooltip surface. */
    hideDelay: number;
    /** Maximum safe pointer transit time across the gap, in milliseconds (0–5000). */
    transitDuration: number;
    /** Preferred inline region relative to the trigger: start, center or end. Follows its direction/writing mode. @default "center" */
    inline: 'start' | 'center' | 'end';
    /** Preferred block region: start, center or end. Center/center resolves to block end; viewport fit takes priority. @default "end" */
    block: 'start' | 'center' | 'end';
    /** Show a decorative, collision-aware pointer to the trigger. */
    arrow: boolean;
    /** SVG pointer path in a 16 by 8 viewBox; keep its base at y=0. */
    arrowPath: string;
    constructor();
    protected position: () => void;
    protected get movesFocus(): boolean;
    protected get triggerAttributes(): Readonly<Record<string, string>>;
    protected startListening(): void;
    protected stopListening(): void;
    show(reason?: OverlayReason): ChangeOutcome;
    protected syncPopover(): void;
    private eligibleTrigger;
    /** Validate synchronously too: mutations can occur before observer delivery or inside en-change. */
    private syncWarmupGroup;
    private reconcileWarmupGroup;
    /** A displayed successor replaces only unattended pointer help, through the normal event contract. */
    private hasFocusedPresentation;
    private resumeHover;
    private handoffHover;
    private releaseWarmupGroup;
    private updateWarmupActivity;
    private scheduleShow;
    hide(reason?: OverlayReason): ChangeOutcome;
    /** Escape ends help for this focused interval, without moving native focus. */
    private suppressFocusedInterval;
    private get focusKeepsOpen();
    protected connectTrigger(trigger: OverlayTrigger): void;
    protected disconnectTrigger(trigger: OverlayTrigger): void;
    disconnectedCallback(): void;
    protected triggerChanged(): void;
    protected readContent: () => void;
    /** Observe only the two owned relationship endpoints, never their surrounding document. */
    protected observeDescription(): void;
    protected clearContent(): void;
    protected clearDescription(): void;
    protected clearTimers(): void;
    protected clearTransit(): void;
    protected beginTransit(event: PointerEvent, destination: HTMLElement | null, previous: Point | null): boolean;
    protected render(): import("lit-html").TemplateResult<1>;
}
declare global {
    interface HTMLElementTagNameMap {
        'en-tooltip': EnTooltip;
    }
}

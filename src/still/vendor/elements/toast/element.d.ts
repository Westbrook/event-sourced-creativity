import { type PropertyValues } from 'lit';
import { EnElement } from '../internal/en-element.js';
/**
 * A persistent-by-default notification. A containing en-toast-region owns announcements.
 * @internalEvent en-internal-toast-focus-return
 * @tagname en-toast
 * @slot - Message content; communicate status in words, not only color.
 * @slot icon - Decorative status icon; replaces the shared default glyph.
 * @csspart icon - Leading decorative status cue.
 * @slot actions - Application-owned buttons or links. Their presence prevents timeout.
 * @csspart base - Notification surface.
 * @csspart content - Message body.
 * @csspart actions - Action layout.
 * @csspart close - Shared en-button control.
 * @cssprop --en-toast-enter-duration - Optional theme presentation; see the customization registry for state, fallback and reachability.
 * @cssprop --en-toast-enter-ease - Optional theme presentation; see the customization registry for state, fallback and reachability.
 * @cssprop --en-toast-exit-duration - Optional theme presentation; see the customization registry for state, fallback and reachability.
 * @cssprop --en-toast-exit-ease - Optional theme presentation; see the customization registry for state, fallback and reachability.
 * @cssprop --en-toast-background - Surface fill, falling back to shared surface color.
 * @cssprop --en-toast-color - Message text color.
 * @cssprop --en-toast-border-color - Notification border color.
 * @cssprop --en-toast-stack-offset - Decorative separation of waiting stack layers.
 * @cssprop --en-toast-shadow - Surface elevation.
 * @cssprop --en-toast-icon-color - Default status icon color.
 * @cssprop --en-toast-radius - Corners, falling back to panel radius.
 * @cssprop --en-toast-padding - Interior spacing, falling back to panel spacing.
 * @cssprop --en-toast-info-background - Info background; falls back to general toast paint.
 * @cssprop --en-toast-info-color - Info color; falls back to general toast paint.
 * @cssprop --en-toast-info-border-color - Info border-color; falls back to general toast paint.
 * @cssprop --en-toast-info-icon-color - Info icon-color; falls back to general toast paint.
 * @cssprop --en-toast-success-background - Success background; falls back to general toast paint.
 * @cssprop --en-toast-success-color - Success color; falls back to general toast paint.
 * @cssprop --en-toast-success-border-color - Success border-color; falls back to general toast paint.
 * @cssprop --en-toast-success-icon-color - Success icon-color; falls back to general toast paint.
 * @cssprop --en-toast-warning-background - Warning background; falls back to general toast paint.
 * @cssprop --en-toast-warning-color - Warning color; falls back to general toast paint.
 * @cssprop --en-toast-warning-border-color - Warning border-color; falls back to general toast paint.
 * @cssprop --en-toast-warning-icon-color - Warning icon-color; falls back to general toast paint.
 * @cssprop --en-toast-danger-background - Danger background; falls back to general toast paint.
 * @cssprop --en-toast-danger-color - Danger color; falls back to general toast paint.
 * @cssprop --en-toast-danger-border-color - Danger border-color; falls back to general toast paint.
 * @cssprop --en-toast-danger-icon-color - Danger icon-color; falls back to general toast paint.
 * @fires {import('../../primitives/interactions/events.js').ChangeEvent<boolean>} en-change - Tentative open=false dismissal. Reasons dismiss, escape, swipe or timeout; cancellation restores open and explicit author writes win.
 */
export declare class EnToast extends EnElement {
    static properties: {
        open: {
            type: BooleanConstructor;
            reflect: boolean;
            noAccessor: boolean;
        };
        variant: {
            reflect: boolean;
        };
        duration: {
            type: NumberConstructor;
        };
        dismissLabel: {
            attribute: string;
        };
        announcement: {};
        priority: {};
        interrupt: {
            type: BooleanConstructor;
            reflect: boolean;
        };
        swipe: {
            type: BooleanConstructor;
            reflect: boolean;
        };
    };
    static styles: import("lit").CSSResult[];
    private shown;
    private revision;
    private timer?;
    private visibilityObserver?;
    private started;
    private remaining;
    private timingText;
    private hovered;
    private focused;
    private actionContent;
    /** Open state. Explicit property writes are silent; dismiss() proposes a cancelable change. */
    get open(): boolean;
    set open(value: boolean);
    /** Visual semantic state; does not make an announcement urgent. */
    variant: 'info' | 'success' | 'warning' | 'danger';
    /** Requested expiry in milliseconds; positive values receive a five-second and content-reading minimum. Zero (default) persists. Actions prevent expiry. */
    duration: number;
    /** Localized accessible close label. */
    dismissLabel: string;
    /** Plain announcement text. Empty uses default-slot text, excluding actions. */
    announcement: string;
    /** Announcement urgency in the containing region; use assertive sparingly. */
    priority: 'polite' | 'assertive' | 'off';
    /** Bypass ordinary waiting messages when the region is capped; does not change announcement urgency. */
    interrupt: boolean;
    /** Opt-in horizontal pointer swipe. Vertical scrolling and interactive/focused content are protected. */
    swipe: boolean;
    private gesture?;
    constructor();
    /** Propose dismissal through the single en-change contract. */
    dismiss(reason?: 'dismiss' | 'escape' | 'timeout' | 'swipe'): void;
    /** Plain message text used by the containing announcement region. */
    get messageText(): string;
    /** Full uninterrupted countdown budget in milliseconds, before hover/focus pauses. Actions still prevent expiry. */
    get effectiveDuration(): number;
    private resetBudget;
    focus(options?: FocusOptions): void;
    private pause;
    private resume;
    private visibility;
    private contentVisibility;
    private swipeStart;
    private swipeMove;
    private swipeEnd;
    private swipeCancel;
    private enter;
    private leave;
    private focusIn;
    private focusOut;
    private actionsChanged;
    connectedCallback(): void;
    disconnectedCallback(): void;
    protected updated(changed: PropertyValues): void;
    protected render(): import("lit-html").TemplateResult<1>;
}
declare global {
    interface HTMLElementTagNameMap {
        'en-toast': EnToast;
    }
}

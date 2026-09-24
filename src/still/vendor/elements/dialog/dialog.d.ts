import type { OverlayEventMap } from './types.js';
import { EnElement } from '../internal/en-element.js';
import type { PropertyValues } from 'lit';
import type { ChangeOutcome } from '../../primitives/interactions/events.js';
import { type DialogView } from './template.js';
import type { DialogClosedBy, OverlayReason } from './types.js';
export type { DialogClosedBy, OverlayReason } from './types.js';
/**
 * A modal dialog using native focus containment and background inertness.
 * Supply a meaningful `label`. Content remains in the host's theme tree.
 * Application property writes are authoritative and emit no change event.
 * Native form submission and essential instructions belong in the slotted content.
 *
 * @cssprop --en-dialog-enter-duration - Optional family presentation; see the customization registry.
 * @cssprop --en-dialog-enter-ease - Optional family presentation; see the customization registry.
 * @cssprop --en-dialog-exit-duration - Optional family presentation; see the customization registry.
 * @cssprop --en-dialog-exit-ease - Optional family presentation; see the customization registry.
 * @cssprop --en-duration-enter - Optional native surface entry paint duration (0–500ms).
 * @cssprop --en-duration-exit - Optional native surface exit paint duration (0–500ms); never delays state or focus.
 * @cssprop --en-ease-enter - Native surface entry easing.
 * @cssprop --en-ease-exit - Native surface exit easing.
 * @cssprop --en-motion-surface-offset - Optional modal travel, constrained to 0–8px.
 * @cssprop --en-motion-surface-scale - Optional modal scale, constrained to .95–1.
 * @tag en-dialog
 * @tagname en-dialog
 * @cssprop --en-overlay-focus-width - Immediate primary focus contour width.
 * @cssprop --en-overlay-focus-color - Immediate primary focus contour color.
 * @cssprop --en-overlay-focus-offset - Signed primary focus contour offset.
 * @cssprop --en-overlay-focus-halo-width - Supplemental outer focus halo width.
 * @cssprop --en-overlay-focus-halo-color - Supplemental focus halo color; alpha is supported.
 * @cssprop --en-duration-focus-enter - Supplemental halo and field-accent entry duration.
 * @cssprop --en-duration-focus-exit - Supplemental halo and field-accent exit duration.
 * @cssprop --en-ease-focus-enter - Supplemental focus entry timing function.
 * @cssprop --en-ease-focus-exit - Supplemental focus exit timing function.
 * @slot - Dialog body. Flow content and controls are supported.
 * @slot label - Noninteractive title phrasing; falls back to the label attribute.
 * @slot description - Short supporting summary; replaces the description attribute/property fallback.
 * @csspart description - Supporting summary; inherits text styles without adding an empty layout box.
 * @slot footer - Optional actions, in reading order after the body.
 * @csspart surface - The native dialog surface.
 * @csspart header - Visible heading and dismiss action.
 * @csspart heading - Visible dialog heading.
 * @csspart close - Native control of the internal icon-only en-button, forwarded through exportparts.
 * @csspart body - Content container.
 * @csspart footer - Footer container.
 * @fires {import('../dialog/types.js').OverlayChangeEvent} en-change - Cancelable tentative open state: {previous, proposed, reason}.
 * @cssprop --en-overlay-max-inline-size - Maximum surface inline size.
 * @cssprop --en-overlay-max-block-size - Maximum surface block size.
 * @cssprop --en-overlay-padding - Surface content spacing.
 * @cssprop --en-overlay-radius - Surface corner radius.
 * @cssprop --en-overlay-background - Surface background.
 * @cssprop --en-overlay-color - Surface foreground.
 * @cssprop --en-overlay-border-color - Surface border.
 */
export declare class EnDialog<Events extends {
    [K in keyof Events]: Event;
} = OverlayEventMap> extends EnElement<Events> {
    #private;
    static properties: {
        for: {
            type: StringConstructor;
            reflect: boolean;
        };
        kind: {
            reflect: boolean;
        };
        description: {};
        initialFocus: {
            attribute: string;
        };
        open: {
            type: BooleanConstructor;
            reflect: boolean;
            noAccessor: boolean;
        };
        label: {
            type: StringConstructor;
            useDefault: boolean;
        };
        closeLabel: {
            type: StringConstructor;
            attribute: string;
            useDefault: boolean;
        };
        closedBy: {
            type: StringConstructor;
            attribute: string;
            reflect: boolean;
            noAccessor: boolean;
        };
        dismissible: {
            type: BooleanConstructor;
        };
        backdropDismiss: {
            type: BooleanConstructor;
            attribute: string;
            noAccessor: boolean;
        };
        presentation: {
            type: StringConstructor;
            reflect: boolean;
        };
        responsiveQuery: {
            type: StringConstructor;
            attribute: string;
        };
    };
    static styles: import("lit").CSSResult[];
    /** Open state, including a tentative value during en-change. Author writes are silent. */
    get open(): boolean;
    set open(value: boolean);
    /** Literal ID of an external native button or en-button in the same Document or ShadowRoot. */
    for: string;
    /** Semantic role of the actual native surface. */
    kind: 'dialog' | 'alertdialog';
    /** Short confirmation description, associated with the native dialog. */
    description: string;
    /** ID of a focusable descendant to focus on opening; omit to use native autofocus. */
    initialFocus: string;
    /** Required, visible dialog title and accessible name. */
    label: string;
    /** Localized name for the native dismiss button. */
    closeLabel: string;
    /**
     * Native dismissal policy. `any` includes outside clicks; `none` retains explicit close actions.
     * @default "closerequest"
     */
    get closedBy(): DialogClosedBy;
    set closedBy(value: DialogClosedBy);
    /** Legacy overall dismissal switch. False also hides the visible close action. */
    dismissible: boolean;
    /**
     * Legacy alias for closedBy='any'; setting false selects 'closerequest'.
     * @default false
     */
    get backdropDismiss(): boolean;
    set backdropDismiss(value: boolean);
    /** Opt in to a bottom drawer at the responsive query; the same modal instance remains open. */
    presentation: 'dialog' | 'responsive';
    /** CSS media query for responsive presentation. Default derives from the layout dialog-collapse token. */
    responsiveQuery: string;
    constructor();
    /** Propose opening; en-change exposes tentative open state before native modality changes. */
    show(reason?: OverlayReason): ChangeOutcome;
    /** Propose closing; cancel en-change to keep the dialog open. */
    hide(reason?: OverlayReason): ChangeOutcome;
    protected requestOpen(proposed: boolean, reason: OverlayReason, canCommit?: () => boolean): ChangeOutcome;
    /** The palette retains its existing programmatic trigger-toggle behavior. */
    protected get triggerToggles(): boolean;
    /** Ownership clock for action defaults: equal author writes and accepted transitions count. */
    protected get openRevision(): number;
    protected get surfaceClass(): string;
    protected get placement(): string;
    protected get dialog(): HTMLDialogElement | null;
    protected get effectiveClosedBy(): DialogClosedBy;
    /** Isolated capability seam for testing engines without the native policy. */
    protected get supportsNativeClosedBy(): boolean;
    connectedCallback(): void;
    disconnectedCallback(): void;
    protected updated(_changes: PropertyValues): void;
    protected observePresentation(): void;
    protected stopObservingPresentation(): void;
    protected setCompactPresentation(compact: boolean): void;
    protected syncDialog(): void;
    private reconcileNativeClose;
    /** Native lifecycle bindings for specialized modal content without a nested dialog. */
    protected get dialogView(): DialogView;
    protected render(): import("lit-html").TemplateResult<1>;
}
declare global {
    interface HTMLElementTagNameMap {
        'en-dialog': EnDialog;
    }
}

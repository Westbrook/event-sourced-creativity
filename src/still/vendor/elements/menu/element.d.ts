import type { PropertyValues } from 'lit';
import { FloatingSurface, type OverlayTrigger } from '../popover/floating-surface.js';
import type { OverlayReason } from '../dialog/types.js';
/**
 * A slot-first native popover menu for application commands.
 * Supply an explicit label and a same-tree external button through for.
 * @cssprop --en-popup-enter-duration - Optional theme presentation; see the customization registry for state, fallback and reachability.
 * @cssprop --en-popup-enter-ease - Optional theme presentation; see the customization registry for state, fallback and reachability.
 * @cssprop --en-popup-exit-duration - Optional theme presentation; see the customization registry for state, fallback and reachability.
 * @cssprop --en-popup-exit-ease - Optional theme presentation; see the customization registry for state, fallback and reachability.
 * @cssprop --en-duration-enter - Optional native surface entry paint duration (0–500ms).
 * @cssprop --en-duration-exit - Optional native surface exit paint duration (0–500ms); never delays state or focus.
 * @cssprop --en-ease-enter - Native surface entry easing.
 * @cssprop --en-ease-exit - Native surface exit easing.
 * @tagname en-menu
 * @cssprop --en-overlay-focus-width - Immediate primary focus contour width.
 * @cssprop --en-overlay-focus-color - Immediate primary focus contour color.
 * @cssprop --en-overlay-focus-offset - Signed primary focus contour offset.
 * @cssprop --en-overlay-focus-halo-width - Supplemental outer focus halo width.
 * @cssprop --en-overlay-focus-halo-color - Supplemental focus halo color; alpha is supported.
 * @cssprop --en-duration-focus-enter - Supplemental halo and field-accent entry duration.
 * @cssprop --en-duration-focus-exit - Supplemental halo and field-accent exit duration.
 * @cssprop --en-ease-focus-enter - Supplemental focus entry timing function.
 * @cssprop --en-ease-focus-exit - Supplemental focus exit timing function.
 * @cssprop --en-option-list-background - Shared surface customization.
 * @cssprop --en-option-list-color - Shared surface customization.
 * @cssprop --en-option-list-border-color - Shared surface customization.
 * @cssprop --en-option-list-radius - Shared surface customization.
 * @cssprop --en-option-list-padding - Shared surface customization.
 * @cssprop --en-option-list-shadow - Shared surface customization.
 * @cssprop --en-option-list-max-block-size - Shared surface customization.
 * @cssprop --en-option-list-gap - Shared surface customization.
 * @cssprop --en-overlay-background - Shared surface customization.
 * @cssprop --en-overlay-color - Shared surface customization.
 * @cssprop --en-overlay-border-color - Shared surface customization.
 * @cssprop --en-overlay-radius - Shared surface customization.
 * @cssprop --en-overlay-padding - Shared surface customization.
 * @cssprop --en-overlay-max-inline-size - Shared surface customization.
 * @cssprop --en-overlay-max-block-size - Shared surface customization.
 * @slot - Direct en-menu-item children, noninteractive separators and nested en-menu siblings using for.
 * @csspart surface - Named native menu popover.
 * @csspart back - Native menu action returning from a replacement submenu.
 * @fires {import('../dialog/types.js').OverlayChangeEvent} en-change - Cancelable tentative boolean open state: {previous, proposed, reason}.
 * @fires {import('../events.js').CommandActionEvent} en-action - Original item command intent bubbles through the menu; it is not re-emitted.
 */
export declare class EnMenu extends FloatingSurface {
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
        label: {
            type: StringConstructor;
            useDefault: boolean;
        };
        backLabel: {
            type: StringConstructor;
            attribute: string;
            useDefault: boolean;
        };
    };
    static styles: import("lit").CSSResult[];
    /** Accessible menu name; does not reference a trigger through a shadow boundary. */
    label: string;
    /** Localized label for returning from a replacement submenu to its parent. */
    backLabel: string;
    private replacementMode;
    private touchPresentation;
    private lastPointerType?;
    private presentationOpen;
    private presentationParent;
    private presentationTrigger;
    private openingFromHover;
    private hoverTimer?;
    private pointerOrigin?;
    private pointerPoint?;
    private pendingHover?;
    private items;
    private itemTriggerState?;
    private releases;
    private mutation?;
    private shown;
    private entry;
    private needsFocus;
    private entryFocus;
    private layoutVetoRevision?;
    private readonly upgrades;
    private readonly triggerUpgrades;
    private readonly roving;
    private readonly keys;
    private readonly placementController;
    private readonly owner;
    /** Submenus remain siblings of their trigger inside the parent menu's slot. */
    private get parentMenu();
    private get childMenus();
    /** Specialized invocation may position at a point while retaining the real trigger. */
    protected get positionAnchor(): HTMLElement | null;
    protected acceptsTrigger(element: Element): boolean;
    protected requestOpen(proposed: boolean, reason: OverlayReason): import("../../primitives/interactions/events.js").ChangeOutcome;
    private readonly submenuKeyDown;
    constructor();
    protected get managesOwnPosition(): boolean;
    protected get triggerAttributes(): Readonly<Record<string, string>>;
    protected syncTriggerAttributes(): void;
    protected returnsFocus(reason: OverlayReason): boolean;
    protected openerFor(active: Element | null, fromTrigger: boolean): HTMLElement | null;
    protected focusSurface(): void;
    protected position: () => void;
    protected triggerClick: (event?: MouseEvent) => void;
    protected connectTrigger(trigger: OverlayTrigger): void;
    protected disconnectTrigger(trigger: OverlayTrigger): void;
    private readonly triggerKeyDown;
    private closeForTab;
    connectedCallback(): void;
    disconnectedCallback(): void;
    protected updated(changes: PropertyValues): void;
    private available;
    private readonly readChildren;
    private revealCurrent;
    private readPresentationMode;
    private adaptPresentation;
    private get focusItems();
    private readonly back;
    private readonly pointerDown;
    private clearHover;
    private readonly pointerMove;
    private inSafeTriangle;
    private readonly pointerOut;
    private readonly pointerOver;
    private activateHover;
    protected render(): import("lit-html").TemplateResult<1>;
}
declare global {
    interface HTMLElementTagNameMap {
        'en-menu': EnMenu;
    }
}

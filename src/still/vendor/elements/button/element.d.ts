import { EnElement } from '../internal/en-element.js';
/**
 * An action button with native keyboard and disabled behavior.
 * This initial button is type="button"; form submission belongs to its consumer.
 * @tagname en-button
 * @cssprop --en-button-press-duration - Optional theme presentation; see the customization registry for state, fallback and reachability.
 * @cssprop --en-button-pressed-offset - Optional theme presentation; see the customization registry for state, fallback and reachability.
 * @cssprop --en-button-popup-pressed-scale - Held popup-trigger scale; inherits ordinary button motion unless refined.
 * @cssprop --en-button-popup-pressed-offset - Held popup-trigger translation; inherits ordinary button motion unless refined.
 * @cssprop --en-button-pressed-scale - Optional theme presentation; see the customization registry for state, fallback and reachability.
 * @cssprop --en-button-pressed-shadow - Optional theme presentation; see the customization registry for state, fallback and reachability.
 * @cssprop --en-button-release-duration - Optional theme presentation; see the customization registry for state, fallback and reachability.
 * @cssprop --en-button-shadow - Optional theme presentation; see the customization registry for state, fallback and reachability.
 * @cssprop --en-button-focus-width - Immediate primary focus contour width.
 * @cssprop --en-button-focus-color - Immediate primary focus contour color.
 * @cssprop --en-button-focus-offset - Signed primary focus contour offset.
 * @cssprop --en-button-focus-halo-width - Supplemental outer focus halo width.
 * @cssprop --en-button-focus-halo-color - Supplemental focus halo color; alpha is supported.
 * @cssprop --en-duration-focus-enter - Supplemental halo and field-accent entry duration.
 * @cssprop --en-duration-focus-exit - Supplemental halo and field-accent exit duration.
 * @cssprop --en-ease-focus-enter - Supplemental focus entry timing function.
 * @cssprop --en-ease-focus-exit - Supplemental focus exit timing function.
 * @cssprop --en-button-background - Action surface fill.
 * @cssprop --en-button-color - Action label color.
 * @cssprop --en-button-rest-background - Enabled rest background refinement; precedes broad button paint across variants.
 * @cssprop --en-button-rest-color - Enabled rest color refinement; precedes broad button paint across variants.
 * @cssprop --en-button-hover-background - Enabled hover background refinement; precedes broad button paint across variants.
 * @cssprop --en-button-hover-color - Enabled hover color refinement; precedes broad button paint across variants.
 * @cssprop --en-button-pressed-background - Enabled pressed background refinement; precedes broad button paint across variants.
 * @cssprop --en-button-pressed-color - Enabled pressed color refinement; precedes broad button paint across variants.
 * @cssprop --en-button-border-color - Action border color.
 * @cssprop --en-button-radius - Action corner radius; falls back to shared control-radius.
 * @cssprop --en-control-radius - Shared corner radius when button-radius is unset.
 * @cssprop --en-control-min-size - Minimum control block size; also the inline floor in icon-only mode.
 * @cssprop --en-button-inline-padding - Text-button inline padding; takes precedence over shared control-inline-padding. Icon buttons retain their own geometry.
 * @cssprop --en-control-inline-padding - Shared horizontal control padding.
 * @slot - Default label content, used when no named label is supplied.
 * @slot label - Full accessible action label. Icon-only mode visually hides it without removing its name; keep it present while loading.
 * @slot prefix - Decorative content before the label.
 * @slot suffix - Decorative content after the label.
 * @attr {string} aria-pressed - Controlled persistent toggle semantics forwarded to the native button; does not enable automatic toggling.
 * @attr {string} aria-haspopup - Popup semantics forwarded to the native button.
 * @attr {string} aria-expanded - Expanded state forwarded to the native button.
 * @attr {string} aria-disabled - True prevents activation while retaining keyboard focusability; forwarded to the native button.
 * @attr {string} aria-describedby - IDs resolved in the host's tree and forwarded as element references.
 * @csspart control - The button surface.
 * @csspart label - The label container.
 * @csspart indicator - Decorative busy indicator, shown while loading.
 */
export declare class EnButton<Events extends {
    [K in keyof Events]: Event;
} = {}> extends EnElement<Events> {
    static properties: {
        variant: {
            reflect: boolean;
        };
        disabled: {
            type: BooleanConstructor;
            reflect: boolean;
        };
        loading: {
            type: BooleanConstructor;
            reflect: boolean;
        };
        iconOnly: {
            type: BooleanConstructor;
            attribute: string;
            reflect: boolean;
        };
        popupRole: {
            attribute: string;
        };
        pressedSemantics: {
            attribute: string;
        };
        popupExpanded: {
            attribute: string;
        };
        disabledSemantics: {
            attribute: string;
        };
        descriptionIds: {
            attribute: string;
            hasChanged: () => boolean;
        };
    };
    static styles: import("lit").CSSResult[];
    /** Visual emphasis. */
    variant: 'primary' | 'secondary' | 'ghost' | 'danger';
    /** Prevents activation using native button semantics. */
    disabled: boolean;
    /** Marks the action busy and prevents repeated activation. */
    loading: boolean;
    /** Square icon action with a visually hidden label. Supply one decorative prefix or suffix.
     * @default false
     */
    iconOnly: boolean;
    private pressedSemantics;
    private popupRole;
    private popupExpanded;
    private disabledSemantics;
    private descriptionIds;
    private tabStop;
    constructor();
    connectedCallback(): void;
    /** Moves focus to the native control. */
    focus(options?: FocusOptions): void;
    /** Controlled pressed semantics; subclasses can own a persistent toggle value. */
    protected get buttonPressed(): string | null;
    protected render(): import("lit-html").TemplateResult<1>;
    protected updated(): void;
}
declare global {
    interface HTMLElementTagNameMap {
        'en-button': EnButton;
    }
}

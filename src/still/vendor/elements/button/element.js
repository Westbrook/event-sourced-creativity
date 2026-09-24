import { EnElement } from '../internal/en-element.js';
import { foundationStyles, inlineHostStyles } from '../../styles/foundations.js';
import { buttonStyles } from '../../styles/buttons.js';
import { activityStyles } from '../../styles/activity.js';
import { buttonTemplate } from './template.js';
import { registerFocusParticipant } from '../internal/focus-participant.js';
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
export class EnButton extends EnElement {
    static properties = {
        variant: { reflect: true },
        disabled: { type: Boolean, reflect: true },
        loading: { type: Boolean, reflect: true },
        iconOnly: { type: Boolean, attribute: 'icon-only', reflect: true },
        popupRole: { attribute: 'aria-haspopup' },
        pressedSemantics: { attribute: 'aria-pressed' },
        popupExpanded: { attribute: 'aria-expanded' },
        disabledSemantics: { attribute: 'aria-disabled' },
        descriptionIds: { attribute: 'aria-describedby', hasChanged: () => true },
    };
    static styles = [foundationStyles, inlineHostStyles, buttonStyles, activityStyles];
    tabStop = 0;
    constructor() {
        super();
        this.variant = 'primary';
        this.disabled = false;
        this.loading = false;
        this.iconOnly = false;
        this.popupRole = null;
        this.pressedSemantics = null;
        this.popupExpanded = null;
        this.disabledSemantics = null;
        this.addEventListener('click', event => {
            if (this.getAttribute('aria-disabled') !== 'true')
                return;
            event.preventDefault();
            event.stopImmediatePropagation();
        }, { capture: true });
        this.descriptionIds = null;
        registerFocusParticipant(this, value => {
            if (this.tabStop === value)
                return;
            this.tabStop = value;
            const control = this.renderRoot?.querySelector('button');
            if (control)
                control.tabIndex = value;
            this.requestUpdate();
        });
    }
    connectedCallback() {
        super.connectedCallback();
        // Re-resolve descriptions when the host is reconnected into a different tree.
        this.requestUpdate();
    }
    /** Moves focus to the native control. */
    focus(options) {
        this.renderRoot.querySelector('button')?.focus(options);
    }
    /** Controlled pressed semantics; subclasses can own a persistent toggle value. */
    get buttonPressed() { return ['true', 'false', 'mixed'].includes(this.pressedSemantics ?? '') ? this.pressedSemantics : null; }
    render() {
        return buttonTemplate({
            variant: this.variant,
            size: this.size,
            disabled: this.disabled,
            loading: this.loading,
            iconOnly: this.iconOnly,
            popupRole: this.popupRole,
            popupExpanded: this.popupExpanded,
            ariaDisabled: this.disabledSemantics,
            tabIndex: this.tabStop,
            pressed: this.buttonPressed,
        });
    }
    updated() {
        const control = this.renderRoot.querySelector('button');
        if (!control)
            return;
        // A menu can attach popup semantics before this button hydrates. Hydration
        // may treat that new property as committed while retaining the SSR attribute.
        // Reconcile the native control without replacing it or dispatching a change.
        for (const [attribute, value] of [['aria-pressed', this.buttonPressed], ['aria-haspopup', this.popupRole], ['aria-expanded', this.popupExpanded], ['aria-disabled', this.disabledSemantics]]) {
            if (value === null) {
                if (control.hasAttribute(attribute))
                    control.removeAttribute(attribute);
            }
            else if (control.getAttribute(attribute) !== value) {
                control.setAttribute(attribute, value);
            }
        }
        if (!('ariaDescribedByElements' in control))
            return;
        const references = this.ariaDescribedByElements;
        const previous = control.ariaDescribedByElements;
        if (previous?.length !== references?.length || previous?.some((element, index) => element !== references?.[index])) {
            // ID strings cannot identify light-DOM descriptions from this shadow root.
            control.ariaDescribedByElements = references;
        }
    }
}

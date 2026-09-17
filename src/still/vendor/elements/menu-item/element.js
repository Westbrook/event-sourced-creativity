import { EnElement } from '../internal/en-element.js';
import { foundationStyles, blockHostStyles } from '../../styles/foundations.js';
import { menuItemStyles } from '../../styles/commands.js';
import { dispatchAction, dispatchChange } from '../../primitives/interactions/events.js';
import { registerFocusParticipant } from '../internal/focus-participant.js';
import { menuItemOwner, registerMenuCheckState } from '../internal/menu-owner.js';
import { menuItemTemplate } from './template.js';
/**
 * A command inside en-menu. Disabled commands remain discoverable by arrow keys.
 * Rich labels and decorative slots must not contain additional interactive controls.
 * @tagname en-menu-item
 * @cssprop --en-option-focus-width - Immediate primary focus contour width.
 * @cssprop --en-option-focus-color - Immediate primary focus contour color.
 * @cssprop --en-option-focus-offset - Signed primary focus contour offset.
 * @cssprop --en-option-focus-halo-width - Supplemental outer focus halo width.
 * @cssprop --en-option-focus-halo-color - Supplemental focus halo color; alpha is supported.
 * @cssprop --en-duration-focus-enter - Supplemental halo and field-accent entry duration.
 * @cssprop --en-duration-focus-exit - Supplemental halo and field-accent exit duration.
 * @cssprop --en-ease-focus-enter - Supplemental focus entry timing function.
 * @cssprop --en-ease-focus-exit - Supplemental focus exit timing function.
 * @cssprop --en-option-background - Shared command row customization.
 * @cssprop --en-option-color - Shared command row customization.
 * @cssprop --en-option-inline-padding - Shared command row customization.
 * @cssprop --en-option-block-padding - Shared command row customization.
 * @cssprop --en-option-radius - Shared command row customization.
 * @cssprop --en-option-font-weight - Shared command row customization.
 * @cssprop --en-color-focus - Shared command row customization.
 * @cssprop --en-option-rest-background - Shared command row customization.
 * @cssprop --en-option-rest-color - Shared command row customization.
 * @cssprop --en-option-hover-background - Shared command row customization.
 * @cssprop --en-option-hover-color - Shared command row customization.
 * @cssprop --en-option-active-background - Shared command row customization.
 * @cssprop --en-option-active-color - Shared command row customization.
 * @cssprop --en-option-pressed-background - Shared command row customization.
 * @cssprop --en-option-pressed-color - Shared command row customization.
 * @cssprop --en-option-disabled-background - Shared command row customization.
 * @cssprop --en-option-disabled-color - Shared command row customization.
 * @slot - Noninteractive command label.
 * @slot prefix - Decorative leading content.
 * @slot suffix - Decorative trailing content.
 * @slot shortcut - Display-only shortcut hint; no keyboard shortcut is registered.
 * @csspart control - Native menuitem button.
 * @csspart option - Shared option row surface; additive to control.
 * @csspart option-disabled - Disabled row; additive to control and option.
 * @csspart label - Command label container.
 * @csspart shortcut - Shortcut slot.
 * @csspart checkmark - Stable decorative checked indicator position.
 * @csspart submenu-indicator - Decorative library chevron for a bound submenu.
 * @fires en-change - Cancelable tentative checked state: {previous, proposed, reason: "checked"}; radio peers are staged coherently.
 * @fires en-action - Cancelable command intent: {action, data: undefined}. No command is executed by the component.
 */
export class EnMenuItem extends EnElement {
    static properties = {
        action: { type: String },
        type: { type: String, reflect: true },
        name: { type: String },
        checked: { type: Boolean, reflect: true, noAccessor: true },
        menuHasPopup: { type: String, attribute: 'aria-haspopup' },
        menuExpanded: { type: String, attribute: 'aria-expanded' },
        disabled: { type: Boolean, reflect: true },
    };
    static styles = [foundationStyles, blockHostStyles, menuItemStyles];
    #checked = false;
    #revision = 0;
    #stateRevision = 0;
    /** Tentative checked state during en-change; author writes silently supersede proposals. */
    get checked() { return this.#checked; }
    set checked(value) {
        const previous = this.#checked;
        this.#checked = Boolean(value);
        this.#revision++;
        this.#stateRevision++;
        this.requestUpdate('checked', previous);
        if (this.#checked && this.type === 'radio')
            menuItemOwner(this)?.radioSelected(this);
    }
    tabStop = 0;
    constructor() {
        super();
        this.action = '';
        this.disabled = false;
        this.type = 'command';
        this.name = '';
        registerMenuCheckState(this, {
            element: this, checked: () => this.#checked, revision: () => this.#stateRevision,
            stage: value => { const previous = this.#checked; this.#checked = value; this.requestUpdate('checked', previous); },
            write: value => { this.checked = value; },
        });
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
    updated(changes) {
        if ((changes.has('type') || changes.has('name')) && this.checked && this.type === 'radio')
            menuItemOwner(this)?.radioSelected(this);
    }
    focus(options) { this.renderRoot?.querySelector('button')?.focus(options); }
    activate = (event) => {
        if (event.defaultPrevented || this.disabled || !this.isConnected)
            return;
        // The bound menu owns activation of this submenu trigger.
        if (this.menuHasPopup === 'menu')
            return;
        const owner = menuItemOwner(this);
        if (owner && (!owner.ready() || !owner.owns(this)))
            return;
        const parent = this.parentElement;
        if (this.type === 'checkbox' || this.type === 'radio') {
            const previous = this.#checked;
            const proposed = this.type === 'radio' ? true : !previous;
            if (previous === proposed)
                return;
            const type = this.type, name = this.name;
            const peers = (type === 'radio' ? owner?.radioPeers(this) ?? [] : []).map(state => ({ state, checked: state.checked(), revision: state.revision() }));
            const restorePeers = () => { for (const peer of peers)
                if (peer.state.revision() === peer.revision)
                    peer.state.stage(peer.checked); };
            const outcome = dispatchChange(this, {
                previous, proposed, reason: 'checked', getRevision: () => this.#revision,
                stage: value => { this.#checked = value; for (const peer of peers)
                    peer.state.stage(false); },
                rollback: value => { this.#checked = value; restorePeers(); },
                canCommit: () => !this.disabled && this.isConnected && this.type === type && this.name === name
                    && this.parentElement === parent && menuItemOwner(this) === owner && (!owner || owner.owns(this)) && peers.every(peer => peer.state.revision() === peer.revision && peer.state.element.isConnected)
                    && (type !== 'radio' || ((owner?.radioPeers(this) ?? []).length === peers.length
                        && (owner?.radioPeers(this) ?? []).every(state => peers.some(peer => peer.state === state)))),
                commit: () => { this.#stateRevision++; if (type === 'radio')
                    owner?.radioSelected(this); },
            });
            // A consumer may replace one member's state during dispatch. Never undo
            // that write, but release the remaining unaccepted staged peer states.
            if (outcome === 'superseded')
                restorePeers();
            if (outcome === 'canceled')
                event.preventDefault();
            this.requestUpdate('checked', previous);
            return;
        }
        if (!this.action)
            return;
        const revision = owner?.capture();
        const action = this.action;
        const allowed = dispatchAction(this, { action, data: undefined }, { cancelable: true });
        if (!allowed)
            event.preventDefault();
        // dispatchEvent has completed every phase before the parent requests closing.
        if (allowed && !this.disabled && this.action === action && owner && revision !== undefined && menuItemOwner(this) === owner && owner.owns(this) && this.parentElement === parent && this.isConnected)
            owner.accepted(revision);
    };
    render() { return menuItemTemplate({ disabled: this.disabled || (this.type !== 'checkbox' && this.type !== 'radio' && !this.action && this.menuHasPopup !== 'menu'), type: this.type, checked: this.checked, hasPopup: this.menuHasPopup, expanded: this.menuExpanded, tabStop: this.tabStop, activate: this.activate }); }
}

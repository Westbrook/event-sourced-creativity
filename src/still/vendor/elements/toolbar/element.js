import { EnElement } from '../internal/en-element.js';
import { foundationStyles } from '../../styles/foundations.js';
import { toolbarStyles } from '../../styles/commands.js';
import { RovingFocusController } from '../../primitives/interactions/roving-focus.js';
import { claimFocusParticipant } from '../internal/focus-participant.js';
import { elementRegistry } from '../internal/element-registry.js';
import { toolbarTemplate } from './template.js';
/**
 * A named action group with roving button navigation or ordinary mixed-control Tab order.
 * Buttons retain their native click behavior; the toolbar dispatches no command.
 * @tagname en-toolbar
 * @slot - Direct buttons in automatic roving mode; arbitrary labelled controls in tab mode.
 * @csspart base - The named toolbar layout.
 * @cssprop --en-space-actions - Space between toolbar actions.
 */
export class EnToolbar extends EnElement {
    static properties = {
        label: {},
        orientation: { reflect: true },
        keyboardNavigation: { attribute: 'keyboard-navigation', reflect: true },
    };
    static styles = [foundationStyles, toolbarStyles];
    nativeNavigation = false;
    observer;
    roving;
    observedRegistries = new WeakSet();
    initialized = false;
    constructor() {
        super();
        this.label = 'Actions';
        this.orientation = 'horizontal';
        this.keyboardNavigation = 'auto';
        const host = this;
        this.roving = new RovingFocusController(this, {
            items: () => this.items(),
            get orientation() { return host.orientation === 'vertical' ? 'vertical' : 'horizontal'; },
            isDisabled: item => item.matches(':disabled, [disabled], [loading], [aria-disabled="true"], [hidden], [inert]')
                || !item.getClientRects().length || item.ownerDocument.defaultView?.getComputedStyle(item).visibility === 'hidden',
            claimTabStop: claimFocusParticipant,
            keydownCapture: true,
            recoverFocus: true,
        });
    }
    usesNativeNavigation() {
        if (this.keyboardNavigation === 'tab')
            return true;
        // Lit's server shim has no authored children collection. Explicit tab mode
        // is the SSR contract; automatic discovery starts after browser connection.
        if (!this.children)
            return false;
        const interactive = 'button, input:not([type="hidden"]), select, textarea, a[href], area[href], summary, iframe, audio[controls], video[controls], [tabindex], [contenteditable]:not([contenteditable="false"]), [role="button"], [role="checkbox"], [role="radio"], [role="switch"], [role="textbox"], [role="combobox"], [role="slider"], [role="spinbutton"], [role="tree"], [role="grid"], [role="listbox"], [role="tablist"]';
        return Array.from(this.children).some(child => {
            if (child.getAttribute('slot'))
                return false;
            // Supported direct buttons own their encapsulated label/icon content.
            if (child.localName === 'button' || child.localName === 'en-button')
                return false;
            // Unknown custom children may own a private interactive tree. Never assume
            // they are decorative or reach through that tree to take its tab stops.
            return [child, ...child.querySelectorAll('*')].some(node => node.localName.includes('-') || node.matches(interactive));
        });
    }
    items() {
        const nativeNavigation = this.usesNativeNavigation();
        if (nativeNavigation !== this.nativeNavigation) {
            this.nativeNavigation = nativeNavigation;
            this.requestUpdate();
        }
        // Empty membership releases every prior lease, restoring the author's Tab
        // order without moving focus or replacing any authored control.
        if (nativeNavigation)
            return [];
        // Establish the initial composite only once its authored custom controls
        // can participate, otherwise an intervening native button would become the
        // remembered entry before an earlier custom button finishes upgrading.
        if (!this.initialized && Array.from(this.children).some(child => !child.getAttribute('slot') && child.localName === 'en-button' && !('updateComplete' in child)))
            return [];
        const items = Array.from(this.children).filter((child) => !child.getAttribute('slot') && (child.localName === 'button' || child.localName === 'en-button' && 'updateComplete' in child));
        if (items.length)
            this.initialized = true;
        return items;
    }
    connectedCallback() {
        super.connectedCallback();
        const Observer = this.ownerDocument.defaultView?.MutationObserver;
        if (Observer) {
            this.observer = new Observer(() => this.refresh());
            this.observer.observe(this, {
                childList: true, subtree: true, attributes: true,
                attributeFilter: ['disabled', 'loading', 'aria-disabled', 'hidden', 'inert', 'slot', 'style', 'class', 'type', 'href', 'controls', 'role', 'contenteditable', 'tabindex'],
            });
        }
        this.refresh();
    }
    observeButtonUpgrade() {
        // This runs after child mutations as well as initial connection. Registering
        // the toolbar never registers its consumer's controls as a side effect.
        for (const item of this.children) {
            if (item.localName !== 'en-button' || 'updateComplete' in item)
                continue;
            const registry = elementRegistry(item);
            // Null denotes an uninitialized scoped tree. Never resolve it against an
            // unrelated document registry, or repeatedly wait on an already resolved name.
            if (!registry || this.observedRegistries.has(registry))
                continue;
            this.observedRegistries.add(registry);
            void registry.whenDefined('en-button').then(() => {
                if (this.isConnected) {
                    // Undefined custom controls were never claimed as native host stops.
                    // Retain existing leases, including any already yielded to the author.
                    this.refresh();
                }
            });
        }
    }
    disconnectedCallback() {
        this.observer?.disconnect();
        this.observer = undefined;
        super.disconnectedCallback();
    }
    refresh = () => {
        if (this.isConnected) {
            this.roving.refresh();
            this.observeButtonUpgrade();
        }
    };
    render() {
        return toolbarTemplate({ label: this.label, orientation: this.orientation, nativeNavigation: this.usesNativeNavigation(), onSlotChange: this.refresh });
    }
}

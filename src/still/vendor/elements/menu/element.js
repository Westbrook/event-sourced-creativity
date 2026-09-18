import { admitOverlayClick, eligibleOverlayTrigger } from '../internal/overlay-trigger.js';
import { FloatingSurface } from '../popover/floating-surface.js';
import { foundationStyles } from '../../styles/foundations.js';
import { menuStyles } from '../../styles/commands.js';
import { RovingFocusController } from '../../primitives/interactions/roving-focus.js';
import { claimFocusParticipant } from '../internal/focus-participant.js';
import { elementRegistry } from '../internal/element-registry.js';
import { ownMenuItem, menuCheckState } from '../internal/menu-owner.js';
import { MenuInteractionController } from './interaction-controller.js';
import { MenuPositionController } from './position-controller.js';
import { menuTemplate } from './template.js';
import { restoreFocus } from '../dialog/focus.js';
/**
 * A slot-first native popover menu for application commands.
 * Supply an explicit label and a same-tree external button through for.
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
 * @fires en-action - Original item command intent bubbles through the menu; it is not re-emitted.
 */
export class EnMenu extends FloatingSurface {
    static properties = { ...FloatingSurface.properties, label: { type: String, useDefault: true }, backLabel: { type: String, attribute: 'back-label', useDefault: true } };
    static styles = [foundationStyles, menuStyles];
    replacementMode = false;
    touchPresentation = false;
    lastPointerType;
    presentationOpen = false;
    presentationParent = null;
    presentationTrigger = null;
    openingFromHover = false;
    hoverTimer;
    pointerOrigin;
    pointerPoint;
    pendingHover;
    items = [];
    itemTriggerState;
    releases = new Map();
    mutation;
    shown = false;
    entry = 'first';
    needsFocus = false;
    entryFocus = null;
    layoutVetoRevision;
    observedRegistries = new WeakSet();
    roving = new RovingFocusController(this, {
        items: () => this.focusItems,
        orientation: 'vertical',
        // Disabled commands remain discoverable; hidden/inert commands do not.
        isDisabled: item => !this.available(item),
        claimTabStop: claimFocusParticipant,
        recoverFocus: true,
        focusEmpty: () => { if (this.open && this.shown)
            this.surface?.focus({ preventScroll: true }); },
    });
    keys = new MenuInteractionController(this, {
        open: () => this.open, presented: () => this.shown, items: () => this.focusItems.filter(item => this.available(item)),
        focus: item => { this.roving.setCurrent(item, { focus: true }); },
        closeForTab: event => this.closeForTab(event),
    });
    placementController = new MenuPositionController(this, {
        anchor: () => this.replacementMode && this.parentMenu ? this.parentMenu.surface : this.trigger, popup: () => this.surface, open: () => this.presentedOpen,
        submenu: () => this.parentMenu !== null,
        adaptPresentation: (width, gap) => this.adaptPresentation(width, gap),
        replacement: () => this.replacementMode && this.parentMenu !== null,
        row: () => this.focusItems.find(item => !item.hidden && !item.inert && item.getClientRects().length > 0) ?? null,
        resized: () => this.revealCurrent(),
        unfit: () => {
            // One layout request per authoritative open state. An explicit veto owns
            // the choice to retain a constrained surface instead of hiding focus.
            if (this.layoutVetoRevision === this.openRevision)
                return this.open;
            this.hide('layout');
            if (this.open) {
                this.layoutVetoRevision = this.openRevision;
                return true;
            }
            return false;
        },
        presented: state => {
            this.shown = state === 'visible';
            this.parentMenu?.requestUpdate();
            if (this.shown) {
                this.roving.refresh();
                if (this.needsFocus && this.open) {
                    const candidates = this.focusItems.filter(item => this.available(item));
                    const item = this.entry === 'last' ? candidates.at(-1) : candidates[0];
                    const ownsFocus = this.activeElement === this.entryFocus;
                    this.needsFocus = false;
                    this.entryFocus = null;
                    if (ownsFocus) {
                        if (item)
                            this.roving.setCurrent(item, { focus: true });
                        else
                            this.surface?.focus({ preventScroll: true });
                    }
                }
            }
        },
    });
    owner = {
        ready: () => this.open && this.shown && !this.changingOpen,
        owns: item => item.parentElement === this && !item.slot && this.items.includes(item),
        capture: () => {
            const chain = [];
            let menu = this;
            while (menu) {
                chain.push({ menu, revision: menu.openRevision, parent: menu.parentMenu, trigger: menu.trigger, forId: menu.for });
                menu = menu.parentMenu;
            }
            return () => {
                if (chain.every(({ menu, revision, parent, trigger, forId }) => menu.isConnected && menu.open && menu.openRevision === revision && menu.parentMenu === parent && menu.trigger === trigger && menu.for === forId))
                    chain.at(-1).menu.hide('action');
            };
        },
        accepted: checkpoint => checkpoint(),
        radioPeers: item => this.items.filter(peer => peer !== item && this.owner.owns(peer) && peer.type === 'radio' && peer.name === item.name)
            .flatMap(peer => { const state = menuCheckState(peer); return state ? [state] : []; }),
        radioSelected: item => { if (!this.owner.owns(item))
            return; for (const state of this.owner.radioPeers(item))
            state.write(false); },
    };
    /** Submenus remain siblings of their trigger inside the parent menu's slot. */
    get parentMenu() {
        const parent = this.parentElement;
        return parent?.localName === 'en-menu' && 'show' in parent && this.trigger?.parentElement === parent ? parent : null;
    }
    get childMenus() {
        return [...(this.children ?? [])].filter((child) => child.localName === 'en-menu' && 'hide' in child);
    }
    acceptsTrigger(element) {
        return super.acceptsTrigger(element) || (element.localName === 'en-menu-item'
            && element.parentElement === this.parentElement && this.parentElement?.localName === 'en-menu');
    }
    requestOpen(proposed, reason) {
        if (proposed && !this.open)
            this.readPresentationMode();
        if (proposed && this.parentMenu && (!this.parentMenu.open || !this.parentMenu.shown))
            return 'unchanged';
        const outcome = super.requestOpen(proposed, reason);
        if (outcome === 'committed') {
            if (!this.open) {
                // An accepted parent dismissal makes every descendant unavailable.
                // Teardown cannot leave an independently canceled orphan in the top layer.
                for (const child of this.childMenus)
                    child.open = false;
            }
            else if (this.parentMenu) {
                for (const sibling of this.parentMenu.childMenus)
                    if (sibling !== this && sibling.open) {
                        sibling.open = false;
                        sibling.syncPopover();
                    }
            }
        }
        if (!this.open)
            this.parentMenu?.surface?.removeAttribute('data-replaced');
        this.parentMenu?.requestUpdate();
        return outcome;
    }
    submenuKeyDown = (event) => {
        if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || !this.open)
            return;
        if (event.composedPath().find(node => node.localName === 'en-menu') !== this)
            return;
        const reverse = this.ownerDocument.defaultView?.getComputedStyle(this).direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
        if (this.parentMenu && event.key === reverse) {
            event.preventDefault();
            this.hide('back');
        }
    };
    constructor() { super(); this.label = ''; this.backLabel = 'Back'; }
    get managesOwnPosition() { return true; }
    get triggerAttributes() { return triggerIsItem(this.trigger) ? {} : { 'aria-haspopup': 'menu', 'aria-expanded': String(this.open) }; }
    syncTriggerAttributes() {
        if (!triggerIsItem(this.trigger)) {
            super.syncTriggerAttributes();
            return;
        }
        if (this.changingOpen)
            return;
        const item = this.trigger;
        // A selective registration bundle can define menus before menu items.
        // Do not create expando properties or assume a reactive update promise.
        if (!('updateComplete' in item)) {
            void elementRegistry(item)?.whenDefined('en-menu-item').then(() => { if (this.isConnected && this.trigger === item)
                this.syncTriggerAttributes(); });
            return;
        }
        // Hydrate the exact SSR branch before adding a client-bound submenu indicator.
        if (!item.hasUpdated) {
            void item.updateComplete.then(() => { if (this.isConnected && this.trigger === item)
                this.syncTriggerAttributes(); });
            return;
        }
        item.menuHasPopup = 'menu';
        item.menuExpanded = String(this.open);
        if (this.itemTriggerState)
            this.itemTriggerState.writtenExpanded = item.menuExpanded;
    }
    returnsFocus(reason) { return reason !== 'outside' && reason !== 'tab' && reason !== 'hover'; }
    openerFor(active, fromTrigger) {
        // Hover may present a child before its trigger is clicked or keyboard focus
        // enters it. Leaving that level still returns to its original parent item.
        return this.parentMenu ? this.trigger : super.openerFor(active, fromTrigger);
    }
    focusSurface() { if (this.openingFromHover)
        return; this.needsFocus = true; this.entryFocus = this.activeElement; }
    position = () => { this.placementController.sync(); };
    triggerClick = (event) => {
        if (!admitOverlayClick(event, eligibleOverlayTrigger(this, this.for, this.trigger)))
            return;
        this.entry = 'first';
        if (!this.open)
            this.layoutVetoRevision = undefined;
        if (!this.trigger?.isConnected || this.trigger.disabled || this.trigger.loading || this.trigger.matches(':disabled,[aria-disabled="true"]'))
            return;
        if (this.open && triggerIsItem(this.trigger)) {
            // A pointer may already have opened this branch on hover before click.
            // Activation enters that branch instead of unexpectedly toggling it shut.
            if (this.shown) {
                const item = this.focusItems.find(item => this.available(item));
                if (item)
                    this.roving.setCurrent(item, { focus: true });
            }
            else {
                this.needsFocus = true;
                this.entryFocus = this.activeElement;
            }
        }
        else if (this.open)
            this.hide('trigger');
        else
            this.show('trigger');
    };
    connectTrigger(trigger) {
        if (triggerIsItem(trigger)) {
            const item = trigger;
            this.itemTriggerState = { item, popup: item.menuHasPopup, expanded: item.menuExpanded, writtenExpanded: String(this.open) };
        }
        super.connectTrigger(trigger);
        trigger.addEventListener('keydown', this.triggerKeyDown);
    }
    disconnectTrigger(trigger) {
        super.disconnectTrigger(trigger);
        trigger.removeEventListener('keydown', this.triggerKeyDown);
        const state = this.itemTriggerState;
        if (state?.item === trigger) {
            if (state.item.menuHasPopup === 'menu')
                state.item.menuHasPopup = state.popup;
            if (state.item.menuExpanded === state.writtenExpanded)
                state.item.menuExpanded = state.expanded;
            this.itemTriggerState = undefined;
        }
    }
    triggerKeyDown = (event) => {
        if (event.defaultPrevented || event.isComposing)
            return;
        if (event.key === 'Tab' && this.open) {
            this.closeForTab(event);
            return;
        }
        if (triggerIsItem(this.trigger)) {
            const forward = this.ownerDocument.defaultView?.getComputedStyle(this).direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
            if (event.key !== forward || event.altKey || event.ctrlKey || event.metaKey)
                return;
            if (this.trigger?.disabled)
                return;
            event.preventDefault();
            this.entry = 'first';
            if (this.open && this.shown) {
                const item = this.items.find(item => this.available(item));
                if (item)
                    this.roving.setCurrent(item, { focus: true });
            }
            else
                this.show('trigger');
            return;
        }
        if (event.altKey || event.ctrlKey || event.metaKey || !['ArrowDown', 'ArrowUp'].includes(event.key))
            return;
        if (this.trigger?.disabled || this.trigger?.loading || this.trigger?.matches(':disabled,[aria-disabled="true"]'))
            return;
        event.preventDefault();
        this.entry = event.key === 'ArrowUp' ? 'last' : 'first';
        if (this.open && this.shown) {
            const candidates = this.items.filter(item => this.available(item));
            const item = this.entry === 'last' ? candidates.at(-1) : candidates[0];
            if (item)
                this.roving.setCurrent(item, { focus: true });
        }
        else {
            this.layoutVetoRevision = undefined;
            this.show('trigger');
        }
    };
    closeForTab(event) {
        if (this.parentMenu) {
            let root = this.parentMenu;
            while (root.parentMenu)
                root = root.parentMenu;
            root.closeForTab(event);
            event.stopPropagation();
            return;
        }
        const active = this.activeElement;
        const trigger = this.trigger;
        const ownsFocus = active !== null && event.composedPath().includes(active);
        const outcome = this.hide('tab');
        if (outcome !== 'committed' || this.open || !ownsFocus
            || this.activeElement !== active || this.trigger !== trigger)
            return;
        // The external trigger and menu need not be adjacent in authored DOM.
        // Close synchronously, then let native forward Tab start at the trigger.
        // Consumer cancellation, authoritative writes and focus redirects win.
        this.syncPopover();
        restoreFocus(trigger);
        if (event.shiftKey && trigger && (this.activeElement === trigger
            || this.activeElement === trigger.shadowRoot?.activeElement))
            event.preventDefault();
    }
    connectedCallback() {
        super.connectedCallback();
        this.addEventListener('keydown', this.submenuKeyDown);
        this.addEventListener('pointermove', this.pointerMove);
        this.addEventListener('pointerover', this.pointerOver);
        this.addEventListener('pointerdown', this.pointerDown);
        this.addEventListener('pointerout', this.pointerOut);
        const Observer = this.ownerDocument.defaultView?.MutationObserver;
        if (Observer) {
            this.mutation = new Observer(() => this.readChildren());
            this.mutation.observe(this, { childList: true, subtree: true, attributes: true, attributeFilter: ['slot', 'hidden', 'inert', 'disabled', 'action', 'type', 'name', 'checked', 'for', 'id'] });
        }
    }
    disconnectedCallback() {
        const previousParent = this.presentationParent, previousTrigger = this.presentationTrigger;
        const recover = this.open && this.replacementMode && this.ownerDocument.activeElement === this.ownerDocument.body;
        previousParent?.surface?.removeAttribute('data-replaced');
        previousParent?.requestUpdate();
        if (recover && previousParent?.open)
            restoreFocus(previousTrigger);
        this.presentationParent = null;
        this.presentationTrigger = null;
        this.removeEventListener('keydown', this.submenuKeyDown);
        this.removeEventListener('pointermove', this.pointerMove);
        this.removeEventListener('pointerover', this.pointerOver);
        this.removeEventListener('pointerdown', this.pointerDown);
        this.removeEventListener('pointerout', this.pointerOut);
        this.clearHover();
        this.mutation?.disconnect();
        this.mutation = undefined;
        for (const release of this.releases.values())
            release();
        this.releases.clear();
        this.items = [];
        this.needsFocus = false;
        this.entryFocus = null;
        this.shown = false;
        this.layoutVetoRevision = undefined;
        super.disconnectedCallback();
    }
    updated(changes) {
        if (this.open && !this.presentationOpen) {
            this.readPresentationMode();
            this.requestUpdate();
        }
        this.presentationOpen = this.open;
        this.readChildren();
        super.updated(changes);
        if (!this.open) {
            for (const child of this.childMenus)
                if (child.open) {
                    child.open = false;
                    child.syncPopover();
                }
            this.shown = false;
            this.needsFocus = false;
            this.entryFocus = null;
            this.layoutVetoRevision = undefined;
        }
        this.parentMenu?.requestUpdate();
        this.placementController.sync();
    }
    available(item) {
        if (!item.isConnected || !item.getClientRects().length)
            return false;
        let node = item;
        while (node) {
            if (node instanceof this.ownerDocument.defaultView.HTMLElement && (node.hidden || node.inert))
                return false;
            node = ('assignedSlot' in node && node.assignedSlot) || node.parentNode || ('host' in node ? node.host : null);
        }
        return this.ownerDocument.defaultView?.getComputedStyle(item).visibility !== 'hidden';
    }
    readChildren = () => {
        const slot = this.renderRoot?.querySelector('slot:not([name])');
        for (const item of slot?.assignedElements() ?? []) {
            if (item.localName !== 'en-menu-item' || 'action' in item)
                continue;
            const registry = elementRegistry(item);
            if (!registry || this.observedRegistries.has(registry))
                continue;
            this.observedRegistries.add(registry);
            void registry.whenDefined('en-menu-item').then(() => { if (this.isConnected)
                this.readChildren(); });
        }
        const next = (slot?.assignedElements() ?? []).filter((item) => item.localName === 'en-menu-item' && 'action' in item);
        for (const [item, release] of this.releases)
            if (!next.includes(item)) {
                release();
                this.releases.delete(item);
            }
        const added = next.filter(item => !this.releases.has(item));
        this.items = next;
        for (const item of next)
            if (!this.releases.has(item))
                this.releases.set(item, ownMenuItem(item, this.owner));
        for (const item of added)
            if (item.type === 'radio' && item.checked)
                this.owner.radioSelected(item);
        for (const child of this.childMenus)
            if (child.open && (!child.trigger?.isConnected || !next.includes(child.trigger) || child.trigger.disabled || child.trigger.hidden || child.trigger.inert)) {
                child.open = false;
                child.syncPopover();
            }
        this.surface?.toggleAttribute('data-replaced', this.childMenus.some(menu => menu.open && menu.replacementMode && menu.shown));
        this.roving.refresh();
        this.placementController.sync();
    };
    revealCurrent() {
        const item = this.roving.current, surface = this.surface;
        if (!this.shown || !item || !surface)
            return;
        const bounds = surface.getBoundingClientRect(), row = item.getBoundingClientRect();
        if (row.top < bounds.top)
            surface.scrollTop -= bounds.top - row.top;
        else if (row.bottom > bounds.bottom)
            surface.scrollTop += row.bottom - bounds.bottom;
    }
    readPresentationMode() {
        const parent = this.parentMenu;
        this.presentationParent = parent;
        this.presentationTrigger = this.trigger;
        this.touchPresentation = Boolean(parent && (parent.lastPointerType ? parent.lastPointerType === 'touch' : parent.touchPresentation || this.ownerDocument.defaultView?.matchMedia('(hover: none), (pointer: coarse)').matches));
        const view = this.ownerDocument.defaultView;
        const gap = parent?.surface && view ? parseFloat(view.getComputedStyle(parent.surface).rowGap) || 0 : 0;
        this.adaptPresentation(view?.visualViewport?.width ?? view?.innerWidth ?? 0, gap);
    }
    adaptPresentation(viewportWidth, gap) {
        const parent = this.parentMenu;
        // Reserve room for two panels at the parent's themed width. Measuring the
        // replacement child's forced width would otherwise feed back into the
        // breakpoint as its own presentation changes. A half-pixel tolerance keeps
        // subpixel viewport/layout rounding from making the boundary unstable.
        const parentWidth = parent?.surface?.getBoundingClientRect().width ?? 0;
        const replacement = Boolean(parent && (this.touchPresentation || viewportWidth + 0.5 < parentWidth * 2 + gap));
        if (replacement === this.replacementMode)
            return false;
        const back = this.renderRoot?.querySelector('.en-menu-back');
        const removingFocusedBack = !replacement && back === this.activeElement;
        const replacingFocusedParent = replacement && parent?.focusItems.some(item => item.matches(':focus-within'));
        this.replacementMode = replacement;
        // A resize changes presentation only. Preserve the current child command;
        // recover focus only when the old parent or Back control will disappear.
        if (this.open && this.shown && (removingFocusedBack || replacingFocusedParent)) {
            const first = this.items.find(item => this.available(item));
            if (first)
                this.roving.setCurrent(first, { focus: true });
            else
                this.surface?.focus({ preventScroll: true });
        }
        this.requestUpdate();
        parent?.requestUpdate();
        return true;
    }
    get focusItems() {
        const back = this.renderRoot?.querySelector('.en-menu-back');
        return back && this.replacementMode && this.parentMenu ? [back, ...this.items] : this.items;
    }
    back = () => { this.hide('back'); };
    pointerDown = (event) => {
        if (event.composedPath().find(node => node.localName === 'en-menu') !== this)
            return;
        this.lastPointerType = event.pointerType;
    };
    clearHover() { if (this.hoverTimer)
        clearTimeout(this.hoverTimer); this.hoverTimer = undefined; this.pendingHover = undefined; }
    pointerMove = (event) => {
        if (event.pointerType !== 'mouse')
            return;
        this.lastPointerType = 'mouse';
        this.pointerPoint = { x: event.clientX, y: event.clientY };
        const item = event.composedPath().find(node => this.items.includes(node));
        const branch = this.childMenus.find(menu => menu.open);
        if (item && branch?.trigger === item)
            this.pointerOrigin = this.pointerPoint;
        if (this.pendingHover && !this.inSafeTriangle())
            this.activateHover(this.pendingHover);
    };
    inSafeTriangle() {
        const branch = this.childMenus.find(menu => menu.open), origin = this.pointerOrigin, point = this.pointerPoint;
        const rect = branch?.surface?.getBoundingClientRect();
        if (!rect || !origin || !point)
            return false;
        if (point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom)
            return true;
        const edge = Math.abs(origin.x - rect.left) < Math.abs(origin.x - rect.right) ? rect.left : rect.right;
        const a = { x: edge, y: rect.top - 8 }, b = { x: edge, y: rect.bottom + 8 };
        const cross = (p, q, r) => (p.x - r.x) * (q.y - r.y) - (q.x - r.x) * (p.y - r.y);
        const d1 = cross(point, origin, a), d2 = cross(point, a, b), d3 = cross(point, b, origin);
        return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
    }
    pointerOut = (event) => {
        const next = event.relatedTarget;
        if (!(next instanceof Node) || !this.contains(next))
            this.clearHover();
    };
    pointerOver = (event) => {
        if (event.pointerType !== 'mouse' || !this.open || !this.shown)
            return;
        if (event.composedPath().find(node => node.localName === 'en-menu') !== this) {
            this.clearHover();
            return;
        }
        const item = event.composedPath().find(node => this.items.includes(node));
        if (!item)
            return;
        if (event.relatedTarget instanceof Node && (item === event.relatedTarget || item.contains(event.relatedTarget)))
            return;
        this.pointerPoint = { x: event.clientX, y: event.clientY };
        const branch = this.childMenus.find(menu => menu.open);
        if (branch?.trigger === item) {
            this.clearHover();
            this.pointerOrigin = this.pointerPoint;
            return;
        }
        this.clearHover();
        if (branch && this.inSafeTriangle()) {
            this.pendingHover = item;
            this.hoverTimer = setTimeout(() => { if (this.pendingHover)
                this.activateHover(this.pendingHover); }, 350);
        }
        else
            this.activateHover(item);
    };
    activateHover(item) {
        this.clearHover();
        if (!this.open || !this.shown || !this.items.includes(item))
            return;
        const next = this.childMenus.find(menu => menu.trigger === item);
        for (const child of this.childMenus)
            if (child !== next && child.open) {
                child.hide('hover');
                if (child.open)
                    return;
            }
        if (next && !item.disabled) {
            next.readPresentationMode();
            // Replacing a panel hides its parent choices. Require explicit activation
            // rather than turning ordinary mouse travel into a new navigation level.
            if (next.replacementMode)
                return;
            next.openingFromHover = true;
            next.show('hover');
            // Native presentation runs during Lit update; retain the no-focus mode
            // until that opening has crossed its initial update boundary.
            void next.updateComplete.then(() => { next.openingFromHover = false; });
            this.pointerOrigin = this.pointerPoint;
        }
    }
    render() {
        return menuTemplate({ label: this.label, backLabel: this.backLabel, back: this.back,
            replacement: this.replacementMode && this.parentMenu !== null,
            replaced: this.childMenus.some(menu => menu.open && menu.replacementMode && menu.shown),
            nativeToggle: this.nativeToggle, childrenChanged: this.readChildren });
    }
}
function triggerIsItem(trigger) { return trigger?.localName === 'en-menu-item'; }

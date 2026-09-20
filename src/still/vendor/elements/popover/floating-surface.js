import { admitOverlayClick, eligibleOverlayTrigger } from '../internal/overlay-trigger.js';
import { setNativeSurfaceOpen } from '../internal/native-surface.js';
import { EnElement } from '../internal/en-element.js';
import { dispatchChange } from '../../primitives/interactions/events.js';
import { foundationStyles } from '../../styles/foundations.js';
import { overlayStyles } from '../../styles/overlays.js';
import { focusedElement, restoreFocus } from '../dialog/focus.js';
import { observeIdReference, referenceRoot } from '../internal/id-reference.js';
const triggerSurfaces = new WeakMap();
/** Includes slotted content and the private controls inside nested shadow roots. */
function composedContains(container, node) {
    while (node) {
        if (node === container)
            return true;
        node = ('assignedSlot' in node && node.assignedSlot)
            || node.parentNode || ('host' in node ? node.host : null);
    }
    return false;
}
/** Shared native floating-surface lifecycle; not registered as a custom element. */
export class FloatingSurface extends EnElement {
    static properties = {
        open: { type: Boolean, reflect: true, noAccessor: true },
        for: { type: String, reflect: true },
    };
    static styles = [foundationStyles, overlayStyles];
    #open = false;
    #revision = 0;
    #openRevision = 0;
    #changeDepth = 0;
    #nativeShown = false;
    #trigger = null;
    #triggerOriginal = {};
    #triggerWritten = {};
    #referenceRoot = null;
    #referenceId = '';
    #releaseReference = null;
    #listeners = null;
    #opener = null;
    #closeReason = 'programmatic';
    #frame = 0;
    #resizeObserver = null;
    #openedFromTrigger = false;
    /** Open state, including a tentative value during en-change. Author writes are silent. */
    get open() { return this.#open; }
    set open(value) {
        const previous = this.#open;
        this.#open = Boolean(value);
        this.#revision++;
        this.#openRevision++;
        if (this.#open) {
            this.#closeReason = 'programmatic';
            if (!this.surface?.matches(':popover-open'))
                this.#nativeShown = false;
        }
        else
            this.#openedFromTrigger = false;
        this.requestUpdate('open', previous);
    }
    constructor() {
        super();
        this.for = '';
    }
    show(reason = 'programmatic') {
        return this.requestOpen(true, reason);
    }
    hide(reason = 'programmatic') { return this.requestOpen(false, reason); }
    requestOpen(proposed, reason) {
        if (proposed === this.open)
            return 'unchanged';
        const trigger = this.trigger, id = this.for;
        const previous = this.open;
        const previousNativeShown = this.#nativeShown;
        const previousCloseReason = this.#closeReason;
        const previousOpenedFromTrigger = this.#openedFromTrigger;
        this.#changeDepth++;
        try {
            return dispatchChange(this, {
                previous, proposed, reason,
                getRevision: () => this.#revision,
                canCommit: () => reason !== 'trigger' || (this.for === id && eligibleOverlayTrigger(this, id, trigger)),
                stage: value => {
                    this.#open = value;
                    if (value) {
                        this.#openedFromTrigger = reason === 'trigger';
                        if (!this.surface?.matches(':popover-open'))
                            this.#nativeShown = false;
                    }
                    else
                        this.#closeReason = reason;
                },
                rollback: value => {
                    this.#open = value;
                    this.#nativeShown = previousNativeShown;
                    this.#closeReason = previousCloseReason;
                    this.#openedFromTrigger = previousOpenedFromTrigger;
                    this.requestUpdate('open', proposed);
                },
                commit: () => { this.#openRevision++; this.requestUpdate('open', previous); },
            });
        }
        finally {
            this.#changeDepth--;
            // Do not move focus or enter/leave the native top layer while tentative.
            if (!this.#changeDepth)
                this.requestUpdate('open', previous);
        }
    }
    get surface() { return this.renderRoot?.querySelector('[popover]') ?? null; }
    get trigger() { return this.#trigger; }
    get movesFocus() { return true; }
    /** Author writes and accepted nested open transitions invalidate deferred action defaults. */
    get openRevision() { return this.#openRevision; }
    get changingOpen() { return this.#changeDepth > 0; }
    get presentedOpen() { return this.#changeDepth ? this.#nativeShown : this.open; }
    get managesOwnPosition() { return false; }
    focusSurface() { this.surface?.focus({ preventScroll: true }); }
    returnsFocus(reason) { return reason !== 'outside'; }
    /** Snapshot the return target when presentation opens, including non-click entry. */
    openerFor(active, fromTrigger) {
        return fromTrigger ? this.trigger : active && 'focus' in active ? active : null;
    }
    get activeElement() {
        let active = referenceRoot(this)?.activeElement ?? focusedElement(this.ownerDocument);
        while (active?.shadowRoot?.activeElement)
            active = active.shadowRoot.activeElement;
        return active;
    }
    /** A tooltip sharing a trigger must not consume Escape before its interactive popover. */
    get hasOpenPopoverForTrigger() {
        const surfaces = this.trigger && triggerSurfaces.get(this.trigger);
        return Boolean(surfaces && [...surfaces].some(surface => surface !== this && surface.movesFocus
            && surface.open && surface.surface?.matches(':popover-open')));
    }
    triggerChanged() { }
    get triggerAttributes() {
        return { 'aria-haspopup': 'dialog', 'aria-expanded': String(this.open) };
    }
    connectedCallback() {
        super.connectedCallback();
        this.updateComplete.then(() => {
            if (!this.isConnected)
                return;
            this.observeTrigger();
            this.syncPopover();
        });
    }
    disconnectedCallback() {
        this.#releaseReference?.();
        this.#releaseReference = null;
        this.#referenceRoot = null;
        this.#referenceId = '';
        this.stopListening();
        this.detachTrigger();
        const surface = this.surface;
        this.#nativeShown = false;
        if (surface?.matches(':popover-open'))
            surface.hidePopover();
        this.#opener = null;
        this.#openedFromTrigger = false;
        super.disconnectedCallback();
    }
    updated(_changes) {
        this.observeTrigger();
        this.syncTriggerAttributes();
        this.syncPopover();
    }
    triggerClick = (event) => {
        if (!admitOverlayClick(event, eligibleOverlayTrigger(this, this.for, this.trigger)))
            return;
        if (this.open)
            this.hide('trigger');
        else
            this.show('trigger');
    };
    connectTrigger(trigger) {
        trigger.addEventListener('click', this.triggerClick);
    }
    disconnectTrigger(trigger) {
        trigger.removeEventListener('click', this.triggerClick);
    }
    observeTrigger() {
        if (!this.isConnected)
            return;
        const root = referenceRoot(this);
        const id = typeof this.for === 'string' ? this.for : '';
        if (this.#releaseReference && root === this.#referenceRoot && id === this.#referenceId)
            return;
        this.#releaseReference?.();
        this.#releaseReference = null;
        this.#referenceRoot = root;
        this.#referenceId = id;
        const release = observeIdReference(root, id, this.acceptTrigger);
        // Initial binding can emit a tooltip request whose consumer disconnects/rebinds us.
        if (!this.isConnected || referenceRoot(this) !== root || this.for !== id)
            release();
        else
            this.#releaseReference = release;
    }
    /** Specialized surfaces may accept additional encapsulated trigger components. */
    acceptsTrigger(element) {
        return element.namespaceURI === 'http://www.w3.org/1999/xhtml'
            && (element.localName === 'button' || element.localName === 'en-button');
    }
    acceptTrigger = (element) => {
        if (!this.isConnected)
            return;
        const trigger = element && this.acceptsTrigger(element) ? element : null;
        if (trigger === this.#trigger)
            return;
        this.stopListening();
        this.detachTrigger();
        this.#trigger = trigger;
        if (trigger) {
            this.#triggerOriginal = Object.fromEntries(Object.keys(this.triggerAttributes).map(name => [name, trigger.getAttribute(name)]));
            let surfaces = triggerSurfaces.get(trigger);
            if (!surfaces)
                triggerSurfaces.set(trigger, surfaces = new Set());
            surfaces.add(this);
            this.connectTrigger(trigger);
            this.syncTriggerAttributes();
        }
        // A visible surface stays usable when its anchor disappears; no state proposal is synthesized.
        if (this.surface?.matches(':popover-open')) {
            this.position();
            this.startListening();
        }
        this.syncPopover();
        this.triggerChanged();
    };
    detachTrigger() {
        const trigger = this.#trigger;
        if (!trigger)
            return;
        this.disconnectTrigger(trigger);
        const surfaces = triggerSurfaces.get(trigger);
        surfaces?.delete(this);
        if (!surfaces?.size)
            triggerSurfaces.delete(trigger);
        for (const [name, value] of Object.entries(this.#triggerOriginal)) {
            if (trigger.getAttribute(name) !== this.#triggerWritten[name])
                continue;
            if (value === null)
                trigger.removeAttribute(name);
            else
                trigger.setAttribute(name, value);
        }
        this.#triggerOriginal = {};
        this.#triggerWritten = {};
        this.#trigger = null;
    }
    syncTriggerAttributes() {
        const trigger = this.#trigger;
        if (!trigger || this.#changeDepth)
            return;
        for (const [name, value] of Object.entries(this.triggerAttributes)) {
            if (trigger.getAttribute(name) !== value)
                trigger.setAttribute(name, value);
            this.#triggerWritten[name] = value;
        }
    }
    syncPopover() {
        const surface = this.surface;
        if (!surface || !this.isConnected || this.#changeDepth)
            return;
        const shown = surface.matches(':popover-open');
        if (this.#nativeShown && !shown) {
            this.reconcileNativeHide();
            return;
        }
        if (this.open && !shown && this.trigger?.isConnected) {
            const active = this.activeElement;
            this.#opener = this.openerFor(active, this.#openedFromTrigger);
            this.#openedFromTrigger = false;
            if (this.movesFocus)
                setNativeSurfaceOpen(surface, true);
            surface.showPopover();
            this.#nativeShown = true;
            this.position();
            this.startListening();
            if (this.movesFocus)
                this.focusSurface();
        }
        else if (!this.open && shown) {
            const active = this.activeElement;
            const focusInside = composedContains(surface, active);
            this.#nativeShown = false;
            surface.hidePopover();
            if (this.movesFocus)
                setNativeSurfaceOpen(surface, false);
            this.stopListening();
            if (this.movesFocus && focusInside && this.returnsFocus(this.#closeReason))
                restoreFocus(this.#opener);
            this.#opener = null;
            this.#closeReason = 'programmatic';
        }
        if (!this.open)
            this.#openedFromTrigger = false;
    }
    /** Native toggle is terminal; an external hide cannot be canceled afterward. */
    nativeToggle = (event) => {
        if (event.newState !== 'closed' || !this.isConnected || !this.#nativeShown
            || this.surface?.matches(':popover-open'))
            return;
        this.reconcileNativeHide();
    };
    reconcileNativeHide() {
        this.#nativeShown = false;
        if (this.movesFocus && this.surface)
            setNativeSurfaceOpen(this.surface, false);
        this.open = false;
        this.stopListening();
        this.#opener = null;
        this.#closeReason = 'programmatic';
    }
    position = () => {
        const surface = this.surface;
        const trigger = this.trigger;
        const view = this.ownerDocument.defaultView;
        if (!surface || !trigger?.isConnected || !view || !this.open)
            return;
        const anchor = trigger.getBoundingClientRect();
        const width = this.ownerDocument.documentElement.clientWidth;
        const height = this.ownerDocument.documentElement.clientHeight;
        const bounds = surface.getBoundingClientRect();
        // Gap follows the inherited spacing token; geometry is not a fixed visual scale.
        const gap = parseFloat(view.getComputedStyle(surface).rowGap) || 0;
        const rtl = view.getComputedStyle(this).direction === 'rtl';
        const preferredLeft = rtl ? anchor.right - bounds.width : anchor.left;
        const left = Math.max(gap, Math.min(preferredLeft, width - bounds.width - gap));
        const below = anchor.bottom + gap;
        const top = below + bounds.height <= height - gap ? below : Math.max(gap, anchor.top - bounds.height - gap);
        surface.style.left = `${left}px`;
        surface.style.top = `${top}px`;
        surface.style.right = 'auto';
        surface.style.bottom = 'auto';
    };
    #schedulePosition = () => {
        const view = this.ownerDocument.defaultView;
        if (!view || this.#frame)
            return;
        this.#frame = view.requestAnimationFrame(() => { this.#frame = 0; this.position(); });
    };
    #keyDown = (event) => {
        if (event.key !== 'Escape' || event.defaultPrevented || !this.open
            || (!this.movesFocus && this.hasOpenPopoverForTrigger))
            return;
        event.preventDefault();
        this.hide('escape');
    };
    #outside = (event) => {
        const path = event.composedPath();
        if (!path.includes(this) && (!this.trigger || !path.includes(this.trigger)))
            this.hide('outside');
    };
    #outsideDocument = (event) => {
        const root = referenceRoot(this);
        // Inside a closed shadow root only its own listener receives the full composed path.
        if (root && root !== this.ownerDocument && event.composedPath().includes(root.host))
            return;
        this.#outside(event);
    };
    startListening() {
        this.stopListening();
        this.#listeners = new AbortController();
        const options = { signal: this.#listeners.signal };
        // Bubble phase lets an inner control handle Escape before the enclosing overlay.
        this.addEventListener('keydown', this.#keyDown, options);
        this.trigger?.addEventListener('keydown', this.#keyDown, options);
        const root = referenceRoot(this);
        if (root && root !== this.ownerDocument)
            root.addEventListener('pointerdown', this.#outside, { ...options, capture: true });
        this.ownerDocument.addEventListener('pointerdown', this.#outsideDocument, { ...options, capture: true });
        if (!this.managesOwnPosition) {
            this.ownerDocument.addEventListener('scroll', this.#schedulePosition, { ...options, capture: true, passive: true });
            this.ownerDocument.defaultView?.addEventListener('resize', this.#schedulePosition, options);
            this.ownerDocument.defaultView?.visualViewport?.addEventListener('resize', this.#schedulePosition, options);
            this.ownerDocument.defaultView?.visualViewport?.addEventListener('scroll', this.#schedulePosition, options);
            const ResizeObserverConstructor = this.ownerDocument.defaultView?.ResizeObserver;
            if (ResizeObserverConstructor) {
                this.#resizeObserver = new ResizeObserverConstructor(this.#schedulePosition);
                if (this.surface)
                    this.#resizeObserver.observe(this.surface);
                if (this.trigger)
                    this.#resizeObserver.observe(this.trigger);
            }
        }
    }
    stopListening() {
        this.#listeners?.abort();
        this.#listeners = null;
        this.#resizeObserver?.disconnect();
        this.#resizeObserver = null;
        if (this.#frame)
            this.ownerDocument.defaultView?.cancelAnimationFrame(this.#frame);
        this.#frame = 0;
    }
}

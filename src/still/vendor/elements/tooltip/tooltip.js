import { observeIdReference, referenceRoot } from '../internal/id-reference.js';
import { tooltipWarmupGroup } from './warmup-group.js';
import { FloatingSurface } from '../popover/floating-surface.js';
import { tooltipTemplate } from './template.js';
import { distanceToBounds, inHoverCorridor } from './hover-corridor.js';
let nextTooltipId = 0;
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
 * @csspart surface - Hoverable tooltip surface in the native top layer.
 * @fires en-change - Cancelable tentative open state: {previous, proposed, reason}.
 * @cssprop --en-overlay-background - Tooltip background.
 * @cssprop --en-overlay-color - Tooltip foreground.
 * @cssprop --en-overlay-padding - Tooltip padding.
 * @cssprop --en-overlay-radius - Tooltip corner radius.
 * @cssprop --en-duration-enter - Optional tooltip fade-in duration; hover timing and focus behavior are unchanged.
 * @cssprop --en-duration-exit - Optional tooltip fade-out duration; native dismissal remains immediate.
 * @cssprop --en-ease-enter - Tooltip fade-in easing.
 * @cssprop --en-ease-exit - Tooltip fade-out easing.
 */
export class EnTooltip extends FloatingSurface {
    static properties = {
        ...FloatingSurface.properties,
        warmupGroup: { type: String, attribute: 'warmup-group' },
        showDelay: { type: Number, attribute: 'show-delay' },
        hideDelay: { type: Number, attribute: 'hide-delay' },
        transitDuration: { type: Number, attribute: 'transit-duration' },
    };
    #group = null;
    #groupElement = null;
    #groupRoot = null;
    #groupId = '';
    #groupReference = null;
    #groupObserver = null;
    #groupObservedElement = null;
    #groupObservedTrigger = null;
    #groupTrigger = null;
    #groupAncestry = [];
    #groupEligible = false;
    #groupGeneration = 0;
    #pointerOpenRevision = null;
    #pendingWarm = null;
    #content = null;
    #contentRole = null;
    #generatedId = null;
    #descriptionTrigger = null;
    #descriptionId = null;
    #descriptionAdded = false;
    #descriptionObserver = null;
    #triggerHovered = false;
    #surfaceHovered = false;
    #focused = false;
    #focusDismissals = new Map();
    #blockedHover = false;
    #hoverDismissed = false;
    #showTimer;
    #hideTimer;
    #hoverEscapeListener = null;
    #transit = null;
    #transitListener = null;
    #transitTimer;
    #lastTriggerPoint = null;
    #lastSurfacePoint = null;
    constructor() {
        super();
        this.warmupGroup = '';
        this.showDelay = 300;
        this.hideDelay = 150;
        this.transitDuration = 1000;
    }
    get movesFocus() { return false; }
    get triggerAttributes() { return {}; }
    startListening() {
        super.startListening();
        this.#hoverEscapeListener = new AbortController();
        this.ownerDocument.addEventListener('keydown', this.#hoverEscape, { signal: this.#hoverEscapeListener.signal });
    }
    stopListening() {
        super.stopListening();
        this.#hoverEscapeListener?.abort();
        this.#hoverEscapeListener = null;
        this.clearTransit();
    }
    #hoverEscape = (event) => {
        if (event.key !== 'Escape' || event.defaultPrevented || !this.open
            || event.composedPath().includes(this) || this.hasOpenPopoverForTrigger)
            return;
        // A canceled orphan remains visible and must retain its Escape exit.
        if (this.trigger && !this.#triggerHovered && !this.#surfaceHovered && !this.#transit)
            return;
        event.preventDefault();
        this.hide('escape');
    };
    show(reason = 'programmatic') {
        this.syncWarmupGroup();
        if (reason === 'hover' && this.#group?.hasFocusedPeer(this)) {
            this.#blockedHover = this.#triggerHovered;
            return 'unchanged';
        }
        const generation = this.#groupGeneration;
        const pointerRequest = this.#triggerHovered;
        const outcome = super.show(reason);
        // Consumer writes, nested changes and rebinding during dispatch cannot warm peers.
        this.syncWarmupGroup();
        if (outcome === 'committed' && reason === 'hover' && pointerRequest && this.#group
            && generation === this.#groupGeneration && this.eligibleTrigger()) {
            this.#pendingWarm = { revision: this.openRevision, generation };
        }
        return outcome;
    }
    syncPopover() {
        this.syncWarmupGroup();
        if (!this.changingOpen && this.#pendingWarm?.revision === this.openRevision
            && this.#group?.hasFocusedPeer(this)) {
            this.#blockedHover = this.#triggerHovered;
            this.#pendingWarm = null;
            this.hide('hover');
        }
        super.syncPopover();
        // Native beforetoggle listeners can rebind or move the trigger synchronously.
        this.syncWarmupGroup();
        this.#group?.focus(this, this.hasFocusedPresentation());
        const pending = this.#pendingWarm;
        if (!pending || this.changingOpen)
            return;
        this.#pendingWarm = null;
        if (this.open && pending.revision === this.openRevision
            && pending.generation === this.#groupGeneration && this.eligibleTrigger()
            && this.surface?.matches(':popover-open')) {
            this.#pointerOpenRevision = pending.revision;
            const group = this.#group;
            group?.markWarm(this, () => {
                this.syncWarmupGroup();
                return this.#group === group && this.open && pending.revision === this.openRevision
                    && pending.generation === this.#groupGeneration && Boolean(this.surface?.matches(':popover-open'));
            });
        }
    }
    eligibleTrigger() {
        const trigger = this.trigger;
        return Boolean(this.isConnected && trigger?.isConnected
            && referenceRoot(this)?.getElementById(this.for) === trigger
            && !trigger.disabled && !trigger.loading
            && !trigger.matches(':disabled, [aria-disabled="true"]'));
    }
    /** Validate synchronously too: mutations can occur before observer delivery or inside en-change. */
    syncWarmupGroup = () => {
        const trigger = this.trigger;
        const root = trigger ? referenceRoot(trigger) : null;
        const id = typeof this.warmupGroup === 'string' ? this.warmupGroup : '';
        if (root !== this.#groupRoot || id !== this.#groupId) {
            this.#groupGeneration++;
            this.#pendingWarm = null;
            this.clearTimers();
            this.#groupReference?.();
            this.#groupReference = null;
            this.#groupRoot = root;
            this.#groupId = id;
            // Shared ID subscription detects late insertion and replacement without document scans.
            this.#groupReference = observeIdReference(root, id, () => this.reconcileWarmupGroup());
        }
        this.reconcileWarmupGroup();
    };
    reconcileWarmupGroup() {
        const trigger = this.trigger;
        const candidate = this.#groupRoot?.getElementById(this.#groupId) ?? null;
        const eligible = this.eligibleTrigger();
        const element = eligible && candidate?.isConnected && candidate.contains(trigger) ? candidate : null;
        const ancestry = [];
        for (let node = trigger; node; node = node.parentNode)
            ancestry.push(node);
        if (element !== this.#groupElement || trigger !== this.#groupTrigger
            || eligible !== this.#groupEligible || ancestry.length !== this.#groupAncestry.length
            || ancestry.some((node, index) => node !== this.#groupAncestry[index])) {
            this.#groupGeneration++;
            this.#pendingWarm = null;
            this.clearTimers();
            this.#group?.leave(this);
            this.#groupElement = element;
            this.#groupTrigger = trigger;
            this.#groupAncestry = ancestry;
            this.#groupEligible = eligible;
            this.#group = element ? tooltipWarmupGroup(element) : null;
            this.#pointerOpenRevision = null;
            const group = this.#group;
            group?.join(this, focus => this.handoffHover(group, focus), () => this.hasFocusedPresentation(), this.resumeHover);
        }
        // An unchanged ID may still have moved outside its group. Observe only the group
        // subtree plus trigger state; the shared root ID observer handles replacements.
        if (candidate !== this.#groupObservedElement || trigger !== this.#groupObservedTrigger) {
            this.#groupObserver?.disconnect();
            const Observer = this.ownerDocument.defaultView?.MutationObserver;
            if (Observer)
                this.#groupObserver ??= new Observer(this.syncWarmupGroup);
            if (candidate)
                this.#groupObserver?.observe(candidate, { childList: true, subtree: true });
            if (trigger)
                this.#groupObserver?.observe(trigger, { attributes: true, attributeFilter: ['disabled', 'loading', 'aria-disabled'] });
            this.#groupObservedElement = candidate;
            this.#groupObservedTrigger = trigger;
        }
        this.updateWarmupActivity();
        this.#group?.focus(this, this.hasFocusedPresentation());
    }
    /** A displayed successor replaces only unattended pointer help, through the normal event contract. */
    hasFocusedPresentation() {
        return Boolean(this.focusKeepsOpen && this.presentedOpen
            && this.eligibleTrigger() && this.trigger?.matches(':focus-within')
            && this.#groupRoot?.getElementById(this.warmupGroup) === this.#groupElement
            && this.#groupElement?.contains(this.trigger) && this.surface?.matches(':popover-open'));
    }
    resumeHover = () => {
        if (!this.#blockedHover)
            return;
        this.#blockedHover = false;
        if (this.isConnected && this.#triggerHovered && !this.#hoverDismissed)
            this.scheduleShow();
    };
    handoffHover(group, focus = false) {
        this.syncWarmupGroup();
        if (this.#group !== group || this.focusKeepsOpen)
            return;
        if (focus) {
            this.#blockedHover = this.#triggerHovered;
            clearTimeout(this.#showTimer);
            this.#showTimer = undefined;
        }
        if (!this.open || (this.#pointerOpenRevision !== this.openRevision
            && this.#pendingWarm?.revision !== this.openRevision)
            || (this.surface?.matches(':popover-open')
                && (this.#triggerHovered || this.#surfaceHovered)))
            return;
        // No delayed second dismissal after an application vetoes this handoff.
        this.clearTimers();
        const outcome = this.hide('hover');
        if (outcome === 'committed')
            this.syncPopover();
    }
    releaseWarmupGroup() {
        this.#groupGeneration++;
        this.#pendingWarm = null;
        this.#groupReference?.();
        this.#groupReference = null;
        this.#groupRoot = null;
        this.#groupId = '';
        this.#groupObserver?.disconnect();
        this.#groupObserver = null;
        this.#groupObservedElement = null;
        this.#groupObservedTrigger = null;
        this.#group?.leave(this);
        this.#group = null;
        this.#groupElement = null;
        this.#pointerOpenRevision = null;
        this.#groupTrigger = null;
        this.#groupAncestry = [];
        this.#groupEligible = false;
    }
    updateWarmupActivity() {
        this.#group?.activity(this, this.#triggerHovered || this.#surfaceHovered || Boolean(this.#transit));
    }
    scheduleShow() {
        this.syncWarmupGroup();
        clearTimeout(this.#showTimer);
        if (!this.eligibleTrigger() || this.#hoverDismissed)
            return;
        if (this.#group?.hasFocusedPeer(this)) {
            this.#blockedHover = this.#triggerHovered;
            return;
        }
        const generation = this.#groupGeneration;
        const delay = this.#group?.warm ? 0 : Math.max(0, this.showDelay);
        this.#showTimer = setTimeout(() => {
            this.#showTimer = undefined;
            this.syncWarmupGroup();
            if (generation === this.#groupGeneration && this.eligibleTrigger()
                && this.#triggerHovered && !this.#hoverDismissed)
                this.show('hover');
        }, delay);
    }
    hide(reason = 'programmatic') {
        const outcome = super.hide(reason);
        if (!this.open && outcome !== 'unchanged') {
            this.clearTransit();
            if (reason === 'escape' && outcome === 'committed') {
                this.#group?.cool();
                this.#hoverDismissed = this.#triggerHovered || this.#surfaceHovered;
                const trigger = this.trigger;
                if (trigger?.matches(':focus-within'))
                    this.suppressFocusedInterval(trigger);
                this.clearTimers();
            }
        }
        this.#group?.focus(this, this.hasFocusedPresentation());
        return outcome;
    }
    /** Escape ends help for this focused interval, without moving native focus. */
    suppressFocusedInterval(trigger) {
        if (this.#focusDismissals.has(trigger))
            return;
        const release = () => {
            trigger.removeEventListener('blur', release);
            this.#focusDismissals.delete(trigger);
        };
        this.#focusDismissals.set(trigger, release);
        // Keep the interval through a temporary for rebind, but never beyond blur or teardown.
        trigger.addEventListener('blur', release, { once: true });
    }
    get focusKeepsOpen() {
        return this.#focused && Boolean(this.trigger && !this.#focusDismissals.has(this.trigger));
    }
    connectTrigger(trigger) {
        trigger.addEventListener('pointerenter', this.#triggerEnter);
        trigger.addEventListener('pointerleave', this.#triggerLeave);
        trigger.addEventListener('pointermove', this.#trackTrigger);
        trigger.addEventListener('focus', this.#focus);
        trigger.addEventListener('blur', this.#blur);
        this.readContent();
    }
    disconnectTrigger(trigger) {
        // Removing a focused native control can end focus without dispatching blur.
        if (!trigger.matches(':focus-within'))
            this.#focusDismissals.get(trigger)?.();
        trigger.removeEventListener('pointerenter', this.#triggerEnter);
        trigger.removeEventListener('pointerleave', this.#triggerLeave);
        trigger.removeEventListener('pointermove', this.#trackTrigger);
        trigger.removeEventListener('focus', this.#focus);
        trigger.removeEventListener('blur', this.#blur);
        this.releaseWarmupGroup();
        this.clearDescription();
        this.#descriptionObserver?.disconnect();
        this.#triggerHovered = false;
        this.#blockedHover = false;
        this.#surfaceHovered = false;
        this.#focused = false;
        this.#hoverDismissed = false;
        this.#lastTriggerPoint = null;
        this.#lastSurfacePoint = null;
        this.clearTimers();
    }
    disconnectedCallback() {
        for (const release of this.#focusDismissals.values())
            release();
        this.releaseWarmupGroup();
        this.#descriptionObserver?.disconnect();
        this.#descriptionObserver = null;
        this.clearTimers();
        this.clearDescription();
        this.clearContent();
        this.#surfaceHovered = false;
        this.#hoverDismissed = false;
        this.#lastSurfacePoint = null;
        super.disconnectedCallback();
    }
    triggerChanged() {
        this.readContent();
        const trigger = this.trigger;
        this.#focused = trigger?.matches(':focus-within') ?? false;
        const hoverAvailable = this.ownerDocument.defaultView?.matchMedia('(any-hover: hover)').matches;
        this.#triggerHovered = Boolean(hoverAvailable && trigger?.matches(':hover'));
        this.#surfaceHovered = Boolean(hoverAvailable && this.surface?.matches(':popover-open:hover'));
        if (this.focusKeepsOpen)
            this.#focus();
        else if (this.#triggerHovered) {
            this.scheduleShow();
        }
        else if (!this.#surfaceHovered && this.open)
            this.#scheduleHide();
    }
    readContent = () => {
        if (!this.isConnected)
            return;
        const slot = this.renderRoot.querySelector('slot[name="content"]');
        const assigned = slot?.assignedElements({ flatten: true }) ?? [];
        const candidate = assigned[0];
        const content = candidate && 'style' in candidate ? candidate : null;
        if (content !== this.#content) {
            this.clearDescription();
            this.clearContent();
            this.#content = content;
            if (content) {
                this.#contentRole = content.getAttribute('role');
                content.setAttribute('role', 'tooltip');
            }
        }
        if (content && !content.id) {
            const root = content.getRootNode();
            let id;
            do {
                id = `en-tooltip-${++nextTooltipId}`;
            } while (root.getElementById(id));
            content.id = id;
            this.#generatedId = id;
        }
        const trigger = this.trigger;
        if (!content || !trigger || content.getRootNode() !== trigger.getRootNode()) {
            this.clearDescription();
            this.observeDescription();
            return;
        }
        const current = (trigger.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
        if (this.#descriptionTrigger !== trigger || this.#descriptionId !== content.id || !current.includes(content.id)) {
            this.clearDescription();
            const descriptions = new Set((trigger.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean));
            this.#descriptionAdded = !descriptions.has(content.id);
            descriptions.add(content.id);
            if (this.#descriptionAdded)
                trigger.setAttribute('aria-describedby', [...descriptions].join(' '));
            this.#descriptionTrigger = trigger;
            this.#descriptionId = content.id;
        }
        this.observeDescription();
    };
    /** Observe only the two owned relationship endpoints, never their surrounding document. */
    observeDescription() {
        this.#descriptionObserver?.disconnect();
        const Observer = this.ownerDocument.defaultView?.MutationObserver;
        if (!Observer)
            return;
        this.#descriptionObserver ??= new Observer(() => this.readContent());
        if (this.trigger)
            this.#descriptionObserver.observe(this.trigger, { attributes: true, attributeFilter: ['aria-describedby'] });
        if (this.#content)
            this.#descriptionObserver.observe(this.#content, { attributes: true, attributeFilter: ['id'] });
    }
    clearContent() {
        if (this.#content) {
            if (this.#content.getAttribute('role') === 'tooltip') {
                if (this.#contentRole === null)
                    this.#content.removeAttribute('role');
                else
                    this.#content.setAttribute('role', this.#contentRole);
            }
            if (this.#generatedId && this.#content.id === this.#generatedId)
                this.#content.removeAttribute('id');
        }
        this.#content = null;
        this.#contentRole = null;
        this.#generatedId = null;
    }
    clearDescription() {
        const trigger = this.#descriptionTrigger;
        if (trigger && this.#descriptionId && this.#descriptionAdded) {
            const descriptions = (trigger.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(id => id && id !== this.#descriptionId);
            if (descriptions.length)
                trigger.setAttribute('aria-describedby', descriptions.join(' '));
            else
                trigger.removeAttribute('aria-describedby');
        }
        this.#descriptionTrigger = null;
        this.#descriptionId = null;
        this.#descriptionAdded = false;
    }
    clearTimers() {
        clearTimeout(this.#showTimer);
        clearTimeout(this.#hideTimer);
        this.#showTimer = undefined;
        this.#hideTimer = undefined;
        this.clearTransit();
    }
    clearTransit() {
        clearTimeout(this.#transitTimer);
        this.#transitTimer = undefined;
        this.#transitListener?.abort();
        this.#transitListener = null;
        this.#transit = null;
        this.updateWarmupActivity();
    }
    beginTransit(event, destination, previous) {
        this.clearTransit();
        if (!this.open || this.focusKeepsOpen || this.#hoverDismissed || event.pointerType === 'touch' || !destination)
            return false;
        const bounds = destination.getBoundingClientRect();
        if (!bounds.width || !bounds.height)
            return false;
        const origin = { x: event.clientX, y: event.clientY };
        const distance = distanceToBounds(origin, bounds);
        if (previous && distance > distanceToBounds(previous, bounds) + 4)
            return false;
        const duration = Math.min(5000, Math.max(0, Number.isFinite(this.transitDuration) ? this.transitDuration : 1000));
        if (!duration)
            return false;
        clearTimeout(this.#hideTimer);
        this.#transit = { origin, destination: bounds, bestDistance: distance, pointerId: event.pointerId };
        this.#transitListener = new AbortController();
        const options = { signal: this.#transitListener.signal, passive: true };
        this.ownerDocument.addEventListener('pointermove', this.#transitMove, options);
        this.ownerDocument.addEventListener('scroll', this.#endTransit, { ...options, capture: true });
        this.updateWarmupActivity();
        this.#transitTimer = setTimeout(this.#endTransit, duration);
        return true;
    }
    #transitMove = (event) => {
        const transit = this.#transit;
        if (!transit || event.pointerId !== transit.pointerId)
            return;
        const point = { x: event.clientX, y: event.clientY };
        const distance = distanceToBounds(point, transit.destination);
        if (!inHoverCorridor(point, transit.origin, transit.destination) || distance > transit.bestDistance + 4) {
            this.#endTransit();
            return;
        }
        transit.bestDistance = Math.min(transit.bestDistance, distance);
    };
    #endTransit = () => { this.clearTransit(); this.#scheduleHide(); };
    #trackTrigger = (event) => { this.#lastTriggerPoint = { x: event.clientX, y: event.clientY }; };
    #trackSurface = (event) => { this.#lastSurfacePoint = { x: event.clientX, y: event.clientY }; };
    #triggerEnter = (event) => {
        if (event.pointerType === 'touch' || !this.eligibleTrigger())
            return;
        this.clearTransit();
        this.#trackTrigger(event);
        this.#triggerHovered = true;
        clearTimeout(this.#hideTimer);
        this.scheduleShow();
    };
    #triggerLeave = (event) => {
        this.#triggerHovered = false;
        this.#blockedHover = false;
        this.updateWarmupActivity();
        if (!this.#surfaceHovered)
            this.#hoverDismissed = false;
        clearTimeout(this.#showTimer);
        if (!this.beginTransit(event, this.surface, this.#lastTriggerPoint))
            this.#scheduleHide();
    };
    #surfaceEnter = (event) => {
        if (event.pointerType === 'touch')
            return;
        this.clearTransit();
        this.#trackSurface(event);
        this.#surfaceHovered = true;
        this.syncWarmupGroup();
        clearTimeout(this.#hideTimer);
    };
    #surfaceLeave = (event) => {
        this.#surfaceHovered = false;
        this.updateWarmupActivity();
        if (!this.#triggerHovered)
            this.#hoverDismissed = false;
        if (!this.beginTransit(event, this.trigger, this.#lastSurfacePoint))
            this.#scheduleHide();
    };
    #focus = () => {
        const trigger = this.trigger;
        if (trigger)
            this.#focusDismissals.get(trigger)?.();
        this.#focused = true;
        this.#hoverDismissed = false;
        this.clearTimers();
        this.show('focus');
    };
    #blur = () => {
        const trigger = this.trigger;
        if (trigger)
            this.#focusDismissals.get(trigger)?.();
        this.#focused = false;
        this.#group?.focus(this, false);
        if (!this.#triggerHovered && !this.#surfaceHovered)
            this.#hoverDismissed = false;
        this.#scheduleHide();
    };
    #scheduleHide = () => {
        clearTimeout(this.#hideTimer);
        this.#hideTimer = setTimeout(() => {
            if (this.focusKeepsOpen || this.#triggerHovered || this.#surfaceHovered || this.#transit)
                return;
            this.#hoverDismissed = false;
            if (this.isConnected)
                this.hide('hover');
        }, Math.max(0, this.hideDelay));
    };
    render() {
        return tooltipTemplate({ contentSlotChange: this.readContent, nativeToggle: this.nativeToggle,
            pointerEnter: this.#surfaceEnter, pointerLeave: this.#surfaceLeave, pointerMove: this.#trackSurface });
    }
}

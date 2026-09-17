import { html, css } from 'lit';
import { EnElement } from '../internal/en-element.js';
import { foundationStyles } from '../../styles/foundations.js';
import { toastStyles } from '../../styles/toast.js';
import { toastQueuedAttribute } from '../../primitives/interactions/toast-stack.js';
import { dispatchChange } from '../../primitives/interactions/events.js';
/**
 * A persistent-by-default notification. A containing en-toast-region owns announcements.
 * @tagname en-toast
 * @slot - Message content; communicate status in words, not only color.
 * @slot icon - Decorative status icon; replaces the shared default glyph.
 * @csspart icon - Leading decorative status cue.
 * @slot actions - Application-owned buttons or links. Their presence prevents timeout.
 * @csspart base - Notification surface.
 * @csspart content - Message body.
 * @csspart actions - Action layout.
 * @csspart close - Shared en-button control.
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
export class EnToast extends EnElement {
    static properties = { open: { type: Boolean, reflect: true, noAccessor: true }, variant: { reflect: true }, duration: { type: Number }, dismissLabel: { attribute: 'dismiss-label' }, announcement: {}, priority: {}, interrupt: { type: Boolean, reflect: true }, swipe: { type: Boolean, reflect: true } };
    static styles = [foundationStyles, toastStyles, css `:host { display:contents; min-inline-size:0; } :host([hidden]),:host([data-en-toast-queued]) { display:none !important; }`];
    shown = true;
    revision = 0;
    timer;
    visibilityObserver;
    started = 0;
    remaining = 0;
    timingText = '';
    hovered = false;
    focused = false;
    actionContent = false;
    /** Open state. Explicit property writes are silent; dismiss() proposes a cancelable change. */
    get open() { return this.shown; }
    set open(value) { const previous = this.shown; this.shown = Boolean(value); ++this.revision; this.requestUpdate('open', previous); }
    gesture;
    constructor() { super(); this.variant = 'info'; this.duration = 0; this.dismissLabel = 'Dismiss notification'; this.announcement = ''; this.priority = 'polite'; this.interrupt = false; this.swipe = false; }
    /** Propose dismissal through the single en-change contract. */
    dismiss(reason = 'dismiss') {
        if (!this.open)
            return;
        const hadFocus = this.matches(':focus-within');
        const previous = this.open;
        dispatchChange(this, { previous, proposed: false, reason, getRevision: () => this.revision, stage: value => { this.shown = value; }, rollback: value => { this.shown = value; } });
        this.requestUpdate('open', previous);
        if (hadFocus && !this.open)
            void this.updateComplete.then(() => {
                const root = this.getRootNode();
                const active = root.activeElement;
                if (active && active !== this && active !== this.ownerDocument.body)
                    return;
                // Composed notification-region focus recovery also supports forwarded slots.
                this.dispatchEvent(new Event('en-internal-toast-focus-return', { bubbles: true, composed: true }));
            });
    }
    /** Plain message text used by the containing announcement region. */
    get messageText() { return this.announcement.trim() || [...this.childNodes].filter(node => !(node instanceof Element) || !node.hasAttribute('slot')).map(node => node.textContent ?? '').join(' ').replace(/\s+/g, ' ').trim(); }
    /** Full uninterrupted countdown budget in milliseconds, before hover/focus pauses. Actions still prevent expiry. */
    get effectiveDuration() {
        if (!Number.isFinite(this.duration) || this.duration <= 0)
            return 0;
        const text = this.messageText;
        // A reading allowance, not a claim about individual reading speed or WCAG compliance.
        // The code-point allowance also covers long tokens and languages without spaces.
        const words = text ? text.split(/\s+/u).length : 0;
        const characters = [...text.replace(/\s/gu, '')].length;
        return Math.min(2147483647, Math.max(this.duration, 5000, 2000 + Math.max(words * 350, characters * 60)));
    }
    resetBudget() { this.pause(); this.timingText = this.messageText; this.remaining = this.open ? this.effectiveDuration : 0; }
    focus(options) { this.renderRoot.querySelector('en-button')?.focus(options); }
    pause() { if (this.timer !== undefined) {
        clearTimeout(this.timer);
        this.timer = undefined;
        this.remaining = Math.max(0, this.remaining - (performance.now() - this.started));
    } }
    resume() {
        if (!this.isConnected || !this.open || this.hidden || this.hasAttribute(toastQueuedAttribute) || this.gesture || this.hovered || this.focused || this.actionContent || this.ownerDocument.hidden || this.timer !== undefined || this.remaining <= 0)
            return;
        this.started = performance.now();
        this.timer = setTimeout(() => { this.timer = undefined; this.remaining = 0; this.dismiss('timeout'); }, this.remaining);
    }
    visibility = () => { this.pause(); this.resume(); };
    contentVisibility = (records) => {
        const featuredAgain = !this.hasAttribute(toastQueuedAttribute) && records.some(record => record.target === this && record.attributeName === toastQueuedAttribute && record.oldValue !== null);
        if (featuredAgain || this.messageText !== this.timingText)
            this.resetBudget();
        this.visibility();
    };
    swipeStart = (event) => {
        if (!this.swipe || !event.isPrimary || event.button !== 0 || this.matches(':focus-within') || event.composedPath().some(node => node instanceof Element && node.matches('button,a,input,select,textarea,en-button,[contenteditable],slot[name=actions]')))
            return;
        const surface = event.currentTarget;
        this.gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, horizontal: false, surface };
        try {
            surface.setPointerCapture(event.pointerId);
        }
        catch { /* Synthetic pointers need no capture. */ }
        this.pause();
    };
    swipeMove = (event) => { const gesture = this.gesture; if (!gesture || event.pointerId !== gesture.id)
        return; const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y; if (!gesture.horizontal) {
        if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) {
            this.swipeCancel();
            return;
        }
        if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.5)
            return;
        gesture.horizontal = true;
        try {
            gesture.surface.setPointerCapture(event.pointerId);
        }
        catch { /* Synthetic pointers need no capture. */ }
    } gesture.dx = dx; gesture.surface.style.setProperty('--_en-toast-swipe-offset', `${dx}px`); event.preventDefault(); };
    swipeEnd = (event) => { const gesture = this.gesture; if (!gesture || event.pointerId !== gesture.id)
        return; const dismiss = gesture.horizontal && Math.abs(gesture.dx) >= Math.max(64, Math.min(120, gesture.surface.getBoundingClientRect().width * .25)); this.swipeCancel(); if (dismiss && !this.matches(':focus-within'))
        this.dismiss('swipe'); };
    swipeCancel = () => { const gesture = this.gesture; this.gesture = undefined; gesture?.surface.style.removeProperty('--_en-toast-swipe-offset'); if (gesture?.surface.hasPointerCapture(gesture.id))
        gesture.surface.releasePointerCapture(gesture.id); this.resume(); };
    enter = (event) => { if (event.pointerType === 'touch')
        return; this.hovered = true; this.pause(); };
    leave = () => { this.hovered = false; this.resume(); };
    focusIn = () => { this.focused = true; this.pause(); };
    focusOut = () => { queueMicrotask(() => { this.focused = this.matches(':focus-within'); this.resume(); }); };
    actionsChanged = () => { const slot = this.renderRoot.querySelector('slot[name="actions"]'); this.actionContent = !!slot?.assignedNodes({ flatten: true }).some(node => node.nodeType === 1 || !!node.textContent?.trim()); this.pause(); this.resume(); };
    connectedCallback() { super.connectedCallback(); this.visibilityObserver = new MutationObserver(this.contentVisibility); this.visibilityObserver.observe(this, { attributes: true, attributeOldValue: true, attributeFilter: ['hidden', toastQueuedAttribute], childList: true, characterData: true, subtree: true }); this.ownerDocument.addEventListener('visibilitychange', this.visibility); this.addEventListener('pointerenter', this.enter); this.addEventListener('pointerleave', this.leave); this.addEventListener('focusin', this.focusIn); this.addEventListener('focusout', this.focusOut); if (this.hasUpdated)
        void this.updateComplete.then(() => this.resume()); }
    disconnectedCallback() { this.visibilityObserver?.disconnect(); this.swipeCancel(); this.pause(); this.hovered = false; this.focused = false; this.ownerDocument.removeEventListener('visibilitychange', this.visibility); this.removeEventListener('pointerenter', this.enter); this.removeEventListener('pointerleave', this.leave); this.removeEventListener('focusin', this.focusIn); this.removeEventListener('focusout', this.focusOut); super.disconnectedCallback(); }
    updated(changed) {
        if (!this.open || !this.swipe)
            this.swipeCancel();
        if (changed.has('open') || changed.has('duration') || (changed.has('announcement') && this.messageText !== this.timingText))
            this.resetBudget();
        this.actionsChanged();
    }
    render() {
        return html `<article class="en-toast" part="base" data-variant=${this.variant} ?hidden=${!this.open} @pointerdown=${this.swipeStart} @pointermove=${this.swipeMove} @pointerup=${this.swipeEnd} @pointercancel=${this.swipeCancel} @lostpointercapture=${this.swipeCancel} @keydown=${(event) => { if (event.key === 'Escape' && !event.defaultPrevented) {
            event.preventDefault();
            event.stopPropagation();
            this.dismiss('escape');
        } }}>
		<span class="en-toast__icon" part="icon" aria-hidden="true"><slot name="icon"><en-icon name=${this.variant === 'success' ? 'check' : this.variant === 'warning' || this.variant === 'danger' ? 'warning' : 'info'}></en-icon></slot></span>
		<div class="en-toast__body"><div class="en-toast__content" part="content"><slot></slot></div><div part="actions" class="en-toast__actions"><slot name="actions" @slotchange=${this.actionsChanged}></slot></div></div>
		<en-button class="en-toast__close" variant="ghost" icon-only size="inherit" exportparts="control:close" @click=${() => this.dismiss()}><en-icon slot="prefix" name="close" aria-hidden="true"></en-icon><span slot="label">${this.dismissLabel}</span></en-button>
	</article>`;
    }
}

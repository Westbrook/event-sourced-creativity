import { PopupMeasurement, calibratedOrigin, translatedRect, viewportBounds, verticalSpace, popupFit } from '../internal/popup-measurement.js';
/** Adapted from combobox positioning: same empirical origin, edge, fit and precision policy.
 * Menu width is content-authored and viewport-clamped; caller supplies an original slotted row. */
export class MenuPositionController {
    host;
    options;
    connected = false;
    anchor = null;
    popup = null;
    measurement;
    view;
    geometry = '';
    originX;
    originY;
    presented;
    reason;
    constructor(host, options) {
        this.host = host;
        this.options = options;
        host.addController(this);
    }
    hostConnected() { this.connected = true; }
    hostDisconnected() { this.connected = false; this.stop(); }
    hostUpdated() { this.sync(); }
    sync() {
        const anchor = this.options.anchor();
        const popup = this.options.popup();
        if (!this.connected || !this.options.open() || !popup || typeof popup.showPopover !== 'function' || !popup.matches(':popover-open')) {
            this.stop();
            return;
        }
        // A shown surface remains interactive at its last position while a trigger
        // is temporarily absent. Rebinding resumes measurement without a new open.
        if (!anchor) {
            this.stop(this.presented === 'visible');
            return;
        }
        if (anchor !== this.anchor || popup !== this.popup) {
            // Rebinding an already shown menu must not temporarily hide its native
            // focused item. Only the first opening starts behind the measurement gate.
            const retainVisible = this.presented === 'visible';
            this.stop(retainVisible);
            if (!retainVisible)
                popup.style.setProperty('--_en-menu-visibility', 'hidden');
            this.anchor = anchor;
            this.popup = popup;
            const view = anchor.ownerDocument.defaultView;
            if (!view)
                return;
            this.view = view;
            this.measurement = new PopupMeasurement(anchor, popup, () => this.connected && this.options.open(), () => this.position());
        }
        this.schedule();
    }
    schedule = () => { this.measurement?.schedule(); };
    position() {
        const anchor = this.anchor;
        const popup = this.popup;
        const view = this.view;
        if (!anchor?.isConnected || !popup?.isConnected || !view || typeof popup.showPopover !== 'function' || !popup.matches(':popover-open'))
            return;
        const style = view.getComputedStyle(popup);
        const gap = parseFloat(style.rowGap) || 0;
        // Reevaluate within the existing resize/visual-viewport measurement frame.
        // A mode change can rebind the anchor and add/remove Back; place it after
        // that Lit update, without closing/reopening the native popover or items.
        if (this.options.adaptPresentation(view.visualViewport?.width ?? view.innerWidth, gap))
            return;
        // Read both boxes before writing. Subsequent observer work is coalesced into one frame.
        const anchorRect = anchor.getBoundingClientRect();
        const popupRect = popup.getBoundingClientRect();
        const popupHeight = popupRect.height;
        const naturalHeight = popup.scrollHeight + popup.offsetHeight - popup.clientHeight;
        // Client rectangles and fixed-position CSS can have different origins while
        // a mobile visual viewport is panned. Measure that origin using this existing
        // fixed top-layer surface, rather than assuming a particular browser engine.
        this.originX = calibratedOrigin(style.left, popupRect.left, this.originX);
        this.originY = calibratedOrigin(style.top, popupRect.top, this.originY);
        const rect = translatedRect(anchorRect, this.originX, this.originY);
        // Measure content in place even while suspended. Never replace the editor or
        // move document scroll just to make space for the suggestion surface.
        const row = this.options.row();
        const rowHeight = row?.getBoundingClientRect().height ?? 0;
        const chrome = [style.paddingTop, style.paddingBottom, style.borderTopWidth, style.borderBottomWidth]
            .reduce((sum, value) => sum + (parseFloat(value) || 0), 0);
        const minimumHeight = rowHeight + chrome;
        const { top, left, width, height } = viewportBounds(view);
        const { below, above, useAbove } = verticalSpace(rect, { top, height }, gap, naturalHeight);
        const submenu = this.options.submenu();
        const replacement = this.options.replacement();
        const available = replacement ? Math.max(0, top + height - rect.top) : submenu ? height : useAbove ? above : below;
        const intersects = rect.width > 0 && rect.height > 0 && rect.right > left && rect.left < left + width
            && rect.bottom > top && rect.top < top + height;
        // A thin sliver of a result is not a usable popup. Retain open intent and
        // command context so keyboard/viewport motion can restore the same surface.
        const popupWidth = `${width}px`;
        const widthChanged = popup.style.getPropertyValue('--_en-menu-viewport-width') !== popupWidth;
        const heightChanged = popup.style.getPropertyValue('--_en-menu-max-height') !== `${available}px`;
        // A narrower width can wrap a row. Read its resulting height on the next
        // frame; an authored CSS height ceiling must also fit the measured row.
        const { presented, state: fitState, reason } = popupFit({ widthChanged, heightChanged, intersects, width, height, rowHeight, available, minimumHeight, popupHeight });
        let presentation = fitState;
        const measuringVisible = presentation === 'pending' && this.presented === 'visible';
        const forced = presentation === 'suspended' && this.options.unfit(reason);
        if (forced || measuringVisible)
            presentation = 'visible';
        // Unlike combobox, DOM focus is inside this popup. A normal remeasurement
        // retains the constrained surface; an accepted hide lets native lifecycle
        // snapshot/restore focus before removing it from the top layer.
        const closing = !this.options.open();
        const effectiveWidth = Math.min(replacement ? rect.width : popupRect.width, width);
        const rtl = style.direction === 'rtl';
        const sideStart = rtl ? rect.left - gap - effectiveWidth : rect.right + gap;
        const sideAlternative = rtl ? rect.right + gap : rect.left - gap - effectiveWidth;
        const preferredLeft = replacement ? rect.left : submenu
            ? sideStart >= left && sideStart + effectiveWidth <= left + width ? sideStart : sideAlternative
            : rtl ? rect.right - effectiveWidth : rect.left;
        const values = {
            '--_en-menu-replacement-width': `${effectiveWidth}px`,
            '--_en-menu-x': `${Math.max(left, Math.min(preferredLeft, left + width - effectiveWidth))}px`,
            // Keep the chosen edge attached to the trigger. A global viewport clamp can
            // pull a below-trigger surface across its editor using the previous height.
            '--_en-menu-y': `${replacement ? rect.top : submenu ? Math.max(top, Math.min(rect.top, top + height - Math.min(popupHeight, available))) : useAbove ? rect.top - gap - Math.min(popupHeight, available) : rect.bottom + gap}px`,
            '--_en-menu-viewport-width': popupWidth,
            '--_en-menu-max-height': `${available}px`,
            '--_en-menu-visibility': closing ? style.visibility : presented || forced || measuringVisible ? 'visible' : 'hidden',
        };
        for (const [name, value] of Object.entries(values))
            if (popup.style.getPropertyValue(name) !== value)
                popup.style.setProperty(name, value);
        if (widthChanged || heightChanged)
            this.schedule();
        this.setPresented(presentation, reason);
        // Placement or size changes can clip the active row after it was revealed.
        // Ordinary popup scrolling leaves this geometry unchanged and remains free.
        const geometry = [rect.x, rect.y, rect.width, rect.height, popupHeight, ...Object.values(values)].join('/');
        if (geometry !== this.geometry) {
            this.geometry = geometry;
            if (presented || forced)
                this.options.resized();
        }
    }
    setPresented(state, reason) {
        if (state === this.presented && reason === this.reason)
            return;
        this.presented = state;
        this.reason = reason;
        this.options.presented(state, reason);
    }
    stop(preservePresentation = false) {
        // Native hide owns focus restoration. Do not hide a still-focused surface
        // early during hostUpdated before FloatingSurface snapshots its focus.
        if (!preservePresentation) {
            this.setPresented('pending');
            this.presented = undefined;
            this.reason = undefined;
        }
        this.measurement?.stop();
        this.measurement = undefined;
        this.view = undefined;
        this.anchor = null;
        this.popup = null;
        this.geometry = '';
        this.originX = undefined;
        this.originY = undefined;
    }
}

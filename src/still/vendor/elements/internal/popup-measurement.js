/** Shared measurement lifecycle; placement, focus and visibility ownership stay with each control. */
export class PopupMeasurement {
    view;
    abort;
    observer;
    frame = 0;
    stopped = false;
    active;
    measure;
    constructor(anchor, popup, active, measure) {
        this.active = active;
        this.measure = measure;
        this.view = anchor.ownerDocument.defaultView;
        this.abort = new this.view.AbortController();
        const options = { signal: this.abort.signal, passive: true };
        this.view.addEventListener('resize', this.schedule, options);
        this.view.addEventListener('scroll', this.schedule, { ...options, capture: true });
        let root = anchor.getRootNode();
        while ('host' in root) {
            root.addEventListener('scroll', this.schedule, { ...options, capture: true });
            root = root.host.getRootNode();
        }
        this.view.visualViewport?.addEventListener('resize', this.schedule, options);
        this.view.visualViewport?.addEventListener('scroll', this.schedule, options);
        if (this.view.ResizeObserver) {
            this.observer = new this.view.ResizeObserver(this.schedule);
            this.observer.observe(anchor);
            this.observer.observe(popup);
        }
    }
    schedule = () => {
        if (this.frame || this.stopped)
            return;
        this.frame = this.view.requestAnimationFrame(() => { this.frame = 0; if (!this.stopped && this.active())
            this.measure(); });
    };
    stop() { this.stopped = true; this.abort.abort(); this.observer?.disconnect(); if (this.frame)
        this.view.cancelAnimationFrame(this.frame); this.frame = 0; }
}
/** Stabilize CSS-serialization noise without assuming a browser's fixed-position origin. */
export function calibratedOrigin(css, client, previous) {
    const parsed = parseFloat(css), measured = Number.isFinite(parsed) ? parsed - client : 0;
    return previous === undefined || Math.abs(measured - previous) > 0.5 ? measured : previous;
}
export function translatedRect(rect, x, y) { return { x: rect.x + x, y: rect.y + y, left: rect.left + x, right: rect.right + x, top: rect.top + y, bottom: rect.bottom + y, width: rect.width, height: rect.height }; }
export function viewportBounds(view) { const v = view.visualViewport; return { top: v?.offsetTop ?? 0, left: v?.offsetLeft ?? 0, width: v?.width ?? view.innerWidth, height: v?.height ?? view.innerHeight }; }
export function verticalSpace(rect, viewport, gap, naturalHeight) {
    const below = Math.max(0, Math.min(viewport.height, viewport.top + viewport.height - rect.bottom - gap));
    const above = Math.max(0, Math.min(viewport.height, rect.top - viewport.top - gap));
    return { below, above, useAbove: naturalHeight > below && above > below };
}
export function popupFit({ widthChanged, heightChanged, intersects, width, height, rowHeight, available, minimumHeight, popupHeight }) {
    const presented = !widthChanged && !heightChanged && intersects && width > 0 && height > 0 && rowHeight > 0 && available + 0.5 >= minimumHeight && popupHeight + 0.5 >= minimumHeight;
    const pending = intersects && width > 0 && height > 0 && (widthChanged || (heightChanged && available + 0.5 >= minimumHeight));
    const state = presented ? 'visible' : pending ? 'pending' : 'suspended';
    const reason = state !== 'suspended' ? undefined : !intersects ? 'offscreen' : width <= 0 || height <= 0 || rowHeight <= 0 ? 'unmeasured' : 'no-room';
    return { presented, pending, state, reason };
}

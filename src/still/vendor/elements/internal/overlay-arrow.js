import { html, nothing } from 'lit';
/** Decorative only: excluded from pointer hit testing and accessible descriptions. */
export function overlayArrowTemplate(arrow, path = 'M0 0 L8 8 L16 0') {
    return arrow ? html `<svg class="en-overlay-arrow" part="arrow" viewBox="0 0 16 8" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path part="arrow-shape" d=${path} vector-effect="non-scaling-stroke"></path></svg>` : nothing;
}
export function arrowExtent(surface) {
    const arrow = surface.querySelector('.en-overlay-arrow');
    return arrow ? parseFloat(surface.ownerDocument.defaultView.getComputedStyle(arrow).height) || 0 : 0;
}
/** Aim at the trigger after flip/shift, keeping the base clear of rounded corners.
 * Hide when no edge can point at the trigger without falsely indicating a target. */
export function positionOverlayArrow(surface, trigger) {
    const arrow = surface.querySelector('.en-overlay-arrow');
    if (!arrow)
        return;
    const view = surface.ownerDocument.defaultView;
    const box = surface.getBoundingClientRect(), target = trigger.getBoundingClientRect();
    const style = view.getComputedStyle(surface), arrowStyle = view.getComputedStyle(arrow);
    const size = parseFloat(arrowStyle.height) || 0, half = (parseFloat(arrowStyle.width) || size * 2) / 2;
    const border = parseFloat(style.borderTopWidth) || 0;
    const side = box.bottom <= target.top + 1 ? 'bottom' : box.top >= target.bottom - 1 ? 'top'
        : box.right <= target.left + 1 ? 'right' : box.left >= target.right - 1 ? 'left' : '';
    arrow.style.visibility = 'hidden';
    if (!side || !size)
        return;
    const horizontal = side === 'top' || side === 'bottom';
    const radius = Math.max(...[style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomLeftRadius, style.borderBottomRightRadius].map(v => parseFloat(v) || 0));
    const length = horizontal ? box.width : box.height;
    const clearance = radius + half + border;
    if (length < clearance * 2)
        return;
    const start = horizontal ? box.left : box.top;
    const targetStart = horizontal ? target.left : target.top, targetEnd = horizontal ? target.right : target.bottom;
    const center = Math.max(clearance, Math.min((targetStart + targetEnd) / 2 - start, length - clearance));
    if (center + start < targetStart || center + start > targetEnd)
        return;
    arrow.dataset.side = side;
    // Center the SVG's base on the surface border, then rotate around that base.
    const x = horizontal ? center - border : side === 'left' ? -border / 2 : box.width - border * 1.5;
    const y = horizontal ? side === 'top' ? -border / 2 : box.height - border * 1.5 : center - border;
    arrow.style.left = `${x}px`;
    arrow.style.top = `${y}px`;
    arrow.style.transform = `translateX(-50%) rotate(${side === 'top' ? 180 : side === 'left' ? 90 : side === 'right' ? -90 : 0}deg)`;
    arrow.style.visibility = 'visible';
}

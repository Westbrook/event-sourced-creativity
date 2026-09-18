/** Pointer precision tolerance, not a rendered layout dimension. */
const tolerance = 4;
export function withinBounds(point, bounds) {
    return point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom;
}
export function distanceToBounds(point, bounds) {
    const x = Math.max(bounds.left - point.x, 0, point.x - bounds.right);
    const y = Math.max(bounds.top - point.y, 0, point.y - bounds.bottom);
    return Math.hypot(x, y);
}
function cross(a, b, point) {
    return (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
}
/** Triangle from the exit point to the destination's facing edge, with slight pointer tolerance. */
export function inHoverCorridor(point, origin, destination) {
    const bounds = {
        left: destination.left - tolerance, right: destination.right + tolerance,
        top: destination.top - tolerance, bottom: destination.bottom + tolerance,
    };
    if (withinBounds(point, bounds))
        return true;
    const center = { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 };
    const dx = center.x - origin.x;
    const dy = center.y - origin.y;
    const length = Math.hypot(dx, dy) || 1;
    const apex = { x: origin.x - dx / length * tolerance, y: origin.y - dy / length * tolerance };
    let edgeA;
    let edgeB;
    if (origin.y <= bounds.top || origin.y >= bounds.bottom) {
        const y = origin.y <= bounds.top ? bounds.top : bounds.bottom;
        edgeA = { x: bounds.left, y };
        edgeB = { x: bounds.right, y };
    }
    else {
        const x = origin.x <= bounds.left ? bounds.left : bounds.right;
        edgeA = { x, y: bounds.top };
        edgeB = { x, y: bounds.bottom };
    }
    const sides = [cross(apex, edgeA, point), cross(edgeA, edgeB, point), cross(edgeB, apex, point)];
    return !(sides.some(value => value < 0) && sides.some(value => value > 0));
}

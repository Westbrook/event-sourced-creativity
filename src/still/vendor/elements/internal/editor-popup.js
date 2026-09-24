function visibleEditorBounds(editor) {
    const view = editor.ownerDocument.defaultView, viewport = view.visualViewport, edge = 8;
    const left = (viewport?.offsetLeft ?? 0) + edge, top = (viewport?.offsetTop ?? 0) + edge;
    const right = left + (viewport?.width ?? view.innerWidth) - 2 * edge, bottom = top + (viewport?.height ?? view.innerHeight) - 2 * edge;
    const rect = editor.getBoundingClientRect();
    const bounds = { left: Math.max(left, rect.left), right: Math.min(right, rect.right), top: Math.max(top, rect.top), bottom: Math.min(bottom, rect.bottom) };
    let ancestor = editor;
    while (ancestor) {
        const style = view.getComputedStyle(ancestor), box = ancestor.getBoundingClientRect();
        if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
            bounds.top = Math.max(bounds.top, box.top + ancestor.clientTop);
            bounds.bottom = Math.min(bounds.bottom, box.top + ancestor.clientTop + ancestor.clientHeight);
        }
        if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
            bounds.left = Math.max(bounds.left, box.left + ancestor.clientLeft);
            bounds.right = Math.min(bounds.right, box.left + ancestor.clientLeft + ancestor.clientWidth);
        }
        ancestor = ancestor.parentElement ?? (ancestor.getRootNode().host ?? null);
    }
    return bounds;
}
function isVisible(rect, bounds) {
    return rect.height > 0 && rect.bottom > bounds.top && rect.top < bounds.bottom && rect.right >= bounds.left && rect.left <= bounds.right;
}
/** Prefer the actual trigger glyph; fall back to the saved caret only when it is visible. */
export function editorTriggerAnchor(editor, trigger, caret) {
    const bounds = visibleEditorBounds(editor);
    return !isVisible(trigger, bounds) && isVisible(caret, bounds) ? caret : trigger;
}
/** Position an editor-owned top-layer popup without changing selection or scrolling it. */
export function positionEditorPopup(popup, editor, anchor, richPicker = false, caret) {
    const view = editor.ownerDocument.defaultView;
    if (!view)
        return;
    const viewport = view.visualViewport;
    const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? view.innerWidth, height = viewport?.height ?? view.innerHeight;
    const edge = 8, gap = 4, editorRect = editor.getBoundingClientRect(), bounds = visibleEditorBounds(editor);
    // If both trigger and caret are outside the scrollport, retain the nearest visible edge.
    const anchorTop = Math.max(top + edge, Math.max(bounds.top, Math.min(anchor.top, Math.max(bounds.top, bounds.bottom))));
    const anchorBottom = Math.max(bounds.top, Math.min(anchor.bottom, bounds.bottom));
    const place = (start, end) => {
        const below = Math.max(0, top + height - edge - end - gap), above = Math.max(0, start - top - edge - gap);
        const useBelow = below >= Math.min(240, above), available = useBelow ? below : above;
        popup.style.setProperty('--popup-height', `${Math.max(0, available)}px`);
        const y = useBelow ? end + gap : start - popup.offsetHeight - gap;
        popup.style.top = `${Math.max(top + edge, Math.min(y, top + height - popup.offsetHeight - edge))}px`;
    };
    popup.style.setProperty('--popup-width', `${Math.max(0, Math.min(richPicker ? Math.max(editorRect.width, 240) : 320, width - 2 * edge))}px`);
    const rtl = view.getComputedStyle(editor).direction === 'rtl';
    const desired = rtl ? anchor.right - popup.offsetWidth : anchor.left;
    popup.style.left = `${Math.max(left + edge, Math.min(desired, left + width - popup.offsetWidth - edge))}px`;
    place(anchorTop, anchorBottom);
    // A wrapped query can extend under a trigger-anchored menu. Keep its active line clear,
    // retaining trigger alignment horizontally and only adjusting vertical placement as needed.
    if (caret && isVisible(caret, bounds)) {
        const box = popup.getBoundingClientRect();
        if (caret.bottom > box.top && caret.top < box.bottom && caret.right >= box.left && caret.left <= box.right)
            place(Math.min(anchorTop, caret.top), Math.max(anchorBottom, caret.bottom));
    }
}
/** Track wrapping and scrollports across shadow boundaries while the picker is open. */
export function observeEditorPopup(editor, popup, position) {
    if (!editor || !popup)
        return;
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(position);
    observer?.observe(editor);
    observer?.observe(popup);
    const ancestors = [];
    let node = editor;
    while (node) {
        ancestors.push(node);
        node.addEventListener('scroll', position, { passive: true });
        node = node.parentElement ?? (node.getRootNode().host ?? null);
    }
    return { disconnect() { observer?.disconnect(); for (const ancestor of ancestors)
            ancestor.removeEventListener('scroll', position); } };
}

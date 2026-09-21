export function normalizeScrollOptions(options = {}) {
    const normalized = {
        behavior: options.behavior ?? 'auto',
        block: options.block ?? 'start',
        inline: options.inline ?? 'nearest',
        container: options.container ?? 'all',
    };
    const allowed = {
        behavior: ['auto', 'instant', 'smooth'],
        block: ['start', 'center', 'end', 'nearest'],
        inline: ['start', 'center', 'end', 'nearest'],
        container: ['all', 'nearest'],
    };
    for (const key of Object.keys(allowed)) {
        if (!allowed[key].includes(normalized[key])) {
            throw new TypeError(`Invalid scroll ${key}: ${String(normalized[key])}`);
        }
    }
    return normalized;
}
const nearestSupport = new WeakMap();
function supportsNearest(document) {
    const cached = nearestSupport.get(document);
    if (cached !== undefined)
        return cached;
    let supported = false;
    // Dictionary conversion happens before layout checks. A detached probe cannot
    // move any visible viewport or interrupt an existing document scroll.
    const probe = document.createElement('div');
    try {
        probe.scrollIntoView({
            get container() {
                supported = true;
                return 'nearest';
            },
            behavior: 'instant',
        });
    }
    catch {
        supported = false;
    }
    nearestSupport.set(document, supported);
    return supported;
}
function composedParent(element) {
    if (element.assignedSlot)
        return element.assignedSlot;
    if (element.parentElement)
        return element.parentElement;
    const root = element.getRootNode();
    return 'host' in root ? root.host : null;
}
function scrollAncestors(element) {
    const document = element.ownerDocument;
    const view = document.defaultView;
    if (!view)
        return [];
    const root = document.scrollingElement;
    const result = [];
    for (let parent = composedParent(element); parent; parent = composedParent(parent)) {
        if (parent === root)
            break;
        const style = view.getComputedStyle(parent);
        // Hidden still permits programmatic scrolling; clip and visible do not.
        if ([style.overflowX, style.overflowY].some(value => /^(auto|scroll|hidden|overlay)$/.test(value))) {
            result.push(parent);
        }
    }
    if (root)
        result.push(root);
    return result;
}
function length(value, extent, document) {
    const simple = /^(-?[\d.]+)(px|%)?$/.exec(value.trim());
    if (simple)
        return Number(simple[1]) * (simple[2] === '%' ? extent / 100 : 1);
    if (!value || value === 'auto' || !document.body)
        return 0;
    // CSSOM preserves calc()/min()/max()/clamp() when percentages are involved.
    // Let the engine resolve the expression against the scrollport extent; a
    // fixed hidden probe never participates in collection or document geometry.
    const box = document.createElement('div'), probe = document.createElement('div');
    box.style.cssText = `all:initial;position:fixed;inset:0 auto auto 0;inline-size:${extent}px;block-size:0;visibility:hidden;pointer-events:none;contain:strict;writing-mode:horizontal-tb;`;
    probe.style.cssText = 'all:initial;display:block;box-sizing:border-box;margin:0;padding:0;border:0;min-width:0;max-width:none;height:0;';
    probe.style.width = value;
    if (!probe.style.width)
        return 0;
    box.append(probe);
    document.body.append(box);
    try {
        return probe.getBoundingClientRect().width;
    }
    finally {
        box.remove();
    }
}
function alignmentDelta(start, end, viewportStart, viewportEnd, alignment) {
    if (alignment === 'start')
        return start - viewportStart;
    if (alignment === 'end')
        return end - viewportEnd;
    if (alignment === 'center')
        return (start + end - viewportStart - viewportEnd) / 2;
    // A fully visible item or a larger item spanning both edges already satisfies
    // nearest. For a partly visible large item align its nearer, opposite edge.
    if ((start >= viewportStart && end <= viewportEnd) || (start < viewportStart && end > viewportEnd))
        return 0;
    const smaller = end - start <= viewportEnd - viewportStart;
    if (start < viewportStart)
        return smaller ? start - viewportStart : end - viewportEnd;
    if (end > viewportEnd)
        return smaller ? end - viewportEnd : start - viewportStart;
    return 0;
}
function scrollPosition(target) {
    const view = target.ownerDocument.defaultView;
    return target === target.ownerDocument.scrollingElement && view
        ? { left: view.scrollX, top: view.scrollY }
        : { left: target.scrollLeft, top: target.scrollTop };
}
function scrollTarget(target, options) {
    const view = target.ownerDocument.defaultView;
    if (target === target.ownerDocument.scrollingElement && view)
        view.scrollTo(options);
    else
        target.scrollTo(options);
}
function cancelNativeScroll(target, position) {
    const document = target.ownerDocument;
    const root = target === document.scrollingElement;
    const height = root ? document.documentElement.clientHeight : target.clientHeight;
    const width = root ? document.documentElement.clientWidth : target.clientWidth;
    const verticalRange = Math.max(0, target.scrollHeight - height);
    const horizontalRange = Math.max(0, target.scrollWidth - width);
    // Firefox can treat instant scrolling to the current position as a no-op,
    // leaving a smooth animation running. A distinct target then immediate
    // restoration cancels it without exposing the temporary position at paint.
    if (verticalRange > 0) {
        const top = position.top < verticalRange
            ? Math.min(verticalRange, position.top + 1) : Math.max(0, position.top - 1);
        scrollTarget(target, { ...position, top, behavior: 'instant' });
    }
    else if (horizontalRange > 0) {
        const rtl = document.defaultView?.getComputedStyle(target).direction === 'rtl';
        const min = rtl ? -horizontalRange : 0;
        const max = rtl ? 0 : horizontalRange;
        const left = position.left < max
            ? Math.min(max, position.left + 1) : Math.max(min, position.left - 1);
        scrollTarget(target, { ...position, left, behavior: 'instant' });
    }
    scrollTarget(target, { ...position, behavior: 'instant' });
}
function scrollNearest(element, target, options, fallback) {
    const view = element.ownerDocument.defaultView;
    if (!view)
        return;
    const document = target.ownerDocument;
    const root = target === document.scrollingElement;
    const width = root ? document.documentElement.clientWidth : target.clientWidth;
    const height = root ? document.documentElement.clientHeight : target.clientHeight;
    const bounds = target.getBoundingClientRect();
    const left = root ? 0 : bounds.left + target.clientLeft;
    const top = root ? 0 : bounds.top + target.clientTop;
    const style = view.getComputedStyle(target);
    const itemStyle = view.getComputedStyle(element);
    const item = element.getBoundingClientRect();
    const explicit = fallback?.viewport === target ? fallback : undefined;
    const paddingTop = Math.max(length(style.scrollPaddingTop, height, document), explicit?.blockStart ?? 0);
    const paddingBottom = Math.max(length(style.scrollPaddingBottom, height, document), explicit?.blockEnd ?? 0);
    const paddingLeft = length(style.scrollPaddingLeft, width, document);
    const paddingRight = length(style.scrollPaddingRight, width, document);
    const blockDelta = alignmentDelta(item.top - length(itemStyle.scrollMarginTop, height, document), item.bottom + length(itemStyle.scrollMarginBottom, height, document), top + paddingTop, top + height - paddingBottom, options.block);
    const rtl = style.direction === 'rtl';
    const inline = rtl && options.inline === 'start' ? 'end'
        : rtl && options.inline === 'end' ? 'start' : options.inline;
    const inlineDelta = alignmentDelta(item.left - length(itemStyle.scrollMarginLeft, width, document), item.right + length(itemStyle.scrollMarginRight, width, document), left + paddingLeft, left + width - paddingRight, inline);
    const position = scrollPosition(target);
    const horizontalRange = Math.max(0, target.scrollWidth - width);
    const verticalRange = Math.max(0, target.scrollHeight - height);
    scrollTarget(target, {
        left: Math.max(rtl ? -horizontalRange : 0, Math.min(rtl ? 0 : horizontalRange, position.left + inlineDelta)),
        top: Math.max(0, Math.min(verticalRange, position.top + blockDelta)),
        // Passing auto through preserves CSS scroll-behavior; smooth uses the UA's
        // real animation rather than a controller-created sequence of instant jumps.
        behavior: options.behavior,
    });
}
/** Begin native scrolling, with a nearest-container fallback for older engines. */
export function beginScrollIntoView(element, options, fallback) {
    const ancestors = scrollAncestors(element);
    const targets = options.container === 'nearest' ? ancestors.slice(0, 1) : ancestors;
    const events = targets.map(target => target === target.ownerDocument.scrollingElement
        ? target.ownerDocument.defaultView ?? target
        : target);
    if (options.container === 'all' || supportsNearest(element.ownerDocument)) {
        const viewport = fallback?.viewport;
        const view = viewport?.ownerDocument.defaultView;
        if (fallback && viewport && view && targets.includes(viewport)
            && (fallback.blockStart > 0 || fallback.blockEnd > 0)) {
            const style = viewport.style;
            const computed = view.getComputedStyle(viewport);
            const properties = ['scroll-padding-top', 'scroll-padding-bottom'];
            const original = properties.map(property => ({
                property,
                value: style.getPropertyValue(property),
                priority: style.getPropertyPriority(property),
            }));
            const padding = [
                `max(${computed.scrollPaddingTop === 'auto' ? '0px' : computed.scrollPaddingTop}, ${Math.max(0, fallback.blockStart)}px)`,
                `max(${computed.scrollPaddingBottom === 'auto' ? '0px' : computed.scrollPaddingBottom}, ${Math.max(0, fallback.blockEnd)}px)`,
            ];
            try {
                // Native scrollIntoView computes its destination synchronously, including
                // when it subsequently animates. Expose explicit insets only while that
                // destination is captured, without changing any outer scrolling box.
                properties.forEach((property, index) => style.setProperty(property, padding[index], 'important'));
                element.scrollIntoView(options);
            }
            finally {
                for (const { property, value, priority } of original) {
                    if (value)
                        style.setProperty(property, value, priority);
                    else
                        style.removeProperty(property);
                }
            }
        }
        else {
            element.scrollIntoView(options);
        }
    }
    else if (targets[0]) {
        scrollNearest(element, targets[0], options, fallback);
    }
    return {
        targets,
        events,
        stop() {
            const positions = targets.map(target => ({ target, position: scrollPosition(target) }));
            const restore = () => {
                for (const { target, position } of positions)
                    cancelNativeScroll(target, position);
            };
            restore();
            // Chromium may still commit one already queued compositor position. The
            // controller owns scheduling this correction and cancelling it if new
            // input or a superseding request makes the captured position obsolete.
            return restore;
        },
    };
}

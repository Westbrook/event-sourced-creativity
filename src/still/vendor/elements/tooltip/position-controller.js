const anchors = new WeakMap();
let nextAnchor = 0;
let nextSurface = 0;
function retainAnchor(trigger) {
    const existing = anchors.get(trigger);
    if (existing) {
        existing.owners++;
        return existing;
    }
    const style = trigger.style;
    const original = style.getPropertyValue('anchor-name');
    const priority = style.getPropertyPriority('anchor-name');
    const names = trigger.ownerDocument.defaultView.getComputedStyle(trigger).getPropertyValue('anchor-name');
    const name = `--en-tooltip-${++nextAnchor}`;
    const written = names && names !== 'none' ? `${names}, ${name}` : name;
    style.setProperty('anchor-name', written, priority);
    const binding = { name, owners: 1, original, priority, written };
    anchors.set(trigger, binding);
    return binding;
}
function releaseAnchor(trigger, binding) {
    if (--binding.owners)
        return;
    const current = trigger.style.getPropertyValue('anchor-name');
    if (current === binding.written) {
        if (binding.original)
            trigger.style.setProperty('anchor-name', binding.original, binding.priority);
        else
            trigger.style.removeProperty('anchor-name');
    }
    else {
        // Preserve intervening author writes, removing only the name we own.
        const names = current.split(',').map(name => name.trim()).filter(name => name !== binding.name);
        if (names.length !== current.split(',').length) {
            trigger.style.setProperty('anchor-name', names.join(', ') || 'none', trigger.style.getPropertyPriority('anchor-name'));
        }
    }
    anchors.delete(trigger);
}
const axis = (value, fallback) => {
    const valid = value === 'start' || value === 'center' || value === 'end' ? value : fallback;
    return valid === 'start' ? -1 : valid === 'end' ? 1 : 0;
};
const clamp = (value, min, max) => Math.max(min, Math.min(value, Math.max(min, max)));
function coordinate(side, start, size, extent, gap) {
    return side < 0 ? start - extent - gap : side > 0 ? start + size + gap : start + (size - extent) / 2;
}
/** Flip only when the opposite region fits better, then shift inside the viewport. */
function resolveAxis(side, start, size, extent, gap, min, max) {
    const preferred = coordinate(side, start, size, extent, gap);
    const alternate = coordinate(-side, start, size, extent, gap);
    const overflow = (point) => Math.max(0, min - point) + Math.max(0, point + extent - max);
    const point = side && overflow(alternate) < overflow(preferred) ? alternate : preferred;
    return { point: clamp(point, min, max - extent) };
}
/** Native anchors own the tether; both paths share collision and viewport policy. */
export class TooltipPositionController {
    host;
    #trigger = null;
    #binding = null;
    #style = null;
    #surface = null;
    #native = false;
    #root = null;
    #selector = '';
    constructor(host) {
        this.host = host;
    }
    release() {
        // Losing the anchor keeps a displayed surface at its last usable rectangle.
        if (this.#surface?.matches(':popover-open')) {
            const rect = this.#surface.getBoundingClientRect();
            this.#surface.style.left = `${rect.left}px`;
            this.#surface.style.top = `${rect.top}px`;
        }
        this.#style?.remove();
        if (this.#trigger && this.#binding)
            releaseAnchor(this.#trigger, this.#binding);
        this.host.removeAttribute('data-en-tooltip-position');
        this.#trigger = null;
        this.#binding = null;
        this.#style = null;
        this.#root = null;
        this.#surface = null;
        this.#native = false;
    }
    bind(surface, trigger) {
        const root = this.host.getRootNode();
        if (trigger === this.#trigger && root === this.#root && surface === this.#surface)
            return;
        this.release();
        this.#trigger = trigger;
        this.#root = root;
        this.#surface = surface;
        const doc = this.host.ownerDocument;
        const view = doc.defaultView;
        if (!view.CSS?.supports('left', 'anchor(--en-test left)'))
            return;
        this.#binding = retainAnchor(trigger);
        const id = `en-tooltip-surface-${++nextSurface}`;
        this.host.setAttribute('data-en-tooltip-position', id);
        this.#selector = `[data-en-tooltip-position="${id}"]::part(surface)`;
        // Anchor names are tree scoped. A rule in the trigger's root can reach the
        // private surface via its public Part; an inner-shadow rule cannot do this.
        this.#style = doc.createElement('style');
        this.#style.dataset.enTooltipAnchor = id;
        (root.nodeType === 9 ? doc.head : root).appendChild(this.#style);
        surface.style.removeProperty('left');
        surface.style.removeProperty('top');
        this.rule(`left:anchor(${this.#binding.name} left, -100000px);top:anchor(${this.#binding.name} top, -100000px)`);
        const actual = surface.getBoundingClientRect();
        const expected = trigger.getBoundingClientRect();
        // Syntax support alone is insufficient (CSP, anchor-scope, root/engine gaps).
        this.#native = Math.abs(actual.left - expected.left) < 1 && Math.abs(actual.top - expected.top) < 1;
        if (!this.#native) {
            this.#style.remove();
            this.#style = null;
            releaseAnchor(trigger, this.#binding);
            this.#binding = null;
            this.host.removeAttribute('data-en-tooltip-position');
        }
    }
    rule(declarations) {
        if (!this.#style)
            return;
        const text = `${this.#selector}{position-anchor:${this.#binding.name};${declarations}}`;
        if (this.#style.textContent !== text)
            this.#style.textContent = text;
    }
    position(surface, trigger, inline, block) {
        const view = this.host.ownerDocument.defaultView;
        if (!surface || !trigger?.isConnected || !view) {
            this.release();
            return;
        }
        surface.style.right = 'auto';
        surface.style.bottom = 'auto';
        this.bind(surface, trigger);
        const anchor = trigger.getBoundingClientRect();
        const bounds = surface.getBoundingClientRect();
        const triggerStyle = view.getComputedStyle(trigger);
        const gap = parseFloat(view.getComputedStyle(surface).rowGap) || 0;
        let i = axis(inline, 'center');
        let b = axis(block, 'end');
        if (!i && !b)
            b = 1;
        if (triggerStyle.direction === 'rtl')
            i *= -1;
        const mode = triggerStyle.writingMode;
        const vertical = mode !== 'horizontal-tb';
        if (mode === 'sideways-lr')
            i *= -1;
        const xSide = vertical ? b * (mode.endsWith('-rl') ? -1 : 1) : i;
        const ySide = vertical ? i : b;
        const viewport = view.visualViewport;
        const left = viewport?.offsetLeft ?? 0;
        const top = viewport?.offsetTop ?? 0;
        const width = viewport?.width ?? this.host.ownerDocument.documentElement.clientWidth;
        const height = viewport?.height ?? this.host.ownerDocument.documentElement.clientHeight;
        const x = resolveAxis(xSide, anchor.left, anchor.width, bounds.width, gap, left + gap, left + width - gap);
        const y = resolveAxis(ySide, anchor.top, anchor.height, bounds.height, gap, top + gap, top + height - gap);
        if (this.#native && this.#binding) {
            surface.style.removeProperty('left');
            surface.style.removeProperty('top');
            const name = this.#binding.name;
            // Clamp in viewport coordinates before calculating the relative offset.
            // CSS clamps run before anchor scroll compensation in some engines.
            this.rule(`left:calc(anchor(${name} left, ${anchor.left}px) + ${x.point - anchor.left}px);top:calc(anchor(${name} top, ${anchor.top}px) + ${y.point - anchor.top}px)`);
        }
        else {
            surface.style.left = `${x.point}px`;
            surface.style.top = `${y.point}px`;
        }
    }
}

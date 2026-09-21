import { Signal } from 'signal-polyfill';
import { collectionGetKey } from './collection.js';
function positive(value, name) {
    if (!Number.isFinite(value) || value <= 0)
        throw new RangeError(`${name} must be positive and finite.`);
    return value;
}
function nonnegative(value, name) {
    if (!Number.isFinite(value) || value < 0)
        throw new RangeError(`${name} must be nonnegative and finite.`);
    return value;
}
/** Prefix geometry with logarithmic updates and offset lookup; rebuilding is reserved for item changes. */
class Geometry {
    sizes;
    tree;
    constructor(sizes) {
        this.sizes = sizes;
        this.tree = new Float64Array(sizes.length + 1);
        for (let i = 1; i <= sizes.length; i++) {
            this.tree[i] = this.tree[i] + sizes[i - 1];
            const parent = i + (i & -i);
            if (parent <= sizes.length)
                this.tree[parent] = this.tree[parent] + this.tree[i];
        }
    }
    sum(count) {
        let result = 0;
        for (let i = count; i > 0; i -= i & -i)
            result += this.tree[i];
        return result;
    }
    add(index, delta) {
        for (let i = index + 1; i < this.tree.length; i += i & -i)
            this.tree[i] = this.tree[i] + delta;
    }
    /** First row whose end is strictly beyond offset, or count at the end. */
    indexAt(offset) {
        let index = 0;
        let sum = 0;
        let step = 1;
        while (step * 2 < this.tree.length)
            step *= 2;
        for (; step > 0; step = Math.floor(step / 2)) {
            const next = index + step;
            if (next < this.tree.length && sum + this.tree[next] <= offset) {
                index = next;
                sum += this.tree[next];
            }
        }
        return index;
    }
}
/**
 * Renderer-independent vertical collection geometry. No browser globals or mutable consumer records.
 * Reads participate in Signals tracking. The renderer owns measurement, focus/overlay pin lifetimes,
 * native markup and applying anchorOffset to its scroll container after a geometry mutation.
 */
export class VirtualCollection {
    revision = new Signal.State(0);
    keyFor;
    estimate;
    overscan;
    initialCount;
    items = [];
    keys = [];
    indices = new Map();
    measurements = new Map();
    pinned = new Set();
    sizes = [];
    geometry = new Geometry([]);
    viewport;
    cachedEntries;
    constructor(options) {
        this.keyFor = collectionGetKey(options);
        this.estimate = positive(options.estimateSize ?? 48, 'estimateSize');
        this.overscan = Math.floor(nonnegative(options.overscan ?? 3, 'overscan'));
        this.initialCount = Math.floor(nonnegative(options.initialCount ?? 20, 'initialCount'));
        this.setItems(options.items);
    }
    changed() {
        this.cachedEntries = undefined;
        this.revision.set(this.revision.get() + 1);
    }
    get count() { this.revision.get(); return this.items.length; }
    get totalSize() { this.revision.get(); return this.geometry.sum(this.items.length); }
    /** Recommended scroll offset. Geometry changes preserve the first visible stable key plus its inset. */
    get anchorOffset() { this.revision.get(); return this.viewport?.offset ?? 0; }
    indexOf(key) { this.revision.get(); return this.indices.get(key) ?? -1; }
    /** Identity at a logical index, including rows outside the rendered window. */
    keyAt(index) {
        this.revision.get();
        return Number.isInteger(index) && index >= 0 ? this.keys[index] : undefined;
    }
    offsetOf(index) {
        this.revision.get();
        if (!Number.isInteger(index) || index < 0 || index > this.items.length)
            throw new RangeError('Invalid item index.');
        return this.geometry.sum(index);
    }
    sizeOf(index) {
        this.revision.get();
        if (!Number.isInteger(index) || index < 0 || index >= this.items.length)
            throw new RangeError('Invalid item index.');
        return this.sizes[index];
    }
    scrollOffsetFor(key) {
        const index = this.indexOf(key);
        return index < 0 ? undefined : this.offsetOf(index);
    }
    anchor() {
        if (!this.viewport || this.items.length === 0)
            return undefined;
        const index = Math.min(this.items.length - 1, this.geometry.indexAt(this.viewport.offset));
        return { key: this.keys[index], index, inset: this.viewport.offset - this.geometry.sum(index) };
    }
    restore(anchor) {
        if (!this.viewport)
            return;
        const index = anchor ? this.indices.get(anchor.key) : undefined;
        const offset = index === undefined ? this.viewport.offset : this.geometry.sum(index) + Math.min(anchor.inset, this.sizes[index]);
        this.viewport.offset = Math.max(0, Math.min(offset, Math.max(0, this.totalSize - this.viewport.size)));
    }
    /**
     * Retains measurements/pins by key; invalid input leaves previously accepted state unchanged.
     * Supply new record objects for edits. In-place content edits need their own host render/measurement;
     * passing the same ordered identities is intentionally a no-op.
     */
    setItems(items) {
        const nextItems = [...items];
        const keys = nextItems.map(this.keyFor);
        const indices = new Map();
        keys.forEach((key, index) => {
            if (typeof key !== 'string' || indices.has(key))
                throw new TypeError('Virtual collections require unique string keys.');
            indices.set(key, index);
        });
        if (nextItems.length === this.items.length && nextItems.every((item, index) => item === this.items[index] && keys[index] === this.keys[index]))
            return;
        let anchor = this.anchor();
        if (anchor && !indices.has(anchor.key)) {
            // Prefer the next surviving former row, then the previous; never reuse an unrelated index as identity.
            const index = this.keys.findIndex((key, index) => index > anchor.index && indices.has(key));
            let fallback = index;
            if (fallback < 0)
                for (let i = anchor.index - 1; i >= 0; i--)
                    if (indices.has(this.keys[i])) {
                        fallback = i;
                        break;
                    }
            anchor = fallback < 0 ? undefined : { key: this.keys[fallback], index: fallback, inset: 0 };
        }
        this.items = nextItems;
        this.keys = keys;
        this.indices = indices;
        for (const key of this.measurements.keys())
            if (!indices.has(key))
                this.measurements.delete(key);
        for (const key of this.pinned)
            if (!indices.has(key))
                this.pinned.delete(key);
        this.sizes = keys.map((key) => this.measurements.get(key) ?? this.estimate);
        this.geometry = new Geometry(this.sizes);
        this.restore(anchor);
        this.changed();
    }
    setViewport(offset, size) {
        nonnegative(offset, 'offset');
        nonnegative(size, 'size');
        offset = Math.min(offset, Math.max(0, this.totalSize - size));
        if (this.viewport?.offset === offset && this.viewport.size === size)
            return;
        this.viewport = { offset, size };
        this.changed();
    }
    measure(key, size) {
        return this.measureMany([[key, size]]);
    }
    /** Apply one measurement batch with a single anchor restoration, avoiding intermediate edge clamping. */
    measureMany(measurements) {
        const accepted = new Map();
        for (const [key, size] of measurements) {
            positive(size, 'size');
            if (this.indices.has(key))
                accepted.set(key, size);
        }
        const anchor = this.anchor();
        let changed = false;
        for (const [key, size] of accepted) {
            const index = this.indices.get(key);
            this.measurements.set(key, size);
            if (this.sizes[index] === size)
                continue;
            this.geometry.add(index, size - this.sizes[index]);
            this.sizes[index] = size;
            changed = true;
        }
        if (!changed)
            return false;
        this.restore(anchor);
        this.changed();
        return true;
    }
    /** Explicitly forget measured geometry after an offscreen density/font/layout change. */
    invalidateMeasurements() {
        if (this.measurements.size === 0)
            return;
        const anchor = this.anchor();
        this.measurements.clear();
        this.sizes = this.keys.map(() => this.estimate);
        this.geometry = new Geometry(this.sizes);
        this.restore(anchor);
        this.changed();
    }
    pin(key) {
        if (!this.indices.has(key) || this.pinned.has(key))
            return;
        this.pinned.add(key);
        this.changed();
    }
    unpin(key) {
        if (this.pinned.delete(key))
            this.changed();
    }
    /** Gaps and retained rows preserve the total extent, without mounting intervening unneeded rows. */
    get entries() {
        this.revision.get();
        if (this.cachedEntries)
            return this.cachedEntries;
        const count = this.items.length;
        const indices = new Set();
        let start = 0;
        let end = Math.min(count, this.initialCount);
        if (this.viewport && count) {
            start = Math.max(0, Math.min(count - 1, this.geometry.indexAt(this.viewport.offset)) - this.overscan);
            const edge = this.viewport.offset + this.viewport.size;
            let visibleEnd = this.geometry.indexAt(edge);
            if (visibleEnd < count && this.geometry.sum(visibleEnd) < edge)
                visibleEnd++;
            end = Math.min(count, Math.max(start + 1, visibleEnd) + this.overscan);
        }
        for (let index = start; index < end; index++)
            indices.add(index);
        for (const key of this.pinned)
            indices.add(this.indices.get(key));
        const entries = [];
        let cursorIndex = 0;
        for (const index of [...indices].sort((a, b) => a - b)) {
            const offset = this.geometry.sum(index);
            if (index > cursorIndex) {
                const cursor = this.geometry.sum(cursorIndex);
                entries.push(Object.freeze({ kind: 'gap', key: `gap:${index}`, offset: cursor, size: offset - cursor }));
            }
            const size = this.sizes[index];
            entries.push(Object.freeze({ kind: 'item', key: this.keys[index], item: this.items[index], index, offset, size }));
            cursorIndex = index + 1;
        }
        const total = this.geometry.sum(count);
        if (cursorIndex < count) {
            const cursor = this.geometry.sum(cursorIndex);
            entries.push(Object.freeze({ kind: 'gap', key: 'gap:end', offset: cursor, size: total - cursor }));
        }
        this.cachedEntries = Object.freeze(entries);
        return this.cachedEntries;
    }
}

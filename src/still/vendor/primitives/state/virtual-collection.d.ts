import { Signal } from 'signal-polyfill';
interface VirtualCollectionSettings<T> {
    items: readonly T[];
    estimateSize?: number;
    /** Number of additional items mounted on each side of the visible range. */
    overscan?: number;
    /** Deterministic initial item count used before a browser viewport is supplied. */
    initialCount?: number;
}
/** Stable, unique identity; canonical getKey wins over the deprecated key callback. */
export type VirtualCollectionOptions<T> = VirtualCollectionSettings<T> & ({
    getKey: (item: T) => string;
    key?: (item: T) => string;
} | {
    getKey?: (item: T) => string;
    key: (item: T) => string;
});
export type VirtualEntry<T> = Readonly<{
    kind: 'item';
    key: string;
    item: T;
    index: number;
    offset: number;
    size: number;
} | {
    kind: 'gap';
    key: string;
    offset: number;
    size: number;
}>;
/**
 * Renderer-independent vertical collection geometry. No browser globals or mutable consumer records.
 * Reads participate in Signals tracking. The renderer owns measurement, focus/overlay pin lifetimes,
 * native markup and applying anchorOffset to its scroll container after a geometry mutation.
 */
export declare class VirtualCollection<T> {
    readonly revision: Signal.State<number>;
    private readonly keyFor;
    private readonly estimate;
    private readonly overscan;
    private readonly initialCount;
    private items;
    private keys;
    private indices;
    private measurements;
    private pinned;
    private sizes;
    private geometry;
    private viewport;
    private cachedEntries;
    constructor(options: VirtualCollectionOptions<T>);
    private changed;
    get count(): number;
    get totalSize(): number;
    /** Recommended scroll offset. Geometry changes preserve the first visible stable key plus its inset. */
    get anchorOffset(): number;
    indexOf(key: string): number;
    /** Identity at a logical index, including rows outside the rendered window. */
    keyAt(index: number): string | undefined;
    offsetOf(index: number): number;
    sizeOf(index: number): number;
    scrollOffsetFor(key: string): number | undefined;
    private anchor;
    private restore;
    /**
     * Retains measurements/pins by key; invalid input leaves previously accepted state unchanged.
     * Supply new record objects for edits. In-place content edits need their own host render/measurement;
     * passing the same ordered identities is intentionally a no-op.
     */
    setItems(items: readonly T[]): void;
    setViewport(offset: number, size: number): void;
    measure(key: string, size: number): boolean;
    /** Apply one measurement batch with a single anchor restoration, avoiding intermediate edge clamping. */
    measureMany(measurements: Iterable<readonly [string, number]>): boolean;
    /** Explicitly forget measured geometry after an offscreen density/font/layout change. */
    invalidateMeasurements(): void;
    pin(key: string): void;
    unpin(key: string): void;
    /** Gaps and retained rows preserve the total extent, without mounting intervening unneeded rows. */
    get entries(): readonly VirtualEntry<T>[];
}
export {};

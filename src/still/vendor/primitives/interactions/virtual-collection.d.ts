import type { ReactiveController, ReactiveControllerHost } from 'lit';
import type { VirtualCollection } from '../state/virtual-collection.js';
import type { ScrollToKeyOptions } from './scroll-into-view.js';
export type { ScrollToKeyOptions } from './scroll-into-view.js';
export interface VirtualCollectionControllerOptions {
    /** Explicit scrolling surface. Pass document.scrollingElement for document scrolling; otherwise use a public scrollElement API. */
    viewport: () => HTMLElement | null | undefined;
    /** The native ul/ol/tbody that contains the rows returned by the rendering adapter. */
    content: () => Element | null | undefined;
    /** Optional measured rows for a nested adapter. Each element measures one record, excluding descendant records. Defaults to direct content children. */
    rows?: () => Iterable<HTMLElement>;
    /** Map a focused semantic element to its measured row when hierarchy wrappers differ from row geometry. Return null for focus outside this collection. */
    rowFor?: (active: Element | null) => HTMLElement | null;
    /** Disable browser windowing for a separate paginated/full-content reading mode. */
    enabled?: () => boolean;
    /** Space obscured by a sticky header inside the scrollport. */
    occludedBlockStart?: () => number;
    /** Space obscured by a sticky footer inside the scrollport. */
    occludedBlockEnd?: () => number;
    /** Focusable recovery target; defaults to the content in document mode, otherwise the viewport. */
    focusTarget?: () => HTMLElement | null | undefined;
    /** Application-owned recovery when a focused record is removed; receives the resolved recovery target. */
    onFocusedItemRemoved?: (key: string, viewport: HTMLElement) => void;
}
/**
 * Browser lifecycle for a pure range model. Construction and initial rendering are SSR safe.
 * Rows are measured only while mounted. Work is scheduled by changes, never an idle frame loop.
 */
export declare class VirtualCollectionController<T> implements ReactiveController {
    #private;
    readonly model: VirtualCollection<T>;
    constructor(host: HTMLElement & ReactiveControllerHost, model: VirtualCollection<T>, options: VirtualCollectionControllerOptions);
    hostConnected(): void;
    hostUpdated(): void;
    hostUpdate(): void;
    hostDisconnected(): void;
    /** Re-resolve roots after a child finishes rendering, or after an authoritative data change. */
    refresh(): void;
    /** Invalidate unseen geometry after font, theme, density or other presentation changes. */
    invalidateMeasurements(): void;
    /** Keep an editing row or overlay trigger mounted independently of keyboard focus. Leases are counted. */
    pin(key: string): void;
    unpin(key: string): void;
    /** Reveal an application-selected record without moving focus or changing selection. */
    scrollToKey(key: string, options?: ScrollToKeyOptions): boolean;
}

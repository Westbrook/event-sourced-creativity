/** Native scrolling options, including the progressively supported container member. */
export interface ScrollToKeyOptions extends ScrollIntoViewOptions {
    container?: 'all' | 'nearest';
}
export type NormalizedScrollOptions = Required<ScrollToKeyOptions>;
export declare function normalizeScrollOptions(options?: ScrollToKeyOptions): NormalizedScrollOptions;
/** Begin native scrolling, with a nearest-container fallback for older engines. */
export declare function beginScrollIntoView(element: HTMLElement, options: NormalizedScrollOptions, fallback?: {
    viewport: HTMLElement;
    blockStart: number;
    blockEnd: number;
}): {
    targets: readonly HTMLElement[];
    events: readonly EventTarget[];
    stop(): () => void;
};

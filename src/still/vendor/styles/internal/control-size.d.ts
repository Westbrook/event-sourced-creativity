/** Padding inside the segmented border, independent of the shared layout reserve. */
export declare const segmentedFramePadding: import("lit").CSSResult;
/** Every inner edge uses the same border-to-option distance. */
export declare const controlFrameInset: import("lit").CSSResult;
/**
 * Comparable text controls share a minimum, not a fixed height. The envelope
 * accommodates both typography roles, native compound-control borders, and a
 * complete option target inside the segmented frame. Wrapped content can grow.
 */
export declare function textControlBlockSize(coarse?: boolean, segmented?: boolean): import("lit").CSSResult;

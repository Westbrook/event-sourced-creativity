import { type CSSResult } from 'lit';
/** Compose with the focus helper so focus halo and surface paint keep separate timing. */
export declare const surfaceTransitions: CSSResult;
/**
 * Only native display/overlay transitions retain exit paint. The adapter closes
 * and removes focus participation immediately. Anchored rectangles never move.
 */
export declare function nativeSurfaceMotion(base: CSSResult, open: CSSResult, closed: CSSResult, entry: 'fade' | 'elevation' | 'move', pseudoElement?: CSSResult, family?: 'popup' | 'dialog'): CSSResult;
/** Palette styles provide an origin that keeps centering independent of this scale. */
export declare const modalSurfaceMotion: CSSResult;

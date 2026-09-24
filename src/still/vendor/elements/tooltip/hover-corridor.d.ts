export interface Point {
    x: number;
    y: number;
}
export interface Bounds {
    left: number;
    right: number;
    top: number;
    bottom: number;
}
export declare function withinBounds(point: Point, bounds: Bounds): boolean;
export declare function distanceToBounds(point: Point, bounds: Bounds): number;
/** Triangle from the exit point to the destination's facing edge, with slight pointer tolerance. */
export declare function inHoverCorridor(point: Point, origin: Point, destination: Bounds): boolean;

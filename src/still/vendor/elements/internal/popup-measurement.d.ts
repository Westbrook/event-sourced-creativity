/** Shared measurement lifecycle; placement, focus and visibility ownership stay with each control. */
export declare class PopupMeasurement {
    private readonly view;
    private readonly abort;
    private readonly observer;
    private frame;
    private stopped;
    private readonly active;
    private readonly measure;
    constructor(anchor: HTMLElement, popup: HTMLElement, active: () => boolean, measure: () => void);
    readonly schedule: () => void;
    stop(): void;
}
/** Stabilize CSS-serialization noise without assuming a browser's fixed-position origin. */
export declare function calibratedOrigin(css: string, client: number, previous?: number): number;
export declare function translatedRect(rect: DOMRect, x: number, y: number): {
    x: number;
    y: number;
    left: number;
    right: number;
    top: number;
    bottom: number;
    width: number;
    height: number;
};
export declare function viewportBounds(view: Window): {
    top: number;
    left: number;
    width: number;
    height: number;
};
export declare function verticalSpace(rect: {
    top: number;
    bottom: number;
}, viewport: {
    top: number;
    height: number;
}, gap: number, naturalHeight: number): {
    below: number;
    above: number;
    useAbove: boolean;
};
export declare function popupFit({ widthChanged, heightChanged, intersects, width, height, rowHeight, available, minimumHeight, popupHeight }: {
    widthChanged: boolean;
    heightChanged: boolean;
    intersects: boolean;
    width: number;
    height: number;
    rowHeight: number;
    available: number;
    minimumHeight: number;
    popupHeight: number;
}): {
    readonly presented: boolean;
    readonly pending: boolean;
    readonly state: "pending" | "suspended" | "visible";
    readonly reason: "no-room" | "offscreen" | "unmeasured" | undefined;
};

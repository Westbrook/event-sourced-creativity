/** Logical region around a trigger, independent of physical writing direction. */
export type TooltipAxis = 'start' | 'center' | 'end';
/** Native anchors own the tether; both paths share collision and viewport policy. */
export declare class TooltipPositionController {
    #private;
    private host;
    constructor(host: HTMLElement);
    release(): void;
    private bind;
    private rule;
    position(surface: HTMLElement | null, trigger: HTMLElement | null, inline: string, block: string): void;
}

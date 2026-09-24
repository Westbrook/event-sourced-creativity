export interface TooltipView {
    arrow?: boolean;
    arrowPath?: string;
    contentSlotChange: () => void;
    nativeToggle: (event: ToggleEvent) => void;
    pointerEnter: (event: PointerEvent) => void;
    pointerLeave: (event: PointerEvent) => void;
    pointerMove: (event: PointerEvent) => void;
}
/** The actual description target is the slotted light-DOM content, not this surface. */
export declare function tooltipTemplate(view: TooltipView): import("lit-html").TemplateResult<1>;

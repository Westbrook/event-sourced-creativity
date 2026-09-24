declare class TooltipWarmupGroup {
    #private;
    get warm(): boolean;
    join(member: object, handoff: (focus: boolean) => void, focused: () => boolean, resume: () => void): void;
    hasFocusedPeer(source: object): boolean;
    focus(member: object, active: boolean): void;
    leave(member: object): void;
    activity(member: object, active: boolean): void;
    markWarm(source: object, stillPresented: () => boolean): void;
    cool(): void;
}
export declare function tooltipWarmupGroup(element: Element): TooltipWarmupGroup;
export {};

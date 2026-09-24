export type AssociatedTrigger = HTMLElement & {
    disabled?: boolean;
    loading?: boolean;
};
/** Read live identity and availability before and after application callbacks. */
export declare function eligibleOverlayTrigger(host: HTMLElement, id: string, trigger: AssociatedTrigger | null): boolean;
/** Associated buttons own this click's default, including a submit button in a form. */
export declare function admitOverlayClick(event: MouseEvent | undefined, eligible: boolean): boolean;

/** Internal composition capability. No consumer receives a private shadow node. */
export interface MenuItemOwner {
    ready(): boolean;
    owns(item: HTMLElement): boolean;
    capture(): () => void;
    accepted(checkpoint: () => void): void;
    radioPeers(item: HTMLElement): readonly MenuCheckState[];
    radioSelected(item: HTMLElement): void;
}
export declare function ownMenuItem(item: HTMLElement, owner: MenuItemOwner): () => void;
export declare function menuItemOwner(item: HTMLElement): MenuItemOwner | undefined;
/** Internal state leases let a radio proposal stage its whole group before dispatch. */
export interface MenuCheckState {
    element: HTMLElement;
    checked(): boolean;
    revision(): number;
    stage(value: boolean): void;
    write(value: boolean): void;
}
export declare function registerMenuCheckState(element: HTMLElement, state: MenuCheckState): void;
export declare function menuCheckState(element: HTMLElement): MenuCheckState | undefined;

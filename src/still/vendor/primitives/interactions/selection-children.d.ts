import type { ReactiveController, ReactiveControllerHost } from 'lit';
export declare const SELECTION_CHILDREN_ATTRIBUTE = "data-en-selection-children";
export declare const SELECTION_SLOT_PREFIX = "en-selection-";
export type SelectionChildKind = 'select' | 'segmented' | 'choice' | 'checkbox';
export interface SelectionChild {
    readonly key: string;
    readonly value: string;
    readonly label: string;
    readonly description?: string;
    readonly disabled: boolean;
    readonly hidden: boolean;
}
export interface SelectionChildrenPlan {
    readonly version: 1;
    readonly kind: SelectionChildKind;
    readonly value: string;
    readonly items: readonly SelectionChild[];
}
export interface SelectionChildSource {
    readonly key: string;
    readonly tagName: string;
    readonly attributes: Readonly<Record<string, string>>;
    readonly text: string;
    readonly descriptionAssigned?: boolean;
    readonly interactive?: boolean;
    readonly description?: string;
}
export interface SelectionChildrenView {
    readonly active: boolean;
    readonly items: readonly SelectionChild[];
    readonly error: string;
}
/** Generated projection names are disposable metadata, not authored identity. */
export declare function isGeneratedSelectionSlot(value: string): boolean;
/** Shared browser/SSR descriptor normalization. No HTML or CSS is executed. */
export declare function normalizeSelectionChildren(kind: SelectionChildKind, sources: readonly SelectionChildSource[]): readonly SelectionChild[];
/** Detect native interactive label content without looking into another component's shadow. */
export declare function isSelectionLabelInteractive(tag: string, attributes: Readonly<Record<string, string>>): boolean;
type Host = HTMLElement & ReactiveControllerHost;
/** Internal SSR preparation seam. Consumers never author plans or slot assignments. */
export declare function prepareSelectionChildren(host: object, plan: SelectionChildrenPlan): void;
/** Parent-owned choices; original rich label nodes are projected, never moved or cloned. */
export declare class SelectionChildrenController implements ReactiveController {
    #private;
    get projectsContent(): boolean;
    constructor(host: Host, kind: SelectionChildKind);
    get view(): SelectionChildrenView;
    get initialValue(): string | undefined;
    prepare(plan: SelectionChildrenPlan): void;
    hostConnected(): void;
    hostUpdated(): void;
    hostDisconnected(): void;
    /** Fresh synchronous catalog for transaction guards, without changing the hydration template. */
    current(): SelectionChildrenView;
    refresh(): void;
}
export interface SelectionContentNode {
    readonly text?: string;
    readonly attributes?: Readonly<Record<string, string>>;
    readonly children?: readonly SelectionContentNode[];
}
/** Same light-DOM label/description split in browser and SSR; decoration stays silent. */
export declare function checkboxContent(nodes: readonly SelectionContentNode[]): {
    label: string;
    description: string;
    descriptionAssigned: boolean;
};
export {};

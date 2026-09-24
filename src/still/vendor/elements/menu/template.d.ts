export interface MenuView {
    label: string;
    backLabel: string;
    replacement: boolean;
    replaced: boolean;
    back(): void;
    nativeToggle(event: ToggleEvent): void;
    childrenChanged(): void;
}
/** Authored items stay in the host; the native top-layer menu owns the landmark. */
export declare const menuTemplate: (view: MenuView) => import("lit-html").TemplateResult<1>;

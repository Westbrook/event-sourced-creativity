export interface MenuItemView {
    disabled: boolean;
    type: string;
    checked: boolean;
    hasPopup?: string;
    expanded?: string;
    tabStop: number;
    activate(event: MouseEvent): void;
}
/** Native activation is preserved; ornamental slots cannot add an action target. */
export declare const menuItemTemplate: (view: MenuItemView) => import("lit-html").TemplateResult<1>;

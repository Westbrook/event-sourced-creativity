export interface ButtonView {
    variant: string;
    size: string;
    disabled: boolean;
    loading: boolean;
    iconOnly: boolean;
    popupRole: string | null;
    popupExpanded: string | null;
    ariaDisabled?: string | null;
    tabIndex?: number;
    pressed?: string | null;
}
export declare const buttonTemplate: (view: ButtonView) => import("lit-html").TemplateResult<1>;

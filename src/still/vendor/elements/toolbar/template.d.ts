export interface ToolbarView {
    label: string;
    orientation: 'horizontal' | 'vertical';
    nativeNavigation: boolean;
    onSlotChange: () => void;
}
export declare const toolbarTemplate: (view: ToolbarView) => import("lit-html").TemplateResult<1>;

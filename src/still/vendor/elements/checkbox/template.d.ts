export interface ChoiceView {
    readonly kind: 'checkbox' | 'switch' | 'radio';
    readonly checked: boolean;
    readonly indeterminate?: boolean;
    readonly disabled: boolean;
    readonly required: boolean;
    readonly value: string;
    readonly label: string;
    readonly description: string;
    readonly error?: string;
    readonly tabIndex: number;
}
/** Native semantics and the label stay in one tree. The slot supplies label content. */
export declare function choiceTemplate(view: ChoiceView, onChange: (event: Event) => void): import("lit-html").TemplateResult<1>;

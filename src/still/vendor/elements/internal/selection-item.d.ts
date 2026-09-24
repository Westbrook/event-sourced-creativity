import { LitElement } from 'lit';
/** Descriptor metadata is reflected so browser and SSR read the same authored contract. */
export declare abstract class SelectionItemElement extends LitElement {
    #private;
    private readonly staticStyles;
    static properties: {
        value: {
            noAccessor: boolean;
            reflect: boolean;
            useDefault: boolean;
        };
        disabled: {
            type: BooleanConstructor;
            noAccessor: boolean;
            reflect: boolean;
            useDefault: boolean;
        };
        label: {
            type: StringConstructor;
            noAccessor: boolean;
            reflect: boolean;
            useDefault: boolean;
        };
    };
    /** Explicit parent-owned choice identifier; changing it never selects the item. */
    get value(): string;
    set value(value: string);
    /** Exclude this choice from user selection. The parent retains value authority. @default false */
    get disabled(): boolean;
    set disabled(value: boolean);
    /** Plain label fallback when no label content is supplied. @default '' */
    get label(): string;
    set label(value: string);
}

import type { RichEditorCommand } from '../rich-text-editor.js';
/** Partial, property-only translations shared by token/rich editors and the default toolbar. */
export interface EditorMessages {
    readonly suggestions?: Partial<{
        label: string;
        loading: string;
        unavailable: string;
        empty: string;
        keyboardHint: string;
    }>;
    readonly instructions?: Partial<{
        picker: string;
        richText: string;
    }>;
    readonly commands?: Partial<Record<RichEditorCommand, string>>;
    readonly link?: Partial<{
        label: string;
        placeholder: string;
        applyLabel: string;
        cancelLabel: string;
        invalid: string;
    }>;
}
export declare function editorMessages(messages?: EditorMessages | null): {
    suggestions: {
        label: string;
        loading: string;
        unavailable: string;
        empty: string;
        keyboardHint: string;
    };
    instructions: {
        picker: string;
        richText: string;
    };
    commands: Record<RichEditorCommand, string>;
    link: {
        label: string;
        placeholder: string;
        applyLabel: string;
        cancelLabel: string;
        invalid: string;
    };
};

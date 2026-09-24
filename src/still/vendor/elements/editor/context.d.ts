import type { EditorBookmark } from '../../primitives/interactions/editor-extensions.js';
import type { EditorExtensionHost } from './extensions.js';
import type { RichEditorCommand, RichCommandState } from '../rich-text-editor.js';
/** Public formatting capability. Command state remains owned by the editor. */
export interface RichEditorCommandHost extends HTMLElement {
    readonly revision: number;
    readonly selectionKey: string;
    readonly hasSelection: boolean;
    readonly disabled: boolean;
    readonly readOnly: boolean;
    readonly composing: boolean;
    readonly extensionOpen: boolean;
    captureBookmark(): EditorBookmark;
    restoreBookmark(bookmark: EditorBookmark): boolean;
    execute(command: RichEditorCommand, value?: string, bookmark?: EditorBookmark): boolean;
    getCommandState(command: RichEditorCommand): RichCommandState;
    getSelectionRect(): DOMRectReadOnly | undefined;
}
export declare const editorExtensionContext: {
    __context__: EditorExtensionHost | undefined;
};
export declare const richEditorCommandContext: {
    __context__: RichEditorCommandHost | undefined;
};
export declare function isEditorExtensionHost(value: unknown): value is EditorExtensionHost;
export declare function isRichEditorCommandHost(value: unknown): value is RichEditorCommandHost;
